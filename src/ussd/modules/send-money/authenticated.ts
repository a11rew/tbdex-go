import { fetchPFIOfferings } from '@/pfis';
import { UssdRequest } from '@/ussd';
import { Offering } from '@tbdex/http-client';
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
			'*': `${stateId}.selectPayinCurrency`,
		},
	});

	menu.state(`${stateId}.selectPayinCurrency`, {
		run: async () => {
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
		},
		next: {
			'*': `${stateId}.chooseOffering`,
		},
	});

	menu.state(`${stateId}.chooseOffering`, {
		run: async () => {
			const payinIndex = parseInt(menu.val) - 1;

			const offeringsByPayinCurrencyCode = JSON.parse(await menu.session.get('offeringsByPayinCurrencyCode')) as Record<string, Offering[]>;

			if (payinIndex < 0 || payinIndex >= Object.keys(offeringsByPayinCurrencyCode).length) {
				// TODO: Show soft error
				return menu.end('You have entered an invalid selection. Please try again.');
			}

			const payinCurrencyCode = Object.keys(offeringsByPayinCurrencyCode)[payinIndex];

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
		},
		next: {
			'*': `${stateId}.requestQuote`,
		},
	});

	menu.state(`${stateId}.requestQuote`, {
		run: async () => {
			const index = parseInt(menu.val) - 1;

			const offerings = JSON.parse(await menu.session.get('offerings')) as Offering[];

			if (index < 0 || index >= offerings.length) {
				// TODO: Show soft error
				return menu.end('You have entered an invalid selection. Please try again.');
			}

			const offering = offerings[index];

			// Validate user has required claims
			const requiredClaims = offering.data.requiredClaims?.input_descriptors;
			if (requiredClaims) {
				// TODO: Check if user has required claims
			}

			// Request quote
			menu.end(
				'Work in progress: Validate user has required claims (and create a claim if not) and request quote from PFI. \n\nCome back soon!',
			);
		},
		next: {
			'*': `${stateId}.requestQuote`,
		},
	});

	return stateId;
}
