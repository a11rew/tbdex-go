import UssdMenu from 'ussd-menu-builder';

interface UssdRequest {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		if (!request.body) {
			return new Response('No request body', { status: 400 });
		}

		const body = await request.formData();
		const jsonBody = Object.fromEntries(body.entries()) as unknown as UssdRequest;

		console.log('body', jsonBody);

		const menu = new UssdMenu({
			provider: 'africasTalking',
		});

		menu.startState({
			run: () => {
				// prettier-ignore
				menu.con(
					'Welcome to the TBDex SDK service. Choose an option:' +
						'\n1. Send Money' +
						'\n2. Check stored balances' +
						'\n3. Profile'
				);
			},
			next: {
				'1': 'sendMoney',
				'2': 'checkBalances',
				'3': 'profile',
			},
		});

		menu.state('sendMoney', {
			run: () => {
				menu.end('You chose to send money. We will add support for this soon.');
			},
		});

		menu.state('checkBalances', {
			run: () => {
				menu.end('You chose to check your balances. We will add support for this soon.');
			},
		});

		menu.state('profile', {
			run: () => {
				menu.end('You chose to view your profile. We will add support for this soon.');
			},
		});

		const response = await menu.run(jsonBody);

		return new Response(response);
	},
} satisfies ExportedHandler<Env>;
