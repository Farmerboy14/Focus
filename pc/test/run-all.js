'use strict';
// Runs every *.test.js in its own process, in America/Chicago so the daylight-saving cases mean something.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', env: Object.assign({}, process.env, { TZ: 'America/Chicago' }) });
  if (r.status !== 0) failed++;
}
console.log(failed ? '\n' + failed + ' test file(s) failed' : '\nall ' + files.length + ' test files passed');
process.exit(failed ? 1 : 0);
