(function () {
  var globalScopeForEmbeddedRegions = globalThis;
  var nsForEmbeddedRegions = globalScopeForEmbeddedRegions.ABChatAgent || {};

  // Pure decision rules for embedded cross-origin regions: a page that renders part of its UI
  // inside an <iframe> served from a different origin (a micro-frontend, an embedded editor, a
  // payment frame). The content script runs only in the top frame and walks only the top
  // document, so it is blind to whatever such an iframe renders; a screenshot still shows it.
  // The DOM scan that finds the iframes and measures them lives in agent/toolExec.js; only the
  // origin/geometry decision and the model-facing wording live here, with no DOM or chrome.*
  // dependency, so they load as an ordinary content-script IIFE and are also unit-testable from
  // Node via the CommonJS tail below.

  // An embedded region is worth flagging when a meaningful share of the viewport is covered by a
  // cross-origin iframe. Below this fraction the blind spot is noise (tracking pixels, tiny
  // widgets) and flagging it would train the model to hand off when it does not need to.
  var MIN_REGION_VIEWPORT_FRACTION_FOR_EMBEDDED_REGIONS = 0.2;

  function isLargeCrossOriginRegionForEmbeddedRegions(descForRegion, minFractionForRegion) {
    if (!descForRegion) return false;
    var topOriginForRegion = descForRegion.topOrigin;
    var srcOriginForRegion = descForRegion.srcOrigin;
    var fractionForRegion = Number(descForRegion.viewportFraction);
    // A missing, opaque ("null"), or same-origin src is reachable or irrelevant: not a blind spot.
    if (!srcOriginForRegion || srcOriginForRegion === 'null') return false;
    if (!topOriginForRegion) return false;
    if (srcOriginForRegion === topOriginForRegion) return false;
    if (!(fractionForRegion > 0)) return false;
    var thresholdForRegion = (typeof minFractionForRegion === 'number' && minFractionForRegion >= 0)
      ? minFractionForRegion : MIN_REGION_VIEWPORT_FRACTION_FOR_EMBEDDED_REGIONS;
    return fractionForRegion >= thresholdForRegion;
  }

  // A control row (a page_observe item) that ends up with no accessible name, value, placeholder,
  // or text is unactionable by a model that targets controls by their words, and surfacing it
  // invites a guessed ref->element mapping. Those rows are typically the offscreen, zero-size
  // wrapper elements a cross-origin iframe or a loading skeleton leaves behind in the top
  // document (the ones a click later rejects as "zero bounding box"). Form fields are exempt: an
  // unnamed input is still worth offering. Pure over the already-built row, so the naming
  // fallbacks the row builder ran (aria-label, innerText, nested img alt, svg title, title attr)
  // are exactly what this judges; anything still blank after those is genuinely nameless.
  function shouldSuppressUnnamedControlRowForEmbeddedRegions(rowForSuppress, categoryForSuppress) {
    if (!rowForSuppress) return false;
    if (categoryForSuppress === 'form_fields') return false;
    if (rowForSuppress.name || rowForSuppress.value || rowForSuppress.placeholder || rowForSuppress.text) return false;
    return true;
  }

  function joinOriginsForEmbeddedRegions(regionsForJoin) {
    var namesForJoin = [];
    for (var iForJoin = 0; iForJoin < regionsForJoin.length; iForJoin++) {
      var originForJoin = regionsForJoin[iForJoin] && regionsForJoin[iForJoin].origin;
      if (originForJoin && namesForJoin.indexOf(originForJoin) === -1) namesForJoin.push(originForJoin);
    }
    return namesForJoin.join(', ');
  }

  // Note appended to a page_read content result. The flattened text cannot include the embedded
  // app, so this points to take_screenshot for its text and to page_observe for its controls.
  function describeReadNoteForEmbeddedRegions(regionsForNote) {
    if (!regionsForNote || !regionsForNote.length) return '';
    var originsForNote = joinOriginsForEmbeddedRegions(regionsForNote);
    return '[Extension note: a large part of this page is an embedded app loaded from a different site (' +
      originsForNote + '). Its text is NOT included above, because the page cannot read text across that ' +
      'boundary; use take_screenshot to read what it shows. To act on its controls, use page_observe, which ' +
      'can list them as ordinary refs you click, type into, or select; if a control you can see is still not ' +
      'listed, tell the user what to click and ask them to do it.]';
  }

  // Note attached to a page_observe result. Same substance, framed for the control list.
  function describeObserveNoteForEmbeddedRegions(regionsForNote) {
    if (!regionsForNote || !regionsForNote.length) return '';
    var originsForNote = joinOriginsForEmbeddedRegions(regionsForNote);
    return 'A large part of this page is an embedded app from a different site (' + originsForNote +
      '); its own controls are not in this list and cannot be targeted by page_act ref. Use take_screenshot ' +
      'to see it, and when the user needs to act inside it, tell them what to click.';
  }

  nsForEmbeddedRegions.embeddedRegions = {
    MIN_REGION_VIEWPORT_FRACTION: MIN_REGION_VIEWPORT_FRACTION_FOR_EMBEDDED_REGIONS,
    isLargeCrossOriginRegion: isLargeCrossOriginRegionForEmbeddedRegions,
    shouldSuppressUnnamedControlRow: shouldSuppressUnnamedControlRowForEmbeddedRegions,
    describeReadNote: describeReadNoteForEmbeddedRegions,
    describeObserveNote: describeObserveNoteForEmbeddedRegions
  };

  globalScopeForEmbeddedRegions.ABChatAgent = nsForEmbeddedRegions;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForEmbeddedRegions.embeddedRegions;
  }
})();
