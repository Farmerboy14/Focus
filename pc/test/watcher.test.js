'use strict';
// The Windows helper script: it must start from a file (it's too long for a command line), and its C# must
// stay inside what Windows PowerShell 5.1's compiler accepts (checked with mcs -langversion:5 when available).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, run } = require('./harness');
const W = require('../app/lib/watcher');

test('the script is launched from a .ps1 file, never as a too-long -EncodedCommand', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'watcher.js'), 'utf8');
  assert.ok(/'-File', scriptFile\(this\.dir\)/.test(src), 'spawn uses -File');
  assert.ok(!/'-EncodedCommand', encodedCommand\(SCRIPT\)/.test(src), 'no -EncodedCommand for the long script');
});

test('scriptFile writes the script with a BOM and only rewrites when it changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-ps1-'));
  const f = W.scriptFile(dir);
  const buf = fs.readFileSync(f);
  assert.deepStrictEqual([...buf.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.strictEqual(buf.slice(3).toString('utf8'), W.SCRIPT);
  const m = fs.statSync(f).mtimeMs;
  W.scriptFile(dir);
  assert.strictEqual(fs.statSync(f).mtimeMs, m);
});

test('the embedded C# compiles as C# 5 (Windows PowerShell 5.1)', () => {
  let mcs = '';
  try { mcs = execFileSync('which', ['mcs']).toString().trim(); } catch (e) { }
  if (!mcs) { console.log('       (mcs not installed, skipped)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-cs-'));
  const a = W.SCRIPT.indexOf('@"') + 2, b = W.SCRIPT.indexOf('"@');
  fs.writeFileSync(path.join(dir, 'f.cs'), W.SCRIPT.slice(a, b));
  execFileSync(mcs, ['-langversion:5', '-target:library', '-out:' + path.join(dir, 'f.dll'), path.join(dir, 'f.cs')], { stdio: 'pipe' });
});

test('the desktop input helper (mouse and wheel) compiles as C# 5 too, and never uses $ (PowerShell would expand it)', () => {
  const D = require('../app/lib/deskinput');
  const a = D.SCRIPT.indexOf('@"') + 2, b = D.SCRIPT.indexOf('"@');
  const cs = D.SCRIPT.slice(a, b);
  assert.ok(cs.indexOf('$') < 0, 'no $ inside the C#');
  assert.ok(/WH_MOUSE_LL/.test(cs) && /CallNextHookEx\(hook, code, w, l\)/.test(cs), 'the wheel hook passes every event on');
  let mcs = '';
  try { mcs = execFileSync('which', ['mcs']).toString().trim(); } catch (e) { }
  if (!mcs) { console.log('       (mcs not installed, skipped)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-cs-'));
  fs.writeFileSync(path.join(dir, 'd.cs'), cs);
  execFileSync(mcs, ['-langversion:5', '-target:library', '-out:' + path.join(dir, 'd.dll'), path.join(dir, 'd.cs')], { stdio: 'pipe' });
});

run('watcher');
