(function () {
  const globalScopeForStorage = globalThis;
  const existingNamespaceForStorage = globalScopeForStorage.ABChatShared || {};
  const toolRegistryForStorage = existingNamespaceForStorage.toolRegistry;

  const storageKeysForStorage = {
    settings: "abchatSettings",
    lastCopyMeta: "abchatLastCopyMeta"
  };

  function getDefaultSettingsForStorage() {
    const enabledToolsFromRegistryForStorage = toolRegistryForStorage
      ? toolRegistryForStorage.getDefaultEnabledMap()
      : {};

    return {
      enabledTools: enabledToolsFromRegistryForStorage,
      agentRules: "",
      agentRulesUpdatedAt: 0,
      toastDurationMs: 1700,
      deleteChatsOlderThanDays: null,
      alertSound: true,
      reminderLeadTime: 15
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
        resolveForStorage(false);
        return;
      }

      storeForStorage.set({ [keyForStorage]: valueForStorage }, () => {
        resolveForStorage(!chrome.runtime.lastError);
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

  function mergeSettingsForStorage(baseSettingsForStorage, patchSettingsForStorage) {
    const safeBaseSettingsForStorage = baseSettingsForStorage || getDefaultSettingsForStorage();
    const safePatchSettingsForStorage = patchSettingsForStorage || {};

    const baseAgentRulesForStorage = safeBaseSettingsForStorage.agentRules || "";
    const baseAgentRulesUpdatedAtForStorage =
      typeof safeBaseSettingsForStorage.agentRulesUpdatedAt === "number"
        ? safeBaseSettingsForStorage.agentRulesUpdatedAt
        : 0;
    const patchHasAgentRulesForStorage = typeof safePatchSettingsForStorage.agentRules === "string";
    const nextAgentRulesForStorage = patchHasAgentRulesForStorage
      ? safePatchSettingsForStorage.agentRules
      : baseAgentRulesForStorage;
    let nextAgentRulesUpdatedAtForStorage;
    if (typeof safePatchSettingsForStorage.agentRulesUpdatedAt === "number") {
      nextAgentRulesUpdatedAtForStorage = safePatchSettingsForStorage.agentRulesUpdatedAt;
    } else if (patchHasAgentRulesForStorage && nextAgentRulesForStorage !== baseAgentRulesForStorage) {
      nextAgentRulesUpdatedAtForStorage = Date.now();
    } else {
      nextAgentRulesUpdatedAtForStorage = baseAgentRulesUpdatedAtForStorage;
    }

    return {
      enabledTools: {
        ...(safeBaseSettingsForStorage.enabledTools || {}),
        ...(safePatchSettingsForStorage.enabledTools || {})
      },
      agentRules: nextAgentRulesForStorage,
      agentRulesUpdatedAt: nextAgentRulesUpdatedAtForStorage,
      toastDurationMs:
        typeof safePatchSettingsForStorage.toastDurationMs === "number"
          ? safePatchSettingsForStorage.toastDurationMs
          : safeBaseSettingsForStorage.toastDurationMs,
      deleteChatsOlderThanDays:
        typeof safePatchSettingsForStorage.deleteChatsOlderThanDays === "number" ||
        safePatchSettingsForStorage.deleteChatsOlderThanDays === null
          ? safePatchSettingsForStorage.deleteChatsOlderThanDays
          : safeBaseSettingsForStorage.deleteChatsOlderThanDays,
      alertSound:
        typeof safePatchSettingsForStorage.alertSound === "boolean"
          ? safePatchSettingsForStorage.alertSound
          : safeBaseSettingsForStorage.alertSound,
      reminderLeadTime:
        typeof safePatchSettingsForStorage.reminderLeadTime === "number"
          ? safePatchSettingsForStorage.reminderLeadTime
          : safeBaseSettingsForStorage.reminderLeadTime
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

  async function saveSettingsForStorage(nextSettingsForStorage) {
    const existingSettingsForStorage = await getSettingsForStorage();
    const mergedSettingsForStorage = mergeSettingsForStorage(existingSettingsForStorage, nextSettingsForStorage || {});
    await setToStoreForStorage(getSyncStoreForStorage(), storageKeysForStorage.settings, mergedSettingsForStorage);
    return mergedSettingsForStorage;
  }

  async function saveLastCopyMetaForStorage(lastCopyMetaForStorage) {
    if (!lastCopyMetaForStorage || typeof lastCopyMetaForStorage !== "object") {
      return false;
    }

    return setToStoreForStorage(getLocalStoreForStorage(), storageKeysForStorage.lastCopyMeta, lastCopyMetaForStorage);
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

    await setToStoreForStorage(getSyncStoreForStorage(), storageKeysForStorage.settings, sanitizedPayloadForStorage.settings);
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
      getDefaultSettings: getDefaultSettingsForStorage,
      getSettings: getSettingsForStorage,
      saveSettings: saveSettingsForStorage,
      saveLastCopyMeta: saveLastCopyMetaForStorage,
      getLastCopyMeta: getLastCopyMetaForStorage,
      exportAll: exportAllForStorage,
      importAll: importAllForStorage,
      resetAll: resetAllForStorage,
      normalizeHostname: normalizeHostnameForStorage
    }
  };
})();
