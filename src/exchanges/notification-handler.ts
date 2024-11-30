import { fetchLatestQuote } from '@/db/helpers';
import { DbQuote, DbTransaction, DbUser, ratings, transactions, users } from '@/db/schema';
import { resolveDID } from '@/did';
import { publishSMS } from '@/sms';
import { makeIDHumanReadable } from '@/utils';
import { Close, Order, TbdexHttpClient } from '@tbdex/http-client';
import { BearerDid, PortableDid } from '@web5/dids';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { processClose, processOrder } from './helpers';

interface AfricasTalkingSMSNotification {
	linkId: string;
	text: string;
	from: string;
	to: string;
	date: string;
}

interface TwilioSMSNotification {
	ToCountry: string;
	ToState: string;
	SmsMessageSid: string;
	NumMedia: string;
	ToCity: string;
	FromZip: string;
	SmsSid: string;
	FromState: string;
	SmsStatus: string;
	FromCity: string;
	Body: string;
	FromCountry: string;
	To: string;
	ToZip: string;
	NumSegments: string;
	MessageSid: string;
	AccountSid: string;
	From: string;
	ApiVersion: string;
}

export async function handleSMSNotification(request: Request, env: Env, provider: 'africasTalking' | 'twilio'): Promise<Response> {
	const body = await request.formData();
	const formData = Object.fromEntries(body.entries());
	const decodedData = Object.fromEntries(Object.entries(formData).map(([key, value]) => [key, decodeURIComponent(value.toString())]));
	const notification = decodedData as unknown as AfricasTalkingSMSNotification | TwilioSMSNotification;

	const isAfricasTalking = provider === 'africasTalking';
	const from = isAfricasTalking ? (notification as AfricasTalkingSMSNotification).from : (notification as TwilioSMSNotification).From;
	const text = isAfricasTalking ? (notification as AfricasTalkingSMSNotification).text : (notification as TwilioSMSNotification).Body;

	const db = drizzle(env.DB);

	const [user] = await db.select().from(users).where(eq(users.phoneNumber, from));

	if (!user) {
		console.log('SMS Notification received for user that does not exist', notification);
		return new Response(null, { status: 200 });
	}

	const [transaction] = await db
		.select()
		.from(transactions)
		.where(eq(transactions.user_id, user.id))
		.orderBy(desc(transactions.createdAt))
		.limit(1);

	if (!transaction) {
		console.log('SMS Notification received for user with no transactions', notification);
		return new Response(null, { status: 200 });
	}

	if (transaction.status === 'quote') {
		console.log('SMS Notification received for quote', transaction.id);
		await handleQuoteResponse(env, user, transaction, text);
	} else if (transaction.status === 'complete') {
		console.log('SMS Notification received for complete', transaction.id);
		await handleRateTransactionResponse(env, user, transaction, text);
	}

	return new Response(null, { status: 200 });
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
		await publishSMS(
			env,
			user.phoneNumber,
			`Your quote for transaction ${makeIDHumanReadable(transaction.id)} has expired. Please request a new one.`,
		);
		return;
	}

	const userPortableDID = JSON.parse(user.did) as PortableDid;
	const userBearerDID = await resolveDID(env, userPortableDID);

	console.log(null, message);

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
	await publishSMS(
		env,
		user.phoneNumber,
		`Your request to place an order for transaction ${makeIDHumanReadable(transaction.id)} is being processed.`,
	);

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
			`There was an error submitting your order request for transaction ${makeIDHumanReadable(transaction.id)}. Please try again.`,
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
	await publishSMS(env, user.phoneNumber, `Your request to cancel transaction ${makeIDHumanReadable(transaction.id)} is being processed.`);

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
		await publishSMS(
			env,
			user.phoneNumber,
			`There was an error cancelling your transaction ${makeIDHumanReadable(transaction.id)}. Please try again.`,
		);
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
