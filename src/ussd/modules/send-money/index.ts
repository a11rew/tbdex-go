import { getUserByPhoneNumber, registerUser } from '@/user';
import type { UssdModule } from '../';
import { registerAuthenticatedSendMoney } from './authenticated';

const nextHandler: UssdModule['nextHandler'] = async (menu, request, env) => {
	try {
		const user = await getUserByPhoneNumber(env, request.phoneNumber);

		if (user) {
			await menu.session.set('user', user);
			return 'authenticated.sendMoney';
		}

		return 'register';
	} catch (error) {
		console.error('Error in nextHandler', error);
		throw error;
	}
};

const handler: UssdModule['handler'] = (menu, request, env) => {
	menu.state('register', {
		run: () => {
			menu.con(
				'You are not a registered user. Choose one of the following registration options to use this service.' +
					'\n1. Register with a phone number' +
					'\n2. Register with a DID',
			);
		},
		next: {
			1: 'registerWithPhoneNumber',
			2: 'registerWithDid',
		},
	});

	menu.state('registerWithPhoneNumber', {
		run: () => {
			menu.con(
				'You chose to register with a phone number. We will create a DID for you. \n\nYou can always find the created DID in your profile. \n\n Confirm you want to register.' +
					'\n1. Confirm' +
					'\n2. Cancel',
			);
		},
		next: {
			1: async () => {
				try {
					await registerUser(env, request.phoneNumber);

					const user = await getUserByPhoneNumber(env, request.phoneNumber);
					await menu.session.set('user', user);

					return 'authenticated.sendMoney';
				} catch (error) {
					console.error('Error in registerWithPhoneNumber', error);
					throw error;
				}
			},
			2: '__exit__',
		},
	});

	menu.state('registerWithDid', {
		run: () => {
			menu.end('You chose to register with a DID. Adding support soon.');
		},
	});

	registerAuthenticatedSendMoney(menu, request, env);
};

export default {
	id: 'sendMoney',
	description: 'Send Money',
	handler,
	nextHandler,
} satisfies UssdModule;
