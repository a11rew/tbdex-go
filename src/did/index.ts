import { AlreadyExistsException, KMSClient } from '@aws-sdk/client-kms';
import { BearerDid, DidDht, PortableDid } from '@web5/dids';
import { FetchHttpHandler } from './aws-fetch-handler';
import { AwsKeyManager } from './aws-kms';

export async function createDID(env: Env): Promise<PortableDid> {
	const keyManager = getKeyManager(env);

	const did = await DidDht.create({
		keyManager,
		options: {
			verificationMethods: [
				{
					id: '0',
					algorithm: 'ES256K',
					purposes: ['authentication', 'assertionMethod', 'capabilityDelegation', 'capabilityInvocation'],
				},
			],
		},
	});

	return did.export();
}

export async function getBearerDID(env: Env, portableDid: PortableDid): Promise<BearerDid> {
	const keyManager = getKeyManager(env);

	// If we have private keys in the portable did, we need to import them into the key manager
	if (portableDid.privateKeys && portableDid.privateKeys.length > 0) {
		for (const key of portableDid.privateKeys) {
			try {
				await keyManager.importKey({
					key,
				});
			} catch (error) {
				// For backwards compatibility, we ignore AlreadyExistsException errors
				if (error instanceof AlreadyExistsException) {
					continue;
				}

				throw error;
			}
		}

		// Remove the private keys from the portable did
		portableDid.privateKeys = undefined;
	}

	const did = await DidDht.import({
		portableDid,
		keyManager,
	});

	return did;
}

function getKeyManager(env: Env) {
	const kms = new KMSClient({
		region: 'us-east-1',
		credentials: {
			accessKeyId: env.AWS_ACCESS_KEY_ID,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
		},
		requestHandler: FetchHttpHandler.create(),
	});

	const keyManager = new AwsKeyManager({
		kmsClient: kms,
	});

	return keyManager;
}
