(function () {
  var PRINT_MODE_KEY_FOR_PRINT_CONSENT = 'abchatPdfPrintMode';
  var PRINT_MODE_TS_KEY_FOR_PRINT_CONSENT = 'abchatPdfPrintModeTs';

  var chromeBtnForPrintConsent = document.getElementById('print-use-chrome-btn');
  var basicBtnForPrintConsent = document.getElementById('print-use-basic-btn');
  var statusElForPrintConsent = document.getElementById('print-consent-status');

  // The service worker is waiting on this key, so the choice is stored before the window closes.
  function chooseForPrintConsent(modeForChoice) {
    var payloadForChoice = {};
    payloadForChoice[PRINT_MODE_KEY_FOR_PRINT_CONSENT] = modeForChoice;
    payloadForChoice[PRINT_MODE_TS_KEY_FOR_PRINT_CONSENT] = Date.now();
    try {
      chrome.storage.local.set(payloadForChoice, function () {
        void chrome.runtime.lastError;
        window.close();
      });
    } catch (errForChoice) {
      window.close();
    }
  }

  if (chromeBtnForPrintConsent) {
    chromeBtnForPrintConsent.addEventListener('click', function () { chooseForPrintConsent('chrome'); });
  }
  if (basicBtnForPrintConsent) {
    basicBtnForPrintConsent.addEventListener('click', function () { chooseForPrintConsent('basic'); });
  }

  try {
    chrome.storage.local.get(PRINT_MODE_KEY_FOR_PRINT_CONSENT, function (itemsForPrintConsent) {
      if (chrome.runtime.lastError || !statusElForPrintConsent) return;
      var currentForPrintConsent = itemsForPrintConsent && itemsForPrintConsent[PRINT_MODE_KEY_FOR_PRINT_CONSENT];
      if (currentForPrintConsent === 'chrome') statusElForPrintConsent.textContent = 'PDFs are currently printed by Chrome.';
      if (currentForPrintConsent === 'basic') statusElForPrintConsent.textContent = 'PDFs are currently made by the built-in writer.';
    });
  } catch (errForPrintConsentGet) {
    /* ignore */
  }
})();
