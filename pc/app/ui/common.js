// Shared bits for every Focus window: the dial, the sky's dust, small helpers.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /**
   * The dial: 60 ticks for what's left of the block, an outer 24-hour ring with a dot per block,
   * and a star at the current time. Ice blue normally, gold for Time with God.
   */
  function Dial(host, opts) {
    opts = opts || {};
    const box = 300;
    const k = opts.weight || (opts.mini ? 2.3 : 1); // small dials need heavier ticks to read
    const root = svg('svg', { viewBox: opts.mini ? '34 34 232 232' : '-20 -20 340 340', class: 'dial', 'aria-hidden': 'true' }, host);
    const cons = svg('g', {}, root);
    svg('circle', { cx: 150, cy: 150, r: 136, fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 2 }, cons);
    const dots = svg('g', {}, cons);
    const star = svg('image', { width: 84, height: 84, class: 'nowstar' }, cons);
    const leaf = svg('g', { class: 'nowleaf' }, cons);
    const leafGlow = svg('circle', { r: 13, class: 'leafglow' }, leaf);
    const leafBody = svg('path', { d: 'M0 -11 C7 -6 8 3 0 11 C-8 3 -7 -6 0 -11 Z' }, leaf);
    svg('path', { d: 'M0 -9 L0 13', stroke: 'rgba(40,18,6,0.55)', 'stroke-width': 1.2, fill: 'none' }, leaf);
    leaf.style.display = 'none';
    const inner = svg('circle', { cx: 150, cy: 150, r: 117, fill: 'none', 'stroke-width': 1 }, root);
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (i / 60) * 2 * Math.PI, big = i % 5 === 0, c = Math.cos(a), s = Math.sin(a);
      const r1 = opts.mini ? (big ? 88 : 93) : (big ? 94 : 97), r2 = 112;
      const l = svg('line', { x1: (150 + r1 * c).toFixed(1), y1: (150 + r1 * s).toFixed(1), x2: (150 + r2 * c).toFixed(1), y2: (150 + r2 * s).toFixed(1), 'stroke-width': (big ? 3 : 2) * k, class: 'tk' }, root);
      l.style.setProperty('--i', i);
      ticks.push({ el: l, big: big });
    }
    const halo = svg('circle', { r: 8 * k, class: 'halo' }, root);
    const tip = svg('circle', { r: 3 * k, class: 'halo' }, root);
    if (opts.constellation === false || opts.mini) cons.style.display = 'none';

    let gold = !!opts.gold, frac = 1, shown = -1, raf = 0;

    function colors() {
      return gold
        ? { lit: '#F2D38A', dim: 'rgba(242,211,138,0.14)', big: 'rgba(242,211,138,0.40)', ring: 'rgba(242,211,138,0.07)', halo: 'rgba(247,226,174,0.25)', tip: '#FFF8E6' }
        : document.body.classList.contains('theme-fall')
          ? fallColors()
          : { lit: '#AACFF6', dim: 'rgba(170,207,246,0.14)', big: 'rgba(170,207,246,0.25)', ring: 'rgba(170,207,246,0.07)', halo: 'rgba(207,224,250,0.22)', tip: '#F3F8FF' };
    }

    // Fall follows the photo's own accent colour (set on the page as --ice-rgb)
    function fallColors() {
      const cs = getComputedStyle(document.body);
      const a = (cs.getPropertyValue('--ice-rgb') || '240, 178, 122').trim(), sft = (cs.getPropertyValue('--ice-soft-rgb') || '248, 217, 184').trim();
      return { lit: 'rgb(' + a + ')', dim: 'rgba(' + a + ',0.16)', big: 'rgba(' + a + ',0.32)', ring: 'rgba(' + a + ',0.08)', halo: 'rgba(' + sft + ',0.26)', tip: '#FFF6EA' };
    }
    function fall() { return document.body.classList.contains('theme-fall'); }

    function paint(f) {
      const col = colors();
      const lit = Math.round(f * 60);
      inner.setAttribute('stroke', col.ring);
      root.classList.toggle('gold', gold);
      for (let i = 0; i < 60; i++) {
        const on = i < lit;
        const t = ticks[i];
        t.el.setAttribute('stroke', on ? col.lit : (t.big ? col.big : col.dim));
        t.el.classList.toggle('on', on);
        t.el.classList.toggle('glint', on && gold && opts.glint !== false);
      }
      if (lit > 0 && lit < 60) {
        const a = -Math.PI / 2 + (lit / 60) * 2 * Math.PI;
        const x = (150 + 104 * Math.cos(a)).toFixed(1), y = (150 + 104 * Math.sin(a)).toFixed(1);
        halo.setAttribute('cx', x); halo.setAttribute('cy', y); halo.setAttribute('fill', col.halo); halo.style.opacity = 1;
        tip.setAttribute('cx', x); tip.setAttribute('cy', y); tip.setAttribute('fill', col.tip); tip.style.opacity = 1;
      } else { halo.style.opacity = 0; tip.style.opacity = 0; }
    }

    /** Sets the lit fraction; animate sweeps the ticks on one by one, like the phone. */
    function set(f, animate) {
      frac = Math.max(0, Math.min(1, f));
      cancelAnimationFrame(raf);
      if (!animate || reduced) { shown = frac; paint(frac); return; }
      const t0 = performance.now() + 160, dur = 1000;
      paint(0);
      const step = function (t) {
        const p = Math.max(0, Math.min(1, (t - t0) / dur));
        const e = 1 - Math.pow(1 - p, 3.2); // DecelerateInterpolator(1.6)
        shown = frac * e;
        paint(shown);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function setStars(hours, nowHour) {
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      (hours || []).forEach(function (h) {
        const th = (h / 24) * 2 * Math.PI - Math.PI / 2;
        svg('circle', { cx: (150 + 136 * Math.cos(th)).toFixed(1), cy: (150 + 136 * Math.sin(th)).toFixed(1), r: 3,
          fill: fall() ? 'rgb(18,11,6)' : '#0B1020', stroke: fall() ? 'rgb(' + (getComputedStyle(document.body).getPropertyValue('--rust-rgb').trim() || '196, 98, 52') + ')' : '#6E9BE0',
          'stroke-opacity': fall() ? 0.75 : 0.6, 'stroke-width': 1.5 }, dots);
      });
      leaf.style.display = 'none';
      if (nowHour >= 0 && fall() && !gold) {
        // in Fall the "now" marker is a little leaf in the photo's colour, with a soft glow
        const th = (nowHour / 24) * 2 * Math.PI - Math.PI / 2, x = 150 + 136 * Math.cos(th), y = 150 + 136 * Math.sin(th);
        leaf.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + ((nowHour / 24) * 360 - 30).toFixed(0) + ') scale(1.35)');
        const c = fallColors();
        leafGlow.setAttribute('fill', c.dim); leafBody.setAttribute('fill', c.lit);
        leaf.style.display = '';
        star.style.display = 'none';
      } else if (nowHour >= 0) {
        const th = (nowHour / 24) * 2 * Math.PI - Math.PI / 2;
        const s = gold ? 96 : 84;
        star.setAttribute('href', gold ? '../res/img/star_gold.png' : '../res/img/star_blue.png');
        star.setAttribute('width', s); star.setAttribute('height', s);
        star.setAttribute('x', (150 + 136 * Math.cos(th) - s / 2).toFixed(1));
        star.setAttribute('y', (150 + 136 * Math.sin(th) - s / 2).toFixed(1));
        star.style.display = '';
      } else star.style.display = 'none';
    }

    function setGold(g) { if (gold !== !!g) { gold = !!g; paint(shown < 0 ? frac : shown); } }

    paint(0);
    let starsArgs = null;
    function refresh() { paint(shown < 0 ? frac : shown); if (starsArgs) setStars(starsArgs[0], starsArgs[1]); }

    return { el: root, set: set, setStars: function (h, n) { starsArgs = [h, n]; setStars(h, n); }, setGold: setGold, refresh: refresh, get gold() { return gold; } };
  }

  /** Little twinkling stars over the sky picture. */
  function dust(host, count, seed) {
    seed = seed || 13;
    const rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let d = 0; d < count; d++) {
      const sz = 1 + rand() * 1.4, o = (0.12 + rand() * 0.35).toFixed(2);
      const sp = document.createElement('span');
      sp.className = 'dust';
      sp.style.cssText = 'left:' + (rand() * 100).toFixed(2) + '%;top:' + (rand() * 100).toFixed(2) + '%;width:' + sz.toFixed(1) + 'px;height:' + sz.toFixed(1) +
        'px;opacity:' + o + ';--o:' + o + ';--t:' + (3 + (d % 4)) + 's;--dl:' + (-(d * 0.5)).toFixed(1) + 's';
      host.appendChild(sp);
    }
  }

  /** Replays the stagger on a container's .it children. */
  function stagger(container) {
    if (!container) return;
    const items = container.querySelectorAll('.it');
    items.forEach(function (it) { it.classList.remove('in'); });
    void container.offsetWidth;
    items.forEach(function (it) { it.classList.add('in'); });
  }

  function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

  window.FocusUI = { el: el, svg: svg, Dial: Dial, dust: dust, stagger: stagger, reduced: reduced, wordCount: wordCount };
})();
