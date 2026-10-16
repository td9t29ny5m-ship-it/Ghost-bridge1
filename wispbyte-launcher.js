// Wispbyte root launcher for Ghost Bridge.
// Keep this file in the Wispbyte server root as server.js.
// It finds the extracted project folder and supplies Wispbyte's web port
// before loading the real app.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT || process.env.SERVER_PORT || '12019';
process.env.PORT = String(port);

const entries = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  .map(entry => path.join(root, entry.name));

const projectDir = entries.find(dir =>
  fs.existsSync(path.join(dir, 'server.js')) &&
  fs.existsSync(path.join(dir, 'ghost.js')) &&
  fs.existsSync(path.join(dir, 'package.json')) &&
  fs.existsSync(path.join(dir, 'public', 'index.html'))
);

if (!projectDir) {
  console.error('Ghost Bridge project folder not found.');
  console.error('Expected a direct child folder containing server.js, ghost.js, package.json, and public/index.html.');
  console.error('Server root:', root);
  process.exit(1);
}

console.log('Ghost Bridge project found:', projectDir);
console.log('Web port configured as:', process.env.PORT);
require(path.join(projectDir, 'server.js'));
