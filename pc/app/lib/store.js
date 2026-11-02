'use strict';
// Everything Focus for Windows remembers, as JSON in %APPDATA%/Focus.
const fs = require('fs');
const path = require('path');
const S = require('./schedule');
const P = require('./policy');

function defaults() {
  return {
    sched: S.defaultSched(),
    pc: { presets: P.defaultPcPresets(), entExes: P.DEFAULT_ENT_EXES.slice(), entSites: P.DEFAULT_ENT_SITES.slice(), ytLimit: 15 },
    passes: {},
    pausedUntil: 0,
    yt: { day: '', usedSec: 0 },
    seen: {},
    steps: {},
    settings: { startWithWindows: true, showWidget: true, widget: null, desktop: true, deskSide: 'right', deskStyle: 'live', deskSecond: 'day', origWall: null },
    pair: { code: '', lastId: '' }
  };
}

function cleanList(arr, fn) {
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach(function (x) { const k = fn(x); if (k && out.indexOf(k) < 0) out.push(k); });
  return out;
}

/** Repairs anything odd from disk so the rest of the app can trust the shape. */
function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  if (S.isV2(raw.sched)) d.sched = S.normalize(raw.sched, d.sched);
  else if (raw.sched && typeof raw.sched === 'object') {
    // The old one-day schedule (blocks from a wake-up tap): replaced by the default week, edited now.
    d.sched.editedAt = Date.now();
    d.migrated = true;
    if (raw.sched.names && typeof raw.sched.names === 'object') {
      S.PRESET_IDS.forEach(function (id) { const n = raw.sched.names[id]; if (typeof n === 'string' && n.trim()) d.sched.names[id] = n.trim().slice(0, 40); });
    }
  }
  const pc = raw.pc || {};
  S.PRESET_IDS.forEach(function (id) {
    const src = pc.presets && pc.presets[id];
    if (!src) return;
    const dst = d.pc.presets[id];
    if (src.def === P.ALLOW || src.def === P.BLOCK) dst.def = src.def;
    if (src.modes && typeof src.modes === 'object') {
      Object.keys(src.modes).forEach(function (k) {
        const m = src.modes[k], key = P.exeKey(k);
        if (key && (m === P.ALLOW || m === P.REASON || m === P.BLOCK)) dst.modes[key] = m;
      });
    }
    dst.sites = cleanList(src.sites, P.hostKey);
  });
  if (Array.isArray(pc.entExes)) d.pc.entExes = cleanList(pc.entExes, P.exeKey);
  if (Array.isArray(pc.entSites)) d.pc.entSites = cleanList(pc.entSites, P.hostKey);
  if (Number.isFinite(pc.ytLimit)) d.pc.ytLimit = Math.max(0, Math.min(600, Math.round(pc.ytLimit)));
  if (raw.passes && typeof raw.passes === 'object') {
    const now = Date.now();
    Object.keys(raw.passes).forEach(function (k) { if (raw.passes[k] > now) d.passes[k] = raw.passes[k]; });
  }
  if (Number.isFinite(raw.pausedUntil)) d.pausedUntil = raw.pausedUntil;
  if (raw.yt && typeof raw.yt.day === 'string' && Number.isFinite(raw.yt.usedSec)) d.yt = { day: raw.yt.day, usedSec: raw.yt.usedSec };
  if (raw.seen && typeof raw.seen === 'object') d.seen = raw.seen;
  if (raw.steps && typeof raw.steps === 'object') d.steps = raw.steps;
  if (raw.settings && typeof raw.settings === 'object') {
    if (typeof raw.settings.startWithWindows === 'boolean') d.settings.startWithWindows = raw.settings.startWithWindows;
    if (typeof raw.settings.showWidget === 'boolean') d.settings.showWidget = raw.settings.showWidget;
    const w = raw.settings.widget;
    if (w && Number.isFinite(w.x) && Number.isFinite(w.y)) d.settings.widget = { x: w.x, y: w.y };
    if (typeof raw.settings.desktop === 'boolean') d.settings.desktop = raw.settings.desktop;
    if (raw.settings.deskSide === 'left' || raw.settings.deskSide === 'right') d.settings.deskSide = raw.settings.deskSide;
    if (raw.settings.deskStyle === 'live' || raw.settings.deskStyle === 'picture') d.settings.deskStyle = raw.settings.deskStyle;
    if (raw.settings.deskSecond === 'day' || raw.settings.deskSecond === 'same') d.settings.deskSecond = raw.settings.deskSecond;
    if (typeof raw.settings.scrcpyPath === 'string') d.settings.scrcpyPath = raw.settings.scrcpyPath.slice(0, 1000);
    if (Number.isFinite(raw.settings.phoneAspect) && raw.settings.phoneAspect > 0.2 && raw.settings.phoneAspect < 1) d.settings.phoneAspect = raw.settings.phoneAspect;
    const ow = raw.settings.origWall;
    if (ow && typeof ow === 'object') {
      d.settings.origWall = { file: String(ow.file || ''), path: String(ow.path || ''), style: String(ow.style || ''), tile: String(ow.tile || '') };
    }
  }
  if (raw.updAttempt && Number.isFinite(raw.updAttempt.v) && Number.isFinite(raw.updAttempt.n)) d.updAttempt = { v: raw.updAttempt.v, n: raw.updAttempt.n };
  if (raw.pair && typeof raw.pair === 'object') {
    d.pair.code = typeof raw.pair.code === 'string' ? raw.pair.code : '';
    d.pair.lastId = typeof raw.pair.lastId === 'string' ? raw.pair.lastId : '';
  }
  return d;
}

class Store {
  constructor(dir, log) {
    this.dir = dir;
    this.file = path.join(dir, 'focus.json');
    this.log = log || function () { };
    this.timer = null;
    this.data = this._load();
  }

  _load() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        if (fs.existsSync(f)) {
          const d = sanitize(JSON.parse(fs.readFileSync(f, 'utf8')));
          if (d.migrated) { delete d.migrated; this.log('store: moved the old one-day schedule to the default week'); this.save(); }
          return d;
        }
      } catch (e) { this.log('store: could not read ' + f + ': ' + e.message); }
    }
    return defaults();
  }

  /** Saves soon (coalesces bursts of changes). */
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak'); } catch (e) { }
      fs.renameSync(tmp, this.file);
    } catch (e) { this.log('store: save failed: ' + e.message); }
  }

  logReason(entry) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, 'reasons.jsonl'), JSON.stringify(entry) + '\n');
    } catch (e) { this.log('store: reason log failed: ' + e.message); }
  }

  recentReasons(max) {
    try {
      const lines = fs.readFileSync(path.join(this.dir, 'reasons.jsonl'), 'utf8').trim().split('\n');
      return lines.slice(-max).reverse().map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }
}

module.exports = { Store, defaults, sanitize };
