(function () {
  const globalScopeForContentSelector = globalThis;
  const contentNamespaceForContentSelector = globalScopeForContentSelector.ABChatContent || {};
  const sharedNamespaceForContentSelector = globalScopeForContentSelector.ABChatShared || {};
  const actionsForContentSelector = sharedNamespaceForContentSelector.actions || {};
  const toastForContentSelector =
    contentNamespaceForContentSelector.ui && contentNamespaceForContentSelector.ui.toast
      ? contentNamespaceForContentSelector.ui.toast
      : null;

  const highlightClassForContentSelector = "abchat-content-selector-highlight";
  const tooltipClassForContentSelector = "abchat-content-selector-tooltip";
  const allowBodyPickForContentSelector = false;
  const contextMenuTargetTtlMsForContentSelector = 6000;
  const tooltipOffsetXForContentSelector = 12;
  const tooltipOffsetYForContentSelector = 16;

  contentNamespaceForContentSelector.state = contentNamespaceForContentSelector.state || {};

  // --- Stale-listener guard ---

  var capturedGenerationForContentSelector = window.abchatListenerGeneration || 0;

  function isStaleListenerForContentSelector() {
    if ((window.abchatListenerGeneration || 0) !== capturedGenerationForContentSelector) {
      return true;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        return true;
      }
    } catch (errForContentSelector) {
      return true;
    }
    return false;
  }

  // --- Context menu target capture ---

  function clearPendingContextMenuTargetForContentSelector() {
    if (!contentNamespaceForContentSelector || !contentNamespaceForContentSelector.state) {
      return;
    }
    contentNamespaceForContentSelector.state.pendingContextMenuTargetForContentSelector = null;
  }

  function setPendingContextMenuTargetForContentSelector(targetElementForContentSelector) {
    if (!contentNamespaceForContentSelector || !contentNamespaceForContentSelector.state) {
      return;
    }
    if (!targetElementForContentSelector) {
      clearPendingContextMenuTargetForContentSelector();
      return;
    }
    contentNamespaceForContentSelector.state.pendingContextMenuTargetForContentSelector = {
      element: targetElementForContentSelector,
      capturedAtMs: Date.now()
    };
  }

  function getPendingContextMenuTargetForContentSelector() {
    if (!contentNamespaceForContentSelector || !contentNamespaceForContentSelector.state) {
      return null;
    }
    var pendingForContentSelector =
      contentNamespaceForContentSelector.state.pendingContextMenuTargetForContentSelector;
    if (!pendingForContentSelector) {
      return null;
    }
    if (
      typeof pendingForContentSelector.capturedAtMs !== "number" ||
      Date.now() - pendingForContentSelector.capturedAtMs > contextMenuTargetTtlMsForContentSelector
    ) {
      clearPendingContextMenuTargetForContentSelector();
      return null;
    }
    var elementForContentSelector = pendingForContentSelector.element;
    if (!elementForContentSelector || !elementForContentSelector.isConnected) {
      clearPendingContextMenuTargetForContentSelector();
      return null;
    }
    return elementForContentSelector;
  }

  // --- Hash class filtering ---

  var hashClassPatternsForContentSelector = [
    /^css-[a-z0-9]+$/i,
    /^sc-[a-zA-Z]+$/,
    /^svelte-[a-z0-9]+$/i,
    /^vue-[a-z0-9]+$/i,
    /^[a-zA-Z]{1,2}[0-9]{2,}$/,
    /^[a-zA-Z_][a-zA-Z0-9_]*__[a-zA-Z0-9_]+--[a-zA-Z0-9_]+$/,
    /^[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9]{5,}$/,
    /^abchat-/
  ];

  function isHashClassForContentSelector(classNameForContentSelector) {
    if (!classNameForContentSelector || typeof classNameForContentSelector !== "string") {
      return false;
    }
    for (var iForContentSelector = 0; iForContentSelector < hashClassPatternsForContentSelector.length; iForContentSelector++) {
      if (hashClassPatternsForContentSelector[iForContentSelector].test(classNameForContentSelector)) {
        return true;
      }
    }
    return false;
  }

  function getCleanClassListForContentSelector(elementForContentSelector) {
    if (!elementForContentSelector || !elementForContentSelector.classList) {
      return [];
    }
    var cleanClassesForContentSelector = [];
    for (var iForContentSelector = 0; iForContentSelector < elementForContentSelector.classList.length; iForContentSelector++) {
      var classNameForContentSelector = elementForContentSelector.classList[iForContentSelector];
      if (!isHashClassForContentSelector(classNameForContentSelector)) {
        cleanClassesForContentSelector.push(classNameForContentSelector);
      }
    }
    return cleanClassesForContentSelector;
  }

  function generateSelectorForContentSelector(elementForContentSelector) {
    if (!elementForContentSelector || !elementForContentSelector.tagName) {
      return "div";
    }
    var tagForContentSelector = elementForContentSelector.tagName.toLowerCase();
    if (elementForContentSelector.id) {
      return tagForContentSelector + "#" + elementForContentSelector.id;
    }
    var cleanClassesForContentSelector = getCleanClassListForContentSelector(elementForContentSelector);
    if (cleanClassesForContentSelector.length > 0) {
      return tagForContentSelector + "." + cleanClassesForContentSelector.join(".");
    }
    var parentForContentSelector = elementForContentSelector.parentElement;
    if (parentForContentSelector) {
      var siblingsForContentSelector = Array.from(parentForContentSelector.children).filter(function (childForContentSelector) {
        return childForContentSelector.tagName && childForContentSelector.tagName.toLowerCase() === tagForContentSelector;
      });
      if (siblingsForContentSelector.length > 1) {
        var indexForContentSelector = siblingsForContentSelector.indexOf(elementForContentSelector) + 1;
        return tagForContentSelector + ":nth-child(" + indexForContentSelector + ")";
      }
    }
    return tagForContentSelector;
  }

  function buildUniqueSelectorForContentSelector(elementForContentSelector) {
    if (!elementForContentSelector || !elementForContentSelector.tagName) {
      return "";
    }
    var partsForContentSelector = [];
    var currentForContentSelector = elementForContentSelector;
    while (currentForContentSelector && currentForContentSelector.tagName && currentForContentSelector !== document.body) {
      if (currentForContentSelector.id) {
        partsForContentSelector.unshift('#' + currentForContentSelector.id);
        break;
      }
      var tagForUniqueSelector = currentForContentSelector.tagName.toLowerCase();
      var parentForUniqueSelector = currentForContentSelector.parentElement;
      if (parentForUniqueSelector) {
        var sameTagForUniqueSelector = Array.from(parentForUniqueSelector.children).filter(function (siblingForUniqueSelector) {
          return siblingForUniqueSelector.tagName === currentForContentSelector.tagName;
        });
        partsForContentSelector.unshift(
          sameTagForUniqueSelector.length > 1
            ? tagForUniqueSelector + ':nth-of-type(' + (sameTagForUniqueSelector.indexOf(currentForContentSelector) + 1) + ')'
            : tagForUniqueSelector
        );
      } else {
        partsForContentSelector.unshift(tagForUniqueSelector);
      }
      currentForContentSelector = parentForUniqueSelector;
    }
    return partsForContentSelector.join(' > ') || elementForContentSelector.tagName.toLowerCase();
  }

  // --- Ignored UI elements ---

  function isIgnoredUiElementForContentSelector(elementForContentSelector) {
    if (!elementForContentSelector) {
      return false;
    }
    if (elementForContentSelector.id === "abchat-panel-shadow-host") {
      return true;
    }
    if (elementForContentSelector.classList && elementForContentSelector.classList.contains("abchat-toast")) {
      return true;
    }
    if (elementForContentSelector.classList && elementForContentSelector.classList.contains(tooltipClassForContentSelector)) {
      return true;
    }
    if (elementForContentSelector.closest && elementForContentSelector.closest(".abchat-toast")) {
      return true;
    }
    return false;
  }

  // --- Tooltip ---

  function getTooltipElementForContentSelector() {
    var existingTooltipForContentSelector = contentNamespaceForContentSelector.state.contentSelectorTooltipElement;
    if (existingTooltipForContentSelector && existingTooltipForContentSelector.isConnected) {
      return existingTooltipForContentSelector;
    }
    var tooltipForContentSelector = document.createElement("div");
    tooltipForContentSelector.className = tooltipClassForContentSelector;
    document.body.appendChild(tooltipForContentSelector);
    contentNamespaceForContentSelector.state.contentSelectorTooltipElement = tooltipForContentSelector;
    return tooltipForContentSelector;
  }

  function getWordCountForContentSelector(elementForWordCount) {
    if (!elementForWordCount) return 0;
    var rawTextForWordCount = elementForWordCount.innerText || elementForWordCount.textContent || "";
    var trimmedTextForWordCount = rawTextForWordCount.trim();
    if (!trimmedTextForWordCount) return 0;
    var matchesForWordCount = trimmedTextForWordCount.match(/\S+/g);
    return matchesForWordCount ? matchesForWordCount.length : 0;
  }

  function formatWordCountForContentSelector(countForWordCount) {
    if (!countForWordCount) return "empty";
    if (countForWordCount === 1) return "1 word";
    return countForWordCount.toLocaleString() + " words";
  }

  function canExpandHoveredElementForContentSelector(elementForExpandCheck) {
    if (!elementForExpandCheck) {
      return false;
    }
    var parentForExpandCheck = elementForExpandCheck.parentElement;
    if (
      !parentForExpandCheck ||
      parentForExpandCheck === document.body ||
      parentForExpandCheck === document.documentElement
    ) {
      return false;
    }
    return true;
  }

  function updateTooltipForContentSelector(selectorTextForContentSelector, mouseXForContentSelector, mouseYForContentSelector) {
    var tooltipForContentSelector = getTooltipElementForContentSelector();

    var selectorLineForContentSelector = tooltipForContentSelector.querySelector(
      ".abchat-content-selector-tooltip-selector"
    );
    var wordCountLineForContentSelector = tooltipForContentSelector.querySelector(
      ".abchat-content-selector-tooltip-wordcount"
    );
    var hintLineForContentSelector = tooltipForContentSelector.querySelector(
      ".abchat-content-selector-tooltip-hint"
    );
    var rightClickHintLineForContentSelector = tooltipForContentSelector.querySelector(
      ".abchat-content-selector-tooltip-rightclick-hint"
    );
    if (
      !selectorLineForContentSelector ||
      !wordCountLineForContentSelector ||
      !hintLineForContentSelector ||
      !rightClickHintLineForContentSelector
    ) {
      tooltipForContentSelector.textContent = "";
      selectorLineForContentSelector = document.createElement("span");
      selectorLineForContentSelector.className = "abchat-content-selector-tooltip-selector";
      wordCountLineForContentSelector = document.createElement("span");
      wordCountLineForContentSelector.className = "abchat-content-selector-tooltip-wordcount";
      hintLineForContentSelector = document.createElement("span");
      hintLineForContentSelector.className = "abchat-content-selector-tooltip-hint";
      rightClickHintLineForContentSelector = document.createElement("span");
      rightClickHintLineForContentSelector.className = "abchat-content-selector-tooltip-rightclick-hint";
      tooltipForContentSelector.appendChild(selectorLineForContentSelector);
      tooltipForContentSelector.appendChild(wordCountLineForContentSelector);
      tooltipForContentSelector.appendChild(hintLineForContentSelector);
      tooltipForContentSelector.appendChild(rightClickHintLineForContentSelector);
    }
    selectorLineForContentSelector.textContent = selectorTextForContentSelector;

    var hoveredElementForHint = contentNamespaceForContentSelector.state.contentSelectorHoveredElement;

    var cachedElForWordCount = contentNamespaceForContentSelector.state.contentSelectorWordCountElement;
    var cachedCountForWordCount = contentNamespaceForContentSelector.state.contentSelectorWordCount;
    if (cachedElForWordCount !== hoveredElementForHint) {
      cachedCountForWordCount = getWordCountForContentSelector(hoveredElementForHint);
      contentNamespaceForContentSelector.state.contentSelectorWordCountElement = hoveredElementForHint;
      contentNamespaceForContentSelector.state.contentSelectorWordCount = cachedCountForWordCount;
    }
    wordCountLineForContentSelector.textContent = formatWordCountForContentSelector(cachedCountForWordCount);

    var hintTextForContentSelector = canExpandHoveredElementForContentSelector(hoveredElementForHint)
      ? "Left-click to expand selection"
      : "Expanded capture is no longer possible";
    hintLineForContentSelector.textContent = hintTextForContentSelector;
    rightClickHintLineForContentSelector.textContent = "Right-click to add to chat";

    tooltipForContentSelector.style.display = "block";

    var leftForContentSelector = mouseXForContentSelector + tooltipOffsetXForContentSelector;
    var topForContentSelector = mouseYForContentSelector + tooltipOffsetYForContentSelector;
    var viewportWidthForContentSelector = window.innerWidth;
    var viewportHeightForContentSelector = window.innerHeight;
    var tooltipWidthForContentSelector = tooltipForContentSelector.offsetWidth;
    var tooltipHeightForContentSelector = tooltipForContentSelector.offsetHeight;

    // Standard viewport-edge flip
    if (leftForContentSelector + tooltipWidthForContentSelector > viewportWidthForContentSelector - 4) {
      leftForContentSelector = mouseXForContentSelector - tooltipWidthForContentSelector - tooltipOffsetXForContentSelector;
    }
    if (topForContentSelector + tooltipHeightForContentSelector > viewportHeightForContentSelector - 4) {
      topForContentSelector = mouseYForContentSelector - tooltipHeightForContentSelector - tooltipOffsetYForContentSelector;
    }

    // Avoid overlapping the visible panel.
    // The shadow host is zero-size; query #panel-host inside the shadow root for
    // the real bounding rect of the visible panel.
    var panelRectForTooltip = null;
    var shadowRootForTooltip =
      contentNamespaceForContentSelector.ui && contentNamespaceForContentSelector.ui.panelShadowRoot
        ? contentNamespaceForContentSelector.ui.panelShadowRoot
        : null;
    if (shadowRootForTooltip) {
      var panelHostElForTooltip = shadowRootForTooltip.getElementById("panel-host");
      if (panelHostElForTooltip) {
        var rectCandidateForTooltip = panelHostElForTooltip.getBoundingClientRect();
        if (rectCandidateForTooltip && rectCandidateForTooltip.width > 10 && rectCandidateForTooltip.height > 10) {
          panelRectForTooltip = rectCandidateForTooltip;
        }
      }
    }
    if (panelRectForTooltip) {
      var tooltipRightForContentSelector = leftForContentSelector + tooltipWidthForContentSelector;
      var tooltipBottomForContentSelector = topForContentSelector + tooltipHeightForContentSelector;
      var overlapsHorizontallyForTooltip =
        tooltipRightForContentSelector > panelRectForTooltip.left &&
        leftForContentSelector < panelRectForTooltip.right;
      var overlapsVerticallyForTooltip =
        tooltipBottomForContentSelector > panelRectForTooltip.top &&
        topForContentSelector < panelRectForTooltip.bottom;
      if (overlapsHorizontallyForTooltip && overlapsVerticallyForTooltip) {
        // Try placing tooltip just left of the panel
        var leftOfPanelForTooltip = panelRectForTooltip.left - tooltipWidthForContentSelector - 8;
        if (leftOfPanelForTooltip >= 4) {
          leftForContentSelector = leftOfPanelForTooltip;
        } else {
          // No room horizontally: flip vertically away from the panel
          if (mouseYForContentSelector > panelRectForTooltip.top + panelRectForTooltip.height / 2) {
            topForContentSelector = panelRectForTooltip.top - tooltipHeightForContentSelector - 4;
          } else {
            topForContentSelector = panelRectForTooltip.bottom + 4;
          }
        }
      }
    }

    tooltipForContentSelector.style.left = Math.max(4, leftForContentSelector) + "px";
    tooltipForContentSelector.style.top = Math.max(4, topForContentSelector) + "px";
  }

  function hideTooltipForContentSelector() {
    var tooltipForContentSelector = contentNamespaceForContentSelector.state.contentSelectorTooltipElement;
    if (tooltipForContentSelector) {
      tooltipForContentSelector.style.display = "none";
    }
  }

  function removeTooltipForContentSelector() {
    var tooltipForContentSelector = contentNamespaceForContentSelector.state.contentSelectorTooltipElement;
    if (tooltipForContentSelector && tooltipForContentSelector.parentNode) {
      tooltipForContentSelector.parentNode.removeChild(tooltipForContentSelector);
    }
    contentNamespaceForContentSelector.state.contentSelectorTooltipElement = null;
  }

  // --- Style gate ---

  function setContentSelectorStyleGateForContentSelector(isEnabledForContentSelector) {
    var documentRootForContentSelector =
      document && document.documentElement && document.documentElement.setAttribute
        ? document.documentElement
        : null;
    if (!documentRootForContentSelector) {
      return;
    }
    documentRootForContentSelector.setAttribute(
      "data-abchat-content-selector-active",
      isEnabledForContentSelector ? "1" : "0"
    );
  }

  // --- Button sync ---

  function syncSelectorButtonStateForContentSelector(isEnabledForContentSelector) {
    var shadowRootForContentSelector =
      contentNamespaceForContentSelector.ui && contentNamespaceForContentSelector.ui.panelShadowRoot
        ? contentNamespaceForContentSelector.ui.panelShadowRoot
        : null;
    if (!shadowRootForContentSelector) {
      return;
    }
    var btnForContentSelector = shadowRootForContentSelector.getElementById("selector-tab");
    if (!btnForContentSelector) {
      return;
    }
    btnForContentSelector.classList.toggle("active", Boolean(isEnabledForContentSelector));
  }

  // --- Highlight management ---

  function clearContentSelectorHighlightForContentSelector() {
    var hoveredElementForContentSelector = contentNamespaceForContentSelector.state.contentSelectorHoveredElement;
    if (hoveredElementForContentSelector && hoveredElementForContentSelector.classList) {
      hoveredElementForContentSelector.classList.remove(highlightClassForContentSelector);
    }
    contentNamespaceForContentSelector.state.contentSelectorHoveredElement = null;
    contentNamespaceForContentSelector.state.contentSelectorExpansionLocked = false;
    hideTooltipForContentSelector();
  }

  function clearAllContentSelectorHighlightsForContentSelector() {
    if (!document || !document.querySelectorAll) {
      return;
    }
    document.querySelectorAll("." + highlightClassForContentSelector).forEach(function (nodeForContentSelector) {
      if (nodeForContentSelector && nodeForContentSelector.classList) {
        nodeForContentSelector.classList.remove(highlightClassForContentSelector);
      }
    });
  }

  function forceCleanupForContentSelector() {
    clearContentSelectorHighlightForContentSelector();
    clearAllContentSelectorHighlightsForContentSelector();
    removeTooltipForContentSelector();
  }

  function removeContentSelectorListenersForContentSelector(bodyForContentSelector) {
    if (!bodyForContentSelector || !bodyForContentSelector.removeEventListener) {
      return;
    }
    bodyForContentSelector.removeEventListener("mousemove", onMouseMoveForContentSelector, false);
    bodyForContentSelector.removeEventListener("mousemove", onMouseMoveForContentSelector, true);
    if (document && document.removeEventListener) {
      document.removeEventListener("click", onClickForContentSelector, true);
    }
  }

  // --- Custom context menu ---

  var menuShadowCssForContentSelector = "\n:host {\n  all: initial;\n  display: block;\n  position: fixed;\n  top: 0;\n  left: 0;\n  width: 0;\n  height: 0;\n  overflow: visible;\n  pointer-events: none;\n  z-index: 2147483647;\n}\n.cs-menu {\n  position: fixed;\n  z-index: 2147483647;\n  pointer-events: auto;\n  min-width: 160px;\n  background: #0f172a;\n  border: 1px solid rgba(255,255,255,0.16);\n  border-radius: 10px;\n  box-shadow: 0 14px 28px rgba(0,0,0,0.4);\n  padding: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n  box-sizing: border-box;\n}\n.cs-menu-title {\n  font-size: 11px;\n  color: #cbd5e1;\n  padding: 4px 6px 6px 6px;\n  border-bottom: 1px solid rgba(255,255,255,0.12);\n  box-sizing: border-box;\n}\n.cs-menu-btn {\n  all: unset;\n  border: 1px solid rgba(255,255,255,0.14);\n  background: rgba(255,255,255,0.05);\n  color: #f8fafc;\n  border-radius: 8px;\n  padding: 7px 9px;\n  font-size: 12px;\n  text-align: left;\n  cursor: pointer;\n  box-sizing: border-box;\n  display: block;\n  width: 100%;\n}\n.cs-menu-btn:hover {\n  background: rgba(59,130,246,0.24);\n  border-color: rgba(59,130,246,0.6);\n}\n";

  function removeContextMenuForContentSelector() {
    var menuStateForContentSelector =
      contentNamespaceForContentSelector.state.contentSelectorMenuStateForContentSelector;
    if (!menuStateForContentSelector) {
      return;
    }
    if (menuStateForContentSelector.onDocumentClickForContentSelector) {
      document.removeEventListener("click", menuStateForContentSelector.onDocumentClickForContentSelector, true);
    }
    if (menuStateForContentSelector.onDocumentKeydownForContentSelector) {
      document.removeEventListener("keydown", menuStateForContentSelector.onDocumentKeydownForContentSelector, true);
    }
    if (menuStateForContentSelector.onWindowResizeForContentSelector) {
      window.removeEventListener("resize", menuStateForContentSelector.onWindowResizeForContentSelector);
    }
    if (menuStateForContentSelector.onWindowBlurForContentSelector) {
      window.removeEventListener("blur", menuStateForContentSelector.onWindowBlurForContentSelector);
    }
    var hostNodeForContentSelector = menuStateForContentSelector.hostNodeForContentSelector;
    if (hostNodeForContentSelector && hostNodeForContentSelector.parentNode) {
      hostNodeForContentSelector.parentNode.removeChild(hostNodeForContentSelector);
    }
    contentNamespaceForContentSelector.state.contextMenuOpen = false;
    contentNamespaceForContentSelector.state.contentSelectorMenuStateForContentSelector = null;
  }

  function showContextMenuForContentSelector(targetElementForContentSelector, clientXForContentSelector, clientYForContentSelector) {
    removeContextMenuForContentSelector();

    var hostNodeForContentSelector = document.createElement("div");
    var shadowForContextMenu = hostNodeForContentSelector.attachShadow({ mode: "closed" });

    var styleNodeForContentSelector = document.createElement("style");
    styleNodeForContentSelector.textContent = menuShadowCssForContentSelector;
    shadowForContextMenu.appendChild(styleNodeForContentSelector);

    var menuNodeForContentSelector = document.createElement("div");
    menuNodeForContentSelector.className = "cs-menu";

    var titleNodeForContentSelector = document.createElement("div");
    titleNodeForContentSelector.className = "cs-menu-title";
    titleNodeForContentSelector.textContent = generateSelectorForContentSelector(targetElementForContentSelector);
    menuNodeForContentSelector.appendChild(titleNodeForContentSelector);

    var addBtnForContentSelector = document.createElement("button");
    addBtnForContentSelector.className = "cs-menu-btn";
    addBtnForContentSelector.textContent = "Add simple HTML to chat";
    menuNodeForContentSelector.appendChild(addBtnForContentSelector);

    var addRawBtnForContentSelector = document.createElement("button");
    addRawBtnForContentSelector.className = "cs-menu-btn";
    addRawBtnForContentSelector.textContent = "Add raw HTML to chat";
    menuNodeForContentSelector.appendChild(addRawBtnForContentSelector);

    shadowForContextMenu.appendChild(menuNodeForContentSelector);

    var leftForContextMenu = clientXForContentSelector;
    var topForContextMenu = clientYForContentSelector;

    menuNodeForContentSelector.style.left = leftForContextMenu + "px";
    menuNodeForContentSelector.style.top = topForContextMenu + "px";

    document.body.appendChild(hostNodeForContentSelector);

    // Clamp to viewport after render
    requestAnimationFrame(function () {
      if (!menuNodeForContentSelector) return;
      var menuWidthForContextMenu = menuNodeForContentSelector.offsetWidth;
      var menuHeightForContextMenu = menuNodeForContentSelector.offsetHeight;
      var viewportWidthForContextMenu = window.innerWidth;
      var viewportHeightForContextMenu = window.innerHeight;
      if (leftForContextMenu + menuWidthForContextMenu > viewportWidthForContextMenu - 4) {
        leftForContextMenu = viewportWidthForContextMenu - menuWidthForContextMenu - 8;
      }
      if (topForContextMenu + menuHeightForContextMenu > viewportHeightForContextMenu - 4) {
        topForContextMenu = viewportHeightForContextMenu - menuHeightForContextMenu - 8;
      }
      menuNodeForContentSelector.style.left = Math.max(4, leftForContextMenu) + "px";
      menuNodeForContentSelector.style.top = Math.max(4, topForContextMenu) + "px";
    });

    contentNamespaceForContentSelector.state.contextMenuOpen = true;

    addBtnForContentSelector.addEventListener("click", function onAddToChatClickForContentSelector(evtForContentSelector) {
      evtForContentSelector.stopPropagation();
      evtForContentSelector.preventDefault();
      removeContextMenuForContentSelector();
      addElementToChatForContentSelector(targetElementForContentSelector, false);
      setContentSelectorEnabledForContentSelector(false, { showToast: false });
    });

    addRawBtnForContentSelector.addEventListener("click", function onAddRawToChatClickForContentSelector(evtForContentSelector) {
      evtForContentSelector.stopPropagation();
      evtForContentSelector.preventDefault();
      removeContextMenuForContentSelector();
      addElementToChatForContentSelector(targetElementForContentSelector, true);
      setContentSelectorEnabledForContentSelector(false, { showToast: false });
    });

    var menuStateForContentSelector = {
      hostNodeForContentSelector: hostNodeForContentSelector
    };

    var onDocumentClickForContentSelector = function (evtForContentSelector) {
      if (isStaleListenerForContentSelector()) {
        removeContextMenuForContentSelector();
        return;
      }
      var pathForContextMenu = evtForContentSelector.composedPath ? evtForContentSelector.composedPath() : [];
      var isInsideMenuForContextMenu = pathForContextMenu.indexOf(hostNodeForContentSelector) !== -1;
      if (!isInsideMenuForContextMenu) {
        removeContextMenuForContentSelector();
      }
    };

    var onDocumentKeydownForContentSelector = function (evtForContentSelector) {
      if (evtForContentSelector.key === "Escape") {
        removeContextMenuForContentSelector();
      }
    };

    var onWindowResizeForContentSelector = function () {
      removeContextMenuForContentSelector();
    };

    var onWindowBlurForContentSelector = function () {
      removeContextMenuForContentSelector();
    };

    menuStateForContentSelector.onDocumentClickForContentSelector = onDocumentClickForContentSelector;
    menuStateForContentSelector.onDocumentKeydownForContentSelector = onDocumentKeydownForContentSelector;
    menuStateForContentSelector.onWindowResizeForContentSelector = onWindowResizeForContentSelector;
    menuStateForContentSelector.onWindowBlurForContentSelector = onWindowBlurForContentSelector;

    document.addEventListener("click", onDocumentClickForContentSelector, true);
    document.addEventListener("keydown", onDocumentKeydownForContentSelector, true);
    window.addEventListener("resize", onWindowResizeForContentSelector);
    window.addEventListener("blur", onWindowBlurForContentSelector);

    contentNamespaceForContentSelector.state.contentSelectorMenuStateForContentSelector = menuStateForContentSelector;
  }

  // --- "Add to chat" action ---

  async function addElementToChatForContentSelector(targetElementForContentSelector, isRawForContentSelector) {
    if (!targetElementForContentSelector || !targetElementForContentSelector.isConnected) {
      if (toastForContentSelector) {
        toastForContentSelector.show("Element is no longer on the page.");
      }
      return;
    }

    var ns = globalThis.ABChatContent || {};

    var flattenedContentToolForContentSelector =
      ns.tools && ns.tools.flattenedContent ? ns.tools.flattenedContent : null;
    var flatHtmlForContentSelector = "";
    if (isRawForContentSelector) {
      if (flattenedContentToolForContentSelector && typeof flattenedContentToolForContentSelector.buildRawHtml === "function") {
        flatHtmlForContentSelector = flattenedContentToolForContentSelector.buildRawHtml(targetElementForContentSelector) || "";
      }
    } else {
      if (flattenedContentToolForContentSelector && typeof flattenedContentToolForContentSelector.buildCleanHtml === "function") {
        flatHtmlForContentSelector = flattenedContentToolForContentSelector.buildCleanHtml(targetElementForContentSelector, { skipTruncate: true, removeStructuralElements: false }) || "";
      }
    }
    if (!flatHtmlForContentSelector) {
      if (toastForContentSelector) {
        toastForContentSelector.show("Could not extract element content.");
      }
      return;
    }
    if (flatHtmlForContentSelector.length > 200000) {
      if (toastForContentSelector) {
        toastForContentSelector.show("Element content is too large. Select a smaller element.");
      }
      return;
    }

    // Ensure panel is open
    var floatingPanelForContentSelector = ns.ui && ns.ui.floatingPanel ? ns.ui.floatingPanel : null;
    var panelUiForContentSelector = ns.ui && ns.ui.panel ? ns.ui.panel : null;
    var isPanelVisibleForContentSelector =
      panelUiForContentSelector && typeof panelUiForContentSelector.isVisible === "function"
        ? Boolean(panelUiForContentSelector.isVisible())
        : false;
    if (!isPanelVisibleForContentSelector && floatingPanelForContentSelector && typeof floatingPanelForContentSelector.open === "function") {
      floatingPanelForContentSelector.open();
    }

    // Switch to chat tab if not already there
    var panelRuntimeForContentSelector = ns.ui && ns.ui.panelRuntime ? ns.ui.panelRuntime : null;
    if (!panelRuntimeForContentSelector) {
      if (toastForContentSelector) {
        toastForContentSelector.show("Panel not ready. Please open the chat panel first.");
      }
      return;
    }

    if (typeof panelRuntimeForContentSelector.setTab === "function") {
      panelRuntimeForContentSelector.setTab("chats");
    }

    // Add chip to chat input
    if (typeof panelRuntimeForContentSelector.addInputChip === "function") {
      var labelForContentSelector = generateSelectorForContentSelector(targetElementForContentSelector);
      var uniqueSelectorForContentSelector = buildUniqueSelectorForContentSelector(targetElementForContentSelector);
      panelRuntimeForContentSelector.addInputChip({
        type: "page",
        label: labelForContentSelector,
        content: flatHtmlForContentSelector,
        mimeType: "text/html",
        kind: "page",
        htmlFormat: isRawForContentSelector ? "raw" : "simplified",
        pageUrl: window.location.href,
        pageTitle: document.title,
        elementSelector: uniqueSelectorForContentSelector
      });
    }
  }

  // --- Mouse move listener ---

  function onMouseMoveForContentSelector(eventForContentSelector) {
    if (isStaleListenerForContentSelector()) {
      forceCleanupForContentSelector();
      var bodyForContentSelectorCleanup = document && document.body ? document.body : null;
      if (bodyForContentSelectorCleanup) {
        removeContentSelectorListenersForContentSelector(bodyForContentSelectorCleanup);
      }
      return;
    }
    if (!contentNamespaceForContentSelector.state.isContentSelectorEnabled) {
      return;
    }
    if (contentNamespaceForContentSelector.state.contextMenuOpen) {
      return;
    }
    if (!eventForContentSelector || !eventForContentSelector.target) {
      return;
    }

    var targetForContentSelector = eventForContentSelector.target;

    if (isIgnoredUiElementForContentSelector(targetForContentSelector)) {
      return;
    }

    if (targetForContentSelector === contentNamespaceForContentSelector.state.contentSelectorHoveredElement) {
      updateTooltipForContentSelector(
        contentNamespaceForContentSelector.state.contentSelectorTooltipText || "",
        eventForContentSelector.clientX,
        eventForContentSelector.clientY
      );
      return;
    }

    var lockedHoveredElementForContentSelector =
      contentNamespaceForContentSelector.state.contentSelectorExpansionLocked
        ? contentNamespaceForContentSelector.state.contentSelectorHoveredElement
        : null;
    if (
      lockedHoveredElementForContentSelector &&
      lockedHoveredElementForContentSelector.contains &&
      lockedHoveredElementForContentSelector.contains(targetForContentSelector)
    ) {
      updateTooltipForContentSelector(
        contentNamespaceForContentSelector.state.contentSelectorTooltipText || "",
        eventForContentSelector.clientX,
        eventForContentSelector.clientY
      );
      return;
    }
    if (lockedHoveredElementForContentSelector) {
      contentNamespaceForContentSelector.state.contentSelectorExpansionLocked = false;
    }

    clearContentSelectorHighlightForContentSelector();

    var isExcludedElementForContentSelector =
      targetForContentSelector === document.documentElement ||
      (!allowBodyPickForContentSelector && targetForContentSelector === document.body);

    if (targetForContentSelector && targetForContentSelector.classList && !isExcludedElementForContentSelector) {
      targetForContentSelector.classList.add(highlightClassForContentSelector);
      contentNamespaceForContentSelector.state.contentSelectorHoveredElement = targetForContentSelector;

      var selectorTextForContentSelector = generateSelectorForContentSelector(targetForContentSelector);
      contentNamespaceForContentSelector.state.contentSelectorTooltipText = selectorTextForContentSelector;
      updateTooltipForContentSelector(
        selectorTextForContentSelector,
        eventForContentSelector.clientX,
        eventForContentSelector.clientY
      );
    }
  }

  // --- Click listener (drill up; shadow DOM clicks pass through) ---

  function onClickForContentSelector(eventForContentSelector) {
    if (isStaleListenerForContentSelector()) {
      forceCleanupForContentSelector();
      var bodyForContentSelectorCleanup = document && document.body ? document.body : null;
      if (bodyForContentSelectorCleanup) {
        removeContentSelectorListenersForContentSelector(bodyForContentSelectorCleanup);
      }
      return;
    }
    if (!contentNamespaceForContentSelector.state.isContentSelectorEnabled) {
      return;
    }
    if (contentNamespaceForContentSelector.state.contextMenuOpen) {
      return;
    }
    if (!eventForContentSelector || !eventForContentSelector.target) {
      return;
    }

    // Allow clicks that originated inside the panel shadow root to pass through
    var panelShadowHostForContentSelector = document.getElementById("abchat-panel-shadow-host");
    if (panelShadowHostForContentSelector) {
      var pathForContentSelector = eventForContentSelector.composedPath
        ? eventForContentSelector.composedPath()
        : [];
      var isInPanelShadowForContentSelector =
        pathForContentSelector.indexOf(panelShadowHostForContentSelector) !== -1;
      if (isInPanelShadowForContentSelector) {
        return;
      }
    }

    if (isIgnoredUiElementForContentSelector(eventForContentSelector.target)) {
      return;
    }

    eventForContentSelector.preventDefault();
    eventForContentSelector.stopPropagation();

    var currentElementForContentSelector = contentNamespaceForContentSelector.state.contentSelectorHoveredElement;
    if (!currentElementForContentSelector) {
      return;
    }

    // Climb the ancestor chain, skipping pass-through wrappers that add no words,
    // and stop at the first ancestor whose word count actually increases. If no
    // ancestor adds words before the document boundary, leave the selection as-is.
    var baseWordCountForContentSelector = getWordCountForContentSelector(currentElementForContentSelector);
    var targetForContentSelector = null;
    var candidateForContentSelector = currentElementForContentSelector.parentElement;
    while (
      candidateForContentSelector &&
      candidateForContentSelector !== document.body &&
      candidateForContentSelector !== document.documentElement
    ) {
      if (getWordCountForContentSelector(candidateForContentSelector) > baseWordCountForContentSelector) {
        targetForContentSelector = candidateForContentSelector;
        break;
      }
      candidateForContentSelector = candidateForContentSelector.parentElement;
    }

    if (!targetForContentSelector) {
      return;
    }

    if (currentElementForContentSelector.classList) {
      currentElementForContentSelector.classList.remove(highlightClassForContentSelector);
    }
    if (targetForContentSelector.classList) {
      targetForContentSelector.classList.add(highlightClassForContentSelector);
    }

    contentNamespaceForContentSelector.state.contentSelectorHoveredElement = targetForContentSelector;
    contentNamespaceForContentSelector.state.contentSelectorExpansionLocked = true;

    var selectorTextForContentSelector = generateSelectorForContentSelector(targetForContentSelector);
    contentNamespaceForContentSelector.state.contentSelectorTooltipText = selectorTextForContentSelector;
    updateTooltipForContentSelector(
      selectorTextForContentSelector,
      eventForContentSelector.clientX,
      eventForContentSelector.clientY
    );
  }

  // --- Contextmenu listener (shows custom "Add to chat" menu) ---

  function onContextMenuForContentSelector(eventForContentSelector) {
    if (isStaleListenerForContentSelector()) {
      return;
    }
    if (!contentNamespaceForContentSelector.state.isContentSelectorEnabled) {
      return;
    }
    if (!eventForContentSelector || !eventForContentSelector.target || !eventForContentSelector.target.closest) {
      return;
    }

    var highlightedTargetForContentSelector = eventForContentSelector.target.closest(
      "." + highlightClassForContentSelector
    );
    if (!highlightedTargetForContentSelector) {
      setPendingContextMenuTargetForContentSelector(null);
      return;
    }

    setPendingContextMenuTargetForContentSelector(highlightedTargetForContentSelector);
    eventForContentSelector.preventDefault();
    eventForContentSelector.stopPropagation();
    showContextMenuForContentSelector(
      highlightedTargetForContentSelector,
      eventForContentSelector.clientX,
      eventForContentSelector.clientY
    );
  }

  function ensureContextMenuTrackingForContentSelector() {
    if (!document || !document.addEventListener || !contentNamespaceForContentSelector || !contentNamespaceForContentSelector.state) {
      return;
    }
    if (contentNamespaceForContentSelector.state.contextMenuTrackingBoundForContentSelector) {
      return;
    }
    document.addEventListener("contextmenu", onContextMenuForContentSelector, true);
    contentNamespaceForContentSelector.state.contextMenuTrackingBoundForContentSelector = true;
  }

  // --- Enable / disable ---

  function setContentSelectorEnabledForContentSelector(nextEnabledForContentSelector, optionsForContentSelector) {
    var bodyForContentSelector = document && document.body ? document.body : null;
    if (!bodyForContentSelector) {
      return false;
    }

    var shouldEnableForContentSelector = Boolean(nextEnabledForContentSelector);
    var shouldShowToastForContentSelector =
      !optionsForContentSelector || optionsForContentSelector.showToast !== false;
    var isAlreadyEnabledForContentSelector = Boolean(
      contentNamespaceForContentSelector.state.isContentSelectorEnabled
    );

    if (isAlreadyEnabledForContentSelector === shouldEnableForContentSelector) {
      setContentSelectorStyleGateForContentSelector(shouldEnableForContentSelector);
      if (!shouldEnableForContentSelector) {
        forceCleanupForContentSelector();
        removeContextMenuForContentSelector();
      }
      syncSelectorButtonStateForContentSelector(shouldEnableForContentSelector);
      return true;
    }

    contentNamespaceForContentSelector.state.isContentSelectorEnabled = shouldEnableForContentSelector;
    setContentSelectorStyleGateForContentSelector(shouldEnableForContentSelector);

    if (shouldEnableForContentSelector) {
      removeContentSelectorListenersForContentSelector(bodyForContentSelector);
      bodyForContentSelector.addEventListener("mousemove", onMouseMoveForContentSelector, false);
      if (document && document.addEventListener) {
        document.addEventListener("click", onClickForContentSelector, true);
      }

      syncSelectorButtonStateForContentSelector(true);

      return true;
    }

    removeContentSelectorListenersForContentSelector(bodyForContentSelector);
    forceCleanupForContentSelector();
    clearPendingContextMenuTargetForContentSelector();
    removeContextMenuForContentSelector();
    syncSelectorButtonStateForContentSelector(false);

    return true;
  }

  function toggleContentSelectorForContentSelector(actionPayloadForContentSelector) {
    var desiredEnabledForContentSelector = null;
    if (actionPayloadForContentSelector && typeof actionPayloadForContentSelector.desiredEnabled === "boolean") {
      desiredEnabledForContentSelector = actionPayloadForContentSelector.desiredEnabled;
    } else if (
      actionPayloadForContentSelector &&
      actionPayloadForContentSelector.payload &&
      typeof actionPayloadForContentSelector.payload.desiredEnabled === "boolean"
    ) {
      desiredEnabledForContentSelector = actionPayloadForContentSelector.payload.desiredEnabled;
    }
    var isCurrentlyEnabledForContentSelector = Boolean(
      contentNamespaceForContentSelector.state.isContentSelectorEnabled
    );
    var willEnableForContentSelector =
      typeof desiredEnabledForContentSelector === "boolean"
        ? desiredEnabledForContentSelector
        : !isCurrentlyEnabledForContentSelector;
    setContentSelectorEnabledForContentSelector(willEnableForContentSelector);
  }

  // --- Register ---

  contentNamespaceForContentSelector.registerActionHandler(
    actionsForContentSelector.toggleContentSelector || "toggleContentSelector",
    toggleContentSelectorForContentSelector
  );

  ensureContextMenuTrackingForContentSelector();

  contentNamespaceForContentSelector.tools = contentNamespaceForContentSelector.tools || {};
  contentNamespaceForContentSelector.tools.contentSelector = {
    setEnabled: setContentSelectorEnabledForContentSelector
  };

  if (!Boolean(contentNamespaceForContentSelector.state.isContentSelectorEnabled)) {
    forceCleanupForContentSelector();
  }
  setContentSelectorStyleGateForContentSelector(
    Boolean(contentNamespaceForContentSelector.state.isContentSelectorEnabled)
  );

  globalScopeForContentSelector.ABChatContent = contentNamespaceForContentSelector;
})();
