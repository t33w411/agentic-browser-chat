(function () {
  var globalScopeForDocxTextFromHtml = globalThis;
  var agentNamespaceForDocxTextFromHtml = globalScopeForDocxTextFromHtml.ABChatAgent || {};

  var NAMED_ENTITIES_FOR_DOCX_TEXT_FROM_HTML = {
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  function decodeCodePointForDocxTextFromHtml(codeForDecode, wholeForDecode) {
    if (!Number.isFinite(codeForDecode) || codeForDecode < 0 || codeForDecode > 0x10ffff) {
      return wholeForDecode;
    }
    try {
      return String.fromCodePoint(codeForDecode);
    } catch (errForDecode) {
      return wholeForDecode;
    }
  }

  // Decode only the entities mammoth's HTML writer emits. &amp; is decoded last, in its own pass,
  // so an already-encoded ampersand inside a URL query string (?a=1&amp;b=2) is never re-read as
  // the opening of another entity while the named/numeric entities are being resolved.
  function decodeEntitiesForDocxTextFromHtml(textForDecode) {
    var workingForDecode = String(textForDecode || '')
      .replace(/&#(\d+);/g, function (wholeForDecode, digitsForDecode) {
        return decodeCodePointForDocxTextFromHtml(parseInt(digitsForDecode, 10), wholeForDecode);
      })
      .replace(/&#x([0-9a-fA-F]+);/g, function (wholeForDecode, hexForDecode) {
        return decodeCodePointForDocxTextFromHtml(parseInt(hexForDecode, 16), wholeForDecode);
      })
      .replace(/&(lt|gt|quot|apos|nbsp);/g, function (wholeForDecode, nameForDecode) {
        return NAMED_ENTITIES_FOR_DOCX_TEXT_FROM_HTML[nameForDecode] || wholeForDecode;
      });
    return workingForDecode.replace(/&amp;/g, '&');
  }

  function stripTagsForDocxTextFromHtml(fragmentForStrip) {
    return String(fragmentForStrip || '').replace(/<[^>]+>/g, '');
  }

  // Serialize mammoth convertToHtml output to plain text, rendering each external hyperlink inline
  // as "text (url)". Entity decoding happens once, at the end, so anchor text and hrefs are left
  // encoded until then and are not double-decoded.
  function htmlToTextForDocxTextFromHtml(htmlForHtmlToText) {
    var workingForHtmlToText = String(htmlForHtmlToText || '');

    // Images carry no text on this path (the docx text extractor has never surfaced them), and the
    // convertImage option already blanks them, so drop whatever <img> tags remain.
    workingForHtmlToText = workingForHtmlToText.replace(/<img\b[^>]*>/gi, '');

    // Anchors first, while each href is still attached to its own text. Only http/https/mailto get
    // a "(url)" suffix; internal (#...) and relative links render as their text alone. A link whose
    // text already is the url collapses to the url. Text and href stay entity-encoded here and are
    // decoded in the single pass below.
    workingForHtmlToText = workingForHtmlToText.replace(
      /<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      function (wholeForAnchor, hrefForAnchor, innerForAnchor) {
        var innerTextForAnchor = stripTagsForDocxTextFromHtml(innerForAnchor).trim();
        var urlForAnchor = String(hrefForAnchor || '').trim();
        if (!/^(https?:|mailto:)/i.test(urlForAnchor)) {
          return innerTextForAnchor;
        }
        if (!innerTextForAnchor) {
          return urlForAnchor;
        }
        if (innerTextForAnchor.toLowerCase() === urlForAnchor.toLowerCase()) {
          return urlForAnchor;
        }
        return innerTextForAnchor + ' (' + urlForAnchor + ')';
      }
    );

    workingForHtmlToText = workingForHtmlToText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|h[1-6]|blockquote|pre|ul|ol|table)>/gi, '\n\n')
      .replace(/<\/(tr|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '');

    workingForHtmlToText = decodeEntitiesForDocxTextFromHtml(workingForHtmlToText);

    return workingForHtmlToText
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  agentNamespaceForDocxTextFromHtml.docxTextFromHtml = {
    htmlToText: htmlToTextForDocxTextFromHtml
  };

  globalScopeForDocxTextFromHtml.ABChatAgent = agentNamespaceForDocxTextFromHtml;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = agentNamespaceForDocxTextFromHtml.docxTextFromHtml;
  }
})();
