// Content script orchestrator.
// Responsibilities are grouped here as:
// 1. runtime message wiring
// 2. crawl lifecycle and sidebar inventory
// 3. capture normalization and persistence
// 4. per-conversation export and asset downloads
// 5. in-page progress overlay
(function () {
  var CAPTURE_KEY = "byegpt.capture";
  var JOB_KEY = "byegpt.job";
  var SETTINGS_KEY = "byegpt.settings";
  var OVERLAY_ID = "byegpt-progress-overlay";
  var extensionContextInvalidated = false;
  var resumeRetryTimer = null;
  var overlayRefreshTimer = null;
  var overlayFocusTimer = null;
  var cachedSidebarContainer = null;
  var pendingAssetFetches = {};

  ensureSettings();
  injectPageScript();
  window.addEventListener("message", onWindowMessage);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  startOverlayRefresh();
  setTimeout(resumeCrawlIfNeeded, 1500);

  function injectPageScript() {
    if (document.documentElement.dataset.byegptInjected === "true") {
      return;
    }

    document.documentElement.dataset.byegptInjected = "true";

    var script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.async = false;
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function onWindowMessage(event) {
    if (extensionContextInvalidated || !isExtensionContextAvailable()) {
      return;
    }

    if (event.source !== window) {
      return;
    }

    var data = event.data;
    if (!data || data.source !== "byegpt") {
      return;
    }

    if (data.type === "network-event") {
      persistNetworkEvent(data.payload).catch(function (error) {
        if (isExtensionContextInvalidatedError(error)) {
          teardownInvalidatedContext();
          return;
        }
        console.warn("byegpt skipped a network event", error);
      });
      return;
    }

    if (data.type === "asset-fetch-response") {
      resolvePendingAssetFetch(data.payload);
      return;
    }
  }

  function resolvePendingAssetFetch(payload) {
    if (
      !payload ||
      !payload.requestId ||
      !pendingAssetFetches[payload.requestId]
    ) {
      return;
    }

    var pending = pendingAssetFetches[payload.requestId];
    delete pendingAssetFetches[payload.requestId];

    if (!payload.ok) {
      pending.reject(new Error(payload.error || "Asset fetch failed."));
      return;
    }

    pending.resolve(payload);
  }

  function rejectAllPendingAssetFetches(errorMessage) {
    Object.keys(pendingAssetFetches).forEach(function (requestId) {
      pendingAssetFetches[requestId].reject(new Error(errorMessage));
      delete pendingAssetFetches[requestId];
    });
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "byegpt:get-status") {
      getStatus().then(sendResponse);
      return true;
    }

    if (message.type === "byegpt:focus-overlay") {
      focusOverlay();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "byegpt:capture-current") {
      captureCurrentConversation()
        .then(function (result) {
          sendResponse({ ok: true, result: result });
        })
        .catch(function (error) {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }

    if (message.type === "byegpt:start-crawl") {
      startCrawl()
        .then(function (result) {
          sendResponse({ ok: true, result: result });
        })
        .catch(function (error) {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }

    if (message.type === "byegpt:stop-crawl") {
      stopCrawl()
        .then(function (result) {
          sendResponse({ ok: true, result: result });
        })
        .catch(function (error) {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }

    if (message.type === "byegpt:restart-crawl") {
      restartCrawl()
        .then(function (result) {
          sendResponse({ ok: true, result: result });
        })
        .catch(function (error) {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }
  }

  async function getStatus() {
    var stored = await getFromStorage([CAPTURE_KEY, JOB_KEY, SETTINGS_KEY]);
    var capture = stored[CAPTURE_KEY] || emptyCapture();
    var job = stored[JOB_KEY] || null;
    var settings = mergeSettings(stored[SETTINGS_KEY]);

    return {
      url: window.location.href,
      title: document.title,
      conversationCount: Object.keys(capture.conversations || {}).length,
      networkEventCount: Number(capture.stats.capturedApiResponseCount || 0),
      discoveredChatCount: calculateDiscoveredChatCount(job),
      downloadedConversationCount: Number(
        capture.stats.downloadedConversationCount || 0,
      ),
      latestDownload: capture.stats.latestDownload || null,
      knownTotalCount: calculateKnownTotal(job),
      autoDownloadConversations: Boolean(settings.autoDownloadConversations),
      job: job,
    };
  }

  async function startCrawl() {
    if (resumeRetryTimer) {
      clearTimeout(resumeRetryTimer);
      resumeRetryTimer = null;
    }

    rejectAllPendingAssetFetches("Started a new crawl.");
    await setInStorage(CAPTURE_KEY, emptyCapture());

    var settings = await loadSettings();
    var currentUrl = normalizeConversationUrl(window.location.href) || null;
    var seenUrls = currentUrl ? [currentUrl] : [];

    var job = {
      runId: createRunId(),
      active: true,
      phase: "inventory",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingUrls: [],
      visitedUrls: [],
      failedUrls: [],
      skippedUrls: [],
      skippedCount: 0,
      inventoryCount: seenUrls.length,
      currentUrl: currentUrl,
      autoDownloadConversations: Boolean(settings.autoDownloadConversations),
      seenUrls: seenUrls,
      savedConversationIds: [],
    };

    await setInStorage(JOB_KEY, job);
    await runCrawlTick(job.runId);

    return {
      discoveredCount: seenUrls.length,
    };
  }

  async function resumeCrawlIfNeeded() {
    var stored = await getFromStorage([JOB_KEY]);
    var job = stored[JOB_KEY];
    if (!job || !job.active) {
      return;
    }

    runCrawlTick(job.runId).catch(function (error) {
      console.error("byegpt crawl resume failed", error);
    });
  }

  async function stopCrawl() {
    await restartCrawl();
    return { stopped: true, reset: true };
  }

  async function restartCrawl() {
    if (resumeRetryTimer) {
      clearTimeout(resumeRetryTimer);
      resumeRetryTimer = null;
    }

    rejectAllPendingAssetFetches("Restarted crawl.");
    await setInStorage(CAPTURE_KEY, emptyCapture());
    await setInStorage(JOB_KEY, null);
    return { restarted: true };
  }

  async function runCrawlTick(runId) {
    var job = await loadActiveJob(runId);
    if (!job || !job.active) {
      return;
    }

    if (job.phase === "inventory") {
      var inventoryResult = await inventoryAllConversations(job, runId);
      if (inventoryResult && inventoryResult.cancelled) {
        return;
      }
      if (!(await isRunCurrent(runId))) {
        return;
      }

      job = (await loadMatchingJob(runId)) || job;
      if (!job.active) {
        return;
      }

      var inventoryUrls = dedupe(
        (job.seenUrls || []).concat(job.currentUrl ? [job.currentUrl] : []),
      );
      var savedConversationIds = await fetchSavedConversationIds();
      if (!(await isRunCurrent(runId))) {
        return;
      }
      var savedLookup = {};
      savedConversationIds.forEach(function (conversationId) {
        savedLookup[conversationId] = true;
      });

      job.phase = "crawl";
      job.savedConversationIds = savedConversationIds;
      job.inventoryCount = inventoryUrls.length;
      job.skippedUrls = [];
      job.pendingUrls = [];

      inventoryUrls.forEach(function (url) {
        var conversationId = extractConversationId(url);
        if (!conversationId) {
          return;
        }
        if (savedLookup[conversationId]) {
          job.skippedUrls.push(url);
          return;
        }
        job.pendingUrls.push(url);
      });

      job.skippedUrls = dedupe(job.skippedUrls);
      job.pendingUrls = dedupe(job.pendingUrls);
      job.skippedCount = job.skippedUrls.length;
      job.updatedAt = new Date().toISOString();
      if (!(await persistJobIfCurrent(job))) {
        return;
      }
    }

    if (!(await isRunCurrent(runId))) {
      return;
    }

    job = (await loadActiveJob(runId)) || job;
    var currentUrl = normalizeConversationUrl(window.location.href);
    var nextUrl = (job.pendingUrls || [])[0] || null;

    if (!nextUrl) {
      job.active = false;
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      if (!(await persistJobIfCurrent(job))) {
        return;
      }
      return;
    }

    if (currentUrl !== nextUrl) {
      job.currentUrl = nextUrl;
      job.updatedAt = new Date().toISOString();
      if (!(await persistJobIfCurrent(job))) {
        return;
      }
      await navigateToConversation(nextUrl);
      scheduleResumeRetry(runId);
      return;
    }

    await waitForPageSettled();
    if (!(await isRunCurrent(runId))) {
      return;
    }
    var currentId = extractConversationId(currentUrl);
    if (currentId) {
      await waitForConversationData(currentId, 5000);
      if (!(await isRunCurrent(runId))) {
        return;
      }
      await maybeDownloadConversation(currentId, "crawl");
      if (!(await isRunCurrent(runId))) {
        return;
      }
    }

    job = (await loadActiveJob(runId)) || job;
    if (currentUrl) {
      job.pendingUrls = (job.pendingUrls || []).filter(function (url) {
        return url !== currentUrl;
      });
      if ((job.visitedUrls || []).indexOf(currentUrl) === -1) {
        job.visitedUrls.push(currentUrl);
      }
    }

    job.updatedAt = new Date().toISOString();
    if (!(await persistJobIfCurrent(job))) {
      return;
    }

    await runCrawlTick(runId);
  }

  // Inventory the full sidebar first so the crawl order is deterministic and we can
  // skip conversations that already exist on disk before opening them again.
  async function inventoryAllConversations(job, runId) {
    if (!(await isRunCurrent(runId))) {
      return { cancelled: true };
    }
    await scrollSidebarToTop();
    if (!(await isRunCurrent(runId))) {
      return { cancelled: true };
    }
    await waitForSidebarLazyLoad(job, 1200, runId);
    if (!(await isRunCurrent(runId))) {
      return { cancelled: true };
    }

    var stableBottomRounds = 0;

    for (var round = 0; round < 200; round += 1) {
      if (!(await isRunCurrent(runId))) {
        return { cancelled: true };
      }
      var beforeSeenCount = (job.seenUrls || []).length;
      await ingestSidebarEntries(job, runId);
      if (!(await isRunCurrent(runId))) {
        return { cancelled: true };
      }

      var scrollState = await scrollSidebarForMoreChats();
      var lazyLoadResult = await waitForSidebarLazyLoad(
        job,
        scrollState.moved ? 1600 : 2200,
        runId,
      );
      if (!(await isRunCurrent(runId))) {
        return { cancelled: true };
      }
      var afterSeenCount = (job.seenUrls || []).length;
      var grew = afterSeenCount > beforeSeenCount || lazyLoadResult.grew;

      if (grew) {
        stableBottomRounds = 0;
      } else if (scrollState.atBottom) {
        stableBottomRounds += 1;
      } else {
        stableBottomRounds = 0;
      }

      if (stableBottomRounds >= 4) {
        break;
      }
    }

    await scrollSidebarToTop();
    return {
      cancelled: false,
      inventoryCount: (job.seenUrls || []).length,
    };
  }

  async function ingestSidebarEntries(job, runId) {
    if (!(await isRunCurrent(runId))) {
      return 0;
    }
    var entries = await collectSidebarEntries();
    if (!(await isRunCurrent(runId))) {
      return 0;
    }

    job.seenUrls = dedupe(
      (job.seenUrls || []).concat(
        entries.map(function (entry) {
          return entry.url;
        }),
      ),
    );
    job.inventoryCount = (job.seenUrls || []).length;
    job.updatedAt = new Date().toISOString();
    if (!(await persistJobIfCurrent(job))) {
      return 0;
    }

    return entries.length;
  }

  async function waitForSidebarLazyLoad(job, timeoutMs, runId) {
    var deadline = Date.now() + timeoutMs;
    var grew = false;
    var stablePolls = 0;
    var previousCount = (job.seenUrls || []).length;

    while (Date.now() < deadline) {
      if (!(await isRunCurrent(runId))) {
        return {
          cancelled: true,
          grew: grew,
          count: (job.seenUrls || []).length,
        };
      }
      await sleep(350);
      await ingestSidebarEntries(job, runId);
      if (!(await isRunCurrent(runId))) {
        return {
          cancelled: true,
          grew: grew,
          count: (job.seenUrls || []).length,
        };
      }

      var currentCount = (job.seenUrls || []).length;
      if (currentCount > previousCount) {
        grew = true;
        stablePolls = 0;
      } else {
        stablePolls += 1;
      }

      previousCount = currentCount;
      if (stablePolls >= 3) {
        break;
      }
    }

    return {
      cancelled: false,
      grew: grew,
      count: (job.seenUrls || []).length,
    };
  }

  async function captureCurrentConversation() {
    var currentId = extractConversationId(window.location.href);
    if (!currentId) {
      return { downloaded: false, reason: "no-conversation-id" };
    }

    await waitForConversationData(currentId, 5000);
    await maybeDownloadConversation(currentId, "manual");
    return { downloaded: true, conversationId: currentId };
  }

  function findScrollableChatContainers() {
    if (isValidSidebarContainer(cachedSidebarContainer)) {
      return [cachedSidebarContainer];
    }

    var links = /** @type {NodeListOf<HTMLAnchorElement>} */ (
      document.querySelectorAll("a[href*='/c/']")
    );
    var containers = [];

    for (var i = 0; i < links.length; i += 1) {
      var parent = links[i].parentElement;
      while (parent && parent !== document.body) {
        if (isValidSidebarContainer(parent)) {
          if (containers.indexOf(parent) === -1) {
            containers.push(parent);
          }
          break;
        }
        parent = parent.parentElement;
      }
    }

    cachedSidebarContainer = containers[0] || null;
    return containers;
  }

  async function collectSidebarEntries() {
    var root = getSidebarQueryRoot();
    var nodes = /** @type {NodeListOf<HTMLAnchorElement>} */ (
      root.querySelectorAll("a[href*='/c/']")
    );
    var entries = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var url = normalizeConversationUrl(nodes[i].href);
      if (!url) {
        continue;
      }
      entries.push({
        id: extractConversationId(url),
        url: url,
        label: cleanText(nodes[i].textContent) || null,
        discoveredAt: new Date().toISOString(),
        source: "sidebar",
      });
    }
    return dedupeEntries(entries);
  }

  async function navigateToConversation(nextUrl) {
    var anchor = findSidebarLink(nextUrl);
    if (anchor) {
      anchor.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      return;
    }

    window.location.href = nextUrl;
  }

  function findSidebarLink(nextUrl) {
    var normalizedTarget = normalizeConversationUrl(nextUrl);
    if (!normalizedTarget) {
      return null;
    }

    var root = getSidebarQueryRoot();
    var nodes = /** @type {NodeListOf<HTMLAnchorElement>} */ (
      root.querySelectorAll("a[href*='/c/']")
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var href = normalizeConversationUrl(nodes[i].href);
      if (href === normalizedTarget) {
        return nodes[i];
      }
    }

    return null;
  }

  async function scrollSidebarForMoreChats() {
    var containers = findScrollableChatContainers();
    if (!containers.length) {
      return {
        moved: false,
        atBottom: true,
      };
    }

    var moved = false;
    var atBottom = true;
    for (var i = 0; i < containers.length; i += 1) {
      var element = containers[i];
      var maxScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
      var distanceFromBottom = maxScrollTop - element.scrollTop;
      if (distanceFromBottom > 8) {
        atBottom = false;
      }
      var nextScrollTop = Math.min(
        maxScrollTop,
        element.scrollTop +
          Math.max(480, Math.floor(element.clientHeight * 1.25)),
      );
      if (nextScrollTop > element.scrollTop + 4) {
        element.scrollTop = nextScrollTop;
        moved = true;
      }

      if (maxScrollTop - nextScrollTop > 8) {
        atBottom = false;
      }
    }

    return {
      moved: moved,
      atBottom: atBottom,
    };
  }

  async function scrollSidebarToTop() {
    var containers = findScrollableChatContainers();
    if (!containers.length) {
      return false;
    }

    for (var i = 0; i < containers.length; i += 1) {
      containers[i].scrollTop = 0;
    }

    await sleep(250);
    return true;
  }

  async function fetchSavedConversationIds() {
    try {
      var response = await chrome.runtime.sendMessage({
        type: "byegpt:list-saved-conversations",
      });
      if (
        !response ||
        !response.ok ||
        !Array.isArray(response.conversationIds)
      ) {
        return [];
      }
      return dedupe(
        response.conversationIds.map(function (value) {
          return sanitizeFilename(value);
        }),
      );
    } catch (error) {
      return [];
    }
  }

  async function persistNetworkEvent(eventPayload) {
    var capture = await loadCapture();
    capture.lastUpdatedAt = new Date().toISOString();
    capture.stats = ensureCaptureStats(capture.stats);
    capture.stats.capturedApiResponseCount =
      Number(capture.stats.capturedApiResponseCount || 0) + 1;

    var associatedId =
      extractConversationId(eventPayload.url) ||
      extractConversationId(window.location.href) ||
      extractConversationIdFromPayload(eventPayload.body);

    if (associatedId) {
      var key = associatedId;
      var conversation = normalizeConversationRecord(
        capture.conversations[key] || emptyConversationRecord(associatedId),
        associatedId,
      );
      conversation.lastSeenAt = new Date().toISOString();
      conversation.apiEvents = conversation.apiEvents || [];
      conversation.apiEvents.push(normalizeApiEvent(eventPayload));
      if (!conversation.title) {
        conversation.title = inferTitleFromPayload(eventPayload.body);
      }
      conversation.assets = mergeAssetRecords(
        conversation.assets || [],
        extractAssetReferencesFromEvent(eventPayload, associatedId),
      );
      capture.conversations[key] = conversation;
    }

    await setInStorage(CAPTURE_KEY, capture);
  }

  function inferTitleFromPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (typeof payload.title === "string" && payload.title.trim()) {
      return payload.title.trim();
    }
    if (
      payload.conversation &&
      typeof payload.conversation.title === "string"
    ) {
      return payload.conversation.title.trim();
    }
    return null;
  }

  function extractConversationIdFromPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (typeof payload.conversation_id === "string") {
      return payload.conversation_id;
    }
    if (payload.conversation && typeof payload.conversation.id === "string") {
      return payload.conversation.id;
    }
    if (
      typeof payload.id === "string" &&
      payload.mapping &&
      typeof payload.mapping === "object"
    ) {
      return payload.id;
    }
    return null;
  }

  function mergeDiscoveredChats(existing, incoming) {
    var byUrl = {};
    var merged = [];

    existing.concat(incoming).forEach(function (item) {
      if (!item || !item.url) {
        return;
      }

      if (byUrl[item.url]) {
        var existingItem = byUrl[item.url];
        if (!existingItem.label && item.label) {
          existingItem.label = item.label;
        }
        existingItem.lastSeenAt = item.discoveredAt || existingItem.lastSeenAt;
        return;
      }

      var normalized = Object.assign({}, item, {
        firstSeenAt:
          item.firstSeenAt || item.discoveredAt || new Date().toISOString(),
        lastSeenAt:
          item.discoveredAt || item.lastSeenAt || new Date().toISOString(),
      });
      byUrl[item.url] = normalized;
      merged.push(normalized);
    });

    return merged;
  }

  function dedupeEntries(entries) {
    return mergeDiscoveredChats([], entries);
  }

  function normalizeConversationUrl(rawUrl) {
    try {
      var url = new URL(rawUrl, window.location.href);
      var match = url.pathname.match(/\/c\/([^/?#]+)/);
      if (!match) {
        return null;
      }
      return url.origin + "/c/" + match[1];
    } catch (error) {
      return null;
    }
  }

  function extractConversationId(rawUrl) {
    var normalized = normalizeConversationUrl(rawUrl);
    if (!normalized) {
      return null;
    }
    var parts = normalized.split("/");
    return parts[parts.length - 1] || null;
  }

  function cleanText(value) {
    if (!value) {
      return "";
    }
    return String(value).replace(/\s+/g, " ").trim();
  }

  async function waitForPageSettled() {
    await sleep(1800);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function loadCapture() {
    var stored = await getFromStorage([CAPTURE_KEY]);
    var capture = stored[CAPTURE_KEY] || emptyCapture();
    var migrated = normalizeCaptureShape(capture);
    if (migrated.changed) {
      await setInStorage(CAPTURE_KEY, migrated.capture);
    }
    return migrated.capture;
  }

  function emptyCapture() {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      conversations: {},
      stats: emptyCaptureStats(),
    };
  }

  function emptyCaptureStats() {
    return {
      capturedApiResponseCount: 0,
      downloadedConversationCount: 0,
      latestDownload: null,
    };
  }

  function normalizeCaptureShape(capture) {
    var changed = false;
    var normalized = Object.assign({}, capture || {});

    if (!normalized.stats || typeof normalized.stats !== "object") {
      normalized.stats = emptyCaptureStats();
      changed = true;
    } else {
      var normalizedStats = ensureCaptureStats(normalized.stats);
      if (normalizedStats.__changed) {
        delete normalizedStats.__changed;
        changed = true;
      }
      normalized.stats = normalizedStats;
    }

    if ("discoveredChats" in normalized) {
      delete normalized.discoveredChats;
      changed = true;
    }

    if ("networkEvents" in normalized) {
      delete normalized.networkEvents;
      changed = true;
    }

    if (
      !normalized.conversations ||
      typeof normalized.conversations !== "object"
    ) {
      normalized.conversations = {};
      changed = true;
    } else {
      normalized.conversations = Object.assign({}, normalized.conversations);
    }

    Object.keys(normalized.conversations).forEach(function (conversationId) {
      var record = normalizeConversationRecord(
        normalized.conversations[conversationId],
        conversationId,
      );
      if (record.__changed) {
        changed = true;
        delete record.__changed;
      }
      normalized.conversations[conversationId] = record;
    });

    return {
      capture: normalized,
      changed: changed,
    };
  }

  function normalizeConversationRecord(record, conversationId) {
    var changed = false;
    var normalized = Object.assign({}, record || {});

    if (!normalized.id) {
      normalized.id = conversationId;
      changed = true;
    }

    if (!Array.isArray(normalized.apiEvents)) {
      if (
        Array.isArray(normalized.networkEvents) &&
        normalized.networkEvents.length
      ) {
        normalized.apiEvents = normalized.networkEvents.map(
          normalizeStoredApiEvent,
        );
      } else {
        normalized.apiEvents = [];
      }
      changed = true;
    } else {
      normalized.apiEvents = normalized.apiEvents.map(normalizeStoredApiEvent);
    }

    if (!Array.isArray(normalized.assets)) {
      normalized.assets = [];
      changed = true;
    }

    if ("networkEvents" in normalized) {
      delete normalized.networkEvents;
      changed = true;
    }

    if ("domSnapshots" in normalized) {
      delete normalized.domSnapshots;
      changed = true;
    }

    if ("pageMetadata" in normalized) {
      delete normalized.pageMetadata;
      changed = true;
    }

    if ("sidebarReferences" in normalized) {
      delete normalized.sidebarReferences;
      changed = true;
    }

    if (changed) {
      normalized.__changed = true;
    }

    return normalized;
  }

  function ensureCaptureStats(stats) {
    var changed = false;
    var normalized = Object.assign({}, emptyCaptureStats(), stats || {});

    if (typeof normalized.capturedApiResponseCount !== "number") {
      normalized.capturedApiResponseCount = Number(
        normalized.capturedApiResponseCount || 0,
      );
      changed = true;
    }

    if (typeof normalized.downloadedConversationCount !== "number") {
      normalized.downloadedConversationCount = Number(
        normalized.downloadedConversationCount || 0,
      );
      changed = true;
    }

    if (
      normalized.latestDownload &&
      (typeof normalized.latestDownload !== "object" ||
        !normalized.latestDownload.downloadedAt)
    ) {
      normalized.latestDownload = null;
      changed = true;
    }

    if (changed) {
      normalized.__changed = true;
    }

    return normalized;
  }

  function normalizeStoredApiEvent(eventPayload) {
    if (eventPayload && eventPayload.request && eventPayload.response) {
      return eventPayload;
    }
    return normalizeApiEvent(eventPayload);
  }

  async function ensureSettings() {
    var stored = await getFromStorage([SETTINGS_KEY]);
    if (!stored[SETTINGS_KEY]) {
      await setInStorage(SETTINGS_KEY, mergeSettings(null));
    }
  }

  async function loadSettings() {
    var stored = await getFromStorage([SETTINGS_KEY]);
    return mergeSettings(stored[SETTINGS_KEY]);
  }

  function mergeSettings(value) {
    return Object.assign(
      {
        autoDownloadConversations: true,
      },
      value || {},
    );
  }

  async function maybeDownloadConversation(conversationId, reason) {
    var settings = await loadSettings();
    if (!settings.autoDownloadConversations) {
      return;
    }

    var capture = await loadCapture();
    var conversation = capture.conversations[conversationId];
    if (!conversation) {
      return;
    }

    var signature = [
      conversation.apiEvents ? conversation.apiEvents.length : 0,
      conversation.assets ? conversation.assets.length : 0,
      conversation.title || "",
      conversation.lastSeenAt || "",
    ].join(":");

    var exportMetadata = conversation.exportMetadata || {};
    if (exportMetadata.lastDownloadedSignature === signature) {
      return;
    }

    await downloadConversationAssets(conversationId, conversation);

    var bundle = buildConversationBundle(conversation);
    var filename = buildConversationJsonPath(conversationId);

    var response = await chrome.runtime.sendMessage({
      type: "byegpt:download-json",
      payload: {
        filename: filename,
        data: bundle,
        saveAs: false,
        conflictAction: "overwrite",
      },
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Download failed.");
    }

    var downloadedAt = new Date().toISOString();
    conversation.exportMetadata = {
      downloadedAt: downloadedAt,
      downloadCount: Number(exportMetadata.downloadCount || 0) + 1,
      lastDownloadedFilename: filename,
      lastDownloadedReason: reason,
      lastDownloadedSignature: signature,
    };

    capture.stats = ensureCaptureStats(capture.stats);
    capture.stats.downloadedConversationCount =
      Number(capture.stats.downloadedConversationCount || 0) + 1;
    capture.stats.latestDownload = {
      id: conversationId,
      label: conversation.title || conversationId,
      downloadedAt: downloadedAt,
    };
    delete capture.conversations[conversationId];
    capture.lastUpdatedAt = downloadedAt;
    await setInStorage(CAPTURE_KEY, capture);
  }

  function buildConversationBundle(conversation) {
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

  // Prefer the route that matches the asset's expected auth model:
  // page-context fetches for session-protected OpenAI URLs, direct browser downloads otherwise.
  async function downloadConversationAssets(conversationId, conversation) {
    var assets = conversation.assets || [];
    for (var i = 0; i < assets.length; i += 1) {
      var asset = assets[i];
      if (
        asset.relativePath &&
        asset.downloadedAt &&
        asset.lastDownloadedUrl === asset.url
      ) {
        continue;
      }

      var filename =
        asset.relativePath || buildAssetRelativePath(conversationId, asset);
      var assetFetch = await downloadAssetWithBestRoute(asset, filename);

      if (!assetFetch) {
        continue;
      }

      asset.relativePath = filename;
      asset.downloadedAt = new Date().toISOString();
      asset.lastDownloadedUrl = assetFetch.url || asset.url;
      asset.contentType = assetFetch.contentType || asset.contentType || null;
      asset.byteLength = assetFetch.byteLength || asset.byteLength || null;
    }
  }

  async function downloadAssetWithBestRoute(asset, filename) {
    var primaryRoute = shouldUsePageAssetFetch(asset.url) ? "page" : "direct";

    if (primaryRoute === "page") {
      return (
        (await fetchAssetFromPage(asset, filename)) ||
        (await downloadAssetDirectly(asset, filename))
      );
    }

    return (
      (await downloadAssetDirectly(asset, filename)) ||
      (await fetchAssetFromPage(asset, filename))
    );
  }

  async function downloadAssetDirectly(asset, filename) {
    var candidates = buildAssetDownloadCandidates(asset);

    for (var i = 0; i < candidates.length; i += 1) {
      try {
        var response = await chrome.runtime.sendMessage({
          type: "byegpt:download-asset",
          payload: {
            url: candidates[i],
            filename: filename,
          },
        });

        if (response && response.ok) {
          return {
            url: candidates[i],
          };
        }
      } catch (error) {}
    }

    return null;
  }

  async function fetchAssetFromPage(asset, filename) {
    var candidates = buildAssetDownloadCandidates(asset);

    for (var i = 0; i < candidates.length; i += 1) {
      try {
        var payload = await requestAssetBytesViaPage(candidates[i]);
        var dataUrl = await arrayBufferToDataUrl(
          payload.bytes,
          payload.contentType || asset.contentType || "",
        );
        var response = await chrome.runtime.sendMessage({
          type: "byegpt:download-asset",
          payload: {
            dataUrl: dataUrl,
            filename: filename,
          },
        });

        if (!response || !response.ok) {
          throw new Error(
            (response && response.error) || "Asset download failed.",
          );
        }

        return {
          url: payload.url || candidates[i],
          contentType: payload.contentType || "",
          byteLength:
            payload.byteLength ||
            (payload.bytes ? payload.bytes.byteLength : 0),
        };
      } catch (error) {}
    }

    return null;
  }

  function buildAssetDownloadCandidates(asset) {
    return dedupe([asset.url].concat(findDomAssetCandidateUrls(asset)));
  }

  function shouldUsePageAssetFetch(rawUrl) {
    try {
      var url = new URL(rawUrl, window.location.href);
      if (url.origin === window.location.origin) {
        return true;
      }

      return isOpenAIAssetUrl(url);
    } catch (error) {
      return false;
    }
  }

  async function waitForConversationData(conversationId, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      var capture = await loadCapture();
      var conversation = capture.conversations[conversationId];
      if (
        conversation &&
        conversation.apiEvents &&
        conversation.apiEvents.length
      ) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function emptyConversationRecord(conversationId) {
    return {
      id: conversationId,
      title: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      apiEvents: [],
      assets: [],
    };
  }

  function normalizeApiEvent(eventPayload) {
    return {
      event_id: eventPayload.id,
      request: {
        url: eventPayload.url,
        path: eventPayload.path,
        search: eventPayload.search || "",
        method: eventPayload.method,
      },
      response: {
        status: eventPayload.status,
        ok: Boolean(eventPayload.ok),
        content_type: eventPayload.contentType || null,
        headers: eventPayload.responseHeaders || {},
        body: eventPayload.body,
      },
    };
  }

  function extractAssetReferencesFromEvent(eventPayload, conversationId) {
    var collector = [];
    collectAssetReferences(
      eventPayload.body,
      "$",
      collector,
      eventPayload.id,
      conversationId,
    );
    return dedupeAssetRecords(collector);
  }

  function collectAssetReferences(
    value,
    path,
    collector,
    eventId,
    conversationId,
  ) {
    if (typeof value === "string") {
      var asset = createAssetRecordFromUrl(
        value,
        path,
        eventId,
        conversationId,
      );
      if (asset) {
        collector.push(asset);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        collectAssetReferences(
          value[i],
          path + "[" + i + "]",
          collector,
          eventId,
          conversationId,
        );
      }
      return;
    }

    Object.keys(value).forEach(function (key) {
      collectAssetReferences(
        value[key],
        path + "." + key,
        collector,
        eventId,
        conversationId,
      );
    });
  }

  function createAssetRecordFromUrl(rawUrl, jsonPath, eventId, conversationId) {
    var parsed;
    try {
      parsed = new URL(rawUrl, window.location.href);
    } catch (error) {
      return null;
    }

    if (!isOpenAIAssetUrl(parsed)) {
      return null;
    }

    var assetId = deriveAssetId(parsed);
    var extension = inferAssetExtension(parsed);
    var relativePath = buildAssetRelativePath(conversationId, {
      assetId: assetId,
      extension: extension,
    });

    return {
      assetId: assetId,
      url: parsed.toString(),
      extension: extension,
      relativePath: relativePath,
      sourceEventIds: [eventId],
      sourceJsonPaths: [jsonPath],
    };
  }

  function isOpenAIAssetUrl(url) {
    var hostname = url.hostname.toLowerCase();
    var path = url.pathname.toLowerCase();
    var openAiHost =
      hostname === "chatgpt.com" ||
      hostname === "chat.openai.com" ||
      hostname === "cdn.openai.com" ||
      hostname.indexOf(".oaistatic.com") >= 0 ||
      hostname.indexOf(".oaiusercontent.com") >= 0;

    if (!openAiHost) {
      return false;
    }

    return (
      /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.mp4|\.webm|\.mp3|\.wav|\.m4a|\.pdf|\.csv|\.txt|\.json)$/i.test(
        path,
      ) ||
      path.indexOf("/files/") >= 0 ||
      path.indexOf("/download") >= 0 ||
      path.indexOf("/assets/") >= 0 ||
      path.indexOf("/images/") >= 0
    );
  }

  function inferAssetExtension(url) {
    var match = url.pathname.match(/\.([a-z0-9]{2,8})$/i);
    if (match) {
      return "." + match[1].toLowerCase();
    }
    return ".bin";
  }

  function deriveAssetId(url) {
    var fileMatch = url.pathname.match(/\/files\/([^/?#]+)/i);
    if (fileMatch) {
      return sanitizeFilename(fileMatch[1]);
    }

    var basename = url.pathname.split("/").pop() || "";
    basename = basename.replace(/\.[a-z0-9]{2,8}$/i, "");
    if (basename) {
      return sanitizeFilename(basename);
    }

    return "asset-" + simpleHash(url.toString());
  }

  function buildAssetRelativePath(conversationId, asset) {
    var extension = asset.extension || ".bin";
    return (
      "byegpt/conversations/assets/" +
      sanitizeFilename(conversationId) +
      "/" +
      sanitizeFilename(asset.assetId) +
      extension
    );
  }

  function buildConversationJsonPath(conversationId) {
    return "byegpt/conversations/" + sanitizeFilename(conversationId) + ".json";
  }

  function mergeAssetRecords(existing, incoming) {
    var byUrl = {};
    var merged = [];

    existing.concat(incoming).forEach(function (asset) {
      if (!asset || !asset.url) {
        return;
      }

      if (byUrl[asset.url]) {
        var current = byUrl[asset.url];
        current.sourceEventIds = dedupe(
          (current.sourceEventIds || []).concat(asset.sourceEventIds || []),
        );
        current.sourceJsonPaths = dedupe(
          (current.sourceJsonPaths || []).concat(asset.sourceJsonPaths || []),
        );
        if (!current.relativePath && asset.relativePath) {
          current.relativePath = asset.relativePath;
        }
        return;
      }

      var normalized = {
        assetId: asset.assetId,
        url: asset.url,
        extension: asset.extension || ".bin",
        relativePath: asset.relativePath || null,
        sourceEventIds: dedupe(asset.sourceEventIds || []),
        sourceJsonPaths: dedupe(asset.sourceJsonPaths || []),
      };
      byUrl[asset.url] = normalized;
      merged.push(normalized);
    });

    return merged;
  }

  function dedupeAssetRecords(records) {
    return mergeAssetRecords([], records);
  }

  function simpleHash(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function sanitizeFilename(value) {
    var sanitized = "";
    var raw = String(value);

    for (var i = 0; i < raw.length; i += 1) {
      var character = raw[i];
      var code = raw.charCodeAt(i);
      if (
        code < 32 ||
        character === "<" ||
        character === ">" ||
        character === ":" ||
        character === '"' ||
        character === "/" ||
        character === "\\" ||
        character === "|" ||
        character === "?" ||
        character === "*"
      ) {
        sanitized += "_";
        continue;
      }
      sanitized += character;
    }

    return sanitized.replace(/\s+/g, "-").slice(0, 140);
  }

  function calculateDiscoveredChatCount(job) {
    if (!job) {
      return 0;
    }
    if (job.inventoryCount) {
      return job.inventoryCount;
    }
    if (job.seenUrls) {
      return job.seenUrls.length;
    }
    return 0;
  }

  function calculateKnownTotal(job) {
    var seen = job && job.seenUrls ? job.seenUrls.length : 0;
    var pending = job && job.pendingUrls ? job.pendingUrls.length : 0;
    var visited = job && job.visitedUrls ? job.visitedUrls.length : 0;
    var skipped =
      job && job.skippedUrls
        ? job.skippedUrls.length
        : job && job.skippedCount
          ? job.skippedCount
          : 0;
    var inventory = job && job.inventoryCount ? job.inventoryCount : 0;
    return Math.max(seen, inventory, pending + visited + skipped);
  }

  function dedupe(values) {
    var seen = {};
    var output = [];
    values.forEach(function (value) {
      if (!value || seen[value]) {
        return;
      }
      seen[value] = true;
      output.push(value);
    });
    return output;
  }

  function getFromStorage(keys) {
    if (extensionContextInvalidated || !isExtensionContextAvailable()) {
      return Promise.resolve({});
    }

    try {
      return chrome.storage.local.get(keys);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        extensionContextInvalidated = true;
        return Promise.resolve({});
      }
      throw error;
    }
  }

  function setInStorage(key, value) {
    if (extensionContextInvalidated || !isExtensionContextAvailable()) {
      return Promise.resolve();
    }

    var payload = {};
    payload[key] = value;
    try {
      return chrome.storage.local.set(payload);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        extensionContextInvalidated = true;
        return Promise.resolve();
      }
      throw error;
    }
  }

  function isExtensionContextAvailable() {
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function isExtensionContextInvalidatedError(error) {
    if (!error) {
      return false;
    }
    var message = String(error && error.message ? error.message : error);
    return (
      message.indexOf("Extension context invalidated") >= 0 ||
      message.indexOf("Receiving end does not exist") >= 0
    );
  }

  function teardownInvalidatedContext() {
    extensionContextInvalidated = true;
    rejectAllPendingAssetFetches("Extension context invalidated.");

    try {
      window.removeEventListener("message", onWindowMessage);
    } catch (error) {}

    try {
      if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      }
    } catch (error) {}

    try {
      if (overlayRefreshTimer) {
        clearInterval(overlayRefreshTimer);
        overlayRefreshTimer = null;
      }
    } catch (error) {}
  }

  function scheduleResumeRetry(runId) {
    if (resumeRetryTimer) {
      return;
    }

    resumeRetryTimer = setTimeout(function () {
      resumeRetryTimer = null;
      runCrawlTick(runId).catch(function (error) {
        if (isExtensionContextInvalidatedError(error)) {
          teardownInvalidatedContext();
          return;
        }
        console.warn("byegpt resume retry failed", error);
      });
    }, 1000);
  }

  async function loadMatchingJob(runId) {
    var stored = await getFromStorage([JOB_KEY]);
    var job = stored[JOB_KEY];
    if (!job || job.runId !== runId) {
      return null;
    }
    return job;
  }

  async function loadActiveJob(runId) {
    var job = await loadMatchingJob(runId);
    if (!job || !job.active) {
      return null;
    }
    return job;
  }

  async function isRunCurrent(runId) {
    return Boolean(await loadActiveJob(runId));
  }

  async function persistJobIfCurrent(job) {
    if (!job || !job.runId) {
      return false;
    }

    var current = await loadMatchingJob(job.runId);
    if (!current) {
      return false;
    }

    await setInStorage(JOB_KEY, job);
    return true;
  }

  function createRunId() {
    return (
      "run_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function startOverlayRefresh() {
    refreshOverlay().catch(function () {});

    if (overlayRefreshTimer) {
      clearInterval(overlayRefreshTimer);
    }

    overlayRefreshTimer = setInterval(function () {
      refreshOverlay().catch(function () {});
    }, 1000);
  }

  async function refreshOverlay() {
    if (extensionContextInvalidated || !isExtensionContextAvailable()) {
      return;
    }

    var status = await getStatus();
    renderOverlay(status);
  }

  function renderOverlay(status) {
    var overlay = ensureOverlay();
    if (!overlay) {
      return;
    }
    overlay.style.display = "block";

    var visited =
      status.job && status.job.visitedUrls ? status.job.visitedUrls.length : 0;
    var pending =
      status.job && status.job.pendingUrls ? status.job.pendingUrls.length : 0;
    var skipped =
      status.job && status.job.skippedUrls
        ? status.job.skippedUrls.length
        : status.job && status.job.skippedCount
          ? status.job.skippedCount
          : 0;
    var knownTotal = status.knownTotalCount || visited + pending || 0;
    var progressRatio = knownTotal
      ? Math.min(1, (visited + skipped) / knownTotal)
      : 0;
    var currentTarget =
      status.job && status.job.currentUrl ? status.job.currentUrl : status.url;
    var lastSaved = status.latestDownload
      ? status.latestDownload.label +
        " at " +
        new Date(status.latestDownload.downloadedAt).toLocaleTimeString()
      : "Nothing saved yet";

    var statusNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='status']")
    );
    var barNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='bar']")
    );
    var summaryNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='summary']")
    );
    var downloadsNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='downloads']")
    );
    var currentNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='current']")
    );
    var lastNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='last']")
    );
    var actionButton = /** @type {HTMLButtonElement | null} */ (
      overlay.querySelector("[data-role='action']")
    );
    var noteNode = /** @type {HTMLElement | null} */ (
      overlay.querySelector("[data-role='note']")
    );

    if (statusNode) {
      statusNode.textContent = formatOverlayStatus(status.job);
    }
    if (barNode) {
      barNode.style.width = Math.round(progressRatio * 100) + "%";
    }
    if (summaryNode) {
      summaryNode.textContent =
        visited +
        " visited / " +
        pending +
        " pending / " +
        skipped +
        " skipped / " +
        knownTotal +
        " known";
    }
    if (downloadsNode) {
      downloadsNode.textContent =
        status.downloadedConversationCount +
        " saved, " +
        status.networkEventCount +
        " API responses captured";
    }
    if (currentNode) {
      currentNode.textContent = "Current: " + shortenLabel(currentTarget);
    }
    if (lastNode) {
      lastNode.textContent = "Last saved: " + shortenLabel(lastSaved);
    }
    if (actionButton) {
      var active = Boolean(status.job && status.job.active);
      actionButton.textContent = active ? "Stop" : "Start Downloading";
      actionButton.style.background = active
        ? "linear-gradient(135deg,#ef4444,#fb7185)"
        : "linear-gradient(135deg,#22c55e,#38bdf8)";
    }
    if (noteNode) {
      noteNode.textContent =
        status.job && status.job.active
          ? "Stopping resets local crawl state. Existing files on disk stay."
          : "Already-saved conversation files are skipped automatically.";
    }
  }

  function ensureOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      return existing;
    }

    var parent = document.body || document.documentElement;
    if (!parent) {
      return null;
    }

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.right = "16px";
    overlay.style.bottom = "16px";
    overlay.style.zIndex = "2147483647";
    overlay.style.width = "320px";
    overlay.style.padding = "12px";
    overlay.style.borderRadius = "14px";
    overlay.style.background = "rgba(15, 23, 42, 0.92)";
    overlay.style.color = "#f8fafc";
    overlay.style.boxShadow = "0 20px 50px rgba(2, 6, 23, 0.45)";
    overlay.style.backdropFilter = "blur(8px)";
    overlay.style.fontFamily =
      "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    overlay.style.pointerEvents = "auto";
    overlay.style.border = "1px solid rgba(148, 163, 184, 0.18)";
    overlay.innerHTML =
      '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">byegpt</div>' +
      '<div data-role="status" style="margin-top:6px;font-size:14px;font-weight:700;color:#ffffff">Idle</div>' +
      '<button data-role="action" type="button" style="margin-top:12px;width:100%;border:0;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;color:#ffffff;cursor:pointer;background:linear-gradient(135deg,#22c55e,#38bdf8)">Start Downloading</button>' +
      '<div style="margin-top:10px;height:8px;border-radius:999px;background:rgba(148,163,184,.22);overflow:hidden">' +
      '<div data-role="bar" style="height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#38bdf8)"></div>' +
      "</div>" +
      '<div data-role="summary" style="margin-top:8px;font-size:12px;color:#cbd5e1">0 visited / 0 pending / 0 known</div>' +
      '<div data-role="downloads" style="margin-top:4px;font-size:12px;color:#cbd5e1">0 saved</div>' +
      '<div data-role="current" style="margin-top:8px;font-size:12px;color:#e2e8f0">Current: -</div>' +
      '<div data-role="last" style="margin-top:4px;font-size:12px;color:#e2e8f0">Last saved: -</div>' +
      '<div data-role="note" style="margin-top:10px;font-size:11px;line-height:1.5;color:#94a3b8">Already-saved conversation files are skipped automatically.</div>';

    overlay.addEventListener("click", onOverlayClick);

    parent.appendChild(overlay);
    return overlay;
  }

  function formatOverlayStatus(job) {
    if (!job) {
      return "Ready to export";
    }
    if (job.stoppedAt) {
      return "Reset";
    }
    if (job.active && job.phase === "inventory") {
      return "Building conversation inventory";
    }
    if (job.active) {
      return "Downloading conversations";
    }
    if (job.completedAt) {
      return "Download complete";
    }
    return "Idle";
  }

  function shortenLabel(value) {
    var text = String(value || "").trim();
    if (!text) {
      return "-";
    }
    if (text.length <= 56) {
      return text;
    }
    return text.slice(0, 53) + "...";
  }

  function onOverlayClick(event) {
    var button =
      event.target &&
      typeof event.target.closest === "function" &&
      event.target.closest("[data-role='action']");
    if (!button) {
      return;
    }

    handleOverlayAction(button).catch(function (error) {
      console.warn("byegpt overlay action failed", error);
    });
  }

  async function handleOverlayAction(button) {
    if (!button || button.disabled) {
      return;
    }

    button.disabled = true;
    button.style.opacity = "0.75";

    try {
      var status = await getStatus();
      if (status.job && status.job.active) {
        await stopCrawl();
      } else {
        await startCrawl();
      }
    } finally {
      button.disabled = false;
      button.style.opacity = "1";
      await refreshOverlay();
      focusOverlay();
    }
  }

  function focusOverlay() {
    var overlay = ensureOverlay();
    if (!overlay) {
      return;
    }

    overlay.style.borderColor = "rgba(56, 189, 248, 0.85)";
    overlay.style.boxShadow = "0 20px 60px rgba(14, 165, 233, 0.35)";

    if (overlayFocusTimer) {
      clearTimeout(overlayFocusTimer);
    }

    overlayFocusTimer = setTimeout(function () {
      overlay.style.borderColor = "rgba(148, 163, 184, 0.18)";
      overlay.style.boxShadow = "0 20px 50px rgba(2, 6, 23, 0.45)";
      overlayFocusTimer = null;
    }, 1200);
  }

  function requestAssetBytesViaPage(url) {
    return new Promise(function (resolve, reject) {
      var requestId =
        "asset_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10);

      pendingAssetFetches[requestId] = {
        resolve: resolve,
        reject: reject,
      };

      window.postMessage(
        {
          source: "byegpt",
          type: "asset-fetch-request",
          payload: {
            requestId: requestId,
            url: url,
          },
        },
        "*",
      );

      setTimeout(function () {
        if (!pendingAssetFetches[requestId]) {
          return;
        }
        pendingAssetFetches[requestId].reject(
          new Error("Asset fetch timed out."),
        );
        delete pendingAssetFetches[requestId];
      }, 15000);
    });
  }

  function arrayBufferToDataUrl(bytes, contentType) {
    var blob = new Blob([bytes], {
      type: contentType || "application/octet-stream",
    });

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Failed to read blob."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function findDomAssetCandidateUrls(asset) {
    var candidates = [];
    var nodes = document.querySelectorAll(
      "main img, main source[src], main video[src], main audio[src], main a[href]",
    );
    var expectedName = asset.assetId || "";

    for (var i = 0; i < nodes.length; i += 1) {
      var element =
        /** @type {Element & { currentSrc?: string, src?: string, href?: string }} */ (
          nodes[i]
        );
      var candidate =
        element.currentSrc ||
        element.src ||
        element.href ||
        element.getAttribute("src") ||
        element.getAttribute("href");

      if (!candidate) {
        continue;
      }

      if (candidate === asset.url || candidate.indexOf(expectedName) >= 0) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  function getSidebarQueryRoot() {
    return findScrollableChatContainers()[0] || document;
  }

  function isValidSidebarContainer(element) {
    return Boolean(
      element &&
        element.isConnected &&
        typeof element.querySelector === "function" &&
        element.querySelector("a[href*='/c/']") &&
        element.scrollHeight > element.clientHeight + 40,
    );
  }
})();
