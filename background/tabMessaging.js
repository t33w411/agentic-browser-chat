(function () {
  const globalScopeForTabMessaging = globalThis;
  const existingBackgroundNamespaceForTabMessaging = globalScopeForTabMessaging.ABChatBackground || {};
  const sharedNamespaceForTabMessaging = globalScopeForTabMessaging.ABChatShared || {};
  const actionsForTabMessaging = sharedNamespaceForTabMessaging.actions || {};
  const communicationForTabMessaging = sharedNamespaceForTabMessaging.communication || {};
  const statusesForTabMessaging = communicationForTabMessaging.statuses || {};
  const errorCodesForTabMessaging = communicationForTabMessaging.errorCodes || {};
  const protocolVersionForTabMessaging = communicationForTabMessaging.protocolVersion || 1;
  const maxAttemptsForTabMessaging = 4;
  const retryDelaysMsForTabMessaging = [80, 160, 320];
  const actionResponseTimeoutMsForTabMessaging = 700;
  // Per-tab in-flight guard for ensureContentInjected. Activation of a tab can
  // trigger several concurrent callers (onActivated and onFocusChanged, each
  // through both the activation inject and the panel enforce, the post-reload
  // recovery of the tab in view, sendActionToTab retries); without this guard
  // two racing calls could both decide to inject and tear down a live panel
  // twice in a row.
  const inflightEnsureInjectedForTabMessaging = new Map();

  const injectableJsFilesForTabMessaging = [
    "content/keyboardShield.js",
    "content/preInit.js",
    "content/staleCopyRelease.js",
    "shared/messages.js",
    "shared/agentRunStop.js",
    "shared/toolRegistry.js",
    "shared/domainConfig.js",
    "shared/storage.js",
    "lib/flexsearch.min.js",
    "shared/panelDataRepo.js",
    "shared/search.js",
    "utils/dom.js",
    "utils/clipboard.js",
    "ui/toast.js",
    "content/screenshotCapture.js",
    "lib/mathjax-startup.js",
    "lib/tex-svg.js",
    "lib/marked.min.js",
    "lib/highlight.min.js",
    "lib/purify.min.js",
    "lib/mermaid-guard.js",
    "lib/mermaid.min.js",
    "lib/xlsx.min.js",
    "lib/jszip.min.js",
    "panel/panelIcons.js",
    "panel/panelTemplate.js",
    "panel/panelData.js",
    "panel/panelDraftSync.js",
    "panel/panelComposerCopy.js",
    "panel/panelSpeechChunk.js",
    "panel/panelGeneratedFiles.js",
    "agent/apiLogger.js",
    "agent/apiLogTurns.js",
    "agent/pageActionLogger.js",
    "agent/tools.js",
    "agent/builtinGuides.js",
    "agent/documentThemes.js",
    "agent/documentGeneration.js",
    "agent/cdpClient.js",
    "agent/embeddedRegions.js",
    "agent/toolExec.js",
    "agent/contextBuilder.js",
    "agent/client.js",
    "agent/compactor.js",
    "agent/hooks/registry.js",
    "agent/hooks/builtin/memoryClaimGuard.js",
    "agent/hooks/builtin/imageGenerationCap.js",
    "agent/hooks/builtin/toolCallCap.js",
    "agent/hooks/builtin/builtinGuideGate.js",
    "panel/panelRuntime.js",
    "panel/panel.js",
    "panel/panelStateSync.js",
    "ui/floatingPanel.js",
    "tools/selectionContextActions.js",
    "tools/flattenedContent.js",
    "tools/contentSelector.js",
    "tools/pageLayoutRules.js",
    "tools/pageLayout.js",
    "content/main.js"
  ];

  const injectableCssFilesForTabMessaging = ["styles.css"];

  // Injected into the page's MAIN world, never the isolated world: it patches the
  // page's EventTarget.prototype so page listeners skip events originating in the
  // extension UI. Running it in the isolated world would instead wrap the content
  // scripts' own prototypes and hide panel events from the extension itself, so it
  // must stay out of injectableJsFilesForTabMessaging. It is idempotent (window
  // flag) and uses no chrome.* APIs, so re-injection after an extension reload is
  // safe and the already-installed copy keeps working regardless.
  const mainWorldJsFilesForTabMessaging = ["content/pageEventShield.js"];

  function getHostnameFromUrlForTabMessaging(urlForTabMessaging) {
    if (!urlForTabMessaging || typeof urlForTabMessaging !== "string") {
      return "";
    }

    try {
      const parsedUrlForTabMessaging = new URL(urlForTabMessaging);
      return (parsedUrlForTabMessaging.hostname || "").toLowerCase();
    } catch (errorForTabMessaging) {
      return "";
    }
  }

  function isSupportedUrlForTabMessaging(urlForTabMessaging) {
    if (!urlForTabMessaging || typeof urlForTabMessaging !== "string") {
      return false;
    }
    return /^(https?|file):\/\//i.test(urlForTabMessaging);
  }

  function queryActiveTabForTabMessaging() {
    return new Promise((resolveForTabMessaging) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabsForTabMessaging) => {
        if (!tabsForTabMessaging || !tabsForTabMessaging.length) {
          resolveForTabMessaging(null);
          return;
        }
        resolveForTabMessaging(tabsForTabMessaging[0]);
      });
    });
  }

  function sendMessageToTabForTabMessaging(tabIdForTabMessaging, payloadForTabMessaging, timeoutMsForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      let isResolvedForTabMessaging = false;
      let timeoutHandleForTabMessaging = null;

      const finalizeForTabMessaging = (resultForTabMessaging) => {
        if (isResolvedForTabMessaging) {
          return;
        }
        isResolvedForTabMessaging = true;
        if (timeoutHandleForTabMessaging) {
          clearTimeout(timeoutHandleForTabMessaging);
        }
        resolveForTabMessaging(resultForTabMessaging);
      };

      const timeoutValueForTabMessaging =
        typeof timeoutMsForTabMessaging === "number" && timeoutMsForTabMessaging > 0
          ? timeoutMsForTabMessaging
          : 0;
      if (timeoutValueForTabMessaging > 0) {
        timeoutHandleForTabMessaging = setTimeout(() => {
          finalizeForTabMessaging({
            response: null,
            runtimeError: errorCodesForTabMessaging.timeout || "REQUEST_TIMEOUT",
            timedOut: true
          });
        }, timeoutValueForTabMessaging);
      }

      try {
        chrome.tabs.sendMessage(tabIdForTabMessaging, payloadForTabMessaging, (responseForTabMessaging) => {
          finalizeForTabMessaging({
            response: responseForTabMessaging,
            runtimeError: chrome.runtime.lastError ? chrome.runtime.lastError.message : "",
            timedOut: false
          });
        });
      } catch (errorForTabMessaging) {
        finalizeForTabMessaging({
          response: null,
          runtimeError:
            errorForTabMessaging && errorForTabMessaging.message
              ? errorForTabMessaging.message
              : "Unexpected sendMessage failure.",
          timedOut: false
        });
      }
    });
  }

  function classifyTransportErrorForTabMessaging(sendResultForTabMessaging) {
    if (sendResultForTabMessaging && sendResultForTabMessaging.timedOut) {
      return {
        retryable: true,
        errorCode: errorCodesForTabMessaging.timeout || "REQUEST_TIMEOUT",
        error: "Timed out waiting for content response."
      };
    }

    const errorMessageForTabMessaging =
      sendResultForTabMessaging && sendResultForTabMessaging.runtimeError
        ? sendResultForTabMessaging.runtimeError
        : "";
    if (!errorMessageForTabMessaging) {
      return null;
    }

    if (errorMessageForTabMessaging.includes("Receiving end does not exist")) {
      return {
        retryable: true,
        errorCode: errorCodesForTabMessaging.noReceiver || "NO_RECEIVER",
        error: errorMessageForTabMessaging
      };
    }

    if (
      errorMessageForTabMessaging.includes("message channel closed before a response was received") ||
      errorMessageForTabMessaging.includes("The message port closed before a response was received")
    ) {
      return {
        retryable: true,
        errorCode: errorCodesForTabMessaging.portClosed || "PORT_CLOSED",
        error: errorMessageForTabMessaging
      };
    }

    return {
      retryable: false,
      errorCode: "",
      error: errorMessageForTabMessaging
    };
  }

  function classifyActionResponseForTabMessaging(responseForTabMessaging) {
    if (
      responseForTabMessaging &&
      responseForTabMessaging.ok &&
      responseForTabMessaging.status === (statusesForTabMessaging.handled || "handled")
    ) {
      return { ok: true };
    }

    if (!responseForTabMessaging) {
      return {
        ok: false,
        retryable: true,
        errorCode: errorCodesForTabMessaging.portClosed || "PORT_CLOSED",
        error: "No response from content script."
      };
    }

    const errorCodeForTabMessaging = responseForTabMessaging.errorCode || "";
    const statusForTabMessaging = responseForTabMessaging.status || "";
    const shouldRetryForTabMessaging =
      Boolean(responseForTabMessaging.retryable) ||
      statusForTabMessaging === (statusesForTabMessaging.notReady || "notReady") ||
      errorCodeForTabMessaging === (errorCodesForTabMessaging.csNotReady || "CS_NOT_READY") ||
      errorCodeForTabMessaging === (errorCodesForTabMessaging.contextInvalidated || "CONTEXT_INVALIDATED");

    return {
      ok: false,
      retryable: shouldRetryForTabMessaging,
      errorCode: errorCodeForTabMessaging,
      error: responseForTabMessaging.errorMessage || "Action not acknowledged by content script."
    };
  }

  function buildRequestIdForTabMessaging() {
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function waitForRetryDelayForTabMessaging(delayMsForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      setTimeout(resolveForTabMessaging, delayMsForTabMessaging);
    });
  }

  function executeScriptFilesForTabMessaging(tabIdForTabMessaging, filesForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabIdForTabMessaging },
          files: filesForTabMessaging
        },
        () => {
          resolveForTabMessaging(!chrome.runtime.lastError);
        }
      );
    });
  }

  function executeMainWorldScriptFilesForTabMessaging(tabIdForTabMessaging, filesForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabIdForTabMessaging },
          files: filesForTabMessaging,
          world: "MAIN"
        },
        () => {
          resolveForTabMessaging(!chrome.runtime.lastError);
        }
      );
    });
  }

  function insertCssFilesForTabMessaging(tabIdForTabMessaging, filesForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      chrome.scripting.insertCSS(
        {
          target: { tabId: tabIdForTabMessaging },
          files: filesForTabMessaging
        },
        () => {
          resolveForTabMessaging(!chrome.runtime.lastError);
        }
      );
    });
  }

  async function checkContentReadyForTabMessaging(tabIdForTabMessaging, maxRetriesForTabMessaging) {
    const retriesForTabMessaging = maxRetriesForTabMessaging || 0;

    for (let attemptForTabMessaging = 0; attemptForTabMessaging <= retriesForTabMessaging; attemptForTabMessaging++) {
      const checkResultForTabMessaging = await sendMessageToTabForTabMessaging(tabIdForTabMessaging, {
        action: actionsForTabMessaging.checkReady || "checkReady"
      }, actionResponseTimeoutMsForTabMessaging);

      if (checkResultForTabMessaging.response && checkResultForTabMessaging.response.ready) {
        return true;
      }

      if (attemptForTabMessaging < retriesForTabMessaging) {
        await new Promise((resolveForTabMessaging) => setTimeout(resolveForTabMessaging, 50));
      }
    }

    return false;
  }

  // Deterministic injected-state probe. Reads window.abchatMainInitNonce from
  // the extension's ISOLATED world in the tab. main.js (the last file in the
  // bundle) sets the nonce, so a non-null read proves the full bundle from
  // THIS extension instance already ran there. Isolated worlds are per
  // extension instance, so after a genuine extension reload the old world's
  // nonce is invisible and the probe correctly reports "not injected".
  //
  // This replaces the previous message-based checkInjected handshake, whose
  // 700 ms timeout produced false "not injected" verdicts on any tab that was
  // slow to answer (throttled/frozen background tab, busy main thread, paused
  // debugger). Each false verdict re-injected all content scripts, and the
  // re-init in main.js then tore down and rebuilt a live panel: a visible
  // flash on tab activation. The probe cannot time out; it either runs in the
  // world (definitive answer) or errors (in which case file injection into
  // the same target would fail for the same reason).
  function probeInjectedNonceForTabMessaging(tabIdForTabMessaging) {
    return new Promise((resolveForTabMessaging) => {
      try {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabIdForTabMessaging },
            func: function readInjectionNonceForTabMessaging() {
              return window.abchatMainInitNonce || null;
            }
          },
          (probeResultsForTabMessaging) => {
            if (chrome.runtime.lastError) {
              resolveForTabMessaging({ ok: false, nonce: null });
              return;
            }
            const firstResultForTabMessaging =
              Array.isArray(probeResultsForTabMessaging) && probeResultsForTabMessaging[0]
                ? probeResultsForTabMessaging[0]
                : null;
            resolveForTabMessaging({
              ok: true,
              nonce: firstResultForTabMessaging && firstResultForTabMessaging.result
                ? firstResultForTabMessaging.result
                : null
            });
          }
        );
      } catch (errorForTabMessaging) {
        resolveForTabMessaging({ ok: false, nonce: null });
      }
    });
  }

  async function runEnsureContentInjectedForTabMessaging(tabIdForTabMessaging) {
    const probeForTabMessaging = await probeInjectedNonceForTabMessaging(tabIdForTabMessaging);
    if (probeForTabMessaging.ok && probeForTabMessaging.nonce) {
      return true;
    }
    if (!probeForTabMessaging.ok) {
      // The probe could not execute in the tab (no host access, tab gone,
      // frame mid-navigation). File injection into the same target would fail
      // identically, so do not attempt it; callers retry via their own paths.
      return false;
    }

    // From here a copy is really being loaded, so the tab's toolbar icon says
    // so until it is in. The stop sits in a finally: a path that left without
    // it would leave the icon turning until the indicator's own time limit.
    setInjectionIndicatorForTabMessaging(tabIdForTabMessaging, true);
    try {
      return await injectBundleForTabMessaging(tabIdForTabMessaging);
    } finally {
      setInjectionIndicatorForTabMessaging(tabIdForTabMessaging, false);
    }
  }

  // Read at call time: the indicator is a separate worker module, and it is
  // decoration, so a missing or failing one must never stop an injection.
  function setInjectionIndicatorForTabMessaging(tabIdForTabMessaging, isLoadingForTabMessaging) {
    try {
      const indicatorForTabMessaging = (globalScopeForTabMessaging.ABChatBackground || {}).injectionIndicator;
      if (!indicatorForTabMessaging) return;
      if (isLoadingForTabMessaging) {
        indicatorForTabMessaging.start(tabIdForTabMessaging);
      } else {
        indicatorForTabMessaging.stop(tabIdForTabMessaging);
      }
    } catch (errorForTabMessaging) {}
  }

  async function injectBundleForTabMessaging(tabIdForTabMessaging) {
    // Best-effort: the main-world shield is protective, not functional, so a
    // failure here must not block the isolated-world injection below.
    await executeMainWorldScriptFilesForTabMessaging(
      tabIdForTabMessaging,
      mainWorldJsFilesForTabMessaging
    );

    const isScriptInjectedForTabMessaging = await executeScriptFilesForTabMessaging(
      tabIdForTabMessaging,
      injectableJsFilesForTabMessaging
    );

    if (!isScriptInjectedForTabMessaging) {
      return false;
    }

    await insertCssFilesForTabMessaging(tabIdForTabMessaging, injectableCssFilesForTabMessaging);
    return true;
  }

  function ensureContentInjectedForTabMessaging(tabIdForTabMessaging) {
    if (typeof tabIdForTabMessaging !== "number") {
      return Promise.resolve(false);
    }
    const existingRunForTabMessaging = inflightEnsureInjectedForTabMessaging.get(tabIdForTabMessaging);
    if (existingRunForTabMessaging) {
      return existingRunForTabMessaging;
    }
    const runForTabMessaging = runEnsureContentInjectedForTabMessaging(tabIdForTabMessaging)
      .catch(function () {
        return false;
      })
      .then(function (resultForTabMessaging) {
        inflightEnsureInjectedForTabMessaging.delete(tabIdForTabMessaging);
        return resultForTabMessaging;
      });
    inflightEnsureInjectedForTabMessaging.set(tabIdForTabMessaging, runForTabMessaging);
    return runForTabMessaging;
  }

  async function sendActionToTabForTabMessaging(
    tabIdForTabMessaging,
    actionForTabMessaging,
    actionSourceForTabMessaging,
    actionPayloadForTabMessaging
  ) {
    if (typeof tabIdForTabMessaging !== "number" || !actionForTabMessaging) {
      return { ok: false, error: "Invalid tab or action." };
    }

    const requestIdForTabMessaging = buildRequestIdForTabMessaging();
    let lastFailureForTabMessaging = {
      error: "Action dispatch failed.",
      errorCode: "",
      retryable: false
    };

    for (let attemptForTabMessaging = 0; attemptForTabMessaging < maxAttemptsForTabMessaging; attemptForTabMessaging++) {
      const isInjectedForTabMessaging = await ensureContentInjectedForTabMessaging(tabIdForTabMessaging);
      if (!isInjectedForTabMessaging) {
        return {
          ok: false,
          error: "Unable to inject content scripts on this page.",
          errorCode: errorCodesForTabMessaging.injectionFailed || "INJECTION_FAILED",
          attempts: attemptForTabMessaging + 1,
          requestId: requestIdForTabMessaging
        };
      }

      const isReadyForTabMessaging = await checkContentReadyForTabMessaging(tabIdForTabMessaging, 5);
      if (!isReadyForTabMessaging) {
        lastFailureForTabMessaging = {
          error: "Content scripts not ready. Please try again.",
          errorCode: errorCodesForTabMessaging.csNotReady || "CS_NOT_READY",
          retryable: true
        };
      } else {
        const sendResultForTabMessaging = await sendMessageToTabForTabMessaging(
          tabIdForTabMessaging,
          {
            protocolVersion: protocolVersionForTabMessaging,
            requestId: requestIdForTabMessaging,
            action: actionForTabMessaging,
            payload: actionPayloadForTabMessaging || {},
            actionSource: actionSourceForTabMessaging || "",
            source: actionSourceForTabMessaging || "",
            sentAtMs: Date.now(),
            expectsAck: true
          },
          actionResponseTimeoutMsForTabMessaging
        );

        const transportFailureForTabMessaging = classifyTransportErrorForTabMessaging(sendResultForTabMessaging);
        if (transportFailureForTabMessaging) {
          lastFailureForTabMessaging = transportFailureForTabMessaging;
        } else {
          const actionFailureForTabMessaging = classifyActionResponseForTabMessaging(sendResultForTabMessaging.response);
          if (actionFailureForTabMessaging.ok) {
            return {
              ok: true,
              attempts: attemptForTabMessaging + 1,
              requestId: requestIdForTabMessaging
            };
          }
          lastFailureForTabMessaging = actionFailureForTabMessaging;
        }
      }

      if (!lastFailureForTabMessaging.retryable || attemptForTabMessaging === maxAttemptsForTabMessaging - 1) {
        return {
          ok: false,
          error: lastFailureForTabMessaging.error || "Action dispatch failed.",
          errorCode: lastFailureForTabMessaging.errorCode || "",
          attempts: attemptForTabMessaging + 1,
          requestId: requestIdForTabMessaging
        };
      }

      const retryDelayForTabMessaging =
        retryDelaysMsForTabMessaging[attemptForTabMessaging] || retryDelaysMsForTabMessaging[retryDelaysMsForTabMessaging.length - 1];
      await waitForRetryDelayForTabMessaging(retryDelayForTabMessaging);
    }

    return {
      ok: false,
      error: lastFailureForTabMessaging.error || "Action dispatch failed.",
      errorCode: lastFailureForTabMessaging.errorCode || "",
      attempts: maxAttemptsForTabMessaging,
      requestId: requestIdForTabMessaging
    };
  }

  // There is deliberately no "inject into every open tab" helper here. One
  // existed, run after each extension reload so that every tab was ready before
  // the user reached it. A reload does not unload the copy a tab already holds
  // (the new one runs in a fresh isolated world beside it), so that pass added a
  // full copy of the bundle to every open tab on every reload, all at once. A
  // tab now gets its copy when the user reaches it: the service worker injects
  // the tab in view after a reload and each other tab on activation, both
  // through ensureContentInjected.

  globalScopeForTabMessaging.ABChatBackground = {
    ...existingBackgroundNamespaceForTabMessaging,
    tabMessaging: {
      getHostnameFromUrl: getHostnameFromUrlForTabMessaging,
      isSupportedUrl: isSupportedUrlForTabMessaging,
      queryActiveTab: queryActiveTabForTabMessaging,
      sendActionToTab: sendActionToTabForTabMessaging,
      ensureContentInjected: ensureContentInjectedForTabMessaging,
      checkContentReady: checkContentReadyForTabMessaging
    }
  };
})();
