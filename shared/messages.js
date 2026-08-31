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
    quickQuestionSelection: "quickQuestionSelection",
    toggleFloatingPanel: "toggleFloatingPanel",
    panelVisibilityChanged: "panelVisibilityChanged",
    panelVisibilityCommand: "panelVisibilityCommand",
    agentWebFetch: "agentWebFetch",
    captureVisibleTabScreenshot: "captureVisibleTabScreenshot",
    parseUploadedFile: "parseUploadedFile",
    parseAttachmentStructure: "parseAttachmentStructure",
    extractDocxImages: "extractDocxImages",
    // Scanned-PDF transcription, run as a job in the offscreen document. The pages of a PDF
    // that yielded no extractable text are transcribed by an OCR or vision model, which takes
    // long enough that hosting it in the service worker gets the worker killed mid-flight.
    // SW → offscreen: start / cancel. offscreen → SW: progress and completion, which the SW
    // relays to the initiating tab as pdfOcrJobDeliver.
    pdfOcrJobRun: "pdfOcrJobRun",
    pdfOcrJobCancel: "pdfOcrJobCancel",
    pdfOcrJobEvent: "pdfOcrJobEvent",
    pdfOcrJobDeliver: "pdfOcrJobDeliver",
    addImageToChat: "addImageToChat",
    addSelectionToChat: "addSelectionToChat",
    saveSelectionToClips: "saveSelectionToClips",
    // Cross-tab live chat streaming relay.
    //   receiverDeliver: SW → content. Receivers process and render the stream
    //                    events the offscreen loop emits (see offscreenStreamBroadcast).
    streamReceiverDeliver: "streamReceiverDeliver",
    // Cancel routing: a tab requests cancel; the SW signals the offscreen loop
    // hosting the run to abort it.
    streamCancelRequest: "streamCancelRequest",
    // Catch-up: a receiver tab asks the SW for the current snapshot of a chat
    // that may be mid-stream on another tab. SW responds synchronously with
    // the cumulative text, tool steps + statuses, and retry notice.
    streamSnapshotRequest: "streamSnapshotRequest",
    // Background-mediated active-tab tracking. The SW maintains a single
    // "currently active tab" id that survives focus moving to another app
    // (window focus → WINDOW_ID_NONE is ignored).
    //   activeTabChanged:        SW → content. A trigger telling the tab to
    //                            re-pull its panel visibility decision.
    //   resolvePanelStateForTab: content → SW. Authoritative answer to "should
    //                            THIS tab show the panel?" = global isOpen AND
    //                            this tab is the active tab. The single source of
    //                            truth for panel visibility; content applies it.
    activeTabChanged: "activeTabChanged",
    resolvePanelStateForTab: "resolvePanelStateForTab",
    // Advanced automation (chrome.debugger / CDP) behavioral toggle. The
    // debugger permission is required at install (Chrome forbids it as
    // optional), so these gate use, not the permission. The enabled flag lives
    // in storage and syncs across tabs via storage.onChanged.
    //   cdpAutomationStatus:  content → SW, returns { enabled }.
    //   cdpAutomationEnable:  content → SW, opens the consent window.
    //   cdpAutomationDisable: content → SW, turns the feature off and detaches.
    cdpAutomationStatus: "cdpAutomationStatus",
    cdpAutomationEnable: "cdpAutomationEnable",
    cdpAutomationDisable: "cdpAutomationDisable",
    // Umbrella action for agent-driven CDP session ops, dispatched by op in the
    // service worker: acquire | release | detach | state | command.
    cdpAutomation: "cdpAutomation",
    // Offscreen-hosted agent run. The orchestration loop runs in the offscreen
    // document so an in-flight run survives a page reload (the content script
    // dies on navigation, the offscreen document does not).
    //   agentRunStart:           content → SW. SW ensures the offscreen doc and
    //                            forwards the run params; SW maps chatId → targetTabId.
    //   offscreenStreamBroadcast: offscreen → SW. The stream is sourced from the offscreen
    //                            doc (which has no sender.tab); SW fans out
    //                            streamReceiverDeliver to ALL tabs.
    //   offscreenCancelRequest:  SW → offscreen. Aborts the run's controller.
    //   delegatePageTool:        offscreen → SW. SW relays a page-DOM-bound tool call
    //                            to the target tab's content script.
    //   runDelegatedPageTool:    SW → content. The content script runs the page-DOM
    //                            tool body against its live document and returns the result.
    agentRunStart: "agentRunStart",
    offscreenStreamBroadcast: "offscreenStreamBroadcast",
    offscreenCancelRequest: "offscreenCancelRequest",
    delegatePageTool: "delegatePageTool",
    runDelegatedPageTool: "runDelegatedPageTool"
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
