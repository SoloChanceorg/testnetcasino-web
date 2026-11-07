/*
 * TestnetCasino.com: site configuration.
 *
 * apiBase  Spring Boot backend (session cookie, HttpOnly).
 * mock     true: assets/js/api.js answers every call locally (no network).
 *          Set to false when the backend is live.
 *
 * For testing, ?mock=1 or ?mock=0 in any page URL overrides `mock`. The
 * override is kept in sessionStorage so it follows you across pages in this
 * tab; ?mock=default clears it.
 */
(function () {
  "use strict";

  var config = {
    apiBase: "https://api.testnetcasino.com",
    mock: true
  };

  var KEY = "tnc.mock.override";
  try {
    var q = new URLSearchParams(location.search).get("mock");
    if (q === "1" || q === "0") sessionStorage.setItem(KEY, q);
    else if (q === "default") sessionStorage.removeItem(KEY);
    var o = sessionStorage.getItem(KEY);
    if (o === "1") config.mock = true;
    else if (o === "0") config.mock = false;
  } catch (e) { /* storage blocked: keep the default */ }

  window.TNC_CONFIG = config;
})();
