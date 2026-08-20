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
  // Newer @types/chrome versions infer get(key)'s return type from the
  // key argument's shape (an empty {} for a bare string key) rather
  // than the old loose { [key: string]: any } - the runtime value is
  // unaffected either way, this just tells the type checker what's
  // actually in there before validating it below.
  const result = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
  const value = result[STORAGE_KEY] as ExtensionSettings | undefined;
  if (!value || typeof value.apiUrl !== "string" || typeof value.token !== "string") {
    return null;
  }
  return value;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
