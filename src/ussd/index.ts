import { getUserByPhoneNumber } from '@/user';
import UssdMenu, { UssdMenuProvider } from 'ussd-builder';
import { initializeUSSDMenu } from './menu';
import { registerModules } from './modules';

export interface UssdRequest {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

export async function handleUSSDRequest(request: UssdRequest, env: Env, ctx: ExecutionContext, provider: UssdMenuProvider) {
	const menu = initializeUSSDMenu(env, provider);

	// Register modules
	await registerModules(menu, env, ctx);

	menu.startState({
		// @ts-ignore -- For start states, run can be undefined - https://github.com/habbes/ussd-menu-builder#matching-with-empty-rule-on-start-state
		run: undefined,
		next: {
			'': async () => {
				// @ts-expect-error We don't have the parsed args here so we need to get the phone number ourselves
				const phoneNumber = provider === 'nalo' ? `+${request['MSISDN']}` : request.phoneNumber;

				const user = await getUserByPhoneNumber(env, phoneNumber);

				if (user) {
					await menu.session.set('user', user);
				}

				return user ? 'user.registered' : 'user.not_registered';
			},
		},
	});

	return await menu.run(request as unknown as UssdMenu.UssdGatewayArgs);
}
