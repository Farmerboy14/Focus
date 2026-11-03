'use strict';
// Live flights for the desktop Earth.
//  - The whole world from the OpenSky Network (opensky-network.org), every 15 minutes at most: anonymous use gets
//    400 credits a day and a world snapshot costs 4, so 96 a day fits. Between snapshots the globe flies each plane
//    on along its heading.
//  - Around Kirksville (250 nautical miles) from airplanes.live every 20 seconds, so nearby planes are exact.
//  - Clicking a plane: its latest position from airplanes.live, and its airline, route, aircraft and photo from
//    adsbdb (api.adsbdb.com).
// The page asks; this only fetches while the desktop is showing. The last world snapshot is kept on disk so a
// restart doesn't spend credits.
const fs = require('fs');
const path = require('path');

const OPENSKY = 'https://opensky-network.org/api/states/all';
const NEAR = 'https://api.airplanes.live/v2/point/';
const HEX = 'https://api.airplanes.live/v2/hex/';
const ADSBDB = 'https://api.adsbdb.com/v0/';
const WORLD_EVERY = 15 * 60 * 1000;
const NEAR_EVERY = 20 * 1000;
const HEADERS = { 'User-Agent': 'Focus-desktop (personal wallpaper)', Accept: 'application/json' };

const KT = 0.514444;    // m/s per knot
const FT = 0.3048;      // m per foot

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function cs(v) { return String(v || '').trim().toUpperCase(); }

/** OpenSky state vectors → [hex, callsign, lat, lon, track°, speed m/s, time s, altitude m, climb m/s, country, squawk] */
function parseOpenSky(j) {
  const out = [];
  const t = num(j && j.time) || 0;
  (j && j.states || []).forEach(function (s) {
    if (!Array.isArray(s) || s[8]) return;                         // on the ground
    const lat = num(s[6]), lon = num(s[5]), tp = num(s[3]);
    if (lat === null || lon === null || tp === null || t - tp > 120) return;
    out.push([String(s[0] || '').toLowerCase(), cs(s[1]), +lat.toFixed(4), +lon.toFixed(4), Math.round(num(s[10]) || 0), Math.round(num(s[9]) || 0),
      tp, Math.round(num(s[7]) !== null ? s[7] : (num(s[13]) || 0)), +(num(s[11]) || 0).toFixed(1), String(s[2] || ''), String(s[14] || '')]);
  });
  return out;
}

/** airplanes.live aircraft → the same rows, plus type code and registration */
function parseAdsb(j) {
  const out = [];
  const now = (num(j && j.now) || Date.now()) / 1000;
  (j && j.ac || []).forEach(function (a) {
    if (!a || a.alt_baro === 'ground') return;
    const lat = num(a.lat), lon = num(a.lon);
    if (lat === null || lon === null) return;
    const seen = num(a.seen_pos) || 0;
    if (seen > 60) return;
    out.push([String(a.hex || '').toLowerCase().replace(/^~/, ''), cs(a.flight), +lat.toFixed(4), +lon.toFixed(4), Math.round(num(a.track) || num(a.true_heading) || 0),
      Math.round((num(a.gs) || 0) * KT), Math.round(now - seen), Math.round((num(a.alt_baro) || num(a.alt_geom) || 0) * FT),
      +(((num(a.baro_rate) || num(a.geom_rate) || 0) * FT) / 60).toFixed(1), '', String(a.squawk || ''), String(a.t || ''), String(a.r || '')]);
  });
  return out;
}

function airport(a) {
  if (!a) return null;
  return { iata: a.iata_code || '', icao: a.icao_code || '', name: a.name || '', city: a.municipality || '', country: a.country_name || '',
    lat: num(a.latitude), lon: num(a.longitude) };
}

/**
 * makeFlights({ fetch, userDir, log, home: {lat, lon}, now }) →
 *   { get(known) → { world: {gen, at, planes}?, near: {gen, at, planes}?, note }, detail(hex, callsign, liveOnly) }
 */
function makeFlights(o) {
  const now = o.now || Date.now;
  const home = o.home || { lat: 40.19, lon: -92.58 };
  const file = path.join(o.userDir, 'flights-world.json');
  let world = { gen: 0, at: 0, planes: [] }, near = { gen: 0, at: 0, planes: [] };
  let worldTried = 0, worldWait = 0, nearTried = 0, nearWait = 0, note = '';
  let busyW = null, busyN = null;
  const details = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && Array.isArray(saved.planes)) { world = { gen: 1, at: saved.at || 0, planes: saved.planes }; worldTried = saved.tried || saved.at || 0; }
  } catch (e) { /* none yet */ }

  async function getJson(url) {
    const res = await o.fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      const wait = Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 3600;
      const err = new Error('rate limited'); err.wait = wait * 1000; throw err;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function fetchWorld() {
    worldTried = now();
    try {
      const j = await getJson(OPENSKY);
      const planes = parseOpenSky(j);
      if (planes.length) {
        world = { gen: world.gen + 1, at: (num(j.time) || now() / 1000) * 1000, planes: planes };
        note = '';
        fs.writeFile(file, JSON.stringify({ at: world.at, tried: worldTried, planes: planes }), function () { });
        o.log('flights: ' + planes.length + ' planes worldwide');
      }
    } catch (e) {
      if (e.wait) { worldWait = now() + e.wait; note = 'OpenSky is busy; the world map fills in later.'; }
      o.log('flights (world): ' + (e && e.message || e));
    }
  }

  async function fetchNear() {
    nearTried = now();
    try {
      const j = await getJson(NEAR + home.lat.toFixed(2) + '/' + home.lon.toFixed(2) + '/250');
      near = { gen: near.gen + 1, at: num(j.now) || now(), planes: parseAdsb(j) };
    } catch (e) {
      if (e.wait) nearWait = now() + e.wait;
      o.log('flights (near): ' + (e && e.message || e));
    }
  }

  /** known: {w, n} generations the page already has; only newer sets come back. */
  async function get(known) {
    known = known || {};
    const t = now();
    if (!busyW && t - worldTried > WORLD_EVERY && t > worldWait) busyW = fetchWorld().finally(function () { busyW = null; });
    if (!busyN && t - nearTried > NEAR_EVERY && t > nearWait) busyN = fetchNear().finally(function () { busyN = null; });
    // wait for the nearby set (quick); the world set arrives on a later ask if it's slow
    if (busyN) await Promise.race([busyN, new Promise(function (r) { setTimeout(r, 8000); })]);
    if (busyW && !world.planes.length) await Promise.race([busyW, new Promise(function (r) { setTimeout(r, 15000); })]);
    const out = { note: note };
    if (known.w !== world.gen) out.world = world;
    if (known.n !== near.gen) out.near = near;
    return out;
  }

  async function photo(url) {
    if (!url || !/^https:\/\//.test(url)) return null;
    try {
      const res = await o.fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 600000) return null;
      return 'data:' + type + ';base64,' + buf.toString('base64');
    } catch (e) { return null; }
  }

  /** Everything about one plane. The route, aircraft and photo are kept for half an hour; the position is always fresh. */
  async function detail(hex, callsign, liveOnly) {
    hex = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
    callsign = cs(callsign).replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!hex) return { error: 'no plane' };
    const key = hex + '|' + callsign;
    const live = getJson(HEX + hex).then(function (j) {
      const a = j && j.ac && j.ac[0];
      if (!a) return null;
      const row = parseAdsb({ now: j.now, ac: [a] })[0];
      return { lat: num(a.lat), lon: num(a.lon), altFt: a.alt_baro === 'ground' ? 0 : num(a.alt_baro), ground: a.alt_baro === 'ground',
        gsKt: num(a.gs), track: num(a.track), climbFpm: num(a.baro_rate) !== null ? a.baro_rate : num(a.geom_rate), squawk: a.squawk || '',
        type: a.t || '', desc: a.desc || '', reg: a.r || '', owner: a.ownOp || '', row: row || null };
    }).catch(function () { return null; });
    let info = details[key];
    if (!liveOnly && (!info || now() - info.at > 30 * 60 * 1000)) {
      info = { at: now(), aircraft: null, route: null, airline: null, photo: null };
      try {
        const j = await getJson(ADSBDB + 'aircraft/' + hex + (callsign ? '?callsign=' + encodeURIComponent(callsign) : ''));
        const r = j && j.response || {};
        if (r.aircraft) info.aircraft = r.aircraft;
        if (r.flightroute) info.route = r.flightroute;
      } catch (e) { /* unknown aircraft: try the callsign alone */ }
      if (!info.route && callsign) {
        try { const j = await getJson(ADSBDB + 'callsign/' + encodeURIComponent(callsign)); info.route = j && j.response && j.response.flightroute || null; } catch (e) { /* none */ }
      }
      if (info.aircraft) info.photo = await photo(info.aircraft.url_photo_thumbnail);
      details[key] = info;
    }
    const lv = await live;
    const ac = info && info.aircraft, rt = info && info.route;
    const al = rt && rt.airline;
    return {
      hex: hex, callsign: callsign,
      airline: al ? { name: al.name || '', iata: al.iata || '', icao: al.icao || '', callsign: al.callsign || '' } : null,
      from: rt ? airport(rt.origin) : null, to: rt ? airport(rt.destination) : null,
      aircraft: ac ? { type: ac.type || '', icaoType: ac.icao_type || '', maker: ac.manufacturer || '', reg: ac.registration || '', owner: ac.registered_owner || '',
        country: ac.registered_owner_country_name || '' } : (lv && (lv.desc || lv.type) ? { type: lv.desc || lv.type, icaoType: lv.type, maker: '', reg: lv.reg, owner: lv.owner, country: '' } : null),
      photo: info ? info.photo : null,
      live: lv
    };
  }

  return { get: get, detail: detail };
}

module.exports = { makeFlights: makeFlights, parseOpenSky: parseOpenSky, parseAdsb: parseAdsb };
