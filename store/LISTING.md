# Chrome Web Store listing: Quick Popup Search

## Name
Quick Popup Search

## Short description (manifest, max 132 chars)
Open searches and links in popup windows and jump back to your tab instantly.

## Detailed description
Open anything. Lose nothing. Return instantly.

Quick Popup Search is a temporary browser for everything that doesn't deserve a new tab. Look something up in a popup window, jump back to exactly the tab you were on, and bring the popup back whenever you need it.

• One shortcut (Ctrl+Shift+K / ⌘+Shift+K): search, bring your popup forward, or jump back to your tab
• Switcher: open popups, recent searches and recently closed pages in one keyboard-driven list
• Nothing gets lost: pages you close or replace stay in "Recently closed"
• Site shortcuts: yt, gh, so, hex, w, g + your query
• Pin popups you want to keep; move any tab into a popup and back (Alt+Shift+P)
• Remembers popup size and position, light and dark mode

Popups are normal Chrome windows (they don't stay on top). All data stays on your device; nothing is sent anywhere.

## Single purpose
Open URLs and searches in popup windows and switch between those popups and the user's original tab.

## Permission justifications
- **tabs**: Needed to read the URL and title of the extension's popup windows (shown in the switcher and the "Recently closed" list) and to return focus to the user's original tab. Data never leaves the device.
- **storage**: Stores recent searches, recently closed popup URLs/titles, popup size/position and settings locally.
- **alarms**: Runs the optional, user-enabled auto-close of idle popups once a minute.
- **favicon**: Displays site icons in the switcher from Chrome's local favicon cache.

## Privacy practices tab
- Data collected: Web history (URLs/titles of popup pages) and user activity (typed searches), **stored locally only**.
- Not sold, not transferred to third parties, not used for unrelated purposes or creditworthiness.
- Privacy policy URL: host `store/PRIVACY.md` (e.g. a GitHub Gist or GitHub Pages) and paste the link.

## Assets (in `store/assets/`, made from real Chrome 157 captures)
- [x] `screenshot-1-switcher-1280x800.png`: switcher with 2 popups
- [x] `screenshot-2-search-1280x800.png`: search preview + popup
- [x] `screenshot-3-welcome-1280x800.png`: welcome page
- [x] `promo-tile-440x280.png`
- [ ] 128×128 icon (96px art + 16px padding, P2)
- Note: screenshot 1 shows a public GitHub PR list (real usernames). Swap the popup for a neutral page if you prefer.

## Packaging
Zip only the extension files (exclude `store/`, `make_icons.py`, `.git*`):
```bash
cd ~/QuickPopup && zip -r ../QuickPopup-$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])").zip . -x 'store/*' 'make_icons.py' 'README.md' '.git*' '*.DS_Store'
```
