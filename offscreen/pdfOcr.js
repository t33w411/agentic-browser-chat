// Transcribes the pages of a PDF that produced no extractable text.
//
// This runs in the offscreen document, not the service worker, for the same reason the agent
// loop does: transcription is a network-bound job that can run for minutes, and a service
// worker's idle timer is reset only by events and extension API calls, never by a pending
// fetch. A job hosted in the worker is killed mid-flight and its caller sees the message
// channel close. The offscreen document has no such timer.
//
// Two engines, chosen by what the document actually is:
//
//   whole-document  One OpenRouter call carrying the PDF itself, parsed by the file-parser
//                   plugin's mistral-ocr engine. Used when every page came back empty (a pure
//                   scan), where sending the whole file is both accurate and cheap. The parsed
//                   text is read from the response annotations, so the model is never asked to
//                   re-emit the document.
//   page-vision     Rasterize the empty pages and transcribe each one with a vision model.
//                   Used for a document that is mostly text with a few image-only pages, where
//                   the whole-document engine would bill every page to fix a handful, and as
//                   the fallback whenever the whole-document engine returns nothing usable.
(function () {
  var globalScopeForPdfOcr = globalThis;
  var nsForPdfOcr = globalScopeForPdfOcr.ABChatOffscreen || {};

  var PDF_OCR_ENDPOINT_FOR_PDF_OCR = 'https://openrouter.ai/api/v1/chat/completions';
  // The whole-document engine's model never sees a question; it exists only because the
  // file-parser plugin runs as part of a completion. Keep it the cheapest thing that can
  // accept the parsed text, since that text is billed as its input.
  var PDF_OCR_DOC_MODEL_FOR_PDF_OCR = 'openai/gpt-4.1-nano';
  var PDF_OCR_PAGE_MODEL_FOR_PDF_OCR = 'openai/gpt-4.1-mini';
  // A page holding fewer non-space characters than this is treated as having no text layer.
  var PDF_OCR_MIN_PAGE_CHARS_FOR_PDF_OCR = 48;
  var PDF_OCR_MAX_PAGES_FOR_PDF_OCR = 20;
  var PDF_OCR_CONCURRENCY_FOR_PDF_OCR = 3;
  var PDF_OCR_RASTER_MAX_EDGE_FOR_PDF_OCR = 1400;
  // Guards on the whole-document engine: past these the request itself becomes the problem.
  var PDF_OCR_DOC_MAX_BYTES_FOR_PDF_OCR = 40 * 1024 * 1024;
  var PDF_OCR_DOC_MAX_PAGES_FOR_PDF_OCR = 400;
  var PDF_OCR_REQUEST_TIMEOUT_MS_FOR_PDF_OCR = 180000;
  var PDF_OCR_JOB_BUDGET_MS_FOR_PDF_OCR = 900000;

  var PDF_OCR_PAGE_PROMPT_FOR_PDF_OCR = 'This is a single page from a scanned PDF. Transcribe all of its text verbatim, '
    + 'preserving reading order, headings, lists and table structure. Output only the transcription, with no commentary. '
    + 'If the page contains no readable text, reply with exactly: [no readable text]';
  // The whole-document engine's reply is discarded; only the plugin's parse is kept.
  var PDF_OCR_DOC_PROMPT_FOR_PDF_OCR = 'Reply with the single word OK.';

  var PDF_OCR_PAGE_NOTICE_FOR_PDF_OCR = '[Scanned page: the text below was transcribed from an image of this page by a vision model. '
    + 'It may contain transcription errors.]';
  var PDF_OCR_DOC_NOTICE_FOR_PDF_OCR = '[Scanned document: this file has no text layer, so the text below was produced by running OCR '
    + 'over the page images. Layout is approximate and it may contain transcription errors.]';

  var activeJobsForPdfOcr = new Map();

  function getApiLoggerForPdfOcr() {
    return (globalScopeForPdfOcr.ABChatContent || {}).apiLogger || null;
  }

  function writeOcrLogForPdfOcr(entryForPdfOcr) {
    try {
      var loggerForPdfOcr = getApiLoggerForPdfOcr();
      if (!loggerForPdfOcr || typeof loggerForPdfOcr.writeLog !== 'function') return;
      loggerForPdfOcr.writeLog({
        requestType: entryForPdfOcr.requestType,
        timestamp: new Date(entryForPdfOcr.startTime).toISOString(),
        model: entryForPdfOcr.model || '',
        iterationCount: 1,
        totalLatencyMs: Date.now() - entryForPdfOcr.startTime,
        status: entryForPdfOcr.status || 'success',
        errorMessage: entryForPdfOcr.errorMessage || '',
        requestMessages: entryForPdfOcr.requestMessages || [],
        apiParams: entryForPdfOcr.apiParams || null,
        responseContent: entryForPdfOcr.responseContent || '',
        usage: entryForPdfOcr.usage || null
      }).catch(function () {});
    } catch (errForPdfOcr) { /* logging must never break the call */ }
  }

  function recordJobProgressForPdfOcr(jobForPdfOcr, progressForPdfOcr) {
    var diagnosticsForPdfOcr = jobForPdfOcr.diagnostics;
    if (!diagnosticsForPdfOcr) return;
    var nowForPdfOcr = Date.now();
    var stageForPdfOcr = String(progressForPdfOcr && progressForPdfOcr.stage || '');
    if (stageForPdfOcr && diagnosticsForPdfOcr.currentStage !== stageForPdfOcr) {
      if (diagnosticsForPdfOcr.currentStage && diagnosticsForPdfOcr.stageStartedAt) {
        diagnosticsForPdfOcr.stageTimingsMs[diagnosticsForPdfOcr.currentStage] =
          (diagnosticsForPdfOcr.stageTimingsMs[diagnosticsForPdfOcr.currentStage] || 0)
          + (nowForPdfOcr - diagnosticsForPdfOcr.stageStartedAt);
      }
      diagnosticsForPdfOcr.currentStage = stageForPdfOcr;
      diagnosticsForPdfOcr.stageStartedAt = nowForPdfOcr;
    }
    diagnosticsForPdfOcr.stageDone = Number(progressForPdfOcr && progressForPdfOcr.done || 0);
    diagnosticsForPdfOcr.stageTotal = Number(progressForPdfOcr && progressForPdfOcr.total || 0);
    if (stageForPdfOcr === 'render') diagnosticsForPdfOcr.renderedCount = diagnosticsForPdfOcr.stageDone;
    if (stageForPdfOcr === 'transcribe') diagnosticsForPdfOcr.transcribedAttemptCount = diagnosticsForPdfOcr.stageDone;
  }

  function finishJobStageTimingForPdfOcr(jobForPdfOcr) {
    var diagnosticsForPdfOcr = jobForPdfOcr.diagnostics;
    if (!diagnosticsForPdfOcr || !diagnosticsForPdfOcr.currentStage || !diagnosticsForPdfOcr.stageStartedAt) return;
    diagnosticsForPdfOcr.stageTimingsMs[diagnosticsForPdfOcr.currentStage] =
      (diagnosticsForPdfOcr.stageTimingsMs[diagnosticsForPdfOcr.currentStage] || 0)
      + (Date.now() - diagnosticsForPdfOcr.stageStartedAt);
    diagnosticsForPdfOcr.stageStartedAt = 0;
  }

  function getJobCompletionReasonForPdfOcr(jobForPdfOcr, resultForPdfOcr, errorForPdfOcr) {
    if (jobForPdfOcr.cancelled) return 'cancelled';
    if (jobForPdfOcr.timedOut) return 'timed_out';
    if (errorForPdfOcr || (resultForPdfOcr && resultForPdfOcr.error)) return 'error';
    var targetCountForPdfOcr = Number(resultForPdfOcr && resultForPdfOcr.targetCount || 0);
    var transcribedCountForPdfOcr = Number(resultForPdfOcr && resultForPdfOcr.transcribedCount || 0);
    var blankCountForPdfOcr = Array.isArray(resultForPdfOcr && resultForPdfOcr.blankPages)
      ? resultForPdfOcr.blankPages.length
      : 0;
    var renderErrorsForPdfOcr = Array.isArray(resultForPdfOcr && resultForPdfOcr.renderErrors)
      ? resultForPdfOcr.renderErrors
      : [];
    if (renderErrorsForPdfOcr.length || transcribedCountForPdfOcr + blankCountForPdfOcr < targetCountForPdfOcr) {
      return transcribedCountForPdfOcr > 0 ? 'partial' : 'failed';
    }
    return 'success';
  }

  function writeJobLogForPdfOcr(jobForPdfOcr, resultForPdfOcr, errorForPdfOcr) {
    finishJobStageTimingForPdfOcr(jobForPdfOcr);
    var diagnosticsForPdfOcr = jobForPdfOcr.diagnostics || {};
    var resultForJobLog = resultForPdfOcr || {};
    var reasonForJobLog = getJobCompletionReasonForPdfOcr(jobForPdfOcr, resultForJobLog, errorForPdfOcr);
    var resultRenderErrorsForJobLog = Array.isArray(resultForJobLog.renderErrors)
      ? resultForJobLog.renderErrors
      : [];
    var diagnosticRenderErrorsForJobLog = Array.isArray(diagnosticsForPdfOcr.renderErrors)
      ? diagnosticsForPdfOcr.renderErrors
      : [];
    var renderErrorsForJobLog = resultRenderErrorsForJobLog.length
      ? resultRenderErrorsForJobLog
      : diagnosticRenderErrorsForJobLog;
    var errorMessageForJobLog = '';
    if (errorForPdfOcr) {
      errorMessageForJobLog = (errorForPdfOcr && errorForPdfOcr.message) || 'PDF OCR failed.';
    } else if (resultForJobLog.error) {
      errorMessageForJobLog = String(resultForJobLog.error);
    } else if (reasonForJobLog === 'timed_out') {
      errorMessageForJobLog = 'The PDF OCR job exceeded its 15-minute limit.';
    } else if (renderErrorsForJobLog.length) {
      errorMessageForJobLog = String(renderErrorsForJobLog[0].error || 'PDF page rendering failed.');
    } else if (reasonForJobLog === 'failed' || reasonForJobLog === 'partial') {
      errorMessageForJobLog = 'Not every scanned page could be transcribed.';
    }
    var engineForJobLog = String(resultForJobLog.engine || diagnosticsForPdfOcr.engine || '');
    var modelForJobLog = engineForJobLog === 'mistral-ocr'
      ? PDF_OCR_DOC_MODEL_FOR_PDF_OCR
      : (engineForJobLog === 'page-vision' ? PDF_OCR_PAGE_MODEL_FOR_PDF_OCR : '');
    var targetCountForJobLog = Number(resultForJobLog.targetCount || diagnosticsForPdfOcr.targetCount || 0);
    var transcribedCountForJobLog = Number(resultForJobLog.transcribedCount || 0);
    writeOcrLogForPdfOcr({
      requestType: 'pdf-ocr-job',
      startTime: jobForPdfOcr.startTime,
      model: modelForJobLog,
      status: reasonForJobLog === 'success' ? 'success'
        : (reasonForJobLog === 'cancelled' ? 'cancelled' : 'error'),
      errorMessage: errorMessageForJobLog,
      requestMessages: [],
      apiParams: {
        jobId: jobForPdfOcr.jobId,
        fileName: jobForPdfOcr.fileName,
        engine: engineForJobLog,
        completionReason: reasonForJobLog,
        pageCount: Array.isArray(jobForPdfOcr.pages) ? jobForPdfOcr.pages.length : 0,
        targetPageCount: targetCountForJobLog,
        renderedPageCount: Number(diagnosticsForPdfOcr.renderedCount || 0),
        transcriptionAttemptCount: Number(diagnosticsForPdfOcr.transcribedAttemptCount || 0),
        successfulTranscriptionCount: Number(diagnosticsForPdfOcr.successfulTranscriptionCount || 0),
        transcribedPageCount: transcribedCountForJobLog,
        currentStage: String(diagnosticsForPdfOcr.currentStage || ''),
        stageDone: Number(diagnosticsForPdfOcr.stageDone || 0),
        stageTotal: Number(diagnosticsForPdfOcr.stageTotal || 0),
        stageTimingsMs: diagnosticsForPdfOcr.stageTimingsMs || {},
        renderErrors: renderErrorsForJobLog
      },
      responseContent: 'OCR ' + reasonForJobLog + ': transcribed '
        + transcribedCountForJobLog + ' of ' + targetCountForJobLog + ' scanned page(s).'
    });
  }

  function base64ToUint8ArrayForPdfOcr(base64ForPdfOcr) {
    var binaryForPdfOcr = atob(String(base64ForPdfOcr || ''));
    var bytesForPdfOcr = new Uint8Array(binaryForPdfOcr.length);
    for (var iForPdfOcr = 0; iForPdfOcr < binaryForPdfOcr.length; iForPdfOcr++) {
      bytesForPdfOcr[iForPdfOcr] = binaryForPdfOcr.charCodeAt(iForPdfOcr);
    }
    return bytesForPdfOcr;
  }

  function delayForPdfOcr(msForPdfOcr, signalForPdfOcr) {
    return new Promise(function (resolveForPdfOcr) {
      var timerForPdfOcr = setTimeout(function () {
        if (signalForPdfOcr) signalForPdfOcr.removeEventListener('abort', onAbortForPdfOcr);
        resolveForPdfOcr();
      }, msForPdfOcr);
      function onAbortForPdfOcr() {
        clearTimeout(timerForPdfOcr);
        resolveForPdfOcr();
      }
      if (signalForPdfOcr) signalForPdfOcr.addEventListener('abort', onAbortForPdfOcr, { once: true });
    });
  }

  // A request that never answers is indistinguishable from one that is merely slow, and the
  // whole job is waiting on it, so every call gets its own deadline on top of the job signal.
  function fetchWithTimeoutForPdfOcr(urlForPdfOcr, initForPdfOcr, signalForPdfOcr, timeoutMsForPdfOcr) {
    var controllerForPdfOcr = new AbortController();
    var timedOutForPdfOcr = false;
    var timerForPdfOcr = setTimeout(function () {
      timedOutForPdfOcr = true;
      controllerForPdfOcr.abort();
    }, timeoutMsForPdfOcr);
    function onOuterAbortForPdfOcr() { controllerForPdfOcr.abort(); }
    if (signalForPdfOcr) {
      if (signalForPdfOcr.aborted) controllerForPdfOcr.abort();
      else signalForPdfOcr.addEventListener('abort', onOuterAbortForPdfOcr, { once: true });
    }
    var requestInitForPdfOcr = Object.assign({}, initForPdfOcr, { signal: controllerForPdfOcr.signal });
    return fetch(urlForPdfOcr, requestInitForPdfOcr).then(function (responseForPdfOcr) {
      return responseForPdfOcr;
    }, function (errForPdfOcr) {
      if (timedOutForPdfOcr) throw new Error('The transcription request timed out.');
      throw errForPdfOcr;
    }).finally(function () {
      clearTimeout(timerForPdfOcr);
      if (signalForPdfOcr) signalForPdfOcr.removeEventListener('abort', onOuterAbortForPdfOcr);
    });
  }

  function buildAuthHeadersForPdfOcr(apiKeyForPdfOcr) {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKeyForPdfOcr,
      'HTTP-Referer': 'chrome-extension://agentic-browser-chat',
      'X-Title': 'Agentic Browser Chat'
    };
  }

  /* ============================================================
     Engine 1: whole document via the file-parser plugin
  ============================================================ */

  // The plugin returns what it parsed as annotations on the assistant message, so the parsed
  // text is available without asking the model to repeat it. Returns
  // { pageTexts: string[] | null, blobText: string, usage } or null when nothing usable came back.
  function extractAnnotationTextForPdfOcr(jsonForPdfOcr) {
    var messageForPdfOcr = jsonForPdfOcr
      && jsonForPdfOcr.choices
      && jsonForPdfOcr.choices[0]
      && jsonForPdfOcr.choices[0].message;
    var annotationsForPdfOcr = (messageForPdfOcr && messageForPdfOcr.annotations)
      || (jsonForPdfOcr && jsonForPdfOcr.error && jsonForPdfOcr.error.metadata
        && jsonForPdfOcr.error.metadata.file_annotations);
    if (!Array.isArray(annotationsForPdfOcr) || !annotationsForPdfOcr.length) return null;

    var partsForPdfOcr = [];
    for (var iForPdfOcr = 0; iForPdfOcr < annotationsForPdfOcr.length; iForPdfOcr++) {
      var annotationForPdfOcr = annotationsForPdfOcr[iForPdfOcr];
      var contentForPdfOcr = annotationForPdfOcr
        && annotationForPdfOcr.file
        && annotationForPdfOcr.file.content;
      if (!Array.isArray(contentForPdfOcr)) continue;
      for (var jForPdfOcr = 0; jForPdfOcr < contentForPdfOcr.length; jForPdfOcr++) {
        var partForPdfOcr = contentForPdfOcr[jForPdfOcr];
        // Image parts are dropped: this path exists to recover text, and the extracted images
        // are the page scans we already chose not to keep.
        if (!partForPdfOcr || partForPdfOcr.type !== 'text') continue;
        var textForPdfOcr = String(partForPdfOcr.text || '');
        if (textForPdfOcr.trim()) partsForPdfOcr.push(textForPdfOcr);
      }
    }
    if (!partsForPdfOcr.length) return null;
    return partsForPdfOcr;
  }

  async function transcribeWholeDocumentForPdfOcr(optionsForPdfOcr) {
    var startTimeForPdfOcr = Date.now();
    var apiParamsForPdfOcr = {
      stream: false,
      model: PDF_OCR_DOC_MODEL_FOR_PDF_OCR,
      models: null,
      route: null,
      plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]
    };
    // The encoded PDF is never stored in the log: it is megabytes of base64 that the viewer
    // would placeholder anyway, and the log store is capped by record count.
    var logMessagesForPdfOcr = [{
      role: 'user',
      content: [
        { type: 'text', text: PDF_OCR_DOC_PROMPT_FOR_PDF_OCR },
        { type: 'file', file: { filename: optionsForPdfOcr.fileName || 'document.pdf', file_data: '[pdf data omitted from log]' } }
      ]
    }];

    try {
      var responseForPdfOcr = await fetchWithTimeoutForPdfOcr(
        PDF_OCR_ENDPOINT_FOR_PDF_OCR,
        {
          method: 'POST',
          headers: buildAuthHeadersForPdfOcr(optionsForPdfOcr.apiKey),
          body: JSON.stringify({
            model: PDF_OCR_DOC_MODEL_FOR_PDF_OCR,
            stream: false,
            max_tokens: 16,
            plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: PDF_OCR_DOC_PROMPT_FOR_PDF_OCR },
                {
                  type: 'file',
                  file: {
                    filename: optionsForPdfOcr.fileName || 'document.pdf',
                    file_data: 'data:application/pdf;base64,' + optionsForPdfOcr.base64
                  }
                }
              ]
            }]
          })
        },
        optionsForPdfOcr.signal,
        PDF_OCR_REQUEST_TIMEOUT_MS_FOR_PDF_OCR
      );

      var jsonForPdfOcr = null;
      try {
        jsonForPdfOcr = await responseForPdfOcr.json();
      } catch (parseErrForPdfOcr) {
        jsonForPdfOcr = null;
      }
      var partsForPdfOcr = extractAnnotationTextForPdfOcr(jsonForPdfOcr);

      if (!responseForPdfOcr.ok && !partsForPdfOcr) {
        var apiMessageForPdfOcr = (jsonForPdfOcr && jsonForPdfOcr.error && jsonForPdfOcr.error.message)
          ? jsonForPdfOcr.error.message
          : ('HTTP ' + responseForPdfOcr.status);
        writeOcrLogForPdfOcr({
          requestType: 'pdf-document-ocr',
          startTime: startTimeForPdfOcr,
          model: PDF_OCR_DOC_MODEL_FOR_PDF_OCR,
          status: 'error',
          errorMessage: apiMessageForPdfOcr,
          requestMessages: logMessagesForPdfOcr,
          apiParams: apiParamsForPdfOcr,
          responseContent: ''
        });
        return null;
      }

      var totalCharsForPdfOcr = 0;
      if (partsForPdfOcr) {
        for (var iForPdfOcr = 0; iForPdfOcr < partsForPdfOcr.length; iForPdfOcr++) {
          totalCharsForPdfOcr += partsForPdfOcr[iForPdfOcr].length;
        }
      }
      writeOcrLogForPdfOcr({
        requestType: 'pdf-document-ocr',
        startTime: startTimeForPdfOcr,
        model: (jsonForPdfOcr && jsonForPdfOcr.model) || PDF_OCR_DOC_MODEL_FOR_PDF_OCR,
        status: partsForPdfOcr ? 'success' : 'error',
        errorMessage: partsForPdfOcr ? '' : 'The OCR engine returned no parsed text.',
        requestMessages: logMessagesForPdfOcr,
        apiParams: apiParamsForPdfOcr,
        responseContent: partsForPdfOcr
          ? ('[parsed ' + partsForPdfOcr.length + ' text section(s), ' + totalCharsForPdfOcr + ' chars]')
          : '',
        usage: (jsonForPdfOcr && jsonForPdfOcr.usage) || null
      });
      return partsForPdfOcr;
    } catch (errForPdfOcr) {
      var abortedForPdfOcr = Boolean(optionsForPdfOcr.signal && optionsForPdfOcr.signal.aborted);
      writeOcrLogForPdfOcr({
        requestType: 'pdf-document-ocr',
        startTime: startTimeForPdfOcr,
        model: PDF_OCR_DOC_MODEL_FOR_PDF_OCR,
        status: abortedForPdfOcr ? 'cancelled' : 'error',
        errorMessage: abortedForPdfOcr ? '' : ((errForPdfOcr && errForPdfOcr.message) || 'Document OCR failed.'),
        requestMessages: logMessagesForPdfOcr,
        apiParams: apiParamsForPdfOcr,
        responseContent: ''
      });
      return null;
    }
  }

  /* ============================================================
     Engine 2: page images through a vision model
  ============================================================ */

  async function transcribePageImageForPdfOcr(dataUrlForPdfOcr, apiKeyForPdfOcr, signalForPdfOcr) {
    var startTimeForPdfOcr = Date.now();
    var apiParamsForPdfOcr = { stream: false, model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR, models: null, route: null };
    var logMessagesForPdfOcr = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: '[image data omitted from log]' } },
        { type: 'text', text: PDF_OCR_PAGE_PROMPT_FOR_PDF_OCR }
      ]
    }];

    var MAX_RETRIES_FOR_PDF_OCR = 2;
    var RETRY_DELAYS_FOR_PDF_OCR = [1500, 3000];
    var RETRYABLE_FOR_PDF_OCR = [429, 502, 503, 504];
    var responseForPdfOcr = null;
    var lastErrorForPdfOcr = null;

    for (var retryForPdfOcr = 0; retryForPdfOcr <= MAX_RETRIES_FOR_PDF_OCR; retryForPdfOcr++) {
      if (signalForPdfOcr && signalForPdfOcr.aborted) {
        writeOcrLogForPdfOcr({
          requestType: 'pdf-page-ocr',
          startTime: startTimeForPdfOcr,
          model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
          status: 'cancelled',
          requestMessages: logMessagesForPdfOcr,
          apiParams: apiParamsForPdfOcr,
          responseContent: ''
        });
        return '';
      }
      if (retryForPdfOcr > 0) await delayForPdfOcr(RETRY_DELAYS_FOR_PDF_OCR[retryForPdfOcr - 1], signalForPdfOcr);
      lastErrorForPdfOcr = null;
      try {
        responseForPdfOcr = await fetchWithTimeoutForPdfOcr(
          PDF_OCR_ENDPOINT_FOR_PDF_OCR,
          {
            method: 'POST',
            headers: buildAuthHeadersForPdfOcr(apiKeyForPdfOcr),
            body: JSON.stringify({
              model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
              stream: false,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: dataUrlForPdfOcr } },
                  { type: 'text', text: PDF_OCR_PAGE_PROMPT_FOR_PDF_OCR }
                ]
              }]
            })
          },
          signalForPdfOcr,
          PDF_OCR_REQUEST_TIMEOUT_MS_FOR_PDF_OCR
        );
        if (!responseForPdfOcr.ok
          && RETRYABLE_FOR_PDF_OCR.indexOf(responseForPdfOcr.status) !== -1
          && retryForPdfOcr < MAX_RETRIES_FOR_PDF_OCR) {
          lastErrorForPdfOcr = new Error('HTTP ' + responseForPdfOcr.status);
          responseForPdfOcr = null;
          continue;
        }
        break;
      } catch (fetchErrorForPdfOcr) {
        // An abort surfaces here as a fetch rejection; report it as cancelled, not as a failure.
        if (signalForPdfOcr && signalForPdfOcr.aborted) {
          writeOcrLogForPdfOcr({
            requestType: 'pdf-page-ocr',
            startTime: startTimeForPdfOcr,
            model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
            status: 'cancelled',
            requestMessages: logMessagesForPdfOcr,
            apiParams: apiParamsForPdfOcr,
            responseContent: ''
          });
          return '';
        }
        lastErrorForPdfOcr = fetchErrorForPdfOcr;
        responseForPdfOcr = null;
        if (retryForPdfOcr >= MAX_RETRIES_FOR_PDF_OCR) break;
      }
    }

    if (!responseForPdfOcr) {
      writeOcrLogForPdfOcr({
        requestType: 'pdf-page-ocr',
        startTime: startTimeForPdfOcr,
        model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
        status: 'error',
        errorMessage: (lastErrorForPdfOcr && lastErrorForPdfOcr.message) || 'Page transcription failed.',
        requestMessages: logMessagesForPdfOcr,
        apiParams: apiParamsForPdfOcr,
        responseContent: ''
      });
      return '';
    }

    var jsonForPdfOcr = null;
    try {
      jsonForPdfOcr = await responseForPdfOcr.json();
    } catch (parseErrForPdfOcr) {
      jsonForPdfOcr = null;
    }
    if (!responseForPdfOcr.ok || !jsonForPdfOcr) {
      writeOcrLogForPdfOcr({
        requestType: 'pdf-page-ocr',
        startTime: startTimeForPdfOcr,
        model: PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
        status: 'error',
        errorMessage: (jsonForPdfOcr && jsonForPdfOcr.error && jsonForPdfOcr.error.message)
          ? jsonForPdfOcr.error.message
          : ('HTTP ' + responseForPdfOcr.status),
        requestMessages: logMessagesForPdfOcr,
        apiParams: apiParamsForPdfOcr,
        responseContent: ''
      });
      return '';
    }

    var contentForPdfOcr = jsonForPdfOcr.choices
      && jsonForPdfOcr.choices[0]
      && jsonForPdfOcr.choices[0].message
      && jsonForPdfOcr.choices[0].message.content
      ? String(jsonForPdfOcr.choices[0].message.content).trim()
      : '';
    writeOcrLogForPdfOcr({
      requestType: 'pdf-page-ocr',
      startTime: startTimeForPdfOcr,
      model: (jsonForPdfOcr && jsonForPdfOcr.model) || PDF_OCR_PAGE_MODEL_FOR_PDF_OCR,
      status: 'success',
      requestMessages: logMessagesForPdfOcr,
      apiParams: apiParamsForPdfOcr,
      responseContent: contentForPdfOcr,
      usage: jsonForPdfOcr.usage || null
    });
    if (!contentForPdfOcr || /^\[no readable text\]$/i.test(contentForPdfOcr)) return '';
    return contentForPdfOcr;
  }

  async function transcribePagesWithVisionForPdfOcr(optionsForPdfOcr) {
    var targetPagesForPdfOcr = optionsForPdfOcr.emptyPages.slice(0, PDF_OCR_MAX_PAGES_FOR_PDF_OCR);
    if (!targetPagesForPdfOcr.length) return { transcripts: {}, blankPages: [], renderErrors: [] };

    var transcriptsForPdfOcr = {};
    var blankPagesForPdfOcr = [];
    var renderErrorsForPdfOcr = [];
    var pendingImagesForPdfOcr = [];
    var waitingWorkersForPdfOcr = [];
    var queueClosedForPdfOcr = false;
    var renderFinishedForPdfOcr = false;
    var transcribableCountForPdfOcr = 0;
    var completedForPdfOcr = 0;
    var workerErrorsForPdfOcr = [];

    function enqueueImageForPdfOcr(imageForPdfOcr) {
      if (queueClosedForPdfOcr) return;
      if (waitingWorkersForPdfOcr.length) {
        waitingWorkersForPdfOcr.shift()(imageForPdfOcr);
        return;
      }
      pendingImagesForPdfOcr.push(imageForPdfOcr);
    }

    function dequeueImageForPdfOcr() {
      if (pendingImagesForPdfOcr.length) {
        return Promise.resolve(pendingImagesForPdfOcr.shift());
      }
      if (queueClosedForPdfOcr) return Promise.resolve(null);
      return new Promise(function (resolveForPdfOcr) {
        waitingWorkersForPdfOcr.push(resolveForPdfOcr);
      });
    }

    function closeImageQueueForPdfOcr() {
      queueClosedForPdfOcr = true;
      while (waitingWorkersForPdfOcr.length) {
        waitingWorkersForPdfOcr.shift()(null);
      }
    }

    async function runWorkerForPdfOcr() {
      while (true) {
        var imageForPdfOcr = await dequeueImageForPdfOcr();
        if (!imageForPdfOcr) return;
        if (optionsForPdfOcr.signal && optionsForPdfOcr.signal.aborted) return;

        var pageNumberForPdfOcr = Number(imageForPdfOcr.page);
        var transcriptForPdfOcr = '';
        try {
          transcriptForPdfOcr = await transcribePageImageForPdfOcr(
            imageForPdfOcr.dataUrl,
            optionsForPdfOcr.apiKey,
            optionsForPdfOcr.signal
          );
        } catch (workerErrorForPdfOcr) {
          if (!(optionsForPdfOcr.signal && optionsForPdfOcr.signal.aborted)) {
            workerErrorsForPdfOcr.push(workerErrorForPdfOcr);
          }
        }
        if (transcriptForPdfOcr) transcriptsForPdfOcr[pageNumberForPdfOcr] = transcriptForPdfOcr;
        if (typeof optionsForPdfOcr.onTranscript === 'function') {
          optionsForPdfOcr.onTranscript(pageNumberForPdfOcr, Boolean(transcriptForPdfOcr));
        }
        completedForPdfOcr += 1;
        if (renderFinishedForPdfOcr) {
          optionsForPdfOcr.onProgress({
            stage: 'transcribe',
            done: completedForPdfOcr,
            total: transcribableCountForPdfOcr
          });
        }
      }
    }

    // Workers wait for the sequential rasterizer to produce pages. Each usable page enters
    // vision immediately, so rendering later pages overlaps up to three network requests.
    var workerCountForPdfOcr = Math.min(PDF_OCR_CONCURRENCY_FOR_PDF_OCR, targetPagesForPdfOcr.length);
    var workersForPdfOcr = [];
    for (var wForPdfOcr = 0; wForPdfOcr < workerCountForPdfOcr; wForPdfOcr++) {
      workersForPdfOcr.push(runWorkerForPdfOcr());
    }

    optionsForPdfOcr.onProgress({ stage: 'render', done: 0, total: targetPagesForPdfOcr.length });
    try {
      await nsForPdfOcr.pdfRaster.rasterizePages(
        optionsForPdfOcr.bytes,
        targetPagesForPdfOcr,
        {
          maxEdge: PDF_OCR_RASTER_MAX_EDGE_FOR_PDF_OCR,
          signal: optionsForPdfOcr.signal,
          onPage: function (doneForPdfOcr, totalForPdfOcr) {
            optionsForPdfOcr.onProgress({ stage: 'render', done: doneForPdfOcr, total: totalForPdfOcr });
          },
          onPageResult: function (imageForPdfOcr) {
            var pageNumberForPdfOcr = Number(imageForPdfOcr && imageForPdfOcr.page);
            if (imageForPdfOcr && imageForPdfOcr.blank) {
              blankPagesForPdfOcr.push(pageNumberForPdfOcr);
            }
            if (imageForPdfOcr && imageForPdfOcr.error) {
              renderErrorsForPdfOcr.push({
                page: pageNumberForPdfOcr || 0,
                error: String(imageForPdfOcr.error)
              });
            }
            if (imageForPdfOcr && imageForPdfOcr.dataUrl && !imageForPdfOcr.blank) {
              transcribableCountForPdfOcr += 1;
              enqueueImageForPdfOcr(imageForPdfOcr);
            }
            if (typeof optionsForPdfOcr.onPageResult === 'function') {
              optionsForPdfOcr.onPageResult(imageForPdfOcr);
            }
          }
        }
      );
    } catch (rasterErrForPdfOcr) {
      renderFinishedForPdfOcr = true;
      closeImageQueueForPdfOcr();
      await Promise.all(workersForPdfOcr);
      var rasterErrorMessageForPdfOcr = (rasterErrForPdfOcr && rasterErrForPdfOcr.message) || 'Page rendering failed.';
      return {
        transcripts: {},
        blankPages: [],
        renderErrors: [{ page: 0, error: rasterErrorMessageForPdfOcr }],
        error: rasterErrorMessageForPdfOcr
      };
    }

    renderFinishedForPdfOcr = true;
    closeImageQueueForPdfOcr();
    optionsForPdfOcr.onProgress({
      stage: 'transcribe',
      done: completedForPdfOcr,
      total: transcribableCountForPdfOcr
    });
    await Promise.all(workersForPdfOcr);
    if (workerErrorsForPdfOcr.length) throw workerErrorsForPdfOcr[0];

    return {
      transcripts: transcriptsForPdfOcr,
      blankPages: blankPagesForPdfOcr,
      renderErrors: renderErrorsForPdfOcr
    };
  }

  /* ============================================================
     Job runner
  ============================================================ */

  function emitJobEventForPdfOcr(jobForPdfOcr, eventForPdfOcr, payloadForPdfOcr) {
    try {
      chrome.runtime.sendMessage({
        action: 'pdfOcrJobEvent',
        jobId: jobForPdfOcr.jobId,
        tabId: jobForPdfOcr.tabId,
        // Carried through untouched. Nothing here reads it; it exists so the worker that
        // finishes the job does not have to have survived the job to still know it.
        contentHash: jobForPdfOcr.contentHash,
        event: eventForPdfOcr,
        payload: payloadForPdfOcr || null
      }, function () { void chrome.runtime.lastError; });
    } catch (errForPdfOcr) { /* best effort */ }
  }

  async function runJobForPdfOcr(jobForPdfOcr) {
    var pagesForPdfOcr = Array.isArray(jobForPdfOcr.pages) ? jobForPdfOcr.pages : [];
    var emptyPagesForPdfOcr = pagesForPdfOcr
      .filter(function (pageForPdfOcr) {
        return String(pageForPdfOcr.text || '').replace(/\s/g, '').length < PDF_OCR_MIN_PAGE_CHARS_FOR_PDF_OCR;
      })
      .map(function (pageForPdfOcr) { return Number(pageForPdfOcr.page); });

    var resultForPdfOcr = {
      pages: pagesForPdfOcr,
      wholeDocumentText: '',
      notice: '',
      engine: '',
      blankPages: [],
      renderErrors: [],
      transcribedCount: 0,
      targetCount: emptyPagesForPdfOcr.length
    };
    if (jobForPdfOcr.diagnostics) jobForPdfOcr.diagnostics.targetCount = emptyPagesForPdfOcr.length;

    if (!emptyPagesForPdfOcr.length) return resultForPdfOcr;

    var bytesForPdfOcr = base64ToUint8ArrayForPdfOcr(jobForPdfOcr.pdfBase64);
    function onProgressForPdfOcr(progressForPdfOcr) {
      recordJobProgressForPdfOcr(jobForPdfOcr, progressForPdfOcr);
      emitJobEventForPdfOcr(jobForPdfOcr, 'progress', progressForPdfOcr);
    }

    // A document where every page is empty is a scan end to end, which is the case the
    // whole-document engine is both cheapest and most accurate for. A document with a few
    // empty pages is a text PDF with some images in it: sending the whole file there would
    // bill every page and discard the layout-aware text we already extracted for the rest.
    var isWholeScanForPdfOcr = emptyPagesForPdfOcr.length === pagesForPdfOcr.length
      && pagesForPdfOcr.length <= PDF_OCR_DOC_MAX_PAGES_FOR_PDF_OCR
      && bytesForPdfOcr.length <= PDF_OCR_DOC_MAX_BYTES_FOR_PDF_OCR;

    if (isWholeScanForPdfOcr) {
      if (jobForPdfOcr.diagnostics) jobForPdfOcr.diagnostics.engine = 'mistral-ocr';
      onProgressForPdfOcr({ stage: 'document', done: 0, total: pagesForPdfOcr.length });
      var partsForPdfOcr = await transcribeWholeDocumentForPdfOcr({
        base64: jobForPdfOcr.pdfBase64,
        fileName: jobForPdfOcr.fileName || 'document.pdf',
        apiKey: jobForPdfOcr.apiKey,
        signal: jobForPdfOcr.controller.signal
      });
      if (jobForPdfOcr.controller.signal.aborted) return resultForPdfOcr;
      if (partsForPdfOcr && partsForPdfOcr.length) {
        resultForPdfOcr.engine = 'mistral-ocr';
        resultForPdfOcr.notice = PDF_OCR_DOC_NOTICE_FOR_PDF_OCR;
        // The parser is expected to return one text section per page. When it does, page
        // structure is preserved so page markers still line up with the original document;
        // when it does not, the sections are joined and the page markers are dropped rather
        // than invented.
        if (partsForPdfOcr.length === pagesForPdfOcr.length) {
          for (var iForPdfOcr = 0; iForPdfOcr < pagesForPdfOcr.length; iForPdfOcr++) {
            pagesForPdfOcr[iForPdfOcr].text = partsForPdfOcr[iForPdfOcr];
          }
          resultForPdfOcr.transcribedCount = pagesForPdfOcr.length;
        } else {
          resultForPdfOcr.wholeDocumentText = partsForPdfOcr.join('\n\n');
          resultForPdfOcr.transcribedCount = emptyPagesForPdfOcr.length;
        }
        onProgressForPdfOcr({ stage: 'document', done: pagesForPdfOcr.length, total: pagesForPdfOcr.length });
        return resultForPdfOcr;
      }
      // Nothing usable came back. Fall through to the page engine rather than returning a
      // document of empty pages.
    }

    if (jobForPdfOcr.diagnostics) jobForPdfOcr.diagnostics.engine = 'page-vision';
    var visionResultForPdfOcr = await transcribePagesWithVisionForPdfOcr({
      bytes: bytesForPdfOcr,
      emptyPages: emptyPagesForPdfOcr,
      apiKey: jobForPdfOcr.apiKey,
      signal: jobForPdfOcr.controller.signal,
      onProgress: onProgressForPdfOcr,
      onPageResult: function (imageForPdfOcr) {
        if (!jobForPdfOcr.diagnostics || !imageForPdfOcr || !imageForPdfOcr.error) return;
        jobForPdfOcr.diagnostics.renderErrors.push({
          page: Number(imageForPdfOcr.page) || 0,
          error: String(imageForPdfOcr.error)
        });
      },
      onTranscript: function (pageNumberForPdfOcr, succeededForPdfOcr) {
        if (!jobForPdfOcr.diagnostics || !succeededForPdfOcr) return;
        jobForPdfOcr.diagnostics.successfulTranscriptionCount += 1;
      }
    });
    resultForPdfOcr.engine = 'page-vision';
    resultForPdfOcr.blankPages = visionResultForPdfOcr.blankPages || [];
    resultForPdfOcr.renderErrors = visionResultForPdfOcr.renderErrors || [];
    resultForPdfOcr.error = visionResultForPdfOcr.error || '';
    for (var jForPdfOcr = 0; jForPdfOcr < pagesForPdfOcr.length; jForPdfOcr++) {
      var pageRecordForPdfOcr = pagesForPdfOcr[jForPdfOcr];
      var transcriptForPageForPdfOcr = visionResultForPdfOcr.transcripts[Number(pageRecordForPdfOcr.page)];
      if (!transcriptForPageForPdfOcr) continue;
      pageRecordForPdfOcr.text = PDF_OCR_PAGE_NOTICE_FOR_PDF_OCR + '\n' + transcriptForPageForPdfOcr;
      resultForPdfOcr.transcribedCount += 1;
    }
    return resultForPdfOcr;
  }

  function startJobForPdfOcr(messageForPdfOcr) {
    var jobIdForPdfOcr = String(messageForPdfOcr.jobId || '');
    if (!jobIdForPdfOcr || activeJobsForPdfOcr.has(jobIdForPdfOcr)) return;

    var jobForPdfOcr = {
      jobId: jobIdForPdfOcr,
      tabId: typeof messageForPdfOcr.tabId === 'number' ? messageForPdfOcr.tabId : null,
      pages: messageForPdfOcr.pages || [],
      pdfBase64: messageForPdfOcr.pdfBase64 || '',
      fileName: messageForPdfOcr.fileName || 'document.pdf',
      apiKey: messageForPdfOcr.apiKey || '',
      contentHash: String(messageForPdfOcr.contentHash || ''),
      controller: new AbortController(),
      startTime: Date.now(),
      diagnostics: {
        engine: '',
        targetCount: 0,
        currentStage: '',
        stageStartedAt: 0,
        stageDone: 0,
        stageTotal: 0,
        renderedCount: 0,
        transcribedAttemptCount: 0,
        successfulTranscriptionCount: 0,
        renderErrors: [],
        stageTimingsMs: {}
      }
    };
    activeJobsForPdfOcr.set(jobIdForPdfOcr, jobForPdfOcr);

    // A job that never finishes would hold its caller open forever; the budget is the outer
    // bound that the per-request and page-render timeouts cannot provide on their own. Race the
    // work rather than only aborting it: a third-party promise that ignores abort must not keep
    // the caller waiting past the budget.
    var budgetTimerForPdfOcr = null;
    var budgetPromiseForPdfOcr = new Promise(function (resolveForBudget) {
      budgetTimerForPdfOcr = setTimeout(function () {
        if (!jobForPdfOcr.cancelled) jobForPdfOcr.timedOut = true;
        jobForPdfOcr.controller.abort();
        resolveForBudget({ type: 'timeout' });
      }, PDF_OCR_JOB_BUDGET_MS_FOR_PDF_OCR);
    });
    var runPromiseForPdfOcr = runJobForPdfOcr(jobForPdfOcr).then(
      function (resultForPdfOcr) {
        return { type: 'result', result: resultForPdfOcr };
      },
      function (errorForPdfOcr) {
        return { type: 'error', error: errorForPdfOcr };
      }
    );

    Promise.race([runPromiseForPdfOcr, budgetPromiseForPdfOcr]).then(function (outcomeForPdfOcr) {
      clearTimeout(budgetTimerForPdfOcr);
      activeJobsForPdfOcr.delete(jobIdForPdfOcr);
      if (outcomeForPdfOcr.type === 'timeout') {
        var timeoutResultForPdfOcr = {
          pages: jobForPdfOcr.pages,
          wholeDocumentText: '',
          notice: '',
          engine: jobForPdfOcr.diagnostics.engine || '',
          blankPages: [],
          renderErrors: jobForPdfOcr.diagnostics.renderErrors.slice(),
          transcribedCount: 0,
          targetCount: Number(jobForPdfOcr.diagnostics.targetCount || 0),
          error: jobForPdfOcr.cancelled
            ? 'PDF OCR was cancelled.'
            : 'The PDF OCR job exceeded its 15-minute limit.'
        };
        writeJobLogForPdfOcr(jobForPdfOcr, timeoutResultForPdfOcr, null);
        emitJobEventForPdfOcr(jobForPdfOcr, 'done', {
          pages: timeoutResultForPdfOcr.pages,
          wholeDocumentText: '',
          notice: '',
          engine: timeoutResultForPdfOcr.engine,
          blankPages: [],
          transcribedCount: 0,
          targetCount: timeoutResultForPdfOcr.targetCount,
          error: timeoutResultForPdfOcr.error,
          cancelled: Boolean(jobForPdfOcr.cancelled),
          timedOut: Boolean(jobForPdfOcr.timedOut)
        });
        return;
      }
      if (outcomeForPdfOcr.type === 'error') {
        writeJobLogForPdfOcr(jobForPdfOcr, null, outcomeForPdfOcr.error);
        emitJobEventForPdfOcr(jobForPdfOcr, 'done', {
          pages: jobForPdfOcr.pages,
          wholeDocumentText: '',
          notice: '',
          engine: '',
          blankPages: [],
          transcribedCount: 0,
          targetCount: Number(jobForPdfOcr.diagnostics.targetCount || 0),
          error: (outcomeForPdfOcr.error && outcomeForPdfOcr.error.message) || 'Transcription failed.',
          cancelled: Boolean(jobForPdfOcr.cancelled),
          timedOut: Boolean(jobForPdfOcr.timedOut)
        });
        return;
      }
      var resultForPdfOcr = outcomeForPdfOcr.result;
      writeJobLogForPdfOcr(jobForPdfOcr, resultForPdfOcr, null);
      emitJobEventForPdfOcr(jobForPdfOcr, 'done', {
        pages: resultForPdfOcr.pages,
        wholeDocumentText: resultForPdfOcr.wholeDocumentText,
        notice: resultForPdfOcr.notice,
        engine: resultForPdfOcr.engine,
        blankPages: resultForPdfOcr.blankPages,
        transcribedCount: resultForPdfOcr.transcribedCount,
        targetCount: resultForPdfOcr.targetCount,
        cancelled: Boolean(jobForPdfOcr.cancelled),
        timedOut: Boolean(jobForPdfOcr.timedOut)
      });
    });
  }

  chrome.runtime.onMessage.addListener(function (messageForPdfOcr, senderForPdfOcr, sendResponseForPdfOcr) {
    if (!messageForPdfOcr) return;

    if (messageForPdfOcr.action === 'pdfOcrJobRun') {
      startJobForPdfOcr(messageForPdfOcr);
      try { sendResponseForPdfOcr({ ok: true }); } catch (errForPdfOcr) {}
      return false;
    }

    if (messageForPdfOcr.action === 'pdfOcrJobCancel') {
      var jobForPdfOcr = activeJobsForPdfOcr.get(String(messageForPdfOcr.jobId || ''));
      if (jobForPdfOcr) {
        jobForPdfOcr.cancelled = true;
        jobForPdfOcr.controller.abort();
      }
      try { sendResponseForPdfOcr({ ok: true }); } catch (errForPdfOcr) {}
      return false;
    }

    return undefined;
  });

  nsForPdfOcr.pdfOcr = { minPageChars: PDF_OCR_MIN_PAGE_CHARS_FOR_PDF_OCR };
  globalScopeForPdfOcr.ABChatOffscreen = nsForPdfOcr;
})();
