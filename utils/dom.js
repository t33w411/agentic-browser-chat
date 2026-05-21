(function () {
  const globalScopeForDomUtils = globalThis;
  const contentNamespaceForDomUtils = globalScopeForDomUtils.ABChatContent || {};

  contentNamespaceForDomUtils.actionHandlers = contentNamespaceForDomUtils.actionHandlers || {};
  contentNamespaceForDomUtils.utils = contentNamespaceForDomUtils.utils || {};
  contentNamespaceForDomUtils.state = contentNamespaceForDomUtils.state || {};
  contentNamespaceForDomUtils.state.runtimeSettings = contentNamespaceForDomUtils.state.runtimeSettings || {};

  contentNamespaceForDomUtils.registerActionHandler =
    contentNamespaceForDomUtils.registerActionHandler ||
    function registerActionHandlerForDomUtils(actionNameForDomUtils, handlerForDomUtils) {
      if (!actionNameForDomUtils || typeof handlerForDomUtils !== "function") {
        return;
      }
      contentNamespaceForDomUtils.actionHandlers[actionNameForDomUtils] = handlerForDomUtils;
    };

  function getBodyForDomUtils() {
    if (!document || !document.body) {
      return null;
    }
    return document.body;
  }

  function getSelectedTextForDomUtils() {
    if (!window.getSelection) {
      return "";
    }
    const selectedTextObjectForDomUtils = window.getSelection();
    if (!selectedTextObjectForDomUtils) {
      return "";
    }
    return selectedTextObjectForDomUtils.toString().trim();
  }

  function hasMeaningfulTextForDomUtils(elementForDomUtils, minimumLengthForDomUtils) {
    if (!elementForDomUtils || typeof elementForDomUtils.textContent !== "string") {
      return false;
    }

    const normalizedTextForDomUtils = elementForDomUtils.textContent.replace(/\s+/g, " ").trim();
    const thresholdForDomUtils = typeof minimumLengthForDomUtils === "number" ? minimumLengthForDomUtils : 40;
    return normalizedTextForDomUtils.length >= thresholdForDomUtils;
  }

  function isBlockLikeElementForDomUtils(elementForDomUtils) {
    if (!elementForDomUtils || !elementForDomUtils.tagName) {
      return false;
    }

    const blockLikeTagsForDomUtils = new Set([
      "ARTICLE",
      "ASIDE",
      "BLOCKQUOTE",
      "DIV",
      "FIGCAPTION",
      "FIGURE",
      "LI",
      "MAIN",
      "NAV",
      "P",
      "PRE",
      "SECTION",
      "TABLE",
      "TD",
      "TH"
    ]);

    if (blockLikeTagsForDomUtils.has(elementForDomUtils.tagName)) {
      return true;
    }

    if (!window.getComputedStyle) {
      return false;
    }

    const computedStyleForDomUtils = window.getComputedStyle(elementForDomUtils);
    if (!computedStyleForDomUtils || !computedStyleForDomUtils.display) {
      return false;
    }

    return ["block", "list-item", "table", "flex", "grid"].includes(computedStyleForDomUtils.display);
  }

  function findReadableAncestorForDomUtils(targetForDomUtils, minimumLengthForDomUtils) {
    if (!targetForDomUtils || !document || !document.body) {
      return null;
    }

    let currentElementForDomUtils = targetForDomUtils;
    while (currentElementForDomUtils && currentElementForDomUtils !== document.body) {
      if (
        isBlockLikeElementForDomUtils(currentElementForDomUtils) &&
        hasMeaningfulTextForDomUtils(currentElementForDomUtils, minimumLengthForDomUtils)
      ) {
        return currentElementForDomUtils;
      }
      currentElementForDomUtils = currentElementForDomUtils.parentElement;
    }

    return null;
  }

  function getHostnameForDomUtils() {
    return window && window.location && window.location.hostname ? window.location.hostname.toLowerCase() : "";
  }

  contentNamespaceForDomUtils.utils.dom = {
    getBody: getBodyForDomUtils,
    getSelectedText: getSelectedTextForDomUtils,
    hasMeaningfulText: hasMeaningfulTextForDomUtils,
    isBlockLikeElement: isBlockLikeElementForDomUtils,
    findReadableAncestor: findReadableAncestorForDomUtils,
    getHostname: getHostnameForDomUtils
  };

  globalScopeForDomUtils.ABChatContent = contentNamespaceForDomUtils;
})();
