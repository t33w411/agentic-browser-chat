// Where the agent loop saves the cost of its side calls (an image, compaction's summary, a tool's
// own model call), in offscreen/agentRun.js. The chat total is the sum of the assistant messages'
// usageCost, so a side call that is on no message is missing from it, and one on two messages is
// counted twice.
//
// Checked against the loop before this change, which put every side call on the reply that ends
// the run and nowhere else: "a stop during a tool", "an error after a tool" and "a stop after
// compaction" fail there with the side call missing from the total, and "a hook that sends the
// model back" fails with it counted twice. The first test passes there too; it pins the reply that
// ends a normal run.

const test = require('node:test');
const assert = require('node:assert');

const chromeStubForTest = {
  listener: null,
  sendMessage: function () { return { ok: true }; }
};
globalThis.chrome = {
  runtime: {
    lastError: null,
    onMessage: { addListener: function (fn) { chromeStubForTest.listener = fn; } },
    sendMessage: function (messageForStub, callbackForStub) {
      const responseForStub = chromeStubForTest.sendMessage(messageForStub);
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
require('../agent/hooks/registry.js');
require('../offscreen/agentRun.js');

const agentNsForTest = globalThis.ABChatAgent;
const realExecuteToolForTest = agentNsForTest.executeTool;
const realClientForTest = agentNsForTest.client;
const realToolDefsForTest = agentNsForTest.toolDefs;

function usageForTest(cost) {
  return { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, cost: cost };
}

function callForTest(id, cost, queries) {
  return {
    message: { role: 'assistant', content: '', tool_calls: (queries || ['q']).map(function (query, i) {
      return { id: id + '_' + i, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: query }) } };
    }) },
    usage: usageForTest(cost)
  };
}

function answerForTest(text, cost) {
  return { message: { role: 'assistant', content: text }, usage: usageForTest(cost) };
}

function stopRunForTest() {
  chromeStubForTest.listener({ action: 'offscreenCancelRequest', chatId: 1 }, {}, function () {});
}

// Runs one agent run over history. respond(index) answers each model request and may throw;
// toolForTest(name, args) stands in for every tool. The store is what the repo saved, updates included.
function runLoopForTest(history, respond, toolForTest) {
  const store = history.map(function (m, i) { return Object.assign({ id: i + 1, chatId: 1 }, m); });
  let nextId = store.length + 1;
  globalThis.ABChatShared = {
    panelDataRepo: {
      getChat: async function () { return { id: 1, messages: store.map(function (m) { return Object.assign({}, m); }) }; },
      createMessage: async function (chatId, record) {
        const saved = Object.assign({ id: nextId++, chatId: chatId }, record);
        store.push(saved);
        return Object.assign({}, saved);
      },
      updateMessage: async function (id, patch) {
        const saved = store.find(function (m) { return m.id === id; });
        if (saved) Object.assign(saved, patch);
        return saved || null;
      },
      updateChat: async function () { return null; }
    }
  };
  agentNsForTest.toolDefs = [{ type: 'function', function: { name: 'web_search', parameters: {} } }];
  agentNsForTest.executeTool = async function (name, args) { return toolForTest(name, args); };
  let requestCount = 0;
  agentNsForTest.client = { streamCompletion: async function () { return respond(requestCount++); } };
  return new Promise(function (resolve) {
    chromeStubForTest.sendMessage = function (message) {
      if (message.action === 'offscreenStreamBroadcast' && message.event === 'stream_end') {
        setTimeout(function () {
          agentNsForTest.executeTool = realExecuteToolForTest;
          agentNsForTest.client = realClientForTest;
          agentNsForTest.toolDefs = realToolDefsForTest;
          chromeStubForTest.sendMessage = function () { return { ok: true }; };
          resolve(store);
        }, 0);
      }
      return { ok: true };
    };
    chromeStubForTest.listener({ action: 'agentRunStart', params: { chatId: 1, model: 'chat/model', apiKey: 'k', pricing: { completionCostPerMillion: 1 } } }, {}, function () {});
  });
}

function chatTotalForTest(store) {
  return store.reduce(function (sum, m) { return m.role === 'assistant' && m.usageCost > 0 ? sum + m.usageCost : sum; }, 0);
}

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (message || '') + ' expected ' + expected + ', got ' + actual);
}

const FIRST_MESSAGE = [{ role: 'user', content: 'find it', md: 'find it' }];

test('the reply that ends a run carries its side calls, and each request keeps its own cost', async function () {
  const store = await runLoopForTest(FIRST_MESSAGE, function (index) {
    return index === 0 ? callForTest('s1', 0.001) : answerForTest('Found it.', 0.002);
  }, function () {
    return { ok: true, results: [], _usage: { cost: 0.05 } };
  });
  const call = store.find(function (m) { return m.role === 'assistant' && m.tool_calls; });
  const reply = store.find(function (m) { return m.role === 'assistant' && m.content === 'Found it.'; });
  close(call.usageCost, 0.001, 'the tool-call message');
  close(reply.usageCost, 0.052, 'the reply');
  close(chatTotalForTest(store), 0.053, 'the chat total');
});

// Two searches run at once. The first finishes and was billed; the stop comes while the second is
// still running, so the round ends with no reply. A tool still running at the stop is abandoned
// with no result, so only the finished one's cost can be known.
test('a stop during a tool keeps the finished tools\' side calls in the chat total, on the last message saved', async function () {
  const store = await runLoopForTest(FIRST_MESSAGE, function (index) {
    return index === 0 ? callForTest('s1', 0.001, ['fast', 'slow']) : answerForTest('never sent', 0.002);
  }, async function (name, args) {
    if (args.query === 'slow') {
      await new Promise(function (resolve) { setTimeout(resolve, 20); });
      stopRunForTest();
      return { ok: true, results: [], _usage: { cost: 0.5 } };
    }
    return { ok: true, results: [], _usage: { cost: 0.05 } };
  });
  assert.ok(!store.some(function (m) { return m.content === 'never sent'; }), 'the run stopped before its reply');
  const call = store.find(function (m) { return m.role === 'assistant' && m.tool_calls; });
  close(call.usageCost, 0.051, 'the tool-call message, its request plus the finished search');
  close(chatTotalForTest(store), 0.051, 'the chat total');
});

test('an error after a tool keeps the tool\'s side call in the chat total', async function () {
  const store = await runLoopForTest(FIRST_MESSAGE, function (index) {
    if (index === 0) return callForTest('s1', 0.001);
    throw new Error('the provider went away');
  }, function () {
    return { ok: true, results: [], _usage: { cost: 0.05 } };
  });
  const notice = store.find(function (m) { return m.systemNotice && /the provider went away/.test(m.content); });
  assert.ok(notice, 'the error was saved as a notice');
  close(notice.usageCost, 0.05, 'the notice, the last message the run saved');
  close(chatTotalForTest(store), 0.051, 'the chat total');
});

test('a hook that sends the model back after a reply does not count the side calls twice', async function () {
  const hooks = agentNsForTest.hooks;
  hooks.register('Stop', {
    name: 'test-send-back-once',
    maxFiresPerSend: 1,
    handler: function () { return { continueWithSystemNote: 'Check once more.' }; }
  });
  try {
    const store = await runLoopForTest(FIRST_MESSAGE, function (index) {
      if (index === 0) return callForTest('s1', 0.001);
      if (index === 1) return answerForTest('First answer.', 0.002);
      return answerForTest('Second answer.', 0.003);
    }, function () {
      return { ok: true, results: [], _usage: { cost: 0.05 } };
    });
    const first = store.find(function (m) { return m.content === 'First answer.'; });
    const second = store.find(function (m) { return m.content === 'Second answer.'; });
    close(first.usageCost, 0.052, 'the first reply');
    close(second.usageCost, 0.003, 'the second reply, its request only');
    close(chatTotalForTest(store), 0.056, 'the chat total');
  } finally {
    hooks.unregister('Stop', 'test-send-back-once');
  }
});

test('a stop after compaction and before any reply puts the summary\'s cost on the chat\'s last earlier reply', async function () {
  const realCompactor = agentNsForTest.compactor;
  agentNsForTest.compactor = {
    maybeCompact: async function () {
      return { didCompact: true, summaryText: 'Earlier: the user asked about tides.', compactedThroughMessageId: 2, summarizerUsage: { cost: 0.02 } };
    }
  };
  try {
    const store = await runLoopForTest([
      { role: 'user', content: 'tides?', md: 'tides?' },
      { role: 'assistant', content: 'High at noon.', md: 'High at noon.', usageCost: 0.004 },
      { role: 'user', content: 'and tomorrow?', md: 'and tomorrow?' }
    ], function () {
      stopRunForTest();
      return { cancelled: true, message: { role: 'assistant', content: '' }, usage: null };
    }, function () {
      return { ok: true };
    });
    assert.strictEqual(store.length, 3, 'the run saved no message');
    close(store[1].usageCost, 0.024, 'the earlier reply');
    close(chatTotalForTest(store), 0.024, 'the chat total');
  } finally {
    agentNsForTest.compactor = realCompactor;
  }
});
