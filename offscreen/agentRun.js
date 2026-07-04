// Offscreen-hosted agent orchestration loop.
//
// The orchestration loop runs here, in the offscreen document, instead of in the page
// content script (which is destroyed on page navigation, killing any in-flight run).
// The offscreen document is independent of any web page's lifecycle, so a run started
// here keeps going across a page reload; the reloaded panel re-subscribes to the run via
// the existing stream-snapshot catch-up path.
//
// This is a DOM-stripped port of sendChatForPanelRuntime in panel/panelRuntime.js. All
// per-tab UI work (live bubbles, rendering, scrolling, token counters) is removed: every
// tab — including the one that started the run — renders the live turn purely as a stream
// RECEIVER, driven by the stream_* events this loop emits via the service worker.
//
// What still runs here: context building, the LLM stream, tool execution, DB persistence,
// the API log, and the CDP run lease. Page-DOM-bound tools (page_query, page_fill_form,
// take_screenshot capture) are delegated to the target tab's content script; page_act and
// page_accessibility_tree reach the page through cdpClient (bound to the target tab id).
//
// Known Phase-1 limitations (page_act from offscreen; tracked for focus-check delegation):
//   - expected_focus preconditions read the offscreen document's activeElement, so they
//     fail safe (the action is refused, nothing is dispatched) rather than mis-typing.
//   - the take_screenshot -> page_act visual-preflight URL-staleness guard compares the
//     offscreen URL on both sides, so it passes but no longer detects a page URL change.
(function () {
  var globalScopeForAgentRun = globalThis;
  var nsForAgentRun = globalScopeForAgentRun.ABChatOffscreen || {};

  var STREAM_TEXT_DEBOUNCE_MS_FOR_AGENT_RUN = 200;
  var TURN_TOTAL_TIMEOUT_MS_FOR_AGENT_RUN = 10 * 60 * 1000;
  var ITER_STREAM_TIMEOUT_MS_FOR_AGENT_RUN = 90 * 1000;
  var ITER_TOOL_STD_TIMEOUT_MS_FOR_AGENT_RUN = 90 * 1000;
  var ITER_TOOL_IMAGE_TIMEOUT_MS_FOR_AGENT_RUN = 3 * 60 * 1000;
  var MAX_TOOL_ITERS_FOR_AGENT_RUN = 20;
  var MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN = 8;
  var MAX_IDENTICAL_FAILING_ROUNDS_FOR_AGENT_RUN = 3;
  var MAX_STREAM_RETRIES_FOR_AGENT_RUN = 3;
  var MAX_CONCURRENT_RUNS_FOR_AGENT_RUN = 3;
  var MIN_TOOL_DISPLAY_MS_FOR_AGENT_RUN = 3000;
  var TOOL_RESULT_LOG_MAX_CHARS_FOR_AGENT_RUN = 500;
  var TOOL_RESULT_API_MAX_CHARS_FOR_AGENT_RUN = 512000;

  var AGENT_NEUTRAL_COMPLETION_FOR_AGENT_RUN = 'I took some actions. Let me know if it looks right or needs more.';
  var AGENT_FALLBACK_RESPONSES_FOR_AGENT_RUN = [
    'Sorry, something went wrong. Please let me know if I should try again.',
    'I wasn\'t able to complete that. Feel free to ask me to try again.',
    'Something didn\'t go as expected. Let me know if you\'d like me to retry.',
    'I ran into an issue and couldn\'t respond. Please try again if you\'d like.',
    'Apologies, I couldn\'t finish my response. Let me know if you want me to give it another go.',
    'I hit a snag and couldn\'t send a reply. Let me know if you\'d like me to try again.'
  ];

  // chatId -> { controller, toolsDoneAt, textDebounceTimer, pendingText }
  var runsForAgentRun = new Map();

  function getRepoForAgentRun() {
    return (globalScopeForAgentRun.ABChatShared || {}).panelDataRepo || null;
  }
  function getAgentNsForAgentRun() {
    return globalScopeForAgentRun.ABChatAgent || {};
  }
  function getApiLoggerForAgentRun() {
    return (globalScopeForAgentRun.ABChatContent || {}).apiLogger || null;
  }

  // ---- stream event emission (offscreen -> SW -> all tabs) ----

  function emitForAgentRun(eventForEmit, chatIdForEmit, payloadForEmit) {
    try {
      chrome.runtime.sendMessage({
        action: 'offscreenStreamBroadcast',
        event: eventForEmit,
        chatId: Number(chatIdForEmit),
        payload: payloadForEmit || null
      }, function () { void chrome.runtime.lastError; });
    } catch (errForEmit) { /* best effort */ }
  }

  function emitStreamTextDebouncedForAgentRun(chatIdForText, accTextForText) {
    var runForText = runsForAgentRun.get(Number(chatIdForText));
    if (!runForText) return;
    runForText.pendingText = accTextForText;
    if (runForText.textDebounceTimer) return;
    runForText.textDebounceTimer = setTimeout(function () {
      runForText.textDebounceTimer = null;
      var textForFlush = runForText.pendingText;
      runForText.pendingText = null;
      if (textForFlush != null) {
        emitForAgentRun('stream_text', chatIdForText, { accText: textForFlush });
      }
    }, STREAM_TEXT_DEBOUNCE_MS_FOR_AGENT_RUN);
  }

  function flushStreamTextForAgentRun(chatIdForFlush) {
    var runForFlush = runsForAgentRun.get(Number(chatIdForFlush));
    if (!runForFlush) return;
    if (runForFlush.textDebounceTimer) {
      clearTimeout(runForFlush.textDebounceTimer);
      runForFlush.textDebounceTimer = null;
    }
    if (runForFlush.pendingText != null) {
      emitForAgentRun('stream_text', chatIdForFlush, { accText: runForFlush.pendingText });
      runForFlush.pendingText = null;
    }
  }

  // ---- page-DOM tool delegation (offscreen -> SW -> target tab content script) ----

  function delegatePageToolForAgentRun(toolForDelegate, argsForDelegate, chatIdForDelegate) {
    return new Promise(function (resolveForDelegate) {
      try {
        chrome.runtime.sendMessage({
          action: 'delegatePageTool',
          tool: toolForDelegate,
          args: argsForDelegate || {},
          chatId: Number(chatIdForDelegate)
        }, function (responseForDelegate) {
          if (chrome.runtime.lastError) {
            resolveForDelegate({ ok: false, error: 'The page could not be reached to run this action (' + (chrome.runtime.lastError.message || 'no response') + '). The tab may have been closed or be mid-navigation.' });
            return;
          }
          if (!responseForDelegate || responseForDelegate.ok !== true) {
            resolveForDelegate((responseForDelegate && responseForDelegate.result) || { ok: false, error: (responseForDelegate && responseForDelegate.error) || 'The page tool could not be run on the target tab.' });
            return;
          }
          resolveForDelegate(responseForDelegate.result);
        });
      } catch (errForDelegate) {
        resolveForDelegate({ ok: false, error: 'Failed to delegate page tool: ' + ((errForDelegate && errForDelegate.message) || String(errForDelegate)) });
      }
    });
  }

  function buildCaptureScreenshotForAgentRun(chatIdForCapture) {
    // take_screenshot calls context.captureScreenshot() and expects { ok, dataUrl }.
    // The capture (which must hide the panel first) can only happen in the target tab's
    // content script, so it is delegated there.
    return function captureScreenshotDelegatedForAgentRun() {
      return delegatePageToolForAgentRun('__capture_screenshot__', {}, chatIdForCapture);
    };
  }

  // page_act joins the delegated set so it runs in the target tab's content script, where
  // `document` is the live page: that is what makes the panel click-through occlusion, the
  // elementFromPoint target probe, the mutation/URL/title observation, the focus readback,
  // and selector resolution work. Run from the offscreen document they all targeted the
  // empty offscreen DOM instead, so the panel silently occluded clicks and the observability
  // fields were meaningless. page_accessibility_tree stays in the offscreen loop because it
  // is a pure CDP read with no document dependency.
  var PAGE_DELEGATED_TOOLS_FOR_AGENT_RUN = { page_query: true, page_fill_form: true, page_act: true };

  // Order-independent signature of a round's tool calls (name + canonicalized arguments),
  // used to detect a degenerate loop where the model re-issues the identical failing call
  // without adapting. Arguments are re-stringified with sorted keys so a pure key reorder
  // still compares equal; unparseable arguments fall back to the raw string.
  function canonicalizeJsonForAgentRun(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalizeJsonForAgentRun).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalizeJsonForAgentRun(value[k]); }).join(',') + '}';
  }

  function computeToolRoundSignatureForAgentRun(toolCalls) {
    if (!toolCalls || !toolCalls.length) return '';
    var parts = toolCalls.map(function (tc) {
      var fn = tc && tc.function ? tc.function : {};
      var nameForSig = fn.name || '';
      var argsRaw = typeof fn.arguments === 'string' ? fn.arguments : '';
      var argsCanon;
      try { argsCanon = canonicalizeJsonForAgentRun(JSON.parse(argsRaw || '{}')); }
      catch (e) { argsCanon = argsRaw; }
      return nameForSig + '\x00' + argsCanon;
    });
    parts.sort();
    return parts.join('\x01');
  }

  function executeToolForAgentRun(nameForExec, argsForExec, contextForExec) {
    if (PAGE_DELEGATED_TOOLS_FOR_AGENT_RUN[nameForExec]) {
      return delegatePageToolForAgentRun(nameForExec, argsForExec, contextForExec.chatId);
    }
    var executeToolLocalForAgentRun = getAgentNsForAgentRun().executeTool;
    if (typeof executeToolLocalForAgentRun !== 'function') {
      return Promise.resolve({ ok: false, error: 'Tool executor not available.' });
    }
    return executeToolLocalForAgentRun(nameForExec, argsForExec, contextForExec);
  }

  // ---- helpers ----

  async function loadAgentMemoryContextForAgentRun(repoForMemCtx) {
    if (!repoForMemCtx || typeof repoForMemCtx.listNotes !== 'function') {
      return { agentMemory: null, agentMemoryId: null, agentSkills: [] };
    }
    try {
      var agentNotesForMemCtx = await repoForMemCtx.listNotes('agent');
      var memoryNoteForMemCtx = null;
      var skillNotesForMemCtx = [];
      for (var iForMemCtx = 0; iForMemCtx < agentNotesForMemCtx.length; iForMemCtx++) {
        var noteForMemCtx = agentNotesForMemCtx[iForMemCtx];
        var tagsForMemCtx = Array.isArray(noteForMemCtx.tags) ? noteForMemCtx.tags : [];
        if (!memoryNoteForMemCtx && tagsForMemCtx.indexOf('memory') !== -1 && tagsForMemCtx.indexOf('skills') === -1) {
          memoryNoteForMemCtx = noteForMemCtx;
        } else if (tagsForMemCtx.indexOf('skills') !== -1) {
          var slugForMemCtx = '';
          for (var jForMemCtx = 0; jForMemCtx < tagsForMemCtx.length; jForMemCtx++) {
            if (tagsForMemCtx[jForMemCtx] !== 'skills' && tagsForMemCtx[jForMemCtx] !== 'memory') {
              slugForMemCtx = tagsForMemCtx[jForMemCtx];
              break;
            }
          }
          skillNotesForMemCtx.push({ id: noteForMemCtx.id, title: String(noteForMemCtx.title || ''), slug: slugForMemCtx });
        }
      }
      return {
        agentMemory: memoryNoteForMemCtx ? String(memoryNoteForMemCtx.body || '') : null,
        agentMemoryId: memoryNoteForMemCtx ? memoryNoteForMemCtx.id : null,
        agentSkills: skillNotesForMemCtx
      };
    } catch (errForMemCtx) {
      return { agentMemory: null, agentMemoryId: null, agentSkills: [] };
    }
  }

  // Strip base64 image data before a messages array is stored in the API log (CLAUDE.md
  // section 30). Non-mutating: the real messages sent to the API are untouched.
  function sanitizeMessagesForLogForAgentRun(messagesForSanitize) {
    if (!Array.isArray(messagesForSanitize)) return messagesForSanitize;
    return messagesForSanitize.map(function (msgForSanitize) {
      if (!msgForSanitize || !Array.isArray(msgForSanitize.content)) return msgForSanitize;
      var copyForSanitize = {};
      for (var keyForSanitize in msgForSanitize) {
        if (Object.prototype.hasOwnProperty.call(msgForSanitize, keyForSanitize)) {
          copyForSanitize[keyForSanitize] = msgForSanitize[keyForSanitize];
        }
      }
      copyForSanitize.content = msgForSanitize.content.map(function (partForSanitize) {
        if (partForSanitize && partForSanitize.type === 'image_url') {
          return { type: 'image_url', image_url: { url: '[image data omitted from log]' } };
        }
        return partForSanitize;
      });
      return copyForSanitize;
    });
  }

  function chatSummaryFromMessagesForAgentRun(messagesForSummary) {
    var listForSummary = Array.isArray(messagesForSummary) ? messagesForSummary : [];
    for (var iForSummary = 0; iForSummary < listForSummary.length; iForSummary++) {
      var mForSummary = listForSummary[iForSummary];
      if (mForSummary && mForSummary.role === 'user') {
        var textForSummary = String(mForSummary.content || mForSummary.md || '').trim();
        if (textForSummary) return textForSummary.length > 140 ? textForSummary.slice(0, 137) + '...' : textForSummary;
      }
    }
    return '';
  }

  function isAbortedForAgentRun(runForAbort) {
    return Boolean(runForAbort && runForAbort.controller && runForAbort.controller.signal.aborted);
  }

  function delayForAgentRun(msForDelay, signalForDelay) {
    return new Promise(function (resolveForDelay) {
      var timerForDelay = setTimeout(resolveForDelay, msForDelay);
      if (signalForDelay) {
        signalForDelay.addEventListener('abort', function () { clearTimeout(timerForDelay); resolveForDelay(); }, { once: true });
      }
    });
  }

  // ---- main loop ----

  async function sendChatForOffscreen(paramsForRun) {
    var chatId = Number(paramsForRun.chatId);
    if (!Number.isFinite(chatId)) return;
    // A run for this chat is already in flight in this offscreen document (e.g. a retried
    // agentRunStart delivery, or two tabs racing). The live run owns the stream lifecycle, so
    // return silently without emitting stream_end — doing so would tear down the receiver UI
    // for the in-flight run.
    if (runsForAgentRun.has(chatId)) return;

    // Recover the initiator's UI for a run refused before it starts. The panel has already
    // flipped to the sending state and added the chat to its streaming sets, so a run that
    // never emits stream_start must still emit stream_end (optionally with a notice) or the
    // send button, working flag, and chat-list streaming dot stay stuck.
    function refuseRunForOffscreen(noticeTextForRefuse) {
      if (noticeTextForRefuse) emitForAgentRun('stream_system_notice', chatId, { text: noticeTextForRefuse });
      emitForAgentRun('stream_end', chatId, null);
    }

    // Global concurrent-run cap. runsForAgentRun lives in the single shared offscreen
    // document, so its size is the true cross-tab count of active offscreen runs (this chat
    // is not among them — the duplicate guard above already returned). The panel enforces the
    // same cap before handoff for immediate feedback; this is the authoritative backstop for
    // two tabs racing past that pre-check.
    if (runsForAgentRun.size >= MAX_CONCURRENT_RUNS_FOR_AGENT_RUN) {
      refuseRunForOffscreen('Too many active agent sessions (max ' + MAX_CONCURRENT_RUNS_FOR_AGENT_RUN + '). Wait for another chat to finish before starting this one.');
      return;
    }

    var model = String(paramsForRun.model || '');
    var apiKey = String(paramsForRun.apiKey || '');
    var imageModelForRun = String(paramsForRun.imageModel || '');
    var automationEnabledForRun = Boolean(paramsForRun.automationEnabled);
    var agentRulesForRun = String(paramsForRun.agentRules || '');
    var targetTabIdForRun = (typeof paramsForRun.targetTabId === 'number') ? paramsForRun.targetTabId : null;
    var visualPreflightSessionIdForRun = String(paramsForRun.visualPreflightSessionId || ('vp_' + Date.now().toString(36)));
    var userTextForRun = String(paramsForRun.userText || '');
    var contextWindowForRun = Number(paramsForRun.contextWindow) || null;
    var pricingForRun = paramsForRun.pricing || {};
    var completionCostPerMillionForRun = Number(pricingForRun.completionCostPerMillion) || 0;
    var imageGenCostForRun = Number(pricingForRun.imageGenCost) || 0;
    var compactorCostPerMillionForRun = Number(pricingForRun.compactorCostPerMillion) || 0;

    if (!apiKey || !model) { refuseRunForOffscreen('Could not start the agent run: missing API key or model.'); return; }

    var repoForRun = getRepoForAgentRun();
    if (!repoForRun || typeof repoForRun.getChat !== 'function' || typeof repoForRun.createMessage !== 'function') { refuseRunForOffscreen('Could not start the agent run: storage is unavailable. Please try again.'); return; }

    var agentNsForRun = getAgentNsForAgentRun();
    var clientForRun = agentNsForRun.client || {};
    var contextBuilderForRun = agentNsForRun.contextBuilder || {};
    var compactorForRun = agentNsForRun.compactor || null;
    var cdpClientForRun = agentNsForRun.cdpClient || null;
    if (typeof clientForRun.streamCompletion !== 'function') { refuseRunForOffscreen('Could not start the agent run: the agent is not ready. Please try again.'); return; }

    var controllerForRun = new AbortController();
    var runStateForRun = { controller: controllerForRun, toolsDoneAt: 0, textDebounceTimer: null, userStopRequested: false, pendingText: null };
    runsForAgentRun.set(chatId, runStateForRun);

    var timeoutReasonForRun = null;
    var turnTotalTimeoutIdForRun = setTimeout(function () {
      if (!timeoutReasonForRun) timeoutReasonForRun = 'total';
      controllerForRun.abort();
    }, TURN_TOTAL_TIMEOUT_MS_FOR_AGENT_RUN);

    function buildTimeoutNoticeForRun(reasonForNotice, toolTimeoutMsForNotice) {
      var agentRunStopForNotice = (globalThis.ABChatShared || {}).agentRunStop;
      if (agentRunStopForNotice && typeof agentRunStopForNotice.buildNotice === 'function') {
        return agentRunStopForNotice.buildNotice(reasonForNotice, toolTimeoutMsForNotice);
      }
      return '';
    }

    function markRunStoppedForRun() {
      if (logStopReasonForRun) return;
      var agentRunStopForMark = (globalThis.ABChatShared || {}).agentRunStop;
      logStopReasonForRun = agentRunStopForMark && typeof agentRunStopForMark.resolveStopReason === 'function'
        ? agentRunStopForMark.resolveStopReason({
            timeoutReason: timeoutReasonForRun,
            userStopRequested: !!(runStateForRun && runStateForRun.userStopRequested),
            wasAborted: controllerForRun.signal.aborted
          })
        : (timeoutReasonForRun || 'cancelled');
    }

    var iterCount = 0;
    var consecutiveEmptyItersForRun = 0;
    var identicalFailingRoundCountForRun = 0;
    var lastFailingRoundSignatureForRun = null;
    var sideCallCostForRun = 0;
    var turnMainCostAccumForRun = 0;
    var prevTurnMainCostForRun = 0;
    var preSendCostForRun = 0;

    // Push the live session token/cost counter to the panel, mirroring the legacy in-panel
    // loop's per-turn updateSessionTokenDisplay call. The receiver updates only when this
    // chat is active.
    function emitUsageDisplayForRun() {
      emitForAgentRun('stream_usage', chatId, {
        usage: logUsageForRun,
        cumulativeCost: preSendCostForRun + turnMainCostAccumForRun + sideCallCostForRun
      });
    }
    var accumulatedSearchSourcesForRun = [];
    var seenSearchUrlsForRun = new Set();
    var cdpRunLeaseHeldForRun = false;

    var hooksForRun = agentNsForRun.hooks || null;
    var turnContextForRun = (hooksForRun && typeof hooksForRun.createTurnContext === 'function')
      ? hooksForRun.createTurnContext({ chatId: chatId, userText: userTextForRun })
      : null;
    var pendingSystemNotesForRun = [];
    var turnHookFiringsByIterForRun = [];
    async function dispatchHookForRun(eventNameForDispatch, payloadForDispatch) {
      if (!hooksForRun || typeof hooksForRun.dispatch !== 'function' || !turnContextForRun) {
        return { block: null, continueWithSystemNote: null, annotate: null, firings: [] };
      }
      var resultForDispatch = await hooksForRun.dispatch(eventNameForDispatch, payloadForDispatch, turnContextForRun);
      if (resultForDispatch && Array.isArray(resultForDispatch.firings) && resultForDispatch.firings.length > 0) {
        turnHookFiringsByIterForRun.push({ iter: turnContextForRun.iterIndex, event: eventNameForDispatch, firings: resultForDispatch.firings });
      }
      if (resultForDispatch && typeof resultForDispatch.continueWithSystemNote === 'string' && resultForDispatch.continueWithSystemNote) {
        pendingSystemNotesForRun.push(resultForDispatch.continueWithSystemNote);
      }
      return resultForDispatch;
    }

    var logStartTimeForRun = Date.now();
    var logFirstMessagesForRun = null;
    var logApiParamsForRun = null;
    var logAllToolCallsForRun = [];
    var logTurnsForRun = [];
    var logFinalResponseForRun = '';
    var logUsageForRun = null;
    var logResolvedModelForRun = null;
    var logStatusForRun = 'success';
    var logErrorMsgForRun = '';
    var logStopReasonForRun = null;
    var lastToolTimeoutMsForRun = ITER_TOOL_STD_TIMEOUT_MS_FOR_AGENT_RUN;
    var hasAppendedRenderableAssistantMessageForRun = false;
    var hadSuccessfulToolCallForRun = false;
    var didRetryEmptyFinalTurnForRun = false;

    // In-memory copy of the chat's messages, seeded from the DB (the initiator already
    // persisted the user message before starting this run). contextBuilder reads this on
    // each iteration; we push every message we persist back onto it.
    var messagesForRun = [];
    var compactionSummaryForRun = '';
    var compactedThroughMessageIdForRun = null;

    var toolDefsForRun = (agentNsForRun.toolDefs || []).filter(function (toolDefForRun) {
      var toolNameForRun = toolDefForRun && toolDefForRun.function ? toolDefForRun.function.name : '';
      if ((toolNameForRun === 'page_act' || toolNameForRun === 'page_accessibility_tree') && !automationEnabledForRun) return false;
      return true;
    });

    try {
      var chatRecordForRun = await repoForRun.getChat(chatId);
      messagesForRun = (chatRecordForRun && Array.isArray(chatRecordForRun.messages)) ? chatRecordForRun.messages : [];
      compactionSummaryForRun = (chatRecordForRun && typeof chatRecordForRun.compactionSummary === 'string') ? chatRecordForRun.compactionSummary : '';
      compactedThroughMessageIdForRun = (chatRecordForRun && chatRecordForRun.compactedThroughMessageId != null) ? chatRecordForRun.compactedThroughMessageId : null;

      // Cost already persisted on this chat before this run, for the live token/cost counter.
      // Mirrors the panel's sumPersistedChatCost + the legacy per-turn updateSessionTokenDisplay.
      for (var pscIForRun = 0; pscIForRun < messagesForRun.length; pscIForRun++) {
        var pscMsgForRun = messagesForRun[pscIForRun];
        if (pscMsgForRun && pscMsgForRun.role === 'assistant' && Number(pscMsgForRun.usageCost) > 0) {
          preSendCostForRun += Number(pscMsgForRun.usageCost);
        }
      }

      // Compaction (best effort)
      if (compactorForRun && typeof compactorForRun.maybeCompact === 'function' && chatRecordForRun) {
        try {
          emitForAgentRun('stream_compacting', chatId, { active: true });
          var compactionLogStartForRun = Date.now();
          var systemOverheadTokensForRun = 10000;
          if (typeof contextBuilderForRun.estimateSystemOverheadTokens === 'function') {
            var systemOverheadEstimateForRun = contextBuilderForRun.estimateSystemOverheadTokens({
              agentRules: agentRulesForRun,
              automationEnabled: automationEnabledForRun,
              pageNavigationAllowed: true
            }, toolDefsForRun);
            systemOverheadTokensForRun = Math.max(10000, Number(systemOverheadEstimateForRun) || 0);
          }
          var compactionResultForRun = await compactorForRun.maybeCompact({
            apiKey: apiKey,
            model: model,
            messages: messagesForRun,
            existingSummary: compactionSummaryForRun,
            compactedThroughMessageId: compactedThroughMessageIdForRun,
            systemOverheadTokens: systemOverheadTokensForRun,
            contextWindow: contextWindowForRun,
            signal: controllerForRun.signal
          });
          compactionSummaryForRun = (compactionResultForRun && typeof compactionResultForRun.summaryText === 'string') ? compactionResultForRun.summaryText : compactionSummaryForRun;
          compactedThroughMessageIdForRun = (compactionResultForRun && compactionResultForRun.compactedThroughMessageId != null) ? compactionResultForRun.compactedThroughMessageId : compactedThroughMessageIdForRun;
          if (compactionResultForRun && compactionResultForRun.didCompact) {
            var compactionUpdatedAtForRun = new Date().toISOString();
            if (compactionResultForRun.summarizerUsage) {
              var actualCompactionCostForRun = Number(compactionResultForRun.summarizerUsage.cost);
              if (Number.isFinite(actualCompactionCostForRun) && actualCompactionCostForRun > 0) {
                sideCallCostForRun += actualCompactionCostForRun;
              } else {
                var compactionTotalTokensForRun = Number(compactionResultForRun.summarizerUsage.total_tokens) || 0;
                if (compactionTotalTokensForRun > 0 && compactorCostPerMillionForRun > 0) {
                  sideCallCostForRun += (compactionTotalTokensForRun * compactorCostPerMillionForRun) / 1000000;
                }
              }
            }
            if (typeof repoForRun.updateChat === 'function') {
              try {
                await repoForRun.updateChat(chatId, {
                  compactionSummary: compactionSummaryForRun,
                  compactedThroughMessageId: compactedThroughMessageIdForRun,
                  compactionUpdatedAt: compactionUpdatedAtForRun
                });
              } catch (compactionPersistErrForRun) {}
            }
            var compactionApiLoggerForRun = getApiLoggerForAgentRun();
            if (compactionApiLoggerForRun && typeof compactionApiLoggerForRun.writeLog === 'function') {
              compactionApiLoggerForRun.writeLog({
                requestType: 'compaction',
                timestamp: new Date(compactionLogStartForRun).toISOString(),
                chatId: chatId,
                model: compactionResultForRun.summarizerModel || null,
                iterationCount: 1,
                totalLatencyMs: Date.now() - compactionLogStartForRun,
                status: 'success',
                responseContent: compactionSummaryForRun || null,
                usage: compactionResultForRun.summarizerUsage || null
              }).catch(function () {});
            }
          }
        } catch (compactionErrForRun) {
        } finally {
          emitForAgentRun('stream_compacting', chatId, { active: false });
        }
      }

      // UserPromptSubmit hook (once, before the loop).
      var userPromptBlockedForRun = false;
      if (hooksForRun && turnContextForRun) {
        var userPromptResultForRun = await dispatchHookForRun('UserPromptSubmit', { userText: turnContextForRun.userText, chatId: chatId });
        if (userPromptResultForRun && userPromptResultForRun.block) {
          userPromptBlockedForRun = true;
          emitForAgentRun('stream_system_notice', chatId, { text: userPromptResultForRun.block.reason });
        }
      }

      emitForAgentRun('stream_start', chatId, null);

      while (!userPromptBlockedForRun && iterCount < MAX_TOOL_ITERS_FOR_AGENT_RUN) {
        iterCount++;
        var turnStartTimeForRun = Date.now();

        var memCtxForRun = await loadAgentMemoryContextForAgentRun(repoForRun);
        var apiMessages = contextBuilderForRun.build
          ? await contextBuilderForRun.build(messagesForRun, {
              agentRules: agentRulesForRun,
              agentMemory: memCtxForRun.agentMemory,
              agentMemoryId: memCtxForRun.agentMemoryId,
              agentSkills: memCtxForRun.agentSkills,
              compactionSummary: compactionSummaryForRun,
              compactedThroughMessageId: compactedThroughMessageIdForRun,
              automationEnabled: automationEnabledForRun,
              pageNavigationAllowed: true
            })
          : (function () {
              var msgsForFallbackForRun = messagesForRun.map(function (mForFallback) {
                if (!mForFallback || mForFallback.role === '_loading' || mForFallback.role === '_hidden_pair_indicator') return null;
                if (mForFallback.role === 'tool') return { role: 'tool', tool_call_id: mForFallback.tool_call_id, content: mForFallback.content || '' };
                return { role: mForFallback.role === 'user' ? 'user' : 'assistant', content: mForFallback.content || mForFallback.md || '' };
              }).filter(Boolean);
              if (agentRulesForRun) {
                msgsForFallbackForRun.unshift({ role: 'system', content: agentRulesForRun });
              }
              return msgsForFallbackForRun;
            }());

        if (pendingSystemNotesForRun.length > 0) {
          apiMessages.push({ role: 'system', content: pendingSystemNotesForRun.join('\n\n') });
          pendingSystemNotesForRun = [];
        }

        if (turnContextForRun) turnContextForRun.iterIndex = iterCount - 1;

        if (iterCount === 1) {
          logFirstMessagesForRun = sanitizeMessagesForLogForAgentRun(apiMessages);
          logApiParamsForRun = {
            stream: true,
            tool_choice: toolDefsForRun.length > 0 ? 'auto' : undefined,
            parallel_tool_calls: toolDefsForRun.length > 0 ? true : undefined,
            provider: { sort: 'throughput' },
            tools: toolDefsForRun.map(function (t) { return t && t.function ? t.function.name : (t.type || t.name || ''); })
          };
        }

        // Keep tool-step chips visible for a minimum window before the next model call.
        if (runStateForRun.toolsDoneAt > 0) {
          var toolsRemainingForRun = MIN_TOOL_DISPLAY_MS_FOR_AGENT_RUN - (Date.now() - runStateForRun.toolsDoneAt);
          if (toolsRemainingForRun > 0) await delayForAgentRun(toolsRemainingForRun, controllerForRun.signal);
        }

        var accTextForLoop = '';
        var iterStreamTimeoutIdForRun = null;
        var armStreamIdleTimeoutForRun = function () {
          if (iterStreamTimeoutIdForRun) clearTimeout(iterStreamTimeoutIdForRun);
          iterStreamTimeoutIdForRun = setTimeout(function () {
            if (!timeoutReasonForRun) timeoutReasonForRun = 'stream';
            controllerForRun.abort();
          }, ITER_STREAM_TIMEOUT_MS_FOR_AGENT_RUN);
        };
        armStreamIdleTimeoutForRun();
        var streamRetryCountForRun = 0;
        var resultForLoop;
        do {
          accTextForLoop = '';
          resultForLoop = await clientForRun.streamCompletion({
            model: model,
            apiKey: apiKey,
            messages: apiMessages,
            sessionId: 'abchat-' + chatId,
            tools: toolDefsForRun.length > 0 ? toolDefsForRun : undefined,
            signal: controllerForRun.signal,
            onDelta: function (deltaForLoop) {
              armStreamIdleTimeoutForRun();
              if (deltaForLoop.type === 'text' && deltaForLoop.text) {
                accTextForLoop += deltaForLoop.text;
                emitStreamTextDebouncedForAgentRun(chatId, accTextForLoop);
              } else if (deltaForLoop.type === 'retry_notice') {
                emitForAgentRun('stream_retry_notice', chatId, { attempt: deltaForLoop.attempt, maxAttempts: deltaForLoop.maxAttempts });
              }
            }
          });
          if (resultForLoop && typeof resultForLoop.resolvedModel === 'string' && resultForLoop.resolvedModel) {
            logResolvedModelForRun = resultForLoop.resolvedModel;
          }
          if (resultForLoop && !resultForLoop.cancelled && resultForLoop.incompleteStream && streamRetryCountForRun < MAX_STREAM_RETRIES_FOR_AGENT_RUN) {
            streamRetryCountForRun++;
            emitForAgentRun('stream_retry_notice', chatId, { attempt: streamRetryCountForRun, maxAttempts: MAX_STREAM_RETRIES_FOR_AGENT_RUN });
          } else {
            break;
          }
        } while (true);
        clearTimeout(iterStreamTimeoutIdForRun);

        logTurnsForRun.push({
          turnIndex: iterCount,
          latencyMs: Date.now() - turnStartTimeForRun,
          requestMessages: sanitizeMessagesForLogForAgentRun(apiMessages),
          responseText: resultForLoop && resultForLoop.message ? (resultForLoop.message.content || '') : '',
          responseToolCalls: resultForLoop && resultForLoop.message ? (resultForLoop.message.tool_calls || []) : [],
          usage: resultForLoop ? (resultForLoop.usage || null) : null
        });

        if (!resultForLoop || resultForLoop.cancelled) {
          markRunStoppedForRun();
          var salvagedPartialTextForRun = (resultForLoop && resultForLoop.message && typeof resultForLoop.message.content === 'string' && resultForLoop.message.content.trim())
            ? resultForLoop.message.content
            : ((accTextForLoop && accTextForLoop.trim()) ? accTextForLoop : '');
          if (salvagedPartialTextForRun && salvagedPartialTextForRun.trim().length > 0) {
            var salvageRecordForRun = await repoForRun.createMessage(chatId, {
              role: 'assistant', content: salvagedPartialTextForRun, md: salvagedPartialTextForRun, incomplete: true
            }, { touchChat: false });
            if (salvageRecordForRun) messagesForRun.push(salvageRecordForRun);
            hasAppendedRenderableAssistantMessageForRun = true;
            emitForAgentRun('stream_message_persisted', chatId, null);
          }
          break;
        }

        if (resultForLoop.usage) {
          logUsageForRun = resultForLoop.usage;
          var actualMainCostForRun = Number(logUsageForRun.cost);
          turnMainCostAccumForRun += (Number.isFinite(actualMainCostForRun) && actualMainCostForRun > 0)
            ? actualMainCostForRun
            : (Number(logUsageForRun.total_tokens) || 0) * completionCostPerMillionForRun / 1000000;
          // Push the counter as soon as usage arrives (mirroring the in-panel loop) so an empty
          // final turn — which breaks below before the post-persist emit — still reflects its tokens.
          emitUsageDisplayForRun();
        }

        var assistantMsg = resultForLoop.message;
        if (!assistantMsg) break;
        var toolCallsForLoop = assistantMsg.tool_calls;
        var hasContent = assistantMsg.content && assistantMsg.content.trim().length > 0;
        var hasToolCalls = toolCallsForLoop && toolCallsForLoop.length > 0;

        if (!hasContent && !hasToolCalls) {
          if (hadSuccessfulToolCallForRun && !didRetryEmptyFinalTurnForRun) {
            didRetryEmptyFinalTurnForRun = true;
            pendingSystemNotesForRun.push('Your previous response was empty. You have already completed the requested actions. Briefly confirm to the user, in plain language, what you did.');
            continue;
          }
          if (!hadSuccessfulToolCallForRun) {
            emitForAgentRun('stream_system_notice', chatId, { text: 'The model returned an empty response.' });
          }
          break;
        }

        var thisLLMCostForRun = turnMainCostAccumForRun - prevTurnMainCostForRun;
        var asstRecord = {
          role: 'assistant',
          content: assistantMsg.content || '',
          md: assistantMsg.content || '',
          tool_calls: assistantMsg.tool_calls,
          usagePromptTokens: logUsageForRun ? (Number(logUsageForRun.prompt_tokens) || 0) : 0,
          usageCompletionTokens: logUsageForRun ? (Number(logUsageForRun.completion_tokens) || 0) : 0,
          usageTotalTokens: logUsageForRun ? (Number(logUsageForRun.total_tokens) || 0) : 0,
          usageReasoningTokens: (logUsageForRun && logUsageForRun.completion_tokens_details) ? (Number(logUsageForRun.completion_tokens_details.reasoning_tokens) || 0) : 0,
          usageCost: !hasToolCalls ? (thisLLMCostForRun + sideCallCostForRun) : thisLLMCostForRun,
          searchSources: (!hasToolCalls && accumulatedSearchSourcesForRun.length > 0) ? accumulatedSearchSourcesForRun.slice() : []
        };
        var asstRecordPersisted = await repoForRun.createMessage(chatId, asstRecord, { touchChat: false });
        if (asstRecordPersisted) messagesForRun.push(asstRecordPersisted);
        prevTurnMainCostForRun = turnMainCostAccumForRun;
        if (hasContent) hasAppendedRenderableAssistantMessageForRun = true;
        emitForAgentRun('stream_message_persisted', chatId, null);

        if (turnContextForRun && hasToolCalls) {
          for (var tcPushIdxForRun = 0; tcPushIdxForRun < toolCallsForLoop.length; tcPushIdxForRun++) {
            turnContextForRun.toolCallsThisTurn.push(toolCallsForLoop[tcPushIdxForRun]);
          }
        }

        var postModelResponseResultForRun = await dispatchHookForRun('PostModelResponse', {
          assistantMessage: assistantMsg, toolCalls: toolCallsForLoop || [], isFinalReply: !hasToolCalls, chatId: chatId
        });
        if (postModelResponseResultForRun && postModelResponseResultForRun.block) {
          emitForAgentRun('stream_system_notice', chatId, { text: postModelResponseResultForRun.block.reason });
          break;
        }
        if (postModelResponseResultForRun && postModelResponseResultForRun.continueWithSystemNote) continue;

        if (!hasToolCalls) {
          var stopResultForRun = await dispatchHookForRun('Stop', { assistantMessage: assistantMsg, toolCalls: [], isFinalReply: true, chatId: chatId });
          if (stopResultForRun && stopResultForRun.block) {
            emitForAgentRun('stream_system_notice', chatId, { text: stopResultForRun.block.reason });
            break;
          }
          if (stopResultForRun && stopResultForRun.continueWithSystemNote) continue;
          if (assistantMsg.content) logFinalResponseForRun = assistantMsg.content;
          break;
        }

        emitForAgentRun('stream_tool_steps', chatId, { toolCalls: toolCallsForLoop });

        // Acquire the run-scoped CDP lease before page_act/page_accessibility_tree.
        if (!cdpRunLeaseHeldForRun && automationEnabledForRun && cdpClientForRun && typeof cdpClientForRun.acquire === 'function'
            && toolCallsForLoop.some(function (tcForLease) {
              var tcNameForLease = tcForLease.function && tcForLease.function.name;
              return tcNameForLease === 'page_act' || tcNameForLease === 'page_accessibility_tree';
            })) {
          try {
            var runLeaseResForRun = await cdpClientForRun.acquire(targetTabIdForRun);
            if (runLeaseResForRun && runLeaseResForRun.ok) {
              cdpRunLeaseHeldForRun = true;
              await delayForAgentRun(400, controllerForRun.signal);
            }
          } catch (eRunLeaseForRun) {}
        }

        var toolLogEntriesForRun = [];
        var wrapToolPromiseWithAbortForRun = function (toolPromiseForRun) {
          return new Promise(function (resolveForToolAbort) {
            if (controllerForRun.signal.aborted) { resolveForToolAbort({ ok: false, cancelled: true, error: 'Cancelled' }); return; }
            var settledForToolAbort = false;
            var onAbortForToolAbort = function () {
              if (settledForToolAbort) return;
              settledForToolAbort = true;
              resolveForToolAbort({ ok: false, cancelled: true, error: 'Cancelled' });
            };
            controllerForRun.signal.addEventListener('abort', onAbortForToolAbort, { once: true });
            Promise.resolve(toolPromiseForRun).then(function (resultForToolAbort) {
              if (settledForToolAbort) return;
              settledForToolAbort = true;
              controllerForRun.signal.removeEventListener('abort', onAbortForToolAbort);
              resolveForToolAbort(resultForToolAbort);
            }).catch(function (errorForToolAbort) {
              if (settledForToolAbort) return;
              settledForToolAbort = true;
              controllerForRun.signal.removeEventListener('abort', onAbortForToolAbort);
              resolveForToolAbort({ error: errorForToolAbort && errorForToolAbort.message ? errorForToolAbort.message : 'Tool execution failed.' });
            });
          });
        };

        var captureScreenshotForRun = buildCaptureScreenshotForAgentRun(chatId);
        var toolExecPromisesForRun = toolCallsForLoop.map(async function (tc) {
          var tcNameForExec = tc.function ? tc.function.name : '';
          var rawToolArgsForExec = (tc.function && typeof tc.function.arguments === 'string') ? tc.function.arguments : '';
          var toolArgs = {};
          var toolArgsParseErrorForExec = null;
          if (rawToolArgsForExec.trim() !== '') {
            try { toolArgs = JSON.parse(rawToolArgsForExec); } catch (parseErrForExec) { toolArgsParseErrorForExec = parseErrForExec; }
          }
          var logEntry = { name: tcNameForExec, args: toolArgsParseErrorForExec ? { _rawArguments: rawToolArgsForExec } : toolArgs };
          logAllToolCallsForRun.push(logEntry);
          toolLogEntriesForRun.push(logEntry);
          if (toolArgsParseErrorForExec) {
            return { ok: false, error: 'Tool call arguments were not valid JSON and could not be parsed: ' + (toolArgsParseErrorForExec.message || String(toolArgsParseErrorForExec)) + '. The "arguments" field must be a single valid JSON object with every string value properly escaped (newlines as \\n, quotes as \\", backslashes as \\\\); do not split strings using + concatenation. Re-issue this tool call with corrected JSON.' };
          }
          var preToolUseResultForRun = await dispatchHookForRun('PreToolUse', {
            toolName: tcNameForExec, args: toolArgs, callId: tc.id, chatId: chatId, iterIndex: turnContextForRun ? turnContextForRun.iterIndex : 0
          });
          if (preToolUseResultForRun && preToolUseResultForRun.block) return { ok: false, error: preToolUseResultForRun.block.reason };
          return wrapToolPromiseWithAbortForRun(
            executeToolForAgentRun(tcNameForExec, toolArgs, {
              apiKey: apiKey,
              imageModel: imageModelForRun,
              messages: apiMessages,
              model: model,
              chatId: chatId,
              tabId: targetTabIdForRun,
              visualPreflightSessionId: visualPreflightSessionIdForRun,
              signal: controllerForRun.signal,
              captureScreenshot: captureScreenshotForRun
            })
          );
        });

        var hasImageGenInBatchForRun = toolCallsForLoop.some(function (tcForTimeout) {
          return tcForTimeout.function && tcForTimeout.function.name === 'generate_image';
        });
        var toolExecTimeoutMsForRun = hasImageGenInBatchForRun ? ITER_TOOL_IMAGE_TIMEOUT_MS_FOR_AGENT_RUN : ITER_TOOL_STD_TIMEOUT_MS_FOR_AGENT_RUN;
        lastToolTimeoutMsForRun = toolExecTimeoutMsForRun;
        var iterToolTimeoutIdForRun = setTimeout(function () {
          if (!timeoutReasonForRun) timeoutReasonForRun = 'tool';
          controllerForRun.abort();
        }, toolExecTimeoutMsForRun);
        var toolResultsForRun = await Promise.all(toolExecPromisesForRun);
        clearTimeout(iterToolTimeoutIdForRun);
        if (controllerForRun.signal.aborted) {
          markRunStoppedForRun();
          break;
        }

        for (var ti = 0; ti < toolCallsForLoop.length; ti++) {
          if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }
          var tc = toolCallsForLoop[ti];
          var tcNameForResult = tc.function && tc.function.name;
          var toolResult = toolResultsForRun[ti];
          var toolResultForModel = toolResult;
          if (tcNameForResult === 'generate_image' && toolResult && toolResult.ok && typeof toolResult.dataUrl === 'string') {
            toolResultForModel = { ok: true, prompt: toolResult.prompt || '' };
          } else if (tcNameForResult === 'create_document' && toolResult && toolResult.ok && typeof toolResult.dataUrl === 'string') {
            toolResultForModel = { ok: true, format: toolResult.format || '', filename: toolResult.filename || '', mimeType: toolResult.mimeType || '', size: Number(toolResult.size) || 0, note: 'The generated document has been saved and displayed to the user.' };
          } else if (tcNameForResult === 'eval' && toolResult && toolResult.ok && toolResult._generatedDocument && typeof toolResult._generatedDocument.dataUrl === 'string') {
            toolResultForModel = { ok: true, result: toolResult.result, document: { format: toolResult._generatedDocument.format || '', filename: toolResult._generatedDocument.filename || '', mimeType: toolResult._generatedDocument.mimeType || '', size: Number(toolResult._generatedDocument.size) || 0, note: 'The generated document has been saved and displayed to the user.' } };
          }
          if (toolResultForModel && typeof toolResultForModel === 'object' && '_usage' in toolResultForModel) {
            toolResultForModel = Object.assign({}, toolResultForModel);
            delete toolResultForModel._usage;
          }
          if (tcNameForResult === 'web_search' && toolResult && toolResult._usage) {
            var actualSearchCostForRun = Number(toolResult._usage.cost);
            if (Number.isFinite(actualSearchCostForRun) && actualSearchCostForRun > 0) sideCallCostForRun += actualSearchCostForRun;
            else { var searchTotalTokensForRun = Number(toolResult._usage.total_tokens) || 0; if (searchTotalTokensForRun > 0 && completionCostPerMillionForRun > 0) sideCallCostForRun += (searchTotalTokensForRun * completionCostPerMillionForRun) / 1000000; }
          }
          if (tcNameForResult === 'web_search' && toolResult && Array.isArray(toolResult.results)) {
            toolResult.results.forEach(function (r) {
              if (r && r.url && !seenSearchUrlsForRun.has(String(r.url))) {
                seenSearchUrlsForRun.add(String(r.url));
                accumulatedSearchSourcesForRun.push({ url: String(r.url), title: String(r.title || '') });
              }
            });
          }
          if (tcNameForResult === 'generate_image' && toolResult && toolResult._usage) {
            var actualImageCostForRun = Number(toolResult._usage.cost);
            if (Number.isFinite(actualImageCostForRun) && actualImageCostForRun > 0) sideCallCostForRun += actualImageCostForRun;
            else { var imageGenTotalTokensForRun = Number(toolResult._usage.total_tokens) || 0; if (imageGenTotalTokensForRun > 0 && completionCostPerMillionForRun > 0) sideCallCostForRun += (imageGenTotalTokensForRun * completionCostPerMillionForRun) / 1000000; }
          }
          if (tcNameForResult === 'web_fetch' && toolResult && toolResult._usage) {
            var actualFetchCostForRun = Number(toolResult._usage.cost);
            if (Number.isFinite(actualFetchCostForRun) && actualFetchCostForRun > 0) sideCallCostForRun += actualFetchCostForRun;
            else { var fetchTotalTokensForRun = Number(toolResult._usage.total_tokens) || 0; if (fetchTotalTokensForRun > 0 && completionCostPerMillionForRun > 0) sideCallCostForRun += (fetchTotalTokensForRun * completionCostPerMillionForRun) / 1000000; }
          }
          if (tcNameForResult === 'read_tab' && toolResult && toolResult._usage) {
            var actualReadTabCostForRun = Number(toolResult._usage.cost);
            if (Number.isFinite(actualReadTabCostForRun) && actualReadTabCostForRun > 0) sideCallCostForRun += actualReadTabCostForRun;
            else { var readTabTotalTokensForRun = Number(toolResult._usage.total_tokens) || 0; if (readTabTotalTokensForRun > 0 && completionCostPerMillionForRun > 0) sideCallCostForRun += (readTabTotalTokensForRun * completionCostPerMillionForRun) / 1000000; }
          }
          var toolResultStr = typeof toolResultForModel === 'string' ? toolResultForModel : JSON.stringify(toolResultForModel);
          toolLogEntriesForRun[ti].result = toolResultStr.length > TOOL_RESULT_LOG_MAX_CHARS_FOR_AGENT_RUN ? toolResultStr.slice(0, TOOL_RESULT_LOG_MAX_CHARS_FOR_AGENT_RUN) + '…' : toolResultStr;
          var isToolErrorForRun = toolResult && typeof toolResult === 'object' && toolResult.error;
          var toolStepStatusForRun = isToolErrorForRun ? 'error' : 'success';
          var toolStepStatusTextForRun = isToolErrorForRun ? String(toolResult.error) : 'Done';
          emitForAgentRun('stream_tool_step_status', chatId, { toolCallId: tc.id, status: toolStepStatusForRun, statusText: toolStepStatusTextForRun });
          var toolResultStrForApi = toolResultStr.length > TOOL_RESULT_API_MAX_CHARS_FOR_AGENT_RUN
            ? JSON.stringify({ ok: false, error: 'Tool result too large to send (' + toolResultStr.length + ' bytes; max 500 KB). The tool produced too much output; try a more targeted request.' })
            : toolResultStr;
          var toolMsgPersisted = await repoForRun.createMessage(chatId, { role: 'tool', tool_call_id: tc.id, content: toolResultStrForApi, md: '' }, { touchChat: false });
          if (toolMsgPersisted) messagesForRun.push(toolMsgPersisted);
          var parsedToolArgsForPostHook = {};
          try { parsedToolArgsForPostHook = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          await dispatchHookForRun('PostToolUse', {
            toolName: tcNameForResult, args: parsedToolArgsForPostHook, result: toolResultForModel, callId: tc.id, chatId: chatId,
            iterIndex: turnContextForRun ? turnContextForRun.iterIndex : 0, ok: !(toolResult && typeof toolResult === 'object' && toolResult.error)
          });
        }
        if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }

        // OpenAI aspect-ratio canned message (sole tool call).
        var openaiAspectRatioErrorForRun = toolCallsForLoop.length === 1 ? toolResultsForRun.find(function (r) { return r && r.errorCode === 'OPENAI_ASPECT_RATIO_UNSUPPORTED'; }) : null;
        if (openaiAspectRatioErrorForRun) {
          var cannedRatioForRun = openaiAspectRatioErrorForRun.aspectRatio || 'non-square';
          var cannedMsgForRun = 'Your current image model (OpenAI) doesn\'t support ' + cannedRatioForRun + ' images — it can only generate square (1:1) images. To generate a ' + cannedRatioForRun + ' image, go to **Settings** and switch your image model to a Gemini model, then try again.';
          var cannedPersistedForRun = await repoForRun.createMessage(chatId, { role: 'assistant', content: cannedMsgForRun, md: cannedMsgForRun }, { touchChat: false });
          if (cannedPersistedForRun) messagesForRun.push(cannedPersistedForRun);
          hasAppendedRenderableAssistantMessageForRun = true;
          emitForAgentRun('stream_message_persisted', chatId, null);
          break;
        }

        // Persist generated image blobs + display messages.
        for (var gi = 0; gi < toolCallsForLoop.length; gi++) {
          if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }
          var tcNameForImage = toolCallsForLoop[gi].function && toolCallsForLoop[gi].function.name;
          var toolResultForImage = toolResultsForRun[gi];
          if (tcNameForImage !== 'generate_image' || !toolResultForImage || !toolResultForImage.ok) continue;
          if (typeof toolResultForImage.dataUrl !== 'string' || toolResultForImage.dataUrl.indexOf('data:image/') !== 0) continue;
          if (typeof repoForRun.createAttachmentBlob !== 'function') continue;
          try {
            var blobRecordForImage = await repoForRun.createAttachmentBlob({ name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: toolResultForImage.dataUrl, size: toolResultForImage.dataUrl.length });
            if (controllerForRun.signal.aborted) {
              markRunStoppedForRun();
              if (blobRecordForImage && blobRecordForImage.id != null && typeof repoForRun.deleteAttachmentBlob === 'function') { try { await repoForRun.deleteAttachmentBlob(Number(blobRecordForImage.id)); } catch (e) {} }
              break;
            }
            if (blobRecordForImage && blobRecordForImage.id != null) {
              var blobIdForImage = Number(blobRecordForImage.id);
              sideCallCostForRun += imageGenCostForRun;
              var imgMsgPersisted = await repoForRun.createMessage(chatId, { role: 'assistant', content: '', md: '![Generated image](__blob:' + blobIdForImage + '__)' }, { touchChat: false });
              if (imgMsgPersisted) messagesForRun.push(imgMsgPersisted);
              hasAppendedRenderableAssistantMessageForRun = true;
              emitForAgentRun('stream_message_persisted', chatId, null);
            }
          } catch (e) {}
        }
        if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }

        // Persist generated document blobs + display messages.
        for (var gdi = 0; gdi < toolCallsForLoop.length; gdi++) {
          if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }
          var tcNameForDoc = toolCallsForLoop[gdi].function && toolCallsForLoop[gdi].function.name;
          var toolResultForDoc = toolResultsForRun[gdi];
          if (!toolResultForDoc || !toolResultForDoc.ok) continue;
          var docPayloadForRun = tcNameForDoc === 'create_document' ? toolResultForDoc : (tcNameForDoc === 'eval' ? toolResultForDoc._generatedDocument : null);
          if (!docPayloadForRun || typeof docPayloadForRun.dataUrl !== 'string' || docPayloadForRun.dataUrl.indexOf('data:') !== 0) continue;
          if (typeof repoForRun.createAttachmentBlob !== 'function') continue;
          try {
            var filenameForDoc = String(docPayloadForRun.filename || 'generated-document');
            var blobRecordForDoc = await repoForRun.createAttachmentBlob({ name: filenameForDoc, kind: 'generated_document', mimeType: String(docPayloadForRun.mimeType || ''), dataUrl: docPayloadForRun.dataUrl, size: Number(docPayloadForRun.size) || docPayloadForRun.dataUrl.length, textContent: '' });
            if (controllerForRun.signal.aborted) {
              markRunStoppedForRun();
              if (blobRecordForDoc && blobRecordForDoc.id != null && typeof repoForRun.deleteAttachmentBlob === 'function') { try { await repoForRun.deleteAttachmentBlob(Number(blobRecordForDoc.id)); } catch (e) {} }
              break;
            }
            if (blobRecordForDoc && blobRecordForDoc.id != null) {
              var blobIdForDoc = Number(blobRecordForDoc.id);
              var docMsgPersisted = await repoForRun.createMessage(chatId, { role: 'assistant', content: '', md: '[' + filenameForDoc.replace(/[\[\]]/g, '') + '](#abchat-docblob-' + blobIdForDoc + ')' }, { touchChat: false });
              if (docMsgPersisted) messagesForRun.push(docMsgPersisted);
              hasAppendedRenderableAssistantMessageForRun = true;
              emitForAgentRun('stream_message_persisted', chatId, null);
            }
          } catch (e) {}
        }
        if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }

        var allToolsFailedForRun = toolResultsForRun.every(function (r) { return !r || r.ok === false || (typeof r === 'object' && typeof r.error === 'string'); });
        var roundSignatureForRun = computeToolRoundSignatureForAgentRun(toolCallsForLoop);
        if (allToolsFailedForRun) {
          consecutiveEmptyItersForRun++;
          if (roundSignatureForRun && roundSignatureForRun === lastFailingRoundSignatureForRun) {
            identicalFailingRoundCountForRun++;
          } else {
            identicalFailingRoundCountForRun = 1;
            lastFailingRoundSignatureForRun = roundSignatureForRun;
          }
        } else {
          consecutiveEmptyItersForRun = 0;
          identicalFailingRoundCountForRun = 0;
          lastFailingRoundSignatureForRun = null;
          hadSuccessfulToolCallForRun = true;
        }
        if (identicalFailingRoundCountForRun >= MAX_IDENTICAL_FAILING_ROUNDS_FOR_AGENT_RUN) {
          emitForAgentRun('stream_system_notice', chatId, { text: 'Agent stopped: the same tool call failed ' + identicalFailingRoundCountForRun + ' times in a row with identical arguments. Retrying without changing the call will not help; review the error above and try a different approach.' });
          break;
        }
        if (consecutiveEmptyItersForRun >= MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN) {
          emitForAgentRun('stream_system_notice', chatId, { text: 'Agent stopped: ' + MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN + ' consecutive rounds of tool calls all returned errors. Review the results above and try a different approach.' });
          break;
        }

        // Tell every tab's panel which data stores this round mutated so their sidebars
        // refresh live. The legacy in-panel loop called scheduleStoreRefresh directly; the
        // offscreen loop signals via a stream event instead.
        var mutatedStoresForRound = {};
        for (var msi = 0; msi < toolCallsForLoop.length; msi++) {
          var tcNameForMutate = toolCallsForLoop[msi].function && toolCallsForLoop[msi].function.name;
          var tcResultForMutate = toolResultsForRun[msi];
          if (!tcResultForMutate || tcResultForMutate.ok !== true) continue;
          if (tcNameForMutate === 'write' || tcNameForMutate === 'edit') {
            if (tcResultForMutate.type === 'note') mutatedStoresForRound.notes = true;
            else if (tcResultForMutate.type === 'task') mutatedStoresForRound.tasks = true;
            else if (tcResultForMutate.type === 'question') mutatedStoresForRound.questions = true;
          } else if (tcNameForMutate === 'generate_questions') {
            mutatedStoresForRound.questions = true;
          }
        }
        var mutatedStoreNamesForRound = Object.keys(mutatedStoresForRound);
        if (mutatedStoreNamesForRound.length > 0) {
          emitForAgentRun('stream_stores_mutated', chatId, { stores: mutatedStoreNamesForRound });
        }

        // Side-call costs (web_search/web_fetch/image gen) accrue during tool execution, so
        // re-emit the counter after the tool round to reflect them.
        emitUsageDisplayForRun();

        runStateForRun.toolsDoneAt = Date.now();
      }

      // Update chat summary/metadata after the loop.
      if (typeof repoForRun.updateChat === 'function') {
        try {
          await repoForRun.updateChat(chatId, {
            summary: chatSummaryFromMessagesForRun(messagesForRun),
            updatedAt: new Date().toISOString(),
            lastModel: model
          });
        } catch (chatSyncErrForRun) {}
      }
    } catch (sendErrForRun) {
      if (sendErrForRun && sendErrForRun.name === 'AbortError') {
        markRunStoppedForRun();
      } else {
        logStatusForRun = 'error';
        logErrorMsgForRun = sendErrForRun ? (sendErrForRun.message || 'Unknown error') : 'Unknown error';
        var rawErrMsgForRun = (sendErrForRun && sendErrForRun.message) ? sendErrForRun.message : 'An error occurred.';
        var friendlyErrForRun;
        if (sendErrForRun && sendErrForRun.isCreditsError) {
          friendlyErrForRun = rawErrMsgForRun;
        } else {
          var rawErrLowerForRun = rawErrMsgForRun.toLowerCase();
          var isNetworkErrForRun = rawErrLowerForRun.indexOf('failed to fetch') !== -1 ||
            rawErrLowerForRun.indexOf('networkerror') !== -1 ||
            rawErrLowerForRun.indexOf('network error') !== -1 ||
            rawErrLowerForRun.indexOf('load failed') !== -1;
          friendlyErrForRun = isNetworkErrForRun
            ? (navigator.onLine ? 'Request failed. The server may be temporarily unreachable.' : 'No internet connection.')
            : rawErrMsgForRun;
        }
        emitForAgentRun('stream_system_notice', chatId, { text: 'Error: ' + friendlyErrForRun });
      }
    } finally {
      if (cdpRunLeaseHeldForRun && cdpClientForRun && typeof cdpClientForRun.release === 'function') {
        try { cdpClientForRun.release(targetTabIdForRun, true); } catch (eRelForRun) {}
        cdpRunLeaseHeldForRun = false;
      }
      if (controllerForRun.signal.aborted && !logStopReasonForRun) {
        markRunStoppedForRun();
      }
      var agentRunStopFinallyForRun = (globalThis.ABChatShared || {}).agentRunStop;
      if (logStopReasonForRun && logStatusForRun !== 'error') {
        logStatusForRun = agentRunStopFinallyForRun && typeof agentRunStopFinallyForRun.logStatusFromStopReason === 'function'
          ? agentRunStopFinallyForRun.logStatusFromStopReason(logStopReasonForRun, logStatusForRun)
          : 'cancelled';
      }
      if (logStopReasonForRun) {
        var stopNoticeTextForRun = buildTimeoutNoticeForRun(logStopReasonForRun, lastToolTimeoutMsForRun);
        if (stopNoticeTextForRun) {
          try {
            var stopNoticeRecordForRun = await repoForRun.createMessage(chatId, {
              role: 'assistant',
              content: stopNoticeTextForRun,
              md: stopNoticeTextForRun,
              systemNotice: true
            }, { touchChat: false });
            if (stopNoticeRecordForRun) messagesForRun.push(stopNoticeRecordForRun);
          } catch (eStopNoticeForRun) {}
        }
      }
      var apiLoggerForRun = getApiLoggerForAgentRun();
      if (apiLoggerForRun && typeof apiLoggerForRun.writeLog === 'function') {
        apiLoggerForRun.writeLog({
          requestType: 'chat',
          timestamp: new Date(logStartTimeForRun).toISOString(),
          chatId: chatId,
          model: logResolvedModelForRun || model,
          iterationCount: iterCount,
          totalLatencyMs: Date.now() - logStartTimeForRun,
          status: logStatusForRun,
          stopReason: logStopReasonForRun || undefined,
          toolTimeoutMs: logStopReasonForRun === 'tool' ? lastToolTimeoutMsForRun : undefined,
          errorMessage: logErrorMsgForRun,
          requestMessages: logFirstMessagesForRun,
          apiParams: logApiParamsForRun,
          responseContent: logFinalResponseForRun,
          toolCalls: logAllToolCallsForRun,
          turns: logTurnsForRun,
          hookFirings: turnHookFiringsByIterForRun,
          usage: logUsageForRun
        }).catch(function () {});
      }
      if (!hasAppendedRenderableAssistantMessageForRun && !logStopReasonForRun) {
        var fallbackTextForRun = hadSuccessfulToolCallForRun
          ? AGENT_NEUTRAL_COMPLETION_FOR_AGENT_RUN
          : AGENT_FALLBACK_RESPONSES_FOR_AGENT_RUN[Math.floor(Math.random() * AGENT_FALLBACK_RESPONSES_FOR_AGENT_RUN.length)];
        try { await repoForRun.createMessage(chatId, { role: 'assistant', content: fallbackTextForRun, md: fallbackTextForRun }); } catch (fallbackErrForRun) {}
      }
      flushStreamTextForAgentRun(chatId);
      emitForAgentRun('stream_end', chatId, null);
      clearTimeout(turnTotalTimeoutIdForRun);
      runsForAgentRun.delete(chatId);
    }
  }

  function cancelRunForAgentRun(chatIdForCancel) {
    var runForCancel = runsForAgentRun.get(Number(chatIdForCancel));
    if (runForCancel && runForCancel.controller) {
      runForCancel.userStopRequested = true;
      try { runForCancel.controller.abort(); } catch (eForCancel) {}
    }
  }

  chrome.runtime.onMessage.addListener(function (msgForAgentRun, senderForAgentRun, sendResponseForAgentRun) {
    if (!msgForAgentRun || !msgForAgentRun.action) return;
    if (msgForAgentRun.action === 'agentRunStart' && msgForAgentRun.params) {
      // Acknowledge so the service worker knows the offscreen listener is live and the run
      // was received. The SW retries agentRunStart until it gets this ack, covering the
      // window right after the offscreen document is created when scripts are still loading.
      sendChatForOffscreen(msgForAgentRun.params);
      try { sendResponseForAgentRun({ ok: true }); } catch (eAckForAgentRun) {}
      return false;
    }
    if (msgForAgentRun.action === 'offscreenCancelRequest') {
      cancelRunForAgentRun(msgForAgentRun.chatId);
      return false;
    }
  });

  nsForAgentRun.ready = true;
  nsForAgentRun.activeRunCount = function () { return runsForAgentRun.size; };
  globalScopeForAgentRun.ABChatOffscreen = nsForAgentRun;
})();
