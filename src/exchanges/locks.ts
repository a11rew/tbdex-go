import { DbTransaction } from '@/db/schema';

export async function claimTransactionProcessingLocks(env: Env, transactions: DbTransaction[]) {
	const claimedTransactions: DbTransaction[] = [];

	await Promise.all(
		transactions.map(async (transaction) => {
			const txLock = await env.locks.get(`update-exchanges-lock.${transaction.id}`);
			if (!txLock) {
				await env.locks.put(`update-exchanges-lock.${transaction.id}`, 'true', {
					expirationTtl: 60 * 3, // 3 minutes
				});

				claimedTransactions.push(transaction);
			}
		}),
	);
	return claimedTransactions;
}

export async function releaseTransactionProcessingLocks(env: Env, transactions: DbTransaction[]) {
	await Promise.all(
		transactions.map(async (transaction) => {
			await env.locks.delete(`update-exchanges-lock.${transaction.id}`);
		}),
	);
}
