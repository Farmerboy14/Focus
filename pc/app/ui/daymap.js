// The second screen: today from waking to sleep. A bar of every block with a star at now, the blocks in
// morning / afternoon / evening columns (done ones crossed off, the current one opened up), and tomorrow's start.
(function () {
  'use strict';
  const api = window.focusApp;
  const S = window.FocusSchedule;
  const U = window.FocusUI;
  const $ = function (id) { return document.getElementById(id); };
  const MIN = 60000;
  let st = null, timer = 0;
  const openNotes = {};
  const stars = window.FocusStars.Stars($('stars'), { seed: 31 });
  stars.start();
  window.addEventListener('mousemove', function (e) { stars.point(e.clientX / window.innerWidth * 2 - 1, e.clientY / window.innerHeight * 2 - 1); });
  api.on('desk:pause', function (p) { if (p) stars.stop(); else { stars.start(); render(); } });

  function upper(s) { return String(s).toUpperCase(); }
  function presetName(id) { return (st.sched.names && st.sched.names[id]) || id; }
  function hour12(h) { const x = h % 24; return (x % 12 || 12) + (x < 12 ? ' AM' : ' PM'); }

  function render() {
    if (!st) return;
    const t = Date.now();
    const cur = S.current(st.sched, t);
    const god = cur.preset === 'god';
    const slots = S.slots(st.sched, t).slice().sort(function (a, b) { return a.start - b.start; });
    $('sky').classList.toggle('dawn', god);
    $('nowstar').src = god ? '../res/img/star_gold.png' : '../res/img/star_blue.png';
    $('date').textContent = new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // what's left of the work, and when Free time comes
    let workLeft = 0;
    slots.forEach(function (s) { if (s.preset === 'work') workLeft += Math.max(0, s.end - Math.max(s.start, t)); });
    const free = S.nextFree(st.sched, t);
    const sum = $('sum');
    sum.textContent = '';
    sum.appendChild(U.el('div', {}, [U.el('b', { text: S.hm(Math.round(workLeft / MIN)) }), 'OF WORK LEFT TODAY']));
    sum.appendChild(U.el('div', { text: free ? (free <= t ? 'FREE TIME NOW' : 'FREE TIME AT ' + S.clock(free)) : 'NO FREE TIME LEFT TODAY' }));

    renderBar(slots, cur, t);
    renderCols(slots, cur, t);

    const tomorrow = S.slots(st.sched, S.midnight(t, 1)).sort(function (a, b) { return a.start - b.start; })[0];
    $('tomorrow').textContent = tomorrow ? upper('Tomorrow starts ' + S.clock(tomorrow.start) + ' · ' + tomorrow.title) : '';
    $('presetKey').textContent = '';
    ['god', 'work', 'strict', 'normal', 'free'].forEach(function (p) {
      $('presetKey').appendChild(U.el('span', { style: 'margin-left:1.6rem' }, [U.el('i', { class: 'i-' + p, style: 'display:inline-block;width:.55rem;height:.55rem;border-radius:50%;margin-right:.5rem' }), upper(presetName(p))]));
    });
  }

  function isCur(s, cur) { return cur.index >= 0 && s.index === cur.index && s.start === cur.start; }

  function renderBar(slots, cur, t) {
    const track = $('track'), hours = $('hours');
    track.textContent = ''; hours.textContent = '';
    if (!slots.length) return;
    const a = slots[0].start;
    const last = slots[slots.length - 1];
    // A night block that runs to tomorrow only gets a sliver, so the day itself fills the bar.
    const b = Math.max.apply(null, slots.map(function (s) { return s.end - s.start > 6 * 60 * MIN ? s.start + 30 * MIN : s.end; }).concat([last.start + 30 * MIN]));
    const span = b - a;
    const pct = function (x) { return (Math.max(0, Math.min(1, (x - a) / span)) * 100).toFixed(3) + '%'; };
    slots.forEach(function (s) {
      const end = Math.min(s.end, b);
      const cls = 'seg ' + s.preset + (end <= t ? ' past' : '') + (isCur(s, cur) ? ' cur' : '');
      track.appendChild(U.el('div', { class: cls, style: 'left:' + pct(s.start) + ';width:calc(' + pct(end) + ' - ' + pct(s.start) + ')' }));
    });
    const first = Math.ceil((a - S.midnight(a, 0)) / (60 * MIN));
    for (let h = first; S.midnight(a, 0) + h * 60 * MIN <= b; h++) {
      if (h % 3) continue;
      hours.appendChild(U.el('span', { style: 'left:' + pct(S.midnight(a, 0) + h * 60 * MIN), text: hour12(h) }));
    }
    const nm = $('nowmark');
    nm.style.left = pct(t);
    nm.style.display = t >= a && t <= b ? '' : 'none';
  }

  function renderCols(slots, cur, t) {
    const groups = { morning: [], afternoon: [], evening: [] };
    slots.forEach(function (s) {
      const h = S.hourOf(s.start);
      groups[h < 12 ? 'morning' : h < 17.5 ? 'afternoon' : 'evening'].push(s);
    });
    [['morning', 'cm'], ['afternoon', 'ca'], ['evening', 'ce']].forEach(function (g) {
      const box = $(g[0]);
      box.textContent = '';
      const list = groups[g[0]];
      const done = list.filter(function (s) { return s.end <= t; }).length;
      $(g[1]).textContent = list.length ? (done === list.length ? 'DONE' : done + ' / ' + list.length) : '';
      list.forEach(function (s) {
        const now = isCur(s, cur);
        const kids = [U.el('span', { class: 't', text: S.clock(s.start) }), U.el('span', { class: 'n' }, [U.el('i', { class: 'i-' + s.preset }), s.title])];
        if (!now && s.note) kids.push(U.el('span', { class: 'more2', text: s.note }));
        if (now) {
          if (s.note) kids.push(U.el('span', { class: 'more', text: s.note }));
          kids.push(U.el('span', { class: 'left', text: upper(S.hm(S.minutesLeft(cur, t)) + ' left · until ' + S.clock(cur.end)) }));
        }
        const k = s.day + s.start;
        box.appendChild(U.el('div', { class: 'b ' + s.preset + (now ? ' cur' : s.end <= t ? ' past' : '') + (!now && s.note ? ' hit' : '') + (openNotes[k] ? ' open' : ''), 'data-k': k }, kids));
      });
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { render(); schedule(); }, 60000 - (Date.now() % 60000) + 40);
  }

  document.querySelector('.cols').addEventListener('click', function (e) {
    const r = e.target.closest('.b.hit');
    if (!r) return;
    openNotes[r.dataset.k] = !openNotes[r.dataset.k];
    r.classList.toggle('open', !!openNotes[r.dataset.k]);
  });
  api.on('state', function (s) { st = s; render(); });
  api.invoke('state:get').then(function (s) { st = s; render(); schedule(); api.invoke('desk:drawn'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { render(); schedule(); } });
})();
