// Tests for the page_layout rules (tools/pageLayoutRules.js): value parsers, sort ordering, filter
// predicates, the CSS declaration allowlist, and the records the chat replays page changes from.
//
// The CSS allowlist is the security boundary of the style action, so its refusal cases are the
// ones that matter most. The url() and backslash-escape cases were checked against a copy of the
// module with those two guards removed from the forbidden-value pattern: both tests failed there
// and pass here.
//
// The replay-record tests were checked the same way: with the page-load session left out of the
// undo match, the navigation test fails; with the replaced-sort branch removed, the sort test
// fails.

const test = require('node:test');
const assert = require('node:assert');

const rulesForTest = require('../tools/pageLayoutRules.js');

const NOW_FOR_TEST = Date.UTC(2026, 8, 30, 12, 0, 0);
const DAY_FOR_TEST = 24 * 60 * 60 * 1000;

test('compact numbers read view counts the way video sites print them', function () {
  assert.strictEqual(rulesForTest.parseCompactNumber('1.2M views'), 1200000);
  assert.strictEqual(rulesForTest.parseCompactNumber('340K views'), 340000);
  assert.strictEqual(rulesForTest.parseCompactNumber('1.5 billion'), 1500000000);
  assert.strictEqual(rulesForTest.parseCompactNumber('1,234,567 views'), 1234567);
  assert.strictEqual(rulesForTest.parseCompactNumber('No views'), 0);
  // "min" is not the M suffix.
  assert.strictEqual(rulesForTest.parseCompactNumber('12 min'), 12);
  assert.strictEqual(rulesForTest.parseCompactNumber('views'), null);
});

test('plain numbers handle thousands separators and decimal commas', function () {
  assert.strictEqual(rulesForTest.parseNumber('$1,299.99'), 1299.99);
  assert.strictEqual(rulesForTest.parseNumber('1.299,99 €'), 1299.99);
  assert.strictEqual(rulesForTest.parseNumber('1,5 kg'), 1.5);
  assert.strictEqual(rulesForTest.parseNumber('1.234.567'), 1234567);
  assert.strictEqual(rulesForTest.parseNumber('−42'), -42);
  assert.strictEqual(rulesForTest.parseNumber('no digits here'), null);
});

test('durations read clock and word forms as seconds', function () {
  assert.strictEqual(rulesForTest.parseDuration('12:04'), 724);
  assert.strictEqual(rulesForTest.parseDuration('1:02:03'), 3723);
  assert.strictEqual(rulesForTest.parseDuration('1h 5m'), 3900);
  assert.strictEqual(rulesForTest.parseDuration('45 seconds'), 45);
  assert.strictEqual(rulesForTest.parseDuration('5 months'), null);
});

test('relative times become timestamps on the same scale as dates', function () {
  assert.strictEqual(rulesForTest.parseRelativeTime('3 weeks ago', NOW_FOR_TEST), NOW_FOR_TEST - 21 * DAY_FOR_TEST);
  assert.strictEqual(rulesForTest.parseRelativeTime('an hour ago', NOW_FOR_TEST), NOW_FOR_TEST - 60 * 60 * 1000);
  assert.strictEqual(rulesForTest.parseRelativeTime('Streamed 2 years ago', NOW_FOR_TEST), NOW_FOR_TEST - 730 * DAY_FOR_TEST);
  assert.strictEqual(rulesForTest.parseRelativeTime('5mo ago', NOW_FOR_TEST), NOW_FOR_TEST - 150 * DAY_FOR_TEST);
  assert.strictEqual(rulesForTest.parseRelativeTime('3 min ago', NOW_FOR_TEST), NOW_FOR_TEST - 3 * 60 * 1000);
  assert.strictEqual(rulesForTest.parseRelativeTime('yesterday', NOW_FOR_TEST), NOW_FOR_TEST - DAY_FOR_TEST);
  assert.strictEqual(rulesForTest.parseRelativeTime('Premieres in 2 days', NOW_FOR_TEST), NOW_FOR_TEST + 2 * DAY_FOR_TEST);
  assert.strictEqual(rulesForTest.parseRelativeTime('Top rated', NOW_FOR_TEST), null);
});

test('dates parse only from text that looks like a date', function () {
  assert.strictEqual(rulesForTest.parseDate('Posted Jan 5, 2024'), Date.parse('Jan 5, 2024'));
  assert.strictEqual(rulesForTest.parseDate('2024-01-05'), Date.parse('2024-01-05'));
  assert.strictEqual(rulesForTest.parseDate('whatever', '2023-03-01T10:00:00Z'), Date.parse('2023-03-01T10:00:00Z'));
  // Date.parse('12') is a real date in V8; a bare number must not be read as one.
  assert.strictEqual(rulesForTest.parseDate('Chapter 12'), null);
});

test('kind detection tells the common column types apart', function () {
  assert.strictEqual(rulesForTest.detectKind('12:04'), 'duration');
  assert.strictEqual(rulesForTest.detectKind('12 min'), 'duration');
  assert.strictEqual(rulesForTest.detectKind('3 weeks ago'), 'relative_time');
  assert.strictEqual(rulesForTest.detectKind('1.2M views'), 'compact_number');
  assert.strictEqual(rulesForTest.detectKind('No views'), 'compact_number');
  assert.strictEqual(rulesForTest.detectKind('$19.99'), 'number');
  assert.strictEqual(rulesForTest.detectKind('Jan 5, 2024'), 'date');
  assert.strictEqual(rulesForTest.detectKind('How I built a boat in my garage'), 'text');
  // A word that merely contains a month abbreviation is not a date.
  assert.strictEqual(rulesForTest.detectKind('Mayor speaks'), 'text');
});

test('a column resolves to one kind by majority', function () {
  assert.strictEqual(rulesForTest.chooseKindForValues(['1.2M views', 'No views', '340K views', '1,234 views']), 'compact_number');
  assert.strictEqual(rulesForTest.chooseKindForValues(['How I built a boat', 'My trip to the coast', '12']), 'text');
  assert.strictEqual(rulesForTest.chooseKindForValues([]), 'text');
});

test('sorting puts missing values last in both directions and keeps ties stable', function () {
  const keysForSort = [3, null, 1, 2, null, 2];
  assert.deepStrictEqual(rulesForTest.sortIndices(keysForSort, 'number', 'asc'), [2, 3, 5, 0, 1, 4]);
  assert.deepStrictEqual(rulesForTest.sortIndices(keysForSort, 'number', 'desc'), [0, 3, 5, 2, 1, 4]);
});

test('text sorting is case-insensitive and numeric-aware', function () {
  assert.deepStrictEqual(rulesForTest.sortIndices(['banana', 'Apple', 'cherry'], 'text', 'asc'), [1, 0, 2]);
  assert.deepStrictEqual(rulesForTest.sortIndices(['item 10', 'item 9'], 'text', 'asc'), [1, 0]);
});

test('filter values are parsed with the column kind', function () {
  const shortForTest = rulesForTest.buildFilterPredicate({ op: 'lt', value: '5:00', kind: 'duration', nowMs: NOW_FOR_TEST });
  assert.strictEqual(shortForTest.ok, true);
  assert.strictEqual(shortForTest.test('4:59'), true);
  assert.strictEqual(shortForTest.test('5:00'), false);
  // An item with no duration (a live stream) never matches an ordering comparison.
  assert.strictEqual(shortForTest.test('LIVE'), false);

  const popularForTest = rulesForTest.buildFilterPredicate({ op: 'gte', value: '1M', kind: 'compact_number' });
  assert.strictEqual(popularForTest.test('1.2M views'), true);
  assert.strictEqual(popularForTest.test('340K views'), false);

  const autoForTest = rulesForTest.buildFilterPredicate({ op: 'gt', value: '1M', kind: 'auto' });
  assert.strictEqual(autoForTest.kind, 'compact_number');

  const sponsoredForTest = rulesForTest.buildFilterPredicate({ op: 'contains', value: 'sponsored', kind: 'compact_number' });
  assert.strictEqual(sponsoredForTest.kind, 'text');
  assert.strictEqual(sponsoredForTest.test('Sponsored · Ad'), true);
  assert.strictEqual(sponsoredForTest.test('Regular result'), false);
});

test('bad filter specs are refused with a reason', function () {
  assert.strictEqual(rulesForTest.buildFilterPredicate({ op: 'bogus', value: '1' }).ok, false);
  assert.strictEqual(rulesForTest.buildFilterPredicate({ op: 'lt' }).ok, false);
  assert.strictEqual(rulesForTest.buildFilterPredicate({ op: 'gt', value: 'abc', kind: 'number' }).ok, false);
  assert.strictEqual(rulesForTest.buildFilterPredicate({ op: 'gt', value: '1', kind: 'nonsense' }).ok, false);
  assert.strictEqual(rulesForTest.buildFilterPredicate({ op: 'empty' }).ok, true);
});

test('style accepts layout and typography declarations in either spelling', function () {
  const resultForStyle = rulesForTest.sanitizeStyleDeclarations({ 'font-size': '18px', fontWeight: 600, 'background-color': 'red !important' });
  assert.strictEqual(resultForStyle.ok, true);
  assert.deepStrictEqual(resultForStyle.declarations, [
    { prop: 'font-size', value: '18px' },
    { prop: 'font-weight', value: '600' },
    { prop: 'background-color', value: 'red' }
  ]);
  const stringForStyle = rulesForTest.sanitizeStyleDeclarations('max-width: none; color: #333');
  assert.deepStrictEqual(stringForStyle.declarations, [
    { prop: 'max-width', value: 'none' },
    { prop: 'color', value: '#333' }
  ]);
});

test('style refuses anything that could load a resource', function () {
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ background: 'url(https://example.com/x.png)' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ filter: 'url(#blur)' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ background: 'image-set("a.png" 1x)' }).ok, false);
  // A CSS escape can spell url( without the letters appearing: \75 is "u".
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ background: '\\75 rl(https://example.com/x)' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ width: 'attr(data-w px)' }).ok, false);
});

test('style refuses values that break out of the declaration', function () {
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ color: 'red } body { display: none' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ color: 'red /* x */' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ 'font-family': '@import' }).ok, false);
});

test('style refuses properties outside the allowlist and pinning an element over the page', function () {
  const transformForStyle = rulesForTest.sanitizeStyleDeclarations({ transform: 'translate(10px)', 'z-index': '9999', 'pointer-events': 'none' });
  assert.strictEqual(transformForStyle.ok, false);
  assert.strictEqual(transformForStyle.rejected.length, 3);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ position: 'fixed' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ position: 'absolute' }).ok, false);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations({ position: 'static' }).ok, true);
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations(['font-size', '18px']).ok, false);
});

test('field ids run a..z then aa', function () {
  assert.strictEqual(rulesForTest.fieldIdForIndex(0), 'a');
  assert.strictEqual(rulesForTest.fieldIdForIndex(25), 'z');
  assert.strictEqual(rulesForTest.fieldIdForIndex(26), 'aa');
  assert.strictEqual(rulesForTest.fieldIdForIndex(27), 'ab');
});

const COLLECTION_FOR_TEST = { itemSig: 'div.qa-item', clusterKey: 'div.qa-item<div.d-flex.flex-column<div.ds-card', label: 'My Questions' };
const STATUS_FIELD_FOR_TEST = { path: 'div>div>span.ds-badge.ds-badge-green#0', paths: ['div>div>span.ds-badge.ds-badge-green#0', 'div>div>span.ds-badge.ds-badge-yellow#0'], loose: 'div>div>span#0', kind: 'text' };

function applyRecordForTest(session, items) {
  return { v: 1, op: 'apply', origin: 'http://localhost', session: session, items: items };
}

function itemForTest(key, changeId, extra) {
  return Object.assign({
    key: key,
    change_id: changeId,
    action: 'filter',
    description: 'Hid ' + key,
    spec: { action: 'filter', collection: COLLECTION_FOR_TEST, field: STATUS_FIELD_FOR_TEST, op: 'contains', value: 'Pending', mode: 'hide', parse: 'text' }
  }, extra || {});
}

test('a reply keeps only the changes it left in place', function () {
  // The first live test chat: three filters applied and undone, then the one that worked.
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1')]),
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's1', changeIds: ['L1'] },
    applyRecordForTest('s1', [itemForTest('call2:0', 'L2')]),
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's1', changeIds: ['L2'] },
    applyRecordForTest('s1', [itemForTest('call3:0', 'L3'), itemForTest('call3:1', 'L4')]),
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's1', changeIds: ['L3'] }
  ];
  const net = rulesForTest.netPageChanges(records);
  assert.deepStrictEqual(net.map(function (item) { return item.key; }), ['call3:1']);
  assert.strictEqual(net[0].origin, 'http://localhost');
  assert.strictEqual(net[0].spec.value, 'Pending');
});

test('a reset removes every change the reply made on that page', function () {
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1'), itemForTest('call1:1', 'L2')]),
    { v: 1, op: 'reset', origin: 'http://localhost', session: 's1', changeIds: ['L1', 'L2'] },
    applyRecordForTest('s1', [itemForTest('call2:0', 'L3')])
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call2:0']);
});

test('a reset after a navigation does not remove a change from the earlier page load', function () {
  // Change ids restart at L1 when the page reloads. After the navigation, something other than
  // this reply (another chat, or a replay) made L1, this reply made L2, and a reset lists both.
  // The L1 it lists is not the L1 this reply made before the navigation.
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1')]),
    applyRecordForTest('s2', [itemForTest('call2:0', 'L2')]),
    { v: 1, op: 'reset', origin: 'http://localhost', session: 's2', changeIds: ['L1', 'L2'] }
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call1:0']);
});

test('a sort that replaced an earlier sort drops the earlier one', function () {
  const sortSpec = { action: 'sort', collection: COLLECTION_FOR_TEST, field: STATUS_FIELD_FOR_TEST, order: 'desc', parse: 'text' };
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1', { action: 'sort', spec: sortSpec })]),
    applyRecordForTest('s1', [itemForTest('call2:0', 'L2', { action: 'sort', spec: sortSpec, replaces: 'L1' })])
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call2:0']);
});

// A change the chat applies again on a later visit gets a new id in a new page load and writes no
// record, so an undo of it can only be matched to the reply that made it by key. Verified against
// the rule from before records carried keys: the three key cases fail there (each keeps the change
// it should drop) and the no-key fallback case passes, as it should for older records.
test('an undo of a change applied again on a later visit removes it by key', function () {
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1'), itemForTest('call1:1', 'L2')]),
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's2', changeIds: ['L1'], keys: ['call1:0'] }
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call1:1']);
});

test('a reset on a later visit removes every change it names by key', function () {
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1')]),
    applyRecordForTest('s1', [itemForTest('call2:0', 'L2')]),
    applyRecordForTest('s3', [itemForTest('call3:0', 'L4')]),
    { v: 1, op: 'reset', origin: 'http://localhost', session: 's3', changeIds: ['L1', 'L2', 'L3', 'L4'], keys: ['call2:0', 'call1:0', 'other-chat:0', 'call3:0'] }
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records), []);
});

test('a sort that replaced one applied again on a later visit drops it by key', function () {
  const sortSpec = { action: 'sort', collection: COLLECTION_FOR_TEST, field: STATUS_FIELD_FOR_TEST, order: 'desc', parse: 'text' };
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1', { action: 'sort', spec: sortSpec })]),
    applyRecordForTest('s2', [itemForTest('call2:0', 'L2', { action: 'sort', spec: sortSpec, replaces: 'L1', replaces_key: 'call1:0' })])
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call2:0']);
});

test('an undo entry with no key falls back to the page load and id', function () {
  const records = [
    applyRecordForTest('s1', [itemForTest('call1:0', 'L1'), itemForTest('call1:1', 'L2')]),
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's1', changeIds: ['L2'], keys: [''] },
    { v: 1, op: 'undo', origin: 'http://localhost', session: 's2', changeIds: ['L1'], keys: [''] }
  ];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['call1:0']);
});

test('malformed records and items are skipped, not thrown on', function () {
  const records = [null, 'x', { op: 'apply' }, applyRecordForTest('s1', [null, { key: '' }, { key: 'k', spec: null }, itemForTest('ok:0', 'L1')])];
  assert.deepStrictEqual(rulesForTest.netPageChanges(records).map(function (item) { return item.key; }), ['ok:0']);
  assert.deepStrictEqual(rulesForTest.netPageChanges(undefined), []);
});

test('a stored replay spec keeps only known keys of the expected types', function () {
  const clean = rulesForTest.sanitizeReplaySpec({
    action: 'filter',
    collection: Object.assign({ extra: 'dropped' }, COLLECTION_FOR_TEST),
    field: STATUS_FIELD_FOR_TEST,
    op: 'contains',
    value: 'Pending',
    mode: 'hide',
    parse: 'text',
    label: 'Hide the pending question',
    code: 'alert(1)'
  });
  assert.deepStrictEqual(Object.keys(clean).sort(), ['action', 'collection', 'field', 'label', 'mode', 'op', 'parse', 'value']);
  assert.strictEqual(clean.collection.extra, undefined);
  assert.strictEqual(clean.field.paths.length, 2);
  // Unknown actions, missing targets, and a sort with no field are refused.
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'eval', collection: COLLECTION_FOR_TEST }), null);
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'hide' }), null);
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'sort', collection: COLLECTION_FOR_TEST }), null);
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'sort', collection: COLLECTION_FOR_TEST, field: { path: '*' } }), null);
  // A filter with no field falls back to the whole item text; a bad parse falls back to auto.
  const wholeItem = rulesForTest.sanitizeReplaySpec({ action: 'filter', collection: COLLECTION_FOR_TEST, op: 'contains', value: 'x', parse: 'javascript' });
  assert.deepStrictEqual(wholeItem.field, { path: '*' });
  assert.strictEqual(wholeItem.parse, 'auto');
});

test('a stored style spec passes its CSS on only as strings, for the allowlist to check again', function () {
  const region = { sig: 'aside.side', chain: 'div.layout', id: 'guide', kind: 'sidebar', label: 'Library' };
  const style = rulesForTest.sanitizeReplaySpec({ action: 'style', region: region, css: { 'font-size': '18px', color: { toString: 'x' }, width: 5 } });
  assert.deepStrictEqual(style.css, { 'font-size': '18px' });
  assert.strictEqual(style.region.id, 'guide');
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'style', region: region, css: {} }), null);
  // The stored value is not trusted just because it was stored: url() still fails the allowlist.
  const tampered = rulesForTest.sanitizeReplaySpec({ action: 'style', region: region, css: { background: 'url(https://example.com/x.png)' } });
  assert.strictEqual(rulesForTest.sanitizeStyleDeclarations(tampered.css).ok, false);
});

// Checked against the rules from before order "reverse" and saved titles: there the reverse spec
// is refused for having no field and the title is dropped, so both assertions below fail.
test('a stored sort may reverse the page order with no field, and a split list keeps its title', function () {
  const reverse = rulesForTest.sanitizeReplaySpec({ action: 'sort', collection: COLLECTION_FOR_TEST, order: 'reverse', field: STATUS_FIELD_FOR_TEST });
  assert.strictEqual(reverse.order, 'reverse');
  assert.strictEqual(reverse.field, undefined);
  const titled = rulesForTest.sanitizeReplaySpec({ action: 'hide', collection: Object.assign({ section: 'Recent Q&A' }, COLLECTION_FOR_TEST) });
  assert.strictEqual(titled.collection.section, 'Recent Q&A');
  // An empty title is a real value: the list sat under no title. A missing one stays missing.
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'hide', collection: Object.assign({ section: '' }, COLLECTION_FOR_TEST) }).collection.section, '');
  assert.strictEqual('section' in rulesForTest.sanitizeReplaySpec({ action: 'hide', collection: COLLECTION_FOR_TEST }).collection, false);
  assert.strictEqual(rulesForTest.sanitizeReplaySpec({ action: 'hide', collection: Object.assign({ section: 5 }, COLLECTION_FOR_TEST) }).collection.section, undefined);
});

// The rule is new, so there is no earlier behaviour to check against. A sort label that said
// "newest first" over a sort putting the oldest first is the case it was written for.
test('a sort label states the order its first direction word means for that kind of value', function () {
  const order = rulesForTest.sortLabelOrder;
  assert.strictEqual(order('Q&A newest first', 'relative_time'), 'desc');
  assert.strictEqual(order('Oldest to newest', 'date'), 'asc');
  assert.strictEqual(order('newest to oldest', 'date'), 'desc');
  assert.strictEqual(order('Q&A reverse chronological', 'relative_time'), 'desc');
  assert.strictEqual(order('Questions in chronological order', 'relative_time'), 'asc');
  assert.strictEqual(order('Most recent questions', 'relative_time'), 'desc');
  assert.strictEqual(order('Most viewed first', 'compact_number'), 'desc');
  assert.strictEqual(order('Cheapest first', 'number'), 'asc');
  assert.strictEqual(order('Price: high to low', 'number'), 'desc');
  assert.strictEqual(order('Titles A to Z', 'text'), 'asc');
  assert.strictEqual(order('Titles Z-A', 'text'), 'desc');
  assert.strictEqual(order('Videos, descending', 'duration'), 'desc');
  // A word that does not describe this kind of value, no direction word, or another language says nothing.
  assert.strictEqual(order('Newest first', 'text'), '');
  assert.strictEqual(order('Longest first', 'date'), '');
  assert.strictEqual(order('Q&A sorted by time', 'relative_time'), '');
  assert.strictEqual(order('Más recientes primero', 'date'), '');
  assert.strictEqual(order('', 'date'), '');
  assert.strictEqual(order(undefined, 'date'), '');
  // Words inside other words do not count.
  assert.strictEqual(order('Almost done', 'number'), '');
});

// Checked assertion by assertion against the rules from before this parse. There the separators
// and ordinals give null, dates with no year land in 2001, Feb 30 is read as a date, and the class
// dates are detected as numbers, so every assertion fails except the two that say "May contain
// nuts" and "Feb 9:00" are not dates, which pass on both.
test('dates written without a year or with a separator before the time are read', function () {
  const local = function (y, m, d, h, mi) { return new Date(y, m, d, h || 0, mi || 0).getTime(); };
  // NOW_FOR_TEST is 30 September 2026. February 2027 is nearer to it than February 2026.
  assert.strictEqual(rulesForTest.parseDate('Sat, Feb 22 · 9:00 AM', '', NOW_FOR_TEST), local(2027, 1, 22, 9));
  assert.strictEqual(rulesForTest.parseDate('Aug 14 • 6:30 pm', '', NOW_FOR_TEST), local(2026, 7, 14, 18, 30));
  assert.strictEqual(rulesForTest.parseDate('22nd of February', '', NOW_FOR_TEST), local(2027, 1, 22));
  assert.strictEqual(rulesForTest.parseDate('Oct 3 12:15 am', '', NOW_FOR_TEST), local(2026, 9, 3, 0, 15));
  assert.strictEqual(rulesForTest.parseDate('Sat, Feb 22, 2026 at 9:00 AM', '', NOW_FOR_TEST), local(2026, 1, 22, 9));
  assert.strictEqual(rulesForTest.parseDate('Feb 22nd, 2026 | 6:30 PM', '', NOW_FOR_TEST), local(2026, 1, 22, 18, 30));
  // Not dates: no day, a day the month does not have, a time where the day should be.
  assert.strictEqual(rulesForTest.parseDate('May contain nuts', '', NOW_FOR_TEST), null);
  assert.strictEqual(rulesForTest.parseDate('Feb 30', '', NOW_FOR_TEST), null);
  assert.strictEqual(rulesForTest.parseDate('Feb 9:00', '', NOW_FOR_TEST), null);
  assert.strictEqual(rulesForTest.chooseKindForValues(['Sat, Feb 22 · 9:00 AM', 'Sat, Mar 1 · 9:00 AM', 'Sat, Mar 8 · 9:00 AM']), 'date');
  // A list running from December into January sorts as one run, not with January first.
  const december = local(2026, 11, 1);
  const keys = ['Jan 5', 'Dec 20', 'Dec 28'].map(function (t) { return rulesForTest.parseValue(t, 'date', { nowMs: december }); });
  assert.deepStrictEqual(rulesForTest.sortIndices(keys, 'date', 'asc'), [1, 2, 0]);
  // A filter value with no year is read the same way as the items.
  const after = rulesForTest.buildFilterPredicate({ op: 'gt', value: 'Mar 1', kind: 'date', nowMs: NOW_FOR_TEST });
  assert.strictEqual(after.test('Sat, Mar 8 · 9:00 AM'), true);
  assert.strictEqual(after.test('Sat, Feb 22 · 9:00 AM'), false);
});
