import { createCapture } from "./capture";

const MENU_ID = "second-brain-capture-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add selection to Second Brain",
    contexts: ["selection"],
  });
});

// Runs in the background (not the popup) specifically so the capture
// still completes even if the user clicks away and the popup unmounts
// mid-request - a context-menu click has no popup to keep open anyway.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  const result = await createCapture({
    raw_text: info.selectionText,
    source_url: info.pageUrl ?? tab?.url,
  });

  const title = result.ok ? "Captured" : "Capture failed";
  const message = result.ok
    ? "Added to your Second Brain Inbox."
    : result.error;

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title,
    message,
  });
});
