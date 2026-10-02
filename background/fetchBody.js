(function () {
  var globalScopeForFetchBody = globalThis;
  var nsForFetchBody = globalScopeForFetchBody.ABChatBackground || {};

  // Reads a fetch response body with a ceiling on size and on time, for web_fetch and for an image
  // dragged into the composer. Response.text() and arrayBuffer() hold the whole download before
  // anything can check its size, so a 46 MB page sat in the service worker, went whole into the
  // fetch cache, and went out in one runtime message, which Chrome refuses past 64 MiB. They also
  // wait for the last byte however slowly it comes, and the agent loop stops the whole run when one
  // round of tools passes 90 seconds. Reading the stream lets the caller stop at either limit and
  // cancel the rest of the download. No chrome.* use, so the CommonJS tail can export it to Node
  // tests.

  // Resolves to { bytes, truncated, timedOut }. bytes is a new array whose buffer holds exactly the
  // bytes read, so a caller can hand bytes.buffer on. truncated is true when the body had more than
  // was read, either past maxBytes or still arriving when timeoutMs ran out; timedOut says it was
  // the time. A body of exactly maxBytes is complete. Aborting the fetch rejects the read.
  async function readBodyWithCapForFetchBody(responseForCap, maxBytesForCap, optionsForCap) {
    var bodyForCap = responseForCap ? responseForCap.body : null;
    if (!bodyForCap) return { bytes: new Uint8Array(0), truncated: false, timedOut: false };
    var readerForCap = bodyForCap.getReader();
    var chunksForCap = [];
    var totalForCap = 0;
    var truncatedForCap = false;
    var timedOutForCap = false;
    var timeoutMsForCap = optionsForCap && optionsForCap.timeoutMs > 0 ? optionsForCap.timeoutMs : 0;
    // Cancelling the reader settles a read that is still waiting as done, which ends the loop.
    var timerForCap = timeoutMsForCap ? setTimeout(function () {
      timedOutForCap = true;
      readerForCap.cancel().catch(function () {});
    }, timeoutMsForCap) : null;
    try {
      while (true) {
        var stepForCap = await readerForCap.read();
        if (stepForCap.done) break;
        var chunkForCap = stepForCap.value;
        if (totalForCap + chunkForCap.length > maxBytesForCap) {
          chunksForCap.push(chunkForCap.subarray(0, maxBytesForCap - totalForCap));
          totalForCap = maxBytesForCap;
          truncatedForCap = true;
          readerForCap.cancel().catch(function () {});
          break;
        }
        chunksForCap.push(chunkForCap);
        totalForCap += chunkForCap.length;
      }
    } finally {
      if (timerForCap) clearTimeout(timerForCap);
    }
    // A chunk that was already on its way when time ran out can still push the body past the cap,
    // and then the size is the reason given.
    if (truncatedForCap) timedOutForCap = false;
    else if (timedOutForCap) truncatedForCap = true;
    var bytesForCap = new Uint8Array(totalForCap);
    var offsetForCap = 0;
    for (var iForCap = 0; iForCap < chunksForCap.length; iForCap++) {
      bytesForCap.set(chunksForCap[iForCap], offsetForCap);
      offsetForCap += chunksForCap[iForCap].length;
    }
    return { bytes: bytesForCap, truncated: truncatedForCap, timedOut: timedOutForCap };
  }

  // Decodes as UTF-8, as Response.text() does. A body cut short can end partway through a
  // character; decoding in stream mode and never flushing drops that partial character rather
  // than turning it into U+FFFD.
  function decodeUtf8ForFetchBody(bytesForDecode, truncatedForDecode) {
    var decoderForDecode = new TextDecoder('utf-8');
    return truncatedForDecode
      ? decoderForDecode.decode(bytesForDecode, { stream: true })
      : decoderForDecode.decode(bytesForDecode);
  }

  nsForFetchBody.fetchBody = {
    readBodyWithCap: readBodyWithCapForFetchBody,
    decodeUtf8: decodeUtf8ForFetchBody
  };

  globalScopeForFetchBody.ABChatBackground = nsForFetchBody;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForFetchBody.fetchBody;
  }
})();
