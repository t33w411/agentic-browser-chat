(function () {
  var globalScopeForDocumentGeneration = globalThis;
  var agentNamespaceForDocumentGeneration = globalScopeForDocumentGeneration.ABChatAgent || {};

  var DOCX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var XLSX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var PDF_MIME_FOR_DOCUMENT_GENERATION = 'application/pdf';
  var PPTX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  var CSV_MIME_FOR_DOCUMENT_GENERATION = 'text/csv;charset=utf-8';
  var MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION = 500;
  var MAX_PDF_LINES_FOR_DOCUMENT_GENERATION = 2000;
  var MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION = 100;
  var MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION = 5000;
  var MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION = 100;
  var MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION = 10000;

  function escapeXmlForDocumentGeneration(valueForDocumentGeneration) {
    return String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function sanitizeSheetNameForDocumentGeneration(nameForDocumentGeneration, fallbackForDocumentGeneration) {
    var rawForDocumentGeneration = String(nameForDocumentGeneration || fallbackForDocumentGeneration || 'Sheet1').trim();
    var cleanForDocumentGeneration = rawForDocumentGeneration.replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanForDocumentGeneration) cleanForDocumentGeneration = String(fallbackForDocumentGeneration || 'Sheet1');
    return cleanForDocumentGeneration.slice(0, 31);
  }

  function normalizeFilenameForDocumentGeneration(filenameForDocumentGeneration, formatForDocumentGeneration, titleForDocumentGeneration) {
    var extensionForDocumentGeneration = formatForDocumentGeneration === 'docx'
      ? 'docx'
      : (formatForDocumentGeneration === 'xlsx' ? 'xlsx' : (formatForDocumentGeneration === 'pptx' ? 'pptx' : (formatForDocumentGeneration === 'csv' ? 'csv' : 'pdf')));
    var baseForDocumentGeneration = String(filenameForDocumentGeneration || titleForDocumentGeneration || ('generated-document.' + extensionForDocumentGeneration)).trim();
    if (!baseForDocumentGeneration) baseForDocumentGeneration = 'generated-document.' + extensionForDocumentGeneration;
    baseForDocumentGeneration = baseForDocumentGeneration.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim();
    if (baseForDocumentGeneration.toLowerCase().slice(-(extensionForDocumentGeneration.length + 1)) !== '.' + extensionForDocumentGeneration) {
      baseForDocumentGeneration += '.' + extensionForDocumentGeneration;
    }
    return baseForDocumentGeneration;
  }

  function uint8ToDataUrlForDocumentGeneration(uint8ForDocumentGeneration, mimeTypeForDocumentGeneration) {
    var binaryForDocumentGeneration = '';
    var chunkSizeForDocumentGeneration = 0x8000;
    for (var iForDocumentGeneration = 0; iForDocumentGeneration < uint8ForDocumentGeneration.length; iForDocumentGeneration += chunkSizeForDocumentGeneration) {
      var chunkForDocumentGeneration = uint8ForDocumentGeneration.subarray(iForDocumentGeneration, iForDocumentGeneration + chunkSizeForDocumentGeneration);
      binaryForDocumentGeneration += String.fromCharCode.apply(null, chunkForDocumentGeneration);
    }
    return 'data:' + mimeTypeForDocumentGeneration + ';base64,' + btoa(binaryForDocumentGeneration);
  }

  function arrayBufferToDataUrlForDocumentGeneration(bufferForDocumentGeneration, mimeTypeForDocumentGeneration) {
    return uint8ToDataUrlForDocumentGeneration(new Uint8Array(bufferForDocumentGeneration), mimeTypeForDocumentGeneration);
  }

  function normalizeCellForDocumentGeneration(cellForDocumentGeneration) {
    if (cellForDocumentGeneration == null) return '';
    if (typeof cellForDocumentGeneration === 'number' || typeof cellForDocumentGeneration === 'boolean') {
      return cellForDocumentGeneration;
    }
    var textForDocumentGeneration = String(cellForDocumentGeneration);
    if (textForDocumentGeneration.length > MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION) {
      return textForDocumentGeneration.slice(0, MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION);
    }
    return textForDocumentGeneration;
  }

  function normalizeRowsForDocumentGeneration(rowsForDocumentGeneration) {
    if (!Array.isArray(rowsForDocumentGeneration)) return [];
    return rowsForDocumentGeneration.slice(0, MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION).map(function (rowForDocumentGeneration) {
      if (!Array.isArray(rowForDocumentGeneration)) {
        return [normalizeCellForDocumentGeneration(rowForDocumentGeneration)];
      }
      return rowForDocumentGeneration.slice(0, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION).map(normalizeCellForDocumentGeneration);
    });
  }

  function rowsFromContentForDocumentGeneration(contentForDocumentGeneration) {
    var linesForDocumentGeneration = String(contentForDocumentGeneration || '').split(/\r?\n/);
    return linesForDocumentGeneration.map(function (lineForDocumentGeneration) {
      if (lineForDocumentGeneration.indexOf('\t') !== -1) return lineForDocumentGeneration.split('\t');
      if (lineForDocumentGeneration.indexOf(',') !== -1) return lineForDocumentGeneration.split(',');
      return [lineForDocumentGeneration];
    });
  }

  function buildXlsxForDocumentGeneration(inputForDocumentGeneration) {
    if (!globalScopeForDocumentGeneration.XLSX || !globalScopeForDocumentGeneration.XLSX.utils || typeof globalScopeForDocumentGeneration.XLSX.write !== 'function') {
      throw new Error('XLSX generator is unavailable.');
    }

    var sheetsForDocumentGeneration = Array.isArray(inputForDocumentGeneration.sheets)
      ? inputForDocumentGeneration.sheets
      : [];
    if (sheetsForDocumentGeneration.length === 0 && typeof inputForDocumentGeneration.content === 'string' && inputForDocumentGeneration.content.trim()) {
      sheetsForDocumentGeneration = [{ name: 'Sheet1', rows: rowsFromContentForDocumentGeneration(inputForDocumentGeneration.content) }];
    }
    if (sheetsForDocumentGeneration.length === 0) {
      throw new Error('XLSX creation requires sheets or content.');
    }

    var workbookForDocumentGeneration = globalScopeForDocumentGeneration.XLSX.utils.book_new();
    sheetsForDocumentGeneration.slice(0, 20).forEach(function (sheetForDocumentGeneration, indexForDocumentGeneration) {
      var rowsForDocumentGeneration = normalizeRowsForDocumentGeneration(sheetForDocumentGeneration && sheetForDocumentGeneration.rows);
      if (rowsForDocumentGeneration.length === 0) rowsForDocumentGeneration = [['']];
      var worksheetForDocumentGeneration = globalScopeForDocumentGeneration.XLSX.utils.aoa_to_sheet(rowsForDocumentGeneration);
      var sheetNameForDocumentGeneration = sanitizeSheetNameForDocumentGeneration(
        sheetForDocumentGeneration && sheetForDocumentGeneration.name,
        'Sheet' + (indexForDocumentGeneration + 1)
      );
      globalScopeForDocumentGeneration.XLSX.utils.book_append_sheet(workbookForDocumentGeneration, worksheetForDocumentGeneration, sheetNameForDocumentGeneration);
    });

    var outputForDocumentGeneration = globalScopeForDocumentGeneration.XLSX.write(workbookForDocumentGeneration, {
      bookType: 'xlsx',
      type: 'array'
    });
    return {
      mimeType: XLSX_MIME_FOR_DOCUMENT_GENERATION,
      dataUrl: arrayBufferToDataUrlForDocumentGeneration(outputForDocumentGeneration, XLSX_MIME_FOR_DOCUMENT_GENERATION),
      size: outputForDocumentGeneration.byteLength || outputForDocumentGeneration.length || 0
    };
  }

  function csvEscapeCellForDocumentGeneration(valueForDocumentGeneration) {
    var textForDocumentGeneration = String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration);
    if (/[",\r\n]/.test(textForDocumentGeneration)) {
      return '"' + textForDocumentGeneration.replace(/"/g, '""') + '"';
    }
    return textForDocumentGeneration;
  }

  function buildCsvForDocumentGeneration(inputForDocumentGeneration) {
    var rowsForDocumentGeneration = [];
    if (Array.isArray(inputForDocumentGeneration.sheets) && inputForDocumentGeneration.sheets.length > 0) {
      rowsForDocumentGeneration = normalizeRowsForDocumentGeneration(inputForDocumentGeneration.sheets[0] && inputForDocumentGeneration.sheets[0].rows);
    } else if (Array.isArray(inputForDocumentGeneration.rows)) {
      rowsForDocumentGeneration = normalizeRowsForDocumentGeneration(inputForDocumentGeneration.rows);
    } else if (typeof inputForDocumentGeneration.content === 'string' && inputForDocumentGeneration.content.trim()) {
      rowsForDocumentGeneration = normalizeRowsForDocumentGeneration(rowsFromContentForDocumentGeneration(inputForDocumentGeneration.content));
    }
    if (rowsForDocumentGeneration.length === 0) {
      throw new Error('CSV creation requires rows, sheets, or content.');
    }
    var csvTextForDocumentGeneration = rowsForDocumentGeneration.map(function (rowForDocumentGeneration) {
      return rowForDocumentGeneration.map(csvEscapeCellForDocumentGeneration).join(',');
    }).join('\r\n') + '\r\n';
    var uint8ForCsv = new TextEncoder().encode(csvTextForDocumentGeneration);
    return {
      mimeType: CSV_MIME_FOR_DOCUMENT_GENERATION,
      dataUrl: uint8ToDataUrlForDocumentGeneration(uint8ForCsv, CSV_MIME_FOR_DOCUMENT_GENERATION),
      size: uint8ForCsv.length
    };
  }

  function docxParagraphForDocumentGeneration(textForDocumentGeneration, optionsForDocumentGeneration) {
    var optsForDocumentGeneration = optionsForDocumentGeneration || {};
    var paragraphPropsForDocumentGeneration = '';
    if (optsForDocumentGeneration.headingLevel) {
      var headingSizeForDocumentGeneration = optsForDocumentGeneration.headingLevel === 1 ? '32' : (optsForDocumentGeneration.headingLevel === 2 ? '28' : '24');
      paragraphPropsForDocumentGeneration = '<w:pPr><w:spacing w:after="160"/><w:rPr><w:b/><w:sz w:val="' + headingSizeForDocumentGeneration + '"/></w:rPr></w:pPr>';
    }
    var linesForDocumentGeneration = String(textForDocumentGeneration == null ? '' : textForDocumentGeneration).split(/\r?\n/);
    var runXmlForDocumentGeneration = linesForDocumentGeneration.map(function (lineForDocumentGeneration, indexForDocumentGeneration) {
      var breakForDocumentGeneration = indexForDocumentGeneration > 0 ? '<w:br/>' : '';
      return breakForDocumentGeneration + '<w:t xml:space="preserve">' + escapeXmlForDocumentGeneration(lineForDocumentGeneration) + '</w:t>';
    }).join('');
    return '<w:p>' + paragraphPropsForDocumentGeneration + '<w:r>' + runXmlForDocumentGeneration + '</w:r></w:p>';
  }

  function docxTableForDocumentGeneration(rowsForDocumentGeneration) {
    var normalizedRowsForDocumentGeneration = normalizeRowsForDocumentGeneration(rowsForDocumentGeneration);
    if (normalizedRowsForDocumentGeneration.length === 0) return '';
    var rowXmlForDocumentGeneration = normalizedRowsForDocumentGeneration.map(function (rowForDocumentGeneration) {
      var cellsForDocumentGeneration = rowForDocumentGeneration.map(function (cellForDocumentGeneration) {
        return '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' +
          docxParagraphForDocumentGeneration(cellForDocumentGeneration, {}) +
          '</w:tc>';
      }).join('');
      return '<w:tr>' + cellsForDocumentGeneration + '</w:tr>';
    }).join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>' +
      '</w:tblBorders></w:tblPr>' + rowXmlForDocumentGeneration + '</w:tbl>';
  }

  function blocksFromContentForDocumentGeneration(contentForDocumentGeneration) {
    return String(contentForDocumentGeneration || '').split(/\r?\n/).map(function (lineForDocumentGeneration) {
      var trimmedForDocumentGeneration = lineForDocumentGeneration.trim();
      var headingMatchForDocumentGeneration = trimmedForDocumentGeneration.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatchForDocumentGeneration) {
        return {
          type: 'heading',
          level: headingMatchForDocumentGeneration[1].length,
          text: headingMatchForDocumentGeneration[2]
        };
      }
      var bulletMatchForDocumentGeneration = trimmedForDocumentGeneration.match(/^[-*]\s+(.+)$/);
      if (bulletMatchForDocumentGeneration) {
        return { type: 'bullet', text: bulletMatchForDocumentGeneration[1] };
      }
      return { type: 'paragraph', text: lineForDocumentGeneration };
    });
  }

  function buildDocxBodyForDocumentGeneration(inputForDocumentGeneration) {
    var blocksForDocumentGeneration = Array.isArray(inputForDocumentGeneration.blocks)
      ? inputForDocumentGeneration.blocks.slice(0, MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION)
      : [];
    if (blocksForDocumentGeneration.length === 0 && typeof inputForDocumentGeneration.content === 'string') {
      blocksForDocumentGeneration = blocksFromContentForDocumentGeneration(inputForDocumentGeneration.content);
    }
    if (inputForDocumentGeneration.title && blocksForDocumentGeneration.length > 0) {
      var firstBlockForDocumentGeneration = blocksForDocumentGeneration[0] || {};
      if (firstBlockForDocumentGeneration.type !== 'heading' || String(firstBlockForDocumentGeneration.text || '').trim() !== String(inputForDocumentGeneration.title).trim()) {
        blocksForDocumentGeneration.unshift({ type: 'heading', level: 1, text: inputForDocumentGeneration.title });
      }
    }
    if (blocksForDocumentGeneration.length === 0) {
      throw new Error('DOCX creation requires blocks or content.');
    }

    return blocksForDocumentGeneration.map(function (blockForDocumentGeneration) {
      if (!blockForDocumentGeneration || typeof blockForDocumentGeneration !== 'object') return '';
      if (blockForDocumentGeneration.type === 'table') {
        return docxTableForDocumentGeneration(blockForDocumentGeneration.rows);
      }
      if (blockForDocumentGeneration.type === 'heading') {
        var levelForDocumentGeneration = Math.max(1, Math.min(3, Number(blockForDocumentGeneration.level) || 1));
        return docxParagraphForDocumentGeneration(blockForDocumentGeneration.text || '', { headingLevel: levelForDocumentGeneration });
      }
      if (blockForDocumentGeneration.type === 'bullet') {
        if (Array.isArray(blockForDocumentGeneration.items)) {
          return blockForDocumentGeneration.items.map(function (itemForDocumentGeneration) {
            return docxParagraphForDocumentGeneration('- ' + String(itemForDocumentGeneration || ''), {});
          }).join('');
        }
        return docxParagraphForDocumentGeneration('- ' + String(blockForDocumentGeneration.text || ''), {});
      }
      return docxParagraphForDocumentGeneration(blockForDocumentGeneration.text || '', {});
    }).join('');
  }

  function buildDocxForDocumentGeneration(inputForDocumentGeneration) {
    if (!globalScopeForDocumentGeneration.JSZip) {
      throw new Error('DOCX generator is unavailable.');
    }
    var zipForDocumentGeneration = new globalScopeForDocumentGeneration.JSZip();
    var bodyForDocumentGeneration = buildDocxBodyForDocumentGeneration(inputForDocumentGeneration);
    var documentXmlForDocumentGeneration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + bodyForDocumentGeneration +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    zipForDocumentGeneration.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="' + DOCX_MIME_FOR_DOCUMENT_GENERATION + '.main+xml"/>' +
      '</Types>'
    );
    zipForDocumentGeneration.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
    );
    zipForDocumentGeneration.folder('word').file('document.xml', documentXmlForDocumentGeneration);

    return zipForDocumentGeneration.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      mimeType: DOCX_MIME_FOR_DOCUMENT_GENERATION
    }).then(function (uint8ForDocumentGeneration) {
      return {
        mimeType: DOCX_MIME_FOR_DOCUMENT_GENERATION,
        dataUrl: uint8ToDataUrlForDocumentGeneration(uint8ForDocumentGeneration, DOCX_MIME_FOR_DOCUMENT_GENERATION),
        size: uint8ForDocumentGeneration.length
      };
    });
  }

  function normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, emptyErrorForDocumentGeneration) {
    var blocksForDocumentGeneration = Array.isArray(inputForDocumentGeneration.blocks)
      ? inputForDocumentGeneration.blocks.slice(0, MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION)
      : [];
    if (blocksForDocumentGeneration.length === 0 && typeof inputForDocumentGeneration.content === 'string') {
      blocksForDocumentGeneration = blocksFromContentForDocumentGeneration(inputForDocumentGeneration.content);
    }
    if (inputForDocumentGeneration.title && blocksForDocumentGeneration.length > 0) {
      var firstBlockForDocumentGeneration = blocksForDocumentGeneration[0] || {};
      if (firstBlockForDocumentGeneration.type !== 'heading' || String(firstBlockForDocumentGeneration.text || '').trim() !== String(inputForDocumentGeneration.title).trim()) {
        blocksForDocumentGeneration.unshift({ type: 'heading', level: 1, text: inputForDocumentGeneration.title });
      }
    }
    if (blocksForDocumentGeneration.length === 0) {
      throw new Error(emptyErrorForDocumentGeneration);
    }
    return blocksForDocumentGeneration;
  }

  function pdfSafeTextForDocumentGeneration(valueForDocumentGeneration) {
    return String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration)
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function wrapTextForDocumentGeneration(textForDocumentGeneration, maxCharsForDocumentGeneration) {
    var textForWrap = String(textForDocumentGeneration == null ? '' : textForDocumentGeneration);
    if (textForWrap.length <= maxCharsForDocumentGeneration) return [textForWrap];
    var wordsForWrap = textForWrap.split(/\s+/);
    var linesForWrap = [];
    var currentForWrap = '';
    for (var wiForWrap = 0; wiForWrap < wordsForWrap.length; wiForWrap++) {
      var wordForWrap = wordsForWrap[wiForWrap];
      if (!wordForWrap) continue;
      if ((currentForWrap + ' ' + wordForWrap).trim().length > maxCharsForDocumentGeneration) {
        if (currentForWrap) linesForWrap.push(currentForWrap);
        currentForWrap = wordForWrap;
      } else {
        currentForWrap = (currentForWrap + ' ' + wordForWrap).trim();
      }
    }
    if (currentForWrap) linesForWrap.push(currentForWrap);
    return linesForWrap.length ? linesForWrap : [''];
  }

  function pdfLinesFromBlocksForDocumentGeneration(inputForDocumentGeneration) {
    var blocksForDocumentGeneration = normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, 'PDF creation requires content or blocks.');
    var linesForDocumentGeneration = [];
    blocksForDocumentGeneration.forEach(function (blockForDocumentGeneration) {
      if (!blockForDocumentGeneration || typeof blockForDocumentGeneration !== 'object') return;
      if (blockForDocumentGeneration.type === 'table') {
        var rowsForPdfTable = normalizeRowsForDocumentGeneration(blockForDocumentGeneration.rows).slice(0, 80);
        if (rowsForPdfTable.length > 0) {
          linesForDocumentGeneration.push({ type: 'table', rows: rowsForPdfTable, gapAfter: 10 });
        }
        return;
      }
      if (blockForDocumentGeneration.type === 'heading') {
        var headingSizeForPdf = Number(blockForDocumentGeneration.level) === 1 ? 18 : (Number(blockForDocumentGeneration.level) === 2 ? 15 : 13);
        linesForDocumentGeneration.push({ text: String(blockForDocumentGeneration.text || ''), size: headingSizeForPdf, gapAfter: 8 });
        return;
      }
      if (blockForDocumentGeneration.type === 'bullet') {
        if (Array.isArray(blockForDocumentGeneration.items)) {
          blockForDocumentGeneration.items.forEach(function (itemForPdfBullet) {
            linesForDocumentGeneration.push({ text: '- ' + String(itemForPdfBullet || ''), size: 11, gapAfter: 4 });
          });
          return;
        }
        linesForDocumentGeneration.push({ text: '- ' + String(blockForDocumentGeneration.text || ''), size: 11, gapAfter: 4 });
        return;
      }
      String(blockForDocumentGeneration.text || '').split(/\r?\n/).forEach(function (lineForPdfParagraph) {
        linesForDocumentGeneration.push({ text: lineForPdfParagraph, size: 11, gapAfter: 4 });
      });
    });
    return linesForDocumentGeneration.slice(0, MAX_PDF_LINES_FOR_DOCUMENT_GENERATION);
  }

  function estimatePdfTextWidthForDocumentGeneration(valueForDocumentGeneration, fontSizeForDocumentGeneration) {
    return String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration).length * fontSizeForDocumentGeneration * 0.48;
  }

  function getPdfTableColumnWidthsForDocumentGeneration(rowsForDocumentGeneration, tableWidthForDocumentGeneration, fontSizeForDocumentGeneration) {
    var colCountForDocumentGeneration = rowsForDocumentGeneration.reduce(function (maxForDocumentGeneration, rowForDocumentGeneration) {
      return Math.max(maxForDocumentGeneration, Array.isArray(rowForDocumentGeneration) ? rowForDocumentGeneration.length : 0);
    }, 0);
    if (colCountForDocumentGeneration === 0) return [];
    var minWidthsForDocumentGeneration = [];
    var weightsForDocumentGeneration = [];
    for (var ciForDocumentGeneration = 0; ciForDocumentGeneration < colCountForDocumentGeneration; ciForDocumentGeneration++) {
      var maxTextWidthForDocumentGeneration = 0;
      var numericCellsForDocumentGeneration = 0;
      var checkedCellsForDocumentGeneration = 0;
      for (var riForDocumentGeneration = 1; riForDocumentGeneration < rowsForDocumentGeneration.length; riForDocumentGeneration++) {
        var cellValueForDocumentGeneration = rowsForDocumentGeneration[riForDocumentGeneration] && rowsForDocumentGeneration[riForDocumentGeneration][ciForDocumentGeneration];
        var cellTextForDocumentGeneration = String(cellValueForDocumentGeneration == null ? '' : cellValueForDocumentGeneration).trim();
        if (!cellTextForDocumentGeneration) continue;
        checkedCellsForDocumentGeneration++;
        if (/^-?\d+(\.\d+)?$/.test(cellTextForDocumentGeneration)) numericCellsForDocumentGeneration++;
      }
      for (var rjForDocumentGeneration = 0; rjForDocumentGeneration < rowsForDocumentGeneration.length; rjForDocumentGeneration++) {
        var textForWidth = rowsForDocumentGeneration[rjForDocumentGeneration] && rowsForDocumentGeneration[rjForDocumentGeneration][ciForDocumentGeneration];
        maxTextWidthForDocumentGeneration = Math.max(
          maxTextWidthForDocumentGeneration,
          estimatePdfTextWidthForDocumentGeneration(textForWidth, fontSizeForDocumentGeneration)
        );
      }
      var isMostlyNumericForDocumentGeneration = checkedCellsForDocumentGeneration > 0 && numericCellsForDocumentGeneration / checkedCellsForDocumentGeneration >= 0.75;
      minWidthsForDocumentGeneration[ciForDocumentGeneration] = isMostlyNumericForDocumentGeneration ? 46 : 72;
      weightsForDocumentGeneration[ciForDocumentGeneration] = Math.max(
        minWidthsForDocumentGeneration[ciForDocumentGeneration],
        Math.min(isMostlyNumericForDocumentGeneration ? 74 : 210, maxTextWidthForDocumentGeneration + 14)
      );
    }
    var minTotalForDocumentGeneration = minWidthsForDocumentGeneration.reduce(function (sumForDocumentGeneration, widthForDocumentGeneration) {
      return sumForDocumentGeneration + widthForDocumentGeneration;
    }, 0);
    if (minTotalForDocumentGeneration >= tableWidthForDocumentGeneration) {
      return minWidthsForDocumentGeneration.map(function (widthForDocumentGeneration) {
        return widthForDocumentGeneration * tableWidthForDocumentGeneration / minTotalForDocumentGeneration;
      });
    }
    var remainingWidthForDocumentGeneration = tableWidthForDocumentGeneration - minTotalForDocumentGeneration;
    var flexibleTotalForDocumentGeneration = weightsForDocumentGeneration.reduce(function (sumForDocumentGeneration, weightForDocumentGeneration, indexForDocumentGeneration) {
      return sumForDocumentGeneration + Math.max(1, weightForDocumentGeneration - minWidthsForDocumentGeneration[indexForDocumentGeneration]);
    }, 0);
    return minWidthsForDocumentGeneration.map(function (minWidthForDocumentGeneration, indexForDocumentGeneration) {
      var flexForDocumentGeneration = Math.max(1, weightsForDocumentGeneration[indexForDocumentGeneration] - minWidthForDocumentGeneration);
      return minWidthForDocumentGeneration + remainingWidthForDocumentGeneration * (flexForDocumentGeneration / flexibleTotalForDocumentGeneration);
    });
  }

  function buildPdfForDocumentGeneration(inputForDocumentGeneration) {
    var logicalLinesForPdf = pdfLinesFromBlocksForDocumentGeneration(inputForDocumentGeneration);
    var pagesForPdf = [];
    var currentPageForPdf = [];
    var yForPdf = 742;
    var leftForPdf = 54;
    var bottomForPdf = 54;
    var pageWidthForPdf = 612;
    var tableWidthForPdf = pageWidthForPdf - (leftForPdf * 2);

    function startNewPdfPageForDocumentGeneration() {
      pagesForPdf.push(currentPageForPdf);
      currentPageForPdf = [];
      yForPdf = 742;
    }

    function ensurePdfSpaceForDocumentGeneration(heightForPdf) {
      if (yForPdf - heightForPdf < bottomForPdf && currentPageForPdf.length > 0) {
        startNewPdfPageForDocumentGeneration();
      }
    }

    function addPdfTextForDocumentGeneration(textForPdf, sizeForPdf, xForPdf, yValueForPdf, fontKeyForPdf) {
      currentPageForPdf.push({
        kind: 'text',
        text: textForPdf,
        size: sizeForPdf,
        x: xForPdf,
        y: yValueForPdf,
        fontKey: fontKeyForPdf || 'F1'
      });
    }

    function addPdfRectForDocumentGeneration(xForPdf, yValueForPdf, widthForPdf, heightForPdf) {
      currentPageForPdf.push({
        kind: 'path',
        command: xForPdf.toFixed(2) + ' ' + yValueForPdf.toFixed(2) + ' ' + widthForPdf.toFixed(2) + ' ' + heightForPdf.toFixed(2) + ' re S'
      });
    }

    function addPdfTableForDocumentGeneration(rowsForPdfTable) {
      var rowsForTable = normalizeRowsForDocumentGeneration(rowsForPdfTable).slice(0, 80);
      if (!rowsForTable.length) return;
      var fontSizeForTable = 8.5;
      var lineHeightForTable = 10.5;
      var paddingForTable = 3.5;
      var colWidthsForTable = getPdfTableColumnWidthsForDocumentGeneration(rowsForTable, tableWidthForPdf, fontSizeForTable);
      for (var rowIndexForTable = 0; rowIndexForTable < rowsForTable.length; rowIndexForTable++) {
        var rowForTable = rowsForTable[rowIndexForTable] || [];
        var wrappedCellsForTable = colWidthsForTable.map(function (widthForTable, cellIndexForTable) {
          var maxCharsForCell = Math.max(4, Math.floor((widthForTable - paddingForTable * 2) / (fontSizeForTable * 0.48)));
          return wrapTextForDocumentGeneration(rowForTable[cellIndexForTable], maxCharsForCell);
        });
        var maxLinesForRow = wrappedCellsForTable.reduce(function (maxForRow, linesForCell) {
          return Math.max(maxForRow, linesForCell.length);
        }, 1);
        var rowHeightForTable = Math.max(18, maxLinesForRow * lineHeightForTable + paddingForTable * 2);
        ensurePdfSpaceForDocumentGeneration(rowHeightForTable + 2);
        var rowTopForTable = yForPdf;
        var rowBottomForTable = rowTopForTable - rowHeightForTable;
        var xForTable = leftForPdf;
        for (var colIndexForTable = 0; colIndexForTable < colWidthsForTable.length; colIndexForTable++) {
          var colWidthForTable = colWidthsForTable[colIndexForTable];
          addPdfRectForDocumentGeneration(xForTable, rowBottomForTable, colWidthForTable, rowHeightForTable);
          var linesForCellForTable = wrappedCellsForTable[colIndexForTable];
          for (var lineIndexForCell = 0; lineIndexForCell < linesForCellForTable.length; lineIndexForCell++) {
            addPdfTextForDocumentGeneration(
              linesForCellForTable[lineIndexForCell],
              fontSizeForTable,
              xForTable + paddingForTable,
              rowTopForTable - paddingForTable - fontSizeForTable - (lineIndexForCell * lineHeightForTable),
              rowIndexForTable === 0 ? 'F2' : 'F1'
            );
          }
          xForTable += colWidthForTable;
        }
        yForPdf = rowBottomForTable;
      }
    }

    logicalLinesForPdf.forEach(function (lineForPdf) {
      if (lineForPdf && lineForPdf.type === 'table') {
        addPdfTableForDocumentGeneration(lineForPdf.rows);
        yForPdf -= Number(lineForPdf.gapAfter) || 0;
        return;
      }
      var sizeForPdf = Number(lineForPdf.size) || 11;
      var maxCharsForPdf = Math.max(28, Math.floor(92 * (11 / sizeForPdf)));
      var wrappedForPdf = wrapTextForDocumentGeneration(lineForPdf.text, maxCharsForPdf);
      wrappedForPdf.forEach(function (wrappedLineForPdf) {
        ensurePdfSpaceForDocumentGeneration(Math.max(14, sizeForPdf + 4));
        addPdfTextForDocumentGeneration(wrappedLineForPdf, sizeForPdf, leftForPdf, yForPdf, 'F1');
        yForPdf -= Math.max(14, sizeForPdf + 4);
      });
      yForPdf -= Number(lineForPdf.gapAfter) || 0;
    });
    if (currentPageForPdf.length || pagesForPdf.length === 0) pagesForPdf.push(currentPageForPdf);

    var objectsForPdf = [];
    function addObjectForPdf(contentForPdf) {
      objectsForPdf.push(String(contentForPdf));
      return objectsForPdf.length;
    }

    var catalogIdForPdf = addObjectForPdf('');
    var pagesIdForPdf = addObjectForPdf('');
    var fontIdForPdf = addObjectForPdf('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var boldFontIdForPdf = addObjectForPdf('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    var pageIdsForPdf = [];

    pagesForPdf.forEach(function (pageLinesForPdf) {
      var streamForPdf = pageLinesForPdf.map(function (lineForPdf) {
        if (lineForPdf.kind === 'path') return lineForPdf.command;
        return 'BT /' + (lineForPdf.fontKey || 'F1') + ' ' + lineForPdf.size + ' Tf ' + lineForPdf.x.toFixed(2) + ' ' + lineForPdf.y.toFixed(2) + ' Td (' + pdfSafeTextForDocumentGeneration(lineForPdf.text) + ') Tj ET';
      }).join('\n');
      var contentIdForPdf = addObjectForPdf('<< /Length ' + streamForPdf.length + ' >>\nstream\n' + streamForPdf + '\nendstream');
      var pageIdForPdf = addObjectForPdf('<< /Type /Page /Parent ' + pagesIdForPdf + ' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontIdForPdf + ' 0 R /F2 ' + boldFontIdForPdf + ' 0 R >> >> /Contents ' + contentIdForPdf + ' 0 R >>');
      pageIdsForPdf.push(pageIdForPdf);
    });

    objectsForPdf[catalogIdForPdf - 1] = '<< /Type /Catalog /Pages ' + pagesIdForPdf + ' 0 R >>';
    objectsForPdf[pagesIdForPdf - 1] = '<< /Type /Pages /Kids [' + pageIdsForPdf.map(function (idForPdf) { return idForPdf + ' 0 R'; }).join(' ') + '] /Count ' + pageIdsForPdf.length + ' >>';

    var outputForPdf = '%PDF-1.4\n';
    var offsetsForPdf = [0];
    for (var oiForPdf = 0; oiForPdf < objectsForPdf.length; oiForPdf++) {
      offsetsForPdf.push(outputForPdf.length);
      outputForPdf += (oiForPdf + 1) + ' 0 obj\n' + objectsForPdf[oiForPdf] + '\nendobj\n';
    }
    var xrefOffsetForPdf = outputForPdf.length;
    outputForPdf += 'xref\n0 ' + (objectsForPdf.length + 1) + '\n0000000000 65535 f \n';
    for (var xiForPdf = 1; xiForPdf < offsetsForPdf.length; xiForPdf++) {
      outputForPdf += String(offsetsForPdf[xiForPdf]).padStart(10, '0') + ' 00000 n \n';
    }
    outputForPdf += 'trailer\n<< /Size ' + (objectsForPdf.length + 1) + ' /Root ' + catalogIdForPdf + ' 0 R >>\nstartxref\n' + xrefOffsetForPdf + '\n%%EOF';
    var uint8ForPdf = new TextEncoder().encode(outputForPdf);
    return {
      mimeType: PDF_MIME_FOR_DOCUMENT_GENERATION,
      dataUrl: uint8ToDataUrlForDocumentGeneration(uint8ForPdf, PDF_MIME_FOR_DOCUMENT_GENERATION),
      size: uint8ForPdf.length
    };
  }

  function normalizeSlidesForDocumentGeneration(inputForDocumentGeneration) {
    var slidesForDocumentGeneration = Array.isArray(inputForDocumentGeneration.slides)
      ? inputForDocumentGeneration.slides.slice(0, MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION)
      : [];
    if (slidesForDocumentGeneration.length === 0 && typeof inputForDocumentGeneration.content === 'string' && inputForDocumentGeneration.content.trim()) {
      var chunksForSlides = String(inputForDocumentGeneration.content).split(/\n\s*\n/).filter(function (chunkForSlides) {
        return chunkForSlides.trim();
      });
      slidesForDocumentGeneration = chunksForSlides.map(function (chunkForSlides, indexForSlides) {
        var linesForSlides = chunkForSlides.split(/\r?\n/).filter(function (lineForSlides) { return lineForSlides.trim(); });
        var firstLineForSlides = linesForSlides.shift() || ('Slide ' + (indexForSlides + 1));
        return { title: firstLineForSlides.replace(/^#{1,3}\s+/, ''), bullets: linesForSlides.map(function (lineForSlides) { return lineForSlides.replace(/^[-*]\s+/, ''); }) };
      });
    }
    if (slidesForDocumentGeneration.length === 0 && inputForDocumentGeneration.title) {
      slidesForDocumentGeneration = [{ title: inputForDocumentGeneration.title, bullets: [] }];
    }
    if (slidesForDocumentGeneration.length === 0) {
      throw new Error('PPTX creation requires slides, content, or title.');
    }
    return slidesForDocumentGeneration.map(function (slideForDocumentGeneration, indexForDocumentGeneration) {
      var titleForSlide = String((slideForDocumentGeneration && slideForDocumentGeneration.title) || ('Slide ' + (indexForDocumentGeneration + 1)));
      var bulletsForSlide = [];
      if (Array.isArray(slideForDocumentGeneration && slideForDocumentGeneration.bullets)) {
        bulletsForSlide = slideForDocumentGeneration.bullets.map(function (bulletForSlide) { return String(bulletForSlide || ''); });
      } else if (Array.isArray(slideForDocumentGeneration && slideForDocumentGeneration.items)) {
        bulletsForSlide = slideForDocumentGeneration.items.map(function (bulletForSlide) { return String(bulletForSlide || ''); });
      } else if (typeof (slideForDocumentGeneration && slideForDocumentGeneration.content) === 'string') {
        bulletsForSlide = slideForDocumentGeneration.content.split(/\r?\n/).filter(function (lineForSlide) { return lineForSlide.trim(); });
      }
      return { title: titleForSlide, bullets: bulletsForSlide.slice(0, 12) };
    });
  }

  function pptxParagraphXmlForDocumentGeneration(textForDocumentGeneration, fontSizeForDocumentGeneration, isBulletForDocumentGeneration) {
    var paragraphPropsForPptx = isBulletForDocumentGeneration ? '<a:pPr marL="342900" indent="-171450"><a:buChar char="&#8226;"/></a:pPr>' : '<a:pPr/>';
    return '<a:p>' + paragraphPropsForPptx + '<a:r><a:rPr lang="en-US" sz="' + fontSizeForDocumentGeneration + '"/><a:t>' + escapeXmlForDocumentGeneration(textForDocumentGeneration) + '</a:t></a:r><a:endParaRPr lang="en-US" sz="' + fontSizeForDocumentGeneration + '"/></a:p>';
  }

  function pptxTextShapeForDocumentGeneration(idForDocumentGeneration, nameForDocumentGeneration, xForDocumentGeneration, yForDocumentGeneration, cxForDocumentGeneration, cyForDocumentGeneration, paragraphsForDocumentGeneration) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + idForDocumentGeneration + '" name="' + escapeXmlForDocumentGeneration(nameForDocumentGeneration) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + xForDocumentGeneration + '" y="' + yForDocumentGeneration + '"/><a:ext cx="' + cxForDocumentGeneration + '" cy="' + cyForDocumentGeneration + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' + paragraphsForDocumentGeneration + '</p:txBody></p:sp>';
  }

  function pptxSlideXmlForDocumentGeneration(slideForDocumentGeneration, indexForDocumentGeneration) {
    var titleParagraphForPptx = pptxParagraphXmlForDocumentGeneration(slideForDocumentGeneration.title, 3200, false);
    var bodyParagraphsForPptx = slideForDocumentGeneration.bullets.length
      ? slideForDocumentGeneration.bullets.map(function (bulletForPptx) {
          return pptxParagraphXmlForDocumentGeneration(bulletForPptx, 2000, true);
        }).join('')
      : pptxParagraphXmlForDocumentGeneration('', 2000, false);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      pptxTextShapeForDocumentGeneration(2, 'Title ' + (indexForDocumentGeneration + 1), 457200, 365760, 8229600, 914400, titleParagraphForPptx) +
      pptxTextShapeForDocumentGeneration(3, 'Content ' + (indexForDocumentGeneration + 1), 685800, 1463040, 7772400, 3108960, bodyParagraphsForPptx) +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function pptxThemeXmlForDocumentGeneration() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Agentic Browser Chat">' +
      '<a:themeElements>' +
      '<a:clrScheme name="Agentic Browser Chat">' +
      '<a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="7C3AED"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="059669"/></a:accent3><a:accent4><a:srgbClr val="D97706"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="DC2626"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>' +
      '</a:clrScheme>' +
      '<a:fontScheme name="Agentic Browser Chat">' +
      '<a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
      '</a:fontScheme>' +
      '<a:fmtScheme name="Agentic Browser Chat">' +
      '<a:fillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '</a:fillStyleLst>' +
      '<a:lnStyleLst>' +
      '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '</a:lnStyleLst>' +
      '<a:effectStyleLst>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle>' +
      '</a:effectStyleLst>' +
      '<a:bgFillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="98000"/><a:satMod val="130000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '</a:bgFillStyleLst>' +
      '</a:fmtScheme>' +
      '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  function pptxSlideMasterXmlForDocumentGeneration() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles>' +
      '<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr marL="342900" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
      '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle>' +
      '</p:txStyles></p:sldMaster>';
  }

  function pptxCorePropsXmlForDocumentGeneration(titleForDocumentGeneration, createdAtForDocumentGeneration) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + escapeXmlForDocumentGeneration(titleForDocumentGeneration || 'Generated presentation') + '</dc:title>' +
      '<dc:creator>Agentic Browser Chat</dc:creator><cp:lastModifiedBy>Agentic Browser Chat</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + escapeXmlForDocumentGeneration(createdAtForDocumentGeneration) + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + escapeXmlForDocumentGeneration(createdAtForDocumentGeneration) + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function pptxAppPropsXmlForDocumentGeneration(slideCountForDocumentGeneration) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Agentic Browser Chat</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat>' +
      '<Slides>' + slideCountForDocumentGeneration + '</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>' + slideCountForDocumentGeneration + '</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="' + slideCountForDocumentGeneration + '" baseType="lpstr">' +
      Array.from({ length: slideCountForDocumentGeneration }, function (_valueForDocumentGeneration, indexForDocumentGeneration) {
        return '<vt:lpstr>Slide ' + (indexForDocumentGeneration + 1) + '</vt:lpstr>';
      }).join('') +
      '</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>';
  }

  function buildPptxForDocumentGeneration(inputForDocumentGeneration) {
    if (!globalScopeForDocumentGeneration.JSZip) {
      throw new Error('PPTX generator is unavailable.');
    }
    var slidesForPptx = normalizeSlidesForDocumentGeneration(inputForDocumentGeneration);
    var zipForPptx = new globalScopeForDocumentGeneration.JSZip();
    var contentTypesForPptx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
    slidesForPptx.forEach(function (_slideForPptx, indexForPptx) {
      contentTypesForPptx += '<Override PartName="/ppt/slides/slide' + (indexForPptx + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    });
    contentTypesForPptx += '</Types>';

    zipForPptx.file('[Content_Types].xml', contentTypesForPptx);
    zipForPptx.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>'
    );
    var createdAtForPptx = new Date().toISOString();
    zipForPptx.folder('docProps').file('core.xml', pptxCorePropsXmlForDocumentGeneration(inputForDocumentGeneration.title, createdAtForPptx));
    zipForPptx.folder('docProps').file('app.xml', pptxAppPropsXmlForDocumentGeneration(slidesForPptx.length));

    var slideIdListForPptx = '';
    var presentationRelsForPptx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';
    slidesForPptx.forEach(function (_slideForPptx, indexForPptx) {
      slideIdListForPptx += '<p:sldId id="' + (256 + indexForPptx) + '" r:id="rId' + (indexForPptx + 2) + '"/>';
      presentationRelsForPptx += '<Relationship Id="rId' + (indexForPptx + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (indexForPptx + 1) + '.xml"/>';
    });
    presentationRelsForPptx += '</Relationships>';

    zipForPptx.folder('ppt').file('presentation.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slideIdListForPptx + '</p:sldIdLst>' +
      '<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
    );
    zipForPptx.folder('ppt').folder('_rels').file('presentation.xml.rels', presentationRelsForPptx);
    zipForPptx.folder('ppt').folder('slideMasters').file('slideMaster1.xml', pptxSlideMasterXmlForDocumentGeneration());
    zipForPptx.folder('ppt').folder('slideMasters').folder('_rels').file('slideMaster1.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'
    );
    zipForPptx.folder('ppt').folder('slideLayouts').file('slideLayout1.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
    );
    zipForPptx.folder('ppt').folder('slideLayouts').folder('_rels').file('slideLayout1.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'
    );
    zipForPptx.folder('ppt').folder('theme').file('theme1.xml', pptxThemeXmlForDocumentGeneration());
    slidesForPptx.forEach(function (slideForPptx, indexForPptx) {
      zipForPptx.folder('ppt').folder('slides').file('slide' + (indexForPptx + 1) + '.xml', pptxSlideXmlForDocumentGeneration(slideForPptx, indexForPptx));
      zipForPptx.folder('ppt').folder('slides').folder('_rels').file('slide' + (indexForPptx + 1) + '.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
      );
    });

    return zipForPptx.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      mimeType: PPTX_MIME_FOR_DOCUMENT_GENERATION
    }).then(function (uint8ForPptx) {
      return {
        mimeType: PPTX_MIME_FOR_DOCUMENT_GENERATION,
        dataUrl: uint8ToDataUrlForDocumentGeneration(uint8ForPptx, PPTX_MIME_FOR_DOCUMENT_GENERATION),
        size: uint8ForPptx.length
      };
    });
  }

  function createDocumentForDocumentGeneration(inputForDocumentGeneration) {
    var safeInputForDocumentGeneration = inputForDocumentGeneration || {};
    var formatForDocumentGeneration = String(safeInputForDocumentGeneration.format || '').toLowerCase();
    if (['xlsx', 'docx', 'pdf', 'pptx', 'csv'].indexOf(formatForDocumentGeneration) === -1) {
      return Promise.reject(new Error('format must be xlsx, docx, pdf, pptx, or csv.'));
    }
    var filenameForDocumentGeneration = normalizeFilenameForDocumentGeneration(
      safeInputForDocumentGeneration.filename,
      formatForDocumentGeneration,
      safeInputForDocumentGeneration.title
    );
    var builtForDocumentGeneration;
    if (formatForDocumentGeneration === 'xlsx') {
      builtForDocumentGeneration = buildXlsxForDocumentGeneration(safeInputForDocumentGeneration);
    } else if (formatForDocumentGeneration === 'csv') {
      builtForDocumentGeneration = buildCsvForDocumentGeneration(safeInputForDocumentGeneration);
    } else if (formatForDocumentGeneration === 'docx') {
      builtForDocumentGeneration = buildDocxForDocumentGeneration(safeInputForDocumentGeneration);
    } else if (formatForDocumentGeneration === 'pdf') {
      builtForDocumentGeneration = buildPdfForDocumentGeneration(safeInputForDocumentGeneration);
    } else {
      builtForDocumentGeneration = buildPptxForDocumentGeneration(safeInputForDocumentGeneration);
    }
    return Promise.resolve(builtForDocumentGeneration).then(function (resultForDocumentGeneration) {
      return {
        ok: true,
        format: formatForDocumentGeneration,
        filename: filenameForDocumentGeneration,
        mimeType: resultForDocumentGeneration.mimeType,
        dataUrl: resultForDocumentGeneration.dataUrl,
        size: resultForDocumentGeneration.size
      };
    });
  }

  agentNamespaceForDocumentGeneration.documentGeneration = {
    createDocument: createDocumentForDocumentGeneration
  };

  globalScopeForDocumentGeneration.ABChatAgent = agentNamespaceForDocumentGeneration;
})();
