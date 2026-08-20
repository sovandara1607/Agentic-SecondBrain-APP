// Settings live in chrome.storage.local (per-device), not `.sync` - a
// personal access token shouldn't silently propagate to every Chrome
// profile the user happens to be signed into; each install gets its own
// token from Settings -> API tokens (apps/web/components/api-tokens-panel.tsx).
export type ExtensionSettings = {
  apiUrl: string;
  token: string;
};

const STORAGE_KEY = "second-brain:settings";

export async function getSettings(): Promise<ExtensionSettings | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!value || typeof value.apiUrl !== "string" || typeof value.token !== "string") {
    return null;
  }
  return value as ExtensionSettings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
