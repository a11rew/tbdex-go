import { OrderStatus } from '@tbdex/http-client';
import axios from 'axios';
import { DbQuote, DbTransaction, DbUser } from './db/schema';
import { formatDate, makeIDHumanReadable } from './utils';

function initSMSClient(env: Env) {
	const options = {
		apiKey: env.AT_API_KEY,
		username: env.AT_USERNAME,
		from: env.AT_SHORTCODE,
		format: 'application/x-www-form-urlencoded',
		accept: 'application/json',
	};

	const requestInstance = axios.create({
		baseURL: options.username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com',
		headers: {
			apiKey: options.apiKey,
			'Content-Type': 'application/x-www-form-urlencoded',
			accept: 'application/json',
		},
	});

	return {
		send: async (data: { to: string; message: string }) => {
			const requestData = {
				username: options.username,
				from: options.from,
				...data,
			};

			const response = await requestInstance.post('/version1/messaging', requestData);
			return response.data;
		},
	};
}

export async function publishSMS(env: Env, to: DbUser['phoneNumber'], message: string) {
	const sms = initSMSClient(env);

	return await sms.send({
		to,
		message,
	});
}

export async function publishQuoteNotificationSMS(
	env: Env,
	user: DbUser,
	quote: DbQuote,
	transaction: DbTransaction,
	creditBalance: number,
) {
	const sms = initSMSClient(env);

	const fee = quote.fee ? Number(quote.fee) : 0;
	const payinAmount = Number(quote.payinAmount) + fee;

	const message =
		`You have received a quote for transaction with ID ${makeIDHumanReadable(transaction.id)}.` +
		`\n\n` +
		`You will pay: ${payinAmount} ${quote.payinCurrency} (includes fee)` +
		`\n` +
		`You will receive: ${quote.payoutAmount} ${quote.payoutCurrency}` +
		`\n` +
		`Fee: ${fee} ${quote.payinCurrency}` +
		(quote.expiresAt ? `\nExpires at: ${formatDate(quote.expiresAt)}` : '') +
		`\n\n` +
		`Reply with "1" to accept this quote and place an order. Reply with "0" to reject the quote.` +
		`\n\n` +
		`This transaction will cost you 1 credit. Your remaining balance is ${creditBalance} credits.`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishOrderNotificationSMS(
	env: Env,
	user: DbUser,
	quote: DbQuote,
	transaction: DbTransaction,
	creditBalance: number,
) {
	const sms = initSMSClient(env);

	const fee = quote.fee ? Number(quote.fee) : 0;
	const payinAmount = Number(quote.payinAmount) + fee;

	const message =
		`You have successfully placed an order for transaction ${makeIDHumanReadable(transaction.id)}.` +
		`\n\n` +
		`You will pay: ${payinAmount} ${quote.payinCurrency} (includes fee)` +
		`\n` +
		`You will receive: ${quote.payoutAmount} ${quote.payoutCurrency}` +
		`\n` +
		`Fee: ${fee} ${quote.payinCurrency}` +
		`\n\n` +
		`This transaction cost you 1 credit. Your remaining Go Credit balance is ${creditBalance} credits.` +
		`\n\n` +
		`You will receive a notification when the transaction is completed.`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishCloseNotificationSMS(env: Env, user: DbUser, success: boolean, transaction: DbTransaction, reason?: string) {
	const sms = initSMSClient(env);

	const message = `Your transaction with ID ${makeIDHumanReadable(transaction.id)} has been ${success ? 'completed' : 'cancelled'}${reason ? `: ${reason}` : ''}.`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishStatusUpdateNotificationSMS(env: Env, user: DbUser, transaction: DbTransaction, status: OrderStatus) {
	const sms = initSMSClient(env);

	const message = `Your transaction with ID ${makeIDHumanReadable(transaction.id)} has received a status update: "${status.data.orderStatus.replace(/_/g, ' ')}"`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishRateTransactionSMS(env: Env, user: DbUser, transaction: DbTransaction) {
	const sms = initSMSClient(env);

	const message =
		`How was your experience using tbDEX Go for your transaction with ID ${makeIDHumanReadable(transaction.id)}? Reply 1, 2, 3, 4, or 5 to let us know.` +
		`\n\n` +
		`1. Very poor` +
		`\n` +
		`2. Unsatisfactory` +
		`\n` +
		`3. Average` +
		`\n` +
		`4. Very good` +
		`\n` +
		`5. Amazing!`;

	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}
