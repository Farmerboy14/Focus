'use strict';
// Live clouds for the desktop Earth: a fresh satellite cloud map of the whole world, made every three hours by
// Matt Eason's Live Cloud Maps (github.com/matteason/live-cloud-maps, CC0) from EUMETSAT data.
// "Contains modified EUMETSAT data." Kept in the user folder so the last one is there offline.
const fs = require('fs');
const path = require('path');

const URL = 'https://clouds.matteason.co.uk/images/8192x4096/clouds.jpg';  // full detail, for zooming in
const EVERY = 3 * 60 * 60 * 1000;
const RETRY = 20 * 60 * 1000;

/**
 * makeClouds({ fetch, userDir, log, onNew, enabled, now }) → { start(), stop(), file(), info(), check() }
 * onNew() is called whenever a newer map has been saved.
 */
function makeClouds(o) {
  const file = path.join(o.userDir, 'clouds.jpg');
  const meta = path.join(o.userDir, 'clouds.json');
  const now = o.now || Date.now;
  let timer = null, busy = false, stopped = false;

  function info() {
    try {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (fs.existsSync(file)) return { live: true, at: Number(m.at) || 0, fetched: Number(m.fetched) || 0 };
    } catch (e) { /* none yet */ }
    return { live: false, at: 0, fetched: 0 };
  }

  function later(ms) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(check, ms);
  }

  async function check() {
    if (busy) return false;
    if (o.enabled && !o.enabled()) { later(RETRY); return false; }
    busy = true;
    try {
      const res = await o.fetch(URL, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      // a real JPEG of a sensible size, or keep what we had
      if (buf.length < 40000 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not a cloud map (' + buf.length + ' bytes)');
      const lm = Date.parse(res.headers.get('last-modified') || '') || now();
      const old = info();
      const same = old.live && fs.existsSync(file) && fs.statSync(file).size === buf.length && old.at === lm;
      if (!same) {
        fs.writeFileSync(file + '.tmp', buf);
        fs.renameSync(file + '.tmp', file);
        fs.writeFileSync(meta, JSON.stringify({ at: lm, fetched: now() }));
        o.log('new cloud map (' + Math.round(buf.length / 1024) + ' KB, from ' + new Date(lm).toISOString() + ')');
        if (o.onNew) o.onNew();
      } else {
        fs.writeFileSync(meta, JSON.stringify({ at: lm, fetched: now() }));
      }
      later(EVERY);
      return !same;
    } catch (e) {
      o.log('cloud map: ' + (e && e.message || e));
      later(RETRY);
      return false;
    } finally {
      busy = false;
    }
  }

  function start() {
    stopped = false;
    const i = info();
    const age = now() - (i.fetched || 0);
    later(i.live && age < EVERY ? EVERY - age : 4000);
  }

  function stop() { stopped = true; clearTimeout(timer); }

  return { start: start, stop: stop, check: check, info: info, file: function () { return fs.existsSync(file) ? file : null; } };
}

module.exports = { makeClouds: makeClouds, URL: URL };
