// The agent loop (offscreen/agentRun.js) must not leave a timer running once a run has ended.
//
// A model request that threw used to skip the clearTimeout after the stream loop, so the step's
// 180-second idle timer outlived the run. It kept the run's whole closure alive, message list
// included, and then aborted a controller nothing used any more.
//
// The 90-second tool-round timer had the same shape. It was cleared only when every call in the
// round settled, so a round that rejected left it armed on the way to the error path.
//
// Checked against the loop before each fix. The first test failed with one 180000ms timer still
// pending after stream_end, and the third with one 90000ms timer.

const test = require('node:test');
const assert = require('node:assert');

// The loop registers its message listener when it loads.
const chromeStubForTimersTest = {
  listener: null,
  sendMessage: function () { return { ok: true }; }
};
globalThis.chrome = {
  runtime: {
    lastError: null,
    onMessage: { addListener: function (fn) { chromeStubForTimersTest.listener = fn; } },
    sendMessage: function (messageForStub, callbackForStub) {
      const responseForStub = chromeStubForTimersTest.sendMessage(messageForStub);
      if (typeof callbackForStub === 'function') setTimeout(function () { callbackForStub(responseForStub); }, 0);
    }
  }
};

require('../agent/tools.js');
require('../agent/documentGeneration.js');
require('../agent/toolExec.js');
require('../agent/builtinGuides.js');
require('../agent/contextBuilder.js');
require('../agent/client.js');
require('../agent/researchMode.js');
require('../offscreen/agentRun.js');

const agentNsForTimersTest = globalThis.ABChatAgent;
const realClientForTimersTest = agentNsForTimersTest.client;

// Tracks every timer of a second or longer from the moment it is armed until it fires or is
// cleared. Shorter ones are left out, since the stubs here answer through 0ms timers and the text
// debounce is short and flushed at the end of every run.
function trackLongTimersForTest() {
  const realSetTimeoutForTrack = globalThis.setTimeout;
  const realClearTimeoutForTrack = globalThis.clearTimeout;
  const pendingForTrack = new Map();
  globalThis.setTimeout = function (callbackForTrack, msForTrack) {
    const restForTrack = Array.prototype.slice.call(arguments, 2);
    let handleForTrack = null;
    handleForTrack = realSetTimeoutForTrack.apply(null, [function () {
      pendingForTrack.delete(handleForTrack);
      return callbackForTrack.apply(this, arguments);
    }, msForTrack].concat(restForTrack));
    if (Number(msForTrack) >= 1000) pendingForTrack.set(handleForTrack, Number(msForTrack));
    return handleForTrack;
  };
  globalThis.clearTimeout = function (handleForTrack) {
    pendingForTrack.delete(handleForTrack);
    return realClearTimeoutForTrack(handleForTrack);
  };
  return {
    pendingDelays: function () { return Array.from(pendingForTrack.values()); },
    // Clears whatever is still pending, so a failure does not hold the test process open.
    restore: function () {
      globalThis.setTimeout = realSetTimeoutForTrack;
      globalThis.clearTimeout = realClearTimeoutForTrack;
      pendingForTrack.forEach(function (msForTrack, handleForTrack) { realClearTimeoutForTrack(handleForTrack); });
      pendingForTrack.clear();
    }
  };
}

// Runs one agent run whose model requests go to `streamCompletionForTest`, with `hooksForTest` as
// the hook registry when one is given. Tool calls get a stub success. Resolves once the run has
// emitted stream_end and its finally block has finished.
function runLoopForTimersTest(streamCompletionForTest, hooksForTest) {
  const previousHooksForTimersTest = agentNsForTimersTest.hooks;
  const previousExecuteToolForTimersTest = agentNsForTimersTest.executeTool;
  agentNsForTimersTest.hooks = hooksForTest || previousHooksForTimersTest;
  agentNsForTimersTest.executeTool = async function () { return { ok: true, results: [] }; };
  const storeForTimersTest = [{ id: 1, chatId: 1, role: 'user', content: 'hello', md: 'hello' }];
  const signalsForTimersTest = [];
  globalThis.ABChatShared = {
    panelDataRepo: {
      getChat: async function () { return { id: 1, messages: storeForTimersTest.slice() }; },
      createMessage: async function (chatId, record) {
        const savedForTimersTest = Object.assign({ id: storeForTimersTest.length + 1, chatId: chatId }, record);
        storeForTimersTest.push(savedForTimersTest);
        return savedForTimersTest;
      },
      updateMessage: async function () { return null; },
      updateChat: async function () { return null; }
    }
  };
  agentNsForTimersTest.toolDefs = [{ type: 'function', function: { name: 'web_search', parameters: {} } }];
  agentNsForTimersTest.client = {
    streamCompletion: async function (params) {
      signalsForTimersTest.push(params.signal);
      return streamCompletionForTest(params);
    }
  };
  return new Promise(function (resolve) {
    chromeStubForTimersTest.sendMessage = function (messageForLoop) {
      if (messageForLoop.action === 'offscreenStreamBroadcast' && messageForLoop.event === 'stream_end') {
        setTimeout(function () {
          agentNsForTimersTest.client = realClientForTimersTest;
          agentNsForTimersTest.hooks = previousHooksForTimersTest;
          agentNsForTimersTest.executeTool = previousExecuteToolForTimersTest;
          resolve({ store: storeForTimersTest, signals: signalsForTimersTest });
        }, 0);
      }
      return { ok: true };
    };
    chromeStubForTimersTest.listener({ action: 'agentRunStart', params: { chatId: 1, model: 'chat/model', apiKey: 'k', pricing: { completionCostPerMillion: 1 } } }, {}, function () {});
  });
}

test('a run whose model request throws leaves no timer running', async function () {
  const timersForTest = trackLongTimersForTest();
  try {
    const outcome = await runLoopForTimersTest(async function () {
      throw new Error('OpenRouter error 500: upstream unavailable');
    });
    const lastForTest = outcome.store[outcome.store.length - 1];
    assert.ok(lastForTest.systemNotice && String(lastForTest.content).indexOf('OpenRouter error 500') !== -1, 'the run took its error path');
    assert.deepStrictEqual(timersForTest.pendingDelays(), []);
    assert.strictEqual(outcome.signals[0].aborted, false);
  } finally {
    timersForTest.restore();
  }
});

test('a run that answers leaves no timer running', async function () {
  const timersForTest = trackLongTimersForTest();
  try {
    const outcome = await runLoopForTimersTest(async function () {
      return { message: { role: 'assistant', content: 'Hi.' }, usage: null };
    });
    assert.strictEqual(outcome.store[outcome.store.length - 1].content, 'Hi.');
    assert.deepStrictEqual(timersForTest.pendingDelays(), []);
  } finally {
    timersForTest.restore();
  }
});

// Nothing in a tool round throws past its own catch today: the hook registry catches handler
// errors, and each call's own errors are caught by the abort wrapper. A dispatch that throws
// stands in for whatever might one day, and rejects the round the same way.
test('a tool round that throws leaves no timer running', async function () {
  const hooksThatThrowForTest = {
    createTurnContext: function (initForTest) {
      // The shape createTurnContext in agent/hooks/registry.js returns.
      return { chatId: initForTest.chatId, sendId: 'snd_test', userText: initForTest.userText || '', iterIndex: 0, toolCallsThisTurn: [], annotations: {}, firedCounts: new Map() };
    },
    dispatch: async function (eventNameForTest) {
      if (eventNameForTest === 'PreToolUse') throw new Error('hook dispatch failed');
      return { block: null, continueWithSystemNote: null, annotate: null, firings: [] };
    }
  };
  const timersForTest = trackLongTimersForTest();
  try {
    const outcome = await runLoopForTimersTest(async function () {
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'q' }) } }]
        },
        usage: null
      };
    }, hooksThatThrowForTest);
    const lastForTest = outcome.store[outcome.store.length - 1];
    assert.ok(lastForTest.systemNotice && String(lastForTest.content).indexOf('hook dispatch failed') !== -1, 'the run took its error path');
    assert.deepStrictEqual(timersForTest.pendingDelays(), []);
  } finally {
    timersForTest.restore();
  }
});
