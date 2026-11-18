// Deep research. The user turns it on for one message from the composer, and that user message is
// saved with research: true. The agent loop reads the flag from the latest user message rather
// than from the run's start parameters, so an edited and resent message keeps it.
//
// A research run differs from a normal one in four ways, all applied by offscreen/agentRun.js:
// the instructions below are appended to the latest user turn of each request; the model may make
// several tool calls per step; web_search runs on SEARCH_MODEL; and until the run has made enough
// successful searches and page reads, each request sends tool_choice "required", so the model
// cannot write its final answer early. A Stop hook could only send the model back after its early
// answer had been saved and shown, which would leave two answers in the chat.
//
// Pure: no DOM and no chrome.*, so tests/researchMode.test.js requires it from Node.
(function () {
  const globalScopeForResearchMode = globalThis;
  const nsForResearchMode = globalScopeForResearchMode.ABChatAgent || {};

  // The floor the loop holds a research run to. The instructions ask for more than this; the floor
  // only stops a model that ignores them from answering after one search.
  const MIN_SEARCHES_FOR_RESEARCH_MODE = 3;
  const MIN_PAGE_READS_FOR_RESEARCH_MODE = 3;
  // Required rounds stop after this many, so a topic with few readable sources cannot hold the
  // run in a loop of failing calls.
  const MAX_REQUIRED_ROUNDS_FOR_RESEARCH_MODE = 10;
  // With this many failed searches and none that worked, searching is treated as broken (the free
  // model, no credit, an outage) and the model is no longer made to call tools.
  const BROKEN_SEARCH_FAILURES_FOR_RESEARCH_MODE = 2;
  // web_search in a research run. A run makes several searches, and each one is a model call, so it
  // goes to a cheap model rather than the chat model. GPT-4.1 Nano gets OpenAI's own search under
  // OpenRouter's "auto" engine.
  const SEARCH_MODEL_FOR_RESEARCH_MODE = 'openai/gpt-4.1-nano';

  function latestUserMessageIndexForResearchMode(messagesForIndex) {
    const listForIndex = Array.isArray(messagesForIndex) ? messagesForIndex : [];
    for (let iForIndex = listForIndex.length - 1; iForIndex >= 0; iForIndex--) {
      const messageForIndex = listForIndex[iForIndex];
      if (messageForIndex && messageForIndex.role === 'user' && !messageForIndex.systemNotice) return iForIndex;
    }
    return -1;
  }

  function isResearchRunForResearchMode(messagesForCheck) {
    const indexForCheck = latestUserMessageIndexForResearchMode(messagesForCheck);
    return indexForCheck >= 0 && messagesForCheck[indexForCheck].research === true;
  }

  function parseToolResultForResearchMode(contentForParse) {
    if (contentForParse && typeof contentForParse === 'object') return contentForParse;
    if (typeof contentForParse !== 'string' || !contentForParse.trim()) return null;
    try {
      const parsedForResult = JSON.parse(contentForParse);
      return parsedForResult && typeof parsedForResult === 'object' ? parsedForResult : null;
    } catch (parseErrorForResult) {
      return null;
    }
  }

  function parseToolArgsForResearchMode(argumentsForParse) {
    if (argumentsForParse && typeof argumentsForParse === 'object') return argumentsForParse;
    try {
      const parsedForArgs = JSON.parse(String(argumentsForParse || '{}'));
      return parsedForArgs && typeof parsedForArgs === 'object' ? parsedForArgs : {};
    } catch (parseErrorForArgs) {
      return {};
    }
  }

  // Counts what the run since the latest user message has actually done, from the saved tool
  // results rather than from anything the model says. A repeated query or URL counts once, so
  // the floor cannot be met by asking the same thing three times.
  function progressForResearchMode(messagesForProgress) {
    const listForProgress = Array.isArray(messagesForProgress) ? messagesForProgress : [];
    const startForProgress = latestUserMessageIndexForResearchMode(listForProgress);
    const callsByIdForProgress = {};
    const searchKeysForProgress = new Set();
    const readKeysForProgress = new Set();
    let failedSearchesForProgress = 0;
    if (startForProgress < 0) return { searches: 0, pageReads: 0, failedSearches: 0 };

    for (let iForProgress = startForProgress + 1; iForProgress < listForProgress.length; iForProgress++) {
      const messageForProgress = listForProgress[iForProgress];
      if (!messageForProgress) continue;
      if (Array.isArray(messageForProgress.tool_calls)) {
        messageForProgress.tool_calls.forEach(function (callForProgress) {
          if (!callForProgress || callForProgress.id == null || !callForProgress.function) return;
          callsByIdForProgress[String(callForProgress.id)] = {
            name: String(callForProgress.function.name || ''),
            args: parseToolArgsForResearchMode(callForProgress.function.arguments)
          };
        });
        continue;
      }
      if (messageForProgress.role !== 'tool' || messageForProgress.tool_call_id == null) continue;
      const callForResult = callsByIdForProgress[String(messageForProgress.tool_call_id)];
      if (!callForResult) continue;
      if (callForResult.name !== 'web_search' && callForResult.name !== 'web_fetch') continue;
      const resultForProgress = parseToolResultForResearchMode(messageForProgress.content);
      const succeededForProgress = Boolean(resultForProgress) && resultForProgress.ok !== false && !resultForProgress.error;
      if (callForResult.name === 'web_search') {
        if (!succeededForProgress) {
          failedSearchesForProgress++;
          continue;
        }
        const queryKeyForProgress = String(callForResult.args.query || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (queryKeyForProgress) searchKeysForProgress.add(queryKeyForProgress);
      } else if (succeededForProgress) {
        const urlKeyForProgress = String(callForResult.args.url || '').trim().replace(/#.*$/, '');
        if (urlKeyForProgress) readKeysForProgress.add(urlKeyForProgress);
      }
    }
    return {
      searches: searchKeysForProgress.size,
      pageReads: readKeysForProgress.size,
      failedSearches: failedSearchesForProgress
    };
  }

  function shouldRequireToolCallForResearchMode(progressForGate, requiredRoundsForGate) {
    const statsForGate = progressForGate || {};
    if ((Number(requiredRoundsForGate) || 0) >= MAX_REQUIRED_ROUNDS_FOR_RESEARCH_MODE) return false;
    if ((statsForGate.searches || 0) === 0 && (statsForGate.failedSearches || 0) >= BROKEN_SEARCH_FAILURES_FOR_RESEARCH_MODE) return false;
    return (statsForGate.searches || 0) < MIN_SEARCHES_FOR_RESEARCH_MODE
      || (statsForGate.pageReads || 0) < MIN_PAGE_READS_FOR_RESEARCH_MODE;
  }

  // Appended to the latest user turn of each request in a research run, never saved with it.
  function instructionsForResearchMode() {
    return [
      '<research_mode>',
      'This block comes from the app, not from the user. The user turned on Deep research for this message, so research it on the web before you answer, even if you think you already know the answer. This overrides the rules about answering from attached context or your own knowledge without a lookup: use attachments and your knowledge as a starting point, not as the answer.',
      '',
      '1. Work out what a complete answer needs: the sub-questions, the facts and figures, and which sources would be authoritative for them (official sites, primary documents, standards, peer-reviewed papers, established news outlets). If the question is about the current page, an open tab or the user\'s notes, read that first.',
      '2. Search with web_search from several angles: at least ' + MIN_SEARCHES_FOR_RESEARCH_MODE + ' distinct queries, usually 4 to 8. Vary the wording, name the primary source, add the year when recency matters, and look for criticism and limitations as well as support.',
      '3. Read the strongest sources with web_fetch: at least ' + MIN_PAGE_READS_FOR_RESEARCH_MODE + ' pages, usually 5 to 10. Give each call a prompt that names exactly what you need from that page. Prefer a primary source to an article about it. A search summary is a lead to follow, not a source to cite.',
      '4. Search again for anything still missing, unclear or disputed.',
      '5. Check each figure, date and claim the answer depends on against a second independent source. Where sources disagree, say so, and say which you find more credible and why.',
      '',
      'You can make several web_search and web_fetch calls in one response when they do not depend on each other.',
      'Do not stop to ask the user a clarifying question. If the request can be read more than one way, research the most likely reading and state that assumption in the answer.',
      'The app will not accept a final answer until at least ' + MIN_SEARCHES_FOR_RESEARCH_MODE + ' searches and ' + MIN_PAGE_READS_FOR_RESEARCH_MODE + ' page reads have succeeded, unless searching keeps failing.',
      '',
      'Then write the answer. Lead with the direct answer, then give the supporting detail under short headings. Cite inline with Markdown links to the pages you read, and end with a Sources list of those pages. Cite only pages that appeared in a tool result in this conversation. Say plainly what you could not verify.',
      'A search summary is another model\'s account of the search results and can be wrong. If a figure or claim in the answer rests only on a search summary, because no page you read with web_fetch states it, say so beside the claim, for example "(from a search summary; not checked against the source)".',
      '</research_mode>'
    ].join('\n');
  }

  nsForResearchMode.researchMode = {
    MIN_SEARCHES: MIN_SEARCHES_FOR_RESEARCH_MODE,
    MIN_PAGE_READS: MIN_PAGE_READS_FOR_RESEARCH_MODE,
    MAX_REQUIRED_ROUNDS: MAX_REQUIRED_ROUNDS_FOR_RESEARCH_MODE,
    BROKEN_SEARCH_FAILURES: BROKEN_SEARCH_FAILURES_FOR_RESEARCH_MODE,
    SEARCH_MODEL: SEARCH_MODEL_FOR_RESEARCH_MODE,
    latestUserMessageIndex: latestUserMessageIndexForResearchMode,
    isResearchRun: isResearchRunForResearchMode,
    progress: progressForResearchMode,
    shouldRequireToolCall: shouldRequireToolCallForResearchMode,
    instructions: instructionsForResearchMode
  };
  globalScopeForResearchMode.ABChatAgent = nsForResearchMode;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForResearchMode.researchMode;
  }
})();
