import { credentials, DbUser } from '@/db/schema';
import { PortableDid } from '@web5/dids';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { UssdModule } from '.';
import { buildContinueResponse, buildRunHandler } from '../builders';

const handler: UssdModule['handler'] = (menu, request, env, ctx) => {
	menu.state('profile', {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				'Manage your tbDEX Go profile' +
					'\n\n' +
					'1. View Profile Info' +
					'\n' +
					'2. Add or Update Payment Methods' +
					'\n' +
					'3. Manage Transaction PINs',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'0': 'user.registered',
			'#': '__exit__',
			'1': 'view-profile',
			'2': 'add-or-update-payment-methods',
			'3': 'manage-transaction-pins',
		},
	});

	menu.state('view-profile', {
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
			'0': 'profile',
			'00': 'user.registered',
		},
	});

	menu.state('add-or-update-payment-methods', {
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

	menu.state('manage-transaction-pins', {
		run: buildRunHandler(async () => {
			buildContinueResponse(
				menu,
				'Manage Transaction PINs' +
					'\n\n' +
					'You can set a transaction PIN to secure your tbDEX Go account from unauthorized access.' +
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
	id: 'profile',
	description: 'Manage Profile',
	handler,
} satisfies UssdModule;
