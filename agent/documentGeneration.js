(function () {
  var globalScopeForDocumentGeneration = globalThis;
  var agentNamespaceForDocumentGeneration = globalScopeForDocumentGeneration.ABChatAgent || {};

  var DOCX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var XLSX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var PDF_MIME_FOR_DOCUMENT_GENERATION = 'application/pdf';
  var PPTX_MIME_FOR_DOCUMENT_GENERATION = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  var CSV_MIME_FOR_DOCUMENT_GENERATION = 'text/csv;charset=utf-8';
  var MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION = 500;
  var MAX_HTML_INPUT_CHARS_FOR_DOCUMENT_GENERATION = 200000;
  var MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION = 100;
  var MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION = 5000;
  // XLSX sheets and CSV files. A 10,000-row sheet with a lookup or conditional formula on every
  // row builds in under a second, because agent/xlsxFormulas.js indexes the ranges it reads.
  var MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION = 10000;
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

  // Glyph widths of the base-14 fonts in thousandths of an em, for WinAnsi codes 32 to 255,
  // taken from pdf.js's standard font metrics. Oblique Helvetica shares the upright widths, and
  // every Courier glyph is 600. Real widths let the PDF writer wrap, centre and right-align text
  // instead of guessing from the character count.
  var PDF_WIDTH_TABLES_SOURCE_FOR_DOCUMENT_GENERATION = {
    'Helvetica': '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500',
    'Helvetica-Bold': '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556',
    'Times-Roman': '250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,350,500,350,333,500,444,1000,500,500,333,1000,556,333,889,350,611,350,350,333,333,444,444,350,500,1000,333,980,389,333,722,350,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500',
    'Times-Bold': '250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,350,500,350,333,500,500,1000,500,500,333,1000,556,333,1000,350,667,350,350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500',
    'Times-Italic': '250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,350,500,350,333,500,556,889,500,500,333,1000,500,333,944,350,556,350,350,333,333,556,556,350,500,889,333,980,389,333,667,350,389,556,250,389,500,500,500,500,275,500,333,760,276,500,675,333,760,333,400,675,300,300,333,500,523,250,333,300,310,500,750,750,750,500,611,611,611,611,611,611,889,667,611,611,611,611,333,333,333,333,722,667,722,722,722,722,722,675,722,722,722,722,722,556,611,500,500,500,500,500,500,500,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,675,500,500,500,500,500,444,500,444',
    'Times-BoldItalic': '250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,570,350,500,350,333,500,500,1000,500,500,333,1000,556,333,944,350,611,350,350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,389,611,250,389,500,500,500,500,220,500,333,747,266,500,606,333,747,333,400,570,300,300,333,576,500,250,333,300,300,500,750,750,750,500,667,667,667,667,667,667,944,667,667,667,667,667,389,389,389,389,722,722,722,722,722,722,722,570,722,722,722,722,722,611,611,500,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,444,500,444'
  };
  // WinAnsiEncoding (cp1252) bytes 0x80 to 0x9F; 0xA0 to 0xFF match Latin-1. Zero marks the
  // five bytes cp1252 leaves undefined.
  var CP1252_HIGH_CODEPOINTS_FOR_DOCUMENT_GENERATION = [
    0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
    0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178
  ];
  // Characters outside WinAnsi that have a readable plain stand-in. Anything else is reduced to
  // its base letter when it has one (o with a dot below becomes o) and otherwise shown as "?".
  var PDF_CHAR_STAND_INS_FOR_DOCUMENT_GENERATION = {
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-', '\u2043': '-',
    '\u2032': "'", '\u2033': '"', '\u2190': '<-', '\u2192': '->', '\u2194': '<->', '\u21D2': '=>',
    '\u2264': '<=', '\u2265': '>=', '\u2260': '!=', '\u2248': '~', '\u2713': 'v', '\u2714': 'v',
    '\u2717': 'x', '\u2718': 'x', '\u25CF': '\u2022', '\u25AA': '\u2022', '\u25E6': 'o', '\u2023': '\u2022',
    '\u2009': ' ', '\u200A': ' ', '\u2002': ' ', '\u2003': ' ', '\u2007': ' ', '\u2008': ' ', '\u202F': ' ',
    '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u00AD': '',
    '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i'
  };
  var MAX_PDF_TABLE_ROWS_FOR_DOCUMENT_GENERATION = 500;
  var MAX_PDF_PAGES_FOR_DOCUMENT_GENERATION = 400;
  var DOCX_JUSTIFICATION_FOR_DOCUMENT_GENERATION = { left: 'left', center: 'center', right: 'right', justify: 'both' };
  // A paragraph or cell value that reads as a figure: 1,480 / -3.5 / (12) / 14.1% / €4.2M / 2.5x.
  var NUMERIC_CELL_RE_FOR_DOCUMENT_GENERATION = /^[(\-+\u2212]?\s*[$\u20ac\u00a3\u00a5\u20a6\u20b9]?\s*\d[\d,.\u00a0 ]*\s*(%|[kKmMbB]|bn|x|pp)?\s*\)?$/;
  var TOTAL_ROW_RE_FOR_DOCUMENT_GENERATION = /^(grand\s+total|totals?|subtotal|sum|net)\b/i;

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

  // cutsForCell, when given, counts what the limits cut: { rows, columns, cells }, where rows is
  // the row count before the cut and columns the widest row.
  function normalizeCellForDocumentGeneration(cellForDocumentGeneration, cutsForCell) {
    if (cellForDocumentGeneration == null) return '';
    if (typeof cellForDocumentGeneration === 'number' || typeof cellForDocumentGeneration === 'boolean') {
      return cellForDocumentGeneration;
    }
    var textForDocumentGeneration = String(cellForDocumentGeneration);
    if (textForDocumentGeneration.length > MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION) {
      if (cutsForCell) cutsForCell.cells++;
      return textForDocumentGeneration.slice(0, MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION);
    }
    return textForDocumentGeneration;
  }

  function normalizeRowsForDocumentGeneration(rowsForDocumentGeneration, maxRowsForNormalize, cutsForRows) {
    if (!Array.isArray(rowsForDocumentGeneration)) return [];
    var limitForRows = maxRowsForNormalize || MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION;
    if (cutsForRows && rowsForDocumentGeneration.length > limitForRows) cutsForRows.rows = rowsForDocumentGeneration.length;
    return rowsForDocumentGeneration.slice(0, limitForRows).map(function (rowForDocumentGeneration) {
      if (!Array.isArray(rowForDocumentGeneration)) {
        return [normalizeCellForDocumentGeneration(rowForDocumentGeneration, cutsForRows)];
      }
      if (cutsForRows && rowForDocumentGeneration.length > MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION) {
        cutsForRows.columns = Math.max(cutsForRows.columns, rowForDocumentGeneration.length);
      }
      return rowForDocumentGeneration.slice(0, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION).map(function (cellForRow) {
        return normalizeCellForDocumentGeneration(cellForRow, cutsForRows);
      });
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

  // ---- XLSX ----
  // The workbook is written by hand on JSZip, so it can carry what SheetJS's community build
  // cannot: fonts, fills and borders from the theme, number formats, a frozen header, filters,
  // print setup, and formulas with their results already worked out (agent/xlsxFormulas.js).

  var MAX_XLSX_SHEETS_FOR_DOCUMENT_GENERATION = 20;
  var XLSX_WRAP_CHARS_FOR_DOCUMENT_GENERATION = 60;
  var XLSX_MAX_AUTO_WIDTH_FOR_DOCUMENT_GENERATION = 60;
  var XLSX_WIDTH_SAMPLE_ROWS_FOR_DOCUMENT_GENERATION = 2000;
  var XLSX_MAX_REPORTED_PROBLEMS_FOR_DOCUMENT_GENERATION = 8;
  var XLSX_MAIN_NS_FOR_DOCUMENT_GENERATION = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var XLSX_REL_NS_FOR_DOCUMENT_GENERATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var ISO_DATE_RE_FOR_DOCUMENT_GENERATION = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  // Symbol before the amount, and the decimals the currency uses.
  var XLSX_CURRENCIES_FOR_DOCUMENT_GENERATION = {
    USD: ['$', 2], EUR: ['\u20AC', 2], GBP: ['\u00A3', 2], JPY: ['\u00A5', 0], CNY: ['\u00A5', 2], INR: ['\u20B9', 2],
    NGN: ['\u20A6', 2], KRW: ['\u20A9', 0], CAD: ['CA$', 2], AUD: ['A$', 2], NZD: ['NZ$', 2], BRL: ['R$', 2],
    MXN: ['MX$', 2], CHF: ['CHF ', 2], ZAR: ['R', 2], KES: ['KSh ', 2], GHS: ['GH\u20B5', 2], SGD: ['S$', 2],
    HKD: ['HK$', 2], SEK: ['SEK ', 2], NOK: ['NOK ', 2], DKK: ['DKK ', 2], PLN: ['PLN ', 2], TRY: ['\u20BA', 2],
    AED: ['AED ', 2], SAR: ['SAR ', 2], ILS: ['\u20AA', 2], PHP: ['\u20B1', 2], IDR: ['Rp ', 0], VND: ['\u20AB', 0],
    EGP: ['E\u00A3', 2], PKR: ['Rs ', 2], BDT: ['\u09F3', 2], THB: ['\u0E3F', 2], MYR: ['RM ', 2], RUB: ['\u20BD', 2]
  };

  function xlsxEscapeForDocumentGeneration(valueForEscape) {
    return String(valueForEscape == null ? '' : valueForEscape)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function xlsxQuotedLiteralForDocumentGeneration(textForLiteral) {
    return '"' + String(textForLiteral).replace(/"/g, '') + '"';
  }

  // A named format ("percent", "currency:EUR", "decimal:1", "date") or an Excel format code.
  // Returns { code, kind } with kind number, percent, currency, date, or text; null means General.
  // Whether text is an Excel number format code. Excel repairs a file whose styles hold a code it
  // cannot parse, so a word such as "USD" or "dollars" must be refused, not passed through.
  // Quoted text, escaped characters, padding and fill characters, and bracketed parts ([Red],
  // [$\u20AC-407], [h], [>=100]) are removed first; what is left may hold only placeholders,
  // date and time letters, separators, and the characters Excel shows without quotes.
  function xlsxFormatCodeIsValidForDocumentGeneration(codeForCheck) {
    if (/[\x00-\x1F]/.test(codeForCheck)) return false;
    var restForCheck = codeForCheck
      .replace(/"[^"]*"/g, '')
      .replace(/\\./g, '')
      .replace(/[_*]./g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/AM\/PM|A\/P/gi, '');
    if (restForCheck.split(';').length > 4) return false;
    if (!/[0#?@%]|[ymdhs]/i.test(restForCheck)) return false;
    return /^[0-9#?.,%Ee+\-\/():;$@ ymdhs!^&'~{}<>=\u00A0\u00A2-\u00A5\u20A0-\u20CF]*$/i.test(restForCheck);
  }

  function xlsxNumberFormatForDocumentGeneration(formatForXlsx, warningsForFormat) {
    if (formatForXlsx == null || formatForXlsx === '') return null;
    var rawForFormat = String(formatForXlsx).trim();
    var lowerForFormat = rawForFormat.toLowerCase();
    var partsForFormat = lowerForFormat.split(':');
    var decimalsForFormat = function (indexForDecimals, fallbackForDecimals) {
      var valueForDecimals = partsForFormat[indexForDecimals];
      if (valueForDecimals == null || valueForDecimals === '') return fallbackForDecimals;
      var numberForDecimals = Math.floor(Number(valueForDecimals));
      return isFinite(numberForDecimals) ? Math.max(0, Math.min(6, numberForDecimals)) : fallbackForDecimals;
    };
    var fractionForFormat = function (countForFraction) { return countForFraction > 0 ? '.' + new Array(countForFraction + 1).join('0') : ''; };
    if (lowerForFormat === 'general') return null;
    if (lowerForFormat === 'text') return { code: '@', kind: 'text' };
    if (lowerForFormat === 'integer') return { code: '#,##0', kind: 'number' };
    if (partsForFormat[0] === 'decimal' || partsForFormat[0] === 'number') return { code: '#,##0' + fractionForFormat(decimalsForFormat(1, 2)), kind: 'number' };
    if (partsForFormat[0] === 'percent') return { code: '0' + fractionForFormat(decimalsForFormat(1, 0)) + '%', kind: 'percent' };
    if (partsForFormat[0] === 'currency') {
      var codeForCurrency = String(partsForFormat[1] || 'USD').toUpperCase();
      var knownForCurrency = XLSX_CURRENCIES_FOR_DOCUMENT_GENERATION[codeForCurrency];
      var placesForCurrency = decimalsForFormat(2, knownForCurrency ? knownForCurrency[1] : 2);
      var amountForCurrency = '#,##0' + fractionForFormat(placesForCurrency);
      return {
        code: knownForCurrency
          ? xlsxQuotedLiteralForDocumentGeneration(knownForCurrency[0]) + amountForCurrency
          : amountForCurrency + ' ' + xlsxQuotedLiteralForDocumentGeneration(codeForCurrency.slice(0, 5)),
        kind: 'currency'
      };
    }
    if (lowerForFormat === 'date') return { code: 'yyyy-mm-dd', kind: 'date' };
    if (lowerForFormat === 'datetime') return { code: 'yyyy-mm-dd hh:mm', kind: 'date' };
    if (lowerForFormat === 'time') return { code: 'hh:mm', kind: 'date' };
    if (lowerForFormat === 'month') return { code: 'mmm yyyy', kind: 'date' };
    if (rawForFormat.length <= 80 && xlsxFormatCodeIsValidForDocumentGeneration(rawForFormat)) {
      var kindForRaw = /[ymdhs]/i.test(rawForFormat.replace(/"[^"]*"/g, '')) && !/[0#?]/.test(rawForFormat) ? 'date' : (/%/.test(rawForFormat) ? 'percent' : 'number');
      return { code: rawForFormat, kind: kindForRaw };
    }
    if (warningsForFormat) warningsForFormat.push('The number format "' + rawForFormat.slice(0, 40) + '" was not recognised and was left out.');
    return null;
  }

  function xlsxDateSerialForDocumentGeneration(textForDate) {
    var matchForDate = ISO_DATE_RE_FOR_DOCUMENT_GENERATION.exec(String(textForDate));
    if (!matchForDate) return null;
    var yearForDate = Number(matchForDate[1]);
    var monthForDate = Number(matchForDate[2]);
    var dayForDate = Number(matchForDate[3]);
    if (yearForDate < 1900 || monthForDate < 1 || monthForDate > 12 || dayForDate < 1 || dayForDate > 31) return null;
    var checkForDate = new Date(Date.UTC(yearForDate, monthForDate - 1, dayForDate));
    if (checkForDate.getUTCMonth() !== monthForDate - 1) return null;
    var daysForDate = Math.round((checkForDate.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    var hasTimeForDate = matchForDate[4] != null;
    if (hasTimeForDate) {
      var hoursForDate = Number(matchForDate[4]);
      var minutesForDate = Number(matchForDate[5]);
      var secondsForDate = Number(matchForDate[6] || 0);
      if (hoursForDate > 23 || minutesForDate > 59 || secondsForDate > 59) return null;
      daysForDate += (hoursForDate * 3600 + minutesForDate * 60 + secondsForDate) / 86400;
    }
    return { serial: daysForDate, hasTime: hasTimeForDate };
  }

  function xlsxHexForDocumentGeneration(valueForHex) {
    var matchForHex = /^#?([0-9a-f]{6})$/i.exec(String(valueForHex == null ? '' : valueForHex).trim());
    return matchForHex ? matchForHex[1].toUpperCase() : '';
  }

  // Turns one input cell into { t, v, f, format, style }. t is blank, n, s, b, or f.
  function xlsxCellForDocumentGeneration(rawForCell, columnFormatForCell, contextForCell) {
    var cellForXlsx = { t: 'blank', v: null, f: null, format: null, style: {} };
    var valueForCell = rawForCell;
    var formatForCell = columnFormatForCell;
    if (rawForCell && typeof rawForCell === 'object' && !Array.isArray(rawForCell)) {
      valueForCell = rawForCell.v;
      if (rawForCell.format != null && rawForCell.format !== '') formatForCell = xlsxNumberFormatForDocumentGeneration(rawForCell.format, contextForCell.warnings);
      if (rawForCell.bold === true) cellForXlsx.style.bold = true;
      if (rawForCell.italic === true) cellForXlsx.style.italic = true;
      var colorForCell = xlsxHexForDocumentGeneration(rawForCell.color);
      if (colorForCell) cellForXlsx.style.color = colorForCell;
      var fillForCell = xlsxHexForDocumentGeneration(rawForCell.fill);
      if (fillForCell) { cellForXlsx.style.fill = fillForCell; contextForCell.hasFills = true; }
      var alignForCell = String(rawForCell.align || '').toLowerCase();
      if (alignForCell === 'left' || alignForCell === 'center' || alignForCell === 'right') cellForXlsx.style.align = alignForCell;
      if (rawForCell.wrap === true) cellForXlsx.style.wrap = true;
      if (typeof rawForCell.f === 'string' && rawForCell.f.replace(/^\s*=/, '').trim()) {
        cellForXlsx.t = 'f';
        cellForXlsx.f = rawForCell.f;
        cellForXlsx.format = formatForCell;
        return cellForXlsx;
      }
    }
    cellForXlsx.format = formatForCell;
    if (valueForCell == null || valueForCell === '') return cellForXlsx;
    if (typeof valueForCell === 'number') {
      if (!isFinite(valueForCell)) return cellForXlsx;
      cellForXlsx.t = 'n';
      cellForXlsx.v = valueForCell;
      return cellForXlsx;
    }
    if (typeof valueForCell === 'boolean') {
      cellForXlsx.t = 'b';
      cellForXlsx.v = valueForCell;
      return cellForXlsx;
    }
    var textForCell = typeof valueForCell === 'object' ? JSON.stringify(valueForCell) : String(valueForCell);
    if (textForCell.length > MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION) {
      textForCell = textForCell.slice(0, MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION);
      contextForCell.cutCells++;
    }
    // A date written as an ISO string becomes a real date, unless its format says text.
    if (!formatForCell || formatForCell.kind === 'date') {
      var dateForCell = xlsxDateSerialForDocumentGeneration(textForCell);
      if (dateForCell) {
        cellForXlsx.t = 'n';
        cellForXlsx.v = dateForCell.serial;
        if (!formatForCell) cellForXlsx.format = xlsxNumberFormatForDocumentGeneration(dateForCell.hasTime ? 'datetime' : 'date');
        return cellForXlsx;
      }
    }
    cellForXlsx.t = 's';
    cellForXlsx.v = textForCell;
    return cellForXlsx;
  }

  function xlsxSheetNamesForDocumentGeneration(sheetSpecsForNames, warningsForNames) {
    var takenForNames = {};
    return sheetSpecsForNames.map(function (specForName, indexForName) {
      var requestedForName = specForName && specForName.name != null ? String(specForName.name) : '';
      var cleanForName = sanitizeSheetNameForDocumentGeneration(requestedForName, 'Sheet' + (indexForName + 1)).replace(/^'+|'+$/g, '').trim() || ('Sheet' + (indexForName + 1));
      if (/^history$/i.test(cleanForName)) cleanForName = cleanForName + ' 1';
      var finalForName = cleanForName;
      var counterForName = 2;
      while (takenForNames[finalForName.toLowerCase()]) {
        var suffixForName = ' (' + counterForName + ')';
        finalForName = cleanForName.slice(0, 31 - suffixForName.length) + suffixForName;
        counterForName++;
      }
      takenForNames[finalForName.toLowerCase()] = true;
      if (requestedForName.trim() && finalForName !== requestedForName.trim()) {
        warningsForNames.push('Sheet "' + requestedForName.trim().slice(0, 40) + '" was named "' + finalForName + '", because Excel allows 31 characters, no : \\ / ? * [ ], and no two sheets with the same name. Formulas must use the new name.');
      }
      return finalForName;
    });
  }

  function xlsxColumnSpecsForDocumentGeneration(columnsForSpecs, warningsForSpecs) {
    if (!Array.isArray(columnsForSpecs)) return [];
    return columnsForSpecs.slice(0, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION).map(function (entryForSpec) {
      if (entryForSpec == null) return {};
      if (typeof entryForSpec === 'string') return { format: xlsxNumberFormatForDocumentGeneration(entryForSpec, warningsForSpecs) };
      if (typeof entryForSpec !== 'object') return {};
      var specForColumn = {};
      if (entryForSpec.format != null) specForColumn.format = xlsxNumberFormatForDocumentGeneration(entryForSpec.format, warningsForSpecs);
      var widthForColumn = Number(entryForSpec.width);
      if (isFinite(widthForColumn) && widthForColumn > 0) specForColumn.width = Math.max(2, Math.min(120, widthForColumn));
      var alignForColumn = String(entryForSpec.align || '').toLowerCase();
      if (alignForColumn === 'left' || alignForColumn === 'center' || alignForColumn === 'right') specForColumn.align = alignForColumn;
      return specForColumn;
    });
  }

  // Characters a value takes when shown, used to size its column.
  function xlsxDisplayLengthForDocumentGeneration(cellForLength, cachedForLength) {
    var valueForLength = cellForLength.t === 'f' ? (cachedForLength ? cachedForLength.value : null) : cellForLength.v;
    if (cellForLength.t === 'f' && (!cachedForLength || cachedForLength.value == null)) return 10;
    if (valueForLength == null) return 0;
    if (typeof valueForLength === 'boolean') return 5;
    if (typeof valueForLength === 'string') {
      return valueForLength.split('\n').reduce(function (longestForLength, lineForLength) {
        var unitsForLength = 0;
        for (var iForUnits = 0; iForUnits < lineForLength.length; iForUnits++) unitsForLength += lineForLength.charCodeAt(iForUnits) >= 0x2E80 ? 2 : 1;
        return Math.max(longestForLength, unitsForLength);
      }, 0);
    }
    var formatForLength = cellForLength.format;
    if (formatForLength && formatForLength.kind === 'date') return formatForLength.code.length;
    if (!formatForLength) {
      var generalForLength = String(Number(valueForLength.toPrecision(10)));
      return Math.min(11, generalForLength.length);
    }
    var codeForLength = formatForLength.code.split(';')[0];
    var decimalsMatchForLength = /\.(0+)/.exec(codeForLength);
    var decimalsForLength = decimalsMatchForLength ? decimalsMatchForLength[1].length : 0;
    var shownForLength = formatForLength.kind === 'percent' ? valueForLength * 100 : valueForLength;
    var integerDigitsForLength = String(Math.floor(Math.abs(shownForLength))).length;
    var groupsForLength = /#,##/.test(codeForLength) ? Math.floor((integerDigitsForLength - 1) / 3) : 0;
    var literalForLength = (codeForLength.match(/"[^"]*"/g) || []).join('').replace(/"/g, '').length;
    return integerDigitsForLength + groupsForLength + (decimalsForLength ? decimalsForLength + 1 : 0)
      + (shownForLength < 0 ? 1 : 0) + (formatForLength.kind === 'percent' ? 1 : 0) + literalForLength;
  }

  function makeXlsxStylesForDocumentGeneration(fontNameForStyles, textColorForStyles) {
    var fontsForStyles = [];
    var fontKeysForStyles = {};
    var fillsForStyles = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    var fillKeysForStyles = {};
    var bordersForStyles = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    var borderKeysForStyles = { '': 0 };
    var numFmtsForStyles = [];
    var numFmtIdsForStyles = { '@': 49 };
    var xfsForStyles = [];
    var xfKeysForStyles = {};
    var dxfsForStyles = [];

    function fontId(boldForFont, italicForFont, colorForFont) {
      var keyForFont = (boldForFont ? 'b' : '') + (italicForFont ? 'i' : '') + '|' + (colorForFont || textColorForStyles);
      if (fontKeysForStyles[keyForFont] != null) return fontKeysForStyles[keyForFont];
      fontKeysForStyles[keyForFont] = fontsForStyles.length;
      fontsForStyles.push('<font>' + (boldForFont ? '<b/>' : '') + (italicForFont ? '<i/>' : '') + '<sz val="11"/><color rgb="FF'
        + (colorForFont || textColorForStyles) + '"/><name val="' + xlsxEscapeForDocumentGeneration(fontNameForStyles) + '"/><family val="2"/></font>');
      return fontKeysForStyles[keyForFont];
    }
    function fillId(colorForFill) {
      if (!colorForFill) return 0;
      if (fillKeysForStyles[colorForFill] != null) return fillKeysForStyles[colorForFill];
      fillKeysForStyles[colorForFill] = fillsForStyles.length;
      fillsForStyles.push('<fill><patternFill patternType="solid"><fgColor rgb="FF' + colorForFill + '"/><bgColor indexed="64"/></patternFill></fill>');
      return fillKeysForStyles[colorForFill];
    }
    // edges: { top, bottom, left, right } each { style: thin|medium, color } or absent.
    function borderId(edgesForBorder) {
      var safeEdgesForBorder = edgesForBorder || {};
      var keyForBorder = ['left', 'right', 'top', 'bottom'].map(function (sideForKey) {
        var edgeForKey = safeEdgesForBorder[sideForKey];
        return edgeForKey ? edgeForKey.style + edgeForKey.color : '';
      }).join('|');
      if (keyForBorder === '|||') return 0;
      if (borderKeysForStyles[keyForBorder] != null) return borderKeysForStyles[keyForBorder];
      borderKeysForStyles[keyForBorder] = bordersForStyles.length;
      bordersForStyles.push('<border>' + ['left', 'right', 'top', 'bottom'].map(function (sideForXml) {
        var edgeForXml = safeEdgesForBorder[sideForXml];
        return edgeForXml ? '<' + sideForXml + ' style="' + edgeForXml.style + '"><color rgb="FF' + edgeForXml.color + '"/></' + sideForXml + '>' : '<' + sideForXml + '/>';
      }).join('') + '<diagonal/></border>');
      return borderKeysForStyles[keyForBorder];
    }
    function numFmtId(codeForNumFmt) {
      if (!codeForNumFmt) return 0;
      if (numFmtIdsForStyles[codeForNumFmt] != null) return numFmtIdsForStyles[codeForNumFmt];
      var idForNumFmt = 164 + numFmtsForStyles.length;
      numFmtIdsForStyles[codeForNumFmt] = idForNumFmt;
      numFmtsForStyles.push('<numFmt numFmtId="' + idForNumFmt + '" formatCode="' + xlsxEscapeForDocumentGeneration(codeForNumFmt) + '"/>');
      return idForNumFmt;
    }
    // look: { bold, italic, color, fill, borders, format, align, valign, wrap }
    function xfId(lookForXf) {
      var numFmtForXf = numFmtId(lookForXf.format);
      var fontForXf = fontId(lookForXf.bold, lookForXf.italic, lookForXf.color);
      var fillForXf = fillId(lookForXf.fill);
      var borderForXf = borderId(lookForXf.borders);
      var alignmentForXf = (lookForXf.align ? ' horizontal="' + lookForXf.align + '"' : '')
        + (lookForXf.valign ? ' vertical="' + lookForXf.valign + '"' : '')
        + (lookForXf.wrap ? ' wrapText="1"' : '');
      var keyForXf = [numFmtForXf, fontForXf, fillForXf, borderForXf, alignmentForXf].join('|');
      if (xfKeysForStyles[keyForXf] != null) return xfKeysForStyles[keyForXf];
      xfKeysForStyles[keyForXf] = xfsForStyles.length;
      xfsForStyles.push('<xf numFmtId="' + numFmtForXf + '" fontId="' + fontForXf + '" fillId="' + fillForXf + '" borderId="' + borderForXf + '" xfId="0"'
        + (numFmtForXf ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' + (fillForXf ? ' applyFill="1"' : '') + (borderForXf ? ' applyBorder="1"' : '')
        + (alignmentForXf ? ' applyAlignment="1"><alignment' + alignmentForXf + '/></xf>' : '/>'));
      return xfKeysForStyles[keyForXf];
    }
    function dxfFill(colorForDxf) {
      dxfsForStyles.push('<dxf><fill><patternFill patternType="solid"><bgColor rgb="FF' + colorForDxf + '"/></patternFill></fill></dxf>');
      return dxfsForStyles.length - 1;
    }
    xfId({});
    function xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="' + XLSX_MAIN_NS_FOR_DOCUMENT_GENERATION + '">'
        + (numFmtsForStyles.length ? '<numFmts count="' + numFmtsForStyles.length + '">' + numFmtsForStyles.join('') + '</numFmts>' : '')
        + '<fonts count="' + fontsForStyles.length + '">' + fontsForStyles.join('') + '</fonts>'
        + '<fills count="' + fillsForStyles.length + '">' + fillsForStyles.join('') + '</fills>'
        + '<borders count="' + bordersForStyles.length + '">' + bordersForStyles.join('') + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="' + xfsForStyles.length + '">' + xfsForStyles.join('') + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="' + dxfsForStyles.length + '">' + dxfsForStyles.join('') + '</dxfs>'
        + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
        + '</styleSheet>';
    }
    return { xfId: xfId, dxfFill: dxfFill, xml: xml };
  }

  // The table look from the theme: header, body rule, and total row.
  function xlsxTableLookForDocumentGeneration(themeForLook) {
    var colorsForLook = themeForLook ? themeForLook.colors : { text: '1F2328', heading: '1F2328', tableHeaderFill: '', tableHeaderText: '1F2328', tableHeaderRule: '1F2328', tableBorder: 'D0D7DE', tableStripe: '' };
    var styleForLook = themeForLook ? themeForLook.table.style : 'lines';
    var hairlineForLook = { style: 'thin', color: colorsForLook.tableBorder };
    var ruleForLook = { style: 'medium', color: colorsForLook.tableHeaderRule || colorsForLook.text };
    var lookForTable = {
      header: { bold: true, color: colorsForLook.tableHeaderText || colorsForLook.heading, fill: colorsForLook.tableHeaderFill || '', borders: {}, valign: 'center' },
      body: { borders: {} },
      lastBody: null,
      total: { bold: true, borders: { top: { style: 'thin', color: colorsForLook.tableHeaderRule || colorsForLook.text } } },
      stripe: themeForLook && themeForLook.table.zebra ? colorsForLook.tableStripe : ''
    };
    if (styleForLook === 'grid') {
      var gridForLook = { top: hairlineForLook, bottom: hairlineForLook, left: hairlineForLook, right: hairlineForLook };
      lookForTable.header.borders = gridForLook;
      lookForTable.body.borders = gridForLook;
      lookForTable.total.borders = { top: { style: 'medium', color: colorsForLook.text }, bottom: hairlineForLook, left: hairlineForLook, right: hairlineForLook };
    } else if (styleForLook === 'booktabs') {
      lookForTable.header.borders = { top: ruleForLook, bottom: { style: 'thin', color: colorsForLook.text } };
      lookForTable.lastBody = { bottom: ruleForLook };
      lookForTable.total.borders = { top: { style: 'thin', color: colorsForLook.text }, bottom: ruleForLook };
    } else {
      lookForTable.header.borders = lookForTable.header.fill ? {} : { bottom: ruleForLook };
      lookForTable.body.borders = { bottom: hairlineForLook };
    }
    return lookForTable;
  }

  function xlsxCellRefForDocumentGeneration(rowForRef, columnForRef) {
    var formulasForRef = agentNamespaceForDocumentGeneration.xlsxFormulas;
    if (formulasForRef) return formulasForRef.cellName(rowForRef, columnForRef);
    var nameForRef = '';
    var restForRef = columnForRef + 1;
    while (restForRef > 0) {
      var remainderForRef = (restForRef - 1) % 26;
      nameForRef = String.fromCharCode(65 + remainderForRef) + nameForRef;
      restForRef = Math.floor((restForRef - 1) / 26);
    }
    return nameForRef + (rowForRef + 1);
  }

  function xlsxQuotedSheetForDocumentGeneration(nameForQuote) {
    return "'" + String(nameForQuote).replace(/'/g, "''") + "'";
  }

  // Shared by the XLSX and CSV writers: each sheet's cells, with formulas checked and evaluated.
  function prepareXlsxWorkbookForDocumentGeneration(inputForWorkbook, warningsForWorkbook) {
    var specsForWorkbook = Array.isArray(inputForWorkbook.sheets) ? inputForWorkbook.sheets : [];
    var fromContentForWorkbook = false;
    if (specsForWorkbook.length === 0 && typeof inputForWorkbook.content === 'string' && inputForWorkbook.content.trim()) {
      fromContentForWorkbook = true;
      specsForWorkbook = [{ name: 'Sheet1', rows: rowsFromContentForDocumentGeneration(inputForWorkbook.content) }];
    }
    if (specsForWorkbook.length > MAX_XLSX_SHEETS_FOR_DOCUMENT_GENERATION) {
      warningsForWorkbook.push('The workbook keeps the first ' + MAX_XLSX_SHEETS_FOR_DOCUMENT_GENERATION + ' of ' + specsForWorkbook.length + ' sheets.');
      specsForWorkbook = specsForWorkbook.slice(0, MAX_XLSX_SHEETS_FOR_DOCUMENT_GENERATION);
    }
    var namesForWorkbook = xlsxSheetNamesForDocumentGeneration(specsForWorkbook, warningsForWorkbook);
    var countsForWorkbook = { cutCells: 0, hasFills: false, warnings: warningsForWorkbook };
    var sheetsForWorkbook = specsForWorkbook.map(function (specForSheet, indexForSheet) {
      var safeSpecForSheet = specForSheet && typeof specForSheet === 'object' ? specForSheet : {};
      var columnSpecsForSheet = xlsxColumnSpecsForDocumentGeneration(safeSpecForSheet.columns, warningsForWorkbook);
      var rawRowsForSheet = Array.isArray(safeSpecForSheet.rows) ? safeSpecForSheet.rows : [];
      if (rawRowsForSheet.length > MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION) {
        warningsForWorkbook.push('Sheet "' + namesForWorkbook[indexForSheet] + '" keeps the first ' + MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION + ' of ' + rawRowsForSheet.length + ' rows. Split the data across sheets or files.');
        rawRowsForSheet = rawRowsForSheet.slice(0, MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION);
      }
      var widestForSheet = 0;
      var rowsForSheet = rawRowsForSheet.map(function (rawRowForSheet) {
        var cellsForRow = Array.isArray(rawRowForSheet) ? rawRowForSheet : [rawRowForSheet];
        widestForSheet = Math.max(widestForSheet, cellsForRow.length);
        return cellsForRow.slice(0, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION);
      });
      if (widestForSheet > MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION) {
        warningsForWorkbook.push('Sheet "' + namesForWorkbook[indexForSheet] + '" keeps the first ' + MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION + ' columns.');
      }
      var firstRowCellsForSheet = rowsForSheet[0] || [];
      var looksLikeHeaderForSheet = rowsForSheet.length > 1 && firstRowCellsForSheet.some(function (rawForHeader) {
        var valueForHeader = rawForHeader && typeof rawForHeader === 'object' ? rawForHeader.v : rawForHeader;
        return typeof valueForHeader === 'string' && valueForHeader.trim() !== '';
      }) && firstRowCellsForSheet.every(function (rawForHeader) {
        if (rawForHeader && typeof rawForHeader === 'object' && typeof rawForHeader.f === 'string') return false;
        var valueForHeader = rawForHeader && typeof rawForHeader === 'object' ? rawForHeader.v : rawForHeader;
        return valueForHeader == null || valueForHeader === '' || (typeof valueForHeader === 'string' && !xlsxDateSerialForDocumentGeneration(valueForHeader));
      });
      var headerForSheet = typeof safeSpecForSheet.header === 'boolean' ? safeSpecForSheet.header && rowsForSheet.length > 0 : looksLikeHeaderForSheet;
      // Per sheet: a fill on one sheet must not turn off the stripes on the others.
      countsForWorkbook.hasFills = false;
      var cellsForSheet = rowsForSheet.map(function (rowCellsForSheet, rowIndexForSheet) {
        return rowCellsForSheet.map(function (rawForSheetCell, columnIndexForSheet) {
          var columnSpecForCell = columnSpecsForSheet[columnIndexForSheet] || {};
          var isHeaderCellForSheet = headerForSheet && rowIndexForSheet === 0;
          var cellForSheet = xlsxCellForDocumentGeneration(rawForSheetCell, isHeaderCellForSheet ? null : (columnSpecForCell.format || null), countsForWorkbook);
          // Text from content= that reads as a plain number is stored as one, so it adds up.
          if (fromContentForWorkbook && cellForSheet.t === 's' && /^-?\d+(\.\d+)?$/.test(cellForSheet.v.trim())) {
            cellForSheet.t = 'n';
            cellForSheet.v = Number(cellForSheet.v.trim());
          }
          return cellForSheet;
        });
      });
      return {
        name: namesForWorkbook[indexForSheet],
        spec: safeSpecForSheet,
        cells: cellsForSheet,
        columns: columnSpecsForSheet,
        header: headerForSheet,
        hasFills: countsForWorkbook.hasFills,
        columnCount: cellsForSheet.reduce(function (maxForCount, rowForCount) { return Math.max(maxForCount, rowForCount.length); }, 0)
      };
    });
    if (countsForWorkbook.cutCells) {
      warningsForWorkbook.push(countsForWorkbook.cutCells + ' cell' + (countsForWorkbook.cutCells === 1 ? ' was' : 's were') + ' cut to ' + MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + ' characters.');
    }

    // Formulas: check each, store the cleaned text, then evaluate the whole workbook.
    var formulasForWorkbook = agentNamespaceForDocumentGeneration.xlsxFormulas;
    var refusedForWorkbook = [];
    var spillingForWorkbook = [];
    var unknownFunctionsForWorkbook = {};
    var evaluatorSheetsForWorkbook = sheetsForWorkbook.map(function (sheetForPrepare) {
      return {
        name: sheetForPrepare.name,
        rows: sheetForPrepare.cells.map(function (rowForPrepare, rowIndexForPrepare) {
          return rowForPrepare.map(function (cellForPrepare, columnIndexForPrepare) {
            if (cellForPrepare.t !== 'f') return { value: cellForPrepare.t === 'blank' ? null : cellForPrepare.v };
            if (!formulasForWorkbook) {
              cellForPrepare.stored = String(cellForPrepare.f).replace(/^\s*=/, '').trim();
              return { formula: null, value: null };
            }
            var preparedForCell = formulasForWorkbook.prepare(cellForPrepare.f);
            var refForCell = sheetForPrepare.name + '!' + xlsxCellRefForDocumentGeneration(rowIndexForPrepare, columnIndexForPrepare);
            if (!preparedForCell.ok) {
              refusedForWorkbook.push(refForCell + ' (' + preparedForCell.error + ')');
              cellForPrepare.t = 's';
              cellForPrepare.v = '=' + String(cellForPrepare.f).replace(/^\s*=/, '').trim();
              return { value: cellForPrepare.v };
            }
            cellForPrepare.stored = preparedForCell.stored;
            if (preparedForCell.spilling.length) spillingForWorkbook.push(refForCell + ' (' + preparedForCell.spilling.join(', ') + ')');
            cellForPrepare.allSupported = !preparedForCell.spilling.length;
            preparedForCell.functions.forEach(function (nameForFunction) {
              if (!formulasForWorkbook.supports(nameForFunction)) {
                unknownFunctionsForWorkbook[nameForFunction] = true;
                cellForPrepare.allSupported = false;
              }
            });
            return { formula: preparedForCell.stored };
          });
        })
      };
    });
    var resultsForWorkbook = formulasForWorkbook
      ? formulasForWorkbook.evaluateWorkbook(evaluatorSheetsForWorkbook).results
      : sheetsForWorkbook.map(function () { return {}; });
    var errorsForWorkbook = [];
    var circularForWorkbook = [];
    var unworkedForWorkbook = [];
    sheetsForWorkbook.forEach(function (sheetForResults, sheetIndexForResults) {
      sheetForResults.results = resultsForWorkbook[sheetIndexForResults] || {};
      sheetForResults.cells.forEach(function (rowForResults, rowIndexForResults) {
        rowForResults.forEach(function (cellForResults, columnIndexForResults) {
          if (cellForResults.t !== 'f') return;
          var resultForCell = sheetForResults.results[rowIndexForResults + ',' + columnIndexForResults];
          var refForResult = sheetForResults.name + '!' + xlsxCellRefForDocumentGeneration(rowIndexForResults, columnIndexForResults);
          if (resultForCell && resultForCell.error) errorsForWorkbook.push(refForResult + ' =' + String(cellForResults.f).replace(/^\s*=/, '').trim() + ' gives ' + resultForCell.error);
          if (resultForCell && resultForCell.circular) circularForWorkbook.push(refForResult);
          // Cells whose functions are all known but whose result still could not be worked out
          // (an array constant, a defined name). Unknown functions get their own warning below.
          if (resultForCell && resultForCell.unknown && cellForResults.allSupported) unworkedForWorkbook.push(refForResult);
        });
      });
    });
    function listProblems(itemsForList) {
      var shownForList = itemsForList.slice(0, XLSX_MAX_REPORTED_PROBLEMS_FOR_DOCUMENT_GENERATION).join('; ');
      return itemsForList.length > XLSX_MAX_REPORTED_PROBLEMS_FOR_DOCUMENT_GENERATION ? shownForList + '; and ' + (itemsForList.length - XLSX_MAX_REPORTED_PROBLEMS_FOR_DOCUMENT_GENERATION) + ' more' : shownForList;
    }
    if (refusedForWorkbook.length) warningsForWorkbook.push('These formulas would make Excel reject the file, so they were written as text: ' + listProblems(refusedForWorkbook) + '.');
    if (errorsForWorkbook.length) warningsForWorkbook.push('These formulas give an error: ' + listProblems(errorsForWorkbook) + '. Fix them and make the file again.');
    if (circularForWorkbook.length) warningsForWorkbook.push('These formulas refer back to their own cell (a circular reference): ' + listProblems(circularForWorkbook) + '.');
    if (spillingForWorkbook.length) warningsForWorkbook.push('These formulas return several values, which this file cannot spread into the cells below, so Excel would show only the first: ' + listProblems(spillingForWorkbook) + '. Work the values out in eval and write them as plain cells.');
    var unknownNamesForWorkbook = Object.keys(unknownFunctionsForWorkbook).filter(function (nameForUnknown) { return spillingForWorkbook.join(' ').indexOf(nameForUnknown) === -1; });
    if (unworkedForWorkbook.length) {
      warningsForWorkbook.push('These formulas could not be worked out here, so they have no saved result and show blank in viewers that do not calculate: ' + listProblems(unworkedForWorkbook) + '. Excel and Google Sheets calculate them on opening.');
    }
    if (unknownNamesForWorkbook.length) {
      warningsForWorkbook.push('Formulas using ' + unknownNamesForWorkbook.slice(0, 8).join(', ') + ' have no saved result, so viewers that do not calculate (file previews, mail attachments) show them blank. Excel and Google Sheets calculate them on opening.');
    }
    return { sheets: sheetsForWorkbook };
  }

  function xlsxSheetXmlForDocumentGeneration(sheetForXml, sheetIndexForXml, stylesForXml, sharedForXml, tableLookForXml, pageForXml, explicitOrientationForXml) {
    var cellsForXml = sheetForXml.cells;
    var rowCountForXml = cellsForXml.length;
    var columnCountForXml = Math.max(1, sheetForXml.columnCount);
    var headerForXml = sheetForXml.header && rowCountForXml > 0;
    var lastRowIndexForXml = rowCountForXml - 1;
    var totalRowForXml = -1;
    if (headerForXml && rowCountForXml >= 3) {
      var lastCellsForXml = cellsForXml[lastRowIndexForXml];
      for (var iForTotal = 0; iForTotal < lastCellsForXml.length; iForTotal++) {
        if (lastCellsForXml[iForTotal].t === 'blank') continue;
        if (lastCellsForXml[iForTotal].t === 's' && TOTAL_ROW_RE_FOR_DOCUMENT_GENERATION.test(String(lastCellsForXml[iForTotal].v).trim())) totalRowForXml = lastRowIndexForXml;
        break;
      }
    }
    var lastDataRowForXml = totalRowForXml === -1 ? lastRowIndexForXml : totalRowForXml - 1;
    var styledTableForXml = headerForXml;

    // A column's kind comes from most of its data cells, a formula counting as what it returns.
    // Figures are right-aligned, as Excel does. Dates and TRUE/FALSE are centred, because
    // right-aligned beside a left-aligned text column they run into it.
    var columnKindsForXml = [];
    var wrapColumnsForXml = [];
    var widthsForXml = [];
    for (var columnForScan = 0; columnForScan < columnCountForXml; columnForScan++) {
      var numbersForScan = 0;
      var textsForScan = 0;
      var datesForScan = 0;
      var booleansForScan = 0;
      var longestForScan = 0;
      var wrapForScan = false;
      for (var rowForScan = 0; rowForScan < rowCountForXml; rowForScan++) {
        if (rowForScan > XLSX_WIDTH_SAMPLE_ROWS_FOR_DOCUMENT_GENERATION && rowForScan !== lastRowIndexForXml) continue;
        var cellForScan = cellsForXml[rowForScan][columnForScan];
        if (!cellForScan || cellForScan.t === 'blank') continue;
        var isDataRowForScan = !(headerForXml && rowForScan === 0) && rowForScan !== totalRowForXml;
        if (isDataRowForScan) {
          var shownForScan = cellForScan.t === 'f' ? sheetForXml.results[rowForScan + ',' + columnForScan] : null;
          var shownTypeForScan = cellForScan.t === 'f'
            ? (shownForScan && !shownForScan.error && shownForScan.value != null ? typeof shownForScan.value : '')
            : (cellForScan.t === 'n' ? 'number' : (cellForScan.t === 'b' ? 'boolean' : 'string'));
          if (shownTypeForScan === 'number') {
            if (cellForScan.format && cellForScan.format.kind === 'date') datesForScan++;
            else numbersForScan++;
          } else if (shownTypeForScan === 'boolean') booleansForScan++;
          else if (shownTypeForScan === 'string') textsForScan++;
        }
        var lengthForScan = xlsxDisplayLengthForDocumentGeneration(cellForScan, sheetForXml.results[rowForScan + ',' + columnForScan]);
        if (headerForXml && rowForScan === 0) lengthForScan = lengthForScan * 1.1 + (sheetForXml.cells.length > 2 ? 2 : 0);
        if (cellForScan.t === 's' && lengthForScan > XLSX_WRAP_CHARS_FOR_DOCUMENT_GENERATION && isDataRowForScan) wrapForScan = true;
        longestForScan = Math.max(longestForScan, lengthForScan);
      }
      var mostForScan = Math.max(numbersForScan, textsForScan, datesForScan, booleansForScan);
      columnKindsForXml[columnForScan] = mostForScan === 0 ? 'text'
        : (datesForScan === mostForScan ? 'date' : (booleansForScan === mostForScan ? 'boolean' : (numbersForScan === mostForScan ? 'number' : 'text')));
      wrapColumnsForXml[columnForScan] = wrapForScan;
      var specForWidth = sheetForXml.columns[columnForScan] || {};
      widthsForXml[columnForScan] = specForWidth.width
        || Math.max(8, Math.min(XLSX_MAX_AUTO_WIDTH_FOR_DOCUMENT_GENERATION, Math.ceil(longestForScan + 2)));
    }

    var stripeDxfForXml = -1;
    if (styledTableForXml && tableLookForXml.stripe && !sheetForXml.hasFills && lastDataRowForXml >= 3) {
      stripeDxfForXml = stylesForXml.dxfFill(tableLookForXml.stripe);
    }

    var rowsXmlForXml = [];
    for (var rowIndexForXml = 0; rowIndexForXml < rowCountForXml; rowIndexForXml++) {
      var rowCellsForXml = cellsForXml[rowIndexForXml];
      var isHeaderRowForXml = headerForXml && rowIndexForXml === 0;
      var isTotalRowForXml = rowIndexForXml === totalRowForXml;
      var cellXmlForRow = [];
      // Styled table rows carry their borders across every column, empty cells included.
      var spanForRow = styledTableForXml ? columnCountForXml : rowCellsForXml.length;
      for (var columnIndexForXml = 0; columnIndexForXml < spanForRow; columnIndexForXml++) {
        var cellForXml = rowCellsForXml[columnIndexForXml] || { t: 'blank', v: null, format: null, style: {} };
        var columnSpecForXml = sheetForXml.columns[columnIndexForXml] || {};
        var lookForCell = {};
        if (styledTableForXml) {
          if (isHeaderRowForXml) lookForCell = Object.assign({}, tableLookForXml.header, { borders: tableLookForXml.header.borders });
          else if (isTotalRowForXml) lookForCell = Object.assign({}, tableLookForXml.total);
          else {
            lookForCell = { borders: tableLookForXml.body.borders };
            if (tableLookForXml.lastBody && rowIndexForXml === lastDataRowForXml && totalRowForXml === -1) lookForCell.borders = tableLookForXml.lastBody;
          }
          if (wrapColumnsForXml.some(Boolean) && !isHeaderRowForXml) lookForCell.valign = 'top';
        }
        var alignForXml = cellForXml.style.align || columnSpecForXml.align || '';
        var kindForAlign = columnKindsForXml[columnIndexForXml];
        if (!alignForXml && (kindForAlign === 'date' || kindForAlign === 'boolean') && cellForXml.t !== 's') alignForXml = 'center';
        if (!alignForXml && isHeaderRowForXml) alignForXml = kindForAlign === 'number' ? 'right' : (kindForAlign === 'date' || kindForAlign === 'boolean' ? 'center' : '');
        if (alignForXml) lookForCell.align = alignForXml;
        if (cellForXml.format) lookForCell.format = cellForXml.format.code;
        if (cellForXml.style.bold) lookForCell.bold = true;
        if (cellForXml.style.italic) lookForCell.italic = true;
        if (cellForXml.style.color) lookForCell.color = cellForXml.style.color;
        if (cellForXml.style.fill) lookForCell.fill = cellForXml.style.fill;
        var wrapsForXml = cellForXml.style.wrap || (cellForXml.t === 's' && !isHeaderRowForXml && cellForXml.v.length > XLSX_WRAP_CHARS_FOR_DOCUMENT_GENERATION) || (cellForXml.t === 's' && cellForXml.v.indexOf('\n') !== -1);
        if (wrapsForXml) lookForCell.wrap = true;
        if (isHeaderRowForXml && cellForXml.t === 's' && String(cellForXml.v).length * 1.1 > widthsForXml[columnIndexForXml]) lookForCell.wrap = true;
        var styleIdForXml = stylesForXml.xfId(lookForCell);
        var refForXml = xlsxCellRefForDocumentGeneration(rowIndexForXml, columnIndexForXml);
        var styleAttrForXml = styleIdForXml ? ' s="' + styleIdForXml + '"' : '';
        if (cellForXml.t === 'blank') {
          if (styleIdForXml) cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + '/>');
        } else if (cellForXml.t === 'n') {
          cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + '><v>' + cellForXml.v + '</v></c>');
        } else if (cellForXml.t === 'b') {
          cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + ' t="b"><v>' + (cellForXml.v ? 1 : 0) + '</v></c>');
        } else if (cellForXml.t === 's') {
          cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + ' t="s"><v>' + sharedForXml(cellForXml.v) + '</v></c>');
        } else {
          var resultForXml = sheetForXml.results[rowIndexForXml + ',' + columnIndexForXml];
          var formulaXmlForXml = '<f>' + xlsxEscapeForDocumentGeneration(cellForXml.stored) + '</f>';
          if (resultForXml && resultForXml.error) {
            cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + ' t="e">' + formulaXmlForXml + '<v>' + resultForXml.error + '</v></c>');
          } else if (resultForXml && resultForXml.value != null && !resultForXml.unknown) {
            var cachedForXml = resultForXml.value;
            if (typeof cachedForXml === 'number') cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + '>' + formulaXmlForXml + '<v>' + cachedForXml + '</v></c>');
            else if (typeof cachedForXml === 'boolean') cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + ' t="b">' + formulaXmlForXml + '<v>' + (cachedForXml ? 1 : 0) + '</v></c>');
            else cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + ' t="str">' + formulaXmlForXml + '<v>' + xlsxEscapeForDocumentGeneration(cachedForXml) + '</v></c>');
          } else {
            cellXmlForRow.push('<c r="' + refForXml + '"' + styleAttrForXml + '>' + formulaXmlForXml + '</c>');
          }
        }
      }
      rowsXmlForXml.push('<row r="' + (rowIndexForXml + 1) + '">' + cellXmlForRow.join('') + '</row>');
    }

    var lastColumnNameForXml = xlsxCellRefForDocumentGeneration(0, columnCountForXml - 1).replace(/\d+$/, '');
    var dimensionForXml = 'A1:' + lastColumnNameForXml + Math.max(1, rowCountForXml);
    var freezeSpecForXml = sheetForXml.spec.freeze && typeof sheetForXml.spec.freeze === 'object' ? sheetForXml.spec.freeze : {};
    var freezeRowsForXml = Math.max(0, Math.min(rowCountForXml, Math.floor(Number(freezeSpecForXml.rows != null ? freezeSpecForXml.rows : (headerForXml ? 1 : 0)) || 0)));
    var freezeColumnsForXml = Math.max(0, Math.min(columnCountForXml, Math.floor(Number(freezeSpecForXml.columns) || 0)));
    var paneForXml = '';
    if (freezeRowsForXml || freezeColumnsForXml) {
      var topLeftForXml = xlsxCellRefForDocumentGeneration(freezeRowsForXml, freezeColumnsForXml);
      var activePaneForXml = freezeRowsForXml && freezeColumnsForXml ? 'bottomRight' : (freezeRowsForXml ? 'bottomLeft' : 'topRight');
      paneForXml = '<pane' + (freezeColumnsForXml ? ' xSplit="' + freezeColumnsForXml + '"' : '') + (freezeRowsForXml ? ' ySplit="' + freezeRowsForXml + '"' : '')
        + ' topLeftCell="' + topLeftForXml + '" activePane="' + activePaneForXml + '" state="frozen"/>'
        + '<selection pane="' + activePaneForXml + '" activeCell="' + topLeftForXml + '" sqref="' + topLeftForXml + '"/>';
    }
    var colsForXml = widthsForXml.map(function (widthForCol, indexForCol) {
      return '<col min="' + (indexForCol + 1) + '" max="' + (indexForCol + 1) + '" width="' + (Math.round(widthForCol * 100) / 100) + '" customWidth="1"/>';
    }).join('');
    var filterRefForXml = headerForXml && lastDataRowForXml >= 2 ? 'A1:' + lastColumnNameForXml + (lastDataRowForXml + 1) : '';
    var conditionalForXml = stripeDxfForXml >= 0
      ? '<conditionalFormatting sqref="A2:' + lastColumnNameForXml + (lastDataRowForXml + 1) + '"><cfRule type="expression" dxfId="' + stripeDxfForXml + '" priority="1"><formula>MOD(ROW(),2)=1</formula></cfRule></conditionalFormatting>'
      : '';
    var totalWidthForXml = widthsForXml.reduce(function (sumForWidth, widthForSum) { return sumForWidth + widthForSum; }, 0);
    var orientationForXml = explicitOrientationForXml || (totalWidthForXml > 100 ? 'landscape' : 'portrait');
    var paperForXml = pageForXml && pageForXml.size === 'a4' ? 9 : (pageForXml && pageForXml.size === 'legal' ? 5 : 1);
    return {
      filterRef: filterRefForXml,
      printTitles: headerForXml,
      xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="' + XLSX_MAIN_NS_FOR_DOCUMENT_GENERATION + '" xmlns:r="' + XLSX_REL_NS_FOR_DOCUMENT_GENERATION + '">'
        + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
        + '<dimension ref="' + dimensionForXml + '"/>'
        + '<sheetViews><sheetView workbookViewId="0"' + (sheetIndexForXml === 0 ? ' tabSelected="1"' : '') + '>' + paneForXml + '</sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + '<cols>' + colsForXml + '</cols>'
        + '<sheetData>' + rowsXmlForXml.join('') + '</sheetData>'
        + (filterRefForXml ? '<autoFilter ref="' + filterRefForXml + '"/>' : '')
        + conditionalForXml
        + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
        + '<pageSetup paperSize="' + paperForXml + '" orientation="' + orientationForXml + '" fitToWidth="1" fitToHeight="0"/>'
        + '<headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter>'
        + '</worksheet>'
    };
  }

  function buildXlsxForDocumentGeneration(inputForDocumentGeneration, contextForXlsx) {
    var JSZipForXlsx = globalScopeForDocumentGeneration.JSZip;
    if (typeof JSZipForXlsx !== 'function') throw new Error('XLSX generator is unavailable.');
    var safeContextForXlsx = contextForXlsx || { warnings: [] };
    var workbookForXlsx = prepareXlsxWorkbookForDocumentGeneration(inputForDocumentGeneration, safeContextForXlsx.warnings);
    if (!workbookForXlsx.sheets.length) throw new Error('XLSX creation requires sheets or content.');
    var themeForXlsx = safeContextForXlsx.theme;
    var stylesForXlsx = makeXlsxStylesForDocumentGeneration(
      themeForXlsx ? themeForXlsx.fonts.body.office : 'Calibri',
      themeForXlsx ? themeForXlsx.colors.text : '000000'
    );
    var tableLookForXlsx = xlsxTableLookForDocumentGeneration(themeForXlsx);
    var sharedListForXlsx = [];
    var sharedIndexForXlsx = Object.create(null);
    var sharedCountForXlsx = 0;
    function shared(textForShared) {
      sharedCountForXlsx++;
      var keyForShared = String(textForShared);
      if (sharedIndexForXlsx[keyForShared] == null) {
        sharedIndexForXlsx[keyForShared] = sharedListForXlsx.length;
        sharedListForXlsx.push(keyForShared);
      }
      return sharedIndexForXlsx[keyForShared];
    }
    var explicitOrientationForXlsx = inputForDocumentGeneration.page && typeof inputForDocumentGeneration.page === 'object'
      && /^(landscape|portrait)$/i.test(String(inputForDocumentGeneration.page.orientation || ''))
      ? String(inputForDocumentGeneration.page.orientation).toLowerCase() : '';
    var sheetPartsForXlsx = workbookForXlsx.sheets.map(function (sheetForPart, indexForPart) {
      return xlsxSheetXmlForDocumentGeneration(sheetForPart, indexForPart, stylesForXlsx, shared, tableLookForXlsx, safeContextForXlsx.page, explicitOrientationForXlsx);
    });

    var definedNamesForXlsx = [];
    workbookForXlsx.sheets.forEach(function (sheetForNames, indexForNames) {
      var partForNames = sheetPartsForXlsx[indexForNames];
      var quotedForNames = xlsxQuotedSheetForDocumentGeneration(sheetForNames.name);
      if (partForNames.filterRef) {
        var boundsForNames = partForNames.filterRef.split(':').map(function (refForBound) { return refForBound.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'); });
        definedNamesForXlsx.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + indexForNames + '" hidden="1">' + xlsxEscapeForDocumentGeneration(quotedForNames + '!' + boundsForNames.join(':')) + '</definedName>');
      }
      if (partForNames.printTitles) {
        definedNamesForXlsx.push('<definedName name="_xlnm.Print_Titles" localSheetId="' + indexForNames + '">' + xlsxEscapeForDocumentGeneration(quotedForNames + '!$1:$1') + '</definedName>');
      }
    });
    var zipForXlsx = new JSZipForXlsx();
    zipForXlsx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + workbookForXlsx.sheets.map(function (sheetForType, indexForType) {
        return '<Override PartName="/xl/worksheets/sheet' + (indexForType + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>');
    zipForXlsx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>');
    var titleForXlsx = typeof inputForDocumentGeneration.title === 'string' ? inputForDocumentGeneration.title.trim().slice(0, 200) : '';
    zipForXlsx.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + (titleForXlsx ? '<dc:title>' + xlsxEscapeForDocumentGeneration(titleForXlsx) + '</dc:title>' : '')
      + '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created>'
      + '</cp:coreProperties>');
    zipForXlsx.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="' + XLSX_MAIN_NS_FOR_DOCUMENT_GENERATION + '" xmlns:r="' + XLSX_REL_NS_FOR_DOCUMENT_GENERATION + '">'
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + '<sheets>' + workbookForXlsx.sheets.map(function (sheetForBook, indexForBook) {
        return '<sheet name="' + xlsxEscapeForDocumentGeneration(sheetForBook.name) + '" sheetId="' + (indexForBook + 1) + '" r:id="rId' + (indexForBook + 1) + '"/>';
      }).join('') + '</sheets>'
      + (definedNamesForXlsx.length ? '<definedNames>' + definedNamesForXlsx.join('') + '</definedNames>' : '')
      + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
      + '</workbook>');
    var sheetCountForXlsx = workbookForXlsx.sheets.length;
    zipForXlsx.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + workbookForXlsx.sheets.map(function (sheetForRel, indexForRel) {
        return '<Relationship Id="rId' + (indexForRel + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (indexForRel + 1) + '.xml"/>';
      }).join('')
      + '<Relationship Id="rId' + (sheetCountForXlsx + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rId' + (sheetCountForXlsx + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
      + '</Relationships>');
    sheetPartsForXlsx.forEach(function (partForZip, indexForZip) {
      zipForXlsx.file('xl/worksheets/sheet' + (indexForZip + 1) + '.xml', partForZip.xml);
    });
    zipForXlsx.file('xl/styles.xml', stylesForXlsx.xml());
    zipForXlsx.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<sst xmlns="' + XLSX_MAIN_NS_FOR_DOCUMENT_GENERATION + '" count="' + sharedCountForXlsx + '" uniqueCount="' + sharedListForXlsx.length + '">'
      + sharedListForXlsx.map(function (textForSst) {
        var preserveForSst = /^\s|\s$|\n/.test(textForSst) ? ' xml:space="preserve"' : '';
        return '<si><t' + preserveForSst + '>' + xlsxEscapeForDocumentGeneration(textForSst) + '</t></si>';
      }).join('')
      + '</sst>');
    return zipForXlsx.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }).then(function (bytesForXlsx) {
      return {
        mimeType: XLSX_MIME_FOR_DOCUMENT_GENERATION,
        dataUrl: uint8ToDataUrlForDocumentGeneration(bytesForXlsx, XLSX_MIME_FOR_DOCUMENT_GENERATION),
        size: bytesForXlsx.length
      };
    });
  }

  function csvCellRunsAsFormulaForDocumentGeneration(textForGuard) {
    var firstForGuard = textForGuard.charAt(0);
    if (firstForGuard === '=') return true;
    if (firstForGuard === '@') return /^@\s*[A-Za-z_][\w.]*\s*\(/.test(textForGuard) || /[(!|"]/.test(textForGuard);
    if (firstForGuard === '+' || firstForGuard === '-') {
      if (isFinite(Number(textForGuard.replace(/,/g, '').replace(/%$/, '')))) return false;
      return /[A-Za-z(!|"]/.test(textForGuard);
    }
    return false;
  }

  function csvEscapeCellForDocumentGeneration(valueForDocumentGeneration) {
    var textForDocumentGeneration = String(valueForDocumentGeneration == null ? '' : valueForDocumentGeneration);
    if (/[",\r\n]/.test(textForDocumentGeneration)) {
      return '"' + textForDocumentGeneration.replace(/"/g, '""') + '"';
    }
    return textForDocumentGeneration;
  }

  // A CSV holds values only, so a cell object gives its v, and a formula gives the result
  // agent/xlsxFormulas.js works out for it (empty when it cannot). Formulas are never written as
  // "=..." text, which a spreadsheet would run on opening.
  function csvValuesFromSheetRowsForDocumentGeneration(rowsForCsv, warningsForCsv, cutsForCsv) {
    if (Array.isArray(rowsForCsv) && rowsForCsv.length > MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION) {
      cutsForCsv.rows = rowsForCsv.length;
    }
    var rowsInForCsv = Array.isArray(rowsForCsv) ? rowsForCsv.slice(0, MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION) : [];
    var hasFormulaForCsv = rowsInForCsv.some(function (rowForCsv) {
      return Array.isArray(rowForCsv) && rowForCsv.some(function (cellForCsv) { return cellForCsv && typeof cellForCsv === 'object' && typeof cellForCsv.f === 'string'; });
    });
    var formulasForCsv = agentNamespaceForDocumentGeneration.xlsxFormulas;
    var resultsForCsv = {};
    if (hasFormulaForCsv && formulasForCsv) {
      var evaluatorRowsForCsv = rowsInForCsv.map(function (rowForCsv) {
        return (Array.isArray(rowForCsv) ? rowForCsv : [rowForCsv]).slice(0, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION).map(function (cellForCsv) {
          if (cellForCsv && typeof cellForCsv === 'object' && typeof cellForCsv.f === 'string') {
            var preparedForCsv = formulasForCsv.prepare(cellForCsv.f);
            return preparedForCsv.ok ? { formula: preparedForCsv.stored } : { value: null };
          }
          var plainForCsv = cellForCsv && typeof cellForCsv === 'object' ? cellForCsv.v : cellForCsv;
          return { value: plainForCsv === '' || plainForCsv == null ? null : plainForCsv };
        });
      });
      resultsForCsv = formulasForCsv.evaluateWorkbook([{ name: 'Sheet1', rows: evaluatorRowsForCsv }]).results[0] || {};
      var errorsForCsv = Object.keys(resultsForCsv).filter(function (keyForError) { return resultsForCsv[keyForError].error; });
      if (errorsForCsv.length) {
        warningsForCsv.push('These formulas give an error, so their cells are empty: ' + errorsForCsv.slice(0, 8).map(function (keyForError) {
          var partsForError = keyForError.split(',');
          return formulasForCsv.cellName(Number(partsForError[0]), Number(partsForError[1])) + ' (' + resultsForCsv[keyForError].error + ')';
        }).join(', ') + '.');
      }
    }
    return normalizeRowsForDocumentGeneration(rowsInForCsv.map(function (rowForCsv, rowIndexForCsv) {
      return (Array.isArray(rowForCsv) ? rowForCsv : [rowForCsv]).map(function (cellForCsv, columnIndexForCsv) {
        if (!cellForCsv || typeof cellForCsv !== 'object' || Array.isArray(cellForCsv)) return cellForCsv;
        if (typeof cellForCsv.f === 'string') {
          var resultForCsv = resultsForCsv[rowIndexForCsv + ',' + columnIndexForCsv];
          return resultForCsv && resultForCsv.value != null && !resultForCsv.error ? resultForCsv.value : '';
        }
        return cellForCsv.v;
      });
    }), MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION, cutsForCsv);
  }

  function buildCsvForDocumentGeneration(inputForDocumentGeneration, contextForCsv) {
    var warningsForCsvBuild = (contextForCsv && contextForCsv.warnings) || [];
    var rowsForDocumentGeneration = [];
    var cutsForCsvBuild = { rows: 0, columns: 0, cells: 0 };
    var sheetsForCsvBuild = Array.isArray(inputForDocumentGeneration.sheets) ? inputForDocumentGeneration.sheets : [];
    if (sheetsForCsvBuild.length > 0) {
      rowsForDocumentGeneration = csvValuesFromSheetRowsForDocumentGeneration(sheetsForCsvBuild[0] && sheetsForCsvBuild[0].rows, warningsForCsvBuild, cutsForCsvBuild);
      if (sheetsForCsvBuild.length > 1) {
        warningsForCsvBuild.push('A CSV holds one table, so only the first of ' + sheetsForCsvBuild.length + ' sheets was written. Make an XLSX to keep every sheet.');
      }
    } else if (Array.isArray(inputForDocumentGeneration.rows)) {
      rowsForDocumentGeneration = csvValuesFromSheetRowsForDocumentGeneration(inputForDocumentGeneration.rows, warningsForCsvBuild, cutsForCsvBuild);
    } else if (typeof inputForDocumentGeneration.content === 'string' && inputForDocumentGeneration.content.trim()) {
      rowsForDocumentGeneration = normalizeRowsForDocumentGeneration(rowsFromContentForDocumentGeneration(inputForDocumentGeneration.content), MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION, cutsForCsvBuild);
    }
    if (rowsForDocumentGeneration.length === 0) {
      throw new Error('CSV creation requires rows, sheets, or content.');
    }
    if (cutsForCsvBuild.rows) {
      warningsForCsvBuild.push('The CSV keeps the first ' + MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + ' of ' + cutsForCsvBuild.rows.toLocaleString('en-US') + ' rows. Split the data across files.');
    }
    if (cutsForCsvBuild.columns) {
      warningsForCsvBuild.push('The CSV keeps the first ' + MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION + ' columns; the widest row had ' + cutsForCsvBuild.columns + '. Split the data across files.');
    }
    if (cutsForCsvBuild.cells) {
      warningsForCsvBuild.push(cutsForCsvBuild.cells + ' cell' + (cutsForCsvBuild.cells === 1 ? ' was' : 's were') + ' cut to ' + MAX_CELL_CHARS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + ' characters.');
    }
    // Excel runs a CSV cell as a formula when it starts with "=" or "@", or with "+" or "-"
    // followed by a name or a call ("+A1", "-2+3+cmd|' /C calc'!A0", "+HYPERLINK(...)"). Such a
    // cell gets a leading apostrophe, so it opens as text. Checked in Excel: a phone number
    // ("+234 803 ..."), a lone "-", "@x" and numbers open as they are, so they are left alone.
    var guardedForCsv = 0;
    var csvTextForDocumentGeneration = rowsForDocumentGeneration.map(function (rowForDocumentGeneration) {
      return rowForDocumentGeneration.map(function (cellForGuard) {
        if (typeof cellForGuard === 'string' && csvCellRunsAsFormulaForDocumentGeneration(cellForGuard)) {
          guardedForCsv++;
          return csvEscapeCellForDocumentGeneration("'" + cellForGuard);
        }
        return csvEscapeCellForDocumentGeneration(cellForGuard);
      }).join(',');
    }).join('\r\n') + '\r\n';
    if (guardedForCsv) {
      warningsForCsvBuild.push(guardedForCsv + ' cell' + (guardedForCsv === 1 ? '' : 's') + ' starting with =, @, + or - would run as a formula when the CSV is opened, so ' + (guardedForCsv === 1 ? 'it starts' : 'they start') + " with an apostrophe (').");
    }
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
          var runForInline = {
            text: textForInline,
            bold: flagsForDocumentGeneration.bold,
            italic: flagsForDocumentGeneration.italic,
            href: flagsForDocumentGeneration.href,
            sizePt: flagsForDocumentGeneration.sizePt,
            font: flagsForDocumentGeneration.font
          };
          if (flagsForDocumentGeneration.color) runForInline.color = flagsForDocumentGeneration.color;
          if (flagsForDocumentGeneration.highlight) runForInline.highlight = flagsForDocumentGeneration.highlight;
          if (flagsForDocumentGeneration.mono) runForInline.mono = true;
          runsForDocumentGeneration.push(runForInline);
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
        font: flagsForDocumentGeneration.font,
        color: flagsForDocumentGeneration.color,
        highlight: flagsForDocumentGeneration.highlight,
        mono: flagsForDocumentGeneration.mono
      };
      var inlineStyleForInline = elementStyleForDocumentGeneration(childForInline);
      if (inlineStyleForInline.color) {
        var inlineColorForInline = parseCssColorForDocumentGeneration(inlineStyleForInline.color);
        if (inlineColorForInline) nextFlagsForInline.color = inlineColorForInline;
      }
      var inlineBackgroundForInline = inlineStyleForInline['background-color'] || inlineStyleForInline.background;
      if (inlineBackgroundForInline) {
        var inlineHighlightForInline = parseCssColorForDocumentGeneration(inlineBackgroundForInline);
        if (inlineHighlightForInline) nextFlagsForInline.highlight = inlineHighlightForInline;
      }
      if (inlineStyleForInline['font-weight'] && /^(bold|bolder|[6-9]00)$/.test(String(inlineStyleForInline['font-weight']).trim())) nextFlagsForInline.bold = true;
      if (inlineStyleForInline['font-style'] && /italic|oblique/.test(String(inlineStyleForInline['font-style']))) nextFlagsForInline.italic = true;
      if (tagForInline === 'mark' && !nextFlagsForInline.highlight) nextFlagsForInline.highlight = 'FFF3A3';
      if (tagForInline === 'code' || tagForInline === 'kbd' || tagForInline === 'samp') nextFlagsForInline.mono = true;
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
      font: safeBaseFlagsForInline.font || '',
      color: safeBaseFlagsForInline.color || '',
      highlight: safeBaseFlagsForInline.highlight || '',
      mono: !!safeBaseFlagsForInline.mono
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
    var tagForBlockFlags = String((elementForDocumentGeneration && elementForDocumentGeneration.tagName) || '').toLowerCase();
    return {
      sizePt: parseFontSizePtForDocumentGeneration(declarationsForBlock['font-size']),
      font: parseFontFamilyForDocumentGeneration(declarationsForBlock['font-family']),
      color: parseCssColorForDocumentGeneration(declarationsForBlock.color),
      mono: tagForBlockFlags === 'pre'
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
      font: safeOverrideForMerge.font || safeBaseForMerge.font || '',
      color: safeOverrideForMerge.color || safeBaseForMerge.color || '',
      mono: !!(safeOverrideForMerge.mono || safeBaseForMerge.mono)
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

  function htmlTextAlignForDocumentGeneration(valueForAlign) {
    var alignTextForAlign = String(valueForAlign || '').trim().toLowerCase();
    if (alignTextForAlign === 'center' || alignTextForAlign === 'right' || alignTextForAlign === 'justify' || alignTextForAlign === 'left') return alignTextForAlign;
    if (alignTextForAlign === 'end') return 'right';
    return '';
  }

  // A column width from html ("30%", "120px", "2in", "40") as a relative weight. Only the
  // proportions matter, because the table is always fitted to the text width.
  function htmlWidthWeightForDocumentGeneration(valueForWidth) {
    var widthTextForWidth = String(valueForWidth == null ? '' : valueForWidth).trim().toLowerCase();
    if (!widthTextForWidth) return 0;
    if (/%$/.test(widthTextForWidth)) return parseFloat(widthTextForWidth) || 0;
    if (/^\d+(\.\d+)?$/.test(widthTextForWidth)) return parseFloat(widthTextForWidth) * 0.75;
    return parseLengthPtForDocumentGeneration(widthTextForWidth) || 0;
  }

  // An html list in document order. Each li is one entry, followed by the entries of the lists
  // nested in it, so a sub-list stays under the item it belongs to. key names the ul or ol an
  // entry came from: a renderer numbers each list element on its own, so a parent list keeps
  // counting after its sub-list and every sub-list starts again at 1. Levels stop at 2, the
  // deepest Word list level. An li holding only a nested list has no entry of its own.
  // It reads only tagName and children, and runsForItem(li, ownerList) supplies the text.
  function listEntriesFromHtmlListForDocumentGeneration(listElForEntries, runsForItemForEntries) {
    var entriesForEntries = [];
    var nextKeyForEntries = 0;
    function tagOfForEntries(elForTag) {
      return String((elForTag && elForTag.tagName) || '').toLowerCase();
    }
    function walkListForEntries(listElForWalk, depthForWalk) {
      var keyForWalk = nextKeyForEntries++;
      var orderedForWalk = tagOfForEntries(listElForWalk) === 'ol';
      var childrenForWalk = listElForWalk.children || [];
      for (var indexForWalk = 0; indexForWalk < childrenForWalk.length; indexForWalk++) {
        var liForWalk = childrenForWalk[indexForWalk];
        if (tagOfForEntries(liForWalk) !== 'li') continue;
        var nestedForWalk = [];
        var liChildrenForWalk = liForWalk.children || [];
        for (var childIndexForWalk = 0; childIndexForWalk < liChildrenForWalk.length; childIndexForWalk++) {
          var childTagForWalk = tagOfForEntries(liChildrenForWalk[childIndexForWalk]);
          if (childTagForWalk === 'ul' || childTagForWalk === 'ol') nestedForWalk.push(liChildrenForWalk[childIndexForWalk]);
        }
        var runsForWalk = runsForItemForEntries(liForWalk, listElForWalk) || [];
        var hasTextForWalk = runsForWalk.some(function (runForWalk) { return runForWalk && String(runForWalk.text || '').trim(); });
        if (hasTextForWalk || !nestedForWalk.length) {
          entriesForEntries.push({ runs: runsForWalk, level: Math.min(2, depthForWalk), ordered: orderedForWalk, key: keyForWalk });
        }
        for (var nestedIndexForWalk = 0; nestedIndexForWalk < nestedForWalk.length; nestedIndexForWalk++) {
          walkListForEntries(nestedForWalk[nestedIndexForWalk], depthForWalk + 1);
        }
      }
    }
    walkListForEntries(listElForEntries, 0);
    return entriesForEntries;
  }

  function htmlToBlocksForDocumentGeneration(htmlStringForDocumentGeneration, imageResolverForDocumentGeneration, dropTrackerForDocumentGeneration) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('HTML input requires a DOM environment and is only supported for docx and pdf.');
    }
    var rawHtmlForDocumentGeneration = String(htmlStringForDocumentGeneration || '');
    // What the parse left out, for the result's warnings: the html's length when it was cut, and
    // whether content was left after the block limit was reached.
    var cutForDocumentGeneration = { htmlChars: 0, blocks: false };
    if (rawHtmlForDocumentGeneration.length > MAX_HTML_INPUT_CHARS_FOR_DOCUMENT_GENERATION) {
      cutForDocumentGeneration.htmlChars = rawHtmlForDocumentGeneration.length;
      rawHtmlForDocumentGeneration = rawHtmlForDocumentGeneration.slice(0, MAX_HTML_INPUT_CHARS_FOR_DOCUMENT_GENERATION);
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
      var srcForImg = String((imgElForDocumentGeneration.getAttribute && imgElForDocumentGeneration.getAttribute('src')) || '');
      var sentinelMatchForImg = srcForImg.match(IMAGE_SENTINEL_RE_FOR_DOCUMENT_GENERATION);
      if (!sentinelMatchForImg) return;
      if (blocksForDocumentGeneration.length >= MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) {
        cutForDocumentGeneration.blocks = true;
        return;
      }
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

    function handleListForDocumentGeneration(listElForDocumentGeneration, orderedForDocumentGeneration) {
      var entriesForHtmlList = listEntriesFromHtmlListForDocumentGeneration(listElForDocumentGeneration, function (liForRuns, ownerListForRuns) {
        return htmlInlineRunsForDocumentGeneration(
          liForRuns,
          mergeRunFlagsForDocumentGeneration(blockRunFlagsForDocumentGeneration(ownerListForRuns), blockRunFlagsForDocumentGeneration(liForRuns))
        );
      });
      if (entriesForHtmlList.length) {
        blocksForDocumentGeneration.push({ type: 'list', ordered: orderedForDocumentGeneration, items: entriesForHtmlList });
      }
    }

    function handleTableForDocumentGeneration(tableElForDocumentGeneration) {
      var rowsForDocumentGeneration = [];
      var hasHeaderForDocumentGeneration = false;
      // querySelectorAll('tr') also matches rows of a table nested inside a cell, which would
      // hoist those rows into this table. Keep only rows whose nearest table ancestor is this
      // one; a nested table is then left in its cell and flattened to text by the cell walker.
      var columnWeightsForTable = [];
      var colElementsForTable = tableElForDocumentGeneration.querySelectorAll('col');
      for (var colElIndexForTable = 0; colElIndexForTable < colElementsForTable.length; colElIndexForTable++) {
        var colElForTable = colElementsForTable[colElIndexForTable];
        if (colElForTable.closest && colElForTable.closest('table') !== tableElForDocumentGeneration) continue;
        var colSpanForColEl = Math.max(1, parseInt(colElForTable.getAttribute('span'), 10) || 1);
        var colWeightForColEl = htmlWidthWeightForDocumentGeneration(elementStyleForDocumentGeneration(colElForTable).width || colElForTable.getAttribute('width'));
        for (var colRepeatForTable = 0; colRepeatForTable < colSpanForColEl; colRepeatForTable++) columnWeightsForTable.push(colWeightForColEl);
      }
      var firstRowWeightsForTable = [];
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
          var cellStyleForDocumentGeneration = elementStyleForDocumentGeneration(cellForDocumentGeneration);
          var cellColSpanForDocumentGeneration = (Number.isFinite(colSpanAttrForDocumentGeneration) && colSpanAttrForDocumentGeneration > 1) ? colSpanAttrForDocumentGeneration : 1;
          if (trIndexForDocumentGeneration === 0 && !columnWeightsForTable.length) {
            var cellWidthForDocumentGeneration = htmlWidthWeightForDocumentGeneration(
              cellStyleForDocumentGeneration.width || cellForDocumentGeneration.getAttribute('width'));
            for (var spanWeightForTable = 0; spanWeightForTable < cellColSpanForDocumentGeneration; spanWeightForTable++) {
              firstRowWeightsForTable.push(cellWidthForDocumentGeneration ? cellWidthForDocumentGeneration / cellColSpanForDocumentGeneration : 0);
            }
          }
          cellsForDocumentGeneration.push({
            paragraphs: cellParagraphsFromElementForDocumentGeneration(cellForDocumentGeneration),
            header: isHeaderCellForDocumentGeneration,
            colSpan: cellColSpanForDocumentGeneration,
            rowSpan: (Number.isFinite(rowSpanAttrForDocumentGeneration) && rowSpanAttrForDocumentGeneration > 1) ? rowSpanAttrForDocumentGeneration : 1,
            fill: parseCssColorForDocumentGeneration(cellStyleForDocumentGeneration['background-color'] || cellStyleForDocumentGeneration.background || cellForDocumentGeneration.getAttribute('bgcolor')),
            color: parseCssColorForDocumentGeneration(cellStyleForDocumentGeneration.color),
            align: htmlTextAlignForDocumentGeneration(cellStyleForDocumentGeneration['text-align'] || cellForDocumentGeneration.getAttribute('align'))
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
        var captionElForTable = null;
        for (var captionIndexForTable = 0; captionIndexForTable < (tableElForDocumentGeneration.children || []).length; captionIndexForTable++) {
          if (String(tableElForDocumentGeneration.children[captionIndexForTable].tagName || '').toLowerCase() === 'caption') {
            captionElForTable = tableElForDocumentGeneration.children[captionIndexForTable];
            break;
          }
        }
        var weightsForTableBlock = columnWeightsForTable.length ? columnWeightsForTable : firstRowWeightsForTable;
        var tableBlockForDocumentGeneration = {
          type: 'table',
          rows: rowsForDocumentGeneration,
          header: hasHeaderForDocumentGeneration,
          bordered: borderedForTableBlock,
          borderSpec: borderSpecForTableBlock || null
        };
        if (weightsForTableBlock.length && weightsForTableBlock.every(function (weightForEvery) { return weightForEvery > 0; })) {
          tableBlockForDocumentGeneration.columns = weightsForTableBlock;
        }
        if (captionElForTable) {
          var captionTextForTable = String(captionElForTable.textContent || '').replace(/\s+/g, ' ').trim();
          if (captionTextForTable) tableBlockForDocumentGeneration.caption = captionTextForTable;
        }
        blocksForDocumentGeneration.push(tableBlockForDocumentGeneration);
      }
    }

    function walkBlockForDocumentGeneration(containerForDocumentGeneration) {
      var childNodesForDocumentGeneration = containerForDocumentGeneration.childNodes || [];
      for (var nodeIndexForDocumentGeneration = 0; nodeIndexForDocumentGeneration < childNodesForDocumentGeneration.length; nodeIndexForDocumentGeneration++) {
        if (blocksForDocumentGeneration.length >= MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) {
          if (htmlNodesHaveContentFromForDocumentGeneration(childNodesForDocumentGeneration, nodeIndexForDocumentGeneration)) {
            cutForDocumentGeneration.blocks = true;
          }
          break;
        }
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
        var nodeStyleForDocumentGeneration = elementStyleForDocumentGeneration(nodeForDocumentGeneration);
        var classesForDocumentGeneration = ' ' + String(nodeForDocumentGeneration.getAttribute('class') || '').toLowerCase() + ' ';
        var alignForBlockElement = htmlTextAlignForDocumentGeneration(nodeStyleForDocumentGeneration['text-align']);
        if (/always|page/.test(String(nodeStyleForDocumentGeneration['page-break-before'] || nodeStyleForDocumentGeneration['break-before'] || ''))) {
          blocksForDocumentGeneration.push({ type: 'page_break' });
        }
        if (classesForDocumentGeneration.indexOf(' page-break ') !== -1) {
          blocksForDocumentGeneration.push({ type: 'page_break' });
          continue;
        }
        if (classesForDocumentGeneration.indexOf(' callout ') !== -1) {
          var calloutBlockForHtml = {
            type: 'callout',
            tone: String(nodeForDocumentGeneration.getAttribute('data-tone') || 'info').toLowerCase(),
            paragraphs: tagForDocumentGeneration === 'p'
              ? [htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration)]
              : cellParagraphsFromElementForDocumentGeneration(nodeForDocumentGeneration)
          };
          var calloutTitleForHtml = String(nodeForDocumentGeneration.getAttribute('data-title') || '').trim();
          if (calloutTitleForHtml) calloutBlockForHtml.title = calloutTitleForHtml;
          blocksForDocumentGeneration.push(calloutBlockForHtml);
        } else if (classesForDocumentGeneration.indexOf(' title ') !== -1 && (/^h[1-6]$/.test(tagForDocumentGeneration) || tagForDocumentGeneration === 'p')) {
          blocksForDocumentGeneration.push({ type: 'title', runs: htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration), align: alignForBlockElement });
        } else if (classesForDocumentGeneration.indexOf(' subtitle ') !== -1 && (/^h[1-6]$/.test(tagForDocumentGeneration) || tagForDocumentGeneration === 'p')) {
          blocksForDocumentGeneration.push({ type: 'subtitle', runs: htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration), align: alignForBlockElement });
        } else if (/^h[1-6]$/.test(tagForDocumentGeneration)) {
          blocksForDocumentGeneration.push({ type: 'heading', level: Number(tagForDocumentGeneration.charAt(1)), runs: htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration), align: alignForBlockElement });
        } else if (tagForDocumentGeneration === 'hr') {
          blocksForDocumentGeneration.push({ type: 'divider' });
        } else if (tagForDocumentGeneration === 'p' || tagForDocumentGeneration === 'blockquote' || tagForDocumentGeneration === 'pre') {
          var paragraphRunsForDocumentGeneration = htmlInlineRunsForDocumentGeneration(nodeForDocumentGeneration);
          if (paragraphRunsForDocumentGeneration.length) {
            blocksForDocumentGeneration.push({
              type: tagForDocumentGeneration === 'blockquote' ? 'quote' : 'paragraph',
              runs: paragraphRunsForDocumentGeneration,
              align: alignForBlockElement
            });
          }
          emitImageBlocksFromContainerForDocumentGeneration(nodeForDocumentGeneration);
        } else if (tagForDocumentGeneration === 'ul' || tagForDocumentGeneration === 'ol') {
          handleListForDocumentGeneration(nodeForDocumentGeneration, tagForDocumentGeneration === 'ol');
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
    if (blocksForDocumentGeneration.length > MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) cutForDocumentGeneration.blocks = true;
    return {
      blocks: blocksForDocumentGeneration.slice(0, MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION),
      docDefaults: docDefaultsForDocumentGeneration,
      cut: cutForDocumentGeneration
    };
  }

  // Whether any node from startIndex on would have become part of the document: text that is not
  // only whitespace, or an image or rule. Lets the block limit be reported only when something
  // was really left out, not when the html merely ends in blank lines.
  function htmlNodesHaveContentFromForDocumentGeneration(nodesForContent, startIndexForContent) {
    for (var indexForContent = startIndexForContent; indexForContent < nodesForContent.length; indexForContent++) {
      var nodeForContent = nodesForContent[indexForContent];
      if (nodeForContent.nodeType === 3) {
        if (String(nodeForContent.nodeValue || '').trim()) return true;
        continue;
      }
      if (nodeForContent.nodeType !== 1) continue;
      var tagForContent = String(nodeForContent.tagName || '').toLowerCase();
      if (tagForContent === 'script' || tagForContent === 'style' || tagForContent === 'head' || tagForContent === 'nav') continue;
      if (tagForContent === 'img' || tagForContent === 'hr') return true;
      if (String(nodeForContent.textContent || '').trim()) return true;
      if (nodeForContent.getElementsByTagName && (nodeForContent.getElementsByTagName('img').length || nodeForContent.getElementsByTagName('hr').length)) return true;
    }
    return false;
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
      // levelForRestart is the level the list starts at; a numbered list restarts there at 1.
      allocNumbering: function (orderedForDocumentGeneration, levelForRestart) {
        var numIdForDocumentGeneration = numberingForDocumentGeneration.length + 1;
        numberingForDocumentGeneration.push({
          numId: numIdForDocumentGeneration,
          abstractId: orderedForDocumentGeneration ? 1 : 0,
          restartLevel: Math.max(0, Math.min(2, Number(levelForRestart) || 0))
        });
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

  function buildDocxNumberingXmlForDocumentGeneration(numberingEntriesForDocumentGeneration, themeForNumbering) {
    var bulletGlyphsForDocumentGeneration = ['•', '◦', '▪'];
    var orderedFormatsForDocumentGeneration = ['decimal', 'lowerLetter', 'lowerRoman'];
    var abstractBulletForDocumentGeneration = '<w:abstractNum w:abstractNumId="0">';
    var abstractOrderedForDocumentGeneration = '<w:abstractNum w:abstractNumId="1">';
    // A themed document colours its bullet glyphs with the accent; numbers keep the text colour.
    var bulletRunPropsForNumbering = themeForNumbering
      ? '<w:rPr><w:color w:val="' + (themeForNumbering.colors.accentText || themeForNumbering.colors.accent) + '"/></w:rPr>'
      : '';
    for (var levelForNumbering = 0; levelForNumbering < 3; levelForNumbering++) {
      var indentForNumbering = 720 * (levelForNumbering + 1);
      abstractBulletForDocumentGeneration += '<w:lvl w:ilvl="' + levelForNumbering + '"><w:numFmt w:val="bullet"/><w:lvlText w:val="' + bulletGlyphsForDocumentGeneration[levelForNumbering] + '"/><w:pPr><w:ind w:left="' + indentForNumbering + '" w:hanging="360"/></w:pPr>' + bulletRunPropsForNumbering + '</w:lvl>';
      abstractOrderedForDocumentGeneration += '<w:lvl w:ilvl="' + levelForNumbering + '"><w:start w:val="1"/><w:numFmt w:val="' + orderedFormatsForDocumentGeneration[levelForNumbering] + '"/><w:lvlText w:val="%' + (levelForNumbering + 1) + '."/><w:pPr><w:ind w:left="' + indentForNumbering + '" w:hanging="360"/></w:pPr></w:lvl>';
    }
    abstractBulletForDocumentGeneration += '</w:abstractNum>';
    abstractOrderedForDocumentGeneration += '</w:abstractNum>';
    // Word keeps counting across every w:num that shares an abstractNum, so without the override a
    // second numbered list in the document would start at 4 where the first stopped at 3.
    var numsXmlForDocumentGeneration = numberingEntriesForDocumentGeneration.map(function (entryForNumbering) {
      var restartXmlForNumbering = entryForNumbering.abstractId === 1
        ? '<w:lvlOverride w:ilvl="' + (entryForNumbering.restartLevel || 0) + '"><w:startOverride w:val="1"/></w:lvlOverride>'
        : '';
      return '<w:num w:numId="' + entryForNumbering.numId + '"><w:abstractNumId w:val="' + entryForNumbering.abstractId + '"/>' + restartXmlForNumbering + '</w:num>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      abstractBulletForDocumentGeneration + abstractOrderedForDocumentGeneration + numsXmlForDocumentGeneration +
      '</w:numbering>';
  }

  // Header and footer references must come first in w:sectPr, ahead of w:pgSz.
  function docxSectionPropertiesXmlForDocumentGeneration(docDefaultsForDocumentGeneration, partsForSection) {
    var defaultsForSection = docDefaultsForDocumentGeneration || {};
    var marginsForSection = defaultsForSection.margins || null;
    var safePartsForSection = partsForSection || {};
    function twipsForSection(pointsForSection, fallbackPointsForSection) {
      var resolvedPointsForSection = (pointsForSection > 0) ? pointsForSection : fallbackPointsForSection;
      return Math.round(resolvedPointsForSection * 20);
    }
    var pageWidthTwipsForSection = twipsForSection(defaultsForSection.pageWidthPt, DEFAULT_PAGE_WIDTH_PT_FOR_DOCUMENT_GENERATION);
    var pageHeightTwipsForSection = twipsForSection(defaultsForSection.pageHeightPt, DEFAULT_PAGE_HEIGHT_PT_FOR_DOCUMENT_GENERATION);
    var referencesForSection = '';
    if (safePartsForSection.headerRelId) referencesForSection += '<w:headerReference w:type="default" r:id="' + safePartsForSection.headerRelId + '"/>';
    if (safePartsForSection.footerRelId) referencesForSection += '<w:footerReference w:type="default" r:id="' + safePartsForSection.footerRelId + '"/>';
    var orientationForSection = pageWidthTwipsForSection > pageHeightTwipsForSection ? ' w:orient="landscape"' : '';
    return '<w:sectPr>' + referencesForSection + '<w:pgSz w:w="' + pageWidthTwipsForSection + '" w:h="' + pageHeightTwipsForSection + '"' + orientationForSection + '/>' +
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

  // styles.xml for a themed document. Every look the theme decides lives in a named style, so a
  // reader who opens the file in Word can restyle the whole document the usual way.
  function buildThemedDocxStylesXmlForDocumentGeneration(themeForStyles) {
    var colorsForStyles = themeForStyles.colors;
    var sizesForStyles = themeForStyles.sizes;
    var spacingForStyles = themeForStyles.spacing;
    function twipsForStyles(pointsForTwips) { return Math.round(pointsForTwips * 20); }
    function fontsXmlForStyles(fontNameForStyles) {
      var escapedForStyles = escapeXmlForDocumentGeneration(fontNameForStyles);
      return '<w:rFonts w:ascii="' + escapedForStyles + '" w:hAnsi="' + escapedForStyles + '" w:eastAsia="' + escapedForStyles + '" w:cs="' + escapedForStyles + '"/>';
    }
    function sizeXmlForStyles(pointsForSize) {
      var halfPointsForSize = Math.round(pointsForSize * 2);
      return '<w:sz w:val="' + halfPointsForSize + '"/><w:szCs w:val="' + halfPointsForSize + '"/>';
    }
    function paragraphStyleForStyles(idForStyle, nameForStyle, pPrForStyle, rPrForStyle, extraForStyle) {
      return '<w:style w:type="paragraph" w:styleId="' + idForStyle + '"><w:name w:val="' + nameForStyle + '"/>'
        + '<w:basedOn w:val="Normal"/>' + (extraForStyle || '') + '<w:qFormat/>'
        + (pPrForStyle ? '<w:pPr>' + pPrForStyle + '</w:pPr>' : '')
        + (rPrForStyle ? '<w:rPr>' + rPrForStyle + '</w:rPr>' : '')
        + '</w:style>';
    }
    var bodyFontForStyles = themeForStyles.fonts.body.office;
    var headingFontForStyles = themeForStyles.fonts.heading.office;
    var titleAlignForStyles = themeForStyles.title.align === 'center' ? '<w:jc w:val="center"/>' : '';
    var lineForStyles = Math.round(spacingForStyles.line * 240);

    var docDefaultsForStyles = '<w:docDefaults><w:rPrDefault><w:rPr>' + fontsXmlForStyles(bodyFontForStyles)
      + '<w:color w:val="' + colorsForStyles.text + '"/>' + sizeXmlForStyles(sizesForStyles.body) + '</w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:spacing w:after="' + twipsForStyles(spacingForStyles.after) + '" w:line="' + lineForStyles + '" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
      + '</w:docDefaults>';

    var stylesForStyles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>';
    stylesForStyles += paragraphStyleForStyles('Title', 'Title',
      '<w:keepNext/><w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/>' + titleAlignForStyles,
      fontsXmlForStyles(headingFontForStyles) + '<w:b/><w:color w:val="' + colorsForStyles.heading + '"/>' + sizeXmlForStyles(sizesForStyles.title),
      '<w:next w:val="Subtitle"/>');
    stylesForStyles += paragraphStyleForStyles('Subtitle', 'Subtitle',
      '<w:spacing w:before="0" w:after="' + twipsForStyles(18) + '"/>' + titleAlignForStyles,
      '<w:color w:val="' + colorsForStyles.muted + '"/>' + sizeXmlForStyles(sizesForStyles.subtitle),
      '<w:next w:val="Normal"/>');
    for (var levelForStyles = 1; levelForStyles <= 6; levelForStyles++) {
      var headingRuleForStyles = (themeForStyles.headingRule && levelForStyles === 1)
        ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="' + colorsForStyles.rule + '"/></w:pBdr>'
        : '';
      // The style name must be "heading N" for Word's navigation pane and table of contents, and
      // mammoth matches the Heading1-6 ids when the file is read back.
      stylesForStyles += paragraphStyleForStyles('Heading' + levelForStyles, 'heading ' + levelForStyles,
        '<w:keepNext/><w:keepLines/>' + headingRuleForStyles
          + '<w:spacing w:before="' + twipsForStyles(spacingForStyles.headingBefore[levelForStyles - 1]) + '" w:after="' + twipsForStyles(spacingForStyles.headingAfter[levelForStyles - 1]) + '"/>'
          + '<w:outlineLvl w:val="' + (levelForStyles - 1) + '"/>',
        fontsXmlForStyles(headingFontForStyles) + '<w:b/>' + (levelForStyles >= 4 ? '<w:i/>' : '')
          + '<w:color w:val="' + colorsForStyles.heading + '"/>' + sizeXmlForStyles(sizesForStyles.headings[levelForStyles - 1]),
        '<w:next w:val="Normal"/>');
    }
    stylesForStyles += paragraphStyleForStyles('Quote', 'Quote',
      '<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="' + colorsForStyles.rule + '"/></w:pBdr>'
        + '<w:spacing w:before="' + twipsForStyles(6) + '" w:after="' + twipsForStyles(10) + '"/><w:ind w:left="360" w:right="360"/>',
      '<w:i/><w:color w:val="' + colorsForStyles.muted + '"/>');
    stylesForStyles += paragraphStyleForStyles('Caption', 'caption',
      '<w:keepNext/><w:spacing w:before="' + twipsForStyles(8) + '" w:after="' + twipsForStyles(4) + '"/>',
      '<w:b/><w:color w:val="' + colorsForStyles.muted + '"/>' + sizeXmlForStyles(sizesForStyles.small));
    stylesForStyles += paragraphStyleForStyles('TableText', 'Table Text',
      '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>', '');
    stylesForStyles += paragraphStyleForStyles('ListParagraph', 'List Paragraph',
      '<w:spacing w:after="' + twipsForStyles(Math.min(4, spacingForStyles.after)) + '"/><w:contextualSpacing/>', '');
    stylesForStyles += paragraphStyleForStyles('Header', 'header',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="right"/>',
      '<w:color w:val="' + colorsForStyles.muted + '"/>' + sizeXmlForStyles(sizesForStyles.small));
    stylesForStyles += paragraphStyleForStyles('Footer', 'footer',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      '<w:color w:val="' + colorsForStyles.muted + '"/>' + sizeXmlForStyles(sizesForStyles.small));

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      docDefaultsForStyles + stylesForStyles +
      '</w:styles>';
  }

  // w:rPr children must appear in schema order (rFonts, b, i, color, sz, szCs, u), which is
  // why the properties are assembled here rather than appended by each caller in turn.
  function docxRunPropsXmlForDocumentGeneration(runForDocumentGeneration, baseOptionsForDocumentGeneration, isLinkForDocumentGeneration) {
    var safeRunForProps = runForDocumentGeneration || {};
    var safeBaseForProps = baseOptionsForDocumentGeneration || {};
    var fontForProps = safeRunForProps.font
      || (safeRunForProps.mono ? (safeBaseForProps.monoFont || 'Consolas') : '')
      || safeBaseForProps.font || '';
    var sizePtForProps = Number(safeRunForProps.sizePt) || Number(safeBaseForProps.sizePt) || 0;
    var propsInnerForProps = '';
    if (fontForProps) {
      var escapedFontForProps = escapeXmlForDocumentGeneration(fontForProps);
      propsInnerForProps += '<w:rFonts w:ascii="' + escapedFontForProps + '" w:hAnsi="' + escapedFontForProps
        + '" w:cs="' + escapedFontForProps + '"/>';
    }
    if (safeRunForProps.bold || safeBaseForProps.bold) propsInnerForProps += '<w:b/>';
    if (safeRunForProps.italic || safeBaseForProps.italic) propsInnerForProps += '<w:i/>';
    // A link keeps its link colour even inside a coloured paragraph, so it still reads as a link.
    var colorForProps = isLinkForDocumentGeneration
      ? (safeBaseForProps.linkColor || '0563C1')
      : (safeRunForProps.color || safeBaseForProps.color || '');
    if (colorForProps) propsInnerForProps += '<w:color w:val="' + colorForProps + '"/>';
    if (sizePtForProps) {
      var halfPointsForProps = Math.max(2, Math.min(MAX_FONT_SIZE_PT_FOR_DOCUMENT_GENERATION * 2, Math.round(sizePtForProps * 2)));
      propsInnerForProps += '<w:sz w:val="' + halfPointsForProps + '"/><w:szCs w:val="' + halfPointsForProps + '"/>';
    }
    if (isLinkForDocumentGeneration) propsInnerForProps += '<w:u w:val="single"/>';
    if (safeRunForProps.highlight) {
      propsInnerForProps += '<w:shd w:val="clear" w:color="auto" w:fill="' + safeRunForProps.highlight + '"/>';
    }
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
    // w:pPr children must appear in schema order: pStyle, keepNext, keepLines, pageBreakBefore,
    // numPr, pBdr, shd, spacing, ind, contextualSpacing, jc.
    if (optsForDocumentGeneration.headingLevel) {
      // Use a real Word heading style so the level survives the docx -> HTML -> docx
      // round-trip (mammoth maps Heading1-6 back to h1-h6). The bold/size/spacing live
      // in styles.xml; per-run bold/italic still emit normally via the runs below, and a
      // run carrying its own size overrides the style's, which is what an explicit
      // font-size read out of a source heading has to do.
      paragraphPropsInnerForDocumentGeneration += '<w:pStyle w:val="Heading' + optsForDocumentGeneration.headingLevel + '"/>';
    } else if (optsForDocumentGeneration.styleId) {
      paragraphPropsInnerForDocumentGeneration += '<w:pStyle w:val="' + optsForDocumentGeneration.styleId + '"/>';
    }
    if (optsForDocumentGeneration.keepNext) paragraphPropsInnerForDocumentGeneration += '<w:keepNext/>';
    if (optsForDocumentGeneration.keepLines) paragraphPropsInnerForDocumentGeneration += '<w:keepLines/>';
    if (optsForDocumentGeneration.pageBreakBefore) paragraphPropsInnerForDocumentGeneration += '<w:pageBreakBefore/>';
    if (optsForDocumentGeneration.numPr) {
      paragraphPropsInnerForDocumentGeneration += '<w:numPr><w:ilvl w:val="' + optsForDocumentGeneration.numPr.ilvl + '"/><w:numId w:val="' + optsForDocumentGeneration.numPr.numId + '"/></w:numPr>';
    }
    if (optsForDocumentGeneration.borderXml) {
      paragraphPropsInnerForDocumentGeneration += '<w:pBdr>' + optsForDocumentGeneration.borderXml + '</w:pBdr>';
    }
    if (optsForDocumentGeneration.fill) {
      paragraphPropsInnerForDocumentGeneration += '<w:shd w:val="clear" w:color="auto" w:fill="' + optsForDocumentGeneration.fill + '"/>';
    }
    var spacingForParagraph = optsForDocumentGeneration.spacing;
    if (spacingForParagraph) {
      var spacingAttrsForParagraph = '';
      if (spacingForParagraph.before != null) spacingAttrsForParagraph += ' w:before="' + Math.round(spacingForParagraph.before) + '"';
      if (spacingForParagraph.after != null) spacingAttrsForParagraph += ' w:after="' + Math.round(spacingForParagraph.after) + '"';
      if (spacingForParagraph.line != null) spacingAttrsForParagraph += ' w:line="' + Math.round(spacingForParagraph.line) + '" w:lineRule="auto"';
      if (spacingAttrsForParagraph) paragraphPropsInnerForDocumentGeneration += '<w:spacing' + spacingAttrsForParagraph + '/>';
    }
    var indentForParagraph = optsForDocumentGeneration.indent;
    if (indentForParagraph) {
      var indentAttrsForParagraph = '';
      if (indentForParagraph.left != null) indentAttrsForParagraph += ' w:left="' + Math.round(indentForParagraph.left) + '"';
      if (indentForParagraph.right != null) indentAttrsForParagraph += ' w:right="' + Math.round(indentForParagraph.right) + '"';
      if (indentAttrsForParagraph) paragraphPropsInnerForDocumentGeneration += '<w:ind' + indentAttrsForParagraph + '/>';
    }
    if (optsForDocumentGeneration.contextualSpacing) paragraphPropsInnerForDocumentGeneration += '<w:contextualSpacing/>';
    var alignForParagraph = DOCX_JUSTIFICATION_FOR_DOCUMENT_GENERATION[optsForDocumentGeneration.align] || '';
    if (alignForParagraph) paragraphPropsInnerForDocumentGeneration += '<w:jc w:val="' + alignForParagraph + '"/>';
    var paragraphPropsXmlForDocumentGeneration = paragraphPropsInnerForDocumentGeneration ? '<w:pPr>' + paragraphPropsInnerForDocumentGeneration + '</w:pPr>' : '';
    var runsXmlForDocumentGeneration = docxRunsXmlForDocumentGeneration(
      contentForDocumentGeneration,
      {
        bold: !!optsForDocumentGeneration.bold,
        italic: !!optsForDocumentGeneration.italic,
        color: optsForDocumentGeneration.color || '',
        sizePt: optsForDocumentGeneration.sizePt || 0,
        font: optsForDocumentGeneration.font || '',
        linkColor: optsForDocumentGeneration.linkColor || '',
        monoFont: optsForDocumentGeneration.monoFont || ''
      },
      relCollectorForDocumentGeneration
    );
    var pageBreakRunForParagraph = optsForDocumentGeneration.pageBreakRun ? '<w:r><w:br w:type="page"/></w:r>' : '';
    return '<w:p>' + paragraphPropsXmlForDocumentGeneration + pageBreakRunForParagraph + runsXmlForDocumentGeneration + '</w:p>';
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
        rowSpan: clampSpanForDocumentGeneration(cellForDocumentGeneration.rowSpan, MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION),
        fill: cellForDocumentGeneration.fill || '',
        color: cellForDocumentGeneration.color || '',
        align: cellForDocumentGeneration.align || ''
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
    // Rows past the limit, and whether any row had cells past the column limit, for the
    // result's warnings.
    var rowsCutForGrid = Array.isArray(rowsForDocumentGeneration) ? Math.max(0, rowsForDocumentGeneration.length - MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION) : 0;
    var columnsCutForGrid = false;
    if (rowCountForGrid === 0) return { colCount: 0, rows: [], rowsCut: 0, columnsCut: false };

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
        if (colCursorForGrid >= MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION) {
          columnsCutForGrid = true;
          break;
        }
        var richCellForGrid = normalizeRichTableCellForDocumentGeneration(cellsForGrid[cellIndexForGrid]);
        var colSpanForGrid = Math.min(richCellForGrid.colSpan, MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION - colCursorForGrid);
        var rowSpanForGrid = Math.min(richCellForGrid.rowSpan, rowCountForGrid - rowIndexForGrid);
        placedForGrid[rowIndexForGrid].push({
          col: colCursorForGrid,
          kind: 'cell',
          paragraphs: richCellForGrid.paragraphs,
          header: richCellForGrid.header,
          colSpan: colSpanForGrid,
          rowSpan: rowSpanForGrid,
          fill: richCellForGrid.fill || '',
          color: richCellForGrid.color || '',
          align: richCellForGrid.align || ''
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

    return { colCount: colCountForGrid, rows: tiledRowsForGrid, rowsCut: rowsCutForGrid, columnsCut: columnsCutForGrid };
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

  // ---- Table layout shared by the themed DOCX writer and the PDF writer ----

  function isNumericCellTextForDocumentGeneration(textForNumeric) {
    var trimmedForNumeric = String(textForNumeric == null ? '' : textForNumeric).trim();
    return !!trimmedForNumeric && trimmedForNumeric.length <= 24 && NUMERIC_CELL_RE_FOR_DOCUMENT_GENERATION.test(trimmedForNumeric);
  }

  function tableColumnCountForDocumentGeneration(plainRowsForCount) {
    return plainRowsForCount.reduce(function (maxForCount, rowForCount) {
      return Math.max(maxForCount, Array.isArray(rowForCount) ? rowForCount.length : 0);
    }, 0);
  }

  // A column whose body cells are mostly figures is right-aligned, header included, so the digits
  // line up. An explicit align entry for the column wins.
  function columnAlignmentsForDocumentGeneration(plainRowsForAlign, hasHeaderForAlign, explicitAlignForAlign) {
    var colCountForAlign = tableColumnCountForDocumentGeneration(plainRowsForAlign);
    var alignmentsForAlign = [];
    for (var colForAlign = 0; colForAlign < colCountForAlign; colForAlign++) {
      var explicitForAlign = Array.isArray(explicitAlignForAlign) ? String(explicitAlignForAlign[colForAlign] || '').toLowerCase() : '';
      if (explicitForAlign === 'left' || explicitForAlign === 'center' || explicitForAlign === 'right') {
        alignmentsForAlign.push(explicitForAlign);
        continue;
      }
      var numericForAlign = 0;
      var checkedForAlign = 0;
      for (var rowForAlign = hasHeaderForAlign ? 1 : 0; rowForAlign < plainRowsForAlign.length; rowForAlign++) {
        var textForAlign = String((plainRowsForAlign[rowForAlign] || [])[colForAlign] == null ? '' : plainRowsForAlign[rowForAlign][colForAlign]).trim();
        if (!textForAlign) continue;
        checkedForAlign++;
        if (isNumericCellTextForDocumentGeneration(textForAlign)) numericForAlign++;
      }
      alignmentsForAlign.push(checkedForAlign > 0 && numericForAlign / checkedForAlign >= 0.75 ? 'right' : 'left');
    }
    return alignmentsForAlign;
  }

  function isTotalRowForDocumentGeneration(plainRowForTotal) {
    var cellsForTotal = Array.isArray(plainRowForTotal) ? plainRowForTotal : [];
    for (var iForTotal = 0; iForTotal < cellsForTotal.length; iForTotal++) {
      var textForTotal = String(cellsForTotal[iForTotal] == null ? '' : cellsForTotal[iForTotal]).trim();
      if (textForTotal) return TOTAL_ROW_RE_FOR_DOCUMENT_GENERATION.test(textForTotal);
    }
    return false;
  }

  // Column widths that add up to totalWidth. Explicit weights (the spec's columns) win. Otherwise
  // this is the usual auto layout: every column gets at least its longest word, and the rest of
  // the width goes to the columns whose content wants more. measureForWidths returns a width in
  // the same unit as totalWidth, padding included. When the content fits with room to spare, the
  // spare goes mostly to text columns (alignments not 'right'), so figures stay compact and the
  // label column gets the room.
  function computeTableColumnWidthsForDocumentGeneration(plainRowsForWidths, totalWidthForWidths, explicitWeightsForWidths, measureForWidths, alignmentsForWidths) {
    var colCountForWidths = tableColumnCountForDocumentGeneration(plainRowsForWidths);
    if (colCountForWidths === 0) return [];
    var weightsForWidths = Array.isArray(explicitWeightsForWidths)
      ? explicitWeightsForWidths.slice(0, colCountForWidths).map(Number)
      : [];
    if (weightsForWidths.length && weightsForWidths.every(function (weightForCheck) { return weightForCheck > 0 && Number.isFinite(weightForCheck); })) {
      var averageWeightForWidths = weightsForWidths.reduce(function (sumForAvg, weightForAvg) { return sumForAvg + weightForAvg; }, 0) / weightsForWidths.length;
      while (weightsForWidths.length < colCountForWidths) weightsForWidths.push(averageWeightForWidths);
      var weightTotalForWidths = weightsForWidths.reduce(function (sumForTotal, weightForTotal) { return sumForTotal + weightForTotal; }, 0);
      return weightsForWidths.map(function (weightForScale) { return totalWidthForWidths * weightForScale / weightTotalForWidths; });
    }
    var naturalForWidths = [];
    var minimumForWidths = [];
    for (var colForWidths = 0; colForWidths < colCountForWidths; colForWidths++) {
      var naturalWidthForCol = measureForWidths('0000');
      var minimumWidthForCol = measureForWidths('00');
      for (var rowForWidths = 0; rowForWidths < plainRowsForWidths.length; rowForWidths++) {
        var textForWidths = String((plainRowsForWidths[rowForWidths] || [])[colForWidths] == null ? '' : plainRowsForWidths[rowForWidths][colForWidths]);
        textForWidths.split('\n').forEach(function (lineForWidths) {
          naturalWidthForCol = Math.max(naturalWidthForCol, measureForWidths(lineForWidths.slice(0, 90)));
          lineForWidths.split(/\s+/).forEach(function (wordForWidths) {
            minimumWidthForCol = Math.max(minimumWidthForCol, measureForWidths(wordForWidths.slice(0, 24)));
          });
        });
      }
      naturalForWidths.push(naturalWidthForCol);
      minimumForWidths.push(Math.min(minimumWidthForCol, naturalWidthForCol));
    }
    var naturalTotalForWidths = naturalForWidths.reduce(function (sumForNatural, widthForNatural) { return sumForNatural + widthForNatural; }, 0);
    if (naturalTotalForWidths <= totalWidthForWidths) {
      var flexForWidths = naturalForWidths.map(function (widthForFlex, indexForFlex) {
        var isFigureColumnForFlex = Array.isArray(alignmentsForWidths) && alignmentsForWidths[indexForFlex] === 'right';
        return widthForFlex * (isFigureColumnForFlex ? 0.35 : 1);
      });
      var flexTotalForWidths = flexForWidths.reduce(function (sumForFlex, valueForFlex) { return sumForFlex + valueForFlex; }, 0) || 1;
      var leftoverForWidths = totalWidthForWidths - naturalTotalForWidths;
      return naturalForWidths.map(function (widthForFill, indexForFill) {
        return widthForFill + leftoverForWidths * flexForWidths[indexForFill] / flexTotalForWidths;
      });
    }
    var minimumTotalForWidths = minimumForWidths.reduce(function (sumForMinimum, widthForMinimum) { return sumForMinimum + widthForMinimum; }, 0);
    if (minimumTotalForWidths >= totalWidthForWidths) {
      return minimumForWidths.map(function (widthForShrink) { return widthForShrink * totalWidthForWidths / minimumTotalForWidths; });
    }
    var spareForWidths = totalWidthForWidths - minimumTotalForWidths;
    var wantTotalForWidths = naturalTotalForWidths - minimumTotalForWidths;
    return minimumForWidths.map(function (minimumForShare, indexForShare) {
      return minimumForShare + spareForWidths * (naturalForWidths[indexForShare] - minimumForShare) / wantTotalForWidths;
    });
  }

  // Whole-number widths that still add up exactly to the total, so a fixed-layout Word table is
  // never a twip wider than the text column.
  function roundWidthsToTotalForDocumentGeneration(widthsForRound, totalForRound) {
    var roundedForRound = widthsForRound.map(function (widthForRound) { return Math.max(1, Math.floor(widthForRound)); });
    var shortfallForRound = Math.round(totalForRound) - roundedForRound.reduce(function (sumForRound, widthForSum) { return sumForRound + widthForSum; }, 0);
    for (var iForRound = 0; shortfallForRound > 0 && roundedForRound.length; iForRound = (iForRound + 1) % roundedForRound.length) {
      roundedForRound[iForRound]++;
      shortfallForRound--;
    }
    return roundedForRound;
  }

  function tableHasHeaderForDocumentGeneration(blockForHeader, gridForHeader) {
    if (blockForHeader && blockForHeader.header) return true;
    var firstRowForHeader = gridForHeader && gridForHeader.rows && gridForHeader.rows[0];
    if (!firstRowForHeader || !firstRowForHeader.length) return false;
    var realCellsForHeader = firstRowForHeader.filter(function (descriptorForHeader) { return descriptorForHeader.kind === 'cell'; });
    return realCellsForHeader.length > 0 && realCellsForHeader.every(function (descriptorForHeader) { return descriptorForHeader.header; });
  }

  // ---- Themed DOCX ----

  function docxBorderEdgeXmlForDocumentGeneration(edgeNameForEdge, widthEighthsForEdge, colorForEdge, spaceForEdge) {
    return '<w:' + edgeNameForEdge + ' w:val="single" w:sz="' + widthEighthsForEdge + '" w:space="' + (spaceForEdge || 0)
      + '" w:color="' + colorForEdge + '"/>';
  }

  function themedTableBorderSpecForDocumentGeneration(themeForBorders) {
    var colorsForBorders = themeForBorders.colors;
    var styleForBorders = themeForBorders.table.style;
    var hairlineForBorders = { widthPt: 0.5, color: colorsForBorders.tableBorder };
    if (styleForBorders === 'grid') return uniformTableBorderSpecForDocumentGeneration(hairlineForBorders);
    if (styleForBorders === 'booktabs') {
      var ruleForBorders = { widthPt: 1, color: colorsForBorders.tableBorder };
      return { top: ruleForBorders, bottom: ruleForBorders, left: null, right: null, insideH: null, insideV: null };
    }
    return { top: null, left: null, right: null, insideV: null, bottom: hairlineForBorders, insideH: hairlineForBorders };
  }

  // Paints a table in the theme's style. Fills and rules are written as direct cell formatting
  // rather than a Word table style, because Google Docs and LibreOffice ignore most of a table
  // style's conditional formatting and would drop the header fill and the stripes.
  function docxThemedTableForDocumentGeneration(blockForTable, relCollectorForTable, contextForTable) {
    var themeForTable = contextForTable.theme;
    var colorsForTable = themeForTable.colors;
    var gridForTable = expandTableGridForDocumentGeneration(blockForTable.rows);
    if (gridForTable.colCount === 0 || gridForTable.rows.length === 0) return '';
    var plainRowsForTable = tableToPlainRowsForDocumentGeneration(blockForTable.rows);
    var isLayoutForTable = blockForTable.bordered === false && !blockForTable.borderSpec;
    var hasHeaderForTable = !isLayoutForTable && tableHasHeaderForDocumentGeneration(blockForTable, gridForTable);
    var colCountForTable = gridForTable.colCount;
    var bodySizeForTable = themeForTable.sizes.body;
    var sizePtForTable = isLayoutForTable ? bodySizeForTable
      : (colCountForTable > 8 ? bodySizeForTable - 2 : (colCountForTable > 5 ? bodySizeForTable - 1 : bodySizeForTable));
    var paddingForTable = isLayoutForTable
      ? { top: 30, bottom: 30, left: 0, right: 160 }
      : { top: 70, bottom: 70, left: 110, right: 110 };
    var alignmentsForTable = columnAlignmentsForDocumentGeneration(plainRowsForTable, hasHeaderForTable, blockForTable.align);
    var widthsForTable = roundWidthsToTotalForDocumentGeneration(
      computeTableColumnWidthsForDocumentGeneration(plainRowsForTable, contextForTable.contentWidthTwips, blockForTable.columns, function (textForMeasure) {
        return String(textForMeasure).length * sizePtForTable * 0.52 * 20 + paddingForTable.left + paddingForTable.right;
      }, alignmentsForTable),
      contextForTable.contentWidthTwips
    );
    var lastRowIndexForTable = gridForTable.rows.length - 1;
    var totalRowIndexForTable = (!isLayoutForTable && plainRowsForTable.length > (hasHeaderForTable ? 2 : 1)
      && isTotalRowForDocumentGeneration(plainRowsForTable[lastRowIndexForTable])) ? lastRowIndexForTable : -1;
    var styleForTable = themeForTable.table.style;

    var borderSpecForTable = blockForTable.borderSpec
      || (isLayoutForTable ? null : themedTableBorderSpecForDocumentGeneration(themeForTable));
    var bodyRowCounterForTable = 0;
    var rowsXmlForTable = gridForTable.rows.map(function (descriptorsForRow, rowIndexForRow) {
      var isHeaderRowForRow = hasHeaderForTable && rowIndexForRow === 0;
      var isTotalRowForRow = rowIndexForRow === totalRowIndexForTable;
      var rowFillForRow = '';
      if (!isLayoutForTable && !blockForTable.borderSpec) {
        if (isHeaderRowForRow) {
          rowFillForRow = colorsForTable.tableHeaderFill || '';
        } else {
          if (themeForTable.table.zebra && bodyRowCounterForTable % 2 === 1 && !isTotalRowForRow) rowFillForRow = colorsForTable.tableStripe;
          bodyRowCounterForTable++;
        }
      }
      var rowTopEdgeForRow = '';
      var rowBottomEdgeForRow = '';
      if (!isLayoutForTable && !blockForTable.borderSpec) {
        if (isHeaderRowForRow && (styleForTable === 'lines' || styleForTable === 'booktabs')) {
          rowBottomEdgeForRow = docxBorderEdgeXmlForDocumentGeneration('bottom', styleForTable === 'lines' ? 12 : 6, colorsForTable.tableHeaderRule);
        } else if (isTotalRowForRow) {
          rowTopEdgeForRow = docxBorderEdgeXmlForDocumentGeneration('top', 8, colorsForTable.tableHeaderRule);
        }
      }
      // A filled header cell in a style without vertical rules gets side borders in its own fill colour.
      // Renderers draw each cell's fill separately and can leave a hairline seam between two
      // filled cells; the matching border covers it. Body rows are left alone: their side borders
      // would cut gaps into the horizontal rules where they meet, and a seam on a light stripe is
      // not visible anyway.
      var hidesSeamsForRow = isHeaderRowForRow && !blockForTable.borderSpec && styleForTable !== 'grid';
      var colCursorForRow = 0;
      var cellsXmlForRow = descriptorsForRow.map(function (descriptorForCell) {
        var spanForCell = Math.max(1, Number(descriptorForCell.colSpan) || 1);
        var widthForCell = 0;
        for (var spanIndexForCell = 0; spanIndexForCell < spanForCell; spanIndexForCell++) {
          widthForCell += widthsForTable[colCursorForRow + spanIndexForCell] || 0;
        }
        var columnForCell = colCursorForRow;
        colCursorForRow += spanForCell;
        var fillForCell = descriptorForCell.fill || rowFillForRow;
        var tcPrForCell = '<w:tcW w:w="' + widthForCell + '" w:type="dxa"/>';
        if (spanForCell > 1) tcPrForCell += '<w:gridSpan w:val="' + spanForCell + '"/>';
        if (descriptorForCell.kind === 'vmerge') tcPrForCell += '<w:vMerge/>';
        else if (descriptorForCell.kind === 'cell' && Number(descriptorForCell.rowSpan) > 1) tcPrForCell += '<w:vMerge w:val="restart"/>';
        var seamEdgesForCell = (hidesSeamsForRow && fillForCell)
          ? { left: docxBorderEdgeXmlForDocumentGeneration('left', 4, fillForCell), right: docxBorderEdgeXmlForDocumentGeneration('right', 4, fillForCell) }
          : { left: '', right: '' };
        var cellEdgesForCell = rowTopEdgeForRow + seamEdgesForCell.left + rowBottomEdgeForRow + seamEdgesForCell.right;
        if (cellEdgesForCell) tcPrForCell += '<w:tcBorders>' + cellEdgesForCell + '</w:tcBorders>';
        if (fillForCell) tcPrForCell += '<w:shd w:val="clear" w:color="auto" w:fill="' + fillForCell + '"/>';
        if (isHeaderRowForRow) tcPrForCell += '<w:vAlign w:val="bottom"/>';
        if (descriptorForCell.kind !== 'cell') {
          return '<w:tc><w:tcPr>' + tcPrForCell + '</w:tcPr>'
            + docxParagraphForDocumentGeneration('', { styleId: 'TableText' }, relCollectorForTable) + '</w:tc>';
        }
        var isHeaderCellForCell = !isLayoutForTable && (isHeaderRowForRow || !!descriptorForCell.header);
        var colorForCell = descriptorForCell.color || '';
        if (!colorForCell && isHeaderCellForCell && !blockForTable.borderSpec) colorForCell = colorsForTable.tableHeaderText;
        if (!colorForCell && blockForTable.keyValue && columnForCell === 0) colorForCell = colorsForTable.muted;
        var paragraphsForCell = (Array.isArray(descriptorForCell.paragraphs) && descriptorForCell.paragraphs.length)
          ? descriptorForCell.paragraphs
          : [[]];
        var bodyXmlForCell = paragraphsForCell.map(function (runsForCellParagraph) {
          return docxParagraphForDocumentGeneration(runsForCellParagraph, {
            styleId: 'TableText',
            align: descriptorForCell.align || alignmentsForTable[columnForCell] || '',
            bold: isHeaderCellForCell || isTotalRowForRow || (blockForTable.keyValue && columnForCell === 0) || (isLayoutForTable && !!descriptorForCell.header),
            color: colorForCell,
            sizePt: sizePtForTable !== bodySizeForTable ? sizePtForTable : 0,
            linkColor: colorsForTable.link,
            monoFont: themeForTable.fonts.mono.office
          }, relCollectorForTable);
        }).join('');
        return '<w:tc><w:tcPr>' + tcPrForCell + '</w:tcPr>' + bodyXmlForCell + '</w:tc>';
      }).join('');
      return '<w:tr><w:trPr><w:cantSplit/>' + (isHeaderRowForRow ? '<w:tblHeader/>' : '') + '</w:trPr>' + cellsXmlForRow + '</w:tr>';
    }).join('');

    var gridColsForTable = widthsForTable.map(function (widthForGrid) { return '<w:gridCol w:w="' + widthForGrid + '"/>'; }).join('');
    var tableXmlForTable = '<w:tbl><w:tblPr><w:tblW w:w="' + Math.round(contextForTable.contentWidthTwips) + '" w:type="dxa"/>'
      + docxTableBordersXmlForDocumentGeneration(borderSpecForTable)
      + '<w:tblLayout w:type="fixed"/>'
      + '<w:tblCellMar><w:top w:w="' + paddingForTable.top + '" w:type="dxa"/><w:left w:w="' + paddingForTable.left + '" w:type="dxa"/>'
      + '<w:bottom w:w="' + paddingForTable.bottom + '" w:type="dxa"/><w:right w:w="' + paddingForTable.right + '" w:type="dxa"/></w:tblCellMar>'
      + '</w:tblPr><w:tblGrid>' + gridColsForTable + '</w:tblGrid>' + rowsXmlForTable + '</w:tbl>';
    var captionTextForTable = typeof blockForTable.caption === 'string' ? blockForTable.caption.trim() : '';
    var captionXmlForTable = captionTextForTable
      ? docxParagraphForDocumentGeneration(captionTextForTable, { styleId: 'Caption' }, relCollectorForTable)
      : '';
    // Two adjacent w:tbl elements merge into one table in Word, and body text placed right after a
    // table touches its bottom edge. A short spacer paragraph prevents both.
    var spacerXmlForTable = '<w:p><w:pPr><w:spacing w:before="0" w:after="' + Math.round(themeForTable.spacing.after * 20)
      + '" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="8"/><w:szCs w:val="8"/></w:rPr></w:pPr></w:p>';
    return captionXmlForTable + tableXmlForTable + spacerXmlForTable;
  }

  // Bullet and numbered items may nest: an item is a string, a runs array (from html), or
  // { text, items } with sub-items. Word lists go three levels deep.
  function flattenListItemsForDocumentGeneration(itemsForFlatten, levelForFlatten, outForFlatten) {
    var resultForFlatten = outForFlatten || [];
    if (!Array.isArray(itemsForFlatten)) return resultForFlatten;
    itemsForFlatten.forEach(function (itemForFlatten) {
      if (itemForFlatten == null) return;
      if (Array.isArray(itemForFlatten)) {
        resultForFlatten.push({ runs: itemForFlatten, level: levelForFlatten });
      } else if (typeof itemForFlatten === 'object') {
        resultForFlatten.push({ text: String(itemForFlatten.text == null ? '' : itemForFlatten.text), level: levelForFlatten });
        if (Array.isArray(itemForFlatten.items)) {
          flattenListItemsForDocumentGeneration(itemForFlatten.items, Math.min(2, levelForFlatten + 1), resultForFlatten);
        }
      } else {
        resultForFlatten.push({ text: String(itemForFlatten), level: levelForFlatten });
      }
    });
    return resultForFlatten;
  }

  // Any list block as flat entries { runs or text, level, ordered, key }. A bullet or numbered
  // block is one list element (key 0) whose items nest. An html list block already holds its
  // entries; a list block whose items are plain runs arrays is read at the block's level.
  function listEntriesForDocumentGeneration(blockForEntries) {
    var typeForEntries = blockForEntries.type;
    function levelOfForEntries(valueForLevel) {
      return Math.max(0, Math.min(2, Number(valueForLevel) || 0));
    }
    if (typeForEntries === 'bullet' || typeForEntries === 'numbered') {
      var itemsForEntries = Array.isArray(blockForEntries.items)
        ? blockForEntries.items
        : [String(blockForEntries.text == null ? '' : blockForEntries.text)];
      return flattenListItemsForDocumentGeneration(itemsForEntries, 0).map(function (itemForEntry) {
        itemForEntry.ordered = typeForEntries === 'numbered';
        itemForEntry.key = 0;
        return itemForEntry;
      });
    }
    var blockLevelForEntries = levelOfForEntries(blockForEntries.level);
    var blockOrderedForEntries = !!blockForEntries.ordered;
    return (Array.isArray(blockForEntries.items) ? blockForEntries.items : []).map(function (itemForEntry) {
      if (Array.isArray(itemForEntry)) {
        return { runs: itemForEntry, level: blockLevelForEntries, ordered: blockOrderedForEntries, key: 0 };
      }
      if (itemForEntry && typeof itemForEntry === 'object') {
        var entryForItem = {
          level: itemForEntry.level == null ? blockLevelForEntries : levelOfForEntries(itemForEntry.level),
          ordered: typeof itemForEntry.ordered === 'boolean' ? itemForEntry.ordered : blockOrderedForEntries,
          key: Math.max(0, Math.floor(Number(itemForEntry.key) || 0))
        };
        if (Array.isArray(itemForEntry.runs)) entryForItem.runs = itemForEntry.runs;
        else entryForItem.text = String(itemForEntry.text == null ? '' : itemForEntry.text);
        return entryForItem;
      }
      return { text: String(itemForEntry == null ? '' : itemForEntry), level: blockLevelForEntries, ordered: blockOrderedForEntries, key: 0 };
    });
  }

  // One numbering instance per list element (entry key), allocated where the element first
  // appears. A parent list's entries after its sub-list reuse its instance and keep counting.
  function docxListParagraphsForDocumentGeneration(entriesForDocx, relCollectorForDocx, paragraphForDocx) {
    var numIdsForDocx = {};
    return entriesForDocx.map(function (entryForDocx, indexForDocx) {
      var keyForDocx = String(entryForDocx.key || 0);
      if (!numIdsForDocx[keyForDocx]) numIdsForDocx[keyForDocx] = relCollectorForDocx.allocNumbering(!!entryForDocx.ordered, entryForDocx.level);
      return paragraphForDocx(entryForDocx.runs || entryForDocx.text || '', {
        ilvl: Math.max(0, Math.min(2, Number(entryForDocx.level) || 0)),
        numId: numIdsForDocx[keyForDocx]
      }, indexForDocx === entriesForDocx.length - 1);
    }).join('');
  }

  function blockContentForDocumentGeneration(blockForContent) {
    return Array.isArray(blockForContent.runs) ? blockForContent.runs : String(blockForContent.text == null ? '' : blockForContent.text);
  }

  function blockHasVisibleTextForDocumentGeneration(blockForVisible) {
    if (Array.isArray(blockForVisible.runs)) {
      return blockForVisible.runs.some(function (runForVisible) { return runForVisible && String(runForVisible.text || '').trim(); });
    }
    return String(blockForVisible.text == null ? '' : blockForVisible.text).trim().length > 0;
  }

  // Merges the one-line bullet blocks that plain content produces into one list, and drops empty
  // paragraphs, whose only purpose in plain content was spacing the theme already provides.
  function tidyBlocksForThemedDocumentGeneration(blocksForTidy) {
    var tidiedForTidy = [];
    blocksForTidy.forEach(function (blockForTidy) {
      if (!blockForTidy || typeof blockForTidy !== 'object') return;
      var typeForTidy = blockForTidy.type;
      if ((typeForTidy === 'paragraph' || typeForTidy === undefined) && !blockHasVisibleTextForDocumentGeneration(blockForTidy)) return;
      var previousForTidy = tidiedForTidy[tidiedForTidy.length - 1];
      if ((typeForTidy === 'bullet' || typeForTidy === 'numbered') && !Array.isArray(blockForTidy.items)
        && previousForTidy && previousForTidy.type === typeForTidy && previousForTidy.mergedForTidy) {
        previousForTidy.items.push(String(blockForTidy.text == null ? '' : blockForTidy.text));
        return;
      }
      if ((typeForTidy === 'bullet' || typeForTidy === 'numbered') && !Array.isArray(blockForTidy.items)) {
        tidiedForTidy.push({ type: typeForTidy, items: [String(blockForTidy.text == null ? '' : blockForTidy.text)], mergedForTidy: true });
        return;
      }
      tidiedForTidy.push(blockForTidy);
    });
    return tidiedForTidy;
  }

  function calloutParagraphsForDocumentGeneration(blockForCallout) {
    var paragraphsForCallout = [];
    if (Array.isArray(blockForCallout.paragraphs)) {
      blockForCallout.paragraphs.forEach(function (runsForCallout) {
        if (Array.isArray(runsForCallout) && runsForCallout.length) paragraphsForCallout.push(runsForCallout);
      });
    } else if (Array.isArray(blockForCallout.runs)) {
      paragraphsForCallout.push(blockForCallout.runs);
    } else {
      String(blockForCallout.text == null ? '' : blockForCallout.text).split(/\r?\n/).forEach(function (lineForCallout) {
        if (lineForCallout.trim()) paragraphsForCallout.push(lineForCallout);
      });
    }
    return paragraphsForCallout;
  }

  function buildThemedDocxBodyForDocumentGeneration(blocksForThemed, contextForThemed) {
    var themeForBody = contextForThemed.theme;
    var colorsForBody = themeForBody.colors;
    var relCollectorForBody = makeDocxRelCollectorForDocumentGeneration();
    var hasHeadingForBody = false;
    var afterTwipsForBody = Math.round(themeForBody.spacing.after * 20);
    function paragraphForBody(contentForParagraph, optionsForParagraph) {
      var optionsWithLinkForBody = Object.assign({ linkColor: colorsForBody.link, monoFont: themeForBody.fonts.mono.office }, optionsForParagraph || {});
      return docxParagraphForDocumentGeneration(contentForParagraph, optionsWithLinkForBody, relCollectorForBody);
    }
    function listXmlForBody(entriesForList) {
      return docxListParagraphsForDocumentGeneration(entriesForList, relCollectorForBody, function (contentForItem, numPrForItem, isLastForItem) {
        return paragraphForBody(contentForItem, {
          styleId: 'ListParagraph',
          numPr: numPrForItem,
          spacing: isLastForItem ? { after: afterTwipsForBody } : null
        });
      });
    }

    var bodyXmlForThemed = tidyBlocksForThemedDocumentGeneration(blocksForThemed).map(function (blockForBody) {
      var typeForBody = blockForBody.type;
      var alignForBody = typeof blockForBody.align === 'string' ? blockForBody.align.toLowerCase() : '';
      if (typeForBody === 'image') {
        var resolvedForBody = blockForBody.resolved;
        if (!resolvedForBody || !resolvedForBody.bytes) return '';
        var addedForBody = relCollectorForBody.addImage(resolvedForBody.bytes, resolvedForBody.ext);
        return docxImageDrawingXmlForDocumentGeneration(addedForBody.relId, addedForBody.ordinal, resolvedForBody.cx, resolvedForBody.cy);
      }
      if (typeForBody === 'title') {
        var subtitleForBody = typeof blockForBody.subtitle === 'string' ? blockForBody.subtitle.trim() : '';
        var ruleXmlForBody = themeForBody.title.rule
          ? docxBorderEdgeXmlForDocumentGeneration('bottom', 12, colorsForBody.accent, 8)
          : '';
        var titleXmlForBody = paragraphForBody(blockContentForDocumentGeneration(blockForBody), {
          styleId: 'Title',
          align: alignForBody,
          borderXml: subtitleForBody ? '' : ruleXmlForBody,
          spacing: subtitleForBody ? null : { after: 360 }
        });
        if (!subtitleForBody) return titleXmlForBody;
        return titleXmlForBody + paragraphForBody(subtitleForBody, { styleId: 'Subtitle', align: alignForBody, borderXml: ruleXmlForBody });
      }
      if (typeForBody === 'subtitle') {
        return paragraphForBody(blockContentForDocumentGeneration(blockForBody), { styleId: 'Subtitle', align: alignForBody });
      }
      if (typeForBody === 'heading') {
        hasHeadingForBody = true;
        return paragraphForBody(blockContentForDocumentGeneration(blockForBody), {
          headingLevel: Math.max(1, Math.min(6, Number(blockForBody.level) || 1)),
          align: alignForBody
        });
      }
      if (typeForBody === 'bullet' || typeForBody === 'numbered' || typeForBody === 'list') {
        return listXmlForBody(listEntriesForDocumentGeneration(blockForBody));
      }
      if (typeForBody === 'table') {
        return docxThemedTableForDocumentGeneration(blockForBody, relCollectorForBody, contextForThemed);
      }
      if (typeForBody === 'key_value') {
        var pairsForBody = (Array.isArray(blockForBody.rows) ? blockForBody.rows : []).map(function (pairForBody) {
          if (Array.isArray(pairForBody)) return [pairForBody[0], pairForBody.slice(1).join(' ')];
          if (pairForBody && typeof pairForBody === 'object') return [pairForBody.label, pairForBody.value];
          return [String(pairForBody == null ? '' : pairForBody), ''];
        });
        if (!pairsForBody.length) return '';
        return docxThemedTableForDocumentGeneration({
          rows: pairsForBody,
          bordered: false,
          keyValue: true,
          columns: Array.isArray(blockForBody.columns) ? blockForBody.columns : [30, 70]
        }, relCollectorForBody, contextForThemed);
      }
      if (typeForBody === 'callout') {
        var toneColorsForBody = (agentNamespaceForDocumentGeneration.documentThemes || { calloutColors: function () { return { bar: colorsForBody.accent, fill: colorsForBody.calloutFill, title: colorsForBody.accentText || colorsForBody.accent }; } })
          .calloutColors(themeForBody, blockForBody.tone);
        // Borders in the fill colour pad the box. Word and LibreOffice draw adjacent paragraphs
        // that share identical borders as one box, so a multi-paragraph callout stays one block.
        var calloutBorderXmlForBody = docxBorderEdgeXmlForDocumentGeneration('top', 4, toneColorsForBody.fill, 6)
          + docxBorderEdgeXmlForDocumentGeneration('left', 24, toneColorsForBody.bar, 10)
          + docxBorderEdgeXmlForDocumentGeneration('bottom', 4, toneColorsForBody.fill, 6)
          + docxBorderEdgeXmlForDocumentGeneration('right', 4, toneColorsForBody.fill, 10);
        var calloutPiecesForBody = [];
        var calloutTitleForBody = typeof blockForBody.title === 'string' ? blockForBody.title.trim() : '';
        if (calloutTitleForBody) calloutPiecesForBody.push({ content: calloutTitleForBody, title: true });
        calloutParagraphsForDocumentGeneration(blockForBody).forEach(function (contentForPiece) {
          calloutPiecesForBody.push({ content: contentForPiece, title: false });
        });
        if (!calloutPiecesForBody.length) return '';
        return calloutPiecesForBody.map(function (pieceForCallout, indexForCallout) {
          return paragraphForBody(pieceForCallout.content, {
            borderXml: calloutBorderXmlForBody,
            fill: toneColorsForBody.fill,
            indent: { left: 240, right: 240 },
            spacing: {
              before: indexForCallout === 0 ? 160 : 0,
              after: indexForCallout === calloutPiecesForBody.length - 1 ? 240 : 80
            },
            keepNext: indexForCallout < calloutPiecesForBody.length - 1,
            bold: pieceForCallout.title,
            color: pieceForCallout.title ? toneColorsForBody.title : ''
          });
        }).join('');
      }
      if (typeForBody === 'quote') {
        var citeForBody = typeof blockForBody.cite === 'string' ? blockForBody.cite.trim() : '';
        return paragraphForBody(blockContentForDocumentGeneration(blockForBody), { styleId: 'Quote', keepNext: !!citeForBody })
          + (citeForBody ? paragraphForBody(citeForBody, { styleId: 'Quote', align: 'right', italic: false, sizePt: themeForBody.sizes.small }) : '');
      }
      if (typeForBody === 'divider') {
        return '<w:p><w:pPr><w:pBdr>' + docxBorderEdgeXmlForDocumentGeneration('bottom', 6, colorsForBody.rule, 1) + '</w:pBdr>'
          + '<w:spacing w:before="0" w:after="' + Math.max(240, afterTwipsForBody * 2) + '" w:line="240" w:lineRule="auto"/>'
          + '<w:rPr><w:sz w:val="8"/><w:szCs w:val="8"/></w:rPr></w:pPr></w:p>';
      }
      if (typeForBody === 'page_break') {
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
      return paragraphForBody(blockContentForDocumentGeneration(blockForBody), { align: alignForBody });
    }).join('');

    return {
      body: bodyXmlForThemed,
      hyperlinks: relCollectorForBody.hyperlinks,
      numbering: relCollectorForBody.numbering,
      images: relCollectorForBody.images,
      hasHeading: hasHeadingForBody
    };
  }

  function docxFieldRunsXmlForDocumentGeneration(instructionForField, placeholderForField) {
    return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + '<w:r><w:instrText xml:space="preserve"> ' + instructionForField + ' </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      + '<w:r><w:t>' + placeholderForField + '</w:t></w:r>'
      + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  }

  // "3 / 12" rather than "Page 3 of 12", so the footer reads the same in any language.
  function buildDocxFooterXmlForDocumentGeneration(themeForFooter) {
    var withTotalForFooter = themeForFooter.footer === 'page-x-of-y';
    var runsForFooter = docxFieldRunsXmlForDocumentGeneration('PAGE', '1');
    if (withTotalForFooter) {
      runsForFooter += '<w:r><w:t xml:space="preserve"> / </w:t></w:r>' + docxFieldRunsXmlForDocumentGeneration('NUMPAGES', '1');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="' + (withTotalForFooter ? 'right' : 'center') + '"/></w:pPr>' + runsForFooter + '</w:p>'
      + '</w:ftr>';
  }

  function buildDocxHeaderXmlForDocumentGeneration(textForHeader) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">' + escapeXmlForDocumentGeneration(textForHeader) + '</w:t></w:r></w:p>'
      + '</w:hdr>';
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
        return docxListParagraphsForDocumentGeneration(
          listEntriesForDocumentGeneration(blockForDocumentGeneration),
          relCollectorForDocumentGeneration,
          function (contentForItem, numPrForItem) {
            return docxParagraphForDocumentGeneration(contentForItem, { numPr: numPrForItem }, relCollectorForDocumentGeneration);
          }
        );
      }
      // An edited source document is not themed, but its html can still gain a title, callout,
      // rule or page break from the model; render each plainly rather than dropping its text.
      if (blockForDocumentGeneration.type === 'title') {
        hasHeadingForDocumentGeneration = true;
        return docxParagraphForDocumentGeneration(blockContentForDocumentGeneration(blockForDocumentGeneration), { headingLevel: 1 }, relCollectorForDocumentGeneration);
      }
      if (blockForDocumentGeneration.type === 'callout') {
        return calloutParagraphsForDocumentGeneration(blockForDocumentGeneration).map(function (contentForLegacyCallout) {
          return docxParagraphForDocumentGeneration(contentForLegacyCallout, {}, relCollectorForDocumentGeneration);
        }).join('');
      }
      if (blockForDocumentGeneration.type === 'divider') {
        return '<w:p><w:pPr><w:pBdr>' + docxBorderEdgeXmlForDocumentGeneration('bottom', 6, '808080', 1) + '</w:pBdr></w:pPr></w:p>';
      }
      if (blockForDocumentGeneration.type === 'page_break') {
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
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

  function docxCorePropsXmlForDocumentGeneration(titleForCore, createdAtForCore) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + escapeXmlForDocumentGeneration(titleForCore) + '</dc:title>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + escapeXmlForDocumentGeneration(createdAtForCore) + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + escapeXmlForDocumentGeneration(createdAtForCore) + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function buildDocxForDocumentGeneration(inputForDocumentGeneration, renderContextForDocx) {
    if (!globalScopeForDocumentGeneration.JSZip) {
      throw new Error('DOCX generator is unavailable.');
    }
    var zipForDocumentGeneration = new globalScopeForDocumentGeneration.JSZip();
    var themeForDocx = (renderContextForDocx && renderContextForDocx.theme) || null;
    var docDefaultsForDocumentGeneration = inputForDocumentGeneration.docDefaults || null;
    var builtBodyForDocumentGeneration;
    var headerTextForDocx = '';
    var wantsFooterForDocx = false;
    if (themeForDocx) {
      var pageForDocx = renderContextForDocx.page;
      var marginForDocx = themeForDocx.marginPt;
      docDefaultsForDocumentGeneration = {
        pageWidthPt: pageForDocx.widthPt,
        pageHeightPt: pageForDocx.heightPt,
        margins: { top: marginForDocx, right: marginForDocx, bottom: marginForDocx, left: marginForDocx }
      };
      builtBodyForDocumentGeneration = buildThemedDocxBodyForDocumentGeneration(
        normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, 'DOCX creation requires blocks, html, or content.'),
        { theme: themeForDocx, contentWidthTwips: Math.round((pageForDocx.widthPt - 2 * marginForDocx) * 20) }
      );
      headerTextForDocx = renderContextForDocx.headerText || '';
      wantsFooterForDocx = !!renderContextForDocx.pageNumbers;
    } else {
      builtBodyForDocumentGeneration = buildDocxBodyForDocumentGeneration(inputForDocumentGeneration);
    }
    var hyperlinksForDocumentGeneration = builtBodyForDocumentGeneration.hyperlinks || [];
    var numberingForDocumentGeneration = builtBodyForDocumentGeneration.numbering || [];
    var imagesForDocumentGeneration = builtBodyForDocumentGeneration.images || [];
    var hasNumberingForDocumentGeneration = numberingForDocumentGeneration.length > 0;
    var hasHeadingForDocumentGeneration = builtBodyForDocumentGeneration.hasHeading === true;
    var needsStylesForDocumentGeneration = !!themeForDocx || hasHeadingForDocumentGeneration
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
      docxSectionPropertiesXmlForDocumentGeneration(docDefaultsForDocumentGeneration, {
        headerRelId: headerTextForDocx ? 'rIdHeader1' : '',
        footerRelId: wantsFooterForDocx ? 'rIdFooter1' : ''
      }) +
      '</w:body></w:document>';
    var coreTitleForDocx = themeForDocx ? String(inputForDocumentGeneration.title || '').trim() : '';

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
      (headerTextForDocx ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
      (wantsFooterForDocx ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
      (coreTitleForDocx ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '') +
      '</Types>'
    );
    zipForDocumentGeneration.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      (coreTitleForDocx ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' : '') +
      '</Relationships>'
    );
    if (coreTitleForDocx) {
      zipForDocumentGeneration.folder('docProps').file('core.xml', docxCorePropsXmlForDocumentGeneration(coreTitleForDocx, new Date().toISOString()));
    }

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
    if (headerTextForDocx) {
      documentRelationshipsForDocumentGeneration += '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';
    }
    if (wantsFooterForDocx) {
      documentRelationshipsForDocumentGeneration += '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';
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
      wordFolderForDocumentGeneration.file('numbering.xml', buildDocxNumberingXmlForDocumentGeneration(numberingForDocumentGeneration, themeForDocx));
    }
    if (needsStylesForDocumentGeneration) {
      wordFolderForDocumentGeneration.file('styles.xml', themeForDocx
        ? buildThemedDocxStylesXmlForDocumentGeneration(themeForDocx)
        : buildDocxStylesXmlForDocumentGeneration(docDefaultsForDocumentGeneration));
    }
    if (headerTextForDocx) {
      wordFolderForDocumentGeneration.file('header1.xml', buildDocxHeaderXmlForDocumentGeneration(headerTextForDocx));
    }
    if (wantsFooterForDocx) {
      wordFolderForDocumentGeneration.file('footer1.xml', buildDocxFooterXmlForDocumentGeneration(themeForDocx));
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

  // ---- PDF ----
  // A small PDF 1.4 writer on the 12 base-14 fonts. Text is WinAnsi-encoded, measured with the
  // fonts' real glyph widths, and laid out in the theme's sizes, colours and spacing.

  var cp1252ByCodepointForDocumentGeneration = null;
  var pdfWidthTablesForDocumentGeneration = null;
  var PDF_FONT_NAME_BY_KEY_FOR_DOCUMENT_GENERATION = {
    F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica', F4: 'Helvetica-Bold',
    F5: 'Times-Roman', F6: 'Times-Bold', F7: 'Times-Italic', F8: 'Times-BoldItalic'
  };
  // Stand-ins that change nothing a reader would notice, so they are not reported.
  var PDF_SILENT_STAND_INS_FOR_DOCUMENT_GENERATION = { '': true, ' ': true, '-': true, '\u2022': true };

  function winAnsiCharForDocumentGeneration(charForWinAnsi) {
    var codepointForWinAnsi = charForWinAnsi.codePointAt(0);
    if (codepointForWinAnsi >= 32 && codepointForWinAnsi < 127) return charForWinAnsi;
    if (codepointForWinAnsi >= 0xA0 && codepointForWinAnsi <= 0xFF) return String.fromCharCode(codepointForWinAnsi);
    if (!cp1252ByCodepointForDocumentGeneration) {
      cp1252ByCodepointForDocumentGeneration = {};
      CP1252_HIGH_CODEPOINTS_FOR_DOCUMENT_GENERATION.forEach(function (codepointForTable, offsetForTable) {
        if (codepointForTable) cp1252ByCodepointForDocumentGeneration[codepointForTable] = 0x80 + offsetForTable;
      });
    }
    var byteForWinAnsi = cp1252ByCodepointForDocumentGeneration[codepointForWinAnsi];
    return byteForWinAnsi ? String.fromCharCode(byteForWinAnsi) : null;
  }

  function makePdfCharTrackerForDocumentGeneration() {
    var shownAsForTracker = {};
    var orderForTracker = [];
    var countForTracker = 0;
    return {
      record: function (charForRecord, shownForRecord) {
        countForTracker++;
        if (!Object.prototype.hasOwnProperty.call(shownAsForTracker, charForRecord)) {
          shownAsForTracker[charForRecord] = shownForRecord;
          orderForTracker.push(charForRecord);
        }
      },
      warning: function () {
        if (!countForTracker) return '';
        var samplesForWarning = orderForTracker.slice(0, 8).map(function (charForSample) {
          return charForSample + ' as ' + (shownAsForTracker[charForSample] === '?' ? '?' : '"' + shownAsForTracker[charForSample] + '"');
        });
        return countForTracker + ' character' + (countForTracker === 1 ? ' is' : 's are') + ' outside the PDF\'s built-in fonts and '
          + (countForTracker === 1 ? 'was' : 'were') + ' simplified or replaced (' + samplesForWarning.join(', ')
          + (orderForTracker.length > 8 ? ', and others' : '') + '). Make a DOCX instead if the exact characters matter.';
      }
    };
  }

  // Combining marks, matched after a base character so a letter and its accents are one unit.
  var COMBINING_MARKS_RE_FOR_DOCUMENT_GENERATION = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;
  var LETTER_CLUSTER_RE_FOR_DOCUMENT_GENERATION = /[\s\S][\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]*/gu;

  // Returns a string whose char codes are WinAnsi bytes. A character the encoding lacks gets a
  // plain stand-in, or its base letter (o with a dot below becomes o), or "?", and the tracker
  // records it so the result can tell the model. A letter is encoded together with the accents
  // that follow it, so o with both a dot below and a grave becomes "o", not "o?".
  function encodeWinAnsiForDocumentGeneration(textForEncode, trackerForEncode) {
    var outputForEncode = '';
    var clustersForEncode = String(textForEncode == null ? '' : textForEncode).normalize('NFC')
      .match(LETTER_CLUSTER_RE_FOR_DOCUMENT_GENERATION) || [];
    clustersForEncode.forEach(function (clusterForEncode) {
      if (clusterForEncode === '\t' || clusterForEncode === '\n' || clusterForEncode === '\r') {
        outputForEncode += ' ';
        return;
      }
      var directForEncode = Array.from(clusterForEncode).length === 1 ? winAnsiCharForDocumentGeneration(clusterForEncode) : null;
      if (directForEncode !== null) {
        outputForEncode += directForEncode;
        return;
      }
      if (Object.prototype.hasOwnProperty.call(PDF_CHAR_STAND_INS_FOR_DOCUMENT_GENERATION, clusterForEncode)) {
        var standInForEncode = PDF_CHAR_STAND_INS_FOR_DOCUMENT_GENERATION[clusterForEncode];
        outputForEncode += Array.from(standInForEncode).map(function (standInCharForEncode) {
          return winAnsiCharForDocumentGeneration(standInCharForEncode) || '?';
        }).join('');
        if (trackerForEncode && !PDF_SILENT_STAND_INS_FOR_DOCUMENT_GENERATION[standInForEncode]) {
          trackerForEncode.record(clusterForEncode, standInForEncode);
        }
        return;
      }
      var baseForEncode = clusterForEncode.normalize('NFD').replace(COMBINING_MARKS_RE_FOR_DOCUMENT_GENERATION, '');
      if (baseForEncode !== clusterForEncode) {
        var baseCharsForEncode = Array.from(baseForEncode).map(winAnsiCharForDocumentGeneration);
        if (baseCharsForEncode.every(function (encodedBaseForEvery) { return encodedBaseForEvery !== null; })) {
          outputForEncode += baseCharsForEncode.join('');
          if (trackerForEncode) trackerForEncode.record(clusterForEncode, baseForEncode);
          return;
        }
      }
      outputForEncode += '?';
      if (trackerForEncode) trackerForEncode.record(clusterForEncode, '?');
    });
    return outputForEncode;
  }

  function pdfEscapeEncodedForDocumentGeneration(encodedForEscape) {
    return encodedForEscape.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function pdfSafeTextForDocumentGeneration(valueForDocumentGeneration) {
    return pdfEscapeEncodedForDocumentGeneration(encodeWinAnsiForDocumentGeneration(valueForDocumentGeneration, null));
  }

  // A text string for the document information dictionary, as UTF-16BE so any title survives.
  function pdfUnicodeHexStringForDocumentGeneration(textForHex) {
    var hexForString = 'FEFF';
    var sourceForHex = String(textForHex == null ? '' : textForHex);
    for (var iForHex = 0; iForHex < sourceForHex.length; iForHex++) {
      hexForString += ('0000' + sourceForHex.charCodeAt(iForHex).toString(16).toUpperCase()).slice(-4);
    }
    return '<' + hexForString + '>';
  }

  function measurePdfEncodedForDocumentGeneration(encodedForMeasure, fontKeyForMeasure, sizeForMeasure) {
    if (!pdfWidthTablesForDocumentGeneration) {
      pdfWidthTablesForDocumentGeneration = {};
      Object.keys(PDF_WIDTH_TABLES_SOURCE_FOR_DOCUMENT_GENERATION).forEach(function (fontNameForParse) {
        pdfWidthTablesForDocumentGeneration[fontNameForParse] = PDF_WIDTH_TABLES_SOURCE_FOR_DOCUMENT_GENERATION[fontNameForParse].split(',').map(Number);
      });
    }
    var fontNameForMeasure = PDF_FONT_NAME_BY_KEY_FOR_DOCUMENT_GENERATION[fontKeyForMeasure];
    var tableForMeasure = fontNameForMeasure ? pdfWidthTablesForDocumentGeneration[fontNameForMeasure] : null;
    var unitsForMeasure = 0;
    for (var iForMeasure = 0; iForMeasure < encodedForMeasure.length; iForMeasure++) {
      var codeForMeasure = encodedForMeasure.charCodeAt(iForMeasure);
      unitsForMeasure += tableForMeasure ? (tableForMeasure[codeForMeasure - 32] || 500) : 600;
    }
    return unitsForMeasure * sizeForMeasure / 1000;
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

  // F1-F4 sans, F5-F8 serif, F9-F12 mono, each in regular, bold, italic, bold-italic order.
  function pdfFontKeyForDocumentGeneration(familyClassForKey, boldForKey, italicForKey) {
    var familyOffsetForKey = familyClassForKey === 'serif' ? 4 : (familyClassForKey === 'mono' ? 8 : 0);
    var styleIndexForKey = (boldForKey && italicForKey) ? 4 : (boldForKey ? 2 : (italicForKey ? 3 : 1));
    return 'F' + (familyOffsetForKey + styleIndexForKey);
  }

  function pdfColorOperandsForDocumentGeneration(hexColorForDocumentGeneration) {
    var hexForStroke = String(hexColorForDocumentGeneration || '000000');
    if (!/^[0-9A-Fa-f]{6}$/.test(hexForStroke)) hexForStroke = '000000';
    return [0, 2, 4].map(function (offsetForStroke) {
      return (parseInt(hexForStroke.substr(offsetForStroke, 2), 16) / 255).toFixed(3);
    }).join(' ');
  }

  // The look a PDF is laid out in: the resolved theme for a new document, or a plain black look
  // for a document rebuilt from read_document_structure html, which keeps its own base font,
  // size, page and margins.
  function pdfLookForDocumentGeneration(themeForLook, docDefaultsForLook) {
    if (themeForLook) {
      return {
        themed: true,
        theme: themeForLook,
        families: {
          heading: themeForLook.fonts.heading.kind,
          body: themeForLook.fonts.body.kind,
          mono: 'mono'
        },
        colors: themeForLook.colors,
        sizes: themeForLook.sizes,
        spacing: themeForLook.spacing,
        title: themeForLook.title,
        table: themeForLook.table
      };
    }
    var bodySizeForLook = (docDefaultsForLook && docDefaultsForLook.fontSizePt) || DEFAULT_PDF_BODY_SIZE_PT_FOR_DOCUMENT_GENERATION;
    var familyForLook = pdfFamilyClassForDocumentGeneration(docDefaultsForLook && docDefaultsForLook.fontFamily, 'sans');
    return {
      themed: false,
      theme: null,
      families: { heading: familyForLook, body: familyForLook, mono: 'mono' },
      colors: {
        text: '000000', muted: '555555', heading: '000000', primary: '000000', accent: '555555', link: '0000FF',
        rule: '808080', tableBorder: 'D9D9D9', tableHeaderFill: '', tableHeaderText: '000000', tableHeaderRule: '000000',
        tableStripe: '', calloutFill: 'F2F2F2'
      },
      sizes: { body: bodySizeForLook, small: Math.max(7, bodySizeForLook - 2), title: 20, subtitle: 13, headings: [18, 15, 13, 13, 13, 13] },
      spacing: { line: 1.15, after: 4, headingBefore: [6, 6, 6, 6, 6, 6], headingAfter: [8, 8, 8, 8, 8, 8] },
      title: { align: 'left', rule: false },
      table: { style: 'source', zebra: false }
    };
  }

  function buildPdfForDocumentGeneration(inputForDocumentGeneration, renderContextForPdf) {
    var contextForPdf = renderContextForPdf || { theme: null, warnings: [] };
    if (!Array.isArray(contextForPdf.warnings)) contextForPdf.warnings = [];
    var docDefaultsForPdf = inputForDocumentGeneration.docDefaults || null;
    var lookForPdf = pdfLookForDocumentGeneration(contextForPdf.theme, docDefaultsForPdf);
    var colorsForPdf = lookForPdf.colors;
    var sizesForPdf = lookForPdf.sizes;
    var trackerForPdf = makePdfCharTrackerForDocumentGeneration();
    var blocksForPdf = tidyBlocksForThemedDocumentGeneration(
      normalizeBlocksForDocumentGeneration(inputForDocumentGeneration, 'PDF creation requires blocks, html, or content.')
    );

    var pageWidthForPdf;
    var pageHeightForPdf;
    var marginsForPdf;
    if (lookForPdf.themed) {
      pageWidthForPdf = contextForPdf.page.widthPt;
      pageHeightForPdf = contextForPdf.page.heightPt;
      var themeMarginForPdf = contextForPdf.theme.marginPt;
      marginsForPdf = { top: themeMarginForPdf, right: themeMarginForPdf, bottom: themeMarginForPdf, left: themeMarginForPdf };
    } else {
      var sourceMarginsForPdf = (docDefaultsForPdf && docDefaultsForPdf.margins) || {};
      pageWidthForPdf = (docDefaultsForPdf && docDefaultsForPdf.pageWidthPt) || DEFAULT_PAGE_WIDTH_PT_FOR_DOCUMENT_GENERATION;
      pageHeightForPdf = (docDefaultsForPdf && docDefaultsForPdf.pageHeightPt) || DEFAULT_PAGE_HEIGHT_PT_FOR_DOCUMENT_GENERATION;
      // 50pt rather than the 54pt side margin: the long-standing top offset for documents with no
      // declared page setup.
      marginsForPdf = {
        top: sourceMarginsForPdf.top || 50,
        right: sourceMarginsForPdf.right || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION,
        bottom: sourceMarginsForPdf.bottom || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION,
        left: sourceMarginsForPdf.left || DEFAULT_PDF_MARGIN_PT_FOR_DOCUMENT_GENERATION
      };
    }
    var leftForPdf = marginsForPdf.left;
    var contentWidthForPdf = Math.max(72, pageWidthForPdf - marginsForPdf.left - marginsForPdf.right);
    var topYForPdf = pageHeightForPdf - marginsForPdf.top;
    var bottomYForPdf = marginsForPdf.bottom;

    var pagesForPdf = [];
    var pageForPdf = null;
    var yForPdf = topYForPdf;
    var stoppedForPdf = false;
    var imageObjectsForPdf = [];

    function newPageForPdf() {
      if (pagesForPdf.length >= MAX_PDF_PAGES_FOR_DOCUMENT_GENERATION) {
        if (!stoppedForPdf) contextForPdf.warnings.push('The PDF stopped at ' + MAX_PDF_PAGES_FOR_DOCUMENT_GENERATION + ' pages; the rest of the content was left out. Split it into several files.');
        stoppedForPdf = true;
        yForPdf = topYForPdf;
        return;
      }
      pageForPdf = { ops: [], annots: [], images: [] };
      pagesForPdf.push(pageForPdf);
      yForPdf = topYForPdf;
    }
    newPageForPdf();

    function pageIsEmptyForPdf() {
      return pageForPdf.ops.length === 0;
    }
    function ensureSpaceForPdf(heightForSpace) {
      if (yForPdf - heightForSpace < bottomYForPdf && !pageIsEmptyForPdf()) newPageForPdf();
    }
    function pushOpForPdf(opForPush, targetPageForPush) {
      if (stoppedForPdf) return;
      (targetPageForPush || pageForPdf).ops.push(opForPush);
    }
    function textOpForPdf(encodedForText, sizeForText, xForText, baselineForText, fontKeyForText, colorForText, targetPageForText) {
      pushOpForPdf({ kind: 'text', encoded: encodedForText, size: sizeForText, x: xForText, y: baselineForText, fontKey: fontKeyForText, color: colorForText || '000000' }, targetPageForText);
    }
    function fillRectForPdf(xForRect, yBottomForRect, widthForRect, heightForRect, colorForRect) {
      pushOpForPdf({
        kind: 'path',
        command: 'q ' + pdfColorOperandsForDocumentGeneration(colorForRect) + ' rg ' + xForRect.toFixed(2) + ' ' + yBottomForRect.toFixed(2) + ' '
          + widthForRect.toFixed(2) + ' ' + heightForRect.toFixed(2) + ' re f Q'
      });
    }
    // Each stroke sits inside its own q/Q so its width and colour cannot leak into the next one.
    function strokeLineForPdf(x1ForLine, y1ForLine, x2ForLine, y2ForLine, widthForLine, colorForLine, targetPageForLine) {
      pushOpForPdf({
        kind: 'path',
        command: 'q ' + Math.max(0.1, Number(widthForLine) || 0.5).toFixed(2) + ' w ' + pdfColorOperandsForDocumentGeneration(colorForLine) + ' RG '
          + x1ForLine.toFixed(2) + ' ' + y1ForLine.toFixed(2) + ' m ' + x2ForLine.toFixed(2) + ' ' + y2ForLine.toFixed(2) + ' l S Q'
      }, targetPageForLine);
    }
    function lineHeightForPdf(sizeForLineHeight) {
      return sizeForLineHeight * 1.2 * lookForPdf.spacing.line;
    }

    // Splits runs into lines no wider than widthForLayout. Each line holds segments that share a
    // font, size, colour and link, each with its offset from the line start.
    function layoutRunsForPdf(runsForLayout, optionsForLayout) {
      var baseSizeForLayout = optionsForLayout.size;
      var widthForLayout = Math.max(20, optionsForLayout.width);
      var linesForLayout = [];
      var currentForLayout = { segs: [], width: 0, maxSize: baseSizeForLayout };
      function pushLineForLayout() {
        while (currentForLayout.segs.length) {
          var lastSegForTrim = currentForLayout.segs[currentForLayout.segs.length - 1];
          var trimmedForTrim = lastSegForTrim.encoded.replace(/ +$/, '');
          if (trimmedForTrim === lastSegForTrim.encoded) break;
          var removedWidthForTrim = lastSegForTrim.width - measurePdfEncodedForDocumentGeneration(trimmedForTrim, lastSegForTrim.fontKey, lastSegForTrim.size);
          lastSegForTrim.encoded = trimmedForTrim;
          lastSegForTrim.width -= removedWidthForTrim;
          currentForLayout.width -= removedWidthForTrim;
          if (!trimmedForTrim) currentForLayout.segs.pop();
          else break;
        }
        linesForLayout.push(currentForLayout);
        currentForLayout = { segs: [], width: 0, maxSize: baseSizeForLayout };
      }
      function appendForLayout(encodedForAppend, styleForAppend, widthForAppend) {
        var lastSegForAppend = currentForLayout.segs[currentForLayout.segs.length - 1];
        if (lastSegForAppend && lastSegForAppend.fontKey === styleForAppend.fontKey && lastSegForAppend.size === styleForAppend.size
          && lastSegForAppend.color === styleForAppend.color && lastSegForAppend.href === styleForAppend.href
          && lastSegForAppend.highlight === styleForAppend.highlight) {
          lastSegForAppend.encoded += encodedForAppend;
          lastSegForAppend.width += widthForAppend;
        } else {
          currentForLayout.segs.push({
            encoded: encodedForAppend,
            fontKey: styleForAppend.fontKey,
            size: styleForAppend.size,
            color: styleForAppend.color,
            href: styleForAppend.href,
            highlight: styleForAppend.highlight,
            offset: currentForLayout.width,
            width: widthForAppend
          });
        }
        currentForLayout.width += widthForAppend;
        if (styleForAppend.size > currentForLayout.maxSize) currentForLayout.maxSize = styleForAppend.size;
      }
      (Array.isArray(runsForLayout) ? runsForLayout : [{ text: String(runsForLayout == null ? '' : runsForLayout) }]).forEach(function (runForLayout) {
        var safeRunForLayout = runForLayout || {};
        var hrefForLayout = (typeof safeRunForLayout.href === 'string' && safeRunForLayout.href) ? safeRunForLayout.href : '';
        var familyForLayout = safeRunForLayout.mono
          ? 'mono'
          : (safeRunForLayout.font ? pdfFamilyClassForDocumentGeneration(safeRunForLayout.font, optionsForLayout.family) : optionsForLayout.family);
        var styleForLayout = {
          fontKey: pdfFontKeyForDocumentGeneration(familyForLayout, !!(safeRunForLayout.bold || optionsForLayout.bold), !!(safeRunForLayout.italic || optionsForLayout.italic)),
          size: Number(safeRunForLayout.sizePt) || baseSizeForLayout,
          color: hrefForLayout ? colorsForPdf.link : (safeRunForLayout.color || optionsForLayout.color || colorsForPdf.text),
          href: hrefForLayout,
          highlight: safeRunForLayout.highlight || ''
        };
        String(safeRunForLayout.text == null ? '' : safeRunForLayout.text).split(/(\n)/).forEach(function (partForLayout) {
          if (partForLayout === '\n') { pushLineForLayout(); return; }
          if (!partForLayout) return;
          partForLayout.split(/(\s+)/).forEach(function (pieceForLayout) {
            if (!pieceForLayout) return;
            var isSpaceForLayout = /^\s+$/.test(pieceForLayout);
            var encodedForLayout = isSpaceForLayout ? ' ' : encodeWinAnsiForDocumentGeneration(pieceForLayout, trackerForPdf);
            var pieceWidthForLayout = measurePdfEncodedForDocumentGeneration(encodedForLayout, styleForLayout.fontKey, styleForLayout.size);
            if (isSpaceForLayout) {
              if (currentForLayout.width === 0) return;
              appendForLayout(encodedForLayout, styleForLayout, pieceWidthForLayout);
              return;
            }
            if (currentForLayout.width > 0 && currentForLayout.width + pieceWidthForLayout > widthForLayout) pushLineForLayout();
            // A word wider than the whole line is broken by character.
            while (pieceWidthForLayout > widthForLayout && encodedForLayout.length > 1) {
              var cutForLayout = encodedForLayout.length - 1;
              while (cutForLayout > 1 && measurePdfEncodedForDocumentGeneration(encodedForLayout.slice(0, cutForLayout), styleForLayout.fontKey, styleForLayout.size) > widthForLayout) cutForLayout--;
              var headForLayout = encodedForLayout.slice(0, cutForLayout);
              appendForLayout(headForLayout, styleForLayout, measurePdfEncodedForDocumentGeneration(headForLayout, styleForLayout.fontKey, styleForLayout.size));
              pushLineForLayout();
              encodedForLayout = encodedForLayout.slice(cutForLayout);
              pieceWidthForLayout = measurePdfEncodedForDocumentGeneration(encodedForLayout, styleForLayout.fontKey, styleForLayout.size);
            }
            appendForLayout(encodedForLayout, styleForLayout, pieceWidthForLayout);
          });
        });
      });
      if (currentForLayout.segs.length || !linesForLayout.length) pushLineForLayout();
      return linesForLayout;
    }

    // Draws laid-out lines from the cursor down, moving to a new page between lines when needed.
    // Returns the page and baseline of the first line, so a list marker can sit beside it.
    function drawLinesForPdf(linesForDraw, optionsForDraw) {
      var firstForDraw = null;
      linesForDraw.forEach(function (lineForDraw) {
        var lineHeightForDraw = lineHeightForPdf(lineForDraw.maxSize);
        ensureSpaceForPdf(lineHeightForDraw);
        var glyphBoxForDraw = lineForDraw.maxSize * 0.96;
        var baselineForDraw = yForPdf - (lineHeightForDraw - glyphBoxForDraw) / 2 - lineForDraw.maxSize * 0.75;
        var slackForDraw = Math.max(0, optionsForDraw.width - lineForDraw.width);
        var startXForDraw = optionsForDraw.x + (optionsForDraw.align === 'center' ? slackForDraw / 2 : (optionsForDraw.align === 'right' ? slackForDraw : 0));
        if (!firstForDraw) firstForDraw = { page: pageForPdf, baseline: baselineForDraw };
        if (optionsForDraw.leftBar) {
          fillRectForPdf(optionsForDraw.leftBar.x, yForPdf - lineHeightForDraw, optionsForDraw.leftBar.width, lineHeightForDraw, optionsForDraw.leftBar.color);
        }
        lineForDraw.segs.forEach(function (segForHighlight) {
          if (!segForHighlight.highlight) return;
          fillRectForPdf(startXForDraw + segForHighlight.offset, baselineForDraw - segForHighlight.size * 0.25, segForHighlight.width, segForHighlight.size * 1.15, segForHighlight.highlight);
        });
        lineForDraw.segs.forEach(function (segForDraw) {
          var xForSeg = startXForDraw + segForDraw.offset;
          textOpForPdf(segForDraw.encoded, segForDraw.size, xForSeg, baselineForDraw, segForDraw.fontKey, segForDraw.color);
          if (segForDraw.href && !stoppedForPdf) {
            strokeLineForPdf(xForSeg, baselineForDraw - 1.5, xForSeg + segForDraw.width, baselineForDraw - 1.5, 0.5, segForDraw.color);
            pageForPdf.annots.push({ href: segForDraw.href, rect: [xForSeg, baselineForDraw - 2.5, xForSeg + segForDraw.width, baselineForDraw + segForDraw.size] });
          }
        });
        yForPdf -= lineHeightForDraw;
      });
      return firstForDraw;
    }

    function linesHeightForPdf(linesForHeight) {
      return linesForHeight.reduce(function (sumForHeight, lineForHeight) { return sumForHeight + lineHeightForPdf(lineForHeight.maxSize); }, 0);
    }

    function paragraphForPdf(contentForParagraph, optionsForParagraph) {
      var safeOptionsForParagraph = optionsForParagraph || {};
      if (safeOptionsForParagraph.before && !pageIsEmptyForPdf()) yForPdf -= safeOptionsForParagraph.before;
      var indentForParagraph = safeOptionsForParagraph.indent || 0;
      var widthForParagraph = contentWidthForPdf - indentForParagraph - (safeOptionsForParagraph.indentRight || 0);
      var linesForParagraph = layoutRunsForPdf(contentForParagraph, {
        size: safeOptionsForParagraph.size || sizesForPdf.body,
        family: safeOptionsForParagraph.family || lookForPdf.families.body,
        bold: safeOptionsForParagraph.bold,
        italic: safeOptionsForParagraph.italic,
        color: safeOptionsForParagraph.color,
        width: widthForParagraph
      });
      if (safeOptionsForParagraph.keepWith) ensureSpaceForPdf(linesHeightForPdf(linesForParagraph) + safeOptionsForParagraph.keepWith);
      var firstForParagraph = drawLinesForPdf(linesForParagraph, {
        x: leftForPdf + indentForParagraph,
        width: widthForParagraph,
        align: safeOptionsForParagraph.align,
        leftBar: safeOptionsForParagraph.leftBar
      });
      yForPdf -= safeOptionsForParagraph.after || 0;
      return firstForParagraph;
    }

    function imageForPdf(jpegBytesForImg, wPxForImg, hPxForImg) {
      var naturalWPtForImg = Math.max(1, (Number(wPxForImg) || 1) * PDF_PX_TO_PT_FOR_DOCUMENT_GENERATION);
      var naturalHPtForImg = Math.max(1, (Number(hPxForImg) || 1) * PDF_PX_TO_PT_FOR_DOCUMENT_GENERATION);
      var scaleForImg = Math.min(1, contentWidthForPdf / naturalWPtForImg, (topYForPdf - bottomYForPdf) / naturalHPtForImg);
      var displayWidthForImg = naturalWPtForImg * scaleForImg;
      var displayHeightForImg = naturalHPtForImg * scaleForImg;
      ensureSpaceForPdf(displayHeightForImg);
      if (stoppedForPdf) return;
      var nameForImg = 'Im' + (imageObjectsForPdf.length + 1);
      imageObjectsForPdf.push({ jpegBytes: jpegBytesForImg, wPx: Math.max(1, Math.round(Number(wPxForImg) || 1)), hPx: Math.max(1, Math.round(Number(hPxForImg) || 1)), name: nameForImg });
      pageForPdf.images.push(nameForImg);
      var yBottomForImg = yForPdf - displayHeightForImg;
      pushOpForPdf({
        kind: 'path',
        command: 'q ' + displayWidthForImg.toFixed(2) + ' 0 0 ' + displayHeightForImg.toFixed(2) + ' ' + leftForPdf.toFixed(2) + ' ' + yBottomForImg.toFixed(2) + ' cm /' + nameForImg + ' Do Q'
      });
      yForPdf = yBottomForImg - 8;
    }

    function tableForPdf(blockForTable) {
      var plainRowsForTable = tableToPlainRowsForDocumentGeneration(blockForTable.rows);
      var gridForTable = expandTableGridForDocumentGeneration(blockForTable.rows);
      if (!plainRowsForTable.length || !gridForTable.colCount) return;
      if (plainRowsForTable.length > MAX_PDF_TABLE_ROWS_FOR_DOCUMENT_GENERATION) {
        contextForPdf.warnings.push('A table had ' + (plainRowsForTable.length + (gridForTable.rowsCut || 0)) + ' rows; the PDF keeps the first ' + MAX_PDF_TABLE_ROWS_FOR_DOCUMENT_GENERATION + '. Use XLSX or DOCX for the full table.');
        plainRowsForTable = plainRowsForTable.slice(0, MAX_PDF_TABLE_ROWS_FOR_DOCUMENT_GENERATION);
      }
      var isLayoutForTable = blockForTable.bordered === false && !blockForTable.borderSpec;
      var hasHeaderForTable = !isLayoutForTable && tableHasHeaderForDocumentGeneration(blockForTable, gridForTable);
      var colCountForTable = gridForTable.colCount;
      var bodySizeForTable = sizesForPdf.body;
      var sizeForTable = isLayoutForTable
        ? bodySizeForTable
        : Math.max(7, colCountForTable > 8 ? bodySizeForTable - 2.5 : (colCountForTable > 5 ? bodySizeForTable - 2 : bodySizeForTable - 1.5));
      var paddingForTable = isLayoutForTable ? { x: 0, right: 10, y: 2 } : { x: 5, right: 5, y: 4 };
      var familyForTable = lookForPdf.families.body;
      var regularKeyForTable = pdfFontKeyForDocumentGeneration(familyForTable, false, false);
      var boldKeyForTable = pdfFontKeyForDocumentGeneration(familyForTable, true, false);
      var cellLineHeightForTable = sizeForTable * 1.25;
      var alignmentsForTable = columnAlignmentsForDocumentGeneration(plainRowsForTable, hasHeaderForTable, blockForTable.align);
      var widthsForTable = computeTableColumnWidthsForDocumentGeneration(plainRowsForTable, contentWidthForPdf, blockForTable.columns, function (textForMeasure) {
        return measurePdfEncodedForDocumentGeneration(encodeWinAnsiForDocumentGeneration(textForMeasure, null), boldKeyForTable, sizeForTable)
          + paddingForTable.x + paddingForTable.right;
      }, alignmentsForTable);
      var styleForTable = blockForTable.borderSpec ? 'explicit' : (isLayoutForTable ? 'layout' : lookForPdf.table.style);
      var explicitSpecForTable = blockForTable.borderSpec || (styleForTable === 'source' ? tableBorderSpecForBlockForDocumentGeneration(blockForTable) : null);
      var hairlineColorForTable = colorsForPdf.tableBorder;
      var totalRowIndexForTable = (!isLayoutForTable && plainRowsForTable.length > (hasHeaderForTable ? 2 : 1)
        && isTotalRowForDocumentGeneration(plainRowsForTable[plainRowsForTable.length - 1])) ? plainRowsForTable.length - 1 : -1;

      // One entry per real cell in the row: its column span, text lines and alignment.
      function layoutRowForTable(rowIndexForLayout) {
        var descriptorsForLayout = gridForTable.rows[rowIndexForLayout] || [];
        var isHeaderRowForLayout = hasHeaderForTable && rowIndexForLayout === 0;
        var isTotalRowForLayout = rowIndexForLayout === totalRowIndexForTable;
        var cellsForLayout = [];
        var columnForLayout = 0;
        var maxLinesForLayout = 1;
        descriptorsForLayout.forEach(function (descriptorForLayout) {
          var spanForLayout = Math.max(1, Number(descriptorForLayout.colSpan) || 1);
          var widthForLayout = 0;
          for (var spanIndexForLayout = 0; spanIndexForLayout < spanForLayout; spanIndexForLayout++) widthForLayout += widthsForTable[columnForLayout + spanIndexForLayout] || 0;
          var isHeaderCellForLayout = !isLayoutForTable && (isHeaderRowForLayout || !!descriptorForLayout.header);
          var boldForLayout = isHeaderCellForLayout || isTotalRowForLayout
            || (blockForTable.keyValue && columnForLayout === 0) || (isLayoutForTable && !!descriptorForLayout.header);
          var colorForLayout = descriptorForLayout.color
            || (isHeaderCellForLayout && !blockForTable.borderSpec ? colorsForPdf.tableHeaderText : '')
            || (blockForTable.keyValue && columnForLayout === 0 ? colorsForPdf.muted : '')
            || colorsForPdf.text;
          var textForLayout = descriptorForLayout.kind === 'cell' ? plainTextFromTableCellForDocumentGeneration(descriptorForLayout) : '';
          var linesForCell = layoutRunsForPdf([{ text: textForLayout }], {
            size: sizeForTable,
            family: familyForTable,
            bold: boldForLayout,
            color: colorForLayout,
            width: widthForLayout - paddingForTable.x - paddingForTable.right
          });
          if (!textForLayout) linesForCell = [];
          maxLinesForLayout = Math.max(maxLinesForLayout, linesForCell.length);
          cellsForLayout.push({
            x: columnForLayout,
            width: widthForLayout,
            lines: linesForCell,
            align: descriptorForLayout.align || alignmentsForTable[columnForLayout] || 'left',
            fill: descriptorForLayout.fill || ''
          });
          columnForLayout += spanForLayout;
        });
        return {
          cells: cellsForLayout,
          height: maxLinesForLayout * cellLineHeightForTable + paddingForTable.y * 2,
          isHeader: isHeaderRowForLayout,
          isTotal: isTotalRowForLayout
        };
      }

      function columnXForTable(columnIndexForX) {
        var xForColumn = leftForPdf;
        for (var iForColumn = 0; iForColumn < columnIndexForX; iForColumn++) xForColumn += widthsForTable[iForColumn];
        return xForColumn;
      }

      var bodyRowCounterForTable = 0;
      function drawRowForTable(rowForDraw, rowIndexForDraw, isLastRowForDraw) {
        var topForDraw = yForPdf;
        var bottomForDraw = yForPdf - rowForDraw.height;
        var rightForDraw = leftForPdf + contentWidthForPdf;
        var rowFillForDraw = '';
        if (!isLayoutForTable && !blockForTable.borderSpec) {
          if (rowForDraw.isHeader) rowFillForDraw = colorsForPdf.tableHeaderFill || '';
          else if (lookForPdf.table.zebra && bodyRowCounterForTable % 2 === 1 && !rowForDraw.isTotal) rowFillForDraw = colorsForPdf.tableStripe;
        }
        if (!rowForDraw.isHeader) bodyRowCounterForTable++;
        if (rowFillForDraw) fillRectForPdf(leftForPdf, bottomForDraw, contentWidthForPdf, rowForDraw.height, rowFillForDraw);
        rowForDraw.cells.forEach(function (cellForFill) {
          if (cellForFill.fill) fillRectForPdf(columnXForTable(cellForFill.x), bottomForDraw, cellForFill.width, rowForDraw.height, cellForFill.fill);
        });
        rowForDraw.cells.forEach(function (cellForText) {
          var cellXForText = columnXForTable(cellForText.x);
          cellForText.lines.forEach(function (lineForCell, lineIndexForCell) {
            var innerWidthForCell = cellForText.width - paddingForTable.x - paddingForTable.right;
            var slackForCell = Math.max(0, innerWidthForCell - lineForCell.width);
            var lineXForCell = cellXForText + paddingForTable.x
              + (cellForText.align === 'right' ? slackForCell : (cellForText.align === 'center' ? slackForCell / 2 : 0));
            var baselineForCell = topForDraw - paddingForTable.y - sizeForTable * 0.95 - lineIndexForCell * cellLineHeightForTable;
            lineForCell.segs.forEach(function (segForCell) {
              textOpForPdf(segForCell.encoded, segForCell.size, lineXForCell + segForCell.offset, baselineForCell, segForCell.fontKey, segForCell.color);
            });
          });
        });
        if (styleForTable === 'header-fill' || styleForTable === 'lines') {
          if (rowForDraw.isHeader && styleForTable === 'lines') strokeLineForPdf(leftForPdf, bottomForDraw, rightForDraw, bottomForDraw, 1.5, colorsForPdf.tableHeaderRule);
          else if (!rowForDraw.isHeader) strokeLineForPdf(leftForPdf, bottomForDraw, rightForDraw, bottomForDraw, 0.5, hairlineColorForTable);
        } else if (styleForTable === 'booktabs') {
          if (rowIndexForDraw === 0 || rowForDraw.repeatedHeader) strokeLineForPdf(leftForPdf, topForDraw, rightForDraw, topForDraw, 1, colorsForPdf.tableBorder);
          if (rowForDraw.isHeader) strokeLineForPdf(leftForPdf, bottomForDraw, rightForDraw, bottomForDraw, 0.75, colorsForPdf.tableHeaderRule);
          if (isLastRowForDraw) strokeLineForPdf(leftForPdf, bottomForDraw, rightForDraw, bottomForDraw, 1, colorsForPdf.tableBorder);
        } else if (styleForTable === 'grid') {
          rowForDraw.cells.forEach(function (cellForGrid) {
            var xLeftForGrid = columnXForTable(cellForGrid.x);
            var xRightForGrid = xLeftForGrid + cellForGrid.width;
            strokeLineForPdf(xLeftForGrid, topForDraw, xRightForGrid, topForDraw, 0.5, hairlineColorForTable);
            strokeLineForPdf(xLeftForGrid, bottomForDraw, xRightForGrid, bottomForDraw, 0.5, hairlineColorForTable);
            strokeLineForPdf(xLeftForGrid, topForDraw, xLeftForGrid, bottomForDraw, 0.5, hairlineColorForTable);
            strokeLineForPdf(xRightForGrid, topForDraw, xRightForGrid, bottomForDraw, 0.5, hairlineColorForTable);
          });
        } else if (explicitSpecForTable) {
          // Only the top and left of each cell are drawn, plus the closing bottom and right of the
          // last row and column, so a shared gridline is never stroked twice at two widths.
          rowForDraw.cells.forEach(function (cellForEdge, cellIndexForEdge) {
            var xLeftForEdge = columnXForTable(cellForEdge.x);
            var xRightForEdge = xLeftForEdge + cellForEdge.width;
            var isLastColForEdge = cellIndexForEdge === rowForDraw.cells.length - 1;
            function edgeForTable(edgeSpecForTable, x1ForEdge, y1ForEdge, x2ForEdge, y2ForEdge) {
              if (edgeSpecForTable) strokeLineForPdf(x1ForEdge, y1ForEdge, x2ForEdge, y2ForEdge, edgeSpecForTable.widthPt || 0.5, edgeSpecForTable.color || '000000');
            }
            edgeForTable(rowIndexForDraw === 0 || rowForDraw.repeatedHeader ? explicitSpecForTable.top : explicitSpecForTable.insideH, xLeftForEdge, topForDraw, xRightForEdge, topForDraw);
            edgeForTable(cellForEdge.x === 0 ? explicitSpecForTable.left : explicitSpecForTable.insideV, xLeftForEdge, topForDraw, xLeftForEdge, bottomForDraw);
            if (isLastRowForDraw) edgeForTable(explicitSpecForTable.bottom, xLeftForEdge, bottomForDraw, xRightForEdge, bottomForDraw);
            if (isLastColForEdge) edgeForTable(explicitSpecForTable.right, xRightForEdge, topForDraw, xRightForEdge, bottomForDraw);
          });
        }
        if (rowForDraw.isTotal && !isLayoutForTable && !blockForTable.borderSpec) {
          strokeLineForPdf(leftForPdf, topForDraw, rightForDraw, topForDraw, 1, colorsForPdf.tableHeaderRule);
        }
        yForPdf = bottomForDraw;
      }

      var captionForTable = typeof blockForTable.caption === 'string' ? blockForTable.caption.trim() : '';
      var headerRowForTable = hasHeaderForTable ? layoutRowForTable(0) : null;
      var firstBodyRowForTable = layoutRowForTable(hasHeaderForTable ? Math.min(1, plainRowsForTable.length - 1) : 0);
      // Keep the caption, the header and the first body row together.
      var keepTogetherForTable = (headerRowForTable ? headerRowForTable.height : 0) + firstBodyRowForTable.height;
      if (captionForTable) {
        paragraphForPdf(captionForTable, { size: sizesForPdf.small, bold: true, color: colorsForPdf.muted, before: 4, after: 3, keepWith: keepTogetherForTable });
      } else {
        ensureSpaceForPdf(keepTogetherForTable);
      }
      for (var rowIndexForTable = 0; rowIndexForTable < plainRowsForTable.length && !stoppedForPdf; rowIndexForTable++) {
        var rowForTable = rowIndexForTable === 0 && headerRowForTable ? headerRowForTable : layoutRowForTable(rowIndexForTable);
        if (yForPdf - rowForTable.height < bottomYForPdf && !pageIsEmptyForPdf()) {
          newPageForPdf();
          if (headerRowForTable && rowIndexForTable > 0) {
            var repeatedHeaderForTable = Object.assign({}, headerRowForTable, { repeatedHeader: true });
            drawRowForTable(repeatedHeaderForTable, 0, false);
          }
        }
        drawRowForTable(rowForTable, rowIndexForTable, rowIndexForTable === plainRowsForTable.length - 1);
      }
      yForPdf -= Math.max(10, lookForPdf.spacing.after + 4);
    }

    // Each list element (entry key) counts on its own. Within one element, an item resets the
    // counters of the levels below it, as Word does for a bullet or numbered block's nested items.
    function listForPdf(flatItemsForList) {
      var countersByKeyForList = {};
      flatItemsForList.forEach(function (itemForList, indexForList) {
        var levelForList = Math.max(0, Math.min(2, Number(itemForList.level) || 0));
        var orderedForList = !!itemForList.ordered;
        var keyForList = String(itemForList.key || 0);
        var countersForList = countersByKeyForList[keyForList] || (countersByKeyForList[keyForList] = [0, 0, 0]);
        countersForList[levelForList]++;
        for (var resetForList = levelForList + 1; resetForList < countersForList.length; resetForList++) countersForList[resetForList] = 0;
        var markerTextForList = orderedForList
          ? (levelForList === 0 ? String(countersForList[0]) : (levelForList === 1 ? String.fromCharCode(96 + Math.min(26, countersForList[1])) : ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][Math.min(9, countersForList[2] - 1)])) + '.'
          : ['\u2022', '\u2013', '\u00B7'][levelForList];
        var markerIndentForList = 4 + levelForList * 18;
        var textIndentForList = markerIndentForList + (orderedForList ? 18 : 14);
        var firstForList = paragraphForPdf(itemForList.runs || itemForList.text, {
          indent: textIndentForList,
          after: indexForList === flatItemsForList.length - 1 ? lookForPdf.spacing.after : 2.5
        });
        if (!firstForList) return;
        var markerEncodedForList = encodeWinAnsiForDocumentGeneration(markerTextForList, null);
        var markerKeyForList = pdfFontKeyForDocumentGeneration(lookForPdf.families.body, false, false);
        var markerWidthForList = measurePdfEncodedForDocumentGeneration(markerEncodedForList, markerKeyForList, sizesForPdf.body);
        var markerXForList = orderedForList
          ? leftForPdf + textIndentForList - 5 - markerWidthForList
          : leftForPdf + markerIndentForList;
        textOpForPdf(markerEncodedForList, sizesForPdf.body, markerXForList, firstForList.baseline, markerKeyForList,
          orderedForList ? colorsForPdf.text : (colorsForPdf.accentText || colorsForPdf.accent), firstForList.page);
      });
    }

    function calloutForPdf(blockForCallout) {
      var themesForCallout = agentNamespaceForDocumentGeneration.documentThemes;
      var toneForCallout = (lookForPdf.themed && themesForCallout)
        ? themesForCallout.calloutColors(lookForPdf.theme, blockForCallout.tone)
        : { bar: colorsForPdf.rule, fill: colorsForPdf.calloutFill, title: colorsForPdf.text };
      var piecesForCallout = [];
      var titleForCallout = typeof blockForCallout.title === 'string' ? blockForCallout.title.trim() : '';
      if (titleForCallout) piecesForCallout.push({ content: titleForCallout, bold: true, color: toneForCallout.title });
      calloutParagraphsForDocumentGeneration(blockForCallout).forEach(function (contentForPiece) {
        piecesForCallout.push({ content: contentForPiece, bold: false, color: '' });
      });
      if (!piecesForCallout.length) return;
      var barWidthForCallout = 3;
      var paddingForCallout = 9;
      var innerIndentForCallout = barWidthForCallout + paddingForCallout + 2;
      var innerWidthForCallout = contentWidthForPdf - innerIndentForCallout - paddingForCallout;
      var laidOutForCallout = piecesForCallout.map(function (pieceForLayout) {
        return layoutRunsForPdf(pieceForLayout.content, {
          size: sizesForPdf.body,
          family: lookForPdf.families.body,
          bold: pieceForLayout.bold,
          color: pieceForLayout.color,
          width: innerWidthForCallout
        });
      });
      var gapForCallout = 3;
      var textHeightForCallout = laidOutForCallout.reduce(function (sumForCallout, linesForCallout) {
        return sumForCallout + linesHeightForPdf(linesForCallout);
      }, 0) + gapForCallout * (laidOutForCallout.length - 1);
      var boxHeightForCallout = textHeightForCallout + paddingForCallout * 2;
      if (!pageIsEmptyForPdf()) yForPdf -= 6;
      // A callout taller than a page is drawn without its box rather than split across pages.
      var fitsOnPageForCallout = boxHeightForCallout <= topYForPdf - bottomYForPdf;
      if (fitsOnPageForCallout) {
        ensureSpaceForPdf(boxHeightForCallout);
        fillRectForPdf(leftForPdf, yForPdf - boxHeightForCallout, contentWidthForPdf, boxHeightForCallout, toneForCallout.fill);
        fillRectForPdf(leftForPdf, yForPdf - boxHeightForCallout, barWidthForCallout, boxHeightForCallout, toneForCallout.bar);
        yForPdf -= paddingForCallout;
      }
      laidOutForCallout.forEach(function (linesForDraw, indexForDraw) {
        drawLinesForPdf(linesForDraw, { x: leftForPdf + innerIndentForCallout, width: innerWidthForCallout, align: 'left' });
        if (indexForDraw < laidOutForCallout.length - 1) yForPdf -= gapForCallout;
      });
      if (fitsOnPageForCallout) yForPdf -= paddingForCallout;
      yForPdf -= Math.max(10, lookForPdf.spacing.after + 2);
    }

    blocksForPdf.forEach(function (blockForPdf) {
      if (stoppedForPdf) return;
      var typeForPdf = blockForPdf.type;
      var alignForPdf = typeof blockForPdf.align === 'string' ? blockForPdf.align.toLowerCase() : '';
      if (typeForPdf === 'image') {
        var resolvedImageForPdf = blockForPdf.resolved || {};
        if (resolvedImageForPdf.jpegBytes && resolvedImageForPdf.jpegBytes.length) {
          imageForPdf(resolvedImageForPdf.jpegBytes, resolvedImageForPdf.wPx, resolvedImageForPdf.hPx);
        }
        return;
      }
      if (typeForPdf === 'table') {
        tableForPdf(blockForPdf);
        return;
      }
      if (typeForPdf === 'key_value') {
        var pairsForPdf = (Array.isArray(blockForPdf.rows) ? blockForPdf.rows : []).map(function (pairForPdf) {
          if (Array.isArray(pairForPdf)) return [pairForPdf[0], pairForPdf.slice(1).join(' ')];
          if (pairForPdf && typeof pairForPdf === 'object') return [pairForPdf.label, pairForPdf.value];
          return [String(pairForPdf == null ? '' : pairForPdf), ''];
        });
        if (pairsForPdf.length) {
          tableForPdf({ rows: pairsForPdf, bordered: false, keyValue: true, columns: Array.isArray(blockForPdf.columns) ? blockForPdf.columns : [30, 70] });
        }
        return;
      }
      if (typeForPdf === 'title') {
        var subtitleForPdf = typeof blockForPdf.subtitle === 'string' ? blockForPdf.subtitle.trim() : '';
        var titleAlignForPdf = alignForPdf || lookForPdf.title.align;
        paragraphForPdf(blockContentForDocumentGeneration(blockForPdf), {
          size: sizesForPdf.title, family: lookForPdf.families.heading, bold: true, color: colorsForPdf.heading,
          align: titleAlignForPdf, after: subtitleForPdf ? 4 : 10
        });
        if (subtitleForPdf) {
          paragraphForPdf(subtitleForPdf, { size: sizesForPdf.subtitle, color: colorsForPdf.muted, align: titleAlignForPdf, after: 8 });
        }
        if (lookForPdf.title.rule) {
          strokeLineForPdf(leftForPdf, yForPdf, leftForPdf + contentWidthForPdf, yForPdf, 1.5, colorsForPdf.accent);
          yForPdf -= 18;
        } else {
          yForPdf -= 10;
        }
        return;
      }
      if (typeForPdf === 'subtitle') {
        paragraphForPdf(blockContentForDocumentGeneration(blockForPdf), { size: sizesForPdf.subtitle, color: colorsForPdf.muted, align: alignForPdf || lookForPdf.title.align, after: 14 });
        return;
      }
      if (typeForPdf === 'heading') {
        var levelForPdf = Math.max(1, Math.min(6, Number(blockForPdf.level) || 1));
        // Keep a heading with at least two lines of what follows it.
        paragraphForPdf(blockContentForDocumentGeneration(blockForPdf), {
          size: sizesForPdf.headings[levelForPdf - 1],
          family: lookForPdf.families.heading,
          bold: true,
          italic: levelForPdf >= 4,
          color: colorsForPdf.heading,
          align: alignForPdf,
          before: lookForPdf.spacing.headingBefore[levelForPdf - 1],
          after: lookForPdf.spacing.headingAfter[levelForPdf - 1],
          keepWith: lineHeightForPdf(sizesForPdf.body) * 2 + lookForPdf.spacing.headingAfter[levelForPdf - 1]
        });
        return;
      }
      if (typeForPdf === 'bullet' || typeForPdf === 'numbered' || typeForPdf === 'list') {
        listForPdf(listEntriesForDocumentGeneration(blockForPdf));
        return;
      }
      if (typeForPdf === 'callout') {
        calloutForPdf(blockForPdf);
        return;
      }
      if (typeForPdf === 'quote') {
        var citeForPdf = typeof blockForPdf.cite === 'string' ? blockForPdf.cite.trim() : '';
        var quoteBarForPdf = { x: leftForPdf + 2, width: 2.5, color: colorsForPdf.rule };
        paragraphForPdf(blockContentForDocumentGeneration(blockForPdf), {
          italic: true, color: colorsForPdf.muted, indent: 18, indentRight: 18, before: 4,
          after: citeForPdf ? 0 : lookForPdf.spacing.after + 4, leftBar: quoteBarForPdf
        });
        if (citeForPdf) {
          paragraphForPdf(citeForPdf, { size: sizesForPdf.small, color: colorsForPdf.muted, indent: 18, indentRight: 18, align: 'right', after: lookForPdf.spacing.after + 4 });
        }
        return;
      }
      if (typeForPdf === 'divider') {
        ensureSpaceForPdf(16);
        yForPdf -= 4;
        strokeLineForPdf(leftForPdf, yForPdf, leftForPdf + contentWidthForPdf, yForPdf, 0.75, colorsForPdf.rule);
        yForPdf -= 14;
        return;
      }
      if (typeForPdf === 'page_break') {
        if (!pageIsEmptyForPdf()) newPageForPdf();
        return;
      }
      paragraphForPdf(blockContentForDocumentGeneration(blockForPdf), { align: alignForPdf, after: lookForPdf.spacing.after });
    });

    // Running header and page numbers, drawn once every page exists so the total is known.
    var pageCountForPdf = pagesForPdf.length;
    var smallKeyForPdf = pdfFontKeyForDocumentGeneration(lookForPdf.families.body, false, false);
    pagesForPdf.forEach(function (pageForChrome, pageIndexForChrome) {
      if (lookForPdf.themed && contextForPdf.pageNumbers) {
        var withTotalForChrome = lookForPdf.theme.footer === 'page-x-of-y';
        var numberTextForChrome = withTotalForChrome ? (pageIndexForChrome + 1) + ' / ' + pageCountForPdf : String(pageIndexForChrome + 1);
        var numberWidthForChrome = measurePdfEncodedForDocumentGeneration(numberTextForChrome, smallKeyForPdf, sizesForPdf.small);
        var numberXForChrome = withTotalForChrome
          ? leftForPdf + contentWidthForPdf - numberWidthForChrome
          : leftForPdf + (contentWidthForPdf - numberWidthForChrome) / 2;
        pageForChrome.ops.push({ kind: 'text', encoded: numberTextForChrome, size: sizesForPdf.small, x: numberXForChrome, y: Math.max(18, marginsForPdf.bottom / 2), fontKey: smallKeyForPdf, color: colorsForPdf.muted });
      }
      if (lookForPdf.themed && contextForPdf.headerText) {
        var headerEncodedForChrome = encodeWinAnsiForDocumentGeneration(contextForPdf.headerText, trackerForPdf);
        var headerWidthForChrome = measurePdfEncodedForDocumentGeneration(headerEncodedForChrome, smallKeyForPdf, sizesForPdf.small);
        pageForChrome.ops.push({
          kind: 'text', encoded: headerEncodedForChrome, size: sizesForPdf.small,
          x: leftForPdf + contentWidthForPdf - headerWidthForChrome, y: pageHeightForPdf - Math.max(18, marginsForPdf.top / 2),
          fontKey: smallKeyForPdf, color: colorsForPdf.muted
        });
      }
    });
    var charWarningForPdf = trackerForPdf.warning();
    if (charWarningForPdf) contextForPdf.warnings.push(charWarningForPdf);

    var objectsForPdf = [];
    function addObjectForPdf(contentForPdf) {
      objectsForPdf.push(String(contentForPdf));
      return objectsForPdf.length;
    }

    var catalogIdForPdf = addObjectForPdf('');
    var pagesIdForPdf = addObjectForPdf('');
    // All twelve are base-14 fonts, so each costs one small object and needs no embedding.
    var PDF_BASE_FONTS_FOR_PDF = [
      'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
      'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
      'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'
    ];
    // Explicit widths make every viewer advance each glyph by exactly what the layout measured.
    // Without them a viewer falls back on its own metrics, and older built-in Helvetica metrics
    // have no euro sign, so "€4" overlaps.
    var fontResourceEntriesForPdf = PDF_BASE_FONTS_FOR_PDF.map(function (baseFontNameForPdf, fontIndexForPdf) {
      var fontKeyForWidths = 'F' + (fontIndexForPdf + 1);
      var widthsForFont = [];
      for (var codeForWidths = 32; codeForWidths <= 255; codeForWidths++) {
        widthsForFont.push(Math.round(measurePdfEncodedForDocumentGeneration(String.fromCharCode(codeForWidths), fontKeyForWidths, 1000)));
      }
      var fontObjIdForPdf = addObjectForPdf('<< /Type /Font /Subtype /Type1 /BaseFont /' + baseFontNameForPdf
        + ' /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [' + widthsForFont.join(' ') + '] >>');
      return '/' + fontKeyForWidths + ' ' + fontObjIdForPdf + ' 0 R';
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

    pagesForPdf.forEach(function (pageForSerialize) {
      var streamForPdf = pageForSerialize.ops.map(function (opForPdf) {
        if (opForPdf.kind === 'path') return opForPdf.command;
        return 'BT /' + (opForPdf.fontKey || 'F1') + ' ' + Number(opForPdf.size).toFixed(2) + ' Tf '
          + pdfColorOperandsForDocumentGeneration(opForPdf.color) + ' rg '
          + opForPdf.x.toFixed(2) + ' ' + opForPdf.y.toFixed(2) + ' Td ('
          + pdfEscapeEncodedForDocumentGeneration(opForPdf.encoded) + ') Tj ET';
      }).join('\n');
      var contentIdForPdf = addObjectForPdf('<< /Length ' + streamForPdf.length + ' >>\nstream\n' + streamForPdf + '\nendstream');
      var annotRefsForPdf = pageForSerialize.annots.map(function (annotForPdf) {
        var rectForPdf = annotForPdf.rect;
        return addObjectForPdf('<< /Type /Annot /Subtype /Link /Rect [' +
          rectForPdf[0].toFixed(2) + ' ' + rectForPdf[1].toFixed(2) + ' ' + rectForPdf[2].toFixed(2) + ' ' + rectForPdf[3].toFixed(2) +
          '] /Border [0 0 0] /A << /S /URI /URI (' + pdfSafeTextForDocumentGeneration(annotForPdf.href) + ') >> >>') + ' 0 R';
      });
      var annotsEntryForPdf = annotRefsForPdf.length ? ' /Annots [' + annotRefsForPdf.join(' ') + ']' : '';
      var xobjectEntryForPdf = pageForSerialize.images.length
        ? ' /XObject << ' + pageForSerialize.images.map(function (nameForXobj) {
            return '/' + nameForXobj + ' ' + imageNameToObjIdForPdf[nameForXobj] + ' 0 R';
          }).join(' ') + ' >>'
        : '';
      pageIdsForPdf.push(addObjectForPdf('<< /Type /Page /Parent ' + pagesIdForPdf +
        ' 0 R /MediaBox [0 0 ' + pageWidthForPdf.toFixed(2) + ' ' + pageHeightForPdf.toFixed(2) + ']' +
        ' /Resources << /Font << ' + fontResourceEntriesForPdf + ' >>' + xobjectEntryForPdf +
        ' >> /Contents ' + contentIdForPdf + ' 0 R' + annotsEntryForPdf + ' >>'));
    });

    objectsForPdf[catalogIdForPdf - 1] = '<< /Type /Catalog /Pages ' + pagesIdForPdf + ' 0 R >>';
    objectsForPdf[pagesIdForPdf - 1] = '<< /Type /Pages /Kids [' + pageIdsForPdf.map(function (idForPdf) { return idForPdf + ' 0 R'; }).join(' ') + '] /Count ' + pageIdsForPdf.length + ' >>';
    var titleForInfo = lookForPdf.themed ? String(inputForDocumentGeneration.title || '').trim() : '';
    var infoIdForPdf = titleForInfo ? addObjectForPdf('<< /Title ' + pdfUnicodeHexStringForDocumentGeneration(titleForInfo.slice(0, 300)) + ' >>') : 0;

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
    outputForPdf += 'trailer\n<< /Size ' + (objectsForPdf.length + 1) + ' /Root ' + catalogIdForPdf + ' 0 R'
      + (infoIdForPdf ? ' /Info ' + infoIdForPdf + ' 0 R' : '') + ' >>\nstartxref\n' + xrefOffsetForPdf + '\n%%EOF';
    // latin1 encode: every char is a single byte (WinAnsi text plus the spliced binary image
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

  // ---- PPTX ----
  // A 16:9 deck on a real slide master. Eight layouts (title, section, title and content, two
  // content, title only, blank, and a picture beside text on either side) carry the theme's fonts
  // and colours through the theme part, so PowerPoint's New Slide and Layout menus work on the
  // file and a theme change made in PowerPoint recolours it. Text sizes are chosen here by
  // measuring the text, because PowerPoint shrinks overflowing text only once someone edits it,
  // not when it opens a file. Pictures come from the conversation's attachments by blob id.

  var PPTX_EMU_PER_PT_FOR_DOCUMENT_GENERATION = 12700;
  var PPTX_MAX_BULLETS_FOR_DOCUMENT_GENERATION = 12;
  var PPTX_MAX_COLUMN_BULLETS_FOR_DOCUMENT_GENERATION = 8;
  var PPTX_MAX_IMAGE_BULLETS_FOR_DOCUMENT_GENERATION = 8;
  var PPTX_MAX_STATS_FOR_DOCUMENT_GENERATION = 4;
  var PPTX_MAX_TABLE_COLUMNS_FOR_DOCUMENT_GENERATION = 8;
  var PPTX_MAX_NOTES_CHARS_FOR_DOCUMENT_GENERATION = 10000;
  var PPTX_MAX_IMAGES_FOR_DOCUMENT_GENERATION = 50;
  // A picture larger than either limit is drawn smaller and written again.
  var PPTX_MAX_IMAGE_SIDE_FOR_DOCUMENT_GENERATION = 2560;
  var PPTX_MAX_IMAGE_BYTES_FOR_DOCUMENT_GENERATION = 3 * 1024 * 1024;
  var PPTX_LAYOUTS_FOR_DOCUMENT_GENERATION = ['title', 'section', 'bullets', 'two_column', 'big_number', 'table', 'image'];
  var PPTX_PATTERNS_FOR_DOCUMENT_GENERATION = ['dots', 'grid', 'diagonal', 'waves'];
  var PPTX_LAYOUT_PART_COUNT_FOR_DOCUMENT_GENERATION = 8;
  // The slide layout part (ppt/slideLayouts/slideLayoutN.xml) a slide uses. Big numbers and
  // tables sit on Title Only and draw their own shapes. A picture beside text has a layout for
  // each side; a picture under a title fills the content placeholder of Title and Content, and
  // a picture on its own goes on Blank.
  function pptxLayoutPartForDocumentGeneration(slide) {
    if (slide.layout === 'image') {
      if (slide.imageVariant === 'half') return slide.image.side === 'left' ? 8 : 7;
      return slide.imageVariant === 'below' ? 3 : 6;
    }
    return { title: 1, section: 2, bullets: 3, two_column: 4, big_number: 5, table: 5 }[slide.layout];
  }
  var PPTX_NS_FOR_DOCUMENT_GENERATION = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  var PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var PPTX_SLIDENUM_FIELD_ID_FOR_DOCUMENT_GENERATION = '{5B9C2E61-3F0A-4C8D-9E7B-1A2D3C4E5F60}';
  // Areas in points on the 960 x 540 pt slide (13.33 x 7.5 in, PowerPoint's own 16:9 size).
  var PPTX_BOX_FOR_DOCUMENT_GENERATION = {
    title: { x: 54, y: 30, w: 852, h: 88 },
    rule: { x: 54, y: 126, w: 56, h: 4 },
    body: { x: 54, y: 148, w: 852, h: 338 },
    left: { x: 54, y: 148, w: 408, h: 338 },
    right: { x: 498, y: 148, w: 408, h: 338 },
    number: { x: 806, y: 500, w: 100, h: 22 },
    coverTitle: { x: 72, y: 140, w: 816, h: 180 },
    coverRule: { x: 72, y: 336, w: 72, h: 5 },
    coverSubtitle: { x: 72, y: 356, w: 816, h: 100 },
    coverBand: { x: 0, y: 522, w: 960, h: 18 },
    sectionTitle: { x: 96, y: 160, w: 768, h: 150 },
    sectionSubtitle: { x: 96, y: 336, w: 768, h: 90 },
    sectionRule: { x: 444, y: 320, w: 72, h: 4 },
    sectionBar: { x: 72, y: 168, w: 6, h: 236 },
    notesImage: { x: 48, y: 54, w: 444, h: 250 },
    notesBody: { x: 54, y: 330, w: 432, h: 330 },
    fullSlide: { x: 0, y: 0, w: 960, h: 540 }
  };
  // Sizes in points, largest first. A text takes the largest size at which it fits its box.
  var PPTX_SIZES_FOR_DOCUMENT_GENERATION = {
    title: [36, 32, 28, 24],
    body: [24, 22, 20, 18, 16, 14],
    column: [22, 20, 18, 16, 14],
    coverTitle: [54, 48, 44, 40, 36, 32],
    coverSubtitle: [24, 22, 20, 18],
    sectionTitle: [44, 40, 36, 32, 28],
    sectionSubtitle: [22, 20, 18, 16],
    statLabel: [22, 20, 18, 16, 14],
    table: [18, 16, 14, 12, 11, 10]
  };
  var PPTX_BULLET_MARK_RE_FOR_DOCUMENT_GENERATION = /^\s*[-*\u2022\u2023\u25e6\u2013\u2014\u00b7]\s+/;
  // Used when the theme module is not loaded (tests that load the generator alone).
  var PPTX_FALLBACK_THEME_FOR_DOCUMENT_GENERATION = {
    name: 'professional',
    fonts: { heading: { office: 'Calibri', kind: 'sans' }, body: { office: 'Calibri', kind: 'sans' }, mono: { office: 'Consolas', kind: 'mono' } },
    colors: {
      text: '1F2328', muted: '5B6470', heading: '1F3864', primary: '1F3864', accent: '2E75B6', accentText: '2E75B6', link: '2E75B6',
      tableBorder: 'CED3DD', tableHeaderFill: '1F3864', tableHeaderText: 'FFFFFF', tableHeaderRule: '1F3864', tableStripe: 'EFF1F4'
    },
    title: { align: 'left', rule: true },
    table: { style: 'header-fill', zebra: true },
    deck: { cover: 'fill' }
  };

  function pptxEmuForDocumentGeneration(points) {
    return Math.round(points * PPTX_EMU_PER_PT_FOR_DOCUMENT_GENERATION);
  }
  // Slide text, escaped for XML, with control characters and unpaired surrogates removed.
  function pptxTextForDocumentGeneration(value) {
    return xlsxEscapeForDocumentGeneration(value);
  }
  function pptxTintForDocumentGeneration(hex, amount) {
    var themes = agentNamespaceForDocumentGeneration.documentThemes;
    return themes && themes.tintHexColor ? themes.tintHexColor(hex, amount) : hex;
  }

  // ---- Measuring ----

  // Approximate advance widths in em. They lean wide, so a fitted slide has room to spare rather
  // than a line that overflows in a slightly wider font.
  function pptxCharEmForDocumentGeneration(ch, kind) {
    if (kind === 'mono') return 0.6;
    if (ch === ' ') return 0.28;
    var code = ch.charCodeAt(0);
    if (code >= 0x2E80) return 1.0;
    if ('iljtfrI.,;:!|\'"`()[]'.indexOf(ch) !== -1) return 0.32;
    if ('mwMW@%'.indexOf(ch) !== -1) return 0.86;
    if (ch >= 'A' && ch <= 'Z') return 0.66;
    if (ch >= '0' && ch <= '9') return 0.56;
    return 0.53;
  }
  function pptxTextWidthForDocumentGeneration(text, size, kind, bold) {
    var em = 0;
    for (var i = 0; i < text.length; i++) em += pptxCharEmForDocumentGeneration(text.charAt(i), kind);
    return em * size * (bold ? 1.06 : 1);
  }
  // Lines a text takes when wrapped at spaces into width points. A word wider than the line, as
  // in Chinese or Japanese text with no spaces, is broken across lines.
  function pptxLineCountForDocumentGeneration(text, size, width, kind, bold) {
    var total = 0;
    var space = pptxTextWidthForDocumentGeneration(' ', size, kind, bold);
    String(text).split('\n').forEach(function (line) {
      var words = line.split(/\s+/).filter(Boolean);
      if (!words.length) { total += 1; return; }
      var lines = 1;
      var used = 0;
      words.forEach(function (word) {
        var wordWidth = pptxTextWidthForDocumentGeneration(word, size, kind, bold);
        if (wordWidth > width) {
          if (used > 0) lines++;
          var pieces = Math.ceil(wordWidth / width);
          lines += pieces - 1;
          used = wordWidth - (pieces - 1) * width;
          return;
        }
        if (used === 0) used = wordWidth;
        else if (used + space + wordWidth <= width) used += space + wordWidth;
        else { lines++; used = wordWidth; }
      });
      total += lines;
    });
    return total;
  }
  // The largest size at which a single text fits the box in at most maxLines lines.
  function pptxFitTextForDocumentGeneration(text, sizes, box, kind, bold, maxLines, lineHeight) {
    for (var i = 0; i < sizes.length; i++) {
      var lines = pptxLineCountForDocumentGeneration(text, sizes[i], box.w, kind, bold);
      if (lines <= maxLines && lines * sizes[i] * lineHeight <= box.h) return { size: sizes[i], fits: true };
    }
    return { size: sizes[sizes.length - 1], fits: false };
  }
  function pptxSubSizeForDocumentGeneration(size, level) {
    return level ? Math.max(12, size - 4) : size;
  }
  // Left margin and hanging indent, in points, of a bullet at a level.
  function pptxIndentForDocumentGeneration(size, level) {
    var first = size * 0.9;
    if (!level) return { left: first, hang: first };
    var sub = pptxSubSizeForDocumentGeneration(size, level);
    return { left: first + sub * 1.1, hang: sub * 0.9 };
  }
  // Height in points of paragraphs at a size: lines at 1.2 times the size, plus the space before
  // each paragraph after the first.
  function pptxParagraphsHeightForDocumentGeneration(paragraphs, size, width, kind) {
    var height = 0;
    paragraphs.forEach(function (paragraph, index) {
      var paragraphSize = pptxSubSizeForDocumentGeneration(size, paragraph.level);
      var indent = paragraph.bullet ? pptxIndentForDocumentGeneration(size, paragraph.level).left : 0;
      var lines = pptxLineCountForDocumentGeneration(pptxPlainForDocumentGeneration(paragraph.text), paragraphSize, width - indent, kind, paragraph.bold);
      height += lines * paragraphSize * 1.2 + (index ? paragraphSize * 0.5 : 0);
    });
    return height;
  }
  function pptxFitParagraphsForDocumentGeneration(paragraphs, sizes, box, kind) {
    for (var i = 0; i < sizes.length; i++) {
      if (pptxParagraphsHeightForDocumentGeneration(paragraphs, sizes[i], box.w, kind) <= box.h) return { size: sizes[i], fits: true };
    }
    return { size: sizes[sizes.length - 1], fits: false };
  }

  // ---- Text runs ----

  // **bold** in slide text, which models write out of habit, becomes a bold run instead of
  // showing its asterisks. Unpaired asterisks are kept as typed.
  function pptxRunsForDocumentGeneration(text) {
    var parts = String(text).split('**');
    if (parts.length < 3 || parts.length % 2 === 0) return [{ text: String(text), bold: false }];
    return parts.map(function (part, index) { return { text: part, bold: index % 2 === 1 }; })
      .filter(function (run) { return run.text !== ''; });
  }
  function pptxPlainForDocumentGeneration(text) {
    return pptxRunsForDocumentGeneration(text).map(function (run) { return run.text; }).join('');
  }
  // rPr for a run. fill is a colour element (srgbClr or schemeClr) or '' to inherit.
  function pptxRunPropsForDocumentGeneration(size, bold, fill, majorFont) {
    return '<a:rPr lang="en-US" sz="' + Math.round(size * 100) + '"' + (bold ? ' b="1"' : '') + ' dirty="0">'
      + (fill ? '<a:solidFill>' + fill + '</a:solidFill>' : '')
      + (majorFont ? '<a:latin typeface="+mj-lt"/>' : '')
      + '</a:rPr>';
  }
  function pptxRunsXmlForDocumentGeneration(text, size, options) {
    var safeOptions = options || {};
    return pptxRunsForDocumentGeneration(text).map(function (run) {
      var props = pptxRunPropsForDocumentGeneration(size, run.bold || safeOptions.bold, safeOptions.fill || '', safeOptions.majorFont);
      return run.text.split('\n').map(function (line) {
        return '<a:r>' + props + '<a:t>' + pptxTextForDocumentGeneration(line) + '</a:t></a:r>';
      }).join('<a:br>' + props + '</a:br>');
    }).join('');
  }
  function pptxSimpleParagraphXmlForDocumentGeneration(text, size, options) {
    var safeOptions = options || {};
    var pPr = safeOptions.align ? '<a:pPr algn="' + safeOptions.align + '"/>' : '';
    if (!String(text)) return '<a:p>' + pPr + '<a:endParaRPr lang="en-US" sz="' + Math.round(size * 100) + '" dirty="0"/></a:p>';
    return '<a:p>' + pPr + pptxRunsXmlForDocumentGeneration(text, size, safeOptions) + '</a:p>';
  }
  // A body paragraph: a bullet at level 0 or 1, or a plain line (a column heading).
  function pptxBodyParagraphXmlForDocumentGeneration(paragraph, size, index, ink) {
    var paragraphSize = pptxSubSizeForDocumentGeneration(size, paragraph.level);
    var spacing = index ? '<a:spcBef><a:spcPts val="' + Math.round(paragraphSize * 50) + '"/></a:spcBef>' : '<a:spcBef><a:spcPts val="0"/></a:spcBef>';
    var pPr;
    if (paragraph.bullet) {
      var indent = pptxIndentForDocumentGeneration(size, paragraph.level);
      pPr = '<a:pPr marL="' + pptxEmuForDocumentGeneration(indent.left) + '" lvl="' + (paragraph.level ? 1 : 0) + '" indent="' + (-pptxEmuForDocumentGeneration(indent.hang)) + '">' + spacing
        + (ink ? '<a:buClr><a:srgbClr val="' + ink.bullet + '"/></a:buClr>' : '') + '</a:pPr>';
    } else {
      pPr = '<a:pPr marL="0" indent="0">' + spacing + '<a:buNone/></a:pPr>';
    }
    var fill = paragraph.heading ? pptxInkFillForDocumentGeneration(ink, 'title', '<a:schemeClr val="tx2"/>') : pptxInkFillForDocumentGeneration(ink, 'body');
    return '<a:p>' + pPr + pptxRunsXmlForDocumentGeneration(paragraph.text, paragraphSize, { bold: paragraph.bold, fill: fill }) + '</a:p>';
  }

  // ---- Input ----

  // Bullets from an array of strings or { text, level }, or from text with one bullet per line.
  // A leading "-", "*" or bullet character is removed, since the slide draws its own; an indented
  // line in text is a sub-bullet.
  function pptxBulletsForDocumentGeneration(raw, limit, cut) {
    var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/\r?\n/) : []);
    var bullets = [];
    list.forEach(function (item) {
      var text = '';
      var level = 0;
      if (item && typeof item === 'object') {
        text = item.text == null ? '' : String(item.text);
        level = Number(item.level) >= 1 ? 1 : 0;
      } else {
        text = item == null ? '' : String(item);
        if (/^(\t| {2,})\S/.test(text) && typeof raw === 'string') level = 1;
      }
      text = text.replace(PPTX_BULLET_MARK_RE_FOR_DOCUMENT_GENERATION, '').trim();
      if (text) bullets.push({ text: text, level: level, bullet: true });
    });
    if (bullets.length > limit) {
      cut.count = bullets.length;
      bullets = bullets.slice(0, limit);
    }
    return bullets;
  }
  function pptxColumnForDocumentGeneration(raw, cut) {
    if (raw == null || raw === '') return null;
    var heading = '';
    var source = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      heading = raw.heading == null ? '' : String(raw.heading).trim();
      source = Array.isArray(raw.bullets) ? raw.bullets : (Array.isArray(raw.items) ? raw.items : (typeof raw.content === 'string' ? raw.content : []));
    }
    var bullets = pptxBulletsForDocumentGeneration(source, PPTX_MAX_COLUMN_BULLETS_FOR_DOCUMENT_GENERATION, cut);
    if (!heading && !bullets.length) return null;
    return { heading: heading, bullets: bullets };
  }
  function pptxCellTextForDocumentGeneration(cell) {
    var value = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell.v : cell;
    if (value == null) return '';
    return String(value);
  }
  function pptxHexForInputForDocumentGeneration(value) {
    var text = String(value == null ? '' : value).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(text)) text = text.replace(/(.)/g, '$1$1');
    return /^[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : '';
  }
  // A picture: { blob_id, fit, side, alt }, or a bare blob id. A blob id that is not a positive
  // whole number is kept as invalid, so the warning can quote it.
  function pptxImageRefForDocumentGeneration(raw) {
    if (raw == null || raw === '') return null;
    var source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { blob_id: raw };
    var rawId = source.blob_id != null ? source.blob_id : (source.id != null ? source.id : source.image);
    var blobId = Number(rawId);
    var fit = String(source.fit || '').trim().toLowerCase();
    return {
      blobId: Number.isInteger(blobId) && blobId > 0 ? blobId : 0,
      rawId: String(rawId == null ? '' : rawId).slice(0, 20),
      fit: fit === 'cover' || fit === 'contain' ? fit : '',
      side: String(source.side || source.position || '').trim().toLowerCase() === 'left' ? 'left' : 'right',
      alt: source.alt == null ? '' : String(source.alt).trim().slice(0, 500)
    };
  }
  // A background: { image }, { pattern }, or { color }, or the bare value of one of them.
  function pptxBackgroundForDocumentGeneration(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return { image: pptxImageRefForDocumentGeneration(raw) };
    if (typeof raw === 'string') {
      var text = raw.trim().toLowerCase();
      if (PPTX_PATTERNS_FOR_DOCUMENT_GENERATION.indexOf(text) !== -1) return { pattern: text };
      if (/^\d+$/.test(text)) return { image: pptxImageRefForDocumentGeneration(Number(text)) };
      if (pptxHexForInputForDocumentGeneration(text)) return { color: pptxHexForInputForDocumentGeneration(text) };
      return { unknown: true };
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      if (raw.image != null || raw.blob_id != null) {
        return { image: pptxImageRefForDocumentGeneration(raw.image != null ? raw.image : raw.blob_id) };
      }
      if (raw.pattern != null) {
        var pattern = String(raw.pattern).trim().toLowerCase();
        return PPTX_PATTERNS_FOR_DOCUMENT_GENERATION.indexOf(pattern) !== -1 ? { pattern: pattern } : { unknown: true };
      }
      if (raw.color != null) {
        var color = pptxHexForInputForDocumentGeneration(raw.color);
        return color ? { color: color } : { unknown: true };
      }
    }
    return { unknown: true };
  }

  // One slide from the input, with its layout settled: the layout asked for when the slide has
  // its content, otherwise the one its content implies.
  function normalizeSlideForDocumentGeneration(raw, index, issues) {
    var slide = raw && typeof raw === 'object' ? raw : { title: raw == null ? '' : String(raw) };
    var slideNumber = index + 1;
    var title = slide.title == null ? '' : String(slide.title).trim();
    var subtitle = slide.subtitle == null ? '' : String(slide.subtitle).trim();
    var bulletCut = {};
    var bulletSource = Array.isArray(slide.bullets) ? slide.bullets
      : (Array.isArray(slide.items) ? slide.items : (typeof slide.content === 'string' ? slide.content : null));
    var bullets = pptxBulletsForDocumentGeneration(bulletSource, PPTX_MAX_BULLETS_FOR_DOCUMENT_GENERATION, bulletCut);
    if (bulletCut.count) issues.cutBullets.push(slideNumber + ' (' + bulletCut.count + ')');
    var columnCut = {};
    var left = pptxColumnForDocumentGeneration(slide.left, columnCut);
    var right = pptxColumnForDocumentGeneration(slide.right, columnCut);
    if (columnCut.count) issues.cutColumnBullets.push(slideNumber);
    var stats = (Array.isArray(slide.stats) ? slide.stats : []).map(function (stat) {
      if (stat && typeof stat === 'object') return { value: stat.value == null ? '' : String(stat.value).trim(), label: stat.label == null ? '' : String(stat.label).trim() };
      return { value: stat == null ? '' : String(stat).trim(), label: '' };
    }).filter(function (stat) { return stat.value || stat.label; });
    if (stats.length > PPTX_MAX_STATS_FOR_DOCUMENT_GENERATION) {
      issues.cutStats.push(slideNumber + ' (' + stats.length + ')');
      stats = stats.slice(0, PPTX_MAX_STATS_FOR_DOCUMENT_GENERATION);
    }
    var table = null;
    var tableSource = Array.isArray(slide.table) ? { rows: slide.table } : (slide.table && typeof slide.table === 'object' ? slide.table : null);
    if (tableSource && Array.isArray(tableSource.rows)) {
      var rows = tableSource.rows.filter(Array.isArray);
      var widest = rows.reduce(function (most, row) { return Math.max(most, row.length); }, 0);
      if (widest > PPTX_MAX_TABLE_COLUMNS_FOR_DOCUMENT_GENERATION) issues.cutTableColumns.push(slideNumber);
      var columns = Math.min(widest, PPTX_MAX_TABLE_COLUMNS_FOR_DOCUMENT_GENERATION);
      if (rows.length && columns) {
        table = {
          header: tableSource.header !== false,
          rows: rows.map(function (row) {
            var cells = [];
            for (var c = 0; c < columns; c++) cells.push(pptxCellTextForDocumentGeneration(row[c]).trim());
            return cells;
          })
        };
      }
    }
    var notes = typeof slide.notes === 'string' ? slide.notes.trim().slice(0, PPTX_MAX_NOTES_CHARS_FOR_DOCUMENT_GENERATION) : '';
    var image = pptxImageRefForDocumentGeneration(slide.image);
    var background = pptxBackgroundForDocumentGeneration(slide.background);
    if (background && background.unknown) {
      issues.unknownBackgrounds.push(slideNumber);
      background = null;
    }

    var asked = typeof slide.layout === 'string' ? slide.layout.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
    if (asked && PPTX_LAYOUTS_FOR_DOCUMENT_GENERATION.indexOf(asked) === -1) {
      issues.unknownLayouts.push(slideNumber + ' ("' + asked.slice(0, 20) + '")');
      asked = '';
    }
    var missing = (asked === 'table' && !table) || (asked === 'big_number' && !stats.length)
      || (asked === 'two_column' && !left && !right) || (asked === 'image' && !image);
    if (missing) {
      issues.emptyLayouts.push(slideNumber);
      asked = '';
    }
    var layout = asked;
    if (!layout) {
      if (table) layout = 'table';
      else if (stats.length) layout = 'big_number';
      else if (left || right) layout = 'two_column';
      // A picture with no bullets on the first slide, or with a subtitle, is a cover or section
      // photo, which goes behind the title as its background.
      else if (image && !bullets.length && (index === 0 || subtitle)) layout = index === 0 ? 'title' : 'section';
      else if (image) layout = 'image';
      else if (bullets.length) layout = 'bullets';
      else layout = index === 0 ? 'title' : 'section';
    }
    if ((layout === 'title' || layout === 'section') && (bullets.length || table || stats.length || left || right)) {
      issues.droppedContent.push(slideNumber);
    }
    // A picture on a title or section slide is its background. Anywhere else but an image slide
    // it has no place, and is left out with a warning.
    if (image && (layout === 'title' || layout === 'section') && !background) {
      background = { image: image };
      image = null;
    }
    if (image && layout !== 'image') {
      issues.droppedImages.push(slideNumber);
      image = null;
    }
    if (layout === 'image' && bullets.length > PPTX_MAX_IMAGE_BULLETS_FOR_DOCUMENT_GENERATION) {
      issues.cutImageBullets.push(slideNumber + ' (' + bullets.length + ')');
      bullets = bullets.slice(0, PPTX_MAX_IMAGE_BULLETS_FOR_DOCUMENT_GENERATION);
    }
    return {
      number: slideNumber, layout: layout, title: title, subtitle: subtitle, bullets: bullets,
      left: left, right: right, stats: stats, table: table, notes: notes,
      image: image, background: background, imageVariant: ''
    };
  }

  function normalizeDeckForDocumentGeneration(input, issues) {
    var rawSlides = Array.isArray(input.slides) ? input.slides : [];
    if (rawSlides.length > MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION) {
      issues.slidesCut = rawSlides.length;
      rawSlides = rawSlides.slice(0, MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION);
    }
    if (!rawSlides.length && typeof input.content === 'string' && input.content.trim()) {
      rawSlides = String(input.content).split(/\n\s*\n/).filter(function (chunk) { return chunk.trim(); })
        .slice(0, MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION)
        .map(function (chunk) {
          var lines = chunk.split(/\r?\n/).filter(function (line) { return line.trim(); });
          var first = (lines.shift() || '').trim().replace(/^#{1,6}\s+/, '');
          return { title: first, content: lines.join('\n') };
        });
    }
    if (!rawSlides.length && input.title) rawSlides = [{ title: String(input.title) }];
    if (!rawSlides.length) throw new Error('PPTX creation requires slides, content, or title.');
    return rawSlides.map(function (raw, index) { return normalizeSlideForDocumentGeneration(raw, index, issues); });
  }

  function pptxIssuesForDocumentGeneration() {
    return {
      slidesCut: 0, overflow: [], cutBullets: [], cutColumnBullets: [], cutImageBullets: [], cutStats: [], cutTableColumns: [],
      cutRows: [], unknownLayouts: [], emptyLayouts: [], droppedContent: [], droppedImages: [], unknownBackgrounds: [],
      badImages: [], lowResolution: [], imagesCut: 0, overflowHere: false
    };
  }

  function pptxWarningsForDocumentGeneration(issues) {
    var warnings = [];
    if (issues.slidesCut) warnings.push('The deck keeps the first ' + MAX_PPTX_SLIDES_FOR_DOCUMENT_GENERATION + ' of ' + issues.slidesCut + ' slides.');
    if (issues.overflow.length) warnings.push('These slides have more text than fits, even at the smallest text size, so it runs past the slide: ' + issues.overflow.join(', ') + '. Split each across two slides or shorten it.');
    if (issues.cutBullets.length) warnings.push('A slide keeps at most ' + PPTX_MAX_BULLETS_FOR_DOCUMENT_GENERATION + ' bullets. Cut on slide ' + issues.cutBullets.join(', ') + '. Split the list across slides.');
    if (issues.cutImageBullets.length) warnings.push('An image slide keeps at most ' + PPTX_MAX_IMAGE_BULLETS_FOR_DOCUMENT_GENERATION + ' bullets beside its picture. Cut on slide ' + issues.cutImageBullets.join(', ') + '.');
    if (issues.cutColumnBullets.length) warnings.push('A two_column column keeps at most ' + PPTX_MAX_COLUMN_BULLETS_FOR_DOCUMENT_GENERATION + ' bullets. Cut on slide ' + issues.cutColumnBullets.join(', ') + '.');
    if (issues.cutStats.length) warnings.push('A big_number slide shows at most ' + PPTX_MAX_STATS_FOR_DOCUMENT_GENERATION + ' numbers. Cut on slide ' + issues.cutStats.join(', ') + '.');
    if (issues.cutTableColumns.length) warnings.push('A slide table keeps at most ' + PPTX_MAX_TABLE_COLUMNS_FOR_DOCUMENT_GENERATION + ' columns. Cut on slide ' + issues.cutTableColumns.join(', ') + '.');
    issues.cutRows.forEach(function (cut) {
      warnings.push('The table on slide ' + cut.slide + ' keeps the first ' + cut.kept + ' of ' + cut.total + ' rows, the most that fit. Split it across slides, or put the full table in an XLSX.');
    });
    if (issues.unknownLayouts.length) warnings.push('Unknown layout on slide ' + issues.unknownLayouts.join(', ') + '. The layout was chosen from the slide\'s content.');
    if (issues.emptyLayouts.length) warnings.push('Slide ' + issues.emptyLayouts.join(', ') + ' asked for a layout without its content (table, stats, left and right, or image), so the layout was chosen from what the slide has.');
    if (issues.droppedContent.length) warnings.push('A title or section slide shows only its title and subtitle. Content on slide ' + issues.droppedContent.join(', ') + ' was left out.');
    if (issues.droppedImages.length) warnings.push('A picture goes on an image slide, or behind a slide as its background. The image on slide ' + issues.droppedImages.join(', ') + ' was left out.');
    if (issues.unknownBackgrounds.length) warnings.push('Slide ' + issues.unknownBackgrounds.join(', ') + ' has a background that is not { image }, { pattern } (' + PPTX_PATTERNS_FOR_DOCUMENT_GENERATION.join(', ') + '), or { color } with a hex colour, so it was left out.');
    if (issues.badImages.length) warnings.push('These pictures could not be used, so their slides were made without them: ' + issues.badImages.join('; ') + '. Use the blob_id of an image in this conversation.');
    if (issues.imagesCut) warnings.push('A deck holds at most ' + PPTX_MAX_IMAGES_FOR_DOCUMENT_GENERATION + ' different pictures. ' + (issues.imagesCut - PPTX_MAX_IMAGES_FOR_DOCUMENT_GENERATION) + ' were left out.');
    if (issues.lowResolution.length) warnings.push('These pictures have fewer pixels than the space they fill, so they will look soft: ' + issues.lowResolution.join('; ') + '. Use a larger image if there is one.');
    return warnings;
  }

  // ---- Pictures ----

  // PNG, JPEG and GIF go into the deck as they are. Anything else (WebP, AVIF, SVG, BMP), a
  // picture larger than the limits, and a JPEG whose EXIF orientation turns it are drawn in a
  // canvas and written again as JPEG, or as PNG when it has transparency. The canvas exists in
  // the offscreen document; without it (tests in Node) a supported picture is kept as it is and
  // any other is reported.

  function pptxBytesFromDataUrlForDocumentGeneration(dataUrl) {
    var match = /^data:([^;,]+)((?:;[^;,]*)*?)(;base64)?,/i.exec(dataUrl);
    if (!match) return null;
    var body = dataUrl.slice(match[0].length);
    var binary;
    try {
      binary = match[3] ? globalScopeForDocumentGeneration.atob(body) : unescape(encodeURIComponent(decodeURIComponent(body)));
    } catch (errForDataUrl) {
      return null;
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 255;
    return { mime: match[1].toLowerCase(), bytes: bytes };
  }

  // The orientation tag of a JPEG's EXIF block, 1 when there is none.
  function pptxJpegOrientationForDocumentGeneration(bytes, start, end) {
    if (end - start < 14 || String.fromCharCode(bytes[start], bytes[start + 1], bytes[start + 2], bytes[start + 3]) !== 'Exif') return 1;
    var tiff = start + 6;
    var little = bytes[tiff] === 0x49;
    var read16 = function (at) { return little ? bytes[at] | bytes[at + 1] << 8 : bytes[at] << 8 | bytes[at + 1]; };
    var read32 = function (at) { return little ? (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0 : (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0; };
    var directory = tiff + read32(tiff + 4);
    if (directory + 2 > end) return 1;
    var count = read16(directory);
    for (var i = 0; i < count; i++) {
      var entry = directory + 2 + i * 12;
      if (entry + 12 > end) break;
      if (read16(entry) === 0x0112) return read16(entry + 8) || 1;
    }
    return 1;
  }

  // Format and pixel size from the file's header, or null for a format a deck cannot hold.
  function pptxImageInfoForDocumentGeneration(bytes) {
    var read32 = function (at) { return (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0; };
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return { ext: 'png', width: read32(16), height: read32(20), turned: false };
    }
    if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return { ext: 'gif', width: bytes[6] | bytes[7] << 8, height: bytes[8] | bytes[9] << 8, turned: false };
    }
    if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
      var orientation = 1;
      var pos = 2;
      while (pos + 9 < bytes.length) {
        if (bytes[pos] !== 0xFF) { pos++; continue; }
        var marker = bytes[pos + 1];
        if (marker === 0xFF) { pos++; continue; }
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { pos += 2; continue; }
        var length = bytes[pos + 2] << 8 | bytes[pos + 3];
        if (marker === 0xE1) orientation = pptxJpegOrientationForDocumentGeneration(bytes, pos + 4, Math.min(bytes.length, pos + 2 + length));
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { ext: 'jpeg', width: bytes[pos + 7] << 8 | bytes[pos + 8], height: bytes[pos + 5] << 8 | bytes[pos + 6], turned: orientation > 1 };
        }
        if (marker === 0xDA) break;
        pos += 2 + length;
      }
      return { ext: 'jpeg', width: 0, height: 0, turned: orientation > 1 };
    }
    return null;
  }

  function pptxCanDrawForDocumentGeneration() {
    var scope = globalScopeForDocumentGeneration;
    var hasCanvas = typeof scope.OffscreenCanvas === 'function' || !!(scope.document && typeof scope.document.createElement === 'function');
    return typeof scope.createImageBitmap === 'function' && typeof scope.Blob === 'function' && hasCanvas;
  }
  // A canvas in the page when there is one, since only a page canvas has toDataURL.
  function pptxCanvasForDocumentGeneration(width, height) {
    var scope = globalScopeForDocumentGeneration;
    if (scope.document && typeof scope.document.createElement === 'function') {
      var element = scope.document.createElement('canvas');
      element.width = width;
      element.height = height;
      return element;
    }
    return new scope.OffscreenCanvas(width, height);
  }
  // The canvas as JPEG or PNG bytes. toDataURL encodes at once. toBlob and convertToBlob wait for
  // idle time, which the hidden offscreen document rarely has, so each picture took about a
  // second through them; they are kept only for a context with no page.
  function pptxEncodeCanvasForDocumentGeneration(canvas, type) {
    if (typeof canvas.toDataURL === 'function') {
      var decoded = pptxBytesFromDataUrlForDocumentGeneration(canvas.toDataURL(type, 0.9));
      return Promise.resolve(decoded ? decoded.bytes : null);
    }
    return canvas.convertToBlob({ type: type, quality: 0.9 }).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (buffer) { return new Uint8Array(buffer); });
  }

  // A drawable picture. createImageBitmap applies EXIF orientation; it cannot read SVG, which an
  // <img> in the page can.
  function pptxDecodeForDocumentGeneration(bytes, mime) {
    var scope = globalScopeForDocumentGeneration;
    var blob = new scope.Blob([bytes], { type: mime });
    return scope.createImageBitmap(blob).then(function (bitmap) {
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: function () { if (bitmap.close) bitmap.close(); } };
    }, function () {
      if (typeof scope.Image !== 'function' || !scope.URL || typeof scope.URL.createObjectURL !== 'function') throw new Error('undecodable');
      return new Promise(function (resolve, reject) {
        var url = scope.URL.createObjectURL(blob);
        var element = new scope.Image();
        element.onload = function () {
          scope.URL.revokeObjectURL(url);
          // An SVG with no size of its own is drawn at 1600 pixels across.
          var width = element.naturalWidth || 1600;
          var height = element.naturalHeight || Math.round(width * 9 / 16);
          resolve({ source: element, width: width, height: height, done: function () {} });
        };
        element.onerror = function () {
          scope.URL.revokeObjectURL(url);
          reject(new Error('undecodable'));
        };
        element.src = url;
      });
    });
  }

  function pptxReencodeForDocumentGeneration(bytes, mime) {
    if (!pptxCanDrawForDocumentGeneration()) return Promise.resolve(null);
    return pptxDecodeForDocumentGeneration(bytes, mime).then(function (decoded) {
      // A vector picture has no pixels of its own, so it is drawn as large as the limit allows.
      var fitScale = PPTX_MAX_IMAGE_SIDE_FOR_DOCUMENT_GENERATION / Math.max(decoded.width, decoded.height);
      var scale = mime === 'image/svg+xml' ? fitScale : Math.min(1, fitScale);
      var width = Math.max(1, Math.round(decoded.width * scale));
      var height = Math.max(1, Math.round(decoded.height * scale));
      var canvas = pptxCanvasForDocumentGeneration(width, height);
      var context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(decoded.source, 0, 0, width, height);
      decoded.done();
      var opaque = mime === 'image/jpeg';
      if (!opaque) {
        var pixels = context.getImageData(0, 0, width, height).data;
        opaque = true;
        for (var i = 3; i < pixels.length; i += 4) {
          if (pixels[i] < 255) { opaque = false; break; }
        }
      }
      return pptxEncodeCanvasForDocumentGeneration(canvas, opaque ? 'image/jpeg' : 'image/png').then(function (encoded) {
        return encoded ? { bytes: encoded, ext: opaque ? 'jpeg' : 'png', width: width, height: height } : null;
      });
    }).catch(function () { return null; });
  }

  // The part of a background photo the slide shows, as 192 x 108 pixels, for the overlay.
  function pptxSampleForDocumentGeneration(entry) {
    if (!pptxCanDrawForDocumentGeneration() || !entry.width || !entry.height) return Promise.resolve(null);
    return pptxDecodeForDocumentGeneration(entry.bytes, 'image/' + entry.ext).then(function (decoded) {
      var crop = pptxCoverCropForDocumentGeneration(decoded.width, decoded.height, 960, 540);
      var canvas = pptxCanvasForDocumentGeneration(192, 108);
      var context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(decoded.source,
        decoded.width * crop.l, decoded.height * crop.t,
        decoded.width * (1 - crop.l - crop.r), decoded.height * (1 - crop.t - crop.b),
        0, 0, 192, 108);
      decoded.done();
      return { width: 192, height: 108, data: context.getImageData(0, 0, 192, 108).data };
    }).catch(function () { return null; });
  }

  function pptxPrepareImageForDocumentGeneration(record, forBackground) {
    var dataUrl = record && typeof record.dataUrl === 'string' ? record.dataUrl : '';
    if (!record) return Promise.resolve({ error: 'was not found' });
    if (dataUrl.indexOf('data:image/') !== 0) return Promise.resolve({ error: 'is not an image' });
    var decoded = pptxBytesFromDataUrlForDocumentGeneration(dataUrl);
    if (!decoded) return Promise.resolve({ error: 'could not be read' });
    var info = pptxImageInfoForDocumentGeneration(decoded.bytes);
    var usable = !!(info && info.width && info.height);
    var reencode = !usable || info.turned || decoded.bytes.length > PPTX_MAX_IMAGE_BYTES_FOR_DOCUMENT_GENERATION
      || Math.max(info.width, info.height) > PPTX_MAX_IMAGE_SIDE_FOR_DOCUMENT_GENERATION;
    var ready = reencode ? pptxReencodeForDocumentGeneration(decoded.bytes, decoded.mime) : Promise.resolve(null);
    return ready.then(function (entry) {
      if (!entry) {
        if (!usable) return { error: 'is ' + decoded.mime + ', which could not be converted' };
        entry = { bytes: decoded.bytes, ext: info.ext, width: info.width, height: info.height };
      }
      if (!forBackground) return entry;
      return pptxSampleForDocumentGeneration(entry).then(function (sample) {
        entry.sample = sample;
        return entry;
      });
    });
  }

  // Every picture the deck uses, loaded once each through deps.loadImage(blobId), which gives
  // the attachment record ({ dataUrl }) or null. One at a time, so a deck of large photos never
  // holds more than one decoded copy.
  function pptxLoadImagesForDocumentGeneration(slides, deps, issues) {
    var ids = [];
    var backgroundIds = {};
    slides.forEach(function (slide) {
      var refs = [slide.image, slide.background && slide.background.image];
      refs.forEach(function (ref, which) {
        if (!ref || !ref.blobId) return;
        if (ids.indexOf(ref.blobId) === -1) ids.push(ref.blobId);
        if (which === 1) backgroundIds[ref.blobId] = true;
      });
    });
    if (ids.length > PPTX_MAX_IMAGES_FOR_DOCUMENT_GENERATION) {
      issues.imagesCut = ids.length;
      ids = ids.slice(0, PPTX_MAX_IMAGES_FOR_DOCUMENT_GENERATION);
    }
    var images = {};
    var loader = deps && typeof deps.loadImage === 'function' ? deps.loadImage : null;
    var chain = Promise.resolve();
    ids.forEach(function (blobId) {
      chain = chain.then(function () {
        if (!loader) return { error: 'could not be loaded here' };
        return Promise.resolve().then(function () { return loader(blobId); }).then(function (record) {
          return pptxPrepareImageForDocumentGeneration(record, !!backgroundIds[blobId]);
        }, function () { return { error: 'was not found' }; });
      }).then(function (entry) {
        images[blobId] = entry;
      });
    });
    return chain.then(function () { return images; });
  }

  // Drops each picture that could not be loaded, with a warning, and settles how an image slide
  // places its picture: beside the bullets, under the title, or across the whole slide.
  function pptxSettleImagesForDocumentGeneration(slides, images, issues) {
    var describe = function (ref, entry) {
      if (!ref.blobId) return 'blob id "' + ref.rawId + '" is not a blob id';
      if (!entry) return 'blob ' + ref.blobId + ' is past the picture limit';
      return 'blob ' + ref.blobId + ' ' + entry.error;
    };
    slides.forEach(function (slide) {
      if (slide.image) {
        var entry = images[slide.image.blobId];
        if (!entry || entry.error) {
          issues.badImages.push('slide ' + slide.number + ' (' + describe(slide.image, entry) + ')');
          slide.image = null;
          if (slide.layout === 'image') slide.layout = slide.bullets.length ? 'bullets' : (slide.number === 1 ? 'title' : 'section');
        }
      }
      if (slide.background && slide.background.image) {
        var backgroundEntry = images[slide.background.image.blobId];
        if (!backgroundEntry || backgroundEntry.error) {
          issues.badImages.push('slide ' + slide.number + ' background (' + describe(slide.background.image, backgroundEntry) + ')');
          slide.background = null;
        }
      }
      if (slide.layout === 'image') {
        slide.imageVariant = slide.bullets.length ? 'half' : (slide.title ? 'below' : 'full');
        if (!slide.image.fit) slide.image.fit = slide.imageVariant === 'below' ? 'contain' : 'cover';
      }
    });
  }

  // srcRect insets, as fractions of each side, that crop a picture to a box's shape about its
  // centre.
  function pptxCoverCropForDocumentGeneration(width, height, boxWidth, boxHeight) {
    var crop = { l: 0, t: 0, r: 0, b: 0 };
    if (!width || !height) return crop;
    var imageAspect = width / height;
    var boxAspect = boxWidth / boxHeight;
    if (imageAspect > boxAspect * 1.001) {
      crop.l = crop.r = (1 - boxAspect / imageAspect) / 2;
    } else if (imageAspect * 1.001 < boxAspect) {
      crop.t = crop.b = (1 - imageAspect / boxAspect) / 2;
    }
    return crop;
  }
  function pptxSrcRectXmlForDocumentGeneration(crop) {
    var attrs = ['l', 't', 'r', 'b'].filter(function (side) { return crop[side] > 0; }).map(function (side) {
      return ' ' + side + '="' + Math.round(crop[side] * 100000) + '"';
    });
    return attrs.length ? '<a:srcRect' + attrs.join('') + '/>' : '';
  }
  // The largest box of the picture's shape that fits the area, centred in it.
  function pptxContainBoxForDocumentGeneration(width, height, area) {
    if (!width || !height) return area;
    var scale = Math.min(area.w / width, area.h / height);
    var w = width * scale;
    var h = height * scale;
    return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w: w, h: h };
  }
  // A picture shown with fewer than one pixel per point (72 per inch at the slide's size) looks
  // soft on a projector and on any screen that shows the slide full size.
  function pptxCheckResolutionForDocumentGeneration(entry, shownWidthPt, label, issues) {
    if (entry.width && entry.width < shownWidthPt * 0.98) {
      issues.lowResolution.push(label + ' (' + entry.width + ' x ' + entry.height + ' pixels)');
    }
  }

  // ---- Readable text on a picture or colour ----

  // Text on a photo gets an overlay: the theme's text colour (dark) or white (light) over the
  // whole slide, only as opaque as the text needs. For each area of text, the photo's pixels
  // under it are blended with the overlay, and the opacity is the least at which 98% of them
  // reach the area's contrast target against the text colour: 3:1 for titles and other large
  // text, 4.5:1 for the rest, the WCAG levels. Without pixels (no canvas to decode the photo)
  // every area is taken to hold both pure white and pure black, which gives an opacity that works
  // for any photo. Blending is done on sRGB values, as PowerPoint draws it.

  var PPTX_WORST_PIXELS_FOR_DOCUMENT_GENERATION = [1, 1, 1, 0, 0, 0];
  var PPTX_LIGHT_TEXT_INK_FOR_DOCUMENT_GENERATION = { title: 'FFFFFF', body: 'FFFFFF', muted: 'FFFFFF', accent: 'FFFFFF', bullet: 'FFFFFF' };

  function pptxRgbFromHexForDocumentGeneration(hex) {
    var clean = String(hex || '000000');
    return [0, 2, 4].map(function (offset) { return parseInt(clean.substr(offset, 2), 16) / 255; });
  }
  function pptxHexFromRgbForDocumentGeneration(rgb) {
    return rgb.map(function (channel) {
      var value = Math.max(0, Math.min(255, Math.round(channel * 255)));
      return (value < 16 ? '0' : '') + value.toString(16);
    }).join('').toUpperCase();
  }
  function pptxMixForDocumentGeneration(hex, towardHex, amount) {
    var from = pptxRgbFromHexForDocumentGeneration(hex);
    var to = pptxRgbFromHexForDocumentGeneration(towardHex);
    return pptxHexFromRgbForDocumentGeneration(from.map(function (channel, index) { return channel + (to[index] - channel) * amount; }));
  }
  function pptxLinearForDocumentGeneration(channel) {
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }
  function pptxLuminanceForDocumentGeneration(r, g, b) {
    return 0.2126 * pptxLinearForDocumentGeneration(r) + 0.7152 * pptxLinearForDocumentGeneration(g) + 0.0722 * pptxLinearForDocumentGeneration(b);
  }
  function pptxHexLuminanceForDocumentGeneration(hex) {
    var rgb = pptxRgbFromHexForDocumentGeneration(hex);
    return pptxLuminanceForDocumentGeneration(rgb[0], rgb[1], rgb[2]);
  }
  function pptxContrastForDocumentGeneration(first, second) {
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }

  // The photo's pixels under an area of the slide, as sRGB values from 0 to 1.
  function pptxAreaPixelsForDocumentGeneration(sample, box) {
    if (!sample) return PPTX_WORST_PIXELS_FOR_DOCUMENT_GENERATION;
    var scaleX = sample.width / 960;
    var scaleY = sample.height / 540;
    var x0 = Math.max(0, Math.floor(box.x * scaleX));
    var x1 = Math.min(sample.width, Math.ceil((box.x + box.w) * scaleX));
    var y0 = Math.max(0, Math.floor(box.y * scaleY));
    var y1 = Math.min(sample.height, Math.ceil((box.y + box.h) * scaleY));
    var pixels = [];
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var at = (y * sample.width + x) * 4;
        pixels.push(sample.data[at] / 255, sample.data[at + 1] / 255, sample.data[at + 2] / 255);
      }
    }
    return pixels.length ? pixels : PPTX_WORST_PIXELS_FOR_DOCUMENT_GENERATION;
  }

  function pptxRequiredOpacityForDocumentGeneration(pixels, scrim, textLuminance, target) {
    var count = pixels.length / 3;
    var contrasts = new Array(count);
    var worstAt = function (opacity) {
      for (var i = 0; i < count; i++) {
        contrasts[i] = pptxContrastForDocumentGeneration(textLuminance, pptxLuminanceForDocumentGeneration(
          opacity * scrim[0] + (1 - opacity) * pixels[i * 3],
          opacity * scrim[1] + (1 - opacity) * pixels[i * 3 + 1],
          opacity * scrim[2] + (1 - opacity) * pixels[i * 3 + 2]));
      }
      contrasts.sort(function (a, b) { return a - b; });
      return contrasts[Math.floor(count * 0.02)];
    };
    if (worstAt(0) >= target) return 0;
    if (worstAt(1) < target) return 1;
    var low = 0;
    var high = 1;
    for (var step = 0; step < 12; step++) {
      var middle = (low + high) / 2;
      if (worstAt(middle) >= target) high = middle;
      else low = middle;
    }
    return Math.ceil(high * 100) / 100;
  }

  // The theme's own text colours, for a light background.
  function pptxDarkTextInkForDocumentGeneration(theme) {
    var colors = theme.colors;
    var accent = colors.accentText || colors.accent;
    return { title: colors.heading, body: colors.text, muted: colors.text, accent: accent, bullet: accent };
  }
  function pptxInkLuminanceForDocumentGeneration(ink) {
    return Math.max(pptxHexLuminanceForDocumentGeneration(ink.title), pptxHexLuminanceForDocumentGeneration(ink.body), pptxHexLuminanceForDocumentGeneration(ink.accent));
  }

  // areas: [{ box, target, role }], reported by the slide's text shapes. Each area is checked
  // against the colour its own text is drawn in. A dark overlay with white text is used unless a
  // light one needs at least 0.15 less opacity: a white wash over a photo looks faded, so it is
  // kept for photos that are already light where the text sits.
  function pptxOverlayForDocumentGeneration(sample, areas, theme) {
    var darkScrim = pptxRgbFromHexForDocumentGeneration(theme.colors.text);
    var darkInk = pptxDarkTextInkForDocumentGeneration(theme);
    var forWhiteText = 0;
    var forDarkText = 0;
    areas.forEach(function (area) {
      var pixels = pptxAreaPixelsForDocumentGeneration(sample, area.box);
      forWhiteText = Math.max(forWhiteText, pptxRequiredOpacityForDocumentGeneration(pixels, darkScrim, 1, area.target));
      forDarkText = Math.max(forDarkText, pptxRequiredOpacityForDocumentGeneration(pixels, [1, 1, 1],
        pptxHexLuminanceForDocumentGeneration(darkInk[area.role] || darkInk.body), area.target));
    });
    if (forDarkText + 0.15 <= forWhiteText) return { scrim: 'FFFFFF', opacity: forDarkText, ink: darkInk };
    return { scrim: String(theme.colors.text).toUpperCase(), opacity: forWhiteText, ink: PPTX_LIGHT_TEXT_INK_FOR_DOCUMENT_GENERATION };
  }

  // White text or the theme's text colours on a plain colour, whichever has more contrast.
  function pptxInkForColorForDocumentGeneration(hex, theme) {
    var background = pptxHexLuminanceForDocumentGeneration(hex);
    var darkInk = pptxDarkTextInkForDocumentGeneration(theme);
    return pptxContrastForDocumentGeneration(1, background) >= pptxContrastForDocumentGeneration(pptxInkLuminanceForDocumentGeneration(darkInk), background)
      ? PPTX_LIGHT_TEXT_INK_FOR_DOCUMENT_GENERATION
      : darkInk;
  }

  // ---- Patterns ----

  // A pattern is drawn here as a 1920 x 1080 PNG (two pixels per point) and stretched over the
  // slide, which every viewer shows the same way; tiled fills are not. Its lines are a small step
  // from the slide's own colour, so text keeps the contrast it has on the plain slide.

  function pptxPatternInkForDocumentGeneration(base, theme) {
    if (base === 'FFFFFF') return pptxTintForDocumentGeneration(theme.colors.primary, 0.86);
    return pptxHexLuminanceForDocumentGeneration(base) < 0.3 ? pptxMixForDocumentGeneration(base, 'FFFFFF', 0.12) : pptxMixForDocumentGeneration(base, '000000', 0.08);
  }

  // How much of a pixel at (x, y) points the pattern's ink covers, from 0 to 1, smoothed over one
  // pixel so edges are not jagged.
  function pptxPatternCoverageForDocumentGeneration(name, x, y, pixelsPerPoint) {
    var distance;
    var halfWidth;
    if (name === 'dots') {
      var rowGap = 17.32;
      var columnGap = 20;
      var row = Math.round(y / rowGap);
      var offset = (Math.abs(row) % 2) * columnGap / 2;
      var column = Math.round((x - offset) / columnGap);
      var dx = x - (column * columnGap + offset);
      var dy = y - row * rowGap;
      distance = Math.sqrt(dx * dx + dy * dy);
      halfWidth = 1.6;
    } else if (name === 'grid') {
      var gap = 32;
      var mx = x % gap;
      var my = y % gap;
      distance = Math.min(mx, gap - mx, my, gap - my);
      halfWidth = 0.4;
    } else if (name === 'diagonal') {
      var stripe = 14;
      var along = ((x + y) / Math.SQRT2) % stripe;
      distance = Math.min(along, stripe - along);
      halfWidth = 0.45;
    } else {
      var lineGap = 26;
      var amplitude = 5;
      var wavelength = 104;
      var phase = 2 * Math.PI * x / wavelength;
      var shifted = ((y - amplitude * Math.sin(phase)) % lineGap + lineGap) % lineGap;
      var slope = amplitude * 2 * Math.PI / wavelength * Math.cos(phase);
      distance = Math.min(shifted, lineGap - shifted) / Math.sqrt(1 + slope * slope);
      halfWidth = 0.55;
    }
    return Math.max(0, Math.min(1, (halfWidth - distance) * pixelsPerPoint + 0.5));
  }

  var PPTX_CRC_TABLE_FOR_DOCUMENT_GENERATION = null;
  function pptxCrcForDocumentGeneration(bytes, start, end) {
    var table = PPTX_CRC_TABLE_FOR_DOCUMENT_GENERATION;
    if (!table) {
      table = PPTX_CRC_TABLE_FOR_DOCUMENT_GENERATION = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = start; i < end; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // An RGB PNG from rows that each start with their filter byte. The image data is stored, not
  // compressed: the deck's zip compresses the part, and stored blocks need no deflate code.
  function pptxPngFromRowsForDocumentGeneration(width, height, rows) {
    var blockCount = Math.max(1, Math.ceil(rows.length / 65535));
    var idatLength = 2 + rows.length + blockCount * 5 + 4;
    var png = new Uint8Array(8 + 25 + 12 + idatLength + 12);
    var pos = 0;
    var put = function (list) { png.set(list, pos); pos += list.length; };
    var put32 = function (value) { put([value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255]); };
    put([137, 80, 78, 71, 13, 10, 26, 10]);
    put32(13);
    var chunk = pos;
    put([73, 72, 68, 82]);
    put32(width);
    put32(height);
    put([8, 2, 0, 0, 0]);
    put32(pptxCrcForDocumentGeneration(png, chunk, pos));
    put32(idatLength);
    chunk = pos;
    put([73, 68, 65, 84, 0x78, 0x01]);
    for (var block = 0; block < blockCount; block++) {
      var start = block * 65535;
      var end = Math.min(rows.length, start + 65535);
      var length = end - start;
      put([block === blockCount - 1 ? 1 : 0, length & 255, length >>> 8 & 255, ~length & 255, ~length >>> 8 & 255]);
      png.set(rows.subarray(start, end), pos);
      pos += length;
    }
    var a = 1;
    var b = 0;
    for (var at = 0; at < rows.length; at += 5552) {
      var stop = Math.min(rows.length, at + 5552);
      for (var j = at; j < stop; j++) {
        a += rows[j];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
    put32(((b << 16) | a) >>> 0);
    put32(pptxCrcForDocumentGeneration(png, chunk, pos));
    put32(0);
    chunk = pos;
    put([73, 69, 78, 68]);
    put32(pptxCrcForDocumentGeneration(png, chunk, pos));
    return png;
  }

  function pptxPatternPngForDocumentGeneration(name, baseHex, inkHex) {
    var width = 1920;
    var height = 1080;
    var pixelsPerPoint = width / 960;
    var base = pptxRgbFromHexForDocumentGeneration(baseHex).map(function (channel) { return channel * 255; });
    var ink = pptxRgbFromHexForDocumentGeneration(inkHex).map(function (channel) { return channel * 255; });
    var rowLength = width * 3 + 1;
    var rows = new Uint8Array(rowLength * height);
    for (var py = 0; py < height; py++) {
      var y = (py + 0.5) / pixelsPerPoint;
      var rowStart = py * rowLength;
      for (var px = 0; px < width; px++) {
        var coverage = pptxPatternCoverageForDocumentGeneration(name, (px + 0.5) / pixelsPerPoint, y, pixelsPerPoint);
        var at = rowStart + 1 + px * 3;
        rows[at] = base[0] + (ink[0] - base[0]) * coverage + 0.5;
        rows[at + 1] = base[1] + (ink[1] - base[1]) * coverage + 0.5;
        rows[at + 2] = base[2] + (ink[2] - base[2]) * coverage + 0.5;
      }
    }
    return pptxPngFromRowsForDocumentGeneration(width, height, rows);
  }

  // ---- Look ----

  function pptxLookForDocumentGeneration(theme) {
    var themes = agentNamespaceForDocumentGeneration.documentThemes;
    var colors = theme.colors;
    var primaryLuminance = themes && themes.luminance ? themes.luminance(colors.primary) : 0;
    return {
      cover: theme.deck && theme.deck.cover === 'plain' ? 'plain' : 'fill',
      // White on the primary colour, or the text colour when a brand primary is too light for
      // white text (under 3:1 contrast, the large-text minimum).
      coverText: primaryLuminance > 0.3 ? 'tx1' : 'bg1',
      align: theme.title && theme.title.align === 'center' ? 'ctr' : 'l',
      rule: !!(theme.title && theme.title.rule),
      titleBold: theme.fonts.heading.kind === 'sans',
      headingKind: theme.fonts.heading.kind,
      bodyKind: theme.fonts.body.kind,
      sameAccent: String(colors.accent).toUpperCase() === String(colors.primary).toUpperCase()
    };
  }
  var PPTX_MUTED_FILL_FOR_DOCUMENT_GENERATION = '<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>';
  function pptxCoverTextFillForDocumentGeneration(look, soft) {
    if (look.cover === 'plain') return soft ? PPTX_MUTED_FILL_FOR_DOCUMENT_GENERATION : '<a:schemeClr val="tx2"/>';
    if (look.coverText === 'tx1') return '<a:schemeClr val="tx1"/>';
    return soft ? '<a:schemeClr val="bg1"><a:lumMod val="85000"/></a:schemeClr>' : '<a:schemeClr val="bg1"/>';
  }
  // The colour a slide on a background image or colour gives its text, or the scheme colour
  // that applies otherwise.
  function pptxInkFillForDocumentGeneration(ink, role, otherwise) {
    return ink ? '<a:srgbClr val="' + ink[role] + '"/>' : (otherwise || '');
  }

  // Where the text and picture sit on a slide with a picture beside the text.
  function pptxPictureBoxesForDocumentGeneration(side) {
    var textX = side === 'left' ? 522 : 54;
    return {
      picture: { x: side === 'left' ? 0 : 480, y: 0, w: 480, h: 540 },
      title: { x: textX, y: 48, w: 384, h: 132 },
      rule: { x: textX, y: 188, w: 56, h: 4 },
      body: { x: textX, y: 208, w: 384, h: 282 },
      number: { x: textX + 284, y: 500, w: 100, h: 22 }
    };
  }

  // ---- Shapes ----

  function pptxXfrmForDocumentGeneration(box) {
    return '<a:xfrm><a:off x="' + pptxEmuForDocumentGeneration(box.x) + '" y="' + pptxEmuForDocumentGeneration(box.y) + '"/>'
      + '<a:ext cx="' + pptxEmuForDocumentGeneration(box.w) + '" cy="' + pptxEmuForDocumentGeneration(box.h) + '"/></a:xfrm>';
  }
  function pptxGroupHeaderForDocumentGeneration() {
    return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
      + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  }
  function pptxRectForDocumentGeneration(id, name, box, fill) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>' + fill + '</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
  }
  // A placeholder in a master or layout: its box, text anchor, list style, and prompt text.
  function pptxPlaceholderDefForDocumentGeneration(id, name, ph, box, anchor, lstStyle, prompt) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box) + '</p:spPr>'
      + '<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"' + (anchor ? ' anchor="' + anchor + '"' : '') + '><a:normAutofit/></a:bodyPr><a:lstStyle>' + (lstStyle || '') + '</a:lstStyle>'
      + '<a:p><a:r><a:rPr lang="en-US"/><a:t>' + prompt + '</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
  }
  // A picture placeholder in a layout. It has no fill: a slide's picture would inherit it, and it
  // shows through a transparent logo.
  function pptxPicturePlaceholderDefForDocumentGeneration(id, box) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Picture Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="pic" idx="1"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box) + '</p:spPr>'
      + '<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="1800"/></a:lvl1pPr></a:lstStyle>'
      + '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click icon to add picture</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
  }
  function pptxSlideNumberDefForDocumentGeneration(id, idx, box) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Slide Number Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="' + idx + '"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box || PPTX_BOX_FOR_DOCUMENT_GENERATION.number) + '</p:spPr>'
      + '<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:fld id="' + PPTX_SLIDENUM_FIELD_ID_FOR_DOCUMENT_GENERATION + '" type="slidenum"><a:rPr lang="en-US"/><a:t>\u2039#\u203a</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
  }
  // A placeholder on a slide. Its position and style come from the layout.
  function pptxPlaceholderForDocumentGeneration(id, name, ph, paragraphs, autofit) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr><p:spPr/>'
      + '<p:txBody>' + (autofit ? '<a:bodyPr><a:normAutofit/></a:bodyPr>' : '<a:bodyPr/>') + '<a:lstStyle/>' + paragraphs + '</p:txBody></p:sp>';
  }
  function pptxTextBoxForDocumentGeneration(id, name, box, anchor, paragraphs) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
      + '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="' + anchor + '"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + paragraphs + '</p:txBody></p:sp>';
  }
  function pptxSlideNumberForDocumentGeneration(id, number, ink) {
    var props = ink ? '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="' + ink.muted + '"/></a:solidFill></a:rPr>' : '<a:rPr lang="en-US"/>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Slide Number"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/>'
      + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="' + PPTX_SLIDENUM_FIELD_ID_FOR_DOCUMENT_GENERATION + '" type="slidenum">' + props + '<a:t>' + number + '</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
  }
  // A picture. ph is the placeholder it fills, or '' for a free picture. area is where it goes;
  // "cover" fills the area and crops the picture's edges, "contain" fits all of the picture
  // inside it. The position is always written out: PowerPoint does not draw a picture that leaves
  // its position to the layout's picture placeholder.
  function pptxPictureForDocumentGeneration(id, relId, entry, alt, ph, area, fit) {
    var box = fit === 'contain' ? pptxContainBoxForDocumentGeneration(entry.width, entry.height, area) : area;
    var crop = fit === 'contain' ? { l: 0, t: 0, r: 0, b: 0 } : pptxCoverCropForDocumentGeneration(entry.width, entry.height, area.w, area.h);
    var spPr = '<p:spPr>' + pptxXfrmForDocumentGeneration(box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>';
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Picture"' + (alt ? ' descr="' + pptxTextForDocumentGeneration(alt) + '"' : '') + '/>'
      + '<p:cNvPicPr><a:picLocks' + (ph ? ' noGrp="1"' : '') + ' noChangeAspect="1"/></p:cNvPicPr><p:nvPr>' + (ph || '') + '</p:nvPr></p:nvPicPr>'
      + '<p:blipFill><a:blip r:embed="' + relId + '"/>' + pptxSrcRectXmlForDocumentGeneration(crop) + '<a:stretch><a:fillRect/></a:stretch></p:blipFill>'
      + spPr + '</p:pic>';
  }
  function pptxOverlayShapeForDocumentGeneration(overlay) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Overlay"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(PPTX_BOX_FOR_DOCUMENT_GENERATION.fullSlide) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
      + '<a:solidFill><a:srgbClr val="' + overlay.scrim + '"><a:alpha val="' + Math.round(overlay.opacity * 100000) + '"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
  }

  // ---- Slides ----

  // A slide's text shapes tell the probe where their text sits, so a background photo's overlay
  // can be set for exactly those areas. target is the contrast the text needs there, and role
  // the ink colour it is drawn in (title, body, accent, or muted).
  function pptxReportAreaForDocumentGeneration(probe, box, height, anchor, target, role) {
    if (!probe) return;
    var shown = Math.min(box.h, height);
    probe.push({ box: { x: box.x, y: anchor === 'b' ? box.y + box.h - shown : box.y, w: box.w, h: shown }, target: target, role: role });
  }
  function pptxTargetForSizeForDocumentGeneration(size, bold) {
    return size >= 18 || (bold && size >= 14) ? 3 : 4.5;
  }

  function pptxTitleShapeForDocumentGeneration(slide, look, issues, ink, probe, box, maxLines) {
    if (!slide.title) return '';
    var titleBox = box || PPTX_BOX_FOR_DOCUMENT_GENERATION.title;
    var plain = pptxPlainForDocumentGeneration(slide.title);
    var fit = pptxFitTextForDocumentGeneration(plain, PPTX_SIZES_FOR_DOCUMENT_GENERATION.title, titleBox, look.headingKind, look.titleBold, maxLines || 2, 1.1);
    if (!fit.fits) issues.overflowHere = true;
    pptxReportAreaForDocumentGeneration(probe, titleBox, pptxLineCountForDocumentGeneration(plain, fit.size, titleBox.w, look.headingKind, look.titleBold) * fit.size * 1.1, 'b', 3, 'title');
    return pptxPlaceholderForDocumentGeneration(2, 'Title', '<p:ph type="title"/>',
      pptxSimpleParagraphXmlForDocumentGeneration(slide.title, fit.size, { fill: pptxInkFillForDocumentGeneration(ink, 'title') }));
  }

  function pptxCoverShapesForDocumentGeneration(slide, look, issues, ink, probe) {
    var isCover = slide.layout === 'title';
    var titleBox = isCover ? PPTX_BOX_FOR_DOCUMENT_GENERATION.coverTitle : PPTX_BOX_FOR_DOCUMENT_GENERATION.sectionTitle;
    var subtitleBox = isCover ? PPTX_BOX_FOR_DOCUMENT_GENERATION.coverSubtitle : PPTX_BOX_FOR_DOCUMENT_GENERATION.sectionSubtitle;
    var shapes = '';
    if (slide.title) {
      var plainTitle = pptxPlainForDocumentGeneration(slide.title);
      var titleFit = pptxFitTextForDocumentGeneration(plainTitle,
        isCover ? PPTX_SIZES_FOR_DOCUMENT_GENERATION.coverTitle : PPTX_SIZES_FOR_DOCUMENT_GENERATION.sectionTitle,
        titleBox, look.headingKind, look.titleBold, 3, 1.1);
      if (!titleFit.fits) issues.overflowHere = true;
      pptxReportAreaForDocumentGeneration(probe, titleBox, pptxLineCountForDocumentGeneration(plainTitle, titleFit.size, titleBox.w, look.headingKind, look.titleBold) * titleFit.size * 1.1, 'b', 3, 'title');
      shapes += pptxPlaceholderForDocumentGeneration(2, 'Title', isCover ? '<p:ph type="ctrTitle"/>' : '<p:ph type="title"/>',
        pptxSimpleParagraphXmlForDocumentGeneration(slide.title, titleFit.size, { fill: pptxInkFillForDocumentGeneration(ink, 'title') }));
    }
    if (slide.subtitle) {
      var plainSubtitle = pptxPlainForDocumentGeneration(slide.subtitle);
      var subtitleFit = pptxFitTextForDocumentGeneration(plainSubtitle,
        isCover ? PPTX_SIZES_FOR_DOCUMENT_GENERATION.coverSubtitle : PPTX_SIZES_FOR_DOCUMENT_GENERATION.sectionSubtitle,
        subtitleBox, look.bodyKind, false, 4, 1.2);
      if (!subtitleFit.fits) issues.overflowHere = true;
      pptxReportAreaForDocumentGeneration(probe, subtitleBox, pptxLineCountForDocumentGeneration(plainSubtitle, subtitleFit.size, subtitleBox.w, look.bodyKind, false) * subtitleFit.size * 1.2, 't',
        pptxTargetForSizeForDocumentGeneration(subtitleFit.size, false), 'body');
      shapes += pptxPlaceholderForDocumentGeneration(3, 'Subtitle', isCover ? '<p:ph type="subTitle" idx="1"/>' : '<p:ph type="body" idx="1"/>',
        pptxSimpleParagraphXmlForDocumentGeneration(slide.subtitle, subtitleFit.size, { fill: pptxInkFillForDocumentGeneration(ink, 'body') }));
    }
    return shapes;
  }

  function pptxBulletsShapeForDocumentGeneration(slide, look, issues, ink, probe, box, sizes, ph) {
    var area = box || PPTX_BOX_FOR_DOCUMENT_GENERATION.body;
    var fit = pptxFitParagraphsForDocumentGeneration(slide.bullets, sizes || PPTX_SIZES_FOR_DOCUMENT_GENERATION.body, area, look.bodyKind);
    if (!fit.fits) issues.overflowHere = true;
    pptxReportAreaForDocumentGeneration(probe, area, pptxParagraphsHeightForDocumentGeneration(slide.bullets, fit.size, area.w, look.bodyKind), 't',
      pptxTargetForSizeForDocumentGeneration(fit.size, false), 'body');
    return pptxPlaceholderForDocumentGeneration(3, 'Content', ph || '<p:ph idx="1"/>',
      slide.bullets.map(function (paragraph, index) { return pptxBodyParagraphXmlForDocumentGeneration(paragraph, fit.size, index, ink); }).join(''), true);
  }

  function pptxColumnParagraphsForDocumentGeneration(column) {
    if (!column) return [];
    var paragraphs = column.heading ? [{ text: column.heading, level: 0, bullet: false, bold: true, heading: true }] : [];
    return paragraphs.concat(column.bullets);
  }
  // Both columns take one size, the largest at which both fit, so they read as a pair.
  function pptxColumnsShapesForDocumentGeneration(slide, look, issues, ink, probe) {
    var leftParagraphs = pptxColumnParagraphsForDocumentGeneration(slide.left);
    var rightParagraphs = pptxColumnParagraphsForDocumentGeneration(slide.right);
    var leftBox = PPTX_BOX_FOR_DOCUMENT_GENERATION.left;
    var rightBox = PPTX_BOX_FOR_DOCUMENT_GENERATION.right;
    var sizes = PPTX_SIZES_FOR_DOCUMENT_GENERATION.column;
    var size = sizes[sizes.length - 1];
    var fits = false;
    for (var i = 0; i < sizes.length; i++) {
      if (pptxParagraphsHeightForDocumentGeneration(leftParagraphs, sizes[i], leftBox.w, look.bodyKind) <= leftBox.h
        && pptxParagraphsHeightForDocumentGeneration(rightParagraphs, sizes[i], rightBox.w, look.bodyKind) <= rightBox.h) {
        size = sizes[i];
        fits = true;
        break;
      }
    }
    if (!fits) issues.overflowHere = true;
    // An empty column is left off the slide. A placeholder with no text shows "Click to add text"
    // in PowerPoint's editor.
    var toShape = function (id, name, idx, paragraphs, box) {
      if (!paragraphs.length) return '';
      pptxReportAreaForDocumentGeneration(probe, box, pptxParagraphsHeightForDocumentGeneration(paragraphs, size, box.w, look.bodyKind), 't',
        pptxTargetForSizeForDocumentGeneration(size, false), 'body');
      return pptxPlaceholderForDocumentGeneration(id, name, '<p:ph sz="half" idx="' + idx + '"/>',
        paragraphs.map(function (paragraph, index) { return pptxBodyParagraphXmlForDocumentGeneration(paragraph, size, index, ink); }).join(''), true);
    };
    return toShape(3, 'Left', 1, leftParagraphs, leftBox) + toShape(4, 'Right', 2, rightParagraphs, rightBox);
  }

  // One to four figures side by side, each with its label under it.
  function pptxStatsShapesForDocumentGeneration(slide, look, issues, ink, probe) {
    var count = slide.stats.length;
    var gap = 32;
    var area = PPTX_BOX_FOR_DOCUMENT_GENERATION.body;
    var width = (area.w - gap * (count - 1)) / count;
    var startSize = { 1: 120, 2: 96, 3: 80, 4: 64 }[count];
    var shapes = '';
    slide.stats.forEach(function (stat, index) {
      var x = area.x + index * (width + gap);
      var valueSize = startSize;
      while (valueSize > 32 && pptxTextWidthForDocumentGeneration(stat.value, valueSize, look.headingKind, true) > width * 0.96) valueSize -= 4;
      if (pptxLineCountForDocumentGeneration(stat.value, valueSize, width, look.headingKind, true) > 1) issues.overflowHere = true;
      var valueBox = { x: x, y: 166, w: width, h: 156 };
      var labelBox = { x: x, y: 334, w: width, h: 140 };
      pptxReportAreaForDocumentGeneration(probe, valueBox, valueSize * 1.1, 'b', 3, 'accent');
      shapes += pptxTextBoxForDocumentGeneration(10 + index * 2, 'Figure ' + (index + 1), valueBox, 'b',
        pptxSimpleParagraphXmlForDocumentGeneration(stat.value, valueSize, { align: 'ctr', bold: true, fill: pptxInkFillForDocumentGeneration(ink, 'accent', '<a:schemeClr val="accent2"/>'), majorFont: true }));
      if (stat.label) {
        var plainLabel = pptxPlainForDocumentGeneration(stat.label);
        var labelFit = pptxFitTextForDocumentGeneration(plainLabel, PPTX_SIZES_FOR_DOCUMENT_GENERATION.statLabel, labelBox, look.bodyKind, false, 5, 1.2);
        if (!labelFit.fits) issues.overflowHere = true;
        pptxReportAreaForDocumentGeneration(probe, labelBox, pptxLineCountForDocumentGeneration(plainLabel, labelFit.size, labelBox.w, look.bodyKind, false) * labelFit.size * 1.2, 't',
          pptxTargetForSizeForDocumentGeneration(labelFit.size, false), 'muted');
        shapes += pptxTextBoxForDocumentGeneration(11 + index * 2, 'Label ' + (index + 1), labelBox, 't',
          pptxSimpleParagraphXmlForDocumentGeneration(stat.label, labelFit.size, { align: 'ctr', fill: pptxInkFillForDocumentGeneration(ink, 'muted', PPTX_MUTED_FILL_FOR_DOCUMENT_GENERATION) }));
      }
    });
    return shapes;
  }

  function pptxBorderForDocumentGeneration(tag, widthPt, color) {
    if (!color || !widthPt) return '<a:' + tag + ' w="12700"><a:noFill/></a:' + tag + '>';
    return '<a:' + tag + ' w="' + pptxEmuForDocumentGeneration(widthPt) + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:prstDash val="solid"/></a:' + tag + '>';
  }
  // The theme's table style, as in DOCX: a filled header with light row lines (header-fill),
  // rules only (lines, booktabs), or every cell boxed (grid). On a background picture or colour
  // the table is a white card, so its text keeps the theme's colours.
  function pptxTableShapeForDocumentGeneration(slide, theme, look, issues, ink) {
    var colors = theme.colors;
    var style = theme.table && theme.table.style ? theme.table.style : 'lines';
    var zebra = !!(theme.table && theme.table.zebra) && !!colors.tableStripe;
    var card = !!ink;
    var rows = slide.table.rows;
    var header = slide.table.header && rows.length > 1;
    var columnCount = rows[0].length;
    var area = PPTX_BOX_FOR_DOCUMENT_GENERATION.body;
    var lengths = [];
    for (var c = 0; c < columnCount; c++) {
      var longest = 4;
      rows.forEach(function (row) { longest = Math.max(longest, Math.min(40, row[c].length)); });
      lengths.push(longest);
    }
    var lengthSum = lengths.reduce(function (sum, length) { return sum + length; }, 0);
    var widths = lengths.map(function (length) { return area.w * length / lengthSum; });
    var numeric = widths.map(function (_width, column) {
      var cells = rows.slice(header ? 1 : 0).map(function (row) { return row[column]; }).filter(Boolean);
      return cells.length > 0 && cells.filter(function (cell) { return NUMERIC_CELL_RE_FOR_DOCUMENT_GENERATION.test(cell); }).length >= cells.length * 0.6;
    });
    var lastRow = rows.length - 1;
    var hasTotal = header && rows.length >= 3 && TOTAL_ROW_RE_FOR_DOCUMENT_GENERATION.test(rows[lastRow][0] || '');
    var rowHeight = function (row, rowIndex, size) {
      var bold = (header && rowIndex === 0) || (hasTotal && rowIndex === lastRow);
      var lines = 1;
      row.forEach(function (cell, column) {
        lines = Math.max(lines, pptxLineCountForDocumentGeneration(cell || ' ', size, widths[column] - 16, look.bodyKind, bold));
      });
      return lines * size * 1.2 + size * 0.7;
    };
    var sizes = PPTX_SIZES_FOR_DOCUMENT_GENERATION.table;
    var size = sizes[sizes.length - 1];
    var keptRows = rows;
    var fitted = false;
    for (var s = 0; s < sizes.length && !fitted; s++) {
      var total = 0;
      rows.forEach(function (row, rowIndex) { total += rowHeight(row, rowIndex, sizes[s]); });
      if (total <= area.h) { size = sizes[s]; fitted = true; }
    }
    if (!fitted) {
      var used = 0;
      var kept = 0;
      for (var r = 0; r < rows.length; r++) {
        var height = rowHeight(rows[r], r, size);
        if (used + height > area.h) break;
        used += height;
        kept++;
      }
      keptRows = rows.slice(0, Math.max(kept, header ? 2 : 1));
      issues.cutRows.push({ slide: slide.number, kept: keptRows.length - (header ? 1 : 0), total: rows.length - (header ? 1 : 0) });
      hasTotal = false;
    }
    var keptLast = keptRows.length - 1;
    var hair = 0.75;
    var rule = 1.5;
    var headerFill = (style === 'header-fill' || style === 'grid') && colors.tableHeaderFill ? colors.tableHeaderFill : '';
    var headerText = headerFill ? (colors.tableHeaderText || colors.heading) : colors.heading;
    var ruleColor = colors.tableHeaderRule || colors.text;
    var heights = keptRows.map(function (row, rowIndex) { return rowHeight(row, rowIndex, size); });
    var rowsXml = keptRows.map(function (row, rowIndex) {
      var isHeader = header && rowIndex === 0;
      var isTotal = hasTotal && rowIndex === keptLast;
      var bodyIndex = header ? rowIndex - 1 : rowIndex;
      var fill = '';
      if (isHeader) fill = headerFill;
      else if (zebra && !isTotal && bodyIndex % 2 === 1) fill = colors.tableStripe;
      if (!fill && card) fill = 'FFFFFF';
      var cellsXml = row.map(function (cell, column) {
        var top = [0, ''];
        var bottom = [0, ''];
        var sides = [0, ''];
        if (style === 'grid') {
          top = [hair, colors.tableBorder]; bottom = [hair, colors.tableBorder]; sides = [hair, colors.tableBorder];
        } else if (style === 'booktabs') {
          if (isHeader) { top = [rule, colors.text]; bottom = [hair, colors.text]; }
          if (rowIndex === keptLast) bottom = [rule, colors.text];
        } else if (style === 'lines') {
          bottom = isHeader ? [rule, ruleColor] : [hair, colors.tableBorder];
        } else if (!isHeader) {
          bottom = [hair, colors.tableBorder];
        }
        if (isTotal) top = [1, ruleColor];
        var align = numeric[column] ? 'r' : 'l';
        var textColor = isHeader ? headerText : colors.text;
        var runs = cell
          ? pptxRunsXmlForDocumentGeneration(cell, size, { bold: isHeader || isTotal, fill: '<a:srgbClr val="' + textColor + '"/>' })
          : '';
        return '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="' + align + '"/>' + runs
          + '<a:endParaRPr lang="en-US" sz="' + Math.round(size * 100) + '" dirty="0"/></a:p></a:txBody>'
          + '<a:tcPr marL="' + pptxEmuForDocumentGeneration(8) + '" marR="' + pptxEmuForDocumentGeneration(8) + '" marT="' + pptxEmuForDocumentGeneration(size * 0.35) + '" marB="' + pptxEmuForDocumentGeneration(size * 0.35) + '" anchor="ctr">'
          + pptxBorderForDocumentGeneration('lnL', sides[0], sides[1]) + pptxBorderForDocumentGeneration('lnR', sides[0], sides[1])
          + pptxBorderForDocumentGeneration('lnT', top[0], top[1]) + pptxBorderForDocumentGeneration('lnB', bottom[0], bottom[1])
          + (fill ? '<a:solidFill><a:srgbClr val="' + fill + '"/></a:solidFill>' : '<a:noFill/>')
          + '</a:tcPr></a:tc>';
      }).join('');
      return '<a:tr h="' + pptxEmuForDocumentGeneration(heights[rowIndex]) + '">' + cellsXml + '</a:tr>';
    }).join('');
    var tableHeight = heights.reduce(function (sum, height) { return sum + height; }, 0);
    return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
      + '<p:xfrm><a:off x="' + pptxEmuForDocumentGeneration(area.x) + '" y="' + pptxEmuForDocumentGeneration(area.y) + '"/><a:ext cx="' + pptxEmuForDocumentGeneration(area.w) + '" cy="' + pptxEmuForDocumentGeneration(tableHeight) + '"/></p:xfrm>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="' + (header ? 1 : 0) + '" bandRow="' + (zebra ? 1 : 0) + '"/>'
      + '<a:tblGrid>' + widths.map(function (width) { return '<a:gridCol w="' + pptxEmuForDocumentGeneration(width) + '"/>'; }).join('') + '</a:tblGrid>'
      + rowsXml + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  }

  // An image slide: the picture beside the bullets on its own half of the slide, under the title
  // in the content area, or across the whole slide.
  function pptxImageShapesForDocumentGeneration(slide, look, issues, ink, probe, rels) {
    var entry = rels.images[slide.image.blobId];
    var relId = rels.image(slide.image.blobId);
    var fit = slide.image.fit;
    var label = 'slide ' + slide.number;
    if (slide.imageVariant === 'half') {
      var boxes = pptxPictureBoxesForDocumentGeneration(slide.image.side);
      var pictureArea = fit === 'contain'
        ? { x: boxes.picture.x + 36, y: boxes.picture.y + 36, w: boxes.picture.w - 72, h: boxes.picture.h - 72 }
        : boxes.picture;
      pptxCheckResolutionForDocumentGeneration(entry, fit === 'contain' ? pptxContainBoxForDocumentGeneration(entry.width, entry.height, pictureArea).w : pptxCoverShownWidthForDocumentGeneration(entry, pictureArea), label, issues);
      return pptxTitleShapeForDocumentGeneration(slide, look, issues, ink, probe, boxes.title, 3)
        + pptxBulletsShapeForDocumentGeneration(slide, look, issues, ink, probe, boxes.body, PPTX_SIZES_FOR_DOCUMENT_GENERATION.column, '<p:ph type="body" sz="half" idx="2"/>')
        + pptxPictureForDocumentGeneration(5, relId, entry, slide.image.alt, '<p:ph type="pic" idx="1"/>', pictureArea, fit);
    }
    if (slide.imageVariant === 'below') {
      var below = PPTX_BOX_FOR_DOCUMENT_GENERATION.body;
      pptxCheckResolutionForDocumentGeneration(entry, fit === 'contain' ? pptxContainBoxForDocumentGeneration(entry.width, entry.height, below).w : pptxCoverShownWidthForDocumentGeneration(entry, below), label, issues);
      return pptxTitleShapeForDocumentGeneration(slide, look, issues, ink, probe)
        + pptxPictureForDocumentGeneration(4, relId, entry, slide.image.alt, '<p:ph idx="1"/>', below, fit);
    }
    var full = PPTX_BOX_FOR_DOCUMENT_GENERATION.fullSlide;
    pptxCheckResolutionForDocumentGeneration(entry, fit === 'contain' ? pptxContainBoxForDocumentGeneration(entry.width, entry.height, full).w : pptxCoverShownWidthForDocumentGeneration(entry, full), label, issues);
    return pptxPictureForDocumentGeneration(4, relId, entry, slide.image.alt, '', full, fit);
  }
  // The width, in points, that the whole picture would have if it were shown uncropped at the
  // scale a cover fit gives it.
  function pptxCoverShownWidthForDocumentGeneration(entry, area) {
    if (!entry.width || !entry.height) return 0;
    return entry.width * Math.max(area.w / entry.width, area.h / entry.height);
  }

  function pptxSlideShapesForDocumentGeneration(slide, theme, look, showNumbers, issues, ink, probe, rels) {
    var shapes = '';
    var numbered = false;
    if (slide.layout === 'title' || slide.layout === 'section') {
      shapes = pptxCoverShapesForDocumentGeneration(slide, look, issues, ink, probe);
    } else if (slide.layout === 'image') {
      shapes = pptxImageShapesForDocumentGeneration(slide, look, issues, ink, probe, rels);
      numbered = showNumbers && slide.imageVariant !== 'full';
    } else {
      shapes = pptxTitleShapeForDocumentGeneration(slide, look, issues, ink, probe);
      if (slide.layout === 'bullets') shapes += pptxBulletsShapeForDocumentGeneration(slide, look, issues, ink, probe);
      else if (slide.layout === 'two_column') shapes += pptxColumnsShapesForDocumentGeneration(slide, look, issues, ink, probe);
      else if (slide.layout === 'big_number') shapes += pptxStatsShapesForDocumentGeneration(slide, look, issues, ink, probe);
      else if (slide.layout === 'table') shapes += pptxTableShapeForDocumentGeneration(slide, theme, look, issues, ink);
      numbered = showNumbers;
    }
    if (numbered) shapes += pptxSlideNumberForDocumentGeneration(30, slide.number, ink);
    return shapes;
  }

  // Each slide's pictures, as relationships to parts in ppt/media shared by the whole deck. A
  // picture used on several slides, or a pattern with the same colours, is stored once.
  function pptxSlideRelsForDocumentGeneration(deckMedia, images) {
    var rels = { list: [], byPart: {}, images: images };
    var relFor = function (key, make) {
      if (!deckMedia.byKey[key]) {
        var made = make();
        var partName = 'image' + (deckMedia.parts.length + 1) + '.' + made.ext;
        deckMedia.byKey[key] = partName;
        deckMedia.parts.push({ name: partName, ext: made.ext, bytes: made.bytes });
      }
      var part = deckMedia.byKey[key];
      if (!rels.byPart[part]) {
        rels.byPart[part] = 'rId' + (10 + rels.list.length);
        rels.list.push([rels.byPart[part], PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'image', '../media/' + part]);
      }
      return rels.byPart[part];
    };
    rels.image = function (blobId) {
      return relFor('blob:' + blobId, function () { return { ext: images[blobId].ext, bytes: images[blobId].bytes }; });
    };
    rels.pattern = function (name, base, ink) {
      return relFor('pattern:' + name + ':' + base + ':' + ink, function () { return { ext: 'png', bytes: pptxPatternPngForDocumentGeneration(name, base, ink) }; });
    };
    return rels;
  }

  function pptxSlideXmlForDocumentGeneration(slide, theme, look, showNumbers, issues, rels) {
    var background = slide.background;
    var backgroundXml = '';
    var ink = null;
    var overlay = null;
    var hideLayoutShapes = false;
    if (background && background.image) {
      var entry = rels.images[background.image.blobId];
      // A first pass over the slide's shapes finds where its text sits; the overlay is set for
      // those areas, and the shapes are then built for real with text in the overlay's colours.
      var areas = [];
      pptxSlideShapesForDocumentGeneration(slide, theme, look, showNumbers, pptxIssuesForDocumentGeneration(), null, areas, rels);
      overlay = pptxOverlayForDocumentGeneration(entry.sample, areas, theme);
      ink = overlay.ink;
      pptxCheckResolutionForDocumentGeneration(entry, pptxCoverShownWidthForDocumentGeneration(entry, PPTX_BOX_FOR_DOCUMENT_GENERATION.fullSlide), 'slide ' + slide.number + ' background', issues);
      backgroundXml = '<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="' + rels.image(background.image.blobId) + '"/>'
        + pptxSrcRectXmlForDocumentGeneration(pptxCoverCropForDocumentGeneration(entry.width, entry.height, 960, 540))
        + '<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
      hideLayoutShapes = true;
    } else if (background && background.color) {
      ink = pptxInkForColorForDocumentGeneration(background.color, theme);
      backgroundXml = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + background.color + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
      hideLayoutShapes = true;
    } else if (background && background.pattern) {
      var filledCover = look.cover === 'fill' && (slide.layout === 'title' || slide.layout === 'section');
      var base = filledCover ? String(theme.colors.primary).toUpperCase() : 'FFFFFF';
      backgroundXml = '<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="'
        + rels.pattern(background.pattern, base, pptxPatternInkForDocumentGeneration(base, theme)) + '"/>'
        + '<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
    }
    issues.overflowHere = false;
    var shapes = pptxSlideShapesForDocumentGeneration(slide, theme, look, showNumbers, issues, ink, null, rels);
    if (overlay && overlay.opacity >= 0.01) shapes = pptxOverlayShapeForDocumentGeneration(overlay) + shapes;
    if (issues.overflowHere) issues.overflow.push(slide.number);
    // A slide on its own picture or colour hides the layout's rule and band, which are drawn for
    // the theme's own background.
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:sld ' + PPTX_NS_FOR_DOCUMENT_GENERATION + (hideLayoutShapes ? ' showMasterSp="0"' : '') + '><p:cSld>' + backgroundXml
      + '<p:spTree>' + pptxGroupHeaderForDocumentGeneration() + shapes + '</p:spTree></p:cSld>'
      + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function pptxNotesSlideXmlForDocumentGeneration(notes) {
    var paragraphs = notes.split(/\r?\n/).map(function (line) {
      return line.trim()
        ? '<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>' + pptxTextForDocumentGeneration(line) + '</a:t></a:r></a:p>'
        : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:notes ' + PPTX_NS_FOR_DOCUMENT_GENERATION + '><p:cSld><p:spTree>' + pptxGroupHeaderForDocumentGeneration()
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
      + '<p:txBody><a:bodyPr/><a:lstStyle/>' + paragraphs + '</p:txBody></p:sp>'
      + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
  }

  // ---- Master, layouts, and theme ----

  var PPTX_CLR_MAP_FOR_DOCUMENT_GENERATION = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

  function pptxSlideMasterXmlForDocumentGeneration(look) {
    var box = PPTX_BOX_FOR_DOCUMENT_GENERATION;
    var titleStyle = '<a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>'
      + '<a:defRPr sz="3600"' + (look.titleBold ? ' b="1"' : '') + ' kern="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr>';
    var bodyLevel = function (level, marL, indent, size, char) {
      return '<a:lvl' + level + 'pPr marL="' + marL + '" indent="' + indent + '" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef>'
        + '<a:buClr><a:schemeClr val="accent2"/></a:buClr><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="' + char + '"/>'
        + '<a:defRPr sz="' + size + '" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl' + level + 'pPr>';
    };
    var bodyStyle = bodyLevel(1, 274320, -274320, 2400, '\u2022') + bodyLevel(2, 685800, -228600, 2000, '\u2013') + bodyLevel(3, 1097280, -228600, 1800, '\u2013');
    var otherStyle = '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>';
    var shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title Placeholder', '<p:ph type="title"/>', box.title, 'b', '', 'Click to edit Master title style')
      + pptxPlaceholderDefForDocumentGeneration(3, 'Text Placeholder', '<p:ph type="body" idx="1"/>', box.body, 't', '', 'Click to edit Master text styles')
      + '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box.number) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
      + '<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1100"><a:solidFill>' + PPTX_MUTED_FILL_FOR_DOCUMENT_GENERATION + '</a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></a:lstStyle>'
      + '<a:p><a:fld id="' + PPTX_SLIDENUM_FIELD_ID_FOR_DOCUMENT_GENERATION + '" type="slidenum"><a:rPr lang="en-US"/><a:t>\u2039#\u203a</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
    var layoutIds = '';
    for (var i = 1; i <= PPTX_LAYOUT_PART_COUNT_FOR_DOCUMENT_GENERATION; i++) layoutIds += '<p:sldLayoutId id="' + (2147483648 + i) + '" r:id="rId' + i + '"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:sldMaster ' + PPTX_NS_FOR_DOCUMENT_GENERATION + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>'
      + pptxGroupHeaderForDocumentGeneration() + shapes + '</p:spTree></p:cSld>'
      + PPTX_CLR_MAP_FOR_DOCUMENT_GENERATION
      + '<p:sldLayoutIdLst>' + layoutIds + '</p:sldLayoutIdLst>'
      + '<p:txStyles><p:titleStyle>' + titleStyle + '</p:titleStyle><p:bodyStyle>' + bodyStyle + '</p:bodyStyle><p:otherStyle>' + otherStyle + '</p:otherStyle></p:txStyles></p:sldMaster>';
  }

  // Text style for a cover or section placeholder: alignment, size, colour, no bullet.
  function pptxCoverLstStyleForDocumentGeneration(look, size, soft, bold) {
    return '<a:lvl1pPr marL="0" indent="0" algn="' + look.align + '"><a:buNone/><a:defRPr sz="' + (size * 100) + '"' + (bold ? ' b="1"' : '')
      + '><a:solidFill>' + pptxCoverTextFillForDocumentGeneration(look, soft) + '</a:solidFill></a:defRPr></a:lvl1pPr>';
  }

  function pptxLayoutXmlForDocumentGeneration(part, look) {
    var box = PPTX_BOX_FOR_DOCUMENT_GENERATION;
    var filled = look.cover === 'fill';
    var background = '';
    var shapes = '';
    var type = '';
    var name = '';
    var ruleShape = look.rule ? pptxRectForDocumentGeneration(10, 'Accent Rule', box.rule, '<a:schemeClr val="accent2"/>') : '';
    // The band is the accent colour, or a tint of the primary when the two are the same (a shade
    // on a light primary, where a tint would vanish).
    var bandFill = '<a:schemeClr val="accent2"/>';
    if (look.sameAccent) {
      bandFill = look.coverText === 'tx1'
        ? '<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>'
        : '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>';
    }
    if (part === 1) {
      type = 'title';
      name = 'Title Slide';
      if (filled) background = '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="ctrTitle"/>', box.coverTitle, 'b', pptxCoverLstStyleForDocumentGeneration(look, 54, false, look.titleBold), 'Click to edit Master title style')
        + pptxPlaceholderDefForDocumentGeneration(3, 'Subtitle', '<p:ph type="subTitle" idx="1"/>', box.coverSubtitle, 't', pptxCoverLstStyleForDocumentGeneration(look, 24, true, false), 'Click to edit Master subtitle style');
      if (filled) shapes += pptxRectForDocumentGeneration(10, 'Accent Band', box.coverBand, bandFill);
      else if (look.rule) {
        var coverRule = look.align === 'ctr' ? { x: (960 - box.coverRule.w) / 2, y: box.coverRule.y, w: box.coverRule.w, h: box.coverRule.h } : box.coverRule;
        shapes += pptxRectForDocumentGeneration(10, 'Accent Rule', coverRule, '<a:schemeClr val="accent2"/>');
      }
    } else if (part === 2) {
      type = 'secHead';
      name = 'Section Header';
      if (filled) background = '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
      // A filled section lines up with the cover. A plain one marks the section with a bar beside a
      // left-aligned title, or a short rule under a centred one.
      var sectionTitleBox = filled ? { x: 72, y: box.sectionTitle.y, w: 816, h: box.sectionTitle.h } : box.sectionTitle;
      var sectionSubtitleBox = filled ? { x: 72, y: box.sectionSubtitle.y, w: 816, h: box.sectionSubtitle.h } : box.sectionSubtitle;
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="title"/>', sectionTitleBox, 'b', pptxCoverLstStyleForDocumentGeneration(look, 44, false, look.titleBold), 'Click to edit Master title style')
        + pptxPlaceholderDefForDocumentGeneration(3, 'Text', '<p:ph type="body" idx="1"/>', sectionSubtitleBox, 't', pptxCoverLstStyleForDocumentGeneration(look, 22, true, false), 'Click to edit Master text styles');
      if (filled) shapes += pptxRectForDocumentGeneration(10, 'Accent Band', box.coverBand, bandFill);
      else if (look.align === 'l') shapes += pptxRectForDocumentGeneration(10, 'Accent Bar', box.sectionBar, '<a:schemeClr val="accent2"/>');
      else if (look.rule) shapes += pptxRectForDocumentGeneration(10, 'Accent Rule', box.sectionRule, '<a:schemeClr val="accent2"/>');
    } else if (part === 3) {
      type = 'obj';
      name = 'Title and Content';
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="title"/>', box.title, '', '', 'Click to edit Master title style')
        + pptxPlaceholderDefForDocumentGeneration(3, 'Content', '<p:ph idx="1"/>', box.body, '', '', 'Click to edit Master text styles')
        + pptxSlideNumberDefForDocumentGeneration(4, 12) + ruleShape;
    } else if (part === 4) {
      type = 'twoObj';
      name = 'Two Content';
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="title"/>', box.title, '', '', 'Click to edit Master title style')
        + pptxPlaceholderDefForDocumentGeneration(3, 'Left', '<p:ph sz="half" idx="1"/>', box.left, '', '', 'Click to edit Master text styles')
        + pptxPlaceholderDefForDocumentGeneration(4, 'Right', '<p:ph sz="half" idx="2"/>', box.right, '', '', 'Click to edit Master text styles')
        + pptxSlideNumberDefForDocumentGeneration(5, 12) + ruleShape;
    } else if (part === 5) {
      type = 'titleOnly';
      name = 'Title Only';
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="title"/>', box.title, '', '', 'Click to edit Master title style')
        + pptxSlideNumberDefForDocumentGeneration(3, 12) + ruleShape;
    } else if (part === 6) {
      type = 'blank';
      name = 'Blank';
      shapes = pptxSlideNumberDefForDocumentGeneration(2, 12);
    } else {
      var side = part === 7 ? 'right' : 'left';
      var pictureBoxes = pptxPictureBoxesForDocumentGeneration(side);
      type = 'picTx';
      name = side === 'right' ? 'Picture Right' : 'Picture Left';
      shapes = pptxPlaceholderDefForDocumentGeneration(2, 'Title', '<p:ph type="title"/>', pictureBoxes.title, 'b', '', 'Click to edit Master title style')
        + pptxPlaceholderDefForDocumentGeneration(3, 'Text', '<p:ph type="body" sz="half" idx="2"/>', pictureBoxes.body, 't', '', 'Click to edit Master text styles')
        + pptxPicturePlaceholderDefForDocumentGeneration(4, pictureBoxes.picture)
        + pptxSlideNumberDefForDocumentGeneration(5, 12, pictureBoxes.number)
        + (look.rule ? pptxRectForDocumentGeneration(10, 'Accent Rule', pictureBoxes.rule, '<a:schemeClr val="accent2"/>') : '');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:sldLayout ' + PPTX_NS_FOR_DOCUMENT_GENERATION + ' type="' + type + '" preserve="1"><p:cSld name="' + name + '">' + background
      + '<p:spTree>' + pptxGroupHeaderForDocumentGeneration() + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }

  function pptxNotesMasterXmlForDocumentGeneration() {
    var box = PPTX_BOX_FOR_DOCUMENT_GENERATION;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:notesMaster ' + PPTX_NS_FOR_DOCUMENT_GENERATION + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + pptxGroupHeaderForDocumentGeneration()
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box.notesImage) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr>' + pptxXfrmForDocumentGeneration(box.notesBody) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
      + '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld>' + PPTX_CLR_MAP_FOR_DOCUMENT_GENERATION
      + '<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>';
  }

  // The theme part: the document theme's colours and its installed (Office) fonts, so the colour
  // and font pickers in PowerPoint offer the deck's own palette.
  function pptxThemeXmlForDocumentGeneration(theme) {
    var colors = theme.colors;
    var accentText = colors.accentText || colors.accent;
    var scheme = [
      ['dk1', colors.text], ['lt1', 'FFFFFF'], ['dk2', colors.heading], ['lt2', pptxTintForDocumentGeneration(colors.primary, 0.92)],
      ['accent1', colors.primary], ['accent2', accentText], ['accent3', pptxTintForDocumentGeneration(colors.primary, 0.45)],
      ['accent4', colors.muted], ['accent5', pptxTintForDocumentGeneration(accentText, 0.45)], ['accent6', colors.tableBorder || colors.muted],
      ['hlink', colors.link || colors.accent], ['folHlink', colors.muted]
    ].map(function (pair) {
      return '<a:' + pair[0] + '><a:srgbClr val="' + String(pair[1]).toUpperCase() + '"/></a:' + pair[0] + '>';
    }).join('');
    var label = pptxTextForDocumentGeneration(theme.label || theme.name || 'Theme');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="' + label + '">'
      + '<a:themeElements><a:clrScheme name="' + label + '">' + scheme + '</a:clrScheme>'
      + '<a:fontScheme name="' + label + '">'
      + '<a:majorFont><a:latin typeface="' + pptxTextForDocumentGeneration(theme.fonts.heading.office) + '"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
      + '<a:minorFont><a:latin typeface="' + pptxTextForDocumentGeneration(theme.fonts.body.office) + '"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
      + '</a:fontScheme>'
      + '<a:fmtScheme name="' + label + '">'
      + '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill></a:fillStyleLst>'
      + '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
      + '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
      + '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>'
      + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
      + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst>'
      + '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  function pptxCorePropsXmlForDocumentGeneration(titleForDocumentGeneration, createdAtForDocumentGeneration) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + pptxTextForDocumentGeneration(titleForDocumentGeneration || 'Generated presentation') + '</dc:title>' +
      '<dc:creator>Agentic Browser Chat</dc:creator><cp:lastModifiedBy>Agentic Browser Chat</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + pptxTextForDocumentGeneration(createdAtForDocumentGeneration) + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + pptxTextForDocumentGeneration(createdAtForDocumentGeneration) + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function pptxAppPropsXmlForDocumentGeneration(slides) {
    var titles = slides.map(function (slide) {
      return '<vt:lpstr>' + pptxTextForDocumentGeneration(pptxPlainForDocumentGeneration(slide.title || ('Slide ' + slide.number)).slice(0, 255)) + '</vt:lpstr>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Agentic Browser Chat</Application><PresentationFormat>Widescreen</PresentationFormat>' +
      '<Slides>' + slides.length + '</Slides><Notes>' + slides.filter(function (slide) { return slide.notes; }).length + '</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slide Titles</vt:lpstr></vt:variant><vt:variant><vt:i4>' + slides.length + '</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="' + slides.length + '" baseType="lpstr">' + titles + '</vt:vector></TitlesOfParts>' +
      '<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>';
  }

  // deps.loadImage(blobId) gives a picture's attachment record; without it a deck that names a
  // picture is still made, without the picture and with a warning.
  function buildPptxForDocumentGeneration(inputForDocumentGeneration, contextForPptx, depsForPptx) {
    if (!globalScopeForDocumentGeneration.JSZip) {
      throw new Error('PPTX generator is unavailable.');
    }
    var safeContext = contextForPptx || {};
    var warnings = safeContext.warnings || [];
    var theme = safeContext.theme || PPTX_FALLBACK_THEME_FOR_DOCUMENT_GENERATION;
    var look = pptxLookForDocumentGeneration(theme);
    var showNumbers = safeContext.pageNumbers !== false;
    var issues = pptxIssuesForDocumentGeneration();
    var slides = normalizeDeckForDocumentGeneration(inputForDocumentGeneration, issues);
    return pptxLoadImagesForDocumentGeneration(slides, depsForPptx, issues).then(function (images) {
      pptxSettleImagesForDocumentGeneration(slides, images, issues);
      var deckMedia = { parts: [], byKey: {} };
      var slideRels = slides.map(function () { return pptxSlideRelsForDocumentGeneration(deckMedia, images); });
      var slideXml = slides.map(function (slide, index) { return pptxSlideXmlForDocumentGeneration(slide, theme, look, showNumbers, issues, slideRels[index]); });
      pptxWarningsForDocumentGeneration(issues).forEach(function (warning) { warnings.push(warning); });
      return pptxWriteDeckForDocumentGeneration(inputForDocumentGeneration, slides, slideXml, slideRels, deckMedia, theme, look);
    });
  }

  function pptxWriteDeckForDocumentGeneration(inputForDocumentGeneration, slides, slideXml, slideRelsList, deckMedia, theme, look) {
    var hasNotes = slides.some(function (slide) { return slide.notes; });
    var zip = new globalScopeForDocumentGeneration.JSZip();
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>';
    var mediaTypes = {};
    deckMedia.parts.forEach(function (part) {
      if (mediaTypes[part.ext]) return;
      mediaTypes[part.ext] = true;
      contentTypes += '<Default Extension="' + part.ext + '" ContentType="image/' + part.ext + '"/>';
    });
    contentTypes += '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
    for (var layoutPart = 1; layoutPart <= PPTX_LAYOUT_PART_COUNT_FOR_DOCUMENT_GENERATION; layoutPart++) {
      contentTypes += '<Override PartName="/ppt/slideLayouts/slideLayout' + layoutPart + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>';
    }
    if (hasNotes) {
      contentTypes += '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
        + '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
    }
    slides.forEach(function (slide) {
      contentTypes += '<Override PartName="/ppt/slides/slide' + slide.number + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
      if (slide.notes) contentTypes += '<Override PartName="/ppt/notesSlides/notesSlide' + slide.number + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>';
    });
    zip.file('[Content_Types].xml', contentTypes + '</Types>');
    var relsXml = function (list) {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + list.map(function (rel) { return '<Relationship Id="' + rel[0] + '" Type="' + rel[1] + '" Target="' + rel[2] + '"/>'; }).join('')
        + '</Relationships>';
    };
    zip.file('_rels/.rels', relsXml([
      ['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'officeDocument', 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'extended-properties', 'docProps/app.xml']
    ]));
    zip.file('docProps/core.xml', pptxCorePropsXmlForDocumentGeneration(inputForDocumentGeneration.title, new Date().toISOString()));
    zip.file('docProps/app.xml', pptxAppPropsXmlForDocumentGeneration(slides));

    var presentationRels = [['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'theme', 'theme/theme1.xml']];
    if (hasNotes) presentationRels.push(['rId3', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'notesMaster', 'notesMasters/notesMaster1.xml']);
    var slideIds = '';
    slides.forEach(function (slide, index) {
      var relId = 'rId' + (10 + index);
      presentationRels.push([relId, PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slide', 'slides/slide' + slide.number + '.xml']);
      slideIds += '<p:sldId id="' + (256 + index) + '" r:id="' + relId + '"/>';
    });
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:presentation ' + PPTX_NS_FOR_DOCUMENT_GENERATION + ' saveSubsetFonts="1">'
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
      + (hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>' : '')
      + '<p:sldIdLst>' + slideIds + '</p:sldIdLst>'
      + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
      + '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>');
    zip.file('ppt/_rels/presentation.xml.rels', relsXml(presentationRels));

    var masterRels = [];
    for (var layoutIndex = 1; layoutIndex <= PPTX_LAYOUT_PART_COUNT_FOR_DOCUMENT_GENERATION; layoutIndex++) {
      masterRels.push(['rId' + layoutIndex, PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slideLayout', '../slideLayouts/slideLayout' + layoutIndex + '.xml']);
      zip.file('ppt/slideLayouts/slideLayout' + layoutIndex + '.xml', pptxLayoutXmlForDocumentGeneration(layoutIndex, look));
      zip.file('ppt/slideLayouts/_rels/slideLayout' + layoutIndex + '.xml.rels', relsXml([['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slideMaster', '../slideMasters/slideMaster1.xml']]));
    }
    masterRels.push(['rId' + (PPTX_LAYOUT_PART_COUNT_FOR_DOCUMENT_GENERATION + 1), PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'theme', '../theme/theme1.xml']);
    zip.file('ppt/slideMasters/slideMaster1.xml', pptxSlideMasterXmlForDocumentGeneration(look));
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml(masterRels));
    zip.file('ppt/theme/theme1.xml', pptxThemeXmlForDocumentGeneration(theme));
    if (hasNotes) {
      zip.file('ppt/theme/theme2.xml', pptxThemeXmlForDocumentGeneration(theme));
      zip.file('ppt/notesMasters/notesMaster1.xml', pptxNotesMasterXmlForDocumentGeneration());
      zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'theme', '../theme/theme2.xml']]));
    }
    slides.forEach(function (slide, index) {
      var slideRels = [['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slideLayout', '../slideLayouts/slideLayout' + pptxLayoutPartForDocumentGeneration(slide) + '.xml']];
      if (slide.notes) {
        slideRels.push(['rId2', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'notesSlide', '../notesSlides/notesSlide' + slide.number + '.xml']);
        zip.file('ppt/notesSlides/notesSlide' + slide.number + '.xml', pptxNotesSlideXmlForDocumentGeneration(slide.notes));
        zip.file('ppt/notesSlides/_rels/notesSlide' + slide.number + '.xml.rels', relsXml([
          ['rId1', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'notesMaster', '../notesMasters/notesMaster1.xml'],
          ['rId2', PPTX_REL_TYPE_FOR_DOCUMENT_GENERATION + 'slide', '../slides/slide' + slide.number + '.xml']
        ]));
      }
      zip.file('ppt/slides/slide' + slide.number + '.xml', slideXml[index]);
      zip.file('ppt/slides/_rels/slide' + slide.number + '.xml.rels', relsXml(slideRels.concat(slideRelsList[index].list)));
    });
    deckMedia.parts.forEach(function (part) { zip.file('ppt/media/' + part.name, part.bytes); });

    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: PPTX_MIME_FOR_DOCUMENT_GENERATION }).then(function (bytes) {
      return {
        mimeType: PPTX_MIME_FOR_DOCUMENT_GENERATION,
        dataUrl: uint8ToDataUrlForDocumentGeneration(bytes, PPTX_MIME_FOR_DOCUMENT_GENERATION),
        size: bytes.length
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
    // pdf: resolve image sentinels (re-extracted from their source blobs) to their original
    // bytes. Chrome prints those as they are; the built-in writer rasterizes them to JPEG first
    // (buildPdfByBestRouteForDocumentGeneration), reporting any it cannot embed through the same tracker.
    if (formatForPrepare === 'pdf') {
      var dropTrackerForPdfPrepare = makeImageDropTrackerForDocumentGeneration();
      return buildPdfImageResolverForDocumentGeneration(inputForPrepare.html, depsForPrepare).then(function (pdfResolverForPrepare) {
        var pdfParsedForPrepare = htmlToBlocksForDocumentGeneration(inputForPrepare.html, pdfResolverForPrepare, dropTrackerForPdfPrepare);
        return {
          input: Object.assign({}, inputForPrepare, {
            blocks: pdfParsedForPrepare.blocks,
            docDefaults: pdfParsedForPrepare.docDefaults
          }),
          note: dropTrackerForPdfPrepare.note(),
          dropTracker: dropTrackerForPdfPrepare,
          cut: pdfParsedForPrepare.cut
        };
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
        note: dropTrackerForPrepare.note(),
        cut: docxParsedForPrepare.cut
      };
    });
  }

  // html handed back from read_document_structure describes an existing document. It always
  // carries the defaults marker, and its images are abchat-img placeholders. Such a document keeps
  // its own formatting and is never themed, so a small edit cannot change how it looks.
  function isSourceDocumentInputForDocumentGeneration(inputForSource) {
    if (Array.isArray(inputForSource.blocks)) return false;
    var htmlForSource = typeof inputForSource.html === 'string' ? inputForSource.html : '';
    return /data-doc-defaults|data-abchat-source|abchat-img:\d/.test(htmlForSource);
  }

  // A rough length check that decides whether page numbers are on when the spec does not say.
  // A letter or a one-pager reads better without them; a report several pages long needs them.
  function looksMultiPageForDocumentGeneration(inputForLength) {
    var charsForLength = 0;
    var tableRowsForLength = 0;
    if (Array.isArray(inputForLength.blocks)) {
      inputForLength.blocks.forEach(function (blockForLength) {
        if (!blockForLength || typeof blockForLength !== 'object') return;
        charsForLength += String(blockForLength.text || '').length + String(blockForLength.subtitle || '').length;
        if (Array.isArray(blockForLength.items)) charsForLength += JSON.stringify(blockForLength.items).length;
        if (Array.isArray(blockForLength.rows)) {
          tableRowsForLength += blockForLength.rows.length;
          charsForLength += JSON.stringify(blockForLength.rows).length / 2;
        }
      });
      if (inputForLength.blocks.length > 40) return true;
    } else if (typeof inputForLength.html === 'string') {
      charsForLength = inputForLength.html.replace(/<[^>]*>/g, '').length;
      tableRowsForLength = (inputForLength.html.match(/<tr[\s>]/gi) || []).length;
    } else if (typeof inputForLength.content === 'string') {
      charsForLength = inputForLength.content.length;
    }
    return charsForLength > 3500 || tableRowsForLength > 35;
  }

  function buildRenderContextForDocumentGeneration(inputForContext, formatForContext) {
    var contextForRender = { theme: null, page: null, pageNumbers: false, headerText: '', warnings: [] };
    if (formatForContext !== 'docx' && formatForContext !== 'pdf' && formatForContext !== 'xlsx' && formatForContext !== 'pptx') return contextForRender;
    var themesForContext = agentNamespaceForDocumentGeneration.documentThemes;
    if (isSourceDocumentInputForDocumentGeneration(inputForContext)) {
      if (inputForContext.theme || inputForContext.style) {
        contextForRender.warnings.push('theme and style were ignored: this html came from read_document_structure, so the document kept its own formatting.');
      }
      return contextForRender;
    }
    if (!themesForContext) return contextForRender;
    var resolvedForContext = themesForContext.resolveTheme(inputForContext.theme, inputForContext.style, formatForContext);
    var navigatorForContext = globalScopeForDocumentGeneration.navigator;
    var pageForContext = themesForContext.resolvePage(inputForContext.page, navigatorForContext && navigatorForContext.language);
    contextForRender.theme = resolvedForContext.theme;
    contextForRender.page = pageForContext;
    // Slides are numbered unless the caller turns it off; a document only when it runs long.
    if (formatForContext === 'pptx') contextForRender.pageNumbers = inputForContext.page_numbers !== false;
    else contextForRender.pageNumbers = typeof inputForContext.page_numbers === 'boolean'
      ? inputForContext.page_numbers
      : looksMultiPageForDocumentGeneration(inputForContext);
    contextForRender.headerText = typeof inputForContext.header === 'string' ? inputForContext.header.trim().slice(0, 200) : '';
    contextForRender.warnings = resolvedForContext.warnings.concat(pageForContext.warnings);
    return contextForRender;
  }

  function base64ByteLengthForDocumentGeneration(base64ForLength) {
    var textForLength = String(base64ForLength || '');
    var paddingForLength = textForLength.slice(-2) === '==' ? 2 : (textForLength.slice(-1) === '=' ? 1 : 0);
    return Math.max(0, Math.floor(textForLength.length * 3 / 4) - paddingForLength);
  }

  // A PDF is printed by Chrome when the caller can reach the printer (deps.printPdf): real fonts
  // for every language, and Chrome's own line breaking and page layout. The built-in writer is
  // the fallback, and the result's note says why it was used unless the user chose it.
  function buildPdfByBestRouteForDocumentGeneration(inputForRoute, contextForRoute, depsForRoute, optionsForRoute) {
    var safeOptionsForRoute = optionsForRoute || {};
    var dropTrackerForRoute = safeOptionsForRoute.dropTracker || makeImageDropTrackerForDocumentGeneration();
    // whyForBuiltIn is the note's sentence saying why the built-in writer made the file, or '' when
    // there is no printer to ask (outside the extension).
    function builtInForRoute(whyForBuiltIn) {
      var blocksForBuiltIn = Array.isArray(inputForRoute.blocks) ? inputForRoute.blocks : null;
      var hasImageBytesForBuiltIn = !!blocksForBuiltIn && blocksForBuiltIn.some(function (blockForBytes) {
        return blockForBytes && blockForBytes.type === 'image' && blockForBytes.resolved && blockForBytes.resolved.bytes;
      });
      var readyForBuiltIn = hasImageBytesForBuiltIn
        ? rasterizePdfImageBlocksForDocumentGeneration(blocksForBuiltIn, dropTrackerForRoute).then(function (rasterizedForBuiltIn) {
          return Object.assign({}, inputForRoute, { blocks: rasterizedForBuiltIn });
        })
        : Promise.resolve(inputForRoute);
      return readyForBuiltIn.then(function (inputForBuiltIn) {
        var builtForBuiltIn = buildPdfForDocumentGeneration(inputForBuiltIn, contextForRoute);
        var notesForBuiltIn = [dropTrackerForRoute.note()];
        if (whyForBuiltIn) notesForBuiltIn.push(whyForBuiltIn);
        builtForBuiltIn.note = notesForBuiltIn.filter(Boolean).join(' ');
        builtForBuiltIn.builtIn = true;
        return builtForBuiltIn;
      });
    }
    var printPdfForRoute = depsForRoute && typeof depsForRoute.printPdf === 'function' ? depsForRoute.printPdf : null;
    var printerForRoute = agentNamespaceForDocumentGeneration.documentPrint;
    function failedForRoute(reasonForFailed) {
      return builtInForRoute('Chrome could not print this PDF (' + reasonForFailed + '), so the built-in writer made it, with simpler fonts and Western European characters only.');
    }
    if (!printPdfForRoute || !printerForRoute || typeof printerForRoute.renderHtml !== 'function') return builtInForRoute('');
    var renderedForRoute;
    try {
      var navigatorForRoute = globalScopeForDocumentGeneration.navigator;
      renderedForRoute = printerForRoute.renderHtml(inputForRoute, contextForRoute, {
        title: safeOptionsForRoute.title,
        lang: navigatorForRoute && navigatorForRoute.language
      });
    } catch (renderErrForRoute) {
      return failedForRoute('the page could not be laid out: ' + (renderErrForRoute && renderErrForRoute.message ? renderErrForRoute.message : 'unknown error'));
    }
    return Promise.resolve()
      .then(function () {
        return printPdfForRoute({
          html: renderedForRoute.html,
          title: safeOptionsForRoute.title || '',
          fonts: renderedForRoute.fonts,
          templates: renderedForRoute.templates
        });
      })
      .then(function (printedForRoute) {
        if (printedForRoute && printedForRoute.ok && printedForRoute.base64) {
          (Array.isArray(printedForRoute.warnings) ? printedForRoute.warnings : []).forEach(function (warningForRoute) {
            if (warningForRoute) contextForRoute.warnings.push(String(warningForRoute));
          });
          return {
            mimeType: PDF_MIME_FOR_DOCUMENT_GENERATION,
            dataUrl: 'data:' + PDF_MIME_FOR_DOCUMENT_GENERATION + ';base64,' + printedForRoute.base64,
            size: base64ByteLengthForDocumentGeneration(printedForRoute.base64),
            note: dropTrackerForRoute.note()
          };
        }
        // The user chose the built-in writer. Still say so, or the reply could claim fonts the file lacks.
        if (printedForRoute && printedForRoute.code === 'declined') {
          return builtInForRoute('The user chose the built-in PDF writer over printing with Chrome (Settings can change that), so it made this PDF, with Helvetica, Times, and Courier and Western European characters only.');
        }
        return failedForRoute((printedForRoute && printedForRoute.error) || 'no answer from the printer');
      }, function (printErrForRoute) {
        return failedForRoute(printErrForRoute && printErrForRoute.message ? printErrForRoute.message : 'the printer failed');
      });
  }

  // ---- Content past the DOCX and PDF limits ----

  // A block's text, shortened, so a warning can say where the document ends.
  function blockPreviewForDocumentGeneration(blockForPreview) {
    if (!blockForPreview || typeof blockForPreview !== 'object') return '';
    var textForPreview = '';
    if (typeof blockForPreview.text === 'string') textForPreview = blockForPreview.text;
    else if (Array.isArray(blockForPreview.runs)) {
      textForPreview = blockForPreview.runs.map(function (runForPreview) { return String((runForPreview && runForPreview.text) || ''); }).join('');
    } else if (blockForPreview.type === 'table' && Array.isArray(blockForPreview.rows) && Array.isArray(blockForPreview.rows[0])) {
      textForPreview = plainTextFromTableCellForDocumentGeneration(blockForPreview.rows[0][0]);
    }
    textForPreview = textForPreview.replace(/\s+/g, ' ').trim();
    return textForPreview.length > 60 ? textForPreview.slice(0, 57) + '...' : textForPreview;
  }
  function blockEndingForDocumentGeneration(blockForEnding) {
    var previewForEnding = blockPreviewForDocumentGeneration(blockForEnding);
    if (previewForEnding) return '"' + previewForEnding + '"';
    var typeForEnding = blockForEnding && blockForEnding.type ? String(blockForEnding.type).replace(/_/g, ' ') : 'block';
    return (/^[aeiou]/i.test(typeForEnding) ? 'an ' : 'a ') + typeForEnding;
  }

  // Warnings for content a DOCX or PDF leaves out: blocks past 500, html past 200,000 characters,
  // table rows past 5,000, and columns past 100. The cuts themselves happen where the blocks are
  // read and where tables are laid out; this only reports them. rowsForChrome holds the row
  // warnings that apply only when Chrome prints the PDF, because the built-in writer keeps 500
  // rows and says so itself.
  function contentCutWarningsForDocumentGeneration(originalInputForCut, preparedForCut, formatForCut) {
    var resultForCut = { now: [], rowsForChrome: [] };
    if (formatForCut !== 'docx' && formatForCut !== 'pdf') return resultForCut;
    var blocksForCut = Array.isArray(preparedForCut.input.blocks) ? preparedForCut.input.blocks.slice(0, MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) : [];
    var lastForCut = blocksForCut[blocksForCut.length - 1];
    var parsedCutForCut = preparedForCut.cut || null;
    if (parsedCutForCut && parsedCutForCut.htmlChars) {
      resultForCut.now.push('The html is ' + parsedCutForCut.htmlChars.toLocaleString('en-US') + ' characters long, and only the first '
        + MAX_HTML_INPUT_CHARS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + ' were read, so the document ends with '
        + blockEndingForDocumentGeneration(lastForCut) + ' and the rest was left out. Split the content into two documents.');
    }
    if (Array.isArray(originalInputForCut.blocks) && originalInputForCut.blocks.length > MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION) {
      resultForCut.now.push('The document keeps the first ' + MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION + ' of ' + originalInputForCut.blocks.length
        + ' blocks, so it ends with ' + blockEndingForDocumentGeneration(lastForCut) + '. Split the content into two documents.');
    } else if (parsedCutForCut && parsedCutForCut.blocks) {
      resultForCut.now.push('The html has more than ' + MAX_DOCX_BLOCKS_FOR_DOCUMENT_GENERATION + ' blocks (each heading, paragraph, list, or table is one), so the document ends with '
        + blockEndingForDocumentGeneration(lastForCut) + ' and the rest was left out. Split the content into two documents.');
    }
    var tableNumberForCut = 0;
    blocksForCut.forEach(function (blockForCut) {
      if (!blockForCut || blockForCut.type !== 'table') return;
      tableNumberForCut++;
      var gridForCut = expandTableGridForDocumentGeneration(blockForCut.rows);
      if (!gridForCut.rowsCut && !gridForCut.columnsCut) return;
      var previewForCut = blockPreviewForDocumentGeneration(blockForCut);
      var labelForCut = 'Table ' + tableNumberForCut + (previewForCut ? ' (starting "' + previewForCut + '")' : '');
      if (gridForCut.rowsCut) {
        var rowWarningForCut = labelForCut + ' has ' + (gridForCut.rows.length + gridForCut.rowsCut).toLocaleString('en-US') + ' rows, and the '
          + formatForCut.toUpperCase() + ' keeps the first ' + MAX_TABLE_ROWS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + '. Put the full table in an XLSX, which holds '
          + MAX_SHEET_ROWS_FOR_DOCUMENT_GENERATION.toLocaleString('en-US') + ' rows.';
        if (formatForCut === 'pdf') resultForCut.rowsForChrome.push(rowWarningForCut);
        else resultForCut.now.push(rowWarningForCut);
      }
      if (gridForCut.columnsCut) {
        resultForCut.now.push(labelForCut + ' has more than ' + MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION + ' columns, and the '
          + formatForCut.toUpperCase() + ' keeps the first ' + MAX_TABLE_COLS_FOR_DOCUMENT_GENERATION + '. Split it into narrower tables.');
      }
    });
    return resultForCut;
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
    var renderContextForDocumentGeneration = buildRenderContextForDocumentGeneration(safeInputForDocumentGeneration, formatForDocumentGeneration);
    return prepareInputWithBlocksForDocumentGeneration(safeInputForDocumentGeneration, formatForDocumentGeneration, depsForDocumentGeneration)
      .then(function (preparedForDocumentGeneration) {
        var preparedInputForDocumentGeneration = preparedForDocumentGeneration.input;
        var noteForDocumentGeneration = preparedForDocumentGeneration.note;
        var cutWarningsForDocumentGeneration = contentCutWarningsForDocumentGeneration(safeInputForDocumentGeneration, preparedForDocumentGeneration, formatForDocumentGeneration);
        Array.prototype.push.apply(renderContextForDocumentGeneration.warnings, cutWarningsForDocumentGeneration.now);
        var builtForDocumentGeneration;
        if (formatForDocumentGeneration === 'xlsx') {
          builtForDocumentGeneration = buildXlsxForDocumentGeneration(preparedInputForDocumentGeneration, renderContextForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'csv') {
          builtForDocumentGeneration = buildCsvForDocumentGeneration(preparedInputForDocumentGeneration, renderContextForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'docx') {
          builtForDocumentGeneration = buildDocxForDocumentGeneration(preparedInputForDocumentGeneration, renderContextForDocumentGeneration);
        } else if (formatForDocumentGeneration === 'pdf') {
          builtForDocumentGeneration = buildPdfByBestRouteForDocumentGeneration(
            preparedInputForDocumentGeneration,
            renderContextForDocumentGeneration,
            depsForDocumentGeneration,
            {
              title: safeInputForDocumentGeneration.title || filenameForDocumentGeneration.replace(/\.pdf$/i, ''),
              dropTracker: preparedForDocumentGeneration.dropTracker || null
            }
          );
        } else {
          builtForDocumentGeneration = buildPptxForDocumentGeneration(preparedInputForDocumentGeneration, renderContextForDocumentGeneration, depsForDocumentGeneration);
        }
        return Promise.resolve(builtForDocumentGeneration).then(function (resultForDocumentGeneration) {
          if (!resultForDocumentGeneration.builtIn) {
            Array.prototype.push.apply(renderContextForDocumentGeneration.warnings, cutWarningsForDocumentGeneration.rowsForChrome);
          }
          var responseForDocumentGeneration = {
            ok: true,
            format: formatForDocumentGeneration,
            filename: filenameForDocumentGeneration,
            mimeType: resultForDocumentGeneration.mimeType,
            dataUrl: resultForDocumentGeneration.dataUrl,
            size: resultForDocumentGeneration.size
          };
          if (renderContextForDocumentGeneration.theme) responseForDocumentGeneration.theme = renderContextForDocumentGeneration.theme.name;
          // The built-in PDF writer re-counts dropped images after rasterizing, and may add why
          // Chrome did not print the file, so its note replaces the one from preparing the input.
          if (typeof resultForDocumentGeneration.note === 'string') noteForDocumentGeneration = resultForDocumentGeneration.note;
          if (noteForDocumentGeneration) responseForDocumentGeneration.note = noteForDocumentGeneration;
          var warningsForResponse = renderContextForDocumentGeneration.warnings.filter(function (warningForFilter, indexForFilter, listForFilter) {
            return warningForFilter && listForFilter.indexOf(warningForFilter) === indexForFilter;
          });
          if (warningsForResponse.length) responseForDocumentGeneration.warnings = warningsForResponse;
          return responseForDocumentGeneration;
        });
      });
  }

  agentNamespaceForDocumentGeneration.documentGeneration = {
    createDocument: createDocumentForDocumentGeneration,
    // Shared with agent/documentPrint.js, which renders the same blocks as HTML for Chrome to
    // print, so a PDF and a DOCX made from one spec lay out their tables and lists the same way.
    layout: {
      normalizeBlocks: normalizeBlocksForDocumentGeneration,
      tidyBlocks: tidyBlocksForThemedDocumentGeneration,
      blockContent: blockContentForDocumentGeneration,
      flattenListItems: flattenListItemsForDocumentGeneration,
      listEntries: listEntriesForDocumentGeneration,
      htmlListEntries: listEntriesFromHtmlListForDocumentGeneration,
      calloutParagraphs: calloutParagraphsForDocumentGeneration,
      expandTableGrid: expandTableGridForDocumentGeneration,
      tableToPlainRows: tableToPlainRowsForDocumentGeneration,
      tableHasHeader: tableHasHeaderForDocumentGeneration,
      columnAlignments: columnAlignmentsForDocumentGeneration,
      computeTableColumnWidths: computeTableColumnWidthsForDocumentGeneration,
      isTotalRow: isTotalRowForDocumentGeneration,
      themedTableBorderSpec: themedTableBorderSpecForDocumentGeneration,
      tableBorderSpecForBlock: tableBorderSpecForBlockForDocumentGeneration
    },
    // The slide overlay rule and the picture header reader, for tests: Node has no canvas, so a
    // photo cannot be sampled there and these are tested on pixels and bytes made in the test.
    slidePictures: {
      overlay: pptxOverlayForDocumentGeneration,
      imageInfo: pptxImageInfoForDocumentGeneration
    }
  };

  globalScopeForDocumentGeneration.ABChatAgent = agentNamespaceForDocumentGeneration;
})();
