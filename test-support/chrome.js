import { mock } from 'node:test';

const clone = (value) => structuredClone(value);

function event() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
  };
}

function storage(initial = {}) {
  const data = clone(initial);
  return {
    get: mock.fn(async (keys) => {
      if (typeof keys === 'string') return clone({ [keys]: data[keys] });
      return clone({ ...keys, ...data });
    }),
    set: mock.fn(async (items) => Object.assign(data, clone(items))),
    remove: mock.fn(async (key) => { delete data[key]; }),
  };
}

export function createChrome(input = [], settings = {}) {
  const windows = clone(input).map((window) => ({
    type: 'normal', state: 'normal', incognito: false,
    left: 10, top: 20, width: 1000, height: 800,
    ...window,
    tabs: window.tabs.map((tab, index) => ({
      index, active: !window.tabs.some((candidate) => candidate.active) && index === 0,
      pinned: false,
      incognito: window.incognito ?? false, windowId: window.id, ...tab,
    })),
  }));
  let focusedId = windows[0]?.id;
  let nextId = Math.max(0, ...windows.map((window) => window.id)) + 1;
  const getWindow = (id) => {
    const window = windows.find((candidate) => candidate.id === id);
    if (!window) throw new Error(`No window with id: ${id}.`);
    return window;
  };
  const getTab = (id) => {
    const tab = windows.flatMap((window) => window.tabs).find((tab) => tab.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}.`);
    return tab;
  };
  function normalize(window) {
    window.tabs.forEach((tab, index) => { tab.index = index; tab.windowId = window.id; });
    if (window.tabs.length && !window.tabs.some((tab) => tab.active)) window.tabs[0].active = true;
  }
  function move(id, properties) {
    const tab = getTab(id);
    const source = getWindow(tab.windowId);
    const target = getWindow(properties.windowId ?? source.id);
    source.tabs.splice(tab.index, 1);
    const index = properties.index < 0 ? target.tabs.length
      : Math.min(properties.index, target.tabs.length);
    target.tabs.splice(index, 0, tab);
    if (source !== target) tab.pinned = false;
    if (source !== target && tab.active) {
      target.tabs.forEach((candidate) => { candidate.active = candidate.id === id; });
    }
    normalize(source);
    normalize(target);
    if (!source.tabs.length) windows.splice(windows.indexOf(source), 1);
    return clone(tab);
  }

  const menus = new Map();
  const api = {
    storage: { sync: storage(settings), session: storage() },
    runtime: { onInstalled: event() },
    action: { onClicked: event() },
    commands: { onCommand: event() },
    contextMenus: {
      onClicked: event(),
      removeAll: mock.fn(async () => menus.clear()),
      create: mock.fn((properties, callback) => {
        const duplicate = menus.has(properties.id);
        if (!duplicate) menus.set(properties.id, properties);
        queueMicrotask(() => {
          if (duplicate) api.runtime.lastError = { message: `Duplicate id ${properties.id}` };
          callback();
          delete api.runtime.lastError;
        });
        return properties.id;
      }),
    },
    tabs: {
      onRemoved: event(),
      get: mock.fn(async (id) => clone(getTab(id))),
      query: mock.fn(async () => clone(windows.find((window) => window.id === focusedId)
        ?.tabs.filter((tab) => tab.active) ?? [])),
      move: mock.fn(async (id, properties) => move(id, properties)),
      update: mock.fn(async (id, properties) => {
        const tab = getTab(id);
        if (properties.active) {
          getWindow(tab.windowId).tabs.forEach((candidate) => { candidate.active = false; });
        }
        Object.assign(tab, properties);
        if (properties.pinned !== undefined) {
          const window = getWindow(tab.windowId);
          window.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
          normalize(window);
        }
        return clone(tab);
      }),
    },
    windows: {
      get: mock.fn(async (id) => clone(getWindow(id))),
      getAll: mock.fn(async ({ windowTypes }) => clone(windows.filter(
        (window) => windowTypes.includes(window.type),
      ))),
      update: mock.fn(async (id, properties) => {
        Object.assign(getWindow(id), properties);
        if (properties.focused) focusedId = id;
        return clone(getWindow(id));
      }),
      create: mock.fn(async (properties) => {
        const window = {
          id: nextId++, type: 'normal', state: 'normal', incognito: false,
          left: 0, top: 0, width: 800, height: 600, ...properties, tabs: [],
        };
        windows.push(window);
        move(properties.tabId, { windowId: window.id, index: 0 });
        if (properties.focused) focusedId = window.id;
        return clone(window);
      }),
    },
  };
  return { api, menus, windows, getTab, getWindow };
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));
