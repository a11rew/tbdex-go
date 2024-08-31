import type { UssdModule } from '.';

const handler: UssdModule['handler'] = (menu) => {
	menu.state('profile', {
		run: () => {
			menu.end('You chose to view your profile. We will add support for this soon.');
		},
	});
};

export default {
	id: 'profile',
	description: 'Profile',
	handler,
} satisfies UssdModule;
