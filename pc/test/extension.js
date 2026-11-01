'use strict';
// Loads the real extension in Chromium against the app's real HTTP endpoint (lib/server.js) with a scripted
// policy. Checks: blocked sites redirect to "Not now", other sites load, YouTube time is reported, and going
// over the limit sends the YouTube tab to "Not now". Usage: xvfb-run -a node test/extension.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { startServer } = require('../app/lib/server');

const EXT = path.join(__dirname, '..', 'extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const policy = {
    v: 1, now: Date.now(), preset: 'work', presetName: 'Work', block: { title: 'Work', end: 0, endLabel: '7:00 PM' }, next: null,
    nextFree: 0, nextFreeLabel: '8:00 PM', paused: false, blocked: [{ host: 'blocked.test', kind: 'entertainment' }],
    yt: { counting: true, limitMin: 15, usedSec: 0, over: false }
  };
  const reported = [];
  const sent = [];
  const srv = startServer({
    policy: () => policy,
    youtube: (s) => { reported.push(s); policy.yt.usedSec += s; return policy; },
    sendPage: (u) => { sent.push(u); return { ok: true }; },
    show: () => ({ ok: true })
  }, (m) => console.log('server log: ' + m));
  // youtube.com is HSTS-preloaded, so it needs HTTPS (a throwaway self-signed cert).
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-cert-'));
  require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=www.youtube.com', '-keyout', path.join(certDir, 'k.pem'), '-out', path.join(certDir, 'c.pem')], { stdio: 'ignore' });
  const tls = require('https').createServer({ key: fs.readFileSync(path.join(certDir, 'k.pem')), cert: fs.readFileSync(path.join(certDir, 'c.pem')) }, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>YouTube</title><h1>video</h1>'); }).listen(8443, '127.0.0.1');
  const web = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>site</title><h1>hello from ' + req.headers.host + '</h1>'); }).listen(8123, '127.0.0.1');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    ignoreHTTPSErrors: true,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT, '--host-resolver-rules=MAP *.test 127.0.0.1, MAP www.youtube.com 127.0.0.1', '--no-sandbox', '--no-proxy-server']
  });
  const checks = [];
  const ok = (n) => { checks.push(n); console.log('  ok   ' + n); };
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    ok('service worker started (manifest valid): ' + sw.url().replace(/^chrome-extension:\/\/[a-z]+/, 'chrome-extension://…'));
    await sleep(2500);
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.ok(rules.some((r) => r.condition.requestDomains[0] === 'blocked.test'), JSON.stringify(rules));
    ok('policy fetched from 127.0.0.1:47613 and turned into ' + rules.length + ' blocking rule(s)');

    const page = await ctx.newPage();
    await page.goto('http://allowed.test:8123/');
    assert.ok((await page.textContent('h1')).indexOf('allowed.test') >= 0);
    ok('an allowed site loads');

    await page.goto('http://blocked.test:8123/').catch(() => { });
    await page.waitForURL(/notnow\.html/, { timeout: 8000 });
    assert.ok(/k=entertainment/.test(page.url()));
    await page.waitForTimeout(1200);
    assert.strictEqual((await page.textContent('#big')).trim(), 'Not now.');
    assert.ok((await page.textContent('#msg')).indexOf('Free time') >= 0);
    ok('a blocked site redirects to the extension\'s "Not now" page: ' + (await page.textContent('#msg')).trim());

    await page.goto('https://www.youtube.com:8443/watch?v=x');
    await page.bringToFront();
    const t0 = Date.now();
    while (!reported.length && Date.now() - t0 < 40000) await sleep(1000);
    assert.ok(reported.length > 0, 'YouTube time reported');
    ok('YouTube time counted and reported to the app (' + reported.join('+') + ' s)');

    policy.yt.over = true;
    await page.waitForURL(/notnow\.html\?k=youtube/, { timeout: 25000 });
    ok('over the limit, the open YouTube tab goes to "Not now"');

    const r = await sw.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:47613/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Focus': '1' }, body: JSON.stringify({ url: 'https://example.com/a' }) });
      return res.status;
    });
    assert.strictEqual(r, 200);
    assert.deepStrictEqual(sent, ['https://example.com/a']);
    ok('"Send page to phone" request accepted from the extension origin');
  } finally {
    await ctx.close();
    srv.close();
    web.close();
    tls.close();
  }
  console.log('passed ' + checks.length + ' extension checks');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });
