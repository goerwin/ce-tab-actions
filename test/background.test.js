import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChrome, settle } from '../test-support/chrome.js';

let imports = 0;
async function startWorker(api) {
  globalThis.chrome = api;
  await import(`../background.js?worker=${imports++}`);
}

test('menu registration survives repeated worker starts and installation events', async () => {
  const { api, menus } = createChrome();
  menus.set('toggle-tab-in-popup', { title: 'Old menu' });
  await startWorker(api);
  assert.equal(api.contextMenus.create.mock.callCount(), 0);
  api.runtime.onInstalled.emit();
  api.runtime.onInstalled.emit();
  await settle();
  assert.equal(menus.size, 1);
  assert.equal(api.contextMenus.create.mock.callCount(), 2);
  assert.equal(api.contextMenus.removeAll.mock.callCount(), 2);

  await startWorker(api);
  await settle();
  assert.equal(api.contextMenus.create.mock.callCount(), 2);
  assert.equal(menus.size, 1);
});

test('menu creation reads runtime.lastError in its callback and reports context', async (t) => {
  const { api } = createChrome();
  let errorRead = false;
  api.contextMenus.create = (_properties, callback) => {
    Object.defineProperty(api.runtime, 'lastError', {
      configurable: true,
      get() { errorRead = true; return { message: 'Menu unavailable' }; },
    });
    callback();
    delete api.runtime.lastError;
  };
  const errors = t.mock.method(console, 'error', () => {});
  await startWorker(api);
  api.runtime.onInstalled.emit();
  await settle();
  assert.equal(errorRead, true);
  assert.match(errors.mock.calls[0].arguments[0], /Set up context menu failed/);
  assert.equal(errors.mock.calls[0].arguments[1].message, 'Menu unavailable');
});

test('rapid popup toggles serialize and refresh stale tab metadata', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11 }, { id: 12 }] },
  ]);
  await startWorker(api);
  const staleTab = { ...getTab(12) };
  api.action.onClicked.emit(staleTab);
  api.action.onClicked.emit(staleTab);
  await settle();
  assert.equal(getTab(12).windowId, 1);
  assert.equal(getTab(12).index, 1);
  assert.equal(api.windows.create.mock.callCount(), 1);
});

test('a failed action is handled without preventing later commands', async (t) => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11 }, { id: 12 }] },
  ]);
  const errors = t.mock.method(console, 'error', () => {});
  await startWorker(api);
  api.action.onClicked.emit({ id: 999 });
  api.commands.onCommand.emit('b_moveTabToLeft', { id: 12 });
  await settle();
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], /Toggle popup failed/);
  assert.equal(getTab(12).index, 0);
});

test('context menu uses the clicked tab and ignores unrelated menu IDs', async () => {
  const { api, getTab } = createChrome([
    { id: 1, tabs: [{ id: 11 }, { id: 12 }] },
  ]);
  await startWorker(api);
  api.contextMenus.onClicked.emit({ menuItemId: 'unrelated' }, { id: 11 });
  api.contextMenus.onClicked.emit({ menuItemId: 'toggle-tab-in-popup' }, { id: 12 });
  await settle();
  assert.equal(getTab(11).windowId, 1);
  assert.notEqual(getTab(12).windowId, 1);
});

test('tab removal cleans stored history, and unknown commands do nothing', async () => {
  const { api } = createChrome();
  await api.storage.session.set({ 'tab:11': { popup: { windowId: 1 } } });
  await startWorker(api);
  api.commands.onCommand.emit('unknown');
  api.tabs.onRemoved.emit(11);
  await settle();
  assert.equal((await api.storage.session.get('tab:11'))['tab:11'], undefined);
  assert.equal(api.tabs.query.mock.callCount(), 0);
});
