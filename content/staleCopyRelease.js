(function () {
  // Lets this copy of the content scripts give its memory back once the extension has been
  // reloaded, updated or disabled underneath it.
  //
  // A reload does not unload the copy already in a tab. The next injection runs in a new isolated
  // world, and the old world stays alive, with every library and every closure, until the tab
  // itself is reloaded. Each extension reload therefore used to leave one more full copy in every
  // open tab. Measured on a small page: about 10 MB of JS heap, 70 DOM nodes and 170 event
  // listeners per copy, more once the panel has been built.
  //
  // Nothing outside can reach the old world, so the old copy has to let go by itself. Two things
  // keep it reachable, and both are undone in releaseForStaleCopyRelease:
  //   - its globals (ABChatContent, ABChatAgent, the libraries), found by comparing against the
  //     names that existed before this bundle loaded;
  //   - its listeners on window, document, <html> and <body>, recorded here as they are added.
  //     One surviving listener keeps its whole source file alive, which is why dropping the
  //     globals alone gave back less than half.
  //
  // This file must load before every script that adds a page-level listener or a global, so it
  // sits directly after content/preInit.js in both injection lists.
  const globalScopeForStaleCopyRelease = globalThis;
  // Not a const: the two wrappers below stay on EventTarget.prototype for the life of the tab,
  // so anything this scope still holds after a release is held for good.
  let contentNamespaceForStaleCopyRelease = globalScopeForStaleCopyRelease.ABChatContent || {};

  // A second injection into the same world shares the first one's record and name snapshot.
  // Wrapping again would snapshot the first copy's globals as "already there" and keep them.
  if (contentNamespaceForStaleCopyRelease.staleCopyRelease) {
    return;
  }

  const CHECK_INTERVAL_MS_FOR_STALE_COPY_RELEASE = 30000;
  const globalNamesAtStartForStaleCopyRelease = new Set(
    Object.getOwnPropertyNames(globalScopeForStaleCopyRelease)
  );
  const nativeAddEventListenerForStaleCopyRelease = EventTarget.prototype.addEventListener;
  const nativeRemoveEventListenerForStaleCopyRelease = EventTarget.prototype.removeEventListener;
  const pageListenersForStaleCopyRelease = [];
  let releasedForStaleCopyRelease = false;
  let checkTimerForStaleCopyRelease = null;

  // Only these four are recorded. They outlive everything the extension builds, so a listener on
  // one of them is what pins a dead copy. A listener on any other node goes when that node does,
  // and recording those would keep every short-lived element and request alive instead.
  function isPageLevelTargetForStaleCopyRelease(targetForStaleCopyRelease) {
    if (targetForStaleCopyRelease === globalScopeForStaleCopyRelease) return true;
    if (typeof document === "undefined" || !document) return false;
    return (
      targetForStaleCopyRelease === document ||
      targetForStaleCopyRelease === document.documentElement ||
      targetForStaleCopyRelease === document.body
    );
  }

  function captureFlagForStaleCopyRelease(optionsForStaleCopyRelease) {
    if (optionsForStaleCopyRelease === true) return true;
    if (optionsForStaleCopyRelease && typeof optionsForStaleCopyRelease === "object") {
      return optionsForStaleCopyRelease.capture === true;
    }
    return false;
  }

  function findPageListenerForStaleCopyRelease(targetForFind, typeForFind, listenerForFind, captureForFind) {
    for (let indexForFind = 0; indexForFind < pageListenersForStaleCopyRelease.length; indexForFind++) {
      const entryForFind = pageListenersForStaleCopyRelease[indexForFind];
      if (
        entryForFind.target === targetForFind &&
        entryForFind.type === typeForFind &&
        entryForFind.listener === listenerForFind &&
        entryForFind.capture === captureForFind
      ) {
        return indexForFind;
      }
    }
    return -1;
  }

  function forgetPageListenerForStaleCopyRelease(targetForForget, typeForForget, listenerForForget, captureForForget) {
    const indexForForget = findPageListenerForStaleCopyRelease(
      targetForForget, typeForForget, listenerForForget, captureForForget
    );
    if (indexForForget !== -1) pageListenersForStaleCopyRelease.splice(indexForForget, 1);
  }

  EventTarget.prototype.addEventListener = function (typeForAdd, listenerForAdd, optionsForAdd) {
    const targetForAdd = this === undefined || this === null ? globalScopeForStaleCopyRelease : this;
    const isPageLevelForAdd = isPageLevelTargetForStaleCopyRelease(targetForAdd);
    // A released copy has nothing left to do with the page, and a new page-level listener
    // would pin it again.
    if (releasedForStaleCopyRelease && isPageLevelForAdd) return undefined;
    const resultForAdd = nativeAddEventListenerForStaleCopyRelease.apply(this, arguments);
    if (!isPageLevelForAdd || !listenerForAdd) return resultForAdd;
    const optionsObjectForAdd = optionsForAdd && typeof optionsForAdd === "object" ? optionsForAdd : null;
    // A once listener removes itself, and would otherwise stay in the record after it fired.
    if (optionsObjectForAdd && optionsObjectForAdd.once === true) return resultForAdd;
    const signalForAdd = optionsObjectForAdd ? optionsObjectForAdd.signal : null;
    if (signalForAdd && signalForAdd.aborted) return resultForAdd;
    const typeKeyForAdd = String(typeForAdd);
    const captureForAdd = captureFlagForStaleCopyRelease(optionsForAdd);
    if (findPageListenerForStaleCopyRelease(targetForAdd, typeKeyForAdd, listenerForAdd, captureForAdd) !== -1) {
      return resultForAdd;
    }
    pageListenersForStaleCopyRelease.push({
      target: targetForAdd,
      type: typeKeyForAdd,
      listener: listenerForAdd,
      capture: captureForAdd
    });
    if (signalForAdd) {
      try {
        nativeAddEventListenerForStaleCopyRelease.call(signalForAdd, "abort", function () {
          forgetPageListenerForStaleCopyRelease(targetForAdd, typeKeyForAdd, listenerForAdd, captureForAdd);
        }, { once: true });
      } catch (errorForAdd) {}
    }
    return resultForAdd;
  };

  EventTarget.prototype.removeEventListener = function (typeForRemove, listenerForRemove, optionsForRemove) {
    const targetForRemove = this === undefined || this === null ? globalScopeForStaleCopyRelease : this;
    const resultForRemove = nativeRemoveEventListenerForStaleCopyRelease.apply(this, arguments);
    if (listenerForRemove && isPageLevelTargetForStaleCopyRelease(targetForRemove)) {
      forgetPageListenerForStaleCopyRelease(
        targetForRemove,
        String(typeForRemove),
        listenerForRemove,
        captureFlagForStaleCopyRelease(optionsForRemove)
      );
    }
    return resultForRemove;
  };

  function hasRuntimeContextForStaleCopyRelease() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (errorForStaleCopyRelease) {
      return false;
    }
  }

  function teardownModuleForStaleCopyRelease(moduleForTeardown) {
    if (!moduleForTeardown || typeof moduleForTeardown.teardown !== "function") return;
    try {
      moduleForTeardown.teardown();
    } catch (errorForTeardown) {}
  }

  function releaseForStaleCopyRelease() {
    if (releasedForStaleCopyRelease) return;
    releasedForStaleCopyRelease = true;
    if (checkTimerForStaleCopyRelease !== null) {
      clearInterval(checkTimerForStaleCopyRelease);
      checkTimerForStaleCopyRelease = null;
    }

    const namespaceForRelease = globalScopeForStaleCopyRelease.ABChatContent || contentNamespaceForStaleCopyRelease || {};
    const uiForRelease = namespaceForRelease.ui || {};
    contentNamespaceForStaleCopyRelease = null;

    // The modules go first, while their code is still whole: these stop their timers and
    // observers, and the page layout tool puts the page back the way it found it.
    teardownModuleForStaleCopyRelease(uiForRelease.panelRuntime);
    teardownModuleForStaleCopyRelease(uiForRelease.panelStateSync);
    teardownModuleForStaleCopyRelease(namespaceForRelease.pageLayout);

    // Only the panel this copy built. A newer copy in the same tab has its own host under the
    // same id, so this goes by reference and never by id.
    try {
      const panelHostForRelease = uiForRelease.panelShadowRoot ? uiForRelease.panelShadowRoot.host : null;
      if (panelHostForRelease && panelHostForRelease.parentNode) {
        panelHostForRelease.parentNode.removeChild(panelHostForRelease);
      }
    } catch (errorForPanelHost) {}
    // Whatever still holds the namespace object must not hold the panel through it.
    uiForRelease.panelShadowRoot = null;

    pageListenersForStaleCopyRelease.splice(0).forEach(function (entryForRelease) {
      try {
        nativeRemoveEventListenerForStaleCopyRelease.call(
          entryForRelease.target, entryForRelease.type, entryForRelease.listener, entryForRelease.capture
        );
      } catch (errorForListener) {}
    });

    // A top-level `var` in a library is a global that cannot be deleted, only emptied.
    Object.getOwnPropertyNames(globalScopeForStaleCopyRelease).forEach(function (nameForRelease) {
      if (globalNamesAtStartForStaleCopyRelease.has(nameForRelease)) return;
      try {
        delete globalScopeForStaleCopyRelease[nameForRelease];
      } catch (errorForDelete) {}
      if (nameForRelease in globalScopeForStaleCopyRelease) {
        try {
          globalScopeForStaleCopyRelease[nameForRelease] = undefined;
        } catch (errorForClear) {}
      }
    });
  }

  // True once this copy has been released. A copy whose extension context is still valid is
  // never released, whatever calls this.
  function checkForStaleCopyRelease() {
    if (releasedForStaleCopyRelease) return true;
    if (hasRuntimeContextForStaleCopyRelease()) return false;
    releaseForStaleCopyRelease();
    return true;
  }

  // A dead copy gets no event telling it so, and a listener's own stale check only runs when
  // that listener next fires, which in a background tab may be never. A timer is the one thing
  // that still runs there. It reads one property and wakes nothing else.
  checkTimerForStaleCopyRelease = setInterval(checkForStaleCopyRelease, CHECK_INTERVAL_MS_FOR_STALE_COPY_RELEASE);

  contentNamespaceForStaleCopyRelease.staleCopyRelease = {
    check: checkForStaleCopyRelease
  };
  globalScopeForStaleCopyRelease.ABChatContent = contentNamespaceForStaleCopyRelease;
})();
