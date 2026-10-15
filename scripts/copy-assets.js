const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'nodes', 'Tanod', 'tanod.svg');
const dstDir = path.join(__dirname, '..', 'dist', 'nodes', 'Tanod');
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, path.join(dstDir, 'tanod.svg'));
