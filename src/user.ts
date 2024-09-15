import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users } from './db/schema';
import { createDID, getBearerDID } from './did';

export async function registerUser(env: Env, phoneNumber: string) {
	const portableDID = await createDID(env);

	const db = drizzle(env.DB);
	await db.insert(users).values({
		phoneNumber,
		did: JSON.stringify(portableDID),
	});
}

export async function getUserByPhoneNumber(env: Env, phoneNumber: string) {
	const db = drizzle(env.DB);
	const [user] = await db.select().from(users).where(eq(users.phoneNumber, phoneNumber)).limit(1);

	console.log('user', user);

	if (user) {
		try {
			console.log('bearer did', await getBearerDID(env, JSON.parse(user.did)));
		} catch (error) {
			console.error('error resolving did', error);
		}
	}

	return user;
}
