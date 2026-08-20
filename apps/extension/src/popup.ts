import { createCapture } from "./capture";
import { getSettings } from "./storage";

const pageTitleEl = document.getElementById("page-title")!;
const noteEl = document.getElementById("note") as HTMLTextAreaElement;
const buttonEl = document.getElementById("capture-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const setupLinkEl = document.getElementById("setup-link") as HTMLAnchorElement;

function setStatus(message: string, kind: "ok" | "error" | "") {
  statusEl.textContent = message;
  statusEl.className = kind;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await currentTab();
  pageTitleEl.textContent = tab?.title ?? tab?.url ?? "";

  const settings = await getSettings();
  if (!settings) {
    buttonEl.disabled = true;
    setStatus("Set up your API URL and token first.", "error");
  }

  setupLinkEl.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  buttonEl.addEventListener("click", async () => {
    if (!tab?.url) return;
    buttonEl.disabled = true;
    setStatus("Capturing...", "");

    const note = noteEl.value.trim();
    const result = await createCapture({
      source_url: tab.url,
      // The page's own title/URL is already the source_url's job - a
      // note is only sent as separate raw_text when the user actually
      // typed one, so an empty capture doesn't duplicate the URL twice.
      raw_text: note || undefined,
    });

    if (result.ok) {
      setStatus("Captured - added to your Inbox.", "ok");
    } else {
      setStatus(result.error, "error");
      buttonEl.disabled = false;
    }
  });
}

init();
