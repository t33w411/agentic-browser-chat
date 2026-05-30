(function () {
  const globalScopeForClient = globalThis;
  var nsForClient = globalScopeForClient.ABChatAgent || {};

  const OPENROUTER_URL_FOR_CLIENT = "https://openrouter.ai/api/v1/chat/completions";

  function parseSSELineForClient(lineForParse) {
    if (!lineForParse || !lineForParse.startsWith("data: ")) return null;
    const dataStr = lineForParse.slice(6).trim();
    if (dataStr === "[DONE]") return { done: true };
    try {
      return { done: false, chunk: JSON.parse(dataStr) };
    } catch (e) {
      return null;
    }
  }

  function accumulateToolCallsForClient(accumForClient, deltaToolCallsForClient) {
    if (!Array.isArray(deltaToolCallsForClient)) return;
    for (var i = 0; i < deltaToolCallsForClient.length; i++) {
      const dtc = deltaToolCallsForClient[i];
      if (dtc == null) continue;
      const idx = typeof dtc.index === "number" ? dtc.index : i;
      const isNewEntryForClient = !accumForClient[idx];
      if (isNewEntryForClient) {
        accumForClient[idx] = {
          id: dtc.id || "",
          type: "function",
          function: { name: dtc.function ? (dtc.function.name || "") : "", arguments: "" }
        };
      }
      const entry = accumForClient[idx];
      if (dtc.id) entry.id = dtc.id;
      if (dtc.function) {
        if (dtc.function.name && !isNewEntryForClient) entry.function.name += dtc.function.name;
        if (dtc.function.arguments) entry.function.arguments += dtc.function.arguments;
      }
    }
  }

  async function streamCompletionForClient(paramsForClient) {
    const {
      model,
      apiKey,
      messages,
      tools,
      tool_choice,
      onDelta,
      signal
    } = paramsForClient || {};

    if (!apiKey) throw new Error("No API key provided.");
    if (!model) throw new Error("No model specified.");
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("No messages.");

    const bodyForClient = {
      model: model,
      messages: messages,
      stream: true,
      provider: {
        sort: "throughput"
      }
    };

    if (Array.isArray(tools) && tools.length > 0) {
      bodyForClient.tools = tools;
      bodyForClient.tool_choice = tool_choice || "auto";
      bodyForClient.parallel_tool_calls = true;
    }

    const headersForClient = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "HTTP-Referer": "chrome-extension://agentic-browser-chat",
      "X-OpenRouter-Title": "Agentic Browser Chat"
    };

    const fetchOptsForClient = {
      method: "POST",
      headers: headersForClient,
      body: JSON.stringify(bodyForClient)
    };

    if (signal) fetchOptsForClient.signal = signal;

    const MAX_RETRIES_FOR_CLIENT = 2;
    const RETRY_DELAYS_MS_FOR_CLIENT = [1500, 3000];
    const RETRYABLE_STATUSES_FOR_CLIENT = [429, 502, 503, 504];

    let responseForClient;
    let lastFetchErrForClient = null;
    for (var retryIdxForClient = 0; retryIdxForClient <= MAX_RETRIES_FOR_CLIENT; retryIdxForClient++) {
      if (retryIdxForClient > 0) {
        if (typeof onDelta === 'function') {
          onDelta({ type: 'retry_notice', attempt: retryIdxForClient, maxAttempts: MAX_RETRIES_FOR_CLIENT + 1 });
        }
        await new Promise(function (resolveDelay) {
          var delayTimer = setTimeout(resolveDelay, RETRY_DELAYS_MS_FOR_CLIENT[retryIdxForClient - 1]);
          if (signal) {
            signal.addEventListener('abort', function () { clearTimeout(delayTimer); resolveDelay(); }, { once: true });
          }
        });
        if (signal && signal.aborted) return { cancelled: true, message: null };
      }
      lastFetchErrForClient = null;
      try {
        responseForClient = await fetch(OPENROUTER_URL_FOR_CLIENT, fetchOptsForClient);
        if (!responseForClient.ok && RETRYABLE_STATUSES_FOR_CLIENT.indexOf(responseForClient.status) !== -1 && retryIdxForClient < MAX_RETRIES_FOR_CLIENT) {
          lastFetchErrForClient = new Error("OpenRouter error " + responseForClient.status);
          responseForClient = null;
          continue;
        }
        break;
      } catch (fetchErrForClient) {
        if (fetchErrForClient && fetchErrForClient.name === "AbortError") {
          return { cancelled: true, message: null };
        }
        lastFetchErrForClient = fetchErrForClient;
        if (retryIdxForClient >= MAX_RETRIES_FOR_CLIENT) break;
      }
    }
    if (lastFetchErrForClient) throw lastFetchErrForClient;

    if (!responseForClient.ok) {
      let errBodyForClient = "";
      try { errBodyForClient = await responseForClient.text(); } catch (e) {}
      if (responseForClient.status === 402) {
        const creditsErr = new Error("Your OpenRouter account is out of credits. Please top up at openrouter.ai to continue.");
        creditsErr.isCreditsError = true;
        throw creditsErr;
      }
      throw new Error("OpenRouter error " + responseForClient.status + ": " + errBodyForClient.slice(0, 300));
    }

    const readerForClient = responseForClient.body.getReader();
    const decoderForClient = new TextDecoder("utf-8");
    let bufferForClient = "";
    let accTextForClient = "";
    const accToolCallsForClient = {};
    let finishReasonForClient = null;
    let usageForClient = null;
    let doneReceivedForClient = false;
    let resolvedModelForClient = null;

    while (true) {
      let readResultForClient;
      try {
        readResultForClient = await readerForClient.read();
      } catch (readErrForClient) {
        if (readErrForClient && readErrForClient.name === "AbortError") {
          // Return whatever text streamed in before the abort so the caller can
          // salvage a partial reply. Tool calls are intentionally omitted: a
          // half-streamed tool_call has truncated argument JSON and cannot be
          // executed, and persisting it would leave an assistant tool_call with
          // no matching tool result, corrupting the conversation for later turns.
          return {
            cancelled: true,
            partial: accTextForClient.length > 0,
            message: accTextForClient.length > 0
              ? { role: "assistant", content: accTextForClient, finish_reason: finishReasonForClient || "stop" }
              : null,
            usage: usageForClient,
            incompleteStream: true,
            resolvedModel: resolvedModelForClient
          };
        }
        throw readErrForClient;
      }

      if (readResultForClient.done) break;

      bufferForClient += decoderForClient.decode(readResultForClient.value, { stream: true });
      const linesForClient = bufferForClient.split("\n");
      bufferForClient = linesForClient.pop();

      for (var j = 0; j < linesForClient.length; j++) {
        const lineForClient = linesForClient[j].trim();
        if (!lineForClient) continue;
        const parsedForClient = parseSSELineForClient(lineForClient);
        if (!parsedForClient) continue;
        if (parsedForClient.done) { doneReceivedForClient = true; if (!finishReasonForClient) finishReasonForClient = "stop"; break; }

        const chunkForClient = parsedForClient.chunk;
        if (chunkForClient && chunkForClient.usage) {
          usageForClient = chunkForClient.usage;
        }
        if (chunkForClient && typeof chunkForClient.model === 'string' && chunkForClient.model) {
          resolvedModelForClient = chunkForClient.model;
        }
        const choiceForClient = chunkForClient && chunkForClient.choices && chunkForClient.choices[0];
        if (!choiceForClient) continue;

        if (choiceForClient.finish_reason) {
          finishReasonForClient = choiceForClient.finish_reason;
        }

        const deltaForClient = choiceForClient.delta || choiceForClient.message;
        if (!deltaForClient) continue;

        const textChunkForClient = (typeof deltaForClient.content === "string" && deltaForClient.content)
          ? deltaForClient.content
          : (typeof deltaForClient.refusal === "string" && deltaForClient.refusal)
            ? deltaForClient.refusal
            : null;
        if (textChunkForClient) {
          accTextForClient += textChunkForClient;
          if (typeof onDelta === "function") {
            onDelta({ type: "text", text: textChunkForClient });
          }
        }

        if (deltaForClient.tool_calls) {
          accumulateToolCallsForClient(accToolCallsForClient, deltaForClient.tool_calls);
          if (typeof onDelta === "function") {
            onDelta({ type: "tool_calls_partial" });
          }
        }
      }
    }

    const toolCallsArrayForClient = Object.keys(accToolCallsForClient)
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return accToolCallsForClient[k]; });

    const messageForClient = {
      role: "assistant",
      content: accTextForClient || null,
      tool_calls: toolCallsArrayForClient.length > 0 ? toolCallsArrayForClient : undefined,
      finish_reason: finishReasonForClient
    };

    return { cancelled: false, message: messageForClient, usage: usageForClient, incompleteStream: !doneReceivedForClient, resolvedModel: resolvedModelForClient };
  }

  const OPENROUTER_MODELS_URL_FOR_CLIENT = "https://openrouter.ai/api/v1/models";
  async function fetchRawModelsForClient(apiKey) {
    if (!apiKey) throw new Error("No API key provided.");
    const MAX_RETRIES_FOR_RAW = 2;
    const RETRY_DELAYS_FOR_RAW = [1500, 3000];
    const RETRYABLE_FOR_RAW = [429, 502, 503, 504];
    let responseForRaw = null;
    let lastErrForRaw = null;
    for (let retryForRaw = 0; retryForRaw <= MAX_RETRIES_FOR_RAW; retryForRaw++) {
      if (retryForRaw > 0) {
        await new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAYS_FOR_RAW[retryForRaw - 1]); });
      }
      lastErrForRaw = null;
      try {
        responseForRaw = await fetch(OPENROUTER_MODELS_URL_FOR_CLIENT, {
          headers: {
            "Authorization": "Bearer " + apiKey,
            "HTTP-Referer": "chrome-extension://agentic-browser-chat",
            "X-OpenRouter-Title": "Agentic Browser Chat"
          }
        });
        if (!responseForRaw.ok && RETRYABLE_FOR_RAW.indexOf(responseForRaw.status) !== -1 && retryForRaw < MAX_RETRIES_FOR_RAW) {
          lastErrForRaw = new Error("HTTP " + responseForRaw.status);
          responseForRaw = null;
          continue;
        }
        break;
      } catch (errForRaw) {
        lastErrForRaw = errForRaw;
        if (retryForRaw >= MAX_RETRIES_FOR_RAW) break;
      }
    }
    if (lastErrForRaw) throw lastErrForRaw;
    if (!responseForRaw.ok) {
      let errBodyForRaw = "";
      try { errBodyForRaw = await responseForRaw.text(); } catch (e) {}
      throw new Error("OpenRouter models error " + responseForRaw.status + ": " + errBodyForRaw.slice(0, 200));
    }
    const jsonForRaw = await responseForRaw.json();
    return Array.isArray(jsonForRaw.data) ? jsonForRaw.data : [];
  }

  async function generateTitleForClient(paramsForTitle) {
    const { apiKey, userMessage, fallbackModel } = paramsForTitle || {};
    if (!apiKey || !userMessage) return null;
    const PRIMARY_TITLE_MODEL = 'openai/gpt-4.1-nano';
    const bodyForTitle = {};
    if (fallbackModel === 'openrouter/free') {
      bodyForTitle.models = [
        'openrouter/free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'nvidia/nemotron-nano-9b-v2:free'
      ];
      bodyForTitle.route = 'fallback';
    } else if (fallbackModel && fallbackModel !== PRIMARY_TITLE_MODEL) {
      bodyForTitle.models = [PRIMARY_TITLE_MODEL, fallbackModel];
      bodyForTitle.route = 'fallback';
    } else {
      bodyForTitle.model = PRIMARY_TITLE_MODEL;
    }
    bodyForTitle.messages = [
      {
        role: 'system',
        content: 'Generate a concise 3-6 word title for a chat conversation based on the user\'s first message. Describe the topic or intent of the message; do not answer the question. Reply with only the title. No quotes, no trailing punctuation.'
      },
      {
        role: 'user',
        content: String(userMessage).slice(0, 500)
      }
    ];
    bodyForTitle.stream = false;
    const MAX_RETRIES_FOR_TITLE = 2;
    const RETRY_DELAYS_FOR_TITLE = [1500, 3000];
    const RETRYABLE_FOR_TITLE = [429, 502, 503, 504];
    let responseForTitle = null;
    let lastErrForTitle = null;
    for (let retryForTitle = 0; retryForTitle <= MAX_RETRIES_FOR_TITLE; retryForTitle++) {
      if (retryForTitle > 0) {
        await new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAYS_FOR_TITLE[retryForTitle - 1]); });
      }
      lastErrForTitle = null;
      try {
        responseForTitle = await fetch(OPENROUTER_URL_FOR_CLIENT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
            'X-OpenRouter-Title': 'Agentic Browser Chat'
          },
          body: JSON.stringify(bodyForTitle)
        });
        if (!responseForTitle.ok && RETRYABLE_FOR_TITLE.indexOf(responseForTitle.status) !== -1 && retryForTitle < MAX_RETRIES_FOR_TITLE) {
          lastErrForTitle = new Error("HTTP " + responseForTitle.status);
          responseForTitle = null;
          continue;
        }
        break;
      } catch (e) {
        lastErrForTitle = e;
        if (retryForTitle >= MAX_RETRIES_FOR_TITLE) break;
      }
    }
    if (lastErrForTitle) {
      return { title: null, model: null, error: 'fetch_failed', status: null, body: String((lastErrForTitle && lastErrForTitle.message) || lastErrForTitle || '').slice(0, 500) };
    }
    if (!responseForTitle) {
      return { title: null, model: null, error: 'no_response', status: null, body: '' };
    }
    if (!responseForTitle.ok) {
      let errBodyForTitle = '';
      try { errBodyForTitle = await responseForTitle.text(); } catch (e) {}
      return { title: null, model: null, error: 'http_error', status: responseForTitle.status, body: String(errBodyForTitle).slice(0, 500) };
    }
    let jsonForTitle;
    try { jsonForTitle = await responseForTitle.json(); } catch (e) {
      return { title: null, model: null, error: 'json_parse_failed', status: responseForTitle.status, body: String((e && e.message) || e || '').slice(0, 500) };
    }
    const rawTitleForClient = jsonForTitle && jsonForTitle.choices && jsonForTitle.choices[0] &&
      jsonForTitle.choices[0].message && jsonForTitle.choices[0].message.content;
    if (!rawTitleForClient) {
      let rawJsonForTitle = '';
      try { rawJsonForTitle = JSON.stringify(jsonForTitle); } catch (e) {}
      return { title: null, model: jsonForTitle && jsonForTitle.model || null, error: 'empty_content', status: responseForTitle.status, body: String(rawJsonForTitle).slice(0, 500) };
    }
    const titleTextForClient = String(rawTitleForClient).trim().slice(0, 80) || null;
    if (!titleTextForClient) {
      return { title: null, model: jsonForTitle.model || null, error: 'blank_title', status: responseForTitle.status, body: String(rawTitleForClient).slice(0, 500) };
    }
    return { title: titleTextForClient, model: jsonForTitle.model || PRIMARY_TITLE_MODEL };
  }

  nsForClient.client = {
    streamCompletion: streamCompletionForClient,
    fetchRawModels: fetchRawModelsForClient,
    generateTitle: generateTitleForClient
  };

  globalScopeForClient.ABChatAgent = nsForClient;
})();
