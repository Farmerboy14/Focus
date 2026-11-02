'use strict';
// Renders every window and view in Chromium with a stubbed IPC (backed by the real logic modules)
// and saves one screenshot per view. Usage: node test/screens.js <outDir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const S = require('../app/lib/schedule');
const P = require('../app/lib/policy');
const { defaults } = require('../app/lib/store');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'shots'));
fs.mkdirSync(OUT, { recursive: true });
const UI = path.join(__dirname, '..', 'app', 'ui');
const KJV = fs.readFileSync(path.join(__dirname, '..', 'app', 'res', 'kjv.txt'), 'utf8');

// Each page runs at a fixed clock time (Monday 2026-11-02 unless said otherwise), in the default week.
const MON = (h, m) => new Date(2026, 10, 2, h, m || 0).getTime();

function backend(T) {
  const model = defaults();
  model.sched.editedAt = T;
  model.pc.presets.work.modes = { excel: P.ALLOW, chrome: P.REASON, spotify: P.BLOCK };
  model.pc.presets.work.sites = ['news.ycombinator.com'];
  model.seen = { chrome: { t: 3, title: 'Google Chrome' }, excel: { t: 2, title: 'Book1 - Excel' }, code: { t: 4, title: 'VS Code' }, spotify: { t: 1, title: 'Spotify' }, obs64: { t: 0, title: 'OBS' } };
  model.yt = { day: S.dayKey(T), usedSec: 7 * 60 };
  let journal = [
    { t: Date.now() - 86400000 * 3, kind: 'Request', text: 'Wisdom for the store and the Ledger build', answered: 0 },
    { t: Date.now() - 86400000 * 5, kind: 'Thanks', text: 'Thank You for a steady week of sales', answered: 0 },
    { t: Date.now() - 86400000 * 10, kind: 'Request', text: 'Patience on the long work nights', answered: Date.now() - 86400000 * 2 }
  ];
  const snap = () => {
    const t = T;
    return {
      now: t, sched: model.sched, cur: S.current(model.sched, t), today: S.dayOf(t), slots: S.slots(model.sched, t), upcoming: S.upcoming(model.sched, t, 3),
      nextFree: S.nextFree(model.sched, t), pc: model.pc, ytUsedMin: 7, steps: [true, false, false], settings: model.settings, paused: 0,
      pair: { code: 'K7QM-2XPA-9RTB-HW4E', status: 'live', lastMessage: t - 120000, lastHeard: t }, version: { name: '1.0', version: 1, pending: '' },
      seen: Object.keys(model.seen).map((k) => ({ exe: k, title: model.seen[k].title })), reasons: [{ t: t - 600000, exe: 'chrome', why: 'look up the supplier invoice portal' }], platform: 'win32', desk: { mode: 'live', why: '' }
    };
  };
  return async function (name, arg) {
    switch (name) {
      case 'state:get': return snap();
      case 'sched:set': model.sched = S.normalize({ v: 2, days: Object.assign({}, model.sched.days, arg.days || {}), names: arg.names || model.sched.names, editedAt: T }, model.sched); return snap();
      case 'pc:set': model.pc = arg; return snap();
      case 'bible:text': return KJV;
      case 'desk:image': return 'data:' + (/png$/.test(arg) ? 'image/png' : 'image/jpeg') + ';base64,' + fs.readFileSync(path.join(__dirname, '..', 'app', 'res', 'img', arg)).toString('base64');
      case 'journal:unlock': return { entries: journal };
      case 'journal:save': journal = arg; return { ok: true };
      case 'steps:set': return [true, !!arg.on, false];
      case 'pause:start': return P.reasonOk(arg.reason) ? { ok: true, until: Date.now() + 600000 } : { error: 'Write at least four words.' };
      default: return true;
    }
  };
}

const STUB = function () {
  const handlers = {};
  window.focusApp = {
    invoke: function (n, a) { return window.__invoke(n, a === undefined ? null : a); },
    on: function (n, cb) { (handlers[n] = handlers[n] || []).push(cb); }
  };
  window.__emit = function (n, d) { (handlers[n] || []).forEach(function (cb) { cb(d); }); };
};

async function shot(page, name) {
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('  ' + name);
}

(async function () {
  const browser = await chromium.launch();
  const errors = [];
  async function open(file, size, T) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: size.width <= 300 ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(file + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(file + ' console: ' + m.text()); });
    await page.exposeFunction('__invoke', backend(T));
    await page.clock.setFixedTime(T);
    await page.addInitScript(STUB);
    const q = file.indexOf('?');
    await page.goto('file://' + path.join(UI, q < 0 ? file : file.slice(0, q)) + (q < 0 ? '' : file.slice(q)));
    return page;
  }

  // Main window, in Ledger deep work
  let p = await open('index.html', { width: 1100, height: 720 }, MON(10, 20));
  await shot(p, '01-home-work');
  await p.click('[data-go=today]'); await shot(p, '02-today');
  await p.click('#blockList .brow.now'); await shot(p, '02b-today-edit');
  await p.fill('#bsNote', 'The hardest Ledger task first. Phone in the other room.'); await p.click('#bsSave'); await p.waitForTimeout(300);
  await p.click('#dayTabs .chip >> nth=6'); await shot(p, '02c-today-saturday');
  await p.click('#addBlock'); await p.fill('#bsTitle', 'Late bake'); await p.fill('#bsStart', '23:30'); await p.fill('#bsEnd', '00:30'); await shot(p, '02d-today-new-past-midnight');
  await p.click('#bsCancel');
  await p.click('#dayTabs .chip >> nth=2'); await p.click('#copyWeekdays'); await shot(p, '02e-today-copy-confirm');
  await p.click('#copyWeekdays'); await p.waitForTimeout(300);
  await p.click('[data-go=presets]'); await shot(p, '03-presets');
  await p.click('[data-go=bible]'); await shot(p, '04-bible');
  await p.fill('#bibleSearch', 'prayed'); await p.press('#bibleSearch', 'Enter'); await shot(p, '05-bible-search');
  await p.click('.res >> nth=2'); await shot(p, '06-bible-verse');
  await p.click('[data-go=journal]'); await shot(p, '07-journal-locked');
  await p.click('#jUnlock'); await shot(p, '08-journal-open');
  await p.click('[data-go=settings]'); await shot(p, '09-settings');
  await p.evaluate(() => window.__emit('nav', { view: 'pause' })); await p.fill('#pauseReason', 'need to finish the supplier order'); await shot(p, '10-pause');
  await p.click('#pauseCancel');

  // Late Monday night: the next blocks run past midnight
  p = await open('index.html', { width: 1100, height: 720 }, MON(22, 0));
  await shot(p, '11-home-night');
  p = await open('index.html', { width: 920, height: 640 }, MON(13, 20));
  await shot(p, '11b-home-small-window');
  await p.click('[data-go=today]'); await shot(p, '11c-today-small-window');

  // In the morning devotion
  p = await open('index.html', { width: 1100, height: 720 }, MON(6, 55));
  await shot(p, '12-home-god');
  await p.click('#homeActions .goldbtn'); await shot(p, '13-god');
  await p.click('#putDown'); await shot(p, '14-rest');
  await p.click('#restWake'); await p.waitForTimeout(400);
  await p.click('.godchips [data-go=bible]'); await shot(p, '15-bible-from-god');

  // Full-screen Time with God on a 1080p screen
  p = await open('index.html', { width: 1920, height: 1080 }, MON(6, 55));
  await p.evaluate(() => window.__emit('nav', { view: 'god' })); await shot(p, '16-god-1080p');

  // Your day on the desktop
  const leftSide = async (pg) => { await pg.evaluate(async () => { const s = await window.__invoke('state:get'); s.settings = Object.assign({}, s.settings, { deskSide: 'left' }); window.__emit('state', s); }); };
  p = await open('desktop.html', { width: 1920, height: 1080 }, MON(10, 20)); await shot(p, '23-desktop-work-1080p');
  p = await open('desktop.html', { width: 1920, height: 1080 }, MON(6, 55)); await shot(p, '24-desktop-god-1080p');
  p = await open('desktop.html', { width: 1920, height: 1080 }, MON(22, 40)); await shot(p, '25-desktop-night-1080p');
  p = await open('desktop.html', { width: 2560, height: 1440 }, MON(19, 50)); await shot(p, '26-desktop-1440p');
  p = await open('desktop.html', { width: 1366, height: 768 }, MON(13, 20)); await leftSide(p); await shot(p, '27-desktop-laptop-left');
  p = await open('desktop.html', { width: 1280, height: 1024 }, MON(14, 5)); await shot(p, '28b-desktop-5x4');
  p = await open('desktop.html?still=1', { width: 1920, height: 1080 }, MON(10, 20)); await shot(p, '28-desktop-still-picture');
  p = await open('desktop.html', { width: 1920, height: 1200 }, new Date(2026, 10, 7, 12, 50).getTime()); await shot(p, '29-desktop-saturday-1920x1200');

  // The second screen's day map
  p = await open('daymap.html', { width: 1920, height: 1080 }, MON(10, 20)); await shot(p, '30-daymap-morning');
  p = await open('daymap.html', { width: 1920, height: 1080 }, MON(21, 50)); await shot(p, '31-daymap-evening-god');
  p = await open('daymap.html', { width: 1920, height: 1080 }, new Date(2026, 10, 1, 15, 0).getTime()); await shot(p, '32-daymap-sunday');

  // Widget
  p = await open('widget.html', { width: 300, height: 110 }, MON(10, 20));
  await p.addStyleTag({ content: 'html{background:#3a4660 !important}' }); await shot(p, '17-widget');
  p = await open('widget.html', { width: 300, height: 110 }, MON(6, 55));
  await p.addStyleTag({ content: 'html{background:#d9dde6 !important}' }); await shot(p, '18-widget-god-light-desktop');

  // Not now overlay
  p = await open('notnow.html', { width: 1366, height: 768 }, MON(10, 20));
  await p.addStyleTag({ content: 'html{background:linear-gradient(135deg,#2b5876,#4e4376) !important}' });
  await p.evaluate(() => window.__emit('notnow:show', { kind: 'reason', exe: 'chrome', hwnd: 1, label: 'Chrome', presetId: 'work', presetName: 'Work', blockTitle: 'Ledger: deep work', blockNote: 'The hardest Ledger task, the one you wrote down yesterday. Phone in the other room.', blockEnd: '11:00 AM', nextFree: '8:40 PM', ytLimit: 15 }));
  await p.fill('#reason', 'look up the supplier invoice portal'); await shot(p, '19-notnow-reason');
  await p.evaluate(() => window.__emit('notnow:show', { kind: 'entertainment', exe: 'steam', hwnd: 1, label: 'Steam', presetId: 'god', presetName: 'Time with God', blockTitle: 'Morning devotion', blockNote: '', blockEnd: '7:15 AM', nextFree: '8:40 PM', ytLimit: 15 }));
  await shot(p, '20-notnow-entertainment');

  // Extension "Not now" page (chrome.* stubbed)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ep = await ctx.newPage();
  ep.on('pageerror', (e) => errors.push('extension: ' + e.message));
  await ep.addInitScript(function () {
    window.chrome = { runtime: { sendMessage: function (m, cb) { if (cb) setTimeout(function () { cb({ policy: { preset: 'work', presetName: 'Work', block: { title: 'Work', endLabel: '7:00 PM' }, nextFreeLabel: '8:00 PM', yt: { limitMin: 15, usedSec: 900 } } }); }, 50); } }, tabs: { getCurrent: function (cb) { cb(null); }, remove: function () { } } };
  });
  await ep.goto('file://' + path.join(__dirname, '..', 'extension', 'notnow.html') + '?k=youtube&h=youtube.com');
  await shot(ep, '21-extension-notnow');
  const pp = await ctx.newPage();
  await pp.setViewportSize({ width: 312, height: 230 });
  await pp.addInitScript(function () {
    window.chrome = { runtime: { sendMessage: function (m, cb) { if (cb) setTimeout(function () { cb({ policy: { preset: 'work', presetName: 'Work', paused: false, block: { title: 'Work', endLabel: '7:00 PM' }, yt: { limitMin: 15, usedSec: 420 } } }); }, 50); } }, tabs: { query: function () { } } };
  });
  pp.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await pp.goto('file://' + path.join(__dirname, '..', 'extension', 'popup.html'));
  await shot(pp, '22-extension-popup');

  await browser.close();
  if (errors.length) { console.log('\nPage errors:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nno page errors');
})().catch((e) => { console.error(e); process.exit(1); });
