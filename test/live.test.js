// Package-shape + local payment smoke test. The historical live free-tier check is
// explicitly opt-in via TANOD_LIVE_TEST=1; default package tests are fully offline.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const pkg = require('../package.json');

const { Tanod } = require('../dist/nodes/Tanod/Tanod.node.js');
const { TanodX402Api } = require('../dist/credentials/TanodX402Api.credentials.js');
const { tanodRequest } = require('../dist/nodes/Tanod/transport.js');
const { OPS } = require('../dist/nodes/Tanod/operations.js');

(async () => {
	// ---- package shape
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.repository.type, 'git');
	for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) require(path.join('..', f));

	// ---- node + credential description
	const d = new Tanod().description;
	assert.equal(d.name, 'tanod');
	const ops = d.properties.filter((p) => p.name === 'operation').flatMap((p) => p.options.map((o) => o.value));
	assert.equal(ops.length, 10);
	assert.equal(OPS.length, 10);
	assert.equal(new TanodX402Api().name, 'tanodX402Api');
	assert.equal(new TanodX402Api().properties[0].typeOptions.password, true);
	console.log('ok shape:', ops.join(', '));

	// ---- live, free tier: opt-in only (never run by offline gates)
	if (process.env.TANOD_LIVE_TEST === '1') {
	const r = await tanodRequest({
		path: '/v1/render',
		body: { url: 'https://example.com', format: 'markdown', js: false },
		price: '0.002',
		useFree: true,
		maxPriceUsd: 0.05,
	});
	console.log('live keys:', Object.keys(r).join(','));
	const md = r.markdown ?? r.content ?? r.text;
	assert.equal(typeof md, 'string');
	assert.match(md, /documentation examples/);
	assert.equal(r.title, "Example Domain");
	console.log('ok live: page to markdown,', md.length, 'chars');
	} else console.log('SKIP live free-tier check (requires TANOD_LIVE_TEST=1)');

	// ---- no wallet on a 402: clear error (mock)
	// ---- wallet: signs and retries (mock server)
	const required = {
		x402Version: 2,
		error: 'Payment required. Price: $0.001 USDC',
		resource: { url: 'http://127.0.0.1/v1/email/verify', mimeType: 'application/json' },
		accepts: [
			{
				scheme: 'exact', network: 'eip155:8453',
				asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000',
				payTo: '0x593857A4a4F619543ea12394137C3004ce841720', maxTimeoutSeconds: 300,
				extra: { name: 'USD Coin', version: '2' },
			},
		],
	};
	let paidHeader = null;
	let calls = 0;
	const srv = http.createServer((req, res) => {
		calls++;
		const sig = req.headers['payment-signature'] || req.headers['x-payment'];
		req.resume();
		if (!sig) {
			res.writeHead(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(required)).toString('base64') });
			return res.end(JSON.stringify(required));
		}
		paidHeader = sig;
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ verdict: 'deliverable_likely' }));
	});
	await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
	const baseUrl = `http://127.0.0.1:${srv.address().port}`;
	const key = '0x' + 'ab'.repeat(32); // throwaway, holds nothing
	try {
		await assert.rejects(
			tanodRequest({ baseUrl, path: '/v1/email/verify', body: { email: 'a@b.co' }, price: '0.001', useFree: true, maxPriceUsd: 0.05 }),
			/Payment required: USD 0.001 per call.*credential.*pricing/s,
		);
		await assert.rejects(
			tanodRequest({ baseUrl, path: '/v1/email/verify', body: { email: 'a@b.co' }, price: '0.001', useFree: true, privateKey: key, maxPriceUsd: 0.0001 }),
			/within the node's "Max Price/,
		);
		const paid = await tanodRequest({ baseUrl, path: '/v1/email/verify', body: { email: 'a@b.co' }, price: '0.001', useFree: false, privateKey: key, maxPriceUsd: 0.05 });
		assert.equal(paid.verdict, 'deliverable_likely');
		assert.ok(paidHeader && paidHeader.length > 100, 'signed payment header sent');
		assert.ok(!Buffer.from(paidHeader, 'base64').toString().includes(key.slice(2)), 'key not in header');
		console.log('ok wallet path (mock): signed and retried');
	} finally {
		srv.close();
	}
	console.log('ALL OK');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
