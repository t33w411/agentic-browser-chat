// Selection rules for the attach picker (panel/panelPickerSelection.js).
//
// The point of these tests is that the picker never offers, and never attaches, more than fits:
// 10 chips in the composer and 3 tabs on one message, each counting the ones already there.
// Verified against broken versions before being kept: a limit that ignored the chips already in
// the composer (the "existing chips" cases fail there), a commit that used the limit counted when
// the picker opened instead of recounting (the "recounts" cases fail there), and a tab limit
// counted per batch rather than per message (the tab cases with tabs already on the message
// fail there).
// Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const pickerSelectionForTest = require('../panel/panelPickerSelection.js');

const MAX_CHIPS_FOR_TEST = 10;

test('notes, chats and clips are limited only by the room left in the composer', () => {
  for (const typeForCase of ['note', 'chat', 'clip']) {
    assert.deepStrictEqual(
      pickerSelectionForTest.selectionLimit({ type: typeForCase, existingChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST }),
      { limit: 10, slotsLeft: 10, limitedBy: 'slots' }
    );
  }
});

test('existing chips reduce the limit', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'note', existingChipCount: 7, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 3, slotsLeft: 3, limitedBy: 'slots' }
  );
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'note', existingChipCount: 10, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 0, slotsLeft: 0, limitedBy: 'slots' }
  );
  // A count past the cap (a draft from before the cap, say) is a full composer, not a negative limit.
  assert.strictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'note', existingChipCount: 12, maxChips: MAX_CHIPS_FOR_TEST }).limit,
    0
  );
});

test('a message holds at most 3 tabs, counting the tabs already on it', () => {
  assert.strictEqual(pickerSelectionForTest.MAX_TAB_CHIPS, 3);
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 0, existingTabChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 3, slotsLeft: 10, limitedBy: 'tabs' }
  );
  // One tab and three notes already on the message: two more tabs, though six chips would fit.
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 4, existingTabChipCount: 1, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 2, slotsLeft: 6, limitedBy: 'tabs' }
  );
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 3, existingTabChipCount: 3, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 0, slotsLeft: 7, limitedBy: 'tabs' }
  );
  // A draft saved with more tabs than the limit keeps them, and allows no more.
  assert.strictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 5, existingTabChipCount: 5, maxChips: MAX_CHIPS_FOR_TEST }).limit,
    0
  );
});

test('the room left in the composer still wins when it is smaller than the tab limit', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 9, existingTabChipCount: 1, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 1, slotsLeft: 1, limitedBy: 'slots' }
  );
  // A tie reports the attachment limit, the broader of the two.
  assert.strictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 8, existingTabChipCount: 1, maxChips: MAX_CHIPS_FOR_TEST }).limitedBy,
    'slots'
  );
  assert.strictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'tab', existingChipCount: 10, existingTabChipCount: 3, maxChips: MAX_CHIPS_FOR_TEST }).limitedBy,
    'slots'
  );
});

test('tabs already on the message do not limit notes, chats or clips', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.selectionLimit({ type: 'note', existingChipCount: 5, existingTabChipCount: 5, maxChips: MAX_CHIPS_FOR_TEST }),
    { limit: 5, slotsLeft: 5, limitedBy: 'slots' }
  );
});

test('ticking stops at the limit and keeps the order items were ticked in', () => {
  let resultForToggle = pickerSelectionForTest.toggleKey([], 7, 2);
  assert.deepStrictEqual(resultForToggle, { keys: ['7'], selected: true, refused: false });
  resultForToggle = pickerSelectionForTest.toggleKey(resultForToggle.keys, '3', 2);
  assert.deepStrictEqual(resultForToggle.keys, ['7', '3']);
  const refusedForToggle = pickerSelectionForTest.toggleKey(resultForToggle.keys, '9', 2);
  assert.deepStrictEqual(refusedForToggle, { keys: ['7', '3'], selected: false, refused: true });
  // Unticking is always allowed, even at the limit, and frees a place.
  const untickedForToggle = pickerSelectionForTest.toggleKey(resultForToggle.keys, '7', 2);
  assert.deepStrictEqual(untickedForToggle, { keys: ['3'], selected: false, refused: false });
  assert.deepStrictEqual(pickerSelectionForTest.toggleKey(untickedForToggle.keys, '9', 2).keys, ['3', '9']);
});

test('toggleKey does not change the array it is given', () => {
  const keysForImmutable = ['1'];
  pickerSelectionForTest.toggleKey(keysForImmutable, '2', 5);
  pickerSelectionForTest.toggleKey(keysForImmutable, '1', 5);
  assert.deepStrictEqual(keysForImmutable, ['1']);
});

test('with a full composer nothing can be ticked or attached by a click', () => {
  const limitForFull = pickerSelectionForTest.selectionLimit({ type: 'note', existingChipCount: 10, maxChips: MAX_CHIPS_FOR_TEST }).limit;
  assert.strictEqual(pickerSelectionForTest.toggleKey([], '1', limitForFull).refused, true);
  assert.strictEqual(pickerSelectionForTest.rowState({ selectedCount: 0, limit: limitForFull }), 'full');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selectedCount: 0, limit: limitForFull }), 'none');
});

test('a row click attaches one item until something is ticked, then toggles', () => {
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selectedCount: 0, limit: 10 }), 'attach');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selectedCount: 1, limit: 10 }), 'toggle');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selected: true, selectedCount: 1, limit: 10 }), 'toggle');
  // At the limit, a ticked row can still be unticked and an unticked one does nothing.
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selected: true, selectedCount: 3, limit: 3 }), 'toggle');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ selectedCount: 3, limit: 3 }), 'none');
});

test('attached and blocked rows are never ticked', () => {
  assert.strictEqual(pickerSelectionForTest.rowState({ attached: true, selectedCount: 0, limit: 10 }), 'attached');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ attached: true, selectedCount: 0, limit: 10 }), 'none');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ attached: true, selectedCount: 2, limit: 10 }), 'none');
  // A blocked tab keeps its old single-click explanation, and is ignored during a selection.
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ blocked: true, selectedCount: 0, limit: 5 }), 'explain');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ blocked: true, selectedCount: 0, limit: 0 }), 'explain');
  assert.strictEqual(pickerSelectionForTest.rowClickAction({ blocked: true, selectedCount: 2, limit: 5 }), 'none');
});

test('the footer is hidden with nothing ticked, unless the composer is full', () => {
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'note', selectedCount: 0, existingChipCount: 4, maxChips: MAX_CHIPS_FOR_TEST }).visible,
    false
  );
  const fullForFooter = pickerSelectionForTest.footer({ type: 'note', selectedCount: 0, existingChipCount: 10, maxChips: MAX_CHIPS_FOR_TEST });
  assert.strictEqual(fullForFooter.visible, true);
  assert.strictEqual(fullForFooter.canAttach, false);
  assert.match(fullForFooter.text, /^Attachment limit reached \(max 10\)/);
});

test('the footer says how much room is left and which limit stopped the selection', () => {
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'note', selectedCount: 2, existingChipCount: 4, maxChips: MAX_CHIPS_FOR_TEST }).text,
    '2 selected · room for 4 more'
  );
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'note', selectedCount: 6, existingChipCount: 4, maxChips: MAX_CHIPS_FOR_TEST }).text,
    '6 selected · attachment limit reached (max 10)'
  );
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'tab', selectedCount: 3, existingChipCount: 0, existingTabChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST }).text,
    '3 selected · tab limit reached (max 3)'
  );
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'tab', selectedCount: 1, existingChipCount: 0, existingTabChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST }).text,
    '1 selected · room for 2 more'
  );
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'tab', selectedCount: 1, existingChipCount: 2, existingTabChipCount: 2, maxChips: MAX_CHIPS_FOR_TEST }).text,
    '1 selected · tab limit reached (max 3)'
  );
  const tickedForFooter = pickerSelectionForTest.footer({ type: 'chat', selectedCount: 1, existingChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST });
  assert.strictEqual(tickedForFooter.canAttach, true);
  assert.strictEqual(tickedForFooter.canClear, true);
});

test('with 3 tabs on the message the tab picker says why nothing can be ticked', () => {
  const fullForTabs = pickerSelectionForTest.footer({ type: 'tab', selectedCount: 0, existingChipCount: 4, existingTabChipCount: 3, maxChips: MAX_CHIPS_FOR_TEST });
  assert.deepStrictEqual(fullForTabs, {
    visible: true,
    canAttach: false,
    canClear: false,
    text: 'Tab limit reached (max 3). Remove a tab to add another.'
  });
  assert.strictEqual(
    pickerSelectionForTest.footer({ type: 'tab', selectedCount: 0, existingChipCount: 2, existingTabChipCount: 2, maxChips: MAX_CHIPS_FOR_TEST }).visible,
    false
  );
});

test('Attach attaches everything ticked when it all still fits', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'note', selectedKeys: ['4', '2', '9'], existingChipCount: 3, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: ['4', '2', '9'], skipped: 0, duplicates: 0, limitedBy: 'slots' }
  );
});

test('Attach recounts the composer and attaches the first items ticked that still fit', () => {
  // Three were ticked with room for three; another tab's draft then added two chips.
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'note', selectedKeys: ['4', '2', '9'], existingChipCount: 9, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: ['4'], skipped: 2, duplicates: 0, limitedBy: 'slots' }
  );
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'note', selectedKeys: ['4', '2'], existingChipCount: 10, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: [], skipped: 2, duplicates: 0, limitedBy: 'slots' }
  );
});

test('Attach never takes a message past 3 tabs', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'tab', selectedKeys: ['1', '2', '3', '4'], existingChipCount: 0, existingTabChipCount: 0, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: ['1', '2', '3'], skipped: 1, duplicates: 0, limitedBy: 'tabs' }
  );
  // Two were ticked with one tab on the message; another tab's draft then added one more.
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'tab', selectedKeys: ['7', '8'], existingChipCount: 2, existingTabChipCount: 2, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: ['7'], skipped: 1, duplicates: 0, limitedBy: 'tabs' }
  );
});

test('Attach drops items that became attached while the picker was open', () => {
  assert.deepStrictEqual(
    pickerSelectionForTest.planCommit({ type: 'note', selectedKeys: ['4', '2', '9'], attachedKeys: [2], existingChipCount: 8, maxChips: MAX_CHIPS_FOR_TEST }),
    { attach: ['4', '9'], skipped: 0, duplicates: 1, limitedBy: 'slots' }
  );
});
