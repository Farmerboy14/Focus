'use strict';
// Focus for Windows bootstrap. This is the only code that lives inside the installed app.
// It picks the newest app folder (bundled, or an update in %APPDATA%/Focus/app) and runs it.
// Keep it tiny and stable: updates replace everything else.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

const BOOTSTRAP_VERSION = 1;
const bundledDir = path.join(__dirname, 'app');

app.setName('Focus');
let userDir = path.join(__dirname, '..', 'focus-data');
try {
  userDir = path.join(app.getPath('appData'), 'Focus');
  app.setPath('userData', userDir);
} catch (e) { }

function log(msg) {
  try { fs.mkdirSync(userDir, { recursive: true }); fs.appendFileSync(path.join(userDir, 'log.txt'), new Date().toISOString() + '  bootstrap: ' + msg + '\r\n'); } catch (e) { }
}

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')); } catch (e) { return null; }
}

function usable(dir) {
  const v = readVersion(dir);
  return v && fs.existsSync(path.join(dir, 'main.js')) && (v.minBootstrap | 0) <= BOOTSTRAP_VERSION ? v : null;
}

// A downloaded update waits in app.new; move it into place before anything from it is loaded.
const updDir = path.join(userDir, 'app');
const fresh = path.join(userDir, 'app.new');
try {
  if (usable(fresh)) {
    const old = path.join(userDir, 'app.old');
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(updDir)) fs.renameSync(updDir, old);
    fs.renameSync(fresh, updDir);
    fs.rmSync(old, { recursive: true, force: true });
    log('installed update ' + JSON.stringify(readVersion(updDir)));
  }
} catch (e) { log('could not install update yet: ' + e.message); }

const bundled = readVersion(bundledDir) || { version: 0 };
const updated = usable(updDir);
let dir = bundledDir;
if (updated && (updated.version | 0) > (bundled.version | 0)) dir = updDir;

global.FOCUS_BOOT = { version: BOOTSTRAP_VERSION, appDir: dir, bundledDir: bundledDir, userDir: userDir };

try {
  require(path.join(dir, 'main.js'));
} catch (e) {
  log('failed to start ' + dir + ': ' + (e && e.stack || e));
  if (dir !== bundledDir) {
    // A broken update must never brick the app: fall back to the copy that came with it.
    global.FOCUS_BOOT.appDir = bundledDir;
    global.FOCUS_BOOT.fellBack = true;
    require(path.join(bundledDir, 'main.js'));
  } else {
    app.whenReady().then(function () { dialog.showErrorBox('Focus could not start', String(e && e.message || e)); app.quit(); });
  }
}
