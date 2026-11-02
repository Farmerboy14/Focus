'use strict';
// The desktop sky: where the Sun, Moon and planets are, and the live cloud maps.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, run } = require('./harness');
const K = require('../app/ui/sky');
const E = require('../app/ui/earth');
const { makeClouds } = require('../app/lib/clouds');

function sep(a, b) { // degrees between two RA/Dec points
  const r = Math.PI / 180;
  const c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r);
  return Math.acos(Math.min(1, c)) / r;
}

// Reference positions (J2000, geocentric) from PyEphem for 2026-11-02 21:00 UTC.
const REF = { sun: [217.67, -14.84], moon: [145.57, 14.09], venus: [201.50, -13.77], mars: [142.14, 16.63], jupiter: [146.72, 14.12], saturn: [9.13, 1.02] };

test('the Sun, Moon and planets are where PyEphem puts them', function () {
  const s = K.at(Date.UTC(2026, 10, 2, 21, 0));
  s.bodies.forEach(function (b) {
    if (!REF[b.id]) return;
    const d = sep([b.ra, b.dec], REF[b.id]);
    assert.ok(d < (b.id === 'moon' ? 0.5 : 0.2), b.id + ' is ' + d.toFixed(2) + '° off');
  });
  assert.ok(Math.abs(s.gmst - 357.148) < 0.01, 'sidereal time ' + s.gmst);
});

test('the Moon\'s phase is right (39% lit on Nov 2, 2026)', function () {
  const p = K.moonPhase(K.at(Date.UTC(2026, 10, 2, 21, 0)));
  assert.ok(Math.abs(p - 0.388) < 0.03, 'phase ' + p);
});

test('the Sun from the planets agrees with the quick subsolar formula to about a degree', function () {
  [Date.UTC(2026, 10, 2, 21, 0), Date.UTC(2027, 5, 21, 6, 30), Date.UTC(2028, 2, 1, 15, 0)].forEach(function (t) {
    const s = K.at(t), sun = s.bodies[0], sub = E.roughSubsolar(t);
    const lon = ((sun.ra - s.gmst) % 360 + 540) % 360 - 180;
    assert.ok(sep([lon, sun.dec], [sub.lon, sub.lat]) < 1.3, new Date(t).toISOString() + ': ' + lon.toFixed(2) + ',' + sun.dec.toFixed(2) + ' vs ' + sub.lon.toFixed(2) + ',' + sub.lat.toFixed(2));
  });
});

test('the star data is there and sane', function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'ui', 'stars-data.js'), 'utf8');
  const arr = JSON.parse(src.slice(src.indexOf('= [') + 2, src.lastIndexOf(']') + 1));
  assert.strictEqual(arr.length % 4, 0);
  assert.ok(arr.length / 4 > 5000, (arr.length / 4) + ' stars');
  // Sirius first: RA 101.29°, Dec -16.72°, magnitude -1.44
  assert.ok(Math.abs(arr[0] - 10129) < 5 && Math.abs(arr[1] + 1672) < 5 && arr[2] < -140, 'brightest is Sirius: ' + arr.slice(0, 4));
});

function jpeg(n, fill) { const b = Buffer.alloc(n, fill || 7); b[0] = 0xFF; b[1] = 0xD8; return b; }
function fakeFetch(answers, calls) {
  return async function (url) {
    calls.push(url);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { ok: a.status ? a.status < 400 : true, status: a.status || 200, headers: { get: function (h) { return h === 'last-modified' ? a.lm : null; } }, arrayBuffer: async function () { return a.body; } };
  };
}

test('live clouds: a new map is saved and announced; the same map again is not', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-clouds-'));
  const calls = [];
  let news = 0;
  const lm = 'Mon, 02 Nov 2026 18:00:00 GMT';
  const c = makeClouds({ fetch: fakeFetch([{ body: jpeg(90000), lm: lm }, { body: jpeg(90000), lm: lm }, { body: Buffer.from('<html>oops</html>') }, { status: 503 }], calls), userDir: dir, log: function () { }, onNew: function () { news++; } });
  assert.deepStrictEqual(c.info(), { live: false, at: 0, fetched: 0 });
  assert.strictEqual(c.file(), null);
  assert.strictEqual(await c.check(), true);
  assert.strictEqual(news, 1);
  assert.ok(c.file() && fs.statSync(c.file()).size === 90000);
  assert.strictEqual(c.info().at, Date.parse(lm));
  assert.strictEqual(await c.check(), false, 'unchanged');
  assert.strictEqual(news, 1);
  assert.strictEqual(await c.check(), false, 'not a JPEG');
  assert.strictEqual(await c.check(), false, 'server error');
  assert.ok(c.file() && fs.statSync(c.file()).size === 90000, 'the last good map is kept');
  assert.ok(/clouds\.matteason\.co\.uk\/images\/2048x1024\/clouds\.jpg$/.test(calls[0]));
  c.stop();
});

test('live clouds: nothing is fetched while the desktop is off', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-clouds-'));
  const calls = [];
  const c = makeClouds({ fetch: fakeFetch([{ body: jpeg(90000) }], calls), userDir: dir, log: function () { }, enabled: function () { return false; } });
  assert.strictEqual(await c.check(), false);
  assert.strictEqual(calls.length, 0);
  c.stop();
});

test('sunrise and sunset in Kirksville are right (PyEphem: Nov 2, 2026 6:40 AM and 5:08 PM CST)', function () {
  const t = E.sunTimes(new Date(2026, 10, 2, 12).getTime(), 40.19, -92.58);
  const hm = function (ms) { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  assert.ok(Math.abs(hm(t.rise) - (6 * 60 + 40)) <= 3, 'sunrise ' + new Date(t.rise).toTimeString());
  assert.ok(Math.abs(hm(t.set) - (17 * 60 + 8)) <= 3, 'sunset ' + new Date(t.set).toTimeString());
});

run();
