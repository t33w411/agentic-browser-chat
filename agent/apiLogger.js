// Content-script proxy. Delegates all calls to background/apiLoggerImpl.js via chrome.runtime.sendMessage.
// Do not load this file in the service worker — use background/apiLoggerImpl.js there instead.
// When adding a new function to background/apiLoggerImpl.js, add a matching entry here.
(function () {
  var globalScopeForApiLogger = globalThis;
  var nsForApiLogger = globalScopeForApiLogger.ABChatContent || {};

  function sendApiLogOpForApiLogger(fn, args) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: 'apiLogOp', fn: fn, args: args || [] },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'API log operation failed'));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : 'API log operation failed'));
            return;
          }
          resolve(response.result);
        }
      );
    });
  }

  nsForApiLogger.apiLogger = {
    writeLog:    function (record)         { return sendApiLogOpForApiLogger('writeLog',    [record]); },
    getLogs:     function (limit, offset)  { return sendApiLogOpForApiLogger('getLogs',     [limit, offset]); },
    getLogCount: function ()               { return sendApiLogOpForApiLogger('getLogCount', []); },
    deleteLogs:  function (ids)            { return sendApiLogOpForApiLogger('deleteLogs',  [ids]); },
    clearLogs:   function ()               { return sendApiLogOpForApiLogger('clearLogs',   []); }
  };

  globalScopeForApiLogger.ABChatContent = nsForApiLogger;
})();
