# X Post Screenshot

Chrome extension (personal use) that adds a camera button to the action bar of every post on X. Clicking it downloads a PNG of the whole post, without the button, named `handle_postid_YYYYMMDD-HHMMSS.png` (capture time).

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and pick this folder.
3. After editing files, click the reload icon on the extension card and refresh X.

## How it works

The button only hides itself during capture. The extension scrolls the post into view in slices, captures each slice with `chrome.tabs.captureVisibleTab` (so the image is pixel-exact), and stitches them together. Fixed/sticky overlays above the post (such as the top header) are hidden during capture and the scroll position is restored afterwards.

The button shows on every post everywhere (home feed, bookmarks, profiles, post pages). Long posts in feeds are truncated, so click "Show more" before capturing. Set `ONLY_STATUS_PAGES = true` in `content.js` to limit it to single-post pages.
