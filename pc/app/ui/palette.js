// Colours taken from your Fall photo, so the clock, card, dial and leaves match the picture.
// pick() is pure (RGBA bytes in, colours out) so it can be tested in Node; fromImage() samples a loaded <img>.
(function (root) {
  'use strict';

  function hsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
  }

  function toHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    }
    return [(h * 60 + 360) % 360, s, l];
  }

  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const k = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return k.map(function (v) { return Math.round((v + m) * 255); });
  }

  const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  const hueGap = function (a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const hex = function (c) { return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); };

  // what Fall used before there was a photo to learn from
  const DEFAULT = { accent: [240, 178, 122], soft: [248, 217, 184], rust: [196, 98, 52], tint: [16, 10, 6],
    leaves: ['#D9822B', '#B5491E', '#E8B04A', '#8C4A22', '#C86A2C', '#A23B18'] };

  /** RGBA bytes → { accent, soft, rust, tint (rgb arrays), leaves (hex) }. */
  // Hue histogram: each pixel votes for its hue, weighted so vivid, bright colours count far more than browns.
  function histogram(data, minS, minV, ps, pv) {
    const BINS = 24, w = new Float64Array(BINS), sum = [];
    for (let i = 0; i < BINS; i++) sum.push([0, 0, 0]);
    for (let i = 0; i + 3 < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], c = hsv(r, g, b);
      if (c[1] < minS || c[2] < minV) continue;
      const k = Math.floor(c[0] / (360 / BINS)) % BINS, wt = Math.pow(c[1], ps) * Math.pow(c[2], pv);
      w[k] += wt; sum[k][0] += r * wt; sum[k][1] += g * wt; sum[k][2] += b * wt;
    }
    const bins = [];
    for (let k = 0; k < BINS; k++) if (w[k] > 0) bins.push({ w: w[k], c: [sum[k][0] / w[k], sum[k][1] / w[k], sum[k][2] / w[k]] });
    return bins.sort(function (a, b) { return b.w - a.w; });
  }

  /** RGBA bytes → { accent, soft, rust, tint (rgb arrays), leaves (hex) }. */
  function pick(data) {
    const n = Math.floor(data.length / 4);
    if (!n) return DEFAULT;
    const all = [0, 0, 0];
    for (let i = 0; i + 3 < data.length; i += 4) { all[0] += data[i]; all[1] += data[i + 1]; all[2] += data[i + 2]; }
    const avg = toHsl(all.map(function (v) { return v / n; }));
    const tint = fromHsl(avg[0], Math.min(avg[1], 0.45), 0.045);
    const bins = histogram(data, 0.5, 0.45, 2, 3);          // the picture's brightest, boldest colour
    if (!bins.length || bins[0].w < n * 0.01) return Object.assign({}, DEFAULT, { tint: tint });

    const top = toHsl(bins[0].c);
    const accent = fromHsl(top[0], clamp(top[1], 0.7, 0.9), clamp(top[2], 0.6, 0.66));
    const soft = fromHsl(top[0], clamp(top[1], 0.55, 0.8), 0.87);
    let second = null;
    for (let i = 1; i < bins.length && !second; i++) {
      const h = toHsl(bins[i].c);
      if (hueGap(h[0], top[0]) >= 18 && bins[i].w >= bins[0].w * 0.08) second = h;
    }
    const rust = second ? fromHsl(second[0], clamp(second[1], 0.55, 0.8), clamp(second[2], 0.48, 0.58))
      : fromHsl((top[0] + 342) % 360, clamp(top[1], 0.6, 0.8), 0.5);
    // leaves: the photo's own fall colours, kept leaf-dark enough to show up over the picture
    const leaves = [];
    histogram(data, 0.4, 0.3, 1, 1).slice(0, 8).forEach(function (b, i, arr) {
      if (leaves.length >= 6 || b.w < arr[0].w * 0.04) return;
      const h = toHsl(b.c);
      if (h[0] > 75 && h[0] < 330) return;                  // only reds, oranges and golds fall as leaves
      leaves.push(hex(fromHsl(h[0], clamp(h[1], 0.6, 0.88), clamp(h[2], 0.44, 0.58))));
      if (h[2] < 0.5) leaves.push(hex(fromHsl(h[0], clamp(h[1], 0.65, 0.9), 0.6)));
    });
    while (leaves.length < 4) leaves.push(DEFAULT.leaves[leaves.length]);
    return { accent: accent, soft: soft, rust: rust, tint: tint, leaves: leaves.slice(0, 6) };
  }

  /** Samples a decoded image (small and quick) and returns pick()'s colours. */
  function fromImage(img) {
    const c = document.createElement('canvas');
    const k = 96 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    return pick(g.getImageData(0, 0, c.width, c.height).data);
  }

  /** Puts the colours on the page as CSS variables. */
  function apply(p, el) {
    const s = (el || document.body).style, j = function (c) { return c.join(', '); };
    s.setProperty('--ice-rgb', j(p.accent)); s.setProperty('--ice', hex(p.accent));
    s.setProperty('--ice-soft-rgb', j(p.soft)); s.setProperty('--ice-soft', hex(p.soft));
    s.setProperty('--rust-rgb', j(p.rust)); s.setProperty('--tint-rgb', j(p.tint));
  }
  function clear(el) {
    const s = (el || document.body).style;
    ['--ice-rgb', '--ice', '--ice-soft-rgb', '--ice-soft', '--rust-rgb', '--tint-rgb'].forEach(function (k) { s.removeProperty(k); });
  }

  const api = { pick: pick, fromImage: fromImage, apply: apply, clear: clear, DEFAULT: DEFAULT, hex: hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusPalette = api;
})(this);
