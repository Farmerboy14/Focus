'use strict';
// The phone link against a fake ntfy: subscribe, hello on connect, decrypt, ignore our own and others', dedupe.
const assert = require('assert');
const { test, run } = require('./harness');
const fc = require('../app/lib/crypto');
const { Link, fitText, MAX_PLAIN } = require('../app/lib/link');

const CODE = 'K7QM-2XPA-9RTB-HW4E';
const KEY = fc.deriveKey(CODE);
const TOPIC = fc.deriveTopic(CODE);

function phone(t, fields, id) {
  return fc.encrypt(KEY, JSON.stringify(Object.assign({ v: 1, from: 'phone', id: id || fc.newId(), at: Date.now(), t: t }, fields || {})));
}

test('subscribes, says hello, takes phone messages once, ignores the rest', async () => {
  const posts = [];
  const urls = [];
  let lastId = '';
  const lines = [
    { event: 'open', id: 'o1' },
    { event: 'keepalive', id: 'k1' },
    { event: 'message', id: 'm1', message: phone('state', { sched: { v: 2, days: {}, editedAt: 5 } }, 'aaaaaaaaaaaa') },
    { event: 'message', id: 'm2', message: fc.encrypt(KEY, JSON.stringify({ v: 1, from: 'pc', id: 'bbbbbbbbbbbb', at: 1, t: 'clip', text: 'mine' })) },
    { event: 'message', id: 'm3', message: fc.encrypt(fc.deriveKey('AAAA-AAAA-AAAA-AAAA'), '{"from":"phone","t":"clip"}') },
    { event: 'message', id: 'm4', message: 'garbage!!' },
    { event: 'message', id: 'm5', message: phone('state', {}, 'aaaaaaaaaaaa') },
    { event: 'message', id: 'm6', message: phone('clip', { text: 'hi from phone' }) }
  ];
  const fetch = async (url, opts) => {
    urls.push(url);
    if (opts && opts.method === 'POST') { posts.push({ url: url, body: opts.body, type: opts.headers['Content-Type'] }); return new Response('{}', { status: 200 }); }
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        const all = lines.map((l) => JSON.stringify(l) + '\n').join('');
        // deliver in awkward chunks to exercise line splitting
        for (let i = 0; i < all.length; i += 37) c.enqueue(enc.encode(all.slice(i, i + 37)));
        c.close();
      }
    });
    return new Response(body, { status: 200 });
  };
  const link = new Link({ fetch: fetch, getLastId: () => lastId, setLastId: (id) => { lastId = id; } });
  const got = [];
  link.on('message', (e) => got.push(e));
  link.start(CODE);
  await new Promise((r) => setTimeout(r, 300));
  link.stop();
  assert.strictEqual(urls[0], 'https://ntfy.sh/' + TOPIC + '/json?since=10m');
  assert.deepStrictEqual(got.map((e) => e.t), ['state', 'clip']);
  assert.strictEqual(got[1].text, 'hi from phone');
  assert.strictEqual(lastId, 'm6');
  const hello = posts.find((p) => JSON.parse(fc.decrypt(KEY, p.body)).t === 'hello');
  assert.ok(hello, 'sent hello on connect');
  assert.strictEqual(hello.url, 'https://ntfy.sh/' + TOPIC);
  assert.strictEqual(hello.type, 'text/plain');
  const env = JSON.parse(fc.decrypt(KEY, hello.body));
  assert.strictEqual(env.from, 'pc');
  assert.strictEqual(env.v, 1);
  assert.ok(/^[0-9a-f]{12}$/.test(env.id));
});

test('resumes from the last message id', async () => {
  const urls = [];
  const link = new Link({ fetch: async (u) => { urls.push(u); throw new Error('offline'); }, getLastId: () => 'Xy12abc' });
  link.start(CODE);
  await new Promise((r) => setTimeout(r, 50));
  link.stop();
  assert.strictEqual(urls[0], 'https://ntfy.sh/' + TOPIC + '/json?since=Xy12abc');
});

test('big clipboard text is cut to fit the relay limit', async () => {
  let body = null;
  const link = new Link({ fetch: async (u, o) => { body = o.body; return new Response('{}'); } });
  link.key = KEY; link.topic = TOPIC;
  assert.ok(await link.send('clip', { text: '✓'.repeat(2000) }));
  assert.ok(body.length < 4000, 'wire under 4000 bytes, was ' + body.length);
  const env = JSON.parse(fc.decrypt(KEY, body));
  assert.ok(env.text.length > 500 && env.text.length <= 2000);
  assert.ok(Buffer.byteLength(JSON.stringify(env)) <= MAX_PLAIN);
  const plain = fitText({ text: 'a'.repeat(5000) }, 'text');
  assert.strictEqual(plain.text.length, 2000);
});

test('state carries {v:2, days, names, editedAt}, and a small week fits', async () => {
  const S = require('../app/lib/schedule');
  let body = null;
  const logs = [];
  const link = new Link({ fetch: async (u, o) => { body = o.body; return new Response('{}'); }, log: (m) => logs.push(m) });
  link.key = KEY; link.topic = TOPIC;
  const sc = S.normalize({ v: 2, days: { mon: [{ start: '06:30', end: '06:45', title: 'Wake up', preset: 'strict', note: 'Water.' }, { start: '22:30', end: '06:30', title: 'Sleep', preset: 'strict', note: '' }] }, editedAt: 9 },
    { v: 2, days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }, names: S.DEFAULT_NAMES, editedAt: 0 });
  assert.ok(await link.send('state', { sched: S.wire(sc) }));
  assert.ok(body.length < 4000, 'wire was ' + body.length);
  const env = JSON.parse(fc.decrypt(KEY, body));
  assert.deepStrictEqual(Object.keys(env.sched), ['v', 'days', 'names', 'editedAt']);
  assert.strictEqual(env.sched.v, 2);
  assert.strictEqual(env.sched.days.mon[1].end, '06:30');
  assert.ok(!('wakeAt' in env.sched) && !('prevWakeAt' in env.sched) && !('defaultWake' in env.sched) && !('blocks' in env.sched));
  // The full default week is far over ntfy's limit (PROTOCOL.md): it is refused and logged, never cut.
  body = null;
  assert.strictEqual(await link.send('state', { sched: S.wire(S.defaultSched()) }), false);
  assert.strictEqual(body, null);
  assert.ok(logs.some((m) => /state too big/.test(m)));
});

run('link');
