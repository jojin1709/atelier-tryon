/**
 * widget-prefetch.js — local build: keep proxy rewrite for chrome-extension URLs,
 * no Decart preconnect, no billing surface warming.
 */
if ("1" === new URLSearchParams(location.search).get("norestore")) {
  try { sessionStorage.removeItem("decart_auto_start_url"); } catch (n) {}
}

!function () {
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      var idx = input.indexOf("/api/proxy-image?url=");
      if (idx !== -1) {
        var target = decodeURIComponent(input.slice(idx + 21));
        if (target.startsWith("chrome-extension://")) {
          return nativeFetch(target, init);
        }
      }
    }
    return nativeFetch(input, init);
  };
}();

window.__decartWarmBillingSurface = function () {};
