const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('public/index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('No inline application script found');
new vm.Script(match[1], { filename: 'public/index.html:inline-script' });
console.log('Browser application script syntax OK');
