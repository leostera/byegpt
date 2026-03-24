// Background runtime responsibilities are intentionally narrow:
// accept download requests from the content script and emit local files.
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  chrome.tabs
    .sendMessage(tab.id, { type: "byegpt:focus-overlay" })
    .catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "byegpt:download-json") {
    downloadJson(message.payload)
      .then(function (downloadId) {
        sendResponse({ ok: true, downloadId: downloadId });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "byegpt:download-asset") {
    downloadAsset(message.payload)
      .then(function (downloadId) {
        sendResponse({ ok: true, downloadId: downloadId });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "byegpt:list-saved-conversations") {
    listSavedConversationIds()
      .then(function (conversationIds) {
        sendResponse({ ok: true, conversationIds: conversationIds });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
});

async function downloadJson(payload) {
  if (!payload || !payload.filename) {
    throw new Error("Missing download payload.");
  }

  var json = JSON.stringify(payload.data, null, 2);
  var url = "data:application/json;charset=utf-8," + encodeURIComponent(json);
  var downloadId = await chrome.downloads.download({
    url: url,
    filename: payload.filename,
    saveAs: Boolean(payload.saveAs),
    conflictAction:
      payload.conflictAction || (payload.saveAs ? "uniquify" : "overwrite"),
  });
  return downloadId;
}

async function downloadAsset(payload) {
  if (!payload || !payload.filename || (!payload.dataUrl && !payload.url)) {
    throw new Error("Missing asset download payload.");
  }

  var downloadId = await chrome.downloads.download({
    url: payload.url || payload.dataUrl,
    filename: payload.filename,
    saveAs: false,
    conflictAction: "overwrite",
  });
  return downloadId;
}

async function listSavedConversationIds() {
  var items = await chrome.downloads.search({
    filenameRegex:
      "[\\\\/]byegpt[\\\\/]conversations[\\\\/](?!assets[\\\\/]).+\\.json$",
  });

  var ids = [];
  items.forEach(function (item) {
    if (!item || item.state !== "complete" || item.exists === false) {
      return;
    }

    var match = item.filename.match(
      /[\\/]byegpt[\\/]conversations[\\/](?!assets[\\/])([^\\/]+?)(?:__[^\\/]+)?\.json$/i,
    );
    if (match && match[1]) {
      ids.push(match[1]);
    }
  });

  return Array.from(new Set(ids));
}
