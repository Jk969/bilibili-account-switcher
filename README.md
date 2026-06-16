# Multi-Site Account Switcher

[English](README.md) | [简体中文](README.zh-CN.md)

A Manifest V3 Edge / Chrome browser extension that lets you switch between **multiple accounts across multiple websites** with a single click.

It ships with deep support for Bilibili and ChatGPT (reading username, avatar, and UID), while offering generic cookie-based switching for any other website. All data stays in your local browser — nothing is uploaded to any server.

> Current version: **v1.2**

---

## Features

- **One-click switching**: Click an account card to write its cookies and reload the page — you're back on the target account in seconds.
- **Multi-site support**: Bilibili and ChatGPT built in; other sites are auto-detected and switched by cookie.
- **Account renaming**: Every account can be given a custom display name for easy distinction.
- **Auto info fetch**: Automatically grabs the currently logged-in account's user info and cookies.
- **Cookie-freshness protection**: Before switching or logging into a new account, the current account's latest cookies are written back and saved.
- **Secure storage**: Account data lives only in `chrome.storage.local`. The code is open source with no backend whatsoever.
- **Dual entry points**: Use the toolbar popup or the floating panel in the bottom-right corner of any page.
- **Controllable floating panel**: The floating panel can be toggled globally or per-site, supports dragging, and by default appears only on sites with saved accounts.

---

## Supported Sites

### Built-in sites (deep support)

| Site | Domain | Info source |
| --- | --- | --- |
| Bilibili | `bilibili.com` | `api.bilibili.com/x/web-interface/nav` (username, UID, avatar) |
| ChatGPT | `chatgpt.com`, `chat.openai.com` | `chatgpt.com/backend-api/me` (username, email, avatar) |

### Any other website (generic support)

Open the extension on any http/https site and it auto-generates a site config based on the main domain, saving and switching accounts by cookie. These sites have no username/avatar source, so a **fingerprint ID** is derived from cookies such as `session`/`auth`/`token`/`cf_clearance` to identify each account.

---

## Installation

1. Open Edge's extension management page `edge://extensions/`, or Chrome's `chrome://extensions/`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this project's folder, `bilibili-account-switcher`.
5. Once installed, the extension icon appears in the toolbar — click it to start.

---

## Usage

### 1. Add your first account

1. Open a supported site (e.g., Bilibili) and log into account A.
2. Click the extension icon in the toolbar to open the panel.
3. Click **Add current account**.
4. Account A appears in the list.

### 2. Add more accounts (important!)

To keep old accounts from being revoked by the server, **do not click "Log out" on the website** — use the extension instead:

1. Click **Log in to a new account**.
   - This only clears the browser's local cookies and **does not** notify the site server to revoke them, so the old account stays valid.
2. The page reloads into a logged-out state.
3. Log into account B normally on the website.
4. Click **Add current account** again.
5. You now have two valid accounts in the list.

### 3. Switch accounts

Click any account card in the list. The extension first saves the current account's latest cookies, then writes the target account's cookies and reloads the page to complete the switch. The account currently in use is highlighted.

### 4. Rename an account

Click the **✎** button on the right of an account card, type a new name, and press Enter to save (Esc to cancel). The name is used only for local display.

### 5. Delete an account

Click the **×** button on the right of an account card, confirm, and the account record is deleted (this does not affect the browser's current login state).

---

## Floating Panel

On sites where accounts have been saved, a **floating ball** automatically appears in the bottom-right corner — click it to open a compact switching panel.

- **Drag**: Hold the floating ball to drag it anywhere.
- **Default behavior**: It appears only on sites where accounts have been saved, to avoid clutter on unrelated pages.
- **Settings (⚙ in the top-right of the panel)**:
  - *Enable floating panel globally*: Toggle the floating ball for all sites at once.
  - *Enable floating panel on this site*: Control the floating ball for the current site only.

---

## How It Works

The extension's core is **reading / writing / clearing cookies**:

- **Save account**: Grabs the current account's user info + all cookies and stores them locally.
- **Switch account**: First writes back the current account's latest cookies (so a refresh during use doesn't make the switch-back fail), then clears local cookies, writes the target account's cookies, and finally reloads the page.
- **Log in to a new account**: Also writes back the current cookies first, then clears local cookies — it only touches local data and never calls the site's logout endpoint, so old accounts stay valid.
- **Data migration**: On first read, old-version (Bilibili-only) account data is automatically migrated to the new site-grouped structure.

---

## Project Structure

```
bilibili-account-switcher/
├── manifest.json     # Extension config (MV3, permissions: cookies / storage / tabs)
├── background.js     # Service Worker, handles all business messages
├── utils.js          # Core utility library: site config, cookie ops, account management
├── popup.html        # Toolbar popup structure
├── popup.js          # Popup interaction logic
├── style.css         # Popup styles
├── floating.js       # Floating panel (content script)
├── floating.css      # Floating panel styles
├── assets/           # Icon assets
└── README.md
```

---

## FAQ

**Q: After switching back, it shows logged out?**
A: Cookies have an expiration date — long-unused ones may expire; if you clicked "Log out" on the website, the server may have revoked that cookie, invalidating the record. Prefer using the extension's "Log in to a new account" to switch.

**Q: Is my account info safe?**
A: The code is open source and all data stays in your local browser (`chrome.storage.local`) — nothing is uploaded to any third-party server.

**Q: Are my previously saved Bilibili accounts still there?**
A: Yes. On first read, the new version automatically migrates old Bilibili account data.

**Q: Can I use it on non-Bilibili / non-ChatGPT sites?**
A: Yes. The extension generates a site config for any website based on its main domain and handles saving and switching by cookie; these sites just can't fetch a real username, so a cookie fingerprint is used to identify accounts instead.

---

## Notes

- Do not use this on an untrusted public computer, to avoid leaking account cookies.
- Login mechanisms for sites like ChatGPT may change with official updates. If info fetch fails, first confirm that you're logged in on the corresponding page.
- The extension needs the `cookies` and `<all_urls>` permissions to read/write login state on various sites — all operations are local.
