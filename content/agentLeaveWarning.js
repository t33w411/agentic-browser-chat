(function () {
  var globalScopeForAgentLeaveWarning = globalThis;
  var ns = globalScopeForAgentLeaveWarning.ABChatContent || {};
  ns.state = ns.state || {};
  globalScopeForAgentLeaveWarning.ABChatContent = ns;

  var capturedGenerationForAgentLeaveWarning = window.abchatListenerGeneration || 0;

  function isStaleForAgentLeaveWarning() {
    if ((window.abchatListenerGeneration || 0) !== capturedGenerationForAgentLeaveWarning) {
      return true;
    }
    try {
      if (!chrome.runtime || !chrome.runtime.id) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function onBeforeUnloadForAgentLeaveWarning(evt) {
    if (isStaleForAgentLeaveWarning()) {
      window.removeEventListener('beforeunload', onBeforeUnloadForAgentLeaveWarning);
      return;
    }
    var stateForWarning = globalScopeForAgentLeaveWarning.ABChatContent &&
      globalScopeForAgentLeaveWarning.ABChatContent.state;
    if (stateForWarning && stateForWarning.agentIsWorking) {
      evt.preventDefault();
      evt.returnValue = '';
    }
  }

  window.addEventListener('beforeunload', onBeforeUnloadForAgentLeaveWarning);
})();
