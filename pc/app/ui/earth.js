// The Earth, lit the way it is right now: day where the sun is up, city lights on the night side, sun glint on
// the oceans, a thin atmosphere at the edge. Drawn by one WebGL fragment shader on a square canvas; it only
// redraws when it has to (a drag, a resize, or once a minute as the sun moves).
// NASA Blue Marble (day) and Black Marble (night) imagery, public domain.
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;

  /** Where the sun is overhead right now: subsolar latitude and longitude in degrees. Good to a fraction of a degree. */
  function subsolar(ms) {
    const d = new Date(ms);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const n = (ms - start) / 86400000;                      // day of the year, fractional
    const b = 2 * Math.PI * (n - 81) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // equation of time, minutes
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
    const h = Math.acos(cosH) / RAD / 15;                  // hours from solar noon
    const solarNoonUtcH = 12 - lon / 15 - s.eot / 60;
    const day0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    // The local date's solar noon falls on the UTC date of the local calendar day for western longitudes too.
    const noon = day0 + solarNoonUtcH * 3600000;
    return { rise: noon - h * 3600000, set: noon + h * 3600000 };
  }

  function unit(lat, lon) {
    const a = lat * RAD, o = lon * RAD;
    return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
  }

  const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FS = [
    'precision highp float;',
    'uniform vec2 uRes; uniform float uR; uniform mat3 uRot; uniform vec3 uSun; uniform vec3 uHome;',
    'uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uWater;',
    'const float PI = 3.14159265;',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uR;',
    '  float d = length(uv);',
    '  if (d > 1.0) {',
    // atmosphere halo outside the disc, brighter on the sunlit limb
    '    float h = clamp((1.09 - d) / 0.09, 0.0, 1.0);',
    '    vec3 nv = normalize(vec3(uv / d, 0.0));',
    '    float lit = clamp(dot(uRot * nv, uSun) * 0.8 + 0.35, 0.0, 1.0);',
    '    float a = h * h * (0.18 + 0.55 * lit);',
    '    gl_FragColor = vec4(vec3(0.36, 0.62, 1.0) * a, a);',
    '    return;',
    '  }',
    '  vec3 nv = vec3(uv, sqrt(1.0 - d * d));',
    '  vec3 n = uRot * nv;',
    '  float lat = asin(clamp(n.y, -1.0, 1.0));',
    '  float lon = atan(n.x, n.z);',
    '  vec2 t = vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);',
    '  vec3 day = texture2D(uDay, t).rgb;',
    '  vec3 night = texture2D(uNight, t).rgb;',
    '  float water = texture2D(uWater, t).r;',
    '  float l = dot(n, uSun);',
    '  float dayMix = smoothstep(-0.10, 0.14, l);',
    '  vec3 dayCol = day * (0.18 + 1.05 * clamp(l, 0.0, 1.0));',
    // city lights: the bright parts of the night image, warm; the rest of the night side stays deep blue
    '  vec3 lights = max(night - vec3(0.22), vec3(0.0)) * vec3(2.6, 2.1, 1.3);',
    '  vec3 nightCol = night * vec3(0.30, 0.36, 0.58) + lights;',
    '  vec3 col = mix(nightCol, dayCol, dayMix);',
    // a hint of sunset colour along the terminator
    '  col += vec3(0.38, 0.15, 0.04) * exp(-pow((l - 0.02) / 0.045, 2.0)) * 0.28;',
    '  vec3 view = uRot * vec3(0.0, 0.0, 1.0);',
    '  vec3 hv = normalize(uSun + view);',
    '  float sh = max(dot(n, hv), 0.0);',
    '  col += vec3(1.0, 0.93, 0.80) * pow(sh, 160.0) * 0.26 * water * dayMix;',
    '  float rim = pow(1.0 - nv.z, 2.6);',
    '  col = mix(col, vec3(0.42, 0.66, 1.0), rim * (0.25 + 0.5 * dayMix) * 0.8);',
    // home: a small gold dot
    '  float ang = acos(clamp(dot(n, uHome), -1.0, 1.0));',
    '  col = mix(col, vec3(0.95, 0.83, 0.54), smoothstep(0.0135, 0.0095, ang));',
    // the last sliver blends into the atmosphere, so there's no dark seam at the edge
    '  float lit = clamp(dot(n, uSun) * 0.8 + 0.35, 0.0, 1.0);',
    '  vec3 haloCol = vec3(0.36, 0.62, 1.0) * (0.18 + 0.55 * lit);',
    '  col = mix(col, haloCol, smoothstep(0.985, 1.0, d) * 0.85);',
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

  function loadImage(src) {
    if (src && typeof src.then === 'function') return src.then(loadImage);
    if (!src || typeof src !== 'string') return Promise.reject(new Error('no image'));
    return new Promise(function (resolve, reject) {
      const im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('could not load ' + src)); };
      im.src = src;
    });
  }

  /**
   * Globe(canvas, { home: {lat, lon}, images: {day, night, water} }) → { draw(now), drag(dx, dy), release(), view, project(lat, lon) }
   * The canvas is sized by CSS; the globe fills it with room for the atmosphere.
   */
  function Globe(canvas, opts) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uR', 'uRot', 'uSun', 'uHome', 'uDay', 'uNight', 'uWater'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(U.uDay, 0); gl.uniform1i(U.uNight, 1); gl.uniform1i(U.uWater, 2);

    const home = opts.home || { lat: 40.19, lon: -92.58 };
    gl.uniform3fv(U.uHome, unit(home.lat, home.lon));
    // The resting view: home a little right of centre, the Atlantic and Europe toward the morning edge.
    const rest = { lat: 24, lon: home.lon + 22 };
    const view = { lat: rest.lat, lon: rest.lon };
    let ready = false, lastNow = Date.now(), spring = 0, onReady = null;

    function tex(unitN, img) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unitN);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    Promise.all([loadImage(opts.images.day), loadImage(opts.images.night), loadImage(opts.images.water)]).then(function (ims) {
      tex(0, ims[0]); tex(1, ims[1]); tex(2, ims[2]);
      ready = true;
      draw(lastNow);
      if (onReady) onReady();
    }).catch(function (e) { console.warn(e.message); });

    function rotation() {
      // view → earth: Ry(lon) · Rx(-lat), column-major for WebGL
      const a = -view.lat * RAD, o = view.lon * RAD;
      const ca = Math.cos(a), sa = Math.sin(a), co = Math.cos(o), so = Math.sin(o);
      // Rx(a) = [[1,0,0],[0,ca,-sa],[0,sa,ca]], Ry(o) = [[co,0,so],[0,1,0],[-so,0,co]]
      const m = [
        [co, so * sa, so * ca],
        [0, ca, -sa],
        [-so, co * sa, co * ca]
      ];
      return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
    }

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w: w, h: h };
    }

    function draw(now) {
      lastNow = now || Date.now();
      if (!ready) return;
      const s = size();
      gl.viewport(0, 0, s.w, s.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const sun = subsolar(lastNow);
      gl.uniform2f(U.uRes, s.w, s.h);
      gl.uniform1f(U.uR, Math.min(s.w, s.h) / 2 / 1.1);
      gl.uniformMatrix3fv(U.uRot, false, rotation());
      gl.uniform3fv(U.uSun, unit(sun.lat, sun.lon));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** Where a place sits on the canvas (CSS px) and whether it faces us. */
    function project(lat, lon) {
      const p = unit(lat, lon);
      const m = rotation(); // columns: earth axes in view space are the rows of this (it's orthonormal)
      // view = R^T · p ; R stored column-major, so R^T rows are the stored columns
      const x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
      const y = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
      const z = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
      const r = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / 1.1;
      return { x: canvas.clientWidth / 2 + x * r, y: canvas.clientHeight / 2 - y * r, visible: z > 0.05 };
    }

    function drag(dx, dy) {
      const r = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / 1.1;
      view.lon -= dx / r * 57.3;
      view.lat = Math.max(-70, Math.min(70, view.lat + dy / r * 57.3));
      cancelAnimationFrame(spring);
      draw(lastNow);
    }

    /** After a drag, drift back to the resting view. */
    function release(delayMs) {
      cancelAnimationFrame(spring);
      const t0 = performance.now() + (delayMs || 0);
      const from = { lat: view.lat, lon: view.lon };
      let dl = ((rest.lon - from.lon) % 360 + 540) % 360 - 180;
      const step = function (t) {
        const p = Math.max(0, Math.min(1, (t - t0) / 2200));
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        view.lat = from.lat + (rest.lat - from.lat) * e;
        view.lon = from.lon + dl * e;
        draw(lastNow);
        if (p < 1) spring = requestAnimationFrame(step);
      };
      spring = requestAnimationFrame(step);
    }

    return { draw: draw, drag: drag, release: release, project: project, view: view, set onReady(f) { onReady = f; if (ready) f(); } };
  }

  const api = { Globe: Globe, subsolar: subsolar, sunTimes: sunTimes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusEarth = api;
})(this);
