import { transactions, User } from '@/db/schema';
import { resolveDID } from '@/did';
import { fetchPFIOfferings } from '@/pfis';
import { UssdRequest } from '@/ussd';
import { buildContinueResponseWithErrors, buildFormMenu, sessionErrors } from '@/ussd/builders';
import { createCredential, getCustomerCredentials, saveCustomerCredential } from '@/vc';
import { KnownVcs, workerCompatiblePexSelect } from '@/vc/known-vcs';
import { Validator } from '@cfworker/json-schema';
import { Offering, PayinMethod, PayoutMethod, Rfq, TbdexHttpClient } from '@tbdex/http-client';
import { PortableDid } from '@web5/dids';
import { drizzle } from 'drizzle-orm/d1';
import UssdMenu from 'ussd-builder';

const stateId = 'authenticated.sendMoney';

export function registerAuthenticatedSendMoney(menu: UssdMenu, request: UssdRequest, env: Env) {
	menu.state(stateId, {
		run: async () => {
			console.log('running authenticated.sendMoney');
			try {
				// Fetch offerings
				const { allOfferings } = await fetchPFIOfferings(env);

				// Group offerings by payout currency code
				const offeringsByPayoutCurrencyCode = allOfferings.reduce(
					(acc, curr) => {
						const payoutCurrencyCode = curr.data.payout.currencyCode;
						if (!acc[payoutCurrencyCode]) {
							acc[payoutCurrencyCode] = [];
						}
						acc[payoutCurrencyCode].push(curr);
						return acc;
					},
					{} as Record<string, Offering[]>,
				);

				// Write offerings to session
				await menu.session.set('offeringsByPayoutCurrencyCode', JSON.stringify(offeringsByPayoutCurrencyCode));

				// Show user available payout currencies
				menu.con(
					'What currency do you want to send?' +
						'\n' +
						Object.keys(offeringsByPayoutCurrencyCode)
							.map((key, index) => `${index + 1}. ${key}`)
							.join('\n'),
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				try {
					console.log('selectPayoutCurrency.next');
					const input = menu.val;
					const index = parseInt(input) - 1;

					const offeringsByPayoutCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayoutCurrencyCode')) as Record<
						string,
						Offering[]
					>;

					if (index < 0 || index >= Object.keys(offeringsByPayoutCurrencyCode).length) {
						// TODO: Show soft error
						return menu.end('You have entered an invalid selection. Please try again.');
					}

					const payoutCurrencyCode = Object.keys(offeringsByPayoutCurrencyCode)[index];

					await menu.session.set('payoutCurrencyCode', payoutCurrencyCode);

					console.log('payoutCurrencyCode', payoutCurrencyCode);

					return `${stateId}.selectPayinCurrency`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.selectPayinCurrency`, {
		run: async () => {
			console.log('running authenticated.sendMoney.selectPayinCurrency');
			try {
				const payoutCurrencyCode = await menu.session.get('payoutCurrencyCode');
				const offeringsByPayoutCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayoutCurrencyCode')) as Record<
					string,
					Offering[]
				>;

				console.log('selectPayinCurrency.payoutCurrencyCode', payoutCurrencyCode);

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

				menu.con(
					'What currency do you currently have (payin currency)?' +
						'\n' +
						Object.keys(offeringsByPayinCurrencyCode)
							.map((key, index) => `${index + 1}. ${key}`)
							.join('\n'),
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				try {
					console.log('selectPayinCurrency.next');
					const input = menu.val;
					const index = parseInt(input) - 1;

					const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<
						string,
						Offering[]
					>;

					console.log(stateId + '.offeringsByPayinCurrencyCode');

					if (index < 0 || index >= Object.keys(offeringsByPayinCurrencyCode).length) {
						// TODO: Show soft error
						return menu.end('You have entered an invalid selection. Please try again.');
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
		run: async () => {
			console.log('running authenticated.sendMoney.chooseOffering');
			try {
				const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<
					string,
					Offering[]
				>;
				const payinCurrencyCode = await menu.session.get('payinCurrencyCode');

				// Get offerings for selected payin and payout
				const offerings = offeringsByPayinCurrencyCode[payinCurrencyCode];

				// Write offerings to session
				await menu.session.set('offerings', JSON.stringify(offerings));

				menu.con(
					'Choose one of the following offerings to proceed.' +
						'\n' +
						offerings
							.map(
								(offering, index) =>
									`${index + 1}. ${offering.data.payin.currencyCode} -> ${offering.data.payout.currencyCode}` +
									`\nRate: ${offering.data.payoutUnitsPerPayinUnit}${offering.data.payin.currencyCode} per ${offering.data.payout.currencyCode}` +
									// Show available methods
									`\nPayin methods: ${offering.data.payin.methods.map((method) => method.kind).join(', ')}` +
									`\nPayout methods: ${offering.data.payout.methods.map((method) => method.kind).join(', ')}` +
									// Show required claims
									(offering.data.requiredClaims?.input_descriptors
										? `\nRequired claims: ${offering.data.requiredClaims.input_descriptors.map((descriptor) => descriptor.id).join(', ')}`
										: ''),
							)
							.join('\n'),
				);
			} catch (error) {
				console.error('Error in authenticated.sendMoney.chooseOffering', error);
				throw error;
			}
		},
		next: {
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

					return `${stateId}.choosePayinMethod`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney.chooseOffering next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.choosePayinMethod`, {
		run: async () => {
			console.log('running authenticated.sendMoney.choosePayinMethod');
			try {
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				menu.con(
					'Choose one of the following payin methods to proceed.' +
						'\n' +
						offering.data.payin.methods.map((method, index) => `${index + 1}. ${method.kind}`).join('\n'),
				);
			} catch (error) {
				console.error('Error in authenticated.sendMoney.choosePayinMethod', error);
				throw error;
			}
		},
		next: {
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
		run: async () => {
			console.log('running authenticated.sendMoney.specifyPayinMethodDetails');
			try {
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

				return await buildContinueResponseWithErrors(
					menu,
					`You need to provide the following details for the ${chosenPayinMethod.name ?? chosenPayinMethod.kind} payin method.` +
						'\n\n' +
						Object.entries(properties)
							.map(([, detail], index) => `${index + 1}. ${detail.title} - ${detail.description}`)
							.join('\n') +
						'\n\n' +
						`To begin, enter the value of "${Object.values(properties)[0].title}".`,
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
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
		run: async () => {
			console.log('running authenticated.sendMoney.choosePayoutMethod');
			try {
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				menu.con(
					'Choose one of the following payout methods to proceed.' +
						'\n' +
						offering.data.payout.methods.map((method, index) => `${index + 1}. ${method.kind}`).join('\n'),
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
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
		run: async () => {
			console.log('running authenticated.sendMoney.specifyPayoutMethodDetails');
			try {
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

				return await buildContinueResponseWithErrors(
					menu,
					`You need to provide the following details for the ${chosenPayoutMethod.name ?? chosenPayoutMethod.kind} payout method.` +
						'\n\n' +
						Object.entries(properties)
							.map(([, detail], index) => `${index + 1}. ${detail.title} - ${detail.description}`)
							.join('\n') +
						'\n\n' +
						`To begin, enter the ${Object.values(properties)[0].title} of the recipient.`,
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				console.log('running authenticated.sendMoney.specifyPayoutMethodDetails next');
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
		run: async () => {
			console.log('running authenticated.sendMoney.specifyAmount');
			try {
				const error = await menu.session.get('specifyAmount.error');
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
				const formKey = await menu.session.get('payoutMethodDetailsFormKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				console.log('formValuesInSession', formValuesInSession);

				return await buildContinueResponseWithErrors(
					menu,
					[
						error && error + '\n',
						`Enter the amount you want to send in ${offering.data.payin.currencyCode}.`,
						offering.data.payin.min && `The minimum amount you can send is ${offering.data.payin.min} ${offering.data.payin.currencyCode}.`,
						offering.data.payin.max && `The maximum amount you can send is ${offering.data.payin.max} ${offering.data.payin.currencyCode}.`,
					]
						.filter(Boolean)
						.join('\n'),
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
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
		run: async () => {
			try {
				console.log('running authenticated.sendMoney.validateCredentials');
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

				menu.con(
					`You need to provide the following details for the verifiable credential required by this PFI` +
						'\n\n' +
						Object.entries(knownCredential.schema.shape)
							.map(([key, detail], index) => `${index + 1}. ${detail.description}`)
							.join('\n') +
						'\n\n' +
						`To begin, enter the value of "${Object.values(knownCredential.schema.shape)[0].description}".`,
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
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
		run: async () => {
			console.log('running authenticated.sendMoney.createCredential');
			try {
				const formKey = await menu.session.get('claimCreationFormKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;
				const creatableCredentialId = await menu.session.get('creatableCredentialId');

				const serializedUser = await menu.session.get('user');
				if (!serializedUser) {
					return menu.end('You are not logged in. Please login to continue.');
				}
				const user = JSON.parse(serializedUser) as User;
				const userDID = JSON.parse(user.did) as PortableDid;

				console.log('formValuesInSession for credential creation', formValuesInSession);

				const credential = await createCredential(userDID.uri, creatableCredentialId, formValuesInSession);

				await saveCustomerCredential(env, user.id, credential);

				menu.go(`${stateId}.requestQuote`);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
	});

	menu.state(`${stateId}.requestQuote`, {
		run: async () => {
			console.log('running authenticated.sendMoney.requestQuote');
			try {
				const amount = await menu.session.get('payinAmount');

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

				const db = drizzle(env.DB);
				await db.insert(transactions).values({
					user_id: user.id,
					rfqId: rfq.metadata.id,
					exchangeId: rfq.metadata.exchangeId,
					offeringId: rfq.data.offeringId,
					payinMethod: rfq.data.payin.kind,
					payinKind: rfq.data.payin.kind,
					payoutMethod: rfq.data.payout.kind,
					payoutKind: rfq.data.payout.kind,
					amount: amount.toString(),
					status: 'pending',
					createdAt: rfq.metadata.createdAt,
				});

				menu.end(
					`You have requested a quote for ${amount} ${offering.data.payin.currencyCode} -> ${offering.data.payout.currencyCode}` +
						'\n\n' +
						`You will receive a notification via SMS when the PFI has accepted your request.`,
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
	});

	return stateId;
}
