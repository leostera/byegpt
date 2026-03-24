# byegpt

`byegpt` exports the OpenAI data surfaces you can actually reach.

There are two modes:

- A Chrome extension for exporting your own visible ChatGPT chats from a logged-in browser session.
- A Python CLI for supported API-side objects and consumer export zips.

## Chrome Extension

The extension is the recommended path for a single-user ChatGPT Business workspace where the built-in export is unavailable.

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

## Python CLI

The CLI covers officially supported surfaces:

- Import a ChatGPT consumer export `.zip` and normalize JSON payloads.
- Export API-side Responses and Conversations data when you already know the object IDs.

### Install

```bash
python3 -m pip install -e .
```

Or run it directly:

```bash
python3 -m byegpt --help
```

### Usage

Import an official ChatGPT export archive:

```bash
python3 -m byegpt import-chatgpt-export ~/Downloads/chatgpt-export.zip ./exports/chatgpt
```

Export known API object IDs:

```bash
export OPENAI_API_KEY=...
python3 -m byegpt export-api ./exports/api \
  --conversation conv_123 \
  --response resp_456
```

Read IDs from files:

```bash
python3 -m byegpt export-api ./exports/api \
  --conversation-file conversations.txt \
  --response-file responses.txt
```

`conversations.txt` and `responses.txt` are newline-delimited. Blank lines and `# comments` are ignored.

### Output layout

`import-chatgpt-export` writes:

- `raw/`: every file from the archive, preserved as-is
- `normalized/`: pretty-printed JSON files from the archive
- `manifest.json`: summary, hashes, and file inventory

`export-api` writes:

- `conversations/<id>.json`
- `responses/<id>.json`
- `manifest.json`

## Development

Run Python tests:

```bash
python3 -m unittest discover -s tests -v
```
