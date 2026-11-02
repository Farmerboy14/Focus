// The phone panel's page: the widget grows into a phone (its card becomes the chin, the screen grows above it),
// and folds back down when you click the chin or press Esc. scrcpy's mirror sits over the screen area.
(function () {
  'use strict';
  const api = window.focusApp;
  const S = window.FocusSchedule;
  const U = window.FocusUI;
  const $ = function (id) { return document.getElementById(id); };
  const shell = $('shell'), screen = $('screen');
  const dial = U.Dial($('dial'), { mini: true, glint: false });
  let st = null, geo = null, open = false, key = '';

  function box(r) { shell.style.left = r.x + 'px'; shell.style.top = r.y + 'px'; shell.style.width = r.w + 'px'; shell.style.height = r.h + 'px'; }

  function show(g) {
    geo = g;
    document.documentElement.style.setProperty('--chin', g.chin + 'px');
    document.documentElement.style.setProperty('--radius', (g.radius || 30) + 'px');
    // The screen grows with the phone, rounded corners and all, and ends exactly where the mirror sits.
    const t = g.to, s = g.screen;
    document.documentElement.style.setProperty('--fromh', g.from.h + 'px');
    screen.style.left = (s.x - t.x) + 'px';
    screen.style.right = ((t.x + t.w) - (s.x + s.w)) + 'px';
    screen.style.top = (s.y - t.y) + 'px';
    screen.style.bottom = ((t.y + t.h) - (s.y + s.h)) + 'px';
    if (g.instant) {
      shell.classList.add('instant', 'open');
      box(t);
      void shell.offsetWidth;
      shell.classList.remove('instant');
      open = true;
      return;
    }
    shell.classList.add('instant');
    shell.classList.remove('open');
    box(g.from);
    void shell.offsetWidth;
    shell.classList.remove('instant');
    setMsg({ kind: 'waking', message: 'Waking your phone…' });
    render(false);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        shell.classList.add('open');
        box(t);
        open = true;
      });
    });
  }

  function shrink() {
    if (!geo) { api.invoke('phone:shrunk'); return; }
    open = false;
    shell.classList.remove('open');
    box(geo.from);
    let done = false;
    const fin = function () { if (!done) { done = true; api.invoke('phone:shrunk'); } };
    shell.addEventListener('transitionend', function te(e) { if (e.target === shell && e.propertyName === 'height') { shell.removeEventListener('transitionend', te); fin(); } });
    setTimeout(fin, 700);
  }

  function setMsg(s) {
    const msg = $('msg');
    msg.classList.toggle('hidden', s.kind === 'live');
    $('msgT').textContent = s.message || '';
    $('msgD').textContent = s.detail || '';
    $('msgStar').classList.toggle('hidden', s.kind !== 'waking');
    const b = $('msgBtn');
    b.classList.toggle('hidden', s.kind !== 'missing' && s.kind !== 'error');
    b.textContent = s.kind === 'missing' ? 'Find scrcpy.exe' : 'Try again';
    b.dataset.kind = s.kind;
    $('msgLog').textContent = s.log || '';
    $('msgLog').classList.toggle('hidden', !(s.kind === 'error' && s.log));
    if (s.kind === 'missing') $('msgD').textContent = 'scrcpy shows your phone on the PC. Point Focus to scrcpy.exe once and it\'ll remember.';
  }

  function dialFrac() {
    if (!st) return 1;
    const cur = st.cur, t = Date.now();
    return S.minutesLeft(cur, t) / S.lengthMin(cur);
  }

  function render(animate) {
    if (!st) return;
    const t = Date.now();
    const cur = st.cur;
    const god = cur.preset === 'god';
    shell.classList.toggle('gold', god);
    dial.setGold(god);
    const k = cur.title + cur.start;
    dial.set(dialFrac(), animate || k !== key);
    key = k;
    $('title').textContent = cur.index < 0 ? 'Open time' : cur.title;
    const note = $('note');
    note.textContent = cur.note || '';
    note.classList.toggle('hidden', !cur.note);
    $('left').textContent = S.hm(S.minutesLeft(cur, t));
    const n = st.upcoming[0];
    $('next').textContent = (st.paused ? 'PAUSED · ' : '') + (n ? ('NEXT ' + S.clock(n.start) + ' · ' + n.title).toUpperCase() : ('UNTIL ' + S.clock(cur.end)));
  }

  api.on('phone:show', show);
  api.on('phone:shrink', shrink);
  api.on('phone:status', function (s) { setMsg(s); });
  api.on('state', function (s) { st = s; render(false); });
  api.invoke('state:get').then(function (s) { st = s; render(false); });
  setInterval(function () {
    if (!st) return;
    if (Date.now() >= st.cur.end) api.invoke('state:get').then(function (s) { st = s; render(true); });
    else render(false);
  }, 15000);

  $('chin').addEventListener('click', function () { if (open) api.invoke('phone:collapse'); });
  $('chin').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && open) api.invoke('phone:collapse'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) api.invoke('phone:collapse'); });
  $('msgBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    api.invoke(this.dataset.kind === 'missing' ? 'phone:choose' : 'phone:retry');
  });
})();
