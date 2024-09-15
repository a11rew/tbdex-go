import {
	fetchLatestQuote,
	fetchNotification,
	fetchQuote,
	fetchTransaction,
	insertNotification,
	insertQuote,
	updateTransactionStatus,
} from '@/db/helpers';
import { DbTransaction, DbUser, transactions } from '@/db/schema';
import {
	publishCloseNotificationSMS,
	publishOrderNotificationSMS,
	publishQuoteNotificationSMS,
	publishStatusUpdateNotificationSMS,
} from '@/sms';
import { Close, Order, OrderStatus, Quote } from '@tbdex/http-client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

export async function processQuote(env: Env, user: DbUser, transaction: DbTransaction, quotes: Quote[]) {
	if (quotes.length === 0 || transaction.status !== 'pending') return;

	const db = drizzle(env.DB);

	const quote = quotes[0];
	await insertQuote(db, user, transaction, quote);
	await updateTransactionStatus(db, transaction.id, 'quote');
	const [updatedTransaction, writtenQuote] = await Promise.all([fetchTransaction(db, transaction.id), fetchQuote(db, quote.id)]);
	await publishQuoteNotificationSMS(env, user, writtenQuote, updatedTransaction);

	if (new Date(quote.data.expiresAt) < new Date()) {
		await updateTransactionStatus(db, transaction.id, 'cancelled');
	}
}

export async function processOrder(env: Env, user: DbUser, transaction: DbTransaction, orders: Order | Order[]) {
	if (!orders || (Array.isArray(orders) && orders.length === 0) || transaction.status !== 'quote') return;

	const db = drizzle(env.DB);

	await updateTransactionStatus(db, transaction.id, 'order');
	const [updatedTransaction, latestQuote] = await Promise.all([fetchTransaction(db, transaction.id), fetchLatestQuote(db, transaction.id)]);

	// We only publish the order notification if the transaction status has actually changed
	// This is to prevent duplicate notifications
	if (transaction.status !== updatedTransaction.status) {
		await publishOrderNotificationSMS(env, user, latestQuote, updatedTransaction);
	}
}

export async function processClose(env: Env, user: DbUser, transaction: DbTransaction, closes: Close | Close[]) {
	if (!closes || (Array.isArray(closes) && closes.length === 0) || (transaction.status !== 'order' && transaction.status !== 'quote'))
		return;

	const db = drizzle(env.DB);

	const close = Array.isArray(closes) ? closes[0] : closes;
	const isCancelled = close.data.success === false;

	await updateTransactionStatus(db, transaction.id, isCancelled ? 'cancelled' : 'complete');
	const updatedTransaction = await fetchTransaction(db, transaction.id);

	// We only publish the close notification if the transaction status has actually changed
	// This is to prevent duplicate notifications
	if (transaction.status !== updatedTransaction.status) {
		await publishCloseNotificationSMS(env, user, !isCancelled, updatedTransaction);
	}
}

export async function processOrderStatusUpdate(
	env: Env,
	user: DbUser,
	transaction: DbTransaction,
	statusUpdates: OrderStatus | OrderStatus[],
) {
	if (!statusUpdates || (Array.isArray(statusUpdates) && statusUpdates.length === 0) || transaction.status !== 'order') return;

	const db = drizzle(env.DB);

	const updates = Array.isArray(statusUpdates) ? statusUpdates : [statusUpdates];

	// Sort updates so the oldest is processed first
	const sortedUpdates = updates.sort((a, b) => new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime());

	for (const update of sortedUpdates) {
		const id = update.metadata.id;

		// Check if the notification already exists
		const existingNotification = await fetchNotification(db, id);

		if (existingNotification) return;

		await publishStatusUpdateNotificationSMS(env, user, transaction, update);

		await insertNotification(db, {
			id,
			user_id: user.id,
			transaction_id: transaction.id,
			type: 'status-update',
			data: JSON.stringify(update.data),
			created_at: update.metadata.createdAt,
		});
	}
}

export async function getTransactionHistory(env: Env, userId: string) {
	const db = drizzle(env.DB);

	const userTransactions = await db.select().from(transactions).where(eq(transactions.user_id, userId));

	return userTransactions;
}
