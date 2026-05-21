(function () {
  // Generate a fresh page salt on every injection (first load and re-injection).
  // Used by the access token path in page_query to sign traverse-returned selectors
  // so uncategorized elements can be targeted for get_inner_text / get_outer_html
  // without an allowlist. Salt is per-tab and per-page-load by virtue of being
  // regenerated here on every content script injection.
  // Never transmitted to the agent — only used server-side for token verification.
  var saltBytesForPreInit = new Uint8Array(16);
  crypto.getRandomValues(saltBytesForPreInit);
  window.abchatPageSalt = Array.from(saltBytesForPreInit).map(function (b) {
    return ('00' + b.toString(16)).slice(-2);
  }).join('');

  // Generation increment for re-injection after extension reload/update.
  //
  // This file MUST be the first script in the injection list (both in the manifest
  // content_scripts and in tabMessaging.js injectableJsFilesForTabMessaging).
  //
  // WHY IT MUST BE FIRST:
  //   Every tool file captures window.abchatListenerGeneration at IIFE load time as its
  //   own "capturedGeneration". All DOM and Chrome API listeners then compare the live
  //   window.abchatListenerGeneration against that snapshot at call time; a mismatch means
  //   the listener is from a stale injection and it self-deregisters.
  //
  //   content/main.js is the LAST file in the injection list (it depends on all tools
  //   being registered first). If main.js incremented the generation, it would do so
  //   AFTER every tool file had already captured the old value. New handlers would then
  //   immediately fail their own stale check on first fire — exactly as if they were
  //   from the previous injection — and self-deregister. The net effect is that all
  //   interactive features (content selector, selection actions, etc.) stop working
  //   after a reload until the page is manually refreshed.
  //
  //   By running this file first, all tool IIFEs load AFTER the increment and therefore
  //   capture the correct (new) generation. Their handlers remain valid.
  //
  // Lessons learned:
  // - chrome.runtime.id is stable and cannot be used as an injection cycle marker.
  // - Recovery markers must survive across reload boundaries (window + DOM marker).
  // - Generation increments must happen before tool files execute.
  //
  // Only increments on genuine re-injection: a prior injection marker must exist.
  // Migration-safe markers are:
  //   - abchatMainInitNonce (current marker)
  //   - abchatMainInitRuntimeId (legacy marker from prior builds)
  //   - data-abchat-content-main-initialized="1" on <html> (DOM marker)
  //   - ABChatContent.state presence (defensive fallback for older in-page state)
  // chrome.runtime.id is NOT used as the marker itself — it is a stable extension
  // identifier that never changes between reloads, so it cannot distinguish injections.
  var hasDomInjectionMarkerForPreInit =
    Boolean(
      document &&
      document.documentElement &&
      document.documentElement.getAttribute &&
      document.documentElement.getAttribute("data-abchat-content-main-initialized") === "1"
    );
  var hadPreviousInjectionForPreInit =
    hasDomInjectionMarkerForPreInit ||
    Boolean(window.abchatMainInitNonce) ||
    Boolean(window.abchatMainInitRuntimeId) ||
    Boolean(globalThis.ABChatContent && globalThis.ABChatContent.state);

  if (!hadPreviousInjectionForPreInit) {
    return;
  }

  // Verify we still have a valid extension context before proceeding.
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      return;
    }
  } catch (errForPreInit) {
    return;
  }

  window.abchatListenerGeneration = (window.abchatListenerGeneration || 0) + 1;
})();
