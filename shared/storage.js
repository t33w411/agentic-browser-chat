(function () {
  const globalScopeForStorage = globalThis;
  const existingNamespaceForStorage = globalScopeForStorage.ABChatShared || {};
  const toolRegistryForStorage = existingNamespaceForStorage.toolRegistry;

  const storageKeysForStorage = {
    settings: "abchatSettings",
    lastCopyMeta: "abchatLastCopyMeta"
  };

  // Every setting shares one chrome.storage.sync item, which Chrome caps at 8,192 bytes. The two
  // free-text profile fields are the only ones that can grow, so they are capped well inside that
  // budget: 2 x 2,500 chars leaves room for the rest of the object plus JSON/UTF-8 expansion.
  const MAX_PROFILE_TEXT_CHARS_FOR_STORAGE = 2500;

  function clampProfileTextForStorage(valueForStorage) {
    const textForStorage = typeof valueForStorage === "string" ? valueForStorage : "";
    if (textForStorage.length <= MAX_PROFILE_TEXT_CHARS_FOR_STORAGE) {
      return textForStorage;
    }
    return textForStorage.slice(0, MAX_PROFILE_TEXT_CHARS_FOR_STORAGE);
  }

  function getDefaultSettingsForStorage() {
    const enabledToolsFromRegistryForStorage = toolRegistryForStorage
      ? toolRegistryForStorage.getDefaultEnabledMap()
      : {};

    return {
      enabledTools: enabledToolsFromRegistryForStorage,
      aboutUser: "",
      aboutUserUpdatedAt: 0,
      aboutUserEnabled: true,
      agentRules: "",
      agentRulesUpdatedAt: 0,
      agentRulesEnabled: true,
      toastDurationMs: 1700,
      deleteChatsOlderThanDays: null,
      // Clips are page grabs kept for reuse. Unlike chats there is no "never": the sweep
      // always runs, capped at 30 days, and starred clips are what survives it.
      deleteClipsOlderThanDays: 7,
      alertSound: true,
      reminderLeadTime: 15,
      sendPageContext: true,
      ttsEngine: "browser"
    };
  }

  function getSyncStoreForStorage() {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      return null;
    }
    return chrome.storage.sync;
  }

  function getLocalStoreForStorage() {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      return null;
    }
    return chrome.storage.local;
  }

  function getFromStoreForStorage(storeForStorage, keyForStorage) {
    return new Promise((resolveForStorage) => {
      if (!storeForStorage) {
        resolveForStorage(null);
        return;
      }

      storeForStorage.get([keyForStorage], (resultForStorage) => {
        resolveForStorage(resultForStorage ? resultForStorage[keyForStorage] : null);
      });
    });
  }

  function setToStoreForStorage(storeForStorage, keyForStorage, valueForStorage) {
    return new Promise((resolveForStorage) => {
      if (!storeForStorage) {
        resolveForStorage({ ok: false, error: "Storage is unavailable." });
        return;
      }

      storeForStorage.set({ [keyForStorage]: valueForStorage }, () => {
        const lastErrorForStorage = chrome.runtime.lastError;
        resolveForStorage({
          ok: !lastErrorForStorage,
          error: lastErrorForStorage ? lastErrorForStorage.message || "Storage write failed." : ""
        });
      });
    });
  }

  function removeFromStoreForStorage(storeForStorage, keyForStorage) {
    return new Promise((resolveForStorage) => {
      if (!storeForStorage) {
        resolveForStorage(false);
        return;
      }

      storeForStorage.remove([keyForStorage], () => {
        resolveForStorage(!chrome.runtime.lastError);
      });
    });
  }

  // Text plus an updatedAt token used for cross-tab stale-save detection. The timestamp moves only
  // when the text itself changes, so writing an unrelated setting (an enabled toggle, say) never
  // looks like an edit to another tab holding unsaved changes.
  function mergeProfileTextForStorage(
    baseSettingsForMerge,
    patchSettingsForMerge,
    textKeyForMerge,
    timestampKeyForMerge
  ) {
    const baseTextForMerge = clampProfileTextForStorage(baseSettingsForMerge[textKeyForMerge]);
    const baseTimestampForMerge =
      typeof baseSettingsForMerge[timestampKeyForMerge] === "number"
        ? baseSettingsForMerge[timestampKeyForMerge]
        : 0;
    const patchHasTextForMerge = typeof patchSettingsForMerge[textKeyForMerge] === "string";
    const nextTextForMerge = patchHasTextForMerge
      ? clampProfileTextForStorage(patchSettingsForMerge[textKeyForMerge])
      : baseTextForMerge;

    let nextTimestampForMerge;
    if (typeof patchSettingsForMerge[timestampKeyForMerge] === "number") {
      nextTimestampForMerge = patchSettingsForMerge[timestampKeyForMerge];
    } else if (patchHasTextForMerge && nextTextForMerge !== baseTextForMerge) {
      nextTimestampForMerge = Date.now();
    } else {
      nextTimestampForMerge = baseTimestampForMerge;
    }

    return { text: nextTextForMerge, updatedAt: nextTimestampForMerge };
  }

  function mergeBooleanForStorage(baseValueForMerge, patchValueForMerge, fallbackValueForMerge) {
    if (typeof patchValueForMerge === "boolean") {
      return patchValueForMerge;
    }
    if (typeof baseValueForMerge === "boolean") {
      return baseValueForMerge;
    }
    return fallbackValueForMerge;
  }

  function mergeSettingsForStorage(baseSettingsForStorage, patchSettingsForStorage) {
    const safeBaseSettingsForStorage = baseSettingsForStorage || getDefaultSettingsForStorage();
    const safePatchSettingsForStorage = patchSettingsForStorage || {};

    const mergedAboutUserForStorage = mergeProfileTextForStorage(
      safeBaseSettingsForStorage,
      safePatchSettingsForStorage,
      "aboutUser",
      "aboutUserUpdatedAt"
    );
    const mergedAgentRulesForStorage = mergeProfileTextForStorage(
      safeBaseSettingsForStorage,
      safePatchSettingsForStorage,
      "agentRules",
      "agentRulesUpdatedAt"
    );

    return {
      enabledTools: {
        ...(safeBaseSettingsForStorage.enabledTools || {}),
        ...(safePatchSettingsForStorage.enabledTools || {})
      },
      aboutUser: mergedAboutUserForStorage.text,
      aboutUserUpdatedAt: mergedAboutUserForStorage.updatedAt,
      aboutUserEnabled: mergeBooleanForStorage(
        safeBaseSettingsForStorage.aboutUserEnabled,
        safePatchSettingsForStorage.aboutUserEnabled,
        true
      ),
      agentRules: mergedAgentRulesForStorage.text,
      agentRulesUpdatedAt: mergedAgentRulesForStorage.updatedAt,
      agentRulesEnabled: mergeBooleanForStorage(
        safeBaseSettingsForStorage.agentRulesEnabled,
        safePatchSettingsForStorage.agentRulesEnabled,
        true
      ),
      toastDurationMs:
        typeof safePatchSettingsForStorage.toastDurationMs === "number"
          ? safePatchSettingsForStorage.toastDurationMs
          : safeBaseSettingsForStorage.toastDurationMs,
      deleteChatsOlderThanDays:
        typeof safePatchSettingsForStorage.deleteChatsOlderThanDays === "number" ||
        safePatchSettingsForStorage.deleteChatsOlderThanDays === null
          ? safePatchSettingsForStorage.deleteChatsOlderThanDays
          : safeBaseSettingsForStorage.deleteChatsOlderThanDays,
      deleteClipsOlderThanDays:
        typeof safePatchSettingsForStorage.deleteClipsOlderThanDays === "number"
          ? safePatchSettingsForStorage.deleteClipsOlderThanDays
          : safeBaseSettingsForStorage.deleteClipsOlderThanDays,
      alertSound:
        typeof safePatchSettingsForStorage.alertSound === "boolean"
          ? safePatchSettingsForStorage.alertSound
          : safeBaseSettingsForStorage.alertSound,
      reminderLeadTime:
        typeof safePatchSettingsForStorage.reminderLeadTime === "number"
          ? safePatchSettingsForStorage.reminderLeadTime
          : safeBaseSettingsForStorage.reminderLeadTime,
      sendPageContext:
        typeof safePatchSettingsForStorage.sendPageContext === "boolean"
          ? safePatchSettingsForStorage.sendPageContext
          : safeBaseSettingsForStorage.sendPageContext,
      ttsEngine:
        safePatchSettingsForStorage.ttsEngine === "browser" ||
        safePatchSettingsForStorage.ttsEngine === "openrouter"
          ? safePatchSettingsForStorage.ttsEngine
          : safeBaseSettingsForStorage.ttsEngine
    };
  }

  function normalizeHostnameForStorage(hostnameForStorage) {
    if (!hostnameForStorage || typeof hostnameForStorage !== "string") {
      return "";
    }
    return hostnameForStorage.trim().toLowerCase();
  }

  async function getSettingsForStorage() {
    const storedSettingsForStorage = await getFromStoreForStorage(
      getSyncStoreForStorage(),
      storageKeysForStorage.settings
    );
    return mergeSettingsForStorage(getDefaultSettingsForStorage(), storedSettingsForStorage || {});
  }

  // Reports whether the write actually landed. sync has a hard 8,192-byte-per-item cap, so a write
  // can fail (quota, storage unavailable) with nothing thrown; callers that show the user a result
  // must use this rather than assume success.
  async function saveSettingsWithStatusForStorage(nextSettingsForStorage) {
    const existingSettingsForStorage = await getSettingsForStorage();
    const mergedSettingsForStorage = mergeSettingsForStorage(existingSettingsForStorage, nextSettingsForStorage || {});
    const writeResultForStorage = await setToStoreForStorage(
      getSyncStoreForStorage(),
      storageKeysForStorage.settings,
      mergedSettingsForStorage
    );

    return {
      ok: writeResultForStorage.ok,
      error: writeResultForStorage.error,
      settings: writeResultForStorage.ok ? mergedSettingsForStorage : existingSettingsForStorage
    };
  }

  async function saveSettingsForStorage(nextSettingsForStorage) {
    const saveResultForStorage = await saveSettingsWithStatusForStorage(nextSettingsForStorage);
    return saveResultForStorage.settings;
  }

  async function saveLastCopyMetaForStorage(lastCopyMetaForStorage) {
    if (!lastCopyMetaForStorage || typeof lastCopyMetaForStorage !== "object") {
      return false;
    }

    const writeResultForLastCopy = await setToStoreForStorage(
      getLocalStoreForStorage(),
      storageKeysForStorage.lastCopyMeta,
      lastCopyMetaForStorage
    );
    return writeResultForLastCopy.ok;
  }

  async function getLastCopyMetaForStorage() {
    const storedLastCopyMetaForStorage = await getFromStoreForStorage(
      getLocalStoreForStorage(),
      storageKeysForStorage.lastCopyMeta
    );
    return storedLastCopyMetaForStorage || null;
  }

  async function exportAllForStorage() {
    const exportedSettingsForStorage = await getSettingsForStorage();

    return {
      version: 1,
      settings: exportedSettingsForStorage
    };
  }

  function sanitizeImportPayloadForStorage(payloadForStorage) {
    if (!payloadForStorage || typeof payloadForStorage !== "object") {
      return null;
    }

    const incomingSettingsForStorage = payloadForStorage.settings || {};
    const cleanedSettingsForStorage = mergeSettingsForStorage(getDefaultSettingsForStorage(), incomingSettingsForStorage);

    return {
      settings: cleanedSettingsForStorage
    };
  }

  async function importAllForStorage(payloadForStorage) {
    const sanitizedPayloadForStorage = sanitizeImportPayloadForStorage(payloadForStorage);
    if (!sanitizedPayloadForStorage) {
      return { ok: false, error: "Invalid import payload." };
    }

    const writeResultForImport = await setToStoreForStorage(
      getSyncStoreForStorage(),
      storageKeysForStorage.settings,
      sanitizedPayloadForStorage.settings
    );
    if (!writeResultForImport.ok) {
      return { ok: false, error: writeResultForImport.error || "Could not save the imported settings." };
    }
    return { ok: true };
  }

  async function resetAllForStorage() {
    await removeFromStoreForStorage(getSyncStoreForStorage(), storageKeysForStorage.settings);
    return { ok: true };
  }

  globalScopeForStorage.ABChatShared = {
    ...existingNamespaceForStorage,
    storageKeys: storageKeysForStorage,
    storageManager: {
      maxProfileTextChars: MAX_PROFILE_TEXT_CHARS_FOR_STORAGE,
      getDefaultSettings: getDefaultSettingsForStorage,
      getSettings: getSettingsForStorage,
      saveSettings: saveSettingsForStorage,
      saveSettingsWithStatus: saveSettingsWithStatusForStorage,
      saveLastCopyMeta: saveLastCopyMetaForStorage,
      getLastCopyMeta: getLastCopyMetaForStorage,
      exportAll: exportAllForStorage,
      importAll: importAllForStorage,
      resetAll: resetAllForStorage,
      normalizeHostname: normalizeHostnameForStorage
    }
  };
})();
