'use strict';
// Starts the real app with a saved week that still has the old meal notes, one of them edited by hand,
// and checks that only the untouched ones get the new wording, once. Run: xvfb-run -a node test/notes-upgrade-e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');
const ELECTRON = require('electron');
const ROOT = path.join(__dirname, '..');
const up = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'res', 'notes-upgrade.json'), 'utf8'));
// The week as it was before the upgrade: today's week with each changed note put back.
const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'res', 'week.json'), 'utf8'));
up.changes.forEach((c) => { old[c.day].filter((b) => b.start === c.start && b.title === c.title).forEach((b) => { b.note = c.from; }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(home) {
  const env = Object.assign({}, process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), FOCUS_RELAY: 'http://127.0.0.1:9/' });
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(ELECTRON, ['--no-sandbox', '--disable-gpu', ROOT, '--hidden'], { env: env, stdio: 'ignore' });
}

(async function () {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-up-'));
  const dir = path.join(home, '.config', 'Focus');
  fs.mkdirSync(dir, { recursive: true });
  // Monday's lunch was edited by hand; everything else is the old wording.
  const days = JSON.parse(JSON.stringify(old));
  const monLunch = days.mon.find((b) => b.title === 'Lunch');
  monLunch.note = 'Leftover lasagna from Sunday.';
  fs.writeFileSync(path.join(dir, 'focus.json'), JSON.stringify({ sched: { v: 2, days: days, names: {}, editedAt: 5 } }));
  let app = launch(home);
  await sleep(9000);
  app.kill(); await sleep(1500);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'focus.json'), 'utf8')).sched;
  const want = up.changes.filter((c) => !(c.day === 'mon' && c.title === 'Lunch'));
  want.forEach((c) => {
    const b = saved.days[c.day].find((x) => x.start === c.start && x.title === c.title);
    assert.strictEqual(b.note, c.to, c.day + ' ' + c.title);
  });
  console.log('  ok   ' + want.length + ' untouched notes got the new wording');
  assert.strictEqual(saved.days.mon.find((b) => b.title === 'Lunch').note, 'Leftover lasagna from Sunday.');
  console.log('  ok   the hand-edited Monday lunch was left alone');
  assert.ok(saved.editedAt > 5); console.log('  ok   the week is marked edited, so it syncs to the phone');
  assert.ok(fs.readdirSync(dir).some((f) => f.indexOf('upgraded-' + up.id) === 0)); console.log('  ok   marked as done');
  // Run again after changing a note back to an old wording: it must not be touched a second time.
  const s2 = JSON.parse(fs.readFileSync(path.join(dir, 'focus.json'), 'utf8'));
  s2.sched.days.tue.find((b) => b.title === 'Lunch').note = up.changes.find((c) => c.day === 'tue' && c.title === 'Lunch').from;
  fs.writeFileSync(path.join(dir, 'focus.json'), JSON.stringify(s2));
  app = launch(home);
  await sleep(8000);
  app.kill(); await sleep(1500);
  const s3 = JSON.parse(fs.readFileSync(path.join(dir, 'focus.json'), 'utf8')).sched;
  assert.strictEqual(s3.days.tue.find((b) => b.title === 'Lunch').note, up.changes.find((c) => c.day === 'tue' && c.title === 'Lunch').from);
  console.log('  ok   it only runs once');
  console.log('\nall notes-upgrade checks passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
