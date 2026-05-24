(function () {
  const globalScopeForImageGenerationCap = globalThis;
  const nsForImageGenerationCap = globalScopeForImageGenerationCap.ABChatAgent || {};
  if (!nsForImageGenerationCap.hooks || typeof nsForImageGenerationCap.hooks.register !== 'function') {
    globalScopeForImageGenerationCap.ABChatAgent = nsForImageGenerationCap;
    return;
  }

  const MAX_IMAGE_GENERATIONS_PER_SEND_FOR_IMAGE_GENERATION_CAP = 2;

  nsForImageGenerationCap.hooks.register('PreToolUse', {
    name: 'image-generation-cap',
    priority: 0,
    handler: async function (payloadForImageGenerationCap, turnContextForImageGenerationCap) {
      if (!payloadForImageGenerationCap || payloadForImageGenerationCap.toolName !== 'generate_image') return;
      if (!turnContextForImageGenerationCap || !turnContextForImageGenerationCap.annotations) return;
      const annotationsForImageGenerationCap = turnContextForImageGenerationCap.annotations;
      const currentSlotsUsedForImageGenerationCap = Number(annotationsForImageGenerationCap.imageGenSlotsUsed) || 0;
      if (currentSlotsUsedForImageGenerationCap >= MAX_IMAGE_GENERATIONS_PER_SEND_FOR_IMAGE_GENERATION_CAP) {
        return {
          block: {
            reason: 'Maximum of ' + MAX_IMAGE_GENERATIONS_PER_SEND_FOR_IMAGE_GENERATION_CAP
              + ' image generations per send reached. Do not call generate_image again.'
          }
        };
      }
      annotationsForImageGenerationCap.imageGenSlotsUsed = currentSlotsUsedForImageGenerationCap + 1;
    }
  });

  globalScopeForImageGenerationCap.ABChatAgent = nsForImageGenerationCap;
})();
