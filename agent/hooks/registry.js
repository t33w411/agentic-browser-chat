(function () {
  const globalScopeForHooksRegistry = globalThis;
  const nsForHooksRegistry = globalScopeForHooksRegistry.ABChatAgent || {};

  const VALID_EVENTS_FOR_HOOKS = new Set([
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostModelResponse',
    'Stop'
  ]);

  const PERMITTED_RETURN_KEYS_FOR_HOOKS = {
    UserPromptSubmit:  { block: true,  continueWithSystemNote: false, annotate: true },
    PreToolUse:        { block: true,  continueWithSystemNote: false, annotate: true },
    PostToolUse:       { block: false, continueWithSystemNote: false, annotate: true },
    PostModelResponse: { block: true,  continueWithSystemNote: true,  annotate: true },
    Stop:              { block: true,  continueWithSystemNote: true,  annotate: true }
  };

  const registryByEventForHooks = new Map();

  function ensureEventMapForHooks(eventNameForHooks) {
    let mapForHooks = registryByEventForHooks.get(eventNameForHooks);
    if (!mapForHooks) {
      mapForHooks = new Map();
      registryByEventForHooks.set(eventNameForHooks, mapForHooks);
    }
    return mapForHooks;
  }

  function registerForHooks(eventNameForHooks, optsForHooks) {
    if (!VALID_EVENTS_FOR_HOOKS.has(eventNameForHooks)) {
      throw new Error('[ABChatAgent.hooks] Unknown event: ' + eventNameForHooks);
    }
    if (!optsForHooks || typeof optsForHooks.name !== 'string' || !optsForHooks.name) {
      throw new Error('[ABChatAgent.hooks] register requires opts.name (string)');
    }
    if (typeof optsForHooks.handler !== 'function') {
      throw new Error('[ABChatAgent.hooks] register requires opts.handler (function)');
    }
    const entryForHooks = {
      name: optsForHooks.name,
      handler: optsForHooks.handler,
      maxFiresPerSend: Number.isFinite(optsForHooks.maxFiresPerSend) ? optsForHooks.maxFiresPerSend : Infinity,
      priority: Number.isFinite(optsForHooks.priority) ? optsForHooks.priority : 0
    };
    ensureEventMapForHooks(eventNameForHooks).set(optsForHooks.name, entryForHooks);
  }

  function unregisterForHooks(eventNameForHooks, hookNameForHooks) {
    const mapForHooks = registryByEventForHooks.get(eventNameForHooks);
    if (mapForHooks) mapForHooks.delete(hookNameForHooks);
  }

  function listHandlersForHooks(eventNameForHooks) {
    const mapForHooks = registryByEventForHooks.get(eventNameForHooks);
    if (!mapForHooks) return [];
    return Array.from(mapForHooks.values()).sort(function (aForHooks, bForHooks) {
      return (bForHooks.priority || 0) - (aForHooks.priority || 0);
    });
  }

  function createTurnContextForHooks(optsForHooks) {
    const optsObjForHooks = optsForHooks || {};
    return {
      chatId: optsObjForHooks.chatId,
      sendId: optsObjForHooks.sendId || ('snd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
      userText: typeof optsObjForHooks.userText === 'string' ? optsObjForHooks.userText : '',
      iterIndex: 0,
      toolCallsThisTurn: [],
      annotations: {},
      firedCounts: new Map()
    };
  }

  function isPlainObjectForHooks(valueForHooks) {
    return valueForHooks !== null && typeof valueForHooks === 'object' && !Array.isArray(valueForHooks);
  }

  const VERBOSE_LS_KEY_FOR_HOOKS = 'abchat-hooks-verbose';

  function isVerboseForHooks() {
    try {
      return !!(globalScopeForHooksRegistry.localStorage
        && globalScopeForHooksRegistry.localStorage.getItem(VERBOSE_LS_KEY_FOR_HOOKS) === '1');
    } catch (verboseReadErrorForHooks) {
      return false;
    }
  }

  function setVerboseForHooks(enabledForHooks) {
    try {
      if (!globalScopeForHooksRegistry.localStorage) return false;
      if (enabledForHooks) {
        globalScopeForHooksRegistry.localStorage.setItem(VERBOSE_LS_KEY_FOR_HOOKS, '1');
      } else {
        globalScopeForHooksRegistry.localStorage.removeItem(VERBOSE_LS_KEY_FOR_HOOKS);
      }
      return true;
    } catch (verboseWriteErrorForHooks) {
      return false;
    }
  }

  async function dispatchForHooks(eventNameForHooks, payloadForHooks, turnContextForHooks) {
    if (!VALID_EVENTS_FOR_HOOKS.has(eventNameForHooks)) {
      return { block: null, continueWithSystemNote: null, annotate: null, firings: [] };
    }
    const handlersForHooks = listHandlersForHooks(eventNameForHooks);
    const firingsForHooks = [];
    const combinedForHooks = { block: null, continueWithSystemNote: null, annotate: null };
    const permittedKeysForHooks = PERMITTED_RETURN_KEYS_FOR_HOOKS[eventNameForHooks] || {};
    const verboseModeForHooks = isVerboseForHooks();

    for (let iForHooks = 0; iForHooks < handlersForHooks.length; iForHooks++) {
      const handlerEntryForHooks = handlersForHooks[iForHooks];
      const firedSoFarForHooks = (turnContextForHooks && turnContextForHooks.firedCounts)
        ? (turnContextForHooks.firedCounts.get(handlerEntryForHooks.name) || 0)
        : 0;
      if (firedSoFarForHooks >= handlerEntryForHooks.maxFiresPerSend) {
        if (verboseModeForHooks) {
          firingsForHooks.push({
            name: handlerEntryForHooks.name,
            event: eventNameForHooks,
            skipped: 'maxFiresPerSend',
            firedCount: firedSoFarForHooks,
            limit: handlerEntryForHooks.maxFiresPerSend
          });
        }
        continue;
      }

      let returnedForHooks;
      try {
        returnedForHooks = await handlerEntryForHooks.handler(payloadForHooks, turnContextForHooks);
      } catch (handlerErrorForHooks) {
        firingsForHooks.push({
          name: handlerEntryForHooks.name,
          event: eventNameForHooks,
          error: String(handlerErrorForHooks && handlerErrorForHooks.message ? handlerErrorForHooks.message : handlerErrorForHooks)
        });
        continue;
      }

      if (!isPlainObjectForHooks(returnedForHooks)) {
        if (verboseModeForHooks) {
          firingsForHooks.push({
            name: handlerEntryForHooks.name,
            event: eventNameForHooks,
            noop: true
          });
        }
        continue;
      }

      if (turnContextForHooks && turnContextForHooks.firedCounts) {
        turnContextForHooks.firedCounts.set(handlerEntryForHooks.name, firedSoFarForHooks + 1);
      }

      const summaryForHooks = { name: handlerEntryForHooks.name, event: eventNameForHooks };

      if (permittedKeysForHooks.annotate && isPlainObjectForHooks(returnedForHooks.annotate)) {
        if (turnContextForHooks && turnContextForHooks.annotations) {
          Object.assign(turnContextForHooks.annotations, returnedForHooks.annotate);
        }
        combinedForHooks.annotate = Object.assign(combinedForHooks.annotate || {}, returnedForHooks.annotate);
        summaryForHooks.annotateKeys = Object.keys(returnedForHooks.annotate);
      }

      if (permittedKeysForHooks.continueWithSystemNote
          && typeof returnedForHooks.continueWithSystemNote === 'string'
          && returnedForHooks.continueWithSystemNote.trim()) {
        const noteTextForHooks = returnedForHooks.continueWithSystemNote.trim();
        combinedForHooks.continueWithSystemNote = combinedForHooks.continueWithSystemNote
          ? combinedForHooks.continueWithSystemNote + '\n\n' + noteTextForHooks
          : noteTextForHooks;
        summaryForHooks.continueWithSystemNote = true;
      }

      if (permittedKeysForHooks.block
          && isPlainObjectForHooks(returnedForHooks.block)
          && typeof returnedForHooks.block.reason === 'string'
          && returnedForHooks.block.reason) {
        combinedForHooks.block = { reason: returnedForHooks.block.reason };
        summaryForHooks.block = true;
        firingsForHooks.push(summaryForHooks);
        break;
      }

      firingsForHooks.push(summaryForHooks);
    }

    return Object.assign({}, combinedForHooks, { firings: firingsForHooks });
  }

  nsForHooksRegistry.hooks = {
    register: registerForHooks,
    unregister: unregisterForHooks,
    dispatch: dispatchForHooks,
    listHandlers: listHandlersForHooks,
    createTurnContext: createTurnContextForHooks,
    isVerbose: isVerboseForHooks,
    setVerbose: setVerboseForHooks,
    EVENTS: Array.from(VALID_EVENTS_FOR_HOOKS)
  };

  globalScopeForHooksRegistry.ABChatAgent = nsForHooksRegistry;
})();
