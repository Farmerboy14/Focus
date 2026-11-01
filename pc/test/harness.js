'use strict';
// A tiny test runner: test(name, fn) and run().
const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
async function run(file) {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
  }
  console.log((failed ? 'FAILED ' : 'passed ') + (tests.length - failed) + '/' + tests.length + '  ' + file);
  process.exitCode = failed ? 1 : 0;
}
module.exports = { test, run };
