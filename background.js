const tabHashes = {};
const moveTabHashes = {};

chrome.runtime.onInstalled.addListener(async (_details) => {
  // set default options
  await chrome.storage.sync.set(
    await chrome.storage.sync.get({
      jumpWindows: true,
      focusFirstLastTabIfEdgeWindow: true,
    })
  );
});

// Icon click

chrome.action.onClicked.addListener(() => handleToggleTabInPopup());

// Context Menu

chrome.contextMenus.create({
  id: 'toggle-tab-in-popup',
  title: 'Toggle tab in Popup',
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'toggle-tab-in-popup')
    return handleToggleTabInPopup(tab.id);
});

// Shortcuts

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  const options = await chrome.storage.sync.get([
    'jumpWindows',
    'focusFirstLastTabIfEdgeWindow',
  ]);

  if (cmd === 'aa_focusPrevTab') return focusPrevNextTab('prev', tab, options);
  if (cmd === 'ab_focusNextTab') return focusPrevNextTab('next', tab, options);
  if (cmd === 'a_toggleTabInPopup') return handleToggleTabInPopup(tab.id);
  if (cmd === 'b_moveTabToLeft') return moveTabToLeftRight('left', tab);
  if (cmd === 'c_moveTabToRight') return moveTabToLeftRight('right', tab);
  if (cmd === 'd_moveTabPrevWindow')
    return moveTabToPrevNextWindow('prev', tab);
  if (cmd === 'e_moveTabNextWindow')
    return moveTabToPrevNextWindow('next', tab);
});

// Functions

async function focusPrevNextTab(direction, tab, options = {}) {
  const { jumpWindows, focusFirstLastTabIfEdgeWindow } = options;

  const tabIdx = tab.index;
  const curWindow = await chrome.windows.get(tab.windowId, {
    // when selecting dev tools I think the window.id returned is the
    // one of its window's parent tab. So not implementing it on devtools
    populate: true,
  });

  const windows = (await chrome.windows.getAll({ populate: true })).filter(
    (w) =>
      ['normal', 'maximized'].includes(w.state) && w.incognito === tab.incognito
  );

  const isAnEdgeTab =
    direction === 'next' ? tabIdx === curWindow.tabs.length - 1 : tabIdx === 0;

  // focus prev/next tab within current window
  if (!isAnEdgeTab || !jumpWindows || windows.length <= 1) {
    const activeTabIdx = curWindow.tabs.findIndex((tab) => tab.active);

    const newTabIdx =
      direction === 'next'
        ? activeTabIdx >= curWindow.tabs.length - 1
          ? 0
          : activeTabIdx + 1
        : activeTabIdx <= 0
        ? curWindow.tabs.length - 1
        : activeTabIdx - 1;

    const newTabToFocus = curWindow.tabs[newTabIdx];
    return chrome.tabs.update(newTabToFocus.id, { active: true });
  }

  // focus prev/next window
  const curWinIdx = windows.findIndex((w) => w.id === curWindow.id);
  const newWinIdx =
    direction === 'next'
      ? curWinIdx === windows.length - 1
        ? 0
        : curWinIdx + 1
      : curWinIdx === 0
      ? windows.length - 1
      : curWinIdx - 1;

  const newWindow = windows[newWinIdx];
  await chrome.windows.update(newWindow.id, { focused: true });

  if (!focusFirstLastTabIfEdgeWindow) return;

  // focus first or last tab in window when first/last window is reached
  const isAnEdgeWindow = newWinIdx === 0 || newWinIdx === windows.length - 1;
  if (!isAnEdgeWindow) return;

  const tabToFocus =
    newWindow.tabs[direction === 'next' ? 0 : newWindow.tabs.length - 1];
  await chrome.tabs.update(tabToFocus.id, { active: true });
}

/**
 *
 * @param {'left' | 'right'} direction
 * @param {chrome.tabs.tab} tab
 */
async function moveTabToLeftRight(direction, tab) {
  const tabId = tab.id;
  const tabWindow = await chrome.windows.get(tab.windowId, { populate: true });
  const tabIdxInWindow = tabWindow.tabs.findIndex((el) => el.id === tabId);

  const newLeftTabIdx = tabIdxInWindow === 0 ? -1 : tabIdxInWindow - 1;
  const newRightTabIdx =
    tabIdxInWindow < tabWindow.tabs.length - 1 ? tabIdxInWindow + 1 : 0;

  await chrome.tabs.move(tabId, {
    index: direction === 'left' ? newLeftTabIdx : newRightTabIdx,
  });
}

/**
 *
 * @param {'prev' | 'next'} direction
 * @param {chrome.tabs.Tab} tab
 */
async function moveTabToPrevNextWindow(direction, tab) {
  const windows = (
    await chrome.windows.getAll({ windowTypes: ['normal'], populate: true })
  ).filter(
    (w) =>
      ['normal', 'maximized'].includes(w.state) && w.incognito === tab.incognito
  );

  const tabId = tab.id;
  const tabWindow = await chrome.windows.get(tab.windowId, { populate: true });
  const tabWindowId = tabWindow.id;

  // save tab idx in current window
  moveTabHashes[tabId] = {
    ...moveTabHashes[tabId],
    [tabWindowId]: { tabIdx: tab.index },
  };

  const tabWindowIdx = windows.findIndex((w) => w.id === tabWindowId);
  const isLonelyTab = tabWindow.tabs.length === 1;

  const moveTab =
    direction === 'prev'
      ? isLonelyTab || tabWindowIdx > 0
      : isLonelyTab || tabWindowIdx < windows.length - 1;

  const prevWindowIdx =
    tabWindowIdx > 0 ? tabWindowIdx - 1 : windows.length - 1;
  const nextWindowIdx =
    tabWindowIdx < windows.length - 1 ? tabWindowIdx + 1 : 0;

  const newWindowIdx = direction === 'prev' ? prevWindowIdx : nextWindowIdx;

  if (moveTab) {
    const windowId = windows[newWindowIdx].id;
    const savedTabIdx = moveTabHashes[tabId]?.[windowId]?.tabIdx ?? -1;
    await chrome.tabs.move(tabId, { windowId, index: savedTabIdx });
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } else {
    await chrome.windows.create({
      tabId,
      type: 'normal',
      focused: true,
      incognito: tabWindow.incognito,
    });
  }
}

/**
 *
 * @param {number} [tabId]
 * @returns
 */
async function handleToggleTabInPopup(tabId) {
  const curTab = tabId ? await chrome.tabs.get(tabId) : await getCurrentTab();
  const curTabId = curTab.id;
  const tabHash = tabHashes[curTabId];

  if (tabHash) return handleRestoreTab(curTabId);

  const curWin = await chrome.windows.get(curTab.windowId);

  if (['app', 'popup'].includes(curWin.type)) {
    tabHashes[curTabId] = {
      width: curWin.width,
      height: curWin.height,
      top: curWin.top,
      left: curWin.left,
    };

    return handleRestoreTab(curTabId);
  }

  await handleOpenTabInPopup(curTabId, curTab.index, curWin);
}

async function handleRestoreTab(tabId) {
  const tabHash = tabHashes[tabId];
  let windowId = tabHash?.windowId;

  try {
    const window = await chrome.windows.get(tabHash?.windowId);
    windowId = window.id;
    await chrome.windows.update(windowId, { focused: true });
  } catch (_) {
    windowId = null;
  }

  if (windowId) {
    await chrome.tabs.move(tabId, { windowId, index: tabHash.index });
  } else {
    await chrome.windows.create({
      tabId,
      top: tabHash.top,
      left: tabHash.left,
      height: tabHash.height,
      width: tabHash.width,
      incognito: tabHash.incognito,
      type: 'normal',
      focused: true,
    });
  }

  delete tabHashes[tabId];
  await chrome.tabs.update(tabId, { active: true });
}

async function handleOpenTabInPopup(tabId, tabIdx, curWin) {
  await chrome.windows.create({
    tabId,
    top: curWin.top,
    left: curWin.left,
    height: curWin.height,
    width: curWin.width,
    incognito: curWin.incognito,
    focused: true,
    type: 'popup',
  });

  tabHashes[tabId] = {
    windowId: curWin.id,
    index: tabIdx,
    width: curWin.width,
    height: curWin.height,
    incognito: curWin.incognito,
    top: curWin.top,
    left: curWin.left,
  };
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

// Open new window in same position as parent
// NOTE: It is not possible to know the tab
// from where the "create new window" action was triggered.
// So you can't know the exact position of it.
// MacOS seems to open "new windows" with a small offset to
// the right/down if possible
// chrome.windows.onCreated.addListener(async (window) => {
//   const lastFocusedWin = await chrome.windows.getLastFocused();
//   console.log('nnn', lastFocusedWin.id, window.id);
//   if (window.state == 'normal') {
//     await chrome.windows.update(window.id, {
//       top: window.top - 10,
//       left: window.left - 10,
//     });
//   }
// });
