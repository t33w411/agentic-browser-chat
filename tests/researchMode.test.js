// Deep research: the rules in agent/researchMode.js, the agent loop that applies them
// (offscreen/agentRun.js), and the pieces the loop relies on: the latest-user-turn note in
// agent/contextBuilder.js, parallel_tool_calls in agent/client.js, web_search's search model in
// agent/toolExec.js, and the draft's research switch in panel/panelDraftSync.js. Also the Sources
// list the loop saves on the final reply, which marks the pages web_fetch read.
//
// Checked against a copy of the code before this change with only this file and
// agent/researchMode.js added: 9 of the 13 tests fail. The loop tests fail on no tool_choice, no
// parallel calls, no note and no search model, and the client, note, web_search and draft tests
// fail too. The four researchMode unit tests pass there because the module is new. The
// ordinary-run test fails there only because the old loop passed no parallelToolCalls at all, and
// the test checks the value the loop passes; the client sent false either way. The floor test also caught a bug in the first version of this change: the step's
// tool_choice was a bare `var` in the loop body, so it kept "required" after the floor was met.

const test = require('node:test');
const assert = require('node:assert');

// The loop registers its message listener when it loads, and the service worker stubs below are
// swapped per test.
const chromeStubForTest = {
  listener: null,
  sendMessage: function () {}
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
const researchMode = require('../agent/researchMode.js');
require('../offscreen/agentRun.js');
const draftSync = require('../panel/panelDraftSync.js');

const agentNsForTest = globalThis.ABChatAgent;
const realExecuteToolForTest = agentNsForTest.executeTool;
const realClientForTest = agentNsForTest.client;

function toolCallForTest(id, name, args) {
  return { id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } };
}

function userMessageForTest(text, extra) {
  return Object.assign({ role: 'user', content: text, md: text }, extra || {});
}

// ---------------------------------------------------------------------------
// agent/researchMode.js
// ---------------------------------------------------------------------------

test('a run is a research run only when the latest user message asked for it', function () {
  assert.strictEqual(researchMode.isResearchRun([userMessageForTest('q', { research: true })]), true);
  assert.strictEqual(researchMode.isResearchRun([
    userMessageForTest('old', { research: true }),
    { role: 'assistant', content: 'answer' },
    userMessageForTest('thanks')
  ]), false);
  assert.strictEqual(researchMode.isResearchRun([userMessageForTest('q', { research: 'yes' })]), false);
  assert.strictEqual(researchMode.isResearchRun([]), false);
});

test('progress counts distinct successful searches and page reads since the latest user message', function () {
  const messagesForProgress = [
    userMessageForTest('earlier', { research: true }),
    { role: 'assistant', content: '', tool_calls: [toolCallForTest('old1', 'web_search', { query: 'before' })] },
    { role: 'tool', tool_call_id: 'old1', content: JSON.stringify({ ok: true, results: [] }) },
    userMessageForTest('now', { research: true }),
    { role: 'assistant', content: '', tool_calls: [
      toolCallForTest('s1', 'web_search', { query: 'Solar  panel prices 2026' }),
      toolCallForTest('s2', 'web_search', { query: 'solar panel prices 2026' }),
      toolCallForTest('s3', 'web_search', { query: 'panel efficiency' }),
      toolCallForTest('s4', 'web_search', { query: 'failed one' })
    ] },
    // result_ref is stamped onto the saved JSON; it must still parse.
    { role: 'tool', tool_call_id: 's1', content: JSON.stringify({ ok: true, results: [], result_ref: 7 }) },
    { role: 'tool', tool_call_id: 's2', content: JSON.stringify({ ok: true, results: [] }) },
    { role: 'tool', tool_call_id: 's3', content: JSON.stringify({ ok: true, text: 'raw' }) },
    { role: 'tool', tool_call_id: 's4', content: JSON.stringify({ ok: false, error: 'Web search API error 500' }) },
    { role: 'assistant', content: '', tool_calls: [
      toolCallForTest('f1', 'web_fetch', { url: 'https://a.example/x#top', prompt: 'p' }),
      toolCallForTest('f2', 'web_fetch', { url: 'https://a.example/x', prompt: 'p' }),
      toolCallForTest('f3', 'web_fetch', { url: 'https://b.example/', prompt: 'p' }),
      toolCallForTest('r1', 'read', { type: 'note', id: 1 })
    ] },
    { role: 'tool', tool_call_id: 'f1', content: JSON.stringify({ ok: true, content: 'page' }) },
    { role: 'tool', tool_call_id: 'f2', content: JSON.stringify({ ok: true, content: 'page' }) },
    { role: 'tool', tool_call_id: 'f3', content: JSON.stringify({ ok: false, error: 'Blocked' }) },
    { role: 'tool', tool_call_id: 'r1', content: JSON.stringify({ ok: true }) }
  ];
  assert.deepStrictEqual(researchMode.progress(messagesForProgress), { searches: 2, pageReads: 1, failedSearches: 1 });
});

test('a tool call is required until the floor is met, the round cap is hit, or searching is broken', function () {
  const floorForGate = { searches: researchMode.MIN_SEARCHES, pageReads: researchMode.MIN_PAGE_READS, failedSearches: 0 };
  assert.strictEqual(researchMode.shouldRequireToolCall({ searches: 0, pageReads: 0, failedSearches: 0 }, 0), true);
  assert.strictEqual(researchMode.shouldRequireToolCall(Object.assign({}, floorForGate, { pageReads: researchMode.MIN_PAGE_READS - 1 }), 3), true);
  assert.strictEqual(researchMode.shouldRequireToolCall(floorForGate, 3), false);
  assert.strictEqual(researchMode.shouldRequireToolCall({ searches: 0, pageReads: 0, failedSearches: 0 }, researchMode.MAX_REQUIRED_ROUNDS), false);
  assert.strictEqual(researchMode.shouldRequireToolCall({ searches: 0, pageReads: 0, failedSearches: researchMode.BROKEN_SEARCH_FAILURES }, 2), false);
  // One search worked, so later failures do not count as broken.
  assert.strictEqual(researchMode.shouldRequireToolCall({ searches: 1, pageReads: 0, failedSearches: 5 }, 4), true);
});

test('the instructions state the same floor the loop enforces', function () {
  const textForInstructions = researchMode.instructions();
  assert.match(textForInstructions, /^<research_mode>/);
  assert.ok(textForInstructions.indexOf('at least ' + researchMode.MIN_SEARCHES + ' searches and ' + researchMode.MIN_PAGE_READS + ' page reads') !== -1);
});

// A test run had a search summary give one market share as 20% where the page it cited said 8.6%.
// Fails against the instructions before this rule was added.
test('the instructions say to flag a claim that rests only on a search summary', function () {
  const textForInstructions = researchMode.instructions();
  assert.ok(textForInstructions.indexOf('If a figure or claim in the answer rests only on a search summary') !== -1);
});

// ---------------------------------------------------------------------------
// agent/contextBuilder.js: the note goes on the latest user turn of the request copy only
// ---------------------------------------------------------------------------

test('the note is appended to the latest user turn only and the saved messages are untouched', async function () {
  const chatForNote = [
    userMessageForTest('first question', { research: true }),
    { role: 'assistant', content: 'first answer' },
    userMessageForTest('second question', { research: true })
  ];
  const savedCopyForNote = JSON.stringify(chatForNote);
  const apiForNote = await agentNsForTest.contextBuilder.build(chatForNote, { latestUserTurnNote: '<research_mode>x</research_mode>' });
  const userTurnsForNote = apiForNote.filter(function (m) { return m.role === 'user'; });
  assert.strictEqual(userTurnsForNote[0].content, 'first question');
  assert.strictEqual(userTurnsForNote[1].content, 'second question\n\n<research_mode>x</research_mode>');
  assert.strictEqual(JSON.stringify(chatForNote), savedCopyForNote);

  const plainForNote = await agentNsForTest.contextBuilder.build(chatForNote, {});
  assert.strictEqual(plainForNote.filter(function (m) { return m.role === 'user'; })[1].content, 'second question');
});

test('a user turn with image parts gets the note in its text part', async function () {
  // Image parts are read from the attachment store by the chip's refId.
  globalThis.ABChatShared = {
    panelDataRepo: {
      getAttachmentBlob: async function (idForBlob) {
        return idForBlob === 5 ? { id: 5, dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' } : null;
      }
    }
  };
  const chatForParts = [userMessageForTest('what is this', {
    chips: [{ type: 'image', label: 'shot.png', refId: 5, mimeType: 'image/png' }]
  })];
  const apiForParts = await agentNsForTest.contextBuilder.build(chatForParts, { latestUserTurnNote: 'NOTE' });
  const contentForParts = apiForParts[apiForParts.length - 1].content;
  assert.ok(Array.isArray(contentForParts));
  const textPartsForParts = contentForParts.filter(function (p) { return p.type === 'text'; });
  assert.strictEqual(textPartsForParts.length, 1);
  assert.ok(textPartsForParts[0].text.endsWith('\n\nNOTE'));
});

// ---------------------------------------------------------------------------
// agent/client.js: tool_choice and parallel_tool_calls reach the request body
// ---------------------------------------------------------------------------

async function requestBodyForClientTest(paramsForClient) {
  const originalFetchForClient = globalThis.fetch;
  let bodyForClient = null;
  globalThis.fetch = async function (url, opts) {
    bodyForClient = JSON.parse(opts.body);
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  };
  try {
    await realClientForTest.streamCompletion(Object.assign({
      model: 'openai/gpt-4.1', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }]
    }, paramsForClient));
  } finally {
    globalThis.fetch = originalFetchForClient;
  }
  return bodyForClient;
}

test('the client sends one tool call per step unless parallel calls are asked for', async function () {
  const defaultBody = await requestBodyForClientTest({});
  assert.strictEqual(defaultBody.parallel_tool_calls, false);
  assert.strictEqual(defaultBody.tool_choice, 'auto');
  const researchBody = await requestBodyForClientTest({ parallelToolCalls: true, tool_choice: 'required' });
  assert.strictEqual(researchBody.parallel_tool_calls, true);
  assert.strictEqual(researchBody.tool_choice, 'required');
});

// ---------------------------------------------------------------------------
// agent/toolExec.js: web_search runs on the research search model, falling back to the chat model
// ---------------------------------------------------------------------------

function searchStubForTest(responsesByModel) {
  const sentForSearch = [];
  chromeStubForTest.sendMessage = function (messageForSearch) {
    if (messageForSearch.action !== 'agentWebSearch') return { ok: true };
    sentForSearch.push(messageForSearch.model);
    return responsesByModel[messageForSearch.model];
  };
  return sentForSearch;
}

test('web_search uses the search model it is given, and the chat model otherwise', async function () {
  const okForSearch = { ok: true, results: [{ title: 'A', url: 'https://a.example/' }], rawResponse: 'summary', usage: { cost: 0.001 } };
  let sentForSearch = searchStubForTest({ 'cheap/model': okForSearch, 'chat/model': okForSearch });
  const researchResult = await realExecuteToolForTest('web_search', { query: 'solar panel prices in 2026 by region' }, { apiKey: 'k', model: 'chat/model', searchModel: 'cheap/model' });
  assert.strictEqual(researchResult.ok, true);
  assert.deepStrictEqual(sentForSearch, ['cheap/model']);

  sentForSearch = searchStubForTest({ 'chat/model': okForSearch });
  await realExecuteToolForTest('web_search', { query: 'solar panel prices in 2026 by region' }, { apiKey: 'k', model: 'chat/model' });
  assert.deepStrictEqual(sentForSearch, ['chat/model']);
});

test('a failed search on the search model is run again on the chat model, and both costs are kept', async function () {
  const sentForSearch = searchStubForTest({
    // The cheap model answered without searching: no sources, so it does not count.
    'cheap/model': { ok: false, error: 'Web search returned no results', rawResponse: 'from memory', usage: { cost: 0.002 } },
    'chat/model': { ok: true, results: [{ title: 'A', url: 'https://a.example/' }], rawResponse: 'summary', usage: { cost: 0.01 } }
  });
  const resultForFallback = await realExecuteToolForTest('web_search', { query: 'solar panel prices in 2026 by region' }, { apiKey: 'k', model: 'chat/model', searchModel: 'cheap/model' });
  assert.deepStrictEqual(sentForSearch, ['cheap/model', 'chat/model']);
  assert.strictEqual(resultForFallback.ok, true);
  assert.strictEqual(resultForFallback.results.length, 1);
  assert.ok(Math.abs(resultForFallback._usage.cost - 0.012) < 1e-9);
});

// ---------------------------------------------------------------------------
// offscreen/agentRun.js: the loop end to end, with the model, the store and the tools stubbed
// ---------------------------------------------------------------------------

// Runs one agent run over `history` and answers each model request with `respond(requestIndex,
// params)`. Resolves once the run emits stream_end.
function runLoopForTest(history, respond, toolForTest) {
  const requestsForLoop = [];
  const toolContextsForLoop = [];
  const storeForLoop = history.map(function (m, i) { return Object.assign({ id: i + 1, chatId: 1 }, m); });
  let nextIdForLoop = storeForLoop.length + 1;
  globalThis.ABChatShared = {
    panelDataRepo: {
      getChat: async function () { return { id: 1, messages: storeForLoop.slice() }; },
      createMessage: async function (chatId, record) {
        const savedForLoop = Object.assign({ id: nextIdForLoop++, chatId: chatId }, record);
        storeForLoop.push(savedForLoop);
        return savedForLoop;
      },
      updateMessage: async function () { return null; },
      updateChat: async function () { return null; }
    }
  };
  agentNsForTest.toolDefs = [
    { type: 'function', function: { name: 'web_search', parameters: {} } },
    { type: 'function', function: { name: 'web_fetch', parameters: {} } }
  ];
  agentNsForTest.executeTool = async function (name, args, context) {
    toolContextsForLoop.push({ name: name, searchModel: context.searchModel });
    return toolForTest(name, args);
  };
  agentNsForTest.client = {
    streamCompletion: async function (params) {
      requestsForLoop.push({
        tool_choice: params.tool_choice,
        parallelToolCalls: params.parallelToolCalls,
        lastUserContent: (function () {
          for (let i = params.messages.length - 1; i >= 0; i--) {
            if (params.messages[i].role === 'user') return params.messages[i].content;
          }
          return '';
        })()
      });
      return respond(requestsForLoop.length - 1, params);
    }
  };
  return new Promise(function (resolve) {
    chromeStubForTest.sendMessage = function (messageForLoop) {
      if (messageForLoop.action === 'offscreenStreamBroadcast' && messageForLoop.event === 'stream_end') {
        setTimeout(function () {
          agentNsForTest.executeTool = realExecuteToolForTest;
          agentNsForTest.client = realClientForTest;
          resolve({ requests: requestsForLoop, toolContexts: toolContextsForLoop, store: storeForLoop });
        }, 0);
      }
      return { ok: true };
    };
    chromeStubForTest.listener({ action: 'agentRunStart', params: { chatId: 1, model: 'chat/model', apiKey: 'k', pricing: { completionCostPerMillion: 1 } } }, {}, function () {});
  });
}

function answerForTest(text) {
  return { message: { role: 'assistant', content: text }, usage: null };
}

function callsForTest(prefix, name, argsList) {
  return {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: argsList.map(function (args, i) { return toolCallForTest(prefix + i, name, args); })
    },
    usage: null
  };
}

function okToolForTest(name, args) {
  return name === 'web_search'
    ? { ok: true, results: [{ title: args.query, url: 'https://' + args.query.length + '.example/' }] }
    : { ok: true, content: 'page text' };
}

test('a research run must call tools until the floor is met, then may answer', async function () {
  const outcome = await runLoopForTest([userMessageForTest('compare heat pumps', { research: true })], function (index) {
    if (index === 0) return callsForTest('s', 'web_search', [{ query: 'heat pump efficiency 2026' }, { query: 'heat pump running cost' }, { query: 'heat pump criticism' }]);
    if (index === 1) return callsForTest('f', 'web_fetch', [{ url: 'https://a.example/' }, { url: 'https://b.example/' }, { url: 'https://c.example/' }]);
    return answerForTest('The answer, with sources.');
  }, okToolForTest);

  assert.deepStrictEqual(outcome.requests.map(function (r) { return r.tool_choice; }), ['required', 'required', undefined]);
  assert.ok(outcome.requests.every(function (r) { return r.parallelToolCalls === true; }));
  assert.ok(outcome.requests.every(function (r) { return String(r.lastUserContent).indexOf('<research_mode>') !== -1; }));
  assert.ok(outcome.toolContexts.filter(function (c) { return c.name === 'web_search'; }).every(function (c) { return c.searchModel === researchMode.SEARCH_MODEL; }));
  const savedUserForRun = outcome.store.find(function (m) { return m.role === 'user'; });
  assert.ok(String(savedUserForRun.content).indexOf('<research_mode>') === -1, 'the note is never saved');
  assert.strictEqual(outcome.store[outcome.store.length - 1].content, 'The answer, with sources.');
});

test('when a provider refuses the forced tool call, the step is sent again without it and forcing stops', async function () {
  const outcome = await runLoopForTest([userMessageForTest('compare heat pumps', { research: true })], function (index) {
    if (index === 0) throw new Error('OpenRouter error 400: tool_choice is not supported with extended thinking');
    return answerForTest('Answered without forcing.');
  }, okToolForTest);
  assert.deepStrictEqual(outcome.requests.map(function (r) { return r.tool_choice; }), ['required', undefined]);
  assert.strictEqual(outcome.store[outcome.store.length - 1].content, 'Answered without forcing.');
});

test('an ordinary run is sent no tool_choice, one call per step, no note and no search model', async function () {
  const outcome = await runLoopForTest([
    userMessageForTest('earlier research question', { research: true }),
    { role: 'assistant', content: 'earlier answer' },
    userMessageForTest('thanks')
  ], function (index) {
    if (index === 0) return callsForTest('s', 'web_search', [{ query: 'one ordinary search query here' }]);
    return answerForTest('You are welcome.');
  }, okToolForTest);
  assert.deepStrictEqual(outcome.requests.map(function (r) { return r.tool_choice; }), [undefined, undefined]);
  assert.ok(outcome.requests.every(function (r) { return r.parallelToolCalls === false; }));
  assert.ok(outcome.requests.every(function (r) { return String(r.lastUserContent).indexOf('<research_mode>') === -1; }));
  assert.deepStrictEqual(outcome.toolContexts.map(function (c) { return c.searchModel; }), ['']);
});

// The Sources list on the final reply marks each page web_fetch read, whatever kind of run it is.
// Fails against the loop before it marked pages read, which saved the three hits with no flag and
// left out the page no search found.
test('the final reply lists every search hit and marks the pages read, including one no search found', async function () {
  const outcome = await runLoopForTest([userMessageForTest('compare tablets')], function (index) {
    if (index === 0) return callsForTest('s', 'web_search', [{ query: 'tablet market share' }]);
    if (index === 1) {
      return callsForTest('f', 'web_fetch', [
        { url: 'https://a.example/read-one' },
        { url: 'https://c.example/read-two/' },
        { url: 'https://b.example/gone' },
        { url: 'https://user.example/given' }
      ]);
    }
    return answerForTest('The answer.');
  }, function (name, args) {
    if (name === 'web_search') {
      return { ok: true, results: [
        { title: 'Read one', url: 'https://a.example/read-one#top' },
        { title: 'Gone', url: 'https://b.example/gone' },
        { title: 'Read two', url: 'https://c.example/read-two' }
      ] };
    }
    if (args.url === 'https://b.example/gone') return { ok: false, error: 'HTTP error: 404 ' };
    if (args.url === 'https://user.example/given') return { ok: true, url: 'https://user.example/given-final', title: 'Given page', content: 'text' };
    return { ok: true, url: args.url, title: 'fetched', content: 'text' };
  });
  const replyForSources = outcome.store[outcome.store.length - 1];
  assert.strictEqual(replyForSources.content, 'The answer.');
  assert.deepStrictEqual(replyForSources.searchSources, [
    { url: 'https://a.example/read-one#top', title: 'Read one', read: true },
    { url: 'https://b.example/gone', title: 'Gone', read: false },
    { url: 'https://c.example/read-two', title: 'Read two', read: true },
    { url: 'https://user.example/given-final', title: 'Given page', read: true }
  ]);
});

// ---------------------------------------------------------------------------
// panel/panelDraftSync.js: the switch is part of the draft
// ---------------------------------------------------------------------------

test('the draft keeps the research switch, and an old draft without it reads as off', function () {
  assert.strictEqual(draftSync.normalizeDraft({ text: 'q', research: true, chips: [] }).research, true);
  assert.strictEqual(draftSync.normalizeDraft({ text: 'q', research: 'true', chips: [] }).research, false);
  assert.strictEqual(draftSync.normalizeDraft({ text: 'q', chips: [] }).research, false);
  assert.notStrictEqual(
    draftSync.serializeDraft({ text: 'q', research: true, chips: [] }),
    draftSync.serializeDraft({ text: 'q', chips: [] })
  );
  assert.strictEqual(
    draftSync.serializeDraft({ text: 'q', research: false, chips: [] }),
    draftSync.serializeDraft({ text: 'q', chips: [] })
  );
});
