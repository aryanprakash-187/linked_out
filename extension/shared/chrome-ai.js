// Chrome's built-in model (Gemini Nano) via the Prompt API. Runs on-device,
// free, no API key. Chrome desktop only, and only on machines that meet
// Chrome's hardware requirements. Used by the offscreen document (or the
// background worker, if Chrome exposes the API there) and by the options page
// to trigger the one-time model download.
(function (root) {
  const control = (root.control = root.control || {});

  const LANG = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  function api() {
    return typeof root.LanguageModel !== 'undefined' ? root.LanguageModel : null;
  }

  // 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
  async function availability() {
    const LM = api();
    if (!LM) return 'unsupported';
    try {
      return await LM.availability(LANG);
    } catch {
      return 'unavailable';
    }
  }

  // Must be called from a user gesture when the model still needs downloading.
  async function ensureReady(onProgress) {
    const LM = api();
    if (!LM) throw new Error("This browser doesn't have Chrome's built-in AI.");
    const session = await LM.create({
      ...LANG,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded));
      },
    });
    session.destroy();
  }

  // One base session per system prompt; each request runs in a clone so
  // batches don't see each other.
  let base = null;
  let baseSystem = '';

  const NOT_READY = {
    unsupported: "This browser doesn't have Chrome's built-in AI. Switch to Claude in control. settings.",
    unavailable: "Chrome's built-in AI isn't available on this device. Switch to Claude in control. settings.",
    downloadable: "Chrome's on-device model isn't downloaded yet. Download it in control. settings.",
    downloading: "Chrome's on-device model is still downloading.",
  };

  async function prompt({ system, user, schema }) {
    // Without this check, create() waits silently for a multi-GB download.
    const status = await availability();
    if (status !== 'available') throw new Error(NOT_READY[status] || `Chrome's built-in AI is ${status}.`);
    const LM = api();
    if (!base || baseSystem !== system) {
      if (base) base.destroy();
      base = await LM.create({ ...LANG, initialPrompts: [{ role: 'system', content: system }] });
      baseSystem = system;
    }
    const session = await base.clone();
    try {
      return await session.prompt(user, { responseConstraint: schema });
    } finally {
      session.destroy();
    }
  }

  control.chromeAI = { availability, ensureReady, prompt };
})(globalThis);
