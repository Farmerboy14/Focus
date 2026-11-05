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
    globe = E.Scene($('space'), { home: HOME, sky: window.FocusSky, stars: window.FocusStarData,
      worldImage: function (id) { return api.invoke('desk:image', 'planets/' + id + (id === 'saturn_ring' ? '.png' : '.jpg')); }, images: {
      day: img('earth_day.jpg'), night: img('earth_night.jpg'), water: img('earth_water.png'), clouds: img('earth_clouds.jpg'), milky: img('milkyway.jpg') } });
    document.body.classList.add('gl');
    layoutScene();
    globe.onFrame = function () { placeHome(); placeLabels(); placeFlightMarker(); };
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
      if (!el) {
        el = labels[b.id] = U.el('span', { class: 'blabel ' + b.id, text: upper(b.name), title: 'Visit ' + b.name });
        el.addEventListener('click', function () { openWorld(b.id); });
        $('labels').appendChild(el);
      }
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
  // this month's sharp 8K maps have arrived
  api.on('desk:maps', function () {
    if (!globe) return;
    const img = function (n) { return api.invoke('desk:image', n); };
    globe.setMaps({ day: img('earth_day.jpg'), night: img('earth_night.jpg'), water: img('earth_water.png') }).catch(function () { });
  });
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
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
    document.body.classList.add('flying');
  });
  // The wheel zooms in toward the pointer (and out again); like a drag, it drifts home after a while.
  $('space').addEventListener('wheel', function (e) {
    if (!globe) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    if (globe.visiting()) { globe.visitZoom(Math.exp(-Math.max(-400, Math.min(400, dy)) * 0.0016)); return; }
    globe.zoomBy(Math.exp(-Math.max(-400, Math.min(400, dy)) * 0.0016), e.clientX, e.clientY);
    globe.release(20000);
  }, { passive: false });
  window.addEventListener('mousemove', function (e) {
    const nx = e.clientX / window.innerWidth * 2 - 1, ny = e.clientY / window.innerHeight * 2 - 1;
    if (globe) globe.point(nx, ny); else stars.point(nx, ny);
    if (!drag) { hover(e.clientX, e.clientY); return; }
    if (globe.visiting()) { globe.visitDrag(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; return; }
    globe.drag(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    placeHome(); placeLabels();
  });
  window.addEventListener('mouseup', function (e) {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    drag = null;
    document.body.classList.remove('flying');
    if (moved < 5) { click(e.clientX, e.clientY); return; }   // a click, not a drag: a planet or a plane
    if (globe.visiting()) return;
    globe.release(20000);
  });
  window.addEventListener('mouseleave', function () { if (globe) globe.point(0, 0); else stars.point(0, 0); });

  // ---------- live flights ----------
  // The world every 15 minutes and Kirksville's sky every 20 seconds, merged by plane; click one for its story.

  const flights = { w: 0, n: 0, world: [], near: [], timer: 0, sel: null, detail: null, detailTimer: 0, hoverAt: 0 };
  const FT = 3.28084, MPH = 2.23694;

  function row2plane(r, near) {
    return { hex: r[0], cs: r[1], lat: r[2], lon: r[3], track: r[4], speed: r[5], t: r[6], alt: r[7], climb: r[8], country: r[9] || '', squawk: r[10] || '',
      type: near ? r[11] || '' : '', reg: near ? r[12] || '' : '', near: !!near };
  }

  function mergePlanes() {
    const by = {};
    flights.world.forEach(function (p) { by[p.hex] = p; });
    flights.near.forEach(function (p) { const w = by[p.hex]; if (w && !p.country) p.country = w.country; by[p.hex] = p; });
    const all = Object.keys(by).map(function (k) { return by[k]; });
    flights.all = all;
    if (flights.sel && by[flights.sel.hex]) flights.sel = by[flights.sel.hex];
    else if (flights.sel) all.push(flights.sel);          // keep the one you're looking at, even if it dropped out
    if (globe) globe.setPlanes(all);
    if (flights.sel) renderFlight();
    const live = flights.near.length + flights.world.length;
    $('flightLine').textContent = live ? upper(all.length.toLocaleString('en-US') + ' planes in the air · click one') : '';
  }

  function pollFlights() {
    clearTimeout(flights.timer);
    if (still || !globe) return;
    if (!paused) {
      api.invoke('flights:get', { w: flights.w, n: flights.n }).then(function (r) {
        if (!r || r.error) return;
        let changed = false;
        if (r.world) { flights.w = r.world.gen; flights.world = (r.world.planes || []).map(function (x) { return row2plane(x, false); }); changed = true; }
        if (r.near) { flights.n = r.near.gen; flights.near = (r.near.planes || []).map(function (x) { return row2plane(x, true); }); changed = true; }
        if (changed) mergePlanes();
      }).catch(function () { });
    }
    flights.timer = setTimeout(pollFlights, 20000);
  }

  function hover(x, y) {
    if (!globe || globe.visiting()) return;
    const t = performance.now();
    if (t - flights.hoverAt < 60) return;
    flights.hoverAt = t;
    const w = globe.bodyAt(x, y);
    document.body.classList.toggle('onworld', !!w);
    if (!flights.all || !flights.all.length) return;
    const p = w ? null : globe.planeNear(x, y, 12);
    globe.setHovered(p ? p.hex : null);
    document.body.classList.toggle('onplane', !!p);
    const tip = $('planeTip');
    if (!p) { tip.style.opacity = 0; return; }
    tip.textContent = (p.cs || p.hex.toUpperCase()) + ' · ' + altText(p.alt * FT);
    tip.style.transform = 'translate(' + Math.round(x + 14) + 'px,' + Math.round(y + 12) + 'px)';
    tip.style.opacity = 1;
  }

  function click(x, y) {
    if (!globe || globe.visiting()) return;
    const w = globe.bodyAt(x, y);
    if (w) { openWorld(w); return; }
    if (!flights.all) return;
    const p = globe.planeNear(x, y, 14);
    if (p) select(p);
  }

  function altText(ft) { return ft > 0 ? Math.round(ft / 100) * 100 >= 18000 ? 'FL' + Math.round(ft / 100) : Math.round(ft / 50) * 50 + ' ft' : 'on the ground'; }
  function commas(n) { return Math.round(n).toLocaleString('en-US'); }
  function compass(deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
  function miles(a, b) {
    const r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2), y = Math.sin((b.lon - a.lon) * r / 2);
    return 3958.8 * 2 * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * r) * Math.cos(b.lat * r) * y * y));
  }

  function select(p) {
    flights.sel = p;
    flights.detail = null;
    globe.setSelected(p.hex);
    globe.setRoute(null);
    const at = globe.planeScreen(p);
    if (!at.visible || at.x < window.innerWidth * 0.12) globe.lookAt(at.lat, at.lon); else globe.hold(true);
    document.body.classList.add('flight-open');
    renderFlight();
    loadDetail(false);
  }

  function closeFlight() {
    flights.sel = null; flights.detail = null;
    clearTimeout(flights.detailTimer);
    document.body.classList.remove('flight-open');
    if (globe) { globe.setSelected(null); globe.setRoute(null); globe.hold(false); globe.release(6000); }
  }

  function loadDetail(liveOnly) {
    clearTimeout(flights.detailTimer);
    const p = flights.sel;
    if (!p) return;
    api.invoke('flights:detail', { hex: p.hex, callsign: p.cs, liveOnly: liveOnly }).then(function (d) {
      if (!flights.sel || flights.sel.hex !== p.hex || !d || d.error) return;
      if (liveOnly && flights.detail) { flights.detail.live = d.live; } else flights.detail = d;
      const lv = d.live;
      if (lv && lv.row) {
        // a fresh fix: put the plane exactly where it is now
        const np = row2plane(lv.row, true);
        np.country = p.country; Object.assign(p, np);
        globe.setPlanes(flights.all);
      }
      const fd = flights.detail;
      const here = globe.planeScreen(p);
      globe.setRoute(fd.from, fd.to, { lat: here.lat, lon: here.lon });
      renderFlight();
    }).catch(function () { }).then(function () {
      if (flights.sel && flights.sel.hex === p.hex) flights.detailTimer = setTimeout(function () { loadDetail(true); }, 10000);
    });
  }

  function renderFlight() {
    const p = flights.sel, d = flights.detail;
    if (!p) return;
    const lv = d && d.live;
    const al = d && d.airline;
    $('fCall').textContent = p.cs || p.hex.toUpperCase();
    $('fAirline').textContent = al && al.name ? al.name : p.country ? 'Registered in ' + p.country : '';
    const from = d && d.from, to = d && d.to;
    const rt = $('fRoute');
    rt.textContent = '';
    if (from && to) {
      const end = function (a) { return U.el('div', { class: 'end' }, [U.el('b', { text: a.iata || a.icao }), U.el('span', { text: a.city || a.name })]); };
      rt.appendChild(end(from));
      const here = globe.planeScreen(p);
      const done = miles(from, here), left = miles(here, to);
      const frac = Math.max(0, Math.min(1, done / Math.max(1, done + left)));
      const bar = U.el('div', { class: 'bar' }, [U.el('i', { style: 'width:' + (frac * 100).toFixed(1) + '%' }), U.el('em', { style: 'left:' + (frac * 100).toFixed(1) + '%' })]);
      rt.appendChild(bar);
      rt.appendChild(end(to));
      const gs = lv && lv.gsKt ? lv.gsKt * 1.15078 : p.speed * MPH;
      const mins = gs > 60 ? left / gs * 60 : 0;
      $('fLeft').textContent = commas(left) + ' mi to go' + (mins ? ' · about ' + S.hm(Math.round(mins)) : '');
    } else {
      $('fLeft').textContent = d ? 'Route not known for this flight' : 'Looking it up…';
    }
    const altFt = lv && lv.altFt !== null && lv.altFt !== undefined ? lv.altFt : p.alt * FT;
    const mph = lv && lv.gsKt ? lv.gsKt * 1.15078 : p.speed * MPH;
    const climb = lv && lv.climbFpm !== null && lv.climbFpm !== undefined ? lv.climbFpm : p.climb * FT * 60;
    const trk = lv && lv.track !== null && lv.track !== undefined ? lv.track : p.track;
    const ac = d && d.aircraft;
    const facts = [
      ['Altitude', altFt > 0 ? commas(Math.round(altFt / 100) * 100) + ' ft' : 'On the ground'],
      ['Speed', commas(mph) + ' mph'],
      ['Heading', Math.round(trk) + '° ' + compass(trk)],
      ['Climb', Math.abs(climb) < 150 ? 'Level' : (climb > 0 ? '+' : '−') + commas(Math.abs(Math.round(climb / 50) * 50)) + ' ft/min'],
      ['Aircraft', ac ? [ac.maker, ac.type].filter(Boolean).join(' ') || ac.icaoType : p.type || '—'],
      ['Registration', ac && ac.reg ? ac.reg : p.reg || '—'],
      ['Squawk', (lv && lv.squawk) || p.squawk || '—'],
      ['Mode S', p.hex.toUpperCase()]
    ];
    const g = $('fFacts');
    g.textContent = '';
    facts.forEach(function (f) { g.appendChild(U.el('div', {}, [U.el('span', { text: upper(f[0]) }), U.el('b', { text: f[1] })])); });
    const ph = $('fPhoto');
    if (d && d.photo) { ph.src = d.photo; ph.classList.remove('hidden'); } else ph.classList.add('hidden');
    $('fOwner').textContent = ac && ac.owner ? 'Operated by ' + ac.owner : '';
  }

  function placeFlightMarker() {
    const m = $('planeMark');
    if (!flights.sel || !globe) { m.style.opacity = 0; return; }
    const at = globe.planeScreen(flights.sel);
    m.style.opacity = at.visible ? 1 : 0;
    m.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px)';
  }

  $('fClose').addEventListener('click', closeFlight);

  // ---------- visiting the Sun, the Moon and the planets ----------
  const WD = window.FocusWorlds;
  let worldTimer = 0, worldVerse = null;

  function openWorld(id) {
    if (!globe || still || globe.visiting() || !WD.W[id]) return;
    if (flights.sel) closeFlight();
    if (!globe.visit(id)) return;
    document.body.classList.add('visiting', 'world-open');
    document.body.classList.remove('onworld', 'onplane');
    renderWorld(id);
    clearInterval(worldTimer);
    worldTimer = setInterval(function () { renderWorld(id); }, 30000);
  }

  function closeWorld() {
    clearInterval(worldTimer);
    document.body.classList.remove('world-open');
    if (globe) globe.leave();
  }

  function renderWorld(id) {
    const w = WD.W[id];
    $('wName').textContent = w.name;
    $('wWhat').textContent = w.what;
    const lv = WD.live(window.FocusSky.at(Date.now()), id, HOME.lat, HOME.lon);
    const now = $('wNow');
    now.textContent = '';
    if (lv) {
      const away = id === 'sun' || id === 'moon' ? WD.bigMiles(lv.miles) : WD.bigMiles(lv.miles) + ' (' + lv.au.toFixed(2) + ' AU)';
      now.appendChild(document.createTextNode('Right now it’s '));
      now.appendChild(U.el('b', { text: away }));
      now.appendChild(document.createTextNode(' away. Its light takes ' + WD.lightText(lv.lightSec) + ' to reach you.'));
      if (id !== 'sun') now.appendChild(document.createTextNode(' ' + Math.round(lv.lit * 100) + '% of the side facing us is lit.'));
      now.appendChild(U.el('br'));
      now.appendChild(document.createTextNode(lv.alt > 0
        ? 'From Kirksville: ' + Math.round(lv.alt) + '° up in the ' + lv.dir + '.'
        : 'From Kirksville: below the horizon right now (' + lv.dir + ').'));
    }
    const g = $('wFacts');
    g.textContent = '';
    w.facts.forEach(function (f) { g.appendChild(U.el('div', {}, [U.el('span', { text: upper(f[0]) }), U.el('b', { text: f[1] })])); });
    $('wNote').textContent = w.note;
    worldVerse = w.verse;
    $('wVerseText').textContent = '“' + w.verse.text + '”';
    $('wVerseRef').textContent = upper(w.verse.ref + ' · KJV');
  }

  $('wClose').addEventListener('click', closeWorld);
  window.focusVisit = openWorld;   // for the tests
  $('wVerse').addEventListener('click', function () {
    if (worldVerse) api.invoke('desk:action', { what: 'bible', book: worldVerse.book, chapter: worldVerse.chapter });
  });
  if (globe) globe.onVisit = function (id) { if (!id) document.body.classList.remove('visiting'); };
  if (!still) setTimeout(pollFlights, 1500);

  // Covered by a full-screen window, asleep, or locked: stop animating.
  api.on('desk:pause', function (p) {
    paused = !!p;
    document.body.classList.toggle('paused', paused);
    if (still) return;
    if (globe) { if (paused) globe.stop(); else if (globeDone) globe.start(); }
    else if (paused) stars.stop(); else stars.start();
    if (!paused) { render(); pollFlights(); }
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
