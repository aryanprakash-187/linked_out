(async function () {
  const S = globalThis.control.settings;
  let settings = await S.load();
  let secrets = await S.loadSecrets();

  const $ = (id) => document.getElementById(id);
  const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
  const set = (obj, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  };

  function aiReady() {
    if (!settings.aiFilter.instructions.trim()) return 'Describe what you want in settings first';
    if (settings.aiFilter.provider === 'anthropic' && !secrets.anthropicApiKey)
      return 'Add an API key in settings first';
    return '';
  }

  function render() {
    $('enabled').checked = settings.enabled;
    $('master-label').textContent = settings.enabled ? 'On' : 'Off';
    document.body.classList.toggle('off', !settings.enabled);
    for (const input of document.querySelectorAll('[data-path]')) {
      input.checked = Boolean(get(settings, input.dataset.path));
    }
    const n = settings.keywords.list.length;
    $('kw-hint').textContent = n === 1 ? '1 keyword' : `${n} keywords`;
    const missing = aiReady();
    $('ai-hint').textContent =
      missing || (settings.aiFilter.provider === 'anthropic' ? 'Claude' : 'On-device AI');
  }

  async function save() {
    settings = await S.save(settings);
    render();
  }

  $('enabled').addEventListener('change', (e) => {
    settings.enabled = e.target.checked;
    save();
  });

  for (const input of document.querySelectorAll('[data-path]')) {
    input.addEventListener('change', () => {
      if (input.dataset.path === 'aiFilter.enabled' && input.checked && aiReady()) {
        // Can't run without instructions or a key: take them to set it up.
        input.checked = false;
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#ai') });
        window.close();
        return;
      }
      set(settings, input.dataset.path, input.checked);
      save();
    });
  }

  $('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ---------- live status from the active tab ----------

  async function refreshStatus() {
    const status = $('status');
    const errorBox = $('ai-error');
    // ?tabId= lets the end-to-end tests point a popup opened in its own tab
    // at the LinkedIn tab.
    const forced = Number(new URLSearchParams(location.search).get('tabId'));
    const [tab] = forced ? [{ id: forced }] : await chrome.tabs.query({ active: true, currentWindow: true });
    let stats = null;
    if (tab && tab.id !== undefined) {
      try {
        stats = await chrome.tabs.sendMessage(tab.id, { type: 'control:stats' });
      } catch {
        stats = null; // not a LinkedIn tab, or the page loaded before control.
      }
    }
    if (!settings.enabled) {
      status.textContent = 'control. is off. LinkedIn looks the way LinkedIn wants.';
    } else if (!stats) {
      status.textContent = 'Open LinkedIn to see control. at work.';
    } else if (!stats.onFeed) {
      status.textContent = 'control. filters your home feed. Other pages are left alone.';
    } else if (settings.layout.blankHome) {
      status.textContent = 'Home page is blank. Use the top bar to go where you meant to go.';
    } else {
      const parts = [`Hidden ${stats.hidden} of ${stats.hidden + stats.shown + stats.pending} posts on this page`];
      if (stats.pending) parts.push(`${stats.pending} being checked`);
      status.textContent = parts.join(' · ') + '.';
    }

    const stored = (await chrome.storage.local.get(S.STATUS_KEY))[S.STATUS_KEY] || {};
    const aiOn = S.isAiActive(settings);
    const message = aiOn && ((stored.lastError && stored.lastError.message) || (stats && stats.aiError));
    errorBox.hidden = !message;
    errorBox.textContent = message ? `AI filter: ${message} Posts are shown until it works.` : '';
  }

  S.onChange((next) => {
    settings = next;
    render();
    refreshStatus();
  });
  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes[S.SECRETS_KEY]) secrets = await S.loadSecrets();
    if (changes[S.STATUS_KEY] || changes[S.SECRETS_KEY]) {
      render();
      refreshStatus();
    }
  });

  render();
  refreshStatus();
  setInterval(refreshStatus, 1000);
})();
