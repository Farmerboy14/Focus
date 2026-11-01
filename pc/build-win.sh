#!/bin/bash
# Builds dist/FocusPC-win32-x64.zip (Focus.exe + Electron + the bootstrap + the bundled app).
# Runs on Linux: no wine needed, because the exe's icon isn't embedded (the window and tray icons are set at runtime).
set -euo pipefail
cd "$(dirname "$0")"
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")
rm -rf dist/stage dist/build dist/FocusPC-win32-x64.zip
mkdir -p dist/stage
cp bootstrap.js dist/stage/
cp -r app dist/stage/app
node -e "
const p = require('./package.json');
require('fs').writeFileSync('dist/stage/package.json', JSON.stringify({ name: 'focus', productName: 'Focus', version: p.version, description: p.description, main: 'bootstrap.js', author: p.author }, null, 2));
"
npx --no-install electron-packager dist/stage Focus \
  --platform=win32 --arch=x64 --electron-version="$ELECTRON_VERSION" \
  --out=dist/build --overwrite --no-asar --prune=false --no-deref-symlinks \
  --app-copyright="Caleb" --executable-name=Focus
OUT=dist/build/Focus-win32-x64
test -f "$OUT/Focus.exe"
# The browser extension travels in the same zip.
cp -r extension "$OUT/extension"
(cd dist/build && mv Focus-win32-x64 FocusPC && zip -qr -9 ../FocusPC-win32-x64.zip FocusPC)
ls -la dist/FocusPC-win32-x64.zip
