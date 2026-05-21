(function () {
  const globalScopeForPanelBoot = globalThis;
  const contentNamespaceForPanelBoot = globalScopeForPanelBoot.ABChatContent || {};

  contentNamespaceForPanelBoot.state = contentNamespaceForPanelBoot.state || {};
  contentNamespaceForPanelBoot.ui = contentNamespaceForPanelBoot.ui || {};

  // Track whether panel.css has finished loading. The shadow host must not become
  // visible before CSS is applied — doing so causes a FOUC where the panel briefly
  // renders unstyled (full-screen white flash) before snapping to reduced mode.
  let panelCssReadyForPanelBoot = false;
  let showPendingForPanelBoot = false;
  let pendingVisibleCallbacksForPanelBoot = [];
  let inOverlayOnlyModeForPanelBoot = false;
  let panelClosedAtForPanelBoot = 0;
  const SYNC_ON_OPEN_THRESHOLD_MS_FOR_PANEL_BOOT = 10000;

  function reclampPanelPositionAfterOpenForPanelBoot() {
    requestAnimationFrame(function () {
      const runtimeForReclamp =
        contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelRuntime;
      if (runtimeForReclamp && typeof runtimeForReclamp.reclampPanelPosition === 'function') {
        runtimeForReclamp.reclampPanelPosition();
      }
    });
  }

  function onPanelCssReadyForPanelBoot() {
    panelCssReadyForPanelBoot = true;
    if (showPendingForPanelBoot) {
      showPendingForPanelBoot = false;
      const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
      if (shadowHostForPanelBoot) {
        shadowHostForPanelBoot.style.display = 'block';
      }
      const callbacksForPanelBoot = pendingVisibleCallbacksForPanelBoot.splice(0);
      callbacksForPanelBoot.forEach(function (cbForPanelBoot) {
        try { cbForPanelBoot(); } catch (eForPanelBoot) {}
      });
      reclampPanelPositionAfterOpenForPanelBoot();
    }
  }

  function ensurePanelMarkupForPanelBoot() {
    if (!document || !document.body) {
      return false;
    }

    // If the shadow host already exists, shadow DOM is already set up.
    // Re-attach the shadow root reference so panelRuntime can access it after
    // a content script re-injection (extension reload without page reload).
    const existingHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (existingHostForPanelBoot) {
      if (existingHostForPanelBoot.shadowRoot) {
        contentNamespaceForPanelBoot.ui = contentNamespaceForPanelBoot.ui || {};
        contentNamespaceForPanelBoot.ui.panelShadowRoot = existingHostForPanelBoot.shadowRoot;
        // CSS was loaded in a previous injection; mark it ready so setVisible
        // does not defer indefinitely.
        const existingCssLinkForPanelBoot = existingHostForPanelBoot.shadowRoot.querySelector(
          'link[rel="stylesheet"][href*="panel.css"]'
        );
        if (existingCssLinkForPanelBoot && existingCssLinkForPanelBoot.sheet) {
          panelCssReadyForPanelBoot = true;
        } else if (existingCssLinkForPanelBoot) {
          existingCssLinkForPanelBoot.addEventListener('load', onPanelCssReadyForPanelBoot);
          existingCssLinkForPanelBoot.addEventListener('error', onPanelCssReadyForPanelBoot);
        }
      }
      return true;
    }

    const panelTemplateNamespaceForPanelBoot =
      contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelTemplate
        ? contentNamespaceForPanelBoot.ui.panelTemplate
        : null;
    if (!panelTemplateNamespaceForPanelBoot || typeof panelTemplateNamespaceForPanelBoot.buildMarkup !== 'function') {
      return false;
    }

    // Create an isolated shadow host — this is the only element added to the page DOM.
    const shadowHostForPanelBoot = document.createElement('div');
    shadowHostForPanelBoot.id = 'abchat-panel-shadow-host';
    shadowHostForPanelBoot.setAttribute('data-abchat-panel', '1');
    shadowHostForPanelBoot.style.display = 'none';
    document.body.appendChild(shadowHostForPanelBoot);

    // Attach a shadow root. All panel CSS and HTML live inside here, fully
    // isolated from the host page — no styles leak in either direction.
    const shadowRootForPanelBoot = shadowHostForPanelBoot.attachShadow({ mode: 'open' });

    // Inject stylesheets into the shadow root (NOT document.head).
    try {
      const cssLinkForPanelBoot = document.createElement('link');
      cssLinkForPanelBoot.rel = 'stylesheet';
      cssLinkForPanelBoot.href = chrome.runtime.getURL('panel/panel.css');
      // Defer visibility until CSS is applied to prevent FOUC.
      cssLinkForPanelBoot.addEventListener('load', onPanelCssReadyForPanelBoot);
      cssLinkForPanelBoot.addEventListener('error', onPanelCssReadyForPanelBoot);
      shadowRootForPanelBoot.appendChild(cssLinkForPanelBoot);

      const highlightLinkForPanelBoot = document.createElement('link');
      highlightLinkForPanelBoot.rel = 'stylesheet';
      highlightLinkForPanelBoot.href = chrome.runtime.getURL('lib/github-dark.min.css');
      shadowRootForPanelBoot.appendChild(highlightLinkForPanelBoot);
    } catch (errorForPanelBoot) {
      // CSS injection failed; mark ready anyway so the panel can still be shown.
      panelCssReadyForPanelBoot = true;
    }

    // Inject critical overlay styles inline so the loading spinner displays
    // correctly immediately, before panel.css finishes loading.
    try {
      const overlayStyleForPanelBoot = document.createElement('style');
      overlayStyleForPanelBoot.id = 'abchat-overlay-critical-style';
      overlayStyleForPanelBoot.textContent = [
        '*, *::before, *::after { box-sizing: border-box; }',
        '.libs-loading-overlay {',
        '  position: absolute; inset: 0; z-index: 100;',
        '  background: #ffffff;',
        '  display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center; gap: 12px;',
        '  border-radius: inherit; transition: opacity 0.2s ease;',
        '}',
        '.libs-loading-overlay.libs-ready { opacity: 0; pointer-events: none; }',
        '@keyframes abchat-spin { to { transform: rotate(360deg); } }',
        '.libs-loading-spinner {',
        '  width: 28px; height: 28px;',
        '  border: 3px solid #adbdd0; border-top-color: #2563eb;',
        '  border-radius: 50%; animation: abchat-spin 0.7s linear infinite;',
        '}',
        '.libs-loading-label {',
        '  font-size: 13px; color: #60748a;',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
        '}',
      ].join('\n');
      shadowRootForPanelBoot.appendChild(overlayStyleForPanelBoot);
    } catch (errorForPanelBoot) {
      // Inline style injection failed; panel.css will supply these styles once loaded.
    }

    // Mount the panel markup inside the shadow root.
    const mountNodeForPanelBoot = document.createElement('div');
    mountNodeForPanelBoot.id = 'abchat-panel-mount';
    mountNodeForPanelBoot.setAttribute('data-abchat-panel', '1');
    mountNodeForPanelBoot.innerHTML =
      '<div id="demo-controls" style="display:none"><button id="btn-theme" type="button"></button><button id="btn-mode" type="button"></button></div>' +
      panelTemplateNamespaceForPanelBoot.buildMarkup();
    shadowRootForPanelBoot.appendChild(mountNodeForPanelBoot);

    const emptyStateIconImgForPanelBoot = mountNodeForPanelBoot.querySelector('#chat-empty-extension-icon');
    if (
      emptyStateIconImgForPanelBoot &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === 'function'
    ) {
      emptyStateIconImgForPanelBoot.src = chrome.runtime.getURL('icon.png');
    }

    const onboardingIconImgForPanelBoot = mountNodeForPanelBoot.querySelector('#api-key-onboarding-icon');
    if (
      onboardingIconImgForPanelBoot &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === 'function'
    ) {
      onboardingIconImgForPanelBoot.src = chrome.runtime.getURL('icon.png');
    }

    // Store the shadow root reference so panelRuntime.js can use it for all
    // internal DOM queries instead of document.getElementById/querySelector.
    contentNamespaceForPanelBoot.ui.panelShadowRoot = shadowRootForPanelBoot;

    return true;
  }

  function initializePanelRuntimeForPanelBoot() {
    const panelRuntimeNamespaceForPanelBoot =
      contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelRuntime
        ? contentNamespaceForPanelBoot.ui.panelRuntime
        : null;
    if (!panelRuntimeNamespaceForPanelBoot || typeof panelRuntimeNamespaceForPanelBoot.initialize !== 'function') {
      return;
    }
    const dataNamespaceForPanelBoot = contentNamespaceForPanelBoot.data || {};
    const dbReadyPromiseForPanelBoot = dataNamespaceForPanelBoot.dbReadyPromise;
    if (dbReadyPromiseForPanelBoot && typeof dbReadyPromiseForPanelBoot.then === 'function') {
      Promise.resolve(dbReadyPromiseForPanelBoot)
        .catch(function () { return null; })
        .then(function () {
          try {
            panelRuntimeNamespaceForPanelBoot.initialize();
          } catch (errorForPanelBoot) {
            // Keep panel mount alive even if runtime initialization fails.
          }
        });
      return;
    }
    try {
      panelRuntimeNamespaceForPanelBoot.initialize();
    } catch (errorForPanelBoot) {
      // Keep panel mount alive even if runtime initialization fails.
    }
  }

  function ensurePanelReadyForPanelBoot() {
    if (!ensurePanelMarkupForPanelBoot()) {
      return false;
    }
    initializePanelRuntimeForPanelBoot();
    const shadowRootForCloseBtn = contentNamespaceForPanelBoot.ui.panelShadowRoot;
    if (shadowRootForCloseBtn) {
      const closeButtonForPanelBoot = shadowRootForCloseBtn.querySelector('#panel-host .ctrl-close');
      if (closeButtonForPanelBoot && !closeButtonForPanelBoot.hasAttribute('data-abchat-close-bound')) {
        closeButtonForPanelBoot.setAttribute('data-abchat-close-bound', '1');
        closeButtonForPanelBoot.addEventListener('click', function () {
          setPanelVisibleForPanelBoot(false);
        });
      }
    }
    return true;
  }

  function setPanelVisibleForPanelBoot(isVisibleForPanelBoot) {
    const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForPanelBoot) {
      return;
    }
    // If showing and CSS hasn't loaded yet, queue the show until it does.
    // This prevents the FOUC where the panel briefly renders unstyled.
    if (isVisibleForPanelBoot && !panelCssReadyForPanelBoot) {
      showPendingForPanelBoot = true;
      return;
    }
    showPendingForPanelBoot = false;
    const wasHiddenForPanelBoot = shadowHostForPanelBoot.style.display === 'none';
    shadowHostForPanelBoot.style.display = isVisibleForPanelBoot ? 'block' : 'none';
    if (!isVisibleForPanelBoot) {
      panelClosedAtForPanelBoot = Date.now();
    }
    // Broadcast visibility to other tabs via panelStateSync (debounced/merged
    // into the shared abchat_panel_ui_state key). Guarded internally so
    // applying a remote isOpen change does not echo back.
    const syncNsForBootVisibility =
      contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelStateSync;
    if (syncNsForBootVisibility && typeof syncNsForBootVisibility.writeState === 'function') {
      syncNsForBootVisibility.writeState({ isOpen: Boolean(isVisibleForPanelBoot) });
    }
    if (isVisibleForPanelBoot) {
      if (pendingVisibleCallbacksForPanelBoot.length > 0) {
        const callbacksForPanelBoot = pendingVisibleCallbacksForPanelBoot.splice(0);
        callbacksForPanelBoot.forEach(function (cbForPanelBoot) {
          try { cbForPanelBoot(); } catch (eForPanelBoot) {}
        });
      }
      reclampPanelPositionAfterOpenForPanelBoot();
      if (wasHiddenForPanelBoot && panelClosedAtForPanelBoot > 0 &&
          Date.now() - panelClosedAtForPanelBoot >= SYNC_ON_OPEN_THRESHOLD_MS_FOR_PANEL_BOOT) {
        const panelRuntimeNsForSyncOnOpen =
          contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelRuntime;
        if (panelRuntimeNsForSyncOnOpen && typeof panelRuntimeNsForSyncOnOpen.refreshStore === 'function') {
          panelRuntimeNsForSyncOnOpen.refreshStore('chats');
          panelRuntimeNsForSyncOnOpen.refreshStore('notes');
          panelRuntimeNsForSyncOnOpen.refreshStore('tasks');
          panelRuntimeNsForSyncOnOpen.refreshStore('questions');
        }
      }
    }
  }

  function showForInlineChatOnlyForPanelBoot() {
    if (!ensurePanelReadyForPanelBoot()) return;
    const shadowHostForInlineOnlyForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForInlineOnlyForPanelBoot) return;
    // Panel is already normally visible; nothing to do.
    if (shadowHostForInlineOnlyForPanelBoot.style.display !== 'none' && !inOverlayOnlyModeForPanelBoot) return;
    inOverlayOnlyModeForPanelBoot = true;
    function hidePanelHostNodeForPanelBoot() {
      const srForHideForPanelBoot = shadowHostForInlineOnlyForPanelBoot.shadowRoot;
      if (!srForHideForPanelBoot) return;
      const panelHostForHideForPanelBoot = srForHideForPanelBoot.getElementById('panel-host');
      if (panelHostForHideForPanelBoot) panelHostForHideForPanelBoot.style.display = 'none';
    }
    if (!panelCssReadyForPanelBoot) {
      showPendingForPanelBoot = true;
      pendingVisibleCallbacksForPanelBoot.push(hidePanelHostNodeForPanelBoot);
      return;
    }
    shadowHostForInlineOnlyForPanelBoot.style.display = 'block';
    hidePanelHostNodeForPanelBoot();
  }

  function restoreAfterInlineChatOnlyForPanelBoot() {
    if (!inOverlayOnlyModeForPanelBoot) return;
    inOverlayOnlyModeForPanelBoot = false;
    const shadowHostForRestoreForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForRestoreForPanelBoot) return;
    const srForRestoreForPanelBoot = shadowHostForRestoreForPanelBoot.shadowRoot;
    if (srForRestoreForPanelBoot) {
      const panelHostForRestoreForPanelBoot = srForRestoreForPanelBoot.getElementById('panel-host');
      if (panelHostForRestoreForPanelBoot) panelHostForRestoreForPanelBoot.style.display = '';
    }
    shadowHostForRestoreForPanelBoot.style.display = 'none';
  }

  contentNamespaceForPanelBoot.ui.panel = {
    ensureReady: ensurePanelReadyForPanelBoot,
    setVisible: setPanelVisibleForPanelBoot,
    showForInlineChatOnly: showForInlineChatOnlyForPanelBoot,
    restoreAfterInlineChatOnly: restoreAfterInlineChatOnlyForPanelBoot,
    isVisible: function isVisibleForPanelBoot() {
      const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
      return Boolean(shadowHostForPanelBoot && shadowHostForPanelBoot.style.display !== 'none');
    },
    whenVisible: function whenVisibleForPanelBoot(callbackForPanelBoot) {
      if (typeof callbackForPanelBoot !== 'function') return;
      const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
      if (shadowHostForPanelBoot && shadowHostForPanelBoot.style.display !== 'none') {
        try { callbackForPanelBoot(); } catch (eForPanelBoot) {}
      } else {
        pendingVisibleCallbacksForPanelBoot.push(callbackForPanelBoot);
      }
    }
  };

  globalScopeForPanelBoot.ABChatContent = contentNamespaceForPanelBoot;
})();
