#!/usr/bin/env python3
"""Builds the sky for the living desktop:
  app/res/img/milkyway.jpg      the Milky Way, painted procedurally, as an RA/Dec equirectangular map
  app/res/img/earth_clouds.jpg  a made-up cloud map, used only until the first live cloud map arrives
  app/ui/stars-data.js          the naked-eye stars (to magnitude 6.3) from the HYG database

Usage: python3 tools/make-sky.py path/to/hygdata_v41.csv
HYG database by David Nash, https://codeberg.org/astronexus/hyg, CC BY-SA 4.0.
"""
import csv
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app')
rng = np.random.default_rng(14)


_TABLES = {}


def vnoise(p, seed):
    """Smooth 3D value noise (-1..1) from a 64-cell lattice; sampling it on the unit sphere makes seamless maps."""
    if seed not in _TABLES:
        _TABLES[seed] = np.random.default_rng(seed).uniform(-1, 1, (64, 64, 64)).astype(np.float32)
    t = _TABLES[seed]
    p = p + 32.0
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * f * (f * (f * 6 - 15) + 10)
    i0 = i % 64
    i1 = (i + 1) % 64
    x0, y0, z0 = i0[..., 0], i0[..., 1], i0[..., 2]
    x1, y1, z1 = i1[..., 0], i1[..., 1], i1[..., 2]
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    def lerp(a, b, u): return a + (b - a) * u
    c00 = lerp(t[x0, y0, z0], t[x1, y0, z0], fx)
    c10 = lerp(t[x0, y1, z0], t[x1, y1, z0], fx)
    c01 = lerp(t[x0, y0, z1], t[x1, y0, z1], fx)
    c11 = lerp(t[x0, y1, z1], t[x1, y1, z1], fx)
    return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz)


def fbm(v, seed, f0=2.0, octaves=6, gain=0.55):
    out = np.zeros(v.shape[:-1], np.float32)
    amp, tot, f = 1.0, 0.0, f0
    for o in range(octaves):
        out += amp * vnoise(v * f, seed + o)
        tot += amp
        amp *= gain
        f *= 2.03
    return out / tot


def sphere_grid(w, h):
    ra = (np.arange(w) + 0.5) / w * 2 * math.pi
    dec = math.pi / 2 - (np.arange(h) + 0.5) / h * math.pi
    RA, DEC = np.meshgrid(ra, dec)
    return RA, DEC


def milky_way(w=2048, h=1024):
    RA, DEC = sphere_grid(w, h)
    eq = np.stack([np.cos(DEC) * np.cos(RA), np.cos(DEC) * np.sin(RA), np.sin(DEC)], -1)
    M = np.array([[-0.0548755604, -0.8734370902, -0.4838350155],
                  [0.4941094279, -0.4448296300, 0.7469822445],
                  [-0.8676661490, -0.1980763734, 0.4559837762]])
    g = eq @ M.T
    l = np.degrees(np.arctan2(g[..., 1], g[..., 0]))          # -180..180, 0 = galactic centre
    b = np.degrees(np.arcsin(np.clip(g[..., 2], -1, 1)))
    n1 = fbm(g, 5, f0=4.0) * 1.8                              # big clouds of stars
    n2 = fbm(g, 77, f0=22.0, octaves=4) * 1.8                 # fine grain
    n3 = fbm(g, 133, f0=10.0, octaves=5) * 1.8                # dust lanes
    width = 8.0 + 4.0 * np.cos(np.radians(l)) + 3.0 * n1
    band = np.exp(-(b / np.maximum(width, 2.5)) ** 2)
    along = 0.35 + 0.65 * np.exp(-(l / 75.0) ** 2)
    bulge = np.exp(-((l / 13.0) ** 2 + (b / 8.0) ** 2))
    glow = band * along * np.clip(0.75 + 0.6 * n1 + 0.35 * n2, 0.05, None) + 0.8 * bulge * (1 + 0.3 * n2)
    # dust: the great rift from Cygnus to the centre, and patchy lanes all along the plane
    rift = np.exp(-((b - 1.0 - 2.5 * n1) / 2.2) ** 2) * np.exp(-((l - 25) / 50.0) ** 2)
    lanes = np.clip(n3 + 0.15, 0, 1) * np.exp(-(b / 5.0) ** 2)
    glow *= (1 - 0.75 * np.clip(rift, 0, 1)) * (1 - 0.6 * lanes)
    v = np.clip(glow / 1.1, 0, 1) ** 1.1
    warm = np.clip(bulge * 1.5 + 0.2 * band, 0, 1)
    rgb = np.stack([v * (0.64 + 0.36 * warm), v * (0.68 + 0.22 * warm), v * (0.90 - 0.14 * warm)], -1) * 0.40
    base = 0.012 + 0.008 * np.clip(fbm(g, 201, f0=2.0, octaves=3) + 0.5, 0, 1)
    rgb += np.stack([base * 0.8, base * 0.85, base * 1.15], -1)
    out = (np.clip(rgb, 0, 1) * 255 + rng.uniform(0, 1, rgb.shape)).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(APP, 'res', 'img', 'milkyway.jpg'), quality=88)


def clouds(w=2048, h=1024):
    lon, lat = sphere_grid(w, h)
    v = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1).astype(np.float32)
    # twist the noise around, so it swirls like weather, then stretch it east-west a little
    warp = np.stack([fbm(v, 11, 2.5, 4), fbm(v, 12, 2.5, 4), fbm(v, 13, 2.5, 4)], -1) * 1.6
    q = v + 0.30 * warp
    warp2 = np.stack([fbm(q, 14, 5.0, 3), fbm(q, 15, 5.0, 3), fbm(q, 16, 5.0, 3)], -1) * 1.6
    q = (q + 0.05 * warp2) * np.array([1.0, 1.5, 1.0], np.float32)
    n = fbm(q, 21, f0=3.0, octaves=8, gain=0.52) * 1.7
    la = np.degrees(lat)
    # wetter near the equator and in the storm tracks, clearer in the subtropics
    cover = 0.05 * np.exp(-(la / 8.0) ** 2) - 0.10 * np.exp(-((np.abs(la) - 24) / 10.0) ** 2) \
        + 0.10 * np.exp(-((np.abs(la) - 55) / 14.0) ** 2)
    c = np.clip((n + cover + 0.12) * 1.35, 0, 1)
    c = c ** 1.6
    out = (c * 235).astype(np.uint8)
    Image.fromarray(out, 'L').save(os.path.join(APP, 'res', 'img', 'earth_clouds.jpg'), quality=85)


def stars(hyg):
    rows = []
    with open(hyg, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['proper'] == 'Sol':
                continue
            try:
                mag = float(r['mag'])
            except ValueError:
                continue
            if mag > 6.3:
                continue
            ra = float(r['ra']) * 15.0
            dec = float(r['dec'])
            try:
                ci = float(r['ci'])
            except ValueError:
                ci = 0.6
            rows.append((mag, ra, dec, ci))
    rows.sort()
    flat = []
    for mag, ra, dec, ci in rows:
        flat += [round(ra * 100), round(dec * 100), round(mag * 100), round(max(-0.4, min(2.0, ci)) * 100)]
    js = ('// The naked-eye stars, brightest first: [RA x100 deg, Dec x100 deg, magnitude x100, B-V colour x100] per star.\n'
          '// From the HYG database v4.1 by David Nash (codeberg.org/astronexus/hyg), CC BY-SA 4.0. Built by tools/make-sky.py.\n'
          'window.FocusStarData = [' + ','.join(str(x) for x in flat) + '];\n')
    with open(os.path.join(APP, 'ui', 'stars-data.js'), 'w') as f:
        f.write(js)
    print(len(rows), 'stars,', len(js), 'bytes')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        stars(sys.argv[1])
    if os.environ.get('ONLY') != 'clouds':
        milky_way()
    clouds()
