// Offline only: real pinned SDK selection/EIP-712 construction, fake signer, no key/signature/provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ExactEvmScheme } = require('../dist/nodes/Tanod/walletSdk.js');
const { tanodRequest } = require('../dist/nodes/Tanod/transport.js');
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYEE = '0x593857A4a4F619543ea12394137C3004ce841720';
const key = '0x' + 'ab'.repeat(32); // synthetic, never used to sign
const offer = (overrides = {}) => ({ scheme: 'exact', network: 'eip155:8453', asset: ASSET,
  amount: '1000', payTo: PAYEE, maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' }, ...overrides });
const required = (accepts) => ({ x402Version: 2, accepts, resource: { url: 'https://offline.invalid/test' } });
const paymentResponse = (pr, headerOnly = false) => new Response(headerOnly ? '' : JSON.stringify(pr), {
  status: 402, headers: { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') },
});

async function run(first, second = first, options = {}) {
  const oldFetch = global.fetch;
  const original = ExactEvmScheme.prototype.createPaymentPayload;
  const signed = [], requests = [];
  ExactEvmScheme.prototype.createPaymentPayload = function (...args) {
    return original.apply({ ...this, signer: { address: '0x0000000000000000000000000000000000000001',
      signTypedData: async (data) => { signed.push(data); return '0x' + '11'.repeat(65); } } }, args);
  };
  global.fetch = async (input, init) => {
    const req = new Request(input, init);
    requests.push(req);
    if (req.headers.has('payment-signature')) return options.paidResponse ?? new Response('{"ok":true}');
    return paymentResponse(requests.length === 1 ? first : second, options.headerOnly);
  };
  try {
    let result, error;
    try { result = await tanodRequest({ baseUrl: 'https://offline.invalid', path: '/test', body: { x: 1 },
      price: '0.001', useFree: true, privateKey: key, maxPriceUsd: 0.005, ...options.args }); }
    catch (e) { error = e; }
    return { result, error, signed, requests };
  } finally { global.fetch = oldFetch; ExactEvmScheme.prototype.createPaymentPayload = original; }
}

test('quote changes from $0.001 to $0.10: no signer entry or paid send', async () => {
  const r = await run(required([offer()]), required([offer({ amount: '100000' })]));
  assert.ok(r.error, 'must refuse the changed expensive quote');
  assert.equal(r.signed.length, 0);
  assert.equal(r.requests.filter(r => r.headers.has('payment-signature')).length, 0);
});

test('array choice cannot use cheapest preflight to sign expensive first offer', async () => {
  const r = await run(required([offer({ amount: '100000' }), offer()]));
  assert.equal(r.error, undefined);
  assert.equal(r.signed.length, 1);
  assert.equal(r.signed[0].message.value, 1000n);
});

for (const [name, change] of [
  ['negative', { amount: '-1' }], ['decimal', { amount: '0.001' }], ['exponent', { amount: '1e3' }],
  ['hex', { amount: '0x3e8' }], ['number', { amount: 1000 }], ['missing', { amount: undefined }],
  ['overflow', { amount: '9'.repeat(80) }], ['wrong asset', { asset: '0x0000000000000000000000000000000000000001' }],
  ['missing asset', { asset: undefined }], ['wrong network', { network: 'eip155:1' }],
  ['bad payee', { payTo: 'garbage' }], ['zero payee', { payTo: '0x' + '0'.repeat(40) }],
  ['missing payee', { payTo: undefined }], ['changed payee', { payTo: '0x' + '1'.repeat(40) }],
  ['wrong decimals', { extra: { name: 'USD Coin', version: '2', decimals: 18 } }],
]) test(`selected quote ${name}: never enters signer`, async () => {
  const r = await run(required([offer()]), required([offer(change)]));
  assert.ok(r.error);
  assert.equal(r.signed.length, 0);
});

test('exact decimal boundary, no rounded-up micro-dollar allowance', async () => {
  const r = await run(required([offer({ amount: '5001' })]), undefined, { args: { maxPriceUsd: 0.0050009 } });
  assert.ok(r.error);
  assert.equal(r.signed.length, 0);
});

test('header-only 402 and normal paid headers/error handling', async () => {
  const r = await run(required([offer()]), undefined, { headerOnly: true });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.result, { ok: true });
  assert.equal(r.signed.length, 1);
  const paid = r.requests.find(r => r.headers.has('payment-signature'));
  assert.equal(paid.headers.get('content-type'), 'application/json');
  assert.equal(paid.headers.get('x-tanod-free'), null);
  assert.equal(paid.redirect, 'error');
});

test('paid 402 stays a payment error; non-payment 4xx stays an API error', async () => {
  const rejected = await run(required([offer()]), undefined, { paidResponse: paymentResponse(required([offer()])) });
  assert.match(rejected.error.message, /not accepted/);
  assert.equal(rejected.signed.length, 1);
  const bad = await run(required([offer()]), undefined, { paidResponse: new Response('{"detail":"bad input"}', { status: 422 }) });
  assert.match(bad.error.message, /Tanod 422: bad input/);
});

test('malformed payment header is refused before loading or signing with the wallet', async () => {
  const old = global.fetch;
  try {
    const encoded = Buffer.from(JSON.stringify(required([offer()]))).toString('base64');
    for (const header of [encoded + '!', '@' + encoded, '%%%']) {
      global.fetch = async () => new Response('', { status: 402, headers: { 'payment-required': header } });
      await assert.rejects(tanodRequest({ path: '/test', body: {}, price: '1', useFree: false,
        privateKey: key, maxPriceUsd: 1 }), /invalid or unsupported/);
    }
  } finally { global.fetch = old; }
});

test('free success and free 4xx do not construct/sign payment', async () => {
  const f = global.fetch;
  try {
    let init;
    global.fetch = async (_u, i) => { init = i; return new Response('{"free":true}'); };
    assert.deepEqual(await tanodRequest({ path: '/test', body: {}, price: '1', useFree: true, maxPriceUsd: NaN }), { free: true });
    assert.equal(init.headers['X-Tanod-Free'], '1');
    assert.equal(init.redirect, 'error');
    global.fetch = async () => new Response('{"detail":"bad"}', { status: 400 });
    await assert.rejects(tanodRequest({ path: '/test', body: {}, price: '1', useFree: true, maxPriceUsd: 1 }), /Tanod 400: bad/);
  } finally { global.fetch = f; }
});
