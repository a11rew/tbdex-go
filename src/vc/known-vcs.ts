import { z } from 'zod';
export const KnownVcs = [
	{
		id: '73b86039-d07e-4f9a-9f3d-a8f7a8ec1635',
		schema: z.object({
			did: z.string().describe('DID of the issuer'),
			name: z.string().describe('Your full name'),
			country: z.string().describe("Your country of residence's ISO country code e.g. 'US', 'NG', 'GH'"),
		}),
		obtain: async ({ did, name, country }: { did: string; name: string; country: string }) => {
			const credentialResponse = await fetch(`https://mock-idv.tbddev.org/kcc?name=${name}&country=${country}&did=${did}`);
			return await credentialResponse.text();
		},
	},
];
