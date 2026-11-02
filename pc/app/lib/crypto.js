'use strict';
// The phone <-> PC wire format from PROTOCOL.md: AES-256-GCM, base64(IV || ciphertext || tag).
const crypto = require('crypto');
const zlib = require('zlib');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(code) {
  let out = '';
  for (const ch of String(code || '').toUpperCase()) if (ALPHABET.indexOf(ch) >= 0) out += ch;
  return out;
}

function newCode() {
  let s = '';
  for (let i = 0; i < 16; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

function formatCode(code) {
  const c = normalizeCode(code);
  return c.replace(/(.{4})(?=.)/g, '$1-');
}

function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest(); }

function deriveKey(code) { return sha('focus-key:' + normalizeCode(code)); }

function deriveTopic(code) { return 'focus-' + sha('focus-topic:' + normalizeCode(code)).toString('hex').slice(0, 40); }

function encrypt(key, plaintext, iv) {
  iv = iv || crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}

/** Throws when the message isn't ours or was tampered with. */
function decrypt(key, wire) { return decryptBytes(key, wire).toString('utf8'); }

function decryptBytes(key, wire) {
  const all = Buffer.from(String(wire).trim(), 'base64');
  if (all.length < 12 + 16) throw new Error('too short');
  const iv = all.subarray(0, 12);
  const tag = all.subarray(all.length - 16);
  const ct = all.subarray(12, all.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// Envelopes are zlib-compressed before encryption, marked by a leading 0x01 byte (PROTOCOL.md).
function pack(json) { return Buffer.concat([Buffer.from([1]), zlib.deflateSync(Buffer.from(json, 'utf8'), { level: 9 })]); }

function unpack(bytes) { return bytes.length && bytes[0] === 1 ? zlib.inflateSync(bytes.subarray(1)).toString('utf8') : bytes.toString('utf8'); }

/** Encrypted wire string for an envelope's JSON text, or null when it's still too big for the relay. */
function seal(key, json, maxBytes) {
  const body = pack(json);
  if (maxBytes && body.length > maxBytes) return null;
  return encrypt(key, body);
}

/** The envelope's JSON text from a wire string. Throws when it isn't ours. */
function open(key, wire) { return unpack(decryptBytes(key, wire)); }

function newId() { return crypto.randomBytes(6).toString('hex'); }

module.exports = { ALPHABET, normalizeCode, newCode, formatCode, deriveKey, deriveTopic, encrypt, decrypt, decryptBytes, pack, unpack, seal, open, newId };
