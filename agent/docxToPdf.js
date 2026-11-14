// Converts an attached DOCX to one HTML page per printed page, for Chrome to print as a PDF
// (background/documentPrinter.js). docx-preview (lib/docx-preview.js, patched) turns the file into
// HTML and CSS; this file lays that out page by page, which docx-preview does not do, and hands the
// result to the print route in a form the printer's safety check accepts.
//
// The layout is measured in an iframe in the offscreen document, because a detached document has
// no layout. The iframe is sandboxed with scripts off and has its own Content-Security-Policy, so
// nothing from the file can run or fetch anything but the font library while it is laid out.
//
// The printer parses the page from HTML text, while the frame is built through the DOM, where any
// element can sit inside a paragraph. Whatever the HTML parser would move out of a paragraph is
// renamed before anything is measured, and the finished page is parsed again and compared with the
// measured tree, so the page breaks measured here are the ones printed.
//
// The decisions that need no DOM (what to refuse, where a page-anchored shape goes, how a text box
// is outlined, how many lines stay on a page, how the stylesheet reaches renamed paragraphs) are in
// agent/docxPdfRules.js. docx-preview is loaded on the first conversion, as pdf.js is for scanned
// PDFs, so a run that converts nothing does not pay for it.

(function () {
  const globalScopeForDocxToPdf = globalThis;
  const agentNsForDocxToPdf = globalScopeForDocxToPdf.ABChatAgent || {};

  const MAX_BYTES_FOR_DOCX_TO_PDF = 20 * 1024 * 1024;
  const MAX_PAGES_FOR_DOCX_TO_PDF = 300;
  const FONT_WAIT_MS_FOR_DOCX_TO_PDF = 15000;
  const TOLERANCE_PX_FOR_DOCX_TO_PDF = 0.5;
  const PX_PER_PT_FOR_DOCX_TO_PDF = 96 / 72;
  const FONT_CDN_FOR_DOCX_TO_PDF = 'https://cdn.jsdelivr.net/fontsource/fonts/';
  const FRAME_CSP_FOR_DOCX_TO_PDF = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src https://cdn.jsdelivr.net";
  // Office fonts the curated clone list does not name.
  const EXTRA_CLONES_FOR_DOCX_TO_PDF = { 'calibri light': 'Carlito' };
  const GENERIC_FAMILIES_FOR_DOCX_TO_PDF = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'emoji', 'math'];
  const PRINTABLE_IMAGE_RE_FOR_DOCX_TO_PDF = /^data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i;
  const LINK_RE_FOR_DOCX_TO_PDF = /^(?:https?:|mailto:)/i;
  const REMOVED_TAGS_FOR_DOCX_TO_PDF = ['script', 'iframe', 'object', 'embed', 'link', 'base', 'form', 'svg', 'video', 'audio',
    'source', 'portal', 'meta', 'style', 'template', 'noscript', 'canvas', 'frame', 'frameset'];

  // Word's defaults when a file names none: Times New Roman at 10 pt, and no hyphenation (docx-preview
  // turns it on). A cell's width in Word includes its margins, which docx-preview writes as padding,
  // and a margin the file does not set is zero, not the browser's 1px, which made every row of a
  // form 1.5 pt taller than Word's.
  // The page isolates its stacking so a watermark placed behind the text is not also behind the
  // page's white background. Header and footer never shrink: the page is a flex column, and
  // docx-preview gives the header a tiny min-height, so an overfull page squeezed a 71 pt logo
  // header to 12 pt and the text rose over the logo. Word sets the bottom of the footer's text at the
  // footer distance and grows the footer upward, so its content sits at the foot of its box. A paragraph split across two pages: the first part keeps the line layout it had,
  // so a justified paragraph keeps its last line justified, and its space after goes with the
  // paragraph's end. The second part is not numbered again, does not indent its first line, and has
  // no space before.
  const BASE_CSS_FOR_DOCX_TO_PDF = [
    'html, body { margin: 0; padding: 0; background: #ffffff; }',
    ':where(section.docx) { font-size: 10pt; font-family: "Times New Roman", serif; }',
    'section.docx { margin: 0 !important; box-shadow: none !important; flex-shrink: 0; hyphens: manual !important; isolation: isolate; }',
    'section.docx > header, section.docx > footer { flex-shrink: 0; }',
    'section.docx > footer { display: flex; flex-direction: column; justify-content: flex-end; }',
    'section.docx td, section.docx th { box-sizing: border-box; }',
    ':where(section.docx td, section.docx th) { padding: 0; }',
    'p.abchat-split { margin-bottom: 0 !important; }',
    'p.abchat-split-justify { text-align-last: justify; }',
    'p.abchat-cont::before { content: none !important; counter-increment: none !important; }',
    'p.abchat-cont { counter-set: none !important; counter-increment: none !important; list-style-type: none !important; text-indent: 0 !important; margin-top: 0 !important; }'
  ].join('\n');

  function rulesForDocxToPdf() {
    return agentNsForDocxToPdf.docxPdfRules || null;
  }

  let libraryPromiseForDocxToPdf = null;

  function loadLibraryForDocxToPdf() {
    if (globalScopeForDocxToPdf.docx && typeof globalScopeForDocxToPdf.docx.renderAsync === 'function') {
      return Promise.resolve(globalScopeForDocxToPdf.docx);
    }
    if (libraryPromiseForDocxToPdf) return libraryPromiseForDocxToPdf;
    const hostDocument = globalScopeForDocxToPdf.document;
    const runtime = globalScopeForDocxToPdf.chrome && globalScopeForDocxToPdf.chrome.runtime;
    if (!hostDocument || !runtime || typeof runtime.getURL !== 'function') return Promise.resolve(null);
    libraryPromiseForDocxToPdf = new Promise(function (resolveForLibrary, rejectForLibrary) {
      const script = hostDocument.createElement('script');
      script.src = runtime.getURL('lib/docx-preview.js');
      script.addEventListener('load', function () {
        const library = globalScopeForDocxToPdf.docx;
        if (library && typeof library.renderAsync === 'function') resolveForLibrary(library);
        else rejectForLibrary(new Error('The Word converter loaded but exposed no API.'));
      });
      script.addEventListener('error', function () { rejectForLibrary(new Error('The Word converter failed to load.')); });
      (hostDocument.head || hostDocument.documentElement).appendChild(script);
    });
    libraryPromiseForDocxToPdf.catch(function () {
      // A later conversion retries the load rather than inheriting this failure.
      libraryPromiseForDocxToPdf = null;
    });
    return libraryPromiseForDocxToPdf;
  }

  function sleepForDocxToPdf(ms) {
    return new Promise(function (resolveForSleep) { setTimeout(resolveForSleep, ms); });
  }

  function ptForDocxToPdf(cssLength) {
    const textForLength = String(cssLength || '').trim();
    const amountForLength = parseFloat(textForLength);
    if (!Number.isFinite(amountForLength)) return null;
    if (/pt$/i.test(textForLength)) return amountForLength;
    if (/px$/i.test(textForLength)) return amountForLength / PX_PER_PT_FOR_DOCX_TO_PDF;
    if (/in$/i.test(textForLength)) return amountForLength * 72;
    if (/cm$/i.test(textForLength)) return amountForLength * 72 / 2.54;
    if (/mm$/i.test(textForLength)) return amountForLength * 72 / 25.4;
    return amountForLength;
  }

  function escapeHtmlForDocxToPdf(textForEscape) {
    return String(textForEscape == null ? '' : textForEscape)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- The frame ----

  function openFrameForDocxToPdf() {
    const hostDocument = globalScopeForDocxToPdf.document;
    if (!hostDocument || !hostDocument.body) return Promise.reject(new Error('This converter runs only in the extension\'s offscreen document.'));
    const frame = hostDocument.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position: fixed; left: -30000px; top: 0; width: 1800px; height: 1200px; border: 0; visibility: hidden;';
    frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP_FOR_DOCX_TO_PDF + '">'
      + '<style id="abchat-base">' + BASE_CSS_FOR_DOCX_TO_PDF + '</style><style id="abchat-fonts"></style></head>'
      + '<body><div id="abchat-docx-styles"></div><div id="abchat-docx-pages"></div></body></html>';
    return new Promise(function (resolveForFrame, rejectForFrame) {
      const timerForFrame = setTimeout(function () { rejectForFrame(new Error('The layout frame did not open.')); }, 10000);
      frame.addEventListener('load', function () {
        clearTimeout(timerForFrame);
        resolveForFrame(frame);
      }, { once: true });
      hostDocument.body.appendChild(frame);
    });
  }

  // ---- Fonts ----

  function familiesInStackForDocxToPdf(stackForFamilies) {
    return String(stackForFamilies || '').split(',').map(function (partForFamily) {
      return partForFamily.trim().replace(/^["']|["']$/g, '').trim();
    }).filter(function (nameForFamily) {
      return nameForFamily && GENERIC_FAMILIES_FOR_DOCX_TO_PDF.indexOf(nameForFamily.toLowerCase()) === -1;
    });
  }

  // Every family named on an element that shows text.
  function usedFamiliesForDocxToPdf(frameDocument, pagesHost) {
    const viewForFamilies = frameDocument.defaultView;
    const seenForFamilies = {};
    const namesForFamilies = [];
    const walkerForFamilies = frameDocument.createTreeWalker(pagesHost, NodeFilter.SHOW_TEXT);
    const stacksSeen = {};
    let nodeForFamily;
    while ((nodeForFamily = walkerForFamilies.nextNode())) {
      if (!nodeForFamily.nodeValue || !nodeForFamily.nodeValue.trim() || !nodeForFamily.parentElement) continue;
      const stackForNode = viewForFamilies.getComputedStyle(nodeForFamily.parentElement).fontFamily;
      if (stacksSeen[stackForNode]) continue;
      stacksSeen[stackForNode] = true;
      familiesInStackForDocxToPdf(stackForNode).forEach(function (nameForStack) {
        const keyForName = nameForStack.toLowerCase();
        if (seenForFamilies[keyForName]) return;
        seenForFamilies[keyForName] = true;
        namesForFamilies.push(nameForStack);
      });
    }
    return namesForFamilies;
  }

  // The font library entry a family prints with: its metric clone for an Office font, or itself
  // for a library font. Null for anything else.
  function webFaceForDocxToPdf(name) {
    const printer = agentNsForDocxToPdf.documentPrint || {};
    const webFonts = printer.webFonts || {};
    const lower = String(name || '').toLowerCase();
    if (!lower) return null;
    const clone = EXTRA_CLONES_FOR_DOCX_TO_PDF[lower]
      || (typeof printer.metricClone === 'function' ? printer.metricClone(name) : '')
      || (webFonts[lower] ? name : '');
    const web = clone ? webFonts[String(clone).toLowerCase()] : null;
    return web ? { clone: String(clone), web: web } : null;
  }

  // The printer's test: text in the family measures differently from every generic family only
  // when the family is installed. The offscreen document sees the same fonts as the print tab.
  function isInstalledForDocxToPdf(name) {
    const canvas = globalScopeForDocxToPdf.document && globalScopeForDocxToPdf.document.createElement('canvas');
    const context = canvas && canvas.getContext('2d');
    if (!context) return true;
    return ['monospace', 'serif', 'sans-serif'].some(function (generic) {
      context.font = '72px ' + generic;
      const base = context.measureText('mmmmmmmmmlli WQ@#').width;
      context.font = '72px "' + String(name).replace(/["\\]/g, '') + '", ' + generic;
      return context.measureText('mmmmmmmmmlli WQ@#').width !== base;
    });
  }

  // Word's stand-in for a font it does not have follows what the font table says the font is like.
  // For a sans or unknown font it is the document's default font: Word printed text set in an
  // uninstalled Segoe UI Emoji in Calibri, the default, where the browser fell back to Times.
  const STAND_IN_BY_KIND_FOR_DOCX_TO_PDF = { roman: 'Times New Roman', modern: 'Courier New' };

  function standInForDocxToPdf(name, fontTable, defaultFamily) {
    const lower = String(name).toLowerCase();
    const entry = (fontTable || []).find(function (font) { return font && String(font.name || '').toLowerCase() === lower; }) || {};
    const candidates = [entry.altName, STAND_IN_BY_KIND_FOR_DOCX_TO_PDF[entry.family] || defaultFamily];
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate || String(candidate).toLowerCase() === lower) continue;
      const face = webFaceForDocxToPdf(candidate);
      if (face) return { name: String(candidate), face: face };
    }
    return null;
  }

  // An Office font is aliased to its metric clone from the font library, under its own name, so it
  // prints the same on a computer without Office and its lines break where Word broke them. A
  // library font is loaded under its own name. An installed font is left to the computer. A font
  // that is none of these is aliased to its stand-in, with a warning naming it; with no stand-in it
  // is left to the browser, and the printer warns.
  function fontPlanForDocxToPdf(familyNames, fontTable, defaultFamily, warnings) {
    const printer = agentNsForDocxToPdf.documentPrint || {};
    const faces = [];
    const fonts = [];
    const addFace = function (alias, web) {
      faces.push({ alias: alias, id: web.id, weights: web.weights, italic: web.italic, subsets: web.subsets });
      fonts.push({ alias: alias, family: alias, userNamed: false });
    };
    familyNames.forEach(function (nameForPlan) {
      const face = webFaceForDocxToPdf(nameForPlan);
      if (face) {
        addFace(nameForPlan, face.web);
        return;
      }
      const standIn = isInstalledForDocxToPdf(nameForPlan) ? null : standInForDocxToPdf(nameForPlan, fontTable, defaultFamily);
      if (!standIn) {
        fonts.push({ alias: nameForPlan, family: nameForPlan, userNamed: true });
        return;
      }
      addFace(nameForPlan, standIn.face.web);
      const printedAs = standIn.face.clone.toLowerCase() === standIn.name.toLowerCase() ? '' : ' (printed as ' + standIn.face.clone + ')';
      warnings.push('The font "' + nameForPlan + '" is neither in the web font library nor installed on this computer, so the PDF uses ' + standIn.name + printedAs + ' in its place.');
    });
    const css = faces.length && typeof printer.fontFaceCss === 'function' ? printer.fontFaceCss(faces) : '';
    return { css: css, fonts: fonts };
  }

  // The first family of the document's default run font.
  function defaultFamilyForDocxToPdf(frameDocument, pagesHost) {
    const article = pagesHost.querySelector('section.docx > article');
    if (!article) return '';
    const probe = frameDocument.createElement('span');
    article.appendChild(probe);
    const family = familiesInStackForDocxToPdf(frameDocument.defaultView.getComputedStyle(probe).fontFamily)[0] || '';
    probe.remove();
    return family;
  }

  async function waitForFontsForDocxToPdf(frameDocument) {
    const deadline = Date.now() + FONT_WAIT_MS_FOR_DOCX_TO_PDF;
    for (let roundForFonts = 0; roundForFonts < 3; roundForFonts++) {
      frameDocument.body.getBoundingClientRect();
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await Promise.race([frameDocument.fonts.ready, sleepForDocxToPdf(remaining)]);
      if (frameDocument.fonts.status === 'loaded') return true;
    }
    return frameDocument.fonts.status === 'loaded';
  }

  // ---- Paragraph contents ----

  // The frame builds the page through the DOM, where a paragraph can hold anything. The printer
  // parses the page from HTML text, and the parser ends a paragraph at any of these tags and turns
  // the stray </p> after it into a new empty paragraph. A picture in a div gained about 30 pt of
  // height in print that way, and the measured page breaks no longer held.
  const NOT_IN_PARAGRAPH_TAGS_FOR_DOCX_TO_PDF = ['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog',
    'dir', 'div', 'dl', 'dd', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'hgroup', 'hr', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre', 'search', 'section',
    'summary', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'xmp'];

  // Renames whatever a paragraph holds that the parser would move out of it, and a link inside a
  // link, to a span carrying the class abchat-as-<tag>, before anything is measured, so the frame
  // and the printed page lay out the same tree.
  function keepParagraphsWholeForDocxToPdf(frameDocument, pagesHost) {
    const view = frameDocument.defaultView;
    const selector = NOT_IN_PARAGRAPH_TAGS_FOR_DOCX_TO_PDF.join(',');
    const nested = [];
    pagesHost.querySelectorAll('p').forEach(function (paragraph) {
      if (paragraph.parentElement && paragraph.parentElement.closest('p')) return;
      paragraph.querySelectorAll(selector).forEach(function (element) { nested.push(element); });
    });
    pagesHost.querySelectorAll('a a').forEach(function (element) { nested.push(element); });
    // Read every style before renaming anything, since the rules that set them may match by tag. A
    // renamed element keeps its display, and its white-space, which the span rule would change.
    const styles = nested.map(function (element) {
      const computed = view.getComputedStyle(element);
      return { display: computed.display, whiteSpace: computed.whiteSpace };
    });
    nested.forEach(function (element, index) {
      const tag = element.tagName.toLowerCase();
      const span = frameDocument.createElement('span');
      Array.from(element.attributes).forEach(function (attribute) { span.setAttribute(attribute.name, attribute.value); });
      span.removeAttribute('href');
      span.classList.add('abchat-as-' + tag);
      if (!element.style.display) span.style.display = styles[index].display;
      if (!element.style.whiteSpace) span.style.whiteSpace = styles[index].whiteSpace;
      while (element.firstChild) span.appendChild(element.firstChild);
      element.replaceWith(span);
    });
  }

  function elementCountForDocxToPdf(root) {
    return Array.from(root.getElementsByTagName('*')).filter(function (element) { return element.tagName !== 'TBODY'; }).length;
  }

  // ---- Paragraph spacing ----

  function isParagraphForDocxToPdf(element) {
    return !!element && (element.tagName === 'P' || element.classList.contains('abchat-as-p'));
  }

  // A paragraph with contextual spacing loses its space before when the paragraph above has the
  // same style, and its space after when the one below does. List paragraphs have it, so without
  // this a run of them is spaced like body text.
  function contextualSpacingForDocxToPdf(pagesHost) {
    pagesHost.querySelectorAll('[data-abchat-contextual]').forEach(function (paragraph) {
      if (!isParagraphForDocxToPdf(paragraph)) return;
      const style = paragraph.getAttribute('data-abchat-style');
      const sameStyle = function (neighbour) { return isParagraphForDocxToPdf(neighbour) && neighbour.getAttribute('data-abchat-style') === style; };
      if (sameStyle(paragraph.previousElementSibling)) paragraph.style.marginTop = '0';
      if (sameStyle(paragraph.nextElementSibling)) paragraph.style.marginBottom = '0';
    });
  }

  // ---- Empty paragraphs ----

  // True when the paragraph would have a line box: text that is not collapsed away, or an in-flow
  // picture, inline block or line break. Floated, placed and hidden content does not count.
  function hasLineContentForDocxToPdf(paragraph, view) {
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        const style = view.getComputedStyle(node);
        if (style.display === 'none' || style.float !== 'none' || style.position === 'absolute' || style.position === 'fixed') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) {
        const text = node.nodeValue || '';
        const keepsSpaces = /^(?:pre|break-spaces)/.test(view.getComputedStyle(node.parentElement).whiteSpace);
        if (keepsSpaces ? text.length > 0 : text.trim().length > 0) return true;
        continue;
      }
      if (node.tagName === 'IMG' || node.tagName === 'BR' || /^inline-/.test(view.getComputedStyle(node).display)) return true;
    }
    return false;
  }

  // In Word an empty paragraph is one line in the paragraph mark's font. In CSS a paragraph with no
  // line content has no line box, so docx-preview's min-height of 1em was all it got: 12 pt where
  // Word gives 17, which on a CV with many spacer paragraphs moved the page break. Each one gets an
  // empty run holding a line break. The run takes the paragraph style's run font through the
  // style's span rules and the mark's own size, and the line-height pass gives the paragraph that
  // font, so the line is as tall as Word makes it. A zero-width space would do the same but lands
  // in the PDF's text, which CV parsers read. Run after shapes are placed, so a placed picture does
  // not count as content.
  function lineForEmptyParagraphsForDocxToPdf(frameDocument, pagesHost) {
    const view = frameDocument.defaultView;
    const empty = Array.from(pagesHost.querySelectorAll('p, .abchat-as-p')).filter(function (paragraph) {
      return !hasLineContentForDocxToPdf(paragraph, view);
    });
    empty.forEach(function (paragraph) {
      const mark = frameDocument.createElement('span');
      mark.setAttribute('data-abchat-mark', '1');
      const size = paragraph.getAttribute('data-abchat-mark-size');
      if (size) mark.style.fontSize = size;
      mark.appendChild(frameDocument.createElement('br'));
      paragraph.appendChild(mark);
    });
  }

  // ---- Line height ----

  // In Word a line is as tall as the runs on it. In CSS every line also holds a strut in the
  // paragraph's own font, so a paragraph whose font is taller than its runs' (docx-preview leaves
  // paragraphs in the default font) gets taller lines. Giving each paragraph the font of its smallest
  // run keeps the strut from ever setting the height.
  // An empty paragraph's line-break run counts as a run here, so the paragraph takes its font.
  function smallestRunFontForDocxToPdf(paragraph, view) {
    let smallest = null;
    const consider = function (element) {
      const style = view.getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      if (size > 0 && (!smallest || size < smallest.size)) {
        smallest = { size: size, family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle };
      }
    };
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim() || !node.parentElement || node.parentElement === paragraph) continue;
      consider(node.parentElement);
    }
    Array.from(paragraph.children).forEach(function (child) {
      if (child.hasAttribute('data-abchat-mark')) consider(child);
    });
    return smallest;
  }

  // Word's single spacing is the font's own line height, and "auto" spacing a multiple of it. The
  // patched docx-preview writes those as calc(var(--abchat-lh) * N); this sets --abchat-lh on each
  // paragraph to its font's line height over its size, measured with line-height: normal.
  function setLineHeightsForDocxToPdf(frameDocument, pagesHost) {
    const viewForLines = frameDocument.defaultView;
    const probe = frameDocument.createElement('div');
    probe.style.cssText = 'position: absolute; left: -10000px; top: 0; font-size: 100px; line-height: normal; white-space: nowrap;';
    probe.textContent = 'Hg';
    frameDocument.body.appendChild(probe);
    const ratioByStack = {};
    try {
      const paragraphs = Array.from(pagesHost.querySelectorAll('p, .abchat-as-p'));
      // Read every run's font before changing any paragraph, so one change does not restyle the next.
      const runFonts = paragraphs.map(function (paragraph) { return smallestRunFontForDocxToPdf(paragraph, viewForLines); });
      paragraphs.forEach(function (paragraph, indexForParagraph) {
        const runFont = runFonts[indexForParagraph];
        if (runFont) {
          paragraph.style.fontFamily = runFont.family;
          paragraph.style.fontSize = runFont.size + 'px';
        }
      });
      paragraphs.forEach(function (paragraph) {
        const styleForParagraph = viewForLines.getComputedStyle(paragraph);
        const keyForStack = styleForParagraph.fontFamily + '|' + styleForParagraph.fontWeight + '|' + styleForParagraph.fontStyle;
        if (!(keyForStack in ratioByStack)) {
          probe.style.fontFamily = styleForParagraph.fontFamily;
          probe.style.fontWeight = styleForParagraph.fontWeight;
          probe.style.fontStyle = styleForParagraph.fontStyle;
          const height = probe.getBoundingClientRect().height;
          ratioByStack[keyForStack] = height > 0 ? height / 100 : 1.15;
        }
        paragraph.style.setProperty('--abchat-lh', ratioByStack[keyForStack].toFixed(4));
        // No line spacing in the file is Word's single spacing. Left at normal, Chrome rounds the
        // font's ascent and descent to whole pixels, so 10 pt Arial lines came out 11.25 pt apart
        // instead of 11.5 and a page drifted by most of a line.
        if (styleForParagraph.lineHeight === 'normal') paragraph.style.lineHeight = 'var(--abchat-lh)';
      });
    } finally {
      probe.remove();
    }
  }

  // ---- Tab stops ----

  function updateTabsForDocxToPdf(rootForTabs) {
    const library = globalScopeForDocxToPdf.docx;
    if (!library || typeof library.abchatUpdateTab !== 'function') return;
    const pixelToPoint = typeof library.abchatPixelToPoint === 'function' ? library.abchatPixelToPoint() : 0.75;
    rootForTabs.querySelectorAll('[data-abchat-tab]').forEach(function (span) {
      try { library.abchatUpdateTab(span, pixelToPoint); } catch (e) { /* a tab that cannot be measured keeps its default width */ }
    });
  }

  // ---- Page geometry ----

  function pageGeometryForDocxToPdf(page) {
    const view = page.ownerDocument.defaultView;
    const style = view.getComputedStyle(page);
    const props = page.abchatPage && page.abchatPage.props;
    const sizeForPage = props && props.pageSize;
    const widthPt = ptForDocxToPdf(sizeForPage && sizeForPage.width) || ptForDocxToPdf(page.style.width) || 612;
    const heightPt = ptForDocxToPdf(sizeForPage && sizeForPage.height) || ptForDocxToPdf(page.style.minHeight || page.style.height) || 792;
    return {
      width: widthPt,
      height: heightPt,
      margins: {
        top: parseFloat(style.paddingTop) / PX_PER_PT_FOR_DOCX_TO_PDF || 0,
        right: parseFloat(style.paddingRight) / PX_PER_PT_FOR_DOCX_TO_PDF || 0,
        bottom: parseFloat(style.paddingBottom) / PX_PER_PT_FOR_DOCX_TO_PDF || 0,
        left: parseFloat(style.paddingLeft) / PX_PER_PT_FOR_DOCX_TO_PDF || 0
      }
    };
  }

  // Fixes a page at its paper height, so its footer sits at the foot of the page.
  function fixPageHeightForDocxToPdf(page) {
    const geometry = pageGeometryForDocxToPdf(page);
    page.style.minHeight = '';
    page.style.height = geometry.height + 'pt';
    page.style.width = geometry.width + 'pt';
    return geometry;
  }

  // The lowest point body text may reach on a page: the bottom margin, or the top of the footer
  // when the footer reaches above it, less any footnotes on the page.
  function contentLimitForDocxToPdf(page, geometry) {
    const view = page.ownerDocument.defaultView;
    const pageTop = page.getBoundingClientRect().top;
    const contentBottom = pageTop + (geometry.height - geometry.margins.bottom) * PX_PER_PT_FOR_DOCX_TO_PDF;
    let limit = contentBottom;
    const children = Array.from(page.children);
    const footer = children.filter(function (child) { return child.tagName === 'FOOTER'; }).pop();
    if (footer) {
      const marginBottom = parseFloat(view.getComputedStyle(footer).marginBottom) || 0;
      const footerTop = contentBottom - marginBottom - footer.getBoundingClientRect().height;
      limit = Math.min(limit, footerTop);
    }
    children.forEach(function (child) {
      if (child.tagName === 'OL') limit -= child.getBoundingClientRect().height;
    });
    return limit;
  }

  // ---- Shapes placed on the page ----

  // The box an absolutely positioned element is placed against: its nearest positioned ancestor.
  // offsetParent will not do, since it also returns a table cell that is not positioned.
  function containingBlockForDocxToPdf(element, page) {
    const view = element.ownerDocument.defaultView;
    for (let ancestor = element.parentElement; ancestor && ancestor !== page; ancestor = ancestor.parentElement) {
      if (view.getComputedStyle(ancestor).position !== 'static') return ancestor;
    }
    return page;
  }

  function placeOnPageForDocxToPdf(element, box, page) {
    const pageRect = page.getBoundingClientRect();
    const containerRect = containingBlockForDocxToPdf(element, page).getBoundingClientRect();
    element.classList.add('abchat-placed');
    element.style.position = 'absolute';
    element.style.left = (box.left * PX_PER_PT_FOR_DOCX_TO_PDF + pageRect.left - containerRect.left) + 'px';
    element.style.top = (box.top * PX_PER_PT_FOR_DOCX_TO_PDF + pageRect.top - containerRect.top) + 'px';
    element.style.width = box.width + 'pt';
    element.style.height = box.height + 'pt';
    element.style.margin = '0';
    element.style.float = 'none';
    element.style.zIndex = box.behind ? '-1' : '2';
  }

  // VML pictures and text boxes, and DrawingML pictures anchored to the page or its margins, are
  // placed on their page. Anything else stays where docx-preview put it.
  function placeShapesForDocxToPdf(pagesHost) {
    pagesHost.querySelectorAll('section.docx').forEach(placeShapesOnPageForDocxToPdf);
  }

  function placeShapesOnPageForDocxToPdf(page) {
    const rules = rulesForDocxToPdf();
    const geometry = pageGeometryForDocxToPdf(page);
    // A text box's outline, fill and inner margins. Its VML size is the outer size.
    page.querySelectorAll('[data-abchat-box]').forEach(function (element) {
      let record = null;
      try { record = JSON.parse(element.getAttribute('data-abchat-box')); } catch (e) { record = null; }
      const look = rules.vmlBoxLook(record);
      element.style.boxSizing = 'border-box';
      element.style.borderStyle = look.borderWidth > 0 ? 'solid' : 'none';
      element.style.borderWidth = look.borderWidth + 'pt';
      element.style.borderColor = look.borderColor;
      element.style.backgroundColor = look.background || 'transparent';
      element.style.padding = look.padding.top + 'pt ' + look.padding.right + 'pt ' + look.padding.bottom + 'pt ' + look.padding.left + 'pt';
    });
    const placeable = [];
    page.querySelectorAll('[data-abchat-vml]').forEach(function (element) {
      const style = rules.vmlStyle(element.getAttribute('data-abchat-vml'));
      if (element.hasAttribute('data-abchat-washout')) element.style.opacity = '0.3';
      const box = rules.vmlBox(style, geometry);
      if (box) {
        placeable.push({ element: element, box: box });
        return;
      }
      if (style.width > 0) element.style.width = style.width + 'pt';
      if (style.height > 0) element.style.height = style.height + 'pt';
      element.style.display = 'inline-block';
      element.style.verticalAlign = 'top';
    });
    page.querySelectorAll('[data-abchat-anchor]').forEach(function (element) {
      let anchor = null;
      try { anchor = JSON.parse(element.getAttribute('data-abchat-anchor')); } catch (e) { return; }
      const width = ptForDocxToPdf(element.style.width);
      const height = ptForDocxToPdf(element.style.height);
      const box = rules.anchorBox(anchor, { width: width, height: height }, geometry);
      if (box) placeable.push({ element: element, box: box });
    });
    // Set every position after reading every rectangle, so one move does not shift the next.
    placeable.forEach(function (entry) { placeOnPageForDocxToPdf(entry.element, entry.box, page); });
  }

  // The passes text goes through before it is measured, in this order. Shapes are placed before the
  // empty-paragraph pass, so it sees them out of flow, and again once line heights have moved the
  // paragraphs they sit in. The body gets these once. Each page's header and footer get them when
  // the paginator dresses the page, because those are fresh copies of the section's originals: a
  // copy that skipped them kept a full-page watermark in the flow and pushed the text down the page.
  function prepareTextForDocxToPdf(frameDocument, roots, pages) {
    roots.forEach(function (root) { keepParagraphsWholeForDocxToPdf(frameDocument, root); });
    pages.forEach(placeShapesOnPageForDocxToPdf);
    roots.forEach(function (root) {
      contextualSpacingForDocxToPdf(root);
      lineForEmptyParagraphsForDocxToPdf(frameDocument, root);
    });
    roots.forEach(function (root) {
      setLineHeightsForDocxToPdf(frameDocument, root);
      updateTabsForDocxToPdf(root);
    });
    pages.forEach(placeShapesOnPageForDocxToPdf);
  }

  // ---- Lines ----

  function isEmptyBlockForDocxToPdf(element) {
    return !element.textContent.replace(/\s+/g, '') && !element.querySelector('img, [data-abchat-vml], [data-abchat-anchor]');
  }

  // A rectangle fits when it ends above the limit and starts left of the area's right edge, which
  // is where a multi-column area sends what does not fit.
  function rectFitsForDocxToPdf(rect, area) {
    return rect.bottom <= area.limit + TOLERANCE_PX_FOR_DOCX_TO_PDF && rect.left < area.right - TOLERANCE_PX_FOR_DOCX_TO_PDF;
  }

  function columnOfForDocxToPdf(rect, area) {
    return area.columnWidth > 0 ? Math.max(0, Math.floor((rect.left + 1 - area.left) / area.columnWidth)) : 0;
  }

  // Text and pictures in a paragraph's flow: a shape placed on the page is out of the flow, and its
  // rectangle would read as a line of its own.
  function flowLeavesForDocxToPdf(paragraph) {
    const doc = paragraph.ownerDocument;
    const leaves = [];
    const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (node.classList.contains('abchat-placed')) return NodeFilter.FILTER_REJECT;
          return node.tagName === 'IMG' || node.hasAttribute('data-abchat-vml') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let node;
    while ((node = walker.nextNode())) leaves.push(node);
    return leaves;
  }

  // The lines of a paragraph, in reading order: rectangles of its content grouped by column and by
  // vertical overlap.
  function linesOfForDocxToPdf(paragraph, area) {
    const range = paragraph.ownerDocument.createRange();
    const rects = [];
    flowLeavesForDocxToPdf(paragraph).forEach(function (leaf) {
      if (leaf.nodeType === 1) {
        rects.push(leaf.getBoundingClientRect());
        return;
      }
      range.selectNodeContents(leaf);
      Array.prototype.push.apply(rects, Array.from(range.getClientRects()));
    });
    const lines = [];
    rects.map(function (rect) {
      return { top: rect.top, bottom: rect.bottom, left: rect.left, column: columnOfForDocxToPdf(rect, area) };
    }).sort(function (first, second) { return first.column - second.column || first.top - second.top; })
      .filter(function (rect) { return rect.bottom > rect.top; })
      .forEach(function (rect) {
        const last = lines[lines.length - 1];
        const middle = (rect.top + rect.bottom) / 2;
        if (last && last.column === rect.column && middle >= last.top && middle <= last.bottom) {
          last.top = Math.min(last.top, rect.top);
          last.bottom = Math.max(last.bottom, rect.bottom);
          last.left = Math.min(last.left, rect.left);
          return;
        }
        lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, column: rect.column });
      });
    return lines;
  }

  function lineIndexOfForDocxToPdf(rect, lines, area) {
    const middle = (rect.top + rect.bottom) / 2;
    const column = columnOfForDocxToPdf(rect, area);
    for (let index = 0; index < lines.length; index++) {
      if (lines[index].column === column && middle >= lines[index].top - 1 && middle <= lines[index].bottom + 1) return index;
    }
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index].column < column || (lines[index].column === column && lines[index].bottom <= middle)) return index;
    }
    return 0;
  }

  // The first point in the paragraph whose content is on line `lineIndex` or later, as a range
  // boundary { node, offset } or { before: element }.
  function splitPointForDocxToPdf(paragraph, lines, lineIndex, area) {
    const doc = paragraph.ownerDocument;
    const range = doc.createRange();
    const leaves = flowLeavesForDocxToPdf(paragraph);
    const lineOfChar = function (node, offset) {
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rects = range.getClientRects();
      const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return -1;
      return lineIndexOfForDocxToPdf(rect, lines, area);
    };
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
      const node = leaves[leafIndex];
      if (node.nodeType === 1) {
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && lineIndexOfForDocxToPdf(rect, lines, area) >= lineIndex) return { before: node };
        continue;
      }
      const length = node.nodeValue.length;
      const lastLine = lineOfChar(node, length - 1);
      if (lastLine !== -1 && lastLine < lineIndex) continue;
      let low = 0;
      let high = length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        let line = lineOfChar(node, middle);
        let probe = middle;
        while (line === -1 && probe < high) line = lineOfChar(node, ++probe);
        if (line !== -1 && line >= lineIndex) {
          found = middle;
          high = middle - 1;
        } else {
          low = probe + 1;
        }
      }
      if (found !== -1) return { node: node, offset: found };
    }
    return null;
  }

  // Moves everything from the split point to the paragraph's end into a copy of the paragraph.
  function splitParagraphAtForDocxToPdf(paragraph, point) {
    const doc = paragraph.ownerDocument;
    const range = doc.createRange();
    if (point.before) range.setStartBefore(point.before);
    else range.setStart(point.node, point.offset);
    range.setEnd(paragraph, paragraph.childNodes.length);
    const moved = range.extractContents();
    const rest = paragraph.cloneNode(false);
    rest.removeAttribute('id');
    rest.appendChild(moved);
    rest.classList.add('abchat-cont');
    paragraph.classList.add('abchat-split');
    if (doc.defaultView.getComputedStyle(paragraph).textAlign === 'justify') paragraph.classList.add('abchat-split-justify');
    return rest;
  }

  // ---- Blocks ----

  // What to do with a block that runs past the limit: keep it ("all": it starts its page and cannot
  // move or split), move it whole ("none"), or split it ("split", with the part that moves).
  function splitBlockForDocxToPdf(block, area, firstOnPage) {
    if (block.tagName === 'P') return splitParagraphForDocxToPdf(block, area, firstOnPage);
    if (block.tagName === 'TABLE') return splitTableForDocxToPdf(block, area, firstOnPage);
    return { kind: firstOnPage ? 'all' : 'none' };
  }

  function splitParagraphForDocxToPdf(paragraph, area, firstOnPage) {
    const rules = rulesForDocxToPdf();
    const lines = linesOfForDocxToPdf(paragraph, area);
    if (lines.length < 2) return { kind: firstOnPage ? 'all' : 'none' };
    let fit = 0;
    while (fit < lines.length && rectFitsForDocxToPdf(lines[fit], area)) fit++;
    const keep = rules.linesToKeep(lines.length, fit, {
      widowControl: !paragraph.hasAttribute('data-abchat-no-widow-control'),
      keepLines: paragraph.hasAttribute('data-abchat-keep-lines'),
      firstOnPage: firstOnPage
    });
    if (keep <= 0) return { kind: firstOnPage ? 'all' : 'none' };
    if (keep >= lines.length) return { kind: 'all' };
    const point = splitPointForDocxToPdf(paragraph, lines, keep, area);
    if (!point) return { kind: firstOnPage ? 'all' : 'none' };
    return { kind: 'split', rest: splitParagraphAtForDocxToPdf(paragraph, point) };
  }

  function directRowsForDocxToPdf(table) {
    const rows = [];
    Array.from(table.children).forEach(function (child) {
      if (child.tagName === 'TR') rows.push(child);
      else if (child.tagName === 'TBODY' || child.tagName === 'THEAD') {
        Array.from(child.children).forEach(function (row) { if (row.tagName === 'TR') rows.push(row); });
      }
    });
    return rows;
  }

  function emptyTableLikeForDocxToPdf(table, headerRows) {
    const copy = table.cloneNode(false);
    copy.removeAttribute('id');
    Array.from(table.children).forEach(function (child) {
      if (child.tagName === 'COLGROUP') copy.appendChild(child.cloneNode(true));
    });
    headerRows.forEach(function (row) { copy.appendChild(row.cloneNode(true)); });
    return copy;
  }

  // A row splits between its cells' paragraphs and lines, as Word splits a row across pages, unless
  // it may not split or it holds a cell merged with the rows below. It also moves whole when a cell
  // with content would keep none of it on this page: Word moved a CV's skills row to the next page
  // rather than leave its label there alone, because widow control kept the three-line paragraph
  // beside it off the page. Header rows repeat on the next page.
  function splitTableForDocxToPdf(table, area, firstOnPage) {
    const rows = directRowsForDocxToPdf(table);
    let headerCount = 0;
    while (headerCount < rows.length && rows[headerCount].hasAttribute('data-abchat-header-row')) headerCount++;
    const headerRows = rows.slice(0, headerCount);
    let stay = 0;
    while (stay < rows.length && rectFitsForDocxToPdf(rows[stay].getBoundingClientRect(), area)) stay++;
    if (stay >= rows.length) return { kind: 'all' };
    if (stay < headerCount) return { kind: firstOnPage ? 'all' : 'none' };
    const row = rows[stay];
    const cells = Array.from(row.children);
    const canSplitRow = !row.hasAttribute('data-abchat-cant-split')
      && !cells.some(function (cell) { return cell.rowSpan > 1 || cell.style.display === 'none'; });
    let restRow = null;
    if (canSplitRow) {
      const restCells = [];
      let anyStays = false;
      let anyMoves = false;
      let everyCellStarts = true;
      cells.forEach(function (cell) {
        const hadContent = cell.children.length > 0 && !isEmptyBlockForDocxToPdf(cell);
        const split = splitContainerForDocxToPdf(cell, area, false, false);
        const restCell = cell.cloneNode(false);
        restCell.removeAttribute('id');
        if (split) {
          if (split.rest) restCell.appendChild(split.rest);
          Array.from(cell.children).slice(split.moveFrom).forEach(function (child) { restCell.appendChild(child); });
          anyMoves = true;
        }
        if (cell.children.length && !isEmptyBlockForDocxToPdf(cell)) anyStays = true;
        else if (hadContent) everyCellStarts = false;
        restCells.push(restCell);
      });
      if (anyMoves && anyStays && everyCellStarts) {
        restRow = row.cloneNode(false);
        restRow.removeAttribute('id');
        restCells.forEach(function (restCell) { restRow.appendChild(restCell); });
      } else if (anyMoves) {
        // Nothing of the row stays, so it moves whole: give the cells their content back.
        cells.forEach(function (cell, indexForCell) {
          Array.from(restCells[indexForCell].childNodes).forEach(function (child) { cell.appendChild(child); });
        });
        mergeContinuationsForDocxToPdf(row);
      }
    }
    const firstMoving = restRow ? stay + 1 : stay;
    if (!restRow && stay <= headerCount) return { kind: firstOnPage ? 'all' : 'none' };
    const rest = emptyTableLikeForDocxToPdf(table, headerRows);
    if (restRow) rest.appendChild(restRow);
    rows.slice(firstMoving).forEach(function (movingRow) { rest.appendChild(movingRow); });
    return { kind: 'split', rest: rest };
  }

  // Joins a paragraph split back with its continuation when both end up in the same cell again.
  function mergeContinuationsForDocxToPdf(root) {
    root.querySelectorAll('p.abchat-split').forEach(function (paragraph) {
      const next = paragraph.nextElementSibling;
      if (!next || !next.classList.contains('abchat-cont')) return;
      while (next.firstChild) paragraph.appendChild(next.firstChild);
      next.remove();
      paragraph.classList.remove('abchat-split', 'abchat-split-justify');
      paragraph.normalize();
    });
  }

  // Finds the first child of container that runs past the limit and decides what moves. Returns
  // null when everything fits, else { moveFrom, rest }: the children from moveFrom on move to the
  // next page, after rest, the moving part of a split child. keepNext pulls a heading that must stay
  // with its next paragraph along with it, unless that would empty the page.
  function splitContainerForDocxToPdf(container, area, firstOnPage, keepNext) {
    const children = Array.from(container.children);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const rects = Array.from(child.getClientRects());
      if (!rects.length || rects.every(function (rect) { return rectFitsForDocxToPdf(rect, area); })) continue;
      const isFirst = firstOnPage && index === 0;
      const decision = splitBlockForDocxToPdf(child, area, isFirst);
      if (decision.kind === 'all') continue;
      if (decision.kind === 'split') return { moveFrom: index + 1, rest: decision.rest };
      let moveFrom = index;
      if (keepNext) {
        while (moveFrom > 0 && children[moveFrom - 1].hasAttribute('data-abchat-keep-next')) moveFrom--;
        if (moveFrom === 0 && firstOnPage) moveFrom = index;
      }
      return { moveFrom: moveFrom, rest: null };
    }
    return null;
  }

  // ---- Pages ----

  function variantCopyForDocxToPdf(variants, name) {
    const source = name && variants && variants[name];
    if (!source) return null;
    const copy = source.cloneNode(true);
    copy.setAttribute('data-abchat-variant', name);
    return copy;
  }

  // Gives a page the header and footer its number calls for.
  // Returns the header and footer it put on the page.
  function dressPageForDocxToPdf(page, pageNumber, firstOfSection) {
    const meta = page.abchatPage;
    if (!meta) return [];
    const rules = rulesForDocxToPdf();
    const props = meta.props || {};
    Array.from(page.children).forEach(function (child) {
      if (child.tagName === 'HEADER' || child.tagName === 'FOOTER') child.remove();
    });
    const header = variantCopyForDocxToPdf(meta.headers, rules.headerVariant(meta.headers, firstOfSection, !!props.titlePage, !!meta.evenAndOdd, pageNumber));
    const footer = variantCopyForDocxToPdf(meta.footers, rules.headerVariant(meta.footers, firstOfSection, !!props.titlePage, !!meta.evenAndOdd, pageNumber));
    if (header) page.insertBefore(header, page.firstChild);
    if (footer) page.appendChild(footer);
    return [header, footer].filter(Boolean);
  }

  // The body area of a page for measuring: its limit, and for a multi-column article the column
  // geometry, with the columns filled in order so what does not fit lands right of the page.
  function areaForArticleForDocxToPdf(article, limit) {
    const view = article.ownerDocument.defaultView;
    const style = view.getComputedStyle(article);
    const columnCount = parseInt(style.columnCount, 10);
    const rect = article.getBoundingClientRect();
    if (columnCount > 1) {
      article.style.height = Math.max(0, limit - rect.top) + 'px';
      article.style.columnFill = 'auto';
      const gap = parseFloat(style.columnGap) || 0;
      const columnWidth = (rect.width + gap) / columnCount;
      return { limit: limit, left: rect.left, right: rect.right, columnWidth: columnWidth };
    }
    return { limit: limit, left: rect.left, right: Infinity, columnWidth: 0 };
  }

  function articleOverflowsForDocxToPdf(article, limit) {
    return Array.from(article.children).some(function (child) {
      return Array.from(child.getClientRects()).some(function (rect) { return rect.bottom > limit + TOLERANCE_PX_FOR_DOCX_TO_PDF; });
    });
  }

  // Moves what does not fit on the page to a new page after it, and returns the new page, or null.
  function splitPageForDocxToPdf(page, geometry) {
    const limit = contentLimitForDocxToPdf(page, geometry);
    const articles = Array.from(page.children).filter(function (child) { return child.tagName === 'ARTICLE'; });
    for (let indexForArticle = 0; indexForArticle < articles.length; indexForArticle++) {
      const article = articles[indexForArticle];
      const isMultiColumn = parseInt(article.ownerDocument.defaultView.getComputedStyle(article).columnCount, 10) > 1;
      if (isMultiColumn && !articleOverflowsForDocxToPdf(article, limit)) continue;
      const area = areaForArticleForDocxToPdf(article, limit);
      const firstOnPage = indexForArticle === 0;
      const split = splitContainerForDocxToPdf(article, area, firstOnPage, true);
      if (!split) continue;
      const moving = [];
      if (split.rest) moving.push(split.rest);
      Array.from(article.children).slice(split.moveFrom).forEach(function (child) { moving.push(child); });
      const laterArticles = articles.slice(indexForArticle + 1);
      if (!laterArticles.length && moving.every(isEmptyBlockForDocxToPdf)) {
        moving.forEach(function (child) { child.remove(); });
        return null;
      }
      const nextPage = page.cloneNode(false);
      nextPage.removeAttribute('id');
      nextPage.abchatPage = page.abchatPage;
      nextPage.abchatContinued = true;
      const nextArticle = article.cloneNode(false);
      nextArticle.style.height = '';
      nextArticle.style.columnFill = '';
      moving.forEach(function (child) { nextArticle.appendChild(child); });
      nextPage.appendChild(nextArticle);
      laterArticles.forEach(function (later) { nextPage.appendChild(later); });
      page.after(nextPage);
      return nextPage;
    }
    return null;
  }

  function paginateForDocxToPdf(pagesHost) {
    const pages = Array.from(pagesHost.children).filter(function (child) { return child.tagName === 'SECTION'; });
    for (let index = 0; index < pages.length; index++) {
      if (pages.length > MAX_PAGES_FOR_DOCX_TO_PDF) {
        throw new Error('The document runs past ' + MAX_PAGES_FOR_DOCX_TO_PDF + ' pages, which this converter does not lay out.');
      }
      const page = pages[index];
      const firstOfSection = !!(page.abchatPage && page.abchatPage.firstOfSection && !page.abchatContinued);
      const margins = dressPageForDocxToPdf(page, index + 1, firstOfSection);
      if (margins.length) prepareTextForDocxToPdf(page.ownerDocument, margins, [page]);
      const geometry = fixPageHeightForDocxToPdf(page);
      const nextPage = splitPageForDocxToPdf(page, geometry);
      if (nextPage) pages.splice(index + 1, 0, nextPage);
    }
    return pages;
  }

  function fillFieldsForDocxToPdf(pages) {
    const rules = rulesForDocxToPdf();
    const sectionCounts = new Map();
    pages.forEach(function (page) {
      const key = page.abchatPage ? page.abchatPage.props : null;
      sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
    });
    pages.forEach(function (page, index) {
      const key = page.abchatPage ? page.abchatPage.props : null;
      page.querySelectorAll('[data-abchat-field]').forEach(function (field) {
        const text = rules.fieldText(field.getAttribute('data-abchat-field'), index + 1, pages.length, sectionCounts.get(key) || 1);
        if (text) field.textContent = text;
      });
    });
  }

  // ---- Output ----

  function cleanCssForDocxToPdf(cssText) {
    return String(cssText || '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/(?:-webkit-)?image-set\([^)]*\)/gi, 'none')
      .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, function (whole, quote, address) {
        return address.indexOf(FONT_CDN_FOR_DOCX_TO_PDF) === 0 ? whole : 'none';
      })
      .replace(/</g, '\\3c ');
  }

  function cleanStyleAttributeForDocxToPdf(element) {
    const styleText = element.getAttribute('style');
    if (!styleText || !/url\(|image-set\(|expression\(/i.test(styleText)) return;
    element.setAttribute('style', styleText.split(';').filter(function (declaration) {
      return !/url\(|image-set\(|expression\(/i.test(declaration);
    }).join(';'));
  }

  // Leaves only what the printer's check accepts: no active or embedding elements, no handlers,
  // web and mail links only, and pictures only as data URLs of types Chrome can draw.
  function cleanPagesForDocxToPdf(pagesHost, warnings) {
    let droppedPictures = 0;
    let droppedMath = 0;
    pagesHost.querySelectorAll('math').forEach(function (math) {
      const text = math.ownerDocument.createElement('span');
      text.textContent = math.textContent;
      math.replaceWith(text);
      droppedMath++;
    });
    pagesHost.querySelectorAll(REMOVED_TAGS_FOR_DOCX_TO_PDF.join(',')).forEach(function (element) { element.remove(); });
    pagesHost.querySelectorAll('img').forEach(function (image) {
      const source = image.getAttribute('src') || '';
      if (!PRINTABLE_IMAGE_RE_FOR_DOCX_TO_PDF.test(source)) {
        image.remove();
        droppedPictures++;
      }
    });
    pagesHost.querySelectorAll('*').forEach(function (element) {
      Array.from(element.attributes).forEach(function (attribute) {
        const name = attribute.name.toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcset' || name.indexOf('data-abchat-') === 0 || name === 'xmlns' || name === 'formaction') {
          element.removeAttribute(attribute.name);
        }
      });
      if (element.tagName === 'A') {
        const href = element.getAttribute('href');
        if (href !== null && !LINK_RE_FOR_DOCX_TO_PDF.test(href.trim())) element.removeAttribute('href');
        element.removeAttribute('target');
      }
      cleanStyleAttributeForDocxToPdf(element);
    });
    if (droppedPictures) warnings.push(droppedPictures + ' picture' + (droppedPictures === 1 ? ' is' : 's are') + ' in a format Chrome cannot draw (such as EMF or WMF) and ' + (droppedPictures === 1 ? 'is' : 'are') + ' left out of the PDF.');
    if (droppedMath) warnings.push(droppedMath + ' equation' + (droppedMath === 1 ? ' is' : 's are') + ' printed as plain text.');
  }

  function pageCssForDocxToPdf(pages) {
    const sizes = [];
    pages.forEach(function (page) {
      const width = ptForDocxToPdf(page.style.width) || 612;
      const height = ptForDocxToPdf(page.style.height) || 792;
      const key = width.toFixed(2) + 'x' + height.toFixed(2);
      let index = sizes.findIndex(function (size) { return size.key === key; });
      if (index === -1) {
        sizes.push({ key: key, width: width, height: height });
        index = sizes.length - 1;
      }
      if (index > 0) page.classList.add('abchat-size-' + index);
    });
    const rules = ['@page { size: ' + sizes[0].width.toFixed(2) + 'pt ' + sizes[0].height.toFixed(2) + 'pt; margin: 0; }'];
    sizes.slice(1).forEach(function (size, offset) {
      const name = 'abchat-size-' + (offset + 1);
      rules.push('@page ' + name + ' { size: ' + size.width.toFixed(2) + 'pt ' + size.height.toFixed(2) + 'pt; margin: 0; }');
      rules.push('section.docx.' + name + ' { page: ' + name + '; }');
    });
    rules.push('section.docx { overflow: hidden; break-after: page; break-inside: avoid; }');
    rules.push('section.docx:last-child { break-after: auto; }');
    return rules.join('\n');
  }

  // ---- Convert ----

  // bytes: the DOCX as a Uint8Array. Resolves to { ok: true, html, fonts, templates, pageCount,
  // warnings } for the printer, or { ok: false, error, refused } when the file cannot be converted;
  // refused is true when the file was turned away for its layout rather than for a fault.
  async function convertForDocxToPdf(bytes, options) {
    const safeOptions = options || {};
    const rules = rulesForDocxToPdf();
    const JSZipForConvert = globalScopeForDocxToPdf.JSZip;
    let library = null;
    try {
      library = await loadLibraryForDocxToPdf();
    } catch (errForLibrary) {
      return { ok: false, error: (errForLibrary && errForLibrary.message) || 'The Word converter failed to load.' };
    }
    if (!rules || !library || !JSZipForConvert) {
      return { ok: false, error: 'The Word converter is not available here.' };
    }
    if (!bytes || !bytes.length) return { ok: false, error: 'The file is empty.' };
    if (bytes.length > MAX_BYTES_FOR_DOCX_TO_PDF) return { ok: false, error: 'The file is larger than 20 MB, which this converter does not take.' };

    let zip;
    try {
      zip = await JSZipForConvert.loadAsync(bytes);
    } catch (errForZip) {
      return { ok: false, error: 'The file is not a DOCX (it could not be opened as one).' };
    }
    const documentEntry = zip.file('word/document.xml');
    if (!documentEntry) return { ok: false, error: 'The file is not a DOCX (it has no word/document.xml).' };
    const preflight = rules.preflight(await documentEntry.async('string'));
    if (!preflight.ok) {
      return {
        ok: false,
        refused: true,
        error: 'This document has ' + preflight.reason + ', and this converter lays out only documents whose content flows down the page. '
          + 'It was not converted. Tell the user to open it in Word and use File > Save as PDF (or Export > PDF), which keeps the layout.'
      };
    }

    let frame = null;
    try {
      frame = await openFrameForDocxToPdf();
      const frameDocument = frame.contentDocument;
      const stylesHost = frameDocument.getElementById('abchat-docx-styles');
      const pagesHost = frameDocument.getElementById('abchat-docx-pages');
      const parsedDocument = await library.renderAsync(bytes, pagesHost, stylesHost, {
        className: 'docx', inWrapper: false, ignoreWidth: false, ignoreHeight: false, ignoreFonts: true,
        breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true, trimXmlDeclaration: true,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        renderComments: false, renderChanges: false, useBase64URL: true, debug: false, abchatManualTabs: true
      });
      if (!pagesHost.querySelector('section.docx')) return { ok: false, error: 'The document has no pages to print.' };
      stylesHost.querySelectorAll('style').forEach(function (style) { style.textContent = rules.paragraphSelectors(style.textContent); });

      const warnings = [];
      const fontTable = (parsedDocument && parsedDocument.fontTablePart && parsedDocument.fontTablePart.fonts) || [];
      const plan = fontPlanForDocxToPdf(usedFamiliesForDocxToPdf(frameDocument, pagesHost), fontTable,
        defaultFamilyForDocxToPdf(frameDocument, pagesHost), warnings);
      frameDocument.getElementById('abchat-fonts').textContent = plan.css;
      if (!(await waitForFontsForDocxToPdf(frameDocument))) warnings.push('Some fonts took too long to load, so lines may break differently in the PDF.');

      prepareTextForDocxToPdf(frameDocument, [pagesHost], Array.from(pagesHost.querySelectorAll('section.docx')));
      const pages = paginateForDocxToPdf(pagesHost);
      fillFieldsForDocxToPdf(pages);
      // Headers and footers copied onto new pages, and the second parts of split paragraphs, measure
      // their tabs where they now are.
      pages.forEach(function (page) {
        Array.from(page.children).forEach(function (child) {
          if (child.tagName === 'HEADER' || child.tagName === 'FOOTER') updateTabsForDocxToPdf(child);
        });
        page.querySelectorAll('p.abchat-cont').forEach(updateTabsForDocxToPdf);
      });
      placeShapesForDocxToPdf(pagesHost);

      const pageCss = pageCssForDocxToPdf(pages);
      cleanPagesForDocxToPdf(pagesHost, warnings);
      const css = [
        frameDocument.getElementById('abchat-base').textContent,
        plan.css,
        Array.from(stylesHost.querySelectorAll('style')).map(function (style) { return style.textContent; }).join('\n'),
        pageCss
      ].map(cleanCssForDocxToPdf).join('\n');
      const body = pages.map(function (page) { return page.outerHTML; }).join('');
      // The printer parses this text again. If the parser would build a different tree, the page
      // breaks measured here do not hold and text can run off the page, so refuse rather than print.
      const reparsed = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + body + '</body></html>', 'text/html');
      const measured = pages.reduce(function (total, page) { return total + 1 + elementCountForDocxToPdf(page); }, 0);
      if (elementCountForDocxToPdf(reparsed.body) !== measured) {
        return {
          ok: false,
          error: 'The converter could not lay this document out reliably, so it was not converted. '
            + 'Tell the user to open it in Word and use File > Save as PDF (or Export > PDF).'
        };
      }
      const html = '<!DOCTYPE html><html lang="' + escapeHtmlForDocxToPdf(safeOptions.lang || 'en') + '"><head><meta charset="utf-8"><title>'
        + escapeHtmlForDocxToPdf(safeOptions.title || 'Document') + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
      return {
        ok: true,
        html: html,
        fonts: plan.fonts,
        templates: { needed: false, header: '<div></div>', footer: '<div></div>' },
        pageCount: pages.length,
        warnings: warnings
      };
    } catch (errForConvert) {
      return { ok: false, error: (errForConvert && errForConvert.message) || 'The document could not be laid out.' };
    } finally {
      if (frame) frame.remove();
    }
  }

  agentNsForDocxToPdf.docxToPdf = { convert: convertForDocxToPdf };
  globalScopeForDocxToPdf.ABChatAgent = agentNsForDocxToPdf;
})();
