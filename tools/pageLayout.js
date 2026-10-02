// Page layout runtime for the page_layout agent tool.
//
// The model never sends code here. It sends ids and data: "scan" returns numbered regions (r1, r2,
// ...) and repeated collections (c1, c2, ...) with their text fields labelled a, b, c; "apply"
// then asks for one of four fixed actions (sort, filter, hide, style) against those ids, and this
// file performs it with its own code. Every change is reversible from the on-page chip or through
// the tool's "undo" and "reset" operations, and nothing survives a page reload.
//
// Four mechanisms carry the weight:
//
//   - The style ledger. Every visual change is an inline style written through ledgerSet, which
//     remembers the element's original inline value and stacks one layer per change. Undoing a
//     change removes only its layer and rewrites whatever is now on top, so changes can be undone
//     in any order without clobbering each other. Inline styles are set through the CSSOM, which
//     page CSP does not govern, so this works on strict-CSP sites.
//   - Reordering never moves a node to a different parent. Items that share a flex or grid parent
//     are reordered with CSS `order`, which leaves the DOM alone; other items are moved between
//     slots inside their own parent. Moving a node out from under the parent a framework rendered
//     it into makes the framework's next removeChild/insertBefore throw, which can take the page's
//     app down. So a collection split across rows or sections is sorted within each group.
//   - Bindings keep collection changes live. A MutationObserver on the collection's watch root
//     re-applies sorts, filters and item styles when items load or the page reorders them,
//     debounced, and pauses itself if the page keeps undoing the change (a framework fighting it).
//   - Teardown when this copy is replaced. After an extension reload the new copy runs in a fresh
//     isolated world and cannot see this one, so this copy reverts its own changes: its observers
//     and its prune timer notice the lost extension context (or a newer listener generation) and
//     tear everything down, so no orphaned observer keeps re-sorting. A second run of this file in
//     the same world calls the previous copy's teardown directly before replacing it.

(function () {
  const globalScopeForPageLayout = globalThis;
  const nsForPageLayout = globalScopeForPageLayout.ABChatContent || {};

  // A second injection into the same world re-runs this file while the previous copy's changes are
  // still applied. The previous copy is reachable here, so let it revert its own work before its
  // reference is overwritten; this copy cannot know what the old one changed. After an extension
  // reload the old copy is in another world and reverts itself on its stale check.
  const previousRuntimeForPageLayout = nsForPageLayout.pageLayout;
  if (previousRuntimeForPageLayout && typeof previousRuntimeForPageLayout.teardown === 'function') {
    try { previousRuntimeForPageLayout.teardown(); } catch (eTeardownPreviousForPageLayout) { /* old context may be half gone */ }
  }

  const capturedGenerationForPageLayout = (typeof window !== 'undefined' && window.abchatListenerGeneration) || 0;

  const CHIP_HOST_ID_FOR_PAGE_LAYOUT = 'abchat-layout-host';
  const MAX_SCAN_ELEMENTS_FOR_PAGE_LAYOUT = 30000;
  // A long run of alike siblings (rows, cards, comments) is walked in full only at its start and
  // end. See createRepeatTrackerForPageLayout.
  const REPEAT_MIN_SIBLINGS_FOR_PAGE_LAYOUT = 50;
  const REPEAT_HEAD_FOR_PAGE_LAYOUT = 45;
  const REPEAT_TAIL_FOR_PAGE_LAYOUT = 5;
  const REPEAT_SHAPE_QUORUM_FOR_PAGE_LAYOUT = 30;
  const MAX_SKIPPED_REPEATS_FOR_PAGE_LAYOUT = 100000;
  const MIN_COLLECTION_ITEMS_FOR_PAGE_LAYOUT = 3;
  const MAX_COLLECTIONS_FOR_PAGE_LAYOUT = 8;
  const MAX_REGIONS_FOR_PAGE_LAYOUT = 24;
  // Headings looked at for titled sections, in walk order. A page with more is a long document,
  // whose later sections are past what the region list can show anyway.
  const MAX_SECTION_HEADINGS_FOR_PAGE_LAYOUT = 300;
  // How far above a list's parent the title of the part of the page holding it is looked for. A
  // card's title sits one or two levels up.
  const MAX_TITLE_LEVELS_FOR_PAGE_LAYOUT = 6;
  // After a sort, the screen positions of at most this many items in each of this many groups are
  // read to check that the items moved and now read in the sorted order.
  const SORT_CHECK_ITEMS_PER_GROUP_FOR_PAGE_LAYOUT = 50;
  const SORT_CHECK_GROUPS_FOR_PAGE_LAYOUT = 20;
  const MAX_FIELDS_FOR_PAGE_LAYOUT = 8;
  const MAX_LEAVES_PER_ITEM_FOR_PAGE_LAYOUT = 40;
  const MAX_LEAF_WALK_PER_ITEM_FOR_PAGE_LAYOUT = 600;
  const KIND_SAMPLE_ITEMS_FOR_PAGE_LAYOUT = 20;
  const MAX_LISTED_VALUES_FOR_PAGE_LAYOUT = 6;
  const MAX_CHANGES_PER_APPLY_FOR_PAGE_LAYOUT = 10;
  const MAX_ACTIVE_CHANGES_FOR_PAGE_LAYOUT = 40;
  // Sort and filter read a field of every item and then write to them, and the page cannot respond
  // meanwhile: about 20 µs an item on a real page, so a 766,000-link list took 17.5 s. Past this
  // many loaded items they are refused, and a sorted or filtered list that grows past it stops
  // following.
  const MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT = 20000;
  // List items (display: list-item) are numbered by Chrome, and moving or hiding one makes it walk
  // the items after it. When many are moved in some orders (a reversal), or a long run of them is
  // hidden, that walk covers most of the list each time, so the cost grows with the square of the
  // list: sorting 16,000 by moving them took 2.4 s, and a filter hiding a run of 18,000 left 5.1 s
  // of layout after it returned (5,000: about 270 ms and 330 ms). Divs and table rows stay linear,
  // and so does a CSS-order sort, which moves nothing.
  const MAX_LIST_ITEMS_FOR_PAGE_LAYOUT = 5000;
  const REAPPLY_DEBOUNCE_MS_FOR_PAGE_LAYOUT = 300;
  const REAPPLY_WINDOW_MS_FOR_PAGE_LAYOUT = 10000;
  const MAX_REAPPLIES_PER_WINDOW_FOR_PAGE_LAYOUT = 20;
  const PRUNE_INTERVAL_MS_FOR_PAGE_LAYOUT = 2000;
  // Orders written in CSS-order mode sit far below 0, so a child the page appends later (order 0)
  // lands after the sorted block, which is where an infinite list appends, until the next re-sort.
  const ORDER_BASE_FOR_PAGE_LAYOUT = -100000;

  const SKIPPED_TAGS_FOR_PAGE_LAYOUT = {
    SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true, LINK: true, META: true,
    IFRAME: true, svg: true, SVG: true, CANVAS: true, VIDEO: true, AUDIO: true
  };
  // Classes that mark a state or a position rather than what an element is. Zebra rows (tr.odd,
  // tr.even) would otherwise split one table into two collections.
  const STATE_CLASS_PATTERN_FOR_PAGE_LAYOUT = /^(?:is-|has-)?(?:active|selected|hover(?:ed)?|focus(?:ed)?|open(?:ed)?|visible|hidden|current|expanded|collapsed|loading|loaded|disabled|checked|watched|animat\w*|odd|even|first|last|alternate)$/i;
  const LANDMARK_KIND_BY_TAG_FOR_PAGE_LAYOUT = { HEADER: 'header', NAV: 'navigation', ASIDE: 'sidebar', FOOTER: 'footer', MAIN: 'main' };
  const LANDMARK_KIND_BY_ROLE_FOR_PAGE_LAYOUT = {
    banner: 'header', navigation: 'navigation', complementary: 'sidebar', contentinfo: 'footer',
    main: 'main', search: 'search', dialog: 'dialog', alertdialog: 'dialog', region: 'section'
  };
  const REGION_KIND_PRIORITY_FOR_PAGE_LAYOUT = { fixed: 0, landmark: 1, sidebar: 2, block: 3 };

  // Latest scan only. Ids refer to it and are rebuilt from 1 on every scan.
  const scanStateForPageLayout = { regions: new Map(), collections: new Map(), scannedAt: 0 };
  const changesForPageLayout = [];
  let nextChangeNumberForPageLayout = 1;
  const bindingsForPageLayout = [];
  // Element -> Map(prop -> { originalValue, originalPriority, layers: [{ changeId, value }] })
  const ledgerForPageLayout = new Map();
  // changeId -> Set(Element) touched by that change, so an undo visits only its own elements.
  const ledgerElementsByChangeForPageLayout = new Map();
  // Last field texts read while an item was visible. A filter hides items with display:none, and a
  // hidden item's text leaves have no layout box, so re-reading them would find every field empty
  // and the filter would un-hide the item on the next pass and hide it again on the one after.
  const leafSnapshotCacheForPageLayout = new WeakMap();
  let chipForPageLayout = null;
  let pruneTimerForPageLayout = null;
  // The chat panel registers here to hear when the set of changes on this page changes.
  const listenersForPageLayout = new Set();
  // Set when the user closes the on-page bar. It stays closed until the page reloads, and the chat
  // keeps the same controls.
  let chipDismissedForPageLayout = false;
  // Names this page load in the records the tool leaves for the chat, so an undo recorded after a
  // navigation (change ids restart from L1) is never matched to an apply from before it.
  const sessionIdForPageLayout = Math.random().toString(36).slice(2, 10);

  function getRulesForPageLayout() {
    return (globalScopeForPageLayout.ABChatContent || {}).pageLayoutRules || null;
  }

  function isStaleForPageLayout() {
    if (((typeof window !== 'undefined' && window.abchatListenerGeneration) || 0) !== capturedGenerationForPageLayout) {
      return true;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) return true;
    } catch (eStaleForPageLayout) {
      return true;
    }
    return false;
  }

  function normalizeForPageLayout(textForNormalize) {
    return String(textForNormalize == null ? '' : textForNormalize).replace(/\s+/g, ' ').trim();
  }

  function truncateForPageLayout(textForTruncate, maxForTruncate) {
    const rulesForTruncate = getRulesForPageLayout();
    if (rulesForTruncate) return rulesForTruncate.truncateText(textForTruncate, maxForTruncate);
    return normalizeForPageLayout(textForTruncate).slice(0, maxForTruncate);
  }

  function isOwnUiElementForPageLayout(elForOwnUi) {
    const idForOwnUi = elForOwnUi && elForOwnUi.id;
    return typeof idForOwnUi === 'string' && idForOwnUi.indexOf('abchat-') === 0;
  }

  // A BEM modifier (card--featured) marks a variant of the same element, so it is left out while
  // the element has another class to go by.
  function signatureForPageLayout(elForSig) {
    const tagForSig = String(elForSig.tagName || '').toLowerCase();
    const classesForSig = [];
    const modifiersForSig = [];
    const listForSig = elForSig.classList;
    if (listForSig) {
      for (let iForSig = 0; iForSig < listForSig.length && iForSig < 24; iForSig++) {
        const classForSig = listForSig[iForSig];
        if (classForSig.length > 48 || STATE_CLASS_PATTERN_FOR_PAGE_LAYOUT.test(classForSig)) continue;
        if (classForSig.indexOf('--') > 0) modifiersForSig.push(classForSig);
        else classesForSig.push(classForSig);
      }
    }
    const keptForSig = classesForSig.length ? classesForSig : modifiersForSig;
    keptForSig.sort();
    return tagForSig + (keptForSig.length ? '.' + keptForSig.slice(0, 6).join('.') : '');
  }

  function selectorFromSignatureForPageLayout(sigForSelector) {
    const partsForSelector = String(sigForSelector).split('.');
    const tagForSelector = partsForSelector.shift();
    const escapeForSelector = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape
      : function (valueForEscape) { return String(valueForEscape).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); };
    return tagForSelector + partsForSelector.map(function (classForSelector) { return '.' + escapeForSelector(classForSelector); }).join('');
  }

  // One step of a field path. Table cells carry their column position, since every cell in a row
  // has the same signature and the column is what identifies the field.
  function pathStepForPageLayout(elForStep) {
    const sigForStep = signatureForPageLayout(elForStep);
    if (elForStep.tagName === 'TD' || elForStep.tagName === 'TH') return sigForStep + ':' + elForStep.cellIndex;
    return sigForStep;
  }

  // The same step with its classes left out. Two parts that differ only by a class along the way
  // (span.badge-green in one item, span.badge-yellow in the next) share this shape.
  function looseStepForPageLayout(elForLooseStep) {
    const tagForLooseStep = String(elForLooseStep.tagName || '').toLowerCase();
    if (elForLooseStep.tagName === 'TD' || elForLooseStep.tagName === 'TH') return tagForLooseStep + ':' + elForLooseStep.cellIndex;
    return tagForLooseStep;
  }

  function clusterKeyForPageLayout(elForKey) {
    const parentForKey = elForKey.parentElement;
    const grandparentForKey = parentForKey ? parentForKey.parentElement : null;
    return signatureForPageLayout(elForKey)
      + '<' + (parentForKey ? signatureForPageLayout(parentForKey) : '')
      + '<' + (grandparentForKey ? signatureForPageLayout(grandparentForKey) : '');
  }

  function pathSignatureToRootForPageLayout(elForPath, rootForPath) {
    const partsForPath = [];
    let currentForPath = elForPath.parentElement;
    let depthForPath = 0;
    while (currentForPath && currentForPath !== rootForPath && depthForPath < 12) {
      partsForPath.push(signatureForPageLayout(currentForPath));
      currentForPath = currentForPath.parentElement;
      depthForPath++;
    }
    return currentForPath === rootForPath ? partsForPath.join('>') : null;
  }

  // A <tr> made only of <th> cells is a header row. It shares its signature with the data rows, so
  // without this it would be sorted in among them.
  function isHeaderRowForPageLayout(elForHeader) {
    if (!elForHeader || elForHeader.tagName !== 'TR') return false;
    const cellsForHeader = elForHeader.children;
    if (!cellsForHeader.length) return false;
    for (let iForHeader = 0; iForHeader < cellsForHeader.length; iForHeader++) {
      if (cellsForHeader[iForHeader].tagName !== 'TH') return false;
    }
    return true;
  }

  function directTextForPageLayout(elForText) {
    let textForDirect = '';
    const nodesForDirect = elForText.childNodes;
    for (let iForDirect = 0; iForDirect < nodesForDirect.length; iForDirect++) {
      if (nodesForDirect[iForDirect].nodeType === 3) textForDirect += nodesForDirect[iForDirect].nodeValue;
    }
    return normalizeForPageLayout(textForDirect);
  }

  // Not getClientRects: Chrome lays out the inside of a closed <details>, of content-visibility:
  // hidden and of hidden="until-found" when asked, so those report real boxes the user cannot see.
  function isRenderedForPageLayout(elForRendered) {
    return elForRendered.checkVisibility();
  }

  // True when nothing inside the element is painted: it is display: none, or it sits inside a
  // closed <details> or a content-visibility: hidden box. Walks skip such a subtree without
  // measuring it, so it neither uses up the scan budget nor forces a layout. A display: contents
  // element has no box of its own but its children are painted, so it is walked.
  function isHiddenSubtreeForPageLayout(elForHidden) {
    if (elForHidden.checkVisibility()) return false;
    return getComputedStyle(elForHidden).display !== 'contents';
  }

  // The text-bearing elements inside one item, in document order, each tagged with a path that
  // identifies the same part in every other item: the chain of signatures from the item down, plus
  // an occurrence number for repeats of the same chain (two metadata spans side by side become
  // "...span#0" and "...span#1"). Each leaf also carries the class-free shape of that path, which
  // is how the scan recognises one part rendered in variants. Only rendered elements count, so
  // hidden tooltip or overlay text does not shift the numbering between items.
  function collectItemLeavesForPageLayout(itemForLeaves) {
    const leavesForItem = [];
    const occurrenceByPathForItem = new Map();
    const pathByElementForItem = new Map();
    const looseByElementForItem = new Map();
    pathByElementForItem.set(itemForLeaves, '');
    looseByElementForItem.set(itemForLeaves, '');

    function addLeafForItem(elForLeaf, pathForLeaf, looseForLeaf, textForLeaf) {
      if (textForLeaf.length < 2 && !/\d/.test(textForLeaf)) return;
      const occurrenceForLeaf = occurrenceByPathForItem.get(pathForLeaf) || 0;
      occurrenceByPathForItem.set(pathForLeaf, occurrenceForLeaf + 1);
      const timeForLeaf = elForLeaf.closest('time[datetime]');
      leavesForItem.push({
        el: elForLeaf,
        path: pathForLeaf + '#' + occurrenceForLeaf,
        loose: looseForLeaf + '#' + occurrenceForLeaf,
        text: textForLeaf.length > 300 ? textForLeaf.slice(0, 300) : textForLeaf,
        datetime: timeForLeaf && itemForLeaves.contains(timeForLeaf) ? (timeForLeaf.getAttribute('datetime') || '') : ''
      });
    }

    const ownTextForItem = directTextForPageLayout(itemForLeaves);
    if (ownTextForItem && isRenderedForPageLayout(itemForLeaves)) addLeafForItem(itemForLeaves, '', '', ownTextForItem);

    const walkerForItem = document.createTreeWalker(itemForLeaves, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (nodeForAccept) {
        if (SKIPPED_TAGS_FOR_PAGE_LAYOUT[nodeForAccept.tagName]) return NodeFilter.FILTER_REJECT;
        if (isHiddenSubtreeForPageLayout(nodeForAccept)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let visitedForItem = 0;
    let nodeForItem;
    while ((nodeForItem = walkerForItem.nextNode()) && visitedForItem < MAX_LEAF_WALK_PER_ITEM_FOR_PAGE_LAYOUT) {
      visitedForItem++;
      const parentPathForItem = pathByElementForItem.get(nodeForItem.parentElement);
      const pathForNode = (parentPathForItem ? parentPathForItem + '>' : '') + pathStepForPageLayout(nodeForItem);
      pathByElementForItem.set(nodeForItem, pathForNode);
      const parentLooseForItem = looseByElementForItem.get(nodeForItem.parentElement);
      const looseForNode = (parentLooseForItem ? parentLooseForItem + '>' : '') + looseStepForPageLayout(nodeForItem);
      looseByElementForItem.set(nodeForItem, looseForNode);
      const textForNode = directTextForPageLayout(nodeForItem);
      if (!textForNode || !isRenderedForPageLayout(nodeForItem)) continue;
      addLeafForItem(nodeForItem, pathForNode, looseForNode, textForNode);
      if (leavesForItem.length >= MAX_LEAVES_PER_ITEM_FOR_PAGE_LAYOUT) break;
    }
    return leavesForItem;
  }

  function isHiddenByLayoutForPageLayout(elForHidden) {
    const propsForHidden = ledgerForPageLayout.get(elForHidden);
    const displayForHidden = propsForHidden && propsForHidden.get('display');
    if (!displayForHidden || !displayForHidden.layers.length) return false;
    return displayForHidden.layers[displayForHidden.layers.length - 1].value === 'none';
  }

  // Leaves for an item, served from the last visible read while this runtime is the one hiding it.
  function getItemLeavesForPageLayout(itemForGet, passCacheForGet) {
    if (passCacheForGet && passCacheForGet.has(itemForGet)) return passCacheForGet.get(itemForGet);
    let leavesForGet;
    if (isHiddenByLayoutForPageLayout(itemForGet) && leafSnapshotCacheForPageLayout.has(itemForGet)) {
      leavesForGet = leafSnapshotCacheForPageLayout.get(itemForGet);
    } else {
      leavesForGet = collectItemLeavesForPageLayout(itemForGet);
      leafSnapshotCacheForPageLayout.set(itemForGet, leavesForGet);
    }
    if (passCacheForGet) passCacheForGet.set(itemForGet, leavesForGet);
    return leavesForGet;
  }

  // A field is one part of every item. It matches its own paths first (the variants the scan saw),
  // then any leaf of the same shape whose path the scan never saw, so a variant that only turns up
  // in a later item (a third badge colour) is still read. A path the scan saw on a different part is
  // never taken.
  function getFieldForPageLayout(itemForField, fieldForGet, passCacheForField) {
    if (fieldForGet.path === '*') {
      return { el: itemForField, text: truncateForPageLayout(itemForField.textContent, 2000), datetime: '' };
    }
    const leavesForField = getItemLeavesForPageLayout(itemForField, passCacheForField);
    for (let iForField = 0; iForField < leavesForField.length; iForField++) {
      if (fieldForGet.paths.has(leavesForField[iForField].path)) return leavesForField[iForField];
    }
    for (let iForShape = 0; iForShape < leavesForField.length; iForShape++) {
      const leafForShape = leavesForField[iForShape];
      if (leafForShape.loose === fieldForGet.loose && !fieldForGet.otherPaths.has(leafForShape.path)) return leafForShape;
    }
    return { el: null, text: '', datetime: '' };
  }

  function accessibleLabelForPageLayout(elForLabel) {
    const ariaForLabel = normalizeForPageLayout(elForLabel.getAttribute('aria-label'));
    if (ariaForLabel) return ariaForLabel;
    const labelledByForLabel = normalizeForPageLayout(elForLabel.getAttribute('aria-labelledby'));
    if (labelledByForLabel) {
      const textsForLabel = labelledByForLabel.split(' ').map(function (idForLabel) {
        const refForLabel = document.getElementById(idForLabel);
        return refForLabel ? normalizeForPageLayout(refForLabel.textContent) : '';
      }).filter(Boolean);
      if (textsForLabel.length) return textsForLabel.join(' ');
    }
    return '';
  }

  function isMeaningfulIdForPageLayout(idForMeaningful) {
    if (!idForMeaningful || idForMeaningful.length < 2 || idForMeaningful.length > 40) return false;
    if (idForMeaningful.indexOf('abchat-') === 0) return false;
    if (/\d{3,}/.test(idForMeaningful) || /^[a-f0-9-]{8,}$/i.test(idForMeaningful) || /^[:_]/.test(idForMeaningful)) return false;
    return true;
  }

  const HEADING_SELECTOR_FOR_PAGE_LAYOUT = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

  function isHeadingElementForPageLayout(elForHeading) {
    return /^H[1-6]$/.test(elForHeading.tagName) || elForHeading.getAttribute('role') === 'heading';
  }

  // The heading that titles an element: its immediately preceding rendered sibling when that is a
  // heading (or a short title wrapper holding one), climbing up to maxLevels ancestors. The climb
  // stops at a landmark, section or article so a list never borrows the title of a different part
  // of the page. Nearest-heading-anywhere was wrong: an untitled list took the heading of the
  // table above it, and a grid of cards took the first card's title. A title wrapper holds one
  // heading and is shorter than a titled section (100 px, the height a section region needs), so
  // a grid of cards before the list (several headings) and a welcome banner (one heading, but a
  // block of its own) do not lend their titles to it.
  function precedingHeadingTextForPageLayout(startForHeading, maxLevelsForHeading) {
    let levelForHeading = startForHeading;
    for (let depthForHeading = 0; depthForHeading < maxLevelsForHeading && levelForHeading; depthForHeading++) {
      if (levelForHeading === document.body || levelForHeading === document.documentElement) break;
      if (depthForHeading > 0 && (landmarkKindForPageLayout(levelForHeading) || levelForHeading.tagName === 'SECTION' || levelForHeading.tagName === 'ARTICLE')) break;
      let previousForHeading = levelForHeading.previousElementSibling;
      while (previousForHeading && (SKIPPED_TAGS_FOR_PAGE_LAYOUT[previousForHeading.tagName] || !isRenderedForPageLayout(previousForHeading))) {
        previousForHeading = previousForHeading.previousElementSibling;
      }
      if (previousForHeading) {
        if (isHeadingElementForPageLayout(previousForHeading)) return normalizeForPageLayout(previousForHeading.textContent);
        const innerHeadingsForPrevious = previousForHeading.querySelectorAll(HEADING_SELECTOR_FOR_PAGE_LAYOUT);
        if (innerHeadingsForPrevious.length === 1
            && normalizeForPageLayout(previousForHeading.textContent).length <= 120
            && previousForHeading.getBoundingClientRect().height < 100) {
          return normalizeForPageLayout(innerHeadingsForPrevious[0].textContent);
        }
      }
      levelForHeading = levelForHeading.parentElement;
    }
    return '';
  }

  function regionLabelForPageLayout(elForRegionLabel) {
    const ariaForRegion = accessibleLabelForPageLayout(elForRegionLabel);
    if (ariaForRegion) return truncateForPageLayout(ariaForRegion, 60);
    const firstChildForRegion = elForRegionLabel.firstElementChild;
    if (firstChildForRegion && isHeadingElementForPageLayout(firstChildForRegion)) {
      const ownTitleForRegion = normalizeForPageLayout(firstChildForRegion.textContent);
      if (ownTitleForRegion) return truncateForPageLayout(ownTitleForRegion, 60);
    }
    // A region whose text opens with its only heading, even one nested in a header row (a card's
    // title bar), is named by that heading rather than by its first 60 characters of text. With
    // more than one heading inside, the first is usually the title of the first item in a list,
    // as in a grid of cards, and does not name the region.
    const headingsForRegionLabel = elForRegionLabel.querySelectorAll(HEADING_SELECTOR_FOR_PAGE_LAYOUT);
    const leadingHeadingForRegion = headingsForRegionLabel.length === 1 ? headingsForRegionLabel[0] : null;
    if (leadingHeadingForRegion) {
      const leadingTitleForRegion = normalizeForPageLayout(leadingHeadingForRegion.textContent);
      if (leadingTitleForRegion && normalizeForPageLayout(elForRegionLabel.textContent).indexOf(leadingTitleForRegion) === 0) {
        return truncateForPageLayout(leadingTitleForRegion, 60);
      }
    }
    const precedingForRegion = precedingHeadingTextForPageLayout(elForRegionLabel, 1);
    if (precedingForRegion) return truncateForPageLayout(precedingForRegion, 60);
    if (isMeaningfulIdForPageLayout(elForRegionLabel.id)) return '#' + elForRegionLabel.id;
    return truncateForPageLayout(elForRegionLabel.textContent, 60);
  }

  // The titled sections of the page: for each heading the scan walked, the largest element around
  // it that holds no other walked heading, stopping below a landmark and the body. That is a card
  // with its title bar, or the column holding it. Users name these parts ("the score breakdown",
  // "the Q&A box"), and they are not landmarks, so without them a request to hide one could only
  // hide the list inside it. A section that sits among two or more alike siblings is an item of a
  // repeated run (a grid of product cards), not a part of the page, and is left out.
  function headingSectionsForPageLayout(headingsForSections) {
    const countByAncestorForSections = new Map();
    headingsForSections.forEach(function (headingForCount) {
      let ancestorForCount = headingForCount.parentElement;
      while (ancestorForCount && ancestorForCount !== document.body && ancestorForCount !== document.documentElement) {
        countByAncestorForSections.set(ancestorForCount, (countByAncestorForSections.get(ancestorForCount) || 0) + 1);
        ancestorForCount = ancestorForCount.parentElement;
      }
    });
    const sectionsForSections = [];
    headingsForSections.forEach(function (headingForSection) {
      let sectionForHeading = null;
      let ancestorForSection = headingForSection.parentElement;
      while (ancestorForSection && countByAncestorForSections.get(ancestorForSection) === 1 && !landmarkKindForPageLayout(ancestorForSection)) {
        sectionForHeading = ancestorForSection;
        ancestorForSection = ancestorForSection.parentElement;
      }
      if (!sectionForHeading || hasAlikeSiblingsForPageLayout(sectionForHeading, 2)) return;
      sectionsForSections.push(sectionForHeading);
    });
    return sectionsForSections;
  }

  // Whether at least minAlikeForSiblings other children of the element's parent share its
  // signature. Reads at most 200 siblings.
  function hasAlikeSiblingsForPageLayout(elForSiblings, minAlikeForSiblings) {
    const parentForSiblings = elForSiblings.parentElement;
    if (!parentForSiblings) return false;
    const sigForSiblings = signatureForPageLayout(elForSiblings);
    let alikeForSiblings = 0;
    const childrenForSiblings = parentForSiblings.children;
    for (let iForSiblings = 0; iForSiblings < childrenForSiblings.length && iForSiblings < 200; iForSiblings++) {
      const siblingForSiblings = childrenForSiblings[iForSiblings];
      if (siblingForSiblings === elForSiblings || signatureForPageLayout(siblingForSiblings) !== sigForSiblings) continue;
      alikeForSiblings++;
      if (alikeForSiblings >= minAlikeForSiblings) return true;
    }
    return false;
  }

  function newTitleCacheForPageLayout() {
    return { headings: new Map(), rendered: new Map(), byParent: new Map() };
  }

  // The title of the part of the page a group of items sits in: the one rendered heading found in
  // the nearest ancestor of the items' parent (the parent included) that holds any heading outside
  // the items. '' when that ancestor holds several, when a landmark or the body comes first, or
  // when nothing turns up within a few levels. Two lists built from the same markup in two titled
  // cards (questions beside upcoming classes) get different titles here, and the scan keeps them
  // apart. Headings inside the items are left out, so a list of articles that each have their own
  // title is still one list. The cache holds each ancestor's headings and each parent's answer, so
  // groups that share ancestors read them once. At most 200 characters, the length a saved change
  // keeps.
  function groupTitleForPageLayout(parentForTitle, itemSigForTitle, cacheForTitle) {
    let byParentForTitle = cacheForTitle.byParent.get(itemSigForTitle);
    if (!byParentForTitle) {
      byParentForTitle = new Map();
      cacheForTitle.byParent.set(itemSigForTitle, byParentForTitle);
    }
    if (byParentForTitle.has(parentForTitle)) return byParentForTitle.get(parentForTitle);
    let titleForGroup = '';
    let ancestorForTitle = parentForTitle;
    for (let levelForTitle = 0; ancestorForTitle && levelForTitle < MAX_TITLE_LEVELS_FOR_PAGE_LAYOUT; levelForTitle++) {
      if (ancestorForTitle === document.body || ancestorForTitle === document.documentElement) break;
      let headingsForAncestor = cacheForTitle.headings.get(ancestorForTitle);
      if (!headingsForAncestor) {
        headingsForAncestor = Array.from(ancestorForTitle.querySelectorAll(HEADING_SELECTOR_FOR_PAGE_LAYOUT));
        cacheForTitle.headings.set(ancestorForTitle, headingsForAncestor);
      }
      let foundForTitle = null;
      let countForTitle = 0;
      for (let iForHeading = 0; iForHeading < headingsForAncestor.length && countForTitle < 2; iForHeading++) {
        const headingForTitle = headingsForAncestor[iForHeading];
        // On the parent's own level a heading may sit beside the items (a card that holds its
        // title and its rows); one inside an item is the item's. Above that level everything
        // inside the parent is inside an item, since the parent held no other heading.
        if (levelForTitle === 0 ? isInsideGroupItemForPageLayout(headingForTitle, parentForTitle, itemSigForTitle) : parentForTitle.contains(headingForTitle)) continue;
        let renderedForTitle = cacheForTitle.rendered.get(headingForTitle);
        if (renderedForTitle === undefined) {
          renderedForTitle = isRenderedForPageLayout(headingForTitle);
          cacheForTitle.rendered.set(headingForTitle, renderedForTitle);
        }
        if (!renderedForTitle) continue;
        foundForTitle = headingForTitle;
        countForTitle++;
      }
      if (countForTitle === 1) {
        titleForGroup = normalizeForPageLayout(foundForTitle.textContent).slice(0, 200);
        break;
      }
      if (countForTitle > 1 || landmarkKindForPageLayout(ancestorForTitle)) break;
      ancestorForTitle = ancestorForTitle.parentElement;
    }
    byParentForTitle.set(parentForTitle, titleForGroup);
    return titleForGroup;
  }

  // Whether a heading inside the parent sits inside one of the group's items: a child of the
  // parent with the items' signature.
  function isInsideGroupItemForPageLayout(headingForInside, parentForInside, itemSigForInside) {
    let childForInside = headingForInside;
    while (childForInside.parentElement && childForInside.parentElement !== parentForInside) childForInside = childForInside.parentElement;
    return childForInside.parentElement === parentForInside && signatureForPageLayout(childForInside) === itemSigForInside;
  }

  // The tags of an item's children in order, which is how the template that drew it shows.
  function childShapeForPageLayout(itemForShape) {
    let shapeForItem = '';
    for (let kidForShape = itemForShape.firstElementChild; kidForShape; kidForShape = kidForShape.nextElementSibling) {
      shapeForItem += kidForShape.tagName + '|';
    }
    return shapeForItem;
  }

  // The child shape most of the first ten items have.
  function commonChildShapeForPageLayout(itemsForCommon) {
    const countByShapeForCommon = new Map();
    let bestForCommon = '';
    let bestCountForCommon = 0;
    itemsForCommon.slice(0, 10).forEach(function (itemForCommon) {
      const shapeForCommon = childShapeForPageLayout(itemForCommon);
      const countForCommon = (countByShapeForCommon.get(shapeForCommon) || 0) + 1;
      countByShapeForCommon.set(shapeForCommon, countForCommon);
      if (countForCommon > bestCountForCommon) {
        bestForCommon = shapeForCommon;
        bestCountForCommon = countForCommon;
      }
    });
    return bestForCommon;
  }

  // Splits a run of alike items by the titled part of the page each group sits in, when the
  // groups under different titles were also drawn differently. Rows of questions (icon, text,
  // badge) and rows of classes (date tile, text) in two cards can share a class-free signature;
  // they are two lists. One list of events split under week headings, every row drawn the same,
  // stays one list and is sorted per group. Returns one piece with no title when it is not split,
  // and otherwise a piece per title, in the order the titles first appear.
  function splitByTitleForPageLayout(itemsForSplit, itemSigForSplit, cacheForSplit) {
    // Items all drawn alike cannot split, and this costs one pass over their children, where the
    // titles cost a heading lookup per parent: a field inside every card has as many parents as
    // there are cards.
    const firstShapeForSplit = childShapeForPageLayout(itemsForSplit[0]);
    if (itemsForSplit.every(function (itemForShape) { return childShapeForPageLayout(itemForShape) === firstShapeForSplit; })) return [{ items: itemsForSplit }];
    const titleOrderForSplit = [];
    const itemsByTitleForSplit = new Map();
    itemsForSplit.forEach(function (itemForSplit) {
      const titleForItem = itemForSplit.parentElement ? groupTitleForPageLayout(itemForSplit.parentElement, itemSigForSplit, cacheForSplit) : '';
      if (!itemsByTitleForSplit.has(titleForItem)) {
        itemsByTitleForSplit.set(titleForItem, []);
        titleOrderForSplit.push(titleForItem);
      }
      itemsByTitleForSplit.get(titleForItem).push(itemForSplit);
    });
    if (titleOrderForSplit.length < 2) return [{ items: itemsForSplit }];
    const shapesForSplit = new Set(titleOrderForSplit.map(function (titleForShape) {
      return commonChildShapeForPageLayout(itemsByTitleForSplit.get(titleForShape));
    }));
    if (shapesForSplit.size < 2) return [{ items: itemsForSplit }];
    return titleOrderForSplit.map(function (titleForPiece) {
      return { items: itemsByTitleForSplit.get(titleForPiece), sectionTitle: titleForPiece };
    });
  }

  function describeWhereForPageLayout(rectForWhere, positionForWhere) {
    const viewportWidthForWhere = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeightForWhere = window.innerHeight;
    const narrowForWhere = rectForWhere.width <= viewportWidthForWhere * 0.4;
    const wideForWhere = rectForWhere.width >= viewportWidthForWhere * 0.5;
    if (positionForWhere === 'fixed' || positionForWhere === 'sticky') {
      if (wideForWhere && rectForWhere.top <= 10) return 'top';
      if (wideForWhere && rectForWhere.bottom >= viewportHeightForWhere - 10) return 'bottom';
      if (narrowForWhere && rectForWhere.left <= 10) return 'left';
      if (narrowForWhere && rectForWhere.right >= viewportWidthForWhere - 10) return 'right';
      return 'floating';
    }
    const docTopForWhere = rectForWhere.top + window.scrollY;
    const docHeightForWhere = Math.max(document.documentElement.scrollHeight, viewportHeightForWhere);
    if (narrowForWhere && rectForWhere.left <= 16) return 'left';
    if (narrowForWhere && rectForWhere.right >= viewportWidthForWhere - 16) return 'right';
    if (wideForWhere && docTopForWhere < 150) return 'top';
    if (wideForWhere && docTopForWhere + rectForWhere.height >= docHeightForWhere - 150) return 'bottom';
    return 'middle';
  }

  function landmarkKindForPageLayout(elForLandmark) {
    const roleForLandmark = normalizeForPageLayout(elForLandmark.getAttribute('role')).toLowerCase();
    if (roleForLandmark && LANDMARK_KIND_BY_ROLE_FOR_PAGE_LAYOUT[roleForLandmark]) {
      if (roleForLandmark === 'region' && !accessibleLabelForPageLayout(elForLandmark)) return '';
      return LANDMARK_KIND_BY_ROLE_FOR_PAGE_LAYOUT[roleForLandmark];
    }
    // A <header> or <footer> inside an article or section is that card's own header, not the
    // page's banner, and listing one per card would crowd the real regions out of the scan.
    if ((elForLandmark.tagName === 'HEADER' || elForLandmark.tagName === 'FOOTER')
        && elForLandmark.parentElement && elForLandmark.parentElement.closest('article,aside,main,nav,section')) {
      return '';
    }
    const tagKindForLandmark = LANDMARK_KIND_BY_TAG_FOR_PAGE_LAYOUT[elForLandmark.tagName];
    if (tagKindForLandmark) return tagKindForLandmark;
    if ((elForLandmark.tagName === 'SECTION' || elForLandmark.tagName === 'FORM') && accessibleLabelForPageLayout(elForLandmark)) return 'section';
    return '';
  }

  function rectsCloseForPageLayout(aForClose, bForClose, toleranceForClose) {
    return Math.abs(aForClose.left - bForClose.left) <= toleranceForClose
      && Math.abs(aForClose.top - bForClose.top) <= toleranceForClose
      && Math.abs(aForClose.right - bForClose.right) <= toleranceForClose
      && Math.abs(aForClose.bottom - bForClose.bottom) <= toleranceForClose;
  }

  // True when at least 80% of innerItems (sampled) sit inside an item of outerItems, at fewer than
  // 1.5 per holding item on average.
  function isOnePerItemForPageLayout(outerItemsForHolder, innerItemsForHolder) {
    const outerSetForHolder = new Set(outerItemsForHolder);
    const sampleForHolder = innerItemsForHolder.slice(0, 40);
    const holdersForHolder = new Set();
    let containedForHolder = 0;
    sampleForHolder.forEach(function (innerForHolder) {
      let ancestorForHolder = innerForHolder.parentElement;
      for (let depthForHolder = 0; ancestorForHolder && depthForHolder < 15; depthForHolder++) {
        if (outerSetForHolder.has(ancestorForHolder)) {
          containedForHolder++;
          holdersForHolder.add(ancestorForHolder);
          return;
        }
        ancestorForHolder = ancestorForHolder.parentElement;
      }
    });
    if (!sampleForHolder.length || containedForHolder < sampleForHolder.length * 0.8) return false;
    return containedForHolder / holdersForHolder.size < 1.5;
  }

  // True when innerItems are the parts of outerItems rather than a list inside each of them: each
  // holding item has the same few (2 to 4), and a part's position decides what it is (the first is
  // always the title line, the second always the date line). The members of a real nested list,
  // such as cards in a row, are interchangeable, so every position has the same shape.
  function isPartsOfItemsForPageLayout(outerItemsForParts, innerItemsForParts, leafCacheForParts, rulesForParts) {
    const outerSetForParts = new Set(outerItemsForParts);
    const membersByHolderForParts = new Map();
    const sampleForParts = innerItemsForParts.slice(0, 80);
    let containedForParts = 0;
    sampleForParts.forEach(function (innerForParts) {
      let ancestorForParts = innerForParts.parentElement;
      for (let depthForParts = 0; ancestorForParts && depthForParts < 15; depthForParts++) {
        if (outerSetForParts.has(ancestorForParts)) {
          containedForParts++;
          if (!membersByHolderForParts.has(ancestorForParts)) membersByHolderForParts.set(ancestorForParts, []);
          membersByHolderForParts.get(ancestorForParts).push(innerForParts);
          return;
        }
        ancestorForParts = ancestorForParts.parentElement;
      }
    });
    if (!sampleForParts.length || containedForParts < sampleForParts.length * 0.8) return false;
    const groupsForParts = Array.from(membersByHolderForParts.values());
    // The sample can cut the last holder's members short.
    if (innerItemsForParts.length > sampleForParts.length) groupsForParts.pop();
    if (groupsForParts.length < 2) return false;
    const perHolderForParts = groupsForParts[0].length;
    if (perHolderForParts < 2 || perHolderForParts > 4) return false;
    if (!groupsForParts.every(function (groupForCount) { return groupForCount.length === perHolderForParts; })) return false;
    const majorityShapesForParts = new Set();
    for (let positionForParts = 0; positionForParts < perHolderForParts; positionForParts++) {
      const countByShapeForParts = new Map();
      groupsForParts.slice(0, 20).forEach(function (groupForShape) {
        const shapeForParts = getItemLeavesForPageLayout(groupForShape[positionForParts], leafCacheForParts).map(function (leafForShape) {
          return leafForShape.path + ':' + rulesForParts.detectKind(leafForShape.text);
        }).join('|');
        countByShapeForParts.set(shapeForParts, (countByShapeForParts.get(shapeForParts) || 0) + 1);
      });
      let bestShapeForParts = '';
      let bestCountForParts = 0;
      countByShapeForParts.forEach(function (countForShape, shapeForBest) {
        if (countForShape > bestCountForParts) {
          bestShapeForParts = shapeForBest;
          bestCountForParts = countForShape;
        }
      });
      majorityShapesForParts.add(bestShapeForParts);
    }
    return majorityShapesForParts.size > 1;
  }

  function lowestCommonAncestorForPageLayout(itemsForAncestor) {
    let ancestorForLca = itemsForAncestor[0].parentElement;
    for (let iForLca = 1; iForLca < itemsForAncestor.length && ancestorForLca; iForLca++) {
      while (ancestorForLca && !ancestorForLca.contains(itemsForAncestor[iForLca])) ancestorForLca = ancestorForLca.parentElement;
    }
    return ancestorForLca;
  }

  // Two levels above the items' common ancestor, so a later section appended beside the first one
  // (a search page's next page of results) is watched too. Only items whose ancestor chain up to
  // this root matches one seen at scan time are accepted, which keeps a different list that happens
  // to reuse the same card component out of the collection.
  function watchRootForPageLayout(ancestorForWatch) {
    let rootForWatch = ancestorForWatch;
    for (let iForWatch = 0; iForWatch < 2; iForWatch++) {
      const parentForWatch = rootForWatch.parentElement;
      if (!parentForWatch || parentForWatch === document.body || parentForWatch === document.documentElement) break;
      rootForWatch = parentForWatch;
    }
    return rootForWatch;
  }

  function collectionLabelForPageLayout(ancestorForCollectionLabel, firstItemForCollectionLabel) {
    const ariaForCollection = accessibleLabelForPageLayout(ancestorForCollectionLabel);
    if (ariaForCollection) return truncateForPageLayout(ariaForCollection, 60);
    // A container that carries its own title ahead of the items (<section><h2>..</h2><div>items).
    // The scan stops at the first heading that is not before the first item, so a heading inside
    // an item is never taken.
    const innerHeadingsForCollection = ancestorForCollectionLabel.querySelectorAll(HEADING_SELECTOR_FOR_PAGE_LAYOUT);
    let innerTitleForCollection = null;
    for (let iForHeading = 0; iForHeading < innerHeadingsForCollection.length; iForHeading++) {
      const headingForCollection = innerHeadingsForCollection[iForHeading];
      if (!(headingForCollection.compareDocumentPosition(firstItemForCollectionLabel) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      if (firstItemForCollectionLabel.contains(headingForCollection)) break;
      innerTitleForCollection = headingForCollection;
    }
    if (innerTitleForCollection) {
      const innerTextForCollection = normalizeForPageLayout(innerTitleForCollection.textContent);
      if (innerTextForCollection) return truncateForPageLayout(innerTextForCollection, 60);
    }
    return truncateForPageLayout(precedingHeadingTextForPageLayout(ancestorForCollectionLabel, 3), 60);
  }

  // ---------------------------------------------------------------- scan

  function buildCollectionDescriptorForPageLayout(candidateForDescriptor, idForDescriptor, rulesForDescriptor, leafCacheForDescriptor) {
    const itemsForDescriptor = candidateForDescriptor.items;
    // Fields come from the richest of the first few items, so one sparse or atypical first item
    // (a promoted card, a live stream with no duration) does not hide a field the rest carry.
    let templateLeavesForDescriptor = [];
    let templateItemForDescriptor = itemsForDescriptor[0];
    itemsForDescriptor.slice(0, 5).forEach(function (itemForTemplate) {
      const leavesForTemplate = getItemLeavesForPageLayout(itemForTemplate, leafCacheForDescriptor);
      if (leavesForTemplate.length > templateLeavesForDescriptor.length) {
        templateLeavesForDescriptor = leavesForTemplate;
        templateItemForDescriptor = itemForTemplate;
      }
    });
    const sampleItemsForDescriptor = itemsForDescriptor.slice(0, KIND_SAMPLE_ITEMS_FOR_PAGE_LAYOUT);
    const itemsByPathForDescriptor = new Map();
    const looseByPathForDescriptor = new Map();
    sampleItemsForDescriptor.forEach(function (itemForPaths, indexForPaths) {
      getItemLeavesForPageLayout(itemForPaths, leafCacheForDescriptor).forEach(function (leafForPaths) {
        if (!itemsByPathForDescriptor.has(leafForPaths.path)) {
          itemsByPathForDescriptor.set(leafForPaths.path, new Set());
          looseByPathForDescriptor.set(leafForPaths.path, leafForPaths.loose);
        }
        itemsByPathForDescriptor.get(leafForPaths.path).add(indexForPaths);
      });
    });
    // One part can be rendered in variants whose class names differ (a status badge coloured by
    // status), which gives it a different path in different items. A path of the same shape as a
    // field's that never shares an item with it is that field in another variant, so it joins the
    // field. Paths that do share an item are separate parts.
    const templatePathsForDescriptor = new Set(templateLeavesForDescriptor.map(function (leafForTemplatePath) { return leafForTemplatePath.path; }));
    const groupsForDescriptor = templateLeavesForDescriptor.slice(0, MAX_FIELDS_FOR_PAGE_LAYOUT).map(function (leafForGroup) {
      return {
        path: leafForGroup.path,
        loose: leafForGroup.loose,
        paths: new Set([leafForGroup.path]),
        items: new Set(itemsByPathForDescriptor.get(leafForGroup.path) || [])
      };
    });
    Array.from(itemsByPathForDescriptor.keys()).filter(function (pathForVariant) {
      return !templatePathsForDescriptor.has(pathForVariant);
    }).sort(function (aForVariant, bForVariant) {
      return itemsByPathForDescriptor.get(bForVariant).size - itemsByPathForDescriptor.get(aForVariant).size;
    }).forEach(function (pathForVariant) {
      const looseForVariant = looseByPathForDescriptor.get(pathForVariant);
      const itemsForVariant = itemsByPathForDescriptor.get(pathForVariant);
      const groupForVariant = groupsForDescriptor.find(function (groupForMatch) {
        if (groupForMatch.loose !== looseForVariant) return false;
        for (const indexForOverlap of itemsForVariant) {
          if (groupForMatch.items.has(indexForOverlap)) return false;
        }
        return true;
      });
      if (!groupForVariant) return;
      groupForVariant.paths.add(pathForVariant);
      itemsForVariant.forEach(function (indexForJoin) { groupForVariant.items.add(indexForJoin); });
    });
    const fieldsForDescriptor = groupsForDescriptor.map(function (groupForField, indexForField) {
      const otherPathsForField = new Set();
      looseByPathForDescriptor.forEach(function (looseForOther, pathForOther) {
        if (looseForOther === groupForField.loose && !groupForField.paths.has(pathForOther)) otherPathsForField.add(pathForOther);
      });
      const fieldForDescriptor = {
        id: rulesForDescriptor.fieldIdForIndex(indexForField),
        path: groupForField.path,
        paths: groupForField.paths,
        loose: groupForField.loose,
        otherPaths: otherPathsForField
      };
      const textsForKind = [];
      const countByTextForField = new Map();
      let templateTextForField = '';
      sampleItemsForDescriptor.forEach(function (itemForKind) {
        const textForKind = getFieldForPageLayout(itemForKind, fieldForDescriptor, leafCacheForDescriptor).text;
        if (!textForKind) return;
        textsForKind.push(textForKind);
        countByTextForField.set(textForKind, (countByTextForField.get(textForKind) || 0) + 1);
        if (itemForKind === templateItemForDescriptor) templateTextForField = textForKind;
      });
      fieldForDescriptor.kind = rulesForDescriptor.chooseKindForValues(textsForKind);
      // A field with a few values that repeat (a status, a category) lists them all, so a filter can
      // name a value that the first items do not happen to show.
      const distinctForField = Array.from(countByTextForField.keys());
      const isCategoryForField = textsForKind.length >= 3
        && distinctForField.length <= MAX_LISTED_VALUES_FOR_PAGE_LAYOUT
        && distinctForField.length < textsForKind.length
        && distinctForField.every(function (valueForLength) { return valueForLength.length <= 40; });
      if (isCategoryForField) {
        fieldForDescriptor.values = distinctForField.sort(function (aForCount, bForCount) {
          return countByTextForField.get(bForCount) - countByTextForField.get(aForCount);
        });
      } else {
        const firstExampleForField = templateTextForField || distinctForField[0] || '';
        const secondExampleForField = distinctForField.find(function (textForSecond) { return textForSecond !== firstExampleForField; });
        fieldForDescriptor.examples = [firstExampleForField, secondExampleForField].filter(Boolean).map(function (exampleForField) {
          return truncateForPageLayout(exampleForField, 50);
        });
      }
      return fieldForDescriptor;
    });
    const pathSigsForDescriptor = new Set();
    const watchRootForDescriptor = watchRootForPageLayout(candidateForDescriptor.lca);
    itemsForDescriptor.forEach(function (itemForPathSig) {
      const pathSigForItem = pathSignatureToRootForPageLayout(itemForPathSig, watchRootForDescriptor);
      if (pathSigForItem !== null) pathSigsForDescriptor.add(pathSigForItem);
    });
    const itemSigForDescriptor = signatureForPageLayout(itemsForDescriptor[0]);
    // Set only for a list the scan split from alike items under another title. Its items are then
    // only the ones under this title, and the title is what names it.
    const sectionTitleForDescriptor = typeof candidateForDescriptor.sectionTitle === 'string' ? candidateForDescriptor.sectionTitle : undefined;
    return {
      id: idForDescriptor,
      clusterKey: candidateForDescriptor.clusterKey || clusterKeyForPageLayout(itemsForDescriptor[0]),
      itemSig: itemSigForDescriptor,
      itemSelector: selectorFromSignatureForPageLayout(itemSigForDescriptor),
      sectionTitle: sectionTitleForDescriptor,
      lca: candidateForDescriptor.lca,
      watchRoot: watchRootForDescriptor,
      pathSigs: pathSigsForDescriptor,
      pathSigsKey: Array.from(pathSigsForDescriptor).sort().join('|'),
      label: sectionTitleForDescriptor
        ? truncateForPageLayout(sectionTitleForDescriptor, 60)
        : collectionLabelForPageLayout(candidateForDescriptor.lca, itemsForDescriptor[0]),
      count: itemsForDescriptor.length,
      fields: fieldsForDescriptor
    };
  }

  // Where a cut-off walk stopped, for the model. Only a page that scrolls as a whole gives a useful
  // position: in an app whose content scrolls inside a panel, the document is one screen tall.
  function truncatedScanNoteForPageLayout(stopYForNote, docHeightForNote, viewportHeightForNote) {
    let whereForNote = 'partway through the page';
    if (docHeightForNote > viewportHeightForNote * 1.5 && stopYForNote >= 0 && stopYForNote < docHeightForNote) {
      const percentForNote = Math.round(100 * stopYForNote / docHeightForNote);
      whereForNote = percentForNote < 5 ? 'near the top of the page' : 'about ' + percentForNote + '% of the way down the page';
    }
    return 'The page is too large to scan in full, so the scan stopped ' + whereForNote + '. Regions and lists past'
      + ' that point are not listed here. If the user asks about one of them, tell them the scan did not reach that'
      + ' part of the page.';
  }

  // Decides, for each element the scan walk reaches, whether it is a later copy in a long run of
  // alike siblings that can be skipped with its subtree. The scan only needs a sample of a list to
  // name it and its fields, and sort and filter query the list's container again for every item,
  // so walking thousands of identical rows only uses up the element budget that the sidebar and
  // footer after them need.
  //
  // Under a parent with more than 50 children, siblings are grouped by tag and exact class string,
  // so a heading or an ad among cards is its own group and is always walked. A group's first 45
  // members are walked, and so are the parent's last 5 children (a totals row). A later member is
  // skipped only when its direct children, in order, match the sequence most of the first 45 had:
  // a middle section that holds a table where its siblings hold a paragraph is walked. What is
  // still missed is a one-off nested deeper inside a middle copy.
  //
  // Children reach the walker's filter once each in document order, so the counting is lazy and
  // costs the same for every child. Chrome counts a parent's children on every childElementCount
  // call, so the per-parent state is looked up first and the count read once.
  function createRepeatTrackerForPageLayout() {
    const stateByParentForRepeat = new Map();
    const parentsWithSkipsForRepeat = new Set();
    const trackerForRepeat = { skipped: 0, exhausted: false, stopTop: 0 };

    function shapeForRepeat(elForShape) {
      let shapeForElement = '';
      for (let kidForShape = elForShape.firstElementChild; kidForShape; kidForShape = kidForShape.nextElementSibling) {
        shapeForElement += kidForShape.tagName + '.' + (kidForShape.getAttribute('class') || '') + '|';
      }
      return shapeForElement;
    }

    trackerForRepeat.shouldSkip = function (nodeForRepeat) {
      const parentForRepeat = nodeForRepeat.parentElement;
      if (!parentForRepeat) return false;
      let stateForParent = stateByParentForRepeat.get(parentForRepeat);
      if (stateForParent === undefined) {
        const childCountForParent = parentForRepeat.children.length;
        stateForParent = childCountForParent > REPEAT_MIN_SIBLINGS_FOR_PAGE_LAYOUT
          ? { total: childCountForParent, position: 0, groups: new Map() }
          : null;
        stateByParentForRepeat.set(parentForRepeat, stateForParent);
      }
      if (!stateForParent) return false;
      const positionForRepeat = stateForParent.position++;
      const keyForRepeat = nodeForRepeat.tagName + ' ' + (nodeForRepeat.getAttribute('class') || '');
      let groupForRepeat = stateForParent.groups.get(keyForRepeat);
      if (!groupForRepeat) {
        // shape stays undefined until the group's head is complete, then holds the common shape
        // or null when no shape reached the quorum. A text-only row's shape is the empty string.
        groupForRepeat = { sig: signatureForPageLayout(nodeForRepeat), seen: 0, shapes: new Map(), shape: undefined, skipped: 0 };
        stateForParent.groups.set(keyForRepeat, groupForRepeat);
      }
      const ordinalForRepeat = groupForRepeat.seen++;
      if (ordinalForRepeat < REPEAT_HEAD_FOR_PAGE_LAYOUT) {
        const headShapeForRepeat = shapeForRepeat(nodeForRepeat);
        groupForRepeat.shapes.set(headShapeForRepeat, (groupForRepeat.shapes.get(headShapeForRepeat) || 0) + 1);
        if (ordinalForRepeat === REPEAT_HEAD_FOR_PAGE_LAYOUT - 1) {
          let commonShapeForRepeat = null;
          let commonCountForRepeat = 0;
          groupForRepeat.shapes.forEach(function (countForShape, shapeForCount) {
            if (countForShape > commonCountForRepeat) {
              commonShapeForRepeat = shapeForCount;
              commonCountForRepeat = countForShape;
            }
          });
          groupForRepeat.shape = commonCountForRepeat >= REPEAT_SHAPE_QUORUM_FOR_PAGE_LAYOUT ? commonShapeForRepeat : null;
          groupForRepeat.shapes = null;
        }
        return false;
      }
      if (groupForRepeat.shape === null || positionForRepeat >= stateForParent.total - REPEAT_TAIL_FOR_PAGE_LAYOUT) return false;
      if (shapeForRepeat(nodeForRepeat) !== groupForRepeat.shape) return false;
      groupForRepeat.skipped++;
      trackerForRepeat.skipped++;
      parentsWithSkipsForRepeat.add(parentForRepeat);
      if (trackerForRepeat.skipped >= MAX_SKIPPED_REPEATS_FOR_PAGE_LAYOUT) {
        trackerForRepeat.exhausted = true;
        trackerForRepeat.stopTop = nodeForRepeat.getBoundingClientRect().top;
      }
      return true;
    };

    // How many siblings alike to these items were skipped, summed over the items' parents.
    trackerForRepeat.skippedFor = function (itemsForSkipped) {
      if (!trackerForRepeat.skipped || !itemsForSkipped.length) return 0;
      const sigForSkipped = signatureForPageLayout(itemsForSkipped[0]);
      const parentsSeenForSkipped = new Set();
      let totalForSkipped = 0;
      itemsForSkipped.forEach(function (itemForSkipped) {
        const parentForSkipped = itemForSkipped.parentElement;
        if (!parentForSkipped || parentsSeenForSkipped.has(parentForSkipped)) return;
        parentsSeenForSkipped.add(parentForSkipped);
        const stateForSkipped = stateByParentForRepeat.get(parentForSkipped);
        if (!stateForSkipped) return;
        stateForSkipped.groups.forEach(function (groupForSkipped) {
          if (groupForSkipped.skipped && groupForSkipped.sig === sigForSkipped) totalForSkipped += groupForSkipped.skipped;
        });
      });
      return totalForSkipped;
    };

    // True when siblings were skipped somewhere inside rootForWithin (or under it directly), so a
    // list there may have members the walk never reached.
    trackerForRepeat.skippedWithin = function (rootForWithin) {
      for (const parentForWithin of parentsWithSkipsForRepeat) {
        if (rootForWithin.contains(parentForWithin)) return true;
      }
      return false;
    };

    return trackerForRepeat;
  }

  function runScanForPageLayout() {
    const rulesForScan = getRulesForPageLayout();
    if (!rulesForScan) return { ok: false, error: 'The page layout rules are not loaded in this tab.' };
    const rootForScan = document.body || document.documentElement;
    if (!rootForScan) return { ok: false, error: 'This page has no document body to scan.' };

    const clustersForScan = new Map();
    const rectByElementForScan = new Map();
    const regionCandidatesForScan = [];
    const headingsForScan = [];
    const viewportWidthForScan = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeightForScan = window.innerHeight;
    const docWidthForScan = Math.max(document.documentElement.scrollWidth, viewportWidthForScan);
    const docHeightForScan = Math.max(document.documentElement.scrollHeight, viewportHeightForScan);

    const repeatsForScan = createRepeatTrackerForPageLayout();
    const walkerForScan = document.createTreeWalker(rootForScan, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (nodeForScanAccept) {
        // Hands the next node straight back, so the loop sees the skip budget is spent and stops
        // instead of the walker filtering the rest of a huge list one sibling at a time.
        if (repeatsForScan.exhausted) return NodeFilter.FILTER_ACCEPT;
        if (isOwnUiElementForPageLayout(nodeForScanAccept)) return NodeFilter.FILTER_REJECT;
        if (repeatsForScan.shouldSkip(nodeForScanAccept)) return NodeFilter.FILTER_REJECT;
        if (SKIPPED_TAGS_FOR_PAGE_LAYOUT[nodeForScanAccept.tagName]) return NodeFilter.FILTER_REJECT;
        // Rejected before the budget check below, so a hidden mega-menu costs nothing.
        if (isHiddenSubtreeForPageLayout(nodeForScanAccept)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let visitedForScan = 0;
    let nodeForScan;
    let truncatedForScan = false;
    let lastTopForScan = 0;
    while ((nodeForScan = walkerForScan.nextNode())) {
      if (repeatsForScan.exhausted) {
        truncatedForScan = true;
        lastTopForScan = repeatsForScan.stopTop;
        break;
      }
      if (visitedForScan >= MAX_SCAN_ELEMENTS_FOR_PAGE_LAYOUT) { truncatedForScan = true; break; }
      visitedForScan++;
      const rectForScan = nodeForScan.getBoundingClientRect();
      // A zero-size element can still have visible children (display: contents wrappers), so it
      // is skipped as a candidate but its subtree is still walked.
      if (rectForScan.width < 1 || rectForScan.height < 1) continue;
      rectByElementForScan.set(nodeForScan, rectForScan);
      lastTopForScan = rectForScan.top;
      if (headingsForScan.length < MAX_SECTION_HEADINGS_FOR_PAGE_LAYOUT && isHeadingElementForPageLayout(nodeForScan)) headingsForScan.push(nodeForScan);
      // Table cells are fields of a row, never items of their own.
      const isCellForScan = nodeForScan.tagName === 'TD' || nodeForScan.tagName === 'TH';
      if (rectForScan.width >= 40 && rectForScan.height >= 16 && !isCellForScan && !isHeaderRowForPageLayout(nodeForScan)) {
        const keyForCluster = clusterKeyForPageLayout(nodeForScan);
        let bucketForCluster = clustersForScan.get(keyForCluster);
        if (!bucketForCluster) {
          bucketForCluster = [];
          clustersForScan.set(keyForCluster, bucketForCluster);
        }
        bucketForCluster.push(nodeForScan);
      }
      const areaForScan = rectForScan.width * rectForScan.height;
      const landmarkForScan = rectForScan.width >= 100 && rectForScan.height >= 24 ? landmarkKindForPageLayout(nodeForScan) : '';
      if (!landmarkForScan && areaForScan < 3000) continue;
      const positionForScan = getComputedStyle(nodeForScan).position;
      const pinnedForScan = positionForScan === 'fixed' || positionForScan === 'sticky' ? positionForScan : '';
      if (landmarkForScan) {
        regionCandidatesForScan.push({ el: nodeForScan, rect: rectForScan, kind: landmarkForScan, group: pinnedForScan ? 'fixed' : 'landmark', position: pinnedForScan });
        continue;
      }
      if (pinnedForScan) {
        regionCandidatesForScan.push({ el: nodeForScan, rect: rectForScan, kind: 'pinned', group: 'fixed', position: pinnedForScan });
        continue;
      }
      if (rectForScan.width < 160 || rectForScan.height < 100) continue;
      const nearFullPageForScan = rectForScan.width >= docWidthForScan * 0.95 && rectForScan.height >= docHeightForScan * 0.8;
      if (nearFullPageForScan) continue;
      const sidebarLikeForScan = rectForScan.height >= viewportHeightForScan * 0.6
        && rectForScan.width >= 120 && rectForScan.width <= viewportWidthForScan * 0.4
        && (rectForScan.left <= 16 || rectForScan.right >= viewportWidthForScan - 16);
      if (sidebarLikeForScan) {
        regionCandidatesForScan.push({ el: nodeForScan, rect: rectForScan, kind: 'sidebar', group: 'sidebar', position: '' });
      } else if (isMeaningfulIdForPageLayout(nodeForScan.id)) {
        regionCandidatesForScan.push({ el: nodeForScan, rect: rectForScan, kind: 'section', group: 'block', position: '' });
      }
    }

    headingSectionsForPageLayout(headingsForScan).forEach(function (sectionForScan) {
      const rectForSection = rectByElementForScan.get(sectionForScan);
      if (!rectForSection || rectForSection.width < 160 || rectForSection.height < 100) return;
      if (rectForSection.width >= docWidthForScan * 0.95 && rectForSection.height >= docHeightForScan * 0.8) return;
      regionCandidatesForScan.push({ el: sectionForScan, rect: rectForSection, kind: 'section', group: 'block', position: '' });
    });

    // Collections.
    const candidateFromItemsForScan = function (itemsForCandidate, clusterKeyForCandidate, sectionTitleForCandidate) {
      if (itemsForCandidate.length < MIN_COLLECTION_ITEMS_FOR_PAGE_LAYOUT) return null;
      const probeForCluster = itemsForCandidate.slice(0, 5);
      const withTextForCluster = probeForCluster.filter(function (itemForProbe) {
        return normalizeForPageLayout(itemForProbe.textContent).length >= 2;
      }).length;
      if (withTextForCluster < Math.ceil(probeForCluster.length / 2)) return null;
      const areasForCluster = itemsForCandidate.slice(0, 15).map(function (itemForArea) {
        const rectForArea = rectByElementForScan.get(itemForArea);
        return rectForArea ? rectForArea.width * rectForArea.height : 0;
      }).sort(function (aForArea, bForArea) { return aForArea - bForArea; });
      const medianAreaForCluster = areasForCluster[Math.floor(areasForCluster.length / 2)] || 0;
      const lcaForCluster = lowestCommonAncestorForPageLayout(itemsForCandidate);
      if (!lcaForCluster) return null;
      const skippedForCluster = repeatsForScan.skippedFor(itemsForCandidate);
      return {
        items: itemsForCandidate,
        skipped: skippedForCluster,
        lca: lcaForCluster,
        clusterKey: clusterKeyForCandidate,
        sectionTitle: sectionTitleForCandidate,
        score: Math.log2(1 + itemsForCandidate.length + skippedForCluster) * Math.sqrt(medianAreaForCluster)
      };
    };
    const unsplitCandidatesForScan = [];
    clustersForScan.forEach(function (membersForCluster, clusterKeyForCandidate) {
      if (membersForCluster.length < MIN_COLLECTION_ITEMS_FOR_PAGE_LAYOUT) return;
      const outerForCluster = [];
      let lastOuterForCluster = null;
      membersForCluster.forEach(function (memberForOuter) {
        if (lastOuterForCluster && lastOuterForCluster.contains(memberForOuter)) return;
        outerForCluster.push(memberForOuter);
        lastOuterForCluster = memberForOuter;
      });
      const candidateForCluster = candidateFromItemsForScan(outerForCluster, clusterKeyForCandidate, undefined);
      if (candidateForCluster) unsplitCandidatesForScan.push(candidateForCluster);
    });
    unsplitCandidatesForScan.sort(function (aForRank, bForRank) { return bForRank.score - aForRank.score; });
    // Alike items under different titles, drawn differently (two cards whose rows share a
    // class-free signature), are separate lists, so each leading cluster is split by the title of
    // the part of the page it sits in. Only the clusters that can still make the list are split,
    // which bounds the heading lookups.
    const titleCacheForScan = newTitleCacheForPageLayout();
    const collectionCandidatesForScan = [];
    unsplitCandidatesForScan.slice(0, 24).forEach(function (candidateForSplit) {
      const piecesForSplit = splitByTitleForPageLayout(candidateForSplit.items, signatureForPageLayout(candidateForSplit.items[0]), titleCacheForScan);
      if (piecesForSplit.length === 1) {
        collectionCandidatesForScan.push(candidateForSplit);
        return;
      }
      piecesForSplit.forEach(function (pieceForSplit) {
        const candidateForPiece = candidateFromItemsForScan(pieceForSplit.items, candidateForSplit.clusterKey, pieceForSplit.sectionTitle);
        if (candidateForPiece) collectionCandidatesForScan.push(candidateForPiece);
      });
    });
    collectionCandidatesForScan.sort(function (aForRank, bForRank) { return bForRank.score - aForRank.score; });
    // One leaf walk per item for the whole scan: ranking and field-kind detection both read the
    // same items, and each walk touches every element inside the item.
    const leafCacheForScan = new Map();
    // Weigh the top candidates by how many distinct fields an item carries: a card with a title, a
    // count and a date outranks a run of single-word chips of similar size.
    const rankedCollectionsForScan = collectionCandidatesForScan.slice(0, 24).map(function (candidateForFields) {
      const fieldCountForCandidate = Math.max.apply(null, candidateForFields.items.slice(0, 3).map(function (itemForCount) {
        return getItemLeavesForPageLayout(itemForCount, leafCacheForScan).length;
      }).concat([0]));
      candidateForFields.fieldCount = fieldCountForCandidate;
      candidateForFields.score *= Math.min(Math.max(fieldCountForCandidate, 1), 4);
      return candidateForFields;
    }).filter(function (candidateForFilter) {
      return candidateForFilter.fieldCount > 0;
    }).sort(function (aForReRank, bForReRank) { return bForReRank.score - aForReRank.score; });
    // When every item of one cluster holds exactly one item of another, the inner cluster is not a
    // list of its own. It is either a field of the outer items (the title in each card) or the
    // outer items' inner wrapper (<li class="item"><div class="card">). The same goes for a cluster
    // that is a fixed set of parts of each outer item (a title line and a date line). Keep only the
    // outer one, which is what has to move when sorting. A cluster held several to an item whose
    // members are alike (cards in a row) is a real nested list and stays.
    const isInsideItemsForScan = function (outerItemsForInside, innerItemsForInside) {
      return isOnePerItemForPageLayout(outerItemsForInside, innerItemsForInside)
        || isPartsOfItemsForPageLayout(outerItemsForInside, innerItemsForInside, leafCacheForScan, rulesForScan);
    };
    const acceptedCollectionsForScan = [];
    rankedCollectionsForScan.forEach(function (candidateForDedupe) {
      for (let iForDedupe = 0; iForDedupe < acceptedCollectionsForScan.length; iForDedupe++) {
        const acceptedForDedupe = acceptedCollectionsForScan[iForDedupe];
        if (isInsideItemsForScan(acceptedForDedupe.items, candidateForDedupe.items)) return;
        if (isInsideItemsForScan(candidateForDedupe.items, acceptedForDedupe.items)) {
          acceptedCollectionsForScan[iForDedupe] = candidateForDedupe;
          return;
        }
      }
      if (acceptedCollectionsForScan.length < MAX_COLLECTIONS_FOR_PAGE_LAYOUT) acceptedCollectionsForScan.push(candidateForDedupe);
    });

    // Regions. A candidate inside a collection item (a card's pinned badge, a row's own nav) is part
    // of that item, not a region of the page.
    const collectionItemSetForScan = new Set();
    acceptedCollectionsForScan.forEach(function (acceptedForItemSet) {
      acceptedForItemSet.items.forEach(function (itemForItemSet) { collectionItemSetForScan.add(itemForItemSet); });
    });
    const regionCandidatesOutsideItemsForScan = regionCandidatesForScan.filter(function (candidateForItemCheck) {
      let ancestorForItemCheck = candidateForItemCheck.el;
      for (let depthForItemCheck = 0; ancestorForItemCheck && depthForItemCheck < 20; depthForItemCheck++) {
        if (collectionItemSetForScan.has(ancestorForItemCheck)) return false;
        ancestorForItemCheck = ancestorForItemCheck.parentElement;
      }
      return true;
    });
    regionCandidatesOutsideItemsForScan.sort(function (aForRegionRank, bForRegionRank) {
      const priorityDiffForRegion = REGION_KIND_PRIORITY_FOR_PAGE_LAYOUT[aForRegionRank.group] - REGION_KIND_PRIORITY_FOR_PAGE_LAYOUT[bForRegionRank.group];
      if (priorityDiffForRegion) return priorityDiffForRegion;
      return (bForRegionRank.rect.width * bForRegionRank.rect.height) - (aForRegionRank.rect.width * aForRegionRank.rect.height);
    });
    const acceptedRegionsForScan = [];
    regionCandidatesOutsideItemsForScan.forEach(function (candidateForRegion) {
      if (acceptedRegionsForScan.length >= MAX_REGIONS_FOR_PAGE_LAYOUT) return;
      const duplicateForRegion = acceptedRegionsForScan.some(function (acceptedForRegion) {
        const nestedForRegion = acceptedForRegion.el.contains(candidateForRegion.el) || candidateForRegion.el.contains(acceptedForRegion.el);
        return nestedForRegion && rectsCloseForPageLayout(acceptedForRegion.rect, candidateForRegion.rect, 6);
      });
      if (!duplicateForRegion) acceptedRegionsForScan.push(candidateForRegion);
    });

    scanStateForPageLayout.regions = new Map();
    scanStateForPageLayout.collections = new Map();
    scanStateForPageLayout.scannedAt = Date.now();

    const regionsOutForScan = acceptedRegionsForScan.map(function (regionForOut, indexForRegion) {
      const idForRegion = 'r' + (indexForRegion + 1);
      scanStateForPageLayout.regions.set(idForRegion, { el: regionForOut.el, label: regionLabelForPageLayout(regionForOut.el), kind: regionForOut.kind });
      const outForRegion = {
        id: idForRegion,
        kind: regionForOut.kind,
        label: scanStateForPageLayout.regions.get(idForRegion).label,
        where: describeWhereForPageLayout(regionForOut.rect, regionForOut.position),
        size: Math.round(regionForOut.rect.width) + 'x' + Math.round(regionForOut.rect.height)
      };
      if (regionForOut.position) outForRegion.pinned = regionForOut.position;
      return outForRegion;
    });

    const collectionsOutForScan = acceptedCollectionsForScan.map(function (candidateForOut, indexForCollection) {
      const idForCollection = 'c' + (indexForCollection + 1);
      const descriptorForOut = buildCollectionDescriptorForPageLayout(candidateForOut, idForCollection, rulesForScan, leafCacheForScan);
      // The walked items plus the alike siblings skipped beside them, which is exact for a list
      // that finished walking. It is short for a list nested inside skipped copies of another (the
      // links in each row of a long table), whose own members were not the ones skipped, and for
      // a list the walk was cut off inside. Those are also counted with the query sort and filter
      // use, which is what they will touch. That query reads at most 30,000 candidates, and a
      // count it could not finish is a lower bound.
      descriptorForOut.count += candidateForOut.skipped || 0;
      let countIsLowerBoundForOut = false;
      const nestedInSkippedForOut = !candidateForOut.skipped && repeatsForScan.skippedWithin(candidateForOut.lca);
      if (truncatedForScan || nestedInSkippedForOut) {
        const recountForOut = collectBindingItemsForPageLayout(descriptorForOut, MAX_SCAN_ELEMENTS_FOR_PAGE_LAYOUT);
        descriptorForOut.count = Math.max(descriptorForOut.count, recountForOut.items.length);
        countIsLowerBoundForOut = !recountForOut.complete;
      }
      scanStateForPageLayout.collections.set(idForCollection, descriptorForOut);
      const outForCollection = {
        id: idForCollection,
        items: descriptorForOut.count,
        fields: descriptorForOut.fields.map(function (fieldForOut) {
          const outForField = { field: fieldForOut.id, kind: fieldForOut.kind };
          if (fieldForOut.values) outForField.values = fieldForOut.values;
          else outForField.examples = fieldForOut.examples;
          return outForField;
        })
      };
      if (countIsLowerBoundForOut) outForCollection.items_at_least = true;
      if (descriptorForOut.label) outForCollection.label = descriptorForOut.label;
      return outForCollection;
    });

    const resultForScan = {
      ok: true,
      page: { title: document.title || '', url: location.href },
      regions: regionsOutForScan,
      collections: collectionsOutForScan,
      active_changes: summarizeActiveChangesForPageLayout()
    };
    if (truncatedForScan) {
      resultForScan.note = truncatedScanNoteForPageLayout(lastTopForScan + window.scrollY, docHeightForScan, viewportHeightForScan);
    } else if (!collectionsOutForScan.length && !regionsOutForScan.length) {
      resultForScan.note = 'No regions or repeated collections were found on this page.';
    }
    return resultForScan;
  }

  // ---------------------------------------------------------------- replay locators
  //
  // Scan ids (c1, r2, field b) mean something for one scan only. Each change applied through the
  // tool also records where its target sits in terms that survive a reload: a collection's item
  // signature and cluster key, a field's path inside an item, a region's signature and ancestor
  // chain. The chat keeps these records. Replaying one finds the same parts of the page as it is
  // now and runs the same action through the same code and checks.

  const MAX_REPLAY_PATHS_FOR_PAGE_LAYOUT = 12;

  function ancestorChainForPageLayout(elForChain) {
    const partsForChain = [];
    let currentForChain = elForChain.parentElement;
    for (let depthForChain = 0; currentForChain && depthForChain < 25; depthForChain++) {
      if (currentForChain === document.body || currentForChain === document.documentElement) break;
      partsForChain.push(signatureForPageLayout(currentForChain));
      currentForChain = currentForChain.parentElement;
    }
    return partsForChain.join('>');
  }

  function collectionLocatorForPageLayout(descriptorForLocator) {
    const locatorForCollection = { clusterKey: descriptorForLocator.clusterKey, itemSig: descriptorForLocator.itemSig, label: descriptorForLocator.label || '' };
    if (typeof descriptorForLocator.sectionTitle === 'string') locatorForCollection.section = descriptorForLocator.sectionTitle;
    return locatorForCollection;
  }

  function fieldLocatorForPageLayout(fieldForLocator) {
    if (!fieldForLocator || fieldForLocator.path === '*') return { path: '*' };
    return {
      path: fieldForLocator.path,
      paths: Array.from(fieldForLocator.paths || [fieldForLocator.path]).slice(0, MAX_REPLAY_PATHS_FOR_PAGE_LAYOUT),
      loose: fieldForLocator.loose || '',
      kind: fieldForLocator.kind || 'text'
    };
  }

  function regionLocatorForPageLayout(regionForLocator) {
    const elForLocator = regionForLocator.el;
    return {
      sig: signatureForPageLayout(elForLocator),
      chain: ancestorChainForPageLayout(elForLocator),
      id: isMeaningfulIdForPageLayout(elForLocator.id) ? elForLocator.id : '',
      kind: regionForLocator.kind || '',
      label: regionForLocator.label || ''
    };
  }

  // Every element with the collection's item signature and cluster key, outermost first, as one
  // collection, kept to the ones under the saved title when the scan had split the list by title.
  // The scan's minimum of three items does not apply: a list that has shrunk to two is still the
  // list the change was made on.
  function resolveCollectionLocatorForPageLayout(locatorForCollection, leafCacheForCollection) {
    const rulesForCollection = getRulesForPageLayout();
    if (!rulesForCollection || !locatorForCollection) return null;
    let nodesForCollection;
    try {
      nodesForCollection = document.querySelectorAll(selectorFromSignatureForPageLayout(locatorForCollection.itemSig));
    } catch (eSelectorForCollection) {
      return null;
    }
    const sectionForCollection = typeof locatorForCollection.section === 'string' ? locatorForCollection.section : undefined;
    const titleCacheForCollection = sectionForCollection !== undefined ? newTitleCacheForPageLayout() : null;
    const membersForCollection = [];
    let lastForCollection = null;
    for (let iForCollection = 0; iForCollection < nodesForCollection.length && iForCollection < MAX_SCAN_ELEMENTS_FOR_PAGE_LAYOUT; iForCollection++) {
      const nodeForCollection = nodesForCollection[iForCollection];
      if (lastForCollection && lastForCollection.contains(nodeForCollection)) continue;
      if (isOwnUiElementForPageLayout(nodeForCollection) || isHeaderRowForPageLayout(nodeForCollection)) continue;
      if (signatureForPageLayout(nodeForCollection) !== locatorForCollection.itemSig) continue;
      if (clusterKeyForPageLayout(nodeForCollection) !== locatorForCollection.clusterKey) continue;
      if (titleCacheForCollection && groupTitleForPageLayout(nodeForCollection.parentElement, locatorForCollection.itemSig, titleCacheForCollection) !== sectionForCollection) continue;
      membersForCollection.push(nodeForCollection);
      lastForCollection = nodeForCollection;
    }
    if (!membersForCollection.length) return null;
    const lcaForCollection = lowestCommonAncestorForPageLayout(membersForCollection);
    if (!lcaForCollection) return null;
    const labelForCollection = locatorForCollection.label ? '"' + locatorForCollection.label + '"' : 'this list';
    return buildCollectionDescriptorForPageLayout(
      { items: membersForCollection, lca: lcaForCollection, clusterKey: locatorForCollection.clusterKey, sectionTitle: sectionForCollection },
      labelForCollection,
      rulesForCollection,
      leafCacheForCollection
    );
  }

  // The field whose paths the saved field shared, or else a field rebuilt from the saved paths, so
  // a part that is no longer among the first eight fields is still found.
  function resolveFieldLocatorForPageLayout(descriptorForField, locatorForField) {
    if (!locatorForField || locatorForField.path === '*') return { path: '*', kind: 'text', id: '*' };
    const savedPathsForField = new Set([locatorForField.path].concat(locatorForField.paths || []));
    const matchedForField = descriptorForField.fields.find(function (fieldForMatch) {
      return Array.from(fieldForMatch.paths).some(function (pathForMatch) { return savedPathsForField.has(pathForMatch); });
    });
    if (matchedForField) return matchedForField;
    const otherPathsForField = new Set();
    descriptorForField.fields.forEach(function (fieldForOther) {
      if (fieldForOther.loose !== locatorForField.loose) return;
      fieldForOther.paths.forEach(function (pathForOther) {
        if (!savedPathsForField.has(pathForOther)) otherPathsForField.add(pathForOther);
      });
    });
    return {
      id: '',
      path: locatorForField.path,
      paths: savedPathsForField,
      loose: locatorForField.loose || '',
      otherPaths: otherPathsForField,
      kind: locatorForField.kind || 'text'
    };
  }

  function resolveRegionLocatorForPageLayout(locatorForRegion) {
    if (locatorForRegion.id) {
      const byIdForRegion = document.getElementById(locatorForRegion.id);
      if (byIdForRegion && !isOwnUiElementForPageLayout(byIdForRegion) && signatureForPageLayout(byIdForRegion) === locatorForRegion.sig) {
        return { el: byIdForRegion, label: regionLabelForPageLayout(byIdForRegion), kind: locatorForRegion.kind };
      }
    }
    let nodesForRegion;
    try {
      nodesForRegion = document.querySelectorAll(selectorFromSignatureForPageLayout(locatorForRegion.sig));
    } catch (eSelectorForRegion) {
      return null;
    }
    const matchesForRegion = [];
    for (let iForRegion = 0; iForRegion < nodesForRegion.length && iForRegion < MAX_SCAN_ELEMENTS_FOR_PAGE_LAYOUT; iForRegion++) {
      const nodeForRegion = nodesForRegion[iForRegion];
      if (isOwnUiElementForPageLayout(nodeForRegion)) continue;
      if (signatureForPageLayout(nodeForRegion) !== locatorForRegion.sig) continue;
      if (ancestorChainForPageLayout(nodeForRegion) !== locatorForRegion.chain) continue;
      matchesForRegion.push(nodeForRegion);
    }
    if (!matchesForRegion.length) return null;
    const chosenForRegion = (matchesForRegion.length > 1 && locatorForRegion.label
      ? matchesForRegion.find(function (nodeForLabel) { return regionLabelForPageLayout(nodeForLabel) === locatorForRegion.label; })
      : null) || matchesForRegion[0];
    return { el: chosenForRegion, label: regionLabelForPageLayout(chosenForRegion), kind: locatorForRegion.kind };
  }

  // A collection found on the page for replay, with the items a field check reads, built when first
  // asked for. With a cache, each list is looked up once per call however many saved changes name
  // it, which matters when the chat checks every change it has made on a site.
  function findReplayCollectionForPageLayout(locatorForFind, leafCacheForFind, cacheForFind) {
    const cacheKeyForFind = cacheForFind
      ? locatorForFind.itemSig + '\n' + locatorForFind.clusterKey + '\n' + (typeof locatorForFind.section === 'string' ? 'title:' + locatorForFind.section : 'any')
      : '';
    if (cacheForFind && cacheForFind.has(cacheKeyForFind)) return cacheForFind.get(cacheKeyForFind);
    const descriptorForFind = resolveCollectionLocatorForPageLayout(locatorForFind, leafCacheForFind);
    let probeItemsForFind = null;
    const foundForFind = descriptorForFind ? {
      descriptor: descriptorForFind,
      probeItems: function () {
        if (!probeItemsForFind) probeItemsForFind = queryBindingItemsForPageLayout(descriptorForFind).slice(0, KIND_SAMPLE_ITEMS_FOR_PAGE_LAYOUT);
        return probeItemsForFind;
      }
    } : null;
    if (cacheForFind) cacheForFind.set(cacheKeyForFind, foundForFind);
    return foundForFind;
  }

  // Finds a sanitized replay spec's targets on the page as it is now. Returns the override the
  // apply functions take in place of scan ids, or null when a target is not on the page. A change
  // on one field needs at least one loaded item that has that field. Only checkReplay passes a
  // collection cache. A replay changes the page between one change and the next, so it looks each
  // target up again.
  function resolveReplayTargetsForPageLayout(specForTargets, leafCacheForTargets, collectionCacheForTargets) {
    if (specForTargets.region) {
      const regionForTargets = resolveRegionLocatorForPageLayout(specForTargets.region);
      return regionForTargets ? { target: { region: regionForTargets, id: 'region' }, field: null } : null;
    }
    const foundForTargets = findReplayCollectionForPageLayout(specForTargets.collection, leafCacheForTargets, collectionCacheForTargets);
    if (!foundForTargets) return null;
    const descriptorForTargets = foundForTargets.descriptor;
    let fieldForTargets = null;
    if (specForTargets.field) {
      fieldForTargets = resolveFieldLocatorForPageLayout(descriptorForTargets, specForTargets.field);
      if (fieldForTargets.path !== '*') {
        const itemsForProbe = foundForTargets.probeItems();
        const hasFieldForTargets = itemsForProbe.some(function (itemForProbe) {
          return !!getFieldForPageLayout(itemForProbe, fieldForTargets, leafCacheForTargets).text;
        });
        if (!hasFieldForTargets) return null;
      }
    }
    return { descriptor: descriptorForTargets, target: { descriptor: descriptorForTargets, id: descriptorForTargets.id }, field: fieldForTargets };
  }

  // ---------------------------------------------------------------- style ledger

  function ledgerSetForPageLayout(elForSet, propForSet, valueForSet, changeIdForSet) {
    let propsForSet = ledgerForPageLayout.get(elForSet);
    if (!propsForSet) {
      propsForSet = new Map();
      ledgerForPageLayout.set(elForSet, propsForSet);
    }
    let entryForSet = propsForSet.get(propForSet);
    if (!entryForSet) {
      entryForSet = {
        originalValue: elForSet.style.getPropertyValue(propForSet),
        originalPriority: elForSet.style.getPropertyPriority(propForSet),
        layers: []
      };
      propsForSet.set(propForSet, entryForSet);
    }
    let layerForSet = null;
    for (let iForLayer = 0; iForLayer < entryForSet.layers.length; iForLayer++) {
      if (entryForSet.layers[iForLayer].changeId === changeIdForSet) { layerForSet = entryForSet.layers[iForLayer]; break; }
    }
    if (layerForSet) layerForSet.value = valueForSet;
    else entryForSet.layers.push({ changeId: changeIdForSet, value: valueForSet });
    let elementsForChange = ledgerElementsByChangeForPageLayout.get(changeIdForSet);
    if (!elementsForChange) {
      elementsForChange = new Set();
      ledgerElementsByChangeForPageLayout.set(changeIdForSet, elementsForChange);
    }
    elementsForChange.add(elForSet);
    writeLedgerTopForPageLayout(elForSet, propForSet, entryForSet);
  }

  function writeLedgerTopForPageLayout(elForWrite, propForWrite, entryForWrite) {
    const topForWrite = entryForWrite.layers[entryForWrite.layers.length - 1];
    if (topForWrite) {
      if (elForWrite.style.getPropertyValue(propForWrite) !== topForWrite.value || elForWrite.style.getPropertyPriority(propForWrite) !== 'important') {
        elForWrite.style.setProperty(propForWrite, topForWrite.value, 'important');
      }
      return;
    }
    if (entryForWrite.originalValue) {
      elForWrite.style.setProperty(propForWrite, entryForWrite.originalValue, entryForWrite.originalPriority);
    } else {
      elForWrite.style.removeProperty(propForWrite);
    }
  }

  function ledgerClearForPageLayout(elForClear, propForClear, changeIdForClear) {
    const propsForClear = ledgerForPageLayout.get(elForClear);
    const entryForClear = propsForClear && propsForClear.get(propForClear);
    if (!entryForClear) return;
    const beforeForClear = entryForClear.layers.length;
    entryForClear.layers = entryForClear.layers.filter(function (layerForClear) { return layerForClear.changeId !== changeIdForClear; });
    if (entryForClear.layers.length === beforeForClear) return;
    writeLedgerTopForPageLayout(elForClear, propForClear, entryForClear);
    if (!entryForClear.layers.length) {
      propsForClear.delete(propForClear);
      if (!propsForClear.size) ledgerForPageLayout.delete(elForClear);
    }
  }

  function ledgerRemoveChangeForPageLayout(changeIdForRemove) {
    const elementsForRemove = ledgerElementsByChangeForPageLayout.get(changeIdForRemove);
    if (!elementsForRemove) return;
    elementsForRemove.forEach(function (elForRemove) {
      const propsForRemove = ledgerForPageLayout.get(elForRemove);
      if (!propsForRemove) return;
      Array.from(propsForRemove.keys()).forEach(function (propForRemove) {
        ledgerClearForPageLayout(elForRemove, propForRemove, changeIdForRemove);
      });
    });
    ledgerElementsByChangeForPageLayout.delete(changeIdForRemove);
  }

  function ledgerElementCountForChangeForPageLayout(changeIdForCount) {
    const elementsForCount = ledgerElementsByChangeForPageLayout.get(changeIdForCount);
    return elementsForCount ? elementsForCount.size : 0;
  }

  // ---------------------------------------------------------------- bindings (live collection changes)

  function findBindingForPageLayout(descriptorForFind) {
    for (let iForFind = 0; iForFind < bindingsForPageLayout.length; iForFind++) {
      const bindingForFind = bindingsForPageLayout[iForFind];
      if (bindingForFind.watchRoot === descriptorForFind.watchRoot
          && bindingForFind.itemSig === descriptorForFind.itemSig
          && bindingForFind.pathSigsKey === descriptorForFind.pathSigsKey
          && bindingForFind.sectionTitle === descriptorForFind.sectionTitle) {
        return bindingForFind;
      }
    }
    return null;
  }

  function getOrCreateBindingForPageLayout(descriptorForBinding) {
    const existingForBinding = findBindingForPageLayout(descriptorForBinding);
    if (existingForBinding) return existingForBinding;
    const bindingForCreate = {
      itemSig: descriptorForBinding.itemSig,
      itemSelector: descriptorForBinding.itemSelector,
      sectionTitle: descriptorForBinding.sectionTitle,
      watchRoot: descriptorForBinding.watchRoot,
      pathSigs: descriptorForBinding.pathSigs,
      pathSigsKey: descriptorForBinding.pathSigsKey,
      label: descriptorForBinding.label,
      sortChange: null,
      filterChanges: [],
      itemStyleChanges: [],
      observer: null,
      debounceTimer: null,
      lastItems: [],
      reapplyTimes: [],
      paused: false
    };
    bindingsForPageLayout.push(bindingForCreate);
    return bindingForCreate;
  }

  function bindingHasChangesForPageLayout(bindingForHas) {
    return !!bindingForHas.sortChange || bindingForHas.filterChanges.length > 0 || bindingForHas.itemStyleChanges.length > 0;
  }

  function queryBindingItemsForPageLayout(bindingForQuery) {
    return collectBindingItemsForPageLayout(bindingForQuery).items;
  }

  // maxCandidatesForQuery bounds the work when only a count is wanted: a class-free item selector
  // such as "div" can match most of a large page. maxItemsForQuery stops once that many items are
  // found. complete says every candidate was read. A list the scan split by title keeps only the
  // items under its own title; the title is looked up once per parent.
  function collectBindingItemsForPageLayout(bindingForQuery, maxCandidatesForQuery, maxItemsForQuery) {
    if (!bindingForQuery.watchRoot.isConnected) return { items: [], complete: true };
    const candidatesForQuery = bindingForQuery.watchRoot.querySelectorAll(bindingForQuery.itemSelector);
    const limitForQuery = Math.min(candidatesForQuery.length, maxCandidatesForQuery || Infinity);
    const titleCacheForQuery = typeof bindingForQuery.sectionTitle === 'string' ? newTitleCacheForPageLayout() : null;
    const itemsForQuery = [];
    let lastForQuery = null;
    for (let iForQuery = 0; iForQuery < limitForQuery; iForQuery++) {
      const candidateForQuery = candidatesForQuery[iForQuery];
      if (lastForQuery && lastForQuery.contains(candidateForQuery)) continue;
      if (signatureForPageLayout(candidateForQuery) !== bindingForQuery.itemSig) continue;
      if (isHeaderRowForPageLayout(candidateForQuery)) continue;
      const pathSigForQuery = pathSignatureToRootForPageLayout(candidateForQuery, bindingForQuery.watchRoot);
      if (pathSigForQuery === null || !bindingForQuery.pathSigs.has(pathSigForQuery)) continue;
      if (titleCacheForQuery && groupTitleForPageLayout(candidateForQuery.parentElement, bindingForQuery.itemSig, titleCacheForQuery) !== bindingForQuery.sectionTitle) continue;
      itemsForQuery.push(candidateForQuery);
      lastForQuery = candidateForQuery;
      if (maxItemsForQuery && itemsForQuery.length >= maxItemsForQuery) {
        return { items: itemsForQuery, complete: iForQuery === candidatesForQuery.length - 1 };
      }
    }
    return { items: itemsForQuery, complete: limitForQuery === candidatesForQuery.length };
  }

  function sameListForPageLayout(aForSame, bForSame) {
    if (aForSame.length !== bForSame.length) return false;
    for (let iForSame = 0; iForSame < aForSame.length; iForSame++) {
      if (aForSame[iForSame] !== bForSame[iForSame]) return false;
    }
    return true;
  }

  function groupByParentForPageLayout(itemsForGroup) {
    const groupsForParent = new Map();
    itemsForGroup.forEach(function (itemForGroup) {
      const parentForGroup = itemForGroup.parentElement;
      if (!parentForGroup) return;
      let listForGroup = groupsForParent.get(parentForGroup);
      if (!listForGroup) {
        listForGroup = [];
        groupsForParent.set(parentForGroup, listForGroup);
      }
      listForGroup.push(itemForGroup);
    });
    return groupsForParent;
  }

  function isFlexOrGridForPageLayout(elForDisplay) {
    const displayForCheck = getComputedStyle(elForDisplay).display;
    return /(^|-)(flex|grid)$/.test(displayForCheck);
  }

  // Moves each of `desired` into the slot currently held by slotItems[k], all inside one parent.
  // Non-item siblings keep their places. Returns true when anything moved.
  function placeIntoSlotsForPageLayout(slotItemsForPlace, desiredForPlace) {
    if (slotItemsForPlace.length !== desiredForPlace.length || !slotItemsForPlace.length) return false;
    if (sameListForPageLayout(slotItemsForPlace, desiredForPlace)) return false;
    const markersForPlace = slotItemsForPlace.map(function (itemForMarker) {
      const markerForPlace = document.createComment('');
      itemForMarker.parentNode.insertBefore(markerForPlace, itemForMarker);
      return markerForPlace;
    });
    desiredForPlace.forEach(function (itemForPlace, indexForPlace) {
      const markerForItem = markersForPlace[indexForPlace];
      if (markerForItem.nextSibling !== itemForPlace) markerForItem.parentNode.insertBefore(itemForPlace, markerForItem.nextSibling);
    });
    markersForPlace.forEach(function (markerForRemove) { markerForRemove.remove(); });
    return true;
  }

  // Reads every item before writing to any. Reading field text checks whether each part is painted
  // (checkVisibility), and a read after a style write makes the browser update styles first, so
  // interleaving the two costs one style update per item: 32 ms against 3 ms for 3,000 items.
  function applyFilterToItemsForPageLayout(changeForFilter, itemsForFilter, passCacheForFilter) {
    const hideFlagsForFilter = itemsForFilter.map(function (itemForFilter) {
      const fieldForFilter = getFieldForPageLayout(itemForFilter, changeForFilter.field, passCacheForFilter);
      const isMatchForFilter = changeForFilter.predicate(fieldForFilter.text, fieldForFilter.datetime);
      return { match: isMatchForFilter, hide: changeForFilter.mode === 'keep' ? !isMatchForFilter : isMatchForFilter };
    });
    let matchedForFilter = 0;
    let hiddenForFilter = 0;
    itemsForFilter.forEach(function (itemForFilterWrite, indexForFilterWrite) {
      const flagsForFilterWrite = hideFlagsForFilter[indexForFilterWrite];
      if (flagsForFilterWrite.match) matchedForFilter++;
      if (flagsForFilterWrite.hide) {
        ledgerSetForPageLayout(itemForFilterWrite, 'display', 'none', changeForFilter.id);
        hiddenForFilter++;
      } else {
        ledgerClearForPageLayout(itemForFilterWrite, 'display', changeForFilter.id);
      }
    });
    changeForFilter.stats = { items: itemsForFilter.length, matched: matchedForFilter, hidden: hiddenForFilter };
  }

  function applyItemStyleToItemsForPageLayout(changeForItemStyle, itemsForItemStyle, passCacheForItemStyle) {
    if (changeForItemStyle.hiddenContainers) {
      applyContainerHideForPageLayout(changeForItemStyle, itemsForItemStyle);
      return;
    }
    const targetsForItemStyle = itemsForItemStyle.map(function (itemForItemStyle) {
      return changeForItemStyle.field
        ? getFieldForPageLayout(itemForItemStyle, changeForItemStyle.field, passCacheForItemStyle).el
        : itemForItemStyle;
    }).filter(Boolean);
    targetsForItemStyle.forEach(function (targetForItemStyle) {
      changeForItemStyle.declarations.forEach(function (declarationForItemStyle) {
        ledgerSetForPageLayout(targetForItemStyle, declarationForItemStyle.prop, declarationForItemStyle.value, changeForItemStyle.id);
      });
    });
    changeForItemStyle.stats = { items: itemsForItemStyle.length, styled: targetsForItemStyle.length };
  }

  // A parent that holds nothing but these items, so hiding it hides exactly the list. Never the
  // page's body or root.
  function isItemsOnlyContainerForPageLayout(parentForOnly, itemsForOnly) {
    if (parentForOnly === document.body || parentForOnly === document.documentElement) return false;
    if (isOwnUiElementForPageLayout(parentForOnly)) return false;
    if (parentForOnly.childElementCount !== itemsForOnly.length) return false;
    return !directTextForPageLayout(parentForOnly);
  }

  // Hiding a whole collection puts display: none on each group's parent when that parent holds only
  // the group's items, and on each item otherwise. One write per list rather than one per item:
  // hiding list items one by one leaves layout work that grows with the square of the list (see
  // MAX_LIST_ITEMS_FOR_PAGE_LAYOUT), and the list's now-empty box goes too. A container stays
  // hidden for the life of the change, so items the page adds to it later are covered as well.
  function applyContainerHideForPageLayout(changeForContainers, itemsForContainers) {
    let hiddenItemsForContainers = 0;
    groupByParentForPageLayout(itemsForContainers).forEach(function (groupForContainer, parentForContainer) {
      hiddenItemsForContainers += groupForContainer.length;
      if (changeForContainers.hiddenContainers.has(parentForContainer) || isItemsOnlyContainerForPageLayout(parentForContainer, groupForContainer)) {
        changeForContainers.hiddenContainers.add(parentForContainer);
        ledgerSetForPageLayout(parentForContainer, 'display', 'none', changeForContainers.id);
        return;
      }
      groupForContainer.forEach(function (itemForHide) {
        ledgerSetForPageLayout(itemForHide, 'display', 'none', changeForContainers.id);
      });
    });
    changeForContainers.stats = { items: itemsForContainers.length, styled: hiddenItemsForContainers };
  }

  // An error when hiding a whole collection would have to hide more list items one by one than the
  // page can take, or ''. Groups whose parent can be hidden instead cost nothing here.
  function tooManyToHideErrorForPageLayout(descriptorForHideLimit, isReplayForHideLimit) {
    const itemsForHideLimit = collectBindingItemsForPageLayout(descriptorForHideLimit, 0, MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT + 1).items;
    let oneByOneForHideLimit = 0;
    groupByParentForPageLayout(itemsForHideLimit).forEach(function (groupForHideLimit, parentForHideLimit) {
      if (isItemsOnlyContainerForPageLayout(parentForHideLimit, groupForHideLimit)) return;
      if (getComputedStyle(groupForHideLimit[0]).display.indexOf('list-item') !== -1) oneByOneForHideLimit += groupForHideLimit.length;
    });
    if (oneByOneForHideLimit <= MAX_LIST_ITEMS_FOR_PAGE_LAYOUT) return '';
    const limitForHideLimit = MAX_LIST_ITEMS_FOR_PAGE_LAYOUT.toLocaleString('en-US');
    if (isReplayForHideLimit) return 'This list has more than ' + limitForHideLimit + ' items now, too many to hide in the page.';
    return 'This list has more than ' + limitForHideLimit + ' items loaded that would have to be hidden one by one, too many to hide in the page without freezing it.'
      + ' Hide a region that contains the list instead (an r id from the scan), or tell the user the list is too long to hide here.';
  }

  // Whether a flex parent lays its items out from the end (row-reverse, column-reverse), so the
  // first item in CSS order is the last one the user reads.
  function isReversedFlexForPageLayout(elForReversed) {
    const styleForReversed = getComputedStyle(elForReversed);
    return /(^|-)flex$/.test(styleForReversed.display) && /-reverse$/.test(styleForReversed.flexDirection);
  }

  // The order a sort puts one parent's group of items in, worked out from the page's own order
  // without touching the page. rankForGroup gives an item's place in the page's own DOM order.
  // Returns the group's own order and its sorted order, both as the user reads them, how many
  // items have a value to sort on, and whether the parent lays its items out from the end. A
  // reversal sorts on the place an item is read at. Ties keep the order the page reads them in.
  function sortGroupForPageLayout(sortForGroup, groupItemsForGroup, parentForGroup, rankForGroup, keyForItemForGroup) {
    const rulesForGroup = getRulesForPageLayout();
    const reversedForGroup = isReversedFlexForPageLayout(parentForGroup);
    const readingForGroup = groupItemsForGroup.slice().sort(function (aForRank, bForRank) { return rankForGroup(aForRank) - rankForGroup(bForRank); });
    if (reversedForGroup) readingForGroup.reverse();
    const keysForGroup = sortForGroup.reverse
      ? readingForGroup.map(function (_, indexForReading) { return indexForReading; })
      : readingForGroup.map(keyForItemForGroup);
    let readableForGroup = 0;
    keysForGroup.forEach(function (keyForCount) { if (keyForCount !== null && keyForCount !== undefined) readableForGroup++; });
    const sortedForGroup = rulesForGroup.sortIndices(
      keysForGroup,
      sortForGroup.reverse ? 'number' : sortForGroup.kind,
      sortForGroup.reverse ? 'desc' : sortForGroup.order
    ).map(function (indexForSorted) { return readingForGroup[indexForSorted]; });
    return { reading: readingForGroup, sorted: sortedForGroup, readable: readableForGroup, reversed: reversedForGroup };
  }

  function sortKeyReaderForPageLayout(sortForKey, passCacheForKey) {
    const rulesForKey = getRulesForPageLayout();
    return function (itemForKey) {
      const fieldForKey = getFieldForPageLayout(itemForKey, sortForKey.field, passCacheForKey);
      return fieldForKey.text
        ? rulesForKey.parseValue(fieldForKey.text, sortForKey.kind, { nowMs: sortForKey.nowMs, datetimeAttr: fieldForKey.datetime })
        : null;
    };
  }

  // What the user would read first in each group, for the tool result: the sort's field, or for a
  // reversal the collection's first field, or else the item's own text.
  function sortValuesForPageLayout(sortForValues, itemsForValues, passCacheForValues) {
    const fieldForValues = sortForValues.field || sortForValues.displayField || null;
    return itemsForValues.slice(0, 5).map(function (itemForValue) {
      return truncateForPageLayout(fieldForValues ? getFieldForPageLayout(itemForValue, fieldForValues, passCacheForValues).text : itemForValue.textContent, 40);
    }).filter(Boolean);
  }

  function applySortToItemsForPageLayout(changeForSort, itemsForSort, passCacheForSort) {
    // Remember the natural order of every item the first time it is seen, so undo can put back
    // items that loaded after the sort was applied as well as the original ones.
    itemsForSort.forEach(function (itemForSeen) {
      if (!changeForSort.naturalRank.has(itemForSeen)) {
        changeForSort.naturalRank.set(itemForSeen, changeForSort.naturalOrder.length);
        changeForSort.naturalOrder.push(itemForSeen);
      }
    });
    const readKeyForSort = sortKeyReaderForPageLayout(changeForSort, passCacheForSort);
    let unparsedForSort = 0;
    const keyForItemForSort = function (itemForKey) {
      const keyForItem = readKeyForSort(itemForKey);
      if (keyForItem === null) unparsedForSort++;
      return keyForItem;
    };
    const rankForSort = function (itemForRank) { return changeForSort.naturalRank.get(itemForRank); };
    const groupsForSort = groupByParentForPageLayout(itemsForSort);
    let movedForSort = false;
    let firstShownForSort = null;
    let firstAnyForSort = null;
    groupsForSort.forEach(function (groupItemsForSort, parentForSort) {
      const planForGroup = sortGroupForPageLayout(changeForSort, groupItemsForSort, parentForSort, rankForSort, keyForItemForSort);
      if (!firstAnyForSort) firstAnyForSort = planForGroup.sorted;
      if (!firstShownForSort && planForGroup.readable >= 2) firstShownForSort = planForGroup.sorted;
      if (isFlexOrGridForPageLayout(parentForSort)) {
        const itemSetForOrder = new Set(groupItemsForSort);
        const childrenForOrder = Array.from(parentForSort.children);
        const slotIndicesForOrder = [];
        childrenForOrder.forEach(function (childForOrder, childIndexForOrder) {
          if (itemSetForOrder.has(childForOrder)) {
            slotIndicesForOrder.push(childIndexForOrder);
          } else if (!isOwnUiElementForPageLayout(childForOrder)) {
            ledgerSetForPageLayout(childForOrder, 'order', String(ORDER_BASE_FOR_PAGE_LAYOUT + childIndexForOrder), changeForSort.id);
          }
        });
        // A parent laid out from the end shows the highest order first, so the first item read
        // takes the last slot.
        planForGroup.sorted.forEach(function (itemForOrder, rankForOrder) {
          const slotForOrder = slotIndicesForOrder[planForGroup.reversed ? slotIndicesForOrder.length - 1 - rankForOrder : rankForOrder];
          const valueForOrder = String(ORDER_BASE_FOR_PAGE_LAYOUT + slotForOrder);
          if (itemForOrder.style.getPropertyValue('order') !== valueForOrder) movedForSort = true;
          ledgerSetForPageLayout(itemForOrder, 'order', valueForOrder, changeForSort.id);
        });
        changeForSort.usedOrder = true;
      } else if (placeIntoSlotsForPageLayout(groupItemsForSort, planForGroup.sorted)) {
        movedForSort = true;
        changeForSort.usedDomMoves = true;
      }
    });
    changeForSort.stats = {
      items: itemsForSort.length,
      unparsed: changeForSort.reverse ? 0 : unparsedForSort,
      groups: groupsForSort.size,
      first_values: sortValuesForPageLayout(changeForSort, firstShownForSort || firstAnyForSort || [], passCacheForSort)
    };
    return movedForSort;
  }

  // ---------------------------------------------------------------- sort checks
  //
  // A sort from the model is worked out on the page's own order before anything is written, and
  // refused when it would leave the page as the user sees it now or would only take away an
  // earlier sort. After it is written, the screen positions of a sample of its items are read
  // again, which shows a page that places items itself (a list drawn at fixed positions, a grid
  // with set cells) and so does not move them when their order changes.

  // Each item's place in the page's own order: the order an earlier sort recorded before it moved
  // anything, then the DOM order for items it never saw. Without an earlier sort, the DOM order.
  function pageRankForPageLayout(itemsForRank, earlierSortForRank) {
    const rankByItemForRank = new Map();
    if (earlierSortForRank) {
      earlierSortForRank.naturalOrder.forEach(function (itemForEarlier, indexForEarlier) { rankByItemForRank.set(itemForEarlier, indexForEarlier); });
    }
    let nextRankForRank = rankByItemForRank.size;
    itemsForRank.forEach(function (itemForRank) {
      if (!rankByItemForRank.has(itemForRank)) rankByItemForRank.set(itemForRank, nextRankForRank++);
    });
    return function (itemForLookup) { return rankByItemForRank.get(itemForLookup); };
  }

  function planSortForPageLayout(sortForPlan, itemsForPlan, rankForPlan, passCacheForPlan) {
    const keyForItemForPlan = sortForPlan.reverse ? null : sortKeyReaderForPageLayout(sortForPlan, passCacheForPlan);
    const groupsForPlan = [];
    groupByParentForPageLayout(itemsForPlan).forEach(function (groupItemsForPlan, parentForPlan) {
      const planForGroup = sortGroupForPageLayout(sortForPlan, groupItemsForPlan, parentForPlan, rankForPlan, keyForItemForPlan);
      planForGroup.parent = parentForPlan;
      groupsForPlan.push(planForGroup);
    });
    return groupsForPlan;
  }

  // Why a model sort should not be made, or ''. earlierGroups is the plan of the sort it would
  // replace, or null. Every case leaves the page as it is.
  function sortRefusalForPageLayout(descriptorForRefusal, sortForRefusal, groupsForRefusal, earlierGroupsForRefusal, earlierSortForRefusal, passCacheForRefusal) {
    const idForRefusal = descriptorForRefusal.id;
    const valuesForRefusal = function (itemsForList) { return sortValuesForPageLayout(sortForRefusal, itemsForList, passCacheForRefusal).join(', '); };
    const firstSortableForRefusal = groupsForRefusal.findIndex(function (groupForSortable) { return groupForSortable.readable >= 2; });
    if (firstSortableForRefusal === -1) {
      if (groupsForRefusal.every(function (groupForLone) { return groupForLone.reading.length <= 1; })) {
        const countForLone = groupsForRefusal.reduce(function (sumForLone, groupForSum) { return sumForLone + groupForSum.reading.length; }, 0);
        return 'Each of the ' + countForLone + ' items of ' + idForRefusal + ' sits alone in its own row or section, and items are never moved between those, so there is nothing to sort and no change was made.'
          + ' ' + idForRefusal + ' is probably a part of each item of another collection; sort that collection instead.';
      }
      return 'No row or section of ' + idForRefusal + ' holds two items with a readable ' + sortForRefusal.kind + ' in ' + describeFieldForPageLayout(sortForRefusal.field)
        + ', so there is nothing to sort and no change was made. ' + idForRefusal + ' is probably the parts inside each item of another collection (an icon and a text block in every row);'
        + ' sort that collection instead, or pick the field that holds the value.';
    }
    const changesPageForRefusal = groupsForRefusal.some(function (groupForChange) { return !sameListForPageLayout(groupForChange.sorted, groupForChange.reading); });
    const pageValuesForRefusal = valuesForRefusal(groupsForRefusal[firstSortableForRefusal].reading);
    if (!earlierGroupsForRefusal) {
      if (changesPageForRefusal) return '';
      return idForRefusal + ' is already in this order (first values: ' + pageValuesForRefusal + '), so nothing moved and no change was made.'
        + (sortForRefusal.reverse ? '' : ' order "desc" puts the highest number, the newest date, the longest duration or the end of the alphabet first, and "asc" puts them last.'
        + ' If the user asked to reverse or flip the list, use order "reverse".');
    }
    const earlierIdForRefusal = earlierSortForRefusal.id;
    const earlierValuesForRefusal = valuesForRefusal(earlierGroupsForRefusal[firstSortableForRefusal].sorted);
    const sameAsEarlierForRefusal = groupsForRefusal.every(function (groupForSame, indexForSame) {
      return sameListForPageLayout(groupForSame.sorted, earlierGroupsForRefusal[indexForSame].sorted);
    });
    if (sameAsEarlierForRefusal) {
      return idForRefusal + ' is already in this order from ' + earlierIdForRefusal + ' (first values: ' + earlierValuesForRefusal + '), so no change was made.';
    }
    if (changesPageForRefusal) return '';
    return 'Sorting ' + idForRefusal + ' this way gives the order the page has without any sort (first values: ' + pageValuesForRefusal + '), so it would only take away '
      + earlierIdForRefusal + ', which shows the list as ' + earlierValuesForRefusal + '. No change was made and ' + earlierIdForRefusal + ' is still applied.'
      + ' If the user wants the page\'s own order back, undo ' + earlierIdForRefusal + '; if they wanted the order ' + earlierIdForRefusal + ' gives, it is already showing.';
  }

  // An item's box on screen, or null when it has none. A display: contents item has no box of its
  // own, so its contents' box stands in for it.
  function itemRectForPageLayout(itemForRect) {
    const rectForItem = itemForRect.getBoundingClientRect();
    if (rectForItem.width || rectForItem.height) return rectForItem;
    if (getComputedStyle(itemForRect).display !== 'contents') return null;
    const rangeForItem = document.createRange();
    rangeForItem.selectNodeContents(itemForRect);
    const contentsRectForItem = rangeForItem.getBoundingClientRect();
    return contentsRectForItem.width || contentsRectForItem.height ? contentsRectForItem : null;
  }

  // How a parent's items are read: row by row, or column by column for a grid that fills columns
  // first, a wrapping column flex box or a multi-column box, and from the right in a right-to-left
  // parent.
  function readingLayoutForPageLayout(parentForLayout) {
    const styleForLayout = getComputedStyle(parentForLayout);
    const columnFirstForLayout = (/grid$/.test(styleForLayout.display) && /column/.test(styleForLayout.gridAutoFlow))
      || (/flex$/.test(styleForLayout.display) && /^column/.test(styleForLayout.flexDirection) && styleForLayout.flexWrap !== 'nowrap')
      || styleForLayout.columnCount !== 'auto' || styleForLayout.columnWidth !== 'auto';
    return { columnFirst: columnFirstForLayout, rtl: styleForLayout.direction === 'rtl' };
  }

  // Whether box a is read no later than box b. Two boxes that overlap by more than half the
  // smaller one across the reading direction are in one row (or column).
  function readsBeforeForPageLayout(aForReads, bForReads, layoutForReads) {
    const startsFirstForReads = layoutForReads.rtl ? aForReads.right >= bForReads.right : aForReads.left <= bForReads.left;
    if (layoutForReads.columnFirst) {
      const sharedWidthForReads = Math.min(aForReads.right, bForReads.right) - Math.max(aForReads.left, bForReads.left);
      if (sharedWidthForReads > Math.min(aForReads.width, bForReads.width) / 2) return aForReads.top <= bForReads.top;
      return startsFirstForReads;
    }
    const sharedHeightForReads = Math.min(aForReads.bottom, bForReads.bottom) - Math.max(aForReads.top, bForReads.top);
    if (sharedHeightForReads > Math.min(aForReads.height, bForReads.height) / 2) return startsFirstForReads;
    return aForReads.top <= bForReads.top;
  }

  // The boxes, before the sort, of the first items in the new order in each group the sort
  // changes. shownGroups is what the user sees now, group by group.
  function sortCheckSampleForPageLayout(groupsForSample, shownGroupsForSample) {
    const sampleForCheck = [];
    for (let iForGroup = 0; iForGroup < groupsForSample.length && sampleForCheck.length < SORT_CHECK_GROUPS_FOR_PAGE_LAYOUT; iForGroup++) {
      const groupForSample = groupsForSample[iForGroup];
      if (sameListForPageLayout(groupForSample.sorted, shownGroupsForSample[iForGroup])) continue;
      const entriesForGroup = [];
      for (let iForItem = 0; iForItem < groupForSample.sorted.length && entriesForGroup.length < SORT_CHECK_ITEMS_PER_GROUP_FOR_PAGE_LAYOUT; iForItem++) {
        const rectBeforeForItem = itemRectForPageLayout(groupForSample.sorted[iForItem]);
        if (rectBeforeForItem) entriesForGroup.push({ item: groupForSample.sorted[iForItem], before: rectBeforeForItem });
      }
      if (entriesForGroup.length >= 2) sampleForCheck.push({ parent: groupForSample.parent, entries: entriesForGroup });
    }
    return sampleForCheck;
  }

  // Reads the sample's boxes again after the sort. moved says whether any of them is somewhere
  // else on screen; misread lists the groups whose items do not read in the new order.
  function finishSortCheckForPageLayout(sampleForFinish) {
    let movedForFinish = false;
    const misreadForFinish = [];
    sampleForFinish.forEach(function (groupForFinish) {
      const layoutForFinish = readingLayoutForPageLayout(groupForFinish.parent);
      const afterForFinish = groupForFinish.entries.map(function (entryForAfter) {
        const rectAfterForEntry = itemRectForPageLayout(entryForAfter.item);
        if (rectAfterForEntry && (Math.abs(rectAfterForEntry.left - entryForAfter.before.left) > 1 || Math.abs(rectAfterForEntry.top - entryForAfter.before.top) > 1)) movedForFinish = true;
        return { item: entryForAfter.item, rect: rectAfterForEntry };
      }).filter(function (entryForShown) { return !!entryForShown.rect; });
      for (let iForPair = 1; iForPair < afterForFinish.length; iForPair++) {
        if (!readsBeforeForPageLayout(afterForFinish[iForPair - 1].rect, afterForFinish[iForPair].rect, layoutForFinish)) {
          misreadForFinish.push(afterForFinish.slice().sort(function (aForShown, bForShown) {
            if (readsBeforeForPageLayout(aForShown.rect, bForShown.rect, layoutForFinish)) return readsBeforeForPageLayout(bForShown.rect, aForShown.rect, layoutForFinish) ? 0 : -1;
            return 1;
          }).map(function (entryForItem) { return entryForItem.item; }));
          break;
        }
      }
    });
    return { moved: movedForFinish, misread: misreadForFinish };
  }

  // Current DOM order of the binding's items after this pass. A CSS-order sort leaves the DOM
  // alone, so only DOM moves change it.
  // passCacheForReapplyArg lets a caller that has just read the items' fields (a sort working out
  // its order) hand those reads on instead of walking every item again.
  function reapplyBindingForPageLayout(bindingForReapply, passCacheForReapplyArg) {
    disconnectBindingObserverForPageLayout(bindingForReapply);
    if (!bindingForReapply.watchRoot.isConnected) return { items: 0, moved: false };
    const itemsForReapply = queryBindingItemsForPageLayout(bindingForReapply);
    const passCacheForReapply = passCacheForReapplyArg || new Map();
    let movedForReapply = false;
    // A collection that is itself hidden (by the page or by a hide change on an ancestor) has no
    // rendered text to read. Re-sorting it on empty keys would scramble it back to natural order,
    // so leave it as it is until it is visible again.
    const anyRenderedForReapply = itemsForReapply.some(function (itemForRendered) {
      return isRenderedForPageLayout(itemForRendered) || isHiddenByLayoutForPageLayout(itemForRendered);
    });
    if (itemsForReapply.length && anyRenderedForReapply) {
      bindingForReapply.filterChanges.forEach(function (changeForReapplyFilter) {
        applyFilterToItemsForPageLayout(changeForReapplyFilter, itemsForReapply, passCacheForReapply);
      });
      bindingForReapply.itemStyleChanges.forEach(function (changeForReapplyStyle) {
        applyItemStyleToItemsForPageLayout(changeForReapplyStyle, itemsForReapply, passCacheForReapply);
      });
      if (bindingForReapply.sortChange) {
        movedForReapply = applySortToItemsForPageLayout(bindingForReapply.sortChange, itemsForReapply, passCacheForReapply);
      }
    }
    bindingForReapply.lastItems = movedForReapply ? queryBindingItemsForPageLayout(bindingForReapply) : itemsForReapply;
    connectBindingObserverForPageLayout(bindingForReapply);
    return { items: itemsForReapply.length, moved: movedForReapply };
  }

  function disconnectBindingObserverForPageLayout(bindingForDisconnect) {
    if (bindingForDisconnect.observer) {
      bindingForDisconnect.observer.takeRecords();
      bindingForDisconnect.observer.disconnect();
    }
  }

  function connectBindingObserverForPageLayout(bindingForConnect) {
    if (bindingForConnect.paused || !bindingHasChangesForPageLayout(bindingForConnect)) return;
    if (!bindingForConnect.watchRoot.isConnected) return;
    if (!bindingForConnect.observer) {
      bindingForConnect.observer = new MutationObserver(function () {
        onBindingMutationsForPageLayout(bindingForConnect);
      });
    }
    bindingForConnect.observer.observe(bindingForConnect.watchRoot, { childList: true, subtree: true });
  }

  function onBindingMutationsForPageLayout(bindingForMutation) {
    if (isStaleForPageLayout()) {
      teardownForPageLayout();
      return;
    }
    if (bindingForMutation.paused || bindingForMutation.debounceTimer) return;
    bindingForMutation.debounceTimer = setTimeout(function () {
      bindingForMutation.debounceTimer = null;
      if (isStaleForPageLayout()) {
        teardownForPageLayout();
        return;
      }
      if (bindingsForPageLayout.indexOf(bindingForMutation) === -1 || bindingForMutation.paused) return;
      const itemsNowForMutation = queryBindingItemsForPageLayout(bindingForMutation);
      if (sameListForPageLayout(itemsNowForMutation, bindingForMutation.lastItems)) return;
      const nowForMutation = Date.now();
      bindingForMutation.reapplyTimes = bindingForMutation.reapplyTimes.filter(function (timeForWindow) {
        return nowForMutation - timeForWindow < REAPPLY_WINDOW_MS_FOR_PAGE_LAYOUT;
      });
      bindingForMutation.reapplyTimes.push(nowForMutation);
      if (bindingForMutation.reapplyTimes.length > MAX_REAPPLIES_PER_WINDOW_FOR_PAGE_LAYOUT) {
        // The page is re-rendering the list as fast as it is re-sorted. Stop fighting it: the
        // change stays applied as it last was, and the chip says it is no longer following.
        pauseBindingForPageLayout(bindingForMutation, 'redraw');
        return;
      }
      const limitForMutation = Math.min(
        bindingForMutation.sortChange ? itemLimitForPageLayout(itemsNowForMutation, 'sort') : Infinity,
        bindingForMutation.filterChanges.length ? itemLimitForPageLayout(itemsNowForMutation, 'filter') : Infinity
      );
      if (itemsNowForMutation.length > limitForMutation) {
        // The list grew (an infinite feed) past the size a sort or filter is allowed to start on.
        // Re-running it on every batch would stall the page the same way.
        pauseBindingForPageLayout(bindingForMutation, 'size');
        return;
      }
      reapplyBindingForPageLayout(bindingForMutation);
    }, REAPPLY_DEBOUNCE_MS_FOR_PAGE_LAYOUT);
  }

  function pauseBindingForPageLayout(bindingForPause, reasonForPause) {
    bindingForPause.paused = true;
    bindingForPause.pausedReason = reasonForPause;
    disconnectBindingObserverForPageLayout(bindingForPause);
    renderChipForPageLayout();
  }

  // The most items a sort or filter may run on. It is decided from the first item, which stands for
  // the list: list items get the lower limit, except for a sort in a flex or grid parent, which
  // uses CSS order and moves nothing.
  function itemLimitForPageLayout(itemsForLimit, actionForLimit) {
    const firstForLimit = itemsForLimit[0];
    if (!firstForLimit || !firstForLimit.parentElement) return MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT;
    if (getComputedStyle(firstForLimit).display.indexOf('list-item') === -1) return MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT;
    if (actionForLimit === 'sort' && isFlexOrGridForPageLayout(firstForLimit.parentElement)) return MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT;
    return MAX_LIST_ITEMS_FOR_PAGE_LAYOUT;
  }

  // An error for a sort or filter on a list too long to handle in the page, or '' when it is not.
  // The replay text is shown to the user in the chat; the other goes back to the model.
  function tooManyItemsErrorForPageLayout(descriptorForTooMany, actionForTooMany, isReplayForTooMany) {
    const itemsForTooMany = collectBindingItemsForPageLayout(descriptorForTooMany, 0, MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT + 1).items;
    const maxForTooMany = itemLimitForPageLayout(itemsForTooMany, actionForTooMany);
    if (itemsForTooMany.length <= maxForTooMany) return '';
    const limitForTooMany = maxForTooMany.toLocaleString('en-US');
    if (isReplayForTooMany) return 'This list has more than ' + limitForTooMany + ' items now, too many to ' + actionForTooMany + ' in the page.';
    return 'This list has more than ' + limitForTooMany + ' items loaded, too many to ' + actionForTooMany + ' in the page without freezing it.'
      + ' Use the site\'s own ' + (actionForTooMany === 'sort' ? 'sort' : 'filter or search') + ' control if it has one (page_observe, then page_act);'
      + ' otherwise tell the user the list is too long to ' + actionForTooMany + ' here.';
  }

  function releaseBindingIfIdleForPageLayout(bindingForRelease) {
    if (bindingHasChangesForPageLayout(bindingForRelease)) return;
    disconnectBindingObserverForPageLayout(bindingForRelease);
    if (bindingForRelease.debounceTimer) {
      clearTimeout(bindingForRelease.debounceTimer);
      bindingForRelease.debounceTimer = null;
    }
    const indexForRelease = bindingsForPageLayout.indexOf(bindingForRelease);
    if (indexForRelease !== -1) bindingsForPageLayout.splice(indexForRelease, 1);
  }

  // ---------------------------------------------------------------- apply

  function newChangeIdForPageLayout() {
    return 'L' + (nextChangeNumberForPageLayout++);
  }

  // Takes back a change that turned out to do nothing usable, before anyone saw its id. Its id is
  // given back too when it is the latest, so the ids the model and the user see have no gaps.
  function discardChangeForPageLayout(changeForDiscard) {
    undoChangeForPageLayout(changeForDiscard, {});
    if (changeForDiscard.id === 'L' + (nextChangeNumberForPageLayout - 1)) nextChangeNumberForPageLayout--;
  }

  // Why a collection change found nothing to work on: the items are gone, or they are there but
  // hidden (by the page, or by an earlier hide), so their text cannot be read.
  function unreadableCollectionErrorForPageLayout(bindingForUnreadable, idForUnreadable) {
    if (queryBindingItemsForPageLayout(bindingForUnreadable).length) {
      return 'The items of ' + idForUnreadable + ' are not visible right now, so their text could not be read. If an earlier change hid them, undo it first.';
    }
    return 'The items of ' + idForUnreadable + ' are no longer on the page. Run operation "scan" again.';
  }

  function resolveCollectionForPageLayout(rawIdForCollection) {
    const idForResolve = normalizeForPageLayout(rawIdForCollection).toLowerCase();
    if (!idForResolve) return { error: 'This change needs a collection id (c1, c2, ...) from the latest scan.' };
    const descriptorForResolve = scanStateForPageLayout.collections.get(idForResolve);
    if (!descriptorForResolve) {
      return { error: 'Collection "' + rawIdForCollection + '" is not in the latest scan. Run operation "scan" and use one of its collection ids.' };
    }
    if (!descriptorForResolve.watchRoot.isConnected) {
      return { error: 'Collection ' + idForResolve + ' is no longer on the page. Run operation "scan" again.' };
    }
    return { descriptor: descriptorForResolve };
  }

  function resolveFieldForPageLayout(descriptorForFieldResolve, rawFieldForResolve, allowWholeItemForResolve) {
    const fieldIdForResolve = normalizeForPageLayout(rawFieldForResolve).toLowerCase();
    if (allowWholeItemForResolve && fieldIdForResolve === '*') return { path: '*', kind: 'text', id: '*' };
    const fieldForResolve = descriptorForFieldResolve.fields.find(function (fieldForFind) { return fieldForFind.id === fieldIdForResolve; });
    if (!fieldForResolve) {
      const knownForResolve = descriptorForFieldResolve.fields.map(function (fieldForKnown) { return fieldForKnown.id; });
      return {
        error: 'Field "' + rawFieldForResolve + '" is not in collection ' + descriptorForFieldResolve.id + '. Its fields are '
          + (knownForResolve.length ? knownForResolve.join(', ') : '(none)') + (allowWholeItemForResolve ? ', or "*" for the whole item text.' : '.')
      };
    }
    return fieldForResolve;
  }

  function resolveParseKindForPageLayout(rawParseForKind, fieldForKind) {
    const rulesForKind = getRulesForPageLayout();
    const parseForKind = normalizeForPageLayout(rawParseForKind || 'auto').toLowerCase();
    if (!rulesForKind.isValidParser(parseForKind)) {
      return { error: 'Unknown parse "' + rawParseForKind + '". Use one of: ' + rulesForKind.PARSERS.join(', ') + '.' };
    }
    return { kind: parseForKind === 'auto' ? (fieldForKind.kind || 'text') : parseForKind };
  }

  function describeFieldForPageLayout(fieldForDescribe) {
    if (!fieldForDescribe || fieldForDescribe.id === '*') return 'the whole item text';
    const exampleForDescribe = (fieldForDescribe.examples || fieldForDescribe.values || [])[0];
    return 'field ' + fieldForDescribe.id + (exampleForDescribe ? ' ("' + exampleForDescribe + '")' : '');
  }

  function orderWordsForPageLayout(kindForWords, orderForWords) {
    const descForWords = orderForWords === 'desc';
    if (kindForWords === 'date' || kindForWords === 'relative_time') return descForWords ? 'newest first' : 'oldest first';
    if (kindForWords === 'duration') return descForWords ? 'longest first' : 'shortest first';
    if (kindForWords === 'text') return descForWords ? 'Z to A' : 'A to Z';
    return descForWords ? 'highest first' : 'lowest first';
  }

  function userLabelForPageLayout(specForLabel, fallbackForLabel) {
    const labelForUser = truncateForPageLayout(specForLabel && specForLabel.label, 80);
    return labelForUser || fallbackForLabel;
  }

  function registerChangeForPageLayout(changeForRegister) {
    changesForPageLayout.push(changeForRegister);
    ensurePruneTimerForPageLayout();
  }

  // The sort a spec asks for: a field, a kind and an order, or a reversal of the page's own order.
  // order "reverse" on a list a field sort already orders sorts that field the other way, which is
  // what the user sees reversed. On a list the page shows in its own order, or on a replay, it
  // reverses that order.
  function resolveSortForPageLayout(specForResolve, overrideForResolve, descriptorForResolve, orderAskedForResolve, earlierSortForResolve) {
    if (orderAskedForResolve === 'reverse') {
      if (!overrideForResolve && earlierSortForResolve) {
        if (earlierSortForResolve.reverse) {
          return {
            error: descriptorForResolve.id + ' is shown reversed by ' + earlierSortForResolve.id + ', so reversing it again gives the page\'s own order. No change was made.'
              + ' To put the page\'s own order back, undo ' + earlierSortForResolve.id + '.'
          };
        }
        return {
          reverse: false,
          field: earlierSortForResolve.field,
          kind: earlierSortForResolve.kind,
          order: earlierSortForResolve.order === 'desc' ? 'asc' : 'desc',
          flippedFrom: earlierSortForResolve.id
        };
      }
      return { reverse: true, field: null, kind: 'number', order: 'desc' };
    }
    const fieldForResolve = overrideForResolve ? overrideForResolve.field : resolveFieldForPageLayout(descriptorForResolve, specForResolve.field, false);
    if (!fieldForResolve || fieldForResolve.path === '*') return { error: 'A sort needs a field, unless order is "reverse".' };
    if (fieldForResolve.error) return { error: fieldForResolve.error };
    const kindForResolve = resolveParseKindForPageLayout(specForResolve.parse, fieldForResolve);
    if (kindForResolve.error) return { error: kindForResolve.error };
    return { reverse: false, field: fieldForResolve, kind: kindForResolve.kind, order: orderAskedForResolve };
  }

  // overrideForSort comes only from a chat replay, which has already found the collection and
  // field on the page. A model call names them by scan id.
  function applySortForPageLayout(specForSort, overrideForSort) {
    const resolvedForSort = overrideForSort ? { descriptor: overrideForSort.descriptor } : resolveCollectionForPageLayout(specForSort.collection || specForSort.target);
    if (resolvedForSort.error) return { ok: false, error: resolvedForSort.error };
    const descriptorForSort = resolvedForSort.descriptor;
    const orderAskedForSort = normalizeForPageLayout(specForSort.order || 'asc').toLowerCase();
    if (orderAskedForSort !== 'asc' && orderAskedForSort !== 'desc' && orderAskedForSort !== 'reverse') {
      return { ok: false, error: 'order must be "asc", "desc" or "reverse".' };
    }
    const tooManyForSort = tooManyItemsErrorForPageLayout(descriptorForSort, 'sort', !!overrideForSort);
    if (tooManyForSort) return { ok: false, error: tooManyForSort };
    // One sort per collection: a new one replaces the old.
    const earlierBindingForSort = findBindingForPageLayout(descriptorForSort);
    const earlierSortForSort = earlierBindingForSort ? earlierBindingForSort.sortChange : null;
    const sortForSort = resolveSortForPageLayout(specForSort, overrideForSort, descriptorForSort, orderAskedForSort, earlierSortForSort);
    if (sortForSort.error) return { ok: false, error: sortForSort.error };
    sortForSort.nowMs = Date.now();
    sortForSort.displayField = sortForSort.field || descriptorForSort.fields[0] || null;

    // A model sort is worked out first and refused when it would change nothing the user can see.
    // A replay keeps a sort that has nothing to move: on a later visit the list may simply already
    // be in that order.
    const passCacheForSort = new Map();
    let shownGroupsForSort = null;
    let pageGroupsForSort = null;
    let firstSortableForSort = -1;
    let sampleForSort = null;
    if (!overrideForSort) {
      const itemsForPlan = collectBindingItemsForPageLayout(descriptorForSort, 0, MAX_ITEMS_FOR_SORT_OR_FILTER_FOR_PAGE_LAYOUT + 1).items;
      const readableForPlan = itemsForPlan.some(function (itemForReadable) {
        return isRenderedForPageLayout(itemForReadable) || isHiddenByLayoutForPageLayout(itemForReadable);
      });
      if (itemsForPlan.length && readableForPlan) {
        const rankForPlan = pageRankForPageLayout(itemsForPlan, earlierSortForSort);
        pageGroupsForSort = planSortForPageLayout(sortForSort, itemsForPlan, rankForPlan, passCacheForSort);
        const earlierGroupsForSort = earlierSortForSort ? planSortForPageLayout(earlierSortForSort, itemsForPlan, rankForPlan, passCacheForSort) : null;
        const refusalForSort = sortRefusalForPageLayout(descriptorForSort, sortForSort, pageGroupsForSort, earlierGroupsForSort, earlierSortForSort, passCacheForSort);
        if (refusalForSort) return { ok: false, error: refusalForSort };
        shownGroupsForSort = pageGroupsForSort.map(function (groupForShown, indexForShown) {
          return earlierGroupsForSort ? earlierGroupsForSort[indexForShown].sorted : groupForShown.reading;
        });
        firstSortableForSort = pageGroupsForSort.findIndex(function (groupForFirst) { return groupForFirst.readable >= 2; });
        sampleForSort = sortCheckSampleForPageLayout(pageGroupsForSort, shownGroupsForSort);
      }
    }

    let replacedForSort = '';
    let replacedKeyForSort = '';
    if (earlierSortForSort) {
      replacedForSort = earlierSortForSort.id;
      replacedKeyForSort = earlierSortForSort.key || '';
      undoChangeForPageLayout(earlierSortForSort, { skipReapply: true });
    }
    // Fetched after the undo, because undoing a collection's last change releases its binding.
    const bindingForSort = getOrCreateBindingForPageLayout(descriptorForSort);
    const collectionNameForSort = descriptorForSort.label ? '"' + descriptorForSort.label + '"' : descriptorForSort.id;
    const generatedForSort = sortForSort.reverse
      ? 'Reversed ' + collectionNameForSort
      : 'Sorted ' + collectionNameForSort + ' by ' + describeFieldForPageLayout(sortForSort.field) + ', ' + orderWordsForPageLayout(sortForSort.kind, sortForSort.order);
    let descriptionForSort = userLabelForPageLayout(specForSort, generatedForSort);
    const notesForSort = [];
    // The label is what the user reads in the chat and on the bar, so one that names the other
    // direction ("newest first" on a sort that puts the oldest first) is not shown.
    if (!overrideForSort && !sortForSort.reverse && specForSort.label) {
      const labelOrderForSort = getRulesForPageLayout().sortLabelOrder(specForSort.label, sortForSort.kind);
      if (labelOrderForSort && labelOrderForSort !== sortForSort.order) {
        descriptionForSort = generatedForSort;
        notesForSort.push('The label "' + truncateForPageLayout(specForSort.label, 80) + '" names the other direction, so the user sees "' + generatedForSort + '" instead.');
      }
    }
    const changeForSort = {
      id: newChangeIdForPageLayout(),
      action: 'sort',
      binding: bindingForSort,
      field: sortForSort.field,
      kind: sortForSort.kind,
      order: sortForSort.order,
      reverse: sortForSort.reverse,
      displayField: sortForSort.displayField,
      nowMs: sortForSort.nowMs,
      naturalRank: new Map(),
      naturalOrder: [],
      usedOrder: false,
      usedDomMoves: false,
      stats: null,
      description: descriptionForSort,
      replaySpec: sortForSort.reverse
        ? { action: 'sort', collection: collectionLocatorForPageLayout(descriptorForSort), order: 'reverse' }
        : {
          action: 'sort',
          collection: collectionLocatorForPageLayout(descriptorForSort),
          field: fieldLocatorForPageLayout(sortForSort.field),
          order: sortForSort.order,
          parse: sortForSort.kind
        }
    };
    bindingForSort.sortChange = changeForSort;
    bindingForSort.paused = false;
    registerChangeForPageLayout(changeForSort);
    reapplyBindingForPageLayout(bindingForSort, passCacheForSort);
    const statsForSort = changeForSort.stats || { items: 0, unparsed: 0, groups: 0, first_values: [] };
    if (!statsForSort.items) {
      const unreadableForSort = unreadableCollectionErrorForPageLayout(bindingForSort, descriptorForSort.id);
      discardChangeForPageLayout(changeForSort);
      return { ok: false, error: unreadableForSort };
    }
    if (sampleForSort && sampleForSort.length) {
      const checkForSort = finishSortCheckForPageLayout(sampleForSort);
      if (!checkForSort.moved) {
        const fixedForSort = 'The items of ' + descriptorForSort.id + ' did not move on screen. The page places each one itself (a list drawn at fixed positions, or a grid with set cells), so changing their order changes nothing the user sees.';
        if (!replacedForSort) {
          discardChangeForPageLayout(changeForSort);
          return { ok: false, error: fixedForSort + ' No change was made. Tell the user this list cannot be reordered here; if the site has its own sort control, use that (page_observe, then page_act).' };
        }
        notesForSort.push(fixedForSort);
      } else if (checkForSort.misread.length) {
        notesForSort.push('On screen, ' + checkForSort.misread.length + ' of the ' + sampleForSort.length + ' groups checked do not read in the new order, because the page places some items itself.'
          + ' The first one now reads: ' + sortValuesForPageLayout(changeForSort, checkForSort.misread[0], passCacheForSort).join(', ') + '. Tell the user the order may not look as asked.');
      }
    }
    const resultForSort = {
      change_id: changeForSort.id,
      action: 'sort',
      description: changeForSort.description,
      items: statsForSort.items,
      order: sortForSort.reverse ? 'reverse' : sortForSort.order,
      first_values: statsForSort.first_values
    };
    if (!sortForSort.reverse) resultForSort.parse = sortForSort.kind;
    if (firstSortableForSort !== -1) {
      resultForSort.before_values = sortValuesForPageLayout(changeForSort, shownGroupsForSort[firstSortableForSort], passCacheForSort);
      if (replacedForSort) resultForSort.page_values = sortValuesForPageLayout(changeForSort, pageGroupsForSort[firstSortableForSort].reading, passCacheForSort);
    }
    if (statsForSort.unparsed) notesForSort.push(statsForSort.unparsed + ' item(s) had no readable ' + sortForSort.kind + ' in this field and were placed last.');
    if (statsForSort.groups > 1) notesForSort.push('The items sit in ' + statsForSort.groups + ' separate groups (rows or sections) on this page, so each group was sorted on its own; items are never moved between groups, because that can break the page.');
    if (replacedForSort) {
      notesForSort.push('Replaced the earlier sort ' + replacedForSort + (sortForSort.flippedFrom ? ', sorting the same field the other way.' : '.')
        + (resultForSort.page_values ? ' before_values is what ' + replacedForSort + ' showed; page_values is the page\'s own order.' : ''));
    }
    notesForSort.push('Only items already loaded in the page are sorted; items that load later are sorted in as they arrive.');
    resultForSort.note = notesForSort.join(' ');
    return { ok: true, result: resultForSort, replaced: replacedForSort, replacedKey: replacedKeyForSort };
  }

  function applyFilterForPageLayout(specForFilter, overrideForFilter) {
    const rulesForFilter = getRulesForPageLayout();
    const resolvedForFilter = overrideForFilter ? { descriptor: overrideForFilter.descriptor } : resolveCollectionForPageLayout(specForFilter.collection || specForFilter.target);
    if (resolvedForFilter.error) return { ok: false, error: resolvedForFilter.error };
    const descriptorForFilter = resolvedForFilter.descriptor;
    const fieldForFilter = overrideForFilter
      ? (overrideForFilter.field || { path: '*', kind: 'text', id: '*' })
      : resolveFieldForPageLayout(descriptorForFilter, specForFilter.field == null ? '*' : specForFilter.field, true);
    if (fieldForFilter.error) return { ok: false, error: fieldForFilter.error };
    const kindForFilter = resolveParseKindForPageLayout(specForFilter.parse, fieldForFilter);
    if (kindForFilter.error) return { ok: false, error: kindForFilter.error };
    const modeForFilter = normalizeForPageLayout(specForFilter.mode || 'hide').toLowerCase();
    if (modeForFilter !== 'hide' && modeForFilter !== 'keep') return { ok: false, error: 'mode must be "hide" (hide matching items) or "keep" (hide the rest).' };
    const predicateForFilter = rulesForFilter.buildFilterPredicate({
      op: specForFilter.op,
      value: specForFilter.value,
      kind: kindForFilter.kind,
      nowMs: Date.now()
    });
    if (!predicateForFilter.ok) return { ok: false, error: predicateForFilter.error };
    const tooManyForFilter = tooManyItemsErrorForPageLayout(descriptorForFilter, 'filter', !!overrideForFilter);
    if (tooManyForFilter) return { ok: false, error: tooManyForFilter };

    const bindingForFilter = getOrCreateBindingForPageLayout(descriptorForFilter);
    const collectionNameForFilter = descriptorForFilter.label ? '"' + descriptorForFilter.label + '"' : descriptorForFilter.id;
    const conditionForFilter = describeFieldForPageLayout(fieldForFilter) + ' ' + predicateForFilter.op
      + (specForFilter.value != null && String(specForFilter.value).trim() ? ' ' + truncateForPageLayout(specForFilter.value, 30) : '');
    const changeForFilter = {
      id: newChangeIdForPageLayout(),
      action: 'filter',
      binding: bindingForFilter,
      field: fieldForFilter,
      mode: modeForFilter,
      predicate: predicateForFilter.test,
      stats: null,
      replaySpec: {
        action: 'filter',
        collection: collectionLocatorForPageLayout(descriptorForFilter),
        field: fieldLocatorForPageLayout(fieldForFilter),
        op: predicateForFilter.op,
        value: typeof specForFilter.value === 'number' ? specForFilter.value : (specForFilter.value == null ? '' : String(specForFilter.value).slice(0, 200)),
        mode: modeForFilter,
        parse: predicateForFilter.kind
      },
      description: userLabelForPageLayout(specForFilter, (modeForFilter === 'keep' ? 'Showing only ' : 'Hid ') + 'items in ' + collectionNameForFilter + ' where ' + conditionForFilter)
    };
    bindingForFilter.filterChanges.push(changeForFilter);
    bindingForFilter.paused = false;
    registerChangeForPageLayout(changeForFilter);
    reapplyBindingForPageLayout(bindingForFilter);
    const statsForFilter = changeForFilter.stats || { items: 0, matched: 0, hidden: 0 };
    if (!statsForFilter.items) {
      const unreadableForFilter = unreadableCollectionErrorForPageLayout(bindingForFilter, descriptorForFilter.id);
      discardChangeForPageLayout(changeForFilter);
      return { ok: false, error: unreadableForFilter };
    }
    const resultForFilter = {
      change_id: changeForFilter.id,
      action: 'filter',
      description: changeForFilter.description,
      items: statsForFilter.items,
      matched: statsForFilter.matched,
      hidden: statsForFilter.hidden,
      parse: predicateForFilter.kind
    };
    if (!statsForFilter.hidden) {
      resultForFilter.note = 'No loaded items were hidden. Check the field, op and value against the examples or values in the scan; items that load later are still checked.';
    } else if (statsForFilter.hidden === statsForFilter.items) {
      resultForFilter.note = 'Every loaded item was hidden. If that is not what the user asked for, undo this change and check the op and mode.';
    }
    return { ok: true, result: resultForFilter };
  }

  function resolveTargetForPageLayout(rawTargetForResolve) {
    const idForTarget = normalizeForPageLayout(rawTargetForResolve).toLowerCase();
    if (!idForTarget) return { error: 'This change needs a target: a region id (r1, r2, ...) or a collection id (c1, c2, ...) from the latest scan.' };
    if (idForTarget.charAt(0) === 'r') {
      const regionForTarget = scanStateForPageLayout.regions.get(idForTarget);
      if (!regionForTarget) return { error: 'Region "' + rawTargetForResolve + '" is not in the latest scan. Run operation "scan" and use one of its region ids.' };
      if (!regionForTarget.el.isConnected) return { error: 'Region ' + idForTarget + ' is no longer on the page. Run operation "scan" again.' };
      return { region: regionForTarget, id: idForTarget };
    }
    const resolvedForTarget = resolveCollectionForPageLayout(idForTarget);
    if (resolvedForTarget.error) return { error: resolvedForTarget.error };
    return { descriptor: resolvedForTarget.descriptor, id: idForTarget };
  }

  // Shared by hide and style: declarations on one region element, on a collection's container, or
  // (live) on every item of a collection or one field of every item.
  function applyDeclarationsForPageLayout(specForDecl, declarationsForDecl, actionForDecl, fallbackDescriptionForDecl, overrideForDecl) {
    const targetForDecl = overrideForDecl ? overrideForDecl.target : resolveTargetForPageLayout(specForDecl.target || specForDecl.region || specForDecl.collection);
    if (targetForDecl.error) return { ok: false, error: targetForDecl.error };
    const partForDecl = normalizeForPageLayout(specForDecl.part).toLowerCase();
    const hasFieldForDecl = overrideForDecl
      ? !!overrideForDecl.field
      : specForDecl.field != null && normalizeForPageLayout(specForDecl.field) !== '';
    const cssForReplay = {};
    if (actionForDecl === 'style') {
      declarationsForDecl.forEach(function (declarationForReplay) { cssForReplay[declarationForReplay.prop] = declarationForReplay.value; });
    }
    function replaySpecForDecl(targetSpecForReplay) {
      const specForReplay = Object.assign({ action: actionForDecl }, targetSpecForReplay);
      if (actionForDecl === 'style') specForReplay.css = cssForReplay;
      return specForReplay;
    }

    if (targetForDecl.region) {
      if (partForDecl === 'items' || hasFieldForDecl) return { ok: false, error: 'part and field apply only to a collection target (c1, c2, ...), not to a region.' };
      const changeForRegion = {
        id: newChangeIdForPageLayout(),
        action: actionForDecl,
        element: targetForDecl.region.el,
        description: userLabelForPageLayout(specForDecl, fallbackDescriptionForDecl('"' + (targetForDecl.region.label || targetForDecl.id) + '"')),
        replaySpec: replaySpecForDecl({ region: regionLocatorForPageLayout(targetForDecl.region) })
      };
      declarationsForDecl.forEach(function (declarationForRegion) {
        ledgerSetForPageLayout(targetForDecl.region.el, declarationForRegion.prop, declarationForRegion.value, changeForRegion.id);
      });
      registerChangeForPageLayout(changeForRegion);
      return { ok: true, change: changeForRegion, elements: 1 };
    }

    const descriptorForDecl = targetForDecl.descriptor;
    const collectionNameForDecl = descriptorForDecl.label ? '"' + descriptorForDecl.label + '"' : descriptorForDecl.id;
    // Hiding a collection hides its items (live, so later items are hidden too) rather than its
    // common ancestor, which for a list split into sections can be most of the page. Each section's
    // own parent is hidden instead when it holds nothing but items (applyContainerHideForPageLayout).
    const perItemForDecl = actionForDecl === 'hide' || partForDecl === 'items' || hasFieldForDecl;
    if (!perItemForDecl) {
      const changeForContainer = {
        id: newChangeIdForPageLayout(),
        action: actionForDecl,
        element: descriptorForDecl.lca,
        description: userLabelForPageLayout(specForDecl, fallbackDescriptionForDecl('the container of ' + collectionNameForDecl)),
        replaySpec: replaySpecForDecl({ collection: collectionLocatorForPageLayout(descriptorForDecl) })
      };
      declarationsForDecl.forEach(function (declarationForContainer) {
        ledgerSetForPageLayout(descriptorForDecl.lca, declarationForContainer.prop, declarationForContainer.value, changeForContainer.id);
      });
      registerChangeForPageLayout(changeForContainer);
      return { ok: true, change: changeForContainer, elements: 1 };
    }
    let fieldForDecl = null;
    if (hasFieldForDecl) {
      fieldForDecl = overrideForDecl ? overrideForDecl.field : resolveFieldForPageLayout(descriptorForDecl, specForDecl.field, false);
      if (fieldForDecl.error) return { ok: false, error: fieldForDecl.error };
    }
    const hidesWholeItemsForDecl = actionForDecl === 'hide' && !fieldForDecl;
    if (hidesWholeItemsForDecl) {
      const tooManyForDecl = tooManyToHideErrorForPageLayout(descriptorForDecl, !!overrideForDecl);
      if (tooManyForDecl) return { ok: false, error: tooManyForDecl };
    }
    const itemsTargetForReplay = { collection: collectionLocatorForPageLayout(descriptorForDecl), part: 'items' };
    if (fieldForDecl) itemsTargetForReplay.field = fieldLocatorForPageLayout(fieldForDecl);
    const bindingForDecl = getOrCreateBindingForPageLayout(descriptorForDecl);
    const changeForItems = {
      id: newChangeIdForPageLayout(),
      action: actionForDecl,
      binding: bindingForDecl,
      field: fieldForDecl || null,
      declarations: declarationsForDecl,
      hiddenContainers: hidesWholeItemsForDecl ? new Set() : null,
      stats: null,
      replaySpec: replaySpecForDecl(itemsTargetForReplay),
      description: userLabelForPageLayout(specForDecl, fallbackDescriptionForDecl(
        (fieldForDecl ? describeFieldForPageLayout(fieldForDecl) + ' of every item in ' : 'every item in ') + collectionNameForDecl
      ))
    };
    bindingForDecl.itemStyleChanges.push(changeForItems);
    bindingForDecl.paused = false;
    registerChangeForPageLayout(changeForItems);
    reapplyBindingForPageLayout(bindingForDecl);
    const statsForItems = changeForItems.stats || { items: 0, styled: 0 };
    if (!statsForItems.styled) {
      const errorForItems = statsForItems.items
        ? 'None of the items in ' + descriptorForDecl.id + ' have that field right now.'
        : unreadableCollectionErrorForPageLayout(bindingForDecl, descriptorForDecl.id);
      discardChangeForPageLayout(changeForItems);
      return { ok: false, error: errorForItems };
    }
    return { ok: true, change: changeForItems, elements: statsForItems.styled };
  }

  function applyHideForPageLayout(specForHide, overrideForHide) {
    const outcomeForHide = applyDeclarationsForPageLayout(specForHide, [{ prop: 'display', value: 'none' }], 'hide', function (nameForHide) {
      return 'Hid ' + nameForHide;
    }, overrideForHide);
    if (!outcomeForHide.ok) return outcomeForHide;
    return {
      ok: true,
      result: {
        change_id: outcomeForHide.change.id,
        action: 'hide',
        description: outcomeForHide.change.description,
        elements: outcomeForHide.elements
      }
    };
  }

  function applyStyleForPageLayout(specForStyle, overrideForStyle) {
    const rulesForStyle = getRulesForPageLayout();
    const sanitizedForStyle = rulesForStyle.sanitizeStyleDeclarations(specForStyle.css);
    const rejectedForStyle = sanitizedForStyle.rejected.slice();
    const acceptedForStyle = [];
    sanitizedForStyle.declarations.forEach(function (declarationForSupports) {
      const supportedForStyle = typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports(declarationForSupports.prop, declarationForSupports.value);
      if (supportedForStyle) acceptedForStyle.push(declarationForSupports);
      else rejectedForStyle.push({ prop: declarationForSupports.prop, reason: 'the browser does not accept "' + declarationForSupports.value + '" for this property' });
    });
    if (!acceptedForStyle.length) {
      return {
        ok: false,
        error: (sanitizedForStyle.error && !sanitizedForStyle.declarations.length ? sanitizedForStyle.error + ' ' : 'No usable CSS declarations. ')
          + (rejectedForStyle.length ? 'Rejected: ' + rejectedForStyle.map(function (rForMsg) { return rForMsg.prop + ' (' + rForMsg.reason + ')'; }).join('; ') + '.' : '')
      };
    }
    const summaryForStyle = acceptedForStyle.map(function (dForSummary) { return dForSummary.prop + ': ' + dForSummary.value; }).join('; ');
    const outcomeForStyle = applyDeclarationsForPageLayout(specForStyle, acceptedForStyle, 'style', function (nameForStyle) {
      return 'Restyled ' + nameForStyle + ' (' + truncateForPageLayout(summaryForStyle, 60) + ')';
    }, overrideForStyle);
    if (!outcomeForStyle.ok) return outcomeForStyle;
    const resultForStyle = {
      change_id: outcomeForStyle.change.id,
      action: 'style',
      description: outcomeForStyle.change.description,
      elements: outcomeForStyle.elements,
      applied: acceptedForStyle
    };
    if (rejectedForStyle.length) resultForStyle.rejected = rejectedForStyle;
    return { ok: true, result: resultForStyle };
  }

  // overrideForOne is passed only by a chat replay and carries targets already found on the page.
  // It never comes from the model's arguments.
  function applyOneChangeForPageLayout(specForOne, overrideForOne) {
    if (!specForOne || typeof specForOne !== 'object' || Array.isArray(specForOne)) {
      return { ok: false, error: 'Each change must be an object with an action.' };
    }
    const actionForOne = normalizeForPageLayout(specForOne.action).toLowerCase();
    switch (actionForOne) {
      case 'sort': return applySortForPageLayout(specForOne, overrideForOne);
      case 'filter': return applyFilterForPageLayout(specForOne, overrideForOne);
      case 'hide': return applyHideForPageLayout(specForOne, overrideForOne);
      case 'style': return applyStyleForPageLayout(specForOne, overrideForOne);
      case 'show':
        return { ok: false, error: 'There is no show action. To bring back something a change hid, undo that change (operation "undo" with its change_id). To show only the items that match a condition, use filter with mode "keep".' };
      default:
        return { ok: false, error: 'Unknown action "' + specForOne.action + '". Use sort, filter, hide, or style.' };
    }
  }

  // Tags a change with the chat and the key the chat's records name it by, so the chat can offer
  // Undo for it while it is on the page.
  function tagChangeForPageLayout(changeForTag, chatIdForTag, keyForTag) {
    changeForTag.chatId = chatIdForTag != null && chatIdForTag !== '' ? String(chatIdForTag) : '';
    changeForTag.key = keyForTag;
    if (changeForTag.replaySpec) changeForTag.replaySpec.label = truncateForPageLayout(changeForTag.description, 80);
  }

  function runApplyForPageLayout(argsForApply, contextForApply) {
    const ctxForApply = contextForApply || {};
    const keyPrefixForApply = ctxForApply.toolCallId ? String(ctxForApply.toolCallId).slice(0, 100) : 'local-' + Math.random().toString(36).slice(2, 10);
    if (!getRulesForPageLayout()) return { ok: false, error: 'The page layout rules are not loaded in this tab.' };
    let specsForApply = argsForApply.changes;
    if (!Array.isArray(specsForApply) && argsForApply.change && typeof argsForApply.change === 'object') specsForApply = [argsForApply.change];
    if (!Array.isArray(specsForApply) || !specsForApply.length) {
      return { ok: false, error: 'apply needs a changes array with at least one change, e.g. [{ "action": "sort", "collection": "c1", "field": "b", "order": "desc" }].' };
    }
    if (specsForApply.length > MAX_CHANGES_PER_APPLY_FOR_PAGE_LAYOUT) {
      return { ok: false, error: 'At most ' + MAX_CHANGES_PER_APPLY_FOR_PAGE_LAYOUT + ' changes per apply call.' };
    }
    if (!scanStateForPageLayout.scannedAt) {
      return { ok: false, error: 'Run page_layout with operation "scan" first; apply refers to the region and collection ids it returns.' };
    }
    const appliedForApply = [];
    const failedForApply = [];
    const recordsForApply = [];
    specsForApply.forEach(function (specForApply, indexForApply) {
      if (changesForPageLayout.length >= MAX_ACTIVE_CHANGES_FOR_PAGE_LAYOUT) {
        failedForApply.push({ index: indexForApply, error: 'Too many active changes on this page (max ' + MAX_ACTIVE_CHANGES_FOR_PAGE_LAYOUT + '). Undo or reset some first.' });
        return;
      }
      let outcomeForApply;
      try {
        outcomeForApply = applyOneChangeForPageLayout(specForApply);
      } catch (eApplyForPageLayout) {
        outcomeForApply = { ok: false, error: 'This change failed: ' + ((eApplyForPageLayout && eApplyForPageLayout.message) || String(eApplyForPageLayout)) };
      }
      if (!outcomeForApply.ok) {
        failedForApply.push({ index: indexForApply, action: specForApply && specForApply.action, error: outcomeForApply.error });
        return;
      }
      appliedForApply.push(outcomeForApply.result);
      const changeForRecord = findChangeForPageLayout(outcomeForApply.result.change_id);
      if (!changeForRecord) return;
      tagChangeForPageLayout(changeForRecord, ctxForApply.chatId, keyPrefixForApply + ':' + indexForApply);
      if (!changeForRecord.replaySpec) return;
      const recordForApply = {
        key: changeForRecord.key,
        change_id: changeForRecord.id,
        action: changeForRecord.action,
        description: changeForRecord.description,
        spec: changeForRecord.replaySpec
      };
      if (outcomeForApply.replaced) recordForApply.replaces = outcomeForApply.replaced;
      if (outcomeForApply.replacedKey) recordForApply.replaces_key = outcomeForApply.replacedKey;
      recordsForApply.push(recordForApply);
    });
    renderChipForPageLayout();
    const resultForApply = {
      ok: appliedForApply.length > 0,
      applied: appliedForApply,
      active_changes: summarizeActiveChangesForPageLayout()
    };
    if (failedForApply.length) resultForApply.failed = failedForApply;
    if (!appliedForApply.length) resultForApply.error = failedForApply.length === 1 ? failedForApply[0].error : 'None of the changes could be applied; see failed.';
    else resultForApply.note = 'The user can undo each change from the chat or the on-page bar, and can apply it again from the chat on a later visit to this site. Changes last until the page reloads.';
    // Stored on the tool message for the chat's replay buttons and stripped before the model sees
    // the result.
    if (recordsForApply.length) resultForApply._pageChanges = pageChangesRecordForPageLayout('apply', { items: recordsForApply });
    return resultForApply;
  }

  // ---------------------------------------------------------------- undo / reset

  function undoChangeForPageLayout(changeForUndo, optionsForUndo) {
    const optsForUndo = optionsForUndo || {};
    const bindingForUndo = changeForUndo.binding || null;
    if (changeForUndo.action === 'sort' && bindingForUndo) {
      if (bindingForUndo.sortChange === changeForUndo) bindingForUndo.sortChange = null;
      if (changeForUndo.usedDomMoves && bindingForUndo.watchRoot.isConnected) {
        disconnectBindingObserverForPageLayout(bindingForUndo);
        const currentItemsForUndo = queryBindingItemsForPageLayout(bindingForUndo);
        groupByParentForPageLayout(currentItemsForUndo).forEach(function (groupItemsForUndo) {
          const groupSetForUndo = new Set(groupItemsForUndo);
          const naturalForUndo = changeForUndo.naturalOrder.filter(function (itemForNatural) { return groupSetForUndo.has(itemForNatural); });
          const naturalSetForUndo = new Set(naturalForUndo);
          const extrasForUndo = groupItemsForUndo.filter(function (itemForExtra) { return !naturalSetForUndo.has(itemForExtra); });
          placeIntoSlotsForPageLayout(groupItemsForUndo, naturalForUndo.concat(extrasForUndo));
        });
      }
    } else if (changeForUndo.action === 'filter' && bindingForUndo) {
      bindingForUndo.filterChanges = bindingForUndo.filterChanges.filter(function (cForKeep) { return cForKeep !== changeForUndo; });
    } else if (bindingForUndo) {
      bindingForUndo.itemStyleChanges = bindingForUndo.itemStyleChanges.filter(function (cForKeep) { return cForKeep !== changeForUndo; });
    }
    ledgerRemoveChangeForPageLayout(changeForUndo.id);
    const indexForUndo = changesForPageLayout.indexOf(changeForUndo);
    if (indexForUndo !== -1) changesForPageLayout.splice(indexForUndo, 1);
    if (bindingForUndo) {
      if (bindingHasChangesForPageLayout(bindingForUndo)) {
        // Remaining changes on the same collection may depend on what this one hid (a sort now has
        // un-hidden items to place), so run them again. The sort branch above disconnected the
        // observer, so a caller that skips the re-run still needs it watching again.
        if (!optsForUndo.skipReapply && bindingForUndo.watchRoot.isConnected) reapplyBindingForPageLayout(bindingForUndo);
        else connectBindingObserverForPageLayout(bindingForUndo);
      } else {
        releaseBindingIfIdleForPageLayout(bindingForUndo);
      }
    }
  }

  function findChangeForPageLayout(rawIdForFind) {
    const idForFind = normalizeForPageLayout(rawIdForFind).toUpperCase();
    for (let iForFind = 0; iForFind < changesForPageLayout.length; iForFind++) {
      if (changesForPageLayout[iForFind].id.toUpperCase() === idForFind) return changesForPageLayout[iForFind];
    }
    return null;
  }

  function runUndoForPageLayout(argsForUndo) {
    if (!changesForPageLayout.length) return { ok: false, error: 'There are no layout changes on this page to undo.' };
    const rawIdForUndo = normalizeForPageLayout(argsForUndo.change_id);
    const changeForRunUndo = rawIdForUndo && rawIdForUndo.toLowerCase() !== 'last'
      ? findChangeForPageLayout(rawIdForUndo)
      : changesForPageLayout[changesForPageLayout.length - 1];
    if (!changeForRunUndo) {
      return {
        ok: false,
        error: 'No active change "' + rawIdForUndo + '". Active changes: ' + changesForPageLayout.map(function (cForList) { return cForList.id; }).join(', ') + '.'
      };
    }
    const descriptionForUndo = changeForRunUndo.description;
    undoChangeForPageLayout(changeForRunUndo, {});
    renderChipForPageLayout();
    return {
      ok: true,
      undone: { change_id: changeForRunUndo.id, description: descriptionForUndo },
      active_changes: summarizeActiveChangesForPageLayout(),
      _pageChanges: pageChangesRecordForPageLayout('undo', { changeIds: [changeForRunUndo.id], keys: [changeForRunUndo.key || ''] })
    };
  }

  function resetAllForPageLayout() {
    let countForReset = 0;
    while (changesForPageLayout.length) {
      undoChangeForPageLayout(changesForPageLayout[changesForPageLayout.length - 1], { skipReapply: true });
      countForReset++;
    }
    bindingsForPageLayout.slice().forEach(releaseBindingIfIdleForPageLayout);
    return countForReset;
  }

  function runResetForPageLayout() {
    const idsForRunReset = changesForPageLayout.map(function (changeForId) { return changeForId.id; });
    const keysForRunReset = changesForPageLayout.map(function (changeForKey) { return changeForKey.key || ''; });
    const countForRunReset = resetAllForPageLayout();
    renderChipForPageLayout();
    const resultForRunReset = {
      ok: true,
      undone: countForRunReset,
      note: countForRunReset ? 'All layout changes on this page were undone.' : 'There were no layout changes to undo.'
    };
    if (idsForRunReset.length) resultForRunReset._pageChanges = pageChangesRecordForPageLayout('reset', { changeIds: idsForRunReset, keys: keysForRunReset });
    return resultForRunReset;
  }

  function pageChangesRecordForPageLayout(opForRecord, fieldsForRecord) {
    return Object.assign({ v: 1, op: opForRecord, origin: location.origin, session: sessionIdForPageLayout }, fieldsForRecord);
  }

  // ---------------------------------------------------------------- chat controls
  //
  // The chat panel runs in this same content-script world and calls these directly. Replay is
  // started only by the user clicking a reply's button; the model has no way to call it.

  function listChatChangesForPageLayout(chatIdForList) {
    const chatKeyForList = chatIdForList != null ? String(chatIdForList) : '';
    return changesForPageLayout.filter(function (changeForList) {
      return !!changeForList.key && changeForList.chatId === chatKeyForList;
    }).map(function (changeForList) {
      return {
        key: changeForList.key,
        change_id: changeForList.id,
        description: changeForList.description,
        paused: !!(changeForList.binding && changeForList.binding.paused)
      };
    });
  }

  function undoChatChangesForPageLayout(chatIdForUndo, keysForUndo) {
    const chatKeyForUndo = chatIdForUndo != null ? String(chatIdForUndo) : '';
    const keySetForUndo = new Set(Array.isArray(keysForUndo) ? keysForUndo : []);
    const matchesForUndo = changesForPageLayout.filter(function (changeForMatch) {
      return changeForMatch.chatId === chatKeyForUndo && keySetForUndo.has(changeForMatch.key);
    });
    matchesForUndo.slice().reverse().forEach(function (changeForChatUndo) { undoChangeForPageLayout(changeForChatUndo, {}); });
    if (matchesForUndo.length) renderChipForPageLayout();
    return matchesForUndo.length;
  }

  function sanitizedReplayItemsForPageLayout(itemsForSanitize) {
    const rulesForSanitize = getRulesForPageLayout();
    if (!rulesForSanitize || !Array.isArray(itemsForSanitize)) return [];
    return itemsForSanitize.map(function (itemForSanitize) {
      if (!itemForSanitize || typeof itemForSanitize.key !== 'string' || !itemForSanitize.key) return null;
      const specForSanitize = rulesForSanitize.sanitizeReplaySpec(itemForSanitize.spec);
      return specForSanitize ? { key: itemForSanitize.key, spec: specForSanitize } : null;
    });
  }

  // Which of the given changes can be found on the page as it is now. Changes nothing. The cost is
  // one lookup per list or region named, so the chat asks once per refresh for every change it
  // shows rather than once per reply.
  function checkReplayForPageLayout(itemsForCheck) {
    if (isStaleForPageLayout()) return [];
    const leafCacheForCheck = new Map();
    const collectionCacheForCheck = new Map();
    const rawItemsForCheck = Array.isArray(itemsForCheck) ? itemsForCheck : [];
    return sanitizedReplayItemsForPageLayout(rawItemsForCheck).map(function (itemForCheck, indexForCheck) {
      const keyForCheck = itemForCheck ? itemForCheck.key : String((rawItemsForCheck[indexForCheck] || {}).key || '');
      if (!itemForCheck) return { key: keyForCheck, found: false };
      let foundForCheck = false;
      try { foundForCheck = !!resolveReplayTargetsForPageLayout(itemForCheck.spec, leafCacheForCheck, collectionCacheForCheck); } catch (eCheckForPageLayout) { foundForCheck = false; }
      return { key: keyForCheck, found: foundForCheck };
    });
  }

  // Applies a reply's changes, or a whole chat's, again in the order they were first made. A change
  // with the same key that is still on the page is undone first, so replaying twice never stacks
  // two copies. Once the page holds its limit of changes, the rest fail without being looked up. A
  // failure whose target is not on the page carries missing: true, so the chat can tell that apart
  // from a refusal.
  function replayForPageLayout(itemsForReplay, metaForReplay) {
    if (isStaleForPageLayout()) return { ok: false, error: 'This tab is running an outdated copy of the extension. Reload the page and try again.', results: [] };
    const chatIdForReplay = metaForReplay && metaForReplay.chatId != null ? metaForReplay.chatId : '';
    const rawItemsForReplay = Array.isArray(itemsForReplay) ? itemsForReplay : [];
    undoChatChangesForPageLayout(chatIdForReplay, rawItemsForReplay.map(function (itemForKey) { return itemForKey && itemForKey.key; }));
    const leafCacheForReplay = new Map();
    const resultsForReplay = sanitizedReplayItemsForPageLayout(rawItemsForReplay).map(function (itemForReplay, indexForReplay) {
      const keyForReplay = itemForReplay ? itemForReplay.key : String((rawItemsForReplay[indexForReplay] || {}).key || '');
      if (!itemForReplay) return { key: keyForReplay, ok: false, error: 'This change was saved in a form this version cannot read.' };
      if (changesForPageLayout.length >= MAX_ACTIVE_CHANGES_FOR_PAGE_LAYOUT) {
        return { key: keyForReplay, ok: false, error: 'Too many changes on this page. Undo some first.' };
      }
      let outcomeForReplay;
      try {
        const targetsForReplay = resolveReplayTargetsForPageLayout(itemForReplay.spec, leafCacheForReplay);
        if (!targetsForReplay) return { key: keyForReplay, ok: false, missing: true, error: 'That part of the page is not here now.' };
        outcomeForReplay = applyOneChangeForPageLayout(itemForReplay.spec, targetsForReplay);
      } catch (eReplayForPageLayout) {
        outcomeForReplay = { ok: false, error: (eReplayForPageLayout && eReplayForPageLayout.message) || String(eReplayForPageLayout) };
      }
      if (!outcomeForReplay.ok) return { key: keyForReplay, ok: false, error: outcomeForReplay.error };
      const changeForReplay = findChangeForPageLayout(outcomeForReplay.result.change_id);
      if (changeForReplay) tagChangeForPageLayout(changeForReplay, chatIdForReplay, keyForReplay);
      return { key: keyForReplay, ok: true, change_id: outcomeForReplay.result.change_id };
    });
    renderChipForPageLayout();
    const appliedCountForReplay = resultsForReplay.filter(function (resultForCount) { return resultForCount.ok; }).length;
    return { ok: appliedCountForReplay > 0, applied: appliedCountForReplay, results: resultsForReplay };
  }

  function subscribeForPageLayout(listenerForSubscribe) {
    if (typeof listenerForSubscribe !== 'function') return function () {};
    listenersForPageLayout.add(listenerForSubscribe);
    return function () { listenersForPageLayout.delete(listenerForSubscribe); };
  }

  function notifyListenersForPageLayout() {
    listenersForPageLayout.forEach(function (listenerForNotify) {
      try { listenerForNotify(); } catch (eNotifyForPageLayout) { /* a listener must not break the page change */ }
    });
  }

  function summarizeActiveChangesForPageLayout() {
    return changesForPageLayout.map(function (changeForSummary) {
      const summaryForChange = { change_id: changeForSummary.id, action: changeForSummary.action, description: changeForSummary.description };
      if (changeForSummary.binding && changeForSummary.binding.paused) summaryForChange.paused = true;
      return summaryForChange;
    });
  }

  // ---------------------------------------------------------------- pruning and teardown

  function isChangeAliveForPageLayout(changeForAlive) {
    if (changeForAlive.binding) return changeForAlive.binding.watchRoot.isConnected;
    if (changeForAlive.element) return changeForAlive.element.isConnected;
    return true;
  }

  // A change whose elements left the page (a single-page app navigated and threw the old view
  // away) is dropped, so the chip never offers to undo something that is no longer there.
  function pruneTickForPageLayout() {
    if (isStaleForPageLayout()) {
      teardownForPageLayout();
      return;
    }
    let prunedForTick = false;
    changesForPageLayout.slice().forEach(function (changeForTick) {
      if (isChangeAliveForPageLayout(changeForTick)) return;
      undoChangeForPageLayout(changeForTick, { skipReapply: true });
      prunedForTick = true;
    });
    if (prunedForTick) renderChipForPageLayout();
    if (!changesForPageLayout.length) stopPruneTimerForPageLayout();
  }

  function ensurePruneTimerForPageLayout() {
    if (pruneTimerForPageLayout) return;
    pruneTimerForPageLayout = setInterval(pruneTickForPageLayout, PRUNE_INTERVAL_MS_FOR_PAGE_LAYOUT);
  }

  function stopPruneTimerForPageLayout() {
    if (!pruneTimerForPageLayout) return;
    clearInterval(pruneTimerForPageLayout);
    pruneTimerForPageLayout = null;
  }

  function teardownForPageLayout() {
    try { resetAllForPageLayout(); } catch (eResetForTeardown) { /* keep tearing down */ }
    bindingsForPageLayout.slice().forEach(function (bindingForTeardown) {
      disconnectBindingObserverForPageLayout(bindingForTeardown);
      if (bindingForTeardown.debounceTimer) clearTimeout(bindingForTeardown.debounceTimer);
    });
    bindingsForPageLayout.length = 0;
    stopPruneTimerForPageLayout();
    removeChipForPageLayout();
    scanStateForPageLayout.regions = new Map();
    scanStateForPageLayout.collections = new Map();
    scanStateForPageLayout.scannedAt = 0;
    notifyListenersForPageLayout();
    listenersForPageLayout.clear();
  }

  // ---------------------------------------------------------------- on-page chip

  const CHIP_CSS_FOR_PAGE_LAYOUT = `
:host { all: initial; }
[hidden] { display: none !important; }
.lx {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483646;
  box-sizing: border-box;
  width: max-content;
  max-width: min(440px, calc(100vw - 32px));
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #09090b;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
.lx-bar { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; }
.lx-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.lx-btn {
  flex: 0 0 auto;
  appearance: none;
  margin: 0;
  border: 1px solid #e4e4e7;
  background: #ffffff;
  color: inherit;
  font: inherit;
  font-weight: 500;
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
}
.lx-btn:hover { background: #f4f4f5; }
.lx-btn:focus-visible { outline: 2px solid #a1a1aa; outline-offset: 1px; }
.lx-btn-primary { background: #18181b; border-color: #18181b; color: #fafafa; }
.lx-btn-primary:hover { background: #27272a; }
.lx-close { border-color: transparent; padding: 3px 7px; font-size: 14px; line-height: 1; color: #71717a; }
.lx-list { list-style: none; margin: 0; padding: 4px; border-top: 1px solid #e4e4e7; max-height: 40vh; overflow-y: auto; }
.lx-item { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 8px; border-radius: 6px; }
.lx-item:hover { background: #f4f4f5; }
.lx-item-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lx-item-note { color: #71717a; }
@media (prefers-color-scheme: dark) {
  .lx { color: #fafafa; background: #18181b; border-color: #3f3f46; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
  .lx-btn { background: #18181b; border-color: #3f3f46; }
  .lx-btn:hover, .lx-item:hover { background: #27272a; }
  .lx-btn-primary { background: #fafafa; border-color: #fafafa; color: #18181b; }
  .lx-btn-primary:hover { background: #e4e4e7; }
  .lx-close { border-color: transparent; color: #a1a1aa; }
  .lx-list { border-top-color: #3f3f46; }
  .lx-item-note { color: #a1a1aa; }
}
@media (max-width: 480px) {
  .lx { left: 8px; right: 8px; bottom: 8px; width: auto; max-width: none; }
}
`;

  function removeChipForPageLayout() {
    if (chipForPageLayout && chipForPageLayout.host) {
      try { chipForPageLayout.host.remove(); } catch (eRemoveChip) { /* already gone */ }
    }
    chipForPageLayout = null;
    const strayHostForPageLayout = document.getElementById(CHIP_HOST_ID_FOR_PAGE_LAYOUT);
    if (strayHostForPageLayout) strayHostForPageLayout.remove();
  }

  function onChipClickForPageLayout(eventForChip) {
    const targetForChip = eventForChip.target && typeof eventForChip.target.closest === 'function'
      ? eventForChip.target.closest('[data-action]')
      : null;
    if (!targetForChip || !chipForPageLayout) return;
    switch (targetForChip.dataset.action) {
      case 'layout-toggle-list':
        chipForPageLayout.expanded = !chipForPageLayout.expanded;
        renderChipForPageLayout();
        break;
      case 'layout-undo-last': {
        const lastForChip = changesForPageLayout[changesForPageLayout.length - 1];
        if (lastForChip) undoChangeForPageLayout(lastForChip, {});
        renderChipForPageLayout();
        break;
      }
      case 'layout-undo-change': {
        const changeForChip = findChangeForPageLayout(targetForChip.dataset.changeId);
        if (changeForChip) undoChangeForPageLayout(changeForChip, {});
        renderChipForPageLayout();
        break;
      }
      case 'layout-reset':
        resetAllForPageLayout();
        renderChipForPageLayout();
        break;
      case 'layout-dismiss':
        chipDismissedForPageLayout = true;
        removeChipForPageLayout();
        break;
      default:
        break;
    }
  }

  function makeChipButtonForPageLayout(labelForButton, actionForButton, primaryForButton) {
    const buttonForChip = document.createElement('button');
    buttonForChip.type = 'button';
    buttonForChip.className = primaryForButton ? 'lx-btn lx-btn-primary' : 'lx-btn';
    buttonForChip.textContent = labelForButton;
    buttonForChip.dataset.action = actionForButton;
    return buttonForChip;
  }

  function ensureChipForPageLayout() {
    if (chipForPageLayout && chipForPageLayout.host.isConnected) return chipForPageLayout;
    // The page can remove the host (a single-page app replacing body content); rebuild it with the
    // list in the state the user left it.
    const expandedBeforeForChip = chipForPageLayout ? chipForPageLayout.expanded : false;
    removeChipForPageLayout();
    const mountForChip = document.body || document.documentElement;
    if (!mountForChip) return null;
    const hostForChip = document.createElement('div');
    hostForChip.id = CHIP_HOST_ID_FOR_PAGE_LAYOUT;
    // Closed: transient UI rebuilt on demand, and page scripts (and the page tools) cannot reach
    // its buttons.
    const rootForChip = hostForChip.attachShadow({ mode: 'closed' });
    const styleForChip = document.createElement('style');
    styleForChip.textContent = CHIP_CSS_FOR_PAGE_LAYOUT;
    rootForChip.appendChild(styleForChip);

    const wrapForChip = document.createElement('div');
    wrapForChip.className = 'lx';
    wrapForChip.setAttribute('role', 'region');
    wrapForChip.setAttribute('aria-label', 'Page layout changes');

    const barForChip = document.createElement('div');
    barForChip.className = 'lx-bar';
    const titleForChip = document.createElement('span');
    titleForChip.className = 'lx-title';
    const toggleForChip = makeChipButtonForPageLayout('Changes', 'layout-toggle-list', false);
    toggleForChip.setAttribute('aria-expanded', 'false');
    const undoForChip = makeChipButtonForPageLayout('Undo', 'layout-undo-last', true);
    const resetForChip = makeChipButtonForPageLayout('Reset', 'layout-reset', false);
    resetForChip.title = 'Undo every layout change on this page';
    const closeForChip = makeChipButtonForPageLayout('\u00d7', 'layout-dismiss', false);
    closeForChip.className = 'lx-btn lx-close';
    closeForChip.title = 'Hide this bar until the page reloads. Changes stay, and the chat can still undo them.';
    closeForChip.setAttribute('aria-label', 'Hide this bar');
    barForChip.appendChild(titleForChip);
    barForChip.appendChild(toggleForChip);
    barForChip.appendChild(undoForChip);
    barForChip.appendChild(resetForChip);
    barForChip.appendChild(closeForChip);

    const listForChip = document.createElement('ul');
    listForChip.className = 'lx-list';
    listForChip.hidden = true;

    wrapForChip.appendChild(barForChip);
    wrapForChip.appendChild(listForChip);
    rootForChip.appendChild(wrapForChip);
    rootForChip.addEventListener('click', onChipClickForPageLayout);
    mountForChip.appendChild(hostForChip);

    chipForPageLayout = {
      host: hostForChip,
      title: titleForChip,
      toggle: toggleForChip,
      undo: undoForChip,
      list: listForChip,
      expanded: expandedBeforeForChip
    };
    return chipForPageLayout;
  }

  // Every change to the set of changes ends here, so this is also where the chat hears about it.
  function renderChipForPageLayout() {
    drawChipForPageLayout();
    notifyListenersForPageLayout();
  }

  function drawChipForPageLayout() {
    if (!changesForPageLayout.length || chipDismissedForPageLayout) {
      removeChipForPageLayout();
      return;
    }
    const chipForRender = ensureChipForPageLayout();
    if (!chipForRender) return;
    const countForRender = changesForPageLayout.length;
    const lastForRender = changesForPageLayout[countForRender - 1];
    chipForRender.title.textContent = countForRender === 1
      ? 'Page layout changed: ' + lastForRender.description
      : 'Page layout changed (' + countForRender + ' changes)';
    chipForRender.title.title = lastForRender.description;
    chipForRender.undo.setAttribute('aria-label', 'Undo: ' + lastForRender.description);
    chipForRender.toggle.hidden = countForRender < 2;
    chipForRender.toggle.setAttribute('aria-expanded', chipForRender.expanded ? 'true' : 'false');
    chipForRender.list.hidden = !(chipForRender.expanded && countForRender > 1);
    while (chipForRender.list.firstChild) chipForRender.list.removeChild(chipForRender.list.firstChild);
    if (chipForRender.list.hidden) return;
    changesForPageLayout.slice().reverse().forEach(function (changeForRow) {
      const rowForChip = document.createElement('li');
      rowForChip.className = 'lx-item';
      const textForRow = document.createElement('span');
      textForRow.className = 'lx-item-text';
      textForRow.textContent = changeForRow.description;
      textForRow.title = changeForRow.description;
      if (changeForRow.binding && changeForRow.binding.paused) {
        const noteForRow = document.createElement('span');
        noteForRow.className = 'lx-item-note';
        noteForRow.textContent = changeForRow.binding.pausedReason === 'size'
          ? ' (stopped following: the list grew too long to keep sorting or filtering)'
          : ' (stopped following: the page keeps redrawing this list)';
        textForRow.appendChild(noteForRow);
      }
      const undoRowForChip = makeChipButtonForPageLayout('Undo', 'layout-undo-change', false);
      undoRowForChip.dataset.changeId = changeForRow.id;
      undoRowForChip.setAttribute('aria-label', 'Undo: ' + changeForRow.description);
      rowForChip.appendChild(textForRow);
      rowForChip.appendChild(undoRowForChip);
      chipForRender.list.appendChild(rowForChip);
    });
  }

  // ---------------------------------------------------------------- entry point

  function runPageLayoutForPageLayout(argsForRun, contextForRun) {
    const argsForEntry = argsForRun || {};
    if (typeof document === 'undefined' || !document.documentElement) {
      return { ok: false, error: 'page_layout needs a web page; this context has no document.' };
    }
    if (isStaleForPageLayout()) {
      return { ok: false, error: 'This tab is running an outdated copy of the extension. Reload the page and try again.' };
    }
    const operationForEntry = normalizeForPageLayout(argsForEntry.operation).toLowerCase();
    switch (operationForEntry) {
      case 'scan': return runScanForPageLayout();
      case 'apply': return runApplyForPageLayout(argsForEntry, contextForRun);
      case 'undo': return runUndoForPageLayout(argsForEntry);
      case 'reset': return runResetForPageLayout();
      default:
        return { ok: false, error: 'Unknown operation "' + (argsForEntry.operation || '') + '". Use scan, apply, undo, or reset.' };
    }
  }

  nsForPageLayout.pageLayout = {
    run: runPageLayoutForPageLayout,
    teardown: teardownForPageLayout,
    hasActiveChanges: function () { return changesForPageLayout.length > 0; },
    listChatChanges: listChatChangesForPageLayout,
    undoChatChanges: undoChatChangesForPageLayout,
    checkReplay: checkReplayForPageLayout,
    replay: replayForPageLayout,
    subscribe: subscribeForPageLayout
  };
  globalScopeForPageLayout.ABChatContent = nsForPageLayout;
})();
