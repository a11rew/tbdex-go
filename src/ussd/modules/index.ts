import UssdMenu from 'ussd-builder';

import { getUserByPhoneNumber, registerUser } from '@/user';
import { UssdRequest } from '..';
import { buildRunHandler } from '../builders';
import profileModule from './profile';
import sendMoneyModule from './send-money';

export type UssdModule = {
	id: string;
	description: string;
	handler: (menu: UssdMenu, request: UssdRequest, env: Env, ctx: ExecutionContext) => void;
	nextHandler?: (menu: UssdMenu, request: UssdRequest, env: Env, ctx: ExecutionContext) => string | Promise<string>;
};

const modules = [sendMoneyModule, profileModule] satisfies UssdModule[];

export async function registerModules(menu: UssdMenu, request: UssdRequest, env: Env, ctx: ExecutionContext) {
	modules.forEach((module) => {
		module.handler(menu, request, env, ctx);
	});

	menu.state('user.registered', {
		run: buildRunHandler(() => {
			menu.con(
				'Welcome to tbDEX Go.\n\n' +
					'Choose an option below to continue:\n' +
					`1. ${sendMoneyModule.description}\n` +
					`2. ${profileModule.description}\n` +
					`3. See Transaction History\n` +
					`4. Transaction Credits\n` +
					`5. Help and Support\n\n` +
					`#. Exit`,
			);
		}),
		next: {
			1: sendMoneyModule.id,
			2: profileModule.id,
			3: 'transactionHistory',
			4: 'transactionCredits',
			5: 'helpAndSupport',
			'#': '__exit__',
		},
	});

	menu.state('user.not_registered', {
		run: buildRunHandler(() => {
			menu.con(
				'Welcome to tbDEX Go.\n\n' +
					'To get started, create or import your Decentralized ID (DID). Your DID allows you to send money across borders instantly and securely.\n\n' +
					'1. Create a New DID\n' +
					'2. Import Existing DID\n',
			);
		}),
		next: {
			1: 'createNewDID',
			2: 'importExistingDID',
		},
	});

	menu.state('createNewDID', {
		run: buildRunHandler(() => {
			menu.con(
				`We'll create a unique DID linked to your mobile number. You can access your DID from your profile anytime.\n\nYou'll be signed up to tbDEX Go using ${request.phoneNumber}.` +
					'\n\n1. Confirm' +
					'\n\n0. Go Back' +
					'\n#. Exit',
			);
		}),
		next: {
			1: async () => {
				try {
					await registerUser(env, request.phoneNumber);

					const user = await getUserByPhoneNumber(env, request.phoneNumber);
					await menu.session.set('user', user);

					return 'register.success';
				} catch (error) {
					console.error('Error in registerWithPhoneNumber', error);
					throw error;
				}
			},
			0: 'user.not_registered',
			'#': '__exit__',
		},
	});

	menu.state('register.success', {
		run: buildRunHandler(() => {
			menu.end(
				'Welcome to tbDEX go!' +
					'\n\nYou have been registered successfully.' +
					`\n\nDial ${request.serviceCode} to access tbDEX Go at any time.`,
			);
		}),
	});

	menu.state('importExistingDID', {
		run: buildRunHandler(() => {
			menu.con(
				`You chose to import an existing DID. \n\nWe currently do not have support for DID imports, check back soon!` +
					'\n\n0. Go Back' +
					'\n#. Exit',
			);
		}),
		next: {
			0: 'user.not_registered',
			'#': '__exit__',
		},
	});
}
