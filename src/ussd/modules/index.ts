import UssdMenu from 'ussd-builder';

import { getUserByPhoneNumber, registerUser } from '@/user';
import { buildRunHandler } from '../builders';
import helpModule from './help';
import profileModule from './profile';
import sendMoneyModule from './send-money';
import transactionCreditsModule from './transaction-credits';
import transactionHistoryModule from './transaction-history';

export type UssdModule = {
	id: string;
	description: string;
	handler: (menu: UssdMenu, env: Env, ctx: ExecutionContext) => void;
	nextHandler?: (menu: UssdMenu, env: Env, ctx: ExecutionContext) => string | Promise<string>;
};

const modules = [sendMoneyModule, profileModule, transactionHistoryModule, transactionCreditsModule, helpModule] satisfies UssdModule[];

export async function registerModules(menu: UssdMenu, env: Env, ctx: ExecutionContext) {
	modules.forEach((module) => {
		module.handler(menu, env, ctx);
	});

	menu.state('user.registered', {
		run: buildRunHandler(() => {
			menu.con(
				'Welcome to tbDEX Go\n\n' +
					'Choose an option below to continue\n' +
					`1. ${sendMoneyModule.description}\n` +
					`2. ${profileModule.description}\n` +
					`3. ${transactionHistoryModule.description}\n` +
					`4. ${transactionCreditsModule.description}\n` +
					`5. ${helpModule.description}\n\n` +
					`#. Exit`,
			);
		}),
		next: {
			1: sendMoneyModule.id,
			2: profileModule.id,
			3: transactionHistoryModule.id,
			4: transactionCreditsModule.id,
			5: helpModule.id,
			'#': '__exit__',
		},
	});

	menu.state('user.not_registered', {
		run: buildRunHandler(() => {
			menu.con(
				'Welcome to tbDEX Go.\n\n' +
					'To get started, create or import your Decentralized ID (DID).\n\n' +
					// +'Your DID allows you to send money across borders instantly and securely.\n\n' +
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
				`We'll create a unique DID linked to your number (${menu.args.phoneNumber}). \n\nYou can access your DID from your profile anytime.` +
					'\n\n1. Confirm' +
					'\n\n0. Back' +
					'\n#. Exit',
			);
		}),
		next: {
			1: async () => {
				try {
					await registerUser(env, menu.args.phoneNumber);

					const user = await getUserByPhoneNumber(env, menu.args.phoneNumber);
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
					`\n\nDial ${menu.args.serviceCode ?? '*920*860#'} to access tbDEX Go and get started.`,
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
