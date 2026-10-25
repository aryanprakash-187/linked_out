// Everything that knows about LinkedIn's markup lives here. When LinkedIn
// changes its DOM, this is the file to update.
//
// LinkedIn has shipped two very different feed markups:
//   - classic: semantic classes (feed-shared-update-v2, update-components-*,
//     scaffold-layout__*) and data-id/data-urn URNs on each post
//   - 2026: hashed class names that change every build; posts are
//     [data-testid="mainFeed"] [role="listitem"][componentkey]
// So class names are only used as a first try. Everything has a fallback
// based on structure and visible text, which survives class renames.
(function (root) {
  const control = (root.control = root.control || {});

  // One entry per feed post. The outermost match is treated as the post.
  const POST_SELECTOR = [
    '[data-testid="mainFeed"] [role="listitem"][componentkey]',
    '[data-id^="urn:li:activity:"]',
    '[data-id^="urn:li:aggregate:"]',
    '[data-urn^="urn:li:activity:"]',
    'article[data-urn]',
    '[role="article"][data-urn]',
    'div.feed-shared-update-v2',
  ].join(',');

  const FEED_SELECTOR = '[data-testid="mainFeed"], .scaffold-finite-scroll';
  const HEADER_SELECTOR = '.update-components-header, .feed-shared-header';
  const ACTOR_SELECTOR = '.update-components-actor, .feed-shared-actor';
  const AUTHOR_SELECTOR = '.update-components-actor__title, .update-components-actor__name, .feed-shared-actor__name';
  const TEXT_SELECTOR = [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '.update-components-article__title',
    '.update-components-article__subtitle',
    '.update-components-document__title',
  ].join(',');

  // Posts are filtered on the home feed only. Signed-in linkedin.com/ shows
  // the feed too.
  function isHomePath(pathname) {
    return pathname === '/' || /^\/feed\/?$/.test(pathname);
  }
  const isFeedPath = isHomePath;

  function findPosts(scope) {
    const out = [];
    for (const el of scope.querySelectorAll(POST_SELECTOR)) {
      const parent = el.parentElement;
      if (!parent || !parent.closest(POST_SELECTOR)) out.push(el);
    }
    return out;
  }

  // innerText skips text hidden by CSS; fall back to textContent when the
  // element isn't rendered. \s also matches the &nbsp; LinkedIn sprinkles in.
  function readText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function lines(el) {
    return (el.innerText || el.textContent || '')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // Text of every match, skipping matches nested inside an earlier one.
  function readAll(scope, selector) {
    const parts = [];
    const seen = [];
    for (const el of scope.querySelectorAll(selector)) {
      if (seen.some((s) => s.contains(el))) continue;
      seen.push(el);
      const t = readText(el);
      if (t) parts.push(t);
    }
    return parts.join('\n');
  }

  const URN_RE = /urn:li:(?:activity|ugcPost|share|aggregate|sponsoredContent|fsd_update)[:(][\w:(),-]+/;

  // A stable id for the post if the markup carries one (data-id, data-urn,
  // or a URN embedded in componentkey). Used to cache verdicts.
  function getUrn(el) {
    for (const node of [el, el.querySelector('[data-urn], [data-id]')]) {
      if (!node) continue;
      for (const attr of ['data-id', 'data-urn', 'componentkey']) {
        const v = node.getAttribute(attr);
        const m = v && v.match(URN_RE);
        if (m) return m[0];
        if (v && attr !== 'componentkey') return v;
      }
    }
    return '';
  }

  // Changes whenever LinkedIn reuses an element for a different post.
  function getElementKey(el) {
    return getUrn(el) || el.getAttribute('componentkey') || '';
  }

  // "Promoted" is a short label under the author's name, sometimes joined to
  // other text with " • ". Check the actor block if we can find it, otherwise
  // the first leaf elements of the post.
  function detectPromoted(el, urn) {
    if (/sponsored/i.test(urn)) return true;
    const isPromotedLabel = control.rules.isPromotedLabel;
    const scope = el.querySelector(ACTOR_SELECTOR) || el;
    let checked = 0;
    for (const node of scope.querySelectorAll('span, div, p, a')) {
      if (node.firstElementChild) continue;
      const text = node.textContent || '';
      if (text.length < 80 && text.split('•').some(isPromotedLabel)) return true;
      if (++checked > 80) break;
    }
    return false;
  }

  // The "Sam likes this" / "Suggested" line above a post. Classic markup has
  // a class for it; otherwise it is one of the first visible lines.
  function readHeader(el) {
    const header = el.querySelector(HEADER_SELECTOR);
    if (header) return readText(header);
    for (const line of lines(el).slice(0, 3)) {
      if (control.rules.classifyHeader(line)) return line;
    }
    return '';
  }

  function readAuthor(el, headerText) {
    const authorEl = el.querySelector(AUTHOR_SELECTOR);
    if (authorEl) {
      // LinkedIn renders names twice: a visible aria-hidden copy and a
      // screen-reader copy. Read the visible one.
      const visible = authorEl.querySelector('[aria-hidden="true"]') || authorEl;
      return readText(visible).split(' • ')[0];
    }
    // Unknown markup: the first profile/company link that isn't part of the
    // "Sam likes this" header.
    for (const a of el.querySelectorAll('a[href*="/in/"], a[href*="/company/"], a[href*="/school/"]')) {
      const name = readText(a).split(' • ')[0];
      if (name && name.length < 80 && !(headerText && headerText.includes(name))) return name;
    }
    return '';
  }

  // Lines of LinkedIn chrome around a post: buttons, counts, timestamps,
  // screen-reader headings. Dropped so a keyword like "comment" or "send"
  // doesn't match every post.
  const UI_LINE_RE = new RegExp(
    '^(?:' +
      [
        'like',
        'comment',
        'repost',
        'send',
        'share',
        'save',
        '\\+?\\s*follow',
        'following',
        'promoted',
        'edited',
        '•',
        '…\\s*(?:see )?more',
        'see (?:more|less|translation)',
        'show translation',
        'feed post(?: number \\d+)?',
        'view (?:job|profile|my newsletter)',
        '[\\d,.]+\\s*[km]?\\s*(?:comments?|reposts?|reactions?|likes?|followers?)?',
        '\\d+\\s*(?:s|m|h|d|w|mo|y|yr)\\b.*',
      ].join('|') +
      ')$',
    'i',
  );

  // Unknown markup: the post's visible lines minus the header, the author
  // line and LinkedIn's buttons and counters.
  function fallbackText(el, headerText, author) {
    return lines(el)
      .filter((l) => l !== headerText && l !== author && !UI_LINE_RE.test(l))
      .join('\n');
  }

  // Returns a plain object describing the post. `ready` is false while
  // LinkedIn hasn't rendered the post's content yet (it lazy-loads them).
  function extractPost(el) {
    const headerText = readHeader(el);
    const author = readAuthor(el, headerText);
    let text = readAll(el, TEXT_SELECTOR);
    if (!text) text = fallbackText(el, headerText, author);
    let urn = getUrn(el);
    if (!urn && text) urn = 'text:' + control.settings.hash(text.slice(0, 400));
    return {
      urn,
      author,
      text,
      headerText,
      headerKind: control.rules.classifyHeader(headerText),
      isPromoted: detectPromoted(el, urn),
      ready: Boolean(text),
    };
  }

  // ---------- layout landmarks for the home page controls ----------

  const NAV_SELECTOR = '#global-nav, .global-nav';
  const NAV_LINKS = 'a[href*="/mynetwork/"], a[href*="/jobs/"], a[href*="/messaging/"]';

  // The top bar with Home / My Network / Jobs / Messaging. Found by class if
  // possible, otherwise by walking up from its links to the widest element
  // that is still a short bar at the top of the page.
  function findTopBar() {
    const known = document.querySelector(NAV_SELECTOR);
    if (known) return known;
    // Posts can link to /jobs/ too, so try candidates until one sits in a
    // bar at the top of the viewport.
    const links = [...document.querySelectorAll(NAV_LINKS)].slice(0, 30);
    for (const link of links) {
      let best = null;
      for (let node = link.parentElement; node && node !== document.body; node = node.parentElement) {
        // Stop once the element is no longer a short strip at the top.
        const r = node.getBoundingClientRect();
        if (r.top > 100 || r.bottom > 160 || !r.width) break;
        best = node;
      }
      if (best && best.querySelectorAll(NAV_LINKS).length >= 2) return best;
    }
    return null;
  }

  // Left and right columns next to the feed. Found by class if possible,
  // otherwise by position relative to the feed's column.
  function findSidebars() {
    const left = document.querySelector('.scaffold-layout__sidebar');
    const right = document.querySelector('.scaffold-layout__aside');
    if (left || right) return { left: left ? [left] : [], right: right ? [right] : [] };
    const feed = document.querySelector(FEED_SELECTOR) || findPosts(document)[0] || null;
    const out = { left: [], right: [] };
    if (!feed) return out;
    // Walk up until the feed's column sits beside sibling columns.
    for (let col = feed; col && col.parentElement && col !== document.body; col = col.parentElement) {
      const c = col.getBoundingClientRect();
      for (const sib of col.parentElement.children) {
        if (sib === col || sib.matches('script, style, template')) continue;
        const r = sib.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const overlapsVertically = r.top < c.bottom && r.bottom > c.top;
        if (!overlapsVertically) continue;
        if (r.right <= c.left + 1) out.left.push(sib);
        else if (r.left >= c.right - 1) out.right.push(sib);
      }
      if (out.left.length || out.right.length) return out;
    }
    return out;
  }

  control.linkedin = {
    POST_SELECTOR,
    isFeedPath,
    isHomePath,
    findPosts,
    extractPost,
    getUrn,
    getElementKey,
    findTopBar,
    findSidebars,
  };
})(globalThis);
