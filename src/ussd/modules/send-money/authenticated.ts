import { User } from '@/db/schema';
import { fetchPFIOfferings } from '@/pfis';
import { UssdRequest } from '@/ussd';
import { getCustomerCredentials } from '@/vc';
import { Offering, PayinMethod, PayoutMethod, Rfq } from '@tbdex/http-client';
import { PresentationExchange } from '@web5/credentials';
import { PortableDid } from '@web5/dids';
import UssdMenu from 'ussd-builder';

const stateId = 'authenticated.sendMoney';

export function registerAuthenticatedSendMoney(menu: UssdMenu, request: UssdRequest, env: Env) {
	menu.state(stateId, {
		run: async () => {
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

				// Show user available payin currencies
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

				return `${stateId}.selectPayinCurrency`;
			},
		},
	});

	menu.state(`${stateId}.selectPayinCurrency`, {
		run: async () => {
			try {
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
				const input = menu.val;
				const index = parseInt(input) - 1;

				const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<
					string,
					Offering[]
				>;

				if (index < 0 || index >= Object.keys(offeringsByPayinCurrencyCode).length) {
					// TODO: Show soft error
					return menu.end('You have entered an invalid selection. Please try again.');
				}

				const payinCurrencyCode = Object.keys(offeringsByPayinCurrencyCode)[index];

				await menu.session.set('payinCurrencyCode', payinCurrencyCode);

				return `${stateId}.chooseOffering`;
			},
		},
	});

	menu.state(`${stateId}.chooseOffering`, {
		run: async () => {
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
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				const index = parseInt(menu.val) - 1;

				const offerings = JSON.parse(await menu.session.get('offerings')) as Offering[];

				if (index < 0 || index >= offerings.length) {
					// TODO: Show soft error
					return menu.end('You have entered an invalid selection. Please try again.');
				}

				const chosenOffering = offerings[index];

				await menu.session.set('chosenOffering', JSON.stringify(chosenOffering));

				return `${stateId}.choosePayinMethod`;
			},
		},
	});

	menu.state(`${stateId}.choosePayinMethod`, {
		run: async () => {
			try {
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				menu.con(
					'Choose one of the following payin methods to proceed.' +
						'\n' +
						offering.data.payin.methods.map((method, index) => `${index + 1}. ${method.kind}`).join('\n'),
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': async () => {
				const index = parseInt(menu.val) - 1;

				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				if (index < 0 || index >= offering.data.payin.methods.length) {
					// TODO: Show soft error
					return menu.end('You have entered an invalid selection. Please try again.');
				}

				const chosenPayinMethod = offering.data.payin.methods[index];

				await menu.session.set('chosenPayinMethod', JSON.stringify(chosenPayinMethod));

				return `${stateId}.choosePayoutMethod`;
			},
		},
	});

	menu.state(`${stateId}.choosePayoutMethod`, {
		run: async () => {
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
				const index = parseInt(menu.val) - 1;

				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				if (index < 0 || index >= offering.data.payout.methods.length) {
					// TODO: Show soft error
					return menu.end('You have entered an invalid selection. Please try again.');
				}

				const chosenPayoutMethod = offering.data.payout.methods[index];

				await menu.session.set('chosenPayoutMethod', JSON.stringify(chosenPayoutMethod));

				if (chosenPayoutMethod.requiredPaymentDetails) {
					return `${stateId}.specifyPayoutMethodDetails`;
				}

				return `${stateId}.specifyAmount`;
			},
		},
	});

	menu.state(`${stateId}.specifyPayoutMethodDetails`, {
		run: async () => {
			try {
				const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;

				const properties = Object.values(
					(chosenPayoutMethod.requiredPaymentDetails as {
						properties: Record<string, { title: string; description: string; type: string }>;
					})!.properties,
				);

				menu.con(
					`You need to provide the following details for the ${chosenPayoutMethod.kind} payout method.` +
						'\n\n' +
						properties.map((detail) => `${detail.title}: ${detail.description}`).join('\n') +
						'\n\n' +
						`TODO: Implement recursive menu for payout method details`,
				);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': `${stateId}.specifyAmount`,
		},
	});

	menu.state(`${stateId}.specifyAmount`, {
		run: async () => {
			try {
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

				menu.con(`Enter the amount you want to send in ${offering.data.payin.currencyCode}.`);
			} catch (error) {
				console.error(error);
				throw error;
			}
		},
		next: {
			'*': `${stateId}.requestQuote`,
		},
	});

	menu.state(`${stateId}.requestQuote`, {
		run: async () => {
			try {
				const amount = menu.val;

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
	});

	return stateId;
}
