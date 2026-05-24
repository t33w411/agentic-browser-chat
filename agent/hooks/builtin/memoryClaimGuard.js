(function () {
  const globalScopeForMemoryClaimGuard = globalThis;
  const nsForMemoryClaimGuard = globalScopeForMemoryClaimGuard.ABChatAgent || {};
  if (!nsForMemoryClaimGuard.hooks || typeof nsForMemoryClaimGuard.hooks.register !== 'function') {
    globalScopeForMemoryClaimGuard.ABChatAgent = nsForMemoryClaimGuard;
    return;
  }

  // Triggers the guard when the user asks for something to be remembered/saved.
  const SLASH_REMEMBER_RX_FOR_MEMORY_CLAIM_GUARD = /^\s*\/remember\b/i;
  const MEMORY_INTENT_RX_FOR_MEMORY_CLAIM_GUARD = /\b(remember\s+(this|that|to|the|my|so|when|how|i|we|you'?re|you\s+(should|need|must))|save\s+(this|that|it)\s+(to\s+)?(memory|as\s+a?\s*(skill|note))|keep\s+(a\s+)?note\s+of|note\s+this\s+down|don'?t\s+forget|make\s+(a\s+)?note\s+of|add\s+(this|that)\s+to\s+(memory|notes|your\s+memory))\b/i;
  // Triggers the guard when the assistant claims it remembered/saved/noted/stored something.
  const MEMORY_CLAIM_RX_FOR_MEMORY_CLAIM_GUARD = /((i'?ve|i\s+have|i'?ll|i\s+will)\s+(updated|saved|added|stored|noted|remembered|save|remember|store|add|note|keep)\s+(this|that|it)(\s+(to|in|as|for)\s+(a\s+)?(my\s+|your\s+)?(memory|skills?|future\s+reference))?|(i'?ve|i\s+have)\s+(updated|saved|added)\s+(to\s+)?(my|your)?\s*(memory|skills?)|saved\s+as\s+(a\s+)?skill|memory\s+updated)/i;

  function userIntentExpectsMemoryActionForMemoryClaimGuard(userTextForMemoryClaimGuard) {
    if (!userTextForMemoryClaimGuard) return false;
    const stringForMemoryClaimGuard = String(userTextForMemoryClaimGuard);
    return SLASH_REMEMBER_RX_FOR_MEMORY_CLAIM_GUARD.test(stringForMemoryClaimGuard)
      || MEMORY_INTENT_RX_FOR_MEMORY_CLAIM_GUARD.test(stringForMemoryClaimGuard);
  }

  function assistantClaimsMemoryActionForMemoryClaimGuard(assistantTextForMemoryClaimGuard) {
    if (!assistantTextForMemoryClaimGuard) return false;
    return MEMORY_CLAIM_RX_FOR_MEMORY_CLAIM_GUARD.test(String(assistantTextForMemoryClaimGuard));
  }

  // Returns 'memory' / 'skill' / null. Kept in sync with the panel renderer's badge logic
  // in panel/panelRuntime.js (search "classifyToolCallForMemoryGuardForPanelRuntime").
  function classifyMemoryToolCallForMemoryClaimGuard(toolCallForMemoryClaimGuard) {
    if (!toolCallForMemoryClaimGuard || !toolCallForMemoryClaimGuard.function) return null;
    const nameForMemoryClaimGuard = toolCallForMemoryClaimGuard.function.name;
    if (nameForMemoryClaimGuard !== 'memory' && nameForMemoryClaimGuard !== 'skill') return null;
    let argsForMemoryClaimGuard = {};
    try {
      argsForMemoryClaimGuard = JSON.parse(toolCallForMemoryClaimGuard.function.arguments || '{}');
    } catch (parseErrorForMemoryClaimGuard) {
      argsForMemoryClaimGuard = {};
    }
    const opForMemoryClaimGuard = argsForMemoryClaimGuard && typeof argsForMemoryClaimGuard.operation === 'string'
      ? argsForMemoryClaimGuard.operation
      : '';
    if (nameForMemoryClaimGuard === 'memory') {
      return (opForMemoryClaimGuard === 'upsert' || opForMemoryClaimGuard === 'delete_entry') ? 'memory' : null;
    }
    if (nameForMemoryClaimGuard === 'skill') {
      return (opForMemoryClaimGuard === 'create' || opForMemoryClaimGuard === 'update' || opForMemoryClaimGuard === 'delete') ? 'skill' : null;
    }
    return null;
  }

  function memoryOrSkillWriteHappenedThisTurnForMemoryClaimGuard(turnContextForMemoryClaimGuard) {
    const toolCallsForMemoryClaimGuard = (turnContextForMemoryClaimGuard && turnContextForMemoryClaimGuard.toolCallsThisTurn) || [];
    for (let iForMemoryClaimGuard = 0; iForMemoryClaimGuard < toolCallsForMemoryClaimGuard.length; iForMemoryClaimGuard++) {
      if (classifyMemoryToolCallForMemoryClaimGuard(toolCallsForMemoryClaimGuard[iForMemoryClaimGuard])) return true;
    }
    return false;
  }

  nsForMemoryClaimGuard.hooks.register('Stop', {
    name: 'memory-claim-guard',
    maxFiresPerSend: 1,
    priority: 0,
    handler: async function (payloadForMemoryClaimGuard, turnContextForMemoryClaimGuard) {
      const userTextForHandler = turnContextForMemoryClaimGuard && turnContextForMemoryClaimGuard.userText
        ? turnContextForMemoryClaimGuard.userText
        : '';
      const assistantTextForHandler = payloadForMemoryClaimGuard && payloadForMemoryClaimGuard.assistantMessage
        ? (payloadForMemoryClaimGuard.assistantMessage.content || '')
        : '';
      const userExpectsForHandler = userIntentExpectsMemoryActionForMemoryClaimGuard(userTextForHandler);
      const assistantClaimsForHandler = assistantClaimsMemoryActionForMemoryClaimGuard(assistantTextForHandler);
      if (!userExpectsForHandler && !assistantClaimsForHandler) return;
      if (memoryOrSkillWriteHappenedThisTurnForMemoryClaimGuard(turnContextForMemoryClaimGuard)) return;

      const reasonPrefixForHandler = assistantClaimsForHandler
        ? 'Your previous reply claimed to have remembered, saved, or noted something, but you did not call the memory or skill tool this turn.'
        : 'The user asked you to remember or save something, but you did not call the memory or skill tool this turn.';
      return {
        continueWithSystemNote: reasonPrefixForHandler
          + ' Either call the memory tool (operation: upsert) for a brief fact or the skill tool (operation: create) for a detailed procedure now to actually perform the action, or send a corrected final reply that does not claim an action you did not perform. Never write confirmations like "I\'ve updated my memory" or "Saved as skill" unless you invoked the corresponding tool in the same turn.'
      };
    }
  });

  globalScopeForMemoryClaimGuard.ABChatAgent = nsForMemoryClaimGuard;
})();
