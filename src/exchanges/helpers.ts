import {
	addGoCreditTransaction,
	fetchGoCreditBalance,
	fetchLatestQuote,
	fetchNotification,
	fetchQuote,
	fetchTransaction,
	insertGoWalletTransaction,
	insertNotification,
	insertQuote,
	updateTransactionStatus,
} from '@/db/helpers';
import { DbTransaction, DbUser, transactions } from '@/db/schema';
import {
	publishCloseNotificationSMS,
	publishOrderNotificationSMS,
	publishQuoteNotificationSMS,
	publishRateTransactionSMS,
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
	const [updatedTransaction, writtenQuote, creditBalance] = await Promise.all([
		fetchTransaction(db, transaction.id),
		fetchQuote(db, quote.id),
		fetchGoCreditBalance(db, user.id),
	]);

	console.log('Received and processed quote for tx', transaction.id);

	await publishQuoteNotificationSMS(
		env,
		user,
		writtenQuote,
		updatedTransaction,
		// Don't show the credit balance for Go Wallet transactions
		updatedTransaction.type === 'regular' ? creditBalance.balance : null,
	);

	if (new Date(quote.data.expiresAt) < new Date()) {
		await updateTransactionStatus(db, transaction.id, 'cancelled');
	}
}

export async function processOrder(env: Env, user: DbUser, transaction: DbTransaction, orders: Order | Order[]) {
	if (!orders || (Array.isArray(orders) && orders.length === 0) || transaction.status !== 'quote') return;

	const db = drizzle(env.DB);

	const creditBalance = await fetchGoCreditBalance(db, user.id);

	if (creditBalance.balance < 1 && transaction.type === 'regular') {
		await updateTransactionStatus(db, transaction.id, 'cancelled');
		await publishCloseNotificationSMS(env, user, false, transaction, 'Insufficient Go Credit balance');
		return;
	}

	await updateTransactionStatus(db, transaction.id, 'order');

	if (transaction.type === 'regular') {
		// Decrement the user's Go Credit balance
		await addGoCreditTransaction(db, user.id, -1, `Order placed: ${transaction.id}`);
	}

	const [updatedTransaction, latestQuote] = await Promise.all([fetchTransaction(db, transaction.id), fetchLatestQuote(db, transaction.id)]);

	console.log('Received and processed order for tx', transaction.id);

	// We only publish the order notification if the transaction status has actually changed
	// This is to prevent duplicate notifications
	if (transaction.status !== updatedTransaction.status) {
		const newGoCreditBalance = await fetchGoCreditBalance(db, user.id);
		await publishOrderNotificationSMS(
			env,
			user,
			latestQuote,
			updatedTransaction,
			updatedTransaction.type === 'regular' ? newGoCreditBalance.balance : null,
		);
	}
}

export async function processClose(env: Env, user: DbUser, transaction: DbTransaction, closes: Close | Close[], quotes: Quote | Quote[]) {
	if (!closes || (Array.isArray(closes) && closes.length === 0) || (transaction.status !== 'order' && transaction.status !== 'quote'))
		return;

	const db = drizzle(env.DB);

	const close = Array.isArray(closes) ? closes[0] : closes;
	const quote = Array.isArray(quotes)
		? quotes.sort((a, b) => new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime())[0]
		: quotes;
	const isCancelled = close.data.success === false;

	await updateTransactionStatus(db, transaction.id, isCancelled ? 'cancelled' : 'complete');
	const updatedTransaction = await fetchTransaction(db, transaction.id);

	if (!isCancelled && ['wallet-in', 'wallet-out'].includes(updatedTransaction.type)) {
		// Create the Go wallet transaction
		await insertGoWalletTransaction(db, user.id, {
			sourceTransactionId: transaction.id,
			pfiDid: transaction.pfiDid,
			currencyCode: transaction.type === 'wallet-in' ? quote.data.payout.currencyCode : quote.data.payin.currencyCode,
			amount: Number(transaction.type === 'wallet-in' ? quote.data.payout.amount : quote.data.payin.amount),
			reference: `Order completed: ${transaction.id}`,
		});
	}

	console.log('Received and processed close for tx', transaction.id);

	// We only publish the close notification if the transaction status has actually changed
	// This is to prevent duplicate notifications
	if (transaction.status !== updatedTransaction.status) {
		await publishCloseNotificationSMS(
			env,
			user,
			!isCancelled,
			updatedTransaction,
			!isCancelled && updatedTransaction.type !== 'regular'
				? `${updatedTransaction.type === 'wallet-in' ? 'Credited' : 'Debited'} your Go Wallet`
				: undefined,
		);

		// Ask them to rate the transaction
		if (updatedTransaction.status === 'complete') {
			await publishRateTransactionSMS(env, user, updatedTransaction);
		}
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

		console.log('Received and processed status update for tx', transaction.id);

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
