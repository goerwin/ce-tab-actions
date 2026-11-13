export const DEFAULT_SETTINGS = Object.freeze({
  jumpWindows: true,
  focusFirstLastTabIfEdgeWindow: true,
});

export async function readSettings(storage = chrome.storage.sync) {
  const saved = await storage.get(DEFAULT_SETTINGS);
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
      key,
      typeof saved[key] === 'boolean' ? saved[key] : fallback,
    ]),
  );
}
