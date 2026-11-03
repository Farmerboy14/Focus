'use strict';
// This month's 8K Earth maps: fetched once, kept, last month's cleared away.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, run } = require('./harness');
const { makeEarthMaps, BASE } = require('../app/lib/earthmaps');

function jpeg(n) { const b = Buffer.alloc(n, 9); b[0] = 0xFF; b[1] = 0xD8; return b; }

test('fetches the day, night and water maps for this month, then nothing more', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-maps-'));
  const calls = [];
  let news = 0;
  const t = new Date(2026, 10, 3, 13, 0).getTime();
  const m = makeEarthMaps({ fetch: async function (u) { calls.push(u); return { ok: true, status: 200, arrayBuffer: async function () { return jpeg(600000); } }; },
    userDir: dir, log: function () { }, onNew: function () { news++; }, now: function () { return t; } });
  assert.strictEqual(m.file('day'), null);
  await m.check();
  assert.deepStrictEqual(calls.map(function (u) { return u.slice(BASE.length); }), ['earth/11.jpg', 'earth-night/11.jpg', 'specular-base/11.jpg']);
  assert.ok(/github/.test(BASE) && /530c011d/.test(BASE), 'from the pinned GitHub copy');
  assert.strictEqual(news, 1);
  assert.ok(/day-11\.jpg$/.test(m.file('day')) && /water-11\.jpg$/.test(m.file('water')));
  await m.check();
  assert.strictEqual(calls.length, 3, 'already have them');
  m.stop();
});

test('a new month swaps the maps; a bad download keeps the old ones', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-maps-'));
  fs.mkdirSync(path.join(dir, 'earthmaps'));
  ['day', 'night', 'water'].forEach(function (k) { fs.writeFileSync(path.join(dir, 'earthmaps', k + '-10.jpg'), jpeg(10)); });
  let bad = true;
  const t = new Date(2026, 10, 3).getTime();
  const m = makeEarthMaps({ fetch: async function () { return { ok: true, status: 200, arrayBuffer: async function () { return bad ? Buffer.from('<html>') : jpeg(600000); } }; },
    userDir: dir, log: function () { }, now: function () { return t; } });
  await m.check();
  assert.ok(/day-10\.jpg$/.test(m.file('day')), 'last month still shows while this month fails');
  bad = false;
  await m.check();
  assert.ok(/day-11\.jpg$/.test(m.file('day')));
  assert.ok(!fs.existsSync(path.join(dir, 'earthmaps', 'day-10.jpg')), 'October is cleared away');
  m.stop();
});

run();
