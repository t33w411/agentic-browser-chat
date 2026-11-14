(function () {
  const globalScopeForInjectionIndicator = globalThis;
  const existingBackgroundNamespaceForInjectionIndicator = globalScopeForInjectionIndicator.ABChatBackground || {};

  // Shows, on the toolbar icon of one tab, that the content scripts are being loaded into it:
  // the icon darkens and an arc turns on it, and the icon comes back when the tab is ready. This
  // happens on the first switch to a tab after an extension reload, and on any other tab that
  // has no live copy when something needs one.

  const frameCountForInjectionIndicator = 12;
  const frameIntervalMsForInjectionIndicator = 80;
  // Loading usually takes a fraction of a second, less than the eye needs to see the arc turn,
  // so the indicator stays up at least this long.
  const minVisibleMsForInjectionIndicator = 700;
  // An injection can stall on a frozen or busy tab. The indicator gives up before the caller
  // does, and well inside the service worker's idle limit, so a stopped worker cannot leave a
  // tab's icon frozen on a frame.
  const maxVisibleMsForInjectionIndicator = 15000;
  const iconSizesForInjectionIndicator = [16, 32];
  // The arc is drawn inside the icon's own square, over a shade laid on the icon, so it reads the
  // same on a light toolbar and a dark one.
  const arcColorForInjectionIndicator = "#ffffff";
  const iconShadeForInjectionIndicator = "rgba(6, 10, 22, 0.62)";
  const busyTitleSuffixForInjectionIndicator = ": loading in this tab...";

  const runsByTabIdForInjectionIndicator = new Map();
  let framesPromiseForInjectionIndicator = null;
  // The icon as it normally looks, drawn at the toolbar sizes. A tab has no "clear my icon" call,
  // so the only way to end the animation is to set the normal icon again, and this is what is set.
  // It is not set from the icon file: Chrome refuses an icon wider than 160 pixels ("Icon
  // invalid."), the file is 1079, and a tab whose icon cannot be put back keeps the last frame.
  let plainIconImageDataForInjectionIndicator = null;
  // What Chrome did with the icon changes since the worker started. The icon cannot be read back,
  // so these counts are the only evidence that a frame or a restore was accepted.
  const statsForInjectionIndicator = { framesPainted: 0, framesRefused: 0, iconsRestored: 0, restoresRefused: 0 };

  function manifestActionForInjectionIndicator() {
    try {
      const manifestForInjectionIndicator = chrome.runtime.getManifest() || {};
      return manifestForInjectionIndicator.action || {};
    } catch (errorForInjectionIndicator) {
      return {};
    }
  }

  function defaultTitleForInjectionIndicator() {
    return manifestActionForInjectionIndicator().default_title || "";
  }

  function drawPlainIconForInjectionIndicator(bitmapForPlain, sizeForPlain) {
    const canvasForPlain = new OffscreenCanvas(sizeForPlain, sizeForPlain);
    const contextForPlain = canvasForPlain.getContext("2d");
    if (!contextForPlain) return null;
    contextForPlain.drawImage(bitmapForPlain, 0, 0, sizeForPlain, sizeForPlain);
    return contextForPlain.getImageData(0, 0, sizeForPlain, sizeForPlain);
  }

  function drawFrameForInjectionIndicator(bitmapForFrame, sizeForFrame, frameIndexForFrame) {
    const canvasForFrame = new OffscreenCanvas(sizeForFrame, sizeForFrame);
    const contextForFrame = canvasForFrame.getContext("2d");
    if (!contextForFrame) return null;
    contextForFrame.clearRect(0, 0, sizeForFrame, sizeForFrame);
    contextForFrame.drawImage(bitmapForFrame, 0, 0, sizeForFrame, sizeForFrame);
    // source-atop keeps the shade to the icon's own pixels, so a transparent corner stays clear.
    contextForFrame.globalCompositeOperation = "source-atop";
    contextForFrame.fillStyle = iconShadeForInjectionIndicator;
    contextForFrame.fillRect(0, 0, sizeForFrame, sizeForFrame);
    contextForFrame.globalCompositeOperation = "source-over";

    const lineWidthForFrame = Math.max(2, sizeForFrame / 7);
    const radiusForFrame = sizeForFrame / 2 - lineWidthForFrame / 2 - sizeForFrame / 8;
    const startAngleForFrame = (frameIndexForFrame / frameCountForInjectionIndicator) * Math.PI * 2 - Math.PI / 2;
    contextForFrame.lineCap = "round";
    contextForFrame.lineWidth = lineWidthForFrame;
    contextForFrame.strokeStyle = arcColorForInjectionIndicator;
    contextForFrame.beginPath();
    contextForFrame.arc(sizeForFrame / 2, sizeForFrame / 2, radiusForFrame, startAngleForFrame, startAngleForFrame + Math.PI * 1.35);
    contextForFrame.stroke();
    return contextForFrame.getImageData(0, 0, sizeForFrame, sizeForFrame);
  }

  async function buildFramesForInjectionIndicator() {
    if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") return null;
    const iconPathsForFrames = manifestActionForInjectionIndicator().default_icon;
    const iconPathForFrames = typeof iconPathsForFrames === "string"
      ? iconPathsForFrames
      : iconPathsForFrames && (iconPathsForFrames["32"] || iconPathsForFrames["16"]);
    if (!iconPathForFrames) return null;
    const responseForFrames = await fetch(chrome.runtime.getURL(iconPathForFrames));
    if (!responseForFrames.ok) return null;
    const blobForFrames = await responseForFrames.blob();
    const bitmapsForFrames = {};
    for (const sizeForFrames of iconSizesForInjectionIndicator) {
      bitmapsForFrames[sizeForFrames] = await createImageBitmap(blobForFrames, {
        resizeWidth: sizeForFrames,
        resizeHeight: sizeForFrames,
        resizeQuality: "high"
      });
    }
    const plainImageDataForFrames = {};
    for (const sizeForFrames of iconSizesForInjectionIndicator) {
      plainImageDataForFrames[sizeForFrames] = drawPlainIconForInjectionIndicator(bitmapsForFrames[sizeForFrames], sizeForFrames);
      if (!plainImageDataForFrames[sizeForFrames]) return null;
    }
    plainIconImageDataForInjectionIndicator = plainImageDataForFrames;
    const framesForInjectionIndicator = [];
    for (let frameIndexForFrames = 0; frameIndexForFrames < frameCountForInjectionIndicator; frameIndexForFrames++) {
      const imageDataBySizeForFrames = {};
      for (const sizeForFrames of iconSizesForInjectionIndicator) {
        const imageDataForFrames = drawFrameForInjectionIndicator(bitmapsForFrames[sizeForFrames], sizeForFrames, frameIndexForFrames);
        if (!imageDataForFrames) return null;
        imageDataBySizeForFrames[sizeForFrames] = imageDataForFrames;
      }
      framesForInjectionIndicator.push(imageDataBySizeForFrames);
    }
    return framesForInjectionIndicator;
  }

  // Built once per worker start. A failure is not kept, so the next injection tries again; until
  // then the indicator is the tooltip alone.
  function getFramesForInjectionIndicator() {
    if (!framesPromiseForInjectionIndicator) {
      framesPromiseForInjectionIndicator = buildFramesForInjectionIndicator()
        .catch(function () {
          return null;
        })
        .then(function (framesForInjectionIndicator) {
          if (!framesForInjectionIndicator) framesPromiseForInjectionIndicator = null;
          return framesForInjectionIndicator;
        });
    }
    return framesPromiseForInjectionIndicator;
  }

  // Every chrome.action call here can fail: the tab may have closed while its scripts loaded.
  // The callback form is used on purpose. The promise form of setIcon resolves even when Chrome
  // refuses the icon, and the refusal only shows up as an unchecked runtime.lastError.
  function callActionForInjectionIndicator(methodNameForCall, detailsForCall) {
    return new Promise(function (resolveForCall) {
      try {
        if (!chrome.action || typeof chrome.action[methodNameForCall] !== "function") {
          resolveForCall(false);
          return;
        }
        chrome.action[methodNameForCall](detailsForCall, function () {
          resolveForCall(!chrome.runtime.lastError);
        });
      } catch (errorForCall) {
        resolveForCall(false);
      }
    });
  }

  // Puts the tab's normal icon back. Resolves false when Chrome did not take it.
  async function restoreIconForInjectionIndicator(tabIdForRestore) {
    // No frames were built, so no frame was ever painted and the tab still has its normal icon.
    if (!plainIconImageDataForInjectionIndicator) return true;
    const didRestoreForInjectionIndicator = await callActionForInjectionIndicator("setIcon", {
      tabId: tabIdForRestore,
      imageData: plainIconImageDataForInjectionIndicator
    });
    if (didRestoreForInjectionIndicator) {
      statsForInjectionIndicator.iconsRestored += 1;
    } else {
      statsForInjectionIndicator.restoresRefused += 1;
    }
    return didRestoreForInjectionIndicator;
  }

  function finishRunForInjectionIndicator(runForFinish) {
    if (runsByTabIdForInjectionIndicator.get(runForFinish.tabId) !== runForFinish) return;
    runsByTabIdForInjectionIndicator.delete(runForFinish.tabId);
    runForFinish.finished = true;
    if (runForFinish.frameTimer !== null) clearInterval(runForFinish.frameTimer);
    if (runForFinish.stopTimer !== null) clearTimeout(runForFinish.stopTimer);
    if (runForFinish.capTimer !== null) clearTimeout(runForFinish.capTimer);
    runForFinish.frameTimer = null;
    runForFinish.stopTimer = null;
    runForFinish.capTimer = null;

    restoreIconForInjectionIndicator(runForFinish.tabId).catch(function () {});
    callActionForInjectionIndicator("setTitle", { tabId: runForFinish.tabId, title: defaultTitleForInjectionIndicator() });
  }

  function paintNextFrameForInjectionIndicator(runForPaint, framesForPaint) {
    if (runForPaint.finished) return;
    const frameForPaint = framesForPaint[runForPaint.frameIndex % framesForPaint.length];
    runForPaint.frameIndex += 1;
    callActionForInjectionIndicator("setIcon", { tabId: runForPaint.tabId, imageData: frameForPaint })
      .then(function (didPaintForInjectionIndicator) {
        if (didPaintForInjectionIndicator) {
          statsForInjectionIndicator.framesPainted += 1;
          return;
        }
        // Most likely the tab is gone. Stop either way: there is no point repeating a refused call.
        statsForInjectionIndicator.framesRefused += 1;
        finishRunForInjectionIndicator(runForPaint);
      });
  }

  function startForInjectionIndicator(tabIdForStart) {
    if (typeof tabIdForStart !== "number") return;
    const existingRunForStart = runsByTabIdForInjectionIndicator.get(tabIdForStart);
    if (existingRunForStart) {
      // A new load began while the last one was still showing: keep the same animation going.
      if (existingRunForStart.stopTimer !== null) clearTimeout(existingRunForStart.stopTimer);
      existingRunForStart.stopTimer = null;
      existingRunForStart.stopRequested = false;
      return;
    }
    const runForStart = {
      tabId: tabIdForStart,
      startedAt: Date.now(),
      frameIndex: 0,
      frameTimer: null,
      stopTimer: null,
      capTimer: null,
      stopRequested: false,
      finished: false
    };
    runsByTabIdForInjectionIndicator.set(tabIdForStart, runForStart);
    runForStart.capTimer = setTimeout(function () {
      finishRunForInjectionIndicator(runForStart);
    }, maxVisibleMsForInjectionIndicator);
    callActionForInjectionIndicator("setTitle", {
      tabId: tabIdForStart,
      title: defaultTitleForInjectionIndicator() + busyTitleSuffixForInjectionIndicator
    });
    getFramesForInjectionIndicator().then(function (framesForStart) {
      if (!framesForStart || !framesForStart.length || runForStart.finished) return;
      paintNextFrameForInjectionIndicator(runForStart, framesForStart);
      runForStart.frameTimer = setInterval(function () {
        paintNextFrameForInjectionIndicator(runForStart, framesForStart);
      }, frameIntervalMsForInjectionIndicator);
    });
  }

  function stopForInjectionIndicator(tabIdForStop) {
    const runForStop = runsByTabIdForInjectionIndicator.get(tabIdForStop);
    if (!runForStop || runForStop.stopRequested) return;
    runForStop.stopRequested = true;
    const remainingMsForStop = minVisibleMsForInjectionIndicator - (Date.now() - runForStop.startedAt);
    if (remainingMsForStop <= 0) {
      finishRunForInjectionIndicator(runForStop);
      return;
    }
    runForStop.stopTimer = setTimeout(function () {
      finishRunForInjectionIndicator(runForStop);
    }, remainingMsForStop);
  }

  globalScopeForInjectionIndicator.ABChatBackground = {
    ...existingBackgroundNamespaceForInjectionIndicator,
    injectionIndicator: {
      start: startForInjectionIndicator,
      stop: stopForInjectionIndicator,
      restoreIcon: restoreIconForInjectionIndicator,
      getFrames: getFramesForInjectionIndicator,
      getStats: function () {
        return Object.assign({}, statsForInjectionIndicator);
      }
    }
  };
})();
