// Sentence/length chunker for read-aloud. panelRuntime.js resolves an assistant message to plain
// speech text and hands it here to be split into speakable chunks (one browser utterance or one
// OpenRouter /audio/speech request each).
//
// Two load-bearing details:
//
//   - A period, question mark or exclamation ends a sentence only when it is followed by whitespace
//     or the end of the text. A period glued to a non-whitespace character stays inside the
//     sentence, so version numbers (1.4.0), decimals (3.50), file names (app.js) and domains
//     (example.com) are never treated as sentence ends.
//   - Splitting happens only to stay under the length cap. Sentences are packed greedily into a
//     chunk until the next one would overflow the cap; a chunk is then flushed and a new one
//     started at that sentence boundary. Any text at or under the cap becomes a single chunk.
//
// Both rules exist for the same reason. The playback loop fetches and plays one chunk at a time with
// no prefetch, so every extra chunk inserts a silent gap (a network round-trip on OpenRouter, an
// utterance gap on the browser voice) plus, on OpenRouter, an extra clip and cost lookup. Breaking
// on every boundary tore "It's version 1.4.0. Ship it." into separate clips with a fetch gap
// between them for no reason, and tore "1.4.0" itself into three. Sentence boundaries are where a
// break goes when one is needed, not a reason to break.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the content script
// and exports through the CommonJS tail under Node (`module` is undefined in the browser, so that
// branch is inert there).

(function () {
  const globalScopeForSpeechChunk = globalThis;
  const nsForSpeechChunk = globalScopeForSpeechChunk.ABChatContent || {};

  const DEFAULT_MAX_LEN_FOR_SPEECH_CHUNK = 200;

  // Split prose into chunks no longer than maxLen, packing whole sentences greedily and breaking on
  // spaces only for a single sentence that is itself longer than the cap.
  //
  // firstChunkMaxLen (optional) caps only the first chunk to a smaller size, so playback can start on
  // a short first clip while the rest are still being fetched. It applies only when it is smaller
  // than maxLen and the text would otherwise be more than one chunk; a message that already fits in
  // one chunk is never peeled, since that would reintroduce the between-clip gap packing removed. The
  // first chunk still breaks at a sentence boundary and is never cut below a whole sentence, so
  // firstChunkMaxLen is a target, not a hard cut, for the first sentence.
  function chunkSpeechTextForSpeechChunk(textForChunking, maxLenForChunking, firstChunkMaxLenForChunking) {
    const capForChunking = maxLenForChunking || DEFAULT_MAX_LEN_FOR_SPEECH_CHUNK;

    // 1. Break into sentences (the allowed break points). A sentence is any run ending at terminal
    //    punctuation that is followed by whitespace or the end of the segment; the trailing run with
    //    no such punctuation falls to the final `.+$`.
    const sentencesForChunking = [];
    String(textForChunking || '').split(/\n+/).forEach(function (segmentForChunking) {
      const trimmedSegmentForChunking = segmentForChunking.trim();
      if (!trimmedSegmentForChunking) return;
      const matchedForChunking =
        trimmedSegmentForChunking.match(/.*?[.!?]+(?=\s|$)|.+$/g) || [trimmedSegmentForChunking];
      matchedForChunking.forEach(function (sentenceForChunking) {
        const trimmedSentenceForChunking = sentenceForChunking.trim();
        if (trimmedSentenceForChunking) sentencesForChunking.push(trimmedSentenceForChunking);
      });
    });

    // A smaller first-chunk cap is used only when it is genuinely smaller and the whole text does not
    // already fit in a single chunk (join length is what one chunk would hold).
    const totalLenForChunking = sentencesForChunking.join(' ').length;
    const useSmallFirstForChunking =
      firstChunkMaxLenForChunking > 0
      && firstChunkMaxLenForChunking < capForChunking
      && totalLenForChunking > capForChunking;

    // 2. Pack sentences greedily up to the active cap (the smaller one while the first chunk is still
    //    open, the full cap thereafter).
    const chunksForChunking = [];
    let currentChunkForChunking = '';

    function activeCapForChunking() {
      return (useSmallFirstForChunking && chunksForChunking.length === 0)
        ? firstChunkMaxLenForChunking
        : capForChunking;
    }

    function appendPieceForChunking(pieceForChunking) {
      const candidateForChunking = currentChunkForChunking
        ? currentChunkForChunking + ' ' + pieceForChunking
        : pieceForChunking;
      if (candidateForChunking.length > activeCapForChunking() && currentChunkForChunking) {
        chunksForChunking.push(currentChunkForChunking);
        currentChunkForChunking = pieceForChunking;
      } else {
        currentChunkForChunking = candidateForChunking;
      }
    }

    sentencesForChunking.forEach(function (sentenceForChunking) {
      if (sentenceForChunking.length <= capForChunking) {
        appendPieceForChunking(sentenceForChunking);
        return;
      }
      // A single sentence longer than the cap: pack its words the same way. The leading words merge
      // onto whatever is already in the current chunk, and the trailing partial stays in the current
      // chunk so a following short sentence can pack onto it rather than opening a needless chunk.
      sentenceForChunking.split(/\s+/).forEach(function (wordForChunking) {
        appendPieceForChunking(wordForChunking);
      });
    });

    if (currentChunkForChunking) chunksForChunking.push(currentChunkForChunking);
    return chunksForChunking;
  }

  nsForSpeechChunk.speechChunk = {
    chunk: chunkSpeechTextForSpeechChunk
  };
  globalScopeForSpeechChunk.ABChatContent = nsForSpeechChunk;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForSpeechChunk.speechChunk;
  }
})();
