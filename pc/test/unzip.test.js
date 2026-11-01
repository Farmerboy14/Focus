'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, run } = require('./harness');
const unzip = require('../app/lib/unzip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-unzip-'));

test('extracts deflated and stored files from a real zip', () => {
  const src = path.join(tmp, 'src');
  fs.mkdirSync(path.join(src, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(src, 'main.js'), 'console.log(1);\n'.repeat(500));
  fs.writeFileSync(path.join(src, 'ui', 'a.txt'), 'héllo ✓');
  fs.writeFileSync(path.join(src, 'empty.txt'), '');
  execFileSync('zip', ['-qrX', path.join(tmp, 'a.zip'), '.'], { cwd: src });
  execFileSync('zip', ['-q0X', path.join(tmp, 'stored.zip'), 'ui/a.txt'], { cwd: src });
  const out = path.join(tmp, 'out');
  unzip.extract(fs.readFileSync(path.join(tmp, 'a.zip')), out);
  assert.strictEqual(fs.readFileSync(path.join(out, 'main.js'), 'utf8'), 'console.log(1);\n'.repeat(500));
  assert.strictEqual(fs.readFileSync(path.join(out, 'ui', 'a.txt'), 'utf8'), 'héllo ✓');
  assert.strictEqual(fs.readFileSync(path.join(out, 'empty.txt'), 'utf8'), '');
  const out2 = path.join(tmp, 'out2');
  unzip.extract(fs.readFileSync(path.join(tmp, 'stored.zip')), out2);
  assert.strictEqual(fs.readFileSync(path.join(out2, 'ui', 'a.txt'), 'utf8'), 'héllo ✓');
});

test('refuses paths that escape the folder', () => {
  const d = path.join(tmp, 'evil');
  fs.mkdirSync(path.join(d, 'x'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bad.txt'), 'bad');
  execFileSync('zip', ['-q', path.join(tmp, 'evil.zip'), '../bad.txt'], { cwd: path.join(d, 'x') });
  assert.throws(() => unzip.extract(fs.readFileSync(path.join(tmp, 'evil.zip')), path.join(tmp, 'evilout')), /unsafe/);
});

test('rejects garbage', () => {
  assert.throws(() => unzip.extract(Buffer.from('not a zip at all, sorry'), path.join(tmp, 'g')));
});

run('unzip');
