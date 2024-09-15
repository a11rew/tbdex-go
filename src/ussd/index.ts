import { buildContinueResponseWithErrors, sessionErrors } from './builders';
import UssdMenu from './lib/ussd-menu.js';
import modules, { UssdModule } from './modules';

export interface UssdRequest {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

const moduleIndexMap = modules.reduce(
	(acc, module, index) => {
		acc[index + 1] = module;
		return acc;
	},
	{} as Record<number, UssdModule>,
);

export async function handleUSSDRequest(request: UssdRequest, env: Env, ctx: ExecutionContext) {
	const menu = new UssdMenu({
		provider: 'africasTalking',
	});

	console.log('handling ussd request', request);

	// Configure session storage using KV
	menu.sessionConfig({
		start: async () => {
			// Initialize session state
			// no-op
		},
		set: async (sessionId, key, value) => {
			try {
				let stringValue = value;

				// Try serializing value
				if (typeof value !== 'string') {
					try {
						stringValue = JSON.stringify(value);
					} catch (error) {
						console.error('Error serializing value', error);
						throw new Error('Error serializing value ' + error);
					}
				}

				// Update session state
				await env.session_store.put(`session-${sessionId}.${key}`, stringValue);
			} catch (error) {
				console.error('Error in sessionConfig set', sessionId, key, error);
				throw error;
			}
		},
		end: async (sessionId) => {
			try {
				console.log('ending session', sessionId);

				// Clean up session state
				let keys: string[] = [];

				// List all keys for the session, paginate if necessary
				let response = await env.session_store.list({ prefix: `session-${sessionId}.` });
				while (!response.list_complete) {
					keys.push(...response.keys.map((key) => key.name));
					response = await env.session_store.list({
						prefix: `session-${sessionId}.`,
						cursor: response.cursor,
					});
				}

				// Delete all keys for the session
				// TODO: Use the bulk deletion API - https://developers.cloudflare.com/api/operations/workers-kv-namespace-delete-multiple-key-value-pairs
				await Promise.all(keys.map((key) => env.session_store.delete(key)));
			} catch (error) {
				console.error('Error in sessionConfig end', sessionId, error);
				throw error;
			}
		},
		get: async (sessionId, key) => {
			try {
				// Retrieve session state value
				const value = await env.session_store.get(`session-${sessionId}.${key}`);
				return value;
			} catch (error) {
				console.error('Error in sessionConfig get', sessionId, key, error);
				throw error;
			}
		},
	});

	menu.onResult = async (result) => {
		console.log('onResult', result);

		await sessionErrors.clear(menu);
	};

	const originalCon = menu.con;
	menu.con = function (this: typeof menu, message: string) {
		return originalCon.call(this, message + '\n\n#. Exit');
	}.bind(menu);

	const originalState = menu.state;
	menu.state = function (this: typeof menu, id: string, options: UssdMenu.UssdStateOptions) {
		return originalState.call(this, id, { defaultNext: '__fallback__', ...options });
	}.bind(menu);

	// Register modules
	modules.forEach((module) => {
		module.handler(menu, request, env, ctx);
	});

	menu.startState({
		run: async () => {
			return await buildContinueResponseWithErrors(
				menu,
				'Welcome to tbDEX go.' +
					'\n\n' +
					'Send money across borders instantly and securely. To get started, choose an option:' +
					'\n\n' +
					Object.entries(moduleIndexMap)
						.map(([index, module]) => `${index}. ${module.description}`)
						.join('\n'),
			);
		},
		next: Object.entries(moduleIndexMap).reduce(
			(acc, [index, module]) => {
				acc[index] = module.nextHandler ? module.nextHandler.bind(null, menu, request, env, ctx) : module.id;
				return acc;
			},
			{} as Record<string, (() => Promise<string> | string) | string>,
		),
	});

	menu.state('__fallback__', {
		run: async () => {
			const input = menu.val;

			console.log('fallback state', menu.state);
			if (input === '#') {
				return menu.go('__exit__');
			}

			await sessionErrors.set(menu, 'Invalid input. Please choose a valid option from the menu.');

			// @ts-expect-error - menu.states is an object not an array
			menu.runState(menu.states[UssdMenu.START_STATE]);
		},
	});

	menu.state('__exit__', {
		run: () => {
			menu.end('Thank you for using tbDEX Go. Goodbye!');
			return;
		},
	});

	menu.on('error', (err) => {
		console.error('Caught emitted error', err);
	});

	return await menu.run(request as unknown as UssdMenu.UssdGatewayArgs);
}
