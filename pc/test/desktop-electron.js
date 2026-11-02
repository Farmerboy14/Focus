'use strict';
// Runs lib/desktop.js inside real Electron with a stand-in for the Windows calls (watcher.request),
// pretending to be on Windows. Checks the live window, re-attaching, the picture fallback and putting
// the old wallpaper back. Run: xvfb-run -a node_modules/.bin/electron --no-sandbox --disable-gpu test/desktop-electron.js
const fs = require('fs');
const os = require('os');
const path = require('path');
Object.defineProperty(process, 'platform', { value: 'win32' });
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const S = require('../app/lib/schedule');
const { defaults } = require('../app/lib/store');
const { makeDesktop } = require('../app/lib/desktop');

const APP = path.join(__dirname, '..', 'app');
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-desk-'));
const origFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-pics-')), 'my-photo.jpg');
fs.writeFileSync(origFile, 'not really a jpeg');
const calls = [];
let deskReply = { mode: 'classic', why: '' };
let okReply = { ok: true };
let wall = { path: origFile, style: '2', tile: '0' };
const fails = [];
function ok(c, m) { if (c) console.log('  ok   ' + m); else { console.log('  FAIL ' + m); fails.push(m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const watcher = {
  ready: () => Promise.resolve(true),
  request: async function (verb, args) {
    calls.push([verb].concat(args || []));
    if (verb === 'wallget') return Object.assign({}, wall);
    if (verb === 'wallset') {
      const p = args[0] ? Buffer.from(args[0], 'base64').toString('utf8') : '';
      wall = { path: p, style: args[1] || wall.style, tile: args[2] || wall.tile };
      return { ok: true };
    }
    if (verb === 'desk') return deskReply;
    if (verb === 'deskok') return okReply;
    return null;
  }
};

app.whenReady().then(async function () {
  const model = defaults();
  model.settings.desktop = true;
  const states = [];
  ipcMain.handle('state:get', function () { const t = Date.now(); return { now: t, sched: model.sched, cur: S.current(model.sched, t), settings: model.settings }; });
  ipcMain.handle('bible:text', function () { return fs.readFileSync(path.join(APP, 'res', 'kjv.txt'), 'utf8'); });
  let d;
  const broadcast = function () { states.push(d ? d.status().mode : '?'); };
  d = makeDesktop({
    electron: electron, watcher: watcher, log: function (m) { console.log('       log: ' + m); },
    baseWeb: function () { return { preload: path.join(APP, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }; },
    uiFile: function (n) { return path.join(APP, 'ui', n); }, resFile: function () { return path.join(APP, 'res', ...arguments); },
    userDir: userDir, model: model, save: function () { }, schedKey: function () { return 'k' + Math.floor(Date.now() / 1000); }, broadcast: broadcast
  });

  try {
    d.apply();
    for (let i = 0; i < 40 && d.status().mode !== 'live'; i++) await sleep(250);
    ok(d.status().mode === 'live', 'live layer attached (' + d.status().mode + ')');
    ok(model.settings.origWall && model.settings.origWall.path === origFile && fs.existsSync(model.settings.origWall.file), 'the old wallpaper was saved and copied');
    ok(path.basename(wall.path) === 'desktop-sky.jpg' && fs.existsSync(wall.path), 'the plain sky was set underneath');
    const desk = calls.filter((c) => c[0] === 'desk')[0];
    ok(desk && /^\d+$/.test(desk[1]) && Number(desk[4]) > 0 && Number(desk[5]) > 0, 'asked to attach window ' + (desk && desk[1]) + ' at ' + (desk && desk.slice(2).join(',')));
    const w = d.windows()[0];
    ok(w && w.isVisible() && !w.isFocusable(), 'the window is shown and never takes focus');
    await sleep(1500);
    const text = w ? await w.webContents.executeJavaScript('document.getElementById("title").textContent + "|" + document.getElementById("clock").textContent + "|" + document.getElementById("verse").textContent.slice(0, 20)') : '';
    ok(/\|\d{1,2}:\d\d/.test(text) && text.indexOf('“') >= 0, 'the page shows the block, the clock and the verse: ' + text);
    const img = w ? await w.webContents.capturePage() : null;
    if (img) fs.writeFileSync(path.join(userDir, 'live.png'), img.toPNG());

    // Applying again while live doesn't redo anything
    const before = calls.length;
    d.apply();
    await sleep(300);
    ok(calls.length === before, 'applying again while live changes nothing');

    // Explorer restart: the window disappears; it comes back
    w.destroy();
    for (let i = 0; i < 40 && !(d.windows().length && d.windows()[0] !== w && d.status().mode === 'live'); i++) await sleep(250);
    ok(d.windows().length === 1 && d.windows()[0] !== w, 're-attached after the window was taken away');

    // Turning it off puts the old wallpaper back
    model.settings.desktop = false;
    d.apply();
    for (let i = 0; i < 20 && d.status().mode !== 'off'; i++) await sleep(150);
    ok(d.windows().length === 0, 'turning it off removes the live window');
    ok(wall.path === model.settings.origWall || (fs.existsSync(wall.path) && path.basename(wall.path).indexOf('original-wallpaper') === 0 && wall.style === '2'), 'and puts the old wallpaper back (' + path.basename(wall.path) + ', style ' + wall.style + ')');
    ok(model.settings.origWall === null, 'and forgets it');

    // Can't attach: never leaves a window over everything, retries, then uses the picture
    wall = { path: origFile, style: '2', tile: '0' };
    deskReply = { mode: 'none', why: 'no Progman' };
    model.settings.desktop = true;
    model.settings.deskStyle = 'picture'; // skip the retry wait; the failure path is checked just below
    d.apply();
    for (let i = 0; i < 80 && !/desktop-day-/.test(path.basename(wall.path)); i++) await sleep(250);
    ok(d.status().mode === 'picture' && /desktop-day-[ab]\.png$/.test(wall.path), 'picture mode set a drawn picture as the wallpaper (' + path.basename(wall.path) + ')');
    const png = fs.existsSync(wall.path) ? fs.readFileSync(wall.path) : Buffer.alloc(0);
    const pw = png.length > 24 ? png.readUInt32BE(16) : 0, ph = png.length > 24 ? png.readUInt32BE(20) : 0;
    ok(pw >= 800 && ph >= 500, 'the picture is a real image (' + pw + 'x' + ph + ', ' + png.length + ' bytes)');
    if (png.length) fs.copyFileSync(wall.path, path.join(userDir, 'picture.png'));
    const first = wall.path;
    await sleep(2500); // schedKey changes every second here, so it redraws
    d.tick();
    for (let i = 0; i < 60 && wall.path === first; i++) await sleep(250);
    ok(wall.path !== first, 'a changed block redraws the picture into the other file');
    ok(BrowserWindow.getAllWindows().length === 0, 'no windows are left over after drawing');

    // Live again, with attaching failing: no window left behind
    model.settings.deskStyle = 'live';
    d.apply();
    await sleep(3000);
    ok(BrowserWindow.getAllWindows().length === 0, 'a failed attach leaves no window on screen');
    ok(d.status().mode === 'starting', 'and it keeps trying (' + d.status().mode + ': ' + d.status().why + ')');
    d.quit();
  } catch (e) {
    console.log(e && e.stack);
    fails.push(String(e));
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all desktop checks passed') + '   (' + userDir + ')');
  app.exit(fails.length ? 1 : 0);
});
app.on('window-all-closed', function () { });
