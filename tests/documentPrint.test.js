// The Chrome print route for PDFs: agent/documentPrint.js renders the document blocks as one HTML
// page, createDocument hands that page to deps.printPdf and falls back to the built-in writer,
// and background/documentPrinter.js refuses a page that could run script or fetch from elsewhere.
//
// The renderer and the generator run in a vm context, the way the offscreen document loads them.
// There is no DOMParser in Node, so the html input path is covered by the browser check only.
//
// Checked by breaking the code: with escapeHtmlForDocumentPrint returning its input unchanged the
// escaping test fails, with the route always using the built-in writer the printed-PDF test fails,
// and with checkHtmlForPrinter returning '' the refusal test fails.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..');

// Arrays made inside the vm have the vm's Array prototype, which deepStrictEqual rejects.
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadForTest(language) {
  const ctx = {
    console, Promise, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, btoa, atob,
    navigator: { language: language || 'en-US', userAgent: 'Chrome/140.0.0.0' }
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  ['lib/jszip.min.js', 'agent/documentThemes.js', 'agent/documentGeneration.js', 'agent/documentPrint.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), ctx, { filename: rel });
  });
  return ctx;
}

function loadPrinterForTest() {
  const ctx = {
    console, Promise, setTimeout, clearTimeout, btoa, atob,
    navigator: { userAgent: 'Chrome/140.0.0.0' },
    chrome: {
      runtime: { getURL: (rel) => 'chrome-extension://test/' + rel, lastError: null },
      tabs: { query: (query, callback) => callback([]), remove: () => {} }
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'background/documentPrinter.js'), 'utf8'), ctx, { filename: 'documentPrinter.js' });
  return ctx.ABChatBackground.documentPrinter;
}

function renderForTest(ctx, spec, language) {
  const generation = ctx.ABChatAgent.documentGeneration;
  const themes = ctx.ABChatAgent.documentThemes;
  const resolved = themes.resolveTheme(spec.theme, spec.style);
  const page = themes.resolvePage(spec.page, language || 'en-US');
  const context = { theme: resolved.theme, page, pageNumbers: !!spec.page_numbers, headerText: spec.header || '', warnings: [] };
  assert.ok(generation.layout, 'documentGeneration must export layout for the renderer');
  return ctx.ABChatAgent.documentPrint.renderHtml(spec, context, { title: spec.title || 'Test', lang: language || 'en-US' });
}

const REPORT_BLOCKS = [
  { type: 'title', text: 'Project Atlas', subtitle: 'Kickoff brief' },
  { type: 'heading', level: 1, text: 'Scope' },
  { type: 'bullet', items: ['Matching', { text: 'Exceptions', items: ['Rules', 'Timers'] }, 'Reporting'] },
  { type: 'table', header: true, rows: [['Item', 'Cost'], ['Discovery', '€12,000'], ['Prototype', '€38,000'], ['Pilot', '€45,000'], ['Total', '€95,000']] },
  { type: 'callout', tone: 'warning', title: 'Risk', text: 'The API is in beta.' }
];

const generatorForTest = loadForTest('en-US');

test('a themed document becomes one page with its fonts, page setup, and the DOCX table rules', function () {
  const rendered = renderForTest(generatorForTest, { theme: 'professional', page_numbers: true, header: 'Acme · Confidential', blocks: REPORT_BLOCKS });
  const html = rendered.html;
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /@page \{ size: 612pt 792pt; margin: 72pt 72pt 72pt 72pt; @bottom-right \{ content: counter\(page\) " \/ " counter\(pages\);/);
  assert.match(html, /@top-right \{ content: "Acme · Confidential";/);
  // Professional prints in Source Sans 3, from static Fontsource files, with Calibri as the local fallback.
  assert.match(html, /@font-face \{ font-family: "abchat-source-sans-3"; font-style: normal; font-weight: 700; font-display: block; src: url\("https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/source-sans-3@latest\/latin-700-normal\.woff2"\)/);
  assert.match(html, /body \{ margin: 0; font-family: "abchat-source-sans-3", "Calibri", "abchat-noto-sans", sans-serif;/);
  // Header row repeats on every page, figures are right-aligned, and the total row is bold over a rule.
  assert.match(html, /<thead><tr><th style="[^"]*background-color: #1F3864[^"]*color: #FFFFFF[^"]*">/);
  assert.match(html, /<td style="[^"]*text-align: right[^"]*"><p>€12,000<\/p><\/td>/);
  assert.match(html, /<tr><td style="border-top: 1pt solid #1F3864;[^"]*font-weight: 700[^"]*"><p>Total<\/p>/);
  // Nested bullets nest inside their parent item, as Word's levels do.
  assert.match(html, /<li>Exceptions<ul class="l1"><li>Rules<\/li><li>Timers<\/li><\/ul><\/li>/);
  assert.match(html, /<div class="callout" style="border-left-color: #B7791F;/);
  assert.deepStrictEqual(plain(rendered.fonts.filter((font) => font.userNamed)), []);
  assert.strictEqual(rendered.templates.needed, true);
});

test('document text is escaped and only web and mail links survive', function () {
  const rendered = renderForTest(generatorForTest, {
    blocks: [
      { type: 'paragraph', runs: [{ text: '</style><script>alert(1)</script> & "quoted"' }] },
      { type: 'paragraph', runs: [{ text: 'bad link', href: 'javascript:alert(1)' }, { text: ' good link', href: 'https://example.com/?a=1&b=2' }] },
      { type: 'paragraph', runs: [{ text: 'coloured', color: 'red;background:url(https://evil.example/x)' }] }
    ],
    header: '"</style><b>'
  });
  const html = rendered.html;
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;\/style&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/example\.com\/\?a=1&amp;b=2"> good link<\/a>/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /@top-right \{ content: "\\"\\3c \/style\\3e \\3c b\\3e ";/);
  assert.strictEqual(loadPrinterForTest().checkHtml(html), '');
});

test('scripts in the text add their Noto font, and kana decides between Japanese and Chinese', function () {
  const printer = generatorForTest.ABChatAgent.documentPrint;
  const keys = (text, lang) => plain(printer.detectScriptFonts(text, lang).map((script) => script.id));
  assert.deepStrictEqual(keys('Hello world', 'en-US'), []);
  assert.deepStrictEqual(keys('مرحبا and שלום', 'en-US'), ['noto-sans-arabic', 'noto-sans-hebrew']);
  assert.deepStrictEqual(keys('東京でテスト', 'ja-JP'), ['noto-sans-jp']);
  assert.deepStrictEqual(keys('王小明', 'en-US'), ['noto-sans-sc']);
  assert.deepStrictEqual(keys('王小明', 'zh-TW'), ['noto-sans-tc']);
  const rendered = renderForTest(generatorForTest, { blocks: [{ type: 'paragraph', text: 'Report for 王小明' }] });
  assert.match(rendered.html, /font-family: "abchat-noto-sans-sc"; font-style: normal; font-weight: 400;[^}]*chinese-simplified-400-normal\.woff2[^}]*unicode-range: U\+3000-30FF/);
  assert.match(rendered.html, /body \{ margin: 0; font-family: "abchat-source-sans-3", "abchat-noto-sans-sc", "Calibri", "abchat-noto-sans", sans-serif;/);
  // Arial has Arabic glyphs on Windows and macOS, so with the local name ahead of the Noto face
  // Chrome printed this name in Arial. Fails against the stack that put the local name second.
  const arabic = renderForTest(generatorForTest, { theme: 'modern', blocks: [{ type: 'paragraph', text: 'Names: \u0645\u0631\u062D\u0628\u0627' }] });
  assert.match(arabic.html, /body \{ margin: 0; font-family: "abchat-inter", "abchat-noto-sans-arabic", "Arial", "abchat-noto-sans", sans-serif;/);
});

test('a font the user names is tried from the library and then as an installed font', function () {
  const rendered = renderForTest(generatorForTest, { theme: 'modern', style: { body_font: 'Futura' }, blocks: [{ type: 'paragraph', text: 'Body' }] });
  assert.match(rendered.html, /body \{ margin: 0; font-family: "abchat-futura", "Futura", "abchat-noto-sans", sans-serif;/);
  assert.deepStrictEqual(plain(rendered.fonts.filter((font) => font.userNamed).map((font) => font.family)), ['Futura']);
  // A family with only a regular file must still set the bold and italic text. Chrome skips to the
  // next family when a face's only file 404s, so without the regular file listed second a Lobster
  // heading printed in Helvetica. Fails against the face CSS that listed one file per face.
  assert.match(rendered.html, /font-family: "abchat-futura"; font-style: italic; font-weight: 700; font-display: block; src: url\("[^"]*\/latin-700-italic\.woff2"\) format\("woff2"\), url\("[^"]*\/latin-700-normal\.woff2"\) format\("woff2"\), url\("[^"]*\/latin-400-normal\.woff2"\) format\("woff2"\);/);
  assert.match(rendered.html, /font-family: "abchat-futura"; font-style: normal; font-weight: 400; font-display: block; src: url\("[^"]*\/latin-400-normal\.woff2"\) format\("woff2"\);/);
});

test('a source document keeps its own page, fonts, and table borders, and gets no theme', function () {
  const generation = generatorForTest.ABChatAgent.documentGeneration;
  assert.ok(generation.layout);
  const rendered = generatorForTest.ABChatAgent.documentPrint.renderHtml({
    blocks: [
      { type: 'heading', level: 1, runs: [{ text: 'Agreement', sizePt: 24, font: 'Liberation Sans' }] },
      { type: 'table', rows: [['A', 'B'], ['1', '2']], borderSpec: { top: { widthPt: 1, color: '000000' }, bottom: { widthPt: 1, color: '000000' }, left: null, right: null, insideH: null, insideV: null } }
    ],
    docDefaults: { fontFamily: 'Liberation Serif', fontSizePt: 12, pageWidthPt: 595, pageHeightPt: 842, margins: { top: 28, right: 28, bottom: 28, left: 57 } }
  }, { theme: null, page: null, pageNumbers: false, headerText: '', warnings: [] }, { title: 'Agreement' });
  const html = rendered.html;
  assert.match(html, /@page \{ size: 595pt 842pt; margin: 28pt 28pt 28pt 57pt; \}/);
  // The author's font comes first, then its metric clone, so lines break where they did.
  assert.match(html, /body \{ margin: 0; font-family: "Liberation Serif", "abchat-tinos", "abchat-noto-sans", serif; font-size: 12pt;/);
  assert.match(html, /<span style="font-size: 24pt; font-family: &quot;Liberation Sans&quot;, &quot;abchat-arimo&quot;/);
  assert.match(html, /<td style="border-top: 1pt solid #000000; border-bottom: none; border-left: none; border-right: none"><p>A<\/p><\/td>/);
  assert.doesNotMatch(html, /background-color: #1F3864/);
});

test('createDocument prints through deps.printPdf and falls back to the built-in writer', async function () {
  const generation = generatorForTest.ABChatAgent.documentGeneration;
  const spec = { format: 'pdf', title: 'Atlas', theme: 'professional', blocks: REPORT_BLOCKS };
  let seenJob = null;
  const printed = await generation.createDocument(spec, {
    printPdf: (job) => { seenJob = job; return Promise.resolve({ ok: true, base64: Buffer.from('%PDF-1.7 printed').toString('base64'), warnings: ['a font warning'] }); }
  });
  assert.match(seenJob.html, /<title>Atlas<\/title>/);
  assert.ok(Array.isArray(seenJob.fonts) && seenJob.fonts.length > 0);
  assert.strictEqual(Buffer.from(printed.dataUrl.split(',')[1], 'base64').toString(), '%PDF-1.7 printed');
  assert.strictEqual(printed.size, 16);
  assert.deepStrictEqual(plain(printed.warnings), ['a font warning']);
  assert.strictEqual(printed.note, undefined);

  const declined = await generation.createDocument(spec, { printPdf: () => Promise.resolve({ ok: false, code: 'declined' }) });
  assert.match(Buffer.from(declined.dataUrl.split(',')[1], 'base64').toString('latin1'), /^%PDF-1\.4/);
  // Without the note the reply could promise the theme's fonts, which this file does not have.
  assert.match(declined.note, /^The user chose the built-in PDF writer over printing with Chrome \(Settings can change that\), so it made this PDF/);

  const failed = await generation.createDocument(spec, { printPdf: () => Promise.resolve({ ok: false, code: 'failed', error: 'printing took too long' }) });
  assert.match(Buffer.from(failed.dataUrl.split(',')[1], 'base64').toString('latin1'), /^%PDF-1\.4/);
  assert.match(failed.note, /^Chrome could not print this PDF \(printing took too long\), so the built-in writer made it/);

  const thrown = await generation.createDocument(spec, { printPdf: () => Promise.reject(new Error('channel closed')) });
  assert.match(thrown.note, /\(channel closed\)/);

  const noPrinter = await generation.createDocument(spec, {});
  assert.match(Buffer.from(noPrinter.dataUrl.split(',')[1], 'base64').toString('latin1'), /^%PDF-1\.4/);
  assert.strictEqual(noPrinter.note, undefined);
});

// Replayed against the generator before the cut warnings, the printed route had no warning. With
// the built-in route's own warning left to stand alone (no check of result.builtIn), the declined
// case got both the 5,000-row and the 500-row warning, which contradict each other.
test('a table past 5,000 rows is reported by the route that made the PDF', async function () {
  const generation = generatorForTest.ABChatAgent.documentGeneration;
  const rows = Array.from({ length: 5010 }, function (_, index) { return ['Row ' + index]; });
  const spec = { format: 'pdf', blocks: [{ type: 'table', rows: rows }] };
  const printed = await generation.createDocument(spec, {
    printPdf: () => Promise.resolve({ ok: true, base64: Buffer.from('%PDF-1.7 printed').toString('base64') })
  });
  assert.deepStrictEqual(plain(printed.warnings), ['Table 1 (starting "Row 0") has 5,010 rows, and the PDF keeps the first 5,000. Put the full table in an XLSX, which holds 10,000 rows.']);
  const declined = await generation.createDocument(spec, { printPdf: () => Promise.resolve({ ok: false, code: 'declined' }) });
  assert.deepStrictEqual(plain(declined.warnings), ['A table had 5010 rows; the PDF keeps the first 500. Use XLSX or DOCX for the full table.']);
});

test('the printer refuses a page that could run script or reach outside the document', function () {
  const printer = loadPrinterForTest();
  const page = (body, style) => '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + (style || '') + '</style></head><body>' + body + '</body></html>';
  assert.strictEqual(printer.checkHtml(page('<p>Plain text with src=x, url(y) and onload=z in it.</p>')), '');
  assert.strictEqual(printer.checkHtml(page('<p class="figure"><img alt="" src="data:image/png;base64,iVBORw0KGgo+onab=="></p>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<script>alert(1)</script>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<iframe src="https://example.com"></iframe>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<img src="https://tracker.example/p.gif">')), '');
  // Chrome fetches a bare string in image-set(), so it needs its own check (fails without it, checked).
  assert.notStrictEqual(printer.checkHtml(page('<p style="background-image: image-set(&quot;https://tracker.example/p.png&quot; 1x)">x</p>')), '');
  assert.notStrictEqual(printer.checkHtml(page('', 'p { background: -webkit-image-set("https://tracker.example/p.png" 1x); }')), '');
  assert.notStrictEqual(printer.checkHtml(page('<p onclick="x()">x</p>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<a href="javascript:x()">x</a>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<p>x</p>', 'body { background: url(https://tracker.example/bg.png); }')), '');
  assert.notStrictEqual(printer.checkHtml(page('<p style="background: url(https://tracker.example/bg.png)">x</p>')), '');
  assert.notStrictEqual(printer.checkHtml(page('<p>x</p>', '@import "https://example.com/a.css";')), '');
  assert.notStrictEqual(printer.checkHtml('<meta http-equiv="refresh" content="0;url=https://example.com">'), '');
  assert.strictEqual(printer.checkHtml(page('<p>x</p>', '@font-face { src: url("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff2"); }')), '');
});

// Each list element is its own ol or ul, so a sub-list numbers from 1, a second sub-list in the
// same item opens a new list, and the parent keeps counting. With one tag and one list per depth,
// as before this change, "Sibling sub" joined "Sub again" and the bullet sub-list was numbered.
test('a printed list nests each list element under its item with its own tag', function () {
  const rendered = renderForTest(generatorForTest, { blocks: [{ type: 'list', ordered: true, items: [
    { runs: [{ text: 'One' }], level: 0, ordered: true, key: 0 },
    { runs: [{ text: 'Sub one' }], level: 1, ordered: false, key: 1 },
    { runs: [{ text: 'Two' }], level: 0, ordered: true, key: 0 },
    { runs: [{ text: 'Sub again' }], level: 1, ordered: true, key: 2 },
    { runs: [{ text: 'Sibling sub' }], level: 1, ordered: true, key: 3 },
    { runs: [{ text: 'Three' }], level: 0, ordered: true, key: 0 }
  ] }] });
  assert.ok(rendered.html.includes('<div class="list"><ol class="l0"><li>One<ul class="l1"><li>Sub one</li></ul></li>'
    + '<li>Two<ol class="l1"><li>Sub again</li></ol><ol class="l1"><li>Sibling sub</li></ol></li><li>Three</li></ol></div>'), rendered.html.slice(rendered.html.indexOf('<div class="list">'), rendered.html.indexOf('<div class="list">') + 400));
});

// A PNG header is all the picture loader reads, and the printed page carries the bytes as they are.
function pngHeaderForTest(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return { dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
}

// Replayed against the renderer before covers and pictures, the page had neither. With the
// title's font stack written into its style attribute, as in the first version, the stack's
// quotes closed the attribute early and Chrome printed the title in the default font; the
// style-attribute check fails on that copy (checked).
test('a printed cover is its own named page with no margins, passes the printer check, and keeps font stacks out of style attributes', async function () {
  const generation = generatorForTest.ABChatAgent.documentGeneration;
  const records = { 7: pngHeaderForTest(1600, 1200) };
  let seenJob = null;
  await generation.createDocument({
    format: 'pdf', title: 'Harbour Lights', theme: 'modern', page_numbers: true, header: 'Draft',
    cover: { subtitle: 'Festival plan', details: ['October 2026'], image: 7 },
    blocks: [{ type: 'paragraph', text: 'Body.' }, { type: 'image', blob_id: 7, size: 'small', caption: 'Figure 1. The quay', alt: 'Boats' }]
  }, {
    loadImage: (blobId) => Promise.resolve(records[blobId] || null),
    printPdf: (job) => { seenJob = job; return Promise.resolve({ ok: true, base64: Buffer.from('%PDF-1.7 printed').toString('base64') }); }
  });
  const html = seenJob.html;
  assert.match(html, /@page cover \{ margin: 0; @top-right \{ content: none; \} @bottom-right \{ content: none; \} @bottom-center \{ content: none; \} \}/);
  assert.match(html, /\.cover \{ page: cover;[^}]*break-after: page;/);
  assert.match(html, /<section class="cover"[^>]*><img class="cover-art" alt="" src="data:image\/png;base64,/);
  assert.match(html, /<p class="cover-title"[^>]*>Harbour Lights<\/p>/);
  assert.match(html, /\.cover-title \{ font-family: [^}]+\}/);
  assert.doesNotMatch(html, /style="[^"]*font-family/);
  assert.match(html, /<div class="picture"><img alt="Boats" src="data:image\/png;base64,[^"]+" style="width: 168pt; height: 126pt">/);
  assert.match(html, /<p class="picture-caption">Figure 1\. The quay<\/p>/);
  assert.strictEqual(loadPrinterForTest().checkHtml(html), '');
});
