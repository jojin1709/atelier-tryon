/**
 * local-engine.js — replaces widget.bundle.js cloud/LiveKit path.
 * Talks to local FastAPI server (127.0.0.1:7860). Free, no queue, no billing.
 *
 * Live: camera frames → composite canvas (garment ghost + periodic CatVTON keyframe)
 *       → canvas.captureStream() → #remote-video
 * Photo: capture frame + garment → POST /tryon/photo → show result
 */
(function () {
  "use strict";

  var SERVER = (window.DECART_CONFIG && window.DECART_CONFIG.LOCAL_SERVER_URL) || "http://127.0.0.1:7860";
  var CFG = window.DECART_CONFIG || {};

  // ---------------------------------------------------------------------------
  // Globals expected by widget-init.js / widget-html
  // ---------------------------------------------------------------------------
  window.__decartInQueue = false;
  window.__decartServerBusy = false;
  window.__decartHasRemoteStream = false;
  window.__decartFirstFrameRendered = false;
  window.__decartWebrtcConnected = false;
  window.__decartPCs = [];
  window.__decartModelSlug = "catvton-local";
  window.__decartApiSessionId = "local-" + Date.now();
  window.__decartServerSessionConfig = { model: "catvton-local", local: true };
  window.__decart_connection_state = window.__decart_connection_state || "connected";
  window.__decartTrackPurchaseIntent = function () {};
  window.__decartCancelLoadingOverlay = function () {
    var el = document.getElementById("connecting-overlay");
    if (el) el.style.display = "none";
  };
  window.__decartTryOnGate = function () { return "allowed"; };
  window.__decartTryOnBlocked = function () { return false; };
  window.__decartSessionLive = function () { return !!state.active; };
  window.__decartBillingWait = function () { return false; };
  window.__decartUnavailable = function () { return false; };

  if (!window.decartLog) {
    window.decartLog = function () {
      if (CFG.DEBUG) {
        try { console.log.apply(console, ["[Anywear/local]"].concat([].slice.call(arguments))); } catch (e) {}
      }
    };
  }

  function setConnState(s) {
    window.__decart_connection_state = s;
    try {
      window.dispatchEvent(new CustomEvent("__decart_connection_state", { detail: s }));
    } catch (e) {}
  }

  function getAssetUrl(rel) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      try { return chrome.runtime.getURL(rel); } catch (e) {}
    }
    return rel;
  }

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------
  var state = {
    active: false,
    garmentUrl: null,
    cameraStream: null,
    ws: null,
    canvas: null,
    ctx: null,
    outStream: null,
    raf: null,
    sendTimer: null,
    keyframeImg: null,
    keyframeAt: 0,
    keyframeFade: 0, // 0..1 opacity of keyframe layer
    ghostImg: null,
    ghostReady: false,
    lastPoseBox: null,
    frameW: 640,
    frameH: 480,
    fps: 20,
    stopTimer: null,
    startedAt: 0,
  };

  var localVideo = null;
  var remoteVideo = null;

  function els() {
    if (!localVideo) localVideo = document.getElementById("local-video");
    if (!remoteVideo) remoteVideo = document.getElementById("remote-video");
    return { lv: localVideo, rv: remoteVideo };
  }

  function showConnecting(show, msg) {
    var ov = document.getElementById("connecting-overlay");
    if (!ov) return;
    if (show) {
      ov.classList.remove("queue-active");
      ov.style.display = "flex";
      var m = document.getElementById("connecting-msg");
      if (m && msg) m.textContent = msg;
      var card = document.getElementById("queue-card");
      if (card) card.style.display = "none";
      var pos = document.getElementById("connecting-queue-pos");
      if (pos) pos.style.display = "none";
      var eta = document.getElementById("connecting-queue-eta");
      if (eta) eta.style.display = "none";
      var cta = document.getElementById("queue-purchase-credits");
      if (cta) cta.style.display = "none";
    } else {
      ov.classList.remove("queue-active");
      ov.style.display = "none";
    }
  }

  function hideQueueForever() {
    var card = document.getElementById("queue-card");
    if (card) card.style.display = "none";
    var cta = document.getElementById("queue-purchase-credits");
    if (cta) cta.style.display = "none";
    var note = document.getElementById("queue-purchase-note");
    if (note) note.style.display = "none";
    var ov = document.getElementById("connecting-overlay");
    if (ov) ov.classList.remove("queue-active");
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  function startCamera() {
    return new Promise(function (resolve, reject) {
      if (state.cameraStream && state.cameraStream.active) {
        resolve(state.cameraStream);
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject(new Error("Camera API not available in this browser context"));
        return;
      }
      navigator.mediaDevices
        .getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        })
        .then(function (s) {
          state.cameraStream = s;
          var e = els();
          if (e.lv) {
            e.lv.srcObject = s;
            e.lv.muted = true;
            e.lv.playsInline = true;
            e.lv.play().catch(function () {});
            e.lv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;display:block;";
          }
          var idle = document.getElementById("idle-placeholder");
          if (idle) idle.style.display = "none";
          var ma = document.getElementById("main-area");
          if (ma) {
            ma.classList.remove("ma-idle");
            ma.classList.add("ma-active");
          }
          window.__decartIdlePreviewStream = s;
          ensureCanvas();
          resolve(s);
        })
        .catch(reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Render loop: camera + garment ghost + keyframe crossfade → canvas
  // ---------------------------------------------------------------------------
  function ensureCanvas() {
    var c = document.getElementById("tryon-canvas");
    if (!c) {
      c = document.createElement("canvas");
      c.id = "tryon-canvas";
      c.width = state.frameW;
      c.height = state.frameH;
      c.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:10;display:block;pointer-events:none;";
      var ma = document.getElementById("main-area") || document.body;
      ma.appendChild(c);
    }
    state.canvas = c;
    state.ctx = c.getContext("2d", { alpha: false });
    return c;
  }

  function attachOutStream() {
    var e = els();
    if (!e.rv) return;
    var c = ensureCanvas();
    if (!state.outStream) {
      try {
        state.outStream = c.captureStream(state.fps);
      } catch (err) {
        window.decartLog("captureStream failed", err);
        return;
      }
    }
    e.rv.srcObject = state.outStream;
    e.rv.muted = true;
    e.rv.playsInline = true;
    e.rv.style.display = "block";
    e.rv.play().catch(function () {});
    window.__decartHasRemoteStream = true;
    window.__decartWebrtcConnected = true;
    var ma = document.getElementById("main-area");
    if (ma) {
      ma.classList.remove("ma-idle");
      ma.classList.add("ma-active");
      ma.classList.add("ma-streaming");
    }
    setConnState("connected");
  }

  function loadGhost(url) {
    if (!url) return;
    if (url.endsWith(".svg")) url = url.replace(/\.svg$/, ".png");
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      state.ghostImg = img;
      state.ghostReady = true;
    };
    img.onerror = function () {
      // try via local proxy if http
      if (url.startsWith("http")) {
        var img2 = new Image();
        img2.onload = function () {
          state.ghostImg = img2;
          state.ghostReady = true;
        };
        img2.src = SERVER + "/api/proxy-image?url=" + encodeURIComponent(url);
      }
    };
    img.src = url;
  }

  function drawGhost(ctx, w, h) {
    if (!state.ghostReady || !state.ghostImg) return;
    var img = state.ghostImg;
    // Torso fit: ~58% width, placed over chest and shoulders
    var gw = w * 0.58;
    var gh = gw * (img.height / Math.max(1, img.width));
    if (gh > h * 0.60) {
      gh = h * 0.60;
      gw = gh * (img.width / Math.max(1, img.height));
    }
    var x = (w - gw) / 2;
    var y = h * 0.42; // Sits naturally below chin and neck over torso
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.96;
    try {
      ctx.drawImage(img, x, y, gw, gh);
    } catch (e) {}
    ctx.restore();
  }

  function drawKeyframe(ctx, w, h) {
    if (!state.keyframeImg || state.keyframeFade <= 0) return;
    var img = state.keyframeImg;
    ctx.save();
    ctx.globalAlpha = Math.min(1, state.keyframeFade);
    // cover-fit
    var ir = img.width / img.height;
    var cr = w / h;
    var dw, dh, dx, dy;
    if (ir > cr) {
      dh = h;
      dw = h * ir;
      dx = (w - dw) / 2;
      dy = 0;
    } else {
      dw = w;
      dh = w / ir;
      dx = 0;
      dy = (h - dh) / 2;
    }
    try {
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch (e) {}
    ctx.restore();
  }

  function renderLoop() {
    if (!state.active) return;
    var c = ensureCanvas();
    var ctx = state.ctx;
    var w = c.width;
    var h = c.height;
    var e = els();
    var lv = e.lv;

    ctx.fillStyle = "#0c0d14";
    ctx.fillRect(0, 0, w, h);

    if (lv && lv.readyState >= 2 && lv.videoWidth) {
      // Draw camera horizontally mirrored for natural mirror feeling
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      var vr = lv.videoWidth / lv.videoHeight;
      var cr = w / h;
      var dw, dh, dx, dy;
      if (vr > cr) {
        dh = h; dw = h * vr; dx = (w - dw) / 2; dy = 0;
      } else {
        dw = w; dh = w / vr; dx = 0; dy = (h - dh) / 2;
      }
      try {
        ctx.drawImage(lv, dx, dy, dw, dh);
      } catch (err) {}
      ctx.restore();
    } else if (state.personImg) {
      // Photo mode
      var pw = state.personImg.width;
      var ph = state.personImg.height;
      var pr = pw / ph;
      var cr2 = w / h;
      var pdw, pdh, pdx, pdy;
      if (pr > cr2) {
        pdh = h; pdw = h * pr; pdx = (w - pdw) / 2; pdy = 0;
      } else {
        pdw = w; pdh = w / pr; pdx = 0; pdy = (h - pdh) / 2;
      }
      try {
        ctx.drawImage(state.personImg, pdx, pdy, pdw, pdh);
      } catch (e) {}
    } else {
      // Elegant studio backdrop gradient when camera is warming up
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#161926");
      grad.addColorStop(1, "#0a0b12");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // Ghost garment preview (instant visual feedback)
    if (state.keyframeFade < 0.85) drawGhost(ctx, w, h);

    // Keyframe crossfade in/out
    var age = (performance.now() - state.keyframeAt) / 1000;
    if (state.keyframeImg) {
      if (age < 0.4) state.keyframeFade = age / 0.4;
      else if (age < 3.5) state.keyframeFade = 1;
      else if (age < 4.2) state.keyframeFade = 1 - (age - 3.5) / 0.7;
      else {
        state.keyframeFade = 0;
        state.keyframeImg = null;
      }
      drawKeyframe(ctx, w, h);
    }

    if (!window.__decartFirstFrameRendered) {
      window.__decartFirstFrameRendered = true;
    }

    state.raf = requestAnimationFrame(renderLoop);
  }

  function sendFrameLoop() {
    if (!state.active || !state.ws || state.ws.readyState !== 1) return;
    try {
      var c = ensureCanvas();
      c.toBlob(
        function (blob) {
          if (!blob || !state.ws || state.ws.readyState !== 1) return;
          blob.arrayBuffer().then(function (buf) {
            try {
              if (state.ws && state.ws.readyState === 1) state.ws.send(buf);
            } catch (e) {}
          });
        },
        "image/jpeg",
        0.7
      );
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------
  function connectWS() {
    return new Promise(function (resolve, reject) {
      try {
        if (state.ws) {
          try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
          state.ws = null;
        }
        var url = SERVER.replace(/^http/, "ws") + "/tryon/live";
        var ws = new WebSocket(url);
        var settled = false;
        ws.binaryType = "arraybuffer";
        var to = setTimeout(function () {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch (e) {}
            reject(new Error("Local server not responding at " + url));
          }
        }, 3500);
        ws.onopen = function () {
          if (settled) return;
          settled = true;
          clearTimeout(to);
          state.ws = ws;
          resolve(ws);
        };
        ws.onerror = function () {
          if (!settled) {
            settled = true;
            clearTimeout(to);
            reject(new Error("Local server connection error"));
          }
        };
        ws.onclose = function () {
          if (state.active && state.ws === ws) {
            setConnState("disconnected");
          }
        };
        ws.onmessage = function (ev) {
          if (typeof ev.data !== "string") return;
          try {
            var msg = JSON.parse(ev.data);
            if (msg.type === "keyframe" && msg.jpeg_b64) {
              var img = new Image();
              img.onload = function () {
                state.keyframeImg = img;
                state.keyframeAt = performance.now();
                state.keyframeFade = 0;
              };
              img.src = "data:image/jpeg;base64," + msg.jpeg_b64;
            } else if (msg.type === "keyframe_error") {
              window.decartLog("keyframe_error", msg.error);
            } else if (msg.type === "garment_ack") {
              window.decartLog("garment_ack", msg);
            }
          } catch (e) {}
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public session controls (used by widget-init)
  // ---------------------------------------------------------------------------
  function stopSession(reason, opts) {
    opts = opts || {};
    window.decartLog("stopSession", reason, opts);
    state.active = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    if (state.sendTimer) clearInterval(state.sendTimer);
    state.sendTimer = null;
    if (state.ws) {
      try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
      state.ws = null;
    }
    window.__decartHasRemoteStream = false;
    window.__decartWebrtcConnected = false;

    if (opts.final || reason === "final") {
      releaseCamera();
    }
    var e = els();
    if (e.rv) {
      e.rv.style.display = "none";
      try { e.rv.srcObject = null; } catch (err) {}
    }
    setConnState("disconnected");
    if (opts.final) {
      showConnecting(false);
      var ma = document.getElementById("main-area");
      if (ma) {
        ma.classList.remove("ma-streaming");
        ma.classList.remove("ma-active");
        ma.classList.add("ma-idle");
      }
      var idle = document.getElementById("idle-placeholder");
      if (idle) idle.style.display = "flex";
    }
  }

  function releaseCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(function (t) { t.stop(); });
      state.cameraStream = null;
    }
    var e = els();
    if (e.lv) {
      try { e.lv.srcObject = null; } catch (err) {}
      e.lv.style.display = "none";
    }
    window.__decartIdlePreviewStream = null;
  }

  window.__decartStopSession = stopSession;
  window.__decartForceSessionEnd = function (reason) { stopSession(reason || "force", { final: true }); };
  window.__decartEndSession = function (reason) { stopSession(reason || "end", { final: true }); };
  window.__decartDisconnect = function () {
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }
    setConnState("disconnected");
  };
  window.__decartRestartSession = function () {
    if (state.garmentUrl) startSession(state.garmentUrl);
  };
  window.__decartSQ = {
    stopRemoteOnly: function () {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      if (state.sendTimer) clearInterval(state.sendTimer);
      state.sendTimer = null;
      window.__decartHasRemoteStream = false;
      var e = els();
      if (e.rv) {
        try { e.rv.srcObject = null; } catch (err) {}
        e.rv.style.display = "none";
      }
    },
    getLocalStream: function () { return state.cameraStream; },
    stopAll: function () { stopSession("sq", { final: true }); },
  };

  // ---------------------------------------------------------------------------
  // Start session
  // ---------------------------------------------------------------------------
  function showCameraPrompt() {
    var existing = document.getElementById("__aurafit-cam-prompt");
    if (existing) {
      existing.style.display = "flex";
      return;
    }
    var ma = document.getElementById("main-area") || document.body;
    var p = document.createElement("div");
    p.id = "__aurafit-cam-prompt";
    p.style.cssText = [
      "position:absolute", "inset:0", "margin:auto",
      "width:88%", "max-width:320px", "height:fit-content",
      "z-index:99", "padding:22px 20px", "border-radius:18px",
      "background:rgba(18, 20, 32, 0.88)",
      "backdrop-filter:blur(20px)", "-webkit-backdrop-filter:blur(20px)",
      "border:1px solid rgba(99, 102, 241, 0.35)",
      "box-shadow:0 16px 40px rgba(0,0,0,0.6)",
      "display:flex", "flex-direction:column", "align-items:center", "text-align:center", "gap:12px"
    ].join(";");

    p.innerHTML = [
      '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#06b6d4);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(99,102,241,0.4);">',
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      '</div>',
      '<div style="font-size:15px;font-weight:700;color:#fff;letter-spacing:-0.01em;">AuraFit Live Mirror</div>',
      '<div style="font-size:12px;color:#94a3b8;line-height:1.45;">Click below to enable your camera and see yourself try on this garment in real-time.</div>',
      '<button id="__btn-prompt-cam" style="width:100%;padding:11px 16px;background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;border-radius:10px;color:#fff;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(99,102,241,0.35);font-family:inherit;">',
      '🎥 Turn On Mirror Camera',
      '</button>',
      '<button id="__btn-prompt-photo" style="width:100%;padding:9px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:#e2e8f0;font-weight:500;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;">',
      '📁 Upload Photo / Selfie',
      '</button>',
      '<input type="file" id="__input-prompt-photo" accept="image/*" style="display:none;">'
    ].join("");

    ma.appendChild(p);

    document.getElementById("__btn-prompt-cam").addEventListener("click", function () {
      startCamera()
        .then(function () {
          hideCameraPrompt();
        })
        .catch(function (err) {
          alert("Could not access camera: " + (err && err.message || err));
        });
    });

    var fileInput = document.getElementById("__input-prompt-photo");
    document.getElementById("__btn-prompt-photo").addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var pImg = new Image();
          pImg.onload = function () {
            state.personImg = pImg;
            hideCameraPrompt();
          };
          pImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function hideCameraPrompt() {
    var p = document.getElementById("__aurafit-cam-prompt");
    if (p) p.style.display = "none";
  }

  function startSession(garmentUrl) {
    if (!garmentUrl) return;
    if (garmentUrl.endsWith(".svg")) garmentUrl = garmentUrl.replace(/\.svg$/, ".png");
    window.decartLog("startSession", garmentUrl);
    state.garmentUrl = garmentUrl;
    state.active = true;
    state.startedAt = performance.now();
    state.keyframeImg = null;
    state.keyframeFade = 0;
    state.frameW = 640;
    state.frameH = 480;
    hideQueueForever();

    // Dismiss any old loading or blocking overlays
    var asOl = document.getElementById("__decart-as-ol");
    if (asOl) asOl.remove();
    var nc = document.getElementById("__decart-no-connect");
    if (nc) nc.remove();
    if (window.__decartCancelLoadingOverlay) window.__decartCancelLoadingOverlay();

    loadGhost(garmentUrl);
    attachOutStream();
    ensureCanvas();

    var ma = document.getElementById("main-area");
    if (ma) {
      ma.classList.remove("ma-idle");
      ma.classList.add("ma-active");
      ma.classList.add("ma-streaming");
    }
    var idle = document.getElementById("idle-placeholder");
    if (idle) idle.style.display = "none";

    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(renderLoop);
    showConnecting(false);

    try { sessionStorage.setItem("decart_auto_start_url", garmentUrl); } catch (e) {}

    // Check if camera is active
    if (state.cameraStream && state.cameraStream.active) {
      hideCameraPrompt();
      connectWS()
        .then(function (ws) {
          ws.send(JSON.stringify({ type: "set_garment", url: garmentUrl }));
          ws.send(JSON.stringify({ type: "config", keyframe_interval: 3.0 }));
          if (state.sendTimer) clearInterval(state.sendTimer);
          state.sendTimer = setInterval(sendFrameLoop, 200);
        })
        .catch(function () {});
      return;
    }

    // Attempt starting camera
    startCamera()
      .then(function () {
        hideCameraPrompt();
        connectWS()
          .then(function (ws) {
            ws.send(JSON.stringify({ type: "set_garment", url: garmentUrl }));
            ws.send(JSON.stringify({ type: "config", keyframe_interval: 3.0 }));
            if (state.sendTimer) clearInterval(state.sendTimer);
            state.sendTimer = setInterval(sendFrameLoop, 200);
          })
          .catch(function () {});
      })
      .catch(function (err) {
        window.decartLog("Camera permission deferred:", err);
        showCameraPrompt();
      });
  }

  // ---------------------------------------------------------------------------
  // Photo mode
  // ---------------------------------------------------------------------------
  function capturePersonDataUrl() {
    return new Promise(function (resolve, reject) {
      startCamera()
        .then(function () {
          var e = els();
          var lv = e.lv;
          if (!lv || lv.readyState < 2) {
            lv && lv.addEventListener("loadeddata", function () { tryResolve(); }, { once: true });
            setTimeout(function () { tryResolve(); }, 1500);
          } else {
            tryResolve();
          }
          function tryResolve() {
            try {
              var c = document.createElement("canvas");
              c.width = lv.videoWidth || 480;
              c.height = lv.videoHeight || 640;
              var ctx = c.getContext("2d");
              ctx.drawImage(lv, 0, 0, c.width, c.height);
              resolve(c.toDataURL("image/jpeg", 0.92));
            } catch (err) {
              reject(err);
            }
          }
        })
        .catch(reject);
    });
  }

  function runPhotoTryon() {
    if (!state.garmentUrl) {
      alert("Select a garment first (e.g. click one of the sample shirts below or drag one in)");
      return Promise.reject(new Error("no garment"));
    }
    showConnecting(true, "Generating Photo Try-On…");
    return capturePersonDataUrl()
      .then(function (person) {
        return fetch(SERVER + "/tryon/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: person,
            garment: state.garmentUrl,
            steps: 18,
          }),
        });
      })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 300)); });
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        showPhotoResult(url);
        showConnecting(false);
        return url;
      })
      .catch(function (err) {
        window.decartLog("Backend photo try-on failed, creating clean composite:", err);
        return capturePersonDataUrl().then(function (personDataUrl) {
          return new Promise(function (resolve) {
            var c = document.createElement("canvas");
            c.width = 480;
            c.height = 640;
            var ctx = c.getContext("2d");
            var pImg = new Image();
            pImg.onload = function () {
              ctx.drawImage(pImg, 0, 0, 480, 640);
              var gImg = state.ghostImg || new Image();
              function drawGarment() {
                var gw = 260;
                var gh = 260 * ((gImg.naturalHeight || 1) / (gImg.naturalWidth || 1));
                ctx.drawImage(gImg, (480 - gw) / 2, 130, gw, gh);
                var compUrl = c.toDataURL("image/png");
                showPhotoResult(compUrl);
                showConnecting(false);
                resolve(compUrl);
              }
              if (gImg.complete && gImg.naturalWidth) {
                drawGarment();
              } else {
                gImg.onload = drawGarment;
                gImg.src = state.garmentUrl;
              }
            };
            pImg.src = personDataUrl;
          });
        });
      });
  }

  function showPhotoResult(url) {
    var host = document.getElementById("main-area") || document.body;
    var ov = document.getElementById("__local-photo-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "__local-photo-ov";
      ov.style.cssText =
        "position:absolute;inset:0;z-index:300;background:rgba(0,0,0,0.92);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;";
      var img = document.createElement("img");
      img.id = "__local-photo-img";
      img.style.cssText = "max-width:90%;max-height:75%;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);object-fit:contain;";
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:12px;margin-top:16px;";
      var save = document.createElement("a");
      save.textContent = "Download Photo";
      save.style.cssText =
        "background:#fff;color:#000;padding:10px 22px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:600;display:inline-block;";
      var close = document.createElement("button");
      close.textContent = "Close";
      close.style.cssText =
        "background:rgba(255,255,255,0.18);color:#fff;border:none;padding:10px 22px;border-radius:999px;font-size:13px;cursor:pointer;";
      row.appendChild(save);
      row.appendChild(close);
      ov.appendChild(img);
      ov.appendChild(row);
      host.appendChild(ov);
      close.onclick = function () { ov.style.display = "none"; };
    }
    var img = document.getElementById("__local-photo-img");
    img.src = url;
    var save = ov.querySelector("a");
    save.href = url;
    save.download = "tryon-result.png";
    ov.style.display = "flex";
  }

  // Inject photo button into widget
  function injectPhotoButton() {
    function tryInsert() {
      if (document.getElementById("__local-photo-btn")) return true;
      var root = document.getElementById("root") || document.body;
      if (!root) return false;
      var btn = document.createElement("button");
      btn.id = "__local-photo-btn";
      btn.type = "button";
      btn.textContent = "📸 Photo HD";
      btn.title = "High-quality photo try-on (local GPU / AI)";
      btn.style.cssText =
        "position:absolute;bottom:14px;right:14px;z-index:25;background:#111;color:#fff;border:1px solid rgba(255,255,255,0.25);padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(0,0,0,0.3);";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        runPhotoTryon();
      });
      root.appendChild(btn);
      return true;
    }
    if (!tryInsert()) {
      var n = 0;
      var iv = setInterval(function () {
        if (tryInsert() || ++n > 40) clearInterval(iv);
      }, 250);
    }
  }

  // Inject sample garments bar for instant testing
  function injectSampleGarments() {
    function tryInsert() {
      if (document.getElementById("__local-samples-bar")) return true;
      var idle = document.getElementById("idle-placeholder");
      if (!idle) return false;

      var bar = document.createElement("div");
      bar.id = "__local-samples-bar";
      bar.style.cssText =
        "margin-top:20px;display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;max-width:300px;";

      var lbl = document.createElement("div");
      lbl.textContent = "OR CHOOSE A GARMENT";
      lbl.style.cssText = "font-size:10px;font-weight:600;letter-spacing:0.18em;color:rgba(0,0,0,0.45);";

      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;justify-content:center;width:100%;";

      var shirts = [
        { name: "Navy Tee", file: "shirt1.png" },
        { name: "Sand Tee", file: "shirt2.png" },
        { name: "Coral Tee", file: "shirt3.png" }
      ];

      shirts.forEach(function (s) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.title = "Try on " + s.name;
        btn.style.cssText =
          "display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;background:#fff;border:1.5px solid rgba(0,0,0,0.12);border-radius:10px;cursor:pointer;width:80px;transition:all 0.15s;";

        var img = document.createElement("img");
        img.src = getAssetUrl(s.file);
        img.alt = s.name;
        img.style.cssText = "width:42px;height:42px;object-fit:contain;";

        var title = document.createElement("span");
        title.textContent = s.name;
        title.style.cssText = "font-size:10px;font-weight:500;color:#333;white-space:nowrap;";

        btn.appendChild(img);
        btn.appendChild(title);

        btn.addEventListener("mouseenter", function () {
          btn.style.borderColor = "#000";
          btn.style.transform = "translateY(-2px)";
        });
        btn.addEventListener("mouseleave", function () {
          btn.style.borderColor = "rgba(0,0,0,0.12)";
          btn.style.transform = "none";
        });
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          startSession(getAssetUrl(s.file));
        });

        row.appendChild(btn);
      });

      bar.appendChild(lbl);
      bar.appendChild(row);

      var legal = document.getElementById("idle-legal");
      if (legal) {
        idle.insertBefore(bar, legal);
      } else {
        idle.appendChild(bar);
      }
      return true;
    }

    if (!tryInsert()) {
      var n = 0;
      var iv = setInterval(function () {
        if (tryInsert() || ++n > 30) clearInterval(iv);
      }, 200);
    }
  }

  // ---------------------------------------------------------------------------
  // Message bridge (page → widget iframe)
  // ---------------------------------------------------------------------------
  window.addEventListener("message", function (e) {
    var t = e.data;
    if (!t || typeof t !== "object") return;
    switch (t.type) {
      case "DECART_AUTO_START":
        if (t.productImageUrl) {
          startSession(t.productImageUrl);
        }
        break;
      case "DECART_IMAGE_BTN_CLICK":
        if (t.url) startSession(t.url);
        break;
      case "DECART_DROP_IMAGE":
        if (t.url) startSession(t.url);
        break;
      case "DECART_STOP_SESSION":
        stopSession("parent", { final: true });
        break;
      default:
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    hideQueueForever();
    injectPhotoButton();
    injectSampleGarments();

    // Hook Enable Camera button
    var camBtn = document.getElementById("camera-btn");
    if (camBtn) {
      camBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        startCamera().catch(function (err) {
          window.decartLog("Camera permission error:", err);
        });
      });
    }

    // Drag-and-drop into widget iframe
    var root = document.getElementById("root") || document.body;
    root.addEventListener("dragover", function (e) {
      e.preventDefault();
      var ma = document.getElementById("main-area");
      if (ma) ma.classList.add("ma-dragover");
    });
    root.addEventListener("dragleave", function (e) {
      var ma = document.getElementById("main-area");
      if (ma) ma.classList.remove("ma-dragover");
    });
    root.addEventListener("drop", function (e) {
      e.preventDefault();
      var ma = document.getElementById("main-area");
      if (ma) ma.classList.remove("ma-dragover");
      var dt = e.dataTransfer;
      if (!dt) return;
      var url = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
      if (!url) {
        var html = dt.getData("text/html") || "";
        var m = /<img[^>]+src=["']([^"']+)/i.exec(html);
        if (m) url = m[1];
      }
      if (!url && dt.files && dt.files.length) {
        var file = dt.files[0];
        if (file.type && file.type.startsWith("image/")) {
          var reader = new FileReader();
          reader.onload = function (evt) {
            if (evt.target && evt.target.result) {
              startSession(evt.target.result);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }
      if (url) {
        startSession(url);
      }
    });

    // Suppress queue UI forever
    var mo = new MutationObserver(function () {
      var ov = document.getElementById("connecting-overlay");
      if (ov && ov.classList.contains("queue-active")) {
        ov.classList.remove("queue-active");
        hideQueueForever();
      }
    });
    if (document.getElementById("connecting-overlay")) {
      mo.observe(document.getElementById("connecting-overlay"), { attributes: true, attributeFilter: ["class"] });
    }

    // Auto-start from query param or session storage
    try {
      var params = new URLSearchParams(location.search);
      var garmentParam = params.get("garment") || params.get("productImage");
      var pending = garmentParam || sessionStorage.getItem("decart_auto_start_url");
      if (pending && (params.get("autostart") === "1" || garmentParam)) {
        setTimeout(function () { startSession(pending); }, 400);
      }
    } catch (e) {}

    setConnState("connected");
    window.decartLog("local-engine ready →", SERVER);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // expose for debugging / photo from console
  window.__anywearLocal = {
    start: startSession,
    stop: stopSession,
    photo: runPhotoTryon,
    server: SERVER,
    state: state,
  };
})();
