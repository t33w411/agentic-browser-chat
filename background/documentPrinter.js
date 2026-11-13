(function () {
  var globalScopeForPrinter = globalThis;
  var nsForPrinter = globalScopeForPrinter.ABChatBackground || {};

  // Prints a document page to PDF with Chrome's own print engine. The page is a blank extension
  // page in a background tab. The debugger fills it with the HTML from agent/documentPrint.js,
  // waits for its fonts, prints it, and closes the tab. This is separate from Advanced automation:
  // it only ever attaches to its own tab, and it has its own consent (abchatPdfPrintMode).

  var PRINT_MODE_KEY_FOR_PRINTER = 'abchatPdfPrintMode';
  var PRINT_MODE_TS_KEY_FOR_PRINTER = 'abchatPdfPrintModeTs';
  var PRINT_PAGE_PATH_FOR_PRINTER = 'print/print.html';
  var CONSENT_PAGE_PATH_FOR_PRINTER = 'print/consent.html';
  var CDP_VERSION_FOR_PRINTER = '1.3';
  var CONSENT_WAIT_MS_FOR_PRINTER = 90000;
  var TAB_LOAD_TIMEOUT_MS_FOR_PRINTER = 15000;
  var FONT_WAIT_MS_FOR_PRINTER = 15000;
  var IMAGE_WAIT_MS_FOR_PRINTER = 10000;
  var PRINT_TIMEOUT_MS_FOR_PRINTER = 120000;
  var STREAM_CHUNK_BYTES_FOR_PRINTER = 1024 * 1024;
  // Runtime messages carry the PDF back as base64, and Chrome caps a message at 64 MiB.
  var MAX_PDF_BYTES_FOR_PRINTER = 40 * 1024 * 1024;
  var MAX_HTML_CHARS_FOR_PRINTER = 50 * 1024 * 1024;
  // @page margin boxes (page numbers and the running header in the page's own fonts) arrived in
  // Chrome 131. Older versions get Chrome's header and footer templates instead.
  var MARGIN_BOXES_CHROME_FOR_PRINTER = 131;
  var OUTLINE_AND_TAGS_CHROME_FOR_PRINTER = 126;
  var FONT_URL_PREFIX_FOR_PRINTER = 'https://cdn.jsdelivr.net/fontsource/fonts/';

  var queueForPrinter = Promise.resolve();
  var consentWaitForPrinter = null;
  var consentWindowIdForPrinter = null;

  function noopForPrinter() {}

  function chromeMajorVersionForPrinter() {
    var navigatorForVersion = globalScopeForPrinter.navigator;
    var matchForVersion = /Chrome\/(\d+)/.exec(String((navigatorForVersion && navigatorForVersion.userAgent) || ''));
    return matchForVersion ? Number(matchForVersion[1]) : 0;
  }

  function getPrintModeForPrinter() {
    return new Promise(function (resolveForMode) {
      try {
        chrome.storage.local.get(PRINT_MODE_KEY_FOR_PRINTER, function (itemsForMode) {
          if (chrome.runtime.lastError) { resolveForMode(''); return; }
          var valueForMode = itemsForMode && itemsForMode[PRINT_MODE_KEY_FOR_PRINTER];
          resolveForMode(valueForMode === 'chrome' || valueForMode === 'basic' ? valueForMode : '');
        });
      } catch (errForMode) {
        resolveForMode('');
      }
    });
  }

  // The first PDF asks the user once, in a small window: Chrome's printer or the built-in writer.
  // The answer is stored, and Settings can change it. A PDF requested while the window is open
  // waits for the answer, up to a limit, and is then made by the built-in writer; the window
  // stays open, so the answer still applies to the next PDF.
  function waitForConsentForPrinter() {
    if (consentWaitForPrinter) return consentWaitForPrinter;
    consentWaitForPrinter = new Promise(function (resolveForConsent) {
      var windowIdForConsent = null;
      var settledForConsent = false;
      var timerForConsent = null;
      function finishForConsent(answerForConsent) {
        if (settledForConsent) return;
        settledForConsent = true;
        clearTimeout(timerForConsent);
        try { chrome.storage.onChanged.removeListener(onStorageChangedForConsent); } catch (errRemoveStorage) { /* ignore */ }
        try { chrome.windows.onRemoved.removeListener(onWindowRemovedForConsent); } catch (errRemoveWindow) { /* ignore */ }
        consentWaitForPrinter = null;
        resolveForConsent(answerForConsent);
      }
      function onStorageChangedForConsent(changesForConsent, areaForConsent) {
        if (areaForConsent !== 'local' || !changesForConsent[PRINT_MODE_KEY_FOR_PRINTER]) return;
        var valueForConsent = changesForConsent[PRINT_MODE_KEY_FOR_PRINTER].newValue;
        if (valueForConsent === 'chrome' || valueForConsent === 'basic') finishForConsent(valueForConsent);
      }
      function onWindowRemovedForConsent(removedIdForConsent) {
        if (removedIdForConsent !== windowIdForConsent) return;
        getPrintModeForPrinter().then(function (modeForClosed) { finishForConsent(modeForClosed || 'closed'); });
      }
      chrome.storage.onChanged.addListener(onStorageChangedForConsent);
      chrome.windows.onRemoved.addListener(onWindowRemovedForConsent);
      timerForConsent = setTimeout(function () { finishForConsent('timeout'); }, CONSENT_WAIT_MS_FOR_PRINTER);
      function openWindowForConsent() {
        try {
          chrome.windows.create(
            { type: 'popup', url: chrome.runtime.getURL(CONSENT_PAGE_PATH_FOR_PRINTER), width: 480, height: 470, focused: true },
            function (windowForConsent) {
              if (chrome.runtime.lastError || !windowForConsent) { finishForConsent('closed'); return; }
              windowIdForConsent = windowForConsent.id;
              consentWindowIdForPrinter = windowForConsent.id;
            }
          );
        } catch (errCreateForConsent) {
          finishForConsent('closed');
        }
      }
      // A window left open from a wait that timed out is brought forward rather than opened twice.
      if (consentWindowIdForPrinter == null) { openWindowForConsent(); return; }
      chrome.windows.update(consentWindowIdForPrinter, { focused: true }, function (windowForReuse) {
        if (chrome.runtime.lastError || !windowForReuse) { consentWindowIdForPrinter = null; openWindowForConsent(); return; }
        windowIdForConsent = windowForReuse.id;
      });
    });
    return consentWaitForPrinter;
  }

  // The HTML comes from our own renderer, which escapes every piece of text, but it is loaded into
  // an extension page, so anything that could run script or fetch from elsewhere is refused here
  // as a second line of defence. Fonts may only come from the font CDN, and images only inline.
  function checkHtmlForPrinter(htmlForCheck) {
    var textForCheck = String(htmlForCheck || '');
    if (!textForCheck) return 'there was no page to print';
    if (textForCheck.length > MAX_HTML_CHARS_FOR_PRINTER) return 'the page is too large to print';
    // Document text is escaped, so a raw "<" only ever starts a tag the renderer wrote.
    if (/<\s*(script|iframe|frame|object|embed|link|base|form|svg|math|video|audio|source|portal)\b/i.test(textForCheck)) return 'the page contains an element that is not allowed';
    if (/<\s*meta\b(?![^>]*\bcharset=)/i.test(textForCheck)) return 'the page contains an element that is not allowed';
    if (/<[^>]*\son[a-z]+\s*=/i.test(textForCheck)) return 'the page contains an event handler';
    if (/<a\b[^>]*\shref\s*=\s*"(?!https?:|mailto:)/i.test(textForCheck)) return 'the page contains a link that is not allowed';
    var imageRe = /<img\b[^>]*?\ssrc\s*=\s*"([^"]*)"/gi;
    var matchForImage;
    while ((matchForImage = imageRe.exec(textForCheck)) !== null) {
      if (!/^data:image\//i.test(matchForImage[1])) return 'the page refers to an image outside the document';
    }
    var stylesForCheck = [];
    textForCheck.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (wholeForStyle, cssForStyle) { stylesForCheck.push(cssForStyle); return wholeForStyle; });
    textForCheck.replace(/<[^>]*\sstyle\s*=\s*"([^"]*)"/gi, function (wholeForAttr, cssForAttr) { stylesForCheck.push(cssForAttr); return wholeForAttr; });
    for (var iForStyle = 0; iForStyle < stylesForCheck.length; iForStyle++) {
      var cssForCheck = stylesForCheck[iForStyle];
      if (/@import/i.test(cssForCheck)) return 'the page imports a stylesheet';
      // image-set() takes a bare URL string, so it would get past the url() check below.
      if (/image-set\s*\(/i.test(cssForCheck)) return 'the page refers to a resource outside the font library';
      var urlRe = /url\(\s*["']?([^"')\s]*)/gi;
      var matchForUrl;
      while ((matchForUrl = urlRe.exec(cssForCheck)) !== null) {
        if (matchForUrl[1].indexOf(FONT_URL_PREFIX_FOR_PRINTER) !== 0) return 'the page refers to a resource outside the font library';
      }
    }
    return '';
  }

  function callForPrinter(targetForCall, methodForCall, paramsForCall) {
    return new Promise(function (resolveForCall, rejectForCall) {
      try {
        chrome.debugger.sendCommand(targetForCall, methodForCall, paramsForCall || {}, function (resultForCall) {
          if (chrome.runtime.lastError) {
            rejectForCall(new Error(chrome.runtime.lastError.message || (methodForCall + ' failed')));
            return;
          }
          resolveForCall(resultForCall || {});
        });
      } catch (errForCall) {
        rejectForCall(errForCall);
      }
    });
  }

  function withTimeoutForPrinter(promiseForTimeout, msForTimeout, labelForTimeout) {
    var timerForTimeout = null;
    return Promise.race([
      promiseForTimeout,
      new Promise(function (resolveIgnored, rejectForTimeout) {
        timerForTimeout = setTimeout(function () { rejectForTimeout(new Error(labelForTimeout + ' took too long')); }, msForTimeout);
      })
    ]).then(function (valueForTimeout) {
      clearTimeout(timerForTimeout);
      return valueForTimeout;
    }, function (errForTimeout) {
      clearTimeout(timerForTimeout);
      throw errForTimeout;
    });
  }

  function waitForTabCompleteForPrinter(tabIdForWait) {
    return withTimeoutForPrinter(new Promise(function (resolveForWait) {
      function onUpdatedForWait(updatedIdForWait, infoForWait) {
        if (updatedIdForWait === tabIdForWait && infoForWait && infoForWait.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdatedForWait);
          resolveForWait();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdatedForWait);
      chrome.tabs.get(tabIdForWait, function (tabForWait) {
        void chrome.runtime.lastError;
        if (tabForWait && tabForWait.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdatedForWait);
          resolveForWait();
        }
      });
    }), TAB_LOAD_TIMEOUT_MS_FOR_PRINTER, 'opening the print page');
  }

  // Runs in the print page. Reading offsetHeight forces layout, which starts loading exactly the
  // font faces the text uses, and document.fonts.ready then waits for them. img.decode() never
  // settles in a hidden tab, so images are polled for `complete` instead. A user-named font that
  // did not load is looked for among the fonts installed on this computer, by measuring text
  // against each generic family.
  function readinessExpressionForPrinter(familiesForExpression) {
    return '(' + function (familiesForPage, fontWaitMs, imageWaitMs) {
      function sleepForPage(msForSleep) { return new Promise(function (resolveForSleep) { setTimeout(resolveForSleep, msForSleep); }); }
      void (document.body ? document.body.offsetHeight : 0);
      var timedOutForPage = false;
      return Promise.race([
        document.fonts.ready,
        sleepForPage(fontWaitMs).then(function () { timedOutForPage = true; })
      ]).then(function () {
        var imageDeadlineForPage = Date.now() + imageWaitMs;
        function imagesDoneForPage() {
          return Array.prototype.every.call(document.images, function (imgForPage) { return imgForPage.complete; });
        }
        function pollImagesForPage() {
          if (imagesDoneForPage() || Date.now() > imageDeadlineForPage) return null;
          return sleepForPage(100).then(pollImagesForPage);
        }
        return pollImagesForPage();
      }).then(function () {
        var statusForPage = {};
        document.fonts.forEach(function (faceForStatus) {
          var familyForStatus = String(faceForStatus.family).replace(/^["']|["']$/g, '');
          var entryForStatus = statusForPage[familyForStatus] || (statusForPage[familyForStatus] = { loaded: 0, error: 0 });
          if (faceForStatus.status === 'loaded') entryForStatus.loaded++;
          if (faceForStatus.status === 'error') entryForStatus.error++;
        });
        var installedForPage = {};
        var canvasForPage = document.createElement('canvas').getContext('2d');
        (familiesForPage || []).forEach(function (familyForInstalled) {
          if (!canvasForPage) return;
          installedForPage[familyForInstalled] = ['monospace', 'serif', 'sans-serif'].some(function (genericForInstalled) {
            canvasForPage.font = '72px ' + genericForInstalled;
            var baseWidthForInstalled = canvasForPage.measureText('mmmmmmmmmlli WQ@#').width;
            canvasForPage.font = '72px "' + familyForInstalled + '", ' + genericForInstalled;
            return canvasForPage.measureText('mmmmmmmmmlli WQ@#').width !== baseWidthForInstalled;
          });
        });
        return { fonts: statusForPage, installed: installedForPage, timedOut: timedOutForPage };
      });
    }.toString() + ')(' + JSON.stringify(familiesForExpression) + ', ' + FONT_WAIT_MS_FOR_PRINTER + ', ' + IMAGE_WAIT_MS_FOR_PRINTER + ')';
  }

  function fontWarningsForPrinter(fontsForWarnings, readyForWarnings) {
    var warningsForFonts = [];
    var statusForWarnings = (readyForWarnings && readyForWarnings.fonts) || {};
    var installedForWarnings = (readyForWarnings && readyForWarnings.installed) || {};
    var libraryFailedForWarnings = false;
    (fontsForWarnings || []).forEach(function (fontForWarning) {
      var entryForWarning = statusForWarnings[fontForWarning.alias];
      var loadedForWarning = !!(entryForWarning && entryForWarning.loaded > 0);
      var failedForWarning = !!(entryForWarning && entryForWarning.error > 0 && entryForWarning.loaded === 0);
      if (fontForWarning.userNamed) {
        if (!loadedForWarning && !installedForWarnings[fontForWarning.family]) {
          warningsForFonts.push('The font "' + fontForWarning.family + '" is neither in the web font library nor installed on this computer, so the PDF uses a substitute.');
        }
        return;
      }
      if (failedForWarning) libraryFailedForWarnings = true;
    });
    if (libraryFailedForWarnings) {
      warningsForFonts.push('Some web fonts could not be downloaded, so parts of the PDF use fonts installed on this computer instead.');
    }
    if (readyForWarnings && readyForWarnings.timedOut) {
      warningsForFonts.push('Some fonts took too long to download, so the PDF may use substitutes for them.');
    }
    return warningsForFonts;
  }

  function readStreamForPrinter(targetForStream, handleForStream) {
    var chunksForStream = [];
    var totalForStream = 0;
    function readNextForStream() {
      return callForPrinter(targetForStream, 'IO.read', { handle: handleForStream, size: STREAM_CHUNK_BYTES_FOR_PRINTER }).then(function (chunkForStream) {
        var binaryForStream = chunkForStream.base64Encoded ? atob(chunkForStream.data || '') : String(chunkForStream.data || '');
        chunksForStream.push(binaryForStream);
        totalForStream += binaryForStream.length;
        if (totalForStream > MAX_PDF_BYTES_FOR_PRINTER) throw new Error('the PDF came out larger than 40 MB; split the document into smaller files');
        return chunkForStream.eof ? null : readNextForStream();
      });
    }
    return readNextForStream().then(function () {
      return callForPrinter(targetForStream, 'IO.close', { handle: handleForStream }).catch(noopForPrinter);
    }).then(function () {
      return btoa(chunksForStream.join(''));
    });
  }

  // job: { html, title, fonts: [{ alias, family, userNamed }], templates: { needed, header, footer } }
  // Resolves to { ok: true, base64, warnings } or { ok: false, code, error }. code 'declined'
  // means the user chose the built-in writer; the caller's note says so in one sentence.
  async function runPrintJobForPrinter(jobForPrint) {
    var modeForPrint = await getPrintModeForPrinter();
    if (modeForPrint === 'basic') return { ok: false, code: 'declined' };
    if (modeForPrint !== 'chrome') {
      var answerForPrint = await waitForConsentForPrinter();
      if (answerForPrint === 'basic') return { ok: false, code: 'declined' };
      if (answerForPrint !== 'chrome') {
        return { ok: false, code: 'no-consent', error: 'the user has not chosen yet whether Chrome may print PDFs' };
      }
    }
    var problemForPrint = checkHtmlForPrinter(jobForPrint && jobForPrint.html);
    if (problemForPrint) return { ok: false, code: 'failed', error: problemForPrint };

    var tabIdForPrint = null;
    var attachedForPrint = false;
    var detachReasonForPrint = '';
    function onDetachForPrint(sourceForDetach, reasonForDetach) {
      if (sourceForDetach && sourceForDetach.tabId === tabIdForPrint) {
        attachedForPrint = false;
        detachReasonForPrint = reasonForDetach || 'detached';
      }
    }
    chrome.debugger.onDetach.addListener(onDetachForPrint);
    var targetForPrint = null;
    try {
      var tabForPrint = await chrome.tabs.create({ url: chrome.runtime.getURL(PRINT_PAGE_PATH_FOR_PRINTER), active: false });
      tabIdForPrint = tabForPrint.id;
      targetForPrint = { tabId: tabIdForPrint };
      await waitForTabCompleteForPrinter(tabIdForPrint);
      await new Promise(function (resolveForAttach, rejectForAttach) {
        chrome.debugger.attach(targetForPrint, CDP_VERSION_FOR_PRINTER, function () {
          if (chrome.runtime.lastError) { rejectForAttach(new Error(chrome.runtime.lastError.message || 'could not attach')); return; }
          resolveForAttach();
        });
      });
      attachedForPrint = true;
      var treeForPrint = await callForPrinter(targetForPrint, 'Page.getFrameTree');
      await callForPrinter(targetForPrint, 'Page.setDocumentContent', { frameId: treeForPrint.frameTree.frame.id, html: jobForPrint.html });
      var userFamiliesForPrint = (jobForPrint.fonts || []).filter(function (fontForFilter) { return fontForFilter && fontForFilter.userNamed; })
        .map(function (fontForMap) { return String(fontForMap.family || ''); });
      var evaluatedForPrint = await withTimeoutForPrinter(callForPrinter(targetForPrint, 'Runtime.evaluate', {
        expression: readinessExpressionForPrinter(userFamiliesForPrint),
        awaitPromise: true,
        returnByValue: true
      }), FONT_WAIT_MS_FOR_PRINTER + IMAGE_WAIT_MS_FOR_PRINTER + 5000, 'loading fonts');
      var readyForPrint = (evaluatedForPrint && evaluatedForPrint.result && evaluatedForPrint.result.value) || {};
      var versionForPrint = chromeMajorVersionForPrinter();
      var paramsForPrint = { printBackground: true, preferCSSPageSize: true, transferMode: 'ReturnAsStream' };
      if (versionForPrint >= OUTLINE_AND_TAGS_CHROME_FOR_PRINTER) {
        paramsForPrint.generateDocumentOutline = true;
        paramsForPrint.generateTaggedPDF = true;
      }
      var templatesForPrint = jobForPrint.templates || {};
      if (versionForPrint < MARGIN_BOXES_CHROME_FOR_PRINTER && templatesForPrint.needed) {
        paramsForPrint.displayHeaderFooter = true;
        paramsForPrint.headerTemplate = String(templatesForPrint.header || '<div></div>');
        paramsForPrint.footerTemplate = String(templatesForPrint.footer || '<div></div>');
      }
      var printedForPrint = await withTimeoutForPrinter(callForPrinter(targetForPrint, 'Page.printToPDF', paramsForPrint), PRINT_TIMEOUT_MS_FOR_PRINTER, 'printing');
      if (!printedForPrint.stream) throw new Error('Chrome returned no PDF');
      var base64ForPrint = await readStreamForPrinter(targetForPrint, printedForPrint.stream);
      return { ok: true, base64: base64ForPrint, warnings: fontWarningsForPrinter(jobForPrint.fonts, readyForPrint) };
    } catch (errForPrint) {
      if (detachReasonForPrint === 'canceled_by_user') {
        return { ok: false, code: 'cancelled', error: 'the debugging banner was closed while the PDF was printing' };
      }
      return { ok: false, code: 'failed', error: errForPrint && errForPrint.message ? errForPrint.message : 'printing failed' };
    } finally {
      chrome.debugger.onDetach.removeListener(onDetachForPrint);
      if (attachedForPrint && targetForPrint) {
        await new Promise(function (resolveForDetach) {
          chrome.debugger.detach(targetForPrint, function () { void chrome.runtime.lastError; resolveForDetach(); });
        });
      }
      if (tabIdForPrint != null) {
        try { await chrome.tabs.remove(tabIdForPrint); } catch (errRemoveForPrint) { /* already closed */ }
      }
    }
  }

  // One job at a time, so at most one print tab is ever open.
  function printPdfForPrinter(jobForQueue) {
    var runForQueue = queueForPrinter.then(function () { return runPrintJobForPrinter(jobForQueue); });
    queueForPrinter = runForQueue.catch(noopForPrinter);
    return runForQueue;
  }

  // A worker that stopped mid-job leaves its print tab open. Close any such tab when the worker starts.
  function closeStrayPrintTabsForPrinter() {
    try {
      chrome.tabs.query({ url: chrome.runtime.getURL(PRINT_PAGE_PATH_FOR_PRINTER) + '*' }, function (tabsForStray) {
        void chrome.runtime.lastError;
        (tabsForStray || []).forEach(function (tabForStray) {
          chrome.tabs.remove(tabForStray.id, function () { void chrome.runtime.lastError; });
        });
      });
    } catch (errForStray) { /* ignore */ }
  }
  closeStrayPrintTabsForPrinter();

  nsForPrinter.documentPrinter = {
    PRINT_MODE_KEY: PRINT_MODE_KEY_FOR_PRINTER,
    PRINT_MODE_TS_KEY: PRINT_MODE_TS_KEY_FOR_PRINTER,
    printPdf: printPdfForPrinter,
    getPrintMode: getPrintModeForPrinter,
    checkHtml: checkHtmlForPrinter
  };

  globalScopeForPrinter.ABChatBackground = nsForPrinter;
})();
