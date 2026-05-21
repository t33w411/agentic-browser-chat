(function () {
  const globalScopeForCommands = globalThis;
  const existingBackgroundNamespaceForCommands = globalScopeForCommands.ABChatBackground || {};
  const sharedNamespaceForCommands = globalScopeForCommands.ABChatShared || {};
  const toolRegistryForCommands = sharedNamespaceForCommands.toolRegistry;

  function getActionForCommandForCommands(commandIdForCommands) {
    if (!toolRegistryForCommands) {
      return "";
    }

    const matchedToolForCommands = toolRegistryForCommands.getToolByCommand(commandIdForCommands);
    return matchedToolForCommands ? matchedToolForCommands.action : "";
  }

  globalScopeForCommands.ABChatBackground = {
    ...existingBackgroundNamespaceForCommands,
    commands: {
      getActionForCommand: getActionForCommandForCommands
    }
  };
})();
