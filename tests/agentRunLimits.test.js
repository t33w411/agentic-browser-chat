// Tests for the agent run's limits: the reasoning chunks that keep the stream idle timer from firing
// while a model thinks (agent/client.js), the per-run tool-call cap (agent/hooks/builtin/toolCallCap.js),
// and the stop notices that report the limit a run hit (shared/agentRunStop.js).
//
// Checked against the code before this change: the client sent no delta for a reasoning chunk, so
// the reasoning test fails; the cap was fixed at 60, so the run-limit cap test fails because 61
// calls were blocked; the stream and turn notices had "90s" and "10-minute" written in, so the
// notice test fails, and the older-runs preview test fails on the old "no data" wording. The
// keepalive test and the 60-call fallback test pass against the old code too. They pin behaviour
// that has to stay: a keepalive must not hold off the idle timer, and a run that sets no limit
// keeps the old cap.

const test = require('node:test');
const assert = require('node:assert');

require('../agent/client.js');
require('../agent/hooks/registry.js');
require('../agent/hooks/builtin/toolCallCap.js');
require('../shared/agentRunStop.js');

const agentNsForLimitsTest = globalThis.ABChatAgent;
const agentRunStopForLimitsTest = globalThis.ABChatShared.agentRunStop;

function sseLineForLimitsTest(delta) {
  return 'data: ' + JSON.stringify({ choices: [{ delta: delta }] }) + '\n\n';
}

async function streamDeltasForLimitsTest(sseBody) {
  const originalFetchForLimitsTest = globalThis.fetch;
  globalThis.fetch = async function () { return new Response(sseBody, { status: 200 }); };
  const deltasForLimitsTest = [];
  try {
    const resultForLimitsTest = await agentNsForLimitsTest.client.streamCompletion({
      model: 'test/model',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: function (delta) { deltasForLimitsTest.push(delta); }
    });
    return { deltas: deltasForLimitsTest, result: resultForLimitsTest };
  } finally {
    globalThis.fetch = originalFetchForLimitsTest;
  }
}

test('reasoning chunks are reported to onDelta and kept out of the reply', async () => {
  const bodyForTest = sseLineForLimitsTest({ reasoning: 'Thinking about it.' })
    + sseLineForLimitsTest({ reasoning: '', reasoning_details: [{ type: 'reasoning.encrypted', data: 'abc' }] })
    + sseLineForLimitsTest({ content: 'Answer.' })
    + 'data: [DONE]\n\n';
  const { deltas, result } = await streamDeltasForLimitsTest(bodyForTest);
  assert.deepStrictEqual(deltas.map(function (d) { return d.type; }), ['reasoning', 'reasoning', 'text']);
  assert.strictEqual(result.message.content, 'Answer.');
});

test('a keepalive comment line is not reported as model output', async () => {
  const bodyForTest = ': OPENROUTER PROCESSING\n\n'
    + sseLineForLimitsTest({ content: 'Answer.' })
    + 'data: [DONE]\n\n';
  const { deltas } = await streamDeltasForLimitsTest(bodyForTest);
  assert.deepStrictEqual(deltas.map(function (d) { return d.type; }), ['text']);
});

function toolCallsForLimitsTest(count) {
  const callsForLimitsTest = [];
  for (let i = 0; i < count; i++) {
    callsForLimitsTest.push({ id: 'call_' + i, type: 'function', function: { name: 'read', arguments: '{}' } });
  }
  return callsForLimitsTest;
}

async function dispatchCapForLimitsTest(callCount, maxToolCalls) {
  const turnContextForLimitsTest = agentNsForLimitsTest.hooks.createTurnContext({ chatId: 1 });
  turnContextForLimitsTest.toolCallsThisTurn = toolCallsForLimitsTest(callCount);
  if (maxToolCalls !== undefined) turnContextForLimitsTest.maxToolCalls = maxToolCalls;
  return agentNsForLimitsTest.hooks.dispatch('PostModelResponse', {
    assistantMessage: { role: 'assistant', content: '' }, toolCalls: [], isFinalReply: false, chatId: 1
  }, turnContextForLimitsTest);
}

test('the tool-call cap uses the limit the run sets', async () => {
  const underForTest = await dispatchCapForLimitsTest(61, 100);
  assert.strictEqual(underForTest.block, null);
  const overForTest = await dispatchCapForLimitsTest(101, 100);
  assert.strictEqual(overForTest.block.code, 'tool-call-limit');
  assert.strictEqual(overForTest.block.limit, 100);
});

test('the tool-call cap falls back to 60 when the run sets no limit', async () => {
  const atForTest = await dispatchCapForLimitsTest(60);
  assert.strictEqual(atForTest.block, null);
  const overForTest = await dispatchCapForLimitsTest(61);
  assert.strictEqual(overForTest.block.limit, 60);
});

test('stream and turn notices report the limit they were given', () => {
  assert.match(agentRunStopForLimitsTest.buildNotice('stream', 180000), /no output for 180s/);
  assert.match(agentRunStopForLimitsTest.buildNotice('total', 20 * 60 * 1000), /20-minute time limit/);
});

test('log previews of older runs keep the limits those runs had', () => {
  assert.match(agentRunStopForLimitsTest.getLogPreviewText({ status: 'timeout-stream', stopReason: 'stream' }), /no output for 90s/);
  assert.match(agentRunStopForLimitsTest.getLogPreviewText({ status: 'timeout-total', stopReason: 'total' }), /10-minute time limit/);
  assert.match(agentRunStopForLimitsTest.getLogPreviewText({ status: 'timeout-tool', stopReason: 'tool', toolTimeoutMs: 180000 }), /3-minute limit/);
  assert.match(agentRunStopForLimitsTest.getLogPreviewText({ status: 'timeout-stream', stopReason: 'stream', timeoutMs: 180000 }), /no output for 180s/);
});
