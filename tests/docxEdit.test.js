// In-place DOCX editing (agent/docxEdit.js): the lossless XML layer, paragraph ids shared by the
// read and edit sides, and each edit operation, plain and tracked.
//
// Checked against the code before these behaviours existed. With replace_text writing the whole
// replacement into the run where a match starts (the first version), the formatting test fails:
// "Acme Group and Northwind" came out entirely bold. With set_text always replacing the whole
// paragraph, the bold-word and minimal-redline tests fail. With insert_after copying the anchor's
// properties unchanged, the list-gap test fails, and with no heading rule the heading test fails
// because the new paragraph became a second heading.

const test = require('node:test');
const assert = require('node:assert');

globalThis.JSZip = require('../lib/jszip.min.js');
const docxEdit = require('../agent/docxEdit.js');

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'
  + ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

function docXml(body) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + W_NS + '><w:body>' + body
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>';
}

function para(text, pPr) {
  return '<w:p>' + (pPr || '') + '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
}

function edit(body, edits, options) {
  const parts = { 'word/document.xml': docXml(body) };
  Object.assign(parts, (options && options.extraParts) || {});
  return docxEdit.applyEditsToParts(parts, edits, Object.assign({ now: '2026-11-13T10:00:00Z' }, options || {}));
}

function paragraphTexts(xml) {
  return docxEdit.collectParagraphs(docxEdit.parseXml(xml), false).map(docxEdit.paragraphText);
}

// ---- XML layer ----

test('parse and serialize give back the source byte for byte', function () {
  const source = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<!-- a comment -->'
    + '<w:document ' + W_NS + ' mc:Ignorable="w14"><w:body>'
    + '<w:p w14:paraId="1A2B3C4D"><w:pPr><w:jc w:val="center" /></w:pPr>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Fish &amp; chips &lt;3 &#x2014; </w:t></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> HYPERLINK "a>b" </w:instrText></w:r>'
    + '<w:r><w:t><![CDATA[raw]]></w:t></w:r><w:r><w:t></w:t></w:r></w:p>\n  '
    + '</w:body></w:document>';
  assert.strictEqual(docxEdit.serializeXml(docxEdit.parseXml(source)), source);
});

test('malformed XML is rejected rather than half-read', function () {
  assert.throws(() => docxEdit.parseXml('<w:p><w:r></w:p>'), /mismatched closing tag/);
  assert.throws(() => docxEdit.parseXml('<w:p><w:r>'), /unclosed element/);
});

test('paragraph ids skip text-box content, which Word stores twice', function () {
  const textBox = '<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>' + para('Box') + '</w:txbxContent></w:drawing></mc:Choice>'
    + '<mc:Fallback><w:pict><w:txbxContent>' + para('Box') + '</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>';
  const root = docxEdit.parseXml(docXml(para('First') + '<w:p>' + textBox + '</w:p>' + para('Third')));
  assert.deepStrictEqual(docxEdit.collectParagraphs(root, false).map(docxEdit.paragraphText), ['First', '', 'Third']);
  assert.strictEqual(docxEdit.collectParagraphs(root, true).length, 5);
});

// ---- Read side ----

test('markers go on paragraphs with text or an image, numbered by position among all paragraphs', function () {
  const marked = docxEdit.markParagraphsForRead(docXml(para('One') + '<w:p/>' + para('Three', '<w:pPr><w:jc w:val="left"/></w:pPr>')
    + '<w:p><w:r><w:drawing/></w:r></w:p>'));
  assert.strictEqual(marked.marked, 3);
  assert.strictEqual(marked.total, 4);
  assert.match(marked.xml, /<w:p><w:r><w:t xml:space="preserve">\[\[abchat-p:1\]\]<\/w:t><\/w:r><w:r>/);
  assert.match(marked.xml, /<w:pPr><w:jc w:val="left"\/><\/w:pPr><w:r><w:t xml:space="preserve">\[\[abchat-p:3\]\]/);
  assert.ok(marked.xml.includes('[[abchat-p:4]]'));
  assert.ok(!marked.xml.includes('[[abchat-p:2]]'), 'an empty paragraph gets no marker');
});

test('markers become data-id attributes on the block mammoth opened, and strays are removed', function () {
  const html = '<h1>[[abchat-p:1]]Title</h1><p><strong>[[abchat-p:2]]Bold</strong> start</p>'
    + '<ul><li>[[abchat-p:3]]Item<ul><li>[[abchat-p:4]]Sub</li></ul></li></ul>'
    + '<p class="x"><a id="_Toc1"></a>[[abchat-p:5]]Anchored</p><p>Text [[abchat-p:6]]inside</p>';
  assert.strictEqual(docxEdit.attachParagraphIds(html),
    '<h1 data-id="p1">Title</h1><p data-id="p2"><strong>Bold</strong> start</p>'
    + '<ul><li data-id="p3">Item<ul><li data-id="p4">Sub</li></ul></li></ul>'
    + '<p data-id="p5" class="x"><a id="_Toc1"></a>Anchored</p><p>Text inside</p>');
});

// ---- replace_text ----

test('replace_text across runs changes only the differing words, so every run keeps its formatting', function () {
  const body = '<w:p><w:r><w:t xml:space="preserve">Between </w:t></w:r>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t>Acme Ltd</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r>'
    + '<w:r><w:rPr><w:i/></w:rPr><w:t>Northwind</w:t></w:r></w:p>';
  const out = edit(body, [{ op: 'replace_text', find: 'Acme Ltd and Northwind', replace: 'Acme Group and Northwind' }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Acme Group<\/w:t><\/w:r>/);
  assert.match(xml, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t>Northwind<\/w:t><\/w:r>/);
  assert.deepStrictEqual(paragraphTexts(xml), ['Between Acme Group and Northwind']);
});

test('replace_text without an id reaches headers and footers, and only changed parts are returned', function () {
  const header = '<w:hdr ' + W_NS + '>' + para('Acme Ltd, Confidential') + '</w:hdr>';
  const footer = '<w:ftr ' + W_NS + '>' + para('Page') + '</w:ftr>';
  const out = edit(para('Acme Ltd agrees.'), [{ op: 'replace_text', find: 'Acme Ltd', replace: 'Acme Group' }],
    { extraParts: { 'word/header1.xml': header, 'word/footer1.xml': footer } });
  assert.ok(out.ok, out.error);
  assert.deepStrictEqual(Object.keys(out.parts).sort(), ['word/document.xml', 'word/header1.xml']);
  assert.ok(out.parts['word/header1.xml'].includes('Acme Group, Confidential'));
  assert.strictEqual(out.results[0].matches, 2);
});

test('occurrence "first" changes one match, and newlines become line breaks', function () {
  const out = edit(para('a-b a-b'), [{ op: 'replace_text', find: 'a-b', replace: 'x\ny', occurrence: 'first' }]);
  assert.ok(out.ok, out.error);
  assert.deepStrictEqual(paragraphTexts(out.parts['word/document.xml']), ['x\ny a-b']);
  assert.match(out.parts['word/document.xml'], /<w:br\/>/);
});

test('tracked replace_text marks only the changed word, with fresh revision ids', function () {
  const body = '<w:bookmarkStart w:id="7" w:name="b"/>' + para('Due within 30 days.') + '<w:bookmarkEnd w:id="7"/>';
  const out = edit(body, [{ op: 'replace_text', find: '30 days', replace: '14 days' }], { trackChanges: true, author: 'Ada' });
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:del w:id="8" w:author="Ada" w:date="2026-11-13T10:00:00Z"><w:r><w:delText xml:space="preserve">30<\/w:delText><\/w:r><\/w:del>/);
  assert.match(xml, /<w:ins w:id="9" w:author="Ada" w:date="2026-11-13T10:00:00Z"><w:r><w:t xml:space="preserve">14<\/w:t><\/w:r><\/w:ins>/);
  assert.deepStrictEqual(paragraphTexts(xml), ['Due within 14 days.']);
  assert.ok(out.summary.includes('tracked changes by Ada'));
});

// ---- set_text ----

test('set_text keeps the formatting of words it does not change', function () {
  const body = '<w:p><w:r><w:t xml:space="preserve">Signed by </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Ada Lovelace</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> on Monday.</w:t></w:r></w:p>';
  const out = edit(body, [{ op: 'set_text', id: 'p1', text: 'Approved by Ada Lovelace on Friday, 13 November.' }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t>Ada Lovelace<\/w:t>/);
  assert.deepStrictEqual(paragraphTexts(xml), ['Approved by Ada Lovelace on Friday, 13 November.']);
});

test('a tracked set_text redlines only what changed', function () {
  const out = edit(para('Payment is due within 30 days of invoice.'),
    [{ op: 'set_text', id: 'p1', text: 'Payment is due within 14 days of invoice.' }], { trackChanges: true });
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.strictEqual((xml.match(/<w:del /g) || []).length, 1);
  assert.match(xml, /<w:delText xml:space="preserve">30<\/w:delText>/);
});

test('set_text with all-new text keeps images and puts the new run outside the old link', function () {
  const body = '<w:p><w:hyperlink r:id="rId5" xmlns:r="r"><w:r><w:t>old link</w:t></w:r></w:hyperlink>'
    + '<w:r><w:drawing/></w:r><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';
  const out = edit(body, [{ op: 'set_text', id: 'p1', text: 'Completely different' }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:p><w:r><w:t xml:space="preserve">Completely different<\/w:t><\/w:r><w:r><w:drawing\/><\/w:r><\/w:p>/);
  assert.ok(!xml.includes('hyperlink'), 'the emptied link is removed');
});

// ---- insert ----

test('a paragraph added after the last list item takes over the closing space, so no gap opens', function () {
  const item = (text, spacing) => para(text, '<w:pPr><w:pStyle w:val="List"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    + spacing + '</w:pPr>');
  const out = edit(item('One', '<w:spacing w:after="0"/>') + item('Two', '<w:spacing w:after="240"/>') + para('After'),
    [{ op: 'insert_after', id: 'p2', text: 'Three' }]);
  assert.ok(out.ok, out.error);
  const root = docxEdit.parseXml(out.parts['word/document.xml']);
  const paragraphs = docxEdit.collectParagraphs(root, false);
  assert.deepStrictEqual(paragraphs.map(docxEdit.paragraphText), ['One', 'Two', 'Three', 'After']);
  const xml = docxEdit.serializeXml(root);
  assert.match(xml, /<w:spacing w:after="0"\/><\/w:pPr><w:r><w:t xml:space="preserve">Two/);
  assert.match(xml, /<w:spacing w:after="240"\/><\/w:pPr><w:r><w:t xml:space="preserve">Three/);
  assert.match(xml, /<w:numId w:val="1"\/><\/w:numPr><w:spacing w:after="240"\/><\/w:pPr><w:r><w:t xml:space="preserve">Three/);
});

test('text inserted after a heading copies the body paragraph below it, not the heading', function () {
  const out = edit(para('Scope', '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>') + para('Body', '<w:pPr><w:pStyle w:val="BodyText"/></w:pPr>'),
    [{ op: 'insert_after', id: 'p1', paragraphs: ['New one', 'New two'] }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.strictEqual((xml.match(/Heading2/g) || []).length, 1);
  assert.deepStrictEqual(paragraphTexts(xml), ['Scope', 'New one', 'New two', 'Body']);
});

test('like copies another paragraph, without its section break', function () {
  const out = edit(para('Intro') + para('Section end', '<w:pPr><w:jc w:val="right"/><w:sectPr/></w:pPr>'),
    [{ op: 'insert_before', id: 'p1', text: 'Added', like: 'p2' }]);
  assert.ok(out.ok, out.error);
  assert.match(out.parts['word/document.xml'], /<w:p><w:pPr><w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">Added/);
  assert.strictEqual((out.parts['word/document.xml'].match(/<w:sectPr\/>/g) || []).length, 1);
});

test('a tracked insertion marks the paragraph mark and the run as inserted', function () {
  const out = edit(para('One'), [{ op: 'insert_after', id: 'p1', text: 'Two' }], { trackChanges: true });
  assert.ok(out.ok, out.error);
  assert.match(out.parts['word/document.xml'],
    /<w:p><w:pPr><w:rPr><w:ins w:id="1" [^>]*\/><\/w:rPr><\/w:pPr><w:ins w:id="2" [^>]*><w:r><w:t xml:space="preserve">Two<\/w:t><\/w:r><\/w:ins><\/w:p>/);
});

// ---- delete ----

test('the last paragraph of a cell is emptied, not removed', function () {
  const table = '<w:tbl><w:tr><w:tc>' + para('Only') + '</w:tc></w:tr></w:tbl>';
  const out = edit(table + para('End'), [{ op: 'delete', id: 'p1' }]);
  assert.ok(out.ok, out.error);
  assert.match(out.parts['word/document.xml'], /<w:tc><w:p><\/w:p><\/w:tc>/);
  assert.match(out.results[0].note, /last paragraph of its cell/);
});

test('a removed paragraph hands its bookmark ends to the next paragraph', function () {
  const out = edit('<w:p><w:bookmarkStart w:id="1" w:name="x"/><w:r><w:t>Gone</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' + para('Stays'),
    [{ op: 'delete', id: 'p1' }]);
  assert.ok(out.ok, out.error);
  assert.match(out.parts['word/document.xml'], /<w:p><w:bookmarkStart w:id="1" w:name="x"\/><w:bookmarkEnd w:id="1"\/><w:r><w:t xml:space="preserve">Stays/);
});

test('delete with to removes a run of blocks, tables included', function () {
  const table = '<w:tbl><w:tr><w:tc>' + para('Cell') + '</w:tc></w:tr></w:tbl>';
  const out = edit(para('Keep') + para('Appendix') + table + para('Last of appendix') + para('Keep too'),
    [{ op: 'delete', id: 'p2', to: 'p4' }]);
  assert.ok(out.ok, out.error);
  assert.deepStrictEqual(paragraphTexts(out.parts['word/document.xml']), ['Keep', 'Keep too']);
  assert.ok(!out.parts['word/document.xml'].includes('<w:tbl>'));
});

test('delete with to inside two different cells is refused', function () {
  const row = '<w:tbl><w:tr><w:tc>' + para('A') + '</w:tc><w:tc>' + para('B') + '</w:tc></w:tr></w:tbl>';
  const out = edit(row + para('End'), [{ op: 'delete', id: 'p1', to: 'p2' }]);
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /same table cell/);
});

// ---- rows ----

test('insert_row_after clones the row, drops merges and unique ids, and fills the cells', function () {
  const cell = (text, merge) => '<w:tc><w:tcPr><w:tcW w:w="2000"/>' + (merge || '') + '</w:tcPr>'
    + '<w:p w14:paraId="0000000A"><w:r><w:rPr><w:b/></w:rPr><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
  const table = '<w:tbl><w:tr><w:trPr><w:cantSplit/></w:trPr>' + cell('Item') + cell('Amount', '<w:vMerge w:val="restart"/>') + '</w:tr></w:tbl>';
  const out = edit(table + para('End'), [{ op: 'insert_row_after', id: 'p1', cells: ['Travel', 120] }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.deepStrictEqual(paragraphTexts(xml), ['Item', 'Amount', 'Travel', '120', 'End']);
  assert.strictEqual((xml.match(/vMerge/g) || []).length, 1, 'only the original row keeps its merge');
  assert.strictEqual((xml.match(/paraId/g) || []).length, 2, 'the cloned paragraphs drop their ids');
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Travel<\/w:t><\/w:r>/);
});

test('delete_row refuses the only row, and a tracked row deletion marks the row', function () {
  const one = '<w:tbl><w:tr><w:tc>' + para('A') + '</w:tc></w:tr></w:tbl>';
  assert.match(edit(one + para('End'), [{ op: 'delete_row', id: 'p1' }]).error, /only row of its table/);
  const two = '<w:tbl><w:tr><w:tc>' + para('A') + '</w:tc></w:tr><w:tr><w:tc>' + para('B') + '</w:tc></w:tr></w:tbl>';
  const out = edit(two + para('End'), [{ op: 'delete_row', id: 'p2' }], { trackChanges: true });
  assert.ok(out.ok, out.error);
  assert.match(out.parts['word/document.xml'], /<w:tr><w:trPr><w:del w:id="1" [^>]*\/><\/w:trPr><w:tc><w:p><w:del w:id="2"/);
});

// ---- format ----

test('format with find splits runs and writes properties in schema order', function () {
  const body = '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">Total due now</w:t></w:r></w:p>';
  const out = edit(body, [{ op: 'format', id: 'p1', find: 'due', bold: true, color: '#c00000', highlight: 'yellow' }]);
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:t xml:space="preserve">Total <\/w:t><\/w:r><w:r><w:rPr><w:b\/><w:bCs\/><w:color w:val="C00000"\/><w:sz w:val="22"\/><w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">due<\/w:t>/);
  assert.match(xml, /<w:rPr><w:sz w:val="22"\/><\/w:rPr><w:t xml:space="preserve"> now<\/w:t>/);
});

test('a tracked format change records the old properties', function () {
  const out = edit(para('Heading'), [{ op: 'format', id: 'p1', italic: true, align: 'center' }], { trackChanges: true });
  assert.ok(out.ok, out.error);
  const xml = out.parts['word/document.xml'];
  assert.match(xml, /<w:rPr><w:i\/><w:iCs\/><w:rPrChange w:id="1" [^>]*><w:rPr\/><\/w:rPrChange><\/w:rPr>/);
  assert.match(xml, /<w:pPr><w:jc w:val="center"\/><w:rPr><w:i\/><w:iCs\/><w:rPrChange w:id="3" [^>]*><w:rPr\/><\/w:rPrChange><\/w:rPr><w:pPrChange w:id="2" [^>]*><w:pPr\/><\/w:pPrChange><\/w:pPr>/);
});

// Without the paragraph mark step (checked against that copy), the mark keeps its old colour and
// Word draws the list item's bullet in it, which is what Word itself showed for a formatted heading.
test('formatting a whole paragraph formats its mark too, so a list bullet follows the text', function () {
  const item = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:rPr><w:ins w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z"/><w:sz w:val="22"/></w:rPr></w:pPr>'
    + '<w:r><w:t xml:space="preserve">Overdue</w:t></w:r></w:p>';
  const plain = edit(item, [{ op: 'format', id: 'p1', color: '#C00000' }]);
  assert.ok(plain.ok, plain.error);
  assert.match(plain.parts['word/document.xml'], /<w:numPr>.*<\/w:numPr><w:rPr><w:ins [^>]*\/><w:color w:val="C00000"\/><w:sz w:val="22"\/><\/w:rPr><\/w:pPr>/);
  const tracked = edit(item, [{ op: 'format', id: 'p1', color: '#C00000' }], { trackChanges: true });
  assert.ok(tracked.ok, tracked.error);
  assert.match(tracked.parts['word/document.xml'], /<w:sz w:val="22"\/><w:rPrChange w:id="\d+" [^>]*><w:rPr><w:sz w:val="22"\/><\/w:rPr><\/w:rPrChange><\/w:rPr><\/w:pPr>/);
  // Formatting only some of the text leaves the mark alone.
  const partial = edit(item, [{ op: 'format', id: 'p1', find: 'Over', color: '#C00000' }]);
  assert.match(partial.parts['word/document.xml'], /<w:numPr>.*<\/w:numPr><w:rPr><w:ins [^>]*\/><w:sz w:val="22"\/><\/w:rPr><\/w:pPr>/);
});

// ---- the call as a whole ----

test('ids refer to the document as read, even after inserts and deletes earlier in the call', function () {
  const out = edit(para('A') + para('B') + para('C'), [
    { op: 'insert_after', id: 'p1', text: 'A2' },
    { op: 'delete', id: 'p2' },
    { op: 'set_text', id: 'p3', text: 'C changed' }
  ]);
  assert.ok(out.ok, out.error);
  assert.deepStrictEqual(paragraphTexts(out.parts['word/document.xml']), ['A', 'A2', 'C changed']);
});

test('any failed edit means no file, and every failure is listed', function () {
  const out = edit(para('A') + para('B'), [
    { op: 'delete', id: 'p1' },
    { op: 'set_text', id: 'p1', text: 'x' },
    { op: 'replace_text', find: 'missing', replace: 'y' },
    { op: 'shout' }
  ]);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.parts, undefined);
  assert.match(out.error, /^3 of 4 edits failed, so no file was made/);
  assert.match(out.error, /edit 1 \(set_text\): p1 was removed by an earlier edit in this call/);
  assert.match(out.error, /edit 2 \(replace_text\): Text not found: "missing"/);
  assert.match(out.error, /edit 3 \(shout\): Unknown op "shout"/);
});

// ---- whole files ----

test('a DOCX round trip edits document.xml and leaves every other part byte for byte', async function () {
  const JSZip = globalThis.JSZip;
  const zip = new JSZip();
  const styles = '<w:styles ' + W_NS + '><w:style w:styleId="Normal"/></w:styles>';
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('_rels/.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', docXml(para('Hello world')));
  zip.file('word/styles.xml', styles);
  zip.file('word/footer1.xml', '<w:ftr ' + W_NS + '>' + para('Draft v2') + '</w:ftr>');
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });

  const prepared = await docxEdit.prepareForRead(bytes);
  assert.strictEqual(prepared.marked, 1);
  assert.deepStrictEqual(prepared.headersFooters, ['Draft v2']);
  const markedZip = await JSZip.loadAsync(prepared.buffer);
  assert.ok((await markedZip.file('word/document.xml').async('string')).includes('[[abchat-p:1]]'));

  const out = await docxEdit.applyEditsToDocx(bytes, [{ op: 'replace_text', id: 'p1', find: 'world', replace: 'there' }]);
  assert.ok(out.ok, out.error);
  const editedZip = await JSZip.loadAsync(Buffer.from(out.base64, 'base64'));
  assert.deepStrictEqual(paragraphTexts(await editedZip.file('word/document.xml').async('string')), ['Hello there']);
  assert.strictEqual(await editedZip.file('word/styles.xml').async('string'), styles);
  assert.strictEqual(out.mimeType, docxEdit.MIME_TYPE);
});

test('a file that is not a Word document is refused', async function () {
  const zip = new globalThis.JSZip();
  zip.file('hello.txt', 'hi');
  const out = await docxEdit.applyEditsToDocx(await zip.generateAsync({ type: 'arraybuffer' }), [{ op: 'delete', id: 'p1' }]);
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /not a Word document/);
});
