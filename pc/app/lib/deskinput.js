'use strict';
// Lets the desktop layer feel the mouse. It sits under the icons, so Windows never sends it clicks; this small
// helper watches the pointer, and while it's over the bare desktop it reports moves and left clicks, which
// desktop.js passes into the page. Real pixels, one line per change: "m x y", "d x y", "u x y", "l" (left the desktop).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const SCRIPT = String.raw`
param([int]$Owner)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class FocusDeskInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  static string Cls(IntPtr h) { var sb = new StringBuilder(128); GetClassName(h, sb, 128); return sb.ToString(); }

  // The bare desktop: the icon view, or Explorer's wallpaper windows. Our own window only shows up here when
  // the icons are hidden, and then Windows already sends it the mouse itself.
  static bool OverDesktop(POINT p) {
    string c = Cls(WindowFromPoint(p));
    return c == "SysListView32" || c == "SHELLDLL_DefView" || c == "WorkerW" || c == "Progman";
  }

  public static void Run(int owner) {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
    int swap = GetSystemMetrics(23); // left-handed mouse: the primary button is the right one
    int btn = swap != 0 ? 0x02 : 0x01;
    POINT last = new POINT(); bool over = false, down = false, sentDown = false;
    int tick = 0;
    var o = Console.Out;
    while (true) {
      if (++tick % 80 == 0) {
        try { Process.GetProcessById(owner); } catch (Exception) { return; } // Focus is gone: stop
      }
      POINT p;
      if (GetCursorPos(out p)) {
        bool now = OverDesktop(p);
        bool isDown = (GetAsyncKeyState(btn) & 0x8000) != 0;
        if (now) {
          if (!over || p.X != last.X || p.Y != last.Y) { o.WriteLine("m " + p.X + " " + p.Y); last = p; }
          if (isDown != down) {
            // A press that starts over the desktop is ours; a release only if we sent the press.
            if (isDown) { o.WriteLine("d " + p.X + " " + p.Y); sentDown = true; }
            else if (sentDown) { o.WriteLine("u " + p.X + " " + p.Y); sentDown = false; }
          }
          over = true;
        } else {
          if (sentDown && (p.X != last.X || p.Y != last.Y)) { o.WriteLine("m " + p.X + " " + p.Y); last = p; } // keep a drag going
          if (sentDown && !isDown) { o.WriteLine("u " + p.X + " " + p.Y); sentDown = false; }
          if (over && !sentDown) { o.WriteLine("l"); over = false; }
        }
        down = isDown;
        o.Flush();
      }
      System.Threading.Thread.Sleep(over || sentDown ? 16 : 60);
    }
  }
}
"@
[FocusDeskInput]::Run($Owner)
`;

function scriptFile(dir) {
  const d = dir || os.tmpdir();
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'focus-deskinput.ps1');
  const body = '﻿' + SCRIPT;
  let same = false;
  try { same = fs.readFileSync(f, 'utf8') === body; } catch (e) { }
  if (!same) fs.writeFileSync(f, body, 'utf8');
  return f;
}

class DeskInput extends EventEmitter {
  constructor(log, dir) {
    super();
    this.log = log || function () { };
    this.dir = dir;
    this.child = null;
    this.on_ = false;
    this.buf = '';
    this.fails = 0;
  }

  start() {
    if (process.platform !== 'win32' || this.on_) return;
    this.on_ = true;
    this._spawn();
  }

  stop() {
    this.on_ = false;
    clearTimeout(this.again);
    const c = this.child;
    this.child = null;
    if (c) { try { c.kill(); } catch (e) { } }
  }

  _spawn() {
    if (!this.on_) return;
    let c;
    try {
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptFile(this.dir), '-Owner', String(process.pid)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { this.log('desk input: ' + e.message); return; }
    this.child = c;
    this.buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => {
      this.fails = 0;
      this.buf += d;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) this.emit('line', line);
      }
    });
    c.stderr.on('data', (d) => this.log('desk input: ' + String(d).slice(0, 200)));
    c.on('error', (e) => this.log('desk input: ' + e.message));
    c.on('exit', () => {
      if (this.child !== c) return;
      this.child = null;
      if (!this.on_) return;
      this.fails++;
      this.again = setTimeout(() => this._spawn(), Math.min(60000, 2000 * this.fails));
    });
  }
}

module.exports = { DeskInput, SCRIPT, scriptFile };
