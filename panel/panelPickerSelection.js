// Selection rules for the attach picker (notes, chats, clips, tabs).
//
// A row click attaches that one item, as it always has. Ticking a row's checkbox starts a
// selection instead: row clicks then toggle, and the footer's Attach button adds every ticked item
// at once. This file decides how many may be ticked, what a click on a row does, what the footer
// says, and which ticked items are attached when Attach is pressed. panelRuntime.js gathers the
// counts from the composer and performs the answer; it holds no limit logic of its own.
//
// Two limits apply, and the smaller one wins:
//
//   - The composer holds at most `maxChips` chips in total, counting loading and failed ones,
//     because addInputChipForPanelRuntime counts every chip in the row.
//   - A message holds at most MAX_TAB_CHIPS tab chips, counting the ones already on it. A note,
//     chat or clip chip is a reference the model reads only when it needs to, but a tab chip
//     carries the page's text inline, up to 200,000 characters, and all of it is sent with the
//     message and again with later requests in the chat until it is compacted.
//
// The limit is checked twice. Ticking stops at it, so the picker never offers more than fits. The
// composer can still change while the picker is open (a draft from another tab rebuilds the chip
// row), so planCommit recounts when Attach is pressed and attaches the first items ticked that
// still fit.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the content script
// and exports through the CommonJS tail under Node (`module` is undefined in the browser, so that
// branch is inert there).

(function () {
  const globalScopeForPickerSelection = globalThis;
  const nsForPickerSelection = globalScopeForPickerSelection.ABChatContent || {};

  const MAX_TAB_CHIPS_FOR_PICKER_SELECTION = 3;

  function toCountForPickerSelection(valueForCount) {
    const numberForCount = Number(valueForCount);
    if (!Number.isFinite(numberForCount) || numberForCount < 0) return 0;
    return Math.floor(numberForCount);
  }

  function maxTabChipsForPickerSelection(inputForMaxTabs) {
    return toCountForPickerSelection(inputForMaxTabs && inputForMaxTabs.maxTabChips != null
      ? inputForMaxTabs.maxTabChips
      : MAX_TAB_CHIPS_FOR_PICKER_SELECTION);
  }

  // How many more items may be added (and so ticked at once), and which limit sets that number.
  // `limitedBy` is 'slots' when the composer's remaining room is the smaller limit, else 'tabs'.
  // A tie counts as 'slots', the broader of the two, so a message holding 10 chips of which 3
  // are tabs reports the attachment limit.
  function selectionLimitForPickerSelection(inputForLimit) {
    const safeInputForLimit = inputForLimit || {};
    const maxChipsForLimit = toCountForPickerSelection(safeInputForLimit.maxChips);
    const existingForLimit = toCountForPickerSelection(safeInputForLimit.existingChipCount);
    const slotsLeftForLimit = Math.max(0, maxChipsForLimit - existingForLimit);
    if (safeInputForLimit.type !== 'tab') {
      return { limit: slotsLeftForLimit, slotsLeft: slotsLeftForLimit, limitedBy: 'slots' };
    }
    const tabsLeftForLimit = Math.max(0,
      maxTabChipsForPickerSelection(safeInputForLimit) - toCountForPickerSelection(safeInputForLimit.existingTabChipCount));
    const limitedByTabsForLimit = tabsLeftForLimit < slotsLeftForLimit;
    return {
      limit: limitedByTabsForLimit ? tabsLeftForLimit : slotsLeftForLimit,
      slotsLeft: slotsLeftForLimit,
      limitedBy: limitedByTabsForLimit ? 'tabs' : 'slots'
    };
  }

  // Ticks or unticks `key`. Ticking past `limit` is refused and leaves the selection as it was.
  // The result keeps the order items were ticked in, which is the order they are attached in.
  function toggleKeyForPickerSelection(selectedKeysForToggle, keyForToggle, limitForToggle) {
    const keysForToggle = Array.isArray(selectedKeysForToggle) ? selectedKeysForToggle.slice() : [];
    const keyStringForToggle = String(keyForToggle);
    const indexForToggle = keysForToggle.indexOf(keyStringForToggle);
    if (indexForToggle !== -1) {
      keysForToggle.splice(indexForToggle, 1);
      return { keys: keysForToggle, selected: false, refused: false };
    }
    if (keysForToggle.length >= toCountForPickerSelection(limitForToggle)) {
      return { keys: keysForToggle, selected: false, refused: true };
    }
    keysForToggle.push(keyStringForToggle);
    return { keys: keysForToggle, selected: true, refused: false };
  }

  // A row's state: 'attached' (already in the composer), 'blocked' (a tab the extension cannot
  // read), 'selected', 'full' (the selection is at its limit, so this row cannot be ticked), or
  // 'available'.
  function rowStateForPickerSelection(inputForRow) {
    const safeInputForRow = inputForRow || {};
    if (safeInputForRow.attached) return 'attached';
    if (safeInputForRow.blocked) return 'blocked';
    if (safeInputForRow.selected) return 'selected';
    if (toCountForPickerSelection(safeInputForRow.selectedCount) >= toCountForPickerSelection(safeInputForRow.limit)) return 'full';
    return 'available';
  }

  // What a click on the row's body does: 'attach' this one item now, 'toggle' its tick, 'explain'
  // why a blocked tab cannot be attached, or 'none'. With nothing ticked a click attaches, as it
  // did before multi-select existed; once anything is ticked, clicks toggle.
  function rowClickActionForPickerSelection(inputForClick) {
    const safeInputForClick = inputForClick || {};
    const stateForClick = rowStateForPickerSelection(safeInputForClick);
    const selectingForClick = toCountForPickerSelection(safeInputForClick.selectedCount) > 0;
    if (stateForClick === 'attached' || stateForClick === 'full') return 'none';
    if (stateForClick === 'blocked') return selectingForClick ? 'none' : 'explain';
    if (stateForClick === 'selected') return 'toggle';
    return selectingForClick ? 'toggle' : 'attach';
  }

  // The footer's text and which of its buttons show. The footer shows whenever something is
  // ticked, and also when nothing more can be added, so the disabled rows are explained.
  function footerForPickerSelection(inputForFooter) {
    const safeInputForFooter = inputForFooter || {};
    const selectedCountForFooter = toCountForPickerSelection(safeInputForFooter.selectedCount);
    const maxChipsForFooter = toCountForPickerSelection(safeInputForFooter.maxChips);
    const maxTabsForFooter = maxTabChipsForPickerSelection(safeInputForFooter);
    const limitInfoForFooter = selectionLimitForPickerSelection(safeInputForFooter);
    const isTabLimitForFooter = limitInfoForFooter.limitedBy === 'tabs';
    if (selectedCountForFooter === 0) {
      if (limitInfoForFooter.limit === 0) {
        return {
          visible: true,
          canAttach: false,
          canClear: false,
          text: isTabLimitForFooter
            ? 'Tab limit reached (max ' + maxTabsForFooter + '). Remove a tab to add another.'
            : 'Attachment limit reached (max ' + maxChipsForFooter + '). Remove one to add more.'
        };
      }
      return { visible: false, canAttach: false, canClear: false, text: '' };
    }
    let detailForFooter;
    if (selectedCountForFooter < limitInfoForFooter.limit) {
      detailForFooter = 'room for ' + (limitInfoForFooter.limit - selectedCountForFooter) + ' more';
    } else if (isTabLimitForFooter) {
      detailForFooter = 'tab limit reached (max ' + maxTabsForFooter + ')';
    } else {
      detailForFooter = 'attachment limit reached (max ' + maxChipsForFooter + ')';
    }
    return {
      visible: true,
      canAttach: true,
      canClear: true,
      text: selectedCountForFooter + ' selected \u00b7 ' + detailForFooter
    };
  }

  // Which ticked keys to attach when Attach is pressed, recounted against the composer as it is
  // now. Keys already attached by then are dropped as duplicates, and the rest are attached in the
  // order they were ticked until the limit is reached; what is left over is `skipped`.
  function planCommitForPickerSelection(inputForCommit) {
    const safeInputForCommit = inputForCommit || {};
    const keysForCommit = Array.isArray(safeInputForCommit.selectedKeys)
      ? safeInputForCommit.selectedKeys.map(String)
      : [];
    const attachedForCommit = new Set((safeInputForCommit.attachedKeys || []).map(String));
    const freshKeysForCommit = keysForCommit.filter(function (keyForFresh) {
      return !attachedForCommit.has(keyForFresh);
    });
    const limitInfoForCommit = selectionLimitForPickerSelection(safeInputForCommit);
    const attachForCommit = freshKeysForCommit.slice(0, limitInfoForCommit.limit);
    return {
      attach: attachForCommit,
      skipped: freshKeysForCommit.length - attachForCommit.length,
      duplicates: keysForCommit.length - freshKeysForCommit.length,
      limitedBy: limitInfoForCommit.limitedBy
    };
  }

  nsForPickerSelection.pickerSelection = {
    MAX_TAB_CHIPS: MAX_TAB_CHIPS_FOR_PICKER_SELECTION,
    selectionLimit: selectionLimitForPickerSelection,
    toggleKey: toggleKeyForPickerSelection,
    rowState: rowStateForPickerSelection,
    rowClickAction: rowClickActionForPickerSelection,
    footer: footerForPickerSelection,
    planCommit: planCommitForPickerSelection
  };
  globalScopeForPickerSelection.ABChatContent = nsForPickerSelection;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForPickerSelection.pickerSelection;
  }
})();
