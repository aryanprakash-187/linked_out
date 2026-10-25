// Styles for the "out" button and its panel (content/panel.js). They live in
// shadow roots, so LinkedIn's CSS can't reach in and ours can't leak out.
// Kept as a string rather than a .css file because a shadow root can only
// <link> a file that is web-accessible, and LinkedIn probes web-accessible
// files to detect extensions.
(function (root) {
  const control = (root.control = root.control || {});

  control.panelStyle = `
:host {
  all: initial;
  --ink: rgba(0, 0, 0, 0.9);
  --muted: rgba(0, 0, 0, 0.6);
  --faint: rgba(0, 0, 0, 0.42);
  --hair: rgba(0, 0, 0, 0.13);
  --glass: rgba(255, 255, 255, 0.4);
  --field: rgba(255, 255, 255, 0.5);
  --blue: #0a66c2; /* LinkedIn's own blue, so "out" pairs with the "in" logo */
  --blue-hover: #004182;
  --on-blue: #ffffff;
  --rim: rgba(10, 102, 194, 0.35);
  --glow: rgba(10, 102, 194, 0.5);
  --wash: rgba(10, 102, 194, 0.08);
  --danger: #b3261e;
  color: var(--ink);
  font: 13px/1.4 -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* LinkedIn's dark mode (detected from the top bar's colour, see panel.js). */
:host([data-theme='dark']) {
  --ink: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.64);
  --faint: rgba(255, 255, 255, 0.45);
  --hair: rgba(255, 255, 255, 0.17);
  --glass: rgba(27, 31, 35, 0.5);
  --field: rgba(0, 0, 0, 0.22);
  --blue: #70b5f9; /* LinkedIn's blue in its dark mode */
  --blue-hover: #9cccfb;
  --on-blue: #0b0b0b;
  --rim: rgba(112, 181, 249, 0.35);
  --glow: rgba(112, 181, 249, 0.42);
  --wash: rgba(112, 181, 249, 0.12);
  --danger: #ff8a80;
}

/* LinkedIn's page CSS overrides fonts set on :host (the panel fell back to
   Times), so the font is set on our own top-level elements instead. */
.out, .panel {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
}

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, textarea { margin: 0; color: inherit; font: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

/* ---------- the "out" button ---------- */

/* Sized from LinkedIn's logo: --h is its height, --r its corner radius. */
:host(#control-out) {
  display: inline-flex;
  flex: none;
  align-self: center;
  vertical-align: middle;
  margin: 0 4px;
}

.out {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--h, 34px);
  min-width: var(--h, 34px);
  padding: 0 calc(var(--h, 34px) * 0.2);
  border: 1px solid var(--rim);
  border-radius: var(--r, 5px);
  background: transparent;
  color: var(--blue);
  font-size: calc(var(--h, 34px) * 0.44);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
}

.out:hover,
.out[aria-expanded='true'] {
  border-color: var(--blue);
  background: var(--wash);
}

/* out switched off: still reachable, visibly idle. */
:host([data-off]) .out {
  border-color: var(--hair);
  border-style: dashed;
  background: transparent;
  color: var(--faint);
}

/* Fallback when the logo can't be found: a small glass pill in the corner. */
:host(#control-out[data-floating]) {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483000;
  margin: 0;
}

:host([data-floating]) .out {
  background: var(--glass);
  -webkit-backdrop-filter: blur(16px) saturate(1.6);
  backdrop-filter: blur(16px) saturate(1.6);
  box-shadow: inset 6px 0 8px -6px var(--glow), inset -6px 0 8px -6px var(--glow), 0 4px 18px rgba(0, 0, 0, 0.12);
}

/* ---------- the panel ---------- */

:host(#control-out-panel) {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483000;
}

.panel {
  position: fixed;
  width: min(344px, calc(100vw - 24px));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px 16px 12px;
  border: 1px solid var(--rim);
  border-radius: 14px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(22px) saturate(1.8);
  backdrop-filter: blur(22px) saturate(1.8);
  /* Blue that glows in from the left and right edges and fades to clear. */
  box-shadow:
    inset 18px 0 22px -14px var(--glow),
    inset -18px 0 22px -14px var(--glow),
    0 16px 40px -14px rgba(0, 0, 0, 0.22);
  outline: none;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(8px) scale(0.985);
  transition: opacity 0.16s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.22s;
}

.panel.open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: none;
  transition: opacity 0.16s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  .panel, .panel.open { transform: none; transition: opacity 0.1s, visibility 0s; }
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.sub {
  margin: 1px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.error {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 12px;
}

section {
  margin-top: 14px;
}

.off .groups {
  opacity: 0.45;
}

h3 {
  margin: 0 0 7px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
}

.chip:hover {
  border-color: var(--rim);
  color: var(--blue);
}

.chip[aria-pressed='true'] {
  border-color: var(--blue);
  background: var(--blue);
  color: var(--on-blue);
}

.chip .n {
  font-weight: 500;
  opacity: 0.65;
}

.ask-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

.ask-head h3 {
  margin: 0;
}

.switch {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--hair);
  transition: background-color 0.15s;
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s;
}

.switch[aria-checked='true'] {
  background: var(--blue);
}

.switch[aria-checked='true']::after {
  transform: translateX(14px);
}

textarea {
  display: block;
  width: 100%;
  min-height: 74px;
  max-height: 220px;
  padding: 9px 11px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: var(--field);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
}

textarea::placeholder {
  color: var(--faint);
}

textarea:focus {
  border-color: var(--blue);
  outline: none;
}

.understood {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.understood b {
  color: var(--ink);
  font-weight: 600;
}

.ask-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.hint {
  color: var(--faint);
  font-size: 11.5px;
}

.hint.warn {
  color: var(--danger);
}

.save {
  flex: none;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--blue);
  color: var(--on-blue);
  font-size: 12.5px;
  font-weight: 600;
}

.save:not(:disabled):hover {
  background: var(--blue-hover);
}

.save:disabled {
  opacity: 0.3;
  cursor: default;
}

footer {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--hair);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.link:hover {
  color: var(--ink);
}
`;
})(globalThis);
