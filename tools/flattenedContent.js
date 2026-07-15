(function () {
  const globalScopeForFlattenedContent = globalThis;
  const contentNamespaceForFlattenedContent = globalScopeForFlattenedContent.ABChatContent || {};
  const sharedNamespaceForFlattenedContent = globalScopeForFlattenedContent.ABChatShared || {};
  const actionsForFlattenedContent = sharedNamespaceForFlattenedContent.actions || {};
  const storageManagerForFlattenedContent = sharedNamespaceForFlattenedContent.storageManager;

  const clipboardUtilsForFlattenedContent =
    contentNamespaceForFlattenedContent.utils && contentNamespaceForFlattenedContent.utils.clipboard
      ? contentNamespaceForFlattenedContent.utils.clipboard
      : null;
  const toastForFlattenedContent =
    contentNamespaceForFlattenedContent.ui && contentNamespaceForFlattenedContent.ui.toast
      ? contentNamespaceForFlattenedContent.ui.toast
      : null;
  const contextMenuTargetTtlMsForFlattenedContent = 6000;
  const contextMenuHighlightSelectorForFlattenedContent = ".abchat-content-selector-highlight";

  // Controls how hidden elements are handled in flattened output.
  // "removed"  - strip hidden elements entirely (default)
  // "marked"   - keep them but stamp with the native hidden attribute
  // "unmarked" - include them as normal visible content
  const hiddenElementModeForFlattenedContent = "marked";

  function clearPendingContextMenuTargetForFlattenedContent() {
    if (!contentNamespaceForFlattenedContent || !contentNamespaceForFlattenedContent.state) {
      return;
    }
    contentNamespaceForFlattenedContent.state.pendingContextMenuTargetForFlattenedContent = null;
  }

  function setPendingContextMenuTargetForFlattenedContent(targetElementForFlattenedContent) {
    if (!contentNamespaceForFlattenedContent || !contentNamespaceForFlattenedContent.state) {
      return;
    }
    if (!targetElementForFlattenedContent) {
      clearPendingContextMenuTargetForFlattenedContent();
      return;
    }
    contentNamespaceForFlattenedContent.state.pendingContextMenuTargetForFlattenedContent = {
      element: targetElementForFlattenedContent,
      capturedAtMs: Date.now()
    };
  }

  function getPendingContextMenuTargetForFlattenedContent() {
    if (!contentNamespaceForFlattenedContent || !contentNamespaceForFlattenedContent.state) {
      return null;
    }
    const pendingTargetForFlattenedContent =
      contentNamespaceForFlattenedContent.state.pendingContextMenuTargetForFlattenedContent;
    if (!pendingTargetForFlattenedContent) {
      return null;
    }
    if (
      typeof pendingTargetForFlattenedContent.capturedAtMs !== "number" ||
      Date.now() - pendingTargetForFlattenedContent.capturedAtMs > contextMenuTargetTtlMsForFlattenedContent
    ) {
      clearPendingContextMenuTargetForFlattenedContent();
      return null;
    }
    const elementForFlattenedContent = pendingTargetForFlattenedContent.element;
    if (!elementForFlattenedContent || !elementForFlattenedContent.isConnected) {
      clearPendingContextMenuTargetForFlattenedContent();
      return null;
    }
    return elementForFlattenedContent;
  }

  // Stale-listener guard. See the re-init block in content/main.js for full details.
  var capturedGenerationForFlattenedContent = window.abchatListenerGeneration || 0;

  function isStaleListenerForFlattenedContent() {
    if ((window.abchatListenerGeneration || 0) !== capturedGenerationForFlattenedContent) {
      return true;
    }
    // Orphaned-context guard: when the extension is reloaded, old content-script
    // listeners stay alive until re-injection reaches this tab and bumps the
    // generation. Treating an invalidated runtime as stale lets orphaned DOM
    // listeners skip processing on their next fire instead of reading state or
    // calling chrome APIs that would throw.
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        return true;
      }
    } catch (errForFlattenedContent) {
      return true;
    }
    return false;
  }

  function onContextMenuForFlattenedContent(eventForFlattenedContent) {
    if (isStaleListenerForFlattenedContent()) {
      return;
    }
    if (!eventForFlattenedContent || !eventForFlattenedContent.target || !eventForFlattenedContent.target.closest) {
      clearPendingContextMenuTargetForFlattenedContent();
      return;
    }

    const highlightedTargetForFlattenedContent = eventForFlattenedContent.target.closest(
      contextMenuHighlightSelectorForFlattenedContent
    );
    setPendingContextMenuTargetForFlattenedContent(highlightedTargetForFlattenedContent || null);
  }

  function ensureContextMenuTrackingForFlattenedContent() {
    if (!document || !document.addEventListener || !contentNamespaceForFlattenedContent || !contentNamespaceForFlattenedContent.state) {
      return;
    }
    if (contentNamespaceForFlattenedContent.state.contextMenuTrackingBoundForFlattenedContent) {
      return;
    }
    document.addEventListener("contextmenu", onContextMenuForFlattenedContent, true);
    contentNamespaceForFlattenedContent.state.contextMenuTrackingBoundForFlattenedContent = true;
  }

  function getSelectionCloneRootForFlattenedContent() {
    if (!window.getSelection) {
      return null;
    }

    const selectedRangeForFlattenedContent = window.getSelection();
    if (!selectedRangeForFlattenedContent || selectedRangeForFlattenedContent.rangeCount < 1) {
      return null;
    }
    if (selectedRangeForFlattenedContent.isCollapsed) {
      return null;
    }

    const firstRangeForFlattenedContent = selectedRangeForFlattenedContent.getRangeAt(0);
    if (!firstRangeForFlattenedContent) {
      return null;
    }

    const wrapperForFlattenedContent = document.createElement("div");
    wrapperForFlattenedContent.setAttribute("data-abchat-fragment-root", "selection");
    wrapperForFlattenedContent.appendChild(firstRangeForFlattenedContent.cloneContents());
    return wrapperForFlattenedContent;
  }

  function getTargetRootForFlattenedContent(optionsForFlattenedContent) {
    const shouldPreferContextMenuTargetForFlattenedContent = Boolean(
      optionsForFlattenedContent && optionsForFlattenedContent.preferContextMenuTarget
    );
    if (shouldPreferContextMenuTargetForFlattenedContent) {
      const pendingContextMenuTargetForFlattenedContent = getPendingContextMenuTargetForFlattenedContent();
      clearPendingContextMenuTargetForFlattenedContent();
      if (pendingContextMenuTargetForFlattenedContent) {
        return {
          root: pendingContextMenuTargetForFlattenedContent,
          scope: "contextMenuTarget"
        };
      }
    }

    const selectedRootForFlattenedContent = getSelectionCloneRootForFlattenedContent();
    if (selectedRootForFlattenedContent) {
      return {
        root: selectedRootForFlattenedContent,
        scope: "selection"
      };
    }

    const pageRootForFlattenedContent = document.body;

    return {
      root: pageRootForFlattenedContent,
      scope: "page"
    };
  }

  // Sync with: flattenMediaElementsForFetch in agent/toolExec.js
  function flattenMediaElementsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }
    rootNodeForFlattenedContent.querySelectorAll("iframe,audio,video").forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent) return;
      const srcForFlattenedContent = nodeForFlattenedContent.getAttribute("src") || "";
      while (nodeForFlattenedContent.firstChild) {
        nodeForFlattenedContent.removeChild(nodeForFlattenedContent.firstChild);
      }
      while (nodeForFlattenedContent.attributes.length) {
        nodeForFlattenedContent.removeAttribute(nodeForFlattenedContent.attributes[0].name);
      }
      if (srcForFlattenedContent) {
        nodeForFlattenedContent.setAttribute("src", srcForFlattenedContent);
      }
    });
  }

  // Sync with: removeNoiseElementsForFetch in agent/toolExec.js
  function removeNoiseElementsForFlattenedContent(rootNodeForFlattenedContent, removeStructuralElements) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }

    rootNodeForFlattenedContent.querySelectorAll(
      "script,style,noscript,meta,link,canvas"
    ).forEach((nodeForFlattenedContent) => {
      if (nodeForFlattenedContent && nodeForFlattenedContent.remove) {
        nodeForFlattenedContent.remove();
      }
    });

    if (removeStructuralElements) {
      rootNodeForFlattenedContent.querySelectorAll(
        "nav,header,footer,aside,button,iframe,audio,video"
      ).forEach((nodeForFlattenedContent) => {
        if (nodeForFlattenedContent && nodeForFlattenedContent.remove) {
          nodeForFlattenedContent.remove();
        }
      });
    } else {
      flattenMediaElementsForFlattenedContent(rootNodeForFlattenedContent);
    }
  }

  // Sync with: normalizeFormElementsForFetch in agent/toolExec.js
  function normalizeFormElementsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll || !document || !document.createElement) {
      return;
    }

    rootNodeForFlattenedContent.querySelectorAll("form").forEach((formNodeForFlattenedContent) => {
      if (!formNodeForFlattenedContent || !formNodeForFlattenedContent.getAttribute || !formNodeForFlattenedContent.setAttribute) {
        return;
      }
      const actionValueForFlattenedContent = formNodeForFlattenedContent.getAttribute("action") || "";
      while (formNodeForFlattenedContent.attributes.length) {
        formNodeForFlattenedContent.removeAttribute(formNodeForFlattenedContent.attributes[0].name);
      }
      formNodeForFlattenedContent.setAttribute("action", actionValueForFlattenedContent);
    });

    rootNodeForFlattenedContent.querySelectorAll("input").forEach((inputNodeForFlattenedContent) => {
      if (!inputNodeForFlattenedContent || !inputNodeForFlattenedContent.getAttribute || !inputNodeForFlattenedContent.setAttribute) {
        return;
      }

      const typeValueForFlattenedContent = (inputNodeForFlattenedContent.getAttribute("type") || "").toLowerCase();
      const nameValueForFlattenedContent = inputNodeForFlattenedContent.getAttribute("name") || "";
      const placeholderValueForFlattenedContent = inputNodeForFlattenedContent.getAttribute("placeholder") || "";

      if (typeValueForFlattenedContent === "checkbox" || typeValueForFlattenedContent === "radio") {
        const replacementTagForFlattenedContent = typeValueForFlattenedContent === "checkbox" ? "checkbox" : "radio";
        const replacementNodeForFlattenedContent = document.createElement(replacementTagForFlattenedContent);
        if (nameValueForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
        } else if (placeholderValueForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
        }
        if (inputNodeForFlattenedContent.replaceWith) {
          inputNodeForFlattenedContent.replaceWith(replacementNodeForFlattenedContent);
        }
        return;
      }

      while (inputNodeForFlattenedContent.attributes.length) {
        inputNodeForFlattenedContent.removeAttribute(inputNodeForFlattenedContent.attributes[0].name);
      }
      if (nameValueForFlattenedContent) {
        inputNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
      } else if (placeholderValueForFlattenedContent) {
        inputNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
      }
    });

    rootNodeForFlattenedContent.querySelectorAll("select").forEach((selectNodeForFlattenedContent) => {
      if (!selectNodeForFlattenedContent || !selectNodeForFlattenedContent.getAttribute || !selectNodeForFlattenedContent.setAttribute) {
        return;
      }
      const nameValueForFlattenedContent = selectNodeForFlattenedContent.getAttribute("name") || "";
      const placeholderValueForFlattenedContent = selectNodeForFlattenedContent.getAttribute("placeholder") || "";
      // Remove non-option children (e.g. optgroup); keep option elements for their text content.
      Array.from(selectNodeForFlattenedContent.children).forEach((childForFlattenedContent) => {
        if (childForFlattenedContent.tagName && childForFlattenedContent.tagName.toLowerCase() !== "option") {
          childForFlattenedContent.remove();
        }
      });
      while (selectNodeForFlattenedContent.attributes.length) {
        selectNodeForFlattenedContent.removeAttribute(selectNodeForFlattenedContent.attributes[0].name);
      }
      if (nameValueForFlattenedContent) {
        selectNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
      } else if (placeholderValueForFlattenedContent) {
        selectNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
      }
    });

    rootNodeForFlattenedContent.querySelectorAll("textarea").forEach((textareaNodeForFlattenedContent) => {
      if (!textareaNodeForFlattenedContent || !textareaNodeForFlattenedContent.getAttribute || !textareaNodeForFlattenedContent.setAttribute) {
        return;
      }
      const nameValueForFlattenedContent = textareaNodeForFlattenedContent.getAttribute("name") || "";
      const placeholderValueForFlattenedContent = textareaNodeForFlattenedContent.getAttribute("placeholder") || "";
      textareaNodeForFlattenedContent.textContent = "";
      while (textareaNodeForFlattenedContent.attributes.length) {
        textareaNodeForFlattenedContent.removeAttribute(textareaNodeForFlattenedContent.attributes[0].name);
      }
      if (nameValueForFlattenedContent) {
        textareaNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
      } else if (placeholderValueForFlattenedContent) {
        textareaNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
      }
    });
  }

  // Sync with: removeCommentsForFetch in agent/toolExec.js
  function removeCommentsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !document || !document.createTreeWalker) {
      return;
    }

    const commentNodesForFlattenedContent = [];
    const walkerForFlattenedContent = document.createTreeWalker(
      rootNodeForFlattenedContent,
      NodeFilter.SHOW_COMMENT
    );

    let currentCommentForFlattenedContent = walkerForFlattenedContent.nextNode();
    while (currentCommentForFlattenedContent) {
      commentNodesForFlattenedContent.push(currentCommentForFlattenedContent);
      currentCommentForFlattenedContent = walkerForFlattenedContent.nextNode();
    }

    commentNodesForFlattenedContent.forEach((nodeForFlattenedContent) => {
      if (nodeForFlattenedContent && nodeForFlattenedContent.parentNode) {
        nodeForFlattenedContent.parentNode.removeChild(nodeForFlattenedContent);
      }
    });
  }

  // Sync with: cleanLongAnchorUrlsForFetch in agent/toolExec.js
  function cleanLongAnchorUrlsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }

    rootNodeForFlattenedContent.querySelectorAll("a[href]").forEach((linkForFlattenedContent) => {
      const hrefForFlattenedContent = linkForFlattenedContent.getAttribute("href");
      if (!hrefForFlattenedContent) {
        return;
      }

      const splitByHashForFlattenedContent = hrefForFlattenedContent.split("#");
      const baseAndQueryForFlattenedContent = splitByHashForFlattenedContent[0] || "";
      const hashForFlattenedContent = splitByHashForFlattenedContent[1] || "";
      const splitByQueryForFlattenedContent = baseAndQueryForFlattenedContent.split("?");
      const basePathForFlattenedContent = splitByQueryForFlattenedContent[0] || baseAndQueryForFlattenedContent;
      const queryForFlattenedContent = splitByQueryForFlattenedContent[1] || "";

      if (hashForFlattenedContent.length >= 20) {
        linkForFlattenedContent.setAttribute("href", baseAndQueryForFlattenedContent);
        return;
      }

      if (queryForFlattenedContent.length > 120) {
        linkForFlattenedContent.setAttribute("href", basePathForFlattenedContent);
      }
    });
  }

  // Sync with: resolveRelativeUrlsForFetch in agent/toolExec.js
  function relativizeUrlsForFlattenedContent(rootNodeForFlattenedContent) {
    if (
      !rootNodeForFlattenedContent ||
      !rootNodeForFlattenedContent.querySelectorAll ||
      typeof window === "undefined" ||
      !window.location ||
      !window.location.origin ||
      window.location.origin === "null"
    ) {
      return;
    }

    const currentOriginForFlattenedContent = window.location.origin;

    rootNodeForFlattenedContent.querySelectorAll("a[href]").forEach((linkForFlattenedContent) => {
      const hrefForFlattenedContent = linkForFlattenedContent.getAttribute("href");
      if (!hrefForFlattenedContent) {
        return;
      }
      try {
        const parsedUrlForFlattenedContent = new URL(hrefForFlattenedContent);
        if (parsedUrlForFlattenedContent.origin === currentOriginForFlattenedContent) {
          linkForFlattenedContent.setAttribute(
            "href",
            parsedUrlForFlattenedContent.pathname + parsedUrlForFlattenedContent.search + parsedUrlForFlattenedContent.hash
          );
        }
      } catch (errForFlattenedContent) {}
    });

    rootNodeForFlattenedContent.querySelectorAll("form[action]").forEach((formForFlattenedContent) => {
      const actionForFlattenedContent = formForFlattenedContent.getAttribute("action");
      if (!actionForFlattenedContent) {
        return;
      }
      try {
        const parsedUrlForFlattenedContent = new URL(actionForFlattenedContent);
        if (parsedUrlForFlattenedContent.origin === currentOriginForFlattenedContent) {
          formForFlattenedContent.setAttribute(
            "action",
            parsedUrlForFlattenedContent.pathname + parsedUrlForFlattenedContent.search + parsedUrlForFlattenedContent.hash
          );
        }
      } catch (errForFlattenedContent) {}
    });
  }

  // Sync with: stripAttributesForFetch in agent/toolExec.js
  function stripAttributesForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }

    const allowedByTagForFlattenedContent = {
      a: new Set(["href"]),
      form: new Set(["action"]),
      input: new Set(["name", "placeholder"]),
      select: new Set(["name", "placeholder"]),
      textarea: new Set(["name", "placeholder"]),
      checkbox: new Set(["name", "placeholder"]),
      radio: new Set(["name", "placeholder"]),
      td: new Set(["colspan", "rowspan"]),
      th: new Set(["colspan", "rowspan", "scope"]),
      ol: new Set(["start"]),
      li: new Set(["value"])
    };

    const allNodesForFlattenedContent = [rootNodeForFlattenedContent].concat(
      Array.from(rootNodeForFlattenedContent.querySelectorAll("*"))
    );
    allNodesForFlattenedContent.forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent || !nodeForFlattenedContent.attributes) {
        return;
      }

      const tagNameForFlattenedContent = nodeForFlattenedContent.tagName
        ? nodeForFlattenedContent.tagName.toLowerCase()
        : "";
      const allowedAttributesForFlattenedContent = allowedByTagForFlattenedContent[tagNameForFlattenedContent] || new Set();

      Array.from(nodeForFlattenedContent.attributes).forEach((attributeForFlattenedContent) => {
        const attributeNameForFlattenedContent = (attributeForFlattenedContent.name || "").toLowerCase();
        const shouldKeepAttributeForFlattenedContent =
          attributeNameForFlattenedContent === "hidden" ||
          allowedAttributesForFlattenedContent.has(attributeNameForFlattenedContent);
        if (!shouldKeepAttributeForFlattenedContent) {
          nodeForFlattenedContent.removeAttribute(attributeForFlattenedContent.name);
        }
      });
    });
  }

  // Sync with: isCustomTagForFetch in agent/toolExec.js
  function isCustomTagForFlattenedContent(tagNameForFlattenedContent) {
    if (!tagNameForFlattenedContent || typeof tagNameForFlattenedContent !== "string") {
      return false;
    }
    return tagNameForFlattenedContent.includes("-");
  }

  // Sync with: getReplacementTagForCustomNodeForFetch in agent/toolExec.js
  function getReplacementTagForCustomNodeForFlattenedContent(nodeForFlattenedContent) {
    if (!nodeForFlattenedContent || !nodeForFlattenedContent.children) {
      return "span";
    }

    const inlineTagsForFlattenedContent = new Set([
      "a",
      "abbr",
      "b",
      "br",
      "code",
      "em",
      "i",
      "img",
      "label",
      "mark",
      "q",
      "s",
      "small",
      "span",
      "strong",
      "sub",
      "sup",
      "time",
      "u"
    ]);

    const childrenForFlattenedContent = Array.from(nodeForFlattenedContent.children);
    if (!childrenForFlattenedContent.length) {
      return "span";
    }

    const hasBlockLikeChildForFlattenedContent = childrenForFlattenedContent.some((childForFlattenedContent) => {
      if (!childForFlattenedContent || !childForFlattenedContent.tagName) {
        return false;
      }
      const childTagForFlattenedContent = childForFlattenedContent.tagName.toLowerCase();
      return !inlineTagsForFlattenedContent.has(childTagForFlattenedContent);
    });

    return hasBlockLikeChildForFlattenedContent ? "div" : "span";
  }

  // Sync with: convertNodeToTagForFetch in agent/toolExec.js
  function convertNodeToTagForFlattenedContent(nodeForFlattenedContent, replacementTagForFlattenedContent) {
    if (!nodeForFlattenedContent || !replacementTagForFlattenedContent || !document || !document.createElement) {
      return nodeForFlattenedContent;
    }

    const replacementNodeForFlattenedContent = document.createElement(replacementTagForFlattenedContent);
    while (nodeForFlattenedContent.firstChild) {
      replacementNodeForFlattenedContent.appendChild(nodeForFlattenedContent.firstChild);
    }

    if (nodeForFlattenedContent.parentNode && nodeForFlattenedContent.replaceWith) {
      nodeForFlattenedContent.replaceWith(replacementNodeForFlattenedContent);
    }

    return replacementNodeForFlattenedContent;
  }

  // Sync with: normalizeCustomElementsForFetch in agent/toolExec.js
  function normalizeCustomElementsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return rootNodeForFlattenedContent;
    }

    let normalizedRootForFlattenedContent = rootNodeForFlattenedContent;
    if (
      normalizedRootForFlattenedContent.tagName &&
      isCustomTagForFlattenedContent(normalizedRootForFlattenedContent.tagName.toLowerCase())
    ) {
      const rootReplacementTagForFlattenedContent =
        getReplacementTagForCustomNodeForFlattenedContent(normalizedRootForFlattenedContent);
      const convertedRootForFlattenedContent = convertNodeToTagForFlattenedContent(
        normalizedRootForFlattenedContent,
        rootReplacementTagForFlattenedContent
      );

      if (!normalizedRootForFlattenedContent.parentNode) {
        normalizedRootForFlattenedContent = convertedRootForFlattenedContent;
      }
    }

    const customNodesForFlattenedContent = Array.from(normalizedRootForFlattenedContent.querySelectorAll("*"))
      .filter((nodeForFlattenedContent) => {
        if (!nodeForFlattenedContent || !nodeForFlattenedContent.tagName) {
          return false;
        }
        return isCustomTagForFlattenedContent(nodeForFlattenedContent.tagName.toLowerCase());
      })
      .reverse();

    customNodesForFlattenedContent.forEach((customNodeForFlattenedContent) => {
      if (!customNodeForFlattenedContent || !customNodeForFlattenedContent.parentNode) {
        return;
      }
      const replacementTagForFlattenedContent =
        getReplacementTagForCustomNodeForFlattenedContent(customNodeForFlattenedContent);
      convertNodeToTagForFlattenedContent(customNodeForFlattenedContent, replacementTagForFlattenedContent);
    });

    return normalizedRootForFlattenedContent;
  }

  // Sync with: getImageTypeForFetch in agent/toolExec.js
  function getImageTypeForFlattenedContent(imgElementForFlattenedContent) {
    const srcForFlattenedContent =
      imgElementForFlattenedContent && imgElementForFlattenedContent.getAttribute
        ? imgElementForFlattenedContent.getAttribute("src") || ""
        : "";
    if (srcForFlattenedContent.startsWith("data:image/")) {
      const mimeForFlattenedContent = srcForFlattenedContent
        .slice("data:image/".length)
        .split(";")[0]
        .split("+")[0]
        .toLowerCase();
      return mimeForFlattenedContent || "unknown";
    }
    const noQueryForFlattenedContent = srcForFlattenedContent.split("?")[0].split("#")[0];
    const lastDotForFlattenedContent = noQueryForFlattenedContent.lastIndexOf(".");
    if (lastDotForFlattenedContent !== -1) {
      let extForFlattenedContent = noQueryForFlattenedContent.slice(lastDotForFlattenedContent + 1).toLowerCase();
      if (extForFlattenedContent === "jpeg") extForFlattenedContent = "jpg";
      if (
        extForFlattenedContent.length > 0 &&
        extForFlattenedContent.length <= 5 &&
        /^[a-z0-9]+$/.test(extForFlattenedContent)
      ) {
        return extForFlattenedContent;
      }
    }
    return "unknown";
  }

  // Sync with: replaceImagesForFetch in agent/toolExec.js
  function replaceImagesWithPlaceholderForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll || !document || !document.createElement) {
      return;
    }
    rootNodeForFlattenedContent.querySelectorAll("img").forEach((imageForFlattenedContent) => {
      if (!imageForFlattenedContent || !imageForFlattenedContent.replaceWith) {
        return;
      }
      const typeForFlattenedContent = getImageTypeForFlattenedContent(imageForFlattenedContent);
      let placeholderForFlattenedContent;
      try {
        placeholderForFlattenedContent = document.createElement("img_" + typeForFlattenedContent);
      } catch (errForFlattenedContent) {
        placeholderForFlattenedContent = document.createElement("img_unknown");
      }
      imageForFlattenedContent.replaceWith(placeholderForFlattenedContent);
    });
    rootNodeForFlattenedContent.querySelectorAll("svg").forEach((svgForFlattenedContent) => {
      if (!svgForFlattenedContent || !svgForFlattenedContent.replaceWith) {
        return;
      }
      let placeholderForFlattenedContent;
      try {
        placeholderForFlattenedContent = document.createElement("img_svg");
      } catch (errForFlattenedContent) {
        return;
      }
      svgForFlattenedContent.replaceWith(placeholderForFlattenedContent);
    });
  }

  // Sync with: getMeaningfulChildNodesForFetch in agent/toolExec.js
  function getMeaningfulChildNodesForFlattenedContent(nodeForFlattenedContent) {
    if (!nodeForFlattenedContent || !nodeForFlattenedContent.childNodes) {
      return [];
    }

    return Array.from(nodeForFlattenedContent.childNodes).filter((childNodeForFlattenedContent) => {
      if (!childNodeForFlattenedContent) {
        return false;
      }

      if (childNodeForFlattenedContent.nodeType === Node.COMMENT_NODE) {
        return false;
      }

      if (childNodeForFlattenedContent.nodeType === Node.TEXT_NODE) {
        const compactTextForFlattenedContent = (childNodeForFlattenedContent.textContent || "")
          .replace(/\s+/g, "")
          .trim();
        return compactTextForFlattenedContent.length > 0;
      }

      return true;
    });
  }

  // Sync with: flattenNestedWrappersForFetch in agent/toolExec.js
  function flattenNestedWrappersForFlattenedContent(rootNodeForFlattenedContent, wrapperTagsForFlattenedContent, maxDepthForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }

    const limitForFlattenedContent =
      typeof maxDepthForFlattenedContent === "number" ? maxDepthForFlattenedContent : 8;
    const targetTagsForFlattenedContent = wrapperTagsForFlattenedContent || ["div", "span"];

    let depthForFlattenedContent = 0;
    while (depthForFlattenedContent < limitForFlattenedContent) {
      let hasAnyFlattenedForFlattenedContent = false;
      targetTagsForFlattenedContent.forEach((tagForFlattenedContent) => {
        rootNodeForFlattenedContent.querySelectorAll(tagForFlattenedContent).forEach((nodeForFlattenedContent) => {
          if (!nodeForFlattenedContent || !nodeForFlattenedContent.childNodes) {
            return;
          }
          const childNodesForFlattenedContent = getMeaningfulChildNodesForFlattenedContent(nodeForFlattenedContent);
          if (
            childNodesForFlattenedContent.length === 1 &&
            childNodesForFlattenedContent[0].nodeType === Node.ELEMENT_NODE &&
            childNodesForFlattenedContent[0].tagName &&
            targetTagsForFlattenedContent.includes(childNodesForFlattenedContent[0].tagName.toLowerCase())
          ) {
            nodeForFlattenedContent.replaceWith(childNodesForFlattenedContent[0]);
            hasAnyFlattenedForFlattenedContent = true;
          }
        });
      });

      if (!hasAnyFlattenedForFlattenedContent) {
        break;
      }
      depthForFlattenedContent += 1;
    }
  }

  // Sync with: isProtectedChildForFetch in agent/toolExec.js
  function isProtectedChildForFlattenedContent(nodeForFlattenedContent) {
    if (!nodeForFlattenedContent || !nodeForFlattenedContent.tagName) {
      return false;
    }
    const tagForFlattenedContent = nodeForFlattenedContent.tagName.toLowerCase();
    return tagForFlattenedContent === "p" || /^h[1-6]$/.test(tagForFlattenedContent);
  }

  // Sync with: truncateOverloadedChildrenForFetch in agent/toolExec.js
  function truncateOverloadedChildrenForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll || !document || !document.createComment) {
      return;
    }

    const elementsForFlattenedContent = [rootNodeForFlattenedContent].concat(
      Array.from(rootNodeForFlattenedContent.querySelectorAll("*")).reverse()
    );

    elementsForFlattenedContent.forEach((elForFlattenedContent) => {
      if (!elForFlattenedContent || !elForFlattenedContent.children) {
        return;
      }

      const childrenForFlattenedContent = Array.from(elForFlattenedContent.children);
      if (childrenForFlattenedContent.length <= 50) {
        return;
      }

      const middleForFlattenedContent = childrenForFlattenedContent.slice(45, childrenForFlattenedContent.length - 5);
      const removableForFlattenedContent = middleForFlattenedContent.filter(
        (childForFlattenedContent) => !isProtectedChildForFlattenedContent(childForFlattenedContent)
      );

      if (!removableForFlattenedContent.length) {
        return;
      }

      const omittedCountForFlattenedContent = removableForFlattenedContent.length;
      const markerForFlattenedContent = document.createComment(
        " " + omittedCountForFlattenedContent + " item" + (omittedCountForFlattenedContent !== 1 ? "s" : "") + " omitted "
      );
      elForFlattenedContent.insertBefore(markerForFlattenedContent, removableForFlattenedContent[0]);
      removableForFlattenedContent.forEach((childForFlattenedContent) => {
        childForFlattenedContent.remove();
      });
    });
  }

  // Sync with: removeEmptyTagsForFetch in agent/toolExec.js
  function removeEmptyTagsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }

    const removableNodesForFlattenedContent = Array.from(rootNodeForFlattenedContent.querySelectorAll("*")).reverse();
    removableNodesForFlattenedContent.forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent || !nodeForFlattenedContent.parentNode || !nodeForFlattenedContent.tagName) {
        return;
      }

      const tagForFlattenedContent = nodeForFlattenedContent.tagName.toLowerCase();
      if (tagForFlattenedContent.startsWith("img_")) {
        return;
      }
      if (
        [
          "br",
          "hr",
          "img",
          "input",
          "form",
          "select",
          "textarea",
          "checkbox",
          "radio",
          "td",
          "th",
          "dd",
          "dt",
          "tr",
          "caption"
        ].includes(tagForFlattenedContent)
      ) {
        return;
      }

      const hasElementChildrenForFlattenedContent =
        nodeForFlattenedContent.children && nodeForFlattenedContent.children.length > 0;
      const textForFlattenedContent = stripInvisibleCharsForFlattenedContent(nodeForFlattenedContent.textContent || "").replace(/\s+/g, "").trim();
      if (!hasElementChildrenForFlattenedContent && !textForFlattenedContent) {
        nodeForFlattenedContent.parentNode.removeChild(nodeForFlattenedContent);
      }
    });
  }

  // Sync with: stripInvisibleCharsForFetch in agent/toolExec.js
  function stripInvisibleCharsForFlattenedContent(textForFlattenedContent) {
    if (!textForFlattenedContent || typeof textForFlattenedContent !== "string") {
      return textForFlattenedContent;
    }
    // Removes zero-width, soft-hyphen, directional marks, BOM, and other invisible Unicode
    return textForFlattenedContent.replace(
      /[\u00AD\u034F\u200B-\u200F\u2028\u2029\u202A-\u202F\u2060-\u2064\u206A-\u206F\uFEFF\uFFF9-\uFFFB]/gu,
      ""
    );
  }

  // Sync with: removeHiddenElementsForFetch in agent/toolExec.js (live-DOM version; uses getComputedStyle instead of inline style/attr checks)
  function markHiddenElementsForFlattenedContent(rootNodeForFlattenedContent) {
    if (
      !rootNodeForFlattenedContent ||
      !rootNodeForFlattenedContent.querySelectorAll ||
      !rootNodeForFlattenedContent.isConnected ||
      typeof window === "undefined" ||
      !window.getComputedStyle
    ) {
      return [];
    }
    const markedForFlattenedContent = [];
    [rootNodeForFlattenedContent]
      .concat(getAllElementsIncludingShadowsForFlattenedContent(rootNodeForFlattenedContent))
      .forEach((nodeForFlattenedContent) => {
        if (!nodeForFlattenedContent || !nodeForFlattenedContent.tagName) return;
        try {
          const csForFlattenedContent = window.getComputedStyle(nodeForFlattenedContent);
          if (csForFlattenedContent.display === "none" || csForFlattenedContent.visibility === "hidden") {
            nodeForFlattenedContent.setAttribute("data-abchat-hidden-marker", "1");
            markedForFlattenedContent.push(nodeForFlattenedContent);
          }
        } catch (errForFlattenedContent) {}
      });
    return markedForFlattenedContent;
  }

  function unmarkHiddenElementsForFlattenedContent(markedNodesForFlattenedContent) {
    (markedNodesForFlattenedContent || []).forEach((nodeForFlattenedContent) => {
      if (nodeForFlattenedContent && nodeForFlattenedContent.removeAttribute) {
        nodeForFlattenedContent.removeAttribute("data-abchat-hidden-marker");
      }
    });
  }

  // Sync with: removeHiddenElementsForFetch in agent/toolExec.js
  function removeHiddenElementsForFlattenedContent(clonedRootForFlattenedContent) {
    if (!clonedRootForFlattenedContent || !clonedRootForFlattenedContent.querySelectorAll) {
      return;
    }
    clonedRootForFlattenedContent.querySelectorAll("[data-abchat-hidden-marker]").forEach((nodeForFlattenedContent) => {
      if (nodeForFlattenedContent && nodeForFlattenedContent.remove) nodeForFlattenedContent.remove();
    });
    Array.from(clonedRootForFlattenedContent.querySelectorAll("*")).forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent) return;
      const inlineStyleForFlattenedContent = nodeForFlattenedContent.style;
      const isInlineHiddenForFlattenedContent =
        inlineStyleForFlattenedContent &&
        (inlineStyleForFlattenedContent.display === "none" || inlineStyleForFlattenedContent.visibility === "hidden");
      const hasHiddenAttrForFlattenedContent =
        nodeForFlattenedContent.hasAttribute && nodeForFlattenedContent.hasAttribute("hidden");
      const isAriaHiddenForFlattenedContent =
        nodeForFlattenedContent.getAttribute && nodeForFlattenedContent.getAttribute("aria-hidden") === "true";
      if (
        (isInlineHiddenForFlattenedContent || hasHiddenAttrForFlattenedContent || isAriaHiddenForFlattenedContent) &&
        nodeForFlattenedContent.remove
      ) {
        nodeForFlattenedContent.remove();
      }
    });
  }

  // Sync with: removeHiddenElementsForFetch in agent/toolExec.js (marked mode: stamps native hidden attr instead of removing)
  function normalizeHiddenElementsForFlattenedContent(clonedRootForFlattenedContent) {
    if (!clonedRootForFlattenedContent || !clonedRootForFlattenedContent.querySelectorAll) {
      return;
    }
    // Convert temp marker (set via getComputedStyle on the live DOM) to native hidden attribute
    clonedRootForFlattenedContent.querySelectorAll("[data-abchat-hidden-marker]").forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent) return;
      nodeForFlattenedContent.removeAttribute("data-abchat-hidden-marker");
      nodeForFlattenedContent.setAttribute("hidden", "");
    });
    // Normalize inline styles and aria-hidden to hidden (covers detached/fragment roots)
    Array.from(clonedRootForFlattenedContent.querySelectorAll("*")).forEach((nodeForFlattenedContent) => {
      if (!nodeForFlattenedContent) return;
      const inlineStyleForFlattenedContent = nodeForFlattenedContent.style;
      const isInlineHiddenForFlattenedContent =
        inlineStyleForFlattenedContent &&
        (inlineStyleForFlattenedContent.display === "none" || inlineStyleForFlattenedContent.visibility === "hidden");
      const isAriaHiddenForFlattenedContent =
        nodeForFlattenedContent.getAttribute && nodeForFlattenedContent.getAttribute("aria-hidden") === "true";
      if (isInlineHiddenForFlattenedContent || isAriaHiddenForFlattenedContent) {
        nodeForFlattenedContent.setAttribute("hidden", "");
      }
    });
  }

  function getAllElementsIncludingShadowsForFlattenedContent(rootNodeForFlattenedContent) {
    const resultForFlattenedContent = [];
    const stackForFlattenedContent = [rootNodeForFlattenedContent];
    while (stackForFlattenedContent.length) {
      const currentForFlattenedContent = stackForFlattenedContent.pop();
      if (!currentForFlattenedContent || !currentForFlattenedContent.querySelectorAll) continue;
      const childrenForFlattenedContent = Array.from(currentForFlattenedContent.querySelectorAll("*"));
      childrenForFlattenedContent.forEach(function (elForFlattenedContent) {
        resultForFlattenedContent.push(elForFlattenedContent);
        if (elForFlattenedContent.shadowRoot && elForFlattenedContent.id !== "abchat-panel-shadow-host") {
          stackForFlattenedContent.push(elForFlattenedContent.shadowRoot);
        }
      });
    }
    return resultForFlattenedContent;
  }

  // Elements are created in a browsing-context-less document so custom elements defined on the
  // page are never constructed. A custom element constructor that sets attributes or children
  // makes the live document.createElement throw NotSupportedError ("The result must not have
  // attributes"), which would abort the whole flatten (the cloneNode fallback at the call sites
  // only handles a null return, not a thrown error). An inert document has no custom element
  // registry, so createElement returns a plain element and the real tag name is preserved.
  let inertDocumentForFlattenedContent = null;

  function createFlattenedElementForFlattenedContent(tagNameForFlattenedContent) {
    if (!inertDocumentForFlattenedContent && document.implementation && document.implementation.createHTMLDocument) {
      try {
        inertDocumentForFlattenedContent = document.implementation.createHTMLDocument("");
      } catch (errForInertDoc) {
        inertDocumentForFlattenedContent = null;
      }
    }
    if (inertDocumentForFlattenedContent) {
      try {
        return inertDocumentForFlattenedContent.createElement(tagNameForFlattenedContent);
      } catch (errForInertCreate) {}
    }
    try {
      return document.createElement(tagNameForFlattenedContent);
    } catch (errForLiveCreate) {}
    try {
      return document.createElement("div");
    } catch (errForDivCreate) {}
    return null;
  }

  function cloneNodeWithShadowsForFlattenedContent(liveNodeForFlattenedContent) {
    if (!liveNodeForFlattenedContent || !document || !document.createElement) {
      return null;
    }
    if (liveNodeForFlattenedContent.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(liveNodeForFlattenedContent.textContent || "");
    }
    if (liveNodeForFlattenedContent.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const tagNameForFlattenedContent = (liveNodeForFlattenedContent.tagName || "div").toLowerCase();
    // Skip slot elements: their slotted content is already present in the host's light DOM children
    if (tagNameForFlattenedContent === "slot") {
      return null;
    }
    const clonedElForFlattenedContent = createFlattenedElementForFlattenedContent(tagNameForFlattenedContent);
    if (!clonedElForFlattenedContent) {
      return null;
    }
    Array.from(liveNodeForFlattenedContent.attributes || []).forEach(function (attrForFlattenedContent) {
      try {
        clonedElForFlattenedContent.setAttribute(attrForFlattenedContent.name, attrForFlattenedContent.value);
      } catch (errForFlattenedContent) {}
    });
    Array.from(liveNodeForFlattenedContent.childNodes || []).forEach(function (childForFlattenedContent) {
      const clonedChildForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(childForFlattenedContent);
      if (clonedChildForFlattenedContent) {
        try {
          clonedElForFlattenedContent.appendChild(clonedChildForFlattenedContent);
        } catch (errForAppendChild) {}
      }
    });
    if (liveNodeForFlattenedContent.shadowRoot && liveNodeForFlattenedContent.id !== "abchat-panel-shadow-host") {
      Array.from(liveNodeForFlattenedContent.shadowRoot.childNodes || []).forEach(function (shadowChildForFlattenedContent) {
        const clonedShadowChildForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(shadowChildForFlattenedContent);
        if (clonedShadowChildForFlattenedContent) {
          try {
            clonedElForFlattenedContent.appendChild(clonedShadowChildForFlattenedContent);
          } catch (errForAppendShadowChild) {}
        }
      });
    }
    return clonedElForFlattenedContent;
  }

  function removeLightNoiseElementsForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll) {
      return;
    }
    rootNodeForFlattenedContent.querySelectorAll(
      "script,style,noscript,meta,link,svg,canvas"
    ).forEach((nodeForFlattenedContent) => {
      if (nodeForFlattenedContent && nodeForFlattenedContent.remove) {
        nodeForFlattenedContent.remove();
      }
    });
    flattenMediaElementsForFlattenedContent(rootNodeForFlattenedContent);
  }

  function buildRawHtmlPayloadForFlattenedContent(targetRootForFlattenedContent) {
    if (!targetRootForFlattenedContent || !targetRootForFlattenedContent.cloneNode) {
      return "";
    }

    const shouldTrackHiddenForRaw = hiddenElementModeForFlattenedContent !== "unmarked";
    const markedHiddenForRaw = shouldTrackHiddenForRaw
      ? markHiddenElementsForFlattenedContent(targetRootForFlattenedContent)
      : [];
    let clonedRootForRaw = cloneNodeWithShadowsForFlattenedContent(targetRootForFlattenedContent)
      || targetRootForFlattenedContent.cloneNode(true);
    unmarkHiddenElementsForFlattenedContent(markedHiddenForRaw);

    const isFragmentRootForRaw =
      clonedRootForRaw.getAttribute &&
      clonedRootForRaw.getAttribute("data-abchat-fragment-root");

    if (hiddenElementModeForFlattenedContent === "removed") {
      removeHiddenElementsForFlattenedContent(clonedRootForRaw);
    } else if (hiddenElementModeForFlattenedContent === "marked") {
      normalizeHiddenElementsForFlattenedContent(clonedRootForRaw);
    }

    removeLightNoiseElementsForFlattenedContent(clonedRootForRaw);
    removeCommentsForFlattenedContent(clonedRootForRaw);

    const rawHtmlForRaw = isFragmentRootForRaw
      ? clonedRootForRaw.innerHTML
      : clonedRootForRaw.outerHTML;

    if (!rawHtmlForRaw || typeof rawHtmlForRaw !== "string") {
      return "";
    }

    return stripInvisibleCharsForFlattenedContent(rawHtmlForRaw).replace(/\s+/g, " ").trim();
  }

  // Adapted into flattenFetchedHtmlForToolExec in agent/toolExec.js (for web_fetch on remote HTML).
  // Keep both functions in sync: any logic change to one should be reflected in the other.
  function buildCleanHtmlPayloadForFlattenedContent(targetRootForFlattenedContent, optionsForFlattenedContent) {
    if (!targetRootForFlattenedContent || !targetRootForFlattenedContent.cloneNode) {
      return "";
    }
    if (!optionsForFlattenedContent || typeof optionsForFlattenedContent.removeStructuralElements !== "boolean") {
      console.warn("[ABChat] buildCleanHtmlPayloadForFlattenedContent: options.removeStructuralElements must be a boolean");
    }
    const removeStructuralElementsForFlattenedContent =
      optionsForFlattenedContent && optionsForFlattenedContent.removeStructuralElements === true;

    const shouldTrackHiddenForFlattenedContent = hiddenElementModeForFlattenedContent !== "unmarked";
    const markedHiddenForFlattenedContent = shouldTrackHiddenForFlattenedContent
      ? markHiddenElementsForFlattenedContent(targetRootForFlattenedContent)
      : [];
    let clonedRootForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(targetRootForFlattenedContent)
      || targetRootForFlattenedContent.cloneNode(true);
    unmarkHiddenElementsForFlattenedContent(markedHiddenForFlattenedContent);
    const isFragmentRootForFlattenedContent =
      clonedRootForFlattenedContent.getAttribute &&
      clonedRootForFlattenedContent.getAttribute("data-abchat-fragment-root");
    if (hiddenElementModeForFlattenedContent === "removed") {
      removeHiddenElementsForFlattenedContent(clonedRootForFlattenedContent);
    } else if (hiddenElementModeForFlattenedContent === "marked") {
      normalizeHiddenElementsForFlattenedContent(clonedRootForFlattenedContent);
    }
    removeNoiseElementsForFlattenedContent(clonedRootForFlattenedContent, removeStructuralElementsForFlattenedContent);
    removeCommentsForFlattenedContent(clonedRootForFlattenedContent);
    cleanLongAnchorUrlsForFlattenedContent(clonedRootForFlattenedContent);
    relativizeUrlsForFlattenedContent(clonedRootForFlattenedContent);
    clonedRootForFlattenedContent = normalizeCustomElementsForFlattenedContent(clonedRootForFlattenedContent);
    normalizeFormElementsForFlattenedContent(clonedRootForFlattenedContent);
    replaceImagesWithPlaceholderForFlattenedContent(clonedRootForFlattenedContent);
    stripAttributesForFlattenedContent(clonedRootForFlattenedContent);
    flattenNestedWrappersForFlattenedContent(clonedRootForFlattenedContent, ["div", "span"], 8);
    if (!optionsForFlattenedContent || !optionsForFlattenedContent.skipTruncate) {
      truncateOverloadedChildrenForFlattenedContent(clonedRootForFlattenedContent);
    }
    removeEmptyTagsForFlattenedContent(clonedRootForFlattenedContent);

    const rawHtmlForFlattenedContent = isFragmentRootForFlattenedContent
      ? clonedRootForFlattenedContent.innerHTML
      : clonedRootForFlattenedContent.outerHTML;

    if (!rawHtmlForFlattenedContent || typeof rawHtmlForFlattenedContent !== "string") {
      return "";
    }

    const collapsedHtmlForFlattenedContent = rawHtmlForFlattenedContent.replace(/<(img_[a-z0-9]+)><\/\1>/gi, "<$1>");
    return stripInvisibleCharsForFlattenedContent(collapsedHtmlForFlattenedContent).replace(/\s+/g, " ").trim();
  }

  function toSelfClosingTagForFlattenedContent(tagNameForFlattenedContent, attrNameForFlattenedContent, attrValueForFlattenedContent) {
    if (attrNameForFlattenedContent && attrValueForFlattenedContent) {
      return "<" + tagNameForFlattenedContent + ' ' + attrNameForFlattenedContent + '="' + attrValueForFlattenedContent + '" />';
    }
    return "<" + tagNameForFlattenedContent + " />";
  }

  // Sync with: formatFormElementsForFetch in agent/toolExec.js
  function formatFormElementsForPromptForFlattenedContent(cleanHtmlPayloadForFlattenedContent) {
    if (!cleanHtmlPayloadForFlattenedContent || typeof cleanHtmlPayloadForFlattenedContent !== "string") {
      return "";
    }

    let formattedPayloadForFlattenedContent = cleanHtmlPayloadForFlattenedContent;

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<input name="([^"]+)">/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return toSelfClosingTagForFlattenedContent("input", "name", vForFlattenedContent); }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<input placeholder="([^"]+)">/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return toSelfClosingTagForFlattenedContent("input", "placeholder", vForFlattenedContent); }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<input>/gi,
      function () { return toSelfClosingTagForFlattenedContent("input", "", ""); }
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<textarea name="([^"]+)"><\/textarea>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return toSelfClosingTagForFlattenedContent("textarea", "name", vForFlattenedContent); }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<textarea placeholder="([^"]+)"><\/textarea>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return toSelfClosingTagForFlattenedContent("textarea", "placeholder", vForFlattenedContent); }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<textarea><\/textarea>/gi,
      function () { return toSelfClosingTagForFlattenedContent("textarea", "", ""); }
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<checkbox name="([^"]+)"><\/checkbox>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return '<checkbox name="' + vForFlattenedContent + '">'; }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<checkbox placeholder="([^"]+)"><\/checkbox>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return '<checkbox placeholder="' + vForFlattenedContent + '">'; }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<checkbox><\/checkbox>/gi,
      "<checkbox>"
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<radio name="([^"]+)"><\/radio>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return '<radio name="' + vForFlattenedContent + '">'; }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<radio placeholder="([^"]+)"><\/radio>/gi,
      function (_mForFlattenedContent, vForFlattenedContent) { return '<radio placeholder="' + vForFlattenedContent + '">'; }
    );
    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<radio><\/radio>/gi,
      "<radio>"
    );

    return formattedPayloadForFlattenedContent;
  }

  function buildPrefixedPayloadForFlattenedContent(cleanHtmlPayloadForFlattenedContent) {
    const pageTitleForFlattenedContent =
      typeof document !== "undefined" && typeof document.title === "string" ? document.title : "";
    const pageUrlForFlattenedContent =
      typeof window !== "undefined" && window.location && typeof window.location.href === "string"
        ? window.location.href
        : "";

    return (
      "Note: The following content is a flattened, simplified representation of the page DOM. It is not an exact copy of the source HTML.\n\n" +
      "Page Title: " +
      pageTitleForFlattenedContent +
      "\n" +
      "Page URL: " +
      pageUrlForFlattenedContent +
      "\n\n" +
      cleanHtmlPayloadForFlattenedContent
    );
  }

  async function copyFlattenedContentForFlattenedContent(actionRequestForFlattenedContent) {
    if (!clipboardUtilsForFlattenedContent || !document || !document.body) {
      return;
    }

    const actionSourceForFlattenedContent =
      actionRequestForFlattenedContent && typeof actionRequestForFlattenedContent.actionSource === "string"
        ? actionRequestForFlattenedContent.actionSource
        : "";
    const targetForFlattenedContent = getTargetRootForFlattenedContent({
      preferContextMenuTarget: actionSourceForFlattenedContent === "contextMenu"
    });
    if (!targetForFlattenedContent || !targetForFlattenedContent.root) {
      if (toastForFlattenedContent) {
        toastForFlattenedContent.show("No content found to flatten.");
      }
      return;
    }

    const cleanHtmlPayloadForFlattenedContent = buildCleanHtmlPayloadForFlattenedContent(targetForFlattenedContent.root, { removeStructuralElements: false });
    if (!cleanHtmlPayloadForFlattenedContent) {
      if (toastForFlattenedContent) {
        toastForFlattenedContent.show("No clean HTML content to copy.");
      }
      return;
    }

    const formattedHtmlPayloadForFlattenedContent =
      formatFormElementsForPromptForFlattenedContent(cleanHtmlPayloadForFlattenedContent);
    const prefixedPayloadForFlattenedContent = buildPrefixedPayloadForFlattenedContent(
      formattedHtmlPayloadForFlattenedContent
    );
    const didCopyForFlattenedContent = await clipboardUtilsForFlattenedContent.copyText(prefixedPayloadForFlattenedContent);
    if (!didCopyForFlattenedContent) {
      if (toastForFlattenedContent) {
        toastForFlattenedContent.show("Copy failed.");
      }
      return;
    }

    if (storageManagerForFlattenedContent) {
      storageManagerForFlattenedContent.saveLastCopyMeta({
        action: "copyFlattenedContent",
        timestamp: new Date().toISOString()
      });
    }

    if (toastForFlattenedContent) {
      if (targetForFlattenedContent.scope === "contextMenuTarget") {
        toastForFlattenedContent.show("Copied clean HTML from context-menu target.");
      } else if (targetForFlattenedContent.scope === "highlighted") {
        toastForFlattenedContent.show("Copied clean HTML from highlighted content.");
      } else if (targetForFlattenedContent.scope === "selection") {
        toastForFlattenedContent.show("Copied clean HTML from selection.");
      } else {
        toastForFlattenedContent.show("Copied clean HTML from page.");
      }
    }
  }

  function getFullPageContentForFlattenedContent() {
    if (!document || !document.body) {
      return { ok: false, error: "No document body available." };
    }
    try {
      var cleanHtmlForGet = buildCleanHtmlPayloadForFlattenedContent(document.body, { removeStructuralElements: false });
      if (!cleanHtmlForGet) {
        return { ok: false, error: "No clean HTML content extracted." };
      }
      var formattedForGet = formatFormElementsForPromptForFlattenedContent(cleanHtmlForGet);
      var prefixedForGet = buildPrefixedPayloadForFlattenedContent(formattedForGet);
      return { ok: true, result: prefixedForGet };
    } catch (errForGet) {
      return { ok: false, error: errForGet && errForGet.message ? errForGet.message : "getPageContent failed." };
    }
  }

  contentNamespaceForFlattenedContent.registerActionHandler(
    actionsForFlattenedContent.copyFlattenedContent || "copyFlattenedContent",
    copyFlattenedContentForFlattenedContent
  );

  ensureContextMenuTrackingForFlattenedContent();

  contentNamespaceForFlattenedContent.tools = contentNamespaceForFlattenedContent.tools || {};
  contentNamespaceForFlattenedContent.tools.flattenedContent = {
    getFullPageContent: getFullPageContentForFlattenedContent,
    buildCleanHtml: buildCleanHtmlPayloadForFlattenedContent,
    buildRawHtml: buildRawHtmlPayloadForFlattenedContent
  };

  globalScopeForFlattenedContent.ABChatContent = contentNamespaceForFlattenedContent;
})();
