/**
 * crash_reports.js — local build: no telemetry, no PostHog, no billing arming.
 * trackEvent() is a no-op so widget-init/content keep calling it safely.
 */
window.trackEvent = function () {};
window._dispatchBillingUi = function () {};
window.__decart_billing_ui = null;
window.addEventListener("error", function () {});
window.addEventListener("unhandledrejection", function () {});
