// Your day on the desktop, drawn behind the icons: the time, the block you're in, what's later, today's verse.
// The same page makes the still picture (?still=1) that becomes the Windows wallpaper when the live layer can't attach.
(function () {
  'use strict';
  const api = window.focusApp;
  const S = window.FocusSchedule;
  const B = window.FocusBible;
  const U = window.FocusUI;
  const still = /[?&]still=1/.test(location.search);
  const $ = function (id) { return document.getElementById(id); };
  const dial = U.Dial($('dial'), { glint: false, weight: 1.7 });
  let st = null, bible = null, bibleDone = false, shownKey = '', drawnSent = false, timer = 0;

  if (still) document.body.classList.add('still');

  function now() { return still && st ? st.now : Date.now(); }
  function upper(s) { return String(s).toUpperCase(); }
  function presetName(id) { return (st.sched.names && st.sched.names[id]) || id; }

  function render() {
    if (!st) return;
    const t = now();
    const cur = S.current(st.sched, t);
    const god = cur.preset === 'god';
    const d = new Date(t);
    document.body.classList.toggle('gold', god);
    document.body.classList.toggle('side-left', st.settings && st.settings.deskSide === 'left');
    $('sky').classList.toggle('dawn', god);

    $('date').textContent = upper(d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
    const hm = S.clock(t).split(' ');
    $('clock').textContent = hm[0];
    $('clock').appendChild(U.el('small', { text: hm[1] || '' }));

    const open = cur.index < 0;
    $('nowLabel').textContent = upper('Now · ' + presetName(cur.preset));
    $('title').textContent = open ? 'Open time' : cur.title;
    const note = $('note');
    note.textContent = cur.note || '';
    note.classList.toggle('hidden', !cur.note);
    const left = S.minutesLeft(cur, t), len = S.lengthMin(cur);
    const lb = $('left');
    lb.textContent = '';
    lb.appendChild(U.el('b', { text: S.hm(left) }));
    lb.appendChild(document.createTextNode(upper((still ? '' : 'left · ') + 'until ' + S.clock(cur.end))));

    dial.setGold(god);
    dial.setStars(S.slots(st.sched, t).map(function (s) { return S.hourOf(s.start); }), S.hourOf(t));
    const key = cur.title + cur.start;
    dial.set(still ? 1 : left / len, !still && key !== shownKey && shownKey !== '');
    shownKey = key;

    renderLater(t);
    renderVerse(t);
    if (!drawnSent && (!still || bibleDone)) {
      drawnSent = true;
      document.fonts.ready.then(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { api.invoke('desk:drawn'); }); }); });
    }
  }

  function renderLater(t) {
    const box = $('later');
    box.textContent = '';
    const list = S.upcoming(st.sched, t, 5);
    const today = new Date(t).toDateString();
    let lastDay = today;
    list.forEach(function (s) {
      const day = new Date(s.start).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        const tomorrow = new Date(t); tomorrow.setDate(tomorrow.getDate() + 1);
        const label = day === tomorrow.toDateString() ? 'Tomorrow' : new Date(s.start).toLocaleDateString('en-US', { weekday: 'long' });
        box.appendChild(U.el('div', { class: 'row day' }, [U.el('span', { text: upper(label) })]));
      }
      box.appendChild(U.el('div', { class: 'row ' + s.preset }, [
        U.el('span', { class: 't', text: S.clock(s.start) }),
        U.el('span', { class: 'n', text: s.title }),
        U.el('span', { class: 'p', text: upper(presetName(s.preset)) })
      ]));
    });
    $('laterBox').classList.toggle('hidden', !list.length);
  }

  function renderVerse(t) {
    const r = bible ? B.verseOfDay(bible, t) : B.FALLBACK;
    $('verse').textContent = '“' + r.text + '”';
    $('ref').textContent = upper(B.label(bible || { books: [] }, r) + ' · KJV');
  }

  /** Redraw on the minute, so the clock turns over with the taskbar's. */
  function schedule() {
    clearTimeout(timer);
    if (still) return;
    const ms = 60000 - (Date.now() % 60000) + 40;
    timer = setTimeout(function () { render(); schedule(); }, ms);
  }

  api.on('state', function (s) { if (!still) { st = s; render(); } });
  api.invoke('state:get').then(function (s) {
    st = s;
    render();
    schedule();
    return api.invoke('bible:text');
  }).then(function (raw) {
    if (typeof raw === 'string' && raw.length > 1000) bible = B.parse(raw);
    bibleDone = true;
    render();
  }).catch(function () { bibleDone = true; if (st) render(); });
  // A sleeping PC skips timers; catch up when it wakes.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { render(); schedule(); } });
})();
