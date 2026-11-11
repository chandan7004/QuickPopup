// Quick Popup Search: service worker.
// "Open anything. Lose nothing. Return instantly."
//
// Single source of truth for window state:
//   chrome.storage.session (cleared when Chrome restarts, so no stale window ids survive):
//     popups:     { [windowId]: { originWindowId, originTabId, pinned, pinnedAt, focused, lastActive,
//                                 url, title, promoted, silent } }
//     lastNormal: { windowId, tabId }   last active tab in a normal window (fallback "original")
//     prevFocus:  { windowId, normal }  last focused real window
//   chrome.storage.local (persistent):
//     recent, closed, bounds, settings { cleanupMinutes, enterMode: 'new' (default) | 'reuse' }

const DEFAULT_W = 650, DEFAULT_H = 750, MAX_CLOSED = 15;

// ---------- serialization ----------
function makeQueue() {
  let q = Promise.resolve();
  return (fn) => { const run = q.then(fn); q = run.catch(() => {}); return run; };
}
const registryQueue = makeQueue(); // read-modify-write of `popups`
const actionQueue = makeQueue();   // user actions run one at a time (no duplicate popups)

const lastCommandAt = {};
function runCommand(name, fn) {
  const now = Date.now();
  if (now - (lastCommandAt[name] || 0) < 400) return; // ignore key-repeat / double press
  lastCommandAt[name] = now;
  return actionQueue(fn);
}

// ---------- registry ----------
function withPopups(fn) {
  return registryQueue(async () => {
    const { popups = {} } = await chrome.storage.session.get('popups');
    const result = await fn(popups);
    await chrome.storage.session.set({ popups });
    await updateBadge(popups);
    return result;
  });
}

async function getPopups() {
  const { popups = {} } = await chrome.storage.session.get('popups');
  return popups;
}

async function updateBadge(popups) {
  const pinned = Object.values(popups).filter(p => p.pinned).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  await chrome.action.setBadgeText({ text: pinned ? `P${pinned}` : '' });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { cleanupMinutes: 0, enterMode: 'new', ...settings };
}

async function pushClosed(item) {
  if (!item.url || !/^https?:/i.test(item.url)) return;
  const { closed = [] } = await chrome.storage.local.get('closed');
  const next = [{ ...item, closedAt: Date.now() }, ...closed.filter(c => c.url !== item.url)];
  await chrome.storage.local.set({ closed: next.slice(0, MAX_CLOSED) });
}

// ---------- window helpers ----------
async function windowExists(id) {
  try { await chrome.windows.get(id); return true; } catch { return false; }
}

async function isNormal(id) {
  try { return (await chrome.windows.get(id)).type === 'normal'; } catch { return false; }
}

// live popup window ids, most recently used first (drops closed ones from the registry)
async function livePopupIds() {
  const entries = Object.entries(await getPopups()).sort((a, b) => b[1].lastActive - a[1].lastActive);
  const live = [];
  for (const [id] of entries) {
    if (await windowExists(Number(id))) live.push(Number(id));
    else await withPopups(p => { delete p[id]; });
  }
  return live;
}

async function findReusable() {
  const popups = await getPopups();
  for (const id of await livePopupIds()) if (popups[id] && !popups[id].pinned) return id;
  return null;
}

async function lastNormalOrigin() {
  try {
    const w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    const t = w.tabs.find(x => x.active);
    return { windowId: w.id, tabId: t ? t.id : null };
  } catch { return null; }
}

// Where "back" goes for a popup entry. Order: the origin tab (wherever it lives now, if it's in a
// normal window) -> the origin window -> the last active normal tab -> any normal window.
async function resolveOrigin(e) {
  if (e && e.originTabId != null) {
    try {
      const t = await chrome.tabs.get(e.originTabId);
      if (await isNormal(t.windowId)) return { windowId: t.windowId, tabId: t.id };
    } catch { /* tab closed */ }
  }
  if (e && e.originWindowId != null && await isNormal(e.originWindowId)) return { windowId: e.originWindowId, tabId: null };
  const { lastNormal } = await chrome.storage.session.get('lastNormal');
  if (lastNormal && await isNormal(lastNormal.windowId)) return lastNormal;
  const [any] = await chrome.windows.getAll({ windowTypes: ['normal'] });
  return any ? { windowId: any.id, tabId: null } : null;
}

async function returnFocus(e) {
  const o = await resolveOrigin(e);
  if (!o) return;
  await chrome.windows.update(o.windowId, { focused: true }).catch(() => {});
  if (o.tabId != null) await chrome.tabs.update(o.tabId, { active: true }).catch(() => {});
}

// remember explicitly where the user came from (also becomes the fallback "last normal" tab)
async function setOrigin(id, origin, extra = {}) {
  if (origin) await chrome.storage.session.set({ lastNormal: { windowId: origin.windowId, tabId: origin.tabId ?? null } });
  await withPopups(p => {
    if (!p[id]) return;
    Object.assign(p[id], extra, { lastActive: Date.now() });
    if (origin) Object.assign(p[id], { originWindowId: origin.windowId, originTabId: origin.tabId ?? null });
  });
}

async function centeredOver(originWindowId) {
  try {
    const w = await chrome.windows.get(originWindowId);
    return {
      width: DEFAULT_W, height: DEFAULT_H,
      left: w.left + Math.round((w.width - DEFAULT_W) / 2),
      top: w.top + Math.round((w.height - DEFAULT_H) / 2),
    };
  } catch { return null; }
}

// Bounds to try, in order: saved position, centred over the origin window, default size, Chrome's
// choice. Extra popups cascade (max 5 steps). Coordinates may be negative (screens left of / above
// the primary one), so nothing is clamped to 0. Chrome itself rejects bounds that are less than 50%
// on a connected screen (e.g. after unplugging a monitor), and createPopup then tries the next one.
// (chrome.system.display isn't available in the service worker, so we let Chrome be the judge.)
async function popupBoundsCandidates(originWindowId, offsetIndex) {
  const { bounds: saved } = await chrome.storage.local.get('bounds');
  const off = 30 * Math.min(offsetIndex, 5);
  const shift = (b) => ({ ...b, left: b.left + off, top: b.top + off });
  const list = [];
  if (saved) list.push(shift(saved));
  const centred = await centeredOver(originWindowId);
  if (centred) list.push(shift(centred));
  list.push({ width: DEFAULT_W, height: DEFAULT_H }, {});
  return list;
}

function isBoundsError(err) {
  return /bounds/i.test(String(err && err.message));
}

async function createPopup({ url, tabId, origin }) {
  const n = (await livePopupIds()).length;
  const base = { type: 'popup', focused: true };
  if (tabId != null) base.tabId = tabId; else base.url = url;
  if (origin) await chrome.storage.session.set({ lastNormal: { windowId: origin.windowId, tabId: origin.tabId ?? null } });
  let win = null;
  for (const bounds of await popupBoundsCandidates(origin?.windowId, n)) {
    try {
      win = await chrome.windows.create({ ...base, ...bounds });
      break;
    } catch (err) {
      if (!isBoundsError(err)) throw err; // only off-screen bounds are worth retrying
    }
  }
  if (!win) throw new Error('Could not open a popup window');
  const tab = win.tabs && win.tabs[0];
  await withPopups(p => {
    p[win.id] = {
      originWindowId: origin?.windowId ?? null,
      originTabId: origin?.tabId ?? null,
      pinned: false, focused: true, lastActive: Date.now(),
      url: (tab && (tab.url || tab.pendingUrl)) || url || '',
      title: (tab && tab.title) || '',
    };
  });
  return win;
}

// ---------- actions ----------
// mode: 'reuse' (replace the most recent unpinned popup), 'new' (extra popup), 'tab' (normal tab)
async function openUrl({ url, mode = 'reuse', origin }) {
  origin = origin || (await lastNormalOrigin());
  if (mode === 'tab') {
    await chrome.tabs.create({ url, windowId: origin?.windowId });
    return;
  }
  if (mode === 'reuse') {
    const id = await findReusable();
    if (id != null) {
      const [tab] = await chrome.tabs.query({ windowId: id, active: true });
      if (tab) {
        // Lose nothing: the page being replaced goes to "Recently closed"
        if (tab.url && tab.url !== url) await pushClosed({ url: tab.url, title: tab.title, replaced: true });
        await setOrigin(id, origin, { url, title: '' });
        await chrome.tabs.update(tab.id, { url });
        await chrome.windows.update(id, { focused: true });
        return;
      }
    }
  }
  await createPopup({ url, origin });
}

async function focusPopup(id, origin) {
  await setOrigin(id, origin);
  await chrome.windows.update(id, { focused: true });
}

// Popup -> normal tab. tabs.move keeps the live page (scroll, form input, video); verified on
// Chrome 157. Older docs said only normal<->normal moves are allowed, so if Chrome refuses, the
// page is reopened in a tab instead (it reloads).
async function promote(win, tab) {
  const entry = (await getPopups())[win.id];
  const target = (await resolveOrigin(entry || {}))?.windowId ?? null;
  const url = tab.url || tab.pendingUrl;
  const setPromoted = (v) => withPopups(p => { if (p[win.id]) p[win.id].promoted = v; });
  // Mark first: closing the popup is part of this move, so it must not land in "Recently closed"
  // or yank focus back to the origin. Cleared again if anything fails.
  await setPromoted(true);
  try {
    if (target == null) {
      try {
        await chrome.windows.create({ tabId: tab.id, type: 'normal', focused: true });
      } catch {
        await chrome.windows.create({ url, type: 'normal', focused: true });
        await chrome.windows.remove(win.id).catch(() => setPromoted(false));
      }
      return;
    }
    try {
      await chrome.tabs.move(tab.id, { windowId: target, index: -1 });
      await chrome.tabs.update(tab.id, { active: true });
    } catch {
      await chrome.tabs.create({ windowId: target, url, active: true });
      await chrome.windows.remove(win.id).catch(() => setPromoted(false));
    }
    await chrome.windows.update(target, { focused: true });
  } catch (err) {
    await setPromoted(false); // nothing moved: the popup stays a normal tracked popup
    throw err;
  }
}

async function focusedWindow() {
  return chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal', 'popup'] });
}

async function togglePopout() {
  const win = await focusedWindow();
  const tab = win.tabs.find(t => t.active);
  if (!tab) return;
  if (win.type === 'popup') return promote(win, tab);
  // the popped-out tab leaves this window, so "back" means the window (whatever tab is active then)
  await createPopup({ tabId: tab.id, origin: { windowId: win.id, tabId: null } });
}

async function togglePin() {
  const win = await focusedWindow();
  await withPopups(p => {
    const e = p[win.id];
    if (e) { e.pinned = !e.pinned; e.pinnedAt = e.pinned ? Date.now() : null; }
  });
}

async function reopenClosed(index = 0, mode = 'new', origin = null) {
  const { closed = [] } = await chrome.storage.local.get('closed');
  const item = closed[index];
  if (!item) return;
  closed.splice(index, 1);
  await chrome.storage.local.set({ closed });
  await openUrl({ url: item.url, mode, origin });
}

async function openSearchBox(win) {
  // Popup-type windows have no toolbar (this also stops the fallback window from stacking).
  if (!win || win.type !== 'normal') return;
  if (typeof chrome.action.openPopup === 'function') {
    // Chrome 127+ (minimum_chrome_version). Rejects e.g. when the search box is already showing.
    await chrome.action.openPopup({ windowId: win.id }).catch(() => {});
    return;
  }
  // Safety net only: show the search box in its own small window
  const tab = win.tabs.find(t => t.active);
  const q = new URLSearchParams({ w: win.id, t: tab ? tab.id : '' });
  await chrome.windows.create({ url: `popup.html?${q}`, type: 'popup', width: 420, height: 480, focused: true });
}

// Cmd+Shift+K:
//   in one of our popups -> back to where you came from (popup stays open)
//   1 popup              -> bring it forward
//   2+ popups            -> switcher with the most recent popup preselected
//   no popup             -> search box
async function smartToggle() {
  const win = await focusedWindow();
  const popups = await getPopups();
  if (popups[win.id]) return returnFocus(popups[win.id]);
  if (win.type === 'normal') {
    const live = await livePopupIds();
    if (live.length >= 2) {
      await chrome.storage.session.set({ preselectUntil: Date.now() + 3000 });
      return openSearchBox(win);
    }
    if (live.length === 1) {
      const tab = win.tabs.find(t => t.active);
      return focusPopup(live[0], { windowId: win.id, tabId: tab ? tab.id : null });
    }
  }
  return openSearchBox(win);
}

// ---------- events ----------
chrome.commands.onCommand.addListener((command) => {
  if (command === 'smart-toggle') return runCommand(command, smartToggle);
  if (command === 'open-search') return runCommand(command, () => focusedWindow().then(openSearchBox));
  if (command === 'toggle-popout') return runCommand(command, togglePopout);
  if (command === 'toggle-pin') return runCommand(command, togglePin);
  if (command === 'reopen-closed') return runCommand(command, () => reopenClosed());
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'open') return actionQueue(() => openUrl(msg));
    if (msg.type === 'reopen') return actionQueue(() => reopenClosed(msg.index, msg.mode, msg.origin));
    if (msg.type === 'focus') return actionQueue(() => focusPopup(msg.windowId, msg.origin));
    if (msg.type === 'state') {
      const live = await livePopupIds();
      const popups = await getPopups();
      const open = live.filter(id => popups[id]).map(id => ({ windowId: id, ...popups[id] }));
      const pinnedOrder = open.filter(p => p.pinned).sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0));
      for (const p of open) p.pinNo = p.pinned ? pinnedOrder.indexOf(p) + 1 : 0;
      const target = open.find(p => !p.pinned); // what a plain "reuse" would replace
      const { closed = [] } = await chrome.storage.local.get('closed');
      const { preselectUntil = 0 } = await chrome.storage.session.get('preselectUntil');
      await chrome.storage.session.remove('preselectUntil');
      const { enterMode } = await getSettings();
      return {
        popups: open.map(({ windowId, url, title, pinned, pinNo, lastActive }) => ({ windowId, url, title, pinned, pinNo, lastActive })),
        closed,
        reuseTargetId: target ? target.windowId : null,
        enterMode,
        preselect: Date.now() < preselectUntil,
      };
    }
  })().then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true; // async response
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const entry = await withPopups(p => { const e = p[windowId]; delete p[windowId]; return e; });
  if (!entry || entry.promoted) return;
  await pushClosed({ url: entry.url, title: entry.title });
  if (!entry.silent) await returnFocus(entry);
});

// Track the last active tab in normal windows, and re-point a popup's origin to wherever the user
// was right before entering it from a normal window (mouse, shortcut or switcher alike).
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const popups = await getPopups();
  const { prevFocus, lastNormal } = await chrome.storage.session.get(['prevFocus', 'lastNormal']);
  const normal = !popups[windowId] && await isNormal(windowId);
  await chrome.storage.session.set({ prevFocus: { windowId, normal } });
  if (normal) {
    try {
      const [t] = await chrome.tabs.query({ windowId, active: true });
      await chrome.storage.session.set({ lastNormal: { windowId, tabId: t ? t.id : null } });
    } catch { /* window gone */ }
  }
  const touches = popups[windowId] || Object.values(popups).some(e => e.focused);
  if (!touches) return;
  await withPopups(p => {
    const now = Date.now();
    for (const e of Object.values(p)) if (e.focused) { e.focused = false; e.lastActive = now; }
    const e = p[windowId];
    if (!e) return;
    e.focused = true;
    e.lastActive = now;
    const cameFromNormal = prevFocus && prevFocus.normal && prevFocus.windowId !== windowId;
    if (cameFromNormal && lastNormal && lastNormal.windowId === prevFocus.windowId) {
      e.originWindowId = lastNormal.windowId;
      e.originTabId = lastNormal.tabId;
    }
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if ((await getPopups())[windowId]) return;
  try {
    const w = await chrome.windows.get(windowId);
    if (w.type === 'normal' && w.focused) await chrome.storage.session.set({ lastNormal: { windowId, tabId } });
  } catch { /* window gone */ }
});

chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (win.state && win.state !== 'normal') return; // skip fullscreen / maximized / minimized
  if (!(await getPopups())[win.id]) return;
  await chrome.storage.local.set({ bounds: { left: win.left, top: win.top, width: win.width, height: win.height } });
});

chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (!info.url && !info.title) return;
  if (!(await getPopups())[tab.windowId]) return;
  await withPopups(p => {
    const e = p[tab.windowId];
    if (!e) return;
    if (tab.url) e.url = tab.url;
    if (tab.title) e.title = tab.title;
  });
});

// ---------- install / startup ----------
function ensureAlarm() { chrome.alarms.create('cleanup', { periodInMinutes: 1 }); }

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureAlarm();
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});
chrome.runtime.onStartup.addListener(ensureAlarm);

// ---------- auto-cleanup of idle, unpinned popups ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'cleanup') return;
  const mins = Number((await getSettings()).cleanupMinutes) || 0;
  if (!mins) return;
  const cutoff = Date.now() - mins * 60000;
  for (const [id, e] of Object.entries(await getPopups())) {
    if (e.pinned || e.focused || e.lastActive > cutoff) continue;
    await withPopups(p => { if (p[id]) p[id].silent = true; });
    await chrome.windows.remove(Number(id)).catch(() => withPopups(p => { delete p[id]; }));
  }
});
