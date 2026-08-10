(function () {
  const globalScopeForScreenshotCapture = globalThis;
  const contentNamespaceForScreenshotCapture = globalScopeForScreenshotCapture.ABChatContent || {};

  const PANEL_SHADOW_HOST_ID_FOR_SCREENSHOT_CAPTURE = 'abchat-panel-shadow-host';
  const HIDDEN_CONFIRM_ATTEMPTS_FOR_SCREENSHOT_CAPTURE = 8;
  const CAPTURE_ATTEMPTS_FOR_SCREENSHOT_CAPTURE = 3;
  // chrome.tabs.captureVisibleTab is quota-limited to a couple of calls per second, and an
  // over-quota call fails outright. Retries wait this long on top of the hidden-confirmation
  // wait so a retry is never spent on a quota error instead of a real attempt.
  const RETRY_DELAY_MS_FOR_SCREENSHOT_CAPTURE = 450;

  function getSharedActionsForScreenshotCapture() {
    const sharedNamespaceForScreenshotCapture = globalScopeForScreenshotCapture.ABChatShared || {};
    return sharedNamespaceForScreenshotCapture.actions || {};
  }

  function getPanelControllerForScreenshotCapture() {
    const uiNamespaceForScreenshotCapture = contentNamespaceForScreenshotCapture.ui || {};
    return uiNamespaceForScreenshotCapture.panel || null;
  }

  function waitMsForScreenshotCapture(msForScreenshotCapture) {
    return new Promise(function (resolveForScreenshotCapture) {
      setTimeout(resolveForScreenshotCapture, Math.max(0, Number(msForScreenshotCapture) || 0));
    });
  }

  function waitForAnimationFramesForScreenshotCapture(frameCountForScreenshotCapture) {
    return new Promise(function (resolveForScreenshotCapture) {
      if (typeof requestAnimationFrame !== 'function') {
        setTimeout(resolveForScreenshotCapture, 34);
        return;
      }
      let framesRemainingForScreenshotCapture = Number(frameCountForScreenshotCapture) || 1;
      if (!Number.isFinite(framesRemainingForScreenshotCapture) || framesRemainingForScreenshotCapture < 1) {
        framesRemainingForScreenshotCapture = 1;
      }
      function consumeFrameForScreenshotCapture() {
        framesRemainingForScreenshotCapture -= 1;
        if (framesRemainingForScreenshotCapture <= 0) {
          resolveForScreenshotCapture();
          return;
        }
        requestAnimationFrame(consumeFrameForScreenshotCapture);
      }
      requestAnimationFrame(consumeFrameForScreenshotCapture);
    });
  }

  // Reads the live DOM rather than the panel controller's isVisible(), which reports
  // the panel's logical open state and stays true for the duration of a transient hide.
  // Only the rendered state answers "can this still land in the captured frame?".
  function isPanelUiHiddenForScreenshotCapture(panelShadowHostForScreenshotCapture) {
    if (!panelShadowHostForScreenshotCapture) return true;
    if (panelShadowHostForScreenshotCapture.hidden) return true;
    if (panelShadowHostForScreenshotCapture.style && panelShadowHostForScreenshotCapture.style.display === 'none') return true;
    if (typeof window.getComputedStyle !== 'function') return false;
    const computedStyleForScreenshotCapture = window.getComputedStyle(panelShadowHostForScreenshotCapture);
    return (
      computedStyleForScreenshotCapture.display === 'none' ||
      computedStyleForScreenshotCapture.visibility === 'hidden' ||
      computedStyleForScreenshotCapture.opacity === '0'
    );
  }

  async function waitForPanelUiHiddenConfirmationForScreenshotCapture(
    panelShadowHostForScreenshotCapture,
    maxAttemptsForScreenshotCapture
  ) {
    let attemptsForScreenshotCapture = Number(maxAttemptsForScreenshotCapture);
    if (!Number.isFinite(attemptsForScreenshotCapture) || attemptsForScreenshotCapture < 1) {
      attemptsForScreenshotCapture = 1;
    }
    for (let attemptForScreenshotCapture = 0; attemptForScreenshotCapture < attemptsForScreenshotCapture; attemptForScreenshotCapture++) {
      if (isPanelUiHiddenForScreenshotCapture(panelShadowHostForScreenshotCapture)) {
        // Confirmation passed, wait additional frames to reduce compositor race captures.
        await waitForAnimationFramesForScreenshotCapture(2);
        await waitMsForScreenshotCapture(60);
        return true;
      }
      await waitForAnimationFramesForScreenshotCapture(1);
      await waitMsForScreenshotCapture(25);
    }
    return isPanelUiHiddenForScreenshotCapture(panelShadowHostForScreenshotCapture);
  }

  function sendCaptureRequestForScreenshotCapture() {
    return new Promise(function (resolveForScreenshotCapture) {
      const actionForScreenshotCapture =
        getSharedActionsForScreenshotCapture().captureVisibleTabScreenshot || 'captureVisibleTabScreenshot';
      try {
        chrome.runtime.sendMessage({ action: actionForScreenshotCapture }, function (responseForScreenshotCapture) {
          if (chrome.runtime.lastError) {
            resolveForScreenshotCapture({
              ok: false,
              error: chrome.runtime.lastError.message || 'Screenshot capture failed.'
            });
            return;
          }
          resolveForScreenshotCapture(responseForScreenshotCapture || { ok: false, error: 'Screenshot capture failed.' });
        });
      } catch (errorForScreenshotCapture) {
        resolveForScreenshotCapture({
          ok: false,
          error: (errorForScreenshotCapture && errorForScreenshotCapture.message) || 'Screenshot capture failed.'
        });
      }
    });
  }

  // Hiding the panel host is not enough on its own: the transient hide leaves the shared
  // open intent saying "open", so any reconcile, activation push or optimistic show that
  // lands mid-capture wants to put the panel straight back on screen, and the capture then
  // catches it. beginTransientHide takes ownership of the host for the duration, holding
  // those changes as recorded intent instead of DOM flips. The post-capture check below is
  // the backstop for any restore path that bypasses the panel controller.
  function hidePanelForScreenshotCapture(panelControllerForScreenshotCapture, panelShadowHostForScreenshotCapture) {
    if (panelControllerForScreenshotCapture && typeof panelControllerForScreenshotCapture.beginTransientHide === 'function') {
      try {
        panelControllerForScreenshotCapture.beginTransientHide();
        return;
      } catch (errorForScreenshotCapture) {}
    }
    if (panelControllerForScreenshotCapture && typeof panelControllerForScreenshotCapture.setVisible === 'function') {
      try {
        panelControllerForScreenshotCapture.setVisible(false, { skipSync: true, transient: true });
        return;
      } catch (errorForScreenshotCapture) {}
    }
    if (panelShadowHostForScreenshotCapture) panelShadowHostForScreenshotCapture.style.display = 'none';
  }

  function restorePanelAfterScreenshotCapture(panelControllerForScreenshotCapture, panelShadowHostForScreenshotCapture) {
    if (panelControllerForScreenshotCapture && typeof panelControllerForScreenshotCapture.endTransientHide === 'function') {
      try {
        panelControllerForScreenshotCapture.endTransientHide();
        return;
      } catch (errorForScreenshotCapture) {}
    }
    if (panelControllerForScreenshotCapture && typeof panelControllerForScreenshotCapture.setVisible === 'function') {
      try {
        panelControllerForScreenshotCapture.setVisible(true, { skipSync: true, transient: true });
        return;
      } catch (errorForScreenshotCapture) {}
    }
    if (panelShadowHostForScreenshotCapture) panelShadowHostForScreenshotCapture.style.display = 'block';
  }

  // Single capture routine for both entry points: the panel's screenshot attachment and the
  // offscreen loop's delegated __capture_screenshot__. Resolves { ok, dataUrl, size } or
  // { ok: false, error }, and never rejects.
  async function captureVisibleTabWithoutPanelUiForScreenshotCapture() {
    const panelControllerForScreenshotCapture = getPanelControllerForScreenshotCapture();
    let didHidePanelForScreenshotCapture = false;

    // Re-read the host and its rendered state on every attempt rather than deciding once:
    // the panel can be mounted, opened or restored at any point during the capture, and a
    // decision taken before the first attempt would miss it.
    async function ensurePanelHiddenForScreenshotCapture() {
      const panelShadowHostForEnsure = document.getElementById(PANEL_SHADOW_HOST_ID_FOR_SCREENSHOT_CAPTURE);
      if (isPanelUiHiddenForScreenshotCapture(panelShadowHostForEnsure)) return true;
      hidePanelForScreenshotCapture(panelControllerForScreenshotCapture, panelShadowHostForEnsure);
      didHidePanelForScreenshotCapture = true;
      return await waitForPanelUiHiddenConfirmationForScreenshotCapture(
        panelShadowHostForEnsure,
        HIDDEN_CONFIRM_ATTEMPTS_FOR_SCREENSHOT_CAPTURE
      );
    }

    try {
      let lastResponseForScreenshotCapture = null;
      for (
        let attemptForScreenshotCapture = 0;
        attemptForScreenshotCapture < CAPTURE_ATTEMPTS_FOR_SCREENSHOT_CAPTURE;
        attemptForScreenshotCapture++
      ) {
        if (attemptForScreenshotCapture > 0) {
          await waitMsForScreenshotCapture(RETRY_DELAY_MS_FOR_SCREENSHOT_CAPTURE);
        }
        if (!(await ensurePanelHiddenForScreenshotCapture())) {
          lastResponseForScreenshotCapture = { ok: false, error: 'Could not hide extension UI before screenshot.' };
          continue;
        }
        if (attemptForScreenshotCapture > 0) {
          await waitForAnimationFramesForScreenshotCapture(2);
        }
        const responseForScreenshotCapture = await sendCaptureRequestForScreenshotCapture();
        lastResponseForScreenshotCapture = responseForScreenshotCapture;
        if (!responseForScreenshotCapture || !responseForScreenshotCapture.ok || !responseForScreenshotCapture.dataUrl) {
          continue;
        }
        // The capture succeeded, but the frame it returned is only usable if the panel
        // stayed off screen for the whole round trip. A panel that is showing now came back
        // at some point during it, so the image may contain the panel: discard and retry.
        if (isPanelUiHiddenForScreenshotCapture(document.getElementById(PANEL_SHADOW_HOST_ID_FOR_SCREENSHOT_CAPTURE))) {
          return responseForScreenshotCapture;
        }
        lastResponseForScreenshotCapture = { ok: false, error: 'Extension UI reappeared during the screenshot.' };
      }
      return lastResponseForScreenshotCapture || { ok: false, error: 'Screenshot capture failed.' };
    } finally {
      if (didHidePanelForScreenshotCapture) {
        restorePanelAfterScreenshotCapture(
          panelControllerForScreenshotCapture,
          document.getElementById(PANEL_SHADOW_HOST_ID_FOR_SCREENSHOT_CAPTURE)
        );
      }
    }
  }

  contentNamespaceForScreenshotCapture.screenshotCapture = {
    captureWithoutPanelUi: captureVisibleTabWithoutPanelUiForScreenshotCapture,
    isPanelUiHidden: isPanelUiHiddenForScreenshotCapture
  };

  globalScopeForScreenshotCapture.ABChatContent = contentNamespaceForScreenshotCapture;
})();
