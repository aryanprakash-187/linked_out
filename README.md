# control. — decide what gets your attention on LinkedIn

A Chrome (MV3) extension that cleans up the LinkedIn home feed. It hides promoted posts, "Jane likes this" network
activity, keyword matches, and anything you describe in your own words ("no humblebrags, only bioinformatics").
Each hidden post collapses to a one-line bar, **"control. hid a post · Looks like engagement bait [Show anyway]"**,
so nothing is ever lost.

The AI runs **on your own computer**: a 34 MB sentence-embedding model ships inside the extension. It's free per
user, private (posts never leave the browser), and takes about 5 ms per post. Claude is optional.

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
├── package.json              # dev deps: @huggingface/transformers, esbuild, playwright, @anthropic-ai/sdk
├── extension/                # the unpacked extension (no build step; plain classic scripts on globalThis.control)
│   ├── manifest.json         # MV3; CSP allows 'wasm-unsafe-eval' for ONNX Runtime
│   ├── background/
│   │   └── background.js     # batching queue (8 posts / 350 ms), provider routing, verdict cache, error status
│   ├── content/
│   │   ├── linkedin.js       # LinkedIn DOM knowledge: find posts, extract {urn, author, text, header}
│   │   ├── content.js        # per-post pipeline: rules → cache → AI; draws the "Show anyway" bar
│   │   └── content.css
│   ├── offscreen/
│   │   ├── offscreen.html    # hidden page that hosts the model (service workers can't)
│   │   └── offscreen.js      # Transformers.js: embeds topics + posts, judges them with local-filter.js
│   ├── shared/
│   │   ├── settings.js       # defaults, load/save, migration of old values, cache-key hash
│   │   ├── rules.js          # deterministic filters: promoted, social activity, suggested, keywords
│   │   ├── intent.js         # parses free-text instructions → hide/show topics (+ genre example anchors)
│   │   ├── local-filter.js   # z-score decision logic, thresholds, running per-topic stats (pure, unit-tested)
│   │   ├── prompt.js         # Claude prompt, JSON schema, verdict parser
│   │   └── ui.css
│   ├── options/              # settings page; shows "How control. understood you"
│   ├── popup/                # toolbar popup: on/off, counts, last AI error
│   ├── models/Xenova/gte-small/   # bundled model: tokenizer + int8 ONNX (34 MB), from `npm run models`
│   ├── vendor/               # from `npm run vendor`: anthropic-sdk.js, transformers.min.js, ort/*.wasm (27 MB)
│   └── icons/
├── eval/
│   ├── data.mjs              # 65 hand-written LinkedIn-style posts, multi-label, + 11 filter scenarios
│   └── run.mjs               # scores the shipped intent.js + local-filter.js + model on that data
├── scripts/
│   ├── build-vendor.mjs      # bundles/copies vendor libraries
│   ├── fetch-models.mjs      # downloads the model from Hugging Face into extension/models/
│   └── make-icons.py
└── tests/
    ├── unit/                 # rules, settings/prompt, intent parser + decision logic
    ├── e2e/                  # Playwright: real extension vs. fixture feeds; mock Anthropic API; real local model
    └── fixtures/             # feed.html (classic markup), feed-2026.html (2026 markup)
```

## Features

| Feature | Where | How |
|---|---|---|
| **1. Hide by post type**: promoted, network activity, suggested | `shared/rules.js` | Regex on the post's header line. Instant. |
| **2. Hide by keyword** | `shared/rules.js` | Word-boundary match, plurals, `intern*` wildcards, phrases. |
| **3. "Describe what you want"** | `intent.js`, `local-filter.js`, `offscreen/`, `background/` | On-device model (default) or Claude. |
| **4. Home page layout**: blank home, hide sidebars | `content/` | CSS on tagged landmarks. |
| Hidden-post bar with **Show anyway**, optional blur while checking | `content/content.js` | |

## Architecture

```
post ─▶ 1. rules (regex)                 instant                          ─▶ hide, or continue
     ─▶ 2. verdict cache                 key = config hash + post URN     ─▶ reuse
     ─▶ 3. on-device model (gte-small)   offscreen page, ~5 ms/post       ─▶ hide / show (+ "uncertain" flag)
     ─▶ 4. Claude double-check           optional, uncertain posts only (~14%), needs the user's API key
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
   topics ("Not about genomics"). Within ±0.5 of a threshold the verdict is flagged **uncertain**, and uncertain
   posts go to Claude if the user turned on "Double-check uncertain posts with Claude".

**Providers** (`settings.aiFilter.provider`): `local` (default) or `anthropic` (every post goes to Claude; the
default model is now `claude-haiku-5-5`). Settings saved by older versions (`chrome-ai`) migrate to `local`.

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

- **Subtle tone** ("I got rejected 47 times… Agree?") can slip through. The default keyword list (`agree?`) and the
  Claude double-check cover some of it.
- **English only** today. Swap in `multilingual-e5-small` (prefixes `query: ` / `passage: `) for global reach, and
  recalibrate `local-filter.js` CONFIG with `npm run eval`.
- **Personal learning:** explicit corrections are remembered locally (see below). Show anyway remains a temporary reveal.
- ONNX Runtime runs single-threaded (extension pages aren't cross-origin isolated). That's fine for a 33M model.
- `npm run lint` / `npm run zip` point at scripts that don't exist yet.

## Conventions

- No build step for `extension/`. Classic scripts hang off `globalThis.control`. Only `vendor/` and `models/` are
  generated, and both are committed so a fresh clone loads as-is.
- Everything that can fail **fails open** (the post is shown). An AI problem must never hide content.
- Post text is untrusted data. The Claude prompt says to ignore instructions inside posts.
- After changing the model or thresholds, run `npm run eval` and update `CONFIG` in `shared/local-filter.js`.

## Personal feedback memory

With the on-device filter enabled, AI-hidden posts offer **This should be shown** and visible posts offer
**Hide more like this**. These are explicit teaching actions. **Show anyway** reveals one post without teaching.

Corrections are stored only in the extension's IndexedDB, scoped to the saved instructions and encoder version.
An exact corrected text uses the user's decision immediately. For unseen posts, the existing gte-small embedding
is compared with up to 1,000 saved corrections. At least three neighbors with cosine similarity >= 0.90 must
agree; a nearby opposing correction blocks the override unless the similarity margin is >= 0.05.
Otherwise the original topic filter and optional Claude check remain in charge. Explicit keyword and structural
rules still win. The thresholds are conservative starting values, not calibrated accuracy guarantees.

No additional model or server is required. 1,000 384-dimensional embeddings contain about 1.5 MB of Float32
values (plus text, metadata, and one undo record); in-memory JavaScript arrays can use more. Feedback text is
capped at 20,000 characters per record; encoder input remains 2,000 characters. Older corrections are evicted
at the global cap. Storage is not encrypted and embeddings are also potentially sensitive data.

Use **Undo correction** immediately after saving, or **Reset learning for these instructions** in settings.
Undo covers the latest correction across tabs and refuses to undo a different, newer correction.
Reset does not change other instruction profiles. Uninstalling the extension removes its local learning data.

Each feedback change publishes a revision, clears verdict caches across tabs, and rejects older in-flight
answers. Corrections survive extension restarts. This is example-based personalization; encoder weights do
not change. Real-feed evaluation is still needed to measure generalization and added latency.
