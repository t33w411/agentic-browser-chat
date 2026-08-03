// Renders individual PDF pages to JPEG data URLs.
//
// This lives in the offscreen document rather than the service worker because pdf.js renders
// through a real canvas: its default canvas and filter factories call document.createElement,
// which a service worker has no answer for. The offscreen document also gives pdf.js its proper
// worker, so page rasterization does not run on the thread that is parsing the file.
//
// pdf.js is a megabyte of script that only scanned PDFs ever need, so it is loaded on first use
// instead of at document creation, which happens for every agent run and every reminder beep.
//
// Callers are in this same document (pdfOcr.js), so this exposes plain functions rather than a
// message listener: the encoded PDF never has to cross a message boundary to reach it.
(function () {
  var globalScopeForPdfRaster = globalThis;
  var nsForPdfRaster = globalScopeForPdfRaster.ABChatOffscreen || {};

  var PDF_RASTER_DEFAULT_MAX_EDGE_FOR_PDF_RASTER = 1400;
  var PDF_RASTER_MIN_SCALE_FOR_PDF_RASTER = 0.5;
  var PDF_RASTER_MAX_SCALE_FOR_PDF_RASTER = 3;
  var PDF_RASTER_JPEG_QUALITY_FOR_PDF_RASTER = 0.72;
  var PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER = 48;
  // Luminance spread below this across the whole page reads as an empty sheet. Kept low so a
  // page holding only a line or two of faint text still registers as content worth transcribing.
  var PDF_RASTER_BLANK_LUMA_SPREAD_FOR_PDF_RASTER = 10;

  var pdfLibraryPromiseForPdfRaster = null;

  function loadPdfLibraryForPdfRaster() {
    if (pdfLibraryPromiseForPdfRaster) return pdfLibraryPromiseForPdfRaster;
    pdfLibraryPromiseForPdfRaster = new Promise(function (resolveForPdfRaster, rejectForPdfRaster) {
      if (globalScopeForPdfRaster.pdfjsLib && typeof globalScopeForPdfRaster.pdfjsLib.getDocument === 'function') {
        resolveForPdfRaster(globalScopeForPdfRaster.pdfjsLib);
        return;
      }
      var scriptForPdfRaster = document.createElement('script');
      scriptForPdfRaster.src = chrome.runtime.getURL('lib/pdf.min.js');
      scriptForPdfRaster.addEventListener('load', function () {
        if (!globalScopeForPdfRaster.pdfjsLib || typeof globalScopeForPdfRaster.pdfjsLib.getDocument !== 'function') {
          rejectForPdfRaster(new Error('PDF library loaded but exposed no API.'));
          return;
        }
        globalScopeForPdfRaster.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        resolveForPdfRaster(globalScopeForPdfRaster.pdfjsLib);
      });
      scriptForPdfRaster.addEventListener('error', function () {
        rejectForPdfRaster(new Error('PDF library failed to load.'));
      });
      (document.head || document.documentElement).appendChild(scriptForPdfRaster);
    });
    pdfLibraryPromiseForPdfRaster.catch(function () {
      // Allow a later request to retry the load rather than inheriting this failure forever.
      pdfLibraryPromiseForPdfRaster = null;
    });
    return pdfLibraryPromiseForPdfRaster;
  }

  // Downsample the rendered page into a small probe canvas and measure the luminance spread.
  // A page with any text or figure keeps some contrast even at probe size; a genuinely empty
  // sheet collapses to a single tone, and skipping it saves a pointless vision call.
  function isRenderedPageBlankForPdfRaster(canvasForPdfRaster) {
    try {
      var probeForPdfRaster = document.createElement('canvas');
      probeForPdfRaster.width = PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER;
      probeForPdfRaster.height = PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER;
      var probeContextForPdfRaster = probeForPdfRaster.getContext('2d');
      if (!probeContextForPdfRaster) return false;
      probeContextForPdfRaster.drawImage(
        canvasForPdfRaster, 0, 0,
        PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER,
        PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER
      );
      var pixelsForPdfRaster = probeContextForPdfRaster.getImageData(
        0, 0,
        PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER,
        PDF_RASTER_BLANK_PROBE_EDGE_FOR_PDF_RASTER
      ).data;
      var minLumaForPdfRaster = 255;
      var maxLumaForPdfRaster = 0;
      for (var iForPdfRaster = 0; iForPdfRaster < pixelsForPdfRaster.length; iForPdfRaster += 4) {
        var lumaForPdfRaster = (pixelsForPdfRaster[iForPdfRaster] * 299
          + pixelsForPdfRaster[iForPdfRaster + 1] * 587
          + pixelsForPdfRaster[iForPdfRaster + 2] * 114) / 1000;
        if (lumaForPdfRaster < minLumaForPdfRaster) minLumaForPdfRaster = lumaForPdfRaster;
        if (lumaForPdfRaster > maxLumaForPdfRaster) maxLumaForPdfRaster = lumaForPdfRaster;
      }
      return (maxLumaForPdfRaster - minLumaForPdfRaster) < PDF_RASTER_BLANK_LUMA_SPREAD_FOR_PDF_RASTER;
    } catch (errForPdfRaster) {
      return false;
    }
  }

  function renderSinglePageForPdfRaster(pdfForPdfRaster, pageNumberForPdfRaster, maxEdgeForPdfRaster) {
    return pdfForPdfRaster.getPage(pageNumberForPdfRaster).then(function (pageForPdfRaster) {
      var baseViewportForPdfRaster = pageForPdfRaster.getViewport({ scale: 1 });
      var longestEdgeForPdfRaster = Math.max(baseViewportForPdfRaster.width, baseViewportForPdfRaster.height) || 1;
      var scaleForPdfRaster = Math.min(
        PDF_RASTER_MAX_SCALE_FOR_PDF_RASTER,
        Math.max(PDF_RASTER_MIN_SCALE_FOR_PDF_RASTER, maxEdgeForPdfRaster / longestEdgeForPdfRaster)
      );
      var viewportForPdfRaster = pageForPdfRaster.getViewport({ scale: scaleForPdfRaster });
      var canvasForPdfRaster = document.createElement('canvas');
      canvasForPdfRaster.width = Math.max(1, Math.floor(viewportForPdfRaster.width));
      canvasForPdfRaster.height = Math.max(1, Math.floor(viewportForPdfRaster.height));
      var contextForPdfRaster = canvasForPdfRaster.getContext('2d');
      if (!contextForPdfRaster) throw new Error('Canvas context unavailable.');
      // PDF pages have no background of their own; without this a scan renders on transparency
      // and flattens to black in JPEG.
      contextForPdfRaster.fillStyle = '#ffffff';
      contextForPdfRaster.fillRect(0, 0, canvasForPdfRaster.width, canvasForPdfRaster.height);

      return pageForPdfRaster.render({
        canvasContext: contextForPdfRaster,
        viewport: viewportForPdfRaster
      }).promise.then(function () {
        var blankForPdfRaster = isRenderedPageBlankForPdfRaster(canvasForPdfRaster);
        var dataUrlForPdfRaster = blankForPdfRaster
          ? ''
          : canvasForPdfRaster.toDataURL('image/jpeg', PDF_RASTER_JPEG_QUALITY_FOR_PDF_RASTER);
        if (typeof pageForPdfRaster.cleanup === 'function') pageForPdfRaster.cleanup();
        canvasForPdfRaster.width = 0;
        canvasForPdfRaster.height = 0;
        return { page: pageNumberForPdfRaster, dataUrl: dataUrlForPdfRaster, blank: blankForPdfRaster };
      });
    });
  }

  // bytesForPdfRaster: Uint8Array of the whole PDF. optionsForPdfRaster: { maxEdge, signal, onPage }.
  // Resolves to one entry per requested page: { page, dataUrl, blank, error? }.
  function rasterizePagesForPdfRaster(bytesForPdfRaster, pageNumbersForPdfRaster, optionsForPdfRaster) {
    var optsForPdfRaster = optionsForPdfRaster || {};
    var signalForPdfRaster = optsForPdfRaster.signal || null;
    var requestedForPdfRaster = (Array.isArray(pageNumbersForPdfRaster) ? pageNumbersForPdfRaster : [])
      .map(Number)
      .filter(function (pageNumberForPdfRaster) {
        return Number.isFinite(pageNumberForPdfRaster) && pageNumberForPdfRaster > 0;
      });
    if (!requestedForPdfRaster.length) return Promise.resolve([]);

    var maxEdgeForPdfRaster = Number(optsForPdfRaster.maxEdge);
    if (!Number.isFinite(maxEdgeForPdfRaster) || maxEdgeForPdfRaster <= 0) {
      maxEdgeForPdfRaster = PDF_RASTER_DEFAULT_MAX_EDGE_FOR_PDF_RASTER;
    }

    return loadPdfLibraryForPdfRaster().then(function (pdfjsLibForPdfRaster) {
      // pdf.js transfers the view it is handed to its worker, detaching the caller's buffer.
      // Hand it a private copy so the caller keeps its bytes for the whole-document engine.
      return pdfjsLibForPdfRaster.getDocument({ data: new Uint8Array(bytesForPdfRaster) }).promise;
    }).then(function (pdfForPdfRaster) {
      var imagesForPdfRaster = [];

      // Sequential: each page holds a full-size canvas plus its decoded images, and a scanned
      // document is exactly the case where those are large.
      function renderNextForPdfRaster(indexForPdfRaster) {
        if (indexForPdfRaster >= requestedForPdfRaster.length) return Promise.resolve();
        if (signalForPdfRaster && signalForPdfRaster.aborted) return Promise.resolve();
        var pageNumberForPdfRaster = requestedForPdfRaster[indexForPdfRaster];
        if (pageNumberForPdfRaster > pdfForPdfRaster.numPages) {
          return renderNextForPdfRaster(indexForPdfRaster + 1);
        }
        return renderSinglePageForPdfRaster(pdfForPdfRaster, pageNumberForPdfRaster, maxEdgeForPdfRaster)
          .then(function (imageForPdfRaster) {
            imagesForPdfRaster.push(imageForPdfRaster);
          })
          .catch(function (errForPdfRaster) {
            imagesForPdfRaster.push({
              page: pageNumberForPdfRaster,
              dataUrl: '',
              blank: false,
              error: (errForPdfRaster && errForPdfRaster.message) || 'Page render failed.'
            });
          })
          .then(function () {
            if (typeof optsForPdfRaster.onPage === 'function') {
              try {
                optsForPdfRaster.onPage(indexForPdfRaster + 1, requestedForPdfRaster.length);
              } catch (errForPdfRaster) { /* progress is best effort */ }
            }
            return renderNextForPdfRaster(indexForPdfRaster + 1);
          });
      }

      return renderNextForPdfRaster(0).then(function () {
        if (typeof pdfForPdfRaster.destroy === 'function') pdfForPdfRaster.destroy();
        return imagesForPdfRaster;
      });
    });
  }

  nsForPdfRaster.pdfRaster = {
    rasterizePages: rasterizePagesForPdfRaster,
    defaultMaxEdge: PDF_RASTER_DEFAULT_MAX_EDGE_FOR_PDF_RASTER
  };
  globalScopeForPdfRaster.ABChatOffscreen = nsForPdfRaster;
})();
