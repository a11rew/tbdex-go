import { fetchLatestQuote } from '@/db/helpers';
import { DbQuote, DbTransaction, DbUser, ratings, transactions, users } from '@/db/schema';
import { resolveDID } from '@/did';
import { publishSMS } from '@/sms';
import { Close, Order, TbdexHttpClient } from '@tbdex/http-client';
import { BearerDid, PortableDid } from '@web5/dids';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { processClose, processOrder } from './helpers';

interface SMSNotification {
	linkId: string;
	text: string;
	from: string;
	to: string;
	date: string;
}

export async function handleSMSNotification(request: Request, env: Env): Promise<Response> {
	const body = await request.formData();
	const urlDecodedBody = Object.fromEntries(Array.from(body.entries()).map(([key, value]) => [key, decodeURIComponent(value.toString())]));
	const jsonBody = urlDecodedBody as unknown as SMSNotification;

	console.log('json body', jsonBody);

	if (jsonBody.to !== env.AT_SHORTCODE) {
		console.log('SMS Notification received for wrong shortcode', jsonBody);
		return new Response('SMS Notification received', { status: 200 });
	}

	const db = drizzle(env.DB);

	const [user] = await db.select().from(users).where(eq(users.phoneNumber, jsonBody.from));

	if (!user) {
		console.log('SMS Notification received for user that does not exist', jsonBody);
		return new Response('SMS Notification received', { status: 200 });
	}

	const [transaction] = await db
		.select()
		.from(transactions)
		.where(eq(transactions.user_id, user.id))
		.orderBy(desc(transactions.createdAt))
		.limit(1);

	if (!transaction) {
		console.log('SMS Notification received for user with no transactions', jsonBody);
		return new Response('SMS Notification received', { status: 200 });
	}

	if (transaction.status === 'quote') {
		await handleQuoteResponse(env, user, transaction, jsonBody.text);
	} else if (transaction.status === 'complete') {
		await handleRateTransactionResponse(env, user, transaction, jsonBody.text);
	}

	return new Response('SMS Notification received', { status: 200 });
}

async function handleQuoteResponse(env: Env, user: DbUser, transaction: DbTransaction, message: string) {
	const db = drizzle(env.DB);

	const quote = await fetchLatestQuote(db, transaction.id);
	if (!quote) {
		console.log('SMS Notification received for quote that does not exist', transaction.id);
		return;
	}

	if (quote.expiresAt && new Date(quote.expiresAt) < new Date()) {
		console.log('SMS Notification received for expired quote', transaction.id);
		await publishSMS(env, user.phoneNumber, `Your quote for transaction ${transaction.id} has expired. Please create a new one.`);
		return;
	}

	const userPortableDID = JSON.parse(user.did) as PortableDid;
	const userBearerDID = await resolveDID(env, userPortableDID);

	console.log('SMS Notification received', message);

	switch (message) {
		case '1':
			await submitOrder(env, user, transaction, quote, userPortableDID, userBearerDID);
			break;
		case '0':
			await cancelTransaction(env, user, transaction, quote, userPortableDID, userBearerDID);
			break;
		default:
			await publishSMS(env, user.phoneNumber, `Invalid response received. Please reply with "1" to accept the quote or "0" to reject it.`);
	}
}

async function submitOrder(
	env: Env,
	user: DbUser,
	transaction: DbTransaction,
	quote: DbQuote,
	userPortableDID: PortableDid,
	userBearerDID: BearerDid,
) {
	await publishSMS(env, user.phoneNumber, `Your request to place an order for transaction ${transaction.id} is being processed.`);

	try {
		const order = Order.create({
			metadata: {
				from: userPortableDID.uri,
				to: transaction.pfiDid,
				exchangeId: quote.exchangeId,
			},
		});

		await order.sign(userBearerDID);
		await TbdexHttpClient.submitOrder(order);

		await processOrder(env, user, transaction, order);
	} catch (error) {
		console.error('Error submitting order', error);
		await publishSMS(
			env,
			user.phoneNumber,
			`There was an error submitting your order request for transaction ${transaction.id}. Please try again.`,
		);
	}
}

async function cancelTransaction(
	env: Env,
	user: DbUser,
	transaction: DbTransaction,
	quote: DbQuote,
	userPortableDID: PortableDid,
	userBearerDID: BearerDid,
) {
	await publishSMS(env, user.phoneNumber, `Your request to cancel transaction ${transaction.id} is being processed.`);

	try {
		const close = Close.create({
			metadata: {
				from: userPortableDID.uri,
				to: transaction.pfiDid,
				exchangeId: quote.exchangeId,
			},
			data: {
				success: false,
				reason: 'User cancelled transaction',
			},
		});

		await close.sign(userBearerDID);
		await TbdexHttpClient.submitClose(close);

		// Publish close notification
		await processClose(env, user, transaction, close);
	} catch (error) {
		console.error('Error submitting close', error);
		await publishSMS(env, user.phoneNumber, `There was an error cancelling your transaction ${transaction.id}. Please try again.`);
	}
}

async function handleRateTransactionResponse(env: Env, user: DbUser, transaction: DbTransaction, message: string) {
	const db = drizzle(env.DB);

	const rating = parseInt(message);

	if (isNaN(rating) || rating < 1 || rating > 5) {
		await publishSMS(env, user.phoneNumber, `Invalid rating received. Please reply with a number between 1 and 5.`);
		return;
	}

	// Check if rating already exists
	const [existingRating] = await db.select().from(ratings).where(eq(ratings.transaction_id, transaction.id));
	if (existingRating) {
		console.warn('Rating already exists for transaction', transaction.id);
		// Silently return
		return;
	}

	await db.insert(ratings).values({
		transaction_id: transaction.id,
		rating,
	});

	await publishSMS(env, user.phoneNumber, `Thank you for rating your transaction and helping improve tbDEX Go.`);
}
