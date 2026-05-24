(function () {
  const globalScopeForToolCallCap = globalThis;
  const nsForToolCallCap = globalScopeForToolCallCap.ABChatAgent || {};
  if (!nsForToolCallCap.hooks || typeof nsForToolCallCap.hooks.register !== 'function') {
    globalScopeForToolCallCap.ABChatAgent = nsForToolCallCap;
    return;
  }

  const MAX_TOTAL_TOOL_CALLS_PER_SEND_FOR_TOOL_CALL_CAP = 40;

  nsForToolCallCap.hooks.register('PostModelResponse', {
    name: 'tool-call-cap',
    maxFiresPerSend: 1,
    priority: 0,
    handler: async function (payloadForToolCallCap, turnContextForToolCallCap) {
      const toolCallsForCap = (turnContextForToolCallCap && Array.isArray(turnContextForToolCallCap.toolCallsThisTurn))
        ? turnContextForToolCallCap.toolCallsThisTurn
        : [];
      if (toolCallsForCap.length > MAX_TOTAL_TOOL_CALLS_PER_SEND_FOR_TOOL_CALL_CAP) {
        return {
          block: {
            reason: 'Session tool-call limit reached (' + MAX_TOTAL_TOOL_CALLS_PER_SEND_FOR_TOOL_CALL_CAP
              + ' total). Stopping to prevent runaway execution.'
          }
        };
      }
    }
  });

  globalScopeForToolCallCap.ABChatAgent = nsForToolCallCap;
})();
