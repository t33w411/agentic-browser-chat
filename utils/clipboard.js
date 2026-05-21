(function () {
  const globalScopeForClipboard = globalThis;
  const contentNamespaceForClipboard = globalScopeForClipboard.ABChatContent || {};
  contentNamespaceForClipboard.utils = contentNamespaceForClipboard.utils || {};

  function fallbackCopyUsingTextareaForClipboard(textToCopyForClipboard) {
    if (!document || !document.body) {
      return false;
    }

    const hiddenTextareaForClipboard = document.createElement("textarea");
    hiddenTextareaForClipboard.value = textToCopyForClipboard;
    hiddenTextareaForClipboard.setAttribute("readonly", "true");
    hiddenTextareaForClipboard.style.position = "fixed";
    hiddenTextareaForClipboard.style.top = "-9999px";
    hiddenTextareaForClipboard.style.left = "-9999px";

    document.body.appendChild(hiddenTextareaForClipboard);
    hiddenTextareaForClipboard.focus();
    hiddenTextareaForClipboard.select();
    hiddenTextareaForClipboard.setSelectionRange(0, hiddenTextareaForClipboard.value.length);

    let copiedForClipboard = false;
    if (typeof document.execCommand === "function") {
      copiedForClipboard = document.execCommand("copy");
    }

    document.body.removeChild(hiddenTextareaForClipboard);
    return copiedForClipboard;
  }

  function copyTextForClipboard(textToCopyForClipboard) {
    if (!textToCopyForClipboard || typeof textToCopyForClipboard !== "string") {
      return Promise.resolve(false);
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard
        .writeText(textToCopyForClipboard)
        .then(() => true)
        .catch(() => fallbackCopyUsingTextareaForClipboard(textToCopyForClipboard));
    }

    return Promise.resolve(fallbackCopyUsingTextareaForClipboard(textToCopyForClipboard));
  }

  function readHtmlFromClipboardForClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      return Promise.resolve(null);
    }

    return navigator.clipboard.read()
      .then(function (clipboardItemsForClipboard) {
        for (var iForClipboard = 0; iForClipboard < clipboardItemsForClipboard.length; iForClipboard++) {
          var itemForClipboard = clipboardItemsForClipboard[iForClipboard];
          if (itemForClipboard.types && itemForClipboard.types.indexOf("text/html") !== -1) {
            return itemForClipboard.getType("text/html").then(function (blobForClipboard) {
              return blobForClipboard.text();
            });
          }
        }
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function readTextFromClipboardForClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      return Promise.resolve(null);
    }

    return navigator.clipboard.readText()
      .then(function (textForClipboard) {
        return textForClipboard || null;
      })
      .catch(function () {
        return null;
      });
  }

  contentNamespaceForClipboard.utils.clipboard = {
    copyText: copyTextForClipboard,
    readHtml: readHtmlFromClipboardForClipboard,
    readText: readTextFromClipboardForClipboard
  };

  globalScopeForClipboard.ABChatContent = contentNamespaceForClipboard;
})();
