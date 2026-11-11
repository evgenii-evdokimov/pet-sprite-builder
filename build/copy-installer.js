const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

const builtName = `Pet Sprite Builder Setup ${version}.exe`;
const releaseName = `PetSpriteBuilderSetup-${version}.exe`;
const src = path.join(root, 'dist', builtName);
const dst = path.join(root, releaseName);

if (!fs.existsSync(src)) {
  console.error('Installers not found: ' + src);
  process.exit(1);
}

// Оставляем в корне только один exe — тот, что используется в latest.json/релизе.
for (const f of fs.readdirSync(root)) {
  const isInstaller = /^(Pet Sprite Builder Setup|PetSpriteBuilderSetup-).*\.exe$/i.test(f);
  if (isInstaller && f !== releaseName) {
    try {
      fs.unlinkSync(path.join(root, f));
      console.log('Removed old installer: ' + f);
    } catch (e) {
      console.warn('Не удалось удалить ' + f + ': ' + e.message);
    }
  }
}

fs.copyFileSync(src, dst);
console.log('Installer -> ' + dst);

// Синхронизируем latest.json с текущей версией, сохраняя заметки.
const latestPath = path.join(root, 'latest.json');
let latest = {};
try {
  latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
} catch (_) {}
latest.version = version;
latest.url = `https://github.com/evgenii-evdokimov/pet-sprite-builder/releases/download/v${version}/${releaseName}`;
if (!Array.isArray(latest.notes)) latest.notes = [];
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n', 'utf-8');
console.log('latest.json -> ' + version);
