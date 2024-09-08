import { Offering, TbdexHttpClient } from '@tbdex/http-client';
import { PFIs } from './constants/pfis';

export async function fetchPFIOfferings(env: Env) {
	let offeringsByPfiId: Record<string, Offering[]> | null = null;

	// Check if we have cached offerings
	const cachedOfferings = await env.data_cache.get('pfi-offerings');
	if (cachedOfferings) {
		offeringsByPfiId = JSON.parse(cachedOfferings);
	} else {
		// Fetch offerings
		const fetchedOfferings = await Promise.all(
			PFIs.map((pfi) =>
				TbdexHttpClient.getOfferings({ pfiDid: pfi.uri }).then((offerings) => ({
					pfi,
					offerings,
				})),
			),
		);

		// Group by PFI ID
		const fetchedOfferingsByPfiId = fetchedOfferings.reduce(
			(acc, curr) => {
				acc[curr.pfi.id] = curr.offerings;
				return acc;
			},
			{} as Record<string, Offering[]>,
		);

		// Cache offerings
		await env.data_cache.put('pfi-offerings', JSON.stringify(fetchedOfferingsByPfiId), {
			expirationTtl: 60 * 60, // 1 hour
		});

		offeringsByPfiId = fetchedOfferingsByPfiId;
	}

	if (!offeringsByPfiId) {
		throw new Error('No offerings found');
	}

	// For convenience, group into single array of all offerrings
	const allOfferings = Object.values(offeringsByPfiId).flat();

	return {
		offeringsByPfiId,
		allOfferings,
	};
}
