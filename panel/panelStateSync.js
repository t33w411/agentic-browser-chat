// Mirrors durable panel UI state across tabs via chrome.storage.local.
//
// Each mirrored field has its own storage key and metadata record. This avoids
// stale whole-object read/merge/write races where one tab can accidentally
// restore an older value for a field it did not intend to change.
//
// Mirrored fields:
//   isOpen, mode, tab, activeChatId, activeNoteId,
//   popoutNoteIds,       (array of note IDs currently popped out)
//   popoutPositions,     ({ [noteId]: { left, top } }, drag-end only)
//   panelAnchor,         ({ ax: 'left'|'right', ay: 'top'|'bottom',
//                          ox: int, oy: int }; drag-end; reduced-mode only.
//                          Edge-anchored: the receiving tab resolves to
//                          pixels against ITS viewport, so a panel docked
//                          near the bottom-right on one viewport lands
//                          near the bottom-right on another, instead of
//                          drifting because of raw-pixel mismatch.)
//   paneChats, paneNotes, paneTasks, paneQuestions
//                        ('list' | 'detail'; which pane is visible per main
//                          tab in reduced view. Tracks user navigation intent
//                          so re-entering a tab restores its last-visible
//                          pane. setMode does NOT write these; only
//                          open/back/new/delete do.)
//   chatSubTab           ('chats' | 'quickq'; sub-tab inside Chats)
//   taskFilter           ('all' | 'pending' | 'completed')
//   quizFilter           ('all' | 'due' | 'paused')
//
// NOT mirrored here:
//   - picker and attachment preview modals: per-tab interaction state.
//   - scroll positions: too noisy and prone to cross-tab scroll fighting.
//   - collapsed sidebars: per-tab layout preference.
//   - chat input draft text + chips: already mirrored by panelRuntime.js via
//     INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME (do not duplicate).
//   - inline quick-question overlay: per-tab by design.
//   - note editor body draft: notes auto-save to DB; cross-tab refresh
//     already covers this.
//
// Re-injection safety: follows the listener-generation guard pattern and the
// shared ABChatContent IIFE namespace pattern used throughout the panel.

(function () {
  const globalScopeForPanelStateSync = globalThis;
  const contentNamespaceForPanelStateSync = globalScopeForPanelStateSync.ABChatContent || {};
  contentNamespaceForPanelStateSync.ui = contentNamespaceForPanelStateSync.ui || {};

  // When true, `isOpen` changes from other tabs are only applied while this
  // tab is in the foreground. Hidden tabs stash the latest desired value and
  // apply it on the next `visibilitychange` to visible. All other mirrored
  // fields (mode, tab, active ids, popouts, panel position) keep syncing
  // immediately so a deferred open lands in the right shape.
  // Flip to false to restore the original "every tab opens together" mode.
  const VISIBLE_TAB_ONLY_ISOPEN_FOR_PANEL_STATE_SYNC = true;

  const LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC = "abchat_panel_ui_state";
  const PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_STATE_SYNC = "abchat_panel_ui_state_field_";
  const WRITE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC = 50;
  const PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC = [
    "isOpen",
    "mode",
    "tab",
    "activeChatId",
    "activeNoteId",
    "popoutNoteIds",
    "popoutPositions",
    "panelAnchor",
    "paneChats",
    "paneNotes",
    "paneTasks",
    "paneQuestions",
    "chatSubTab",
    "taskFilter",
    "quizFilter"
  ];

  let applyingFromRemoteForPanelStateSync = false;
  let writeTimerForPanelStateSync = null;
  let pendingWriteForPanelStateSync = {};
  let storageListenerForPanelStateSync = null;
  let initializedForPanelStateSync = false;
  let pendingIsOpenForPanelStateSync = null; // null = nothing pending; otherwise boolean
  let hasPendingIsOpenForPanelStateSync = false;
  let visibilityListenerForPanelStateSync = null;
  let windowFocusListenerForPanelStateSync = null;
  // Background-pushed "is this the currently active tab" cache. `null` means
  // the SW has not yet answered (initial boot); we fall back to
  // document.hasFocus() in that window. Once the SW pushes a value, we trust
  // it: focus leaving the browser entirely (another app) leaves the cache
  // unchanged, so the last-known active tab keeps applying isOpen updates.
  let isThisTabActiveCachedForPanelStateSync = null;
  let activeTabPushListenerForPanelStateSync = null;
  const fieldSetForPanelStateSync = new Set(PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC);

  const capturedGenerationForPanelStateSync = window.abchatListenerGeneration || 0;

  function getSourceIdForPanelStateSync() {
    const globalKeyForSourceId = "__abchatPanelStateSyncSourceId";
    if (globalScopeForPanelStateSync[globalKeyForSourceId]) {
      return globalScopeForPanelStateSync[globalKeyForSourceId];
    }
    let sourceIdForPanelStateSync = "";
    try {
      sourceIdForPanelStateSync = sessionStorage.getItem("abchat_panel_state_sync_source_id") || "";
    } catch (errorForPanelStateSync) {
      sourceIdForPanelStateSync = "";
    }
    if (!sourceIdForPanelStateSync) {
      sourceIdForPanelStateSync = "src_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
      try {
        sessionStorage.setItem("abchat_panel_state_sync_source_id", sourceIdForPanelStateSync);
      } catch (errorForPanelStateSync) {}
    }
    globalScopeForPanelStateSync[globalKeyForSourceId] = sourceIdForPanelStateSync;
    return sourceIdForPanelStateSync;
  }

  const sourceIdForPanelStateSync = getSourceIdForPanelStateSync();

  function getFieldKeyForPanelStateSync(fieldNameForPanelStateSync) {
    return PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_STATE_SYNC + fieldNameForPanelStateSync;
  }

  function getFieldNameFromStorageKeyForPanelStateSync(keyForPanelStateSync) {
    if (typeof keyForPanelStateSync !== "string") return "";
    if (keyForPanelStateSync.indexOf(PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_STATE_SYNC) !== 0) return "";
    const fieldNameForPanelStateSync = keyForPanelStateSync.slice(PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_STATE_SYNC.length);
    return fieldSetForPanelStateSync.has(fieldNameForPanelStateSync) ? fieldNameForPanelStateSync : "";
  }

  function isSupportedFieldForPanelStateSync(fieldNameForPanelStateSync) {
    return fieldSetForPanelStateSync.has(fieldNameForPanelStateSync);
  }

  function isFieldRecordForPanelStateSync(valueForPanelStateSync) {
    return Boolean(
      valueForPanelStateSync &&
      typeof valueForPanelStateSync === "object" &&
      Object.prototype.hasOwnProperty.call(valueForPanelStateSync, "value") &&
      typeof valueForPanelStateSync.updatedAt === "number" &&
      typeof valueForPanelStateSync.sourceId === "string"
    );
  }

  function isStaleForPanelStateSync() {
    if ((window.abchatListenerGeneration || 0) !== capturedGenerationForPanelStateSync) {
      return true;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) return true;
    } catch (errorForPanelStateSync) {
      return true;
    }
    return false;
  }

  function readStoredStateForPanelStateSync(callbackForPanelStateSync) {
    try {
      const keysForPanelStateSync = PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC
        .map(getFieldKeyForPanelStateSync)
        .concat([LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC]);
      chrome.storage.local.get(keysForPanelStateSync, function (resForPanelStateSync) {
        const valueForPanelStateSync = {};
        const legacyForPanelStateSync =
          (resForPanelStateSync && resForPanelStateSync[LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC]) || {};
        if (legacyForPanelStateSync && typeof legacyForPanelStateSync === "object") {
          PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC.forEach(function (fieldNameForLegacy) {
            if (Object.prototype.hasOwnProperty.call(legacyForPanelStateSync, fieldNameForLegacy)) {
              valueForPanelStateSync[fieldNameForLegacy] = legacyForPanelStateSync[fieldNameForLegacy];
            }
          });
        }
        PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC.forEach(function (fieldNameForRead) {
          const recordForRead = resForPanelStateSync && resForPanelStateSync[getFieldKeyForPanelStateSync(fieldNameForRead)];
          if (isFieldRecordForPanelStateSync(recordForRead)) {
            valueForPanelStateSync[fieldNameForRead] = recordForRead.value;
          }
        });
        try {
          callbackForPanelStateSync(valueForPanelStateSync);
        } catch (errorForPanelStateSync) {}
      });
    } catch (errorForPanelStateSync) {
      try { callbackForPanelStateSync({}); } catch (innerErrorForPanelStateSync) {}
    }
  }

  function valuesEqualForPanelStateSync(aForCompare, bForCompare) {
    if (aForCompare === bForCompare) return true;
    if (Array.isArray(aForCompare) && Array.isArray(bForCompare)) {
      if (aForCompare.length !== bForCompare.length) return false;
      const sortedAForCompare = aForCompare.slice().sort();
      const sortedBForCompare = bForCompare.slice().sort();
      for (let iForCompare = 0; iForCompare < sortedAForCompare.length; iForCompare++) {
        if (sortedAForCompare[iForCompare] !== sortedBForCompare[iForCompare]) return false;
      }
      return true;
    }
    if (
      aForCompare && bForCompare &&
      typeof aForCompare === "object" && typeof bForCompare === "object" &&
      !Array.isArray(aForCompare) && !Array.isArray(bForCompare)
    ) {
      const keysAForCompare = Object.keys(aForCompare);
      const keysBForCompare = Object.keys(bForCompare);
      if (keysAForCompare.length !== keysBForCompare.length) return false;
      for (let iForCompare = 0; iForCompare < keysAForCompare.length; iForCompare++) {
        const keyForCompare = keysAForCompare[iForCompare];
        const subAForCompare = aForCompare[keyForCompare];
        const subBForCompare = bForCompare[keyForCompare];
        if (subAForCompare === subBForCompare) continue;
        if (
          subAForCompare && subBForCompare &&
          typeof subAForCompare === "object" && typeof subBForCompare === "object" &&
          subAForCompare.left === subBForCompare.left &&
          subAForCompare.top === subBForCompare.top
        ) continue;
        return false;
      }
      return true;
    }
    return false;
  }

  function flushPendingWriteForPanelStateSync() {
    writeTimerForPanelStateSync = null;
    const updatesForPanelStateSync = pendingWriteForPanelStateSync;
    pendingWriteForPanelStateSync = {};
    if (!updatesForPanelStateSync || Object.keys(updatesForPanelStateSync).length === 0) {
      return;
    }
    if (applyingFromRemoteForPanelStateSync) return;
    try {
      const storageUpdatesForPanelStateSync = {};
      const nowForPanelStateSync = Date.now();
      Object.keys(updatesForPanelStateSync).forEach(function (keyForPanelStateSync, indexForPanelStateSync) {
        if (!isSupportedFieldForPanelStateSync(keyForPanelStateSync)) return;
        storageUpdatesForPanelStateSync[getFieldKeyForPanelStateSync(keyForPanelStateSync)] = {
          value: updatesForPanelStateSync[keyForPanelStateSync],
          updatedAt: nowForPanelStateSync + indexForPanelStateSync,
          sourceId: sourceIdForPanelStateSync
        };
      });
      if (Object.keys(storageUpdatesForPanelStateSync).length === 0) return;
      try {
        chrome.storage.local.set(storageUpdatesForPanelStateSync);
      } catch (errorForPanelStateSync) {}
    } catch (errorForPanelStateSync) {}
  }

  function writeStateForPanelStateSync(partialForPanelStateSync) {
    if (applyingFromRemoteForPanelStateSync) return;
    if (!partialForPanelStateSync || typeof partialForPanelStateSync !== "object") return;
    if (Object.prototype.hasOwnProperty.call(partialForPanelStateSync, "isOpen") &&
        typeof partialForPanelStateSync.isOpen === "boolean") {
      try {
        const actionsForVisibilityNotify =
          globalScopeForPanelStateSync.ABChatShared &&
          globalScopeForPanelStateSync.ABChatShared.actions
            ? globalScopeForPanelStateSync.ABChatShared.actions
            : {};
        chrome.runtime.sendMessage({
          action: actionsForVisibilityNotify.panelVisibilityChanged || "panelVisibilityChanged",
          isOpen: partialForPanelStateSync.isOpen
        }, function () {
          void chrome.runtime.lastError;
        });
      } catch (errorForVisibilityNotify) {}
    }
    let hasSupportedFieldForWrite = false;
    Object.keys(partialForPanelStateSync).forEach(function (fieldNameForWrite) {
      if (!isSupportedFieldForPanelStateSync(fieldNameForWrite)) return;
      pendingWriteForPanelStateSync[fieldNameForWrite] = partialForPanelStateSync[fieldNameForWrite];
      hasSupportedFieldForWrite = true;
    });
    if (!hasSupportedFieldForWrite) return;
    if (writeTimerForPanelStateSync) clearTimeout(writeTimerForPanelStateSync);
    writeTimerForPanelStateSync = setTimeout(flushPendingWriteForPanelStateSync, WRITE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC);
  }

  function getPanelUiNamespaceForPanelStateSync() {
    return contentNamespaceForPanelStateSync.ui && contentNamespaceForPanelStateSync.ui.panel
      ? contentNamespaceForPanelStateSync.ui.panel
      : null;
  }

  function getPanelRuntimeNamespaceForPanelStateSync() {
    return contentNamespaceForPanelStateSync.ui && contentNamespaceForPanelStateSync.ui.panelRuntime
      ? contentNamespaceForPanelStateSync.ui.panelRuntime
      : null;
  }

  // fieldsToApply === null means "apply all present fields" (used by the
  // initial-load apply and the auto-open path, where we genuinely want to
  // adopt every stored field).
  function shouldApplyFieldForPanelStateSync(fieldNameForCheck, fieldsToApplyForCheck) {
    if (fieldsToApplyForCheck !== null && !fieldsToApplyForCheck.has(fieldNameForCheck)) {
      return false;
    }
    return true;
  }

  function applyStateForPanelStateSync(stateForPanelStateSync, fieldsToApplyForPanelStateSync) {
    if (!stateForPanelStateSync || typeof stateForPanelStateSync !== "object") return;
    const fieldsForApply = fieldsToApplyForPanelStateSync || null;
    function hasField(nameForHas) {
      return isSupportedFieldForPanelStateSync(nameForHas) &&
             shouldApplyFieldForPanelStateSync(nameForHas, fieldsForApply) &&
             Object.prototype.hasOwnProperty.call(stateForPanelStateSync, nameForHas);
    }
    applyingFromRemoteForPanelStateSync = true;
    try {
      const panelUiForPanelStateSync = getPanelUiNamespaceForPanelStateSync();
      const runtimeForPanelStateSync = getPanelRuntimeNamespaceForPanelStateSync();

      // 1. Visibility (toggle the shadow host)
      if (hasField("isOpen") && typeof stateForPanelStateSync.isOpen === "boolean" && panelUiForPanelStateSync) {
        const isCurrentlyVisibleForPanelStateSync =
          typeof panelUiForPanelStateSync.isVisible === "function"
            ? Boolean(panelUiForPanelStateSync.isVisible())
            : false;
        if (stateForPanelStateSync.isOpen !== isCurrentlyVisibleForPanelStateSync) {
          if (stateForPanelStateSync.isOpen) {
            if (typeof panelUiForPanelStateSync.ensureReady === "function") {
              panelUiForPanelStateSync.ensureReady();
            }
            if (typeof panelUiForPanelStateSync.setVisible === "function") {
              panelUiForPanelStateSync.setVisible(true);
            }
          } else if (typeof panelUiForPanelStateSync.setVisible === "function") {
            panelUiForPanelStateSync.setVisible(false);
          }
        }
      }

      if (!runtimeForPanelStateSync) return;

      // 1b. Panel mode (expanded / reduced)
      if (hasField("mode") &&
        typeof stateForPanelStateSync.mode === "string" &&
        typeof runtimeForPanelStateSync.setPanelMode === "function"
      ) {
        runtimeForPanelStateSync.setPanelMode(stateForPanelStateSync.mode);
      }

      // 2. Top-level tab
      if (hasField("tab") &&
        typeof stateForPanelStateSync.tab === "string" &&
        typeof runtimeForPanelStateSync.setTab === "function"
      ) {
        runtimeForPanelStateSync.setTab(stateForPanelStateSync.tab);
      }

      // 4. Active chat
      if (hasField("activeChatId") &&
        typeof runtimeForPanelStateSync.setActiveChat === "function"
      ) {
        runtimeForPanelStateSync.setActiveChat(stateForPanelStateSync.activeChatId);
      }

      // 5. Active note
      if (hasField("activeNoteId") &&
        typeof runtimeForPanelStateSync.setActiveNote === "function"
      ) {
        runtimeForPanelStateSync.setActiveNote(stateForPanelStateSync.activeNoteId);
      }

      // 8a. Pop-out positions FIRST.
      if (hasField("popoutPositions") &&
        stateForPanelStateSync.popoutPositions &&
        typeof stateForPanelStateSync.popoutPositions === "object" &&
        typeof runtimeForPanelStateSync.setPopoutPositions === "function"
      ) {
        runtimeForPanelStateSync.setPopoutPositions(stateForPanelStateSync.popoutPositions);
      }

      // 8b. Note pop-outs — reconcile open set with stored set.
      if (hasField("popoutNoteIds") &&
        Array.isArray(stateForPanelStateSync.popoutNoteIds) &&
        typeof runtimeForPanelStateSync.setOpenPopouts === "function"
      ) {
        runtimeForPanelStateSync.setOpenPopouts(stateForPanelStateSync.popoutNoteIds);
      }

      // 8c. Panel position (edge-anchored). The receiving tab resolves
      // {ax, ay, ox, oy} against its own viewport, so dock-to-edge intent
      // survives viewport-size differences across tabs.
      if (hasField("panelAnchor") &&
        stateForPanelStateSync.panelAnchor &&
        typeof stateForPanelStateSync.panelAnchor === "object" &&
        typeof runtimeForPanelStateSync.setPanelPosition === "function"
      ) {
        runtimeForPanelStateSync.setPanelPosition(stateForPanelStateSync.panelAnchor);
      }

      // 9. Reduced-view pane (per main tab). Stored intent only; applying
      // 'detail' falls back to 'list' when the corresponding active record
      // can't resolve (handled inside setReducedPane).
      const paneFieldToTabPairsForPanelStateSync = [
        ["paneChats", "chats"],
        ["paneNotes", "notes"],
        ["paneTasks", "tasks"],
        ["paneQuestions", "questions"]
      ];
      for (let pairIndexForPanelStateSync = 0; pairIndexForPanelStateSync < paneFieldToTabPairsForPanelStateSync.length; pairIndexForPanelStateSync++) {
        const pairForPanelStateSync = paneFieldToTabPairsForPanelStateSync[pairIndexForPanelStateSync];
        const fieldNameForPanelStateSync = pairForPanelStateSync[0];
        const tabNameForPanelStateSync = pairForPanelStateSync[1];
        if (hasField(fieldNameForPanelStateSync) &&
          typeof stateForPanelStateSync[fieldNameForPanelStateSync] === "string" &&
          typeof runtimeForPanelStateSync.setReducedPane === "function"
        ) {
          runtimeForPanelStateSync.setReducedPane(
            tabNameForPanelStateSync,
            stateForPanelStateSync[fieldNameForPanelStateSync]
          );
        }
      }

      // 10. Sub-tabs / filters (apply unconditionally; not gated by mode).
      if (hasField("chatSubTab") &&
        typeof stateForPanelStateSync.chatSubTab === "string" &&
        typeof runtimeForPanelStateSync.setChatSubTab === "function"
      ) {
        runtimeForPanelStateSync.setChatSubTab(stateForPanelStateSync.chatSubTab);
      }
      if (hasField("taskFilter") &&
        typeof stateForPanelStateSync.taskFilter === "string" &&
        typeof runtimeForPanelStateSync.setTaskFilter === "function"
      ) {
        runtimeForPanelStateSync.setTaskFilter(stateForPanelStateSync.taskFilter);
      }
      if (hasField("quizFilter") &&
        typeof stateForPanelStateSync.quizFilter === "string" &&
        typeof runtimeForPanelStateSync.setQuizFilter === "function"
      ) {
        runtimeForPanelStateSync.setQuizFilter(stateForPanelStateSync.quizFilter);
      }
    } finally {
      // Release the guard on the next tick so any DOM events triggered by the
      // apply functions above don't write back into storage.
      setTimeout(function releaseApplyGuardForPanelStateSync() {
        applyingFromRemoteForPanelStateSync = false;
      }, 0);
    }
  }

  function isTabActiveForPanelStateSync() {
    try {
      if (document.visibilityState !== "visible") return false;
      if (typeof isThisTabActiveCachedForPanelStateSync === "boolean") {
        return isThisTabActiveCachedForPanelStateSync;
      }
      // SW hasn't pushed a value yet. Fall back to document.hasFocus() so
      // boot-time behavior is roughly the same as before this mechanism
      // existed, until the first push corrects us.
      return document.hasFocus();
    } catch (errorForPanelStateSync) {
      return true;
    }
  }

  function shouldDeferIsOpenForPanelStateSync() {
    return (
      VISIBLE_TAB_ONLY_ISOPEN_FOR_PANEL_STATE_SYNC && !isTabActiveForPanelStateSync()
    );
  }

  function flushPendingIsOpenForPanelStateSync() {
    if (!hasPendingIsOpenForPanelStateSync) return;
    const desiredForFlush = pendingIsOpenForPanelStateSync;
    hasPendingIsOpenForPanelStateSync = false;
    pendingIsOpenForPanelStateSync = null;
    if (typeof desiredForFlush !== "boolean") return;
    applyStateForPanelStateSync({ isOpen: desiredForFlush }, new Set(["isOpen"]));
  }

  function bindActivationListenersForPanelStateSync() {
    if (!visibilityListenerForPanelStateSync) {
      visibilityListenerForPanelStateSync = function panelStateSyncVisibilityListenerForPanelStateSync() {
        if (isStaleForPanelStateSync()) {
          try {
            document.removeEventListener("visibilitychange", visibilityListenerForPanelStateSync, true);
          } catch (errorForPanelStateSync) {}
          visibilityListenerForPanelStateSync = null;
          return;
        }
        if (!isTabActiveForPanelStateSync()) return;
        flushPendingIsOpenForPanelStateSync();
      };
      try {
        document.addEventListener("visibilitychange", visibilityListenerForPanelStateSync, true);
      } catch (errorForPanelStateSync) {}
    }
    if (!windowFocusListenerForPanelStateSync) {
      windowFocusListenerForPanelStateSync = function panelStateSyncWindowFocusListenerForPanelStateSync() {
        if (isStaleForPanelStateSync()) {
          try {
            window.removeEventListener("focus", windowFocusListenerForPanelStateSync, true);
          } catch (errorForPanelStateSync) {}
          windowFocusListenerForPanelStateSync = null;
          return;
        }
        if (!isTabActiveForPanelStateSync()) return;
        flushPendingIsOpenForPanelStateSync();
      };
      try {
        window.addEventListener("focus", windowFocusListenerForPanelStateSync, true);
      } catch (errorForPanelStateSync) {}
    }
    if (!activeTabPushListenerForPanelStateSync) {
      activeTabPushListenerForPanelStateSync = function panelStateSyncActiveTabPushListenerForPanelStateSync(
        msgForActiveTabPush
      ) {
        if (isStaleForPanelStateSync()) {
          try {
            chrome.runtime.onMessage.removeListener(activeTabPushListenerForPanelStateSync);
          } catch (errorForPanelStateSync) {}
          activeTabPushListenerForPanelStateSync = null;
          return;
        }
        if (!msgForActiveTabPush || msgForActiveTabPush.action !== "activeTabChanged") return;
        isThisTabActiveCachedForPanelStateSync = Boolean(msgForActiveTabPush.isActive);
        if (isThisTabActiveCachedForPanelStateSync && document.visibilityState === "visible") {
          flushPendingIsOpenForPanelStateSync();
        }
      };
      try {
        chrome.runtime.onMessage.addListener(activeTabPushListenerForPanelStateSync);
      } catch (errorForPanelStateSync) {}
    }
    // Bootstrap the cache: ask the SW whether this tab is currently the
    // active one. If the SW hasn't resolved yet (e.g. cold start), it will
    // push via activeTabChanged once it does.
    try {
      chrome.runtime.sendMessage({ action: "getActiveTabStatus" }, function (responseForActiveTabBoot) {
        if (chrome.runtime.lastError) {
          void chrome.runtime.lastError;
          return;
        }
        if (isStaleForPanelStateSync()) return;
        if (responseForActiveTabBoot && typeof responseForActiveTabBoot.isActive === "boolean") {
          isThisTabActiveCachedForPanelStateSync = responseForActiveTabBoot.isActive;
          if (isThisTabActiveCachedForPanelStateSync && document.visibilityState === "visible") {
            flushPendingIsOpenForPanelStateSync();
          }
        }
      });
    } catch (errorForPanelStateSync) {}
  }

  function bindStorageListenerForPanelStateSync() {
    if (storageListenerForPanelStateSync) {
      try {
        chrome.storage.onChanged.removeListener(storageListenerForPanelStateSync);
      } catch (errorForPanelStateSync) {}
      storageListenerForPanelStateSync = null;
    }
    storageListenerForPanelStateSync = function panelStateSyncStorageListenerForPanelStateSync(
      changesForPanelStateSync,
      areaForPanelStateSync
    ) {
      if (isStaleForPanelStateSync()) {
        try {
          chrome.storage.onChanged.removeListener(storageListenerForPanelStateSync);
        } catch (errorForPanelStateSync) {}
        storageListenerForPanelStateSync = null;
        return;
      }
      if (areaForPanelStateSync !== "local") return;
      const incomingForPanelStateSync = {};
      const changedFieldsForDiff = new Set();

      Object.keys(changesForPanelStateSync).forEach(function (storageKeyForDiff) {
        const fieldNameForDiff = getFieldNameFromStorageKeyForPanelStateSync(storageKeyForDiff);
        if (!fieldNameForDiff) return;
        const changeEntryForField = changesForPanelStateSync[storageKeyForDiff];
        const nextRecordForField = changeEntryForField ? changeEntryForField.newValue : null;
        if (!isFieldRecordForPanelStateSync(nextRecordForField)) return;
        if (nextRecordForField.sourceId === sourceIdForPanelStateSync) return;
        const prevRecordForField = changeEntryForField ? changeEntryForField.oldValue : null;
        if (
          isFieldRecordForPanelStateSync(prevRecordForField) &&
          prevRecordForField.updatedAt === nextRecordForField.updatedAt &&
          valuesEqualForPanelStateSync(prevRecordForField.value, nextRecordForField.value)
        ) {
          return;
        }
        if (fieldNameForDiff === "isOpen" && shouldDeferIsOpenForPanelStateSync()) {
          if (typeof nextRecordForField.value === "boolean") {
            pendingIsOpenForPanelStateSync = nextRecordForField.value;
            hasPendingIsOpenForPanelStateSync = true;
          }
          return;
        }
        incomingForPanelStateSync[fieldNameForDiff] = nextRecordForField.value;
        changedFieldsForDiff.add(fieldNameForDiff);
      });

      const legacyChangeForPanelStateSync = changesForPanelStateSync[LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC];
      if (legacyChangeForPanelStateSync && legacyChangeForPanelStateSync.newValue) {
        const legacyIncomingForPanelStateSync = legacyChangeForPanelStateSync.newValue || {};
        const legacyPreviousForPanelStateSync = legacyChangeForPanelStateSync.oldValue || {};
        PANEL_UI_STATE_FIELDS_FOR_PANEL_STATE_SYNC.forEach(function (fieldNameForLegacy) {
          if (!Object.prototype.hasOwnProperty.call(legacyIncomingForPanelStateSync, fieldNameForLegacy)) return;
          if (valuesEqualForPanelStateSync(legacyPreviousForPanelStateSync[fieldNameForLegacy], legacyIncomingForPanelStateSync[fieldNameForLegacy])) return;
          if (fieldNameForLegacy === "isOpen" && shouldDeferIsOpenForPanelStateSync()) {
            const legacyValueForDefer = legacyIncomingForPanelStateSync[fieldNameForLegacy];
            if (typeof legacyValueForDefer === "boolean") {
              pendingIsOpenForPanelStateSync = legacyValueForDefer;
              hasPendingIsOpenForPanelStateSync = true;
            }
            return;
          }
          incomingForPanelStateSync[fieldNameForLegacy] = legacyIncomingForPanelStateSync[fieldNameForLegacy];
          changedFieldsForDiff.add(fieldNameForLegacy);
        });
      }

      if (changedFieldsForDiff.size === 0) return;
      applyStateForPanelStateSync(incomingForPanelStateSync, changedFieldsForDiff);
    };
    try {
      chrome.storage.onChanged.addListener(storageListenerForPanelStateSync);
    } catch (errorForPanelStateSync) {}
  }

  function initForPanelStateSync() {
    if (initializedForPanelStateSync) return;
    initializedForPanelStateSync = true;
    bindStorageListenerForPanelStateSync();
    readStoredStateForPanelStateSync(function (stateForPanelStateSync) {
      applyStateForPanelStateSync(stateForPanelStateSync);
    });
  }

  function teardownForPanelStateSync() {
    if (storageListenerForPanelStateSync) {
      try {
        chrome.storage.onChanged.removeListener(storageListenerForPanelStateSync);
      } catch (errorForPanelStateSync) {}
      storageListenerForPanelStateSync = null;
    }
    if (visibilityListenerForPanelStateSync) {
      try {
        document.removeEventListener("visibilitychange", visibilityListenerForPanelStateSync, true);
      } catch (errorForPanelStateSync) {}
      visibilityListenerForPanelStateSync = null;
    }
    if (windowFocusListenerForPanelStateSync) {
      try {
        window.removeEventListener("focus", windowFocusListenerForPanelStateSync, true);
      } catch (errorForPanelStateSync) {}
      windowFocusListenerForPanelStateSync = null;
    }
    if (activeTabPushListenerForPanelStateSync) {
      try {
        chrome.runtime.onMessage.removeListener(activeTabPushListenerForPanelStateSync);
      } catch (errorForPanelStateSync) {}
      activeTabPushListenerForPanelStateSync = null;
    }
    if (writeTimerForPanelStateSync) {
      clearTimeout(writeTimerForPanelStateSync);
      writeTimerForPanelStateSync = null;
    }
    pendingIsOpenForPanelStateSync = null;
    hasPendingIsOpenForPanelStateSync = false;
    initializedForPanelStateSync = false;
  }

  function isApplyingFromRemoteForPanelStateSync() {
    return applyingFromRemoteForPanelStateSync;
  }

  contentNamespaceForPanelStateSync.ui.panelStateSync = {
    init: initForPanelStateSync,
    teardown: teardownForPanelStateSync,
    writeState: writeStateForPanelStateSync,
    applyState: applyStateForPanelStateSync,
    isApplyingFromRemote: isApplyingFromRemoteForPanelStateSync
  };

  globalScopeForPanelStateSync.ABChatContent = contentNamespaceForPanelStateSync;

  // -----------------------------------------------------------------
  // Bind the storage.onChanged listener at IIFE time (not just inside
  // init()), so that previously-open tabs receive cross-tab updates even
  // before the panel has been launched on them.
  //
  // Without this, an old tab that finished re-injection while the panel was
  // closed everywhere registered nothing: subsequent state writes from other
  // tabs were silently dropped until the user manually launched the panel on
  // that tab (which would call init() and finally bind the listener).
  //
  // applyState() handles the not-yet-initialized case: the visibility branch
  // only needs ui.panel (set up by panel.js earlier in the inject list), so an
  // incoming isOpen=true will auto-open the panel and the rest of the state
  // is then applied via init() from inside panelRuntime.initialize().
  //
  // The listener bind is idempotent; init() calling it again is harmless.
  // -----------------------------------------------------------------
  bindStorageListenerForPanelStateSync();
  bindActivationListenersForPanelStateSync();

  // -----------------------------------------------------------------
  // Early boot: if another tab has the panel open, open it here too.
  //
  // panelStateSync.init() runs from inside panelRuntime.initialize(),
  // which is only called when the panel is first shown — so a fresh
  // tab that hasn't opened the panel before would never see the
  // mirrored isOpen=true from another tab.
  //
  // We call panel.setVisible(true) eagerly here, which triggers
  // ensurePanelReadyForPanelBoot → panelRuntime.initialize →
  // panelStateSync.init(), and the rest of the state is applied there.
  //
  // The write-back from setVisible(true) is a no-op because the stored
  // value is already true (merge guard skips identical writes).
  // -----------------------------------------------------------------
  function autoOpenIfStoredForPanelStateSync() {
    readStoredStateForPanelStateSync(function (stateForAutoOpen) {
      if (!stateForAutoOpen || stateForAutoOpen.isOpen !== true) return;
      if (shouldDeferIsOpenForPanelStateSync()) {
        pendingIsOpenForPanelStateSync = true;
        hasPendingIsOpenForPanelStateSync = true;
        return;
      }
      const panelUiForAutoOpen = getPanelUiNamespaceForPanelStateSync();
      if (!panelUiForAutoOpen) return;
      if (typeof panelUiForAutoOpen.isVisible === "function" && panelUiForAutoOpen.isVisible()) return;
      try {
        if (typeof panelUiForAutoOpen.ensureReady === "function") panelUiForAutoOpen.ensureReady();
        if (typeof panelUiForAutoOpen.setVisible === "function") panelUiForAutoOpen.setVisible(true);
      } catch (errorForAutoOpen) {}
    });
  }

  // Defer to ensure document.body exists (document_idle should already
  // guarantee this, but the deferral also lets panel.js finish its IIFE
  // setup if injection order ever changes).
  if (document && document.body) {
    autoOpenIfStoredForPanelStateSync();
  } else {
    document.addEventListener("DOMContentLoaded", autoOpenIfStoredForPanelStateSync, { once: true });
  }
})();
