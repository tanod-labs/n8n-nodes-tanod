const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'nodes', 'Tanod', 'tanod.svg');
for (const dir of ['nodes/Tanod', 'credentials']) {
  const dstDir = path.join(__dirname, '..', 'dist', dir);
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, 'tanod.svg'));
}
