import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { OPS } from './operations';

const ORIGIN = 'https://tanod.dev';
const KEY = /^tnd_[A-Za-z0-9_-]{43}$/;

/** No wallet SDK, automatic retries, free-tier fallback, or configurable credential destination. */
export async function tanodCreditRequest(
	ctx: IExecuteFunctions,
	path: string,
	body: Record<string, unknown>,
): Promise<unknown> {
	// Exact route membership (not a prefix) rejects origins, queries, traversal and top-ups.
	if (!OPS.some((op) => op.path === path)) {
		throw new NodeOperationError(ctx.getNode(), 'Unsupported Tanod credit-key operation.');
	}
	let key: unknown;
	try {
		key = (await ctx.getCredentials('tanodCreditsApi')).creditKey;
	} catch {
		throw new NodeOperationError(ctx.getNode(), 'Select a Tanod prepaid credit key credential.');
	}
	if (typeof key !== 'string' || key.length !== 47 || !KEY.test(key)) {
		throw new NodeOperationError(ctx.getNode(), 'The Tanod prepaid credit key must be tnd_ followed by 43 letters, digits, underscores or hyphens.');
	}

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: ORIGIN + path,
		body,
		headers: { accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: 120_000,
	};
	let response;
	try {
		// n8n injects the credential's Authorization header, not a URL/body/query field.
		response = await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'tanodCreditsApi', options);
	} catch {
		// HTTP-library exceptions can include request headers/config and therefore the key.
		throw new NodeOperationError(ctx.getNode(), 'Tanod credit request failed or timed out. No automatic retry was made; check the credit balance before retrying.');
	}
	const status = response?.statusCode;
	if (status === 200) return response.body;
	if (status === 401) throw new NodeOperationError(ctx.getNode(), 'Tanod 401: the prepaid credit key is invalid or revoked. Check the credential.');
	if (status === 402) {
		// Only known codes select fixed messages; never echo upstream text or unknown codes.
		const message = response.body?.error?.code === 'credits_insufficient'
			? 'the prepaid balance is insufficient for this call. Add credit at https://tanod.dev/credits/.'
			: 'credit payment not accepted by the service right now; check https://tanod.dev/credits/.';
		throw new NodeOperationError(ctx.getNode(), `Tanod 402: ${message} No wallet payment or automatic retry was attempted.`);
	}
	if (Number.isInteger(status) && status >= 300 && status < 400) {
		throw new NodeOperationError(ctx.getNode(), 'Tanod refused a redirect. The credit key was not forwarded.');
	}
	// Never copy upstream error text: it can reflect credentials or n8n request configuration.
	throw new NodeOperationError(ctx.getNode(), `Tanod ${Number.isInteger(status) ? status : 'request failed'}: credit-key call failed. Check the input and credit balance before retrying.`);
}
