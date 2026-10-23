const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
const root = path.join(__dirname, '..');

function child(script) {
  execFileSync(process.execPath, ['-e', script], { cwd: root, stdio: 'pipe', timeout: 30000 });
}

test('README credit workflow imports without a key and keeps paid mode explicit', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const workflow = JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)[1]);
  const node = workflow.nodes.find((entry) => entry.type === 'n8n-nodes-tanod.tanod');
  assert.equal(node.parameters.paymentMode, 'credits');
  assert.ok(OPS_PATHS().includes(node.parameters.operation));
  assert.equal(node.credentials, undefined);
  assert.equal(workflow.active, false);
  assert.equal(workflow.connections['Run Example'].main[0][0].node, node.name);
  assert.match(readme, /does \*\*not\*\* use the free daily allowance/);
  assert.match(readme, /not\s+verified for n8n Cloud/);
});

function OPS_PATHS() {
  return require('../dist/nodes/Tanod/operations.js').OPS.map((entry) => entry.value);
}

test('publish workflow is tag-only, repository-bound, OIDC/provenance-enabled and checks exact version', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
  assert.ok(!workflow.includes('workflow_dispatch:'));
  assert.match(workflow, /tags:\s+\- 'v\*'/);
  assert.match(workflow, /github\.repository == 'tanod-labs\/n8n-nodes-tanod'/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm ci --include=dev --ignore-scripts/);
  assert.match(workflow, /TANOD_LIVE_TEST: '0'/);
  assert.match(workflow, /npm publish \.\/release\/n8n-nodes-tanod\.tgz --provenance --access public --ignore-scripts/);
  const build = workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  publish:'));
  const publish = workflow.slice(workflow.indexOf('  publish:'));
  assert.ok(!build.includes('id-token: write'));
  assert.ok(!build.includes('secrets.'));
  assert.match(build, /git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/);
  assert.match(build, /fetch-depth: 0/);
  assert.match(build, /TANOD_PACKAGE_TARBALL: release\/n8n-nodes-tanod\.tgz/);
  assert.match(build, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(publish, /needs: build/);
  assert.match(publish, /environment: npm-publish/);
  assert.match(publish, /uses: actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(publish, /EXPECTED_SHA256: \$\{\{ needs.build.outputs.tarball_sha256 \}\}/);
  assert.match(publish, /sha256sum --check/);
  assert.ok(!/uses: actions\/checkout|run: npm (ci|test)|run: npm run (build|lint)/.test(publish));
  const validation = workflow.match(/node <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .split('\n').map((line) => line.slice(10)).join('\n');
  execFileSync(process.execPath, ['-e', validation], { cwd: root, env: { ...process.env, RELEASE_TAG: `v${pkg.version}` }, stdio: 'pipe' });
  for (const tag of ['v0.1.2', `v${pkg.version}-rc.1`, pkg.version, 'v$(echo injected)']) {
    assert.throws(() => execFileSync(process.execPath, ['-e', validation], {
      cwd: root, env: { ...process.env, RELEASE_TAG: tag }, stdio: 'pipe',
    }));
  }
});

test('spend, domain restriction, verification and environment notices stay in README', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const pattern of [/Each input item is one paid call/, /Loop Over Items/, /Split in Batches/, /Retry On Fail/,
    /Retrying an execution/, /Execute step/, /usableAsTool/, /AI Agent/, /steered by untrusted text/,
    /fund a key with only what you are willing to spend/, /Allowed HTTP Request\s+Domains/,
    /This is an unverified community node; n8n has not reviewed it\./, /required\s+reviewers/,
    /trusted publisher/, /npm-publish/, /remove it once trusted publishing works/]) assert.match(readme, pattern);
});

test('older n8n without the connection-types runtime export still loads the node', () => {
  child(`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function (name, ...rest) {
      const loaded = original.call(this, name, ...rest);
      if (name !== 'n8n-workflow') return loaded;
      return new Proxy(loaded, { get(target, key) {
        if (key === 'NodeConnectionTypes') throw new Error('Older n8n has no NodeConnectionTypes export');
        return Reflect.get(target, key);
      } });
    };
    const d = new (require('./dist/nodes/Tanod/Tanod.node.js').Tanod)().description;
    assert.deepEqual(d.inputs, ['main']);
    assert.deepEqual(d.outputs, ['main']);
  `);
});

test('wallet build rejects nested node_modules before collecting incomplete licenses', () => {
  for (const input of ['node_modules/outer/node_modules/inner/index.js', 'node_modules/@a/outer/node_modules/@b/inner/index.js',
    'node_modules\\\\outer\\\\node_modules\\\\inner\\\\index.js']) {
    child(`
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      const original = Module._load;
      Module._load = function (name, ...rest) {
        if (name === 'esbuild') return { buildSync: () => ({ metafile: { outputs: {}, inputs: { [${JSON.stringify(input)}]: {} } } }) };
        return original.call(this, name, ...rest);
      };
      assert.throws(() => require('./scripts/bundle-wallet.js'), /Nested node_modules wallet input is unsupported/);
    `);
  }
});

test('main-history release guard rejects off-main tags in an offline git fixture', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
  const guard = workflow.match(/test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"\n          git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/)[0]
    .replace(/\n          /g, '\n');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanod-release-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: temp, stdio: 'pipe', encoding: 'utf8' }).trim();
  const env = { ...process.env };
  try {
    git('init', '-q', '--initial-branch=main');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);
    execFileSync('bash', ['-euo', 'pipefail', '-c', guard], { cwd: temp, env: { ...env, RELEASE_SHA: base }, stdio: 'pipe' });
    git('checkout', '-q', '-b', 'off-main');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'unmerged');
    const offMain = git('rev-parse', 'HEAD');
    assert.throws(() => execFileSync('bash', ['-euo', 'pipefail', '-c', guard], {
      cwd: temp, env: { ...env, RELEASE_SHA: offMain }, stdio: 'pipe',
    }));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('package/lock agree and all wallet/build dependencies are dev-only', () => {
  assert.equal(pkg.version, '0.1.3');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(pkg.dependencies, {});
  assert.equal(pkg.optionalDependencies, undefined);
  assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
  assert.equal(pkg.bundleDependencies, undefined);
  for (const name of ['@x402/core', '@x402/evm', '@x402/fetch', 'viem', 'esbuild']) {
    assert.ok(pkg.devDependencies[name]);
    assert.equal(lock.packages[`node_modules/${name}`].dev, true);
  }
});

test('free and credit modules import and execute without loading wallet chunk or external SDKs', () => {
  child(`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function (name, ...rest) {
      if (/walletSdk|^@x402\\/|^viem(\\/|$)/.test(name)) throw new Error('Unexpected wallet load: ' + name);
      return original.call(this, name, ...rest);
    };
    const { Tanod } = require('./dist/nodes/Tanod/Tanod.node.js');
    require('./dist/credentials/TanodCreditsApi.credentials.js');
    const { tanodCreditRequest } = require('./dist/nodes/Tanod/creditsTransport.js');
    const { tanodRequest } = require('./dist/nodes/Tanod/transport.js');
    (async () => {
      const key = 'tnd_' + 'a'.repeat(43);
      const ctx = {
        getCredentials: async (name) => { assert.equal(name, 'tanodCreditsApi'); return { creditKey: key }; },
        helpers: { httpRequestWithAuthentication: async () => ({ statusCode: 200, body: { credit: true } }) },
        getInputData: () => [{ json: {} }],
        getNodeParameter: (name, i, fallback) => ({ paymentMode: 'credits', operation: 'verifyEmail', email: 'person@example.com' }[name] ?? fallback),
      };
      assert.deepEqual(await tanodCreditRequest(ctx, '/v1/ocr', {}), { credit: true });
      assert.deepEqual(await Tanod.prototype.execute.call(ctx), [[{ json: { credit: true }, pairedItem: { item: 0 } }]]);
      global.fetch = async () => new Response('{"free":true}');
      assert.deepEqual(await tanodRequest({ path: '/v1/ocr', body: {}, price: '1', useFree: true, maxPriceUsd: 0 }), { free: true });
      global.fetch = async () => new Response('{"x402Version":1,"accepts":[]}', { status: 402 });
      await assert.rejects(tanodRequest({ path: '/v1/ocr', body: {}, price: '1', useFree: true, maxPriceUsd: 0 }), /Payment required/);
      // A workflow without paymentMode still takes the historical free path.
      ctx.getNodeParameter = (name, i, fallback) => ({ operation: 'verifyEmail', email: 'person@example.com' }[name] ?? fallback);
      ctx.getCredentials = async (name) => { assert.equal(name, 'tanodX402Api'); throw new Error('no wallet'); };
      global.fetch = async () => new Response('{"free":true}');
      assert.deepEqual(await Tanod.prototype.execute.call(ctx), [[{ json: { free: true }, pairedItem: { item: 0 } }]]);
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `);
});

test('packed wallet chunk works outside source tree with no installed SDK runtime dependencies', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanod-pack-'));
  try {
    let archive;
    if (process.env.TANOD_PACKAGE_TARBALL) {
      // CI passes the single artifact that the publish-only job will download.
      archive = path.resolve(root, process.env.TANOD_PACKAGE_TARBALL);
    } else {
      const packedOutput = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
        { cwd: root, encoding: 'utf8', timeout: 30000 }));
      const pack = Array.isArray(packedOutput) ? packedOutput[0] : Object.values(packedOutput)[0];
      archive = path.join(temp, pack.filename);
    }
    const names = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 30000 })
      .trim().split('\n').map((entry) => entry.replace(/^package\//, '')));
    for (const entry of [...pkg.n8n.nodes, ...pkg.n8n.credentials, 'README.md', 'LICENSE', 'dist/WALLET-LICENSES.txt',
      'dist/credentials/tanod.svg', 'dist/nodes/Tanod/tanod.svg', 'dist/nodes/Tanod/walletSdk.js']) assert.ok(names.has(entry), entry);
    assert.ok(![...names].some((name) => name.startsWith('node_modules/') || /(?:^|\/)\.env/.test(name)));
    execFileSync('tar', ['-xzf', archive, '-C', temp], { timeout: 30000 });
    const isolated = path.join(temp, 'package');
    const packed = JSON.parse(fs.readFileSync(path.join(isolated, 'package.json')));
    assert.deepEqual(packed.dependencies, {});
    assert.ok(!fs.existsSync(path.join(isolated, 'node_modules')));
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      const original = Module._load;
      Module._load = function (name, ...rest) {
        if (/^@x402\\/|^viem(\\/|$)/.test(name)) throw new Error('Runtime SDK dependency: ' + name);
        return original.call(this, name, ...rest);
      };
      const { loadPrivateKeyToAccount, x402Client, ExactEvmScheme } = require('./dist/nodes/Tanod/walletSdk.js');
      const { tanodRequest } = require('./dist/nodes/Tanod/transport.js');
      (async () => {
        const account = (await loadPrivateKeyToAccount())('0x' + 'ab'.repeat(32));
        assert.match(account.address, /^0x[0-9a-fA-F]{40}$/);
        assert.equal(typeof x402Client, 'function');
        assert.equal(typeof ExactEvmScheme, 'function');
        const required = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000',
          payTo: '0x593857A4a4F619543ea12394137C3004ce841720', maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2' } }] };
        let paid = 0;
        global.fetch = async (input, init) => {
          const req = new Request(input, init);
          if (req.headers.has('payment-signature')) { paid++; return new Response('{"paid":true}'); }
          return new Response('', { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify(required)).toString('base64') } });
        };
        assert.deepEqual(await tanodRequest({ path: '/v1/ocr', body: {}, price: '0.001', useFree: false,
          privateKey: '0x' + 'ab'.repeat(32), maxPriceUsd: 0.005 }), { paid: true });
        assert.equal(paid, 1);
      })().catch(e => { console.error(e); process.exitCode = 1; });
    `], { cwd: isolated, stdio: 'pipe', timeout: 30000 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
