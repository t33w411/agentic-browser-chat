// The decisions behind converting a DOCX to a PDF that need no DOM: which files the converter
// refuses, where a shape anchored to the page goes, how a text box is outlined, how many lines of a
// paragraph stay on a page, what a page-number field shows, and how the stylesheet reaches
// paragraphs the converter renamed. agent/docxToPdf.js does the rendering and the measuring, and
// asks this file what to do with what it measured.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the offscreen
// document and exports through the CommonJS tail under Node (`module` is undefined in the browser,
// so that branch is inert there).

(function () {
  const globalScopeForDocxPdfRules = globalThis;
  const nsForDocxPdfRules = globalScopeForDocxPdfRules.ABChatAgent || {};

  // Vertical anchors that place a shape on the page rather than beside its paragraph.
  const PAGE_RELATIVE_V_FOR_DOCX_PDF_RULES = ['page', 'margin', 'topmargin', 'bottommargin', 'insidemargin', 'outsidemargin'];
  const PAGE_RELATIVE_VML_V_FOR_DOCX_PDF_RULES = ['page', 'margin', 'top-margin-area', 'bottom-margin-area', 'inner-margin-area', 'outer-margin-area'];

  // A page-anchored shape this tall or wide is part of the page's design (a sidebar, a banner, a
  // full-page background), and the text around it was laid out against it.
  const LARGE_SHAPE_SHARE_FOR_DOCX_PDF_RULES = 0.5;

  const DEFAULT_PAGE_FOR_DOCX_PDF_RULES = { width: 612, height: 792 };

  function numberOrNullForDocxPdfRules(valueForNumber) {
    const parsedForNumber = Number(valueForNumber);
    return Number.isFinite(parsedForNumber) ? parsedForNumber : null;
  }

  // The size of the body's last section, in points. Word writes it on the final w:sectPr.
  function pageSizeForDocxPdfRules(documentXml) {
    const sizesForPage = String(documentXml || '').match(/<w:pgSz\b[^>]*>/g) || [];
    const lastForPage = sizesForPage[sizesForPage.length - 1] || '';
    const widthForPage = numberOrNullForDocxPdfRules((/\bw:w="(\d+)"/.exec(lastForPage) || [])[1]);
    const heightForPage = numberOrNullForDocxPdfRules((/\bw:h="(\d+)"/.exec(lastForPage) || [])[1]);
    return {
      width: widthForPage ? widthForPage / 20 : DEFAULT_PAGE_FOR_DOCX_PDF_RULES.width,
      height: heightForPage ? heightForPage / 20 : DEFAULT_PAGE_FOR_DOCX_PDF_RULES.height
    };
  }

  // The parts of document.xml Word reads. An mc:Fallback holds an older copy of a shape whose
  // mc:Choice was read, so a shape is not counted twice.
  function withoutFallbacksForDocxPdfRules(xmlForStrip) {
    return String(xmlForStrip || '').replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');
  }

  // Reasons a converted file would not look like the Word file, worked out from document.xml alone.
  // Returns { ok: true } or { ok: false, reason }, where reason is one short phrase.
  //
  // Refused: a text box anchored to the page or its margins, a shape anchored there that covers
  // half the page's height or width, and a frame placed on the page. Each puts content at a fixed
  // place on the page while the text flows around it, which this converter cannot lay out: a
  // sidebar CV came out with a blank first page and its sidebar text two pages from the main text.
  // A shape anchored to its paragraph (most text boxes and pictures) is fine, and so is a page
  // anchored picture smaller than that, such as a logo, which the converter places.
  function preflightForDocxPdfRules(documentXml) {
    const xmlForPreflight = withoutFallbacksForDocxPdfRules(documentXml);
    if (!/<w:body\b/.test(xmlForPreflight)) return { ok: false, reason: 'not a Word document' };
    const pageForPreflight = pageSizeForDocxPdfRules(xmlForPreflight);

    const anchorsForPreflight = xmlForPreflight.match(/<wp:anchor\b[\s\S]*?<\/wp:anchor>/g) || [];
    for (let indexForAnchor = 0; indexForAnchor < anchorsForPreflight.length; indexForAnchor++) {
      const anchorXml = anchorsForPreflight[indexForAnchor];
      const relativeV = String((/<wp:positionV\b[^>]*\brelativeFrom="([^"]+)"/.exec(anchorXml) || [])[1] || '').toLowerCase();
      if (PAGE_RELATIVE_V_FOR_DOCX_PDF_RULES.indexOf(relativeV) === -1) continue;
      if (/<wps:txbx\b|<w:txbxContent\b/.test(anchorXml)) return { ok: false, reason: 'a text box placed on the page' };
      const extentForAnchor = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(anchorXml);
      if (extentForAnchor && isLargeForDocxPdfRules(Number(extentForAnchor[1]) / 12700, Number(extentForAnchor[2]) / 12700, pageForPreflight)) {
        return { ok: false, reason: 'a shape placed on the page that covers much of it, such as a sidebar or banner' };
      }
    }

    const vmlShapesForPreflight = xmlForPreflight.match(/<v:(?:shape|rect|roundrect|oval)\b[\s\S]*?<\/v:(?:shape|rect|roundrect|oval)>/g) || [];
    for (let indexForVml = 0; indexForVml < vmlShapesForPreflight.length; indexForVml++) {
      const shapeXml = vmlShapesForPreflight[indexForVml];
      const styleForShape = vmlStyleForDocxPdfRules((/\bstyle="([^"]*)"/.exec(shapeXml) || [])[1] || '');
      if (styleForShape.position !== 'absolute') continue;
      if (PAGE_RELATIVE_VML_V_FOR_DOCX_PDF_RULES.indexOf(styleForShape.vRelative) === -1) continue;
      if (/<v:textbox\b/.test(shapeXml)) return { ok: false, reason: 'a text box placed on the page' };
      if (isLargeForDocxPdfRules(styleForShape.width || 0, styleForShape.height || 0, pageForPreflight)) {
        return { ok: false, reason: 'a shape placed on the page that covers much of it, such as a sidebar or banner' };
      }
    }

    const framesForPreflight = xmlForPreflight.match(/<w:framePr\b[^>]*>/g) || [];
    for (let indexForFrame = 0; indexForFrame < framesForPreflight.length; indexForFrame++) {
      const frameXml = framesForPreflight[indexForFrame];
      if (/\bw:dropCap="(?:drop|margin)"/.test(frameXml)) continue;
      const anchorForFrame = String((/\bw:vAnchor="([^"]+)"/.exec(frameXml) || [])[1] || 'margin').toLowerCase();
      if ((anchorForFrame === 'page' || anchorForFrame === 'margin') && /\bw:(?:y|yAlign)="/.test(frameXml)) {
        return { ok: false, reason: 'text placed on the page in a frame' };
      }
    }
    return { ok: true, page: pageForPreflight };
  }

  function isLargeForDocxPdfRules(widthPt, heightPt, pageForLarge) {
    return heightPt >= pageForLarge.height * LARGE_SHAPE_SHARE_FOR_DOCX_PDF_RULES
      || widthPt >= pageForLarge.width * LARGE_SHAPE_SHARE_FOR_DOCX_PDF_RULES;
  }

  // A VML length in points. A bare number is in CSS pixels, as VML reads it.
  function vmlLengthForDocxPdfRules(valueForLength) {
    const matchForLength = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|px|pc|emu)?\s*$/i.exec(String(valueForLength == null ? '' : valueForLength));
    if (!matchForLength) return null;
    const amountForLength = Number(matchForLength[1]);
    if (!Number.isFinite(amountForLength)) return null;
    switch ((matchForLength[2] || 'px').toLowerCase()) {
      case 'pt': return amountForLength;
      case 'in': return amountForLength * 72;
      case 'cm': return amountForLength * 72 / 2.54;
      case 'mm': return amountForLength * 72 / 25.4;
      case 'pc': return amountForLength * 12;
      case 'emu': return amountForLength / 12700;
      default: return amountForLength * 0.75;
    }
  }

  const VML_FALSE_FOR_DOCX_PDF_RULES = /^\s*(?:f|false|0|off)\s*$/i;

  // A VML colour as a hex value or a plain colour name. What follows the first word ("red [3213]")
  // is Word's own colour index and is dropped.
  function vmlColorForDocxPdfRules(valueForColor, fallbackForColor) {
    const firstForColor = String(valueForColor == null ? '' : valueForColor).trim().split(/\s+/)[0] || '';
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(firstForColor) || /^[a-z]{3,20}$/i.test(firstForColor)) return firstForColor.toLowerCase();
    return fallbackForColor;
  }

  // How a VML text box is drawn: its outline width and colour, its fill (null for none) and its
  // inner margins, in points. What the file leaves out takes VML's defaults: a 0.75 pt black
  // outline, a white fill, and margins of 0.1 in at the sides and 0.05 in above and below.
  // record: { stroked, strokeColor, strokeWeight, filled, fillColor, inset }, as the file has them.
  function vmlBoxLookForDocxPdfRules(record) {
    const safeRecord = record || {};
    const stroked = safeRecord.stroked == null || !VML_FALSE_FOR_DOCX_PDF_RULES.test(safeRecord.stroked);
    const filled = safeRecord.filled == null || !VML_FALSE_FOR_DOCX_PDF_RULES.test(safeRecord.filled);
    const weight = vmlLengthForDocxPdfRules(safeRecord.strokeWeight);
    const insetParts = String(safeRecord.inset == null ? '' : safeRecord.inset).split(',');
    const inset = [7.2, 3.6, 7.2, 3.6].map(function (fallbackForInset, indexForInset) {
      const valueForInset = vmlLengthForDocxPdfRules(insetParts[indexForInset]);
      return valueForInset === null || valueForInset < 0 ? fallbackForInset : valueForInset;
    });
    return {
      borderWidth: stroked ? (weight !== null && weight >= 0 ? weight : 0.75) : 0,
      borderColor: vmlColorForDocxPdfRules(safeRecord.strokeColor, 'black'),
      background: filled ? vmlColorForDocxPdfRules(safeRecord.fillColor, 'white') : null,
      padding: { left: inset[0], top: inset[1], right: inset[2], bottom: inset[3] }
    };
  }

  // The parts of a VML style attribute that place a shape.
  function vmlStyleForDocxPdfRules(styleText) {
    const declarationsForStyle = {};
    String(styleText || '').split(';').forEach(function (declarationForStyle) {
      const colonForStyle = declarationForStyle.indexOf(':');
      if (colonForStyle === -1) return;
      declarationsForStyle[declarationForStyle.slice(0, colonForStyle).trim().toLowerCase()] = declarationForStyle.slice(colonForStyle + 1).trim();
    });
    const zIndexForStyle = numberOrNullForDocxPdfRules(declarationsForStyle['z-index']);
    return {
      position: String(declarationsForStyle.position || '').toLowerCase(),
      width: vmlLengthForDocxPdfRules(declarationsForStyle.width),
      height: vmlLengthForDocxPdfRules(declarationsForStyle.height),
      left: vmlLengthForDocxPdfRules(declarationsForStyle['margin-left'] || declarationsForStyle.left) || 0,
      top: vmlLengthForDocxPdfRules(declarationsForStyle['margin-top'] || declarationsForStyle.top) || 0,
      hAlign: String(declarationsForStyle['mso-position-horizontal'] || '').toLowerCase(),
      hRelative: String(declarationsForStyle['mso-position-horizontal-relative'] || 'text').toLowerCase(),
      vAlign: String(declarationsForStyle['mso-position-vertical'] || '').toLowerCase(),
      vRelative: String(declarationsForStyle['mso-position-vertical-relative'] || 'text').toLowerCase(),
      behind: zIndexForStyle !== null && zIndexForStyle < 0
    };
  }

  // page: { width, height, margins: { top, right, bottom, left } }, in points.
  function spanForDocxPdfRules(relative, page, horizontal) {
    const marginsForSpan = page.margins || { top: 0, right: 0, bottom: 0, left: 0 };
    if (horizontal) {
      switch (relative) {
        case 'page': return [0, page.width];
        case 'leftmargin': case 'left-margin-area': case 'insidemargin': case 'inner-margin-area': return [0, marginsForSpan.left];
        case 'rightmargin': case 'right-margin-area': case 'outsidemargin': case 'outer-margin-area': return [page.width - marginsForSpan.right, page.width];
        default: return [marginsForSpan.left, page.width - marginsForSpan.right];
      }
    }
    switch (relative) {
      case 'page': return [0, page.height];
      case 'topmargin': case 'top-margin-area': return [0, marginsForSpan.top];
      case 'bottommargin': case 'bottom-margin-area': return [page.height - marginsForSpan.bottom, page.height];
      case 'margin': case 'insidemargin': case 'outsidemargin': case 'inner-margin-area': case 'outer-margin-area':
        return [marginsForSpan.top, page.height - marginsForSpan.bottom];
      default: return null;
    }
  }

  function placeForDocxPdfRules(span, size, align, offset) {
    switch (align) {
      case 'center': return span[0] + (span[1] - span[0] - size) / 2;
      case 'right': case 'bottom': case 'outside': return span[1] - size;
      case 'left': case 'top': case 'inside': return span[0];
      default: return span[0] + (offset || 0);
    }
  }

  // Where a VML shape sits on its page, in points from the page's top left, or null when it is not
  // placed on the page (inline, or anchored to its paragraph).
  function vmlBoxForDocxPdfRules(style, page) {
    if (!style || style.position !== 'absolute' || !(style.width > 0) || !(style.height > 0)) return null;
    const verticalSpan = spanForDocxPdfRules(style.vRelative, page, false);
    if (!verticalSpan) return null;
    const horizontalSpan = spanForDocxPdfRules(style.hRelative, page, true);
    return {
      left: placeForDocxPdfRules(horizontalSpan, style.width, style.hAlign, style.left),
      top: placeForDocxPdfRules(verticalSpan, style.height, style.vAlign, style.top),
      width: style.width,
      height: style.height,
      behind: !!style.behind
    };
  }

  // The same for a DrawingML anchor, as the patched docx-preview records it:
  // { h, v, alignH, alignV, x, y, behind } with x and y in points.
  function anchorBoxForDocxPdfRules(anchor, size, page) {
    if (!anchor || !size || !(size.width > 0) || !(size.height > 0)) return null;
    const verticalSpan = spanForDocxPdfRules(String(anchor.v || '').toLowerCase(), page, false);
    if (!verticalSpan) return null;
    const horizontalSpan = spanForDocxPdfRules(String(anchor.h || '').toLowerCase(), page, true);
    return {
      left: placeForDocxPdfRules(horizontalSpan, size.width, anchor.alignH, anchor.x),
      top: placeForDocxPdfRules(verticalSpan, size.height, anchor.alignV, anchor.y),
      width: size.width,
      height: size.height,
      behind: !!anchor.behind
    };
  }

  // How many of a paragraph's lines stay on the page when only `fit` of its `total` lines fit.
  // 0 moves it whole to the next page. Word's widow and orphan control keeps at least two lines on
  // each side of a break, so a paragraph of three lines or fewer never splits, and keep-lines never
  // splits one. A paragraph that starts its page cannot move, so it splits where it must.
  function linesToKeepForDocxPdfRules(total, fit, rules) {
    const safeRules = rules || {};
    if (fit >= total) return total;
    if (fit <= 0) return safeRules.firstOnPage ? 1 : 0;
    let keepForLines = fit;
    if (safeRules.keepLines) keepForLines = 0;
    else if (safeRules.widowControl !== false) {
      if (total - keepForLines < 2) keepForLines = total - 2;
      if (keepForLines < 2) keepForLines = 0;
    }
    if (keepForLines === 0 && safeRules.firstOnPage) return fit;
    return keepForLines;
  }

  // What a page-number field shows on a page.
  function fieldTextForDocxPdfRules(kind, pageNumber, pageCount, sectionPageCount) {
    if (kind === 'page') return String(pageNumber);
    if (kind === 'numpages') return String(pageCount);
    if (kind === 'sectionpages') return String(sectionPageCount);
    return '';
  }

  // Which header or footer variant a page uses: the section's first-page one on its first page
  // when the section asks for it, the even one on even pages when the document does, and the
  // default one otherwise. pageNumber counts from 1 across the document, as Word's does.
  function headerVariantForDocxPdfRules(variants, firstOfSection, titlePage, evenAndOdd, pageNumber) {
    const safeVariants = variants || {};
    if (titlePage && firstOfSection && safeVariants.first) return 'first';
    if (evenAndOdd && pageNumber % 2 === 0 && safeVariants.even) return 'even';
    return safeVariants.default ? 'default' : null;
  }

  // Gives every rule that selects p by its tag the paragraphs the converter renamed to
  // span.abchat-as-p (a paragraph inside a text box, which HTML does not allow inside a paragraph)
  // as well. :where adds nothing to the specificity, so both match each rule as strongly as a p did.
  // Only selectors are rewritten: the text before each "{", never a declaration.
  function paragraphSelectorsForDocxPdfRules(cssText) {
    return String(cssText || '').replace(/([^{}@;]+)\{/g, function (whole, selectorText) {
      return selectorText.replace(/(^|[\s>+~,(])p(?=[\s.#:[>+~,)]|$)/g, '$1:is(p, :where(.abchat-as-p))') + '{';
    });
  }

  nsForDocxPdfRules.docxPdfRules = {
    preflight: preflightForDocxPdfRules,
    pageSize: pageSizeForDocxPdfRules,
    vmlStyle: vmlStyleForDocxPdfRules,
    vmlLength: vmlLengthForDocxPdfRules,
    vmlBox: vmlBoxForDocxPdfRules,
    vmlBoxLook: vmlBoxLookForDocxPdfRules,
    anchorBox: anchorBoxForDocxPdfRules,
    linesToKeep: linesToKeepForDocxPdfRules,
    fieldText: fieldTextForDocxPdfRules,
    headerVariant: headerVariantForDocxPdfRules,
    paragraphSelectors: paragraphSelectorsForDocxPdfRules
  };

  globalScopeForDocxPdfRules.ABChatAgent = nsForDocxPdfRules;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForDocxPdfRules.docxPdfRules;
  }
})();
