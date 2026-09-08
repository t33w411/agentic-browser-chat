// Link-annotation mapping for PDF text extraction (agent/pdfLinks.js). pdf.js getTextContent never
// carries a link target, so before this module PDF hyperlink URLs were dropped and only the anchor
// text reached the model. These functions transform a page's Link annotations into viewport-space
// rects, tag the overlapping text items, and render each linked run as "text (url)" like the DOCX
// path. Every assertion below is impossible under the prior no-annotation extraction: it produced
// no URL at all. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const { annotationsToLinkRects, assignLinkUrlsToItems, formatLinkedText } = require('../agent/pdfLinks.js');

// pdf.js unrotated scale-1 viewport transform: x' = x, y' = pageHeight - y (the y-flip that puts
// the top of the page at viewport y 0). Using the real shape keeps the geometry test honest.
const PAGE_HEIGHT = 800;
const VIEWPORT_TRANSFORM = [1, 0, 0, -1, 0, PAGE_HEIGHT];

test('a Link annotation rect is transformed into a normalized viewport rect', function () {
  const rects = annotationsToLinkRects(
    [{ subtype: 'Link', url: 'https://example.com', rect: [100, 700, 180, 715] }],
    VIEWPORT_TRANSFORM
  );
  assert.strictEqual(rects.length, 1);
  // y is flipped, so the raw min/max swap: PDF y 700..715 -> viewport y 85..100.
  assert.deepStrictEqual(rects[0], {
    url: 'https://example.com',
    left: 100,
    right: 180,
    top: 85,
    bottom: 100
  });
});

test('non-Link annotations, internal destinations, and unsupported schemes are skipped', function () {
  const rects = annotationsToLinkRects(
    [
      { subtype: 'Widget', url: 'https://example.com', rect: [0, 0, 10, 10] },
      { subtype: 'Link', dest: [1, 'XYZ'], rect: [0, 0, 10, 10] },
      { subtype: 'Link', url: 'javascript:alert(1)', rect: [0, 0, 10, 10] },
      { subtype: 'Link', url: 'https://ok.com', rect: [0, 0, 10, 10] }
    ],
    VIEWPORT_TRANSFORM
  );
  assert.strictEqual(rects.length, 1);
  assert.strictEqual(rects[0].url, 'https://ok.com');
});

test('a text item whose centre falls in a link rect is tagged; others are left untagged', function () {
  const rects = annotationsToLinkRects(
    [{ subtype: 'Link', url: 'https://example.com', rect: [100, 700, 180, 715] }],
    VIEWPORT_TRANSFORM
  );
  const linked = { str: 'example', x: 105, end: 175, y: 98, height: 12 };
  const plain = { str: 'other', x: 300, end: 360, y: 200, height: 12 };
  assignLinkUrlsToItems([linked, plain], rects);
  assert.strictEqual(linked.linkUrl, 'https://example.com');
  assert.strictEqual(plain.linkUrl, undefined);
});

test('overlapping rects resolve to the first match', function () {
  const rects = [
    { url: 'https://first.com', left: 0, right: 100, top: 0, bottom: 100 },
    { url: 'https://second.com', left: 0, right: 100, top: 0, bottom: 100 }
  ];
  const item = { str: 'x', x: 40, end: 60, y: 55, height: 10 };
  assignLinkUrlsToItems([item], rects);
  assert.strictEqual(item.linkUrl, 'https://first.com');
});

test('formatLinkedText renders text (url), collapses when redundant, and passes plain text through', function () {
  assert.strictEqual(
    formatLinkedText('example', 'https://example.com'),
    'example (https://example.com)'
  );
  assert.strictEqual(
    formatLinkedText('https://example.com', 'https://example.com'),
    'https://example.com'
  );
  assert.strictEqual(formatLinkedText('   ', 'https://x.com'), 'https://x.com');
  assert.strictEqual(formatLinkedText('foo', '/internal'), 'foo');
});
