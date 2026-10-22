import { x402Client, x402HTTPClient, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';

const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const UINT256_MAX = (1n << 256n) - 1n;

/** Floor the configured decimal USD limit to USDC atoms, without binary multiplication/rounding. */
function capAtomic(usd: number): bigint {
	if (!Number.isFinite(usd) || usd < 0 || usd > Number.MAX_SAFE_INTEGER / 1e6) {
		throw new TanodPaymentError('Max Price per Call must be a finite, non-negative, safely representable USD limit.');
	}
	const [mantissa, exponent = '0'] = usd.toString().toLowerCase().split('e');
	const [whole, fraction = ''] = mantissa.split('.');
	const digits = BigInt(whole + fraction);
	const shift = 6 + Number(exponent) - fraction.length;
	return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}

/** Only the existing exact USDC/Base rail; decimals come from the token, never the quote. */
function terms(a: any): string | undefined {
	try {
		if (a?.scheme !== 'exact' || a.network !== NETWORK || typeof a.asset !== 'string' ||
			a.asset.toLowerCase() !== USDC.toLowerCase() || typeof a.amount !== 'string' ||
			! /^(0|[1-9][0-9]{0,77})$/.test(a.amount) || BigInt(a.amount) > UINT256_MAX ||
			typeof a.payTo !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a.payTo) ||
			!Number.isSafeInteger(a.maxTimeoutSeconds) || a.maxTimeoutSeconds <= 0) return;
		const payee = a.payTo.toLowerCase();
		if (payee === '0x0000000000000000000000000000000000000000') return;
		if (a.decimals !== undefined && a.decimals !== 6) return;
		const extra = a.extra ?? {};
		if (typeof extra !== 'object' || Array.isArray(extra) || (extra.decimals !== undefined && extra.decimals !== 6)) return;
		const method = extra.assetTransferMethod ?? 'eip3009';
		const flow = extra.paymentFlow ?? 'authorization';
		if (!['eip3009', 'permit2'].includes(method) || !['authorization', 'upfront', 'escrow'].includes(flow)) return;
		if (method === 'eip3009' && (extra.name !== 'USD Coin' || extra.version !== '2')) return;
		return JSON.stringify([NETWORK, USDC, payee, method, flow, extra.name, extra.version]);
	} catch { return; }
}

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

/** Display only. Authorization uses exact atomic comparisons below, not this conversion. */
function quotedUsd(paymentRequired: any): number | undefined {
	const accepts: any[] = Array.isArray(paymentRequired?.accepts) ? paymentRequired.accepts : [];
	const amounts = accepts.filter((a) => terms(a)).map((a) => BigInt(a.amount));
	if (!amounts.length) return;
	return Number(amounts.reduce((x, y) => x < y ? x : y)) / 1e6;
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
		// Never follow a redirect with a payment authorization, lose custom headers, or enter a redirect loop.
		f(url, { method: 'POST', headers: h, body: payload, redirect: 'error', signal: AbortSignal.timeout(timeout) });

	// 1. Free allowance first, where the route has one.
	const firstHeaders = a.useFree ? { ...headers, 'X-Tanod-Free': '1' } : headers;
	let res = await send(fetch, firstHeaders);
	if (res.status !== 402) {
		const data = await readJson(res);
		if (!res.ok) throw failure(res, data);
		return data;
	}

	// 2. 402: pay with the wallet if there is one.
	const body = await readJson(res);
	let required: any;
	try {
		required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((name) => res.headers.get(name), body);
	} catch {
		throw new TanodPaymentError('Payment required: invalid or unsupported x402 payment requirements. Nothing was signed.');
	}
	const usd = quotedUsd(required);
	const priceText = usd !== undefined ? `USD ${usd}` : `about USD ${a.price}${a.dynamicPrice ? ' (up to 0.01)' : ''}`;
	const why = a.useFree ? 'The free daily allowance for this route is used up or does not apply. ' : '';
	if (!a.privateKey) {
		throw new TanodPaymentError(`Payment required: ${priceText} per call. ${why}${HELP}`);
	}
	const limit = capAtomic(a.maxPriceUsd);
	const initial: any[] = required.x402Version === 2 && Array.isArray(required.accepts) ? required.accepts : [];
	// Bind later SDK-selected terms to a vetted initial offer, not the cheapest array member.
	const allowedTerms = new Set(initial.filter((r) => terms(r) && BigInt(r.amount) <= limit).map(terms));
	if (!allowedTerms.size) {
		throw new TanodPaymentError(
			`Payment required: no valid USDC-on-Base offer within the node's "Max Price per Call" of USD ${a.maxPriceUsd}. Nothing was signed.`,
		);
	}

	let fetchWithPay: typeof fetch;
	try {
		const key = (a.privateKey.startsWith('0x') ? a.privateKey : `0x${a.privateKey}`) as `0x${string}`;
		const { privateKeyToAccount } = await import('viem/accounts');
		const account = privateKeyToAccount(key);
		const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
		// SDK 2.28.0 supports atomic per-asset caps. Avoid its floating Money parsing path.
		client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: limit.toString() }] });
		const vetted = (r: any) => {
			const t = terms(r);
			return t !== undefined && allowedTerms.has(t) && BigInt(r.amount) <= limit;
		};
		client.registerPolicy((version, accepts) => version === 2 ? accepts.filter(vetted) : []);
		// Pinned SDK executes this with selectedRequirements before scheme.createPaymentPayload/signTypedData.
		client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
			if (!vetted(selectedRequirements)) return { abort: true, reason: 'The selected payment exceeds the cap or has unapproved terms.' };
		});
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
