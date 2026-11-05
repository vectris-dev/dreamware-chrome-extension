// Captures the visible area of the tab that asked for it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'xps-capture' || !sender.tab) return;
  chrome.tabs
    .captureVisibleTab(sender.tab.windowId, { format: 'png' })
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((err) => sendResponse({ error: err.message }));
  return true; // async response
});
