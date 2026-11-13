# Tab Actions

A small Manifest V3 Chrome extension for navigating and moving tabs. No build
step, dependencies, content scripts, or host permissions are required.

## Install or reload

Requires Chrome 123 or newer. This is the minimum for the Promise-based
`contextMenus.removeAll()` API; the extension also uses module service workers
and `storage.session`.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this directory. For an existing
   installation, click **Reload** on the Tab Actions card.
3. Configure shortcuts at `chrome://extensions/shortcuts`. Existing command IDs
   are preserved, so previously assigned shortcuts remain valid.

## Actions

- **Toggle tab in popup:** Use the toolbar button, page context menu, or shortcut.
  Toggling again restores the original window and tab position. If that window
  has closed, a new normal window uses the saved bounds. Pinned state is restored.
- **Focus previous/next tab:** Cycle through tabs. Settings control whether
  navigation crosses window boundaries and which tab is selected at the first
  or last window. Fullscreen windows participate; minimized windows are skipped.
- **Move tab left/right:** Wrap around within the pinned or unpinned section.
- **Move tab to previous/next window:** Move among normal windows and remember
  the tab's previous position in each window. At an outer window boundary,
  detach into a new window; if the source has only one tab, wrap to an existing
  window instead. With only one window and one tab, this does nothing.

Window traversal follows Chrome's window enumeration order, separately for
regular and incognito windows. Incognito actions require enabling **Allow in
Incognito** in the extension's details.

Open the extension's **Options**, change the navigation settings, then choose
**Save settings**. Both settings default to enabled. Existing saved preferences
are retained.

## Storage and permissions

- `storage.sync` stores the two navigation preferences.
- `storage.session` stores tab return locations and pinned state for the current
  browser session. These survive service-worker suspension, but reset when the
  browser restarts or the extension is reloaded, updated, or disabled. Closed
  tabs release their records. A popup without history can still become a normal
  window, including in incognito mode.
- `contextMenus` adds the page menu action.

The extension uses only tab/window metadata. It does not read page content or
request the `tabs`, `activeTab`, or website permissions.

## Duplicate context-menu error

The previous version called `chrome.contextMenus.create()` every time its
service worker started. Chrome retains context menus when the worker stops, so
the next start attempted to create `toggle-tab-in-popup` again. Because creation
errors arrive asynchronously and its callback was missing, Chrome reported:

```text
Unchecked runtime.lastError: Cannot create item with duplicate id toggle-tab-in-popup
Context: Unknown
Stack Trace: :0 (anonymous function)
```

The menu now rebuilds only on `runtime.onInstalled` (installation, extension
update/reload, or Chrome update), after removing this extension's existing menus.
Its callback checks `runtime.lastError`. Event listeners still register
synchronously on every worker start. Asynchronous action failures are caught and
logged with the action name and an Error stack, and do not block later actions.

After reloading the extension, clear historical entries from its **Errors** page.
Old error entries can remain visible after the underlying problem is fixed.

## Development

Use Node.js 22 or newer. No package installation is needed:

```sh
npm run check
npm test
```

`background.js` registers events and serializes actions. `tab-actions.js`
implements tab/window behavior, and `settings.js` shares defaults with the options
page. Tests exercise the Chrome API boundary with an in-memory browser model,
including repeated worker starts, asynchronous menu errors, popup restoration,
incognito isolation, pinned tabs, and command failures.

For a browser smoke test, load the extension in a disposable profile. Verify the
toolbar, context menu, and shortcuts; toggle a popup, stop the worker using
`chrome://serviceworker-internals`, then toggle back. Check options using the
keyboard and both color schemes, and verify the extension's **Errors** page stays
empty with error collection enabled. Close its DevTools before testing idle
suspension, because inspection keeps the worker alive.
