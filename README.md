# out — decide what gets your attention on LinkedIn

A Chrome (MV3) extension that cleans up the LinkedIn home feed. It hides promoted posts, "Jane likes this" network
activity, keyword matches, and anything you describe in your own words ("no humblebrags, only bioinformatics").
Each hidden post collapses to a one-line bar, **"out hid a post · Looks like engagement bait [Show anyway]"**,
so nothing is ever lost.

The AI runs **on your own computer**: a 34 MB sentence-embedding model ships inside the extension. It's free per
user, private (posts never leave the browser), and takes about 5 ms per post. No API key, no network calls.

Built for a hackathon, **Track 4: AI-Powered Consumer Products for 1 Billion People**, which is judged on
**innovation, scale and real-world application**. The product is ambient: there's no new app, and the feed you
already scroll just gets better.

---

## Quick start

```bash
npm install
npm run setup             # = npm run vendor && npm run models (only needed if extension/vendor or models is missing)
npm test                  # unit tests (node --test)
npx playwright install chromium   # once, for e2e
npm run test:e2e          # Playwright e2e: loads the real extension + real model in headless Chromium
npm run eval              # accuracy of the on-device filter on eval/data.mjs
```

Load `extension/` as an unpacked extension at `chrome://extensions` (Developer mode on). Open settings, write what
you want under "Describe what you want", and click Save.

## Repo layout

```
linked_out/
├── README.md
├── package.json              # dev deps: @huggingface/transformers, esbuild, playwright
├── extension/                # the unpacked extension (no build step; plain classic scripts on globalThis.control)
│   ├── manifest.json         # MV3; CSP allows 'wasm-unsafe-eval' for ONNX Runtime
│   ├── background/
│   │   └── background.js     # batching queue (8 posts / 350 ms), on-device model calls, verdict cache, error status
│   ├── content/
│   │   ├── linkedin.js       # LinkedIn DOM knowledge: find posts, extract {urn, author, text, header}
│   │   ├── content.js        # per-post pipeline: rules → cache → AI; draws the "Show anyway" bar
│   │   ├── panel.js          # the "out" button just before LinkedIn's logo + the glass panel it opens
│   │   ├── panel-style.js    # the panel's CSS, as a string for its shadow roots (nothing web-accessible)
│   │   └── content.css
│   ├── offscreen/
│   │   ├── offscreen.html    # hidden page that hosts the model (service workers can't)
│   │   └── offscreen.js      # Transformers.js: embeds topics + posts, judges them with local-filter.js
│   ├── shared/
│   │   ├── settings.js       # defaults, load/save, migration of old values, cache-key hash
│   │   ├── rules.js          # deterministic filters: promoted, social activity, suggested, keywords
│   │   ├── intent.js         # parses free-text instructions → hide/show topics (+ genre example anchors)
│   │   ├── local-filter.js   # z-score decision logic, thresholds, running per-topic stats (pure, unit-tested)
│   │   └── ui.css
│   ├── options/              # settings page; shows "How out understood you"
│   ├── popup/                # toolbar popup: on/off, counts, last AI error
│   ├── models/Xenova/gte-small/   # bundled model: tokenizer + int8 ONNX (34 MB), from `npm run models`
│   ├── vendor/               # from `npm run vendor`: transformers.min.js, ort/*.wasm
│   └── icons/
├── eval/
│   ├── data.mjs              # 65 hand-written LinkedIn-style posts, multi-label, + 11 filter scenarios
│   └── run.mjs               # scores the shipped intent.js + local-filter.js + model on that data
├── scripts/
│   ├── build-vendor.mjs      # bundles/copies vendor libraries
│   ├── fetch-models.mjs      # downloads the model from Hugging Face into extension/models/
│   └── make-icons.py
└── tests/
    ├── unit/                 # rules, settings, intent parser + decision logic
    ├── e2e/                  # Playwright: real extension vs. fixture feeds; real local model
    └── fixtures/             # feed.html (classic markup), feed-2026.html (2026 markup)
```

## Features

| Feature | Where | How |
|---|---|---|
| **1. Hide by post type**: promoted, network activity, suggested | `shared/rules.js` | Regex on the post's header line. Instant. |
| **2. Hide by keyword** | `shared/rules.js` | Word-boundary match, plurals, `intern*` wildcards, phrases. |
| **3. "Describe what you want"** | `intent.js`, `local-filter.js`, `offscreen/`, `background/` | On-device model only. |
| **4. Home page layout**: blank home, hide sidebars | `content/` | CSS on tagged landmarks. |
| Hidden-post bar with **Show anyway**, optional blur while checking | `content/content.js` | |
| **"out" button + panel** on LinkedIn itself: every switch, plus "Describe what you want" | `content/panel.js` | Shadow DOM, just before the logo; floats bottom-left if the logo isn't found. |

## Architecture

```
post ─▶ 1. rules (regex)                 instant                          ─▶ hide, or continue
     ─▶ 2. verdict cache                 key = config hash + post URN     ─▶ reuse
     ─▶ 3. on-device model (gte-small)   offscreen page, ~5 ms/post       ─▶ hide / show (+ "uncertain" flag)
     ─▶ any error: fail open (show the post, report in popup)
```

**How step 3 works:**

1. `intent.js` splits the instructions into clauses and classifies each one as *hide* ("no X", "hide X"), *only*
   ("only X"), or *more of* ("show me more X", which never hides anything). It strips filler words to leave a topic.
   The options page shows the result ("Only show: bioinformatics · Hide: hiring").
2. Each topic gets **anchors**: the phrase, its parts ("AI and ML" → "AI", "ML"), and, for known LinkedIn genres
   (engagement bait, clickbait hooks, humblebrags, course/webinar promos, new-job posts, student posts, hiring), a few example
   phrases. Bare words like "humblebrag" embed poorly, and these anchors lifted tone filters from AUC ~0.70 to ~0.90.
3. Topics and posts are embedded with **gte-small** (mean pooling, normalised). A post's similarity to a topic is
   its max cosine over that topic's anchors.
4. Raw similarities aren't comparable across topics, so each topic keeps **running stats** of how similar ordinary
   feed posts are to it, and a post is judged by its **z-score**. The stats start from a prior measured on the eval
   set, so cold start works.
5. Decision: hide if z ≥ 1.26 for any hide topic ("Looks like crypto"). In only-mode, hide if z < 0.8 for all show
   topics ("Not about genomics"). Within ±0.5 of a threshold the verdict is flagged **uncertain** (unused for
   now; a hook for a second on-device model).

## Decision: on-device AI only (no Claude, no API key)

Decided 2026-10-24. The Claude provider (every post sent to Claude), the "Double-check uncertain posts with Claude"
option and the Anthropic API key field were removed on purpose. This is an infrastructure decision, not a missing
feature:

- **Zero cost per user.** Every post is judged on the user's own computer. With Claude, posts were paid API calls on
  the user's own key (every post, or ~14% with the double-check), which doesn't work for a consumer product meant
  for a billion people.
- **Private by construction.** Feed posts never leave the browser, and the extension makes no network calls.
- **No setup.** Nobody has to create an Anthropic account and paste a key. The filter works as soon as it's installed.
- **One AI path.** `npm run eval` measures exactly what ships.

What we give up: the Claude double-check helped with subtle tone (engagement bait dressed up as a story). The
"uncertain" flag from step 5 stays as the hook for a second on-device model if that turns out to be needed.

Older installs: settings saved by earlier versions drop `provider`, `model` and `claudeCheck` on load, and an API
key saved by an earlier version is deleted from `chrome.storage.local` when the extension updates.

## Model choice (evaluated 2026-10-24)

Benchmarked in Node on an M1 with 8 GB RAM, using Transformers.js 4.3.1 and int8 weights. Data: `eval/data.mjs`
(60 posts × 10 scenarios: 4 topic, 3 genre, 2 tone). The metric is AUC of "post matches topic", averaged over
scenarios.

| Model | Size | AUC | Tone AUC | ms/post | Notes |
|---|---|---|---|---|---|
| **gte-small** + genre anchors + z-score | **34 MB** | **0.952** | **0.904** | **~3** | **chosen**; best F1 (0.79) at a single global threshold |
| bge-small-en-v1.5 (same tricks) | 34 MB | 0.953 | 0.932 | 3 | tie on AUC, lower F1 (0.75); needs a query prefix |
| all-MiniLM-L6-v2 (same tricks) | 23 MB | 0.948 | 0.921 | 1.7 | smallest/fastest fallback option |
| multilingual-e5-small | 118 MB | 0.932 | 0.848 | 4.6 | **the upgrade path for non-English feeds** |
| EmbeddingGemma-300m (raw) | 197 MB | 0.936 | 0.743 | 27 | not BERT; 6× bigger for little gain |
| modernbert-embed-base (raw) | 150 MB | 0.878 | 0.544 | 12.5 | |
| Zero-shot NLI (deberta-v3-xsmall / mobilebert-mnli) | 87 / 27 MB | 0.879 / 0.799 | — | 9 per label | worse and slower |
| BERTweet | — | — | — | — | raw masked LM trained on tweets, no ONNX build, no sentence embeddings; would need fine-tuning |
| Gemma 3 1B as a fallback judge | 860 MB | 0.906 | 0.641 | ~700 | **dropped**: worse than gte-small on the hard cases |
| Gemma 3 270M as a fallback judge | 323 MB | 0.54 | 0.55 | 160 | chance level |

Gemini Nano (Chrome Prompt API) was dropped too. It needs desktop Chrome with a strong GPU or 16 GB RAM and a
multi-GB download, and its weights can't be bundled.

**End-to-end score of what ships** (`npm run eval`): **95.2%** accuracy overall, **97.9%** on the 86% of posts it's
confident about, with 14% flagged uncertain.

Caveat: 60 hand-written posts is a small, synthetic set, so treat differences under ~0.01 AUC as noise. The next
step is labelling a few hundred real feed posts.

## Known limitations / next steps

- **Subtle tone** ("I got rejected 47 times… Agree?") can slip through. The default keyword list (`agree?`) covers some
  of it.
- **English only** today. Swap in `multilingual-e5-small` (prefixes `query: ` / `passage: `) for global reach, and
  recalibrate `local-filter.js` CONFIG with `npm run eval`.
- **Learn from clicks:** "Show anyway" should nudge that topic's threshold for this user (not built yet).
- ONNX Runtime runs single-threaded (extension pages aren't cross-origin isolated). That's fine for a 33M model.
- `npm run lint` / `npm run zip` point at scripts that don't exist yet.

## Conventions

- The product is called **out**. Internal names still say `control` (`globalThis.control`, `data-control-*`
  attributes, `control:*` messages, the `controlSettings` storage key); renaming the storage key would reset
  everyone's saved settings.
- No build step for `extension/`. Classic scripts hang off `globalThis.control`. Only `vendor/` and `models/` are
  generated, and both are committed so a fresh clone loads as-is.
- Everything that can fail **fails open** (the post is shown). An AI problem must never hide content.
- After changing the model or thresholds, run `npm run eval` and update `CONFIG` in `shared/local-filter.js`.
