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
				await sendTransactionHistoryReport(env, menu.args.phoneNumber);
				return 'transaction-history.report-sent';
			},
		},
	});

	menu.state('transaction-history.report-sent', {
		run: buildRunHandler(() => {
			menu.end(`We have sent your transaction history to ${menu.args.phoneNumber}.`);
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

	console.log(message);

	await publishSMS(env, phoneNumber, message);
}
