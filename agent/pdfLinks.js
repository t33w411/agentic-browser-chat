(function () {
  var globalScopeForPdfLinks = globalThis;
  var agentNamespaceForPdfLinks = globalScopeForPdfLinks.ABChatAgent || {};

  // A link is only rendered inline when its target is one of these. PDF Link annotations that
  // point at an internal destination (GoTo / named dest) carry no URL and are skipped: there is
  // nothing to show the model, and the anchor text is already in the extracted run.
  var LINK_SCHEME_RE_FOR_PDF_LINKS = /^(https?:|mailto:)/i;

  // How far, in viewport units, a text item's centre may sit outside a link rect and still count
  // as inside it. Link rects usually bound their text with a little slack already, so this only
  // absorbs baseline/height estimation noise, not a full glyph.
  var HIT_PADDING_FOR_PDF_LINKS = 1;

  function isFiniteNumberForPdfLinks(valueForPdfLinks) {
    return typeof valueForPdfLinks === 'number' && Number.isFinite(valueForPdfLinks);
  }

  // Apply a pdf.js affine matrix [a,b,c,d,e,f] to a point, returning [x, y]. This is the same
  // transform buildPdfItems composes for text items, so annotation rects land in the identical
  // viewport space and their coordinates are directly comparable to item boxes.
  function applyTransformForPdfLinks(matrixForPdfLinks, xForPdfLinks, yForPdfLinks) {
    return [
      matrixForPdfLinks[0] * xForPdfLinks + matrixForPdfLinks[2] * yForPdfLinks + matrixForPdfLinks[4],
      matrixForPdfLinks[1] * xForPdfLinks + matrixForPdfLinks[3] * yForPdfLinks + matrixForPdfLinks[5]
    ];
  }

  // Turn pdf.js page annotations into viewport-space link rects. Each rect is transformed with the
  // page's viewport transform (the same one applied to text items) and its corners normalized to
  // left/top/right/bottom, because the y-flip in that transform swaps the raw min/max.
  function annotationsToLinkRectsForPdfLinks(annotationsForPdfLinks, viewportTransformForPdfLinks) {
    var rectsForPdfLinks = [];
    if (!Array.isArray(annotationsForPdfLinks)) return rectsForPdfLinks;
    if (!Array.isArray(viewportTransformForPdfLinks) || viewportTransformForPdfLinks.length < 6) {
      return rectsForPdfLinks;
    }
    for (var iForPdfLinks = 0; iForPdfLinks < annotationsForPdfLinks.length; iForPdfLinks++) {
      var annForPdfLinks = annotationsForPdfLinks[iForPdfLinks];
      if (!annForPdfLinks || annForPdfLinks.subtype !== 'Link') continue;
      var urlForPdfLinks = typeof annForPdfLinks.url === 'string' ? annForPdfLinks.url.trim() : '';
      if (!urlForPdfLinks || !LINK_SCHEME_RE_FOR_PDF_LINKS.test(urlForPdfLinks)) continue;
      var rectForPdfLinks = annForPdfLinks.rect;
      if (!Array.isArray(rectForPdfLinks) || rectForPdfLinks.length < 4) continue;
      if (!isFiniteNumberForPdfLinks(rectForPdfLinks[0]) || !isFiniteNumberForPdfLinks(rectForPdfLinks[1])
        || !isFiniteNumberForPdfLinks(rectForPdfLinks[2]) || !isFiniteNumberForPdfLinks(rectForPdfLinks[3])) {
        continue;
      }
      var cornerAForPdfLinks = applyTransformForPdfLinks(viewportTransformForPdfLinks, rectForPdfLinks[0], rectForPdfLinks[1]);
      var cornerBForPdfLinks = applyTransformForPdfLinks(viewportTransformForPdfLinks, rectForPdfLinks[2], rectForPdfLinks[3]);
      if (!isFiniteNumberForPdfLinks(cornerAForPdfLinks[0]) || !isFiniteNumberForPdfLinks(cornerAForPdfLinks[1])
        || !isFiniteNumberForPdfLinks(cornerBForPdfLinks[0]) || !isFiniteNumberForPdfLinks(cornerBForPdfLinks[1])) {
        continue;
      }
      rectsForPdfLinks.push({
        url: urlForPdfLinks,
        left: Math.min(cornerAForPdfLinks[0], cornerBForPdfLinks[0]),
        right: Math.max(cornerAForPdfLinks[0], cornerBForPdfLinks[0]),
        top: Math.min(cornerAForPdfLinks[1], cornerBForPdfLinks[1]),
        bottom: Math.max(cornerAForPdfLinks[1], cornerBForPdfLinks[1])
      });
    }
    return rectsForPdfLinks;
  }

  function itemCentreWithinRectForPdfLinks(itemForPdfLinks, rectForPdfLinks) {
    var centreXForPdfLinks = (itemForPdfLinks.x + itemForPdfLinks.end) / 2;
    // item.y is the baseline; the glyph occupies roughly [y - height, y], so its vertical midline
    // is y - height/2.
    var heightForPdfLinks = isFiniteNumberForPdfLinks(itemForPdfLinks.height) ? itemForPdfLinks.height : 0;
    var centreYForPdfLinks = itemForPdfLinks.y - heightForPdfLinks / 2;
    return centreXForPdfLinks >= rectForPdfLinks.left - HIT_PADDING_FOR_PDF_LINKS
      && centreXForPdfLinks <= rectForPdfLinks.right + HIT_PADDING_FOR_PDF_LINKS
      && centreYForPdfLinks >= rectForPdfLinks.top - HIT_PADDING_FOR_PDF_LINKS
      && centreYForPdfLinks <= rectForPdfLinks.bottom + HIT_PADDING_FOR_PDF_LINKS;
  }

  // Tag each text item whose centre falls inside a link rect with that rect's url (first match
  // wins; page links do not overlap in practice). Items already carry viewport-space x/end/y from
  // buildPdfItems, so this mutates them in place and the tag survives line/column grouping.
  function assignLinkUrlsToItemsForPdfLinks(itemsForPdfLinks, linkRectsForPdfLinks) {
    if (!Array.isArray(itemsForPdfLinks) || !Array.isArray(linkRectsForPdfLinks) || !linkRectsForPdfLinks.length) {
      return itemsForPdfLinks;
    }
    for (var iForPdfLinks = 0; iForPdfLinks < itemsForPdfLinks.length; iForPdfLinks++) {
      var itemForPdfLinks = itemsForPdfLinks[iForPdfLinks];
      if (!itemForPdfLinks
        || !isFiniteNumberForPdfLinks(itemForPdfLinks.x)
        || !isFiniteNumberForPdfLinks(itemForPdfLinks.end)
        || !isFiniteNumberForPdfLinks(itemForPdfLinks.y)) {
        continue;
      }
      for (var jForPdfLinks = 0; jForPdfLinks < linkRectsForPdfLinks.length; jForPdfLinks++) {
        if (itemCentreWithinRectForPdfLinks(itemForPdfLinks, linkRectsForPdfLinks[jForPdfLinks])) {
          itemForPdfLinks.linkUrl = linkRectsForPdfLinks[jForPdfLinks].url;
          break;
        }
      }
    }
    return itemsForPdfLinks;
  }

  // Render a linked run as "text (url)", matching the DOCX serializer. A run whose visible text is
  // empty or is already the url collapses to the url alone; anything without a supported scheme is
  // returned as its text with no suffix.
  function formatLinkedTextForPdfLinks(textForPdfLinks, urlForPdfLinks) {
    var rawTextForPdfLinks = String(textForPdfLinks || '');
    var trimmedUrlForPdfLinks = String(urlForPdfLinks || '').trim();
    if (!LINK_SCHEME_RE_FOR_PDF_LINKS.test(trimmedUrlForPdfLinks)) return rawTextForPdfLinks;
    var trimmedTextForPdfLinks = rawTextForPdfLinks.trim();
    if (!trimmedTextForPdfLinks) return trimmedUrlForPdfLinks;
    if (trimmedTextForPdfLinks.toLowerCase() === trimmedUrlForPdfLinks.toLowerCase()) {
      return trimmedUrlForPdfLinks;
    }
    return rawTextForPdfLinks + ' (' + trimmedUrlForPdfLinks + ')';
  }

  agentNamespaceForPdfLinks.pdfLinks = {
    annotationsToLinkRects: annotationsToLinkRectsForPdfLinks,
    assignLinkUrlsToItems: assignLinkUrlsToItemsForPdfLinks,
    formatLinkedText: formatLinkedTextForPdfLinks
  };

  globalScopeForPdfLinks.ABChatAgent = agentNamespaceForPdfLinks;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = agentNamespaceForPdfLinks.pdfLinks;
  }
})();
