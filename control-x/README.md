# Control-X
## Cut out the junk

A text-only X home-timeline filter, built from control.'s local AI and personal feedback engine.
Describe what you want to see or hide; the bundled gte-small model filters post text on your device.

## Setup

From the repository root, run cd control-x first. Load control-x/extension/ in Chrome.

1. Check out `feat/control-x`, run `npm install`, and run `npm run setup` if vendor/model files are missing.
2. Load `extension/` as an unpacked extension at `chrome://extensions`.
3. Open Control-X settings, select **On-device**, and save instructions such as “Hide crypto promotions and engagement bait.”
4. Open `https://x.com/home`. Turn off the optional Claude check for fully local operation.

The manifest targets X/Twitter domains only. This branch does not run on LinkedIn.

## Text-only scope

- Filters posts on the home timeline, including For You and Following.
- Reads only the outer post's own text. Excludes quoted-post text and link preview cards.
- Does not analyze images, videos, audio, or text inside media.
- Media-only and quote-only posts stay visible.
- Search, profiles, post-detail pages, notifications and messages are not filtered.
- No ad/repost detection or page-layout removal in this MVP.
- Current intent/model support targets English. Live X markup changes may require updates.

## Feedback

**This should be shown** corrects an AI-hidden post. **Hide more like this** teaches a hide preference
from a visible text post. **Show anyway** reveals a post without teaching.

Corrections are saved locally in a Control-X-specific IndexedDB database, scoped to saved instructions and encoder
version. Exact corrected text uses the explicit decision immediately. Unseen posts require at least three highly
similar agreeing examples and sufficient separation from opposing examples. Otherwise the original filter decides.
These thresholds are initial settings, not a measured accuracy guarantee.

Use **Undo correction** after saving, or **Reset learning for these instructions** in settings.
The memory cap is 1,000 corrections across profiles. Encoder weights do not change; no additional model is needed.
Settings, secrets, and feedback storage are separate from the LinkedIn version.

## Architecture

```text
X article → outer tweetText → keyword rules → revisioned cache
                                            → gte-small embedding
                                                ├─ personal correction match
                                                └─ topic/anchor filter
                                            → optional Claude for uncertain posts
                                            → collapse or show
```

Errors show posts. Claude sends post text to Anthropic and can incur API charges when enabled.
With Claude disabled, classification and feedback stay local. Model/update distribution still needs infrastructure.

| File | Purpose |
| --- | --- |
| `extension/content/x.js` | X extraction, post IDs, text-change keys |
| `extension/content/content.js` | Filtering, reveal and feedback controls; recycled-element handling |
| `extension/offscreen/offscreen.js` | Existing bundled encoder and serialized feedback operations |
| `extension/shared/feedback-memory.js` | Local example matching |
| `extension/offscreen/feedback-store.js` | Control-X IndexedDB persistence |
| `extension/shared/settings.js` | Control-X settings and secret keys |
| `extension/options/`, `extension/popup/` | Branding, preferences, status |

## Verification

Validated for this change: **42 shared tests and 2 browser fixture tests passed**. Browser tests use mocked
classification and messaging; they are not a live-X or real-model performance benchmark.

Run `npm test` for shared logic and feedback tests.
Run `npx playwright install chromium`, then `node --test tests/browser/control-x.test.cjs` for the X browser fixture.

The browser fixture checks outer-text extraction, quote/media exclusions, reveal versus feedback, newly inserted
posts, recycled elements and navigation. It mocks model responses and extension messaging and does not require
an X login. It does not measure live-X compatibility or model accuracy. Inherited LinkedIn e2e tests are not
the validation target for this X variant.

Manual smoke test: open X home, scroll, reveal a hidden post, correct a decision, undo/reset, reload, and verify
that media-only posts and non-home pages remain untouched.

The LinkedIn version remains on [feat/local-feedback-memory](https://github.com/aryanprakash-187/linked_out/tree/feat/local-feedback-memory).
