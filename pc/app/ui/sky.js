// Where the Sun, the Moon and the planets are right now, as seen from the centre of the Earth.
// Planets: JPL's approximate Keplerian elements (Standish, valid 1800–2050), good to well under a degree.
// Moon: the low-precision series from the Astronomical Almanac, good to about 0.3°.
// Positions come back as vectors in AU in the equatorial frame used by the desktop scene:
// x toward RA 6h, y toward the north celestial pole, z toward RA 0h (the March equinox).
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  const OBLIQUITY = 23.43928 * RAD;

  // a (AU), e, I, L, long. of perihelion, long. of node (deg) and their rates per Julian century from J2000
  const ELEMENTS = {
    mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
      0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
      0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
    earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
      0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
      0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
      -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
      -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
      -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
      0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]
  };
  const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  const NAMES = { sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };

  function jd(ms) { return ms / 86400000 + 2440587.5; }
  function wrap360(x) { return ((x % 360) + 360) % 360; }

  /** Greenwich mean sidereal time in degrees. */
  function gmst(ms) { return wrap360(280.46061837 + 360.98564736629 * (jd(ms) - 2451545.0)); }

  /** Heliocentric ecliptic position (AU) of a planet from its elements. */
  function helio(name, T) {
    const k = ELEMENTS[name];
    const a = k[0] + k[6] * T, e = k[1] + k[7] * T, I = (k[2] + k[8] * T) * RAD;
    const L = k[3] + k[9] * T, peri = k[4] + k[10] * T, node = k[5] + k[11] * T;
    const w = (peri - node) * RAD, O = node * RAD;
    let M = wrap360(L - peri); if (M > 180) M -= 360;
    M *= RAD;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    return [
      (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      (sw * sI) * xp + (cw * sI) * yp
    ];
  }

  /** Ecliptic (x to the equinox, z to the ecliptic pole) → the scene's equatorial frame. */
  function toScene(v) {
    const x = v[0], y = v[1] * Math.cos(OBLIQUITY) - v[2] * Math.sin(OBLIQUITY), z = v[1] * Math.sin(OBLIQUITY) + v[2] * Math.cos(OBLIQUITY);
    return [y, z, x];
  }

  function moonEcliptic(T) {
    const s = function (a, b) { return Math.sin((a + b * T) * RAD); };
    const c = function (a, b) { return Math.cos((a + b * T) * RAD); };
    const lam = 218.32 + 481267.881 * T + 6.29 * s(134.9, 477198.85) - 1.27 * s(259.2, -413335.38) + 0.66 * s(235.7, 890534.23)
      + 0.21 * s(269.9, 954397.70) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.6, 966404.05);
    const beta = 5.13 * s(93.3, 483202.03) + 0.28 * s(228.2, 960400.87) - 0.28 * s(318.3, 6003.18) - 0.17 * s(217.6, -407332.20);
    const par = 0.9508 + 0.0518 * c(134.9, 477198.85) + 0.0095 * c(259.2, -413335.38) + 0.0078 * c(235.7, 890534.23) + 0.0028 * c(269.9, 954397.70);
    const r = 1 / Math.sin(par * RAD) * 4.2635e-5;           // Earth radii → AU
    const l = (lam - 1.397 * T) * RAD, b = beta * RAD;          // of date → J2000, like the planets
    return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
  }

  function radec(v) {
    const r = Math.hypot(v[0], v[1], v[2]);
    return { ra: wrap360(Math.atan2(v[0], v[2]) / RAD), dec: Math.asin(v[1] / r) / RAD, dist: r };
  }

  /**
   * Everything at a moment: { gmst, bodies: [{ id, name, pos:[x,y,z] AU, ra, dec, dist, sunward:[unit vector from the body to the Sun] }] }
   * The Sun comes first, then the Moon, then the planets.
   */
  function at(ms) {
    const T = (jd(ms) - 2451545.0) / 36525;
    const earth = helio('earth', T);
    const out = [];
    const sunEcl = [-earth[0], -earth[1], -earth[2]];
    const sun = toScene(sunEcl);
    const add = function (id, pos) {
      const d = radec(pos);
      const tw = [sun[0] - pos[0], sun[1] - pos[1], sun[2] - pos[2]];
      const tl = Math.hypot(tw[0], tw[1], tw[2]) || 1;
      out.push({ id: id, name: NAMES[id], pos: pos, ra: d.ra, dec: d.dec, dist: d.dist, sunward: [tw[0] / tl, tw[1] / tl, tw[2] / tl] });
    };
    add('sun', sun);
    add('moon', toScene(moonEcliptic(T)));
    PLANETS.forEach(function (p) {
      const h = helio(p, T);
      add(p, toScene([h[0] - earth[0], h[1] - earth[1], h[2] - earth[2]]));
    });
    return { gmst: gmst(ms), bodies: out };
  }

  /** The Moon's lit fraction (0 new … 1 full). */
  function moonPhase(sky) {
    const m = sky.bodies[1], toEarth = [-m.pos[0], -m.pos[1], -m.pos[2]];
    const l = Math.hypot(toEarth[0], toEarth[1], toEarth[2]);
    const cosI = (m.sunward[0] * toEarth[0] + m.sunward[1] * toEarth[1] + m.sunward[2] * toEarth[2]) / l;
    return (1 + cosI) / 2;
  }

  const api = { at: at, gmst: gmst, moonPhase: moonPhase, NAMES: NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusSky = api;
})(this);
