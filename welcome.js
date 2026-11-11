const LABELS = {
  'smart-toggle': 'Search / switch / go back',
  'toggle-popout': 'Pop tab out ↔ back into a tab',
  'toggle-pin': 'Pin / unpin popup',
  'reopen-closed': 'Reopen last closed popup',
  'open-search': 'Always open search box (optional)',
};
const ORDER = Object.keys(LABELS);

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
    } else {
      key.textContent = 'Not set';
      key.className = 'unset';
      if (c.name !== 'open-search') missing = true; // open-search has no default on purpose
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
