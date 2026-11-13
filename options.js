import { readSettings } from './settings.js';

const form = document.querySelector('#settings');
const fieldset = form.querySelector('fieldset');
const jumpWindows = form.elements.namedItem('jumpWindows');
const focusEdge = form.elements.namedItem('focusFirstLastTabIfEdgeWindow');
const status = document.querySelector('#status');

function updateDependency() {
  focusEdge.disabled = !jumpWindows.checked;
}

async function loadSettings() {
  try {
    const settings = await readSettings();
    jumpWindows.checked = settings.jumpWindows;
    focusEdge.checked = settings.focusFirstLastTabIfEdgeWindow;
    updateDependency();
    fieldset.disabled = false;
  } catch (error) {
    status.textContent = `Could not load settings. Reload this page to try again. ${error.message}`;
  }
}

jumpWindows.addEventListener('change', updateDependency);
form.addEventListener('change', () => {
  status.textContent = 'You have unsaved changes.';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldset.disabled = true;
  try {
    await chrome.storage.sync.set({
      jumpWindows: jumpWindows.checked,
      focusFirstLastTabIfEdgeWindow: focusEdge.checked,
    });
    status.textContent = 'Settings saved.';
  } catch (error) {
    status.textContent = `Could not save settings. Try again. ${error.message}`;
  } finally {
    fieldset.disabled = false;
  }
});

void loadSettings();
