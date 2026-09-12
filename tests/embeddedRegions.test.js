// Pure rules for embedded cross-origin regions (agent/embeddedRegions.js).
//
// These are new rules, not a reconstruction of a shipped bug, so each case pins a specific
// decision the toolExec DOM scan and the page_read/page_observe wiring depend on. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const rulesForRegionTest = require('../agent/embeddedRegions.js');

const TOP_ORIGIN_FOR_REGION_TEST = 'https://app.gohighlevel.com';
const IFRAME_ORIGIN_FOR_REGION_TEST = 'https://email-home-prod.leadconnectorhq.com';

test('isLargeCrossOriginRegion: large cross-origin frame is flagged', function () {
  assert.strictEqual(
    rulesForRegionTest.isLargeCrossOriginRegion({
      topOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST,
      viewportFraction: 0.8
    }),
    true
  );
});

test('isLargeCrossOriginRegion: same-origin frame is never flagged, however large', function () {
  assert.strictEqual(
    rulesForRegionTest.isLargeCrossOriginRegion({
      topOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      srcOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      viewportFraction: 0.95
    }),
    false
  );
});

test('isLargeCrossOriginRegion: cross-origin but below the fraction is ignored', function () {
  assert.strictEqual(
    rulesForRegionTest.isLargeCrossOriginRegion({
      topOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST,
      viewportFraction: 0.05
    }),
    false
  );
});

test('isLargeCrossOriginRegion: exactly at the default threshold counts', function () {
  assert.strictEqual(
    rulesForRegionTest.isLargeCrossOriginRegion({
      topOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST,
      viewportFraction: rulesForRegionTest.MIN_REGION_VIEWPORT_FRACTION
    }),
    true
  );
});

test('isLargeCrossOriginRegion: opaque, missing, or origin-less inputs are safe falses', function () {
  assert.strictEqual(rulesForRegionTest.isLargeCrossOriginRegion({ topOrigin: TOP_ORIGIN_FOR_REGION_TEST, srcOrigin: 'null', viewportFraction: 0.9 }), false);
  assert.strictEqual(rulesForRegionTest.isLargeCrossOriginRegion({ topOrigin: TOP_ORIGIN_FOR_REGION_TEST, srcOrigin: '', viewportFraction: 0.9 }), false);
  assert.strictEqual(rulesForRegionTest.isLargeCrossOriginRegion({ topOrigin: '', srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST, viewportFraction: 0.9 }), false);
  assert.strictEqual(rulesForRegionTest.isLargeCrossOriginRegion(null), false);
  assert.strictEqual(rulesForRegionTest.isLargeCrossOriginRegion({ topOrigin: TOP_ORIGIN_FOR_REGION_TEST, srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST, viewportFraction: 0 }), false);
});

test('isLargeCrossOriginRegion: an explicit lower threshold is honored', function () {
  assert.strictEqual(
    rulesForRegionTest.isLargeCrossOriginRegion({
      topOrigin: TOP_ORIGIN_FOR_REGION_TEST,
      srcOrigin: IFRAME_ORIGIN_FOR_REGION_TEST,
      viewportFraction: 0.08
    }, 0.05),
    true
  );
});

test('shouldSuppressUnnamedControlRow: a nameless, textless non-field row is dropped', function () {
  // This is the refs 69/70/71 case from the transcript: role only, no words to act on.
  assert.strictEqual(
    rulesForRegionTest.shouldSuppressUnnamedControlRow({ ref: 70, role: 'clickable', state: { offscreen: true } }, 'custom_elements'),
    true
  );
});

test('shouldSuppressUnnamedControlRow: any of name/value/placeholder/text keeps the row', function () {
  assert.strictEqual(rulesForRegionTest.shouldSuppressUnnamedControlRow({ role: 'link', name: 'Campaigns' }, 'links'), false);
  assert.strictEqual(rulesForRegionTest.shouldSuppressUnnamedControlRow({ role: 'clickable', text: 'Next' }, 'custom_elements'), false);
  assert.strictEqual(rulesForRegionTest.shouldSuppressUnnamedControlRow({ role: 'textbox', value: 'hi' }, 'buttons'), false);
  assert.strictEqual(rulesForRegionTest.shouldSuppressUnnamedControlRow({ role: 'textbox', placeholder: 'Search' }, 'buttons'), false);
});

test('shouldSuppressUnnamedControlRow: form fields are never suppressed even when nameless', function () {
  assert.strictEqual(
    rulesForRegionTest.shouldSuppressUnnamedControlRow({ ref: 5, role: 'textbox', type: 'text' }, 'form_fields'),
    false
  );
});

test('describe notes: empty regions yield no note; a region names its origin', function () {
  assert.strictEqual(rulesForRegionTest.describeReadNote([]), '');
  assert.strictEqual(rulesForRegionTest.describeObserveNote([]), '');
  const readNoteForTest = rulesForRegionTest.describeReadNote([{ origin: IFRAME_ORIGIN_FOR_REGION_TEST, src: IFRAME_ORIGIN_FOR_REGION_TEST + '/x', fraction: 0.8 }]);
  assert.ok(readNoteForTest.indexOf(IFRAME_ORIGIN_FOR_REGION_TEST) !== -1);
  assert.ok(readNoteForTest.indexOf('take_screenshot') !== -1);
  // The read note must route interaction to page_observe (which can reach the embed's controls),
  // not tell the model its controls are unreachable; that contradicted the system prompt.
  assert.ok(readNoteForTest.indexOf('page_observe') !== -1);
  const observeNoteForTest = rulesForRegionTest.describeObserveNote([{ origin: IFRAME_ORIGIN_FOR_REGION_TEST, fraction: 0.8 }]);
  assert.ok(observeNoteForTest.indexOf('page_act') !== -1);
});

test('describe notes: duplicate origins are listed once', function () {
  const noteForTest = rulesForRegionTest.describeReadNote([
    { origin: IFRAME_ORIGIN_FOR_REGION_TEST, fraction: 0.5 },
    { origin: IFRAME_ORIGIN_FOR_REGION_TEST, fraction: 0.3 }
  ]);
  const firstIdxForTest = noteForTest.indexOf(IFRAME_ORIGIN_FOR_REGION_TEST);
  const lastIdxForTest = noteForTest.lastIndexOf(IFRAME_ORIGIN_FOR_REGION_TEST);
  assert.strictEqual(firstIdxForTest, lastIdxForTest);
});
