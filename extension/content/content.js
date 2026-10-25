// Content script for linkedin.com. Applies the layout controls (blank home,
// sidebars) and decides, post by post, what stays on the home feed:
//   1. modes (promoted, network activity, suggested)   instant
//   2. keywords                                        instant
//   3. AI filter (your own words)                      async, batched in background
(function () {
  const control = globalThis.control;
  const { linkedin, rules, panel } = control;
  const S = control.settings;

  const AI_TIMEOUT_MS = 30000;
  const html = document.documentElement;

  const state = {
    settings: null,
    compiledKeywords: [],
    aiKey: '',
    posts: new WeakMap(),
    generation: 0, // bumped on every settings change so posts are re-judged
    path: location.pathname,
    aiVerdicts: new Map(), // `${aiKey}:${urn}` -> { decision, reason }
    aiInflight: new Map(), // same key -> Promise
    lastAiError: null,
  };

  function log(...args) {
    if (state.settings && state.settings.debug) console.log('[out]', ...args);
  }

  // Hide the home page until settings load so "blank home" never flashes
  // the feed. Removed as soon as settings are applied (or after 2.5s).
  if (linkedin.isHomePath(location.pathname)) html.classList.add('control-booting');
  setTimeout(() => html.classList.remove('control-booting'), 2500);

  // ---------- layout (feature 4) ----------

  function applyLayout() {
    const s = state.settings;
    const onHome = linkedin.isHomePath(location.pathname);
    const on = (cond) => Boolean(s.enabled && onHome && cond);
    markLandmarks();
    html.classList.toggle('control-blank-home', on(s.layout.blankHome));
    html.classList.toggle('control-hide-left', on(s.layout.hideLeftSidebar));
    html.classList.toggle('control-hide-right', on(s.layout.hideRightSidebar));
    html.classList.toggle('control-debug', Boolean(s.debug));
    html.classList.remove('control-booting');
    html.setAttribute('data-control-ready', '');
  }

  // Tags the top bar and sidebars so the CSS can find them even when
  // LinkedIn's class names are hashed. Re-run on every scan because LinkedIn
  // re-renders; cheap when the tags are already in place.
  function markLandmarks() {
    if (!linkedin.isHomePath(location.pathname)) return;
    if (!document.querySelector('[data-control-nav]')) {
      const bar = linkedin.findTopBar();
      if (bar) bar.setAttribute('data-control-nav', '');
    }
    // Only blank the whole page when the top bar was found, so blank home can
    // never leave you without navigation.
    html.classList.toggle('control-has-nav', Boolean(document.querySelector('[data-control-nav]')));
    const l = state.settings.layout;
    const needLeft = (l.hideLeftSidebar || l.blankHome) && !document.querySelector('[data-control-sidebar="left"]');
    const needRight = (l.hideRightSidebar || l.blankHome) && !document.querySelector('[data-control-sidebar="right"]');
    if (needLeft || needRight) {
      const { left, right } = linkedin.findSidebars();
      if (needLeft) for (const el of left) el.setAttribute('data-control-sidebar', 'left');
      if (needRight) for (const el of right) el.setAttribute('data-control-sidebar', 'right');
    }
  }

  // ---------- post decorations ----------

  function placeholderOf(el) {
    const first = el.firstElementChild;
    return first && first.classList.contains('control-bar') ? first : null;
  }

  async function sendFeedback(el, action, decision, expectedRevision) {
    const post = state.posts.get(el);
    if (!post) return;
    const payload = { action, decision, expectedRevision, text: post.text, instructions: state.settings.aiFilter.instructions };
    try {
      const res = await chrome.runtime.sendMessage({ type: 'control:feedback', payload });
      if (!res || res.error) throw new Error(res && res.error || 'Feedback could not be saved');
      showFeedbackStatus(el, action === 'reset' ? 'Personal learning reset.' : action === 'undo' ? 'Correction undone.' : 'Preference saved on this device.', action === 'correct', res.revision);
    } catch (err) {
      showFeedbackStatus(el, err.message || 'Feedback failed. Try again.', false);
    }
  }

  function showFeedbackStatus(el, text, undo, revision) {
    el.querySelector('.control-feedback-status')?.remove();
    const status = document.createElement('div');
    status.className = 'control-feedback-status';
    status.setAttribute('role', 'status');
    status.textContent = text + ' ';
    if (undo) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Undo correction';
      button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); sendFeedback(el, 'undo', undefined, revision); };
      status.append(button);
    }
    (placeholderOf(el) || el).append(status);
  }

  function addFeedbackControls(el, parent, decision) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = decision === 'show' ? 'This should be shown' : 'Hide more like this';
    button.title = 'Teach your local filter. Saved only on this device.';
    button.onclick = (event) => {
      event.preventDefault(); event.stopPropagation();
      sendFeedback(el, 'correct', decision);
    };
    parent.append(button);
  }

  function personalActive() {
    return S.isAiActive(state.settings);
  }

  function syncFeedbackControls(el, post) {
    el.querySelector('.control-feedback-actions')?.remove();
    if (!post || !personalActive() || rules.evaluateRules(post, state.settings, state.compiledKeywords)) return;
    const status = el.getAttribute('data-control');
    if (!['shown', 'revealed', 'hidden'].includes(status)) return;
    const parent = status === 'hidden' ? placeholderOf(el) : el;
    if (!parent) return;
    const actions = document.createElement('span');
    actions.className = 'control-feedback-actions';
    addFeedbackControls(el, actions, status === 'hidden' ? 'show' : 'hide');
    parent.append(actions);
  }

  function setBar(el, kind, text) {
    let bar = placeholderOf(el);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'control-bar';
      const label = document.createElement('span');
      label.className = 'control-bar__label';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'control-bar__show';
      button.textContent = 'Show anyway';
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setAttribute('data-control-override', '1');
        el.setAttribute('data-control', 'revealed');
        bar.remove();
        syncFeedbackControls(el, state.posts.get(el));
      });
      bar.append(label, button);
      el.prepend(bar);
    }
    bar.dataset.kind = kind;
    const label = bar.querySelector('.control-bar__label');
    label.textContent = '';
    const brand = document.createElement('b');
    brand.textContent = 'out';
    label.append(brand, ' ' + text);
    bar.querySelector('.control-bar__show').hidden = kind === 'pending';
  }

  function markHidden(el, reason) {
    el.setAttribute('data-control', 'hidden');
    setBar(el, 'hidden', 'hid a post · ' + reason);
  }

  function markPending(el) {
    el.setAttribute('data-control', 'pending');
    setBar(el, 'pending', 'is checking this post…');
  }

  function markShown(el) {
    el.setAttribute('data-control', 'shown');
    const bar = placeholderOf(el);
    if (bar) bar.remove();
  }

  function clearPost(el) {
    el.removeAttribute('data-control');
    el.removeAttribute('data-control-sig');
    el.removeAttribute('data-control-urn');
    el.removeAttribute('data-control-reason');
    el.querySelector('.control-feedback-actions')?.remove();
    el.querySelector('.control-feedback-status')?.remove();
    const bar = placeholderOf(el);
    if (bar) bar.remove();
  }

  // ---------- deciding ----------

  function decide(el, post) {
    const s = state.settings;
    const ruled = rules.evaluateRules(post, s, state.compiledKeywords);
    if (ruled) {
      log('hide', ruled.kind, post.urn, ruled.reason);
      el.setAttribute('data-control-reason', ruled.reason);
      return markHidden(el, ruled.reason);
    }
    if (!S.isAiActive(s)) return markShown(el);

    const cacheKey = state.aiKey + ':' + post.urn + ':' + S.hash(post.text || '');
    const cached = state.aiVerdicts.get(cacheKey);
    if (cached) {
      if (cached.decision === 'hide') {
        el.setAttribute('data-control-reason', cached.reason);
        return markHidden(el, cached.reason);
      }
      return markShown(el);
    }
    if (s.aiFilter.holdWhileChecking) markPending(el);
    else markShown(el);
    requestVerdict(post, cacheKey);
  }

  function requestVerdict(post, cacheKey) {
    const generation = state.generation;
    if (state.aiInflight.has(cacheKey)) return;
    const message = {
      type: 'control:classify',
      item: { id: post.urn, author: post.author, text: post.text },
    };
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ decision: 'show', error: 'timeout' }), AI_TIMEOUT_MS),
    );
    const failed = (err) => ({ decision: 'show', error: String(err && err.message ? err.message : err) });
    let request;
    try {
      request = chrome.runtime.sendMessage(message).catch(failed);
    } catch (err) {
      // Throws synchronously when out was updated or reloaded while this
      // tab stayed open ("Extension context invalidated").
      request = Promise.resolve(failed(err));
    }
    const p = Promise.race([request, timeout]).then((res) => {
      if (generation !== state.generation) return;
      state.aiInflight.delete(cacheKey);
      res = res || { decision: 'show', error: 'no response' };
      if (!cacheKey.startsWith(state.aiKey + ':')) return; // settings changed meanwhile
      if (res.error) {
        // Fail open: an AI problem never hides posts. The error shows in the
        // popup; the post is retried after the next settings or key change.
        state.lastAiError = res.error;
        log('AI error', post.urn, res.error);
      } else {
        state.aiVerdicts.set(cacheKey, {
          decision: res.decision,
          reason: res.reason || 'Filtered by your prompt',
        });
      }
      // Update every element showing this post (LinkedIn may have swapped it).
      // Posts waiting on this verdict are 'pending' (blurred) or, with
      // "blur while checking" off, already 'shown'.
      for (const el of linkedin.findPosts(document)) {
        if (el.getAttribute('data-control-urn') !== post.urn) continue;
        const status = el.getAttribute('data-control');
        if (status !== 'pending' && status !== 'shown') continue;
        if (res.error) markShown(el);
        else el.removeAttribute('data-control-sig'); // re-judged from the cache on the next scan
      }
      scheduleScan();
    });
    state.aiInflight.set(cacheKey, p);
  }

  function processPost(el) {
    if (el.getAttribute('data-control-override') === '1') return;
    const s = state.settings;
    const sig = state.generation + '|' + linkedin.getElementKey(el);

    if (el.getAttribute('data-control-sig') === sig) {
      // Already judged. LinkedIn sometimes re-renders a post's children, which
      // removes our bar; put it back if so.
      const status = el.getAttribute('data-control');
      if (status === 'hidden' && !placeholderOf(el)) markHidden(el, el.getAttribute('data-control-reason') || 'Hidden');
      if (status === 'pending' && !placeholderOf(el)) markPending(el);
      if (!el.querySelector('.control-feedback-actions')) syncFeedbackControls(el, state.posts.get(el));
      return;
    }

    // New post, or a recycled element now showing a different post.
    if (el.hasAttribute('data-control')) clearPost(el);
    if (!s.enabled || !linkedin.isFeedPath(location.pathname)) return;
    // Nobody sees posts on a blank home page; don't spend AI calls on them.
    if (html.classList.contains('control-blank-home')) return;

    const post = linkedin.extractPost(el);
    if (!post.ready) return; // not rendered yet; the observer will call again
    state.posts.set(el, post);
    el.setAttribute('data-control-sig', sig);
    el.setAttribute('data-control-urn', post.urn);
    decide(el, post);
    syncFeedbackControls(el, post);
  }

  // ---------- scanning ----------

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 60);
  }

  function scan() {
    if (!state.settings) return;
    if (location.pathname !== state.path) {
      state.path = location.pathname;
      applyLayout();
    } else {
      markLandmarks();
    }
    for (const el of linkedin.findPosts(document)) processPost(el);
    panel.sync();
  }

  // ---------- keep the feed loading ----------
  //
  // LinkedIn loads the next page when the empty element at the end of the
  // feed comes within 2000px of the screen, and only at the moment it comes
  // in (IntersectionObserver). With most posts collapsed to bars the feed is
  // so short that the element never leaves that zone, so it never comes in
  // again and the feed stops loading: scrolling can't help (you're already at
  // the bottom) and neither can "Show anyway" (one post doesn't push it out).
  // So when the end of the feed is near and nothing has arrived for a moment,
  // hide that element for one frame: LinkedIn sees it come in and loads more.

  const STALL_MS = 1000; // no new posts for this long while the end is near
  const NUDGES_PER_SCROLL = 12; // auto-loads before waiting for the user to scroll again
  const feedLoad = { count: -1, changedAt: 0, nudgedAt: 0, budget: NUDGES_PER_SCROLL };

  function keepFeedLoading() {
    const s = state.settings;
    if (!s || !s.enabled || document.hidden || !linkedin.isFeedPath(location.pathname)) return;
    if (html.classList.contains('control-blank-home')) return;
    // LinkedIn copes on its own until out has collapsed something.
    if (!document.querySelector('[data-control="hidden"]')) return;
    const now = Date.now();
    const count = linkedin.findPosts(document).length;
    if (count !== feedLoad.count) {
      feedLoad.count = count;
      feedLoad.changedAt = now;
      return;
    }
    if (now - feedLoad.changedAt < STALL_MS || now - feedLoad.nudgedAt < STALL_MS || feedLoad.budget <= 0) return;
    const { trigger, button } = linkedin.findFeedEnd();
    const end = button || trigger;
    // Only when the end of the feed is within about a screen of being seen.
    if (!end || end.getBoundingClientRect().top > innerHeight * 2) return;
    feedLoad.nudgedAt = now;
    feedLoad.budget--;
    log('feed stalled at', count, 'posts; asking LinkedIn for more');
    if (button && button.getClientRects().length) {
      button.click();
    } else if (trigger) {
      const value = trigger.style.getPropertyValue('display');
      const priority = trigger.style.getPropertyPriority('display');
      trigger.style.setProperty('display', 'none', 'important');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (value) trigger.style.setProperty('display', value, priority);
          else trigger.style.removeProperty('display');
        }),
      );
    }
  }

  // Scrolling, or trying to at the bottom of a short feed, means "keep going".
  // Only real input counts: layout shifts fire scroll events too, and an idle
  // tab shouldn't keep loading LinkedIn forever.
  function refillBudget() {
    feedLoad.budget = NUDGES_PER_SCROLL;
  }

  function resetAll() {
    for (const el of document.querySelectorAll('[data-control], [data-control-override]')) {
      el.removeAttribute('data-control-override');
      clearPost(el);
    }
  }

  function applySettings(settings) {
    state.settings = settings;
    state.generation++;
    state.aiVerdicts.clear();
    state.aiInflight.clear();
    state.compiledKeywords = rules.compileKeywords(settings.keywords.list);
    state.aiKey = S.aiConfigKey(settings.aiFilter);
    state.lastAiError = null;
    applyLayout();
    resetAll();
    scan();
  }

  // ---------- stats for the popup and the on-page panel ----------

  function stats() {
    const count = (v) => document.querySelectorAll(`[data-control="${v}"]`).length;
    return {
      onFeed: linkedin.isFeedPath(location.pathname),
      hidden: count('hidden'),
      pending: count('pending'),
      shown: count('shown') + count('revealed'),
      aiError: state.lastAiError,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'control:stats') return;
    sendResponse(stats());
  });

  // ---------- boot ----------

  panel.init({ settings: () => state.settings, stats, aiError: () => state.lastAiError });
  S.load().then((settings) => {
    applySettings(settings);
    new MutationObserver(scheduleScan).observe(html, { childList: true, subtree: true });
    // LinkedIn is a single-page app; catch navigations that don't mutate much.
    setInterval(() => {
      if (location.pathname !== state.path) scan();
    }, 500);
    setInterval(keepFeedLoading, 250);
    for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
      document.addEventListener(type, refillBudget, { capture: true, passive: true });
    }
  });
  S.onChange(applySettings);
  // A correction saved in any tab, or a reset in settings, re-judges the feed.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.controlFeedbackRevision && state.settings) applySettings(state.settings);
  });
})();
