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
  const E = window.FocusEarth;
  const HOME = { lat: 40.19, lon: -92.58, name: 'Kirksville' };
  let st = null, bible = null, bibleDone = false, shownKey = '', drawnSent = false, timer = 0;
  let globe = null, globeDone = false, paused = false, verseRef = null;
  const labels = {};
  const openNotes = {};

  if (still) document.body.classList.add('still');

  // ---------- space: the Earth, the sky, the Moon and planets ----------

  const stars = window.FocusStars.Stars($('stars'), { still: still });   // only if WebGL isn't there
  try {
    // WebGL won't take images straight from disk (they count as another origin), so Focus hands them over as data.
    const img = function (n) { return api.invoke('desk:image', n); };
    globe = E.Scene($('space'), { home: HOME, sky: window.FocusSky, stars: window.FocusStarData, images: {
      day: img('earth_day.jpg'), night: img('earth_night.jpg'), water: img('earth_water.png'), clouds: img('earth_clouds.jpg'), milky: img('milkyway.jpg') } });
    document.body.classList.add('gl');
    layoutScene();
    globe.onFrame = function () { placeHome(); placeLabels(); };
    globe.onReady = function () { globeDone = true; layoutScene(); placeHome(); placeLabels(); if (!still && !paused) globe.start(); maybeDrawn(); };
  } catch (e) {
    console.warn('space: ' + (e && e.message));
    globe = null; globeDone = true; document.body.classList.remove('gl'); $('earth').classList.add('hidden');
    if (still) stars.still(); else stars.start();
  }

  /** The Earth sits where the .earth box is; the box is sized in CSS for any shape of screen. */
  function layoutScene() {
    if (!globe) return;
    const r = $('earth').getBoundingClientRect();
    globe.layout(r.left + r.width / 2, r.top + r.height / 2, r.width / 2 / 1.1);
  }

  function placeHome() {
    if (!globe) return;
    const p = globe.project(HOME.lat, HOME.lon);
    const h = $('home');
    const e = $('earth').getBoundingClientRect();
    h.style.left = (p.x - e.left) + 'px'; h.style.top = (p.y - e.top) + 'px';
    h.style.opacity = p.visible ? 1 : 0;
  }

  /** Names next to the Sun, the Moon and the planets that are in view. */
  const ORDER = ['sun', 'moon', 'venus', 'jupiter', 'mars', 'saturn', 'mercury', 'uranus', 'neptune'];
  function placeLabels() {
    if (!globe) return;
    const seen = {}, taken = [];
    const lh = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.15;
    const er = $('earth').getBoundingClientRect(), ec = { x: er.left + er.width / 2 };
    const col = document.querySelector('.col').getBoundingClientRect();
    globe.bodies().sort(function (a, b) { return ORDER.indexOf(a.id) - ORDER.indexOf(b.id); }).forEach(function (b) {
      seen[b.id] = true;
      let el = labels[b.id];
      if (!el) { el = labels[b.id] = U.el('span', { class: 'blabel ' + b.id, text: upper(b.name) }); $('labels').appendChild(el); }
      const w = el.offsetWidth || 80;
      // names go on the side away from the Earth, so they never sit on its glow
      const left = b.x < ec.x;
      el.classList.toggle('flip', left);
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, Math.round(left ? b.x - b.r - 6 - w : b.x + b.r + 6)));
      let y = Math.round(b.y - lh / 2);
      // when worlds sit close together (the Moon passing Jupiter), stack their names instead of overlapping them
      for (let i = 0; i < 6 && taken.some(function (t) { return x < t.x + t.w && t.x < x + w && y < t.y + lh && t.y < y + lh; }); i++) y += lh;
      taken.push({ x: x, y: y, w: w });
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      // no names under the schedule column; it's for reading
      el.style.opacity = x + w > col.left - 12 && x < col.right ? 0 : 1;
    });
    Object.keys(labels).forEach(function (id) { if (!seen[id]) labels[id].style.opacity = 0; });
  }

  function cloudLine(i) {
    if (!i || !i.live || !i.at) { $('cloudLine').textContent = ''; return; }
    $('cloudLine').textContent = 'CLOUDS FROM ' + upper(S.clock(i.at)) + ' · CONTAINS MODIFIED EUMETSAT DATA';
  }
  api.invoke('desk:cloudinfo').then(cloudLine).catch(function () { });
  api.on('desk:clouds', function (i) {
    cloudLine(i);
    if (globe) globe.setClouds(api.invoke('desk:image', 'earth_clouds.jpg')).catch(function () { });
  });

  function earthLine(t) {
    const st2 = E.sunTimes(t, HOME.lat, HOME.lon);
    let tail = '';
    if (st2.rise && st2.set) {
      if (t < st2.rise) tail = 'sunrise ' + S.clock(st2.rise);
      else if (t < st2.set) tail = 'daylight until ' + S.clock(st2.set);
      else tail = 'night · sunrise tomorrow';
    }
    return HOME.name + (still ? '' : ' ' + S.clock(t)) + (tail ? ' · ' + tail : '');
  }

  // Drag anywhere in space to fly the camera around the Earth; it drifts back home 20 seconds after you let go.
  let drag = null;
  $('space').addEventListener('mousedown', function (e) {
    if (!globe || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    document.body.classList.add('flying');
  });
  window.addEventListener('mousemove', function (e) {
    const nx = e.clientX / window.innerWidth * 2 - 1, ny = e.clientY / window.innerHeight * 2 - 1;
    if (globe) globe.point(nx, ny); else stars.point(nx, ny);
    if (!drag) return;
    globe.drag(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    placeHome(); placeLabels();
  });
  window.addEventListener('mouseup', function () {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('flying');
    globe.release(20000);
  });
  window.addEventListener('mouseleave', function () { if (globe) globe.point(0, 0); else stars.point(0, 0); });

  // Covered by a full-screen window, asleep, or locked: stop animating.
  api.on('desk:pause', function (p) {
    paused = !!p;
    document.body.classList.toggle('paused', paused);
    if (still) return;
    if (globe) { if (paused) globe.stop(); else if (globeDone) globe.start(); }
    else if (paused) stars.stop(); else stars.start();
    if (!paused) render();
  });

  // ---------- things you can click ----------

  $('card').addEventListener('click', function () { api.invoke('desk:action', { what: 'home' }); });
  $('actions').addEventListener('click', function (e) {
    const b = e.target.closest('[data-act]');
    if (b) api.invoke('desk:action', { what: b.dataset.act });
  });
  $('verseBox').addEventListener('click', function () {
    if (verseRef) api.invoke('desk:action', { what: 'bible', book: verseRef.book, chapter: verseRef.chapter });
  });
  $('later').addEventListener('click', function (e) {
    const r = e.target.closest('.row[data-k]');
    if (!r) return;
    openNotes[r.dataset.k] = !openNotes[r.dataset.k];
    r.classList.toggle('open', !!openNotes[r.dataset.k]);
  });

  function maybeDrawn() {
    if (drawnSent || !st) return;
    if (still && !(bibleDone && globeDone)) return;
    drawnSent = true;
    document.fonts.ready.then(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { api.invoke('desk:drawn'); }); }); });
  }

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
    $('earthLine').textContent = earthLine(t);
    layoutScene();                                 // the Earth moves with the schedule's side
    if (globe && (still || paused)) { globe.draw(t); placeHome(); }
    maybeDrawn();
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
      const k = s.day + s.start;
      const kids = [
        U.el('span', { class: 't', text: S.clock(s.start) }),
        U.el('span', { class: 'n', text: s.title }),
        U.el('span', { class: 'p', text: upper(presetName(s.preset)) })
      ];
      if (s.note) kids.push(U.el('span', { class: 'x', text: s.note }));
      box.appendChild(U.el('div', { class: 'row ' + s.preset + (s.note ? ' hit' : '') + (openNotes[k] ? ' open' : ''), 'data-k': k, title: s.note ? 'Show the note' : null }, kids));
    });
    $('laterBox').classList.toggle('hidden', !list.length);
  }

  function renderVerse(t) {
    const r = bible ? B.verseOfDay(bible, t) : B.FALLBACK;
    verseRef = r;
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
  window.addEventListener('resize', function () { if (globe) { layoutScene(); globe.draw(now()); placeHome(); placeLabels(); } });
  // A sleeping PC skips timers; catch up when it wakes.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { render(); schedule(); } });
})();
