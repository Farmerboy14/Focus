// The "Not now" overlay shown when a program isn't part of this block.
(function () {
  'use strict';
  const api = window.focusApp;
  const U = window.FocusUI;
  const $ = function (id) { return document.getElementById(id); };
  const nn = $('nn');
  let data = null, closing = false;

  function message(d) {
    if (d.kind === 'entertainment') return 'Entertainment opens in Free time. ' + (d.nextFree ? 'The next one starts at ' + d.nextFree + '.' : 'There\'s no Free time left today.');
    if (d.kind === 'reason') return d.label + ' needs a reason during ' + d.presetName + '. Write one sentence about why you need it.';
    return d.label + ' isn\'t part of ' + d.presetName + '. You can change that in Presets.';
  }

  function show(d) {
    data = d;
    closing = false;
    nn.dataset.kind = d.kind;
    $('tag').textContent = (d.label + ' · ' + (d.kind === 'entertainment' ? 'Entertainment' : d.presetName)).toUpperCase();
    $('msg').textContent = message(d);
    $('nowline').textContent = 'Now · ' + d.blockTitle + ' · until ' + d.blockEnd;
    $('back').textContent = d.presetId === 'god' ? 'Open Time with God instead' : 'Back to ' + d.blockTitle;
    $('reason').value = '';
    $('open').disabled = true;
    nn.classList.remove('open');
    void nn.offsetWidth;
    requestAnimationFrame(function () { nn.classList.add('open'); });
    setTimeout(function () { (d.kind === 'reason' ? $('reason') : $('back')).focus(); }, 350);
  }

  function hide(then) {
    if (closing) return;
    closing = true;
    nn.classList.remove('open');
    setTimeout(function () { closing = false; then(); }, U.reduced ? 0 : 320);
  }

  $('reason').addEventListener('input', function () { $('open').disabled = U.wordCount($('reason').value) < 4; });
  $('reason').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!$('open').disabled) $('open').click(); } });
  $('open').addEventListener('click', function () {
    const why = $('reason').value.trim();
    hide(function () { api.invoke('notnow:pass', { exe: data.exe, hwnd: data.hwnd, reason: why }); });
  });
  $('back').addEventListener('click', function () { hide(function () { api.invoke('notnow:back'); }); });
  $('close').addEventListener('click', function () { hide(function () { api.invoke('notnow:close'); }); });
  $('scrim').addEventListener('click', function () { hide(function () { api.invoke('notnow:close'); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(function () { api.invoke('notnow:close'); }); });

  api.on('notnow:show', show);
})();
