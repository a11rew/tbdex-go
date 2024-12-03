import { credentials, DbUser } from '@/db/schema';
import { PortableDid } from '@web5/dids';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { UssdModule } from '.';
import { buildContinueResponse, buildRunHandler } from '../builders';
import sendMoney from './send-money';

const stateId = 'go-wallet';

const handler: UssdModule['handler'] = (menu, env, ctx) => {
	menu.state(stateId, {
		run: buildRunHandler(async () => {
			buildContinueResponse(menu, 'Manage your tbDEX Go Wallet' + '\n\n' + '1. Add Money' + '\n' + '2. View Wallet Balance', {
				back: true,
				exit: true,
			});
		}),
		next: {
			'0': 'user.registered',
			'#': '__exit__',
			'1': () => sendMoney.handler(menu, env, ctx, 'wallet-in'),
			'2': () => `${stateId}.view-wallet-balance`,
		},
	});

	menu.state(`${stateId}.add-money`, {
		run: buildRunHandler(async () => {
			const db = drizzle(env.DB);

			const serializedUser = await menu.session.get('user');

			if (!serializedUser) {
				return menu.end('You are not registered. Please register to access this feature.');
			}

			const user = JSON.parse(serializedUser) as DbUser;
			const userPortableDID = JSON.parse(user.did) as PortableDid;

			const userCredentials = await db.select().from(credentials).where(eq(credentials.user_id, user.id));

			const LIST_BULLET = '•';
			buildContinueResponse(
				menu,
				`${LIST_BULLET} Mobile Number: ${user.phoneNumber}` +
					`\n` +
					`${LIST_BULLET} Your DID: <span style="word-wrap: break-word;">${userPortableDID.uri}</span>` +
					`\n` +
					`${LIST_BULLET} Default Payment Method: Not Set` +
					`\n` +
					`${LIST_BULLET} VCs: ${userCredentials.length}` +
					'\n\n' +
					'0. Back to Profile Menu' +
					'\n' +
					'00. Back to Main Menu',
			);
		}),
		next: {
			'0': 'go-wallet',
			'00': 'user.registered',
		},
	});

	menu.state(`${stateId}.view-wallet-balance`, {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				'Add or Update Payment Methods' +
					'\n\n' +
					'PFIs choose which payment methods you can use, but adding payment options beforehand will allow you to complete transactions faster. We will ask you for common payment methods and automatically provide them to PFIs where applicable.' +
					'\n\n' +
					'Support for this feature is coming soon.',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'0': 'profile',
			'#': '__exit__',
		},
	});
};

export default {
	id: 'go-wallet',
	description: 'Go Wallet',
	handler,
} satisfies UssdModule;
