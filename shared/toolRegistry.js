(function () {
  const globalScopeForRegistry = globalThis;
  const existingNamespaceForRegistry = globalScopeForRegistry.ABChatShared || {};
  const actionsForRegistry = existingNamespaceForRegistry.actions || {};

  const toolDefinitionsForRegistry = [
    {
      id: "selectionExplain",
      action: actionsForRegistry.explainSelection || "explainSelection",
      label: "Explain Selection",
      description: "Open quick question modal with explain prompt",
      defaultEnabled: true,
      contexts: ["selection"],
      menuTitle: "Explain selection"
    },
    {
      id: "selectionSummarize",
      action: actionsForRegistry.summarizeSelection || "summarizeSelection",
      label: "Summarize Selection",
      description: "Open quick question modal with summarize prompt",
      defaultEnabled: true,
      contexts: ["selection"],
      menuTitle: "Summarize selection"
    },
    {
      id: "selectionProofread",
      action: actionsForRegistry.proofreadSelection || "proofreadSelection",
      label: "Proofread Selection",
      description: "Open quick question modal with proofread prompt",
      defaultEnabled: true,
      contexts: ["selection"],
      menuTitle: "Proofread selection"
    },
    {
      id: "selectionQuickQuestion",
      action: actionsForRegistry.quickQuestionSelection || "quickQuestionSelection",
      label: "Quick Question About Selection",
      description: "Open quick question modal with selected text",
      defaultEnabled: true,
      contexts: ["selection"],
      menuTitle: "Quick Question about selection"
    },
    {
      id: "addImageToChat",
      action: actionsForRegistry.addImageToChat || "addImageToChat",
      label: "Add Image to Chat",
      description: "Add right-clicked image to the chat input as an attachment",
      defaultEnabled: true,
      contexts: ["image"],
      menuTitle: "Add image to chat"
    },
    {
      id: "addSelectionToChat",
      action: actionsForRegistry.addSelectionToChat || "addSelectionToChat",
      label: "Add Selection to Chat",
      description: "Add selected text to the chat input as a quoted chip",
      defaultEnabled: true,
      contexts: ["selection"],
      menuTitle: "Add selection to chat"
    }
  ];

  function getAllToolsForRegistry() {
    return toolDefinitionsForRegistry.slice();
  }

  function getToolByIdForRegistry(toolIdForRegistry) {
    return toolDefinitionsForRegistry.find((toolForRegistry) => toolForRegistry.id === toolIdForRegistry) || null;
  }

  function getToolByActionForRegistry(actionForRegistry) {
    return toolDefinitionsForRegistry.find((toolForRegistry) => toolForRegistry.action === actionForRegistry) || null;
  }

  function getToolByCommandForRegistry(commandIdForRegistry) {
    return toolDefinitionsForRegistry.find((toolForRegistry) => toolForRegistry.command === commandIdForRegistry) || null;
  }

  function getDefaultEnabledMapForRegistry() {
    const enabledMapForRegistry = {};
    toolDefinitionsForRegistry.forEach((toolForRegistry) => {
      enabledMapForRegistry[toolForRegistry.id] = Boolean(toolForRegistry.defaultEnabled);
    });
    return enabledMapForRegistry;
  }

  function getContextMenuItemsForRegistry(enabledToolsMapForRegistry) {
    const safeEnabledToolsMapForRegistry = enabledToolsMapForRegistry || getDefaultEnabledMapForRegistry();
    const menuItemsForRegistry = [];

    toolDefinitionsForRegistry.forEach((toolForRegistry) => {
      if (!safeEnabledToolsMapForRegistry[toolForRegistry.id]) {
        return;
      }
      if (!Array.isArray(toolForRegistry.contexts) || !toolForRegistry.contexts.length) {
        return;
      }
      menuItemsForRegistry.push({
        id: "abchat-" + toolForRegistry.id,
        action: toolForRegistry.action,
        title: toolForRegistry.menuTitle,
        contexts: toolForRegistry.contexts
      });
    });

    return menuItemsForRegistry;
  }

  globalScopeForRegistry.ABChatShared = {
    ...existingNamespaceForRegistry,
    toolRegistry: {
      getAllTools: getAllToolsForRegistry,
      getToolById: getToolByIdForRegistry,
      getToolByAction: getToolByActionForRegistry,
      getToolByCommand: getToolByCommandForRegistry,
      getDefaultEnabledMap: getDefaultEnabledMapForRegistry,
      getContextMenuItems: getContextMenuItemsForRegistry
    }
  };
})();
