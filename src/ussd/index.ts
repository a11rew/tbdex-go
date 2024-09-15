import { getUserByPhoneNumber } from '@/user';
import UssdMenu from 'ussd-builder';
import { initializeUSSDMenu } from './menu';
import { registerModules } from './modules';

export interface UssdRequest {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

export async function handleUSSDRequest(request: UssdRequest, env: Env, ctx: ExecutionContext) {
	const menu = initializeUSSDMenu(env);

	// Register modules
	await registerModules(menu, request, env, ctx);

	menu.startState({
		// @ts-ignore -- For start states, run can be undefined - https://github.com/habbes/ussd-menu-builder#matching-with-empty-rule-on-start-state
		run: undefined,
		next: {
			'': async () => {
				const user = await getUserByPhoneNumber(env, request.phoneNumber);

				if (user) {
					await menu.session.set('user', user);
				}

				return user ? 'user.registered' : 'user.not_registered';
			},
		},
	});

	return await menu.run(request as unknown as UssdMenu.UssdGatewayArgs);
}
