import { makeHumanReadablePaymentMethod } from '@/constants/descriptions';
import { PFIs } from '@/constants/pfis';
import { fetchSavedBeneficiaries } from '@/db/helpers';
import { DbUser } from '@/db/schema';
import { fetchPFIOfferings } from '@/pfis';
import { Offering, PayoutMethod } from '@tbdex/http-client';
import { drizzle } from 'drizzle-orm/d1';
import UssdMenu from 'ussd-builder';

export async function getOfferingsByPayoutCurrencyCode(env: Env, menu: UssdMenu) {
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

const BLOCK_INDENT = '&nbsp;'.repeat(4);
export function generateOfferingDescription(offering: Offering, index: number) {
	return (
		`${index + 1}. ${PFIs.find((pfi) => pfi.uri === offering.metadata.from)?.name ?? `PFI ...${offering.metadata.from.slice(-4)}`}\n` +
		`${BLOCK_INDENT}Send by ${offering.data.payin.methods.map((method) => makeHumanReadablePaymentMethod(method.kind)).join(', ')}\n` +
		`${BLOCK_INDENT}to ${offering.data.payout.methods.map((method) => makeHumanReadablePaymentMethod(method.kind)).join(', ')}\n` +
		`${BLOCK_INDENT}at 1 ${offering.data.payin.currencyCode} = ${offering.data.payoutUnitsPerPayinUnit} ${offering.data.payout.currencyCode}\n`
	);
}

export async function shouldNavigateToSelectSavedBeneficiary(env: Env, menu: UssdMenu): Promise<boolean> {
	const db = drizzle(env.DB);
	const user = JSON.parse(await menu.session.get('user')) as DbUser;
	const chosenPayoutMethod = JSON.parse(await menu.session.get('chosenPayoutMethod')) as PayoutMethod;
	const chosenOffering = JSON.parse(await menu.session.get('chosenOffering')) as Offering;

	const savedBeneficiaries = await fetchSavedBeneficiaries(db, user.id, chosenOffering, chosenPayoutMethod);

	return savedBeneficiaries.length > 0;
}
