'use strict';
// PROTOCOL.md: key/topic derivation and the AES-256-GCM wire format, against vectors made in Python
// (hashlib + cryptography's AESGCM) and a wire string made by Java's javax.crypto, the phone's code path.
const assert = require('assert');
const { test, run } = require('./harness');
const fc = require('../app/lib/crypto');

const PY = {
  code: 'K7QM-2XPA-9RTB-HW4E',
  norm: 'K7QM2XPA9RTBHW4E',
  key: '42aa6a83902f328618d298d702fe5cc2610ca0e94416e286ad0b2a628f7eb107',
  topic: 'focus-5581fdf446e7243670f30d252afe6365117ddc1f',
  iv: '0102030405060708090a0b0c',
  plain: '{"v":1,"from":"phone","id":"a1b2c3d4e5f6","at":1793520000000,"t":"clip","text":"Hello from Python ✓"}',
  wire: 'AQIDBAUGBwgJCgsMVbv+2p1gCvoaxPsBaMIYNMqGA45Dm8X8SM9f+u29DZwN5T70dxVJuAOvHMSZXl/1VaWSOfiO0P35PU30WZrismrULmxMuYF9RAkUE77X4Wbf7i+WB3nvdAaliYcqcurBH5E3QQmJhT368pmwg/XsUGtUmVoAaDk='
};
// Made by Java's Cipher("AES/GCM/NoPadding") exactly as Sync.java does it, for the same code.
const JAVA_WIRE = require('fs').readFileSync(__dirname + '/vectors/java_wire.txt', 'utf8').trim();

test('code normalization', () => {
  assert.strictEqual(fc.normalizeCode(PY.code), PY.norm);
  assert.strictEqual(fc.normalizeCode(' k7qm 2xpa-9rtb_hw4e! '), PY.norm);
  assert.strictEqual(fc.normalizeCode('O0I1'), '', 'O, 0, I and 1 are not in the alphabet');
  assert.strictEqual(fc.formatCode(PY.norm), PY.code);
});

test('new codes are 16 characters from the alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const c = fc.newCode();
    assert.strictEqual(c.length, 16);
    assert.ok([...c].every((ch) => fc.ALPHABET.indexOf(ch) >= 0));
  }
});

test('key and topic match the Python vector', () => {
  assert.strictEqual(fc.deriveKey(PY.code).toString('hex'), PY.key);
  assert.strictEqual(fc.deriveTopic(PY.code), PY.topic);
  assert.strictEqual(fc.deriveTopic(PY.code).length, 46);
});

test('encrypt with a fixed IV gives exactly the Python wire string', () => {
  const wire = fc.encrypt(fc.deriveKey(PY.code), PY.plain, Buffer.from(PY.iv, 'hex'));
  assert.strictEqual(wire, PY.wire);
});

test('decrypt the Python wire string', () => {
  assert.strictEqual(fc.decrypt(fc.deriveKey(PY.code), PY.wire), PY.plain);
});

test('decrypt a wire string from Java (the phone)', () => {
  const env = JSON.parse(fc.decrypt(fc.deriveKey(PY.code), JAVA_WIRE));
  assert.strictEqual(env.from, 'phone');
  assert.strictEqual(env.t, 'hello');
});

test('layout is IV(12) || ciphertext || tag(16), standard base64 without line breaks', () => {
  const plain = 'x'.repeat(100);
  const wire = fc.encrypt(fc.deriveKey(PY.code), plain);
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(wire));
  assert.strictEqual(Buffer.from(wire, 'base64').length, 12 + 100 + 16);
});

test('tampering or the wrong code is rejected', () => {
  const key = fc.deriveKey(PY.code);
  const bad = Buffer.from(PY.wire, 'base64'); bad[20] ^= 1;
  assert.throws(() => fc.decrypt(key, bad.toString('base64')));
  assert.throws(() => fc.decrypt(fc.deriveKey('AAAA-AAAA-AAAA-AAAA'), PY.wire));
  assert.throws(() => fc.decrypt(key, 'abc'));
});

run('crypto');
