'use strict';
// The encrypted link to the phone over ntfy.sh (PROTOCOL.md). ntfy only ever sees ciphertext.
const EventEmitter = require('events');
const fc = require('./crypto');

// FOCUS_RELAY exists only so the end-to-end test can use a local fake relay.
const RELAY = process.env.FOCUS_RELAY || 'https://ntfy.sh/';
const MAX_PLAIN = 2900;

class Link extends EventEmitter {
  /**
   * opts.fetch: a fetch() that can stream (Electron's net.fetch on Windows).
   * opts.getLastId / opts.setLastId: remember the last ntfy message id so we resume where we left off.
   * opts.log: function(msg)
   */
  constructor(opts) {
    super();
    this.fetch = opts.fetch;
    this.getLastId = opts.getLastId || function () { return ''; };
    this.setLastId = opts.setLastId || function () { };
    this.log = opts.log || function () { };
    this.code = '';
    this.key = null;
    this.topic = '';
    this.gen = 0;
    this.abort = null;
    this.status = 'off';      // off | connecting | live | waiting
    this.lastHeard = 0;       // any line from ntfy (keepalives too)
    this.lastMessage = 0;     // last envelope from the phone
    this.seen = [];
  }

  start(code) {
    this.stop();
    const c = fc.normalizeCode(code);
    if (c.length !== 16) return;
    this.code = c;
    this.key = fc.deriveKey(c);
    this.topic = fc.deriveTopic(c);
    const gen = ++this.gen;
    this._loop(gen).catch((e) => this.log('link loop ended: ' + (e && e.message)));
  }

  stop() {
    this.gen++;
    if (this.abort) { try { this.abort.abort(); } catch (e) { } }
    this.abort = null;
    this._setStatus('off');
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  async _loop(gen) {
    let backoff = 2000;
    while (gen === this.gen) {
      const ac = new AbortController();
      this.abort = ac;
      let watchdog = null;
      try {
        this._setStatus('connecting');
        const since = this.getLastId() || '10m';
        const res = await this.fetch(RELAY + this.topic + '/json?since=' + encodeURIComponent(since), { signal: ac.signal, headers: { 'Cache-Control': 'no-cache' } });
        if (!res.ok || !res.body) throw new Error('subscribe HTTP ' + res.status);
        if (gen !== this.gen) { ac.abort(); return; }
        this._setStatus('live');
        this.lastHeard = Date.now();
        backoff = 2000;
        // ntfy sends a keepalive every ~45 s; if nothing arrives for 100 s the stream is dead.
        watchdog = setInterval(() => { if (Date.now() - this.lastHeard > 100000) { try { ac.abort(); } catch (e) { } } }, 10000);
        this.send('hello', {}).catch(() => { });
        this.emit('connected');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          this.lastHeard = Date.now();
          buf += dec.decode(r.value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) this._line(line);
          }
          if (gen !== this.gen) break;
        }
      } catch (e) {
        if (gen !== this.gen) return;
        this.log('link: ' + (e && e.message ? e.message : e));
      } finally {
        if (watchdog) clearInterval(watchdog);
      }
      if (gen !== this.gen) return;
      this._setStatus('waiting');
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(60000, backoff * 2);
    }
  }

  _line(line) {
    let ev;
    try { ev = JSON.parse(line); } catch (e) { return; }
    if (!ev || ev.event !== 'message') return;
    if (ev.id) this.setLastId(String(ev.id));
    let env;
    try { env = JSON.parse(fc.decrypt(this.key, ev.message || '')); } catch (e) { return; } // not ours
    this.handleEnvelope(env);
  }

  /** Exposed for tests. */
  handleEnvelope(env) {
    if (!env || typeof env !== 'object' || env.from === 'pc' || typeof env.t !== 'string') return;
    if (env.id) {
      if (this.seen.indexOf(env.id) >= 0) return;
      this.seen.push(env.id);
      if (this.seen.length > 300) this.seen.splice(0, 100);
    }
    this.lastMessage = Date.now();
    this.emit('message', env);
  }

  envelope(type, fields) {
    const env = { v: 1, from: 'pc', id: fc.newId(), at: Date.now(), t: type };
    for (const k in fields) env[k] = fields[k];
    return env;
  }

  /** Encrypts and publishes. Resolves true when ntfy accepted it. */
  async send(type, fields) {
    if (!this.key) return false;
    const env = this.envelope(type, fields || {});
    let plain = JSON.stringify(env);
    if (type === 'clip' && Buffer.byteLength(plain, 'utf8') > MAX_PLAIN) {
      plain = JSON.stringify(fitText(env, 'text'));
    }
    if (Buffer.byteLength(plain, 'utf8') > MAX_PLAIN) { this.log('link: ' + type + ' too big to send'); return false; }
    const wire = fc.encrypt(this.key, plain);
    try {
      const res = await this.fetch(RELAY + this.topic, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: wire });
      return res.ok;
    } catch (e) {
      this.log('link send failed: ' + (e && e.message));
      return false;
    }
  }
}

/** Shortens env[field] until the whole envelope fits the relay's size limit. */
function fitText(env, field) {
  const e = Object.assign({}, env);
  let text = String(e[field] || '');
  if (text.length > 2000) text = text.slice(0, 2000);
  e[field] = text;
  while (Buffer.byteLength(JSON.stringify(e), 'utf8') > MAX_PLAIN && text.length > 0) {
    text = text.slice(0, Math.floor(text.length * 0.9));
    // never cut a surrogate pair in half
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    e[field] = text;
  }
  return e;
}

module.exports = { Link, fitText, RELAY, MAX_PLAIN };
