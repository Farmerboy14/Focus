'use strict';
(function () {
  const $ = function (id) { return document.getElementById(id); };
  chrome.runtime.sendMessage({ type: 'policy' }, function (r) {
    const p = r && r.policy;
    $('on').hidden = !p;
    $('off').hidden = !!p;
    if (!p) return;
    $('preset').textContent = 'NOW · ' + p.presetName + (p.paused ? ' · PAUSED' : '');
    $('block').textContent = p.block.title;
    $('until').textContent = 'UNTIL ' + p.block.endLabel;
    const used = Math.floor(p.yt.usedSec / 60);
    $('yt').textContent = '';
    if (p.preset === 'free') $('yt').textContent = 'YouTube is open in Free time.';
    else {
      $('yt').appendChild(document.createTextNode('YouTube today: ' + used + ' of ' + p.yt.limitMin + ' minutes'));
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.min(100, p.yt.limitMin ? (p.yt.usedSec / 60 / p.yt.limitMin) * 100 : 100) + '%';
      bar.appendChild(fill); $('yt').appendChild(bar);
    }
  });
  $('send').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const t = tabs[0];
      if (!t) return;
      $('msg').textContent = 'Sending…';
      chrome.runtime.sendMessage({ type: 'send', url: t.url, title: t.title }, function (r) {
        $('msg').textContent = r && r.ok ? 'Sent to your phone.' : (r && r.error) || 'Couldn\'t send.';
      });
    });
  });
})();
