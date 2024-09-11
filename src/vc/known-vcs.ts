import { PresentationDefinitionV2 } from '@web5/credentials';
import { decode } from 'jsonwebtoken';
import { get } from 'wild-wild-path';
import { z } from 'zod';

export const KnownVcs = [
	{
		id: '73b86039-d07e-4f9a-9f3d-a8f7a8ec1635',
		schema: z.object({
			name: z.string().describe('Full name'),
			country: z.string().describe("Country of residence's ISO country code e.g. 'US', 'NG', 'GH'"),
		}),
		obtain: async (did: string, { name, country }: { name: string; country: string }) => {
			const credentialResponse = await fetch(`https://mock-idv.tbddev.org/kcc?name=${name}&country=${country}&did=${did}`);
			return await credentialResponse.text();
		},
	},
];

// Cloudflare worker compatible version of PresentationExchange.selectCredentials
// Workers don't allow unsafe eval, so we need to implement a compatible version
export function workerCompatiblePexSelect({
	presentationDefinition,
	vcJwts,
}: {
	presentationDefinition: PresentationDefinitionV2;
	vcJwts: string[];
}) {
	const selectedVcs: string[] = [];

	for (const vcJwt of vcJwts) {
		const decodedJwt: any = decode(vcJwt);

		let matchesAllConstraints = true;

		for (const inputDescriptor of presentationDefinition.input_descriptors) {
			if (inputDescriptor.constraints?.fields) {
				for (const field of inputDescriptor.constraints.fields) {
					const path = field.path[0];
					const value = get(decodedJwt, path.replace(/\$\./g, ''));

					if (field.filter) {
						const filterValue = field.filter.const;

						const filterType = Object.keys(field.filter).filter(
							// exclude type
							(key) => key !== 'type',
						)[0];

						// only const is supported atm
						if (filterType !== 'const') {
							throw new Error('Only const filter type is supported');
						}

						if (value !== filterValue) {
							matchesAllConstraints = false;
						}
					}

					if (!matchesAllConstraints) break;
				}
			}

			if (!matchesAllConstraints) break;
		}

		if (matchesAllConstraints) {
			selectedVcs.push(vcJwt);
		}
	}

	return selectedVcs;
}
