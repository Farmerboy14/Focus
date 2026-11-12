// The Fall theme's colours come from your photo: a strong gold picture gives a gold accent, a red one a red accent,
// and a grey picture falls back to the default amber.
const assert = require('assert');
const P = require('../app/ui/palette');

function img(fill) {
  const w = 40, h = 30, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fill(x / w, y / h), i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
}
const hue = function (c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

// a gold tree over brown leaves, with some red bushes
const fall = P.pick(img(function (x, y) { return y < 0.5 ? [242, 166, 32] : x > 0.75 ? [190, 60, 30] : [110, 80, 55]; }));
assert(hue(fall.accent) > 28 && hue(fall.accent) < 48, 'gold accent, got hue ' + hue(fall.accent));
assert(hue(fall.rust) < 20 || hue(fall.rust) > 340, 'rust second colour, got hue ' + hue(fall.rust));
assert(fall.leaves.length >= 4 && fall.leaves.every(function (h) { return /^#[0-9a-f]{6}$/i.test(h); }), 'leaf colours');
assert(fall.tint.every(function (v) { return v < 30; }), 'tint stays dark for the glass behind the schedule');
// the accent is readable as text on the dark glass
const lum = (fall.accent[0] * 0.2126 + fall.accent[1] * 0.7152 + fall.accent[2] * 0.0722) / 255;
assert(lum > 0.5, 'accent bright enough to read');

// a grey, washed-out picture: keep the default amber
const grey = P.pick(img(function () { return [128, 128, 130]; }));
assert.deepStrictEqual(grey.accent, P.DEFAULT.accent);

// empty data never throws
assert.deepStrictEqual(P.pick(new Uint8Array(0)), P.DEFAULT);
console.log('palette ok');
