import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChrome } from '../test-support/chrome.js';
import { createTabActions } from '../tab-actions.js';
import { DEFAULT_SETTINGS, readSettings } from '../settings.js';

const normal = () => [
  { id: 1, tabs: [{ id: 11 }, { id: 12, active: true }, { id: 13 }] },
  { id: 2, tabs: [{ id: 21 }, { id: 22, active: true }] },
];

test('settings default consistently without an installation write and preserve false values', async () => {
  const { api } = createChrome([], { jumpWindows: false, focusFirstLastTabIfEdgeWindow: 'bad' });
  assert.deepEqual(await readSettings(api.storage.sync), {
    ...DEFAULT_SETTINGS, jumpWindows: false,
  });
  assert.equal(api.storage.sync.set.mock.callCount(), 0);
});

test('popup returns to its original window and position after a worker restart', async () => {
  const { api, getTab } = createChrome(normal());
  await createTabActions(api).togglePopup({ id: 12 });
  assert.notEqual(getTab(12).windowId, 1);
  await createTabActions(api).togglePopup({ id: 12 });
  assert.equal(getTab(12).windowId, 1);
  assert.equal(getTab(12).index, 1);
  assert.equal(getTab(12).active, true);
  assert.equal((await api.storage.session.get('tab:12'))['tab:12'].popup, undefined);
});

test('popup whose source closed creates a normal window with its original bounds', async () => {
  const { api, getTab, getWindow } = createChrome([
    { id: 1, left: -1200, tabs: [{ id: 11 }] },
  ]);
  await createTabActions(api).togglePopup({ id: 11 });
  await createTabActions(api).togglePopup({ id: 11 });
  const restored = getWindow(getTab(11).windowId);
  assert.equal(restored.type, 'normal');
  assert.equal(restored.left, -1200);
  assert.equal(restored.width, 1000);
});

test('an incognito popup without saved history stays incognito when restored', async () => {
  const { api, getTab, getWindow } = createChrome([
    { id: 1, type: 'popup', incognito: true, tabs: [{ id: 11 }] },
  ]);
  await createTabActions(api).togglePopup({ id: 11 });
  const window = getWindow(getTab(11).windowId);
  assert.equal(window.type, 'normal');
  assert.equal(window.incognito, true);
});

test('manually returned tabs use their current window as the next popup origin', async () => {
  const { api, getTab } = createChrome(normal());
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 12 });
  await api.tabs.move(12, { windowId: 2, index: 0 });
  await actions.togglePopup({ id: 12 });
  await actions.togglePopup({ id: 12 });
  assert.equal(getTab(12).windowId, 2);
});

test('focus wraps locally when window jumping is disabled', async () => {
  const { api, getTab } = createChrome(normal(), { jumpWindows: false });
  const actions = createTabActions(api);
  await actions.focusTab(1, { id: 13 });
  assert.equal(getTab(11).active, true);
  await actions.focusTab(-1, { id: 11 });
  assert.equal(getTab(13).active, true);
  assert.equal(api.windows.update.mock.callCount(), 0);
});

test('focus crosses windows, including fullscreen, and applies edge selection', async () => {
  const windows = normal();
  windows[1].state = 'fullscreen';
  const { api, getTab } = createChrome(windows);
  await createTabActions(api).focusTab(1, { id: 13 });
  assert.equal(getTab(21).active, true);
  assert.equal(api.windows.update.mock.calls.at(-1).arguments[0], 2);
  await createTabActions(api).focusTab(-1, { id: 21 });
  assert.equal(getTab(13).active, true);
});

test('focus retains the active target tab when edge selection is disabled', async () => {
  const { api, getTab } = createChrome(normal(), { focusFirstLastTabIfEdgeWindow: false });
  await createTabActions(api).focusTab(1, { id: 13 });
  assert.equal(getTab(22).active, true);
});

test('focus retains active tabs in intermediate windows', async () => {
  const { api, getTab } = createChrome([
    ...normal(), { id: 3, tabs: [{ id: 31 }] },
  ]);
  await createTabActions(api).focusTab(1, { id: 13 });
  assert.equal(getTab(22).active, true);
});

test('window navigation skips minimized windows and other incognito modes', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11 }] },
    { id: 2, state: 'minimized', tabs: [{ id: 21 }] },
    { id: 3, incognito: true, tabs: [{ id: 31 }] },
    { id: 4, tabs: [{ id: 41 }, { id: 42, active: true }] },
  ]);
  const actions = createTabActions(api);
  await actions.focusTab(1, { id: 11 });
  assert.equal(getTab(41).active, true);
  await actions.moveToWindow(1, { id: 11 });
  assert.equal(getTab(11).windowId, 4);
});

test('left/right movement wraps inside each pinned/unpinned section', async () => {
  const { api, getWindow } = createChrome([
    { id: 1, tabs: [{ id: 11, pinned: true }, { id: 12, pinned: true }, { id: 13 }, { id: 14 }] },
  ]);
  const actions = createTabActions(api);
  await actions.moveTab(-1, { id: 13 });
  assert.deepEqual(getWindow(1).tabs.map((tab) => tab.id), [11, 12, 14, 13]);
  await actions.moveTab(1, { id: 12 });
  assert.deepEqual(getWindow(1).tabs.map((tab) => tab.id), [12, 11, 14, 13]);
});

test('window moves remember per-window positions across worker restarts', async () => {
  const { api, getTab } = createChrome(normal());
  await createTabActions(api).moveToWindow(1, { id: 12 });
  assert.equal(getTab(12).windowId, 2);
  await createTabActions(api).moveToWindow(-1, { id: 12 });
  assert.equal(getTab(12).windowId, 1);
  assert.equal(getTab(12).index, 1);
});

test('pinned tabs stay pinned across windows and return to their pinned position', async () => {
  const { api, getTab, getWindow } = createChrome([
    { id: 1, tabs: [{ id: 11, pinned: true }, { id: 12, pinned: true }, { id: 13 }] },
    { id: 2, tabs: [{ id: 21, pinned: true }, { id: 22 }] },
  ]);
  const actions = createTabActions(api);
  await actions.moveToWindow(1, { id: 11 });
  assert.equal(getTab(11).pinned, true);
  assert.deepEqual(getWindow(2).tabs.map((tab) => tab.id), [21, 11, 22]);
  await actions.moveToWindow(-1, { id: 11 });
  assert.equal(getTab(11).pinned, true);
  assert.equal(getTab(11).index, 0);
});

test('popup restores pinned state and the original pinned position', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11, pinned: true }, { id: 12, pinned: true }, { id: 13 }] },
  ]);
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 11 });
  await actions.togglePopup({ id: 11 });
  assert.equal(getTab(11).pinned, true);
  assert.equal(getTab(11).index, 0);
});

test('pinned state survives restoring into a newly created normal window', async () => {
  const { api, getTab, getWindow } = createChrome([
    { id: 1, tabs: [{ id: 11, pinned: true }] },
  ]);
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 11 });
  await actions.togglePopup({ id: 11 });
  assert.equal(getWindow(getTab(11).windowId).type, 'normal');
  assert.equal(getTab(11).pinned, true);
});

test('moving a popup to another window preserves the original pinned state', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11, pinned: true }, { id: 12 }] },
  ]);
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 11 });
  await actions.moveToWindow(1, { id: 11 });
  assert.equal(getTab(11).windowId, 1);
  assert.equal(getTab(11).pinned, true);
});

test('moving past an edge detaches a tab into a new normal window', async () => {
  const { api, getTab, getWindow } = createChrome(normal());
  await createTabActions(api).moveToWindow(-1, { id: 12 });
  assert.equal(getWindow(getTab(12).windowId).type, 'normal');
  assert.equal(api.windows.create.mock.callCount(), 1);
});

test('a lone tab at a window edge wraps rather than replacing its window', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11 }] },
    { id: 2, tabs: [{ id: 21 }] },
  ]);
  await createTabActions(api).moveToWindow(-1, { id: 11 });
  assert.equal(getTab(11).windowId, 2);
  assert.equal(api.windows.create.mock.callCount(), 0);
});

test('a single tab in the only window is a no-op for window moves', async () => {
  const { api } = createChrome([{ id: 1, tabs: [{ id: 11 }] }]);
  await createTabActions(api).moveToWindow(1, { id: 11 });
  assert.equal(api.tabs.move.mock.callCount(), 0);
  assert.equal(api.windows.create.mock.callCount(), 0);
});

test('moving a popup tab to a normal window clears its popup origin', async () => {
  const { api, getTab } = createChrome(normal());
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 12 });
  await actions.moveToWindow(1, { id: 12 });
  assert.equal(getTab(12).windowId, 1);
  assert.equal((await api.storage.session.get('tab:12'))['tab:12'].popup, undefined);
});

test('toolbar fallback safely handles no active tab', async () => {
  const { api } = createChrome();
  await createTabActions(api).togglePopup();
  assert.equal(api.windows.create.mock.callCount(), 0);
});

test('closed tabs release their session state', async () => {
  const { api } = createChrome(normal());
  const actions = createTabActions(api);
  await actions.togglePopup({ id: 12 });
  await actions.forgetTab(12);
  assert.equal((await api.storage.session.get('tab:12'))['tab:12'], undefined);
});
