import type UssdMenu from 'ussd-builder';

import { UssdRequest } from '..';
import profileModule from './profile';
import sendMoneyModule from './send-money';

export type UssdModule = {
	id: string;
	description: string;
	handler: (menu: UssdMenu, request: UssdRequest, env: Env, ctx: ExecutionContext) => void;
	nextHandler?: (menu: UssdMenu, request: UssdRequest, env: Env, ctx: ExecutionContext) => string | Promise<string>;
};

export default [sendMoneyModule, profileModule] satisfies UssdModule[];
