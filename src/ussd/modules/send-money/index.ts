import { currencyDescriptions, makeHumanReadablePaymentMethod } from '@/constants/descriptions';
import { fetchGoCreditBalance, fetchGoWalletBalances } from '@/db/helpers';
import { transactions, DbUser as User } from '@/db/schema';
import { resolveDID } from '@/did';
import { publishSMS } from '@/sms';
import { buildContinueResponse, buildFormMenu, buildRunHandler, sessionErrors } from '@/ussd/builders';
import { createCredential, getCustomerCredentials, saveCustomerCredential } from '@/vc';
import { KnownVcs, workerCompatiblePexSelect } from '@/vc/known-vcs';
import { Validator } from '@cfworker/json-schema';
import { Offering, PayinMethod, PayoutMethod, Rfq, TbdexHttpClient } from '@tbdex/http-client';
import { PortableDid } from '@web5/dids';
import { drizzle } from 'drizzle-orm/d1';
import UssdMenu from 'ussd-builder';
import type { UssdModule } from '../';
import { generateOfferingDescription, getOfferingsByPayinCurrencyCode, getOfferingsByPayoutCurrencyCode } from './helpers';

const stateId = 'sendMoney';

export default {
	id: `${stateId}.type`,
	description: 'Send Money',
	handler: (menu, env, ctx) => {
		menu.state(`${stateId}.type`, {
			run: buildRunHandler(async () => {
				buildContinueResponse(
					menu,
					'How do you want to send money?' +
						'\n\n' +
						'1. From your local payment method (Bank Account, Mobile Money, etc.)' +
						'\n' +
						'2. From your Go Wallet',
					{ back: true, exit: true },
				);
			}),
			next: {
				'#': '__exit__',
				'0': 'user.registered',
				'1': () => sendMoneyHandler(menu, env, ctx, 'regular'),
				'2': () => sendMoneyHandler(menu, env, ctx, 'wallet-out'),
			},
		});
	},
} satisfies UssdModule;

export function sendMoneyHandler(
	menu: UssdMenu,
	env: Env,
	ctx: ExecutionContext,
	type: 'regular' | 'wallet-in' | 'wallet-out' = 'regular',
) {
	menu.state(stateId, {
		run: buildRunHandler(async () => {
			// Count the number of occurrences of '*0' in the text
			const paginationIndex = (menu.args.text.match(/\*0/g) || []).length;

			// Fetch offerings grouped by payout currency code
			const offeringsByPayoutCurrencyCode = await getOfferingsByPayoutCurrencyCode(env, menu);
			let optionKeys = Object.keys(offeringsByPayoutCurrencyCode);

			if (type === 'wallet-in') {
				const offeringsByPayinCurrencyCode = await getOfferingsByPayinCurrencyCode(env, menu);

				// We only support adding funds for currencies that can be used as payin methods
				optionKeys = Object.keys(offeringsByPayinCurrencyCode).filter((code) => offeringsByPayinCurrencyCode[code].length > 0);

				// We only support adding funds for currencies that can be used as payouts
				optionKeys = optionKeys.filter((code) => offeringsByPayoutCurrencyCode[code] && offeringsByPayoutCurrencyCode[code].length > 0);
			}

			await menu.session.set(`${stateId}.optionKeys`, optionKeys);

			// Paginate offerings
			const PER_PAGE = 4;
			const startIndex = paginationIndex * PER_PAGE;
			const endIndex = (paginationIndex + 1) * PER_PAGE;
			const paginatedOptionKeys = startIndex < optionKeys.length ? optionKeys.slice(startIndex, endIndex) : optionKeys.slice(0, PER_PAGE);

			const hasMorePages = optionKeys.length > endIndex;

			const title = type === 'wallet-in' ? 'What currency do you want to add to your wallet?' : 'Where do you want to send money to?';

			// Show user available payout currencies
			buildContinueResponse(
				menu,
				title +
					'\n\n' +
					paginatedOptionKeys
						.map((key) => `${optionKeys.indexOf(key) + 1}. ${key}` + (currencyDescriptions[key] ? ` - ${currencyDescriptions[key]}` : ''))
						.join('\n') +
					(hasMorePages ? '\n\n0. More options' : ''),
				{ exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'*': async () => {
				try {
					const input = menu.val;
					const index = parseInt(input) - 1;
					const options: string[] = JSON.parse(await menu.session.get(`${stateId}.optionKeys`));

					if (index < 0 || index >= options.length) {
						// TODO: Show soft error
						return stateId;
					}

					const payoutCurrencyCode = options[index];
					await menu.session.set('payoutCurrencyCode', payoutCurrencyCode);

					return `${stateId}.selectPayinCurrency`;
				} catch (error) {
					console.error('Error in authenticated.sendMoney next', error);
					throw error;
				}
			},
		},
	});

	menu.state(`${stateId}.wallet-out`, {
		run: buildRunHandler(async () => {
			const db = drizzle(env.DB);

			const serializedUser = await menu.session.get('user');
			if (!serializedUser) {
				return menu.end('You are not logged in. Please login to continue.');
			}

			const user = JSON.parse(serializedUser) as User;

			// Confirm user has balances to spend, else let them know to add money
			const userBalances = await fetchGoWalletBalances(db, user.id);

			if (userBalances.length === 0) {
				return menu.end('You have no currency balances in your Go Wallet. \n\nAdd money from the "Go Wallet" menu to get started.');
			}

			const balanceMap = userBalances.reduce(
				(acc, curr) => {
					acc[curr.currency_code] = curr.balance;
					return acc;
				},
				{} as Record<string, number>,
			);

			const offeringKeys = Object.keys(balanceMap);

			await menu.session.set('wallet-out.choosePayinCurrency.optionKeys', offeringKeys);

			// Paginate offerings
			// Count the number of occurrences of '*0' in the text
			const paginationIndex = (menu.args.text.match(/\*0/g) || []).length;
			const PER_PAGE = 4;
			const startIndex = paginationIndex * PER_PAGE;
			const endIndex = (paginationIndex + 1) * PER_PAGE;
			const paginatedOfferingKeys =
				startIndex < offeringKeys.length ? offeringKeys.slice(startIndex, endIndex) : offeringKeys.slice(0, PER_PAGE);

			const hasMorePages = offeringKeys.length > endIndex;

			buildContinueResponse(
				menu,
				'Which currency balance do you want to send from?' +
					'\n\n' +
					paginatedOfferingKeys.map((key) => `${offeringKeys.indexOf(key) + 1}. ${key}`).join('\n') +
					(hasMorePages ? '\n\n0. More options' : ''),
				{ exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'*': async () => {
				const input = menu.val;
				const index = parseInt(input) - 1;
				const options: string[] = JSON.parse(await menu.session.get('wallet-out.choosePayinCurrency.optionKeys'));

				if (index < 0 || index >= options.length) {
					// TODO: Show soft error
					return stateId;
				}

				const payinCurrencyCode = options[index];
				console.log('payin currency code', payinCurrencyCode);
				await menu.session.set('payinCurrencyCode', payinCurrencyCode);

				return `${stateId}.wallet-out.choosePayoutCurrency`;
			},
		},
	});

	menu.state(`${stateId}.wallet-out.choosePayoutCurrency`, {
		run: buildRunHandler(async () => {
			const payinCurrencyCode = await menu.session.get('payinCurrencyCode');
			const offeringsByPayinCurrencyCode = await getOfferingsByPayinCurrencyCode(env, menu);
			const applicableOfferings = offeringsByPayinCurrencyCode[payinCurrencyCode];

			if (!applicableOfferings || applicableOfferings.length === 0) {
				return menu.end(
					`We cannot find any PFI offerings that support paying in the selected currency. \n\nWe're always expanding our PFI network. Please check again soon.`,
				);
			}

			const optionKeys = applicableOfferings.map((o) => o.data.payout.currencyCode);

			await menu.session.set('wallet-out.choosePayoutCurrency.optionKeys', optionKeys);

			// Paginate offerings
			// Count the number of occurrences of '*0' in the text
			const paginationIndex = (menu.args.text.match(/\*0/g) || []).length;
			const PER_PAGE = 4;
			const startIndex = paginationIndex * PER_PAGE;
			const endIndex = (paginationIndex + 1) * PER_PAGE;
			const paginatedOptionKeys = startIndex < optionKeys.length ? optionKeys.slice(startIndex, endIndex) : optionKeys.slice(0, PER_PAGE);

			const hasMorePages = optionKeys.length > endIndex;

			buildContinueResponse(
				menu,
				'Where do you want to send money to?' +
					'\n\n' +
					paginatedOptionKeys.map((key) => `${optionKeys.indexOf(key) + 1}. ${key}`).join('\n') +
					(hasMorePages ? '\n\n0. More options' : ''),
				{ exit: true },
			);
		}),
		next: {
			'#': '__exit__',
			'*': async () => {
				const input = menu.val;

				if (!input) {
					// TODO: Show soft error
					return stateId;
				}

				const index = parseInt(input) - 1;
				const options: string[] = JSON.parse(await menu.session.get('wallet-out.choosePayoutCurrency.optionKeys'));

				if (index < 0 || index >= options.length) {
					// TODO: Show soft error
					return stateId;
				}

				const payoutCurrencyCode = options[index];
				await menu.session.set('payoutCurrencyCode', payoutCurrencyCode);

				return `${stateId}.chooseOffering`;
			},
		},
	});

	menu.state(`${stateId}.selectPayinCurrency`, {
		run: buildRunHandler(async () => {
			const db = drizzle(env.DB);
			const user = JSON.parse(await menu.session.get('user')) as User;

			const payoutCurrencyCode = await menu.session.get('payoutCurrencyCode');
			const offeringsByPayoutCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayoutCurrencyCode')) as Record<
				string,
				Offering[]
			>;

			console.log('offeringsByPayoutCurrencyCode', offeringsByPayoutCurrencyCode);

			// Fetch offerings that support the selected payout currency code
			const offerings = offeringsByPayoutCurrencyCode[payoutCurrencyCode];

			console.log('offeringsByPayoutCurrencyCode', offeringsByPayoutCurrencyCode);
			console.log('offerings', offerings);
			console.log('type', type);
			console.log('payoutCurrencyCode', payoutCurrencyCode);

			// Group offerings by payin currency code
			const offeringsByPayinCurrencyCode =
				type === 'wallet-out'
					? (await fetchGoWalletBalances(db, user.id)).reduce(
							(acc, curr) => {
								const payinCurrencyCode = curr.currency_code;
								if (!acc[payinCurrencyCode]) {
									acc[payinCurrencyCode] = [];
								}

								const offering = offerings.find((o) => o.data.payin.currencyCode === payinCurrencyCode);

								if (offering) {
									acc[payinCurrencyCode].push(offering);
								}
								return acc;
							},
							{} as Record<string, Offering[]>,
						)
					: offerings.reduce(
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

			const title =
				type === 'wallet-in'
					? 'What currency do you currently have?'
					: type === 'wallet-out'
						? 'Which currency balance do you want to send from?'
						: 'Where are you sending money from?';

			buildContinueResponse(
				menu,
				title +
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
				let offerings = offeringsByPayinCurrencyCode[payinCurrencyCode];

				// Filter offerings by payout currency code if currency code is provided
				if (payoutCurrencyCode) {
					offerings = offerings.filter((o) => o.data.payout.currencyCode === payoutCurrencyCode);
				}

				// Write offerings to session
				await menu.session.set('offerings', JSON.stringify(offerings));

				const title =
					type === 'wallet-in'
						? `You are adding ${payoutCurrencyCode} to your wallet.`
						: `You are sending money from ${payinCurrencyCode} to ${payoutCurrencyCode}.`;

				buildContinueResponse(
					menu,
					`${title}\n` +
						'Choose an offering to proceed:\n' +
						'\n' +
						offerings.map((offering, index) => generateOfferingDescription(offering, index)).join('\n'),
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

					if (
						chosenOffering.data.payin.methods.length > 1 &&
						// In the case of wallet-out, we don't need to choose a payin method
						type !== 'wallet-out'
					) {
						return `${stateId}.choosePayinMethod`;
					}

					// Default to choosing the only available payin method
					const chosenPayinMethod = chosenOffering.data.payin.methods[0];

					await menu.session.set('chosenPayinMethod', JSON.stringify(chosenPayinMethod));

					if (
						// In the case of wallet-out, we don't need to specify payin method details
						type !== 'wallet-out' &&
						chosenPayinMethod.requiredPaymentDetails &&
						Object.keys(chosenPayinMethod.requiredPaymentDetails).length > 0
					) {
						return `${stateId}.specifyPayinMethodDetails`;
					}

					if (chosenOffering.data.payout.methods.length > 1) {
						if (type === 'wallet-in') {
							// Jump to specifying amount
							return `${stateId}.specifyAmount`;
						}

						return `${stateId}.choosePayoutMethod`;
					}

					// Default to choosing the only available payout method
					const chosenPayoutMethod = chosenOffering.data.payout.methods[0];

					await menu.session.set('chosenPayoutMethod', JSON.stringify(chosenPayoutMethod));

					if (chosenPayoutMethod.requiredPaymentDetails && Object.keys(chosenPayoutMethod.requiredPaymentDetails).length > 0) {
						if (type === 'wallet-in') {
							// Jump to specifying amount
							return `${stateId}.specifyAmount`;
						}

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

					if (type === 'wallet-in') {
						// Jump to specifying amount
						return `${stateId}.specifyAmount`;
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
					label: `${index + 2}. ${detail.title} (${detail.description})`,
				}));

			await menu.session.set('payinMethodDetailsFormAdditionalFields', JSON.stringify(additionalFormFields));

			return await buildContinueResponse(
				menu,
				`We need some details about your payin method:` +
					'\n\n' +
					`Enter the ${Object.values(properties)[0].title} (${Object.values(properties)[0].description}).`,
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

						if (type === 'wallet-in') {
							// Jump to specifying amount
							return `${stateId}.specifyAmount`;
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

				if (type === 'wallet-in') {
					// Jump to specifying amount
					return `${stateId}.specifyAmount`;
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
					'\n\n' +
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
					label: `${index + 2}. ${detail.title} (${detail.description})`,
				}));

			await menu.session.set('payoutMethodDetailsFormAdditionalFields', JSON.stringify(additionalFormFields));

			return await buildContinueResponse(
				menu,
				`We need some details about your payout method:` +
					'\n\n' +
					`Enter the ${Object.values(properties)[0].title} (${Object.values(properties)[0].description}).`,
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
			const db = drizzle(env.DB);

			const error = await menu.session.get('specifyAmount.error');
			const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

			const serializedUser = await menu.session.get('user');
			if (!serializedUser) {
				return menu.end('You are not logged in. Please login to continue.');
			}

			const user = JSON.parse(serializedUser) as User;
			const currencyCode = offering.data.payin.currencyCode;

			// If wallet-out, get balances
			const balances = type === 'wallet-out' ? await fetchGoWalletBalances(db, user.id) : undefined;
			const currencyBalance = balances?.find((balance) => balance.currency_code === currencyCode);

			const cta = type === 'wallet-in' ? 'add' : 'send';
			const max = (type === 'wallet-out' ? currencyBalance?.balance : offering.data.payin.max) ?? offering.data.payin.max;
			const min = offering.data.payin.min;

			return await buildContinueResponse(
				menu,
				[
					error && error + '\n',
					`Enter the amount you want to ${cta} in ${offering.data.payin.currencyCode}.`,
					min && `The minimum amount you can ${cta} is ${min} ${offering.data.payin.currencyCode}.`,
					max && `The maximum amount you can ${cta} is ${max} ${offering.data.payin.currencyCode}.`,
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
				const db = drizzle(env.DB);
				const payinAmount = menu.val;
				const offering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;
				const serializedUser = await menu.session.get('user');
				if (!serializedUser) {
					return menu.end('You are not logged in. Please login to continue.');
				}

				const user = JSON.parse(serializedUser) as User;
				const currencyCode = offering.data.payin.currencyCode;

				// If wallet-out, get balances
				const balances = type === 'wallet-out' ? await fetchGoWalletBalances(db, user.id) : undefined;
				const currencyBalance = balances?.find((balance) => balance.currency_code === currencyCode);
				const max = (type === 'wallet-out' ? currencyBalance?.balance : offering.data.payin.max) ?? offering.data.payin.max;
				const min = offering.data.payin.min;

				// Validate payin amount
				const payinAmountInt = Number(payinAmount);
				if (payinAmountInt < Number(min ?? 0)) {
					await sessionErrors.set(menu, 'The amount you entered is below the minimum allowed. Please try again.');
					return `${stateId}.specifyAmount`;
				} else {
					await sessionErrors.clear(menu);
				}

				if (max && payinAmountInt > Number(max)) {
					await sessionErrors.set(menu, 'The amount you entered is above the maximum allowed. Please try again.');
					return `${stateId}.specifyAmount`;
				} else {
					await sessionErrors.clear(menu);
				}

				await menu.session.set('payinAmount', payinAmount);

				if (!offering.data.requiredClaims) {
					return `${stateId}.requestQuote`;
				}

				const userCredentials = await getCustomerCredentials(env, user.id);

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
			await menu.session.set('claimCreationFormKey', claimCreationFormKey);
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
				`We need some details about you to create the verifiable credential required by this PFI:` +
					'\n\n' +
					`Please enter your ${Object.values(knownCredential.schema.shape)[0].description}.`,
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

						return `${stateId}.requestQuote`;
					});

					return additionalFormFieldsEntryPoint;
				}

				return `${stateId}.requestQuote`;
			},
		},
	});

	menu.state(`${stateId}.requestQuote`, {
		run: buildRunHandler(async () => {
			const [serializedUser, payinMethodDetailsString, payoutMethodDetailsString, claimCreationFormKey, creatableCredentialId] =
				await Promise.all([
					menu.session.get('user'),
					menu.session.get(await menu.session.get('payinMethodDetailsFormKey')),
					menu.session.get(await menu.session.get('payoutMethodDetailsFormKey')),
					menu.session.get('claimCreationFormKey'),
					menu.session.get('creatableCredentialId'),
				]);

			if (!serializedUser) {
				return menu.end('You are not logged in. Please login to continue.');
			}

			const db = drizzle(env.DB);
			const user = JSON.parse(serializedUser) as User;
			const userDID = JSON.parse(user.did) as PortableDid;

			const [
				amount,
				offering,
				chosenPayoutMethod,
				chosenPayinMethod,
				claimCreationFormValues,
				payinMethodDetails,
				payoutMethodDetails,
				creditBalance,
			] = await Promise.all([
				menu.session.get('payinAmount'),
				JSON.parse(await menu.session.get('chosenOffering')) as Offering,
				JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod | null,
				JSON.parse(await menu.session.get('chosenPayinMethod')) as PayinMethod | null,
				JSON.parse(await menu.session.get(claimCreationFormKey)) as Record<string, string>,
				payinMethodDetailsString ? (JSON.parse(payinMethodDetailsString) as Record<string, string>) : undefined,
				payoutMethodDetailsString ? (JSON.parse(payoutMethodDetailsString) as Record<string, string>) : undefined,
				fetchGoCreditBalance(db, user.id),
			]);

			if (type === 'regular' && creditBalance.balance < 1) {
				return menu.end(
					'You do not have enough transaction credits to perform this transaction.\n\nPlease buy more transaction credits to continue.',
				);
			}

			// Offloading this to the background because it might take a while
			// and USSD sessions have a short timeout
			ctx.waitUntil(
				(async () => {
					try {
						await publishSMS(
							env,
							user.phoneNumber,
							`You have requested a quote for the conversion of ${amount} ${offering.data.payin.currencyCode} to ${offering.data.payout.currencyCode}` +
								'\n\n' +
								`The PFI is reviewing your request. You will receive a notification via SMS once the PFI responds with a quote.` +
								'\n\n' +
								`This transaction will cost you 1 credit if you accept the quote.` +
								'\n\n' +
								`Thank you for using tbDEX Go!`,
						);

						if (creatableCredentialId) {
							const credential = await createCredential(userDID.uri, creatableCredentialId, claimCreationFormValues);

							await saveCustomerCredential(env, user.id, credential);
						}

						const userCredentials = await getCustomerCredentials(env, user.id);

						const selectedCredentials = offering.data.requiredClaims
							? workerCompatiblePexSelect({
									presentationDefinition: offering.data.requiredClaims,
									vcJwts: userCredentials,
								})
							: [];

						const payoutMethod = chosenPayoutMethod ?? offering.data.payout.methods[0];
						const payoutDetails = {
							amount: amount.toString(),
							currency: offering.data.payout.currencyCode,
							kind:
								type !== 'regular'
									? // Simulate stored balance transaction for wallet transfers
										(payoutMethod.kind ?? 'STORED_BALANCE')
									: chosenPayoutMethod!.kind,
							paymentDetails:
								type !== 'regular'
									? (payoutMethodDetails ??
										// These wouldn't be required in an actual stored balance transaction,
										// we'll simulate it by sending dummy values
										Object.fromEntries(
											(typeof payoutMethod.requiredPaymentDetails === 'object' && 'required' in payoutMethod.requiredPaymentDetails
												? payoutMethod.requiredPaymentDetails.required
												: []
											).map((key: string) => [key, 'STORED_BALANCE']),
										))
									: payoutMethodDetails,
						};

						const payinMethod = chosenPayinMethod ?? offering.data.payin.methods[0];
						const payinDetails = {
							amount: amount.toString(),
							currency: offering.data.payin.currencyCode,
							kind:
								type !== 'regular'
									? // Simulate stored balance transaction for wallet transfers
										(payinMethod.kind ?? 'STORED_BALANCE')
									: chosenPayinMethod!.kind,
							paymentDetails:
								type !== 'regular'
									? // Simulate stored balance transaction for wallet transfers
										(payinMethodDetails ??
										// These wouldn't be required in an actual stored balance transaction,
										// we'll simulate it by sending dummy values
										Object.fromEntries(
											(typeof payinMethod.requiredPaymentDetails === 'object' && 'required' in payinMethod.requiredPaymentDetails
												? payinMethod.requiredPaymentDetails.required
												: []
											).map((key: string) => [key, 'STORED_BALANCE']),
										))
									: payinMethodDetails,
						};

						const rfq = Rfq.create({
							metadata: {
								from: userDID.uri,
								to: offering.metadata.from,
								protocol: '1.0',
							},
							data: {
								offeringId: offering.metadata.id,
								payin: payinDetails,
								payout: payoutDetails,
								claims: selectedCredentials,
							},
						});

						const userBearerDid = await resolveDID(env, userDID);
						await rfq.sign(userBearerDid);

						await TbdexHttpClient.createExchange(rfq);

						await db.insert(transactions).values({
							amount: amount.toString(),
							status: 'pending',
							user_id: user.id,
							type,
							pfiDid: offering.metadata.from,
							exchangeId: rfq.metadata.exchangeId,
							offeringId: rfq.data.offeringId,
							payinKind: rfq.data.payin.kind,
							payoutKind: rfq.data.payout.kind,
							createdAt: rfq.metadata.createdAt,
						});

						await publishSMS(
							env,
							user.phoneNumber,
							`You have requested a quote for the conversion of ${amount} ${offering.data.payin.currencyCode} to ${offering.data.payout.currencyCode}` +
								'\n\n' +
								`The PFI is reviewing your request. You will receive a notification via SMS once the PFI responds with a quote.` +
								'\n\n' +
								`This transaction will cost you 1 credit if you accept the quote.` +
								'\n\n' +
								`Thank you for using tbDEX Go!`,
						);
					} catch (error) {
						console.error('Error in requestQuote', error);

						if (typeof error === 'object' && error !== null && 'details' in error) {
							console.error('Error details', JSON.stringify(error.details, null, 2));
						}

						throw error;
					}
				})(),
			);

			const message =
				type === 'regular'
					? `You have requested a quote for the conversion of ${amount} ${offering.data.payin.currencyCode} to ${offering.data.payout.currencyCode}`
					: type === 'wallet-out'
						? `You have requested a quote for the transfer of the ${offering.data.payout.currencyCode} equivalent of ${amount} ${offering.data.payin.currencyCode} to your recipient.`
						: `You have requested a quote for the addition of the ${offering.data.payout.currencyCode} equivalent of ${amount} ${offering.data.payin.currencyCode} to your wallet.`;

			menu.end("You're almost there!" + '\n\n' + message + '\n\n' + `You will receive further instructions via SMS.`);
		}),
	});

	return type === 'wallet-out' ? `${stateId}.wallet-out` : stateId;
}
