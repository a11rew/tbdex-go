import { credentials } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { KnownVcs } from './known-vcs';

export function getCredentialCreationRequirements(id: string) {
	const vcs = KnownVcs.find((vc) => vc.id === id);

	if (!vcs) {
		// TODO: Implement KCC flow
		throw new Error(
			'We do not have support for creating this verifiable credential from tbDex Go. Contact the issuer for details on obtaining this VC.',
		);
	}

	return vcs.schema;
}

export async function createCredential(id: string, data: Record<string, string>) {
	const vcs = KnownVcs.find((vc) => vc.id === id);

	if (!vcs) {
		throw new Error(
			'We do not have support for creating this verifiable credential from tbDex Go. Contact the issuer for details on obtaining this VC.',
		);
	}

	const parsedData = vcs.schema.parse(data);

	const vc = await vcs.obtain(parsedData);

	return vc;
}

export async function saveCustomerCredential(env: Env, userId: string, credential: string) {
	// TODO: Write to DWN
	const db = drizzle(env.DB);

	await db.insert(credentials).values({
		user_id: userId,
		vc: credential,
	});
}

export async function getCustomerCredentials(env: Env, userId: string) {
	// TODO: Read from DWN
	const db = drizzle(env.DB);

	console.log('user id', userId);

	const customerCredentials = await db.select().from(credentials).where(eq(credentials.user_id, userId));

	console.log('customer credentials', customerCredentials);

	return customerCredentials.map((credential) => credential.vc);
}
