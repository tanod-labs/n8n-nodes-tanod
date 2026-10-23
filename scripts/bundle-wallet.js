const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const build = buildSync({
  absWorkingDir: root,
  entryPoints: ['nodes/Tanod/walletSdk.ts'],
  outfile: 'dist/nodes/Tanod/walletSdk.js',
  bundle: true,
  platform: 'node',
  target: 'node20.15',
  format: 'cjs',
  legalComments: 'linked',
  metafile: true,
});
// Any unexpected external would become a hidden runtime dependency. Node built-ins are OK.
const builtins = new Set(require('node:module').builtinModules.flatMap((name) => [name, `node:${name}`]));
for (const output of Object.values(build.metafile.outputs)) {
  for (const entry of output.imports) {
    if (entry.external && !builtins.has(entry.path)) throw new Error(`Unbundled wallet dependency: ${entry.path}`);
  }
}
// Nested dependency versions need their own license inventory; fail closed until supported.
for (const input of Object.keys(build.metafile.inputs)) {
  if (input.split(/[\\/]/).filter((part) => part === 'node_modules').length > 1) {
    throw new Error(`Nested node_modules wallet input is unsupported: ${input}`);
  }
}
// esbuild retains legal comments, and this inventory includes each bundled package's license file.
const packages = new Set(Object.keys(build.metafile.inputs)
  .filter((input) => input.startsWith('node_modules/'))
  .map((input) => input.split('/').slice(0, input.split('/')[1].startsWith('@') ? 3 : 2).join('/')));
let licenses = 'Bundled wallet compatibility code: third-party licenses\n';
for (const dir of [...packages].sort()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  const licenseFiles = fs.readdirSync(path.join(root, dir)).filter((file) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(file));
  licenses += `\n--- ${manifest.name}@${manifest.version} (${manifest.license}) ---\n`;
  if (!licenseFiles.length) {
    if (!manifest.name.startsWith('@x402/') || manifest.license !== 'Apache-2.0') {
      throw new Error(`No license file for ${manifest.name}`);
    }
    licenses += fs.readFileSync(path.join(__dirname, 'Apache-2.0.txt'), 'utf8') + '\n';
  }
  for (const file of licenseFiles) licenses += fs.readFileSync(path.join(root, dir, file), 'utf8') + '\n';
}
fs.writeFileSync(path.join(root, 'dist', 'WALLET-LICENSES.txt'), licenses);
