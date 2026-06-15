(function () {
  var globalScopeForCdpClient = globalThis;
  var nsForCdpClient = globalScopeForCdpClient.ABChatAgent || {};
  var sharedForCdpClient = globalScopeForCdpClient.ABChatShared || {};
  var actionsForCdpClient = sharedForCdpClient.actions || {};

  function sendCdpOpForCdpClient(opForSend, extraForSend) {
    return new Promise(function (resolveForSend) {
      var messageForSend = {
        action: actionsForCdpClient.cdpAutomation || "cdpAutomation",
        op: opForSend
      };
      if (extraForSend && typeof extraForSend === "object") {
        if (typeof extraForSend.tabId === "number") {
          messageForSend.tabId = extraForSend.tabId;
        }
        if (extraForSend.params) {
          messageForSend.params = extraForSend.params;
        }
        if (extraForSend.viewport) {
          messageForSend.viewport = extraForSend.viewport;
        }
      }
      try {
        chrome.runtime.sendMessage(messageForSend, function (responseForSend) {
          if (chrome.runtime.lastError) {
            resolveForSend({
              ok: false,
              error: { code: "messaging-failed", message: chrome.runtime.lastError.message || "Messaging failed." }
            });
            return;
          }
          resolveForSend(responseForSend || {
            ok: false,
            error: { code: "no-response", message: "No response from background." }
          });
        });
      } catch (errForSend) {
        resolveForSend({
          ok: false,
          error: { code: "messaging-failed", message: (errForSend && errForSend.message) || "Messaging threw." }
        });
      }
    });
  }

  // tabId is optional on every method. When omitted, the service worker resolves
  // the target to the sender's tab.
  nsForCdpClient.cdpClient = {
    acquire: function (tabIdForAcquire) {
      return sendCdpOpForCdpClient("acquire", { tabId: tabIdForAcquire });
    },
    release: function (tabIdForRelease, immediateForRelease) {
      return sendCdpOpForCdpClient("release", {
        tabId: tabIdForRelease,
        params: immediateForRelease === true ? { immediate: true } : undefined
      });
    },
    detach: function (tabIdForDetach) {
      return sendCdpOpForCdpClient("detach", { tabId: tabIdForDetach });
    },
    state: function (tabIdForState) {
      return sendCdpOpForCdpClient("state", { tabId: tabIdForState });
    },
    command: function (tabIdForCommand, methodForCommand, paramsForCommand) {
      return sendCdpOpForCdpClient("command", {
        tabId: tabIdForCommand,
        params: { method: methodForCommand, params: paramsForCommand }
      });
    },
    act: function (actionForAct, paramsForAct, tabIdForAct) {
      var actParamsForAct = {};
      if (paramsForAct && typeof paramsForAct === "object") {
        Object.keys(paramsForAct).forEach(function (keyForAct) {
          if (typeof paramsForAct[keyForAct] !== "undefined") {
            actParamsForAct[keyForAct] = paramsForAct[keyForAct];
          }
        });
      }
      actParamsForAct.action = actionForAct;
      return sendCdpOpForCdpClient("act", { tabId: tabIdForAct, params: actParamsForAct });
    }
  };

  globalScopeForCdpClient.ABChatAgent = nsForCdpClient;
})();
