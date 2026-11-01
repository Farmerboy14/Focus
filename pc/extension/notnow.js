'use strict';
(function () {
  const q = new URLSearchParams(location.search);
  const kind = q.get('k') || 'block';
  const host = q.get('h') || 'This site';
  const $ = function (id) { return document.getElementById(id); };
  let god = false;

  function fill(p) {
    const block = p ? p.block.title : 'this block';
    const preset = p ? p.presetName : 'this block';
    god = !!(p && p.preset === 'god');
    $('tag').textContent = host + ' · ' + (kind === 'entertainment' ? 'Entertainment' : kind === 'youtube' ? 'Video' : preset);
    if (kind === 'entertainment') $('msg').textContent = 'Entertainment opens in Free time. ' + (p && p.nextFreeLabel ? 'The next one starts at ' + p.nextFreeLabel + '.' : 'There\'s no Free time left today.');
    else if (kind === 'youtube') $('msg').textContent = 'You\'ve used today\'s ' + (p ? p.yt.limitMin : 15) + ' minutes of YouTube. It opens again in Free time.';
    else $('msg').textContent = host + ' isn\'t part of ' + preset + '. You can change that in Focus → Presets.';
    $('nowline').textContent = p ? 'Now · ' + block + ' · until ' + p.block.endLabel : '';
    $('back').textContent = god ? 'Open Time with God instead' : 'Back to ' + block;
  }
  fill(null);
  chrome.runtime.sendMessage({ type: 'policy' }, function (r) { if (r && r.policy) fill(r.policy); });

  function closeTab() {
    chrome.tabs.getCurrent(function (t) { if (t) chrome.tabs.remove(t.id); else window.close(); });
  }
  $('back').addEventListener('click', function () {
    if (god) chrome.runtime.sendMessage({ type: 'show', view: 'god' });
    if (history.length > 1) history.back(); else closeTab();
  });
  $('close').addEventListener('click', closeTab);
})();
