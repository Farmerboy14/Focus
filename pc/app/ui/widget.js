// The little always-on-top widget: mini dial, block, time left, what's next. Drag to move; click and it grows into your phone.
(function () {
  'use strict';
  const api = window.focusApp;
  const S = window.FocusSchedule;
  const U = window.FocusUI;
  const w = document.getElementById('w');
  const dial = U.Dial(document.getElementById('dial'), { mini: true, glint: false });
  let st = null, key = '';

  function render(animate) {
    if (!st) return;
    const t = Date.now();
    const cur = st.cur;
    const god = cur.preset === 'god';
    const left = S.minutesLeft(cur, t), len = S.lengthMin(cur);
    w.classList.toggle('gold', god);
    document.getElementById('sky').classList.toggle('dawn', god);
    dial.setGold(god);
    const k = cur.title + cur.start;
    dial.set(left / len, animate || k !== key);
    key = k;
    document.getElementById('title').textContent = cur.index < 0 ? 'Open time' : cur.title;
    const note = document.getElementById('note');
    note.textContent = cur.note || '';
    note.title = cur.note || '';
    note.classList.toggle('hidden', !cur.note);
    document.getElementById('left').textContent = S.hm(left);
    const n = st.upcoming[0];
    document.getElementById('next').textContent = (st.paused ? 'PAUSED · ' : '') + (n ? ('NEXT ' + S.clock(n.start) + ' · ' + n.title).toUpperCase() : ('UNTIL ' + S.clock(cur.end)));
  }

  api.on('state', function (s) { st = s; render(false); });
  api.invoke('state:get').then(function (s) { st = s; U.stagger(document.body); render(true); });
  setInterval(function () {
    if (!st) return;
    if (Date.now() >= st.cur.end) api.invoke('state:get').then(function (s) { st = s; render(true); });
    else render(false);
  }, 15000);

  // Drag to move; a click without moving opens the phone panel.
  let down = null;
  w.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    down = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY, moved: false };
    w.classList.add('press');
  });
  window.addEventListener('mousemove', function (e) {
    if (!down) return;
    const dx = e.screenX - down.sx, dy = e.screenY - down.sy;
    if (!down.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    down.moved = true;
    w.classList.remove('press');
    api.invoke('widget:move', { x: down.wx + dx, y: down.wy + dy });
  });
  window.addEventListener('mouseup', function (e) {
    if (!down) return;
    const d = down;
    down = null;
    w.classList.remove('press');
    if (d.moved) api.invoke('widget:move', { x: d.wx + e.screenX - d.sx, y: d.wy + e.screenY - d.sy, done: true });
    else api.invoke('widget:open');
  });
  w.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') api.invoke('widget:open'); });
})();
