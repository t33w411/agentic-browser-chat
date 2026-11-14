// Document themes (agent/documentThemes.js), the themed DOCX, PDF, XLSX, and PPTX builders
// (agent/documentGeneration.js), and the drift between the theme module, the create_document
// schema in agent/tools.js, and the document guides (builtin-documents and its four parts).
//
// The builders run in a vm context with the bundled JSZip, the way the offscreen document loads
// them. There is no DOMParser in Node, so only the blocks and content paths are covered here; the
// html path needs a browser.
//
// Checked against the code before this change: against the old documentGeneration.js (no themes,
// Latin-1 PDF text) every DOCX and PDF test fails: the PDF had no /WinAnsiEncoding or /Widths and
// wrote "?" for the euro sign, the DOCX had no header, footer, or numbering parts and wrote bullets
// as "- " text, and the result carried no theme or warnings. The CSV test passes against both, as
// it should: it guards the formats themes do not touch. Against the first version of the theme
// module, where headings followed a brand colour only when the theme's heading colour already
// equalled its primary, the brand colour test fails for modern, classic, minimal and vibrant, and
// with no darkened accent the light colour test fails on the link and callout title.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const themes = require('../agent/documentThemes.js');
const guides = require('../agent/builtinGuides.js');
require('../agent/tools.js');

const REPO_ROOT = path.join(__dirname, '..');

// The offscreen document has CompressionStream, which the PPTX writer uses for pattern PNGs;
// withoutCompression leaves it out, as an older browser would.
function loadGeneratorForTest(language, withoutCompression) {
  const ctx = {
    console, Promise, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, btoa, atob,
    navigator: { language: language || 'en-US' }
  };
  if (!withoutCompression) ctx.CompressionStream = CompressionStream;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  ['lib/jszip.min.js', 'agent/documentThemes.js', 'agent/xlsxFormulas.js', 'agent/documentGeneration.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), ctx, { filename: rel });
  });
  return ctx;
}

const generatorForTest = loadGeneratorForTest('en-US');

async function buildForTest(spec, ctx) {
  const ctxForBuild = ctx || generatorForTest;
  const result = await ctxForBuild.ABChatAgent.documentGeneration.createDocument(spec, {});
  const bytes = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  return { result, bytes, ctx: ctxForBuild };
}

async function docxPartsForTest(spec) {
  const built = await buildForTest(spec);
  const zip = await built.ctx.JSZip.loadAsync(built.bytes);
  const parts = {};
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) parts[name] = await zip.file(name).async('string');
  }
  return { result: built.result, parts };
}

async function pdfTextForTest(spec, ctx) {
  const built = await buildForTest(spec, ctx);
  return { result: built.result, text: built.bytes.toString('latin1') };
}

// The documents guide is split by task; the drift checks read all of its parts together.
const DOCUMENTS_GUIDE_FOR_TEST = ['builtin-documents', 'builtin-docx-pdf', 'builtin-xlsx-csv', 'builtin-pptx', 'builtin-docx-edit']
  .map(function (slugForGuide) { return guides.get(slugForGuide).body; })
  .join('\n\n');

function createDocumentPropsForTest() {
  const def = globalThis.ABChatAgent.toolDefs.find(function (d) { return d.function.name === 'create_document'; });
  return def.function.parameters.properties;
}

// ---- Theme module ----

test('no theme gives professional silently; an unknown theme falls back with a warning', function () {
  const plain = themes.resolveTheme(undefined, undefined);
  assert.strictEqual(plain.theme.name, 'professional');
  assert.deepStrictEqual(plain.warnings, []);
  const unknown = themes.resolveTheme('glossy', undefined);
  assert.strictEqual(unknown.theme.name, 'professional');
  assert.strictEqual(unknown.warnings.length, 1);
  assert.match(unknown.warnings[0], /Unknown theme "glossy"/);
});

test('a brand colour reaches headings and accents in every theme', function () {
  themes.THEME_NAMES.forEach(function (name) {
    const colors = themes.resolveTheme(name, { primary_color: '#E4002B' }).theme.colors;
    assert.strictEqual(colors.primary, 'E4002B', name);
    assert.strictEqual(colors.heading, 'E4002B', name + ' heading');
    assert.strictEqual(colors.accent, 'E4002B', name + ' accent');
  });
});

test('an explicit accent colour is kept alongside the brand colour', function () {
  const colors = themes.resolveTheme('professional', { primary_color: '#E4002B', accent_color: '#0F766E' }).theme.colors;
  assert.strictEqual(colors.heading, 'E4002B');
  assert.strictEqual(colors.accent, '0F766E');
});

test('a light brand colour keeps headings, links, and callout titles readable on white', function () {
  themes.THEME_NAMES.forEach(function (name) {
    const theme = themes.resolveTheme(name, { primary_color: '#FFD100' }).theme;
    const colors = theme.colors;
    assert.ok(themes.luminance(colors.heading) <= 0.3, name + ' heading ' + colors.heading);
    assert.ok(themes.luminance(colors.link) <= 0.3, name + ' link ' + colors.link);
    assert.ok(themes.luminance(colors.accentText) <= 0.3, name + ' accentText ' + colors.accentText);
    assert.ok(themes.luminance(themes.calloutColors(theme, 'info').title) <= 0.3, name + ' callout title');
    if (colors.tableHeaderFill === 'FFD100') {
      assert.ok(themes.luminance(colors.tableHeaderText) <= 0.3, name + ' header text on a yellow fill');
    }
  });
});

test('a bad colour is skipped with a warning and the theme colour is kept', function () {
  const resolved = themes.resolveTheme('modern', { primary_color: 'teal-ish' });
  assert.strictEqual(resolved.theme.colors.primary, '0F766E');
  assert.match(resolved.warnings[0], /primary_color "teal-ish" is not a hex colour/);
});

test('a curated web font maps to an installed Office font; a named font is used as named with a warning', function () {
  const curated = themes.resolveTheme('professional', { heading_font: 'Inter' });
  assert.deepStrictEqual(curated.warnings, []);
  assert.strictEqual(curated.theme.fonts.heading.name, 'Inter');
  assert.strictEqual(curated.theme.fonts.heading.office, 'Arial');
  const named = themes.resolveTheme('professional', { body_font: 'Avenir Next' });
  assert.strictEqual(named.theme.fonts.body.name, 'Avenir Next');
  assert.strictEqual(named.theme.fonts.body.office, 'Avenir Next');
  assert.match(named.warnings[0], /"Avenir Next" is not in the curated list/);
  // A printed PDF embeds the font, so the DOCX warning would tell the user something false.
  assert.deepStrictEqual(themes.resolveTheme('professional', { body_font: 'Avenir Next' }, 'pdf').warnings, []);
});

test('the default page size follows the locale, and landscape swaps the sides', function () {
  assert.strictEqual(themes.defaultPageSizeForLocale('en-US'), 'letter');
  assert.strictEqual(themes.defaultPageSizeForLocale('es-MX'), 'letter');
  assert.strictEqual(themes.defaultPageSizeForLocale('en'), 'letter');
  assert.strictEqual(themes.defaultPageSizeForLocale('en-GB'), 'a4');
  assert.strictEqual(themes.defaultPageSizeForLocale('fr'), 'a4');
  const landscape = themes.resolvePage({ size: 'letter', orientation: 'landscape' }, 'en-GB');
  assert.strictEqual(landscape.widthPt, 792);
  assert.strictEqual(landscape.heightPt, 612);
  const unknown = themes.resolvePage({ size: 'tabloid' }, 'de-DE');
  assert.strictEqual(unknown.size, 'a4');
  assert.match(unknown.warnings[0], /Unknown page size "tabloid"/);
});

// ---- Drift between the module, the schema, and the guide ----

test('the create_document schema enums match the theme module', function () {
  const props = createDocumentPropsForTest();
  assert.deepStrictEqual(props.theme.enum, themes.THEME_NAMES);
  assert.deepStrictEqual(props.page.properties.size.enum, themes.PAGE_SIZE_NAMES);
  assert.deepStrictEqual(props.blocks.items.properties.tone.enum, themes.CALLOUT_TONES);
});

test('the documents guide describes every theme, curated font, and block type', function () {
  themes.THEME_NAMES.forEach(function (name) {
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes('\n- ' + name + ': '), 'theme ' + name);
  });
  themes.listFonts().forEach(function (font) {
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes(font.name), 'font ' + font.name);
  });
  createDocumentPropsForTest().blocks.items.properties.type.enum.forEach(function (type) {
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes('"type": "' + type + '"'), 'block type ' + type);
  });
});

// ---- DOCX ----

test('a themed DOCX has real lists, theme styles, a running header, and page numbers', async function () {
  const { result, parts } = await docxPartsForTest({
    format: 'docx', title: 'Plan', theme: 'classic', page_numbers: true, header: 'Confidential',
    blocks: [{ type: 'title', text: 'Plan' }, { type: 'bullet', items: ['One', 'Two'] }]
  });
  assert.strictEqual(result.theme, 'classic');
  const doc = parts['word/document.xml'];
  assert.match(doc, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/);
  assert.ok(!doc.includes('>- One<'), 'bullets are not typed as "- " text');
  assert.match(parts['word/styles.xml'], /w:styleId="Heading1"[\s\S]*?w:ascii="Georgia"/);
  assert.match(parts['word/header1.xml'], /Confidential/);
  assert.match(parts['word/footer1.xml'], /PAGE/);
  assert.match(parts['docProps/core.xml'], /<dc:title>Plan<\/dc:title>/);
});

test('a long document gets page numbers by default, a short one does not, and false turns them off', async function () {
  const longBlocks = [];
  for (let i = 0; i < 45; i++) longBlocks.push({ type: 'paragraph', text: 'Paragraph ' + i });
  const long = await docxPartsForTest({ format: 'docx', blocks: longBlocks });
  const longOff = await docxPartsForTest({ format: 'docx', page_numbers: false, blocks: longBlocks });
  const short = await docxPartsForTest({ format: 'docx', blocks: [{ type: 'paragraph', text: 'Hi' }] });
  assert.match(long.parts['word/footer1.xml'], /PAGE/);
  assert.strictEqual(longOff.parts['word/footer1.xml'], undefined);
  assert.strictEqual(short.parts['word/footer1.xml'], undefined);
});

test('a DOCX table repeats its header, right-aligns figures, and bolds the total row', async function () {
  const { parts } = await docxPartsForTest({
    format: 'docx', theme: 'professional',
    blocks: [{ type: 'table', header: true, rows: [['Item', 'Amount'], ['A', '1,200'], ['B', '300'], ['Total', '1,500']] }]
  });
  const rows = parts['word/document.xml'].split('<w:tr>').slice(1);
  assert.match(rows[0], /<w:tblHeader\/>/);
  assert.match(rows[1], /<w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">1,200</);
  assert.match(rows[3], /<w:b\/><\/w:rPr><w:t xml:space="preserve">Total</);
  assert.match(rows[3], /<w:b\/><\/w:rPr><w:t xml:space="preserve">1,500</);
});

// ---- PDF ----

test('PDF text is WinAnsi encoded with explicit widths, so the euro sign and accents survive', async function () {
  const { result, text } = await pdfTextForTest({ format: 'pdf', blocks: [{ type: 'paragraph', text: 'Café costs €4,200 – naïve' }] });
  assert.match(text, /\/Encoding \/WinAnsiEncoding \/FirstChar 32 \/LastChar 255 \/Widths \[/);
  // é is 0xE9, € is 0x80, the en dash is 0x96 and ï is 0xEF in cp1252.
  assert.ok(text.includes('Caf\xe9 costs \x804,200 \x96 na\xefve'), 'cp1252 bytes in the content stream');
  assert.strictEqual(result.warnings, undefined);
});

test('characters outside WinAnsi are simplified and reported in a warning', async function () {
  const { result, text } = await pdfTextForTest({ format: 'pdf', blocks: [{ type: 'paragraph', text: 'Łódź 中文' }] });
  assert.ok(text.includes('L\xf3dz ??'), 'Ł and ź lose their marks, ó is kept, CJK becomes ?');
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /Make a DOCX instead/);
  assert.ok(result.warnings[0].includes('中'));
});

test('a PDF table past 500 rows is cut with a warning', async function () {
  const rows = [['N', 'Value']];
  for (let i = 1; i <= 520; i++) rows.push(['Row ' + i, String(i)]);
  const { result, text } = await pdfTextForTest({ format: 'pdf', blocks: [{ type: 'table', header: true, rows }] });
  assert.ok(text.includes('(Row 499)'));
  assert.ok(!text.includes('(Row 500)'), 'the header counts as one of the 500 rows');
  assert.ok(result.warnings.some(function (w) { return /had 521 rows; the PDF keeps the first 500/.test(w); }));
});

test('the PDF page size follows the locale unless page sets it', async function () {
  const a4 = await pdfTextForTest({ format: 'pdf', blocks: [{ type: 'paragraph', text: 'A4' }] }, loadGeneratorForTest('en-GB'));
  assert.match(a4.text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const landscape = await pdfTextForTest({ format: 'pdf', page: { size: 'letter', orientation: 'landscape' }, blocks: [{ type: 'paragraph', text: 'Wide' }] });
  assert.match(landscape.text, /\/MediaBox \[0 0 792\.00 612\.00\]/);
});

test('a CSV gets no theme, and a theme passed for it is ignored without a warning', async function () {
  const { result } = await buildForTest({ format: 'csv', theme: 'vibrant', rows: [['a', 'b']] });
  assert.strictEqual(result.theme, undefined);
  assert.strictEqual(result.warnings, undefined);
});

// ---- Lists ----

// Elements shaped like the DOM nodes the html walker reads: tagName and children only.
function listElementForTest(tag, items) {
  return {
    tagName: tag.toUpperCase(),
    children: items.map(function (item) {
      const text = typeof item === 'string' ? item : item.text;
      const nested = typeof item === 'string' ? [] : item.lists;
      return { tagName: 'LI', text, children: nested };
    })
  };
}

// A nested list must stay under the item it belongs to. The walker before this change emitted
// every item of a list first and its nested lists after, so here it gave One, Two, Three, x, y,
// p and Beta's "sub" last; replayed in a scratch copy of that loop, this test fails against it.
test('an html list keeps each nested list under its item, and each list element has its own key', function () {
  const walk = generatorForTest.ABChatAgent.documentGeneration.layout.htmlListEntries;
  const list = listElementForTest('ol', [
    { text: 'One', lists: [listElementForTest('ul', ['x', 'y'])] },
    { text: 'Two', lists: [listElementForTest('ol', ['p']), listElementForTest('ul', ['q'])] },
    'Three',
    { text: '', lists: [listElementForTest('ul', ['orphan'])] }
  ]);
  const entries = walk(list, function (li) { return [{ text: li.text }]; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(entries.map(function (entry) {
    return [entry.runs[0].text, entry.level, entry.ordered, entry.key];
  }))), [
    ['One', 0, true, 0], ['x', 1, false, 1], ['y', 1, false, 1],
    ['Two', 0, true, 0], ['p', 1, true, 2], ['q', 1, false, 3],
    ['Three', 0, true, 0],
    ['orphan', 1, false, 4]
  ]);
});

const NESTED_LIST_BLOCK_FOR_TEST = { type: 'list', ordered: true, items: [
  { runs: [{ text: 'One' }], level: 0, ordered: true, key: 0 },
  { runs: [{ text: 'Sub one' }], level: 1, ordered: true, key: 1 },
  { runs: [{ text: 'Sub two' }], level: 1, ordered: true, key: 1 },
  { runs: [{ text: 'Two' }], level: 0, ordered: true, key: 0 },
  { runs: [{ text: 'Sub again' }], level: 1, ordered: true, key: 2 },
  { runs: [{ text: 'Sibling sub' }], level: 1, ordered: true, key: 3 },
  { runs: [{ text: 'Three' }], level: 0, ordered: true, key: 0 }
] };

// Word counts on across every w:num that shares an abstractNum, so a second numbered list
// started at 4. Checked in Word, and this test fails without the startOverride.
test('every numbered list restarts at 1 in Word, and a parent list keeps counting after its sub-list', async function () {
  const { parts } = await docxPartsForTest({ format: 'docx', blocks: [
    { type: 'numbered', items: ['A', 'B', 'C'] },
    { type: 'paragraph', text: 'Between' },
    { type: 'numbered', items: ['D'] },
    NESTED_LIST_BLOCK_FOR_TEST
  ] });
  const numbering = parts['word/numbering.xml'];
  assert.match(numbering, /<w:num w:numId="1"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/><\/w:lvlOverride><\/w:num>/);
  assert.match(numbering, /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/><\/w:lvlOverride><\/w:num>/);
  assert.match(numbering, /<w:num w:numId="4"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"\/><\/w:lvlOverride><\/w:num>/);
  const doc = parts['word/document.xml'];
  const order = [];
  doc.replace(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:numId w:val="(\d+)"\/>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>([^<]*)<\/w:t>/g, function (whole, numId, text) {
    order.push(text + ':' + numId);
    return whole;
  });
  assert.deepStrictEqual(order, ['A:1', 'B:1', 'C:1', 'D:2', 'One:3', 'Sub one:4', 'Sub two:4', 'Two:3', 'Sub again:5', 'Sibling sub:6', 'Three:3']);
});

// "Sibling sub" is a second list inside the same item, so it starts again at a. With one set of
// counters per block, as before this change, it read "b." and this test fails.
test('the built-in PDF writer numbers each list element on its own', async function () {
  const { text } = await pdfTextForTest({ format: 'pdf', blocks: [NESTED_LIST_BLOCK_FOR_TEST] });
  const shown = [];
  text.replace(/\(([^)]*)\) Tj/g, function (whole, run) { shown.push(run); return whole; });
  assert.deepStrictEqual(shown.filter(function (run) { return /^(One|Sub one|Sub two|Two|Sub again|Sibling sub|Three|[0-9a-z]+\.)$/.test(run); }),
    ['One', '1.', 'Sub one', 'a.', 'Sub two', 'b.', 'Two', '2.', 'Sub again', 'a.', 'Sibling sub', 'a.', 'Three', '3.']);
});

// ---- XLSX ----
//
// The "could not be worked out" warning was added after a formula with only known functions (an
// array constant here) was found to get no cached value and no warning; the warnings test failed
// on that line before it.
// Checked against the SheetJS writer this one replaced, loaded with lib/xlsx.min.js. The header:
// false test passes against both, as it should, since SheetJS wrote no header styling at all. The
// "=" text and escaping tests fail against it only because SheetJS wrote inline strings rather
// than a shared string table; on the point they guard, both writers are safe. Every other test
// fails on its own point: SheetJS wrote no styles, number formats, pane, filter, or cached formula
// values, threw "Worksheet with name |Calc| already exists!" on a repeated sheet name, stored
// numbers from content as text, cut rows past 5,000 without a warning, and its CSV wrote a formula
// object as "[object Object]".

const XLSX_SPEC_FOR_TEST = { format: 'xlsx', filename: 'q3', sheets: [
  { name: 'Revenue', columns: ['', 'currency:EUR:0', 'currency:EUR:0', 'percent:1'], rows: [
    ['Region', 'Q2', 'Q3', 'Change'],
    ['North', 1480000, 1655000, { f: 'C2/B2-1' }],
    ['South', 1210000, 1402000, { f: 'C3/B3-1' }],
    ['Total', { f: 'SUM(B2:B3)' }, { f: 'sum(C2:C3)' }, { f: 'C4/B4-1' }]
  ] },
  { name: 'Orders', rows: [
    ['Order', 'Date', 'Note'],
    ['SO-1', '2026-07-02', '=HYPERLINK("http://example.com","open")'],
    ['SO-2', '2026-07-09', { f: 'IFS(1>0,"a")' }]
  ] }
] };

function xlsxCellForTest(sheetXml, ref) {
  const match = sheetXml.match(new RegExp('<c r="' + ref + '"(?:[^>]*/>|[^>]*>[\\s\\S]*?</c>)'));
  assert.ok(match, 'cell ' + ref);
  return match[0];
}

// The number format code and boldness that a cell's style index points at.
function xlsxLookForTest(stylesXml, cellXml) {
  const xfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b(?:[^>]*\/>|[^>]*[^/]>[\s\S]*?<\/xf>)/g);
  const fonts = stylesXml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)[1].match(/<font>[\s\S]*?<\/font>/g);
  const xf = xfs[Number((cellXml.match(/ s="(\d+)"/) || [0, 0])[1])];
  const numFmtId = xf.match(/numFmtId="(\d+)"/)[1];
  const custom = stylesXml.match(new RegExp('<numFmt numFmtId="' + numFmtId + '" formatCode="([^"]*)"/>'));
  return {
    format: custom ? custom[1].replace(/&quot;/g, '"') : numFmtId,
    bold: fonts[Number(xf.match(/fontId="(\d+)"/)[1])].indexOf('<b/>') !== -1
  };
}

test('an XLSX has the theme font, a bold frozen header with filter buttons, and print setup', async function () {
  const { result, parts } = await docxPartsForTest(XLSX_SPEC_FOR_TEST);
  assert.strictEqual(result.theme, 'professional');
  const office = themes.resolveTheme('professional', {}, 'xlsx').theme.fonts.body.office;
  const fontNames = parts['xl/styles.xml'].match(/<name val="[^"]*"\/>/g);
  assert.ok(fontNames.length > 0 && fontNames.every(function (n) { return n === '<name val="' + office + '"/>'; }));
  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.ok(xlsxLookForTest(parts['xl/styles.xml'], xlsxCellForTest(sheet, 'A1')).bold);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:D3"\/>/);
  assert.match(sheet, /<pageSetup [^>]*fitToWidth="1"/);
  assert.match(sheet, /<oddFooter>&amp;C&amp;P \/ &amp;N<\/oddFooter>/);
  const workbook = parts['xl/workbook.xml'];
  assert.ok(workbook.includes('<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Revenue\'!$A$1:$D$3</definedName>'));
  assert.ok(workbook.includes('<definedName name="_xlnm.Print_Titles" localSheetId="0">\'Revenue\'!$1:$1</definedName>'));
  // Excel refuses a worksheet whose elements are out of schema order.
  const order = ['<sheetPr', '<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<autoFilter', '<pageMargins', '<pageSetup', '<headerFooter'];
  const positions = order.map(function (tag) { return sheet.indexOf(tag); });
  assert.ok(positions.every(function (pos, i) { return pos !== -1 && (i === 0 || pos > positions[i - 1]); }), positions.join(','));
});

// The first version of this writer tracked fills for the whole workbook, so the fill on the
// second sheet turned off the first sheet's stripes too. This test failed against it.
test('theme stripes are conditional formatting in schema order, and a sheet with its own fills gets none', async function () {
  const rows = [['Name', 'Score']];
  for (let i = 1; i <= 5; i++) rows.push(['P' + i, i * 10]);
  const { parts } = await docxPartsForTest({ format: 'xlsx', theme: 'professional', sheets: [
    { name: 'Striped', rows },
    { name: 'Filled', rows: rows.map(function (row, i) { return i === 2 ? [{ v: row[0], fill: '#FFF2CC' }, row[1]] : row; }) }
  ] });
  const striped = parts['xl/worksheets/sheet1.xml'];
  assert.match(striped, /<conditionalFormatting sqref="A2:B6"><cfRule type="expression" dxfId="0" priority="1"><formula>MOD\(ROW\(\),2\)=1<\/formula><\/cfRule><\/conditionalFormatting>/);
  assert.ok(striped.indexOf('<autoFilter') < striped.indexOf('<conditionalFormatting') && striped.indexOf('<conditionalFormatting') < striped.indexOf('<pageMargins'));
  assert.match(parts['xl/styles.xml'], /<dxfs count="1">/);
  assert.doesNotMatch(parts['xl/worksheets/sheet2.xml'], /<conditionalFormatting/);
});

test('the total row is bold and kept out of the filter', async function () {
  const { parts } = await docxPartsForTest(XLSX_SPEC_FOR_TEST);
  const sheet = parts['xl/worksheets/sheet1.xml'];
  const styles = parts['xl/styles.xml'];
  assert.ok(xlsxLookForTest(styles, xlsxCellForTest(sheet, 'A4')).bold);
  assert.ok(xlsxLookForTest(styles, xlsxCellForTest(sheet, 'B4')).bold);
  assert.ok(!xlsxLookForTest(styles, xlsxCellForTest(sheet, 'B3')).bold);
  assert.match(sheet, /<autoFilter ref="A1:D3"\/>/);
});

test('number formats come from the column, ISO dates become date serials, and the header stays text', async function () {
  const { parts } = await docxPartsForTest(XLSX_SPEC_FOR_TEST);
  const styles = parts['xl/styles.xml'];
  const revenue = parts['xl/worksheets/sheet1.xml'];
  assert.strictEqual(xlsxLookForTest(styles, xlsxCellForTest(revenue, 'B2')).format, '"€"#,##0');
  assert.strictEqual(xlsxLookForTest(styles, xlsxCellForTest(revenue, 'D2')).format, '0.0%');
  assert.match(xlsxCellForTest(revenue, 'B1'), / t="s"/);
  const orders = parts['xl/worksheets/sheet2.xml'];
  const date = xlsxCellForTest(orders, 'B2');
  assert.match(date, /<v>46205<\/v>/);
  assert.doesNotMatch(date, / t="/);
  assert.strictEqual(xlsxLookForTest(styles, date).format, 'yyyy-mm-dd');
});

// The first version of this writer passed any text holding one of the letters y, m, d, h or s
// through as a raw format code, so "USD" and "dollars" reached styles.xml and Excel would repair
// the file. Replayed with that condition in a scratch copy, this test fails.
test('a word that is not a format code is left out with a warning, and a real code is kept', async function () {
  const { result, parts } = await docxPartsForTest({ format: 'xlsx', sheets: [
    { name: 'Units', columns: ['USD', '#,##0.0 "kg"', 'dollars'], rows: [['Price', 'Weight', 'Cost'], [4, 2.5, 9]] }
  ] });
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /"USD" was not recognised/);
  assert.match(warnings, /"dollars" was not recognised/);
  const styles = parts['xl/styles.xml'];
  assert.doesNotMatch(styles, /formatCode="(USD|dollars)"/);
  assert.ok(styles.includes('formatCode="#,##0.0 &quot;kg&quot;"'));
});

test('formulas carry their worked-out value, and newer functions are stored with their prefix', async function () {
  const { parts } = await docxPartsForTest(XLSX_SPEC_FOR_TEST);
  const revenue = parts['xl/worksheets/sheet1.xml'];
  assert.match(xlsxCellForTest(revenue, 'B4'), /<f>SUM\(B2:B3\)<\/f><v>2690000<\/v>/);
  assert.match(xlsxCellForTest(revenue, 'C4'), /<f>SUM\(C2:C3\)<\/f><v>3057000<\/v>/);
  assert.match(xlsxCellForTest(revenue, 'D4'), /<f>C4\/B4-1<\/f><v>0\.1364312267657992\d*<\/v>/);
  const ifs = xlsxCellForTest(parts['xl/worksheets/sheet2.xml'], 'C3');
  assert.match(ifs, / t="str"/);
  assert.match(ifs, /<f>_xlfn\.IFS\(1&gt;0,&quot;a&quot;\)<\/f><v>a<\/v>/);
  assert.match(parts['xl/workbook.xml'], /<calcPr [^>]*fullCalcOnLoad="1"/);
});

test('a string that starts with "=" is stored as text, never as a formula', async function () {
  const { parts } = await docxPartsForTest(XLSX_SPEC_FOR_TEST);
  const orders = parts['xl/worksheets/sheet2.xml'];
  assert.match(xlsxCellForTest(orders, 'C2'), / t="s"/);
  assert.doesNotMatch(orders, /<f>[^<]*HYPERLINK/);
  assert.ok(parts['xl/sharedStrings.xml'].includes('<t>=HYPERLINK(&quot;http://example.com&quot;,&quot;open&quot;)</t>'));
});

test('formula problems and renamed sheets come back as warnings naming the cell', async function () {
  const { result, parts } = await docxPartsForTest({ format: 'xlsx', sheets: [
    { name: 'Calc', rows: [
      ['Input', 'Result'],
      [1, { f: '1/0' }],
      [2, { f: 'SUM(A2;A3)' }],
      [3, { f: 'UNIQUE(A2:A4)' }],
      [4, { f: 'FOO(A2)' }],
      [5, { f: 'B7+1' }],
      [6, { f: 'B6+1' }],
      [7, { f: 'SUM({1,2})' }]
    ] },
    { name: 'Calc', rows: [['x']] }
  ] });
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /named "Calc \(2\)"/);
  assert.match(warnings, /give an error: Calc!B2 =1\/0 gives #DIV\/0!/);
  assert.match(warnings, /written as text: Calc!B3 \(arguments are separated by commas/);
  assert.match(warnings, /cannot spread[^\n]*Calc!B4 \(UNIQUE\)/);
  assert.match(warnings, /Formulas using FOO have no saved result/);
  assert.match(warnings, /circular reference\): Calc!B6; Calc!B7\./);
  assert.match(warnings, /could not be worked out here[^\n]*: Calc!B8\./);
  assert.match(xlsxCellForTest(parts['xl/worksheets/sheet1.xml'], 'B3'), / t="s"/);
  assert.ok(parts['xl/sharedStrings.xml'].includes('<t>=SUM(A2;A3)</t>'));
});

test('header: false keeps the first row as data, with no frozen pane or filter', async function () {
  const { parts } = await docxPartsForTest({ format: 'xlsx', sheets: [
    { name: 'Notes', header: false, rows: [['Prepared by', 'Finance'], ['Period', 'Q3 2026'], ['Status', 'Draft']] }
  ] });
  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(sheet, /<pane /);
  assert.doesNotMatch(sheet, /<autoFilter /);
  assert.doesNotMatch(parts['xl/workbook.xml'], /_FilterDatabase/);
  assert.ok(!xlsxLookForTest(parts['xl/styles.xml'], xlsxCellForTest(sheet, 'A1')).bold);
});

test('XLSX text is escaped, and characters XML cannot hold are dropped', async function () {
  const control = 'a' + String.fromCharCode(1) + 'b';
  const loneSurrogate = String.fromCharCode(0xD800) + 'x';
  const { parts } = await docxPartsForTest({ format: 'xlsx', sheets: [
    { name: 'Text', rows: [['Value'], ['<b>&"'], [control], [loneSurrogate]] }
  ] });
  const strings = parts['xl/sharedStrings.xml'];
  assert.ok(strings.includes('<t>&lt;b&gt;&amp;&quot;</t>'));
  assert.ok(strings.includes('<t>ab</t>'));
  assert.ok(strings.includes('<t>x</t>'));
});

test('content text that reads as a number is stored as a number', async function () {
  const { parts } = await docxPartsForTest({ format: 'xlsx', content: 'Item,Qty\nPens,12\nInk,3.5' });
  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.match(xlsxCellForTest(sheet, 'B2'), /^<c r="B2"(?![^>]* t=")[^>]*><v>12<\/v><\/c>$/);
  assert.match(xlsxCellForTest(sheet, 'B3'), /<v>3\.5<\/v>/);
});

test('a sheet past 10,000 rows keeps the first 10,000 and says so', async function () {
  const rows = [['Row']];
  for (let i = 1; i <= 10000; i++) rows.push([i]);
  const { result, parts } = await docxPartsForTest({ format: 'xlsx', sheets: [{ name: 'Long', rows }] });
  assert.match(result.warnings.join('\n'), /Sheet "Long" keeps the first 10000 of 10001 rows/);
  assert.match(parts['xl/worksheets/sheet1.xml'], /<dimension ref="A1:A10000"\/>/);
});

// Checked in Excel by opening a CSV of these cells: the guarded ones ran as formulas (=1+1 gave 2,
// +HYPERLINK made a link, - item gave #NAME?), and the others opened as typed. Against the writer
// before the guard, this test fails on the first guarded cell.
test('a CSV cell that Excel would run as a formula starts with an apostrophe; phone numbers and numbers do not', async function () {
  const built = await buildForTest({ format: 'csv', rows: [
    ['v'], ['=1+1'], ['@SUM(1,2)'], ['+A1'], ['- item'], ['+HYPERLINK("http://x","y")'],
    ['+234 803 123 4567'], ['-'], ['@x'], ['-1,234.50'], [-5]
  ] });
  assert.strictEqual(built.bytes.toString('utf8'),
    'v\r\n\'=1+1\r\n"\'@SUM(1,2)"\r\n\'+A1\r\n\'- item\r\n"\'+HYPERLINK(""http://x"",""y"")"\r\n+234 803 123 4567\r\n-\r\n@x\r\n"-1,234.50"\r\n-5\r\n');
  assert.match(built.result.warnings.join('\n'), /5 cells starting with =, @, \+ or - would run as a formula/);
});

test('a CSV writes each formula as its result, and an error formula as an empty cell with a warning', async function () {
  const built = await buildForTest({ format: 'csv', rows: [
    ['a', 'b', 'sum'],
    [1, 2, { f: 'A2+B2' }],
    [{ v: 3 }, 4, { f: 'A3/0' }]
  ] });
  assert.strictEqual(built.bytes.toString('utf8'), 'a,b,sum\r\n1,2,3\r\n3,4,\r\n');
  assert.match(built.result.warnings.join('\n'), /C3 \(#DIV\/0!\)/);
});

// Replayed against the writer before these warnings: the first assertion fails, because the result
// had no warnings at all for the extra sheet, the 105-column row, or the 12,000-character cell, and
// the content-path rows were cut to 10,000 with no warning either.
test('a CSV says when it leaves out sheets, rows, columns, or long cell text', async function () {
  const wide = await buildForTest({ format: 'csv', sheets: [
    { rows: [Array.from({ length: 105 }, function (_, index) { return 'c' + index; }), ['y'.repeat(12000)]] },
    { rows: [['other sheet']] }
  ] });
  assert.deepStrictEqual(Array.from(wide.result.warnings), [
    'A CSV holds one table, so only the first of 2 sheets was written. Make an XLSX to keep every sheet.',
    'The CSV keeps the first 100 columns; the widest row had 105. Split the data across files.',
    '1 cell was cut to 10,000 characters.'
  ]);
  const lines = wide.bytes.toString('utf8').split('\r\n');
  assert.strictEqual(lines[0].split(',').length, 100);
  assert.strictEqual(lines[1].length, 10000);

  const long = await buildForTest({ format: 'csv', content: Array.from({ length: 10005 }, function (_, index) { return 'r' + index; }).join('\n') });
  assert.deepStrictEqual(Array.from(long.result.warnings), ['The CSV keeps the first 10,000 of 10,005 rows. Split the data across files.']);

  const atLimits = await buildForTest({ format: 'csv', rows: [
    Array.from({ length: 100 }, function (_, index) { return 'c' + index; }),
    ['y'.repeat(10000)]
  ] });
  assert.strictEqual(atLimits.result.warnings, undefined);
});

// ---- PPTX ----
//
// Checked against the writer this one replaced (the staged copy of agent/documentGeneration.js),
// with this file's loader pointed at it. Every PPTX test fails there on its own point: that writer
// had one layout and the same palette and Aptos fonts whatever the theme, returned no theme, put
// every slide on that layout, wrote "- One" with its dash beside a second bullet, used one fixed
// text size, wrote no slide numbers, notes, tables, stats or columns, kept control characters, which
// XML does not allow, and returned no warnings at all. The layouts drift test
// fails against the schema and guide before this change, which had no layout field.

const PPTX_LAYOUT_PARTS_FOR_TEST = { title: '1', section: '2', bullets: '3', two_column: '4', big_number: '5', table: '5' };

function pptxLayoutPartForTest(parts, slideNumber) {
  const rels = parts['ppt/slides/_rels/slide' + slideNumber + '.xml.rels'];
  assert.ok(rels, 'slide ' + slideNumber + ' rels');
  return rels.match(/slideLayouts\/slideLayout(\d+)\.xml/)[1];
}

function pptxSizesForTest(slideXml) {
  return (slideXml.match(/<a:rPr lang="en-US" sz="(\d+)"/g) || []).map(function (attr) { return Number(attr.match(/sz="(\d+)"/)[1]); });
}

test('a PPTX has a slide master, six layouts, and the theme\'s colours and fonts in its theme part', async function () {
  const { result, parts } = await docxPartsForTest({ format: 'pptx', theme: 'vibrant', slides: [{ title: 'Launch', subtitle: 'Spring' }, { title: 'Plan', bullets: ['One'] }] });
  const vibrant = themes.resolveTheme('vibrant').theme;
  assert.strictEqual(result.theme, 'vibrant');
  assert.match(parts['ppt/presentation.xml'], /<p:sldSz cx="12192000" cy="6858000"\/>/);
  for (let i = 1; i <= 8; i++) assert.ok(parts['ppt/slideLayouts/slideLayout' + i + '.xml'], 'layout ' + i);
  const layoutTypes = [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return parts['ppt/slideLayouts/slideLayout' + i + '.xml'].match(/<p:sldLayout [^>]* type="(\w+)"/)[1]; });
  assert.deepStrictEqual(layoutTypes, ['title', 'secHead', 'obj', 'twoObj', 'titleOnly', 'blank', 'picTx', 'picTx']);
  const themeXml = parts['ppt/theme/theme1.xml'];
  assert.match(themeXml, new RegExp('<a:accent1><a:srgbClr val="' + vibrant.colors.primary + '"/></a:accent1>'));
  assert.match(themeXml, new RegExp('<a:accent2><a:srgbClr val="' + vibrant.colors.accentText + '"/></a:accent2>'));
  assert.match(themeXml, new RegExp('<a:dk1><a:srgbClr val="' + vibrant.colors.text + '"/></a:dk1>'));
  assert.match(themeXml, /<a:majorFont><a:latin typeface="Arial"\/>/);
  assert.match(themeXml, /<a:minorFont><a:latin typeface="Calibri"\/>/);
  // vibrant fills its title slide with the primary colour.
  assert.match(parts['ppt/slideLayouts/slideLayout1.xml'], /<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"\/>/);
});

test('each slide takes the layout its content implies, or the one asked for', async function () {
  const { parts } = await docxPartsForTest({ format: 'pptx', slides: [
    { title: 'Deck', subtitle: 'Today' },
    { title: 'List', bullets: ['One', 'Two'] },
    { title: 'Compare', left: { heading: 'A', bullets: ['x'] }, right: ['y'] },
    { title: 'Figures', stats: [{ value: '9%', label: 'Growth' }] },
    { title: 'Data', table: [['a', 'b'], ['1', '2']] },
    { title: 'Part two' },
    { layout: 'Section', title: 'Asked for', subtitle: 'by name' }
  ] });
  const expected = ['title', 'bullets', 'two_column', 'big_number', 'table', 'section', 'section'];
  expected.forEach(function (layout, index) {
    assert.strictEqual(pptxLayoutPartForTest(parts, index + 1), PPTX_LAYOUT_PARTS_FOR_TEST[layout], 'slide ' + (index + 1));
  });
  assert.match(parts['ppt/slides/slide3.xml'], /<p:ph sz="half" idx="1"\/>[\s\S]*<a:t>A<\/a:t>[\s\S]*<p:ph sz="half" idx="2"\/>[\s\S]*<a:t>y<\/a:t>/);
  assert.match(parts['ppt/slides/slide4.xml'], /<a:t>9%<\/a:t>[\s\S]*<a:t>Growth<\/a:t>/);
  // An empty column is left off rather than shown as "Click to add text". Checked against this
  // writer before that fix, which wrote the right placeholder with an empty paragraph.
  const oneColumn = await docxPartsForTest({ format: 'pptx', slides: [{ title: 'D' }, { title: 'Only left', left: ['a'] }] });
  assert.match(oneColumn.parts['ppt/slides/slide2.xml'], /idx="1"/);
  assert.doesNotMatch(oneColumn.parts['ppt/slides/slide2.xml'], /idx="2"/);
  assert.match(parts['ppt/slides/slide5.xml'], /<a:tbl>[\s\S]*<a:t>1<\/a:t>/);
});

test('typed bullet marks are removed, level 1 makes a sub-bullet, and **bold** becomes a bold run', async function () {
  const { parts } = await docxPartsForTest({ format: 'pptx', slides: [
    { title: 'Intro', subtitle: 'x' },
    { title: 'Points', bullets: ['- One', '• Two', { text: 'Under two', level: 1 }, 'Say **this** loudly', 'Keep **this'] },
    { title: 'Text', content: '* Alpha\n  - Beta' }
  ] });
  const slide = parts['ppt/slides/slide2.xml'];
  assert.match(slide, /<a:t>One<\/a:t>/);
  assert.match(slide, /<a:t>Two<\/a:t>/);
  assert.doesNotMatch(slide, /<a:t>[-•] /);
  assert.match(slide, /lvl="1"[^>]*>[\s\S]*?<a:t>Under two<\/a:t>/);
  assert.match(slide, /<a:rPr lang="en-US" sz="\d+" b="1" dirty="0"><\/a:rPr><a:t>this<\/a:t>/);
  assert.match(slide, /<a:t>Keep \*\*this<\/a:t>/);
  const fromContent = parts['ppt/slides/slide3.xml'];
  assert.match(fromContent, /lvl="0"[^>]*>[\s\S]*?<a:t>Alpha<\/a:t>/);
  assert.match(fromContent, /lvl="1"[^>]*>[\s\S]*?<a:t>Beta<\/a:t>/);
});

test('text is sized to fit: a short list stays large, a long one gets smaller, and one that cannot fit is named in a warning', async function () {
  const long = 'This bullet says something moderately long so that the slide fills up and the size drops';
  const tooLong = long + ' and then keeps going with more words than any slide could hold at a readable size, ' + long;
  const { result, parts } = await docxPartsForTest({ format: 'pptx', slides: [
    { title: 'Deck' },
    { title: 'Short', bullets: ['One', 'Two', 'Three'] },
    { title: 'Long', bullets: Array.from({ length: 12 }, function () { return long; }) },
    { title: 'Too long', bullets: Array.from({ length: 12 }, function () { return tooLong; }) }
  ] });
  const shortSizes = pptxSizesForTest(parts['ppt/slides/slide2.xml']);
  assert.deepStrictEqual(shortSizes.slice(1), [2400, 2400, 2400]);
  const longSize = pptxSizesForTest(parts['ppt/slides/slide3.xml'])[1];
  assert.ok(longSize < 2400 && longSize >= 1400, 'long list at ' + longSize);
  assert.match(result.warnings.join('\n'), /more text than fits[^\n]*: 4\. Split/);
});

test('a slide table takes the theme\'s table style, right-aligns figures, and cuts rows that cannot fit', async function () {
  const rows = [['Region', 'Q3', 'Change'], ['North', '$1.66M', '+11.8%'], ['South', '$1.40M', '+15.9%'], ['Total', '$3.06M', '+13.6%']];
  const { parts } = await docxPartsForTest({ format: 'pptx', theme: 'professional', slides: [{ title: 'D' }, { title: 'Regions', table: { rows } }] });
  const professional = themes.resolveTheme('professional').theme;
  const slide = parts['ppt/slides/slide2.xml'];
  assert.match(slide, /<a:tblPr firstRow="1" bandRow="1"\/>/);
  assert.match(slide, new RegExp('<a:t>Region</a:t>[\\s\\S]*?<a:solidFill><a:srgbClr val="' + professional.colors.tableHeaderFill + '"/></a:solidFill></a:tcPr>'));
  assert.match(slide, /<a:pPr algn="r"\/><a:r><a:rPr lang="en-US" sz="\d+" dirty="0"><a:solidFill><a:srgbClr val="[0-9A-F]{6}"\/><\/a:solidFill><\/a:rPr><a:t>\$1\.66M<\/a:t>/);
  assert.match(slide, /<a:rPr lang="en-US" sz="\d+" b="1" dirty="0">[\s\S]{0,80}<a:t>Total<\/a:t>/);

  const longRows = [['Week', 'Task']];
  for (let i = 1; i <= 40; i++) longRows.push(['W' + i, 'Task ' + i]);
  const cut = await docxPartsForTest({ format: 'pptx', slides: [{ title: 'D' }, { title: 'Weeks', table: { rows: longRows } }] });
  const kept = (cut.parts['ppt/slides/slide2.xml'].match(/<a:tr /g) || []).length - 1;
  assert.ok(kept > 5 && kept < 40, kept + ' rows kept');
  assert.match(cut.result.warnings.join('\n'), new RegExp('The table on slide 2 keeps the first ' + kept + ' of 40 rows'));
});

test('speaker notes get a notes master and a notes slide, and a deck without notes has neither', async function () {
  const { parts } = await docxPartsForTest({ format: 'pptx', slides: [{ title: 'A' }, { title: 'B', bullets: ['x'], notes: 'Say <this> & that\nSecond line' }] });
  assert.match(parts['[Content_Types].xml'], /\/ppt\/notesMasters\/notesMaster1\.xml/);
  assert.match(parts['ppt/presentation.xml'], /<p:notesMasterIdLst><p:notesMasterId r:id="rId3"\/><\/p:notesMasterIdLst>/);
  assert.match(parts['ppt/slides/_rels/slide2.xml.rels'], /notesSlides\/notesSlide2\.xml/);
  assert.match(parts['ppt/notesSlides/notesSlide2.xml'], /<a:t>Say &lt;this&gt; &amp; that<\/a:t>[\s\S]*<a:t>Second line<\/a:t>/);
  assert.strictEqual(parts['ppt/notesSlides/notesSlide1.xml'], undefined);

  const plain = await docxPartsForTest({ format: 'pptx', slides: [{ title: 'A' }, { title: 'B', bullets: ['x'] }] });
  assert.ok(!Object.keys(plain.parts).some(function (name) { return /notes/i.test(name); }));
  assert.doesNotMatch(plain.parts['ppt/presentation.xml'], /notesMaster/);
});

// Notes go wherever the file goes, so a deck gets them only when the user asks. The guide is the only
// thing that decides whether the model writes them; outside the notes field and the size limit, no
// line may mention them, and the example deck has none, since the model copies it. Checked against
// the guide before this change, which said "Detail and talking points go in notes." and put notes in
// its example: the field line had no rule, and with only the field line fixed, the directive and the
// example were both still found.
test('the pptx guide has the model write speaker notes only when the user asks for them', function () {
  const bodyForNotes = guides.get('builtin-pptx').body;
  const fieldLineForNotes = bodyForNotes.split('\n').find(function (line) { return line.indexOf('- notes, on any slide:') === 0; });
  assert.ok(fieldLineForNotes, 'notes field line');
  assert.match(fieldLineForNotes, /only when the user asks for speaker notes, talking points, or a script/);
  assert.match(fieldLineForNotes, /left out, not moved to notes/);
  const otherLinesForNotes = bodyForNotes.split('\n').filter(function (line) {
    return /\bnotes\b/i.test(line) && line !== fieldLineForNotes && line.indexOf('- Per slide:') !== 0;
  });
  assert.deepStrictEqual(otherLinesForNotes, []);
});

test('content slides are numbered unless page_numbers is false, and title and section slides never are', async function () {
  const slides = [{ title: 'Cover' }, { title: 'List', bullets: ['x'] }, { layout: 'section', title: 'Part' }, { title: 'Figures', stats: ['3'] }];
  const numbered = await docxPartsForTest({ format: 'pptx', slides });
  const hasNumber = function (parts, n) { return /type="slidenum"/.test(parts['ppt/slides/slide' + n + '.xml']); };
  assert.deepStrictEqual([1, 2, 3, 4].map(function (n) { return hasNumber(numbered.parts, n); }), [false, true, false, true]);
  assert.match(numbered.parts['ppt/slides/slide4.xml'], /<a:fld [^>]*type="slidenum"><a:rPr lang="en-US"\/><a:t>4<\/a:t>/);
  const off = await docxPartsForTest({ format: 'pptx', page_numbers: false, slides });
  assert.deepStrictEqual([1, 2, 3, 4].map(function (n) { return hasNumber(off.parts, n); }), [false, false, false, false]);
});

test('PPTX text is escaped, and characters XML cannot hold are dropped', async function () {
  const { parts } = await docxPartsForTest({ format: 'pptx', title: 'A & B', slides: [{ title: 'Q&A <draft>', subtitle: '"quoted"' }, { title: 'x', bullets: ['a < b', 'bell\u0007here', 'lone \ud800 surrogate'] }] });
  assert.match(parts['ppt/slides/slide1.xml'], /<a:t>Q&amp;A &lt;draft&gt;<\/a:t>/);
  const slide = parts['ppt/slides/slide2.xml'];
  assert.match(slide, /<a:t>a &lt; b<\/a:t>/);
  assert.match(slide, /<a:t>bellhere<\/a:t>/);
  assert.match(slide, /<a:t>lone  surrogate<\/a:t>/);
  assert.match(parts['docProps/core.xml'], /<dc:title>A &amp; B<\/dc:title>/);
});

test('cut, unknown, and dropped slide content comes back as warnings', async function () {
  const { result, parts } = await docxPartsForTest({ format: 'pptx', slides: [
    { title: 'Cover', bullets: ['dropped'], layout: 'title' },
    { title: 'Many', bullets: Array.from({ length: 15 }, function (_, i) { return 'b' + i; }) },
    { title: 'Odd', layout: 'carousel', bullets: ['kept'] },
    { title: 'No table', layout: 'table', bullets: ['kept'] },
    { title: 'Five', stats: ['1', '2', '3', '4', '5'] },
    { title: 'Wide', table: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']] }
  ] });
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /at most 12 bullets\. Cut on slide 2 \(15\)/);
  assert.match(warnings, /Unknown layout on slide 3 \("carousel"\)/);
  assert.match(warnings, /Slide 4 asked for a layout without its content/);
  assert.match(warnings, /at most 4 numbers\. Cut on slide 5 \(5\)/);
  assert.match(warnings, /at most 8 columns\. Cut on slide 6/);
  assert.match(warnings, /Content on slide 1 was left out/);
  assert.strictEqual(pptxLayoutPartForTest(parts, 3), PPTX_LAYOUT_PARTS_FOR_TEST.bullets);
  assert.strictEqual(pptxLayoutPartForTest(parts, 4), PPTX_LAYOUT_PARTS_FOR_TEST.bullets);
  assert.doesNotMatch(parts['ppt/slides/slide1.xml'], /dropped/);
});

test('a light brand colour fills the cover with dark text; a dark one with white text', async function () {
  const light = await docxPartsForTest({ format: 'pptx', theme: 'modern', style: { primary_color: '#FFD60A' }, slides: [{ title: 'Brand', subtitle: 'x' }] });
  const dark = await docxPartsForTest({ format: 'pptx', theme: 'modern', slides: [{ title: 'Brand', subtitle: 'x' }] });
  const coverText = function (parts) {
    return parts['ppt/slideLayouts/slideLayout1.xml'].match(/<p:ph type="ctrTitle"\/>[\s\S]*?<a:defRPr[^>]*><a:solidFill><a:schemeClr val="(\w+)"/)[1];
  };
  assert.strictEqual(coverText(light.parts), 'tx1');
  assert.strictEqual(coverText(dark.parts), 'bg1');
  // classic keeps its covers white, with the title in the heading colour.
  const classic = await docxPartsForTest({ format: 'pptx', theme: 'classic', slides: [{ title: 'Policy' }] });
  assert.doesNotMatch(classic.parts['ppt/slideLayouts/slideLayout1.xml'], /<p:bg>/);
  assert.strictEqual(coverText(classic.parts), 'tx2');
});

test('the documents guide and the create_document schema describe the same slide layouts', function () {
  const layouts = createDocumentPropsForTest().slides.items.properties.layout.enum;
  assert.deepStrictEqual(layouts, ['title', 'section', 'bullets', 'two_column', 'big_number', 'table', 'image']);
  layouts.forEach(function (layout) {
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes('\n- ' + layout + ': {'), 'layout ' + layout);
  });
});

// ---- PPTX pictures, backgrounds, and patterns ----
//
// Node has no canvas, so here a picture is never redrawn or sampled: PNG, JPEG and GIF go in as
// they are, anything else is reported, and a background photo gets the overlay that works for
// any photo. The canvas paths (WebP and SVG converted, large photos scaled down, EXIF turns
// applied, photos sampled for the overlay) were checked in the extension's offscreen document
// and the decks opened in PowerPoint. The overlay rule itself is tested on pixels made here.
//
// Checked against the writer before pictures: every test below fails there, since it had no
// image layout, background, media parts or slidePictures export. Checked against the first
// version with pictures: the beside-the-text picture left its position to the layout (PowerPoint
// then drew nothing, so the position test fails), the layout's picture placeholder had a fill
// (which showed through a transparent logo), and the overlay judged every area against the
// theme's lightest text colour, so a title on a mid-grey photo got white text under a dark
// overlay instead of the theme's dark title colour with none.

const zlib = require('zlib');

function crcForTest(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    let c = (crc ^ byte) & 255;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngForTest(width, height, rgb) {
  const chunk = function (type, data) {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crcForTest(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Only the header of a JPEG: an EXIF block with an orientation tag, then the frame size.
function jpegForTest(width, height, orientation) {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const app1 = [0xFF, 0xE1, (exif.length + 2) >> 8, (exif.length + 2) & 255].concat(exif);
  const sof = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xFF, 0xD8].concat(app1, sof, [0xFF, 0xD9]));
}

function imageRecordForTest(mime, bytes) {
  return { dataUrl: 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64') };
}

async function pptxWithPicturesForTest(spec, records, withoutLoader) {
  const deps = withoutLoader ? {} : { loadImage: function (blobId) { return Promise.resolve(records[blobId] || null); } };
  const result = await generatorForTest.ABChatAgent.documentGeneration.createDocument(spec, deps);
  const zip = await generatorForTest.JSZip.loadAsync(Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  const parts = {};
  const binary = {};
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (/^ppt\/media\//.test(name)) binary[name] = Buffer.from(await zip.file(name).async('uint8array'));
    else parts[name] = await zip.file(name).async('string');
  }
  return { result, parts, binary };
}

function linearForTest(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}
function luminanceForTest(rgb) {
  return 0.2126 * linearForTest(rgb[0]) + 0.7152 * linearForTest(rgb[1]) + 0.0722 * linearForTest(rgb[2]);
}
function contrastForTest(first, second) {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function rgbForTest(hex) {
  return [0, 2, 4].map(function (at) { return parseInt(hex.substr(at, 2), 16) / 255; });
}
function emuForTest(points) {
  return String(Math.round(points * 12700));
}

const PHOTO_RECORDS_FOR_TEST = {
  101: imageRecordForTest('image/jpeg', jpegForTest(1600, 900, 1)),
  102: imageRecordForTest('image/png', pngForTest(400, 400, [91, 33, 182])),
  103: imageRecordForTest('image/png', pngForTest(100, 100, [200, 200, 200]))
};

test('the picture header reader finds a JPEG\'s size past its EXIF block and notices a turned photo', function () {
  const read = generatorForTest.ABChatAgent.documentGeneration.slidePictures.imageInfo;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(read(jpegForTest(1600, 900, 6)))), { ext: 'jpeg', width: 1600, height: 900, turned: true });
  assert.strictEqual(read(jpegForTest(1600, 900, 1)).turned, false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(read(pngForTest(7, 5, [0, 0, 0])))), { ext: 'png', width: 7, height: 5, turned: false });
  assert.strictEqual(read(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')), null);
});

test('an image slide puts its picture beside the bullets, under the title, or across the slide', async function () {
  const { parts, result } = await pptxWithPicturesForTest({ format: 'pptx', slides: [
    { title: 'Deck' },
    { title: 'Beside', bullets: ['a'], image: { blob_id: 101, alt: 'Bay at "dusk"' } },
    { title: 'Left', bullets: ['a'], image: { blob_id: 102, side: 'left', fit: 'contain' } },
    { title: 'Under', image: 101 },
    { image: 101 }
  ] }, PHOTO_RECORDS_FOR_TEST);
  assert.strictEqual(result.warnings, undefined);
  assert.deepStrictEqual([2, 3, 4, 5].map(function (n) { return pptxLayoutPartForTest(parts, n); }), ['7', '8', '3', '6']);
  const beside = parts['ppt/slides/slide2.xml'];
  assert.match(beside, /<p:cNvPr id="5" name="Picture" descr="Bay at &quot;dusk&quot;"\/>/);
  assert.match(beside, /<p:ph type="pic" idx="1"\/>/);
  // A 16:9 photo in a half-slide box keeps its middle half: a quarter off each side.
  assert.match(beside, /<a:srcRect l="25000" r="25000"\/>/);
  // PowerPoint draws nothing for a picture that leaves its position to the layout.
  assert.match(beside, new RegExp('<a:off x="' + emuForTest(480) + '" y="0"/><a:ext cx="' + emuForTest(480) + '" cy="' + emuForTest(540) + '"/>'));
  // contain: the square logo fits the padded half on the left, centred, uncropped.
  const left = parts['ppt/slides/slide3.xml'];
  assert.doesNotMatch(left, /srcRect/);
  assert.match(left, new RegExp('<a:off x="' + emuForTest(36) + '" y="' + emuForTest(66) + '"/><a:ext cx="' + emuForTest(408) + '" cy="' + emuForTest(408) + '"/>'));
  assert.match(parts['ppt/slides/slide4.xml'], /<p:ph idx="1"\/>[\s\S]*<a:blip r:embed="rId10"\/><a:stretch>/);
  assert.doesNotMatch(parts['ppt/slides/slide5.xml'], /<p:ph /);
  // One picture used on three slides is stored once.
  const media = Object.keys(parts['[Content_Types].xml'].match(/Default Extension="(jpeg|png)"/g) || []).length;
  assert.ok(media >= 2);
  assert.match(parts['[Content_Types].xml'], /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/);
  assert.match(parts['[Content_Types].xml'], /<Default Extension="png" ContentType="image\/png"\/>/);
  const targets = [2, 4, 5].map(function (n) { return parts['ppt/slides/_rels/slide' + n + '.xml.rels'].match(/Target="\.\.\/media\/([^"]+)"/)[1]; });
  assert.strictEqual(new Set(targets).size, 1);
  assert.match(targets[0], /^image\d+\.jpeg$/);
  // The layout's picture placeholder has no fill to show through a transparent picture.
  assert.doesNotMatch(parts['ppt/slideLayouts/slideLayout7.xml'].match(/<p:ph type="pic" idx="1"\/>[\s\S]*?<\/p:spPr>/)[0], /solidFill/);
});

test('a photo background gets an overlay just opaque enough for its text, which takes the overlay\'s colour', async function () {
  const { parts } = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', slides: [
    { title: 'Cover', background: { image: 101 } },
    { title: 'Over a photo', bullets: Array.from({ length: 9 }, function (_, i) { return 'Point ' + (i + 1) + ' takes most of a line at the smaller sizes, so the whole list is set below 18 points and needs 4.5:1 here'; }), background: { image: 101 } }
  ] }, PHOTO_RECORDS_FOR_TEST);
  const professional = themes.resolveTheme('professional').theme;
  const slide = parts['ppt/slides/slide2.xml'];
  assert.match(slide, /<p:sld [^>]* showMasterSp="0">/);
  assert.match(slide, /<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId10"\/><a:stretch>/);
  const overlay = slide.match(/name="Overlay"[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"><a:alpha val="(\d+)"\/>/);
  assert.strictEqual(overlay[1], professional.colors.text);
  // With no pixels to read, the opacity is the least that holds for a pure white photo: white
  // text under 18 points reaches 4.5:1 there, and 2 points less would not.
  assert.ok(Math.max.apply(null, pptxSizesForTest(slide).slice(1)) < 1800, 'body set below 18 pt');
  const opacity = Number(overlay[2]) / 100000;
  const over = function (amount) {
    return luminanceForTest(rgbForTest(professional.colors.text).map(function (channel) { return amount * channel + (1 - amount); }));
  };
  assert.ok(contrastForTest(1, over(opacity)) >= 4.5, 'meets 4.5:1 at ' + opacity);
  assert.ok(contrastForTest(1, over(opacity - 0.02)) < 4.5, 'not more than needed: ' + opacity);
  assert.match(slide, /<a:buClr><a:srgbClr val="FFFFFF"\/><\/a:buClr>/);
  assert.match(slide, /<a:solidFill><a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t>Point 1 /);
  assert.match(slide, /<a:fld [^>]*type="slidenum"><a:rPr lang="en-US"><a:solidFill><a:srgbClr val="FFFFFF"\/>/);
  // A cover's title is large text and needs only 3:1, so its overlay is lighter.
  const coverOpacity = Number(parts['ppt/slides/slide1.xml'].match(/name="Overlay"[\s\S]*?<a:alpha val="(\d+)"\/>/)[1]) / 100000;
  assert.ok(coverOpacity < opacity, coverOpacity + ' < ' + opacity);
});

test('the overlay follows the photo\'s pixels under the text, and reaches the target for the text\'s own colour', function () {
  const overlay = generatorForTest.ABChatAgent.documentGeneration.slidePictures.overlay;
  const photo = function (pixel) {
    const data = new Uint8ClampedArray(192 * 108 * 4);
    for (let y = 0; y < 108; y++) {
      for (let x = 0; x < 192; x++) {
        const rgb = pixel(x, y);
        data.set([rgb[0], rgb[1], rgb[2], 255], (y * 192 + x) * 4);
      }
    }
    return { width: 192, height: 108, data };
  };
  const professional = themes.resolveTheme('professional').theme;
  const bodyArea = [{ box: { x: 54, y: 148, w: 852, h: 120 }, target: 4.5, role: 'body' }];
  const onBlack = overlay(photo(() => [0, 0, 0]), bodyArea, professional);
  assert.deepStrictEqual([onBlack.opacity, onBlack.ink.body], [0, 'FFFFFF']);
  const onWhite = overlay(photo(() => [255, 255, 255]), bodyArea, professional);
  assert.deepStrictEqual([onWhite.scrim, onWhite.opacity, onWhite.ink.body], ['FFFFFF', 0, professional.colors.text]);
  // Bright only below the text: the text's area is dark, so no overlay is needed.
  const brightBelow = overlay(photo((x, y) => (y > 60 ? [255, 255, 255] : [10, 10, 10])), bodyArea, professional);
  assert.strictEqual(brightBelow.opacity, 0);
  // A busy photo: the chosen opacity brings 98% of the pixels under the text to 4.5:1.
  const busy = overlay(photo((x, y) => ((x + y) % 2 ? [250, 250, 250] : [20, 20, 20])), bodyArea, professional);
  assert.ok(busy.opacity > 0.4 && busy.opacity < 1, String(busy.opacity));
  const scrim = rgbForTest(busy.scrim);
  const textLuminance = luminanceForTest(rgbForTest(busy.ink.body));
  const met = [[250, 250, 250], [20, 20, 20]].every(function (pixel) {
    const blended = pixel.map(function (channel, i) { return busy.opacity * scrim[i] + (1 - busy.opacity) * channel / 255; });
    return contrastForTest(textLuminance, luminanceForTest(blended)) >= 4.5;
  });
  assert.ok(met);
  // A title on a mid-grey photo is checked against the title's colour (vibrant's deep purple),
  // which reads there without an overlay, not against the theme's lightest text colour.
  const vibrant = themes.resolveTheme('vibrant').theme;
  const titleOnGrey = overlay(photo(() => [188, 188, 188]), [{ box: { x: 54, y: 30, w: 852, h: 40 }, target: 3, role: 'title' }], vibrant);
  assert.deepStrictEqual([titleOnGrey.opacity, titleOnGrey.ink.title], [0, vibrant.colors.heading]);
});

test('a colour background turns the text white or dark to suit it', async function () {
  const { parts } = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', slides: [
    { title: 'Deck' },
    { title: 'Navy', bullets: ['a'], background: { color: '#0B1F3A' } },
    { title: 'Sand', bullets: ['b'], background: 'F5E6C8' }
  ] }, {});
  const professional = themes.resolveTheme('professional').theme;
  assert.match(parts['ppt/slides/slide2.xml'], /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0B1F3A"\/>/);
  assert.match(parts['ppt/slides/slide2.xml'], /<a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t>Navy<\/a:t>/);
  assert.match(parts['ppt/slides/slide3.xml'], new RegExp('<a:srgbClr val="' + professional.colors.heading + '"/></a:solidFill></a:rPr><a:t>Sand</a:t>'));
  assert.doesNotMatch(parts['ppt/slides/slide3.xml'], /name="Overlay"/);
});

test('a pattern is a PNG in the theme\'s colours, stored once for every slide that uses it', async function () {
  const { parts, binary } = await pptxWithPicturesForTest({ format: 'pptx', theme: 'vibrant', slides: [
    { title: 'Launch', background: { pattern: 'waves' } },
    { title: 'One', bullets: ['a'], background: { pattern: 'grid' } },
    { title: 'Two', bullets: ['b'], background: 'grid' }
  ] }, {});
  const vibrant = themes.resolveTheme('vibrant').theme;
  assert.deepStrictEqual(Object.keys(binary).sort(), ['ppt/media/image1.png', 'ppt/media/image2.png']);
  assert.doesNotMatch(parts['ppt/slides/slide2.xml'], /showMasterSp/);
  const decode = function (png) {
    let at = 8;
    const chunks = {};
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const type = png.toString('latin1', at + 4, at + 8);
      assert.strictEqual(png.readUInt32BE(at + 8 + length), crcForTest(png.subarray(at + 4, at + 8 + length)), type + ' CRC');
      chunks[type] = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    const rows = zlib.inflateSync(chunks.IDAT);
    const colours = new Set();
    for (let y = 0; y < 1080; y += 7) {
      for (let x = 0; x < 1920; x += 3) {
        const p = y * 5761 + 1 + x * 3;
        colours.add(rows.subarray(p, p + 3).toString('hex').toUpperCase());
      }
    }
    return { width: chunks.IHDR.readUInt32BE(0), height: chunks.IHDR.readUInt32BE(4), rows: rows.length, colours };
  };
  // The cover's pattern sits on the theme's main colour, the content slides' on white.
  const cover = decode(binary['ppt/media/image1.png']);
  assert.deepStrictEqual([cover.width, cover.height, cover.rows], [1920, 1080, 1080 * (1920 * 3 + 1)]);
  assert.ok(cover.colours.has(vibrant.colors.primary), 'cover base');
  const grid = decode(binary['ppt/media/image2.png']);
  assert.ok(grid.colours.has('FFFFFF'), 'white base');
  // The lines are under a pixel wide, so they are drawn as mixes of white and the line colour,
  // a tint of the primary; every pixel lies between the two.
  const line = rgbForTest(themes.tintHexColor(vibrant.colors.primary, 0.86));
  let deepest = 0;
  grid.colours.forEach(function (hex) {
    const mix = rgbForTest(hex).map(function (channel, i) { return (1 - channel) / (1 - line[i]); });
    assert.ok(Math.max.apply(null, mix) - Math.min.apply(null, mix) < 0.08, hex + ' is a mix of white and the line colour');
    deepest = Math.max(deepest, mix[0]);
  });
  assert.ok(deepest > 0.6, 'lines are visible: ' + deepest);
  assert.strictEqual(parts['ppt/slides/_rels/slide2.xml.rels'].match(/media\/image\d\.png/)[0], parts['ppt/slides/_rels/slide3.xml.rels'].match(/media\/image\d\.png/)[0]);
});

// Checked against the writer before the default: the first assertion fails there, since a
// professional cover had no background part. The pixels of the tiled, natively compressed
// pattern were compared in a scratch script with the earlier per-pixel drawing and were the same
// byte for byte for every pattern on white and on a filled cover (with the dots' row gap set to
// 17.5 in both).
test('a filled cover or section slide gets the theme\'s pattern unless it has a background or "none"', async function () {
  const spec = { format: 'pptx', theme: 'professional', slides: [
    { title: 'Deck', subtitle: 'October' },
    { title: 'Body', bullets: ['a'] },
    { layout: 'section', title: 'Part two' },
    { layout: 'section', title: 'Flat', background: 'none' },
    { layout: 'section', title: 'Coloured', background: { color: '#0B1F3A' } },
    { layout: 'section', title: 'Lost photo', background: { image: 999 } },
    { layout: 'section', title: 'Photo', image: 101, background: 'none' }
  ] };
  const { result, parts, binary } = await pptxWithPicturesForTest(spec, PHOTO_RECORDS_FOR_TEST);
  const target = function (n) {
    const match = (parts['ppt/slides/_rels/slide' + n + '.xml.rels'] || '').match(/Target="\.\.\/media\/([^"]+)"/);
    return match ? match[1] : '';
  };
  assert.match(parts['ppt/slides/slide1.xml'], /<p:bg><p:bgPr><a:blipFill/);
  assert.match(target(1), /\.png$/);
  assert.strictEqual(target(3), target(1));
  assert.strictEqual(target(6), target(1), 'a picture that could not be used leaves the pattern');
  assert.doesNotMatch(parts['ppt/slides/slide2.xml'], /<p:bg>/);
  assert.doesNotMatch(parts['ppt/slides/slide4.xml'], /<p:bg>/);
  assert.match(parts['ppt/slides/slide5.xml'], /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0B1F3A"\/>/);
  assert.match(target(7), /\.jpeg$/, '"none" does not stop a cover photo');
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /slide 6 background \(blob 999 was not found\)/);
  assert.doesNotMatch(warnings, /has a background that is not/);
  assert.strictEqual(Object.keys(binary).filter(function (name) { return /\.png$/.test(name); }).length, 1);

  // The pattern is a grid on the theme's main colour, and the PNG made without CompressionStream
  // has the same pixels.
  const pixels = function (png) {
    let at = 8;
    const idat = [];
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    return zlib.inflateSync(Buffer.concat(idat));
  };
  const cover = pixels(binary['ppt/media/' + target(1)]);
  const primary = themes.resolveTheme('professional').theme.colors.primary;
  const pixelHex = function (x, y) { const at = y * 5761 + 1 + x * 3; return cover.subarray(at, at + 3).toString('hex').toUpperCase(); };
  assert.strictEqual(pixelHex(20, 20), primary, 'between the lines');
  assert.notStrictEqual(pixelHex(0, 20), primary, 'on a line');
  const plain = loadGeneratorForTest('en-US', true);
  const plainResult = await plain.ABChatAgent.documentGeneration.createDocument({ format: 'pptx', theme: 'professional', slides: [{ title: 'Deck' }] }, {});
  const plainZip = await plain.JSZip.loadAsync(Buffer.from(plainResult.dataUrl.split(',')[1], 'base64'));
  const plainPng = Object.keys(plainZip.files).filter(function (name) { return /\.png$/.test(name); });
  assert.strictEqual(plainPng.length, 1);
  assert.ok(pixels(Buffer.from(await plainZip.file(plainPng[0]).async('uint8array'))).equals(cover));

  // Plain covers stay white.
  const minimal = await pptxWithPicturesForTest({ format: 'pptx', theme: 'minimal', slides: [{ title: 'Deck' }, { layout: 'section', title: 'Part' }] }, {});
  assert.deepStrictEqual(Object.keys(minimal.binary), []);
  assert.doesNotMatch(minimal.parts['ppt/slides/slide1.xml'], /<p:bg>/);
});

// Checked against the writer before a lone slide was drawn as a cover: the first assertion fails,
// since the slide had no background. With only the number rule taken out, the slide number check
// fails, and with only the accent's fallback to the heading colour taken out, the yellow figures
// check fails.
test('a deck of one slide is drawn as its cover, with no number, unless it has a picture, a background, or a plain theme', async function () {
  const target = function (parts) {
    const match = (parts['ppt/slides/_rels/slide1.xml.rels'] || '').match(/Target="\.\.\/media\/([^"]+)"/);
    return match ? match[1] : '';
  };
  const lone = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', slides: [{ title: 'Decisions we need today', bullets: ['Approve the price rise', 'Release the hiring budget'] }] }, {});
  const slide = lone.parts['ppt/slides/slide1.xml'];
  assert.match(slide, /<p:sld [^>]*showMasterSp="0"><p:cSld><p:bg><p:bgPr><a:blipFill/);
  assert.match(target(lone.parts), /\.png$/);
  assert.match(slide, /<a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t>Decisions we need today<\/a:t>/);
  assert.match(slide, /<a:buClr><a:srgbClr val="FFFFFF"\/><\/a:buClr>/);
  assert.doesNotMatch(slide, /type="slidenum"/);
  // The pattern is drawn on the main colour, as on a filled cover.
  const png = lone.binary['ppt/media/' + target(lone.parts)];
  let at = 8;
  const idat = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const rows = zlib.inflateSync(Buffer.concat(idat));
  assert.strictEqual(rows.subarray(20 * 5761 + 1 + 20 * 3, 20 * 5761 + 1 + 21 * 3).toString('hex').toUpperCase(), themes.resolveTheme('professional').theme.colors.primary);

  const numbered = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', page_numbers: true, slides: [{ title: 'One', bullets: ['a'] }] }, {});
  assert.match(numbered.parts['ppt/slides/slide1.xml'], /type="slidenum"/);

  const keptWhite = [
    { format: 'pptx', theme: 'professional', slides: [{ title: 'One', bullets: ['a'], background: 'none' }] },
    { format: 'pptx', theme: 'minimal', slides: [{ title: 'One', bullets: ['a'] }] },
    { format: 'pptx', theme: 'professional', slides: [{ title: 'One', bullets: ['a'], image: { blob_id: 101 } }] }
  ];
  for (const spec of keptWhite) {
    const built = await pptxWithPicturesForTest(spec, PHOTO_RECORDS_FOR_TEST);
    assert.doesNotMatch(built.parts['ppt/slides/slide1.xml'], /<p:bg>/, JSON.stringify(spec.slides[0]) + ' ' + spec.theme);
    assert.ok(!Object.keys(built.binary).some(function (name) { return /\.png$/.test(name); }));
  }

  // Two slides with no title slide keep the plain content look and their numbers.
  const two = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', slides: [{ title: 'One', bullets: ['a'] }, { title: 'Two', bullets: ['b'] }] }, {});
  assert.doesNotMatch(two.parts['ppt/slides/slide1.xml'], /<p:bg>/);
  assert.match(two.parts['ppt/slides/slide1.xml'], /type="slidenum"/);

  // On a light brand colour the text is dark, and figures and bullets, which use the accent (a
  // shade of that colour), take the heading colour instead.
  const yellowTheme = themes.resolveTheme('modern', { primary_color: '#F5C400' }).theme;
  const yellow = await pptxWithPicturesForTest({ format: 'pptx', theme: 'modern', style: { primary_color: '#F5C400' }, slides: [{ title: 'In numbers', stats: [{ value: '55,000', label: 'Visitors' }] }] }, {});
  assert.match(yellow.parts['ppt/slides/slide1.xml'], new RegExp('<a:srgbClr val="' + yellowTheme.colors.heading + '"/></a:solidFill><a:latin typeface="\\+mj-lt"/></a:rPr><a:t>55,000</a:t>'));
});

// Checked by giving the grid a repeat of 60 pixels instead of 64: the test fails on the grid, at
// a pixel the drawing puts on a line and the copy leaves plain.
test('a pattern copied from one repeat has the pixels of the pattern drawn point by point', function () {
  const pictures = generatorForTest.ABChatAgent.documentGeneration.slidePictures;
  const base = [0x1F, 0x38, 0x64];
  const ink = [0x35, 0x4B, 0x73];
  let seed = 7;
  const next = function (limit) { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
  ['dots', 'grid', 'diagonal', 'waves'].forEach(function (name) {
    const rows = pictures.patternRows(name, '1F3864', '354B73');
    assert.strictEqual(rows.length, 1080 * 5761);
    for (let i = 0; i < 4000; i++) {
      const x = next(1920);
      const y = next(1080);
      const coverage = pictures.patternCoverage(name, (x + 0.5) / 2, (y + 0.5) / 2, 2);
      const at = y * 5761 + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        const expected = Math.floor(base[c] + (ink[c] - base[c]) * coverage + 0.5);
        assert.ok(Math.abs(rows[at + c] - expected) <= 1, name + ' at ' + x + ',' + y + ': ' + rows[at + c] + ' against ' + expected);
      }
    }
  });
});

test('pictures that cannot be used are reported, and their slides are made without them', async function () {
  const records = Object.assign({
    201: { dataUrl: 'data:text/plain;base64,aGk=' },
    203: imageRecordForTest('image/webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))
  }, PHOTO_RECORDS_FOR_TEST);
  const { result, parts } = await pptxWithPicturesForTest({ format: 'pptx', slides: [
    { title: 'Cover', image: 101 },
    { title: 'Missing', bullets: ['kept'], image: 202 },
    { title: 'Text file', bullets: ['kept'], background: { image: 201 } },
    { title: 'WebP', bullets: ['kept'], image: { blob_id: 203 } },
    { title: 'Not an id', bullets: ['kept'], image: { blob_id: 'abc' } },
    { title: 'Table', table: [['a'], ['1']], image: 101 },
    { title: 'Tiny', bullets: ['kept'], image: 103 },
    { title: 'Plaid', bullets: ['kept'], background: { pattern: 'plaid' } }
  ] }, records);
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /slide 2 \(blob 202 was not found\); slide 3 background \(blob 201 is not an image\); slide 4 \(blob 203 is image\/webp, which could not be converted\); slide 5 \(blob id "abc" is not a blob id\)/);
  assert.match(warnings, /The image on slide 6 was left out/);
  assert.match(warnings, /look soft: slide 7 \(100 x 100 pixels\)/);
  assert.match(warnings, /Slide 8 has a background that is not/);
  // An image on a title slide is its background.
  assert.match(parts['ppt/slides/slide1.xml'], /<p:bg><p:bgPr><a:blipFill/);
  assert.strictEqual(pptxLayoutPartForTest(parts, 2), PPTX_LAYOUT_PARTS_FOR_TEST.bullets);
  assert.doesNotMatch(parts['ppt/slides/slide2.xml'], /<p:pic>/);
  assert.doesNotMatch(parts['ppt/slides/slide3.xml'], /<p:bg>/);

  const unloaded = await pptxWithPicturesForTest({ format: 'pptx', slides: [{ title: 'A' }, { title: 'B', bullets: ['x'], image: 101 }] }, {}, true);
  assert.match(unloaded.result.warnings.join('\n'), /slide 2 \(blob 101 could not be loaded here\)/);
});

// ---- DOCX and PDF content past the limits ----
//
// Blocks past 500, table rows past 5,000, and columns past 100 used to be cut with nothing in the
// result. Replayed against the generator before the warnings, both tests fail on their first
// assertion, because the result had no warnings. Replayed with only the row-count fix undone, the
// PDF test fails on "A table had 5000 rows" (the grid had already cut the table before the
// built-in writer counted it). The html path (html past 200,000 characters, blocks past 500 in
// html) needs a DOMParser, so it was checked with jsdom in a scratch harness instead, before and
// after the change.

function paragraphsForTest(count) {
  return Array.from({ length: count }, function (_, index) { return { type: 'paragraph', text: 'Para ' + index }; });
}
// Tall tables are one column wide and wide tables one row tall: a tall table whose first row is
// wide gives every row that width, which takes seconds to build and tests nothing more.
function tallTableForTest(rowCount) {
  return { type: 'table', rows: Array.from({ length: rowCount }, function (_, row) { return ['Row ' + row]; }) };
}
function wideTableForTest(columnCount) {
  return { type: 'table', rows: [Array.from({ length: columnCount }, function (_, column) { return 'Col ' + column; })] };
}

test('a DOCX says when it leaves out blocks, table rows, or columns', async function () {
  const blocks = await docxPartsForTest({ format: 'docx', blocks: paragraphsForTest(520) });
  assert.deepStrictEqual(Array.from(blocks.result.warnings), ['The document keeps the first 500 of 520 blocks, so it ends with "Para 499". Split the content into two documents.']);
  assert.match(blocks.parts['word/document.xml'], />Para 499</);
  assert.doesNotMatch(blocks.parts['word/document.xml'], />Para 500</);

  const tables = await docxPartsForTest({ format: 'docx', blocks: [{ type: 'heading', level: 1, text: 'Data' }, tallTableForTest(5010), wideTableForTest(105)] });
  assert.deepStrictEqual(Array.from(tables.result.warnings), [
    'Table 1 (starting "Row 0") has 5,010 rows, and the DOCX keeps the first 5,000. Put the full table in an XLSX, which holds 10,000 rows.',
    'Table 2 (starting "Col 0") has more than 100 columns, and the DOCX keeps the first 100. Split it into narrower tables.'
  ]);

  const atLimits = await docxPartsForTest({ format: 'docx', blocks: paragraphsForTest(498).concat([tallTableForTest(5000), wideTableForTest(100)]) });
  assert.strictEqual(atLimits.result.warnings, undefined);
});

test('a PDF from the built-in writer reports blocks past 500 and its own 500-row cut once', async function () {
  const blocks = await pdfTextForTest({ format: 'pdf', blocks: paragraphsForTest(520) });
  assert.deepStrictEqual(Array.from(blocks.result.warnings), ['The document keeps the first 500 of 520 blocks, so it ends with "Para 499". Split the content into two documents.']);

  const tables = await pdfTextForTest({ format: 'pdf', blocks: [tallTableForTest(5010), wideTableForTest(105)] });
  const warnings = Array.from(tables.result.warnings);
  assert.ok(warnings.includes('A table had 5010 rows; the PDF keeps the first 500. Use XLSX or DOCX for the full table.'), warnings.join('\n'));
  assert.ok(warnings.includes('Table 2 (starting "Col 0") has more than 100 columns, and the PDF keeps the first 100. Split it into narrower tables.'), warnings.join('\n'));
  // The 5,000-row limit does not apply when this writer keeps 500, so it is not reported.
  assert.ok(!warnings.some(function (warning) { return /first 5,000/.test(warning); }), warnings.join('\n'));
});

// ---- Covers and pictures in a new DOCX or PDF ----
//
// Checked against the code before covers and pictures, which ignored both: all five tests below
// fail. Each fix made while building them was also undone on its own in a copy, and the test that
// guards it failed: with the cover's padding back on the cells (Word adds it to an exact row
// height, which pushed the details onto a second page) and with the text's indent taken off the
// paragraphs (LibreOffice ignores a cell's side margins, so the text sat against the page edge),
// the cover test fails; with the built-in PDF writer measuring the cover's text down from the top,
// the PDF test fails; and with every picture stored as a new part, the picture test fails.

async function docxWithPicturesForTest(spec, records) {
  const deps = { loadImage: function (blobId) { return Promise.resolve(records[blobId] || null); } };
  const result = await generatorForTest.ABChatAgent.documentGeneration.createDocument(spec, deps);
  const zip = await generatorForTest.JSZip.loadAsync(Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  const parts = {};
  const binary = {};
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (/^word\/media\//.test(name)) binary[name] = Buffer.from(await zip.file(name).async('uint8array'));
    else parts[name] = await zip.file(name).async('string');
  }
  return { result, parts, binary, doc: parts['word/document.xml'] };
}

async function pdfWithPicturesForTest(spec, records) {
  const deps = { loadImage: function (blobId) { return Promise.resolve(records[blobId] || null); } };
  const result = await generatorForTest.ABChatAgent.documentGeneration.createDocument(spec, deps);
  return { result, text: Buffer.from(result.dataUrl.split(',')[1], 'base64').toString('latin1') };
}

// The content stream of each page, in page order.
function pdfPageStreamsForTest(text) {
  return Array.from(text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)).map(function (match) { return match[1]; }).filter(function (body) { return /\bBT\b/.test(body); });
}

const A4_FOR_TEST = themes.resolvePage({ size: 'a4' }, 'en-US');
const PROFESSIONAL_FOR_TEST = themes.resolveTheme('professional').theme;
const TEXT_WIDTH_FOR_TEST = A4_FOR_TEST.widthPt - 2 * PROFESSIONAL_FOR_TEST.marginPt;
const COVER_RECORDS_FOR_TEST = {
  7: imageRecordForTest('image/png', pngForTest(1600, 1200, [40, 90, 140])),
  8: imageRecordForTest('image/png', pngForTest(200, 150, [200, 60, 40])),
  9: imageRecordForTest('image/jpeg', jpegForTest(1600, 1200, 1)),
  10: imageRecordForTest('image/png', pngForTest(300, 1200, [20, 20, 20]))
};

test('a DOCX cover is its own section with no margins, its photo behind the text, and rows that stop short of the page', async function () {
  const built = await docxWithPicturesForTest({
    format: 'docx', theme: 'professional', page: { size: 'a4' }, page_numbers: true,
    cover: { title: 'Harbour Lights', subtitle: 'Festival plan', details: ['October 2026', 'Events team'], image: 7 },
    blocks: [{ type: 'title', text: 'Harbour Lights' }, { type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: 'Body.' }]
  }, COVER_RECORDS_FOR_TEST);
  const doc = built.doc;
  assert.strictEqual(built.result.warnings, undefined);

  const sections = doc.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g);
  assert.strictEqual(sections.length, 2);
  assert.match(sections[0], /<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0"/);
  // The cover's section has no footer of its own, so it shows no page number.
  assert.doesNotMatch(sections[0], /footerReference/);
  assert.match(sections[1], /footerReference/);

  assert.match(doc, /<wp:anchor [^>]*behindDoc="1"/);
  assert.match(doc, /<wp:positionH relativeFrom="page">/);
  assert.match(doc, /<wp:positionV relativeFrom="page">/);
  // A 4:3 photo in a wider space is cropped at the sides, not stretched.
  assert.match(doc, /<a:srcRect l="\d+" r="\d+"\/>/);
  assert.ok(built.binary['word/media/image1.png'].equals(Buffer.from(COVER_RECORDS_FOR_TEST[7].dataUrl.split(',')[1], 'base64')));

  // Word adds a cell's padding to an exact row height, so the rows hold no padding, and they
  // stop short of the page: a cover one point too tall leaves a blank page behind it.
  const rowHeights = Array.from(doc.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"\/>/g)).map(function (match) { return Number(match[1]); });
  assert.strictEqual(rowHeights.length, 3);
  assert.ok(rowHeights.reduce(function (sum, value) { return sum + value; }, 0) <= Math.round(A4_FOR_TEST.heightPt * 20) - 80, rowHeights.join(' + '));
  assert.match(doc, /<w:tblCellMar><w:top w:w="0" w:type="dxa"\/><w:left w:w="0" w:type="dxa"\/><w:bottom w:w="0" w:type="dxa"\/><w:right w:w="0" w:type="dxa"\/><\/w:tblCellMar>/);
  assert.doesNotMatch(doc, /<w:tcMar>/);
  // LibreOffice ignores a cell's own side margins, so the text is indented on the paragraph.
  assert.match(doc, new RegExp('<w:ind w:left="' + PROFESSIONAL_FOR_TEST.marginPt * 20 + '" w:right="' + PROFESSIONAL_FOR_TEST.marginPt * 20 + '"/>[\\s\\S]*?October 2026'));

  // A title block that repeats the cover's title is left out; one with other text is kept.
  assert.strictEqual(doc.split('>Harbour Lights<').length, 2);
  assert.doesNotMatch(doc, /w:val="Title"/);
  const other = await docxWithPicturesForTest({
    format: 'docx', theme: 'professional', cover: { title: 'Harbour Lights', image: 7 },
    blocks: [{ type: 'title', text: 'Programme' }, { type: 'paragraph', text: 'Body.' }]
  }, COVER_RECORDS_FOR_TEST);
  assert.match(other.doc, /w:val="Title"/);
});

test('without a photo the cover takes the theme\'s look: a patterned band, or a plain page with a rule', async function () {
  const band = await docxWithPicturesForTest({ format: 'docx', theme: 'professional', page: { size: 'a4' }, title: 'Harbour Lights', cover: { details: ['October 2026'] }, blocks: [{ type: 'paragraph', text: 'Body.' }] }, {});
  // The title comes from the document's title when the cover has none.
  assert.match(band.doc, /<w:color w:val="FFFFFF"\/>[^]*?>Harbour Lights</);
  assert.match(band.doc, new RegExp('<w:shd w:val="clear" w:color="auto" w:fill="' + PROFESSIONAL_FOR_TEST.colors.accent + '"/>'));
  const art = band.binary['word/media/image1.png'];
  assert.ok(art, 'the band is a picture of the theme\'s pattern');
  assert.deepStrictEqual([art.readUInt32BE(16), art.readUInt32BE(20)], [Math.round(A4_FOR_TEST.widthPt * 2), Math.round(A4_FOR_TEST.heightPt * 0.6) * 2]);

  // A brand colour too light for white text gets the theme's text colour.
  const light = await docxWithPicturesForTest({ format: 'docx', theme: 'professional', style: { primary_color: '#F5C400' }, cover: { title: 'Harbour Lights' }, blocks: [{ type: 'paragraph', text: 'Body.' }] }, {});
  assert.match(light.doc, new RegExp('<w:color w:val="' + PROFESSIONAL_FOR_TEST.colors.text + '"/>[^]*?>Harbour Lights<'));

  const plain = await docxWithPicturesForTest({ format: 'docx', theme: 'classic', cover: { title: 'Terms of supply' }, blocks: [{ type: 'paragraph', text: 'Body.' }] }, {});
  assert.doesNotMatch(plain.doc, /<w:drawing>/);
  assert.deepStrictEqual(Object.keys(plain.binary), []);
  assert.match(plain.doc, /<w:pBdr><w:bottom w:val="single" w:sz="24" w:space="0" w:color="6B1F2A"\/><\/w:pBdr>/);
  assert.match(plain.doc, /<w:jc w:val="center"\/>[^]*?>Terms of supply</);

  // A cover with no title of its own and none on the document is left out.
  const noTitle = await docxWithPicturesForTest({ format: 'docx', cover: { subtitle: 'No title anywhere' }, blocks: [{ type: 'paragraph', text: 'Body.' }] }, {});
  assert.deepStrictEqual(Array.from(noTitle.result.warnings), ['The cover was left out because it has no title. Give cover a title, or give the document one.']);
  assert.strictEqual(noTitle.doc.match(/<w:sectPr>/g).length, 1);
});

test('picture blocks are centred at their size with alt text and a caption, and unusable or soft pictures are reported', async function () {
  const built = await docxWithPicturesForTest({
    format: 'docx', theme: 'professional', page: { size: 'a4' },
    cover: { title: 'Harbour Lights', image: 7 },
    blocks: [
      { type: 'paragraph', text: 'Body.' },
      { type: 'image', blob_id: 7, size: 'medium', caption: 'Figure 1. The quay', alt: 'Boats at the quay' },
      { type: 'image', blob_id: 99 },
      { type: 'image', blob_id: 8 },
      { type: 'image', blob_id: 'abc' },
      { type: 'image', blob_id: 10, size: 'full' }
    ]
  }, COVER_RECORDS_FOR_TEST);
  assert.deepStrictEqual(Array.from(built.result.warnings), [
    'These pictures could not be used and were left out: picture 2 (blob 99 was not found); picture 4 (blob id "abc" is not a blob id).',
    'These pictures have fewer pixels than the space they fill, so they will look soft: picture 3 (200 x 150 pixels). A larger picture would print sharper.'
  ]);
  const extents = Array.from(built.doc.matchAll(/<wp:inline [^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>/g)).map(function (match) { return [Number(match[1]), Number(match[2])]; });
  assert.strictEqual(extents.length, 3);
  // medium is 60% of the text width, kept to the picture's shape.
  assert.ok(Math.abs(extents[0][0] / 12700 - TEXT_WIDTH_FOR_TEST * 0.6) < 0.01, String(extents[0][0] / 12700));
  assert.ok(Math.abs(extents[0][1] / extents[0][0] - 0.75) < 0.001);
  assert.ok(Math.abs(extents[1][0] / 12700 - TEXT_WIDTH_FOR_TEST) < 0.01);
  // A tall picture is held to 60% of the text area's height, and narrowed to keep its shape.
  const maxHeight = (A4_FOR_TEST.heightPt - 2 * PROFESSIONAL_FOR_TEST.marginPt) * 0.6;
  assert.ok(Math.abs(extents[2][1] / 12700 - maxHeight) < 0.01, String(extents[2][1] / 12700));
  assert.ok(Math.abs(extents[2][0] / extents[2][1] - 0.25) < 0.001);

  assert.match(built.doc, /<w:keepNext\/><w:jc w:val="center"\/>[^]*?<wp:docPr id="\d+" name="Picture \d+" descr="Boats at the quay"\/>/);
  assert.match(built.doc, /<w:pStyle w:val="Caption"\/>[^]*?>Figure 1\. The quay</);

  // The photo on the cover and in the text is stored once, and every drawing has its own id.
  assert.deepStrictEqual(Object.keys(built.binary).sort(), ['word/media/image1.png', 'word/media/image2.png', 'word/media/image3.png']);
  const drawingIds = Array.from(built.doc.matchAll(/<wp:docPr id="(\d+)"/g)).map(function (match) { return match[1]; });
  assert.strictEqual(drawingIds.length, 4);
  assert.strictEqual(new Set(drawingIds).size, 4);
});

test('the built-in PDF writer draws the cover on page 1 with no number or header, and numbers the pages after it', async function () {
  const spec = {
    format: 'pdf', theme: 'professional', page: { size: 'a4' }, page_numbers: true, header: 'Confidential',
    cover: { title: 'Harbour Lights', details: ['October 2026'], image: 9 },
    blocks: [{ type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: 'Body.' }, { type: 'page_break' }, { type: 'paragraph', text: 'Two.' }]
  };
  const photo = await pdfWithPicturesForTest(spec, COVER_RECORDS_FOR_TEST);
  assert.strictEqual(photo.result.warnings, undefined);
  assert.match(photo.text, /\/Subtype \/Image \/Width 1600 \/Height 1200 [^>]*\/Filter \/DCTDecode/);
  const pages = pdfPageStreamsForTest(photo.text);
  assert.strictEqual(pages.length, 3);
  assert.match(pages[0], /\/Im1 Do/);
  assert.match(pages[0], /\(Harbour Lights\) Tj/);
  assert.match(pages[0], /\(October 2026\) Tj/);
  // PDF measures up from the foot of the page: the photo is at the top, the title under it, and
  // the details at the foot.
  const photoBottom = Number(pages[0].match(/q [\d.]+ ([\d.]+) [\d.]+ [\d.]+ re W n/)[1]);
  const titleY = Number(pages[0].match(/([\d.]+) Td \(Harbour Lights\)/)[1]);
  const detailsY = Number(pages[0].match(/([\d.]+) Td \(October 2026\)/)[1]);
  assert.ok(photoBottom > A4_FOR_TEST.heightPt * 0.4 && titleY < photoBottom && detailsY < titleY && detailsY > 0, [photoBottom, titleY, detailsY].join(' '));
  assert.doesNotMatch(pages[0], /Confidential| \/ 3\)/);
  assert.match(pages[1], /\(2 \/ 3\) Tj/);
  assert.match(pages[1], /\(Confidential\) Tj/);

  // The band's pattern is embedded as its compressed PNG rows, which PDF reads with the PNG predictor.
  const band = await pdfWithPicturesForTest(Object.assign({}, spec, { cover: { title: 'Harbour Lights' } }), {});
  assert.match(band.text, /\/Filter \/FlateDecode \/DecodeParms << \/Predictor 15 \/Colors 3 \/BitsPerComponent 8 \/Columns 1191 >>/);

  const plain = await pdfWithPicturesForTest(Object.assign({}, spec, { theme: 'classic', cover: { title: 'Terms of supply' } }), {});
  assert.doesNotMatch(plain.text, /\/Subtype \/Image/);
  assert.match(pdfPageStreamsForTest(plain.text)[0], /\(Terms of supply\) Tj/);
});

// Checked against the code before the result listed its pictures: the field was missing and this
// test fails on the first assertion.
test('the result lists the blob ids of the pictures the document holds, and only those', async function () {
  const deck = await pptxWithPicturesForTest({ format: 'pptx', theme: 'professional', slides: [
    { title: 'Harbour Lights', subtitle: 'Festival plan', background: { image: 9 } },
    { title: 'The quay', bullets: ['Twelve stages'], image: { blob_id: 7 } },
    { title: 'Missing', bullets: ['One'], image: { blob_id: 99 } },
    { title: 'Again', bullets: ['Two'], image: { blob_id: 7 } }
  ] }, COVER_RECORDS_FOR_TEST);
  assert.deepStrictEqual(Array.from(deck.result.pictureBlobIds), [9, 7]);

  const docx = await docxWithPicturesForTest({
    format: 'docx', theme: 'professional', cover: { title: 'Harbour Lights', image: 7 },
    blocks: [{ type: 'paragraph', text: 'Body.' }, { type: 'image', blob_id: 8 }, { type: 'image', blob_id: 99 }]
  }, COVER_RECORDS_FOR_TEST);
  assert.deepStrictEqual(Array.from(docx.result.pictureBlobIds).sort(), [7, 8]);

  // A cover photo that cannot be used falls back to the theme's cover and is not listed.
  const pdf = await pdfWithPicturesForTest({
    format: 'pdf', theme: 'professional', cover: { title: 'Harbour Lights', image: 99 },
    blocks: [{ type: 'paragraph', text: 'Body.' }, { type: 'image', blob_id: 9 }]
  }, COVER_RECORDS_FOR_TEST);
  assert.deepStrictEqual(Array.from(pdf.result.pictureBlobIds), [9]);

  const plain = await docxWithPicturesForTest({ format: 'docx', blocks: [{ type: 'paragraph', text: 'No pictures.' }] }, {});
  assert.strictEqual(plain.result.pictureBlobIds, undefined);
});

test('the documents guide and the create_document schema describe the same cover and picture fields', function () {
  const props = createDocumentPropsForTest();
  Object.keys(props.cover.properties).forEach(function (key) {
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes('"cover"') && DOCUMENTS_GUIDE_FOR_TEST.includes('"' + key + '": '), 'cover.' + key);
  });
  ['blob_id', 'alt', 'size'].forEach(function (key) {
    assert.ok(props.blocks.items.properties[key], 'schema block field ' + key);
    assert.ok(DOCUMENTS_GUIDE_FOR_TEST.includes('"' + key + '": '), 'guide block field ' + key);
  });
  assert.deepStrictEqual(props.blocks.items.properties.size.enum, ['full', 'medium', 'small']);
});
