// Leaves drifting down for the Fall theme: a few dozen, tumbling and swaying, on a 2D canvas over the photo.
(function (root) {
  'use strict';
  const COLORS = ['#D9822B', '#B5491E', '#E8B04A', '#8C4A22', '#C86A2C', '#A23B18'];

  function Leaves(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const n = opts.count || 26;
    let seed = opts.seed || 29;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const L = [];
    for (let i = 0; i < n; i++) {
      L.push({ x: rnd(), off: rnd(), speed: 0.012 + 0.02 * rnd(), sway: 0.015 + 0.035 * rnd(), ph: rnd() * 6.283, size: 9 + 13 * rnd(),
        spin: 25 + 60 * rnd(), col: COLORS[i % COLORS.length], kind: i % 3 });
    }
    let raf = 0, running = false, last = 0;

    function fit() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return dpr;
    }

    // three leaf shapes: a plain oval leaf, an oak-ish lobed one, a maple-ish pointed one (unit size along x)
    function shape(kind) {
      ctx.beginPath();
      if (kind === 0) {
        ctx.moveTo(-0.5, 0); ctx.bezierCurveTo(-0.2, -0.34, 0.22, -0.3, 0.5, 0); ctx.bezierCurveTo(0.22, 0.3, -0.2, 0.34, -0.5, 0);
      } else if (kind === 1) {
        ctx.moveTo(-0.5, 0);
        for (let i = 0; i <= 6; i++) { const x = -0.45 + i * 0.15; ctx.quadraticCurveTo(x - 0.05, -0.36 + (i % 2) * 0.12, x + 0.05, -0.22 + (i % 2) * 0.05); }
        ctx.lineTo(0.5, 0);
        for (let i = 6; i >= 0; i--) { const x = -0.45 + i * 0.15; ctx.quadraticCurveTo(x + 0.05, 0.36 - (i % 2) * 0.12, x - 0.05, 0.22 - (i % 2) * 0.05); }
      } else {
        const pts = [[0.5, 0], [0.18, -0.1], [0.28, -0.42], [0.02, -0.2], [-0.12, -0.46], [-0.2, -0.14], [-0.5, 0], [-0.2, 0.14], [-0.12, 0.46], [0.02, 0.2], [0.28, 0.42], [0.18, 0.1]];
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
    }

    function draw(t) {
      const dpr = fit(), w = canvas.width, h = canvas.height, s = t / 1000;
      ctx.clearRect(0, 0, w, h);
      L.forEach(function (l, i) {
        const size = l.size * dpr, span = h + size * 4;
        const y = ((s * l.speed * h + l.off * span) % span) - size * 2;
        const x = (l.x + Math.sin(s * 0.6 + l.ph) * l.sway) * w;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Math.sin(s * 0.45 + l.ph) * l.spin + i * 37) * Math.PI / 180);
        ctx.scale(size, size * (0.7 + 0.3 * Math.cos(s * 1.2 + l.ph)));
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = l.col;
        shape(l.kind);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = 'rgba(40, 18, 6, 1)';
        ctx.lineWidth = 0.04;
        ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(0.42, 0); ctx.stroke();   // the vein
        ctx.restore();
      });
    }

    function tick(t) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      draw(t);
    }

    return {
      start: function () { if (running) return; running = true; raf = requestAnimationFrame(tick); },
      stop: function () { running = false; cancelAnimationFrame(raf); },
      still: function () { running = false; draw(41000); }
    };
  }

  root.FocusLeaves = { Leaves: Leaves };
})(this);
