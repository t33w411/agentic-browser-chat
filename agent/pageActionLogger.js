// Content-script proxy. Delegates all calls to background/pageActionLoggerImpl.js via
// chrome.runtime.sendMessage. Do not load this file in the service worker — use
// background/pageActionLoggerImpl.js there instead. When adding a new function to
// background/pageActionLoggerImpl.js, add a matching entry here.
(function () {
  var globalScopeForPageActionLogger = globalThis;
  var nsForPageActionLogger = globalScopeForPageActionLogger.ABChatContent || {};

  function sendPageActionLogOpForPageActionLogger(fn, args) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: 'pageActionLogOp', fn: fn, args: args || [] },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Page action log operation failed'));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : 'Page action log operation failed'));
            return;
          }
          resolve(response.result);
        }
      );
    });
  }

  nsForPageActionLogger.pageActionLogger = {
    writeLog:     function (record)         { return sendPageActionLogOpForPageActionLogger('writeLog',     [record]); },
    getLogs:      function (limit, offset)  { return sendPageActionLogOpForPageActionLogger('getLogs',      [limit, offset]); },
    getLogsByRun: function (runId)          { return sendPageActionLogOpForPageActionLogger('getLogsByRun', [runId]); },
    getLogCount:  function ()               { return sendPageActionLogOpForPageActionLogger('getLogCount',  []); },
    deleteLogs:   function (ids)            { return sendPageActionLogOpForPageActionLogger('deleteLogs',   [ids]); },
    clearLogs:    function ()               { return sendPageActionLogOpForPageActionLogger('clearLogs',    []); }
  };

  globalScopeForPageActionLogger.ABChatContent = nsForPageActionLogger;
})();
