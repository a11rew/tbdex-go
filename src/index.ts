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
		if (!request.body) {
			return new Response('No request body', { status: 400 });
		}

		const body = await request.formData();
		const jsonBody = Object.fromEntries(body.entries());

		const response = await handleUSSDRequest(
			// @ts-expect-error - TODO: Add runtime type validation
			jsonBody,
			env,
			ctx,
		);

		return new Response(response);
	},
} satisfies ExportedHandler<Env>;
