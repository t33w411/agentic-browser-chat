(function () {
  const globalScopeForContextMenus = globalThis;
  const existingBackgroundNamespaceForContextMenus = globalScopeForContextMenus.ABChatBackground || {};
  const sharedNamespaceForContextMenus = globalScopeForContextMenus.ABChatShared || {};
  const toolRegistryForContextMenus = sharedNamespaceForContextMenus.toolRegistry;
  const storageManagerForContextMenus = sharedNamespaceForContextMenus.storageManager;

  const menuIdToActionMapForContextMenus = {};

  function resetMenuActionMapForContextMenus() {
    Object.keys(menuIdToActionMapForContextMenus).forEach((menuIdForContextMenus) => {
      delete menuIdToActionMapForContextMenus[menuIdForContextMenus];
    });
  }

  function buildGroupedItemsForContextMenus(itemsForContextMenus) {
    const allItemsForContextMenus = [];
    const groupedByContextForContextMenus = {
      all: [],
      selection: [],
      page: [],
      image: []
    };

    itemsForContextMenus.forEach((itemForContextMenus) => {
      const firstContextForContextMenus = itemForContextMenus.contexts[0];
      if (groupedByContextForContextMenus[firstContextForContextMenus]) {
        groupedByContextForContextMenus[firstContextForContextMenus].push(itemForContextMenus);
      }
    });

    if (groupedByContextForContextMenus.all.length) {
      allItemsForContextMenus.push(...groupedByContextForContextMenus.all);
    }
    if (groupedByContextForContextMenus.selection.length) {
      if (allItemsForContextMenus.length) {
        allItemsForContextMenus.push({ id: "abchat-separator-selection", type: "separator", contexts: ["all"] });
      }
      allItemsForContextMenus.push(...groupedByContextForContextMenus.selection);
    }
    if (groupedByContextForContextMenus.page.length) {
      if (allItemsForContextMenus.length) {
        allItemsForContextMenus.push({ id: "abchat-separator-page", type: "separator", contexts: ["all"] });
      }
      allItemsForContextMenus.push(...groupedByContextForContextMenus.page);
    }
    if (groupedByContextForContextMenus.image.length) {
      allItemsForContextMenus.push(...groupedByContextForContextMenus.image);
    }

    return allItemsForContextMenus;
  }

  async function rebuildContextMenusForContextMenus() {
    if (!toolRegistryForContextMenus || !storageManagerForContextMenus) {
      return false;
    }

    const settingsForContextMenus = await storageManagerForContextMenus.getSettings();
    const menuItemsForContextMenus = toolRegistryForContextMenus.getContextMenuItems(settingsForContextMenus.enabledTools || {});
    const orderedMenuItemsForContextMenus = buildGroupedItemsForContextMenus(menuItemsForContextMenus);

    resetMenuActionMapForContextMenus();

    return new Promise((resolveForContextMenus) => {
      chrome.contextMenus.removeAll(() => {
        orderedMenuItemsForContextMenus.forEach((itemForContextMenus) => {
          const createRequestForContextMenus = {
            id: itemForContextMenus.id,
            contexts: itemForContextMenus.contexts || ["all"],
            type: itemForContextMenus.type || "normal",
            title: itemForContextMenus.type === "separator" ? undefined : itemForContextMenus.title
          };

          if (itemForContextMenus.action) {
            menuIdToActionMapForContextMenus[itemForContextMenus.id] = itemForContextMenus.action;
          }

          chrome.contextMenus.create(createRequestForContextMenus, () => {
            if (chrome.runtime.lastError) {
              if (itemForContextMenus.action) {
                delete menuIdToActionMapForContextMenus[itemForContextMenus.id];
              }
              return;
            }
          });
        });

        resolveForContextMenus(true);
      });
    });
  }

  function deriveActionByMenuIdForContextMenus(menuIdForContextMenus) {
    if (!toolRegistryForContextMenus || typeof toolRegistryForContextMenus.getToolById !== "function") {
      return "";
    }
    if (typeof menuIdForContextMenus !== "string" || !menuIdForContextMenus.startsWith("abchat-")) {
      return "";
    }

    const toolIdForContextMenus = menuIdForContextMenus.slice("abchat-".length);
    if (!toolIdForContextMenus || toolIdForContextMenus.startsWith("separator-")) {
      return "";
    }

    const toolForContextMenus = toolRegistryForContextMenus.getToolById(toolIdForContextMenus);
    if (!toolForContextMenus || !toolForContextMenus.action) {
      return "";
    }
    return toolForContextMenus.action;
  }

  function getActionByMenuIdForContextMenus(menuIdForContextMenus) {
    const menuIdAsStringForContextMenus =
      typeof menuIdForContextMenus === "string" ? menuIdForContextMenus : String(menuIdForContextMenus || "");
    const mappedActionForContextMenus = menuIdToActionMapForContextMenus[menuIdAsStringForContextMenus] || "";
    if (mappedActionForContextMenus) {
      return mappedActionForContextMenus;
    }

    const derivedActionForContextMenus = deriveActionByMenuIdForContextMenus(menuIdAsStringForContextMenus);
    if (derivedActionForContextMenus) {
      menuIdToActionMapForContextMenus[menuIdAsStringForContextMenus] = derivedActionForContextMenus;
      return derivedActionForContextMenus;
    }
    return "";
  }

  globalScopeForContextMenus.ABChatBackground = {
    ...existingBackgroundNamespaceForContextMenus,
    contextMenus: {
      rebuildContextMenus: rebuildContextMenusForContextMenus,
      getActionByMenuId: getActionByMenuIdForContextMenus
    }
  };
})();
