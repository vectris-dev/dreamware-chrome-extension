# Dreamware Post Downloader

Personal-use Chrome extension that adds a download button to posts on X and Instagram.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and pick this folder.
3. After editing files, click the reload icon on the extension card and refresh the site.

## X (`x.js`, `x.css`)

A camera button in the action bar of every post (home feed, bookmarks, profiles, post pages) downloads a PNG screenshot of the whole post, without the button, named `handle_postid_YYYYMMDD-HHMMSS.png` (capture time).

The extension scrolls the post into view in slices, captures each slice with `chrome.tabs.captureVisibleTab` (so the image is pixel-exact), and stitches them together. Fixed/sticky overlays above the post (such as the top header) are hidden during capture and the scroll position is restored afterwards.

Posts with photos, videos or GIFs also get a download arrow next to the camera, which saves the original files (full-size photos, highest-bitrate MP4) as `handle_postid_YYYYMMDD-HHMMSS[_n].ext`. If the post has no media of its own, the quoted post's media is used. Media URLs come from X's public embed endpoint (`cdn.syndication.twimg.com/tweet-result`); when that has nothing (sensitive or protected posts), photos are taken from the page and videos can't be downloaded.

Long posts in feeds are truncated, so click "Show more" before capturing. Set `ONLY_STATUS_PAGES = true` in `x.js` to limit the button to single-post pages.

## Instagram (`instagram.js`, `instagram.css`)

A download arrow after the Share icon on posts in the home feed, post pages, the post popup and the Reels viewer downloads the original images/videos (full resolution, MP4 with audio). Carousels download every slide. Files are named `username_postcode_YYYYMMDD-HHMMSS.ext`, with `_1`, `_2`... for carousel slides. Ads get no button.

Media URLs come from Instagram's own web API (`/api/v1/media/<id>/info/`, using your logged-in session), and files are saved with `chrome.downloads`.

On a profile page, a download button in the profile header (after Follow/Message, or Edit profile on your own) downloads every post on the account (same naming, all files in a `username/` subfolder of Downloads). While running it shows progress (`12/210`); click it again to stop. It scrolls the profile's post grid to make Instagram load every post, then fetches each one through the same media info endpoint as the single-post button, about one post per second, backing off on rate limits. Stay on the profile while it runs (leaving stops it). Posts that fail are skipped and counted in the final status. Private accounts only work if you follow them. Turn off Chrome's "Ask where to save each file" first or you'll get a dialog per file.
