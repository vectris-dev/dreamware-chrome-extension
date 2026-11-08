(() => {
  const BTN_CLASS = 'xps-btn';
  // Set true to only add buttons on single-post pages (/user/status/id).
  const ONLY_STATUS_PAGES = false;
  // Chrome allows about 2 captureVisibleTab calls per second.
  const CAPTURE_GAP_MS = 600;

  const SVG_OPEN =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const CAMERA_ICON =
    SVG_OPEN + '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const DOWNLOAD_ICON =
    SVG_OPEN + '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
  // Photos, videos and GIFs attached to a post (or to a post it quotes).
  const MEDIA_SELECTOR =
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isStatusPage = () => /^\/[^/]+\/status\/\d+/.test(location.pathname);

  // ---------- Button injection ----------

  function scan() {
    if (ONLY_STATUS_PAGES && !isStatusPage()) return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const reply = [...article.querySelectorAll('[data-testid="reply"]')].find(
        (el) => el.closest('article') === article
      );
      const group = reply?.closest('[role="group"]');
      if (!group) continue;
      let shot = group.querySelector(`:scope > .${BTN_CLASS}[data-kind="shot"]`);
      if (!shot) {
        shot = makeButton('shot', 'Download screenshot', CAMERA_ICON, screenshot);
        group.appendChild(shot);
      }
      // Media can render after the action bar, so this is re-checked on every scan.
      if (
        !group.querySelector(`:scope > .${BTN_CLASS}[data-kind="media"]`) &&
        article.querySelector(MEDIA_SELECTOR)
      ) {
        shot.after(makeButton('media', 'Download media', DOWNLOAD_ICON, downloadMedia));
      }
    }
  }

  function makeButton(kind, label, icon, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.dataset.kind = kind;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('click', async (e) => {
      // Stop X from treating the click as "open this post".
      e.preventDefault();
      e.stopPropagation();
      const article = btn.closest('article');
      if (!article || btn.dataset.busy) return;
      btn.dataset.busy = '1';
      delete btn.dataset.error;
      try {
        await action(article);
      } catch (err) {
        console.error('[X Post Screenshot]', err);
        btn.dataset.error = '1';
        setTimeout(() => delete btn.dataset.error, 3000);
      } finally {
        delete btn.dataset.busy;
      }
    });
    return btn;
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  // ---------- Capture ----------

  async function screenshot(article) {
    const { handle, id } = postInfo(article);
    const name = `${handle}_${id}_${timestamp()}.png`;
    const ourButtons = [...article.querySelectorAll(`.${BTN_CLASS}`)];
    ourButtons.forEach((b) => (b.style.display = 'none'));
    const restoreOverlays = hideOverlays(article);
    const startX = window.scrollX;
    const startY = window.scrollY;

    let canvas;
    try {
      await waitForImages(article);
      const dpr = window.devicePixelRatio;
      const segments = [];
      let yCss = 0; // how much of the post (CSS px from its top) is captured
      let lastCapture = 0;

      while (true) {
        const r0 = article.getBoundingClientRect();
        if (yCss >= r0.height - 0.5) break;
        window.scrollTo({ left: startX, top: window.scrollY + r0.top + yCss, behavior: 'instant' });
        await settle();
        await waitForImages(article);

        const r = article.getBoundingClientRect();
        const vh = document.documentElement.clientHeight;
        // Scroll may be clamped at the end of the page, so re-measure.
        const top = Math.max(0, r.top + yCss);
        const bottom = Math.min(vh, r.bottom);
        if (bottom - top <= 0) throw new Error('Post is not visible in the viewport');

        const wait = CAPTURE_GAP_MS - (Date.now() - lastCapture);
        if (wait > 0) await sleep(wait);
        lastCapture = Date.now();
        const dataUrl = await requestCapture();

        const sx = Math.round(r.left * dpr);
        const sy = Math.round(top * dpr);
        segments.push({
          dataUrl,
          sx,
          sy,
          sw: Math.round(r.right * dpr) - sx,
          sh: Math.round(bottom * dpr) - sy,
        });
        yCss = bottom - r.top;
      }

      const width = segments[0].sw;
      const height = segments.reduce((sum, s) => sum + s.sh, 0);
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      let dy = 0;
      for (const s of segments) {
        const img = await loadImage(s.dataUrl);
        ctx.drawImage(img, s.sx, s.sy, width, s.sh, 0, dy, width, s.sh);
        dy += s.sh;
      }
    } finally {
      window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
      restoreOverlays();
      ourButtons.forEach((b) => (b.style.display = ''));
    }

    await download(canvas, name);
  }

  // Hide fixed/sticky things (top header, drawers, banners) that would sit on top of the post.
  function hideOverlays(article) {
    const ar = article.getBoundingClientRect();
    const hidden = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.contains(article) || article.contains(el)) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= ar.left || r.left >= ar.right) continue;
      hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    return () => {
      for (const [el, value, priority] of hidden) {
        if (value) el.style.setProperty('visibility', value, priority);
        else el.style.removeProperty('visibility');
      }
    };
  }

  async function settle() {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(150);
  }

  async function waitForImages(root) {
    const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
    await Promise.all(
      pending.map((img) =>
        Promise.race([
          new Promise((r) => {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
          }),
          sleep(3000),
        ])
      )
    );
  }

  function requestCapture() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Capture timed out. Is the Chrome window visible and in front?')),
        5000
      );
      chrome.runtime.sendMessage({ type: 'xps-capture' }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || res.error) return reject(new Error(res?.error || 'Capture failed'));
        resolve(res.dataUrl);
      });
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode capture'));
      img.src = src;
    });
  }

  // ---------- Media download ----------

  // Media URLs come from X's public embed endpoint (no login needed), fetched by the
  // background worker. The video in the page is an MSE blob stream, so it can't be
  // grabbed from the DOM. If the post has no media of its own, the quoted post's is used.
  async function downloadMedia(article) {
    const { handle, id } = postInfo(article);
    const stamp = timestamp();
    let items = [];
    let owner = { handle, id };

    let tweet = null;
    try {
      if (id !== 'unknown') tweet = await sendMessage({ type: 'xdl-tweet', id });
    } catch (err) {
      console.warn('[X Media] embed lookup failed, falling back to page images', err);
    }
    if (tweet) {
      items = mediaFromTweet(tweet);
      const quoted = tweet.quoted_tweet;
      if (!items.length && quoted) {
        items = mediaFromTweet(quoted);
        owner = { handle: quoted.user?.screen_name || 'unknown', id: quoted.id_str || 'unknown' };
      }
    }
    // Fallback (embed unavailable, e.g. sensitive or protected posts): photos only.
    if (!items.length) {
      items = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
        .map((img) => photoOriginal(img.src))
        .filter(Boolean);
    }
    if (!items.length) throw new Error('No downloadable media found');

    for (let i = 0; i < items.length; i++) {
      const { url, ext } = items[i];
      const suffix = items.length > 1 ? `_${i + 1}` : '';
      await sendMessage({
        type: 'dw-download',
        url,
        filename: `${owner.handle}_${owner.id}_${stamp}${suffix}.${ext}`,
      });
    }
  }

  function mediaFromTweet(tweet) {
    const out = [];
    for (const m of tweet.mediaDetails || []) {
      if (m.type === 'photo') {
        const photo = photoOriginal(m.media_url_https);
        if (photo) out.push(photo);
      } else if (m.type === 'video' || m.type === 'animated_gif') {
        const best = (m.video_info?.variants || [])
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (best) out.push({ url: best.url, ext: 'mp4' });
      }
    }
    return out;
  }

  // pbs.twimg.com/media/<key>.jpg or /media/<key>?format=jpg&name=small -> full size.
  function photoOriginal(src) {
    let u;
    try {
      u = new URL(src);
    } catch {
      return null;
    }
    if (u.hostname !== 'pbs.twimg.com' || !u.pathname.startsWith('/media/')) return null;
    const m = u.pathname.match(/^\/media\/([^./]+)(?:\.(\w+))?$/);
    if (!m) return null;
    const ext = m[2] || u.searchParams.get('format') || 'jpg';
    return { url: `https://pbs.twimg.com/media/${m[1]}?format=${ext}&name=orig`, ext };
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || res.error) return reject(new Error(res?.error || 'Request failed'));
        resolve(res.data ?? res.id);
      });
    });
  }

  // ---------- File name ----------

  function postInfo(article) {
    const userLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const handle = userLink?.getAttribute('href').split('/')[1] || 'unknown';

    const statusLinks = [...article.querySelectorAll('a[href*="/status/"]')].filter((a) =>
      a.querySelector('time')
    );
    const link =
      statusLinks.find((a) => a.getAttribute('href').startsWith(`/${handle}/status/`)) ||
      statusLinks[0];
    const id =
      link?.getAttribute('href').match(/\/status\/(\d+)/)?.[1] ||
      location.pathname.match(/\/status\/(\d+)/)?.[1] ||
      'unknown';
    return { handle, id };
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  }

  function download(canvas, name) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Could not encode PNG'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        resolve();
      }, 'image/png');
    });
  }
})();
