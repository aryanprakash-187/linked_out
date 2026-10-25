# LinkedOut + Control-X

Two independent browser extensions, each with its own source, models, settings, feedback memory, and development commands.

| Product | Purpose | Documentation | Load in Chrome |
| --- | --- | --- | --- |
| **LinkedOut** | Filter unwanted LinkedIn feed posts with local AI and feedback | [LinkedOut README](linkedout/README.md) | `linkedout/extension/` |
| **Control-X** | **Cut out the junk.** Text-only filtering for the X home timeline | [Control-X README](control-x/README.md) | `control-x/extension/` |

## Repository layout

```text
linked_out/
├── linkedout/
│   ├── extension/        LinkedIn extension, including bundled vendor/model files
│   ├── scripts/
│   ├── tests/
│   ├── eval/
│   ├── package.json
│   └── README.md
├── control-x/
│   ├── extension/        X-only extension, including bundled vendor/model files
│   ├── scripts/
│   ├── tests/
│   ├── eval/
│   ├── package.json
│   └── README.md
└── README.md
```

## Run LinkedOut

```bash
cd linkedout
npm install
# Only if model/vendor files are missing:
npm run setup
npm test
```

Load **linkedout/extension/** as an unpacked extension at `chrome://extensions`.

## Run Control-X

```bash
cd control-x
npm install
# Only if model/vendor files are missing:
npm run setup
npm test
```

Load **control-x/extension/** as an unpacked extension at `chrome://extensions`, then open `https://x.com/home`.
The tagline is **Cut out the junk**. Images, video, and quoted-post text are outside this text-only MVP.

Both extensions can be loaded at once from their separate directories. For each extension, open its settings,
select **On-device**, and save your preferences. Keep optional Claude review disabled for fully local operation.

## Checks from the repository root

```bash
npm test                  # both projects' unit/integration tests
npm run test:linkedout    # LinkedOut only
npm run test:control-x    # Control-X only
npm run test:x-browser   # Control-X browser fixtures; install dependencies/Chromium in control-x first
```

The folders are self-contained rather than workspace packages: install dependencies inside the product you
want to develop. Each folder's scripts resolve its own extension directory. Existing paths from the former flat
layout have moved; reload unpacked extensions using the new directories.

The LinkedOut copy comes from `feat/local-feedback-memory`; Control-X comes from `feat/control-x` before this
reorganization. See each product README for scope, privacy behavior, feedback controls, and testing limitations.
