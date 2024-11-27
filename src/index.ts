import { updateExchanges } from './exchanges';
import { handleSMSNotification } from './exchanges/notification-handler';
import { refreshPFIOfferings } from './pfis';
import { handleUSSDRequest } from './ussd';

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
		const url = new URL(request.url);
		const urlPath = url.pathname;

		if (urlPath.startsWith('/sms-notification')) {
			return await handleSMSNotification(request, env, 'africasTalking');
		}

		if (urlPath.startsWith('/twilio-sms-notification')) {
			return await handleSMSNotification(request, env, 'twilio');
		}

		if (!request.body) {
			return new Response('No request body', { status: 400 });
		}

		const provider = urlPath === '/nalo' ? 'nalo' : 'africasTalking';

		const body = provider === 'nalo' ? await request.json() : Object.fromEntries((await request.formData()).entries());

		const response = await handleUSSDRequest(
			body,
			env,
			ctx,
			// @ts-expect-error - nalo provider is not typed correctly
			provider,
		);

		if (response.length > 150) {
			console.warn('Response is too long', response.length);
			console.log('Only the following will be sent to the client:');
			console.log(response.slice(4, 154));
		}

		return provider === 'nalo' ? Response.json(response) : new Response(response);
	},
	async scheduled(event, env, ctx) {
		ctx.waitUntil(
			Promise.all([
				updateExchanges(env).catch((error) => {
					console.error('Error in update exchanges handler', error);
				}),
				refreshPFIOfferings(env).catch((error) => {
					console.error('Error in refresh PFI offerings handler', error);
				}),
			]),
		);
	},
} satisfies ExportedHandler<Env>;
