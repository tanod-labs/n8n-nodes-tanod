// Compatibility-only wallet bundle. Free and prepaid-credit requests never load this module.
export { x402Client, wrapFetchWithPayment } from '@x402/fetch';
export { ExactEvmScheme } from '@x402/evm';
export async function loadPrivateKeyToAccount() {
	return (await import('viem/accounts')).privateKeyToAccount;
}
