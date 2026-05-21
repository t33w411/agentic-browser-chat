(function () {
  if (!window || typeof window.addEventListener !== "function") {
    return;
  }

  // Independent generation marker so stale handlers from extension re-injection
  // can self-disable without depending on other modules.
  window.__abchatKeyboardShieldGeneration = (window.__abchatKeyboardShieldGeneration || 0) + 1;
  var keyboardShieldGenerationForContent = window.__abchatKeyboardShieldGeneration;

  function isStaleForKeyboardShield() {
    if ((window.__abchatKeyboardShieldGeneration || 0) !== keyboardShieldGenerationForContent) {
      return true;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function isEditableTargetForKeyboardShield(nodeForKeyboardShield) {
    if (!nodeForKeyboardShield || nodeForKeyboardShield.nodeType !== 1) {
      return false;
    }
    var tagNameForKeyboardShield = String(nodeForKeyboardShield.tagName || "").toLowerCase();
    if (
      tagNameForKeyboardShield === "input" ||
      tagNameForKeyboardShield === "textarea" ||
      tagNameForKeyboardShield === "select"
    ) {
      return true;
    }
    if (nodeForKeyboardShield.isContentEditable) {
      return true;
    }
    if (typeof nodeForKeyboardShield.getAttribute === "function") {
      var contentEditableAttrForKeyboardShield = nodeForKeyboardShield.getAttribute("contenteditable");
      if (
        contentEditableAttrForKeyboardShield === "" ||
        contentEditableAttrForKeyboardShield === "true"
      ) {
        return true;
      }
    }
    return false;
  }

  // Returns true if the node lives inside any extension UI: the panel shadow DOM
  // or the quick-question overlay. The old check was limited to #inline-overlay
  // and missed the main chat textarea and all other panel inputs.
  function isInsideExtensionUiForKeyboardShield(nodeForKeyboardShield) {
    if (!nodeForKeyboardShield || nodeForKeyboardShield.nodeType !== 1) {
      return false;
    }

    // Quick-question overlay lives in the regular DOM, not the shadow.
    if (nodeForKeyboardShield.id === "abchat-quick-question-overlay") {
      return true;
    }
    if (typeof nodeForKeyboardShield.closest === "function") {
      if (nodeForKeyboardShield.closest("#abchat-quick-question-overlay")) {
        return true;
      }
    }

    // Any element whose root node is the panel shadow DOM.
    if (typeof nodeForKeyboardShield.getRootNode === "function") {
      var rootNodeForKeyboardShield = nodeForKeyboardShield.getRootNode();
      if (
        rootNodeForKeyboardShield &&
        rootNodeForKeyboardShield.host &&
        rootNodeForKeyboardShield.host.id === "abchat-panel-shadow-host"
      ) {
        return true;
      }
    }

    return false;
  }

  function getDeepActiveElementForKeyboardShield() {
    if (!document) {
      return null;
    }
    var activeElementForKeyboardShield = document.activeElement;
    while (
      activeElementForKeyboardShield &&
      activeElementForKeyboardShield.shadowRoot &&
      activeElementForKeyboardShield.shadowRoot.activeElement
    ) {
      activeElementForKeyboardShield = activeElementForKeyboardShield.shadowRoot.activeElement;
    }
    return activeElementForKeyboardShield;
  }

  function shouldIsolateKeyboardEventForKeyboardShield(eventForKeyboardShield) {
    if (!eventForKeyboardShield) {
      return false;
    }

    // composedPath() is available in both capture and bubble phases and includes
    // elements inside open shadow roots, letting us inspect the real event source.
    if (typeof eventForKeyboardShield.composedPath === "function") {
      var eventPathForKeyboardShield = eventForKeyboardShield.composedPath();
      if (Array.isArray(eventPathForKeyboardShield)) {
        for (
          var pathIndexForKeyboardShield = 0;
          pathIndexForKeyboardShield < eventPathForKeyboardShield.length;
          pathIndexForKeyboardShield++
        ) {
          var pathNodeForKeyboardShield = eventPathForKeyboardShield[pathIndexForKeyboardShield];
          if (!isEditableTargetForKeyboardShield(pathNodeForKeyboardShield)) {
            continue;
          }
          if (isInsideExtensionUiForKeyboardShield(pathNodeForKeyboardShield)) {
            return true;
          }
        }
      }
    }

    var deepActiveElementForKeyboardShield = getDeepActiveElementForKeyboardShield();
    if (!isEditableTargetForKeyboardShield(deepActiveElementForKeyboardShield)) {
      return false;
    }
    return isInsideExtensionUiForKeyboardShield(deepActiveElementForKeyboardShield);
  }

  // Pointer-event check: any element in the composed path inside the extension UI,
  // regardless of whether it is editable. Used to protect clicks and mousedown.
  function shouldIsolatePointerEventForKeyboardShield(eventForKeyboardShield) {
    if (!eventForKeyboardShield) {
      return false;
    }
    if (typeof eventForKeyboardShield.composedPath === "function") {
      var pathForPointer = eventForKeyboardShield.composedPath();
      if (Array.isArray(pathForPointer)) {
        for (var iForPointer = 0; iForPointer < pathForPointer.length; iForPointer++) {
          if (isInsideExtensionUiForKeyboardShield(pathForPointer[iForPointer])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function neutralizePreventDefaultForShield(eventForKeyboardShield) {
    try {
      eventForKeyboardShield.preventDefault = function () {};
    } catch (eForKeyboardShield) {}
  }

  // ---- Keyboard capture-phase handler (runs BEFORE page capture listeners) ----
  // Because keyboardShield.js is injected at document_start, our capture
  // listeners are registered before any page script runs. In the capture
  // phase we must NOT call stopPropagation/stopImmediatePropagation (that
  // would block the event from reaching our own shadow DOM inputs). Instead,
  // we neutralize preventDefault so page listeners can never suppress typing.
  function captureKeyboardEventForKeyboardShield(eventForKeyboardShield) {
    if (isStaleForKeyboardShield()) {
      document.removeEventListener("keydown", captureKeyboardEventForKeyboardShield, true);
      document.removeEventListener("keypress", captureKeyboardEventForKeyboardShield, true);
      document.removeEventListener("keyup", captureKeyboardEventForKeyboardShield, true);
      return;
    }
    if (!shouldIsolateKeyboardEventForKeyboardShield(eventForKeyboardShield)) {
      return;
    }
    neutralizePreventDefaultForShield(eventForKeyboardShield);
  }

  // ---- Keyboard bubble-phase handler ----
  // stopImmediatePropagation prevents page bubble listeners from seeing
  // extension keyboard events at all.
  function isolateKeyboardEventForKeyboardShield(eventForKeyboardShield) {
    if (isStaleForKeyboardShield()) {
      document.removeEventListener("keydown", isolateKeyboardEventForKeyboardShield, false);
      document.removeEventListener("keypress", isolateKeyboardEventForKeyboardShield, false);
      document.removeEventListener("keyup", isolateKeyboardEventForKeyboardShield, false);
      return;
    }
    if (!shouldIsolateKeyboardEventForKeyboardShield(eventForKeyboardShield)) {
      return;
    }
    if (typeof eventForKeyboardShield.stopImmediatePropagation === "function") {
      eventForKeyboardShield.stopImmediatePropagation();
      return;
    }
    if (typeof eventForKeyboardShield.stopPropagation === "function") {
      eventForKeyboardShield.stopPropagation();
    }
  }

  // ---- Pointer capture-phase handler ----
  // preventDefault() on mousedown is what prevents an element from gaining focus
  // when clicked. Pages that trap focus call preventDefault on mousedown in
  // capture so their own inputs keep focus. We neutralize it for extension UI
  // so our textarea and inputs can receive focus and clicks normally.
  function capturePointerEventForKeyboardShield(eventForKeyboardShield) {
    if (isStaleForKeyboardShield()) {
      document.removeEventListener("mousedown", capturePointerEventForKeyboardShield, true);
      document.removeEventListener("mouseup", capturePointerEventForKeyboardShield, true);
      document.removeEventListener("click", capturePointerEventForKeyboardShield, true);
      return;
    }
    if (!shouldIsolatePointerEventForKeyboardShield(eventForKeyboardShield)) {
      return;
    }
    neutralizePreventDefaultForShield(eventForKeyboardShield);
  }

  // ---- Pointer bubble-phase handler ----
  // Stop page bubble listeners from acting on clicks that landed in the extension UI.
  function isolatePointerEventForKeyboardShield(eventForKeyboardShield) {
    if (isStaleForKeyboardShield()) {
      document.removeEventListener("mousedown", isolatePointerEventForKeyboardShield, false);
      document.removeEventListener("click", isolatePointerEventForKeyboardShield, false);
      return;
    }
    if (!shouldIsolatePointerEventForKeyboardShield(eventForKeyboardShield)) {
      return;
    }
    if (typeof eventForKeyboardShield.stopImmediatePropagation === "function") {
      eventForKeyboardShield.stopImmediatePropagation();
      return;
    }
    if (typeof eventForKeyboardShield.stopPropagation === "function") {
      eventForKeyboardShield.stopPropagation();
    }
  }

  // Keyboard: capture neutralizes preventDefault; bubble stops page listeners.
  document.addEventListener("keydown", captureKeyboardEventForKeyboardShield, true);
  document.addEventListener("keypress", captureKeyboardEventForKeyboardShield, true);
  document.addEventListener("keyup", captureKeyboardEventForKeyboardShield, true);
  document.addEventListener("keydown", isolateKeyboardEventForKeyboardShield, false);
  document.addEventListener("keypress", isolateKeyboardEventForKeyboardShield, false);
  document.addEventListener("keyup", isolateKeyboardEventForKeyboardShield, false);

  // Pointer: capture neutralizes preventDefault (restores focus-on-click); bubble stops page listeners.
  document.addEventListener("mousedown", capturePointerEventForKeyboardShield, true);
  document.addEventListener("mouseup", capturePointerEventForKeyboardShield, true);
  document.addEventListener("click", capturePointerEventForKeyboardShield, true);
  document.addEventListener("mousedown", isolatePointerEventForKeyboardShield, false);
  document.addEventListener("click", isolatePointerEventForKeyboardShield, false);
})();
