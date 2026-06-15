(function () {
  var globalScopeForCdp = globalThis;
  var nsForCdp = globalScopeForCdp.ABChatBackground || {};

  var AUTOMATION_ENABLED_KEY_FOR_CDP = "abchatAutomationEnabled";
  var AUTOMATION_ENABLED_TS_KEY_FOR_CDP = "abchatAutomationEnabledTs";
  var CDP_PROTOCOL_VERSION_FOR_CDP = "1.3";
  var CDP_IDLE_DETACH_MS_FOR_CDP = 8000;
  var sessionsForCdp = new Map();
  var debuggerListenersBoundForCdp = false;

  // ---- Behavioral enable/disable ----
  // The debugger permission is required at install (Chrome forbids listing it
  // as optional), so the user-facing gate is a stored flag (default off), not a
  // permission grant. State syncs across tabs through storage.onChanged.

  function isAutomationEnabledForCdp() {
    return new Promise(function (resolveForEnabled) {
      try {
        chrome.storage.local.get(AUTOMATION_ENABLED_KEY_FOR_CDP, function (itemsForEnabled) {
          if (chrome.runtime.lastError) {
            resolveForEnabled(false);
            return;
          }
          resolveForEnabled(!!(itemsForEnabled && itemsForEnabled[AUTOMATION_ENABLED_KEY_FOR_CDP]));
        });
      } catch (errForEnabled) {
        resolveForEnabled(false);
      }
    });
  }

  function setAutomationEnabledForCdp(enabledForSet) {
    return new Promise(function (resolveForSet) {
      var payloadForSet = {};
      payloadForSet[AUTOMATION_ENABLED_KEY_FOR_CDP] = !!enabledForSet;
      payloadForSet[AUTOMATION_ENABLED_TS_KEY_FOR_CDP] = Date.now();
      try {
        chrome.storage.local.set(payloadForSet, function () {
          void chrome.runtime.lastError;
          // Disable-side teardown is handled by the storage.onChanged listener
          // below, so it fires no matter who flipped the flag.
          resolveForSet(!!enabledForSet);
        });
      } catch (errForSet) {
        resolveForSet(!!enabledForSet);
      }
    });
  }

  function openConsentWindowForCdp() {
    return new Promise(function (resolveForOpen) {
      try {
        var urlForOpen = chrome.runtime.getURL("automationConsent.html");
        chrome.windows.create(
          { type: "popup", url: urlForOpen, width: 460, height: 400 },
          function (windowForOpen) {
            if (chrome.runtime.lastError) {
              resolveForOpen(false);
              return;
            }
            resolveForOpen(!!windowForOpen);
          }
        );
      } catch (errForOpen) {
        resolveForOpen(false);
      }
    });
  }

  // ---- CDP debugger session lease ----

  function makeCdpErrorForCdp(codeForErr, messageForErr) {
    var errObjForCdp = new Error(messageForErr || codeForErr || "Automation error.");
    errObjForCdp.code = codeForErr || "attach-failed";
    return errObjForCdp;
  }

  function failureFromErrorForCdp(errForFailure) {
    return {
      ok: false,
      error: {
        code: (errForFailure && errForFailure.code) || "attach-failed",
        message: (errForFailure && errForFailure.message) || "Automation error."
      }
    };
  }

  function getSessionForCdp(tabIdForSession) {
    var sessionForGet = sessionsForCdp.get(tabIdForSession);
    if (!sessionForGet) {
      sessionForGet = {
        state: "DETACHED",
        refCount: 0,
        idleTimer: null,
        attachPromise: null,
        detachPromise: null,
        lastDetachReason: null,
        lastDialog: null
      };
      sessionsForCdp.set(tabIdForSession, sessionForGet);
    }
    return sessionForGet;
  }

  function classifyAttachErrorForCdp(messageForClassify) {
    var msgForClassify = messageForClassify || "";
    if (/already attached|already being debugged/i.test(msgForClassify)) {
      return makeCdpErrorForCdp("another-debugger-attached", msgForClassify);
    }
    if (/cannot attach|cannot access|devtools|chrome:\/\/|chromewebstore|restricted|extension/i.test(msgForClassify)) {
      return makeCdpErrorForCdp("restricted-page", msgForClassify);
    }
    return makeCdpErrorForCdp("attach-failed", msgForClassify || "Attach failed.");
  }

  function handleDebuggerDetachForCdp(sourceForDetach, reasonForDetach) {
    if (!sourceForDetach || typeof sourceForDetach.tabId !== "number") {
      return;
    }
    var sessionForDetach = sessionsForCdp.get(sourceForDetach.tabId);
    if (!sessionForDetach) {
      return;
    }
    if (sessionForDetach.idleTimer) {
      clearTimeout(sessionForDetach.idleTimer);
      sessionForDetach.idleTimer = null;
    }
    sessionForDetach.state = "DETACHED";
    sessionForDetach.refCount = 0;
    sessionForDetach.attachPromise = null;
    sessionForDetach.detachPromise = null;
    sessionForDetach.lastDetachReason = reasonForDetach || null;
  }

  function dialogAcceptPolicyForCdp(dialogTypeForPolicy) {
    // Accept info alerts and beforeunload (so the navigation the agent intended proceeds, which also
    // clears the agent leave-warning prompt); dismiss confirm/prompt by default so automation never
    // auto-confirms a potentially destructive action.
    return dialogTypeForPolicy === "alert" || dialogTypeForPolicy === "beforeunload";
  }

  function handleDebuggerEventForCdp(sourceForEvent, methodForEvent, paramsForEvent) {
    if (methodForEvent !== "Page.javascriptDialogOpening") {
      return;
    }
    if (!sourceForEvent || typeof sourceForEvent.tabId !== "number") {
      return;
    }
    var sessionForEvent = sessionsForCdp.get(sourceForEvent.tabId);
    if (!sessionForEvent) {
      return;
    }
    var dialogTypeForEvent = (paramsForEvent && paramsForEvent.type) || "alert";
    var acceptForEvent = dialogAcceptPolicyForCdp(dialogTypeForEvent);
    sessionForEvent.lastDialog = {
      type: dialogTypeForEvent,
      message: (paramsForEvent && paramsForEvent.message) || "",
      accepted: acceptForEvent,
      at: Date.now()
    };
    try {
      chrome.debugger.sendCommand({ tabId: sourceForEvent.tabId }, "Page.handleJavaScriptDialog", { accept: acceptForEvent }, function () {
        void chrome.runtime.lastError;
      });
    } catch (eHandleDialogForEvent) {
      /* ignore */
    }
  }

  function delayForCdp(msForDelay) {
    return new Promise(function (resolveForDelay) { setTimeout(resolveForDelay, msForDelay); });
  }

  function ensureDebuggerListenersForCdp() {
    if (debuggerListenersBoundForCdp) {
      return;
    }
    if (!chrome.debugger || !chrome.debugger.onDetach || typeof chrome.debugger.onDetach.addListener !== "function") {
      return;
    }
    try {
      chrome.debugger.onDetach.addListener(handleDebuggerDetachForCdp);
      if (chrome.debugger.onEvent && typeof chrome.debugger.onEvent.addListener === "function") {
        chrome.debugger.onEvent.addListener(handleDebuggerEventForCdp);
      }
      debuggerListenersBoundForCdp = true;
    } catch (errForEnsure) {
      /* ignore */
    }
  }

  function attachDebuggerForCdp(tabIdForAttach) {
    return new Promise(function (resolveForAttach, rejectForAttach) {
      if (!chrome.debugger || typeof chrome.debugger.attach !== "function") {
        rejectForAttach(makeCdpErrorForCdp("attach-failed", "Debugger API is unavailable. Reload the extension."));
        return;
      }
      try {
        chrome.debugger.attach({ tabId: tabIdForAttach }, CDP_PROTOCOL_VERSION_FOR_CDP, function () {
          if (chrome.runtime.lastError) {
            rejectForAttach(classifyAttachErrorForCdp(chrome.runtime.lastError.message));
            return;
          }
          ensureDebuggerListenersForCdp();
          // Enable Page so JS dialogs (alert/confirm/prompt/beforeunload) surface as events we can
          // auto-handle. With a debugger attached and Page enabled, the native dialog UI is suppressed
          // and the page blocks until Page.handleJavaScriptDialog, so handling them is mandatory.
          try {
            chrome.debugger.sendCommand({ tabId: tabIdForAttach }, "Page.enable", {}, function () {
              void chrome.runtime.lastError;
              resolveForAttach(true);
            });
          } catch (ePageEnableForAttach) {
            resolveForAttach(true);
          }
        });
      } catch (errForAttach) {
        rejectForAttach(makeCdpErrorForCdp("attach-failed", (errForAttach && errForAttach.message) || "Attach threw."));
      }
    });
  }

  function detachDebuggerForCdp(tabIdForDetach) {
    return new Promise(function (resolveForDetach) {
      if (!chrome.debugger || typeof chrome.debugger.detach !== "function") {
        resolveForDetach(false);
        return;
      }
      try {
        chrome.debugger.detach({ tabId: tabIdForDetach }, function () {
          void chrome.runtime.lastError;
          resolveForDetach(true);
        });
      } catch (errForDetach) {
        resolveForDetach(false);
      }
    });
  }

  function sendCommandForCdp(tabIdForCmd, methodForCmd, paramsForCmd) {
    return new Promise(function (resolveForCmd, rejectForCmd) {
      if (!chrome.debugger || typeof chrome.debugger.sendCommand !== "function") {
        rejectForCmd(makeCdpErrorForCdp("session-lost", "Debugger API is unavailable."));
        return;
      }
      try {
        chrome.debugger.sendCommand({ tabId: tabIdForCmd }, methodForCmd, paramsForCmd || {}, function (resultForCmd) {
          if (chrome.runtime.lastError) {
            var cmdMsgForCdp = chrome.runtime.lastError.message || "";
            var cmdCodeForCdp = /detached|not attached|no tab with given id|cannot access/i.test(cmdMsgForCdp)
              ? "session-lost"
              : "command-failed";
            rejectForCmd(makeCdpErrorForCdp(cmdCodeForCdp, cmdMsgForCdp || "Command failed."));
            return;
          }
          resolveForCmd(resultForCmd);
        });
      } catch (errForCmd) {
        rejectForCmd(makeCdpErrorForCdp("session-lost", (errForCmd && errForCmd.message) || "Command threw."));
      }
    });
  }

  function acquireLeaseForCdp(tabIdForAcquire) {
    if (typeof tabIdForAcquire !== "number") {
      return Promise.resolve(failureFromErrorForCdp(makeCdpErrorForCdp("attach-failed", "Invalid tab id.")));
    }
    return (async function () {
      var sessionForAcquire = getSessionForCdp(tabIdForAcquire);

      if (sessionForAcquire.state === "DETACHING" && sessionForAcquire.detachPromise) {
        try {
          await sessionForAcquire.detachPromise;
        } catch (errForDetachWait) {
          /* ignore */
        }
        sessionForAcquire = getSessionForCdp(tabIdForAcquire);
      }

      if (sessionForAcquire.state === "ATTACHED") {
        if (sessionForAcquire.idleTimer) {
          clearTimeout(sessionForAcquire.idleTimer);
          sessionForAcquire.idleTimer = null;
        }
        sessionForAcquire.refCount += 1;
        return { ok: true };
      }

      if (sessionForAcquire.state === "ATTACHING" && sessionForAcquire.attachPromise) {
        try {
          await sessionForAcquire.attachPromise;
        } catch (errForJoin) {
          return failureFromErrorForCdp(errForJoin);
        }
        var joinedSessionForCdp = getSessionForCdp(tabIdForAcquire);
        if (joinedSessionForCdp.state === "ATTACHED") {
          joinedSessionForCdp.refCount += 1;
          return { ok: true };
        }
        return failureFromErrorForCdp(makeCdpErrorForCdp("attach-failed", "Attach did not complete."));
      }

      // DETACHED: claim ATTACHING synchronously so concurrent acquires serialize on one attach.
      sessionForAcquire.state = "ATTACHING";
      sessionForAcquire.attachPromise = (async function () {
        var enabledForAcquire = await isAutomationEnabledForCdp();
        if (!enabledForAcquire) {
          throw makeCdpErrorForCdp("automation-disabled", "Advanced automation is turned off in settings.");
        }
        await attachDebuggerForCdp(tabIdForAcquire);
      })();

      try {
        await sessionForAcquire.attachPromise;
      } catch (errForAttachFlow) {
        sessionForAcquire.state = "DETACHED";
        sessionForAcquire.refCount = 0;
        sessionForAcquire.attachPromise = null;
        return failureFromErrorForCdp(errForAttachFlow);
      }

      sessionForAcquire.state = "ATTACHED";
      sessionForAcquire.refCount = 1;
      sessionForAcquire.attachPromise = null;
      return { ok: true };
    })();
  }

  function releaseLeaseForCdp(tabIdForRelease, immediateForRelease) {
    var sessionForRelease = sessionsForCdp.get(tabIdForRelease);
    if (!sessionForRelease || sessionForRelease.state !== "ATTACHED") {
      return;
    }
    sessionForRelease.refCount = Math.max(0, sessionForRelease.refCount - 1);
    if (sessionForRelease.refCount > 0) {
      return;
    }
    // An immediate release detaches now instead of waiting out the idle grace; used
    // at run end so the infobar drops as soon as the assistant finishes. The grace
    // path remains for per-action releases, where the next action follows shortly.
    if (immediateForRelease === true) {
      forceDetachForCdp(tabIdForRelease);
      return;
    }
    if (sessionForRelease.idleTimer) {
      clearTimeout(sessionForRelease.idleTimer);
    }
    sessionForRelease.idleTimer = setTimeout(function () {
      var idleSessionForCdp = sessionsForCdp.get(tabIdForRelease);
      if (!idleSessionForCdp || idleSessionForCdp.state !== "ATTACHED" || idleSessionForCdp.refCount !== 0) {
        return;
      }
      idleSessionForCdp.idleTimer = null;
      idleSessionForCdp.state = "DETACHING";
      idleSessionForCdp.detachPromise = detachDebuggerForCdp(tabIdForRelease).then(function () {
        var settledSessionForCdp = sessionsForCdp.get(tabIdForRelease);
        if (settledSessionForCdp) {
          settledSessionForCdp.state = "DETACHED";
          settledSessionForCdp.detachPromise = null;
        }
      });
    }, CDP_IDLE_DETACH_MS_FOR_CDP);
  }

  function forceDetachForCdp(tabIdForForce) {
    var sessionForForce = sessionsForCdp.get(tabIdForForce);
    if (!sessionForForce) {
      return Promise.resolve();
    }
    if (sessionForForce.idleTimer) {
      clearTimeout(sessionForForce.idleTimer);
      sessionForForce.idleTimer = null;
    }
    if (sessionForForce.state === "DETACHED") {
      return Promise.resolve();
    }
    sessionForForce.state = "DETACHING";
    sessionForForce.refCount = 0;
    sessionForForce.detachPromise = detachDebuggerForCdp(tabIdForForce).then(function () {
      var settledForceSessionForCdp = sessionsForCdp.get(tabIdForForce);
      if (settledForceSessionForCdp) {
        settledForceSessionForCdp.state = "DETACHED";
        settledForceSessionForCdp.detachPromise = null;
      }
    });
    return sessionForForce.detachPromise;
  }

  function forceDetachAllForCdp() {
    try {
      sessionsForCdp.forEach(function (sessionForAll, tabIdForAll) {
        if (sessionForAll && sessionForAll.state !== "DETACHED") {
          forceDetachForCdp(tabIdForAll);
        }
      });
    } catch (errForAll) {
      /* ignore */
    }
  }

  function getSessionStateForCdp(tabIdForState) {
    var sessionForStateRead = sessionsForCdp.get(tabIdForState);
    if (!sessionForStateRead) {
      return { state: "DETACHED", refCount: 0, lastDetachReason: null };
    }
    return {
      state: sessionForStateRead.state,
      refCount: sessionForStateRead.refCount,
      lastDetachReason: sessionForStateRead.lastDetachReason || null,
      lastDialog: sessionForStateRead.lastDialog || null
    };
  }

  function handleTabRemovedForCdp(tabIdForRemoved) {
    var sessionForRemoved = sessionsForCdp.get(tabIdForRemoved);
    if (!sessionForRemoved) {
      return;
    }
    if (sessionForRemoved.idleTimer) {
      clearTimeout(sessionForRemoved.idleTimer);
    }
    sessionsForCdp.delete(tabIdForRemoved);
  }

  // ---- High-level input actions ----

  // The text field is what makes the renderer run full key processing (keypress, editor
  // commands, app keydown handlers in canvas apps like Google Sheets). A rawKeyDown
  // without text fires keydown but Sheets-style editors never commit on it.
  var CDP_KEY_MAP_FOR_CDP = {
    enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
    tab: { key: "Tab", code: "Tab", vk: 9, text: "\t" },
    escape: { key: "Escape", code: "Escape", vk: 27 },
    esc: { key: "Escape", code: "Escape", vk: 27 },
    backspace: { key: "Backspace", code: "Backspace", vk: 8 },
    "delete": { key: "Delete", code: "Delete", vk: 46 },
    space: { key: " ", code: "Space", vk: 32, text: " " },
    arrowup: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
    up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
    left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
    home: { key: "Home", code: "Home", vk: 36 },
    end: { key: "End", code: "End", vk: 35 },
    pageup: { key: "PageUp", code: "PageUp", vk: 33 },
    pagedown: { key: "PageDown", code: "PageDown", vk: 34 }
  };

  var CDP_MODIFIER_BITS_FOR_CDP = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };

  function requireNumberForCdp(valForReq, nameForReq) {
    if (typeof valForReq !== "number" || isNaN(valForReq)) {
      throw makeCdpErrorForCdp("bad-params", "Missing or invalid '" + nameForReq + "' coordinate.");
    }
    return valForReq;
  }

  function resolveKeyDescriptorForCdp(tokenForResolve) {
    var trimmedForResolve = String(tokenForResolve || "").trim();
    if (!trimmedForResolve) {
      return null;
    }
    var lowerForResolve = trimmedForResolve.toLowerCase();
    if (CDP_KEY_MAP_FOR_CDP[lowerForResolve]) {
      return CDP_KEY_MAP_FOR_CDP[lowerForResolve];
    }
    if (trimmedForResolve.length === 1) {
      var upperForResolve = trimmedForResolve.toUpperCase();
      if (/[A-Z]/.test(upperForResolve)) {
        return { key: trimmedForResolve, code: "Key" + upperForResolve, vk: upperForResolve.charCodeAt(0), text: trimmedForResolve };
      }
      if (/[0-9]/.test(trimmedForResolve)) {
        return { key: trimmedForResolve, code: "Digit" + trimmedForResolve, vk: trimmedForResolve.charCodeAt(0), text: trimmedForResolve };
      }
      return { key: trimmedForResolve, code: "", vk: upperForResolve.charCodeAt(0), text: trimmedForResolve };
    }
    return null;
  }

  function parseKeyComboForCdp(keysForParse) {
    var partsForParse = String(keysForParse || "").split("+").map(function (pForParse) {
      return pForParse.trim();
    }).filter(Boolean);
    if (!partsForParse.length) {
      return null;
    }
    var baseTokenForParse = partsForParse[partsForParse.length - 1];
    var modifiersForParse = 0;
    for (var iForParse = 0; iForParse < partsForParse.length - 1; iForParse++) {
      var modBitForParse = CDP_MODIFIER_BITS_FOR_CDP[partsForParse[iForParse].toLowerCase()];
      if (modBitForParse) {
        modifiersForParse |= modBitForParse;
      }
    }
    var descriptorForParse = resolveKeyDescriptorForCdp(baseTokenForParse);
    if (!descriptorForParse) {
      return null;
    }
    return { descriptor: descriptorForParse, modifiers: modifiersForParse };
  }

  // Global meanings of common Cmd chords on macOS. A model that sends Ctrl+A to
  // select a field's text gets Cmd+A, which most web apps treat as a page-wide
  // Select All; naming the meaning in the result lets the model notice the chord
  // did something much broader than intended.
  var MAC_CMD_CHORD_MEANINGS_FOR_CDP = {
    a: "Select All",
    f: "Find",
    g: "Find Again",
    p: "Print",
    s: "Save",
    r: "Reload",
    w: "Close",
    z: "Undo",
    y: "Redo"
  };

  var cachedOsForCdp = "";

  function getOsForCdp() {
    if (cachedOsForCdp) {
      return Promise.resolve(cachedOsForCdp);
    }
    try {
      return Promise.resolve(chrome.runtime.getPlatformInfo()).then(function (infoForOs) {
        cachedOsForCdp = (infoForOs && infoForOs.os) || "unknown";
        return cachedOsForCdp;
      }).catch(function () {
        cachedOsForCdp = "unknown";
        return cachedOsForCdp;
      });
    } catch (errForOs) {
      cachedOsForCdp = "unknown";
      return Promise.resolve(cachedOsForCdp);
    }
  }

  function dispatchKeyComboForCdp(tabIdForKey, keysForKey) {
    var comboForKey = parseKeyComboForCdp(keysForKey);
    if (!comboForKey) {
      return Promise.reject(makeCdpErrorForCdp("bad-params", "Unrecognized key: " + String(keysForKey)));
    }
    return getOsForCdp().then(function (osForKey) {
      var modifiersForKey = comboForKey.modifiers;
      // Web-app shortcuts (select-all, copy, undo) use Cmd on macOS; models almost
      // always send Ctrl, so translate Ctrl to Meta there to dispatch the chord the
      // page actually listens for.
      var translatedForKey = false;
      if (osForKey === "mac" && (modifiersForKey & 2)) {
        modifiersForKey = (modifiersForKey & ~2) | 4;
        translatedForKey = true;
      }
      var descForKey = comboForKey.descriptor;
      // A chord with any modifier other than Shift produces no character; sending text
      // with it would insert the letter instead of triggering the shortcut.
      var textForKey = (modifiersForKey & ~8) ? "" : (descForKey.text || "");
      var baseEventForKey = {
        modifiers: modifiersForKey,
        key: descForKey.key,
        code: descForKey.code,
        windowsVirtualKeyCode: descForKey.vk,
        nativeVirtualKeyCode: descForKey.vk
      };
      var downEventForKey = Object.assign({ type: textForKey ? "keyDown" : "rawKeyDown" }, baseEventForKey);
      if (textForKey) {
        downEventForKey.text = textForKey;
        downEventForKey.unmodifiedText = textForKey;
      }
      var upEventForKey = Object.assign({ type: "keyUp" }, baseEventForKey);
      return sendCommandForCdp(tabIdForKey, "Input.dispatchKeyEvent", downEventForKey).then(function () {
        return sendCommandForCdp(tabIdForKey, "Input.dispatchKeyEvent", upEventForKey);
      }).then(function () {
        var resultForKey = { action: "key", keys: keysForKey };
        if (translatedForKey) {
          var translatedNoteForKey = "Ctrl dispatched as Meta (Cmd) for macOS";
          var baseKeyLowerForKey = String(descForKey.key || "").toLowerCase();
          var chordMeaningForKey = (baseKeyLowerForKey.length === 1) ? MAC_CMD_CHORD_MEANINGS_FOR_CDP[baseKeyLowerForKey] : "";
          if (chordMeaningForKey) {
            translatedNoteForKey += "; Cmd+" + baseKeyLowerForKey.toUpperCase() + " is the global '" + chordMeaningForKey
              + "' shortcut, which acts on the whole focused surface, not just a text field";
          }
          resultForKey.translated = translatedNoteForKey;
        }
        return resultForKey;
      });
    });
  }

  function dispatchMouseClickForCdp(tabIdForClick, xForClick, yForClick, buttonForClick, clickCountForClick) {
    var buttonsBitForClick = buttonForClick === "right" ? 2 : (buttonForClick === "middle" ? 4 : 1);
    return sendCommandForCdp(tabIdForClick, "Input.dispatchMouseEvent", { type: "mouseMoved", x: xForClick, y: yForClick, button: "none", buttons: 0 })
      .then(function () {
        return sendCommandForCdp(tabIdForClick, "Input.dispatchMouseEvent", { type: "mousePressed", x: xForClick, y: yForClick, button: buttonForClick, buttons: buttonsBitForClick, clickCount: clickCountForClick });
      })
      .then(function () {
        return sendCommandForCdp(tabIdForClick, "Input.dispatchMouseEvent", { type: "mouseReleased", x: xForClick, y: yForClick, button: buttonForClick, buttons: 0, clickCount: clickCountForClick });
      });
  }

  function dispatchDragForCdp(tabIdForDrag, fromXForDrag, fromYForDrag, toXForDrag, toYForDrag) {
    return sendCommandForCdp(tabIdForDrag, "Input.dispatchMouseEvent", { type: "mouseMoved", x: fromXForDrag, y: fromYForDrag, button: "none", buttons: 0 })
      .then(function () {
        return sendCommandForCdp(tabIdForDrag, "Input.dispatchMouseEvent", { type: "mousePressed", x: fromXForDrag, y: fromYForDrag, button: "left", buttons: 1, clickCount: 1 });
      })
      .then(function () {
        return sendCommandForCdp(tabIdForDrag, "Input.dispatchMouseEvent", { type: "mouseMoved", x: toXForDrag, y: toYForDrag, button: "left", buttons: 1 });
      })
      .then(function () {
        return sendCommandForCdp(tabIdForDrag, "Input.dispatchMouseEvent", { type: "mouseReleased", x: toXForDrag, y: toYForDrag, button: "left", buttons: 0, clickCount: 1 });
      });
  }

  // Settle delays for paced typing. Apps with asynchronous commit pipelines (Google
  // Sheets) reset their hidden editor right after a commit; input dispatched into
  // that window is silently discarded, so every key press gets time to settle and
  // every text segment a short breather before the next dispatch.
  var TYPE_KEY_SETTLE_MS_FOR_CDP = 80;
  var TYPE_SEGMENT_SETTLE_MS_FOR_CDP = 30;

  // A real keystroke for one printable character. Canvas apps enter edit mode on key
  // events, not on Input.insertText, so each text segment is opened with its first
  // character as a genuine key press.
  function dispatchSingleCharKeyForCdp(tabIdForChar, charForChar) {
    var descForChar = resolveKeyDescriptorForCdp(charForChar);
    if (!descForChar) {
      return Promise.resolve();
    }
    var baseForChar = {
      modifiers: 0,
      key: descForChar.key,
      code: descForChar.code,
      windowsVirtualKeyCode: descForChar.vk,
      nativeVirtualKeyCode: descForChar.vk
    };
    var downForChar = Object.assign({ type: "keyDown", text: charForChar, unmodifiedText: charForChar }, baseForChar);
    var upForChar = Object.assign({ type: "keyUp" }, baseForChar);
    return sendCommandForCdp(tabIdForChar, "Input.dispatchKeyEvent", downForChar).then(function () {
      return sendCommandForCdp(tabIdForChar, "Input.dispatchKeyEvent", upForChar);
    });
  }

  // Insert text, dispatching embedded tab and newline characters as real Tab and
  // Enter key presses. Input.insertText would put a literal control character into
  // the focused editor, which apps like Google Sheets ignore; the key press is what
  // moves the cell or commits, so one tab-separated line can fill a whole grid row.
  function dispatchTypeTextForCdp(tabIdForType, textForType, clearSuggestionsForType) {
    var normalizedForType = String(textForType).replace(/\r\n?/g, "\n");
    var segmentsForType = normalizedForType.split(/(\t|\n)/);
    var embeddedKeysForType = 0;
    var chainForType = Promise.resolve();
    segmentsForType.forEach(function (segmentForType) {
      if (segmentForType === "") {
        return;
      }
      if (segmentForType === "\t" || segmentForType === "\n") {
        embeddedKeysForType++;
        var keyNameForType = segmentForType === "\t" ? "Tab" : "Enter";
        chainForType = chainForType.then(function () {
          return dispatchKeyComboForCdp(tabIdForType, keyNameForType);
        }).then(function () {
          return delayForCdp(TYPE_KEY_SETTLE_MS_FOR_CDP);
        });
        return;
      }
      chainForType = chainForType.then(function () {
        var firstCharForType = segmentForType.charAt(0);
        var restForType = segmentForType.slice(1);
        if (/^[\x21-\x7e]$/.test(firstCharForType)) {
          return dispatchSingleCharKeyForCdp(tabIdForType, firstCharForType).then(function () {
            return restForType ? sendCommandForCdp(tabIdForType, "Input.insertText", { text: restForType }) : null;
          });
        }
        return sendCommandForCdp(tabIdForType, "Input.insertText", { text: segmentForType });
      }).then(function () {
        // Spreadsheet inline autocomplete appends a SELECTED ghost completion to the
        // typed text, and the committing Tab/Enter accepts it (typing "Lamp" can
        // commit as "Laptop"). A forward Delete removes the selected ghost and is a
        // no-op when the caret sits at the end with nothing after it.
        if (clearSuggestionsForType) {
          return dispatchKeyComboForCdp(tabIdForType, "Delete");
        }
        return null;
      }).then(function () {
        return delayForCdp(TYPE_SEGMENT_SETTLE_MS_FOR_CDP);
      });
    });
    return chainForType.then(function () {
      var resultForType = { action: "type", length: normalizedForType.length };
      if (embeddedKeysForType) {
        resultForType.embedded_keys = embeddedKeysForType;
      }
      if (clearSuggestionsForType) {
        resultForType.cleared_suggestions = true;
      }
      return resultForType;
    });
  }

  // Resolve an accessibility-tree backend node id to the CSS viewport coordinates of its
  // box center, for a trusted pointer dispatch. DOM.resolveNode turns the backend id into
  // a live JS handle (no DOM.enable / getDocument needed), then getBoundingClientRect runs
  // on the element itself, which is viewport-relative in CSS pixels and therefore matches
  // Input.dispatchMouseEvent's coordinate space directly (sidestepping DOM.getBoxModel's
  // page-vs-viewport ambiguity). scrollIntoViewIfNeeded first so an off-screen node yields
  // an on-viewport point; a zero-size box is rejected rather than clicking nothing.
  function resolveBackendNodeCenterForCdp(tabIdForResolveNode, backendNodeIdForResolveNode) {
    return sendCommandForCdp(tabIdForResolveNode, "DOM.resolveNode", { backendNodeId: backendNodeIdForResolveNode }).then(function (resolvedForResolveNode) {
      var objectForResolveNode = resolvedForResolveNode && resolvedForResolveNode.object;
      if (!objectForResolveNode || !objectForResolveNode.objectId) {
        return Promise.reject(makeCdpErrorForCdp("node-not-found", "The accessibility node could not be resolved to a live element. The page may have changed; re-read page_accessibility_tree for fresh handles."));
      }
      var objectIdForResolveNode = objectForResolveNode.objectId;
      var fnForResolveNode = "function () { try { if (typeof this.scrollIntoViewIfNeeded === 'function') { this.scrollIntoViewIfNeeded(); } else if (typeof this.scrollIntoView === 'function') { this.scrollIntoView({ block: 'center', inline: 'center' }); } } catch (e) {} var r = (typeof this.getBoundingClientRect === 'function') ? this.getBoundingClientRect() : null; if (!r) { return JSON.stringify({ error: 'no-rect' }); } return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); }";
      return sendCommandForCdp(tabIdForResolveNode, "Runtime.callFunctionOn", { objectId: objectIdForResolveNode, functionDeclaration: fnForResolveNode, returnByValue: true }).then(function (callForResolveNode) {
        sendCommandForCdp(tabIdForResolveNode, "Runtime.releaseObject", { objectId: objectIdForResolveNode }).catch(function () { /* best-effort cleanup */ });
        var valueForResolveNode = callForResolveNode && callForResolveNode.result && callForResolveNode.result.value;
        var parsedForResolveNode = null;
        try { parsedForResolveNode = JSON.parse(valueForResolveNode); } catch (eParseForResolveNode) { parsedForResolveNode = null; }
        if (!parsedForResolveNode || parsedForResolveNode.error || !(parsedForResolveNode.w > 0) || !(parsedForResolveNode.h > 0)) {
          return Promise.reject(makeCdpErrorForCdp("no-box", "The element has no visible layout box (it may be hidden or zero-size), so it cannot be targeted."));
        }
        return { x: Math.round(parsedForResolveNode.x), y: Math.round(parsedForResolveNode.y) };
      });
    });
  }

  function dispatchInputForCdp(tabIdForInput, actionParamsForInput) {
    var paramsForInput = actionParamsForInput || {};
    var actionForInput = String(paramsForInput.action || "").toLowerCase();
    switch (actionForInput) {
      case "click":
        return dispatchMouseClickForCdp(tabIdForInput, requireNumberForCdp(paramsForInput.x, "x"), requireNumberForCdp(paramsForInput.y, "y"), "left", 1).then(function () {
          return { action: "click", x: paramsForInput.x, y: paramsForInput.y };
        });
      case "double_click":
        return dispatchMouseClickForCdp(tabIdForInput, requireNumberForCdp(paramsForInput.x, "x"), requireNumberForCdp(paramsForInput.y, "y"), "left", 2).then(function () {
          return { action: "double_click", x: paramsForInput.x, y: paramsForInput.y };
        });
      case "right_click":
        return dispatchMouseClickForCdp(tabIdForInput, requireNumberForCdp(paramsForInput.x, "x"), requireNumberForCdp(paramsForInput.y, "y"), "right", 1).then(function () {
          return { action: "right_click", x: paramsForInput.x, y: paramsForInput.y };
        });
      case "move":
        return sendCommandForCdp(tabIdForInput, "Input.dispatchMouseEvent", { type: "mouseMoved", x: requireNumberForCdp(paramsForInput.x, "x"), y: requireNumberForCdp(paramsForInput.y, "y"), button: "none", buttons: 0 }).then(function () {
          return { action: "move", x: paramsForInput.x, y: paramsForInput.y };
        });
      case "drag":
        return dispatchDragForCdp(tabIdForInput, requireNumberForCdp(paramsForInput.x, "x"), requireNumberForCdp(paramsForInput.y, "y"), requireNumberForCdp(paramsForInput.toX, "toX"), requireNumberForCdp(paramsForInput.toY, "toY")).then(function () {
          return { action: "drag", x: paramsForInput.x, y: paramsForInput.y, toX: paramsForInput.toX, toY: paramsForInput.toY };
        });
      case "scroll":
        return sendCommandForCdp(tabIdForInput, "Input.dispatchMouseEvent", { type: "mouseWheel", x: requireNumberForCdp(paramsForInput.x, "x"), y: requireNumberForCdp(paramsForInput.y, "y"), deltaX: Number(paramsForInput.dx) || 0, deltaY: Number(paramsForInput.dy) || 0 }).then(function () {
          return { action: "scroll", dx: Number(paramsForInput.dx) || 0, dy: Number(paramsForInput.dy) || 0 };
        });
      case "type":
        var textForType = typeof paramsForInput.text === "string" ? paramsForInput.text : "";
        if (!textForType) {
          return Promise.reject(makeCdpErrorForCdp("bad-params", "The type action requires a non-empty 'text'."));
        }
        return dispatchTypeTextForCdp(tabIdForInput, textForType, paramsForInput.clear_suggestions === true);
      case "key":
        return dispatchKeyComboForCdp(tabIdForInput, paramsForInput.keys);
      case "resolve_target":
        return resolveBackendNodeCenterForCdp(tabIdForInput, requireNumberForCdp(paramsForInput.backend_node_id, "backend_node_id")).then(function (ptForResolveCase) {
          return { action: "resolve_target", x: ptForResolveCase.x, y: ptForResolveCase.y };
        });
      default:
        return Promise.reject(makeCdpErrorForCdp("bad-params", "Unknown page_act action: " + String(paramsForInput.action)));
    }
  }

  function performActionForCdp(tabIdForPerform, actionParamsForPerform) {
    if (typeof tabIdForPerform !== "number") {
      return Promise.resolve(failureFromErrorForCdp(makeCdpErrorForCdp("attach-failed", "Invalid tab id.")));
    }
    return (async function () {
      var acquireResultForPerform = await acquireLeaseForCdp(tabIdForPerform);
      if (!acquireResultForPerform.ok) {
        return acquireResultForPerform;
      }
      var sessionForPerform = sessionsForCdp.get(tabIdForPerform);
      var dialogMarkForPerform = (sessionForPerform && sessionForPerform.lastDialog) ? sessionForPerform.lastDialog.at : 0;
      try {
        var resultForPerform = await dispatchInputForCdp(tabIdForPerform, actionParamsForPerform);
        // A JS dialog triggered by this action is auto-handled with no native UI; give it a moment to
        // surface, then report it so the model knows the action may not have committed.
        await delayForCdp(120);
        var sessionAfterForPerform = sessionsForCdp.get(tabIdForPerform);
        if (sessionAfterForPerform && sessionAfterForPerform.lastDialog && sessionAfterForPerform.lastDialog.at > dialogMarkForPerform) {
          resultForPerform.dialog = {
            type: sessionAfterForPerform.lastDialog.type,
            message: sessionAfterForPerform.lastDialog.message,
            handled: sessionAfterForPerform.lastDialog.accepted ? "accepted" : "dismissed"
          };
        }
        return { ok: true, result: resultForPerform };
      } catch (errForPerform) {
        return failureFromErrorForCdp(errForPerform);
      } finally {
        releaseLeaseForCdp(tabIdForPerform);
      }
    })();
  }

  // ---- Listener registration ----

  try {
    if (chrome.tabs && chrome.tabs.onRemoved && typeof chrome.tabs.onRemoved.addListener === "function") {
      chrome.tabs.onRemoved.addListener(handleTabRemovedForCdp);
    }
  } catch (errForTabRemovedReg) {
    /* ignore */
  }

  try {
    if (chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
      chrome.storage.onChanged.addListener(function (changesForStorage, areaForStorage) {
        if (areaForStorage !== "local" || !changesForStorage) {
          return;
        }
        var changeForFlag = changesForStorage[AUTOMATION_ENABLED_KEY_FOR_CDP];
        if (changeForFlag && !changeForFlag.newValue) {
          forceDetachAllForCdp();
        }
      });
    }
  } catch (errForStorageReg) {
    /* ignore */
  }

  ensureDebuggerListenersForCdp();

  nsForCdp.cdpAutomation = {
    isAutomationEnabled: isAutomationEnabledForCdp,
    setAutomationEnabled: setAutomationEnabledForCdp,
    openConsentWindow: openConsentWindowForCdp,
    acquireLease: acquireLeaseForCdp,
    releaseLease: releaseLeaseForCdp,
    forceDetach: forceDetachForCdp,
    forceDetachAll: forceDetachAllForCdp,
    getSessionState: getSessionStateForCdp,
    sendCommand: sendCommandForCdp,
    performAction: performActionForCdp
  };

  globalScopeForCdp.ABChatBackground = nsForCdp;
})();
