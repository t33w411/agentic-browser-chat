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
// the API log, and the CDP run lease. The page tools (page_observe, page_read, page_act,
// page_spreadsheet) are delegated to the target tab's content script, which reads the live
// DOM directly and, for trusted input, reaches the page through cdpClient (bound to the tab id).
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
  var SOFT_ITERATION_CHECKPOINT_FOR_AGENT_RUN = 20;
  var ITERATION_EXTENSION_SIZE_FOR_AGENT_RUN = 20;
  var ABSOLUTE_MAX_ITERATIONS_FOR_AGENT_RUN = 60;
  var PROGRESS_WINDOW_ROUNDS_FOR_AGENT_RUN = 5;
  var MIN_PROGRESS_ROUNDS_FOR_EXTENSION_FOR_AGENT_RUN = 2;
  var MAX_IDENTICAL_TOOL_ROUNDS_FOR_AGENT_RUN = 4;
  var MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN = 8;
  var MAX_IDENTICAL_FAILING_ROUNDS_FOR_AGENT_RUN = 3;
  var MAX_IDENTICAL_ERROR_ROUNDS_FOR_AGENT_RUN = 4;
  var IDENTICAL_ERROR_HINT_ROUND_FOR_AGENT_RUN = 2;
  var IDENTICAL_ERROR_DECAY_ROUNDS_FOR_AGENT_RUN = 2;
  var IDENTICAL_ERROR_TEXT_MAX_CHARS_FOR_AGENT_RUN = 300;
  var MAX_STREAM_RETRIES_FOR_AGENT_RUN = 3;
  var MAX_CONCURRENT_RUNS_FOR_AGENT_RUN = 3;
  var MIN_TOOL_DISPLAY_MS_FOR_AGENT_RUN = 1500;
  var TOOL_RESULT_API_MAX_CHARS_FOR_AGENT_RUN = 512000;
  var ERROR_NOTICE_MAX_CHARS_FOR_AGENT_RUN = 500;

  var AGENT_NEUTRAL_COMPLETION_FOR_AGENT_RUN = 'I took some actions. Let me know if it looks right or needs more.';
  var AGENT_FALLBACK_RESPONSES_FOR_AGENT_RUN = [
    'Sorry, something went wrong. Please let me know if I should try again.',
    'I wasn\'t able to complete that. Feel free to ask me to try again.',
    'Something didn\'t go as expected. Let me know if you\'d like me to retry.',
    'I ran into an issue and couldn\'t respond. Please try again if you\'d like.',
    'Apologies, I couldn\'t finish my response. Let me know if you want me to give it another go.',
    'I hit a snag and couldn\'t send a reply. Let me know if you\'d like me to try again.'
  ];

  // Tools whose successful execution is a real state change (a create/edit, a generated artifact,
  // or a page mutation), as opposed to a read. A successful mutating call is what makes the neutral
  // "I took some actions" completion truthful; a turn where only reads succeeded, or where every
  // mutation failed, must not claim action was taken. memory always writes; skill mutates only
  // for specific operations.
  var MUTATING_TOOL_NAMES_FOR_AGENT_RUN = {
    write: true, edit: true, create_document: true, generate_image: true,
    generate_questions: true, page_act: true, memory: true, page_spreadsheet: true
  };
  function isMutatingToolCallForAgentRun(nameForMutCheck, parsedArgsForMutCheck) {
    if (MUTATING_TOOL_NAMES_FOR_AGENT_RUN[nameForMutCheck]) return true;
    var argsForMutCheck = parsedArgsForMutCheck || {};
    if (nameForMutCheck === 'skill') {
      var opForMutCheck = String(argsForMutCheck.operation || '');
      return opForMutCheck === 'create' || opForMutCheck === 'update' || opForMutCheck === 'delete';
    }
    return false;
  }

  // Appended when the assembled request would otherwise end on an assistant message. Google AI
  // Studio rejects those outright ("Requests ending with a model turn are not supported."), while
  // OpenAI- and Anthropic-backed models silently treat them as a prefill, so the same message list
  // works on one provider and 400s on another.
  var CONTINUATION_TURN_TEXT_FOR_AGENT_RUN = 'Continue.';

  // Enforced immediately before every completion call. Anything the loop appends after a tool
  // result (a display-only artifact message, a canned notice, a salvaged partial) can leave a
  // model turn last; ending on a user turn is accepted by every provider. Only a trailing
  // assistant message WITHOUT tool_calls is patched: an assistant message carrying tool_calls must
  // be answered by tool messages, and appending a user turn there would break a different rule.
  function ensureRequestDoesNotEndWithModelTurnForAgentRun(messagesForGuard) {
    if (!Array.isArray(messagesForGuard) || messagesForGuard.length === 0) return messagesForGuard;
    var lastForGuard = messagesForGuard[messagesForGuard.length - 1];
    if (!lastForGuard || lastForGuard.role !== 'assistant') return messagesForGuard;
    if (Array.isArray(lastForGuard.tool_calls) && lastForGuard.tool_calls.length > 0) return messagesForGuard;
    messagesForGuard.push({ role: 'user', content: CONTINUATION_TURN_TEXT_FOR_AGENT_RUN });
    return messagesForGuard;
  }

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

  function delegatePageToolForAgentRun(toolForDelegate, argsForDelegate, chatIdForDelegate, identityForDelegate) {
    return new Promise(function (resolveForDelegate) {
      try {
        // The SW resolves the target tab from an in-memory map that an MV3 recycle can wipe
        // mid-run. Carry the authoritative targetTabId (held in the run state) so the SW can
        // re-seed that map instead of failing every page tool with "No target tab".
        var runForDelegate = runsForAgentRun.get(Number(chatIdForDelegate));
        var targetTabIdForDelegate = runForDelegate && typeof runForDelegate.targetTabId === 'number'
          ? runForDelegate.targetTabId
          : null;
        // Run/tool-call identity for page-action telemetry, carried to the content script that
        // executes the tool so its record joins back to the LLM turn. Absent for the screenshot
        // capture delegation, which is not a logged page mutator.
        var idForDelegate = identityForDelegate || {};
        chrome.runtime.sendMessage({
          action: 'delegatePageTool',
          tool: toolForDelegate,
          args: argsForDelegate || {},
          chatId: Number(chatIdForDelegate),
          targetTabId: targetTabIdForDelegate,
          runId: idForDelegate.runId != null ? idForDelegate.runId : (runForDelegate && runForDelegate.runId) || null,
          toolCallId: idForDelegate.toolCallId != null ? idForDelegate.toolCallId : null,
          iteration: idForDelegate.iteration != null ? idForDelegate.iteration : null
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

  // The page tools all run in the target tab's content script, where `document` is the live
  // page: that is what makes the ref snapshot, the panel click-through occlusion, the
  // elementFromPoint target probe, the mutation/URL/title observation, and the focus readback
  // work. Run from the offscreen document they would target the empty offscreen DOM instead,
  // so the panel would silently occlude clicks and the observability fields would be meaningless.
  var PAGE_DELEGATED_TOOLS_FOR_AGENT_RUN = {
    page_observe: true, page_act: true, page_read: true, page_spreadsheet: true
  };

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

  // Is this tool result a failure? Single definition, shared by the all-failed check, the
  // mutating-progress scan, and the error signature, so those three cannot disagree about what
  // counts as an error.
  function isFailedToolResultForAgentRun(resultForFail) {
    return !resultForFail || resultForFail.ok === false
      || (typeof resultForFail === 'object' && typeof resultForFail.error === 'string');
  }

  // Order-independent signature of the ERRORS a round produced (tool name + error text), plus
  // the distinct error texts for the corrective note. This catches the degenerate loop the
  // argument signature above misses: a model that keeps hitting the same rejection while
  // varying the values it sends, so no two rounds are ever byte-identical. Error text is the
  // stable part of a failed result (a snapshot or ids around it change every call), so it is
  // the only part signed.
  function computeToolErrorSignatureForAgentRun(toolCalls, toolResults) {
    var partsForErrSig = [];
    var textsForErrSig = [];
    for (var iForErrSig = 0; iForErrSig < toolCalls.length; iForErrSig++) {
      var resultForErrSig = toolResults[iForErrSig];
      if (!isFailedToolResultForAgentRun(resultForErrSig)) continue;
      var fnForErrSig = toolCalls[iForErrSig] && toolCalls[iForErrSig].function
        ? toolCalls[iForErrSig].function : {};
      var nameForErrSig = fnForErrSig.name || '';
      var errorForErrSig = resultForErrSig && typeof resultForErrSig.error === 'string'
        ? resultForErrSig.error : '(no error text)';
      if (errorForErrSig.length > IDENTICAL_ERROR_TEXT_MAX_CHARS_FOR_AGENT_RUN) {
        errorForErrSig = errorForErrSig.slice(0, IDENTICAL_ERROR_TEXT_MAX_CHARS_FOR_AGENT_RUN);
      }
      partsForErrSig.push(nameForErrSig + '\x00' + errorForErrSig);
      var labelForErrSig = (nameForErrSig ? nameForErrSig + ': ' : '') + errorForErrSig;
      if (textsForErrSig.indexOf(labelForErrSig) === -1) textsForErrSig.push(labelForErrSig);
    }
    partsForErrSig.sort();
    return { signature: partsForErrSig.join('\x01'), texts: textsForErrSig };
  }

  // Rebind the run's active target tab to newTargetTabId, releasing any CDP lease held on the
  // previous target so the next trusted page_act re-acquires it on the new tab. Called after a
  // successful switch_tab / create_tab(active) / close_tab(of the current target).
  function applyTabRebindForAgentRun(runStateForRebind, newTargetTabId) {
    if (!runStateForRebind) return;
    if (typeof newTargetTabId !== 'number' || !isFinite(newTargetTabId)) return;
    if (runStateForRebind.targetTabId === newTargetTabId) return;
    if (runStateForRebind.cdpLeaseHeld && runStateForRebind.cdpClient && typeof runStateForRebind.cdpClient.release === 'function') {
      try { runStateForRebind.cdpClient.release(runStateForRebind.targetTabId, true); } catch (eRelForRebind) { /* old tab may be gone */ }
      runStateForRebind.cdpLeaseHeld = false;
    }
    runStateForRebind.targetTabId = newTargetTabId;
  }

  async function executeToolForAgentRun(nameForExec, argsForExec, contextForExec) {
    if (PAGE_DELEGATED_TOOLS_FOR_AGENT_RUN[nameForExec]) {
      return delegatePageToolForAgentRun(nameForExec, argsForExec, contextForExec.chatId, {
        runId: contextForExec.runId,
        toolCallId: contextForExec.toolCallId,
        iteration: contextForExec.iteration
      });
    }
    var executeToolLocalForAgentRun = getAgentNsForAgentRun().executeTool;
    if (typeof executeToolLocalForAgentRun !== 'function') {
      return { ok: false, error: 'Tool executor not available.' };
    }
    var resultForExec = await executeToolLocalForAgentRun(nameForExec, argsForExec, contextForExec);

    // Cross-tab tools change the run's active target tab. The chrome.tabs.* mutation already
    // happened in the SW (via toolExec); mirror it onto the run state + CDP lease so the page
    // tools and lease follow the new tab. Only on success.
    if (resultForExec && resultForExec.ok === true
        && (nameForExec === 'switch_tab' || nameForExec === 'create_tab' || nameForExec === 'close_tab')) {
      var runStateForRebind = runsForAgentRun.get(Number(contextForExec && contextForExec.chatId)) || null;
      if (runStateForRebind) {
        if (nameForExec === 'switch_tab') {
          applyTabRebindForAgentRun(runStateForRebind, Number(argsForExec && argsForExec.tab_id));
        } else if (nameForExec === 'create_tab') {
          if (resultForExec.active !== false && resultForExec.tab && typeof resultForExec.tab.id === 'number') {
            applyTabRebindForAgentRun(runStateForRebind, resultForExec.tab.id);
          }
        } else if (nameForExec === 'close_tab') {
          // Closing the tab we are currently acting on reverts the target to the initiator.
          if (Number(argsForExec && argsForExec.tab_id) === runStateForRebind.targetTabId
              && typeof runStateForRebind.initiatorTabId === 'number') {
            applyTabRebindForAgentRun(runStateForRebind, runStateForRebind.initiatorTabId);
          }
        }
      }
    }
    return resultForExec;
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
    var aboutUserForRun = String(paramsForRun.aboutUser || '');
    var agentRulesForRun = String(paramsForRun.agentRules || '');
    var targetTabIdForRun = (typeof paramsForRun.targetTabId === 'number') ? paramsForRun.targetTabId : null;
    var initiatorTabIdForRun = (typeof paramsForRun.initiatorTabId === 'number') ? paramsForRun.initiatorTabId : targetTabIdForRun;
    var visualPreflightSessionIdForRun = String(paramsForRun.visualPreflightSessionId || ('vp_' + Date.now().toString(36)));
    var userTextForRun = String(paramsForRun.userText || '');
    var contextWindowForRun = Number(paramsForRun.contextWindow) || null;
    var pricingForRun = paramsForRun.pricing || {};
    var completionCostPerMillionForRun = Number(pricingForRun.completionCostPerMillion) || 0;
    var imageGenCostForRun = Number(pricingForRun.imageGenCost) || 0;

    if (!apiKey || !model) { refuseRunForOffscreen('Could not start the agent run: missing API key or model.'); return; }

    var repoForRun = getRepoForAgentRun();
    if (!repoForRun || typeof repoForRun.getChat !== 'function' || typeof repoForRun.createMessage !== 'function') { refuseRunForOffscreen('Could not start the agent run: storage is unavailable. Please try again.'); return; }

    var agentNsForRun = getAgentNsForAgentRun();
    var costFromUsageForRun = typeof agentNsForRun.costFromUsage === 'function' ? agentNsForRun.costFromUsage : null;
    var clientForRun = agentNsForRun.client || {};
    var contextBuilderForRun = agentNsForRun.contextBuilder || {};
    var compactorForRun = agentNsForRun.compactor || null;
    var cdpClientForRun = agentNsForRun.cdpClient || null;
    if (typeof clientForRun.streamCompletion !== 'function') { refuseRunForOffscreen('Could not start the agent run: the agent is not ready. Please try again.'); return; }

    var controllerForRun = new AbortController();
    // targetTabId is mutable: switch_tab / create_tab / close_tab rebind it mid-run (see
    // applyTabRebindForAgentRun). initiatorTabId is fixed (the panel that started the run) and
    // is the fallback target when the agent closes the tab it is currently acting on. The CDP
    // lease is tracked here (not as a closure local) so the rebind can release it on the old
    // tab; the next trusted page_act re-acquires it on the new target.
    // Stable per-run identifier. Threaded to the content script on every delegated page tool so a
    // page-action telemetry record can be joined back to the LLM turn that caused it (chatId alone
    // cannot disambiguate parallel tool calls or a retried action). Also stamped on API log records
    // so the two stores share a join key.
    var runIdForRun = chatId + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    var runStateForRun = { runId: runIdForRun, controller: controllerForRun, toolsDoneAt: 0, textDebounceTimer: null, userStopRequested: false, pendingText: null, targetTabId: targetTabIdForRun, initiatorTabId: initiatorTabIdForRun, cdpClient: cdpClientForRun, cdpLeaseHeld: false };
    runsForAgentRun.set(chatId, runStateForRun);

    var timeoutReasonForRun = null;
    var turnTotalTimeoutIdForRun = setTimeout(function () {
      if (!timeoutReasonForRun) timeoutReasonForRun = 'total';
      controllerForRun.abort();
    }, TURN_TOTAL_TIMEOUT_MS_FOR_AGENT_RUN);

    function buildTimeoutNoticeForRun(reasonForNotice, toolTimeoutMsForNotice, stopLimitForNotice) {
      var agentRunStopForNotice = (globalThis.ABChatShared || {}).agentRunStop;
      if (agentRunStopForNotice && typeof agentRunStopForNotice.buildNotice === 'function') {
        return agentRunStopForNotice.buildNotice(reasonForNotice, toolTimeoutMsForNotice, stopLimitForNotice);
      }
      return '';
    }

    // A notice that explains why a run ended (a provider error, a failure cap, a blocked hook)
    // must survive the end of the stream. The stream_system_notice event only appends a DOM node,
    // and the stream_end handler re-renders the chat from the database, so an emit-only notice is
    // painted over milliseconds after it appears and the run looks like it simply stopped.
    // Persisting it as a systemNotice message keeps it in the timeline; contextBuilder skips
    // systemNotice messages, so it never re-enters the model's context.
    async function emitAndPersistSystemNoticeForRun(noticeTextForRun) {
      var trimmedNoticeForRun = String(noticeTextForRun || '').trim();
      if (!trimmedNoticeForRun) return;
      emitForAgentRun('stream_system_notice', chatId, { text: trimmedNoticeForRun });
      try {
        var noticeRecordForRun = await repoForRun.createMessage(chatId, {
          role: 'assistant',
          content: trimmedNoticeForRun,
          md: trimmedNoticeForRun,
          systemNotice: true
        }, { touchChat: false });
        if (noticeRecordForRun) messagesForRun.push(noticeRecordForRun);
        persistedSystemNoticeCountForRun++;
      } catch (noticePersistErrForRun) { /* the emitted notice is still on screen for this tab */ }
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
    var currentIterationLimitForRun = SOFT_ITERATION_CHECKPOINT_FOR_AGENT_RUN;
    var extensionCountForRun = 0;
    var recentProgressRoundsForRun = [];
    var lastToolRoundSignatureForRun = null;
    var identicalToolRoundCountForRun = 0;
    var consecutiveEmptyItersForRun = 0;
    var identicalFailingRoundCountForRun = 0;
    var lastFailingRoundSignatureForRun = null;
    var lastToolErrorSignatureForRun = null;
    var identicalErrorRoundCountForRun = 0;
    var errorFreeRoundsSinceErrorForRun = 0;
    var sideCallCostForRun = 0;
    var turnMainCostAccumForRun = 0;
    var prevTurnMainCostForRun = 0;
    var preSendCostForRun = 0;

    // Push the live session token/cost counter to the panel once per turn. The receiver
    // updates only when this chat is active.
    function emitUsageDisplayForRun() {
      emitForAgentRun('stream_usage', chatId, {
        usage: logUsageForRun,
        cumulativeCost: preSendCostForRun + turnMainCostAccumForRun + sideCallCostForRun
      });
    }
    var accumulatedSearchSourcesForRun = [];
    var seenSearchUrlsForRun = new Set();
    // Generated images actually shown to the user in this send, counted in the display phase after
    // the blob persists rather than on API success, so a generation whose blob store failed never
    // makes the next result claim an earlier image is on screen. A non-zero count tells the model
    // its new image is an addition, not a replacement, and that it owes the user an explanation.
    var imagesShownToUserCountForRun = 0;

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
    var logStopLimitForRun = null;
    var stopNoticeAlreadyPersistedForRun = false;
    var lastToolTimeoutMsForRun = ITER_TOOL_STD_TIMEOUT_MS_FOR_AGENT_RUN;
    var hasAppendedRenderableAssistantMessageForRun = false;
    var persistedSystemNoticeCountForRun = 0;
    // Set true once any tool call this turn returned a non-error result (reads included); only used
    // to suppress the alarming "empty response" note.
    var hadSuccessfulToolCallForRun = false;
    // Set true once a MUTATING tool call (a create/edit, generated artifact, or page mutation)
    // succeeded this turn. Drives the empty-final-turn recovery: only when real action landed do we
    // retry for a confirmation or show the neutral "I took some actions" completion; a read-only or
    // all-failed turn gets the apologetic fallback so we never imply changes that did not happen.
    var hadSuccessfulMutatingToolCallForRun = false;
    var didRetryEmptyFinalTurnForRun = false;

    // In-memory copy of the chat's messages, seeded from the DB (the initiator already
    // persisted the user message before starting this run). contextBuilder reads this on
    // each iteration; we push every message we persist back onto it.
    var messagesForRun = [];
    var compactionSummaryForRun = '';
    var compactedThroughMessageIdForRun = null;

    // Every tool is advertised on every run. The trusted page tools (page_act, page_spreadsheet)
    // are no longer hidden when advanced automation is off; the first trusted action prompts the
    // user inline and the same action continues once approved. The model's cost tier trims verbose
    // tool descriptions (and the system prompt) for expensive/extreme models.
    var costCategoryForRun = (contextBuilderForRun && typeof contextBuilderForRun.costCategoryFor === 'function')
      ? contextBuilderForRun.costCategoryFor(completionCostPerMillionForRun)
      : 'cheap';
    var toolDefsForRun = (agentNsForRun && typeof agentNsForRun.resolveAgentConfig === 'function')
      ? agentNsForRun.resolveAgentConfig({ costCategory: costCategoryForRun, agentProfile: 'main' }).toolDefs
      : (agentNsForRun.toolDefs || []).slice();

    try {
      var chatRecordForRun = await repoForRun.getChat(chatId);
      messagesForRun = (chatRecordForRun && Array.isArray(chatRecordForRun.messages)) ? chatRecordForRun.messages : [];
      compactionSummaryForRun = (chatRecordForRun && typeof chatRecordForRun.compactionSummary === 'string') ? chatRecordForRun.compactionSummary : '';
      compactedThroughMessageIdForRun = (chatRecordForRun && chatRecordForRun.compactedThroughMessageId != null) ? chatRecordForRun.compactedThroughMessageId : null;

      // Cost already persisted on this chat before this run, for the live token/cost counter.
      // Mirrors the panel's sumPersistedChatCost baseline used by the stream_usage display.
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
              aboutUser: aboutUserForRun,
              agentRules: agentRulesForRun,
              automationEnabled: automationEnabledForRun,
              pageNavigationAllowed: true,
              costCategory: costCategoryForRun
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
            if (compactionResultForRun.summarizerUsage && costFromUsageForRun) {
              sideCallCostForRun += costFromUsageForRun(compactionResultForRun.summarizerUsage);
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
          await emitAndPersistSystemNoticeForRun(userPromptResultForRun.block.reason);
        }
      }

      emitForAgentRun('stream_start', chatId, null);

      while (!userPromptBlockedForRun) {
        if (iterCount >= currentIterationLimitForRun) {
          var progressRoundCountForExtension = recentProgressRoundsForRun.filter(Boolean).length;
          var canExtendForRun = currentIterationLimitForRun < ABSOLUTE_MAX_ITERATIONS_FOR_AGENT_RUN
            && progressRoundCountForExtension >= MIN_PROGRESS_ROUNDS_FOR_EXTENSION_FOR_AGENT_RUN
            && identicalToolRoundCountForRun < MAX_IDENTICAL_TOOL_ROUNDS_FOR_AGENT_RUN
            && consecutiveEmptyItersForRun < MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN;
          if (canExtendForRun) {
            currentIterationLimitForRun = Math.min(
              ABSOLUTE_MAX_ITERATIONS_FOR_AGENT_RUN,
              currentIterationLimitForRun + ITERATION_EXTENSION_SIZE_FOR_AGENT_RUN
            );
            extensionCountForRun++;
            pendingSystemNotesForRun.push(
              'You reached a bounded execution checkpoint, and recent tool calls show continued progress. '
              + 'Continue only the unfinished parts of the user\'s request. Do not repeat completed actions. '
              + 'You now have up to ' + currentIterationLimitForRun + ' total model steps for this run.'
            );
          } else {
            logStopReasonForRun = currentIterationLimitForRun >= ABSOLUTE_MAX_ITERATIONS_FOR_AGENT_RUN
              ? 'iteration-limit'
              : 'no-progress';
            logStopLimitForRun = currentIterationLimitForRun;
            break;
          }
        }
        iterCount++;
        var turnStartTimeForRun = Date.now();

        var memCtxForRun = await loadAgentMemoryContextForAgentRun(repoForRun);
        var apiMessages = contextBuilderForRun.build
          ? await contextBuilderForRun.build(messagesForRun, {
              aboutUser: aboutUserForRun,
              agentRules: agentRulesForRun,
              agentMemory: memCtxForRun.agentMemory,
              agentMemoryId: memCtxForRun.agentMemoryId,
              agentSkills: memCtxForRun.agentSkills,
              compactionSummary: compactionSummaryForRun,
              compactedThroughMessageId: compactedThroughMessageIdForRun,
              automationEnabled: automationEnabledForRun,
              pageNavigationAllowed: true,
              costCategory: costCategoryForRun
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
              if (aboutUserForRun) {
                msgsForFallbackForRun.unshift({ role: 'system', content: 'About the user:\n' + aboutUserForRun });
              }
              return msgsForFallbackForRun;
            }());

        if (pendingSystemNotesForRun.length > 0) {
          apiMessages.push({ role: 'system', content: pendingSystemNotesForRun.join('\n\n') });
          pendingSystemNotesForRun = [];
        }

        ensureRequestDoesNotEndWithModelTurnForAgentRun(apiMessages);

        if (turnContextForRun) turnContextForRun.iterIndex = iterCount - 1;

        if (iterCount === 1) {
          logFirstMessagesForRun = sanitizeMessagesForLogForAgentRun(apiMessages);
          logApiParamsForRun = {
            stream: true,
            tool_choice: toolDefsForRun.length > 0 ? 'auto' : undefined,
            parallel_tool_calls: toolDefsForRun.length > 0 ? false : undefined,
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
          // Push the counter as soon as usage arrives so an empty final turn — which breaks
          // below before the post-persist emit — still reflects its tokens.
          emitUsageDisplayForRun();
        }

        var assistantMsg = resultForLoop.message;
        if (!assistantMsg) break;
        var toolCallsForLoop = assistantMsg.tool_calls;
        var hasContent = assistantMsg.content && assistantMsg.content.trim().length > 0;
        var hasToolCalls = toolCallsForLoop && toolCallsForLoop.length > 0;

        if (!hasContent && !hasToolCalls) {
          // Gated on the mutating flag so the note only asserts "you have already completed the
          // requested actions" when a real action actually succeeded; a read-only or all-failed
          // turn must not be told it finished.
          if (hadSuccessfulMutatingToolCallForRun && !didRetryEmptyFinalTurnForRun) {
            didRetryEmptyFinalTurnForRun = true;
            pendingSystemNotesForRun.push('Your previous response was empty. You have already completed the requested actions. Briefly confirm to the user, in plain language, what you did.');
            continue;
          }
          if (!hadSuccessfulToolCallForRun) {
            await emitAndPersistSystemNoticeForRun('The model returned an empty response.');
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

        // At most one page_act / page_spreadsheet per assistant tool batch. Later page
        // mutators get a synthetic skip result; reads and non-page mutators are unaffected.
        var pageMutatorGateForRun = getAgentNsForAgentRun().pageMutatorBatchGate;
        var skippedPageMutatorIndicesForRun = (hasToolCalls
            && pageMutatorGateForRun
            && typeof pageMutatorGateForRun.getSkippedIndices === 'function')
          ? pageMutatorGateForRun.getSkippedIndices(toolCallsForLoop)
          : new Set();

        if (turnContextForRun && hasToolCalls) {
          for (var tcPushIdxForRun = 0; tcPushIdxForRun < toolCallsForLoop.length; tcPushIdxForRun++) {
            if (skippedPageMutatorIndicesForRun.has(tcPushIdxForRun)) continue;
            turnContextForRun.toolCallsThisTurn.push(toolCallsForLoop[tcPushIdxForRun]);
          }
        }

        var postModelResponseResultForRun = await dispatchHookForRun('PostModelResponse', {
          assistantMessage: assistantMsg, toolCalls: toolCallsForLoop || [], isFinalReply: !hasToolCalls, chatId: chatId
        });
        if (postModelResponseResultForRun && postModelResponseResultForRun.block) {
          var stopNoticeCountBeforeBlockForRun = persistedSystemNoticeCountForRun;
          if (postModelResponseResultForRun.block.code === 'tool-call-limit') {
            logStopReasonForRun = 'tool-call-limit';
            logStopLimitForRun = Number(postModelResponseResultForRun.block.limit) || null;
          }
          await emitAndPersistSystemNoticeForRun(postModelResponseResultForRun.block.reason);
          if (logStopReasonForRun === 'tool-call-limit') {
            stopNoticeAlreadyPersistedForRun = persistedSystemNoticeCountForRun > stopNoticeCountBeforeBlockForRun;
          }
          break;
        }
        if (postModelResponseResultForRun && postModelResponseResultForRun.continueWithSystemNote) continue;

        if (!hasToolCalls) {
          var stopResultForRun = await dispatchHookForRun('Stop', { assistantMessage: assistantMsg, toolCalls: [], isFinalReply: true, chatId: chatId });
          if (stopResultForRun && stopResultForRun.block) {
            await emitAndPersistSystemNoticeForRun(stopResultForRun.block.reason);
            break;
          }
          if (stopResultForRun && stopResultForRun.continueWithSystemNote) continue;
          if (assistantMsg.content) logFinalResponseForRun = assistantMsg.content;
          break;
        }

        emitForAgentRun('stream_tool_steps', chatId, { toolCalls: toolCallsForLoop });

        // Acquire the run-scoped CDP lease before the trusted page tools (page_act, page_spreadsheet).
        // The lease is acquired on the CURRENT target tab (which a mid-run switch_tab/create_tab
        // may have changed); the rebind released any lease on the previous tab, so this re-acquires.
        if (!runStateForRun.cdpLeaseHeld && automationEnabledForRun && cdpClientForRun && typeof cdpClientForRun.acquire === 'function'
            && toolCallsForLoop.some(function (tcForLease, idxForLease) {
              if (skippedPageMutatorIndicesForRun.has(idxForLease)) return false;
              var tcNameForLease = tcForLease.function && tcForLease.function.name;
              return tcNameForLease === 'page_act' || tcNameForLease === 'page_spreadsheet';
            })) {
          try {
            var runLeaseResForRun = await cdpClientForRun.acquire(runStateForRun.targetTabId);
            if (runLeaseResForRun && runLeaseResForRun.ok) {
              runStateForRun.cdpLeaseHeld = true;
              await delayForAgentRun(400, controllerForRun.signal);
            }
          } catch (eRunLeaseForRun) {}
        }

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
        var toolExecPromisesForRun = toolCallsForLoop.map(async function (tc, tcIdxForExec) {
          var tcNameForExec = tc.function ? tc.function.name : '';
          var rawToolArgsForExec = (tc.function && typeof tc.function.arguments === 'string') ? tc.function.arguments : '';
          var toolArgs = {};
          var toolArgsParseErrorForExec = null;
          if (rawToolArgsForExec.trim() !== '') {
            try { toolArgs = JSON.parse(rawToolArgsForExec); } catch (parseErrForExec) { toolArgsParseErrorForExec = parseErrForExec; }
          }
          logAllToolCallsForRun.push({
            name: tcNameForExec,
            args: toolArgsParseErrorForExec ? { _rawArguments: rawToolArgsForExec } : toolArgs
          });
          if (skippedPageMutatorIndicesForRun.has(tcIdxForExec)
              && pageMutatorGateForRun
              && typeof pageMutatorGateForRun.buildSkipResult === 'function') {
            return pageMutatorGateForRun.buildSkipResult();
          }
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
              runId: runIdForRun,
              toolCallId: tc.id,
              iteration: iterCount,
              tabId: runStateForRun.targetTabId,
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
            toolResultForModel = { ok: true, prompt: toolResult.prompt || '', aspect_ratio: toolResult.aspectRatio || '' };
            if (Number(toolResult.width) > 0 && Number(toolResult.height) > 0) {
              toolResultForModel.width = Number(toolResult.width);
              toolResultForModel.height = Number(toolResult.height);
            }
            if (imagesShownToUserCountForRun > 0) {
              toolResultForModel.note = 'You had already generated and shown the user '
                + imagesShownToUserCountForRun + ' image' + (imagesShownToUserCountForRun === 1 ? '' : 's')
                + ' earlier in this turn. Generating this one did NOT replace them: every image stays visible in the chat and each one was billed. Your reply must state that you regenerated the image, why, and which of the images shown is the final one.';
            }
          } else if (tcNameForResult === 'create_document' && toolResult && toolResult.ok && typeof toolResult.dataUrl === 'string') {
            toolResultForModel = { ok: true, format: toolResult.format || '', filename: toolResult.filename || '', mimeType: toolResult.mimeType || '', size: Number(toolResult.size) || 0, note: 'The generated document has been saved and displayed to the user.' };
          } else if (tcNameForResult === 'eval' && toolResult && toolResult.ok && toolResult._generatedDocument && typeof toolResult._generatedDocument.dataUrl === 'string') {
            toolResultForModel = { ok: true, result: toolResult.result, document: { format: toolResult._generatedDocument.format || '', filename: toolResult._generatedDocument.filename || '', mimeType: toolResult._generatedDocument.mimeType || '', size: Number(toolResult._generatedDocument.size) || 0, note: 'The generated document has been saved and displayed to the user.' } };
          }
          // Side-call cost from any secondary LLM usage on the tool result (usage.cost only).
          // Read from toolResult (not toolResultForModel): generators replace the model-facing
          // object and drop _usage. Then strip _usage before the model sees the result.
          if (toolResult && typeof toolResult === 'object' && toolResult._usage && costFromUsageForRun) {
            sideCallCostForRun += costFromUsageForRun(toolResult._usage);
          }
          if (toolResultForModel && typeof toolResultForModel === 'object' && '_usage' in toolResultForModel) {
            toolResultForModel = Object.assign({}, toolResultForModel);
            delete toolResultForModel._usage;
          }
          if (tcNameForResult === 'web_search' && toolResult && Array.isArray(toolResult.results)) {
            toolResult.results.forEach(function (r) {
              if (r && r.url && !seenSearchUrlsForRun.has(String(r.url))) {
                seenSearchUrlsForRun.add(String(r.url));
                accumulatedSearchSourcesForRun.push({ url: String(r.url), title: String(r.title || '') });
              }
            });
          }
          var toolResultStr = typeof toolResultForModel === 'string' ? toolResultForModel : JSON.stringify(toolResultForModel);
          var isToolErrorForRun = toolResult && typeof toolResult === 'object' && toolResult.error;
          var isPageMutatorSkipForRun = isToolErrorForRun && toolResult.skipped === true;
          var toolStepStatusForRun = isToolErrorForRun ? 'error' : 'success';
          var toolStepStatusTextForRun = isPageMutatorSkipForRun
            ? 'Skipped'
            : (isToolErrorForRun ? String(toolResult.error) : 'Done');
          emitForAgentRun('stream_tool_step_status', chatId, { toolCallId: tc.id, status: toolStepStatusForRun, statusText: toolStepStatusTextForRun });
          var toolResultStrForApi = toolResultStr.length > TOOL_RESULT_API_MAX_CHARS_FOR_AGENT_RUN
            ? JSON.stringify({ ok: false, error: 'Tool result too large to send (' + toolResultStr.length + ' bytes; max 500 KB). The tool produced too much output; try a more targeted request.' })
            : toolResultStr;
          var toolMsgPersisted = await repoForRun.createMessage(chatId, { role: 'tool', tool_call_id: tc.id, content: toolResultStrForApi, md: '' }, { touchChat: false });
          // Stamp result_ref (= message id) so the model can pass it to eval vars_from
          // instead of retyping the payload. Mirror the panel-loop stamp path.
          if (toolMsgPersisted && Number.isFinite(Number(toolMsgPersisted.id))) {
            var stampFnForRun = getAgentNsForAgentRun().stampToolResultRef;
            if (typeof stampFnForRun === 'function') {
              var stampedContentForRun = stampFnForRun(toolResultStrForApi, Number(toolMsgPersisted.id));
              if (stampedContentForRun && stampedContentForRun !== toolResultStrForApi) {
                toolMsgPersisted.content = stampedContentForRun;
                if (repoForRun && typeof repoForRun.updateMessage === 'function') {
                  try {
                    await repoForRun.updateMessage(toolMsgPersisted.id, { content: stampedContentForRun });
                  } catch (stampUpdateErrForRun) { /* best-effort; in-memory stamp still helps this turn */ }
                }
              }
            }
          }
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
              // Prefer OpenRouter usage.cost (already added via _usage above). Fall back to
              // catalog imageCost only when usage.cost was absent, to avoid double-counting.
              var countedImageUsageCostForRun = costFromUsageForRun ? costFromUsageForRun(toolResultForImage._usage) : 0;
              if (countedImageUsageCostForRun <= 0 && imageGenCostForRun > 0) {
                sideCallCostForRun += imageGenCostForRun;
              }
              var imgMsgPersisted = await repoForRun.createMessage(chatId, {
                role: 'assistant',
                content: '',
                md: '![Generated image](__blob:' + blobIdForImage + '__)',
                // Rendering-only: contextBuilder folds this marker into the generate_image tool
                // result rather than sending it as its own model turn.
                displayOnly: true,
                tool_call_id: toolCallsForLoop[gi].id
              }, { touchChat: false });
              if (imgMsgPersisted) {
                messagesForRun.push(imgMsgPersisted);
                imagesShownToUserCountForRun++;
              }
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
              var docMsgPersisted = await repoForRun.createMessage(chatId, {
                role: 'assistant',
                content: '',
                md: '[' + filenameForDoc.replace(/[\[\]]/g, '') + '](#abchat-docblob-' + blobIdForDoc + ')',
                // Rendering-only: contextBuilder folds this marker into the tool result that
                // generated the document rather than sending it as its own model turn.
                displayOnly: true,
                tool_call_id: toolCallsForLoop[gdi].id
              }, { touchChat: false });
              if (docMsgPersisted) messagesForRun.push(docMsgPersisted);
              hasAppendedRenderableAssistantMessageForRun = true;
              emitForAgentRun('stream_message_persisted', chatId, null);
            }
          } catch (e) {}
        }
        if (controllerForRun.signal.aborted) { markRunStoppedForRun(); break; }

        var allToolsFailedForRun = toolResultsForRun.every(function (r) { return isFailedToolResultForAgentRun(r); });
        var roundSignatureForRun = computeToolRoundSignatureForAgentRun(toolCallsForLoop);
        if (roundSignatureForRun && roundSignatureForRun === lastToolRoundSignatureForRun) {
          identicalToolRoundCountForRun++;
        } else {
          identicalToolRoundCountForRun = roundSignatureForRun ? 1 : 0;
          lastToolRoundSignatureForRun = roundSignatureForRun || null;
        }
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
        var roundHadSuccessfulMutatingToolCallForRun = false;
        for (var muIdxForRun = 0; muIdxForRun < toolCallsForLoop.length; muIdxForRun++) {
          var muResultForRun = toolResultsForRun[muIdxForRun];
          if (isFailedToolResultForAgentRun(muResultForRun)) continue;
          var muTcForRun = toolCallsForLoop[muIdxForRun];
          var muNameForRun = muTcForRun && muTcForRun.function && muTcForRun.function.name ? muTcForRun.function.name : '';
          var muParsedForRun = {};
          var muRawForRun = muTcForRun && muTcForRun.function && typeof muTcForRun.function.arguments === 'string' ? muTcForRun.function.arguments : '';
          if (muRawForRun.trim() !== '') { try { muParsedForRun = JSON.parse(muRawForRun); } catch (muParseErrForRun) { muParsedForRun = {}; } }
          if (isMutatingToolCallForAgentRun(muNameForRun, muParsedForRun)) {
            roundHadSuccessfulMutatingToolCallForRun = true;
            hadSuccessfulMutatingToolCallForRun = true;
            break;
          }
        }
        // Track repetition of the ERROR rather than of the arguments. A single error-free round
        // deliberately does NOT reset this: a model that alternates a successful read with the
        // same failing write (re-observing the page between every retry) would otherwise clear
        // the counter every other round and loop forever. The counter clears on a different
        // error, on real forward progress on the world (a successful mutating call), or once
        // enough consecutive clean rounds show the run genuinely moved on.
        var errorSignatureForRun = computeToolErrorSignatureForAgentRun(toolCallsForLoop, toolResultsForRun);
        if (errorSignatureForRun.signature) {
          errorFreeRoundsSinceErrorForRun = 0;
          if (errorSignatureForRun.signature === lastToolErrorSignatureForRun) {
            identicalErrorRoundCountForRun++;
          } else {
            identicalErrorRoundCountForRun = 1;
            lastToolErrorSignatureForRun = errorSignatureForRun.signature;
          }
          // One corrective nudge before the stop, because the usual cause is a call whose SHAPE
          // is wrong while the model keeps rewriting the values. Fired here, in the branch that
          // just incremented the counter, so an error-free round in between cannot repeat it.
          if (identicalErrorRoundCountForRun === IDENTICAL_ERROR_HINT_ROUND_FOR_AGENT_RUN
              && IDENTICAL_ERROR_HINT_ROUND_FOR_AGENT_RUN < MAX_IDENTICAL_ERROR_ROUNDS_FOR_AGENT_RUN) {
            pendingSystemNotesForRun.push(
              'The last ' + identicalErrorRoundCountForRun + ' rounds of tool calls returned the identical error:\n'
              + errorSignatureForRun.texts.join('\n') + '\n'
              + 'Changing the values you pass will not help if the call itself is malformed. Re-read that error '
              + 'text and the tool\'s parameter descriptions, then fix the STRUCTURE of the call (which parameters '
              + 'you include and which you omit) or switch to a different tool or approach. Do not send the same '
              + 'shape of call again. If you cannot resolve it, stop and tell the user what is blocking you.'
            );
          }
        } else {
          errorFreeRoundsSinceErrorForRun++;
          if (roundHadSuccessfulMutatingToolCallForRun
              || errorFreeRoundsSinceErrorForRun >= IDENTICAL_ERROR_DECAY_ROUNDS_FOR_AGENT_RUN) {
            identicalErrorRoundCountForRun = 0;
            lastToolErrorSignatureForRun = null;
          }
        }
        var roundMadeProgressForRun = !allToolsFailedForRun
          && identicalToolRoundCountForRun < MAX_IDENTICAL_TOOL_ROUNDS_FOR_AGENT_RUN
          && identicalErrorRoundCountForRun < IDENTICAL_ERROR_HINT_ROUND_FOR_AGENT_RUN;
        recentProgressRoundsForRun.push(roundMadeProgressForRun || roundHadSuccessfulMutatingToolCallForRun);
        if (recentProgressRoundsForRun.length > PROGRESS_WINDOW_ROUNDS_FOR_AGENT_RUN) {
          recentProgressRoundsForRun.shift();
        }
        if (identicalToolRoundCountForRun >= MAX_IDENTICAL_TOOL_ROUNDS_FOR_AGENT_RUN) {
          logStopReasonForRun = 'repeated-tools';
          logStopLimitForRun = identicalToolRoundCountForRun;
          var stopNoticeCountBeforeRepeatForRun = persistedSystemNoticeCountForRun;
          await emitAndPersistSystemNoticeForRun(
            'Agent stopped: the same tool calls were repeated ' + identicalToolRoundCountForRun
            + ' rounds in a row without a different step. Completed actions remain saved; review the latest result before continuing.'
          );
          stopNoticeAlreadyPersistedForRun = persistedSystemNoticeCountForRun > stopNoticeCountBeforeRepeatForRun;
          break;
        }
        if (identicalFailingRoundCountForRun >= MAX_IDENTICAL_FAILING_ROUNDS_FOR_AGENT_RUN) {
          await emitAndPersistSystemNoticeForRun('Agent stopped: the same tool call failed ' + identicalFailingRoundCountForRun + ' times in a row with identical arguments. Retrying without changing the call will not help; review the error above and try a different approach.');
          break;
        }
        if (identicalErrorRoundCountForRun >= MAX_IDENTICAL_ERROR_ROUNDS_FOR_AGENT_RUN) {
          await emitAndPersistSystemNoticeForRun(
            'Agent stopped: the same tool error came back ' + identicalErrorRoundCountForRun
            + ' rounds in a row despite the arguments changing each time:\n'
            + errorSignatureForRun.texts.join('\n')
            + '\nThat points at the call being malformed rather than at the values. Completed actions remain saved.'
          );
          break;
        }
        if (consecutiveEmptyItersForRun >= MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN) {
          await emitAndPersistSystemNoticeForRun('Agent stopped: ' + MAX_CONSECUTIVE_ALL_FAILURE_ITERS_FOR_AGENT_RUN + ' consecutive rounds of tool calls all returned errors. Review the results above and try a different approach.');
          break;
        }

        // Tell every tab's panel which data stores this round mutated so their sidebars
        // refresh live. The offscreen loop cannot call scheduleStoreRefresh directly, so it
        // signals via a stream event instead.
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
        // Provider errors carry the whole upstream response body, which is unreadable in a chat
        // bubble; the full text is preserved on the API log record either way.
        if (friendlyErrForRun.length > ERROR_NOTICE_MAX_CHARS_FOR_AGENT_RUN) {
          friendlyErrForRun = friendlyErrForRun.slice(0, ERROR_NOTICE_MAX_CHARS_FOR_AGENT_RUN) + '...';
        }
        await emitAndPersistSystemNoticeForRun('Error: ' + friendlyErrForRun);
      }
    } finally {
      if (runStateForRun.cdpLeaseHeld && cdpClientForRun && typeof cdpClientForRun.release === 'function') {
        try { cdpClientForRun.release(runStateForRun.targetTabId, true); } catch (eRelForRun) {}
        runStateForRun.cdpLeaseHeld = false;
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
      if (logStopReasonForRun && !stopNoticeAlreadyPersistedForRun) {
        var stopNoticeTextForRun = buildTimeoutNoticeForRun(logStopReasonForRun, lastToolTimeoutMsForRun, logStopLimitForRun);
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
          runId: runIdForRun,
          model: logResolvedModelForRun || model,
          iterationCount: iterCount,
          totalLatencyMs: Date.now() - logStartTimeForRun,
          status: logStatusForRun,
          stopReason: logStopReasonForRun || undefined,
          stopLimit: logStopLimitForRun || undefined,
          extensionCount: extensionCountForRun || undefined,
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
      // A persisted notice already explains why the run ended, so the generic apology would only
      // repeat it less accurately.
      if (!hasAppendedRenderableAssistantMessageForRun && !logStopReasonForRun && persistedSystemNoticeCountForRun === 0) {
        var fallbackTextForRun = hadSuccessfulMutatingToolCallForRun
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
