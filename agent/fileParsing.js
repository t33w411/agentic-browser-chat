(function () {
  var globalScopeForFileParsing = globalThis;
  var agentNamespaceForFileParsing = globalScopeForFileParsing.ABChatAgent || {};
  var loadedLibrariesForFileParsing = {};
  // Two budgets, for two different jobs.
  //
  // An attachment's text is stored on its blob, and the model can reach any part of it later
  // through read(type:"attachment") paging or by passing the blob id to eval, so storage keeps
  // the whole document. This outer cap only exists to bound how much a single file can add to
  // IndexedDB; it is high enough that ordinary documents never meet it.
  var MAX_STORED_TEXT_CHARS_FOR_FILE_PARSING = 5000000;
  // Callers with no blob to page (web_fetch, and the DOCX structural read) put their text
  // straight into a model request, so what they get back has to be small enough to send. This is
  // also the default size of the excerpt inlined into context for an attachment.
  var MAX_INLINE_TEXT_CHARS_FOR_FILE_PARSING = 200000;

  if (typeof importScripts === 'function') {
    try {
      importScripts(
        chrome.runtime.getURL('lib/papaparse.min.js'),
        chrome.runtime.getURL('lib/mammoth.min.js'),
        chrome.runtime.getURL('lib/xlsx.min.js'),
        chrome.runtime.getURL('lib/jszip.min.js'),
        chrome.runtime.getURL('lib/pdf.min.js'),
        chrome.runtime.getURL('lib/pdf.worker.min.js')
      );
      loadedLibrariesForFileParsing.papaparse = true;
      loadedLibrariesForFileParsing.mammoth = true;
      loadedLibrariesForFileParsing.xlsx = true;
      loadedLibrariesForFileParsing.jszip = true;
      loadedLibrariesForFileParsing.pdfjs = true;
      if (globalScopeForFileParsing.pdfjsLib) {
        globalScopeForFileParsing.pdfjsLib.GlobalWorkerOptions.workerSrc =
          chrome.runtime.getURL('lib/pdf.worker.min.js');
      }
    } catch (eForFileParsing) {
      // Libraries not available; parsing will degrade gracefully
    }
  }

  function ensureArrayBufferForFileParsing(bufferForFileParsing) {
    if (bufferForFileParsing instanceof ArrayBuffer) return bufferForFileParsing;
    if (ArrayBuffer.isView(bufferForFileParsing)) {
      var viewForFileParsing = bufferForFileParsing;
      return viewForFileParsing.buffer.slice(
        viewForFileParsing.byteOffset,
        viewForFileParsing.byteOffset + viewForFileParsing.byteLength
      );
    }
    if (Array.isArray(bufferForFileParsing)) {
      return new Uint8Array(bufferForFileParsing).buffer;
    }
    throw new Error('Invalid file buffer.');
  }

  function getFileExtensionForFileParsing(nameForFileParsing) {
    var normalizedNameForFileParsing = String(nameForFileParsing || '').trim().toLowerCase();
    var partsForFileParsing = normalizedNameForFileParsing.split('.');
    if (partsForFileParsing.length < 2) return '';
    return String(partsForFileParsing.pop() || '').trim();
  }

  // The per-format parsers label their natural divisions ([Page N], [Slide N], [Sheet: name]).
  // Cutting on one of those boundaries beats cutting mid-sentence: nothing is served in a partial
  // state, and the caller can say exactly how much of the document it is holding.
  function findSectionStartsForFileParsing(textForSections) {
    var patternsForSections = [
      { label: 'page', regex: /(?:^|\n)\[Page \d+\]\n/g },
      { label: 'slide', regex: /(?:^|\n)\[Slide \d+\]\n/g },
      { label: 'sheet', regex: /(?:^|\n)\[Sheet: [^\]\n]*\]\n/g }
    ];
    for (var pForSections = 0; pForSections < patternsForSections.length; pForSections++) {
      var startsForSections = [];
      var regexForSections = patternsForSections[pForSections].regex;
      regexForSections.lastIndex = 0;
      var matchForSections;
      while ((matchForSections = regexForSections.exec(textForSections))) {
        // The pattern eats the newline that precedes the marker, so the section itself begins
        // one character later (except for the very first, which starts at 0).
        startsForSections.push(matchForSections.index === 0 ? 0 : matchForSections.index + 1);
      }
      if (startsForSections.length >= 2) {
        return { label: patternsForSections[pForSections].label, starts: startsForSections };
      }
    }
    return null;
  }

  function describeSectionRangeForFileParsing(labelForRange, shownForRange, totalForRange) {
    return labelForRange + 's 1-' + shownForRange + ' of ' + totalForRange;
  }

  function describeCharRangeForFileParsing(shownForRange, totalForRange) {
    return 'the first ' + shownForRange.toLocaleString('en-US') + ' of '
      + totalForRange.toLocaleString('en-US') + ' characters';
  }

  // Cut at the last paragraph or sentence boundary near the limit, so the tail is not a dangling
  // half-sentence. Used when the text has no section markers to cut on (plain text, CSV, DOCX).
  function findProseCutForFileParsing(textForCut, limitForCut) {
    var searchWindowForCut = Math.max(1000, Math.floor(limitForCut * 0.05));
    var searchFromForCut = limitForCut - searchWindowForCut;

    var paragraphIndexForCut = textForCut.lastIndexOf('\n\n', limitForCut);
    if (paragraphIndexForCut >= searchFromForCut) return paragraphIndexForCut;

    var sentenceMarkersForCut = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    var bestSentenceCutForCut = -1;
    for (var mForCut = 0; mForCut < sentenceMarkersForCut.length; mForCut++) {
      var markerIndexForCut = textForCut.lastIndexOf(sentenceMarkersForCut[mForCut], limitForCut - 1);
      if (markerIndexForCut >= searchFromForCut && (markerIndexForCut + 1) > bestSentenceCutForCut) {
        bestSentenceCutForCut = markerIndexForCut + 1;
      }
    }
    return bestSentenceCutForCut >= searchFromForCut ? bestSentenceCutForCut : limitForCut;
  }

  // Returns { text, truncated, note }. `note` describes what survived in the caller's own terms
  // ("pages 1-142 of 310"), and is left for the caller to render, because how the reader should
  // recover the rest differs by caller: an attachment can be paged from its blob, a fetched
  // document cannot.
  function truncateTextForFileParsing(textForTruncate, maxCharsForTruncate) {
    if (textForTruncate.length <= maxCharsForTruncate) {
      return { text: textForTruncate, truncated: false, note: '' };
    }

    var sectionsForTruncate = findSectionStartsForFileParsing(textForTruncate);
    if (sectionsForTruncate) {
      var cutAtForTruncate = -1;
      var completeSectionsForTruncate = 0;
      for (var sForTruncate = 1; sForTruncate < sectionsForTruncate.starts.length; sForTruncate++) {
        if (sectionsForTruncate.starts[sForTruncate] > maxCharsForTruncate) break;
        cutAtForTruncate = sectionsForTruncate.starts[sForTruncate];
        completeSectionsForTruncate = sForTruncate;
      }
      // With no whole section inside the budget, a section cut would return nothing at all, so
      // fall through to the prose cut instead.
      if (completeSectionsForTruncate >= 1) {
        return {
          text: textForTruncate.slice(0, cutAtForTruncate).replace(/\s+$/, ''),
          truncated: true,
          note: describeSectionRangeForFileParsing(
            sectionsForTruncate.label,
            completeSectionsForTruncate,
            sectionsForTruncate.starts.length
          )
        };
      }
    }

    var proseCutForTruncate = findProseCutForFileParsing(textForTruncate, maxCharsForTruncate);
    var cutTextForTruncate = textForTruncate.slice(0, proseCutForTruncate).replace(/\s+$/, '');
    return {
      text: cutTextForTruncate,
      truncated: true,
      note: describeCharRangeForFileParsing(cutTextForTruncate.length, textForTruncate.length)
    };
  }

  function normalizeTextForFileParsing(rawTextForFileParsing, maxCharsForFileParsing) {
    var normalizedForFileParsing = String(rawTextForFileParsing || '').replace(/\r\n/g, '\n').trim();
    var limitForFileParsing = Number.isFinite(Number(maxCharsForFileParsing)) && Number(maxCharsForFileParsing) > 0
      ? Number(maxCharsForFileParsing)
      : MAX_STORED_TEXT_CHARS_FOR_FILE_PARSING;
    var truncatedForFileParsing = truncateTextForFileParsing(normalizedForFileParsing, limitForFileParsing);
    return {
      text: truncatedForFileParsing.truncated
        ? truncatedForFileParsing.text + '\n\n[Truncated: ' + truncatedForFileParsing.note + ' shown.]'
        : truncatedForFileParsing.text,
      truncated: truncatedForFileParsing.truncated,
      note: truncatedForFileParsing.note,
      totalChars: normalizedForFileParsing.length
    };
  }

  // Builds the excerpt inlined into the model's context for a stored attachment. No marker is
  // appended here: the context layer knows the blob id and composes a note that says how to read
  // the remainder, which is the only useful thing to say at that point.
  function buildInlineExcerptForFileParsing(textForExcerpt, maxCharsForExcerpt) {
    var sourceForExcerpt = String(textForExcerpt || '');
    var limitForExcerpt = Number.isFinite(Number(maxCharsForExcerpt)) && Number(maxCharsForExcerpt) > 0
      ? Number(maxCharsForExcerpt)
      : MAX_INLINE_TEXT_CHARS_FOR_FILE_PARSING;
    var resultForExcerpt = truncateTextForFileParsing(sourceForExcerpt, limitForExcerpt);
    return {
      text: resultForExcerpt.text,
      truncated: resultForExcerpt.truncated,
      note: resultForExcerpt.note,
      totalChars: sourceForExcerpt.length
    };
  }

  function decodeUtf8ForFileParsing(arrayBufferForFileParsing) {
    var decoderForFileParsing = new TextDecoder('utf-8', { fatal: false });
    return decoderForFileParsing.decode(arrayBufferForFileParsing);
  }

  function inferFormatForFileParsing(fileNameForFileParsing, mimeTypeForFileParsing) {
    var extensionForFileParsing = getFileExtensionForFileParsing(fileNameForFileParsing);
    var normalizedMimeTypeForFileParsing = String(mimeTypeForFileParsing || '').toLowerCase();
    if (extensionForFileParsing === 'csv' || normalizedMimeTypeForFileParsing.indexOf('text/csv') === 0) return 'csv';
    if (extensionForFileParsing === 'pdf' || normalizedMimeTypeForFileParsing === 'application/pdf') return 'pdf';
    if (extensionForFileParsing === 'docx' || normalizedMimeTypeForFileParsing === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (extensionForFileParsing === 'xlsx' || extensionForFileParsing === 'xls' || extensionForFileParsing === 'ods') return 'spreadsheet';
    if (normalizedMimeTypeForFileParsing === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'spreadsheet';
    if (normalizedMimeTypeForFileParsing === 'application/vnd.ms-excel') return 'spreadsheet';
    if (normalizedMimeTypeForFileParsing === 'application/vnd.oasis.opendocument.spreadsheet') return 'spreadsheet';
    if (extensionForFileParsing === 'pptx' || normalizedMimeTypeForFileParsing === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
    if (normalizedMimeTypeForFileParsing.indexOf('text/') === 0) return 'text';
    if (extensionForFileParsing === 'txt' || extensionForFileParsing === 'md' || extensionForFileParsing === 'markdown' || extensionForFileParsing === 'json') return 'text';
    return 'unknown';
  }

  function loadLibraryForFileParsing(pathForFileParsing, keyForFileParsing) {
    if (loadedLibrariesForFileParsing[keyForFileParsing]) return;
    var runtimeUrlForFileParsing = chrome.runtime.getURL(pathForFileParsing);
    importScripts(runtimeUrlForFileParsing);
    loadedLibrariesForFileParsing[keyForFileParsing] = true;
  }

  function parseTextForFileParsing(arrayBufferForFileParsing) {
    return decodeUtf8ForFileParsing(arrayBufferForFileParsing);
  }

  function parseCsvForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/papaparse.min.js', 'papaparse');
    if (!globalScopeForFileParsing.Papa || typeof globalScopeForFileParsing.Papa.parse !== 'function') {
      return parseTextForFileParsing(arrayBufferForFileParsing);
    }
    var textForFileParsing = decodeUtf8ForFileParsing(arrayBufferForFileParsing);
    var resultForFileParsing = globalScopeForFileParsing.Papa.parse(textForFileParsing, { skipEmptyLines: false });
    if (!resultForFileParsing || !Array.isArray(resultForFileParsing.data)) {
      return textForFileParsing;
    }
    return resultForFileParsing.data
      .map(function (rowForFileParsing) {
        if (!Array.isArray(rowForFileParsing)) return String(rowForFileParsing || '');
        return rowForFileParsing.join('\t');
      })
      .join('\n');
  }

  function parseDocxForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/mammoth.min.js', 'mammoth');
    if (!globalScopeForFileParsing.mammoth || typeof globalScopeForFileParsing.mammoth.extractRawText !== 'function') {
      throw new Error('DOCX parser is unavailable.');
    }
    return globalScopeForFileParsing.mammoth.extractRawText({ arrayBuffer: arrayBufferForFileParsing }).then(function (resultForFileParsing) {
      return String((resultForFileParsing && resultForFileParsing.value) || '');
    });
  }

  function getDocxFormatForFileParsing() {
    return (globalScopeForFileParsing.ABChatAgent || {}).docxFormat || null;
  }

  // Read the source document's own formatting straight from the OOXML parts. mammoth is a
  // semantic converter: it drops table borders entirely and reports a run's size only when
  // that size is direct formatting, so the style cascade that most real documents rely on is
  // invisible to it. Failure is non-fatal; the structural read falls back to plain mammoth.
  function readDocxFormatProfileForFileParsing(arrayBufferForFileParsing) {
    var docxFormatForFileParsing = getDocxFormatForFileParsing();
    if (!docxFormatForFileParsing) return Promise.resolve(null);
    try {
      loadLibraryForFileParsing('lib/jszip.min.js', 'jszip');
    } catch (loadErrForFileParsing) {
      return Promise.resolve(null);
    }
    if (!globalScopeForFileParsing.JSZip || typeof globalScopeForFileParsing.JSZip.loadAsync !== 'function') {
      return Promise.resolve(null);
    }
    return globalScopeForFileParsing.JSZip.loadAsync(arrayBufferForFileParsing).then(function (zipForFileParsing) {
      function readZipPartForFileParsing(pathForFileParsing) {
        var entryForFileParsing = zipForFileParsing.file(pathForFileParsing);
        return entryForFileParsing ? entryForFileParsing.async('string') : Promise.resolve('');
      }
      return Promise.all([
        readZipPartForFileParsing('word/document.xml'),
        readZipPartForFileParsing('word/styles.xml'),
        readZipPartForFileParsing('word/theme/theme1.xml')
      ]).then(function (partsForFileParsing) {
        return docxFormatForFileParsing.analyzeParts({
          documentXml: partsForFileParsing[0],
          stylesXml: partsForFileParsing[1],
          themeXml: partsForFileParsing[2]
        });
      });
    }).catch(function () {
      return null;
    });
  }

  // Stamp each run with a synthetic character style id naming its resolved (size, family).
  // Runs that already carry a character style are left alone: their style id is what maps
  // them to <strong>/<em> and overwriting it would silently drop that formatting.
  function stampRunFormatsForFileParsing(documentNodeForFileParsing, profileForFileParsing, planForFileParsing) {
    var docxFormatForFileParsing = getDocxFormatForFileParsing();
    var styleFormatsForFileParsing = profileForFileParsing.styleFormats || {};
    function normalizeFamilyForFileParsing(valueForFileParsing) {
      if (docxFormatForFileParsing && typeof docxFormatForFileParsing.normalizeFontFamily === 'function') {
        return docxFormatForFileParsing.normalizeFontFamily(valueForFileParsing);
      }
      return String(valueForFileParsing || '').trim();
    }
    function visitForFileParsing(nodeForFileParsing, paragraphStyleIdForFileParsing) {
      if (!nodeForFileParsing || typeof nodeForFileParsing !== 'object') return;
      var nextParagraphStyleIdForFileParsing = paragraphStyleIdForFileParsing;
      if (nodeForFileParsing.type === 'paragraph') {
        nextParagraphStyleIdForFileParsing = nodeForFileParsing.styleId || '';
      }
      if (nodeForFileParsing.type === 'run' && !nodeForFileParsing.styleId && !nodeForFileParsing.styleName) {
        var paragraphFormatForFileParsing = nextParagraphStyleIdForFileParsing
          ? styleFormatsForFileParsing[nextParagraphStyleIdForFileParsing]
          : null;
        var sizePtForFileParsing = Number(nodeForFileParsing.fontSize)
          || (paragraphFormatForFileParsing && paragraphFormatForFileParsing.fontSizePt)
          || profileForFileParsing.defaultFontSizePt
          || 0;
        var familyForFileParsing = normalizeFamilyForFileParsing(nodeForFileParsing.font)
          || (paragraphFormatForFileParsing && paragraphFormatForFileParsing.fontFamily)
          || profileForFileParsing.defaultFontFamily
          || '';
        var syntheticStyleIdForFileParsing = planForFileParsing.styleIdFor(sizePtForFileParsing, familyForFileParsing);
        if (syntheticStyleIdForFileParsing) nodeForFileParsing.styleId = syntheticStyleIdForFileParsing;
      }
      var childrenForFileParsing = nodeForFileParsing.children;
      if (!Array.isArray(childrenForFileParsing)) return;
      for (var iForFileParsing = 0; iForFileParsing < childrenForFileParsing.length; iForFileParsing++) {
        visitForFileParsing(childrenForFileParsing[iForFileParsing], nextParagraphStyleIdForFileParsing);
      }
    }
    visitForFileParsing(documentNodeForFileParsing, '');
  }

  function escapeHtmlAttributeForFileParsing(valueForFileParsing) {
    return String(valueForFileParsing == null ? '' : valueForFileParsing)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function annotateDocxStructureHtmlForFileParsing(htmlForFileParsing, profileForFileParsing, planForFileParsing) {
    var docxFormatForFileParsing = getDocxFormatForFileParsing();
    if (!docxFormatForFileParsing) return htmlForFileParsing;
    var annotatedForFileParsing = String(htmlForFileParsing || '');

    annotatedForFileParsing = annotatedForFileParsing.replace(/ class="abchat-fmt-(\d+)"/g, function (wholeForFileParsing, indexForFileParsing) {
      var cssForFileParsing = planForFileParsing ? planForFileParsing.cssByClassIndex[Number(indexForFileParsing)] : '';
      return cssForFileParsing ? ' style="' + escapeHtmlAttributeForFileParsing(cssForFileParsing) + '"' : '';
    });

    // mammoth emits one bare <table> per w:tbl in document order, which is the order the
    // table formats were collected in. A count mismatch means the two sequences cannot be
    // paired, so no table is annotated rather than annotating the wrong ones.
    var tableFormatsForFileParsing = profileForFileParsing.tables || [];
    var emittedTableCountForFileParsing = (annotatedForFileParsing.match(/<table>/g) || []).length;
    if (tableFormatsForFileParsing.length === emittedTableCountForFileParsing && emittedTableCountForFileParsing > 0) {
      var tableCursorForFileParsing = 0;
      annotatedForFileParsing = annotatedForFileParsing.replace(/<table>/g, function () {
        var tableFormatForFileParsing = tableFormatsForFileParsing[tableCursorForFileParsing];
        tableCursorForFileParsing++;
        if (!tableFormatForFileParsing) return '<table>';
        if (!tableFormatForFileParsing.bordered) return '<table border="0">';
        var borderCssForFileParsing = docxFormatForFileParsing.buildTableBorderCss(tableFormatForFileParsing);
        return borderCssForFileParsing
          ? '<table style="' + escapeHtmlAttributeForFileParsing(borderCssForFileParsing) + '">'
          : '<table>';
      });
    }

    var defaultsCssForFileParsing = docxFormatForFileParsing.buildDocumentDefaultsCss(profileForFileParsing);
    if (defaultsCssForFileParsing) {
      annotatedForFileParsing = '<div data-doc-defaults="' + escapeHtmlAttributeForFileParsing(defaultsCssForFileParsing) + '"></div>'
        + annotatedForFileParsing;
    }
    return annotatedForFileParsing;
  }

  function parseDocxStructureForFileParsing(arrayBufferForFileParsing, blobIdForFileParsing) {
    loadLibraryForFileParsing('lib/mammoth.min.js', 'mammoth');
    if (!globalScopeForFileParsing.mammoth || typeof globalScopeForFileParsing.mammoth.convertToHtml !== 'function') {
      throw new Error('DOCX structure parser is unavailable.');
    }
    var numericBlobIdForFileParsing = Number(blobIdForFileParsing);
    var canMintSentinelForFileParsing = Number.isFinite(numericBlobIdForFileParsing) && numericBlobIdForFileParsing > 0;
    var optionsForDocxStructure = {};
    // Images become small placeholder sentinels (abchat-img:<blobId>:<index>) instead of
    // base64, keeping the HTML compact while letting create_document re-embed them on a
    // docx round-trip by re-extracting bytes from this same source blob in the same order.
    // Without a usable blob id there is nothing to re-extract from, so fall back to drop.
    if (globalScopeForFileParsing.mammoth.images && typeof globalScopeForFileParsing.mammoth.images.imgElement === 'function') {
      var sentinelIndexForFileParsing = 0;
      optionsForDocxStructure.convertImage = globalScopeForFileParsing.mammoth.images.imgElement(function () {
        if (!canMintSentinelForFileParsing) return {};
        var srcForFileParsing = 'abchat-img:' + numericBlobIdForFileParsing + ':' + sentinelIndexForFileParsing;
        sentinelIndexForFileParsing++;
        return { src: srcForFileParsing };
      });
    }
    return readDocxFormatProfileForFileParsing(arrayBufferForFileParsing).then(function (profileForFileParsing) {
      var docxFormatForFileParsing = getDocxFormatForFileParsing();
      var planForFileParsing = (profileForFileParsing && docxFormatForFileParsing)
        ? docxFormatForFileParsing.buildFormatClassPlan(profileForFileParsing)
        : null;
      if (planForFileParsing && planForFileParsing.styleMap.length) {
        optionsForDocxStructure.styleMap = planForFileParsing.styleMap;
        optionsForDocxStructure.transformDocument = function (documentForDocxStructure) {
          try {
            stampRunFormatsForFileParsing(documentForDocxStructure, profileForFileParsing, planForFileParsing);
          } catch (stampErrForFileParsing) {
            // An unstamped document still converts; it just carries no size annotations.
          }
          return documentForDocxStructure;
        };
      }
      return globalScopeForFileParsing.mammoth
        .convertToHtml({ arrayBuffer: arrayBufferForFileParsing }, optionsForDocxStructure)
        .then(function (resultForFileParsing) {
          var htmlForFileParsing = String((resultForFileParsing && resultForFileParsing.value) || '')
            .replace(/<img\b(?![^>]*\babchat-img:)[^>]*>/gi, '');
          if (profileForFileParsing) {
            try {
              htmlForFileParsing = annotateDocxStructureHtmlForFileParsing(htmlForFileParsing, profileForFileParsing, planForFileParsing);
            } catch (annotateErrForFileParsing) {
              // Keep the unannotated HTML rather than failing the whole structural read.
            }
          }
          var truncatedForFileParsing = false;
          // read_document_structure hands this HTML straight to the model, so it is bounded by the
          // inline budget rather than the (much larger) storage one.
          if (htmlForFileParsing.length > MAX_INLINE_TEXT_CHARS_FOR_FILE_PARSING) {
            htmlForFileParsing = htmlForFileParsing.slice(0, MAX_INLINE_TEXT_CHARS_FOR_FILE_PARSING);
            truncatedForFileParsing = true;
          }
          return { html: htmlForFileParsing, truncated: truncatedForFileParsing };
        });
    });
  }

  // Re-extract every embedded image from a DOCX in mammoth's image-walk order, the same
  // order parseDocxStructure used when minting the abchat-img:<blobId>:<index> sentinels,
  // so index N here is the image the model saw as :N. Returns base64 + content type +
  // natural pixel size (via createImageBitmap) for each image, used by create_document to
  // embed images back into a generated docx without ever putting base64 into the model's
  // context.
  function extractDocxImagesForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/mammoth.min.js', 'mammoth');
    if (!globalScopeForFileParsing.mammoth || typeof globalScopeForFileParsing.mammoth.convertToHtml !== 'function') {
      throw new Error('DOCX structure parser is unavailable.');
    }
    if (!globalScopeForFileParsing.mammoth.images || typeof globalScopeForFileParsing.mammoth.images.imgElement !== 'function') {
      return Promise.resolve([]);
    }
    var collectedForExtract = [];
    var optionsForExtract = {
      convertImage: globalScopeForFileParsing.mammoth.images.imgElement(function (imageForExtract) {
        return imageForExtract.read('base64').then(function (base64ForExtract) {
          collectedForExtract.push({
            base64: String(base64ForExtract || ''),
            contentType: String((imageForExtract && imageForExtract.contentType) || '')
          });
          return {};
        });
      })
    };
    return globalScopeForFileParsing.mammoth
      .convertToHtml({ arrayBuffer: arrayBufferForFileParsing }, optionsForExtract)
      .then(function () {
        return Promise.all(collectedForExtract.map(function (imageForExtract) {
          return measureImageDimensionsForFileParsing(imageForExtract.base64, imageForExtract.contentType)
            .then(function (sizeForExtract) {
              return {
                base64: imageForExtract.base64,
                contentType: imageForExtract.contentType,
                width: sizeForExtract.width,
                height: sizeForExtract.height
              };
            });
        }));
      });
  }

  function measureImageDimensionsForFileParsing(base64ForMeasure, contentTypeForMeasure) {
    if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined' || !base64ForMeasure) {
      return Promise.resolve({ width: 0, height: 0 });
    }
    var bytesForMeasure;
    try {
      var binaryForMeasure = atob(base64ForMeasure);
      bytesForMeasure = new Uint8Array(binaryForMeasure.length);
      for (var iForMeasure = 0; iForMeasure < binaryForMeasure.length; iForMeasure++) {
        bytesForMeasure[iForMeasure] = binaryForMeasure.charCodeAt(iForMeasure);
      }
    } catch (decodeErrForMeasure) {
      return Promise.resolve({ width: 0, height: 0 });
    }
    return createImageBitmap(new Blob([bytesForMeasure], { type: contentTypeForMeasure || 'application/octet-stream' }))
      .then(function (bitmapForMeasure) {
        var sizeForMeasure = { width: bitmapForMeasure.width || 0, height: bitmapForMeasure.height || 0 };
        if (typeof bitmapForMeasure.close === 'function') bitmapForMeasure.close();
        return sizeForMeasure;
      })
      .catch(function () {
        return { width: 0, height: 0 };
      });
  }

  function parseSpreadsheetForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/xlsx.min.js', 'xlsx');
    if (!globalScopeForFileParsing.XLSX || typeof globalScopeForFileParsing.XLSX.read !== 'function') {
      throw new Error('Spreadsheet parser is unavailable.');
    }
    var workbookForFileParsing = globalScopeForFileParsing.XLSX.read(arrayBufferForFileParsing, { type: 'array', dense: true });
    var sheetNamesForFileParsing = Array.isArray(workbookForFileParsing.SheetNames) ? workbookForFileParsing.SheetNames : [];
    return sheetNamesForFileParsing.map(function (sheetNameForFileParsing) {
      var sheetForFileParsing = workbookForFileParsing.Sheets[sheetNameForFileParsing];
      var csvForFileParsing = globalScopeForFileParsing.XLSX.utils.sheet_to_csv(sheetForFileParsing || {}, { blankrows: false });
      return '[Sheet: ' + sheetNameForFileParsing + ']\n' + csvForFileParsing.trim();
    }).join('\n\n');
  }

  function decodeXmlEntitiesForFileParsing(xmlTextForFileParsing) {
    return String(xmlTextForFileParsing || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function parsePptxForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/jszip.min.js', 'jszip');
    if (!globalScopeForFileParsing.JSZip || typeof globalScopeForFileParsing.JSZip.loadAsync !== 'function') {
      throw new Error('PPTX parser is unavailable.');
    }
    return globalScopeForFileParsing.JSZip.loadAsync(arrayBufferForFileParsing).then(function (zipForFileParsing) {
      var slideNamesForFileParsing = Object.keys(zipForFileParsing.files || {})
        .filter(function (nameForFileParsing) {
          return /^ppt\/slides\/slide\d+\.xml$/i.test(nameForFileParsing);
        })
        .sort(function (aForFileParsing, bForFileParsing) {
          var aMatchForFileParsing = aForFileParsing.match(/slide(\d+)\.xml/i);
          var bMatchForFileParsing = bForFileParsing.match(/slide(\d+)\.xml/i);
          var aNumForFileParsing = aMatchForFileParsing ? Number(aMatchForFileParsing[1]) : 0;
          var bNumForFileParsing = bMatchForFileParsing ? Number(bMatchForFileParsing[1]) : 0;
          return aNumForFileParsing - bNumForFileParsing;
        });
      return Promise.all(slideNamesForFileParsing.map(function (slideNameForFileParsing, indexForFileParsing) {
        return zipForFileParsing.files[slideNameForFileParsing].async('string').then(function (xmlForFileParsing) {
          var textChunksForFileParsing = [];
          var matcherForFileParsing = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
          var matchForFileParsing;
          while ((matchForFileParsing = matcherForFileParsing.exec(xmlForFileParsing))) {
            textChunksForFileParsing.push(decodeXmlEntitiesForFileParsing(matchForFileParsing[1]));
          }
          return '[Slide ' + (indexForFileParsing + 1) + ']\n' + textChunksForFileParsing.join('\n').trim();
        });
      })).then(function (slidesForFileParsing) {
        return slidesForFileParsing.filter(Boolean).join('\n\n');
      });
    });
  }

  // ---- PDF text extraction ----
  //
  // pdf.js hands back one text item per drawn run, in content-stream order, each carrying its
  // own placement matrix. Concatenating the strings loses every spatial cue: line breaks vanish,
  // the two halves of a two-column page interleave, and table cells run together into prose. The
  // functions below rebuild reading order from that geometry instead: items are clustered into
  // lines by baseline, lines into blocks by vertical gap, and blocks are split at any column
  // gutter (a vertical band no item crosses) before being emitted left column first.

  // Same-line baselines rarely match exactly (superscripts, mixed font sizes), so allow a
  // fraction of the font height as slack.
  var PDF_LINE_TOLERANCE_RATIO_FOR_FILE_PARSING = 0.5;
  // Below this fraction of the font height a gap is kerning inside a word, not a space.
  var PDF_WORD_GAP_RATIO_FOR_FILE_PARSING = 0.18;
  // Above this fraction the gap is deliberate horizontal alignment (table cells, label/value
  // pairs) rather than a single space, and is preserved as run of spaces.
  var PDF_ALIGN_GAP_RATIO_FOR_FILE_PARSING = 1.1;
  var PDF_MAX_ALIGN_SPACES_FOR_FILE_PARSING = 6;
  // A line gap this much larger than the block's typical line spacing starts a new block.
  var PDF_BLOCK_GAP_RATIO_FOR_FILE_PARSING = 1.5;
  // A gutter must clear both a share of the block's horizontal span and a multiple of the font
  // height, so ordinary word spacing is never mistaken for one. Kept low because a real
  // two-column gutter is only about 12-18pt, narrower than intuition suggests; the band also has
  // to be clear on every line of the block, which is what makes a low floor safe here.
  var PDF_MIN_GUTTER_RATIO_FOR_FILE_PARSING = 0.02;
  var PDF_MIN_GUTTER_HEIGHT_RATIO_FOR_FILE_PARSING = 1;
  // ...and no wider than this share of the narrower column. Page layout keeps gutters far
  // narrower than the columns they separate, whereas a table's inter-column gap is usually as
  // wide as its cell text or wider. This ratio is what stops a two-column table, a label/value
  // list, or a table of contents with right-aligned page numbers from being torn into two
  // disconnected lists, which would destroy the row associations they exist to express.
  var PDF_MAX_GUTTER_TO_COLUMN_RATIO_FOR_FILE_PARSING = 0.5;
  // Each side must also be a substantial column in its own right, not a narrow strip.
  var PDF_MIN_COLUMN_WIDTH_RATIO_FOR_FILE_PARSING = 0.15;
  var PDF_MIN_GUTTER_COLUMN_LINES_FOR_FILE_PARSING = 6;
  var PDF_MAX_REGION_DEPTH_FOR_FILE_PARSING = 4;

  // Multiply two 2D affine matrices in pdf.js [a,b,c,d,e,f] form. Equivalent to the library's
  // own Util.transform, reimplemented here because the minified bundle does not export Util.
  function multiplyMatrixForFileParsing(outerForFileParsing, innerForFileParsing) {
    return [
      outerForFileParsing[0] * innerForFileParsing[0] + outerForFileParsing[2] * innerForFileParsing[1],
      outerForFileParsing[1] * innerForFileParsing[0] + outerForFileParsing[3] * innerForFileParsing[1],
      outerForFileParsing[0] * innerForFileParsing[2] + outerForFileParsing[2] * innerForFileParsing[3],
      outerForFileParsing[1] * innerForFileParsing[2] + outerForFileParsing[3] * innerForFileParsing[3],
      outerForFileParsing[0] * innerForFileParsing[4] + outerForFileParsing[2] * innerForFileParsing[5] + outerForFileParsing[4],
      outerForFileParsing[1] * innerForFileParsing[4] + outerForFileParsing[3] * innerForFileParsing[5] + outerForFileParsing[5]
    ];
  }

  function medianForFileParsing(valuesForFileParsing) {
    if (!valuesForFileParsing.length) return 0;
    var sortedForFileParsing = valuesForFileParsing.slice().sort(function (aForFileParsing, bForFileParsing) {
      return aForFileParsing - bForFileParsing;
    });
    var midForFileParsing = Math.floor(sortedForFileParsing.length / 2);
    if (sortedForFileParsing.length % 2) return sortedForFileParsing[midForFileParsing];
    return (sortedForFileParsing[midForFileParsing - 1] + sortedForFileParsing[midForFileParsing]) / 2;
  }

  // Convert pdf.js text items into viewport-space boxes. Composing each item's matrix with the
  // viewport transform normalizes page rotation and flips the axis so y grows downward, which
  // makes "sort by y then x" the visual reading order for upright text.
  function buildPdfItemsForFileParsing(textContentForFileParsing, viewportTransformForFileParsing) {
    var rawItemsForFileParsing = (textContentForFileParsing && Array.isArray(textContentForFileParsing.items))
      ? textContentForFileParsing.items
      : [];
    var itemsForFileParsing = [];
    for (var iForFileParsing = 0; iForFileParsing < rawItemsForFileParsing.length; iForFileParsing++) {
      var rawForFileParsing = rawItemsForFileParsing[iForFileParsing];
      if (!rawForFileParsing || typeof rawForFileParsing.str !== 'string') continue;
      if (!rawForFileParsing.str.trim()) continue;
      if (!Array.isArray(rawForFileParsing.transform) || rawForFileParsing.transform.length < 6) continue;
      var matrixForFileParsing = multiplyMatrixForFileParsing(viewportTransformForFileParsing, rawForFileParsing.transform);
      var xForFileParsing = matrixForFileParsing[4];
      var yForFileParsing = matrixForFileParsing[5];
      if (!Number.isFinite(xForFileParsing) || !Number.isFinite(yForFileParsing)) continue;
      var heightForFileParsing = Math.hypot(matrixForFileParsing[2], matrixForFileParsing[3]);
      if (!Number.isFinite(heightForFileParsing) || heightForFileParsing <= 0) {
        heightForFileParsing = Math.abs(matrixForFileParsing[3]) || 1;
      }
      var widthForFileParsing = Number(rawForFileParsing.width);
      if (!Number.isFinite(widthForFileParsing) || widthForFileParsing < 0) widthForFileParsing = 0;
      itemsForFileParsing.push({
        str: rawForFileParsing.str,
        x: xForFileParsing,
        y: yForFileParsing,
        end: xForFileParsing + widthForFileParsing,
        height: heightForFileParsing
      });
    }
    return itemsForFileParsing;
  }

  function buildPdfLinesForFileParsing(itemsForFileParsing) {
    var sortedForFileParsing = itemsForFileParsing.slice().sort(function (aForFileParsing, bForFileParsing) {
      if (aForFileParsing.y !== bForFileParsing.y) return aForFileParsing.y - bForFileParsing.y;
      return aForFileParsing.x - bForFileParsing.x;
    });
    var linesForFileParsing = [];
    var currentForFileParsing = null;
    for (var iForFileParsing = 0; iForFileParsing < sortedForFileParsing.length; iForFileParsing++) {
      var itemForFileParsing = sortedForFileParsing[iForFileParsing];
      var toleranceForFileParsing = PDF_LINE_TOLERANCE_RATIO_FOR_FILE_PARSING
        * Math.max(itemForFileParsing.height, currentForFileParsing ? currentForFileParsing.height : 0);
      if (currentForFileParsing && Math.abs(itemForFileParsing.y - currentForFileParsing.y) <= Math.max(1, toleranceForFileParsing)) {
        currentForFileParsing.items.push(itemForFileParsing);
        if (itemForFileParsing.height > currentForFileParsing.height) {
          currentForFileParsing.height = itemForFileParsing.height;
        }
      } else {
        currentForFileParsing = { y: itemForFileParsing.y, height: itemForFileParsing.height, items: [itemForFileParsing] };
        linesForFileParsing.push(currentForFileParsing);
      }
    }
    for (var jForFileParsing = 0; jForFileParsing < linesForFileParsing.length; jForFileParsing++) {
      linesForFileParsing[jForFileParsing].items.sort(function (aForFileParsing, bForFileParsing) {
        return aForFileParsing.x - bForFileParsing.x;
      });
    }
    return linesForFileParsing;
  }

  function renderPdfLineForFileParsing(lineForFileParsing) {
    var partsForFileParsing = [];
    var previousEndForFileParsing = null;
    var itemsForFileParsing = lineForFileParsing.items;
    for (var iForFileParsing = 0; iForFileParsing < itemsForFileParsing.length; iForFileParsing++) {
      var itemForFileParsing = itemsForFileParsing[iForFileParsing];
      if (previousEndForFileParsing !== null) {
        var gapForFileParsing = itemForFileParsing.x - previousEndForFileParsing;
        var unitForFileParsing = Math.max(1, itemForFileParsing.height);
        var alreadySpacedForFileParsing = /\s$/.test(partsForFileParsing[partsForFileParsing.length - 1] || '')
          || /^\s/.test(itemForFileParsing.str);
        if (gapForFileParsing >= PDF_ALIGN_GAP_RATIO_FOR_FILE_PARSING * unitForFileParsing) {
          var spaceCountForFileParsing = Math.min(
            PDF_MAX_ALIGN_SPACES_FOR_FILE_PARSING,
            Math.max(2, Math.round(gapForFileParsing / (unitForFileParsing * 0.5)))
          );
          partsForFileParsing.push(new Array(spaceCountForFileParsing + 1).join(' '));
        } else if (gapForFileParsing >= PDF_WORD_GAP_RATIO_FOR_FILE_PARSING * unitForFileParsing && !alreadySpacedForFileParsing) {
          partsForFileParsing.push(' ');
        }
      }
      partsForFileParsing.push(itemForFileParsing.str);
      previousEndForFileParsing = itemForFileParsing.end;
    }
    return partsForFileParsing.join('').replace(/\s+$/, '').replace(/^\s+/, '');
  }

  // Split a run of lines wherever the vertical gap jumps well above the run's own typical line
  // spacing. Those breaks are paragraph and section boundaries, and they are also what separates
  // a full-width heading from the columned body below it, which is what lets gutter detection
  // work on the body alone.
  function splitLinesIntoBlocksForFileParsing(linesForFileParsing) {
    if (linesForFileParsing.length < 2) return [linesForFileParsing];
    var gapsForFileParsing = [];
    for (var iForFileParsing = 1; iForFileParsing < linesForFileParsing.length; iForFileParsing++) {
      gapsForFileParsing.push(linesForFileParsing[iForFileParsing].y - linesForFileParsing[iForFileParsing - 1].y);
    }
    var medianGapForFileParsing = medianForFileParsing(gapsForFileParsing);
    if (!Number.isFinite(medianGapForFileParsing) || medianGapForFileParsing <= 0) {
      return [linesForFileParsing];
    }
    var thresholdForFileParsing = medianGapForFileParsing * PDF_BLOCK_GAP_RATIO_FOR_FILE_PARSING;
    var blocksForFileParsing = [];
    var currentForFileParsing = [linesForFileParsing[0]];
    for (var jForFileParsing = 1; jForFileParsing < linesForFileParsing.length; jForFileParsing++) {
      if ((linesForFileParsing[jForFileParsing].y - linesForFileParsing[jForFileParsing - 1].y) > thresholdForFileParsing) {
        blocksForFileParsing.push(currentForFileParsing);
        currentForFileParsing = [];
      }
      currentForFileParsing.push(linesForFileParsing[jForFileParsing]);
    }
    blocksForFileParsing.push(currentForFileParsing);
    return blocksForFileParsing;
  }

  // Find the widest vertical band that no item overlaps, then decide whether it is a real column
  // gutter. Sweeping the item x-intervals means a candidate band is uncovered by construction, so
  // anything spanning the columns (a rule, a wide heading) suppresses detection for that block
  // rather than producing a bad split. Returns { start, end } only when every guard passes;
  // otherwise null, and the block is emitted as ordinary lines with alignment spacing intact.
  function findColumnGutterForFileParsing(blockLinesForFileParsing) {
    if (blockLinesForFileParsing.length < PDF_MIN_GUTTER_COLUMN_LINES_FOR_FILE_PARSING) return null;

    var itemsForFileParsing = [];
    for (var lForFileParsing = 0; lForFileParsing < blockLinesForFileParsing.length; lForFileParsing++) {
      itemsForFileParsing = itemsForFileParsing.concat(blockLinesForFileParsing[lForFileParsing].items);
    }
    if (itemsForFileParsing.length < 8) return null;

    var intervalsForFileParsing = itemsForFileParsing.map(function (itemForFileParsing) {
      return [itemForFileParsing.x, Math.max(itemForFileParsing.end, itemForFileParsing.x)];
    }).sort(function (aForFileParsing, bForFileParsing) { return aForFileParsing[0] - bForFileParsing[0]; });

    var spanStartForFileParsing = intervalsForFileParsing[0][0];
    var spanEndForFileParsing = intervalsForFileParsing[0][1];
    var cursorForFileParsing = intervalsForFileParsing[0][1];
    var bestForFileParsing = null;
    for (var iForFileParsing = 1; iForFileParsing < intervalsForFileParsing.length; iForFileParsing++) {
      var intervalForFileParsing = intervalsForFileParsing[iForFileParsing];
      if (intervalForFileParsing[0] > cursorForFileParsing) {
        var widthForFileParsing = intervalForFileParsing[0] - cursorForFileParsing;
        if (!bestForFileParsing || widthForFileParsing > bestForFileParsing.width) {
          bestForFileParsing = { start: cursorForFileParsing, end: intervalForFileParsing[0], width: widthForFileParsing };
        }
      }
      if (intervalForFileParsing[1] > cursorForFileParsing) cursorForFileParsing = intervalForFileParsing[1];
      if (intervalForFileParsing[1] > spanEndForFileParsing) spanEndForFileParsing = intervalForFileParsing[1];
    }
    if (!bestForFileParsing) return null;

    var spanForFileParsing = spanEndForFileParsing - spanStartForFileParsing;
    if (spanForFileParsing <= 0) return null;

    var medianHeightForFileParsing = medianForFileParsing(itemsForFileParsing.map(function (itemForFileParsing) {
      return itemForFileParsing.height;
    }));
    if (bestForFileParsing.width < Math.max(
      PDF_MIN_GUTTER_RATIO_FOR_FILE_PARSING * spanForFileParsing,
      medianHeightForFileParsing * PDF_MIN_GUTTER_HEIGHT_RATIO_FOR_FILE_PARSING
    )) {
      return null;
    }

    var leftWidthForFileParsing = bestForFileParsing.start - spanStartForFileParsing;
    var rightWidthForFileParsing = spanEndForFileParsing - bestForFileParsing.end;
    var narrowerColumnForFileParsing = Math.min(leftWidthForFileParsing, rightWidthForFileParsing);
    if (narrowerColumnForFileParsing < PDF_MIN_COLUMN_WIDTH_RATIO_FOR_FILE_PARSING * spanForFileParsing) return null;
    if (bestForFileParsing.width > PDF_MAX_GUTTER_TO_COLUMN_RATIO_FOR_FILE_PARSING * narrowerColumnForFileParsing) return null;

    return bestForFileParsing;
  }

  function renderPdfRegionForFileParsing(itemsForFileParsing, depthForFileParsing) {
    var linesForFileParsing = buildPdfLinesForFileParsing(itemsForFileParsing);
    if (!linesForFileParsing.length) return '';
    var blocksForFileParsing = splitLinesIntoBlocksForFileParsing(linesForFileParsing);
    var renderedForFileParsing = [];

    for (var iForFileParsing = 0; iForFileParsing < blocksForFileParsing.length; iForFileParsing++) {
      var blockLinesForFileParsing = blocksForFileParsing[iForFileParsing];
      var gutterForFileParsing = depthForFileParsing < PDF_MAX_REGION_DEPTH_FOR_FILE_PARSING
        ? findColumnGutterForFileParsing(blockLinesForFileParsing)
        : null;

      if (gutterForFileParsing) {
        var leftItemsForFileParsing = [];
        var rightItemsForFileParsing = [];
        for (var jForFileParsing = 0; jForFileParsing < blockLinesForFileParsing.length; jForFileParsing++) {
          var lineItemsForFileParsing = blockLinesForFileParsing[jForFileParsing].items;
          for (var kForFileParsing = 0; kForFileParsing < lineItemsForFileParsing.length; kForFileParsing++) {
            var itemForFileParsing = lineItemsForFileParsing[kForFileParsing];
            if (itemForFileParsing.x >= gutterForFileParsing.end) {
              rightItemsForFileParsing.push(itemForFileParsing);
            } else {
              leftItemsForFileParsing.push(itemForFileParsing);
            }
          }
        }
        // Each side must stand on its own as a column of text; a split that leaves one side
        // with only a line or two was alignment inside a single column, not a page gutter.
        if (buildPdfLinesForFileParsing(leftItemsForFileParsing).length >= PDF_MIN_GUTTER_COLUMN_LINES_FOR_FILE_PARSING
          && buildPdfLinesForFileParsing(rightItemsForFileParsing).length >= PDF_MIN_GUTTER_COLUMN_LINES_FOR_FILE_PARSING) {
          var columnsForFileParsing = [
            renderPdfRegionForFileParsing(leftItemsForFileParsing, depthForFileParsing + 1),
            renderPdfRegionForFileParsing(rightItemsForFileParsing, depthForFileParsing + 1)
          ].filter(Boolean);
          if (columnsForFileParsing.length) renderedForFileParsing.push(columnsForFileParsing.join('\n\n'));
          continue;
        }
      }

      var blockTextForFileParsing = blockLinesForFileParsing
        .map(renderPdfLineForFileParsing)
        .filter(function (lineTextForFileParsing) { return lineTextForFileParsing !== ''; })
        .join('\n');
      if (blockTextForFileParsing) renderedForFileParsing.push(blockTextForFileParsing);
    }

    return renderedForFileParsing.join('\n\n');
  }

  function ensurePdfLibraryForFileParsing() {
    loadLibraryForFileParsing('lib/pdf.min.js', 'pdfjs');
    if (!globalScopeForFileParsing.pdfjsLib || typeof globalScopeForFileParsing.pdfjsLib.getDocument !== 'function') {
      throw new Error('PDF parser is unavailable.');
    }
    if (!globalScopeForFileParsing.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      globalScopeForFileParsing.pdfjsLib.GlobalWorkerOptions.workerSrc =
        chrome.runtime.getURL('lib/pdf.worker.min.js');
    }
    return globalScopeForFileParsing.pdfjsLib;
  }

  // Returns one entry per page: { page, text }. Pages are processed and released one at a time
  // because the service worker runs pdf.js in fake-worker mode, where holding every page's
  // operator list at once is the memory-heavy path.
  function parsePdfPagesForFileParsing(arrayBufferForFileParsing) {
    var pdfjsLibForFileParsing = ensurePdfLibraryForFileParsing();
    // pdf.js wraps the buffer it is handed in a view and transfers that view to its worker, which
    // detaches the caller's ArrayBuffer: after parsing, the original reads as zero bytes. Give it
    // a private copy so callers keep their own bytes, which the attachment path relies on to
    // re-render pages that yielded no text.
    var sourceBytesForFileParsing = new Uint8Array(
      ensureArrayBufferForFileParsing(arrayBufferForFileParsing).slice(0)
    );
    return pdfjsLibForFileParsing.getDocument({ data: sourceBytesForFileParsing }).promise.then(function (pdfForFileParsing) {
      var pagesForFileParsing = [];

      function readNextPageForFileParsing(pageNumberForFileParsing) {
        if (pageNumberForFileParsing > pdfForFileParsing.numPages) return Promise.resolve(pagesForFileParsing);
        return pdfForFileParsing.getPage(pageNumberForFileParsing).then(function (pageForFileParsing) {
          var viewportForFileParsing = pageForFileParsing.getViewport({ scale: 1 });
          return pageForFileParsing.getTextContent().then(function (textContentForFileParsing) {
            var itemsForFileParsing = buildPdfItemsForFileParsing(textContentForFileParsing, viewportForFileParsing.transform);
            pagesForFileParsing.push({
              page: pageNumberForFileParsing,
              text: renderPdfRegionForFileParsing(itemsForFileParsing, 0)
            });
            if (typeof pageForFileParsing.cleanup === 'function') pageForFileParsing.cleanup();
            return readNextPageForFileParsing(pageNumberForFileParsing + 1);
          });
        });
      }

      return readNextPageForFileParsing(1);
    });
  }

  function joinPdfPagesForFileParsing(pagesForFileParsing) {
    return pagesForFileParsing.map(function (pageForFileParsing) {
      return '[Page ' + pageForFileParsing.page + ']\n' + String(pageForFileParsing.text || '');
    }).join('\n\n');
  }

  function parsePdfForFileParsing(arrayBufferForFileParsing) {
    return parsePdfPagesForFileParsing(arrayBufferForFileParsing).then(joinPdfPagesForFileParsing);
  }

  function parseFileBufferForFileParsing(fileNameForFileParsing, mimeTypeForFileParsing, bufferForFileParsing, optionsForFileParsing) {
    var settingsForFileParsing = optionsForFileParsing || {};
    var arrayBufferForFileParsing = ensureArrayBufferForFileParsing(bufferForFileParsing);
    var formatForFileParsing = inferFormatForFileParsing(fileNameForFileParsing, mimeTypeForFileParsing);
    var parserResultForFileParsing;
    if (formatForFileParsing === 'text') {
      parserResultForFileParsing = parseTextForFileParsing(arrayBufferForFileParsing);
    } else if (formatForFileParsing === 'csv') {
      parserResultForFileParsing = parseCsvForFileParsing(arrayBufferForFileParsing);
    } else if (formatForFileParsing === 'docx') {
      parserResultForFileParsing = parseDocxForFileParsing(arrayBufferForFileParsing);
    } else if (formatForFileParsing === 'spreadsheet') {
      parserResultForFileParsing = parseSpreadsheetForFileParsing(arrayBufferForFileParsing);
    } else if (formatForFileParsing === 'pptx') {
      parserResultForFileParsing = parsePptxForFileParsing(arrayBufferForFileParsing);
    } else if (formatForFileParsing === 'pdf') {
      parserResultForFileParsing = parsePdfForFileParsing(arrayBufferForFileParsing);
    } else {
      return Promise.reject(new Error('Unsupported file format.'));
    }
    return Promise.resolve(parserResultForFileParsing).then(function (rawTextForFileParsing) {
      var normalizedForFileParsing = normalizeTextForFileParsing(rawTextForFileParsing, settingsForFileParsing.maxChars);
      return {
        text: normalizedForFileParsing.text,
        truncated: normalizedForFileParsing.truncated,
        truncationNote: normalizedForFileParsing.note,
        totalChars: normalizedForFileParsing.totalChars,
        format: formatForFileParsing
      };
    });
  }

  agentNamespaceForFileParsing.fileParsing = {
    parseFileBuffer: parseFileBufferForFileParsing,
    parseDocxStructure: parseDocxStructureForFileParsing,
    extractDocxImages: extractDocxImagesForFileParsing,
    // Page-level PDF access for callers that need to act on individual pages before the text is
    // joined and capped (the attachment path substitutes transcriptions for pages that yielded
    // no extractable text). parseFileBuffer stays the entry point for everything else.
    parsePdfPages: parsePdfPagesForFileParsing,
    joinPdfPages: joinPdfPagesForFileParsing,
    normalizeParsedText: normalizeTextForFileParsing,
    buildInlineExcerpt: buildInlineExcerptForFileParsing,
    maxStoredTextChars: MAX_STORED_TEXT_CHARS_FOR_FILE_PARSING,
    maxInlineTextChars: MAX_INLINE_TEXT_CHARS_FOR_FILE_PARSING
  };

  globalScopeForFileParsing.ABChatAgent = agentNamespaceForFileParsing;
})();
