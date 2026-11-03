'use strict';
// Live flights: reading OpenSky and airplanes.live, how often they're asked, and a plane's details from adsbdb.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, run } = require('./harness');
const F = require('../app/lib/flights');

const T = 1793736000; // 2026-11-03 18:40 UTC, in seconds
const OPENSKY = { time: T, states: [
  ['a1b2c3', 'UAL1234 ', 'United States', T - 5, T - 4, -92.1, 40.5, 10668, false, 230.5, 271.3, -0.3, null, 10900, '1200', false, 0],
  ['abcdef', 'SWA77   ', 'United States', T - 3, T - 3, -90.2, 38.7, null, true, 0, 0, 0, null, null, null, false, 0],     // on the ground
  ['400abc', 'BAW286  ', 'United Kingdom', T - 400, T - 2, -1.2, 51.4, 11000, false, 250, 80, 0, null, 11100, '7000', false, 0], // stale fix
  ['3c6444', 'DLH400  ', 'Germany', T - 2, T - 1, null, null, 11000, false, 250, 80, 0, null, 11100, '', false, 0]              // no position
] };
const NEAR = { now: T * 1000, ac: [
  { hex: 'a1b2c3', flight: 'UAL1234 ', lat: 40.51, lon: -92.15, alt_baro: 35000, gs: 448, track: 271.6, baro_rate: -64, squawk: '1200', t: 'B738', r: 'N12345', seen_pos: 1.2 },
  { hex: 'a99999', flight: 'N555CA  ', lat: 40.2, lon: -92.6, alt_baro: 'ground', gs: 3, track: 10, seen_pos: 0.4 },
  { hex: '~2a0001', lat: 40.0, lon: -92.0, alt_baro: 4500, gs: 120, track: 180, seen_pos: 2 }
] };

function fetcher(routes, calls) {
  return async function (url) {
    calls.push(url);
    const k = Object.keys(routes).filter(function (p) { return url.indexOf(p) === 0; })[0];
    let r = k ? routes[k] : { status: 404, body: {} };
    if (typeof r === 'function') r = r(url);
    return {
      ok: (r.status || 200) < 400, status: r.status || 200,
      headers: { get: function (h) { return (r.headers || {})[h.toLowerCase()] || null; } },
      json: async function () { return r.body; }, arrayBuffer: async function () { return r.bytes || new ArrayBuffer(0); }
    };
  };
}

test('OpenSky rows: airborne planes with a fresh position, callsigns trimmed', function () {
  const rows = F.parseOpenSky(OPENSKY);
  assert.strictEqual(rows.length, 1);
  const r = rows[0];
  assert.deepStrictEqual(r.slice(0, 7), ['a1b2c3', 'UAL1234', 40.5, -92.1, 271, 231, T - 5]);
  assert.strictEqual(r[7], 10668); assert.strictEqual(r[9], 'United States'); assert.strictEqual(r[10], '1200');
});

test('airplanes.live rows: knots and feet become m/s and metres; the ground is left out', function () {
  const rows = F.parseAdsb(NEAR);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][0], 'a1b2c3'); assert.strictEqual(rows[0][5], Math.round(448 * 0.514444)); assert.strictEqual(rows[0][7], Math.round(35000 * 0.3048));
  assert.strictEqual(rows[0][11], 'B738'); assert.strictEqual(rows[0][12], 'N12345');
  assert.strictEqual(rows[1][0], '2a0001', 'the ~ for non-ICAO addresses is dropped');
});

test('the world is asked at most every 15 minutes, nearby every 20 seconds, and only newer sets go to the page', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-flights-'));
  const calls = [];
  let t = T * 1000;
  const f = F.makeFlights({ fetch: fetcher({ 'https://opensky-network.org/': { body: OPENSKY }, 'https://api.airplanes.live/v2/point/': { body: NEAR } }, calls),
    userDir: dir, log: function () { }, now: function () { return t; } });
  let r = await f.get({});
  assert.ok(r.world && r.world.planes.length === 1 && r.near && r.near.planes.length === 2);
  assert.ok(/point\/40\.19\/-92\.58\/250$/.test(calls.filter(function (u) { return /point/.test(u); })[0]));
  const known = { w: r.world.gen, n: r.near.gen };
  t += 10000; r = await f.get(known);
  assert.ok(!r.world && !r.near, 'nothing new after 10 s');
  t += 15000; r = await f.get(known);
  assert.ok(!r.world && r.near, 'nearby refreshed after 25 s');
  assert.strictEqual(calls.filter(function (u) { return /opensky/.test(u); }).length, 1);
  t += 15 * 60000; await f.get(known);
  assert.strictEqual(calls.filter(function (u) { return /opensky/.test(u); }).length, 2, 'the world again after 15 minutes');
  // a restart reads the saved world instead of asking right away
  await new Promise(function (res) { setTimeout(res, 50); });
  const calls2 = [];
  const g = F.makeFlights({ fetch: fetcher({ 'https://api.airplanes.live/': { body: NEAR } }, calls2), userDir: dir, log: function () { }, now: function () { return t + 60000; } });
  r = await g.get({});
  assert.ok(r.world && r.world.planes.length === 1, 'the saved world comes back');
  assert.strictEqual(calls2.filter(function (u) { return /opensky/.test(u); }).length, 0, 'no credits spent on restart');
});

test('a busy OpenSky (429) is left alone for as long as it says', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-flights-'));
  const calls = [];
  let t = T * 1000;
  const f = F.makeFlights({ fetch: fetcher({ 'https://opensky-network.org/': { status: 429, headers: { 'x-rate-limit-retry-after-seconds': '7200' }, body: {} },
    'https://api.airplanes.live/': { body: NEAR } }, calls), userDir: dir, log: function () { }, now: function () { return t; } });
  const r = await f.get({});
  assert.ok(/busy/.test(r.note));
  t += 16 * 60000; await f.get({});
  assert.strictEqual(calls.filter(function (u) { return /opensky/.test(u); }).length, 1, 'still waiting after 16 minutes');
  t += 2 * 3600000; await f.get({});
  assert.strictEqual(calls.filter(function (u) { return /opensky/.test(u); }).length, 2, 'asks again after 2 hours');
});

test('a plane details: route, airline and aircraft from adsbdb, position from airplanes.live, photo as data', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-flights-'));
  const calls = [];
  const jpeg = Buffer.from([0xFF, 0xD8, 1, 2, 3]);
  const f = F.makeFlights({ fetch: fetcher({
    'https://api.airplanes.live/v2/hex/a1b2c3': { body: { now: T * 1000, ac: [NEAR.ac[0]] } },
    'https://api.adsbdb.com/v0/aircraft/a1b2c3?callsign=UAL1234': { body: { response: {
      aircraft: { type: '737-824', icao_type: 'B738', manufacturer: 'Boeing', mode_s: 'A1B2C3', registration: 'N12345', registered_owner: 'United Airlines',
        registered_owner_country_name: 'United States', url_photo_thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/000/1.jpg' },
      flightroute: { callsign: 'UAL1234', airline: { name: 'United Airlines', icao: 'UAL', iata: 'UA', callsign: 'UNITED' },
        origin: { iata_code: 'ORD', icao_code: 'KORD', name: "Chicago O'Hare International Airport", municipality: 'Chicago', country_name: 'United States', latitude: 41.9786, longitude: -87.9048 },
        destination: { iata_code: 'DEN', icao_code: 'KDEN', name: 'Denver International Airport', municipality: 'Denver', country_name: 'United States', latitude: 39.8617, longitude: -104.673 } } } } },
    'https://airport-data.com/': { headers: { 'content-type': 'image/jpeg' }, bytes: jpeg }
  }, calls), userDir: dir, log: function () { } });
  const d = await f.detail('A1B2C3', 'ual1234 ');
  assert.strictEqual(d.airline.name, 'United Airlines');
  assert.strictEqual(d.from.iata, 'ORD'); assert.strictEqual(d.to.city, 'Denver'); assert.strictEqual(d.to.lat, 39.8617);
  assert.strictEqual(d.aircraft.reg, 'N12345'); assert.strictEqual(d.aircraft.maker, 'Boeing');
  assert.strictEqual(d.live.altFt, 35000); assert.strictEqual(d.live.gsKt, 448); assert.ok(d.live.row && d.live.row[0] === 'a1b2c3');
  assert.ok(/^data:image\/jpeg;base64,/.test(d.photo));
  const n = calls.length;
  const d2 = await f.detail('a1b2c3', 'UAL1234', true);
  assert.strictEqual(calls.length, n + 1, 'a live refresh only asks for the position');
  assert.strictEqual(d2.to.iata, 'DEN');
});

test('an unknown plane still gets what airplanes.live knows', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-flights-'));
  const f = F.makeFlights({ fetch: fetcher({ 'https://api.airplanes.live/v2/hex/a1b2c3': { body: { now: T * 1000, ac: [NEAR.ac[0]] } } }, []), userDir: dir, log: function () { } });
  const d = await f.detail('a1b2c3', 'UAL1234');
  assert.strictEqual(d.from, null);
  assert.strictEqual(d.aircraft.type, 'B738');
  assert.strictEqual(d.aircraft.reg, 'N12345');
});

run();
