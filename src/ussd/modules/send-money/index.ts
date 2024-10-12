import { currencyDescriptions, makeHumanReadablePaymentMethod } from '@/constants/descriptions';
import { fetchGoCreditBalance } from '@/db/helpers';
import { transactions, DbUser as User } from '@/db/schema';
import { resolveDID } from '@/did';
import { UssdRequest } from '@/ussd';
import { buildContinueResponse, buildFormMenu, buildRunHandler, sessionErrors } from '@/ussd/builders';
import { createCredential, getCustomerCredentials, saveCustomerCredential } from '@/vc';
import { KnownVcs, workerCompatiblePexSelect } from '@/vc/known-vcs';
import { Validator } from '@cfworker/json-schema';
import { Offering, PayinMethod, PayoutMethod, Rfq, TbdexHttpClient } from '@tbdex/http-client';
import { PortableDid } from '@web5/dids';
import { drizzle } from 'drizzle-orm/d1';
import UssdMenu from 'ussd-builder';
import type { UssdModule } from '../';
import { generateOfferingDescription, getOfferingsByPayoutCurrencyCode } from './helpers';

const stateId = 'sendMoney';

export default {
	id: stateId,
	description: 'Send Money',
	handler: sendMoneyHandler,
} satisfies UssdModule;

function sendMoneyHandler(menu: UssdMenu, request: UssdRequest, env: Env) {
	menu.state(stateId, {
		run: buildRunHandler(async () => {
			// Fetch offerings grouped by payout currency code
			const offeringsByPayoutCurrencyCode = await getOfferingsByPayoutCurrencyCode(env, menu);

			// Show user available payout currencies
			buildContinueResponse(
				menu,
				'Where do you want to send money to?' +
					'\n\n' +
					Object.keys(offeringsByPayoutCurrencyCode)
						.map((key, index) => `${index + 1}. ${key}` + (currencyDescriptions[key] ? ` (${currencyDescriptions[key]})` : ''))
						.join('\n'),
				{ exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'*': async () => {
				try {
					const input = menu.val;
					const index = parseInt(input) - 1;

					const offeringsByPayoutCurrencyCode = await getOfferingsByPayoutCurrencyCode(env, menu);

					if (index < 0 || index >= Object.keys(offeringsByPayoutCurrencyCode).length) {
						// TODO: Show soft error
						return stateId;
					}

					const payoutCurrencyCode = Object.keys(offeringsByPayoutCurrencyCode)[index];

					await menu.session.set('payoutCurrencyCode', payoutCurrencyCode);

					return `${stateId}.selectPayinCurrency`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.selectPayinCurrency`, {
		run: buildRunHandler(async () => {
			console.log('running authenticated.sendMoney.selectPayinCurrency');
			const payoutCurrencyCode = await menu.session.get('payoutCurrencyCode');
			const offeringsByPayoutCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayoutCurrencyCode')) as Record<
				string,
				Offering[]
			>;

			// Fetch offerings that support the selected payout currency code
			const offerings = offeringsByPayoutCurrencyCode[payoutCurrencyCode];

			// Group offerings by payin currency code
			const offeringsByPayinCurrencyCode = offerings.reduce(
				(acc, curr) => {
					const payinCurrencyCode = curr.data.payin.currencyCode;
					if (!acc[payinCurrencyCode]) {
						acc[payinCurrencyCode] = [];
					}

					acc[payinCurrencyCode].push(curr);
					return acc;
				},
				{} as Record<string, Offering[]>,
			);

			// Write offerings to session
			await menu.session.set('offeringsByPayinCurrencyCode', JSON.stringify(offeringsByPayinCurrencyCode));

			buildContinueResponse(
				menu,
				'Where are you sending money from?' +
					'\n\n' +
					Object.keys(offeringsByPayinCurrencyCode)
						.map((key, index) => `${index + 1}. ${key}` + (currencyDescriptions[key] ? ` (${currencyDescriptions[key]})` : ''))
						.join('\n'),
				{ exit: true, back: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': stateId,
			'*': async () => {
				try {
					const input = menu.val;
					const index = parseInt(input) - 1;

					const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<
						string,
						Offering[]
					>;

					if (index < 0 || index >= Object.keys(offeringsByPayinCurrencyCode).length) {
						// TODO: Show soft error
						return `${stateId}.selectPayinCurrency`;
					}

					const payinCurrencyCode = Object.keys(offeringsByPayinCurrencyCode)[index];

					await menu.session.set('payinCurrencyCode', payinCurrencyCode);

					return `${stateId}.chooseOffering`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney.selectPayinCurrency next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.chooseOffering`, {
		run: buildRunHandler(async () => {
			console.log('running authenticated.sendMoney.chooseOffering');
			try {
				const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<
					string,
					Offering[]
				>;
				const payinCurrencyCode = await menu.session.get('payinCurrencyCode');
				const payoutCurrencyCode = await menu.session.get('payoutCurrencyCode');

				// Get offerings for selected payin and payout
				const offerings = offeringsByPayinCurrencyCode[payinCurrencyCode];

				// Write offerings to session
				await menu.session.set('offerings', JSON.stringify(offerings));

				buildContinueResponse(
					menu,
					`You are sending ${payinCurrencyCode} to ${payoutCurrencyCode}.\n` +
						'Choose an offering to proceed:\n' +
						'\n' +
						offerings.map((offering, index) => generateOfferingDescription(offering, index)).join('\n\n'),
					{ back: true, exit: true },
				);
			} catch (error) {
				console.error('Error in authenticated.sendMoney.chooseOffering', error);
				throw error;
			}
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.selectPayinCurrency`,
			'*': async () => {
				try {
					const index = parseInt(menu.val) - 1;

					const offerings = JSON.parse(await menu.session.get('offerings')) as Offering[];

					if (index < 0 || index >= offerings.length) {
						// TODO: Show soft error
						return menu.end('You have entered an invalid selection. Please try again.');
					}

					const chosenOffering = offerings[index];

					await menu.session.set('chosenOffering', JSON.stringify(chosenOffering));

					if (chosenOffering.data.payin.methods.length > 1) {
						return `${stateId}.choosePayinMethod`;
					}

					// Default to choosing the only available payin method
					const chosenPayinMethod = chosenOffering.data.payin.methods[0];

					await menu.session.set('chosenPayinMethod', JSON.stringify(chosenPayinMethod));

					if (chosenPayinMethod.requiredPaymentDetails && Object.keys(chosenPayinMethod.requiredPaymentDetails).length > 0) {
						return `${stateId}.specifyPayinMethodDetails`;
					}

					if (chosenOffering.data.payout.methods.length > 1) {
						return `${stateId}.choosePayoutMethod`;
					}

					// Default to choosing the only available payout method
					const chosenPayoutMethod = chosenOffering.data.payout.methods[0];

					await menu.session.set('chosenPayoutMethod', JSON.stringify(chosenPayoutMethod));

					if (chosenPayoutMethod.requiredPaymentDetails && Object.keys(chosenPayoutMethod.requiredPaymentDetails).length > 0) {
						return `${stateId}.specifyPayoutMethodDetails`;
					}

					return `${stateId}.specifyAmount`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney.chooseOffering next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.choosePayinMethod`, {
		run: buildRunHandler(async () => {
			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

			buildContinueResponse(
				menu,
				'Choose one of the supported payin methods to proceed.' +
					'\n\n' +
					offering.data.payin.methods.map((method, index) => `${index + 1}. ${makeHumanReadablePaymentMethod(method.kind)}`).join('\n'),
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				try {
					const index = parseInt(menu.val) - 1;

					const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

					if (index < 0 || index >= offering.data.payin.methods.length) {
						// TODO: Show soft error
						return menu.end('You have entered an invalid selection. Please try again.');
					}

					const chosenPayinMethod = offering.data.payin.methods[index];

					await menu.session.set('chosenPayinMethod', JSON.stringify(chosenPayinMethod));

					if (chosenPayinMethod.requiredPaymentDetails && Object.keys(chosenPayinMethod.requiredPaymentDetails).length > 0) {
						return `${stateId}.specifyPayinMethodDetails`;
					}

					return `${stateId}.choosePayoutMethod`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney.choosePayinMethod next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.specifyPayinMethodDetails`, {
		run: buildRunHandler(async () => {
			console.log('running authenticated.sendMoney.specifyPayinMethodDetails');
			const chosenPayinMethod = JSON.parse(await menu.session.get('chosenPayinMethod')) as PayinMethod;

			console.log('chosenPayinMethod', chosenPayinMethod);

			const properties = (chosenPayinMethod.requiredPaymentDetails as {
				properties: Record<string, { title: string; description: string; type: string }>;
			})!.properties;

			const formKey = `payinMethodDetails.${chosenPayinMethod.kind}`;
			await menu.session.set(formKey, {});
			await menu.session.set('payinMethodDetailsFormKey', formKey);
			await menu.session.set('payinMethodDetailsFormFirstValueKey', Object.keys(properties)[0]);

			const additionalFormFields = Object.entries(properties)
				.slice(1)
				.map(([key, detail], index) => ({
					key,
					label: `${index + 2}. ${detail.title} - ${detail.description}`,
				}));

			await menu.session.set('payinMethodDetailsFormAdditionalFields', JSON.stringify(additionalFormFields));

			return await buildContinueResponse(
				menu,
				`You need to provide the following details for the payment method you will pay from:` +
					'\n\n' +
					Object.entries(properties)
						.map(([, detail], index) => `${index + 1}. ${detail.title} - ${detail.description}`)
						.join('\n') +
					'\n\n' +
					`To begin, enter the value of "${Object.values(properties)[0].title}".`,
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				const input = menu.val;
				const formKey = await menu.session.get('payinMethodDetailsFormKey');
				const firstValueKey = await menu.session.get('payinMethodDetailsFormFirstValueKey');
				const chosenPayinMethod = JSON.parse(await menu.session.get('chosenPayinMethod')) as PayinMethod;

				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				const updatedFormValues = {
					...formValuesInSession,
					[firstValueKey]: input,
				};

				await menu.session.set(formKey, updatedFormValues);

				// Build form menu if there is more than one field to fill
				const additionalFormFields = JSON.parse(await menu.session.get('payinMethodDetailsFormAdditionalFields')) as {
					key: string;
					label: string;
				}[];
				if (additionalFormFields.length > 0) {
					const additionalFormFieldsEntryPoint = await buildFormMenu(menu, formKey, additionalFormFields, async (form) => {
						const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

						const updatedFormValues = {
							...formValuesInSession,
							...form,
						};

						await menu.session.set(formKey, updatedFormValues);

						// Validate form values
						if (chosenPayinMethod.requiredPaymentDetails) {
							const validator = new Validator(chosenPayinMethod.requiredPaymentDetails);
							const { valid, errors } = validator.validate(updatedFormValues);
							if (!valid) {
								console.log('payin method details are invalid', errors);
								await sessionErrors.set(
									menu,
									'The provided payin method details are invalid. Please try again.' +
										'\n' +
										errors.map((error) => `${error.keyword}: ${error.error}`).join('\n') +
										'\n',
								);
								return `${stateId}.specifyPayinMethodDetails`;
							} else {
								await sessionErrors.clear(menu);
							}
						}

						return `${stateId}.choosePayoutMethod`;
					});

					return additionalFormFieldsEntryPoint;
				}

				// Validate form values
				if (chosenPayinMethod.requiredPaymentDetails) {
					const validator = new Validator(chosenPayinMethod.requiredPaymentDetails);
					const { valid, errors } = validator.validate(updatedFormValues);
					if (!valid) {
						console.log('payin method details are invalid', errors);
						await sessionErrors.set(
							menu,
							'The provided payin method details are invalid. Please try again.' +
								'\n' +
								errors.map((error) => `${error.keyword}: ${error.error}`).join('\n') +
								'\n',
						);
						return `${stateId}.specifyPayinMethodDetails`;
					} else {
						await sessionErrors.clear(menu);
					}
				}

				return `${stateId}.choosePayoutMethod`;
			},
		},
	});

	menu.state(`${stateId}.choosePayoutMethod`, {
		run: buildRunHandler(async () => {
			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

			buildContinueResponse(
				menu,
				'Choose one of the following payout methods to proceed.' +
					'\n' +
					offering.data.payout.methods.map((method, index) => `${index + 1}. ${makeHumanReadablePaymentMethod(method.kind)}`).join('\n'),
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				try {
					const index = parseInt(menu.val) - 1;

					const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

					if (index < 0 || index >= offering.data.payout.methods.length) {
						// TODO: Show soft error
						return menu.end('You have entered an invalid selection. Please try again.');
					}

					const chosenPayoutMethod = offering.data.payout.methods[index];

					await menu.session.set('chosenPayoutMethod', JSON.stringify(chosenPayoutMethod));

					if (chosenPayoutMethod.requiredPaymentDetails && Object.keys(chosenPayoutMethod.requiredPaymentDetails).length > 0) {
						return `${stateId}.specifyPayoutMethodDetails`;
					}

					return `${stateId}.specifyAmount`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney.choosePayoutMethod next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.specifyPayoutMethodDetails`, {
		run: buildRunHandler(async () => {
			const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;

			const properties = (chosenPayoutMethod.requiredPaymentDetails as {
				properties: Record<string, { title: string; description: string; type: string }>;
			})!.properties;

			const formKey = `payoutMethodDetails.${chosenPayoutMethod.kind}`;
			await menu.session.set(formKey, {});
			await menu.session.set('payoutMethodDetailsFormKey', formKey);
			await menu.session.set('payoutMethodDetailsFormFirstValueKey', Object.keys(properties)[0]);

			const additionalFormFields = Object.entries(properties)
				.slice(1)
				.map(([key, detail], index) => ({
					key,
					label: `${index + 2}. ${detail.title} - ${detail.description}`,
				}));

			await menu.session.set('payoutMethodDetailsFormAdditionalFields', JSON.stringify(additionalFormFields));

			return await buildContinueResponse(
				menu,
				`You need to provide the following details for the payment method you will receive the funds to:` +
					'\n\n' +
					Object.entries(properties)
						.map(([, detail], index) => `${index + 1}. ${detail.title} - ${detail.description}`)
						.join('\n') +
					'\n\n' +
					`To begin, enter the ${Object.values(properties)[0].title} of the recipient.`,
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				const input = menu.val;
				const formKey = await menu.session.get('payoutMethodDetailsFormKey');
				const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;
				const firstValueKey = await menu.session.get('payoutMethodDetailsFormFirstValueKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				const updatedFormValues = {
					...formValuesInSession,
					[firstValueKey]: input,
				};

				await menu.session.set(formKey, updatedFormValues);

				// Build form menu if there is more than one field to fill
				const additionalFormFields = JSON.parse(await menu.session.get('payoutMethodDetailsFormAdditionalFields')) as {
					key: string;
					label: string;
				}[];

				if (additionalFormFields.length > 0) {
					const additionalFormFieldsEntryPoint = await buildFormMenu(menu, formKey, additionalFormFields, async (form) => {
						const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

						const updatedFormValues = {
							...formValuesInSession,
							...form,
						};

						await menu.session.set(formKey, updatedFormValues);

						// Validate form values
						if (chosenPayoutMethod.requiredPaymentDetails) {
							const validator = new Validator(chosenPayoutMethod.requiredPaymentDetails);
							const { valid, errors } = validator.validate(updatedFormValues);
							if (!valid) {
								console.log('payout method details are invalid', errors);
								await sessionErrors.set(
									menu,
									'The provided payin method details are invalid. Please try again.' +
										'\n' +
										errors.map((error) => `${error.keyword}: ${error.error}`).join('\n') +
										'\n',
								);
								return `${stateId}.specifyPayinMethodDetails`;
							} else {
								console.log('payout method details are valid', updatedFormValues, chosenPayoutMethod.requiredPaymentDetails);
								await sessionErrors.clear(menu);
							}
						}

						return `${stateId}.specifyAmount`;
					});

					return additionalFormFieldsEntryPoint;
				}

				// Validate form values
				if (chosenPayoutMethod.requiredPaymentDetails) {
					const validator = new Validator(chosenPayoutMethod.requiredPaymentDetails);
					const { valid, errors } = validator.validate(updatedFormValues);
					if (!valid) {
						console.log('payout method details are invalid', errors);
						await sessionErrors.set(
							menu,
							'The provided payin method details are invalid. Please try again.' +
								'\n' +
								errors.map((error) => `${error.keyword}: ${error.error}`).join('\n') +
								'\n',
						);
						return `${stateId}.specifyPayinMethodDetails`;
					} else {
						console.log('payout method details are valid', updatedFormValues, chosenPayoutMethod.requiredPaymentDetails);
						await sessionErrors.clear(menu);
					}
				}

				return `${stateId}.specifyAmount`;
			},
		},
	});

	menu.state(`${stateId}.specifyAmount`, {
		run: buildRunHandler(async () => {
			const error = await menu.session.get('specifyAmount.error');
			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
			const formKey = await menu.session.get('payoutMethodDetailsFormKey');
			const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

			return await buildContinueResponse(
				menu,
				[
					error && error + '\n',
					`Enter the amount you want to send in ${offering.data.payin.currencyCode}.`,
					offering.data.payin.min && `The minimum amount you can send is ${offering.data.payin.min} ${offering.data.payin.currencyCode}.`,
					offering.data.payin.max && `The maximum amount you can send is ${offering.data.payin.max} ${offering.data.payin.currencyCode}.`,
				]
					.filter(Boolean)
					.join('\n'),
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				const payinAmount = menu.val;
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				// Validate payin amount
				const payinAmountBigInt = BigInt(payinAmount);
				if (payinAmountBigInt < BigInt(offering.data.payin.min ?? 0)) {
					await sessionErrors.set(menu, 'The amount you entered is below the minimum allowed. Please try again.');
					return `${stateId}.specifyAmount`;
				} else {
					await sessionErrors.clear(menu);
				}

				if (offering.data.payin.max && payinAmountBigInt > BigInt(offering.data.payin.max)) {
					await sessionErrors.set(menu, 'The amount you entered is above the maximum allowed. Please try again.');
					return `${stateId}.specifyAmount`;
				} else {
					await sessionErrors.clear(menu);
				}

				await menu.session.set('payinAmount', payinAmount);

				if (!offering.data.requiredClaims) {
					return `${stateId}.requestQuote`;
				}

				const serializedUser = await menu.session.get('user');
				if (!serializedUser) {
					return menu.end('You are not logged in. Please login to continue.');
				}

				const user = JSON.parse(serializedUser) as User;
				const userCredentials = await getCustomerCredentials(env, user.id);

				console.log('offering.data.requiredClaims', offering.data.requiredClaims);

				// Validate user has required claims
				const selectedCredentials = workerCompatiblePexSelect({
					presentationDefinition: offering.data.requiredClaims,
					vcJwts: userCredentials,
				});

				// User has all required credentials
				if (selectedCredentials.length === offering.data.requiredClaims.input_descriptors.length) {
					return `${stateId}.requestQuote`;
				}

				return `${stateId}.validateCredentials`;
			},
		},
	});

	menu.state(`${stateId}.validateCredentials`, {
		run: buildRunHandler(async () => {
			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

			if (!offering.data.requiredClaims) {
				throw new Error('Offering does not require any claims');
			}

			const creatableCredentials = offering.data.requiredClaims.input_descriptors.filter((descriptor) =>
				KnownVcs.some((knownCredential) => knownCredential.id === descriptor.id),
			);

			// Some of the required credentials are not creatable
			if (
				creatableCredentials.length < offering.data.requiredClaims.input_descriptors.length ||
				// TODO: Add support for creating multiple credentials at once
				offering.data.requiredClaims.input_descriptors.length - creatableCredentials.length > 1
			) {
				// TODO: Show soft error
				return menu.end(
					'You do not have the required claims to proceed and we cannot create them for you. Contact an issuer to get the required credentials.',
				);
			}

			// All required credentials are creatable
			// Build claim creation form for one credential
			const creatableCredential = creatableCredentials[0];
			const knownCredential = KnownVcs.find((knownCredential) => knownCredential.id === creatableCredential.id)!;

			const claimCreationFormKey = 'claimCreationForm';
			await menu.session.set(claimCreationFormKey, {});
			await menu.session.set('creatableCredentialId', creatableCredential.id);
			await menu.session.set('claimCreationFormFirstValueKey', Object.keys(knownCredential.schema.shape)[0]);

			const additionalFormFields = Object.entries(knownCredential.schema.shape)
				.slice(1)
				.map(([key, detail], index) => {
					return {
						key,
						label: `${index + 2}. ${detail.description}`,
					};
				});

			await menu.session.set('claimCreationFormAdditionalFields', JSON.stringify(additionalFormFields));

			buildContinueResponse(
				menu,
				`To proceed with this offering, you need to provide the following details for the verifiable credential required by this PFI` +
					'\n\n' +
					Object.entries(knownCredential.schema.shape)
						.map(([key, detail], index) => `${index + 1}. ${detail.description}`)
						.join('\n') +
					'\n\n' +
					`To begin, enter the value of "${Object.values(knownCredential.schema.shape)[0].description}".`,
				{ back: true, exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.chooseOffering`,
			'*': async () => {
				const input = menu.val;
				const formKey = await menu.session.get('claimCreationFormKey');
				const firstValueKey = await menu.session.get('claimCreationFormFirstValueKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				await menu.session.set(formKey, {
					...formValuesInSession,
					[firstValueKey]: input,
				});

				// Build form menu if there is more than one field to fill
				const additionalFormFields = JSON.parse(await menu.session.get('claimCreationFormAdditionalFields')) as {
					key: string;
					label: string;
				}[];
				if (additionalFormFields.length > 0) {
					const additionalFormFieldsEntryPoint = await buildFormMenu(menu, formKey, additionalFormFields, async (form) => {
						const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

						await menu.session.set(formKey, {
							...formValuesInSession,
							...form,
						});

						return `${stateId}.createCredential`;
					});

					return additionalFormFieldsEntryPoint;
				}

				return `${stateId}.createCredential`;
			},
		},
	});

	menu.state(`${stateId}.createCredential`, {
		run: buildRunHandler(async () => {
			const formKey = await menu.session.get('claimCreationFormKey');
			const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;
			const creatableCredentialId = await menu.session.get('creatableCredentialId');

			const serializedUser = await menu.session.get('user');
			if (!serializedUser) {
				return menu.end('You are not logged in. Please login to continue.');
			}
			const user = JSON.parse(serializedUser) as User;
			const userDID = JSON.parse(user.did) as PortableDid;

			const credential = await createCredential(userDID.uri, creatableCredentialId, formValuesInSession);

			await saveCustomerCredential(env, user.id, credential);

			menu.go(`${stateId}.requestQuote`);
		}),
	});

	menu.state(`${stateId}.requestQuote`, {
		run: buildRunHandler(async () => {
			const amount = await menu.session.get('payinAmount');
			const db = drizzle(env.DB);

			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
			const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;
			const chosenPayinMethod = JSON.parse(await menu.session.get('chosenPayinMethod')) as PayinMethod;

			const payinMethodDetailsStorageKey = await menu.session.get('payinMethodDetailsFormKey');
			const payoutMethodDetailsStorageKey = await menu.session.get('payoutMethodDetailsFormKey');
			const payinMethodDetails = JSON.parse(await menu.session.get(payinMethodDetailsStorageKey)) as Record<string, string> | undefined;
			const payoutMethodDetails = JSON.parse(await menu.session.get(payoutMethodDetailsStorageKey)) as Record<string, string> | undefined;

			const serializedUser = await menu.session.get('user');
			if (!serializedUser) {
				return menu.end('You are not logged in. Please login to continue.');
			}

			const user = JSON.parse(serializedUser) as User;
			const userDID = JSON.parse(user.did) as PortableDid;
			const userCredentials = await getCustomerCredentials(env, user.id);
			const creditBalance = await fetchGoCreditBalance(db, user.id);

			if (creditBalance.balance < 1) {
				return menu.end(
					'You do not have enough transaction credits to perform this transaction.\n\nPlease buy more transaction credits to continue.',
				);
			}

			const selectedCredentials = offering.data.requiredClaims
				? workerCompatiblePexSelect({
						presentationDefinition: offering.data.requiredClaims,
						vcJwts: userCredentials,
					})
				: [];

			// Request quote
			const rfq = Rfq.create({
				metadata: {
					from: userDID.uri,
					to: offering.metadata.from,
					protocol: '1.0',
				},
				data: {
					offeringId: offering.metadata.id,
					payin: {
						amount: amount.toString(),
						kind: chosenPayinMethod.kind,
						paymentDetails: payinMethodDetails ?? {},
					},
					payout: {
						kind: chosenPayoutMethod.kind,
						paymentDetails: payoutMethodDetails ?? {},
					},
					claims: selectedCredentials,
				},
			});

			// Sign RFQ
			const userBearerDid = await resolveDID(env, userDID);
			await rfq.sign(userBearerDid);

			// Submit RFQ
			await TbdexHttpClient.createExchange(rfq);

			await db.insert(transactions).values({
				amount: amount.toString(),
				status: 'pending',
				user_id: user.id,
				pfiDid: offering.metadata.from,
				exchangeId: rfq.metadata.exchangeId,
				offeringId: rfq.data.offeringId,
				payinKind: rfq.data.payin.kind,
				payoutKind: rfq.data.payout.kind,
				createdAt: rfq.metadata.createdAt,
			});

			menu.end(
				"You're almost there!" +
					'\n\n' +
					`You have requested a quote for the conversion of ${amount} ${offering.data.payin.currencyCode} to ${offering.data.payout.currencyCode}` +
					'\n\n' +
					`The PFI is reviewing your request. You will receive a notification via SMS once the PFI responds with a quote.` +
					'\n\n' +
					`This transaction will cost you 1 credit if you accept the quote.` +
					'\n\n' +
					`Thank you for using tbDEX Go!`,
			);
		}),
	});

	return stateId;
}
