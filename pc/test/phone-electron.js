'use strict';
// Runs lib/phone.js in real Electron with a fake scrcpy (a script) and a stand-in for the Windows calls.
// Records the widget-to-phone morph as frames. Run:
//   xvfb-run -a node_modules/.bin/electron --no-sandbox --disable-gpu test/phone-electron.js [framesDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const S = require('../app/lib/schedule');
const { defaults } = require('../app/lib/store');
const { makePhone } = require('../app/lib/phone');

const APP = path.join(__dirname, '..', 'app');
const FRAMES = process.argv[process.argv.length - 1].indexOf('frames') >= 0 ? process.argv[process.argv.length - 1] : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-phone-'));
const fake = path.join(tmp, 'scrcpy.exe');
const argsFile = path.join(tmp, 'args.txt');
const failWifi = path.join(tmp, 'failwifi');
fs.writeFileSync(fake, [
  '#!/bin/sh',
  'echo "$@" >> ' + JSON.stringify(argsFile),
  'case "$*" in',
  '  *--tcpip=*) if [ -f ' + JSON.stringify(failWifi) + ' ]; then echo "ERROR: Could not connect to 192.168.1.42:5555"; exit 1; fi ;;',
  '  *--tcpip*) echo "INFO: Device IP: 192.168.1.42"; echo "INFO: Connected to 192.168.1.42:5555" ;;',
  'esac',
  'echo "INFO: Renderer: fake"', 'echo "INFO: Texture: 1080x2400"', 'exec sleep 60', ''].join('\n'));
fs.chmodSync(fake, 0o755);
const fails = [];
function ok(c, m) { if (c) console.log('  ok   ' + m); else { console.log('  FAIL ' + m); fails.push(m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];
let windowUp = false;
const watcher = {
  ready: () => Promise.resolve(true),
  request: async function (verb, args) {
    calls.push([verb].concat(args || []));
    if (verb === 'phonefind') return windowUp ? 4242 : 0;
    if (verb === 'phoneown' || verb === 'phonefade' || verb === 'phonefront') return true;
    if (verb === 'procpath') return '';
    return null;
  }
};
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
function pidOfFake() {
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    try { if (fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').indexOf('sleep\u000060') >= 0) return Number(p); } catch (e) { }
  }
  return 0;
}

app.whenReady().then(async function () {
  const model = defaults();
  ipcMain.handle('state:get', function () { const t = Date.now(); return { now: t, sched: model.sched, cur: S.current(model.sched, t), upcoming: S.upcoming(model.sched, t, 3), settings: model.settings, paused: 0 }; });
  const wa = electron.screen.getPrimaryDisplay().workArea;
  const widget = new BrowserWindow({ x: wa.x + wa.width - 320, y: wa.y + wa.height - 130, width: 300, height: 110, frame: false, transparent: true, show: false,
    webPreferences: { preload: path.join(APP, 'preload.js'), contextIsolation: true, sandbox: true } });
  widget.loadFile(path.join(APP, 'ui', 'widget.html'));
  await new Promise((r) => widget.once('ready-to-show', r));
  widget.showInactive();
  let widgetShown = true;
  const phone = makePhone({
    electron: electron, watcher: watcher, log: function (m) { console.log('       log: ' + m); },
    baseWeb: function () { return { preload: path.join(APP, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }; },
    uiFile: function (n) { return path.join(APP, 'ui', n); }, model: model, save: function () { },
    widget: function () { return widget; }, setWidgetVisible: function (v) { widgetShown = v; if (v) widget.showInactive(); else widget.hide(); }
  });

  try {
    // 1) scrcpy not found
    model.settings.scrcpyPath = '';
    const oldPath = process.env.PATH; process.env.PATH = '/nonexistent'; const oldHome = process.env.USERPROFILE; process.env.USERPROFILE = tmp + '/nohome';
    phone.prepare();
    await sleep(1500);
    phone.open();
    await sleep(900);
    const st = phone.window();
    const msg = await st.webContents.executeJavaScript('document.getElementById("msgT").textContent + "|" + document.getElementById("msgBtn").textContent');
    ok(/couldn't find scrcpy/i.test(msg) && /Find scrcpy/.test(msg), 'without scrcpy it says so and offers to find it: ' + msg);
    ok(!widgetShown && !widget.isVisible(), 'the widget stepped aside while the phone is open');
    await phone.collapse();
    await sleep(900);
    ok(widgetShown && widget.isVisible() && !st.isVisible(), 'folding back shows the widget and hides the panel');
    process.env.PATH = oldPath; process.env.USERPROFILE = oldHome;

    // 2) with scrcpy: record the morph
    model.settings.scrcpyPath = fake;
    await sleep(500);
    const t0 = Date.now();
    phone.open();
    const frames = [];
    if (FRAMES) {
      fs.mkdirSync(FRAMES, { recursive: true });
      for (const at of [20, 110, 200, 290, 380, 560]) {
        await sleep(Math.max(0, at - (Date.now() - t0)));
        const img = await st.webContents.capturePage();
        const f = path.join(FRAMES, 'f' + String(at).padStart(3, '0') + '.png');
        fs.writeFileSync(f, img.toPNG());
        frames.push(f);
      }
    }
    await sleep(800);
    const b = st.getBounds();
    ok(st.isVisible() && b.height > 500 && b.width > 280 && b.width < b.height, 'the panel grew into a phone shape: ' + b.width + 'x' + b.height + ' at ' + b.x + ',' + b.y);
    ok(b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height && b.y >= wa.y, 'and stays on the screen');
    const args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8') : '';
    ok(/--window-title=Focus phone/.test(args) && /--window-borderless/.test(args) && /--no-audio/.test(args) && /--window-x=\d+/.test(args) && /--tcpip$/m.test(args), 'scrcpy started borderless, setting up Wi-Fi: ' + args.trim());
    windowUp = true;
    for (let i = 0; i < 30 && !calls.some((c) => c[0] === 'phoneown'); i++) await sleep(100);
    const own = calls.filter((c) => c[0] === 'phoneown').pop();
    ok(own && own[1] === '4242' && /^\d+$/.test(own[2]) && Number(own[5]) > 100 && Number(own[6]) > 300, 'the mirror window was tied to the panel and placed over its screen: ' + (own && own.slice(3).join(',')));
    await sleep(400);
    ok(calls.some((c) => c[0] === 'phonefade' && c[2] === 0 && c[3] === 255), 'and faded in');
    const live = await st.webContents.executeJavaScript('document.getElementById("msg").classList.contains("hidden")');
    ok(live, 'the waking message cleared once the mirror is up');
    ok(Math.abs(model.settings.phoneAspect - 1080 / 2400) < 0.001, 'learned the real screen shape from scrcpy (' + model.settings.phoneAspect + ')');
    const sc = await st.webContents.executeJavaScript('(function(){var s=document.getElementById("screen").getBoundingClientRect();return [s.x,s.y,s.width,s.height].map(Math.round).join(",")})()');
    const own2 = calls.filter((c) => c[0] === 'phoneown').pop();
    ok(Number(sc.split(',')[2]) === Number(own2[5]) && Number(sc.split(',')[3]) === Number(own2[6]), 'the drawn screen matches where the mirror sits (' + sc + ' vs ' + own2.slice(3).join(',') + ')');
    const shot = await st.webContents.capturePage();
    fs.writeFileSync(path.join(tmp, 'open.png'), shot.toPNG());
    if (FRAMES) fs.copyFileSync(path.join(tmp, 'open.png'), path.join(FRAMES, 'open.png'));

    // 3) fold back: the mirror fades out and scrcpy stops
    const pid = pidOfFake();
    ok(pid > 0, 'fake scrcpy is running (pid ' + pid + ')');
    await phone.collapse();
    ok(calls.some((c) => c[0] === 'phonefade' && c[2] === 255 && c[3] === 0), 'folding fades the mirror out first');
    await sleep(900);
    ok(!alive(pid), 'and stops scrcpy');
    ok(widget.isVisible() && !st.isVisible(), 'and the widget is back');

    // 4) the mirror closing on its own folds the phone away
    windowUp = false;
    phone.open();
    await sleep(700);
    windowUp = true;
    await sleep(800);
    const pid2 = pidOfFake();
    process.kill(pid2);
    await sleep(1500);
    ok(!phone.isOpen() && widget.isVisible(), 'when scrcpy closes, the phone folds back into the widget');

    // 5) Wi-Fi: set up through the cable once, then straight over Wi-Fi; back to the cable if Wi-Fi is off
    ok(model.settings.phoneAddr === '192.168.1.42:5555', 'remembered the phone\'s Wi-Fi address from the cable setup (' + model.settings.phoneAddr + ')');
    ok(calls.some((c) => c[0] === 'phoneround' && c[1] === '4242' && Number(c[4]) > 0), 'the mirror\'s corners were rounded');
    fs.writeFileSync(argsFile, '');
    windowUp = true;
    phone.open();
    await sleep(1800);
    let lines = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    ok(lines.length === 1 && /--tcpip=192\.168\.1\.42:5555/.test(lines[0]) && !/--select-usb/.test(lines[0]), 'next time it connects straight over Wi-Fi: ' + lines[0].replace(/.*(--tcpip\S*)/, '$1'));
    await phone.collapse();
    await sleep(900);
    fs.writeFileSync(argsFile, '');
    fs.writeFileSync(failWifi, '1');
    windowUp = false;
    phone.open();
    await sleep(2600);
    windowUp = true;
    await sleep(800);
    lines = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    ok(lines.length === 2 && /--tcpip=/.test(lines[0]) && /--tcpip$/.test(lines[1]) && !/--tcpip=/.test(lines[1]), 'when Wi-Fi is off it sets it up again: ' + lines.map((l) => l.replace(/.*--max-size=\d+ ?/, '')).join(' | '));
    ok(phone.isOpen() && calls.filter((c) => c[0] === 'phoneown').length > 0, 'and the mirror still comes up');
    await phone.collapse();
    await sleep(700);
    phone.quit();
  } catch (e) { console.log(e && e.stack); fails.push(String(e)); }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all phone checks passed') + '   (' + tmp + ')');
  app.exit(fails.length ? 1 : 0);
});
app.on('window-all-closed', function () { });
