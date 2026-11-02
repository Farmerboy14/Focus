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
    '  vec2 t = vec2(fract(atan(c.x, c.z) / (2.0 * PI)), 0.5 - asin(clamp(c.y, -1.0, 1.0)) / PI);',
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

  const EARTH_FS = [
    'precision highp float;', RAY,
    'uniform float uD; uniform mat3 uRot; uniform vec3 uSun; uniform vec3 uHome; uniform float uHalo; uniform vec3 uSunPx; uniform float uRpx;',
    'uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uWater; uniform sampler2D uClouds;',
    'const float PI = 3.14159265;',
    'vec2 ll(vec3 n){ return vec2(0.5 + atan(n.x, n.z) / (2.0 * PI), 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI); }',
    'float cloud(vec3 n){ return smoothstep(0.10, 0.85, texture2D(uClouds, ll(n)).r); }',
    'vec3 haloColor(vec3 nE, vec3 dE){',
    '  float lit = clamp(dot(nE, uSun) * 0.8 + 0.35, 0.0, 1.0);',
    // looking toward the Sun through the air lights it up: a bright blue-white ring at the edge
    '  float fwd = uSunPx.z * exp(-length(gl_FragCoord.xy - uSunPx.xy) / (uRpx * 0.55));',
    '  return vec3(0.36, 0.62, 1.0) * (0.18 + 0.55 * lit) + vec3(0.75, 0.82, 1.0) * fwd * 1.2;',
    '}',
    'void main(){',
    '  vec3 d = rayDir();',
    '  vec3 O = vec3(0.0, 0.0, uD);',
    '  float b = dot(O, d);',
    '  float h = sqrt(max(uD * uD - b * b, 0.0));',              // how close the ray passes to the centre
    '  vec3 dE = uRot * d;',
    '  if (h >= 1.0) {',
    '    float k = clamp((1.0 + uHalo - h) / uHalo, 0.0, 1.0);',
    '    if (k <= 0.0) { gl_FragColor = vec4(0.0); return; }',
    '    vec3 nE = uRot * normalize(O - b * d);',
    '    vec3 hc = haloColor(nE, dE);',
    '    float a = k * k;',
    '    vec3 c = hc * a;',
    '    gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0) * 0.9);',
    '    return;',
    '  }',
    '  vec3 p = O + (-b - sqrt(b * b - (uD * uD - 1.0))) * d;',
    '  vec3 n = uRot * p;',
    '  vec2 t = ll(n);',
    '  vec3 day = texture2D(uDay, t).rgb;',
    '  vec3 night = texture2D(uNight, t).rgb;',
    '  float water = texture2D(uWater, t).r;',
    '  float cl = cloud(n);',
    '  float shadow = cloud(normalize(n + uSun * 0.010));',
    '  float l = dot(n, uSun);',
    '  float dayMix = smoothstep(-0.10, 0.14, l);',
    '  vec3 nightBase = night * vec3(0.30, 0.36, 0.58) * (1.0 - 0.5 * cl);',
    // no dark seam at the terminator: the day side never drops below the night side's own glow
    '  vec3 dayCol = day * (0.07 + 1.05 * clamp(l, 0.0, 1.0)) * (1.0 - 0.38 * shadow * (1.0 - cl)) + nightBase * 0.85;',
    '  vec3 lights = max(night - vec3(0.22), vec3(0.0)) * vec3(2.6, 2.1, 1.3) * (1.0 - 0.8 * cl);',
    '  vec3 nightCol = nightBase + lights + vec3(0.035, 0.045, 0.075) * cl;',
    '  vec3 col = mix(nightCol, dayCol, dayMix);',
    // clouds catch the light: bright white by day, glowing orange along the sunset line
    '  vec3 cloudCol = vec3(1.0, 0.99, 0.97) * (0.06 + 1.1 * clamp(l + 0.04, 0.0, 1.0));',
    '  cloudCol += vec3(0.55, 0.24, 0.08) * exp(-pow((l - 0.02) / 0.035, 2.0)) * 0.32;',
    '  col = mix(col, cloudCol, cl * 0.92 * smoothstep(-0.12, 0.05, l));',
    '  col += vec3(0.38, 0.15, 0.04) * exp(-pow((l - 0.03) / 0.04, 2.0)) * 0.16 * (1.0 - cl);',
    '  vec3 view = -dE;',
    '  vec3 hv = normalize(uSun + view);',
    '  float sh = max(dot(n, hv), 0.0);',
    '  col += vec3(1.0, 0.93, 0.80) * pow(sh, 220.0) * 0.24 * water * dayMix * (1.0 - cl);',
    '  float mu = clamp(dot(p, -d), 0.0, 1.0);',
    '  float rim = pow(1.0 - mu, 2.6);',
    '  col = mix(col, vec3(0.42, 0.66, 1.0), rim * (0.25 + 0.5 * dayMix) * 0.8);',
    '  float ang = acos(clamp(dot(n, uHome), -1.0, 1.0));',
    '  col = mix(col, vec3(0.95, 0.83, 0.54), smoothstep(0.0135, 0.0095, ang));',
    '  col = mix(col, haloColor(n, dE), smoothstep(0.985, 1.0, h) * 0.85);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    const s = gl.createShader(type);
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
  // North poles (RA, Dec in degrees, J2000)
  const POLES = { moon: [270.0, 66.5], mercury: [281.0, 61.4], venus: [272.8, 67.2], mars: [317.7, 52.9], jupiter: [268.1, 64.5], saturn: [40.6, 83.5], uranus: [257.3, -15.2], neptune: [299.4, 43.5] };

  /**
   * Scene(canvas, { home, images: {day, night, water, clouds, milky}, stars: [ra,dec,mag,ci,...], sky: FocusSky })
   * The canvas covers the screen; layout(cx, cy, r) says where the Earth sits (CSS px) and how big.
   */
  function Scene(canvas, opts) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL');
    const SKY = opts.sky;
    const sky = program(gl, QUAD_VS, SKY_FS, ['uC', 'uFs', 'uV2C', 'uSunC', 'uMilky', 'uGain']);
    const star = program(gl, STAR_VS, STAR_FS, ['uC2V', 'uC', 'uFs', 'uRes', 'uTime', 'uScale']);
    const body = program(gl, BODY_VS, BODY_FS, ['uPos', 'uExt', 'uRes', 'uRad', 'uLight', 'uPole', 'uKind', 'uCol', 'uCol2']);
    const earth = program(gl, QUAD_VS, EARTH_FS, ['uC', 'uF', 'uD', 'uRot', 'uSun', 'uHome', 'uHalo', 'uSunPx', 'uRpx', 'uDay', 'uNight', 'uWater', 'uClouds']);

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
    const tex = {};
    let ready = false, onReady = null, onFrame = null, spring = 0, raf = 0, running = false, lastFrame = 0;
    let lay = { cx: 0, cy: 0, r: 100 }, lastNow = Date.now(), skyAt = null, frameInfo = null;

    function texture(name, unitN, img, wrapS) {
      if (!tex[name]) tex[name] = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unitN);
      gl.bindTexture(gl.TEXTURE_2D, tex[name]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS === false ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const UNITS = { day: 0, night: 1, water: 2, clouds: 3, milky: 4 };
    const im = opts.images;
    Promise.all([loadImage(im.day), loadImage(im.night), loadImage(im.water), loadImage(im.milky)]).then(function (ims) {
      texture('day', 0, ims[0]); texture('night', 1, ims[1]); texture('water', 2, ims[2]); texture('milky', 4, ims[3]);
      // clouds are optional; until they arrive the sky is clear
      const blank = new Uint8Array([0, 0, 0, 255]);
      if (!tex.clouds) {
        tex.clouds = gl.createTexture();
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, tex.clouds);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
      }
      return setClouds(im.clouds).catch(function () { });
    }).then(function () {
      ready = true;
      draw(lastNow);
      if (onReady) onReady();
    }).catch(function (e) { console.warn(e.message); });

    function setClouds(src) {
      return loadImage(src).then(function (img) { texture('clouds', 3, img); if (ready) draw(lastNow); });
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
      const c2e = tr(turn(s.gmst));                  // equatorial → earth-fixed (undoes the Earth's turn)
      const c2v = mul(tr(R), c2e);
      const f = lay.r * Math.sqrt(DIST * DIST - 1);
      // the far corners of the screen stay within about 115° of straight behind the Earth, where the fisheye still looks right
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const corner = Math.max(Math.hypot(lay.cx, lay.cy), Math.hypot(W - lay.cx, lay.cy), Math.hypot(lay.cx, H - lay.cy), Math.hypot(W - lay.cx, H - lay.cy));
      const fs = Math.max(lay.r * SKY_SCALE, corner / 2.0);
      const sunC = norm(s.bodies[0].pos);
      const out = [];
      s.bodies.forEach(function (b) {
        const v = app(c2v, norm(b.pos));
        const th = Math.acos(Math.max(-1, Math.min(1, -v[2]))), l = Math.hypot(v[0], v[1]) || 1e-9;
        const x = lay.cx + fs * th * v[0] / l, y = lay.cy - fs * th * v[1] / l;
        const behind = Math.hypot(x - lay.cx, y - lay.cy) < lay.r * 1.02;   // hidden by the Earth
        const look = LOOKS[b.id];
        out.push({ id: b.id, name: b.name, x: x, y: y, v: v, behind: behind, r: look ? look.size * lay.r : 0, body: b,
          onScreen: th < 3.0 && x > -40 && y > -40 && x < canvas.clientWidth + 40 && y < canvas.clientHeight + 40 });
      });
      return { R: R, c2e: c2e, c2v: c2v, f: f, fs: fs, sunC: sunC, sunE: app(c2e, sunC), bodies: out, sky: s };
    }

    function draw(now) {
      lastNow = now || Date.now();
      if (!ready) return;
      const sz = size();
      const fr = frame(lastNow);
      frameInfo = fr;
      const k = sz.dpr;
      const cx = lay.cx * k, cy = sz.h - lay.cy * k, f = fr.f * k, fs = fr.fs * k;
      gl.viewport(0, 0, sz.w, sz.h);
      gl.disable(gl.BLEND);

      // 1. the sky
      gl.useProgram(sky.p);
      let loc = quadAttr(sky);
      gl.uniform2f(sky.u.uC, cx, cy); gl.uniform1f(sky.u.uFs, fs);
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
      gl.uniform2f(star.u.uC, cx, cy); gl.uniform1f(star.u.uFs, fs); gl.uniform2f(star.u.uRes, sz.w, sz.h);
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

      // 4. the Earth and its air, over everything
      gl.useProgram(earth.p);
      loc = quadAttr(earth);
      gl.uniform2f(earth.u.uC, cx, cy); gl.uniform1f(earth.u.uF, f); gl.uniform1f(earth.u.uD, DIST);
      gl.uniformMatrix3fv(earth.u.uRot, false, gl3(fr.R));
      gl.uniform3fv(earth.u.uSun, fr.sunE);
      gl.uniform3fv(earth.u.uHome, homeV);
      gl.uniform1f(earth.u.uHalo, 0.085);
      const sun = fr.bodies[0];
      gl.uniform3f(earth.u.uSunPx, sun.x * k, sz.h - sun.y * k, sun.onScreen ? 1 : 0);
      gl.uniform1f(earth.u.uRpx, lay.r * k);
      gl.uniform1i(earth.u.uDay, 0); gl.uniform1i(earth.u.uNight, 1); gl.uniform1i(earth.u.uWater, 2); gl.uniform1i(earth.u.uClouds, 3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(loc);
      if (onFrame) onFrame();
    }

    /** Where a place on Earth sits on screen (CSS px) and whether it faces us. */
    function project(lat, lon) {
      const v = app(tr(rotation()), unit(lat, lon));
      const f = lay.r * Math.sqrt(DIST * DIST - 1);
      const z = DIST - v[2];
      return { x: lay.cx + f * v[0] / z, y: lay.cy - f * v[1] / z, visible: v[2] > 1 / DIST + 0.04 };
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
      const r = Math.max(60, lay.r);
      view.lon -= dx / r * 50;
      view.lat = Math.max(-82, Math.min(82, view.lat + dy / r * 50));
      cancelAnimationFrame(spring); springOn = false; resumeDrift = false;
      if (!running) draw(lastNow);
    }

    /** After a drag, stay a while so you can look around, then drift back to the resting view. */
    function release(delayMs) {
      cancelAnimationFrame(spring);
      springOn = true;
      const t0 = performance.now() + (delayMs || 0);
      let from = null, dl = 0;
      const step = function (t) {
        if (t < t0) { spring = requestAnimationFrame(step); return; }
        if (!from) { from = { lat: view.lat, lon: view.lon }; dl = ((rest.lon - from.lon) % 360 + 540) % 360 - 180; }
        const p = Math.max(0, Math.min(1, (t - t0) / 3200));
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        view.lat = from.lat + (rest.lat - from.lat) * e;
        view.lon = from.lon + dl * e;
        if (!running) draw(lastNow);
        if (p < 1) spring = requestAnimationFrame(step); else springOn = false;
      };
      spring = requestAnimationFrame(step);
    }

    /** The mouse leans the camera a little (nx, ny from -1 to 1). */
    function point(nx, ny) { sway.tx = nx * 1.6; sway.ty = -ny * 1.0; }

    function layout(cx, cy, r) { lay = { cx: cx, cy: cy, r: r }; if (!running) draw(lastNow); }

    return {
      draw: draw, drag: drag, release: release, project: project, bodies: bodies, point: point, layout: layout,
      start: start, stop: stop, setClouds: setClouds, view: view, rest: rest,
      set onReady(f) { onReady = f; if (ready) f(); }, set onFrame(f) { onFrame = f; }
    };
  }

  const api = { Scene: Scene, subsolar: subsolar, roughSubsolar: roughSubsolar, sunTimes: sunTimes, DIST: DIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusEarth = api;
})(this);
