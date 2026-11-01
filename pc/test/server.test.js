'use strict';
// The extension endpoint: localhost only, and web pages can't use it.
const assert = require('assert');
const http = require('http');
const { test, run } = require('./harness');
const { startServer, PORT } = require('../app/lib/server');

function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: method, path: path, headers: headers || {} }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

let srv;
const calls = [];
test('starts', async () => {
  srv = startServer({
    policy: () => ({ v: 1, blocked: [] }),
    youtube: (s) => { calls.push(['yt', s]); return { v: 1 }; },
    sendPage: (u) => { calls.push(['send', u]); return { ok: true }; },
    show: (v) => { calls.push(['show', v]); }
  }, () => { });
  await new Promise((r) => setTimeout(r, 200));
});

test('the extension can read the policy and post', async () => {
  const ext = { Origin: 'chrome-extension://abcdefghijklmnop' };
  assert.strictEqual((await req('GET', '/policy', ext)).body.v, 1);
  assert.strictEqual((await req('GET', '/policy')).status, 200);
  const r = await req('POST', '/youtube', Object.assign({ 'Content-Type': 'application/json', 'X-Focus': '1' }, ext), JSON.stringify({ seconds: 15 }));
  assert.strictEqual(r.status, 200);
  await req('POST', '/send', Object.assign({ 'Content-Type': 'application/json', 'X-Focus': '1' }, ext), JSON.stringify({ url: 'https://example.com' }));
  assert.deepStrictEqual(calls, [['yt', 15], ['send', 'https://example.com']]);
});

test('web pages and other hosts are refused', async () => {
  assert.strictEqual((await req('GET', '/policy', { Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await req('POST', '/send', { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, '{"url":"https://x.y"}')).status, 403);
  assert.strictEqual((await req('POST', '/send', { 'Content-Type': 'text/plain' }, '{"url":"https://x.y"}')).status, 403, 'needs X-Focus');
  assert.strictEqual((await req('GET', '/policy', { Host: 'evil.example:47613' })).status, 403, 'DNS rebinding');
  assert.strictEqual((await req('OPTIONS', '/send', { Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual(calls.length, 2);
});

test('stops', () => { srv.close(); });

run('server');
