'use strict';
// One long-lived, hidden PowerShell that reports the foreground window and minimizes on request.
// Output: one JSON line per change. Input: commands on stdin ("min <hwnd>", "procs").
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

// Focus on the desktop: tucks a window into the layer under the desktop icons, and sets the Windows wallpaper.
public static class FocusDesk {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string n);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint a, uint p, string v, uint f);

  const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
  const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L, WS_EX_NOREDIRECTIONBITMAP = 0x00200000L;
  const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
  static readonly IntPtr BOTTOM = new IntPtr(1);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static void Aware() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { } }

  public static string Esc(string s) {
    if (s == null) return "";
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"') b.Append("\\\"");
      else if (c == '\\') b.Append("\\\\");
      else if (c < 32) b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.ToString();
  }
  static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  static string Res(string mode, string why) { return "{\"mode\":\"" + mode + "\",\"why\":\"" + Esc(why) + "\"}"; }

  static void Place(IntPtr me, IntPtr parent, IntPtr after, int x, int y, int w, int h) {
    POINT p; p.X = x; p.Y = y;
    ScreenToClient(parent, ref p);
    uint f = SWP_NOACTIVATE | SWP_SHOWWINDOW;
    if (after == IntPtr.Zero) f |= SWP_NOZORDER;
    SetWindowPos(me, after, p.X, p.Y, w, h, f);
  }

  /** Puts the window under the icons. x, y, w, h are the screen's rectangle in physical pixels. */
  public static string Embed(long hwnd, int x, int y, int w, int h) {
    Aware();
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return Res("none", "no window");
    IntPtr pm = FindWindow("Progman", null);
    if (pm == IntPtr.Zero) return Res("none", "no Progman");
    IntPtr r;
    // Ask Explorer to split the wallpaper into its own layer behind the icons.
    SendMessageTimeout(pm, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
    SendMessageTimeout(pm, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
    bool raised = (GetLong(pm, GWL_EXSTYLE).ToInt64() & WS_EX_NOREDIRECTIONBITMAP) != 0;
    if (!raised) {
      // Windows 10 and Windows 11 up to 23H2: a top-level WorkerW right behind the one that holds the icons.
      IntPtr worker = IntPtr.Zero;
      EnumWindows(delegate (IntPtr top, IntPtr l) {
        if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
        return true;
      }, IntPtr.Zero);
      if (worker != IntPtr.Zero) {
        if (SetParent(me, worker) == IntPtr.Zero && GetAncestor(me, 1) != worker) return Res("none", "SetParent failed");
        Place(me, worker, IntPtr.Zero, x, y, w, h);
        return Res("classic", "");
      }
    }
    // Windows 11 24H2 and later: the icons and the wallpaper are both children of Progman.
    IntPtr def = FindWindowEx(pm, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def == IntPtr.Zero) return Res("none", "no icon layer");
    long st = GetLong(me, GWL_STYLE).ToInt64();
    SetLong(me, GWL_STYLE, new IntPtr((st & ~WS_POPUP) | WS_CHILD));
    if (SetParent(me, pm) == IntPtr.Zero && GetAncestor(me, 1) != pm) return Res("none", "SetParent failed");
    Place(me, pm, def, x, y, w, h);
    IntPtr ww = FindWindowEx(pm, IntPtr.Zero, "WorkerW", null);
    if (ww != IntPtr.Zero) SetWindowPos(ww, BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    return Res(raised ? "raised" : "progman", "");
  }

  /** Still in place? On 24H2 also puts it back under the icons and over Explorer's own wallpaper layer. */
  public static string Check(long hwnd) {
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return "{\"ok\":false,\"why\":\"gone\"}";
    IntPtr parent = GetAncestor(me, 1);
    string cls = ClassOf(parent);
    if (cls == "WorkerW") {
      if (!IsWindowVisible(parent)) return "{\"ok\":false,\"why\":\"layer hidden\"}";
      return "{\"ok\":true}";
    }
    if (cls == "Progman") {
      IntPtr def = FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (def == IntPtr.Zero) return "{\"ok\":false,\"why\":\"no icon layer\"}";
      SetWindowPos(me, def, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      IntPtr ww = FindWindowEx(parent, IntPtr.Zero, "WorkerW", null);
      if (ww != IntPtr.Zero) SetWindowPos(ww, BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      return "{\"ok\":true}";
    }
    return "{\"ok\":false,\"why\":\"parent " + Esc(cls) + "\"}";
  }

  public static string WallGet() {
    string p = "", style = "", tile = "";
    using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop")) {
      if (k != null) {
        p = Convert.ToString(k.GetValue("WallPaper", ""));
        style = Convert.ToString(k.GetValue("WallpaperStyle", ""));
        tile = Convert.ToString(k.GetValue("TileWallpaper", ""));
      }
    }
    return "{\"path\":\"" + Esc(p) + "\",\"style\":\"" + Esc(style) + "\",\"tile\":\"" + Esc(tile) + "\"}";
  }

  public static string WallSet(string path, string style, string tile) {
    using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop", true)) {
      if (k != null) {
        if (style != "") k.SetValue("WallpaperStyle", style);
        if (tile != "") k.SetValue("TileWallpaper", tile);
      }
    }
    bool ok = SystemParametersInfo(0x0014, 0, path, 0x01 | 0x02);
    return "{\"ok\":" + (ok ? "true" : "false") + "}";
  }
}

// The phone panel: finds the scrcpy window, ties it to Focus's panel, and fades it in and out.
public static class FocusPhone {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  static readonly IntPtr TOPMOST = new IntPtr(-1);
  const int GWLP_HWNDPARENT = -8, GWL_EXSTYLE = -20;
  const long WS_EX_LAYERED = 0x80000L, WS_EX_TOOLWINDOW = 0x80L, WS_EX_APPWINDOW = 0x40000L;

  public static long Find(string title) {
    IntPtr h = FindWindow(null, title);
    return h != IntPtr.Zero && IsWindowVisible(h) ? h.ToInt64() : 0;
  }

  static void Alpha(IntPtr h, int a) {
    long ex = GetLong(h, GWL_EXSTYLE).ToInt64();
    if ((ex & WS_EX_LAYERED) == 0) SetLong(h, GWL_EXSTYLE, new IntPtr(ex | WS_EX_LAYERED));
    SetLayeredWindowAttributes(h, 0, (byte)Math.Max(0, Math.Min(255, a)), 2);
  }

  /** Owned by the panel (so it moves in front with it), kept off the taskbar, placed over the panel's screen. */
  public static bool Own(long hwnd, long owner, int x, int y, int w, int h) {
    FocusDesk.Aware();
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return false;
    long ex = GetLong(me, GWL_EXSTYLE).ToInt64();
    SetLong(me, GWL_EXSTYLE, new IntPtr((ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
    SetLong(me, GWLP_HWNDPARENT, new IntPtr(owner));
    return SetWindowPos(me, TOPMOST, x, y, w, h, 0x10 | 0x40);
  }

  public static bool Fade(long hwnd, int from, int to, int ms) {
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return false;
    int steps = Math.Max(1, ms / 16);
    for (int i = 0; i <= steps; i++) {
      double p = (double)i / steps;
      double e = 1 - Math.Pow(1 - p, 3);
      Alpha(me, (int)Math.Round(from + (to - from) * e));
      if (i < steps) System.Threading.Thread.Sleep(16);
    }
    return true;
  }

  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);

  /** Rounds the mirror's corners (the screen floats with no frame around it). */
  public static bool Round(long hwnd, int w, int h, int r) {
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return false;
    IntPtr rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
    return SetWindowRgn(me, rgn, true) != 0;
  }

  /** Puts the mirror back if Windows minimized it; says whether it's still there. */
  public static string Keep(long hwnd, long owner, int x, int y, int w, int h, int r) {
    IntPtr me = new IntPtr(hwnd);
    if (!IsWindow(me)) return "\"gone\"";
    if (!IsIconic(me)) return "\"ok\"";
    ShowWindow(me, 4);
    Own(hwnd, owner, x, y, w, h);
    Round(hwnd, w, h, r);
    return "\"restored\"";
  }

  public static bool Front(long hwnd) {
    IntPtr me = new IntPtr(hwnd);
    return IsWindow(me) && SetForegroundWindow(me);
  }
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
    } elseif ($parts[0] -eq 'req' -and $parts.Length -ge 3) {
      # req <id> <verb> <args...>: answered with {"re":<id>,"r":<result>}
      $r = 'null'
      try {
        switch ($parts[2]) {
          'desk' { $r = [FocusDesk]::Embed([long]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6], [int]$parts[7]) }
          'deskok' { $r = [FocusDesk]::Check([long]$parts[3]) }
          'wallget' { $r = [FocusDesk]::WallGet() }
          'phonefind' { $r = [FocusPhone]::Find([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[3]))).ToString() }
          'phoneown' { $r = [FocusPhone]::Own([long]$parts[3], [long]$parts[4], [int]$parts[5], [int]$parts[6], [int]$parts[7], [int]$parts[8]).ToString().ToLower() }
          'phonefade' { $r = [FocusPhone]::Fade([long]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6]).ToString().ToLower() }
          'phoneround' { $r = [FocusPhone]::Round([long]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6]).ToString().ToLower() }
          'phonekeep' { $r = [FocusPhone]::Keep([long]$parts[3], [long]$parts[4], [int]$parts[5], [int]$parts[6], [int]$parts[7], [int]$parts[8], [int]$parts[9]) }
          'phonefront' { $r = [FocusPhone]::Front([long]$parts[3]).ToString().ToLower() }
          'procpath' {
            $pp = ''
            try { $pp = (Get-Process -Name $parts[3] -ErrorAction Stop | Select-Object -First 1).Path } catch { }
            $r = '"' + (Esc $pp) + '"'
          }
          'wallset' {
            $p = ''
            if ($parts.Length -ge 4 -and $parts[3] -ne '-') { $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[3])) }
            $style = ''; $tile = ''
            if ($parts.Length -ge 5 -and $parts[4] -ne '-') { $style = $parts[4] }
            if ($parts.Length -ge 6 -and $parts[5] -ne '-') { $tile = $parts[5] }
            $r = [FocusDesk]::WallSet($p, $style, $tile)
          }
        }
      } catch { $r = '{"error":"' + (Esc $_.Exception.Message) + '"}' }
      Say ('{"re":' + [int]$parts[1] + ',"r":' + $r + '}')
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

/**
 * Writes the script to a .ps1 and returns the path. It's far too long for -EncodedCommand
 * (Windows caps a command line at 32,767 characters). UTF-8 with a BOM so Windows PowerShell reads it right.
 */
function scriptFile(dir) {
  const d = dir || os.tmpdir();
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'focus-watcher.ps1');
  const body = '\uFEFF' + SCRIPT;
  let same = false;
  try { same = fs.readFileSync(f, 'utf8') === body; } catch (e) { }
  if (!same) fs.writeFileSync(f, body, 'utf8');
  return f;
}

class Watcher extends EventEmitter {
  constructor(log, dir) {
    super();
    this.log = log || function () { };
    this.dir = dir || '';
    this.child = null;
    this.stopped = true;
    this.buf = '';
    this.restarts = 0;
    this.lastLine = 0;
    this.acks = {};
    this.waits = {};
    this.nextId = 1;
    this.isReady = false;
    this.readyWaits = [];
  }

  /** Resolves once the script is up (or after 20 s, so callers never hang). */
  ready() {
    if (this.isReady || process.platform !== 'win32') return Promise.resolve(this.isReady);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.readyWaits = this.readyWaits.filter((f) => f !== done); resolve(false); }, 20000);
      const done = () => { clearTimeout(t); resolve(true); };
      this.readyWaits.push(done);
    });
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
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptFile(this.dir)],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.log('watcher: spawn failed: ' + e.message);
      return this._again();
    }
    this.child = c;
    this.isReady = false;
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
      if (o.ready) { this.restarts = 0; this.isReady = true; const w = this.readyWaits; this.readyWaits = []; w.forEach((f) => f()); this.emit('ready'); }
      if (o.fg) this.emit('foreground', o.fg);
      if (o.procs) this.emit('procs', o.procs);
      if (o.re) { const w = this.waits[o.re]; if (w) { delete this.waits[o.re]; clearTimeout(w.timer); w.resolve(o.r); } }
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

  /** Asks the script to do something and waits for its answer (null if it doesn't come). */
  request(verb, args, timeoutMs) {
    const id = this.nextId++;
    if (this.nextId > 1e9) this.nextId = 1;
    const line = ['req', id, verb].concat((args || []).map(function (a) { return String(a === '' || a == null ? '-' : a).replace(/\s/g, ''); })).join(' ');
    return new Promise((resolve) => {
      if (!this._write(line)) return resolve(null);
      const timer = setTimeout(() => { delete this.waits[id]; resolve(null); }, timeoutMs || 10000);
      this.waits[id] = { resolve: resolve, timer: timer };
    });
  }
}

module.exports = { Watcher, SCRIPT, encodedCommand, scriptFile };
