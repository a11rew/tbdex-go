import { makeHumanReadablePaymentMethod, toTitleCase } from '@/constants/descriptions';
import { getTransactionHistory } from '@/exchanges/helpers';
import { publishSMS } from '@/sms';
import { getUserByPhoneNumber } from '@/user';
import { formatDate, makeIDHumanReadable } from '@/utils';
import { UssdModule } from '.';
import { buildContinueResponse, buildRunHandler } from '../builders';

const stateId = 'transaction-history';

const handler: UssdModule['handler'] = (menu, env, ctx) => {
	menu.state(stateId, {
		run: buildRunHandler(async () => {
			await publishSMS(env, menu.args.phoneNumber, 'Sending transaction history report...');

			buildContinueResponse(
				menu,
				'Transaction History' +
					'\n\n' +
					`Request a transaction history report to be delivered to your number ${menu.args.phoneNumber} via SMS` +
					'\n\n' +
					'1. Confirm',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': 'user.registered',
			'1': async () => {
				try {
					return await sendTransactionHistoryReport(env, menu.args.phoneNumber);
				} catch (error) {
					console.error('Error sending transaction history report', error);
					return 'transaction-history.report-error';
				}
			},
		},
	});

	menu.state('transaction-history.report-sent', {
		run: buildRunHandler(() => {
			menu.end(
				`We have sent your transaction history to ${menu.args.phoneNumber}. You will receive a notification via SMS once the report is ready.`,
			);
		}),
	});

	menu.state('transaction-history.no-transactions', {
		run: buildRunHandler(() => {
			menu.end('You have not made any transactions yet.');
		}),
	});

	menu.state('transaction-history.report-error', {
		run: buildRunHandler(() => {
			menu.end('An error occurred while sending your transaction history report. Please try again later.');
		}),
	});
};

export default {
	id: stateId,
	description: 'Transaction History',
	handler,
} satisfies UssdModule;

async function sendTransactionHistoryReport(env: Env, phoneNumber: string) {
	const user = await getUserByPhoneNumber(env, phoneNumber);

	const transactionHistory = await getTransactionHistory(env, user.id);

	if (transactionHistory.length === 0) {
		return 'transaction-history.no-transactions';
	}

	const message =
		`Transaction History for ${user.phoneNumber}` +
		'\n\n' +
		transactionHistory
			.map((tx, idx) =>
				[
					`${idx + 1}. Transaction ID: (${makeIDHumanReadable(tx.id)}) - ${tx.id}`,
					`Created at: ${formatDate(tx.createdAt)}`,
					`Payin method: ${makeHumanReadablePaymentMethod(tx.payinKind)}`,
					`Payout method: ${makeHumanReadablePaymentMethod(tx.payoutKind)}`,
					`Status: ${toTitleCase(tx.status)}`,
				].join('\n'),
			)
			.join('\n\n') +
		'\n\n' +
		'Thank you for using tbDEX Go!';

	await publishSMS(env, phoneNumber, message);

	return 'transaction-history.report-sent';
}
