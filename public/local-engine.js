/**
 * local-engine.js — Decart Lucy VTON 3.5 Realtime Engine
 * Uses the official @decartai/sdk to stream live webcam to Decart AI
 * and render the remote stream where clothes are dynamically fitted to the body.
 */
(function () {
  "use strict";

  var DECART_SDK_URL = "https://esm.sh/@decartai/sdk@0.2.3";

  var state = {
    active: false,
    garmentUrl: null,
    cameraStream: null,
    realtimeClient: null,
    ghostImg: null,
    raf: null,
    canvas: null,
    ctx: null,
    isRealAI: false,
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getApiKey() {
    try {
      var k = (localStorage.getItem("aurafit_decart_api_key") || "").trim();
      if (!k.startsWith("dct_") || k.length < 25) return null;
      return k;
    } catch (e) {
      return null;
    }
  }

  function absoluteGarmentUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
    return window.location.origin + (url.startsWith("/") ? url : "/" + url);
  }

  function log() {
    if (window.decartLog) {
      window.decartLog.apply(null, arguments);
    } else {
      console.log.apply(null, arguments);
    }
  }

  function setConnState(s) {
    if (window.__decartSetConnectionState) window.__decartSetConnectionState(s);
    window.__decartConnectionState = s;
  }

  function showConnecting(visible, msg) {
    if (window.__decartShowConnecting) {
      window.__decartShowConnecting(visible, msg || "");
    }
    var co = document.getElementById("connecting-overlay");
    var cm = document.getElementById("connecting-msg");
    if (co) co.style.display = visible ? "flex" : "none";
    if (cm && msg) cm.textContent = msg;
  }

  function hideQueueForever() {
    if (window.__decartHideQueueForever) window.__decartHideQueueForever();
    var qc = document.getElementById("queue-card");
    if (qc) qc.style.display = "none";
  }

  // ─── Video Display ──────────────────────────────────────────────────────────

  function getLocalVideo() {
    return document.getElementById("local-video");
  }

  function getRemoteVideo() {
    return document.getElementById("remote-video");
  }

  function showLocalCamera(stream) {
    var lv = getLocalVideo();
    if (lv) {
      lv.srcObject = stream;
      lv.style.display = "block";
      lv.play().catch(function () {});
    }
    var rv = getRemoteVideo();
    if (rv) {
      rv.style.display = "none";
    }
    window.__decartIdlePreviewStream = stream;
  }

  function showAIStream(stream) {
    log("[Decart AI] Remote stream received — real AI try-on ACTIVE!");
    state.isRealAI = true;

    // Stop ghost overlay render loop & hide ghost canvas
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    if (state.canvas) {
      state.canvas.style.display = "none";
    }

    var lv = getLocalVideo();
    if (lv) lv.style.display = "none";

    var rv = getRemoteVideo();
    if (rv) {
      rv.srcObject = stream;
      rv.style.display = "block";
      rv.play().catch(function () {});
    }

    // Dismiss any loading overlays
    var asOl = document.getElementById("__decart-as-ol");
    if (asOl) {
      asOl.style.opacity = "0";
      setTimeout(function () { try { asOl.remove(); } catch (e) {} }, 500);
    }
    var shimmer = document.getElementById("shimmer");
    if (shimmer) shimmer.style.display = "none";

    // Mark as streaming
    window.__decartHasRemoteStream = true;
    window.__decartWebrtcConnected = true;
    window.__decartFirstFrameRendered = true;

    var ma = document.getElementById("main-area");
    if (ma) {
      ma.classList.remove("ma-idle");
      ma.classList.add("ma-active", "ma-streaming");
    }

    showConnecting(false);
    setConnState("connected");
  }

  function releaseCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(function (t) { t.stop(); });
      state.cameraStream = null;
    }
    window.__decartIdlePreviewStream = null;
    var lv = getLocalVideo();
    if (lv) {
      try { lv.srcObject = null; } catch (e) {}
      lv.style.display = "none";
    }
  }

  // ─── Ghost overlay fallback (when no key or while loading) ─────────────────

  function loadGhostImage(url) {
    if (!url) return;
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () { state.ghostImg = img; };
    img.onerror = function () { state.ghostImg = null; };
    img.src = absoluteGarmentUrl(url);
  }

  function ensureCanvas() {
    if (state.canvas) return state.canvas;
    var c = document.getElementById("__decart-canvas-local");
    if (!c) {
      c = document.createElement("canvas");
      c.id = "__decart-canvas-local";
      c.width = 720;
      c.height = 960;
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:5;display:block;pointer-events:none;";
      var ma = document.getElementById("main-area") || document.body;
      ma.appendChild(c);
    }
    state.canvas = c;
    state.ctx = c.getContext("2d");
    return c;
  }

  function ghostRenderLoop() {
    if (!state.active || state.isRealAI) return;
    var c = ensureCanvas();
    var ctx = state.ctx;
    var w = c.width, h = c.height;
    var lv = getLocalVideo();

    ctx.clearRect(0, 0, w, h);

    // If local video is active, draw it mirrored onto the canvas
    if (lv && lv.readyState >= 2 && lv.videoWidth) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      var vr = lv.videoWidth / lv.videoHeight;
      var cr = w / h;
      var dw, dh, dx, dy;
      if (vr > cr) {
        dh = h;
        dw = h * vr;
        dx = (w - dw) / 2;
        dy = 0;
      } else {
        dw = w;
        dh = w / vr;
        dx = 0;
        dy = (h - dh) / 2;
      }
      ctx.drawImage(lv, dx, dy, dw, dh);
      ctx.restore();
    }

    // Draw garment overlay
    if (state.ghostImg) {
      var img = state.ghostImg;
      var gh = h * 0.58;
      var gw = gh * (img.width / Math.max(1, img.height));
      var gx = (w - gw) / 2;
      var gy = h * 0.38;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 20;
      try { ctx.drawImage(img, gx, gy, gw, gh); } catch (e) {}
      ctx.restore();
    }

    state.raf = requestAnimationFrame(ghostRenderLoop);
  }

  function showNoKeyPrompt() {
    var existing = document.getElementById("__decart-nokey-prompt");
    if (existing) {
      existing.style.display = "flex";
      return;
    }
    var ma = document.getElementById("main-area") || document.body;
    var p = document.createElement("div");
    p.id = "__decart-nokey-prompt";
    p.style.cssText = [
      "position:absolute", "inset:0", "z-index:200",
      "display:flex", "flex-direction:column", "align-items:center",
      "justify-content:center", "padding:24px", "text-align:center",
      "background:rgba(10,11,18,0.85)", "backdrop-filter:blur(10px)",
      "gap:14px", "border-radius:inherit",
    ].join(";");
    p.innerHTML = [
      "<div style='width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#f97316);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(245,158,11,0.4);'>",
      "<svg width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>",
      "</div>",
      "<div style='font-size:16px;font-weight:700;color:#fff;'>Decart API Key Required</div>",
      "<div style='font-size:12px;color:#94a3b8;line-height:1.5;max-width:260px;'>",
      "To wear this garment with real AI body-fitting, enter your Decart API key.",
      "</div>",
      "<button id='__btn-nokey-modal' style='padding:11px 24px;background:linear-gradient(135deg,#f59e0b,#f97316);border:none;border-radius:10px;color:#fff;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 4px 15px rgba(245,158,11,0.3);'>",
      "Add API Key",
      "</button>",
    ].join("");
    ma.appendChild(p);
    document.getElementById("__btn-nokey-modal").addEventListener("click", function () {
      if (window.parent && window.parent.openKeyModal) {
        window.parent.openKeyModal();
      } else if (window.openKeyModal) {
        window.openKeyModal();
      }
    });
  }

  function hideNoKeyPrompt() {
    var p = document.getElementById("__decart-nokey-prompt");
    if (p) p.style.display = "none";
  }

  // ─── Main Session Control ────────────────────────────────────────────────────

  async function startSession(garmentUrl) {
    if (!garmentUrl) return;
    if (garmentUrl.endsWith(".svg")) garmentUrl = garmentUrl.replace(/\.svg$/, ".png");

    log("[startSession] Garment:", garmentUrl);
    state.garmentUrl = garmentUrl;
    state.active = true;
    state.isRealAI = false;

    // Dismiss static loading overlays
    var asOl = document.getElementById("__decart-as-ol");
    if (asOl) asOl.remove();
    if (window.__decartCancelLoadingOverlay) window.__decartCancelLoadingOverlay();
    hideQueueForever();

    var ma = document.getElementById("main-area");
    if (ma) {
      ma.classList.remove("ma-idle");
      ma.classList.add("ma-active", "ma-streaming");
    }
    var idle = document.getElementById("idle-placeholder");
    if (idle) idle.style.display = "none";

    loadGhostImage(garmentUrl);

    var apiKey = getApiKey();

    // ── Get camera stream ──
    if (!state.cameraStream || !state.cameraStream.active) {
      try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: "user",
          },
        });
      } catch (camErr) {
        log("[Camera] Permission denied or error:", camErr);
      }
    }

    if (state.cameraStream) {
      showLocalCamera(state.cameraStream);
    }

    if (!apiKey) {
      log("[startSession] No API key found — showing ghost overlay fallback");
      showNoKeyPrompt();
      if (state.canvas) state.canvas.style.display = "block";
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(ghostRenderLoop);
      return;
    }

    hideNoKeyPrompt();

    // ── Real Decart AI Virtual Try-On ──
    try {
      showConnecting(true, "Connecting to Decart AI (Lucy VTON 3.5)…");
      setConnState("connecting");
      log("[Connection] Loading official @decartai/sdk…");

      // Disconnect previous session if any
      if (state.realtimeClient) {
        try { state.realtimeClient.disconnect(); } catch (e) {}
        state.realtimeClient = null;
      }

      // Load Decart SDK
      var sdk = await import(DECART_SDK_URL);
      var createDecartClient = sdk.createDecartClient;
      var models = sdk.models;

      var model = models.realtime("lucy-vton-3.5");

      log("[Connection] Initializing Decart Client with API key…");
      var client = createDecartClient({ apiKey: apiKey });

      // Fetch garment image as a Blob so Decart SDK transmits the image data
      var imgUrl = absoluteGarmentUrl(garmentUrl);
      var garmentBlob = null;
      try {
        var gRes = await fetch(imgUrl);
        if (gRes.ok) {
          garmentBlob = await gRes.blob();
        }
      } catch (e) {
        log("[Garment Blob fetch] Note:", e && e.message);
      }

      log("[Connection] Connecting realtime WebRTC stream to Decart…");
      state.realtimeClient = await client.realtime.connect(state.cameraStream, {
        model: model,
        mirror: "auto",
        onRemoteStream: function (transformedStream) {
          showAIStream(transformedStream);
        },
      });

      log("[Connection] 🟢 CONNECTED to Decart Realtime AI");
      setConnState("connected");

      // Apply garment to subject
      log("[Try-On] Applying garment to body…");
      await state.realtimeClient.set({
        prompt: "Substitute the current top with this clothing garment",
        image: garmentBlob || imgUrl,
        enhance: false,
      });

      log("[Try-On] Garment applied ✓ — AI body try-on is rendering");

    } catch (err) {
      log("[startSession] Decart Realtime Error:", err && err.message || err);
      showConnecting(false);
      setConnState("connected"); // keep connected state so UI doesn't crash

      // Fall back gracefully to preview camera + ghost overlay
      if (!state.isRealAI) {
        if (state.canvas) state.canvas.style.display = "block";
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = requestAnimationFrame(ghostRenderLoop);
      }
    }
  }

  function stopSession(reason, opts) {
    opts = opts || {};
    log("[stopSession]", reason, opts);
    state.active = false;
    state.isRealAI = false;

    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    if (state.canvas) {
      state.canvas.style.display = "none";
    }

    if (state.realtimeClient) {
      try { state.realtimeClient.disconnect(); } catch (e) {}
      state.realtimeClient = null;
    }

    if (opts.final || reason === "final") {
      releaseCamera();
    }

    window.__decartHasRemoteStream = false;
    window.__decartWebrtcConnected = false;
    setConnState("disconnected");

    var rv = getRemoteVideo();
    if (rv) {
      rv.style.display = "none";
      try { rv.srcObject = null; } catch (e) {}
    }

    if (opts.final) {
      showConnecting(false);
      var ma = document.getElementById("main-area");
      if (ma) {
        ma.classList.remove("ma-streaming", "ma-active");
        ma.classList.add("ma-idle");
      }
      var idle = document.getElementById("idle-placeholder");
      if (idle) idle.style.display = "flex";
    }
  }

  async function changeGarment(garmentUrl) {
    if (!state.realtimeClient) {
      startSession(garmentUrl);
      return;
    }
    state.garmentUrl = garmentUrl;
    loadGhostImage(garmentUrl);

    try {
      var imgUrl = absoluteGarmentUrl(garmentUrl);
      var garmentBlob = null;
      try {
        var gRes = await fetch(imgUrl);
        if (gRes.ok) garmentBlob = await gRes.blob();
      } catch (e) {}

      await state.realtimeClient.set({
        prompt: "Substitute the current top with this clothing garment",
        image: garmentBlob || imgUrl,
        enhance: false,
      });
      log("[garment_change] AI garment updated →", imgUrl);
    } catch (e) {
      log("[garment_change] error, restarting session:", e && e.message);
      startSession(garmentUrl);
    }
  }

  // ─── Listen for postMessages from parent (demo.html / index.html) ──────────
  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || !msg.type) return;

    if (msg.type === "DECART_AUTO_START" && msg.productImageUrl) {
      log("[Try-on] → DECART_AUTO_START received — image:", msg.productImageUrl);
      if (state.active && state.realtimeClient) {
        changeGarment(msg.productImageUrl);
      } else {
        startSession(msg.productImageUrl);
      }
    }
  });

  // ─── Auto-start if URL param present ────────────────────────────────────────
  (function () {
    try {
      var params = new URLSearchParams(window.location.search);
      var g = params.get("garment") || params.get("productImage");
      if (g) {
        setTimeout(function () { startSession(g); }, 150);
      }
    } catch (e) {}
  })();

  // ─── Idle camera activation button ──────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    var camBtn = document.getElementById("camera-btn");
    if (camBtn) {
      camBtn.addEventListener("click", function () {
        var g = state.garmentUrl || "/shirt1.png";
        startSession(g);
      });
    }
  });

  // ─── Expose Public API for Widget Host ──────────────────────────────────────
  window.__decartStartSession = startSession;
  window.__decartStopSession = stopSession;
  window.__decartChangeGarment = changeGarment;
  window.__decartForceSessionEnd = function (r) { stopSession(r || "force", { final: true }); };
  window.__decartEndSession = function (r) { stopSession(r || "end", { final: true }); };
  window.__decartRestartSession = function () { if (state.garmentUrl) startSession(state.garmentUrl); };
  window.__decartDisconnect = function () {
    if (state.realtimeClient) {
      try { state.realtimeClient.disconnect(); } catch (e) {}
      state.realtimeClient = null;
    }
    setConnState("disconnected");
  };
  window.__decartSQ = {
    stopRemoteOnly: function () {
      if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
      window.__decartHasRemoteStream = false;
      var rv = getRemoteVideo();
      if (rv) { try { rv.srcObject = null; } catch (e) {} rv.style.display = "none"; }
    },
    getLocalStream: function () { return state.cameraStream; },
    stopAll: function () { stopSession("sq", { final: true }); },
  };
  window.__anywearLocal = {
    start: function (g) { startSession(g); },
    stop: function () { stopSession("stop", { final: true }); },
    restart: function () { if (state.garmentUrl) startSession(state.garmentUrl); },
  };

  log("[Decart Realtime Engine] Ready — powered by @decartai/sdk Lucy VTON 3.5");
})();
