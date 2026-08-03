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
  var MAX_DOCX_IMAGES_FOR_DOCUMENT_GENERATION = 50;
  var EMU_PER_PIXEL_FOR_DOCUMENT_GENERATION = 9525;            // 914400 EMU/in / 96 px/in
  var MAX_IMAGE_WIDTH_EMU_FOR_DOCUMENT_GENERATION = 5943600;  // 9360 twip content width * 635 EMU/twip
  var MAX_IMAGE_HEIGHT_EMU_FOR_DOCUMENT_GENERATION = 8229600; // 12960 twip content height * 635 EMU/twip
  var IMAGE_SENTINEL_RE_FOR_DOCUMENT_GENERATION = /^abchat-img:(\d+):(\d+)$/;
  var IMAGE_SENTINEL_SCAN_RE_FOR_DOCUMENT_GENERATION = /abchat-img:(\d+):\d+/g;
  var IMAGE_CONTENT_TYPE_EXT_FOR_DOCUMENT_GENERATION = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif'
  };
  var MAX_PDF_IMAGE_RASTER_DIM_FOR_DOCUMENT_GENERATION = 1600;  // longest side, px, before JPEG re-encode
  var PDF_IMAGE_JPEG_QUALITY_FOR_DOCUMENT_GENERATION = 0.9;
  var PDF_PX_TO_PT_FOR_DOCUMENT_GENERATION = 0.75;             // 72 pt/in / 96 px/in
  var PDF_FONT_ASCENT_RATIO_FOR_DOCUMENT_GENERATION = 0.75;    // >= Helvetica cap height (0.718) so glyphs never rise above the line box
  // Block-level tags that force a line break when nested inside an inline context (the
  // common case is several <p> inside one table cell, which mammoth emits). Without this
  // the runs concatenate onto one line (e.g. "Title" + "Subtitle" -> "TitleSubtitle").
  var INLINE_BLOCK_BOUNDARY_TAGS_FOR_DOCUMENT_GENERATION = {
    p: true, div: true, section: true, article: true, header: true, footer: true,
    main: true, figure: true, figcaption: true, blockquote: true, pre: true, address: true,
    li: true, dd: true, dt: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true
  };
  var MIN_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION = 1;
  var MAX_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION = 400;
  var MAX_BORDER_WIDTH_PT_FOR_DOCUMENT_GENERATION = 12;
  var TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
  var DEFAULT_TABLE_BORDER_FOR_DOCUMENT_GENERATION = { widthPt: 0.5, color: 'D9D9D9' };
  var DEFAULT_PAGE_WIDTH_PT_FOR_DOCUMENT_GENERATION = 612;   // US Letter, the long-standing default
  var DEFAULT_PAGE_HEIGHT_PT_FOR_DOCUMENT_GENERATION = 792;
  var DEFAULT_DOCX_MARGIN_PT_FOR_DOCUMENT_GENERATION = 72;
  var DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION = 54;
  var DEFAULT_PDF_BODY_SIZE_PT_FOR_DOCUMENT_GENERATION = 11;
  var CSS_NAMED_COLORS_FOR_DOCUMENT_GENERATION = {
    black: '000000', white: 'FFFFFF', gray: '808080', grey: '808080', silver: 'C0C0C0',
    red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', navy: '000080',
    maroon: '800000', olive: '808000', teal: '008080', purple: '800080', lime: '00FF00',
    aqua: '00FFFF', fuchsia: 'FF00FF'
  };
  // Word maps a font to one of three PDF base-14 families; anything unrecognized keeps the
  // sans default. Matching the exact face is impossible without embedding it, so the goal is
  // only to land in the right family so the regenerated page reads like the original.
  var PDF_SERIF_FAMILY_HINTS_FOR_DOCUMENT_GENERATION = /times|georgia|garamond|cambria|book|serif|palatino|minion|constantia|baskerville/i;
  var PDF_MONO_FAMILY_HINTS_FOR_DOCUMENT_GENERATION = /courier|consolas|mono|menlo|monaco|inconsolata/i;

  function escapeXmlForDocumentGeneration(valueForDocumentGeneration) {
    return String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // read_document_structure reports a source document's resolved formatting as CSS on the
  // elements it produces, so create_document reads the same CSS back. Only the properties
  // below are honored; everything else in a style attribute is ignored.
  function parseInlineStyleForDocumentGeneration(styleTextForDocumentGeneration) {
    var declarationsForStyle = {};
    String(styleTextForDocumentGeneration || '').split(';').forEach(function (pieceForStyle) {
      var separatorIndexForStyle = pieceForStyle.indexOf(':');
      if (separatorIndexForStyle < 0) return;
      var propertyForStyle = pieceForStyle.slice(0, separatorIndexForStyle).trim().toLowerCase();
      var valueForStyle = pieceForStyle.slice(separatorIndexForStyle + 1).trim();
      if (propertyForStyle && valueForStyle) declarationsForStyle[propertyForStyle] = valueForStyle;
    });
    return declarationsForStyle;
  }

  function elementStyleForDocumentGeneration(elementForDocumentGeneration) {
    if (!elementForDocumentGeneration || typeof elementForDocumentGeneration.getAttribute !== 'function') return {};
    return parseInlineStyleForDocumentGeneration(elementForDocumentGeneration.getAttribute('style'));
  }

  function parseLengthPtForDocumentGeneration(valueForDocumentGeneration) {
    var rawForLength = String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration).trim().toLowerCase();
    var matchForLength = rawForLength.match(/^(-?\d*\.?\d+)\s*(pt|px|in|cm|mm|pc|em|rem)?$/);
    if (!matchForLength) return 0;
    var amountForLength = parseFloat(matchForLength[1]);
    if (!Number.isFinite(amountForLength)) return 0;
    var unitForLength = matchForLength[2] || 'pt';
    var factorForLength = 1;
    if (unitForLength === 'px') factorForLength = 0.75;
    else if (unitForLength === 'in') factorForLength = 72;
    else if (unitForLength === 'cm') factorForLength = 28.3465;
    else if (unitForLength === 'mm') factorForLength = 2.83465;
    else if (unitForLength === 'pc') factorForLength = 12;
    else if (unitForLength === 'em' || unitForLength === 'rem') factorForLength = 12;
    return Math.round(amountForLength * factorForLength * 10) / 10;
  }

  function parseFontSizePtForDocumentGeneration(valueForDocumentGeneration) {
    var sizeForFont = parseLengthPtForDocumentGeneration(valueForDocumentGeneration);
    if (sizeForFont < MIN_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION || sizeForFont > MAX_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION) return 0;
    return sizeForFont;
  }

  function parseFontFamilyForDocumentGeneration(valueForDocumentGeneration) {
    var firstFamilyForFont = String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration).split(',')[0];
    return firstFamilyForFont.replace(/["'<>;]/g, '').trim().slice(0, 64);
  }

  function parseCssColorForDocumentGeneration(valueForDocumentGeneration) {
    var rawForColor = String(valueForDocumentGeneration || '').trim().toLowerCase();
    if (!rawForColor) return '';
    if (/^#[0-9a-f]{6}$/.test(rawForColor)) return rawForColor.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/.test(rawForColor)) {
      return (rawForColor.charAt(1) + rawForColor.charAt(1)
        + rawForColor.charAt(2) + rawForColor.charAt(2)
        + rawForColor.charAt(3) + rawForColor.charAt(3)).toUpperCase();
    }
    if (/^[0-9a-f]{6}$/.test(rawForColor)) return rawForColor.toUpperCase();
    return CSS_NAMED_COLORS_FOR_DOCUMENT_GENERATION[rawForColor] || '';
  }

  // Returns null for an explicitly absent border ("none"), and an edge object otherwise.
  function parseBorderValueForDocumentGeneration(valueForDocumentGeneration) {
    var rawForBorder = String(valueForDocumentGeneration || '').trim();
    if (!rawForBorder) return null;
    var tokensForBorder = rawForBorder.split(/\s+/);
    var widthPtForBorder = 0;
    var colorForBorder = '';
    var explicitlyNoneForBorder = false;
    var sawStyleForBorder = false;
    tokensForBorder.forEach(function (tokenForBorder) {
      var lowerTokenForBorder = tokenForBorder.toLowerCase();
      if (lowerTokenForBorder === 'none' || lowerTokenForBorder === 'hidden') { explicitlyNoneForBorder = true; return; }
      if (lowerTokenForBorder === 'thin') { widthPtForBorder = widthPtForBorder || 0.5; sawStyleForBorder = true; return; }
      if (lowerTokenForBorder === 'medium') { widthPtForBorder = widthPtForBorder || 1; sawStyleForBorder = true; return; }
      if (lowerTokenForBorder === 'thick') { widthPtForBorder = widthPtForBorder || 2; sawStyleForBorder = true; return; }
      if (/^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(lowerTokenForBorder)) { sawStyleForBorder = true; return; }
      var lengthForBorder = parseLengthPtForDocumentGeneration(lowerTokenForBorder);
      if (lengthForBorder > 0) { widthPtForBorder = lengthForBorder; return; }
      if (lengthForBorder === 0 && /^0(\.0+)?\s*(pt|px|in|cm|mm|pc)?$/.test(lowerTokenForBorder)) { explicitlyNoneForBorder = true; return; }
      var parsedColorForBorder = parseCssColorForDocumentGeneration(tokenForBorder);
      if (parsedColorForBorder) colorForBorder = parsedColorForBorder;
    });
    if (explicitlyNoneForBorder && !widthPtForBorder) return null;
    if (!widthPtForBorder && !sawStyleForBorder && !colorForBorder) return null;
    return {
      widthPt: Math.min(MAX_BORDER_WIDTH_PT_FOR_DOCUMENT_GENERATION, widthPtForBorder || 0.5),
      color: colorForBorder || '000000'
    };
  }

  // The `border` shorthand on a table sets all six Word edges (frame plus interior grid),
  // because that is what the structural read emits when the source table's six edges agree.
  // Per-side properties then override the frame, and the two custom properties override the
  // interior lines, which standard CSS has no way to address on the table element itself.
  function tableBorderSpecFromStyleForDocumentGeneration(declarationsForDocumentGeneration) {
    var hasAnyBorderPropertyForSpec = false;
    var edgesForSpec = {};
    TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION.forEach(function (edgeNameForSpec) {
      edgesForSpec[edgeNameForSpec] = null;
    });
    if (Object.prototype.hasOwnProperty.call(declarationsForDocumentGeneration, 'border')) {
      hasAnyBorderPropertyForSpec = true;
      var shorthandEdgeForSpec = parseBorderValueForDocumentGeneration(declarationsForDocumentGeneration.border);
      TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION.forEach(function (edgeNameForSpec) {
        edgesForSpec[edgeNameForSpec] = shorthandEdgeForSpec;
      });
    }
    [['border-top', 'top'], ['border-right', 'right'], ['border-bottom', 'bottom'], ['border-left', 'left'],
     ['--border-inside-h', 'insideH'], ['--border-inside-v', 'insideV']].forEach(function (pairForSpec) {
      if (!Object.prototype.hasOwnProperty.call(declarationsForDocumentGeneration, pairForSpec[0])) return;
      hasAnyBorderPropertyForSpec = true;
      edgesForSpec[pairForSpec[1]] = parseBorderValueForDocumentGeneration(declarationsForDocumentGeneration[pairForSpec[0]]);
    });
    if (!hasAnyBorderPropertyForSpec) return undefined;
    var anyEdgeForSpec = TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION.some(function (edgeNameForSpec) {
      return !!edgesForSpec[edgeNameForSpec];
    });
    return anyEdgeForSpec ? edgesForSpec : null;
  }

  function uniformTableBorderSpecForDocumentGeneration(edgeForDocumentGeneration) {
    var edgesForUniform = {};
    TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION.forEach(function (edgeNameForUniform) {
      edgesForUniform[edgeNameForUniform] = edgeForDocumentGeneration;
    });
    return edgesForUniform;
  }

  function normalizeDocumentDefaultsForDocumentGeneration(rawDefaultsForDocumentGeneration) {
    var declarationsForDefaults = rawDefaultsForDocumentGeneration || {};
    var pageWidthPtForDefaults = parseLengthPtForDocumentGeneration(declarationsForDefaults['page-width']);
    var pageHeightPtForDefaults = parseLengthPtForDocumentGeneration(declarationsForDefaults['page-height']);
    var marginsForDefaults = null;
    if (declarationsForDefaults.margin) {
      var marginPartsForDefaults = String(declarationsForDefaults.margin).trim().split(/\s+/).map(parseLengthPtForDocumentGeneration);
      if (marginPartsForDefaults.length === 1) {
        marginsForDefaults = { top: marginPartsForDefaults[0], right: marginPartsForDefaults[0], bottom: marginPartsForDefaults[0], left: marginPartsForDefaults[0] };
      } else if (marginPartsForDefaults.length === 2) {
        marginsForDefaults = { top: marginPartsForDefaults[0], right: marginPartsForDefaults[1], bottom: marginPartsForDefaults[0], left: marginPartsForDefaults[1] };
      } else if (marginPartsForDefaults.length >= 4) {
        marginsForDefaults = { top: marginPartsForDefaults[0], right: marginPartsForDefaults[1], bottom: marginPartsForDefaults[2], left: marginPartsForDefaults[3] };
      }
      if (marginsForDefaults) {
        ['top', 'right', 'bottom', 'left'].forEach(function (sideForDefaults) {
          if (!(marginsForDefaults[sideForDefaults] > 0)) marginsForDefaults[sideForDefaults] = 0;
        });
      }
    }
    var normalizedForDefaults = {
      fontSizePt: parseFontSizePtForDocumentGeneration(declarationsForDefaults['font-size']),
      fontFamily: parseFontFamilyForDocumentGeneration(declarationsForDefaults['font-family']),
      pageWidthPt: (pageWidthPtForDefaults >= 72 && pageWidthPtForDefaults <= 5000) ? pageWidthPtForDefaults : 0,
      pageHeightPt: (pageHeightPtForDefaults >= 72 && pageHeightPtForDefaults <= 5000) ? pageHeightPtForDefaults : 0,
      margins: marginsForDefaults
    };
    if (!normalizedForDefaults.fontSizePt && !normalizedForDefaults.fontFamily
      && !normalizedForDefaults.pageWidthPt && !normalizedForDefaults.margins) {
      return null;
    }
    return normalizedForDefaults;
  }

  function readDocumentDefaultsFromBodyForDocumentGeneration(bodyForDocumentGeneration) {
    if (!bodyForDocumentGeneration || typeof bodyForDocumentGeneration.querySelector !== 'function') return null;
    var holderForDefaults = bodyForDocumentGeneration.querySelector('[data-doc-defaults]');
    if (!holderForDefaults) return null;
    return normalizeDocumentDefaultsForDocumentGeneration(
      parseInlineStyleForDocumentGeneration(holderForDefaults.getAttribute('data-doc-defaults'))
    );
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

  function htmlInlineRunsFromNodesForDocumentGeneration(topNodesForDocumentGeneration, baseFlagsForDocumentGeneration) {
    var runsForDocumentGeneration = [];
    function appendChildRunForDocumentGeneration(childForInline, flagsForDocumentGeneration) {
      if (childForInline.nodeType === 3) {
        var textForInline = String(childForInline.nodeValue || '').replace(/\s+/g, ' ');
        if (textForInline) {
          runsForDocumentGeneration.push({
            text: textForInline,
            bold: flagsForDocumentGeneration.bold,
            italic: flagsForDocumentGeneration.italic,
            href: flagsForDocumentGeneration.href,
            sizePt: flagsForDocumentGeneration.sizePt,
            font: flagsForDocumentGeneration.font
          });
        }
        return;
      }
      if (childForInline.nodeType !== 1) return;
      var tagForInline = String(childForInline.tagName || '').toLowerCase();
      if (tagForInline === 'br') { runsForDocumentGeneration.push({ text: '\n' }); return; }
      if (tagForInline === 'ul' || tagForInline === 'ol') return;
      if (INLINE_BLOCK_BOUNDARY_TAGS_FOR_DOCUMENT_GENERATION[tagForInline] === true) {
        var lastRunForInline = runsForDocumentGeneration[runsForDocumentGeneration.length - 1];
        if (lastRunForInline && lastRunForInline.text !== '\n') {
          runsForDocumentGeneration.push({ text: '\n' });
        }
      }
      var nextFlagsForInline = {
        bold: flagsForDocumentGeneration.bold,
        italic: flagsForDocumentGeneration.italic,
        href: flagsForDocumentGeneration.href,
        sizePt: flagsForDocumentGeneration.sizePt,
        font: flagsForDocumentGeneration.font
      };
      var inlineStyleForInline = elementStyleForDocumentGeneration(childForInline);
      if (inlineStyleForInline['font-size']) {
        var inlineSizeForInline = parseFontSizePtForDocumentGeneration(inlineStyleForInline['font-size']);
        if (inlineSizeForInline) nextFlagsForInline.sizePt = inlineSizeForInline;
      }
      if (inlineStyleForInline['font-family']) {
        var inlineFamilyForInline = parseFontFamilyForDocumentGeneration(inlineStyleForInline['font-family']);
        if (inlineFamilyForInline) nextFlagsForInline.font = inlineFamilyForInline;
      }
      if (tagForInline === 'strong' || tagForInline === 'b') nextFlagsForInline.bold = true;
      else if (tagForInline === 'em' || tagForInline === 'i') nextFlagsForInline.italic = true;
      else if (tagForInline === 'a') {
        var hrefForInline = String(childForInline.getAttribute('href') || '');
        if (/^(https?:|mailto:)/i.test(hrefForInline)) nextFlagsForInline.href = hrefForInline;
      }
      walkInlineForDocumentGeneration(childForInline, nextFlagsForInline);
    }
    function walkInlineForDocumentGeneration(nodeForDocumentGeneration, flagsForDocumentGeneration) {
      var childNodesForDocumentGeneration = nodeForDocumentGeneration.childNodes || [];
      for (var iForInline = 0; iForInline < childNodesForDocumentGeneration.length; iForInline++) {
        appendChildRunForDocumentGeneration(childNodesForDocumentGeneration[iForInline], flagsForDocumentGeneration);
      }
    }
    var safeBaseFlagsForInline = baseFlagsForDocumentGeneration || {};
    var rootFlagsForInline = {
      bold: !!safeBaseFlagsForInline.bold,
      italic: !!safeBaseFlagsForInline.italic,
      href: safeBaseFlagsForInline.href || '',
      sizePt: safeBaseFlagsForInline.sizePt || 0,
      font: safeBaseFlagsForInline.font || ''
    };
    for (var iTopForInline = 0; iTopForInline < topNodesForDocumentGeneration.length; iTopForInline++) {
      appendChildRunForDocumentGeneration(topNodesForDocumentGeneration[iTopForInline], rootFlagsForInline);
    }
    return runsForDocumentGeneration.filter(function (runForFilter) {
      return runForFilter.text && runForFilter.text.length > 0;
    });
  }

  // A block element's own font-size/font-family becomes the starting point for its runs, so
  // <p style="font-size:14pt">text</p> and <p><span style="font-size:14pt">text</span></p>
  // produce the same document.
  function blockRunFlagsForDocumentGeneration(elementForDocumentGeneration) {
    var declarationsForBlock = elementStyleForDocumentGeneration(elementForDocumentGeneration);
    return {
      sizePt: parseFontSizePtForDocumentGeneration(declarationsForBlock['font-size']),
      font: parseFontFamilyForDocumentGeneration(declarationsForBlock['font-family'])
    };
  }

  function htmlInlineRunsForDocumentGeneration(elementForDocumentGeneration, baseFlagsForDocumentGeneration) {
    return htmlInlineRunsFromNodesForDocumentGeneration(
      elementForDocumentGeneration.childNodes || [],
      baseFlagsForDocumentGeneration || blockRunFlagsForDocumentGeneration(elementForDocumentGeneration)
    );
  }

  // Split a table cell into one runs array per block-level child (the <p> blocks mammoth
  // emits become real separate <w:p> paragraphs in the cell). Inline/text content not wrapped
  // in a block is grouped into its own paragraph. Always returns at least one paragraph so an
  // empty cell still emits a valid (empty) paragraph.
  function mergeRunFlagsForDocumentGeneration(baseFlagsForMerge, overrideFlagsForMerge) {
    var safeBaseForMerge = baseFlagsForMerge || {};
    var safeOverrideForMerge = overrideFlagsForMerge || {};
    return {
      sizePt: safeOverrideForMerge.sizePt || safeBaseForMerge.sizePt || 0,
      font: safeOverrideForMerge.font || safeBaseForMerge.font || ''
    };
  }

  function cellParagraphsFromElementForDocumentGeneration(cellElForDocumentGeneration) {
    var paragraphsForCell = [];
    var looseNodesForCell = [];
    var childNodesForCell = cellElForDocumentGeneration.childNodes || [];
    var cellFlagsForCell = blockRunFlagsForDocumentGeneration(cellElForDocumentGeneration);
    function flushLooseForCell() {
      if (!looseNodesForCell.length) return;
      var looseRunsForCell = htmlInlineRunsFromNodesForDocumentGeneration(looseNodesForCell, cellFlagsForCell);
      looseNodesForCell = [];
      var hasContentForCell = looseRunsForCell.some(function (runForCell) {
        return runForCell.text && runForCell.text !== '\n' && runForCell.text.trim().length > 0;
      });
      if (hasContentForCell) paragraphsForCell.push(looseRunsForCell);
    }
    for (var iForCell = 0; iForCell < childNodesForCell.length; iForCell++) {
      var childForCell = childNodesForCell[iForCell];
      if (childForCell.nodeType === 1
        && INLINE_BLOCK_BOUNDARY_TAGS_FOR_DOCUMENT_GENERATION[String(childForCell.tagName || '').toLowerCase()] === true) {
        flushLooseForCell();
        var blockRunsForCell = htmlInlineRunsForDocumentGeneration(
          childForCell,
          mergeRunFlagsForDocumentGeneration(cellFlagsForCell, blockRunFlagsForDocumentGeneration(childForCell))
        );
        if (blockRunsForCell.length) paragraphsForCell.push(blockRunsForCell);
        continue;
      }
      looseNodesForCell.push(childForCell);
    }
    flushLooseForCell();
    if (!paragraphsForCell.length) paragraphsForCell.push([]);
    return paragraphsForCell;
  }

  function base64ToUint8ForDocumentGeneration(base64ForDocumentGeneration) {
    var binaryForDocumentGeneration = atob(String(base64ForDocumentGeneration || ''));
    var lengthForDocumentGeneration = binaryForDocumentGeneration.length;
    var bytesForDocumentGeneration = new Uint8Array(lengthForDocumentGeneration);
    for (var iForDocumentGeneration = 0; iForDocumentGeneration < lengthForDocumentGeneration; iForDocumentGeneration++) {
      bytesForDocumentGeneration[iForDocumentGeneration] = binaryForDocumentGeneration.charCodeAt(iForDocumentGeneration);
    }
    return bytesForDocumentGeneration;
  }

  function computeDocxImageExtentForDocumentGeneration(widthPxForExtent, heightPxForExtent) {
    var naturalWidthEmuForExtent = Math.max(1, Math.round(Number(widthPxForExtent) * EMU_PER_PIXEL_FOR_DOCUMENT_GENERATION));
    var naturalHeightEmuForExtent = Math.max(1, Math.round(Number(heightPxForExtent) * EMU_PER_PIXEL_FOR_DOCUMENT_GENERATION));
    var scaleForExtent = Math.min(
      1,
      MAX_IMAGE_WIDTH_EMU_FOR_DOCUMENT_GENERATION / naturalWidthEmuForExtent,
      MAX_IMAGE_HEIGHT_EMU_FOR_DOCUMENT_GENERATION / naturalHeightEmuForExtent
    );
    return {
      cx: Math.max(1, Math.round(naturalWidthEmuForExtent * scaleForExtent)),
      cy: Math.max(1, Math.round(naturalHeightEmuForExtent * scaleForExtent))
    };
  }

  function makeImageDropTrackerForDocumentGeneration() {
    var countsForTracker = {};
    var totalForTracker = 0;
    return {
      add: function (reasonForTracker) {
        totalForTracker++;
        countsForTracker[reasonForTracker] = (countsForTracker[reasonForTracker] || 0) + 1;
      },
      note: function () {
        if (totalForTracker === 0) return '';
        var partsForTracker = Object.keys(countsForTracker).map(function (reasonKeyForTracker) {
          return countsForTracker[reasonKeyForTracker] + ' ' + reasonKeyForTracker;
        });
        var leadForTracker = totalForTracker === 1 ? ' image was not embedded: ' : ' images were not embedded: ';
        return totalForTracker + leadForTracker + partsForTracker.join('; ') + '.';
      }
    };
  }

  function scanImageBlobIdsForDocumentGeneration(htmlForScan) {
    var seenForScan = {};
    var matchForScan;
    IMAGE_SENTINEL_SCAN_RE_FOR_DOCUMENT_GENERATION.lastIndex = 0;
    while ((matchForScan = IMAGE_SENTINEL_SCAN_RE_FOR_DOCUMENT_GENERATION.exec(String(htmlForScan || '')))) {
      seenForScan[matchForScan[1]] = true;
    }
    return Object.keys(seenForScan);
  }

  // Fetch the source images for every distinct blob referenced by the html, one whole-array
  // round-trip per blob (deps.fetchDocxImages). Resolves to a { blobId: imagesArray|null } map;
  // index N in each array is the Nth image in mammoth's walk order, matching how the sentinels
  // were minted on read.
  function fetchImagesByBlobForDocumentGeneration(htmlForFetch, depsForFetch) {
    var fetchImagesForFetch = depsForFetch && typeof depsForFetch.fetchDocxImages === 'function'
      ? depsForFetch.fetchDocxImages
      : null;
    var blobIdsForFetch = scanImageBlobIdsForDocumentGeneration(htmlForFetch);
    return Promise.all(blobIdsForFetch.map(function (blobIdKeyForFetch) {
      if (!fetchImagesForFetch) return { blobId: blobIdKeyForFetch, images: null };
      return Promise.resolve()
        .then(function () { return fetchImagesForFetch(Number(blobIdKeyForFetch)); })
        .then(function (imagesForFetch) {
          return { blobId: blobIdKeyForFetch, images: Array.isArray(imagesForFetch) ? imagesForFetch : null };
        })
        .catch(function () { return { blobId: blobIdKeyForFetch, images: null }; });
    })).then(function (fetchedForFetch) {
      var imagesByBlobForFetch = {};
      fetchedForFetch.forEach(function (entryForFetch) {
        imagesByBlobForFetch[entryForFetch.blobId] = entryForFetch.images;
      });
      return imagesByBlobForFetch;
    });
  }

  // Shared validation: look up the Nth image of a blob and decode it to bytes, or report why it
  // cannot be embedded. Returns { ok:true, bytes, contentType, ext, wPx, hPx } | { ok:false, reason }.
  function resolveRawImageForDocumentGeneration(imagesByBlobForRaw, blobIdForRaw, indexForRaw) {
    var arrayForRaw = imagesByBlobForRaw[String(blobIdForRaw)];
    if (arrayForRaw == null) return { ok: false, reason: 'source no longer attached' };
    var rawForRaw = arrayForRaw[indexForRaw];
    if (!rawForRaw) return { ok: false, reason: 'unknown image reference' };
    var contentTypeForRaw = String(rawForRaw.contentType || '').toLowerCase();
    var extForRaw = IMAGE_CONTENT_TYPE_EXT_FOR_DOCUMENT_GENERATION[contentTypeForRaw];
    if (!extForRaw) {
      return { ok: false, reason: 'unsupported format (' + (contentTypeForRaw ? contentTypeForRaw.replace('image/', '') : 'unknown') + ')' };
    }
    var widthPxForRaw = Number(rawForRaw.width) || 0;
    var heightPxForRaw = Number(rawForRaw.height) || 0;
    if (widthPxForRaw <= 0 || heightPxForRaw <= 0) return { ok: false, reason: 'zero-size image' };
    var bytesForRaw;
    try {
      bytesForRaw = base64ToUint8ForDocumentGeneration(rawForRaw.base64);
    } catch (decodeErrForRaw) {
      return { ok: false, reason: 'corrupt image data' };
    }
    if (!bytesForRaw.length) return { ok: false, reason: 'zero-size image' };
    return { ok: true, bytes: bytesForRaw, contentType: contentTypeForRaw, ext: extForRaw, wPx: widthPxForRaw, hPx: heightPxForRaw };
  }

  // docx resolver: maps a sentinel to original bytes + OOXML EMU extent (the docx media is
  // referenced as-is, container and all). resolve() returns { ok:true, resolved } | { ok:false, reason }.
  function buildDocxImageResolverForDocumentGeneration(htmlForResolver, depsForResolver) {
    return fetchImagesByBlobForDocumentGeneration(htmlForResolver, depsForResolver).then(function (imagesByBlobForResolver) {
      return {
        resolve: function (blobIdForResolve, indexForResolve) {
          var rawResForResolve = resolveRawImageForDocumentGeneration(imagesByBlobForResolver, blobIdForResolve, indexForResolve);
          if (!rawResForResolve.ok) return rawResForResolve;
          var extentForResolve = computeDocxImageExtentForDocumentGeneration(rawResForResolve.wPx, rawResForResolve.hPx);
          return {
            ok: true,
            resolved: { bytes: rawResForResolve.bytes, ext: rawResForResolve.ext, cx: extentForResolve.cx, cy: extentForResolve.cy }
          };
        }
      };
    });
  }

  // pdf resolver: maps a sentinel to original bytes + content type + natural pixel size. The
  // bytes are rasterized to JPEG later (PDF has no PNG/GIF decoder), so resolve() stays sync and
  // only carries what the async rasterize pass needs.
  function buildPdfImageResolverForDocumentGeneration(htmlForResolver, depsForResolver) {
    return fetchImagesByBlobForDocumentGeneration(htmlForResolver, depsForResolver).then(function (imagesByBlobForResolver) {
      return {
        resolve: function (blobIdForResolve, indexForResolve) {
          var rawResForResolve = resolveRawImageForDocumentGeneration(imagesByBlobForResolver, blobIdForResolve, indexForResolve);
          if (!rawResForResolve.ok) return rawResForResolve;
          return {
            ok: true,
            resolved: { bytes: rawResForResolve.bytes, contentType: rawResForResolve.contentType, wPx: rawResForResolve.wPx, hPx: rawResForResolve.hPx }
          };
        }
      };
    });
  }

  // Turn a resolved PDF image (original bytes) into embeddable JPEG bytes plus the pixel size to
  // declare in the XObject. Source JPEGs pass through losslessly (DCTDecode embeds them as-is);
  // PNG/GIF are drawn onto an opaque white OffscreenCanvas and re-encoded to JPEG, which also
  // flattens transparency. Oversized rasters are scaled down to MAX_PDF_IMAGE_RASTER_DIM.
  function rasterizePdfImageToJpegForDocumentGeneration(bytesForRaster, contentTypeForRaster, wPxForRaster, hPxForRaster) {
    if (contentTypeForRaster === 'image/jpeg') {
      return Promise.resolve({
        jpegBytes: bytesForRaster,
        wPx: Math.max(1, Math.round(Number(wPxForRaster) || 1)),
        hPx: Math.max(1, Math.round(Number(hPxForRaster) || 1))
      });
    }
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      return Promise.reject(new Error('no raster support'));
    }
    var blobForRaster = new Blob([bytesForRaster], { type: contentTypeForRaster });
    return createImageBitmap(blobForRaster).then(function (bitmapForRaster) {
      var naturalWForRaster = bitmapForRaster.width || Number(wPxForRaster) || 0;
      var naturalHForRaster = bitmapForRaster.height || Number(hPxForRaster) || 0;
      if (naturalWForRaster <= 0 || naturalHForRaster <= 0) {
        try { if (bitmapForRaster.close) bitmapForRaster.close(); } catch (closeErrForRaster) {}
        return Promise.reject(new Error('zero-size raster'));
      }
      var scaleForRaster = Math.min(
        1,
        MAX_PDF_IMAGE_RASTER_DIM_FOR_DOCUMENT_GENERATION / naturalWForRaster,
        MAX_PDF_IMAGE_RASTER_DIM_FOR_DOCUMENT_GENERATION / naturalHForRaster
      );
      var targetWForRaster = Math.max(1, Math.round(naturalWForRaster * scaleForRaster));
      var targetHForRaster = Math.max(1, Math.round(naturalHForRaster * scaleForRaster));
      var canvasForRaster = new OffscreenCanvas(targetWForRaster, targetHForRaster);
      var ctxForRaster = canvasForRaster.getContext('2d');
      ctxForRaster.fillStyle = '#ffffff';
      ctxForRaster.fillRect(0, 0, targetWForRaster, targetHForRaster);
      ctxForRaster.drawImage(bitmapForRaster, 0, 0, targetWForRaster, targetHForRaster);
      try { if (bitmapForRaster.close) bitmapForRaster.close(); } catch (closeErr2ForRaster) {}
      return canvasForRaster.convertToBlob({ type: 'image/jpeg', quality: PDF_IMAGE_JPEG_QUALITY_FOR_DOCUMENT_GENERATION })
        .then(function (jpegBlobForRaster) { return jpegBlobForRaster.arrayBuffer(); })
        .then(function (bufferForRaster) {
          return { jpegBytes: new Uint8Array(bufferForRaster), wPx: targetWForRaster, hPx: targetHForRaster };
        });
    });
  }

  // Replace each { type:'image', resolved:{ bytes, contentType, wPx, hPx } } block with one
  // carrying ready-to-embed JPEG bytes, dropping (and noting) any that cannot be rasterized.
  // Runs sequentially to bound canvas/memory pressure across many images.
  function rasterizePdfImageBlocksForDocumentGeneration(blocksForRaster, dropTrackerForRaster) {
    var chainForRaster = Promise.resolve();
    var outBlocksForRaster = [];
    (blocksForRaster || []).forEach(function (blockForRaster) {
      if (!blockForRaster || blockForRaster.type !== 'image') {
        chainForRaster = chainForRaster.then(function () { outBlocksForRaster.push(blockForRaster); });
        return;
      }
      chainForRaster = chainForRaster.then(function () {
        var resolvedForRaster = blockForRaster.resolved || {};
        return rasterizePdfImageToJpegForDocumentGeneration(resolvedForRaster.bytes, resolvedForRaster.contentType, resolvedForRaster.wPx, resolvedForRaster.hPx)
          .then(function (jpegForRaster) {
            if (!jpegForRaster || !jpegForRaster.jpegBytes || !jpegForRaster.jpegBytes.length) {
              if (dropTrackerForRaster) dropTrackerForRaster.add('could not be decoded');
              return;
            }
            outBlocksForRaster.push({ type: 'image', resolved: { jpegBytes: jpegForRaster.jpegBytes, wPx: jpegForRaster.wPx, hPx: jpegForRaster.hPx } });
          })
          .catch(function () {
            if (dropTrackerForRaster) dropTrackerForRaster.add('could not be decoded');
          });
      });
    });
    return chainForRaster.then(function () { return outBlocksForRaster; });
  }

  function bytesToBinaryStringForDocumentGeneration(bytesForBinary) {
    var chunkSizeForBinary = 0x8000;
    var stringForBinary = '';
    for (var iForBinary = 0; iForBinary < bytesForBinary.length; iForBinary += chunkSizeForBinary) {
      stringForBinary += String.fromCharCode.apply(null, bytesForBinary.subarray(iForBinary, iForBinary + chunkSizeForBinary));
    }
    return stringForBinary;
  }

  function htmlToBlocksForDocumentGeneration(htmlStringForDocumentGeneration, imageResolverForDocumentGeneration, dropTrackerForDocumentGeneration) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('HTML input requires a DOM environment and is only supported for docx and pdf.');
    }
    var rawHtmlForDocumentGeneration = String(htmlStringForDocumentGeneration || '');
    if (rawHtmlForDocumentGeneration.length > 200000) {
      rawHtmlForDocumentGeneration = rawHtmlForDocumentGeneration.slice(0, 200000);
    }
    var parsedDocForDocumentGeneration = new DOMParser().parseFromString(rawHtmlForDocumentGeneration, 'text/html');
    var bodyForDocumentGeneration = parsedDocForDocumentGeneration && parsedDocForDocumentGeneration.body;
    var blocksForDocumentGeneration = [];
    if (!bodyForDocumentGeneration) return { blocks: blocksForDocumentGeneration, docDefaults: null };
    var docDefaultsForDocumentGeneration = readDocumentDefaultsFromBodyForDocumentGeneration(bodyForDocumentGeneration);
    var embeddedImageCountForDocumentGeneration = 0;

    function processSentinelImgForDocumentGeneration(imgElForDocumentGeneration) {
      // No resolver means the PDF path or an API caller with no image support: drop img as
      // before. Only our own minted sentinel src is honored; a model-supplied http/data src
      // is never fetched or embedded.
      if (!imageResolverForDocumentGeneration) return;
      if (blocksForDocumentGeneration.length >= MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) return;
      var srcForImg = String((imgElForDocumentGeneration.getAttribute && imgElForDocumentGeneration.getAttribute('src')) || '');
      var sentinelMatchForImg = srcForImg.match(IMAGE_SENTINEL_RE_FOR_DOCUMENT_GENERATION);
      if (!sentinelMatchForImg) return;
      if (embeddedImageCountForDocumentGeneration >= MAX_DOCX_IMAGES_FOR_DOCUMENT_GENERATION) {
        if (dropTrackerForDocumentGeneration) dropTrackerForDocumentGeneration.add('image limit reached');
        return;
      }
      var resolutionForImg = imageResolverForDocumentGeneration.resolve(sentinelMatchForImg[1], Number(sentinelMatchForImg[2]));
      if (!resolutionForImg.ok) {
        if (dropTrackerForDocumentGeneration) dropTrackerForDocumentGeneration.add(resolutionForImg.reason);
        return;
      }
      embeddedImageCountForDocumentGeneration++;
      blocksForDocumentGeneration.push({ type: 'image', resolved: resolutionForImg.resolved });
    }

    function emitImageBlocksFromContainerForDocumentGeneration(containerForImg) {
      // mammoth emits images as <p><img></p>, so paragraph containers must be scanned for
      // descendant imgs; getElementsByTagName('img') on an <img> returns [], which is why a
      // direct-child img is handled by processSentinelImg on the node itself.
      if (!imageResolverForDocumentGeneration || !containerForImg.getElementsByTagName) return;
      var imgListForImg = containerForImg.getElementsByTagName('img');
      for (var iForImg = 0; iForImg < imgListForImg.length; iForImg++) {
        processSentinelImgForDocumentGeneration(imgListForImg[iForImg]);
      }
    }

    function handleListForDocumentGeneration(listElForDocumentGeneration, orderedForDocumentGeneration, levelForDocumentGeneration) {
      var clampedLevelForDocumentGeneration = levelForDocumentGeneration > 2 ? 2 : levelForDocumentGeneration;
      var itemsForDocumentGeneration = [];
      var nestedListsForDocumentGeneration = [];
      var listChildrenForDocumentGeneration = listElForDocumentGeneration.children || [];
      var listFlagsForDocumentGeneration = blockRunFlagsForDocumentGeneration(listElForDocumentGeneration);
      for (var liIndexForDocumentGeneration = 0; liIndexForDocumentGeneration < listChildrenForDocumentGeneration.length; liIndexForDocumentGeneration++) {
        var liForDocumentGeneration = listChildrenForDocumentGeneration[liIndexForDocumentGeneration];
        if (String(liForDocumentGeneration.tagName || '').toLowerCase() !== 'li') continue;
        itemsForDocumentGeneration.push(htmlInlineRunsForDocumentGeneration(
          liForDocumentGeneration,
          mergeRunFlagsForDocumentGeneration(listFlagsForDocumentGeneration, blockRunFlagsForDocumentGeneration(liForDocumentGeneration))
        ));
        var liChildrenForDocumentGeneration = liForDocumentGeneration.children || [];
        for (var liChildIndexForDocumentGeneration = 0; liChildIndexForDocumentGeneration < liChildrenForDocumentGeneration.length; liChildIndexForDocumentGeneration++) {
          var liChildForDocumentGeneration = liChildrenForDocumentGeneration[liChildIndexForDocumentGeneration];
          var liChildTagForDocumentGeneration = String(liChildForDocumentGeneration.tagName || '').toLowerCase();
          if (liChildTagForDocumentGeneration === 'ul' || liChildTagForDocumentGeneration === 'ol') {
            nestedListsForDocumentGeneration.push(liChildForDocumentGeneration);
          }
        }
      }
      if (itemsForDocumentGeneration.length) {
        blocksForDocumentGeneration.push({ type: 'list', ordered: orderedForDocumentGeneration, level: clampedLevelForDocumentGeneration, items: itemsForDocumentGeneration });
      }
      for (var nestedIndexForDocumentGeneration = 0; nestedIndexForDocumentGeneration < nestedListsForDocumentGeneration.length; nestedIndexForDocumentGeneration++) {
        var nestedListForDocumentGeneration = nestedListsForDocumentGeneration[nestedIndexForDocumentGeneration];
        handleListForDocumentGeneration(nestedListForDocumentGeneration, String(nestedListForDocumentGeneration.tagName || '').toLowerCase() === 'ol', clampedLevelForDocumentGeneration + 1);
      }
    }

    function handleTableForDocumentGeneration(tableElForDocumentGeneration) {
      var rowsForDocumentGeneration = [];
      var hasHeaderForDocumentGeneration = false;
      // querySelectorAll('tr') also matches rows of a table nested inside a cell, which would
      // hoist those rows into this table. Keep only rows whose nearest table ancestor is this
      // one; a nested table is then left in its cell and flattened to text by the cell walker.
      var allRowsForDocumentGeneration = tableElForDocumentGeneration.querySelectorAll('tr');
      var trElementsForDocumentGeneration = [];
      for (var rowScanForDocumentGeneration = 0; rowScanForDocumentGeneration < allRowsForDocumentGeneration.length; rowScanForDocumentGeneration++) {
        var rowCandidateForDocumentGeneration = allRowsForDocumentGeneration[rowScanForDocumentGeneration];
        if (!rowCandidateForDocumentGeneration.closest || rowCandidateForDocumentGeneration.closest('table') === tableElForDocumentGeneration) {
          trElementsForDocumentGeneration.push(rowCandidateForDocumentGeneration);
        }
      }
      for (var trIndexForDocumentGeneration = 0; trIndexForDocumentGeneration < trElementsForDocumentGeneration.length; trIndexForDocumentGeneration++) {
        var cellsForDocumentGeneration = [];
        var cellElementsForDocumentGeneration = trElementsForDocumentGeneration[trIndexForDocumentGeneration].children || [];
        for (var cellIndexForDocumentGeneration = 0; cellIndexForDocumentGeneration < cellElementsForDocumentGeneration.length; cellIndexForDocumentGeneration++) {
          var cellForDocumentGeneration = cellElementsForDocumentGeneration[cellIndexForDocumentGeneration];
          var cellTagForDocumentGeneration = String(cellForDocumentGeneration.tagName || '').toLowerCase();
          if (cellTagForDocumentGeneration !== 'td' && cellTagForDocumentGeneration !== 'th') continue;
          var isHeaderCellForDocumentGeneration = cellTagForDocumentGeneration === 'th';
          if (isHeaderCellForDocumentGeneration) hasHeaderForDocumentGeneration = true;
          var colSpanAttrForDocumentGeneration = parseInt(cellForDocumentGeneration.getAttribute('colspan'), 10);
          var rowSpanAttrForDocumentGeneration = parseInt(cellForDocumentGeneration.getAttribute('rowspan'), 10);
          cellsForDocumentGeneration.push({
            paragraphs: cellParagraphsFromElementForDocumentGeneration(cellForDocumentGeneration),
            header: isHeaderCellForDocumentGeneration,
            colSpan: (Number.isFinite(colSpanAttrForDocumentGeneration) && colSpanAttrForDocumentGeneration > 1) ? colSpanAttrForDocumentGeneration : 1,
            rowSpan: (Number.isFinite(rowSpanAttrForDocumentGeneration) && rowSpanAttrForDocumentGeneration > 1) ? rowSpanAttrForDocumentGeneration : 1
          });
        }
        if (cellsForDocumentGeneration.length) rowsForDocumentGeneration.push(cellsForDocumentGeneration);
      }
      if (rowsForDocumentGeneration.length) {
        // Borders are the model's call: it marks a layout table with border="0" or
        // role="presentation"/"none", and a bordered data table with border="1".
        // Left unspecified, tables are bordered by default. A style attribute carrying
        // border properties is more specific than either and wins, so a table read out of a
        // source document keeps that document's own line weight and colour.
        var borderedForTableBlock;
        var roleAttrForTableBlock = String(tableElForDocumentGeneration.getAttribute('role') || '').toLowerCase();
        var borderAttrForTableBlock = tableElForDocumentGeneration.getAttribute('border');
        if (roleAttrForTableBlock === 'presentation' || roleAttrForTableBlock === 'none') {
          borderedForTableBlock = false;
        } else if (borderAttrForTableBlock !== null) {
          borderedForTableBlock = String(borderAttrForTableBlock).trim() !== '0';
        }
        var borderSpecForTableBlock = tableBorderSpecFromStyleForDocumentGeneration(elementStyleForDocumentGeneration(tableElForDocumentGeneration));
        if (borderSpecForTableBlock !== undefined) borderedForTableBlock = !!borderSpecForTableBlock;
        blocksForDocumentGeneration.push({
          type: 'table',
          rows: rowsForDocumentGeneration,
          header: hasHeaderForDocumentGeneration,
          bordered: borderedForTableBlock,
          borderSpec: borderSpecForTableBlock || null
        });
      }
    }

    function walkBlockForDocumentGeneration(containerForDocumentGeneration) {
      var childNodesForDocumentGeneration = containerForDocumentGeneration.childNodes || [];
      for (var nodeIndexForDocumentGeneration = 0; nodeIndexForDocumentGeneration < childNodesForDocumentGeneration.length; nodeIndexForDocumentGeneration++) {
        if (blocksForDocumentGeneration.length >= MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) break;
        var nodeForDocumentGeneration = childNodesForDocumentGeneration[nodeIndexForDocumentGeneration];
        if (nodeForDocumentGeneration.nodeType === 3) {
          var looseTextForDocumentGeneration = String(nodeForDocumentGeneration.nodeValue || '').replace(/\s+/g, ' ').trim();
          if (looseTextForDocumentGeneration) {
            blocksForDocumentGeneration.push({ type: 'paragraph', runs: [{ text: looseTextForDocumentGeneration }] });
          }
          continue;
        }
        if (nodeForDocumentGeneration.nodeType !== 1) continue;
        var tagForDocumentGeneration = String(nodeForDocumentGeneration.tagName || '').toLowerCase();
        if (/^h[1-6]$/.test(tagForDocumentGeneration)) {
          blocksForDocumentGeneration.push({ type: 'heading', level: Number(tagForDocumentGeneration.charAt(1)), runs: htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration) });
        } else if (tagForDocumentGeneration === 'p' || tagForDocumentGeneration === 'blockquote' || tagForDocumentGeneration === 'pre') {
          var paragraphRunsForDocumentGeneration = htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration);
          if (paragraphRunsForDocumentGeneration.length) {
            blocksForDocumentGeneration.push({ type: 'paragraph', runs: paragraphRunsForDocumentGeneration });
          }
          emitImageBlocksFromContainerForDocumentGeneration(nodeForDocumentGeneration);
        } else if (tagForDocumentGeneration === 'ul' || tagForDocumentGeneration === 'ol') {
          handleListForDocumentGeneration(nodeForDocumentGeneration, tagForDocumentGeneration === 'ol', 0);
        } else if (tagForDocumentGeneration === 'table') {
          handleTableForDocumentGeneration(nodeForDocumentGeneration);
        } else if (tagForDocumentGeneration === 'img') {
          processSentinelImgForDocumentGeneration(nodeForDocumentGeneration);
        } else if (tagForDocumentGeneration === 'script' || tagForDocumentGeneration === 'style' || tagForDocumentGeneration === 'head' || tagForDocumentGeneration === 'nav') {
          continue;
        } else {
          walkBlockForDocumentGeneration(nodeForDocumentGeneration);
        }
      }
    }

    walkBlockForDocumentGeneration(bodyForDocumentGeneration);
    return {
      blocks: blocksForDocumentGeneration.slice(0, MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION),
      docDefaults: docDefaultsForDocumentGeneration
    };
  }

  function makeDocxRelCollectorForDocumentGeneration() {
    var hyperlinksForDocumentGeneration = [];
    var numberingForDocumentGeneration = [];
    var imagesForDocumentGeneration = [];
    return {
      hyperlinks: hyperlinksForDocumentGeneration,
      numbering: numberingForDocumentGeneration,
      images: imagesForDocumentGeneration,
      addHyperlink: function (hrefForDocumentGeneration) {
        var relIdForDocumentGeneration = 'rIdHl' + (hyperlinksForDocumentGeneration.length + 1);
        hyperlinksForDocumentGeneration.push({ id: relIdForDocumentGeneration, href: hrefForDocumentGeneration });
        return relIdForDocumentGeneration;
      },
      allocNumbering: function (orderedForDocumentGeneration) {
        var numIdForDocumentGeneration = numberingForDocumentGeneration.length + 1;
        numberingForDocumentGeneration.push({ numId: numIdForDocumentGeneration, abstractId: orderedForDocumentGeneration ? 1 : 0 });
        return String(numIdForDocumentGeneration);
      },
      addImage: function (bytesForDocumentGeneration, extForDocumentGeneration) {
        var ordinalForDocumentGeneration = imagesForDocumentGeneration.length + 1;
        var relIdForDocumentGeneration = 'rIdImg' + ordinalForDocumentGeneration;
        var partNameForDocumentGeneration = 'media/image' + ordinalForDocumentGeneration + '.' + extForDocumentGeneration;
        imagesForDocumentGeneration.push({
          relId: relIdForDocumentGeneration,
          partName: partNameForDocumentGeneration,
          ext: extForDocumentGeneration,
          bytes: bytesForDocumentGeneration
        });
        return { relId: relIdForDocumentGeneration, ordinal: ordinalForDocumentGeneration };
      }
    };
  }

  function docxImageDrawingXmlForDocumentGeneration(relIdForImage, drawingIdForImage, cxForImage, cyForImage) {
    var pictureNameForImage = 'Picture ' + drawingIdForImage;
    return '<w:p><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cxForImage + '" cy="' + cyForImage + '"/>' +
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:docPr id="' + drawingIdForImage + '" name="' + pictureNameForImage + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:pic>' +
            '<pic:nvPicPr>' +
              '<pic:cNvPr id="' + drawingIdForImage + '" name="' + pictureNameForImage + '"/>' +
              '<pic:cNvPicPr/>' +
            '</pic:nvPicPr>' +
            '<pic:blipFill>' +
              '<a:blip r:embed="' + relIdForImage + '"/>' +
              '<a:stretch><a:fillRect/></a:stretch>' +
            '</pic:blipFill>' +
            '<pic:spPr>' +
              '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cxForImage + '" cy="' + cyForImage + '"/></a:xfrm>' +
              '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
            '</pic:spPr>' +
          '</pic:pic>' +
        '</a:graphicData></a:graphic>' +
      '</wp:inline>' +
    '</w:drawing></w:r></w:p>';
  }

  function buildDocxNumberingXmlForDocumentGeneration(numberingEntriesForDocumentGeneration) {
    var bulletGlyphsForDocumentGeneration = ['•', '◦', '▪'];
    var orderedFormatsForDocumentGeneration = ['decimal', 'lowerLetter', 'lowerRoman'];
    var abstractBulletForDocumentGeneration = '<w:abstractNum w:abstractNumId="0">';
    var abstractOrderedForDocumentGeneration = '<w:abstractNum w:abstractNumId="1">';
    for (var levelForNumbering = 0; levelForNumbering < 3; levelForNumbering++) {
      var indentForNumbering = 720 * (levelForNumbering + 1);
      abstractBulletForDocumentGeneration += '<w:lvl w:ilvl="' + levelForNumbering + '"><w:numFmt w:val="bullet"/><w:lvlText w:val="' + bulletGlyphsForDocumentGeneration[levelForNumbering] + '"/><w:pPr><w:ind w:left="' + indentForNumbering + '" w:hanging="360"/></w:pPr></w:lvl>';
      abstractOrderedForDocumentGeneration += '<w:lvl w:ilvl="' + levelForNumbering + '"><w:start w:val="1"/><w:numFmt w:val="' + orderedFormatsForDocumentGeneration[levelForNumbering] + '"/><w:lvlText w:val="%' + (levelForNumbering + 1) + '."/><w:pPr><w:ind w:left="' + indentForNumbering + '" w:hanging="360"/></w:pPr></w:lvl>';
    }
    abstractBulletForDocumentGeneration += '</w:abstractNum>';
    abstractOrderedForDocumentGeneration += '</w:abstractNum>';
    var numsXmlForDocumentGeneration = numberingEntriesForDocumentGeneration.map(function (entryForNumbering) {
      return '<w:num w:numId="' + entryForNumbering.numId + '"><w:abstractNumId w:val="' + entryForNumbering.abstractId + '"/></w:num>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      abstractBulletForDocumentGeneration + abstractOrderedForDocumentGeneration + numsXmlForDocumentGeneration +
      '</w:numbering>';
  }

  function docxSectionPropertiesXmlForDocumentGeneration(docDefaultsForDocumentGeneration) {
    var defaultsForSection = docDefaultsForDocumentGeneration || {};
    var marginsForSection = defaultsForSection.margins || null;
    function twipsForSection(pointsForSection, fallbackPointsForSection) {
      var resolvedPointsForSection = (pointsForSection > 0) ? pointsForSection : fallbackPointsForSection;
      return Math.round(resolvedPointsForSection * 20);
    }
    var pageWidthTwipsForSection = twipsForSection(defaultsForSection.pageWidthPt, DEFAULT_PAGE_WIDTH_PT_FOR_DOCUMENT_GENERATION);
    var pageHeightTwipsForSection = twipsForSection(defaultsForSection.pageHeightPt, DEFAULT_PAGE_HEIGHT_PT_FOR_DOCUMENT_GENERATION);
    return '<w:sectPr><w:pgSz w:w="' + pageWidthTwipsForSection + '" w:h="' + pageHeightTwipsForSection + '"/>' +
      '<w:pgMar w:top="' + twipsForSection(marginsForSection && marginsForSection.top, DEFAULT_DOCX_MARGIN_PT_FOR_DOCUMENT_GENERATION) +
      '" w:right="' + twipsForSection(marginsForSection && marginsForSection.right, DEFAULT_DOCX_MARGIN_PT_FOR_DOCUMENT_GENERATION) +
      '" w:bottom="' + twipsForSection(marginsForSection && marginsForSection.bottom, DEFAULT_DOCX_MARGIN_PT_FOR_DOCUMENT_GENERATION) +
      '" w:left="' + twipsForSection(marginsForSection && marginsForSection.left, DEFAULT_DOCX_MARGIN_PT_FOR_DOCUMENT_GENERATION) +
      '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  }

  function buildDocxStylesXmlForDocumentGeneration(docDefaultsForDocumentGeneration) {
    // Heading sizes in half-points: 16/14/12/11/10/10 pt. mammoth's default style map
    // matches heading paragraphs by styleId (Heading1-6), so those ids must be exact;
    // the w:name keeps the styles correct for Word's own outline/navigation.
    var headingSizesForDocumentGeneration = ['32', '28', '24', '22', '20', '20'];
    var headingStylesForDocumentGeneration = '';
    for (var headingLevelForStyles = 1; headingLevelForStyles <= 6; headingLevelForStyles++) {
      headingStylesForDocumentGeneration +=
        '<w:style w:type="paragraph" w:styleId="Heading' + headingLevelForStyles + '">' +
        '<w:name w:val="heading ' + headingLevelForStyles + '"/>' +
        '<w:basedOn w:val="Normal"/>' +
        '<w:next w:val="Normal"/>' +
        '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="' + (headingLevelForStyles - 1) + '"/></w:pPr>' +
        '<w:rPr><w:b/><w:sz w:val="' + headingSizesForDocumentGeneration[headingLevelForStyles - 1] + '"/></w:rPr>' +
        '</w:style>';
    }
    // The document default font rides w:docDefaults so every paragraph inherits it without a
    // per-run w:rFonts/w:sz, which keeps the body small and lets a run-level size still win.
    var defaultsForStyles = docDefaultsForDocumentGeneration || {};
    var defaultRunPropsForStyles = '';
    if (defaultsForStyles.fontFamily) {
      var escapedDefaultFontForStyles = escapeXmlForDocumentGeneration(defaultsForStyles.fontFamily);
      defaultRunPropsForStyles += '<w:rFonts w:ascii="' + escapedDefaultFontForStyles + '" w:hAnsi="' + escapedDefaultFontForStyles
        + '" w:cs="' + escapedDefaultFontForStyles + '"/>';
    }
    if (defaultsForStyles.fontSizePt) {
      var defaultHalfPointsForStyles = Math.max(2, Math.min(MAX_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION * 2, Math.round(defaultsForStyles.fontSizePt * 2)));
      defaultRunPropsForStyles += '<w:sz w:val="' + defaultHalfPointsForStyles + '"/><w:szCs w:val="' + defaultHalfPointsForStyles + '"/>';
    }
    var docDefaultsXmlForStyles = defaultRunPropsForStyles
      ? '<w:docDefaults><w:rPrDefault><w:rPr>' + defaultRunPropsForStyles + '</w:rPr></w:rPrDefault></w:docDefaults>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      docDefaultsXmlForStyles +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      headingStylesForDocumentGeneration +
      '</w:styles>';
  }

  // w:rPr children must appear in schema order (rFonts, b, i, color, sz, szCs, u), which is
  // why the properties are assembled here rather than appended by each caller in turn.
  function docxRunPropsXmlForDocumentGeneration(runForDocumentGeneration, baseOptionsForDocumentGeneration, isLinkForDocumentGeneration) {
    var safeRunForProps = runForDocumentGeneration || {};
    var safeBaseForProps = baseOptionsForDocumentGeneration || {};
    var fontForProps = safeRunForProps.font || safeBaseForProps.font || '';
    var sizePtForProps = Number(safeRunForProps.sizePt) || Number(safeBaseForProps.sizePt) || 0;
    var propsInnerForProps = '';
    if (fontForProps) {
      var escapedFontForProps = escapeXmlForDocumentGeneration(fontForProps);
      propsInnerForProps += '<w:rFonts w:ascii="' + escapedFontForProps + '" w:hAnsi="' + escapedFontForProps
        + '" w:cs="' + escapedFontForProps + '"/>';
    }
    if (safeRunForProps.bold || safeBaseForProps.bold) propsInnerForProps += '<w:b/>';
    if (safeRunForProps.italic) propsInnerForProps += '<w:i/>';
    if (isLinkForDocumentGeneration) propsInnerForProps += '<w:color w:val="0563C1"/>';
    if (sizePtForProps) {
      var halfPointsForProps = Math.max(2, Math.min(MAX_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION * 2, Math.round(sizePtForProps * 2)));
      propsInnerForProps += '<w:sz w:val="' + halfPointsForProps + '"/><w:szCs w:val="' + halfPointsForProps + '"/>';
    }
    if (isLinkForDocumentGeneration) propsInnerForProps += '<w:u w:val="single"/>';
    return propsInnerForProps ? '<w:rPr>' + propsInnerForProps + '</w:rPr>' : '';
  }

  function docxRunsXmlForDocumentGeneration(contentForDocumentGeneration, baseOptionsForDocumentGeneration, relCollectorForDocumentGeneration) {
    var runsForDocumentGeneration = Array.isArray(contentForDocumentGeneration)
      ? contentForDocumentGeneration
      : [{ text: String(contentForDocumentGeneration == null ? '' : contentForDocumentGeneration) }];
    if (runsForDocumentGeneration.length === 0) runsForDocumentGeneration = [{ text: '' }];
    return runsForDocumentGeneration.map(function (runForDocumentGeneration) {
      var safeRunForDocumentGeneration = runForDocumentGeneration || {};
      var hrefForRunForDocumentGeneration = (typeof safeRunForDocumentGeneration.href === 'string' && safeRunForDocumentGeneration.href) ? safeRunForDocumentGeneration.href : '';
      var isLinkForDocumentGeneration = hrefForRunForDocumentGeneration && relCollectorForDocumentGeneration;
      var runPropsXmlForDocumentGeneration = docxRunPropsXmlForDocumentGeneration(
        safeRunForDocumentGeneration,
        baseOptionsForDocumentGeneration,
        isLinkForDocumentGeneration
      );
      var textLinesForDocumentGeneration = String(safeRunForDocumentGeneration.text == null ? '' : safeRunForDocumentGeneration.text).split(/\r?\n/);
      var textXmlForDocumentGeneration = textLinesForDocumentGeneration.map(function (lineForRunForDocumentGeneration, lineIndexForRunForDocumentGeneration) {
        return (lineIndexForRunForDocumentGeneration > 0 ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + escapeXmlForDocumentGeneration(lineForRunForDocumentGeneration) + '</w:t>';
      }).join('');
      var runXmlForDocumentGeneration = '<w:r>' + runPropsXmlForDocumentGeneration + textXmlForDocumentGeneration + '</w:r>';
      if (isLinkForDocumentGeneration) {
        var relIdForRunForDocumentGeneration = relCollectorForDocumentGeneration.addHyperlink(hrefForRunForDocumentGeneration);
        return '<w:hyperlink r:id="' + relIdForRunForDocumentGeneration + '">' + runXmlForDocumentGeneration + '</w:hyperlink>';
      }
      return runXmlForDocumentGeneration;
    }).join('');
  }

  function docxParagraphForDocumentGeneration(contentForDocumentGeneration, optionsForDocumentGeneration, relCollectorForDocumentGeneration) {
    var optsForDocumentGeneration = optionsForDocumentGeneration || {};
    var paragraphPropsInnerForDocumentGeneration = '';
    if (optsForDocumentGeneration.headingLevel) {
      // Use a real Word heading style so the level survives the docx -> HTML -> docx
      // round-trip (mammoth maps Heading1-6 back to h1-h6). The bold/size/spacing live
      // in styles.xml; per-run bold/italic still emit normally via the runs below, and a
      // run carrying its own size overrides the style's, which is what an explicit
      // font-size read out of a source heading has to do.
      paragraphPropsInnerForDocumentGeneration += '<w:pStyle w:val="Heading' + optsForDocumentGeneration.headingLevel + '"/>';
    }
    if (optsForDocumentGeneration.numPr) {
      paragraphPropsInnerForDocumentGeneration += '<w:numPr><w:ilvl w:val="' + optsForDocumentGeneration.numPr.ilvl + '"/><w:numId w:val="' + optsForDocumentGeneration.numPr.numId + '"/></w:numPr>';
    }
    var paragraphPropsXmlForDocumentGeneration = paragraphPropsInnerForDocumentGeneration ? '<w:pPr>' + paragraphPropsInnerForDocumentGeneration + '</w:pPr>' : '';
    var runsXmlForDocumentGeneration = docxRunsXmlForDocumentGeneration(
      contentForDocumentGeneration,
      { bold: !!optsForDocumentGeneration.bold },
      relCollectorForDocumentGeneration
    );
    return '<w:p>' + paragraphPropsXmlForDocumentGeneration + runsXmlForDocumentGeneration + '</w:p>';
  }

  function normalizeRichTableCellForDocumentGeneration(cellForDocumentGeneration) {
    function clampSpanForDocumentGeneration(valueForCell, maxForCell) {
      var spanForCell = Math.floor(Number(valueForCell));
      if (!Number.isFinite(spanForCell) || spanForCell < 1) return 1;
      return Math.min(spanForCell, maxForCell);
    }
    // A rich cell may carry `paragraphs` (array of runs arrays, the html path) or a single
    // `runs` array (legacy/API), which is treated as one paragraph. Plain scalars become one
    // single-run paragraph.
    if (cellForDocumentGeneration && typeof cellForDocumentGeneration === 'object'
        && (Array.isArray(cellForDocumentGeneration.paragraphs) || Array.isArray(cellForDocumentGeneration.runs))) {
      var paragraphsForCell = Array.isArray(cellForDocumentGeneration.paragraphs)
        ? cellForDocumentGeneration.paragraphs.map(function (paragraphForCell) {
            return Array.isArray(paragraphForCell) ? paragraphForCell : [{ text: String(paragraphForCell == null ? '' : paragraphForCell) }];
          })
        : [cellForDocumentGeneration.runs];
      if (!paragraphsForCell.length) paragraphsForCell = [[]];
      return {
        paragraphs: paragraphsForCell,
        header: !!cellForDocumentGeneration.header,
        colSpan: clampSpanForDocumentGeneration(cellForDocumentGeneration.colSpan, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION),
        rowSpan: clampSpanForDocumentGeneration(cellForDocumentGeneration.rowSpan, MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION)
      };
    }
    return {
      paragraphs: [[{ text: String(cellForDocumentGeneration == null ? '' : cellForDocumentGeneration) }]],
      header: false,
      colSpan: 1,
      rowSpan: 1
    };
  }

  function plainTextFromTableCellForDocumentGeneration(cellForDocumentGeneration) {
    var paragraphsForCell = (cellForDocumentGeneration && Array.isArray(cellForDocumentGeneration.paragraphs))
      ? cellForDocumentGeneration.paragraphs
      : null;
    if (paragraphsForCell) {
      return paragraphsForCell.map(function (runsForParagraphForCell) {
        return (Array.isArray(runsForParagraphForCell) ? runsForParagraphForCell : []).map(function (runForCell) {
          return String((runForCell && runForCell.text) || '');
        }).join('').replace(/\s+/g, ' ').trim();
      }).filter(function (textForParagraphForCell) {
        return textForParagraphForCell.length > 0;
      }).join('\n');
    }
    var runsForCell = (cellForDocumentGeneration && Array.isArray(cellForDocumentGeneration.runs))
      ? cellForDocumentGeneration.runs
      : null;
    if (!runsForCell) return String(cellForDocumentGeneration == null ? '' : cellForDocumentGeneration);
    return runsForCell.map(function (runForCell) {
      return String((runForCell && runForCell.text) || '');
    }).join('').replace(/\s+/g, ' ').trim();
  }

  // Turn rows of cells (rich {paragraphs,colSpan,rowSpan,header} or plain scalars) into a
  // rectangular grid. Each output row tiles the full width with descriptors: a real
  // 'cell', a 'vmerge' continuation (covered from above by a rowSpan), or an 'empty'
  // pad (ragged rows). This is what makes colspan/rowspan emit valid OOXML and keeps
  // PDF columns aligned. colCount is the grid width.
  function expandTableGridForDocumentGeneration(rowsForDocumentGeneration) {
    var inputRowsForGrid = Array.isArray(rowsForDocumentGeneration)
      ? rowsForDocumentGeneration.slice(0, MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION)
      : [];
    var rowCountForGrid = inputRowsForGrid.length;
    if (rowCountForGrid === 0) return { colCount: 0, rows: [] };

    var occupiedForGrid = [];
    var placedForGrid = [];
    for (var initRowForGrid = 0; initRowForGrid < rowCountForGrid; initRowForGrid++) {
      occupiedForGrid[initRowForGrid] = [];
      placedForGrid[initRowForGrid] = [];
    }

    var colCountForGrid = 0;
    for (var rowIndexForGrid = 0; rowIndexForGrid < rowCountForGrid; rowIndexForGrid++) {
      var cellsForGrid = Array.isArray(inputRowsForGrid[rowIndexForGrid])
        ? inputRowsForGrid[rowIndexForGrid]
        : [inputRowsForGrid[rowIndexForGrid]];
      var colCursorForGrid = 0;
      for (var cellIndexForGrid = 0; cellIndexForGrid < cellsForGrid.length; cellIndexForGrid++) {
        while (occupiedForGrid[rowIndexForGrid][colCursorForGrid]) colCursorForGrid++;
        if (colCursorForGrid >= MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION) break;
        var richCellForGrid = normalizeRichTableCellForDocumentGeneration(cellsForGrid[cellIndexForGrid]);
        var colSpanForGrid = Math.min(richCellForGrid.colSpan, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION - colCursorForGrid);
        var rowSpanForGrid = Math.min(richCellForGrid.rowSpan, rowCountForGrid - rowIndexForGrid);
        placedForGrid[rowIndexForGrid].push({
          col: colCursorForGrid,
          kind: 'cell',
          paragraphs: richCellForGrid.paragraphs,
          header: richCellForGrid.header,
          colSpan: colSpanForGrid,
          rowSpan: rowSpanForGrid
        });
        for (var spanRowForGrid = 0; spanRowForGrid < rowSpanForGrid; spanRowForGrid++) {
          for (var spanColForGrid = 0; spanColForGrid < colSpanForGrid; spanColForGrid++) {
            occupiedForGrid[rowIndexForGrid + spanRowForGrid][colCursorForGrid + spanColForGrid] = true;
          }
          if (spanRowForGrid > 0) {
            placedForGrid[rowIndexForGrid + spanRowForGrid].push({
              col: colCursorForGrid,
              kind: 'vmerge',
              colSpan: colSpanForGrid
            });
          }
        }
        colCursorForGrid += colSpanForGrid;
      }
      if (occupiedForGrid[rowIndexForGrid].length > colCountForGrid) {
        colCountForGrid = occupiedForGrid[rowIndexForGrid].length;
      }
    }

    var tiledRowsForGrid = [];
    for (var tileRowForGrid = 0; tileRowForGrid < rowCountForGrid; tileRowForGrid++) {
      var descriptorsForRowGrid = placedForGrid[tileRowForGrid].slice().sort(function (aForGrid, bForGrid) {
        return aForGrid.col - bForGrid.col;
      });
      var tiledForGrid = [];
      var expectedColForGrid = 0;
      for (var descIndexForGrid = 0; descIndexForGrid < descriptorsForRowGrid.length; descIndexForGrid++) {
        var descForGrid = descriptorsForRowGrid[descIndexForGrid];
        while (expectedColForGrid < descForGrid.col) {
          tiledForGrid.push({ kind: 'empty', colSpan: 1 });
          expectedColForGrid++;
        }
        tiledForGrid.push(descForGrid);
        expectedColForGrid = descForGrid.col + descForGrid.colSpan;
      }
      while (expectedColForGrid < colCountForGrid) {
        tiledForGrid.push({ kind: 'empty', colSpan: 1 });
        expectedColForGrid++;
      }
      tiledRowsForGrid.push(tiledForGrid);
    }

    return { colCount: colCountForGrid, rows: tiledRowsForGrid };
  }

  function tableToPlainRowsForDocumentGeneration(rowsForDocumentGeneration) {
    var gridForPlain = expandTableGridForDocumentGeneration(rowsForDocumentGeneration);
    if (gridForPlain.colCount === 0) return [];
    return gridForPlain.rows.map(function (rowDescriptorsForPlain) {
      var plainRowForPlain = [];
      rowDescriptorsForPlain.forEach(function (descriptorForPlain) {
        var spanForPlain = Math.max(1, Number(descriptorForPlain.colSpan) || 1);
        plainRowForPlain.push(descriptorForPlain.kind === 'cell'
          ? plainTextFromTableCellForDocumentGeneration(descriptorForPlain)
          : '');
        for (var fillForPlain = 1; fillForPlain < spanForPlain; fillForPlain++) {
          plainRowForPlain.push('');
        }
      });
      return plainRowForPlain;
    });
  }

  // Borders default to on; only an explicit bordered:false (from border="0",
  // role="presentation", or a blocks-path bordered field) turns them off.
  function tableShouldShowBordersForDocumentGeneration(blockForDocumentGeneration) {
    return !blockForDocumentGeneration || blockForDocumentGeneration.bordered !== false;
  }

  // Resolve a table block to its six Word border edges. An explicit spec (from CSS border
  // properties) wins; otherwise a bordered table gets the house default and a borderless one
  // gets nil edges, which is what layout tables need.
  function tableBorderSpecForBlockForDocumentGeneration(blockForDocumentGeneration) {
    var blockForSpec = blockForDocumentGeneration || {};
    if (blockForSpec.borderSpec) return blockForSpec.borderSpec;
    if (!tableShouldShowBordersForDocumentGeneration(blockForSpec)) return null;
    return uniformTableBorderSpecForDocumentGeneration(DEFAULT_TABLE_BORDER_FOR_DOCUMENT_GENERATION);
  }

  function docxTableBordersXmlForDocumentGeneration(borderSpecForDocumentGeneration) {
    var edgesXmlForBorders = '';
    TABLE_BORDER_EDGES_FOR_DOCUMENT_GENERATION.forEach(function (edgeNameForBorders) {
      var edgeForBorders = borderSpecForDocumentGeneration ? borderSpecForDocumentGeneration[edgeNameForBorders] : null;
      if (!edgeForBorders) {
        edgesXmlForBorders += '<w:' + edgeNameForBorders + ' w:val="nil"/>';
        return;
      }
      // w:sz on a border is eighths of a point, and Word clamps it to 2..96 (0.25pt..12pt).
      var eighthsForBorders = Math.max(2, Math.min(96, Math.round(Number(edgeForBorders.widthPt || 0.5) * 8)));
      edgesXmlForBorders += '<w:' + edgeNameForBorders + ' w:val="single" w:sz="' + eighthsForBorders
        + '" w:space="0" w:color="' + (edgeForBorders.color || '000000') + '"/>';
    });
    return '<w:tblBorders>' + edgesXmlForBorders + '</w:tblBorders>';
  }

  function docxTableForDocumentGeneration(rowsForDocumentGeneration, hasHeaderForDocumentGeneration, relCollectorForDocumentGeneration, borderSpecForDocumentGeneration) {
    var gridForDocumentGeneration = expandTableGridForDocumentGeneration(rowsForDocumentGeneration);
    if (gridForDocumentGeneration.colCount === 0 || gridForDocumentGeneration.rows.length === 0) return '';
    var colCountForTable = gridForDocumentGeneration.colCount;
    var colWidthForTable = Math.max(1, Math.floor(9360 / colCountForTable));
    var gridColXmlForTable = '';
    for (var gridColIndexForTable = 0; gridColIndexForTable < colCountForTable; gridColIndexForTable++) {
      gridColXmlForTable += '<w:gridCol w:w="' + colWidthForTable + '"/>';
    }
    var rowXmlForDocumentGeneration = gridForDocumentGeneration.rows.map(function (rowDescriptorsForTable, rowIndexForTable) {
      var cellsXmlForTable = rowDescriptorsForTable.map(function (descriptorForTable) {
        var spanForTable = Math.max(1, Number(descriptorForTable.colSpan) || 1);
        var tcPrInnerForTable = '<w:tcW w:w="' + (colWidthForTable * spanForTable) + '" w:type="dxa"/>';
        if (spanForTable > 1) tcPrInnerForTable += '<w:gridSpan w:val="' + spanForTable + '"/>';
        if (descriptorForTable.kind === 'vmerge') {
          tcPrInnerForTable += '<w:vMerge/>';
          return '<w:tc><w:tcPr>' + tcPrInnerForTable + '</w:tcPr>' +
            docxParagraphForDocumentGeneration('', {}, relCollectorForDocumentGeneration) + '</w:tc>';
        }
        if (descriptorForTable.kind !== 'cell') {
          return '<w:tc><w:tcPr>' + tcPrInnerForTable + '</w:tcPr>' +
            docxParagraphForDocumentGeneration('', {}, relCollectorForDocumentGeneration) + '</w:tc>';
        }
        if (Number(descriptorForTable.rowSpan) > 1) tcPrInnerForTable += '<w:vMerge w:val="restart"/>';
        var isHeaderCellForTable = !!descriptorForTable.header || (!!hasHeaderForDocumentGeneration && rowIndexForTable === 0);
        // A w:tc must hold at least one paragraph; each cell paragraph becomes its own w:p.
        var cellParagraphsForTable = (Array.isArray(descriptorForTable.paragraphs) && descriptorForTable.paragraphs.length)
          ? descriptorForTable.paragraphs
          : [[]];
        var cellBodyXmlForTable = cellParagraphsForTable.map(function (runsForParagraphForTable) {
          return docxParagraphForDocumentGeneration(runsForParagraphForTable, { bold: isHeaderCellForTable }, relCollectorForDocumentGeneration);
        }).join('');
        return '<w:tc><w:tcPr>' + tcPrInnerForTable + '</w:tcPr>' + cellBodyXmlForTable + '</w:tc>';
      }).join('');
      return '<w:tr>' + cellsXmlForTable + '</w:tr>';
    }).join('');
    var tblBordersXmlForTable = docxTableBordersXmlForDocumentGeneration(borderSpecForDocumentGeneration);
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + tblBordersXmlForTable +
      '</w:tblPr><w:tblGrid>' + gridColXmlForTable + '</w:tblGrid>' +
      rowXmlForDocumentGeneration + '</w:tbl>';
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
    var blocksForDocumentGeneration = normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, 'DOCX creation requires blocks, html, or content.');
    var relCollectorForDocumentGeneration = makeDocxRelCollectorForDocumentGeneration();
    var hasHeadingForDocumentGeneration = false;

    var bodyXmlForDocumentGeneration = blocksForDocumentGeneration.map(function (blockForDocumentGeneration) {
      if (!blockForDocumentGeneration || typeof blockForDocumentGeneration !== 'object') return '';
      if (blockForDocumentGeneration.type === 'image') {
        var resolvedForImageBlock = blockForDocumentGeneration.resolved;
        if (!resolvedForImageBlock || !resolvedForImageBlock.bytes) return '';
        var addedForImageBlock = relCollectorForDocumentGeneration.addImage(resolvedForImageBlock.bytes, resolvedForImageBlock.ext);
        return docxImageDrawingXmlForDocumentGeneration(
          addedForImageBlock.relId,
          addedForImageBlock.ordinal,
          resolvedForImageBlock.cx,
          resolvedForImageBlock.cy
        );
      }
      if (blockForDocumentGeneration.type === 'table') {
        return docxTableForDocumentGeneration(
          blockForDocumentGeneration.rows,
          !!blockForDocumentGeneration.header,
          relCollectorForDocumentGeneration,
          tableBorderSpecForBlockForDocumentGeneration(blockForDocumentGeneration)
        );
      }
      if (blockForDocumentGeneration.type === 'heading') {
        hasHeadingForDocumentGeneration = true;
        var levelForDocumentGeneration = Math.max(1, Math.min(6, Number(blockForDocumentGeneration.level) || 1));
        return docxParagraphForDocumentGeneration(
          Array.isArray(blockForDocumentGeneration.runs) ? blockForDocumentGeneration.runs : (blockForDocumentGeneration.text || ''),
          { headingLevel: levelForDocumentGeneration },
          relCollectorForDocumentGeneration
        );
      }
      if (blockForDocumentGeneration.type === 'list') {
        var numIdForDocumentGeneration = relCollectorForDocumentGeneration.allocNumbering(!!blockForDocumentGeneration.ordered);
        var ilvlForDocumentGeneration = Math.max(0, Math.min(2, Number(blockForDocumentGeneration.level) || 0));
        var listItemsForDocumentGeneration = Array.isArray(blockForDocumentGeneration.items) ? blockForDocumentGeneration.items : [];
        return listItemsForDocumentGeneration.map(function (itemForDocumentGeneration) {
          return docxParagraphForDocumentGeneration(
            itemForDocumentGeneration,
            { numPr: { ilvl: ilvlForDocumentGeneration, numId: numIdForDocumentGeneration } },
            relCollectorForDocumentGeneration
          );
        }).join('');
      }
      if (blockForDocumentGeneration.type === 'bullet') {
        if (Array.isArray(blockForDocumentGeneration.items)) {
          return blockForDocumentGeneration.items.map(function (itemForDocumentGeneration) {
            return docxParagraphForDocumentGeneration('- ' + String(itemForDocumentGeneration || ''), {}, relCollectorForDocumentGeneration);
          }).join('');
        }
        return docxParagraphForDocumentGeneration('- ' + String(blockForDocumentGeneration.text || ''), {}, relCollectorForDocumentGeneration);
      }
      return docxParagraphForDocumentGeneration(
        Array.isArray(blockForDocumentGeneration.runs) ? blockForDocumentGeneration.runs : (blockForDocumentGeneration.text || ''),
        {},
        relCollectorForDocumentGeneration
      );
    }).join('');

    return {
      body: bodyXmlForDocumentGeneration,
      hyperlinks: relCollectorForDocumentGeneration.hyperlinks,
      numbering: relCollectorForDocumentGeneration.numbering,
      images: relCollectorForDocumentGeneration.images,
      hasHeading: hasHeadingForDocumentGeneration
    };
  }

  function buildDocxForDocumentGeneration(inputForDocumentGeneration) {
    if (!globalScopeForDocumentGeneration.JSZip) {
      throw new Error('DOCX generator is unavailable.');
    }
    var zipForDocumentGeneration = new globalScopeForDocumentGeneration.JSZip();
    var builtBodyForDocumentGeneration = buildDocxBodyForDocumentGeneration(inputForDocumentGeneration);
    var hyperlinksForDocumentGeneration = builtBodyForDocumentGeneration.hyperlinks || [];
    var numberingForDocumentGeneration = builtBodyForDocumentGeneration.numbering || [];
    var imagesForDocumentGeneration = builtBodyForDocumentGeneration.images || [];
    var hasNumberingForDocumentGeneration = numberingForDocumentGeneration.length > 0;
    var hasHeadingForDocumentGeneration = builtBodyForDocumentGeneration.hasHeading === true;
    var docDefaultsForDocumentGeneration = inputForDocumentGeneration.docDefaults || null;
    var needsStylesForDocumentGeneration = hasHeadingForDocumentGeneration
      || !!(docDefaultsForDocumentGeneration && (docDefaultsForDocumentGeneration.fontSizePt || docDefaultsForDocumentGeneration.fontFamily));
    var hasImagesForDocumentGeneration = imagesForDocumentGeneration.length > 0;
    var imageNamespacesForDocumentGeneration = hasImagesForDocumentGeneration
      ? ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
        ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
      : '';
    var documentXmlForDocumentGeneration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' + imageNamespacesForDocumentGeneration + '>' +
      '<w:body>' + builtBodyForDocumentGeneration.body +
      docxSectionPropertiesXmlForDocumentGeneration(docDefaultsForDocumentGeneration) +
      '</w:body></w:document>';

    var imageDefaultsXmlForDocumentGeneration = '';
    if (hasImagesForDocumentGeneration) {
      var seenImageExtsForDocumentGeneration = {};
      var extToContentTypeForDocumentGeneration = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };
      imagesForDocumentGeneration.forEach(function (imageEntryForDocumentGeneration) {
        var extKeyForDocumentGeneration = imageEntryForDocumentGeneration.ext;
        if (seenImageExtsForDocumentGeneration[extKeyForDocumentGeneration]) return;
        seenImageExtsForDocumentGeneration[extKeyForDocumentGeneration] = true;
        var contentTypeForDefaultForDocumentGeneration = extToContentTypeForDocumentGeneration[extKeyForDocumentGeneration] || ('image/' + extKeyForDocumentGeneration);
        imageDefaultsXmlForDocumentGeneration += '<Default Extension="' + extKeyForDocumentGeneration + '" ContentType="' + contentTypeForDefaultForDocumentGeneration + '"/>';
      });
    }

    zipForDocumentGeneration.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      imageDefaultsXmlForDocumentGeneration +
      '<Override PartName="/word/document.xml" ContentType="' + DOCX_MIME_FOR_DOCUMENT_GENERATION + '.main+xml"/>' +
      (hasNumberingForDocumentGeneration ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : '') +
      (needsStylesForDocumentGeneration ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' : '') +
      '</Types>'
    );
    zipForDocumentGeneration.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
    );

    var documentRelationshipsForDocumentGeneration = '';
    for (var hyperlinkIndexForDocumentGeneration = 0; hyperlinkIndexForDocumentGeneration < hyperlinksForDocumentGeneration.length; hyperlinkIndexForDocumentGeneration++) {
      var hyperlinkForDocumentGeneration = hyperlinksForDocumentGeneration[hyperlinkIndexForDocumentGeneration];
      documentRelationshipsForDocumentGeneration += '<Relationship Id="' + hyperlinkForDocumentGeneration.id +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
        escapeXmlForDocumentGeneration(hyperlinkForDocumentGeneration.href) + '" TargetMode="External"/>';
    }
    if (hasNumberingForDocumentGeneration) {
      documentRelationshipsForDocumentGeneration += '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
    }
    if (needsStylesForDocumentGeneration) {
      documentRelationshipsForDocumentGeneration += '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    }
    for (var imageRelIndexForDocumentGeneration = 0; imageRelIndexForDocumentGeneration < imagesForDocumentGeneration.length; imageRelIndexForDocumentGeneration++) {
      var imageRelForDocumentGeneration = imagesForDocumentGeneration[imageRelIndexForDocumentGeneration];
      documentRelationshipsForDocumentGeneration += '<Relationship Id="' + imageRelForDocumentGeneration.relId +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' +
        imageRelForDocumentGeneration.partName + '"/>';
    }

    var wordFolderForDocumentGeneration = zipForDocumentGeneration.folder('word');
    wordFolderForDocumentGeneration.file('document.xml', documentXmlForDocumentGeneration);
    if (documentRelationshipsForDocumentGeneration) {
      wordFolderForDocumentGeneration.folder('_rels').file('document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        documentRelationshipsForDocumentGeneration +
        '</Relationships>'
      );
    }
    if (hasNumberingForDocumentGeneration) {
      wordFolderForDocumentGeneration.file('numbering.xml', buildDocxNumberingXmlForDocumentGeneration(numberingForDocumentGeneration));
    }
    if (needsStylesForDocumentGeneration) {
      wordFolderForDocumentGeneration.file('styles.xml', buildDocxStylesXmlForDocumentGeneration(docDefaultsForDocumentGeneration));
    }
    if (hasImagesForDocumentGeneration) {
      imagesForDocumentGeneration.forEach(function (imageEntryForDocumentGeneration) {
        wordFolderForDocumentGeneration.file(imageEntryForDocumentGeneration.partName, imageEntryForDocumentGeneration.bytes);
      });
    }

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
    // No title heading is synthesized: whether the document opens with a heading is the
    // caller's decision (include a heading block, an <h1> in html, or a leading "# " in
    // content). title is metadata only and drives the filename.
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

  function pdfRunsFromBlockForDocumentGeneration(blockForDocumentGeneration) {
    if (Array.isArray(blockForDocumentGeneration.runs) && blockForDocumentGeneration.runs.length) {
      return blockForDocumentGeneration.runs.slice();
    }
    return [{ text: String(blockForDocumentGeneration.text == null ? '' : blockForDocumentGeneration.text) }];
  }

  function pdfLinesFromBlocksForDocumentGeneration(inputForDocumentGeneration) {
    var blocksForDocumentGeneration = normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, 'PDF creation requires blocks, html, or content.');
    var linesForDocumentGeneration = [];
    var docDefaultsForPdfLines = inputForDocumentGeneration.docDefaults || null;
    var bodySizeForPdfLines = (docDefaultsForPdfLines && docDefaultsForPdfLines.fontSizePt)
      || DEFAULT_PDF_BODY_SIZE_PT_FOR_DOCUMENT_GENERATION;
    blocksForDocumentGeneration.forEach(function (blockForDocumentGeneration) {
      if (!blockForDocumentGeneration || typeof blockForDocumentGeneration !== 'object') return;
      if (blockForDocumentGeneration.type === 'image') {
        var resolvedImgForPdf = blockForDocumentGeneration.resolved || {};
        if (resolvedImgForPdf.jpegBytes && resolvedImgForPdf.jpegBytes.length) {
          linesForDocumentGeneration.push({
            type: 'image',
            jpegBytes: resolvedImgForPdf.jpegBytes,
            wPx: resolvedImgForPdf.wPx,
            hPx: resolvedImgForPdf.hPx,
            gapAfter: 8
          });
        }
        return;
      }
      if (blockForDocumentGeneration.type === 'table') {
        // Expand to a rectangular plain-text grid so colspan/rowspan stay column-aligned.
        // PDF has no read-back path, so cells render as plain text without visual merging.
        var rowsForPdfTable = tableToPlainRowsForDocumentGeneration(blockForDocumentGeneration.rows).slice(0, 80);
        if (rowsForPdfTable.length > 0) {
          linesForDocumentGeneration.push({
            type: 'table',
            rows: rowsForPdfTable,
            borderSpec: tableBorderSpecForBlockForDocumentGeneration(blockForDocumentGeneration),
            headerRow: !!blockForDocumentGeneration.header,
            gapAfter: 10
          });
        }
        return;
      }
      if (blockForDocumentGeneration.type === 'heading') {
        var headingSizeForPdf = Number(blockForDocumentGeneration.level) === 1 ? 18 : (Number(blockForDocumentGeneration.level) === 2 ? 15 : 13);
        linesForDocumentGeneration.push({ runs: pdfRunsFromBlockForDocumentGeneration(blockForDocumentGeneration), size: headingSizeForPdf, gapAfter: 8 });
        return;
      }
      if (blockForDocumentGeneration.type === 'list') {
        var orderedForPdf = !!blockForDocumentGeneration.ordered;
        var levelForPdf = Math.max(0, Math.min(2, Number(blockForDocumentGeneration.level) || 0));
        var indentForPdf = 18 + levelForPdf * 18;
        var listItemsForPdf = Array.isArray(blockForDocumentGeneration.items) ? blockForDocumentGeneration.items : [];
        listItemsForPdf.forEach(function (itemForPdf, itemIndexForPdf) {
          var prefixForPdf = orderedForPdf ? ((itemIndexForPdf + 1) + '. ') : '• ';
          var itemRunsForPdf = Array.isArray(itemForPdf) ? itemForPdf.slice() : [{ text: String(itemForPdf == null ? '' : itemForPdf) }];
          linesForDocumentGeneration.push({ runs: itemRunsForPdf, size: bodySizeForPdfLines, gapAfter: 4, indent: indentForPdf, prefix: prefixForPdf });
        });
        return;
      }
      if (blockForDocumentGeneration.type === 'bullet') {
        var bulletItemsForPdf = Array.isArray(blockForDocumentGeneration.items) ? blockForDocumentGeneration.items : [String(blockForDocumentGeneration.text || '')];
        bulletItemsForPdf.forEach(function (bulletItemForPdf) {
          linesForDocumentGeneration.push({ runs: [{ text: String(bulletItemForPdf == null ? '' : bulletItemForPdf) }], size: bodySizeForPdfLines, gapAfter: 4, indent: 18, prefix: '• ' });
        });
        return;
      }
      linesForDocumentGeneration.push({ runs: pdfRunsFromBlockForDocumentGeneration(blockForDocumentGeneration), size: bodySizeForPdfLines, gapAfter: 4 });
    });
    return linesForDocumentGeneration.slice(0, MAX_PDF_LINES_FOR_DOCUMENT_GENERATION);
  }

  // PDF's base-14 fonts cover three families. A named font is matched to the closest of them
  // so a serif source document does not come back set in a sans face; the exact face cannot
  // be reproduced without embedding it.
  function pdfFamilyClassForDocumentGeneration(fontNameForDocumentGeneration, defaultClassForDocumentGeneration) {
    var nameForFamily = String(fontNameForDocumentGeneration || '').trim();
    if (!nameForFamily) return defaultClassForDocumentGeneration || 'sans';
    if (PDF_MONO_FAMILY_HINTS_FOR_DOCUMENT_GENERATION.test(nameForFamily)) return 'mono';
    if (PDF_SERIF_FAMILY_HINTS_FOR_DOCUMENT_GENERATION.test(nameForFamily)) return 'serif';
    return 'sans';
  }

  function pdfStrokeColorForDocumentGeneration(hexColorForDocumentGeneration) {
    var hexForStroke = String(hexColorForDocumentGeneration || '000000');
    if (!/^[0-9A-Fa-f]{6}$/.test(hexForStroke)) hexForStroke = '000000';
    return [0, 2, 4].map(function (offsetForStroke) {
      return (parseInt(hexForStroke.substr(offsetForStroke, 2), 16) / 255).toFixed(3);
    }).join(' ');
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
    var pageAnnotsForPdf = [];
    var pageImagesForPdf = [];
    var currentPageForPdf = [];
    var currentPageAnnotsForPdf = [];
    var currentPageImagesForPdf = [];
    var imageObjectsForPdf = [];
    var docDefaultsForPdf = inputForDocumentGeneration.docDefaults || null;
    var pageMarginsForPdf = (docDefaultsForPdf && docDefaultsForPdf.margins) || null;
    var pageWidthForPdf = (docDefaultsForPdf && docDefaultsForPdf.pageWidthPt) || DEFAULT_PAGE_WIDTH_PT_FOR_DOCUMENT_GENERATION;
    var pageHeightForPdf = (docDefaultsForPdf && docDefaultsForPdf.pageHeightPt) || DEFAULT_PAGE_HEIGHT_PT_FOR_DOCUMENT_GENERATION;
    var leftForPdf = (pageMarginsForPdf && pageMarginsForPdf.left) || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION;
    var rightMarginForPdf = (pageMarginsForPdf && pageMarginsForPdf.right) || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION;
    var bottomForPdf = (pageMarginsForPdf && pageMarginsForPdf.bottom) || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION;
    // 50pt rather than the 54pt side margin: this is the long-standing top offset, kept so
    // documents with no declared page setup render exactly as before.
    var topStartForPdf = pageHeightForPdf - ((pageMarginsForPdf && pageMarginsForPdf.top) || 50);
    var tableWidthForPdf = Math.max(72, pageWidthForPdf - leftForPdf - rightMarginForPdf);
    var rightLimitForPdf = leftForPdf + tableWidthForPdf;
    var baseFontClassForPdf = pdfFamilyClassForDocumentGeneration(docDefaultsForPdf && docDefaultsForPdf.fontFamily, 'sans');
    var yForPdf = topStartForPdf;

    function startNewPdfPageForDocumentGeneration() {
      pagesForPdf.push(currentPageForPdf);
      pageAnnotsForPdf.push(currentPageAnnotsForPdf);
      pageImagesForPdf.push(currentPageImagesForPdf);
      currentPageForPdf = [];
      currentPageAnnotsForPdf = [];
      currentPageImagesForPdf = [];
      yForPdf = topStartForPdf;
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

    function addPdfRawForDocumentGeneration(commandForPdf) {
      currentPageForPdf.push({ kind: 'path', command: commandForPdf });
    }

    function fontKeyForRunForPdf(runForPdf) {
      var familyClassForRun = pdfFamilyClassForDocumentGeneration(runForPdf.font, baseFontClassForPdf);
      var familyOffsetForRun = familyClassForRun === 'serif' ? 4 : (familyClassForRun === 'mono' ? 8 : 0);
      var styleIndexForRun = (runForPdf.bold && runForPdf.italic) ? 4 : (runForPdf.bold ? 2 : (runForPdf.italic ? 3 : 1));
      return 'F' + (familyOffsetForRun + styleIndexForRun);
    }

    // Each edge is stroked inside its own q/Q so its width and colour cannot leak into the
    // next drawing operation.
    function addPdfBorderLineForDocumentGeneration(x1ForBorder, y1ForBorder, x2ForBorder, y2ForBorder, edgeForBorder) {
      if (!edgeForBorder) return;
      var rgbForBorder = pdfStrokeColorForDocumentGeneration(edgeForBorder.color);
      currentPageForPdf.push({
        kind: 'path',
        command: 'q ' + Math.max(0.1, Number(edgeForBorder.widthPt) || 0.5).toFixed(2) + ' w ' + rgbForBorder + ' RG '
          + x1ForBorder.toFixed(2) + ' ' + y1ForBorder.toFixed(2) + ' m '
          + x2ForBorder.toFixed(2) + ' ' + y2ForBorder.toFixed(2) + ' l S Q'
      });
    }

    function addPdfImageForDocumentGeneration(jpegBytesForImg, wPxForImg, hPxForImg) {
      var naturalWPtForImg = Math.max(1, (Number(wPxForImg) || 1) * PDF_PX_TO_PT_FOR_DOCUMENT_GENERATION);
      var naturalHPtForImg = Math.max(1, (Number(hPxForImg) || 1) * PDF_PX_TO_PT_FOR_DOCUMENT_GENERATION);
      var usableHeightForImg = topStartForPdf - bottomForPdf;
      var scaleForImg = Math.min(1, tableWidthForPdf / naturalWPtForImg, usableHeightForImg / naturalHPtForImg);
      var dispWForImg = naturalWPtForImg * scaleForImg;
      var dispHForImg = naturalHPtForImg * scaleForImg;
      ensurePdfSpaceForDocumentGeneration(dispHForImg);
      var nameForImg = 'Im' + (imageObjectsForPdf.length + 1);
      imageObjectsForPdf.push({ jpegBytes: jpegBytesForImg, wPx: Math.max(1, Math.round(Number(wPxForImg) || 1)), hPx: Math.max(1, Math.round(Number(hPxForImg) || 1)), name: nameForImg });
      currentPageImagesForPdf.push(nameForImg);
      var yBottomForImg = yForPdf - dispHForImg;
      currentPageForPdf.push({
        kind: 'path',
        command: 'q ' + dispWForImg.toFixed(2) + ' 0 0 ' + dispHForImg.toFixed(2) + ' ' + leftForPdf.toFixed(2) + ' ' + yBottomForImg.toFixed(2) + ' cm /' + nameForImg + ' Do Q'
      });
      yForPdf = yBottomForImg;
    }

    function addPdfTableForDocumentGeneration(rowsForPdfTable, borderSpecForTable, headerRowForTable) {
      var rowsForTable = normalizeRowsForDocumentGeneration(rowsForPdfTable).slice(0, 80);
      if (!rowsForTable.length) return;
      var lastRowIndexForTable = rowsForTable.length - 1;
      var fontSizeForTable = 8.5;
      var lineHeightForTable = 10.5;
      var paddingForTable = 3.5;
      var colWidthsForTable = getPdfTableColumnWidthsForDocumentGeneration(rowsForTable, tableWidthForPdf, fontSizeForTable);
      for (var rowIndexForTable = 0; rowIndexForTable < rowsForTable.length; rowIndexForTable++) {
        var rowForTable = rowsForTable[rowIndexForTable] || [];
        var wrappedCellsForTable = colWidthsForTable.map(function (widthForTable, cellIndexForTable) {
          var maxCharsForCell = Math.max(4, Math.floor((widthForTable - paddingForTable * 2) / (fontSizeForTable * 0.48)));
          // Cells carry a newline between paragraphs (plainTextFromTableCell); honor it as a
          // hard line break, wrapping each paragraph independently.
          var cellTextForTable = String(rowForTable[cellIndexForTable] == null ? '' : rowForTable[cellIndexForTable]);
          var linesForCellForTable = [];
          cellTextForTable.split('\n').forEach(function (paragraphPieceForTable) {
            wrapTextForDocumentGeneration(paragraphPieceForTable, maxCharsForCell).forEach(function (wrappedLineForTable) {
              linesForCellForTable.push(wrappedLineForTable);
            });
          });
          return linesForCellForTable;
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
          if (borderSpecForTable) {
            // Only the top and left of each cell are drawn, plus the closing bottom and right
            // of the last row and column, so a shared gridline is never stroked twice (which
            // would show as a heavier line where two different widths overlap).
            var isLastRowForTable = rowIndexForTable === lastRowIndexForTable;
            var isLastColForTable = colIndexForTable === colWidthsForTable.length - 1;
            var xRightForTable = xForTable + colWidthForTable;
            addPdfBorderLineForDocumentGeneration(xForTable, rowTopForTable, xRightForTable, rowTopForTable,
              rowIndexForTable === 0 ? borderSpecForTable.top : borderSpecForTable.insideH);
            addPdfBorderLineForDocumentGeneration(xForTable, rowTopForTable, xForTable, rowBottomForTable,
              colIndexForTable === 0 ? borderSpecForTable.left : borderSpecForTable.insideV);
            if (isLastRowForTable) {
              addPdfBorderLineForDocumentGeneration(xForTable, rowBottomForTable, xRightForTable, rowBottomForTable, borderSpecForTable.bottom);
            }
            if (isLastColForTable) {
              addPdfBorderLineForDocumentGeneration(xRightForTable, rowTopForTable, xRightForTable, rowBottomForTable, borderSpecForTable.right);
            }
          }
          var linesForCellForTable = wrappedCellsForTable[colIndexForTable];
          for (var lineIndexForCell = 0; lineIndexForCell < linesForCellForTable.length; lineIndexForCell++) {
            addPdfTextForDocumentGeneration(
              linesForCellForTable[lineIndexForCell],
              fontSizeForTable,
              xForTable + paddingForTable,
              rowTopForTable - paddingForTable - fontSizeForTable - (lineIndexForCell * lineHeightForTable),
              fontKeyForRunForPdf({ bold: !!(headerRowForTable && rowIndexForTable === 0) })
            );
          }
          xForTable += colWidthForTable;
        }
        yForPdf = rowBottomForTable;
      }
    }

    function renderRunsLineForPdf(runsForPdf, sizeForPdf, indentForPdf, prefixForPdf) {
      var startXForPdf = leftForPdf + (indentForPdf || 0);
      // A run may carry its own size (read out of a source document), so the line box is
      // sized by the largest run on the line while each segment still draws at its own size.
      var maxRunSizeForPdf = (runsForPdf || []).reduce(function (maxForPdf, runForPdf) {
        var runSizeForPdf = Number(runForPdf && runForPdf.sizePt) || 0;
        return runSizeForPdf > maxForPdf ? runSizeForPdf : maxForPdf;
      }, sizeForPdf);
      var lineHeightForPdf = Math.max(14, maxRunSizeForPdf + 4);
      // yForPdf enters as the top of the line box; the baseline sits one ascent below it, so
      // glyphs grow down from the cursor rather than up. This keeps text from poking above the
      // cursor into a preceding image or table (the bottom-edge handoff), while inter-line
      // spacing is preserved because the entry offset is undone in the final advance.
      var ascentForPdf = maxRunSizeForPdf * PDF_FONT_ASCENT_RATIO_FOR_DOCUMENT_GENERATION;
      // Tokenize into alternating word / whitespace pieces, tagged with font and link, so
      // wrapping can break on words while drawing preserves the original spacing.
      var tokensForPdf = [];
      if (prefixForPdf) tokensForPdf.push({ text: prefixForPdf, fontKey: fontKeyForRunForPdf({}), href: '', size: sizeForPdf, space: false });
      (runsForPdf || []).forEach(function (runForPdf) {
        var safeRunForPdf = runForPdf || {};
        var fontKeyForToken = fontKeyForRunForPdf(safeRunForPdf);
        var sizeForToken = Number(safeRunForPdf.sizePt) || sizeForPdf;
        var hrefForToken = (typeof safeRunForPdf.href === 'string' && safeRunForPdf.href) ? safeRunForPdf.href : '';
        String(safeRunForPdf.text == null ? '' : safeRunForPdf.text).split(/(\n)/).forEach(function (partForPdf) {
          if (partForPdf === '\n') { tokensForPdf.push({ newline: true }); return; }
          if (partForPdf === '') return;
          partForPdf.split(/(\s+)/).forEach(function (pieceForPdf) {
            if (pieceForPdf === '') return;
            tokensForPdf.push({ text: pieceForPdf, fontKey: fontKeyForToken, href: hrefForToken, size: sizeForToken, space: /^\s+$/.test(pieceForPdf) });
          });
        });
      });

      ensurePdfSpaceForDocumentGeneration(lineHeightForPdf);
      yForPdf -= ascentForPdf;
      var xCursorForPdf = startXForPdf;
      var activeLinkForPdf = null;

      // Consecutive tokens sharing a font and link are drawn as one Tj at a single start x,
      // so the viewer applies the font's real glyph spacing instead of our crude per-word
      // width estimate. The estimate is then used only to choose wrap points and the start x
      // of the next segment after a font/link change.
      var segTextForPdf = '';
      var segFontKeyForPdf = fontKeyForRunForPdf({});
      var segHrefForPdf = '';
      var segSizeForPdf = sizeForPdf;
      var segStartXForPdf = xCursorForPdf;

      function flushLinkForPdf() {
        if (activeLinkForPdf) {
          currentPageAnnotsForPdf.push({
            href: activeLinkForPdf.href,
            rect: [activeLinkForPdf.x1, yForPdf - 2, activeLinkForPdf.x2, yForPdf + maxRunSizeForPdf + 2]
          });
          activeLinkForPdf = null;
        }
      }
      function flushSegForPdf() {
        if (segTextForPdf === '') return;
        if (segHrefForPdf) {
          addPdfRawForDocumentGeneration('0 0 1 rg');
          addPdfTextForDocumentGeneration(segTextForPdf, segSizeForPdf, segStartXForPdf, yForPdf, segFontKeyForPdf);
          addPdfRawForDocumentGeneration('0 0 0 rg');
          if (activeLinkForPdf && activeLinkForPdf.href === segHrefForPdf) {
            activeLinkForPdf.x2 = xCursorForPdf;
          } else {
            flushLinkForPdf();
            activeLinkForPdf = { href: segHrefForPdf, x1: segStartXForPdf, x2: xCursorForPdf };
          }
        } else {
          flushLinkForPdf();
          addPdfTextForDocumentGeneration(segTextForPdf, segSizeForPdf, segStartXForPdf, yForPdf, segFontKeyForPdf);
        }
        segTextForPdf = '';
      }
      function moveToNextLineForPdf() {
        flushSegForPdf();
        flushLinkForPdf();
        yForPdf -= lineHeightForPdf;
        xCursorForPdf = startXForPdf;
        segStartXForPdf = xCursorForPdf;
        ensurePdfSpaceForDocumentGeneration(lineHeightForPdf);
      }

      tokensForPdf.forEach(function (tokenForPdf) {
        if (tokenForPdf.newline) { moveToNextLineForPdf(); return; }
        var widthForToken = estimatePdfTextWidthForDocumentGeneration(tokenForPdf.text, tokenForPdf.size || sizeForPdf);
        if (!tokenForPdf.space && xCursorForPdf + widthForToken > rightLimitForPdf && xCursorForPdf > startXForPdf) {
          moveToNextLineForPdf();
        }
        // Drop a space that lands at the very start of a line.
        if (tokenForPdf.space && segTextForPdf === '' && xCursorForPdf === startXForPdf) {
          return;
        }
        if (segTextForPdf !== '' && (tokenForPdf.fontKey !== segFontKeyForPdf
          || tokenForPdf.href !== segHrefForPdf || (tokenForPdf.size || sizeForPdf) !== segSizeForPdf)) {
          flushSegForPdf();
        }
        if (segTextForPdf === '') {
          segStartXForPdf = xCursorForPdf;
          segFontKeyForPdf = tokenForPdf.fontKey;
          segHrefForPdf = tokenForPdf.href;
          segSizeForPdf = tokenForPdf.size || sizeForPdf;
        }
        segTextForPdf += tokenForPdf.text;
        xCursorForPdf += widthForToken;
      });
      flushSegForPdf();
      flushLinkForPdf();
      // Undo the entry ascent offset so the cursor lands on the next line box's top, leaving
      // net spacing of exactly lineHeight per line.
      yForPdf -= (lineHeightForPdf - ascentForPdf);
    }

    logicalLinesForPdf.forEach(function (lineForPdf) {
      if (lineForPdf && lineForPdf.type === 'table') {
        addPdfTableForDocumentGeneration(lineForPdf.rows, lineForPdf.borderSpec, lineForPdf.headerRow);
        yForPdf -= Number(lineForPdf.gapAfter) || 0;
        return;
      }
      if (lineForPdf && lineForPdf.type === 'image') {
        addPdfImageForDocumentGeneration(lineForPdf.jpegBytes, lineForPdf.wPx, lineForPdf.hPx);
        yForPdf -= Number(lineForPdf.gapAfter) || 0;
        return;
      }
      renderRunsLineForPdf(lineForPdf.runs, Number(lineForPdf.size) || DEFAULT_PDF_BODY_SIZE_PT_FOR_DOCUMENT_GENERATION, lineForPdf.indent, lineForPdf.prefix);
      yForPdf -= Number(lineForPdf.gapAfter) || 0;
    });
    if (currentPageForPdf.length || pagesForPdf.length === 0) {
      pagesForPdf.push(currentPageForPdf);
      pageAnnotsForPdf.push(currentPageAnnotsForPdf);
      pageImagesForPdf.push(currentPageImagesForPdf);
    }

    var objectsForPdf = [];
    function addObjectForPdf(contentForPdf) {
      objectsForPdf.push(String(contentForPdf));
      return objectsForPdf.length;
    }

    var catalogIdForPdf = addObjectForPdf('');
    var pagesIdForPdf = addObjectForPdf('');
    // F1-F4 sans, F5-F8 serif, F9-F12 mono, in regular/bold/italic/bold-italic order. All
    // twelve are base-14 fonts, so they cost one tiny object each and need no embedding.
    var PDF_BASE_FONTS_FOR_PDF = [
      'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
      'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
      'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'
    ];
    var fontResourceEntriesForPdf = PDF_BASE_FONTS_FOR_PDF.map(function (baseFontNameForPdf, fontIndexForPdf) {
      var fontObjIdForPdf = addObjectForPdf('<< /Type /Font /Subtype /Type1 /BaseFont /' + baseFontNameForPdf + ' >>');
      return '/F' + (fontIndexForPdf + 1) + ' ' + fontObjIdForPdf + ' 0 R';
    }).join(' ');
    var pageIdsForPdf = [];

    // Each embedded image is one Image XObject (DCTDecode/JPEG, DeviceRGB). The binary stream is
    // spliced in as a latin1 string, so the whole document is byte-encoded as latin1 at the end.
    var imageNameToObjIdForPdf = {};
    imageObjectsForPdf.forEach(function (imgObjForPdf) {
      var binaryForImgObj = bytesToBinaryStringForDocumentGeneration(imgObjForPdf.jpegBytes);
      var imgObjIdForPdf = addObjectForPdf('<< /Type /XObject /Subtype /Image /Width ' + imgObjForPdf.wPx + ' /Height ' + imgObjForPdf.hPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + imgObjForPdf.jpegBytes.length + ' >>\nstream\n' + binaryForImgObj + '\nendstream');
      imageNameToObjIdForPdf[imgObjForPdf.name] = imgObjIdForPdf;
    });

    pagesForPdf.forEach(function (pageLinesForPdf, pageIndexForPdf) {
      var streamForPdf = pageLinesForPdf.map(function (lineForPdf) {
        if (lineForPdf.kind === 'path') return lineForPdf.command;
        return 'BT /' + (lineForPdf.fontKey || 'F1') + ' ' + lineForPdf.size + ' Tf ' + lineForPdf.x.toFixed(2) + ' ' + lineForPdf.y.toFixed(2) + ' Td (' + pdfSafeTextForDocumentGeneration(lineForPdf.text) + ') Tj ET';
      }).join('\n');
      var contentIdForPdf = addObjectForPdf('<< /Length ' + streamForPdf.length + ' >>\nstream\n' + streamForPdf + '\nendstream');
      var annotsForPageForPdf = pageAnnotsForPdf[pageIndexForPdf] || [];
      var annotRefsForPdf = [];
      annotsForPageForPdf.forEach(function (annotForPdf) {
        var rectForPdf = annotForPdf.rect;
        var annotIdForPdf = addObjectForPdf('<< /Type /Annot /Subtype /Link /Rect [' +
          rectForPdf[0].toFixed(2) + ' ' + rectForPdf[1].toFixed(2) + ' ' + rectForPdf[2].toFixed(2) + ' ' + rectForPdf[3].toFixed(2) +
          '] /Border [0 0 0] /A << /S /URI /URI (' + pdfSafeTextForDocumentGeneration(annotForPdf.href) + ') >> >>');
        annotRefsForPdf.push(annotIdForPdf + ' 0 R');
      });
      var annotsEntryForPdf = annotRefsForPdf.length ? ' /Annots [' + annotRefsForPdf.join(' ') + ']' : '';
      var pageImageNamesForPdf = pageImagesForPdf[pageIndexForPdf] || [];
      var xobjectEntryForPdf = '';
      if (pageImageNamesForPdf.length) {
        xobjectEntryForPdf = ' /XObject << ' + pageImageNamesForPdf.map(function (nameForXobj) {
          return '/' + nameForXobj + ' ' + imageNameToObjIdForPdf[nameForXobj] + ' 0 R';
        }).join(' ') + ' >>';
      }
      var pageIdForPdf = addObjectForPdf('<< /Type /Page /Parent ' + pagesIdForPdf +
        ' 0 R /MediaBox [0 0 ' + pageWidthForPdf.toFixed(2) + ' ' + pageHeightForPdf.toFixed(2) + ']' +
        ' /Resources << /Font << ' + fontResourceEntriesForPdf + ' >>' + xobjectEntryForPdf +
        ' >> /Contents ' + contentIdForPdf + ' 0 R' + annotsEntryForPdf + ' >>');
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
    // latin1 encode: every char is a single byte (ASCII text plus the spliced binary image
    // streams, which are 0-255). This keeps .length-based xref offsets and /Length values exact
    // while letting raw JPEG bytes pass through uncorrupted (a UTF-8 TextEncoder would mangle them).
    var uint8ForPdf = new Uint8Array(outputForPdf.length);
    for (var byteIndexForPdf = 0; byteIndexForPdf < outputForPdf.length; byteIndexForPdf++) {
      uint8ForPdf[byteIndexForPdf] = outputForPdf.charCodeAt(byteIndexForPdf) & 0xff;
    }
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

  function prepareInputWithBlocksForDocumentGeneration(inputForPrepare, formatForPrepare, depsForPrepare) {
    var hasHtmlForPrepare = !Array.isArray(inputForPrepare.blocks)
      && typeof inputForPrepare.html === 'string'
      && inputForPrepare.html.trim();
    if (!hasHtmlForPrepare || (formatForPrepare !== 'docx' && formatForPrepare !== 'pdf')) {
      return Promise.resolve({ input: inputForPrepare, note: '' });
    }
    // pdf: resolve image sentinels (re-extracted from their source blobs), then rasterize each
    // to JPEG before the synchronous PDF assembly, tracking any that cannot be embedded.
    if (formatForPrepare === 'pdf') {
      var dropTrackerForPdfPrepare = makeImageDropTrackerForDocumentGeneration();
      return buildPdfImageResolverForDocumentGeneration(inputForPrepare.html, depsForPrepare).then(function (pdfResolverForPrepare) {
        var pdfParsedForPrepare = htmlToBlocksForDocumentGeneration(inputForPrepare.html, pdfResolverForPrepare, dropTrackerForPdfPrepare);
        return rasterizePdfImageBlocksForDocumentGeneration(pdfParsedForPrepare.blocks, dropTrackerForPdfPrepare).then(function (rasterizedBlocksForPrepare) {
          return {
            input: Object.assign({}, inputForPrepare, {
              blocks: rasterizedBlocksForPrepare,
              docDefaults: pdfParsedForPrepare.docDefaults
            }),
            note: dropTrackerForPdfPrepare.note()
          };
        });
      });
    }
    // docx: resolve image sentinels (re-extracted from their source blobs) before conversion,
    // tracking any that cannot be embedded so the result can note them.
    var dropTrackerForPrepare = makeImageDropTrackerForDocumentGeneration();
    return buildDocxImageResolverForDocumentGeneration(inputForPrepare.html, depsForPrepare).then(function (resolverForPrepare) {
      var docxParsedForPrepare = htmlToBlocksForDocumentGeneration(inputForPrepare.html, resolverForPrepare, dropTrackerForPrepare);
      return {
        input: Object.assign({}, inputForPrepare, {
          blocks: docxParsedForPrepare.blocks,
          docDefaults: docxParsedForPrepare.docDefaults
        }),
        note: dropTrackerForPrepare.note()
      };
    });
  }

  function createDocumentForDocumentGeneration(inputForDocumentGeneration, depsForDocumentGeneration) {
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
    return prepareInputWithBlocksForDocumentGeneration(safeInputForDocumentGeneration, formatForDocumentGeneration, depsForDocumentGeneration)
      .then(function (preparedForDocumentGeneration) {
        var preparedInputForDocumentGeneration = preparedForDocumentGeneration.input;
        var noteForDocumentGeneration = preparedForDocumentGeneration.note;
        var builtForDocumentGeneration;
        if (formatForDocumentGeneration === 'xlsx') {
          builtForDocumentGeneration = buildXlsxForDocumentGeneration(preparedInputForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'csv') {
          builtForDocumentGeneration = buildCsvForDocumentGeneration(preparedInputForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'docx') {
          builtForDocumentGeneration = buildDocxForDocumentGeneration(preparedInputForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'pdf') {
          builtForDocumentGeneration = buildPdfForDocumentGeneration(preparedInputForDocumentGeneration);
        } else {
          builtForDocumentGeneration = buildPptxForDocumentGeneration(preparedInputForDocumentGeneration);
        }
        return Promise.resolve(builtForDocumentGeneration).then(function (resultForDocumentGeneration) {
          var responseForDocumentGeneration = {
            ok: true,
            format: formatForDocumentGeneration,
            filename: filenameForDocumentGeneration,
            mimeType: resultForDocumentGeneration.mimeType,
            dataUrl: resultForDocumentGeneration.dataUrl,
            size: resultForDocumentGeneration.size
          };
          if (noteForDocumentGeneration) responseForDocumentGeneration.note = noteForDocumentGeneration;
          return responseForDocumentGeneration;
        });
      });
  }

  agentNamespaceForDocumentGeneration.documentGeneration = {
    createDocument: createDocumentForDocumentGeneration
  };

  globalScopeForDocumentGeneration.ABChatAgent = agentNamespaceForDocumentGeneration;
})();
