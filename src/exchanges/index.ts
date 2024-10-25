import { DbTransaction, DbUser, transactions, users } from '@/db/schema';
import { resolveDID } from '@/did';
import { Close, Order, OrderStatus, Quote, Rfq, TbdexHttpClient } from '@tbdex/http-client';
import { BearerDid } from '@web5/dids';
import { and, eq, ne } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { processClose, processOrder, processOrderStatusUpdate, processQuote } from './helpers';
import { claimTransactionProcessingLocks, releaseTransactionProcessingLocks } from './locks';

export async function updateExchanges(env: Env) {
	const db = drizzle(env.DB);
	const startTime = Date.now();
	const oneMinute = 60 * 1000; // 60 seconds in milliseconds

	while (Date.now() - startTime < oneMinute) {
		let claimedTransactions: DbTransaction[] = [];

		try {
			// Fetch all uncompleted transactions
			const uncompletedTransactions = await db
				.select()
				.from(transactions)
				.where(and(ne(transactions.status, 'cancelled'), ne(transactions.status, 'complete')));
			if (uncompletedTransactions.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay
				continue;
			}

			// Claim processing locks on 100 transactions max per worker
			claimedTransactions = await claimTransactionProcessingLocks(env, uncompletedTransactions.slice(0, 100));
			if (claimedTransactions.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay
				continue;
			}

			// Process the claimed transactions
			const userIds = [...new Set(claimedTransactions.map((t) => t.user_id))];
			await processUserTransactions(env, db, userIds, claimedTransactions);
		} finally {
			// Release the locks on the claimed transactions
			await releaseTransactionProcessingLocks(env, claimedTransactions);
		}

		// Wait for 3 seconds before the next iteration
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
}

async function processUserTransactions(env: Env, db: DrizzleD1Database, userIds: string[], transactions: DbTransaction[]) {
	await Promise.all(
		userIds.map(async (userId) => {
			const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
			if (!user) return;

			const userBearerDID = await resolveDID(env, JSON.parse(user.did));
			const userTransactions = transactions.filter((t) => t.user_id === userId);
			const transactionsByPfiDid = groupTransactionsByPfiDid(userTransactions);

			const transactionExchangeMap = await fetchExchanges(userBearerDID, transactionsByPfiDid);

			await processExchanges(env, user, transactionExchangeMap, transactions);
		}),
	);
}

function groupTransactionsByPfiDid(transactions: DbTransaction[]) {
	return transactions.reduce(
		(acc, transaction) => {
			const pfiDid = transaction.pfiDid;
			if (!acc[pfiDid]) {
				acc[pfiDid] = [];
			}
			acc[pfiDid].push(transaction);
			return acc;
		},
		{} as Record<string, DbTransaction[]>,
	);
}

type ExchangeMap = {
	rfqs: Rfq[];
	quotes: Quote[];
	orders: Order[];
	statusUpdates: OrderStatus[];
	closes: Close[];
};

async function fetchExchanges(userBearerDID: BearerDid, transactionsByPfiDid: Record<string, DbTransaction[]>) {
	const transactionExchangeMap: Record<string, ExchangeMap> = {};
	await Promise.all(
		Object.entries(transactionsByPfiDid).map(async ([pfiDid, transactions]) => {
			const exchanges = await TbdexHttpClient.getExchanges({
				did: userBearerDID,
				pfiDid,
			});
			populateTransactionExchangeMap(transactionExchangeMap, exchanges as unknown as Message<unknown>[][], transactions);
		}),
	);
	return transactionExchangeMap;
}

function populateTransactionExchangeMap(map: Record<string, ExchangeMap>, exchanges: Message[][], transactions: DbTransaction[]) {
	exchanges.forEach((transactionExchanges) => {
		if (transactionExchanges.length === 0) return;

		const exchangeId = transactionExchanges[0].id;
		const transaction = transactions.find((t) => t.exchangeId === exchangeId);
		if (!transaction) return;

		map[transaction.id] = {
			rfqs: transactionExchanges.filter((m) => m instanceof Rfq),
			quotes: transactionExchanges.filter((m) => m instanceof Quote),
			orders: transactionExchanges.filter((m) => m instanceof Order),
			statusUpdates: transactionExchanges.filter((m) => m instanceof OrderStatus),
			closes: transactionExchanges.filter((m) => m instanceof Close),
		};
	});
}

async function processExchanges(
	env: Env,
	user: DbUser,
	transactionExchangeMap: Record<string, ExchangeMap>,
	transactions: DbTransaction[],
) {
	await Promise.all(
		Object.entries(transactionExchangeMap).map(async ([transactionId, exchangeMap]) => {
			let transaction = transactions.find((t) => t.id === transactionId);
			if (!transaction) {
				console.log('Tried to resolve statuses for transaction that does not exist', transactionId);
				return;
			}

			await processQuote(env, user, transaction, exchangeMap.quotes);
			await processOrder(env, user, transaction, exchangeMap.orders);
			await processOrderStatusUpdate(env, user, transaction, exchangeMap.statusUpdates);
			await processClose(env, user, transaction, exchangeMap.closes);
		}),
	);
}
