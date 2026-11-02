'use strict';
// Focus on the desktop: your day drawn behind the desktop icons, like a live wallpaper.
//
// Live: one window per screen, tucked into Explorer's wallpaper layer under the icons (watcher.js does the
// Windows part). The Windows wallpaper itself is set to the plain night sky underneath, so nothing jarring
// shows while the live layer re-attaches, and the original wallpaper is saved to put back when this is off.
// Picture: if the live layer can't attach (or you pick it), a still picture of the day becomes the Windows
// wallpaper and is redrawn whenever the block changes.
const fs = require('fs');
const path = require('path');

const RETRY_MS = 10000;
const GIVE_UP_AFTER = 5;   // failed attaches in a row before falling back to the picture
const CHECK_MS = 15000;

function makeDesktop(o) {
  // o: { electron, watcher, log, baseWeb, uiFile, resFile, userDir, model, save, schedKey, broadcast }
  const { BrowserWindow, screen, ipcMain } = o.electron;
  const log = o.log;
  const win32 = process.platform === 'win32';
  let wins = [];                 // { win, display, hwnd, mode }
  let active = false;
  let mode = 'off';              // off | starting | live | picture | unsupported
  let why = '';
  let failures = 0;
  let retryTimer = null, checkTimer = null, rebuildTimer = null, picTimer = null;
  let picKey = '', picBusy = false, picFlip = false, picFailedAt = 0;
  let gen = 0;                   // bumps whenever the live layer is rebuilt, so an older build stops
  let canSetWall = true;
  const drawnWaits = new Map();  // webContents id -> resolve

  ipcMain.handle('desk:drawn', function (e) {
    const r = drawnWaits.get(e.sender.id);
    if (r) { drawnWaits.delete(e.sender.id); r(true); }
    return true;
  });

  function settings() { return o.model.settings; }
  function wantPicture() { return settings().deskStyle === 'picture' || failures >= GIVE_UP_AFTER; }
  function setMode(m, w) { if (m !== mode || (w || '') !== why) { mode = m; why = w || ''; o.broadcast(); } }

  function physical(rect) {
    try { return screen.dipToScreenRect ? screen.dipToScreenRect(null, rect) : rect; } catch (e) { return rect; }
  }

  function hwndOf(win) {
    const b = win.getNativeWindowHandle();
    return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
  }

  // ---------- the Windows wallpaper ----------

  function inUserDir(p) { return !!p && path.resolve(p).toLowerCase().indexOf(path.resolve(o.userDir).toLowerCase()) === 0; }

  /** Remembers the wallpaper you had, once, so turning this off can put it back. */
  async function saveOriginal() {
    if (settings().origWall) return;
    const cur = await o.watcher.request('wallget', []);
    if (!cur) throw new Error('couldn\'t read the current wallpaper');
    if (inUserDir(cur.path)) { settings().origWall = { file: '', path: '', style: '10', tile: '0' }; o.save(); return; }
    let file = '';
    const candidates = [cur.path, path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')];
    for (const src of candidates) {
      try {
        if (src && fs.existsSync(src) && fs.statSync(src).isFile()) {
          const ext = (path.extname(src) || '.jpg').toLowerCase();
          file = path.join(o.userDir, 'original-wallpaper' + (ext.length <= 5 ? ext : '.jpg'));
          fs.copyFileSync(src, file);
          break;
        }
      } catch (e) { log('desktop: couldn\'t copy wallpaper ' + src + ': ' + e.message); file = ''; }
    }
    settings().origWall = { file: file, path: cur.path || '', style: cur.style || '', tile: cur.tile || '' };
    o.save();
    log('desktop: saved the original wallpaper (' + (cur.path || 'none') + ')');
  }

  async function setWallpaper(file) {
    const r = await o.watcher.request('wallset', [Buffer.from(file, 'utf8').toString('base64'), '10', '0']);
    if (!r || !r.ok) log('desktop: setting the wallpaper failed ' + JSON.stringify(r));
    return !!(r && r.ok);
  }

  /** The plain sky under the live layer. Only set when it isn't already ours (on 24H2 this resets Explorer's layer). */
  async function setSkyBase() {
    const dest = path.join(o.userDir, 'desktop-sky.jpg');
    const cur = await o.watcher.request('wallget', []);
    if (cur && cur.path && path.resolve(cur.path).toLowerCase() === dest.toLowerCase() && fs.existsSync(dest)) return;
    try { fs.copyFileSync(o.resFile('img', 'desk_night.jpg'), dest); } catch (e) { log('desktop: ' + e.message); return; }
    await setWallpaper(dest);
  }

  async function restoreOriginal() {
    const w = settings().origWall;
    if (!w) return;
    const file = w.file && fs.existsSync(w.file) ? w.file : w.path;
    const r = await o.watcher.request('wallset', [file ? Buffer.from(file, 'utf8').toString('base64') : '', w.style || '', w.tile || '']);
    if (r && r.ok) { settings().origWall = null; o.save(); log('desktop: put the original wallpaper back'); }
    else log('desktop: couldn\'t put the original wallpaper back ' + JSON.stringify(r));
  }

  // ---------- live windows ----------

  function destroyLive() {
    const old = wins;
    wins = [];
    old.forEach(function (w) { try { if (!w.win.isDestroyed()) { w.gone = true; w.win.destroy(); } } catch (e) { } });
  }

  function waitReady(win) {
    return new Promise(function (resolve) {
      let done = false;
      const fin = function (v) { if (!done) { done = true; resolve(v); } };
      win.once('ready-to-show', function () { fin(true); });
      setTimeout(function () { fin(!win.isDestroyed()); }, 8000);
    });
  }

  async function attach(display) {
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, skipTaskbar: true, focusable: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
      enableLargerThanScreen: true, backgroundColor: '#05070C', title: 'Focus desktop',
      webPreferences: Object.assign(o.baseWeb(), { backgroundThrottling: false, spellcheck: false })
    });
    const entry = { win: win, display: display.id, hwnd: '', mode: '' };
    // The main screen gets your day; any other screen gets the whole-day map (unless set to match).
    const second = display.id !== screen.getPrimaryDisplay().id && settings().deskSecond !== 'same';
    entry.page = second ? 'daymap' : 'desktop';
    win.loadFile(o.uiFile(entry.page + '.html'));
    win.webContents.on('render-process-gone', function (e, d) { log('desktop renderer gone: ' + d.reason); scheduleRebuild(3000); });
    win.on('closed', function () {
      // Explorer restarting takes our window with it. Come back once it's up again.
      if (!entry.gone && active && !wantPicture()) { log('desktop: the live layer closed, re-attaching'); scheduleRebuild(3000); }
    });
    if (!(await waitReady(win)) || win.isDestroyed()) return null;
    entry.hwnd = hwndOf(win);
    const p = physical(b);
    const r = await o.watcher.request('desk', [entry.hwnd, p.x, p.y, p.width, p.height]);
    if (r === null) {
      // The Windows helper didn't answer at all: not the desktop's fault, so don't count it.
      log('desktop: the Windows helper didn\'t answer');
      entry.gone = true;
      win.destroy();
      return 'nohelper';
    }
    if (!r.mode || r.mode === 'none') {
      log('desktop: couldn\'t attach to the desktop: ' + JSON.stringify(r));
      entry.gone = true;
      win.destroy();   // never leave it as a normal window over everything
      return null;
    }
    entry.mode = r.mode;
    win.showInactive();
    return entry;
  }

  async function buildLive() {
    clearTimeout(retryTimer);
    const my = ++gen;
    destroyLive();
    setMode('starting');
    const displays = screen.getAllDisplays();
    const got = [];
    const drop = function () { got.forEach(function (e) { e.gone = true; if (!e.win.isDestroyed()) e.win.destroy(); }); };
    let helperDown = false;
    for (const d of displays) {
      const e = await attach(d);
      if (e === 'nohelper') { helperDown = true; break; }
      if (e) got.push(e);
      if (!active || wantPicture() || my !== gen) { drop(); return; }
    }
    if (got.length) {
      wins = got;
      failures = 0;
      log('desktop: live on ' + got.length + ' screen(s) (' + got[0].mode + ')');
      setMode('live');
      o.broadcast();
      return;
    }
    if (helperDown) {
      drop();
      setMode('starting', 'Waiting for Windows…');
      retryTimer = setTimeout(function () { if (active && !wantPicture()) buildLive().catch(oops); }, 15000);
      return;
    }
    failures++;
    if (failures >= GIVE_UP_AFTER) {
      log('desktop: the live layer won\'t attach, using the picture instead');
      if (canSetWall) startPicture('The live layer couldn\'t attach, so your day is set as a picture.');
      else setMode('unsupported', 'The live layer couldn\'t attach.');
    } else {
      setMode('starting', 'Trying to attach…');
      retryTimer = setTimeout(function () { if (active && !wantPicture()) buildLive().catch(oops); }, RETRY_MS * failures);
    }
  }

  async function checkLive() {
    if (!active || mode !== 'live') return;
    for (const w of wins) {
      if (w.win.isDestroyed()) { scheduleRebuild(1000); return; }
      const r = await o.watcher.request('deskok', [w.hwnd]);
      if (r && r.ok === false) { log('desktop: live layer lost (' + r.why + '), re-attaching'); scheduleRebuild(500); return; }
    }
  }

  function scheduleRebuild(ms) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () { if (active && !wantPicture()) buildLive().catch(oops); }, ms);
  }

  // ---------- the still picture ----------

  function startPicture(note) {
    destroyLive();
    setMode('picture', note || '');
    picKey = '';
    refreshPicture();
  }

  /** Renders the still picture of the day at the main screen's real size and sets it as the wallpaper. */
  async function renderPicture() {
    const d = screen.getPrimaryDisplay();
    const p = physical(d.bounds);
    const win = new BrowserWindow({
      show: false, width: p.width, height: p.height, useContentSize: true, frame: false, enableLargerThanScreen: true,
      backgroundColor: '#05070C', webPreferences: Object.assign(o.baseWeb(), { offscreen: true, backgroundThrottling: false, spellcheck: false })
    });
    let painted = null;
    win.webContents.on('paint', function (e, dirty, image) { painted = image; });
    try {
      const drawn = new Promise(function (resolve) {
        drawnWaits.set(win.webContents.id, resolve);
        setTimeout(function () { resolve(false); }, 12000);
      });
      await win.loadFile(o.uiFile('desktop.html'), { query: { still: '1' } });
      if (!(await drawn)) log('desktop: the picture page didn\'t say it was drawn, using what it has');
      await new Promise(function (r) { setTimeout(r, 400); });
      let img = await win.webContents.capturePage();
      if ((!img || img.isEmpty()) && painted) img = painted;
      if (!img || img.isEmpty()) throw new Error('the picture came out empty');
      picFlip = !picFlip;
      const file = path.join(o.userDir, 'desktop-day-' + (picFlip ? 'a' : 'b') + '.png');
      fs.writeFileSync(file, img.toPNG());
      return file;
    } finally {
      drawnWaits.delete(win.webContents.id);
      if (!win.isDestroyed()) win.destroy();
    }
  }

  function refreshPicture() {
    clearTimeout(picTimer);
    picTimer = setTimeout(async function () {
      if (!active || mode !== 'picture') return;
      const key = o.schedKey() + '|' + (settings().deskSide || 'right');
      if (key === picKey) return;
      if (picFailedAt && Date.now() - picFailedAt < 60000) return;   // don't spin on a wallpaper Windows won't take
      if (picBusy) { refreshPicture(); return; }
      picBusy = true;
      try {
        const file = await renderPicture();
        if (await setWallpaper(file)) { picKey = key; picFailedAt = 0; } else picFailedAt = Date.now();
      } catch (e) { picFailedAt = Date.now(); log('desktop picture: ' + (e && e.stack || e)); }
      finally { picBusy = false; }
    }, 1500);
  }

  // ---------- on / off ----------

  function oops(e) { log('desktop: ' + (e && e.stack || e)); }

  async function start() {
    if (!win32) { setMode('unsupported', 'Only on Windows.'); return; }
    active = true;
    setMode('starting');
    await o.watcher.ready();
    try { await saveOriginal(); canSetWall = true; }
    catch (e) { canSetWall = false; log('desktop: ' + e.message + ', leaving the Windows wallpaper alone'); }
    if (!active) return;
    if (wantPicture()) {
      if (canSetWall) startPicture(settings().deskStyle === 'picture' ? '' : why);
      else setMode('unsupported', 'Windows wouldn\'t let Focus change the wallpaper.');
      return;
    }
    if (canSetWall) await setSkyBase();
    if (!active) return;
    await buildLive();
    clearInterval(checkTimer);
    checkTimer = setInterval(function () { checkLive().catch(oops); }, CHECK_MS);
  }

  async function stop(restore) {
    active = false;
    gen++;
    clearTimeout(retryTimer); clearTimeout(rebuildTimer); clearTimeout(picTimer); clearInterval(checkTimer);
    destroyLive();
    failures = 0;
    picKey = '';
    if (restore && win32) { await o.watcher.ready(); await restoreOriginal(); }
    setMode('off');
  }

  return {
    /** Applies the settings: on/off, live/picture. Safe to call any time. */
    apply: function () {
      const want = !!settings().desktop;
      if (!want) { if (active || settings().origWall) stop(true).catch(oops); return; }
      if (!active) { start().catch(function (e) { oops(e); setMode('picture', ''); }); return; }
      if (wantPicture() && mode === 'live') { startPicture(''); return; }
      if (!wantPicture() && mode === 'picture') { failures = 0; start().catch(oops); return; }
      if (mode === 'picture') { picKey = ''; refreshPicture(); }
      if (mode === 'live') {
        // A changed second-screen choice needs different pages.
        const primary = screen.getPrimaryDisplay().id;
        const stale = wins.some(function (w) { return w.page !== (w.display !== primary && settings().deskSecond !== 'same' ? 'daymap' : 'desktop'); });
        if (stale) scheduleRebuild(200);
      }
    },
    /** Called on every tick; redraws the picture when the block changes. */
    tick: function () { if (active && mode === 'picture') refreshPicture(); },
    /** A screen was added, removed or rescaled. */
    displaysChanged: function () {
      if (!active) return;
      if (mode === 'live' || mode === 'starting') scheduleRebuild(1500);
      else if (mode === 'picture') { picKey = ''; refreshPicture(); }
    },
    windows: function () { return wins.map(function (w) { return w.win; }).filter(function (w) { return !w.isDestroyed(); }); },
    status: function () { return { mode: mode, why: why }; },
    quit: function () { active = false; gen++; destroyLive(); }
  };
}

module.exports = { makeDesktop };
