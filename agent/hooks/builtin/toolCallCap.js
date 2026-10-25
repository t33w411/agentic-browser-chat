(function () {
  const globalScopeForToolCallCap = globalThis;
  const nsForToolCallCap = globalScopeForToolCallCap.ABChatAgent || {};
  if (!nsForToolCallCap.hooks || typeof nsForToolCallCap.hooks.register !== 'function') {
    globalScopeForToolCallCap.ABChatAgent = nsForToolCallCap;
    return;
  }

  // Used when the run does not set turnContext.maxToolCalls. The agent loop sets it from the
  // model's cost tier.
  const DEFAULT_MAX_TOTAL_TOOL_CALLS_PER_SEND_FOR_TOOL_CALL_CAP = 60;

  nsForToolCallCap.hooks.register('PostModelResponse', {
    name: 'tool-call-cap',
    maxFiresPerSend: 1,
    priority: 0,
    handler: async function (payloadForToolCallCap, turnContextForToolCallCap) {
      const toolCallsForCap = (turnContextForToolCallCap && Array.isArray(turnContextForToolCallCap.toolCallsThisTurn))
        ? turnContextForToolCallCap.toolCallsThisTurn
        : [];
      const runLimitForCap = Number(turnContextForToolCallCap && turnContextForToolCallCap.maxToolCalls);
      const limitForCap = runLimitForCap > 0 ? runLimitForCap : DEFAULT_MAX_TOTAL_TOOL_CALLS_PER_SEND_FOR_TOOL_CALL_CAP;
      if (toolCallsForCap.length > limitForCap) {
        return {
          block: {
            code: 'tool-call-limit',
            limit: limitForCap,
            reason: 'Session tool-call limit reached (' + limitForCap
              + ' total). Stopping to prevent runaway execution.'
          }
        };
      }
    }
  });

  globalScopeForToolCallCap.ABChatAgent = nsForToolCallCap;
})();
