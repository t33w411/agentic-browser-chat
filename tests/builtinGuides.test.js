// Tests for built-in guides (agent/builtinGuides.js), the PreToolUse gate that refuses a covered
// tool call until its guide is in the live window (agent/hooks/builtin/builtinGuideGate.js), and the
// two context-builder behaviours the guides depend on: the prompt index and the collapse of a
// repeated skill read.
//
// Checked against the code before this change: with the registry not passing block.result through,
// the hook test fails because the refusal carries no guide; with skill missing from the collapsible
// calls, the collapse test fails because the second read is sent in full. With the page layout guide
// removed from the guide list, both page_layout tests and the index test fail, and with the images
// guide removed, both generate_image tests and the index test fail, and with the spreadsheets guide
// removed, the page_spreadsheet test and the index test fail. With the gate back at priority 0,
// the image slot test fails: image-generation-cap loads first, so it counted a slot for each refused
// call and blocked the second real generation.

const test = require('node:test');
const assert = require('node:assert');

const guidesForTest = require('../agent/builtinGuides.js');
require('../agent/hooks/registry.js');
// Same order as manifest.json, background/tabMessaging.js and offscreen/offscreen.html, since hooks
// of equal priority run in the order they were registered.
require('../agent/hooks/builtin/imageGenerationCap.js');
require('../agent/hooks/builtin/builtinGuideGate.js');
require('../agent/contextBuilder.js');

const agentNsForTest = globalThis.ABChatAgent;
const DOCX_CALL_ARGS_FOR_TEST = { format: 'docx', blocks: [{ type: 'paragraph', text: 'Hello' }] };

function toolMessageForTest(callId, payload) {
  return { role: 'tool', tool_call_id: callId, content: typeof payload === 'string' ? payload : JSON.stringify(payload) };
}

function toolCallMessageForTest(callId, name, args) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: callId, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }]
  };
}

test('a guide read returns the body behind its marker, and slugs are matched loosely', function () {
  const readForTest = guidesForTest.readResult('/Builtin-Documents');
  assert.ok(readForTest && readForTest.ok && readForTest.builtin);
  assert.strictEqual(readForTest.slug, 'builtin-documents');
  assert.ok(readForTest.body.startsWith('[built-in guide: builtin-documents]\n'));
  assert.strictEqual(guidesForTest.readResult('builtin-nope'), null);
  assert.strictEqual(guidesForTest.readResult('my-skill'), null);
});

test('only the builtin- prefix is reserved', function () {
  assert.ok(guidesForTest.isReservedSlug('builtin-anything'));
  assert.ok(guidesForTest.isReservedSlug(' /BUILTIN-x'));
  assert.ok(!guidesForTest.isReservedSlug('my-builtin-notes'));
  assert.ok(!guidesForTest.isReservedSlug(''));
});

test('covered calls are refused until the guide is in the window', function () {
  const windowForTest = [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'make me a report' }];
  const gateForTest = guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, windowForTest);
  assert.ok(gateForTest && /^Not run: create_document/.test(gateForTest.reason));
  assert.ok(gateForTest.guide.startsWith('[built-in guide: builtin-documents]'));
  assert.ok(guidesForTest.gateToolCall('read_document_structure', { ref_id: 3 }, windowForTest));
  assert.ok(guidesForTest.gateToolCall('eval', { code: 'return { __document__: { format: "csv", rows: [[1]] } };' }, windowForTest));

  // eval that builds no file, and tools no guide covers, always run.
  assert.strictEqual(guidesForTest.gateToolCall('eval', { code: 'return 1 + 1;' }, windowForTest), null);
  assert.strictEqual(guidesForTest.gateToolCall('page_read', { mode: 'content' }, windowForTest), null);
  // With no window to check, the call runs rather than being refused on a guess.
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, undefined), null);
});

test('a skill read and an earlier refusal both put the guide in the window', function () {
  const readMessageForTest = toolMessageForTest('a', Object.assign({ result_ref: 41 }, guidesForTest.readResult('builtin-documents')));
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [readMessageForTest]), null);

  const refusalForTest = guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, []);
  const refusalMessageForTest = toolMessageForTest('b', { guide: refusalForTest.guide, ok: false, error: refusalForTest.reason });
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [refusalMessageForTest]), null);
});

test('page_layout scan and apply wait for their guide, undo and reset do not', function () {
  const scanGateForTest = guidesForTest.gateToolCall('page_layout', { operation: 'scan' }, []);
  assert.ok(scanGateForTest && /builtin-page-layout/.test(scanGateForTest.reason));
  assert.ok(scanGateForTest.guide.startsWith('[built-in guide: builtin-page-layout]'));
  assert.ok(guidesForTest.gateToolCall('page_layout', { operation: 'APPLY', changes: [] }, []));
  assert.strictEqual(guidesForTest.gateToolCall('page_layout', { operation: 'undo' }, []), null);
  assert.strictEqual(guidesForTest.gateToolCall('page_layout', { operation: 'reset' }, []), null);

  const layoutReadForTest = toolMessageForTest('p', guidesForTest.readResult('builtin-page-layout'));
  assert.strictEqual(guidesForTest.gateToolCall('page_layout', { operation: 'scan' }, [layoutReadForTest]), null);
});

test('every generate_image call waits for the images guide', function () {
  const newImageForTest = { prompt: 'A lighthouse at dusk', aspect_ratio: '16:9' };
  const imageGateForTest = guidesForTest.gateToolCall('generate_image', newImageForTest, []);
  assert.ok(imageGateForTest && /builtin-images/.test(imageGateForTest.reason));
  assert.ok(imageGateForTest.guide.startsWith('[built-in guide: builtin-images]'));
  assert.ok(guidesForTest.gateToolCall('generate_image', { prompt: 'Bluer', source_blob_id: 57, aspect_ratio: '1:1' }, []));

  const imagesReadForTest = toolMessageForTest('i', guidesForTest.readResult('builtin-images'));
  assert.strictEqual(guidesForTest.gateToolCall('generate_image', newImageForTest, [imagesReadForTest]), null);
});

test('every page_spreadsheet intent waits for the spreadsheets guide, reads included', function () {
  const readGateForTest = guidesForTest.gateToolCall('page_spreadsheet', { intent: 'read_range', range: 'A1:C3' }, []);
  assert.ok(readGateForTest && /builtin-spreadsheets/.test(readGateForTest.reason));
  assert.ok(readGateForTest.guide.startsWith('[built-in guide: builtin-spreadsheets]'));
  assert.ok(guidesForTest.gateToolCall('page_spreadsheet', { intent: 'set_cell', cell: 'B2', value: '42' }, []));
  assert.ok(guidesForTest.gateToolCall('page_spreadsheet', { intent: 'set_range', anchor: 'A2', values: ['a'] }, []));

  const sheetsReadForTest = toolMessageForTest('s', guidesForTest.readResult('builtin-spreadsheets'));
  assert.strictEqual(guidesForTest.gateToolCall('page_spreadsheet', { intent: 'read_range', cell: 'B2' }, [sheetsReadForTest]), null);
  // page_act on the same sheet (menus, sheet tabs) is not covered.
  assert.strictEqual(guidesForTest.gateToolCall('page_act', { ref: 4, action: 'click' }, []), null);
});

test('each guide unlocks only its own tools', function () {
  const documentsReadForTest = toolMessageForTest('d', guidesForTest.readResult('builtin-documents'));
  const layoutReadForTest = toolMessageForTest('p', guidesForTest.readResult('builtin-page-layout'));
  assert.ok(guidesForTest.gateToolCall('page_layout', { operation: 'scan' }, [documentsReadForTest]));
  assert.ok(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [layoutReadForTest]));
  assert.ok(guidesForTest.gateToolCall('generate_image', { prompt: 'A cat', aspect_ratio: '1:1' }, [documentsReadForTest, layoutReadForTest]));
});

test('the marker counts only inside a tool result', function () {
  const pastedForTest = { role: 'user', content: 'I pasted [built-in guide: builtin-documents] here' };
  assert.ok(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [pastedForTest]));
});

test('the PreToolUse hook refuses with the guide attached and lets the retry through', async function () {
  const contextForTest = agentNsForTest.hooks.createTurnContext({ chatId: 1, userText: 'make a docx' });
  const blockedForTest = await agentNsForTest.hooks.dispatch('PreToolUse', {
    toolName: 'create_document', args: DOCX_CALL_ARGS_FOR_TEST, messages: []
  }, contextForTest);
  assert.ok(blockedForTest.block);
  assert.strictEqual(blockedForTest.block.code, 'builtin-guide-required');
  assert.ok(blockedForTest.block.result && blockedForTest.block.result.guide.startsWith('[built-in guide: builtin-documents]'));

  // What the agent loop persists for the refused call: block.result plus ok and error.
  const persistedForTest = toolMessageForTest('c', Object.assign({}, blockedForTest.block.result, { ok: false, error: blockedForTest.block.reason }));
  const retryForTest = await agentNsForTest.hooks.dispatch('PreToolUse', {
    toolName: 'create_document', args: DOCX_CALL_ARGS_FOR_TEST, messages: [persistedForTest]
  }, contextForTest);
  assert.strictEqual(retryForTest.block, null);
});

test('a generate_image call refused for its guide does not use up an image slot', async function () {
  const contextForTest = agentNsForTest.hooks.createTurnContext({ chatId: 1, userText: 'draw a cat' });
  const argsForTest = { prompt: 'A cat', aspect_ratio: '1:1' };
  const refusedForTest = await agentNsForTest.hooks.dispatch('PreToolUse', {
    toolName: 'generate_image', args: argsForTest, messages: []
  }, contextForTest);
  assert.strictEqual(refusedForTest.block && refusedForTest.block.code, 'builtin-guide-required');

  // Both slots are still free after the refusal, and the cap still stops the third generation.
  const windowForTest = [toolMessageForTest('g', Object.assign({}, refusedForTest.block.result, { ok: false, error: refusedForTest.block.reason }))];
  for (let iForTest = 0; iForTest < 2; iForTest++) {
    const allowedForTest = await agentNsForTest.hooks.dispatch('PreToolUse', {
      toolName: 'generate_image', args: argsForTest, messages: windowForTest
    }, contextForTest);
    assert.strictEqual(allowedForTest.block, null);
  }
  const cappedForTest = await agentNsForTest.hooks.dispatch('PreToolUse', {
    toolName: 'generate_image', args: argsForTest, messages: windowForTest
  }, contextForTest);
  assert.ok(cappedForTest.block && /image generations per send/.test(cappedForTest.block.reason));
});

test('the system prompt lists guides only for a caller with tools', async function () {
  const withToolsForTest = (await agentNsForTest.contextBuilder.build([], {}))[0].content;
  assert.ok(withToolsForTest.includes('\n- builtin-documents: '));
  assert.ok(withToolsForTest.includes('\n- builtin-page-layout: '));
  assert.ok(withToolsForTest.includes('\n- builtin-images: '));
  assert.ok(withToolsForTest.includes('\n- builtin-spreadsheets: '));
  const noToolsForTest = (await agentNsForTest.contextBuilder.build([], { toolsAvailable: false }))[0].content;
  assert.ok(!noToolsForTest.includes('builtin-documents'));
  assert.ok(!noToolsForTest.includes('builtin-page-layout'));
  assert.ok(!noToolsForTest.includes('builtin-images'));
  assert.ok(!noToolsForTest.includes('builtin-spreadsheets'));
});

test('a repeated guide read is collapsed and a repeated skill create is not', async function () {
  const guideJsonForTest = JSON.stringify(guidesForTest.readResult('builtin-documents'));
  const createJsonForTest = JSON.stringify({ ok: true, operation: 'create', id: 5, slug: 'long', title: 'T'.repeat(400) });
  const createArgsForTest = { operation: 'create', slug: 'long', title: 'T'.repeat(400), body: 'Step 1.' };
  const messagesForTest = [
    toolCallMessageForTest('r1', 'skill', { operation: 'read', slug: 'builtin-documents' }),
    toolMessageForTest('r1', guideJsonForTest),
    toolCallMessageForTest('r2', 'skill', { operation: 'read', slug: 'builtin-documents' }),
    toolMessageForTest('r2', guideJsonForTest),
    toolCallMessageForTest('w1', 'skill', createArgsForTest),
    toolMessageForTest('w1', createJsonForTest),
    toolCallMessageForTest('w2', 'skill', createArgsForTest),
    toolMessageForTest('w2', createJsonForTest)
  ];
  const toolResultsForTest = (await agentNsForTest.contextBuilder.build(messagesForTest, {}))
    .filter(function (messageForFilter) { return messageForFilter.role === 'tool'; });

  assert.strictEqual(toolResultsForTest[0].content, guideJsonForTest);
  assert.ok(/identical to your most recent earlier skill \(builtin-documents\) call/.test(toolResultsForTest[1].content));
  assert.ok(toolResultsForTest[1].content.length < 400);
  assert.strictEqual(toolResultsForTest[2].content, createJsonForTest);
  assert.strictEqual(toolResultsForTest[3].content, createJsonForTest);
});
