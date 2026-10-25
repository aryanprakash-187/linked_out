// The "out" button just before LinkedIn's logo, and the glass panel it opens: the
// popup's switches plus "Describe what you want", on the page itself. Both
// live in shadow roots (styles in panel-style.js). content.js calls sync()
// after every scan. The panel only saves settings; the change comes back to
// content.js through settings.onChange, as a change made in the popup would.
(function (root) {
  const control = (root.control = root.control || {});
  const S = control.settings;
  const { linkedin } = control;

  const LABEL = 'out';
  const GAP = 8; // px between LinkedIn's logo and the button
  const RETRY_MS = 1000; // how often to look for the logo while it's missing
  const FALLBACK_AFTER_MS = 3000; // after page load, before floating the button instead
  const RELOADED = 'out was updated or reloaded. Refresh this page to keep using it.';
  const SAVE_KEYS = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+Enter';

  // [settings path, label, tooltip]
  const GROUPS = [
    {
      title: 'Hide in feed',
      chips: [
        ['modes.hidePromoted', 'Promoted', 'Ads in your feed'],
        ['modes.hideSocialActivity', 'Network activity', '“Jane likes this”, “Sam commented on this”, “Alex reposted this”'],
        ['modes.hideSuggested', 'Suggested', 'Posts LinkedIn recommends from people you don’t follow'],
        ['keywords.enabled', 'Keywords', 'Posts containing any of your keywords'],
      ],
    },
    {
      title: 'Hide on home page',
      chips: [
        ['layout.blankHome', 'Everything', 'A blank home page. Only the top bar stays.'],
        ['layout.hideLeftSidebar', 'Left sidebar', 'Your profile card and shortcuts'],
        ['layout.hideRightSidebar', 'Right sidebar', 'LinkedIn News, puzzles, ads'],
      ],
    },
  ];

  const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
  const set = (obj, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  };

  let source = null; // { settings(), stats(), aiError() } from content.js
  let buttonHost = null;
  let button = null;
  let panelHost = null;
  const el = {}; // the panel's elements
  let isOpen = false;
  let inNav = false; // false while missing or floating in the corner
  let loadedAt = 0;
  let lastTry = 0;
  let reinserts = []; // times LinkedIn removed the button and it was put back
  let shownInstructions = ''; // what the textarea was last filled with
  let notice = null; // { text, warn }, shown under the instructions for a moment
  let noticeTimer = null;
  let fatal = ''; // the extension was reloaded under this page
  let storedError = '';

  // ---------- helpers ----------

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  function makeHost(id) {
    const host = h('div', { id });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(h('style', { text: control.panelStyle }));
    return [host, shadow];
  }

  // LinkedIn's dark mode is a site setting, not the OS one, so look at the
  // colour the top bar is actually painted.
  function isDark(node) {
    for (; node && node.nodeType === 1; node = node.parentElement) {
      const rgba = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (rgba.length < 3 || rgba[3] === 0) continue;
      return 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2] < 128;
    }
    return false;
  }

  function setTheme(node) {
    const theme = isDark(node) ? 'dark' : 'light';
    buttonHost.setAttribute('data-theme', theme);
    if (panelHost) panelHost.setAttribute('data-theme', theme);
  }

  // ---------- the button ----------

  function createButton() {
    let shadow;
    [buttonHost, shadow] = makeHost('control-out');
    button = h('button', {
      class: 'out',
      type: 'button',
      title: 'out',
      'aria-label': 'out: feed filters',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      text: LABEL,
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    shadow.append(button);
  }

  // Puts the button just before LinkedIn's logo ("out" then "in"), at the
  // logo's height. Returns false (and leaves the button out) if there's no
  // logo or the button wouldn't end up beside it.
  function placeInNav() {
    const bar = document.querySelector('[data-control-nav]') || linkedin.findTopBar();
    const spot = bar && linkedin.findLogo(bar);
    if (!spot) return false;
    const size = Math.min(44, Math.max(28, Math.round(spot.box.height)));
    const radius = parseFloat(getComputedStyle(spot.logo).borderTopLeftRadius) || size * 0.12;
    buttonHost.removeAttribute('data-floating');
    buttonHost.style.setProperty('--h', size + 'px');
    buttonHost.style.setProperty('--r', Math.round(radius) + 'px');
    buttonHost.style.marginRight = '';
    spot.el.before(buttonHost);

    // The logo moved right to make room, so measure both again.
    const r = buttonHost.getBoundingClientRect();
    const box = spot.logo.getBoundingClientRect();
    const middle = (rect) => rect.top + rect.height / 2;
    const beside = r.width > 0 && r.right <= box.left + 1 && Math.abs(middle(r) - middle(box)) < box.height / 2;
    if (!beside) {
      buttonHost.remove();
      return false;
    }
    // Whatever spacing LinkedIn's layout gives it, sit GAP px from the logo.
    const gap = box.left - r.right;
    if (Math.abs(gap - GAP) > 1) buttonHost.style.marginRight = `${4 + GAP - gap}px`;
    setTheme(bar);
    return true;
  }

  function placeFloating() {
    buttonHost.setAttribute('data-floating', '');
    buttonHost.style.setProperty('--h', '34px');
    buttonHost.style.setProperty('--r', '8px');
    buttonHost.style.marginRight = '';
    document.documentElement.append(buttonHost);
    setTheme(document.body);
  }

  function placeButton() {
    if (!buttonHost) createButton();
    if (inNav && buttonHost.isConnected) return;
    const now = Date.now();
    if (inNav) {
      // LinkedIn re-rendered its top bar and dropped the button. If that keeps
      // happening, stop fighting it and float the button instead.
      reinserts = reinserts.filter((t) => now - t < 10000);
      reinserts.push(now);
      inNav = false;
    } else if (now - lastTry < RETRY_MS) {
      return;
    }
    lastTry = now;
    if (reinserts.length <= 8 && placeInNav()) {
      inNav = true;
      if (isOpen) position();
      return;
    }
    if (buttonHost.isConnected) return; // already floating
    // Floating is a fallback for the home feed. Give LinkedIn a moment to
    // render its top bar first so the button doesn't jump.
    if (linkedin.isHomePath(location.pathname) && now - loadedAt >= FALLBACK_AFTER_MS) placeFloating();
  }

  // ---------- the panel ----------

  function buildPanel() {
    let shadow;
    [panelHost, shadow] = makeHost('control-out-panel');

    el.title = h('p', { class: 'title' });
    el.sub = h('p', { class: 'sub' });
    el.master = h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-label': 'out on',
      'data-path': 'enabled',
    });
    el.error = h('p', { class: 'error', role: 'alert' });

    el.chips = [];
    const sections = GROUPS.map((group) => {
      const chips = h('div', { class: 'chips' });
      for (const [path, label, tip] of group.chips) {
        const chip = h('button', { class: 'chip', type: 'button', title: tip, 'data-path': path }, label);
        if (path === 'keywords.enabled') {
          el.keywordCount = h('span', { class: 'n' });
          chip.append(el.keywordCount);
        }
        el.chips.push(chip);
        chips.append(chip);
      }
      return h('section', {}, h('h3', { text: group.title }), chips);
    });

    el.ai = h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-label': 'Filter with AI',
      'data-path': 'aiFilter.enabled',
    });
    el.text = h('textarea', {
      rows: '3',
      'aria-label': 'Describe what you want',
      placeholder: 'Only bioinformatics and genomics.\nNo humblebrags or engagement bait.',
    });
    el.understood = h('div', { class: 'understood' });
    el.hint = h('span', { class: 'hint', 'aria-live': 'polite' });
    el.save = h('button', { class: 'save', type: 'button', text: 'Save' });
    const ask = h(
      'section',
      { class: 'ask' },
      h('div', { class: 'ask-head' }, h('h3', { text: 'Describe what you want' }), el.ai),
      el.text,
      el.understood,
      h('div', { class: 'ask-foot' }, el.hint, el.save),
    );

    el.panel = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'out', tabindex: '-1' },
      h('header', { class: 'head' }, h('div', {}, el.title, el.sub), el.master),
      el.error,
      h('div', { class: 'groups' }, ...sections, ask),
      h(
        'footer',
        {},
        h('button', { class: 'link', type: 'button', 'data-open': '#keywords', text: 'Edit keywords' }),
        h('button', { class: 'link', type: 'button', 'data-open': '', text: 'All settings' }),
      ),
    );

    el.panel.addEventListener('click', onPanelClick);
    el.text.addEventListener('input', () => {
      setNotice(null);
      renderAsk();
    });
    el.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveInstructions();
      }
    });
    // Typing here is for us, not for LinkedIn's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      el.panel.addEventListener(type, (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
      });
    }

    shownInstructions = source.settings().aiFilter.instructions;
    el.text.value = shownInstructions;
    shadow.append(el.panel);
    document.documentElement.append(panelHost);
  }

  function statusLines(s, stats) {
    if (!s.enabled) return ['Paused', 'LinkedIn looks the way LinkedIn wants.'];
    if (!stats.onFeed) return ['Filtering your home feed', 'Other pages are left alone.'];
    if (s.layout.blankHome) return ['Home page is blank', 'Use the top bar to go where you meant to go.'];
    const total = stats.hidden + stats.shown + stats.pending;
    const sub = [`of ${total} on this page`];
    if (stats.pending) sub.push(`${stats.pending} being checked`);
    return [`${stats.hidden} ${stats.hidden === 1 ? 'post' : 'posts'} hidden`, sub.join(' · ')];
  }

  function aiMissing(s) {
    if (!s.aiFilter.instructions.trim()) return 'Write what you want, then Save.';
    return '';
  }

  function render() {
    const s = source.settings();
    if (!el.panel || !s) return;
    const [title, sub] = statusLines(s, source.stats());
    el.title.textContent = title;
    el.sub.textContent = sub;
    el.master.setAttribute('aria-checked', String(s.enabled));
    el.panel.classList.toggle('off', !s.enabled);
    for (const chip of el.chips) chip.setAttribute('aria-pressed', String(Boolean(get(s, chip.dataset.path))));
    el.keywordCount.textContent = String(s.keywords.list.length);
    el.ai.setAttribute('aria-checked', String(s.aiFilter.enabled));

    // Follow changes made in the popup or settings page, unless there's a draft.
    const saved = s.aiFilter.instructions;
    if (saved !== shownInstructions && el.text.value.trim() === shownInstructions.trim()) el.text.value = saved;
    shownInstructions = saved;

    const aiError = S.isAiActive(s) && (storedError || source.aiError());
    const error = fatal || (aiError ? `AI filter: ${aiError} Posts are shown until it works.` : '');
    el.error.textContent = error;
    el.error.hidden = !error;
    renderAsk();
  }

  // The hint under the instructions, and how the on-device filter reads them
  // (live, as you type).
  function renderAsk() {
    const s = source.settings();
    const draft = el.text.value.trim();
    const dirty = draft !== s.aiFilter.instructions.trim();
    el.save.disabled = !dirty;

    el.understood.textContent = '';
    if (draft) {
      const intent = control.intent.parseInstructions(draft);
      const add = (prefix, items) => {
        if (items.length) el.understood.append(h('div', {}, h('b', { text: prefix }), ' ' + items.join(' · ')));
      };
      add('Only show:', intent.only ? intent.show.map((t) => t.label) : []);
      add('Hide:', intent.hide.map((t) => t.label));
      add('Never hidden for:', intent.more);
    }
    el.understood.hidden = !el.understood.childElementCount;

    const missing = s.aiFilter.enabled && aiMissing(s);
    let hint = { text: 'Runs on your computer.' };
    if (dirty) hint = { text: `Unsaved · ${SAVE_KEYS} to save` };
    else if (missing) hint = { text: missing, warn: true };
    else if (notice) hint = notice;
    el.hint.textContent = hint.text;
    el.hint.classList.toggle('warn', Boolean(hint.warn));
  }

  function setNotice(next) {
    notice = next;
    clearTimeout(noticeTimer);
    if (next) {
      noticeTimer = setTimeout(() => {
        notice = null;
        if (el.panel) renderAsk();
      }, 2500);
    }
  }

  // Next to the button: below it in the top bar, above it when floating at
  // the bottom of the screen.
  function position() {
    if (!el.panel) return;
    const r = button.getBoundingClientRect();
    const p = el.panel;
    const width = p.offsetWidth;
    p.style.left = Math.max(12, Math.min(r.left, innerWidth - width - 12)) + 'px';
    if (r.top > innerHeight / 2) {
      p.style.top = 'auto';
      p.style.bottom = innerHeight - r.top + 10 + 'px';
      p.style.maxHeight = r.top - 22 + 'px';
      p.style.transformOrigin = 'bottom left';
    } else {
      const top = Math.max(r.bottom, 0) + 10;
      p.style.bottom = 'auto';
      p.style.top = top + 'px';
      p.style.maxHeight = innerHeight - top - 12 + 'px';
      p.style.transformOrigin = 'top left';
    }
  }

  // ---------- actions ----------

  // Saves a changed copy of the settings. content.js re-applies them via
  // settings.onChange, which re-renders this panel.
  async function update(change) {
    const next = structuredClone(source.settings());
    change(next);
    try {
      await S.save(next);
    } catch {
      fatal = RELOADED;
      render();
    }
  }

  function onPanelClick(e) {
    const target = e.target.closest('button');
    if (!target) return;
    if (target === el.save) return saveInstructions();
    if (target.hasAttribute('data-open')) return openSettings(target.getAttribute('data-open'));
    const path = target.dataset.path;
    if (!path) return;
    const s = source.settings();
    const value = !get(s, path);
    if (path === 'aiFilter.enabled' && value && !s.aiFilter.instructions.trim()) {
      // Nothing to filter with yet. Saving a draft turns the filter on.
      if (el.text.value.trim()) return saveInstructions();
      setNotice({ text: 'Write what you want first.', warn: true });
      renderAsk();
      el.text.focus();
      return;
    }
    // Flip it now; the saved settings confirm it a moment later.
    target.setAttribute(target.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(value));
    update((next) => set(next, path, value));
  }

  async function saveInstructions() {
    const text = el.text.value.trim();
    if (text === source.settings().aiFilter.instructions.trim()) return;
    setNotice({ text: text ? 'Saved. Re-checking your feed…' : 'Cleared.' });
    await update((next) => {
      next.aiFilter.instructions = text;
      // Writing instructions is a clear signal they want the filter on.
      if (text) next.aiFilter.enabled = true;
    });
  }

  function openSettings(hash) {
    try {
      chrome.runtime.sendMessage({ type: 'control:open-options', hash }).catch(() => {});
    } catch {
      fatal = RELOADED;
      render();
    }
  }

  // The last error the background reported.
  async function refreshStored() {
    try {
      const status = (await chrome.storage.local.get(S.STATUS_KEY))[S.STATUS_KEY] || {};
      storedError = (status.lastError && status.lastError.message) || '';
    } catch {
      return; // extension reloaded; nothing to refresh
    }
    if (isOpen) render();
  }

  // ---------- open / close ----------

  function onPointerDown(e) {
    const path = e.composedPath();
    if (!path.includes(panelHost) && !path.includes(buttonHost)) toggle(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') toggle(false);
  }

  function toggle(force) {
    const open = force === undefined ? !isOpen : Boolean(force);
    if (open === isOpen || !source.settings()) return;
    isOpen = open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!panelHost) buildPanel();
      panelHost.setAttribute('data-theme', buttonHost.getAttribute('data-theme') || 'light');
      render();
      position(); // also lays the panel out, so the opening animation runs
      el.panel.classList.add('open');
      el.panel.focus({ preventScroll: true });
      refreshStored();
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', position);
      window.addEventListener('scroll', position, { capture: true, passive: true });
    } else {
      el.panel.classList.remove('open');
      if (panelHost.shadowRoot.activeElement) button.focus({ preventScroll: true });
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, { capture: true });
    }
  }

  // ---------- entry points for content.js ----------

  // Called after every scan: keeps the button in place and the panel current.
  function sync() {
    const s = source && source.settings();
    // Wait for LinkedIn's app to finish loading before touching its top bar.
    if (!s || document.readyState !== 'complete') return;
    placeButton();
    buttonHost.toggleAttribute('data-off', !s.enabled);
    if (isOpen) render();
  }

  function init(src) {
    source = src;
    const ready = () => {
      loadedAt = Date.now();
      sync();
      setTimeout(sync, FALLBACK_AFTER_MS + 50);
    };
    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready, { once: true });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[S.STATUS_KEY]) refreshStored();
    });
  }

  control.panel = { init, sync, toggle };
})(globalThis);
