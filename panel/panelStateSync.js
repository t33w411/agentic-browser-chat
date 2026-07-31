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
//   noteSubTab           ('notes' | 'clips'; sub-tab inside Notes)
//   taskFilter           ('all' | 'pending' | 'completed')
//   quizFilter           ('all' | 'due' | 'paused')
//   chatSearchQuery      (text in the Chats sidebar search input)
//   notesSearchQuery     (text in the Notes sidebar search input)
//   taskSearchQuery      (text in the Tasks search input)
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

  // Panel visibility ("is the panel open, and in which tab") is owned by the
  // service worker, which combines the persisted `isOpen` bit with the live
  // active tab. This tab does not decide its own visibility; it pulls the
  // decision via `resolvePanelStateForTab` (see
  // reconcilePanelVisibilityForPanelStateSync) on every signal that can change
  // the answer. All OTHER mirrored fields (mode, tab, active ids, popouts, panel
  // position, filters) sync immediately and symmetrically via storage.

  const LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC = "abchat_panel_ui_state";
  const PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_STATE_SYNC = "abchat_panel_ui_state_field_";
  const WRITE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC = 50;
  const RECONCILE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC = 50;
  const PREWARM_IDLE_TIMEOUT_MS_FOR_PANEL_STATE_SYNC = 2000;
  const PREWARM_FALLBACK_DELAY_MS_FOR_PANEL_STATE_SYNC = 500;
  // How long after an activation signal (with isOpen true) a reconcile "close"
  // verdict is treated as suspect and re-verified instead of applied. Covers
  // the window-focus transition where the SW's tracked active tab and
  // getLastFocused still point at the previous window for a few hundred ms.
  const OPTIMISTIC_CLOSE_GRACE_MS_FOR_PANEL_STATE_SYNC = 800;
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
    "noteSubTab",
    "taskFilter",
    "quizFilter",
    "chatSearchQuery",
    "notesSearchQuery",
    "taskSearchQuery"
  ];

  let applyingFromRemoteForPanelStateSync = false;
  let writeTimerForPanelStateSync = null;
  let pendingWriteForPanelStateSync = {};
  let storageListenerForPanelStateSync = null;
  let initializedForPanelStateSync = false;
  let visibilityListenerForPanelStateSync = null;
  let windowFocusListenerForPanelStateSync = null;
  let activeTabPushListenerForPanelStateSync = null;
  // Monotonic guard so a slow `resolvePanelStateForTab` response from a
  // superseded reconcile cannot flip visibility back after a newer one resolved.
  let reconcileSeqForPanelStateSync = 0;
  // Locally mirrored copy of the global isOpen intent, kept current from the
  // initial seed read, local writeState calls, and storage.onChanged records.
  // Powers the zero-round-trip optimistic show on activation and the hidden-tab
  // pre-warm; the SW reconcile pull remains the authority and corrects it.
  let cachedIsOpenForPanelStateSync = null;
  let reconcileTimerForPanelStateSync = null;
  let prewarmScheduledForPanelStateSync = false;
  // Set by maybeOptimisticShow on every activation signal that expects the
  // panel open; arms the close-grace check in applyResolvedVisibility.
  let lastActivationShowAtMsForPanelStateSync = 0;
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

  // Seed the local isOpen mirror once at injection time. The null guard means a
  // storage event or local write that lands before this read resolves wins over
  // the (older) stored value.
  function seedCachedIsOpenForPanelStateSync(callbackForPanelStateSync) {
    function finishSeedForPanelStateSync() {
      if (typeof callbackForPanelStateSync === "function") {
        try { callbackForPanelStateSync(); } catch (errorForPanelStateSync) {}
      }
    }
    try {
      const isOpenKeyForSeed = getFieldKeyForPanelStateSync("isOpen");
      chrome.storage.local.get(
        [isOpenKeyForSeed, LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC],
        function (resForSeed) {
          if (cachedIsOpenForPanelStateSync === null) {
            const recordForSeed = resForSeed && resForSeed[isOpenKeyForSeed];
            if (isFieldRecordForPanelStateSync(recordForSeed) && typeof recordForSeed.value === "boolean") {
              cachedIsOpenForPanelStateSync = recordForSeed.value;
            } else {
              const legacyForSeed = resForSeed && resForSeed[LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_STATE_SYNC];
              if (legacyForSeed && typeof legacyForSeed.isOpen === "boolean") {
                cachedIsOpenForPanelStateSync = legacyForSeed.isOpen;
              }
            }
          }
          finishSeedForPanelStateSync();
        }
      );
    } catch (errorForPanelStateSync) {
      finishSeedForPanelStateSync();
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
    if (!pendingWriteForPanelStateSync || Object.keys(pendingWriteForPanelStateSync).length === 0) {
      return;
    }
    // A remote apply is mid-flight. Writing now would race the apply guard, and
    // consuming the queue first would silently drop it. Keep the pending updates
    // and retry on the next debounce tick instead. Dropping a queued
    // isOpen:false here is exactly how a just-closed panel gets persisted as
    // open and then reopens on the next extension reload.
    if (applyingFromRemoteForPanelStateSync) {
      writeTimerForPanelStateSync = setTimeout(
        flushPendingWriteForPanelStateSync,
        WRITE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC
      );
      return;
    }
    const updatesForPanelStateSync = pendingWriteForPanelStateSync;
    pendingWriteForPanelStateSync = {};
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
      cachedIsOpenForPanelStateSync = partialForPanelStateSync.isOpen;
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

  // "Is the panel proper open here?" Never the raw shadow-host display check:
  // the Quick Question overlay displays the host with #panel-host hidden, which
  // is not the panel being open. Reading the raw check made every close verdict
  // (init apply, reconcile pull, SW push) resolve "visible but should not be"
  // against that overlay and hide it, leaving its queued open to fire on the
  // next real panel open.
  function isPanelOpenForPanelStateSync() {
    const panelUiForIsOpen = getPanelUiNamespaceForPanelStateSync();
    if (!panelUiForIsOpen) return false;
    if (typeof panelUiForIsOpen.isPanelOpen === "function") {
      return Boolean(panelUiForIsOpen.isPanelOpen());
    }
    if (typeof panelUiForIsOpen.isVisible === "function") {
      return Boolean(panelUiForIsOpen.isVisible());
    }
    return false;
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
        const isCurrentlyVisibleForPanelStateSync = isPanelOpenForPanelStateSync();
        if (stateForPanelStateSync.isOpen !== isCurrentlyVisibleForPanelStateSync) {
          if (stateForPanelStateSync.isOpen) {
            // Never unhide the panel in a hidden tab: a background tab only
            // pre-warms its DOM and shows via the optimistic path (or the
            // reconcile pull) when it actually becomes visible. The close
            // direction below stays ungated so hidden tabs still tear down.
            if (document.visibilityState === "visible") {
              if (typeof panelUiForPanelStateSync.ensureReady === "function") {
                panelUiForPanelStateSync.ensureReady();
              }
              if (typeof panelUiForPanelStateSync.setVisible === "function") {
                panelUiForPanelStateSync.setVisible(true);
              }
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
      if (hasField("noteSubTab") &&
        typeof stateForPanelStateSync.noteSubTab === "string" &&
        typeof runtimeForPanelStateSync.setNoteSubTab === "function"
      ) {
        runtimeForPanelStateSync.setNoteSubTab(stateForPanelStateSync.noteSubTab);
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
      if (hasField("chatSearchQuery") &&
        typeof stateForPanelStateSync.chatSearchQuery === "string" &&
        typeof runtimeForPanelStateSync.setChatSearchQuery === "function"
      ) {
        runtimeForPanelStateSync.setChatSearchQuery(stateForPanelStateSync.chatSearchQuery);
      }
      if (hasField("notesSearchQuery") &&
        typeof stateForPanelStateSync.notesSearchQuery === "string" &&
        typeof runtimeForPanelStateSync.setNotesSearchQuery === "function"
      ) {
        runtimeForPanelStateSync.setNotesSearchQuery(stateForPanelStateSync.notesSearchQuery);
      }
      if (hasField("taskSearchQuery") &&
        typeof stateForPanelStateSync.taskSearchQuery === "string" &&
        typeof runtimeForPanelStateSync.setTaskSearchQuery === "function"
      ) {
        runtimeForPanelStateSync.setTaskSearchQuery(stateForPanelStateSync.taskSearchQuery);
      }
    } finally {
      // Release the guard on the next tick so any DOM events triggered by the
      // apply functions above don't write back into storage.
      setTimeout(function releaseApplyGuardForPanelStateSync() {
        applyingFromRemoteForPanelStateSync = false;
      }, 0);
    }
  }

  function getResolveActionForPanelStateSync() {
    const actionsForResolve =
      (globalScopeForPanelStateSync.ABChatShared && globalScopeForPanelStateSync.ABChatShared.actions) || {};
    return actionsForResolve.resolvePanelStateForTab || "resolvePanelStateForTab";
  }

  // Close-grace: a "close" verdict landing right after this tab was activated
  // with isOpen true is usually the SW's view lagging the focus transition
  // (tracked active tab / getLastFocused still on the previous window), not a
  // real decision. Applying it would flash the panel closed and reopened.
  // While inside the grace window the close is deferred and re-verified by
  // another pull; a "no" that survives past the grace is trusted and closes.
  // The re-ask loop is bounded by the grace duration. A genuine global close
  // never defers: cachedIsOpen is false by then, and a stale-open tab in a
  // background window fails the recent-activation check.
  function shouldDeferSuspectCloseForPanelStateSync() {
    if (cachedIsOpenForPanelStateSync !== true) return false;
    if (document.visibilityState !== "visible") return false;
    const sinceActivationForGrace = Date.now() - lastActivationShowAtMsForPanelStateSync;
    return (
      sinceActivationForGrace >= 0 &&
      sinceActivationForGrace < OPTIMISTIC_CLOSE_GRACE_MS_FOR_PANEL_STATE_SYNC
    );
  }

  // Apply the service worker's authoritative per-tab decision. Guarded by the
  // monotonic sequence so a superseded reconcile's late response can't apply.
  function applyResolvedVisibilityForPanelStateSync(shouldBeOpenForApply, seqForApply) {
    if (seqForApply !== reconcileSeqForPanelStateSync) return;
    if (isStaleForPanelStateSync()) return;
    const panelUiForApply = getPanelUiNamespaceForPanelStateSync();
    if (!panelUiForApply) return;
    const isVisibleForApply = isPanelOpenForPanelStateSync();
    if (Boolean(shouldBeOpenForApply) === isVisibleForApply) return;
    if (!shouldBeOpenForApply && isVisibleForApply && shouldDeferSuspectCloseForPanelStateSync()) {
      scheduleReconcileForPanelStateSync();
      return;
    }
    applyStateForPanelStateSync({ isOpen: Boolean(shouldBeOpenForApply) }, new Set(["isOpen"]));
  }

  // Entry point for the SW's panelVisibilityCommand push (see content/main.js).
  // Closes go through the same close-grace as reconcile verdicts: a stale
  // enforce whose active-tab query resolved after the focus moved can target
  // the newly activated tab, and applying that push directly would reintroduce
  // the flash the grace exists to prevent.
  function applyVisibilityCommandForPanelStateSync(isOpenForCommand) {
    if (isStaleForPanelStateSync()) return;
    if (!isOpenForCommand) {
      const isVisibleForCommand = isPanelOpenForPanelStateSync();
      if (isVisibleForCommand && shouldDeferSuspectCloseForPanelStateSync()) {
        scheduleReconcileForPanelStateSync();
        return;
      }
    }
    applyStateForPanelStateSync({ isOpen: Boolean(isOpenForCommand) }, new Set(["isOpen"]));
  }

  // Fallback when the service worker can't be reached: apply only the safe CLOSE
  // direction, decided from storage alone. Opening requires knowing which tab is
  // active, which only the SW can answer, so a fallback never opens.
  function reconcileFallbackCloseOnlyForPanelStateSync(seqForFallback) {
    readStoredStateForPanelStateSync(function (storedForFallback) {
      if (seqForFallback !== reconcileSeqForPanelStateSync) return;
      const storageOpenForFallback = Boolean(storedForFallback && storedForFallback.isOpen === true);
      if (storageOpenForFallback) return;
      applyResolvedVisibilityForPanelStateSync(false, seqForFallback);
    });
  }

  // Reconcile this tab's panel against the service worker's single source of
  // truth: "should THIS tab show the panel right now?" = global isOpen AND this
  // tab is the active tab. The SW combines the persisted isOpen with the live
  // focused-window active tab (falling back to its tracked active tab when the
  // browser has lost OS focus, so the panel does not close when focus moves to
  // another app). The content side no longer decides this itself; it asks.
  //
  // A pull (request/response) is used rather than relying on the SW's push
  // commands, because a push can be silently dropped to a busy or just-injected
  // tab — which is exactly how a closed panel used to linger open on another
  // tab. The pull runs on every signal that can change the answer: tab/window
  // activation, an isOpen change from another tab, and (re-)injection.
  function reconcilePanelVisibilityForPanelStateSync() {
    if (isStaleForPanelStateSync()) return;
    const seqForReconcile = ++reconcileSeqForPanelStateSync;
    try {
      chrome.runtime.sendMessage(
        { action: getResolveActionForPanelStateSync() },
        function (responseForReconcile) {
          if (chrome.runtime.lastError) {
            void chrome.runtime.lastError;
            reconcileFallbackCloseOnlyForPanelStateSync(seqForReconcile);
            return;
          }
          if (
            !responseForReconcile ||
            responseForReconcile.ok !== true ||
            typeof responseForReconcile.shouldBeOpen !== "boolean"
          ) {
            reconcileFallbackCloseOnlyForPanelStateSync(seqForReconcile);
            return;
          }
          applyResolvedVisibilityForPanelStateSync(responseForReconcile.shouldBeOpen, seqForReconcile);
        }
      );
    } catch (errorForReconcile) {
      reconcileFallbackCloseOnlyForPanelStateSync(seqForReconcile);
    }
  }

  // Coalesce the burst of reconcile triggers a single tab switch produces
  // (visibilitychange, window focus, the activeTabChanged push, an isOpen
  // storage change) into one pull per burst. The optimistic show below keeps
  // perceived latency at zero, so delaying the authoritative pull by the
  // debounce window costs nothing visible.
  function scheduleReconcileForPanelStateSync() {
    if (reconcileTimerForPanelStateSync) return;
    reconcileTimerForPanelStateSync = setTimeout(function () {
      reconcileTimerForPanelStateSync = null;
      reconcilePanelVisibilityForPanelStateSync();
    }, RECONCILE_DEBOUNCE_MS_FOR_PANEL_STATE_SYNC);
  }

  // Zero-round-trip show for a tab that just became visible or focused while
  // the mirrored global isOpen is true. The trailing reconcile pull stays
  // authoritative: in the rare case this tab should not show the panel (e.g.
  // it was activated inside an unfocused window), the pull closes it within
  // one round trip. Applying through applyState keeps the applyingFromRemote
  // guard engaged, so the show does not echo back into storage as fresh
  // intent. Only activation signals call this; a remote isOpen change alone
  // must not, because visible tabs in unfocused windows would wrongly show.
  function maybeOptimisticShowForPanelStateSync() {
    if (isStaleForPanelStateSync()) return;
    if (cachedIsOpenForPanelStateSync !== true) return;
    if (document.visibilityState !== "visible") return;
    // Arm the close-grace window even when the panel is already visible: this
    // activation expects the panel open, so a "close" verdict landing within
    // the grace is suspect regardless of who flipped the display first.
    lastActivationShowAtMsForPanelStateSync = Date.now();
    const panelUiForOptimisticShow = getPanelUiNamespaceForPanelStateSync();
    if (!panelUiForOptimisticShow) return;
    if (isPanelOpenForPanelStateSync()) return;
    applyStateForPanelStateSync({ isOpen: true }, new Set(["isOpen"]));
  }

  // Pre-warm: build the panel DOM (still hidden) while the tab is idle, so a
  // later switch to this tab is a display flip instead of a full markup build,
  // CSS load, and runtime init at switch time. Only runs while the global
  // isOpen is true; a tab whose panel is never going to be needed pays nothing
  // beyond the storage read it already does.
  function schedulePrewarmForPanelStateSync() {
    if (prewarmScheduledForPanelStateSync) return;
    prewarmScheduledForPanelStateSync = true;
    function runPrewarmForPanelStateSync() {
      prewarmScheduledForPanelStateSync = false;
      if (isStaleForPanelStateSync()) return;
      if (cachedIsOpenForPanelStateSync !== true) return;
      const panelUiForPrewarm = getPanelUiNamespaceForPanelStateSync();
      if (!panelUiForPrewarm || typeof panelUiForPrewarm.ensureReady !== "function") return;
      try { panelUiForPrewarm.ensureReady(); } catch (errorForPanelStateSync) {}
    }
    try {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(runPrewarmForPanelStateSync, {
          timeout: PREWARM_IDLE_TIMEOUT_MS_FOR_PANEL_STATE_SYNC
        });
        return;
      }
    } catch (errorForPanelStateSync) {}
    setTimeout(runPrewarmForPanelStateSync, PREWARM_FALLBACK_DELAY_MS_FOR_PANEL_STATE_SYNC);
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
        if (document.visibilityState !== "visible") return;
        maybeOptimisticShowForPanelStateSync();
        scheduleReconcileForPanelStateSync();
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
        maybeOptimisticShowForPanelStateSync();
        scheduleReconcileForPanelStateSync();
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
        // The SW pushes this whenever the active tab changes. The payload's
        // isActive tells this tab whether it gained or lost active status; the
        // authoritative answer still comes from the reconcile pull that
        // follows. Reconcile on both directions: a tab that just lost active
        // must close if it should no longer show the panel.
        if (!msgForActiveTabPush || msgForActiveTabPush.action !== "activeTabChanged") return;
        if (msgForActiveTabPush.isActive === false) {
          // This tab just LOST active status. Disarm the close-grace so the
          // legitimate close that follows (push command or pull verdict)
          // applies immediately instead of being deferred as a suspect stale
          // close. Never arm or optimistic-show on a loss: that is what let a
          // still-visible tab in a newly unfocused window keep its panel for
          // the whole grace window and blink out late.
          lastActivationShowAtMsForPanelStateSync = 0;
          if (document.visibilityState === "visible") {
            scheduleReconcileForPanelStateSync();
          }
          return;
        }
        if (document.visibilityState === "visible") {
          maybeOptimisticShowForPanelStateSync();
          scheduleReconcileForPanelStateSync();
        }
      };
      try {
        chrome.runtime.onMessage.addListener(activeTabPushListenerForPanelStateSync);
      } catch (errorForPanelStateSync) {}
    }
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
      // isOpen is owned by the SW: a change to it triggers an authoritative
      // reconcile pull rather than applying the raw stored value directly.
      let needsVisibilityReconcileForDiff = false;

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
        if (fieldNameForDiff === "isOpen") {
          if (typeof nextRecordForField.value === "boolean") {
            cachedIsOpenForPanelStateSync = nextRecordForField.value;
            if (nextRecordForField.value === true) {
              schedulePrewarmForPanelStateSync();
            }
          }
          needsVisibilityReconcileForDiff = true;
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
          if (fieldNameForLegacy === "isOpen") {
            if (typeof legacyIncomingForPanelStateSync.isOpen === "boolean") {
              cachedIsOpenForPanelStateSync = legacyIncomingForPanelStateSync.isOpen;
              if (legacyIncomingForPanelStateSync.isOpen === true) {
                schedulePrewarmForPanelStateSync();
              }
            }
            needsVisibilityReconcileForDiff = true;
            return;
          }
          incomingForPanelStateSync[fieldNameForLegacy] = legacyIncomingForPanelStateSync[fieldNameForLegacy];
          changedFieldsForDiff.add(fieldNameForLegacy);
        });
      }

      if (changedFieldsForDiff.size > 0) {
        applyStateForPanelStateSync(incomingForPanelStateSync, changedFieldsForDiff);
      }
      if (needsVisibilityReconcileForDiff) {
        scheduleReconcileForPanelStateSync();
      }
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
    if (reconcileTimerForPanelStateSync) {
      clearTimeout(reconcileTimerForPanelStateSync);
      reconcileTimerForPanelStateSync = null;
    }
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
    applyVisibilityCommand: applyVisibilityCommandForPanelStateSync,
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
  // only needs ui.panel (set up by panel.js earlier in the inject list), so a
  // reconcile that resolves to open will open the panel and the rest of the
  // state is then applied via init() from inside panelRuntime.initialize().
  //
  // The listener bind is idempotent; init() calling it again is harmless.
  // -----------------------------------------------------------------
  bindStorageListenerForPanelStateSync();
  bindActivationListenersForPanelStateSync();

  // -----------------------------------------------------------------
  // Early boot / re-injection: reconcile this tab's panel against the service
  // worker's decision (pull). This runs at IIFE time, before the panel runtime
  // is initialized, and covers both directions:
  //   - open: when the SW says this tab should show the panel, applyState calls
  //     panel.setVisible(true) → ensurePanelReadyForPanelBoot →
  //     panelRuntime.initialize → panelStateSync.init(), and the rest of the
  //     state is applied there.
  //   - close: a panel whose DOM survived an extension reload (the old shadow
  //     host is still display:block) but which should be closed is forced back
  //     to closed, so it does not reappear after the reload.
  //
  // The reconcile applies via applyState (the applyingFromRemote guard makes the
  // setVisible write-back a no-op), so it does not re-broadcast as fresh intent.
  //
  // The seed read primes the local isOpen mirror first, then:
  //   - optimistic show: if this tab is visible and isOpen is true, open
  //     immediately without waiting for the SW round trip (page navigation on
  //     the active tab). The reconcile that follows stays the authority.
  //   - pre-warm: if isOpen is true but this tab is hidden, build the panel
  //     DOM at idle so a later switch to this tab is a pure display flip.
  //
  // Defer to ensure document.body exists (document_idle should already
  // guarantee this, but the deferral also lets panel.js finish its IIFE
  // setup if injection order ever changes).
  // -----------------------------------------------------------------
  function bootVisibilityForPanelStateSync() {
    seedCachedIsOpenForPanelStateSync(function () {
      if (cachedIsOpenForPanelStateSync === true) {
        maybeOptimisticShowForPanelStateSync();
        schedulePrewarmForPanelStateSync();
      }
      reconcilePanelVisibilityForPanelStateSync();
    });
  }
  if (document && document.body) {
    bootVisibilityForPanelStateSync();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      bootVisibilityForPanelStateSync,
      { once: true }
    );
  }
})();
