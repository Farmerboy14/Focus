'use strict';
// The localhost-only endpoint the browser extension talks to. Web pages can't use it:
// requests must come from an extension (or no) origin and carry a JSON body or the X-Focus header.
const http = require('http');

const PORT = 47613;

function startServer(h, log) {
  let server = null;
  let retry = null;

  function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  function allowed(req) {
    const host = String(req.headers.host || '');
    if (host !== '127.0.0.1:' + PORT && host !== 'localhost:' + PORT) return false; // no DNS rebinding
    const origin = req.headers.origin;
    if (origin && !/^(chrome-extension|moz-extension|extension):\/\//.test(origin)) return false;
    if (req.method !== 'GET' && req.headers['x-focus'] !== '1') return false; // forces a CORS preflight from pages, which we never answer
    return true;
  }

  function onRequest(req, res) {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(403); return res.end(); }
      if (!allowed(req)) return send(res, 403, { error: 'forbidden' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/policy') return send(res, 200, h.policy());
      if (req.method === 'GET' && url.pathname === '/ping') return send(res, 200, { ok: true, app: 'focus' });
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      let body = '';
      req.setEncoding('utf8');
      req.on('data', function (c) { body += c; if (body.length > 20000) req.destroy(); });
      req.on('end', function () {
        let o = {};
        try { o = body ? JSON.parse(body) : {}; } catch (e) { return send(res, 400, { error: 'bad json' }); }
        Promise.resolve().then(function () {
          if (url.pathname === '/youtube') return h.youtube(Number(o.seconds) || 0);
          if (url.pathname === '/send') return h.sendPage(String(o.url || ''), String(o.title || ''));
          if (url.pathname === '/show') return h.show(String(o.view || 'home'));
          throw Object.assign(new Error('not found'), { code: 404 });
        }).then(function (r) { send(res, 200, r === undefined ? { ok: true } : r); },
          function (e) { send(res, e.code === 404 ? 404 : 500, { error: e.message }); });
      });
    } catch (e) {
      log('server: ' + e.message);
      try { send(res, 500, { error: 'server error' }); } catch (e2) { }
    }
  }

  function listen() {
    try {
      server = http.createServer(onRequest);
      server.on('error', function (e) {
        log('server: ' + e.message + ' (will retry)');
        try { server.close(); } catch (e2) { }
        clearTimeout(retry);
        retry = setTimeout(listen, 15000);
      });
      server.listen(PORT, '127.0.0.1');
    } catch (e) {
      log('server: ' + e.message);
      retry = setTimeout(listen, 15000);
    }
  }
  listen();
  return { close: function () { clearTimeout(retry); try { server.close(); } catch (e) { } } };
}

module.exports = { startServer, PORT };
