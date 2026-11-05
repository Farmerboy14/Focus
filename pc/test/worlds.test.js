'use strict';
// Facts for the worlds you can visit, and where they are from Kirksville right now.
const assert = require('assert');
const { test, run } = require('./harness');
const K = require('../app/ui/sky');
const WD = require('../app/ui/worlds');

test('every world you can click has a name, six facts, a note and a verse', function () {
  ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].forEach(function (id) {
    const w = WD.W[id];
    assert.ok(w && w.name && w.what && w.note, id);
    assert.strictEqual(w.facts.length, 6, id);
    assert.ok(w.verse && w.verse.text && w.verse.ref, id);
  });
});

test('the Sun is up at noon in Kirksville and down at midnight, in the right part of the sky', function () {
  const noon = WD.live(K.at(Date.UTC(2026, 10, 5, 18, 0)), 'sun', 40.19, -92.58);
  assert.ok(noon.alt > 25 && noon.alt < 40, 'noon altitude ' + noon.alt);
  assert.strictEqual(noon.dir, 'south');
  const night = WD.live(K.at(Date.UTC(2026, 10, 6, 6, 0)), 'sun', 40.19, -92.58);
  assert.ok(night.alt < -30, 'midnight altitude ' + night.alt);
  assert.ok(Math.abs(noon.lightSec - 493) < 10, 'sunlight takes about 8 min 13 s in November: ' + noon.lightSec);
});

test('distances read sensibly', function () {
  const s = K.at(Date.UTC(2026, 10, 5, 18, 0));
  const moon = WD.live(s, 'moon', 40.19, -92.58);
  assert.ok(moon.miles > 220000 && moon.miles < 255000, 'moon ' + moon.miles);
  assert.ok(/^[\d,]+ miles$/.test(WD.bigMiles(moon.miles)));
  assert.strictEqual(WD.bigMiles(504e6), '504 million miles');
  assert.strictEqual(WD.bigMiles(1.72e9), '1.72 billion miles');
  assert.strictEqual(WD.lightText(1.3), '1.3 seconds');
  assert.strictEqual(WD.lightText(2700), '45 minutes');
  assert.strictEqual(WD.lightText(9240), '2 h 34 min');
});

run();
