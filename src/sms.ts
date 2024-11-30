import { OrderStatus } from '@tbdex/http-client';
import axios from 'axios';
import { DbQuote, DbTransaction, DbUser } from './db/schema';
import { formatDate, makeIDHumanReadable } from './utils';

function twilioSend(env: Env) {
	const token = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

	return async (data: { to: string; message: string }) => {
		try {
			const response = await axios.post(
				`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
				{
					From: env.TWILIO_PHONE_NUMBER,
					To: data.to,
					Body: data.message,
				},
				{
					headers: {
						Authorization: `Basic ${token}`,
						'content-type': 'application/x-www-form-urlencoded',
					},
				},
			);

			return response.data;
		} catch (error) {
			if (axios.isAxiosError(error)) {
				console.error('Error sending SMS', error.response?.data);
			} else {
				console.error('Error sending SMS', error);
			}

			throw error;
		}
	};
}

function atSend(env: Env) {
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

	return async (data: { to: string; message: string }) => {
		const requestData = {
			username: options.username,
			from: options.from,
			...data,
		};

		const response = await requestInstance.post('/version1/messaging', requestData);
		return response.data;
	};
}

async function initSMSClient(env: Env, phoneNumber: string) {
	const provider = await env.session_store.get(`user.provider.${phoneNumber}`);

	if (provider && provider !== 'africasTalking') {
		return twilioSend(env);
	}

	return atSend(env);
}

export async function publishSMS(env: Env, to: DbUser['phoneNumber'], message: string) {
	const sendSms = await initSMSClient(env, to);

	console.log('Publishing SMS to', to, message);

	return await sendSms({
		to,
		message,
	});
}

export function publishQuoteNotificationSMS(env: Env, user: DbUser, quote: DbQuote, transaction: DbTransaction, creditBalance: number) {
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

	return publishSMS(env, to, message);
}

export function publishOrderNotificationSMS(env: Env, user: DbUser, quote: DbQuote, transaction: DbTransaction, creditBalance: number) {
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

	return publishSMS(env, to, message);
}

export function publishCloseNotificationSMS(env: Env, user: DbUser, success: boolean, transaction: DbTransaction, reason?: string) {
	const message = `Your transaction with ID ${makeIDHumanReadable(transaction.id)} has been ${success ? 'completed' : 'cancelled'}${reason ? `: ${reason}` : ''}.`;
	const to = user.phoneNumber;

	return publishSMS(env, to, message);
}

export function publishStatusUpdateNotificationSMS(env: Env, user: DbUser, transaction: DbTransaction, status: OrderStatus) {
	const message = `Your transaction with ID ${makeIDHumanReadable(transaction.id)} has received a status update: "${status.data.orderStatus.replace(/_/g, ' ')}"`;
	const to = user.phoneNumber;

	return publishSMS(env, to, message);
}

export function publishRateTransactionSMS(env: Env, user: DbUser, transaction: DbTransaction) {
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

	return publishSMS(env, to, message);
}
