'use strict';
// One long-lived, hidden PowerShell that reports the foreground window and minimizes on request.
// Output: one JSON line per change. Input: commands on stdin ("min <hwnd>", "procs").
const { spawn } = require('child_process');
const EventEmitter = require('events');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FocusWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@
function Esc([string]$s) {
  if ($s -eq $null) { return '' }
  $b = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq '"') { [void]$b.Append('\"') }
    elseif ($ch -eq '\') { [void]$b.Append('\\') }
    elseif ($c -lt 32) { [void]$b.Append(('\u{0:x4}' -f $c)) }
    else { [void]$b.Append($ch) }
  }
  return $b.ToString()
}
function Say([string]$line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
$names = @{}
function NameOf([uint32]$procId) {
  if ($procId -eq 0) { return '' }
  if ($names.ContainsKey($procId)) { return $names[$procId] }
  $n = ''
  try { $n = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch { }
  if ($names.Count -gt 500) { $names.Clear() }
  $names[$procId] = $n
  return $n
}
Say '{"ready":true}'
# Console.In's ReadLineAsync is secretly synchronous; a StreamReader on the raw stream is not.
$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding $false))
$pending = $in.ReadLineAsync()
$last = ''
$tick = 0
while ($true) {
  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($cmd -eq $null) { exit 0 }
    $parts = $cmd.Trim().Split(' ')
    if ($parts[0] -eq 'min' -and $parts.Length -ge 2) {
      $ok = [FocusWin]::ShowWindowAsync([IntPtr][long]$parts[1], 6)
      Say ('{"ack":"min","hwnd":' + $parts[1] + ',"ok":' + $ok.ToString().ToLower() + '}')
    } elseif ($parts[0] -eq 'restore' -and $parts.Length -ge 2) {
      [void][FocusWin]::ShowWindowAsync([IntPtr][long]$parts[1], 9)
    } elseif ($parts[0] -eq 'procs') {
      $items = @()
      foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
        $items += ('{"exe":"' + (Esc $p.ProcessName) + '","title":"' + (Esc $p.MainWindowTitle) + '"}')
      }
      Say ('{"procs":[' + ($items -join ',') + ']}')
    } elseif ($parts[0] -eq 'ping') {
      Say '{"pong":true}'
    }
    $pending = $in.ReadLineAsync()
  }
  if ($tick % 6 -eq 0) {
    $h = [FocusWin]::GetForegroundWindow()
    if ($h -ne [IntPtr]::Zero) {
      [uint32]$procId = 0
      [void][FocusWin]::GetWindowThreadProcessId($h, [ref]$procId)
      $exe = NameOf $procId
      $title = [FocusWin]::Title($h)
      $r = New-Object FocusWin+RECT
      [void][FocusWin]::GetWindowRect($h, [ref]$r)
      $min = [FocusWin]::IsIconic($h)
      $key = "$h|$procId|$title|$min"
      if ($key -ne $last) {
        $last = $key
        Say ('{"fg":{"exe":"' + (Esc $exe) + '","pid":' + $procId + ',"hwnd":' + $h.ToInt64() + ',"title":"' + (Esc $title) + '","min":' + $min.ToString().ToLower() + ',"rect":[' + $r.Left + ',' + $r.Top + ',' + $r.Right + ',' + $r.Bottom + ']}}')
      }
    }
  }
  $tick++
  Start-Sleep -Milliseconds 250
}
`;

function encodedCommand(script) { return Buffer.from(script, 'utf16le').toString('base64'); }

class Watcher extends EventEmitter {
  constructor(log) {
    super();
    this.log = log || function () { };
    this.child = null;
    this.stopped = true;
    this.buf = '';
    this.restarts = 0;
    this.lastLine = 0;
    this.acks = {};
  }

  start() {
    if (process.platform !== 'win32') { this.log('watcher: not on Windows, program blocking is off'); return; }
    this.stopped = false;
    this._spawn();
    // If the script stops talking (hung), restart it.
    this.health = setInterval(() => {
      if (this.stopped || !this.child) return;
      if (Date.now() - this.lastLine > 60000) { this.log('watcher: silent for 60 s, restarting'); this._kill(); }
      else this._write('ping');
    }, 20000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.health);
    this._kill();
  }

  _kill() {
    const c = this.child;
    this.child = null;
    if (c) { try { c.kill(); } catch (e) { } }
  }

  _spawn() {
    if (this.stopped) return;
    let c;
    try {
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand(SCRIPT)],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.log('watcher: spawn failed: ' + e.message);
      return this._again();
    }
    this.child = c;
    this.lastLine = Date.now();
    this.buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => this._data(d));
    c.stderr.on('data', (d) => this.log('watcher stderr: ' + String(d).slice(0, 300)));
    c.stdin.on('error', () => { });
    c.on('error', (e) => { this.log('watcher error: ' + e.message); });
    c.on('exit', (code) => {
      if (this.child === c) this.child = null;
      if (!this.stopped) { this.log('watcher exited (' + code + '), restarting'); this._again(); }
    });
  }

  _again() {
    if (this.stopped) return;
    this.restarts++;
    const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(5, this.restarts)));
    clearTimeout(this.again);
    this.again = setTimeout(() => this._spawn(), wait);
  }

  _data(d) {
    this.buf += d;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      this.lastLine = Date.now();
      let o;
      try { o = JSON.parse(line); } catch (e) { this.log('watcher: bad line ' + line.slice(0, 200)); continue; }
      if (o.ready) { this.restarts = 0; this.emit('ready'); }
      if (o.fg) this.emit('foreground', o.fg);
      if (o.procs) this.emit('procs', o.procs);
      if (o.ack === 'min') { const k = String(o.hwnd); if (this.acks[k]) { clearTimeout(this.acks[k]); delete this.acks[k]; } }
    }
  }

  _write(s) {
    if (!this.child) return false;
    try { this.child.stdin.write(s + '\n'); return true; } catch (e) { return false; }
  }

  /** Minimizes a window. Never closes anything, so no work is lost. */
  minimize(hwnd) {
    const h = String(Math.floor(Number(hwnd) || 0));
    if (h === '0') return;
    const sent = this._write('min ' + h);
    // If the long-lived script didn't confirm within 2 s, do it with a one-off call.
    clearTimeout(this.acks[h]);
    this.acks[h] = setTimeout(() => { delete this.acks[h]; this._oneShotMinimize(h); }, sent ? 2000 : 0);
  }

  _oneShotMinimize(h) {
    if (process.platform !== 'win32') return;
    const s = 'Add-Type -Name W -Namespace F -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);\'; [void][F.W]::ShowWindowAsync([IntPtr][long]' + h + ', 6)';
    try {
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand(s)], { windowsHide: true, stdio: 'ignore' });
      c.on('error', (e) => this.log('one-shot minimize failed: ' + e.message));
    } catch (e) { this.log('one-shot minimize failed: ' + e.message); }
  }

  /** Brings a window back after a reason pass. */
  restore(hwnd) {
    const h = String(Math.floor(Number(hwnd) || 0));
    if (h !== '0') this._write('restore ' + h);
  }

  listProcesses() { this._write('procs'); }
}

module.exports = { Watcher, SCRIPT, encodedCommand };
