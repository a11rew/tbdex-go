import type { UssdModule } from '../';
import { registerAuthenticatedSendMoney } from './authenticated';

const handler: UssdModule['handler'] = (menu, request, env) => {
	registerAuthenticatedSendMoney(menu, request, env);
};

export default {
	id: 'sendMoney',
	description: 'Send Money',
	handler,
} satisfies UssdModule;
