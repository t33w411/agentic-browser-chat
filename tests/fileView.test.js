// view_file: the rules in agent/fileViewRules.js, the tool in agent/toolExec.js (with the canvas
// work of offscreen/fileViewRender.js stubbed, since Node has no canvas or pdf.js), the printer's
// noPrompt flag, the deck drawing documentGeneration keeps, and the agent loop that sends the
// pictures once and never saves them. The drawing itself is covered by the browser suite
// tests/browser/extension/fileView.mjs.
//
// Checked against the code before this change, with this file and agent/fileViewRules.js added:
// the 13 tool, printer, deck and loop tests fail there, and the 8 rules tests pass because the
// module is new. The tool is unknown, the loop saves _viewImages inside the tool message and never
// sends a picture, a provider refusal ends the run, view_file is offered to a model with no vision,
// no deck drawing is kept, and the printer opens the consent window for a noPrompt job.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..');

// The loop registers its message listener when it loads, and the stubs below are swapped per test.
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

const rules = require('../agent/fileViewRules.js');
require('../agent/tools.js');
require('../agent/documentGeneration.js');
require('../agent/toolExec.js');
require('../agent/builtinGuides.js');
require('../agent/contextBuilder.js');
require('../agent/client.js');
require('../offscreen/agentRun.js');

const agentNsForTest = globalThis.ABChatAgent;
const realExecuteToolForTest = agentNsForTest.executeTool;
const realClientForTest = agentNsForTest.client;
const realToolDefsForTest = agentNsForTest.toolDefs;

const PNG_FOR_TEST = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG_FOR_TEST = 'data:image/jpeg;base64,/9j/AAAA';
const PDF_FOR_TEST = 'data:application/pdf;base64,JVBERi0xLjQK';
const DOCX_FOR_TEST = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==';
const PPTX_MIME_FOR_TEST = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// ---------------------------------------------------------------------------
// agent/fileViewRules.js
// ---------------------------------------------------------------------------

test('a file kind comes from the MIME type, then the name', function () {
  assert.strictEqual(rules.fileKind({ mimeType: 'image/png', name: 'x' }), 'image');
  assert.strictEqual(rules.fileKind({ kind: 'generated_image', name: 'generated-image' }), 'image');
  assert.strictEqual(rules.fileKind({ mimeType: 'application/pdf' }), 'pdf');
  assert.strictEqual(rules.fileKind({ name: 'Report.DOCX' }), 'docx');
  assert.strictEqual(rules.fileKind({ mimeType: PPTX_MIME_FOR_TEST }), 'pptx');
  assert.strictEqual(rules.fileKind({ mimeType: 'text/html; charset=utf-8' }), 'html');
  assert.strictEqual(rules.fileKind({ name: 'data.csv' }), 'csv');
  assert.strictEqual(rules.fileKind({ name: 'book.xlsx' }), 'xlsx');
  assert.strictEqual(rules.fileKind({ name: 'notes.txt', mimeType: 'text/plain' }), 'other');
});

test('pages take a list or a range, and an empty value means none were asked for', function () {
  assert.deepStrictEqual(rules.parsePages([3, '1', 3, 2]), { pages: [1, 2, 3] });
  assert.deepStrictEqual(rules.parsePages('1-3, 7'), { pages: [1, 2, 3, 7] });
  assert.deepStrictEqual(rules.parsePages([]), { pages: null });
  assert.deepStrictEqual(rules.parsePages(''), { pages: null });
  assert.deepStrictEqual(rules.parsePages(undefined), { pages: null });
  assert.ok(rules.parsePages([0]).error);
  assert.ok(rules.parsePages(['two']).error);
  assert.ok(rules.parsePages('5-2').error);
  assert.ok(rules.parsePages({ from: 1 }).error);
  // A huge range is not expanded in full.
  assert.ok(rules.parsePages('1-1000000').pages.length < 200);
});

test('four pages or fewer are shown full size, more as contact sheets of six, up to 24 a call', function () {
  assert.deepStrictEqual(rules.planPages(3, null), { mode: 'full', shown: [1, 2, 3], missing: [], notShown: [], images: 3 });
  const seven = rules.planPages(7, null);
  assert.strictEqual(seven.mode, 'sheets');
  assert.deepStrictEqual(seven.sheets, [[1, 2, 3, 4, 5, 6], [7]]);
  assert.strictEqual(seven.images, 2);
  const long = rules.planPages(60, null);
  assert.strictEqual(long.shown.length, 24);
  assert.strictEqual(long.sheets.length, 4);
  assert.deepStrictEqual(long.notShown.slice(0, 2), [25, 26]);
  const chosen = rules.planPages(60, [30, 31, 70]);
  assert.deepStrictEqual(chosen.shown, [30, 31]);
  assert.deepStrictEqual(chosen.missing, [70]);
  assert.match(rules.planPages(2, [5, 6]).error, /2 pages, so pages 5-6 do not exist/);
  assert.ok(rules.planPages(0, null).error);
});

test('a contact sheet fits its edge, keeps cells apart, and lays slides two across', function () {
  const portrait = rules.sheetLayout(612, 792, 6, 1500);
  assert.strictEqual(portrait.cols, 3);
  assert.strictEqual(portrait.rows, 2);
  const slides = rules.sheetLayout(960, 540, 6, 1500);
  assert.strictEqual(slides.cols, 2);
  assert.strictEqual(slides.rows, 3);
  [portrait, slides, rules.sheetLayout(612, 792, 1, 1500), rules.sheetLayout(960, 540, 5, 1500)].forEach(function (layout) {
    assert.ok(layout.width <= 1500 && layout.height <= 1500, JSON.stringify([layout.width, layout.height]));
    for (let i = 0; i < layout.cells.length; i++) {
      for (let j = i + 1; j < layout.cells.length; j++) {
        const a = layout.cells[i];
        const b = layout.cells[j];
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.labelY || b.y + b.height <= a.labelY;
        assert.ok(apart, 'cells ' + i + ' and ' + j + ' overlap');
      }
    }
  });
  // Each thumbnail keeps the page's shape.
  assert.ok(Math.abs(portrait.thumbWidth / portrait.thumbHeight - 612 / 792) < 0.02);
});

test('the budget holds a call to the step, run and file limits, and gives back unused pictures', function () {
  const budget = rules.createBudget();
  const request = function (step, fileKey, images) { return { step: step, fileKey: fileKey, fileName: fileKey, images: images }; };
  assert.ok(rules.reserve(budget, request(1, 'name:a.pdf', 4)).ok);
  assert.ok(rules.reserve(budget, request(1, 'name:b.pdf', 4)).ok);
  assert.match(rules.reserve(budget, request(1, 'name:c.pdf', 1)).error, /At most 8 pictures/);
  // A refused call counts nothing.
  assert.strictEqual(budget.viewsByFile['name:c.pdf'], undefined);
  rules.release(budget, 1, 2);
  assert.ok(rules.reserve(budget, request(1, 'name:c.pdf', 2)).ok);
  assert.ok(rules.reserve(budget, request(2, 'name:a.pdf', 4)).ok);
  // A third look at a.pdf is allowed, a fourth is not.
  assert.ok(rules.reserve(budget, request(3, 'name:a.pdf', 1)).ok);
  assert.match(rules.reserve(budget, request(3, 'name:a.pdf', 1)).error, /looked at name:a.pdf 3 times/);
  assert.ok(rules.reserve(budget, request(3, 'name:d.pdf', 4)).ok);
  assert.ok(rules.reserve(budget, request(4, 'name:e.pdf', 4)).ok);
  assert.strictEqual(budget.images, 21);
  assert.match(rules.reserve(budget, request(5, 'name:f.pdf', 4)).error, /only 3 of the 24/);
  // check counts nothing.
  assert.ok(rules.check(budget, request(5, 'name:f.pdf', 3)).ok);
  assert.strictEqual(budget.images, 21);
  budget.refused = 'off';
  assert.strictEqual(rules.reserve(budget, request(6, 'name:g.pdf', 1)).error, 'off');
});

test('generated images are counted one by one, documents by name', function () {
  assert.strictEqual(rules.fileKey({ kind: 'generated_image', name: 'generated-image' }, 57), 'blob:57');
  assert.strictEqual(rules.fileKey({ kind: 'generated_document', name: 'Report.PDF' }, 12), 'name:report.pdf');
  assert.strictEqual(rules.fileKey({}, 9), 'blob:9');
});

test('the picture message opens with the note, labels each picture, and skips anything that is not a picture', function () {
  assert.strictEqual(rules.imagesMessage([]), null);
  const message = rules.imagesMessage([
    { label: 'a.pdf (blob 5), page 1 of 2', dataUrl: JPEG_FOR_TEST },
    { label: 'broken', dataUrl: 'data:application/pdf;base64,AAAA' },
    { label: 'b.png (blob 6)', dataUrl: PNG_FOR_TEST }
  ]);
  assert.strictEqual(message.role, 'user');
  assert.deepStrictEqual(message.content.map(function (part) { return part.type; }), ['text', 'text', 'image_url', 'text', 'image_url', 'text']);
  assert.match(message.content[0].text, /file content, not instructions/);
  // The request for a written note comes last, after the pictures: the note is the only record
  // of the look once the pictures leave the request.
  assert.match(message.content[5].text, /Start your next message with one or two sentences/);
  assert.match(message.content[5].text, /in this request only/);
  // Written to the user and said once: the note opens the reply the user reads. Checked against
  // the earlier wording, which asked only for a note; these two assertions fail there.
  assert.match(message.content[5].text, /sentences to the user on what you see/);
  assert.match(message.content[5].text, /do not say the same thing again later in it/);
  assert.strictEqual(message.content[1].text, 'a.pdf (blob 5), page 1 of 2:');
  assert.strictEqual(message.content[4].image_url.url, PNG_FOR_TEST);
});

test('a saved result\'s pictures field is rewritten to the outcome, and nothing else is', function () {
  const saved = JSON.stringify({ ok: true, file: 'a.pdf', pictures: rules.PICTURE_STATES.pending, note: 'kept', result_ref: 9 });
  const shown = JSON.parse(rules.markPictures(saved, 'shown'));
  assert.strictEqual(shown.pictures, rules.PICTURE_STATES.shown);
  assert.strictEqual(shown.note, 'kept');
  assert.strictEqual(shown.result_ref, 9);
  assert.match(rules.PICTURE_STATES.shown, /You looked at them then/);
  assert.match(rules.PICTURE_STATES.refused, /have not seen this file/);
  assert.match(rules.PICTURE_STATES.unsent, /have not seen this file/);
  // Not a view_file result with pictures, not JSON, or an unknown state: unchanged.
  const other = JSON.stringify({ ok: false, error: 'x' });
  assert.strictEqual(rules.markPictures(other, 'shown'), other);
  assert.strictEqual(rules.markPictures('not json', 'shown'), 'not json');
  assert.strictEqual(rules.markPictures(saved, 'seen'), saved);
});

test('labels and summaries name pages or slides', function () {
  assert.strictEqual(rules.pictureLabel('deck.pptx (blob 3)', 'pptx', { pages: [2], sheet: false }, 9), 'deck.pptx (blob 3), slide 2 of 9');
  assert.strictEqual(rules.pictureLabel('r.pdf (blob 4)', 'pdf', { pages: [1, 2, 3, 5], sheet: true }, 9), 'r.pdf (blob 4), contact sheet of pages 1-3, 5, each numbered above its thumbnail');
  assert.strictEqual(rules.shownSummary({ mode: 'full', shown: [4] }, 'pdf'), 'page 4 at full size');
  assert.strictEqual(rules.shownSummary({ mode: 'sheets', shown: [1, 2, 3, 4, 5, 6, 7], sheets: [[1], [2]] }, 'pptx'), 'slides 1-7 on 2 contact sheets of numbered thumbnails');
  assert.strictEqual(rules.printFailure({ code: 'no-consent' }), rules.MESSAGES.printOff);
  assert.strictEqual(rules.printFailure({ code: 'declined' }), rules.MESSAGES.printOff);
  assert.match(rules.printFailure({ code: 'failed', error: 'boom' }), /\(boom\)/);
});

// ---------------------------------------------------------------------------
// agent/toolExec.js: view_file, with the drawing stubbed
// ---------------------------------------------------------------------------

function withBlobsForTest(blobs) {
  globalThis.ABChatShared = {
    panelDataRepo: {
      getAttachmentBlob: async function (id) { return blobs[id] ? Object.assign({ id: id }, blobs[id]) : null; }
    }
  };
}

// renderPdf stand-in: plans with the real rules for a file of numPages pages, reserves, and returns
// one picture per planned image, leaving out the pages in blank.
function renderStubForTest(numPages, blank) {
  const calls = [];
  globalThis.ABChatOffscreen = {
    fileViewRender: {
      scaleImage: async function (dataUrl) { calls.push({ scale: dataUrl }); return { dataUrl: JPEG_FOR_TEST, width: 1024, height: 768 }; },
      renderPdf: async function (bytes, options) {
        calls.push({ pdfBytes: bytes.length, pages: options.pages });
        const plan = rules.planPages(numPages, options.pages);
        if (plan.error) return { error: plan.error, numPages: numPages };
        const refusal = options.reserve(plan);
        if (refusal) return { error: refusal, numPages: numPages };
        const blankPages = (blank || []).filter(function (p) { return plan.shown.indexOf(p) !== -1; });
        const pictures = plan.mode === 'full'
          ? plan.shown.filter(function (p) { return blankPages.indexOf(p) === -1; }).map(function (p) { return { pages: [p], sheet: false, dataUrl: JPEG_FOR_TEST }; })
          : plan.sheets.map(function (sheet) { return { pages: sheet, sheet: true, dataUrl: JPEG_FOR_TEST }; });
        return { numPages: numPages, plan: plan, pictures: pictures, blank: blankPages, failed: [] };
      }
    }
  };
  return calls;
}

function viewForTest(args, context) {
  return realExecuteToolForTest('view_file', args, Object.assign({ iteration: 1 }, context || {}));
}

test('view_file refuses what it cannot show, with the reason, and shows no picture', async function () {
  renderStubForTest(1);
  withBlobsForTest({
    1: { name: 'page.html', mimeType: 'text/html', dataUrl: 'data:text/html;base64,PGh0bWw+' },
    2: { name: 'sheet.xlsx', dataUrl: 'data:application/zip;base64,UEsDBA==' },
    3: { name: 'notes.txt', mimeType: 'text/plain', textContent: 'hello' },
    4: { name: 'scan.pdf', mimeType: 'application/pdf', textContent: 'only the text' },
    5: { name: 'deck.pptx', mimeType: PPTX_MIME_FOR_TEST, dataUrl: 'data:' + PPTX_MIME_FOR_TEST + ';base64,UEsDBA==' }
  });
  const outcomes = {};
  for (const id of [1, 2, 3, 4, 5, 99]) outcomes[id] = await viewForTest({ blob_id: id });
  // An HTML page is loaded only when it was made in this chat: loading runs its scripts.
  assert.strictEqual(outcomes[1].error, rules.MESSAGES.htmlNotMade);
  assert.match(outcomes[2].error, /is a spreadsheet/);
  assert.match(outcomes[3].error, /none of these/);
  assert.match(outcomes[4].error, /keeps only the text/);
  assert.strictEqual(outcomes[5].error, rules.MESSAGES.deckNotHere);
  assert.match(outcomes[99].error, /No file with blob id 99/);
  assert.match((await viewForTest({})).error, /blob_id is required/);
  assert.match((await viewForTest({ blob_id: 1, pages: [0] })).error, /whole page numbers/);
  Object.keys(outcomes).forEach(function (id) {
    assert.strictEqual(outcomes[id].ok, false);
    assert.strictEqual(outcomes[id]._viewImages, undefined);
  });
});

test('an image is shown as one labelled picture and counted against the budget', async function () {
  const calls = renderStubForTest(1);
  withBlobsForTest({ 57: { name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: PNG_FOR_TEST } });
  const budget = rules.createBudget();
  const result = await viewForTest({ blob_id: 57, pages: [3] }, { viewBudget: budget });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.kind, 'image');
  assert.strictEqual(result.width, 1024);
  assert.deepStrictEqual(result._viewImages, [{ label: 'generated-image (blob 57)', dataUrl: JPEG_FOR_TEST }]);
  assert.strictEqual(result.pictures, rules.PICTURE_STATES.pending);
  assert.deepStrictEqual(calls, [{ scale: PNG_FOR_TEST }]);
  assert.strictEqual(budget.images, 1);
  assert.strictEqual(budget.viewsByFile['blob:57'], 1);
});

test('a PDF longer than four pages comes as contact sheets, and blank pages are reported, not sent', async function () {
  renderStubForTest(7, [2]);
  withBlobsForTest({ 12: { name: 'report.pdf', kind: 'generated_document', mimeType: 'application/pdf', dataUrl: PDF_FOR_TEST } });
  const budget = rules.createBudget();
  const whole = await viewForTest({ blob_id: 12 }, { viewBudget: budget });
  assert.strictEqual(whole.ok, true);
  assert.strictEqual(whole.pages, 7);
  assert.strictEqual(whole.shown, 'pages 1-7 on 2 contact sheets of numbered thumbnails');
  assert.deepStrictEqual(whole._viewImages.map(function (p) { return p.label; }), [
    'report.pdf (blob 12), contact sheet of pages 1-6, each numbered above its thumbnail',
    'report.pdf (blob 12), contact sheet of page 7, each numbered above its thumbnail'
  ]);
  assert.strictEqual(whole.pictures, rules.PICTURE_STATES.pending);
  assert.strictEqual(whole.note, undefined, 'a PDF made here needs no note about Chrome');

  const close = await viewForTest({ blob_id: 12, pages: [1, 2] }, { viewBudget: budget, iteration: 2 });
  assert.deepStrictEqual(close.blank_pages, [2]);
  assert.strictEqual(close._viewImages.length, 1);
  assert.strictEqual(close._viewImages[0].label, 'report.pdf (blob 12), page 1 of 7');
  // The blank page's reserved picture was given back.
  assert.strictEqual(budget.images, 3);
});

test('a DOCX is printed without asking, and a print the user has not allowed is refused as unchecked', async function () {
  renderStubForTest(2);
  withBlobsForTest({ 20: { name: 'cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataUrl: DOCX_FOR_TEST } });
  const sent = [];
  agentNsForTest.docxToPdf = { convert: async function () { return { ok: true, html: '<p>cv</p>', fonts: [], templates: {}, warnings: ['Calibri is shown as Carlito'] }; } };
  globalThis.location = { protocol: 'chrome-extension:' };
  let printAnswer = { ok: false, code: 'no-consent' };
  chromeStubForTest.sendMessage = function (message) { sent.push(message); return printAnswer; };
  try {
    const refused = await viewForTest({ blob_id: 20 });
    assert.strictEqual(refused.error, rules.MESSAGES.printOff);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].action, 'printDocumentPdf');
    assert.strictEqual(sent[0].noPrompt, true);

    printAnswer = { ok: true, base64: 'JVBERi0xLjQK', warnings: [] };
    const shown = await viewForTest({ blob_id: 20 });
    assert.strictEqual(shown.ok, true);
    assert.strictEqual(shown.kind, 'docx');
    assert.match(shown.note, /never tell the user you checked the file in Word/);
    assert.strictEqual(shown.pictures, rules.PICTURE_STATES.pending);
    assert.deepStrictEqual(shown.warnings, ['Calibri is shown as Carlito']);
    assert.strictEqual(shown._viewImages[1].label, 'cv.docx (blob 20), page 2 of 2');
  } finally {
    chromeStubForTest.sendMessage = function () { return { ok: true }; };
    delete agentNsForTest.docxToPdf;
    delete globalThis.location;
  }
});

test('a fourth look at one file is refused before it is printed', async function () {
  renderStubForTest(1);
  withBlobsForTest({ 20: { name: 'cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataUrl: DOCX_FOR_TEST } });
  const budget = rules.createBudget();
  budget.viewsByFile[rules.fileKey({ name: 'cv.docx' }, 20)] = 3;
  let converted = 0;
  agentNsForTest.docxToPdf = { convert: async function () { converted++; return { ok: false, error: 'not reached' }; } };
  globalThis.location = { protocol: 'chrome-extension:' };
  try {
    const result = await viewForTest({ blob_id: 20 }, { viewBudget: budget });
    assert.match(result.error, /already looked at cv.docx 3 times/);
    assert.strictEqual(converted, 0);
  } finally {
    delete agentNsForTest.docxToPdf;
    delete globalThis.location;
  }
});

test('a deck made in this reply is printed from its drawing', async function () {
  renderStubForTest(3);
  withBlobsForTest({ 41: { name: 'deck.pptx', mimeType: PPTX_MIME_FOR_TEST, dataUrl: 'data:' + PPTX_MIME_FOR_TEST + ';base64,UEsDBA==' } });
  const drawing = { deck: {}, records: [], title: 'Deck' };
  const jobs = [];
  const realGeneration = agentNsForTest.documentGeneration;
  agentNsForTest.documentGeneration = Object.assign({}, realGeneration, {
    slidePrintJob: function (drawn, title) { jobs.push([drawn, title]); return { html: '<section class="slide"></section>', title: title, fonts: [], templates: {} }; }
  });
  const sent = [];
  chromeStubForTest.sendMessage = function (message) { sent.push(message); return { ok: true, base64: 'JVBERi0xLjQK' }; };
  try {
    const result = await viewForTest({ blob_id: 41 }, { viewSources: new Map([[41, drawing]]) });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(jobs[0][0], drawing);
    assert.strictEqual(jobs[0][1], 'Deck');
    assert.strictEqual(sent[0].noPrompt, true);
    assert.strictEqual(result.shown, 'slides 1-3 at full size');
    assert.strictEqual(result._viewImages[0].label, 'deck.pptx (blob 41), slide 1 of 3');
  } finally {
    agentNsForTest.documentGeneration = realGeneration;
    chromeStubForTest.sendMessage = function () { return { ok: true }; };
  }
});

// ---------------------------------------------------------------------------
// The printer: noPrompt never opens the consent window
// ---------------------------------------------------------------------------

function htmlBlobForTest(html, kind) {
  return { name: 'tool.html', mimeType: 'text/html', kind: kind, dataUrl: 'data:text/html;base64,' + Buffer.from(html, 'utf8').toString('base64') };
}

test('an HTML page made in this chat is loaded without asking, and one the user attached is not loaded', async function () {
  const page = '<!DOCTYPE html><html><head><title>Café</title></head><body><p>Prix: 4 €</p></body></html>';
  renderStubForTest(1);
  withBlobsForTest({ 30: htmlBlobForTest(page, 'generated_document'), 31: htmlBlobForTest(page, 'file') });
  const sent = [];
  let answer = { ok: false, code: 'no-consent' };
  chromeStubForTest.sendMessage = function (message) { sent.push(message); return answer; };
  try {
    const attached = await viewForTest({ blob_id: 31 });
    assert.strictEqual(attached.error, rules.MESSAGES.htmlNotMade);
    assert.strictEqual(sent.length, 0, 'an attached page is never loaded');

    const budget = rules.createBudget();
    const off = await viewForTest({ blob_id: 30 }, { viewBudget: budget });
    assert.strictEqual(off.error, rules.MESSAGES.htmlOff);
    assert.strictEqual(sent[0].action, 'snapshotHtmlPage');
    assert.strictEqual(sent[0].html, page, 'the page is decoded as UTF-8');
    assert.strictEqual(sent[0].pictures, true);
    assert.deepStrictEqual(sent[0].desktop, { width: 1280, height: 800 });
    assert.deepStrictEqual(sent[0].phone, { width: 390, height: 844 });
    assert.strictEqual(budget.images, 0, 'a refused load counts no picture');

    answer = {
      ok: true, desktop: 'AAAA', phone: 'BBBB', pageHeight: 1900, phoneScrollWidth: 520, loaded: true,
      reports: ['Uncaught TypeError: x (line 4 of the page)', 'Uncaught TypeError: x (line 4 of the page)', 'console.error: Save failed']
    };
    const shown = await viewForTest({ blob_id: 30 }, { viewBudget: budget });
    assert.strictEqual(shown.ok, true);
    assert.strictEqual(shown.kind, 'html');
    assert.strictEqual(shown.blob_id, 30);
    assert.strictEqual(shown.shown, rules.htmlShownSummary());
    assert.deepStrictEqual(shown.errors, ['Uncaught TypeError: x (line 4 of the page)', 'console.error: Save failed']);
    assert.strictEqual(shown.page_height, 1900);
    assert.match(shown.phone_overflow, /520 px wide in a 390 px phone window/);
    assert.strictEqual(shown.pictures, rules.PICTURE_STATES.pending);
    assert.strictEqual(shown.note, rules.MESSAGES.htmlLoadOnly);
    assert.deepStrictEqual(shown._viewImages.map(function (p) { return p.label; }), [
      'tool.html (blob 30), first screen at desktop width (1280 x 800)',
      'tool.html (blob 30), first screen at phone width (390 x 844)'
    ]);
    assert.strictEqual(budget.images, 2);
  } finally {
    chromeStubForTest.sendMessage = function () { return { ok: true }; };
  }
});

test('past the picture limits, or after the provider refused pictures, an HTML page is still loaded for its errors', async function () {
  renderStubForTest(1);
  withBlobsForTest({ 30: htmlBlobForTest('<!DOCTYPE html><html><head></head><body></body></html>', 'generated_document') });
  const sent = [];
  chromeStubForTest.sendMessage = function (message) {
    sent.push(message);
    return { ok: true, desktop: message.pictures ? 'AAAA' : '', phone: message.pictures ? 'BBBB' : '', pageHeight: 800, phoneScrollWidth: 390, reports: [] };
  };
  try {
    const budget = rules.createBudget();
    for (let step = 1; step <= 3; step++) {
      const look = await viewForTest({ blob_id: 30 }, { viewBudget: budget, iteration: step });
      assert.strictEqual(look._viewImages.length, 2);
    }
    const fourth = await viewForTest({ blob_id: 30 }, { viewBudget: budget, iteration: 4 });
    assert.strictEqual(sent[3].pictures, false, 'loaded without pictures');
    assert.strictEqual(fourth.ok, true);
    assert.deepStrictEqual(fourth.errors, []);
    assert.deepStrictEqual(fourth._viewImages, []);
    assert.ok(!('pictures' in fourth) && !('shown' in fourth));
    assert.match(fourth.no_pictures, /tool\.html 3 times/);
    assert.ok(!('phone_overflow' in fourth));

    const refusedBudget = rules.createBudget();
    refusedBudget.refused = 'view_file is off for the rest of this reply.';
    const afterRefusal = await viewForTest({ blob_id: 30 }, { viewBudget: refusedBudget });
    assert.strictEqual(sent[4].pictures, false);
    assert.strictEqual(afterRefusal.ok, true);
    assert.strictEqual(afterRefusal.no_pictures, 'view_file is off for the rest of this reply.');
  } finally {
    chromeStubForTest.sendMessage = function () { return { ok: true }; };
  }
});

test('a noPrompt print with no answer yet is refused at once, without the consent window', async function () {
  const windowsOpened = [];
  const ctx = {
    console, Promise, btoa, atob,
    // The consent wait's 90-second timer is never run, so the control case cannot hold the process.
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    navigator: { userAgent: 'Chrome/140.0.0.0' },
    chrome: {
      runtime: { getURL: function (rel) { return 'chrome-extension://test/' + rel; }, lastError: null },
      tabs: { query: function (query, callback) { callback([]); }, remove: function () {} },
      storage: { local: { get: function (key, callback) { callback({}); } }, onChanged: { addListener: function () {}, removeListener: function () {} } },
      windows: {
        onRemoved: { addListener: function () {}, removeListener: function () {} },
        create: function (options, callback) { windowsOpened.push(options.url); callback(null); }
      }
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'background/documentPrinter.js'), 'utf8'), ctx, { filename: 'documentPrinter.js' });
  const printer = ctx.ABChatBackground.documentPrinter;
  const quiet = await printer.printPdf({ html: '<p>x</p>', noPrompt: true });
  assert.strictEqual(quiet.code, 'no-consent');
  assert.strictEqual(windowsOpened.length, 0);
  // Control: the same job without the flag asks the user.
  const asked = await printer.printPdf({ html: '<p>x</p>' });
  assert.strictEqual(asked.code, 'no-consent');
  assert.strictEqual(windowsOpened.length, 1);
});

// The page check in background/documentPrinter.js, with chrome.debugger stubbed. Each command is
// answered at once; the page's reports arrive while the page is written, as Chrome sends them.
function plainForTest(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPageCheckerForTest(state) {
  const listeners = { event: [], detach: [] };
  const ctx = {
    console, Promise, btoa, atob,
    // Waits run on the next turn, so the load wait loses to an answered load and nothing sleeps.
    setTimeout: function (fn) { setImmediate(fn); return 0; },
    clearTimeout: function () {},
    navigator: { userAgent: 'Chrome/140.0.0.0' },
    chrome: {
      runtime: { getURL: function (rel) { return 'chrome-extension://test/' + rel; }, lastError: null },
      tabs: {
        query: function (query, callback) { callback([]); },
        create: async function (options) { state.created.push(options.url); return { id: 5 }; },
        remove: function (id, callback) { state.removed.push(id); if (typeof callback === 'function') callback(); return Promise.resolve(); }
      },
      storage: {
        local: { get: function (key, callback) { callback(state.mode ? { abchatPdfPrintMode: state.mode } : {}); } },
        session: {
          get: function (key, callback) { callback(JSON.parse(JSON.stringify(state.session))); },
          set: function (items, callback) { Object.assign(state.session, items); if (callback) callback(); }
        },
        onChanged: { addListener: function () {}, removeListener: function () {} }
      },
      windows: {
        onRemoved: { addListener: function () {}, removeListener: function () {} },
        create: function (options, callback) { state.windows.push(options.url); callback(null); }
      },
      debugger: {
        onEvent: { addListener: function (fn) { listeners.event.push(fn); }, removeListener: function (fn) { listeners.event = listeners.event.filter(function (f) { return f !== fn; }); } },
        onDetach: { addListener: function (fn) { listeners.detach.push(fn); }, removeListener: function (fn) { listeners.detach = listeners.detach.filter(function (f) { return f !== fn; }); } },
        attach: function (target, version, callback) { callback(); },
        detach: function (target, callback) { state.detached.push(target.tabId); callback(); },
        sendCommand: function (target, method, params, callback) {
          state.commands.push({ method: method, params: params });
          const fire = function (m, p) { listeners.event.forEach(function (fn) { fn({ tabId: target.tabId }, m, p); }); };
          if (method === 'Page.getFrameTree') return callback({ frameTree: { frame: { id: 'F' } } });
          if (method === 'Page.setDocumentContent') {
            fire('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', lineNumber: 11, url: '', exception: { description: 'TypeError: Cannot read properties of null (reading \'addEventListener\')\n    at about:blank:12:40' } } });
            fire('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'Save failed' }] });
            fire('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'not an error' }] });
            fire('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource: net::ERR_NAME_NOT_RESOLVED', url: 'https://cdn.example/lib.js' } });
            fire('Page.javascriptDialogOpening', { type: 'alert', message: 'Welcome!' });
            // Another tab's events are not this page's.
            listeners.event.forEach(function (fn) { fn({ tabId: 99 }, 'Runtime.exceptionThrown', { exceptionDetails: { text: 'elsewhere' } }); });
            return callback({});
          }
          if (method === 'Runtime.evaluate') {
            if (/scrollHeight/.test(params.expression)) return callback({ result: { value: 1900 } });
            if (/scrollWidth/.test(params.expression)) return callback({ result: { value: 520 } });
            return callback({ result: { value: true } });
          }
          if (method === 'Page.captureScreenshot') {
            return callback({ data: 'SHOT' + state.commands.filter(function (c) { return c.method === 'Page.captureScreenshot'; }).length });
          }
          return callback({});
        }
      }
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'background/documentPrinter.js'), 'utf8'), ctx, { filename: 'documentPrinter.js' });
  return ctx.ABChatBackground.documentPrinter;
}

// Checked against the printer before the page check was added: it has no snapshotHtml, so every
// assertion after the first fails.
test('an HTML page is loaded in a blank tab, never the print page, and its reports come back with the tab closed', async function () {
  const state = { mode: '', session: { abchatPageCheckTabs: [77] }, created: [], removed: [], detached: [], commands: [], windows: [] };
  const checker = loadPageCheckerForTest(state);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepStrictEqual(state.removed, [77], 'a check tab left by a stopped worker is closed when the worker starts');
  assert.deepStrictEqual(plainForTest(state.session.abchatPageCheckTabs), []);

  const quiet = await checker.snapshotHtml({ html: '<p>x</p>' });
  assert.strictEqual(quiet.code, 'no-consent');
  assert.deepStrictEqual(state.created, [], 'no tab without consent');
  assert.deepStrictEqual(state.windows, [], 'and no consent window: a look never asks');

  state.mode = 'chrome';
  const page = '<!DOCTYPE html>\n<html>\n<head><title>T</title></head>\n<body><script>boom()</script></body>\n</html>';
  const checked = await checker.snapshotHtml({ html: page, desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } });
  assert.strictEqual(checked.ok, true);
  assert.deepStrictEqual(state.created, ['about:blank'], 'a blank tab, never the extension\'s print page');
  const written = state.commands.find(function (c) { return c.method === 'Page.setDocumentContent'; }).params.html;
  assert.ok(written.indexOf('<!DOCTYPE html>\n<html>\n<head><script>') === 0, 'the storage stand-in sits right after <head>, after the doctype');
  assert.strictEqual(written.split('\n').length, page.split('\n').length, 'on the same line, so error line numbers stay the file\'s');
  assert.ok(written.indexOf('localStorage') !== -1 && written.slice(-48) === page.slice(-48));
  assert.deepStrictEqual(plainForTest(checked.reports), [
    'Uncaught TypeError: Cannot read properties of null (reading \'addEventListener\') (line 12 of the page)',
    'console.error: Save failed',
    'Failed to load resource: net::ERR_NAME_NOT_RESOLVED (https://cdn.example/lib.js)',
    'The page opened an alert dialog saying "Welcome!", which was dismissed.'
  ]);
  assert.deepStrictEqual(plainForTest(state.commands.find(function (c) { return c.method === 'Page.handleJavaScriptDialog'; }).params), { accept: false });
  const sizes = state.commands.filter(function (c) { return c.method === 'Emulation.setDeviceMetricsOverride'; }).map(function (c) { return c.params; });
  assert.deepStrictEqual(plainForTest(sizes), [
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
  ]);
  assert.strictEqual(checked.desktop, 'SHOT1');
  assert.strictEqual(checked.phone, 'SHOT2');
  assert.strictEqual(checked.pageHeight, 1900);
  assert.strictEqual(checked.phoneScrollWidth, 520);
  assert.strictEqual(checked.loaded, true);
  assert.deepStrictEqual(state.detached, [5]);
  assert.deepStrictEqual(state.removed, [77, 5], 'the tab is closed');
  assert.deepStrictEqual(plainForTest(state.session.abchatPageCheckTabs), [], 'and forgotten');

  state.commands.length = 0;
  const errorsOnly = await checker.snapshotHtml({ html: page, pictures: false });
  assert.strictEqual(errorsOnly.ok, true);
  assert.strictEqual(errorsOnly.desktop, '');
  assert.strictEqual(errorsOnly.phone, '');
  assert.strictEqual(state.commands.filter(function (c) { return c.method === 'Page.captureScreenshot'; }).length, 0, 'no pictures taken');
  assert.strictEqual(errorsOnly.phoneScrollWidth, 520, 'the phone width is still measured');
});

// ---------------------------------------------------------------------------
// agent/documentGeneration.js: a deck keeps its drawing, and prints the slides its PDF would hold
// ---------------------------------------------------------------------------

function loadDocumentsForTest() {
  const ctx = {
    console, Promise, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, btoa, atob,
    CompressionStream,
    navigator: { language: 'en-US', userAgent: 'Chrome/140.0.0.0' }
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  ['lib/jszip.min.js', 'agent/documentThemes.js', 'agent/xlsxFormulas.js', 'agent/documentGeneration.js', 'agent/documentPrint.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), ctx, { filename: rel });
  });
  return ctx.ABChatAgent.documentGeneration;
}

test('a deck result carries its drawing, and its print job is the one its slide PDF prints', async function () {
  const generation = loadDocumentsForTest();
  const slides = [{ layout: 'title', title: 'Q3 review', subtitle: 'Board' }, { title: 'Plan', bullets: ['One', 'Two'] }, { title: 'Risks', bullets: ['Hiring'] }];
  const deck = await generation.createDocument({ format: 'pptx', filename: 'q3', theme: 'modern', slides: slides }, {});
  assert.strictEqual(deck.ok, true);
  assert.ok(deck._slideDrawing && deck._slideDrawing.deck);
  assert.strictEqual(deck._slideDrawing.records.length, slides.length);
  assert.strictEqual(deck._slideDrawing.title, 'q3');
  const job = generation.slidePrintJob(deck._slideDrawing, deck._slideDrawing.title);
  assert.strictEqual((job.html.match(/<section class="slide"/g) || []).length, slides.length);

  const jobs = [];
  await generation.createDocument({ format: 'pptx', filename: 'q3', theme: 'modern', slides: slides, also_pdf: true }, {
    printPdf: function (printJob) { jobs.push(printJob); return Promise.resolve({ ok: false, code: 'declined' }); }
  });
  assert.strictEqual(jobs[0].html, job.html);

  // Other formats carry no drawing.
  const csv = await generation.createDocument({ format: 'csv', rows: [['a']] }, {});
  assert.strictEqual(csv._slideDrawing, undefined);
});

// ---------------------------------------------------------------------------
// offscreen/agentRun.js: the pictures go to the next request only and are never saved
// ---------------------------------------------------------------------------

function toolCallForTest(id, name, args) {
  return { id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } };
}

function callsForTest(prefix, name, argsList) {
  return {
    message: { role: 'assistant', content: '', tool_calls: argsList.map(function (args, i) { return toolCallForTest(prefix + i, name, args); }) },
    usage: null
  };
}

function answerForTest(text) {
  return { message: { role: 'assistant', content: text }, usage: null };
}

// Runs one agent run and answers each model request with respond(requestIndex, params), which may
// throw. toolForTest(name, args, context) stands in for every tool.
function runLoopForTest(respond, toolForTest, extraParams) {
  const requests = [];
  const toolContexts = [];
  const blobs = [];
  const store = [{ id: 1, chatId: 1, role: 'user', content: 'make it', md: 'make it' }];
  let nextId = 2;
  globalThis.ABChatShared = {
    panelDataRepo: {
      getChat: async function () { return { id: 1, messages: store.slice() }; },
      // A copy, as the real repo returns, so the store changes only through updateMessage.
      createMessage: async function (chatId, record) {
        const saved = Object.assign({ id: nextId++, chatId: chatId }, record);
        store.push(saved);
        return Object.assign({}, saved);
      },
      createAttachmentBlob: async function (record) {
        const saved = Object.assign({ id: 40 + blobs.length + 1 }, record);
        blobs.push(saved);
        return saved;
      },
      updateMessage: async function (id, patch) {
        const saved = store.find(function (m) { return m.id === id; });
        if (saved) Object.assign(saved, patch);
        return saved || null;
      },
      updateChat: async function () { return null; }
    }
  };
  agentNsForTest.toolDefs = [
    { type: 'function', function: { name: 'create_document', parameters: {} } },
    { type: 'function', function: { name: 'view_file', parameters: {} } },
    { type: 'function', function: { name: 'get_environment', parameters: {} } }
  ];
  agentNsForTest.executeTool = async function (name, args, context) {
    toolContexts.push({ name: name, context: context });
    return toolForTest(name, args, context);
  };
  agentNsForTest.client = {
    streamCompletion: async function (params) {
      requests.push({
        messages: JSON.parse(JSON.stringify(params.messages)),
        tools: (params.tools || []).map(function (t) { return t.function.name; })
      });
      return respond(requests.length - 1, params);
    }
  };
  return new Promise(function (resolve) {
    chromeStubForTest.sendMessage = function (message) {
      if (message.action === 'offscreenStreamBroadcast' && message.event === 'stream_end') {
        setTimeout(function () {
          agentNsForTest.executeTool = realExecuteToolForTest;
          agentNsForTest.client = realClientForTest;
          agentNsForTest.toolDefs = realToolDefsForTest;
          chromeStubForTest.sendMessage = function () { return { ok: true }; };
          resolve({ requests: requests, toolContexts: toolContexts, store: store, blobs: blobs });
        }, 0);
      }
      return { ok: true };
    };
    chromeStubForTest.listener({ action: 'agentRunStart', params: Object.assign({ chatId: 1, model: 'chat/model', apiKey: 'k', pricing: { completionCostPerMillion: 1 } }, extraParams || {}) }, {}, function () {});
  });
}

function imagePartsForTest(messages) {
  const urls = [];
  messages.forEach(function (message) {
    if (!Array.isArray(message.content)) return;
    message.content.forEach(function (part) { if (part && part.type === 'image_url') urls.push(part.image_url.url); });
  });
  return urls;
}

function picturesFieldForTest(messages, toolCallId) {
  const message = messages.find(function (m) { return m.role === 'tool' && m.tool_call_id === toolCallId; });
  return message ? JSON.parse(message.content).pictures : undefined;
}

function viewResultForTest(label) {
  return { ok: true, file: 'a.pdf', blob_id: 5, kind: 'pdf', pages: 1, shown: 'page 1 at full size', pictures: rules.PICTURE_STATES.pending, _viewImages: [{ label: label, dataUrl: JPEG_FOR_TEST }] };
}

test('view_file pictures go into the next request, after the tool results, and nowhere else', async function () {
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('v', 'view_file', [{ blob_id: 5 }]);
    if (index === 1) return callsForTest('e', 'get_environment', [{}]);
    return answerForTest('It looks right.');
  }, function (name) {
    return name === 'view_file' ? viewResultForTest('a.pdf (blob 5), page 1 of 1') : { ok: true, date: '2026-11-19' };
  });
  assert.strictEqual(outcome.requests.length, 3);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[0].messages), []);
  const second = outcome.requests[1].messages;
  assert.deepStrictEqual(imagePartsForTest(second), [JPEG_FOR_TEST]);
  const pictureIndex = second.findIndex(function (m) { return Array.isArray(m.content) && m.role === 'user'; });
  assert.strictEqual(second[pictureIndex - 1].role, 'tool', 'the pictures follow the tool result');
  assert.strictEqual(second[pictureIndex].content[1].text, 'a.pdf (blob 5), page 1 of 1:');
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[2].messages), [], 'shown once only');
  const savedText = JSON.stringify(outcome.store);
  assert.ok(savedText.indexOf(JPEG_FOR_TEST) === -1, 'no picture is saved');
  assert.ok(savedText.indexOf('_viewImages') === -1);
  const savedView = outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'v0'; });
  assert.strictEqual(JSON.parse(savedView.content).shown, 'page 1 at full size');
  // The request with the pictures says they follow; every later one says they were shown, so the
  // model does not take their absence to mean it never looked.
  assert.strictEqual(picturesFieldForTest(second, 'v0'), rules.PICTURE_STATES.pending);
  assert.strictEqual(picturesFieldForTest(outcome.requests[2].messages, 'v0'), rules.PICTURE_STATES.shown);
  assert.strictEqual(JSON.parse(savedView.content).pictures, rules.PICTURE_STATES.shown, 'the saved result is rewritten too, for later replies');
  assert.ok(outcome.toolContexts[0].context.viewBudget, 'the tool gets the run\'s budget');
});

test('when the provider refuses the pictures, the step is sent again without them and view_file is turned off', async function () {
  let refusedSeenByTool = '';
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('v', 'view_file', [{ blob_id: 5 }]);
    if (index === 1) throw new Error('OpenRouter error 400: image input is not supported for this endpoint');
    if (index === 2) return callsForTest('w', 'view_file', [{ blob_id: 5 }]);
    return answerForTest('I could not check how it looks.');
  }, function (name, args, context) {
    if (context.viewBudget.refused) {
      refusedSeenByTool = context.viewBudget.refused;
      return { ok: false, error: context.viewBudget.refused };
    }
    return viewResultForTest('a.pdf (blob 5), page 1 of 1');
  });
  assert.strictEqual(outcome.requests.length, 4);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[1].messages), [JPEG_FOR_TEST]);
  const retried = outcome.requests[2].messages;
  assert.deepStrictEqual(imagePartsForTest(retried), []);
  assert.ok(retried.some(function (m) { return m.role === 'user' && /provider refused the request that held them/.test(String(m.content)); }));
  assert.match(refusedSeenByTool, /view_file is off/);
  assert.strictEqual(outcome.store[outcome.store.length - 1].content, 'I could not check how it looks.');
  assert.strictEqual(picturesFieldForTest(outcome.requests[3].messages, 'v0'), rules.PICTURE_STATES.refused);
  const savedView = outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'v0'; });
  assert.strictEqual(JSON.parse(savedView.content).pictures, rules.PICTURE_STATES.refused);
});

// The three tests on the saved pictures field were checked against the loop before it rewrote
// that field: the saved result kept "the pictures follow in the next message" in every later
// request, which led a real Claude model to tell the user it had never seen slides it had checked.
test('pictures in a request that fails, or never sent, are marked as not seen', async function () {
  const failed = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('v', 'view_file', [{ blob_id: 5 }]);
    throw new Error('OpenRouter error 502: upstream unavailable');
  }, function () { return viewResultForTest('a.pdf (blob 5), page 1 of 1'); });
  assert.strictEqual(failed.requests.length, 2);
  const savedFailed = failed.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'v0'; });
  assert.strictEqual(JSON.parse(savedFailed.content).pictures, rules.PICTURE_STATES.unsent);

  // The user stopped the reply while the request with the pictures was streaming.
  const stopped = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('v', 'view_file', [{ blob_id: 5 }]);
    return { cancelled: true, message: null };
  }, function () { return viewResultForTest('a.pdf (blob 5), page 1 of 1'); });
  assert.strictEqual(stopped.requests.length, 2);
  const savedStopped = stopped.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'v0'; });
  assert.strictEqual(JSON.parse(savedStopped.content).pictures, rules.PICTURE_STATES.unsent);
});

// Checked against a copy of agentRun.js whose fallback matched on the status alone: there the 400
// below was retried, a third request was sent, and this test failed.
test('a 400 on a request with no pictures in it is not taken for a refusal of pictures', async function () {
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('e', 'get_environment', [{}]);
    if (index === 1) throw new Error('OpenRouter error 400: context length exceeded');
    return answerForTest('never reached');
  }, function () { return { ok: true, date: '2026-11-19' }; });
  assert.strictEqual(outcome.requests.length, 2);
  assert.ok(!outcome.store.some(function (m) { return m.content === 'never reached'; }));
});

test('a model with no vision is not offered view_file, and its document results do not mention it', async function () {
  const tool = function (name) {
    if (name === 'view_file') return Object.assign(viewResultForTest('r.pdf (blob 41), page 1 of 1'), { file: 'r.pdf', blob_id: 41 });
    return { ok: true, format: 'pdf', filename: 'r.pdf', mimeType: 'application/pdf', dataUrl: PDF_FOR_TEST, size: 9 };
  };
  const respond = function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'pdf', content: 'x' }]);
    return answerForTest('Done.');
  };
  const blind = await runLoopForTest(respond, tool, { modelKnownNonVision: true });
  assert.deepStrictEqual(blind.requests[0].tools, ['create_document', 'get_environment']);
  assert.deepStrictEqual(blind.toolContexts.map(function (c) { return c.name; }), ['create_document'], 'no look for a model that cannot see');
  const blindResult = blind.store.find(function (m) { return m.role === 'tool'; });
  assert.doesNotMatch(blindResult.content, /view_file|shown to you/);

  const seeing = await runLoopForTest(respond, tool, {});
  assert.deepStrictEqual(seeing.requests[0].tools, ['create_document', 'view_file', 'get_environment']);
  const seeingResult = JSON.parse(seeing.store.find(function (m) { return m.role === 'tool'; }).content);
  assert.match(seeingResult.note, /Its pages are shown to you in the next message, with no view_file call/);
});

function deckResultForTest(drawing) {
  return { ok: true, format: 'pptx', filename: 'Deck.pptx', mimeType: PPTX_MIME_FOR_TEST, dataUrl: 'data:' + PPTX_MIME_FOR_TEST + ';base64,UEsDBA==', size: 4, _slideDrawing: drawing };
}

// Checked against the loop before the look was added (each deck result carried a sentence telling
// the model to look now): the next test fails there, because view_file is never called and the
// request after the deck holds no picture, and the failure test fails because the result has no
// reason in its note.
test('the loop looks at each deck it saves, and the slides go in the next request without a call', async function () {
  const drawing = { deck: { marker: 'kept-deck' }, records: [], title: 'Deck' };
  const looks = [];
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'pptx', title: 'Deck' }]);
    return answerForTest('Slide 1 looks right.');
  }, function (name, args, context) {
    if (name === 'create_document') return deckResultForTest(drawing);
    looks.push({ args: args, drawing: context.viewSources.get(args.blob_id) || null, budget: context.viewBudget, step: context.iteration });
    return Object.assign(viewResultForTest('Deck.pptx (blob 41), slide 1 of 1'), { file: 'Deck.pptx', blob_id: 41, kind: 'pptx', shown: 'slide 1 at full size', note: rules.MESSAGES.proxy });
  });
  assert.strictEqual(outcome.blobs[0].id, 41);
  assert.strictEqual(looks.length, 1, 'one look, made by the loop');
  assert.deepStrictEqual(looks[0].args, { blob_id: 41 });
  assert.strictEqual(looks[0].drawing, drawing);
  assert.strictEqual(looks[0].budget, outcome.toolContexts[0].context.viewBudget, 'the look counts against the run\'s budget');
  assert.strictEqual(looks[0].step, outcome.toolContexts[0].context.iteration, 'and against the step that made the deck');
  assert.strictEqual(outcome.requests.length, 2, 'the model made no view_file call');
  const second = outcome.requests[1].messages;
  assert.deepStrictEqual(imagePartsForTest(second), [JPEG_FOR_TEST]);
  const pictureIndex = second.findIndex(function (m) { return Array.isArray(m.content) && m.role === 'user'; });
  assert.strictEqual(second[pictureIndex - 1].role, 'tool', 'the pictures follow the tool results');
  const sentDeck = JSON.parse(second.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'c0'; }).content);
  assert.strictEqual(sentDeck.pictures, rules.PICTURE_STATES.pending);
  assert.match(sentDeck.note, /shown to you in the next message, with no view_file call/);
  assert.doesNotMatch(sentDeck.note, /call view_file with the blob id/);
  assert.strictEqual(sentDeck.look.shown, 'slide 1 at full size');
  assert.strictEqual(sentDeck.look.note, rules.MESSAGES.proxy);
  const savedDeck = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'c0'; }).content);
  assert.strictEqual(savedDeck.pictures, rules.PICTURE_STATES.shown, 'marked shown once the answer came back');
  const savedText = JSON.stringify(outcome.store);
  assert.ok(savedText.indexOf(JPEG_FOR_TEST) === -1, 'no picture is saved');
  assert.ok(savedText.indexOf('_viewImages') === -1);
  assert.ok(savedText.indexOf('kept-deck') === -1, 'the drawing is never saved');
  assert.ok(JSON.stringify(outcome.blobs).indexOf('kept-deck') === -1);
});

test('a deck the loop cannot look at says why, and sends no picture', async function () {
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'pptx', title: 'Deck' }]);
    return answerForTest('Done.');
  }, function (name) {
    if (name === 'create_document') return deckResultForTest({ deck: {}, records: [], title: 'Deck' });
    return { ok: false, error: rules.MESSAGES.printOff };
  });
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[1].messages), []);
  const savedDeck = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'c0'; }).content);
  assert.ok(!('pictures' in savedDeck));
  assert.ok(savedDeck.note.indexOf('Its slides were not shown to you: ' + rules.MESSAGES.printOff) !== -1);
});

test('a model with no vision gets no look at its deck', async function () {
  const names = [];
  await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'pptx', title: 'Deck' }]);
    return answerForTest('Done.');
  }, function (name) {
    names.push(name);
    return name === 'create_document' ? deckResultForTest({ deck: {}, records: [], title: 'Deck' }) : viewResultForTest('x');
  }, { modelKnownNonVision: true });
  assert.deepStrictEqual(names, ['create_document']);
});

test('a look is written into the saved result, at the top for create_document and under document for eval', function () {
  const made = JSON.stringify({ ok: true, format: 'pptx', filename: 'Deck.pptx', note: 'Saved.', result_ref: 7 });
  const look = { ok: true, file: 'Deck.pptx', blob_id: 41, kind: 'pptx', pages: 3, shown: 'slides 1-3 at full size', pictures: rules.PICTURE_STATES.pending, blank_pages: [3], note: rules.MESSAGES.proxy };
  const shown = JSON.parse(rules.addFileLook(made, look));
  assert.strictEqual(shown.pictures, rules.PICTURE_STATES.pending);
  assert.deepStrictEqual(shown.look, { pages: 3, shown: 'slides 1-3 at full size', blank_pages: [3], note: rules.MESSAGES.proxy });
  assert.match(shown.note, /^Saved\. Its slides are shown to you in the next message, with no view_file call\./);
  assert.doesNotMatch(shown.note, /up to four/, 'all shown full size: nothing more to ask for');
  assert.strictEqual(shown.result_ref, 7);
  // markPictures finds the field where addFileLook put it.
  assert.strictEqual(JSON.parse(rules.markPictures(JSON.stringify(shown), 'shown')).pictures, rules.PICTURE_STATES.shown);

  // A long document comes as contact sheets, and the note says how to read pages closely.
  const report = JSON.stringify({ ok: true, format: 'docx', filename: 'report.docx', note: 'Saved.' });
  const sheets = JSON.parse(rules.addFileLook(report, { ok: true, pages: 9, shown: 'pages 1-9 on 2 contact sheets of numbered thumbnails', pictures: rules.PICTURE_STATES.pending }));
  assert.match(sheets.note, /Its pages are shown to you/);
  assert.match(sheets.note, /call view_file with the blob id in displayed_to_user and up to four pages\.$/);

  const fromEval = JSON.parse(rules.addFileLook(JSON.stringify({ ok: true, result: 1, document: { format: 'pdf', note: 'Saved.' } }), look));
  assert.strictEqual(fromEval.pictures, rules.PICTURE_STATES.pending);
  assert.strictEqual(fromEval.document.look.shown, 'slides 1-3 at full size');
  assert.match(fromEval.document.note, /Its pages are shown to you in the next message/);

  // Every page blank: drawn, nothing to send, no pictures field.
  const blank = JSON.parse(rules.addFileLook(made, { ok: true, pages: 1, shown: 'slide 1 at full size', blank_pages: [1], note: 'There is nothing to show: every page asked for is blank.' }));
  assert.ok(!('pictures' in blank));
  assert.match(blank.note, /look says what came out/);

  // A refusal names the reason, and adds the warning only when the reason lacks one.
  const budget = JSON.parse(rules.addFileLook(report, { ok: false, error: 'This reply has looked at 24 pictures.' }));
  assert.match(budget.note, /Its pages were not shown to you: This reply has looked at 24 pictures\. Do not tell the user you checked how it looks\.$/);
  const printOff = JSON.parse(rules.addFileLook(made, { ok: false, error: rules.MESSAGES.printOff }));
  assert.strictEqual(printOff.note.split(/do not tell the user/i).length, 2, 'the warning once');
  assert.strictEqual(rules.addFileLook('not json', look), 'not json');
});

test('an HTML look is summed up and labelled, and its errors are listed once each, at most ten', function () {
  assert.strictEqual(rules.htmlShownSummary(), 'the first screen at desktop width (1280 x 800) and at phone width (390 x 844)');
  assert.strictEqual(rules.htmlPictureLabel('tool.html (blob 3)', 'desktop'), 'tool.html (blob 3), first screen at desktop width (1280 x 800)');
  assert.strictEqual(rules.htmlPictureLabel('tool.html (blob 3)', 'phone'), 'tool.html (blob 3), first screen at phone width (390 x 844)');
  const many = [];
  for (let i = 0; i < 14; i++) many.push('Uncaught Error ' + i);
  many.push('Uncaught Error 0', '   ', 'x'.repeat(400));
  const listed = rules.pageErrors(many);
  assert.strictEqual(listed.errors.length, 10);
  assert.strictEqual(listed.more, 5, 'four more errors and the long line, the repeat and the blank not counted');
  assert.strictEqual(rules.pageErrors(['y'.repeat(400)]).errors[0].length, 300);
  assert.deepStrictEqual(rules.pageErrors(null), { errors: [], more: 0 });
  // Checked in the extension: a 648 px page in the phone window was drawn shrunk to fit, not cut
  // off with a scrollbar, so the old "scrolls sideways" wording described a picture the model never saw.
  assert.strictEqual(rules.phoneOverflow(648, true), 'The page is 648 px wide in a 390 px phone window, so it does not fit a phone. Chrome shrinks the whole page to fit or cuts it off at the right, as the phone picture shows.');
  assert.match(rules.phoneOverflow(648, false), /cuts it off at the right\.$/);
  assert.strictEqual(rules.phoneOverflow(391, true), '', 'a pixel of rounding is not an overflow');
  assert.strictEqual(rules.phoneOverflow(0, true), '');
  assert.strictEqual(rules.printFailure({ ok: false, code: 'no-consent' }, 'html'), rules.MESSAGES.htmlOff);
  assert.strictEqual(rules.printFailure({ ok: false, code: 'declined' }, 'html'), rules.MESSAGES.htmlOff);
  assert.match(rules.printFailure({ ok: false, code: 'failed', error: 'writing the page took too long' }, 'html'), /could not load this page for a look \(writing the page took too long\)/);
  assert.strictEqual(rules.printFailure({ ok: false, code: 'no-consent' }), rules.MESSAGES.printOff, 'a Word file or deck keeps its own message');
});

test('a look at an HTML page or an image is written into its saved result', function () {
  const page = JSON.stringify({ ok: true, format: 'html', filename: 'tool.html', rev: 'r1', note: 'Saved.', result_ref: 4 });
  const seen = JSON.parse(rules.addFileLook(page, {
    ok: true, kind: 'html', shown: rules.htmlShownSummary(), page_height: 1900, phone_overflow: 'The page is 520 px wide', errors: ['Uncaught TypeError: x'],
    pictures: rules.PICTURE_STATES.pending, note: rules.MESSAGES.htmlLoadOnly
  }));
  assert.strictEqual(seen.pictures, rules.PICTURE_STATES.pending);
  assert.deepStrictEqual(seen.look, { shown: rules.htmlShownSummary(), page_height: 1900, phone_overflow: 'The page is 520 px wide', errors: ['Uncaught TypeError: x'], note: rules.MESSAGES.htmlLoadOnly });
  assert.match(seen.note, /^Saved\. The page is shown to you in the next message as it loaded, with no view_file call, and look\.errors lists/);
  assert.match(seen.note, /change it with edit/);
  assert.strictEqual(seen.rev, 'r1');

  const errorsOnly = JSON.parse(rules.addFileLook(page, { ok: true, kind: 'html', errors: [], no_pictures: 'A reply can look at tool.html three times.', note: rules.MESSAGES.htmlLoadOnly }));
  assert.ok(!('pictures' in errorsOnly));
  assert.deepStrictEqual(errorsOnly.look.errors, []);
  assert.strictEqual(errorsOnly.look.no_pictures, 'A reply can look at tool.html three times.');
  assert.match(errorsOnly.note, /loaded for you to check, with no pictures/);

  const notLoaded = JSON.parse(rules.addFileLook(page, { ok: false, error: rules.MESSAGES.htmlOff }));
  assert.ok(notLoaded.note.indexOf('The page was not loaded for a check: ' + rules.MESSAGES.htmlOff) !== -1);

  const image = JSON.stringify({ ok: true, prompt: 'a lighthouse', aspect_ratio: '16:9', width: 1376, height: 768, result_ref: 6 });
  const shownImage = JSON.parse(rules.addFileLook(image, { ok: true, kind: 'image', width: 1376, height: 768, pictures: rules.PICTURE_STATES.pending }));
  assert.strictEqual(shownImage.pictures, rules.PICTURE_STATES.pending);
  assert.strictEqual(shownImage.note, 'The image is shown to you in the next message, with no view_file call.');
  assert.ok(!('look' in shownImage), 'the result already gives the size');
  const refusedImage = JSON.parse(rules.addFileLook(image, { ok: false, error: 'This reply has looked at 24 pictures.' }));
  assert.match(refusedImage.note, /^The image was not shown to you: This reply has looked at 24 pictures\. Do not tell the user/);
});

// Checked against the loop that looked at decks only: the next test fails there, because the PDF
// from eval and the DOCX get no look and the requests after them hold no picture.
test('the loop looks at a DOCX and at a PDF from eval, once per call, and not at edited or converted files', async function () {
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const looks = [];
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'docx', also_pdf: true, content: 'x' }]);
    if (index === 1) return callsForTest('e', 'eval', [{ code: 'return { __document__: {} };' }]);
    if (index === 2) return callsForTest('d', 'edit_document', [{ blob_id: 41 }]);
    if (index === 3) return callsForTest('k', 'convert_document', [{ blob_id: 41 }]);
    return answerForTest('Both look right.');
  }, function (name, args) {
    if (name === 'create_document') {
      return { ok: true, format: 'docx', filename: 'brief.docx', mimeType: DOCX_MIME, dataUrl: 'data:' + DOCX_MIME + ';base64,UEsDBA==', size: 4,
        companion: { format: 'pdf', filename: 'brief.pdf', mimeType: 'application/pdf', dataUrl: PDF_FOR_TEST, size: 9 } };
    }
    if (name === 'eval') {
      return { ok: true, result: 'made', _generatedDocument: { ok: true, format: 'pdf', filename: 'table.pdf', mimeType: 'application/pdf', dataUrl: PDF_FOR_TEST, size: 9 } };
    }
    if (name === 'edit_document') return { ok: true, format: 'docx', filename: 'brief-edited.docx', mimeType: DOCX_MIME, dataUrl: 'data:' + DOCX_MIME + ';base64,UEsDBA==', size: 4 };
    if (name === 'convert_document') return { ok: true, format: 'pdf', filename: 'brief-word.pdf', mimeType: 'application/pdf', dataUrl: PDF_FOR_TEST, size: 9 };
    looks.push(args.blob_id);
    return Object.assign(viewResultForTest('file (blob ' + args.blob_id + '), page 1 of 1'), { blob_id: args.blob_id });
  });
  // Blobs: 41 brief.docx, 42 brief.pdf (also_pdf), 43 table.pdf, 44 edited, 45 converted.
  assert.deepStrictEqual(outcome.blobs.map(function (b) { return b.name; }), ['brief.docx', 'brief.pdf', 'table.pdf', 'brief-edited.docx', 'brief-word.pdf']);
  assert.deepStrictEqual(looks, [41, 43], 'the DOCX, not its PDF; the eval PDF; nothing edited or converted');
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[1].messages), [JPEG_FOR_TEST]);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[2].messages), [JPEG_FOR_TEST], 'each shown once, in the request after it');
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[3].messages), []);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[4].messages), []);
  const savedBrief = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'c0'; }).content);
  assert.strictEqual(savedBrief.pictures, rules.PICTURE_STATES.shown);
  assert.match(savedBrief.note, /Its pages are shown to you/);
  const savedEval = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'e0'; }).content);
  assert.strictEqual(savedEval.pictures, rules.PICTURE_STATES.shown);
  assert.match(savedEval.document.note, /Its pages are shown to you/);
  ['d0', 'k0'].forEach(function (id) {
    const saved = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === id; }).content);
    assert.ok(!('pictures' in saved) && !('look' in saved), id + ' is not looked at');
    assert.doesNotMatch(saved.note, /view_file|shown to you/);
  });
});

// Checked against the loop before this change: the next two tests fail there, because no image
// and no HTML page is looked at, and the requests after them hold no picture.
test('the loop looks at an image made for the user, and not at one marked for a document', async function () {
  const looks = [];
  const respond = function (index) {
    if (index === 0) return callsForTest('g', 'generate_image', [{ prompt: 'a poster', aspect_ratio: '3:4' }, { prompt: 'a cover photo', aspect_ratio: '4:3', for_document: true }]);
    return answerForTest('The poster reads correctly.');
  };
  const tool = function (name, args) {
    if (name === 'generate_image') return { ok: true, prompt: args.prompt, aspectRatio: args.aspect_ratio, dataUrl: PNG_FOR_TEST, width: 768, height: 1024 };
    looks.push(args.blob_id);
    return { ok: true, file: 'generated-image', blob_id: args.blob_id, kind: 'image', width: 768, height: 1024, pictures: rules.PICTURE_STATES.pending, _viewImages: [{ label: 'generated-image (blob ' + args.blob_id + ')', dataUrl: JPEG_FOR_TEST }] };
  };
  const outcome = await runLoopForTest(respond, tool);
  assert.deepStrictEqual(outcome.blobs.map(function (b) { return b.id; }), [41, 42]);
  assert.deepStrictEqual(looks, [41], 'the poster, not the cover photo');
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[1].messages), [JPEG_FOR_TEST]);
  const poster = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'g0'; }).content);
  assert.strictEqual(poster.pictures, rules.PICTURE_STATES.shown);
  assert.strictEqual(poster.note, 'The image is shown to you in the next message, with no view_file call.');
  const cover = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'g1'; }).content);
  assert.ok(!('pictures' in cover) && !('note' in cover));

  looks.length = 0;
  await runLoopForTest(respond, tool, { modelKnownNonVision: true });
  assert.deepStrictEqual(looks, [], 'no look for a model that cannot see');
});

test('the loop loads each HTML page it makes, and each copy edit saves', async function () {
  const looks = [];
  const pageUrl = 'data:text/html;base64,' + Buffer.from('<!DOCTYPE html><html><head></head><body></body></html>').toString('base64');
  const outcome = await runLoopForTest(function (index) {
    if (index === 0) return callsForTest('c', 'create_document', [{ format: 'html', filename: 'tool', html: '<!DOCTYPE html>' }]);
    if (index === 1) return callsForTest('e', 'edit', [{ type: 'attachment', id: 41, old_string: 'a', new_string: 'b' }]);
    if (index === 2) return callsForTest('n', 'edit', [{ type: 'note', id: 3, old_string: 'a', new_string: 'b' }]);
    return answerForTest('The page loads without errors.');
  }, function (name, args) {
    if (name === 'create_document') return { ok: true, format: 'html', filename: 'tool.html', mimeType: 'text/html', dataUrl: pageUrl, size: 60, textContent: '<!DOCTYPE html>', rev: 'r1' };
    if (name === 'edit' && args.type === 'attachment') {
      return { ok: true, type: 'attachment', id: 41, format: 'html', filename: 'tool.html', mimeType: 'text/html', dataUrl: pageUrl, size: 60, textContent: '<!DOCTYPE html>', rev: 'r2', note: 'Made 1 change.' };
    }
    if (name === 'edit') return { ok: true, id: 3, rev: 'n2' };
    looks.push(args.blob_id);
    return {
      ok: true, file: 'tool.html', blob_id: args.blob_id, kind: 'html', shown: rules.htmlShownSummary(), errors: looks.length === 2 ? [] : ['Uncaught ReferenceError: total is not defined (line 9 of the page)'],
      pictures: rules.PICTURE_STATES.pending, note: rules.MESSAGES.htmlLoadOnly,
      _viewImages: [{ label: 'desktop', dataUrl: JPEG_FOR_TEST }, { label: 'phone', dataUrl: PNG_FOR_TEST }]
    };
  });
  assert.deepStrictEqual(outcome.blobs.map(function (b) { return b.id; }), [41, 42]);
  assert.deepStrictEqual(looks, [41, 42], 'the page and the edited copy, and nothing for the note edit');
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[1].messages), [JPEG_FOR_TEST, PNG_FOR_TEST]);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[2].messages), [JPEG_FOR_TEST, PNG_FOR_TEST]);
  assert.deepStrictEqual(imagePartsForTest(outcome.requests[3].messages), []);
  const made = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'c0'; }).content);
  assert.strictEqual(made.pictures, rules.PICTURE_STATES.shown);
  assert.deepStrictEqual(made.look.errors, ['Uncaught ReferenceError: total is not defined (line 9 of the page)']);
  assert.match(made.note, /The page is shown to you in the next message as it loaded/);
  assert.strictEqual(made.rev, 'r1', 'the rev edit needs is kept');
  const edited = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'e0'; }).content);
  assert.strictEqual(edited.pictures, rules.PICTURE_STATES.shown);
  assert.match(edited.note, /^.*Made 1 change\..*The page is shown to you/);
  const noteEdit = JSON.parse(outcome.store.find(function (m) { return m.role === 'tool' && m.tool_call_id === 'n0'; }).content);
  assert.ok(!('look' in noteEdit) && !('pictures' in noteEdit));
});

test('view_file is in the collapsible read-only list and gets the long tool timeout', function () {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'agent/contextBuilder.js'), 'utf8');
  assert.match(source, /COLLAPSIBLE_TOOL_NAMES_FOR_CONTEXT_BUILDER = \{[^}]*view_file: true/);
  const loop = fs.readFileSync(path.join(REPO_ROOT, 'offscreen/agentRun.js'), 'utf8');
  assert.match(loop, /nameForTimeout === 'view_file'/);
  const html = fs.readFileSync(path.join(REPO_ROOT, 'offscreen/offscreen.html'), 'utf8');
  assert.ok(html.indexOf('../agent/fileViewRules.js') !== -1 && html.indexOf('fileViewRender.js') !== -1);
  assert.ok(html.indexOf('../agent/fileViewRules.js') < html.indexOf('../agent/toolExec.js'));
});
