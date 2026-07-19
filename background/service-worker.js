importScripts(
  "../lib/dexie.min.js",
  "../shared/db.js",
  "./panelDataRepoImpl.js",
  "./apiLoggerImpl.js",
  "../shared/messages.js",
  "../agent/fileParsing.js",
  "../shared/toolRegistry.js",
  "../shared/domainConfig.js",
  "../shared/storage.js",
  "./tabMessaging.js",
  "./contextMenus.js",
  "./commands.js",
  "./dbHandler.js",
  "./cdpAutomation.js"
);

const sharedNamespaceForServiceWorker = globalThis.ABChatShared || {};
const backgroundNamespaceForServiceWorker = globalThis.ABChatBackground || {};
const messageTypesForServiceWorker = sharedNamespaceForServiceWorker.messageTypes || {};
const actionsForServiceWorker = sharedNamespaceForServiceWorker.actions || {};
const communicationForServiceWorker = sharedNamespaceForServiceWorker.communication || {};
const errorCodesForServiceWorker = communicationForServiceWorker.errorCodes || {};
const toolRegistryForServiceWorker = sharedNamespaceForServiceWorker.toolRegistry;
const storageManagerForServiceWorker = sharedNamespaceForServiceWorker.storageManager;
const tabMessagingForServiceWorker = backgroundNamespaceForServiceWorker.tabMessaging;
const contextMenusForServiceWorker = backgroundNamespaceForServiceWorker.contextMenus;
const commandsForServiceWorker = backgroundNamespaceForServiceWorker.commands;
const dbHandlerForServiceWorker = backgroundNamespaceForServiceWorker.dbHandler;
const cdpAutomationForServiceWorker = backgroundNamespaceForServiceWorker.cdpAutomation || {};
const agentNamespaceForServiceWorker = globalThis.ABChatAgent || {};
const fileParsingForServiceWorker = agentNamespaceForServiceWorker.fileParsing || {};
const runtimeRequestResponseCacheForServiceWorker = new Map();

function dataUrlToUint8ForServiceWorker(dataUrlForServiceWorker) {
  var rawForServiceWorker = String(dataUrlForServiceWorker || '');
  var commaIndexForServiceWorker = rawForServiceWorker.indexOf(',');
  var base64ForServiceWorker = commaIndexForServiceWorker >= 0
    ? rawForServiceWorker.slice(commaIndexForServiceWorker + 1)
    : rawForServiceWorker;
  var binaryForServiceWorker = atob(base64ForServiceWorker);
  var lengthForServiceWorker = binaryForServiceWorker.length;
  var bytesForServiceWorker = new Uint8Array(lengthForServiceWorker);
  for (var byteIndexForServiceWorker = 0; byteIndexForServiceWorker < lengthForServiceWorker; byteIndexForServiceWorker++) {
    bytesForServiceWorker[byteIndexForServiceWorker] = binaryForServiceWorker.charCodeAt(byteIndexForServiceWorker);
  }
  return bytesForServiceWorker;
}
const runtimeRequestInflightForServiceWorker = new Map();
const runtimeRequestResponseCacheTtlMsForServiceWorker = 10000;
const runtimeRequestInflightMaxAgeMsForServiceWorker = 30000;
// Time-gated periodic cleanup state. Service workers cannot use setInterval reliably
// (the SW may be suspended between messages). Instead, each incoming message checks
// whether enough time has elapsed and runs cleanup if so. This prevents unbounded
// growth of the runtime request cache and the web-fetch DB cache across long sessions.
// SCALABILITY: if you add another cache, add its own lastXxxAt + intervalMs pair here
// and a matching time-gated block in the onMessage handler below.
let lastPeriodicPruneAtMsForServiceWorker = 0;
const periodicPruneIntervalMsForServiceWorker = 60 * 1000;
const periodicWebFetchCleanIntervalMsForServiceWorker = 10 * 60 * 1000;
let lastWebFetchCleanAtMsForServiceWorker = 0;
const startupRecoverySessionKeyForServiceWorker = "abchatStartupRecoveryCompletedForSession";
const webFetchCacheTtlMsForServiceWorker = 15 * 60 * 1000;
const cancellableAgentToolRequestsForServiceWorker = new Map();
const panelVisibilityFieldKeyForServiceWorker = "abchat_panel_ui_state_field_isOpen";
const legacyPanelUiStateKeyForServiceWorker = "abchat_panel_ui_state";
let desiredPanelOpenForServiceWorker = null;
let panelVisibilityEnforceSeqForServiceWorker = 0;
// Background-mediated active-tab tracking. A single "currently active tab" id
// that survives the browser losing OS-level focus to another app (focusChanged
// to WINDOW_ID_NONE is ignored). Content scripts use the pushed value to gate
// cross-tab state sync, rather than document.hasFocus() which flips false the
// moment any other app takes focus, even partially.
let currentActiveTabIdForServiceWorker = null;

function pushActiveTabStatusForServiceWorker(tabIdForActiveTabPush, isActiveForActiveTabPush) {
  if (typeof tabIdForActiveTabPush !== "number") return;
  try {
    chrome.tabs.sendMessage(
      tabIdForActiveTabPush,
      {
        action: actionsForServiceWorker.activeTabChanged || "activeTabChanged",
        isActive: Boolean(isActiveForActiveTabPush)
      },
      function () { void chrome.runtime.lastError; }
    );
  } catch (errorForActiveTabPush) {}
}

function setCurrentActiveTabForServiceWorker(nextTabIdForActiveTab) {
  var normalizedNextForActiveTab = typeof nextTabIdForActiveTab === "number" ? nextTabIdForActiveTab : null;
  if (normalizedNextForActiveTab === currentActiveTabIdForServiceWorker) return;
  var previousTabIdForActiveTab = currentActiveTabIdForServiceWorker;
  currentActiveTabIdForServiceWorker = normalizedNextForActiveTab;
  if (typeof previousTabIdForActiveTab === "number") {
    pushActiveTabStatusForServiceWorker(previousTabIdForActiveTab, false);
  }
  if (typeof normalizedNextForActiveTab === "number") {
    pushActiveTabStatusForServiceWorker(normalizedNextForActiveTab, true);
  }
}

function setActiveTabFromWindowForServiceWorker(windowIdForActiveTab) {
  if (typeof windowIdForActiveTab !== "number" || windowIdForActiveTab === chrome.windows.WINDOW_ID_NONE) return;
  try {
    chrome.tabs.query({ active: true, windowId: windowIdForActiveTab }, function (tabsForActiveTab) {
      if (chrome.runtime.lastError) return;
      if (!Array.isArray(tabsForActiveTab) || tabsForActiveTab.length === 0) return;
      var tabForActiveTab = tabsForActiveTab[0];
      if (!tabForActiveTab || typeof tabForActiveTab.id !== "number") return;
      setCurrentActiveTabForServiceWorker(tabForActiveTab.id);
    });
  } catch (errorForActiveTab) {}
}

function initActiveTabTrackingForServiceWorker() {
  try {
    chrome.windows.getLastFocused({}, function (windowForActiveTabInit) {
      if (chrome.runtime.lastError || !windowForActiveTabInit) return;
      if (windowForActiveTabInit.id === chrome.windows.WINDOW_ID_NONE) return;
      setActiveTabFromWindowForServiceWorker(windowForActiveTabInit.id);
    });
  } catch (errorForActiveTabInit) {}
}

function registerCancellableAgentToolRequestForServiceWorker(requestId) {
  if (!requestId || typeof requestId !== 'string') return null;
  var controllerForToolRequest = new AbortController();
  var recordForToolRequest = {
    requestId: requestId,
    controller: controllerForToolRequest,
    signal: controllerForToolRequest.signal,
    finished: false
  };
  cancellableAgentToolRequestsForServiceWorker.set(requestId, recordForToolRequest);
  return recordForToolRequest;
}

function finishCancellableAgentToolRequestForServiceWorker(recordForToolRequest) {
  if (!recordForToolRequest || recordForToolRequest.finished) return;
  recordForToolRequest.finished = true;
  cancellableAgentToolRequestsForServiceWorker.delete(recordForToolRequest.requestId);
}

function wrapCancellableSendResponseForServiceWorker(sendResponseForToolRequest, recordForToolRequest) {
  return function wrappedSendResponseForToolRequest(responseForToolRequest) {
    finishCancellableAgentToolRequestForServiceWorker(recordForToolRequest);
    sendResponseForToolRequest(responseForToolRequest);
  };
}

function cancelAgentToolRequestForServiceWorker(requestId) {
  if (!requestId || typeof requestId !== 'string') return false;
  var recordForToolRequest = cancellableAgentToolRequestsForServiceWorker.get(requestId);
  if (!recordForToolRequest) return false;
  try {
    recordForToolRequest.controller.abort();
  } catch (e) {}
  return true;
}

function isSupportedPanelTabForServiceWorker(tabForPanelVisibility) {
  if (!tabForPanelVisibility || typeof tabForPanelVisibility.id !== "number") return false;
  if (!tabMessagingForServiceWorker || typeof tabMessagingForServiceWorker.isSupportedUrl !== "function") return true;
  return tabMessagingForServiceWorker.isSupportedUrl(tabForPanelVisibility.url || "");
}

function readDesiredPanelOpenForServiceWorker(callbackForPanelVisibility) {
  // Trust the in-memory value once it is known. The content side sets it via the
  // panelVisibilityChanged notification, which is always sent BEFORE the debounced
  // storage write of the same change, so the in-memory value is never staler than
  // storage (and is fresher during the ~50ms write-debounce window). Re-reading
  // storage here would resolve a just-opened panel as closed within that window:
  // the residual flash race. Storage is consulted only to hydrate the value after a
  // cold service-worker start, while it is still null. desiredPanelOpenForServiceWorker
  // is only ever assigned a boolean (never reset to null), so once set it stays the
  // source of truth until the next explicit open/close notification updates it.
  if (typeof desiredPanelOpenForServiceWorker === "boolean") {
    callbackForPanelVisibility(desiredPanelOpenForServiceWorker);
    return;
  }
  try {
    chrome.storage.local.get(
      [panelVisibilityFieldKeyForServiceWorker, legacyPanelUiStateKeyForServiceWorker],
      function (resForPanelVisibility) {
        var desiredForPanelVisibility = false;
        var fieldRecordForPanelVisibility = resForPanelVisibility && resForPanelVisibility[panelVisibilityFieldKeyForServiceWorker];
        if (
          fieldRecordForPanelVisibility &&
          typeof fieldRecordForPanelVisibility === "object" &&
          typeof fieldRecordForPanelVisibility.value === "boolean"
        ) {
          desiredForPanelVisibility = fieldRecordForPanelVisibility.value;
        } else {
          var legacyStateForPanelVisibility = resForPanelVisibility && resForPanelVisibility[legacyPanelUiStateKeyForServiceWorker];
          if (legacyStateForPanelVisibility && typeof legacyStateForPanelVisibility.isOpen === "boolean") {
            desiredForPanelVisibility = legacyStateForPanelVisibility.isOpen;
          }
        }
        desiredPanelOpenForServiceWorker = desiredForPanelVisibility;
        callbackForPanelVisibility(desiredForPanelVisibility);
      }
    );
  } catch (errorForPanelVisibility) {
    callbackForPanelVisibility(Boolean(desiredPanelOpenForServiceWorker));
  }
}

function getActiveFocusedTabForPanelVisibilityForServiceWorker(callbackForPanelVisibility) {
  try {
    chrome.windows.getLastFocused({}, function (windowForPanelVisibility) {
      if (
        chrome.runtime.lastError ||
        !windowForPanelVisibility ||
        windowForPanelVisibility.id === chrome.windows.WINDOW_ID_NONE ||
        windowForPanelVisibility.focused === false
      ) {
        callbackForPanelVisibility(null);
        return;
      }
      chrome.tabs.query({ active: true, windowId: windowForPanelVisibility.id }, function (tabsForPanelVisibility) {
        if (chrome.runtime.lastError || !Array.isArray(tabsForPanelVisibility) || tabsForPanelVisibility.length === 0) {
          callbackForPanelVisibility(null);
          return;
        }
        callbackForPanelVisibility(tabsForPanelVisibility[0] || null);
      });
    });
  } catch (errorForPanelVisibility) {
    callbackForPanelVisibility(null);
  }
}

function sendPanelVisibilityCommandForServiceWorker(tabIdForPanelVisibility, isOpenForPanelVisibility) {
  if (typeof tabIdForPanelVisibility !== "number") return;
  try {
    chrome.tabs.sendMessage(
      tabIdForPanelVisibility,
      {
        action: actionsForServiceWorker.panelVisibilityCommand || "panelVisibilityCommand",
        isOpen: Boolean(isOpenForPanelVisibility)
      },
      function () {
        void chrome.runtime.lastError;
      }
    );
  } catch (errorForPanelVisibility) {}
}

function closePanelInTabsExceptForServiceWorker(activeTabIdForPanelVisibility) {
  try {
    chrome.tabs.query({}, function (tabsForPanelVisibility) {
      if (!Array.isArray(tabsForPanelVisibility)) return;
      tabsForPanelVisibility.forEach(function (tabForPanelVisibility) {
        if (!isSupportedPanelTabForServiceWorker(tabForPanelVisibility)) return;
        if (typeof activeTabIdForPanelVisibility === "number" && tabForPanelVisibility.id === activeTabIdForPanelVisibility) return;
        sendPanelVisibilityCommandForServiceWorker(tabForPanelVisibility.id, false);
      });
    });
  } catch (errorForPanelVisibility) {}
}

function openPanelInActiveTabForServiceWorker(tabForPanelVisibility, enforceSeqForPanelVisibility) {
  if (!isSupportedPanelTabForServiceWorker(tabForPanelVisibility)) return;
  if (!tabMessagingForServiceWorker || typeof tabMessagingForServiceWorker.ensureContentInjected !== "function") {
    if (enforceSeqForPanelVisibility !== panelVisibilityEnforceSeqForServiceWorker) return;
    sendPanelVisibilityCommandForServiceWorker(tabForPanelVisibility.id, true);
    return;
  }
  tabMessagingForServiceWorker.ensureContentInjected(tabForPanelVisibility.id)
    .then(function (isInjectedForPanelVisibility) {
      if (!isInjectedForPanelVisibility) return;
      if (enforceSeqForPanelVisibility !== panelVisibilityEnforceSeqForServiceWorker) return;
      sendPanelVisibilityCommandForServiceWorker(tabForPanelVisibility.id, true);
    })
    .catch(function () {});
}

function enforceSingleVisiblePanelForServiceWorker(desiredOpenForPanelVisibility) {
  panelVisibilityEnforceSeqForServiceWorker += 1;
  var enforceSeqForPanelVisibility = panelVisibilityEnforceSeqForServiceWorker;
  desiredPanelOpenForServiceWorker = Boolean(desiredOpenForPanelVisibility);
  if (!desiredPanelOpenForServiceWorker) {
    closePanelInTabsExceptForServiceWorker(null);
    return;
  }
  getActiveFocusedTabForPanelVisibilityForServiceWorker(function (activeTabForPanelVisibility) {
    if (enforceSeqForPanelVisibility !== panelVisibilityEnforceSeqForServiceWorker) return;
    if (!isSupportedPanelTabForServiceWorker(activeTabForPanelVisibility)) {
      closePanelInTabsExceptForServiceWorker(null);
      return;
    }
    closePanelInTabsExceptForServiceWorker(activeTabForPanelVisibility.id);
    openPanelInActiveTabForServiceWorker(activeTabForPanelVisibility, enforceSeqForPanelVisibility);
  });
}

function enforceStoredPanelVisibilityForServiceWorker() {
  if (typeof desiredPanelOpenForServiceWorker === "boolean") {
    enforceSingleVisiblePanelForServiceWorker(desiredPanelOpenForServiceWorker);
    return;
  }
  readDesiredPanelOpenForServiceWorker(function (desiredOpenForPanelVisibility) {
    enforceSingleVisiblePanelForServiceWorker(desiredOpenForPanelVisibility);
  });
}

function delayForServiceWorker(ms, signalForDelay) {
  return new Promise(function (resolve) {
    if (signalForDelay && signalForDelay.aborted) {
      resolve();
      return;
    }
    var delayTimerForServiceWorker = setTimeout(resolve, ms);
    if (signalForDelay) {
      signalForDelay.addEventListener('abort', function () {
        clearTimeout(delayTimerForServiceWorker);
        resolve();
      }, { once: true });
    }
  });
}

async function getWebFetchCacheEntryForServiceWorker(url) {
  try {
    var db = globalThis.ABChatShared && globalThis.ABChatShared.db;
    if (!db) return null;
    var entry = await db.webFetchCache.get(url);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      db.webFetchCache.delete(url).catch(function () {});
      return null;
    }
    return entry.data;
  } catch (e) {
    return null;
  }
}

async function setWebFetchCacheEntryForServiceWorker(url, data) {
  try {
    var db = globalThis.ABChatShared && globalThis.ABChatShared.db;
    if (!db) return;
    await db.webFetchCache.put({ url: url, data: data, expiresAt: Date.now() + webFetchCacheTtlMsForServiceWorker });
  } catch (e) {}
}

async function cleanExpiredWebFetchCacheForServiceWorker() {
  try {
    var db = globalThis.ABChatShared && globalThis.ABChatShared.db;
    if (!db) return;
    var now = Date.now();
    await db.webFetchCache.filter(function (entry) { return entry.expiresAt < now; }).delete();
  } catch (e) {}
}
const academicDomainsForServiceWorker = [
  'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'scholar.google.com',
  'semanticscholar.org', 'jstor.org', 'researchgate.net', 'biorxiv.org', 'medrxiv.org',
  'ssrn.com', 'ieeexplore.ieee.org', 'ieee.org', 'dl.acm.org', 'acm.org',
  'nature.com', 'science.org', 'cell.com', 'nejm.org', 'bmj.com', 'thelancet.com',
  'plos.org', 'frontiersin.org', 'mdpi.com', 'pnas.org',
  'link.springer.com', 'springer.com', 'onlinelibrary.wiley.com', 'wiley.com',
  'tandfonline.com', 'journals.sagepub.com', 'academic.oup.com', 'oup.com',
  'journals.cambridge.org', 'cambridge.org', 'royalsocietypublishing.org'
];
let isReloadRecoveryRunningForServiceWorker = false;

// ---------------------------------------------------------------------------
// Live-stream snapshots for cross-tab catch-up. Map<chatId, snapshot> where
// snapshot = {
//   originatorTabId,         // tab that owns the AbortController
//   accText,                 // cumulative text from current iteration
//   toolCalls,               // most recent tool_calls array (per-iteration)
//   toolStatuses,            // { [toolCallId]: { status, statusText } }
//   retryNotice              // { attempt, maxAttempts } | null
// }
// In-memory only. If the SW terminates mid-stream, the next originator event
// re-populates the entry. Cleared on stream_end.
// ---------------------------------------------------------------------------
const streamSnapshotsForServiceWorker = new Map();

// chatId -> targetTabId for runs hosted in the offscreen document. The offscreen doc
// has no sender.tab, so the SW records which tab each run targets (from the initiator's
// agentRunStart) and uses it to: stamp the snapshot's originatorTabId, relay page-DOM
// tool calls (delegatePageTool) to the right tab, and (deliberately) NOT kill the run
// when that tab navigates/reloads. Cleared on stream_end.
const offscreenRunTargetTabsForServiceWorker = new Map();

// chatId -> initiatorTabId: the tab whose panel started the run. Unlike the target map above,
// this is fixed at run start and never changes when the agent switches tabs mid-run. It is
// used to stamp the stream's originatorTabId (so the live turn always renders in the panel
// that started it, not wherever the agent happens to be acting) and as the fallback target
// when the agent closes the tab it is currently acting on. Cleared on stream_end.
const offscreenRunInitiatorTabsForServiceWorker = new Map();

// chatId -> Set of tab ids the agent created via create_tab during this chat. This is the
// authorization boundary for close_tab: the agent may only close a tab it opened itself.
// Persisted in chrome.storage.session (survives an MV3 service-worker recycle, auto-clears on
// browser restart when tab ids are meaningless anyway); this in-memory copy is a fast cache.
const AGENT_CREATED_TABS_SESSION_PREFIX_FOR_SERVICE_WORKER = "abchatCreatedTabs:";

// Tell the CDP layer to keep the debugger attached across a navigation on any tab that is
// the target of an active offscreen run. Without this, the navigation force-detach (added to
// drop a stranded infobar when the LEGACY content-script loop dies on navigation) would also
// fire mid-run for the offscreen loop, which survives the navigation and still needs the
// session to drive the new page. The offscreen loop releases the lease itself at run end.
if (cdpAutomationForServiceWorker && typeof cdpAutomationForServiceWorker.setNavigationSurvivalPredicate === "function") {
  cdpAutomationForServiceWorker.setNavigationSurvivalPredicate(function (tabIdForSurvival) {
    if (typeof tabIdForSurvival !== "number") return false;
    let survivesForPredicate = false;
    offscreenRunTargetTabsForServiceWorker.forEach(function (targetTabIdForPredicate) {
      if (targetTabIdForPredicate === tabIdForSurvival) survivesForPredicate = true;
    });
    return survivesForPredicate;
  });
}

function updateStreamSnapshotForServiceWorker(eventForSnapshot, chatIdForSnapshot, payloadForSnapshot, senderTabIdForSnapshot) {
  const numericChatIdForSnapshot = Number(chatIdForSnapshot);
  if (!Number.isFinite(numericChatIdForSnapshot)) return;

  if (eventForSnapshot === "stream_end") {
    streamSnapshotsForServiceWorker.delete(numericChatIdForSnapshot);
    return;
  }

  let snapshotForUpdate = streamSnapshotsForServiceWorker.get(numericChatIdForSnapshot);
  if (!snapshotForUpdate) {
    snapshotForUpdate = {
      originatorTabId: senderTabIdForSnapshot,
      accText: "",
      toolCalls: [],
      toolStatuses: {},
      retryNotice: null
    };
    streamSnapshotsForServiceWorker.set(numericChatIdForSnapshot, snapshotForUpdate);
  }
  // Always refresh originatorTabId on each event in case the SW restarted
  // between events and the original sender id was lost.
  if (senderTabIdForSnapshot != null) {
    snapshotForUpdate.originatorTabId = senderTabIdForSnapshot;
  }

  if (eventForSnapshot === "stream_start") {
    snapshotForUpdate.accText = "";
    snapshotForUpdate.toolCalls = [];
    snapshotForUpdate.toolStatuses = {};
    snapshotForUpdate.retryNotice = null;
    return;
  }
  if (eventForSnapshot === "stream_text" && payloadForSnapshot && typeof payloadForSnapshot.accText === "string") {
    snapshotForUpdate.accText = payloadForSnapshot.accText;
    return;
  }
  if (eventForSnapshot === "stream_tool_steps" && payloadForSnapshot && Array.isArray(payloadForSnapshot.toolCalls)) {
    // tool_calls comes once per iteration on the originator; we replace
    // entirely so the snapshot mirrors the current iteration's chip row.
    snapshotForUpdate.toolCalls = payloadForSnapshot.toolCalls;
    snapshotForUpdate.toolStatuses = {};
    return;
  }
  if (eventForSnapshot === "stream_tool_step_status" && payloadForSnapshot && payloadForSnapshot.toolCallId) {
    snapshotForUpdate.toolStatuses[payloadForSnapshot.toolCallId] = {
      status: payloadForSnapshot.status,
      statusText: payloadForSnapshot.statusText || ""
    };
    return;
  }
  if (eventForSnapshot === "stream_retry_notice" && payloadForSnapshot) {
    snapshotForUpdate.retryNotice = {
      attempt: Number(payloadForSnapshot.attempt),
      maxAttempts: Number(payloadForSnapshot.maxAttempts)
    };
    return;
  }
  if (eventForSnapshot === "stream_message_persisted") {
    // Iteration boundary: the originator resets bubble text + tool chips for
    // the next iteration. Mirror that so a late-joining tab doesn't see stale
    // text/chips from a previous iteration.
    snapshotForUpdate.accText = "";
    snapshotForUpdate.toolCalls = [];
    snapshotForUpdate.toolStatuses = {};
    snapshotForUpdate.retryNotice = null;
    return;
  }
}

// Feature flag: when true, DB change notifications are broadcast via chrome.storage.local
// (storage.onChanged in content scripts) instead of chrome.tabs.sendMessage.
// Set to the same value in content/main.js.
const USE_STORAGE_BROADCAST_FOR_DB_SYNC = true;
const DB_CHANGE_SIGNAL_KEY_PREFIX_FOR_SERVICE_WORKER = 'abchat_db_sig_';

const dbOpMutationStoreMapForServiceWorker = {
  createChat:                   'chats',
  updateChat:                   'chats',
  deleteChat:                   'chats',
  deleteChatsOlderThan:         'chats',
  createMessage:                'chats',
  updateMessage:                'chats',
  bulkReplaceMessagesFromIndex: 'chats',
  createNote:                   'notes',
  updateNote:                   'notes',
  deleteNote:                   'notes',
  createTask:                   'tasks',
  updateTask:                   'tasks',
  toggleTaskCompleted:          'tasks',
  deleteTask:                   'tasks',
  createQuestion:               'questions',
  updateQuestion:               'questions',
  deleteQuestion:               'questions'
};

// Per-mutation extractors that turn the dbOp result + args into ops describing
// which record-level changes the receiver should apply.
//
// Op shape: { op: 'create' | 'update' | 'delete', id: <number> } | { op: 'bulk' }
//
// 'bulk' is a sentinel that tells receivers to fall back to a full-list
// refresh — used for multi-row mutations where a per-id payload would be
// either misleading (deleteChatsOlderThan) or unbounded.
//
// REGRESSION RISK: when a new mutating function is added to
// dbOpMutationStoreMapForServiceWorker above, also add an extractor here.
// Without one, the receiver sees an empty ops array and falls back to a full
// refresh (correct but slow); with one, the receiver applies the change
// surgically.
const dbOpRecordExtractorForServiceWorker = {
  createChat: function (resultForExtractor) {
    if (!resultForExtractor || resultForExtractor.id == null) return [];
    return [{ op: 'create', id: Number(resultForExtractor.id) }];
  },
  updateChat: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: idForExtractor }];
  },
  deleteChat: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'delete', id: idForExtractor }];
  },
  deleteChatsOlderThan: function () {
    // Multiple chat ids deleted at once; receivers fall back to full refresh.
    return [{ op: 'bulk' }];
  },
  createMessage: function (resultForExtractor, argsForExtractor) {
    // Affects the chat row (its updatedAt + derived summary). Receivers
    // only need a chat-level update; the active-chat re-render handles
    // per-message work downstream if the receiver is viewing the chat.
    var chatIdForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(chatIdForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: chatIdForExtractor }];
  },
  updateMessage: function (resultForExtractor) {
    if (!resultForExtractor || resultForExtractor.chatId == null) {
      return [{ op: 'bulk' }];
    }
    var chatIdForExtractor = Number(resultForExtractor.chatId);
    if (!Number.isFinite(chatIdForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: chatIdForExtractor }];
  },
  bulkReplaceMessagesFromIndex: function (resultForExtractor, argsForExtractor) {
    var chatIdForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(chatIdForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: chatIdForExtractor }];
  },
  createNote: function (resultForExtractor) {
    if (!resultForExtractor || resultForExtractor.id == null) return [];
    return [{ op: 'create', id: Number(resultForExtractor.id) }];
  },
  updateNote: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: idForExtractor }];
  },
  deleteNote: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'delete', id: idForExtractor }];
  },
  createTask: function (resultForExtractor) {
    if (!resultForExtractor || resultForExtractor.id == null) return [];
    return [{ op: 'create', id: Number(resultForExtractor.id) }];
  },
  updateTask: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: idForExtractor }];
  },
  toggleTaskCompleted: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: idForExtractor }];
  },
  deleteTask: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'delete', id: idForExtractor }];
  },
  createQuestion: function (resultForExtractor) {
    if (!resultForExtractor || resultForExtractor.id == null) return [];
    return [{ op: 'create', id: Number(resultForExtractor.id) }];
  },
  updateQuestion: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'update', id: idForExtractor }];
  },
  deleteQuestion: function (resultForExtractor, argsForExtractor) {
    var idForExtractor = Number(argsForExtractor[0]);
    if (!Number.isFinite(idForExtractor)) return [{ op: 'bulk' }];
    return [{ op: 'delete', id: idForExtractor }];
  }
};

// Cap on ops carried in a single coalesced signal. Beyond this the pending
// array is collapsed to a 'bulk' marker — receivers fall back to a full
// refresh, which is cheaper than serialising / applying hundreds of small
// ops individually.
const MAX_OPS_PER_SIGNAL_FOR_SERVICE_WORKER = 50;

function pruneRuntimeRequestCachesForServiceWorker() {
  const nowForServiceWorker = Date.now();
  runtimeRequestResponseCacheForServiceWorker.forEach((entryForServiceWorker, keyForServiceWorker) => {
    if (
      !entryForServiceWorker ||
      nowForServiceWorker - entryForServiceWorker.createdAtMs > runtimeRequestResponseCacheTtlMsForServiceWorker
    ) {
      runtimeRequestResponseCacheForServiceWorker.delete(keyForServiceWorker);
    }
  });
  runtimeRequestInflightForServiceWorker.forEach((entryForServiceWorker, keyForServiceWorker) => {
    if (
      !entryForServiceWorker ||
      nowForServiceWorker - entryForServiceWorker.createdAtMs > runtimeRequestInflightMaxAgeMsForServiceWorker
    ) {
      runtimeRequestInflightForServiceWorker.delete(keyForServiceWorker);
    }
  });
}

function buildRuntimeRequestKeyForServiceWorker(requestIdForServiceWorker, senderForServiceWorker) {
  const senderTabIdForServiceWorker =
    senderForServiceWorker &&
    senderForServiceWorker.tab &&
    typeof senderForServiceWorker.tab.id === "number"
      ? String(senderForServiceWorker.tab.id)
      : "na";
  const senderFrameIdForServiceWorker =
    senderForServiceWorker && typeof senderForServiceWorker.frameId === "number"
      ? String(senderForServiceWorker.frameId)
      : "na";
  const senderDocumentIdForServiceWorker =
    senderForServiceWorker && senderForServiceWorker.documentId
      ? String(senderForServiceWorker.documentId)
      : "na";
  return [
    requestIdForServiceWorker || "",
    senderTabIdForServiceWorker,
    senderFrameIdForServiceWorker,
    senderDocumentIdForServiceWorker
  ].join("|");
}

async function runActionOnTabForServiceWorker(tabForServiceWorker, actionForServiceWorker, sourceForServiceWorker, actionPayloadForServiceWorker) {
  if (!tabForServiceWorker || typeof tabForServiceWorker.id !== "number" || !actionForServiceWorker) {
    return {
      ok: false,
      error: "Invalid tab or action.",
      errorCode: errorCodesForServiceWorker.invalidRequest || "INVALID_REQUEST"
    };
  }

  if (!tabMessagingForServiceWorker.isSupportedUrl(tabForServiceWorker.url || "")) {
    return {
      ok: false,
      error: "This page does not allow extension scripts.",
      errorCode: errorCodesForServiceWorker.unsupportedUrl || "UNSUPPORTED_URL"
    };
  }

  const mappedToolForServiceWorker = toolRegistryForServiceWorker.getToolByAction(actionForServiceWorker);
  if (!mappedToolForServiceWorker) {
    return {
      ok: false,
      error: "Unknown action.",
      errorCode: errorCodesForServiceWorker.unknownAction || "UNKNOWN_ACTION"
    };
  }

  const globalSettingsForServiceWorker = await storageManagerForServiceWorker.getSettings();
  const isToolEnabledForServiceWorker = Boolean(
    globalSettingsForServiceWorker.enabledTools &&
      globalSettingsForServiceWorker.enabledTools[mappedToolForServiceWorker.id]
  );
  if (!isToolEnabledForServiceWorker) {
    return {
      ok: false,
      error: "Tool is disabled.",
      errorCode: errorCodesForServiceWorker.toolDisabled || "TOOL_DISABLED"
    };
  }

  return tabMessagingForServiceWorker.sendActionToTab(
    tabForServiceWorker.id,
    actionForServiceWorker,
    sourceForServiceWorker || "",
    actionPayloadForServiceWorker
  );
}

async function runActionOnActiveTabForServiceWorker(actionForServiceWorker, sourceForServiceWorker) {
  const activeTabForServiceWorker = await tabMessagingForServiceWorker.queryActiveTab();
  if (!activeTabForServiceWorker) {
    return { ok: false, error: "No active tab found." };
  }
  return runActionOnTabForServiceWorker(activeTabForServiceWorker, actionForServiceWorker, sourceForServiceWorker);
}

async function toggleFloatingPanelFromActionButtonForServiceWorker(tabForServiceWorker) {
  if (!tabForServiceWorker || typeof tabForServiceWorker.id !== "number") {
    return;
  }
  if (!tabMessagingForServiceWorker.isSupportedUrl(tabForServiceWorker.url || "")) {
    return;
  }

  const didInjectForServiceWorker = await tabMessagingForServiceWorker.ensureContentInjected(tabForServiceWorker.id);
  if (!didInjectForServiceWorker) {
    return;
  }

  const isReadyForServiceWorker = await tabMessagingForServiceWorker.checkContentReady(
    tabForServiceWorker.id,
    5
  );
  if (!isReadyForServiceWorker) {
    return;
  }

  await tabMessagingForServiceWorker.sendActionToTab(
    tabForServiceWorker.id,
    actionsForServiceWorker.toggleFloatingPanel || "toggleFloatingPanel",
    "actionButton"
  );
}

async function getTabByIdForServiceWorker(tabIdForServiceWorker) {
  return new Promise((resolveForServiceWorker) => {
    if (typeof tabIdForServiceWorker !== "number") {
      resolveForServiceWorker(null);
      return;
    }

    chrome.tabs.get(tabIdForServiceWorker, (tabForServiceWorker) => {
      if (chrome.runtime.lastError || !tabForServiceWorker) {
        resolveForServiceWorker(null);
        return;
      }
      resolveForServiceWorker(tabForServiceWorker);
    });
  });
}

async function queryTabsForServiceWorker(queryInfoForServiceWorker) {
  return new Promise((resolveForServiceWorker) => {
    chrome.tabs.query(queryInfoForServiceWorker, (tabsForServiceWorker) => {
      resolveForServiceWorker(Array.isArray(tabsForServiceWorker) ? tabsForServiceWorker : []);
    });
  });
}

// ---- Agent-created tab tracking (close_tab authorization boundary) ----
// The set of tab ids the agent opened via create_tab is kept per-chat in chrome.storage.session
// so it survives an MV3 service-worker recycle and spans multiple turns of the same chat, while
// auto-clearing on browser restart (when the ids are meaningless anyway).

function createdTabsSessionKeyForServiceWorker(chatIdForKey) {
  return AGENT_CREATED_TABS_SESSION_PREFIX_FOR_SERVICE_WORKER + String(chatIdForKey);
}

function getAgentCreatedTabsForServiceWorker(chatIdForGet) {
  return new Promise(function (resolveForGet) {
    const keyForGet = createdTabsSessionKeyForServiceWorker(chatIdForGet);
    try {
      chrome.storage.session.get(keyForGet, function (storedForGet) {
        if (chrome.runtime.lastError) { resolveForGet([]); return; }
        const arrForGet = storedForGet && Array.isArray(storedForGet[keyForGet]) ? storedForGet[keyForGet] : [];
        resolveForGet(arrForGet.filter(function (idForGet) { return typeof idForGet === "number"; }));
      });
    } catch (eForGet) { resolveForGet([]); }
  });
}

function setAgentCreatedTabsForServiceWorker(chatIdForSet, tabIdsForSet) {
  return new Promise(function (resolveForSet) {
    const keyForSet = createdTabsSessionKeyForServiceWorker(chatIdForSet);
    const payloadForSet = {};
    payloadForSet[keyForSet] = tabIdsForSet;
    try {
      chrome.storage.session.set(payloadForSet, function () { void chrome.runtime.lastError; resolveForSet(); });
    } catch (eForSet) { resolveForSet(); }
  });
}

async function addAgentCreatedTabForServiceWorker(chatIdForAdd, tabIdForAdd) {
  const existingForAdd = await getAgentCreatedTabsForServiceWorker(chatIdForAdd);
  if (existingForAdd.indexOf(tabIdForAdd) === -1) {
    existingForAdd.push(tabIdForAdd);
    await setAgentCreatedTabsForServiceWorker(chatIdForAdd, existingForAdd);
  }
}

async function removeAgentCreatedTabForServiceWorker(chatIdForRemove, tabIdForRemove) {
  const existingForRemove = await getAgentCreatedTabsForServiceWorker(chatIdForRemove);
  const filteredForRemove = existingForRemove.filter(function (idForRemove) { return idForRemove !== tabIdForRemove; });
  if (filteredForRemove.length !== existingForRemove.length) {
    await setAgentCreatedTabsForServiceWorker(chatIdForRemove, filteredForRemove);
  }
}

// How long switch_tab / create_tab waits for the target tab's panel to confirm it is showing the
// run before returning. The panel may still be initializing right after injection, so this must
// cover a boot window; on timeout the tool returns panel_showing_chat:false and proceeds.
const PANEL_FOLLOW_CONFIRM_TIMEOUT_MS_FOR_SERVICE_WORKER = 3000;

// After the agent foregrounds a tab (switch_tab / create_tab active), force that tab's panel open
// and drive it to the ongoing run so the user sees the agent working there instead of a blank/
// new-chat panel. Resolves with { showing } once the panel confirms it is displaying that chat
// (or on timeout), so the calling tool can gate the next action on the run being visible. The
// panel buffers the request if it arrives before its runtime finished initializing.
function followRunInTabForServiceWorker(tabIdForFollow, chatIdForFollow) {
  return new Promise(function (resolveFollow) {
    if (typeof tabIdForFollow !== "number" || !Number.isFinite(Number(chatIdForFollow))) {
      resolveFollow({ showing: false });
      return;
    }
    var settledFollow = false;
    var timerFollow = setTimeout(function () {
      if (settledFollow) return;
      settledFollow = true;
      resolveFollow({ showing: false, timedOut: true });
    }, PANEL_FOLLOW_CONFIRM_TIMEOUT_MS_FOR_SERVICE_WORKER);
    (async function () {
      try {
        if (tabMessagingForServiceWorker && typeof tabMessagingForServiceWorker.ensureContentInjected === "function") {
          await tabMessagingForServiceWorker.ensureContentInjected(tabIdForFollow);
        }
      } catch (eInjectForFollow) { /* best effort: still try to message an already-injected tab */ }
      try {
        chrome.tabs.sendMessage(
          tabIdForFollow,
          { action: "abchatFollowRunInPanel", chatId: Number(chatIdForFollow), forceOpen: true },
          function (respForFollow) {
            void chrome.runtime.lastError;
            if (settledFollow) return;
            settledFollow = true;
            clearTimeout(timerFollow);
            resolveFollow({ showing: !!(respForFollow && respForFollow.showing) });
          }
        );
      } catch (eSendForFollow) {
        if (settledFollow) return;
        settledFollow = true;
        clearTimeout(timerFollow);
        resolveFollow({ showing: false });
      }
    })();
  });
}

// A click/press can spawn an async navigation that begins just AFTER the synthetic action
// returns its snapshot; hold the page_act result this long to catch it before finishing. Most
// navigations (native submit, plain links) fire quickly, so a short window suffices...
const POST_ACTION_NAV_GRACE_MS_FOR_SERVICE_WORKER = 400;
// ...but a submit-like click (auth/checkout button, a link, an Enter-press) can trigger a
// JS-driven redirect that fires well after the action returns (e.g. a form with action="" that
// navigates from a click handler, or a "Signing in…" delay), so those get a much longer window.
// The cost is only paid when such a click does NOT navigate; a real navigation resolves as soon
// as it starts.
const POST_ACTION_NAV_GRACE_SUBMIT_MS_FOR_SERVICE_WORKER = 3000;
// Cap on waiting for a navigated page to reach "complete" before observing the landed page.
const LANDED_PAGE_SETTLE_TIMEOUT_MS_FOR_SERVICE_WORKER = 6000;

// Labels that read like a form submission or navigation, used to decide whether a click warrants
// the longer post-action navigation grace window.
const NAV_INTENT_NAME_RE_FOR_SERVICE_WORKER = /(sign[\s-]?in|log[\s-]?in|log[\s-]?on|login|sign[\s-]?up|sign[\s-]?out|log[\s-]?out|submit|continue|proceed|check[\s-]?out|place[\s-]?order|\bpay\b|\bnext\b|\bgo\b)/i;

// How long to hold a page_act click/press result waiting for a possible navigation. Returns 0
// for actions that never navigate. Extends the window for links, Enter-presses, and buttons whose
// label reads like a submission, where a JS-driven redirect can land after the action returns.
function computeNavGraceMsForServiceWorker(toolForGrace, argsForGrace, respForGrace) {
  if (toolForGrace !== "page_act") return 0;
  const actionForGrace = String((argsForGrace && argsForGrace.action) || "");
  if (actionForGrace !== "click" && actionForGrace !== "press") return 0;
  if (actionForGrace === "press") {
    const keysForGrace = String((argsForGrace && argsForGrace.keys) || "");
    return /enter/i.test(keysForGrace)
      ? POST_ACTION_NAV_GRACE_SUBMIT_MS_FOR_SERVICE_WORKER
      : POST_ACTION_NAV_GRACE_MS_FOR_SERVICE_WORKER;
  }
  const refForGrace = Number(argsForGrace && argsForGrace.ref);
  const itemsForGrace = (respForGrace && Array.isArray(respForGrace.items)) ? respForGrace.items : [];
  let actedItemForGrace = null;
  for (let iGrace = 0; iGrace < itemsForGrace.length; iGrace++) {
    if (itemsForGrace[iGrace] && Number(itemsForGrace[iGrace].ref) === refForGrace) { actedItemForGrace = itemsForGrace[iGrace]; break; }
  }
  if (actedItemForGrace) {
    if (String(actedItemForGrace.role || "") === "link") return POST_ACTION_NAV_GRACE_SUBMIT_MS_FOR_SERVICE_WORKER;
    if (NAV_INTENT_NAME_RE_FOR_SERVICE_WORKER.test(String(actedItemForGrace.name || ""))) return POST_ACTION_NAV_GRACE_SUBMIT_MS_FOR_SERVICE_WORKER;
  }
  return POST_ACTION_NAV_GRACE_MS_FOR_SERVICE_WORKER;
}

// After a page_act navigates the tab, wait for the landed page to finish loading and run a fresh
// page_observe on it, so the model sees the outcome of its action directly instead of a
// pre-navigation snapshot (or having to re-read a possibly still-loading page itself). Bounded
// by LANDED_PAGE_SETTLE_TIMEOUT; resolves with a page_act-shaped result carrying the landed
// observation (or a null landed_page + a note to observe manually if it could not be captured).
function settleAndObserveLandedPageForServiceWorker(tabIdForSettle, chatIdForSettle, actionLabelForSettle, newUrlForSettle) {
  return new Promise(function (resolveForSettle) {
    var settleDoneForSettle = false;
    var settleTimerForSettle = null;
    var loadWatcherForSettle = null;
    var cleanupSettleForSettle = function () {
      if (settleTimerForSettle) { clearTimeout(settleTimerForSettle); settleTimerForSettle = null; }
      if (loadWatcherForSettle) {
        try { chrome.tabs.onUpdated.removeListener(loadWatcherForSettle); } catch (eRemoveLoadForSettle) { /* ignore */ }
        loadWatcherForSettle = null;
      }
    };
    var observeLandedForSettle = function () {
      if (settleDoneForSettle) return;
      settleDoneForSettle = true;
      cleanupSettleForSettle();
      (async function () {
        var landedUrlForSettle = newUrlForSettle || "";
        try {
          var tabNowForSettle = await getTabByIdForServiceWorker(tabIdForSettle);
          if (tabNowForSettle && tabNowForSettle.url) landedUrlForSettle = tabNowForSettle.url;
          if (tabMessagingForServiceWorker && typeof tabMessagingForServiceWorker.ensureContentInjected === "function") {
            await tabMessagingForServiceWorker.ensureContentInjected(tabIdForSettle);
          }
        } catch (eInjectForSettle) { /* best effort */ }
        chrome.tabs.sendMessage(
          tabIdForSettle,
          { action: "runDelegatedPageTool", tool: "page_observe", args: {}, chatId: chatIdForSettle },
          function (observeRespForSettle) {
            var landedObserveForSettle = (!chrome.runtime.lastError && observeRespForSettle && observeRespForSettle.ok === true)
              ? observeRespForSettle
              : null;
            resolveForSettle({
              ok: true,
              action: actionLabelForSettle,
              navigated: true,
              url: landedUrlForSettle,
              navigated_note: "The " + actionLabelForSettle + " navigated the page to " + (landedUrlForSettle ? '"' + landedUrlForSettle + '"' : "a new URL") + ". This is NOT a failure. " + (landedObserveForSettle
                ? "A fresh observation of the landed page is in landed_page below; use it to confirm the outcome before your next action."
                : "The landed page could not be auto-observed; call page_observe or page_read yourself to confirm the outcome."),
              landed_page: landedObserveForSettle
            });
          }
        );
      })();
    };
    getTabByIdForServiceWorker(tabIdForSettle).then(function (tabForSettleCheck) {
      if (!tabForSettleCheck || tabForSettleCheck.status === "complete") { observeLandedForSettle(); return; }
      loadWatcherForSettle = function (updatedTabIdForSettle, changeInfoForSettle) {
        if (updatedTabIdForSettle !== tabIdForSettle) return;
        if (changeInfoForSettle && changeInfoForSettle.status === "complete") observeLandedForSettle();
      };
      chrome.tabs.onUpdated.addListener(loadWatcherForSettle);
      settleTimerForSettle = setTimeout(observeLandedForSettle, LANDED_PAGE_SETTLE_TIMEOUT_MS_FOR_SERVICE_WORKER);
    });
  });
}

// A user (or the agent) closing a tab must drop that id from every chat's created-set so a
// future tab that reuses the id is not mistaken for an agent-created tab.
function pruneAgentCreatedTabOnRemovedForServiceWorker(removedTabIdForPrune) {
  try {
    chrome.storage.session.get(null, function (allForPrune) {
      if (chrome.runtime.lastError || !allForPrune) return;
      Object.keys(allForPrune).forEach(function (keyForPrune) {
        if (keyForPrune.indexOf(AGENT_CREATED_TABS_SESSION_PREFIX_FOR_SERVICE_WORKER) !== 0) return;
        const arrForPrune = Array.isArray(allForPrune[keyForPrune]) ? allForPrune[keyForPrune] : [];
        if (arrForPrune.indexOf(removedTabIdForPrune) === -1) return;
        const nextForPrune = arrForPrune.filter(function (idForPrune) { return idForPrune !== removedTabIdForPrune; });
        const payloadForPrune = {};
        payloadForPrune[keyForPrune] = nextForPrune;
        chrome.storage.session.set(payloadForPrune, function () { void chrome.runtime.lastError; });
      });
    });
  } catch (eForPrune) {}
}

async function broadcastDbChangeForServiceWorker(storeForBroadcast, excludeTabIdForBroadcast) {
  const allTabsForBroadcast = await queryTabsForServiceWorker({});
  for (const tabForBroadcast of allTabsForBroadcast) {
    if (!tabMessagingForServiceWorker.isSupportedUrl(tabForBroadcast.url || '')) continue;
    if (typeof excludeTabIdForBroadcast === 'number' && tabForBroadcast.id === excludeTabIdForBroadcast) continue;
    try {
      chrome.tabs.sendMessage(tabForBroadcast.id, { action: 'dbDataChanged', store: storeForBroadcast }, function () {
        if (chrome.runtime.lastError) { /* tab not ready, ignore */ }
      });
    } catch (errForBroadcast) {
      // Skip tabs that cannot receive messages
    }
  }
}

// Originator-side debounce for DB change signals. AI streaming writes
// `createMessage` on every token chunk — without coalescing here, each chunk
// would write to chrome.storage.local and wake every tab's onChanged listener.
// 60 ms is enough to fold a streaming burst into a single signal while still
// feeling instant for discrete writes. Receiver-side debounce is dropped to
// 50 ms now that bursts are flattened here.
const DB_SIGNAL_DEBOUNCE_MS_FOR_SERVICE_WORKER = 60;
const dbSignalDebounceTimersForServiceWorker = Object.create(null);
const dbSignalPendingForServiceWorker = Object.create(null);

function flushDbSignalForServiceWorker(storeForFlush) {
  const pendingForFlush = dbSignalPendingForServiceWorker[storeForFlush];
  dbSignalPendingForServiceWorker[storeForFlush] = null;
  dbSignalDebounceTimersForServiceWorker[storeForFlush] = null;
  if (!pendingForFlush) return;
  const keyForFlush = DB_CHANGE_SIGNAL_KEY_PREFIX_FOR_SERVICE_WORKER + storeForFlush;
  try {
    chrome.storage.local.set({
      [keyForFlush]: {
        ts: Date.now(),
        sourceId: pendingForFlush.sourceId || '',
        ops: Array.isArray(pendingForFlush.ops) ? pendingForFlush.ops : []
      }
    });
  } catch (errForFlush) {
    // Ignore — storage unavailable.
  }
}

// Merge a new batch of ops into the pending array for a store. Handles the
// duplicate-id collapses that arise inside a single debounce window:
//   create + update → keep create (net effect is still a new record)
//   create + delete → cancel (record never propagated externally)
//   update + delete → delete
//   update + update → keep last
//   anything + bulk → bulk (forces receiver-side full refresh)
//   pending length exceeds MAX_OPS_PER_SIGNAL_FOR_SERVICE_WORKER → collapse to bulk
function mergeOpsIntoPendingForServiceWorker(pendingArrayForMerge, incomingOpsForMerge) {
  if (!Array.isArray(incomingOpsForMerge) || incomingOpsForMerge.length === 0) return;
  for (let iForMerge = 0; iForMerge < incomingOpsForMerge.length; iForMerge++) {
    const opForMerge = incomingOpsForMerge[iForMerge];
    if (!opForMerge || !opForMerge.op) continue;

    if (opForMerge.op === 'bulk') {
      pendingArrayForMerge.length = 0;
      pendingArrayForMerge.push({ op: 'bulk' });
      return;
    }

    if (pendingArrayForMerge.length === 1 && pendingArrayForMerge[0].op === 'bulk') {
      return;
    }

    const idForMerge = Number(opForMerge.id);
    if (!Number.isFinite(idForMerge)) continue;

    let existingIndexForMerge = -1;
    for (let jForMerge = 0; jForMerge < pendingArrayForMerge.length; jForMerge++) {
      if (Number(pendingArrayForMerge[jForMerge].id) === idForMerge) {
        existingIndexForMerge = jForMerge;
        break;
      }
    }

    if (existingIndexForMerge === -1) {
      pendingArrayForMerge.push({ op: opForMerge.op, id: idForMerge });
    } else {
      const existingForMerge = pendingArrayForMerge[existingIndexForMerge];
      if (opForMerge.op === 'delete') {
        if (existingForMerge.op === 'create') {
          pendingArrayForMerge.splice(existingIndexForMerge, 1);
        } else {
          pendingArrayForMerge[existingIndexForMerge] = { op: 'delete', id: idForMerge };
        }
      } else if (existingForMerge.op === 'create' && opForMerge.op === 'update') {
        // keep the create — net effect is still "new record exists"
      } else if (existingForMerge.op === 'delete' && opForMerge.op === 'create') {
        // id reuse should not happen with autoIncrement; treat as unexpected → bulk
        pendingArrayForMerge.length = 0;
        pendingArrayForMerge.push({ op: 'bulk' });
        return;
      } else {
        pendingArrayForMerge[existingIndexForMerge] = { op: opForMerge.op, id: idForMerge };
      }
    }

    if (pendingArrayForMerge.length > MAX_OPS_PER_SIGNAL_FOR_SERVICE_WORKER) {
      pendingArrayForMerge.length = 0;
      pendingArrayForMerge.push({ op: 'bulk' });
      return;
    }
  }
}

function notifyDbChangeViaStorageForServiceWorker(storeForNotify, sourceIdForNotify, opsForNotify) {
  // Latest-writer-wins for the sourceId stamped on the signal: if two tabs write
  // within the debounce window, the later sourceId is what receivers see. Both
  // sender tabs handle their own in-process refresh anyway, so the only effect
  // is which of them skips the echo — not which side is "authoritative".
  if (!dbSignalPendingForServiceWorker[storeForNotify]) {
    dbSignalPendingForServiceWorker[storeForNotify] = { sourceId: '', ops: [] };
  }
  const pendingForNotify = dbSignalPendingForServiceWorker[storeForNotify];
  pendingForNotify.sourceId = typeof sourceIdForNotify === 'string' ? sourceIdForNotify : '';
  mergeOpsIntoPendingForServiceWorker(pendingForNotify.ops, opsForNotify);
  if (dbSignalDebounceTimersForServiceWorker[storeForNotify]) {
    clearTimeout(dbSignalDebounceTimersForServiceWorker[storeForNotify]);
  }
  dbSignalDebounceTimersForServiceWorker[storeForNotify] = setTimeout(function () {
    flushDbSignalForServiceWorker(storeForNotify);
  }, DB_SIGNAL_DEBOUNCE_MS_FOR_SERVICE_WORKER);
}

async function captureVisibleTabForServiceWorker(windowIdForServiceWorker) {
  return new Promise((resolveForServiceWorker) => {
    chrome.tabs.captureVisibleTab(
      typeof windowIdForServiceWorker === "number" ? windowIdForServiceWorker : undefined,
      { format: "png" },
      (dataUrlForServiceWorker) => {
        if (chrome.runtime.lastError || typeof dataUrlForServiceWorker !== "string" || !dataUrlForServiceWorker) {
          resolveForServiceWorker(null);
          return;
        }
        resolveForServiceWorker(dataUrlForServiceWorker);
      }
    );
  });
}

function wakeDiscardedTabForServiceWorker(tabIdForServiceWorker, timeoutMsForServiceWorker) {
  return new Promise(function (resolveForServiceWorker) {
    const limitForServiceWorker = typeof timeoutMsForServiceWorker === 'number' ? timeoutMsForServiceWorker : 15000;
    var timerForServiceWorker = setTimeout(function () {
      chrome.tabs.onUpdated.removeListener(listenerForServiceWorker);
      resolveForServiceWorker(false);
    }, limitForServiceWorker);

    function listenerForServiceWorker(updatedTabIdForServiceWorker, changeInfoForServiceWorker) {
      if (updatedTabIdForServiceWorker !== tabIdForServiceWorker) return;
      if (changeInfoForServiceWorker.status === 'complete') {
        clearTimeout(timerForServiceWorker);
        chrome.tabs.onUpdated.removeListener(listenerForServiceWorker);
        resolveForServiceWorker(true);
      }
    }

    chrome.tabs.onUpdated.addListener(listenerForServiceWorker);
    chrome.tabs.reload(tabIdForServiceWorker, {}, function () {
      if (chrome.runtime.lastError) {
        clearTimeout(timerForServiceWorker);
        chrome.tabs.onUpdated.removeListener(listenerForServiceWorker);
        resolveForServiceWorker(false);
      }
    });
  });
}

async function getTabPageContentForServiceWorker(tabIdForServiceWorker) {
  const numericTabIdForServiceWorker = Number(tabIdForServiceWorker);
  if (!Number.isFinite(numericTabIdForServiceWorker)) {
    return { ok: false, error: "Invalid tab id." };
  }
  const tabForServiceWorker = await getTabByIdForServiceWorker(numericTabIdForServiceWorker);
  if (!tabForServiceWorker) {
    return { ok: false, error: "Tab not found." };
  }
  if (!tabMessagingForServiceWorker.isSupportedUrl(tabForServiceWorker.url || "")) {
    return { ok: false, error: "This tab cannot be read." };
  }
  if (tabForServiceWorker.discarded) {
    const wokeForServiceWorker = await wakeDiscardedTabForServiceWorker(numericTabIdForServiceWorker, 15000);
    if (!wokeForServiceWorker) {
      return { ok: false, error: "Could not wake the sleeping tab. Please click the tab to reload it, then try again." };
    }
  }
  const didInjectForServiceWorker = await tabMessagingForServiceWorker.ensureContentInjected(numericTabIdForServiceWorker);
  if (!didInjectForServiceWorker) {
    return { ok: false, error: "Could not inject content scripts into selected tab." };
  }
  const isReadyForServiceWorker = await tabMessagingForServiceWorker.checkContentReady(numericTabIdForServiceWorker, 5);
  if (!isReadyForServiceWorker) {
    return { ok: false, error: "Selected tab content is not ready yet." };
  }

  return new Promise((resolveForServiceWorker) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: numericTabIdForServiceWorker },
        func: () => {
          try {
            var flattenedNsForServiceWorkerScript =
              globalThis.ABChatContent &&
              globalThis.ABChatContent.tools &&
              globalThis.ABChatContent.tools.flattenedContent;
            var extractedForServiceWorkerScript = "";
            if (
              flattenedNsForServiceWorkerScript &&
              typeof flattenedNsForServiceWorkerScript.getFullPageContent === "function"
            ) {
              var flattenedResultForServiceWorkerScript =
                flattenedNsForServiceWorkerScript.getFullPageContent();
              if (
                flattenedResultForServiceWorkerScript &&
                flattenedResultForServiceWorkerScript.ok &&
                typeof flattenedResultForServiceWorkerScript.result === "string"
              ) {
                extractedForServiceWorkerScript =
                  flattenedResultForServiceWorkerScript.result;
              }
            }
            if (!extractedForServiceWorkerScript) {
              var bodyForServiceWorkerScript = document && document.body ? document.body : null;
              extractedForServiceWorkerScript = bodyForServiceWorkerScript
                ? String(bodyForServiceWorkerScript.innerText || bodyForServiceWorkerScript.textContent || "")
                : "";
            }
            extractedForServiceWorkerScript = String(extractedForServiceWorkerScript || "").trim();
            if (extractedForServiceWorkerScript.length > 200000) {
              extractedForServiceWorkerScript = extractedForServiceWorkerScript.slice(0, 200000);
            }
            return { ok: true, content: extractedForServiceWorkerScript };
          } catch (errorForServiceWorkerScript) {
            return {
              ok: false,
              error:
                errorForServiceWorkerScript && errorForServiceWorkerScript.message
                  ? errorForServiceWorkerScript.message
                  : "Failed to read tab content."
            };
          }
        }
      },
      (resultsForServiceWorker) => {
        if (chrome.runtime.lastError) {
          resolveForServiceWorker({
            ok: false,
            error: chrome.runtime.lastError.message || "Failed to execute content extraction."
          });
          return;
        }
        const scriptResultForServiceWorker =
          Array.isArray(resultsForServiceWorker) && resultsForServiceWorker.length > 0
            ? resultsForServiceWorker[0].result
            : null;
        if (!scriptResultForServiceWorker || !scriptResultForServiceWorker.ok) {
          resolveForServiceWorker({
            ok: false,
            error:
              scriptResultForServiceWorker && scriptResultForServiceWorker.error
                ? scriptResultForServiceWorker.error
                : "Failed to read tab content."
          });
          return;
        }
        resolveForServiceWorker({
          ok: true,
          content: String(scriptResultForServiceWorker.content || "")
        });
      }
    );
  });
}

async function getSessionValueForServiceWorker(keyForServiceWorker) {
  if (!chrome.storage || !chrome.storage.session || typeof chrome.storage.session.get !== "function") {
    return null;
  }
  return new Promise((resolveForServiceWorker) => {
    chrome.storage.session.get([keyForServiceWorker], (resultForServiceWorker) => {
      resolveForServiceWorker(resultForServiceWorker && resultForServiceWorker[keyForServiceWorker]);
    });
  });
}

async function setSessionValueForServiceWorker(keyForServiceWorker, valueForServiceWorker) {
  if (!chrome.storage || !chrome.storage.session || typeof chrome.storage.session.set !== "function") {
    return false;
  }
  return new Promise((resolveForServiceWorker) => {
    chrome.storage.session.set(
      { [keyForServiceWorker]: valueForServiceWorker },
      () => {
        resolveForServiceWorker(!chrome.runtime.lastError);
      }
    );
  });
}

async function syncModeVisualsForServiceWorker(
  tabIdForServiceWorker,
  shouldInvalidateListenersForServiceWorker
) {
  if (typeof tabIdForServiceWorker !== "number") {
    return false;
  }

  return new Promise((resolveForServiceWorker) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabIdForServiceWorker },
        func: (shouldInvalidateListenersForServiceWorkerArg) => {
          if (shouldInvalidateListenersForServiceWorkerArg) {
            // Invalidate old generation-bound listeners from the previous extension context.
            window.abchatListenerGeneration = (window.abchatListenerGeneration || 0) + 1;

            var globalStateForServiceWorkerSync = globalThis.ABChatContent && globalThis.ABChatContent.state
              ? globalThis.ABChatContent.state
              : null;
            if (globalStateForServiceWorkerSync) {
              globalStateForServiceWorkerSync.contextMenuTrackingBoundForFlattenedContent = false;
              globalStateForServiceWorkerSync.contextMenuTrackingBoundForContentSelector = false;
            }
          }
        },
        args: [Boolean(shouldInvalidateListenersForServiceWorker)]
      },
      () => {
        resolveForServiceWorker(!chrome.runtime.lastError);
      }
    );
  });
}

async function syncModeVisualsAcrossSupportedTabsForServiceWorker(
  shouldInvalidateListenersForServiceWorker
) {
  const allTabsForServiceWorker = await queryTabsForServiceWorker({});
  for (const tabForServiceWorker of allTabsForServiceWorker) {
    if (!tabMessagingForServiceWorker.isSupportedUrl(tabForServiceWorker.url || "")) {
      continue;
    }
    try {
      await syncModeVisualsForServiceWorker(
        tabForServiceWorker.id,
        shouldInvalidateListenersForServiceWorker
      );
    } catch (errorForServiceWorker) {
      // Skip tabs that cannot be scripted.
    }
  }
}

// Recovery design notes:
// - Clear visible stale effects on the active tab first (fast UX path).
// - Then run all-tab reinjection + visual synchronization for consistency.
// - Keep this idempotent and bounded with timeouts to avoid stuck worker runs.
async function runReloadRecoveryPassForServiceWorker(shouldForceDisableModesForServiceWorker) {
  if (shouldForceDisableModesForServiceWorker) {
    try {
      var activeTabForServiceWorker = await tabMessagingForServiceWorker.queryActiveTab();
      if (
        activeTabForServiceWorker &&
        typeof activeTabForServiceWorker.id === "number" &&
        tabMessagingForServiceWorker.isSupportedUrl(activeTabForServiceWorker.url || "")
      ) {
        // Fast path: clear visible stale effects immediately on the active tab,
        // then continue deeper reinjection/readiness recovery in background.
        await syncModeVisualsForServiceWorker(
          activeTabForServiceWorker.id,
          true
        );

        var didInjectActiveTabForServiceWorker = await Promise.race([
          tabMessagingForServiceWorker.ensureContentInjected(activeTabForServiceWorker.id),
          new Promise((resolveForServiceWorker) => {
            setTimeout(() => {
              resolveForServiceWorker(false);
            }, 3500);
          })
        ]);

        if (didInjectActiveTabForServiceWorker) {
          await tabMessagingForServiceWorker.checkContentReady(
            activeTabForServiceWorker.id,
            5
          );
        }

        if (shouldForceDisableModesForServiceWorker) {
          await syncModeVisualsForServiceWorker(
            activeTabForServiceWorker.id,
            false
          );
        }
      }
    } catch (errorForServiceWorker) {
      // Continue with broader recovery even when active-tab fast path fails.
    }
  }

  try {
    await Promise.race([
      tabMessagingForServiceWorker.reInjectIntoAllSupportedTabs(),
      new Promise((resolveForServiceWorker) => {
        setTimeout(() => {
          resolveForServiceWorker(false);
        }, 7000);
      })
    ]);
  } catch (errorForServiceWorker) {
    // Ignore re-injection failures during lifecycle recovery and continue.
  }

  if (!shouldForceDisableModesForServiceWorker) {
    return;
  }

  await Promise.race([
    syncModeVisualsAcrossSupportedTabsForServiceWorker(
      false
    ),
    new Promise((resolveForServiceWorker) => {
      setTimeout(() => {
        resolveForServiceWorker(false);
      }, 7000);
    })
  ]);
}

// Lessons learned:
// - Recovery must prioritize the visible tab first to avoid stale UI perception.
// - Re-injection and visual cleanup can stall on some tabs; bounded timeouts prevent
//   the overall recovery sequence from hanging.
// - Do not run overlapping recovery sequences; a simple in-flight guard avoids races.
// - Recovery retries must be non-destructive once the user starts interacting with modes.
async function runReloadRecoveryWithRetriesForServiceWorker() {
  if (isReloadRecoveryRunningForServiceWorker) {
    return;
  }
  isReloadRecoveryRunningForServiceWorker = true;

  const retryDelaysMsForServiceWorker = [0, 900, 2200];

  try {
    for (let retryIndexForServiceWorker = 0; retryIndexForServiceWorker < retryDelaysMsForServiceWorker.length; retryIndexForServiceWorker++) {
      const delayMsForServiceWorker = retryDelaysMsForServiceWorker[retryIndexForServiceWorker];
      if (delayMsForServiceWorker > 0) {
        await new Promise((resolveForServiceWorker) => {
          setTimeout(resolveForServiceWorker, delayMsForServiceWorker);
        });
      }
      await runReloadRecoveryPassForServiceWorker(retryIndexForServiceWorker === 0);
    }
  } finally {
    isReloadRecoveryRunningForServiceWorker = false;
  }
}

async function runStartupRecoveryOncePerSessionForServiceWorker() {
  const didRecoverInSessionForServiceWorker = await getSessionValueForServiceWorker(startupRecoverySessionKeyForServiceWorker);
  if (didRecoverInSessionForServiceWorker) {
    return;
  }

  await setSessionValueForServiceWorker(startupRecoverySessionKeyForServiceWorker, true);
  await runReloadRecoveryWithRetriesForServiceWorker();
}

// Removes utm_* and known click-tracking query params from a search-source URL,
// leaving functional params intact. Falls back to the original string on any parse error.
function stripTrackingParamsForSearch(rawUrl) {
  if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl)) return rawUrl;
  var urlObjForStrip;
  try { urlObjForStrip = new URL(rawUrl); } catch (e) { return rawUrl; }
  var TRACKING_KEYS_FOR_SEARCH = {
    gclid: 1, dclid: 1, fbclid: 1, yclid: 1, msclkid: 1, twclid: 1,
    mc_cid: 1, mc_eid: 1, igshid: 1, _hsenc: 1, _hsmi: 1,
    vero_id: 1, oly_enc_id: 1, oly_anon_id: 1
  };
  var keysToDeleteForStrip = [];
  urlObjForStrip.searchParams.forEach(function (value, key) {
    var lowerKeyForStrip = key.toLowerCase();
    if (lowerKeyForStrip.indexOf('utm_') === 0 || TRACKING_KEYS_FOR_SEARCH[lowerKeyForStrip]) {
      keysToDeleteForStrip.push(key);
    }
  });
  for (var kForStrip = 0; kForStrip < keysToDeleteForStrip.length; kForStrip++) {
    urlObjForStrip.searchParams.delete(keysToDeleteForStrip[kForStrip]);
  }
  return urlObjForStrip.toString().replace(/\?$/, '');
}

// Follows HTTP redirects (e.g. Google grounding-api-redirect wrappers) to the final
// destination and returns that URL. Best-effort: a timeout, network error, or abort
// falls back to the original URL so a search is never blocked by resolution.
async function resolveFinalUrlForSearch(rawUrl, parentSignalForResolve) {
  if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl)) return rawUrl;
  var REDIRECT_TIMEOUT_MS_FOR_SEARCH = 4000;
  async function attemptForResolve(methodForResolve) {
    var controllerForResolve = new AbortController();
    var timeoutIdForResolve = setTimeout(function () { controllerForResolve.abort(); }, REDIRECT_TIMEOUT_MS_FOR_SEARCH);
    var onParentAbortForResolve = function () { controllerForResolve.abort(); };
    if (parentSignalForResolve) {
      if (parentSignalForResolve.aborted) controllerForResolve.abort();
      else parentSignalForResolve.addEventListener('abort', onParentAbortForResolve, { once: true });
    }
    try {
      var respForResolve = await fetch(rawUrl, { method: methodForResolve, redirect: 'follow', signal: controllerForResolve.signal });
      return (respForResolve && typeof respForResolve.url === 'string' && respForResolve.url) ? respForResolve.url : rawUrl;
    } finally {
      clearTimeout(timeoutIdForResolve);
      if (parentSignalForResolve) parentSignalForResolve.removeEventListener('abort', onParentAbortForResolve);
    }
  }
  try {
    return await attemptForResolve('HEAD');
  } catch (headErrForResolve) {
    if (parentSignalForResolve && parentSignalForResolve.aborted) return rawUrl;
    try {
      return await attemptForResolve('GET');
    } catch (getErrForResolve) {
      return rawUrl;
    }
  }
}

async function handleAgentWebSearchForServiceWorker(msgForSearch, sendResponseForSearch) {
  var queryForSearch = typeof msgForSearch.query === 'string' ? msgForSearch.query.trim() : '';
  var maxResultsForSearch = Math.min(
    Math.max(typeof msgForSearch.maxResults === 'number' && msgForSearch.maxResults > 0 ? Math.floor(msgForSearch.maxResults) : 5, 5),
    10
  );
  var academicOnlyForSearch = msgForSearch.academicOnly === true;
  var apiKeyForSearch = typeof msgForSearch.apiKey === 'string' ? msgForSearch.apiKey : '';
  var modelForSearch = (typeof msgForSearch.model === 'string' && msgForSearch.model.trim())
    ? msgForSearch.model.trim()
    : 'openai/gpt-4o-mini';

  if (!queryForSearch) {
    sendResponseForSearch({ ok: false, error: 'query is required' });
    return;
  }
  if (!apiKeyForSearch) {
    sendResponseForSearch({ ok: false, error: 'No API key available for web search' });
    return;
  }

  var requestRecordForSearch = registerCancellableAgentToolRequestForServiceWorker(msgForSearch.agentToolRequestId);
  sendResponseForSearch = wrapCancellableSendResponseForServiceWorker(sendResponseForSearch, requestRecordForSearch);

  try {
    var searchStartTimeForSearch = Date.now();
    var searchToolParamsForSearch = { engine: 'auto', max_results: maxResultsForSearch };
    if (academicOnlyForSearch) {
      searchToolParamsForSearch.allowed_domains = academicDomainsForServiceWorker;
    }
    var MAX_RETRIES_FOR_SEARCH = 2;
    var RETRY_DELAYS_FOR_SEARCH = [1500, 3000];
    var RETRYABLE_FOR_SEARCH = [429, 502, 503, 504];
    var responseForSearch = null;
    var lastErrForSearch = null;
    for (var retryForSearch = 0; retryForSearch <= MAX_RETRIES_FOR_SEARCH; retryForSearch++) {
      if (retryForSearch > 0) {
        await delayForServiceWorker(RETRY_DELAYS_FOR_SEARCH[retryForSearch - 1], requestRecordForSearch ? requestRecordForSearch.signal : null);
        if (requestRecordForSearch && requestRecordForSearch.signal.aborted) {
          sendResponseForSearch({ ok: false, cancelled: true, error: 'Cancelled' });
          return;
        }
      }
      lastErrForSearch = null;
      try {
        responseForSearch = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKeyForSearch,
            'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
            'X-OpenRouter-Title': 'Agentic Browser Chat'
          },
          body: JSON.stringify({
            model: modelForSearch,
            tools: [{ type: 'openrouter:web_search', parameters: searchToolParamsForSearch }],
            messages: [
              {
                role: 'system',
                content: 'You are a web search assistant. Always use the web search tool to find current, real information for the user\'s query, then briefly summarize what you found. Do not answer from prior knowledge without searching.'
              },
              {
                role: 'user',
                content: queryForSearch
              }
            ]
          }),
          signal: requestRecordForSearch ? requestRecordForSearch.signal : undefined
        });
        if (!responseForSearch.ok && RETRYABLE_FOR_SEARCH.indexOf(responseForSearch.status) !== -1 && retryForSearch < MAX_RETRIES_FOR_SEARCH) {
          lastErrForSearch = new Error('HTTP ' + responseForSearch.status);
          responseForSearch = null;
          continue;
        }
        break;
      } catch (fetchErrForSearch) {
        if (requestRecordForSearch && requestRecordForSearch.signal.aborted) {
          sendResponseForSearch({ ok: false, cancelled: true, error: 'Cancelled' });
          return;
        }
        lastErrForSearch = fetchErrForSearch;
        if (retryForSearch >= MAX_RETRIES_FOR_SEARCH) break;
      }
    }

    var latencyMsForSearch = Date.now() - searchStartTimeForSearch;

    if (lastErrForSearch) throw lastErrForSearch;
    if (!responseForSearch.ok) {
      var errTextForSearch = '';
      try { errTextForSearch = await responseForSearch.text(); } catch (e) {}
      sendResponseForSearch({ ok: false, error: 'Web search API error ' + responseForSearch.status + ': ' + errTextForSearch.slice(0, 200), latencyMs: latencyMsForSearch, rawResponse: '' });
      return;
    }
    if (requestRecordForSearch && requestRecordForSearch.signal.aborted) {
      sendResponseForSearch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    var jsonForSearch = await responseForSearch.json();
    var messageForSearch = (jsonForSearch.choices && jsonForSearch.choices[0] && jsonForSearch.choices[0].message)
      ? jsonForSearch.choices[0].message
      : null;
    var contentForSearch = (messageForSearch && typeof messageForSearch.content === 'string')
      ? messageForSearch.content
      : '';
    var annotationsForSearch = (messageForSearch && Array.isArray(messageForSearch.annotations))
      ? messageForSearch.annotations
      : [];

    var seenUrlsForSearch = {};
    var normalizedForSearch = [];
    for (var annIdxForSearch = 0; annIdxForSearch < annotationsForSearch.length; annIdxForSearch++) {
      var annotationForSearch = annotationsForSearch[annIdxForSearch];
      if (!annotationForSearch || annotationForSearch.type !== 'url_citation' || !annotationForSearch.url_citation) continue;
      var citationForSearch = annotationForSearch.url_citation;
      var urlForSearch = typeof citationForSearch.url === 'string' ? citationForSearch.url.trim() : '';
      if (!urlForSearch || seenUrlsForSearch[urlForSearch]) continue;
      seenUrlsForSearch[urlForSearch] = true;
      normalizedForSearch.push({
        title: typeof citationForSearch.title === 'string' ? citationForSearch.title : '',
        url: urlForSearch
      });
    }

    if (normalizedForSearch.length === 0) {
      sendResponseForSearch({ ok: false, error: 'Web search returned no results (the model did not run a web search, or nothing was found). Try rephrasing the query.', latencyMs: latencyMsForSearch, rawResponse: contentForSearch, usage: (jsonForSearch && jsonForSearch.usage) || null });
      return;
    }

    if (normalizedForSearch.length > maxResultsForSearch) {
      normalizedForSearch = normalizedForSearch.slice(0, maxResultsForSearch);
    }

    // Resolve redirect wrappers to their final destination, then strip tracking params.
    // Parallel and best-effort: any failure falls back to the original URL.
    var resolvedSourcesForSearch = await Promise.all(normalizedForSearch.map(async function (srcForSearch) {
      var finalUrlForSearch = await resolveFinalUrlForSearch(srcForSearch.url, requestRecordForSearch ? requestRecordForSearch.signal : null);
      return { title: srcForSearch.title, url: stripTrackingParamsForSearch(finalUrlForSearch) };
    }));

    if (requestRecordForSearch && requestRecordForSearch.signal.aborted) {
      sendResponseForSearch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    // Re-dedup: distinct wrappers can resolve to the same destination.
    var seenFinalUrlsForSearch = {};
    var cleanedSourcesForSearch = [];
    for (var dIdxForSearch = 0; dIdxForSearch < resolvedSourcesForSearch.length; dIdxForSearch++) {
      var cleanSrcForSearch = resolvedSourcesForSearch[dIdxForSearch];
      if (!cleanSrcForSearch.url || seenFinalUrlsForSearch[cleanSrcForSearch.url]) continue;
      seenFinalUrlsForSearch[cleanSrcForSearch.url] = true;
      cleanedSourcesForSearch.push(cleanSrcForSearch);
    }
    normalizedForSearch = cleanedSourcesForSearch;

    sendResponseForSearch({ ok: true, results: normalizedForSearch, academicFallback: false, latencyMs: latencyMsForSearch, rawResponse: contentForSearch, usage: (jsonForSearch && jsonForSearch.usage) || null });
  } catch (errForSearch) {
    if (requestRecordForSearch && requestRecordForSearch.signal.aborted) {
      sendResponseForSearch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }
    sendResponseForSearch({ ok: false, error: (errForSearch && errForSearch.message) || 'Web search failed' });
  }
}

function validateQuestionForServiceWorker(q) {
  var issues = [];
  if (typeof q.questionText !== 'string' || !q.questionText.trim()) {
    issues.push('missing questionText');
  }
  var qType = q.type === 'fitb' ? 'fitb' : 'mcq';
  if (qType === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      issues.push('MCQ must have exactly 4 options (got ' + (Array.isArray(q.options) ? q.options.length : 'none') + ')');
    } else {
      var correctCount = q.options.filter(function (o) { return o && o.isCorrect === true; }).length;
      if (correctCount !== 1) issues.push('MCQ must have exactly 1 correct option (found ' + correctCount + ')');
      var allTextsValid = q.options.every(function (o) { return o && typeof o.text === 'string' && o.text.trim(); });
      if (!allTextsValid) issues.push('MCQ options must each have a non-empty text field');
    }
  } else {
    if (typeof q.correctAnswer !== 'string' || !q.correctAnswer.trim()) {
      issues.push('FITB must have a non-empty correctAnswer');
    }
    if (!/_{3,}/.test(q.questionText)) {
      issues.push('FITB questionText must contain "___" to mark the blank');
    }
  }
  if (issues.length === 0 && typeof q.title === 'string' && q.title.trim()) {
    var titleLower = q.title.toLowerCase();
    var answerTexts = [];
    if (qType === 'mcq') {
      answerTexts = q.options.filter(function (o) { return o && o.isCorrect === true; }).map(function (o) { return o.text || ''; });
    } else {
      if (typeof q.correctAnswer === 'string' && q.correctAnswer.trim()) answerTexts.push(q.correctAnswer.trim());
      if (Array.isArray(q.alternativeAnswers)) {
        q.alternativeAnswers.forEach(function (a) { if (typeof a === 'string' && a.trim()) answerTexts.push(a.trim()); });
      }
    }
    for (var ai = 0; ai < answerTexts.length; ai++) {
      if (answerTexts[ai] && titleLower.indexOf(answerTexts[ai].toLowerCase()) !== -1) {
        issues.push('title "' + q.title + '" contains the correct answer "' + answerTexts[ai] + '"');
        break;
      }
    }
  }
  return issues;
}

function writeSecondaryLlmLogForServiceWorker(entry) {
  try {
    var apiLoggerForSecondary = (globalThis.ABChatContent || {}).apiLogger;
    if (apiLoggerForSecondary && typeof apiLoggerForSecondary.writeLog === 'function') {
      apiLoggerForSecondary.writeLog({
        requestType: entry.requestType,
        timestamp: new Date(entry.startTime).toISOString(),
        model: entry.model || null,
        iterationCount: 1,
        totalLatencyMs: Date.now() - entry.startTime,
        status: entry.status,
        errorMessage: entry.errorMessage || '',
        requestMessages: entry.requestMessages || null,
        apiParams: entry.apiParams || null,
        responseContent: entry.responseContent || null,
        usage: entry.usage || null
      }).catch(function () {});
    }
  } catch (e) { /* silent */ }
}

async function fixQuestionForServiceWorker(question, issues, apiKey, model) {
  var systemPromptForFix = [
    'You are a quiz question fixer. A generated quiz question failed validation. Regenerate the question from scratch, fixing all reported issues while preserving its topic and intent.',
    '',
    'Return ONLY a JSON object with this exact shape and no other text:',
    '{"title":"...","type":"mcq","questionText":"...","options":[{"text":"...","isCorrect":false},{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"correctAnswer":"","alternativeAnswers":[],"caseSensitive":false,"explanation":"..."}',
    '',
    'Rules:',
    '- type must be "mcq" or "fitb".',
    '- For MCQ: exactly 4 options, exactly 1 isCorrect:true, empty correctAnswer and alternativeAnswers.',
    '- For FITB: options:[], non-empty correctAnswer, questionText must contain "___", alternatives in alternativeAnswers.',
    '- The title must not contain or reveal the correct answer.',
    '- The question must be fully self-contained: it will be attempted with no access to the source material. Embed any needed context in the questionText and name the subject or topic it concerns.',
    '- Do not reference the source or its structure (no "according to the passage", "the text above", "the document", "as mentioned", "the author", etc.), and do not refer to a framework, model, theory, argument, or claim as if the reader already knows it (no bare "this hiring model", "the philosophy", "the stated alternative"); introduce or attribute any such idea inside the question and restate the relevant facts.',
    '- Do not include any text outside the JSON object.'
  ].join('\n');
  var userMsgForFix = 'Original question:\n' + JSON.stringify(question, null, 2) + '\n\nIssues to fix:\n' + issues.map(function (i) { return '- ' + i; }).join('\n');
  var fixLogStartForServiceWorker = Date.now();
  var fixRequestMessagesForLog = [
    { role: 'system', content: systemPromptForFix },
    { role: 'user', content: userMsgForFix }
  ];
  var fixApiParamsForLog = { stream: false, response_format: { type: 'json_object' }, model: model };
  try {
    var MAX_RETRIES_FOR_FIX = 2;
    var RETRY_DELAYS_FOR_FIX = [1500, 3000];
    var RETRYABLE_FOR_FIX = [429, 502, 503, 504];
    var respForFix = null;
    var lastErrForFix = null;
    for (var retryForFix = 0; retryForFix <= MAX_RETRIES_FOR_FIX; retryForFix++) {
      if (retryForFix > 0) {
        await new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAYS_FOR_FIX[retryForFix - 1]); });
      }
      lastErrForFix = null;
      try {
        respForFix = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
            'X-OpenRouter-Title': 'Agentic Browser Chat'
          },
          body: JSON.stringify({
            model: model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPromptForFix },
              { role: 'user', content: userMsgForFix }
            ]
          })
        });
        if (!respForFix.ok && RETRYABLE_FOR_FIX.indexOf(respForFix.status) !== -1 && retryForFix < MAX_RETRIES_FOR_FIX) {
          lastErrForFix = new Error('HTTP ' + respForFix.status);
          respForFix = null;
          continue;
        }
        break;
      } catch (fetchErrForFix) {
        lastErrForFix = fetchErrForFix;
        if (retryForFix >= MAX_RETRIES_FOR_FIX) break;
      }
    }
    if (lastErrForFix || !respForFix || !respForFix.ok) {
      writeSecondaryLlmLogForServiceWorker({
        requestType: 'quiz-fix',
        startTime: fixLogStartForServiceWorker,
        model: model,
        status: 'error',
        errorMessage: (lastErrForFix && lastErrForFix.message) || (respForFix ? ('HTTP ' + respForFix.status) : 'Question fix request failed.'),
        requestMessages: fixRequestMessagesForLog,
        apiParams: fixApiParamsForLog,
        responseContent: ''
      });
      return null;
    }
    var jsonForFix = await respForFix.json();
    var rawForFix = jsonForFix.choices && jsonForFix.choices[0] && jsonForFix.choices[0].message
      ? (jsonForFix.choices[0].message.content || '') : '';
    writeSecondaryLlmLogForServiceWorker({
      requestType: 'quiz-fix',
      startTime: fixLogStartForServiceWorker,
      model: (jsonForFix && jsonForFix.model) || model,
      status: 'success',
      requestMessages: fixRequestMessagesForLog,
      apiParams: fixApiParamsForLog,
      responseContent: rawForFix,
      usage: (jsonForFix && jsonForFix.usage) || null
    });
    var parsedForFix = null;
    try { parsedForFix = JSON.parse(rawForFix); } catch (e) {}
    if (!parsedForFix) {
      var matchForFix = rawForFix.match(/\{[\s\S]*\}/);
      if (matchForFix) { try { parsedForFix = JSON.parse(matchForFix[0]); } catch (e) {} }
    }
    return (parsedForFix && typeof parsedForFix === 'object') ? parsedForFix : null;
  } catch (e) {
    writeSecondaryLlmLogForServiceWorker({
      requestType: 'quiz-fix',
      startTime: fixLogStartForServiceWorker,
      model: model,
      status: 'error',
      errorMessage: (e && e.message) || 'Question fix failed.',
      requestMessages: fixRequestMessagesForLog,
      apiParams: fixApiParamsForLog,
      responseContent: ''
    });
    return null;
  }
}

async function reviewQuestionsSelfContainmentForServiceWorker(questions, apiKey, model, signal) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  if (!apiKey || !model) return questions;

  var systemPromptForReview = [
    'You are a quiz question reviewer. You check whether each quiz question is REFERENTIALLY SELF-CONTAINED and rewrite the ones that are not. You are intentionally NOT given the source material the questions came from: judge each question only from what it itself contains, exactly as a future quiz-taker will see it with no access to any source.',
    '',
    'A question is self-contained when BOTH are true:',
    '1. It does not refer to unseen material. It must not point at a source the reader has not seen, whether by document structure ("according to the passage", "the text above", "the document", "as mentioned", "the author", "this section") OR by treating a source\'s coined idea as already known ("the scenario", "this model", "the philosophy", "the framework", "the stated alternative", "the speaker\'s example"). Introducing the idea generically is fine ("a proposed hiring framework that sorts roles by AI dependence"); a bare back-reference to it is not.',
    '2. Its subject is clear. The reader can tell what topic or domain the question is about from the question alone.',
    '',
    'Do NOT judge whether the answer can be deduced from general knowledge. A question that tests a specific learned fact (a number, a definition, a claim) is valid and self-contained as long as it satisfies the two points above. Testing recalled facts is the purpose of the quiz; never flag a question merely because you could not answer it yourself without studying.',
    '',
    'For each question that is NOT self-contained, rewrite ONLY its questionText (and its title, if the title itself refers to unseen material) so that it stands on its own:',
    '- Replace each reference to unseen material with the actual context it stood for, drawn from what the question and its answer already tell you. Do not invent new facts or add detail from outside knowledge.',
    '- Preserve the question\'s specificity; do not broaden it. If a reference pointed at a specific described setup, restate that setup ("in a proposed multi-gigawatt space data center cooling design") rather than deleting it, so the existing correct answer stays uniquely correct.',
    '- Do not change the question\'s type, options, correct answer, alternative answers, or which option is correct. Only the wording of the stem (and title) may change.',
    '- For fill-in-the-blank questions, keep at least one run of three or more underscores ("___") in the rewritten questionText.',
    '',
    'Return ONLY a JSON object with this exact shape and no other text:',
    '{"reviews":[{"index":0,"selfContained":true},{"index":1,"selfContained":false,"questionText":"<rewritten stem>","title":"<rewritten title, only if it needed changing>"}]}',
    '',
    '- index is the zero-based position of the question in the list you were given.',
    '- Include one entry for every question, in order.',
    '- When selfContained is true, include only index and selfContained.',
    '- When selfContained is false, include the rewritten questionText (required) and title only if you changed it.',
    '- Do not include any text outside the JSON object.'
  ].join('\n');

  var reviewInputForReview = questions.map(function (q, idx) {
    return {
      index: idx,
      type: q && q.type === 'fitb' ? 'fitb' : 'mcq',
      title: q && typeof q.title === 'string' ? q.title : '',
      questionText: q && typeof q.questionText === 'string' ? q.questionText : '',
      options: q && Array.isArray(q.options) ? q.options.map(function (o) { return { text: o && typeof o.text === 'string' ? o.text : '', isCorrect: !!(o && o.isCorrect) }; }) : [],
      correctAnswer: q && typeof q.correctAnswer === 'string' ? q.correctAnswer : '',
      alternativeAnswers: q && Array.isArray(q.alternativeAnswers) ? q.alternativeAnswers : []
    };
  });
  var userMsgForReview = 'Questions to review (judge each as if you have not seen any source; index is the position starting at 0):\n' + JSON.stringify(reviewInputForReview);

  var reviewLogStartForServiceWorker = Date.now();
  var reviewRequestMessagesForLog = [
    { role: 'system', content: systemPromptForReview },
    { role: 'user', content: userMsgForReview }
  ];
  var reviewApiParamsForLog = { stream: false, response_format: { type: 'json_object' }, model: model };

  try {
    var MAX_RETRIES_FOR_REVIEW = 2;
    var RETRY_DELAYS_FOR_REVIEW = [1500, 3000];
    var RETRYABLE_FOR_REVIEW = [429, 502, 503, 504];
    var respForReview = null;
    var lastErrForReview = null;
    for (var retryForReview = 0; retryForReview <= MAX_RETRIES_FOR_REVIEW; retryForReview++) {
      if (signal && signal.aborted) {
        writeSecondaryLlmLogForServiceWorker({ requestType: 'quiz-review', startTime: reviewLogStartForServiceWorker, model: model, status: 'cancelled', requestMessages: reviewRequestMessagesForLog, apiParams: reviewApiParamsForLog, responseContent: '' });
        return questions;
      }
      if (retryForReview > 0) await delayForServiceWorker(RETRY_DELAYS_FOR_REVIEW[retryForReview - 1], signal);
      lastErrForReview = null;
      try {
        respForReview = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
            'X-OpenRouter-Title': 'Agentic Browser Chat'
          },
          body: JSON.stringify({
            model: model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPromptForReview },
              { role: 'user', content: userMsgForReview }
            ]
          }),
          signal: signal || undefined
        });
        if (!respForReview.ok && RETRYABLE_FOR_REVIEW.indexOf(respForReview.status) !== -1 && retryForReview < MAX_RETRIES_FOR_REVIEW) {
          lastErrForReview = new Error('HTTP ' + respForReview.status);
          respForReview = null;
          continue;
        }
        break;
      } catch (fetchErrForReview) {
        if (signal && signal.aborted) {
          writeSecondaryLlmLogForServiceWorker({ requestType: 'quiz-review', startTime: reviewLogStartForServiceWorker, model: model, status: 'cancelled', requestMessages: reviewRequestMessagesForLog, apiParams: reviewApiParamsForLog, responseContent: '' });
          return questions;
        }
        lastErrForReview = fetchErrForReview;
        if (retryForReview >= MAX_RETRIES_FOR_REVIEW) break;
      }
    }

    if (lastErrForReview || !respForReview || !respForReview.ok) {
      writeSecondaryLlmLogForServiceWorker({
        requestType: 'quiz-review',
        startTime: reviewLogStartForServiceWorker,
        model: model,
        status: 'error',
        errorMessage: (lastErrForReview && lastErrForReview.message) || (respForReview ? ('HTTP ' + respForReview.status) : 'Self-containment review request failed.'),
        requestMessages: reviewRequestMessagesForLog,
        apiParams: reviewApiParamsForLog,
        responseContent: ''
      });
      return questions;
    }

    var jsonForReview = await respForReview.json();
    var rawForReview = jsonForReview.choices && jsonForReview.choices[0] && jsonForReview.choices[0].message
      ? (jsonForReview.choices[0].message.content || '') : '';
    writeSecondaryLlmLogForServiceWorker({
      requestType: 'quiz-review',
      startTime: reviewLogStartForServiceWorker,
      model: (jsonForReview && jsonForReview.model) || model,
      status: 'success',
      requestMessages: reviewRequestMessagesForLog,
      apiParams: reviewApiParamsForLog,
      responseContent: rawForReview,
      usage: (jsonForReview && jsonForReview.usage) || null
    });

    var parsedForReview = null;
    try { parsedForReview = JSON.parse(rawForReview); } catch (e) {}
    if (!parsedForReview) {
      var matchForReview = rawForReview.match(/\{[\s\S]*\}/);
      if (matchForReview) { try { parsedForReview = JSON.parse(matchForReview[0]); } catch (e) {} }
    }
    var reviewsForReview = parsedForReview && Array.isArray(parsedForReview.reviews) ? parsedForReview.reviews : null;
    if (!reviewsForReview) return questions;

    var mergedForReview = questions.map(function (q) {
      return (q && typeof q === 'object') ? Object.assign({}, q) : q;
    });
    for (var riForReview = 0; riForReview < reviewsForReview.length; riForReview++) {
      var rForReview = reviewsForReview[riForReview];
      if (!rForReview || typeof rForReview !== 'object') continue;
      if (rForReview.selfContained !== false) continue;
      var targetIdxForReview = rForReview.index;
      if (typeof targetIdxForReview !== 'number' || targetIdxForReview < 0 || targetIdxForReview >= mergedForReview.length) continue;
      var targetForReview = mergedForReview[targetIdxForReview];
      if (!targetForReview || typeof targetForReview !== 'object') continue;
      if (typeof rForReview.questionText === 'string' && rForReview.questionText.trim()) {
        targetForReview.questionText = rForReview.questionText;
      }
      if (typeof rForReview.title === 'string' && rForReview.title.trim()) {
        targetForReview.title = rForReview.title;
      }
    }
    return mergedForReview;
  } catch (e) {
    writeSecondaryLlmLogForServiceWorker({
      requestType: 'quiz-review',
      startTime: reviewLogStartForServiceWorker,
      model: model,
      status: 'error',
      errorMessage: (e && e.message) || 'Self-containment review failed.',
      requestMessages: reviewRequestMessagesForLog,
      apiParams: reviewApiParamsForLog,
      responseContent: ''
    });
    return questions;
  }
}

async function handleAgentGenerateQuestionsForServiceWorker(msgForGenQ, sendResponseForGenQ) {
  var contentForGenQ = typeof msgForGenQ.content === 'string' ? msgForGenQ.content.trim() : '';
  var countForGenQ = (typeof msgForGenQ.count === 'number' && msgForGenQ.count > 0) ? Math.floor(msgForGenQ.count) : 1;
  var focusForGenQ = typeof msgForGenQ.focus === 'string' ? msgForGenQ.focus.trim() : '';
  var validQTypesForGenQ = ['mcq', 'fitb', 'mix'];
  var questionTypeForGenQ = (typeof msgForGenQ.questionType === 'string' && validQTypesForGenQ.indexOf(msgForGenQ.questionType) !== -1) ? msgForGenQ.questionType : 'mix';
  var apiKeyForGenQ = typeof msgForGenQ.apiKey === 'string' ? msgForGenQ.apiKey : '';
  var modelForGenQ = typeof msgForGenQ.model === 'string' ? msgForGenQ.model.trim() : '';

  if (!contentForGenQ) { sendResponseForGenQ({ ok: false, error: 'content is required' }); return; }
  if (!apiKeyForGenQ) { sendResponseForGenQ({ ok: false, error: 'No API key available for question generation' }); return; }
  if (!modelForGenQ) { sendResponseForGenQ({ ok: false, error: 'No model selected' }); return; }

  var requestRecordForGenQ = registerCancellableAgentToolRequestForServiceWorker(msgForGenQ.agentToolRequestId);
  sendResponseForGenQ = wrapCancellableSendResponseForServiceWorker(sendResponseForGenQ, requestRecordForGenQ);

  var typeConstraintForGenQ = questionTypeForGenQ === 'mcq'
    ? 'All questions MUST be MCQ (multiple choice). Do not generate any FITB questions.'
    : questionTypeForGenQ === 'fitb'
      ? 'All questions MUST be FITB (fill-in-the-blank). Do not generate any MCQ questions.'
      : 'You may freely mix MCQ and FITB question types as appropriate for the material.';
  var systemPromptForGenQ = [
    'You are a quiz question generator. Generate exactly ' + countForGenQ + ' quiz question' + (countForGenQ === 1 ? '' : 's') + ' from the provided source material.',
    focusForGenQ ? 'Focus specifically on: ' + focusForGenQ : null,
    typeConstraintForGenQ,
    '',
    'Return ONLY a JSON object with this exact shape and no other text:',
    '{"questions":[{"title":"...","type":"mcq","questionText":"...","options":[{"text":"...","isCorrect":false},{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"correctAnswer":"","alternativeAnswers":[],"caseSensitive":false,"explanation":"..."}]}',
    '',
    'Rules:',
    '- type must be "mcq" or "fitb".',
    '- For MCQ: populate options with exactly 4 entries; set isCorrect:true on exactly one; leave correctAnswer and alternativeAnswers empty.',
    '- For FITB: set options to []; set correctAnswer to the expected answer; list accepted variants in alternativeAnswers. The questionText MUST contain at least one sequence of three or more underscores (e.g. "___") to mark the blank.',
    '- title is a short label for the question (used as its display name).',
    '- explanation briefly explains the correct answer.',
    '- Each question MUST be fully self-contained: the user attempts it later with NO access to the source material, seeing only the question itself (and, for MCQ, its options). Write every question so it can be understood and answered on its own.',
    '- Embed any context needed to answer directly in the questionText, and name the specific subject, topic, or domain the question concerns so the reader is not left guessing what it is about. For example, prefer "In the HTTP protocol, which status code indicates a requested resource was not found?" over "Which status code indicates a requested resource was not found?".',
    '- Do NOT reference the source material or its structure. This covers two patterns. (1) Document-structure references: avoid phrases such as "according to the passage", "the text above", "in the document", "as mentioned", "the author", "the article", "this section", or "the example shown". (2) Referring to a coined idea, framework, model, theory, argument, or claim as if the reader already knows it: avoid bare phrases such as "in this hiring model", "the philosophy argues", "the framework defines", "the stated alternative", or "the proposed approach". The reader has not seen the source, so a bare "this model" or "the philosophy" means nothing to them.',
    '- Do not handle a source-specific idea (a named framework, model, theory, argument, or claim) by stripping it out; instead introduce or attribute it inside the question stem before asking about it, so the reader knows what is being discussed and the question carries its own premise.',
    '- Do not include any text outside the JSON object.',
    '',
    'Examples of self-contained questions (the bad versions reference unseen material or omit the subject; the good versions stand on their own):',
    'MCQ bad: "According to the text, which layer does this protocol operate at?". MCQ good: "In the OSI networking model, at which layer does the TCP protocol operate?" with options "Transport layer" (correct), "Network layer", "Session layer", and "Application layer".',
    'FITB bad: "As the passage states, the powerhouse of the cell is the ___.". FITB good: "In biology, the organelle known as the powerhouse of the cell is the ___." with correctAnswer "mitochondrion".',
    'Source-specific idea bad: "What does AI-mandatory mean in this hiring model?" (assumes the reader already knows the model). Good: "A proposed hiring framework sorts roles by how much they depend on AI tools, using categories such as AI-mandatory. In that framework, what does AI-mandatory mean?" with the four options. Introduce or attribute the framework first so the question stands on its own.'
  ].filter(function (l) { return l !== null; }).join('\n');

  var genQLogStartForServiceWorker = Date.now();
  var genQLoggedForServiceWorker = false;
  var genQRequestMessagesForLog = [
    { role: 'system', content: systemPromptForGenQ },
    { role: 'user', content: contentForGenQ }
  ];
  var genQApiParamsForLog = { stream: false, response_format: { type: 'json_object' }, model: modelForGenQ };
  function logGenQOnceForServiceWorker(fieldsForGenQLog) {
    if (genQLoggedForServiceWorker) return;
    genQLoggedForServiceWorker = true;
    var baseForGenQLog = {
      requestType: 'quiz-generate',
      startTime: genQLogStartForServiceWorker,
      model: modelForGenQ,
      requestMessages: genQRequestMessagesForLog,
      apiParams: genQApiParamsForLog
    };
    for (var kForGenQLog in fieldsForGenQLog) {
      if (Object.prototype.hasOwnProperty.call(fieldsForGenQLog, kForGenQLog)) baseForGenQLog[kForGenQLog] = fieldsForGenQLog[kForGenQLog];
    }
    writeSecondaryLlmLogForServiceWorker(baseForGenQLog);
  }

  try {
    var MAX_RETRIES_FOR_GEN_Q = 2;
    var RETRY_DELAYS_FOR_GEN_Q = [1500, 3000];
    var RETRYABLE_FOR_GEN_Q = [429, 502, 503, 504];
    var responseForGenQ = null;
    var lastErrForGenQ = null;
    for (var retryForGenQ = 0; retryForGenQ <= MAX_RETRIES_FOR_GEN_Q; retryForGenQ++) {
      if (retryForGenQ > 0) {
        await delayForServiceWorker(RETRY_DELAYS_FOR_GEN_Q[retryForGenQ - 1], requestRecordForGenQ ? requestRecordForGenQ.signal : null);
        if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
          logGenQOnceForServiceWorker({ status: 'cancelled' });
          sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
          return;
        }
      }
      lastErrForGenQ = null;
      try {
        responseForGenQ = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKeyForGenQ,
            'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
            'X-OpenRouter-Title': 'Agentic Browser Chat'
          },
          body: JSON.stringify({
            model: modelForGenQ,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPromptForGenQ },
              { role: 'user', content: contentForGenQ }
            ]
          }),
          signal: requestRecordForGenQ ? requestRecordForGenQ.signal : undefined
        });
        if (!responseForGenQ.ok && RETRYABLE_FOR_GEN_Q.indexOf(responseForGenQ.status) !== -1 && retryForGenQ < MAX_RETRIES_FOR_GEN_Q) {
          lastErrForGenQ = new Error('HTTP ' + responseForGenQ.status);
          responseForGenQ = null;
          continue;
        }
        break;
      } catch (fetchErrForGenQ) {
        if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
          logGenQOnceForServiceWorker({ status: 'cancelled' });
          sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
          return;
        }
        lastErrForGenQ = fetchErrForGenQ;
        if (retryForGenQ >= MAX_RETRIES_FOR_GEN_Q) break;
      }
    }

    if (lastErrForGenQ) throw lastErrForGenQ;
    if (!responseForGenQ.ok) {
      var errTextForGenQ = '';
      try { errTextForGenQ = await responseForGenQ.text(); } catch (e) {}
      logGenQOnceForServiceWorker({ status: 'error', errorMessage: 'API error ' + responseForGenQ.status + ': ' + errTextForGenQ.slice(0, 200), responseContent: '' });
      sendResponseForGenQ({ ok: false, error: 'Question generation API error ' + responseForGenQ.status + ': ' + errTextForGenQ.slice(0, 200) });
      return;
    }
    if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
      logGenQOnceForServiceWorker({ status: 'cancelled' });
      sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    var jsonForGenQ = await responseForGenQ.json();
    var rawContentForGenQ = jsonForGenQ.choices && jsonForGenQ.choices[0] && jsonForGenQ.choices[0].message
      ? (jsonForGenQ.choices[0].message.content || '')
      : '';
    logGenQOnceForServiceWorker({
      status: 'success',
      model: (jsonForGenQ && jsonForGenQ.model) || modelForGenQ,
      responseContent: rawContentForGenQ,
      usage: (jsonForGenQ && jsonForGenQ.usage) || null
    });

    var parsedForGenQ = null;
    try { parsedForGenQ = JSON.parse(rawContentForGenQ); } catch (e) {}
    if (!parsedForGenQ) {
      var jsonMatchForGenQ = rawContentForGenQ.match(/\{[\s\S]*\}/);
      if (jsonMatchForGenQ) {
        try { parsedForGenQ = JSON.parse(jsonMatchForGenQ[0]); } catch (e) {}
      }
    }

    var questionsForGenQ = parsedForGenQ && Array.isArray(parsedForGenQ.questions) ? parsedForGenQ.questions : null;
    if (!questionsForGenQ || questionsForGenQ.length === 0) {
      sendResponseForGenQ({ ok: false, error: 'No questions returned by model. Raw response: ' + rawContentForGenQ.slice(0, 200) });
      return;
    }

    questionsForGenQ = await reviewQuestionsSelfContainmentForServiceWorker(questionsForGenQ, apiKeyForGenQ, modelForGenQ, requestRecordForGenQ ? requestRecordForGenQ.signal : null);
    if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
      logGenQOnceForServiceWorker({ status: 'cancelled' });
      sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    var validatedForGenQ = [];
    var validationErrorsForGenQ = [];
    for (var viForGenQ = 0; viForGenQ < questionsForGenQ.length; viForGenQ++) {
      var qForGenQ = questionsForGenQ[viForGenQ];
      var idxLabelForGenQ = 'Question ' + (viForGenQ + 1);
      if (!qForGenQ || typeof qForGenQ !== 'object') {
        validationErrorsForGenQ.push(idxLabelForGenQ + ': not an object');
        continue;
      }
      var issuesForGenQ = validateQuestionForServiceWorker(qForGenQ);
      if (issuesForGenQ.length > 0) {
        var fixedForGenQ = await fixQuestionForServiceWorker(qForGenQ, issuesForGenQ, apiKeyForGenQ, modelForGenQ);
        if (!fixedForGenQ) {
          validationErrorsForGenQ.push(idxLabelForGenQ + ': fix attempt returned no result (original issues: ' + issuesForGenQ.join('; ') + ')');
          continue;
        }
        var retryIssuesForGenQ = validateQuestionForServiceWorker(fixedForGenQ);
        if (retryIssuesForGenQ.length > 0) {
          validationErrorsForGenQ.push(idxLabelForGenQ + ': still invalid after fix attempt (' + retryIssuesForGenQ.join('; ') + ')');
          continue;
        }
        qForGenQ = fixedForGenQ;
      }
      validatedForGenQ.push(qForGenQ);
    }

    if (validatedForGenQ.length === 0) {
      sendResponseForGenQ({ ok: false, error: 'All generated questions failed validation: ' + validationErrorsForGenQ.join('; ') });
      return;
    }

    var responsePayloadForGenQ = { ok: true, questions: validatedForGenQ };
    if (validationErrorsForGenQ.length > 0) responsePayloadForGenQ.validationWarnings = validationErrorsForGenQ;
    sendResponseForGenQ(responsePayloadForGenQ);
  } catch (errForGenQ) {
    if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
      logGenQOnceForServiceWorker({ status: 'cancelled' });
      sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }
    logGenQOnceForServiceWorker({ status: 'error', errorMessage: (errForGenQ && errForGenQ.message) || 'Question generation failed', responseContent: '' });
    sendResponseForGenQ({ ok: false, error: (errForGenQ && errForGenQ.message) || 'Question generation failed' });
  }
}

async function handleAgentWebFetchForServiceWorker(msgForFetch, sendResponseForFetch) {
  var urlForFetch = typeof msgForFetch.url === 'string' ? msgForFetch.url : '';
  var methodForFetch = typeof msgForFetch.method === 'string' ? msgForFetch.method.toUpperCase() : 'GET';
  var bodyForFetch = typeof msgForFetch.body === 'string' ? msgForFetch.body : null;
  var headersForFetch = (msgForFetch.headers && typeof msgForFetch.headers === 'object' && !Array.isArray(msgForFetch.headers))
    ? msgForFetch.headers
    : {};

  if (urlForFetch.startsWith('http://')) {
    urlForFetch = 'https://' + urlForFetch.slice(7);
  }

  if (!urlForFetch.startsWith('https://')) {
    sendResponseForFetch({ ok: false, error: 'Invalid URL: must begin with http:// or https://' });
    return;
  }

  var requestRecordForFetch = registerCancellableAgentToolRequestForServiceWorker(msgForFetch.agentToolRequestId);
  sendResponseForFetch = wrapCancellableSendResponseForServiceWorker(sendResponseForFetch, requestRecordForFetch);

  if (methodForFetch === 'GET') {
    if (requestRecordForFetch && requestRecordForFetch.signal.aborted) {
      sendResponseForFetch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }
    // Check open tabs before cache or network: a tab has authenticated, rendered content
    // that a network fetch cannot access when the page is behind a login or network block.
    try {
      var normalizedRequestUrlForFetch = (function (u) {
        try { var p = new URL(u); p.hash = ''; return p.toString(); } catch (_) { return u; }
      })(urlForFetch);
      var allTabsForFetch = await queryTabsForServiceWorker({});
      var matchingTabForFetch = null;
      for (var ti = 0; ti < allTabsForFetch.length; ti++) {
        var tabForFetch = allTabsForFetch[ti];
        if (!tabForFetch || typeof tabForFetch.url !== 'string') continue;
        var normalizedTabUrlForFetch = (function (u) {
          try { var p = new URL(u); p.hash = ''; return p.toString(); } catch (_) { return u; }
        })(tabForFetch.url);
        if (normalizedTabUrlForFetch === normalizedRequestUrlForFetch) {
          matchingTabForFetch = tabForFetch;
          break;
        }
      }
      if (matchingTabForFetch && typeof matchingTabForFetch.id === 'number') {
        var tabContentResultForFetch = await getTabPageContentForServiceWorker(matchingTabForFetch.id);
        if (tabContentResultForFetch && tabContentResultForFetch.ok) {
          sendResponseForFetch({
            ok: true,
            url: urlForFetch,
            title: typeof matchingTabForFetch.title === 'string' ? matchingTabForFetch.title : '',
            content: tabContentResultForFetch.content,
            isHtml: true
          });
        } else {
          sendResponseForFetch({
            ok: false,
            error: 'The page is open in a tab but its content could not be read' +
              (tabContentResultForFetch && tabContentResultForFetch.error ? ': ' + tabContentResultForFetch.error : '.')
          });
        }
        return;
      }
    } catch (_tabFetchErrForFetch) {}

    var cachedDataForFetch = await getWebFetchCacheEntryForServiceWorker(urlForFetch);
    if (cachedDataForFetch) {
      sendResponseForFetch(cachedDataForFetch);
      return;
    }
  }

  var fetchOptsForFetch = { method: methodForFetch, headers: headersForFetch, signal: null };
  if (bodyForFetch !== null && methodForFetch !== 'GET' && methodForFetch !== 'HEAD') {
    fetchOptsForFetch.body = bodyForFetch;
  }

  try {
    var controllerForFetch = requestRecordForFetch ? requestRecordForFetch.controller : new AbortController();
    fetchOptsForFetch.signal = controllerForFetch.signal;
    var timeoutIdForFetch = setTimeout(function () { controllerForFetch.abort(); }, 15000);
    var responseForFetch;
    try {
      responseForFetch = await fetch(urlForFetch, fetchOptsForFetch);
    } catch (fetchErrForFetch) {
      sendResponseForFetch({
        ok: false,
        cancelled: Boolean(requestRecordForFetch && requestRecordForFetch.signal.aborted),
        error: fetchErrForFetch.name === 'AbortError' && requestRecordForFetch && requestRecordForFetch.signal.aborted
          ? 'Cancelled'
          : fetchErrForFetch.name === 'AbortError'
          ? 'Fetch timeout: no response after 15000ms'
          : 'Fetch failed: ' + (fetchErrForFetch.message || String(fetchErrForFetch))
      });
      return;
    } finally {
      clearTimeout(timeoutIdForFetch);
    }

    if (!responseForFetch.ok) {
      sendResponseForFetch({ ok: false, error: 'HTTP error: ' + responseForFetch.status + ' ' + responseForFetch.statusText });
      return;
    }
    if (requestRecordForFetch && requestRecordForFetch.signal.aborted) {
      sendResponseForFetch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    var finalUrlForFetch = responseForFetch.url || urlForFetch;
    if (finalUrlForFetch && finalUrlForFetch !== urlForFetch) {
      try {
        var origHostForFetch = new URL(urlForFetch).hostname;
        var finalHostForFetch = new URL(finalUrlForFetch).hostname;
        if (origHostForFetch !== finalHostForFetch) {
          sendResponseForFetch({
            ok: false,
            error: 'Cross-host redirect: "' + urlForFetch + '" redirected to "' + finalUrlForFetch + '". Use web_fetch with the new URL explicitly if needed.'
          });
          return;
        }
      } catch (_urlErrForFetch) {}
    }

    var contentTypeForFetch = (responseForFetch.headers.get('content-type') || '').toLowerCase();
    var mimeTypeBaseForFetch = contentTypeForFetch.split(';')[0].trim();

    // Image handling: fetch as ArrayBuffer, base64-encode, return for vision analysis.
    var IMAGE_MIMES_FOR_FETCH = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (IMAGE_MIMES_FOR_FETCH.indexOf(mimeTypeBaseForFetch) !== -1) {
      var MAX_IMAGE_BYTES_FOR_FETCH = 10 * 1024 * 1024;
      var imageBufForFetch;
      try { imageBufForFetch = await responseForFetch.arrayBuffer(); } catch (e) {
        sendResponseForFetch({ ok: false, error: 'Failed to read image: ' + (e && e.message || String(e)) });
        return;
      }
      if (requestRecordForFetch && requestRecordForFetch.signal.aborted) {
        sendResponseForFetch({ ok: false, cancelled: true, error: 'Cancelled' });
        return;
      }
      if (imageBufForFetch.byteLength > MAX_IMAGE_BYTES_FOR_FETCH) {
        sendResponseForFetch({ ok: false, error: 'Image too large (' + imageBufForFetch.byteLength + ' bytes; max 10 MB).' });
        return;
      }
      var imageBytesForFetch = new Uint8Array(imageBufForFetch);
      var imageBinaryForFetch = '';
      var CHUNK_FOR_FETCH = 8192;
      for (var ci = 0; ci < imageBytesForFetch.length; ci += CHUNK_FOR_FETCH) {
        imageBinaryForFetch += String.fromCharCode.apply(null, imageBytesForFetch.subarray(ci, ci + CHUNK_FOR_FETCH));
      }
      var imageDataUrlForFetch = 'data:' + mimeTypeBaseForFetch + ';base64,' + btoa(imageBinaryForFetch);
      var imageResponseForCache = {
        ok: true,
        url: finalUrlForFetch || urlForFetch,
        isImage: true,
        mimeType: mimeTypeBaseForFetch,
        dataUrl: imageDataUrlForFetch,
        size: imageBufForFetch.byteLength
      };
      var IMAGE_CACHE_MAX_DATAURL_FOR_FETCH = 2 * 1024 * 1024; // skip cache for dataUrls > 2 MB
      if (methodForFetch === 'GET' && imageDataUrlForFetch.length <= IMAGE_CACHE_MAX_DATAURL_FOR_FETCH) {
        await setWebFetchCacheEntryForServiceWorker(urlForFetch, imageResponseForCache);
      }
      sendResponseForFetch(imageResponseForCache);
      return;
    }

    // Document handling: fetch as ArrayBuffer, parse in-place, return extracted text.
    var DOC_MIMES_FOR_FETCH = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    var DOC_EXTS_FOR_FETCH = ['pdf', 'docx', 'xlsx', 'xls', 'ods', 'pptx'];
    var urlPathForDocExtCheck = (finalUrlForFetch || urlForFetch).split('?')[0].toLowerCase();
    var urlExtForFetch = urlPathForDocExtCheck.split('.').pop() || '';
    var isDocTypeForFetch = DOC_MIMES_FOR_FETCH.indexOf(mimeTypeBaseForFetch) !== -1 ||
      (mimeTypeBaseForFetch === 'application/octet-stream' && DOC_EXTS_FOR_FETCH.indexOf(urlExtForFetch) !== -1);

    if (isDocTypeForFetch) {
      var MAX_DOC_BYTES_FOR_FETCH = 50 * 1024 * 1024;
      var docBufForFetch;
      try { docBufForFetch = await responseForFetch.arrayBuffer(); } catch (e) {
        sendResponseForFetch({ ok: false, error: 'Failed to read document: ' + (e && e.message || String(e)) });
        return;
      }
      if (requestRecordForFetch && requestRecordForFetch.signal.aborted) {
        sendResponseForFetch({ ok: false, cancelled: true, error: 'Cancelled' });
        return;
      }
      if (docBufForFetch.byteLength > MAX_DOC_BYTES_FOR_FETCH) {
        sendResponseForFetch({ ok: false, error: 'Document too large (' + docBufForFetch.byteLength + ' bytes; max 50 MB).' });
        return;
      }
      if (!fileParsingForServiceWorker || typeof fileParsingForServiceWorker.parseFileBuffer !== 'function') {
        sendResponseForFetch({ ok: false, error: 'File parser unavailable.' });
        return;
      }
      var fileNameForDocFetch = urlPathForDocExtCheck.split('/').pop() || 'document';
      var mimeForParseFetch = mimeTypeBaseForFetch !== 'application/octet-stream'
        ? mimeTypeBaseForFetch
        : ('application/' + urlExtForFetch);
      try {
        var docParseResultForFetch = await fileParsingForServiceWorker.parseFileBuffer(
          fileNameForDocFetch, mimeForParseFetch, docBufForFetch
        );
        var docResponseForCache = {
          ok: true,
          url: finalUrlForFetch || urlForFetch,
          isDocument: true,
          mimeType: mimeTypeBaseForFetch,
          fileName: fileNameForDocFetch,
          text: docParseResultForFetch && docParseResultForFetch.text ? docParseResultForFetch.text : '',
          truncated: Boolean(docParseResultForFetch && docParseResultForFetch.truncated),
          size: docBufForFetch.byteLength
        };
        if (methodForFetch === 'GET') {
          await setWebFetchCacheEntryForServiceWorker(urlForFetch, docResponseForCache);
        }
        sendResponseForFetch(docResponseForCache);
      } catch (docErrForFetch) {
        sendResponseForFetch({ ok: false, error: 'Document parsing failed: ' + (docErrForFetch && docErrForFetch.message || String(docErrForFetch)) });
      }
      return;
    }

    var isBinaryForFetch = contentTypeForFetch.includes('application/') &&
      !contentTypeForFetch.includes('json') &&
      !contentTypeForFetch.includes('xml') &&
      !contentTypeForFetch.includes('text');
    if (isBinaryForFetch) {
      sendResponseForFetch({ ok: false, error: 'Unsupported content type: ' + mimeTypeBaseForFetch });
      return;
    }

    var rawTextForFetch = await responseForFetch.text();
    if (requestRecordForFetch && requestRecordForFetch.signal.aborted) {
      sendResponseForFetch({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }
    var titleMatchForFetch = rawTextForFetch.match(/<title[^>]*>([^<]*)<\/title>/i);
    var titleForFetch = titleMatchForFetch ? titleMatchForFetch[1].trim() : '';
    var isHtmlForFetch = contentTypeForFetch.includes('text/html') || rawTextForFetch.trimStart().startsWith('<');

    var successResponseForFetch = {
      ok: true,
      url: urlForFetch,
      title: titleForFetch,
      content: rawTextForFetch,
      isHtml: isHtmlForFetch
    };
    if (methodForFetch === 'GET') {
      await setWebFetchCacheEntryForServiceWorker(urlForFetch, successResponseForFetch);
    }
    sendResponseForFetch(successResponseForFetch);
  } catch (errForFetch) {
    sendResponseForFetch({ ok: false, error: (errForFetch && errForFetch.message) || 'Unexpected fetch error' });
  }
}

// --- Offscreen document (shared host: audio playback + agent run loop) ---

// Only one offscreen document may exist per extension, so audio playback and the
// agent orchestration loop share it. All capability reasons are declared up front
// at creation time because an existing document's reasons cannot be changed without
// closing it: WORKERS (the eval tool's sandbox Worker), DOM_PARSER (create_document's
// DOMParser), BLOBS (generated file/blob URLs), AUDIO_PLAYBACK (reminder beep).
const OFFSCREEN_URL_FOR_SERVICE_WORKER = 'offscreen/offscreen.html';
const OFFSCREEN_REASONS_FOR_SERVICE_WORKER = ['AUDIO_PLAYBACK', 'WORKERS', 'DOM_PARSER', 'BLOBS'];

// Concurrent callers must not both call createDocument (Chrome throws "Only a single
// offscreen document may be created"). Serialize creation behind one in-flight promise.
let offscreenCreateInFlightForServiceWorker = null;
// Keepalive refcount: while > 0 an agent run (or other long-lived consumer) needs the
// document kept open. Audio playback is fire-and-forget and does not take a ref. The
// document is currently never proactively closed; the refcount exists so future cleanup
// can avoid closing the doc out from under an active run.
let offscreenKeepAliveRefCountForServiceWorker = 0;

async function offscreenDocumentExistsForServiceWorker() {
  if (!chrome.offscreen) return false;
  var offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL_FOR_SERVICE_WORKER);
  try {
    var existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return existingContexts.length > 0;
  } catch (e) {
    // getContexts not available in older Chrome; fall back to attempting creation.
    return false;
  }
}

async function ensureOffscreenDocumentForServiceWorker() {
  if (!chrome.offscreen) return false;
  if (await offscreenDocumentExistsForServiceWorker()) return true;
  if (offscreenCreateInFlightForServiceWorker) {
    try { await offscreenCreateInFlightForServiceWorker; } catch (e) { /* fall through */ }
    return offscreenDocumentExistsForServiceWorker();
  }
  offscreenCreateInFlightForServiceWorker = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL_FOR_SERVICE_WORKER,
    reasons: OFFSCREEN_REASONS_FOR_SERVICE_WORKER,
    justification: 'Play reminder alerts and host the agent run loop so it survives page reloads.'
  });
  try {
    await offscreenCreateInFlightForServiceWorker;
    return true;
  } catch (e) {
    // A concurrent create may have already won the race; treat an existing doc as success.
    return offscreenDocumentExistsForServiceWorker();
  } finally {
    offscreenCreateInFlightForServiceWorker = null;
  }
}

function acquireOffscreenKeepAliveForServiceWorker() {
  offscreenKeepAliveRefCountForServiceWorker += 1;
}

function releaseOffscreenKeepAliveForServiceWorker() {
  offscreenKeepAliveRefCountForServiceWorker = Math.max(0, offscreenKeepAliveRefCountForServiceWorker - 1);
}

// Deliver agentRunStart to the offscreen document, retrying until it acks. Right after the
// offscreen document is created its scripts are still loading, so the first send can land
// before agentRun.js has registered its listener and would be silently dropped. The offscreen
// listener responds { ok: true }; we retry on a missing/failed ack a few times, then give up
// and reset the initiator's UI by synthesizing a stream_end for that chat.
const AGENT_RUN_START_MAX_RETRIES_FOR_SERVICE_WORKER = 8;
const AGENT_RUN_START_RETRY_DELAY_MS_FOR_SERVICE_WORKER = 250;

function deliverAgentRunStartForServiceWorker(paramsForDeliver, attemptForDeliver) {
  chrome.runtime.sendMessage({ action: "agentRunStart", params: paramsForDeliver }, function (respForDeliver) {
    const ackedForDeliver = !chrome.runtime.lastError && respForDeliver && respForDeliver.ok === true;
    if (ackedForDeliver) return;
    if (attemptForDeliver < AGENT_RUN_START_MAX_RETRIES_FOR_SERVICE_WORKER) {
      setTimeout(function () {
        deliverAgentRunStartForServiceWorker(paramsForDeliver, attemptForDeliver + 1);
      }, AGENT_RUN_START_RETRY_DELAY_MS_FOR_SERVICE_WORKER);
      return;
    }
    // Gave up. Release the keepalive ref taken at agentRunStart and clear the run mapping,
    // then tell every tab the run ended so the initiator stops showing "working".
    releaseOffscreenKeepAliveForServiceWorker();
    const chatIdForGiveUp = Number(paramsForDeliver && paramsForDeliver.chatId);
    if (!Number.isFinite(chatIdForGiveUp)) return;
    offscreenRunTargetTabsForServiceWorker.delete(chatIdForGiveUp);
    streamSnapshotsForServiceWorker.delete(chatIdForGiveUp);
    const deliverActionForGiveUp = actionsForServiceWorker.streamReceiverDeliver || "streamReceiverDeliver";
    chrome.tabs.query({}, function (tabsForGiveUp) {
      if (!Array.isArray(tabsForGiveUp)) return;
      for (var iForGiveUp = 0; iForGiveUp < tabsForGiveUp.length; iForGiveUp++) {
        var tabForGiveUp = tabsForGiveUp[iForGiveUp];
        if (!tabForGiveUp || typeof tabForGiveUp.id !== "number") continue;
        try {
          chrome.tabs.sendMessage(tabForGiveUp.id, {
            action: deliverActionForGiveUp,
            event: "stream_end",
            chatId: chatIdForGiveUp,
            originatorTabId: null,
            payload: { orphaned: true }
          }, function () { void chrome.runtime.lastError; });
        } catch (errForGiveUp) {}
      }
    });
  });
}

async function playReminderBeepViaOffscreenForServiceWorker() {
  var ensured = await ensureOffscreenDocumentForServiceWorker();
  if (!ensured) return;
  chrome.runtime.sendMessage({ action: 'playReminderBeep' }, function () {
    if (chrome.runtime.lastError) { /* offscreen not ready yet */ }
  });
}

// --- Reminder alarm system ---

const REMINDER_ALARM_NAME_FOR_SERVICE_WORKER = 'abchat-reminder-check';
const NOTIFIED_REMINDERS_KEY_FOR_SERVICE_WORKER = 'abchat_notified_reminders';

function ensureReminderAlarmForServiceWorker() {
  if (!chrome.alarms) return;
  chrome.alarms.get(REMINDER_ALARM_NAME_FOR_SERVICE_WORKER, function (existingAlarm) {
    if (!existingAlarm) {
      chrome.alarms.create(REMINDER_ALARM_NAME_FOR_SERVICE_WORKER, { periodInMinutes: 1 });
    }
  });
}

async function checkDueRemindersForServiceWorker() {
  var repo = globalThis.ABChatShared && globalThis.ABChatShared.panelDataRepo;
  if (!repo) return;

  var nowForReminder = Date.now();
  var windowMsForReminder = 2 * 60 * 1000;

  var tasks;
  try {
    tasks = await repo.listTasks();
  } catch (e) {
    return;
  }

  var notifiedMap = await new Promise(function (resolve) {
    chrome.storage.local.get([NOTIFIED_REMINDERS_KEY_FOR_SERVICE_WORKER], function (res) {
      resolve((res && res[NOTIFIED_REMINDERS_KEY_FOR_SERVICE_WORKER]) || {});
    });
  });

  var dueTasks = tasks.filter(function (t) {
    if (t.isCompleted || !t.reminderAt) return false;
    var reminderTs = new Date(t.reminderAt).getTime();
    if (isNaN(reminderTs)) return false;
    return reminderTs <= nowForReminder && reminderTs > nowForReminder - windowMsForReminder;
  });

  // Key includes the reminder timestamp so changing the reminder time to a new
  // value is treated as a fresh notification rather than a repeat.
  var toNotify = dueTasks.filter(function (t) {
    var key = t.id + ':' + new Date(t.reminderAt).getTime();
    return !notifiedMap[key];
  });
  if (toNotify.length === 0) return;

  toNotify.forEach(function (t) {
    var key = t.id + ':' + new Date(t.reminderAt).getTime();
    notifiedMap[key] = nowForReminder;
  });
  Object.keys(notifiedMap).forEach(function (k) {
    if (nowForReminder - notifiedMap[k] > 86400000) delete notifiedMap[k];
  });
  chrome.storage.local.set({ [NOTIFIED_REMINDERS_KEY_FOR_SERVICE_WORKER]: notifiedMap });

  // Read alertSound setting from sync storage
  var savedSettings = await new Promise(function (resolve) {
    chrome.storage.sync.get(['abchatSettings'], function (res) {
      resolve((res && res.abchatSettings) || {});
    });
  });
  var alertSoundOnForReminder = savedSettings.alertSound !== false;

  var iconUrlForReminder = chrome.runtime.getURL('icon.png');

  toNotify.forEach(function (task) {
    var taskTitleForReminder = task.title || 'Task reminder';

    // OS notification (visual popup; always shown for due reminders)
    if (chrome.notifications) {
      chrome.notifications.create('abchat-reminder-' + task.id, {
        type: 'basic',
        iconUrl: iconUrlForReminder,
        title: 'Reminder',
        message: taskTitleForReminder
      });
    }

    // Offscreen audio beep (reliable sound via extension context; respects alertSound setting)
    if (alertSoundOnForReminder) {
      playReminderBeepViaOffscreenForServiceWorker();
    }

    // In-page toast: send only to active tabs (one per window) to avoid stacking
    chrome.tabs.query({ active: true }, function (activeTabs) {
      if (!activeTabs) return;
      activeTabs.forEach(function (tab) {
        if (!tab.id) return;
        chrome.tabs.sendMessage(
          tab.id,
          { action: 'playReminderSound', taskTitle: taskTitleForReminder },
          function () { if (chrome.runtime.lastError) { /* tab not ready */ } }
        );
      });
    });
  });
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === REMINDER_ALARM_NAME_FOR_SERVICE_WORKER) {
      checkDueRemindersForServiceWorker();
    }
  });
}

chrome.runtime.onInstalled.addListener(async (detailsForServiceWorker) => {
  // Rebuild context menus for the new/updated manifest.
  contextMenusForServiceWorker.rebuildContextMenus();
  // Recover all currently open tabs immediately after reload/update so users do not
  // see stale highlights while waiting to open popup or interact with the extension.
  await runReloadRecoveryWithRetriesForServiceWorker();
  cleanExpiredWebFetchCacheForServiceWorker();
  ensureReminderAlarmForServiceWorker();
  // One-time notice for existing users after the update that introduced the required debugger
  // permission and advanced automation, so the re-consent they just went through is explained and
  // the (off-by-default) feature is discoverable. Only on update, only once ever.
  if (detailsForServiceWorker && detailsForServiceWorker.reason === "update") {
    try {
      chrome.storage.local.get("abchatAutomationIntroSeen", function (introItemsForServiceWorker) {
        if (!(introItemsForServiceWorker && introItemsForServiceWorker.abchatAutomationIntroSeen)) {
          chrome.storage.local.set({ abchatAutomationIntroPending: true });
        }
      });
    } catch (introErrForServiceWorker) {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  contextMenusForServiceWorker.rebuildContextMenus();
  await runReloadRecoveryWithRetriesForServiceWorker();
  cleanExpiredWebFetchCacheForServiceWorker();
  ensureReminderAlarmForServiceWorker();
});

// Run a one-time automatic recovery when this service-worker session boots, so stale
// highlights are cleared right after extension reload even before popup is opened.
runStartupRecoveryOncePerSessionForServiceWorker();
ensureReminderAlarmForServiceWorker();
initActiveTabTrackingForServiceWorker();

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tabForServiceWorker) => {
    toggleFloatingPanelFromActionButtonForServiceWorker(tabForServiceWorker);
  });
}

chrome.tabs.onActivated.addListener((activeInfoForServiceWorker) => {
  // Keep panel visibility pinned to the active tab in the focused Chrome window.
  enforceStoredPanelVisibilityForServiceWorker();
  if (activeInfoForServiceWorker && typeof activeInfoForServiceWorker.tabId === "number") {
    setCurrentActiveTabForServiceWorker(activeInfoForServiceWorker.tabId);
  }
});

if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(function (windowIdForFocusChange) {
    // WINDOW_ID_NONE = focus moved to another app entirely. Skip enforce
    // entirely: enforceStoredPanelVisibility's "no focused window" branch
    // closes the panel in every tab, which is exactly the bug we're fixing.
    // Keep the previously active tab and its panel as-is until the user
    // picks a different tab/window inside the browser.
    if (typeof windowIdForFocusChange !== "number" || windowIdForFocusChange === chrome.windows.WINDOW_ID_NONE) return;
    enforceStoredPanelVisibilityForServiceWorker();
    setActiveTabFromWindowForServiceWorker(windowIdForFocusChange);
  });
}

chrome.tabs.onUpdated.addListener((tabIdForServiceWorker, changeInfoForServiceWorker, tabForServiceWorker) => {
  if (changeInfoForServiceWorker.status === "complete") {
    enforceStoredPanelVisibilityForServiceWorker();
  }
  // Orphan detection on navigation: the originator's content script
  // dies on page navigation without ever firing AbortController.abort, so the
  // streaming fetch silently terminates and no stream_end is broadcast.
  // Detect via the status==='loading' transition and synthesize stream_end
  // so receivers don't sit forever with a loading bubble.
  if (changeInfoForServiceWorker.status === "loading") {
    handleStreamOriginatorGoneForServiceWorker(tabIdForServiceWorker);
  }
});

// Orphan detection on tab close: same idea as navigation, for the
// case where the user closes the originator tab while it's mid-stream.
chrome.tabs.onRemoved.addListener(function (tabIdForStreamCleanup /*, removeInfo */) {
  handleStreamOriginatorGoneForServiceWorker(tabIdForStreamCleanup);
  pruneAgentCreatedTabOnRemovedForServiceWorker(tabIdForStreamCleanup);
  enforceStoredPanelVisibilityForServiceWorker();
  if (tabIdForStreamCleanup === currentActiveTabIdForServiceWorker) {
    // The previously active tab is gone. Re-resolve from the currently focused
    // window so the next state-sync gate sees the right tab.
    currentActiveTabIdForServiceWorker = null;
    initActiveTabTrackingForServiceWorker();
  }
});

function handleStreamOriginatorGoneForServiceWorker(tabIdForCleanup) {
  if (typeof tabIdForCleanup !== "number") return;
  if (!streamSnapshotsForServiceWorker || streamSnapshotsForServiceWorker.size === 0) return;
  const orphanedChatIdsForCleanup = [];
  streamSnapshotsForServiceWorker.forEach(function (snapshotForCleanup, chatIdForCleanup) {
    // Offscreen-hosted runs survive a page reload by design: the loop lives in the
    // offscreen document, not this tab, so do NOT synthesize stream_end for them. The
    // reloaded panel re-subscribes via the snapshot request and the run continues.
    if (snapshotForCleanup && snapshotForCleanup.hostedOffscreen) return;
    if (snapshotForCleanup && snapshotForCleanup.originatorTabId === tabIdForCleanup) {
      orphanedChatIdsForCleanup.push(chatIdForCleanup);
    }
  });
  if (orphanedChatIdsForCleanup.length === 0) return;

  const deliverActionForOrphan = actionsForServiceWorker.streamReceiverDeliver || "streamReceiverDeliver";
  chrome.tabs.query({}, function (tabsForOrphanBroadcast) {
    if (!Array.isArray(tabsForOrphanBroadcast)) return;
    orphanedChatIdsForCleanup.forEach(function (orphanedChatIdForBroadcast) {
      streamSnapshotsForServiceWorker.delete(orphanedChatIdForBroadcast);
      for (var iForOrphan = 0; iForOrphan < tabsForOrphanBroadcast.length; iForOrphan++) {
        var tabForOrphan = tabsForOrphanBroadcast[iForOrphan];
        if (!tabForOrphan || typeof tabForOrphan.id !== "number") continue;
        if (tabForOrphan.id === tabIdForCleanup) continue;
        try {
          chrome.tabs.sendMessage(
            tabForOrphan.id,
            {
              action: deliverActionForOrphan,
              event: "stream_end",
              chatId: orphanedChatIdForBroadcast,
              originatorTabId: tabIdForCleanup,
              payload: { orphaned: true }
            },
            function () { void chrome.runtime.lastError; }
          );
        } catch (errorForOrphan) {}
      }
    });
  });
}

chrome.contextMenus.onClicked.addListener((infoForServiceWorker, tabForServiceWorker) => {
  const actionForServiceWorker = contextMenusForServiceWorker.getActionByMenuId(infoForServiceWorker.menuItemId);
  if (!actionForServiceWorker) {
    return;
  }
  runActionOnTabForServiceWorker(
    tabForServiceWorker,
    actionForServiceWorker,
    "contextMenu",
    {
      selectedText: infoForServiceWorker && typeof infoForServiceWorker.selectionText === "string"
        ? infoForServiceWorker.selectionText
        : "",
      srcUrl: infoForServiceWorker && typeof infoForServiceWorker.srcUrl === "string"
        ? infoForServiceWorker.srcUrl
        : "",
      menuItemId: infoForServiceWorker && infoForServiceWorker.menuItemId ? String(infoForServiceWorker.menuItemId) : ""
    }
  );
});

var connectivityProbeCacheForServiceWorker = { reachable: null, ts: 0 };
var CONNECTIVITY_PROBE_TARGETS_FOR_SERVICE_WORKER = ['https://openrouter.ai', 'https://www.gstatic.com/generate_204'];
var CONNECTIVITY_PROBE_TIMEOUT_MS_FOR_SERVICE_WORKER = 2500;
var CONNECTIVITY_PROBE_CACHE_TTL_MS_FOR_SERVICE_WORKER = 5000;

function probeSingleTargetReachableForServiceWorker(targetUrlForProbe, timeoutMsForProbe) {
  return new Promise(function (resolveForSingleProbe) {
    var controllerForSingleProbe = new AbortController();
    var timeoutIdForSingleProbe = setTimeout(function () {
      try { controllerForSingleProbe.abort(); } catch (abortErrForProbe) {}
    }, timeoutMsForProbe);
    fetch(targetUrlForProbe, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controllerForSingleProbe.signal })
      .then(function () {
        clearTimeout(timeoutIdForSingleProbe);
        resolveForSingleProbe(true);
      })
      .catch(function () {
        clearTimeout(timeoutIdForSingleProbe);
        resolveForSingleProbe(false);
      });
  });
}

function probeReachableAnyForServiceWorker(targetsForProbe, timeoutMsForProbe) {
  return new Promise(function (resolveForAnyProbe) {
    var remainingForProbe = targetsForProbe.length;
    if (remainingForProbe === 0) { resolveForAnyProbe(false); return; }
    var settledForProbe = false;
    targetsForProbe.forEach(function (targetUrlForAnyProbe) {
      probeSingleTargetReachableForServiceWorker(targetUrlForAnyProbe, timeoutMsForProbe)
        .then(function (reachableForAnyProbe) {
          if (settledForProbe) return;
          if (reachableForAnyProbe) {
            settledForProbe = true;
            resolveForAnyProbe(true);
            return;
          }
          remainingForProbe -= 1;
          if (remainingForProbe <= 0) {
            settledForProbe = true;
            resolveForAnyProbe(false);
          }
        });
    });
  });
}

async function handleConnectivityProbeForServiceWorker(messageForProbe, sendResponseForProbe) {
  var nowForProbe = Date.now();
  if (connectivityProbeCacheForServiceWorker.reachable !== null &&
      (nowForProbe - connectivityProbeCacheForServiceWorker.ts) < CONNECTIVITY_PROBE_CACHE_TTL_MS_FOR_SERVICE_WORKER) {
    sendResponseForProbe({ ok: true, reachable: connectivityProbeCacheForServiceWorker.reachable, cached: true });
    return;
  }
  var reachableForProbe = await probeReachableAnyForServiceWorker(
    CONNECTIVITY_PROBE_TARGETS_FOR_SERVICE_WORKER,
    CONNECTIVITY_PROBE_TIMEOUT_MS_FOR_SERVICE_WORKER
  );
  connectivityProbeCacheForServiceWorker = { reachable: reachableForProbe, ts: Date.now() };
  sendResponseForProbe({ ok: true, reachable: reachableForProbe });
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((commandForServiceWorker) => {
    const actionForServiceWorker = commandsForServiceWorker.getActionForCommand(commandForServiceWorker);
    if (!actionForServiceWorker) {
      return;
    }
    runActionOnActiveTabForServiceWorker(actionForServiceWorker, "command");
  });
}

chrome.runtime.onMessage.addListener((messageForServiceWorker, senderForServiceWorker, sendResponseForServiceWorker) => {
  if (!messageForServiceWorker || !messageForServiceWorker.type && !messageForServiceWorker.action) {
    return false;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.contentScriptReady || "contentScriptReady")) {
    // Content script is ready - acknowledge
    return false;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.ping || "ping")) {
    // Content script is pinging to wake service worker
    return false;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.resolvePanelStateForTab || "resolvePanelStateForTab")) {
    // Authoritative single source of truth for "should THIS tab show the panel
    // right now?" = global isOpen AND this tab is the active tab. Content scripts
    // pull this on every signal that can change the answer (activation, focus,
    // an isOpen change from another tab, re-injection), instead of relying on
    // the SW's best-effort push commands which can be dropped to a busy tab.
    var senderTabForResolve = senderForServiceWorker && senderForServiceWorker.tab ? senderForServiceWorker.tab : null;
    var senderTabIdForResolve = senderTabForResolve && typeof senderTabForResolve.id === "number"
      ? senderTabForResolve.id
      : null;
    if (senderTabIdForResolve === null) {
      sendResponseForServiceWorker({ ok: true, shouldBeOpen: false });
      return false;
    }
    readDesiredPanelOpenForServiceWorker(function (desiredOpenForResolve) {
      if (!desiredOpenForResolve) {
        sendResponseForServiceWorker({ ok: true, shouldBeOpen: false });
        return;
      }
      getActiveFocusedTabForPanelVisibilityForServiceWorker(function (activeTabForResolve) {
        var shouldBeOpenForResolve = false;
        if (activeTabForResolve) {
          // Browser is focused: only the active tab of the focused window shows
          // the panel, and only when that tab is a supported page.
          shouldBeOpenForResolve =
            isSupportedPanelTabForServiceWorker(activeTabForResolve) &&
            activeTabForResolve.id === senderTabIdForResolve;
        } else {
          // No focused window (browser lost OS focus to another app). Fall back
          // to the tracked active tab so the panel does NOT close when focus
          // merely moves to another app.
          if (currentActiveTabIdForServiceWorker === null) {
            initActiveTabTrackingForServiceWorker();
          }
          shouldBeOpenForResolve =
            isSupportedPanelTabForServiceWorker(senderTabForResolve) &&
            senderTabIdForResolve === currentActiveTabIdForServiceWorker;
        }
        sendResponseForServiceWorker({ ok: true, shouldBeOpen: Boolean(shouldBeOpenForResolve) });
      });
    });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.panelVisibilityChanged || "panelVisibilityChanged")) {
    desiredPanelOpenForServiceWorker = Boolean(messageForServiceWorker.isOpen);
    enforceSingleVisiblePanelForServiceWorker(desiredPanelOpenForServiceWorker);
    return false;
  }

  // Cross-tab live chat streaming relay. The originator tab emits
  // streamOriginatorBroadcast on every text delta and on stream start/end.
  // The SW fans the event out to every other tab so receivers can render a
  // live bubble that mirrors the originator's. Fire-and-forget; no response
  // is expected — sender.tab.id is excluded so the originator does not echo
  // its own event back into its own state machine.
  // Snapshot request: receiver tab asks for the current state of a chat that
  // may be mid-stream. Responds synchronously with the snapshot or null.
  if (messageForServiceWorker.action === (actionsForServiceWorker.streamSnapshotRequest || "streamSnapshotRequest")) {
    const requestedChatIdForSnapshot = Number(messageForServiceWorker.chatId);
    if (!Number.isFinite(requestedChatIdForSnapshot)) {
      sendResponseForServiceWorker({ ok: true, snapshot: null });
      return false;
    }
    const snapshotForResponse = streamSnapshotsForServiceWorker.get(requestedChatIdForSnapshot) || null;
    sendResponseForServiceWorker({ ok: true, snapshot: snapshotForResponse });
    return false;
  }

  // Cancel request from any receiver tab. Fan out to all tabs; only the tab
  // whose sendingChatsForPanelRuntime holds an AbortController for this chatId
  // will actually abort. Includes the sender so a receiver that just became
  // the originator (race) still cancels itself if applicable.
  if (messageForServiceWorker.action === (actionsForServiceWorker.streamCancelRequest || "streamCancelRequest")) {
    const cancelDeliverActionForServiceWorker = actionsForServiceWorker.streamCancelDeliver || "streamCancelDeliver";
    const requestedChatIdForCancel = messageForServiceWorker.chatId;
    // Also reach the offscreen-hosted loop (not a tab, so tabs.sendMessage misses it).
    try {
      chrome.runtime.sendMessage({ action: "offscreenCancelRequest", chatId: requestedChatIdForCancel }, function () { void chrome.runtime.lastError; });
    } catch (errForOffscreenCancel) {}
    chrome.tabs.query({}, function (tabsForCancelBroadcast) {
      if (!Array.isArray(tabsForCancelBroadcast)) return;
      for (var iForCancelBroadcast = 0; iForCancelBroadcast < tabsForCancelBroadcast.length; iForCancelBroadcast++) {
        var tabForCancelBroadcast = tabsForCancelBroadcast[iForCancelBroadcast];
        if (!tabForCancelBroadcast || typeof tabForCancelBroadcast.id !== "number") continue;
        try {
          chrome.tabs.sendMessage(
            tabForCancelBroadcast.id,
            {
              action: cancelDeliverActionForServiceWorker,
              chatId: requestedChatIdForCancel
            },
            function () { void chrome.runtime.lastError; }
          );
        } catch (errorForCancelBroadcast) {}
      }
    });
    return false;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.streamOriginatorBroadcast || "streamOriginatorBroadcast")) {
    const senderTabIdForStreamBroadcast = senderForServiceWorker && senderForServiceWorker.tab && typeof senderForServiceWorker.tab.id === "number"
      ? senderForServiceWorker.tab.id
      : null;
    // Keep an in-memory snapshot of every active stream so newly-subscribed
    // tabs can catch up on what they missed. Cleared on stream_end. If the
    // SW is terminated mid-stream, the next event from the originator simply
    // re-populates the snapshot (lossy by definition, but the originator is
    // the source of truth).
    updateStreamSnapshotForServiceWorker(
      messageForServiceWorker.event,
      messageForServiceWorker.chatId,
      messageForServiceWorker.payload,
      senderTabIdForStreamBroadcast
    );
    const deliverActionForStreamBroadcast = actionsForServiceWorker.streamReceiverDeliver || "streamReceiverDeliver";
    chrome.tabs.query({}, function (tabsForStreamBroadcast) {
      if (!Array.isArray(tabsForStreamBroadcast)) return;
      for (var iForStreamBroadcast = 0; iForStreamBroadcast < tabsForStreamBroadcast.length; iForStreamBroadcast++) {
        var tabForStreamBroadcast = tabsForStreamBroadcast[iForStreamBroadcast];
        if (!tabForStreamBroadcast || typeof tabForStreamBroadcast.id !== "number") continue;
        if (tabForStreamBroadcast.id === senderTabIdForStreamBroadcast) continue;
        try {
          chrome.tabs.sendMessage(
            tabForStreamBroadcast.id,
            {
              action: deliverActionForStreamBroadcast,
              event: messageForServiceWorker.event,
              chatId: messageForServiceWorker.chatId,
              originatorTabId: senderTabIdForStreamBroadcast,
              payload: messageForServiceWorker.payload || null
            },
            function () {
              // Ignore lastError; tabs without an active content script will
              // just fail to receive, which is harmless.
              void chrome.runtime.lastError;
            }
          );
        } catch (errorForStreamBroadcast) {}
      }
    });
    return false;
  }

  // Offscreen-hosted agent run start. The initiator content script does its send-init
  // DOM work (render the user message, persist it), then hands the run to the offscreen
  // document via the SW. The SW records which tab the run targets (for page-DOM tool
  // delegation and snapshot ownership), keeps the offscreen doc alive, and forwards the
  // run params to it. sender.tab.id is authoritative for the target tab.
  if (messageForServiceWorker.action === "agentRunStart") {
    const senderTabIdForRunStart = senderForServiceWorker && senderForServiceWorker.tab && typeof senderForServiceWorker.tab.id === "number"
      ? senderForServiceWorker.tab.id
      : null;
    const paramsForRunStart = messageForServiceWorker.params || {};
    const chatIdForRunStart = Number(paramsForRunStart.chatId);
    if (Number.isFinite(chatIdForRunStart) && senderTabIdForRunStart != null) {
      offscreenRunTargetTabsForServiceWorker.set(chatIdForRunStart, senderTabIdForRunStart);
      offscreenRunInitiatorTabsForServiceWorker.set(chatIdForRunStart, senderTabIdForRunStart);
    }
    const forwardedParamsForRunStart = Object.assign({}, paramsForRunStart, { targetTabId: senderTabIdForRunStart, initiatorTabId: senderTabIdForRunStart });
    acquireOffscreenKeepAliveForServiceWorker();
    ensureOffscreenDocumentForServiceWorker().then(function (ensuredForRunStart) {
      if (!ensuredForRunStart) {
        releaseOffscreenKeepAliveForServiceWorker();
        return;
      }
      deliverAgentRunStartForServiceWorker(forwardedParamsForRunStart, 0);
    });
    sendResponseForServiceWorker({ ok: true });
    return false;
  }

  // Stream events emitted by the offscreen-hosted loop. Mirrors streamOriginatorBroadcast,
  // but the source is the offscreen document (no sender.tab), so the target tab is resolved
  // from the run map and used as the snapshot's originatorTabId, and the event is fanned out
  // to ALL tabs (there is no originating tab to exclude). On stream_end the run mapping is
  // cleared and the offscreen keepalive ref is released.
  if (messageForServiceWorker.action === "offscreenStreamBroadcast") {
    const chatIdForOsb = Number(messageForServiceWorker.chatId);
    const targetTabIdForOsb = offscreenRunTargetTabsForServiceWorker.has(chatIdForOsb)
      ? offscreenRunTargetTabsForServiceWorker.get(chatIdForOsb)
      : null;
    // The stream belongs to the panel that started the run, not to whatever tab the agent is
    // currently acting on, so ownership uses the fixed initiator tab (falling back to the
    // target when no initiator was recorded, e.g. a run seeded before this map existed).
    const originatorTabIdForOsb = offscreenRunInitiatorTabsForServiceWorker.has(chatIdForOsb)
      ? offscreenRunInitiatorTabsForServiceWorker.get(chatIdForOsb)
      : targetTabIdForOsb;
    updateStreamSnapshotForServiceWorker(
      messageForServiceWorker.event,
      messageForServiceWorker.chatId,
      messageForServiceWorker.payload,
      originatorTabIdForOsb
    );
    const snapForOsb = streamSnapshotsForServiceWorker.get(chatIdForOsb);
    if (snapForOsb) {
      snapForOsb.hostedOffscreen = true;
      snapForOsb.targetTabId = targetTabIdForOsb;
    }
    const deliverActionForOsb = actionsForServiceWorker.streamReceiverDeliver || "streamReceiverDeliver";
    chrome.tabs.query({}, function (tabsForOsb) {
      if (!Array.isArray(tabsForOsb)) return;
      for (var iForOsb = 0; iForOsb < tabsForOsb.length; iForOsb++) {
        var tabForOsb = tabsForOsb[iForOsb];
        if (!tabForOsb || typeof tabForOsb.id !== "number") continue;
        try {
          chrome.tabs.sendMessage(
            tabForOsb.id,
            {
              action: deliverActionForOsb,
              event: messageForServiceWorker.event,
              chatId: messageForServiceWorker.chatId,
              originatorTabId: originatorTabIdForOsb,
              payload: messageForServiceWorker.payload || null
            },
            function () { void chrome.runtime.lastError; }
          );
        } catch (errorForOsb) {}
      }
    });
    if (messageForServiceWorker.event === "stream_end") {
      offscreenRunTargetTabsForServiceWorker.delete(chatIdForOsb);
      offscreenRunInitiatorTabsForServiceWorker.delete(chatIdForOsb);
      releaseOffscreenKeepAliveForServiceWorker();
    }
    return false;
  }

  // Page-DOM-bound tool delegation: the offscreen loop cannot touch the page, so it asks
  // the SW to run the page tools (page_observe, page_read, page_act, page_spreadsheet) and
  // screenshot capture on the run's target tab.
  // sendActionToTab is ack-only (it does not surface the content response), so this uses a
  // direct request/response chrome.tabs.sendMessage after ensuring the content script is
  // injected (which also covers the just-reloaded-tab case via re-injection).
  if (messageForServiceWorker.action === "delegatePageTool") {
    const chatIdForDelegate = Number(messageForServiceWorker.chatId);
    // The chatId -> targetTabId map is in-memory only, so an MV3 service-worker recycle
    // mid-run wipes it while the offscreen doc keeps running, which otherwise fails every
    // page tool with "No target tab" for the rest of the run. The offscreen loop carries the
    // authoritative targetTabId on every delegatePageTool message, so fall back to it and
    // re-seed the map (which also feeds the navigation-survival predicate and the stream
    // originator stamp) so a recycled worker self-heals on the first delegated page call.
    let targetTabIdForDelegate = offscreenRunTargetTabsForServiceWorker.has(chatIdForDelegate)
      ? offscreenRunTargetTabsForServiceWorker.get(chatIdForDelegate)
      : null;
    if (targetTabIdForDelegate == null && typeof messageForServiceWorker.targetTabId === "number") {
      targetTabIdForDelegate = messageForServiceWorker.targetTabId;
      if (Number.isFinite(chatIdForDelegate)) {
        offscreenRunTargetTabsForServiceWorker.set(chatIdForDelegate, targetTabIdForDelegate);
      }
    }
    if (targetTabIdForDelegate == null) {
      sendResponseForServiceWorker({ ok: false, error: "No target tab is associated with this run." });
      return false;
    }
    // A click can navigate the page (a link or form submit), which tears down the target tab's
    // content script mid-observation: the in-flight runDelegatedPageTool response is then lost
    // (the message port closes). Rather than report that as an unreachable-tab error, watch the
    // tab for a document load during the call and resolve with an honest "navigated" result so
    // the model re-reads the new page instead of assuming the click failed. A same-document
    // (pushState) soft-nav does not load a document, so the content script survives and returns
    // its own result normally; only status==="loading" triggers this. Applies to the trusted page
    // tools (page_act, page_spreadsheet); a page_act click is the one an offscreen run is allowed to
    // let navigate (an in-panel run refuses page-leaving clicks before they reach here).
    const watchNavigationForDelegate = messageForServiceWorker.tool === "page_act"
      || messageForServiceWorker.tool === "page_spreadsheet";
    const actionLabelForDelegate = String((messageForServiceWorker.args && messageForServiceWorker.args.action) || "action");
    // A click or Enter-press can trigger an async navigation that begins slightly AFTER the
    // synthetic action returns its snapshot, so for those we also watch for a brief grace window
    // after the tool responds (other actions finish immediately).
    const navCapableActionForDelegate = messageForServiceWorker.tool === "page_act"
      && (actionLabelForDelegate === "click" || actionLabelForDelegate === "press");
    (async function () {
      try {
        if (tabMessagingForServiceWorker && typeof tabMessagingForServiceWorker.ensureContentInjected === "function") {
          await tabMessagingForServiceWorker.ensureContentInjected(targetTabIdForDelegate);
        }
        let settledForDelegate = false;
        let navWatcherForDelegate = null;
        let graceTimerForDelegate = null;
        const beforeTabForDelegate = await getTabByIdForServiceWorker(targetTabIdForDelegate);
        const beforeUrlForDelegate = (beforeTabForDelegate && beforeTabForDelegate.url) || "";
        const cleanupForDelegate = function () {
          if (navWatcherForDelegate) {
            try { chrome.tabs.onUpdated.removeListener(navWatcherForDelegate); } catch (eRemoveNavForDelegate) { /* ignore */ }
            navWatcherForDelegate = null;
          }
          if (graceTimerForDelegate) { clearTimeout(graceTimerForDelegate); graceTimerForDelegate = null; }
        };
        const finishOkForDelegate = function (resultForDelegate) {
          if (settledForDelegate) return;
          settledForDelegate = true;
          cleanupForDelegate();
          sendResponseForServiceWorker({ ok: true, result: resultForDelegate });
        };
        const finishErrForDelegate = function (errorMsgForDelegate) {
          if (settledForDelegate) return;
          settledForDelegate = true;
          cleanupForDelegate();
          sendResponseForServiceWorker({ ok: false, error: errorMsgForDelegate });
        };
        // A detected navigation (during the action, in the grace window after it, or inferred
        // from a closed port): wait for the landed page to finish loading, observe it, and return
        // that so the model can confirm the outcome directly instead of re-reading a
        // pre-navigation snapshot itself.
        const handleNavDetectedForDelegate = function (newUrlForDelegate) {
          if (settledForDelegate) return;
          settledForDelegate = true;
          cleanupForDelegate();
          settleAndObserveLandedPageForServiceWorker(targetTabIdForDelegate, chatIdForDelegate, actionLabelForDelegate, newUrlForDelegate)
            .then(function (landedResultForDelegate) {
              sendResponseForServiceWorker({ ok: true, result: landedResultForDelegate });
            });
        };
        if (watchNavigationForDelegate) {
          navWatcherForDelegate = function (updatedTabIdForDelegate, changeInfoForDelegate) {
            if (updatedTabIdForDelegate !== targetTabIdForDelegate) return;
            if (changeInfoForDelegate && changeInfoForDelegate.status === "loading") {
              handleNavDetectedForDelegate(changeInfoForDelegate.url || "");
            }
          };
          chrome.tabs.onUpdated.addListener(navWatcherForDelegate);
        }
        chrome.tabs.sendMessage(
          targetTabIdForDelegate,
          { action: "runDelegatedPageTool", tool: messageForServiceWorker.tool, args: messageForServiceWorker.args || {}, chatId: chatIdForDelegate },
          function (respForDelegate) {
            if (chrome.runtime.lastError) {
              const portErrMsgForDelegate = chrome.runtime.lastError.message || "no response";
              if (!watchNavigationForDelegate) {
                finishErrForDelegate("The target tab could not be reached: " + portErrMsgForDelegate);
                return;
              }
              // The port may have closed because the click navigated the page. Re-check the
              // tab: if it is loading or its URL changed, treat it as a navigation; otherwise the
              // tab is genuinely unreachable.
              chrome.tabs.get(targetTabIdForDelegate, function (tabAfterForDelegate) {
                if (chrome.runtime.lastError || !tabAfterForDelegate) {
                  finishErrForDelegate("The target tab could not be reached: " + portErrMsgForDelegate);
                  return;
                }
                if (tabAfterForDelegate.status === "loading" || (tabAfterForDelegate.url && tabAfterForDelegate.url !== beforeUrlForDelegate)) {
                  handleNavDetectedForDelegate(tabAfterForDelegate.url || "");
                } else {
                  finishErrForDelegate("The target tab could not be reached: " + portErrMsgForDelegate);
                }
              });
              return;
            }
            if (settledForDelegate) return;
            // The action returned a normal snapshot. For a click/press that may still spawn an
            // async navigation, hold: if the tab starts loading within the grace window,
            // navWatcherForDelegate resolves with the landed page; otherwise return this snapshot.
            // The window is longer for submit-like clicks whose JS-driven redirect can lag.
            if (navCapableActionForDelegate) {
              const graceMsForDelegate = computeNavGraceMsForServiceWorker(messageForServiceWorker.tool, messageForServiceWorker.args || {}, respForDelegate);
              if (graceMsForDelegate > 0) {
                graceTimerForDelegate = setTimeout(function () {
                  finishOkForDelegate(respForDelegate);
                }, graceMsForDelegate);
                return;
              }
            }
            finishOkForDelegate(respForDelegate);
          }
        );
      } catch (errForDelegate) {
        sendResponseForServiceWorker({ ok: false, error: (errForDelegate && errForDelegate.message) || "Delegated page tool failed." });
      }
    })();
    return true;
  }

  // Piggyback periodic cleanup on each incoming message. setInterval is not used because
  // the service worker can be suspended between events, making interval-based timers
  // unreliable. The timestamp guards ensure cleanup runs at most once per interval even
  // if messages arrive at high frequency.
  const nowForPeriodicPrune = Date.now();
  if (nowForPeriodicPrune - lastPeriodicPruneAtMsForServiceWorker > periodicPruneIntervalMsForServiceWorker) {
    lastPeriodicPruneAtMsForServiceWorker = nowForPeriodicPrune;
    pruneRuntimeRequestCachesForServiceWorker();
  }
  if (nowForPeriodicPrune - lastWebFetchCleanAtMsForServiceWorker > periodicWebFetchCleanIntervalMsForServiceWorker) {
    lastWebFetchCleanAtMsForServiceWorker = nowForPeriodicPrune;
    cleanExpiredWebFetchCacheForServiceWorker();
  }

  if (messageForServiceWorker.action === "agentWebSearch") {
    handleAgentWebSearchForServiceWorker(messageForServiceWorker, sendResponseForServiceWorker);
    return true;
  }

  if (messageForServiceWorker.action === "cancelAgentToolRequest") {
    var cancelledForToolRequest = cancelAgentToolRequestForServiceWorker(messageForServiceWorker.agentToolRequestId || messageForServiceWorker.requestId);
    sendResponseForServiceWorker({ ok: true, cancelled: cancelledForToolRequest });
    return false;
  }

  if (messageForServiceWorker.action === "agentGenerateQuestions") {
    handleAgentGenerateQuestionsForServiceWorker(messageForServiceWorker, sendResponseForServiceWorker);
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.agentWebFetch || "agentWebFetch")) {
    handleAgentWebFetchForServiceWorker(messageForServiceWorker, sendResponseForServiceWorker);
    return true;
  }

  if (messageForServiceWorker.action === "abchatConnectivityProbe") {
    handleConnectivityProbeForServiceWorker(messageForServiceWorker, sendResponseForServiceWorker);
    return true;
  }

  if (messageForServiceWorker.action === "abchatGetOpenTabs") {
    var currentWindowIdForTabs = senderForServiceWorker && senderForServiceWorker.tab
      ? senderForServiceWorker.tab.windowId
      : undefined;
    // The tab this chat's page actions currently target (switch_tab last pointed here, or the
    // tab the chat started on). Marked so the model has one unambiguous "you are here" anchor;
    // per-window `active` is true for one tab in every window, so it cannot serve that role.
    var chatIdForOpenTabs = Number(messageForServiceWorker.chatId);
    var currentTargetTabIdForOpenTabs = (Number.isFinite(chatIdForOpenTabs)
      && offscreenRunTargetTabsForServiceWorker.has(chatIdForOpenTabs))
      ? offscreenRunTargetTabsForServiceWorker.get(chatIdForOpenTabs)
      : null;
    queryTabsForServiceWorker({})
      .then((tabsForServiceWorker) => {
        var serializedTabsForServiceWorker = tabsForServiceWorker
          .filter(function (tabForServiceWorker) {
            return tabForServiceWorker && typeof tabForServiceWorker.id === "number";
          })
          .map(function (tabForServiceWorker) {
            return {
              id: Number(tabForServiceWorker.id),
              windowId: Number(tabForServiceWorker.windowId),
              isCurrentWindow: tabForServiceWorker.windowId === currentWindowIdForTabs,
              isCurrentTab: currentTargetTabIdForOpenTabs != null && Number(tabForServiceWorker.id) === currentTargetTabIdForOpenTabs,
              title: String(tabForServiceWorker.title || tabForServiceWorker.url || "Untitled tab"),
              url: String(tabForServiceWorker.url || ""),
              favIconUrl: String(tabForServiceWorker.favIconUrl || ""),
              active: Boolean(tabForServiceWorker.active),
              discarded: Boolean(tabForServiceWorker.discarded),
              accessible: tabMessagingForServiceWorker.isSupportedUrl(tabForServiceWorker.url || "")
            };
          });
        sendResponseForServiceWorker({ ok: true, tabs: serializedTabsForServiceWorker });
      })
      .catch(function (errorForServiceWorker) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForServiceWorker && errorForServiceWorker.message
            ? errorForServiceWorker.message
            : "Failed to load tabs."
        });
      });
    return true;
  }

  if (messageForServiceWorker.action === 'abchatBroadcastFullSync') {
    const senderTabIdForFullSync = senderForServiceWorker && senderForServiceWorker.tab
      ? senderForServiceWorker.tab.id
      : undefined;
    const sourceIdForFullSync = typeof messageForServiceWorker.sourceId === 'string'
      ? messageForServiceWorker.sourceId
      : '';
    ['chats', 'notes', 'tasks', 'questions'].forEach(function (storeForFullSync) {
      if (USE_STORAGE_BROADCAST_FOR_DB_SYNC) {
        notifyDbChangeViaStorageForServiceWorker(storeForFullSync, sourceIdForFullSync);
      } else {
        broadcastDbChangeForServiceWorker(storeForFullSync, senderTabIdForFullSync);
      }
    });
    sendResponseForServiceWorker({ ok: true });
    return true;
  }

  if (messageForServiceWorker.action === "abchatGetTabPageContent") {
    getTabPageContentForServiceWorker(
      messageForServiceWorker.tabId
    )
      .then(function (resultForServiceWorker) {
        if (!resultForServiceWorker || !resultForServiceWorker.ok) {
          sendResponseForServiceWorker({
            ok: false,
            error: resultForServiceWorker && resultForServiceWorker.error
              ? resultForServiceWorker.error
              : "Could not read tab content."
          });
          return;
        }
        sendResponseForServiceWorker({
          ok: true,
          content: String(resultForServiceWorker.content || "")
        });
      })
      .catch(function (errorForServiceWorker) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForServiceWorker && errorForServiceWorker.message
            ? errorForServiceWorker.message
            : "Could not read tab content."
        });
      });
    return true;
  }

  // ---- Cross-tab actions: switch / create / close (offscreen-hosted runs) ----
  // These own every chrome.tabs.* mutation (offscreen documents cannot call chrome.tabs) and
  // the close_tab authorization boundary. The offscreen loop performs the matching run-state
  // rebind + CDP-lease move after these succeed.
  if (messageForServiceWorker.action === "abchatSwitchTab") {
    const chatIdForSwitch = Number(messageForServiceWorker.chatId);
    const tabIdForSwitch = Number(messageForServiceWorker.tabId);
    (async function () {
      if (!Number.isFinite(tabIdForSwitch)) {
        sendResponseForServiceWorker({ ok: false, error: "A valid tab_id is required." });
        return;
      }
      const tabForSwitch = await getTabByIdForServiceWorker(tabIdForSwitch);
      if (!tabForSwitch) {
        sendResponseForServiceWorker({ ok: false, error: "Tab " + tabIdForSwitch + " could not be found. It may have been closed; call list_tabs again to get current tab ids." });
        return;
      }
      if (!tabMessagingForServiceWorker.isSupportedUrl(tabForSwitch.url || "")) {
        sendResponseForServiceWorker({ ok: false, error: "Tab " + tabIdForSwitch + " is a browser page the extension cannot act on (" + (tabForSwitch.url || "") + "). Switch to a normal web page instead." });
        return;
      }
      // Force the panel open before activating the tab, so the activation's own visibility
      // enforcement (onActivated) opens it on the target rather than racing the content-side
      // force-open and possibly hiding it when the user had the panel closed.
      if (Number.isFinite(chatIdForSwitch)) desiredPanelOpenForServiceWorker = true;
      chrome.tabs.update(tabIdForSwitch, { active: true }, function () {
        if (chrome.runtime.lastError) {
          sendResponseForServiceWorker({ ok: false, error: "Could not switch to tab " + tabIdForSwitch + ": " + (chrome.runtime.lastError.message || "unknown error") });
          return;
        }
        if (typeof tabForSwitch.windowId === "number") {
          try { chrome.windows.update(tabForSwitch.windowId, { focused: true }, function () { void chrome.runtime.lastError; }); } catch (eWinForSwitch) { /* ignore */ }
        }
        if (Number.isFinite(chatIdForSwitch)) {
          offscreenRunTargetTabsForServiceWorker.set(chatIdForSwitch, tabIdForSwitch);
          followRunInTabForServiceWorker(tabIdForSwitch, chatIdForSwitch).then(function (followResForSwitch) {
            sendResponseForServiceWorker({
              ok: true,
              tab: { id: tabIdForSwitch, title: String(tabForSwitch.title || ""), url: String(tabForSwitch.url || "") },
              panel_showing_chat: !!(followResForSwitch && followResForSwitch.showing)
            });
          });
          return;
        }
        sendResponseForServiceWorker({ ok: true, tab: { id: tabIdForSwitch, title: String(tabForSwitch.title || ""), url: String(tabForSwitch.url || "") } });
      });
    })();
    return true;
  }

  if (messageForServiceWorker.action === "abchatCreateTab") {
    const chatIdForCreate = Number(messageForServiceWorker.chatId);
    const rawUrlForCreate = typeof messageForServiceWorker.url === "string" ? messageForServiceWorker.url.trim() : "";
    const activeForCreate = messageForServiceWorker.active !== false;
    const createOptionsForCreate = { active: activeForCreate };
    if (rawUrlForCreate) createOptionsForCreate.url = rawUrlForCreate;
    // Force the panel open ahead of the new active tab's activation enforcement (see switch_tab).
    if (activeForCreate && Number.isFinite(chatIdForCreate)) desiredPanelOpenForServiceWorker = true;
    chrome.tabs.create(createOptionsForCreate, function (createdTabForCreate) {
      if (chrome.runtime.lastError || !createdTabForCreate || typeof createdTabForCreate.id !== "number") {
        sendResponseForServiceWorker({ ok: false, error: "Could not create the tab" + (rawUrlForCreate ? " for " + rawUrlForCreate : "") + ": " + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || "unknown error") + (rawUrlForCreate ? ". If you passed a url, make sure it includes the scheme (e.g. https://)." : "") });
        return;
      }
      const newTabIdForCreate = createdTabForCreate.id;
      (async function () {
        let panelShowingForCreate = false;
        if (Number.isFinite(chatIdForCreate)) {
          await addAgentCreatedTabForServiceWorker(chatIdForCreate, newTabIdForCreate);
          if (activeForCreate) {
            offscreenRunTargetTabsForServiceWorker.set(chatIdForCreate, newTabIdForCreate);
          }
        }
        if (activeForCreate && typeof createdTabForCreate.windowId === "number") {
          try { chrome.windows.update(createdTabForCreate.windowId, { focused: true }, function () { void chrome.runtime.lastError; }); } catch (eWinForCreate) { /* ignore */ }
        }
        if (activeForCreate && Number.isFinite(chatIdForCreate)) {
          const followResForCreate = await followRunInTabForServiceWorker(newTabIdForCreate, chatIdForCreate);
          panelShowingForCreate = !!(followResForCreate && followResForCreate.showing);
        }
        sendResponseForServiceWorker({
          ok: true,
          active: activeForCreate,
          panel_showing_chat: panelShowingForCreate,
          tab: { id: newTabIdForCreate, title: String(createdTabForCreate.title || ""), url: String(createdTabForCreate.url || rawUrlForCreate || "") }
        });
      })();
    });
    return true;
  }

  if (messageForServiceWorker.action === "abchatCloseTab") {
    const chatIdForClose = Number(messageForServiceWorker.chatId);
    const tabIdForClose = Number(messageForServiceWorker.tabId);
    (async function () {
      if (!Number.isFinite(tabIdForClose)) {
        sendResponseForServiceWorker({ ok: false, error: "A valid tab_id is required." });
        return;
      }
      if (!Number.isFinite(chatIdForClose)) {
        sendResponseForServiceWorker({ ok: false, error: "This run has no chat context, so close_tab is unavailable." });
        return;
      }
      const createdTabsForClose = await getAgentCreatedTabsForServiceWorker(chatIdForClose);
      if (createdTabsForClose.indexOf(tabIdForClose) === -1) {
        sendResponseForServiceWorker({ ok: false, error: "Tab " + tabIdForClose + " was not created by you in this chat, so it cannot be closed. You can only close tabs you opened with create_tab." });
        return;
      }
      chrome.tabs.remove(tabIdForClose, function () {
        const removeErrForClose = chrome.runtime.lastError;
        // Drop it from the created-set whether or not remove reported an error (it may already
        // be gone). If it was the active target, revert the target to the run's initiator tab.
        removeAgentCreatedTabForServiceWorker(chatIdForClose, tabIdForClose);
        let revertedTargetToForClose = null;
        if (offscreenRunTargetTabsForServiceWorker.get(chatIdForClose) === tabIdForClose) {
          const initiatorForClose = offscreenRunInitiatorTabsForServiceWorker.has(chatIdForClose)
            ? offscreenRunInitiatorTabsForServiceWorker.get(chatIdForClose)
            : null;
          if (initiatorForClose != null) {
            offscreenRunTargetTabsForServiceWorker.set(chatIdForClose, initiatorForClose);
            revertedTargetToForClose = initiatorForClose;
          } else {
            offscreenRunTargetTabsForServiceWorker.delete(chatIdForClose);
          }
        }
        if (removeErrForClose) {
          sendResponseForServiceWorker({ ok: false, error: "Could not close tab " + tabIdForClose + ": " + (removeErrForClose.message || "unknown error") });
          return;
        }
        sendResponseForServiceWorker({ ok: true, closed: tabIdForClose, reverted_target_to: revertedTargetToForClose });
      });
    })();
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.captureVisibleTabScreenshot || "captureVisibleTabScreenshot")) {
    captureVisibleTabForServiceWorker(
      senderForServiceWorker && senderForServiceWorker.tab
        ? senderForServiceWorker.tab.windowId
        : undefined
    )
      .then(function (dataUrlForServiceWorker) {
        if (!dataUrlForServiceWorker) {
          sendResponseForServiceWorker({ ok: false, error: "Screenshot capture failed." });
          return;
        }
        var payloadForServiceWorker = String(dataUrlForServiceWorker).split(",")[1] || "";
        var paddingMatchForServiceWorker = payloadForServiceWorker.match(/=+$/);
        var paddingLengthForServiceWorker = paddingMatchForServiceWorker ? paddingMatchForServiceWorker[0].length : 0;
        var sizeForServiceWorker = Math.floor((payloadForServiceWorker.length * 3) / 4) - paddingLengthForServiceWorker;
        sendResponseForServiceWorker({
          ok: true,
          dataUrl: dataUrlForServiceWorker,
          size: sizeForServiceWorker > 0 ? sizeForServiceWorker : 0
        });
      })
      .catch(function (errorForServiceWorker) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForServiceWorker && errorForServiceWorker.message
            ? errorForServiceWorker.message
            : "Screenshot capture failed."
        });
      });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.cdpAutomationStatus || "cdpAutomationStatus")) {
    if (typeof cdpAutomationForServiceWorker.isAutomationEnabled !== "function") {
      sendResponseForServiceWorker({ ok: false, enabled: false, error: "Automation module unavailable." });
      return false;
    }
    cdpAutomationForServiceWorker.isAutomationEnabled().then(function (enabledForCdpStatus) {
      sendResponseForServiceWorker({ ok: true, enabled: !!enabledForCdpStatus });
    });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.cdpAutomationEnable || "cdpAutomationEnable")) {
    if (typeof cdpAutomationForServiceWorker.openConsentWindow !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "Automation module unavailable." });
      return false;
    }
    cdpAutomationForServiceWorker.openConsentWindow().then(function (openedForCdpEnable) {
      sendResponseForServiceWorker({ ok: !!openedForCdpEnable });
    });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.cdpAutomationDisable || "cdpAutomationDisable")) {
    if (typeof cdpAutomationForServiceWorker.setAutomationEnabled !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "Automation module unavailable." });
      return false;
    }
    cdpAutomationForServiceWorker.setAutomationEnabled(false).then(function () {
      sendResponseForServiceWorker({ ok: true, enabled: false });
    });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.cdpAutomation || "cdpAutomation")) {
    var cdpOpForServiceWorker = messageForServiceWorker.op;
    var cdpTabIdForServiceWorker = typeof messageForServiceWorker.tabId === "number"
      ? messageForServiceWorker.tabId
      : (senderForServiceWorker && senderForServiceWorker.tab && typeof senderForServiceWorker.tab.id === "number"
        ? senderForServiceWorker.tab.id
        : null);
    var cdpParamsForServiceWorker = messageForServiceWorker.params || {};
    if (typeof cdpAutomationForServiceWorker.acquireLease !== "function") {
      sendResponseForServiceWorker({ ok: false, error: { code: "module-unavailable", message: "Automation module unavailable." } });
      return false;
    }
    if (cdpTabIdForServiceWorker === null) {
      sendResponseForServiceWorker({ ok: false, error: { code: "no-tab", message: "No target tab id." } });
      return false;
    }
    switch (cdpOpForServiceWorker) {
      case "acquire":
        cdpAutomationForServiceWorker.acquireLease(cdpTabIdForServiceWorker).then(function (resForCdpAcquire) {
          sendResponseForServiceWorker(resForCdpAcquire);
        });
        return true;
      case "release":
        cdpAutomationForServiceWorker.releaseLease(cdpTabIdForServiceWorker, cdpParamsForServiceWorker.immediate === true);
        sendResponseForServiceWorker({ ok: true });
        return false;
      case "detach":
        cdpAutomationForServiceWorker.forceDetach(cdpTabIdForServiceWorker).then(function () {
          sendResponseForServiceWorker({ ok: true });
        });
        return true;
      case "state":
        sendResponseForServiceWorker({ ok: true, session: cdpAutomationForServiceWorker.getSessionState(cdpTabIdForServiceWorker) });
        return false;
      case "act":
        cdpAutomationForServiceWorker.performAction(cdpTabIdForServiceWorker, cdpParamsForServiceWorker).then(function (resForCdpAct) {
          sendResponseForServiceWorker(resForCdpAct);
        });
        return true;
      case "command":
        cdpAutomationForServiceWorker.sendCommand(cdpTabIdForServiceWorker, cdpParamsForServiceWorker.method, cdpParamsForServiceWorker.params)
          .then(function (resForCdpCommand) {
            sendResponseForServiceWorker({ ok: true, result: resForCdpCommand });
          })
          .catch(function (errForCdpCommand) {
            sendResponseForServiceWorker({
              ok: false,
              error: {
                code: (errForCdpCommand && errForCdpCommand.code) || "command-failed",
                message: (errForCdpCommand && errForCdpCommand.message) || "Command failed."
              }
            });
          });
        return true;
      default:
        sendResponseForServiceWorker({ ok: false, error: { code: "unknown-op", message: "Unknown cdp op: " + String(cdpOpForServiceWorker) } });
        return false;
    }
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.parseUploadedFile || "parseUploadedFile")) {
    var fileSizeForServiceWorker = Number(messageForServiceWorker.size || 0);
    if (fileSizeForServiceWorker > 50 * 1024 * 1024) {
      sendResponseForServiceWorker({
        ok: false,
        error: "File is too large. Max size is 50MB."
      });
      return false;
    }
    var rawBufferForServiceWorker = messageForServiceWorker.buffer;
    if (!rawBufferForServiceWorker) {
      sendResponseForServiceWorker({ ok: false, error: "Missing file buffer." });
      return false;
    }
    var parseBufferForServiceWorker = Array.isArray(rawBufferForServiceWorker)
      ? new Uint8Array(rawBufferForServiceWorker).buffer
      : rawBufferForServiceWorker;
    if (!fileParsingForServiceWorker || typeof fileParsingForServiceWorker.parseFileBuffer !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "File parser is unavailable." });
      return false;
    }
    Promise.resolve(
      fileParsingForServiceWorker.parseFileBuffer(
        messageForServiceWorker.fileName || "",
        messageForServiceWorker.mimeType || "",
        parseBufferForServiceWorker
      )
    )
      .then(function (parseResultForServiceWorker) {
        sendResponseForServiceWorker({
          ok: true,
          text: parseResultForServiceWorker && parseResultForServiceWorker.text ? parseResultForServiceWorker.text : "",
          truncated: Boolean(parseResultForServiceWorker && parseResultForServiceWorker.truncated),
          format: parseResultForServiceWorker && parseResultForServiceWorker.format ? parseResultForServiceWorker.format : "",
          mimeType: String(messageForServiceWorker.mimeType || "")
        });
      })
      .catch(function (errorForServiceWorker) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForServiceWorker && errorForServiceWorker.message
            ? errorForServiceWorker.message
            : "File parsing failed."
        });
      });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.parseAttachmentStructure || "parseAttachmentStructure")) {
    var refIdForStructure = Number(messageForServiceWorker.refId);
    if (!Number.isFinite(refIdForStructure)) {
      sendResponseForServiceWorker({ ok: false, error: "Invalid attachment id." });
      return false;
    }
    var repoForStructure = globalThis.ABChatShared && globalThis.ABChatShared.panelDataRepo;
    if (!repoForStructure || typeof repoForStructure.getAttachmentBlob !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "Attachment storage is unavailable." });
      return false;
    }
    if (!fileParsingForServiceWorker || typeof fileParsingForServiceWorker.parseDocxStructure !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "DOCX structure parser is unavailable." });
      return false;
    }
    Promise.resolve(repoForStructure.getAttachmentBlob(refIdForStructure))
      .then(function (blobForStructure) {
        if (!blobForStructure) {
          throw new Error("Attachment " + refIdForStructure + " was not found.");
        }
        var mimeForStructure = String(blobForStructure.mimeType || "").toLowerCase();
        var nameForStructure = String(blobForStructure.name || "");
        var isDocxForStructure = mimeForStructure === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          || /\.docx$/i.test(nameForStructure);
        if (!isDocxForStructure) {
          throw new Error("Structural reading is only available for DOCX attachments.");
        }
        var dataUrlForStructure = String(blobForStructure.dataUrl || "");
        if (dataUrlForStructure.indexOf("data:") !== 0) {
          throw new Error("This document was attached before structural reading was available. Ask the user to re-attach the file.");
        }
        var bytesForStructure = dataUrlToUint8ForServiceWorker(dataUrlForStructure);
        return fileParsingForServiceWorker.parseDocxStructure(bytesForStructure.buffer, refIdForStructure).then(function (structureResultForServiceWorker) {
          sendResponseForServiceWorker({
            ok: true,
            html: structureResultForServiceWorker && structureResultForServiceWorker.html ? structureResultForServiceWorker.html : "",
            truncated: Boolean(structureResultForServiceWorker && structureResultForServiceWorker.truncated),
            name: nameForStructure
          });
        });
      })
      .catch(function (errorForStructure) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForStructure && errorForStructure.message
            ? errorForStructure.message
            : "DOCX structure parsing failed."
        });
      });
    return true;
  }

  if (messageForServiceWorker.action === (actionsForServiceWorker.extractDocxImages || "extractDocxImages")) {
    var refIdForImages = Number(messageForServiceWorker.refId);
    if (!Number.isFinite(refIdForImages)) {
      sendResponseForServiceWorker({ ok: false, error: "Invalid attachment id." });
      return false;
    }
    var repoForImages = globalThis.ABChatShared && globalThis.ABChatShared.panelDataRepo;
    if (!repoForImages || typeof repoForImages.getAttachmentBlob !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "Attachment storage is unavailable." });
      return false;
    }
    if (!fileParsingForServiceWorker || typeof fileParsingForServiceWorker.extractDocxImages !== "function") {
      sendResponseForServiceWorker({ ok: false, error: "DOCX image extractor is unavailable." });
      return false;
    }
    Promise.resolve(repoForImages.getAttachmentBlob(refIdForImages))
      .then(function (blobForImages) {
        if (!blobForImages) {
          throw new Error("Attachment " + refIdForImages + " was not found.");
        }
        var mimeForImages = String(blobForImages.mimeType || "").toLowerCase();
        var nameForImages = String(blobForImages.name || "");
        var isDocxForImages = mimeForImages === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          || /\.docx$/i.test(nameForImages);
        if (!isDocxForImages) {
          throw new Error("Image extraction is only available for DOCX attachments.");
        }
        var dataUrlForImages = String(blobForImages.dataUrl || "");
        if (dataUrlForImages.indexOf("data:") !== 0) {
          throw new Error("This document was attached before structural reading was available. Ask the user to re-attach the file.");
        }
        var bytesForImages = dataUrlToUint8ForServiceWorker(dataUrlForImages);
        return fileParsingForServiceWorker.extractDocxImages(bytesForImages.buffer).then(function (imagesForServiceWorker) {
          sendResponseForServiceWorker({
            ok: true,
            images: Array.isArray(imagesForServiceWorker) ? imagesForServiceWorker : []
          });
        });
      })
      .catch(function (errorForImages) {
        sendResponseForServiceWorker({
          ok: false,
          error: errorForImages && errorForImages.message
            ? errorForImages.message
            : "DOCX image extraction failed."
        });
      });
    return true;
  }

  if (messageForServiceWorker.action === 'dbOp') {
    const fnNameForDbOp = typeof messageForServiceWorker.fn === 'string' ? messageForServiceWorker.fn : '';
    const senderTabIdForDbOp = senderForServiceWorker && senderForServiceWorker.tab &&
      typeof senderForServiceWorker.tab.id === 'number' ? senderForServiceWorker.tab.id : null;
    const sourceIdForDbOp = typeof messageForServiceWorker.sourceId === 'string'
      ? messageForServiceWorker.sourceId
      : '';
    const argsForDbOp = Array.isArray(messageForServiceWorker.args) ? messageForServiceWorker.args : [];
    dbHandlerForServiceWorker.handleDbOp(messageForServiceWorker, function (responseForDbOp) {
      sendResponseForServiceWorker(responseForDbOp);
      if (responseForDbOp && responseForDbOp.ok && fnNameForDbOp) {
        const storeForDbOp = dbOpMutationStoreMapForServiceWorker[fnNameForDbOp];
        if (storeForDbOp) {
          let opsForDbOp = null;
          const extractorForDbOp = dbOpRecordExtractorForServiceWorker[fnNameForDbOp];
          if (extractorForDbOp) {
            try {
              opsForDbOp = extractorForDbOp(responseForDbOp.result, argsForDbOp);
            } catch (errForDbOpExtract) {
              // Defensive: any extractor bug → force a full refresh on receivers
              // rather than dropping the signal entirely.
              opsForDbOp = [{ op: 'bulk' }];
            }
          }
          if (USE_STORAGE_BROADCAST_FOR_DB_SYNC) {
            notifyDbChangeViaStorageForServiceWorker(storeForDbOp, sourceIdForDbOp, opsForDbOp);
          } else {
            broadcastDbChangeForServiceWorker(storeForDbOp, senderTabIdForDbOp);
          }
        }
      }
    });
    return true;
  }

  if (messageForServiceWorker.action === 'apiLogOp') {
    dbHandlerForServiceWorker.handleApiLogOp(messageForServiceWorker, sendResponseForServiceWorker);
    return true;
  }

  if (!messageForServiceWorker.type) {
    return false;
  }

  const requestIdForServiceWorker =
    typeof messageForServiceWorker.requestId === "string" ? messageForServiceWorker.requestId : "";
  const hasRequestIdForServiceWorker = Boolean(requestIdForServiceWorker);
  const requestKeyForServiceWorker = hasRequestIdForServiceWorker
    ? buildRuntimeRequestKeyForServiceWorker(requestIdForServiceWorker, senderForServiceWorker)
    : "";

  if (hasRequestIdForServiceWorker) {
    pruneRuntimeRequestCachesForServiceWorker();
    const cachedEntryForServiceWorker = runtimeRequestResponseCacheForServiceWorker.get(requestKeyForServiceWorker);
    if (cachedEntryForServiceWorker && cachedEntryForServiceWorker.response) {
      sendResponseForServiceWorker(cachedEntryForServiceWorker.response);
      return true;
    }
    const inflightEntryForServiceWorker = runtimeRequestInflightForServiceWorker.get(requestKeyForServiceWorker);
    if (inflightEntryForServiceWorker && Array.isArray(inflightEntryForServiceWorker.listeners)) {
      inflightEntryForServiceWorker.listeners.push(sendResponseForServiceWorker);
      return true;
    }
    runtimeRequestInflightForServiceWorker.set(requestKeyForServiceWorker, {
      createdAtMs: Date.now(),
      listeners: [sendResponseForServiceWorker]
    });
  }

  function resolveRuntimeRequestForServiceWorker(responseForServiceWorker) {
    if (!hasRequestIdForServiceWorker) {
      sendResponseForServiceWorker(responseForServiceWorker);
      return;
    }

    const inflightEntryForServiceWorker = runtimeRequestInflightForServiceWorker.get(requestKeyForServiceWorker);
    const listenersForServiceWorker =
      inflightEntryForServiceWorker && Array.isArray(inflightEntryForServiceWorker.listeners)
        ? inflightEntryForServiceWorker.listeners.slice()
        : [sendResponseForServiceWorker];

    runtimeRequestInflightForServiceWorker.delete(requestKeyForServiceWorker);
    runtimeRequestResponseCacheForServiceWorker.set(requestKeyForServiceWorker, {
      createdAtMs: Date.now(),
      response: responseForServiceWorker
    });

    listenersForServiceWorker.forEach((listenerForServiceWorker) => {
      try {
        listenerForServiceWorker(responseForServiceWorker);
      } catch (errorForServiceWorker) {
        // Ignore listener callback errors
      }
    });
  }

  (async () => {
    if (messageForServiceWorker.type === messageTypesForServiceWorker.getStorageEstimate) {
      try {
        const estimateForServiceWorker = await navigator.storage.estimate();
        resolveRuntimeRequestForServiceWorker({
          ok: true,
          usage: estimateForServiceWorker.usage || 0,
          quota: estimateForServiceWorker.quota || 0
        });
      } catch (errForStorageEstimate) {
        resolveRuntimeRequestForServiceWorker({ ok: false, error: String(errForStorageEstimate) });
      }
      return;
    }

    if (messageForServiceWorker.type === messageTypesForServiceWorker.getSettings) {
      const settingsForServiceWorker = await storageManagerForServiceWorker.getSettings();
      resolveRuntimeRequestForServiceWorker({ ok: true, settings: settingsForServiceWorker });
      return;
    }

    if (messageForServiceWorker.type === messageTypesForServiceWorker.saveSettings) {
      const nextSettingsForServiceWorker = await storageManagerForServiceWorker.saveSettings(
        messageForServiceWorker.settings || {}
      );
      await contextMenusForServiceWorker.rebuildContextMenus();
      resolveRuntimeRequestForServiceWorker({ ok: true, settings: nextSettingsForServiceWorker });
      return;
    }

    if (messageForServiceWorker.type === messageTypesForServiceWorker.runAction) {
      const tabForServiceWorker =
        typeof messageForServiceWorker.tabId === "number"
          ? await getTabByIdForServiceWorker(messageForServiceWorker.tabId)
          : await tabMessagingForServiceWorker.queryActiveTab();

      const actionPayloadForServiceWorker = {};
      if (typeof messageForServiceWorker.clipboardText === "string") {
        actionPayloadForServiceWorker.clipboardText = messageForServiceWorker.clipboardText;
      }
      if (typeof messageForServiceWorker.desiredEnabled === "boolean") {
        actionPayloadForServiceWorker.desiredEnabled = messageForServiceWorker.desiredEnabled;
      }

      const actionResultForServiceWorker = await runActionOnTabForServiceWorker(
        tabForServiceWorker,
        messageForServiceWorker.action,
        "runtimeMessage",
        actionPayloadForServiceWorker
      );
      resolveRuntimeRequestForServiceWorker(actionResultForServiceWorker);
      return;
    }

    resolveRuntimeRequestForServiceWorker({ ok: false, error: "Unsupported message type." });
  })().catch((errorForServiceWorker) => {
    resolveRuntimeRequestForServiceWorker({
      ok: false,
      error:
        errorForServiceWorker && errorForServiceWorker.message
          ? errorForServiceWorker.message
          : "Unhandled runtime request error.",
      errorCode: errorCodesForServiceWorker.handlerException || "HANDLER_EXCEPTION"
    });
  });

  return true;
});
