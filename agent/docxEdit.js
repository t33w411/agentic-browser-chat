(function () {
  var globalScopeForDocxEdit = globalThis;
  var agentNamespaceForDocxEdit = globalScopeForDocxEdit.ABChatAgent || {};

  // Changes an existing DOCX in place. Only the parts an edit touches are rewritten, and inside
  // them only the elements an edit touches: every other element is written back from its
  // original source text. Styles, numbering, headers, footers, comments, images, and markup this
  // module does not understand therefore come back exactly as they were. It has no DOM and no
  // chrome.* use, so it runs in the service worker (where there is no DOMParser) and in Node tests.
  //
  // Paragraph ids are "p" plus the 1-based position of a w:p in the main document part, counted
  // in document order and skipping text-box content. The read side (prepareForRead, then
  // attachParagraphIds) and the edit side (applyEditsToParts) both count with
  // collectParagraphsForDocxEdit, so an id the model read is the paragraph the edit changes.

  var DOCX_MIME_TYPE_FOR_DOCX_EDIT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var DEFAULT_MAIN_PART_FOR_DOCX_EDIT = 'word/document.xml';
  var MARKER_PREFIX_FOR_DOCX_EDIT = '[[abchat-p:';
  var MARKER_SUFFIX_FOR_DOCX_EDIT = ']]';
  var MARKER_RE_FOR_DOCX_EDIT = /\[\[abchat-p:(\d+)\]\]/g;
  // A marker that mammoth placed at the start of a block, after any inline tags it opened first.
  var BLOCK_MARKER_RE_FOR_DOCX_EDIT = /<(p|h[1-6]|li)((?:\s[^>]*)?)>((?:<\/?(?:strong|em|u|s|sup|sub|a|span|b|i)\b[^>]*>|<img\b[^>]*>)*)\[\[abchat-p:(\d+)\]\]/g;
  var MAX_EDITS_FOR_DOCX_EDIT = 200;
  var MAX_TEXT_CHARS_FOR_DOCX_EDIT = 20000;
  var MAX_FIND_CHARS_FOR_DOCX_EDIT = 2000;
  var MAX_INSERTED_PARAGRAPHS_FOR_DOCX_EDIT = 200;
  var MAX_HEADER_FOOTER_TEXTS_FOR_DOCX_EDIT = 20;
  var MAX_HEADER_FOOTER_CHARS_FOR_DOCX_EDIT = 300;
  var DEFAULT_AUTHOR_FOR_DOCX_EDIT = 'ABChat';
  var OTHER_TEXT_PART_RE_FOR_DOCX_EDIT = /^word\/(header\d*|footer\d*|footnotes|endnotes)\.xml$/;
  var HEADER_FOOTER_PART_RE_FOR_DOCX_EDIT = /^word\/(header|footer)\d*\.xml$/;
  var OPS_FOR_DOCX_EDIT = ['replace_text', 'set_text', 'insert_after', 'insert_before', 'delete',
    'insert_row_after', 'insert_row_before', 'delete_row', 'delete_table', 'format'];
  var HIGHLIGHT_NAMES_FOR_DOCX_EDIT = ['yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'darkBlue', 'darkCyan',
    'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray', 'black', 'white', 'none'];
  var ALIGN_TO_JC_FOR_DOCX_EDIT = { left: 'left', center: 'center', right: 'right', justify: 'both' };

  // Child order inside w:rPr, w:pPr and w:trPr. Word rejects a file whose property children are
  // out of schema order, so new properties are inserted by rank rather than appended.
  var RPR_ORDER_FOR_DOCX_EDIT = ['ins', 'del', 'moveFrom', 'moveTo', 'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs',
    'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid',
    'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect',
    'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
    'rPrChange'];
  var PPR_ORDER_FOR_DOCX_EDIT = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
    'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
    'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
    'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
    'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
  var TRPR_ORDER_FOR_DOCX_EDIT = ['cnfStyle', 'divId', 'gridBefore', 'gridAfter', 'wBefore', 'wAfter', 'cantSplit',
    'trHeight', 'tblHeader', 'tblCellSpacing', 'jc', 'hidden', 'ins', 'del', 'trPrChange'];

  // Containers whose text is the paragraph's visible text. Deleted revisions, field instructions,
  // drawings and property elements are not walked.
  var TEXT_CONTAINERS_FOR_DOCX_EDIT = { r: true, hyperlink: true, ins: true, smartTag: true, sdt: true, sdtContent: true,
    fldSimple: true, customXml: true, moveTo: true, dir: true, bdo: true };
  // Containers that can be dropped once a set_text has emptied them.
  var PRUNABLE_CONTAINERS_FOR_DOCX_EDIT = { r: true, hyperlink: true, smartTag: true, ins: true, fldSimple: true, customXml: true };
  // Zero-width markers that pair across paragraphs. Moved, not dropped, when their paragraph goes.
  var RANGE_MARKERS_FOR_DOCX_EDIT = { bookmarkStart: true, bookmarkEnd: true, commentRangeStart: true, commentRangeEnd: true,
    permStart: true, permEnd: true, moveFromRangeStart: true, moveFromRangeEnd: true, moveToRangeStart: true, moveToRangeEnd: true };
  // Subtrees that hold no editable run of the paragraph or row being deleted.
  var RUN_WALK_STOPS_FOR_DOCX_EDIT = { del: true, moveFrom: true, pPr: true, rPr: true, drawing: true, pict: true, object: true,
    AlternateContent: true, txbxContent: true, tcPr: true, trPr: true, tblPr: true, tblGrid: true, sectPr: true };

  // ---- Lossless XML ----

  function localNameForDocxEdit(nameForLocal) {
    var textForLocal = String(nameForLocal || '');
    var colonForLocal = textForLocal.indexOf(':');
    return colonForLocal < 0 ? textForLocal : textForLocal.slice(colonForLocal + 1);
  }

  // The namespace prefix of a name, colon included ("w:"), or '' for an unprefixed name.
  function prefixForDocxEdit(nameForPrefix) {
    var textForPrefix = String(nameForPrefix || '');
    var colonForPrefix = textForPrefix.indexOf(':');
    return colonForPrefix < 0 ? '' : textForPrefix.slice(0, colonForPrefix + 1);
  }

  function decodeXmlForDocxEdit(rawForDecode) {
    return String(rawForDecode == null ? '' : rawForDecode)
      .replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (wholeForDecode, entityForDecode) {
        if (entityForDecode.charAt(0) === '#') {
          var hexForDecode = entityForDecode.charAt(1) === 'x' || entityForDecode.charAt(1) === 'X';
          var codeForDecode = hexForDecode ? parseInt(entityForDecode.slice(2), 16) : parseInt(entityForDecode.slice(1), 10);
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

  // Characters XML 1.0 does not allow are dropped rather than written into a file Word would refuse.
  function escapeXmlTextForDocxEdit(textForEscape) {
    return String(textForEscape == null ? '' : textForEscape)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeXmlAttrForDocxEdit(valueForEscape) {
    return escapeXmlTextForDocxEdit(valueForEscape).replace(/"/g, '&quot;');
  }

  // Node shapes: { type: 'root', children }, { type: 'el', name, attrsRaw, rawOpen, rawClose,
  // selfClosing, dirty, children }, { type: 'text', raw } and { type: 'raw', raw } for comments,
  // processing instructions, CDATA and declarations. Every node has a parent pointer.
  function parseXmlForDocxEdit(sourceForParse) {
    var srcForParse = String(sourceForParse == null ? '' : sourceForParse);
    var lengthForParse = srcForParse.length;
    var rootForParse = { type: 'root', children: [], parent: null };
    var stackForParse = [rootForParse];
    var indexForParse = 0;
    function addNodeForParse(nodeForAdd) {
      var parentForAdd = stackForParse[stackForParse.length - 1];
      nodeForAdd.parent = parentForAdd;
      parentForAdd.children.push(nodeForAdd);
    }
    function addRawUntilForParse(startForRaw, terminatorForRaw, skipForRaw) {
      var endForRaw = srcForParse.indexOf(terminatorForRaw, startForRaw + skipForRaw);
      endForRaw = endForRaw < 0 ? lengthForParse : endForRaw + terminatorForRaw.length;
      addNodeForParse({ type: 'raw', raw: srcForParse.slice(startForRaw, endForRaw) });
      indexForParse = endForRaw;
    }
    while (indexForParse < lengthForParse) {
      var ltForParse = srcForParse.indexOf('<', indexForParse);
      if (ltForParse < 0) {
        addNodeForParse({ type: 'text', raw: srcForParse.slice(indexForParse) });
        break;
      }
      if (ltForParse > indexForParse) addNodeForParse({ type: 'text', raw: srcForParse.slice(indexForParse, ltForParse) });
      if (srcForParse.startsWith('<!--', ltForParse)) { addRawUntilForParse(ltForParse, '-->', 4); continue; }
      if (srcForParse.startsWith('<![CDATA[', ltForParse)) { addRawUntilForParse(ltForParse, ']]>', 9); continue; }
      var secondCharForParse = srcForParse.charAt(ltForParse + 1);
      if (secondCharForParse === '?') { addRawUntilForParse(ltForParse, '?>', 2); continue; }
      if (secondCharForParse === '!') { addRawUntilForParse(ltForParse, '>', 2); continue; }
      var cursorForParse = ltForParse + 1;
      var quoteForParse = '';
      while (cursorForParse < lengthForParse) {
        var charForParse = srcForParse.charAt(cursorForParse);
        if (quoteForParse) {
          if (charForParse === quoteForParse) quoteForParse = '';
        } else if (charForParse === '"' || charForParse === "'") {
          quoteForParse = charForParse;
        } else if (charForParse === '>') {
          break;
        }
        cursorForParse++;
      }
      if (cursorForParse >= lengthForParse) throw new Error('The XML has an unterminated tag.');
      var tagForParse = srcForParse.slice(ltForParse, cursorForParse + 1);
      indexForParse = cursorForParse + 1;
      if (secondCharForParse === '/') {
        var closeNameForParse = tagForParse.slice(2, -1).trim();
        var openForParse = stackForParse[stackForParse.length - 1];
        if (openForParse.type !== 'el' || openForParse.name !== closeNameForParse) {
          throw new Error('The XML has a mismatched closing tag </' + closeNameForParse + '>.');
        }
        openForParse.rawClose = tagForParse;
        stackForParse.pop();
        continue;
      }
      var selfClosingForParse = /\/\s*>$/.test(tagForParse);
      var innerForParse = selfClosingForParse ? tagForParse.slice(1, tagForParse.lastIndexOf('/')) : tagForParse.slice(1, -1);
      var nameEndForParse = 0;
      while (nameEndForParse < innerForParse.length && ' \t\r\n'.indexOf(innerForParse.charAt(nameEndForParse)) < 0) nameEndForParse++;
      var elementForParse = {
        type: 'el',
        name: innerForParse.slice(0, nameEndForParse),
        attrsRaw: innerForParse.slice(nameEndForParse),
        attrs: null,
        rawOpen: tagForParse,
        rawClose: '',
        selfClosing: selfClosingForParse,
        dirty: false,
        children: []
      };
      addNodeForParse(elementForParse);
      if (!selfClosingForParse) stackForParse.push(elementForParse);
    }
    if (stackForParse.length !== 1) {
      throw new Error('The XML has an unclosed element <' + stackForParse[stackForParse.length - 1].name + '>.');
    }
    return rootForParse;
  }

  function attrsOfForDocxEdit(elementForAttrs) {
    if (!elementForAttrs.attrs) {
      var listForAttrs = [];
      var reForAttrs = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      var matchForAttrs;
      while ((matchForAttrs = reForAttrs.exec(elementForAttrs.attrsRaw || '')) !== null) {
        listForAttrs.push({ name: matchForAttrs[1], value: decodeXmlForDocxEdit(matchForAttrs[2] != null ? matchForAttrs[2] : matchForAttrs[3]) });
      }
      elementForAttrs.attrs = listForAttrs;
    }
    return elementForAttrs.attrs;
  }

  function getAttrForDocxEdit(elementForGet, nameForGet) {
    var attrsForGet = attrsOfForDocxEdit(elementForGet);
    for (var iForGet = 0; iForGet < attrsForGet.length; iForGet++) {
      if (attrsForGet[iForGet].name === nameForGet || localNameForDocxEdit(attrsForGet[iForGet].name) === nameForGet) {
        return attrsForGet[iForGet].value;
      }
    }
    return null;
  }

  function setAttrForDocxEdit(elementForSet, nameForSet, valueForSet) {
    var attrsForSet = attrsOfForDocxEdit(elementForSet);
    for (var iForSet = 0; iForSet < attrsForSet.length; iForSet++) {
      if (attrsForSet[iForSet].name === nameForSet) {
        attrsForSet[iForSet].value = String(valueForSet);
        elementForSet.dirty = true;
        return;
      }
    }
    attrsForSet.push({ name: nameForSet, value: String(valueForSet) });
    elementForSet.dirty = true;
  }

  function removeAttrsForDocxEdit(elementForRemove, predicateForRemove) {
    var attrsForRemove = attrsOfForDocxEdit(elementForRemove);
    var keptForRemove = attrsForRemove.filter(function (attrForRemove) { return !predicateForRemove(attrForRemove.name); });
    if (keptForRemove.length !== attrsForRemove.length) {
      elementForRemove.attrs = keptForRemove;
      elementForRemove.dirty = true;
    }
  }

  function buildOpenTagForDocxEdit(elementForTag, selfCloseForTag) {
    var partsForTag = ['<', elementForTag.name];
    attrsOfForDocxEdit(elementForTag).forEach(function (attrForTag) {
      partsForTag.push(' ', attrForTag.name, '="', escapeXmlAttrForDocxEdit(attrForTag.value), '"');
    });
    partsForTag.push(selfCloseForTag ? '/>' : '>');
    return partsForTag.join('');
  }

  // An element nobody changed is written from its source text, so an untouched part serializes
  // byte for byte as it was parsed.
  function serializeXmlForDocxEdit(rootForSerialize) {
    var outForSerialize = [];
    function emitForSerialize(nodeForEmit) {
      if (nodeForEmit.type === 'text' || nodeForEmit.type === 'raw') {
        outForSerialize.push(nodeForEmit.raw);
        return;
      }
      if (nodeForEmit.type === 'root') {
        nodeForEmit.children.forEach(emitForSerialize);
        return;
      }
      var hasChildrenForEmit = nodeForEmit.children.length > 0;
      if (!nodeForEmit.dirty && nodeForEmit.rawOpen) {
        if (nodeForEmit.selfClosing) {
          if (!hasChildrenForEmit) {
            outForSerialize.push(nodeForEmit.rawOpen);
            return;
          }
          outForSerialize.push('<' + nodeForEmit.name + nodeForEmit.attrsRaw + '>');
        } else {
          outForSerialize.push(nodeForEmit.rawOpen);
        }
      } else {
        outForSerialize.push(buildOpenTagForDocxEdit(nodeForEmit, !hasChildrenForEmit));
        if (!hasChildrenForEmit) return;
      }
      nodeForEmit.children.forEach(emitForSerialize);
      outForSerialize.push(nodeForEmit.rawClose || ('</' + nodeForEmit.name + '>'));
    }
    emitForSerialize(rootForSerialize);
    return outForSerialize.join('');
  }

  function makeElForDocxEdit(nameForMake, attrPairsForMake, childrenForMake) {
    var elementForMake = {
      type: 'el',
      name: nameForMake,
      attrsRaw: '',
      attrs: (attrPairsForMake || []).map(function (pairForMake) { return { name: pairForMake[0], value: String(pairForMake[1]) }; }),
      rawOpen: '',
      rawClose: '',
      selfClosing: false,
      dirty: true,
      children: [],
      parent: null
    };
    (childrenForMake || []).forEach(function (childForMake) { appendChildForDocxEdit(elementForMake, childForMake); });
    return elementForMake;
  }

  function makeTextNodeForDocxEdit(textForNode) {
    return { type: 'text', raw: escapeXmlTextForDocxEdit(textForNode), parent: null };
  }

  function cloneNodeForDocxEdit(nodeForClone) {
    if (nodeForClone.type !== 'el') return { type: nodeForClone.type, raw: nodeForClone.raw, parent: null };
    var copyForClone = {
      type: 'el',
      name: nodeForClone.name,
      attrsRaw: nodeForClone.attrsRaw,
      attrs: nodeForClone.attrs ? nodeForClone.attrs.map(function (attrForClone) { return { name: attrForClone.name, value: attrForClone.value }; }) : null,
      rawOpen: nodeForClone.rawOpen,
      rawClose: nodeForClone.rawClose,
      selfClosing: nodeForClone.selfClosing,
      dirty: nodeForClone.dirty,
      children: [],
      parent: null
    };
    nodeForClone.children.forEach(function (childForClone) {
      appendChildForDocxEdit(copyForClone, cloneNodeForDocxEdit(childForClone));
    });
    return copyForClone;
  }

  function detachForDocxEdit(nodeForDetach) {
    var parentForDetach = nodeForDetach.parent;
    if (parentForDetach) {
      var indexForDetach = parentForDetach.children.indexOf(nodeForDetach);
      if (indexForDetach >= 0) parentForDetach.children.splice(indexForDetach, 1);
    }
    nodeForDetach.parent = null;
  }

  function appendChildForDocxEdit(parentForAppend, childForAppend) {
    detachForDocxEdit(childForAppend);
    childForAppend.parent = parentForAppend;
    parentForAppend.children.push(childForAppend);
    return childForAppend;
  }

  function insertAtForDocxEdit(parentForInsert, indexForInsert, childForInsert) {
    detachForDocxEdit(childForInsert);
    childForInsert.parent = parentForInsert;
    parentForInsert.children.splice(Math.max(0, Math.min(indexForInsert, parentForInsert.children.length)), 0, childForInsert);
    return childForInsert;
  }

  function insertBeforeForDocxEdit(referenceForBefore, childForBefore) {
    var parentForBefore = referenceForBefore.parent;
    detachForDocxEdit(childForBefore);
    childForBefore.parent = parentForBefore;
    parentForBefore.children.splice(parentForBefore.children.indexOf(referenceForBefore), 0, childForBefore);
    return childForBefore;
  }

  function insertAfterForDocxEdit(referenceForAfter, childForAfter) {
    var parentForAfter = referenceForAfter.parent;
    detachForDocxEdit(childForAfter);
    childForAfter.parent = parentForAfter;
    parentForAfter.children.splice(parentForAfter.children.indexOf(referenceForAfter) + 1, 0, childForAfter);
    return childForAfter;
  }

  function replaceNodeForDocxEdit(oldForReplace, newNodesForReplace) {
    newNodesForReplace.forEach(function (newForReplace) { insertBeforeForDocxEdit(oldForReplace, newForReplace); });
    detachForDocxEdit(oldForReplace);
  }

  function isElForDocxEdit(nodeForIs, localForIs) {
    return !!nodeForIs && nodeForIs.type === 'el' && localNameForDocxEdit(nodeForIs.name) === localForIs;
  }

  function childElementsForDocxEdit(nodeForChildren, localForChildren) {
    return nodeForChildren.children.filter(function (childForChildren) {
      return childForChildren.type === 'el' && (!localForChildren || localNameForDocxEdit(childForChildren.name) === localForChildren);
    });
  }

  function firstChildElForDocxEdit(nodeForFirst, localForFirst) {
    if (!nodeForFirst || !nodeForFirst.children) return null;
    for (var iForFirst = 0; iForFirst < nodeForFirst.children.length; iForFirst++) {
      if (isElForDocxEdit(nodeForFirst.children[iForFirst], localForFirst)) return nodeForFirst.children[iForFirst];
    }
    return null;
  }

  function removeChildElementsForDocxEdit(nodeForRemove, localsForRemove) {
    childElementsForDocxEdit(nodeForRemove).forEach(function (childForRemove) {
      if (localsForRemove.indexOf(localNameForDocxEdit(childForRemove.name)) >= 0) detachForDocxEdit(childForRemove);
    });
  }

  function ancestorForDocxEdit(nodeForAncestor, localForAncestor) {
    var currentForAncestor = nodeForAncestor.parent;
    while (currentForAncestor) {
      if (isElForDocxEdit(currentForAncestor, localForAncestor)) return currentForAncestor;
      currentForAncestor = currentForAncestor.parent;
    }
    return null;
  }

  // Pre-order walk over elements below a node. visit returns false to skip an element's children.
  function walkElementsForDocxEdit(nodeForWalk, visitForWalk) {
    var childrenForWalk = nodeForWalk.children || [];
    for (var iForWalk = 0; iForWalk < childrenForWalk.length; iForWalk++) {
      var childForWalk = childrenForWalk[iForWalk];
      if (childForWalk.type !== 'el') continue;
      if (visitForWalk(childForWalk) !== false) walkElementsForDocxEdit(childForWalk, visitForWalk);
    }
  }

  function isAttachedForDocxEdit(nodeForAttached) {
    var currentForAttached = nodeForAttached;
    while (currentForAttached.parent) currentForAttached = currentForAttached.parent;
    return currentForAttached.type === 'root';
  }

  // The child of container that holds node.
  function topLevelChildForDocxEdit(containerForTop, nodeForTop) {
    var currentForTop = nodeForTop;
    while (currentForTop && currentForTop.parent !== containerForTop) currentForTop = currentForTop.parent;
    return currentForTop;
  }

  function textContentForDocxEdit(elementForText) {
    return elementForText.children.map(function (childForText) {
      if (childForText.type === 'text') return decodeXmlForDocxEdit(childForText.raw);
      if (childForText.type === 'raw' && childForText.raw.indexOf('<![CDATA[') === 0) return childForText.raw.slice(9, -3);
      return '';
    }).join('');
  }

  function setTextContentForDocxEdit(elementForSetText, textForSetText) {
    elementForSetText.children.forEach(function (childForSetText) { childForSetText.parent = null; });
    elementForSetText.children = [];
    if (textForSetText) appendChildForDocxEdit(elementForSetText, makeTextNodeForDocxEdit(textForSetText));
    setAttrForDocxEdit(elementForSetText, 'xml:space', 'preserve');
  }

  function renameElementForDocxEdit(elementForRename, newLocalForRename) {
    elementForRename.name = prefixForDocxEdit(elementForRename.name) + newLocalForRename;
    attrsOfForDocxEdit(elementForRename);
    elementForRename.dirty = true;
    elementForRename.rawClose = '';
  }

  // ---- Paragraphs and their text ----

  // Every w:p in document order. Without includeHidden, paragraphs inside text boxes are left
  // out: Word stores a text box twice (mc:Choice and its VML mc:Fallback), so neither copy is a
  // reliable single target for an id.
  function collectParagraphsForDocxEdit(rootForCollect, includeHiddenForCollect) {
    var paragraphsForCollect = [];
    walkElementsForDocxEdit(rootForCollect, function (elementForCollect) {
      var localForCollect = localNameForDocxEdit(elementForCollect.name);
      if (!includeHiddenForCollect && (localForCollect === 'txbxContent' || localForCollect === 'Fallback')) return false;
      if (localForCollect === 'p') paragraphsForCollect.push(elementForCollect);
      return true;
    });
    return paragraphsForCollect;
  }

  // The paragraph's visible text as pieces: w:t text, w:tab as a tab, w:br and w:cr as a newline.
  // Each piece records its node, the run holding it, and where it starts in the paragraph's text.
  function collectPiecesForDocxEdit(paragraphForPieces) {
    var piecesForPieces = [];
    var offsetForPieces = 0;
    function walkForPieces(nodeForPieces) {
      var childrenForPieces = nodeForPieces.children;
      for (var iForPieces = 0; iForPieces < childrenForPieces.length; iForPieces++) {
        var childForPieces = childrenForPieces[iForPieces];
        if (childForPieces.type !== 'el') continue;
        var localForPieces = localNameForDocxEdit(childForPieces.name);
        var inRunForPieces = isElForDocxEdit(childForPieces.parent, 'r');
        var kindForPieces = '';
        var textForPieces = '';
        if (localForPieces === 't' && inRunForPieces) {
          kindForPieces = 't';
          textForPieces = textContentForDocxEdit(childForPieces);
        } else if (localForPieces === 'tab' && inRunForPieces) {
          kindForPieces = 'tab';
          textForPieces = '\t';
        } else if ((localForPieces === 'br' || localForPieces === 'cr') && inRunForPieces) {
          kindForPieces = 'br';
          textForPieces = '\n';
        } else if (TEXT_CONTAINERS_FOR_DOCX_EDIT[localForPieces]) {
          walkForPieces(childForPieces);
          continue;
        } else {
          continue;
        }
        piecesForPieces.push({ node: childForPieces, kind: kindForPieces, text: textForPieces, start: offsetForPieces, run: childForPieces.parent });
        offsetForPieces += textForPieces.length;
      }
    }
    walkForPieces(paragraphForPieces);
    return piecesForPieces;
  }

  function piecesTextForDocxEdit(piecesForText) {
    return piecesForText.map(function (pieceForText) { return pieceForText.text; }).join('');
  }

  function paragraphTextForDocxEdit(paragraphForText) {
    return piecesTextForDocxEdit(collectPiecesForDocxEdit(paragraphForText));
  }

  function pieceIndexAtForDocxEdit(piecesForIndex, positionForIndex) {
    for (var iForIndex = 0; iForIndex < piecesForIndex.length; iForIndex++) {
      var pieceForIndex = piecesForIndex[iForIndex];
      if (positionForIndex >= pieceForIndex.start && positionForIndex < pieceForIndex.start + pieceForIndex.text.length) return iForIndex;
    }
    return -1;
  }

  function uniqueRunsForDocxEdit(piecesForRuns) {
    var runsForRuns = [];
    piecesForRuns.forEach(function (pieceForRuns) {
      if (runsForRuns.indexOf(pieceForRuns.run) < 0) runsForRuns.push(pieceForRuns.run);
    });
    return runsForRuns;
  }

  // Every run below a node that a deletion should cover: not one already deleted, and not the
  // content of a drawing or text box.
  function collectRunsForDocxEdit(nodeForRuns) {
    var runsForCollect = [];
    walkElementsForDocxEdit(nodeForRuns, function (elementForRuns) {
      var localForRuns = localNameForDocxEdit(elementForRuns.name);
      if (RUN_WALK_STOPS_FOR_DOCX_EDIT[localForRuns]) return false;
      if (localForRuns === 'r') {
        runsForCollect.push(elementForRuns);
        return false;
      }
      return true;
    });
    return runsForCollect;
  }

  function hasImageForDocxEdit(paragraphForImage) {
    var foundForImage = false;
    walkElementsForDocxEdit(paragraphForImage, function (elementForImage) {
      var localForImage = localNameForDocxEdit(elementForImage.name);
      if (localForImage === 'drawing' || localForImage === 'pict') {
        foundForImage = true;
        return false;
      }
      return !foundForImage;
    });
    return foundForImage;
  }

  // A clean copy of a run's properties for new text: the run's own revision record is dropped.
  function cleanRunPropsCloneForDocxEdit(rPrForClean) {
    var copyForClean = cloneNodeForDocxEdit(rPrForClean);
    removeChildElementsForDocxEdit(copyForClean, ['rPrChange', 'ins', 'del', 'moveFrom', 'moveTo']);
    return copyForClean;
  }

  // A clean copy of a paragraph's properties for a new paragraph. A section break is never copied,
  // or the new paragraph would end a section.
  function cleanParagraphPropsCloneForDocxEdit(pPrForClean) {
    var copyForClean = cloneNodeForDocxEdit(pPrForClean);
    removeChildElementsForDocxEdit(copyForClean, ['sectPr', 'pPrChange']);
    var markRPrForClean = firstChildElForDocxEdit(copyForClean, 'rPr');
    if (markRPrForClean) removeChildElementsForDocxEdit(markRPrForClean, ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);
    return copyForClean;
  }

  // The formatting new text in this paragraph should take: the properties of the run holding the
  // most text, so a bold lead-in ("Note:") does not make a whole rewritten paragraph bold.
  function dominantRunPropsForDocxEdit(paragraphForDominant) {
    var weightsForDominant = [];
    collectPiecesForDocxEdit(paragraphForDominant).forEach(function (pieceForDominant) {
      if (pieceForDominant.kind !== 't') return;
      var weightForDominant = pieceForDominant.text.replace(/\s+/g, '').length;
      for (var iForDominant = 0; iForDominant < weightsForDominant.length; iForDominant++) {
        if (weightsForDominant[iForDominant].run === pieceForDominant.run) {
          weightsForDominant[iForDominant].weight += weightForDominant;
          return;
        }
      }
      weightsForDominant.push({ run: pieceForDominant.run, weight: weightForDominant });
    });
    var bestForDominant = null;
    weightsForDominant.forEach(function (entryForDominant) {
      if (!bestForDominant || entryForDominant.weight > bestForDominant.weight) bestForDominant = entryForDominant;
    });
    var runForDominant = bestForDominant ? bestForDominant.run : null;
    if (!runForDominant) {
      var runsForDominant = collectRunsForDocxEdit(paragraphForDominant);
      runForDominant = runsForDominant.length ? runsForDominant[0] : null;
    }
    var rPrForDominant = runForDominant ? firstChildElForDocxEdit(runForDominant, 'rPr') : null;
    return rPrForDominant ? cleanRunPropsCloneForDocxEdit(rPrForDominant) : null;
  }

  // Run content for a string: text, with "\n" as a line break and "\t" as a tab.
  function makeRunContentForDocxEdit(prefixForContent, textForContent) {
    var nodesForContent = [];
    String(textForContent == null ? '' : textForContent).split(/(\r\n|\n|\r|\t)/).forEach(function (partForContent) {
      if (!partForContent) return;
      if (partForContent === '\t') {
        nodesForContent.push(makeElForDocxEdit(prefixForContent + 'tab'));
      } else if (partForContent === '\n' || partForContent === '\r\n' || partForContent === '\r') {
        nodesForContent.push(makeElForDocxEdit(prefixForContent + 'br'));
      } else {
        nodesForContent.push(makeElForDocxEdit(prefixForContent + 't', [['xml:space', 'preserve']], [makeTextNodeForDocxEdit(partForContent)]));
      }
    });
    return nodesForContent;
  }

  function makeRunForDocxEdit(prefixForRun, rPrForRun, textForRun) {
    var runForRun = makeElForDocxEdit(prefixForRun + 'r');
    if (rPrForRun) appendChildForDocxEdit(runForRun, cloneNodeForDocxEdit(rPrForRun));
    makeRunContentForDocxEdit(prefixForRun, textForRun).forEach(function (nodeForRun) { appendChildForDocxEdit(runForRun, nodeForRun); });
    return runForRun;
  }

  // ---- Ordered property children ----

  function insertOrderedForDocxEdit(parentForOrdered, elementForOrdered, orderForOrdered) {
    var rankForOrdered = orderForOrdered.indexOf(localNameForDocxEdit(elementForOrdered.name));
    var childrenForOrdered = parentForOrdered.children;
    for (var iForOrdered = 0; iForOrdered < childrenForOrdered.length; iForOrdered++) {
      var childForOrdered = childrenForOrdered[iForOrdered];
      if (childForOrdered.type !== 'el') continue;
      if (orderForOrdered.indexOf(localNameForDocxEdit(childForOrdered.name)) > rankForOrdered) {
        insertBeforeForDocxEdit(childForOrdered, elementForOrdered);
        return elementForOrdered;
      }
    }
    appendChildForDocxEdit(parentForOrdered, elementForOrdered);
    return elementForOrdered;
  }

  function replaceOrderedForDocxEdit(parentForReplace, elementForReplace, orderForReplace) {
    removeChildElementsForDocxEdit(parentForReplace, [localNameForDocxEdit(elementForReplace.name)]);
    return insertOrderedForDocxEdit(parentForReplace, elementForReplace, orderForReplace);
  }

  function ensurePPrForDocxEdit(paragraphForPPr, prefixForPPr) {
    var pPrForEnsure = firstChildElForDocxEdit(paragraphForPPr, 'pPr');
    if (pPrForEnsure) return pPrForEnsure;
    return insertAtForDocxEdit(paragraphForPPr, 0, makeElForDocxEdit(prefixForPPr + 'pPr'));
  }

  function ensureRPrForDocxEdit(runForRPr, prefixForRPr) {
    var rPrForEnsure = firstChildElForDocxEdit(runForRPr, 'rPr');
    if (rPrForEnsure) return rPrForEnsure;
    return insertAtForDocxEdit(runForRPr, 0, makeElForDocxEdit(prefixForRPr + 'rPr'));
  }

  // ---- Revisions ----

  function revisionAttrsForDocxEdit(ctxForRevision) {
    var prefixForRevision = ctxForRevision.prefix;
    return [
      [prefixForRevision + 'id', String(ctxForRevision.nextId++)],
      [prefixForRevision + 'author', ctxForRevision.author],
      [prefixForRevision + 'date', ctxForRevision.date]
    ];
  }

  function maxRevisionIdForDocxEdit(partsForMax) {
    var maxForRevision = 0;
    Object.keys(partsForMax).forEach(function (pathForMax) {
      var reForMax = /\bw:id="(\d+)"/g;
      var matchForMax;
      var textForMax = String(partsForMax[pathForMax] || '');
      while ((matchForMax = reForMax.exec(textForMax)) !== null) {
        var valueForMax = Number(matchForMax[1]);
        if (valueForMax > maxForRevision && valueForMax < 2147483000) maxForRevision = valueForMax;
      }
    });
    return maxForRevision;
  }

  function wrapRunInDelForDocxEdit(runForDel, ctxForDel) {
    walkElementsForDocxEdit(runForDel, function (elementForDel) {
      var localForDel = localNameForDocxEdit(elementForDel.name);
      if (localForDel === 't') renameElementForDocxEdit(elementForDel, 'delText');
      else if (localForDel === 'instrText') renameElementForDocxEdit(elementForDel, 'delInstrText');
      return localForDel !== 'drawing' && localForDel !== 'pict';
    });
    var wrapperForDel = makeElForDocxEdit(ctxForDel.prefix + 'del', revisionAttrsForDocxEdit(ctxForDel));
    insertBeforeForDocxEdit(runForDel, wrapperForDel);
    appendChildForDocxEdit(wrapperForDel, runForDel);
    return wrapperForDel;
  }

  // Marks a paragraph's own mark (its pilcrow) as inserted or deleted, which is what makes Word
  // show the whole paragraph as added or removed.
  function markParagraphMarkForDocxEdit(paragraphForMark, kindForMark, ctxForMark) {
    var pPrForMark = ensurePPrForDocxEdit(paragraphForMark, ctxForMark.prefix);
    var rPrForMark = firstChildElForDocxEdit(pPrForMark, 'rPr')
      || insertOrderedForDocxEdit(pPrForMark, makeElForDocxEdit(ctxForMark.prefix + 'rPr'), PPR_ORDER_FOR_DOCX_EDIT);
    if (firstChildElForDocxEdit(rPrForMark, kindForMark)) return;
    insertOrderedForDocxEdit(rPrForMark, makeElForDocxEdit(ctxForMark.prefix + kindForMark, revisionAttrsForDocxEdit(ctxForMark)), RPR_ORDER_FOR_DOCX_EDIT);
  }

  function markRowForDocxEdit(rowForMark, kindForMark, ctxForMark) {
    var trPrForMark = firstChildElForDocxEdit(rowForMark, 'trPr');
    if (!trPrForMark) {
      var tblPrExForMark = firstChildElForDocxEdit(rowForMark, 'tblPrEx');
      trPrForMark = makeElForDocxEdit(ctxForMark.prefix + 'trPr');
      if (tblPrExForMark) insertAfterForDocxEdit(tblPrExForMark, trPrForMark);
      else insertAtForDocxEdit(rowForMark, 0, trPrForMark);
    }
    if (firstChildElForDocxEdit(trPrForMark, kindForMark)) return;
    insertOrderedForDocxEdit(trPrForMark, makeElForDocxEdit(ctxForMark.prefix + kindForMark, revisionAttrsForDocxEdit(ctxForMark)), TRPR_ORDER_FOR_DOCX_EDIT);
  }

  function deleteRunsBelowForDocxEdit(nodeForDeleteRuns, ctxForDeleteRuns) {
    collectRunsForDocxEdit(nodeForDeleteRuns).forEach(function (runForDeleteRuns) {
      wrapRunInDelForDocxEdit(runForDeleteRuns, ctxForDeleteRuns);
    });
  }

  // ---- Run splitting ----

  // Splits a run so that a new run starts at (child, offset), where child is one of the run's
  // own content children. Returns the run that now starts there, or null when the position is
  // already the end of the run.
  function splitRunAtForDocxEdit(runForSplit, childForSplit, offsetForSplit) {
    var contentForSplit = runForSplit.children.filter(function (nodeForFilter) { return !isElForDocxEdit(nodeForFilter, 'rPr'); });
    var indexForSplit = contentForSplit.indexOf(childForSplit);
    if (indexForSplit < 0) return null;
    var isTextForSplit = isElForDocxEdit(childForSplit, 't');
    var textForSplit = isTextForSplit ? textContentForDocxEdit(childForSplit) : '';
    var lengthForSplit = isTextForSplit ? textForSplit.length : 1;
    var leftForSplit;
    var rightForSplit;
    if (offsetForSplit <= 0) {
      leftForSplit = contentForSplit.slice(0, indexForSplit);
      rightForSplit = contentForSplit.slice(indexForSplit);
    } else if (offsetForSplit >= lengthForSplit) {
      leftForSplit = contentForSplit.slice(0, indexForSplit + 1);
      rightForSplit = contentForSplit.slice(indexForSplit + 1);
    } else {
      var leftTextForSplit = cloneNodeForDocxEdit(childForSplit);
      setTextContentForDocxEdit(leftTextForSplit, textForSplit.slice(0, offsetForSplit));
      var rightTextForSplit = cloneNodeForDocxEdit(childForSplit);
      setTextContentForDocxEdit(rightTextForSplit, textForSplit.slice(offsetForSplit));
      leftForSplit = contentForSplit.slice(0, indexForSplit).concat([leftTextForSplit]);
      rightForSplit = [rightTextForSplit].concat(contentForSplit.slice(indexForSplit + 1));
    }
    var hasElementForSplit = function (listForHas) { return listForHas.some(function (nodeForHas) { return nodeForHas.type === 'el'; }); };
    if (!hasElementForSplit(rightForSplit)) return null;
    if (!hasElementForSplit(leftForSplit)) return runForSplit;
    var rPrForSplit = firstChildElForDocxEdit(runForSplit, 'rPr');
    runForSplit.children.forEach(function (nodeForReset) { nodeForReset.parent = null; });
    runForSplit.children = [];
    if (rPrForSplit) appendChildForDocxEdit(runForSplit, rPrForSplit);
    leftForSplit.forEach(function (nodeForLeft) { appendChildForDocxEdit(runForSplit, nodeForLeft); });
    var newRunForSplit = cloneNodeForDocxEdit({
      type: 'el', name: runForSplit.name, attrsRaw: runForSplit.attrsRaw, attrs: runForSplit.attrs,
      rawOpen: runForSplit.rawOpen, rawClose: runForSplit.rawClose, selfClosing: false, dirty: runForSplit.dirty, children: []
    });
    if (rPrForSplit) appendChildForDocxEdit(newRunForSplit, cloneNodeForDocxEdit(rPrForSplit));
    rightForSplit.forEach(function (nodeForRight) { appendChildForDocxEdit(newRunForSplit, nodeForRight); });
    insertAfterForDocxEdit(runForSplit, newRunForSplit);
    return newRunForSplit;
  }

  // Makes a character position of the paragraph's text a run boundary.
  function splitParagraphAtForDocxEdit(paragraphForSplitAt, positionForSplitAt) {
    var piecesForSplitAt = collectPiecesForDocxEdit(paragraphForSplitAt);
    if (!piecesForSplitAt.length) return;
    var indexForSplitAt = pieceIndexAtForDocxEdit(piecesForSplitAt, positionForSplitAt);
    if (indexForSplitAt < 0) {
      var lastForSplitAt = piecesForSplitAt[piecesForSplitAt.length - 1];
      splitRunAtForDocxEdit(lastForSplitAt.run, lastForSplitAt.node, lastForSplitAt.text.length);
      return;
    }
    var pieceForSplitAt = piecesForSplitAt[indexForSplitAt];
    splitRunAtForDocxEdit(pieceForSplitAt.run, pieceForSplitAt.node, positionForSplitAt - pieceForSplitAt.start);
  }

  // The runs that hold exactly the characters [start, end) of the paragraph, after splitting.
  function isolateRangeForDocxEdit(paragraphForIsolate, startForIsolate, endForIsolate) {
    splitParagraphAtForDocxEdit(paragraphForIsolate, endForIsolate);
    splitParagraphAtForDocxEdit(paragraphForIsolate, startForIsolate);
    var runsForIsolate = [];
    collectPiecesForDocxEdit(paragraphForIsolate).forEach(function (pieceForIsolate) {
      if (pieceForIsolate.start >= startForIsolate && pieceForIsolate.start < endForIsolate && runsForIsolate.indexOf(pieceForIsolate.run) < 0) {
        runsForIsolate.push(pieceForIsolate.run);
      }
    });
    return runsForIsolate;
  }

  // ---- Text replacement ----

  function setPieceTextForDocxEdit(pieceForSet, textForSet, prefixForSet) {
    if (!textForSet) {
      detachForDocxEdit(pieceForSet.node);
      return;
    }
    if (/[\t\n\r]/.test(textForSet)) {
      replaceNodeForDocxEdit(pieceForSet.node, makeRunContentForDocxEdit(prefixForSet, textForSet));
      return;
    }
    setTextContentForDocxEdit(pieceForSet.node, textForSet);
  }

  function insertTextBeforeForDocxEdit(nodeForInsertText, textForInsertText, prefixForInsertText) {
    makeRunContentForDocxEdit(prefixForInsertText, textForInsertText).forEach(function (newForInsertText) {
      insertBeforeForDocxEdit(nodeForInsertText, newForInsertText);
    });
  }

  // Replaces characters [start, end) by editing text nodes in place. The new text takes the
  // formatting of the run where the match starts; runs, links and fields keep their structure.
  function replaceRangeInPlaceForDocxEdit(paragraphForRange, startForRange, endForRange, replacementForRange, ctxForRange) {
    var piecesForRange = collectPiecesForDocxEdit(paragraphForRange);
    var startIndexForRange = pieceIndexAtForDocxEdit(piecesForRange, startForRange);
    var endIndexForRange = pieceIndexAtForDocxEdit(piecesForRange, endForRange - 1);
    if (startIndexForRange < 0 || endIndexForRange < 0) return;
    var startPieceForRange = piecesForRange[startIndexForRange];
    var endPieceForRange = piecesForRange[endIndexForRange];
    var startOffsetForRange = startForRange - startPieceForRange.start;
    var endOffsetForRange = endForRange - endPieceForRange.start;
    for (var middleForRange = endIndexForRange - 1; middleForRange > startIndexForRange; middleForRange--) {
      detachForDocxEdit(piecesForRange[middleForRange].node);
    }
    if (startIndexForRange === endIndexForRange) {
      if (startPieceForRange.kind === 't') {
        setPieceTextForDocxEdit(startPieceForRange,
          startPieceForRange.text.slice(0, startOffsetForRange) + replacementForRange + startPieceForRange.text.slice(endOffsetForRange),
          ctxForRange.prefix);
      } else {
        insertTextBeforeForDocxEdit(startPieceForRange.node, replacementForRange, ctxForRange.prefix);
        detachForDocxEdit(startPieceForRange.node);
      }
      return;
    }
    if (endPieceForRange.kind === 't') {
      setPieceTextForDocxEdit(endPieceForRange, endPieceForRange.text.slice(endOffsetForRange), ctxForRange.prefix);
    } else {
      detachForDocxEdit(endPieceForRange.node);
    }
    if (startPieceForRange.kind === 't') {
      setPieceTextForDocxEdit(startPieceForRange, startPieceForRange.text.slice(0, startOffsetForRange) + replacementForRange, ctxForRange.prefix);
    } else {
      insertTextBeforeForDocxEdit(startPieceForRange.node, replacementForRange, ctxForRange.prefix);
      detachForDocxEdit(startPieceForRange.node);
    }
  }

  // The tracked form: the matched runs are marked deleted, and the replacement is inserted after
  // the last of them as a new run with the formatting of the first matched run.
  function replaceRangeTrackedForDocxEdit(paragraphForTracked, startForTracked, endForTracked, replacementForTracked, ctxForTracked) {
    if (startForTracked === endForTracked) {
      insertTrackedAtForDocxEdit(paragraphForTracked, startForTracked, replacementForTracked, ctxForTracked);
      return;
    }
    var runsForTracked = isolateRangeForDocxEdit(paragraphForTracked, startForTracked, endForTracked);
    if (!runsForTracked.length) return;
    var rPrForTracked = firstChildElForDocxEdit(runsForTracked[0], 'rPr');
    var baseRPrForTracked = rPrForTracked ? cleanRunPropsCloneForDocxEdit(rPrForTracked) : null;
    var lastDelForTracked = null;
    runsForTracked.forEach(function (runForTracked) {
      lastDelForTracked = wrapRunInDelForDocxEdit(runForTracked, ctxForTracked);
    });
    if (replacementForTracked) {
      var insForTracked = makeElForDocxEdit(ctxForTracked.prefix + 'ins', revisionAttrsForDocxEdit(ctxForTracked),
        [makeRunForDocxEdit(ctxForTracked.prefix, baseRPrForTracked, replacementForTracked)]);
      insertAfterForDocxEdit(liftOutOfRevisionForDocxEdit(lastDelForTracked), insForTracked);
    }
  }

  // A new w:ins goes beside an existing revision wrapper, never inside one.
  function liftOutOfRevisionForDocxEdit(nodeForLift) {
    var currentForLift = nodeForLift;
    while (currentForLift.parent && ['ins', 'del', 'moveTo', 'moveFrom'].indexOf(localNameForDocxEdit(currentForLift.parent.name || '')) >= 0) {
      currentForLift = currentForLift.parent;
    }
    return currentForLift;
  }

  function linkAncestorForDocxEdit(nodeForLink, paragraphForLink) {
    var currentForLink = nodeForLink.parent;
    while (currentForLink && currentForLink !== paragraphForLink) {
      if (isElForDocxEdit(currentForLink, 'hyperlink')) return currentForLink;
      currentForLink = currentForLink.parent;
    }
    return null;
  }

  function runPropsOfForDocxEdit(runForProps) {
    var rPrForProps = runForProps ? firstChildElForDocxEdit(runForProps, 'rPr') : null;
    return rPrForProps ? cleanRunPropsCloneForDocxEdit(rPrForProps) : null;
  }

  // Where text inserted at a position goes: after the text before it, like typing in Word, with
  // one exception. At the end of a link the new text goes after the link, not into it.
  function insertionSidesForDocxEdit(paragraphForSides, positionForSides) {
    var piecesForSides = collectPiecesForDocxEdit(paragraphForSides);
    var leftIndexForSides = positionForSides > 0 ? pieceIndexAtForDocxEdit(piecesForSides, positionForSides - 1) : -1;
    var rightIndexForSides = pieceIndexAtForDocxEdit(piecesForSides, positionForSides);
    var leftForSides = leftIndexForSides >= 0 ? piecesForSides[leftIndexForSides] : null;
    var rightForSides = rightIndexForSides >= 0 ? piecesForSides[rightIndexForSides] : null;
    var leftLinkForSides = leftForSides ? linkAncestorForDocxEdit(leftForSides.run, paragraphForSides) : null;
    var leavesLinkForSides = !!leftLinkForSides
      && (!rightForSides || linkAncestorForDocxEdit(rightForSides.run, paragraphForSides) !== leftLinkForSides);
    return { pieces: piecesForSides, left: leavesLinkForSides ? null : leftForSides, right: rightForSides, link: leavesLinkForSides ? leftLinkForSides : null };
  }

  function insertTextAfterForDocxEdit(nodeForAfterText, textForAfterText, prefixForAfterText) {
    var referenceForAfterText = nodeForAfterText;
    makeRunContentForDocxEdit(prefixForAfterText, textForAfterText).forEach(function (newForAfterText) {
      insertAfterForDocxEdit(referenceForAfterText, newForAfterText);
      referenceForAfterText = newForAfterText;
    });
  }

  function insertInPlaceAtForDocxEdit(paragraphForAt, positionForAt, textForAt, ctxForAt) {
    if (!textForAt) return;
    var sidesForAt = insertionSidesForDocxEdit(paragraphForAt, positionForAt);
    if (!sidesForAt.pieces.length) {
      appendChildForDocxEdit(paragraphForAt, makeRunForDocxEdit(ctxForAt.prefix, dominantRunPropsForDocxEdit(paragraphForAt), textForAt));
      return;
    }
    if (sidesForAt.left) {
      var leftForAt = sidesForAt.left;
      if (leftForAt.kind === 't') {
        var offsetForAt = positionForAt - leftForAt.start;
        setPieceTextForDocxEdit(leftForAt, leftForAt.text.slice(0, offsetForAt) + textForAt + leftForAt.text.slice(offsetForAt), ctxForAt.prefix);
      } else {
        insertTextAfterForDocxEdit(leftForAt.node, textForAt, ctxForAt.prefix);
      }
      return;
    }
    if (sidesForAt.right) {
      if (sidesForAt.right.kind === 't') setPieceTextForDocxEdit(sidesForAt.right, textForAt + sidesForAt.right.text, ctxForAt.prefix);
      else insertTextBeforeForDocxEdit(sidesForAt.right.node, textForAt, ctxForAt.prefix);
      return;
    }
    insertAfterForDocxEdit(sidesForAt.link, makeRunForDocxEdit(ctxForAt.prefix, dominantRunPropsForDocxEdit(paragraphForAt), textForAt));
  }

  function insertTrackedAtForDocxEdit(paragraphForAt, positionForAt, textForAt, ctxForAt) {
    if (!textForAt) return;
    splitParagraphAtForDocxEdit(paragraphForAt, positionForAt);
    var sidesForAt = insertionSidesForDocxEdit(paragraphForAt, positionForAt);
    var runForAt = sidesForAt.left ? sidesForAt.left.run : (sidesForAt.right ? sidesForAt.right.run : null);
    var rPrForAt = runForAt ? runPropsOfForDocxEdit(runForAt) : dominantRunPropsForDocxEdit(paragraphForAt);
    var insForAt = makeElForDocxEdit(ctxForAt.prefix + 'ins', revisionAttrsForDocxEdit(ctxForAt), [makeRunForDocxEdit(ctxForAt.prefix, rPrForAt, textForAt)]);
    if (!sidesForAt.pieces.length) appendChildForDocxEdit(paragraphForAt, insForAt);
    else if (sidesForAt.left) insertAfterForDocxEdit(liftOutOfRevisionForDocxEdit(sidesForAt.left.run), insForAt);
    else if (sidesForAt.right) insertBeforeForDocxEdit(liftOutOfRevisionForDocxEdit(sidesForAt.right.run), insForAt);
    else insertAfterForDocxEdit(sidesForAt.link, insForAt);
  }

  function replaceRangeForDocxEdit(paragraphForRange, startForRange, endForRange, textForRange, ctxForRange) {
    if (ctxForRange.track) {
      replaceRangeTrackedForDocxEdit(paragraphForRange, startForRange, endForRange, textForRange, ctxForRange);
    } else if (startForRange === endForRange) {
      insertInPlaceAtForDocxEdit(paragraphForRange, startForRange, textForRange, ctxForRange);
    } else {
      replaceRangeInPlaceForDocxEdit(paragraphForRange, startForRange, endForRange, textForRange, ctxForRange);
    }
  }

  // ---- Word diff ----

  // Words, runs of spaces, and single punctuation marks, so "2025." changes as "2025" and keeps
  // its full stop.
  var DIFF_TOKEN_RE_FOR_DOCX_EDIT = /\s+|[^\s.,;:!?()"'\[\]{}]+|[.,;:!?()"'\[\]{}]/g;
  var MAX_DIFF_CELLS_FOR_DOCX_EDIT = 250000;

  function tokenizeForDocxEdit(textForTokens) {
    return String(textForTokens == null ? '' : textForTokens).match(DIFF_TOKEN_RE_FOR_DOCX_EDIT) || [];
  }

  // The changes that turn oldText into newText, as ranges of oldText with their new text, found
  // word by word. Untouched words keep their own run, so a rewrite keeps the bold or italic of
  // every word it did not change, and a tracked rewrite marks only what changed.
  function diffHunksForDocxEdit(oldTextForDiff, newTextForDiff) {
    if (oldTextForDiff === newTextForDiff) return [];
    var oldTokensForDiff = tokenizeForDocxEdit(oldTextForDiff);
    var newTokensForDiff = tokenizeForDocxEdit(newTextForDiff);
    var prefixForDiff = 0;
    while (prefixForDiff < oldTokensForDiff.length && prefixForDiff < newTokensForDiff.length
      && oldTokensForDiff[prefixForDiff] === newTokensForDiff[prefixForDiff]) prefixForDiff++;
    var suffixForDiff = 0;
    while (suffixForDiff < oldTokensForDiff.length - prefixForDiff && suffixForDiff < newTokensForDiff.length - prefixForDiff
      && oldTokensForDiff[oldTokensForDiff.length - 1 - suffixForDiff] === newTokensForDiff[newTokensForDiff.length - 1 - suffixForDiff]) suffixForDiff++;
    var oldMiddleForDiff = oldTokensForDiff.slice(prefixForDiff, oldTokensForDiff.length - suffixForDiff);
    var newMiddleForDiff = newTokensForDiff.slice(prefixForDiff, newTokensForDiff.length - suffixForDiff);
    var opsForDiff = [];
    var rowsForDiff = oldMiddleForDiff.length;
    var colsForDiff = newMiddleForDiff.length;
    if (!rowsForDiff || !colsForDiff || rowsForDiff * colsForDiff > MAX_DIFF_CELLS_FOR_DOCX_EDIT) {
      oldMiddleForDiff.forEach(function () { opsForDiff.push('d'); });
      newMiddleForDiff.forEach(function () { opsForDiff.push('i'); });
    } else {
      var widthForDiff = colsForDiff + 1;
      var tableForDiff = new Int32Array((rowsForDiff + 1) * widthForDiff);
      for (var rowForDiff = rowsForDiff - 1; rowForDiff >= 0; rowForDiff--) {
        for (var colForDiff = colsForDiff - 1; colForDiff >= 0; colForDiff--) {
          tableForDiff[rowForDiff * widthForDiff + colForDiff] = oldMiddleForDiff[rowForDiff] === newMiddleForDiff[colForDiff]
            ? tableForDiff[(rowForDiff + 1) * widthForDiff + colForDiff + 1] + 1
            : Math.max(tableForDiff[(rowForDiff + 1) * widthForDiff + colForDiff], tableForDiff[rowForDiff * widthForDiff + colForDiff + 1]);
        }
      }
      var iForDiff = 0;
      var jForDiff = 0;
      while (iForDiff < rowsForDiff && jForDiff < colsForDiff) {
        if (oldMiddleForDiff[iForDiff] === newMiddleForDiff[jForDiff]) {
          opsForDiff.push('e'); iForDiff++; jForDiff++;
        } else if (tableForDiff[(iForDiff + 1) * widthForDiff + jForDiff] >= tableForDiff[iForDiff * widthForDiff + jForDiff + 1]) {
          opsForDiff.push('d'); iForDiff++;
        } else {
          opsForDiff.push('i'); jForDiff++;
        }
      }
      while (iForDiff < rowsForDiff) { opsForDiff.push('d'); iForDiff++; }
      while (jForDiff < colsForDiff) { opsForDiff.push('i'); jForDiff++; }
    }
    var hunksForDiff = [];
    var oldPositionForDiff = oldTokensForDiff.slice(0, prefixForDiff).join('').length;
    var oldIndexForDiff = prefixForDiff;
    var newIndexForDiff = prefixForDiff;
    var currentForDiff = null;
    opsForDiff.forEach(function (opForDiff) {
      if (opForDiff === 'e') {
        if (currentForDiff) { hunksForDiff.push(currentForDiff); currentForDiff = null; }
        oldPositionForDiff += oldTokensForDiff[oldIndexForDiff].length;
        oldIndexForDiff++;
        newIndexForDiff++;
        return;
      }
      if (!currentForDiff) currentForDiff = { start: oldPositionForDiff, end: oldPositionForDiff, text: '' };
      if (opForDiff === 'd') {
        currentForDiff.end += oldTokensForDiff[oldIndexForDiff].length;
        oldPositionForDiff += oldTokensForDiff[oldIndexForDiff].length;
        oldIndexForDiff++;
      } else {
        currentForDiff.text += newTokensForDiff[newIndexForDiff];
        newIndexForDiff++;
      }
    });
    if (currentForDiff) hunksForDiff.push(currentForDiff);
    // Two changes split by one unchanged space read as one ("March 2025" to "April 2026").
    var mergedForDiff = [];
    hunksForDiff.forEach(function (hunkForMerge) {
      var previousForMerge = mergedForDiff[mergedForDiff.length - 1];
      if (previousForMerge) {
        var gapForMerge = oldTextForDiff.slice(previousForMerge.end, hunkForMerge.start);
        if (/^\s$/.test(gapForMerge) || gapForMerge === '') {
          previousForMerge.text += gapForMerge + hunkForMerge.text;
          previousForMerge.end = hunkForMerge.end;
          return;
        }
      }
      mergedForDiff.push({ start: hunkForMerge.start, end: hunkForMerge.end, text: hunkForMerge.text });
    });
    return mergedForDiff;
  }

  // Changes characters [start, end) of the paragraph to newText, touching only the words that
  // differ. Returns the number of changed spans.
  function applyTextChangeForDocxEdit(paragraphForChange, startForChange, endForChange, newTextForChange, ctxForChange) {
    var oldTextForChange = paragraphTextForDocxEdit(paragraphForChange).slice(startForChange, endForChange);
    var hunksForChange = diffHunksForDocxEdit(oldTextForChange, newTextForChange);
    for (var kForChange = hunksForChange.length - 1; kForChange >= 0; kForChange--) {
      replaceRangeForDocxEdit(paragraphForChange, startForChange + hunksForChange[kForChange].start,
        startForChange + hunksForChange[kForChange].end, hunksForChange[kForChange].text, ctxForChange);
    }
    return hunksForChange.length;
  }

  function findPositionsForDocxEdit(textForFind, needleForFind, firstOnlyForFind) {
    var positionsForFind = [];
    var fromForFind = 0;
    while (fromForFind <= textForFind.length) {
      var atForFind = textForFind.indexOf(needleForFind, fromForFind);
      if (atForFind < 0) break;
      positionsForFind.push(atForFind);
      if (firstOnlyForFind) break;
      fromForFind = atForFind + needleForFind.length;
    }
    return positionsForFind;
  }

  // Replaces a paragraph's text. Images, footnote and comment references, bookmarks and fields
  // stay; only text is removed, and the new run goes where the first text was, directly in the
  // paragraph (so it does not land inside a hyperlink that held the old first word).
  function replaceParagraphTextForDocxEdit(paragraphForReplace, textForReplace, ctxForReplace) {
    var prefixForReplace = ctxForReplace.prefix;
    var oldTextForReplace = paragraphTextForDocxEdit(paragraphForReplace);
    if (oldTextForReplace && textForReplace) {
      var hunksForReplace = diffHunksForDocxEdit(oldTextForReplace, textForReplace);
      var keptForReplace = '';
      var cursorForReplace = 0;
      hunksForReplace.forEach(function (hunkForKept) {
        keptForReplace += oldTextForReplace.slice(cursorForReplace, hunkForKept.start);
        cursorForReplace = hunkForKept.end;
      });
      keptForReplace += oldTextForReplace.slice(cursorForReplace);
      if (/\S/.test(keptForReplace)) {
        applyTextChangeForDocxEdit(paragraphForReplace, 0, oldTextForReplace.length, textForReplace, ctxForReplace);
        return;
      }
    }
    var piecesForReplace = collectPiecesForDocxEdit(paragraphForReplace);
    var baseRPrForReplace = dominantRunPropsForDocxEdit(paragraphForReplace);
    var placeholderForReplace = { type: 'raw', raw: '', parent: null };
    if (piecesForReplace.length && ctxForReplace.track) {
      insertAfterForDocxEdit(topLevelChildForDocxEdit(paragraphForReplace, piecesForReplace[piecesForReplace.length - 1].node), placeholderForReplace);
    } else if (piecesForReplace.length) {
      insertBeforeForDocxEdit(topLevelChildForDocxEdit(paragraphForReplace, piecesForReplace[0].node), placeholderForReplace);
    } else {
      var pPrForReplace = firstChildElForDocxEdit(paragraphForReplace, 'pPr');
      if (pPrForReplace) insertAfterForDocxEdit(pPrForReplace, placeholderForReplace);
      else insertAtForDocxEdit(paragraphForReplace, 0, placeholderForReplace);
    }
    var newNodesForReplace = [];
    if (ctxForReplace.track) {
      uniqueRunsForDocxEdit(piecesForReplace).forEach(function (runForReplace) { wrapRunInDelForDocxEdit(runForReplace, ctxForReplace); });
      if (textForReplace) {
        newNodesForReplace.push(makeElForDocxEdit(prefixForReplace + 'ins', revisionAttrsForDocxEdit(ctxForReplace),
          [makeRunForDocxEdit(prefixForReplace, baseRPrForReplace, textForReplace)]));
      }
    } else {
      var touchedForReplace = uniqueRunsForDocxEdit(piecesForReplace);
      piecesForReplace.forEach(function (pieceForReplace) { detachForDocxEdit(pieceForReplace.node); });
      touchedForReplace.forEach(function (runForPrune) { pruneEmptyForDocxEdit(runForPrune, paragraphForReplace); });
      if (textForReplace) newNodesForReplace.push(makeRunForDocxEdit(prefixForReplace, baseRPrForReplace, textForReplace));
    }
    replaceNodeForDocxEdit(placeholderForReplace, newNodesForReplace);
  }

  // Drops a run (and then its link or other wrapper) that an edit has left holding nothing.
  function pruneEmptyForDocxEdit(nodeForPrune, stopForPrune) {
    var currentForPrune = nodeForPrune;
    while (currentForPrune && currentForPrune !== stopForPrune && currentForPrune.parent) {
      if (!PRUNABLE_CONTAINERS_FOR_DOCX_EDIT[localNameForDocxEdit(currentForPrune.name)]) return;
      var meaningfulForPrune = currentForPrune.children.some(function (childForPrune) {
        return childForPrune.type === 'el' && !isElForDocxEdit(childForPrune, 'rPr');
      });
      if (meaningfulForPrune) return;
      var parentForPrune = currentForPrune.parent;
      detachForDocxEdit(currentForPrune);
      currentForPrune = parentForPrune;
    }
  }

  // Removes everything in a paragraph except its properties and the zero-width range markers.
  function clearParagraphForDocxEdit(paragraphForClear, ctxForClear) {
    if (ctxForClear.track) {
      deleteRunsBelowForDocxEdit(paragraphForClear, ctxForClear);
      return;
    }
    childElementsForDocxEdit(paragraphForClear).forEach(function (childForClear) {
      var localForClear = localNameForDocxEdit(childForClear.name);
      if (localForClear === 'pPr' || RANGE_MARKERS_FOR_DOCX_EDIT[localForClear]) return;
      detachForDocxEdit(childForClear);
    });
  }

  // Bookmarks and comment ranges can start in one paragraph and end in another, so the markers of
  // a removed paragraph move to its neighbour instead of leaving the other half orphaned.
  function rehomeRangeMarkersForDocxEdit(paragraphForRehome) {
    var markersForRehome = childElementsForDocxEdit(paragraphForRehome).filter(function (childForRehome) {
      return RANGE_MARKERS_FOR_DOCX_EDIT[localNameForDocxEdit(childForRehome.name)];
    });
    if (!markersForRehome.length) return;
    var siblingsForRehome = paragraphForRehome.parent ? childElementsForDocxEdit(paragraphForRehome.parent, 'p') : [];
    var indexForRehome = siblingsForRehome.indexOf(paragraphForRehome);
    var nextForRehome = siblingsForRehome[indexForRehome + 1];
    var previousForRehome = siblingsForRehome[indexForRehome - 1];
    if (nextForRehome) {
      var anchorForRehome = firstChildElForDocxEdit(nextForRehome, 'pPr');
      markersForRehome.slice().reverse().forEach(function (markerForRehome) {
        if (anchorForRehome) insertAfterForDocxEdit(anchorForRehome, markerForRehome);
        else insertAtForDocxEdit(nextForRehome, 0, markerForRehome);
      });
    } else if (previousForRehome) {
      markersForRehome.forEach(function (markerForRehome) { appendChildForDocxEdit(previousForRehome, markerForRehome); });
    }
  }

  function isOnlyOrLastParagraphForDocxEdit(paragraphForLast) {
    var parentForLast = paragraphForLast.parent;
    if (!parentForLast) return true;
    var siblingsForLast = childElementsForDocxEdit(parentForLast, 'p');
    if (siblingsForLast.length <= 1) return true;
    var localForParent = localNameForDocxEdit(parentForLast.name || '');
    // A cell and the body must end with a paragraph, so the last one is never removed.
    return (localForParent === 'tc' || localForParent === 'body') && siblingsForLast[siblingsForLast.length - 1] === paragraphForLast;
  }

  // Deletes one paragraph. Returns a note when it had to be emptied rather than removed.
  function deleteParagraphForDocxEdit(paragraphForDelete, ctxForDelete) {
    var pPrForDelete = firstChildElForDocxEdit(paragraphForDelete, 'pPr');
    var hasSectionForDelete = !!(pPrForDelete && firstChildElForDocxEdit(pPrForDelete, 'sectPr'));
    var mustKeepForDelete = hasSectionForDelete || isOnlyOrLastParagraphForDocxEdit(paragraphForDelete);
    if (ctxForDelete.track) {
      deleteRunsBelowForDocxEdit(paragraphForDelete, ctxForDelete);
      if (!mustKeepForDelete) markParagraphMarkForDocxEdit(paragraphForDelete, 'del', ctxForDelete);
    } else if (mustKeepForDelete) {
      clearParagraphForDocxEdit(paragraphForDelete, ctxForDelete);
    } else {
      rehomeRangeMarkersForDocxEdit(paragraphForDelete);
      detachForDocxEdit(paragraphForDelete);
    }
    if (!mustKeepForDelete) return '';
    return hasSectionForDelete
      ? 'it ends a section, so its text was removed and the section break kept'
      : 'it is the last paragraph of its cell or of the document, so its text was removed and the empty paragraph kept';
  }

  function deleteTableForDocxEdit(tableForDelete, ctxForDelete) {
    if (ctxForDelete.track) {
      childElementsForDocxEdit(tableForDelete, 'tr').forEach(function (rowForDelete) {
        markRowForDocxEdit(rowForDelete, 'del', ctxForDelete);
        deleteRunsBelowForDocxEdit(rowForDelete, ctxForDelete);
      });
      return;
    }
    detachForDocxEdit(tableForDelete);
  }

  // ---- Edit operations ----

  function failForDocxEdit(messageForFail) {
    return { ok: false, error: messageForFail };
  }

  function clipForDocxEdit(textForClip) {
    var stringForClip = String(textForClip == null ? '' : textForClip);
    return stringForClip.length > 60 ? stringForClip.slice(0, 60) + '...' : stringForClip;
  }

  function stringFieldForDocxEdit(editForField, nameForField, requiredForField) {
    var valueForField = editForField[nameForField];
    if (valueForField == null) return requiredForField ? { error: editForField.op + ' needs ' + nameForField + '.' } : { value: null };
    if (typeof valueForField !== 'string' && typeof valueForField !== 'number' && typeof valueForField !== 'boolean') {
      return { error: nameForField + ' must be a string.' };
    }
    var textForField = String(valueForField);
    if (textForField.length > MAX_TEXT_CHARS_FOR_DOCX_EDIT) return { error: nameForField + ' is longer than ' + MAX_TEXT_CHARS_FOR_DOCX_EDIT + ' characters.' };
    return { value: textForField };
  }

  function replaceTextEditForDocxEdit(editForReplace, ctxForReplace) {
    var findForReplace = stringFieldForDocxEdit(editForReplace, 'find', true);
    if (findForReplace.error) return failForDocxEdit(findForReplace.error);
    if (!findForReplace.value) return failForDocxEdit('replace_text needs find: the exact text to replace.');
    if (findForReplace.value.length > MAX_FIND_CHARS_FOR_DOCX_EDIT) return failForDocxEdit('find is longer than ' + MAX_FIND_CHARS_FOR_DOCX_EDIT + ' characters. Use set_text to rewrite a whole paragraph.');
    var replacementForReplace = stringFieldForDocxEdit(editForReplace, 'replace', false);
    if (replacementForReplace.error) return failForDocxEdit(replacementForReplace.error);
    var newTextForReplace = replacementForReplace.value || '';
    var occurrenceForReplace = String(editForReplace.occurrence || 'all');
    if (occurrenceForReplace !== 'all' && occurrenceForReplace !== 'first') return failForDocxEdit('occurrence must be "all" or "first".');
    var firstOnlyForReplace = occurrenceForReplace === 'first';
    var targetsForReplace;
    if (editForReplace.id != null && editForReplace.id !== '') {
      var resolvedForReplace = ctxForReplace.resolve(editForReplace.id);
      if (resolvedForReplace.error) return failForDocxEdit(resolvedForReplace.error);
      targetsForReplace = [{ path: ctxForReplace.mainPath, paragraph: resolvedForReplace.node }];
    } else {
      targetsForReplace = ctxForReplace.allParagraphs();
    }
    var countForReplace = 0;
    for (var iForTargets = 0; iForTargets < targetsForReplace.length; iForTargets++) {
      if (firstOnlyForReplace && countForReplace) break;
      var targetForReplace = targetsForReplace[iForTargets];
      var positionsForReplace = findPositionsForDocxEdit(paragraphTextForDocxEdit(targetForReplace.paragraph), findForReplace.value, firstOnlyForReplace);
      if (!positionsForReplace.length) continue;
      for (var kForReplace = positionsForReplace.length - 1; kForReplace >= 0; kForReplace--) {
        var startForMatch = positionsForReplace[kForReplace];
        var endForMatch = startForMatch + findForReplace.value.length;
        applyTextChangeForDocxEdit(targetForReplace.paragraph, startForMatch, endForMatch, newTextForReplace, ctxForReplace);
      }
      countForReplace += positionsForReplace.length;
      ctxForReplace.changed[targetForReplace.path] = true;
    }
    if (!countForReplace) {
      return failForDocxEdit('Text not found: "' + clipForDocxEdit(findForReplace.value) + '"'
        + (editForReplace.id ? ' in ' + editForReplace.id : '')
        + '. find must match the document text exactly, including spaces, punctuation, and capital letters.');
    }
    return { ok: true, matches: countForReplace };
  }

  function setTextEditForDocxEdit(editForSet, ctxForSet) {
    var resolvedForSet = ctxForSet.resolve(editForSet.id);
    if (resolvedForSet.error) return failForDocxEdit(resolvedForSet.error);
    var textForSet = stringFieldForDocxEdit(editForSet, 'text', true);
    if (textForSet.error) return failForDocxEdit(textForSet.error);
    replaceParagraphTextForDocxEdit(resolvedForSet.node, textForSet.value, ctxForSet);
    ctxForSet.changed[ctxForSet.mainPath] = true;
    return { ok: true };
  }

  function serializeOrEmptyForDocxEdit(nodeForSerialize) {
    return nodeForSerialize ? serializeXmlForDocxEdit({ type: 'root', children: [nodeForSerialize] }) : '';
  }

  function isHeadingParagraphForDocxEdit(paragraphForHeading) {
    var pPrForHeading = firstChildElForDocxEdit(paragraphForHeading, 'pPr');
    if (!pPrForHeading) return false;
    var outlineForHeading = firstChildElForDocxEdit(pPrForHeading, 'outlineLvl');
    if (outlineForHeading && Number(getAttrForDocxEdit(outlineForHeading, 'val')) < 9) return true;
    var styleForHeading = firstChildElForDocxEdit(pPrForHeading, 'pStyle');
    return !!styleForHeading && /heading|title|berschrift|titre|titulo|kop/i.test(String(getAttrForDocxEdit(styleForHeading, 'val') || ''));
  }

  function siblingParagraphForDocxEdit(paragraphForSibling, offsetForSibling) {
    if (!paragraphForSibling.parent) return null;
    var siblingsForSibling = childElementsForDocxEdit(paragraphForSibling.parent, 'p');
    return siblingsForSibling[siblingsForSibling.indexOf(paragraphForSibling) + offsetForSibling] || null;
  }

  // A paragraph's properties with its spacing (and its mark and revision records) left out, for
  // telling whether two paragraphs differ only in spacing.
  function propsWithoutSpacingForDocxEdit(pPrForCompare) {
    var copyForCompare = cloneNodeForDocxEdit(pPrForCompare);
    removeChildElementsForDocxEdit(copyForCompare, ['spacing', 'rPr', 'pPrChange', 'sectPr']);
    return serializeOrEmptyForDocxEdit(copyForCompare).replace(/^<[^>]*>|<\/[^>]*>$/g, '');
  }

  // LibreOffice and Google Docs give only the last item of a list the space that ends the list
  // (and only the first the space that opens it). A paragraph added past that edge takes the edge
  // spacing over, and the item it joins takes its neighbour's spacing, so no gap opens inside the
  // list.
  function handOverEdgeSpacingForDocxEdit(anchorForEdge, beforeForEdge, ctxForEdge) {
    var neighbourForEdge = siblingParagraphForDocxEdit(anchorForEdge, beforeForEdge ? 1 : -1);
    if (!neighbourForEdge) return;
    var anchorPPrForEdge = firstChildElForDocxEdit(anchorForEdge, 'pPr');
    var neighbourPPrForEdge = firstChildElForDocxEdit(neighbourForEdge, 'pPr');
    if (!anchorPPrForEdge || !neighbourPPrForEdge) return;
    if (propsWithoutSpacingForDocxEdit(anchorPPrForEdge) !== propsWithoutSpacingForDocxEdit(neighbourPPrForEdge)) return;
    var anchorSpacingForEdge = firstChildElForDocxEdit(anchorPPrForEdge, 'spacing');
    var neighbourSpacingForEdge = firstChildElForDocxEdit(neighbourPPrForEdge, 'spacing');
    if (serializeOrEmptyForDocxEdit(anchorSpacingForEdge) === serializeOrEmptyForDocxEdit(neighbourSpacingForEdge)) return;
    var pPrForEdge = recordParagraphPropsChangeForDocxEdit(anchorForEdge, ctxForEdge);
    removeChildElementsForDocxEdit(pPrForEdge, ['spacing']);
    if (neighbourSpacingForEdge) insertOrderedForDocxEdit(pPrForEdge, cloneNodeForDocxEdit(neighbourSpacingForEdge), PPR_ORDER_FOR_DOCX_EDIT);
  }

  function insertParagraphsEditForDocxEdit(editForInsert, ctxForInsert, beforeForInsert) {
    var anchorForInsert = ctxForInsert.resolve(editForInsert.id);
    if (anchorForInsert.error) return failForDocxEdit(anchorForInsert.error);
    var likeForInsert = anchorForInsert;
    var likeGivenForInsert = editForInsert.like != null && editForInsert.like !== '';
    if (likeGivenForInsert) {
      likeForInsert = ctxForInsert.resolve(editForInsert.like);
      if (likeForInsert.error) return failForDocxEdit('like: ' + likeForInsert.error);
    } else if (isHeadingParagraphForDocxEdit(anchorForInsert.node)) {
      // Text added next to a heading is almost always body text, so it copies the body paragraph
      // beside the heading rather than becoming a second heading.
      var bodyForInsert = siblingParagraphForDocxEdit(anchorForInsert.node, beforeForInsert ? -1 : 1);
      if (bodyForInsert && !isHeadingParagraphForDocxEdit(bodyForInsert)) likeForInsert = { node: bodyForInsert };
    }
    var textsForInsert = null;
    if (Array.isArray(editForInsert.paragraphs)) {
      textsForInsert = editForInsert.paragraphs;
    } else if (editForInsert.text != null) {
      textsForInsert = [editForInsert.text];
    }
    if (!textsForInsert || !textsForInsert.length) return failForDocxEdit(editForInsert.op + ' needs text, or paragraphs: an array of texts.');
    if (textsForInsert.length > MAX_INSERTED_PARAGRAPHS_FOR_DOCX_EDIT) return failForDocxEdit('paragraphs has more than ' + MAX_INSERTED_PARAGRAPHS_FOR_DOCX_EDIT + ' entries.');
    for (var iForCheck = 0; iForCheck < textsForInsert.length; iForCheck++) {
      var valueForCheck = textsForInsert[iForCheck];
      if (valueForCheck != null && typeof valueForCheck !== 'string' && typeof valueForCheck !== 'number') return failForDocxEdit('Each paragraph must be a string.');
      if (String(valueForCheck == null ? '' : valueForCheck).length > MAX_TEXT_CHARS_FOR_DOCX_EDIT) return failForDocxEdit('A paragraph is longer than ' + MAX_TEXT_CHARS_FOR_DOCX_EDIT + ' characters.');
    }
    var prefixForInsert = ctxForInsert.prefix;
    var pPrForInsert = firstChildElForDocxEdit(likeForInsert.node, 'pPr');
    var copiesAnchorForInsert = likeForInsert.node === anchorForInsert.node;
    var basePPrForInsert = pPrForInsert ? cleanParagraphPropsCloneForDocxEdit(pPrForInsert) : null;
    var baseRPrForInsert = dominantRunPropsForDocxEdit(likeForInsert.node);
    var createdForInsert = textsForInsert.map(function (textForNew) {
      var paragraphForNew = makeElForDocxEdit(anchorForInsert.node.name);
      if (basePPrForInsert) appendChildForDocxEdit(paragraphForNew, cloneNodeForDocxEdit(basePPrForInsert));
      var stringForNew = String(textForNew == null ? '' : textForNew);
      if (ctxForInsert.track) {
        markParagraphMarkForDocxEdit(paragraphForNew, 'ins', ctxForInsert);
        if (stringForNew) {
          appendChildForDocxEdit(paragraphForNew, makeElForDocxEdit(prefixForInsert + 'ins', revisionAttrsForDocxEdit(ctxForInsert),
            [makeRunForDocxEdit(prefixForInsert, baseRPrForInsert, stringForNew)]));
        }
      } else if (stringForNew) {
        appendChildForDocxEdit(paragraphForNew, makeRunForDocxEdit(prefixForInsert, baseRPrForInsert, stringForNew));
      }
      return paragraphForNew;
    });
    if (copiesAnchorForInsert) handOverEdgeSpacingForDocxEdit(anchorForInsert.node, beforeForInsert, ctxForInsert);
    if (beforeForInsert) {
      createdForInsert.forEach(function (paragraphForPlace) { insertBeforeForDocxEdit(anchorForInsert.node, paragraphForPlace); });
    } else {
      var referenceForInsert = anchorForInsert.node;
      createdForInsert.forEach(function (paragraphForPlace) {
        insertAfterForDocxEdit(referenceForInsert, paragraphForPlace);
        referenceForInsert = paragraphForPlace;
      });
    }
    ctxForInsert.changed[ctxForInsert.mainPath] = true;
    return { ok: true, inserted: createdForInsert.length };
  }

  // The nearest ancestor of node that also contains other, and the child of it on each path.
  function commonContainerForDocxEdit(nodeForCommon, otherForCommon) {
    var currentForCommon = nodeForCommon.parent;
    while (currentForCommon) {
      var blockForOther = topLevelChildForDocxEdit(currentForCommon, otherForCommon);
      if (blockForOther) {
        return { container: currentForCommon, first: topLevelChildForDocxEdit(currentForCommon, nodeForCommon), last: blockForOther };
      }
      currentForCommon = currentForCommon.parent;
    }
    return null;
  }

  function deleteEditForDocxEdit(editForDelete, ctxForDelete) {
    var fromForDelete = ctxForDelete.resolve(editForDelete.id);
    if (fromForDelete.error) return failForDocxEdit(fromForDelete.error);
    var notesForDelete = [];
    if (editForDelete.to == null || editForDelete.to === '' || String(editForDelete.to) === String(editForDelete.id)) {
      var noteForSingle = deleteParagraphForDocxEdit(fromForDelete.node, ctxForDelete);
      ctxForDelete.changed[ctxForDelete.mainPath] = true;
      return noteForSingle ? { ok: true, note: editForDelete.id + ': ' + noteForSingle } : { ok: true };
    }
    var toForDelete = ctxForDelete.resolve(editForDelete.to);
    if (toForDelete.error) return failForDocxEdit('to: ' + toForDelete.error);
    var commonForDelete = commonContainerForDocxEdit(fromForDelete.node, toForDelete.node);
    var containerLocalForDelete = commonForDelete ? localNameForDocxEdit(commonForDelete.container.name || '') : '';
    if (!commonForDelete || ['body', 'tc', 'sdtContent'].indexOf(containerLocalForDelete) < 0) {
      return failForDocxEdit('id and to must be in the same table cell, or both outside tables. To remove a whole table, use delete_table.');
    }
    var blocksForDelete = childElementsForDocxEdit(commonForDelete.container);
    var firstIndexForDelete = blocksForDelete.indexOf(commonForDelete.first);
    var lastIndexForDelete = blocksForDelete.indexOf(commonForDelete.last);
    if (firstIndexForDelete > lastIndexForDelete) return failForDocxEdit('to must come after id in the document.');
    blocksForDelete.slice(firstIndexForDelete, lastIndexForDelete + 1).forEach(function (blockForDelete) {
      var localForBlock = localNameForDocxEdit(blockForDelete.name);
      if (localForBlock === 'p') {
        var noteForBlock = deleteParagraphForDocxEdit(blockForDelete, ctxForDelete);
        if (noteForBlock && notesForDelete.indexOf(noteForBlock) < 0) notesForDelete.push(noteForBlock);
      } else if (localForBlock === 'tbl') {
        deleteTableForDocxEdit(blockForDelete, ctxForDelete);
      } else if (localForBlock === 'sdt' || localForBlock === 'customXml') {
        if (ctxForDelete.track) deleteRunsBelowForDocxEdit(blockForDelete, ctxForDelete);
        else detachForDocxEdit(blockForDelete);
      }
    });
    ctxForDelete.changed[ctxForDelete.mainPath] = true;
    return notesForDelete.length ? { ok: true, note: 'One paragraph was kept: ' + notesForDelete.join('; ') } : { ok: true };
  }

  function stripUniqueIdsForDocxEdit(nodeForStrip) {
    var stripForUnique = function (elementForUnique) {
      removeAttrsForDocxEdit(elementForUnique, function (nameForUnique) {
        var localForUnique = localNameForDocxEdit(nameForUnique);
        return localForUnique === 'paraId' || localForUnique === 'textId';
      });
    };
    stripForUnique(nodeForStrip);
    walkElementsForDocxEdit(nodeForStrip, function (elementForWalk) { stripForUnique(elementForWalk); return true; });
  }

  function insertRowEditForDocxEdit(editForRow, ctxForRow, beforeForRow) {
    var anchorForRow = ctxForRow.resolve(editForRow.id);
    if (anchorForRow.error) return failForDocxEdit(anchorForRow.error);
    var rowForRow = ancestorForDocxEdit(anchorForRow.node, 'tr');
    if (!rowForRow) return failForDocxEdit(editForRow.id + ' is not in a table.');
    if (!Array.isArray(editForRow.cells)) return failForDocxEdit(editForRow.op + ' needs cells: an array with one value per column.');
    var cellsForRow = childElementsForDocxEdit(rowForRow, 'tc');
    if (editForRow.cells.length > cellsForRow.length) {
      return failForDocxEdit('The row of ' + editForRow.id + ' has ' + cellsForRow.length + ' cells, but cells has ' + editForRow.cells.length + ' values.');
    }
    var prefixForRow = ctxForRow.prefix;
    var newRowForRow = cloneNodeForDocxEdit(rowForRow);
    stripUniqueIdsForDocxEdit(newRowForRow);
    var trPrForRow = firstChildElForDocxEdit(newRowForRow, 'trPr');
    if (trPrForRow) removeChildElementsForDocxEdit(trPrForRow, ['ins', 'del', 'trPrChange']);
    childElementsForDocxEdit(newRowForRow, 'tc').forEach(function (cellForRow, indexForCell) {
      var tcPrForRow = firstChildElForDocxEdit(cellForRow, 'tcPr');
      if (tcPrForRow) removeChildElementsForDocxEdit(tcPrForRow, ['vMerge', 'tcPrChange', 'cellIns', 'cellDel', 'cellMerge']);
      var firstParagraphForRow = firstChildElForDocxEdit(cellForRow, 'p');
      var baseRPrForRow = firstParagraphForRow ? dominantRunPropsForDocxEdit(firstParagraphForRow) : null;
      childElementsForDocxEdit(cellForRow).forEach(function (childForRow) {
        if (childForRow !== firstParagraphForRow && !isElForDocxEdit(childForRow, 'tcPr')) detachForDocxEdit(childForRow);
      });
      if (!firstParagraphForRow) firstParagraphForRow = appendChildForDocxEdit(cellForRow, makeElForDocxEdit(prefixForRow + 'p'));
      childElementsForDocxEdit(firstParagraphForRow).forEach(function (childForParagraph) {
        if (!isElForDocxEdit(childForParagraph, 'pPr')) detachForDocxEdit(childForParagraph);
      });
      var pPrForCell = firstChildElForDocxEdit(firstParagraphForRow, 'pPr');
      if (pPrForCell) {
        removeChildElementsForDocxEdit(pPrForCell, ['sectPr', 'pPrChange']);
        var markForCell = firstChildElForDocxEdit(pPrForCell, 'rPr');
        if (markForCell) removeChildElementsForDocxEdit(markForCell, ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);
      }
      var rawValueForCell = editForRow.cells[indexForCell];
      var valueForCell = indexForCell < editForRow.cells.length && rawValueForCell != null ? String(rawValueForCell) : '';
      if (ctxForRow.track) {
        markParagraphMarkForDocxEdit(firstParagraphForRow, 'ins', ctxForRow);
        if (valueForCell) {
          appendChildForDocxEdit(firstParagraphForRow, makeElForDocxEdit(prefixForRow + 'ins', revisionAttrsForDocxEdit(ctxForRow),
            [makeRunForDocxEdit(prefixForRow, baseRPrForRow, valueForCell)]));
        }
      } else if (valueForCell) {
        appendChildForDocxEdit(firstParagraphForRow, makeRunForDocxEdit(prefixForRow, baseRPrForRow, valueForCell));
      }
    });
    if (ctxForRow.track) markRowForDocxEdit(newRowForRow, 'ins', ctxForRow);
    if (beforeForRow) insertBeforeForDocxEdit(rowForRow, newRowForRow);
    else insertAfterForDocxEdit(rowForRow, newRowForRow);
    ctxForRow.changed[ctxForRow.mainPath] = true;
    return { ok: true };
  }

  function deleteRowEditForDocxEdit(editForRow, ctxForRow) {
    var anchorForRow = ctxForRow.resolve(editForRow.id);
    if (anchorForRow.error) return failForDocxEdit(anchorForRow.error);
    var rowForRow = ancestorForDocxEdit(anchorForRow.node, 'tr');
    if (!rowForRow) return failForDocxEdit(editForRow.id + ' is not in a table.');
    if (childElementsForDocxEdit(rowForRow.parent, 'tr').length <= 1) {
      return failForDocxEdit('That is the only row of its table. Use delete_table to remove the table.');
    }
    if (ctxForRow.track) {
      markRowForDocxEdit(rowForRow, 'del', ctxForRow);
      deleteRunsBelowForDocxEdit(rowForRow, ctxForRow);
    } else {
      detachForDocxEdit(rowForRow);
    }
    ctxForRow.changed[ctxForRow.mainPath] = true;
    return { ok: true };
  }

  function deleteTableEditForDocxEdit(editForTable, ctxForTable) {
    var anchorForTable = ctxForTable.resolve(editForTable.id);
    if (anchorForTable.error) return failForDocxEdit(anchorForTable.error);
    var tableForTable = ancestorForDocxEdit(anchorForTable.node, 'tbl');
    if (!tableForTable) return failForDocxEdit(editForTable.id + ' is not in a table.');
    deleteTableForDocxEdit(tableForTable, ctxForTable);
    ctxForTable.changed[ctxForTable.mainPath] = true;
    return { ok: true };
  }

  function normalizeColorForDocxEdit(valueForColor) {
    var textForColor = String(valueForColor == null ? '' : valueForColor).trim();
    if (/^auto$/i.test(textForColor)) return 'auto';
    var matchForColor = /^#?([0-9a-f]{6})$/i.exec(textForColor);
    if (matchForColor) return matchForColor[1].toUpperCase();
    var shortForColor = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(textForColor);
    if (shortForColor) return (shortForColor[1] + shortForColor[1] + shortForColor[2] + shortForColor[2] + shortForColor[3] + shortForColor[3]).toUpperCase();
    return '';
  }

  function readFormatPropsForDocxEdit(editForFormat) {
    var propsForFormat = {};
    var countForFormat = 0;
    var errorForFormat = '';
    ['bold', 'italic', 'underline', 'strike'].forEach(function (keyForFlag) {
      if (editForFormat[keyForFlag] == null) return;
      if (typeof editForFormat[keyForFlag] !== 'boolean') { errorForFormat = keyForFlag + ' must be true or false.'; return; }
      propsForFormat[keyForFlag] = editForFormat[keyForFlag];
      countForFormat++;
    });
    if (editForFormat.color != null) {
      propsForFormat.color = normalizeColorForDocxEdit(editForFormat.color);
      if (!propsForFormat.color) errorForFormat = 'color must be a hex colour such as #C00000, or "auto".';
      countForFormat++;
    }
    if (editForFormat.highlight != null) {
      var highlightForFormat = editForFormat.highlight;
      if (highlightForFormat === true) {
        propsForFormat.highlight = { name: 'yellow' };
      } else if (highlightForFormat === false || String(highlightForFormat).toLowerCase() === 'none') {
        propsForFormat.highlight = { name: 'none' };
      } else {
        var nameMatchForFormat = HIGHLIGHT_NAMES_FOR_DOCX_EDIT.filter(function (nameForHighlight) {
          return nameForHighlight.toLowerCase() === String(highlightForFormat).toLowerCase();
        })[0];
        var hexForFormat = normalizeColorForDocxEdit(highlightForFormat);
        if (nameMatchForFormat) propsForFormat.highlight = { name: nameMatchForFormat };
        else if (hexForFormat && hexForFormat !== 'auto') propsForFormat.highlight = { fill: hexForFormat };
        else errorForFormat = 'highlight must be true, false, a Word highlight colour such as "yellow", or a hex colour.';
      }
      countForFormat++;
    }
    if (editForFormat.font != null) {
      var fontForFormat = String(editForFormat.font).trim();
      if (!fontForFormat || fontForFormat.length > 80) errorForFormat = 'font must be a font name.';
      propsForFormat.font = fontForFormat;
      countForFormat++;
    }
    if (editForFormat.size != null) {
      var sizeForFormat = Number(editForFormat.size);
      if (!Number.isFinite(sizeForFormat) || sizeForFormat < 1 || sizeForFormat > 400) errorForFormat = 'size must be a number of points from 1 to 400.';
      propsForFormat.halfPoints = Math.round(sizeForFormat * 2);
      countForFormat++;
    }
    if (editForFormat.align != null) {
      propsForFormat.jc = ALIGN_TO_JC_FOR_DOCX_EDIT[String(editForFormat.align).toLowerCase()];
      if (!propsForFormat.jc) errorForFormat = 'align must be "left", "center", "right", or "justify".';
      countForFormat++;
    }
    if (!errorForFormat && !countForFormat) errorForFormat = 'format needs at least one of bold, italic, underline, strike, color, highlight, font, size, or align.';
    return { props: propsForFormat, error: errorForFormat };
  }

  function applyRunFormatForDocxEdit(runForFormat, propsForFormat, ctxForFormat) {
    applyRPrFormatForDocxEdit(ensureRPrForDocxEdit(runForFormat, ctxForFormat.prefix), propsForFormat, ctxForFormat);
  }

  // Formats the paragraph mark as Word does when a whole paragraph is selected. A list item's
  // bullet or number is drawn with the mark's formatting, so without this a list item turned red
  // would keep a black bullet.
  function applyParagraphMarkFormatForDocxEdit(paragraphForMark, propsForMark, ctxForMark) {
    var pPrForMark = ensurePPrForDocxEdit(paragraphForMark, ctxForMark.prefix);
    var rPrForMark = firstChildElForDocxEdit(pPrForMark, 'rPr')
      || insertOrderedForDocxEdit(pPrForMark, makeElForDocxEdit(ctxForMark.prefix + 'rPr'), PPR_ORDER_FOR_DOCX_EDIT);
    applyRPrFormatForDocxEdit(rPrForMark, propsForMark, ctxForMark);
  }

  function applyRPrFormatForDocxEdit(rPrForFormat, propsForFormat, ctxForFormat) {
    var prefixForFormat = ctxForFormat.prefix;
    if (ctxForFormat.track && !firstChildElForDocxEdit(rPrForFormat, 'rPrChange')) {
      var previousForFormat = cloneNodeForDocxEdit(rPrForFormat);
      // A paragraph mark's rPr can also say the mark itself was inserted or deleted. That is not
      // formatting, so it stays out of the record of the old formatting.
      removeChildElementsForDocxEdit(previousForFormat, ['rPrChange', 'ins', 'del', 'moveFrom', 'moveTo']);
      appendChildForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'rPrChange', revisionAttrsForDocxEdit(ctxForFormat), [previousForFormat]));
    }
    function setToggleForFormat(localForToggle, onForToggle) {
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + localForToggle, onForToggle ? [] : [[prefixForFormat + 'val', '0']]), RPR_ORDER_FOR_DOCX_EDIT);
    }
    if (propsForFormat.bold != null) { setToggleForFormat('b', propsForFormat.bold); setToggleForFormat('bCs', propsForFormat.bold); }
    if (propsForFormat.italic != null) { setToggleForFormat('i', propsForFormat.italic); setToggleForFormat('iCs', propsForFormat.italic); }
    if (propsForFormat.strike != null) setToggleForFormat('strike', propsForFormat.strike);
    if (propsForFormat.underline != null) {
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'u', [[prefixForFormat + 'val', propsForFormat.underline ? 'single' : 'none']]), RPR_ORDER_FOR_DOCX_EDIT);
    }
    if (propsForFormat.color) {
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'color', [[prefixForFormat + 'val', propsForFormat.color]]), RPR_ORDER_FOR_DOCX_EDIT);
    }
    if (propsForFormat.halfPoints) {
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'sz', [[prefixForFormat + 'val', propsForFormat.halfPoints]]), RPR_ORDER_FOR_DOCX_EDIT);
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'szCs', [[prefixForFormat + 'val', propsForFormat.halfPoints]]), RPR_ORDER_FOR_DOCX_EDIT);
    }
    if (propsForFormat.font) {
      // A theme font attribute (asciiTheme and the like) outranks the named one, so the whole
      // element is replaced rather than one attribute changed.
      replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'rFonts', [
        [prefixForFormat + 'ascii', propsForFormat.font], [prefixForFormat + 'hAnsi', propsForFormat.font],
        [prefixForFormat + 'eastAsia', propsForFormat.font], [prefixForFormat + 'cs', propsForFormat.font]
      ]), RPR_ORDER_FOR_DOCX_EDIT);
    }
    if (propsForFormat.highlight) {
      if (propsForFormat.highlight.fill) {
        removeChildElementsForDocxEdit(rPrForFormat, ['highlight']);
        replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'shd', [
          [prefixForFormat + 'val', 'clear'], [prefixForFormat + 'color', 'auto'], [prefixForFormat + 'fill', propsForFormat.highlight.fill]
        ]), RPR_ORDER_FOR_DOCX_EDIT);
      } else {
        if (propsForFormat.highlight.name === 'none') removeChildElementsForDocxEdit(rPrForFormat, ['shd']);
        replaceOrderedForDocxEdit(rPrForFormat, makeElForDocxEdit(prefixForFormat + 'highlight', [[prefixForFormat + 'val', propsForFormat.highlight.name]]), RPR_ORDER_FOR_DOCX_EDIT);
      }
    }
  }

  // In tracked mode, records the paragraph's properties as they were before a change to them.
  function recordParagraphPropsChangeForDocxEdit(paragraphForRecord, ctxForRecord) {
    var pPrForRecord = ensurePPrForDocxEdit(paragraphForRecord, ctxForRecord.prefix);
    if (ctxForRecord.track && !firstChildElForDocxEdit(pPrForRecord, 'pPrChange')) {
      var previousForRecord = cloneNodeForDocxEdit(pPrForRecord);
      removeChildElementsForDocxEdit(previousForRecord, ['rPr', 'sectPr', 'pPrChange']);
      appendChildForDocxEdit(pPrForRecord, makeElForDocxEdit(ctxForRecord.prefix + 'pPrChange', revisionAttrsForDocxEdit(ctxForRecord), [previousForRecord]));
    }
    return pPrForRecord;
  }

  function applyParagraphAlignForDocxEdit(paragraphForAlign, jcForAlign, ctxForAlign) {
    var pPrForAlign = recordParagraphPropsChangeForDocxEdit(paragraphForAlign, ctxForAlign);
    replaceOrderedForDocxEdit(pPrForAlign, makeElForDocxEdit(ctxForAlign.prefix + 'jc', [[ctxForAlign.prefix + 'val', jcForAlign]]), PPR_ORDER_FOR_DOCX_EDIT);
  }

  function formatEditForDocxEdit(editForFormat, ctxForFormat) {
    var resolvedForFormat = ctxForFormat.resolve(editForFormat.id);
    if (resolvedForFormat.error) return failForDocxEdit(resolvedForFormat.error);
    var readForFormat = readFormatPropsForDocxEdit(editForFormat);
    if (readForFormat.error) return failForDocxEdit(readForFormat.error);
    var propsForFormat = readForFormat.props;
    var paragraphForFormat = resolvedForFormat.node;
    var hasRunPropsForFormat = Object.keys(propsForFormat).some(function (keyForProps) { return keyForProps !== 'jc'; });
    var matchesForFormat = 0;
    if (hasRunPropsForFormat) {
      var runsForFormat = [];
      if (editForFormat.find != null && editForFormat.find !== '') {
        var findForFormat = String(editForFormat.find);
        var positionsForFormat = findPositionsForDocxEdit(paragraphTextForDocxEdit(paragraphForFormat), findForFormat, false);
        if (!positionsForFormat.length) {
          return failForDocxEdit('Text not found: "' + clipForDocxEdit(findForFormat) + '" in ' + editForFormat.id + '. find must match the text exactly.');
        }
        for (var kForFormat = positionsForFormat.length - 1; kForFormat >= 0; kForFormat--) {
          isolateRangeForDocxEdit(paragraphForFormat, positionsForFormat[kForFormat], positionsForFormat[kForFormat] + findForFormat.length)
            .forEach(function (runForRange) { if (runsForFormat.indexOf(runForRange) < 0) runsForFormat.push(runForRange); });
        }
        matchesForFormat = positionsForFormat.length;
      } else {
        runsForFormat = uniqueRunsForDocxEdit(collectPiecesForDocxEdit(paragraphForFormat));
        if (!runsForFormat.length) return failForDocxEdit(editForFormat.id + ' has no text to format.');
      }
      runsForFormat.forEach(function (runForFormat) { applyRunFormatForDocxEdit(runForFormat, propsForFormat, ctxForFormat); });
    }
    if (propsForFormat.jc) applyParagraphAlignForDocxEdit(paragraphForFormat, propsForFormat.jc, ctxForFormat);
    var wholeParagraphForFormat = editForFormat.find == null || editForFormat.find === '';
    if (hasRunPropsForFormat && wholeParagraphForFormat) applyParagraphMarkFormatForDocxEdit(paragraphForFormat, propsForFormat, ctxForFormat);
    ctxForFormat.changed[ctxForFormat.mainPath] = true;
    return matchesForFormat ? { ok: true, matches: matchesForFormat } : { ok: true };
  }

  function applyOneEditForDocxEdit(editForOne, ctxForOne) {
    if (!editForOne || typeof editForOne !== 'object' || Array.isArray(editForOne)) {
      return failForDocxEdit('Each edit must be an object with an op field.');
    }
    switch (String(editForOne.op || '')) {
      case 'replace_text': return replaceTextEditForDocxEdit(editForOne, ctxForOne);
      case 'set_text': return setTextEditForDocxEdit(editForOne, ctxForOne);
      case 'insert_after': return insertParagraphsEditForDocxEdit(editForOne, ctxForOne, false);
      case 'insert_before': return insertParagraphsEditForDocxEdit(editForOne, ctxForOne, true);
      case 'delete': return deleteEditForDocxEdit(editForOne, ctxForOne);
      case 'insert_row_after': return insertRowEditForDocxEdit(editForOne, ctxForOne, false);
      case 'insert_row_before': return insertRowEditForDocxEdit(editForOne, ctxForOne, true);
      case 'delete_row': return deleteRowEditForDocxEdit(editForOne, ctxForOne);
      case 'delete_table': return deleteTableEditForDocxEdit(editForOne, ctxForOne);
      case 'format': return formatEditForDocxEdit(editForOne, ctxForOne);
      default:
        return failForDocxEdit('Unknown op "' + clipForDocxEdit(editForOne.op) + '". Use one of: ' + OPS_FOR_DOCX_EDIT.join(', ') + '.');
    }
  }

  function summarizeForDocxEdit(resultsForSummary, ctxForSummary) {
    var countsForSummary = {};
    var matchesForSummary = 0;
    var insertedForSummary = 0;
    var notesForSummary = [];
    resultsForSummary.forEach(function (resultForSummary) {
      countsForSummary[resultForSummary.op] = (countsForSummary[resultForSummary.op] || 0) + 1;
      if (resultForSummary.op === 'replace_text') matchesForSummary += resultForSummary.matches || 0;
      if (resultForSummary.inserted) insertedForSummary += resultForSummary.inserted;
      if (resultForSummary.note) notesForSummary.push(resultForSummary.note);
    });
    var partsForSummary = [];
    if (countsForSummary.replace_text) partsForSummary.push(matchesForSummary + ' text replacement' + (matchesForSummary === 1 ? '' : 's'));
    if (countsForSummary.set_text) partsForSummary.push(countsForSummary.set_text + ' paragraph' + (countsForSummary.set_text === 1 ? '' : 's') + ' rewritten');
    if (insertedForSummary) partsForSummary.push(insertedForSummary + ' paragraph' + (insertedForSummary === 1 ? '' : 's') + ' inserted');
    if (countsForSummary.delete) partsForSummary.push(countsForSummary.delete + ' deletion' + (countsForSummary.delete === 1 ? '' : 's'));
    var rowsInsertedForSummary = (countsForSummary.insert_row_after || 0) + (countsForSummary.insert_row_before || 0);
    if (rowsInsertedForSummary) partsForSummary.push(rowsInsertedForSummary + ' row' + (rowsInsertedForSummary === 1 ? '' : 's') + ' inserted');
    if (countsForSummary.delete_row) partsForSummary.push(countsForSummary.delete_row + ' row' + (countsForSummary.delete_row === 1 ? '' : 's') + ' deleted');
    if (countsForSummary.delete_table) partsForSummary.push(countsForSummary.delete_table + ' table' + (countsForSummary.delete_table === 1 ? '' : 's') + ' deleted');
    if (countsForSummary.format) partsForSummary.push(countsForSummary.format + ' formatting change' + (countsForSummary.format === 1 ? '' : 's'));
    var textForSummary = 'Applied ' + resultsForSummary.length + ' edit' + (resultsForSummary.length === 1 ? '' : 's')
      + (partsForSummary.length ? ': ' + partsForSummary.join(', ') : '') + '.';
    if (ctxForSummary.track) textForSummary += ' They are tracked changes by ' + ctxForSummary.author + ', for the user to accept or reject in Word.';
    if (notesForSummary.length) textForSummary += ' ' + notesForSummary.join(' ');
    return textForSummary;
  }

  // parts maps zip paths to XML strings and must hold the main document part. Returns
  // { ok, parts: { path: newXml } for the parts that changed, results, summary }, or
  // { ok: false, error, results } with nothing changed when any edit fails.
  function applyEditsToPartsForDocxEdit(partsForApply, editsForApply, optionsForApply) {
    var optionsForEdits = optionsForApply || {};
    var mainPathForApply = optionsForEdits.mainPath || DEFAULT_MAIN_PART_FOR_DOCX_EDIT;
    if (!Array.isArray(editsForApply) || !editsForApply.length) return { ok: false, error: 'edits must be a non-empty array.', results: [] };
    if (editsForApply.length > MAX_EDITS_FOR_DOCX_EDIT) {
      return { ok: false, error: 'At most ' + MAX_EDITS_FOR_DOCX_EDIT + ' edits fit in one call. Split them across calls, reading the new file between them.', results: [] };
    }
    if (typeof partsForApply[mainPathForApply] !== 'string') {
      return { ok: false, error: 'The file has no ' + mainPathForApply + ', so it is not a Word document.', results: [] };
    }
    var rootsForApply = {};
    try {
      rootsForApply[mainPathForApply] = parseXmlForDocxEdit(partsForApply[mainPathForApply]);
    } catch (parseErrForApply) {
      return { ok: false, error: 'Could not read the document: ' + parseErrForApply.message, results: [] };
    }
    var mainRootForApply = rootsForApply[mainPathForApply];
    var paragraphsByIdForApply = collectParagraphsForDocxEdit(mainRootForApply, false);
    var authorForApply = String(optionsForEdits.author == null ? '' : optionsForEdits.author).replace(/\s+/g, ' ').trim().slice(0, 80);
    var nowForApply = optionsForEdits.now ? new Date(optionsForEdits.now) : new Date();
    var ctxForApply = {
      mainPath: mainPathForApply,
      prefix: paragraphsByIdForApply.length ? prefixForDocxEdit(paragraphsByIdForApply[0].name) : 'w:',
      track: !!optionsForEdits.trackChanges,
      author: authorForApply || DEFAULT_AUTHOR_FOR_DOCX_EDIT,
      date: nowForApply.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      nextId: maxRevisionIdForDocxEdit(partsForApply) + 1,
      changed: {},
      resolve: function (idForResolve) {
        var matchForResolve = /^p(\d+)$/i.exec(String(idForResolve == null ? '' : idForResolve).trim());
        if (!matchForResolve) return { error: 'id must look like "p12", taken from a data-id in read_document_structure.' };
        var nodeForResolve = paragraphsByIdForApply[Number(matchForResolve[1]) - 1];
        if (!nodeForResolve) return { error: 'There is no paragraph ' + idForResolve + '. Use a data-id from read_document_structure for this file.' };
        if (!isAttachedForDocxEdit(nodeForResolve)) return { error: idForResolve + ' was removed by an earlier edit in this call.' };
        return { node: nodeForResolve };
      },
      allParagraphs: function () {
        var targetsForAll = [];
        Object.keys(partsForApply).forEach(function (pathForAll) {
          if (!rootsForApply[pathForAll]) {
            try { rootsForApply[pathForAll] = parseXmlForDocxEdit(partsForApply[pathForAll]); } catch (errForAll) { return; }
          }
          collectParagraphsForDocxEdit(rootsForApply[pathForAll], true).forEach(function (paragraphForAll) {
            targetsForAll.push({ path: pathForAll, paragraph: paragraphForAll });
          });
        });
        return targetsForAll;
      }
    };
    var resultsForApply = [];
    var failuresForApply = [];
    editsForApply.forEach(function (editForApply, indexForApply) {
      var outcomeForApply;
      try {
        outcomeForApply = applyOneEditForDocxEdit(editForApply, ctxForApply);
      } catch (errForApply) {
        outcomeForApply = failForDocxEdit((errForApply && errForApply.message) || 'The edit failed.');
      }
      outcomeForApply.index = indexForApply;
      outcomeForApply.op = editForApply && editForApply.op ? String(editForApply.op) : '';
      resultsForApply.push(outcomeForApply);
      if (!outcomeForApply.ok) failuresForApply.push('edit ' + indexForApply + ' (' + (outcomeForApply.op || 'no op') + '): ' + outcomeForApply.error);
    });
    if (failuresForApply.length) {
      return {
        ok: false,
        error: (editsForApply.length === 1
          ? 'The edit failed, so no file was made. Fix it and send it again. '
          : failuresForApply.length + ' of ' + editsForApply.length + ' edits failed, so no file was made. Fix them and send the whole list again. ')
          + failuresForApply.join(' '),
        results: resultsForApply
      };
    }
    var changedForApply = {};
    Object.keys(ctxForApply.changed).forEach(function (pathForChanged) {
      changedForApply[pathForChanged] = serializeXmlForDocxEdit(rootsForApply[pathForChanged]);
    });
    return { ok: true, parts: changedForApply, results: resultsForApply, summary: summarizeForDocxEdit(resultsForApply, ctxForApply) };
  }

  // ---- Read side ----

  function markerForDocxEdit(numberForMarker) {
    return MARKER_PREFIX_FOR_DOCX_EDIT + numberForMarker + MARKER_SUFFIX_FOR_DOCX_EDIT;
  }

  // Writes a marker run at the start of every paragraph mammoth will show (one with text or an
  // image), so its HTML carries each paragraph's id. Only the copy given to mammoth is marked.
  function markParagraphsForReadForDocxEdit(documentXmlForMark) {
    var rootForMark = parseXmlForDocxEdit(documentXmlForMark);
    var paragraphsForMark = collectParagraphsForDocxEdit(rootForMark, false);
    var markedForMark = 0;
    paragraphsForMark.forEach(function (paragraphForMark, indexForMark) {
      var visibleForMark = /\S/.test(paragraphTextForDocxEdit(paragraphForMark)) || hasImageForDocxEdit(paragraphForMark);
      if (!visibleForMark) return;
      var prefixForMark = prefixForDocxEdit(paragraphForMark.name);
      var runForMark = makeElForDocxEdit(prefixForMark + 'r', [], [
        makeElForDocxEdit(prefixForMark + 't', [['xml:space', 'preserve']], [makeTextNodeForDocxEdit(markerForDocxEdit(indexForMark + 1))])
      ]);
      var pPrForMark = firstChildElForDocxEdit(paragraphForMark, 'pPr');
      if (pPrForMark) insertAfterForDocxEdit(pPrForMark, runForMark);
      else insertAtForDocxEdit(paragraphForMark, 0, runForMark);
      markedForMark++;
    });
    return { xml: serializeXmlForDocxEdit(rootForMark), marked: markedForMark, total: paragraphsForMark.length };
  }

  // Moves each marker into a data-id on the block mammoth opened for its paragraph, and removes
  // any marker that did not land at the start of a block (text-box content, for example).
  function attachParagraphIdsForDocxEdit(htmlForAttach) {
    return String(htmlForAttach == null ? '' : htmlForAttach)
      .replace(BLOCK_MARKER_RE_FOR_DOCX_EDIT, function (wholeForAttach, tagForAttach, attrsForAttach, inlineForAttach, numberForAttach) {
        return '<' + tagForAttach + ' data-id="p' + numberForAttach + '"' + attrsForAttach + '>' + inlineForAttach;
      })
      .replace(MARKER_RE_FOR_DOCX_EDIT, '');
  }

  function isMarkerTextForDocxEdit(textForMarker) {
    return /^\[\[abchat-p:\d+\]\]$/.test(String(textForMarker == null ? '' : textForMarker));
  }

  // The distinct paragraph texts of the headers and footers, so the model knows what a
  // document-wide replace_text can reach there.
  function headerFooterTextsForDocxEdit(xmlListForTexts) {
    var textsForHeaders = [];
    (xmlListForTexts || []).forEach(function (xmlForHeader) {
      var rootForHeader;
      try { rootForHeader = parseXmlForDocxEdit(xmlForHeader); } catch (errForHeader) { return; }
      collectParagraphsForDocxEdit(rootForHeader, true).forEach(function (paragraphForHeader) {
        if (textsForHeaders.length >= MAX_HEADER_FOOTER_TEXTS_FOR_DOCX_EDIT) return;
        var textForHeader = paragraphTextForDocxEdit(paragraphForHeader).replace(/\s+/g, ' ').trim().slice(0, MAX_HEADER_FOOTER_CHARS_FOR_DOCX_EDIT);
        if (textForHeader && textsForHeaders.indexOf(textForHeader) < 0) textsForHeaders.push(textForHeader);
      });
    });
    return textsForHeaders;
  }

  // ---- Zip wrappers ----

  function getJsZipForDocxEdit() {
    var jsZipForGet = globalScopeForDocxEdit.JSZip;
    if (!jsZipForGet || typeof jsZipForGet.loadAsync !== 'function') throw new Error('JSZip is not loaded.');
    return jsZipForGet;
  }

  // The main document part named by the package relationships; almost always word/document.xml.
  function mainPartPathForDocxEdit(zipForMain) {
    var relsForMain = zipForMain.file('_rels/.rels');
    if (!relsForMain) return Promise.resolve(DEFAULT_MAIN_PART_FOR_DOCX_EDIT);
    return relsForMain.async('string').then(function (xmlForMain) {
      var reForMain = /<Relationship\b[^>]*>/g;
      var tagForMain;
      while ((tagForMain = reForMain.exec(xmlForMain)) !== null) {
        if (!/Type="[^"]*\/officeDocument"/.test(tagForMain[0])) continue;
        var targetForMain = /Target="([^"]+)"/.exec(tagForMain[0]);
        if (targetForMain) {
          var pathForMain = targetForMain[1].replace(/^\.?\//, '');
          if (zipForMain.file(pathForMain)) return pathForMain;
        }
      }
      return DEFAULT_MAIN_PART_FOR_DOCX_EDIT;
    }).catch(function () { return DEFAULT_MAIN_PART_FOR_DOCX_EDIT; });
  }

  // A copy of the DOCX with paragraph markers, for mammoth, plus the header and footer texts.
  function prepareForReadForDocxEdit(arrayBufferForPrepare) {
    var jsZipForPrepare;
    try { jsZipForPrepare = getJsZipForDocxEdit(); } catch (errForPrepare) { return Promise.reject(errForPrepare); }
    return jsZipForPrepare.loadAsync(arrayBufferForPrepare).then(function (zipForPrepare) {
      return mainPartPathForDocxEdit(zipForPrepare).then(function (mainPathForPrepare) {
        var entryForPrepare = zipForPrepare.file(mainPathForPrepare);
        if (!entryForPrepare) throw new Error('The file has no ' + mainPathForPrepare + '.');
        var headerPathsForPrepare = Object.keys(zipForPrepare.files).filter(function (pathForFilter) {
          return HEADER_FOOTER_PART_RE_FOR_DOCX_EDIT.test(pathForFilter);
        }).sort();
        return Promise.all([entryForPrepare.async('string')].concat(headerPathsForPrepare.map(function (pathForRead) {
          return zipForPrepare.file(pathForRead).async('string');
        }))).then(function (textsForPrepare) {
          var markedForPrepare = markParagraphsForReadForDocxEdit(textsForPrepare[0]);
          zipForPrepare.file(mainPathForPrepare, markedForPrepare.xml);
          return zipForPrepare.generateAsync({ type: 'arraybuffer', compression: 'STORE' }).then(function (bufferForPrepare) {
            return {
              buffer: bufferForPrepare,
              marked: markedForPrepare.marked,
              headersFooters: headerFooterTextsForDocxEdit(textsForPrepare.slice(1))
            };
          });
        });
      });
    });
  }

  // Applies edits to DOCX bytes. Resolves to { ok, base64, mimeType, size, results, summary }, or
  // { ok: false, error, results } when the file is not a Word document or any edit fails.
  function applyEditsToDocxForDocxEdit(arrayBufferForApply, editsForApply, optionsForApply) {
    var jsZipForApply;
    try { jsZipForApply = getJsZipForDocxEdit(); } catch (errForApply) { return Promise.reject(errForApply); }
    return jsZipForApply.loadAsync(arrayBufferForApply).then(function (zipForApply) {
      return mainPartPathForDocxEdit(zipForApply).then(function (mainPathForApply) {
        if (!zipForApply.file(mainPathForApply)) {
          return { ok: false, error: 'The file has no ' + mainPathForApply + ', so it is not a Word document.', results: [] };
        }
        var pathsForApply = [mainPathForApply].concat(Object.keys(zipForApply.files).filter(function (pathForFilter) {
          return pathForFilter !== mainPathForApply && OTHER_TEXT_PART_RE_FOR_DOCX_EDIT.test(pathForFilter);
        }).sort());
        return Promise.all(pathsForApply.map(function (pathForRead) { return zipForApply.file(pathForRead).async('string'); }))
          .then(function (textsForApply) {
            var partsForApply = {};
            pathsForApply.forEach(function (pathForPart, indexForPart) { partsForApply[pathForPart] = textsForApply[indexForPart]; });
            var outcomeForApply = applyEditsToPartsForDocxEdit(partsForApply, editsForApply,
              Object.assign({}, optionsForApply || {}, { mainPath: mainPathForApply }));
            if (!outcomeForApply.ok) return outcomeForApply;
            Object.keys(outcomeForApply.parts).forEach(function (pathForWrite) {
              zipForApply.file(pathForWrite, outcomeForApply.parts[pathForWrite]);
            });
            return zipForApply.generateAsync({ type: 'base64', compression: 'DEFLATE', mimeType: DOCX_MIME_TYPE_FOR_DOCX_EDIT })
              .then(function (base64ForApply) {
                return {
                  ok: true,
                  base64: base64ForApply,
                  mimeType: DOCX_MIME_TYPE_FOR_DOCX_EDIT,
                  size: Math.floor(base64ForApply.length * 3 / 4),
                  results: outcomeForApply.results,
                  summary: outcomeForApply.summary
                };
              });
          });
      });
    });
  }

  agentNamespaceForDocxEdit.docxEdit = {
    MIME_TYPE: DOCX_MIME_TYPE_FOR_DOCX_EDIT,
    OPS: OPS_FOR_DOCX_EDIT.slice(),
    MAX_EDITS: MAX_EDITS_FOR_DOCX_EDIT,
    parseXml: parseXmlForDocxEdit,
    serializeXml: serializeXmlForDocxEdit,
    collectParagraphs: collectParagraphsForDocxEdit,
    paragraphText: paragraphTextForDocxEdit,
    markParagraphsForRead: markParagraphsForReadForDocxEdit,
    attachParagraphIds: attachParagraphIdsForDocxEdit,
    isMarkerText: isMarkerTextForDocxEdit,
    headerFooterTexts: headerFooterTextsForDocxEdit,
    applyEditsToParts: applyEditsToPartsForDocxEdit,
    prepareForRead: prepareForReadForDocxEdit,
    applyEditsToDocx: applyEditsToDocxForDocxEdit
  };

  globalScopeForDocxEdit.ABChatAgent = agentNamespaceForDocxEdit;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = agentNamespaceForDocxEdit.docxEdit;
  }
})();
