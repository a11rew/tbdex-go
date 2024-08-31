import type { UssdModule } from '.';

const handler: UssdModule['handler'] = (menu) => {
	menu.state('sendMoney', {
		run: () => {
			menu.end('You chose to send money. We will add support for this soon.');
		},
	});
};

export default {
	id: 'sendMoney',
	description: 'Send Money',
	handler,
} satisfies UssdModule;
