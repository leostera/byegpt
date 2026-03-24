# ByeGPT

`ByeGPT` exports the ChatGPT conversations you can already see in your own browser session into local JSON files.

It is built for the simple case:

- you are signed in to ChatGPT
- you want a local copy of your chats
- you want structured data you can actually work with

## What You Get

- one JSON file per conversation
- downloaded assets grouped under that conversation
- an optional combined JSON export
- a visible in-page progress tracker while the crawl runs

Everything is local-first. ByeGPT does not use an API key and does not ship your exported chat data to a backend operated by this project.

## Download

Use whichever path is available:

1. Chrome Web Store
   Install ByeGPT there once the extension is published.
2. GitHub Releases
   Download the latest `byegpt-extension-v*.zip`, unzip it, then load the unpacked extension in Chrome.
3. Local build
   Build it from source and load `dist/unpacked`.

## Load It In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the unpacked extension folder.

If you downloaded a release ZIP, select the unzipped folder.

If you built from source, select [`dist/unpacked`](/Users/leostera/Developer/github.com/leostera/byegpt/dist/unpacked).

## Use It

1. Sign in to ChatGPT in Chrome.
2. Open `https://chatgpt.com/`.
3. Click the ByeGPT extension.
4. Click `Start Download`.
5. Close the popup and let the tab run.
6. Watch the in-page tracker in the bottom-right corner.

ByeGPT will:

- inventory your conversation list
- skip conversations that were already downloaded
- open each remaining chat
- save each conversation as it goes

## Where The Files Go

The extension writes files under your Downloads folder like this:

```text
byegpt/
  conversations/
    <conversation-id>.json
    assets/
      <conversation-id>/
        <asset files>
```

You can also use `Export JSON` in the popup if you want one combined bundle.

## What The JSON Looks Like

Each conversation file contains API-derived data only:

```json
{
  "conversation_id": "...",
  "title": "...",
  "api_responses": [],
  "assets": []
}
```

Each asset entry includes the original URL plus a `relative_path` pointing to the downloaded local file when one exists.

## How To Use The Data

Common ways to use the export:

- archive your ChatGPT history locally
- load conversations into notebooks or analysis scripts
- index them in your own search system
- convert them into another schema for internal tools

The JSON files are designed to be easy to process with `jq`, Python, JavaScript, DuckDB, or your own pipeline.

## Limits

- ByeGPT only exports chats your current signed-in user can already access.
- It does not provide an admin or workspace-wide export.
- It does not use undocumented server-side privileges.
- It depends on the current ChatGPT web app behavior, so site changes can break parts of the crawler.

## Privacy

ByeGPT stores crawl state locally in extension storage while it is working and writes exported files to your local machine.

- Privacy policy: [`site/privacy-policy.html`](/Users/leostera/Developer/github.com/leostera/byegpt/site/privacy-policy.html)
- Store submission notes: [`docs/chrome-web-store.md`](/Users/leostera/Developer/github.com/leostera/byegpt/docs/chrome-web-store.md)

## Contributing

Contributor setup, local development, and release workflow notes live in [`CONTRIBUTING.md`](/Users/leostera/Developer/github.com/leostera/byegpt/CONTRIBUTING.md).
