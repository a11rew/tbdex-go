import { LocalKeyManager } from '@web5/crypto';
// import { AwsKeyManager } from '@web5/crypto-aws-kms';
import { BearerDid, DidDht, PortableDid } from '@web5/dids';

export async function resolveDID(env: Env, portableDID?: PortableDid) {
	let keyManager = new LocalKeyManager();

	// if (env.vars.ENVIRONMENT === 'development') {
	// 	keyManager = new LocalKeyManager();
	// } else {
	// 	keyManager = new AwsKeyManager();
	// }

	let did: BearerDid;

	if (portableDID) {
		// Import existing portable DID
		did = await DidDht.import({
			portableDid: portableDID,
			keyManager,
		});
	} else {
		// Create new portable DID
		did = await DidDht.create({
			keyManager,
		});
	}

	return did;
}
