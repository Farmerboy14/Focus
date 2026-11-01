// The King James Bible: parsing, the verse of the day (same pick as the phone), and word search.
// Ported from Bible.java. Works in the page (window.FocusBible) and in Node (for tests).
(function (root) {
  'use strict';

  /** kjv.txt: first line is book names joined by "|", then "book\tchapter\tverse\ttext" per line. */
  function parse(raw) {
    const lines = raw.split('\n');
    const books = lines[0].replace(/\r$/, '').split('|');
    const text = books.map(function () { return []; });
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1), c = line.indexOf('\t', b + 1);
      if (a < 0 || b < 0 || c < 0) continue;
      const bk = parseInt(line.slice(0, a), 10), ch = parseInt(line.slice(a + 1, b), 10);
      const chs = text[bk];
      if (!chs) continue;
      while (chs.length < ch) chs.push([]);
      chs[ch - 1].push(line.slice(c + 1).replace(/\r$/, ''));
    }
    return { books: books, text: text };
  }

  // java.util.Random, exactly, so the PC shows the same verse as the phone.
  const MULT = 0x5DEECE66Dn, ADD = 0xBn, MASK = (1n << 48n) - 1n;
  function JavaRandom(seed) { this.seed = (BigInt.asIntN(64, seed) ^ MULT) & MASK; }
  JavaRandom.prototype.next = function (bits) {
    this.seed = (this.seed * MULT + ADD) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  };
  JavaRandom.prototype.nextInt = function (bound) {
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits, val;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) > 0x7fffffff); // Java's int overflow check
    return val;
  };

  function skipChapter(book, ch) {
    switch (book) {
      case 'Genesis': return ch === 5 || ch === 10 || ch === 11 || ch === 25 || ch === 36 || ch === 46;
      case 'Exodus': return ch === 6 || (ch >= 25 && ch <= 31) || (ch >= 35 && ch <= 40);
      case 'Leviticus': return ch !== 19 && ch !== 26;
      case 'Numbers': return (ch >= 1 && ch <= 4) || ch === 7 || ch === 26 || ch === 28 || ch === 29 || ch === 33 || ch === 34;
      case 'Joshua': return ch >= 12 && ch <= 21;
      case '1 Chronicles': return ch <= 9 || (ch >= 23 && ch <= 27);
      case 'Ezra': return ch === 2 || ch === 8 || ch === 10;
      case 'Nehemiah': return ch === 3 || ch === 7 || (ch >= 10 && ch <= 12);
      case 'Ezekiel': return ch >= 40;
      case 'Matthew': return ch === 1;
      case 'Luke': return ch === 3;
      default: return false;
    }
  }

  const WORDS = ['god', 'lord', 'jesus', 'christ', 'spirit', 'faith', 'love', 'mercy', 'grace', 'pray', 'trust', 'hope', 'peace',
    'righteous', 'salvation', 'saviour', 'holy', 'praise', 'strength', 'wisdom', 'forgive', 'eternal', 'everlasting', 'truth',
    'blessed', 'fear not'];
  const AVOID = ['begat', 'cubit', 'shekel', 'slew', 'smite', 'smote', 'harlot', 'whore', 'bald'];

  function goodVerse(b, ch, v) {
    if (skipChapter(b, ch)) return false;
    const n = v.length;
    if (n < 50 || n > 220) return false;
    const last = v.charAt(n - 1);
    if (last !== '.' && last !== '!' && last !== '?') return false;
    const l = v.toLowerCase();
    for (const a of AVOID) if (l.indexOf(a) >= 0) return false;
    if (!WORDS.some(function (w) { return l.indexOf(w) >= 0; })) return false;
    let sons = 0, i = 0;
    while ((i = l.indexOf('son of', i)) >= 0) { sons++; i += 6; }
    return sons < 2;
  }

  function dayOfYear(d) {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - jan1) / 86400000) + 1;
  }

  const FALLBACK = { book: 18, chapter: 46, verse: 10, text: 'Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.' };

  /** One verse per day, the same one the phone shows. */
  function verseOfDay(bible, now) {
    if (!bible) return FALLBACK;
    const d = new Date(now);
    const seed = BigInt(d.getFullYear() * 1000 + dayOfYear(d));
    const r = new JavaRandom(seed * 2654435761n);
    const books = bible.books, text = bible.text;
    for (let tries = 0; tries < 2000; tries++) {
      const b = r.nextInt(books.length);
      const ch = 1 + r.nextInt(text[b].length);
      const vs = text[b][ch - 1];
      const v = 1 + r.nextInt(vs.length);
      if (goodVerse(books[b], ch, vs[v - 1])) return { book: b, chapter: ch, verse: v, text: vs[v - 1] };
    }
    return { book: 18, chapter: 46, verse: 10, text: text[18][45][9] };
  }

  function isLetter(c) { return /\p{L}/u.test(c); }

  /** Every verse that contains the word or phrase, up to max. Single words match whole words only. */
  function search(bible, q, max) {
    const out = [];
    if (!bible || !q) return out;
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return out;
    const word = needle.indexOf(' ') < 0;
    for (let b = 0; b < bible.text.length; b++) {
      const chs = bible.text[b];
      for (let ch = 0; ch < chs.length; ch++) {
        const vs = chs[ch];
        for (let v = 0; v < vs.length; v++) {
          const l = vs[v].toLowerCase();
          let i = l.indexOf(needle);
          while (i >= 0) {
            let ok = true;
            if (word) {
              const before = i > 0 ? l.charAt(i - 1) : ' ';
              const end = i + needle.length;
              const after = end < l.length ? l.charAt(end) : ' ';
              ok = !isLetter(before) && !isLetter(after);
            }
            if (ok) { out.push({ book: b, chapter: ch + 1, verse: v + 1, text: vs[v] }); break; }
            i = l.indexOf(needle, i + 1);
          }
          if (out.length >= max) return out;
        }
      }
    }
    return out;
  }

  function label(bible, ref) { return ((bible && bible.books[ref.book]) || 'Psalms') + ' ' + ref.chapter + ':' + ref.verse; }

  const api = { parse: parse, verseOfDay: verseOfDay, search: search, label: label, JavaRandom: JavaRandom, goodVerse: goodVerse, FALLBACK: FALLBACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusBible = api;
})(this);
