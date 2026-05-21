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
    parseFileBuffer: parseFileBufferForFileParsing
  };

  globalScopeForFileParsing.ABChatAgent = agentNamespaceForFileParsing;
})();
