# Privacy Policy: Quick Popup Search

_Last updated: 2026-11-11_

Quick Popup Search does **not** collect, transmit, sell or share any data. There are no servers, no analytics, no tracking and no remote code. Everything the extension stores stays in your browser on your device.

## What is stored, and where

| Data | Why | Where | How long |
|---|---|---|---|
| Your last 10 searches / URLs typed into the search box | "Recent searches" list | `chrome.storage.local` (on your device) | Until you clear it or uninstall |
| URL and page title of your last 15 closed or replaced popups | "Recently closed" list, so nothing is lost | `chrome.storage.local` | Until you clear it or uninstall |
| Popup window size and position | Open popups where you left them | `chrome.storage.local` | Until reset or uninstall |
| Your settings | Remember your choices | `chrome.storage.local` | Until uninstall |
| Which windows are popups, and which tab you came from | "Return to your tab" | `chrome.storage.session` (memory) | Cleared when Chrome closes |

The extension does not run in Incognito windows.

## Permissions

- **tabs**: read the URL and title of popup windows (for the switcher and "Recently closed") and move between your popups and tabs.
- **storage**: store the data listed above on your device.
- **alarms**: optional auto-close of idle popups (off by default).
- **favicon**: show site icons from Chrome's local icon cache (no network request).

## Your control

Settings → "Clear recent + closed history" deletes the lists. Uninstalling the extension deletes everything it stored.

## Contact

Questions: [your contact email]
