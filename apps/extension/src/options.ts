import { getSettings, saveSettings } from "./storage";

const API_TOKEN_PREFIX = "sb_pat_"; // must match apps/api/core/auth.py's API_TOKEN_PREFIX

const apiUrlEl = document.getElementById("api-url") as HTMLInputElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

function setStatus(message: string, kind: "ok" | "error" | "") {
  statusEl.textContent = message;
  statusEl.className = kind;
}

async function init() {
  const settings = await getSettings();
  if (settings) {
    apiUrlEl.value = settings.apiUrl;
    tokenEl.value = settings.token;
  }
}

saveBtn.addEventListener("click", async () => {
  const apiUrl = apiUrlEl.value.trim().replace(/\/$/, "");
  const token = tokenEl.value.trim();

  if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
    setStatus("Enter a valid API URL (including http:// or https://).", "error");
    return;
  }
  if (!token.startsWith(API_TOKEN_PREFIX)) {
    setStatus(`That doesn't look like a personal access token (should start with ${API_TOKEN_PREFIX}).`, "error");
    return;
  }

  // MV3's the-server-doesn't-get-a-say-in-this cross-origin fetch path:
  // this extension only ever declares broad host access as *optional*
  // (manifest.json's optional_host_permissions), so nothing is granted
  // until the user actually configures an API URL, and only that exact
  // origin is requested here - not the whole optional set.
  const granted = await chrome.permissions.request({ origins: [`${apiUrl}/*`] });
  if (!granted) {
    setStatus("Permission to reach that URL was denied - capture won't work without it.", "error");
    return;
  }

  await saveSettings({ apiUrl, token });
  setStatus("Saved. Try capturing a page from the toolbar icon.", "ok");
});

init();
