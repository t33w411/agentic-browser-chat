(function () {
  const globalScopeForSelectionActions = globalThis;
  const contentNamespaceForSelectionActions = globalScopeForSelectionActions.ABChatContent || {};
  const sharedNamespaceForSelectionActions = globalScopeForSelectionActions.ABChatShared || {};
  const actionsForSelectionActions = sharedNamespaceForSelectionActions.actions || {};

  function getPayloadForSelectionActions(actionPayloadForSelectionActions) {
    if (
      actionPayloadForSelectionActions &&
      actionPayloadForSelectionActions.payload &&
      typeof actionPayloadForSelectionActions.payload === "object"
    ) {
      return actionPayloadForSelectionActions.payload;
    }
    return actionPayloadForSelectionActions || {};
  }

  function getSelectedTextForSelectionActions(actionPayloadForSelectionActions) {
    const payloadForSelectionActions = getPayloadForSelectionActions(actionPayloadForSelectionActions);
    if (typeof payloadForSelectionActions.selectedText === "string" && payloadForSelectionActions.selectedText.trim()) {
      return payloadForSelectionActions.selectedText.trim();
    }
    if (window.getSelection) {
      const selectionForSelectionActions = window.getSelection();
      if (selectionForSelectionActions && typeof selectionForSelectionActions.toString === "function") {
        return selectionForSelectionActions.toString().trim();
      }
    }
    return "";
  }

  function getPanelNamespaceForSelectionActions() {
    if (contentNamespaceForSelectionActions.ui && contentNamespaceForSelectionActions.ui.panel) {
      return contentNamespaceForSelectionActions.ui.panel;
    }
    return null;
  }

  function isPanelVisibleForSelectionActions() {
    const panelNamespaceForSelectionActions = getPanelNamespaceForSelectionActions();
    if (!panelNamespaceForSelectionActions || typeof panelNamespaceForSelectionActions.isVisible !== "function") {
      return false;
    }
    return Boolean(panelNamespaceForSelectionActions.isVisible());
  }

  function ensurePanelVisibleForSelectionActions() {
    const panelNamespaceForSelectionActions = getPanelNamespaceForSelectionActions();
    if (!panelNamespaceForSelectionActions || typeof panelNamespaceForSelectionActions.ensureReady !== "function") {
      return false;
    }
    const isReadyForSelectionActions = panelNamespaceForSelectionActions.ensureReady();
    if (!isReadyForSelectionActions) {
      return false;
    }
    if (typeof panelNamespaceForSelectionActions.showForInlineChatOnly === "function") {
      panelNamespaceForSelectionActions.showForInlineChatOnly();
    } else if (typeof panelNamespaceForSelectionActions.setVisible === "function") {
      panelNamespaceForSelectionActions.setVisible(true);
    }
    return true;
  }

  function getPanelShadowRootForSelectionActions() {
    return (
      contentNamespaceForSelectionActions.ui &&
      contentNamespaceForSelectionActions.ui.panelShadowRoot
    ) || null;
  }

  function setPanelInlineSnippetForSelectionActions(selectedTextForSelectionActions) {
    const shadowRootForSelectionActions = getPanelShadowRootForSelectionActions();
    if (!shadowRootForSelectionActions) {
      return;
    }
    const snippetNodeForSelectionActions = shadowRootForSelectionActions.querySelector("#inline-overlay .im-snippet");
    if (!snippetNodeForSelectionActions) {
      return;
    }
    const safeTextForSelectionActions = selectedTextForSelectionActions || "No text selected.";
    snippetNodeForSelectionActions.dataset.selectedText = safeTextForSelectionActions;
    snippetNodeForSelectionActions.textContent = "";
    const labelNodeForSelectionActions = document.createElement("div");
    labelNodeForSelectionActions.className = "im-snippet-label";
    labelNodeForSelectionActions.textContent = "Selected text";
    const textNodeForSelectionActions = document.createTextNode('"' + safeTextForSelectionActions + '"');
    snippetNodeForSelectionActions.appendChild(labelNodeForSelectionActions);
    snippetNodeForSelectionActions.appendChild(textNodeForSelectionActions);
  }

  function resetPanelInlinePromptForSelectionActions() {
    const shadowRootForPromptSelectionActions = getPanelShadowRootForSelectionActions();
    if (!shadowRootForPromptSelectionActions) {
      return;
    }
    const inlineTextAreaForSelectionActions = shadowRootForPromptSelectionActions.querySelector("#im-ta");
    if (!inlineTextAreaForSelectionActions) {
      return;
    }
    inlineTextAreaForSelectionActions.value = "";
    if (typeof inlineTextAreaForSelectionActions.dispatchEvent === "function") {
      inlineTextAreaForSelectionActions.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (typeof inlineTextAreaForSelectionActions.style !== "undefined") {
      const computedStyleForSelectionActions = window.getComputedStyle(inlineTextAreaForSelectionActions);
      const parsedMaxHeightForSelectionActions = parseFloat(computedStyleForSelectionActions.maxHeight || "");
      const maxHeightForSelectionActions =
        Number.isFinite(parsedMaxHeightForSelectionActions) && parsedMaxHeightForSelectionActions > 0
          ? parsedMaxHeightForSelectionActions
          : 240;
      inlineTextAreaForSelectionActions.style.height = "auto";
      const nextHeightForSelectionActions = Math.min(
        inlineTextAreaForSelectionActions.scrollHeight || 0,
        maxHeightForSelectionActions
      );
      inlineTextAreaForSelectionActions.style.height = nextHeightForSelectionActions + "px";
      inlineTextAreaForSelectionActions.style.overflowY =
        (inlineTextAreaForSelectionActions.scrollHeight || 0) > maxHeightForSelectionActions ? "auto" : "hidden";
    }
    if (typeof inlineTextAreaForSelectionActions.focus === "function") {
      inlineTextAreaForSelectionActions.focus();
    }
  }

  function openQuickQuestionInPanelForSelectionActions(selectedTextForSelectionActions) {
    if (!isPanelVisibleForSelectionActions()) {
      return false;
    }
    if (typeof globalScopeForSelectionActions.openInlineChat === "function") {
      globalScopeForSelectionActions.openInlineChat();
    } else {
      const shadowRootForOverlaySelectionActions = getPanelShadowRootForSelectionActions();
      const overlayNodeForSelectionActions = shadowRootForOverlaySelectionActions
        ? shadowRootForOverlaySelectionActions.querySelector("#inline-overlay")
        : null;
      if (overlayNodeForSelectionActions && overlayNodeForSelectionActions.classList) {
        overlayNodeForSelectionActions.classList.remove("hidden");
      }
    }
    setPanelInlineSnippetForSelectionActions(selectedTextForSelectionActions);
    resetPanelInlinePromptForSelectionActions();
    return true;
  }

  function handleQuickQuestionForSelectionActions(actionPayloadForSelectionActions) {
    const selectedTextForSelectionActions = getSelectedTextForSelectionActions(actionPayloadForSelectionActions);
    ensurePanelVisibleForSelectionActions();
    if (openQuickQuestionInPanelForSelectionActions(selectedTextForSelectionActions)) {
      return;
    }
    // Panel not yet visible (CSS still loading on first open) — defer until it becomes visible.
    const panelForDeferredForSelectionActions = getPanelNamespaceForSelectionActions();
    if (panelForDeferredForSelectionActions && typeof panelForDeferredForSelectionActions.whenVisible === 'function') {
      panelForDeferredForSelectionActions.whenVisible(function () {
        openQuickQuestionInPanelForSelectionActions(selectedTextForSelectionActions);
      });
    }
  }

  if (typeof contentNamespaceForSelectionActions.registerActionHandler === "function") {
    contentNamespaceForSelectionActions.registerActionHandler(
      actionsForSelectionActions.quickQuestionSelection || "quickQuestionSelection",
      function quickQuestionSelectionHandlerForSelectionActions(actionPayloadForSelectionActions) {
        handleQuickQuestionForSelectionActions(actionPayloadForSelectionActions);
      }
    );
  }

  globalScopeForSelectionActions.ABChatContent = contentNamespaceForSelectionActions;
})();
