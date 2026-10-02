(function () {
  const globalScopeForApiLogTurns = globalThis;
  const nsForApiLogTurns = globalScopeForApiLogTurns.ABChatContent || {};

  // How a chat log stores the messages sent on each turn of an agent run. Every turn resends the
  // whole conversation so far, the system prompt alone being 39,000 to 51,000 characters, so
  // storing each turn whole made a run of N turns hold its history about N times over. A turn
  // whose earlier messages are exactly the previous turn's is stored as only the messages after
  // them, and the viewer puts the full list back. When compaction or a rewritten system message
  // changes the earlier messages, the turn is stored whole. Loaded by the agent loop (offscreen)
  // and the log viewer (panel); pure, so the CommonJS tail exports it to Node tests.

  function messagesEqualForApiLogTurns(aForEqual, bForEqual) {
    if (aForEqual === bForEqual) return true;
    if (!aForEqual || !bForEqual || typeof aForEqual !== 'object' || typeof bForEqual !== 'object') return false;
    // Long string contents are compared directly, so a 200,000-character tool result is not
    // serialized just to be compared.
    if (typeof aForEqual.content === 'string' || typeof bForEqual.content === 'string') {
      if (aForEqual.content !== bForEqual.content) return false;
      try {
        return JSON.stringify(Object.assign({}, aForEqual, { content: '' })) === JSON.stringify(Object.assign({}, bForEqual, { content: '' }));
      } catch (eForEqual) {
        return false;
      }
    }
    try {
      return JSON.stringify(aForEqual) === JSON.stringify(bForEqual);
    } catch (eForEqual) {
      return false;
    }
  }

  // The fields to store for one turn's request: { requestMessages } in full, or
  // { unchangedPrefixCount, requestMessagesDelta } when the previous turn's messages are exactly
  // its start.
  function encodeTurnRequestForApiLogTurns(previousForEncode, messagesForEncode) {
    if (!Array.isArray(messagesForEncode)) return { requestMessages: messagesForEncode };
    if (!Array.isArray(previousForEncode) || previousForEncode.length === 0 || previousForEncode.length > messagesForEncode.length) {
      return { requestMessages: messagesForEncode };
    }
    for (let iForEncode = 0; iForEncode < previousForEncode.length; iForEncode++) {
      if (!messagesEqualForApiLogTurns(previousForEncode[iForEncode], messagesForEncode[iForEncode])) return { requestMessages: messagesForEncode };
    }
    return { unchangedPrefixCount: previousForEncode.length, requestMessagesDelta: messagesForEncode.slice(previousForEncode.length) };
  }

  // Turns with requestMessages filled back in. A turn that is already whole, or whose earlier turn
  // cannot be rebuilt, is returned as it is.
  function expandTurnsForApiLogTurns(turnsForExpand) {
    if (!Array.isArray(turnsForExpand)) return turnsForExpand;
    let previousForExpand = null;
    return turnsForExpand.map(function (turnForExpand) {
      if (turnForExpand && Array.isArray(turnForExpand.requestMessagesDelta) && Array.isArray(previousForExpand)
          && typeof turnForExpand.unchangedPrefixCount === 'number' && turnForExpand.unchangedPrefixCount <= previousForExpand.length) {
        const expandedForExpand = Object.assign({}, turnForExpand);
        expandedForExpand.requestMessages = previousForExpand.slice(0, turnForExpand.unchangedPrefixCount).concat(turnForExpand.requestMessagesDelta);
        delete expandedForExpand.requestMessagesDelta;
        delete expandedForExpand.unchangedPrefixCount;
        previousForExpand = expandedForExpand.requestMessages;
        return expandedForExpand;
      }
      previousForExpand = turnForExpand && Array.isArray(turnForExpand.requestMessages) ? turnForExpand.requestMessages : null;
      return turnForExpand;
    });
  }

  nsForApiLogTurns.apiLogTurns = {
    messagesEqual: messagesEqualForApiLogTurns,
    encodeTurnRequest: encodeTurnRequestForApiLogTurns,
    expandTurns: expandTurnsForApiLogTurns
  };

  globalScopeForApiLogTurns.ABChatContent = nsForApiLogTurns;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForApiLogTurns.apiLogTurns;
  }
})();
