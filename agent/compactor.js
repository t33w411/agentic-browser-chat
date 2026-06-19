(function () {
  var globalScopeForCompactor = globalThis;
  var nsForCompactor = globalScopeForCompactor.ABChatAgent || {};

  var OPENROUTER_URL_FOR_COMPACTOR = "https://openrouter.ai/api/v1/chat/completions";
  var SUMMARIZER_PRIMARY_MODEL_FOR_COMPACTOR = "openai/gpt-4.1-nano";

  var DEFAULT_TOKEN_BUDGET_FOR_COMPACTOR = 128000;
  var THRESHOLD_FRACTION_FOR_COMPACTOR = 0.83;
  var TARGET_FRACTION_FOR_COMPACTOR = 0.4;
  var FLOOR_TAIL_FRACTION_FOR_COMPACTOR = 0.15;
  var MIN_RECENT_USER_TURNS_FOR_COMPACTOR = 2;
  var TOOL_CONTENT_FOLD_CAP_FOR_COMPACTOR = 1500;
  var IMAGE_PART_TOKEN_ESTIMATE_FOR_COMPACTOR = 600;

  // Per-model context window estimates, longest prefix wins.
  var TOKEN_BUDGET_PREFIX_MAP_FOR_COMPACTOR = [
    { prefix: "openai/gpt-4.1", budget: 1000000 },
    { prefix: "openai/gpt-4o", budget: 128000 },
    { prefix: "openai/gpt-4-turbo", budget: 128000 },
    { prefix: "openai/o1", budget: 200000 },
    { prefix: "openai/o3", budget: 200000 },
    { prefix: "openai/o4", budget: 200000 },
    { prefix: "anthropic/claude-3.5", budget: 200000 },
    { prefix: "anthropic/claude-3.7", budget: 200000 },
    { prefix: "anthropic/claude-sonnet-4", budget: 200000 },
    { prefix: "anthropic/claude-opus-4", budget: 200000 },
    { prefix: "anthropic/claude-haiku-4", budget: 200000 },
    { prefix: "anthropic/claude", budget: 200000 },
    { prefix: "google/gemini-2.5", budget: 1000000 },
    { prefix: "google/gemini-2", budget: 1000000 },
    { prefix: "google/gemini", budget: 128000 },
    { prefix: "x-ai/grok-2", budget: 131072 },
    { prefix: "x-ai/grok", budget: 256000 },
    { prefix: "mistralai/", budget: 128000 },
    { prefix: "deepseek/", budget: 128000 },
    { prefix: "qwen/", budget: 128000 }
  ];

  function getTokenBudgetForCompactor(modelIdForCompactor) {
    var modelTextForCompactor = String(modelIdForCompactor || "").toLowerCase();
    var bestMatchForCompactor = null;
    for (var iForCompactor = 0; iForCompactor < TOKEN_BUDGET_PREFIX_MAP_FOR_COMPACTOR.length; iForCompactor++) {
      var entryForCompactor = TOKEN_BUDGET_PREFIX_MAP_FOR_COMPACTOR[iForCompactor];
      if (modelTextForCompactor.indexOf(entryForCompactor.prefix) === 0) {
        if (!bestMatchForCompactor || entryForCompactor.prefix.length > bestMatchForCompactor.prefix.length) {
          bestMatchForCompactor = entryForCompactor;
        }
      }
    }
    return bestMatchForCompactor ? bestMatchForCompactor.budget : DEFAULT_TOKEN_BUDGET_FOR_COMPACTOR;
  }

  function estimateTokensFromTextForCompactor(textForCompactor) {
    if (textForCompactor == null) return 0;
    var stringTextForCompactor;
    if (typeof textForCompactor === "string") {
      stringTextForCompactor = textForCompactor;
    } else {
      try { stringTextForCompactor = JSON.stringify(textForCompactor); }
      catch (errForCompactor) { stringTextForCompactor = ""; }
    }
    return Math.ceil((stringTextForCompactor.length || 0) / 4);
  }

  function isVisibleMessageForCompactor(messageForCompactor) {
    if (!messageForCompactor || !messageForCompactor.role) return false;
    if (messageForCompactor.role === "_loading") return false;
    if (messageForCompactor.role === "_hidden_pair_indicator") return false;
    return true;
  }

  function getMessageTokenSizeForCompactor(messageForCompactor) {
    if (!isVisibleMessageForCompactor(messageForCompactor)) return 0;
    var totalForCompactor = 4; // small per-message envelope overhead
    var contentForCompactor = messageForCompactor.content;
    if (typeof contentForCompactor === "string" && contentForCompactor) {
      totalForCompactor += estimateTokensFromTextForCompactor(contentForCompactor);
    } else if (Array.isArray(contentForCompactor)) {
      for (var iForCompactor = 0; iForCompactor < contentForCompactor.length; iForCompactor++) {
        var partForCompactor = contentForCompactor[iForCompactor];
        if (!partForCompactor) continue;
        if (partForCompactor.type === "text" && typeof partForCompactor.text === "string") {
          totalForCompactor += estimateTokensFromTextForCompactor(partForCompactor.text);
        } else if (partForCompactor.type === "image_url") {
          totalForCompactor += IMAGE_PART_TOKEN_ESTIMATE_FOR_COMPACTOR;
        }
      }
    } else if (typeof messageForCompactor.md === "string") {
      totalForCompactor += estimateTokensFromTextForCompactor(messageForCompactor.md);
    }
    if (Array.isArray(messageForCompactor.tool_calls)) {
      for (var jForCompactor = 0; jForCompactor < messageForCompactor.tool_calls.length; jForCompactor++) {
        var toolCallForCompactor = messageForCompactor.tool_calls[jForCompactor] || {};
        var fnForCompactor = toolCallForCompactor.function || {};
        totalForCompactor += estimateTokensFromTextForCompactor(fnForCompactor.name || "");
        totalForCompactor += estimateTokensFromTextForCompactor(fnForCompactor.arguments || "");
      }
    }
    if (Array.isArray(messageForCompactor.chips)) {
      for (var kForCompactor = 0; kForCompactor < messageForCompactor.chips.length; kForCompactor++) {
        var chipForCompactor = messageForCompactor.chips[kForCompactor] || {};
        totalForCompactor += estimateTokensFromTextForCompactor(chipForCompactor.label || "");
        totalForCompactor += estimateTokensFromTextForCompactor(chipForCompactor.content || "");
      }
    }
    return totalForCompactor;
  }

  function findIndexByMessageIdForCompactor(messagesForCompactor, targetIdForCompactor) {
    if (targetIdForCompactor == null) return -1;
    var targetTextForCompactor = String(targetIdForCompactor);
    for (var iForCompactor = 0; iForCompactor < messagesForCompactor.length; iForCompactor++) {
      var messageForCompactor = messagesForCompactor[iForCompactor];
      if (messageForCompactor && messageForCompactor.id != null && String(messageForCompactor.id) === targetTextForCompactor) {
        return iForCompactor;
      }
    }
    return -1;
  }

  function resolveStartIndexFromCompactedIdForCompactor(messagesForCompactor, compactedThroughMessageIdForCompactor) {
    if (compactedThroughMessageIdForCompactor == null) return 0;
    var matchedIndexForCompactor = findIndexByMessageIdForCompactor(messagesForCompactor, compactedThroughMessageIdForCompactor);
    if (matchedIndexForCompactor < 0) return 0;
    return matchedIndexForCompactor + 1;
  }

  function renderChipsForFoldInputForCompactor(chipsForCompactor) {
    if (!Array.isArray(chipsForCompactor) || chipsForCompactor.length === 0) return "";
    var partsForCompactor = chipsForCompactor.map(function (chipForCompactor) {
      var chipTypeForCompactor = String((chipForCompactor && chipForCompactor.type) || "").trim();
      var chipLabelForCompactor = String((chipForCompactor && chipForCompactor.label) || "").trim();
      return chipTypeForCompactor + (chipLabelForCompactor ? ":" + chipLabelForCompactor : "");
    }).filter(Boolean);
    if (partsForCompactor.length === 0) return "";
    return "[attachments: " + partsForCompactor.join(", ") + "]";
  }

  function renderMessageForFoldInputForCompactor(messageForCompactor) {
    if (!isVisibleMessageForCompactor(messageForCompactor)) return "";
    var roleForCompactor = messageForCompactor.role;
    var contentTextForCompactor = "";
    if (typeof messageForCompactor.content === "string") {
      contentTextForCompactor = messageForCompactor.content;
    } else if (Array.isArray(messageForCompactor.content)) {
      contentTextForCompactor = messageForCompactor.content
        .filter(function (partForCompactor) {
          return partForCompactor && partForCompactor.type === "text";
        })
        .map(function (partForCompactor) { return String(partForCompactor.text || ""); })
        .join("\n");
    } else if (typeof messageForCompactor.md === "string") {
      contentTextForCompactor = messageForCompactor.md;
    }

    if (roleForCompactor === "user") {
      var chipsLineForCompactor = renderChipsForFoldInputForCompactor(messageForCompactor.chips);
      var bodyForUserForCompactor = (chipsLineForCompactor ? chipsLineForCompactor + "\n" : "") + contentTextForCompactor;
      bodyForUserForCompactor = bodyForUserForCompactor.trim();
      if (!bodyForUserForCompactor) return "USER: (empty)";
      return "USER: " + bodyForUserForCompactor;
    }

    if (roleForCompactor === "assistant") {
      var assistantBodyForCompactor = contentTextForCompactor.trim();
      if (Array.isArray(messageForCompactor.tool_calls) && messageForCompactor.tool_calls.length > 0) {
        var toolCallSummariesForCompactor = messageForCompactor.tool_calls.map(function (toolCallForCompactor) {
          var fnForCompactor = (toolCallForCompactor && toolCallForCompactor.function) || {};
          var argsTextForCompactor = String(fnForCompactor.arguments || "{}");
          if (argsTextForCompactor.length > 400) argsTextForCompactor = argsTextForCompactor.slice(0, 400) + "…";
          return "tool_call(" + String(fnForCompactor.name || "") + ", args=" + argsTextForCompactor + ")";
        }).join("; ");
        assistantBodyForCompactor = assistantBodyForCompactor
          ? assistantBodyForCompactor + "\n" + toolCallSummariesForCompactor
          : toolCallSummariesForCompactor;
      }
      if (!assistantBodyForCompactor) return "ASSISTANT: (empty)";
      return "ASSISTANT: " + assistantBodyForCompactor;
    }

    if (roleForCompactor === "tool") {
      var toolBodyForCompactor = String(messageForCompactor.content || "");
      if (toolBodyForCompactor.length > TOOL_CONTENT_FOLD_CAP_FOR_COMPACTOR) {
        toolBodyForCompactor = toolBodyForCompactor.slice(0, TOOL_CONTENT_FOLD_CAP_FOR_COMPACTOR) + "…";
      }
      toolBodyForCompactor = toolBodyForCompactor.trim();
      if (!toolBodyForCompactor) return "TOOL_RESULT: (empty)";
      return "TOOL_RESULT: " + toolBodyForCompactor;
    }

    var fallbackBodyForCompactor = contentTextForCompactor.trim();
    if (!fallbackBodyForCompactor) return "";
    return String(roleForCompactor).toUpperCase() + ": " + fallbackBodyForCompactor;
  }

  async function callSummarizerForCompactor(paramsForCompactor) {
    var apiKeyForCompactor = paramsForCompactor.apiKey;
    var fallbackModelForCompactor = paramsForCompactor.fallbackModel;
    var existingSummaryForCompactor = String(paramsForCompactor.existingSummary || "");
    var newMessagesTextForCompactor = String(paramsForCompactor.newMessagesText || "");

    var bodyForCompactor = {};
    if (fallbackModelForCompactor === 'openrouter/free') {
      bodyForCompactor.models = [
        'openrouter/free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'nvidia/nemotron-nano-9b-v2:free'
      ];
      bodyForCompactor.route = 'fallback';
    } else if (fallbackModelForCompactor && fallbackModelForCompactor !== SUMMARIZER_PRIMARY_MODEL_FOR_COMPACTOR) {
      bodyForCompactor.models = [SUMMARIZER_PRIMARY_MODEL_FOR_COMPACTOR, fallbackModelForCompactor];
      bodyForCompactor.route = "fallback";
    } else {
      bodyForCompactor.model = SUMMARIZER_PRIMARY_MODEL_FOR_COMPACTOR;
    }

    var systemTextForCompactor = [
      "You maintain a running summary of an ongoing chat between a user and an AI assistant.",
      "Update the existing summary by folding in the new messages. Output ONLY the updated summary text. No headings, no preamble, no quotes.",
      "Capture: the user's goals and questions, decisions made, key facts, important data the user asked to remember, outcomes of any tools the assistant called, and unresolved follow-ups.",
      "Drop: pleasantries, repetition, transient UI chit-chat.",
      "Write in third person, past tense. Aim for 200 to 500 words. Be concrete and specific (names, numbers, links, file titles).",
      "If any URLs were fetched or searched, or any notes/chats/tasks/questions were read or modified, append a SOURCES block at the very end (omit it entirely if there are none).",
      "The SOURCES block must follow this exact format:",
      "\nSOURCES:\nURLs:\n- https://example.com/page (fetched; used to answer question about X)\n- https://news.example.com/article (search result; summarized above)\nIDs:\n- note:42 \"Meeting notes from Monday\"\n- task:7 \"Draft blog post\"\n- chat:15 \"Research session on climate data\"\n- question:3 \"What is the capital of France?\""
    ].join(" ");

    bodyForCompactor.messages = [
      { role: "system", content: systemTextForCompactor },
      {
        role: "user",
        content: "EXISTING SUMMARY (may be empty):\n"
          + (existingSummaryForCompactor || "(none)")
          + "\n\n--- NEW MESSAGES TO FOLD IN ---\n"
          + newMessagesTextForCompactor
          + "\n--- END ---\n\nReturn the updated summary now. Remember: if any URLs or note/chat/task/question IDs appeared in these messages, include the SOURCES block at the end."
      }
    ];
    bodyForCompactor.stream = false;

    var fetchOptsForCompactor = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKeyForCompactor,
        "HTTP-Referer": "chrome-extension://agentic-browser-chat",
        "X-OpenRouter-Title": "Agentic Browser Chat"
      },
      body: JSON.stringify(bodyForCompactor)
    };
    if (paramsForCompactor.signal) fetchOptsForCompactor.signal = paramsForCompactor.signal;

    const MAX_RETRIES_FOR_COMPACTOR = 2;
    const RETRY_DELAYS_FOR_COMPACTOR = [1500, 3000];
    const RETRYABLE_FOR_COMPACTOR = [429, 502, 503, 504];
    var responseForCompactor = null;
    var lastErrForCompactor = null;
    for (var retryForCompactor = 0; retryForCompactor <= MAX_RETRIES_FOR_COMPACTOR; retryForCompactor++) {
      if (retryForCompactor > 0) {
        await new Promise(function (resolve) {
          var delayForCompactor = setTimeout(resolve, RETRY_DELAYS_FOR_COMPACTOR[retryForCompactor - 1]);
          if (paramsForCompactor.signal) {
            paramsForCompactor.signal.addEventListener('abort', function () { clearTimeout(delayForCompactor); resolve(); }, { once: true });
          }
        });
        if (paramsForCompactor.signal && paramsForCompactor.signal.aborted) return null;
      }
      lastErrForCompactor = null;
      try {
        responseForCompactor = await fetch(OPENROUTER_URL_FOR_COMPACTOR, fetchOptsForCompactor);
        if (!responseForCompactor.ok && RETRYABLE_FOR_COMPACTOR.indexOf(responseForCompactor.status) !== -1 && retryForCompactor < MAX_RETRIES_FOR_COMPACTOR) {
          lastErrForCompactor = new Error("HTTP " + responseForCompactor.status);
          responseForCompactor = null;
          continue;
        }
        break;
      } catch (errorForCompactor) {
        if (errorForCompactor && errorForCompactor.name === 'AbortError') return null;
        lastErrForCompactor = errorForCompactor;
        if (retryForCompactor >= MAX_RETRIES_FOR_COMPACTOR) break;
      }
    }
    if (lastErrForCompactor || !responseForCompactor || !responseForCompactor.ok) return null;
    var jsonForCompactor;
    try { jsonForCompactor = await responseForCompactor.json(); }
    catch (errorForCompactor) { return null; }
    var rawTextForCompactor = jsonForCompactor
      && jsonForCompactor.choices
      && jsonForCompactor.choices[0]
      && jsonForCompactor.choices[0].message
      && jsonForCompactor.choices[0].message.content;
    if (!rawTextForCompactor) return null;
    return { text: String(rawTextForCompactor).trim(), usage: jsonForCompactor.usage || null, model: jsonForCompactor.model || null };
  }

  async function maybeCompactForCompactor(paramsForCompactor) {
    var optsForCompactor = paramsForCompactor || {};
    var apiKeyForCompactor = optsForCompactor.apiKey;
    var modelForCompactor = optsForCompactor.model;
    var messagesForCompactor = Array.isArray(optsForCompactor.messages) ? optsForCompactor.messages : [];
    var existingSummaryForCompactor = String(optsForCompactor.existingSummary || "");
    var alreadyFoldedThroughIdForCompactor = optsForCompactor.compactedThroughMessageId != null
      ? optsForCompactor.compactedThroughMessageId
      : null;
    var systemOverheadTokensForCompactor = Number(optsForCompactor.systemOverheadTokens) || 0;

    var alreadyFoldedThroughIndexForCompactor = alreadyFoldedThroughIdForCompactor != null
      ? findIndexByMessageIdForCompactor(messagesForCompactor, alreadyFoldedThroughIdForCompactor)
      : -1;
    if (alreadyFoldedThroughIdForCompactor != null && alreadyFoldedThroughIndexForCompactor < 0) {
      // Stale pointer (folded message no longer present, e.g., after a fork). Reset.
      alreadyFoldedThroughIndexForCompactor = -1;
      existingSummaryForCompactor = "";
      alreadyFoldedThroughIdForCompactor = null;
    }

    var noOpResultForCompactor = {
      didCompact: false,
      summaryText: existingSummaryForCompactor,
      compactedThroughMessageId: alreadyFoldedThroughIdForCompactor,
      startIndex: alreadyFoldedThroughIndexForCompactor + 1
    };

    if (!apiKeyForCompactor || !modelForCompactor) return noOpResultForCompactor;
    if (messagesForCompactor.length === 0) return noOpResultForCompactor;

    var currentStartIndexForCompactor = alreadyFoldedThroughIndexForCompactor + 1;

    var summaryTokensForCompactor = estimateTokensFromTextForCompactor(existingSummaryForCompactor);
    var visibleTailTokensForCompactor = 0;
    for (var tForCompactor = currentStartIndexForCompactor; tForCompactor < messagesForCompactor.length; tForCompactor++) {
      visibleTailTokensForCompactor += getMessageTokenSizeForCompactor(messagesForCompactor[tForCompactor]);
    }
    var totalTokensForCompactor = systemOverheadTokensForCompactor + summaryTokensForCompactor + visibleTailTokensForCompactor;

    var budgetForCompactor = getTokenBudgetForCompactor(modelForCompactor);
    var thresholdTokensForCompactor = Math.floor(budgetForCompactor * THRESHOLD_FRACTION_FOR_COMPACTOR);
    if (totalTokensForCompactor < thresholdTokensForCompactor) return noOpResultForCompactor;

    var rawTargetTailTokensForCompactor = Math.floor(budgetForCompactor * TARGET_FRACTION_FOR_COMPACTOR)
      - summaryTokensForCompactor
      - systemOverheadTokensForCompactor;
    var floorTailTokensForCompactor = Math.floor(budgetForCompactor * FLOOR_TAIL_FRACTION_FOR_COMPACTOR);
    var targetTailTokensForCompactor = Math.max(rawTargetTailTokensForCompactor, floorTailTokensForCompactor);

    var tailTokensFromIndexForCompactor = new Array(messagesForCompactor.length + 1);
    tailTokensFromIndexForCompactor[messagesForCompactor.length] = 0;
    for (var qForCompactor = messagesForCompactor.length - 1; qForCompactor >= 0; qForCompactor--) {
      tailTokensFromIndexForCompactor[qForCompactor] = tailTokensFromIndexForCompactor[qForCompactor + 1]
        + getMessageTokenSizeForCompactor(messagesForCompactor[qForCompactor]);
    }

    var userIndicesForCompactor = [];
    for (var rForCompactor = 0; rForCompactor < messagesForCompactor.length; rForCompactor++) {
      var msgForCompactor = messagesForCompactor[rForCompactor];
      if (isVisibleMessageForCompactor(msgForCompactor) && msgForCompactor.role === "user") {
        userIndicesForCompactor.push(rForCompactor);
      }
    }
    if (userIndicesForCompactor.length <= MIN_RECENT_USER_TURNS_FOR_COMPACTOR) return noOpResultForCompactor;

    var maxKForCompactor = userIndicesForCompactor.length - MIN_RECENT_USER_TURNS_FOR_COMPACTOR;
    var selectedBoundaryForCompactor = -1;
    for (var sForCompactor = 0; sForCompactor <= maxKForCompactor; sForCompactor++) {
      var candidateIndexForCompactor = userIndicesForCompactor[sForCompactor];
      if (candidateIndexForCompactor <= alreadyFoldedThroughIndexForCompactor) continue;
      if (tailTokensFromIndexForCompactor[candidateIndexForCompactor] <= targetTailTokensForCompactor) {
        selectedBoundaryForCompactor = candidateIndexForCompactor;
        break;
      }
    }
    if (selectedBoundaryForCompactor < 0 && maxKForCompactor >= 0) {
      var fallbackBoundaryForCompactor = userIndicesForCompactor[maxKForCompactor];
      if (fallbackBoundaryForCompactor > alreadyFoldedThroughIndexForCompactor) {
        selectedBoundaryForCompactor = fallbackBoundaryForCompactor;
      }
    }
    if (selectedBoundaryForCompactor < 0) return noOpResultForCompactor;

    var foldStartIndexForCompactor = alreadyFoldedThroughIndexForCompactor + 1;
    var foldEndIndexExclusiveForCompactor = selectedBoundaryForCompactor;
    if (foldEndIndexExclusiveForCompactor <= foldStartIndexForCompactor) return noOpResultForCompactor;

    var renderedLinesForCompactor = [];
    var lastFoldedMessageIdForCompactor = null;
    for (var uForCompactor = foldStartIndexForCompactor; uForCompactor < foldEndIndexExclusiveForCompactor; uForCompactor++) {
      var foldMsgForCompactor = messagesForCompactor[uForCompactor];
      if (!isVisibleMessageForCompactor(foldMsgForCompactor)) continue;
      var renderedForCompactor = renderMessageForFoldInputForCompactor(foldMsgForCompactor);
      if (renderedForCompactor) renderedLinesForCompactor.push(renderedForCompactor);
      if (foldMsgForCompactor && foldMsgForCompactor.id != null) {
        lastFoldedMessageIdForCompactor = foldMsgForCompactor.id;
      }
    }
    if (renderedLinesForCompactor.length === 0 || lastFoldedMessageIdForCompactor == null) {
      return noOpResultForCompactor;
    }

    var summarizerResultForCompactor = await callSummarizerForCompactor({
      apiKey: apiKeyForCompactor,
      fallbackModel: modelForCompactor,
      existingSummary: existingSummaryForCompactor,
      newMessagesText: renderedLinesForCompactor.join("\n\n"),
      signal: optsForCompactor.signal
    });
    if (!summarizerResultForCompactor) return noOpResultForCompactor;

    return {
      didCompact: true,
      summaryText: summarizerResultForCompactor.text,
      summarizerUsage: summarizerResultForCompactor.usage || null,
      summarizerModel: summarizerResultForCompactor.model || null,
      compactedThroughMessageId: lastFoldedMessageIdForCompactor,
      startIndex: foldEndIndexExclusiveForCompactor
    };
  }

  nsForCompactor.compactor = {
    maybeCompact: maybeCompactForCompactor,
    resolveStartIndexFromCompactedId: resolveStartIndexFromCompactedIdForCompactor,
    estimateTokensFromText: estimateTokensFromTextForCompactor,
    getTokenBudget: getTokenBudgetForCompactor
  };

  globalScopeForCompactor.ABChatAgent = nsForCompactor;
})();
