# Contributing

This repository ships the `ByeGPT` Chrome extension and the tooling around building and publishing it.

## Prerequisites

- Node.js 22 or newer
- npm
- Google Chrome
- Python 3, only for the store-asset generation helper

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Enable the repo-local Git hooks:

```bash
git config --local core.hooksPath .githooks
```

3. Generate store and icon assets once:

```bash
npm run generate:assets
```

## Daily Development Flow

Recommended loop:

1. Make your changes.
2. Run the auto-fix pass:

```bash
npm run fix
```

3. Run the full local gate:

```bash
npm run check:all
```

4. Build the extension:

```bash
npm run build:extension
```

5. Load [`dist/unpacked`](/Users/leostera/Developer/github.com/leostera/byegpt/dist/unpacked) into `chrome://extensions` and test it in a real ChatGPT session.

## Useful Commands

```bash
npm run dev
npm run format
npm run lint
npm run typecheck
npm run test
npm run build:extension
```

`npm run build:extension` writes:

- [`dist/unpacked`](/Users/leostera/Developer/github.com/leostera/byegpt/dist/unpacked)
- [`dist/byegpt-extension-v0.1.0.zip`](/Users/leostera/Developer/github.com/leostera/byegpt/dist/byegpt-extension-v0.1.0.zip) for the current version
- a matching `.sha256` file

## Project Layout

- [`extension/`](/Users/leostera/Developer/github.com/leostera/byegpt/extension) contains the extension source.
- [`scripts/`](/Users/leostera/Developer/github.com/leostera/byegpt/scripts) contains the small helper scripts.
- [`tests-js/`](/Users/leostera/Developer/github.com/leostera/byegpt/tests-js) contains smoke tests.
- [`site/`](/Users/leostera/Developer/github.com/leostera/byegpt/site) contains the homepage and privacy policy.
- [`docs/`](/Users/leostera/Developer/github.com/leostera/byegpt/docs) contains store and reviewer notes.

## Contribution Rules

- Keep the extension local-first. Do not add telemetry or a remote backend.
- Keep conversation exports API-derived only.
- Do not add DOM snapshots or crawl-job metadata to exported conversation JSON.
- If you change permissions or data handling, update:
  - [`extension/manifest.json`](/Users/leostera/Developer/github.com/leostera/byegpt/extension/manifest.json)
  - [`docs/chrome-web-store.md`](/Users/leostera/Developer/github.com/leostera/byegpt/docs/chrome-web-store.md)
  - [`site/privacy-policy.html`](/Users/leostera/Developer/github.com/leostera/byegpt/site/privacy-policy.html)

## AGENTS Guides

Use the scoped guidance in:

- [`AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/AGENTS.md)
- [`extension/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/extension/AGENTS.md)
- [`scripts/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/scripts/AGENTS.md)
- [`tests-js/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/tests-js/AGENTS.md)

## Release And Store Publishing

Package validation and artifacts are produced by:

- [`.github/workflows/extension-ci.yml`](/Users/leostera/Developer/github.com/leostera/byegpt/.github/workflows/extension-ci.yml)
- [`.github/workflows/release-extension.yml`](/Users/leostera/Developer/github.com/leostera/byegpt/.github/workflows/release-extension.yml)
- [`.github/workflows/publish-chrome-web-store.yml`](/Users/leostera/Developer/github.com/leostera/byegpt/.github/workflows/publish-chrome-web-store.yml)

Chrome Web Store setup details live in [`docs/chrome-web-store.md`](/Users/leostera/Developer/github.com/leostera/byegpt/docs/chrome-web-store.md).
