// Settings shared by every part of the extension (content script, background,
// popup, options). Loaded as a classic script, so everything hangs off
// globalThis.control instead of using ES module exports.
(function (root) {
  const control = (root.control = root.control || {});

  // TODO(keywords): placeholders only. Replace with the real list once decided.
  const PLACEHOLDER_KEYWORDS = ['internship', 'thrilled to announce', 'agree?'];

  const MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
  ];

  const DEFAULTS = {
    enabled: true,
    // Feature 1: structural modes, no AI involved.
    modes: {
      hidePromoted: true,
      hideSocialActivity: true, // "X likes this", "X commented on this", ...
      hideSuggested: false,
    },
    // Feature 2: keyword filter.
    keywords: {
      enabled: true,
      list: PLACEHOLDER_KEYWORDS.slice(),
    },
    // Feature 3: natural-language filter judged by an LLM.
    aiFilter: {
      enabled: false,
      instructions: '',
      provider: 'anthropic', // 'anthropic' | 'chrome-ai'
      model: 'claude-opus-5-5',
      holdWhileChecking: true,
    },
    // Feature 4: Unhook-style layout controls for the home page.
    layout: {
      blankHome: false,
      hideLeftSidebar: false,
      hideRightSidebar: false,
    },
    debug: false,
  };

  const SETTINGS_KEY = 'controlSettings';
  // API keys live in storage.local only, never in storage.sync.
  const SECRETS_KEY = 'controlSecrets';
  const STATUS_KEY = 'controlStatus';

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Deep-merges stored values over defaults. Arrays and scalars replace;
  // unknown keys in `stored` are dropped so old settings can't leak through.
  function merge(defaults, stored) {
    if (!isPlainObject(stored)) return structuredClone(defaults);
    const out = {};
    for (const key of Object.keys(defaults)) {
      const d = defaults[key];
      const s = stored[key];
      if (isPlainObject(d)) out[key] = merge(d, s);
      else if (s === undefined || (Array.isArray(d) && !Array.isArray(s))) out[key] = structuredClone(d);
      else if (typeof d !== 'object' && typeof s !== typeof d) out[key] = d;
      else out[key] = structuredClone(s);
    }
    return out;
  }

  function syncArea() {
    // Safari and some Chromium forks may not expose storage.sync.
    return (root.chrome && chrome.storage && (chrome.storage.sync || chrome.storage.local)) || null;
  }

  async function load() {
    const area = syncArea();
    if (!area) return structuredClone(DEFAULTS);
    const got = await area.get(SETTINGS_KEY);
    return merge(DEFAULTS, got[SETTINGS_KEY]);
  }

  async function save(settings) {
    const clean = merge(DEFAULTS, settings);
    await syncArea().set({ [SETTINGS_KEY]: clean });
    return clean;
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[SETTINGS_KEY]) callback(merge(DEFAULTS, changes[SETTINGS_KEY].newValue));
    });
  }

  async function loadSecrets() {
    const got = await chrome.storage.local.get(SECRETS_KEY);
    return Object.assign({ anthropicApiKey: '', anthropicBaseUrl: '' }, got[SECRETS_KEY]);
  }

  async function saveSecrets(secrets) {
    await chrome.storage.local.set({ [SECRETS_KEY]: secrets });
  }

  // FNV-1a, 32-bit. Only used to build cache keys, not for anything secure.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // Identifies one configuration of the AI filter. A cached verdict is only
  // reused while the instructions, provider and model are unchanged.
  function aiConfigKey(aiFilter) {
    return hash([aiFilter.provider, aiFilter.model, aiFilter.instructions.trim()].join('\u0000'));
  }

  function isAiActive(settings) {
    return Boolean(settings.enabled && settings.aiFilter.enabled && settings.aiFilter.instructions.trim());
  }

  control.settings = {
    DEFAULTS,
    MODELS,
    PLACEHOLDER_KEYWORDS,
    SETTINGS_KEY,
    SECRETS_KEY,
    STATUS_KEY,
    merge,
    load,
    save,
    onChange,
    loadSecrets,
    saveSecrets,
    hash,
    aiConfigKey,
    isAiActive,
  };
})(globalThis);
