import { LocalKeyManager } from '@web5/crypto';
import { BearerDid, DidDht, PortableDid } from '@web5/dids';

export async function resolveDID(portableDID?: PortableDid) {
	const keyManager = new LocalKeyManager();

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
