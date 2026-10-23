const test = require('node:test');
const assert = require('node:assert/strict');
const { Tanod } = require('../dist/nodes/Tanod/Tanod.node.js');
const { TanodCreditsApi } = require('../dist/credentials/TanodCreditsApi.credentials.js');
const { tanodCreditRequest } = require('../dist/nodes/Tanod/creditsTransport.js');
const { OPS } = require('../dist/nodes/Tanod/operations.js');
const KEY = 'tnd_' + 'a'.repeat(43); // Synthetic, never sent to a network service.

function context({ key = KEY, status = 200, body = { ok: true }, error } = {}) {
  const calls = [], credentials = [];
  const ctx = {
    getCredentials: async (name) => { credentials.push(name); return { creditKey: key }; },
    getNode: () => ({ name: 'Tanod', type: 'n8n-nodes-tanod.tanod', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: {
      httpRequestWithAuthentication: async function (name, options) {
        assert.equal(this, ctx);
        calls.push({ name, options });
        if (error) throw error;
        return { statusCode: status, body };
      },
    },
  };
  return { ctx, calls, credentials };
}

function execution({ parameters = {}, items = [{ json: {} }], continueOnFail = false, ...options } = {}) {
  const mock = context(options);
  mock.ctx.getInputData = () => items;
  mock.ctx.getNodeParameter = (name, _i, fallback) => ({
    operation: 'verifyEmail', paymentMode: 'credits', email: 'person@example.com', ...parameters,
  }[name] ?? fallback);
  mock.ctx.continueOnFail = () => continueOnFail;
  mock.ctx.getNode = () => ({ name: 'Tanod', type: 'n8n-nodes-tanod.tanod', typeVersion: 1, position: [0, 0], parameters: {} });
  mock.ctx.helpers.prepareBinaryData = async (buffer, name, mimeType) => ({
    data: buffer.toString('base64'), fileName: name, mimeType,
  });
  return mock;
}

test('credit credential uses secret field, accepted Bearer header and free non-redirecting balance test', () => {
  const c = new TanodCreditsApi();
  assert.equal(c.name, 'tanodCreditsApi');
  assert.equal(c.properties[0].name, 'creditKey');
  assert.equal(c.properties[0].typeOptions.password, true);
  assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.creditKey}}');
  assert.deepEqual(c.test.request, { method: 'GET', url: 'https://tanod.dev/v1/credits/balance', disableFollowRedirect: true, timeout: 15000 });
  assert.equal(c.documentationUrl, 'https://tanod.dev/credits/');
  assert.deepEqual(c.icon, { light: 'file:tanod.svg', dark: 'file:tanod.svg' });
});

test('explicit credit selection; legacy mode remains the default for existing workflows', () => {
  const d = new Tanod().description;
  assert.equal(d.properties.find((p) => p.name === 'paymentMode').default, 'legacy');
  assert.equal(d.usableAsTool, true);
  assert.match(d.properties.find((p) => p.name === 'paymentMode').description,
    /Each input item is one paid call; the key balance is the only limit; don't enable Retry On Fail on paid calls/);
  assert.deepEqual(d.inputs, ['main']);
  assert.deepEqual(d.outputs, ['main']);
  assert.equal(d.credentials.find((c) => c.name === 'tanodCreditsApi').required, true);
  assert.deepEqual(d.credentials.find((c) => c.name === 'tanodCreditsApi').displayOptions.show.paymentMode, ['credits']);
  assert.deepEqual(d.properties.find((p) => p.name === 'options').displayOptions.show.paymentMode, ['legacy']);
});

for (const op of OPS) test(`credit request ${op.value}: exact destination and one n8n-authenticated call`, async () => {
  const m = context();
  const body = { url: 'https://example.com/input', nested: { a: 1 } };
  assert.deepEqual(await tanodCreditRequest(m.ctx, op.path, body), { ok: true });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(m.credentials, ['tanodCreditsApi']);
  assert.equal(m.calls[0].name, 'tanodCreditsApi');
  assert.deepEqual(m.calls[0].options, {
    method: 'POST', url: 'https://tanod.dev' + op.path, body,
    headers: { accept: 'application/json' }, json: true, returnFullResponse: true,
    ignoreHttpStatusErrors: true, disableFollowRedirect: true, timeout: 120000,
  });
  assert.ok(!JSON.stringify(m.calls).includes(KEY), 'only n8n injects the key');
});

for (const path of ['https://evil.invalid/v1/ocr', '//evil.invalid', '/v1/ocr?key=x', '/v1/ocr#fragment',
  '/v1/../credits/topup', '/v1/ocr/../credits/topup', '/v1/credits/topup', '/v1/ocr/', '/v1/%6fcr']) {
  test(`reject unapproved destination ${path} before credential lookup or HTTP`, async () => {
    const m = context();
    await assert.rejects(tanodCreditRequest(m.ctx, path, {}), /Unsupported/);
    assert.equal(m.calls.length, 0);
    assert.equal(m.credentials.length, 0);
  });
}

for (const key of ['', 'bad', 'tnd_' + 'a'.repeat(42), 'tnd_' + 'a'.repeat(44), KEY + '\n', ' ' + KEY,
  KEY + '\r\nX-Injected: yes', 'tnd_' + '/'.repeat(43), undefined, null, 42]) {
  test(`malformed key case ${JSON.stringify(key)?.slice(0, 28)} is rejected before HTTP`, async () => {
    const m = context();
    m.ctx.getCredentials = async () => ({ creditKey: key });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), /must be tnd_/);
    assert.equal(m.calls.length, 0);
  });
}

test('missing credential never falls back to free tier or wallet', async () => {
  const m = context();
  m.ctx.getCredentials = async () => { throw new Error(KEY); };
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), /Select a Tanod prepaid/);
  assert.equal(m.calls.length, 0);
});

for (const status of [301, 302, 307, 308, 400, 401, 402, 422, 429, 500, 503, undefined]) {
  test(`credit HTTP ${status}: one attempt, no reflected secret and no fallback`, async () => {
    const m = context({ status, body: { error: { message: KEY } } });
    if (status === undefined) m.ctx.helpers.httpRequestWithAuthentication = async () => ({ body: { error: KEY } });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (e) => {
      assert.ok(!e.message.includes(KEY));
      if (status === 401) assert.match(e.message, /invalid or revoked/);
      if (status === 402) assert.match(e.message, /not accepted by the service right now.*No wallet payment or automatic retry/);
      if (status >= 300 && status < 400) assert.match(e.message, /redirect/);
      return true;
    });
    assert.ok(m.calls.length <= 1);
  });
}

for (const code of ['credits_insufficient', 'credits_not_applicable', 'not_configured', KEY, '__proto__', undefined, null, 402]) {
  test(`credit 402 code ${String(code).slice(0, 24)} selects only fixed allowlisted text`, async () => {
    const m = context({ status: 402, body: { error: { code, message: KEY } } });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
      assert.ok(!error.message.includes(KEY));
      assert.match(error.message, code === 'credits_insufficient' ? /balance is insufficient/ : /not accepted by the service right now/);
      assert.match(error.message, /https:\/\/tanod.dev\/credits\//);
      return true;
    });
    assert.equal(m.calls.length, 1);
  });
}

for (const reason of ['timeout', 'redirect', 'socket']) test(`credit ${reason}: HTTP exceptions cannot leak headers`, async () => {
  const m = context({ error: new Error(`${reason}: Authorization: Bearer ${KEY}`) });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (e) => {
    assert.match(e.message, /No automatic retry/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

test('node credit mode ignores free/cap options, never reads wallet, pairs output', async () => {
  const m = execution({ parameters: { options: { useFree: true, maxPriceUsd: 0 } } });
  const result = await Tanod.prototype.execute.call(m.ctx);
  assert.deepEqual(result, [[{ json: { ok: true }, pairedItem: { item: 0 } }]]);
  assert.deepEqual(m.credentials, ['tanodCreditsApi']);
  assert.deepEqual(m.calls[0].options.body, { email: 'person@example.com' });
  assert.equal(m.calls[0].options.headers['X-Tanod-Free'], undefined);
});

test('credit mode preserves binary file output and per-item pairing', async () => {
  const m = execution({ items: [{ json: {} }, { json: {} }],
    body: { file: { name: 'result.pdf', content_type: 'application/pdf', data_base64: 'YWJj' } } });
  // Return a fresh answer per item because output extraction removes base64 from the JSON.
  m.ctx.helpers.httpRequestWithAuthentication = async () => ({ statusCode: 200,
    body: { file: { name: 'result.pdf', content_type: 'application/pdf', data_base64: 'YWJj' } } });
  const [results] = await Tanod.prototype.execute.call(m.ctx);
  assert.equal(results.length, 2);
  for (const [i, item] of results.entries()) {
    assert.equal(item.binary.data.data, 'YWJj');
    assert.equal(item.json.file.data_base64, undefined);
    assert.deepEqual(item.pairedItem, { item: i });
  }
});

test('credit mode builds the existing binary input schema', async () => {
  const m = execution({ parameters: { operation: 'toMarkdown', inputSource: 'binary' } });
  m.ctx.helpers.assertBinaryData = () => ({ fileName: 'example.pdf' });
  m.ctx.helpers.getBinaryDataBuffer = async () => Buffer.from('synthetic');
  await Tanod.prototype.execute.call(m.ctx);
  assert.deepEqual(m.calls[0].options.body, { file_base64: Buffer.from('synthetic').toString('base64'), filename: 'example.pdf' });
});

test('continueOnFail emits only sanitized credit errors per item', async () => {
  const m = execution({ continueOnFail: true, items: [{ json: {} }, { json: {} }], error: new Error(KEY) });
  const [results] = await Tanod.prototype.execute.call(m.ctx);
  assert.equal(results.length, 2);
  assert.ok(!JSON.stringify(results).includes(KEY));
  assert.match(results[0].json.error, /No automatic retry/);
});

test('normal node error does not embed the underlying credit HTTP error', async () => {
  const m = execution({ error: new Error(KEY) });
  await assert.rejects(Tanod.prototype.execute.call(m.ctx), (e) => !e.message.includes(KEY) && /No automatic retry/.test(e.message));
});

test('unknown payment mode and operation cannot silently choose free/wallet mode', async () => {
  for (const parameters of [{ paymentMode: 'typo' }, { operation: 'typo' }]) {
    const m = execution({ parameters });
    await assert.rejects(Tanod.prototype.execute.call(m.ctx), /Unsupported Tanod/);
    assert.equal(m.calls.length, 0);
    assert.equal(m.credentials.length, 0);
  }
});
