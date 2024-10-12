import { OrderStatus } from '@tbdex/http-client';
import axios from 'axios';
import { DbQuote, DbTransaction, DbUser } from './db/schema';

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
		`You have received a quote for transaction with ID ${transaction.id}.` +
		`\n\n` +
		`You will pay: ${payinAmount} ${quote.payinCurrency} (includes fee)` +
		`\n` +
		`You will receive: ${quote.payoutAmount} ${quote.payoutCurrency}` +
		`\n` +
		`Fee: ${fee} ${quote.payinCurrency}` +
		`\n` +
		`Expires at: ${quote.expiresAt}` + // TODO: Format date, human readable and relative to current time
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
		`You have successfully placed an order for transaction ${transaction.id}.` +
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

	const message = `Your transaction with ID ${transaction.id} has been ${success ? 'completed' : 'cancelled'}${reason ? `: ${reason}` : ''}.`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishStatusUpdateNotificationSMS(env: Env, user: DbUser, transaction: DbTransaction, status: OrderStatus) {
	const sms = initSMSClient(env);

	const message = `Your transaction with ID ${transaction.id} has received a status update: ${status.data.orderStatus}`;
	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}

export async function publishRateTransactionSMS(env: Env, user: DbUser, transaction: DbTransaction) {
	const sms = initSMSClient(env);

	const message =
		`Please rate your transaction with ID ${transaction.id}.` +
		`\n\n` +
		`Rating your experience with this PFI helps us improve our service.` +
		`\n\n` +
		`Reply with a number between 1 and 5 to rate the transaction.` +
		`\n` +
		`1 being a terrible experience and 5 being an excellent experience.`;

	const to = user.phoneNumber;

	return await sms.send({
		to,
		message,
	});
}
