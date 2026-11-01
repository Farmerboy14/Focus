'use strict';
// A tiny stand-in for ntfy.sh (publish + streaming JSON subscribe), for the end-to-end test.
const http = require('http');
function start(port) {
  const topics = {};
  let n = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);
    const t = topics[parts[0]] = topics[parts[0]] || { msgs: [], subs: [] };
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const m = { id: 'id' + (++n), time: Math.floor(Date.now() / 1000), event: 'message', topic: parts[0], message: body };
        t.msgs.push(m);
        t.subs.forEach((s) => s.write(JSON.stringify(m) + '\n'));
        res.end(JSON.stringify(m));
      });
      return;
    }
    if (req.method === 'GET' && parts[1] === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ id: 'open' + n, event: 'open', topic: parts[0] }) + '\n');
      const since = u.searchParams.get('since') || '';
      const idx = t.msgs.findIndex((m) => m.id === since);
      (idx >= 0 ? t.msgs.slice(idx + 1) : since === '10m' ? t.msgs : []).forEach((m) => res.write(JSON.stringify(m) + '\n'));
      t.subs.push(res);
      req.on('close', () => { t.subs = t.subs.filter((s) => s !== res); });
      return;
    }
    res.writeHead(404); res.end();
  });
  srv.listen(port, '127.0.0.1');
  return srv;
}
module.exports = { start };
