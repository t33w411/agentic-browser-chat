// HTML files: create_document with format "html" (agent/documentGeneration.js and the tool in
// agent/toolExec.js), changing a saved HTML file with edit and type "attachment", the edits array
// on edit, and the context builder leaving out a page that a later call made again under the same
// name (agent/contextBuilder.js).
//
// Checked against the code before this change: every test fails except two that pin arguments
// which must be sent whole, the latest version of a page and an earlier one after a failed remake
// or under the minimum. The old code sent every argument whole, so both pass there, as they should.
// create_document refused format "html", edit had no attachment type or edits array, and the gate
// asked for builtin-documents. The latest-version test was checked against the first version of
// this change, which replaced every saved page's argument: it fails there, since the single page
// was sent as a note. In copies of the new code, with the note written
// into the stored tool call instead of a copy, the remade-page test fails on the stored message;
// with the note applied whatever the later result said, the failed-remake test fails.

const test = require('node:test');
const assert = require('node:assert');

require('../agent/tools.js');
require('../agent/documentGeneration.js');
require('../agent/toolExec.js');
require('../agent/builtinGuides.js');
require('../agent/contextBuilder.js');

const agentNsForTest = globalThis.ABChatAgent;

function decodeDataUrlForTest(dataUrlForDecode) {
  return Buffer.from(String(dataUrlForDecode).split(',')[1], 'base64').toString('utf8');
}

function createHtmlForTest(args) {
  return agentNsForTest.executeTool('create_document', Object.assign({ format: 'html' }, args), {});
}

// A store holding attachment blobs and notes, enough for read, edit and their checks.
function installRepoForTest(blobsForRepo, notesForRepo) {
  const stateForRepo = { noteUpdates: [] };
  globalThis.ABChatShared = {
    panelDataRepo: {
      getAttachmentBlob: async function (idForGet) { return blobsForRepo[Number(idForGet)] || null; },
      getNote: async function (idForGet) { return (notesForRepo || {})[Number(idForGet)] || null; },
      updateNote: async function (idForUpdate, patchForUpdate) {
        stateForRepo.noteUpdates.push({ id: idForUpdate, patch: patchForUpdate });
        const noteForUpdate = notesForRepo[Number(idForUpdate)];
        if (noteForUpdate && typeof patchForUpdate.body === 'string') noteForUpdate.body = patchForUpdate.body;
        return noteForUpdate;
      }
    }
  };
  return stateForRepo;
}

const PAGE_FOR_TEST = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Tip calculator</title>\n</head>\n<body>\n<h1>Tip calculator</h1>\n<button id="go">Work it out</button>\n<p class="total">Total: 0</p>\n<p class="total">Each: 0</p>\n<script>document.getElementById("go").addEventListener("click", function () {});</script>\n</body>\n</html>';

test('an HTML file is the page as written, saved as UTF-8 with its source and a rev', async function () {
  const resultForTest = await createHtmlForTest({ filename: 'tip calculator', html: PAGE_FOR_TEST });
  assert.strictEqual(resultForTest.ok, true);
  assert.strictEqual(resultForTest.format, 'html');
  assert.strictEqual(resultForTest.filename, 'tip calculator.html');
  assert.strictEqual(resultForTest.mimeType, 'text/html;charset=utf-8');
  assert.strictEqual(resultForTest.textContent, PAGE_FOR_TEST);
  assert.strictEqual(decodeDataUrlForTest(resultForTest.dataUrl), PAGE_FOR_TEST);
  assert.strictEqual(resultForTest.size, Buffer.byteLength(PAGE_FOR_TEST, 'utf8'));
  assert.strictEqual(resultForTest.warnings, undefined);
  assert.strictEqual(resultForTest.theme, undefined);
  assert.ok(/^[0-9a-f]+$/.test(resultForTest.rev));

  // The rev is the one a read of the saved file returns, so edit can use it straight away.
  installRepoForTest({ 12: { name: resultForTest.filename, mimeType: resultForTest.mimeType, textContent: resultForTest.textContent } });
  const readForTest = await agentNsForTest.executeTool('read', { type: 'attachment', id: 12 }, {});
  assert.strictEqual(readForTest.rev, resultForTest.rev);

  // A theme and other office fields are ignored without a warning, as for CSV, and .htm is kept.
  const themedForTest = await createHtmlForTest({ filename: 'old.htm', html: PAGE_FOR_TEST, theme: 'vibrant', page: { size: 'a4' } });
  assert.strictEqual(themedForTest.filename, 'old.htm');
  assert.strictEqual(themedForTest.warnings, undefined);
  assert.strictEqual(themedForTest.textContent, PAGE_FOR_TEST);
});

test('a page without a doctype or a UTF-8 charset near the top is repaired, with a warning for each', async function () {
  const bareForTest = await createHtmlForTest({ html: '<html><head><title>x</title></head><body>café ✓</body></html>' });
  assert.ok(bareForTest.textContent.startsWith('<!DOCTYPE html>\n<html><head>\n<meta charset="utf-8"><title>'));
  assert.strictEqual(decodeDataUrlForTest(bareForTest.dataUrl), bareForTest.textContent);
  assert.ok(decodeDataUrlForTest(bareForTest.dataUrl).includes('café ✓'));
  assert.strictEqual(bareForTest.filename, 'generated-document.html');
  assert.strictEqual(bareForTest.warnings.length, 2);
  assert.ok(/no <!DOCTYPE html>/.test(bareForTest.warnings[0]));
  assert.ok(/did not declare its character set/.test(bareForTest.warnings[1]));

  // Another charset is changed to utf-8, since the bytes are UTF-8.
  const latinForTest = await createHtmlForTest({ html: '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"></head></html>' });
  assert.ok(latinForTest.textContent.includes('charset=utf-8"'));
  assert.ok(/declared the character set "ISO-8859-1"/.test(latinForTest.warnings[0]));

  // A declaration past the first 1024 bytes is not read by a browser, so one is added near the top.
  const lateForTest = await createHtmlForTest({ html: '<!DOCTYPE html><html><head><style>' + 'b{}'.repeat(400) + '</style><meta charset="utf-8"></head></html>' });
  assert.ok(lateForTest.textContent.startsWith('<!DOCTYPE html><html><head>\n<meta charset="utf-8"><style>'));
  assert.ok(/too far down/.test(lateForTest.warnings[0]));
});

test('a missing page and a page over the limit are refused, never cut', async function () {
  const missingForTest = await createHtmlForTest({ content: 'A calculator' });
  assert.strictEqual(missingForTest.ok, false);
  assert.ok(/requires html/.test(missingForTest.error));

  const hugeForTest = await createHtmlForTest({ html: '<!DOCTYPE html>' + 'x'.repeat(1000000) });
  assert.strictEqual(hugeForTest.ok, false);
  assert.ok(/over the 1,000,000/.test(hugeForTest.error));
  assert.strictEqual(hugeForTest.dataUrl, undefined);

  // eval's __document__ goes straight to the generator, which makes the same check.
  await assert.rejects(agentNsForTest.documentGeneration.createDocument({ format: 'html', html: '  ' }, {}), /needs html/);
});

test('edit changes an HTML file into a new copy and leaves the source blob alone', async function () {
  const sourceBlobForTest = { name: 'tips.html', mimeType: 'text/html;charset=utf-8', textContent: PAGE_FOR_TEST, dataUrl: 'data:text/html;base64,AAAA' };
  installRepoForTest({ 12: sourceBlobForTest });
  const createdForTest = await createHtmlForTest({ html: PAGE_FOR_TEST });

  const editedForTest = await agentNsForTest.executeTool('edit', {
    type: 'attachment', id: 12, rev: createdForTest.rev,
    edits: [
      { old_string: 'Work it out', new_string: 'Calculate' },
      { old_string: 'Total: 0', new_string: 'Total: $0' },
      { old_string: ': 0<', new_string: ': $0<' }
    ]
  }, {});
  assert.strictEqual(editedForTest.ok, true, editedForTest.error);
  const expectedForTest = PAGE_FOR_TEST.replace('Work it out', 'Calculate').replace('Total: 0', 'Total: $0').replace('Each: 0<', 'Each: $0<');
  assert.strictEqual(editedForTest.textContent, expectedForTest);
  assert.strictEqual(decodeDataUrlForTest(editedForTest.dataUrl), expectedForTest);
  assert.strictEqual(editedForTest.filename, 'tips.html');
  assert.strictEqual(editedForTest.format, 'html');
  assert.strictEqual(editedForTest.mimeType, 'text/html;charset=utf-8');
  assert.notStrictEqual(editedForTest.rev, createdForTest.rev);
  assert.ok(/3 changes/.test(editedForTest.note));
  // The source blob is never rewritten: a message, note or clip may point at it too.
  assert.strictEqual(sourceBlobForTest.textContent, PAGE_FOR_TEST);

  // The new rev is the one a read of the new copy returns.
  installRepoForTest({ 13: { name: 'tips.html', mimeType: 'text/html', textContent: editedForTest.textContent } });
  const rereadForTest = await agentNsForTest.executeTool('read', { type: 'attachment', id: 13 }, {});
  assert.strictEqual(rereadForTest.rev, editedForTest.rev);
});

test('an HTML edit is refused for a stale rev, a failing pair, a cut file, or another format', async function () {
  const blobsForTest = {
    12: { name: 'tips.html', mimeType: 'text/html', textContent: PAGE_FOR_TEST },
    14: { name: 'cut.html', mimeType: 'text/html', textContent: PAGE_FOR_TEST, truncated: true },
    15: { name: 'cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', textContent: 'Jane Doe' },
    16: { name: 'data.csv', mimeType: 'text/csv', textContent: 'a,b' }
  };
  installRepoForTest(blobsForTest);
  const goodRevForTest = (await createHtmlForTest({ html: PAGE_FOR_TEST })).rev;

  const staleForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 12, rev: 'abc', old_string: 'Calculate', new_string: 'Go' }, {});
  assert.ok(/^Stale rev: blob id 12/.test(staleForTest.error));

  // All or nothing: the second pair fails, so nothing is made, and the error names it.
  const partForTest = await agentNsForTest.executeTool('edit', {
    type: 'attachment', id: 12, rev: goodRevForTest,
    edits: [{ old_string: 'Work it out', new_string: 'Go' }, { old_string: 'Total: 0', new_string: 'x' }, { old_string: 'nowhere', new_string: 'y' }]
  }, {});
  assert.strictEqual(partForTest.ok, false);
  assert.strictEqual(partForTest.dataUrl, undefined);
  assert.strictEqual(partForTest.error, 'edits[2]: old_string not found in content (as left by the edits before it)');

  const ambiguousForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 12, rev: goodRevForTest, old_string: '<p class="total">', new_string: '<p>' }, {});
  assert.strictEqual(ambiguousForTest.error, 'old_string matches 2 locations. Set replace_all: true or provide a more specific string.');

  const cutForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 14, rev: goodRevForTest, old_string: 'Work', new_string: 'Go' }, {});
  assert.ok(/cut short when it was attached/.test(cutForTest.error));
  const docxForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 15, rev: 'x', old_string: 'Jane', new_string: 'J' }, {});
  assert.ok(/Only HTML files.*edit_document/.test(docxForTest.error));
  const csvForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 16, rev: 'x', old_string: 'a', new_string: 'c' }, {});
  assert.ok(/Only HTML files.*create_document/.test(csvForTest.error));
  const missingForTest = await agentNsForTest.executeTool('edit', { type: 'attachment', id: 99, rev: 'x', old_string: 'a', new_string: 'c' }, {});
  assert.strictEqual(missingForTest.error, 'Attachment not found: blob id 99');
});

test('edits works on notes too, in order and in one save, and the single pair behaves as before', async function () {
  const notesForTest = { 3: { id: 3, title: 'Plan', body: 'one two three' } };
  const stateForTest = installRepoForTest({}, notesForTest);
  const readForTest = await agentNsForTest.executeTool('read', { type: 'note', id: 3 }, {});

  const editedForTest = await agentNsForTest.executeTool('edit', {
    type: 'note', id: 3, rev: readForTest.rev, old_string: '', new_string: '',
    edits: [{ old_string: 'one', new_string: '1' }, { old_string: '1 two', new_string: '1 2' }]
  }, {});
  assert.strictEqual(editedForTest.ok, true, editedForTest.error);
  assert.strictEqual(notesForTest[3].body, '1 2 three');
  assert.strictEqual(stateForTest.noteUpdates.length, 1);

  const bothForTest = await agentNsForTest.executeTool('edit', {
    type: 'note', id: 3, rev: editedForTest.rev, old_string: 'three', new_string: '3', edits: [{ old_string: '2', new_string: 'two' }]
  }, {});
  assert.strictEqual(bothForTest.error, 'Use either old_string and new_string, or edits, not both.');

  const notFoundForTest = await agentNsForTest.executeTool('edit', { type: 'note', id: 3, rev: editedForTest.rev, old_string: 'four', new_string: '4' }, {});
  assert.strictEqual(notFoundForTest.error, 'old_string not found in content');
  const emptyForTest = await agentNsForTest.executeTool('edit', { type: 'note', id: 3, rev: editedForTest.rev, old_string: '', new_string: 'x' }, {});
  assert.strictEqual(emptyForTest.error, 'old_string cannot be empty; provide the exact text you want to replace');
  const malformedForTest = await agentNsForTest.executeTool('edit', {
    type: 'note', id: 3, rev: editedForTest.rev, edits: [{ old_string: 'three', new_string: '3' }, { old_string: 'x' }]
  }, {});
  assert.strictEqual(malformedForTest.error, 'edits[1]: new_string is required when old_string is provided; use an empty string to delete the matched text');
  assert.strictEqual(stateForTest.noteUpdates.length, 1);
});

// grep with type "attachment". In a real chat, asked to change an earlier version, the model ran
// grep over notes twice (grep took no files), then read 200 lines of the page, about 5K tokens kept
// in every later request, to change one CSS rule. Checked against the code before grep took files:
// every test below fails there with Unknown type "attachment". In copies of the new code, cutting
// a long line from its start instead of around the match fails the window test, and dropping the
// byte ceiling fails the size test.
test('grep finds the lines to change in one file and gives the rev edit needs', async function () {
  const madeForTest = await createHtmlForTest({ filename: 'tips', html: PAGE_FOR_TEST });
  installRepoForTest({ 12: { id: 12, name: madeForTest.filename, mimeType: madeForTest.mimeType, dataUrl: madeForTest.dataUrl, textContent: madeForTest.textContent } });
  const headingLineForTest = madeForTest.textContent.split('\n').indexOf('<h1>Tip calculator</h1>') + 1;

  const foundForTest = await agentNsForTest.executeTool('grep', { type: 'attachment', id: 12, pattern: '<h1>', context_lines: 1 }, {});
  assert.strictEqual(foundForTest.ok, true);
  assert.strictEqual(foundForTest.rev, madeForTest.rev);
  assert.strictEqual(foundForTest.total_lines, 1);
  const matchForTest = foundForTest.matches[0];
  assert.deepStrictEqual([matchForTest.id, matchForTest.type, matchForTest.title], [12, 'attachment', 'tips.html']);
  assert.deepStrictEqual(matchForTest.lines[0].ln, headingLineForTest);
  assert.strictEqual(matchForTest.lines[0].lc, '<h1>Tip calculator</h1>');
  assert.deepStrictEqual(matchForTest.lines[0].context_before, [{ ln: headingLineForTest - 1, lc: '<body>' }]);

  // The grep is enough to make the change: its line and rev go straight into edit.
  const editedForTest = await agentNsForTest.executeTool('edit', {
    type: 'attachment', id: 12, rev: foundForTest.rev, old_string: matchForTest.lines[0].lc, new_string: '<h1>Tips</h1>'
  }, {});
  assert.strictEqual(editedForTest.ok, true);
  assert.ok(editedForTest.textContent.includes('<h1>Tips</h1>'));

  const countedForTest = await agentNsForTest.executeTool('grep', { type: 'attachment', id: 12, pattern: 'class="total"', output_mode: 'items_with_matches' }, {});
  assert.deepStrictEqual(countedForTest.items, [{ id: 12, type: 'attachment', title: 'tips.html', match_count: 2 }]);
  assert.strictEqual(countedForTest.rev, madeForTest.rev);
});

test('a file grep is refused without an id, in title scope, for an image, or for a blob with no text', async function () {
  installRepoForTest({
    5: { id: 5, name: 'photo.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    6: { id: 6, name: 'empty.html', mimeType: 'text/html', textContent: '' }
  });
  async function grepErrorForTest(argsForGrep) {
    const resultForGrep = await agentNsForTest.executeTool('grep', Object.assign({ pattern: 'a' }, argsForGrep), {});
    assert.strictEqual(resultForGrep.ok, false);
    return resultForGrep.error;
  }
  assert.match(await grepErrorForTest({ type: 'attachment' }), /^id is required for type "attachment"/);
  assert.match(await grepErrorForTest({ type: 'attachment', id: 5, scope: 'title' }), /works only in content scope/);
  assert.match(await grepErrorForTest({ type: 'attachment', id: 5 }), /^Blob id 5 is an image/);
  assert.match(await grepErrorForTest({ type: 'attachment', id: 6 }), /^Blob id 6 has no stored text/);
  assert.match(await grepErrorForTest({ type: 'attachment', id: 99 }), /^Attachment not found: blob id 99/);
  assert.match(await grepErrorForTest({ type: 'file' }), /valid values are: note, chat, task, question, attachment$/);
});

test('a file grep keeps to read\'s limits: a long line comes back around its match, and the result stops at 200 KB', async function () {
  const longLineForTest = 'x'.repeat(9000) + 'NEEDLE' + 'y'.repeat(1000);
  const manyRowsForTest = Array.from({ length: 30000 }, function (unusedForRow, iForRow) { return 'row ' + iForRow + ' ' + 'z'.repeat(20); }).join('\n');
  installRepoForTest({
    7: { id: 7, name: 'one-line.html', mimeType: 'text/html', textContent: longLineForTest },
    8: { id: 8, name: 'rows.html', mimeType: 'text/html', textContent: manyRowsForTest }
  });

  const windowForTest = (await agentNsForTest.executeTool('grep', { type: 'attachment', id: 7, pattern: 'NEEDLE' }, {})).matches[0].lines[0];
  assert.strictEqual(windowForTest.lc.length, 2000);
  assert.ok(windowForTest.lc.includes('NEEDLE'));
  assert.deepStrictEqual([windowForTest.lc_truncated, windowForTest.lc_len], [true, longLineForTest.length]);

  const cappedForTest = await agentNsForTest.executeTool('grep', { type: 'attachment', id: 8, pattern: '^row' }, {});
  assert.strictEqual(cappedForTest.truncated, true);
  assert.ok(cappedForTest.total_lines > 1000 && cappedForTest.total_lines < 30000);
  assert.match(cappedForTest.note, /^More lines matched than fit in one result, so it stops at line \d+\. Use a narrower pattern or set limit\.$/);
  assert.ok(JSON.stringify(cappedForTest).length < 512000, 'stays under the agent loop\'s limit for a tool result');

  const limitedForTest = await agentNsForTest.executeTool('grep', { type: 'attachment', id: 8, pattern: '^row', limit: 5 }, {});
  assert.strictEqual(limitedForTest.total_lines, 5);
  assert.strictEqual(limitedForTest.truncated, undefined);
});

const LONG_PAGE_FOR_TEST = PAGE_FOR_TEST + '<!--' + 'x'.repeat(5000) + '-->';

function createCallMessageForTest(idForMessage, callIdForMessage, argsForCall) {
  return {
    id: idForMessage, role: 'assistant', content: '',
    tool_calls: [{ id: callIdForMessage, type: 'function', function: { name: 'create_document', arguments: JSON.stringify(argsForCall) } }]
  };
}

function savedResultMessageForTest(idForMessage, callIdForMessage, resultForMessage) {
  return { id: idForMessage, role: 'tool', tool_call_id: callIdForMessage, content: JSON.stringify(resultForMessage) };
}

// Each html argument as sent, in call order.
function sentHtmlArgsForTest(apiMessagesForSent) {
  const sentForTest = [];
  apiMessagesForSent.forEach(function (messageForSent) {
    (messageForSent.tool_calls || []).forEach(function (callForSent) {
      sentForTest.push(JSON.parse(callForSent.function.arguments).html);
    });
  });
  return sentForTest;
}

// The page made in the transcript that showed the problem: one create_document call, then the
// reply. With the latest version left out, the model took the note for a placeholder it had sent
// and read the whole file back.
test('the latest version of a page stays whole in every later request', async function () {
  const messagesForTest = [
    { id: 1, role: 'user', content: 'Give me a tip calculator as an HTML file' },
    createCallMessageForTest(2, 'c1', { format: 'html', filename: 'tip-calculator', html: LONG_PAGE_FOR_TEST }),
    savedResultMessageForTest(3, 'c1', { ok: true, format: 'html', filename: 'tip-calculator.html', size: 6000, rev: 'ab12' }),
    { id: 4, role: 'assistant', content: '', md: '[tip-calculator.html](#abchat-docblob-272)', displayOnly: true, tool_call_id: 'c1' },
    { id: 5, role: 'assistant', content: 'Here it is.' },
    { id: 6, role: 'user', content: 'Make the button green' }
  ];
  const apiMessagesForTest = await agentNsForTest.contextBuilder.build(messagesForTest, {});
  assert.deepStrictEqual(sentHtmlArgsForTest(apiMessagesForTest), [LONG_PAGE_FOR_TEST]);
});

test('a page made again under the same name leaves the earlier version out, and the stored message keeps it', async function () {
  const newerPageForTest = LONG_PAGE_FOR_TEST.replace('Tip calculator</title>', 'Tip calculator v2</title>');
  const messagesForTest = [
    { id: 1, role: 'user', content: 'Make a tip calculator and a currency converter' },
    createCallMessageForTest(2, 'c1', { format: 'html', filename: 'tips', html: LONG_PAGE_FOR_TEST }),
    savedResultMessageForTest(3, 'c1', { ok: true, format: 'html', filename: 'tips.html', size: 6000 }),
    createCallMessageForTest(4, 'c2', { format: 'html', filename: 'converter', html: LONG_PAGE_FOR_TEST }),
    savedResultMessageForTest(5, 'c2', { ok: true, format: 'html', filename: 'converter.html', size: 6000 }),
    createCallMessageForTest(6, 'c3', { format: 'docx', content: 'x'.repeat(2000) }),
    savedResultMessageForTest(7, 'c3', { ok: true, format: 'docx', filename: 'x.docx', size: 10 }),
    { id: 8, role: 'user', content: 'Redo the tip calculator' },
    createCallMessageForTest(9, 'c4', { format: 'html', filename: 'Tips.html', html: newerPageForTest }),
    savedResultMessageForTest(10, 'c4', { ok: true, format: 'html', filename: 'Tips.html', size: 6000 })
  ];
  const storedArgumentsForTest = messagesForTest[1].tool_calls[0].function.arguments;
  const apiMessagesForTest = await agentNsForTest.contextBuilder.build(messagesForTest, {});
  const sentForTest = sentHtmlArgsForTest(apiMessagesForTest);

  // The first tips page is replaced by the note; the converter, the docx and the newer page are not.
  // The note says the version is still saved and how to read it. Checked against the note before
  // that clause was added, which said only that a later call had the newer page: this fails there.
  assert.ok(sentForTest[0].startsWith('[An earlier version of this page (' + LONG_PAGE_FOR_TEST.length.toLocaleString('en-US') + ' characters)'));
  assert.ok(sentForTest[0].includes('This version is still saved, and so is each copy an edit made of it.'));
  assert.ok(sentForTest[0].includes('search it with grep or read it with read, type "attachment", and the blob id in the link in its call\'s result.]'));
  assert.strictEqual(sentForTest[1], LONG_PAGE_FOR_TEST);
  assert.strictEqual(sentForTest[2], undefined);
  assert.strictEqual(sentForTest[3], newerPageForTest);
  const firstCallForTest = apiMessagesForTest.find(function (m) { return m.tool_calls && m.tool_calls[0].id === 'c1'; });
  assert.strictEqual(JSON.parse(firstCallForTest.tool_calls[0].function.arguments).filename, 'tips');
  // The persisted record still holds the whole page.
  assert.strictEqual(messagesForTest[1].tool_calls[0].function.arguments, storedArgumentsForTest);
  assert.strictEqual(JSON.parse(storedArgumentsForTest).html, LONG_PAGE_FOR_TEST);
});

// The sequence from a real chat: make a page, change it with edit, then make it again under the
// same name. The edit's result is also an ok HTML file of that name, but the model edits from the
// create_document call plus its edits, so an edit must not count as a remake. Checked against a
// copy of this code that counted every ok HTML result: it left the first page out as soon as the
// edit landed, which is the placeholder confusion again.
test('an edit between two makes of a page is not a remake, and the edit call is kept', async function () {
  const newerPageForTest = LONG_PAGE_FOR_TEST.replace('Tip calculator</title>', 'Tip calculator v2</title>');
  const editArgumentsForTest = JSON.stringify({
    type: 'attachment', id: 277, rev: 'aa', old_string: '--accent: #2563eb;', new_string: '--accent: #16a34a;'
  });
  const editCallMessageForTest = {
    id: 5, role: 'assistant', content: '',
    tool_calls: [{ id: 'e1', type: 'function', function: { name: 'edit', arguments: editArgumentsForTest } }]
  };
  const throughEditForTest = [
    { id: 1, role: 'user', content: 'give me a tip calculator as an HTML file' },
    createCallMessageForTest(2, 'c1', { format: 'html', filename: 'tip-calculator', html: LONG_PAGE_FOR_TEST }),
    savedResultMessageForTest(3, 'c1', { ok: true, format: 'html', filename: 'tip-calculator.html', size: 6000, rev: 'aa' }),
    { id: 4, role: 'user', content: 'make the button green' },
    editCallMessageForTest,
    savedResultMessageForTest(6, 'e1', { ok: true, format: 'html', filename: 'tip-calculator.html', size: 6000, rev: 'bb' })
  ];

  const afterEditForTest = await agentNsForTest.contextBuilder.build(throughEditForTest, {});
  assert.deepStrictEqual(sentHtmlArgsForTest(afterEditForTest), [LONG_PAGE_FOR_TEST, undefined]);

  const afterRemakeForTest = await agentNsForTest.contextBuilder.build(throughEditForTest.concat([
    { id: 7, role: 'user', content: 'redo the calculator with light theme only and animated effects' },
    createCallMessageForTest(8, 'c2', { format: 'html', filename: 'tip-calculator', html: newerPageForTest }),
    savedResultMessageForTest(9, 'c2', { ok: true, format: 'html', filename: 'tip-calculator.html', size: 6000 })
  ]), {});
  const sentForTest = sentHtmlArgsForTest(afterRemakeForTest);
  assert.ok(sentForTest[0].startsWith('[An earlier version of this page'));
  assert.strictEqual(sentForTest[1], undefined);
  assert.strictEqual(sentForTest[2], newerPageForTest);
  const sentEditForTest = afterRemakeForTest.find(function (m) { return m.tool_calls && m.tool_calls[0].id === 'e1'; });
  assert.strictEqual(sentEditForTest.tool_calls[0].function.arguments, editArgumentsForTest);
});

test('a failed remake, or a short earlier page, keeps the earlier html', async function () {
  function remakeMessagesForTest(firstPageForTest, secondResultForTest) {
    return [
      createCallMessageForTest(1, 'c1', { format: 'html', filename: 'tips', html: firstPageForTest }),
      savedResultMessageForTest(2, 'c1', { ok: true, format: 'html', filename: 'tips.html', size: 6000 }),
      createCallMessageForTest(3, 'c2', { format: 'html', filename: 'tips', html: LONG_PAGE_FOR_TEST }),
      savedResultMessageForTest(4, 'c2', secondResultForTest)
    ];
  }
  const failedForTest = await agentNsForTest.contextBuilder.build(
    remakeMessagesForTest(LONG_PAGE_FOR_TEST, { ok: false, error: 'Not run: create_document needs the builtin-html guide' }), {});
  assert.deepStrictEqual(sentHtmlArgsForTest(failedForTest), [LONG_PAGE_FOR_TEST, LONG_PAGE_FOR_TEST]);

  const shortPageForTest = '<!DOCTYPE html><p>Hi</p>';
  const shortForTest = await agentNsForTest.contextBuilder.build(
    remakeMessagesForTest(shortPageForTest, { ok: true, format: 'html', filename: 'tips.html', size: 6000 }), {});
  assert.deepStrictEqual(sentHtmlArgsForTest(shortForTest), [shortPageForTest, LONG_PAGE_FOR_TEST]);
});

test('an HTML file waits for builtin-html alone, not the office-format rules', function () {
  const guidesForTest = agentNsForTest.builtinGuides;
  const callForTest = { format: 'html', html: PAGE_FOR_TEST };
  const refusalForTest = guidesForTest.gateToolCall('create_document', callForTest, []);
  assert.ok(/needs the builtin-html guide,/.test(refusalForTest.reason));
  assert.deepStrictEqual(refusalForTest.guide.match(/\[built-in guide: [a-z-]+\]/g), ['[built-in guide: builtin-html]']);

  const readForTest = { role: 'tool', tool_call_id: 'g', content: JSON.stringify(guidesForTest.readResult('builtin-html', [])) };
  assert.strictEqual(guidesForTest.gateToolCall('create_document', callForTest, [readForTest]), null);
  assert.ok(/needs the builtin-documents and builtin-docx-pdf guides,/.test(guidesForTest.gateToolCall('create_document', { format: 'docx', content: 'Hi' }, [readForTest]).reason));

  // An office guide in the window does not unlock an HTML file.
  const docxReadForTest = { role: 'tool', tool_call_id: 'd', content: JSON.stringify(guidesForTest.readResult('builtin-docx-pdf', [])) };
  assert.ok(/needs the builtin-html guide,/.test(guidesForTest.gateToolCall('create_document', callForTest, [docxReadForTest]).reason));

  // eval code that names html waits for builtin-html only.
  const evalForTest = { code: 'return { __document__: { format: "html", html: "<p>" + vars.n + "</p>" } };' };
  assert.ok(/needs the builtin-html guide,/.test(guidesForTest.gateToolCall('eval', evalForTest, []).reason));
  assert.strictEqual(guidesForTest.gateToolCall('eval', evalForTest, [readForTest]), null);

  // Changing a saved page with edit needs no guide.
  assert.strictEqual(guidesForTest.gateToolCall('edit', { type: 'attachment', id: 12, rev: 'x', old_string: 'a', new_string: 'b' }, []), null);
});

// The earlier version is left out only when the remake has the same file name, so the guide's rule
// to keep the name is what makes that happen. Checked against the guide before the rule was added,
// which a real chat showed to be needed: asked to "redo the calculator with light theme only", the
// model named the remake tip-calculator-light, and the old page stayed in every later request.
test('the HTML guide asks for the same file name when a page is made again', function () {
  const bodyForTest = agentNsForTest.builtinGuides.get('builtin-html').body;
  assert.ok(bodyForTest.includes('give it the same filename'));
  assert.ok(/Use a new filename only when the user wants to keep both versions/.test(bodyForTest));
});

test('the prompt lists the HTML guide and the create_document schema takes html', async function () {
  const promptForTest = (await agentNsForTest.contextBuilder.build([], {}))[0].content;
  assert.ok(promptForTest.includes('\n- builtin-html: '));
  assert.ok(promptForTest.includes('a web page or app to open in their browser'));
  const createForTest = agentNsForTest.toolDefs.find(function (d) { return d.function.name === 'create_document'; }).function;
  assert.ok(createForTest.parameters.properties.format.enum.includes('html'));
  assert.ok(createForTest.description.includes('builtin-html'));
  const editForTest = agentNsForTest.toolDefs.find(function (d) { return d.function.name === 'edit'; }).function;
  assert.ok(editForTest.parameters.properties.type.enum.includes('attachment'));
  assert.strictEqual(editForTest.parameters.properties.edits.type, 'array');
});
