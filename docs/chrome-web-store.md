# Chrome Web Store Submission Notes

This repository is set up to package the `ByeGPT` extension and produce the basic listing assets needed for a Chrome Web Store submission.

## Proposed listing

- Name: `ByeGPT`
- Summary: `Export your visible ChatGPT chats and assets into local JSON files.`
- Category: `Productivity`
- Language: `English`

## Detailed description

`ByeGPT` exports the ChatGPT conversations that are already visible in your signed-in browser session.

It builds an inventory of your conversation list, opens each chat, captures the JSON responses already used by the ChatGPT web app, downloads referenced assets, and writes each conversation to a local JSON file.

What it does:

- exports one JSON file per visible conversation
- downloads referenced assets into a per-conversation folder
- shows in-page crawl progress while it works
- skips conversations that were already downloaded

What it does not do:

- it does not use an OpenAI API key
- it does not access workspace-wide or admin-only data
- it does not send exported conversation data to any remote service operated by this project

## Single purpose statement

The extension has a single purpose: export the current user's own visible ChatGPT conversation data and related assets from the ChatGPT web app into local files.

## Permission justifications

- `activeTab`: used to start export actions from the currently active ChatGPT tab.
- `tabs`: used to message the active ChatGPT tab and drive the crawl across conversation URLs.
- `storage`: used to keep local crawl state and captured API responses until they are exported.
- `downloads`: used to write conversation JSON files and asset files to the user's Downloads folder.
- `unlimitedStorage`: used to avoid truncating locally captured conversation data during long exports.

## Host permission justifications

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

Required because the extension runs only on the ChatGPT web app and captures the JSON responses already present in that page.

- `https://*.oaistatic.com/*`
- `https://*.oaiusercontent.com/*`
- `https://cdn.openai.com/*`

Required to download assets referenced by exported conversations.

## Privacy disclosure guidance

In the Chrome Web Store privacy section, the safest truthful position for this extension is:

- Personal communications: `Yes`
- Website content: `Yes`
- User activity: `Yes`
- Data sold: `No`
- Data used for creditworthiness or lending: `No`
- Data shared with third parties: `No`, except the normal transfer to the user-selected local download destination handled by Chrome

The extension processes conversation content locally in the browser and writes it to local files. It does not send captured conversation data to servers operated by this project.

## Reviewer test instructions

1. Install the unpacked extension ZIP.
2. Sign in to a test ChatGPT account.
3. Open `https://chatgpt.com/`.
4. Open the `ByeGPT` popup and click `Start Download`.
5. Close the popup and watch the in-page progress widget in the bottom-right corner.
6. Verify that conversation JSON files appear in the Downloads folder under `byegpt/conversations/`.
7. Open one exported JSON file and confirm it contains API-derived conversation data and asset references.

## Included assets

- Store icon: `extension/icons/icon-128.png`
- Screenshot: `store-assets/screenshot-01.png`
- Small promo image: `store-assets/promo-small-440x280.png`
- Optional marquee promo image: `store-assets/promo-marquee-1400x560.png`

## Manual steps before submission

1. Verify the latest screenshots still match the current extension UI.
2. Publish the static site from `site/` and use the privacy-policy page URL in the store dashboard.
3. Provide a support email address in the store listing.
4. Reconfirm the data-use answers in the privacy questionnaire before submission.

## Naming caution

`ByeGPT` is the current working name in this repository. Because `GPT` is a protected brand term, be prepared to rename the extension if either OpenAI brand policy or Chrome Web Store review objects to the title.
