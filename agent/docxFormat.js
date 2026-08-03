(function () {
  var globalScopeForDocxFormat = globalThis;
  var agentNamespaceForDocxFormat = globalScopeForDocxFormat.ABChatAgent || {};

  // Word resolves a run's appearance through docDefaults, then the style's basedOn chain,
  // then the paragraph/character style, then direct formatting. Reading only direct
  // formatting reports nothing for most real documents, whose sizes live in styles.xml,
  // so the chain is walked here rather than trusting what a converter happens to expose.
  var MAX_STYLE_CHAIN_DEPTH_FOR_DOCX_FORMAT = 12;
  var MAX_TABLES_FOR_DOCX_FORMAT = 300;
  var MAX_FORMAT_CLASSES_FOR_DOCX_FORMAT = 240;
  var MAX_DISTINCT_SIZES_FOR_DOCX_FORMAT = 40;
  var MAX_DISTINCT_FAMILIES_FOR_DOCX_FORMAT = 12;
  var MIN_FONT_SIZE_PT_FOR_DOCX_FORMAT = 1;
  var MAX_FONT_SIZE_PT_FOR_DOCX_FORMAT = 400;
  var MAX_BORDER_WIDTH_PT_FOR_DOCX_FORMAT = 12;
  var BORDER_EDGE_NAMES_FOR_DOCX_FORMAT = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

  function localNameForDocxFormat(rawNameForDocxFormat) {
    var nameForDocxFormat = String(rawNameForDocxFormat || '');
    var colonIndexForDocxFormat = nameForDocxFormat.indexOf(':');
    return colonIndexForDocxFormat < 0 ? nameForDocxFormat : nameForDocxFormat.slice(colonIndexForDocxFormat + 1);
  }

  function decodeXmlEntitiesForDocxFormat(valueForDocxFormat) {
    return String(valueForDocxFormat == null ? '' : valueForDocxFormat)
      .replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (wholeForDecode, entityForDecode) {
        if (entityForDecode.charAt(0) === '#') {
          var codeForDecode = (entityForDecode.charAt(1) === 'x' || entityForDecode.charAt(1) === 'X')
            ? parseInt(entityForDecode.slice(2), 16)
            : parseInt(entityForDecode.slice(1), 10);
          if (!Number.isFinite(codeForDecode) || codeForDecode < 0 || codeForDecode > 0x10FFFF) return wholeForDecode;
          try { return String.fromCodePoint(codeForDecode); } catch (errForDecode) { return wholeForDecode; }
        }
        if (entityForDecode === 'amp') return '&';
        if (entityForDecode === 'lt') return '<';
        if (entityForDecode === 'gt') return '>';
        if (entityForDecode === 'quot') return '"';
        return "'";
      });
  }

  // Element-and-attribute-only XML reader. Text nodes are skipped because every property
  // this module reads lives in an attribute, which keeps the reader small enough to be
  // obviously correct in a service worker, where there is no DOMParser.
  function parseXmlForDocxFormat(textForParse) {
    var sourceForParse = String(textForParse || '');
    var lengthForParse = sourceForParse.length;
    var rootForParse = { name: '#root', attrs: {}, children: [] };
    var stackForParse = [rootForParse];
    var indexForParse = 0;
    while (indexForParse < lengthForParse) {
      var openIndexForParse = sourceForParse.indexOf('<', indexForParse);
      if (openIndexForParse < 0) break;
      indexForParse = openIndexForParse + 1;
      var leadCharForParse = sourceForParse.charAt(indexForParse);
      if (leadCharForParse === '?') {
        var piEndForParse = sourceForParse.indexOf('?>', indexForParse);
        indexForParse = piEndForParse < 0 ? lengthForParse : piEndForParse + 2;
        continue;
      }
      if (leadCharForParse === '!') {
        if (sourceForParse.substr(indexForParse, 3) === '!--') {
          var commentEndForParse = sourceForParse.indexOf('-->', indexForParse);
          indexForParse = commentEndForParse < 0 ? lengthForParse : commentEndForParse + 3;
          continue;
        }
        if (sourceForParse.substr(indexForParse, 8) === '![CDATA[') {
          var cdataEndForParse = sourceForParse.indexOf(']]>', indexForParse);
          indexForParse = cdataEndForParse < 0 ? lengthForParse : cdataEndForParse + 3;
          continue;
        }
        var declEndForParse = sourceForParse.indexOf('>', indexForParse);
        indexForParse = declEndForParse < 0 ? lengthForParse : declEndForParse + 1;
        continue;
      }
      if (leadCharForParse === '/') {
        var closeEndForParse = sourceForParse.indexOf('>', indexForParse);
        if (closeEndForParse < 0) break;
        if (stackForParse.length > 1) stackForParse.pop();
        indexForParse = closeEndForParse + 1;
        continue;
      }
      var nameStartForParse = indexForParse;
      while (indexForParse < lengthForParse && ' \t\r\n/>'.indexOf(sourceForParse.charAt(indexForParse)) < 0) indexForParse++;
      var nodeForParse = {
        name: localNameForDocxFormat(sourceForParse.slice(nameStartForParse, indexForParse)),
        attrs: {},
        children: []
      };
      var selfClosingForParse = false;
      while (indexForParse < lengthForParse) {
        while (indexForParse < lengthForParse && ' \t\r\n'.indexOf(sourceForParse.charAt(indexForParse)) >= 0) indexForParse++;
        var cursorCharForParse = sourceForParse.charAt(indexForParse);
        if (cursorCharForParse === '>') { indexForParse++; break; }
        if (cursorCharForParse === '/') { selfClosingForParse = true; indexForParse++; continue; }
        if (!cursorCharForParse) break;
        var attrStartForParse = indexForParse;
        while (indexForParse < lengthForParse && '= \t\r\n/>'.indexOf(sourceForParse.charAt(indexForParse)) < 0) indexForParse++;
        var attrNameForParse = localNameForDocxFormat(sourceForParse.slice(attrStartForParse, indexForParse));
        while (indexForParse < lengthForParse && ' \t\r\n'.indexOf(sourceForParse.charAt(indexForParse)) >= 0) indexForParse++;
        if (sourceForParse.charAt(indexForParse) !== '=') {
          if (attrNameForParse) nodeForParse.attrs[attrNameForParse] = '';
          continue;
        }
        indexForParse++;
        while (indexForParse < lengthForParse && ' \t\r\n'.indexOf(sourceForParse.charAt(indexForParse)) >= 0) indexForParse++;
        var quoteCharForParse = sourceForParse.charAt(indexForParse);
        var attrValueForParse = '';
        if (quoteCharForParse === '"' || quoteCharForParse === "'") {
          var quoteEndForParse = sourceForParse.indexOf(quoteCharForParse, indexForParse + 1);
          if (quoteEndForParse < 0) { indexForParse = lengthForParse; break; }
          attrValueForParse = sourceForParse.slice(indexForParse + 1, quoteEndForParse);
          indexForParse = quoteEndForParse + 1;
        } else {
          var bareStartForParse = indexForParse;
          while (indexForParse < lengthForParse && ' \t\r\n/>'.indexOf(sourceForParse.charAt(indexForParse)) < 0) indexForParse++;
          attrValueForParse = sourceForParse.slice(bareStartForParse, indexForParse);
        }
        if (attrNameForParse) nodeForParse.attrs[attrNameForParse] = decodeXmlEntitiesForDocxFormat(attrValueForParse);
      }
      stackForParse[stackForParse.length - 1].children.push(nodeForParse);
      if (!selfClosingForParse) stackForParse.push(nodeForParse);
    }
    return rootForParse;
  }

  function firstChildForDocxFormat(nodeForDocxFormat, nameForDocxFormat) {
    if (!nodeForDocxFormat || !nodeForDocxFormat.children) return null;
    for (var iForDocxFormat = 0; iForDocxFormat < nodeForDocxFormat.children.length; iForDocxFormat++) {
      if (nodeForDocxFormat.children[iForDocxFormat].name === nameForDocxFormat) return nodeForDocxFormat.children[iForDocxFormat];
    }
    return null;
  }

  function attrForDocxFormat(nodeForDocxFormat, nameForDocxFormat) {
    if (!nodeForDocxFormat || !nodeForDocxFormat.attrs) return '';
    var valueForDocxFormat = nodeForDocxFormat.attrs[nameForDocxFormat];
    return valueForDocxFormat == null ? '' : String(valueForDocxFormat);
  }

  function findDescendantForDocxFormat(nodeForDocxFormat, nameForDocxFormat) {
    if (!nodeForDocxFormat) return null;
    if (nodeForDocxFormat.name === nameForDocxFormat) return nodeForDocxFormat;
    var childrenForDocxFormat = nodeForDocxFormat.children || [];
    for (var iForDocxFormat = 0; iForDocxFormat < childrenForDocxFormat.length; iForDocxFormat++) {
      var foundForDocxFormat = findDescendantForDocxFormat(childrenForDocxFormat[iForDocxFormat], nameForDocxFormat);
      if (foundForDocxFormat) return foundForDocxFormat;
    }
    return null;
  }

  function walkAllForDocxFormat(nodeForDocxFormat, visitForDocxFormat) {
    if (!nodeForDocxFormat) return;
    var childrenForDocxFormat = nodeForDocxFormat.children || [];
    for (var iForDocxFormat = 0; iForDocxFormat < childrenForDocxFormat.length; iForDocxFormat++) {
      var childForDocxFormat = childrenForDocxFormat[iForDocxFormat];
      visitForDocxFormat(childForDocxFormat, nodeForDocxFormat);
      walkAllForDocxFormat(childForDocxFormat, visitForDocxFormat);
    }
  }

  function roundToTenthForDocxFormat(valueForDocxFormat) {
    return Math.round(Number(valueForDocxFormat) * 10) / 10;
  }

  // w:sz inside w:rPr is half-points (24 = 12pt). w:sz on a border is eighths of a point
  // (8 = 1pt). The two are never interchangeable, which is why they have separate readers.
  function halfPointsToPtForDocxFormat(rawValueForDocxFormat) {
    var parsedForDocxFormat = parseFloat(rawValueForDocxFormat);
    if (!Number.isFinite(parsedForDocxFormat)) return 0;
    var pointsForDocxFormat = roundToTenthForDocxFormat(parsedForDocxFormat / 2);
    if (pointsForDocxFormat < MIN_FONT_SIZE_PT_FOR_DOCX_FORMAT || pointsForDocxFormat > MAX_FONT_SIZE_PT_FOR_DOCX_FORMAT) return 0;
    return pointsForDocxFormat;
  }

  function eighthPointsToPtForDocxFormat(rawValueForDocxFormat) {
    var parsedForDocxFormat = parseFloat(rawValueForDocxFormat);
    if (!Number.isFinite(parsedForDocxFormat) || parsedForDocxFormat <= 0) return 0;
    var pointsForDocxFormat = roundToTenthForDocxFormat(parsedForDocxFormat / 8);
    if (pointsForDocxFormat <= 0) return 0;
    return Math.min(pointsForDocxFormat, MAX_BORDER_WIDTH_PT_FOR_DOCX_FORMAT);
  }

  function twipsToPtForDocxFormat(rawValueForDocxFormat) {
    var parsedForDocxFormat = parseFloat(rawValueForDocxFormat);
    if (!Number.isFinite(parsedForDocxFormat) || parsedForDocxFormat <= 0) return 0;
    return Math.round(parsedForDocxFormat / 20);
  }

  function normalizeFontFamilyForDocxFormat(rawValueForDocxFormat) {
    var familyForDocxFormat = String(rawValueForDocxFormat || '').trim();
    if (!familyForDocxFormat) return '';
    // The name is echoed into a CSS declaration, so anything that could terminate one or
    // escape the attribute is dropped rather than quoted.
    familyForDocxFormat = familyForDocxFormat.replace(/["'<>;:]/g, '').trim();
    if (familyForDocxFormat.length > 64) familyForDocxFormat = familyForDocxFormat.slice(0, 64).trim();
    return familyForDocxFormat;
  }

  function normalizeHexColorForDocxFormat(rawValueForDocxFormat) {
    var colorForDocxFormat = String(rawValueForDocxFormat || '').trim();
    if (!colorForDocxFormat || colorForDocxFormat.toLowerCase() === 'auto') return '000000';
    if (!/^[0-9A-Fa-f]{6}$/.test(colorForDocxFormat)) return '000000';
    return colorForDocxFormat.toUpperCase();
  }

  function readThemeFontsForDocxFormat(themeXmlForDocxFormat) {
    var themeFontsForDocxFormat = { major: '', minor: '' };
    if (!themeXmlForDocxFormat) return themeFontsForDocxFormat;
    var themeRootForDocxFormat = parseXmlForDocxFormat(themeXmlForDocxFormat);
    var fontSchemeForDocxFormat = findDescendantForDocxFormat(themeRootForDocxFormat, 'fontScheme');
    if (!fontSchemeForDocxFormat) return themeFontsForDocxFormat;
    var majorForDocxFormat = firstChildForDocxFormat(fontSchemeForDocxFormat, 'majorFont');
    var minorForDocxFormat = firstChildForDocxFormat(fontSchemeForDocxFormat, 'minorFont');
    themeFontsForDocxFormat.major = normalizeFontFamilyForDocxFormat(attrForDocxFormat(firstChildForDocxFormat(majorForDocxFormat, 'latin'), 'typeface'));
    themeFontsForDocxFormat.minor = normalizeFontFamilyForDocxFormat(attrForDocxFormat(firstChildForDocxFormat(minorForDocxFormat, 'latin'), 'typeface'));
    return themeFontsForDocxFormat;
  }

  function fontFamilyFromRunPropsForDocxFormat(runPropsForDocxFormat, themeFontsForDocxFormat) {
    var fontsNodeForDocxFormat = firstChildForDocxFormat(runPropsForDocxFormat, 'rFonts');
    if (!fontsNodeForDocxFormat) return '';
    var explicitForDocxFormat = normalizeFontFamilyForDocxFormat(attrForDocxFormat(fontsNodeForDocxFormat, 'ascii'));
    if (explicitForDocxFormat) return explicitForDocxFormat;
    var themeRefForDocxFormat = String(attrForDocxFormat(fontsNodeForDocxFormat, 'asciiTheme') || '').toLowerCase();
    if (!themeRefForDocxFormat) return '';
    return themeRefForDocxFormat.indexOf('major') >= 0 ? themeFontsForDocxFormat.major : themeFontsForDocxFormat.minor;
  }

  function readRunFormatForDocxFormat(runPropsForDocxFormat, themeFontsForDocxFormat) {
    if (!runPropsForDocxFormat) return { fontSizePt: 0, fontFamily: '' };
    return {
      fontSizePt: halfPointsToPtForDocxFormat(attrForDocxFormat(firstChildForDocxFormat(runPropsForDocxFormat, 'sz'), 'val')),
      fontFamily: fontFamilyFromRunPropsForDocxFormat(runPropsForDocxFormat, themeFontsForDocxFormat)
    };
  }

  function readBorderEdgeForDocxFormat(edgeNodeForDocxFormat) {
    if (!edgeNodeForDocxFormat) return null;
    var lineStyleForDocxFormat = String(attrForDocxFormat(edgeNodeForDocxFormat, 'val') || '').toLowerCase();
    if (!lineStyleForDocxFormat || lineStyleForDocxFormat === 'nil' || lineStyleForDocxFormat === 'none') return null;
    var widthPtForDocxFormat = eighthPointsToPtForDocxFormat(attrForDocxFormat(edgeNodeForDocxFormat, 'sz'));
    return {
      widthPt: widthPtForDocxFormat || 0.5,
      color: normalizeHexColorForDocxFormat(attrForDocxFormat(edgeNodeForDocxFormat, 'color'))
    };
  }

  function readTableBordersForDocxFormat(bordersNodeForDocxFormat) {
    if (!bordersNodeForDocxFormat) return null;
    var edgesForDocxFormat = {};
    var anyEdgeForDocxFormat = false;
    for (var iForDocxFormat = 0; iForDocxFormat < BORDER_EDGE_NAMES_FOR_DOCX_FORMAT.length; iForDocxFormat++) {
      var edgeNameForDocxFormat = BORDER_EDGE_NAMES_FOR_DOCX_FORMAT[iForDocxFormat];
      var edgeForDocxFormat = readBorderEdgeForDocxFormat(firstChildForDocxFormat(bordersNodeForDocxFormat, edgeNameForDocxFormat));
      edgesForDocxFormat[edgeNameForDocxFormat] = edgeForDocxFormat;
      if (edgeForDocxFormat) anyEdgeForDocxFormat = true;
    }
    return { edges: edgesForDocxFormat, any: anyEdgeForDocxFormat };
  }

  function readStylesForDocxFormat(stylesXmlForDocxFormat, themeFontsForDocxFormat) {
    var resultForDocxFormat = {
      docDefaults: { fontSizePt: 0, fontFamily: '' },
      defaultParagraphStyleId: '',
      rawStyles: {}
    };
    if (!stylesXmlForDocxFormat) return resultForDocxFormat;
    var stylesRootForDocxFormat = parseXmlForDocxFormat(stylesXmlForDocxFormat);
    var stylesNodeForDocxFormat = findDescendantForDocxFormat(stylesRootForDocxFormat, 'styles');
    if (!stylesNodeForDocxFormat) return resultForDocxFormat;

    var docDefaultsNodeForDocxFormat = firstChildForDocxFormat(stylesNodeForDocxFormat, 'docDefaults');
    var rPrDefaultForDocxFormat = firstChildForDocxFormat(docDefaultsNodeForDocxFormat, 'rPrDefault');
    resultForDocxFormat.docDefaults = readRunFormatForDocxFormat(
      firstChildForDocxFormat(rPrDefaultForDocxFormat, 'rPr'),
      themeFontsForDocxFormat
    );

    var styleNodesForDocxFormat = (stylesNodeForDocxFormat.children || []).filter(function (childForDocxFormat) {
      return childForDocxFormat.name === 'style';
    });
    styleNodesForDocxFormat.forEach(function (styleNodeForDocxFormat) {
      var styleIdForDocxFormat = attrForDocxFormat(styleNodeForDocxFormat, 'styleId');
      if (!styleIdForDocxFormat) return;
      var styleTypeForDocxFormat = attrForDocxFormat(styleNodeForDocxFormat, 'type') || 'paragraph';
      var runPropsForDocxFormat = firstChildForDocxFormat(styleNodeForDocxFormat, 'rPr');
      var tablePropsForDocxFormat = firstChildForDocxFormat(styleNodeForDocxFormat, 'tblPr');
      var ownFormatForDocxFormat = readRunFormatForDocxFormat(runPropsForDocxFormat, themeFontsForDocxFormat);
      resultForDocxFormat.rawStyles[styleIdForDocxFormat] = {
        type: styleTypeForDocxFormat,
        basedOn: attrForDocxFormat(firstChildForDocxFormat(styleNodeForDocxFormat, 'basedOn'), 'val'),
        fontSizePt: ownFormatForDocxFormat.fontSizePt,
        fontFamily: ownFormatForDocxFormat.fontFamily,
        borders: readTableBordersForDocxFormat(firstChildForDocxFormat(tablePropsForDocxFormat, 'tblBorders'))
      };
      if (styleTypeForDocxFormat === 'paragraph' && attrForDocxFormat(styleNodeForDocxFormat, 'default') === '1') {
        resultForDocxFormat.defaultParagraphStyleId = styleIdForDocxFormat;
      }
    });
    return resultForDocxFormat;
  }

  function resolveStyleChainForDocxFormat(rawStylesForDocxFormat, styleIdForDocxFormat) {
    var chainForDocxFormat = [];
    var seenForDocxFormat = {};
    var cursorForDocxFormat = String(styleIdForDocxFormat || '');
    var depthForDocxFormat = 0;
    while (cursorForDocxFormat && rawStylesForDocxFormat[cursorForDocxFormat] && !seenForDocxFormat[cursorForDocxFormat]
      && depthForDocxFormat < MAX_STYLE_CHAIN_DEPTH_FOR_DOCX_FORMAT) {
      seenForDocxFormat[cursorForDocxFormat] = true;
      chainForDocxFormat.unshift(rawStylesForDocxFormat[cursorForDocxFormat]);
      cursorForDocxFormat = rawStylesForDocxFormat[cursorForDocxFormat].basedOn;
      depthForDocxFormat++;
    }
    return chainForDocxFormat;
  }

  function resolveStyleFormatsForDocxFormat(readStylesResultForDocxFormat) {
    var rawStylesForDocxFormat = readStylesResultForDocxFormat.rawStyles;
    var resolvedForDocxFormat = {};
    Object.keys(rawStylesForDocxFormat).forEach(function (styleIdForDocxFormat) {
      var chainForDocxFormat = resolveStyleChainForDocxFormat(rawStylesForDocxFormat, styleIdForDocxFormat);
      var accumulatedForDocxFormat = { fontSizePt: 0, fontFamily: '', borders: null };
      chainForDocxFormat.forEach(function (linkForDocxFormat) {
        if (linkForDocxFormat.fontSizePt) accumulatedForDocxFormat.fontSizePt = linkForDocxFormat.fontSizePt;
        if (linkForDocxFormat.fontFamily) accumulatedForDocxFormat.fontFamily = linkForDocxFormat.fontFamily;
        if (linkForDocxFormat.borders) accumulatedForDocxFormat.borders = linkForDocxFormat.borders;
      });
      resolvedForDocxFormat[styleIdForDocxFormat] = accumulatedForDocxFormat;
    });
    return resolvedForDocxFormat;
  }

  function readSectionPropertiesForDocxFormat(documentRootForDocxFormat) {
    // The document's own page setup is the sectPr that is a direct child of w:body. A
    // multi-section document also carries a sectPr inside the w:pPr of each section-break
    // paragraph, and those appear earlier in the tree, so a plain descendant search would
    // report a mid-document section's page setup as the document's.
    var bodyNodeForDocxFormat = findDescendantForDocxFormat(documentRootForDocxFormat, 'body');
    var sectionNodeForDocxFormat = firstChildForDocxFormat(bodyNodeForDocxFormat, 'sectPr')
      || findDescendantForDocxFormat(documentRootForDocxFormat, 'sectPr');
    if (!sectionNodeForDocxFormat) return null;
    var pageSizeNodeForDocxFormat = firstChildForDocxFormat(sectionNodeForDocxFormat, 'pgSz');
    var pageMarginNodeForDocxFormat = firstChildForDocxFormat(sectionNodeForDocxFormat, 'pgMar');
    var widthPtForDocxFormat = twipsToPtForDocxFormat(attrForDocxFormat(pageSizeNodeForDocxFormat, 'w'));
    var heightPtForDocxFormat = twipsToPtForDocxFormat(attrForDocxFormat(pageSizeNodeForDocxFormat, 'h'));
    if (!widthPtForDocxFormat || !heightPtForDocxFormat) return null;
    return {
      widthPt: widthPtForDocxFormat,
      heightPt: heightPtForDocxFormat,
      marginTopPt: twipsToPtForDocxFormat(attrForDocxFormat(pageMarginNodeForDocxFormat, 'top')),
      marginRightPt: twipsToPtForDocxFormat(attrForDocxFormat(pageMarginNodeForDocxFormat, 'right')),
      marginBottomPt: twipsToPtForDocxFormat(attrForDocxFormat(pageMarginNodeForDocxFormat, 'bottom')),
      marginLeftPt: twipsToPtForDocxFormat(attrForDocxFormat(pageMarginNodeForDocxFormat, 'left'))
    };
  }

  // Tables are collected in document pre-order, which is the order mammoth emits <table> in,
  // so the two sequences can be zipped by position. The caller must verify the counts match
  // before trusting the pairing.
  function readTableFormatsForDocxFormat(documentRootForDocxFormat, resolvedStylesForDocxFormat) {
    var tablesForDocxFormat = [];
    walkAllForDocxFormat(documentRootForDocxFormat, function (nodeForDocxFormat) {
      if (nodeForDocxFormat.name !== 'tbl' || tablesForDocxFormat.length >= MAX_TABLES_FOR_DOCX_FORMAT) return;
      var tablePropsForDocxFormat = firstChildForDocxFormat(nodeForDocxFormat, 'tblPr');
      var directBordersForDocxFormat = readTableBordersForDocxFormat(firstChildForDocxFormat(tablePropsForDocxFormat, 'tblBorders'));
      var tableStyleIdForDocxFormat = attrForDocxFormat(firstChildForDocxFormat(tablePropsForDocxFormat, 'tblStyle'), 'val');
      var styleBordersForDocxFormat = (tableStyleIdForDocxFormat && resolvedStylesForDocxFormat[tableStyleIdForDocxFormat])
        ? resolvedStylesForDocxFormat[tableStyleIdForDocxFormat].borders
        : null;
      var effectiveBordersForDocxFormat = directBordersForDocxFormat || styleBordersForDocxFormat || null;
      tablesForDocxFormat.push({
        styleId: tableStyleIdForDocxFormat,
        bordered: !!(effectiveBordersForDocxFormat && effectiveBordersForDocxFormat.any),
        edges: effectiveBordersForDocxFormat ? effectiveBordersForDocxFormat.edges : null
      });
    });
    return tablesForDocxFormat;
  }

  function collectDirectRunValuesForDocxFormat(documentRootForDocxFormat, themeFontsForDocxFormat) {
    var sizesForDocxFormat = {};
    var familiesForDocxFormat = {};
    walkAllForDocxFormat(documentRootForDocxFormat, function (nodeForDocxFormat) {
      if (nodeForDocxFormat.name !== 'rPr') return;
      var sizePtForDocxFormat = halfPointsToPtForDocxFormat(attrForDocxFormat(firstChildForDocxFormat(nodeForDocxFormat, 'sz'), 'val'));
      if (sizePtForDocxFormat) sizesForDocxFormat[sizePtForDocxFormat] = true;
      var familyForDocxFormat = fontFamilyFromRunPropsForDocxFormat(nodeForDocxFormat, themeFontsForDocxFormat);
      if (familyForDocxFormat) familiesForDocxFormat[familyForDocxFormat] = true;
    });
    return { sizes: sizesForDocxFormat, families: familiesForDocxFormat };
  }

  function analyzeDocxPartsForDocxFormat(partsForDocxFormat) {
    var safePartsForDocxFormat = partsForDocxFormat || {};
    var themeFontsForDocxFormat = readThemeFontsForDocxFormat(safePartsForDocxFormat.themeXml);
    var readStylesResultForDocxFormat = readStylesForDocxFormat(safePartsForDocxFormat.stylesXml, themeFontsForDocxFormat);
    var resolvedStylesForDocxFormat = resolveStyleFormatsForDocxFormat(readStylesResultForDocxFormat);
    var documentRootForDocxFormat = parseXmlForDocxFormat(safePartsForDocxFormat.documentXml || '');

    var defaultParagraphFormatForDocxFormat = resolvedStylesForDocxFormat[readStylesResultForDocxFormat.defaultParagraphStyleId]
      || { fontSizePt: 0, fontFamily: '' };
    var defaultFontSizePtForDocxFormat = defaultParagraphFormatForDocxFormat.fontSizePt
      || readStylesResultForDocxFormat.docDefaults.fontSizePt
      || 0;
    var defaultFontFamilyForDocxFormat = defaultParagraphFormatForDocxFormat.fontFamily
      || readStylesResultForDocxFormat.docDefaults.fontFamily
      || '';

    var directValuesForDocxFormat = collectDirectRunValuesForDocxFormat(documentRootForDocxFormat, themeFontsForDocxFormat);
    var sizeSetForDocxFormat = directValuesForDocxFormat.sizes;
    var familySetForDocxFormat = directValuesForDocxFormat.families;
    Object.keys(resolvedStylesForDocxFormat).forEach(function (styleIdForDocxFormat) {
      var styleFormatForDocxFormat = resolvedStylesForDocxFormat[styleIdForDocxFormat];
      if (styleFormatForDocxFormat.fontSizePt) sizeSetForDocxFormat[styleFormatForDocxFormat.fontSizePt] = true;
      if (styleFormatForDocxFormat.fontFamily) familySetForDocxFormat[styleFormatForDocxFormat.fontFamily] = true;
    });
    if (defaultFontSizePtForDocxFormat) sizeSetForDocxFormat[defaultFontSizePtForDocxFormat] = true;
    if (defaultFontFamilyForDocxFormat) familySetForDocxFormat[defaultFontFamilyForDocxFormat] = true;

    return {
      defaultFontSizePt: defaultFontSizePtForDocxFormat,
      defaultFontFamily: defaultFontFamilyForDocxFormat,
      page: readSectionPropertiesForDocxFormat(documentRootForDocxFormat),
      styleFormats: resolvedStylesForDocxFormat,
      tables: readTableFormatsForDocxFormat(documentRootForDocxFormat, resolvedStylesForDocxFormat),
      sizes: Object.keys(sizeSetForDocxFormat).map(Number).filter(function (sizeForDocxFormat) {
        return sizeForDocxFormat > 0;
      }).sort(function (aForDocxFormat, bForDocxFormat) {
        return aForDocxFormat - bForDocxFormat;
      }).slice(0, MAX_DISTINCT_SIZES_FOR_DOCX_FORMAT),
      families: Object.keys(familySetForDocxFormat).slice(0, MAX_DISTINCT_FAMILIES_FOR_DOCX_FORMAT)
    };
  }

  // Every (size, family) pair the document can produce gets a synthetic character style id.
  // mammoth's style map cannot be built from inside its own transform, so the pairs are
  // enumerated up front from the values that actually occur in styles.xml and document.xml.
  function buildFormatClassPlanForDocxFormat(profileForDocxFormat) {
    var sizesForPlan = (profileForDocxFormat.sizes || []).slice();
    var familiesForPlan = (profileForDocxFormat.families || []).slice();
    var defaultSizeForPlan = profileForDocxFormat.defaultFontSizePt || 0;
    var defaultFamilyForPlan = profileForDocxFormat.defaultFontFamily || '';
    if (sizesForPlan.indexOf(defaultSizeForPlan) < 0 && defaultSizeForPlan) sizesForPlan.push(defaultSizeForPlan);
    if (familiesForPlan.indexOf(defaultFamilyForPlan) < 0 && defaultFamilyForPlan) familiesForPlan.push(defaultFamilyForPlan);
    if (!sizesForPlan.length) sizesForPlan = [defaultSizeForPlan];
    if (!familiesForPlan.length) familiesForPlan = [defaultFamilyForPlan];

    var includeFamilyForPlan = (sizesForPlan.length * familiesForPlan.length) <= MAX_FORMAT_CLASSES_FOR_DOCX_FORMAT;
    if (!includeFamilyForPlan) familiesForPlan = [defaultFamilyForPlan];

    var styleMapForPlan = [];
    var cssByClassIndexForPlan = {};
    var indexByKeyForPlan = {};
    var nextIndexForPlan = 1;

    function keyForPlan(sizePtForPlan, familyForPlan) {
      return String(sizePtForPlan || 0) + '|' + String(familyForPlan || '');
    }

    sizesForPlan.forEach(function (sizePtForPlan) {
      familiesForPlan.forEach(function (familyForPlan) {
        if (nextIndexForPlan > MAX_FORMAT_CLASSES_FOR_DOCX_FORMAT) return;
        var isDefaultSizeForPlan = !sizePtForPlan || sizePtForPlan === defaultSizeForPlan;
        var isDefaultFamilyForPlan = !familyForPlan || familyForPlan === defaultFamilyForPlan;
        if (isDefaultSizeForPlan && isDefaultFamilyForPlan) return;
        var declarationsForPlan = [];
        if (!isDefaultSizeForPlan) declarationsForPlan.push('font-size:' + sizePtForPlan + 'pt');
        if (!isDefaultFamilyForPlan) declarationsForPlan.push('font-family:' + familyForPlan);
        if (!declarationsForPlan.length) return;
        var indexForPlan = nextIndexForPlan++;
        indexByKeyForPlan[keyForPlan(sizePtForPlan, familyForPlan)] = indexForPlan;
        cssByClassIndexForPlan[indexForPlan] = declarationsForPlan.join(';');
        styleMapForPlan.push('r.AbchatFmt' + indexForPlan + ' => span.abchat-fmt-' + indexForPlan);
      });
    });

    return {
      styleMap: styleMapForPlan,
      cssByClassIndex: cssByClassIndexForPlan,
      styleIdFor: function (sizePtForPlan, familyForPlan) {
        var resolvedIndexForPlan = indexByKeyForPlan[keyForPlan(sizePtForPlan, familyForPlan)];
        if (resolvedIndexForPlan) return 'AbchatFmt' + resolvedIndexForPlan;
        if (!includeFamilyForPlan) {
          var sizeOnlyIndexForPlan = indexByKeyForPlan[keyForPlan(sizePtForPlan, defaultFamilyForPlan)];
          if (sizeOnlyIndexForPlan) return 'AbchatFmt' + sizeOnlyIndexForPlan;
        }
        return '';
      }
    };
  }

  function buildTableBorderCssForDocxFormat(tableFormatForDocxFormat) {
    if (!tableFormatForDocxFormat || !tableFormatForDocxFormat.bordered || !tableFormatForDocxFormat.edges) return '';
    var edgesForDocxFormat = tableFormatForDocxFormat.edges;
    function declarationForDocxFormat(edgeForDocxFormat) {
      if (!edgeForDocxFormat) return 'none';
      return edgeForDocxFormat.widthPt + 'pt solid #' + edgeForDocxFormat.color;
    }
    var outerNamesForDocxFormat = ['top', 'right', 'bottom', 'left'];
    var renderedForDocxFormat = {};
    BORDER_EDGE_NAMES_FOR_DOCX_FORMAT.forEach(function (edgeNameForDocxFormat) {
      renderedForDocxFormat[edgeNameForDocxFormat] = declarationForDocxFormat(edgesForDocxFormat[edgeNameForDocxFormat]);
    });
    var allSameForDocxFormat = BORDER_EDGE_NAMES_FOR_DOCX_FORMAT.every(function (edgeNameForDocxFormat) {
      return renderedForDocxFormat[edgeNameForDocxFormat] === renderedForDocxFormat.top;
    });
    if (allSameForDocxFormat) return 'border:' + renderedForDocxFormat.top;

    var declarationsForDocxFormat = [];
    var outerSameForDocxFormat = outerNamesForDocxFormat.every(function (edgeNameForDocxFormat) {
      return renderedForDocxFormat[edgeNameForDocxFormat] === renderedForDocxFormat.top;
    });
    if (outerSameForDocxFormat) {
      declarationsForDocxFormat.push('border:' + renderedForDocxFormat.top);
    } else {
      outerNamesForDocxFormat.forEach(function (edgeNameForDocxFormat) {
        declarationsForDocxFormat.push('border-' + edgeNameForDocxFormat + ':' + renderedForDocxFormat[edgeNameForDocxFormat]);
      });
    }
    // No standard CSS property addresses a table's interior gridlines independently of its
    // frame, and w:tblBorders does, so the two inside edges ride custom properties.
    declarationsForDocxFormat.push('--border-inside-h:' + renderedForDocxFormat.insideH);
    declarationsForDocxFormat.push('--border-inside-v:' + renderedForDocxFormat.insideV);
    return declarationsForDocxFormat.join(';');
  }

  function buildDocumentDefaultsCssForDocxFormat(profileForDocxFormat) {
    var declarationsForDocxFormat = [];
    if (profileForDocxFormat.defaultFontFamily) declarationsForDocxFormat.push('font-family:' + profileForDocxFormat.defaultFontFamily);
    if (profileForDocxFormat.defaultFontSizePt) declarationsForDocxFormat.push('font-size:' + profileForDocxFormat.defaultFontSizePt + 'pt');
    var pageForDocxFormat = profileForDocxFormat.page;
    if (pageForDocxFormat) {
      declarationsForDocxFormat.push('page-width:' + pageForDocxFormat.widthPt + 'pt');
      declarationsForDocxFormat.push('page-height:' + pageForDocxFormat.heightPt + 'pt');
      declarationsForDocxFormat.push('margin:' + pageForDocxFormat.marginTopPt + 'pt ' + pageForDocxFormat.marginRightPt + 'pt '
        + pageForDocxFormat.marginBottomPt + 'pt ' + pageForDocxFormat.marginLeftPt + 'pt');
    }
    return declarationsForDocxFormat.join('; ');
  }

  agentNamespaceForDocxFormat.docxFormat = {
    parseXml: parseXmlForDocxFormat,
    normalizeFontFamily: normalizeFontFamilyForDocxFormat,
    analyzeParts: analyzeDocxPartsForDocxFormat,
    buildFormatClassPlan: buildFormatClassPlanForDocxFormat,
    buildTableBorderCss: buildTableBorderCssForDocxFormat,
    buildDocumentDefaultsCss: buildDocumentDefaultsCssForDocxFormat
  };

  globalScopeForDocxFormat.ABChatAgent = agentNamespaceForDocxFormat;
})();
