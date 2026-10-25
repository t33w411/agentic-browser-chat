(function () {
  const globalScopeForBuiltinGuideGate = globalThis;
  const nsForBuiltinGuideGate = globalScopeForBuiltinGuideGate.ABChatAgent || {};
  if (!nsForBuiltinGuideGate.hooks || typeof nsForBuiltinGuideGate.hooks.register !== 'function') {
    globalScopeForBuiltinGuideGate.ABChatAgent = nsForBuiltinGuideGate;
    return;
  }

  // Refuses a tool call covered by a built-in guide until that guide is in the live message window,
  // so the detailed instructions moved out of the tool descriptions are always in front of the model
  // when it uses the tool. The refusal carries the guide, which puts it in the window for the retry.
  // It runs ahead of the other PreToolUse hooks because a block stops the ones after it: a refused
  // call must not use up a counted slot, such as one of image-generation-cap's two per send.
  nsForBuiltinGuideGate.hooks.register('PreToolUse', {
    name: 'builtin-guide-gate',
    priority: 10,
    handler: async function (payloadForBuiltinGuideGate) {
      if (!payloadForBuiltinGuideGate) return;
      const guidesForBuiltinGuideGate = (globalScopeForBuiltinGuideGate.ABChatAgent || {}).builtinGuides;
      if (!guidesForBuiltinGuideGate || typeof guidesForBuiltinGuideGate.gateToolCall !== 'function') return;
      const gateForBuiltinGuideGate = guidesForBuiltinGuideGate.gateToolCall(
        payloadForBuiltinGuideGate.toolName,
        payloadForBuiltinGuideGate.args,
        payloadForBuiltinGuideGate.messages
      );
      if (!gateForBuiltinGuideGate) return;
      return {
        block: {
          reason: gateForBuiltinGuideGate.reason,
          code: 'builtin-guide-required',
          result: { guide: gateForBuiltinGuideGate.guide }
        }
      };
    }
  });

  globalScopeForBuiltinGuideGate.ABChatAgent = nsForBuiltinGuideGate;
})();
