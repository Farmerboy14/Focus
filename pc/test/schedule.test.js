'use strict';
// The week (PROTOCOL.md, sched version 2), against the shared rules. Run with TZ=America/Chicago (run-all.js sets it).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, run } = require('./harness');
const S = require('../app/lib/schedule');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();
const iso = (t) => new Date(t).toISOString();
const week = () => S.defaultSched();
// 2026-11-02 is a Monday; 2026-11-01 a Sunday (and the day daylight saving ends in Chicago).

test('runs in America/Chicago', () => {
  assert.strictEqual(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/Chicago');
});

test('the shipped week is shared/week.json', () => {
  const shipped = fs.readFileSync(path.join(__dirname, '..', 'app', 'res', 'week.json'), 'utf8');
  const shared = path.join(__dirname, '..', '..', 'shared', 'week.json');
  if (fs.existsSync(shared)) assert.strictEqual(shipped, fs.readFileSync(shared, 'utf8'), 'pc/app/res/week.json is out of date');
  const sc = week();
  assert.strictEqual(sc.v, 2);
  assert.deepStrictEqual(Object.keys(sc.days), S.DAY_KEYS);
  S.DAY_KEYS.forEach((k) => assert.ok(sc.days[k].length > 10, k + ' has blocks'));
  assert.deepStrictEqual(S.normalize(sc, sc), sc, 'the default week is already clean');
});

test('a weekday at 10:00 is Ledger: deep work', () => {
  for (let d = 2; d <= 6; d++) {
    const now = at(2026, 11, d, 10, 0);
    const cur = S.current(week(), now);
    assert.strictEqual(cur.title, 'Ledger: deep work', 'Nov ' + d);
    assert.strictEqual(cur.preset, 'work');
    assert.ok(cur.note.length > 0);
    assert.strictEqual(cur.start, at(2026, 11, d, 8, 30));
    assert.strictEqual(cur.end, at(2026, 11, d, 11, 0));
    assert.strictEqual(S.minutesLeft(cur, now), 60);
    assert.strictEqual(S.lengthMin(cur), 150);
    assert.strictEqual(S.minutesLeft(cur, now + 1000), 60, 'rounds up like the phone');
  }
});

test('Sunday 02:00 is still Saturday\'s Sleep, which ends at 07:00', () => {
  const cur = S.current(week(), at(2026, 11, 8, 2, 0));
  assert.strictEqual(cur.title, 'Sleep');
  assert.strictEqual(cur.day, 'sat');
  assert.strictEqual(cur.start, at(2026, 11, 7, 22, 30));
  assert.strictEqual(cur.end, at(2026, 11, 8, 7, 0));
});

test('Sunday 06:45 is Sleep (Saturday night runs to 07:00)', () => {
  const cur = S.current(week(), at(2026, 11, 8, 6, 45));
  assert.strictEqual(cur.title, 'Sleep');
  assert.strictEqual(cur.day, 'sat');
  assert.strictEqual(S.minutesLeft(cur, at(2026, 11, 8, 6, 45)), 15);
  assert.strictEqual(S.current(week(), at(2026, 11, 8, 7, 0)).title, 'Wake up and get light');
});

test('Monday 23:30 is Monday\'s Sleep', () => {
  const cur = S.current(week(), at(2026, 11, 2, 23, 30));
  assert.strictEqual(cur.title, 'Sleep');
  assert.strictEqual(cur.day, 'mon');
  assert.strictEqual(cur.start, at(2026, 11, 2, 22, 30));
  assert.strictEqual(cur.end, at(2026, 11, 3, 6, 30));
});

test('Monday 01:00 is Sunday\'s Sleep', () => {
  const cur = S.current(week(), at(2026, 11, 2, 1, 0));
  assert.strictEqual(cur.title, 'Sleep');
  assert.strictEqual(cur.day, 'sun');
  assert.strictEqual(cur.start, at(2026, 11, 1, 22, 30));
  assert.strictEqual(cur.end, at(2026, 11, 2, 6, 30));
});

test('daylight saving ends 2026-11-01: 01:30 is Sleep, and wall-clock times hold', () => {
  const now = at(2026, 11, 1, 1, 30); // the first 1:30 (CDT)
  const sleep = S.current(week(), now);
  assert.strictEqual(sleep.title, 'Sleep');
  assert.strictEqual(sleep.day, 'sat');
  assert.strictEqual(iso(sleep.start), '2026-11-01T03:30:00.000Z'); // Sat 22:30 CDT
  assert.strictEqual(iso(sleep.end), '2026-11-01T13:00:00.000Z');   // Sun 07:00 CST, not 06:00
  assert.strictEqual(S.lengthMin(sleep), 570, 'the night really is 9 h 30 min long');
  // 6:30 is still 6:30 on the clock (CST), and still inside Saturday's Sleep.
  const six30 = at(2026, 11, 1, 6, 30);
  assert.strictEqual(iso(six30), '2026-11-01T12:30:00.000Z');
  assert.strictEqual(new Date(six30).getHours(), 6);
  assert.strictEqual(new Date(six30).getMinutes(), 30);
  assert.strictEqual(S.current(week(), six30).title, 'Sleep');
  assert.strictEqual(S.minutesLeft(S.current(week(), six30), six30), 30);
  // Sunday's own blocks sit at their clock times, and Sunday night's Sleep ends 06:30 Monday.
  const sun = S.slots(week(), now);
  assert.strictEqual(sun[0].title, 'Wake up and get light');
  assert.strictEqual(iso(sun[0].start), '2026-11-01T13:00:00.000Z');
  const night = sun[sun.length - 1];
  assert.strictEqual(night.title, 'Sleep');
  assert.strictEqual(new Date(night.start).getHours(), 22);
  assert.strictEqual(new Date(night.end).getHours(), 6);
  assert.strictEqual(new Date(night.end).getMinutes(), 30);
  assert.strictEqual(S.lengthMin(night), 480);
});

test('daylight saving starts 2027-03-14: the short night', () => {
  const sleep = S.current(week(), at(2027, 3, 14, 4, 0)); // a Sunday
  assert.strictEqual(sleep.title, 'Sleep');
  assert.strictEqual(new Date(sleep.end).getHours(), 7);
  assert.strictEqual(S.lengthMin(sleep), 450);
});

function sparse() {
  const sc = S.normalize({ v: 2, days: { mon: [
    { start: '09:00', end: '12:00', title: 'Work', preset: 'work', note: 'Ship it.' },
    { start: '14:00', end: '15:00', title: 'Walk', preset: 'free', note: '' }
  ] } }, { v: 2, days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }, names: S.DEFAULT_NAMES, editedAt: 0 });
  sc.days.tue = [{ start: '23:00', end: '01:00', title: 'Late', preset: 'strict', note: '' }];
  return sc;
}

test('a gap is open time until the next block', () => {
  const sc = sparse();
  const open = S.current(sc, at(2026, 11, 2, 13, 0));
  assert.strictEqual(open.index, -1);
  assert.strictEqual(open.title, 'Open time');
  assert.strictEqual(open.preset, 'normal');
  assert.strictEqual(open.note, '');
  assert.strictEqual(open.start, at(2026, 11, 2, 12, 0));
  assert.strictEqual(open.end, at(2026, 11, 2, 14, 0));
  assert.strictEqual(S.nextFree(sc, at(2026, 11, 2, 13, 0)), at(2026, 11, 2, 14, 0));
  // Before anything this week has started: open from midnight; after the last: until next Monday.
  const first = S.current(sc, at(2026, 11, 2, 5, 0));
  assert.strictEqual(first.index, -1);
  assert.strictEqual(first.end, at(2026, 11, 2, 9, 0));
  const after = S.current(sc, at(2026, 11, 4, 3, 0));
  assert.strictEqual(after.start, at(2026, 11, 4, 1, 0));
  assert.strictEqual(after.end, at(2026, 11, 9, 9, 0));
  assert.strictEqual(S.nextFree(sc, at(2026, 11, 2, 16, 0)), 0, 'no Free time left today');
  assert.strictEqual(S.nextFree(sc, at(2026, 11, 2, 14, 30)), at(2026, 11, 2, 14, 30), 'Free time now');
  // An empty week is open time all day.
  const none = S.normalize({ v: 2, days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } }, sc);
  const o = S.current(none, at(2026, 11, 2, 10, 0));
  assert.strictEqual(o.index, -1);
  assert.strictEqual(o.start, at(2026, 11, 2, 0, 0));
  assert.strictEqual(o.end, at(2026, 11, 3, 0, 0));
  assert.deepStrictEqual(S.upcoming(none, at(2026, 11, 2, 10, 0), 3), []);
});

test('overlaps: the later start wins, and ends the earlier block early', () => {
  const sc = sparse();
  sc.days.mon.push({ start: '10:00', end: '10:30', title: 'Call', preset: 'strict', note: '' });
  const before = S.current(sc, at(2026, 11, 2, 9, 30));
  assert.strictEqual(before.title, 'Work');
  assert.strictEqual(before.end, at(2026, 11, 2, 10, 0));
  assert.strictEqual(S.current(sc, at(2026, 11, 2, 10, 10)).title, 'Call');
  const back = S.current(sc, at(2026, 11, 2, 10, 45));
  assert.strictEqual(back.title, 'Work');
  assert.strictEqual(back.end, at(2026, 11, 2, 12, 0));
  // A block inside the night's Sleep wins while it runs, and Sleep's countdown stops where it starts.
  const w = week();
  w.days.tue.push({ start: '04:00', end: '05:00', title: 'Early bake', preset: 'work', note: '' });
  assert.strictEqual(S.current(w, at(2026, 11, 3, 4, 30)).title, 'Early bake');
  assert.strictEqual(S.current(w, at(2026, 11, 3, 3, 30)).end, at(2026, 11, 3, 4, 0));
});

test('upcoming crosses midnight', () => {
  const now = at(2026, 11, 2, 22, 0); // Monday, Evening devotion
  assert.strictEqual(S.current(week(), now).title, 'Evening devotion');
  const up = S.upcoming(week(), now, 3);
  assert.deepStrictEqual(up.map((s) => s.title), ['Shower and bed', 'Sleep', 'Wake up and get light']);
  assert.deepStrictEqual(up.map((s) => s.start), [at(2026, 11, 2, 22, 10), at(2026, 11, 2, 22, 30), at(2026, 11, 3, 6, 30)]);
  assert.deepStrictEqual(up.map((s) => s.day), ['mon', 'mon', 'tue']);
  const late = S.upcoming(week(), at(2026, 11, 2, 23, 30), 3);
  assert.deepStrictEqual(late.map((s) => s.title), ['Wake up and get light', 'Morning devotion', 'Breakfast and get ready']);
  // Saturday night into Sunday's different morning.
  const sat = S.upcoming(week(), at(2026, 11, 7, 23, 0), 2);
  assert.deepStrictEqual(sat.map((s) => [s.title, new Date(s.start).getHours(), s.day]), [['Wake up and get light', 7, 'sun'], ['Morning devotion', 7, 'sun']]);
  // Through a gap at the end of the week.
  const sc = sparse();
  assert.deepStrictEqual(S.upcoming(sc, at(2026, 11, 3, 20, 0), 2).map((s) => s.start), [at(2026, 11, 3, 23, 0), at(2026, 11, 9, 9, 0)]);
});

test('nextFree on the default week', () => {
  assert.strictEqual(S.nextFree(week(), at(2026, 11, 2, 10, 0)), at(2026, 11, 2, 20, 40));
  assert.strictEqual(S.nextFree(week(), at(2026, 11, 2, 20, 50)), at(2026, 11, 2, 20, 50));
  assert.strictEqual(S.nextFree(week(), at(2026, 11, 2, 21, 30)), 0);
  assert.strictEqual(S.nextFree(week(), at(2026, 11, 1, 10, 0)), at(2026, 11, 1, 15, 15));
});

test('slots for a date', () => {
  const mon = S.slots(week(), at(2026, 11, 2, 12, 0));
  assert.strictEqual(mon.length, week().days.mon.length);
  assert.ok(mon.every((s, i) => s.day === 'mon' && s.index === i));
  assert.strictEqual(mon[0].start, at(2026, 11, 2, 6, 30));
  assert.strictEqual(mon[mon.length - 1].end, at(2026, 11, 3, 6, 30));
});

test('normalize: only version 2, cleaned', () => {
  const base = week();
  assert.deepStrictEqual(S.normalize({ blocks: [{ title: 'x', preset: 'work', len: 60 }], defaultWake: 360, wakeAt: 5, editedAt: 9e12 }, base), base, 'the old one-day format is ignored');
  assert.deepStrictEqual(S.normalize({ v: 1, days: {} }, base), base);
  const sc = S.normalize({ v: 2, days: { mon: [
    { start: '9:05', end: '10:00', title: '', preset: 'nap', note: 7 },
    { start: '08:00', end: '25:00', title: 'Bad end' },
    { start: '07:00', end: '07:30', title: '  Early  ', preset: 'god', note: '  Pray.  ', extra: 1 }
  ], tue: 'nope' }, names: { god: 'With God', bogus: 'x' }, editedAt: 5, wakeAt: 3 }, base);
  assert.deepStrictEqual(sc.days.mon, [
    { start: '07:00', end: '07:30', title: 'Early', preset: 'god', note: 'Pray.' },
    { start: '09:05', end: '10:00', title: 'Block', preset: 'normal', note: '' }
  ]);
  assert.deepStrictEqual(sc.days.tue, base.days.tue, 'a bad day keeps what was there');
  assert.strictEqual(sc.names.god, 'With God');
  assert.strictEqual(sc.names.free, 'Free time');
  assert.ok(!('bogus' in sc.names));
  assert.strictEqual(sc.editedAt, 5);
  assert.deepStrictEqual(Object.keys(sc).sort(), ['days', 'editedAt', 'names', 'v']);
  assert.deepStrictEqual(Object.keys(S.wire(sc)), ['v', 'days', 'names', 'editedAt']);
});

test('copy a day to Monday through Friday', () => {
  const sc = S.copyToWeekdays(sparse(), 'mon');
  ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((k) => assert.deepStrictEqual(sc.days[k], sparse().days.mon));
  assert.deepStrictEqual(sc.days.sat, []);
  sc.days.tue[0].title = 'changed';
  assert.strictEqual(sc.days.wed[0].title, 'Work', 'copies, not shared');
});

test('day key and formatting match the phone', () => {
  assert.strictEqual(S.dayKey(at(2026, 11, 1, 12, 0)), '2026-305');
  assert.strictEqual(S.dayKey(at(2028, 12, 31, 23, 0)), '2028-366');
  assert.strictEqual(S.hm(90), '1:30');
  assert.strictEqual(S.hm(5), '0:05');
  assert.strictEqual(S.clock(at(2026, 11, 1, 0, 5)), '12:05 AM');
  assert.strictEqual(S.clock(at(2026, 11, 1, 13, 0)), '1:00 PM');
  assert.strictEqual(S.clockMin('22:30'), '10:30 PM');
  assert.strictEqual(S.parseHm('24:00'), -1);
  assert.strictEqual(S.parseHm('7:5'), -1);
  assert.strictEqual(S.fmtHm(425), '07:05');
  assert.strictEqual(S.parseHm('7:05'), 425);
  assert.strictEqual(S.dayOf(at(2026, 11, 2, 0, 0)), 'mon');
});

run('schedule');
