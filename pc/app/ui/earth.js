// The Earth in space, the way it is right now, filling the whole desktop.
// A camera floats a few Earth-widths out; drag to fly it around the planet. Behind the Earth: the real sky —
// the Milky Way, the naked-eye stars where they really are, the Sun, the Moon in its true phase, and the
// planets in their true places (drawn larger than life so you can find them). On the Earth: day and night,
// city lights, sun glint on the oceans, and clouds with their shadows.
// Drawn with WebGL in four passes: sky, stars, Moon and planets, then the Earth and its atmosphere over them.
// NASA Blue Marble (day) and Black Marble (night), public domain. Stars: HYG database, CC BY-SA 4.0.
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  const DIST = 3.6;            // the camera's distance from the Earth's centre, in Earth radii
  const SKY_SCALE = 1.15;      // the sky's fisheye: pixels per radian, in Earth radii on screen (the Earth hides ~50° of sky)

  function skyModule() {
    if (root && root.FocusSky) return root.FocusSky;
    try { return typeof require === 'function' ? require('./sky') : null; } catch (e) { return null; }
  }

  /** Where the sun is overhead right now: subsolar latitude and longitude in degrees, and the equation of time in minutes. */
  function subsolar(ms) {
    const K = skyModule();
    if (K) {
      const s = K.at(ms), sun = s.bodies[0];
      const lon = ((sun.ra - s.gmst) % 360 + 540) % 360 - 180;
      const d = new Date(ms);
      const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
      let eot = (12 - utcH - lon / 15) * 60;
      eot = ((eot + 720) % 1440 + 1440) % 1440 - 720;
      return { lat: sun.dec, lon: lon, eot: eot };
    }
    return roughSubsolar(ms);
  }

  /** The same from a short formula, good to about a degree (used if the sky module isn't loaded). */
  function roughSubsolar(ms) {
    const d = new Date(ms);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const n = (ms - start) / 86400000;
    const b = 2 * Math.PI * (n - 81) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const decl = -23.44 * Math.cos(2 * Math.PI * (n + 10) / 365);
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    let lon = -15 * (utcH - 12 + eot / 60);
    lon = ((lon + 540) % 360) - 180;
    return { lat: decl, lon: lon, eot: eot };
  }

  /** Today's sunrise and sunset at a place, as epoch ms (null when the sun doesn't rise or set). */
  function sunTimes(ms, lat, lon) {
    const d = new Date(ms);
    const noonUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const s = subsolar(noonUtc);
    const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(s.lat * RAD)) / (Math.cos(lat * RAD) * Math.cos(s.lat * RAD));
    if (cosH < -1 || cosH > 1) return { rise: null, set: null };
    const h = Math.acos(cosH) / RAD / 15;
    const solarNoonUtcH = 12 - lon / 15 - s.eot / 60;
    const day0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const noon = day0 + solarNoonUtcH * 3600000;
    return { rise: noon - h * 3600000, set: noon + h * 3600000 };
  }

  function unit(lat, lon) {
    const a = lat * RAD, o = lon * RAD;
    return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
  }

  // ---------- 3x3 matrices, row-major arrays of rows ----------
  function mul(a, b) {
    const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    return o;
  }
  function tr(a) { return [[a[0][0], a[1][0], a[2][0]], [a[0][1], a[1][1], a[2][1]], [a[0][2], a[1][2], a[2][2]]]; }
  function app(m, v) { return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]; }
  function gl3(m) { return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]); }
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  /** Turning about the north pole by an angle, in the same sense as adding to longitude. */
  function turn(deg) { const t = deg * RAD, c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }

  // ---------- shaders ----------
  const QUAD_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const RAY = [
    'uniform vec2 uC; uniform float uF;',
    'vec3 rayDir(){ return normalize(vec3((gl_FragCoord.xy - uC) / uF, -1.0)); }'
  ].join('\n');
  // The sky is drawn wider than the camera that sees the Earth (a fisheye: distance from the Earth's centre on
  // screen is the angle from straight behind it), so a good half of the heavens is in view at once.
  const FISH = [
    'uniform vec2 uC; uniform float uFs;',
    'vec3 skyDir(){',
    '  vec2 q = (gl_FragCoord.xy - uC) / uFs;',
    '  float rho = min(length(q), 3.14159);',
    '  if (rho < 1e-5) return vec3(0.0, 0.0, -1.0);',
    '  return vec3(normalize(q) * sin(rho), -cos(rho));',
    '}'
  ].join('\n');

  const SKY_FS = [
    'precision highp float;', FISH,
    'uniform mat3 uV2C; uniform vec3 uSunC; uniform sampler2D uMilky; uniform float uGain;',
    'const float PI = 3.14159265;',
    'void main(){',
    '  vec3 c = uV2C * skyDir();',
    '  float u = atan(c.x, c.z) / (2.0 * PI);',
    '#ifdef SEAMFIX',
    '  float u1 = fract(u), u2 = fract(u + 0.5) - 0.5;',
    '  u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2;',
    '#endif',
    '  vec2 t = vec2(u, 0.5 - asin(clamp(c.y, -1.0, 1.0)) / PI);',
    '  float rho = length(gl_FragCoord.xy - uC) / uFs;',
    '  vec3 col = texture2D(uMilky, t).rgb * uGain * smoothstep(2.25, 1.75, rho);',
    '  col += vec3(0.010, 0.013, 0.024);',
    '  float s = max(dot(c, uSunC), 0.0);',
    '  float ang = acos(min(s, 1.0));',
    // the Sun: a white-hot disc, a tight corona and a wide soft glow
    '  col += vec3(1.0, 0.97, 0.9) * smoothstep(0.019, 0.015, ang) * 3.0;',
    '  col += vec3(1.0, 0.86, 0.62) * exp(-ang * 40.0) * 0.9;',
    '  col += vec3(1.0, 0.78, 0.5) * exp(-ang * 5.0) * 0.16;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  const STAR_VS = [
    'attribute vec3 aDir; attribute vec3 aInfo;',            // info: magnitude, B-V colour, a random seed
    'uniform mat3 uC2V; uniform vec2 uC; uniform float uFs; uniform vec2 uRes; uniform float uTime; uniform float uScale;',
    'varying vec3 vCol; varying float vSize;',
    'void main(){',
    '  vec3 v = uC2V * aDir;',
    '  float th = acos(clamp(-v.z, -1.0, 1.0));',
    '  if (th > 3.1 || length(v.xy) < 1e-6) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); gl_PointSize = 1.0; vCol = vec3(0.0); vSize = 1.0; return; }',
    '  vec2 p = uC + uFs * th * normalize(v.xy);',
    '  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);',
    '  float mag = aInfo.x;',
    '  float bright = clamp(pow(2.512, (3.2 - mag) * 0.62), 0.07, 2.6);',
    '  float tw = 0.74 + 0.26 * sin(uTime * (0.9 + 2.6 * aInfo.z) + aInfo.z * 61.0);',
    '  tw = mix(1.0, tw, clamp((mag + 0.5) / 4.0, 0.25, 1.0));',
    '  float k = clamp((aInfo.y + 0.3) / 2.0, 0.0, 1.0);',
    '  vec3 col = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.95, 0.86), smoothstep(0.0, 0.35, k));',
    '  col = mix(col, vec3(1.0, 0.74, 0.50), smoothstep(0.45, 0.9, k));',
    '  vCol = col * bright * tw;',
    '  vSize = clamp(9.0 - mag * 1.6, 3.0, 13.0) * uScale;',
    '  gl_PointSize = vSize;',
    '}'
  ].join('\n');

  const STAR_FS = [
    'precision highp float;',
    'varying vec3 vCol; varying float vSize; uniform float uScale;',
    'void main(){',
    '  vec2 q = (gl_PointCoord - 0.5) * vSize;',             // in pixels from the centre
    '  float r2 = dot(q, q);',
    '  float core = exp(-r2 / (0.85 * uScale * uScale));',
    '  float halo = exp(-sqrt(r2) / (0.16 * vSize)) * 0.18;',
    '  float big = smoothstep(7.0, 12.0, vSize / uScale);',
    '  float spike = (exp(-abs(q.x) / (0.55 * uScale)) * exp(-abs(q.y) / (0.22 * vSize)) + exp(-abs(q.y) / (0.55 * uScale)) * exp(-abs(q.x) / (0.22 * vSize))) * 0.32 * big;',
    '  gl_FragColor = vec4(vCol * (core + halo + spike), 0.0);',
    '}'
  ].join('\n');

  const BODY_VS = [
    'attribute vec2 p;',
    'uniform vec2 uPos; uniform float uExt; uniform vec2 uRes;',
    'varying vec2 vQ;',
    'void main(){ vQ = p * uExt; gl_Position = vec4((uPos + vQ) / uRes * 2.0 - 1.0, 0.0, 1.0); }'
  ].join('\n');

  // One small world: a lit, shaded disc with its own look; Saturn gets rings.
  const BODY_FS = [
    'precision highp float;',
    'varying vec2 vQ;',
    'uniform float uRad; uniform vec3 uLight; uniform vec3 uPole; uniform float uKind; uniform vec3 uCol; uniform vec3 uCol2;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float blob(vec2 q, vec2 c, float r){ return exp(-dot(q - c, q - c) / (r * r)); }',
    'vec3 surface(vec3 n, vec2 q){',
    '  float lat = dot(n, uPole);',
    '  if (uKind < 0.5) {',                                   // the Moon: highlands and the dark seas
    '    vec2 up = normalize(uPole.xy + vec2(0.0001));',
    '    vec2 m = vec2(q.x * up.y - q.y * up.x, q.x * up.x + q.y * up.y);',
    '    float sea = blob(m, vec2(-0.32, 0.42), 0.24) + blob(m, vec2(0.16, 0.40), 0.15) + blob(m, vec2(0.30, 0.14), 0.19) +',
    '      blob(m, vec2(0.66, 0.30), 0.10) + blob(m, vec2(0.52, -0.12), 0.12) + blob(m, vec2(0.34, -0.28), 0.09) +',
    '      blob(m, vec2(-0.58, 0.02), 0.30) + blob(m, vec2(-0.16, -0.36), 0.14) + blob(m, vec2(-0.45, -0.30), 0.12);',
    '    float crater = blob(m, vec2(-0.12, -0.72), 0.05);',
    '    return mix(uCol, uCol2, clamp(sea, 0.0, 0.85)) + vec3(0.25) * crater;',
    '  }',
    '  if (uKind > 3.5) {',                                   // banded giants
    '    float b = sin(lat * 15.0 + sin(lat * 7.0) * 1.6) * 0.5 + 0.5;',
    '    float b2 = sin(lat * 33.0) * 0.5 + 0.5;',
    '    return mix(uCol, uCol2, b * 0.75 + b2 * 0.2) * (0.9 + 0.1 * hash(floor(q * 40.0)));',
    '  }',
    '  if (uKind > 2.5) return mix(uCol, uCol2, smoothstep(0.75, 0.95, abs(lat)) * 0.6);',   // ice giants: a paler pole
    '  if (uKind > 1.5) return mix(uCol, uCol2, blob(q, vec2(0.2, 0.1), 0.35) + blob(q, vec2(-0.35, -0.2), 0.2) * 0.8) + vec3(0.35) * smoothstep(0.86, 0.95, lat);', // Mars and its polar cap
    '  return uCol;',
    '}',
    'void main(){',
    '  vec2 q = vQ / uRad;',
    '  float r = length(q);',
    '  float aa = 1.5 / uRad;',
    '  vec3 col = vec3(0.0); float a = 0.0;',
    '  float zDisc = r < 1.0 ? sqrt(1.0 - r * r) : -1.0;',
    '  if (r < 1.0 + aa) {',
    '    vec3 n = vec3(q, max(zDisc, 0.0));',
    '    float l = dot(n, uLight);',
    '    float lit = smoothstep(-0.06, 0.22, l) * (0.55 + 0.45 * clamp(l, 0.0, 1.0));',
    '    col = surface(n, q) * (lit + 0.025);',
    '    col *= 1.0 - 0.35 * pow(1.0 - max(zDisc, 0.0), 3.0);',
    '    a = smoothstep(1.0 + aa, 1.0 - aa, r);',
    '    col *= a;',
    '  }',
    // a faint glow, so they read as light sources against the sky
    '  float lf = clamp(dot(uLight, vec3(0.0, 0.0, 1.0)) * 0.5 + 0.5, 0.15, 1.0);',
    '  float g = exp(-max(r - 1.0, 0.0) * 2.6) * 0.18 * lf * (1.0 - a);',
    '  col += uCol * g; a += g * 0.5;',
    '  if (uKind > 4.5 && abs(uPole.z) > 0.02) {',             // Saturn's rings
    '    float z = -(q.x * uPole.x + q.y * uPole.y) / uPole.z;',
    '    float rr = length(vec3(q, z));',
    '    float ring = smoothstep(1.22, 1.30, rr) * smoothstep(2.30, 2.22, rr) * (1.0 - 0.85 * smoothstep(1.93, 1.96, rr) * smoothstep(2.03, 2.00, rr));',
    '    ring *= 0.55 + 0.45 * sin(rr * 40.0) * 0.3 + 0.25 * smoothstep(1.5, 1.9, rr);',
    '    bool front = r >= 1.0 || z > zDisc;',
    '    if (ring > 0.0 && front) {',
    '      float rl = 0.35 + 0.65 * abs(uLight.z * 0.5 + 0.5);',
    '      vec3 rc = vec3(0.86, 0.78, 0.62) * rl * ring;',
    '      col = col * (1.0 - ring * 0.9) + rc * 0.9; a = max(a, ring * 0.9);',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n');

  // The Earth. Clouds sit on their own shell a little above the ground, so they drift against the land as the
  // camera moves and stand out at the edge; they shade themselves on the side away from the Sun.
  const EARTH_FS = [
    'precision highp float;', RAY,
    'uniform float uD; uniform mat3 uRot; uniform vec3 uSun; uniform vec3 uHome; uniform float uHomeR; uniform float uHalo; uniform vec3 uSunPx; uniform float uRpx;',
    'uniform float uCloudH; uniform float uFade;',
    'uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uWater; uniform sampler2D uClouds;',
    'const float PI = 3.14159265;',
    'vec2 ll(vec3 n){',
    '  float u = atan(n.x, n.z) / (2.0 * PI);',
    '  float v = 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI;',
    // no seam where the map wraps round: use whichever way of counting longitude doesn't jump here
    '#ifdef SEAMFIX',
    '  float u1 = fract(u + 0.5), u2 = fract(u) - 0.5;',
    '  return vec2(fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2 + 0.5, v);',
    '#else',
    '  return vec2(u + 0.5, v);',
    '#endif',
    '}',
    'float cloud(vec3 n){ return smoothstep(0.10, 0.85, texture2D(uClouds, ll(n)).r); }',
    'vec3 haloColor(vec3 nE, vec3 dE){',
    '  float lit = clamp(dot(nE, uSun) * 0.8 + 0.35, 0.0, 1.0);',
    '  float fwd = uSunPx.z * exp(-length(gl_FragCoord.xy - uSunPx.xy) / (uRpx * 0.55));',
    '  return vec3(0.36, 0.62, 1.0) * (0.18 + 0.55 * lit) + vec3(0.75, 0.82, 1.0) * fwd * 1.2;',
    '}',
    // a cloud lit by the Sun: brighter where thick, a soft shade on the side turned away, orange at sunset
    'vec3 cloudLight(vec3 nc, float cl, float l){',
    '  float toward = cloud(normalize(nc + uSun * 0.0035));',
    '  float relief = clamp((cl - toward) * 1.6, -0.5, 0.5);',
    '  vec3 c = vec3(1.0, 0.99, 0.97) * (0.06 + 1.1 * clamp(l + 0.04, 0.0, 1.0)) * (0.80 + 0.22 * cl - 0.30 * relief);',
    '  c += vec3(0.55, 0.24, 0.08) * exp(-pow((l - 0.02) / 0.035, 2.0)) * 0.32;',
    '  return c;',
    '}',
    'void main(){',
    '  vec3 d = rayDir();',
    '  vec3 O = vec3(0.0, 0.0, uD);',
    '  float b = dot(O, d);',
    '  float h = sqrt(max(uD * uD - b * b, 0.0));',
    '  vec3 dE = uRot * d;',
    '  float rc = 1.0 + uCloudH;',
    '  if (h >= 1.0) {',
    '    float k = clamp((1.0 + uHalo - h) / uHalo, 0.0, 1.0);',
    '    if (k <= 0.0) { gl_FragColor = vec4(0.0) * uFade; return; }',
    '    vec3 nE = uRot * normalize(O - b * d);',
    '    vec3 hc = haloColor(nE, dE);',
    '    float a = k * k;',
    '    vec3 c = hc * a;',
    '    float al = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0) * 0.9;',
    // just past the ground's edge the ray still crosses the cloud shell: clouds on the skyline
    '    if (h < rc) {',
    '      vec3 nc = uRot * normalize(O + (-b - sqrt(max(b * b - (uD * uD - rc * rc), 0.0))) * d);',
    '      float cl = cloud(nc) * smoothstep(rc, 1.0 + uCloudH * 0.3, h);',
    '      float l = dot(nc, uSun);',
    '      vec3 cc = cloudLight(nc, cl, l) * smoothstep(-0.12, 0.05, l);',
    '      c = mix(c, cc, cl * 0.85); al = max(al, cl * 0.85);',
    '    }',
    '    gl_FragColor = vec4(c, al) * uFade;',
    '    return;',
    '  }',
    '  vec3 p = O + (-b - sqrt(b * b - (uD * uD - 1.0))) * d;',
    '  vec3 n = uRot * p;',
    '  vec3 nc = uRot * normalize(O + (-b - sqrt(b * b - (uD * uD - rc * rc))) * d);',
    '  vec2 t = ll(n);',
    '  vec3 day = texture2D(uDay, t).rgb;',
    '  vec3 night = texture2D(uNight, t).rgb;',
    '  float water = texture2D(uWater, t).r;',
    '  float cl = cloud(nc);',
    '  float shadow = cloud(normalize(n + uSun * (uCloudH * 1.4 + 0.004)));',
    '  float l = dot(n, uSun);',
    '  float dayMix = smoothstep(-0.10, 0.14, l);',
    // the night map's dim ground, without its city lights (those only show on the dark side)
    '  vec3 nightBase = min(night, vec3(0.06)) * vec3(0.30, 0.36, 0.58) * (1.0 - 0.5 * cl);',
    '  vec3 dayCol = day * (0.07 + 1.05 * clamp(l, 0.0, 1.0)) * (1.0 - 0.42 * shadow * (1.0 - cl)) + nightBase * 0.85;',
    '  vec3 lights = max(night - vec3(0.22), vec3(0.0)) * vec3(2.6, 2.1, 1.3) * (1.0 - 0.8 * cl);',
    '  vec3 nightCol = night * vec3(0.30, 0.36, 0.58) * (1.0 - 0.5 * cl) + lights + vec3(0.035, 0.045, 0.075) * cl;',
    '  vec3 col = mix(nightCol, dayCol, dayMix);',
    '  vec3 view = -dE;',
    '  vec3 hv = normalize(uSun + view);',
    '  float sh = max(dot(n, hv), 0.0);',
    '  col += vec3(1.0, 0.93, 0.80) * (pow(sh, 220.0) * 0.24 + pow(sh, 40.0) * 0.02) * water * dayMix * (1.0 - cl);',
    '  float lc = dot(nc, uSun);',
    '  col = mix(col, cloudLight(nc, cl, lc), cl * 0.92 * smoothstep(-0.12, 0.05, lc));',
    '  col += vec3(0.38, 0.15, 0.04) * exp(-pow((l - 0.03) / 0.04, 2.0)) * 0.16 * (1.0 - cl);',
    '  float mu = clamp(dot(p, -d), 0.0, 1.0);',
    '  float rim = pow(1.0 - mu, 2.6);',
    '  col = mix(col, vec3(0.42, 0.66, 1.0), rim * (0.25 + 0.5 * dayMix) * 0.8);',
    '  float ang = acos(clamp(dot(n, uHome), -1.0, 1.0));',
    '  col = mix(col, vec3(0.95, 0.83, 0.54), smoothstep(uHomeR * 1.17, uHomeR * 0.83, ang));',
    '  col = mix(col, haloColor(n, dE), smoothstep(0.985, 1.0, h) * 0.85);',
    '  gl_FragColor = vec4(col, 1.0) * uFade;',
    '}'
  ].join('\n');

  // Planes: each one flies on along its heading from its last known position (a great circle), so the world map
  // keeps moving between updates. Drawn as tiny airliners turned the way they're heading; route dots use it too.
  const PLANE_VS = [
    'attribute vec4 aA; attribute vec4 aB;',     // A: lat, lon, track (radians), angular speed (rad/s); B: time of fix (s), kind, -, -
    'uniform mat3 uE2V; uniform vec2 uC; uniform float uF; uniform float uD; uniform float uNow; uniform float uPx;',
    'uniform vec2 uRes;',
    'varying vec2 vDir; varying float vKind; varying float vSize; varying float vFade;',
    'vec2 screen(vec3 v){ return uC + uF * v.xy / (uD - v.z); }',
    'void main(){',
    '  float la = aA.x, lo = aA.y, h = aA.z;',
    '  vec3 p0 = vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));',
    '  vec3 north = vec3(-sin(la) * sin(lo), cos(la), -sin(la) * cos(lo));',
    '  vec3 east = vec3(cos(lo), 0.0, -sin(lo));',
    '  vec3 t = east * sin(h) + north * cos(h);',
    '  float dt = clamp(uNow - aB.x, 0.0, 1400.0);',
    '  float a = aA.w * dt;',
    '  vec3 p = p0 * cos(a) + t * sin(a);',
    '  vec3 tt = -p0 * sin(a) + t * cos(a);',
    '  vec3 v = uE2V * p;',
    '  vKind = aB.y;',
    '  vFade = aB.y < 1.5 ? 1.0 - smoothstep(1000.0, 1400.0, dt) : 1.0;',
    '  if (v.z < 1.0 / uD + 0.012 || vFade <= 0.0) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); gl_PointSize = 1.0; vDir = vec2(0.0, 1.0); vSize = 1.0; return; }',
    '  vec2 s = screen(v);',
    '  vec2 s2 = screen(uE2V * normalize(p + tt * 0.01));',
    '  vDir = length(s2 - s) > 1e-4 ? normalize(s2 - s) : vec2(0.0, 1.0);',
    // near the edge of the Earth they fade, rather than piling up along the rim
    '  vFade *= smoothstep(1.0 / uD + 0.012, 1.0 / uD + 0.12, v.z);',
    '  vSize = uPx * (aB.y > 3.5 ? 1.2 : aB.y > 1.5 ? 0.62 : aB.y > 0.5 ? 2.6 : 1.0);',
    '  gl_PointSize = vSize;',
    '  gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  const PLANE_FS = [
    'precision highp float;',
    'varying vec2 vDir; varying float vKind; varying float vSize; varying float vFade;',
    'uniform vec3 uCol; uniform vec3 uSel;',
    'void main(){',
    '  vec2 q = (gl_PointCoord - 0.5) * 2.0; q.y = -q.y;',
    '  if (vKind > 1.5) {',                                  // route dots (2 flown, 3 to go) and airports (4)
    '    float r = length(q);',
    '    float a = smoothstep(1.0, 0.45, r) * (vKind > 2.5 && vKind < 3.5 ? 0.45 : 0.95);',
    '    if (vKind > 3.5) a = max(smoothstep(1.0, 0.8, r) * smoothstep(0.45, 0.65, r), smoothstep(0.32, 0.12, r)) * 0.95;',
    '    gl_FragColor = vec4(uSel * a, a);',
    '    return;',
    '  }',
    '  float f = dot(q, vDir), s = dot(q, vec2(-vDir.y, vDir.x)), as = abs(s);',
    '  float aa = 2.2 / vSize;',
    '  float body = smoothstep(0.14 + aa, 0.14, as) * smoothstep(0.98, 0.98 - aa, f) * smoothstep(-0.86 - aa, -0.86, f);',
    '  float wing = smoothstep(0.92, 0.92 - aa, as) * smoothstep(0.17 + aa, 0.17, abs(f - 0.10 + as * 0.42));',
    '  float tail = smoothstep(0.40, 0.40 - aa, as) * smoothstep(0.11 + aa, 0.11, abs(f + 0.74 + as * 0.30));',
    '  float m = max(body, max(wing, tail));',
    '  float glow = smoothstep(1.0, 0.0, length(q)) * (vKind > 0.5 ? 0.30 : 0.0);',
    '  vec3 c = vKind > 0.5 ? uSel : uCol;',
    '  float a = max(m * (vKind > 0.5 ? 1.0 : 0.72), glow) * vFade;',
    '  gl_FragColor = vec4(c * a, a);',
    '}'
  ].join('\n');

  // A world up close: a textured, sunlit sphere the camera orbits; Saturn's rings with the shadows they and the
  // planet cast on each other; a thin atmosphere on the edge for the worlds that have one; the Sun glows.
  const WORLD_FS = [
    'precision highp float;', RAY,
    'uniform float uD; uniform mat3 uV2C; uniform vec3 uPole; uniform vec3 uMer; uniform vec3 uSunDir; uniform float uKind; uniform float uFade;',
    'uniform vec3 uAtm; uniform float uRingIn; uniform float uRingOut; uniform sampler2D uTex; uniform sampler2D uRing;',
    'const float PI = 3.14159265;',
    'vec2 ll(vec3 n){',
    '  float lat = asin(clamp(dot(n, uPole), -1.0, 1.0));',
    '  vec3 e = n - uPole * dot(n, uPole);',
    '  float u = atan(dot(e, cross(uPole, uMer)), dot(e, uMer)) / (2.0 * PI);',
    '#ifdef SEAMFIX',
    '  float u1 = fract(u + 0.5), u2 = fract(u) - 0.5;',
    '  u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2 + 0.5;',
    '#else',
    '  u = u + 0.5;',
    '#endif',
    '  return vec2(u, 0.5 - lat / PI);',
    '}',
    'vec4 ring(float r){',
    '  float u = (r - uRingIn) / (uRingOut - uRingIn);',
    '  if (u < 0.0 || u > 1.0) return vec4(0.0);',
    '  return texture2D(uRing, vec2(u, 0.5));',
    '}',
    'void main(){',
    '  vec3 d = rayDir();',
    '  vec3 O = vec3(0.0, 0.0, uD);',
    '  float b = dot(O, d);',
    '  float disc = b * b - (uD * uD - 1.0);',
    '  float h = sqrt(max(uD * uD - b * b, 0.0));',
    '  vec4 col = vec4(0.0);',
    '  float tP = 1e9;',
    '  if (disc > 0.0) {',
    '    tP = -b - sqrt(disc);',
    '    vec3 pv = O + tP * d;',
    '    vec3 n = uV2C * pv;',
    '    vec3 tex = texture2D(uTex, ll(n)).rgb;',
    '    float mu = clamp(dot(pv, -d), 0.0, 1.0);',
    '    if (uKind > 2.5) {',                                     // the Sun: it makes its own light
    '      col = vec4(tex * vec3(1.35, 1.15, 0.9) * (0.55 + 0.6 * pow(mu, 0.45)) + vec3(0.25, 0.12, 0.0) * (1.0 - mu), 1.0);',
    '    } else {',
    '      float l = dot(n, uSunDir);',
    // rocky worlds stay bright right up to the terminator (like the real Moon); cloudy ones fade more gently
    '      vec3 c = uKind < 0.5 ? tex * (0.015 + smoothstep(-0.02, 0.14, l) * (0.62 + 0.5 * clamp(l, 0.0, 1.0)))',
    '                           : tex * (0.015 + 1.15 * clamp(l, 0.0, 1.0)) * smoothstep(-0.08, 0.12, l + 0.06);',
    '      if (uRingOut > 0.0) {',                                // the rings' shadow on the planet
    '        float sp = dot(uSunDir, uPole);',
    '        if (abs(sp) > 1e-3) {',
    '          float st = -dot(n, uPole) / sp;',
    '          if (st > 0.0) c *= 1.0 - ring(length(n + uSunDir * st)).a * 0.75;',
    '        }',
    '      }',
    '      c += uAtm * pow(1.0 - mu, 2.5) * (0.15 + 0.85 * smoothstep(-0.2, 0.4, l));',
    '      col = vec4(c, 1.0);',
    '    }',
    '  } else if (uKind > 2.5) {',
    '    float g = exp(-(h - 1.0) * 5.0) * 0.9 + exp(-(h - 1.0) * 1.2) * 0.25;',     // the Sun's glow
    '    col = vec4(vec3(1.0, 0.82, 0.55) * g, clamp(g, 0.0, 1.0));',
    '  } else if (uAtm.r + uAtm.g + uAtm.b > 0.0 && h < 1.04) {',
    '    float k = (1.04 - h) / 0.04;',
    '    vec3 nE = uV2C * normalize(O - b * d);',
    '    float a = k * k * 0.6 * (0.2 + 0.8 * smoothstep(-0.3, 0.4, dot(nE, uSunDir)));',
    '    col = vec4(uAtm * a, a);',
    '  }',
    '  if (uRingOut > 0.0) {',
    '    vec3 Pv = vec3(dot(uV2C[0], uPole), dot(uV2C[1], uPole), dot(uV2C[2], uPole));',
    '    float den = dot(d, Pv);',
    '    if (abs(den) > 1e-5) {',
    '      float t = -dot(O, Pv) / den;',
    '      if (t > 0.0) {',
    '        vec3 q = O + t * d;',
    '        vec4 rg = ring(length(q));',
    '        if (rg.a > 0.003) {',
    '          vec3 qc = uV2C * q;',
    '          float bb = dot(qc, uSunDir), cc = dot(qc, qc) - 1.0;',
    '          float shade = (bb < 0.0 && bb * bb - cc > 0.0) ? 0.06 : 1.0;',   // in the planet's shadow
    '          vec3 rc = rg.rgb * (0.35 + 0.75 * abs(dot(uPole, uSunDir))) * shade;',
    '          float ra = rg.a * 0.92;',
    '          if (t < tP) col = vec4(rc * ra + col.rgb * (1.0 - ra), ra + col.a * (1.0 - ra));',
    '          else if (col.a < 0.99) col = vec4(col.rgb + rc * ra * (1.0 - col.a), col.a + ra * (1.0 - col.a));',
    '        }',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = col * uFade;',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    // fragment shaders get screen-space derivatives when the GPU has them, for seamless mipmapped maps
    if (type === gl.FRAGMENT_SHADER && gl.__seam) src = '#extension GL_OES_standard_derivatives : enable\n#define SEAMFIX 1\n' + src;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs, uniforms) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    uniforms.forEach(function (k) { u[k] = gl.getUniformLocation(p, k); });
    return { p: p, u: u };
  }

  function loadImage(src) {
    if (src && typeof src.then === 'function') return src.then(loadImage);
    if (!src || typeof src !== 'string') return Promise.reject(new Error('no image'));
    return new Promise(function (resolve, reject) {
      const im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('could not load an image')); };
      im.src = src;
    });
  }

  // How each world looks, and how big to draw it (a fraction of the Earth's drawn radius — all larger than life).
  const LOOKS = {
    moon: { kind: 0, size: 0.040, col: [0.80, 0.79, 0.76], col2: [0.42, 0.42, 0.44] },
    mercury: { kind: 1, size: 0.011, col: [0.66, 0.62, 0.58], col2: [0.5, 0.48, 0.46] },
    venus: { kind: 1, size: 0.017, col: [0.98, 0.93, 0.80], col2: [0.9, 0.85, 0.7] },
    mars: { kind: 2, size: 0.014, col: [0.80, 0.42, 0.24], col2: [0.52, 0.27, 0.18] },
    jupiter: { kind: 4, size: 0.024, col: [0.92, 0.86, 0.74], col2: [0.70, 0.52, 0.38] },
    saturn: { kind: 5, size: 0.019, col: [0.93, 0.85, 0.64], col2: [0.80, 0.70, 0.50] },
    uranus: { kind: 3, size: 0.012, col: [0.62, 0.86, 0.90], col2: [0.80, 0.94, 0.96] },
    neptune: { kind: 3, size: 0.011, col: [0.34, 0.52, 0.96], col2: [0.55, 0.70, 1.0] }
  };
  // Up close: how big on screen (in Earth-sizes), the air at the edge, Saturn's rings (planet radii), the Sun shines
  const WORLDS = {
    sun: { kind: 3, size: 0.70 },
    moon: { kind: 0, size: 0.85, atm: [0, 0, 0] },
    mercury: { kind: 0, size: 0.85, atm: [0, 0, 0] },
    venus: { kind: 1, size: 0.85, atm: [0.55, 0.48, 0.32] },
    mars: { kind: 0, size: 0.85, atm: [0.45, 0.28, 0.18] },
    jupiter: { kind: 1, size: 0.85, atm: [0.42, 0.38, 0.32] },
    saturn: { kind: 1, size: 0.55, atm: [0.45, 0.40, 0.30], rings: [1.24, 2.27] },
    uranus: { kind: 1, size: 0.85, atm: [0.30, 0.48, 0.52] },
    neptune: { kind: 1, size: 0.85, atm: [0.20, 0.30, 0.62] }
  };
  // How each one turns: the IAU's prime meridian W = a + b·d degrees, d in days from J2000
  const SPIN = { sun: [84.176, 14.1844], mercury: [329.5469, 6.1385025], venus: [160.20, -1.4813688], mars: [176.630, 350.89198226],
    jupiter: [284.95, 870.536], saturn: [38.90, 810.7939024], uranus: [203.81, -501.1600928], neptune: [249.978, 541.1397757] };

  // North poles (RA, Dec in degrees, J2000)
  const POLES = { sun: [286.13, 63.87], moon: [270.0, 66.5], mercury: [281.0, 61.4], venus: [272.8, 67.2], mars: [317.7, 52.9], jupiter: [268.1, 64.5], saturn: [40.6, 83.5], uranus: [257.3, -15.2], neptune: [299.4, 43.5] };

  /**
   * Scene(canvas, { home, images: {day, night, water, clouds, milky}, stars: [ra,dec,mag,ci,...], sky: FocusSky })
   * The canvas covers the screen; layout(cx, cy, r) says where the Earth sits (CSS px) and how big.
   */
  function Scene(canvas, opts) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL');
    gl.__seam = !!gl.getExtension('OES_standard_derivatives');
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const MAXTEX = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    const SKY = opts.sky;
    const sky = program(gl, QUAD_VS, SKY_FS, ['uC', 'uFs', 'uV2C', 'uSunC', 'uMilky', 'uGain']);
    const star = program(gl, STAR_VS, STAR_FS, ['uC2V', 'uC', 'uFs', 'uRes', 'uTime', 'uScale']);
    const body = program(gl, BODY_VS, BODY_FS, ['uPos', 'uExt', 'uRes', 'uRad', 'uLight', 'uPole', 'uKind', 'uCol', 'uCol2']);
    const earth = program(gl, QUAD_VS, EARTH_FS, ['uC', 'uF', 'uD', 'uRot', 'uSun', 'uHome', 'uHomeR', 'uCloudH', 'uFade', 'uHalo', 'uSunPx', 'uRpx', 'uDay', 'uNight', 'uWater', 'uClouds']);
    const plane = program(gl, PLANE_VS, PLANE_FS, ['uE2V', 'uC', 'uF', 'uD', 'uNow', 'uPx', 'uRes', 'uCol', 'uSel']);
    const world = program(gl, QUAD_VS, WORLD_FS, ['uC', 'uF', 'uD', 'uV2C', 'uPole', 'uMer', 'uSunDir', 'uKind', 'uFade', 'uAtm', 'uRingIn', 'uRingOut', 'uTex', 'uRing']);
    const planeBuf = gl.createBuffer();
    let planes = [], planeCount = 0, planeBase = 0, selected = null, hovered = null, route = null;

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // the stars: a direction (equatorial, unit) and magnitude, colour, seed for each
    const raw = opts.stars || [];
    const count = Math.floor(raw.length / 4);
    const sdata = new Float32Array(count * 6);
    let seed = 7;
    for (let i = 0; i < count; i++) {
      const v = unit(raw[i * 4 + 1] / 100, raw[i * 4] / 100);
      seed = (seed * 16807) % 2147483647;
      sdata.set([v[0], v[1], v[2], raw[i * 4 + 2] / 100, raw[i * 4 + 3] / 100, seed / 2147483647], i * 6);
    }
    const starBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sdata, gl.STATIC_DRAW);

    const home = opts.home || { lat: 40.19, lon: -92.58 };
    const homeV = unit(home.lat, home.lon);
    // The resting view: home a little right of centre, the Atlantic and Europe toward the morning edge.
    const rest = { lat: 24, lon: home.lon + 22 };
    const view = { lat: rest.lat, lon: rest.lon };
    const sway = { x: 0, y: 0, tx: 0, ty: 0 };
    // zoom: the camera moves in toward the Earth; 1 is the resting distance
    const MIN_DIST = 1.25;
    let dist = DIST, distTarget = DIST, anchor = null;
    function zoom() { return Math.sqrt(DIST * DIST - 1) / Math.sqrt(dist * dist - 1); }
    const tex = {};
    let ready = false, onReady = null, onFrame = null, spring = 0, raf = 0, running = false, lastFrame = 0;
    let lay = { cx: 0, cy: 0, r: 100 }, lastNow = Date.now(), skyAt = null, frameInfo = null;

    function pot(n) { return n > 0 && (n & (n - 1)) === 0; }

    /** An image no bigger than the GPU (or `cap`) takes, shrunk on a canvas when it has to be. */
    function fit(img, cap) {
      const lim = Math.min(MAXTEX, cap || MAXTEX);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (w <= lim && h <= lim) return img;
      const k = lim / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    }

    /** Uploads a map with mipmaps and anisotropic filtering, so it stays crisp at any size and angle. grey: one channel. */
    function texture(name, unitN, img, grey, cap) {
      if (!tex[name]) tex[name] = gl.createTexture();
      const src = fit(img, cap);
      gl.activeTexture(gl.TEXTURE0 + unitN);
      gl.bindTexture(gl.TEXTURE_2D, tex[name]);
      const fmt = grey ? gl.LUMINANCE : gl.RGB;
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src);
      const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const mip = pot(w) && pot(h);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mip ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso && mip) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
    }
    const UNITS = { day: 0, night: 1, water: 2, clouds: 3, milky: 4 };
    const im = opts.images;
    Promise.all([loadImage(im.day), loadImage(im.night), loadImage(im.water), loadImage(im.milky)]).then(function (ims) {
      // the night lights and the water mask don't need the day map's detail; keeping them at 4096 saves memory
      texture('day', 0, ims[0]); texture('night', 1, ims[1], false, 4096); texture('water', 2, ims[2], true, 4096); texture('milky', 4, ims[3]);
      // clouds are optional; until they arrive the sky is clear
      const blank = new Uint8Array([0, 0, 0, 255]);
      if (!tex.clouds) {
        tex.clouds = gl.createTexture();
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, tex.clouds);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      }
      return setClouds(im.clouds).catch(function () { });
    }).then(function () {
      ready = true;
      draw(lastNow);
      if (onReady) onReady();
    }).catch(function (e) { console.warn(e.message); });

    function setClouds(src) {
      return loadImage(src).then(function (img) { texture('clouds', 3, img, true); if (ready) draw(lastNow); });
    }

    /** Swap in sharper maps when they arrive (the month's 8K Blue Marble). Any of day, night, water. */
    function setMaps(srcs) {
      const jobs = [];
      if (srcs.day) jobs.push(loadImage(srcs.day).then(function (i) { texture('day', 0, i); }));
      if (srcs.night) jobs.push(loadImage(srcs.night).then(function (i) { texture('night', 1, i, false, 4096); }));
      if (srcs.water) jobs.push(loadImage(srcs.water).then(function (i) { texture('water', 2, i, true, 4096); }));
      return Promise.all(jobs).then(function () { if (ready && !running) draw(lastNow); });
    }

    // view → earth: Ry(lon) · Rx(-lat)
    function rotation() {
      const a = -(view.lat + sway.y) * RAD, o = (view.lon + sway.x) * RAD;
      const ca = Math.cos(a), sa = Math.sin(a), co = Math.cos(o), so = Math.sin(o);
      return [[co, so * sa, so * ca], [0, ca, -sa], [-so, co * sa, co * ca]];
    }

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w: w, h: h, dpr: dpr };
    }

    function quadAttr(prog) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const loc = gl.getAttribLocation(prog.p, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return loc;
    }

    /** Everything the frame needs, in CSS pixels and the camera's frame. */
    function frame(now) {
      const R = rotation();                          // view → earth
      if (!skyAt || Math.abs(skyAt.t - now) > 20000) skyAt = { t: now, sky: SKY.at(now) };
      const s = skyAt.sky;
      s.days = now / 86400000 + 2440587.5 - 2451545.0;
      const c2e = tr(turn(s.gmst));                  // equatorial → earth-fixed (undoes the Earth's turn)
      let c2v = mul(tr(R), c2e);
      if (visit) c2v = visitCamera(c2v);                // visiting a world: the camera that orbits it
      const f = lay.r * Math.sqrt(DIST * DIST - 1);
      // the far corners of the screen stay within about 115° of straight behind the Earth, where the fisheye still looks right
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const corner = Math.max(Math.hypot(lay.cx, lay.cy), Math.hypot(W - lay.cx, lay.cy), Math.hypot(lay.cx, H - lay.cy), Math.hypot(W - lay.cx, H - lay.cy));
      const fs = Math.max(lay.r * SKY_SCALE, corner / 2.0);
      const ccx = lay.cx + (visit ? visitShift() : 0);   // while visiting, the world sits a little right of the panel
      const sunC = norm(s.bodies[0].pos);
      const out = [];
      s.bodies.forEach(function (b) {
        const v = app(c2v, norm(b.pos));
        const th = Math.acos(Math.max(-1, Math.min(1, -v[2]))), l = Math.hypot(v[0], v[1]) || 1e-9;
        const x = ccx + fs * th * v[0] / l, y = lay.cy - fs * th * v[1] / l;
        const behind = !visit && Math.hypot(x - lay.cx, y - lay.cy) < lay.r * zoom() * 1.02;   // hidden by the Earth
        const look = LOOKS[b.id];
        out.push({ id: b.id, name: b.name, x: x, y: y, v: v, behind: behind, r: look ? look.size * lay.r : 0, body: b,
          onScreen: th < 3.0 && x > -40 && y > -40 && x < canvas.clientWidth + 40 && y < canvas.clientHeight + 40 });
      });
      return { R: R, c2e: c2e, c2v: c2v, f: f, fs: fs, ccx: ccx, sunC: sunC, sunE: app(c2e, sunC), bodies: out, sky: s };
    }

    function draw(now) {
      lastNow = now || Date.now();
      if (!ready) return;
      const sz = size();
      const fr = frame(lastNow);
      frameInfo = fr;
      const k = sz.dpr;
      const cx = lay.cx * k, cy = sz.h - lay.cy * k, f = fr.f * k, fs = fr.fs * k, scx = fr.ccx * k;
      gl.viewport(0, 0, sz.w, sz.h);
      gl.disable(gl.BLEND);

      // 1. the sky
      gl.useProgram(sky.p);
      let loc = quadAttr(sky);
      gl.uniform2f(sky.u.uC, scx, cy); gl.uniform1f(sky.u.uFs, fs);
      gl.uniformMatrix3fv(sky.u.uV2C, false, gl3(tr(fr.c2v)));
      gl.uniform3fv(sky.u.uSunC, fr.sunC);
      gl.uniform1i(sky.u.uMilky, UNITS.milky); gl.uniform1f(sky.u.uGain, 1.55);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(loc);

      // 2. the stars, added on
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(star.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
      const aDir = gl.getAttribLocation(star.p, 'aDir'), aInfo = gl.getAttribLocation(star.p, 'aInfo');
      gl.enableVertexAttribArray(aDir); gl.enableVertexAttribArray(aInfo);
      gl.vertexAttribPointer(aDir, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(aInfo, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix3fv(star.u.uC2V, false, gl3(fr.c2v));
      gl.uniform2f(star.u.uC, scx, cy); gl.uniform1f(star.u.uFs, fs); gl.uniform2f(star.u.uRes, sz.w, sz.h);
      gl.uniform1f(star.u.uTime, performance.now() / 1000); gl.uniform1f(star.u.uScale, k);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disableVertexAttribArray(aDir); gl.disableVertexAttribArray(aInfo);

      // 3. the Moon and the planets
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(body.p);
      loc = quadAttr(body);
      gl.uniform2f(body.u.uRes, sz.w, sz.h);
      // farthest first, so the Moon passes in front of the planets
      fr.bodies.slice().sort(function (x, y) { return y.body.dist - x.body.dist; }).forEach(function (b) {
        const look = LOOKS[b.id];
        if (!look || !b.onScreen || b.behind) return;
        if (visit && visit.id === b.id && visit.u >= HANDOFF) return;
        const rad = Math.max(2.2, b.r) * k;
        gl.uniform2f(body.u.uPos, b.x * k, sz.h - b.y * k);
        gl.uniform1f(body.u.uRad, rad);
        gl.uniform1f(body.u.uExt, rad * (b.id === 'saturn' ? 2.5 : 1.8) + 4 * k);
        // the disc's own frame: z from the world toward us, y as near to screen-up as it can be
        const zb = norm([-b.v[0], -b.v[1], -b.v[2]]);
        const yb = norm([-zb[1] * zb[0], 1 - zb[1] * zb[1], -zb[1] * zb[2]]);
        const xb = [yb[1] * zb[2] - yb[2] * zb[1], yb[2] * zb[0] - yb[0] * zb[2], yb[0] * zb[1] - yb[1] * zb[0]];
        const local = function (w) { return [w[0] * xb[0] + w[1] * xb[1] + w[2] * xb[2], w[0] * yb[0] + w[1] * yb[1] + w[2] * yb[2], w[0] * zb[0] + w[1] * zb[1] + w[2] * zb[2]]; };
        gl.uniform3fv(body.u.uLight, local(app(fr.c2v, b.body.sunward)));
        gl.uniform3fv(body.u.uPole, local(app(fr.c2v, unit(POLES[b.id][1], POLES[b.id][0]))));
        gl.uniform1f(body.u.uKind, look.kind);
        gl.uniform3fv(body.u.uCol, look.col); gl.uniform3fv(body.u.uCol2, look.col2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
      gl.disableVertexAttribArray(loc);

      // 3b. a world up close (behind the Earth while we fly away from it)
      if (visit && visit.u >= HANDOFF) drawWorld(fr, sz, k, scx, cy);

      // 4. the Earth and its air, over everything
      const earthFade = visit ? visit.earthFade : 1;
      if (earthFade > 0.002) {
      gl.useProgram(earth.p);
      loc = quadAttr(earth);
      gl.uniform2f(earth.u.uC, cx, cy); gl.uniform1f(earth.u.uF, f); gl.uniform1f(earth.u.uD, dist);
      gl.uniform1f(earth.u.uHomeR, 0.0115 / zoom()); gl.uniform1f(earth.u.uCloudH, 0.0055);
      gl.uniformMatrix3fv(earth.u.uRot, false, gl3(fr.R));
      gl.uniform3fv(earth.u.uSun, fr.sunE);
      gl.uniform3fv(earth.u.uHome, homeV);
      gl.uniform1f(earth.u.uHalo, 0.085);
      const sun = fr.bodies[0];
      gl.uniform3f(earth.u.uSunPx, sun.x * k, sz.h - sun.y * k, sun.onScreen ? 1 : 0);
      gl.uniform1f(earth.u.uRpx, lay.r * zoom() * k);
      gl.uniform1i(earth.u.uDay, 0); gl.uniform1i(earth.u.uNight, 1); gl.uniform1i(earth.u.uWater, 2); gl.uniform1i(earth.u.uClouds, 3);
      gl.uniform1f(earth.u.uFade, earthFade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(loc);
      }

      // 5. the planes, on the Earth
      if (planeCount && !visit) {
        gl.useProgram(plane.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, planeBuf);
        const aA = gl.getAttribLocation(plane.p, 'aA'), aB = gl.getAttribLocation(plane.p, 'aB');
        gl.enableVertexAttribArray(aA); gl.enableVertexAttribArray(aB);
        gl.vertexAttribPointer(aA, 4, gl.FLOAT, false, 32, 0);
        gl.vertexAttribPointer(aB, 4, gl.FLOAT, false, 32, 16);
        gl.uniformMatrix3fv(plane.u.uE2V, false, gl3(tr(fr.R)));
        gl.uniform2f(plane.u.uC, cx, cy); gl.uniform1f(plane.u.uF, f); gl.uniform1f(plane.u.uD, dist);
        gl.uniform1f(plane.u.uNow, lastNow / 1000 - planeBase);
        gl.uniform1f(plane.u.uPx, Math.max(5, lay.r * 0.012 * Math.pow(zoom(), 0.4)) * k);
        gl.uniform2f(plane.u.uRes, sz.w, sz.h);
        gl.uniform3f(plane.u.uCol, 1.0, 0.85, 0.58);
        gl.uniform3f(plane.u.uSel, 1.0, 0.93, 0.74);
        gl.drawArrays(gl.POINTS, 0, planeCount);
        gl.disableVertexAttribArray(aA); gl.disableVertexAttribArray(aB);
      }
      if (onFrame) onFrame();
    }

    // ---------- planes ----------
    // A plane: { hex, cs, lat, lon, track (deg), speed (m/s), t (s, time of the fix), ... }

    /** Where a plane is at a moment (epoch ms): lat, lon (deg), heading (deg); the same flying-on as the shader. */
    function planeAt(pl, ms) {
      const dt = Math.max(0, Math.min(1400, ms / 1000 - pl.t));
      const la = pl.lat * RAD, lo = pl.lon * RAD, h = pl.track * RAD, a = pl.speed / 6371000 * dt;
      const p0 = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
      const nn = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)], ee = [Math.cos(lo), 0, -Math.sin(lo)];
      const t = [ee[0] * Math.sin(h) + nn[0] * Math.cos(h), ee[1] * Math.sin(h) + nn[1] * Math.cos(h), ee[2] * Math.sin(h) + nn[2] * Math.cos(h)];
      const p = [p0[0] * Math.cos(a) + t[0] * Math.sin(a), p0[1] * Math.cos(a) + t[1] * Math.sin(a), p0[2] * Math.cos(a) + t[2] * Math.sin(a)];
      return { lat: Math.asin(Math.max(-1, Math.min(1, p[1]))) / RAD, lon: Math.atan2(p[0], p[2]) / RAD, age: dt };
    }

    function rebuildPlanes() {
      const extra = [];
      if (route) route.forEach(function (d) { extra.push(d); });
      const n = planes.length + extra.length;
      const data = new Float32Array(n * 8);
      planeBase = Math.floor(Date.now() / 1000) - 3600;
      let i = 0;
      planes.forEach(function (pl) {
        const kind = selected && pl.hex === selected ? 1 : hovered && pl.hex === hovered ? 1 : 0;
        data.set([pl.lat * RAD, pl.lon * RAD, pl.track * RAD, pl.speed / 6371000, pl.t - planeBase, kind, 0, 0], i * 8);
        i++;
      });
      // the selected one last, so it's drawn on top
      extra.forEach(function (d) { data.set([d.lat * RAD, d.lon * RAD, 0, 0, 0, d.kind, 0, 0], i * 8); i++; });
      if (selected) {
        const s = planes.filter(function (pl) { return pl.hex === selected; })[0];
        if (s) {
          const arr = new Float32Array(n * 8 + 8);
          arr.set(data);
          arr.set([s.lat * RAD, s.lon * RAD, s.track * RAD, s.speed / 6371000, s.t - planeBase, 1, 0, 0], n * 8);
          gl.bindBuffer(gl.ARRAY_BUFFER, planeBuf);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          planeCount = n + 1;
          return;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, planeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      planeCount = n;
    }

    function setPlanes(list) { planes = list || []; rebuildPlanes(); if (!running) draw(lastNow); }

    /** The plane under a point on screen (CSS px), within a few pixels, or null. */
    function planeNear(x, y, radius) {
      const R = tr(rotation()), f = lay.r * Math.sqrt(DIST * DIST - 1), t = Date.now();
      let best = null, bd = (radius || 14) * (radius || 14);
      for (let i = 0; i < planes.length; i++) {
        const q = planeAt(planes[i], t);
        if (q.age > 1350) continue;
        const v = app(R, unit(q.lat, q.lon));
        if (v[2] < 1 / dist + 0.05) continue;
        const z = dist - v[2], sx = lay.cx + f * v[0] / z, sy = lay.cy - f * v[1] / z;
        const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
        if (d < bd) { bd = d; best = planes[i]; }
      }
      return best;
    }

    /** Where a plane is on screen right now. */
    function planeScreen(pl) {
      const q = planeAt(pl, Date.now()), p = project(q.lat, q.lon);
      p.lat = q.lat; p.lon = q.lon;
      return p;
    }

    function setSelected(hex) { if (selected !== hex) { selected = hex; rebuildPlanes(); } }
    function setHovered(hex) { if (hovered !== hex) { hovered = hex; rebuildPlanes(); if (!running) draw(lastNow); } }

    /** Dots along the great circle from one airport to the other, brighter for the part already flown. */
    function setRoute(from, to, at) {
      route = null;
      if (from && to && from.lat !== null && to.lat !== null) {
        const a = unit(from.lat, from.lon), b = unit(to.lat, to.lon);
        const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
        if (ang > 0.002) {
          route = [];
          const steps = Math.max(8, Math.round(ang / RAD / 0.7));
          // how far along is the plane? the closest route point to it
          let doneUpTo = -1;
          if (at) {
            const c = unit(at.lat, at.lon);
            let bd = 9;
            for (let i = 0; i <= steps; i++) {
              const p = slerp(a, b, ang, i / steps), d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]);
              if (d < bd) { bd = d; doneUpTo = i; }
            }
          }
          for (let i = 1; i < steps; i++) {
            const p = slerp(a, b, ang, i / steps);
            route.push({ lat: Math.asin(p[1]) / RAD, lon: Math.atan2(p[0], p[2]) / RAD, kind: i <= doneUpTo ? 2 : 3 });
          }
          route.push({ lat: from.lat, lon: from.lon, kind: 4 }, { lat: to.lat, lon: to.lon, kind: 4 });
        }
      }
      rebuildPlanes();
      if (!running) draw(lastNow);
    }

    function slerp(a, b, ang, u) {
      const s = Math.sin(ang), wa = Math.sin((1 - u) * ang) / s, wb = Math.sin(u * ang) / s;
      return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
    }

    /** Swing the camera to look at a place; it stays there until released. */
    let held = false;
    function lookAt(lat, lon) {
      held = true;
      flyTo({ lat: Math.max(-70, Math.min(70, lat)), lon: lon }, 0, 1400, false);
    }
    function hold(on) { held = !!on; }

    // ---------- visiting a world ----------
    // Click the Moon, a planet or the Sun: the camera swings round until it's straight behind the Earth, then flies
    // past the Earth (which falls away and fades) while the world grows into a globe the camera slowly orbits.
    const HANDOFF = 0.35, GO_MS = 3600, BACK_MS = 3000;
    let visit = null;

    function rotAxis(kx, a) {
      const c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = kx[0], y = kx[1], z = kx[2];
      return [[c + x * x * t, x * y * t - z * s, x * z * t + y * s], [y * x * t + z * s, c + y * y * t, y * z * t - x * s], [z * x * t - y * s, z * y * t + x * s, c + z * z * t]];
    }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function ease(x) { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
    function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    function visitTo(id) {
      if (visit || !WORLDS[id] || !frameInfo) return false;
      const b = frameInfo.bodies.filter(function (x) { return x.id === id; })[0];
      if (!b) return false;
      const dirE = app(frameInfo.c2e, norm(b.body.pos));
      cancelAnimationFrame(spring); springOn = false; resumeDrift = false; held = true; anchor = null;
      visit = { id: id, phase: 'go', start: performance.now(), u: 0, earthFade: 1, grow: 0, base: null, az: 0, el: 0, zoom: 1,
        autoAt: 0, lastT: performance.now(), tex: null, ring: null,
        from: { lat: view.lat, lon: view.lon, dist: dist },
        look: { lat: -Math.asin(Math.max(-1, Math.min(1, dirE[1]))) / RAD, lon: Math.atan2(dirE[0], dirE[2]) / RAD + 180 },
        rDot: Math.max(3, id === 'sun' ? 0.016 * frameInfo.fs : (LOOKS[id] ? LOOKS[id].size * lay.r : 4)) };
      const v = visit;
      if (opts.worldImage) {
        loadImage(opts.worldImage(id)).then(function (img) { if (visit === v) { texture('world', 5, img); v.tex = true; } }).catch(function () { });
        if (WORLDS[id].rings) loadImage(opts.worldImage('saturn_ring')).then(function (img) {
          if (visit !== v) return;
          if (!tex.ring) tex.ring = gl.createTexture();
          gl.activeTexture(gl.TEXTURE6);
          gl.bindTexture(gl.TEXTURE_2D, tex.ring);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          v.ring = true;
        }).catch(function () { });
      }
      if (!running) start();
      return true;
    }

    function visitLeave() {
      if (!visit || visit.phase === 'back') return;
      visit.back = { az: visit.az, el: visit.el, zoom: visit.zoom, grow: visit.grow, fade: visit.earthFade, dist: dist };
      visit.phase = 'back'; visit.start = performance.now();
    }

    function stepVisit() {
      if (!visit) return;
      const t = performance.now(), dt = Math.min(0.1, (t - visit.lastT) / 1000);
      visit.lastT = t;
      const far = 40;
      if (visit.phase === 'go') {
        const u = Math.min(1, (t - visit.start) / GO_MS);
        visit.u = u;
        const a = ease(u / HANDOFF), fr = visit.from, lk = visit.look;
        const dl = ((lk.lon - fr.lon) % 360 + 540) % 360 - 180;
        view.lat = fr.lat + (lk.lat - fr.lat) * a;
        view.lon = fr.lon + dl * a;
        dist = fr.dist + (DIST - fr.dist) * a;
        if (u >= HANDOFF) {
          const v = (u - HANDOFF) / (1 - HANDOFF), e = ease(v);
          dist = DIST + (far - DIST) * e * e;
          visit.earthFade = 1 - smooth(0.2, 0.7, v);
          visit.grow = e;
        }
        distTarget = dist;
        if (u >= 1) { visit.phase = 'there'; visit.autoAt = t; }
      } else if (visit.phase === 'there') {
        if (t > visit.autoAt) visit.az += dt * 3 * RAD;            // a slow orbit
        visit.grow = 1; visit.earthFade = 0;
      } else {
        const u = Math.min(1, (t - visit.start) / BACK_MS), bk = visit.back;
        const a = ease(u / 0.3);
        visit.az = bk.az * (1 - a); visit.el = bk.el * (1 - a); visit.zoom = bk.zoom + (1 - bk.zoom) * a;
        const v = Math.max(0, (u - 0.3) / 0.7), e = ease(v);
        visit.grow = bk.grow * (1 - e);
        visit.earthFade = smooth(0.3, 0.8, v);
        dist = far + (DIST - far) * (1 - Math.pow(1 - e, 2));
        distTarget = dist;
        if (u >= 1) {
          visit = null; dist = distTarget = DIST; held = false;
          flyTo(rest, 400, 3000, true);
          if (onVisit) onVisit(null);
        }
      }
    }

    /** The camera while visiting: the Earth's view handed over at the moment the world is dead ahead, then orbiting. */
    function visitCamera(c2vEarth) {
      if (!visit.base) {
        if (visit.u < HANDOFF) return c2vEarth;
        visit.base = tr(c2vEarth);
      }
      const P = unit(POLES[visit.id][1], POLES[visit.id][0]);
      let m = mul(rotAxis(P, visit.az), visit.base);
      const right = [m[0][0], m[1][0], m[2][0]];
      m = mul(rotAxis(norm(right), visit.el), m);
      return tr(m);
    }

    function drawWorld(fr, sz, k, cx, cy) {
      const cfg = WORLDS[visit.id];
      if (!visit.tex || (cfg.rings && !visit.ring)) return;
      const b = fr.sky.bodies.filter(function (x) { return x.id === visit.id; })[0];
      const P = unit(POLES[visit.id][1], POLES[visit.id][0]);
      let M;
      if (visit.id === 'moon') {
        const toEarth = norm([-b.pos[0], -b.pos[1], -b.pos[2]]);             // the near side faces us
        M = norm([toEarth[0] - P[0] * dot(toEarth, P), toEarth[1] - P[1] * dot(toEarth, P), toEarth[2] - P[2] * dot(toEarth, P)]);
      } else {
        const d = fr.sky.days, sp = SPIN[visit.id], W = (sp[0] + sp[1] * d) * RAD;
        const e1 = norm(cross([0, 1, 0], P)), e2 = cross(P, e1);
        M = [e1[0] * Math.cos(W) + e2[0] * Math.sin(W), e1[1] * Math.cos(W) + e2[1] * Math.sin(W), e1[2] * Math.cos(W) + e2[2] * Math.sin(W)];
      }
      const rT = lay.r * cfg.size * visit.zoom, rD = visit.rDot;
      const rEff = Math.exp(Math.log(rD) + (Math.log(rT) - Math.log(rD)) * visit.grow) * k;
      const fW = lay.r * k * Math.sqrt(3.0 * 3.0 - 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(world.p);
      const loc = quadAttr(world);
      gl.uniform2f(world.u.uC, cx, cy); gl.uniform1f(world.u.uF, fW);
      gl.uniform1f(world.u.uD, Math.sqrt((fW / rEff) * (fW / rEff) + 1));
      gl.uniformMatrix3fv(world.u.uV2C, false, gl3(tr(fr.c2v)));
      gl.uniform3fv(world.u.uPole, P); gl.uniform3fv(world.u.uMer, M);
      gl.uniform3fv(world.u.uSunDir, b.sunward);
      gl.uniform1f(world.u.uKind, cfg.kind); gl.uniform1f(world.u.uFade, Math.min(1, visit.grow * 4 + 0.2));
      gl.uniform3fv(world.u.uAtm, cfg.atm || [0, 0, 0]);
      gl.uniform1f(world.u.uRingIn, cfg.rings ? cfg.rings[0] : 0); gl.uniform1f(world.u.uRingOut, cfg.rings ? cfg.rings[1] : 0);
      gl.uniform1i(world.u.uTex, 5); gl.uniform1i(world.u.uRing, 6);
      if (!cfg.rings) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tex.world); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(loc);
    }

    function visitShift() { return lay.r * 0.32 * visit.grow * (lay.cx < canvas.clientWidth / 2 ? 1 : -1); }

    function visitDrag(dx, dy) {
      if (!visit || visit.phase !== 'there') return;
      const r = Math.max(60, lay.r);
      visit.az -= dx / r * 0.9;
      visit.el = Math.max(-1.35, Math.min(1.35, visit.el - dy / r * 0.9));
      visit.autoAt = performance.now() + 5000;                       // you're steering: no auto-orbit for a moment
      if (!running) draw(lastNow);
    }
    function visitZoom(kz) { if (visit && visit.phase === 'there') visit.zoom = Math.max(0.45, Math.min(2.4, visit.zoom * kz)); }

    /** The Sun, Moon or planet under a point on screen (CSS px), or null. */
    function bodyAt(x, y) {
      if (!frameInfo || visit) return null;
      let best = null, bd = 1e9;
      frameInfo.bodies.forEach(function (b) {
        if (!b.onScreen || b.behind || !WORLDS[b.id]) return;
        const r = (b.id === 'sun' ? 0.016 * frameInfo.fs : b.r) + 10, d = Math.hypot(b.x - x, b.y - y);
        if (d < r && d < bd) { bd = d; best = b.id; }
      });
      return best;
    }
    let onVisit = null;

    /** Where a place on Earth sits on screen (CSS px) and whether it faces us. */
    function project(lat, lon) {
      const v = app(tr(rotation()), unit(lat, lon));
      const f = lay.r * Math.sqrt(DIST * DIST - 1);
      const z = dist - v[2];
      return { x: lay.cx + f * v[0] / z, y: lay.cy - f * v[1] / z, visible: v[2] > 1 / dist + 0.04 };
    }

    /** The Sun, Moon and planets that are on screen and not behind the Earth, for labels (CSS px). */
    function bodies() {
      if (!frameInfo) return [];
      return frameInfo.bodies.filter(function (b) { return b.onScreen && !b.behind; }).map(function (b) {
        return { id: b.id, name: b.name, x: b.x, y: b.y, r: b.id === 'sun' ? 0.016 * frameInfo.fs : b.r };
      });
    }

    function tick(t) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (t - lastFrame < 33) return;                // 30 frames a second is plenty for a wallpaper
      lastFrame = t;
      sway.x += (sway.tx - sway.x) * 0.06; sway.y += (sway.ty - sway.y) * 0.06;
      stepVisit();
      if (!visit) stepZoom();
      draw(Date.now());
    }

    let springOn = false, resumeDrift = false;
    function start() {
      if (running) return;
      running = true; raf = requestAnimationFrame(tick);
      if (resumeDrift) { resumeDrift = false; release(3000); }
    }
    /** Stop animating (the desktop is covered). A pending drift home picks up again on start. */
    function stop() {
      running = false; cancelAnimationFrame(raf);
      if (springOn) { cancelAnimationFrame(spring); springOn = false; resumeDrift = true; }
    }

    function drag(dx, dy) {
      const r = Math.max(60, lay.r * zoom());
      view.lon -= dx / r * 50;
      view.lat = Math.max(-82, Math.min(82, view.lat + dy / r * 50));
      cancelAnimationFrame(spring); springOn = false; resumeDrift = false;
      if (!running) draw(lastNow);
    }

    /** After a drag, stay a while so you can look around, then drift back to the resting view. */
    function release(delayMs) {
      if (held) return;                                   // looking at a plane: stay until it's closed
      flyTo(rest, delayMs, 3200, true);
    }

    function flyTo(target, delayMs, dur, home) {
      cancelAnimationFrame(spring);
      springOn = home;
      const t0 = performance.now() + (delayMs || 0);
      let from = null, dl = 0;
      const step = function (t) {
        if (t < t0) { spring = requestAnimationFrame(step); return; }
        if (!from) { from = { lat: view.lat, lon: view.lon, dist: dist }; dl = ((target.lon - from.lon) % 360 + 540) % 360 - 180; anchor = null; }
        const p = Math.max(0, Math.min(1, (t - t0) / dur));
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        view.lat = from.lat + (target.lat - from.lat) * e;
        view.lon = from.lon + dl * e;
        if (home) { dist = from.dist + (DIST - from.dist) * e; distTarget = dist; }   // going home zooms back out too
        if (!running) draw(lastNow);
        if (p < 1) spring = requestAnimationFrame(step); else springOn = false;
      };
      spring = requestAnimationFrame(step);
    }

    /** The mouse leans the camera a little (nx, ny from -1 to 1). */
    function point(nx, ny) { const z = zoom(); sway.tx = nx * 1.6 / z; sway.ty = -ny * 1.0 / z; }

    /** The place on Earth under a point on screen (CSS px), or null if it's sky. */
    function placeAt(x, y) {
      const f = lay.r * Math.sqrt(DIST * DIST - 1);
      const d = norm([(x - lay.cx) / f, -(y - lay.cy) / f, -1]);
      const b = dist * d[2], disc = b * b - (dist * dist - 1);
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      const p = app(rotation(), [d[0] * t, d[1] * t, dist + d[2] * t]);
      return { lat: Math.asin(Math.max(-1, Math.min(1, p[1]))) / RAD, lon: Math.atan2(p[0], p[2]) / RAD };
    }

    /** Zoom by a factor (more than 1 is closer), keeping the place under (x, y) where it is. */
    function zoomBy(k, x, y) {
      const z = Math.max(1, Math.min(Math.sqrt(DIST * DIST - 1) / Math.sqrt(MIN_DIST * MIN_DIST - 1), zoomOf(distTarget) * k));
      distTarget = Math.sqrt((DIST * DIST - 1) / (z * z) + 1);
      const at = x === undefined ? null : placeAt(x, y);
      anchor = at ? { x: x, y: y, lat: at.lat, lon: at.lon } : null;
      cancelAnimationFrame(spring); springOn = false; resumeDrift = false;
      if (!running) { dist = distTarget; keepAnchor(); draw(lastNow); }
    }
    function zoomOf(d) { return Math.sqrt(DIST * DIST - 1) / Math.sqrt(d * d - 1); }

    function keepAnchor() {
      if (!anchor) return;
      for (let i = 0; i < 3; i++) {
        const cur = placeAt(anchor.x, anchor.y);
        if (!cur) return;
        view.lat = Math.max(-82, Math.min(82, view.lat + (anchor.lat - cur.lat)));
        view.lon += ((anchor.lon - cur.lon) % 360 + 540) % 360 - 180;
      }
    }

    let zoomT = 0;
    function stepZoom() {
      const t = performance.now(), dt = Math.min(0.5, (t - (zoomT || t)) / 1000);
      zoomT = t;
      if (Math.abs(dist - distTarget) < 1e-4) { if (dist !== distTarget) { dist = distTarget; keepAnchor(); } return; }
      dist += (distTarget - dist) * (1 - Math.exp(-dt / 0.12));   // smooth, and just as quick at any frame rate
      keepAnchor();
    }

    function layout(cx, cy, r) { lay = { cx: cx, cy: cy, r: r }; if (!running) draw(lastNow); }

    return {
      draw: draw, drag: drag, release: release, project: project, bodies: bodies, point: point, layout: layout,
      start: start, stop: stop, setClouds: setClouds, view: view, rest: rest,
      setPlanes: setPlanes, planeNear: planeNear, planeScreen: planeScreen, planeAt: planeAt, setSelected: setSelected, setHovered: setHovered,
      setRoute: setRoute, lookAt: lookAt, hold: hold, zoomBy: zoomBy, zoom: zoom, setMaps: setMaps, placeAt: placeAt,
      bodyAt: bodyAt, visit: visitTo, leave: visitLeave, visitDrag: visitDrag, visitZoom: visitZoom,
      visiting: function () { return visit ? visit.id : null; }, set onVisit(f) { onVisit = f; },
      set onReady(f) { onReady = f; if (ready) f(); }, set onFrame(f) { onFrame = f; }
    };
  }

  const api = { Scene: Scene, subsolar: subsolar, roughSubsolar: roughSubsolar, sunTimes: sunTimes, DIST: DIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusEarth = api;
})(this);
