(function () {
  var globalScopeForCrossFrameAx = globalThis;
  var nsForCrossFrameAx = globalScopeForCrossFrameAx.ABChatBackground || {};

  // Pure helpers for reaching into a cross-origin embedded frame (a micro-frontend the content
  // script cannot see, flagged by embeddedRegions). The content script owns same-frame refs; the
  // service worker owns embedded-frame refs, because it is the only side that can address the
  // frame's nodes (through CDP by backend node id). This module holds the parts with no CDP or
  // chrome.* dependency: the actionable-role filter, the AX-node -> observe-row mapping, the
  // reserved-range ref registry, and the frame-chain coordinate math. The CDP calls that feed
  // them live in cdpAutomation.js. Loaded via importScripts in the service worker; the CommonJS
  // tail makes the same functions unit-testable from Node.

  // Embedded-frame refs live at or above this number so they can never collide with the content
  // script's own monotonic same-frame refs. page_act routes a ref in this range straight to CDP.
  var CROSS_FRAME_REF_BASE_FOR_CROSS_FRAME_AX = 100000;

  // ARIA roles worth offering as actionable controls. Kept narrow: a whole app's AX tree is huge,
  // and a role the model cannot click or type into is noise that pushes useful rows past the cap.
  var ACTIONABLE_AX_ROLES_FOR_CROSS_FRAME_AX = {
    button: 1, link: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1,
    checkbox: 1, radio: 1, switch: 1, combobox: 1, listbox: 1, option: 1,
    textbox: 1, searchbox: 1, slider: 1, spinbutton: 1, treeitem: 1
  };

  function isCrossFrameRefForCrossFrameAx(refForCheck) {
    return typeof refForCheck === 'number' && isFinite(refForCheck) && refForCheck >= CROSS_FRAME_REF_BASE_FOR_CROSS_FRAME_AX;
  }

  function axFieldValueForCrossFrameAx(fieldForValue) {
    if (!fieldForValue) return '';
    if (typeof fieldForValue.value === 'string') return fieldForValue.value;
    if (fieldForValue.value != null) return String(fieldForValue.value);
    return '';
  }

  function axRoleForCrossFrameAx(axNodeForRole) {
    return axNodeForRole ? axFieldValueForCrossFrameAx(axNodeForRole.role).toLowerCase() : '';
  }

  function axNameForCrossFrameAx(axNodeForName) {
    return axNodeForName ? axFieldValueForCrossFrameAx(axNodeForName.name).trim() : '';
  }

  // AX role -> the friendly role word page_observe rows already use, so an embedded-frame row reads
  // the same as a top-frame one. Unknown-but-actionable roles pass through unchanged.
  function observeRoleForAxRoleForCrossFrameAx(axRoleForMap) {
    if (axRoleForMap === 'searchbox') return 'textbox';
    if (axRoleForMap === 'listbox' || axRoleForMap === 'combobox') return 'select';
    return axRoleForMap || 'clickable';
  }

  // An AX node worth surfacing: not ignored, an actionable role, a non-empty accessible name, and
  // a backend node id (the handle CDP needs to click it). A nameless node is dropped for the same
  // reason the same-frame path drops nameless controls: unactionable by a model reasoning by name.
  function shouldIncludeAxNodeForCrossFrameAx(axNodeForInclude) {
    if (!axNodeForInclude) return false;
    if (axNodeForInclude.ignored === true) return false;
    if (!ACTIONABLE_AX_ROLES_FOR_CROSS_FRAME_AX[axRoleForCrossFrameAx(axNodeForInclude)]) return false;
    if (!axNameForCrossFrameAx(axNodeForInclude)) return false;
    if (typeof axNodeForInclude.backendDOMNodeId !== 'number') return false;
    return true;
  }

  // Stable ref registry for embedded-frame controls, owned per tab by the service worker. A ref
  // maps to { frameId, backendNodeId }; the same control keeps its ref across re-observes for as
  // long as the entry lives. reset() runs when the tab navigates: backend node ids belong to the
  // old document and must not resolve against a new one.
  function createCrossFrameRefRegistryForCrossFrameAx() {
    var keyToRefForRegistry = {};
    var refToTargetForRegistry = {};
    var nextRefForRegistry = CROSS_FRAME_REF_BASE_FOR_CROSS_FRAME_AX;
    return {
      refFor: function (frameIdForRef, backendNodeIdForRef) {
        var keyForRef = String(frameIdForRef) + ':' + String(backendNodeIdForRef);
        if (Object.prototype.hasOwnProperty.call(keyToRefForRegistry, keyForRef)) return keyToRefForRegistry[keyForRef];
        nextRefForRegistry += 1;
        keyToRefForRegistry[keyForRef] = nextRefForRegistry;
        refToTargetForRegistry[nextRefForRegistry] = { frameId: frameIdForRef, backendNodeId: backendNodeIdForRef };
        return nextRefForRegistry;
      },
      resolve: function (refForResolve) {
        return refToTargetForRegistry[refForResolve] || null;
      },
      reset: function () {
        keyToRefForRegistry = {};
        refToTargetForRegistry = {};
        nextRefForRegistry = CROSS_FRAME_REF_BASE_FOR_CROSS_FRAME_AX;
      }
    };
  }

  // Build model-facing observe rows from collected embedded-frame controls
  // ([{ frameId, backendNodeId, axNode }]). Assigns each a stable reserved-range ref, and when a
  // name_filter is given keeps only rows whose name contains one of the "|"-separated fragments,
  // mirroring page_observe. A row looks like any other observe item ({ ref, role, name }); the
  // model clicks it by ref and never learns it is remote.
  function buildCrossFrameRowsForCrossFrameAx(controlsForRows, refRegistryForRows, optsForRows) {
    var outForRows = [];
    if (!Array.isArray(controlsForRows) || !refRegistryForRows) return outForRows;
    var maxRowsForRows = (optsForRows && optsForRows.maxRows) || 100;
    var nameFilterAltsForRows = (optsForRows && Array.isArray(optsForRows.nameFilterAlts) && optsForRows.nameFilterAlts.length)
      ? optsForRows.nameFilterAlts : null;
    for (var iForRows = 0; iForRows < controlsForRows.length; iForRows++) {
      if (outForRows.length >= maxRowsForRows) break;
      var ctrlForRows = controlsForRows[iForRows];
      if (!ctrlForRows || typeof ctrlForRows.backendNodeId !== 'number') continue;
      var nameForRows = axNameForCrossFrameAx(ctrlForRows.axNode);
      if (!nameForRows) continue;
      if (nameFilterAltsForRows) {
        var haystackForRows = nameForRows.toLowerCase();
        var matchedForRows = false;
        for (var aForRows = 0; aForRows < nameFilterAltsForRows.length; aForRows++) {
          if (haystackForRows.indexOf(nameFilterAltsForRows[aForRows]) !== -1) { matchedForRows = true; break; }
        }
        if (!matchedForRows) continue;
      }
      outForRows.push({
        ref: refRegistryForRows.refFor(ctrlForRows.frameId, ctrlForRows.backendNodeId),
        role: observeRoleForAxRoleForCrossFrameAx(axRoleForCrossFrameAx(ctrlForRows.axNode)),
        name: nameForRows
      });
    }
    return outForRows;
  }

  // Choose the control whose accessible name best matches a requested option label, mirroring the
  // same-frame select matcher: exact (case-insensitive), then prefix, then contains. Returns the
  // matching control or null. Used after a cross-frame dropdown is opened to find which of the
  // now-rendered option nodes to click.
  function pickOptionControlForCrossFrameAx(controlsForPick, optionTextForPick) {
    if (!Array.isArray(controlsForPick) || optionTextForPick == null) return null;
    var wantForPick = String(optionTextForPick).trim().toLowerCase();
    if (!wantForPick) return null;
    var prefixForPick = null;
    var containsForPick = null;
    for (var iForPick = 0; iForPick < controlsForPick.length; iForPick++) {
      var nameForPick = axNameForCrossFrameAx(controlsForPick[iForPick] && controlsForPick[iForPick].axNode).toLowerCase();
      if (!nameForPick) continue;
      if (nameForPick === wantForPick) return controlsForPick[iForPick];
      if (!prefixForPick && nameForPick.indexOf(wantForPick) === 0) prefixForPick = controlsForPick[iForPick];
      if (!containsForPick && nameForPick.indexOf(wantForPick) !== -1) containsForPick = controlsForPick[iForPick];
    }
    return prefixForPick || containsForPick || null;
  }

  // The ordered frame chain from a child frame up to (excluding) the root, using a
  // frameId -> parentFrameId map (root maps to a falsy parent). Each frame in the chain contributes
  // its owner iframe's offset when translating a frame-local point to the top-level viewport.
  function frameChainToRootForCrossFrameAx(frameIdForChain, parentOfForChain) {
    var chainForChain = [];
    if (!frameIdForChain || !parentOfForChain) return chainForChain;
    var curForChain = frameIdForChain;
    var guardForChain = 0;
    while (curForChain && Object.prototype.hasOwnProperty.call(parentOfForChain, curForChain) && parentOfForChain[curForChain] && guardForChain < 20) {
      chainForChain.push(curForChain);
      curForChain = parentOfForChain[curForChain];
      guardForChain += 1;
    }
    return chainForChain;
  }

  // Sum a frame-local center with each ancestor iframe's content-origin offset to get a top-level
  // viewport point for Input.dispatchMouseEvent (which takes main-frame CSS pixels). Pure so the
  // accumulation is testable; the CDP calls that produce each offset live in cdpAutomation.js.
  function sumFrameChainOffsetForCrossFrameAx(localCenterForSum, offsetsForSum) {
    var xForSum = (localCenterForSum && Number(localCenterForSum.x)) || 0;
    var yForSum = (localCenterForSum && Number(localCenterForSum.y)) || 0;
    if (Array.isArray(offsetsForSum)) {
      for (var iForSum = 0; iForSum < offsetsForSum.length; iForSum++) {
        var offForSum = offsetsForSum[iForSum];
        if (!offForSum) continue;
        xForSum += Number(offForSum.x) || 0;
        yForSum += Number(offForSum.y) || 0;
      }
    }
    return { x: Math.round(xForSum), y: Math.round(yForSum) };
  }

  nsForCrossFrameAx.crossFrameAx = {
    CROSS_FRAME_REF_BASE: CROSS_FRAME_REF_BASE_FOR_CROSS_FRAME_AX,
    isCrossFrameRef: isCrossFrameRefForCrossFrameAx,
    axRole: axRoleForCrossFrameAx,
    axName: axNameForCrossFrameAx,
    observeRoleForAxRole: observeRoleForAxRoleForCrossFrameAx,
    shouldIncludeAxNode: shouldIncludeAxNodeForCrossFrameAx,
    createCrossFrameRefRegistry: createCrossFrameRefRegistryForCrossFrameAx,
    buildCrossFrameRows: buildCrossFrameRowsForCrossFrameAx,
    pickOptionControl: pickOptionControlForCrossFrameAx,
    frameChainToRoot: frameChainToRootForCrossFrameAx,
    sumFrameChainOffset: sumFrameChainOffsetForCrossFrameAx
  };

  globalScopeForCrossFrameAx.ABChatBackground = nsForCrossFrameAx;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForCrossFrameAx.crossFrameAx;
  }
})();
