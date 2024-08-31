import type UssdMenu from 'ussd-menu-builder';

import profileModule from './profile';
import sendMoneyModule from './send-money';

export type UssdModule = {
	id: string;
	description: string;
	handler: (menu: UssdMenu) => void;
};

export default [sendMoneyModule, profileModule] satisfies UssdModule[];
