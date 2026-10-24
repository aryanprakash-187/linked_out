// Hidden page the background worker opens to reach Chrome's Prompt API,
// which isn't exposed to service workers.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'control:chrome-ai-prompt') return;
  globalThis.control.chromeAI
    .prompt(msg.payload)
    .then((text) => sendResponse({ text }))
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true;
});
