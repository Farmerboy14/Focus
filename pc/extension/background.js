// Focus for Chrome and Opera. Asks Focus for Windows what's blocked right now, blocks those sites,
// counts YouTube time while a YouTube tab is in front, and sends pages to the phone.
'use strict';

const API = 'http://127.0.0.1:47613';
const STALE_MS = 5 * 60 * 1000;   // with the app gone for this long, stop blocking
let policy = null;
let policyAt = 0;
let rulesSig = '';
let ytPending = 0;                 // seconds not reported yet
let ytLastTick = 0;
let restored = false;

async function restore() {
  if (restored) return;
  restored = true;
  try {
    const s = await chrome.storage.session.get(['policy', 'policyAt', 'rulesSig', 'ytPending']);
    policy = s.policy || null; policyAt = s.policyAt || 0; rulesSig = s.rulesSig || ''; ytPending = s.ytPending || 0;
  } catch (e) { }
}

function persist() {
  chrome.storage.session.set({ policy: policy, policyAt: policyAt, rulesSig: rulesSig, ytPending: ytPending }).catch(function () { });
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    let h = u.hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  } catch (e) { return ''; }
}
function matches(host, rule) { return host === rule || host.endsWith('.' + rule); }
function isYouTube(host) { return matches(host, 'youtube.com') || matches(host, 'youtu.be'); }

/** What should happen to a host right now: null, or {kind}. */
function verdict(host) {
  if (!policy || !host) return null;
  for (const b of policy.blocked) if (matches(host, b.host)) return { kind: b.kind, host: b.host };
  if (policy.yt && policy.yt.over && isYouTube(host)) return { kind: 'youtube', host: 'youtube.com' };
  return null;
}

function pageFor(v) { return '/notnow.html?k=' + encodeURIComponent(v.kind) + '&h=' + encodeURIComponent(v.host); }

async function applyRules() {
  const list = [];
  if (policy && Date.now() - policyAt < STALE_MS) {
    policy.blocked.forEach(function (b) { list.push({ kind: b.kind, host: b.host }); });
    if (policy.yt && policy.yt.over && !list.some(function (b) { return b.host === 'youtube.com'; })) {
      list.push({ kind: 'youtube', host: 'youtube.com' }, { kind: 'youtube', host: 'youtu.be' });
    }
  }
  const sig = JSON.stringify(list);
  if (sig === rulesSig) return false;
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const rules = list.map(function (b, i) {
    return {
      id: i + 1, priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: pageFor({ kind: b.kind, host: b.host === 'youtu.be' ? 'youtube.com' : b.host }) } },
      condition: { requestDomains: [b.host], resourceTypes: ['main_frame'] }
    };
  });
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map(function (r) { return r.id; }), addRules: rules });
  rulesSig = sig;
  persist();
  return true;
}

/** Tabs that were already open on a site that just became blocked. */
async function sweepTabs(onlyActiveYouTube) {
  if (!policy) return;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const v = verdict(hostOf(t.url || ''));
    if (!v) continue;
    if (onlyActiveYouTube && v.kind === 'youtube' && !t.active) continue;
    chrome.tabs.update(t.id, { url: chrome.runtime.getURL(pageFor(v)) }).catch(function () { });
  }
}

async function poll() {
  await restore();
  try {
    const r = await fetch(API + '/policy', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const p = await r.json();
    const wasOver = !!(policy && policy.yt && policy.yt.over);
    policy = p;
    policyAt = Date.now();
    persist();
    const changed = await applyRules();
    if (changed || (p.yt.over && !wasOver)) await sweepTabs(false);
    chrome.action.setBadgeText({ text: '' }).catch(function () { });
  } catch (e) {
    if (policy && Date.now() - policyAt > STALE_MS) { policy = null; persist(); await applyRules(); }
    chrome.action.setBadgeBackgroundColor({ color: '#5B6170' }).catch(function () { });
    chrome.action.setBadgeText({ text: 'off' }).catch(function () { });
  }
}

async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Focus': '1' }, body: JSON.stringify(body) });
  return r.json();
}

/** Counts time while a YouTube tab is the active tab in the focused window, outside Free time. */
async function youTubeTick() {
  await restore();
  const now = Date.now();
  const dt = ytLastTick ? Math.min(10, (now - ytLastTick) / 1000) : 0;
  ytLastTick = now;
  if (!policy || !policy.yt || !policy.yt.counting || Date.now() - policyAt > STALE_MS) return;
  let watching = false;
  try {
    const w = await chrome.windows.getLastFocused({ populate: true });
    if (w && w.focused) {
      const tab = (w.tabs || []).find(function (t) { return t.active; });
      watching = !!(tab && isYouTube(hostOf(tab.url || '')));
    }
  } catch (e) { }
  if (!watching) return;
  ytPending += dt;
  persist();
  if (ytPending >= 15) {
    const sec = Math.round(ytPending);
    ytPending = 0;
    persist();
    try {
      const p = await post('/youtube', { seconds: sec });
      if (p && p.v) {
        const wasOver = !!(policy.yt && policy.yt.over);
        policy = p; policyAt = Date.now(); persist();
        await applyRules();
        if (p.yt.over && !wasOver) await sweepTabs(true);
      }
    } catch (e) { ytPending += sec; persist(); }
  }
}

function checkTab(tabId, url) {
  const v = verdict(hostOf(url || ''));
  if (v) chrome.tabs.update(tabId, { url: chrome.runtime.getURL(pageFor(v)) }).catch(function () { });
}

// ---------- events ----------

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: 'send-page', title: 'Send page to phone', contexts: ['page', 'frame', 'selection'] });
    chrome.contextMenus.create({ id: 'send-link', title: 'Send link to phone', contexts: ['link'] });
  });
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
  poll();
});
chrome.runtime.onStartup.addListener(function () { chrome.alarms.create('poll', { periodInMinutes: 0.5 }); poll(); });
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'poll') { poll(); youTubeTick(); } });

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  if (info.url) { poll().then(function () { checkTab(tabId, info.url); }); }
  else if (info.status === 'loading' && tab && tab.url) checkTab(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(function () { youTubeTick(); });
chrome.windows.onFocusChanged.addListener(function () { youTubeTick(); });

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  const url = info.menuItemId === 'send-link' ? info.linkUrl : (info.pageUrl || (tab && tab.url));
  sendToPhone(url, tab && tab.title);
});

async function sendToPhone(url, title) {
  if (!/^https?:\/\//i.test(url || '')) return { error: 'Only web pages can be sent.' };
  try {
    const r = await post('/send', { url: url, title: title || '' });
    chrome.action.setBadgeBackgroundColor({ color: '#C9A85A' }).catch(function () { });
    chrome.action.setBadgeText({ text: r && r.ok ? '✓' : '!' }).catch(function () { });
    setTimeout(function () { chrome.action.setBadgeText({ text: '' }).catch(function () { }); }, 2500);
    return r;
  } catch (e) {
    chrome.action.setBadgeText({ text: 'off' }).catch(function () { });
    return { error: 'Focus for Windows isn\'t running.' };
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (msg && msg.type === 'policy') { poll().then(function () { reply({ policy: policy && Date.now() - policyAt < STALE_MS ? policy : null }); }); return true; }
  if (msg && msg.type === 'send') { sendToPhone(msg.url, msg.title).then(reply); return true; }
  if (msg && msg.type === 'show') { post('/show', { view: msg.view }).then(reply, function () { reply({ error: 'off' }); }); return true; }
  return false;
});

// While the browser is open: check the active tab every 5 s (an extension call also keeps this worker awake).
setInterval(function () {
  chrome.runtime.getPlatformInfo().catch(function () { });
  youTubeTick();
}, 5000);
setInterval(poll, 15000);
poll();
