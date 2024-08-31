import UssdMenu from 'ussd-menu-builder';

import modules from './modules';

interface UssdRequest {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

const moduleIndexMap = modules.reduce((acc, module, index) => {
	acc[index + 1] = module.id;
	return acc;
}, {} as Record<number, string>);

export async function handleUSSDRequest(request: UssdRequest): Promise<string> {
	const menu = new UssdMenu({
		provider: 'africasTalking',
	});

	menu.startState({
		run: () => {
			// prettier-ignore
			menu.con(
				'Welcome to the TBDex USSD service. Choose an option:' +
					'\n' +
					Object.entries(moduleIndexMap)
						.map(([index, moduleId]) => `${index}. ${moduleId}`)
						.join('\n')
			);
		},
		next: moduleIndexMap,
	});

	// Register modules
	modules.forEach((module) => {
		module.handler(menu);
	});

	const response = await menu.run(request as unknown as UssdMenu.UssdGatewayArgs);

	return response;
}
