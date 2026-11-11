const cleanup = document.getElementById('cleanup');
const enterMode = document.getElementById('enterMode');
const status = document.getElementById('status');
const flash = (msg) => { status.textContent = msg; setTimeout(() => { status.textContent = ''; }, 1500); };

async function saveSetting(key, value) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings[key] = value;
  await chrome.storage.local.set({ settings });
  flash('Saved');
}

chrome.storage.local.get({ settings: {} }).then(({ settings }) => {
  cleanup.value = settings.cleanupMinutes || 0;
  enterMode.value = settings.enterMode || 'reuse';
});

cleanup.addEventListener('change', () => {
  const v = Math.max(0, parseInt(cleanup.value, 10) || 0);
  cleanup.value = v;
  saveSetting('cleanupMinutes', v);
});

enterMode.addEventListener('change', () => saveSetting('enterMode', enterMode.value));

document.getElementById('resetBounds').addEventListener('click', async () => {
  await chrome.storage.local.remove('bounds');
  flash('Popup size/position reset');
});

document.getElementById('clearHistory').addEventListener('click', async () => {
  await chrome.storage.local.remove(['recent', 'closed']);
  flash('History cleared');
});

document.getElementById('welcome').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
