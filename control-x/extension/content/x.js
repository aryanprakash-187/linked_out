// X home-timeline adapter. Reads only the outer post's own text.
// Images, videos, OCR, quoted posts, link cards, DMs and other pages are not classified.
(function (root) {
  const control = (root.control = root.control || {});
  const POST_SELECTOR = 'article[data-testid="tweet"]';
  const read = (node) => (node && node.textContent || '').trim();
  const isHomePath = (path) => /^\/home\/?$/.test(path);
  function findPosts(scope) {
    return [...scope.querySelectorAll(POST_SELECTOR)].filter((node) => !node.parentElement?.closest(POST_SELECTOR));
  }
  function quoted(node, post) {
    for (let parent = node.parentElement; parent && parent !== post; parent = parent.parentElement) {
      if (parent.matches('[data-testid="quoteTweet"], [data-testid="card.wrapper"], [role="link"]')) return true;
    }
    return false;
  }
  function own(post, selector) {
    return [...post.querySelectorAll(selector)].filter((node) =>
      node.closest(POST_SELECTOR) === post && !quoted(node, post));
  }
  function getUrn(post) {
    for (const time of own(post, 'time')) {
      const link = time.closest('a[href*="/status/"]');
      const id = link?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1];
      if (id) return 'x:' + id;
    }
    return '';
  }
  function textOf(post) { return own(post, '[data-testid="tweetText"]').map(read).filter(Boolean).join('\n'); }
  function getElementKey(post) {
    return getUrn(post) + ':' + control.settings.hash(textOf(post));
  }
  function extractPost(post) {
    const text = textOf(post);
    const urn = getUrn(post);
    return {
      urn: urn || 'x:text:' + control.settings.hash(text),
      text, author: own(post, '[data-testid="User-Name"]').map(read).join(' '),
      headerText: '', headerKind: null, isPromoted: false,
      ready: Boolean(text),
    };
  }
  control.x = {
    POST_SELECTOR, isHomePath, isFeedPath: isHomePath, findPosts, getUrn, getElementKey, extractPost,
    // Layout removal is outside this text-only MVP.
    findTopBar: () => null, findSidebars: () => ({ left: [], right: [] }),
  };
})(globalThis);
