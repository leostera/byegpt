// The popup is a thin control surface for the active ChatGPT tab.
var CAPTURE_KEY = "byegpt.capture";
var JOB_KEY = "byegpt.job";
var POPUP_HEARTBEAT_KEY = "byegpt.popupHeartbeat";
var popupHeartbeatTimer = null;
var popupRefreshTimer = null;

document.addEventListener("DOMContentLoaded", function () {
  startPopupHeartbeat();
  startPopupRefresh();

  document
    .getElementById("captureCurrent")
    .addEventListener("click", function () {
      runTabAction("byegpt:capture-current", "Captured current chat.");
    });

  document.getElementById("startCrawl").addEventListener("click", function () {
    runTabAction(
      "byegpt:start-crawl",
      "Started download. Close the popup and watch the in-page tracker.",
    );
  });

  document.getElementById("stopCrawl").addEventListener("click", function () {
    runTabAction("byegpt:stop-crawl", "Stopped download.");
  });

  document
    .getElementById("restartCrawl")
    .addEventListener("click", function () {
      runTabAction(
        "byegpt:restart-crawl",
        "Restarted crawl state. Existing files on disk were not deleted.",
      );
    });

  document.getElementById("exportJson").addEventListener("click", exportJson);

  refresh().catch(function (error) {
    setMessage(String(error));
  });
});

async function refresh() {
  var status = await getStatusFromStorage();
  document.getElementById("conversationCount").textContent = String(
    status.conversationCount || 0,
  );
  document.getElementById("networkEventCount").textContent = String(
    status.networkEventCount || 0,
  );
  document.getElementById("discoveredChatCount").textContent = String(
    status.discoveredChatCount || 0,
  );
  document.getElementById("downloadedConversationCount").textContent = String(
    status.downloadedConversationCount || 0,
  );
  document.getElementById("jobStatus").textContent = formatJobStatus(
    status.job,
  );
  document.getElementById("activityStatus").textContent =
    formatActivityStatus(status);
}

async function runTabAction(messageType, successMessage) {
  try {
    var tab = await getActiveTab();
    var response = await chrome.tabs.sendMessage(tab.id, { type: messageType });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Action failed.");
    }
    setMessage(successMessage);
    await refresh();
  } catch (error) {
    setMessage(formatExtensionError(error));
  }
}

async function getStatusFromStorage() {
  var stored = await chrome.storage.local.get([CAPTURE_KEY, JOB_KEY]);
  var capture = stored[CAPTURE_KEY] || {
    conversations: {},
    networkEvents: [],
    discoveredChats: [],
  };
  var latestDownload = findLatestDownload(capture.conversations || {});
  return {
    conversationCount: Object.keys(capture.conversations || {}).length,
    networkEventCount: (capture.networkEvents || []).length,
    discoveredChatCount: (capture.discoveredChats || []).length,
    downloadedConversationCount: countDownloadedConversations(
      capture.conversations || {},
    ),
    latestDownload: latestDownload,
    job: stored[JOB_KEY] || null,
  };
}

async function exportJson() {
  try {
    var stored = await chrome.storage.local.get([CAPTURE_KEY]);
    var capture = stored[CAPTURE_KEY] || { conversations: {} };
    var payload = {
      conversations: Object.keys(capture.conversations || {}).map(
        function (conversationId) {
          return sanitizeConversationExport(
            capture.conversations[conversationId],
          );
        },
      ),
    };
    await chrome.runtime.sendMessage({
      type: "byegpt:download-json",
      payload: {
        filename: "byegpt/byegpt-export-" + timestampSlug() + ".json",
        data: payload,
        saveAs: true,
      },
    });
    setMessage("Downloaded JSON export.");
  } catch (error) {
    setMessage(formatExtensionError(error));
  }
}

function formatJobStatus(job) {
  if (!job) {
    return "Idle";
  }
  if (job.active) {
    if (job.pausedReason === "popup_open") {
      return "Paused while popup is open";
    }
    if (job.phase === "inventory") {
      return (
        "Inventorying: " +
        (job.inventoryCount || (job.seenUrls || []).length || 0) +
        " found so far"
      );
    }
    return (
      "Running: " +
      (job.visitedUrls || []).length +
      " visited, " +
      (job.pendingUrls || []).length +
      " pending, " +
      ((job.skippedUrls || []).length || job.skippedCount || 0) +
      " skipped"
    );
  }
  if (job.completedAt) {
    return "Completed at " + new Date(job.completedAt).toLocaleTimeString();
  }
  if (job.stoppedAt) {
    return "Stopped at " + new Date(job.stoppedAt).toLocaleTimeString();
  }
  return "Idle";
}

function formatActivityStatus(status) {
  if (
    status.job &&
    status.job.active &&
    status.job.pausedReason === "popup_open"
  ) {
    return "Paused while the popup is open. Close it to let downloads continue.";
  }
  if (status.job && status.job.active && status.job.phase === "inventory") {
    return "Scanning the sidebar to build the full chat list before downloading.";
  }
  if (status.job && status.job.stoppedAt) {
    return "Download stopped. Existing files stay on disk.";
  }
  if (status.latestDownload) {
    return (
      "Last saved: " +
      status.latestDownload.label +
      " at " +
      new Date(status.latestDownload.downloadedAt).toLocaleTimeString()
    );
  }
  if (status.job && status.job.active) {
    return "Running. Files should appear in the conversations folder as each chat finishes.";
  }
  return "No downloads yet";
}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tabs.length) {
    throw new Error("No active tab.");
  }
  return tabs[0];
}

function setMessage(text) {
  document.getElementById("message").textContent = text || "";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function startPopupHeartbeat() {
  updatePopupHeartbeat();
  popupHeartbeatTimer = setInterval(updatePopupHeartbeat, 1000);
}

function startPopupRefresh() {
  popupRefreshTimer = setInterval(function () {
    refresh().catch(function (error) {
      setMessage(formatExtensionError(error));
    });
  }, 1000);
}

function updatePopupHeartbeat() {
  var payload = {};
  payload[POPUP_HEARTBEAT_KEY] = Date.now();
  chrome.storage.local.set(payload).catch(function () {});
}

window.addEventListener("unload", function () {
  if (popupHeartbeatTimer) {
    clearInterval(popupHeartbeatTimer);
    popupHeartbeatTimer = null;
  }
  if (popupRefreshTimer) {
    clearInterval(popupRefreshTimer);
    popupRefreshTimer = null;
  }
  var payload = {};
  payload[POPUP_HEARTBEAT_KEY] = 0;
  try {
    chrome.storage.local.set(payload);
  } catch (error) {}
});

function formatExtensionError(error) {
  var message = String(error && error.message ? error.message : error);
  if (
    message.indexOf("Receiving end does not exist") >= 0 ||
    message.indexOf("Extension context invalidated") >= 0
  ) {
    return "Refresh the ChatGPT tab after reloading the extension, then try again.";
  }
  return message;
}

function sanitizeConversationExport(conversation) {
  return {
    conversation_id: conversation.id,
    title: conversation.title || null,
    api_responses: conversation.apiEvents || [],
    assets: (conversation.assets || []).map(function (asset) {
      return {
        asset_id: asset.assetId,
        original_url: asset.url,
        relative_path: asset.relativePath || null,
        source_event_ids: asset.sourceEventIds || [],
        source_json_paths: asset.sourceJsonPaths || [],
      };
    }),
  };
}

function countDownloadedConversations(conversations) {
  return Object.keys(conversations).filter(function (id) {
    return Boolean(
      conversations[id] &&
        conversations[id].exportMetadata &&
        conversations[id].exportMetadata.downloadedAt,
    );
  }).length;
}

function findLatestDownload(conversations) {
  var latest = null;

  Object.keys(conversations).forEach(function (id) {
    var conversation = conversations[id];
    if (
      !conversation ||
      !conversation.exportMetadata ||
      !conversation.exportMetadata.downloadedAt
    ) {
      return;
    }

    if (
      !latest ||
      conversation.exportMetadata.downloadedAt > latest.downloadedAt
    ) {
      latest = {
        id: id,
        label: conversation.title || id,
        downloadedAt: conversation.exportMetadata.downloadedAt,
        filename: conversation.exportMetadata.lastDownloadedFilename || null,
      };
    }
  });

  return latest;
}
