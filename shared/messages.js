(function () {
  if (typeof window === "undefined") {
    return;
  }
  var runtimeIdForAbChatInit = "";
  try {
    runtimeIdForAbChatInit = (chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : "";
  } catch (errForAbChatInit) {
    runtimeIdForAbChatInit = "";
  }
  if (runtimeIdForAbChatInit) {
    // Bootstrap only. Re-injection generation ownership lives in content/preInit.js.
    if (!window.abchatListenerGeneration) {
      window.abchatListenerGeneration = 1;
    }
    window.abchatExtensionRuntimeId = runtimeIdForAbChatInit;
  }
})();

(function () {
  const globalScopeForMessages = globalThis;
  const existingNamespaceForMessages = globalScopeForMessages.ABChatShared || {};

  const actionsForMessages = {
    checkInjected: "checkInjected",
    checkReady: "checkReady",
    contentScriptReady: "contentScriptReady",
    ping: "ping",
    summarizeSelection: "summarizeSelection",
    explainSelection: "explainSelection",
    proofreadSelection: "proofreadSelection",
    quickQuestionSelection: "quickQuestionSelection",
    toggleFloatingPanel: "toggleFloatingPanel",
    panelVisibilityChanged: "panelVisibilityChanged",
    panelVisibilityCommand: "panelVisibilityCommand",
    agentWebFetch: "agentWebFetch",
    captureVisibleTabScreenshot: "captureVisibleTabScreenshot",
    parseUploadedFile: "parseUploadedFile",
    parseAttachmentStructure: "parseAttachmentStructure",
    extractDocxImages: "extractDocxImages",
    addImageToChat: "addImageToChat",
    addSelectionToChat: "addSelectionToChat",
    // Cross-tab live chat streaming relay.
    //   originatorBroadcast: content → SW. SW relays to all other tabs.
    //   receiverDeliver:     SW → content. Receivers process and render.
    streamOriginatorBroadcast: "streamOriginatorBroadcast",
    streamReceiverDeliver: "streamReceiverDeliver",
    // Cancel routing: receiver requests cancel, SW broadcasts; only the tab
    // that holds the local AbortController for this chatId actually aborts.
    streamCancelRequest: "streamCancelRequest",
    streamCancelDeliver: "streamCancelDeliver",
    // Catch-up: a receiver tab asks the SW for the current snapshot of a chat
    // that may be mid-stream on another tab. SW responds synchronously with
    // the cumulative text, tool steps + statuses, and retry notice.
    streamSnapshotRequest: "streamSnapshotRequest",
    // Background-mediated active-tab tracking. The SW maintains a single
    // "currently active tab" id that survives focus moving to another app
    // (window focus → WINDOW_ID_NONE is ignored). Content scripts use this
    // instead of document.hasFocus() so the panel stays visible in the last
    // known tab when the browser loses OS-level focus.
    activeTabChanged: "activeTabChanged",
    getActiveTabStatus: "getActiveTabStatus"
  };

  const messageTypesForMessages = {
    getSettings: "getSettings",
    saveSettings: "saveSettings",
    runAction: "runAction",
    getStorageEstimate: "getStorageEstimate"
  };

  const communicationForMessages = {
    protocolVersion: 1,
    statuses: {
      handled: "handled",
      notReady: "notReady",
      error: "error",
      unsupportedAction: "unsupportedAction",
      contextInvalid: "contextInvalid"
    },
    errorCodes: {
      noReceiver: "NO_RECEIVER",
      portClosed: "PORT_CLOSED",
      timeout: "REQUEST_TIMEOUT",
      csNotReady: "CS_NOT_READY",
      unknownAction: "UNKNOWN_ACTION",
      unsupportedUrl: "UNSUPPORTED_URL",
      toolDisabled: "TOOL_DISABLED",
      contextInvalidated: "CONTEXT_INVALIDATED",
      handlerException: "HANDLER_EXCEPTION",
      injectionFailed: "INJECTION_FAILED",
      invalidRequest: "INVALID_REQUEST"
    }
  };

  globalScopeForMessages.ABChatShared = {
    ...existingNamespaceForMessages,
    actions: actionsForMessages,
    messageTypes: messageTypesForMessages,
    communication: communicationForMessages
  };
})();
