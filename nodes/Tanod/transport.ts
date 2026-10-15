import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';

export const BASE_URL = 'https://tanod.dev';

export class TanodPaymentError extends Error {}

export interface TanodRequestArgs {
	path: string;
	body: Record<string, unknown>;
	price: string;
	useFree: boolean;
	privateKey?: string;
	maxPriceUsd: number;
	dynamicPrice?: boolean;
	baseUrl?: string;
	timeoutMs?: number;
}

const HELP =
	'Add a "Tanod x402 wallet" credential (an EVM private key holding USDC on Base) to this node, ' +
	'or use the MCP server at https://tanod.dev/connect/ . Prices: https://tanod.dev/pricing';

/** Smallest USDC amount (6 decimals) among the "exact" EVM accepts, as USD. */
function quotedUsd(paymentRequired: any): number | undefined {
	const accepts: any[] = Array.isArray(paymentRequired?.accepts) ? paymentRequired.accepts : [];
	const amounts = accepts
		.filter((a) => typeof a?.network === 'string' && a.network.startsWith('eip155:') && a.amount)
		.filter((a) => a.network === 'eip155:8453')
		.map((a) => Number(a.amount) / 1e6)
		.filter((n) => Number.isFinite(n));
	return amounts.length ? Math.min(...amounts) : undefined;
}

async function readJson(res: Response): Promise<any> {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return { raw: text.slice(0, 500) };
	}
}

function failure(res: Response, data: any): Error {
	const detail =
		data?.detail?.message ?? data?.detail ?? data?.error ?? data?.message ?? data?.raw ?? JSON.stringify(data).slice(0, 300);
	const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
	return new Error(`Tanod ${res.status}: ${text}`);
}

export async function tanodRequest(a: TanodRequestArgs): Promise<unknown> {
	const url = (a.baseUrl ?? BASE_URL) + a.path;
	const timeout = a.timeoutMs ?? 120_000;
	const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
	const payload = JSON.stringify(a.body);

	const send = (f: typeof fetch, h: Record<string, string>) =>
		f(url, { method: 'POST', headers: h, body: payload, signal: AbortSignal.timeout(timeout) });

	// 1. Free allowance first, where the route has one.
	const firstHeaders = a.useFree ? { ...headers, 'X-Tanod-Free': '1' } : headers;
	let res = await send(fetch, firstHeaders);
	if (res.status !== 402) {
		const data = await readJson(res);
		if (!res.ok) throw failure(res, data);
		return data;
	}

	// 2. 402: pay with the wallet if there is one.
	const required = await readJson(res);
	const usd = quotedUsd(required);
	const priceText = usd !== undefined ? `USD ${usd}` : `about USD ${a.price}${a.dynamicPrice ? ' (up to 0.01)' : ''}`;
	const why = a.useFree ? 'The free daily allowance for this route is used up or does not apply. ' : '';
	if (!a.privateKey) {
		throw new TanodPaymentError(`Payment required: ${priceText} per call. ${why}${HELP}`);
	}
	if (usd !== undefined && usd > a.maxPriceUsd) {
		throw new TanodPaymentError(
			`Payment required: ${priceText}, above the node's "Max Price per Call" of USD ${a.maxPriceUsd}. Raise the option to allow it.`,
		);
	}

	let fetchWithPay: typeof fetch;
	try {
		const key = (a.privateKey.startsWith('0x') ? a.privateKey : `0x${a.privateKey}`) as `0x${string}`;
		const { privateKeyToAccount } = await import('viem/accounts');
		const account = privateKeyToAccount(key);
		const client = new x402Client().register('eip155:8453', new ExactEvmScheme(account));
		fetchWithPay = wrapFetchWithPayment(fetch, client) as typeof fetch;
	} catch {
		// Never include the key or the underlying error text, which could echo it.
		throw new TanodPaymentError('The Tanod x402 wallet credential is not a valid EVM private key (0x + 64 hex characters).');
	}

	try {
		res = await send(fetchWithPay, headers);
	} catch (e) {
		throw new TanodPaymentError(`x402 payment failed: ${(e as Error).message.replace(/0x[0-9a-fA-F]{64}/g, '[redacted]')}`);
	}
	const data = await readJson(res);
	if (res.status === 402) {
		throw new TanodPaymentError(
			`Payment of ${priceText} was not accepted. Check that the wallet holds USDC on Base. ${HELP}`,
		);
	}
	if (!res.ok) throw failure(res, data);
	return data;
}
