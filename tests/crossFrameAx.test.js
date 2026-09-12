// Pure helpers for reaching into a cross-origin embedded frame (background/crossFrameAx.js).
//
// New rules, not a reconstruction of a shipped bug. Each case pins a decision the service-worker
// merge/act path and the cdpAutomation coordinate math depend on. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const axForTest = require('../background/crossFrameAx.js');

function axNodeForTest(role, name, backendId, ignored) {
  return {
    role: { value: role },
    name: name == null ? undefined : { value: name },
    backendDOMNodeId: backendId,
    ignored: ignored === true
  };
}

test('isCrossFrameRef: only reserved-range numbers count', function () {
  assert.strictEqual(axForTest.isCrossFrameRef(axForTest.CROSS_FRAME_REF_BASE + 1), true);
  assert.strictEqual(axForTest.isCrossFrameRef(axForTest.CROSS_FRAME_REF_BASE), true);
  assert.strictEqual(axForTest.isCrossFrameRef(70), false);
  assert.strictEqual(axForTest.isCrossFrameRef(undefined), false);
  assert.strictEqual(axForTest.isCrossFrameRef('100001'), false);
});

test('shouldIncludeAxNode: actionable, named, with a backend id', function () {
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('button', 'Create campaign', 42)), true);
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('tab', 'Campaigns', 43)), true);
});

test('shouldIncludeAxNode: dropped when ignored, nameless, non-actionable, or handle-less', function () {
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('button', 'X', 1, true)), false, 'ignored');
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('button', '', 1)), false, 'nameless');
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('generic', 'Some text', 1)), false, 'non-actionable role');
  assert.strictEqual(axForTest.shouldIncludeAxNode(axNodeForTest('button', 'X', undefined)), false, 'no backend id');
});

test('observeRoleForAxRole: maps to the words same-frame rows use', function () {
  assert.strictEqual(axForTest.observeRoleForAxRole('searchbox'), 'textbox');
  assert.strictEqual(axForTest.observeRoleForAxRole('combobox'), 'select');
  assert.strictEqual(axForTest.observeRoleForAxRole('listbox'), 'select');
  assert.strictEqual(axForTest.observeRoleForAxRole('button'), 'button');
  assert.strictEqual(axForTest.observeRoleForAxRole(''), 'clickable');
});

test('ref registry: same control keeps its ref; distinct controls get distinct reserved refs', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  const aFirstForTest = regForTest.refFor('F1', 42);
  const aAgainForTest = regForTest.refFor('F1', 42);
  const bForTest = regForTest.refFor('F1', 43);
  assert.strictEqual(aFirstForTest, aAgainForTest);
  assert.notStrictEqual(aFirstForTest, bForTest);
  assert.ok(aFirstForTest > axForTest.CROSS_FRAME_REF_BASE);
  assert.deepStrictEqual(regForTest.resolve(aFirstForTest), { frameId: 'F1', backendNodeId: 42 });
  assert.strictEqual(regForTest.resolve(999999), null);
});

test('ref registry: the same backend id in a different frame is a different ref', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  assert.notStrictEqual(regForTest.refFor('F1', 42), regForTest.refFor('F2', 42));
});

test('ref registry: reset drops every mapping', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  const refForTest = regForTest.refFor('F1', 42);
  regForTest.reset();
  assert.strictEqual(regForTest.resolve(refForTest), null);
});

test('buildCrossFrameRows: builds ref/role/name rows and skips nameless controls', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  const controlsForTest = [
    { frameId: 'F1', backendNodeId: 42, axNode: axNodeForTest('tab', 'Campaigns', 42) },
    { frameId: 'F1', backendNodeId: 43, axNode: axNodeForTest('button', '', 43) },
    { frameId: 'F1', backendNodeId: 44, axNode: axNodeForTest('link', 'Templates', 44) }
  ];
  const rowsForTest = axForTest.buildCrossFrameRows(controlsForTest, regForTest, {});
  assert.strictEqual(rowsForTest.length, 2);
  assert.deepStrictEqual(rowsForTest[0], { ref: regForTest.refFor('F1', 42), role: 'tab', name: 'Campaigns' });
  assert.strictEqual(rowsForTest[1].name, 'Templates');
});

test('buildCrossFrameRows: name_filter keeps only matching rows', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  const controlsForTest = [
    { frameId: 'F1', backendNodeId: 42, axNode: axNodeForTest('tab', 'Campaigns', 42) },
    { frameId: 'F1', backendNodeId: 44, axNode: axNodeForTest('link', 'Templates', 44) }
  ];
  const rowsForTest = axForTest.buildCrossFrameRows(controlsForTest, regForTest, { nameFilterAlts: ['campaign'] });
  assert.strictEqual(rowsForTest.length, 1);
  assert.strictEqual(rowsForTest[0].name, 'Campaigns');
});

test('buildCrossFrameRows: maxRows caps output', function () {
  const regForTest = axForTest.createCrossFrameRefRegistry();
  const controlsForTest = [];
  for (let iForTest = 0; iForTest < 10; iForTest++) {
    controlsForTest.push({ frameId: 'F1', backendNodeId: 100 + iForTest, axNode: axNodeForTest('button', 'B' + iForTest, 100 + iForTest) });
  }
  assert.strictEqual(axForTest.buildCrossFrameRows(controlsForTest, regForTest, { maxRows: 3 }).length, 3);
});

test('pickOptionControl: exact beats prefix beats contains, case-insensitive', function () {
  const controlsForTest = [
    { frameId: 'F1', backendNodeId: 1, axNode: axNodeForTest('option', 'United Kingdom', 1) },
    { frameId: 'F1', backendNodeId: 2, axNode: axNodeForTest('option', 'United States', 2) },
    { frameId: 'F1', backendNodeId: 3, axNode: axNodeForTest('option', 'United', 3) }
  ];
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, 'united').backendNodeId, 3, 'exact (case-insensitive)');
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, 'United King').backendNodeId, 1, 'prefix');
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, 'States').backendNodeId, 2, 'contains');
});

test('pickOptionControl: no match or empty request yields null', function () {
  const controlsForTest = [{ frameId: 'F1', backendNodeId: 1, axNode: axNodeForTest('option', 'Alpha', 1) }];
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, 'Zeta'), null);
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, ''), null);
  assert.strictEqual(axForTest.pickOptionControl(controlsForTest, null), null);
  assert.strictEqual(axForTest.pickOptionControl([], 'Alpha'), null);
});

test('frameChainToRoot: walks child up to (excluding) root; root and unknown yield empty', function () {
  const parentOfForTest = { child: 'mid', mid: 'root', root: null };
  assert.deepStrictEqual(axForTest.frameChainToRoot('child', parentOfForTest), ['child', 'mid']);
  assert.deepStrictEqual(axForTest.frameChainToRoot('root', parentOfForTest), []);
  assert.deepStrictEqual(axForTest.frameChainToRoot('unknown', parentOfForTest), []);
});

test('sumFrameChainOffset: adds each frame offset to the local center and rounds', function () {
  const ptForTest = axForTest.sumFrameChainOffset({ x: 10.4, y: 20.6 }, [{ x: 5, y: 95 }, { x: 2.1, y: 3.9 }]);
  assert.deepStrictEqual(ptForTest, { x: 18, y: 120 });
  assert.deepStrictEqual(axForTest.sumFrameChainOffset({ x: 3, y: 4 }, []), { x: 3, y: 4 });
});
