(function () {
  const globalScopeForRuntimeRequest = globalThis;
  const existingNamespaceForRuntimeRequest = globalScopeForRuntimeRequest.ABChatShared || {};
  const communicationForRuntimeRequest = existingNamespaceForRuntimeRequest.communication || {};
  const errorCodesForRuntimeRequest = communicationForRuntimeRequest.errorCodes || {};
  const defaultRetryDelaysMsForRuntimeRequest = [80, 160];
  const defaultTimeoutMsForRuntimeRequest = 1200;

  function isRetryableRuntimeErrorForRuntimeRequest(errorMessageForRuntimeRequest) {
    if (!errorMessageForRuntimeRequest || typeof errorMessageForRuntimeRequest !== "string") {
      return false;
    }
    return (
      errorMessageForRuntimeRequest.includes("Receiving end does not exist") ||
      errorMessageForRuntimeRequest.includes("message channel closed before a response was received") ||
      errorMessageForRuntimeRequest.includes("The message port closed before a response was received")
    );
  }

  function waitForRetryDelayForRuntimeRequest(delayMsForRuntimeRequest) {
    return new Promise((resolveForRuntimeRequest) => {
      setTimeout(resolveForRuntimeRequest, delayMsForRuntimeRequest);
    });
  }

  function buildRequestIdForRuntimeRequest() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function sendRuntimeRequestAttemptForRuntimeRequest(
    typeForRuntimeRequest,
    payloadForRuntimeRequest,
    requestIdForRuntimeRequest,
    timeoutMsForRuntimeRequest
  ) {
    return new Promise((resolveForRuntimeRequest) => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolveForRuntimeRequest({
          response: {
            ok: false,
            error: "Runtime messaging is unavailable.",
            errorCode: errorCodesForRuntimeRequest.invalidRequest || "INVALID_REQUEST"
          },
          shouldRetry: false
        });
        return;
      }

      let isSettledForRuntimeRequest = false;
      const timeoutHandleForRuntimeRequest = setTimeout(() => {
        if (isSettledForRuntimeRequest) {
          return;
        }
        isSettledForRuntimeRequest = true;
        resolveForRuntimeRequest({
          response: {
            ok: false,
            error: "Request timed out.",
            errorCode: errorCodesForRuntimeRequest.timeout || "REQUEST_TIMEOUT"
          },
          shouldRetry: true
        });
      }, timeoutMsForRuntimeRequest);

      const finalizeForRuntimeRequest = (responseForRuntimeRequest, shouldRetryForRuntimeRequest) => {
        if (isSettledForRuntimeRequest) {
          return;
        }
        isSettledForRuntimeRequest = true;
        clearTimeout(timeoutHandleForRuntimeRequest);
        resolveForRuntimeRequest({
          response: responseForRuntimeRequest,
          shouldRetry: Boolean(shouldRetryForRuntimeRequest)
        });
      };

      try {
        chrome.runtime.sendMessage(
          {
            type: typeForRuntimeRequest,
            requestId: requestIdForRuntimeRequest || "",
            sentAtMs: Date.now(),
            ...(payloadForRuntimeRequest || {})
          },
          (responseForRuntimeRequest) => {
            if (chrome.runtime.lastError) {
              finalizeForRuntimeRequest(
                { ok: false, error: chrome.runtime.lastError.message },
                isRetryableRuntimeErrorForRuntimeRequest(chrome.runtime.lastError.message)
              );
              return;
            }
            finalizeForRuntimeRequest(responseForRuntimeRequest || { ok: false, error: "No response." }, false);
          }
        );
      } catch (errorForRuntimeRequest) {
        const errorMessageForRuntimeRequest =
          errorForRuntimeRequest && errorForRuntimeRequest.message
            ? errorForRuntimeRequest.message
            : "Runtime request failed.";
        finalizeForRuntimeRequest(
          { ok: false, error: errorMessageForRuntimeRequest },
          isRetryableRuntimeErrorForRuntimeRequest(errorMessageForRuntimeRequest)
        );
      }
    });
  }

  async function sendRequestForRuntimeRequest(typeForRuntimeRequest, payloadForRuntimeRequest, optionsForRuntimeRequest) {
    const resolvedOptionsForRuntimeRequest = optionsForRuntimeRequest || {};
    const retryDelaysMsForRuntimeRequest = Array.isArray(resolvedOptionsForRuntimeRequest.retryDelaysMs)
      ? resolvedOptionsForRuntimeRequest.retryDelaysMs
      : defaultRetryDelaysMsForRuntimeRequest;
    const timeoutMsForRuntimeRequest =
      typeof resolvedOptionsForRuntimeRequest.timeoutMs === "number" && resolvedOptionsForRuntimeRequest.timeoutMs > 0
        ? resolvedOptionsForRuntimeRequest.timeoutMs
        : defaultTimeoutMsForRuntimeRequest;
    const requestIdForRuntimeRequest =
      typeof resolvedOptionsForRuntimeRequest.requestId === "string" && resolvedOptionsForRuntimeRequest.requestId
        ? resolvedOptionsForRuntimeRequest.requestId
        : buildRequestIdForRuntimeRequest();

    for (
      let attemptForRuntimeRequest = 0;
      attemptForRuntimeRequest <= retryDelaysMsForRuntimeRequest.length;
      attemptForRuntimeRequest++
    ) {
      const attemptResultForRuntimeRequest = await sendRuntimeRequestAttemptForRuntimeRequest(
        typeForRuntimeRequest,
        payloadForRuntimeRequest,
        requestIdForRuntimeRequest,
        timeoutMsForRuntimeRequest
      );
      if (!attemptResultForRuntimeRequest.shouldRetry) {
        return attemptResultForRuntimeRequest.response || { ok: false, error: "No response." };
      }
      if (attemptForRuntimeRequest < retryDelaysMsForRuntimeRequest.length) {
        await waitForRetryDelayForRuntimeRequest(retryDelaysMsForRuntimeRequest[attemptForRuntimeRequest]);
      }
    }
    return { ok: false, error: "Runtime request failed after retries." };
  }

  globalScopeForRuntimeRequest.ABChatShared = {
    ...existingNamespaceForRuntimeRequest,
    runtimeRequest: {
      sendRequest: sendRequestForRuntimeRequest,
      buildRequestId: buildRequestIdForRuntimeRequest
    }
  };
})();
