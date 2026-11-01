'use strict';
// The day, against the phone's rules. Run with TZ=America/Chicago (run-all.js sets it).
const assert = require('assert');
const { test, run } = require('./harness');
const S = require('../app/lib/schedule');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();
const iso = (t) => new Date(t).toISOString();

test('runs in America/Chicago', () => {
  assert.strictEqual(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/Chicago');
});

test('normal day: anchored at the usual wake time', () => {
  const sc = S.defaultSched();
  const now = at(2026, 10, 28, 10, 0);
  assert.strictEqual(S.anchor(sc, now), at(2026, 10, 28, 6, 0));
  const cur = S.current(sc, now);
  assert.strictEqual(cur.title, 'Work');
  assert.strictEqual(cur.start, at(2026, 10, 28, 7, 0));
  assert.strictEqual(cur.end, at(2026, 10, 28, 19, 0));
  assert.strictEqual(S.minutesLeft(cur, now), 540);
  assert.deepStrictEqual(S.upcoming(sc, now, 3).map((s) => s.title), ['Dinner', 'Free time', 'Wind down']);
  assert.strictEqual(S.nextFree(sc, now), at(2026, 10, 28, 20, 0));
  const god = S.current(sc, at(2026, 10, 28, 6, 10));
  assert.strictEqual(god.preset, 'god');
  assert.strictEqual(S.minutesLeft(god, at(2026, 10, 28, 6, 10)), 20);
  assert.strictEqual(S.lengthMin(god), 30);
  assert.strictEqual(S.minutesLeft(god, at(2026, 10, 28, 6, 10) + 1000), 20, 'rounds up like the phone');
});

test('before the usual wake time, the day still belongs to yesterday (sleep)', () => {
  const sc = S.defaultSched();
  const now = at(2026, 10, 28, 4, 0);
  assert.strictEqual(S.anchor(sc, now), at(2026, 10, 27, 6, 0));
  assert.strictEqual(S.current(sc, now).title, 'Sleep');
  assert.strictEqual(S.current(sc, now).end, at(2026, 10, 28, 6, 0));
});

test('waking early: the tap moves the whole day', () => {
  const sc = S.defaultSched();
  const tap = at(2026, 10, 28, 4, 30);
  S.wakeNow(sc, tap);
  assert.strictEqual(sc.prevWakeAt, 0);
  assert.strictEqual(S.anchor(sc, at(2026, 10, 28, 4, 45)), tap);
  assert.ok(S.dayStartedByTap(sc, at(2026, 10, 28, 4, 45)));
  assert.strictEqual(S.current(sc, at(2026, 10, 28, 4, 45)).preset, 'god');
  const work = S.current(sc, at(2026, 10, 28, 12, 0));
  assert.strictEqual(work.title, 'Work');
  assert.strictEqual(work.start, at(2026, 10, 28, 5, 30));
  assert.strictEqual(work.end, at(2026, 10, 28, 17, 30));
  assert.strictEqual(S.current(sc, at(2026, 10, 28, 22, 0)).title, 'Sleep');
  // After the tapped day has run its length, the early tap still owns it: open time until the usual wake.
  const open = S.current(sc, at(2026, 10, 29, 5, 0));
  assert.strictEqual(open.index, -1);
  assert.strictEqual(open.preset, 'normal');
  assert.strictEqual(open.start, at(2026, 10, 29, 4, 30));
  assert.strictEqual(open.end, at(2026, 10, 29, 6, 0));
  // And at the usual wake time the normal day takes over.
  assert.strictEqual(S.current(sc, at(2026, 10, 29, 6, 5)).preset, 'god');
  assert.strictEqual(S.anchor(sc, at(2026, 10, 29, 6, 5)), at(2026, 10, 29, 6, 0));
});

test('undo a mistaken wake tap', () => {
  const sc = S.defaultSched();
  S.wakeNow(sc, at(2026, 10, 27, 6, 2));
  S.wakeNow(sc, at(2026, 10, 28, 9, 0));
  assert.strictEqual(S.current(sc, at(2026, 10, 28, 9, 5)).preset, 'god');
  S.undoWake(sc);
  assert.strictEqual(sc.wakeAt, at(2026, 10, 27, 6, 2));
  assert.strictEqual(sc.prevWakeAt, 0);
  assert.strictEqual(S.current(sc, at(2026, 10, 28, 9, 5)).title, 'Work');
});

test('daylight saving ends 2026-11-01: wall-clock times hold', () => {
  const sc = S.defaultSched();
  const now = at(2026, 11, 1, 5, 30); // CST, after the 2 AM fall-back
  assert.strictEqual(S.anchor(sc, now), at(2026, 10, 31, 6, 0));
  assert.strictEqual(iso(S.anchor(sc, now)), '2026-10-31T11:00:00.000Z'); // 6:00 CDT
  const sleep = S.current(sc, now);
  assert.strictEqual(sleep.title, 'Sleep');
  assert.strictEqual(sleep.start, at(2026, 10, 31, 22, 0));
  assert.strictEqual(iso(sleep.end), '2026-11-01T12:00:00.000Z'); // 6:00 CST, not 5:00
  assert.strictEqual(S.lengthMin(sleep), 540, 'the night really is 9 hours long');
  assert.strictEqual(S.minutesLeft(sleep, now), 30);
  const work = S.current(sc, at(2026, 11, 1, 7, 0));
  assert.strictEqual(work.title, 'Work');
  assert.strictEqual(iso(work.start), '2026-11-01T13:00:00.000Z'); // 7:00 CST
  assert.strictEqual(new Date(work.end).getHours(), 19);
  assert.strictEqual(S.minutesToUsualWake(sc, at(2026, 11, 1, 1, 30)), 330); // ambiguous 1:30 (CDT) -> 6:00 CST
});

test('daylight saving starts 2027-03-14: the short night', () => {
  const sc = S.defaultSched();
  const sleep = S.current(sc, at(2027, 3, 14, 4, 0));
  assert.strictEqual(sleep.title, 'Sleep');
  assert.strictEqual(new Date(sleep.end).getHours(), 6);
  assert.strictEqual(S.lengthMin(sleep), 420);
});

test('open time after the last block, until the next usual wake', () => {
  const sc = S.normalize({ blocks: [{ title: 'Time with God', preset: 'god', len: 30 }, { title: 'Work', preset: 'work', len: 570 }], defaultWake: 360 });
  const now = at(2026, 10, 28, 18, 0);
  const open = S.current(sc, now);
  assert.strictEqual(open.index, -1);
  assert.strictEqual(open.title, 'Open time');
  assert.strictEqual(open.preset, 'normal');
  assert.strictEqual(open.start, at(2026, 10, 28, 16, 0));
  assert.strictEqual(open.end, at(2026, 10, 29, 6, 0));
  assert.deepStrictEqual(S.upcoming(sc, now, 3), []);
  assert.strictEqual(S.nextFree(sc, now), 0);
  // With a tap at 7:00, the short day ends at 17:00 and stays open until 6:00.
  S.wakeNow(sc, at(2026, 10, 28, 7, 0));
  const open2 = S.current(sc, at(2026, 10, 28, 22, 0));
  assert.strictEqual(open2.index, -1);
  assert.strictEqual(open2.start, at(2026, 10, 28, 17, 0));
  assert.strictEqual(open2.end, at(2026, 10, 29, 6, 0));
});

test('normalize cleans what comes from the phone', () => {
  const sc = S.normalize({ blocks: [{ title: '', preset: 'nap', len: 2 }, { title: 'Ok', preset: 'free', len: 61.4 }], defaultWake: 2000, names: { god: 'With God', bogus: 'x' }, editedAt: 5 });
  assert.deepStrictEqual(sc.blocks, [{ title: 'Block', preset: 'normal', len: 5 }, { title: 'Ok', preset: 'free', len: 61 }]);
  assert.strictEqual(sc.defaultWake, 1439);
  assert.strictEqual(sc.names.god, 'With God');
  assert.strictEqual(sc.names.free, 'Free time');
  assert.strictEqual(sc.editedAt, 5);
  assert.strictEqual(S.normalize({ blocks: [] }).blocks.length, 7, 'an empty list keeps the old blocks');
});

test('day key and formatting match the phone', () => {
  assert.strictEqual(S.dayKey(at(2026, 11, 1, 12, 0)), '2026-305');
  assert.strictEqual(S.dayKey(at(2028, 12, 31, 23, 0)), '2028-366');
  assert.strictEqual(S.hm(90), '1:30');
  assert.strictEqual(S.hm(5), '0:05');
  assert.strictEqual(S.clock(at(2026, 11, 1, 0, 5)), '12:05 AM');
  assert.strictEqual(S.clock(at(2026, 11, 1, 13, 0)), '1:00 PM');
});

run('schedule');
