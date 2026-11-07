/*
 * TestnetCasino.com: copy buttons.
 *
 *   <code id="house-address">bchtest:...</code>
 *   <button type="button" data-copy="#house-address">Copy</button>
 *   <span data-copy-state="#house-address" role="status" aria-live="polite"></span>
 *
 * Uses the Clipboard API, falls back to execCommand("copy"), and as a last
 * resort selects the text so the user can copy it by hand.
 */
(function () {
  "use strict";

  function selectText(el) {
    var range = document.createRange(); range.selectNodeContents(el);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-copy]");
    if (!btn) return;
    var sel = btn.getAttribute("data-copy"), src = document.querySelector(sel);
    if (!src) return;
    var text = src.textContent.trim();
    var state = document.querySelector('[data-copy-state="' + sel + '"]');
    var label = btn.getAttribute("data-label") || btn.innerHTML;
    btn.setAttribute("data-label", label);

    function done(ok) {
      if (!ok) selectText(src);
      btn.innerHTML = ok ? "✓ Copied" : "Press Ctrl+C";
      if (state) state.textContent = ok ? "Address copied." : "Address selected. Copy it with Ctrl+C or Cmd+C.";
      clearTimeout(btn._t);
      btn._t = setTimeout(function () { btn.innerHTML = label; if (state) state.textContent = ""; }, 2200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    } else {
      done(legacyCopy(text));
    }
  });
})();
