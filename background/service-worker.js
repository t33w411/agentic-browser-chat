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
  "./dbHandler.js"
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
const agentNamespaceForServiceWorker = globalThis.ABChatAgent || {};
const fileParsingForServiceWorker = agentNamespaceForServiceWorker.fileParsing || {};
const runtimeRequestResponseCacheForServiceWorker = new Map();
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
const academicSiteOperatorsForServiceWorker = [
  'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'scholar.google.com', 'semanticscholar.org',
  'jstor.org', 'researchgate.net', 'biorxiv.org', 'ssrn.com', 'ieeexplore.ieee.org', 'dl.acm.org'
].map(function (d) { return 'site:' + d; }).join(' OR ');
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

  if (academicOnlyForSearch) {
    queryForSearch = queryForSearch + ' ' + academicSiteOperatorsForServiceWorker;
  }

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
            tools: [{ type: 'openrouter:web_search', config: { max_results: maxResultsForSearch } }],
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: 'Search the web for the user\'s query and return the results as a JSON object in this exact format: {"results": [{"title": "...", "url": "...", "snippet": "..."}]}. Include up to ' + maxResultsForSearch + ' results. Output ONLY the JSON object with no other text.'
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
    var contentForSearch = jsonForSearch.choices && jsonForSearch.choices[0] && jsonForSearch.choices[0].message
      ? (jsonForSearch.choices[0].message.content || '')
      : '';

    var parsedForSearch = null;
    try { parsedForSearch = JSON.parse(contentForSearch); } catch (e) {}
    if (!parsedForSearch) {
      var jsonMatchForSearch = contentForSearch.match(/\{[\s\S]*\}/);
      if (jsonMatchForSearch) {
        try { parsedForSearch = JSON.parse(jsonMatchForSearch[0]); } catch (e) {}
      }
    }
    var resultsForSearch = (parsedForSearch && Array.isArray(parsedForSearch.results)) ? parsedForSearch.results : null;

    if (!Array.isArray(resultsForSearch) || resultsForSearch.length === 0) {
      sendResponseForSearch({ ok: false, error: 'Web search returned no structured results. Try rephrasing the query.', latencyMs: latencyMsForSearch, rawResponse: contentForSearch });
      return;
    }

    var normalizedForSearch = resultsForSearch
      .map(function (r) {
        return {
          title: typeof r.title === 'string' ? r.title : '',
          url: typeof r.url === 'string' ? r.url : '',
          snippet: typeof r.snippet === 'string' ? r.snippet : ''
        };
      })
      .filter(function (r) { return r.url; });

    var finalResultsForSearch = normalizedForSearch;
    var academicFallbackForSearch = false;
    if (academicOnlyForSearch) {
      var filteredForSearch = normalizedForSearch.filter(function (r) {
        try {
          var hostname = new URL(r.url).hostname.toLowerCase().replace(/^www\./, '');
          return academicDomainsForServiceWorker.some(function (d) {
            return hostname === d || hostname.endsWith('.' + d);
          });
        } catch (e) { return false; }
      });
      if (filteredForSearch.length > 0) {
        finalResultsForSearch = filteredForSearch;
      } else {
        academicFallbackForSearch = true;
      }
    }

    sendResponseForSearch({ ok: true, results: finalResultsForSearch, academicFallback: academicFallbackForSearch, latencyMs: latencyMsForSearch, rawResponse: contentForSearch, usage: (jsonForSearch && jsonForSearch.usage) || null });
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
    '- Do not include any text outside the JSON object.'
  ].join('\n');
  var userMsgForFix = 'Original question:\n' + JSON.stringify(question, null, 2) + '\n\nIssues to fix:\n' + issues.map(function (i) { return '- ' + i; }).join('\n');
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
    if (lastErrForFix || !respForFix || !respForFix.ok) return null;
    var jsonForFix = await respForFix.json();
    var rawForFix = jsonForFix.choices && jsonForFix.choices[0] && jsonForFix.choices[0].message
      ? (jsonForFix.choices[0].message.content || '') : '';
    var parsedForFix = null;
    try { parsedForFix = JSON.parse(rawForFix); } catch (e) {}
    if (!parsedForFix) {
      var matchForFix = rawForFix.match(/\{[\s\S]*\}/);
      if (matchForFix) { try { parsedForFix = JSON.parse(matchForFix[0]); } catch (e) {} }
    }
    return (parsedForFix && typeof parsedForFix === 'object') ? parsedForFix : null;
  } catch (e) {
    return null;
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
    '- Do not include any text outside the JSON object.'
  ].filter(function (l) { return l !== null; }).join('\n');

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
      sendResponseForGenQ({ ok: false, error: 'Question generation API error ' + responseForGenQ.status + ': ' + errTextForGenQ.slice(0, 200) });
      return;
    }
    if (requestRecordForGenQ && requestRecordForGenQ.signal.aborted) {
      sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }

    var jsonForGenQ = await responseForGenQ.json();
    var rawContentForGenQ = jsonForGenQ.choices && jsonForGenQ.choices[0] && jsonForGenQ.choices[0].message
      ? (jsonForGenQ.choices[0].message.content || '')
      : '';

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
      sendResponseForGenQ({ ok: false, cancelled: true, error: 'Cancelled' });
      return;
    }
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

// --- Offscreen document for audio playback ---

const OFFSCREEN_URL_FOR_SERVICE_WORKER = 'offscreen/offscreen.html';

async function playReminderBeepViaOffscreenForServiceWorker() {
  if (!chrome.offscreen) return;
  var offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL_FOR_SERVICE_WORKER);
  var existingContexts = [];
  try {
    existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
  } catch (e) { /* getContexts not available in older Chrome */ }
  if (existingContexts.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL_FOR_SERVICE_WORKER,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play reminder alert beep'
      });
    } catch (e) { return; }
  }
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

chrome.runtime.onInstalled.addListener(async () => {
  // Rebuild context menus for the new/updated manifest.
  contextMenusForServiceWorker.rebuildContextMenus();
  // Recover all currently open tabs immediately after reload/update so users do not
  // see stale highlights while waiting to open popup or interact with the extension.
  await runReloadRecoveryWithRetriesForServiceWorker();
  cleanExpiredWebFetchCacheForServiceWorker();
  ensureReminderAlarmForServiceWorker();
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

  if (messageForServiceWorker.action === (actionsForServiceWorker.getActiveTabStatus || "getActiveTabStatus")) {
    var senderTabIdForActiveTabStatus = senderForServiceWorker && senderForServiceWorker.tab && typeof senderForServiceWorker.tab.id === "number"
      ? senderForServiceWorker.tab.id
      : null;
    if (currentActiveTabIdForServiceWorker === null) {
      // Lazy-init in case the SW was just spun up by this very message and
      // hasn't yet resolved the focused window.
      initActiveTabTrackingForServiceWorker();
    }
    var isActiveForActiveTabStatus = typeof senderTabIdForActiveTabStatus === "number" &&
      senderTabIdForActiveTabStatus === currentActiveTabIdForServiceWorker;
    sendResponseForServiceWorker({ ok: true, isActive: isActiveForActiveTabStatus });
    return false;
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

  if (messageForServiceWorker.action === "abchatGetOpenTabs") {
    var currentWindowIdForTabs = senderForServiceWorker && senderForServiceWorker.tab
      ? senderForServiceWorker.tab.windowId
      : undefined;
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
              title: String(tabForServiceWorker.title || tabForServiceWorker.url || "Untitled tab"),
              url: String(tabForServiceWorker.url || ""),
              favIconUrl: String(tabForServiceWorker.favIconUrl || ""),
              active: Boolean(tabForServiceWorker.active),
              discarded: Boolean(tabForServiceWorker.discarded)
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
