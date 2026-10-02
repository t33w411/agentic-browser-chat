// How chat log records store each turn's request (agent/apiLogTurns.js).
//
// Verified against the old behaviour, reconstructed as encodeTurnRequest always returning
// { requestMessages } whole: the delta-shape, stored-size and changed-history cases fail (the
// 20-turn run stores 4,738,674 characters that way against 250,082), while the round-trip,
// equality and old-record cases pass, as they should for records stored whole. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const turnsForTest = require('../agent/apiLogTurns.js');

const SYSTEM_PROMPT_FOR_TEST = 'S'.repeat(45000);

// The messages sent on each turn of a run: the system prompt, the user's question, then one tool
// call and its result per turn. The first result is a 200,000-character page.
function runMessagesForTest(turnCount) {
  const turns = [];
  let messages = [{ role: 'system', content: SYSTEM_PROMPT_FOR_TEST }, { role: 'user', content: 'Summarize the page.' }];
  for (let t = 0; t < turnCount; t++) {
    turns.push(messages);
    const callId = 'call_' + t;
    messages = messages.concat([
      { role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: 'page_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: callId, content: t === 0 ? 'P'.repeat(200000) : 'result ' + t }
    ]);
  }
  return turns;
}

function encodeRunForTest(requestsForRun) {
  let previous = null;
  return requestsForRun.map(function (messages, index) {
    const turn = Object.assign({ turnIndex: index + 1 }, turnsForTest.encodeTurnRequest(previous, messages));
    previous = messages;
    return turn;
  });
}

test('a turn that only adds messages is stored as the messages it added', function () {
  const requests = runMessagesForTest(3);
  const stored = encodeRunForTest(requests);
  assert.deepStrictEqual(stored[0].requestMessages, requests[0]);
  assert.strictEqual(stored[1].requestMessages, undefined);
  assert.strictEqual(stored[1].unchangedPrefixCount, 2);
  assert.deepStrictEqual(stored[1].requestMessagesDelta, requests[1].slice(2));
});

test('expanding the stored turns gives back every request whole', function () {
  const requests = runMessagesForTest(6);
  const expanded = turnsForTest.expandTurns(JSON.parse(JSON.stringify(encodeRunForTest(requests))));
  assert.strictEqual(expanded.length, requests.length);
  expanded.forEach(function (turn, index) {
    assert.deepStrictEqual(turn.requestMessages, requests[index]);
    assert.strictEqual(turn.requestMessagesDelta, undefined);
    assert.strictEqual(turn.unchangedPrefixCount, undefined);
  });
});

test('a run of 20 turns is stored in a small fraction of the space', function () {
  const requests = runMessagesForTest(20);
  const wholeChars = JSON.stringify(requests.map(function (m) { return { requestMessages: m }; })).length;
  const storedChars = JSON.stringify(encodeRunForTest(requests)).length;
  assert.ok(storedChars * 10 < wholeChars, 'stored ' + storedChars + ' of ' + wholeChars + ' characters');
});

test('a turn whose earlier messages changed is stored whole', function () {
  const requests = runMessagesForTest(3);
  // Compaction replaced the history with a summary.
  const compacted = [{ role: 'system', content: SYSTEM_PROMPT_FOR_TEST }, { role: 'user', content: 'Summary of the earlier conversation.' }];
  const stored = encodeRunForTest([requests[0], requests[1], compacted, compacted.concat([{ role: 'user', content: 'Next.' }])]);
  assert.deepStrictEqual(stored[2].requestMessages, compacted);
  assert.strictEqual(stored[3].unchangedPrefixCount, 2);
  const expanded = turnsForTest.expandTurns(stored);
  assert.deepStrictEqual(expanded[3].requestMessages, compacted.concat([{ role: 'user', content: 'Next.' }]));
});

test('a changed tool call id or a changed part of multi-part content counts as a change', function () {
  assert.strictEqual(turnsForTest.messagesEqual({ role: 'tool', tool_call_id: 'a', content: 'x' }, { role: 'tool', tool_call_id: 'b', content: 'x' }), false);
  assert.strictEqual(turnsForTest.messagesEqual({ role: 'tool', tool_call_id: 'a', content: 'x' }, { role: 'tool', tool_call_id: 'a', content: 'x' }), true);
  const parts = (text) => ({ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: '[image data omitted from log]' } }] });
  assert.strictEqual(turnsForTest.messagesEqual(parts('one'), parts('one')), true);
  assert.strictEqual(turnsForTest.messagesEqual(parts('one'), parts('two')), false);
});

test('records stored before this change, with every turn whole, expand to themselves', function () {
  const requests = runMessagesForTest(3);
  const old = requests.map(function (messages, index) { return { turnIndex: index + 1, requestMessages: messages }; });
  const expanded = turnsForTest.expandTurns(old);
  expanded.forEach(function (turn, index) { assert.strictEqual(turn, old[index]); });
});
