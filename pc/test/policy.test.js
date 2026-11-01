'use strict';
const assert = require('assert');
const { test, run } = require('./harness');
const P = require('../app/lib/policy');
const { defaults, sanitize } = require('../app/lib/store');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const WORK = at(2026, 10, 28, 10, 0), GOD = at(2026, 10, 28, 6, 10), FREE = at(2026, 10, 28, 20, 30), STRICT = at(2026, 10, 28, 19, 30);

function model() { return defaults(); }

test('exe names are normalized', () => {
  assert.strictEqual(P.exeKey('C:\\Program Files\\Steam\\Steam.EXE'), 'steam');
  assert.strictEqual(P.exeKey('chrome.exe'), 'chrome');
  assert.strictEqual(P.hostKey('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.strictEqual(P.hostKey('*.reddit.com'), 'reddit.com');
  assert.strictEqual(P.hostKey('not a host'), '');
});

test('Windows itself and the listed tools always open, even in god/strict', () => {
  const m = model();
  ['explorer', 'Taskmgr', 'SearchHost', 'Focus', 'WindowsTerminal', 'PhoneExperienceHost', 'claude', 'SnippingTool'].forEach((x) => {
    const d = P.decideExe(m, x, GOD);
    assert.strictEqual(d.mode, P.ALLOW, x);
    assert.ok(d.essential, x);
  });
});

test('entertainment only in Free time, and never from a pass', () => {
  const m = model();
  ['discord', 'steam', 'steamwebhelper', 'EpicGamesLauncher', 'RobloxPlayerBeta', 'AC2-Win64-Shipping'].forEach((x) => {
    assert.strictEqual(P.decideExe(m, x, WORK).mode, P.BLOCK, x);
    assert.ok(P.decideExe(m, x, WORK).entertainment, x);
    assert.strictEqual(P.decideExe(m, x, FREE).mode, P.ALLOW, x);
  });
  m.passes.discord = WORK + 600000;
  assert.strictEqual(P.decideExe(m, 'discord', WORK).mode, P.BLOCK);
  assert.strictEqual(P.decideExe(m, 'spotify', WORK).entertainment, false, 'Spotify is not entertainment');
  assert.strictEqual(P.decideExe(m, 'telegram', WORK).entertainment, false, 'Telegram is not entertainment');
});

test('defaults: god/strict block unknown programs, the rest allow them', () => {
  const m = model();
  assert.strictEqual(P.decideExe(m, 'chrome', GOD).mode, P.BLOCK);
  assert.strictEqual(P.decideExe(m, 'chrome', STRICT).mode, P.BLOCK);
  assert.strictEqual(P.decideExe(m, 'chrome', WORK).mode, P.ALLOW);
  assert.strictEqual(P.decideExe(m, 'chrome', FREE).mode, P.ALLOW);
  assert.strictEqual(P.decideExe(m, 'chrome', GOD).presetName, 'Time with God');
});

test('per-program modes and reason passes', () => {
  const m = model();
  m.pc.presets.work.modes.excel = P.ALLOW;
  m.pc.presets.work.modes.chrome = P.REASON;
  m.pc.presets.work.modes.spotify = P.BLOCK;
  m.pc.presets.god.modes.spotify = P.ALLOW;
  assert.strictEqual(P.decideExe(m, 'EXCEL.EXE', WORK).mode, P.ALLOW);
  assert.strictEqual(P.decideExe(m, 'chrome', WORK).mode, P.REASON);
  assert.strictEqual(P.decideExe(m, 'spotify', WORK).mode, P.BLOCK);
  assert.strictEqual(P.decideExe(m, 'spotify', GOD).mode, P.ALLOW);
  m.passes.chrome = WORK + 10 * 60000;
  assert.strictEqual(P.decideExe(m, 'chrome', WORK).mode, P.ALLOW, 'pass is good for 10 minutes');
  assert.strictEqual(P.decideExe(m, 'chrome', WORK + 11 * 60000).mode, P.REASON, 'and then it runs out');
});

test('pause lets everything through for its 10 minutes', () => {
  const m = model();
  m.pausedUntil = GOD + 600000;
  assert.strictEqual(P.decideExe(m, 'discord', GOD).mode, P.ALLOW);
  assert.strictEqual(P.decideExe(m, 'chrome', GOD).mode, P.ALLOW);
  assert.strictEqual(P.sitePolicy(m, GOD).blocked.length, 0);
  assert.strictEqual(P.decideExe(m, 'chrome', GOD + 700000).mode, P.BLOCK);
});

test('site policy: entertainment outside free, per-preset sites, YouTube allowance', () => {
  const m = model();
  m.pc.presets.work.sites = ['news.ycombinator.com'];
  let p = P.sitePolicy(m, WORK);
  assert.strictEqual(p.preset, 'work');
  assert.ok(p.blocked.some((b) => b.host === 'reddit.com' && b.kind === 'entertainment'));
  assert.ok(p.blocked.some((b) => b.host === 'news.ycombinator.com' && b.kind === 'block'));
  assert.strictEqual(p.yt.counting, true);
  assert.strictEqual(p.yt.over, false);
  P.addYouTube(m, 100, WORK);
  for (let i = 0; i < 10; i++) P.addYouTube(m, 120, WORK);
  assert.strictEqual(P.ytUsedSec(m, WORK), 100 + 1200);
  p = P.sitePolicy(m, WORK);
  assert.strictEqual(p.yt.over, true);
  assert.strictEqual(P.ytUsedSec(m, WORK + 86400000), 0, 'resets the next day');
  const f = P.sitePolicy(m, FREE);
  assert.strictEqual(f.blocked.some((b) => b.kind === 'entertainment'), false);
  assert.strictEqual(f.yt.counting, false);
  assert.strictEqual(f.yt.over, false);
  assert.ok(P.hostMatches('www.m.reddit.com', 'reddit.com'));
  assert.ok(!P.hostMatches('notreddit.com', 'reddit.com'));
});

test('reasons need four words', () => {
  assert.strictEqual(P.reasonOk('need it now'), false);
  assert.strictEqual(P.reasonOk('  need to answer  the boss '), true);
});

test('store sanitize repairs bad data', () => {
  const d = sanitize({ sched: { blocks: 'x' }, pc: { presets: { work: { def: 7, modes: { 'Chrome.exe': 1, bad: 9 }, sites: ['https://www.X.com/home', 'nope'] } }, entExes: ['Discord.exe', 'discord'], ytLimit: -4 }, settings: { widget: { x: 'a' } } });
  assert.strictEqual(d.sched.blocks.length, 7);
  assert.strictEqual(d.pc.presets.work.def, P.ALLOW);
  assert.deepStrictEqual(d.pc.presets.work.modes, { chrome: 1 });
  assert.deepStrictEqual(d.pc.presets.work.sites, ['x.com']);
  assert.deepStrictEqual(d.pc.entExes, ['discord']);
  assert.strictEqual(d.pc.ytLimit, 0);
  assert.strictEqual(d.settings.widget, null);
  assert.strictEqual(d.pc.presets.god.def, P.BLOCK);
});

run('policy');
