'use strict';
// Focus for Windows: tray app, windows, program blocking, the phone link and the extension endpoint.
// Loaded by bootstrap.js (from the installed copy or from an update in %APPDATA%/Focus/app).
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, clipboard, shell, Notification, nativeImage, screen, safeStorage, powerMonitor } = electron;

const S = require('./lib/schedule');
const P = require('./lib/policy');
const fc = require('./lib/crypto');
const { Store } = require('./lib/store');
const { Link } = require('./lib/link');
const { Watcher } = require('./lib/watcher');
const { startServer } = require('./lib/server');
const { makeUpdater, readVersion } = require('./lib/updater');
const { makeLog } = require('./lib/log');
const { makeDesktop } = require('./lib/desktop');
const { makePhone } = require('./lib/phone');

// The desktop layer sits under the icons, where Chromium would think it's covered and stop drawing it.
try { app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); } catch (e) { }

const BOOT = global.FOCUS_BOOT || { version: 1, appDir: __dirname, bundledDir: __dirname, userDir: path.join(app.getPath('appData'), 'Focus') };
const APP_DIR = __dirname;
const USER_DIR = BOOT.userDir;
const AUMID = 'com.caleb.focus.pc';
const log = makeLog(USER_DIR);
const VERSION = readVersion(APP_DIR) || { version: 0, name: '0' };
const HIDDEN_START = process.argv.indexOf('--hidden') >= 0;

process.on('uncaughtException', function (e) { log('uncaught: ' + (e && e.stack || e)); });
process.on('unhandledRejection', function (e) { log('unhandled: ' + (e && e.stack || e)); });

function res(...p) {
  const a = path.join(APP_DIR, 'res', ...p);
  return fs.existsSync(a) ? a : path.join(BOOT.bundledDir, 'res', ...p);
}
function ui(name) { return path.join(APP_DIR, 'ui', name); }
const PRELOAD = path.join(APP_DIR, 'preload.js');

let store, model, link, watcher, server, updater, tray, desktop, phone;
let mainWin = null, widgetWin = null, notnowWin = null;
let quitting = false;
let lastFg = null;
let notnowShowing = null;     // { exe, hwnd, at }
let lastMinimize = {};        // hwnd -> time
let lastBlockKey = '';
let pendingUpdate = null;
let pushTimer = null;
let broadcastTimer = null;

function now() { return Date.now(); }
function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { log('error: ' + (e && e.stack || e)); } }; }

// ---------- notifications ----------

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title, body: body || '', icon: res('img', 'icon.png'), silent: true }).show();
      return;
    }
  } catch (e) { log('notify: ' + e.message); }
  try { if (tray && process.platform === 'win32') tray.displayBalloon({ title: title, content: body || ' ', iconType: 'none' }); } catch (e) { }
}

// ---------- the shared week ----------

function schedChanged() {
  model.sched.editedAt = now();
  store.save();
  broadcast();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 900); // typing in Today shouldn't flood the relay
}

function pushState() {
  if (!link || !link.key) return;
  link.send('state', { sched: S.wire(model.sched) }).then(function (ok) { if (!ok) log('state push failed'); });
}

/** Takes the phone's week if it's version 2 and newer. Never sends anything back. */
function applyRemote(sc) {
  if (!S.isV2(sc)) { if (sc) log('ignored a state in the old one-day format'); return false; }
  const at = Number(sc.editedAt) || 0;
  if (at <= (model.sched.editedAt || 0)) return false;
  const next = S.normalize(sc, model.sched);
  next.editedAt = at;
  model.sched = next;
  store.save();
  broadcast();
  return true;
}

function onPhoneMessage(env) {
  try {
    const t = env.t;
    if (t === 'hello') pushState();
    else if (t === 'state') { if (applyRemote(env.sched)) notify('Focus', 'Your week was updated from your phone.'); }
    else if (t === 'clip') {
      const text = String(env.text || '').slice(0, 2000);
      clipboard.writeText(text);
      notify('Copied from your phone', text.length > 120 ? text.slice(0, 117) + '…' : text);
    } else if (t === 'open') {
      const url = String(env.url || '');
      if (/^https?:\/\//i.test(url)) {
        try { new URL(url); shell.openExternal(url); } catch (e) { log('bad url from phone'); }
      }
    } else if (t === 'bible') {
      const book = Math.max(0, Math.min(65, Number(env.book) | 0));
      const chapter = Math.max(1, Number(env.chapter) | 0 || 1);
      showMain('bible', { book: book, chapter: chapter });
    } else if (t === 'note') notify('From your phone', String(env.text || '').slice(0, 300));
    broadcast();
  } catch (e) { log('message: ' + e.message); }
}

function startLink() {
  if (fc.normalizeCode(model.pair.code).length !== 16) { model.pair.code = fc.newCode(); model.pair.lastId = ''; store.save(); }
  link.start(model.pair.code);
}

// ---------- what the windows see ----------

function snapshot() {
  const t = now();
  const sc = model.sched;
  const cur = S.current(sc, t);
  const day = S.dayKey(t);
  const seen = Object.keys(model.seen).sort(function (a, b) { return (model.seen[b].t || 0) - (model.seen[a].t || 0); }).slice(0, 80)
    .map(function (k) { return { exe: k, title: model.seen[k].title || '' }; });
  return {
    now: t,
    sched: sc,
    cur: cur,
    today: S.dayOf(t),
    slots: S.slots(sc, t),
    upcoming: S.upcoming(sc, t, 3),
    nextFree: S.nextFree(sc, t),
    pc: model.pc,
    ytUsedMin: Math.floor(P.ytUsedSec(model, t) / 60),
    steps: model.steps[day] || [false, false, false],
    settings: model.settings,
    paused: model.pausedUntil > t ? model.pausedUntil : 0,
    pair: { code: fc.formatCode(model.pair.code), status: link ? link.status : 'off', lastMessage: link ? link.lastMessage : 0, lastHeard: link ? link.lastHeard : 0 },
    version: { name: VERSION.name, version: VERSION.version, fellBack: !!BOOT.fellBack, pending: pendingUpdate ? pendingUpdate.name : '' },
    seen: seen,
    reasons: store.recentReasons(8),
    desk: desktop ? desktop.status() : { mode: 'off', why: '' },
    platform: process.platform
  };
}

function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(safe(function () {
    const snap = snapshot();
    [mainWin, widgetWin, phone ? phone.window() : null].concat(desktop ? desktop.windows() : []).forEach(function (w) { if (w && !w.isDestroyed()) w.webContents.send('state', snap); });
    updateTray(snap);
  }), 30);
}

// ---------- windows ----------

function baseWeb() { return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }; }

function windowIcon() { return nativeImage.createFromPath(process.platform === 'win32' ? res('img', 'icon.ico') : res('img', 'icon.png')); }

function createMain(show) {
  mainWin = new BrowserWindow({
    width: 1100, height: 720, minWidth: 920, minHeight: 640, frame: false, show: false, backgroundColor: '#07090E',
    title: 'Focus', icon: windowIcon(), webPreferences: baseWeb()
  });
  mainWin.removeMenu();
  mainWin.loadFile(ui('index.html'));
  mainWin.once('ready-to-show', function () { if (show) { mainWin.show(); mainWin.focus(); } });
  mainWin.on('close', function (e) { if (!quitting) { e.preventDefault(); if (mainWin.isFullScreen()) mainWin.setFullScreen(false); mainWin.hide(); } });
  mainWin.on('closed', function () { mainWin = null; });
  mainWin.on('enter-full-screen', function () { mainWin.webContents.send('fullscreen', true); });
  mainWin.on('leave-full-screen', function () { mainWin.webContents.send('fullscreen', false); });
  mainWin.webContents.setWindowOpenHandler(function (d) { if (/^https?:/i.test(d.url)) shell.openExternal(d.url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', function (e) { e.preventDefault(); });
  mainWin.webContents.on('render-process-gone', function (e, d) { log('main renderer gone: ' + d.reason); });
}

function showMain(view, extra) {
  if (!mainWin || mainWin.isDestroyed()) createMain(true);
  const w = mainWin;
  const go = function () {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    if (view) w.webContents.send('nav', Object.assign({ view: view }, extra || {}));
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
}

function widgetBounds() {
  const saved = model.settings.widget;
  if (saved) {
    const ok = screen.getAllDisplays().some(function (d) {
      const b = d.workArea;
      return saved.x >= b.x - 200 && saved.y >= b.y - 50 && saved.x < b.x + b.width - 60 && saved.y < b.y + b.height - 40;
    });
    if (ok) return { x: saved.x, y: saved.y, width: 300, height: 110 };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 320, y: wa.y + wa.height - 130, width: 300, height: 110 };
}

function setWidget(on) {
  if (on) {
    if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.showInactive(); return; }
    widgetWin = new BrowserWindow(Object.assign(widgetBounds(), {
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000', title: 'Focus widget',
      icon: windowIcon(), webPreferences: baseWeb()
    }));
    widgetWin.setAlwaysOnTop(true, 'floating');
    widgetWin.loadFile(ui('widget.html'));
    widgetWin.once('ready-to-show', function () { widgetWin.showInactive(); });
    widgetWin.on('closed', function () { widgetWin = null; });
  } else if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.destroy();
    widgetWin = null;
  }
}

function ensureNotNow() {
  if (notnowWin && !notnowWin.isDestroyed()) return notnowWin;
  notnowWin = new BrowserWindow({
    width: 800, height: 600, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000',
    title: 'Not now', icon: windowIcon(), webPreferences: baseWeb()
  });
  notnowWin.setAlwaysOnTop(true, 'screen-saver');
  notnowWin.loadFile(ui('notnow.html'));
  notnowWin.on('closed', function () { notnowWin = null; notnowShowing = null; });
  return notnowWin;
}

function displayFor(rect) {
  try {
    if (rect && rect.length === 4 && rect[2] > rect[0]) {
      let r = { x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1] };
      if (process.platform === 'win32' && screen.screenToDipRect) r = screen.screenToDipRect(null, r);
      return screen.getDisplayMatching(r);
    }
  } catch (e) { }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

const LABELS = {
  discord: 'Discord', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games', robloxplayerbeta: 'Roblox',
  roblox: 'Roblox', 'ac2-win64-shipping': 'Assetto Corsa Competizione', chrome: 'Chrome', msedge: 'Edge', opera: 'Opera',
  firefox: 'Firefox', spotify: 'Spotify', telegram: 'Telegram', code: 'VS Code', excel: 'Excel', winword: 'Word', outlook: 'Outlook'
};
function labelFor(exe) {
  if (LABELS[exe]) return LABELS[exe];
  return exe ? exe.charAt(0).toUpperCase() + exe.slice(1) : 'This program';
}

function showNotNow(info) {
  const w = ensureNotNow();
  const d = displayFor(info.rect);
  const t = now();
  const cur = S.current(model.sched, t);
  const free = S.nextFree(model.sched, t);
  const data = {
    kind: info.kind, exe: info.exe, hwnd: info.hwnd, label: labelFor(info.exe),
    presetId: cur.preset, presetName: model.sched.names[cur.preset] || cur.preset,
    blockTitle: cur.index < 0 ? 'Open time' : cur.title, blockNote: cur.note || '', blockEnd: S.clock(cur.end),
    nextFree: free ? S.clock(free) : '', ytLimit: model.pc.ytLimit
  };
  notnowShowing = { exe: info.exe, hwnd: info.hwnd, at: t };
  const go = function () {
    w.setBounds(d.bounds);
    w.webContents.send('notnow:show', data);
    w.show();
    w.focus();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
}

function hideNotNow() {
  notnowShowing = null;
  if (notnowWin && !notnowWin.isDestroyed()) notnowWin.hide();
}

// ---------- blocking programs ----------

function recordSeen(exe, title) {
  const k = P.exeKey(exe);
  if (!k || P.SYSTEM.indexOf(k) >= 0) return;
  const prev = model.seen[k];
  model.seen[k] = { t: now(), title: String(title || '').slice(0, 80) };
  if (!prev) {
    const keys = Object.keys(model.seen);
    if (keys.length > 150) {
      keys.sort(function (a, b) { return model.seen[a].t - model.seen[b].t; }).slice(0, keys.length - 150).forEach(function (x) { delete model.seen[x]; });
    }
    store.save();
    broadcast();
  }
}

function evaluate() {
  const fg = lastFg;
  if (!fg || fg.min) return;
  const t = now();
  const d = P.decideExe(model, fg.exe, t);
  if (d.mode === P.ALLOW) return;
  const exe = P.exeKey(fg.exe);
  if (!lastMinimize[fg.hwnd] || t - lastMinimize[fg.hwnd] > 2500) {
    lastMinimize[fg.hwnd] = t;
    watcher.minimize(fg.hwnd);
    log('blocked ' + exe + ' (' + (d.entertainment ? 'entertainment' : d.mode === P.REASON ? 'reason' : 'blocked') + ' in ' + d.presetId + ')');
  }
  const showing = notnowShowing && notnowShowing.exe === exe && notnowWin && notnowWin.isVisible();
  if (!showing) showNotNow({ kind: d.entertainment ? 'entertainment' : d.mode === P.REASON ? 'reason' : 'block', exe: exe, hwnd: fg.hwnd, rect: fg.rect });
}

function tick() {
  const t = now();
  // Passes that ran out, a block that changed, a pause that ended: re-check what's in front.
  evaluate();
  const cur = S.current(model.sched, t);
  const key = cur.title + '|' + cur.start + '|' + cur.end + '|' + (model.pausedUntil > t ? 'p' : '');
  if (key !== lastBlockKey) {
    lastBlockKey = key;
    broadcast();
  }
  for (const h in lastMinimize) if (t - lastMinimize[h] > 60000) delete lastMinimize[h];
  if (desktop) desktop.tick();
}

/** What the still desktop picture shows; when this changes, it's redrawn. */
function deskKey() {
  const t = now();
  const cur = S.current(model.sched, t);
  return S.dayKey(t) + '|' + cur.preset + '|' + cur.title + '|' + cur.start + '|' + (cur.note || '') + '|' +
    S.upcoming(model.sched, t, 5).map(function (x) { return x.start + x.title + x.preset; }).join(',');
}

// ---------- tray ----------

function sendClipboard() {
  const text = clipboard.readText() || '';
  if (!text.trim()) { notify('Nothing to send', 'Your clipboard is empty.'); return; }
  if (!link.key) { notify('Pair with your phone first', 'Open Focus → Settings.'); showMain('settings'); return; }
  link.send('clip', { text: text.slice(0, 2000) }).then(function (ok) {
    notify(ok ? 'Sent to your phone' : 'Couldn\'t reach your phone', ok ? (text.length > 80 ? text.slice(0, 77) + '…' : text) : 'Check your internet connection.');
  });
}

function trayImage() {
  if (process.platform === 'win32') return nativeImage.createFromPath(res('img', 'icon.ico'));
  return nativeImage.createFromPath(res('img', 'tray.png'));
}

function updateTray(snap) {
  if (!tray) return;
  snap = snap || snapshot();
  const cur = snap.cur;
  const left = S.minutesLeft(cur, snap.now);
  try { tray.setToolTip('Focus · ' + (cur.index < 0 ? 'Open time' : cur.title) + ' · ' + S.hm(left) + ' left' + (snap.paused ? ' · paused' : '')); } catch (e) { }
  const menu = Menu.buildFromTemplate([
    { label: 'Open Focus', click: function () { showMain('home'); } },
    { label: widgetWin ? 'Hide widget' : 'Show widget', click: function () { model.settings.showWidget = !widgetWin; store.save(); setWidget(model.settings.showWidget); broadcast(); } },
    { label: 'Send clipboard to phone', accelerator: 'Ctrl+Alt+P', click: sendClipboard },
    { label: 'Time with God', click: function () { showMain('god'); } },
    { type: 'separator' },
    snap.paused
      ? { label: 'Blocking paused until ' + S.clock(snap.paused) + ' · Resume', click: function () { model.pausedUntil = 0; store.save(); broadcast(); } }
      : { label: 'Pause blocking for 10 minutes…', click: function () { showMain('pause'); } },
    { type: 'separator' },
    { label: 'Quit', click: quit }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.on('click', function () { showMain('home'); });
    updateTray();
  } catch (e) { log('tray: ' + e.message); }
}

// ---------- settings ----------

function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!model.settings.startWithWindows, path: process.execPath, args: ['--hidden'] });
  } catch (e) { log('login item: ' + e.message); }
}

function ensureShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Focus.lnk');
    const opts = { target: process.execPath, appUserModelId: AUMID, description: 'Focus for Windows', icon: res('img', 'icon.ico'), iconIndex: 0 };
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
  } catch (e) { log('shortcut: ' + e.message); }
}

// ---------- journal (PC only, encrypted with Windows' DPAPI via safeStorage) ----------

const JOURNAL = function () { return path.join(USER_DIR, 'journal.bin'); };

function journalRead() {
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Windows encryption isn\'t available, so the journal stays locked.' };
  try {
    if (!fs.existsSync(JOURNAL())) return { entries: [] };
    const json = safeStorage.decryptString(fs.readFileSync(JOURNAL()));
    const arr = JSON.parse(json);
    return { entries: Array.isArray(arr) ? arr : [] };
  } catch (e) {
    log('journal read: ' + e.message);
    return { error: 'The journal couldn\'t be opened on this account.' };
  }
}

function journalWrite(entries) {
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Windows encryption isn\'t available.' };
  if (!Array.isArray(entries)) return { error: 'bad entries' };
  const clean = entries.slice(0, 5000).map(function (e) {
    return { t: Number(e.t) || now(), kind: ['Request', 'Thanks', 'Confession'].indexOf(e.kind) >= 0 ? e.kind : 'Request', text: String(e.text || '').slice(0, 5000), answered: Number(e.answered) || 0 };
  });
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    const tmp = JOURNAL() + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(clean)));
    fs.renameSync(tmp, JOURNAL());
    return { ok: true };
  } catch (e) {
    log('journal write: ' + e.message);
    return { error: 'Couldn\'t save the journal.' };
  }
}

// ---------- updates ----------

async function checkForUpdates(manual) {
  try {
    const r = await updater.check();
    if (!r.available) return { status: 'current', name: VERSION.name };
    if (pendingUpdate && pendingUpdate.version === r.info.version) return { status: 'ready', name: r.info.name };
    // Never loop on an update that won't take: three tries, then only by hand.
    const tries = model.updAttempt && model.updAttempt.v === r.info.version ? model.updAttempt.n : 0;
    if (tries >= 3 && !manual) return { status: 'error', message: 'Focus ' + r.info.name + ' didn\'t install after 3 tries.' };
    model.updAttempt = { v: r.info.version, n: tries + 1 };
    store.flush();
    const v = await updater.install(r.info);
    pendingUpdate = v;
    broadcast();
    if (manual) setTimeout(function () { restartNow(false); }, 2500);
    return { status: 'ready', name: v.name || String(v.version), notes: r.info.notes || '' };
  } catch (e) {
    log('update: ' + e.message);
    return { status: 'error', message: e.message };
  }
}

function restartNow(hidden) {
  quitting = true;
  try { phone && phone.quit(); } catch (e) { }
  try { desktop && desktop.quit(); } catch (e) { }
  try { store.flush(); } catch (e) { }
  try { watcher.stop(); } catch (e) { }
  const args = process.argv.slice(1).filter(function (a) { return a !== '--hidden'; });
  if (hidden) args.push('--hidden');
  app.relaunch({ args: args });
  app.exit(0);
}

/** A downloaded update starts on its own once Focus is just sitting in the tray. */
function restartWhenIdle() {
  if (!pendingUpdate) return;
  const busy = (phone && phone.isOpen()) || (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) || (notnowWin && !notnowWin.isDestroyed() && notnowWin.isVisible());
  if (!busy) { log('restarting into update ' + (pendingUpdate.name || pendingUpdate.version)); restartNow(true); }
}

function quit() {
  quitting = true;
  try { phone && phone.quit(); } catch (e) { }
  try { desktop && desktop.quit(); } catch (e) { }
  try { store.flush(); } catch (e) { }
  try { link.stop(); } catch (e) { }
  try { watcher.stop(); } catch (e) { }
  try { server.close(); } catch (e) { }
  app.quit();
}

// ---------- IPC ----------

function handle(name, fn) {
  ipcMain.handle(name, async function (e, arg) {
    try { return await fn(arg, e); } catch (err) { log('ipc ' + name + ': ' + (err && err.stack || err)); return { error: String(err && err.message || err) }; }
  });
}

function setupIpc() {
  handle('state:get', function () { return snapshot(); });
  handle('sched:set', function (a) {
    a = a || {};
    const days = Object.assign({}, model.sched.days, a.days && typeof a.days === 'object' ? a.days : {});
    model.sched = S.normalize({ v: 2, days: days, names: a.names || model.sched.names, editedAt: model.sched.editedAt }, model.sched);
    schedChanged();
    return snapshot();
  });
  handle('pc:set', function (pc) {
    const { sanitize } = require('./lib/store');
    model.pc = sanitize({ pc: pc }).pc;
    store.save();
    broadcast();
    return snapshot();
  });
  handle('steps:set', function (a) {
    const day = S.dayKey(now());
    const arr = (model.steps[day] || [false, false, false]).slice();
    arr[a.i | 0] = !!a.on;
    // keep a month of checklists
    const keys = Object.keys(model.steps);
    if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(function (k) { delete model.steps[k]; });
    model.steps[day] = arr;
    store.save();
    return arr;
  });
  handle('settings:set', function (a) {
    if (typeof a.startWithWindows === 'boolean') { model.settings.startWithWindows = a.startWithWindows; applyLoginItem(); }
    if (typeof a.showWidget === 'boolean') { model.settings.showWidget = a.showWidget; if (!a.showWidget && phone) phone.collapse(); setWidget(a.showWidget); }
    let desk = false;
    if (typeof a.desktop === 'boolean') { model.settings.desktop = a.desktop; desk = true; }
    if (a.deskSide === 'left' || a.deskSide === 'right') { model.settings.deskSide = a.deskSide; desk = true; }
    if (a.deskStyle === 'live' || a.deskStyle === 'picture') { model.settings.deskStyle = a.deskStyle; desk = true; }
    if (a.deskSecond === 'day' || a.deskSecond === 'same') { model.settings.deskSecond = a.deskSecond; desk = true; }
    store.save();
    if (desk && desktop) desktop.apply();
    broadcast();
    return snapshot();
  });
  handle('pair:new', function () {
    model.pair.code = fc.newCode();
    model.pair.lastId = '';
    store.flush();
    link.start(model.pair.code);
    broadcast();
    return snapshot();
  });
  handle('clip:send', function () { sendClipboard(); return true; });
  handle('bible:text', function () { return fs.readFileSync(res('kjv.txt'), 'utf8'); });
  handle('bible:phone', async function (a) {
    if (!link.key) return { error: 'Pair with your phone first (Settings).' };
    const ok = await link.send('bible', { book: Math.max(0, Math.min(65, a.book | 0)), chapter: Math.max(1, a.chapter | 0) });
    return ok ? { ok: true } : { error: 'Couldn\'t reach your phone.' };
  });
  handle('journal:unlock', function () { return journalRead(); });
  handle('journal:save', function (entries) { return journalWrite(entries); });
  handle('pause:start', function (a) {
    const why = String(a && a.reason || '').trim();
    if (!P.reasonOk(why)) return { error: 'Write at least four words.' };
    model.pausedUntil = now() + 10 * S.MIN;
    store.logReason({ t: now(), exe: '(pause all)', why: why });
    store.save();
    hideNotNow();
    broadcast();
    log('paused blocking for 10 minutes');
    return { ok: true, until: model.pausedUntil };
  });
  handle('pause:end', function () { model.pausedUntil = 0; store.save(); broadcast(); return true; });
  handle('update:check', function () { return checkForUpdates(true); });
  handle('update:restart', function () { setTimeout(function () { restartNow(false); }, 300); return true; });
  handle('procs:refresh', function () { if (watcher) watcher.listProcesses(); return true; });
  handle('log:open', function () { shell.openPath(path.join(USER_DIR, 'log.txt')); return true; });
  handle('win:minimize', function (a, e) { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); return true; });
  handle('win:close', function (a, e) { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); return true; });
  handle('win:fullscreen', function (on, e) { const w = BrowserWindow.fromWebContents(e.sender); if (w && w === mainWin && w.isFullScreen() !== !!on) w.setFullScreen(!!on); return true; });
  handle('widget:move', function (a, e) {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w !== widgetWin) return false;
    w.setPosition(Math.round(a.x), Math.round(a.y));
    if (a.done) { const p = w.getPosition(); model.settings.widget = { x: p[0], y: p[1] }; store.save(); }
    return true;
  });
  handle('widget:open', function () { if (phone) phone.open(); else showMain('home'); return true; });
  handle('notnow:pass', function (a) {
    const why = String(a && a.reason || '').trim();
    const exe = P.exeKey(a && a.exe);
    if (!exe || !P.reasonOk(why)) return { error: 'Write at least four words.' };
    const d = P.decideExe(model, exe, now());
    if (d.entertainment) return { error: 'Entertainment waits for Free time.' };
    model.passes[exe] = now() + 10 * S.MIN;
    store.logReason({ t: now(), exe: exe, why: why });
    store.save();
    hideNotNow();
    if (watcher && a.hwnd) watcher.restore(a.hwnd);
    return { ok: true };
  });
  handle('notnow:close', function () { hideNotNow(); return true; });
  handle('notnow:back', function () {
    hideNotNow();
    const cur = S.current(model.sched, now());
    showMain(cur.preset === 'god' ? 'god' : 'home');
    return true;
  });
}

// ---------- start ----------

function init() {
  store = new Store(USER_DIR, log);
  model = store.data;
  log('Focus ' + VERSION.name + ' starting from ' + APP_DIR + (BOOT.fellBack ? ' (fell back from a broken update)' : ''));

  link = new Link({
    fetch: function (u, o) { return electron.net.fetch(u, o); },
    getLastId: function () { return model.pair.lastId; },
    setLastId: function (id) { model.pair.lastId = id; store.save(); },
    log: log
  });
  link.on('message', onPhoneMessage);
  link.on('status', function () { broadcast(); });

  updater = makeUpdater({ fetch: function (u, o) { return electron.net.fetch(u, o); }, current: VERSION, userDir: USER_DIR, bundledDir: BOOT.bundledDir, bootstrapVersion: BOOT.version, log: log });

  watcher = new Watcher(log);
  watcher.on('foreground', safe(function (fg) {
    lastFg = fg;
    recordSeen(fg.exe, fg.title);
    evaluate();
  }));
  watcher.on('procs', safe(function (list) { list.forEach(function (p) { recordSeen(p.exe, p.title); }); }));

  setupIpc();
  createTray();
  createMain(!HIDDEN_START);
  if (model.settings.showWidget) setWidget(true);
  applyLoginItem();
  ensureShortcut();
  startLink();
  watcher.start();
  desktop = makeDesktop({
    electron: electron, watcher: watcher, log: log, baseWeb: baseWeb, uiFile: ui, resFile: res, userDir: USER_DIR,
    model: model, save: function () { store.save(); }, schedKey: deskKey, broadcast: broadcast
  });
  desktop.apply();
  phone = makePhone({
    electron: electron, watcher: watcher, log: log, baseWeb: baseWeb, uiFile: ui, model: model, save: function () { store.save(); },
    widget: function () { return widgetWin && !widgetWin.isDestroyed() ? widgetWin : null; },
    setWidgetVisible: function (v) {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      if (v) { if (model.settings.showWidget) widgetWin.showInactive(); } else widgetWin.hide();
    }
  });
  setTimeout(safe(function () { phone.prepare(); }), 3000);
  ['display-added', 'display-removed', 'display-metrics-changed'].forEach(function (ev) {
    screen.on(ev, safe(function () { desktop.displaysChanged(); }));
  });
  setTimeout(function () { watcher.listProcesses(); }, 5000);
  setInterval(function () { watcher.listProcesses(); }, 10 * 60000);

  server = startServer({
    policy: function () { return P.sitePolicy(model, now()); },
    youtube: function (sec) {
      const t = now();
      const pol = P.sitePolicy(model, t);
      if (pol.yt.counting) { P.addYouTube(model, sec, t); store.save(); broadcast(); }
      return P.sitePolicy(model, t);
    },
    sendPage: async function (url) {
      if (!/^https?:\/\//i.test(url)) return { error: 'Only web links can be sent.' };
      if (!link.key) { notify('Pair with your phone first', 'Open Focus → Settings.'); return { error: 'not paired' }; }
      const ok = await link.send('open', { url: url.slice(0, 2000) });
      notify(ok ? 'Sent to your phone' : 'Couldn\'t reach your phone', ok ? url.slice(0, 100) : 'Check your internet connection.');
      return { ok: ok };
    },
    show: function (view) { showMain(['god', 'home', 'bible', 'today'].indexOf(view) >= 0 ? view : 'home'); return { ok: true }; }
  }, log);

  try {
    globalShortcut.register('Control+Alt+P', sendClipboard) || log('Ctrl+Alt+P is taken by another program');
  } catch (e) { log('shortcut: ' + e.message); }

  setInterval(safe(tick), 1500);
  setTimeout(function () { checkForUpdates(false); }, 60000);
  setInterval(function () { checkForUpdates(false); }, 6 * 3600000);
  setInterval(safe(restartWhenIdle), 60000);
  setTimeout(safe(ensureNotNow), 4000); // ready before the first Not now
  try {
    powerMonitor.on('resume', safe(function () { startLink(); broadcast(); }));
    powerMonitor.on('unlock-screen', safe(function () { broadcast(); }));
    powerMonitor.on('resume', safe(function () { if (desktop) desktop.displaysChanged(); }));
  } catch (e) { }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () { showMain('home'); });
  if (process.platform === 'win32') app.setAppUserModelId(AUMID);
  app.on('window-all-closed', function () { /* lives in the tray */ });
  app.on('before-quit', function () { quitting = true; try { store && store.flush(); } catch (e) { } });
  app.on('will-quit', function () { try { globalShortcut.unregisterAll(); } catch (e) { } });
  app.whenReady().then(safe(init));
}

module.exports = { snapshot: function () { return snapshot(); } };
