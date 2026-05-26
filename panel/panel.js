(function () {
  const globalScopeForPanelBoot = globalThis;
  const contentNamespaceForPanelBoot = globalScopeForPanelBoot.ABChatContent || {};

  contentNamespaceForPanelBoot.state = contentNamespaceForPanelBoot.state || {};
  contentNamespaceForPanelBoot.ui = contentNamespaceForPanelBoot.ui || {};

  // Two readiness gates must both fire before the shadow host is made visible:
  //  - panelCssReadyForPanelBoot: panel.css has finished loading (prevents the
  //    unstyled-white-flash FOUC).
  //  - panelStateReadyForPanelBoot: the user's saved paint-affecting UI state
  //    (mode, theme, reduced-view panel anchor) has been pre-applied to the
  //    markup, so first paint matches their preferences (prevents the
  //    expanded→reduced, light→dark, and snap-from-default-corner flashes).
  let panelCssReadyForPanelBoot = false;
  let panelStateReadyForPanelBoot = false;
  let showPendingForPanelBoot = false;
  let pendingVisibleCallbacksForPanelBoot = [];
  // Anchor stash: anchor needs offsetWidth/Height which require display:block,
  // so we hold the stored anchor here and apply it inside the show flip.
  let pendingPaintAnchorForPanelBoot = null;
  let inOverlayOnlyModeForPanelBoot = false;
  let panelClosedAtForPanelBoot = 0;
  const SYNC_ON_OPEN_THRESHOLD_MS_FOR_PANEL_BOOT = 10000;

  // Storage keys must stay in sync with panelStateSync.js (mode, panelAnchor)
  // and the THEME_KEY_FOR_PANEL_RUNTIME constant in panelRuntime.js (theme).
  const PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_BOOT = 'abchat_panel_ui_state_field_';
  const LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_BOOT = 'abchat_panel_ui_state';
  const THEME_KEY_FOR_PANEL_BOOT = 'abchat_theme';

  function reclampPanelPositionAfterOpenForPanelBoot() {
    requestAnimationFrame(function () {
      const runtimeForReclamp =
        contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelRuntime;
      if (runtimeForReclamp && typeof runtimeForReclamp.reclampPanelPosition === 'function') {
        runtimeForReclamp.reclampPanelPosition();
      }
    });
  }

  function isValidAnchorForPanelBoot(anchorForCheck) {
    return Boolean(
      anchorForCheck && typeof anchorForCheck === 'object' &&
      (anchorForCheck.ax === 'left' || anchorForCheck.ax === 'right') &&
      (anchorForCheck.ay === 'top' || anchorForCheck.ay === 'bottom') &&
      Number.isFinite(anchorForCheck.ox) && Number.isFinite(anchorForCheck.oy)
    );
  }

  function readStoredPaintStateForPanelBoot(callbackForPanelBoot) {
    try {
      const modeKeyForPanelBoot = PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_BOOT + 'mode';
      const anchorKeyForPanelBoot = PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_BOOT + 'panelAnchor';
      const keysForPanelBoot = [
        modeKeyForPanelBoot,
        anchorKeyForPanelBoot,
        LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_BOOT,
        THEME_KEY_FOR_PANEL_BOOT
      ];
      chrome.storage.local.get(keysForPanelBoot, function (resForPanelBoot) {
        const outForPanelBoot = { mode: null, theme: null, panelAnchor: null };
        const modeRecordForPanelBoot = resForPanelBoot && resForPanelBoot[modeKeyForPanelBoot];
        if (
          modeRecordForPanelBoot && typeof modeRecordForPanelBoot === 'object' &&
          (modeRecordForPanelBoot.value === 'expanded' || modeRecordForPanelBoot.value === 'reduced')
        ) {
          outForPanelBoot.mode = modeRecordForPanelBoot.value;
        }
        const anchorRecordForPanelBoot = resForPanelBoot && resForPanelBoot[anchorKeyForPanelBoot];
        if (
          anchorRecordForPanelBoot && typeof anchorRecordForPanelBoot === 'object' &&
          isValidAnchorForPanelBoot(anchorRecordForPanelBoot.value)
        ) {
          const aForPanelBoot = anchorRecordForPanelBoot.value;
          outForPanelBoot.panelAnchor = {
            ax: aForPanelBoot.ax, ay: aForPanelBoot.ay,
            ox: aForPanelBoot.ox, oy: aForPanelBoot.oy
          };
        }
        const legacyForPanelBoot = resForPanelBoot && resForPanelBoot[LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_BOOT];
        if (legacyForPanelBoot && typeof legacyForPanelBoot === 'object') {
          if (outForPanelBoot.mode === null &&
              (legacyForPanelBoot.mode === 'expanded' || legacyForPanelBoot.mode === 'reduced')) {
            outForPanelBoot.mode = legacyForPanelBoot.mode;
          }
          if (outForPanelBoot.panelAnchor === null && isValidAnchorForPanelBoot(legacyForPanelBoot.panelAnchor)) {
            outForPanelBoot.panelAnchor = {
              ax: legacyForPanelBoot.panelAnchor.ax,
              ay: legacyForPanelBoot.panelAnchor.ay,
              ox: legacyForPanelBoot.panelAnchor.ox,
              oy: legacyForPanelBoot.panelAnchor.oy
            };
          }
        }
        const themeRawForPanelBoot = resForPanelBoot && resForPanelBoot[THEME_KEY_FOR_PANEL_BOOT];
        if (themeRawForPanelBoot === 'dark' || themeRawForPanelBoot === 'light') {
          outForPanelBoot.theme = themeRawForPanelBoot;
        } else if (themeRawForPanelBoot === 'system') {
          try {
            outForPanelBoot.theme =
              window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          } catch (errorForPanelBoot) {
            outForPanelBoot.theme = null;
          }
        }
        try { callbackForPanelBoot(outForPanelBoot); } catch (errorForPanelBoot) {}
      });
    } catch (errorForPanelBoot) {
      try {
        callbackForPanelBoot({ mode: null, theme: null, panelAnchor: null });
      } catch (innerErrorForPanelBoot) {}
    }
  }

  function applyPrePaintModeForPanelBoot(shadowRootForPanelBoot, modeForPanelBoot) {
    if (modeForPanelBoot !== 'expanded' && modeForPanelBoot !== 'reduced') return;
    const panelHostForPanelBoot = shadowRootForPanelBoot.getElementById('panel-host');
    if (!panelHostForPanelBoot) return;
    panelHostForPanelBoot.classList.remove('mode-expanded', 'mode-reduced');
    panelHostForPanelBoot.classList.add('mode-' + modeForPanelBoot);
  }

  function applyPrePaintThemeForPanelBoot(shadowRootForPanelBoot, themeForPanelBoot) {
    if (themeForPanelBoot !== 'light' && themeForPanelBoot !== 'dark') return;
    // All four shadow-root top-level elements carry data-theme (panel + the
    // three modal overlays + the feature-tour overlay). See CLAUDE.md §20.
    const idsForPanelBoot = [
      'panel-host', 'inline-overlay', 'picker-overlay',
      'attach-preview-overlay', 'feature-tour-overlay'
    ];
    idsForPanelBoot.forEach(function (idForPanelBoot) {
      const elForPanelBoot = shadowRootForPanelBoot.getElementById(idForPanelBoot);
      if (elForPanelBoot) elForPanelBoot.dataset.theme = themeForPanelBoot;
    });
  }

  function applyPendingPaintAnchorForPanelBoot(shadowHostForPanelBoot) {
    if (!pendingPaintAnchorForPanelBoot) return;
    const anchorForPanelBoot = pendingPaintAnchorForPanelBoot;
    pendingPaintAnchorForPanelBoot = null;
    const shadowRootForPanelBoot = shadowHostForPanelBoot.shadowRoot;
    if (!shadowRootForPanelBoot) return;
    const panelHostForPanelBoot = shadowRootForPanelBoot.getElementById('panel-host');
    if (!panelHostForPanelBoot) return;
    // Anchor only applies in reduced mode; expanded uses CSS centering.
    if (!panelHostForPanelBoot.classList.contains('mode-reduced')) return;
    const widthForPanelBoot = panelHostForPanelBoot.offsetWidth || 520;
    const heightForPanelBoot = panelHostForPanelBoot.offsetHeight || 0;
    const viewportWidthForPanelBoot = window.innerWidth;
    const viewportHeightForPanelBoot = window.innerHeight;
    const rawLeftForPanelBoot = anchorForPanelBoot.ax === 'left'
      ? anchorForPanelBoot.ox
      : viewportWidthForPanelBoot - widthForPanelBoot - anchorForPanelBoot.ox;
    const rawTopForPanelBoot = anchorForPanelBoot.ay === 'top'
      ? anchorForPanelBoot.oy
      : viewportHeightForPanelBoot - heightForPanelBoot - anchorForPanelBoot.oy;
    const maxLeftForPanelBoot = Math.max(0, viewportWidthForPanelBoot - widthForPanelBoot);
    const maxTopForPanelBoot = Math.max(0, viewportHeightForPanelBoot - heightForPanelBoot);
    const leftForPanelBoot = Math.max(0, Math.min(maxLeftForPanelBoot, rawLeftForPanelBoot));
    const topForPanelBoot = Math.max(0, Math.min(maxTopForPanelBoot, rawTopForPanelBoot));
    panelHostForPanelBoot.style.left = leftForPanelBoot + 'px';
    panelHostForPanelBoot.style.top = topForPanelBoot + 'px';
    panelHostForPanelBoot.style.right = 'auto';
  }

  function startPrePaintStateApplyForPanelBoot(shadowRootForPanelBoot) {
    readStoredPaintStateForPanelBoot(function (stateForPanelBoot) {
      applyPrePaintModeForPanelBoot(shadowRootForPanelBoot, stateForPanelBoot.mode);
      applyPrePaintThemeForPanelBoot(shadowRootForPanelBoot, stateForPanelBoot.theme);
      if (stateForPanelBoot.panelAnchor && stateForPanelBoot.mode === 'reduced') {
        pendingPaintAnchorForPanelBoot = stateForPanelBoot.panelAnchor;
      }
      onPanelStateReadyForPanelBoot();
    });
  }

  function maybeShowVisibleForPanelBoot() {
    if (!showPendingForPanelBoot) return;
    if (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot) return;
    showPendingForPanelBoot = false;
    const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForPanelBoot) return;
    shadowHostForPanelBoot.style.display = 'block';
    // Anchor application reads offsetWidth/Height, which require layout, so
    // it must happen after display:block. Same synchronous task, so the
    // browser only paints once with all final styles in place.
    applyPendingPaintAnchorForPanelBoot(shadowHostForPanelBoot);
    const callbacksForPanelBoot = pendingVisibleCallbacksForPanelBoot.splice(0);
    callbacksForPanelBoot.forEach(function (cbForPanelBoot) {
      try { cbForPanelBoot(); } catch (eForPanelBoot) {}
    });
    reclampPanelPositionAfterOpenForPanelBoot();
  }

  function onPanelCssReadyForPanelBoot() {
    panelCssReadyForPanelBoot = true;
    maybeShowVisibleForPanelBoot();
  }

  function onPanelStateReadyForPanelBoot() {
    panelStateReadyForPanelBoot = true;
    maybeShowVisibleForPanelBoot();
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
      // Re-injection (extension reload, not page reload): the shadow root
      // carries the mode/theme/anchor from the previous session, so the
      // state gate can be flipped immediately without a fresh storage read.
      panelStateReadyForPanelBoot = true;
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

    // Kick off the async pre-paint state apply: read mode/theme/anchor from
    // chrome.storage and patch the just-built markup before the shadow host
    // is unhidden. This eliminates the expanded→reduced, light→dark, and
    // top-right→saved-anchor first-paint flashes on page navigation.
    startPrePaintStateApplyForPanelBoot(shadowRootForPanelBoot);

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
    // If showing and either readiness gate is not yet open (CSS not loaded
    // or pre-paint state not yet applied), queue the show until both are.
    // This prevents the FOUC where the panel briefly renders unstyled or in
    // the wrong mode/theme/position before snapping to the saved state.
    if (isVisibleForPanelBoot && (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot)) {
      showPendingForPanelBoot = true;
      return;
    }
    showPendingForPanelBoot = false;
    const wasHiddenForPanelBoot = shadowHostForPanelBoot.style.display === 'none';
    shadowHostForPanelBoot.style.display = isVisibleForPanelBoot ? 'block' : 'none';
    if (isVisibleForPanelBoot) {
      // Apply any anchor stashed by pre-paint apply now that the host has
      // layout (offsetWidth/Height are non-zero). Same synchronous task as
      // the display flip, so the browser only paints once.
      applyPendingPaintAnchorForPanelBoot(shadowHostForPanelBoot);
    }
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
    if (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot) {
      showPendingForPanelBoot = true;
      pendingVisibleCallbacksForPanelBoot.push(hidePanelHostNodeForPanelBoot);
      return;
    }
    shadowHostForInlineOnlyForPanelBoot.style.display = 'block';
    applyPendingPaintAnchorForPanelBoot(shadowHostForInlineOnlyForPanelBoot);
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
