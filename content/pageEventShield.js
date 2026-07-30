(function () {
  // Runs in the page's MAIN world at document_start, before any page script.
  // Pages that delegate pointer/keyboard/focus events on window/document/html/body
  // (often in the CAPTURE phase, which no bubble-side stopPropagation can beat)
  // see events from our UI retargeted to a host element outside their modals and
  // misread them as outside interaction, dismissing dialogs. Instead of fighting
  // propagation order, we wrap EventTarget.prototype.addEventListener so that
  // page-registered listeners for those event types are skipped when the event
  // originates inside our UI. Extension content scripts live in the isolated
  // world with their own untouched prototypes, so their listeners are unaffected,
  // and the real trusted event still propagates and performs all default actions.
  if (window.__abchatPageEventShieldInstalled) {
    return;
  }
  window.__abchatPageEventShieldInstalled = true;

  // Uses no chrome.* APIs, so it stays valid across extension reloads and needs
  // no generation/stale guard: it only inspects element identity in the DOM.
  var extensionHostIdsForPageEventShield = {
    "abchat-panel-shadow-host": true,
    "abchat-toast-host": true,
    "abchat-quick-question-overlay": true,
    "abchat-content-selector-menu-host": true
  };

  var pointerTypesForPageEventShield = {
    pointerdown: true,
    mousedown: true,
    click: true,
    dblclick: true,
    auxclick: true,
    touchstart: true,
    contextmenu: true
  };
  // mouseup/pointerup/touchend are deliberately not filtered: a drag the page
  // started must see its release even when the pointer ends up over our UI.
  var keyboardTypesForPageEventShield = { keydown: true, keypress: true, keyup: true };
  var focusTypesForPageEventShield = { focus: true, blur: true, focusin: true, focusout: true };

  function isFilteredTypeForPageEventShield(typeForPageEventShield) {
    return (
      pointerTypesForPageEventShield[typeForPageEventShield] === true ||
      keyboardTypesForPageEventShield[typeForPageEventShield] === true ||
      focusTypesForPageEventShield[typeForPageEventShield] === true
    );
  }

  function isInsideExtensionUiForPageEventShield(nodeForPageEventShield) {
    if (!nodeForPageEventShield || nodeForPageEventShield.nodeType !== 1) {
      return false;
    }
    try {
      if (
        nodeForPageEventShield.id &&
        extensionHostIdsForPageEventShield[nodeForPageEventShield.id] === true
      ) {
        return true;
      }
      if (
        typeof nodeForPageEventShield.closest === "function" &&
        nodeForPageEventShield.closest("#abchat-quick-question-overlay")
      ) {
        return true;
      }
      // Walk shadow boundaries upward: an element inside the panel's open shadow
      // root (or any nested shadow root within it) belongs to our UI.
      var rootNodeForPageEventShield =
        typeof nodeForPageEventShield.getRootNode === "function"
          ? nodeForPageEventShield.getRootNode()
          : null;
      while (rootNodeForPageEventShield && rootNodeForPageEventShield.host) {
        var hostForPageEventShield = rootNodeForPageEventShield.host;
        if (
          hostForPageEventShield.id &&
          extensionHostIdsForPageEventShield[hostForPageEventShield.id] === true
        ) {
          return true;
        }
        rootNodeForPageEventShield =
          typeof hostForPageEventShield.getRootNode === "function"
            ? hostForPageEventShield.getRootNode()
            : null;
      }
    } catch (errorForPageEventShield) {}
    return false;
  }

  function getEventSourceForPageEventShield(eventForPageEventShield) {
    // composedPath()[0] sees through open shadow roots even after retargeting,
    // in every phase, so it identifies the real origin of the event.
    if (typeof eventForPageEventShield.composedPath === "function") {
      var pathForPageEventShield = eventForPageEventShield.composedPath();
      if (pathForPageEventShield && pathForPageEventShield.length) {
        return pathForPageEventShield[0];
      }
    }
    return eventForPageEventShield.target;
  }

  function shouldBlockForPageEventShield(eventForPageEventShield) {
    if (!eventForPageEventShield) {
      return false;
    }
    // One decision per event object, shared across every wrapped listener.
    if (eventForPageEventShield.__abchatShieldChecked === true) {
      return eventForPageEventShield.__abchatShieldBlocked === true;
    }
    var blockedForPageEventShield = false;
    try {
      var typeForPageEventShield = eventForPageEventShield.type;
      if (focusTypesForPageEventShield[typeForPageEventShield] === true) {
        var sourceForPageEventShield = getEventSourceForPageEventShield(eventForPageEventShield);
        if (typeForPageEventShield === "focus" || typeForPageEventShield === "focusin") {
          blockedForPageEventShield = isInsideExtensionUiForPageEventShield(sourceForPageEventShield);
        } else {
          // Block only focus ENTERING our UI (a page element blurring toward us).
          // Focus leaving our UI back to the page must stay visible so page focus
          // logic can legitimately re-engage.
          blockedForPageEventShield =
            !isInsideExtensionUiForPageEventShield(sourceForPageEventShield) &&
            isInsideExtensionUiForPageEventShield(eventForPageEventShield.relatedTarget);
        }
      } else {
        blockedForPageEventShield = isInsideExtensionUiForPageEventShield(
          getEventSourceForPageEventShield(eventForPageEventShield)
        );
      }
    } catch (errorForPageEventShield) {
      blockedForPageEventShield = false;
    }
    try {
      eventForPageEventShield.__abchatShieldChecked = true;
      eventForPageEventShield.__abchatShieldBlocked = blockedForPageEventShield;
    } catch (errorForShieldMark) {}
    return blockedForPageEventShield;
  }

  var nativeAddEventListenerForPageEventShield = EventTarget.prototype.addEventListener;
  var nativeRemoveEventListenerForPageEventShield = EventTarget.prototype.removeEventListener;
  // listener -> Map<"type|capture", wrapper>. The same triple always yields the
  // same wrapper so removeEventListener keeps working with the original listener.
  var wrapperCacheForPageEventShield = new WeakMap();

  function captureFlagForPageEventShield(optionsForPageEventShield) {
    if (optionsForPageEventShield === true) {
      return true;
    }
    if (optionsForPageEventShield && typeof optionsForPageEventShield === "object") {
      return optionsForPageEventShield.capture === true;
    }
    return false;
  }

  function wrapperKeyForPageEventShield(typeForPageEventShield, optionsForPageEventShield) {
    return (
      typeForPageEventShield +
      "|" +
      (captureFlagForPageEventShield(optionsForPageEventShield) ? "1" : "0")
    );
  }

  function isWrappableListenerForPageEventShield(listenerForPageEventShield) {
    return (
      typeof listenerForPageEventShield === "function" ||
      (typeof listenerForPageEventShield === "object" && listenerForPageEventShield !== null)
    );
  }

  function makeWrapperForPageEventShield(listenerForPageEventShield) {
    return function (eventForPageEventShield) {
      if (shouldBlockForPageEventShield(eventForPageEventShield)) {
        return;
      }
      if (typeof listenerForPageEventShield === "function") {
        return listenerForPageEventShield.call(this, eventForPageEventShield);
      }
      if (
        listenerForPageEventShield &&
        typeof listenerForPageEventShield.handleEvent === "function"
      ) {
        return listenerForPageEventShield.handleEvent(eventForPageEventShield);
      }
    };
  }

  EventTarget.prototype.addEventListener = function (
    typeForPageEventShield,
    listenerForPageEventShield,
    optionsForPageEventShield
  ) {
    if (
      isFilteredTypeForPageEventShield(typeForPageEventShield) &&
      isWrappableListenerForPageEventShield(listenerForPageEventShield)
    ) {
      var perListenerForPageEventShield = wrapperCacheForPageEventShield.get(
        listenerForPageEventShield
      );
      if (!perListenerForPageEventShield) {
        perListenerForPageEventShield = new Map();
        wrapperCacheForPageEventShield.set(listenerForPageEventShield, perListenerForPageEventShield);
      }
      var keyForPageEventShield = wrapperKeyForPageEventShield(
        typeForPageEventShield,
        optionsForPageEventShield
      );
      var wrapperForPageEventShield = perListenerForPageEventShield.get(keyForPageEventShield);
      if (!wrapperForPageEventShield) {
        wrapperForPageEventShield = makeWrapperForPageEventShield(listenerForPageEventShield);
        perListenerForPageEventShield.set(keyForPageEventShield, wrapperForPageEventShield);
      }
      return nativeAddEventListenerForPageEventShield.call(
        this,
        typeForPageEventShield,
        wrapperForPageEventShield,
        optionsForPageEventShield
      );
    }
    return nativeAddEventListenerForPageEventShield.call(
      this,
      typeForPageEventShield,
      listenerForPageEventShield,
      optionsForPageEventShield
    );
  };

  EventTarget.prototype.removeEventListener = function (
    typeForPageEventShield,
    listenerForPageEventShield,
    optionsForPageEventShield
  ) {
    if (
      isFilteredTypeForPageEventShield(typeForPageEventShield) &&
      isWrappableListenerForPageEventShield(listenerForPageEventShield)
    ) {
      var perListenerForPageEventShield = wrapperCacheForPageEventShield.get(
        listenerForPageEventShield
      );
      if (perListenerForPageEventShield) {
        var wrapperForPageEventShield = perListenerForPageEventShield.get(
          wrapperKeyForPageEventShield(typeForPageEventShield, optionsForPageEventShield)
        );
        if (wrapperForPageEventShield) {
          return nativeRemoveEventListenerForPageEventShield.call(
            this,
            typeForPageEventShield,
            wrapperForPageEventShield,
            optionsForPageEventShield
          );
        }
      }
    }
    return nativeRemoveEventListenerForPageEventShield.call(
      this,
      typeForPageEventShield,
      listenerForPageEventShield,
      optionsForPageEventShield
    );
  };
})();
