(() => {
  const BTN_CLASS = 'igdl-btn';
  // Public web app id Instagram's own site sends with its API requests.
  const IG_APP_ID = '936619743392459';
  const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const CODE_RE = /\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/;

  const ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';

  // ---------- Button injection ----------

  // Every post (feed, post page, post popup, reel) has an action row/column holding
  // Like, Comment, Repost, Share. The button goes right after Share.
  function scan() {
    for (const share of document.querySelectorAll('svg[aria-label^="Share"]')) {
      let item = share;
      let depth = 0;
      while (item.parentElement && item.parentElement.children.length < 4 && depth++ < 8) {
        item = item.parentElement;
      }
      const row = item.parentElement;
      if (!row || row.children.length < 4 || !row.querySelector('svg[aria-label="Comment"]')) continue;
      if (row.querySelector(`:scope > .${BTN_CLASS}`)) continue;
      // Ads are feed articles with no link to a post; skip them.
      if (!shortcodeFor(row)) continue;
      item.after(makeButton());
    }
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.title = 'Download media';
    btn.setAttribute('aria-label', 'Download media');
    btn.innerHTML = ICON;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1';
      delete btn.dataset.error;
      try {
        const code = shortcodeFor(btn);
        if (!code) throw new Error('Could not find the post code');
        await downloadPost(code);
      } catch (err) {
        console.error('[Dreamware IG]', err);
        btn.dataset.error = '1';
        setTimeout(() => delete btn.dataset.error, 3000);
      } finally {
        delete btn.dataset.busy;
      }
    });
    return btn;
  }

  // ---------- Post lookup ----------

  // Feed posts are <article>s with a link to the post (the timestamp). Post pages,
  // the post popup and the Reels viewer all put the current post's code in the URL.
  function shortcodeFor(el) {
    const article = el.closest('article');
    if (article) {
      const timeLink = article.querySelector('time')?.closest('a');
      const links = [timeLink, ...article.querySelectorAll('a[href]')].filter(Boolean);
      for (const a of links) {
        const m = a.getAttribute('href').match(CODE_RE);
        if (m) return m[1];
      }
      return null;
    }
    return location.pathname.match(CODE_RE)?.[1];
  }

  function shortcodeToId(code) {
    let id = 0n;
    for (const c of code) id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(c));
    return id.toString();
  }

  async function fetchMedia(code) {
    const item = (await igApi(`/api/v1/media/${shortcodeToId(code)}/info/`)).items?.[0];
    if (!item) throw new Error('Media info missing');
    item.code ??= code;
    return item;
  }

  async function igApi(path) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${location.origin}${path}`, {
        headers: { 'X-IG-App-ID': IG_APP_ID },
        credentials: 'include',
      });
      if (res.ok) return res.json();
      // Rate limited: back off and retry a few times.
      if (res.status === 429 && attempt < 3) {
        await sleep(30000 * (attempt + 1));
        continue;
      }
      throw new Error(`Request failed (${res.status})`);
    }
  }

  const largest = (list) =>
    list.reduce((best, x) => (x.width * x.height > best.width * best.height ? x : best));

  function extFromUrl(url, fallback) {
    return new URL(url).pathname.match(/\.(jpe?g|png|webp|heic|mp4|mov)$/i)?.[1].toLowerCase() || fallback;
  }

  async function downloadPost(code) {
    await downloadItem(await fetchMedia(code), timestamp());
  }

  // `item` is a media object as returned by the media info and user feed endpoints.
  async function downloadItem(item, stamp, folder = '', gapMs = 0) {
    const user = item.user?.username || 'unknown';
    const code = item.code;
    const parts = item.carousel_media?.length ? item.carousel_media : [item];

    for (let i = 0; i < parts.length; i++) {
      if (i && gapMs) await sleep(gapMs);
      const m = parts[i];
      let url, ext;
      if (m.video_versions?.length) {
        url = largest(m.video_versions).url;
        ext = extFromUrl(url, 'mp4');
      } else {
        url = largest(m.image_versions2.candidates).url;
        ext = extFromUrl(url, 'jpg');
      }
      const suffix = parts.length > 1 ? `_${i + 1}` : '';
      await requestDownload(url, `${folder}${user}_${code}_${stamp}${suffix}.${ext}`);
    }
  }

  // ---------- Download all posts of a profile ----------

  // First path segments that are Instagram pages, not usernames.
  const RESERVED = new Set([
    'about', 'accounts', 'api', 'challenge', 'developer', 'direct', 'directory', 'emails',
    'explore', 'graphql', 'legal', 'lite', 'oauth', 'p', 'privacy', 'reel', 'reels', 'session',
    'stories', 'terms', 'tv', 'web',
  ]);
  // Delays keep the request rate close to normal browsing to avoid rate limits.
  const POST_GAP_MS = 1000; // between posts (one media info request each)
  const FILE_GAP_MS = 300; // between carousel slides
  const SCROLL_WAIT_MS = 2000; // for the grid to load more after scrolling
  const SCROLL_TRIES = 4; // scrolls with no new posts before treating the grid as finished

  // Profile header action buttons (other people's profiles and your own). English UI assumed.
  const PROFILE_ACTIONS = new Set([
    'Follow', 'Following', 'Follow Back', 'Requested', 'Message', 'Edit profile', 'View archive',
  ]);

  // One run at a time. The run outlives the button: Instagram re-renders or drops the
  // header on navigation, so the button just reflects this state whenever it exists.
  let allRun = null; // { username, stop, text }
  let allStatus = null; // { username, text, error } shown briefly after a run ends

  function profileUsername() {
    const m = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?(?:reels\/?|tagged\/?)?$/);
    return m && !RESERVED.has(m[1].toLowerCase()) ? m[1] : null;
  }

  // Goes in the profile header's action row (Follow / Message / ...), after the last action.
  function updateAllButton() {
    const username = profileUsername();
    const header = username && document.querySelector('main header');
    if (!header) return;
    let btn = header.querySelector('.igdl-all');
    if (!btn) {
      const actions = [...header.querySelectorAll('button, div[role="button"], a')].filter((el) =>
        PROFILE_ACTIONS.has(el.innerText.trim())
      );
      const last = actions.at(-1);
      if (!last) return;
      let item = last;
      while (item.parentElement && item.parentElement.children.length < 2 && item.parentElement !== header) {
        item = item.parentElement;
      }
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'igdl-all';
      btn.addEventListener('click', onAllClick);
      // Match the neighbouring button's colours (dark/light theme).
      const s = getComputedStyle(last);
      btn.style.backgroundColor = s.backgroundColor;
      btn.style.color = s.color;
      item.after(btn);
    }
    renderAllButton(btn, username);
  }

  function renderAllButton(btn, username) {
    let html = ICON;
    let title = `Download all posts by @${username}`;
    let state = '';
    if (allRun?.username === username) {
      html = escapeHtml(allRun.text);
      title = 'Click to stop';
      state = 'busy';
    } else if (allStatus?.username === username) {
      html = escapeHtml(allStatus.text);
      state = allStatus.error ? 'error' : 'done';
    } else if (allRun) {
      title = `Already downloading @${allRun.username}`;
    }
    // Only write when changed: every write is a DOM mutation that re-triggers the observer.
    if (btn.dataset.user !== username) btn.dataset.user = username;
    if (btn.dataset.state !== state) btn.dataset.state = state;
    if (btn.title !== title) btn.title = title;
    // Compare with what was set, not innerHTML (the browser reserializes the SVG).
    if (btn.igdlHtml !== html) btn.innerHTML = btn.igdlHtml = html;
  }

  function refreshAllButton() {
    const btn = document.querySelector('main header .igdl-all');
    if (btn) renderAllButton(btn, btn.dataset.user);
  }

  async function onAllClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const username = e.currentTarget.dataset.user;
    if (allRun) {
      if (allRun.username === username) {
        allRun.stop = true;
        allRun.text = 'Stopping...';
        refreshAllButton();
      }
      return;
    }
    const run = (allRun = { username, stop: false, text: 'Starting...' });
    allStatus = null;
    refreshAllButton();
    try {
      const done = await downloadProfile(run, (n, total) => {
        run.text = `${n}/${total ?? '?'}`;
        refreshAllButton();
      });
      const failed = run.failed ? ` (${run.failed} failed)` : '';
      allStatus = {
        username,
        text: (run.stop ? `Stopped at ${done}` : `Done: ${done}`) + failed,
        error: !!run.failed,
      };
    } catch (err) {
      console.error('[Dreamware IG]', err);
      allStatus = { username, text: 'Failed', error: true };
    } finally {
      allRun = null;
      refreshAllButton();
      const status = allStatus;
      setTimeout(() => {
        if (allStatus === status) allStatus = null;
        refreshAllButton();
      }, 5000);
    }
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  // Instagram's feed/profile endpoints (web_profile_info, feed/user) now 404, and the grid
  // loads through GraphQL with rotating query ids. So post codes are collected from the
  // grid itself, scrolling to make Instagram load more, and each post goes through the
  // media info endpoint like the single-post button.
  async function downloadProfile(run, onProgress) {
    const home = `/${run.username}/`;
    // The Reels and Tagged tabs share the header; Tagged holds other people's posts.
    if (location.pathname !== home) {
      document.querySelector(`main a[href="${home}"]`)?.click();
      await sleep(2500);
    }
    const total = postCount();
    const stamp = timestamp();
    const folder = `${run.username}/`;
    const seen = new Set();
    const queue = [];
    let done = 0;
    let idle = 0;
    onProgress(0, total);

    while (!run.stop) {
      if (location.pathname !== home) throw new Error('Left the profile page');
      for (const code of gridCodes()) {
        if (!seen.has(code)) {
          seen.add(code);
          queue.push(code);
        }
      }
      if (queue.length) {
        idle = 0;
        const code = queue.shift();
        try {
          await downloadItem(await fetchMedia(code), stamp, folder, FILE_GAP_MS);
        } catch (err) {
          // Skip a broken post rather than abandoning the whole profile.
          console.error('[Dreamware IG]', code, err);
          run.failed = (run.failed || 0) + 1;
        }
        onProgress(++done, total);
        await sleep(POST_GAP_MS);
        continue;
      }
      // Nothing new in the grid: scroll to the bottom so Instagram loads the next batch.
      if (total && done >= total) break;
      if (idle++ >= SCROLL_TRIES) break;
      const root = document.scrollingElement;
      root.scrollTo(0, root.scrollHeight);
      await sleep(SCROLL_WAIT_MS);
    }
    return done;
  }

  function gridCodes() {
    const codes = [];
    for (const a of document.querySelectorAll('main a[href]')) {
      if (a.closest('header')) continue;
      const m = a.getAttribute('href').match(CODE_RE);
      if (m) codes.push(m[1]);
    }
    return codes;
  }

  // "248 posts" in the header; null when abbreviated ("1.2K posts") or missing.
  function postCount() {
    for (const span of document.querySelectorAll('main header span')) {
      const m = span.innerText.trim().match(/^([\d,]+)\s+posts?$/i);
      if (m) return Number(m[1].replace(/,/g, ''));
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Start ----------

  // Instagram is a single-page app, so DOM changes also cover navigation.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
      updateAllButton();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
  updateAllButton();

  function requestDownload(url, filename) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'dw-download', url, filename }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || res.error) return reject(new Error(res?.error || 'Download failed'));
        resolve(res.id);
      });
    });
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  }
})();
