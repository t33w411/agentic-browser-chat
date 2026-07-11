// Content-script proxy. Delegates all calls to background/panelDataRepoImpl.js via chrome.runtime.sendMessage.
// Do not load this file in the service worker — use background/panelDataRepoImpl.js there instead.
// When adding a new function to background/panelDataRepoImpl.js, add a matching entry here and in background/dbHandler.js (if it needs special handling like seedIfEmpty).
(function () {
  var globalScopeForPanelDataRepo = globalThis;
  var nsForPanelDataRepo = globalScopeForPanelDataRepo.ABChatShared || {};

  // Per-tab stable identifier. Stamped into every dbOp so the service worker
  // can include it in the cross-tab DB signal, letting the originating tab
  // skip its own echo (storage.onChanged fires on the writer too).
  // Mirrors the pattern used by panelStateSync for UI-state sync.
  function getSourceIdForPanelDataRepo() {
    var globalKeyForSourceId = '__abchatDbSyncSourceId';
    if (globalScopeForPanelDataRepo[globalKeyForSourceId]) {
      return globalScopeForPanelDataRepo[globalKeyForSourceId];
    }
    var sourceIdForPanelDataRepo = '';
    try {
      sourceIdForPanelDataRepo = sessionStorage.getItem('abchat_db_sync_source_id') || '';
    } catch (errorForPanelDataRepo) {
      sourceIdForPanelDataRepo = '';
    }
    if (!sourceIdForPanelDataRepo) {
      sourceIdForPanelDataRepo = 'db_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem('abchat_db_sync_source_id', sourceIdForPanelDataRepo); } catch (e) {}
    }
    globalScopeForPanelDataRepo[globalKeyForSourceId] = sourceIdForPanelDataRepo;
    return sourceIdForPanelDataRepo;
  }

  function sendDbOpForPanelDataRepo(fn, args) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: 'dbOp', fn: fn, args: args || [], sourceId: getSourceIdForPanelDataRepo() },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'DB operation failed'));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : 'DB operation failed'));
            return;
          }
          resolve(response.result);
        }
      );
    });
  }

  nsForPanelDataRepo.panelDataRepo = {
    listChats:                    function ()                                         { return sendDbOpForPanelDataRepo('listChats',                    []); },
    listChatsMeta:                function ()                                         { return sendDbOpForPanelDataRepo('listChatsMeta',                []); },
    getChat:                      function (id)                                       { return sendDbOpForPanelDataRepo('getChat',                      [id]); },
    getChatMeta:                  function (id)                                       { return sendDbOpForPanelDataRepo('getChatMeta',                  [id]); },
    createChat:                   function (input)                                    { return sendDbOpForPanelDataRepo('createChat',                   [input]); },
    updateChat:                   function (id, patch)                                { return sendDbOpForPanelDataRepo('updateChat',                   [id, patch]); },
    deleteChat:                   function (id, protectedBlobIds)                     { return sendDbOpForPanelDataRepo('deleteChat',                   [id, protectedBlobIds]); },
    listMessagesByChatId:         function (chatId)                                   { return sendDbOpForPanelDataRepo('listMessagesByChatId',         [chatId]); },
    getMessage:                   function (id)                                       { return sendDbOpForPanelDataRepo('getMessage',                   [id]); },
    createMessage:                function (chatId, input, options)                   { return sendDbOpForPanelDataRepo('createMessage',                [chatId, input, options]); },
    updateMessage:                function (id, patch)                                { return sendDbOpForPanelDataRepo('updateMessage',                [id, patch]); },
    bulkReplaceMessagesFromIndex: function (chatId, fromId, replacements, options)    { return sendDbOpForPanelDataRepo('bulkReplaceMessagesFromIndex', [chatId, fromId, replacements, options]); },
    listNotes:                    function (noteType)                                 { return sendDbOpForPanelDataRepo('listNotes',                    [noteType]); },
    createNote:                   function (input)                                    { return sendDbOpForPanelDataRepo('createNote',                   [input]); },
    updateNote:                   function (id, patch, options)                       { return sendDbOpForPanelDataRepo('updateNote',                   [id, patch, options]); },
    deleteNote:                   function (id)                                       { return sendDbOpForPanelDataRepo('deleteNote',                   [id]); },
    listNoteVersions:             function (noteId)                                   { return sendDbOpForPanelDataRepo('listNoteVersions',             [noteId]); },
    listTasks:                    function ()                                         { return sendDbOpForPanelDataRepo('listTasks',                    []); },
    createTask:                   function (input)                                    { return sendDbOpForPanelDataRepo('createTask',                   [input]); },
    updateTask:                   function (id, patch, options)                       { return sendDbOpForPanelDataRepo('updateTask',                   [id, patch, options]); },
    toggleTaskCompleted:          function (id, nextCompleted)                        { return sendDbOpForPanelDataRepo('toggleTaskCompleted',          [id, nextCompleted]); },
    deleteTask:                   function (id)                                       { return sendDbOpForPanelDataRepo('deleteTask',                   [id]); },
    listQuestions:                function ()                                         { return sendDbOpForPanelDataRepo('listQuestions',                []); },
    createQuestion:               function (input)                                    { return sendDbOpForPanelDataRepo('createQuestion',               [input]); },
    updateQuestion:               function (id, patch, options)                       { return sendDbOpForPanelDataRepo('updateQuestion',               [id, patch, options]); },
    deleteQuestion:               function (id)                                       { return sendDbOpForPanelDataRepo('deleteQuestion',               [id]); },
    createAttachmentBlob:         function (input)                                    { return sendDbOpForPanelDataRepo('createAttachmentBlob',         [input]); },
    getAttachmentBlob:            function (id)                                       { return sendDbOpForPanelDataRepo('getAttachmentBlob',            [id]); },
    deleteAttachmentBlob:         function (id)                                       { return sendDbOpForPanelDataRepo('deleteAttachmentBlob',         [id]); },
    seedIfEmpty:                  function (data)                                     { return sendDbOpForPanelDataRepo('seedIfEmpty',                  [data]); },
    getNote:                      function (id)                                       { return sendDbOpForPanelDataRepo('getNote',                      [id]); },
    getTask:                      function (id)                                       { return sendDbOpForPanelDataRepo('getTask',                      [id]); },
    getQuestion:                  function (id)                                       { return sendDbOpForPanelDataRepo('getQuestion',                  [id]); },
    pruneOrphanedBlobs:           function (protectedBlobIds)                         { return sendDbOpForPanelDataRepo('pruneOrphanedBlobs',           [protectedBlobIds]); },
    deleteChatsOlderThan:         function (days, protectedBlobIds)                   { return sendDbOpForPanelDataRepo('deleteChatsOlderThan',         [days, protectedBlobIds]); },
    // Cross-tab DB-sync identifier. Receivers compare incoming signal sourceId
    // against this to skip their own echoes. NOT a DB function; the SW handles
    // it via the dbOp envelope, so no entry is required in dbHandler.js.
    getSourceId:                  getSourceIdForPanelDataRepo
  };

  globalScopeForPanelDataRepo.ABChatShared = nsForPanelDataRepo;
})();
