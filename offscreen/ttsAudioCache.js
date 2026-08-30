// Shared read-aloud audio cache, hosted in the offscreen document.
//
// The panel fetches OpenRouter TTS audio per chunk and pays per generation. Object URLs are scoped to
// the document that mints them, so audio fetched in one tab cannot be replayed in another. This module
// is the one context every tab reaches: it holds the audio BYTES (base64, so the bytes survive
// runtime messaging regardless of how it serializes), keyed per message. Any tab can look a message up
// and, on a hit, mint its own local URL from the returned bytes without a new billed request.
//
// It lives in the offscreen document rather than the service worker because the worker is killed after
// ~30s idle and would lose the cache almost immediately; the offscreen document outlives page reloads
// and is shared across every tab. It is still in-memory and best-effort: if Chrome reclaims an idle
// offscreen document the cache goes with it, and the next read re-fetches.
//
// Cache unit is one message (key `${msgId}::${model}::${voice}`), bounded to the most recently used
// TTS_MAX_MESSAGES_FOR_TTS_CACHE messages (LRU). Each entry is a sparse array of chunk records indexed
// by chunk position, plus the message's total chunk count; a PUT whose total differs from the stored
// entry resets the array, so a message whose chunking changed never serves stale chunk bytes.
//
// The service worker relays between the panel and here: panel `ttsCacheGet`/`ttsCachePut` -> SW ->
// offscreen `ttsOffscreenGet`/`ttsOffscreenPut` (the SW creates this document first if a PUT needs it).

(function () {
  var TTS_MAX_MESSAGES_FOR_TTS_CACHE = 10;

  // key -> { chunks: [{ b64, mime } | null], total }
  var cacheMapForTtsCache = new Map();
  // Keys in least-recently-used order (most recent last).
  var cacheOrderForTtsCache = [];

  function touchKeyForTtsCache(keyForTouch) {
    var idxForTouch = cacheOrderForTtsCache.indexOf(keyForTouch);
    if (idxForTouch >= 0) cacheOrderForTtsCache.splice(idxForTouch, 1);
    cacheOrderForTtsCache.push(keyForTouch);
    while (cacheOrderForTtsCache.length > TTS_MAX_MESSAGES_FOR_TTS_CACHE) {
      var evictedKeyForTtsCache = cacheOrderForTtsCache.shift();
      cacheMapForTtsCache.delete(evictedKeyForTtsCache);
    }
  }

  chrome.runtime.onMessage.addListener(function (msgForTtsCache, senderForTtsCache, sendResponseForTtsCache) {
    if (!msgForTtsCache) return;

    if (msgForTtsCache.action === 'ttsOffscreenGet') {
      var entryForGet = cacheMapForTtsCache.get(msgForTtsCache.key) || null;
      if (entryForGet) touchKeyForTtsCache(msgForTtsCache.key);
      // Return a shallow copy so the stored entry is not exposed to mutation by the messaging layer.
      sendResponseForTtsCache(
        entryForGet ? { chunks: entryForGet.chunks.slice(), total: entryForGet.total } : null
      );
      return;
    }

    if (msgForTtsCache.action === 'ttsOffscreenPut') {
      var totalForPut = (typeof msgForTtsCache.total === 'number' && msgForTtsCache.total > 0)
        ? msgForTtsCache.total
        : 0;
      if (!totalForPut || !msgForTtsCache.b64) {
        sendResponseForTtsCache({ ok: false });
        return;
      }
      var entryForPut = cacheMapForTtsCache.get(msgForTtsCache.key);
      // A changed total means the message re-chunked (e.g. read while still streaming); drop the old
      // bytes rather than mixing them with the new run.
      if (!entryForPut || entryForPut.total !== totalForPut) {
        entryForPut = { chunks: new Array(totalForPut).fill(null), total: totalForPut };
        cacheMapForTtsCache.set(msgForTtsCache.key, entryForPut);
      }
      var indexForPut = msgForTtsCache.index;
      if (typeof indexForPut === 'number' && indexForPut >= 0 && indexForPut < entryForPut.total) {
        entryForPut.chunks[indexForPut] = { b64: msgForTtsCache.b64, mime: msgForTtsCache.mime || 'audio/mpeg' };
      }
      touchKeyForTtsCache(msgForTtsCache.key);
      sendResponseForTtsCache({ ok: true });
      return;
    }
  });
})();
