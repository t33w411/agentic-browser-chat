// Serializer that turns mammoth convertToHtml output into the plain text stored for a DOCX
// attachment (agent/docxTextFromHtml.js). The point of this path over mammoth's extractRawText is
// that hyperlink URLs survive: extractRawText keeps only the anchor text, this renders each
// external link inline as "text (url)". Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const { htmlToText } = require('../agent/docxTextFromHtml.js');

test('external link is rendered inline as text (url)', function () {
  const out = htmlToText('<p>See the <a href="https://example.com/docs">docs</a> now.</p>');
  assert.strictEqual(out, 'See the docs (https://example.com/docs) now.');
});

test('ampersands in a link URL are decoded, not left as &amp;', function () {
  const out = htmlToText('<p><a href="https://x.com/q?a=1&amp;b=2">report</a></p>');
  assert.strictEqual(out, 'report (https://x.com/q?a=1&b=2)');
});

test('a link whose text already is the URL collapses to the URL alone', function () {
  const out = htmlToText('<p><a href="https://example.com">https://example.com</a></p>');
  assert.strictEqual(out, 'https://example.com');
});

test('mailto links keep their scheme in the parenthetical', function () {
  const out = htmlToText('<p>Email <a href="mailto:ops@example.com">ops@example.com</a>.</p>');
  assert.strictEqual(out, 'Email ops@example.com (mailto:ops@example.com).');
});

test('internal (#anchor) links render as their text with no parenthetical', function () {
  const out = htmlToText('<p>Jump to <a href="#section-2">Section 2</a>.</p>');
  assert.strictEqual(out, 'Jump to Section 2.');
});

test('relative / non-web links render as their text with no parenthetical', function () {
  const out = htmlToText('<p>The <a href="../shared/policy.pdf">policy</a> applies.</p>');
  assert.strictEqual(out, 'The policy applies.');
});

test('formatting tags inside a link are stripped from the anchor text', function () {
  const out = htmlToText('<p><a href="https://example.com/a"><strong>appendix</strong></a></p>');
  assert.strictEqual(out, 'appendix (https://example.com/a)');
});

test('an image-only link falls back to its URL', function () {
  const out = htmlToText('<p><a href="https://example.com/logo"><img src="data:image/png;base64,AAAA" /></a></p>');
  assert.strictEqual(out, 'https://example.com/logo');
});

test('named and numeric entities in body text are decoded', function () {
  const out = htmlToText('<p>5 &lt; 10 and x &gt; y. Caf&#233; &amp; bar.</p>');
  assert.strictEqual(out, '5 < 10 and x > y. Café & bar.');
});

test('list items become dashed lines', function () {
  const out = htmlToText('<ul><li>one</li><li>two</li></ul>');
  assert.strictEqual(out, '- one\n- two');
});

test('table rows are newline-separated and cells tab-separated', function () {
  const out = htmlToText('<table><tr><th>Region</th><th>Sales</th></tr><tr><td>EMEA</td><td>10</td></tr></table>');
  assert.strictEqual(out, 'Region\tSales\nEMEA\t10');
});

test('bare <img> tags are dropped', function () {
  const out = htmlToText('<p>before <img src="data:image/png;base64,AAAA" /> after</p>');
  assert.strictEqual(out, 'before after');
});

test('block elements are separated by a single blank line, not more', function () {
  const out = htmlToText('<h1>Title</h1><p>One.</p><p>Two.</p>');
  assert.strictEqual(out, 'Title\n\nOne.\n\nTwo.');
});

test('empty or non-string input yields an empty string', function () {
  assert.strictEqual(htmlToText(''), '');
  assert.strictEqual(htmlToText(null), '');
  assert.strictEqual(htmlToText(undefined), '');
});
