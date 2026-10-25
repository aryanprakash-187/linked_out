(async function () {
  const S = globalThis.control.settings;
  const $ = (id) => document.getElementById(id);
  const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
  const set = (obj, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  };

  let settings = await S.load();
  let secrets = await S.loadSecrets();

  // Posts used by "Try it on sample posts".
  const SAMPLE_POSTS = [
    {
      author: 'Priya Raman',
      text: 'Our new preprint benchmarks five single-cell RNA-seq integration methods on 1.2M cells. Scanorama held up best on batch effects; code and notebooks are on GitHub.',
    },
    {
      author: 'Jordan Lee',
      text: "I'm thrilled to announce I'll be joining Google as a Software Engineering Intern this summer! Grateful to everyone who helped along the way. #internship #grateful",
    },
    {
      author: 'Growth Academy',
      text: 'FREE webinar this Thursday: 7 X hacks to 10x your personal brand. Only 50 seats left. Comment "BRAND" and I\'ll DM you the link!',
    },
    {
      author: 'Marcus Chen',
      text: 'I got rejected from 47 jobs. Then I learned the one lesson nobody teaches you. Agree?',
    },
  ];

  // ---------- generic save + toast ----------

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 1400);
  }

  async function save(message = 'Saved') {
    settings = await S.save(settings);
    render();
    toast(message);
  }

  // ---------- render ----------

  function render() {
    $('enabled').checked = settings.enabled;
    $('master-title').textContent = settings.enabled ? 'Control-X is on' : 'Control-X is off';
    $('master-hint').textContent = settings.enabled
      ? 'Turn off to see X untouched.'
      : 'X is untouched until you turn this back on.';
    document.body.classList.toggle('off', !settings.enabled);
    for (const input of document.querySelectorAll('input[data-path]')) {
      input.checked = Boolean(get(settings, input.dataset.path));
    }
    for (const radio of document.querySelectorAll('input[name="provider"]')) {
      radio.checked = radio.value === settings.aiFilter.provider;
    }
    const isAnthropic = settings.aiFilter.provider === 'anthropic';
    $('local-fields').hidden = isAnthropic;
    $('anthropic-fields').hidden = !S.usesClaude(settings.aiFilter);
    $('model').value = settings.aiFilter.model;
    renderUnderstood();
  }

  // Shows what the on-device filter will actually look for, so people can
  // rephrase if the parser misread them.
  function renderUnderstood() {
    const list = $('understood-list');
    list.textContent = '';
    const text = settings.aiFilter.instructions.trim();
    const show = text && settings.aiFilter.provider === 'local';
    $('understood').hidden = !show;
    if (!show) return;
    const intent = globalThis.control.intent.parseInstructions(text);
    const add = (prefix, items) => {
      if (!items.length) return;
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = prefix;
      li.append(b, ' ' + items.join(' · '));
      list.append(li);
    };
    add('Only show:', intent.only ? intent.show.map((t) => t.label) : []);
    add('Hide:', intent.hide.map((t) => t.label));
    add('Noted, never hidden for this:', intent.more);
    if (!list.children.length) add('Nothing to filter yet.', ['Try “Hide crypto posts” or “Only show AI research”.']);
  }

  function renderKeywordsText() {
    $('keyword-list').value = settings.keywords.list.join('\n');
  }

  // ---------- toggles ----------

  $('enabled').addEventListener('change', (e) => {
    settings.enabled = e.target.checked;
    save(settings.enabled ? 'Control-X is on' : 'Control-X is off');
  });

  for (const input of document.querySelectorAll('input[data-path]')) {
    input.addEventListener('change', () => {
      set(settings, input.dataset.path, input.checked);
      if (input.dataset.path === 'aiFilter.enabled' && input.checked) {
        const missing = aiMissing();
        if (missing) toast(missing);
      }
      save();
    });
  }

  // ---------- keywords ----------

  function parseKeywords(text) {
    const seen = new Set();
    const out = [];
    for (const line of text.split('\n')) {
      const kw = line.trim();
      if (kw && !seen.has(kw.toLowerCase())) {
        seen.add(kw.toLowerCase());
        out.push(kw);
      }
    }
    return out;
  }

  let kwTimer = null;
  async function saveKeywords() {
    clearTimeout(kwTimer);
    const list = parseKeywords($('keyword-list').value);
    if (JSON.stringify(list) === JSON.stringify(settings.keywords.list)) return;
    settings.keywords.list = list;
    settings = await S.save(settings);
    const n = list.length;
    $('keywords-state').textContent = `Saved · ${n} ${n === 1 ? 'keyword' : 'keywords'}`;
    $('keywords-state').classList.add('ok');
  }
  $('keyword-list').addEventListener('input', () => {
    $('keywords-state').textContent = '';
    clearTimeout(kwTimer);
    kwTimer = setTimeout(saveKeywords, 700);
  });
  $('keyword-list').addEventListener('blur', saveKeywords);

  // ---------- AI instructions ----------

  // Instructions are saved explicitly (button or Ctrl/Cmd+Enter) rather than
  // while typing, because every change re-checks the open feed with the AI.
  function instructionsDirty() {
    return $('instructions').value.trim() !== settings.aiFilter.instructions.trim();
  }
  function renderInstructionsState() {
    const dirty = instructionsDirty();
    $('save-instructions').disabled = !dirty;
    const state = $('instructions-state');
    state.classList.remove('ok');
    state.textContent = dirty ? 'Unsaved changes' : '';
  }
  async function saveInstructions() {
    if (!instructionsDirty()) return;
    const text = $('instructions').value.trim();
    settings.aiFilter.instructions = text;
    // Writing instructions is a clear signal they want the filter on.
    if (text && !settings.aiFilter.enabled) settings.aiFilter.enabled = true;
    settings = await S.save(settings);
    render();
    renderInstructionsState();
    const state = $('instructions-state');
    state.textContent = text ? aiMissing() || 'Saved. Your feed will be re-checked.' : 'Cleared';
    state.classList.toggle('ok', !aiMissing());
  }
  $('instructions').addEventListener('input', renderInstructionsState);
  $('instructions').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveInstructions();
    }
  });
  $('save-instructions').addEventListener('click', saveInstructions);

  // ---------- provider, key, model ----------

  function aiMissing() {
    if (!settings.aiFilter.instructions.trim()) return 'Write what you want to see (or not) first.';
    if (settings.aiFilter.provider === 'anthropic' && !secrets.anthropicApiKey) {
      return 'Add your Anthropic API key below to turn this on.';
    }
    if (settings.aiFilter.provider === 'local' && settings.aiFilter.claudeCheck && !secrets.anthropicApiKey) {
      return 'Add your Anthropic API key below for the Claude double-check.';
    }
    return '';
  }

  for (const radio of document.querySelectorAll('input[name="provider"]')) {
    radio.addEventListener('change', () => {
      settings.aiFilter.provider = radio.value;
      save();
    });
  }

  for (const m of S.MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    $('model').append(opt);
  }
  $('model').addEventListener('change', () => {
    settings.aiFilter.model = $('model').value;
    save();
  });

  $('api-key').value = secrets.anthropicApiKey;
  async function saveKey() {
    const key = $('api-key').value.trim();
    if (key === secrets.anthropicApiKey) return;
    secrets.anthropicApiKey = key;
    await S.saveSecrets(secrets);
    toast(key ? 'API key saved' : 'API key removed');
  }
  $('api-key').addEventListener('change', saveKey);
  $('api-key').addEventListener('blur', saveKey);
  $('toggle-key').addEventListener('click', () => {
    const input = $('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('toggle-key').textContent = input.type === 'password' ? 'Show' : 'Hide';
  });

  // ---------- test ----------

  $('test-ai').addEventListener('click', async () => {
    await saveKey();
    if (instructionsDirty()) await saveInstructions();
    const out = $('test-output');
    out.textContent = '';
    const missing = aiMissing();
    if (missing) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = missing;
      out.append(p);
      return;
    }
    const btn = $('test-ai');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const res = await chrome.runtime.sendMessage({ type: 'control:test-ai', samples: SAMPLE_POSTS });
    btn.disabled = false;
    btn.textContent = 'Try it on sample posts';
    if (!res || !res.ok) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = (res && res.error) || 'No response from the extension.';
      out.append(p);
      return;
    }
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `Answered in ${(res.ms / 1000).toFixed(1)}s.`;
    out.append(note);
    res.results.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'verdict';
      const tag = document.createElement('span');
      tag.className = 'tag ' + r.decision;
      tag.textContent = r.decision;
      const body = document.createElement('div');
      const post = document.createElement('div');
      post.className = 'post';
      post.textContent = `${SAMPLE_POSTS[i].author}: ${SAMPLE_POSTS[i].text}`;
      const reason = document.createElement('div');
      reason.textContent = r.reason;
      body.append(reason, post);
      row.append(tag, body);
      out.append(row);
    });
  });

  $('reset-learning').addEventListener('click', async () => {
    const button = $('reset-learning');
    button.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'control:feedback',
        payload: { action: 'reset', instructions: settings.aiFilter.instructions },
      });
      if (!res || res.error) throw new Error(res && res.error || 'Reset failed');
      $('learning-state').textContent = 'Personal learning cleared for these instructions.';
    } catch (err) {
      $('learning-state').textContent = err.message;
    } finally { button.disabled = false; }
  });

  // ---------- troubleshooting ----------

  $('clear-cache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'control:clear-cache' });
    $('cache-state').textContent = 'Done. Posts will be re-checked next time.';
  });

  // ---------- keep in sync with the popup ----------

  S.onChange((next) => {
    settings = next;
    render();
  });

  window.addEventListener('beforeunload', (e) => {
    if (instructionsDirty()) e.preventDefault();
  });

  render();
  renderKeywordsText();
  $('instructions').value = settings.aiFilter.instructions;
  renderInstructionsState();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
