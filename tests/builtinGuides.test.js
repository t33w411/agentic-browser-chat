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
// call and blocked the last real generation.
//
// The three tests on the split documents guide were checked against the single guide before the
// split: they fail at once, since builtin-pptx did not exist. Then, in copies of the split code: with
// requires ignored by the read, the first fails because a builtin-pptx read held no shared rules;
// with the gate refusing for one missing guide at a time, as before, the second fails because a
// pptx refusal named only builtin-documents; with eval's format read only from create_document's
// argument, the second fails on the eval cases; and with the per-response record removed, the third
// fails because the second read of the response carried builtin-documents again.

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
  // Fails when edit_document is left out of the documents guide's coversToolCall (checked against that copy).
  const editGateForTest = guidesForTest.gateToolCall('edit_document', { ref_id: 3, edits: [{ op: 'set_text', id: 'p1', text: 'x' }] }, windowForTest);
  assert.ok(editGateForTest && /builtin-documents/.test(editGateForTest.reason));
  assert.ok(guidesForTest.gateToolCall('eval', { code: 'return { __document__: { format: "csv", rows: [[1]] } };' }, windowForTest));

  // eval that builds no file, and tools no guide covers, always run.
  assert.strictEqual(guidesForTest.gateToolCall('eval', { code: 'return 1 + 1;' }, windowForTest), null);
  assert.strictEqual(guidesForTest.gateToolCall('page_read', { mode: 'content' }, windowForTest), null);
  // With no window to check, the call runs rather than being refused on a guess.
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, undefined), null);
});

test('a skill read and an earlier refusal both put the guide in the window', function () {
  const readMessageForTest = toolMessageForTest('a', Object.assign({ result_ref: 41 }, guidesForTest.readResult('builtin-docx-pdf')));
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [readMessageForTest]), null);

  const refusalForTest = guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, []);
  const refusalMessageForTest = toolMessageForTest('b', { guide: refusalForTest.guide, ok: false, error: refusalForTest.reason });
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [refusalMessageForTest]), null);
});

function markersForTest(text) {
  return String(text || '').match(/\[built-in guide: [a-z-]+\]/g) || [];
}

test('a format guide brings the shared rules, and only when the conversation lacks them', function () {
  // A read with nothing in the window holds the shared rules first, then the format's guide.
  const firstReadForTest = guidesForTest.readResult('builtin-pptx', []);
  assert.deepStrictEqual(markersForTest(firstReadForTest.body), ['[built-in guide: builtin-documents]', '[built-in guide: builtin-pptx]']);
  assert.strictEqual(firstReadForTest.note, undefined);
  // So does a read with no window to check, such as a caller outside the agent loop.
  assert.deepStrictEqual(markersForTest(guidesForTest.readResult('builtin-pptx').body), ['[built-in guide: builtin-documents]', '[built-in guide: builtin-pptx]']);

  // A second format later in the chat brings only its own part, and says where the rest is.
  const windowForTest = [toolMessageForTest('r1', firstReadForTest)];
  const secondReadForTest = guidesForTest.readResult('builtin-docx-pdf', windowForTest);
  assert.deepStrictEqual(markersForTest(secondReadForTest.body), ['[built-in guide: builtin-docx-pdf]']);
  assert.ok(/^builtin-documents is already in the conversation/.test(secondReadForTest.note));

  // Reading a guide the chat already holds sends a short note, not the guide again.
  const repeatForTest = guidesForTest.readResult('builtin-pptx', [toolMessageForTest('r1', firstReadForTest)]);
  assert.strictEqual(repeatForTest.body, undefined);
  assert.ok(/^builtin-documents and builtin-pptx are already in the conversation/.test(repeatForTest.note));
  assert.ok(JSON.stringify(repeatForTest).length < 300);

  // A chat that read the guide before the split holds the shared marker, so only the part is sent.
  const oldReadForTest = toolMessageForTest('o', { ok: true, body: '[built-in guide: builtin-documents]\n# Creating and editing documents' });
  assert.deepStrictEqual(markersForTest(guidesForTest.readResult('builtin-xlsx-csv', [oldReadForTest]).body), ['[built-in guide: builtin-xlsx-csv]']);
});

test('a document call waits for the shared rules and the guide for its format', function () {
  const pptxCallForTest = { format: 'pptx', slides: [{ title: 'Hello' }] };
  const refusalForTest = guidesForTest.gateToolCall('create_document', pptxCallForTest, []);
  assert.strictEqual(refusalForTest.reason, 'Not run: create_document needs the builtin-documents and builtin-pptx guides, which were not in the conversation yet. They are in this result\'s guide field; follow them, then make the call again.');
  assert.deepStrictEqual(markersForTest(refusalForTest.guide), ['[built-in guide: builtin-documents]', '[built-in guide: builtin-pptx]']);

  // Each part unlocks its own formats only.
  const docxReadForTest = toolMessageForTest('d', guidesForTest.readResult('builtin-docx-pdf', []));
  assert.strictEqual(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, [docxReadForTest]), null);
  assert.strictEqual(guidesForTest.gateToolCall('create_document', { format: 'pdf', content: 'Hi' }, [docxReadForTest]), null);
  const pptxAfterDocxForTest = guidesForTest.gateToolCall('create_document', pptxCallForTest, [docxReadForTest]);
  assert.ok(/needs the builtin-pptx guide, which was/.test(pptxAfterDocxForTest.reason));
  assert.deepStrictEqual(markersForTest(pptxAfterDocxForTest.guide), ['[built-in guide: builtin-pptx]']);
  const csvGateForTest = guidesForTest.gateToolCall('create_document', { format: 'csv', rows: [[1]] }, [docxReadForTest]);
  assert.ok(/needs the builtin-xlsx-csv guide,/.test(csvGateForTest.reason));
  assert.ok(/needs the builtin-docx-edit guide,/.test(guidesForTest.gateToolCall('read_document_structure', { ref_id: 3 }, [docxReadForTest]).reason));

  // The shared rules alone unlock nothing.
  const sharedOnlyForTest = toolMessageForTest('s', { ok: true, body: '[built-in guide: builtin-documents]\n' + guidesForTest.get('builtin-documents').body });
  assert.ok(/needs the builtin-pptx guide,/.test(guidesForTest.gateToolCall('create_document', pptxCallForTest, [sharedOnlyForTest]).reason));

  // eval code is read for the format it names; an XLSX column format is not a document format.
  const evalXlsxForTest = { code: 'return { __document__: { format: "xlsx", sheets: [{ columns: [{ format: "date" }], rows: [[1]] }] } };' };
  assert.ok(/needs the builtin-documents and builtin-xlsx-csv guides,/.test(guidesForTest.gateToolCall('eval', evalXlsxForTest, []).reason));
  const evalAssignedForTest = { code: 'const spec = {}; spec.format = \'pdf\'; spec.content = "Hi"; return { __document__: spec };' };
  assert.ok(/needs the builtin-documents and builtin-docx-pdf guides,/.test(guidesForTest.gateToolCall('eval', evalAssignedForTest, []).reason));
  // Code that picks the format at run time waits for every format guide, HTML included.
  const evalDynamicForTest = { code: 'const f = vars.kind; return { __document__: { format: f, rows: [[1]] } };' };
  assert.ok(/needs the builtin-documents, builtin-docx-pdf, builtin-xlsx-csv, builtin-pptx, and builtin-html guides,/.test(guidesForTest.gateToolCall('eval', evalDynamicForTest, []).reason));
  assert.strictEqual(guidesForTest.gateToolCall('eval', evalXlsxForTest, [toolMessageForTest('x', guidesForTest.readResult('builtin-xlsx-csv', []))]), null);

  // A create_document call with a format the tool does not take needs only the shared rules, and
  // fails in the tool with its own error.
  assert.ok(/needs the builtin-documents guide,/.test(guidesForTest.gateToolCall('create_document', { format: 'word' }, []).reason));
});

// A PDF of slides is laid out by the PPTX writer, so it needs the PPTX guide's fields. Checked against
// the gate before slide PDFs: create_document with format pdf and slides was covered by
// builtin-docx-pdf alone, so the first assertion fails, and the call with that guide in the window
// ran without the PPTX guide.
test('a PDF of slides waits for the PPTX guide, and a PDF of pages for the DOCX and PDF guide', function () {
  const slidePdfForTest = { format: 'pdf', slides: [{ title: 'Hello', bullets: ['a'] }] };
  assert.ok(/needs the builtin-documents and builtin-pptx guides,/.test(guidesForTest.gateToolCall('create_document', slidePdfForTest, []).reason));
  const docxReadForTest = toolMessageForTest('d', guidesForTest.readResult('builtin-docx-pdf', []));
  assert.ok(/needs the builtin-pptx guide,/.test(guidesForTest.gateToolCall('create_document', slidePdfForTest, [docxReadForTest]).reason));
  const pptxReadForTest = toolMessageForTest('p', guidesForTest.readResult('builtin-pptx', []));
  assert.strictEqual(guidesForTest.gateToolCall('create_document', slidePdfForTest, [pptxReadForTest]), null);
  // also_pdf on a deck needs only the deck's guide.
  assert.strictEqual(guidesForTest.gateToolCall('create_document', { format: 'pptx', also_pdf: true, slides: [{ title: 'A' }] }, [pptxReadForTest]), null);
  // With blocks or html beside the slides, or with no slides, it is a document of pages.
  assert.ok(/needs the builtin-docx-pdf guide,/.test(guidesForTest.gateToolCall('create_document', { format: 'pdf', slides: [{ title: 'A' }], blocks: [] }, [pptxReadForTest]).reason));
  assert.ok(/needs the builtin-docx-pdf guide,/.test(guidesForTest.gateToolCall('create_document', { format: 'pdf', slides: [], content: 'Hi' }, [pptxReadForTest]).reason));
  // eval code that names pdf and builds slides may make either kind, so it waits for both.
  const evalSlidesForTest = { code: 'return { __document__: { format: "pdf", slides: vars.slides } };' };
  assert.ok(/needs the builtin-documents, builtin-docx-pdf, and builtin-pptx guides,/.test(guidesForTest.gateToolCall('eval', evalSlidesForTest, []).reason));
});

test('calls in one response share one copy of each guide', async function () {
  // Two reads in one response see the same window, so only the first carries the shared rules.
  const responseWindowForTest = [{ role: 'user', content: 'a deck and a handout' }];
  const deckReadForTest = guidesForTest.readResult('builtin-pptx', responseWindowForTest);
  const handoutReadForTest = guidesForTest.readResult('builtin-docx-pdf', responseWindowForTest);
  assert.deepStrictEqual(markersForTest(deckReadForTest.body), ['[built-in guide: builtin-documents]', '[built-in guide: builtin-pptx]']);
  assert.deepStrictEqual(markersForTest(handoutReadForTest.body), ['[built-in guide: builtin-docx-pdf]']);

  // Two refused calls in one response: both are refused, and the guide text is sent once.
  const refusalWindowForTest = [];
  const firstForTest = guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, refusalWindowForTest);
  const secondForTest = guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, refusalWindowForTest);
  assert.ok(firstForTest.guide && secondForTest);
  assert.strictEqual(secondForTest.guide, undefined);
  assert.ok(/They are in another result of this response; follow them/.test(secondForTest.reason));

  // The hook passes that on: the second refusal carries no guide field.
  const contextForTest = agentNsForTest.hooks.createTurnContext({ chatId: 2, userText: 'two decks' });
  const hookWindowForTest = [];
  const pptxArgsForTest = { format: 'pptx', slides: [{ title: 'A' }] };
  const hookFirstForTest = await agentNsForTest.hooks.dispatch('PreToolUse', { toolName: 'create_document', args: pptxArgsForTest, messages: hookWindowForTest }, contextForTest);
  const hookSecondForTest = await agentNsForTest.hooks.dispatch('PreToolUse', { toolName: 'create_document', args: pptxArgsForTest, messages: hookWindowForTest }, contextForTest);
  assert.ok(hookFirstForTest.block.result.guide);
  assert.ok(hookSecondForTest.block && !('guide' in hookSecondForTest.block.result));

  // The next iteration builds a new window, so nothing carries over from the last response.
  assert.ok(guidesForTest.gateToolCall('create_document', DOCX_CALL_ARGS_FOR_TEST, []).guide);
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

  // All six slots are still free after the refusal, and the cap still stops the seventh generation.
  const windowForTest = [toolMessageForTest('g', Object.assign({}, refusedForTest.block.result, { ok: false, error: refusedForTest.block.reason }))];
  for (let iForTest = 0; iForTest < 6; iForTest++) {
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
  assert.ok(withToolsForTest.includes('\n- builtin-docx-pdf: '));
  assert.ok(withToolsForTest.includes('\n- builtin-xlsx-csv: '));
  assert.ok(withToolsForTest.includes('\n- builtin-pptx: '));
  assert.ok(withToolsForTest.includes('\n- builtin-docx-edit: '));
  assert.ok(withToolsForTest.includes('\n- builtin-html: '));
  // The shared rules come with each document guide and are never read on their own.
  assert.ok(!withToolsForTest.includes('\n- builtin-documents: '));
  assert.ok(withToolsForTest.includes('\n- builtin-page-layout: '));
  assert.ok(withToolsForTest.includes('\n- builtin-images: '));
  assert.ok(withToolsForTest.includes('\n- builtin-spreadsheets: '));
  const noToolsForTest = (await agentNsForTest.contextBuilder.build([], { toolsAvailable: false }))[0].content;
  assert.ok(!noToolsForTest.includes('builtin-documents'));
  assert.ok(!noToolsForTest.includes('builtin-docx-pdf'));
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
