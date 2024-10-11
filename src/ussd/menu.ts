import UssdMenu, { UssdMenuProvider } from 'ussd-builder';

export function initializeUSSDMenu(env: Env, provider: UssdMenuProvider) {
	const menu = new UssdMenu({
		provider,
	});

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

	menu.state('__exit__', {
		run: () => {
			menu.end('Thank you for using tbDEX Go. Goodbye!');
			return;
		},
	});

	menu.on('error', (err) => {
		console.error('Caught emitted error', err);
	});

	return menu;
}
