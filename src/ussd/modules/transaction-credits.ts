import type { UssdModule } from '.';
import { buildContinueResponse, buildRunHandler } from '../builders';

const stateId = 'transaction-credits';

const handler: UssdModule['handler'] = (menu, request, env, ctx) => {
	menu.state(stateId, {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				'You have 10 free transaction credits left this month.\n\nCredits allow you to make transactions on tbDEX Go.' +
					'\n\n' +
					'1. Buy Transaction Credits',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': 'user.registered',
			'1': `${stateId}.buy-transaction-credits`,
		},
	});

	menu.state(`${stateId}.buy-transaction-credits`, {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				`After your free transfers, each transaction will cost 1 credit.` +
					`\n\n` +
					`1. Buy 10 Credits for $0.50` +
					`\n` +
					`2. Buy 50 Credits for $1.75` +
					`\n` +
					`3. Buy 100 Credits for $3`,
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': stateId,
			'1': `${stateId}.buy-credits`,
			'2': `${stateId}.buy-credits`,
			'3': `${stateId}.buy-credits`,
		},
	});

	menu.state(`${stateId}.buy-credits`, {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				'Buy credits' +
					'\n\n' +
					'Credits allow you to pay for transactions on tbDEX Go. Performing transactions on tbDEX Go draw credits from your account.' +
					'\n\n' +
					'Support for this feature is coming soon, until then enjoy sending money across currencies and borders for free!',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': stateId,
		},
	});
};

export default {
	id: stateId,
	description: 'Transaction Credits',
	handler,
} satisfies UssdModule;
