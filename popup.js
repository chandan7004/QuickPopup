const MAX_RECENT = 10;

const ENGINES = {
  yt:  { name: 'YouTube',        url: 'https://www.youtube.com/results?search_query=' },
  gh:  { name: 'GitHub',         url: 'https://github.com/search?q=' },
  so:  { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
  hex: { name: 'Hex',            url: 'https://hex.pm/packages?search=' },
  w:   { name: 'Wikipedia',      url: 'https://en.wikipedia.org/w/index.php?search=' },
  g:   { name: 'Google',         url: 'https://www.google.com/search?q=' },
};

function resolve(val) {
  const m = val.match(/^(\S+)\s+(.+)$/);
  const engine = m && ENGINES[m[1].toLowerCase()];
  if (engine) {
    const q = m[2].trim();
    return { url: engine.url + encodeURIComponent(q), label: `${engine.name}: ${q}` };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(val)) return { url: val, label: val };
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#].*)?$/i.test(val)) return { url: 'http://' + val, label: 'http://' + val };
  if (!val.includes(' ') && /^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(val)) return { url: 'https://' + val, label: 'https://' + val };
  return { url: ENGINES.g.url + encodeURIComponent(val), label: `Google: ${val}` };
}

if (typeof document === 'undefined') {
  // allow unit-testing resolve() under node
  if (typeof module !== 'undefined') module.exports = { resolve };
} else {
  const input = document.getElementById('q');
  const list = document.getElementById('list');
  const preview = document.getElementById('preview');
  let state = { recent: [], popups: [], closed: [] };
  let items = [];
  let active = -1;
  let origin = null;

  const ICONS = {
    globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
    history: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };

  // Enter = settings.enterMode ('reuse' or 'new'); Cmd/Ctrl+Enter = the other one; Shift+Enter = tab
  const baseMode = () => state.enterMode || 'reuse';
  const altMode = () => (baseMode() === 'reuse' ? 'new' : 'reuse');
  const modeFor = (e) => (e.shiftKey ? 'tab' : (e.metaKey || e.ctrlKey) ? altMode() : baseMode());
  const reuseTarget = () => state.popups.find(p => p.windowId === state.reuseTargetId);
  function describeMode(mode) {
    if (mode === 'tab') return 'new tab';
    if (mode === 'new') return 'new popup';
    const t = reuseTarget();
    return t ? `replaces “${t.title || hostOf(t.url)}”` : 'popup';
  }
  const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };
  const shortUrl = (url) => { try { const u = new URL(url); return u.host + u.pathname.replace(/\/$/, '') + u.search; } catch { return url; } };
  function ago(ts) {
    if (!ts) return '';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }
  const favicon = (url) => `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;

  function iconEl(row) {
    const span = document.createElement('span');
    span.className = 'icon';
    if (row.kind === 'open' && row.data.url) {
      const img = document.createElement('img');
      img.src = favicon(row.data.url);
      img.onerror = () => { span.innerHTML = ICONS.globe; };
      span.appendChild(img);
    } else {
      span.innerHTML = row.kind === 'closed' ? ICONS.history : ICONS.search;
    }
    return span;
  }

  function rowEl(row, idx) {
    const li = document.createElement('li');
    li.className = 'item' + (idx === active ? ' active' : '');
    li.title = row.data.url || row.title;
    li.appendChild(iconEl(row));

    const text = document.createElement('div');
    text.className = 'text';
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = row.title;
    text.appendChild(t);
    if (row.sub) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = row.sub;
      text.appendChild(s);
    }
    li.appendChild(text);

    const right = document.createElement('div');
    right.className = 'right';
    const action = document.createElement('span');
    action.className = 'action';
    action.textContent = row.action + ' ↵';
    right.appendChild(action);
    if (row.target) {
      const p = document.createElement('span');
      p.className = 'pill target';
      p.textContent = '↵ replaces';
      p.title = 'A new search with Enter replaces this popup (pin it with Alt+Shift+L to protect it)';
      right.appendChild(p);
    }
    if (row.pill) {
      const p = document.createElement('span');
      p.className = 'pill';
      p.textContent = row.pill;
      right.appendChild(p);
    }
    li.appendChild(right);

    li.addEventListener('mousedown', (e) => { e.preventDefault(); act(row, modeFor(e)); });
    return li;
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    const match = (...s) => !q || s.some(x => x && x.toLowerCase().includes(q));
    const labelOf = (p) => p.title || hostOf(p.url) || p.url;
    const seen = {};
    for (const p of state.popups) seen[labelOf(p)] = (seen[labelOf(p)] || 0) + 1;
    const sections = [
      ['Open popups', state.popups.filter(p => match(p.title, p.url)).map(p => ({
        kind: 'open', title: labelOf(p),
        // same title twice? show the fuller URL; always show when it was last used
        sub: [ago(p.lastActive), seen[labelOf(p)] > 1 ? shortUrl(p.url) : hostOf(p.url)].filter(Boolean).join(' · '),
        pill: p.pinned ? `P${p.pinNo || ''}` : '', action: 'Switch', data: p,
        target: baseMode() === 'reuse' && p.windowId === state.reuseTargetId,
      }))],
      ['Recent searches', state.recent.filter(r => match(r)).slice(0, q ? MAX_RECENT : 3).map(r => ({
        kind: 'search', title: r, sub: '', action: 'Open', data: r,
      }))],
      ['Recently closed', state.closed.map((c, i) => ({ ...c, i })).filter(c => match(c.title, c.url)).map(c => ({
        kind: 'closed', title: c.title || c.url, sub: hostOf(c.url) + (c.replaced ? ' · replaced' : ''), action: 'Restore', data: c,
      }))],
    ];

    items = [];
    list.innerHTML = '';
    let first = true;
    for (const [title, rows] of sections) {
      if (!rows.length) continue;
      if (!first) { const d = document.createElement('li'); d.className = 'divider'; list.appendChild(d); }
      first = false;
      const h = document.createElement('li');
      h.className = 'section';
      h.textContent = title;
      list.appendChild(h);
      for (const row of rows) {
        const idx = items.length;
        items.push(row);
        const li = rowEl(row, idx);
        list.appendChild(li);
        if (idx === active) li.scrollIntoView({ block: 'nearest' });
      }
    }
    if (!items.length && !q) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Type a URL or search. Try “yt badminton” or “gh redis”.';
      list.appendChild(li);
    }
    if (active >= items.length) active = items.length - 1;
    updatePreview();
  }

  function updatePreview(mode = baseMode()) {
    updateHints(mode);
    const val = input.value.trim();
    if (active >= 0) {
      const it = items[active];
      if (it.kind === 'search') preview.textContent = `↵ ${describeMode(mode)} → ${resolve(it.data).label}`;
      else if (it.kind === 'open') preview.textContent = `↵ switch to “${it.title}”`;
      else preview.textContent = `↵ restore in ${mode === 'tab' ? 'new tab' : 'new popup'}`;
    } else {
      preview.textContent = val ? `↵ ${describeMode(mode)} → ${resolve(val).label}` : '';
    }
  }

  // short label for what a search does in `mode`
  function shortMode(mode) {
    if (mode === 'tab') return 'tab';
    if (mode === 'new') return 'new popup';
    return reuseTarget() ? 'replace popup' : 'popup';
  }

  // footer shows only the keys that matter right now
  function updateHints(mode) {
    const typing = input.value.trim() !== '';
    const it = active >= 0 ? items[active] : null;
    let keys;
    if (it && it.kind === 'open') keys = [['↵', 'switch'], ['↑↓', 'pick']];
    else if (it && it.kind === 'closed') keys = [['↵', 'restore'], ['⇧↵', 'in tab'], ['↑↓', 'pick']];
    else if (it || typing) keys = [['↵', shortMode(baseMode())], ['⌘↵', shortMode(altMode())], ['⇧↵', 'tab']];
    else keys = [['↑↓', 'pick'], ['yt gh so hex w', '+ query']];
    const box = document.getElementById('hintKeys');
    box.innerHTML = '';
    for (const [k, label] of keys) {
      const span = document.createElement('span');
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      span.append(kbd, ' ' + label);
      box.appendChild(span);
    }
    // the "↵ replaces" tag is only true while Enter would run a search into the reused popup
    document.body.classList.toggle('show-target', typing && !it && mode === 'reuse');
  }

  async function remember(val) {
    const recent = [val, ...state.recent.filter(r => r !== val)].slice(0, MAX_RECENT);
    await chrome.storage.local.set({ recent });
  }

  async function act(item, mode) {
    if (item.kind === 'search') return go(item.data, mode);
    if (item.kind === 'open') await chrome.runtime.sendMessage({ type: 'focus', windowId: item.data.windowId, origin });
    if (item.kind === 'closed') await chrome.runtime.sendMessage({ type: 'reopen', index: item.data.i, mode: mode === 'reuse' ? 'new' : mode, origin });
    window.close();
  }

  async function go(val, mode) {
    val = val.trim();
    if (!val) return;
    await remember(val);
    await chrome.runtime.sendMessage({ type: 'open', url: resolve(val).url, mode, origin });
    window.close();
  }

  input.addEventListener('input', () => { active = -1; render(); });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      active = active + 1 >= items.length ? -1 : active + 1;
      render();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      active = active <= -1 ? items.length - 1 : active - 1;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) act(items[active], modeFor(e));
      else go(input.value, modeFor(e));
    } else if (e.key === 'Escape') {
      window.close();
    } else if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control') {
      updatePreview(modeFor(e));
    }
  });
  input.addEventListener('keyup', (e) => updatePreview(modeFor(e)));

  document.getElementById('settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  (async () => {
    input.focus();
    const params = new URLSearchParams(location.search);
    if (params.get('w')) {
      // opened as a standalone window (fallback for older Chrome)
      origin = { windowId: Number(params.get('w')), tabId: params.get('t') ? Number(params.get('t')) : null };
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      origin = tab ? { windowId: tab.windowId, tabId: tab.id } : null;
    }
    const [{ recent = [] }, bg] = await Promise.all([
      chrome.storage.local.get('recent'),
      chrome.runtime.sendMessage({ type: 'state' }),
    ]);
    state = {
      recent,
      popups: (bg && bg.popups) || [],
      closed: (bg && bg.closed) || [],
      reuseTargetId: bg ? bg.reuseTargetId : null,
      enterMode: (bg && bg.enterMode) || 'reuse',
    };
    // opened by Cmd+Shift+K with 2+ popups: preselect the most recent one so Enter switches to it
    if (bg && bg.preselect && state.popups.length) active = 0;
    render();
  })();
}
