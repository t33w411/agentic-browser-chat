// Regression tests for the read-aloud chunker (panel/panelSpeechChunk.js).
//
// Two behaviours are guarded here, both about not producing needless chunks (each extra chunk is a
// separate utterance / TTS request with a silent gap before it, since the playback loop has no
// prefetch):
//
//   1. A period is a sentence end only when followed by whitespace or end of text, so "1.4.0",
//      "app.js" and "3.50" are never split on their internal periods. The old regex
//      `/[^.!?\n]+[.!?]*|\n+/g` returned 3 chunks for the "1.4.0" case; verified against it.
//   2. Sentences are packed greedily up to the cap, so text at or under the cap is one chunk. The
//      earlier per-sentence version returned 2 chunks for "It's version 1.4.0. Ship it." and 3 for
//      "Ready? Set. Go!"; verified these packing cases fail against that version before keeping them.

const test = require('node:test');
const assert = require('node:assert');

const speechChunkForTest = require('../panel/panelSpeechChunk.js');
const chunkForTest = speechChunkForTest.chunk;

test('version number is not split on its internal periods', function () {
  const inputForTest =
    'Update to version 1.4.0, refactor chat and search tools, and improve attachment previews';
  assert.deepStrictEqual(chunkForTest(inputForTest, 200), [inputForTest]);
});

test('file names and domains stay in one chunk', function () {
  assert.deepStrictEqual(
    chunkForTest('See app.js and index.html for details.', 200),
    ['See app.js and index.html for details.']
  );
  assert.deepStrictEqual(
    chunkForTest('Go to example.com now.', 200),
    ['Go to example.com now.']
  );
});

test('decimals stay in one chunk', function () {
  assert.deepStrictEqual(chunkForTest('Price is 3.50 today', 200), ['Price is 3.50 today']);
});

test('short multi-sentence text packs into a single chunk', function () {
  assert.deepStrictEqual(
    chunkForTest("It's version 1.4.0. Ship it.", 200),
    ["It's version 1.4.0. Ship it."]
  );
  assert.deepStrictEqual(chunkForTest('Ready? Set. Go!', 200), ['Ready? Set. Go!']);
  assert.deepStrictEqual(chunkForTest('First. Second. Third', 200), ['First. Second. Third']);
});

test('packing breaks at sentence boundaries when the cap is exceeded', function () {
  // Each sentence fits the cap but no two fit together, so each becomes its own chunk, split at the
  // boundary rather than mid-word.
  assert.deepStrictEqual(
    chunkForTest('Alpha one. Beta two. Gamma three.', 12),
    ['Alpha one.', 'Beta two.', 'Gamma three.']
  );
});

test('question and exclamation marks act as break points under a tight cap', function () {
  assert.deepStrictEqual(chunkForTest('Yes? No! Ok.', 4), ['Yes?', 'No!', 'Ok.']);
});

test('sentences pack up to the cap without exceeding it', function () {
  const fiveSentencesForTest = 'aaaaaaaa bb. cccccccc dd. eeeeeeee ff. gggggggg hh. iiiiiiii jj.';
  const resultForTest = chunkForTest(fiveSentencesForTest, 30);
  assert.ok(resultForTest.length > 1, 'expected more than one chunk');
  resultForTest.forEach(function (chunkPieceForTest) {
    assert.ok(chunkPieceForTest.length <= 30, 'chunk exceeded cap: ' + chunkPieceForTest.length);
  });
  // Every chunk boundary lands on a sentence end, so no chunk starts mid-sentence.
  resultForTest.slice(0, -1).forEach(function (chunkPieceForTest) {
    assert.ok(/[.!?]$/.test(chunkPieceForTest), 'chunk did not end at a boundary: ' + chunkPieceForTest);
  });
  // Rejoining reproduces the original text.
  assert.strictEqual(resultForTest.join(' '), fiveSentencesForTest);
});

test('a sentence longer than the cap is word-split without exceeding it', function () {
  const longSentenceForTest = 'word '.repeat(120).trim() + '.';
  const resultForTest = chunkForTest(longSentenceForTest, 50);
  assert.ok(resultForTest.length > 1, 'expected multiple chunks');
  resultForTest.forEach(function (chunkPieceForTest) {
    assert.ok(chunkPieceForTest.length <= 50, 'chunk exceeded cap: ' + chunkPieceForTest.length);
  });
});

test('empty and whitespace-only input yield no chunks', function () {
  assert.deepStrictEqual(chunkForTest('', 200), []);
  assert.deepStrictEqual(chunkForTest('   \n  ', 200), []);
  assert.deepStrictEqual(chunkForTest(null, 200), []);
});

test('default cap applies when none is passed', function () {
  assert.deepStrictEqual(chunkForTest('Short sentence.'), ['Short sentence.']);
});

// A smaller first-chunk cap lets playback start on a short clip while the rest are still fetching.

test('a short message is not peeled even when a first-chunk cap is given', function () {
  // The whole text fits in one chunk, so peeling would reintroduce the between-clip gap.
  assert.deepStrictEqual(chunkForTest('One. Two.', 40, 6), ['One. Two.']);
});

test('a long message peels a small first chunk and packs the rest to the main cap', function () {
  const longText = 'One. Two. Three four five six seven eight nine.';
  // Without a first-chunk cap the first two sentences pack together.
  assert.deepStrictEqual(chunkForTest(longText, 40), [
    'One. Two.',
    'Three four five six seven eight nine.'
  ]);
  // With one, the first chunk is peeled to roughly the first sentence; later chunks use the main cap.
  assert.deepStrictEqual(chunkForTest(longText, 40, 6), [
    'One.',
    'Two.',
    'Three four five six seven eight nine.'
  ]);
});

test('a first-chunk cap at or above the main cap is ignored', function () {
  const longText = 'One. Two. Three four five six seven eight nine.';
  assert.deepStrictEqual(chunkForTest(longText, 40, 100), chunkForTest(longText, 40));
});
