import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { addGoCreditTransaction } from './db/helpers';
import { users } from './db/schema';
import { resolveDID } from './did';

export async function registerUser(env: Env, phoneNumber: string) {
	const did = await resolveDID(env);

	const portableDID = await did.export();

	const db = drizzle(env.DB);

	await db.insert(users).values({
		phoneNumber,
		did: JSON.stringify(portableDID),
	});

	const user = await getUserByPhoneNumber(env, phoneNumber);

	// Insert initial +5 credit transaction
	await addGoCreditTransaction(db, user.id, 5, 'Initial balance');
}

export async function getUserByPhoneNumber(env: Env, phoneNumber: string) {
	const db = drizzle(env.DB);
	const user = await db.select().from(users).where(eq(users.phoneNumber, phoneNumber)).limit(1);
	return user[0];
}
