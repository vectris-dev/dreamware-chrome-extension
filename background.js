chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;

  // X: capture the visible area of the tab that asked for it.
  if (msg?.type === 'xps-capture') {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  // X: post data (incl. media URLs) from the public embed endpoint.
  if (msg?.type === 'xdl-tweet') {
    // Same token derivation X's own embed widget uses.
    const token = ((Number(msg.id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${msg.id}&lang=en&token=${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Embed lookup failed (${res.status})`);
        const data = await res.json();
        sendResponse({ data: data?.__typename === 'TweetTombstone' ? null : data });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // X and Instagram: download a media file straight from the CDN (no CORS limits here).
  if (msg?.type === 'dw-download') {
    chrome.downloads
      .download({ url: msg.url, filename: msg.filename, conflictAction: 'uniquify' })
      .then((id) => sendResponse({ id }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
