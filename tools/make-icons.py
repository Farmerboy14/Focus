#!/usr/bin/env python3
"""Builds Focus's "Night lines" icon pack from Lawnicons (github.com/LawnchairLauncher/lawnicons, Apache 2.0).

Every Lawnicons SVG becomes a compact list of strokes and fills that Focus draws itself with android.graphics.Path
(no image files, so ten thousand icons fit in a couple of megabytes and stay sharp at any size).

Usage: python3 tools/make-icons.py path/to/lawnicons
Writes app/assets/icons/lines.bin, app/assets/icons/index.txt and app/assets/icons/NOTICE.txt

lines.bin (big-endian):
  "FLI1", u32 icon count, then per icon: u16 byte length, then that many bytes of drawing ops:
    'W' i16 stroke width x4   (all following strokes use it)
    'S' / 'F'                 start a stroked / filled shape
    'M' x y, 'L' x y, 'C' x1 y1 x2 y2 x y, 'Z'   (i16, in 1/4 units of the 192 x 192 icon)
index.txt: one "package<TAB>icon number" per line.
"""
import os
import re
import struct
import sys

from svgelements import SVG, Shape, Path, Move, Line, CubicBezier, QuadraticBezier, Arc, Close

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'assets', 'icons')
Q = 4  # quarter units


def q(v):
    return max(-32768, min(32767, int(round(v * Q))))


def icon_ops(file):
    svg = SVG.parse(file, reify=True, width=192, height=192)
    out = bytearray()
    width = None
    for el in svg.elements():
        if not isinstance(el, Shape):
            continue
        stroked = el.stroke is not None and el.stroke.value is not None and el.stroke.alpha > 0 and (el.stroke_width or 0) > 0
        filled = el.fill is not None and el.fill.value is not None and el.fill.alpha > 0
        if not stroked and not filled:
            continue
        p = Path(el)
        segs = list(p.segments())
        if not segs:
            continue
        for mode in (['F'] if filled else []) + (['S'] if stroked else []):
            if mode == 'S':
                w = el.implicit_stroke_width if hasattr(el, 'implicit_stroke_width') else el.stroke_width
                if w != width:
                    out += b'W' + struct.pack('>h', q(w))
                    width = w
            out += mode.encode()
            for s in segs:
                if isinstance(s, Move):
                    out += b'M' + struct.pack('>hh', q(s.end.x), q(s.end.y))
                elif isinstance(s, Line):
                    out += b'L' + struct.pack('>hh', q(s.end.x), q(s.end.y))
                elif isinstance(s, Close):
                    out += b'Z'
                elif isinstance(s, CubicBezier):
                    out += b'C' + struct.pack('>hhhhhh', q(s.control1.x), q(s.control1.y), q(s.control2.x), q(s.control2.y), q(s.end.x), q(s.end.y))
                elif isinstance(s, QuadraticBezier):
                    a, c, e = s.start, s.control, s.end
                    c1 = (a.x + 2 / 3 * (c.x - a.x), a.y + 2 / 3 * (c.y - a.y))
                    c2 = (e.x + 2 / 3 * (c.x - e.x), e.y + 2 / 3 * (c.y - e.y))
                    out += b'C' + struct.pack('>hhhhhh', q(c1[0]), q(c1[1]), q(c2[0]), q(c2[1]), q(e.x), q(e.y))
                elif isinstance(s, Arc):
                    for cb in s.as_cubic_curves():
                        out += b'C' + struct.pack('>hhhhhh', q(cb.control1.x), q(cb.control1.y), q(cb.control2.x), q(cb.control2.y), q(cb.end.x), q(cb.end.y))
                else:
                    raise ValueError('segment ' + type(s).__name__)
    return bytes(out)


def main(root):
    svgs = os.path.join(root, 'svgs')
    filt = open(os.path.join(root, 'app', 'assets', 'appfilter.xml'), encoding='utf-8').read()
    pkg_to_name = {}
    for comp, name in re.findall(r'<item[^>]*component="ComponentInfo\{([^}]*)\}"[^>]*drawable="([^"]+)"', filt):
        pkg = comp.split('/')[0]
        if pkg and pkg not in pkg_to_name and os.path.exists(os.path.join(svgs, name + '.svg')):
            pkg_to_name[pkg] = name
    names = sorted(set(pkg_to_name.values()))
    blob = bytearray(b'FLI1' + struct.pack('>I', len(names)))
    number = {}
    bad = 0
    for i, n in enumerate(names):
        try:
            ops = icon_ops(os.path.join(svgs, n + '.svg'))
        except Exception as e:  # an odd file: an empty icon, so Focus falls back for that app
            print('skip', n, e)
            ops = b''
            bad += 1
        if len(ops) > 65535:
            print('too big', n, len(ops))
            ops = b''
        blob += struct.pack('>H', len(ops)) + ops
        number[n] = i
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'lines.bin'), 'wb') as f:
        f.write(blob)
    with open(os.path.join(OUT, 'index.txt'), 'w') as f:
        for pkg in sorted(pkg_to_name):
            f.write(pkg + '\t' + str(number[pkg_to_name[pkg]]) + '\n')
    with open(os.path.join(OUT, 'NOTICE.txt'), 'w') as f:
        f.write('Night lines icons are converted from Lawnicons (https://github.com/LawnchairLauncher/lawnicons),\n'
                'Copyright the Lawnicons contributors, licensed under the Apache License 2.0\n'
                '(https://www.apache.org/licenses/LICENSE-2.0). Converted to Focus\'s own path format by tools/make-icons.py.\n')
    print(len(names), 'icons for', len(pkg_to_name), 'apps;', len(blob), 'bytes;', bad, 'skipped')


if __name__ == '__main__':
    main(sys.argv[1])
