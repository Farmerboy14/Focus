'use strict';
// Updates: version check against GitHub's contents API, download, unzip to app.new, keep the Bible and fonts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, run } = require('./harness');
const { makeUpdater } = require('../app/lib/updater');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-upd-'));
const bundled = path.join(tmp, 'bundled');
fs.mkdirSync(path.join(bundled, 'res', 'fonts'), { recursive: true });
fs.writeFileSync(path.join(bundled, 'res', 'kjv.txt'), 'BIBLE');
fs.writeFileSync(path.join(bundled, 'res', 'fonts', 'a.ttf'), 'FONT');
const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'ui'), { recursive: true });
fs.writeFileSync(path.join(pkg, 'main.js'), '// v2');
fs.writeFileSync(path.join(pkg, 'ui', 'index.html'), '<p>v2</p>');
fs.writeFileSync(path.join(pkg, 'version.json'), JSON.stringify({ version: 2, name: '1.1' }));
execFileSync('zip', ['-qrX', path.join(tmp, 'app.zip'), '.'], { cwd: pkg });
const zip = fs.readFileSync(path.join(tmp, 'app.zip'));

function fakeFetch(version) {
  const seen = [];
  const f = async (url, opts) => {
    seen.push({ url: url, accept: opts.headers.Accept });
    if (url.indexOf('version.json') >= 0) return new Response(JSON.stringify({ version: version, name: '1.1', minBootstrap: 1 }));
    if (url.indexOf('app.zip') >= 0) return new Response(zip);
    return new Response('nope', { status: 404 });
  };
  f.seen = seen;
  return f;
}

test('no update when the version is the same', async () => {
  const f = fakeFetch(1);
  const u = makeUpdater({ fetch: f, current: { version: 1 }, userDir: path.join(tmp, 'user'), bundledDir: bundled, bootstrapVersion: 1 });
  assert.strictEqual((await u.check()).available, false);
  assert.strictEqual(f.seen[0].url, 'https://api.github.com/repos/Farmerboy14/focus/contents/pc/release/version.json?ref=main');
  assert.strictEqual(f.seen[0].accept, 'application/vnd.github.raw+json');
});

test('a newer version is downloaded into app.new with the Bible and fonts', async () => {
  const f = fakeFetch(2);
  const user = path.join(tmp, 'user');
  const u = makeUpdater({ fetch: f, current: { version: 1 }, userDir: user, bundledDir: bundled, bootstrapVersion: 1 });
  const r = await u.check();
  assert.strictEqual(r.available, true);
  const v = await u.install(r.info);
  assert.strictEqual(v.version, 2);
  assert.strictEqual(f.seen[1].url, 'https://api.github.com/repos/Farmerboy14/focus/contents/pc/release/app.zip?ref=main');
  const fresh = path.join(user, 'app.new');
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'main.js'), 'utf8'), '// v2');
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'res', 'kjv.txt'), 'utf8'), 'BIBLE');
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'res', 'fonts', 'a.ttf'), 'utf8'), 'FONT');
});

test('a package that needs a newer bootstrap is skipped', async () => {
  const f = async (url) => new Response(JSON.stringify({ version: 9, minBootstrap: 2 }));
  const u = makeUpdater({ fetch: f, current: { version: 1 }, userDir: path.join(tmp, 'u2'), bundledDir: bundled, bootstrapVersion: 1 });
  assert.strictEqual((await u.check()).available, false);
});

run('updater');
