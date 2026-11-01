(function (root) {
'use strict';
// The day, ported from the phone's Store.java. Blocks run back to back from the day's anchor
// (the wake tap, or the usual wake time), counted on the wall clock so daylight saving
// doesn't shift the day. Uses the computer's local time zone, like Java's Calendar does.

const MIN = 60000;
const HOUR = 60 * MIN;
const PRESET_IDS = ['god', 'strict', 'work', 'normal', 'free'];
const DEFAULT_NAMES = { god: 'Time with God', strict: 'Strict', work: 'Work', normal: 'Normal', free: 'Free time' };

function defaultSched() {
  return {
    blocks: [
      { title: 'Time with God', preset: 'god', len: 30 },
      { title: 'Get ready', preset: 'strict', len: 30 },
      { title: 'Work', preset: 'work', len: 12 * 60 },
      { title: 'Dinner', preset: 'strict', len: 60 },
      { title: 'Free time', preset: 'free', len: 60 },
      { title: 'Wind down', preset: 'strict', len: 60 },
      { title: 'Sleep', preset: 'strict', len: 8 * 60 }
    ],
    defaultWake: 6 * 60,
    wakeAt: 0,
    prevWakeAt: 0,
    names: Object.assign({}, DEFAULT_NAMES),
    editedAt: 0
  };
}

/** Cleans up a schedule from disk or from the phone (same rules as Store.applyRemote). */
function normalize(sc, base) {
  const out = base ? JSON.parse(JSON.stringify(base)) : defaultSched();
  if (!sc || typeof sc !== 'object') return out;
  if (Array.isArray(sc.blocks) && sc.blocks.length > 0) {
    out.blocks = sc.blocks.map(function (b) {
      b = b || {};
      let pid = typeof b.preset === 'string' ? b.preset : 'normal';
      if (PRESET_IDS.indexOf(pid) < 0) pid = 'normal';
      const len = Math.max(5, Math.round(Number(b.len) || 60));
      const title = typeof b.title === 'string' && b.title.trim() ? b.title.slice(0, 60) : 'Block';
      return { title: title, preset: pid, len: len };
    });
  }
  if (Number.isFinite(sc.defaultWake)) out.defaultWake = Math.max(0, Math.min(1439, Math.round(sc.defaultWake)));
  if (Number.isFinite(sc.wakeAt)) out.wakeAt = sc.wakeAt;
  if (Number.isFinite(sc.prevWakeAt)) out.prevWakeAt = sc.prevWakeAt;
  if (sc.names && typeof sc.names === 'object') {
    PRESET_IDS.forEach(function (id) {
      const n = sc.names[id];
      if (typeof n === 'string' && n.trim()) out.names[id] = n.slice(0, 40);
    });
  }
  if (Number.isFinite(sc.editedAt)) out.editedAt = sc.editedAt;
  return out;
}

function totalMin(sc) {
  let t = 0;
  for (const b of sc.blocks) t += b.len;
  return t;
}

/** Today's usual wake time at or before now (Calendar.set + add(DAY, -1) in Java). */
function usualWakeAtOrBefore(sc, now) {
  const d = new Date(now);
  d.setHours(Math.floor(sc.defaultWake / 60), sc.defaultWake % 60, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** The next usual wake time strictly after now. */
function usualWakeAfter(sc, now) {
  const d = new Date(now);
  d.setHours(Math.floor(sc.defaultWake / 60), sc.defaultWake % 60, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Start of today's plan: when you said you woke, or your usual wake time. */
function anchor(sc, now) {
  const span = Math.max(12 * HOUR, totalMin(sc) * MIN);
  const w = sc.wakeAt || 0;
  if (w > 0 && now >= w && now < w + span) return w;
  const t = usualWakeAtOrBefore(sc, now);
  // An early wake tap keeps owning the day; its blocks have ended, so it's open time.
  if (w > 0 && w <= now && w > t - 6 * HOUR) return w;
  return t;
}

/** Clock time a number of minutes after the anchor, counted on the wall clock. */
function wall(anchorMs, offsetMin) {
  const d = new Date(anchorMs);
  const total = d.getHours() * 60 + d.getMinutes() + offsetMin;
  d.setDate(d.getDate() + Math.floor(total / 1440));
  const m = total % 1440;
  d.setHours(Math.floor(m / 60), m % 60);
  return d.getTime();
}

function slots(sc, now) {
  const out = [];
  const a = anchor(sc, now);
  let off = 0;
  sc.blocks.forEach(function (b, i) {
    const start = wall(a, off);
    off += b.len;
    out.push({ title: b.title, preset: b.preset, index: i, start: start, end: wall(a, off) });
  });
  return out;
}

function current(sc, now) {
  const all = slots(sc, now);
  for (const s of all) if (now >= s.start && now < s.end) return s;
  const a = anchor(sc, now);
  const dayEnd = all.length ? all[all.length - 1].end : a;
  let start = Math.max(dayEnd, a);
  if (start > now) start = now;
  return { title: 'Open time', preset: 'normal', index: -1, start: start, end: usualWakeAfter(sc, now) };
}

function upcoming(sc, now, max) {
  const out = [];
  for (const s of slots(sc, now)) {
    if (s.start > now) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Next time Free time starts today, or 0. */
function nextFree(sc, now) {
  for (const s of slots(sc, now)) if (s.preset === 'free' && s.end > now) return Math.max(s.start, now);
  return 0;
}

function minutesLeft(slot, now) { return Math.max(0, Math.floor((slot.end - now + MIN - 1) / MIN)); }
function lengthMin(slot) { return Math.max(1, Math.floor((slot.end - slot.start) / MIN)); }
function minutesToUsualWake(sc, now) { return Math.floor((usualWakeAfter(sc, now) - now) / MIN); }
function dayStartedByTap(sc, now) { return sc.wakeAt > 0 && anchor(sc, now) === sc.wakeAt; }

function wakeNow(sc, now) { sc.prevWakeAt = sc.wakeAt; sc.wakeAt = now; }
function undoWake(sc) { sc.wakeAt = sc.prevWakeAt; sc.prevWakeAt = 0; }

/** Same key the phone uses for "today" (year + day of year). */
function dayKey(now) {
  const d = new Date(now);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const doy = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - jan1) / 86400000) + 1;
  return d.getFullYear() + '-' + doy;
}

function hm(minutes) {
  if (!(minutes > 0)) minutes = 0;
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
}

function clock(ms) {
  const d = new Date(ms);
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
}

function hourOf(ms) { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; }

const api = {
  MIN, HOUR, PRESET_IDS, DEFAULT_NAMES, defaultSched, normalize, totalMin, anchor, wall, slots, current,
  upcoming, nextFree, minutesLeft, lengthMin, minutesToUsualWake, dayStartedByTap, wakeNow, undoWake,
  dayKey, hm, clock, hourOf, usualWakeAfter
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusSchedule = api;
})(this);
