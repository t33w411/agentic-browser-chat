// Rules for the cross-tab chat input draft mirror (panel/panelDraftSync.js).
//
// These cover the deliveries that cannot be staged by hand against real tabs: events arriving out
// of order, and a background tab processing a change long after it was written. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const rulesForDraftTest = require('../panel/panelDraftSync.js');

const SCOPE_FOR_DRAFT_TEST = 'c1';

function stateForDraftTest(overridesForState) {
  return Object.assign({
    mountedScope: SCOPE_FOR_DRAFT_TEST,
    baseUpdatedAt: 0,
    baseVersion: '',
    dirty: false,
    chipLoading: false,
    sendLocked: false,
    selfSourceId: 'tab-a'
  }, overridesForState || {});
}

function payloadForDraftTest(overridesForPayload) {
  return Object.assign({
    text: 'remote',
    chips: [],
    chatScope: SCOPE_FOR_DRAFT_TEST,
    sourceId: 'tab-b',
    revision: 1,
    version: 'tab-b:1:1000',
    updatedAt: 1000,
    cleared: false,
    clearedThroughUpdatedAt: 0
  }, overridesForPayload || {});
}

function decideForDraftTest(stateOverridesForDecide, payloadOverridesForDecide, scopeForDecide) {
  return rulesForDraftTest.decideIncomingDraftAction(
    stateForDraftTest(stateOverridesForDecide),
    scopeForDecide === undefined ? SCOPE_FOR_DRAFT_TEST : scopeForDecide,
    payloadOverridesForDecide === null ? null : payloadForDraftTest(payloadOverridesForDecide)
  );
}

test('ignores a payload this tab wrote itself', function () {
  assert.strictEqual(decideForDraftTest({}, { sourceId: 'tab-a' }).action, 'ignore');
});

test('ignores a payload for a scope the composer is not bound to', function () {
  assert.strictEqual(decideForDraftTest({}, {}, 'c2').action, 'ignore');
  assert.strictEqual(decideForDraftTest({ mountedScope: null }, {}).action, 'ignore');
});

test('adopts a payload newer than what the composer shows', function () {
  const decisionForNewer = decideForDraftTest({ baseUpdatedAt: 500 }, { updatedAt: 900 });
  assert.strictEqual(decisionForNewer.action, 'apply');
});

test('republishes its own content when the payload is older', function () {
  const decisionForOlder = decideForDraftTest(
    { baseUpdatedAt: 2000, baseVersion: 'tab-a:4:2000' },
    { updatedAt: 900 }
  );
  assert.strictEqual(decisionForOlder.action, 'reassert');
});

test('resolves a same-millisecond tie the same way in both tabs', function () {
  const versionAForTie = 'tab-a:1:1000';
  const versionBForTie = 'tab-b:1:1000';
  const inTabAForTie = decideForDraftTest(
    { baseUpdatedAt: 1000, baseVersion: versionAForTie, selfSourceId: 'tab-a' },
    { updatedAt: 1000, version: versionBForTie, sourceId: 'tab-b' }
  );
  const inTabBForTie = rulesForDraftTest.decideIncomingDraftAction(
    stateForDraftTest({ baseUpdatedAt: 1000, baseVersion: versionBForTie, selfSourceId: 'tab-b' }),
    SCOPE_FOR_DRAFT_TEST,
    payloadForDraftTest({ updatedAt: 1000, version: versionAForTie, sourceId: 'tab-a' })
  );
  // Exactly one side may yield, or the two would trade writes forever.
  assert.notStrictEqual(inTabAForTie.action, inTabBForTie.action);
  assert.deepStrictEqual(
    [inTabAForTie.action, inTabBForTie.action].sort(),
    ['apply', 'reassert']
  );
});

test('unsaved local edits outrank any remote payload', function () {
  assert.strictEqual(decideForDraftTest({ dirty: true }, { updatedAt: 9999 }).action, 'ignore');
});

test('refuses to repaint while an attachment is still uploading', function () {
  assert.strictEqual(decideForDraftTest({ chipLoading: true }, { updatedAt: 9999 }).action, 'ignore');
});

test('leaves the composer alone while a submit owns the scope', function () {
  assert.strictEqual(decideForDraftTest({ sendLocked: true }, { updatedAt: 9999 }).action, 'ignore');
});

test('clears the composer when the record is deleted, even with unsaved edits', function () {
  assert.strictEqual(decideForDraftTest({}, null).action, 'apply-empty');
  assert.strictEqual(decideForDraftTest({ dirty: true }, null).action, 'apply-empty');
});

test('accepts a clear that covers everything this tab holds', function () {
  const decisionForClear = decideForDraftTest(
    { baseUpdatedAt: 800 },
    { cleared: true, text: '', updatedAt: 1200, clearedThroughUpdatedAt: 900 }
  );
  assert.strictEqual(decisionForClear.action, 'apply');
});

test('survives a clear when this tab holds text the submit never saw', function () {
  const decisionForDirtyClear = decideForDraftTest(
    { dirty: true, baseUpdatedAt: 800 },
    { cleared: true, text: '', updatedAt: 1200, clearedThroughUpdatedAt: 900 }
  );
  assert.strictEqual(decisionForDirtyClear.action, 'reassert');

  const decisionForNewerClear = decideForDraftTest(
    { baseUpdatedAt: 950 },
    { cleared: true, text: '', updatedAt: 1200, clearedThroughUpdatedAt: 900 }
  );
  assert.strictEqual(decisionForNewerClear.action, 'reassert');
});

test('a delayed payload never wins over one written after it', function () {
  // The composer already adopted the newer write; the older one arrives afterwards.
  const decisionForReordered = decideForDraftTest(
    { baseUpdatedAt: 2000, baseVersion: 'tab-b:2:2000' },
    { updatedAt: 1500, version: 'tab-b:1:1500', text: 'stale' }
  );
  assert.strictEqual(decisionForReordered.action, 'reassert');
});

test('only ever returns the four known actions', function () {
  const actionsForCoverage = new Set();
  [true, false].forEach(function (dirtyForCoverage) {
    [true, false].forEach(function (clearedForCoverage) {
      [0, 1000, 5000].forEach(function (baseForCoverage) {
        actionsForCoverage.add(decideForDraftTest(
          { dirty: dirtyForCoverage, baseUpdatedAt: baseForCoverage },
          { cleared: clearedForCoverage, updatedAt: 2000, clearedThroughUpdatedAt: 1500 }
        ).action);
      });
    });
  });
  actionsForCoverage.forEach(function (actionForCoverage) {
    assert.ok(
      ['ignore', 'apply', 'apply-empty', 'reassert'].indexOf(actionForCoverage) !== -1,
      'unexpected action: ' + actionForCoverage
    );
  });
});

test('submitted-draft clear adopts anything written after the snapshot', function () {
  const submittedForClear = { version: 'tab-a:3:1000', updatedAt: 1000 };
  assert.strictEqual(
    rulesForDraftTest.decideSubmittedClearAction(submittedForClear, null).action,
    'clear'
  );
  assert.strictEqual(
    rulesForDraftTest.decideSubmittedClearAction(submittedForClear, {
      version: 'tab-a:3:1000', updatedAt: 1000
    }).action,
    'clear'
  );
  assert.strictEqual(
    rulesForDraftTest.decideSubmittedClearAction(submittedForClear, {
      version: 'tab-b:1:1400', updatedAt: 1400
    }).action,
    'adopt'
  );
  assert.strictEqual(
    rulesForDraftTest.decideSubmittedClearAction(submittedForClear, {
      version: 'tab-b:1:800', updatedAt: 800
    }).action,
    'clear'
  );
});

test('serialization is stable across chip key order', function () {
  const leftForSerialize = { text: 'x', chips: [{ type: 'note', label: 'A', refId: 3 }] };
  const rightForSerialize = { text: 'x', chips: [{ refId: 3, label: 'A', type: 'note' }] };
  assert.strictEqual(
    rulesForDraftTest.serializeDraft(leftForSerialize),
    rulesForDraftTest.serializeDraft(rightForSerialize)
  );
});

test('storage keys round-trip and reject junk scopes', function () {
  assert.strictEqual(rulesForDraftTest.getScopeFromStorageKey(rulesForDraftTest.getStorageKeyForScope('12')), '12');
  assert.strictEqual(rulesForDraftTest.getScopeFromStorageKey(rulesForDraftTest.getStorageKeyForScope('new')), 'new');
  assert.strictEqual(rulesForDraftTest.getScopeFromStorageKey('abchat_note_draft_sync:4'), null);
  assert.strictEqual(rulesForDraftTest.getScopeFromStorageKey('abchat_input_draft_sync:nope'), null);
  assert.strictEqual(rulesForDraftTest.getScopeFromStorageKey('abchat_input_draft_sync:-2'), null);
});

// ---------------------------------------------------------------------------
// Multi-tab simulation. One shared record, several tabs, deliveries that can be
// held back and replayed late, which is what a throttled background tab does.
// ---------------------------------------------------------------------------

function createHarnessForDraftTest(tabCountForHarness) {
  let clockForHarness = 1000;
  const storeForHarness = { payload: null };
  const tabsForHarness = [];
  const queueForHarness = [];

  for (let indexForHarness = 0; indexForHarness < tabCountForHarness; indexForHarness++) {
    tabsForHarness.push({
      id: 'tab' + indexForHarness,
      text: '',
      revision: 0,
      // A parked tab is one the browser has throttled: its change events pile up unprocessed
      // and are worked through, in order, whenever it next gets to run.
      parked: false,
      backlog: [],
      state: stateForDraftTest({ selfSourceId: 'tab' + indexForHarness })
    });
  }

  function writeForHarness(tabForWrite, textForWrite, extraForWrite) {
    tabForWrite.revision += 1;
    clockForHarness += 1;
    const writtenForHarness = Object.assign({
      text: textForWrite,
      chips: [],
      chatScope: SCOPE_FOR_DRAFT_TEST,
      sourceId: tabForWrite.id,
      revision: tabForWrite.revision,
      version: tabForWrite.id + ':' + tabForWrite.revision + ':' + clockForHarness,
      updatedAt: clockForHarness,
      cleared: false,
      clearedThroughUpdatedAt: 0
    }, extraForWrite || {});
    storeForHarness.payload = writtenForHarness;
    tabForWrite.state.baseUpdatedAt = writtenForHarness.updatedAt;
    tabForWrite.state.baseVersion = writtenForHarness.version;
    tabForWrite.state.dirty = false;
    // chrome.storage.onChanged fires in the writing context too; the self-echo rule filters it.
    tabsForHarness.forEach(function (otherForHarness) {
      const entryForHarness = { tab: otherForHarness, payload: writtenForHarness };
      if (otherForHarness.parked) otherForHarness.backlog.push(entryForHarness);
      else queueForHarness.push(entryForHarness);
    });
    return writtenForHarness;
  }

  function deliverForHarness(entryForDeliver) {
    const tabForDeliver = entryForDeliver.tab;
    const decisionForDeliver = rulesForDraftTest.decideIncomingDraftAction(
      tabForDeliver.state,
      SCOPE_FOR_DRAFT_TEST,
      entryForDeliver.payload
    );
    if (decisionForDeliver.action === 'apply') {
      tabForDeliver.text = entryForDeliver.payload.text;
      tabForDeliver.state.baseUpdatedAt = entryForDeliver.payload.updatedAt;
      tabForDeliver.state.baseVersion = entryForDeliver.payload.version;
      tabForDeliver.state.dirty = false;
    } else if (decisionForDeliver.action === 'apply-empty') {
      tabForDeliver.text = '';
      tabForDeliver.state.baseUpdatedAt = 0;
      tabForDeliver.state.baseVersion = '';
      tabForDeliver.state.dirty = false;
    } else if (decisionForDeliver.action === 'reassert') {
      writeForHarness(tabForDeliver, tabForDeliver.text);
    }
    return decisionForDeliver;
  }

  // Pulls the queue until empty. `order` picks which pending delivery runs next, so the same
  // scenario can be replayed in arrival order or reversed.
  function drainForHarness(orderForDrain) {
    let stepsForDrain = 0;
    while (queueForHarness.length > 0) {
      stepsForDrain += 1;
      assert.ok(stepsForDrain < 500, 'deliveries did not settle: write storm');
      const indexForDrain = orderForDrain === 'reverse' ? queueForHarness.length - 1 : 0;
      deliverForHarness(queueForHarness.splice(indexForDrain, 1)[0]);
    }
    return stepsForDrain;
  }

  function parkForHarness(tabForPark) {
    tabForPark.parked = true;
  }

  // Wakes a parked tab and lets it work through its backlog in arrival order, settling the
  // consequences of each event before the next, which is how a real listener runs.
  function wakeForHarness(tabForWake) {
    tabForWake.parked = false;
    while (tabForWake.backlog.length > 0) {
      deliverForHarness(tabForWake.backlog.shift());
      drainForHarness();
    }
  }

  return {
    store: storeForHarness,
    tabs: tabsForHarness,
    write: writeForHarness,
    deliver: deliverForHarness,
    drain: drainForHarness,
    park: parkForHarness,
    wake: wakeForHarness
  };
}

test('three tabs converge on ordinary typing', function () {
  const harnessForConverge = createHarnessForDraftTest(3);
  const authorForConverge = harnessForConverge.tabs[0];
  ['h', 'he', 'hello'].forEach(function (textForConverge) {
    authorForConverge.text = textForConverge;
    harnessForConverge.write(authorForConverge, textForConverge);
    harnessForConverge.drain();
  });
  harnessForConverge.tabs.forEach(function (tabForConverge) {
    assert.strictEqual(tabForConverge.text, 'hello');
  });
  assert.strictEqual(harnessForConverge.store.payload.text, 'hello');
});

test('three tabs converge when deliveries arrive out of order', function () {
  const harnessForReorder = createHarnessForDraftTest(3);
  const authorForReorder = harnessForReorder.tabs[0];
  ['a', 'ab', 'abc'].forEach(function (textForReorder) {
    authorForReorder.text = textForReorder;
    harnessForReorder.write(authorForReorder, textForReorder);
  });
  harnessForReorder.drain('reverse');
  harnessForReorder.tabs.forEach(function (tabForReorder) {
    assert.strictEqual(tabForReorder.text, 'abc');
  });
  assert.strictEqual(harnessForReorder.store.payload.text, 'abc');
});

test('a background tab waking up late cannot resurrect an old draft', function () {
  // The exact shape of the shipped bug. A tab throttled from the submit onward still holds the
  // state the old code used to arm its post-submit restore, so when it finally works through the
  // backlog it must not publish that stale text back out as the newest record. Verified to fail
  // against the deleted restore branch, which ends this scenario with every tab back on "next".
  const harnessForResurrect = createHarnessForDraftTest(2);
  const authorForResurrect = harnessForResurrect.tabs[0];
  const sleeperForResurrect = harnessForResurrect.tabs[1];

  authorForResurrect.text = 'draft';
  const submittedForResurrect = harnessForResurrect.write(authorForResurrect, 'draft');
  harnessForResurrect.drain();

  authorForResurrect.text = '';
  harnessForResurrect.write(authorForResurrect, '', {
    cleared: true,
    clearedThroughUpdatedAt: submittedForResurrect.updatedAt
  });
  harnessForResurrect.drain();
  harnessForResurrect.tabs.forEach(function (tabForResurrect) {
    assert.strictEqual(tabForResurrect.text, '', 'submit should clear every tab');
  });

  // The tab goes to sleep here and misses the whole of the next message being typed.
  harnessForResurrect.park(sleeperForResurrect);
  authorForResurrect.text = 'next';
  harnessForResurrect.write(authorForResurrect, 'next');
  harnessForResurrect.drain();
  authorForResurrect.text = 'next question';
  harnessForResurrect.write(authorForResurrect, 'next question');
  harnessForResurrect.drain();
  assert.strictEqual(authorForResurrect.text, 'next question');

  harnessForResurrect.wake(sleeperForResurrect);

  assert.strictEqual(
    harnessForResurrect.store.payload.text,
    'next question',
    'a late delivery must not overwrite the record with older text'
  );
  harnessForResurrect.tabs.forEach(function (tabForResurrect) {
    assert.strictEqual(tabForResurrect.text, 'next question');
  });
});

test('a tab with unsaved edits keeps them and converges once it saves', function () {
  const harnessForDirty = createHarnessForDraftTest(2);
  const typingTabForDirty = harnessForDirty.tabs[0];
  const otherTabForDirty = harnessForDirty.tabs[1];

  otherTabForDirty.text = 'from other tab';
  harnessForDirty.write(otherTabForDirty, 'from other tab');

  // The user is mid-edit here, so the remote payload must not touch the composer.
  typingTabForDirty.text = 'mine';
  typingTabForDirty.state.dirty = true;
  harnessForDirty.drain();
  assert.strictEqual(typingTabForDirty.text, 'mine');

  // The debounced save lands, and both tabs settle on the text that was typed last.
  harnessForDirty.write(typingTabForDirty, 'mine');
  harnessForDirty.drain();
  harnessForDirty.tabs.forEach(function (tabForDirty) {
    assert.strictEqual(tabForDirty.text, 'mine');
  });
});
