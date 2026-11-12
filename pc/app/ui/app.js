// The main Focus window: Home, Today, Presets, Time with God, Bible, Prayer journal, Settings.
(function () {
  'use strict';
  const api = window.focusApp;
  const S = window.FocusSchedule;
  const B = window.FocusBible;
  const U = window.FocusUI;
  const el = U.el;
  const $ = function (id) { return document.getElementById(id); };
  const ALLOW = 0, REASON = 1, BLOCK = 2;
  const PRESETS = ['god', 'strict', 'work', 'normal', 'free'];

  let st = null;            // the latest snapshot from the app
  let view = 'home';
  let flow = '';            // 'god' when Bible or the journal was opened from Time with God
  let shownKey = '';
  let bible = null, bibleLoading = null;
  let bookSel = 0, chapSel = 1;
  let presetSel = null;
  let journal = null;       // entries while unlocked, null while locked
  let jKind = 'Request';
  let daySel = '';          // the weekday shown in Today
  let editing = null;       // { day, index } while the block sheet is open (index -1 for a new block)

  const win = $('win');
  U.dust($('dust'), 26, 13);

  const homeDial = U.Dial($('homeDial'), { gold: false });
  const godDial = U.Dial($('godDial'), { gold: true });

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function call(name, arg) {
    return api.invoke(name, arg).then(function (r) {
      if (r && r.error) toast(r.error);
      return r;
    }, function (e) { toast('Something went wrong.'); console.error(e); return null; });
  }

  function now() { return Date.now(); }
  function upper(s) { return String(s).toUpperCase(); }
  function presetName(id) { return (st && st.sched.names[id]) || id; }
  function dayLabel(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'short' }); }

  // ---------- navigation ----------

  const FULL = { god: true, rest: true };
  function isFull(v) { return !!FULL[v] || ((v === 'bible' || v === 'journal') && flow === 'god'); }

  function go(v, opts) {
    opts = opts || {};
    if (v === 'pause') { if (view === 'rest' || isFull(view)) go('home'); openPause(); return; }
    if (v === 'god' || v === 'rest') flow = 'god';
    else if (v === 'bible' || v === 'journal') flow = opts.fromGod || (view === v && flow === 'god') ? 'god' : '';
    else flow = '';
    if (view === 'journal' && v !== 'journal') lockJournal();
    const changed = v !== view;
    view = v;
    win.dataset.view = v;
    document.querySelectorAll('.nav').forEach(function (n) { n.classList.toggle('on', n.dataset.go === v || (v === 'rest' && n.dataset.go === 'god')); });
    const full = isFull(v);
    win.classList.toggle('full', full);
    $('bibleBack').classList.toggle('hidden', flow !== 'god');
    $('journalBack').classList.toggle('hidden', flow !== 'god');
    api.invoke('win:fullscreen', full).catch(function () { });
    document.querySelectorAll('.view').forEach(function (s) {
      const on = s.id === 'v-' + v;
      if (on && changed) { s.classList.remove('active'); void s.offsetWidth; }
      s.classList.toggle('active', on);
    });
    render(changed);
    if (v === 'presets') api.invoke('procs:refresh').catch(function () { });
    if (v === 'bible') ensureBible().then(function () { renderBible(); if (opts.book != null) openChapter(opts.book, opts.chapter || 1); });
  }

  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go, { fromGod: view === 'god' }); });
  });

  // ---------- render ----------

  function render(entering) {
    document.body.classList.toggle('theme-fall', !!(st && st.settings && st.settings.theme === 'fall'));
    if (!st) return;
    const t = now();
    const cur = st.cur;
    const god = cur.preset === 'god';
    win.classList.toggle('god', god);
    $('sky').classList.toggle('dawn', god || isFull(view));
    $('blockpill').textContent = cur.index < 0 ? 'Open time' : cur.title;
    renderClock();
    renderLink();
    if (view === 'home') renderHome(entering);
    else if (view === 'today') { renderToday(); if (entering) scrollToNow(); }
    else if (view === 'presets') renderPresets();
    else if (view === 'god') renderGod(entering);
    else if (view === 'rest') renderRest();
    else if (view === 'settings') renderSettings();
    else if (view === 'journal') renderJournal();
    void t;
  }

  function renderClock() {
    const d = new Date();
    $('clock').textContent = upper(S.clock(d.getTime()) + ' · ' + dayLabel(d));
  }

  function renderLink() {
    const ls = $('linkstat');
    const s = st.pair.status;
    ls.className = 'linkstat ' + s;
    ls.querySelector('.txt').textContent = s === 'live' ? (st.pair.lastMessage ? 'Phone linked' : 'Waiting for phone') : s === 'off' ? 'Not paired' : 'Reconnecting…';
  }

  function hours(slots) { return slots.map(function (s) { return S.hourOf(s.start); }); }

  function renderHome(entering) {
    const t = now();
    const cur = st.cur;
    const god = cur.preset === 'god';
    const left = S.minutesLeft(cur, t), len = S.lengthMin(cur);
    $('homeBig').textContent = S.hm(left);
    $('homeSub').textContent = upper('of ' + S.hm(len) + ' left');
    $('homeTitle').textContent = cur.index < 0 ? 'Open time' : cur.title;
    $('homeNowLabel').textContent = upper('Now · ' + presetName(cur.preset));
    $('homeBlock').textContent = cur.index < 0 ? 'Open time' : cur.title;
    $('homeUntil').textContent = upper('until ' + S.clock(cur.end));
    homeDial.setGold(god);
    homeDial.setStars(hours(st.slots), S.hourOf(t));
    const key = cur.title + cur.start;
    homeDial.set(left / len, entering || key !== shownKey);
    shownKey = key;

    const note = $('homeNote');
    note.textContent = cur.note || '';
    note.classList.toggle('hidden', !cur.note);

    const next = $('homeNext');
    next.textContent = '';
    st.upcoming.forEach(function (n) {
      const other = S.dayOf(n.start) !== st.today;
      next.appendChild(el('div', { class: 'nextcard stone' + (n.preset === 'god' ? ' god' : '') }, [
        el('span', { class: 't', text: S.clock(n.start) }),
        el('span', { class: 'n', text: n.title }),
        el('span', { class: 'l', text: other ? upper(S.DAY_NAMES[S.dayOf(n.start)].slice(0, 3)) : S.hm(S.lengthMin(n)) })
      ]));
    });
    if (!st.upcoming.length) {
      next.appendChild(el('div', { class: 'nextcard stone' }, [el('span', { class: 't', text: '' }), el('span', { class: 'n', text: 'Nothing else this week' }), el('span', { class: 'l', text: '' })]));
    }

    const pb = $('pausedBanner');
    pb.classList.toggle('hidden', !st.paused);
    if (st.paused) {
      pb.textContent = '';
      pb.appendChild(el('span', { class: 'grow', text: 'Blocking is paused until ' + S.clock(st.paused) + '.' }));
      pb.appendChild(el('button', { class: 'plain', text: 'Resume', onclick: function () { call('pause:end'); } }));
    }
    const ub = $('updBanner');
    ub.classList.toggle('hidden', !st.version.pending);
    if (st.version.pending) {
      ub.textContent = '';
      ub.appendChild(el('span', { class: 'grow', text: 'Focus ' + st.version.pending + ' is ready.' }));
      ub.appendChild(el('button', { class: 'plain', text: 'Restart', onclick: function () { call('update:restart'); } }));
    }

    const acts = $('homeActions');
    acts.textContent = '';
    if (god) acts.appendChild(el('button', { class: 'goldbtn', text: 'Open Time with God', onclick: function () { go('god'); } }));
  }

  function apply(s, entering) { if (s && s.sched) { st = s; render(!!entering); } }

  // ---------- Today (the week) ----------

  const WEEK = S.DAY_KEYS;
  const isWeekday = function (k) { return S.WEEKDAYS.indexOf(k) >= 0; };
  function dayList(k) { return (st.sched.days && st.sched.days[k]) || []; }

  function saveDay(k, list, msg) {
    const days = {};
    days[k] = list;
    return saveDays(days, msg);
  }
  function saveDays(days, msg) {
    return call('sched:set', { days: days }).then(function (s) {
      if (s && s.sched) { st = s; renderToday(); if (msg) toast(msg); return true; }
      return false;
    });
  }

  function timeSpan(b) {
    const x = S.clockMin(b.start), y = S.clockMin(b.end);
    return (x.slice(-2) === y.slice(-2) ? x.slice(0, -3) : x) + ' – ' + y;
  }

  function renderToday() {
    if (!daySel) daySel = st.today;
    const cur = st.cur;
    const tabs = $('dayTabs');
    tabs.textContent = '';
    WEEK.forEach(function (k) {
      const b = el('button', { class: 'chip' + (k === daySel ? ' on' : ''), role: 'tab', 'aria-selected': k === daySel ? 'true' : 'false', title: S.DAY_NAMES[k], text: S.DAY_NAMES[k].slice(0, 3),
        onclick: function () { if (daySel !== k) { daySel = k; resetCopy(); renderToday(); scrollToNow(); } } });
      if (k === st.today) b.appendChild(el('span', { class: 'cur', title: 'Today' }));
      tabs.appendChild(b);
    });
    const list = dayList(daySel);
    const isToday = daySel === st.today;
    $('todayTitle').textContent = isToday ? 'Today' : S.DAY_NAMES[daySel];
    let sub = (isToday ? S.DAY_NAMES[daySel] + ' · ' : '') + (list.length ? list.length + (list.length === 1 ? ' block' : ' blocks') + ' · from ' + S.clockMin(list[0].start) : 'No blocks yet. It\'s all open time.');
    if (isToday) sub += '. Now: ' + (cur.index < 0 ? 'open time' : cur.title) + ' until ' + S.clock(cur.end) + '.';
    else if (list.length) sub += '.';
    $('todaySub').textContent = sub;
    $('copyWeekdays').classList.toggle('hidden', !isWeekday(daySel));

    const box = $('blockList');
    box.textContent = '';
    if (!list.length) box.appendChild(el('div', { class: 'empty dayempty', text: 'Gaps between blocks are open time (' + presetName('normal') + '). Add a block to plan this day.' }));
    list.forEach(function (b, i) {
      const isNow = cur.day === daySel && cur.index === i;
      const late = S.parseHm(b.end) <= S.parseHm(b.start);
      const main = el('span', { class: 'main' }, [el('span', { class: 'bt', text: b.title })]);
      if (b.note) main.appendChild(el('span', { class: 'bn', text: b.note }));
      box.appendChild(el('button', { class: 'brow stone' + (isNow ? ' now' : '') + (b.preset === 'god' ? ' god' : ''), 'data-i': i, title: 'Edit ' + b.title, onclick: function () { openBlock(daySel, i); } }, [
        el('span', { class: 'times' }, [timeSpan(b), late ? el('span', { class: 'late', text: ' +1' }) : null]),
        main,
        el('span', { class: 'pname p-' + b.preset, text: presetName(b.preset) }),
        el('span', { class: 'edit', 'aria-hidden': 'true' }, [arrow('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z')])
      ]));
    });
  }

  function scrollToNow() {
    const box = $('blockList');
    const row = box.querySelector('.brow.now');
    if (row) scrollWithin(box, row, true); else box.scrollTop = 0;
  }

  /** Scrolls only inside a list, never the window around it. */
  function scrollWithin(box, item, center) {
    if (!box || !item) return;
    const top = item.offsetTop, h = item.offsetHeight;
    if (center) box.scrollTop = Math.max(0, top - box.clientHeight / 2 + h / 2);
    else if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + h > box.scrollTop + box.clientHeight) box.scrollTop = top + h - box.clientHeight + 8;
  }

  function arrow(d) {
    const s = U.svg('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    U.svg('path', { d: d }, s);
    return s;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Copy this day to Mon–Fri: one click to arm, a second to do it.
  function resetCopy() { const b = $('copyWeekdays'); delete b.dataset.sure; b.textContent = 'Copy this day to Mon–Fri'; clearTimeout(resetCopy.t); }
  $('copyWeekdays').addEventListener('click', function () {
    const b = $('copyWeekdays');
    if (!isWeekday(daySel)) return;
    if (!b.dataset.sure) {
      b.dataset.sure = '1';
      b.textContent = 'Replace the other weekdays with ' + S.DAY_NAMES[daySel] + '?';
      resetCopy.t = setTimeout(resetCopy, 4000);
      return;
    }
    resetCopy();
    const days = {};
    S.WEEKDAYS.forEach(function (k) { if (k !== daySel) days[k] = clone(dayList(daySel)); });
    saveDays(days, S.DAY_NAMES[daySel] + ' copied to Monday through Friday.');
  });

  // ---------- the block sheet ----------

  PRESETS.forEach(function (p) { $('bsPreset').appendChild(el('option', { value: p, text: p })); });

  function nextDay(k) { return S.DAY_NAMES[WEEK[(WEEK.indexOf(k) + 1) % 7]]; }

  function hintBlock() {
    const s = S.parseHm($('bsStart').value), e = S.parseHm($('bsEnd').value);
    const h = $('bsHint');
    if (s < 0 || e < 0) { h.textContent = 'Set a start and an end.'; $('bsSave').disabled = true; return; }
    $('bsSave').disabled = false;
    const len = e > s ? e - s : e + 1440 - s;
    h.textContent = upper(S.hm(len) + (e > s ? '' : ' · runs past midnight into ' + nextDay(editing.day)));
  }

  function openBlock(day, i) {
    const list = dayList(day);
    let b = list[i];
    if (!b) {
      // A new block starts where the day's last one ends (unless that runs past midnight).
      const last = list[list.length - 1];
      let s = 12 * 60;
      if (last && S.parseHm(last.end) > S.parseHm(last.start)) s = S.parseHm(last.end);
      b = { start: S.fmtHm(s), end: S.fmtHm(Math.min(s + 60, 23 * 60 + 59)), title: '', preset: 'normal', note: '' };
      i = -1;
    }
    editing = { day: day, index: i };
    $('bsHead').textContent = upper((i < 0 ? 'New block · ' : 'Edit block · ') + S.DAY_NAMES[day]);
    $('bsTitle').value = b.title;
    $('bsStart').value = b.start;
    $('bsEnd').value = b.end;
    Array.prototype.forEach.call($('bsPreset').options, function (o) { o.textContent = presetName(o.value); });
    $('bsPreset').value = b.preset;
    $('bsNote').value = b.note || '';
    $('bsDelete').classList.toggle('hidden', i < 0);
    resetDelete();
    hintBlock();
    const m = $('blockModal');
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    setTimeout(function () { $('bsTitle').focus(); if (i < 0) $('bsTitle').select(); }, 300);
  }

  function closeBlock() { editing = null; resetDelete(); const m = $('blockModal'); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }

  function saveBlock() {
    if (!editing) return;
    const s = S.parseHm($('bsStart').value), e = S.parseHm($('bsEnd').value);
    if (s < 0 || e < 0) { toast('Set a start and an end.'); return; }
    const b = { start: S.fmtHm(s), end: S.fmtHm(e), title: $('bsTitle').value.trim() || 'Block', preset: $('bsPreset').value, note: $('bsNote').value.trim() };
    const list = clone(dayList(editing.day));
    if (editing.index < 0) list.push(b); else list[editing.index] = b;
    const day = editing.day;
    closeBlock();
    saveDay(day, list);
  }

  function resetDelete() { const d = $('bsDelete'); delete d.dataset.sure; d.textContent = 'Delete'; clearTimeout(resetDelete.t); }
  $('bsDelete').addEventListener('click', function () {
    if (!editing || editing.index < 0) return;
    const d = $('bsDelete');
    if (!d.dataset.sure) { d.dataset.sure = '1'; d.textContent = 'Click again to delete'; resetDelete.t = setTimeout(resetDelete, 2500); return; }
    const list = clone(dayList(editing.day));
    const gone = list.splice(editing.index, 1)[0];
    const day = editing.day;
    closeBlock();
    saveDay(day, list, (gone ? gone.title : 'Block') + ' deleted.');
  });
  $('bsSave').addEventListener('click', saveBlock);
  $('bsCancel').addEventListener('click', closeBlock);
  $('blockScrim').addEventListener('click', closeBlock);
  $('bsStart').addEventListener('input', hintBlock);
  $('bsEnd').addEventListener('input', hintBlock);
  $('bsTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveBlock(); } });
  $('bsNote').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); saveBlock(); } });
  $('addBlock').addEventListener('click', function () { openBlock(daySel || st.today, -1); });

  // ---------- Presets ----------

  function savePc(pc) { call('pc:set', pc).then(function (s) { if (s && s.pc) { st = s; renderPresets(); } }); }

  function seg(options, value, onPick) {
    const s = el('div', { class: 'seg', role: 'radiogroup' });
    options.forEach(function (o) {
      s.appendChild(el('button', { class: (o.v === value ? 'on ' : '') + o.c, role: 'radio', 'aria-checked': o.v === value ? 'true' : 'false', text: o.t, onclick: function () { if (o.v !== value) onPick(o.v); } }));
    });
    return s;
  }

  function exeKey(s) {
    s = String(s || '').trim().toLowerCase();
    s = s.slice(Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')) + 1);
    return s.endsWith('.exe') ? s.slice(0, -4) : s;
  }
  function hostKey(s) {
    s = String(s || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#]/)[0].replace(/:\d+$/, '');
    if (s.startsWith('www.')) s = s.slice(4);
    if (s.startsWith('*.')) s = s.slice(2);
    return /^[a-z0-9.-]+$/.test(s) && s.indexOf('.') > 0 ? s : '';
  }

  function renderPresets() {
    const pc = st.pc;
    if (!presetSel) presetSel = st.cur.preset;
    const tabs = $('presetTabs');
    tabs.textContent = '';
    PRESETS.forEach(function (id) {
      const b = el('button', { class: 'chip' + (id === 'god' ? ' godtab' : '') + (id === presetSel ? ' on' : ''), text: presetName(id), onclick: function () { presetSel = id; renderPresets(); } });
      if (id === st.cur.preset) { b.appendChild(el('span', { class: 'cur', title: 'Now' })); }
      tabs.appendChild(b);
    });
    const p = pc.presets[presetSel];
    const name = presetName(presetSel);
    const dseg = seg([{ v: ALLOW, t: 'Allowed', c: 'allow' }, { v: BLOCK, t: 'Blocked', c: 'block' }], p.def, function (v) { const n = clone(pc); n.presets[presetSel].def = v; savePc(n); });
    $('defSeg').replaceWith(dseg); dseg.id = 'defSeg';
    $('defNote').textContent = p.def === BLOCK
      ? 'During ' + name + ', any program not listed below is minimized with "Not now". Windows itself, Focus and your basic tools always open.'
      : 'During ' + name + ', programs open unless they are listed below as blocked or needing a reason.';

    const list = $('progList');
    list.textContent = '';
    const keys = Object.keys(p.modes).sort();
    if (!keys.length) list.appendChild(el('div', { class: 'empty', text: 'No programs set for ' + name + ' yet. Add one, or click one you have running.' }));
    keys.forEach(function (k) {
      const ent = pc.entExes.indexOf(k) >= 0;
      const row = el('div', { class: 'prow' }, [el('span', { class: 'name', text: k, title: k + '.exe' })]);
      if (ent) row.appendChild(el('span', { class: 'why', text: 'Entertainment · Free time only' }));
      else row.appendChild(seg([{ v: ALLOW, t: 'Allowed', c: 'allow' }, { v: REASON, t: 'Needs a reason', c: 'reason' }, { v: BLOCK, t: 'Blocked', c: 'block' }], p.modes[k], function (v) { const n = clone(pc); n.presets[presetSel].modes[k] = v; savePc(n); }));
      row.appendChild(el('button', { class: 'ibtn plain del', 'aria-label': 'Remove ' + k, title: 'Remove', onclick: function () { const n = clone(pc); delete n.presets[presetSel].modes[k]; savePc(n); } }, [arrow('M6 6l12 12M18 6L6 18')]));
      list.appendChild(row);
    });

    const dl = $('seenList');
    dl.textContent = '';
    st.seen.forEach(function (s) { dl.appendChild(el('option', { value: s.exe, label: s.title })); });
    const chips = $('seenChips');
    chips.textContent = '';
    const fresh = st.seen.filter(function (s) { return !(s.exe in p.modes); });
    if (!fresh.length) chips.appendChild(el('span', { class: 'empty', text: st.platform === 'win32' ? 'Programs you use show up here.' : 'Programs show up here on Windows.' }));
    fresh.slice(0, 40).forEach(function (s) {
      chips.appendChild(el('button', { class: 'chip', text: s.exe, title: s.title || s.exe, onclick: function () { const n = clone(pc); n.presets[presetSel].modes[s.exe] = p.def === BLOCK ? ALLOW : BLOCK; savePc(n); } }));
    });

    $('sitesTitle').textContent = 'Blocked websites in ' + name;
    const sl = $('siteList');
    sl.textContent = '';
    if (!p.sites.length) sl.appendChild(el('div', { class: 'empty', text: 'None. Entertainment sites are already covered below.' }));
    p.sites.forEach(function (h) {
      sl.appendChild(el('div', { class: 'prow' }, [el('span', { class: 'name', text: h }),
        el('button', { class: 'ibtn plain del', 'aria-label': 'Remove ' + h, title: 'Remove', onclick: function () { const n = clone(pc); n.presets[presetSel].sites = n.presets[presetSel].sites.filter(function (x) { return x !== h; }); savePc(n); } }, [arrow('M6 6l12 12M18 6L6 18')])]));
    });

    tagList($('entExes'), pc.entExes, function (x) { const n = clone(pc); n.entExes = n.entExes.filter(function (y) { return y !== x; }); savePc(n); });
    tagList($('entSites'), pc.entSites, function (x) { const n = clone(pc); n.entSites = n.entSites.filter(function (y) { return y !== x; }); savePc(n); });
    if (document.activeElement !== $('ytLimit')) $('ytLimit').value = pc.ytLimit;
    $('ytUsed').textContent = 'Used today: ' + st.ytUsedMin + ' of ' + pc.ytLimit + ' minutes. Counted while a YouTube tab is in front, outside Free time. Needs the Focus extension in Chrome or Opera.';
  }

  function tagList(host, items, onRemove) {
    host.textContent = '';
    items.forEach(function (x) {
      host.appendChild(el('span', { class: 'tag' }, [x, el('button', { class: 'plain', 'aria-label': 'Remove ' + x, title: 'Remove', onclick: function () { onRemove(x); } }, ['×'])]));
    });
  }

  function addFrom(input, keyFn, add) {
    const k = keyFn(input.value);
    if (!k) { toast('That doesn\'t look right.'); return; }
    input.value = '';
    add(k);
  }
  $('progAdd').addEventListener('click', function () {
    addFrom($('progInput'), exeKey, function (k) { const n = clone(st.pc); const p = n.presets[presetSel]; if (!(k in p.modes)) p.modes[k] = p.def === BLOCK ? ALLOW : BLOCK; savePc(n); });
  });
  $('siteAdd').addEventListener('click', function () {
    addFrom($('siteInput'), hostKey, function (k) { const n = clone(st.pc); const p = n.presets[presetSel]; if (p.sites.indexOf(k) < 0) p.sites.push(k); savePc(n); });
  });
  $('entExeAdd').addEventListener('click', function () {
    addFrom($('entExeInput'), exeKey, function (k) { const n = clone(st.pc); if (n.entExes.indexOf(k) < 0) n.entExes.push(k); savePc(n); });
  });
  $('entSiteAdd').addEventListener('click', function () {
    addFrom($('entSiteInput'), hostKey, function (k) { const n = clone(st.pc); if (n.entSites.indexOf(k) < 0) n.entSites.push(k); savePc(n); });
  });
  [['progInput', 'progAdd'], ['siteInput', 'siteAdd'], ['entExeInput', 'entExeAdd'], ['entSiteInput', 'entSiteAdd']].forEach(function (p) {
    $(p[0]).addEventListener('keydown', function (e) { if (e.key === 'Enter') $(p[1]).click(); });
  });
  $('ytLimit').addEventListener('change', function () {
    const v = Math.max(0, Math.min(600, parseInt($('ytLimit').value, 10) || 0));
    const n = clone(st.pc); n.ytLimit = v; savePc(n);
  });
  $('seenRefresh').addEventListener('click', function () { api.invoke('procs:refresh'); toast('Looking at what\'s running…'); setTimeout(function () { api.invoke('state:get').then(function (s) { st = s; renderPresets(); }); }, 2500); });

  // ---------- Time with God ----------

  function renderGod(entering) {
    const t = now();
    const cur = st.cur;
    const inBlock = cur.preset === 'god';
    $('godHead').textContent = upper((inBlock ? cur.title + ' · ' : 'Time with God · ') + S.clock(t));
    if (inBlock) {
      const left = S.minutesLeft(cur, t), len = S.lengthMin(cur);
      $('godBig').textContent = S.hm(left);
      $('godSub').textContent = upper('of ' + S.hm(len) + ' left');
      godDial.set(left / len, entering);
    } else {
      $('godBig').textContent = 'Now';
      $('godSub').textContent = 'ANY TIME IS GOOD';
      godDial.set(1, entering);
    }
    godDial.setStars(hours(st.slots), S.hourOf(t));
    showVerse();
    const steps = $('steps');
    if (!steps.childElementCount || entering) {
      steps.textContent = '';
      ['Read your Bible', 'Pray: thanks, confession, requests', 'Write one thing to carry into today'].forEach(function (txt, i) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!st.steps[i];
        const lab = el('label', { class: 'step' + (cb.checked ? ' done' : '') }, [cb, txt]);
        cb.addEventListener('change', function () {
          lab.classList.toggle('done', cb.checked);
          api.invoke('steps:set', { i: i, on: cb.checked }).then(function (arr) { if (Array.isArray(arr)) st.steps = arr; });
        });
        steps.appendChild(lab);
      });
    }
  }

  function showVerse() {
    const r = bible ? B.verseOfDay(bible, now()) : B.FALLBACK;
    $('verseText').textContent = '“' + r.text + '”';
    $('verseRef').textContent = upper('Today\'s verse · ' + B.label(bible || { books: [] }, r) + ' · KJV');
    if (!bible) ensureBible().then(function () { if (view === 'god') showVerse(); });
  }

  $('godBack').addEventListener('click', function () { flow = ''; go('home'); });
  $('putDown').addEventListener('click', function () { go('rest', { fromGod: true }); });

  function renderRest() {
    const cur = st.cur;
    $('restTime').textContent = cur.preset === 'god' ? S.hm(S.minutesLeft(cur, now())) : '';
  }
  $('restWake').addEventListener('click', function () { go('god'); });

  // ---------- Bible ----------

  function ensureBible() {
    if (bible) return Promise.resolve(bible);
    if (!bibleLoading) {
      bibleLoading = api.invoke('bible:text').then(function (raw) {
        if (typeof raw !== 'string') throw new Error('no text');
        bible = B.parse(raw);
        try { const saved = JSON.parse(localStorage.getItem('bible.at') || 'null'); if (saved) { bookSel = saved.b; chapSel = saved.c; } } catch (e) { }
        return bible;
      }).catch(function (e) { bibleLoading = null; toast('The Bible couldn\'t be loaded.'); throw e; });
    }
    return bibleLoading;
  }

  function renderBible() {
    if (!bible) return;
    const bl = $('bookList');
    if (!bl.childElementCount) {
      bible.books.forEach(function (name, i) {
        if (i === 0) bl.appendChild(el('span', { class: 'label testament', text: 'OLD TESTAMENT' }));
        if (i === 39) bl.appendChild(el('span', { class: 'label testament', text: 'NEW TESTAMENT' }));
        bl.appendChild(el('button', { class: 'plain', 'data-b': i, text: name, onclick: function () { openChapter(i, 1); } }));
      });
    }
    if (!$('bibleSearch').value.trim()) openChapter(bookSel, chapSel, null, true);
  }

  function openChapter(b, c, hlVerse, keepScroll, word) {
    if (!bible) return;
    b = Math.max(0, Math.min(bible.books.length - 1, b | 0));
    c = Math.max(1, Math.min(bible.text[b].length, c | 0));
    const same = b === bookSel && c === chapSel && $('reading').dataset.mode === 'chapter';
    bookSel = b; chapSel = c;
    try { localStorage.setItem('bible.at', JSON.stringify({ b: b, c: c })); } catch (e) { }
    if (hlVerse != null) $('bibleSearch').value = '';
    $('chapTitle').textContent = bible.books[b] + ' ' + c;
    $('bookList').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', +x.dataset.b === b); });
    const onBook = $('bookList').querySelector('button.on');
    if (onBook && !keepScroll) scrollWithin($('bookList'), onBook, false);
    const cl = $('chapList');
    cl.textContent = '';
    cl.classList.remove('hidden');
    for (let i = 1; i <= bible.text[b].length; i++) {
      (function (n) { cl.appendChild(el('button', { class: 'plain' + (n === c ? ' on' : ''), text: String(n), onclick: function () { openChapter(b, n); } })); })(i);
    }
    const rd = $('reading');
    if (same && keepScroll && hlVerse == null) return;
    rd.dataset.mode = 'chapter';
    rd.textContent = '';
    rd.classList.remove('results');
    bible.text[b][c - 1].forEach(function (v, i) {
      const p = el('p', { id: 'v' + (i + 1), class: hlVerse === i + 1 ? 'hl' : '' }, [el('sup', { text: String(i + 1) })]);
      if (word && hlVerse === i + 1) markWord(p, v, word); else p.appendChild(document.createTextNode(v));
      rd.appendChild(p);
    });
    scrollWithin(cl, cl.querySelector('.on'), false);
    if (hlVerse) scrollWithin(rd, $('v' + hlVerse), true); else rd.scrollTop = 0;
  }

  function markWord(p, text, word) {
    const l = text.toLowerCase(), w = word.toLowerCase();
    let i = 0, at;
    while ((at = l.indexOf(w, i)) >= 0) {
      p.appendChild(document.createTextNode(text.slice(i, at)));
      p.appendChild(el('mark', { text: text.slice(at, at + w.length) }));
      i = at + w.length;
    }
    p.appendChild(document.createTextNode(text.slice(i)));
  }

  function runSearch() {
    const q = $('bibleSearch').value.trim();
    if (!bible) return;
    if (q.length < 2) { openChapter(bookSel, chapSel); return; }
    const all = B.search(bible, q, 100000);
    const rd = $('reading');
    rd.dataset.mode = 'search';
    rd.textContent = '';
    rd.classList.add('results');
    rd.scrollTop = 0;
    $('chapTitle').textContent = '“' + q + '”';
    $('chapList').classList.add('hidden');
    rd.appendChild(el('div', { class: 'rcount', text: all.length === 0 ? 'No verses found.' : all.length + (all.length === 1 ? ' verse' : ' verses') + (all.length > 300 ? ' · showing the first 300' : '') }));
    all.slice(0, 300).forEach(function (r) {
      const b = el('button', { class: 'res plain', onclick: function () { openChapter(r.book, r.chapter, r.verse, false, q); } }, [el('span', { class: 'ref', text: upper(B.label(bible, r)) })]);
      markWord(b, r.text, q);
      rd.appendChild(b);
    });
  }
  let searchTimer = 0;
  $('bibleSearch').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 280); });
  $('bibleSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } if (e.key === 'Escape') { $('bibleSearch').value = ''; runSearch(); } });
  $('biblePhone').addEventListener('click', function () {
    call('bible:phone', { book: bookSel, chapter: chapSel }).then(function (r) { if (r && r.ok) toast('Opening ' + bible.books[bookSel] + ' ' + chapSel + ' on your phone.'); });
  });
  $('bibleBack').addEventListener('click', function () { go('god'); });

  // ---------- Prayer journal ----------

  function lockJournal() {
    journal = null;
    $('jText').value = '';
    $('jList').textContent = '';
    $('v-journal').dataset.j = 'locked';
  }

  function renderJournal() {
    const v = $('v-journal');
    v.dataset.j = journal ? 'open' : 'locked';
    if (!journal) return;
    const r = bible ? B.verseOfDay(bible, now()) : B.FALLBACK;
    $('jDay').textContent = upper('Today · ' + B.label(bible || { books: [] }, r));
    const kinds = $('jKinds');
    kinds.textContent = '';
    ['Request', 'Thanks', 'Confession'].forEach(function (k) {
      kinds.appendChild(el('button', { class: 'kind' + (k === jKind ? ' on' : ''), text: k, onclick: function () { jKind = k; renderJournal(); } }));
    });
    const list = $('jList');
    list.textContent = '';
    if (!journal.length) list.appendChild(el('li', { class: 'empty', style: 'display:block', text: 'Your prayers will show up here. Mark them answered when God answers.' }));
    journal.forEach(function (e, idx) {
      const d = new Date(e.t);
      const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      let meta = upper(e.kind + ' · ' + md);
      if (e.answered) meta += ' · ANSWERED ' + upper(new Date(e.answered).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const mark = el('button', { class: 'mark plain', title: e.answered ? 'Mark as not answered yet' : 'Mark answered', 'aria-label': e.answered ? 'Mark as not answered yet' : 'Mark answered', onclick: function () {
        e.answered = e.answered ? 0 : now();
        saveJournal();
      } }, [el('span')]);
      const del = el('button', { class: 'ibtn plain del', title: 'Delete', 'aria-label': 'Delete entry', onclick: function () {
        if (!del.dataset.sure) { del.dataset.sure = '1'; del.title = 'Click again to delete'; del.style.color = '#F1B5A8'; del.style.opacity = 1; setTimeout(function () { delete del.dataset.sure; del.style.color = ''; del.style.opacity = ''; }, 2500); return; }
        journal.splice(idx, 1);
        saveJournal();
      } }, [arrow('M6 6l12 12M18 6L6 18')]);
      list.appendChild(el('li', { class: (e.answered ? 'answered ' : '') + (e.kind === 'Thanks' ? 'thanks' : '') }, [mark, el('div', {}, [el('span', { class: 'txt', text: e.text }), el('span', { class: 'meta', text: meta })]), del]));
    });
  }

  function saveJournal() {
    call('journal:save', journal).then(function (r) { if (r && r.ok) renderJournal(); });
  }

  $('jUnlock').addEventListener('click', function () {
    call('journal:unlock').then(function (r) {
      if (!r || r.error) { if (r && r.error) $('jlockText').textContent = r.error; return; }
      journal = r.entries.slice().sort(function (a, b) { return b.t - a.t; });
      ensureBible().catch(function () { }).then(function () { renderJournal(); });
      renderJournal();
      const v = $('v-journal'); v.classList.remove('active'); void v.offsetWidth; v.classList.add('active');
      setTimeout(function () { $('jText').focus(); }, 500);
    });
  });
  $('jLock').addEventListener('click', function () { lockJournal(); const v = $('v-journal'); v.classList.remove('active'); void v.offsetWidth; v.classList.add('active'); });
  $('jSave').addEventListener('click', function () {
    const t = $('jText').value.trim();
    if (!t || !journal) return;
    journal.unshift({ t: now(), kind: jKind, text: t, answered: 0 });
    $('jText').value = '';
    saveJournal();
  });
  $('jText').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.ctrlKey) $('jSave').click(); });
  $('journalBack').addEventListener('click', function () { go('god'); });

  // ---------- Settings ----------

  function ago(t) {
    if (!t) return '';
    const s = Math.round((now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderSettings() {
    $('pairCode').textContent = st.pair.code || '—';
    const ps = $('pairStatus');
    const s = st.pair.status;
    ps.className = 'linkline ' + s;
    ps.textContent = '';
    ps.appendChild(el('span', { class: 'dot' }));
    ps.appendChild(document.createTextNode(
      s === 'live' ? (st.pair.lastMessage ? 'Connected · last message from your phone ' + ago(st.pair.lastMessage) : 'Connected · waiting for your phone') :
        s === 'connecting' ? 'Connecting to the relay…' : s === 'waiting' ? 'Offline · trying again' : 'Not connected'));
    $('tStart').classList.toggle('on', !!st.settings.startWithWindows);
    $('tStart').setAttribute('aria-checked', st.settings.startWithWindows ? 'true' : 'false');
    $('tWidget').classList.toggle('on', !!st.settings.showWidget);
    $('tWidget').setAttribute('aria-checked', st.settings.showWidget ? 'true' : 'false');
    renderDesk();
    const wifi = st.settings.phoneWifi !== false;
    $('tWifi').classList.toggle('on', wifi);
    $('tWifi').setAttribute('aria-checked', wifi ? 'true' : 'false');
    $('wifiAddr').textContent = !wifi ? 'Uses the USB cable' : st.settings.phoneAddr ? 'Phone at ' + st.settings.phoneAddr : 'Plug the phone in once to set it up';
    $('verName').textContent = st.version.name + (st.version.fellBack ? ' (an update failed to start, so this is the installed copy)' : '');
    const r = st.reasons[0];
    $('reasonCount').textContent = r ? 'Last reason: “' + r.why + '” (' + r.exe + ', ' + ago(r.t) + ')' : '';
    if (st.version.pending && !$('updMsg').dataset.busy) {
      $('updMsg').textContent = 'Focus ' + st.version.pending + ' is downloaded. ';
      $('updMsg').appendChild(el('button', { class: 'plain linkbtn', text: 'Restart now', onclick: function () { call('update:restart'); } }));
    }
  }

  function renderTheme() {
    const t = st.settings.theme === 'fall' ? 'fall' : 'night';
    document.body.classList.toggle('theme-fall', t === 'fall');
    $('theme').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === t); });
    document.querySelectorAll('.themeopt').forEach(function (r) { r.classList.toggle('hidden', t !== 'fall'); });
    $('themeMsg').textContent = st.settings.themePhotoAt ? 'Your photo is the desktop wallpaper, with leaves falling.' : 'Pick a photo for the desktop. It stays on this PC.';
    $('themePick').textContent = st.settings.themePhotoAt ? 'Change photo…' : 'Choose photo…';
  }

  function renderDesk() {
    renderTheme();
    const on = !!st.settings.desktop;
    $('tDesk').classList.toggle('on', on);
    $('tDesk').setAttribute('aria-checked', on ? 'true' : 'false');
    document.querySelectorAll('.deskopt').forEach(function (r) { r.classList.toggle('hidden', !on); });
    ['deskSide', 'deskStyle', 'deskSecond'].forEach(function (id) {
      const v = st.settings[id] || { deskSide: 'right', deskStyle: 'live', deskSecond: 'day' }[id];
      $(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    });
    const d = st.desk || { mode: 'off', why: '' };
    $('deskMsg').textContent = !on ? 'Turning it off put your old wallpaper back.' :
      d.mode === 'live' ? 'Live behind your icons: the time, your block, what\'s later and today\'s verse.' :
        d.mode === 'picture' ? (d.why || 'Set as your wallpaper picture. It\'s redrawn when your block changes.') :
          d.mode === 'unsupported' ? (d.why || 'Not available here.') :
            d.mode === 'starting' ? (d.why || 'Putting it on your desktop…') : '';
  }
  $('theme').addEventListener('click', function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    call('settings:set', { theme: b.dataset.v }).then(function (s) {
      apply(s);
      if (b.dataset.v === 'fall' && !s.settings.themePhotoAt) $('themePick').click();
    });
  });
  // Decodes the photo the way the browser shows it (upright, colour profile converted to sRGB), then keeps it
  // at most 3840 px on the long side as a high-quality JPEG.
  function scalePhoto(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    return img.decode()
      .then(function () { return createImageBitmap(img); })
      .then(function (bmp) {
        const k = Math.min(1, 3840 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        return c.toDataURL('image/jpeg', 0.93);
      });
  }
  $('themePick').addEventListener('click', function () {
    call('theme:pick').then(function (r) {
      if (!r || r.canceled) return null;
      if (r.error) { toast(r.error); return null; }
      toast('Getting your photo ready…');
      return scalePhoto(r.photo).then(function (jpeg) { return call('theme:save', jpeg); });
    }).then(function (s) {
      if (!s) return;
      if (s.error) toast(s.error);
      else if (s.settings) { apply(s); toast('Fall theme on, with your photo.'); }
    }).catch(function () { toast('That file couldn\u2019t be opened as a picture.'); });
  });
  $('tDesk').addEventListener('click', function () { call('settings:set', { desktop: !st.settings.desktop }).then(function (s) { apply(s); }); });
  ['deskSide', 'deskStyle', 'deskSecond'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      const arg = {}; arg[id] = b.dataset.v;
      call('settings:set', arg).then(function (s) { apply(s); });
    });
  });

  $('pairNew').addEventListener('click', function () {
    const b = $('pairNew');
    if (!b.dataset.sure && st.pair.code) {
      b.dataset.sure = '1'; b.textContent = 'Your phone will need the new code. Sure?';
      setTimeout(function () { delete b.dataset.sure; b.textContent = 'New code'; }, 4000);
      return;
    }
    delete b.dataset.sure; b.textContent = 'New code';
    call('pair:new').then(function (s) { if (s && s.pair) { st = s; renderSettings(); toast('New code made. Type it on your phone.'); } });
  });
  $('tStart').addEventListener('click', function () { call('settings:set', { startWithWindows: !st.settings.startWithWindows }).then(function (s) { apply(s); }); });
  $('tWifi').addEventListener('click', function () { call('settings:set', { phoneWifi: st.settings.phoneWifi === false }).then(function (s) { apply(s); }); });
  $('tWidget').addEventListener('click', function () { call('settings:set', { showWidget: !st.settings.showWidget }).then(function (s) { apply(s); }); });
  $('updCheck').addEventListener('click', function () {
    const m = $('updMsg');
    m.dataset.busy = '1';
    m.textContent = 'Checking…';
    api.invoke('update:check').then(function (r) {
      delete m.dataset.busy;
      m.textContent = '';
      if (!r) return;
      if (r.status === 'current') m.textContent = 'You have the newest version.';
      else if (r.status === 'error') m.textContent = 'Couldn\'t check: ' + r.message;
      else if (r.status === 'ready') {
        m.textContent = 'Focus ' + r.name + ' is downloaded. Restarting… ' + (r.notes || '');
      }
    });
  });
  $('openLog').addEventListener('click', function () { api.invoke('log:open'); });
  $('sendclip').addEventListener('click', function () { api.invoke('clip:send'); });

  // ---------- Pause ----------

  function openPause() {
    const m = $('pauseModal');
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    $('pauseReason').value = '';
    $('pauseGo').disabled = true;
    setTimeout(function () { $('pauseReason').focus(); }, 300);
  }
  function closePause() { const m = $('pauseModal'); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
  $('pauseReason').addEventListener('input', function () { $('pauseGo').disabled = U.wordCount($('pauseReason').value) < 4; });
  $('pauseGo').addEventListener('click', function () {
    call('pause:start', { reason: $('pauseReason').value }).then(function (r) { if (r && r.ok) { closePause(); toast('Blocking is paused until ' + S.clock(r.until) + '.'); } });
  });
  $('pauseCancel').addEventListener('click', closePause);
  $('pauseScrim').addEventListener('click', closePause);

  // ---------- window ----------

  $('wmin').addEventListener('click', function () { api.invoke('win:minimize'); });
  $('wclose').addEventListener('click', function () { api.invoke('win:close'); });
  $('homeCenter').addEventListener('click', function () { go(st && st.cur.preset === 'god' ? 'god' : 'today'); });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('pauseModal').classList.contains('open')) { closePause(); return; }
    if ($('blockModal').classList.contains('open')) { closeBlock(); return; }
    if (view === 'rest') go('god');
    else if ((view === 'bible' || view === 'journal') && flow === 'god') go('god');
    else if (view === 'god') { flow = ''; go('home'); }
  });

  api.on('state', function (s) {
    const prevKey = st ? st.cur.title + st.cur.start : '';
    st = s;
    const key = st.cur.title + st.cur.start;
    if (view === 'today' || view === 'presets' || view === 'settings' || view === 'home' || key !== prevKey) render(key !== prevKey);
    else { renderClock(); renderLink(); }
  });
  api.on('nav', function (n) { if (n && n.view) go(n.view, n); });
  api.on('fullscreen', function () { });

  // Every second: the clock and countdowns; a fresh snapshot when the block ends.
  let lastMinute = -1;
  setInterval(function () {
    if (!st) return;
    const t = now();
    const minute = Math.floor(t / 60000);
    if (t >= st.cur.end) { api.invoke('state:get').then(function (s) { st = s; render(true); }); return; }
    if (minute !== lastMinute) {
      lastMinute = minute;
      renderClock();
      if (view === 'home') renderHome(false);
      else if (view === 'god') renderGod(false);
      else if (view === 'rest') renderRest();
    }
  }, 1000);

  api.invoke('state:get').then(function (s) {
    st = s;
    presetSel = s.cur.preset;
    go(location.hash ? location.hash.slice(1) : 'home');
  });
})();
