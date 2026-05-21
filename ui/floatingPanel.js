(function () {
  const globalScopeForFloatingPanel = globalThis;
  const contentNamespaceForFloatingPanel = globalScopeForFloatingPanel.ABChatContent || {};
  const sharedNamespaceForFloatingPanel = globalScopeForFloatingPanel.ABChatShared || {};
  const actionsForFloatingPanel = sharedNamespaceForFloatingPanel.actions || {};

  contentNamespaceForFloatingPanel.state = contentNamespaceForFloatingPanel.state || {};
  contentNamespaceForFloatingPanel.ui = contentNamespaceForFloatingPanel.ui || {};

  function setFloatingPanelOpenStateForFloatingPanel(isOpenForFloatingPanel) {
    const panelUiNamespaceForFloatingPanel =
      contentNamespaceForFloatingPanel.ui && contentNamespaceForFloatingPanel.ui.panel
        ? contentNamespaceForFloatingPanel.ui.panel
        : null;
    if (!panelUiNamespaceForFloatingPanel || typeof panelUiNamespaceForFloatingPanel.ensureReady !== "function") {
      return;
    }
    const isReadyForFloatingPanel = panelUiNamespaceForFloatingPanel.ensureReady();
    if (!isReadyForFloatingPanel || typeof panelUiNamespaceForFloatingPanel.setVisible !== "function") {
      return;
    }
    panelUiNamespaceForFloatingPanel.setVisible(Boolean(isOpenForFloatingPanel));
    contentNamespaceForFloatingPanel.state.isFloatingPanelOpenForFloatingPanel = Boolean(isOpenForFloatingPanel);
  }

  function toggleFloatingPanelForFloatingPanel() {
    const panelUiNamespaceForFloatingPanel =
      contentNamespaceForFloatingPanel.ui && contentNamespaceForFloatingPanel.ui.panel
        ? contentNamespaceForFloatingPanel.ui.panel
        : null;
    const isOpenForFloatingPanel =
      panelUiNamespaceForFloatingPanel && typeof panelUiNamespaceForFloatingPanel.isVisible === "function"
        ? Boolean(panelUiNamespaceForFloatingPanel.isVisible())
        : Boolean(contentNamespaceForFloatingPanel.state.isFloatingPanelOpenForFloatingPanel);
    setFloatingPanelOpenStateForFloatingPanel(!isOpenForFloatingPanel);
  }

  contentNamespaceForFloatingPanel.ui.floatingPanel = {
    toggle: toggleFloatingPanelForFloatingPanel,
    open: function openFloatingPanelForFloatingPanel() {
      setFloatingPanelOpenStateForFloatingPanel(true);
    },
    close: function closeFloatingPanelForFloatingPanel() {
      setFloatingPanelOpenStateForFloatingPanel(false);
    }
  };

  if (typeof contentNamespaceForFloatingPanel.registerActionHandler === "function") {
    contentNamespaceForFloatingPanel.registerActionHandler(
      actionsForFloatingPanel.toggleFloatingPanel || "toggleFloatingPanel",
      function handleToggleFloatingPanelActionForFloatingPanel() {
        toggleFloatingPanelForFloatingPanel();
      }
    );
  }

  globalScopeForFloatingPanel.ABChatContent = contentNamespaceForFloatingPanel;
})();
