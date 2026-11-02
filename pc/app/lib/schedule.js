(function (root) {
'use strict';
// The week (PROTOCOL.md, `sched` version 2): a list of clock-time blocks per weekday.
// A block whose end is not after its start runs past midnight and belongs to the day it starts.
// Gaps are open time. Everything is local wall-clock time, laid out with the Date constructor,
// so daylight saving never moves a block (22:30 stays 22:30, 06:30 stays 06:30).

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const PRESET_IDS = ['god', 'strict', 'work', 'normal', 'free'];
const DEFAULT_NAMES = { god: 'Time with God', strict: 'Strict', work: 'Work', normal: 'Normal', free: 'Free time' };
const MAX_TITLE = 60, MAX_NOTE = 500, MAX_BLOCKS = 60;

// The starting week (shared/week.json, shipped as res/week.json). Only the app's main process needs it;
// the windows get the schedule from the app.
let DEFAULT_WEEK = null;
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  try { DEFAULT_WEEK = require('../res/week.json'); } catch (e) { DEFAULT_WEEK = null; }
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** "07:05" or "7:05" -> minutes after midnight, or -1. */
function parseHm(s) {
  const r = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s == null ? '' : s));
  if (!r) return -1;
  const h = +r[1], m = +r[2];
  if (h > 23 || m > 59) return -1;
  return h * 60 + m;
}

/** minutes after midnight -> "07:05" */
function fmtHm(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function cleanBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const s = parseHm(b.start), e = parseHm(b.end);
  if (s < 0 || e < 0) return null;
  let pid = typeof b.preset === 'string' ? b.preset : 'normal';
  if (PRESET_IDS.indexOf(pid) < 0) pid = 'normal';
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, MAX_TITLE) : 'Block';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, MAX_NOTE) : '';
  return { start: fmtHm(s), end: fmtHm(e), title: title, preset: pid, note: note };
}

/** A day's list, cleaned and in start order (stable for equal starts). */
function cleanDay(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (b, i) { const c = cleanBlock(b); if (c) out.push({ b: c, i: i }); });
  out.sort(function (x, y) { return (parseHm(x.b.start) - parseHm(y.b.start)) || (x.i - y.i); });
  return out.slice(0, MAX_BLOCKS).map(function (x) { return x.b; });
}

function emptyDays() { const d = {}; DAY_KEYS.forEach(function (k) { d[k] = []; }); return d; }

function defaultSched() {
  const days = emptyDays();
  if (DEFAULT_WEEK) DAY_KEYS.forEach(function (k) { days[k] = cleanDay(DEFAULT_WEEK[k]); });
  return { v: 2, days: days, names: Object.assign({}, DEFAULT_NAMES), editedAt: 0 };
}

/** True for a version 2 schedule (a week). Older phones and PCs send the one-day format. */
function isV2(sc) { return !!(sc && typeof sc === 'object' && sc.v === 2 && sc.days && typeof sc.days === 'object'); }

/** Cleans a week from disk or from the phone. Anything that isn't version 2 leaves `base` as it was. */
function normalize(sc, base) {
  const out = isV2(base) ? clone(base) : defaultSched();
  out.v = 2;
  if (!isV2(sc)) return out;
  DAY_KEYS.forEach(function (k) { if (Array.isArray(sc.days[k])) out.days[k] = cleanDay(sc.days[k]); });
  if (sc.names && typeof sc.names === 'object') {
    PRESET_IDS.forEach(function (id) {
      const n = sc.names[id];
      if (typeof n === 'string' && n.trim()) out.names[id] = n.trim().slice(0, 40);
    });
  }
  if (Number.isFinite(sc.editedAt)) out.editedAt = sc.editedAt;
  return out;
}

/** What goes over the wire in `state`: exactly {v, days, names, editedAt}. */
function wire(sc) { return { v: 2, days: sc.days, names: sc.names, editedAt: sc.editedAt || 0 }; }

/** Local midnight of the day `offset` days after the one holding `ms`. */
function midnight(ms, offset) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (offset || 0), 0, 0, 0, 0).getTime();
}

function dayOf(ms) { return DAY_KEYS[new Date(ms).getDay()]; }

/** Wall-clock time `min` minutes after midnight on the date of `dayMs` (plus `plusDays`). */
function at(dayMs, min, plusDays) {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (plusDays || 0), Math.floor(min / 60), min % 60, 0, 0).getTime();
}

/** The blocks of the date holding `ms`, as real times. A block past midnight ends on the next date. */
function slots(sc, ms) {
  const day = midnight(ms, 0);
  const key = dayOf(day);
  const list = (sc.days && sc.days[key]) || [];
  return list.map(function (b, i) {
    const s = parseHm(b.start), e = parseHm(b.end);
    return { day: key, index: i, title: b.title, preset: b.preset, note: b.note || '', start: at(day, s, 0), end: at(day, e, e > s ? 0 : 1) };
  });
}

/** Slots of the dates from `from` to `to` days after the date of `now`. */
function range(sc, now, from, to) {
  let out = [];
  for (let k = from; k <= to; k++) out = out.concat(slots(sc, midnight(now, k)));
  return out;
}

function openTime(sc, now) {
  let start = -Infinity, end = Infinity;
  range(sc, now, -7, 0).forEach(function (s) { if (s.end <= now && s.end > start) start = s.end; });
  range(sc, now, 0, 7).forEach(function (s) { if (s.start > now && s.start < end) end = s.start; });
  if (start === -Infinity) start = midnight(now, 0);
  if (end === Infinity) end = midnight(now, 1);
  return { day: dayOf(now), index: -1, title: 'Open time', preset: 'normal', note: '', start: start, end: end };
}

/**
 * What's on now: yesterday's, today's and tomorrow's blocks; the one with start <= now < end,
 * the later start winning when two match. Its `end` is cut short where a later block takes over.
 * None: open time (`normal`) from the last block's end until the next block starts.
 */
function current(sc, now) {
  const all = range(sc, now, -1, 1);
  let cur = null;
  all.forEach(function (s) { if (s.start <= now && now < s.end && (!cur || s.start >= cur.start)) cur = s; });
  if (!cur) return openTime(sc, now);
  const out = Object.assign({}, cur);
  all.forEach(function (s) { if (s.start > now && s.start < out.end) out.end = s.start; });
  return out;
}

/** The next `max` blocks that start after now, across midnight and into the next days. */
function upcoming(sc, now, max) {
  return range(sc, now, 0, 7).filter(function (s) { return s.start > now; })
    .sort(function (a, b) { return a.start - b.start; }).slice(0, max);
}

/** When Free time is next on today (now if it's on now), or 0. */
function nextFree(sc, now) {
  if (current(sc, now).preset === 'free') return now;
  const end = midnight(now, 1);
  const n = upcoming(sc, now, 200).filter(function (s) { return s.preset === 'free' && s.start < end; })[0];
  return n ? n.start : 0;
}

/** A copy of `key`'s blocks on Monday through Friday. */
function copyToWeekdays(sc, key) {
  const out = clone(sc);
  WEEKDAYS.forEach(function (k) { if (k !== key) out.days[k] = clone(sc.days[key] || []); });
  return out;
}

function minutesLeft(slot, now) { return Math.max(0, Math.floor((slot.end - now + MIN - 1) / MIN)); }
function lengthMin(slot) { return Math.max(1, Math.floor((slot.end - slot.start) / MIN)); }

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
  return clockMin(d.getHours() * 60 + d.getMinutes());
}

/** minutes after midnight (or "HH:MM") -> "7:05 AM" */
function clockMin(min) {
  if (typeof min === 'string') min = parseHm(min);
  min = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(min / 60);
  let h = h24 % 12;
  if (h === 0) h = 12;
  return h + ':' + String(min % 60).padStart(2, '0') + ' ' + (h24 < 12 ? 'AM' : 'PM');
}

function hourOf(ms) { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; }

const api = {
  MIN, HOUR, DAY_KEYS, DAY_NAMES, WEEKDAYS, PRESET_IDS, DEFAULT_NAMES, MAX_TITLE, MAX_NOTE,
  parseHm, fmtHm, cleanBlock, cleanDay, defaultSched, isV2, normalize, wire, midnight, dayOf, slots,
  current, upcoming, nextFree, copyToWeekdays, minutesLeft, lengthMin, dayKey, hm, clock, clockMin, hourOf
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusSchedule = api;
})(this);
