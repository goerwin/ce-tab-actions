import { createTabActions } from './tab-actions.js';

const MENU_ID = 'toggle-tab-in-popup';
const actions = createTabActions(chrome);
const commands = new Map([
  ['a_toggleTabInPopup', actions.togglePopup],
  ['aa_focusPrevTab', (tab) => actions.focusTab(-1, tab)],
  ['ab_focusNextTab', (tab) => actions.focusTab(1, tab)],
  ['b_moveTabToLeft', (tab) => actions.moveTab(-1, tab)],
  ['c_moveTabToRight', (tab) => actions.moveTab(1, tab)],
  ['d_moveTabPrevWindow', (tab) => actions.moveToWindow(-1, tab)],
  ['e_moveTabNextWindow', (tab) => actions.moveToWindow(1, tab)],
]);

// Serialize shortcuts/clicks so rapid actions cannot overwrite session state.
let pending = Promise.resolve();
function run(label, task) {
  pending = pending.then(task).catch((error) => {
    console.error(`[Tab Actions] ${label} failed:`, error);
  });
}

// Chrome retains menus when the worker stops. Only rebuild on install/update.
// Register all listeners synchronously so they can wake the service worker.
chrome.runtime.onInstalled.addListener(() => {
  run('Set up context menu', async () => {
    await chrome.contextMenus.removeAll();
    await new Promise((resolve, reject) => {
      // create() returns an ID, not a Promise. Read lastError in its callback.
      chrome.contextMenus.create(
        { id: MENU_ID, title: 'Toggle tab in popup', contexts: ['page'] },
        () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        },
      );
    });
  });
});

chrome.action.onClicked.addListener((tab) => {
  run('Toggle popup', () => actions.togglePopup(tab));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) {
    run('Toggle popup', () => actions.togglePopup(tab));
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  const action = commands.get(command);
  if (action) run(command, () => action(tab));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  run('Clean up closed tab', () => actions.forgetTab(tabId));
});
