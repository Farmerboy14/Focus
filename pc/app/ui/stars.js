// Twinkling stars over the sky picture, a shooting star now and then, and a little parallax with the mouse.
// Drawn on a 2D canvas at about 24 frames a second; stopped whenever the desktop can't be seen.
(function (root) {
  'use strict';

  function Stars(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, stars = [], shoot = null, nextShoot = 0, raf = 0, running = false, last = 0;
    let px = 0, py = 0, tx = 0, ty = 0; // parallax, eased toward the target
    let seed = opts.seed || 7;
    const rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    function layout() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 5200);
      stars = [];
      for (let i = 0; i < count; i++) {
        const depth = rand();                       // 0 far .. 1 near: near stars are bigger and move more
        const warm = rand() < 0.12, blue = !warm && rand() < 0.3;
        stars.push({
          x: rand() * w, y: rand() * h, r: 0.35 + depth * depth * 1.25, depth: depth,
          base: 0.25 + rand() * 0.6, amp: 0.25 + rand() * 0.55, speed: 0.4 + rand() * 1.8, phase: rand() * 6.283,
          col: warm ? '255,228,190' : blue ? '200,222,255' : '242,244,255', glint: depth > 0.93
        });
      }
      nextShoot = performance.now() + 12000 + rand() * 30000;
    }

    function frame(t) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 41) return;                    // ~24 fps is plenty for twinkling
      last = t;
      px += (tx - px) * 0.08; py += (ty - py) * 0.08;
      ctx.clearRect(0, 0, w, h);
      const s = t / 1000;
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        const a = Math.max(0, Math.min(1, st.base + st.amp * Math.sin(s * st.speed + st.phase) * 0.5));
        const x = st.x + px * st.depth * 14, y = st.y + py * st.depth * 10;
        ctx.fillStyle = 'rgba(' + st.col + ',' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, st.r, 0, 6.283); ctx.fill();
        if (st.glint && a > 0.7) {                   // the brightest few get a soft cross
          ctx.strokeStyle = 'rgba(' + st.col + ',' + ((a - 0.7) * 0.9).toFixed(3) + ')';
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
        }
      }
      if (!shoot && t > nextShoot && !opts.still) {
        const fromLeft = rand() < 0.5;
        shoot = { x: (fromLeft ? 0.1 : 0.5) * w + rand() * 0.4 * w, y: rand() * h * 0.45, vx: (fromLeft ? 1 : -1) * (520 + rand() * 300), vy: 180 + rand() * 160, t0: t, life: 900 + rand() * 500 };
      }
      if (shoot) {
        const k = (t - shoot.t0) / shoot.life;
        if (k >= 1) { shoot = null; nextShoot = t + 25000 + rand() * 60000; }
        else {
          const x = shoot.x + shoot.vx * k * shoot.life / 1000, y = shoot.y + shoot.vy * k * shoot.life / 1000;
          const len = 0.12, a = Math.sin(k * Math.PI);
          const g = ctx.createLinearGradient(x, y, x - shoot.vx * len, y - shoot.vy * len);
          g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * a).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - shoot.vx * len, y - shoot.vy * len); ctx.stroke();
        }
      }
    }

    function start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(raf); }
    /** Mouse position as -1..1 from the middle of the screen. */
    function point(nx, ny) { tx = Math.max(-1, Math.min(1, nx)); ty = Math.max(-1, Math.min(1, ny)); }
    /** One still frame (for the wallpaper picture). */
    function still() { stop(); running = true; frame(1e9); running = false; }

    layout();
    window.addEventListener('resize', layout);
    return { start: start, stop: stop, point: point, still: still };
  }

  root.FocusStars = { Stars: Stars };
})(this);
