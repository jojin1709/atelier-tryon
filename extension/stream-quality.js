/**
 * stream-quality.js — local build.
 * Request 640×480 camera (anti-lag). No 1088×624 Decart landscape swap.
 */
!function () {
  "use strict";
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      var c = constraints && typeof constraints === "object" ? Object.assign({}, constraints) : { audio: false };
      if (c.video) {
        if (typeof c.video === "object" && c.video !== null) {
          c.video = Object.assign({}, c.video, {
            width: { ideal: 640 },
            height: { ideal: 480 },
          });
          if (!c.video.facingMode) c.video.facingMode = "user";
        } else {
          c.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" };
        }
      } else {
        c.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" };
      }
      c.audio = false;
      return orig(c);
    };
  }
  // expose no-op helpers some code paths expect
  window.__decartSQ = window.__decartSQ || {
    stopRemoteOnly: function () {},
    getLocalStream: function () { return null; },
    stopAll: function () {},
  };
}();
