(function () {
  const globalScopeForToast = globalThis;
  const contentNamespaceForToast = globalScopeForToast.ABChatContent || {};
  contentNamespaceForToast.ui = contentNamespaceForToast.ui || {};
  contentNamespaceForToast.state = contentNamespaceForToast.state || {};

  const toastShadowCssForToast = `
:host {
  all: initial;
  display: block;
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 2147483647;
}
.abchat-toast {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483647;
  pointer-events: auto;
  background-color: #0f172a;
  background-image: linear-gradient(90deg, #0f172a 0%, #1d4ed8 35%, #7c3aed 65%, #0f172a 100%);
  background-size: 220% 100%;
  animation: abchat-toast-gradient-shift 2.2s linear infinite alternate;
  color: #f9fafb;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  box-sizing: border-box;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.32);
  max-width: min(80vw, 420px);
}
.abchat-toast-para {
  margin: 0;
  padding: 0;
}
.abchat-toast-para + .abchat-toast-para {
  margin-top: 6px;
}
.abchat-toast-list {
  margin: 6px 0 0;
  padding-left: 18px;
}
.abchat-toast-list-item {
  margin-top: 3px;
  line-height: 1.4;
}
@keyframes abchat-toast-gradient-shift {
  0%   { background-position: 0% 50%; }
  100% { background-position: 100% 50%; }
}
`;

  function showToastForToast(messageForToast, optionsForToast) {
    if (!messageForToast || !document || !document.body) {
      return;
    }

    const existingHostForToast = document.getElementById("abchat-toast-host");
    if (existingHostForToast) {
      existingHostForToast.remove();
    }

    const hostElementForToast = document.createElement("div");
    hostElementForToast.id = "abchat-toast-host";

    const shadowRootForToast = hostElementForToast.attachShadow({ mode: "closed" });

    const styleElementForToast = document.createElement("style");
    styleElementForToast.textContent = toastShadowCssForToast;
    shadowRootForToast.appendChild(styleElementForToast);

    const toastNodeForToast = document.createElement("div");
    toastNodeForToast.className = "abchat-toast";

    if (Array.isArray(messageForToast)) {
      messageForToast.forEach(function (itemForToast) {
        if (itemForToast && typeof itemForToast === "object" && Array.isArray(itemForToast.list)) {
          const olForToast = document.createElement("ol");
          olForToast.className = "abchat-toast-list";
          itemForToast.list.forEach(function (stepForToast) {
            const liForToast = document.createElement("li");
            liForToast.className = "abchat-toast-list-item";
            liForToast.textContent = stepForToast;
            olForToast.appendChild(liForToast);
          });
          toastNodeForToast.appendChild(olForToast);
        } else {
          const paraForToast = document.createElement("p");
          paraForToast.className = "abchat-toast-para";
          paraForToast.textContent = itemForToast;
          toastNodeForToast.appendChild(paraForToast);
        }
      });
    } else {
      toastNodeForToast.textContent = messageForToast;
    }

    shadowRootForToast.appendChild(toastNodeForToast);

    document.body.appendChild(hostElementForToast);

    if (contentNamespaceForToast.state.toastTimerId) {
      clearTimeout(contentNamespaceForToast.state.toastTimerId);
      contentNamespaceForToast.state.toastTimerId = null;
    }

    const runtimeSettingsForToast = contentNamespaceForToast.state.runtimeSettings || {};
    const baseDurationForToast =
      typeof runtimeSettingsForToast.toastDurationMs === "number" ? runtimeSettingsForToast.toastDurationMs : 1700;
    var overrideDurationForToast = optionsForToast && typeof optionsForToast.durationMs === "number" ? optionsForToast.durationMs : 0;
    const durationForToast = overrideDurationForToast > 0 ? overrideDurationForToast : baseDurationForToast;

    contentNamespaceForToast.state.toastTimerId = window.setTimeout(() => {
      const activeHostForToast = document.getElementById("abchat-toast-host");
      if (activeHostForToast) {
        activeHostForToast.remove();
      }
    }, durationForToast);
  }

  contentNamespaceForToast.ui.toast = {
    show: showToastForToast
  };

  globalScopeForToast.ABChatContent = contentNamespaceForToast;
})();
