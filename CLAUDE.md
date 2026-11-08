# Dreamware Post Downloader (Chrome extension, MV3, personal use only)

No build step: plain JS loaded unpacked from this folder. See README.md for install and behaviour. One content script per site (`x.js`, `instagram.js`), shared `background.js`.

## Non-obvious notes

- `<all_urls>` host permission is there for `captureVisibleTab`; content scripts only match x.com, twitter.com and www.instagram.com. No store listing, so the broad permission is accepted.
- Testing via claude-in-chrome: the extension is loaded in that Chrome, but code changes need a manual reload in `chrome://extensions` (Steve has to do it). On 2026-11-06 `captureVisibleTab` never resolved there (suspected: automated window behind other windows), so `requestCapture` has a 5s timeout.

### X

- Capture uses `chrome.tabs.captureVisibleTab` with scroll-and-stitch (not DOM rasterization) so output is pixel-exact. It is limited to about 2 calls per second, hence `CAPTURE_GAP_MS`.
- Button lives in the post's action bar (`[role="group"]` containing `[data-testid="reply"]`) and is set to `display: none` during capture, so X's native layout is what gets saved. Click handler must `stopPropagation` or X opens the post.
- Fixed/sticky elements overlapping the post column are hidden during capture (X's sticky top header).
- Scope decisions from Steve: button on every post everywhere (`ONLY_STATUS_PAGES = false`; Steve clicks "Show more" manually before capturing truncated feed posts), download only (no clipboard), filename `handle_postid_YYYYMMDD-HHMMSS.png` using capture time, minimal styling.
- Media button (only on posts containing `tweetPhoto`/`videoPlayer`/`videoComponent`) uses the syndication endpoint `cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>`, token = `((id/1e15)*PI).toString(36)` with zeros and dot stripped, fetched in the background worker. Chosen over X's GraphQL API because that needs a rotating queryId plus bearer/csrf headers. Fallback: DOM photos rewritten to `name=orig`.
- X's DOM selectors (`data-testid`) can change; check them first if buttons stop appearing.

### Instagram

- Feed/Reels videos play from `blob:` MSE streams, so media can't be grabbed from the DOM. Instead: shortcode -> numeric media id (base64-style alphabet) -> `GET /api/v1/media/<id>/info/` with header `X-IG-App-ID: 936619743392459` (same-origin, uses the session cookie). `video_versions` gives progressive MP4s, `image_versions2.candidates` gives originals, `carousel_media` lists slides.
- CDN files have no CORS headers, so downloads go through `chrome.downloads` in the background worker, not `fetch` in the content script.
- Button placement: from each `svg[aria-label^="Share"]`, walk up to the first ancestor with 4+ children that also holds `svg[aria-label="Comment"]` (feed/post row, or Reels' vertical column) and insert after the Share item. Instagram class names are obfuscated, so only aria-labels are used (English UI assumed).
- Shortcode: feed `<article>` -> its `/p/` or `/reel/` link; otherwise the URL (post page, popup, Reels viewer all put the current code in the path). Articles with no post link are ads and get no button.
- Download all (profile pages): button goes in `main header`'s action row, found by the English text of its buttons (`PROFILE_ACTIONS`: Follow, Message, Edit profile...) and inserted after the last one; colours copied from that neighbour. The run state lives outside the button because Instagram re-renders or reuses the header across navigation. As of 2026-11-08 `/api/v1/users/web_profile_info/`, `/api/v1/feed/user/<id>/` and `/feed/user/<name>/username/` all 404 (the grid now loads via GraphQL with rotating doc ids), while media info still works. So the run scrolls the profile's posts tab, collects `/p/` and `/reel/` codes from grid links outside `header`, and fetches each via media info. Total comes from the header's "N posts" text. Files go in a `username/` subfolder. Delays (`POST_GAP_MS`, `FILE_GAP_MS`, `SCROLL_WAIT_MS`) and 429 back-off are there to avoid tripping Instagram's rate limits on the account.
- Scope decisions from Steve: home feed, post pages, Reels (not stories); carousels download all slides; filename `username_postcode_YYYYMMDD-HHMMSS[_n].ext`.
