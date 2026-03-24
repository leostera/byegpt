// This script runs in the page context so it can observe the same fetch/XHR traffic
// and session-bound asset requests that the ChatGPT app itself uses.
(function () {
  /** @typedef {{ method: string, url: string }} ByegptXhrMeta */

  var byegptWindow =
    /** @type {Window & typeof globalThis & { __byegptInjected?: boolean }} */ (
      window
    );

  if (byegptWindow.__byegptInjected) {
    return;
  }

  byegptWindow.__byegptInjected = true;

  function emit(payload) {
    window.postMessage(
      {
        source: "byegpt",
        type: "network-event",
        payload: payload,
      },
      "*",
    );
  }

  function emitAssetFetchResponse(payload, transfer) {
    window.postMessage(
      {
        source: "byegpt",
        type: "asset-fetch-response",
        payload: payload,
      },
      "*",
      transfer || [],
    );
  }

  function isRelevantUrl(rawUrl) {
    try {
      var url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) {
        return false;
      }

      var path = url.pathname.toLowerCase();
      return (
        path.indexOf("/backend-api/") >= 0 ||
        path.indexOf("/api/") >= 0 ||
        path.indexOf("conversation") >= 0 ||
        path.indexOf("history") >= 0 ||
        path.indexOf("messages") >= 0 ||
        path.indexOf("chat") >= 0
      );
    } catch (error) {
      return false;
    }
  }

  function collectHeaders(headers) {
    var entries = {};
    headers.forEach(function (value, key) {
      entries[key] = value;
    });
    return entries;
  }

  async function captureJsonResponse(meta, response) {
    var contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().indexOf("application/json") === -1) {
      return;
    }

    var json;
    try {
      json = await response.json();
    } catch (error) {
      return;
    }

    emit({
      id:
        "evt_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10),
      url: meta.url,
      path: meta.path,
      search: meta.search,
      method: meta.method,
      status: response.status,
      ok: response.ok,
      capturedAt: new Date().toISOString(),
      contentType: contentType,
      responseHeaders: collectHeaders(response.headers),
      body: json,
    });
  }

  function installFetchHook() {
    var originalFetch = window.fetch;
    if (typeof originalFetch !== "function") {
      return;
    }

    window.fetch = async function patchedFetch(input, init) {
      var response = await originalFetch.apply(this, arguments);
      try {
        var url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input && input.url;
        var method =
          (init && init.method) ||
          (typeof input !== "string" && !(input instanceof URL) && input
            ? input.method
            : null) ||
          "GET";
        if (url && isRelevantUrl(url)) {
          var parsedUrl = new URL(url, window.location.href);
          captureJsonResponse(
            {
              url: parsedUrl.toString(),
              path: parsedUrl.pathname,
              search: parsedUrl.search,
              method: String(method).toUpperCase(),
            },
            response.clone(),
          );
        }
      } catch (error) {}
      return response;
    };
  }

  function installXhrHook() {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      var xhr =
        /** @type {XMLHttpRequest & { __byegptMeta?: ByegptXhrMeta }} */ (this);
      xhr.__byegptMeta = {
        method: String(method || "GET").toUpperCase(),
        url: url,
      };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      var xhr =
        /** @type {XMLHttpRequest & { __byegptMeta?: ByegptXhrMeta }} */ (this);
      xhr.addEventListener("load", function () {
        try {
          var meta = xhr.__byegptMeta;
          if (!meta || !meta.url || !isRelevantUrl(meta.url)) {
            return;
          }

          var contentType = xhr.getResponseHeader("content-type") || "";
          if (contentType.toLowerCase().indexOf("application/json") === -1) {
            return;
          }

          var json = JSON.parse(xhr.responseText);
          var parsedUrl = new URL(meta.url, window.location.href);

          emit({
            id:
              "evt_" +
              Date.now().toString(36) +
              "_" +
              Math.random().toString(36).slice(2, 10),
            url: parsedUrl.toString(),
            path: parsedUrl.pathname,
            search: parsedUrl.search,
            method: meta.method,
            status: xhr.status,
            ok: xhr.status >= 200 && xhr.status < 300,
            capturedAt: new Date().toISOString(),
            contentType: contentType,
            responseHeaders: {
              "content-type": contentType,
            },
            body: json,
          });
        } catch (error) {}
      });

      return originalSend.apply(this, arguments);
    };
  }

  function installAssetFetchBridge() {
    window.addEventListener("message", function (event) {
      if (event.source !== window) {
        return;
      }

      var data = event.data;
      if (
        !data ||
        data.source !== "byegpt" ||
        data.type !== "asset-fetch-request"
      ) {
        return;
      }

      fetchAssetBytes(data.payload).catch(function (error) {
        emitAssetFetchResponse({
          requestId: data.payload && data.payload.requestId,
          ok: false,
          error: String(error),
        });
      });
    });
  }

  async function fetchAssetBytes(payload) {
    if (!payload || !payload.requestId || !payload.url) {
      emitAssetFetchResponse({
        requestId: payload && payload.requestId,
        ok: false,
        error: "Missing asset fetch payload.",
      });
      return;
    }

    var response = await fetch(payload.url, {
      credentials: "include",
    });

    if (!response.ok) {
      emitAssetFetchResponse({
        requestId: payload.requestId,
        ok: false,
        status: response.status,
        error: "HTTP " + response.status,
      });
      return;
    }

    var arrayBuffer = await response.arrayBuffer();
    emitAssetFetchResponse(
      {
        requestId: payload.requestId,
        ok: true,
        url: response.url || payload.url,
        contentType: response.headers.get("content-type") || "",
        byteLength: arrayBuffer.byteLength,
        bytes: arrayBuffer,
      },
      [arrayBuffer],
    );
  }

  installFetchHook();
  installXhrHook();
  installAssetFetchBridge();
})();
