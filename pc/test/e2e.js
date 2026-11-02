'use strict';
// End to end on Linux: the real Electron main process (bootstrap.js -> app/main.js) under Xvfb,
// a fake ntfy relay, a fake "phone" speaking PROTOCOL.md, and the extension's HTTP endpoint.
// Usage: xvfb-run -a node test/e2e.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fc = require('../app/lib/crypto');
const S = require('../app/lib/schedule');

const ELECTRON = require('electron'); // path to the binary
const ROOT = path.join(__dirname, '..');
const CODE = 'WXYZ-2345-ABCD-EFGH';
const KEY = fc.deriveKey(CODE), TOPIC = fc.deriveTopic(CODE);
const RELAY_PORT = 47700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(p, headers) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 47613, path: p, headers: headers || {} }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', rej));
}
function post(port, p, body, headers) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: port, path: p, method: 'POST', headers: headers || {} }, (x) => { let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => res({ status: x.statusCode, body: d })); });
    r.on('error', rej); r.end(body);
  });
}
function phoneSend(t, fields) {
  const env = Object.assign({ v: 1, from: 'phone', id: fc.newId(), at: Date.now(), t: t }, fields || {});
  return post(RELAY_PORT, '/' + TOPIC, fc.encrypt(KEY, JSON.stringify(env)), { 'Content-Type': 'text/plain' });
}

async function launch(home, extraEnv) {
  const env = Object.assign({}, process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), FOCUS_RELAY: 'http://127.0.0.1:' + RELAY_PORT + '/' }, extraEnv || {});
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, ['--no-sandbox', '--disable-gpu', ROOT], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.output = () => out;
  return child;
}

(async function () {
  const relay = require('./fake-ntfy').start(RELAY_PORT);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-e2e-'));
  const userDir = path.join(home, '.config', 'Focus');
  fs.mkdirSync(userDir, { recursive: true });
  // Saved by Focus 1.0: the old one-day schedule.
  fs.writeFileSync(path.join(userDir, 'focus.json'), JSON.stringify({ pair: { code: fc.normalizeCode(CODE), lastId: '' }, sched: { blocks: [{ title: 'Work', preset: 'work', len: 600 }], defaultWake: 360, wakeAt: 0, prevWakeAt: 0, editedAt: 5 } }));
  const startedAt = Date.now();

  // The phone listens on the topic.
  const fromPc = [];
  http.get({ host: '127.0.0.1', port: RELAY_PORT, path: '/' + TOPIC + '/json?since=10m' }, (r) => {
    let buf = '';
    r.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const ev = JSON.parse(line);
        if (ev.event !== 'message') continue;
        try { const env = JSON.parse(fc.open(KEY, ev.message)); if (env.from === 'pc') fromPc.push(env); } catch (e) { }
      }
    });
  });

  const app = await launch(home);
  const checks = [];
  const ok = (name) => { checks.push(name); console.log('  ok   ' + name); };
  try {
    await sleep(6000);
    assert.ok(app.exitCode === null, 'Electron is still running\n' + app.output());
    ok('Electron main process started (bootstrap -> app/main.js) and is still running');

    // Extension endpoint
    const pol = await get('/policy', { Origin: 'chrome-extension://abc' });
    assert.strictEqual(pol.status, 200);
    const p = JSON.parse(pol.body);
    assert.ok(p.v === 1 && Array.isArray(p.blocked) && p.yt.limitMin === 15);
    ok('GET /policy served by the app: preset ' + p.preset + ', ' + p.blocked.length + ' blocked hosts');
    assert.strictEqual((await get('/policy', { Origin: 'https://evil.example' })).status, 403);
    ok('web-page origins are refused');

    // Phone link: the PC says hello when it connects
    assert.ok(fromPc.some((e) => e.t === 'hello'), 'PC sent hello: ' + JSON.stringify(fromPc));
    ok('PC subscribed and sent an encrypted hello');

    // The old saved one-day schedule was moved to the default week on start.
    let saved = JSON.parse(fs.readFileSync(path.join(userDir, 'focus.json'), 'utf8'));
    assert.strictEqual(saved.sched.v, 2);
    assert.ok(saved.sched.days.mon.length > 10 && !('blocks' in saved.sched) && !('wakeAt' in saved.sched));
    assert.ok(saved.sched.editedAt >= startedAt, 'migrated with editedAt = now');
    ok('the old one-day schedule was replaced by the default week (editedAt now)');

    // A state in the old format is ignored, even if newer.
    fromPc.length = 0;
    await phoneSend('state', { sched: { blocks: [{ title: 'Old phone', preset: 'work', len: 600 }], defaultWake: 360, wakeAt: Date.now(), editedAt: Date.now() + 5000 } });
    await sleep(2500);
    saved = JSON.parse(fs.readFileSync(path.join(userDir, 'focus.json'), 'utf8'));
    assert.strictEqual(saved.sched.v, 2);
    assert.ok(saved.sched.days.mon.length > 10);
    ok('an old-format state from the phone is ignored');

    // A newer version 2 week from the phone is applied, and not echoed back
    const newer = { v: 2, days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }, names: S.DEFAULT_NAMES, editedAt: Date.now() + 10000 };
    S.DAY_KEYS.forEach((k) => { newer.days[k] = [{ start: '06:30', end: '07:00', title: 'Phone-made block', preset: 'god', note: 'Read.' }, { start: '22:30', end: '06:30', title: 'Sleep', preset: 'strict', note: '' }]; });
    await phoneSend('state', { sched: newer });
    await sleep(3000);
    saved = JSON.parse(fs.readFileSync(path.join(userDir, 'focus.json'), 'utf8'));
    assert.strictEqual(saved.sched.days.mon[0].title, 'Phone-made block');
    assert.strictEqual(saved.sched.days.mon[1].end, '06:30');
    assert.strictEqual(saved.sched.editedAt, newer.editedAt);
    ok('phone\'s newer week applied and saved to focus.json');
    assert.strictEqual(fromPc.filter((e) => e.t === 'state').length, 0, 'no echo: ' + JSON.stringify(fromPc.map((e) => e.t)));
    ok('applying it did not echo a state back');

    // An older state is ignored
    const older = Object.assign({}, newer, { days: { mon: [{ start: '09:00', end: '10:00', title: 'Old', preset: 'normal', note: '' }] }, editedAt: 1 });
    await phoneSend('state', { sched: older });
    await sleep(2000);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(userDir, 'focus.json'), 'utf8')).sched.days.mon[0].title, 'Phone-made block');
    ok('an older state from the phone is ignored');

    // hello -> state {v:2, days, names, editedAt}
    fromPc.length = 0;
    await phoneSend('hello');
    await sleep(2500);
    const st = fromPc.find((e) => e.t === 'state');
    assert.ok(st && st.sched, 'PC replied to hello with state');
    assert.deepStrictEqual(Object.keys(st.sched), ['v', 'days', 'names', 'editedAt']);
    assert.strictEqual(st.sched.v, 2);
    assert.strictEqual(st.sched.editedAt, newer.editedAt);
    assert.strictEqual(st.sched.days.tue[0].title, 'Phone-made block');
    ok('PC answered the phone\'s hello with its week (v2, no wake fields)');

    // clip / bible / bad open are handled without crashing
    await phoneSend('clip', { text: 'copied on the phone' });
    await phoneSend('bible', { book: 42, chapter: 3 });
    await phoneSend('open', { url: 'javascript:alert(1)' });
    await sleep(2000);
    assert.ok(app.exitCode === null, 'still running after clip/bible/open');
    ok('clip, bible and a non-http open handled without a crash');

    // YouTube report
    const yt = await post(47613, '/youtube', JSON.stringify({ seconds: 30 }), { 'Content-Type': 'application/json', 'X-Focus': '1', Origin: 'chrome-extension://abc' });
    assert.strictEqual(yt.status, 200);
    ok('POST /youtube accepted (counting=' + JSON.parse(yt.body).yt.counting + ')');

    const log = fs.readFileSync(path.join(userDir, 'log.txt'), 'utf8');
    assert.ok(!/uncaught|unhandled/.test(log), 'log has no uncaught errors:\n' + log);
    assert.ok(/not on Windows, program blocking is off/.test(log));
    ok('log.txt written, no uncaught errors (PowerShell watcher correctly skipped on Linux)');
  } catch (e) {
    try { console.log('--- log.txt ---\n' + fs.readFileSync(path.join(userDir, 'log.txt'), 'utf8')); } catch (x) { }
    console.log('--- electron output ---\n' + app.output().split('\n').filter((l) => !/dbus|Gtk:|NODE_OPTION/.test(l)).join('\n'));
    throw e;
  } finally {
    app.kill();
    await sleep(1000);
  }

  // Update path: a newer app in %APPDATA%/Focus/app.new is swapped in by the bootstrap and loaded.
  const upd = path.join(userDir, 'app.new');
  fs.cpSync(path.join(ROOT, 'app'), upd, { recursive: true, filter: (s) => !s.endsWith('kjv.txt') });
  const v = JSON.parse(fs.readFileSync(path.join(upd, 'version.json'), 'utf8'));
  v.version += 1; v.name = v.name + '-e2e';
  fs.writeFileSync(path.join(upd, 'version.json'), JSON.stringify(v));
  const app2 = await launch(home);
  try {
    await sleep(6000);
    assert.ok(app2.exitCode === null, 'updated app running\n' + app2.output());
    const log = fs.readFileSync(path.join(userDir, 'log.txt'), 'utf8');
    assert.ok(log.indexOf('bootstrap: installed update') >= 0, 'bootstrap installed the update');
    assert.ok(log.indexOf('Focus ' + v.name + ' starting from ' + path.join(userDir, 'app')) >= 0, 'loaded from %APPDATA%/Focus/app');
    assert.ok(!fs.existsSync(upd));
    ok('bootstrap swapped app.new into place and ran ' + v.name + ' from the user folder');
    assert.strictEqual((await get('/policy')).status, 200);
    ok('the updated app serves /policy');
  } finally {
    app2.kill();
    await sleep(800);
  }

  // A broken update falls back to the bundled copy.
  fs.writeFileSync(path.join(userDir, 'app', 'main.js'), 'throw new Error("broken update");');
  const app3 = await launch(home);
  try {
    await sleep(6000);
    assert.ok(app3.exitCode === null, 'fallback app running\n' + app3.output());
    const log = fs.readFileSync(path.join(userDir, 'log.txt'), 'utf8');
    assert.ok(log.indexOf('broken update') >= 0 && log.indexOf('fell back from a broken update') >= 0);
    ok('a broken update falls back to the installed copy');
  } finally {
    app3.kill();
    await sleep(800);
  }
  relay.close();
  console.log('passed ' + checks.length + ' end-to-end checks');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });
