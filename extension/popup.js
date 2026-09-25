"use strict";

document.addEventListener("DOMContentLoaded", function () {
  var keyInput = document.getElementById("api-key-input");
  var saveBtn = document.getElementById("save-key-btn");
  var statusMsg = document.getElementById("status-msg");
  var openWidgetBtn = document.getElementById("open-widget");

  // Load existing key from storage
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["decartApiKey"], function (res) {
      if (res && res.decartApiKey) {
        keyInput.value = res.decartApiKey;
        statusMsg.style.display = "block";
        statusMsg.textContent = "✓ Decart Key Active (" + res.decartApiKey.slice(0, 7) + "...)";
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      var val = (keyInput.value || "").trim();
      if (!val) {
        alert("Please enter a Decart API Key (dct_...)");
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Verifying…";

      fetch("https://api.decart.ai/v1/client/tokens", {
        method: "POST",
        headers: { "x-api-key": val, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 300, allowedModels: ["lucy-vton-3.5"] }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function () {
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ decartApiKey: val }, function () {
              statusMsg.style.display = "block";
              statusMsg.textContent = "✓ Decart Lucy VTON 3.5 Connected!";
              statusMsg.style.color = "#10b981";
              saveBtn.disabled = false;
              saveBtn.textContent = "Save & Verify Key";
            });
          }
        })
        .catch(function (err) {
          statusMsg.style.display = "block";
          statusMsg.textContent = "⚠ Key verification failed: check key or network";
          statusMsg.style.color = "#ef4444";
          saveBtn.disabled = false;
          saveBtn.textContent = "Save & Verify Key";
        });
    });
  }

  if (openWidgetBtn) {
    openWidgetBtn.addEventListener("click", function () {
      chrome.runtime.sendMessage({ type: "DECART_POPUP_OPEN_TAB" });
      window.close();
    });
  }
});