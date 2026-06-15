(function () {
  var AUTOMATION_ENABLED_KEY_FOR_CONSENT = "abchatAutomationEnabled";
  var AUTOMATION_ENABLED_TS_KEY_FOR_CONSENT = "abchatAutomationEnabledTs";

  var enableBtnForConsent = document.getElementById("cdp-enable-btn");
  var cancelBtnForConsent = document.getElementById("cdp-cancel-btn");
  var statusElForConsent = document.getElementById("cdp-status");

  function setStatusForConsent(textForConsent) {
    if (statusElForConsent) {
      statusElForConsent.textContent = textForConsent || "";
    }
  }

  function enableAndCloseForConsent() {
    var payloadForConsent = {};
    payloadForConsent[AUTOMATION_ENABLED_KEY_FOR_CONSENT] = true;
    payloadForConsent[AUTOMATION_ENABLED_TS_KEY_FOR_CONSENT] = Date.now();
    try {
      chrome.storage.local.set(payloadForConsent, function () {
        void chrome.runtime.lastError;
        window.close();
      });
    } catch (errForEnable) {
      window.close();
    }
  }

  if (enableBtnForConsent) {
    enableBtnForConsent.addEventListener("click", enableAndCloseForConsent);
  }

  if (cancelBtnForConsent) {
    cancelBtnForConsent.addEventListener("click", function () {
      window.close();
    });
  }

  try {
    chrome.storage.local.get(AUTOMATION_ENABLED_KEY_FOR_CONSENT, function (itemsForConsent) {
      if (chrome.runtime.lastError) {
        return;
      }
      if (itemsForConsent && itemsForConsent[AUTOMATION_ENABLED_KEY_FOR_CONSENT]) {
        setStatusForConsent("Advanced automation is already enabled.");
        if (enableBtnForConsent) {
          enableBtnForConsent.textContent = "Keep enabled";
        }
      }
    });
  } catch (errForGet) {
    /* ignore */
  }
})();
