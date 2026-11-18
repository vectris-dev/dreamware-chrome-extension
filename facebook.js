(() => {
  // Facebook loads photo data through GraphQL with rotating doc ids, and the photo page
  // HTML is an empty shell, so there is no simple endpoint for originals. The photo
  // viewer does load the full-size image, though, so "download all" drives the viewer:
  // open the first photo in the grid, save the image, click Next, repeat.

  const PHOTO_GAP_MS = 800; // pause between photos, to stay near normal browsing speed
  const URL_WAIT_MS = 6000; // Next that doesn't change the photo within this = end of set
  const IMG_WAIT_MS = 15000; // for the full-size image to load in the viewer
  const MAX_PHOTOS = 5000; // safety stop

  const ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';

  let run = null; // { stop, text }
  let status = null; // { text, error } shown briefly after a run ends

  // Photo grids: a page's or profile's Photos tabs, and album pages.
  function isGridPage() {
    const path = location.pathname;
    if (/^\/[^/]+\/photos(_by|_of)?\/?$/.test(path)) return true;
    if (path === '/media/set/') return true;
    if (path === '/profile.php') return /^photos(_by|_of)?$/.test(new URLSearchParams(location.search).get('sk') || '');
    return false;
  }

  // ---------- Button ----------

  // Fixed in the corner rather than inside Facebook's (obfuscated, re-rendered) layout.
  let btn = null;

  function update() {
    const show = !!run || (isGridPage() && !!gridLinks().length);
    if (!show) {
      btn?.remove();
      btn = null;
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fbdl-all';
      btn.addEventListener('click', onClick);
    }
    if (!btn.isConnected) document.body.append(btn);
    render();
  }

  function render() {
    if (!btn) return;
    let html = `${ICON}<span>Download all</span>`;
    let title = 'Download every photo in this grid';
    let state = '';
    if (run) {
      html = escapeHtml(run.text);
      title = 'Click to stop';
      state = 'busy';
    } else if (status) {
      html = escapeHtml(status.text);
      state = status.error ? 'error' : 'done';
    }
    if (btn.dataset.state !== state) btn.dataset.state = state;
    if (btn.title !== title) btn.title = title;
    if (btn.fbdlHtml !== html) btn.innerHTML = btn.fbdlHtml = html;
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (run) {
      run.stop = true;
      run.text = 'Stopping...';
      render();
      return;
    }
    const r = (run = { stop: false, text: 'Starting...', failed: 0 });
    status = null;
    render();
    try {
      const done = await downloadAll(r, (n) => {
        r.text = `${n} saved`;
        render();
      });
      const failed = r.failed ? ` (${r.failed} failed)` : '';
      status = { text: (r.stop ? `Stopped at ${done}` : `Done: ${done}`) + failed, error: !!r.failed };
    } catch (err) {
      console.error('[Dreamware FB]', err);
      status = { text: err.message === 'Viewer closed' ? 'Stopped' : 'Failed', error: true };
    } finally {
      run = null;
      update();
      const s = status;
      setTimeout(() => {
        if (status === s) status = null;
        render();
      }, 5000);
    }
  }

  // ---------- Grid ----------

  // Grid thumbnails are /photo/ or /photo.php links. The cover photo is one too, so keep
  // only links from the grid's set: the album's own set on album pages, otherwise the
  // set most links share.
  function gridLinks() {
    const links = [...document.querySelectorAll('[role="main"] a[href*="/photo"]')].filter(
      (a) => a.querySelector('img') && photoParams(a.href).get('fbid')
    );
    let set = location.pathname === '/media/set/' ? new URLSearchParams(location.search).get('set') : null;
    if (!set) {
      const counts = new Map();
      for (const a of links) {
        const s = photoParams(a.href).get('set');
        if (s) counts.set(s, (counts.get(s) || 0) + 1);
      }
      set = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    return links.filter((a) => photoParams(a.href).get('set') === set);
  }

  const photoParams = (href) => new URL(href, location.href).searchParams;

  // Folder/filename prefix: the page's vanity name or profile id, from the profile tabs
  // ("All" links to the profile) or the URL.
  function ownerName() {
    const m = location.pathname.match(/^\/([^/]+)\/photos/);
    if (m && m[1] !== 'profile.php') return m[1];
    const id = location.pathname === '/profile.php' && new URLSearchParams(location.search).get('id');
    if (id) return id;
    for (const a of document.querySelectorAll('[role="main"] a[role="tab"][href]')) {
      const u = new URL(a.href);
      if (u.pathname === '/profile.php') return u.searchParams.get('id') || 'facebook';
      const seg = u.pathname.match(/^\/([^/]+)\/?$/)?.[1];
      if (seg) return seg;
    }
    return 'facebook';
  }

  // ---------- Viewer loop ----------

  async function downloadAll(r, onProgress) {
    const first = gridLinks()[0];
    if (!first) throw new Error('No photos found');
    const owner = ownerName().replace(/[^\w.-]/g, '_');
    const folder = `${owner}/`;
    const stamp = timestamp();
    const seen = new Set();
    let done = 0;
    let prevSrc = null;

    first.click();
    let fbid = await waitFor(() => currentFbid(), URL_WAIT_MS);
    if (!fbid) throw new Error('Photo viewer did not open');
    onProgress(0);

    while (!r.stop && seen.size < MAX_PHOTOS) {
      seen.add(fbid);
      const img = await waitFor(() => {
        const i = viewerImage();
        return i && i.src !== prevSrc && i.complete && i.naturalWidth ? i : null;
      }, IMG_WAIT_MS);
      if (!currentFbid()) throw new Error('Viewer closed');
      if (img) {
        prevSrc = img.src;
        try {
          await requestDownload(img.src, `${folder}${owner}_${fbid}_${stamp}.${extFromUrl(img.src)}`);
          onProgress(++done);
        } catch (err) {
          console.error('[Dreamware FB]', fbid, err);
          r.failed++;
        }
      } else {
        // Videos in a photo set, or an image that never loaded.
        console.warn('[Dreamware FB] No image for', fbid);
        r.failed++;
      }
      if (r.stop) break;
      await sleep(PHOTO_GAP_MS);

      const next = document.querySelector('[role="dialog"] [aria-label="Next photo"], [aria-label="Next photo"]');
      if (!next) break;
      const before = fbid;
      next.click();
      // At the end of a set, Next stays but the photo no longer changes.
      fbid = await waitFor(() => {
        const id = currentFbid();
        return id && id !== before ? id : null;
      }, URL_WAIT_MS);
      if (!fbid || seen.has(fbid)) break;
    }

    // Close the viewer, back to the grid.
    if (currentFbid()) document.querySelector('[role="dialog"] [aria-label="Close"], [aria-label="Close"]')?.click();
    return done;
  }

  function currentFbid() {
    return /^\/photo(\.php|\/)?$/.test(location.pathname) ? new URLSearchParams(location.search).get('fbid') : null;
  }

  // The largest image on screen in the viewer dialog (the sidebar only has small avatars).
  function viewerImage() {
    let best = null;
    let bestArea = 0;
    for (const img of document.querySelectorAll('[role="dialog"] img')) {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 200) {
        best = img;
        bestArea = area;
      }
    }
    return best;
  }

  function extFromUrl(url) {
    const ext = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext || 'jpg';
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  }

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

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Start ----------

  // Facebook is a single-page app; the grid also fills in late, so poll.
  setInterval(update, 1000);
  update();
})();
