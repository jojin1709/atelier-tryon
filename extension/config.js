// config.js — dynamic endpoint resolution for Decart cloud SDK
(function () {
  var LOCAL = "http://127.0.0.1:7860";

  var host = window.location.hostname;
  var isLocal = (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.")
  );

  // Auto-clear old fake placeholder key if still stored
  var FAKE_KEY_MARKER = "fdsfgsgfsdfgfs";
  var storedKey = "";
  try {
    var raw = (localStorage.getItem("aurafit_decart_api_key") || "").trim();
    if (raw.includes(FAKE_KEY_MARKER)) {
      localStorage.removeItem("aurafit_decart_api_key");
      raw = "";
    }
    storedKey = raw;
  } catch(e) {}

  var BASE = isLocal ? LOCAL : "";

  // Embed the key as a query param so our /api/tokens proxy can forward it to Decart
  var tokenBase = BASE + "/api/tokens";
  if (storedKey && storedKey.startsWith("dct_") && storedKey.length > 30) {
    tokenBase += "?k=" + encodeURIComponent(storedKey);
  }

  window.DECART_CONFIG = {
    WIDGET_SIDE: "left",
    TOKEN_ENDPOINT_URL:  tokenBase,
    QUEUE_ENDPOINT_BASE: BASE,
    IMAGE_PROXY_URL:     BASE + "/api/proxy-image",
    LOCAL_SERVER_URL: isLocal ? LOCAL : null,
    QUEUE_MAX_WAIT_MS: 5000,
    DEBUG: true,
    CONNECT_TIMEOUT_MS: 15000,
    SESSION_INACTIVITY_SECONDS: 180,
    SESSION_INACTIVITY_ACTION: "reset",
    SESSION_MAX_IMAGES: 50,
    SLOW_CONNECTION_THRESHOLD_MBPS: 1.5,
    SLOW_CONNECTION_TRIGGER_COUNT: 5,
    RECORDING_ENABLED: false,
    SESSION_RECAP_ENABLED: false,
    ATC_PROMPT_ENABLED: false,
    MODERATION_RESET_ATTEMPT: {
      ENABLED: false,
      NSFW_THRESHOLD: 0.8,
      SERVER_SIDE_ENFORCEMENT: false,
      MAX_RESETS_PER_SESSION: 0,
      RESET_WITH_ENHANCEMENT: false,
      REARM_DETECTOR: false,
      FRESH_CACHE_MS: 2000,
      RESET_SETTLE_MS: 4000,
      RESET_APPLY_MS: 400,
      REARM_GRACE_MS: 600,
      OUTPUT_FLAGS_ONLY: true,
      GIVE_UP_ACTION: "end_session",
      GIVE_UP_MESSAGE: "Something went wrong.",
      GIVE_UP_MESSAGE_UNSUPPORTED: "This item is not supported",
      GIVE_UP_RESTART_LABEL_UNSUPPORTED: "Restart",
      RESET_MESSAGE_ENABLED: false,
      RESET_MESSAGE_TITLE: "We couldn't process that",
      RESET_MESSAGE_SUBTITLE: "Restarting the session",
      RESET_MESSAGE_BLUR: true,
      RESET_MESSAGE_TARGET_MS: 500,
      RESET_MESSAGE_FADE_MS: 120,
      RESET_MESSAGE_MAX_MS: 12000,
      SET_IMAGE_ACK_TIMEOUT_MS: 15000,
      REARM_ACK_TIMEOUT_MS: 5000,
      DEBUG_PANEL: false
    },
    SHOW_TRYON_BUTTONS_WHEN_WIDGET_CLOSED: true,
  };
})();
