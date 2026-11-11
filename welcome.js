const LABELS = {
  'smart-toggle': 'Search / switch / go back',
  'toggle-popout': 'Pop tab out ↔ back into a tab',
  'toggle-pin': 'Pin / unpin popup',
  'reopen-closed': 'Reopen last closed popup (optional)',
  'open-search': 'Always open search box (optional)',
};
const ORDER = Object.keys(LABELS);
const OPTIONAL = ['open-search', 'reopen-closed'];

const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
if (!IS_MAC) {
  const set = (cls, text) => document.querySelectorAll(cls).forEach(el => { el.textContent = text; });
  set('.kClose', 'Ctrl+W');
  set('.kModEnter', 'Ctrl+↵');
  set('.kShiftEnter', 'Shift+↵');
  document.getElementById('kSmart').textContent = document.getElementById('kSmart2').textContent = 'Ctrl+Shift+K';
}

const openShortcuts = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };
document.getElementById('setShortcuts').addEventListener('click', openShortcuts);
document.getElementById('setShortcuts2').addEventListener('click', openShortcuts);

chrome.commands.getAll().then((commands) => {
  const table = document.getElementById('commands');
  let missing = false;
  commands.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  for (const c of commands) {
    if (!LABELS[c.name]) continue;
    const tr = document.createElement('tr');
    const key = document.createElement('td');
    if (c.shortcut) {
      const k = document.createElement('kbd');
      k.textContent = c.shortcut;
      key.appendChild(k);
    } else if (OPTIONAL.includes(c.name)) {
      key.textContent = '—';
      key.className = 'optional';
    } else {
      key.textContent = 'Not set';
      key.className = 'unset';
      if (!OPTIONAL.includes(c.name)) missing = true; // these have no default key on purpose
    }
    const label = document.createElement('td');
    label.textContent = LABELS[c.name];
    tr.append(key, label);
    table.appendChild(tr);
    if (c.name === 'smart-toggle' && c.shortcut) {
      document.getElementById('kSmart').textContent = c.shortcut;
      document.getElementById('kSmart2').textContent = c.shortcut;
    }
  }
  document.getElementById('unsetBanner').hidden = !missing;
});
