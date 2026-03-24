# Extension Agent Guide

## Scope

This directory contains the Chrome extension that exports visible ChatGPT conversations into local JSON files.

## Editing rules

- Preserve the local-only privacy model. Do not introduce any remote backend, telemetry, or analytics.
- Keep per-conversation exports API-derived only. Do not add DOM snapshots or crawl-job metadata into exported conversation JSON.
- Asset downloads may use DOM or page-session context as a transport mechanism, but the stored conversation metadata should still come from API responses.
- Prefer stable filenames:
  - conversations: `byegpt/conversations/<conversation-id>.json`
  - assets: `byegpt/conversations/assets/<conversation-id>/...`
- If you change the crawl flow, keep reviewer usability in mind:
  - visible progress
  - deterministic order
  - clear stop/restart behavior
- If you change permissions or host permissions, update:
  - `extension/manifest.json`
  - `docs/chrome-web-store.md`
  - `site/privacy-policy.html` if data handling changes

## Code organization

- Keep `background.js` limited to download and extension-runtime concerns.
- Keep `injected.js` limited to page-context interception and page-context fetch bridges.
- Keep `popup.js` limited to popup state and controls.
- Keep `content.js` as the orchestrator, but prefer extracting helpers instead of growing single-function complexity.
