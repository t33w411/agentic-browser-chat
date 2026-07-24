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
  const reInjectPerTabTimeoutMsForTabMessaging = 2500;
  // Bounded concurrency for re-injection across all supported tabs after an
  // extension reload. A fully sequential loop (which is the most conservative
  // path) makes recovery scale linearly with the number of open tabs; a small
  // pool gives an N/K speedup while staying well inside what
  // chrome.scripting.executeScript handles comfortably.
  // Per-tab failures still isolate via the same Promise.race timeout +
  // try/catch as before, so a misbehaving tab cannot stall a worker for more
  // than reInjectPerTabTimeoutMsForTabMessaging.
  const reInjectConcurrencyForTabMessaging = 4;

  const injectableJsFilesForTabMessaging = [
    "content/preInit.js",
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
    "agent/apiLogger.js",
    "agent/pageActionLogger.js",
    "agent/tools.js",
    "agent/documentGeneration.js",
    "agent/cdpClient.js",
    "agent/toolExec.js",
    "agent/contextBuilder.js",
    "agent/client.js",
    "agent/compactor.js",
    "agent/hooks/registry.js",
    "agent/hooks/builtin/memoryClaimGuard.js",
    "agent/hooks/builtin/imageGenerationCap.js",
    "agent/hooks/builtin/toolCallCap.js",
    "panel/panelRuntime.js",
    "panel/panel.js",
    "panel/panelStateSync.js",
    "ui/floatingPanel.js",
    "tools/selectionContextActions.js",
    "tools/flattenedContent.js",
    "tools/contentSelector.js",
    "content/main.js"
  ];

  const injectableCssFilesForTabMessaging = ["styles.css"];

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

  async function ensureContentInjectedForTabMessaging(tabIdForTabMessaging) {
    const checkResultForTabMessaging = await sendMessageToTabForTabMessaging(tabIdForTabMessaging, {
      action: actionsForTabMessaging.checkInjected || "checkInjected"
    }, actionResponseTimeoutMsForTabMessaging);

    // Trust "already injected" only when context validity is explicitly confirmed.
    // Older/stale scripts may reply injected:true even after extension reload, which
    // can block required reinjection unless we require this stronger handshake signal.
    if (
      checkResultForTabMessaging.response &&
      checkResultForTabMessaging.response.injected &&
      checkResultForTabMessaging.response.contextValid === true
    ) {
      return true;
    }

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

  // Proactive re-injection after extension reload/update.
  //
  // When the extension reloads, Chrome invalidates the runtime context of every
  // content script running in open tabs. Without this function the user would have
  // to manually refresh every tab before the extension works again.
  //
  // Calling this from onInstalled in the service worker re-runs all content scripts
  // immediately after the reload, so all open tabs are ready before the user returns
  // to them. Content scripts detect re-injection via migration-safe page markers
  // (abchatMainInitNonce + legacy fallback) and perform a clean reset (see content/main.js).
  //
  // Lessons learned:
  // - "checkInjected" is insufficient by itself; require explicit context validity.
  // - Per-tab timeouts are necessary so one hung tab cannot block all recovery.
  // - Bounded-concurrency (small worker pool) is faster than fully sequential
  //   while remaining safely under chrome.scripting.executeScript limits.
  //
  // Bounded worker pool over a shared cursor. Per-tab try/catch so a single
  // failing tab does not abort the rest, and a Promise.race timeout so one
  // hung tab cannot stall its worker past reInjectPerTabTimeoutMsForTabMessaging.
  async function reInjectIntoAllSupportedTabsForTabMessaging() {
    const allTabsForTabMessaging = await new Promise((resolveForTabMessaging) => {
      chrome.tabs.query({}, (tabsForTabMessaging) => {
        resolveForTabMessaging(Array.isArray(tabsForTabMessaging) ? tabsForTabMessaging : []);
      });
    });

    const supportedTabsForTabMessaging = allTabsForTabMessaging.filter((tabForTabMessaging) => {
      return isSupportedUrlForTabMessaging(tabForTabMessaging.url);
    });

    if (supportedTabsForTabMessaging.length === 0) {
      return;
    }

    let nextIndexForTabMessaging = 0;
    const workerCountForTabMessaging = Math.min(
      reInjectConcurrencyForTabMessaging,
      supportedTabsForTabMessaging.length
    );

    async function reInjectWorkerForTabMessaging() {
      while (true) {
        const idxForTabMessaging = nextIndexForTabMessaging++;
        if (idxForTabMessaging >= supportedTabsForTabMessaging.length) {
          return;
        }
        const tabForTabMessaging = supportedTabsForTabMessaging[idxForTabMessaging];
        try {
          await Promise.race([
            ensureContentInjectedForTabMessaging(tabForTabMessaging.id),
            new Promise((resolveForTabMessaging) => {
              setTimeout(() => {
                resolveForTabMessaging(false);
              }, reInjectPerTabTimeoutMsForTabMessaging);
            })
          ]);
        } catch (errForTabMessaging) {
          // Skip tabs that fail injection silently
        }
      }
    }

    const workersForTabMessaging = [];
    for (let workerIndexForTabMessaging = 0; workerIndexForTabMessaging < workerCountForTabMessaging; workerIndexForTabMessaging++) {
      workersForTabMessaging.push(reInjectWorkerForTabMessaging());
    }
    await Promise.all(workersForTabMessaging);
  }

  globalScopeForTabMessaging.ABChatBackground = {
    ...existingBackgroundNamespaceForTabMessaging,
    tabMessaging: {
      getHostnameFromUrl: getHostnameFromUrlForTabMessaging,
      isSupportedUrl: isSupportedUrlForTabMessaging,
      queryActiveTab: queryActiveTabForTabMessaging,
      sendActionToTab: sendActionToTabForTabMessaging,
      ensureContentInjected: ensureContentInjectedForTabMessaging,
      checkContentReady: checkContentReadyForTabMessaging,
      reInjectIntoAllSupportedTabs: reInjectIntoAllSupportedTabsForTabMessaging
    }
  };
})();
