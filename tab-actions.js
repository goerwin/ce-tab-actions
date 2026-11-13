import { readSettings } from './settings.js';

const wrap = (index, length) => (index + length) % length;
const stateKey = (tabId) => `tab:${tabId}`;

function bounds(window) {
  return Object.fromEntries(
    ['top', 'left', 'width', 'height']
      .filter((key) => Number.isFinite(window[key]))
      .map((key) => [key, window[key]]),
  );
}

export function createTabActions(api) {
  async function currentTab(tab) {
    // Queued commands may carry an old index/windowId. Always read a fresh tab.
    if (Number.isInteger(tab?.id) && tab.id >= 0) return api.tabs.get(tab.id);
    const [active] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    return active;
  }

  async function readState(tabId) {
    const key = stateKey(tabId);
    return (await api.storage.session.get(key))[key] ?? {};
  }

  function saveState(tabId, state) {
    return api.storage.session.set({ [stateKey(tabId)]: state });
  }

  async function eligibleWindows(tab, windowTypes) {
    const windows = await api.windows.getAll({ populate: true, windowTypes });
    return windows.filter(
      (window) => window.incognito === tab.incognito && window.state !== 'minimized',
    );
  }

  async function activate(tabId, window) {
    await api.tabs.update(tabId, { active: true });
    await api.windows.update(window.id, {
      ...(window.state === 'minimized' ? { state: 'normal' } : {}),
      focused: true,
    });
  }

  async function transfer(tabId, window, index, pinned) {
    const pinnedCount = window.tabs.filter((tab) => tab.pinned).length;
    const targetIndex = pinned
      ? (index < 0 ? pinnedCount : Math.min(index, pinnedCount))
      : index;
    await api.tabs.move(tabId, { windowId: window.id, index: targetIndex });
    if (pinned) {
      // Cross-window moves can unpin a tab. Re-pin, then restore its position
      // within the destination's pinned section.
      await api.tabs.update(tabId, { pinned: true });
      await api.tabs.move(tabId, { index: targetIndex });
    }
    await activate(tabId, window);
  }

  async function togglePopup(input) {
    const tab = await currentTab(input);
    if (!tab) return;
    const window = await api.windows.get(tab.windowId);
    const state = await readState(tab.id);

    if (window.type === 'normal') {
      // Save before moving: window creation can close the source's last tab.
      state.popup = {
        windowId: window.id, index: tab.index, pinned: tab.pinned, ...bounds(window),
      };
      await saveState(tab.id, state);
      await api.windows.create({
        tabId: tab.id,
        type: 'popup',
        focused: true,
        incognito: tab.incognito,
        ...bounds(window),
      });
      return;
    }

    if (window.type !== 'popup' && window.type !== 'app') return;

    const windows = await api.windows.getAll({ windowTypes: ['normal'], populate: true });
    const pinned = state.popup?.pinned ?? tab.pinned;
    const origin = windows.find(
      (candidate) => candidate.id === state.popup?.windowId &&
        candidate.incognito === tab.incognito,
    );

    if (origin) {
      await transfer(tab.id, origin, state.popup.index, pinned);
    } else {
      await api.windows.create({
        tabId: tab.id,
        type: 'normal',
        focused: true,
        incognito: tab.incognito,
        ...bounds(state.popup ?? window),
      });
      if (pinned) await api.tabs.update(tab.id, { pinned: true });
    }

    delete state.popup;
    await saveState(tab.id, state);
  }

  async function focusTab(direction, input) {
    const tab = await currentTab(input);
    if (!tab) return;
    const window = await api.windows.get(tab.windowId, { populate: true });
    const tabs = window.tabs;
    const index = tabs.findIndex((candidate) => candidate.id === tab.id);
    if (index < 0) return;

    const options = await readSettings(api.storage.sync);
    const atEdge = index + direction < 0 || index + direction >= tabs.length;
    if (atEdge && options.jumpWindows) {
      const windows = await eligibleWindows(tab, ['normal', 'popup']);
      const windowIndex = windows.findIndex((candidate) => candidate.id === window.id);
      if (windowIndex >= 0 && windows.length > 1) {
        const nextIndex = wrap(windowIndex + direction, windows.length);
        const next = windows[nextIndex];
        const atWindowEdge = nextIndex === 0 || nextIndex === windows.length - 1;
        const target = options.focusFirstLastTabIfEdgeWindow && atWindowEdge
          ? next.tabs[direction === 1 ? 0 : next.tabs.length - 1]
          : next.tabs.find((candidate) => candidate.active);
        if (target) await activate(target.id, next);
        return;
      }
    }

    await api.tabs.update(tabs[wrap(index + direction, tabs.length)].id, { active: true });
  }

  async function moveTab(direction, input) {
    const tab = await currentTab(input);
    if (!tab) return;
    const window = await api.windows.get(tab.windowId, { populate: true });
    // Chrome keeps pinned tabs together. Wrap within the tab's own section.
    const peers = window.tabs.filter((candidate) => candidate.pinned === tab.pinned);
    const index = peers.findIndex((candidate) => candidate.id === tab.id);
    if (index < 0 || peers.length < 2) return;
    const target = peers[wrap(index + direction, peers.length)];
    await api.tabs.move(tab.id, { index: target.index });
  }

  async function moveToWindow(direction, input) {
    const tab = await currentTab(input);
    if (!tab) return;
    const window = await api.windows.get(tab.windowId, { populate: true });
    const windows = await eligibleWindows(tab, ['normal']);
    const index = windows.findIndex((candidate) => candidate.id === window.id);
    const nextIndex = index + direction;
    const atEdge = index < 0 || nextIndex < 0 || nextIndex >= windows.length;
    // At an edge, detach into a new window unless that would just replace a
    // one-tab window. A lone tab wraps to an existing window instead.
    const createWindow = !windows.length ||
      (index >= 0 && atEdge && window.tabs.length > 1);
    const target = createWindow ? undefined : windows[
      index < 0 ? (direction === 1 ? 0 : windows.length - 1)
        : wrap(nextIndex, windows.length)
    ];
    if (target?.id === window.id) return;

    const state = await readState(tab.id);
    state.positions = { ...state.positions, [window.id]: tab.index };
    const pinned = state.popup?.pinned ?? tab.pinned;
    // Moving out of a popup manually must not retain an old popup origin.
    delete state.popup;
    await saveState(tab.id, state);

    if (target) {
      await transfer(tab.id, target, state.positions[target.id] ?? -1, pinned);
    } else {
      await api.windows.create({
        tabId: tab.id,
        type: 'normal',
        focused: true,
        incognito: tab.incognito,
      });
      if (pinned) await api.tabs.update(tab.id, { pinned: true });
    }
  }

  return {
    togglePopup,
    focusTab,
    moveTab,
    moveToWindow,
    forgetTab: (tabId) => api.storage.session.remove(stateKey(tabId)),
  };
}
