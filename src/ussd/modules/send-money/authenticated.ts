import { User } from '@/db/schema';
import { fetchPFIOfferings } from '@/pfis';
import { UssdRequest } from '@/ussd';
import { buildFormMenu } from '@/ussd/builders';
import { getCustomerCredentials } from '@/vc';
import { Offering, PayinMethod, PayoutMethod, Rfq } from '@tbdex/http-client';
import { PresentationExchange } from '@web5/credentials';
import { PortableDid } from '@web5/dids';
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

					console.log('input', input);
					console.log('index', index);

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
				// console.log('selectPayinCurrency.offeringsByPayoutCurrencyCode', offeringsByPayoutCurrencyCode);

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

				menu.con(
					`You need to provide the following details for the ${chosenPayinMethod.name ?? chosenPayinMethod.kind} payin method.` +
						'\n\n' +
						Object.entries(properties)
							.map(([, detail], index) => `${index + 1}. ${detail.title} - ${detail.description}`)
							.join('\n') +
						'\n\n' +
						`To begin, enter the ${Object.values(properties)[0].title}.`,
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
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				await menu.session.set(formKey, {
					...formValuesInSession,
					[firstValueKey]: input,
				});

				// Build form menu if there is more than one field to fill
				const additionalFormFields = JSON.parse(await menu.session.get('payinMethodDetailsFormAdditionalFields')) as {
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

						return `${stateId}.choosePayoutMethod`;
					});

					return additionalFormFieldsEntryPoint;
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

				menu.con(
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
				const input = menu.val;
				const formKey = await menu.session.get('payoutMethodDetailsFormKey');
				const firstValueKey = await menu.session.get('payoutMethodDetailsFormFirstValueKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				await menu.session.set(formKey, {
					...formValuesInSession,
					[firstValueKey]: input,
				});

				// Build form menu if there is more than one field to fill
				const additionalFormFields = JSON.parse(await menu.session.get('payoutMethodDetailsFormAdditionalFields')) as {
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

						return `${stateId}.specifyAmount`;
					});

					return additionalFormFieldsEntryPoint;
				}

				return `${stateId}.specifyAmount`;
			},
		},
	});

	menu.state(`${stateId}.specifyAmount`, {
		run: async () => {
			console.log('running authenticated.sendMoney.specifyAmount');
			try {
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
				const formKey = await menu.session.get('payoutMethodDetailsFormKey');
				const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as Record<string, string>;

				console.log('formValuesInSession', formValuesInSession);

				menu.con(`Enter the amount you want to send in ${offering.data.payin.currencyCode}.`);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				await menu.session.set('payinAmount', menu.val);
				return `${stateId}.requestQuote`;
			},
		},
	});

	menu.state(`${stateId}.requestQuote`, {
		run: async () => {
			console.log('running authenticated.sendMoney.requestQuote');
			try {
				const amount = await menu.session.get('payinAmount');

				console.log('amount', amount);

				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
				const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;
				const chosenPayinMethod = JSON.parse(await menu.session.get('chosenPayinMethod')) as PayinMethod;

				const serializedUser = await menu.session.get('user');

				if (!serializedUser) {
					return menu.end('You are not logged in. Please login to continue.');
				}

				const user = JSON.parse(serializedUser) as User;

				if (offering.data.requiredClaims) {
					const userCredentials = await getCustomerCredentials(env, user.id);

					// Validate user has required claims
					const selectedCredentials = PresentationExchange.selectCredentials({
						presentationDefinition: offering.data.requiredClaims,
						vcJwts: userCredentials,
					});

					if (selectedCredentials.length < offering.data.requiredClaims.input_descriptors.length) {
						// TODO: Show soft error
						return menu.end(
							'You do not have the required claims to proceed and we cannot create them for you. Contact an issuer to get the required credentials.',
						);
					}
				}

				const userDID = JSON.parse(user.did) as PortableDid;

				// Request quote
				const rfq = Rfq.create({
					metadata: {
						from: userDID.uri,
						to: offering.metadata.from,
						protocol: '1.0',
					},
					data: {
						offeringId: offering.id,
						payin: {
							amount: amount.toString(),
							kind: chosenPayinMethod.kind,
							paymentDetails: {},
						},
						payout: {
							kind: chosenPayoutMethod.kind,
							paymentDetails: {},
							// chosenPayoutMethodPaymentDetails,
						},
					},
				});

				console.log('rfq', rfq);

				menu.end(
					'Work in progress: Validate user has required claims (and create a claim if not) and request quote from PFI. \n\nCome back soon!',
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				console.log('running authenticated.sendMoney.requestQuote next');
				console.log('input', menu.val);

				return '__exit__';
			},
		},
	});

	return stateId;
}
