/**
 * billing.js — local stub. No metering, no paywall, unlimited free try-ons.
 */
window.__decartBilling = {
  _iface: null,
  init: function (iface) {
    this._iface = iface || null;
    try { window.decartLog && window.decartLog("Billing", "local stub — unlimited free"); } catch (e) {}
    return this;
  },
  heartbeatStart: function () {},
  heartbeatStop: function () {},
  refreshStatus: function () {
    return Promise.resolve({ billing_enabled: false, tryon_sessions: 999999, free_pass_available: true });
  },
  applyDirective: function () { return false; },
  openPanel: function () { return false; },
  closePanel: function () {},
  checkpoint: function () {},
  checkpointReached: function () {},
  arm: function () { return {}; },
  dispose: function () {},
  getStatus: function () {
    return { billing_enabled: false, tryon_sessions: 999999, free_pass_available: true };
  },
  isActive: function () { return false; },
  tryonsLeft: function () { return 999999; },
};
window.__decartBillingHeartbeat = function () {};
window.__decartBillingDirective = null;
window.__decartBillingRegimeInForce = false;
window.__decartBillingSurfaceUp = false;
window.__decartOpenBillingPanel = function () { return false; };
window.__decartCloseBillingPanel = function () {};
window.__decartRefreshBillingStatus = function () { return Promise.resolve(null); };
window.__decartRestoreLiveWidget = function () {};
