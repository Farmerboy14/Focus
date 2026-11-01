'use strict';
// Verse of the day must be the same verse the phone shows: java.util.Random ported exactly, checked
// against Bible.java's logic run in real Java (vectors/java_votd.txt, 61 dates).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, run } = require('./harness');
const B = require('../app/lib/bible');

const bible = B.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'res', 'kjv.txt'), 'utf8'));

test('parses all 66 books and 31,102 verses', () => {
  assert.strictEqual(bible.books.length, 66);
  let n = 0;
  bible.text.forEach((b) => b.forEach((c) => { n += c.length; }));
  assert.strictEqual(n, 31102);
  assert.strictEqual(bible.text[18].length, 150);
  assert.ok(bible.text[18][45][9].startsWith('Be still, and know that I am God'));
});

test('java.util.Random matches Java', () => {
  const r = new B.JavaRandom(123456789n);
  const got = [];
  for (let i = 0; i < 8; i++) got.push(r.nextInt(66), r.nextInt(150), r.nextInt(64));
  assert.strictEqual(got.join(','), '49,0,29,46,90,13,3,7,47,41,41,31,60,82,31,51,10,7,14,79,17,38,138,26');
});

test('verse of the day matches the phone on 61 dates', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'vectors', 'java_votd.txt'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 61);
  lines.forEach((l) => {
    const [t, ref] = l.split('=');
    const v = B.verseOfDay(bible, Number(t));
    assert.strictEqual(v.book + ':' + v.chapter + ':' + v.verse, ref, new Date(Number(t)).toString());
  });
});

test('search: whole words, phrases, and the limit', () => {
  const prayed = B.search(bible, 'prayed', 100000);
  assert.ok(prayed.length > 50);
  assert.ok(prayed.every((r) => /\bprayed\b/i.test(r.text)));
  assert.ok(!B.search(bible, 'pray', 100000).some((r) => !/\bpray\b/i.test(r.text)), 'pray does not match prayed');
  const phrase = B.search(bible, 'be still', 100);
  assert.ok(phrase.some((r) => r.book === 18 && r.chapter === 46 && r.verse === 10));
  assert.strictEqual(B.search(bible, 'the', 5).length, 5);
  assert.strictEqual(B.search(bible, 'a', 5).length, 0, 'needs two letters');
  assert.strictEqual(B.label(bible, { book: 42, chapter: 3, verse: 16 }), 'John 3:16');
});

run('bible');
