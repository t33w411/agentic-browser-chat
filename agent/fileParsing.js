(function () {
  var globalScopeForFileParsing = globalThis;
  var agentNamespaceForFileParsing = globalScopeForFileParsing.ABChatAgent || {};
  var loadedLibrariesForFileParsing = {};
  var MAX_PARSED_TEXT_CHARS_FOR_FILE_PARSING = 200000;
  var ALLOW_PARSED_TEXT_TRUNCATION_FOR_FILE_PARSING = false;
  var PARSED_TEXT_TOO_LARGE_MESSAGE_FOR_FILE_PARSING = 'This file contains too much text to upload. Please upload a smaller file or split it into parts.';

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

  function normalizeTextForFileParsing(rawTextForFileParsing) {
    var normalizedForFileParsing = String(rawTextForFileParsing || '').replace(/\r\n/g, '\n').trim();
    var wasTruncatedForFileParsing = false;
    if (normalizedForFileParsing.length > MAX_PARSED_TEXT_CHARS_FOR_FILE_PARSING) {
      if (!ALLOW_PARSED_TEXT_TRUNCATION_FOR_FILE_PARSING) {
        throw new Error(PARSED_TEXT_TOO_LARGE_MESSAGE_FOR_FILE_PARSING);
      }
      var limitForFileParsing = MAX_PARSED_TEXT_CHARS_FOR_FILE_PARSING;
      var searchWindowForFileParsing = Math.max(1000, Math.floor(limitForFileParsing * 0.05));
      var searchFromForFileParsing = limitForFileParsing - searchWindowForFileParsing;
      var cutForFileParsing = limitForFileParsing;

      var ppIndexForFileParsing = normalizedForFileParsing.lastIndexOf('\n\n', limitForFileParsing);
      if (ppIndexForFileParsing >= searchFromForFileParsing) {
        cutForFileParsing = ppIndexForFileParsing;
      } else {
        var sentenceMarkersForFileParsing = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
        var bestSentenceCutForFileParsing = -1;
        for (var smiForFileParsing = 0; smiForFileParsing < sentenceMarkersForFileParsing.length; smiForFileParsing++) {
          var markerForFileParsing = sentenceMarkersForFileParsing[smiForFileParsing];
          var markerIdxForFileParsing = normalizedForFileParsing.lastIndexOf(markerForFileParsing, limitForFileParsing - 1);
          if (markerIdxForFileParsing >= searchFromForFileParsing) {
            var candidateForFileParsing = markerIdxForFileParsing + 1;
            if (candidateForFileParsing > bestSentenceCutForFileParsing) {
              bestSentenceCutForFileParsing = candidateForFileParsing;
            }
          }
        }
        if (bestSentenceCutForFileParsing >= searchFromForFileParsing) {
          cutForFileParsing = bestSentenceCutForFileParsing;
        }
      }

      normalizedForFileParsing = normalizedForFileParsing.slice(0, cutForFileParsing).trimEnd()
        + '\n\n[Document truncated for brevity. Work only with the content provided above.]';
      wasTruncatedForFileParsing = true;
    }
    return {
      text: normalizedForFileParsing,
      truncated: wasTruncatedForFileParsing
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
    return globalScopeForFileParsing.mammoth
      .convertToHtml({ arrayBuffer: arrayBufferForFileParsing }, optionsForDocxStructure)
      .then(function (resultForFileParsing) {
        var htmlForFileParsing = String((resultForFileParsing && resultForFileParsing.value) || '')
          .replace(/<img\b(?![^>]*\babchat-img:)[^>]*>/gi, '');
        var truncatedForFileParsing = false;
        if (htmlForFileParsing.length > MAX_PARSED_TEXT_CHARS_FOR_FILE_PARSING) {
          htmlForFileParsing = htmlForFileParsing.slice(0, MAX_PARSED_TEXT_CHARS_FOR_FILE_PARSING);
          truncatedForFileParsing = true;
        }
        return { html: htmlForFileParsing, truncated: truncatedForFileParsing };
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

  function parsePdfForFileParsing(arrayBufferForFileParsing) {
    loadLibraryForFileParsing('lib/pdf.min.js', 'pdfjs');
    if (!globalScopeForFileParsing.pdfjsLib || typeof globalScopeForFileParsing.pdfjsLib.getDocument !== 'function') {
      throw new Error('PDF parser is unavailable.');
    }
    if (!globalScopeForFileParsing.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      globalScopeForFileParsing.pdfjsLib.GlobalWorkerOptions.workerSrc =
        chrome.runtime.getURL('lib/pdf.worker.min.js');
    }
    return globalScopeForFileParsing.pdfjsLib.getDocument({
      data: arrayBufferForFileParsing
    }).promise.then(function (pdfForFileParsing) {
      var pagePromisesForFileParsing = [];
      for (var pageNumberForFileParsing = 1; pageNumberForFileParsing <= pdfForFileParsing.numPages; pageNumberForFileParsing++) {
        (function (pageIndexForFileParsing) {
          pagePromisesForFileParsing.push(
            pdfForFileParsing.getPage(pageIndexForFileParsing).then(function (pageForFileParsing) {
              return pageForFileParsing.getTextContent().then(function (textContentForFileParsing) {
                var itemsForFileParsing = Array.isArray(textContentForFileParsing.items) ? textContentForFileParsing.items : [];
                var textForPageForFileParsing = itemsForFileParsing
                  .map(function (itemForFileParsing) { return String((itemForFileParsing && itemForFileParsing.str) || ''); })
                  .join(' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                return '[Page ' + pageIndexForFileParsing + ']\n' + textForPageForFileParsing;
              });
            })
          );
        })(pageNumberForFileParsing);
      }
      return Promise.all(pagePromisesForFileParsing).then(function (pagesForFileParsing) {
        return pagesForFileParsing.join('\n\n');
      });
    });
  }

  function parseFileBufferForFileParsing(fileNameForFileParsing, mimeTypeForFileParsing, bufferForFileParsing) {
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
      var normalizedForFileParsing = normalizeTextForFileParsing(rawTextForFileParsing);
      return {
        text: normalizedForFileParsing.text,
        truncated: normalizedForFileParsing.truncated,
        format: formatForFileParsing
      };
    });
  }

  agentNamespaceForFileParsing.fileParsing = {
    parseFileBuffer: parseFileBufferForFileParsing,
    parseDocxStructure: parseDocxStructureForFileParsing,
    extractDocxImages: extractDocxImagesForFileParsing
  };

  globalScopeForFileParsing.ABChatAgent = agentNamespaceForFileParsing;
})();
