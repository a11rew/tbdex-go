import { Quote } from '@tbdex/http-client';
import { desc, eq } from 'drizzle-orm';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import { DbNotification, DbTransaction, DbUser, notifications, quotes, transactions } from './schema';

export async function insertQuote(db: DrizzleD1Database, user: DbUser, transaction: DbTransaction, quote: Quote) {
	await db.insert(quotes).values({
		id: quote.metadata.id,
		user_id: user.id,
		transaction_id: transaction.id,
		exchangeId: quote.metadata.exchangeId,
		pfiDid: quote.metadata.from,
		payinAmount: quote.data.payin.amount,
		payinCurrency: quote.data.payin.currencyCode,
		payoutAmount: quote.data.payout.amount,
		payoutCurrency: quote.data.payout.currencyCode,
		expiresAt: quote.data.expiresAt,
	});
}

export async function updateTransactionStatus(db: DrizzleD1Database, transactionId: string, status: DbTransaction['status']) {
	await db.update(transactions).set({ status }).where(eq(transactions.id, transactionId));
}

export async function fetchTransaction(db: DrizzleD1Database, transactionId: string) {
	const [transaction] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1);
	return transaction;
}

export async function fetchQuote(db: DrizzleD1Database, quoteId: string) {
	const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
	return quote;
}

export async function fetchLatestQuote(db: DrizzleD1Database, transactionId: string) {
	const [quote] = await db.select().from(quotes).where(eq(quotes.transaction_id, transactionId)).orderBy(desc(quotes.createdAt)).limit(1);
	return quote;
}

export async function insertNotification(db: DrizzleD1Database, notification: DbNotification) {
	return await db.insert(notifications).values(notification);
}

export async function fetchNotification(db: DrizzleD1Database, notificationId: string) {
	const [notification] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
	return notification;
}
