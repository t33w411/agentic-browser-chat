// Capped body reads for web_fetch (background/fetchBody.js).
//
// Verified against two reconstructions of the old behaviour. Reading the whole body with
// arrayBuffer() and flushing the decoder fails seven of the eleven cases, the two slow-body ones on
// their timeouts; only the under-cap, exact-cap, no-body and complete-decode cases pass. A reader
// with the size cap but no timer fails only the stalled-body case, on its 2-second timeout. The
// finishes-in-time and size-reason cases guard the other side, a complete or oversized body wrongly
// blamed on the timer. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const fetchBodyForTest = require('../background/fetchBody.js');

// A response whose body hands out the given chunks one pull at a time, and records how many
// pulls it served and whether the reader cancelled it.
function chunkedResponseForTest(chunks, stats) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      stats.pulls++;
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() { stats.cancelled = true; }
  }));
}

function bytesForTest(length, fill) {
  return new Uint8Array(length).fill(fill || 97);
}

test('a body under the cap is read whole and not marked truncated', async function () {
  const stats = { pulls: 0, cancelled: false };
  const result = await fetchBodyForTest.readBodyWithCap(chunkedResponseForTest([bytesForTest(300), bytesForTest(200)], stats), 1000);
  assert.strictEqual(result.bytes.length, 500);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(stats.cancelled, false);
});

test('a body of exactly the cap is complete', async function () {
  const stats = { pulls: 0, cancelled: false };
  const result = await fetchBodyForTest.readBodyWithCap(chunkedResponseForTest([bytesForTest(600), bytesForTest(400)], stats), 1000);
  assert.strictEqual(result.bytes.length, 1000);
  assert.strictEqual(result.truncated, false);
});

test('a body over the cap stops at the cap and cancels the rest of the download', async function () {
  const stats = { pulls: 0, cancelled: false };
  const chunks = Array.from({ length: 100 }, (_, i) => bytesForTest(100, 65 + (i % 26)));
  const result = await fetchBodyForTest.readBodyWithCap(chunkedResponseForTest(chunks, stats), 1050);
  assert.strictEqual(result.bytes.length, 1050);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.bytes[1049], 65 + 10, 'the last byte kept comes from the eleventh chunk');
  assert.strictEqual(stats.cancelled, true);
  assert.ok(stats.pulls < 20, 'read ' + stats.pulls + ' of 100 chunks');
});

// The body arrives in 16 KB pieces a millisecond apart, so all 64 MB would take several seconds
// while the first 1 MB takes well under one. Finite, so a reader that waits for the end fails on
// the timeout and still lets the process exit.
test('a body far larger than the cap returns without waiting for the rest', { timeout: 2000 }, async function () {
  let served = 0;
  let cancelled = false;
  const slow = new Response(new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => setTimeout(resolve, 1)).then(() => {
        if (served >= 64 * 1024 * 1024) { controller.close(); return; }
        served += 16 * 1024;
        controller.enqueue(bytesForTest(16 * 1024));
      });
    },
    cancel() { cancelled = true; }
  }));
  const result = await fetchBodyForTest.readBodyWithCap(slow, 1024 * 1024);
  assert.strictEqual(result.bytes.length, 1024 * 1024);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(cancelled, true);
  assert.ok(served < 2 * 1024 * 1024, 'served ' + served + ' bytes');
});

// Three pieces arrive, then nothing more, as from a server that stalls partway through.
test('a body that stops arriving is returned as far as it got when the time runs out', { timeout: 2000 }, async function () {
  let served = 0;
  let cancelled = false;
  const stalled = new Response(new ReadableStream({
    pull(controller) {
      if (served < 3) { served++; controller.enqueue(bytesForTest(100)); return undefined; }
      return new Promise(function () {});
    },
    cancel() { cancelled = true; }
  }));
  const started = Date.now();
  const result = await fetchBodyForTest.readBodyWithCap(stalled, 1000, { timeoutMs: 200 });
  assert.strictEqual(result.bytes.length, 300);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(cancelled, true);
  assert.ok(Date.now() - started < 1000, 'returned after ' + (Date.now() - started) + ' ms');
});

test('a body that finishes in time is complete and not marked as timed out', async function () {
  let served = 0;
  const slowButDone = new Response(new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
        if (served >= 4) { controller.close(); return; }
        served++;
        controller.enqueue(bytesForTest(100));
      });
    }
  }));
  const result = await fetchBodyForTest.readBodyWithCap(slowButDone, 1000, { timeoutMs: 1000 });
  assert.strictEqual(result.bytes.length, 400);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.timedOut, false);
});

test('a body cut by size gives the size as the reason even with a time limit set', async function () {
  const stats = { pulls: 0, cancelled: false };
  const result = await fetchBodyForTest.readBodyWithCap(chunkedResponseForTest([bytesForTest(800), bytesForTest(800)], stats), 1000, { timeoutMs: 1000 });
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.timedOut, false);
});

test('the returned buffer holds exactly the bytes read, so it can be passed on as an ArrayBuffer', async function () {
  const stats = { pulls: 0, cancelled: false };
  const result = await fetchBodyForTest.readBodyWithCap(chunkedResponseForTest([bytesForTest(700), bytesForTest(700)], stats), 1000);
  assert.strictEqual(result.bytes.buffer.byteLength, 1000);
});

test('a response with no body reads as empty', async function () {
  const result = await fetchBodyForTest.readBodyWithCap(new Response(null), 1000);
  assert.strictEqual(result.bytes.length, 0);
  assert.strictEqual(result.truncated, false);
});

test('a complete body decodes the way Response.text() does', async function () {
  const raw = new Uint8Array([0xEF, 0xBB, 0xBF, 0x63, 0x61, 0x66, 0xC3, 0xA9, 0x20, 0xFF, 0x21]);
  assert.strictEqual(fetchBodyForTest.decodeUtf8(raw, false), await new Response(raw).text());
});

test('a body cut partway through a character drops the partial character', function () {
  const cut = new TextEncoder().encode('café €').subarray(0, 7);
  assert.strictEqual(fetchBodyForTest.decodeUtf8(cut, true), 'café ');
});
