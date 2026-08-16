// Pure decision layer for the cross-tab chat input draft mirror.
//
// Every tab with a mounted panel is a writer on the same per-chat storage key, so two tabs can
// hold different text for the same composer at the same time. This file owns the single question
// that resolves it: given what this tab currently shows and a payload that just landed in
// storage, does the tab adopt it, publish its own instead, or do nothing?
//
// Nothing here touches the DOM or chrome.*, and nothing here is allowed to. Keeping the rules a
// pure function of (receiver state, incoming payload) is what lets them be exercised against
// reordered and delayed deliveries in a test, which is impossible to stage by hand against real
// tabs. panelRuntime.js supplies the state, performs the resulting action, and owns every side
// effect.
//
// Loaded twice over: as a content script it attaches to ABChatContent.draftSync, and under Node
// it exports the same object through the CommonJS tail at the bottom (`module` is undefined in a
// content script, so that branch is inert there).

(function () {
  const globalScopeForDraftSync = globalThis;
  const nsForDraftSync = globalScopeForDraftSync.ABChatContent || {};

  // Kept in step with the copies in panelRuntime.js and panelDataRepoImpl.js, which cannot import
  // from here: the repo runs in the service worker, where this file is not loaded.
  const LEGACY_STORAGE_KEY_FOR_DRAFT_SYNC = 'abchat_input_draft';
  const STORAGE_KEY_PREFIX_FOR_DRAFT_SYNC = 'abchat_input_draft_sync:';
  // The composer before any chat exists. Shared by every tab that has no active chat, so it is
  // the scope most likely to have several writers at once.
  const NEW_CHAT_SCOPE_FOR_DRAFT_SYNC = 'new';

  function getStorageKeyForScopeForDraftSync(scopeForKey) {
    return STORAGE_KEY_PREFIX_FOR_DRAFT_SYNC + String(scopeForKey);
  }

  function getScopeFromStorageKeyForDraftSync(keyForScope) {
    if (typeof keyForScope !== 'string') return null;
    if (keyForScope.indexOf(STORAGE_KEY_PREFIX_FOR_DRAFT_SYNC) !== 0) return null;
    const scopeForKey = keyForScope.slice(STORAGE_KEY_PREFIX_FOR_DRAFT_SYNC.length);
    if (scopeForKey === NEW_CHAT_SCOPE_FOR_DRAFT_SYNC) return scopeForKey;
    const numericScopeForKey = Number(scopeForKey);
    return scopeForKey && Number.isFinite(numericScopeForKey) && numericScopeForKey > 0
      ? String(numericScopeForKey)
      : null;
  }

  // Keeps every field a chip carries, including ones added later: the draft has to round-trip
  // whatever addInputChip wrote, and an allow-list here would silently drop a new field.
  function normalizeDraftForDraftSync(draftForNormalize) {
    const draftForInput = draftForNormalize && typeof draftForNormalize === 'object' ? draftForNormalize : {};
    return {
      text: String(draftForInput.text || ''),
      chips: Array.isArray(draftForInput.chips)
        ? draftForInput.chips.filter(function (chipForNormalize) {
            return chipForNormalize && typeof chipForNormalize === 'object';
          }).map(function (chipForNormalize) {
            return Object.assign({}, chipForNormalize);
          })
        : []
    };
  }

  // Key order differs between a chip read back from the DOM and the same chip parsed out of JSON,
  // so keys are sorted before serializing. Callers compare these strings to decide whether an
  // incoming payload is identical to what is already on screen.
  function canonicalizeChipForDraftSync(chipForCanonical) {
    const canonicalForChip = {};
    Object.keys(chipForCanonical).sort().forEach(function (keyForChip) {
      canonicalForChip[keyForChip] = chipForCanonical[keyForChip];
    });
    return canonicalForChip;
  }

  function serializeDraftForDraftSync(draftForSerialize) {
    const normalizedForSerialize = normalizeDraftForDraftSync(draftForSerialize);
    return JSON.stringify({
      text: normalizedForSerialize.text,
      chips: normalizedForSerialize.chips.map(canonicalizeChipForDraftSync)
    });
  }

  // Total order over payloads. Wall-clock first (every tab shares one machine clock), then the
  // version string, which embeds sourceId:revision:updatedAt and so breaks ties the same way in
  // every tab. Without a deterministic tie-break two tabs stamped in the same millisecond would
  // each decide the other was stale and trade writes forever.
  function comparePayloadsForDraftSync(leftForCompare, rightForCompare) {
    const leftUpdatedAtForCompare = Number(leftForCompare && leftForCompare.updatedAt) || 0;
    const rightUpdatedAtForCompare = Number(rightForCompare && rightForCompare.updatedAt) || 0;
    if (leftUpdatedAtForCompare !== rightUpdatedAtForCompare) {
      return leftUpdatedAtForCompare > rightUpdatedAtForCompare ? 1 : -1;
    }
    const leftVersionForCompare = String((leftForCompare && leftForCompare.version) || '');
    const rightVersionForCompare = String((rightForCompare && rightForCompare.version) || '');
    if (leftVersionForCompare === rightVersionForCompare) return 0;
    return leftVersionForCompare > rightVersionForCompare ? 1 : -1;
  }

  function decisionForDraftSync(actionForDecision, reasonForDecision) {
    return { action: actionForDecision, reason: reasonForDecision };
  }

  // The one rule. `state` describes the receiving tab:
  //   mountedScope   scope the composer is currently bound to, or null before it mounts
  //   baseUpdatedAt  updatedAt of the payload the composer currently reflects
  //   baseVersion    version of that same payload
  //   dirty          the user has edited since the last landed write or apply
  //   chipLoading    an attachment is still uploading or parsing
  //   sendLocked     a submit for this scope is mid-flight
  //   selfSourceId   this tab's draft source id
  //
  // Returns one of:
  //   ignore        do nothing
  //   apply         paint `incoming` into the composer and adopt its version/updatedAt
  //   apply-empty   clear the composer (the record was deleted, chat gone)
  //   reassert      write this tab's current composer content, stamped now
  //
  // `reassert` republishes what this tab is showing, which is the newest content it knows of.
  // That is not the same as republishing an incoming payload the tab did NOT adopt: doing that
  // re-stamps old text as newest and defeats the ordering for every tab, so no branch below may
  // write `incoming` back out.
  function decideIncomingDraftActionForDraftSync(stateForDecide, scopeForDecide, incomingForDecide) {
    const receiverForDecide = stateForDecide || {};
    const mountedScopeForDecide = receiverForDecide.mountedScope == null
      ? null
      : String(receiverForDecide.mountedScope);
    if (mountedScopeForDecide === null) return decisionForDraftSync('ignore', 'unmounted');
    if (scopeForDecide == null || String(scopeForDecide) !== mountedScopeForDecide) {
      return decisionForDraftSync('ignore', 'scope-mismatch');
    }
    if (
      incomingForDecide
      && receiverForDecide.selfSourceId
      && incomingForDecide.sourceId === receiverForDecide.selfSourceId
    ) {
      return decisionForDraftSync('ignore', 'self-echo');
    }
    // The submit path owns the composer until it finishes; it re-reads storage when it releases.
    if (receiverForDecide.sendLocked) return decisionForDraftSync('ignore', 'send-locked');
    // A chip mid-upload is deliberately absent from every stored draft, so applying any payload
    // now would delete it from the row. Convergence comes from the save this tab performs when
    // the chip settles, which republishes and wins the next round.
    if (receiverForDecide.chipLoading) return decisionForDraftSync('ignore', 'chip-loading');

    // The record was removed, which only happens when the chat itself was deleted. Never
    // reassert here: that would recreate a draft for a chat that no longer exists.
    if (!incomingForDecide) return decisionForDraftSync('apply-empty', 'removed');

    const baseForDecide = {
      updatedAt: Number(receiverForDecide.baseUpdatedAt) || 0,
      version: String(receiverForDecide.baseVersion || '')
    };

    if (incomingForDecide.cleared) {
      // A clear states exactly how far it clears. Text this tab holds that postdates the
      // submitted snapshot was never part of the submitted message and must survive.
      if (receiverForDecide.dirty) return decisionForDraftSync('reassert', 'cleared-local-dirty');
      const clearedThroughForDecide = Number(incomingForDecide.clearedThroughUpdatedAt) || 0;
      if (baseForDecide.updatedAt > clearedThroughForDecide) {
        return decisionForDraftSync('reassert', 'cleared-local-newer');
      }
      return decisionForDraftSync('apply', 'cleared');
    }

    // Unsaved local edits always outrank a remote payload. The tab converges instead when its
    // own write lands and it re-reads storage, so nothing needs to be queued here.
    if (receiverForDecide.dirty) return decisionForDraftSync('ignore', 'local-dirty');

    const orderForDecide = comparePayloadsForDraftSync(incomingForDecide, baseForDecide);
    if (orderForDecide > 0) return decisionForDraftSync('apply', 'newer');
    if (orderForDecide < 0) return decisionForDraftSync('reassert', 'local-newer');
    return decisionForDraftSync('ignore', 'same');
  }

  // Asked after a submit, once the pending writes for the scope have drained: is what sits in
  // storage still the draft we just sent, or did another tab write something newer while the
  // send was in flight?
  function decideSubmittedClearActionForDraftSync(submittedForClear, storedForClear) {
    if (!storedForClear) return decisionForDraftSync('clear', 'no-stored-draft');
    const submittedVersionForClear = String((submittedForClear && submittedForClear.version) || '');
    const storedVersionForClear = String(storedForClear.version || '');
    if (submittedVersionForClear && storedVersionForClear === submittedVersionForClear) {
      return decisionForDraftSync('clear', 'stored-matches-submitted');
    }
    const submittedUpdatedAtForClear = Number((submittedForClear && submittedForClear.updatedAt)) || 0;
    const storedUpdatedAtForClear = Number(storedForClear.updatedAt) || 0;
    // Not-older rather than strictly-newer: a write stamped in the same millisecond as the
    // submitted snapshot still came from somewhere else and is not the message we just sent.
    if (storedUpdatedAtForClear >= submittedUpdatedAtForClear) {
      return decisionForDraftSync('adopt', 'stored-newer-than-submitted');
    }
    return decisionForDraftSync('clear', 'stored-older-than-submitted');
  }

  nsForDraftSync.draftSync = {
    LEGACY_STORAGE_KEY: LEGACY_STORAGE_KEY_FOR_DRAFT_SYNC,
    STORAGE_KEY_PREFIX: STORAGE_KEY_PREFIX_FOR_DRAFT_SYNC,
    NEW_CHAT_SCOPE: NEW_CHAT_SCOPE_FOR_DRAFT_SYNC,
    getStorageKeyForScope: getStorageKeyForScopeForDraftSync,
    getScopeFromStorageKey: getScopeFromStorageKeyForDraftSync,
    normalizeDraft: normalizeDraftForDraftSync,
    serializeDraft: serializeDraftForDraftSync,
    comparePayloads: comparePayloadsForDraftSync,
    decideIncomingDraftAction: decideIncomingDraftActionForDraftSync,
    decideSubmittedClearAction: decideSubmittedClearActionForDraftSync
  };
  globalScopeForDraftSync.ABChatContent = nsForDraftSync;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForDraftSync.draftSync;
  }
})();
