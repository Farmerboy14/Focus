'use strict';
// What each preset allows on the PC: programs (by exe name) and websites. Mirrors Store.decide on the phone.
const S = require('./schedule');

const ALLOW = 0, REASON = 1, BLOCK = 2;

// Windows itself, and the few tools that must always open. Lowercase, no ".exe".
const SYSTEM = [
  'explorer', 'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'searchapp', 'searchui', 'lockapp',
  'taskmgr', 'systemsettings', 'applicationframehost', 'textinputhost', 'dwm', 'ctfmon', 'sihost', 'consent',
  'logonui', 'msiexec', 'focus', 'electron', 'phoneexperiencehost', 'calculatorapp', 'snippingtool', 'screensketch',
  'mmc', 'windowsterminal', 'openconsole', 'conhost', 'cmd', 'powershell', 'pwsh', 'claude', 'quick share',
  'quickshare', 'nearby_share', 'nearbyshare', 'shellhost', 'sechealthui', 'userOOBEbroker', 'lockscreen',
  'idle', 'system', '',
  // scrcpy and adb show the phone on the PC; Focus on the phone does that blocking itself.
  'scrcpy', 'adb'
].map(function (s) { return s.toLowerCase(); });

const DEFAULT_ENT_EXES = ['discord', 'steam', 'steamwebhelper', 'epicgameslauncher', 'robloxplayerbeta', 'roblox', 'ac2-win64-shipping'];
const DEFAULT_ENT_SITES = [
  'instagram.com', 'tiktok.com', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com', 'snapchat.com', 'pinterest.com',
  'netflix.com', 'hulu.com', 'disneyplus.com', 'twitch.tv', 'primevideo.com', 'max.com', 'peacocktv.com', 'tumblr.com',
  'threads.net', 'roblox.com', 'discord.com', 'linkedin.com', 'bereal.com'
];

function defaultPcPresets() {
  const out = {};
  S.PRESET_IDS.forEach(function (id) {
    out[id] = { def: (id === 'god' || id === 'strict') ? BLOCK : ALLOW, modes: {}, sites: [] };
  });
  return out;
}

function exeKey(name) {
  let s = String(name || '').trim().toLowerCase();
  const slash = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  if (slash >= 0) s = s.slice(slash + 1);
  if (s.endsWith('.exe')) s = s.slice(0, -4);
  return s;
}

/** "https://www.YouTube.com/watch" -> "youtube.com"; "m.reddit.com" stays as typed but lowercased. */
function hostKey(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[\/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  if (s.startsWith('*.')) s = s.slice(2);
  return /^[a-z0-9.-]+$/.test(s) && s.indexOf('.') > 0 ? s : '';
}

function hostMatches(host, rule) {
  host = String(host || '').toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host === rule || host.endsWith('.' + rule);
}

function isYouTube(host) { return hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be'); }

/**
 * model: { sched, pc: {presets, entExes, entSites, ytLimit}, passes: {exe: until}, pausedUntil }
 * Returns { mode, entertainment, essential, presetId, presetName }.
 */
function decideExe(model, exe, now) {
  const cur = S.current(model.sched, now);
  const pid = cur.preset;
  const d = { mode: ALLOW, entertainment: false, essential: false, presetId: pid, presetName: model.sched.names[pid] || pid, block: cur };
  const k = exeKey(exe);
  if (SYSTEM.indexOf(k) >= 0) { d.essential = true; return d; }
  if (model.pausedUntil && model.pausedUntil > now) return d;
  if (model.pc.entExes.indexOf(k) >= 0) {
    d.entertainment = true;
    d.mode = pid === 'free' ? ALLOW : BLOCK;
    return d;
  }
  const p = model.pc.presets[pid] || model.pc.presets.normal;
  const m = p.modes[k];
  d.mode = (m === ALLOW || m === REASON || m === BLOCK) ? m : p.def;
  if (d.mode === REASON) {
    const until = model.passes[k];
    if (until && until > now) d.mode = ALLOW;
  }
  return d;
}

/** What the browser extension needs right now. */
function sitePolicy(model, now) {
  const cur = S.current(model.sched, now);
  const pid = cur.preset;
  const paused = !!(model.pausedUntil && model.pausedUntil > now);
  const p = model.pc.presets[pid] || model.pc.presets.normal;
  const blocked = [];
  if (!paused) {
    if (pid !== 'free') model.pc.entSites.forEach(function (h) { blocked.push({ host: h, kind: 'entertainment' }); });
    p.sites.forEach(function (h) { if (!blocked.some(function (b) { return b.host === h; })) blocked.push({ host: h, kind: 'block' }); });
  }
  const limitSec = model.pc.ytLimit * 60;
  const usedSec = ytUsedSec(model, now);
  const counting = pid !== 'free';
  const next = S.upcoming(model.sched, now, 1)[0];
  return {
    v: 1,
    now: now,
    preset: pid,
    presetName: model.sched.names[pid] || pid,
    block: { title: cur.index < 0 ? 'Open time' : cur.title, end: cur.end, endLabel: S.clock(cur.end) },
    next: next ? { title: next.title, start: next.start, startLabel: S.clock(next.start) } : null,
    nextFree: S.nextFree(model.sched, now),
    nextFreeLabel: S.nextFree(model.sched, now) ? S.clock(S.nextFree(model.sched, now)) : '',
    paused: paused,
    blocked: blocked,
    yt: { counting: counting && !paused, limitMin: model.pc.ytLimit, usedSec: Math.round(usedSec), over: counting && !paused && usedSec >= limitSec }
  };
}

function ytUsedSec(model, now) {
  return model.yt && model.yt.day === S.dayKey(now) ? model.yt.usedSec : 0;
}

function addYouTube(model, seconds, now) {
  const k = S.dayKey(now);
  if (!model.yt || model.yt.day !== k) model.yt = { day: k, usedSec: 0 };
  model.yt.usedSec += Math.max(0, Math.min(120, Number(seconds) || 0)); // one report never counts more than 2 minutes
}

function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
function reasonOk(s) { return wordCount(s) >= 4; }

module.exports = {
  ALLOW, REASON, BLOCK, SYSTEM, DEFAULT_ENT_EXES, DEFAULT_ENT_SITES, defaultPcPresets, exeKey, hostKey, hostMatches,
  isYouTube, decideExe, sitePolicy, addYouTube, ytUsedSec, wordCount, reasonOk
};
