'use strict';
// The phone panel: click the widget and it grows into your phone. The widget becomes the phone's chin,
// the screen grows above it, and scrcpy's mirror of the real phone fills the screen. Click the chin to fold it back.
//
// scrcpy runs borderless with a known window title; watcher.js finds that window, ties it to the panel
// (owned, so it stays in front of it and off the taskbar) and fades it in and out.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TITLE = 'Focus phone';
const PAD = 12;        // bezel around the screen
const CHIN = 84;       // the widget, living on as the phone's chin
const ANIM_MS = 480;
const DEFAULT_ASPECT = 1280 / 2856; // Pixel 10 Pro, until scrcpy reports the real size

function makePhone(o) {
  // o: { electron, watcher, log, baseWeb, uiFile, model, save, widget(): BrowserWindow|null, setWidgetVisible(bool) }
  const { BrowserWindow, screen, ipcMain, dialog } = o.electron;
  const log = o.log;
  let stage = null;
  let state = 'closed';          // closed | opening | open | closing
  let geo = null;                // { stage, from, to, screen } in DIP
  let child = null, childPid = 0, hwnd = '', polling = null, errText = '', dropped = [];
  let lastOpen = 0, tail = [], retried = false;

  function settings() { return o.model.settings; }
  function send(ch, data) { if (stage && !stage.isDestroyed()) stage.webContents.send(ch, data); }
  function status(kind, message, extra) { send('phone:status', Object.assign({ kind: kind, message: message || '' }, extra || {})); }

  function hwndOf(win) {
    const b = win.getNativeWindowHandle();
    return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
  }
  function physical(win, r) {
    try { return screen.dipToScreenRect ? screen.dipToScreenRect(win, r) : r; } catch (e) { return r; }
  }

  // ---------- finding scrcpy ----------

  function isFile(p) { try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; } }
  function kids(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; } }

  /** Looks where scrcpy usually ends up: PATH, winget, scoop, Chocolatey, and scrcpy folders near home. */
  async function findScrcpy() {
    const saved = settings().scrcpyPath;
    if (isFile(saved)) return saved;
    const env = process.env;
    const home = env.USERPROFILE || '';
    const local = env.LOCALAPPDATA || '';
    const c = [];
    (env.PATH || '').split(';').forEach(function (d) { if (d) c.push(path.join(d.replace(/"/g, ''), 'scrcpy.exe')); });
    c.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'scrcpy.exe'));
    const pk = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    kids(pk).forEach(function (e) {
      if (e.isDirectory() && /scrcpy/i.test(e.name)) {
        c.push(path.join(pk, e.name, 'scrcpy.exe'));
        kids(path.join(pk, e.name)).forEach(function (f) { if (f.isDirectory()) c.push(path.join(pk, e.name, f.name, 'scrcpy.exe')); });
      }
    });
    c.push(path.join(home, 'scoop', 'apps', 'scrcpy', 'current', 'scrcpy.exe'));
    c.push(path.join(env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'scrcpy.exe'));
    // A scrcpy folder unzipped somewhere near home (or a level down)
    [home, path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Desktop'),
      path.join(home, 'OneDrive', 'Documents'), 'C:\\', 'C:\\tools', 'C:\\Program Files', path.join(local, 'Programs')].forEach(function (base) {
      kids(base).forEach(function (e) {
        if (!e.isDirectory()) return;
        const d = path.join(base, e.name);
        if (/scrcpy/i.test(e.name)) {
          c.push(path.join(d, 'scrcpy.exe'));
          kids(d).forEach(function (f) { if (f.isDirectory() && /scrcpy/i.test(f.name)) c.push(path.join(d, f.name, 'scrcpy.exe')); });
        }
      });
    });
    let found = c.filter(isFile)[0] || '';
    if (!found) {
      const running = await o.watcher.request('procpath', ['scrcpy'], 4000);
      if (typeof running === 'string' && isFile(running)) found = running;
    }
    if (found) { settings().scrcpyPath = found; o.save(); log('phone: found scrcpy at ' + found); }
    return found;
  }

  // ---------- the panel window ----------

  function ensureStage() {
    if (stage && !stage.isDestroyed()) return stage;
    stage = new BrowserWindow({
      width: 400, height: 800, show: false, frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, backgroundColor: '#00000000', title: 'Focus phone panel', webPreferences: o.baseWeb()
    });
    stage.setAlwaysOnTop(true, 'floating');
    stage.loadFile(o.uiFile('phone.html'));
    stage.on('closed', function () { stage = null; if (state !== 'closed') { state = 'closed'; stopScrcpy(); o.setWidgetVisible(true); } });
    return stage;
  }

  function geometry(wb) {
    const card = { x: wb.x + 5, y: wb.y + 5, width: wb.width - 10, height: wb.height - 10 };
    const d = screen.getDisplayMatching(wb);
    const wa = d.workArea;
    const aspect = settings().phoneAspect > 0.2 && settings().phoneAspect < 1 ? settings().phoneAspect : DEFAULT_ASPECT;
    const H = Math.round(Math.min(wa.height - 32, 1040));
    const sh = H - PAD - CHIN;
    const sw = Math.round(sh * aspect);
    const W = Math.max(card.width, sw + 2 * PAD);
    const right = card.x + card.width / 2 > wa.x + wa.width / 2;
    const bottom = card.y + card.height / 2 > wa.y + wa.height / 2;
    let x = right ? card.x + card.width - W : card.x;
    let y = bottom ? card.y + card.height - H : card.y;
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - W - 8));
    y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - H - 8));
    const panel = { x: x, y: y, width: W, height: H };
    // The window covers the panel and the widget's card, so the morph can start exactly where the widget was.
    const sx = Math.min(panel.x, card.x), sy = Math.min(panel.y, card.y);
    const st = { x: sx, y: sy, width: Math.max(panel.x + W, card.x + card.width) - sx, height: Math.max(panel.y + H, card.y + card.height) - sy };
    const rel = function (r) { return { x: r.x - sx, y: r.y - sy, w: r.width, h: r.height }; };
    const scr = { x: panel.x + Math.round((W - sw) / 2), y: panel.y + PAD, width: sw, height: sh };
    return { stage: st, from: rel(card), to: rel(panel), screen: scr, screenRel: rel(scr), pad: PAD, chin: CHIN };
  }

  // ---------- scrcpy ----------

  function stopScrcpy() {
    clearInterval(polling); polling = null;
    const pid = childPid;
    child = null; childPid = 0; hwnd = '';
    if (pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', function () { }); } catch (e) { }
    } else if (pid) { try { process.kill(pid); } catch (e) { } }
  }

  function scrcpyArgs(rect) {
    const args = ['--window-title=' + TITLE, '--window-borderless', '--no-audio',
      '--window-x=' + rect.x, '--window-y=' + rect.y, '--window-width=' + rect.width, '--window-height=' + rect.height,
      '--max-size=' + Math.max(rect.width, rect.height)];
    return args.filter(function (a) { return dropped.indexOf(a.split('=')[0]) < 0; });
  }

  async function startScrcpy() {
    stopScrcpy();
    errText = '';
    tail = [];
    const exe = await findScrcpy();
    if (state !== 'opening' && state !== 'open') return;
    if (!exe) { status('missing', 'Focus couldn\'t find scrcpy on this PC.'); return; }
    status('waking', 'Waking your phone…');
    const rect = physical(stage, geo.screen);
    const args = scrcpyArgs(rect);
    let c;
    try {
      // Through cmd so scrcpy's console stays hidden but its window shows (like scrcpy-noconsole.vbs).
      const line = '"' + '"' + exe + '" ' + args.map(function (a) { return '"' + a + '"'; }).join(' ') + '"';
      c = process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { windowsHide: true, windowsVerbatimArguments: true, cwd: path.dirname(exe) })
        : spawn(exe, args, { cwd: path.dirname(exe) });
    } catch (e) { status('error', 'scrcpy wouldn\'t start: ' + e.message); return; }
    child = c; childPid = c.pid;
    const started = Date.now();
    const onOut = function (d) {
      const text = String(d);
      text.split(/\r?\n/).forEach(function (l) {
        l = l.trim();
        if (!l) return;
        tail.push(l); if (tail.length > 14) tail.shift();
        if (/^ERROR|error:|unrecognized option|Could not|not found|unauthorized/i.test(l)) {
          const e = l.replace(/^ERROR:\s*/, '');
          // Keep the specific reason; "Server connection failed" only says that something above went wrong.
          if (!(errText && /Server connection failed/i.test(e))) errText = e;
        }
        const m = /Texture:\s*(\d+)x(\d+)/.exec(l);
        if (m) aspectSeen(Number(m[1]), Number(m[2]));
      });
    };
    c.stdout && c.stdout.on('data', onOut);
    c.stderr && c.stderr.on('data', onOut);
    c.on('error', function (e) { errText = e.message; });
    c.on('exit', function (code) {
      if (child !== c) return;
      child = null; childPid = 0;
      clearInterval(polling); polling = null;
      const bad = /unrecognized option '?(--[a-z-]+)/i.exec(errText);
      if (bad && dropped.indexOf(bad[1]) < 0 && (state === 'opening' || state === 'open')) {
        // An older scrcpy that doesn't know an option: try once more without it.
        dropped.push(bad[1]);
        log('phone: scrcpy doesn\'t know ' + bad[1] + ', trying without it');
        startScrcpy();
        return;
      }
      log('phone: scrcpy exited (' + code + ')' + (errText ? ': ' + errText : ''));
      if (code && tail.length) log('phone: scrcpy said:\r\n    ' + tail.join('\r\n    '));
      if (state === 'open' && hwnd) { hwnd = ''; collapse(); return; }   // the mirror closed: fold away
      hwnd = '';
      if (!retried && (state === 'opening' || state === 'open') && Date.now() - started < 20000) {
        // The first run often starts adb's server and loses the race to connect. One quiet retry.
        retried = true;
        status('waking', 'Waking your phone…');
        setTimeout(function () { if (state === 'opening' || state === 'open') startScrcpy(); }, 1500);
        return;
      }
      if (state === 'opening' || state === 'open') status('error', 'Couldn\'t reach your phone.', { detail: friendly(errText) });
    });
    clearInterval(polling);
    polling = setInterval(async function () {
      if (hwnd || !child) return;
      if (Date.now() - started > 25000) { status('error', 'Your phone didn\'t answer.', { detail: errText || 'Check the cable and that USB debugging is allowed.' }); stopScrcpy(); return; }
      const h = await o.watcher.request('phonefind', [Buffer.from(TITLE, 'utf8').toString('base64')], 2000);
      if (!h || h === 0 || hwnd || !child || !stage) return;
      hwnd = String(h);
      clearInterval(polling); polling = null;
      await place();
      await o.watcher.request('phonefade', [hwnd, 0, 255, 140], 3000);
      status('live', '');
      o.watcher.request('phonefront', [hwnd], 2000);
      log('phone: mirror is up');
    }, 150);
  }

  /** scrcpy's errors, in plain words. */
  function friendly(e) {
    if (!e) return 'Is it plugged in, with USB debugging on?';
    if (/Could not find any ADB device/i.test(e)) return 'Your phone isn\'t connected. Plug it in with the USB cable, and if the phone asks, allow USB debugging.';
    if (/unauthorized/i.test(e)) return 'Your phone is asking to allow USB debugging. Tap Allow on the phone, then Try again.';
    if (/more than one device/i.test(e)) return 'More than one phone or emulator is connected. Unplug the extra one, then Try again.';
    return e;
  }

  async function place() {
    if (!hwnd || !stage || stage.isDestroyed()) return;
    const r = physical(stage, geo.screen);
    await o.watcher.request('phoneown', [hwnd, hwndOf(stage), r.x, r.y, r.width, r.height], 3000);
  }

  /** scrcpy says how big the phone's screen really is; fit the panel to it if it's different. */
  function aspectSeen(w, h) {
    if (!(w > 0 && h > 0) || w >= h) return;
    const a = w / h;
    const old = settings().phoneAspect || DEFAULT_ASPECT;
    if (settings().phoneAspect !== a) { settings().phoneAspect = a; o.save(); }
    if (Math.abs(a - old) / old < 0.01 || (state !== 'open' && state !== 'opening')) return;
    const w0 = o.widget();
    if (!geo || !geo.widgetBounds) return;
    const g = geometry(geo.widgetBounds);
    g.widgetBounds = geo.widgetBounds;
    geo = g;
    stage.setBounds(g.stage);
    send('phone:show', { from: g.from, to: g.to, screen: g.screenRel, pad: g.pad, chin: g.chin, instant: true });
    place();
    void w0;
  }

  // ---------- open / close ----------

  function open() {
    if (state === 'opening' || state === 'open') return;
    if (Date.now() - lastOpen < 400) return;
    lastOpen = Date.now();
    const w = o.widget();
    if (!w || w.isDestroyed()) return;
    const s = ensureStage();
    const wb = w.getBounds();
    geo = geometry(wb);
    geo.widgetBounds = wb;
    state = 'opening';
    retried = false;
    const go = function () {
      s.setBounds(geo.stage);
      send('phone:show', { from: geo.from, to: geo.to, screen: geo.screenRel, pad: geo.pad, chin: geo.chin });
      s.show();
      // The panel paints the widget exactly where it was, then the real widget steps aside.
      setTimeout(function () { o.setWidgetVisible(false); }, 60);
      setTimeout(function () { if (state === 'opening') state = 'open'; }, ANIM_MS);
      startScrcpy();
    };
    if (s.webContents.isLoading()) s.webContents.once('did-finish-load', go); else go();
  }

  async function collapse() {
    if (state === 'closed' || state === 'closing') return;
    state = 'closing';
    clearInterval(polling); polling = null;
    if (hwnd) await o.watcher.request('phonefade', [hwnd, 255, 0, 150], 2000);
    stopScrcpy();
    send('phone:shrink', {});
    // phone:shrunk from the page finishes it; this is the backstop.
    setTimeout(finishCollapse, ANIM_MS + 400);
  }

  function finishCollapse() {
    if (state !== 'closing') return;
    state = 'closed';
    o.setWidgetVisible(true);
    setTimeout(function () { if (state === 'closed' && stage && !stage.isDestroyed()) stage.hide(); }, 50);
  }

  ipcMain.handle('phone:collapse', function () { collapse(); return true; });
  ipcMain.handle('phone:shrunk', function () { finishCollapse(); return true; });
  ipcMain.handle('phone:retry', function () { if (state === 'open' || state === 'opening') { retried = false; startScrcpy(); } return true; });
  ipcMain.handle('phone:choose', async function () {
    const r = await dialog.showOpenDialog(stage && !stage.isDestroyed() ? stage : undefined, {
      title: 'Where is scrcpy.exe?', properties: ['openFile'], filters: [{ name: 'scrcpy', extensions: ['exe'] }]
    });
    if (r.canceled || !r.filePaths[0]) return false;
    settings().scrcpyPath = r.filePaths[0];
    o.save();
    if (state === 'open' || state === 'opening') startScrcpy();
    return true;
  });

  return {
    open: open,
    collapse: collapse,
    prepare: function () { ensureStage(); },
    window: function () { return stage && !stage.isDestroyed() ? stage : null; },
    isOpen: function () { return state !== 'closed'; },
    find: findScrcpy,
    quit: function () { state = 'closed'; stopScrcpy(); }
  };
}

module.exports = { makePhone, TITLE };
