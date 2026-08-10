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
  // Overlay-only shows track their own pending flag. showPending means "a real
  // panel open is queued behind the gates" and is cleared by any hide; sharing
  // it meant a transient hide (screenshot capture) silently dropped a queued
  // Quick Question show and left its callbacks to fire on the next real open.
  let overlayOnlyShowPendingForPanelBoot = false;
  let pendingVisibleCallbacksForPanelBoot = [];
  // Anchor stash: anchor needs offsetWidth/Height which require display:block,
  // so we hold the stored anchor here and apply it inside the show flip.
  let pendingPaintAnchorForPanelBoot = null;
  let inOverlayOnlyModeForPanelBoot = false;
  let panelClosedAtForPanelBoot = 0;
  const SYNC_ON_OPEN_THRESHOLD_MS_FOR_PANEL_BOOT = 10000;

  // A transient hide (the pre-screenshot hide) owns the shadow host until it ends.
  // The hide deliberately does not touch the shared open intent, so for its duration
  // the stored state says "open" while this tab's DOM says "closed": the exact
  // discrepancy every reconcile, activation push and optimistic show exists to heal by
  // re-opening. Any of them landing inside the window put the panel back on screen
  // mid-capture, and the screenshot caught it. While the lock is held, visibility
  // changes are recorded as intent and applied when it ends, and isVisible/isPanelOpen
  // keep answering with that intent so nothing sees a phantom close.
  let transientHideActiveForPanelBoot = false;
  let transientHideDesiredVisibleForPanelBoot = false;
  let transientHideExpiryTimerForPanelBoot = null;
  // Safety valve: a capture that never calls endTransientHide (throw, torn-down context,
  // extension reload mid-flight) must not leave the panel hidden and the lock standing.
  const TRANSIENT_HIDE_MAX_MS_FOR_PANEL_BOOT = 4000;

  // Storage keys must stay in sync with panelStateSync.js (mode, panelAnchor)
  // and the THEME_KEY_FOR_PANEL_RUNTIME constant in panelRuntime.js (theme).
  const PANEL_UI_FIELD_KEY_PREFIX_FOR_PANEL_BOOT = 'abchat_panel_ui_state_field_';
  const LEGACY_PANEL_UI_STATE_KEY_FOR_PANEL_BOOT = 'abchat_panel_ui_state';
  const THEME_KEY_FOR_PANEL_BOOT = 'abchat_theme';
  const HEADER_BTN_KEY_FOR_PANEL_BOOT = 'abchat_header_btn';

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
        THEME_KEY_FOR_PANEL_BOOT,
        HEADER_BTN_KEY_FOR_PANEL_BOOT
      ];
      chrome.storage.local.get(keysForPanelBoot, function (resForPanelBoot) {
        const outForPanelBoot = { mode: null, theme: null, panelAnchor: null, headerBtn: null };
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
        const headerBtnRawForPanelBoot = resForPanelBoot && resForPanelBoot[HEADER_BTN_KEY_FOR_PANEL_BOOT];
        if (headerBtnRawForPanelBoot === 'sync' || headerBtnRawForPanelBoot === 'theme') {
          outForPanelBoot.headerBtn = headerBtnRawForPanelBoot;
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
    // three modal overlays + the feature-tour overlay).
    const idsForPanelBoot = [
      'panel-host', 'inline-overlay', 'picker-overlay',
      'attach-preview-overlay', 'feature-tour-overlay'
    ];
    idsForPanelBoot.forEach(function (idForPanelBoot) {
      const elForPanelBoot = shadowRootForPanelBoot.getElementById(idForPanelBoot);
      if (elForPanelBoot) elForPanelBoot.dataset.theme = themeForPanelBoot;
    });
  }

  function applyPrePaintHeaderBtnForPanelBoot(shadowRootForPanelBoot, headerBtnForPanelBoot) {
    if (headerBtnForPanelBoot !== 'sync' && headerBtnForPanelBoot !== 'theme') return;
    const panelHostForPanelBoot = shadowRootForPanelBoot.getElementById('panel-host');
    if (!panelHostForPanelBoot) return;
    panelHostForPanelBoot.classList.remove('header-ctrl-sync', 'header-ctrl-theme');
    panelHostForPanelBoot.classList.add('header-ctrl-' + headerBtnForPanelBoot);
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
      applyPrePaintHeaderBtnForPanelBoot(shadowRootForPanelBoot, stateForPanelBoot.headerBtn);
      if (stateForPanelBoot.panelAnchor && stateForPanelBoot.mode === 'reduced') {
        pendingPaintAnchorForPanelBoot = stateForPanelBoot.panelAnchor;
      }
      onPanelStateReadyForPanelBoot();
    });
  }

  function maybeShowVisibleForPanelBoot() {
    if (!showPendingForPanelBoot && !overlayOnlyShowPendingForPanelBoot) return;
    if (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot) return;
    showPendingForPanelBoot = false;
    overlayOnlyShowPendingForPanelBoot = false;
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
        // Dark-theme variants. The pre-paint theme apply stamps data-theme on
        // #panel-host before the host is unhidden, so these match on first paint
        // and outspecify the base rules above. Values mirror the dark CSS
        // variables in panel.css (--abchat-bg-panel/border/accent/text-muted).
        '[data-theme="dark"] .libs-loading-overlay { background: #1e293b; }',
        '[data-theme="dark"] .libs-loading-spinner {',
        '  border-color: #4a657f; border-top-color: #3b82f6;',
        '}',
        '[data-theme="dark"] .libs-loading-label { color: #7a95b0; }',
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

  // Persist + broadcast the panel's open/closed intent. panelStateSync writes it
  // into the shared isOpen field, which the service worker reads as the
  // authoritative answer to "should this tab show the panel?". skipSync suppresses
  // the broadcast for transient LOCAL visibility changes that must not touch the
  // shared cross-tab open state, e.g. the pre-screenshot hide/restore. Guarded
  // internally by panelStateSync so applying a remote isOpen change does not echo
  // back.
  function writePanelVisibilityIntentForPanelBoot(isVisibleForIntent, skipSyncForIntent) {
    if (skipSyncForIntent) return;
    const syncNsForIntent =
      contentNamespaceForPanelBoot.ui && contentNamespaceForPanelBoot.ui.panelStateSync;
    if (syncNsForIntent && typeof syncNsForIntent.writeState === 'function') {
      syncNsForIntent.writeState({ isOpen: Boolean(isVisibleForIntent) });
    }
  }

  // Overlay-only mode displays the shadow host with #panel-host hidden, so the
  // Quick Question overlay can appear without the panel proper being open. Any
  // non-transient visibility change owns the host again and takes the mode
  // down: #panel-host is restored so an open shows the full panel, with the
  // overlay still above it (#inline-overlay outranks #panel-host on z-index).
  function exitOverlayOnlyModeForPanelBoot() {
    if (!inOverlayOnlyModeForPanelBoot) return;
    inOverlayOnlyModeForPanelBoot = false;
    overlayOnlyShowPendingForPanelBoot = false;
    const shadowHostForExitForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForExitForPanelBoot) return;
    const shadowRootForExitForPanelBoot = shadowHostForExitForPanelBoot.shadowRoot;
    if (!shadowRootForExitForPanelBoot) return;
    const panelHostForExitForPanelBoot = shadowRootForExitForPanelBoot.getElementById('panel-host');
    if (panelHostForExitForPanelBoot) panelHostForExitForPanelBoot.style.display = '';
  }

  // transient: a temporary local hide/restore that does not express panel
  // open/closed intent (the pre-screenshot hide). It leaves overlay-only mode
  // standing, so a capture taken while a Quick Question is up restores to the
  // overlay rather than to the full panel.
  function setPanelVisibleForPanelBoot(isVisibleForPanelBoot, optionsForPanelBoot) {
    const skipSyncForPanelBoot = Boolean(optionsForPanelBoot && optionsForPanelBoot.skipSync);
    const isTransientForPanelBoot = Boolean(optionsForPanelBoot && optionsForPanelBoot.transient);
    const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForPanelBoot) {
      return;
    }
    // A transient hide is in progress and this is not it: record the intent and leave
    // the host alone, so the capture keeps a panel-free viewport. The intent write below
    // still runs, so the shared open state stays truthful while the DOM flip waits.
    if (transientHideActiveForPanelBoot && !isTransientForPanelBoot) {
      transientHideDesiredVisibleForPanelBoot = Boolean(isVisibleForPanelBoot);
      writePanelVisibilityIntentForPanelBoot(isVisibleForPanelBoot, skipSyncForPanelBoot);
      return;
    }
    if (!isTransientForPanelBoot) {
      exitOverlayOnlyModeForPanelBoot();
    }
    // If showing and either readiness gate is not yet open (CSS not loaded
    // or pre-paint state not yet applied), queue the show until both are.
    // This prevents the FOUC where the panel briefly renders unstyled or in
    // the wrong mode/theme/position before snapping to the saved state.
    if (isVisibleForPanelBoot && (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot)) {
      showPendingForPanelBoot = true;
      // Persist the open intent now, even though the actual paint is deferred
      // behind the CSS/state readiness gates. Without this the SW's authoritative
      // isOpen stays false while the panel is about to become visible, so the next
      // cross-tab visibility reconcile resolves "should be closed" and tears the
      // just-opened panel back down: the flash-then-disappear seen on the first
      // icon click of a freshly loaded tab.
      writePanelVisibilityIntentForPanelBoot(isVisibleForPanelBoot, skipSyncForPanelBoot);
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
    // Broadcast visibility intent (debounced/merged into the shared isOpen
    // field). The deferred-show branch above fires the same helper so a gated
    // first paint still records the open before this point is reached.
    writePanelVisibilityIntentForPanelBoot(isVisibleForPanelBoot, skipSyncForPanelBoot);
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

  function armTransientHideExpiryForPanelBoot() {
    if (transientHideExpiryTimerForPanelBoot) {
      clearTimeout(transientHideExpiryTimerForPanelBoot);
    }
    transientHideExpiryTimerForPanelBoot = setTimeout(function () {
      transientHideExpiryTimerForPanelBoot = null;
      endTransientHideForPanelBoot();
    }, TRANSIENT_HIDE_MAX_MS_FOR_PANEL_BOOT);
  }

  // Hide the host for a capture and hold it hidden. Re-entrant: a retry that re-asserts
  // the hide keeps the recorded intent from the first call and only re-arms the expiry,
  // so a visibility change recorded between attempts is not lost.
  function beginTransientHideForPanelBoot() {
    const shadowHostForBeginForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForBeginForPanelBoot) return false;
    if (!transientHideActiveForPanelBoot) {
      transientHideDesiredVisibleForPanelBoot = shadowHostForBeginForPanelBoot.style.display !== 'none';
      transientHideActiveForPanelBoot = true;
    }
    armTransientHideExpiryForPanelBoot();
    setPanelVisibleForPanelBoot(false, { skipSync: true, transient: true });
    return true;
  }

  // Release the host and settle it on whatever visibility was last asked for. Returns the
  // applied visibility. A close that landed during the capture is honoured here rather
  // than being overwritten by an unconditional restore, which is how a panel could end up
  // visible in a tab whose shared state said closed.
  function endTransientHideForPanelBoot() {
    if (!transientHideActiveForPanelBoot) return false;
    if (transientHideExpiryTimerForPanelBoot) {
      clearTimeout(transientHideExpiryTimerForPanelBoot);
      transientHideExpiryTimerForPanelBoot = null;
    }
    transientHideActiveForPanelBoot = false;
    const desiredVisibleForEndForPanelBoot = transientHideDesiredVisibleForPanelBoot;
    transientHideDesiredVisibleForPanelBoot = false;
    if (desiredVisibleForEndForPanelBoot) {
      setPanelVisibleForPanelBoot(true, { skipSync: true, transient: true });
    } else {
      // Already hidden, so this only settles the side effects a real close carries
      // (overlay-only mode, closed-at stamp). The intent was written when it was recorded.
      setPanelVisibleForPanelBoot(false, { skipSync: true });
    }
    return desiredVisibleForEndForPanelBoot;
  }

  function showForInlineChatOnlyForPanelBoot() {
    if (!ensurePanelReadyForPanelBoot()) return;
    const shadowHostForInlineOnlyForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForInlineOnlyForPanelBoot) return;
    // Panel is already normally visible; nothing to do.
    if (shadowHostForInlineOnlyForPanelBoot.style.display !== 'none' && !inOverlayOnlyModeForPanelBoot) return;
    inOverlayOnlyModeForPanelBoot = true;
    function hidePanelHostNodeForPanelBoot() {
      // The mode can be exited while this callback waits in the queue (a real
      // open landed first). Hiding #panel-host then would blank the panel the
      // user just opened.
      if (!inOverlayOnlyModeForPanelBoot) return;
      const srForHideForPanelBoot = shadowHostForInlineOnlyForPanelBoot.shadowRoot;
      if (!srForHideForPanelBoot) return;
      const panelHostForHideForPanelBoot = srForHideForPanelBoot.getElementById('panel-host');
      if (panelHostForHideForPanelBoot) panelHostForHideForPanelBoot.style.display = 'none';
    }
    if (!panelCssReadyForPanelBoot || !panelStateReadyForPanelBoot) {
      overlayOnlyShowPendingForPanelBoot = true;
      pendingVisibleCallbacksForPanelBoot.push(hidePanelHostNodeForPanelBoot);
      return;
    }
    shadowHostForInlineOnlyForPanelBoot.style.display = 'block';
    applyPendingPaintAnchorForPanelBoot(shadowHostForInlineOnlyForPanelBoot);
    hidePanelHostNodeForPanelBoot();
  }

  // Early return when the mode is already down: the panel was opened over the
  // overlay, so it owns the host now and closing the Quick Question must leave
  // it standing rather than hide the panel the user is using.
  function restoreAfterInlineChatOnlyForPanelBoot() {
    if (!inOverlayOnlyModeForPanelBoot) return;
    exitOverlayOnlyModeForPanelBoot();
    const shadowHostForRestoreForPanelBoot = document.getElementById('abchat-panel-shadow-host');
    if (!shadowHostForRestoreForPanelBoot) return;
    shadowHostForRestoreForPanelBoot.style.display = 'none';
  }

  contentNamespaceForPanelBoot.ui.panel = {
    ensureReady: ensurePanelReadyForPanelBoot,
    setVisible: setPanelVisibleForPanelBoot,
    beginTransientHide: beginTransientHideForPanelBoot,
    endTransientHide: endTransientHideForPanelBoot,
    showForInlineChatOnly: showForInlineChatOnlyForPanelBoot,
    restoreAfterInlineChatOnly: restoreAfterInlineChatOnlyForPanelBoot,
    // Raw "is any panel UI on screen in this tab?". True in overlay-only mode.
    // Use it for questions about the shadow host itself (can an overlay be
    // shown right now, is there extension UI to hide before a screenshot).
    // During a transient hide this answers with the panel's logical visibility, not
    // the momentarily hidden host: a caller that read the raw display would see a
    // close that never happened and act on it (re-show it, tear down the overlay,
    // report it to the service worker). Code that needs the rendered state, i.e. the
    // capture's own "is the panel really off screen?" check, must read the DOM.
    isVisible: function isVisibleForPanelBoot() {
      if (transientHideActiveForPanelBoot) return transientHideDesiredVisibleForPanelBoot;
      const shadowHostForPanelBoot = document.getElementById('abchat-panel-shadow-host');
      return Boolean(shadowHostForPanelBoot && shadowHostForPanelBoot.style.display !== 'none');
    },
    // "Is the panel proper open in this tab?". False in overlay-only mode, so
    // it matches the shared isOpen intent the service worker arbitrates. Every
    // visibility decision must use this one: deciding on isVisible made each
    // close verdict resolve "showing but should not be" against a Quick
    // Question overlay and tear it down.
    isPanelOpen: function isPanelOpenForPanelBoot() {
      if (inOverlayOnlyModeForPanelBoot) return false;
      if (transientHideActiveForPanelBoot) return transientHideDesiredVisibleForPanelBoot;
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
