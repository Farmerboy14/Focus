'use strict';
// Sharper Earth maps, fetched once a month: NASA's Blue Marble Next Generation for this month of the year (so
// the snow and the green follow the seasons), the Black Marble city lights, and a water mask, all 8192 x 4096.
// NASA imagery is public domain; these copies are prepared and shared (CC0) by Matt Eason's Live Cloud Maps,
// pinned to one version so they never change under us. Until they arrive, Focus uses the smaller maps it ships with.
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/matteason/live-cloud-maps/530c011db936adc166e89605e1de2a208fe9752c/static_images/monthly/';
const KINDS = { day: 'earth', night: 'earth-night', water: 'specular-base' };
const RETRY = 60 * 60 * 1000;

/** makeEarthMaps({ fetch, userDir, log, onNew, enabled, now }) → { start(), stop(), check(), file(kind) } */
function makeEarthMaps(o) {
  const dir = path.join(o.userDir, 'earthmaps');
  const now = o.now || Date.now;
  let timer = null, busy = false, stopped = false, lastMonth = 0;

  function month() { return new Date(now()).getMonth() + 1; }
  function name(kind, m) { return kind + '-' + m + '.jpg'; }

  /** This month's map of a kind, else any month's, else null (use the one Focus ships with). */
  function file(kind) {
    const f = path.join(dir, name(kind, month()));
    if (fs.existsSync(f)) return f;
    try {
      const any = fs.readdirSync(dir).filter(function (n) { return n.indexOf(kind + '-') === 0 && /\.jpg$/.test(n); })[0];
      return any ? path.join(dir, any) : null;
    } catch (e) { return null; }
  }

  // timers can't wait longer than about 24 days, so look in at least every 6 hours
  function later(ms) { clearTimeout(timer); if (!stopped) timer = setTimeout(check, Math.min(ms, 6 * 60 * 60 * 1000)); }

  async function check() {
    if (busy) return false;
    if (o.enabled && !o.enabled()) { later(RETRY); return false; }
    busy = true;
    const m = month();
    let got = false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const kind of Object.keys(KINDS)) {
        const f = path.join(dir, name(kind, m));
        if (fs.existsSync(f)) continue;
        const res = await o.fetch(BASE + KINDS[kind] + '/' + m + '.jpg');
        if (!res.ok) throw new Error(kind + ': HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500000 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error(kind + ': not a map (' + buf.length + ' bytes)');
        fs.writeFileSync(f + '.tmp', buf);
        fs.renameSync(f + '.tmp', f);
        o.log('earth map: ' + kind + ' for month ' + m + ' (' + Math.round(buf.length / 1048576) + ' MB)');
        got = true;
      }
      // last month's maps go once this month's are all here
      fs.readdirSync(dir).forEach(function (n) {
        const mm = /-(\d+)\.jpg$/.exec(n);
        if (mm && Number(mm[1]) !== m) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* in use */ } }
      });
      if (got || lastMonth !== m) { lastMonth = m; if (o.onNew) o.onNew(); }
      // look again a little after midnight on the first of next month
      const d = new Date(now());
      later(Math.max(60000, new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 10).getTime() - now()));
      return got;
    } catch (e) {
      o.log('earth maps: ' + (e && e.message || e));
      if (got && o.onNew) o.onNew();
      later(RETRY);
      return false;
    } finally {
      busy = false;
    }
  }

  function start() { stopped = false; lastMonth = file('day') && fs.existsSync(path.join(dir, name('day', month()))) ? month() : 0; later(8000); }
  function stop() { stopped = true; clearTimeout(timer); }

  return { start: start, stop: stop, check: check, file: file };
}

module.exports = { makeEarthMaps: makeEarthMaps, BASE: BASE };
