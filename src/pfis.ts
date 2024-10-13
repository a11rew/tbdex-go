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
		await env.data_cache.put('pfi-offerings', JSON.stringify(fetchedOfferingsByPfiId));

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

export async function refreshPFIOfferings(env: Env) {
	console.log('Refreshing PFI offerings');
	// Check how long ago the offerings were last refreshed
	const lastRefreshed = await env.data_cache.get('pfi-offerings-last-refreshed');
	if (lastRefreshed && new Date().getTime() - new Date(lastRefreshed).getTime() < 60 * 60 * 1000) {
		console.log('PFI offerings were last refreshed less than an hour ago, so skipping refresh');
		// Offerings were last refreshed less than an hour ago, so don't refresh again
		return;
	}

	// Refresh offerings
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
	await env.data_cache.put('pfi-offerings', JSON.stringify(fetchedOfferingsByPfiId));
	// Cache last refresh time
	await env.data_cache.put('pfi-offerings-last-refreshed', new Date().toISOString());
	console.log('PFI offerings refreshed');
}
