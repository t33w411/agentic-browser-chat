// Draws the pictures view_file shows the agent: a picture scaled to the size the model can use,
// the pages of a PDF at full size, or contact sheets of page thumbnails. Which pages and how many
// is decided in agent/fileViewRules.js; this file only draws.
//
// It needs a page canvas and pdf.js (through pdfRaster.js), so it lives in the offscreen
// document, where the agent loop runs, and in no other script list. Canvases are encoded with
// toDataURL: toBlob and convertToBlob wait for idle time, which the hidden offscreen document
// rarely gets.
(function () {
  var globalScopeForFileViewRender = globalThis;
  var nsForFileViewRender = globalScopeForFileViewRender.ABChatOffscreen || {};

  // A picture is sent as it is when it is one of these types, within the size limit, and its data
  // URL is at most this long. Anything else is drawn again as a JPEG.
  var PASS_THROUGH_TYPES_FOR_FILE_VIEW_RENDER = ['image/png', 'image/jpeg', 'image/webp'];
  var PASS_THROUGH_MAX_CHARS_FOR_FILE_VIEW_RENDER = 4 * 1024 * 1024;
  var SHEET_BACKGROUND_FOR_FILE_VIEW_RENDER = '#e5e7eb';
  var SHEET_BORDER_FOR_FILE_VIEW_RENDER = '#6b7280';
  var SHEET_LABEL_COLOR_FOR_FILE_VIEW_RENDER = '#111827';
  var SHEET_NOTE_COLOR_FOR_FILE_VIEW_RENDER = '#b91c1c';

  function rulesForFileViewRender() {
    var rulesForRender = (globalScopeForFileViewRender.ABChatAgent || {}).fileViewRules;
    if (!rulesForRender) throw new Error('view_file rules are not loaded.');
    return rulesForRender;
  }

  function bytesFromDataUrlForFileViewRender(dataUrlForBytes) {
    var textForBytes = String(dataUrlForBytes || '');
    var commaForBytes = textForBytes.indexOf(',');
    if (textForBytes.indexOf('data:') !== 0 || commaForBytes < 0) return null;
    var headerForBytes = textForBytes.slice(5, commaForBytes);
    var bodyForBytes = textForBytes.slice(commaForBytes + 1);
    var mimeForBytes = headerForBytes.split(';')[0].toLowerCase();
    var binaryForBytes;
    try {
      binaryForBytes = /;base64/i.test(headerForBytes) ? atob(bodyForBytes) : decodeURIComponent(bodyForBytes);
    } catch (errForBytes) {
      return null;
    }
    var arrayForBytes = new Uint8Array(binaryForBytes.length);
    for (var iForBytes = 0; iForBytes < binaryForBytes.length; iForBytes++) arrayForBytes[iForBytes] = binaryForBytes.charCodeAt(iForBytes) & 0xff;
    return { mime: mimeForBytes, bytes: arrayForBytes };
  }

  // A drawable picture. createImageBitmap cannot read SVG, which an <img> can.
  function decodeForFileViewRender(dataUrlForDecode) {
    var parsedForDecode = bytesFromDataUrlForFileViewRender(dataUrlForDecode);
    if (!parsedForDecode) return Promise.reject(new Error('The picture\'s data could not be read.'));
    var blobForDecode = new Blob([parsedForDecode.bytes], { type: parsedForDecode.mime || 'application/octet-stream' });
    return createImageBitmap(blobForDecode).then(function (bitmapForDecode) {
      return { mime: parsedForDecode.mime, source: bitmapForDecode, width: bitmapForDecode.width, height: bitmapForDecode.height, done: function () { if (bitmapForDecode.close) bitmapForDecode.close(); } };
    }, function () {
      return new Promise(function (resolveForImage, rejectForImage) {
        var urlForImage = URL.createObjectURL(blobForDecode);
        var elementForImage = new Image();
        elementForImage.onload = function () {
          URL.revokeObjectURL(urlForImage);
          var widthForImage = elementForImage.naturalWidth || 1600;
          var heightForImage = elementForImage.naturalHeight || Math.round(widthForImage * 9 / 16);
          resolveForImage({ mime: parsedForDecode.mime, source: elementForImage, width: widthForImage, height: heightForImage, done: function () {} });
        };
        elementForImage.onerror = function () {
          URL.revokeObjectURL(urlForImage);
          rejectForImage(new Error('The picture could not be decoded.'));
        };
        elementForImage.src = urlForImage;
      });
    });
  }

  function canvasForFileViewRender(widthForCanvas, heightForCanvas) {
    var canvasElement = document.createElement('canvas');
    canvasElement.width = Math.max(1, Math.round(widthForCanvas));
    canvasElement.height = Math.max(1, Math.round(heightForCanvas));
    return canvasElement;
  }

  // A picture for the model: as it is when it is small enough and of a type every provider takes,
  // otherwise drawn on white and encoded as JPEG. Resolves to { dataUrl, width, height }, where
  // width and height are the picture's own size.
  function scaleImageForFileViewRender(dataUrlForScale, optionsForScale) {
    var rules = rulesForFileViewRender();
    var optsForScale = optionsForScale || {};
    var maxEdgeForScale = Number(optsForScale.maxEdge) > 0 ? Number(optsForScale.maxEdge) : rules.LIMITS.imageEdge;
    var qualityForScale = Number(optsForScale.quality) > 0 ? Number(optsForScale.quality) : rules.LIMITS.pageQuality;
    return decodeForFileViewRender(dataUrlForScale).then(function (decodedForScale) {
      try {
        var widthForScale = decodedForScale.width;
        var heightForScale = decodedForScale.height;
        if (!(widthForScale > 0 && heightForScale > 0)) throw new Error('The picture has no size.');
        var fitsForScale = Math.max(widthForScale, heightForScale) <= maxEdgeForScale;
        if (fitsForScale
            && PASS_THROUGH_TYPES_FOR_FILE_VIEW_RENDER.indexOf(decodedForScale.mime) !== -1
            && String(dataUrlForScale).length <= PASS_THROUGH_MAX_CHARS_FOR_FILE_VIEW_RENDER) {
          return { dataUrl: String(dataUrlForScale), width: widthForScale, height: heightForScale };
        }
        var factorForScale = Math.min(1, maxEdgeForScale / Math.max(widthForScale, heightForScale));
        // An SVG with no pixels of its own is drawn as large as the limit allows.
        if (decodedForScale.mime === 'image/svg+xml') factorForScale = maxEdgeForScale / Math.max(widthForScale, heightForScale);
        var canvasForScale = canvasForFileViewRender(widthForScale * factorForScale, heightForScale * factorForScale);
        var contextForScale = canvasForScale.getContext('2d');
        contextForScale.fillStyle = '#ffffff';
        contextForScale.fillRect(0, 0, canvasForScale.width, canvasForScale.height);
        contextForScale.drawImage(decodedForScale.source, 0, 0, canvasForScale.width, canvasForScale.height);
        var encodedForScale = canvasForScale.toDataURL('image/jpeg', qualityForScale);
        canvasForScale.width = 0;
        canvasForScale.height = 0;
        return { dataUrl: encodedForScale, width: widthForScale, height: heightForScale };
      } finally {
        decodedForScale.done();
      }
    });
  }

  function drawLabelForFileViewRender(contextForLabel, cellForLabel, textForLabel, noteForLabel) {
    contextForLabel.textBaseline = 'middle';
    contextForLabel.font = '600 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    contextForLabel.fillStyle = SHEET_LABEL_COLOR_FOR_FILE_VIEW_RENDER;
    var midForLabel = cellForLabel.labelY + (cellForLabel.y - cellForLabel.labelY) / 2;
    contextForLabel.fillText(textForLabel, cellForLabel.labelX, midForLabel);
    if (noteForLabel) {
      var widthForLabel = contextForLabel.measureText(textForLabel + '  ').width;
      contextForLabel.fillStyle = SHEET_NOTE_COLOR_FOR_FILE_VIEW_RENDER;
      contextForLabel.fillText(noteForLabel, cellForLabel.labelX + widthForLabel, midForLabel);
    }
  }

  // One contact sheet. thumbs: [{ page, dataUrl, blank, error }] in sheet order.
  function composeSheetForFileViewRender(thumbsForSheet, pageSizeForSheet) {
    var rules = rulesForFileViewRender();
    var layoutForSheet = rules.sheetLayout(pageSizeForSheet.width, pageSizeForSheet.height, thumbsForSheet.length, rules.LIMITS.sheetEdge);
    var canvasForSheet = canvasForFileViewRender(layoutForSheet.width, layoutForSheet.height);
    var contextForSheet = canvasForSheet.getContext('2d');
    contextForSheet.fillStyle = SHEET_BACKGROUND_FOR_FILE_VIEW_RENDER;
    contextForSheet.fillRect(0, 0, canvasForSheet.width, canvasForSheet.height);
    var chainForSheet = Promise.resolve();
    thumbsForSheet.forEach(function (thumbForSheet, indexForSheet) {
      chainForSheet = chainForSheet.then(function () {
        var cellForSheet = layoutForSheet.cells[indexForSheet];
        var noteForSheet = thumbForSheet.blank ? 'blank page' : (thumbForSheet.error ? 'could not be drawn' : '');
        drawLabelForFileViewRender(contextForSheet, cellForSheet, 'Page ' + thumbForSheet.page, noteForSheet);
        contextForSheet.fillStyle = '#ffffff';
        contextForSheet.fillRect(cellForSheet.x, cellForSheet.y, cellForSheet.width, cellForSheet.height);
        var drawnForSheet = !thumbForSheet.dataUrl ? Promise.resolve() : decodeForFileViewRender(thumbForSheet.dataUrl).then(function (decodedForThumb) {
          try {
            // A page of another shape than the first is fitted inside the cell, centred.
            var fitForThumb = Math.min(cellForSheet.width / decodedForThumb.width, cellForSheet.height / decodedForThumb.height);
            var widthForThumb = decodedForThumb.width * fitForThumb;
            var heightForThumb = decodedForThumb.height * fitForThumb;
            var xForThumb = cellForSheet.x + (cellForSheet.width - widthForThumb) / 2;
            var yForThumb = cellForSheet.y + (cellForSheet.height - heightForThumb) / 2;
            contextForSheet.drawImage(decodedForThumb.source, xForThumb, yForThumb, widthForThumb, heightForThumb);
          } finally {
            decodedForThumb.done();
          }
        }, function () {});
        return drawnForSheet.then(function () {
          contextForSheet.strokeStyle = SHEET_BORDER_FOR_FILE_VIEW_RENDER;
          contextForSheet.lineWidth = 1;
          contextForSheet.strokeRect(cellForSheet.x - 0.5, cellForSheet.y - 0.5, cellForSheet.width + 1, cellForSheet.height + 1);
        });
      });
    });
    return chainForSheet.then(function () {
      var encodedForSheet = canvasForSheet.toDataURL('image/jpeg', rules.LIMITS.sheetQuality);
      canvasForSheet.width = 0;
      canvasForSheet.height = 0;
      return encodedForSheet;
    });
  }

  // The pages of a PDF. options: { pages (sorted page numbers, or null for all), signal,
  // reserve(plan) }. reserve is called once the page count is known and before anything is drawn;
  // it returns '' to go on or the refusal text. Resolves to { numPages, plan, pictures, blank,
  // failed } or { error, numPages }. pictures: [{ pages, sheet, dataUrl }] in order.
  async function renderPdfForFileViewRender(bytesForPdf, optionsForPdf) {
    var rules = rulesForFileViewRender();
    var optsForPdf = optionsForPdf || {};
    var raster = (globalScopeForFileViewRender.ABChatOffscreen || {}).pdfRaster;
    if (!raster || typeof raster.openDocument !== 'function') return { error: 'The PDF renderer is not loaded.' };
    var documentForPdf;
    try {
      documentForPdf = await raster.openDocument(bytesForPdf, { signal: optsForPdf.signal || null });
    } catch (errForOpen) {
      return { error: 'The PDF could not be opened: ' + ((errForOpen && errForOpen.message) || 'unknown error') + '.' };
    }
    try {
      var planForPdf = rules.planPages(documentForPdf.numPages, optsForPdf.pages || null);
      if (planForPdf.error) return { error: planForPdf.error, numPages: documentForPdf.numPages };
      var refusalForPdf = typeof optsForPdf.reserve === 'function' ? optsForPdf.reserve(planForPdf) : '';
      if (refusalForPdf) return { error: refusalForPdf, numPages: documentForPdf.numPages };
      var picturesForPdf = [];
      var blankForPdf = [];
      var failedForPdf = [];
      var renderOneForPdf = async function (pageForRender, renderOptions) {
        try {
          var renderedForPage = await documentForPdf.renderPage(pageForRender, renderOptions);
          if (renderedForPage.error) throw new Error(renderedForPage.error);
          if (renderedForPage.blank) blankForPdf.push(pageForRender);
          return renderedForPage;
        } catch (errForPage) {
          if (optsForPdf.signal && optsForPdf.signal.aborted) throw errForPage;
          failedForPdf.push(pageForRender);
          return { page: pageForRender, dataUrl: '', blank: false, error: (errForPage && errForPage.message) || 'Page render failed.' };
        }
      };
      if (planForPdf.mode === 'full') {
        for (var iForFull = 0; iForFull < planForPdf.shown.length; iForFull++) {
          var renderedForFull = await renderOneForPdf(planForPdf.shown[iForFull], { maxEdge: rules.LIMITS.pageEdge, quality: rules.LIMITS.pageQuality });
          if (renderedForFull.dataUrl) picturesForPdf.push({ pages: [planForPdf.shown[iForFull]], sheet: false, dataUrl: renderedForFull.dataUrl });
        }
      } else {
        var sizeForSheets = await documentForPdf.pageSize(planForPdf.sheets[0][0]);
        for (var iForSheet = 0; iForSheet < planForPdf.sheets.length; iForSheet++) {
          var pagesForSheet = planForPdf.sheets[iForSheet];
          var layoutForThumb = rules.sheetLayout(sizeForSheets.width, sizeForSheets.height, pagesForSheet.length, rules.LIMITS.sheetEdge);
          var thumbEdgeForSheet = Math.max(layoutForThumb.thumbWidth, layoutForThumb.thumbHeight);
          var thumbsForSheet = [];
          for (var iForThumb = 0; iForThumb < pagesForSheet.length; iForThumb++) {
            thumbsForSheet.push(await renderOneForPdf(pagesForSheet[iForThumb], { maxEdge: thumbEdgeForSheet, quality: rules.LIMITS.sheetQuality }));
          }
          picturesForPdf.push({ pages: pagesForSheet.slice(), sheet: true, dataUrl: await composeSheetForFileViewRender(thumbsForSheet, sizeForSheets) });
        }
      }
      return { numPages: documentForPdf.numPages, plan: planForPdf, pictures: picturesForPdf, blank: blankForPdf, failed: failedForPdf };
    } finally {
      documentForPdf.close();
    }
  }

  nsForFileViewRender.fileViewRender = {
    scaleImage: scaleImageForFileViewRender,
    renderPdf: renderPdfForFileViewRender
  };
  globalScopeForFileViewRender.ABChatOffscreen = nsForFileViewRender;
})();
