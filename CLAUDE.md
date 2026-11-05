# X Post Screenshot (Chrome extension, MV3, personal use only)

No build step: plain JS loaded unpacked from this folder. See README.md for install.

## Non-obvious notes

- Capture uses `chrome.tabs.captureVisibleTab` with scroll-and-stitch (not DOM rasterization) so output is pixel-exact. It is limited to about 2 calls per second, hence `CAPTURE_GAP_MS` in `content.js`.
- `<all_urls>` host permission is there for `captureVisibleTab`; the content script itself only matches x.com and twitter.com. No store listing, so the broad permission is accepted.
- Button lives in the post's action bar (`[role="group"]` containing `[data-testid="reply"]`) and is set to `display: none` during capture, so X's native layout is what gets saved. Click handler must `stopPropagation` or X opens the post.
- Fixed/sticky elements overlapping the post column are hidden during capture (X's sticky top header).
- Scope decisions from Steve: button on every post everywhere (`ONLY_STATUS_PAGES = false`; Steve clicks "Show more" manually before capturing truncated feed posts), download only (no clipboard), filename `handle_postid_YYYYMMDD-HHMMSS.png` using capture time, minimal styling.
- Testing via claude-in-chrome: the extension is loaded in that Chrome, but code changes need a manual reload in `chrome://extensions` (Steve has to do it). On 2026-11-06 `captureVisibleTab` never resolved there (suspected: automated window behind other windows), so `requestCapture` has a 5s timeout.
- X's DOM selectors (`data-testid`) can change; check them first if buttons stop appearing.
