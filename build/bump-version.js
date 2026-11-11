const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const parts = String(pkg.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);

// Максимум 9 в патче: 1.1.9 -> 1.2.0
parts[2] += 1;
if (parts[2] > 9) {
  parts[2] = 0;
  parts[1] += 1;
}

pkg.version = parts.join('.');
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log('Version -> ' + pkg.version);
