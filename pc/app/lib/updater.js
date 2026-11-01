'use strict';
// Small updates: only the app folder (UI + logic) comes from GitHub; Electron stays as installed.
const fs = require('fs');
const path = require('path');
const unzip = require('./unzip');

const API = 'https://api.github.com/repos/Farmerboy14/focus/contents/pc/release/';
const HEADERS = { 'Accept': 'application/vnd.github.raw+json', 'User-Agent': 'FocusPC', 'X-GitHub-Api-Version': '2022-11-28' };

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')); } catch (e) { return null; }
}

function copyMissing(src, dst) {
  if (!fs.existsSync(src)) return;
  for (const name of fs.readdirSync(src)) {
    const a = path.join(src, name), b = path.join(dst, name);
    if (fs.statSync(a).isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyMissing(a, b); }
    else if (!fs.existsSync(b)) fs.copyFileSync(a, b);
  }
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { } }

/**
 * opts: { fetch, current: {version}, userDir, bundledDir, bootstrapVersion, log }
 * check() resolves { available: false } or { available: true, info }.
 * install(info) downloads, unpacks into userDir/app and resolves when ready to restart.
 */
function makeUpdater(opts) {
  const log = opts.log || function () { };

  async function fetchJson(name) {
    const res = await opts.fetch(API + name + '?ref=main', { headers: HEADERS });
    if (!res.ok) throw new Error('GitHub said ' + res.status);
    return JSON.parse(await res.text());
  }

  async function check() {
    const info = await fetchJson('version.json');
    const cur = opts.current.version | 0;
    if ((info.version | 0) > cur && (info.minBootstrap | 0) <= opts.bootstrapVersion) return { available: true, info: info };
    return { available: false, info: info };
  }

  async function install(info) {
    const res = await opts.fetch(API + 'app.zip?ref=main', { headers: HEADERS });
    if (!res.ok) throw new Error('download failed: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const fresh = path.join(opts.userDir, 'app.new');
    rmrf(fresh);
    fs.mkdirSync(fresh, { recursive: true });
    unzip.extract(buf, fresh);
    const v = readVersion(fresh);
    if (!v || (v.version | 0) !== (info.version | 0)) { rmrf(fresh); throw new Error('the update package looks wrong'); }
    if (!fs.existsSync(path.join(fresh, 'main.js'))) { rmrf(fresh); throw new Error('the update package has no main.js'); }
    // The update leaves out the Bible and fonts; they come from the installed copy.
    copyMissing(path.join(opts.bundledDir, 'res'), path.join(fresh, 'res'));
    // The bootstrap swaps app.new into place on the next start, before any of it is loaded.
    log('update: ready to install ' + (v.name || v.version));
    return v;
  }

  return { check: check, install: install };
}

module.exports = { makeUpdater, readVersion, copyMissing };
