(function () {
  // Generate a unique nonce for this injection. A new random value is produced on
  // every script execution, so it reliably signals "a new injection is running".
  // chrome.runtime.id is NOT used as the injection marker — it is a stable extension
  // identifier that never changes between reloads, making it useless for distinguishing
  // separate injections.
  var injectionNonceForContentMain = Math.random().toString(36).slice(2);

  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      return;
    }
  } catch (errForContentMain) {
    return;
  }

  // Migration-safe detection for "a previous injection already ran in this page":
  //   - abchatMainInitNonce (current marker)
  //   - abchatMainInitRuntimeId (legacy marker from prior builds)
  //   - data-abchat-content-main-initialized="1" on <html> (DOM marker)
  //   - ABChatContent.state presence (defensive fallback for older in-page state)
  //
  // Lessons learned:
  // - Re-init detection must be backward-compatible during rollout.
  // - A DOM marker helps detect prior injections even when global state is partially reset.
  var initialDocumentRootForContentMain =
    document && document.documentElement && document.documentElement.getAttribute
      ? document.documentElement
      : null;
  var hasDomInjectionMarkerForContentMain = Boolean(
    initialDocumentRootForContentMain &&
    initialDocumentRootForContentMain.getAttribute("data-abchat-content-main-initialized") === "1"
  );
  var hadPreviousInjectionForContentMain =
    hasDomInjectionMarkerForContentMain ||
    Boolean(window.abchatMainInitNonce) ||
    Boolean(window.abchatMainInitRuntimeId) ||
    Boolean(globalThis.ABChatContent && globalThis.ABChatContent.state);
  var isReInitForContentMain = hadPreviousInjectionForContentMain;
  window.abchatMainInitNonce = injectionNonceForContentMain;
  if (initialDocumentRootForContentMain && initialDocumentRootForContentMain.setAttribute) {
    initialDocumentRootForContentMain.setAttribute("data-abchat-content-main-initialized", "1");
  }
  // Clear legacy marker after migration-safe detection to keep one source of truth.
  window.abchatMainInitRuntimeId = "";

  // --- Extension-reload recovery (re-injection clean-up) ---
  //
  // When the extension reloads (developer reloads via chrome://extensions/, or an
  // update is installed), Chrome invalidates the runtime context of every content
  // script already running in open tabs. Without intervention the user would need
  // to manually refresh every tab before the extension works again.
  //
  // The service worker prevents this by calling reInjectIntoAllSupportedTabs() from
  // its onInstalled listener, which re-runs all content scripts into those tabs
  // immediately after the reload. This IIFE is therefore executed a second time in
  // the same page context, so it must clean up after the previous run.
  //
  // Four things happen in the re-init block below:
  //
  //   1. window.abchatListenerGeneration is incremented — by content/preInit.js, NOT here.
  //      preInit.js is the FIRST file in the injection list and increments the counter
  //      before any tool script executes. Every tool IIFE and this file capture this
  //      counter at load time as their own "capturedGeneration" variable. Every DOM
  //      listener (mousemove, click, contextmenu) and Chrome API listener (onMessage,
  //      storage.onChanged, visibilitychange) compare window.abchatListenerGeneration
  //      against that snapshot at call time. A mismatch means "I am from a stale
  //      injection" and the listener skips processing (and self-deregisters where
  //      possible).
  //      CRITICAL: the increment must happen in preInit.js (first file), not here
  //      (last file). If incremented here, tool scripts would have already captured
  //      the old value, causing every new handler to immediately fail its own stale
  //      check on first fire and self-deregister — breaking all features after reload.
  //
  //   2. Mode-enabled flags are reset to false.
  //      Re-injected tool scripts start in the OFF state regardless of what was
  //      active before the reload. The shared ABChatContent.state object persists across
  //      injections because it lives on globalThis, so it must be zeroed explicitly.
  //
  //   3. "Already-bound" guard flags are reset to false.
  //      Tools that register a persistent listener once (e.g. the contextmenu
  //      listeners in flattenedContent, contentSelector) guard
  //      against double-registration with a boolean on state. Those flags must be
  //      cleared here so each tool's ensureBinding() call registers a fresh listener
  //      under the new generation. Omitting any flag causes that feature to become
  //      silently unavailable after a reload because the new instance sees the flag
  //      still set and skips re-binding.
  //
  //   4. Visual highlight classes are stripped from the DOM.
  //      These are cosmetic markers that belong to the previous tool state. They
  //      would persist on the page as visible artefacts if not removed here.
  //
  // IMPORTANT — ping path must never toast on context invalidation:
  //   pingServiceWorkerForContentMain() is called from the visibilitychange listener
  //   as a silent background health check. It must NOT call isContextValidForContentMain()
  //   (which unconditionally shows a toast). The toast is reserved for
  //   dispatchActionForContentMain(), which runs only on explicit user actions.

  if (isReInitForContentMain) {
    // NOTE: window.abchatListenerGeneration was already incremented by content/preInit.js,
    // which runs FIRST in the injection list. preInit.js detects re-injection using
    // current + legacy markers that are present before this file runs. Do NOT increment
    // the generation here — tool scripts have already captured the new value.
    if (document && document.querySelectorAll) {
      document.querySelectorAll(
        ".abchat-content-selector-highlight"
      ).forEach(function (elForContentMain) {
        if (elForContentMain && elForContentMain.classList) {
          elForContentMain.classList.remove(
            "abchat-content-selector-highlight"
          );
        }
      });
    }

    var oldStateForContentMain = globalThis.ABChatContent && globalThis.ABChatContent.state;
    if (oldStateForContentMain) {
      // (2) Reset mode flags so re-injected tools start in the OFF state.
      oldStateForContentMain.isContentSelectorEnabled = false;
      var documentRootForContentMain =
        document && document.documentElement && document.documentElement.setAttribute
          ? document.documentElement
          : null;
      if (documentRootForContentMain) {
        documentRootForContentMain.setAttribute("data-abchat-content-selector-active", "0");
      }
      // (3) Reset once-bound listener guards so each tool re-registers its persistent
      // listener under the new generation. Any flag omitted here will silently prevent
      // that tool's feature from working after a reload.
      oldStateForContentMain.contextMenuTrackingBoundForFlattenedContent = false;
      oldStateForContentMain.contextMenuTrackingBoundForContentSelector = false;
    }

    // (4) Tear down the floating panel so it reinitialises cleanly on next open.
    //
    // After re-injection every panel button click handler is a closure from the
    // previous (now-invalidated) extension context, so chrome.runtime calls inside
    // them silently fail. The __abchatPanelRuntimeInitialized guard prevents
    // panelRuntime.js from re-registering fresh handlers. Removing the shadow host
    // and clearing the guard here forces a full rebuild on the next panel open,
    // which is when all lib scripts are already loaded and the extension context is
    // valid again. This also eliminates the "rendering libraries failed to load"
    // error that surfaces when the gate check runs against a stale shadow DOM.
    globalThis.__abchatPanelRuntimeInitialized = false;
    var oldUiForContentMain = globalThis.ABChatContent && globalThis.ABChatContent.ui;
    if (oldUiForContentMain) {
      // Explicitly tear down the previous panel runtime before removing its DOM host.
      // This cancels pending timers and removes the storage listener so they cannot
      // fire against the stale shadow DOM after re-injection.
      // REGRESSION RISK: if you add a new long-lived resource in panelRuntime.js (timer,
      // storage listener, MutationObserver, etc.) you must also cancel it in teardown().
      var oldPanelRuntimeForContentMain = oldUiForContentMain.panelRuntime;
      if (oldPanelRuntimeForContentMain && typeof oldPanelRuntimeForContentMain.teardown === 'function') {
        try { oldPanelRuntimeForContentMain.teardown(); } catch (e) {}
      }
      oldUiForContentMain.panelShadowRoot = null;
    }
    var oldPanelHostForContentMain = document && document.getElementById
      ? document.getElementById('abchat-panel-shadow-host')
      : null;
    if (oldPanelHostForContentMain && oldPanelHostForContentMain.parentNode) {
      oldPanelHostForContentMain.parentNode.removeChild(oldPanelHostForContentMain);
    }
  }

  const globalScopeForContentMain = globalThis;
  const contentNamespaceForContentMain = globalScopeForContentMain.ABChatContent || {};
  const sharedNamespaceForContentMain = globalScopeForContentMain.ABChatShared || {};
  const actionsForContentMain = sharedNamespaceForContentMain.actions || {};
  const communicationForContentMain = sharedNamespaceForContentMain.communication || {};
  const statusesForContentMain = communicationForContentMain.statuses || {};
  const errorCodesForContentMain = communicationForContentMain.errorCodes || {};
  const protocolVersionForContentMain = communicationForContentMain.protocolVersion || 1;
  const storageManagerForContentMain = sharedNamespaceForContentMain.storageManager;
  const domUtilsForContentMain =
    contentNamespaceForContentMain.utils && contentNamespaceForContentMain.utils.dom
      ? contentNamespaceForContentMain.utils.dom
      : null;
  const cachedResponsesForContentMain = new Map();
  const responseCacheTtlMsForContentMain = 8000;

  contentNamespaceForContentMain.state = contentNamespaceForContentMain.state || {};
  contentNamespaceForContentMain.state.runtimeSettings = contentNamespaceForContentMain.state.runtimeSettings || {};
  contentNamespaceForContentMain.state.isReady = false;
  contentNamespaceForContentMain.state.contextInvalidatedForContentMain = false;
  contentNamespaceForContentMain.actionHandlers = contentNamespaceForContentMain.actionHandlers || {};

  const toastForContentMain =
    contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.toast
      ? contentNamespaceForContentMain.ui.toast
      : null;

  function hasRuntimeContextForContentMain() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (errForContentMain) {
      return false;
    }
  }

  function isContextValidForContentMain() {
    if (contentNamespaceForContentMain.state.contextInvalidatedForContentMain) {
      return false;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        throw new Error("no id");
      }
    } catch (errForContentMain) {
      contentNamespaceForContentMain.state.contextInvalidatedForContentMain = true;
      if (toastForContentMain) {
        toastForContentMain.show("Extension was updated or reloaded. Please refresh this page.", { durationMs: 3400 });
      }
      return false;
    }
    return true;
  }

  async function refreshRuntimeSettingsForContentMain() {
    if (!storageManagerForContentMain) {
      return;
    }

    const globalSettingsForContentMain = await storageManagerForContentMain.getSettings();
    contentNamespaceForContentMain.state.runtimeSettings = globalSettingsForContentMain || {};
  }

  function dispatchActionForContentMain(actionNameForContentMain, actionPayloadForContentMain) {
    if (!actionNameForContentMain) {
      return {
        ok: false,
        status: statusesForContentMain.error || "error",
        errorCode: errorCodesForContentMain.invalidRequest || "INVALID_REQUEST",
        errorMessage: "Missing action name.",
        retryable: false
      };
    }
    if (!isContextValidForContentMain()) {
      return {
        ok: false,
        status: statusesForContentMain.contextInvalid || "contextInvalid",
        errorCode: errorCodesForContentMain.contextInvalidated || "CONTEXT_INVALIDATED",
        errorMessage: "Extension context is invalid. Refresh page and retry.",
        retryable: false
      };
    }
    const handlerForContentMain = contentNamespaceForContentMain.actionHandlers[actionNameForContentMain];
    if (typeof handlerForContentMain !== "function") {
      return {
        ok: false,
        status: statusesForContentMain.unsupportedAction || "unsupportedAction",
        errorCode: errorCodesForContentMain.unknownAction || "UNKNOWN_ACTION",
        errorMessage: "No action handler is registered.",
        retryable: false
      };
    }
    try {
      handlerForContentMain(actionPayloadForContentMain || {});
      return {
        ok: true,
        status: statusesForContentMain.handled || "handled",
        errorCode: "",
        errorMessage: "",
        retryable: false
      };
    } catch (errorForContentMain) {
      return {
        ok: false,
        status: statusesForContentMain.error || "error",
        errorCode: errorCodesForContentMain.handlerException || "HANDLER_EXCEPTION",
        errorMessage:
          errorForContentMain && errorForContentMain.message
            ? errorForContentMain.message
            : "Action handler failed.",
        retryable: false
      };
    }
  }

  function pruneCachedResponsesForContentMain() {
    const nowForContentMain = Date.now();
    cachedResponsesForContentMain.forEach((entryForContentMain, keyForContentMain) => {
      if (!entryForContentMain || nowForContentMain - entryForContentMain.createdAtMs > responseCacheTtlMsForContentMain) {
        cachedResponsesForContentMain.delete(keyForContentMain);
      }
    });
  }

  function getCachedResponseForContentMain(requestIdForContentMain) {
    if (!requestIdForContentMain) {
      return null;
    }
    pruneCachedResponsesForContentMain();
    const cachedEntryForContentMain = cachedResponsesForContentMain.get(requestIdForContentMain);
    return cachedEntryForContentMain ? cachedEntryForContentMain.response : null;
  }

  function cacheResponseForContentMain(requestIdForContentMain, responseForContentMain) {
    if (!requestIdForContentMain || !responseForContentMain) {
      return;
    }
    pruneCachedResponsesForContentMain();
    cachedResponsesForContentMain.set(requestIdForContentMain, {
      createdAtMs: Date.now(),
      response: responseForContentMain
    });
  }

  function buildActionResponseForContentMain(requestIdForContentMain, dispatchResultForContentMain) {
    return {
      protocolVersion: protocolVersionForContentMain,
      requestId: requestIdForContentMain || "",
      ok: Boolean(dispatchResultForContentMain && dispatchResultForContentMain.ok),
      status:
        dispatchResultForContentMain && dispatchResultForContentMain.status
          ? dispatchResultForContentMain.status
          : (statusesForContentMain.error || "error"),
      errorCode:
        dispatchResultForContentMain && dispatchResultForContentMain.errorCode
          ? dispatchResultForContentMain.errorCode
          : "",
      errorMessage:
        dispatchResultForContentMain && dispatchResultForContentMain.errorMessage
          ? dispatchResultForContentMain.errorMessage
          : "",
      retryable: Boolean(dispatchResultForContentMain && dispatchResultForContentMain.retryable),
      handledAtMs: Date.now()
    };
  }

  function checkReadinessForContentMain() {
    const hasClipboardUtilsForContentMain =
      contentNamespaceForContentMain.utils &&
      contentNamespaceForContentMain.utils.clipboard &&
      typeof contentNamespaceForContentMain.utils.clipboard.copyText === "function";
    const hasDomUtilsForContentMain =
      contentNamespaceForContentMain.utils &&
      contentNamespaceForContentMain.utils.dom &&
      typeof contentNamespaceForContentMain.registerActionHandler === "function";
    const hasToastForContentMain =
      contentNamespaceForContentMain.ui &&
      contentNamespaceForContentMain.ui.toast &&
      typeof contentNamespaceForContentMain.ui.toast.show === "function";

    return hasClipboardUtilsForContentMain && hasDomUtilsForContentMain && hasToastForContentMain;
  }

  function signalReadyToServiceWorkerForContentMain() {
    if (contentNamespaceForContentMain.state.isReady) {
      return;
    }

    if (!checkReadinessForContentMain()) {
      return;
    }

    if (!isContextValidForContentMain()) {
      return;
    }

    contentNamespaceForContentMain.state.isReady = true;

    chrome.runtime.sendMessage(
      { action: actionsForContentMain.contentScriptReady || "contentScriptReady" },
      () => {
        if (chrome.runtime.lastError) {
          // Service worker might not be ready yet, ignore
        }
      }
    );
  }

  function pingServiceWorkerForContentMain() {
    if (!contentNamespaceForContentMain.state.isReady) {
      return;
    }

    if (contentNamespaceForContentMain.state.contextInvalidatedForContentMain) {
      return;
    }

    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        contentNamespaceForContentMain.state.contextInvalidatedForContentMain = true;
        return;
      }
    } catch (errForContentMain) {
      contentNamespaceForContentMain.state.contextInvalidatedForContentMain = true;
      return;
    }

    chrome.runtime.sendMessage({ action: actionsForContentMain.ping || "ping" }, () => {
      if (chrome.runtime.lastError) {
        // Service worker might not be ready yet, ignore
      }
    });
  }

  // Feature flag: must match the value in background/service-worker.js.
  var USE_STORAGE_BROADCAST_FOR_DB_SYNC = true;
  var DB_CHANGE_SIGNAL_KEY_PREFIX_FOR_CONTENT_MAIN = 'abchat_db_sig_';

  // Capture the generation at injection time. All listeners below compare
  // window.abchatListenerGeneration at call time; a mismatch means a newer injection
  // has run and this instance is stale — listeners return/skip without processing.
  var capturedGenerationForContentMain = window.abchatListenerGeneration || 0;

  chrome.runtime.onMessage.addListener((messageForContentMain, senderForContentMain, sendResponseForContentMain) => {
    // Stale-generation guard. Without this, every re-injection stacks a new onMessage
    // listener. Since cachedResponsesForContentMain is IIFE-local (not shared across
    // injections), each stale listener would independently dispatch the same action,
    // causing tools to toggle on then immediately off (or execute N times after N reloads).
    if ((window.abchatListenerGeneration || 0) !== capturedGenerationForContentMain) {
      return false;
    }

    if (!messageForContentMain || !messageForContentMain.action) {
      return false;
    }

    if (messageForContentMain.action === (actionsForContentMain.checkInjected || "checkInjected")) {
      var hasRuntimeContextForInjectedCheck = hasRuntimeContextForContentMain();
      sendResponseForContentMain({
        injected: hasRuntimeContextForInjectedCheck,
        contextValid: hasRuntimeContextForInjectedCheck,
        protocolVersion: protocolVersionForContentMain,
        ok: hasRuntimeContextForInjectedCheck,
        status: hasRuntimeContextForInjectedCheck
          ? (statusesForContentMain.handled || "handled")
          : (statusesForContentMain.notReady || "notReady"),
        errorCode: hasRuntimeContextForInjectedCheck ? "" : (errorCodesForContentMain.csNotReady || "CS_NOT_READY"),
        errorMessage: hasRuntimeContextForInjectedCheck ? "" : "Content runtime context is not available.",
        retryable: !hasRuntimeContextForInjectedCheck
      });
      return true;
    }

    if (messageForContentMain.action === (actionsForContentMain.checkReady || "checkReady")) {
      const hasRuntimeContextForReadyCheck = hasRuntimeContextForContentMain();
      const isReadyForContentMain = hasRuntimeContextForReadyCheck && checkReadinessForContentMain();
      if (isReadyForContentMain && !contentNamespaceForContentMain.state.isReady) {
        contentNamespaceForContentMain.state.isReady = true;
      }
      sendResponseForContentMain({
        ready: isReadyForContentMain,
        protocolVersion: protocolVersionForContentMain,
        ok: isReadyForContentMain,
        status: isReadyForContentMain ? (statusesForContentMain.handled || "handled") : (statusesForContentMain.notReady || "notReady"),
        errorCode: isReadyForContentMain ? "" : (errorCodesForContentMain.csNotReady || "CS_NOT_READY"),
        errorMessage: isReadyForContentMain
          ? ""
          : (hasRuntimeContextForReadyCheck
            ? "Content script dependencies are not ready."
            : "Content runtime context is not available."),
        retryable: !isReadyForContentMain
      });
      return true;
    }

    if (messageForContentMain.action === (actionsForContentMain.streamCancelDeliver || "streamCancelDeliver")) {
      var panelRuntimeNsForCancelDeliver = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
      if (panelRuntimeNsForCancelDeliver && typeof panelRuntimeNsForCancelDeliver.handleRemoteCancelDeliver === 'function') {
        panelRuntimeNsForCancelDeliver.handleRemoteCancelDeliver(messageForContentMain.chatId);
      }
      return false;
    }

    if (messageForContentMain.action === (actionsForContentMain.streamReceiverDeliver || "streamReceiverDeliver")) {
      var panelRuntimeNsForStreamReceive = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
      if (panelRuntimeNsForStreamReceive && typeof panelRuntimeNsForStreamReceive.handleRemoteStreamEvent === 'function') {
        panelRuntimeNsForStreamReceive.handleRemoteStreamEvent(
          messageForContentMain.event,
          messageForContentMain.chatId,
          messageForContentMain.payload
        );
      }
      return false;
    }

    if (messageForContentMain.action === (actionsForContentMain.panelVisibilityCommand || "panelVisibilityCommand")) {
      var requestedVisibleForPanelCommand = Boolean(messageForContentMain.isOpen);
      var panelStateSyncNsForPanelCommand =
        contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelStateSync;
      if (panelStateSyncNsForPanelCommand && typeof panelStateSyncNsForPanelCommand.applyState === 'function') {
        panelStateSyncNsForPanelCommand.applyState({ isOpen: requestedVisibleForPanelCommand }, new Set(['isOpen']));
      } else {
        var panelUiForPanelCommand = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panel;
        if (panelUiForPanelCommand) {
          if (requestedVisibleForPanelCommand && typeof panelUiForPanelCommand.ensureReady === 'function') {
            panelUiForPanelCommand.ensureReady();
          }
          if (typeof panelUiForPanelCommand.setVisible === 'function') {
            panelUiForPanelCommand.setVisible(requestedVisibleForPanelCommand);
          }
        }
      }
      return false;
    }

    if (messageForContentMain.action === 'dbDataChanged') {
      var storeNameForDbChanged = typeof messageForContentMain.store === 'string' ? messageForContentMain.store : '';
      if (storeNameForDbChanged) {
        var panelRuntimeNsForDbChanged = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
        if (panelRuntimeNsForDbChanged && typeof panelRuntimeNsForDbChanged.refreshStore === 'function') {
          panelRuntimeNsForDbChanged.refreshStore(storeNameForDbChanged);
        }
      }
      return false;
    }

    const requestIdForContentMain =
      typeof messageForContentMain.requestId === "string" ? messageForContentMain.requestId : "";
    if (requestIdForContentMain) {
      const cachedResponseForContentMain = getCachedResponseForContentMain(requestIdForContentMain);
      if (cachedResponseForContentMain) {
        sendResponseForContentMain(cachedResponseForContentMain);
        return true;
      }
    }

    const dispatchResultForContentMain = dispatchActionForContentMain(messageForContentMain.action, messageForContentMain);
    const actionResponseForContentMain = buildActionResponseForContentMain(
      requestIdForContentMain,
      dispatchResultForContentMain
    );
    if (requestIdForContentMain) {
      cacheResponseForContentMain(requestIdForContentMain, actionResponseForContentMain);
    }
    sendResponseForContentMain(actionResponseForContentMain);
    return true;
  });

  if (chrome.storage && chrome.storage.onChanged) {
    var storageChangedHandlerForContentMain = function storageChangedHandlerForContentMain(changesForContentMain, areaNameForContentMain) {
      if ((window.abchatListenerGeneration || 0) !== capturedGenerationForContentMain) {
        chrome.storage.onChanged.removeListener(storageChangedHandlerForContentMain);
        return;
      }
      if (areaNameForContentMain === "sync") {
        if (changesForContentMain.abchatSettings) {
          refreshRuntimeSettingsForContentMain();
        }
        return;
      }
      if (areaNameForContentMain === "local" && USE_STORAGE_BROADCAST_FOR_DB_SYNC) {
        var panelRuntimeNsForStorageSync = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
        if (panelRuntimeNsForStorageSync && typeof panelRuntimeNsForStorageSync.refreshStore === 'function') {
          var repoForStorageSync =
            (globalScopeForContentMain.ABChatShared && globalScopeForContentMain.ABChatShared.panelDataRepo) || null;
          var localSourceIdForStorageSync = repoForStorageSync && typeof repoForStorageSync.getSourceId === 'function'
            ? (repoForStorageSync.getSourceId() || '')
            : '';
          Object.keys(changesForContentMain).forEach(function (keyForStorageSync) {
            if (keyForStorageSync.indexOf(DB_CHANGE_SIGNAL_KEY_PREFIX_FOR_CONTENT_MAIN) !== 0) return;
            var storeForStorageSync = keyForStorageSync.slice(DB_CHANGE_SIGNAL_KEY_PREFIX_FOR_CONTENT_MAIN.length);
            if (!storeForStorageSync) return;
            // Self-echo skip: storage.onChanged fires on the writing tab too.
            // The SW now stamps an originator sourceId into the signal record;
            // if it matches this tab's, we already refreshed in-process and
            // can ignore the storage echo.
            // Tolerate legacy primitive values (pre-sourceId records).
            var changeEntryForStorageSync = changesForContentMain[keyForStorageSync];
            var newValueForStorageSync = changeEntryForStorageSync ? changeEntryForStorageSync.newValue : null;
            var incomingSourceIdForStorageSync = '';
            var opsForStorageSync = null;
            if (newValueForStorageSync && typeof newValueForStorageSync === 'object') {
              incomingSourceIdForStorageSync = typeof newValueForStorageSync.sourceId === 'string'
                ? newValueForStorageSync.sourceId
                : '';
              // Pass through the record-level ops payload when present. An
              // empty array (or missing array) signals "no per-id info; do a
              // full refresh", which is the same semantic as the manual sync
              // button. Anything containing a 'bulk' marker also forces full
              // refresh on the panelRuntime side.
              if (Array.isArray(newValueForStorageSync.ops)) {
                opsForStorageSync = newValueForStorageSync.ops;
              }
            }
            if (incomingSourceIdForStorageSync && localSourceIdForStorageSync &&
                incomingSourceIdForStorageSync === localSourceIdForStorageSync) {
              return;
            }
            panelRuntimeNsForStorageSync.refreshStore(storeForStorageSync, opsForStorageSync);
          });
        }
      }
    };
    chrome.storage.onChanged.addListener(storageChangedHandlerForContentMain);
  }

  if (document && typeof document.addEventListener === "function") {
    // Generation guard: only the current injection should ping the service worker.
    // This is a silent background health check — pingServiceWorkerForContentMain()
    // intentionally does NOT call isContextValidForContentMain() here, so no toast
    // is shown when the user switches back to a tab after a reload.
    document.addEventListener("visibilitychange", () => {
      if ((window.abchatListenerGeneration || 0) !== capturedGenerationForContentMain) {
        return;
      }
      if (document.visibilityState === "visible") {
        pingServiceWorkerForContentMain();
        var panelRuntimeNsForVisibility = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
        if (panelRuntimeNsForVisibility && typeof panelRuntimeNsForVisibility.refreshStore === 'function') {
          panelRuntimeNsForVisibility.refreshStore('chats');
          panelRuntimeNsForVisibility.refreshStore('notes');
          panelRuntimeNsForVisibility.refreshStore('tasks');
          panelRuntimeNsForVisibility.refreshStore('questions');
        }
      }
    });
  }

  if (typeof contentNamespaceForContentMain.registerActionHandler === 'function') {
    contentNamespaceForContentMain.registerActionHandler(
      actionsForContentMain.addImageToChat || 'addImageToChat',
      function handleAddImageToChatForContentMain(payloadForContentMain) {
        var innerPayloadForContentMain = payloadForContentMain && payloadForContentMain.payload
          ? payloadForContentMain.payload
          : (payloadForContentMain || {});
        var srcUrlForContentMain = typeof innerPayloadForContentMain.srcUrl === 'string'
          ? innerPayloadForContentMain.srcUrl
          : '';

        var floatingPanelNsForAddImage = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.floatingPanel;
        if (floatingPanelNsForAddImage && typeof floatingPanelNsForAddImage.open === 'function') {
          floatingPanelNsForAddImage.open();
        }

        // Defer chip-adding until the panel is actually visible so that
        // panelRuntime.initialize() has had a chance to set the _exposed relay.
        var panelUiNsForAddImage = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panel;
        if (!panelUiNsForAddImage || typeof panelUiNsForAddImage.whenVisible !== 'function') return;
        panelUiNsForAddImage.whenVisible(function () {
          var panelRuntimeNsForAddImage = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
          if (panelRuntimeNsForAddImage && typeof panelRuntimeNsForAddImage.addImageChipFromContextMenu === 'function') {
            panelRuntimeNsForAddImage.addImageChipFromContextMenu(srcUrlForContentMain);
          }
        });
      }
    );

    contentNamespaceForContentMain.registerActionHandler(
      actionsForContentMain.addSelectionToChat || 'addSelectionToChat',
      function handleAddSelectionToChatForContentMain(payloadForContentMain) {
        var innerPayloadForContentMain = payloadForContentMain && payloadForContentMain.payload
          ? payloadForContentMain.payload
          : (payloadForContentMain || {});
        var textForContentMain = typeof innerPayloadForContentMain.selectedText === 'string'
          ? innerPayloadForContentMain.selectedText
          : '';

        var floatingPanelNsForAddSelection = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.floatingPanel;
        if (floatingPanelNsForAddSelection && typeof floatingPanelNsForAddSelection.open === 'function') {
          floatingPanelNsForAddSelection.open();
        }

        var panelUiNsForAddSelection = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panel;
        if (!panelUiNsForAddSelection || typeof panelUiNsForAddSelection.whenVisible !== 'function') return;
        panelUiNsForAddSelection.whenVisible(function () {
          var panelRuntimeNsForAddSelection = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.panelRuntime;
          if (panelRuntimeNsForAddSelection && typeof panelRuntimeNsForAddSelection.addTextChipFromContextMenu === 'function') {
            panelRuntimeNsForAddSelection.addTextChipFromContextMenu(textForContentMain);
          }
        });
      }
    );
  }

  contentNamespaceForContentMain.registerActionHandler(
    'playReminderSound',
    function handlePlayReminderSoundForContentMain(payloadForContentMain) {
      var taskTitleForReminder = (payloadForContentMain && typeof payloadForContentMain.taskTitle === 'string')
        ? payloadForContentMain.taskTitle
        : 'Task reminder';
      var toastNsForReminder = contentNamespaceForContentMain.ui && contentNamespaceForContentMain.ui.toast;
      if (toastNsForReminder && typeof toastNsForReminder.show === 'function') {
        toastNsForReminder.show('Reminder: ' + taskTitleForReminder);
      }
    }
  );

  refreshRuntimeSettingsForContentMain();

  setTimeout(() => {
    signalReadyToServiceWorkerForContentMain();
  }, 100);

  globalScopeForContentMain.ABChatContent = contentNamespaceForContentMain;
})();
