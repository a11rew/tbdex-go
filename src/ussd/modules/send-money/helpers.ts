import { PFIs } from '@/constants/pfis';
import { fetchPFIOfferings } from '@/pfis';
import { Offering } from '@tbdex/http-client';
import UssdMenu from 'ussd-builder';

export async function getOfferingsByPayoutCurrencyCode(env: Env, menu: UssdMenu): Promise<Record<string, Offering[]>> {
	// Check if offerings are cached
	const cachedOfferings = await menu.session.get('offeringsByPayoutCurrencyCode');
	if (cachedOfferings) {
		return JSON.parse(cachedOfferings);
	}

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

	return offeringsByPayoutCurrencyCode;
}

export async function getOfferingsByPayinCurrencyCode(env: Env, menu: UssdMenu): Promise<Record<string, Offering[]>> {
	// Check if offerings are cached
	const cachedOfferings = await menu.session.get('offeringsByPayinCurrencyCode');
	if (cachedOfferings) {
		return JSON.parse(cachedOfferings);
	}

	const { allOfferings } = await fetchPFIOfferings(env);

	const offeringsByPayinCurrencyCode = allOfferings.reduce(
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

	return offeringsByPayinCurrencyCode;
}

const BLOCK_INDENT = '';
// '&nbsp;'.repeat(4);
export function generateOfferingDescription(offering: Offering, index: number) {
	return (
		`${index + 1}. ${PFIs.find((pfi) => pfi.uri === offering.metadata.from)?.name ?? `PFI ...${offering.metadata.from.slice(-4)}`}\n` +
		// `${BLOCK_INDENT}Send by ${offering.data.payin.methods.map((method) => makeHumanReadablePaymentMethod(method.kind)).join(', ')}\n` +
		// `${BLOCK_INDENT}to ${offering.data.payout.methods.map((method) => makeHumanReadablePaymentMethod(method.kind)).join(', ')}\n` +
		`${BLOCK_INDENT}at 1 ${offering.data.payin.currencyCode} = ${offering.data.payoutUnitsPerPayinUnit} ${offering.data.payout.currencyCode}`
	);
}
