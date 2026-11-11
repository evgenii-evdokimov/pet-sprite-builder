const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const name = `Pet Sprite Builder Setup ${pkg.version}.exe`;
const src = path.join(root, 'dist', name);
const dst = path.join(root, name);

if (!fs.existsSync(src)) {
  console.error('Installers not found: ' + src);
  process.exit(1);
}

for (const f of fs.readdirSync(root)) {
  if (/^Pet Sprite Builder Setup .*\.exe$/i.test(f) && f !== name) {
    try {
      fs.unlinkSync(path.join(root, f));
    } catch (_) {}
  }
}

fs.copyFileSync(src, dst);
console.log('Installer -> ' + dst);
