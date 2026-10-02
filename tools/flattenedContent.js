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
      // State is read from live properties (see stampLiveFormStateForFlattenedContent), never from
      // attributes, because a user's typed value / ticked box updates the property, not the attribute.
      const isCheckedForFlattenedContent = inputNodeForFlattenedContent.checked === true;
      const isDisabledForFlattenedContent = inputNodeForFlattenedContent.disabled === true;
      const rawValueForFlattenedContent =
        typeof inputNodeForFlattenedContent.value === "string" ? inputNodeForFlattenedContent.value : "";

      if (typeValueForFlattenedContent === "checkbox" || typeValueForFlattenedContent === "radio") {
        const replacementTagForFlattenedContent = typeValueForFlattenedContent === "checkbox" ? "checkbox" : "radio";
        const replacementNodeForFlattenedContent = document.createElement(replacementTagForFlattenedContent);
        if (nameValueForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
        } else if (placeholderValueForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
        }
        if (isCheckedForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("checked", "");
        }
        if (isDisabledForFlattenedContent) {
          replacementNodeForFlattenedContent.setAttribute("disabled", "");
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
      if (typeValueForFlattenedContent === "password") {
        // Never emit the password itself; mark only that the field holds a value.
        if (rawValueForFlattenedContent) {
          inputNodeForFlattenedContent.setAttribute("filled", "");
        }
      } else if (rawValueForFlattenedContent) {
        inputNodeForFlattenedContent.setAttribute("value", capFieldValueForFlattenedContent(rawValueForFlattenedContent));
      }
      if (isDisabledForFlattenedContent) {
        inputNodeForFlattenedContent.setAttribute("disabled", "");
      }
    });

    rootNodeForFlattenedContent.querySelectorAll("select").forEach((selectNodeForFlattenedContent) => {
      if (!selectNodeForFlattenedContent || !selectNodeForFlattenedContent.getAttribute || !selectNodeForFlattenedContent.setAttribute) {
        return;
      }
      const nameValueForFlattenedContent = selectNodeForFlattenedContent.getAttribute("name") || "";
      const placeholderValueForFlattenedContent = selectNodeForFlattenedContent.getAttribute("placeholder") || "";
      const isDisabledForFlattenedContent = selectNodeForFlattenedContent.disabled === true;
      // Remove non-option children (e.g. optgroup); keep option elements for their text content.
      Array.from(selectNodeForFlattenedContent.children).forEach((childForFlattenedContent) => {
        if (childForFlattenedContent.tagName && childForFlattenedContent.tagName.toLowerCase() !== "option") {
          childForFlattenedContent.remove();
        }
      });
      // Capture selectedness before stripping the select's own attributes (removing `multiple` can
      // change which options report as selected). The arrays stay index-aligned.
      const optionsForFlattenedContent = Array.from(selectNodeForFlattenedContent.querySelectorAll("option"));
      const selectedFlagsForFlattenedContent = optionsForFlattenedContent.map((optionForFlattenedContent) => optionForFlattenedContent.selected === true);
      while (selectNodeForFlattenedContent.attributes.length) {
        selectNodeForFlattenedContent.removeAttribute(selectNodeForFlattenedContent.attributes[0].name);
      }
      if (nameValueForFlattenedContent) {
        selectNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
      } else if (placeholderValueForFlattenedContent) {
        selectNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
      }
      if (isDisabledForFlattenedContent) {
        selectNodeForFlattenedContent.setAttribute("disabled", "");
      }
      optionsForFlattenedContent.forEach((optionForFlattenedContent, optionIndexForFlattenedContent) => {
        while (optionForFlattenedContent.attributes.length) {
          optionForFlattenedContent.removeAttribute(optionForFlattenedContent.attributes[0].name);
        }
        if (selectedFlagsForFlattenedContent[optionIndexForFlattenedContent]) {
          optionForFlattenedContent.setAttribute("selected", "");
        }
      });
    });

    rootNodeForFlattenedContent.querySelectorAll("textarea").forEach((textareaNodeForFlattenedContent) => {
      if (!textareaNodeForFlattenedContent || !textareaNodeForFlattenedContent.getAttribute || !textareaNodeForFlattenedContent.setAttribute) {
        return;
      }
      const nameValueForFlattenedContent = textareaNodeForFlattenedContent.getAttribute("name") || "";
      const placeholderValueForFlattenedContent = textareaNodeForFlattenedContent.getAttribute("placeholder") || "";
      const isDisabledForFlattenedContent = textareaNodeForFlattenedContent.disabled === true;
      const rawValueForFlattenedContent =
        typeof textareaNodeForFlattenedContent.value === "string" ? textareaNodeForFlattenedContent.value : "";
      textareaNodeForFlattenedContent.textContent = rawValueForFlattenedContent
        ? capFieldValueForFlattenedContent(rawValueForFlattenedContent)
        : "";
      while (textareaNodeForFlattenedContent.attributes.length) {
        textareaNodeForFlattenedContent.removeAttribute(textareaNodeForFlattenedContent.attributes[0].name);
      }
      if (nameValueForFlattenedContent) {
        textareaNodeForFlattenedContent.setAttribute("name", nameValueForFlattenedContent);
      } else if (placeholderValueForFlattenedContent) {
        textareaNodeForFlattenedContent.setAttribute("placeholder", placeholderValueForFlattenedContent);
      }
      if (isDisabledForFlattenedContent) {
        textareaNodeForFlattenedContent.setAttribute("disabled", "");
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
      if (copyNotesForFlattenedContent.has(nodeForFlattenedContent)) {
        return;
      }
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
      input: new Set(["name", "placeholder", "value", "disabled", "filled"]),
      select: new Set(["name", "placeholder", "disabled"]),
      textarea: new Set(["name", "placeholder", "disabled"]),
      checkbox: new Set(["name", "placeholder", "checked", "disabled"]),
      radio: new Set(["name", "placeholder", "checked", "disabled"]),
      option: new Set(["selected"]),
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
      // Image placeholders carry a generated tag name (img_jpg, img_png, ...), so they cannot be
      // keyed in the table above; without this they would lose the alt/src just set on them.
      const allowedAttributesForFlattenedContent = tagNameForFlattenedContent.startsWith("img_")
        ? new Set(["alt", "src", IMAGE_CANDIDATE_ATTR_FOR_FLATTENED_CONTENT])
        : allowedByTagForFlattenedContent[tagNameForFlattenedContent] || new Set();

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

  // An image whose alt text is descriptive is content, not decoration, so its src is kept on the
  // placeholder and the model can decide whether the image is worth showing in its reply. Icons,
  // spacers and logos have short, empty or filename-shaped alt text and keep the bare placeholder.
  //
  // Two tiers, because the alt bar does two jobs at once: it bounds cost, and it makes sure the
  // model can identify what it would be embedding. The second job largely takes care of itself on
  // small payloads, where the surrounding markup is all in view and disambiguates a thin alt, so a
  // lower bar is admitted there. Both tiers are capped in bytes; an unbounded tier is unbounded.
  const STRICT_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT = 15;
  const RELAXED_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT = 5;
  const RELAXED_IMAGE_TIER_GATE_CHARS_FOR_FLATTENED_CONTENT = 6000;
  const RELAXED_IMAGE_TIER_BUDGET_CHARS_FOR_FLATTENED_CONTENT = 1500;
  const STRICT_IMAGE_TIER_BUDGET_CHARS_FOR_FLATTENED_CONTENT = 8000;
  const MAX_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT = 200;
  const MAX_IMAGE_SRC_CHARS_FOR_FLATTENED_CONTENT = 200;
  // ' alt="" src=""' around the two values.
  const IMAGE_ATTR_OVERHEAD_CHARS_FOR_FLATTENED_CONTENT = 14;
  // Marks a placeholder as carrying a resolved alt/src pair while the rest of the pipeline runs.
  // Removed before the payload is measured, so it never reaches the output.
  const IMAGE_CANDIDATE_ATTR_FOR_FLATTENED_CONTENT = "data-abchat-img-candidate";

  // Upper bound on the length of a form-field value emitted into the flattened payload. A single
  // textarea can hold tens of KB; without a cap one field could dominate the whole context window.
  // Sync with: MAX_FIELD_VALUE_CHARS_FOR_TOOL_EXEC in agent/toolExec.js
  const MAX_FIELD_VALUE_CHARS_FOR_FLATTENED_CONTENT = 300;

  // Sync with: capFieldValueForFetch in agent/toolExec.js
  function capFieldValueForFlattenedContent(valueForFlattenedContent) {
    if (typeof valueForFlattenedContent !== "string") {
      return "";
    }
    if (valueForFlattenedContent.length <= MAX_FIELD_VALUE_CHARS_FOR_FLATTENED_CONTENT) {
      return valueForFlattenedContent;
    }
    return valueForFlattenedContent.slice(0, MAX_FIELD_VALUE_CHARS_FOR_FLATTENED_CONTENT) + "…";
  }

  // Sync with: getDescriptiveImageAltForFetch in agent/toolExec.js
  function getDescriptiveImageAltForFlattenedContent(imgElementForFlattenedContent) {
    const rawAltForFlattenedContent =
      imgElementForFlattenedContent && imgElementForFlattenedContent.getAttribute
        ? imgElementForFlattenedContent.getAttribute("alt") || ""
        : "";
    // Angle brackets are not escaped inside serialized attribute values, so they would break the
    // self-closing collapse below and leak a stray closing tag into the output.
    const normalizedAltForFlattenedContent = rawAltForFlattenedContent
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // The relaxed floor gates candidacy; which tier a candidate lands in is decided later, once the
    // payload size is known. An empty or near-empty alt never qualifies at any size: an image the
    // model cannot identify is exactly the one it should not be embedding.
    if (normalizedAltForFlattenedContent.length < RELAXED_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT) {
      return "";
    }
    if (/^\S+\.(?:jpe?g|png|gif|webp|svg|avif|bmp|ico)$/i.test(normalizedAltForFlattenedContent)) {
      return "";
    }
    return normalizedAltForFlattenedContent.slice(0, MAX_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT);
  }

  // Sync with: getFirstSrcsetCandidateForFetch in agent/toolExec.js
  function getFirstSrcsetCandidateForFlattenedContent(srcsetValueForFlattenedContent) {
    if (!srcsetValueForFlattenedContent || typeof srcsetValueForFlattenedContent !== "string") {
      return "";
    }
    // Split on ", " rather than "," so commas inside a URL (Cloudinary-style transforms) survive,
    // then take the URL token ahead of the width/density descriptor.
    const firstCandidateForFlattenedContent = srcsetValueForFlattenedContent.split(/,\s+/)[0] || "";
    return (firstCandidateForFlattenedContent.trim().split(/\s+/)[0] || "").trim();
  }

  // Sync with: getEmbeddableImageSrcForFetch in agent/toolExec.js
  function getEmbeddableImageSrcForFlattenedContent(imgElementForFlattenedContent) {
    if (!imgElementForFlattenedContent || !imgElementForFlattenedContent.getAttribute) {
      return "";
    }
    let rawSrcForFlattenedContent = (imgElementForFlattenedContent.getAttribute("src") || "").trim();
    // Lazy loaders park a blur/spacer data URI in src and put the real image in srcset.
    if (!rawSrcForFlattenedContent || rawSrcForFlattenedContent.startsWith("data:")) {
      rawSrcForFlattenedContent = getFirstSrcsetCandidateForFlattenedContent(
        imgElementForFlattenedContent.getAttribute("srcset")
      );
    }
    if (!rawSrcForFlattenedContent) {
      return "";
    }
    // Unlike anchors, which are deliberately relativized for same-origin links, an image URL is
    // only useful to the model if it is absolute: it may end up in a reply rendered elsewhere.
    let parsedSrcForFlattenedContent;
    try {
      parsedSrcForFlattenedContent = new URL(rawSrcForFlattenedContent, document.baseURI);
    } catch (errForFlattenedContent) {
      return "";
    }
    if (parsedSrcForFlattenedContent.protocol !== "http:" && parsedSrcForFlattenedContent.protocol !== "https:") {
      return "";
    }
    // Long URLs are almost always signed or tracking-laden; skipping them caps the per-image cost
    // and keeps most credential-bearing URLs out of the prompt.
    if (parsedSrcForFlattenedContent.href.length > MAX_IMAGE_SRC_CHARS_FOR_FLATTENED_CONTENT) {
      return "";
    }
    return parsedSrcForFlattenedContent.href;
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

  // Returns a Map of placeholder element to its resolved { alt, src }. Nothing is stamped here: the
  // tier a candidate qualifies for depends on the size of the finished payload, which is not known
  // until the rest of the pipeline has run.
  // Sync with: replaceImagesForFetch in agent/toolExec.js
  function replaceImagesWithPlaceholderForFlattenedContent(rootNodeForFlattenedContent) {
    const candidatesForFlattenedContent = new Map();
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll || !document || !document.createElement) {
      return candidatesForFlattenedContent;
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
      // alt and src travel together: the src is only actionable when the alt says what it depicts.
      const altForFlattenedContent = getDescriptiveImageAltForFlattenedContent(imageForFlattenedContent);
      if (altForFlattenedContent) {
        const srcForFlattenedContent = getEmbeddableImageSrcForFlattenedContent(imageForFlattenedContent);
        if (srcForFlattenedContent) {
          placeholderForFlattenedContent.setAttribute(IMAGE_CANDIDATE_ATTR_FOR_FLATTENED_CONTENT, "");
          candidatesForFlattenedContent.set(placeholderForFlattenedContent, {
            alt: altForFlattenedContent,
            src: srcForFlattenedContent
          });
        }
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
    return candidatesForFlattenedContent;
  }

  // Stamps alt/src onto the surviving image placeholders, strict tier first, each tier bounded by
  // its own byte budget. Order comes from the finished tree rather than from insertion order,
  // because flattenNestedWrappers moves nodes when it unwraps a parent. Selection is deterministic
  // for a given payload, which matters: the live-window collapse in contextBuilder only skips a
  // repeated tool result when it is byte-identical to the previous one.
  // Attribute values are entity-escaped on serialization, and image URLs are full of query-string
  // ampersands, each of which serializes to five characters. Charging the raw length would let a
  // tier overshoot its budget by thousands of characters on a URL-heavy page.
  // Sync with: getSerializedAttrValueLengthForFetch in agent/toolExec.js
  function getSerializedAttrValueLengthForFlattenedContent(valueForFlattenedContent) {
    return valueForFlattenedContent.replace(/&/g, "&amp;").replace(/"/g, "&quot;").length;
  }

  // Sync with: applyImagePlaceholderAttributesForFetch in agent/toolExec.js
  function applyImagePlaceholderAttributesForFlattenedContent(
    clonedRootForFlattenedContent,
    candidatesForFlattenedContent,
    isFragmentRootForFlattenedContent
  ) {
    if (!clonedRootForFlattenedContent || !clonedRootForFlattenedContent.querySelectorAll) {
      return;
    }
    const survivorsForFlattenedContent = Array.from(
      clonedRootForFlattenedContent.querySelectorAll("[" + IMAGE_CANDIDATE_ATTR_FOR_FLATTENED_CONTENT + "]")
    );
    survivorsForFlattenedContent.forEach((elementForFlattenedContent) => {
      elementForFlattenedContent.removeAttribute(IMAGE_CANDIDATE_ATTR_FOR_FLATTENED_CONTENT);
    });
    if (!survivorsForFlattenedContent.length) {
      return;
    }

    const baseLengthForFlattenedContent = serializeCleanRootForFlattenedContent(
      clonedRootForFlattenedContent,
      isFragmentRootForFlattenedContent
    ).length;
    const isRelaxedTierOpenForFlattenedContent =
      baseLengthForFlattenedContent <= RELAXED_IMAGE_TIER_GATE_CHARS_FOR_FLATTENED_CONTENT;

    let strictSpentForFlattenedContent = 0;
    let relaxedSpentForFlattenedContent = 0;
    survivorsForFlattenedContent.forEach((elementForFlattenedContent) => {
      const candidateForFlattenedContent = candidatesForFlattenedContent.get(elementForFlattenedContent);
      if (!candidateForFlattenedContent) {
        return;
      }
      const costForFlattenedContent =
        getSerializedAttrValueLengthForFlattenedContent(candidateForFlattenedContent.alt) +
        getSerializedAttrValueLengthForFlattenedContent(candidateForFlattenedContent.src) +
        IMAGE_ATTR_OVERHEAD_CHARS_FOR_FLATTENED_CONTENT;
      const isStrictTierForFlattenedContent =
        candidateForFlattenedContent.alt.length >= STRICT_IMAGE_ALT_CHARS_FOR_FLATTENED_CONTENT;

      if (isStrictTierForFlattenedContent) {
        if (strictSpentForFlattenedContent + costForFlattenedContent > STRICT_IMAGE_TIER_BUDGET_CHARS_FOR_FLATTENED_CONTENT) {
          return;
        }
        strictSpentForFlattenedContent += costForFlattenedContent;
      } else {
        if (!isRelaxedTierOpenForFlattenedContent) {
          return;
        }
        if (relaxedSpentForFlattenedContent + costForFlattenedContent > RELAXED_IMAGE_TIER_BUDGET_CHARS_FOR_FLATTENED_CONTENT) {
          return;
        }
        relaxedSpentForFlattenedContent += costForFlattenedContent;
      }

      elementForFlattenedContent.setAttribute("alt", candidateForFlattenedContent.alt);
      elementForFlattenedContent.setAttribute("src", candidateForFlattenedContent.src);
    });
  }

  // The single definition of the finished payload string, used both to measure the payload before
  // image attributes are stamped and to produce the returned result.
  // Sync with: serializeCleanRootForFetch in agent/toolExec.js
  function serializeCleanRootForFlattenedContent(rootElementForFlattenedContent, isFragmentRootForFlattenedContent) {
    const rawHtmlForFlattenedContent = isFragmentRootForFlattenedContent
      ? rootElementForFlattenedContent.innerHTML
      : rootElementForFlattenedContent.outerHTML;
    if (!rawHtmlForFlattenedContent || typeof rawHtmlForFlattenedContent !== "string") {
      return "";
    }
    const collapsedHtmlForFlattenedContent = rawHtmlForFlattenedContent.replace(
      /<(img_[a-z0-9]+)((?:\s[^>]*)?)><\/\1>/gi,
      "<$1$2>"
    );
    return collapseWhitespaceOutsidePreForFlattenedContent(
      stripInvisibleCharsForFlattenedContent(collapsedHtmlForFlattenedContent)
    );
  }

  // Line breaks and indentation inside <pre> are part of the content (Python and YAML change
  // meaning without them), so whitespace is collapsed only between <pre> blocks.
  // Sync with: collapseWhitespaceOutsidePreForFetch in agent/toolExec.js
  function collapseWhitespaceOutsidePreForFlattenedContent(htmlForCollapse) {
    return htmlForCollapse
      .split(/(<pre(?:\s[^>]*)?>[\s\S]*?<\/pre>)/i)
      .map((partForCollapse, indexForCollapse) =>
        indexForCollapse % 2 ? partForCollapse : partForCollapse.replace(/\s+/g, " ")
      )
      .join("")
      .trim();
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

  // Collects a node's text with a space at every element boundary, into pieces split at the
  // "items omitted" notes (comment nodes) inside it.
  // Sync with: collectCutPiecesForFetch in agent/toolExec.js
  function collectCutPiecesForFlattenedContent(nodeForPieces, piecesForCut) {
    for (let kidForPieces = nodeForPieces.firstChild; kidForPieces; kidForPieces = kidForPieces.nextSibling) {
      if (kidForPieces.nodeType === Node.TEXT_NODE) {
        piecesForCut[piecesForCut.length - 1] += kidForPieces.nodeValue || "";
      } else if (kidForPieces.nodeType === Node.COMMENT_NODE) {
        piecesForCut.push(kidForPieces, "");
      } else if (kidForPieces.nodeType === Node.ELEMENT_NODE) {
        piecesForCut[piecesForCut.length - 1] += " ";
        collectCutPiecesForFlattenedContent(kidForPieces, piecesForCut);
        piecesForCut[piecesForCut.length - 1] += " ";
      }
    }
  }

  // Replaces a child's markup with its text and returns how many characters of text it kept. A
  // list inside it that was already shortened keeps its "items omitted" note where the items were,
  // so the text does not read as the whole list. A child with no text is removed.
  // Sync with: cutToTextForFetch in agent/toolExec.js
  function cutToTextForFlattenedContent(childForCut) {
    const piecesForCut = [""];
    collectCutPiecesForFlattenedContent(childForCut, piecesForCut);
    const lastIndexForCut = piecesForCut.length - 1;
    let charsForCut = 0;
    piecesForCut.forEach((pieceForCut, indexForCut) => {
      if (typeof pieceForCut !== "string") {
        return;
      }
      let textForPiece = stripInvisibleCharsForFlattenedContent(pieceForCut).replace(/\s+/g, " ");
      if (indexForCut === 0) textForPiece = textForPiece.trimStart();
      if (indexForCut === lastIndexForCut) textForPiece = textForPiece.trimEnd();
      piecesForCut[indexForCut] = textForPiece;
      charsForCut += textForPiece.trim().length;
    });
    if (!charsForCut) {
      childForCut.remove();
      return 0;
    }
    childForCut.textContent = "";
    piecesForCut.forEach((pieceForCut) => {
      if (typeof pieceForCut !== "string") {
        childForCut.appendChild(pieceForCut);
      } else if (pieceForCut) {
        childForCut.appendChild(childForCut.ownerDocument.createTextNode(pieceForCut));
      }
    });
    return charsForCut;
  }

  // Sync with: omittedCountFromNoteForFetch in agent/toolExec.js
  function omittedCountFromNoteForFlattenedContent(noteForCount) {
    const matchForCount = /^ (\d+) items? omitted $/.exec(noteForCount.nodeValue || "");
    return matchForCount ? Number(matchForCount[1]) : 0;
  }

  // A code block's text, with <br> read as a line break and hidden parts and buttons left out.
  // Sync with: collectPreTextForFetch in agent/toolExec.js
  function collectPreTextForFlattenedContent(nodeForPreText) {
    let outForPreText = "";
    const kidsForPreText = nodeForPreText.childNodes;
    for (let iForPreText = 0; iForPreText < kidsForPreText.length; iForPreText++) {
      const kidForPreText = kidsForPreText[iForPreText];
      if (kidForPreText.nodeType === Node.TEXT_NODE) {
        outForPreText += kidForPreText.nodeValue || "";
      } else if (kidForPreText.nodeType === Node.ELEMENT_NODE && !kidForPreText.hasAttribute("hidden")) {
        const tagForPreText = kidForPreText.tagName.toLowerCase();
        if (tagForPreText === "br") {
          outForPreText += "\n";
        } else if (tagForPreText !== "button") {
          outForPreText += collectPreTextForFlattenedContent(kidForPreText);
        }
      }
    }
    return outForPreText;
  }

  // Reduces every <pre> to its plain text, inside one <code> when it had one. Highlighters wrap
  // each token in an element, and some (Chroma, used by Hugo sites) also wrap each line break and
  // run of spaces in one, which the empty-tag pass would delete along with the code's layout.
  // Sync with: flattenPreBlocksForFetch in agent/toolExec.js
  function flattenPreBlocksForFlattenedContent(rootNodeForPre) {
    if (!rootNodeForPre || !rootNodeForPre.querySelectorAll) {
      return;
    }
    const presForFlatten = Array.from(rootNodeForPre.querySelectorAll("pre"));
    if (rootNodeForPre.tagName && rootNodeForPre.tagName.toLowerCase() === "pre") {
      presForFlatten.unshift(rootNodeForPre);
    }
    presForFlatten.forEach((preForFlatten) => {
      const textForPre = collectPreTextForFlattenedContent(preForFlatten);
      const codeForPre = preForFlatten.querySelector("code");
      preForFlatten.textContent = "";
      if (codeForPre) {
        codeForPre.textContent = textForPre;
        preForFlatten.appendChild(codeForPre);
      } else {
        preForFlatten.textContent = textForPre;
      }
    });
  }

  // A child's tag followed by its own children's tags in order. Siblings that share a key are
  // copies of one item (table rows, feed cards).
  // Sync with: repeatKeyForFetch in agent/toolExec.js
  function repeatKeyForFlattenedContent(elementForKey) {
    let keyForFlattenedContent = elementForKey.tagName + "|";
    const kidsForKey = elementForKey.children;
    for (let iForKey = 0; iForKey < kidsForKey.length; iForKey++) {
      keyForFlattenedContent += kidsForKey[iForKey].tagName + ",";
    }
    return keyForFlattenedContent;
  }

  // Shortens every parent with more than 50 children. The first 45 and the last 5 stay whole, and
  // so do paragraphs and headings anywhere. A child in between is cut to its text only when at
  // least 30 of the parent's children share its key, which makes it one of a run of rows or cards.
  // Any other child (a table, list or quote among paragraphs) stays whole, and so does a child
  // holding a <pre>, whose whitespace would be lost as text. Cut text and whole children draw on
  // one budget, and the children after it runs out are dropped behind an "N items omitted" comment.
  // Sync with: truncateOverloadedChildrenForFetch in agent/toolExec.js
  const MIDDLE_TEXT_BUDGET_FOR_FLATTENED_CONTENT = 20000;
  const MIN_REPEATS_TO_SHORTEN_FOR_FLATTENED_CONTENT = 30;
  function truncateOverloadedChildrenForFlattenedContent(rootNodeForFlattenedContent) {
    if (!rootNodeForFlattenedContent || !rootNodeForFlattenedContent.querySelectorAll || !document || !document.createComment) {
      return;
    }

    // Deepest first, root last, so a long list inside a middle child is already shortened by the
    // time that child is measured or cut to text.
    const elementsForFlattenedContent = Array.from(rootNodeForFlattenedContent.querySelectorAll("*")).reverse();
    elementsForFlattenedContent.push(rootNodeForFlattenedContent);

    elementsForFlattenedContent.forEach((elForFlattenedContent) => {
      if (!elForFlattenedContent || !elForFlattenedContent.children) {
        return;
      }

      const childrenForFlattenedContent = Array.from(elForFlattenedContent.children);
      if (childrenForFlattenedContent.length <= 50) {
        return;
      }

      const keysForFlattenedContent = childrenForFlattenedContent.map(repeatKeyForFlattenedContent);
      const keyCountsForFlattenedContent = new Map();
      keysForFlattenedContent.forEach((keyForCount) => {
        keyCountsForFlattenedContent.set(keyForCount, (keyCountsForFlattenedContent.get(keyForCount) || 0) + 1);
      });

      let budgetUsedForFlattenedContent = 0;
      const omittedForFlattenedContent = [];

      for (
        let indexForMiddle = 45;
        indexForMiddle < childrenForFlattenedContent.length - 5;
        indexForMiddle++
      ) {
        const childForFlattenedContent = childrenForFlattenedContent[indexForMiddle];
        if (isProtectedChildForFlattenedContent(childForFlattenedContent)) {
          continue;
        }
        if (budgetUsedForFlattenedContent >= MIDDLE_TEXT_BUDGET_FOR_FLATTENED_CONTENT) {
          omittedForFlattenedContent.push(childForFlattenedContent);
          continue;
        }
        const isRepeatForFlattenedContent =
          keyCountsForFlattenedContent.get(keysForFlattenedContent[indexForMiddle]) >=
            MIN_REPEATS_TO_SHORTEN_FOR_FLATTENED_CONTENT &&
          childForFlattenedContent.tagName.toLowerCase() !== "pre" &&
          !childForFlattenedContent.querySelector("pre");
        if (!isRepeatForFlattenedContent) {
          budgetUsedForFlattenedContent += childForFlattenedContent.outerHTML.replace(/\s+/g, " ").length;
          continue;
        }
        budgetUsedForFlattenedContent += cutToTextForFlattenedContent(childForFlattenedContent);
      }

      if (omittedForFlattenedContent.length) {
        // A note left by the copy for the children it skipped joins this one, so the list has one
        // count. Page comments are gone by now, so every comment here is such a note.
        let omittedCountForFlattenedContent = omittedForFlattenedContent.length;
        Array.from(elForFlattenedContent.childNodes).forEach((nodeForNote) => {
          if (nodeForNote.nodeType === Node.COMMENT_NODE) {
            omittedCountForFlattenedContent += omittedCountFromNoteForFlattenedContent(nodeForNote);
            nodeForNote.remove();
          }
        });
        const markerForFlattenedContent = document.createComment(
          " " + omittedCountForFlattenedContent + " item" + (omittedCountForFlattenedContent !== 1 ? "s" : "") + " omitted "
        );
        elForFlattenedContent.insertBefore(markerForFlattenedContent, omittedForFlattenedContent[0]);
        omittedForFlattenedContent.forEach((childForFlattenedContent) => {
          childForFlattenedContent.remove();
        });
      }
    });
  }

  // Copying a page and only then cutting its long runs spends nearly all the time on elements
  // that are thrown away: on a package index of 900,000 links, 10 of 11 seconds. So the copy
  // already leaves most of a long run out. Under a parent with more than 50 children it copies
  // the first 45, the last 10 and every paragraph and heading, and the other children in between
  // only until their text passes four times the cut's budget or 20,000 of them are copied. That
  // margin leaves the cut room to make the same choices as before, with one difference: a kind of
  // child too rare among the copied part to count as a repeat is kept whole instead of cut to
  // text. Text is counted without script, style and SVG text, which never reaches the result, and
  // without the whitespace around it.
  // Sync with: pruneLongRunsForFetch in agent/toolExec.js
  const COPY_TEXT_LIMIT_FOR_FLATTENED_CONTENT = 4 * MIDDLE_TEXT_BUDGET_FOR_FLATTENED_CONTENT;
  const COPY_MIDDLE_LIMIT_FOR_FLATTENED_CONTENT = 20000;
  // Children the pipeline removes before the cut, so they do not count as positions in a run.
  const COPY_UNCOUNTED_TAGS_FOR_FLATTENED_CONTENT = {
    script: true, style: true, noscript: true, meta: true, link: true, canvas: true, slot: true
  };
  // The children the cut always keeps whole (see isProtectedChildForFlattenedContent), by local
  // name, because the plan checks every child of a long run.
  const COPY_ALWAYS_KEPT_TAGS_FOR_FLATTENED_CONTENT = {
    p: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true
  };
  const COPY_TEXTLESS_TAGS_FOR_FLATTENED_CONTENT = {
    script: true, style: true, noscript: true, template: true, svg: true, canvas: true
  };
  // Notes the copy leaves for skipped children. The comment pass removes every other comment.
  const copyNotesForFlattenedContent = new WeakSet();

  function liveTextLengthForFlattenedContent(nodeForText, limitForText) {
    let totalForText = 0;
    const stackForText = [nodeForText];
    while (stackForText.length && totalForText < limitForText) {
      const currentForText = stackForText.pop();
      for (let kidForText = currentForText.firstChild; kidForText; kidForText = kidForText.nextSibling) {
        if (kidForText.nodeType === Node.TEXT_NODE) {
          totalForText += (kidForText.nodeValue || "").trim().length;
        } else if (
          kidForText.nodeType === Node.ELEMENT_NODE &&
          !COPY_TEXTLESS_TAGS_FOR_FLATTENED_CONTENT[kidForText.localName]
        ) {
          stackForText.push(kidForText);
        }
      }
    }
    return totalForText;
  }

  // Plans which children of one live parent the copy leaves out, or returns null when it copies
  // them all. The children from firstSkipped up to resumeAt (the first of the last 10) are left
  // out, except the paragraphs and headings among them, which are in keptInRange; skippedCount
  // counts the rest for the note. A parent with a shadow root is copied whole, because its shadow
  // children join its light ones in the copy.
  function planChildrenCopyForFlattenedContent(parentForPlan) {
    if (parentForPlan.childElementCount <= 50 || parentForPlan.shadowRoot) {
      return null;
    }
    let resumeAtForPlan = null;
    let tailCountedForPlan = 0;
    for (
      let kidForPlan = parentForPlan.lastElementChild;
      kidForPlan && tailCountedForPlan < 10;
      kidForPlan = kidForPlan.previousElementSibling
    ) {
      if (!COPY_UNCOUNTED_TAGS_FOR_FLATTENED_CONTENT[kidForPlan.localName]) {
        tailCountedForPlan += 1;
        resumeAtForPlan = kidForPlan;
      }
    }
    let countedForPlan = 0;
    let textUsedForPlan = 0;
    let copiedForPlan = 0;
    let isFullForPlan = false;
    let firstSkippedForPlan = null;
    let skippedCountForPlan = 0;
    const keptInRangeForPlan = new Set();
    for (
      let kidForPlan = parentForPlan.firstElementChild;
      kidForPlan && kidForPlan !== resumeAtForPlan;
      kidForPlan = kidForPlan.nextElementSibling
    ) {
      if (COPY_UNCOUNTED_TAGS_FOR_FLATTENED_CONTENT[kidForPlan.localName]) {
        continue;
      }
      countedForPlan += 1;
      if (countedForPlan <= 45) {
        continue;
      }
      if (COPY_ALWAYS_KEPT_TAGS_FOR_FLATTENED_CONTENT[kidForPlan.localName]) {
        if (firstSkippedForPlan) keptInRangeForPlan.add(kidForPlan);
        continue;
      }
      if (isFullForPlan) {
        if (!firstSkippedForPlan) firstSkippedForPlan = kidForPlan;
        skippedCountForPlan += 1;
        continue;
      }
      textUsedForPlan += liveTextLengthForFlattenedContent(kidForPlan, COPY_TEXT_LIMIT_FOR_FLATTENED_CONTENT - textUsedForPlan);
      copiedForPlan += 1;
      isFullForPlan =
        textUsedForPlan >= COPY_TEXT_LIMIT_FOR_FLATTENED_CONTENT ||
        copiedForPlan >= COPY_MIDDLE_LIMIT_FOR_FLATTENED_CONTENT;
    }
    // The cut leaves a parent of 50 children or fewer alone, so the copy does too.
    if (!firstSkippedForPlan || countedForPlan + tailCountedForPlan <= 50) {
      return null;
    }
    return {
      firstSkipped: firstSkippedForPlan,
      resumeAt: resumeAtForPlan,
      keptInRange: keptInRangeForPlan,
      skippedCount: skippedCountForPlan
    };
  }

  // Visits every element the copy will take, including inside open shadow roots other than the
  // panel's. Given a Map, it plans each parent's children into it before visiting them and passes
  // over the ones left out; without one it visits everything.
  function walkCopiedElementsForFlattenedContent(rootNodeForWalk, plansForWalk, visitForWalk) {
    const stackForWalk = [rootNodeForWalk];
    while (stackForWalk.length) {
      const nodeForWalk = stackForWalk.pop();
      let planForWalk = null;
      if (nodeForWalk.nodeType === Node.ELEMENT_NODE) {
        visitForWalk(nodeForWalk);
        if (plansForWalk) {
          planForWalk = planChildrenCopyForFlattenedContent(nodeForWalk);
          if (planForWalk) plansForWalk.set(nodeForWalk, planForWalk);
        }
        if (nodeForWalk.shadowRoot && nodeForWalk.id !== "abchat-panel-shadow-host") {
          stackForWalk.push(nodeForWalk.shadowRoot);
        }
      }
      // A planned parent's children: up to the first one left out, the paragraphs and headings
      // among the ones left out, then from the tail on, without stepping through the rest.
      let kidForWalk = nodeForWalk.firstElementChild;
      if (planForWalk) {
        for (; kidForWalk !== planForWalk.firstSkipped; kidForWalk = kidForWalk.nextElementSibling) {
          stackForWalk.push(kidForWalk);
        }
        planForWalk.keptInRange.forEach((keptForWalk) => stackForWalk.push(keptForWalk));
        kidForWalk = planForWalk.resumeAt;
      }
      for (; kidForWalk; kidForWalk = kidForWalk.nextElementSibling) {
        stackForWalk.push(kidForWalk);
      }
    }
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
  // With plansForCopy, it also plans which children the copy leaves out (see
  // planChildrenCopyForFlattenedContent) and does not check those.
  function markHiddenElementsForFlattenedContent(rootNodeForFlattenedContent, plansForCopy) {
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
    walkCopiedElementsForFlattenedContent(rootNodeForFlattenedContent, plansForCopy || null, (nodeForFlattenedContent) => {
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

  // Copies live form-field state (typed values, ticked boxes, chosen options, disabled) from a live
  // node onto its clone as ATTRIBUTES. A plain attribute clone loses this: the browser tracks a
  // user's input in DOM properties (.value/.checked/.selected), not in the reflected attributes.
  // Writing attributes (rather than properties) is deliberate: attributes survive the clone being
  // re-appended into its parent, whereas a detached option's .selected can be reset on insertion.
  // The real password is never copied; only a sentinel that records "this field has a value".
  function stampLiveFormStateForFlattenedContent(liveNodeForFlattenedContent, clonedNodeForFlattenedContent) {
    if (!liveNodeForFlattenedContent || !clonedNodeForFlattenedContent || !clonedNodeForFlattenedContent.setAttribute) {
      return;
    }
    const tagForStampForFlattenedContent = (liveNodeForFlattenedContent.tagName || "").toLowerCase();
    try {
      if (tagForStampForFlattenedContent === "input") {
        const typeForStampForFlattenedContent = (liveNodeForFlattenedContent.type || "").toLowerCase();
        if (typeForStampForFlattenedContent === "checkbox" || typeForStampForFlattenedContent === "radio") {
          if (liveNodeForFlattenedContent.checked) {
            clonedNodeForFlattenedContent.setAttribute("checked", "");
          } else {
            clonedNodeForFlattenedContent.removeAttribute("checked");
          }
        } else {
          const valueForStampForFlattenedContent =
            typeof liveNodeForFlattenedContent.value === "string" ? liveNodeForFlattenedContent.value : "";
          if (typeForStampForFlattenedContent === "password") {
            if (valueForStampForFlattenedContent) {
              clonedNodeForFlattenedContent.setAttribute("value", "x");
            } else {
              clonedNodeForFlattenedContent.removeAttribute("value");
            }
          } else if (valueForStampForFlattenedContent) {
            clonedNodeForFlattenedContent.setAttribute("value", valueForStampForFlattenedContent);
          } else {
            clonedNodeForFlattenedContent.removeAttribute("value");
          }
        }
        if (liveNodeForFlattenedContent.disabled) {
          clonedNodeForFlattenedContent.setAttribute("disabled", "");
        } else {
          clonedNodeForFlattenedContent.removeAttribute("disabled");
        }
      } else if (tagForStampForFlattenedContent === "textarea") {
        clonedNodeForFlattenedContent.textContent =
          typeof liveNodeForFlattenedContent.value === "string" ? liveNodeForFlattenedContent.value : "";
        if (liveNodeForFlattenedContent.disabled) {
          clonedNodeForFlattenedContent.setAttribute("disabled", "");
        } else {
          clonedNodeForFlattenedContent.removeAttribute("disabled");
        }
      } else if (tagForStampForFlattenedContent === "select") {
        if (liveNodeForFlattenedContent.disabled) {
          clonedNodeForFlattenedContent.setAttribute("disabled", "");
        } else {
          clonedNodeForFlattenedContent.removeAttribute("disabled");
        }
      } else if (tagForStampForFlattenedContent === "option") {
        if (liveNodeForFlattenedContent.selected) {
          clonedNodeForFlattenedContent.setAttribute("selected", "");
        } else {
          clonedNodeForFlattenedContent.removeAttribute("selected");
        }
      }
    } catch (errForStampForFlattenedContent) {}
  }

  // plansForCopy, when given, maps a parent to the children planned out of the copy. They become
  // one "items omitted" note where the first of them was, and the whitespace after each of them
  // goes with it. Text with words in it stays, as it would without the plan.
  function cloneNodeWithShadowsForFlattenedContent(liveNodeForFlattenedContent, stampFormStateForFlattenedContent, plansForCopy) {
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
    if (stampFormStateForFlattenedContent) {
      stampLiveFormStateForFlattenedContent(liveNodeForFlattenedContent, clonedElForFlattenedContent);
    }
    const planForCopy = plansForCopy ? plansForCopy.get(liveNodeForFlattenedContent) : null;
    let isSkippingForCopy = false;
    let isAfterSkippedForCopy = false;
    for (
      let childForFlattenedContent = liveNodeForFlattenedContent.firstChild;
      childForFlattenedContent;
      childForFlattenedContent = childForFlattenedContent.nextSibling
    ) {
      if (planForCopy) {
        if (childForFlattenedContent === planForCopy.firstSkipped) {
          isSkippingForCopy = true;
          const noteForCopy = document.createComment(
            " " + planForCopy.skippedCount + " item" + (planForCopy.skippedCount !== 1 ? "s" : "") + " omitted "
          );
          copyNotesForFlattenedContent.add(noteForCopy);
          clonedElForFlattenedContent.appendChild(noteForCopy);
        } else if (childForFlattenedContent === planForCopy.resumeAt) {
          isSkippingForCopy = false;
        }
        if (childForFlattenedContent.nodeType === Node.ELEMENT_NODE) {
          isAfterSkippedForCopy = isSkippingForCopy && !planForCopy.keptInRange.has(childForFlattenedContent);
          if (isAfterSkippedForCopy) continue;
        } else if (
          isAfterSkippedForCopy &&
          childForFlattenedContent.nodeType === Node.TEXT_NODE &&
          !/\S/.test(childForFlattenedContent.nodeValue || "")
        ) {
          continue;
        }
      }
      const clonedChildForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(childForFlattenedContent, stampFormStateForFlattenedContent, plansForCopy);
      if (clonedChildForFlattenedContent) {
        try {
          clonedElForFlattenedContent.appendChild(clonedChildForFlattenedContent);
        } catch (errForAppendChild) {}
      }
    }
    if (liveNodeForFlattenedContent.shadowRoot && liveNodeForFlattenedContent.id !== "abchat-panel-shadow-host") {
      Array.from(liveNodeForFlattenedContent.shadowRoot.childNodes || []).forEach(function (shadowChildForFlattenedContent) {
        const clonedShadowChildForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(shadowChildForFlattenedContent, stampFormStateForFlattenedContent, plansForCopy);
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

  // Tags whose text never survives into either payload: both noise passes strip
  // script/style/noscript, and slot elements are skipped by the clone because their assigned
  // content is already counted through the host's light DOM children.
  const nonPayloadTextTagsForFlattenedContent = {
    script: true,
    style: true,
    noscript: true,
    slot: true
  };

  function collectPayloadTextForFlattenedContent(nodeForPayloadText, chunksForPayloadText) {
    if (!nodeForPayloadText) {
      return;
    }
    if (nodeForPayloadText.nodeType === Node.TEXT_NODE) {
      chunksForPayloadText.push(nodeForPayloadText.nodeValue || "");
      return;
    }
    if (nodeForPayloadText.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const tagForPayloadText = (nodeForPayloadText.tagName || "").toLowerCase();
    if (nonPayloadTextTagsForFlattenedContent[tagForPayloadText]) {
      return;
    }
    if (nodeForPayloadText.id === "abchat-panel-shadow-host") {
      return;
    }
    // Element boundaries separate words, so two adjacent blocks never merge into one token.
    chunksForPayloadText.push(" ");
    const kidsForPayloadText = nodeForPayloadText.childNodes || [];
    for (let iForPayloadText = 0; iForPayloadText < kidsForPayloadText.length; iForPayloadText++) {
      collectPayloadTextForFlattenedContent(kidsForPayloadText[iForPayloadText], chunksForPayloadText);
    }
    if (nodeForPayloadText.shadowRoot) {
      const shadowKidsForPayloadText = nodeForPayloadText.shadowRoot.childNodes || [];
      for (let sForPayloadText = 0; sForPayloadText < shadowKidsForPayloadText.length; sForPayloadText++) {
        collectPayloadTextForFlattenedContent(shadowKidsForPayloadText[sForPayloadText], chunksForPayloadText);
      }
    }
    chunksForPayloadText.push(" ");
  }

  // Counts the words a capture of this node would actually carry, which is a different
  // question from what innerText answers. Hidden subtrees count because "marked" mode keeps
  // them in the payload, and open shadow roots count because the clone inlines them; both are
  // invisible to innerText. Anything the pipelines strip is left out.
  function countPayloadWordsForNodeForFlattenedContent(nodeForCount) {
    if (!nodeForCount) {
      return 0;
    }
    const chunksForCount = [];
    collectPayloadTextForFlattenedContent(nodeForCount, chunksForCount);
    const textForCount = stripInvisibleCharsForFlattenedContent(chunksForCount.join(""));
    const matchesForCount = textForCount.match(/\S+/g);
    return matchesForCount ? matchesForCount.length : 0;
  }

  // Same count taken from an already-built payload string. Returns null when the string could
  // not be parsed, so a caller can tell "no text" apart from "could not measure".
  function countPayloadWordsForHtmlForFlattenedContent(htmlStringForCount) {
    const sourceForCount = String(htmlStringForCount || "");
    if (!sourceForCount.trim()) {
      return 0;
    }
    if (typeof DOMParser === "undefined") {
      return null;
    }
    try {
      // A DOMParser document has no browsing context, so nothing here loads or executes.
      const parsedForCount = new DOMParser().parseFromString(sourceForCount, "text/html");
      if (!parsedForCount || !parsedForCount.body) {
        return null;
      }
      return countPayloadWordsForNodeForFlattenedContent(parsedForCount.body);
    } catch (errForCount) {
      return null;
    }
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

    return collapseWhitespaceOutsidePreForFlattenedContent(stripInvisibleCharsForFlattenedContent(rawHtmlForRaw));
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

    const willCutForFlattenedContent = !optionsForFlattenedContent || !optionsForFlattenedContent.skipTruncate;
    const plansForCopy = willCutForFlattenedContent ? new Map() : null;
    const shouldTrackHiddenForFlattenedContent = hiddenElementModeForFlattenedContent !== "unmarked";
    const markedHiddenForFlattenedContent = shouldTrackHiddenForFlattenedContent
      ? markHiddenElementsForFlattenedContent(targetRootForFlattenedContent, plansForCopy)
      : [];
    if (plansForCopy && !shouldTrackHiddenForFlattenedContent) {
      walkCopiedElementsForFlattenedContent(targetRootForFlattenedContent, plansForCopy, () => {});
    }
    let clonedRootForFlattenedContent = cloneNodeWithShadowsForFlattenedContent(targetRootForFlattenedContent, true, plansForCopy)
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
    const imageCandidatesForFlattenedContent =
      replaceImagesWithPlaceholderForFlattenedContent(clonedRootForFlattenedContent);
    stripAttributesForFlattenedContent(clonedRootForFlattenedContent);
    flattenPreBlocksForFlattenedContent(clonedRootForFlattenedContent);
    flattenNestedWrappersForFlattenedContent(clonedRootForFlattenedContent, ["div", "span"], 8);
    if (willCutForFlattenedContent) {
      truncateOverloadedChildrenForFlattenedContent(clonedRootForFlattenedContent);
    }
    removeEmptyTagsForFlattenedContent(clonedRootForFlattenedContent);

    if (imageCandidatesForFlattenedContent && imageCandidatesForFlattenedContent.size) {
      applyImagePlaceholderAttributesForFlattenedContent(
        clonedRootForFlattenedContent,
        imageCandidatesForFlattenedContent,
        isFragmentRootForFlattenedContent
      );
    }

    return serializeCleanRootForFlattenedContent(
      clonedRootForFlattenedContent,
      isFragmentRootForFlattenedContent
    );
  }

  // Sync with: formatFormElementsForFetch in agent/toolExec.js
  //
  // Two passes. First, boolean state attributes serialize as name="" (outerHTML has no bare-attribute
  // form); rewrite them to bare form so the model reads `checked` not `checked=""`. Second, self-close
  // inputs and empty textareas and drop the closing tag on the custom checkbox/radio tags. The
  // attribute-matching sub-pattern is quote-aware ("[^"]*" | [^">]) so a value containing ">" does not
  // terminate the match early; a plain [^>]* would break on such values now that values are emitted.
  function formatFormElementsForPromptForFlattenedContent(cleanHtmlPayloadForFlattenedContent) {
    if (!cleanHtmlPayloadForFlattenedContent || typeof cleanHtmlPayloadForFlattenedContent !== "string") {
      return "";
    }

    let formattedPayloadForFlattenedContent = cleanHtmlPayloadForFlattenedContent;

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      / (checked|disabled|selected|filled)=""/gi,
      " $1"
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<input\b((?:"[^"]*"|[^">])*)>/gi,
      function (_mForFlattenedContent, attrsForFlattenedContent) { return "<input" + attrsForFlattenedContent + " />"; }
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<textarea\b((?:"[^"]*"|[^">])*)><\/textarea>/gi,
      function (_mForFlattenedContent, attrsForFlattenedContent) { return "<textarea" + attrsForFlattenedContent + " />"; }
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<checkbox\b((?:"[^"]*"|[^">])*)><\/checkbox>/gi,
      function (_mForFlattenedContent, attrsForFlattenedContent) { return "<checkbox" + attrsForFlattenedContent + ">"; }
    );

    formattedPayloadForFlattenedContent = formattedPayloadForFlattenedContent.replace(
      /<radio\b((?:"[^"]*"|[^">])*)><\/radio>/gi,
      function (_mForFlattenedContent, attrsForFlattenedContent) { return "<radio" + attrsForFlattenedContent + ">"; }
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
    buildRawHtml: buildRawHtmlPayloadForFlattenedContent,
    countPayloadWordsForNode: countPayloadWordsForNodeForFlattenedContent,
    countPayloadWordsForHtml: countPayloadWordsForHtmlForFlattenedContent
  };

  globalScopeForFlattenedContent.ABChatContent = contentNamespaceForFlattenedContent;
})();
