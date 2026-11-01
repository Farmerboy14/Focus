'use strict';
// A tiny unzip for update packages: stored and deflated entries, read from the central directory.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function entries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    out.push({ name: name, method: method, csize: csize, size: size, local: local });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function read(buf, e) {
  if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('bad local header: ' + e.name);
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const raw = buf.subarray(start, start + e.csize);
  let data;
  if (e.method === 0) data = Buffer.from(raw);
  else if (e.method === 8) data = zlib.inflateRawSync(raw);
  else throw new Error('unsupported zip method ' + e.method + ' for ' + e.name);
  if (data.length !== e.size) throw new Error('size mismatch: ' + e.name);
  return data;
}

/** Extracts every file into dest. Refuses paths that would escape dest. */
function extract(buf, dest) {
  const root = path.resolve(dest);
  const list = entries(buf);
  for (const e of list) {
    const name = e.name.replace(/\\/g, '/');
    if (!name || name.endsWith('/')) continue;
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').indexOf('..') >= 0) throw new Error('unsafe path in zip: ' + name);
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('unsafe path in zip: ' + name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, read(buf, e));
  }
  return list.length;
}

module.exports = { entries, read, extract };
