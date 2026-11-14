// Rules behind the Word-to-PDF converter (agent/docxPdfRules.js): which files it refuses, where a
// shape anchored to the page goes, how a text box is outlined, how many lines of a paragraph stay
// on a page, which header a page gets, and how the stylesheet reaches renamed paragraphs. Run with:
//
//   node --test tests/
//
// Checked against broken copies of the module, each test failing as expected: preflight without
// the mc:Fallback strip (the fallback test fails), linesToKeep without widow control (the
// three-line and orphan tests fail), vmlBoxLook taking the whole colour string (the colour index
// test fails), and paragraphSelectors with a bare .abchat-as-p, which raises the specificity (the
// selector tests fail).

const test = require('node:test');
const assert = require('node:assert');

const rulesForDocxPdfTest = require('../agent/docxPdfRules.js');

const LETTER_FOR_DOCX_PDF_TEST = { width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } };

function bodyForDocxPdfTest(inner) {
  return '<w:document><w:body>' + inner + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>';
}

function anchorForDocxPdfTest(relativeV, cx, cy, inner) {
  return '<w:p><w:r><w:drawing><wp:anchor behindDoc="0">'
    + '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>'
    + '<wp:positionV relativeFrom="' + relativeV + '"><wp:posOffset>0</wp:posOffset></wp:positionV>'
    + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' + (inner || '') + '</wp:anchor></w:drawing></w:r></w:p>';
}

// ---- Preflight ----

test('a text box anchored to its paragraph is converted', () => {
  const xml = bodyForDocxPdfTest(anchorForDocxPdfTest('paragraph', 1270000, 635000, '<wps:txbx><w:txbxContent><w:p/></w:txbxContent></wps:txbx>'));
  assert.strictEqual(rulesForDocxPdfTest.preflight(xml).ok, true);
});

test('a text box anchored to the page is refused', () => {
  const xml = bodyForDocxPdfTest(anchorForDocxPdfTest('page', 1270000, 635000, '<wps:txbx><w:txbxContent><w:p/></w:txbxContent></wps:txbx>'));
  const result = rulesForDocxPdfTest.preflight(xml);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /text box placed on the page/);
});

test('a sidebar anchored to the page is refused, a logo there is not', () => {
  // 612 x 792 pt page: a shape half the page tall is a sidebar, a one-inch picture a logo.
  const sidebar = bodyForDocxPdfTest(anchorForDocxPdfTest('page', 2540000, 396 * 12700));
  const logo = bodyForDocxPdfTest(anchorForDocxPdfTest('page', 914400, 914400));
  assert.strictEqual(rulesForDocxPdfTest.preflight(sidebar).ok, false);
  assert.match(rulesForDocxPdfTest.preflight(sidebar).reason, /sidebar or banner/);
  assert.strictEqual(rulesForDocxPdfTest.preflight(logo).ok, true);
});

test('the old copy of a shape in mc:Fallback is not counted', () => {
  const choice = anchorForDocxPdfTest('paragraph', 1270000, 635000, '<wps:txbx><w:txbxContent><w:p/></w:txbxContent></wps:txbx>');
  const fallback = '<w:pict><v:shape style="position:absolute;width:100pt;height:50pt;mso-position-vertical-relative:page"><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict>';
  const xml = bodyForDocxPdfTest('<mc:AlternateContent><mc:Choice Requires="wps">' + choice + '</mc:Choice><mc:Fallback>' + fallback + '</mc:Fallback></mc:AlternateContent>');
  assert.strictEqual(rulesForDocxPdfTest.preflight(xml).ok, true);
});

test('VML text boxes: refused on the page, converted beside their paragraph', () => {
  const onPage = bodyForDocxPdfTest('<w:p><w:r><w:pict><v:shape style="position:absolute;width:125pt;height:29pt;mso-position-vertical-relative:page"><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>');
  const besideText = bodyForDocxPdfTest('<w:p><w:r><w:pict><v:shape style="position:absolute;margin-top:46pt;width:125pt;height:29pt;mso-position-vertical-relative:text"><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>');
  assert.strictEqual(rulesForDocxPdfTest.preflight(onPage).ok, false);
  assert.strictEqual(rulesForDocxPdfTest.preflight(besideText).ok, true);
});

test('a frame placed on the page is refused, a drop cap is not', () => {
  const frame = bodyForDocxPdfTest('<w:p><w:pPr><w:framePr w:w="2000" w:vAnchor="page" w:y="400"/></w:pPr></w:p>');
  const dropCap = bodyForDocxPdfTest('<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:vAnchor="text"/></w:pPr></w:p>');
  assert.strictEqual(rulesForDocxPdfTest.preflight(frame).ok, false);
  assert.strictEqual(rulesForDocxPdfTest.preflight(dropCap).ok, true);
});

test('a file with no body is refused, and the page size comes from the last section', () => {
  assert.strictEqual(rulesForDocxPdfTest.preflight('<w:document/>').ok, false);
  const xml = '<w:body><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>';
  assert.deepStrictEqual(rulesForDocxPdfTest.pageSize(xml), { width: 612, height: 792 });
});

// ---- Shapes ----

test('VML lengths: units, and a bare number in pixels', () => {
  assert.strictEqual(rulesForDocxPdfTest.vmlLength('72pt'), 72);
  assert.strictEqual(rulesForDocxPdfTest.vmlLength('1in'), 72);
  assert.strictEqual(rulesForDocxPdfTest.vmlLength('12700emu'), 1);
  assert.strictEqual(rulesForDocxPdfTest.vmlLength('96'), 72);
  assert.strictEqual(rulesForDocxPdfTest.vmlLength('auto'), null);
});

test('a centred watermark is placed in the middle of the margins, behind the text', () => {
  const style = rulesForDocxPdfTest.vmlStyle('position:absolute;margin-left:0;margin-top:0;width:468pt;height:234pt;z-index:-251654144;'
    + 'mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin');
  assert.deepStrictEqual(rulesForDocxPdfTest.vmlBox(style, LETTER_FOR_DOCX_PDF_TEST), { left: 72, top: 279, width: 468, height: 234, behind: true });
});

test('a VML shape anchored to its paragraph is left where it is', () => {
  const style = rulesForDocxPdfTest.vmlStyle('position:absolute;margin-top:46pt;width:125pt;height:29pt;mso-position-vertical-relative:text');
  assert.strictEqual(rulesForDocxPdfTest.vmlBox(style, LETTER_FOR_DOCX_PDF_TEST), null);
});

test('a DrawingML picture anchored to the page: offsets and alignment', () => {
  const offset = rulesForDocxPdfTest.anchorBox({ h: 'page', v: 'page', x: 20, y: 30 }, { width: 100, height: 50 }, LETTER_FOR_DOCX_PDF_TEST);
  assert.deepStrictEqual(offset, { left: 20, top: 30, width: 100, height: 50, behind: false });
  const aligned = rulesForDocxPdfTest.anchorBox({ h: 'margin', v: 'bottomMargin', alignH: 'right', alignV: 'top', behind: true }, { width: 100, height: 20 }, LETTER_FOR_DOCX_PDF_TEST);
  assert.deepStrictEqual(aligned, { left: 440, top: 720, width: 100, height: 20, behind: true });
  assert.strictEqual(rulesForDocxPdfTest.anchorBox({ h: 'column', v: 'paragraph' }, { width: 100, height: 20 }, LETTER_FOR_DOCX_PDF_TEST), null);
});

test('a text box with no outline or fill set gets VML defaults', () => {
  assert.deepStrictEqual(rulesForDocxPdfTest.vmlBoxLook({}), {
    borderWidth: 0.75, borderColor: 'black', background: 'white',
    padding: { left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 }
  });
});

test('a text box outline: off, its weight, and colours carrying Word\'s colour index', () => {
  const none = rulesForDocxPdfTest.vmlBoxLook({ stroked: 'f', filled: 'false', inset: '0,0,0,0' });
  assert.strictEqual(none.borderWidth, 0);
  assert.strictEqual(none.background, null);
  assert.deepStrictEqual(none.padding, { left: 0, top: 0, right: 0, bottom: 0 });
  const set = rulesForDocxPdfTest.vmlBoxLook({ strokeColor: 'red [3213]', strokeWeight: '2pt', fillColor: '#ABC', inset: '1in,,2pt' });
  assert.strictEqual(set.borderWidth, 2);
  assert.strictEqual(set.borderColor, 'red');
  assert.strictEqual(set.background, '#abc');
  assert.deepStrictEqual(set.padding, { left: 72, top: 3.6, right: 2, bottom: 3.6 });
});

test('a text box colour that is not a colour falls back', () => {
  const look = rulesForDocxPdfTest.vmlBoxLook({ strokeColor: 'x;y}', fillColor: 'url(a)' });
  assert.strictEqual(look.borderColor, 'black');
  assert.strictEqual(look.background, 'white');
});

// ---- Lines and pages ----

test('widow control: a paragraph of three lines never splits', () => {
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(3, 2, {}), 0);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(3, 1, {}), 0);
});

test('widow control: two lines stay on each side of a break', () => {
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(5, 4, {}), 3);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(5, 1, {}), 0);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(5, 2, {}), 2);
});

test('without widow control a paragraph breaks where the page ends', () => {
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(3, 2, { widowControl: false }), 2);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(5, 1, { widowControl: false }), 1);
});

test('keep-lines moves the paragraph whole unless it starts the page', () => {
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(8, 6, { keepLines: true }), 0);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(8, 6, { keepLines: true, firstOnPage: true }), 6);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(8, 0, { firstOnPage: true }), 1);
  assert.strictEqual(rulesForDocxPdfTest.linesToKeep(4, 4, {}), 4);
});

test('page-number fields', () => {
  assert.strictEqual(rulesForDocxPdfTest.fieldText('page', 3, 9, 4), '3');
  assert.strictEqual(rulesForDocxPdfTest.fieldText('numpages', 3, 9, 4), '9');
  assert.strictEqual(rulesForDocxPdfTest.fieldText('sectionpages', 3, 9, 4), '4');
  assert.strictEqual(rulesForDocxPdfTest.fieldText('other', 3, 9, 4), '');
});

test('header variants: first page, even pages, and the default', () => {
  const all = { first: {}, even: {}, default: {} };
  assert.strictEqual(rulesForDocxPdfTest.headerVariant(all, true, true, true, 1), 'first');
  assert.strictEqual(rulesForDocxPdfTest.headerVariant(all, false, true, true, 2), 'even');
  assert.strictEqual(rulesForDocxPdfTest.headerVariant(all, false, true, false, 2), 'default');
  assert.strictEqual(rulesForDocxPdfTest.headerVariant(all, true, false, false, 1), 'default');
  assert.strictEqual(rulesForDocxPdfTest.headerVariant({ even: {} }, false, false, false, 3), null);
});

// ---- Renamed paragraphs ----

test('rules that select p by its tag also select renamed paragraphs, at the same specificity', () => {
  const css = rulesForDocxPdfTest.paragraphSelectors('.docx p { margin: 0pt; min-height: 1em; }\np.docx_normal span, td>p:empty { color: red; }');
  assert.strictEqual(css, '.docx :is(p, :where(.abchat-as-p)) { margin: 0pt; min-height: 1em; }\n'
    + ':is(p, :where(.abchat-as-p)).docx_normal span, td>:is(p, :where(.abchat-as-p)):empty { color: red; }');
});

test('selector rewriting leaves other tags, at-rules and declarations alone', () => {
  const css = '.docx span { white-space: pre-wrap; }\n@page { size: 612pt 792pt; margin: 0; }\npath, pre { fill: none; }\n@media print { .docx p { color: black; } }';
  assert.strictEqual(rulesForDocxPdfTest.paragraphSelectors(css),
    '.docx span { white-space: pre-wrap; }\n@page { size: 612pt 792pt; margin: 0; }\npath, pre { fill: none; }\n@media print { .docx :is(p, :where(.abchat-as-p)) { color: black; } }');
});
