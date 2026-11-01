'use strict';
// Appends to %APPDATA%/Focus/log.txt, and keeps the file small.
const fs = require('fs');
const path = require('path');

function makeLog(dir) {
  const file = path.join(dir, 'log.txt');
  let checked = false;
  return function log(msg) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!checked) {
        checked = true;
        try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.old'); } catch (e) { }
      }
      fs.appendFileSync(file, new Date().toISOString() + '  ' + String(msg) + '\r\n');
    } catch (e) { /* logging must never crash the app */ }
  };
}

module.exports = { makeLog };
