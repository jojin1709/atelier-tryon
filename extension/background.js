/**
 * background.js — local service worker for Anywear Local Virtual Try-On.
 * No external telemetry. All requests point to local server / browser.
 */

function _getOrCreateInstallId(cb) {
  try {
    chrome.storage.local.get("installation_id", function (t) {
      if (t && t.installation_id) return cb(t.installation_id);
      var n = crypto.randomUUID();
      chrome.storage.local.set({ installation_id: n }, function () { cb(n); });
    });
  } catch (e) {
    cb("local");
  }
}

function _bufToDataUrl(buf, mimeType) {
  var bytes = new Uint8Array(buf);
  var binary = "";
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return "data:" + (mimeType || "image/jpeg") + ";base64," + btoa(binary);
}

function _openWidgetPopup(url) {
  var targetUrl = url || chrome.runtime.getURL("widget.html");
  chrome.windows.create({
    url: targetUrl,
    type: "popup",
    width: 440,
    height: 740,
    focused: true,
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== "object") return false;

  switch (msg.type) {
    case "DECART_FETCH_IMAGE": {
      fetch(msg.url)
        .then(function (r) {
          var ct = r.headers.get("content-type") || "image/jpeg";
          return r.arrayBuffer().then(function (buf) {
            var dataUrl = _bufToDataUrl(buf, ct);
            sendResponse({ ok: true, dataUrl: dataUrl, data: Array.from(new Uint8Array(buf)) });
          });
        })
        .catch(function (e) {
          sendResponse({ ok: false, error: String(e) });
        });
      return true; // async
    }

    case "DECART_HASH_IMAGE":
      sendResponse({ ok: true, hash: null });
      return false;

    case "DECART_TRACK_EVENT_WIN":
      sendResponse({ ok: true, billing_ui: null });
      return false;

    case "DECART_GET_INSTALLATION_INFO":
      _getOrCreateInstallId(function (id) {
        sendResponse({
          installation_id: id,
          ext_version: chrome.runtime.getManifest().version,
        });
      });
      return true;

    case "DECART_POPUP_OPEN_TAB":
    case "DECART_POPUP_OPEN": {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "DECART_POPUP_OPEN" }, function (res) {
            if (chrome.runtime.lastError || !res) {
              // Target tab has no content script (chrome://, webstore, etc.)
              _openWidgetPopup();
            }
          });
        } else {
          _openWidgetPopup();
        }
      });
      sendResponse({ ok: true });
      return false;
    }

    case "DECART_POPUP_OPEN_ONBOARDING": {
      var demoUrl = "http://127.0.0.1:7860/demo";
      chrome.tabs.create({ url: demoUrl });
      sendResponse({ ok: true });
      return false;
    }

    case "DECART_OPEN_TAB": {
      if (msg.url) {
        chrome.tabs.create({ url: msg.url });
      }
      sendResponse({ ok: true });
      return false;
    }

    case "DECART_OPEN_POPUP": {
      _openWidgetPopup(msg.url);
      sendResponse({ ok: true });
      return false;
    }

    case "DECART_OPEN_WINDOW": {
      var query = ["autostart=1"];
      if (msg.productImageUrl) query.push("garment=" + encodeURIComponent(msg.productImageUrl));
      if (msg.cameraGranted) query.push("camgranted=1");
      var winUrl = chrome.runtime.getURL("widget.html?" + query.join("&"));
      _openWidgetPopup(winUrl);
      sendResponse({ ok: true });
      return false;
    }

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(function () {
  _getOrCreateInstallId(function () {});
});
