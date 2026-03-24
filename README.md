# ByeGPT

`ByeGPT` is a Chrome extension for exporting your own visible ChatGPT chats from a logged-in browser session into local JSON files.

The repository name stays `byegpt`. The shipped product is the `ByeGPT` Chrome extension plus the small build and publishing scripts around it.

## Chrome Extension

The extension is aimed at the single-user case where the built-in ChatGPT export is unavailable or insufficient.

What it does:

- Runs only on `chatgpt.com` and `chat.openai.com`.
- Captures JSON responses already loaded in your own browser session.
- Scrapes the visible conversation list from the sidebar.
- Walks each discovered chat URL and stores a local JSON bundle.
- Downloads each conversation as its own `.json` file during the crawl by default.
- Downloads OpenAI-hosted assets referenced by those API responses into `byegpt/conversations/assets/<conversation-id>/`.
- Lets you also export one final combined `.json` file.

What it does not do:

- It does not use an API key.
- It does not access admin-only or workspace-wide data.
- It only captures chats your current signed-in user can already load.

### Load the extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select [`extension`](/Users/leostera/Developer/github.com/leostera/byegpt/extension).

### Use it

1. Sign in to ChatGPT in Chrome.
2. Open the extension popup while on `chatgpt.com`.
3. Click `Start Download`.
4. Leave the tab alone while it walks your chats.
5. It will download per-conversation JSON files as it goes.
6. Click `Export JSON` when finished if you also want one combined bundle.

The extension stores data locally in extension storage until you clear it.
Each per-conversation file now contains only captured API responses plus asset references.
DOM snapshots and crawl metadata are not included in those conversation exports.

### Package the extension

Generate the store assets and package ZIP:

```bash
npm run generate:assets
npm run build:extension
```

This writes:

- `dist/byegpt-extension-v<version>.zip`
- `dist/byegpt-extension-v<version>.zip.sha256`
- `store-assets/` listing images

### Chrome Web Store prep

The repo now includes:

- static pages in `site/` for a homepage and privacy policy
- store listing guidance in [`docs/chrome-web-store.md`](/Users/leostera/Developer/github.com/leostera/byegpt/docs/chrome-web-store.md)
- GitHub Actions for validation, packaging, and optional Pages deployment
- a GitHub Actions workflow for Chrome Web Store upload/publish

Before submitting, you should still do one real browser pass and confirm the screenshots match the latest UI.

### Chrome Web Store publish workflow

The repository includes [`publish-chrome-web-store.yml`](/Users/leostera/Developer/github.com/leostera/byegpt/.github/workflows/publish-chrome-web-store.yml), which can upload a packaged extension to the Chrome Web Store and optionally submit it for review.

Set these repository values first:

- repository variable `CWS_EXTENSION_ID`
- repository secret `CWS_CLIENT_ID`
- repository secret `CWS_CLIENT_SECRET`
- repository secret `CWS_REFRESH_TOKEN`

The workflow uses the [`chrome-webstore-upload-cli`](https://www.npmjs.com/package/chrome-webstore-upload-cli) package, which expects the standard Chrome Web Store OAuth client credentials and refresh token flow.

You can trigger the workflow manually from GitHub Actions, or push a `v*` tag to upload and publish automatically.

### Developer hooks and checks

Install the JavaScript dev tooling and enable the local pre-commit hook:

```bash
npm install
git config --local core.hooksPath .githooks
```

The pre-commit hook runs:

- Biome format checks
- ESLint
- TypeScript `checkJs` typechecks over the extension JavaScript
- Python syntax checks for the helper scripts
- JavaScript smoke tests

Useful commands:

```bash
npm run check:all
npm run format
npm run dev
npm run build:extension
```

### AGENTS routing

This repo uses modular `AGENTS.md` files:

- [`AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/AGENTS.md) routes to the right sub-guide
- [`extension/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/extension/AGENTS.md) covers extension work
- [`scripts/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/scripts/AGENTS.md) covers packaging and asset generation
- [`tests-js/AGENTS.md`](/Users/leostera/Developer/github.com/leostera/byegpt/tests-js/AGENTS.md) covers the smoke tests

## Development

Run the full local gate:

```bash
npm run check:all
```

Build a distributable package:

```bash
npm run build:extension
```
