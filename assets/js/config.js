/*
 * TestnetCasino.com: site configuration.
 *
 * apiBase     testnetcasino-service. Every game, balance and account action
 *             runs there; the frontend only shows the results.
 * explorerTx  Testnet4 transaction page (always bchexplorer.cash) + txid.
 */
(function () {
  "use strict";

  window.TNC_CONFIG = {
    apiBase: "https://api.testnetcasino.com",
    explorerTx: "https://bchexplorer.cash/testnet4/tx/"
  };
})();
