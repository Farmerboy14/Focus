#!/bin/bash
# Publishes a small update for Focus for Windows (no Electron, just the app folder).
# Usage: pc/release.sh <version number> <version name> "<short note>"
#   e.g. pc/release.sh 2 1.1 "Bigger dial on the widget"
# Writes pc/release/app.zip and pc/release/version.json; commit and push them to main.
# Installed copies check every 6 hours (or Settings → Check for updates) and switch over on their next start.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=${1:?version number (integer, higher than the last)}
NAME=${2:?version name, like 1.1}
NOTES=${3:-}
node -e "
const fs = require('fs');
const v = JSON.parse(fs.readFileSync('app/version.json', 'utf8'));
const n = parseInt(process.argv[1], 10);
if (!(n > 0)) { console.error('version must be a positive integer'); process.exit(1); }
v.version = n; v.name = process.argv[2]; v.notes = process.argv[3]; v.minBootstrap = v.minBootstrap || 1;
fs.writeFileSync('app/version.json', JSON.stringify(v, null, 2) + '\n');
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/version.json', JSON.stringify(v, null, 2) + '\n');
" "$VERSION" "$NAME" "$NOTES"
for f in app/*.js app/lib/*.js app/ui/*.js; do node --check "$f"; done
rm -f release/app.zip
# The Bible and fonts never change, so updates leave them out; the app copies them from the installed version.
(cd app && zip -qrX9 ../release/app.zip . -x 'res/kjv.txt' -x 'res/fonts/*')
ls -la release/
cat release/version.json
