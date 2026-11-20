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
            { type: 'popup', url: chrome.runtime.getURL(CONSENT_PAGE_PATH_FOR_PRINTER), width: 560, height: 600, focused: true },
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

  // job: { html, title, fonts: [{ alias, family, userNamed }], templates: { needed, header, footer },
  // noPrompt }. Resolves to { ok: true, base64, warnings } or { ok: false, code, error }. code
  // 'declined' means the user chose the built-in writer; the caller's note says so in one sentence.
  // noPrompt is for a print the user did not ask for (view_file's preview of a Word file or a
  // deck): with no answer yet it returns 'no-consent' at once instead of opening the consent window.
  async function runPrintJobForPrinter(jobForPrint) {
    var modeForPrint = await getPrintModeForPrinter();
    if (modeForPrint === 'basic') return { ok: false, code: 'declined' };
    if (modeForPrint !== 'chrome' && jobForPrint && jobForPrint.noPrompt === true) {
      return { ok: false, code: 'no-consent', error: 'the user has not chosen yet whether Chrome may print PDFs' };
    }
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

  // ---- Loading an HTML page for a look ----
  //
  // view_file checks an HTML page made in this chat by loading it and drawing it. The page is the
  // model's own, scripts and all, so it never goes into print.html: that is an extension page, and
  // a script there would have the extension's privileges. It is written into a blank tab instead,
  // where it runs with an opaque origin and no access to the extension, as it does when the user
  // opens the file from their computer. The tab is drawn in a desktop window and a phone's, and
  // what the page reported while it loaded (uncaught errors, console errors, failed loads, dialogs)
  // comes back with the pictures. It shows the same debugger banner as printing, so it has the same
  // consent and runs in the same queue. It never asks: a look is no reason to ask the user anything.

  var SNAPSHOT_TABS_KEY_FOR_PRINTER = 'abchatPageCheckTabs';
  var SNAPSHOT_LOAD_WAIT_MS_FOR_PRINTER = 15000;
  var SNAPSHOT_SETTLE_MS_FOR_PRINTER = 1200;
  var SNAPSHOT_PHONE_SETTLE_MS_FOR_PRINTER = 500;
  var SNAPSHOT_STEP_TIMEOUT_MS_FOR_PRINTER = 15000;
  var SNAPSHOT_MAX_REPORTS_FOR_PRINTER = 50;

  // An opaque origin has no localStorage or sessionStorage, and reading either throws. A page
  // opened from the user's computer has both, so a page that saves its state would report an
  // error here that the user never sees. Where reading one throws, it is replaced with an
  // in-memory store before the page's own scripts run.
  var STORAGE_SHIM_FOR_PRINTER = '<script>(function(){function m(){var d={};return{getItem:function(k){k=String(k);'
    + 'return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},'
    + 'removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){var k=Object.keys(d);'
    + 'return i<k.length?k[i]:null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"]'
    + '.forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:m(),'
    + 'configurable:true})}catch(e2){}}})})();</script>';

  // The shim goes straight after the opening <head> tag, on the same line, so the line numbers in
  // the page's error reports stay those of the file. Before the doctype it would switch the page to
  // quirks mode.
  function withStorageShimForPrinter(htmlForShim) {
    var textForShim = String(htmlForShim || '');
    var tagForShim = /<head(\s[^>]*)?>/i.exec(textForShim) || /<html(\s[^>]*)?>/i.exec(textForShim) || /<!doctype[^>]*>/i.exec(textForShim);
    if (!tagForShim) return STORAGE_SHIM_FOR_PRINTER + textForShim;
    var atForShim = tagForShim.index + tagForShim[0].length;
    return textForShim.slice(0, atForShim) + STORAGE_SHIM_FOR_PRINTER + textForShim.slice(atForShim);
  }

  // One line for each thing the page reported, as the model reads it.
  function snapshotReportForPrinter(methodForReport, paramsForReport) {
    var params = paramsForReport || {};
    if (methodForReport === 'Runtime.exceptionThrown') {
      var details = params.exceptionDetails || {};
      var description = details.exception && details.exception.description ? String(details.exception.description).split('\n')[0] : '';
      var text = String(details.text || 'Uncaught');
      var message = description ? (/^Uncaught/.test(text) ? text.replace(/\s*$/, ' ') + description : description) : text;
      var url = String(details.url || '');
      var where = url && url !== 'about:blank'
        ? ' (' + url + ')'
        : (Number.isFinite(details.lineNumber) ? ' (line ' + (details.lineNumber + 1) + ' of the page)' : '');
      return message + where;
    }
    if (methodForReport === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      var args = (Array.isArray(params.args) ? params.args : []).map(function (argForReport) {
        if (!argForReport) return '';
        if (argForReport.value !== undefined) return String(argForReport.value);
        return String(argForReport.description || argForReport.type || '');
      }).join(' ');
      return 'console.' + params.type + ': ' + args;
    }
    if (methodForReport === 'Log.entryAdded' && params.entry && params.entry.level === 'error') {
      return String(params.entry.text || 'error') + (params.entry.url ? ' (' + params.entry.url + ')' : '');
    }
    if (methodForReport === 'Page.javascriptDialogOpening') {
      var typeForDialog = String(params.type || 'dialog');
      return 'The page opened ' + (/^[aeiou]/i.test(typeForDialog) ? 'an ' : 'a ') + typeForDialog + ' dialog'
        + (params.message ? ' saying "' + String(params.message) + '"' : '') + ', which was dismissed.';
    }
    return '';
  }

  function delayForPrinter(msForDelay) {
    return new Promise(function (resolveForDelay) { setTimeout(resolveForDelay, msForDelay); });
  }

  function rememberSnapshotTabForPrinter(tabIdForRemember, keepForRemember) {
    var sessionForRemember = chrome.storage && chrome.storage.session;
    if (!sessionForRemember) return Promise.resolve();
    return new Promise(function (resolveForRemember) {
      try {
        sessionForRemember.get(SNAPSHOT_TABS_KEY_FOR_PRINTER, function (itemsForRemember) {
          void chrome.runtime.lastError;
          var idsForRemember = (itemsForRemember && Array.isArray(itemsForRemember[SNAPSHOT_TABS_KEY_FOR_PRINTER])) ? itemsForRemember[SNAPSHOT_TABS_KEY_FOR_PRINTER] : [];
          idsForRemember = idsForRemember.filter(function (idForRemember) { return idForRemember !== tabIdForRemember; });
          if (keepForRemember) idsForRemember.push(tabIdForRemember);
          var patchForRemember = {};
          patchForRemember[SNAPSHOT_TABS_KEY_FOR_PRINTER] = idsForRemember;
          sessionForRemember.set(patchForRemember, function () { void chrome.runtime.lastError; resolveForRemember(); });
        });
      } catch (errForRemember) {
        resolveForRemember();
      }
    });
  }

  // job: { html, desktop: { width, height }, phone: { width, height }, pictures }. pictures false
  // loads the page for its reports alone. Resolves to { ok, desktop, phone (base64 JPEG, or ''),
  // pageHeight, phoneScrollWidth, loaded, reports } or { ok: false, code, error }.
  async function runSnapshotJobForPrinter(jobForSnapshot) {
    var modeForSnapshot = await getPrintModeForPrinter();
    if (modeForSnapshot === 'basic') return { ok: false, code: 'declined' };
    if (modeForSnapshot !== 'chrome') {
      return { ok: false, code: 'no-consent', error: 'the user has not chosen yet whether Chrome may print PDFs' };
    }
    var job = jobForSnapshot || {};
    var htmlForSnapshot = typeof job.html === 'string' ? job.html : '';
    if (!htmlForSnapshot) return { ok: false, code: 'failed', error: 'the page is empty' };
    if (htmlForSnapshot.length > MAX_HTML_CHARS_FOR_PRINTER) return { ok: false, code: 'failed', error: 'the page is too large to load' };
    var desktop = job.desktop || { width: 1280, height: 800 };
    var phone = job.phone || { width: 390, height: 844 };
    var withPictures = job.pictures !== false;

    var tabIdForSnapshot = null;
    var attachedForSnapshot = false;
    var detachReasonForSnapshot = '';
    var reportsForSnapshot = [];
    var targetForSnapshot = null;
    function onDetachForSnapshot(sourceForDetach, reasonForDetach) {
      if (sourceForDetach && sourceForDetach.tabId === tabIdForSnapshot) {
        attachedForSnapshot = false;
        detachReasonForSnapshot = reasonForDetach || 'detached';
      }
    }
    function onEventForSnapshot(sourceForEvent, methodForEvent, paramsForEvent) {
      if (!sourceForEvent || sourceForEvent.tabId !== tabIdForSnapshot) return;
      if (methodForEvent === 'Page.javascriptDialogOpening' && targetForSnapshot) {
        callForPrinter(targetForSnapshot, 'Page.handleJavaScriptDialog', { accept: false }).catch(noopForPrinter);
      }
      var lineForEvent = snapshotReportForPrinter(methodForEvent, paramsForEvent);
      if (lineForEvent && reportsForSnapshot.length < SNAPSHOT_MAX_REPORTS_FOR_PRINTER) reportsForSnapshot.push(lineForEvent);
    }
    chrome.debugger.onDetach.addListener(onDetachForSnapshot);
    chrome.debugger.onEvent.addListener(onEventForSnapshot);
    try {
      var tabForSnapshot = await chrome.tabs.create({ url: 'about:blank', active: false });
      tabIdForSnapshot = tabForSnapshot.id;
      await rememberSnapshotTabForPrinter(tabIdForSnapshot, true);
      targetForSnapshot = { tabId: tabIdForSnapshot };
      await new Promise(function (resolveForAttach, rejectForAttach) {
        chrome.debugger.attach(targetForSnapshot, CDP_VERSION_FOR_PRINTER, function () {
          if (chrome.runtime.lastError) { rejectForAttach(new Error(chrome.runtime.lastError.message || 'could not attach')); return; }
          resolveForAttach();
        });
      });
      attachedForSnapshot = true;
      var stepForSnapshot = function (methodForStep, paramsForStep, labelForStep) {
        return withTimeoutForPrinter(callForPrinter(targetForSnapshot, methodForStep, paramsForStep), SNAPSHOT_STEP_TIMEOUT_MS_FOR_PRINTER, labelForStep);
      };
      await stepForSnapshot('Page.enable', {}, 'opening the page');
      await stepForSnapshot('Runtime.enable', {}, 'opening the page');
      await stepForSnapshot('Log.enable', {}, 'opening the page');
      await stepForSnapshot('Emulation.setDeviceMetricsOverride', { width: desktop.width, height: desktop.height, deviceScaleFactor: 1, mobile: false }, 'sizing the window');
      var treeForSnapshot = await stepForSnapshot('Page.getFrameTree', {}, 'opening the page');
      await stepForSnapshot('Page.setDocumentContent', { frameId: treeForSnapshot.frameTree.frame.id, html: withStorageShimForPrinter(htmlForSnapshot) }, 'writing the page');
      // A load that never finishes (a library that does not arrive) is reported, and the page is
      // drawn as it stands.
      var loadedForSnapshot = await Promise.race([
        callForPrinter(targetForSnapshot, 'Runtime.evaluate', {
          expression: 'new Promise(function (r) { if (document.readyState === "complete") { r(); return; } addEventListener("load", function () { r(); }, { once: true }); })'
            + '.then(function () { return document.fonts ? document.fonts.ready : null; }).then(function () { return true; })',
          awaitPromise: true,
          returnByValue: true
        }).then(function () { return true; }),
        delayForPrinter(SNAPSHOT_LOAD_WAIT_MS_FOR_PRINTER).then(function () { return false; })
      ]);
      if (!loadedForSnapshot) reportsForSnapshot.push('The page had not finished loading after ' + Math.round(SNAPSHOT_LOAD_WAIT_MS_FOR_PRINTER / 1000) + ' seconds.');
      await delayForPrinter(SNAPSHOT_SETTLE_MS_FOR_PRINTER);
      var heightForSnapshot = await stepForSnapshot('Runtime.evaluate', {
        expression: 'Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0)',
        returnByValue: true
      }, 'measuring the page');
      var desktopShotForSnapshot = withPictures
        ? await stepForSnapshot('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, 'drawing the page')
        : null;
      await stepForSnapshot('Emulation.setDeviceMetricsOverride', { width: phone.width, height: phone.height, deviceScaleFactor: 2, mobile: true }, 'sizing the window');
      await delayForPrinter(SNAPSHOT_PHONE_SETTLE_MS_FOR_PRINTER);
      var phoneWidthForSnapshot = await stepForSnapshot('Runtime.evaluate', {
        expression: 'document.documentElement ? document.documentElement.scrollWidth : 0',
        returnByValue: true
      }, 'measuring the page');
      var phoneShotForSnapshot = withPictures
        ? await stepForSnapshot('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, 'drawing the page')
        : null;
      return {
        ok: true,
        desktop: desktopShotForSnapshot && desktopShotForSnapshot.data ? desktopShotForSnapshot.data : '',
        phone: phoneShotForSnapshot && phoneShotForSnapshot.data ? phoneShotForSnapshot.data : '',
        pageHeight: Number(heightForSnapshot && heightForSnapshot.result && heightForSnapshot.result.value) || 0,
        phoneScrollWidth: Number(phoneWidthForSnapshot && phoneWidthForSnapshot.result && phoneWidthForSnapshot.result.value) || 0,
        loaded: loadedForSnapshot,
        reports: reportsForSnapshot.slice()
      };
    } catch (errForSnapshot) {
      if (detachReasonForSnapshot === 'canceled_by_user') {
        return { ok: false, code: 'cancelled', error: 'the debugging banner was closed while the page was loading' };
      }
      return { ok: false, code: 'failed', error: errForSnapshot && errForSnapshot.message ? errForSnapshot.message : 'the page could not be loaded' };
    } finally {
      chrome.debugger.onEvent.removeListener(onEventForSnapshot);
      chrome.debugger.onDetach.removeListener(onDetachForSnapshot);
      if (attachedForSnapshot && targetForSnapshot) {
        await new Promise(function (resolveForDetach) {
          chrome.debugger.detach(targetForSnapshot, function () { void chrome.runtime.lastError; resolveForDetach(); });
        });
      }
      if (tabIdForSnapshot != null) {
        try { await chrome.tabs.remove(tabIdForSnapshot); } catch (errRemoveForSnapshot) { /* already closed */ }
        await rememberSnapshotTabForPrinter(tabIdForSnapshot, false);
      }
    }
  }

  // Same queue as printing, so at most one debugger tab is ever open.
  function snapshotHtmlForPrinter(jobForQueue) {
    var runForQueue = queueForPrinter.then(function () { return runSnapshotJobForPrinter(jobForQueue); });
    queueForPrinter = runForQueue.catch(noopForPrinter);
    return runForQueue;
  }

  // A worker that stopped mid-look leaves its blank tab open. The tab has no URL of its own to find
  // it by, so its id is kept in session storage while it is open.
  function closeStraySnapshotTabsForPrinter() {
    var sessionForStray = chrome.storage && chrome.storage.session;
    if (!sessionForStray) return;
    try {
      sessionForStray.get(SNAPSHOT_TABS_KEY_FOR_PRINTER, function (itemsForStray) {
        void chrome.runtime.lastError;
        var idsForStray = (itemsForStray && Array.isArray(itemsForStray[SNAPSHOT_TABS_KEY_FOR_PRINTER])) ? itemsForStray[SNAPSHOT_TABS_KEY_FOR_PRINTER] : [];
        idsForStray.forEach(function (idForStray) {
          chrome.tabs.remove(idForStray, function () { void chrome.runtime.lastError; });
        });
        if (idsForStray.length) {
          var clearForStray = {};
          clearForStray[SNAPSHOT_TABS_KEY_FOR_PRINTER] = [];
          sessionForStray.set(clearForStray, function () { void chrome.runtime.lastError; });
        }
      });
    } catch (errForStray) { /* ignore */ }
  }
  closeStraySnapshotTabsForPrinter();

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
    snapshotHtml: snapshotHtmlForPrinter,
    withStorageShim: withStorageShimForPrinter,
    snapshotReport: snapshotReportForPrinter,
    getPrintMode: getPrintModeForPrinter,
    checkHtml: checkHtmlForPrinter
  };

  globalScopeForPrinter.ABChatBackground = nsForPrinter;
})();
