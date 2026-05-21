(function () {
  var globalScopeForDbHandler = globalThis;
  var nsForDbHandler = globalScopeForDbHandler.ABChatBackground || {};

  function getRepoForDbHandler() {
    return (globalScopeForDbHandler.ABChatShared || {}).panelDataRepo || null;
  }

  function getApiLoggerForDbHandler() {
    return (globalScopeForDbHandler.ABChatContent || {}).apiLogger || null;
  }

  async function seedIfEmptyForDbHandler(data) {
    var db = (globalScopeForDbHandler.ABChatShared || {}).db;
    if (!db) throw new Error('Database not ready');

    var chatCount = await db.chats.count();
    var noteCount = await db.notes.count();
    if (chatCount > 0 || noteCount > 0) return { seeded: false };

    var chats     = Array.isArray(data && data.chats)     ? data.chats     : [];
    var notes     = Array.isArray(data && data.notes)     ? data.notes     : [];
    var tasks     = Array.isArray(data && data.tasks)     ? data.tasks     : [];
    var questions = Array.isArray(data && data.questions) ? data.questions : [];

    await db.transaction('rw', [db.chats, db.messages, db.notes, db.tasks, db.questions], async function () {
      for (var i = 0; i < chats.length; i++) {
        var chat = chats[i];
        var msgs = Array.isArray(chat.messages) ? chat.messages : [];
        var chatRecord = Object.assign({}, chat);
        delete chatRecord.messages;
        await db.chats.add(chatRecord);
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j] && msgs[j].role !== '_loading') {
            await db.messages.add(msgs[j]);
          }
        }
      }
      for (var k = 0; k < notes.length; k++) {
        await db.notes.add(notes[k]);
      }
      for (var l = 0; l < tasks.length; l++) {
        await db.tasks.add(tasks[l]);
      }
      for (var m = 0; m < questions.length; m++) {
        await db.questions.add(questions[m]);
      }
    });

    return { seeded: true };
  }

  async function handleDbOpForDbHandler(msg, sendResponse) {
    var fn   = msg && typeof msg.fn === 'string' ? msg.fn : '';
    var args = Array.isArray(msg && msg.args)    ? msg.args : [];

    if (fn === 'seedIfEmpty') {
      try {
        var seedResult = await seedIfEmptyForDbHandler(args[0]);
        sendResponse({ ok: true, result: seedResult });
      } catch (errForSeed) {
        sendResponse({ ok: false, error: errForSeed && errForSeed.message ? errForSeed.message : String(errForSeed) });
      }
      return;
    }

    var repo = getRepoForDbHandler();
    if (!repo || typeof repo[fn] !== 'function') {
      sendResponse({ ok: false, error: 'Unknown DB function: ' + fn });
      return;
    }
    try {
      var result = await repo[fn].apply(repo, args);
      sendResponse({ ok: true, result: result });
    } catch (errForDbOp) {
      sendResponse({ ok: false, error: errForDbOp && errForDbOp.message ? errForDbOp.message : String(errForDbOp) });
    }
  }

  async function handleApiLogOpForDbHandler(msg, sendResponse) {
    var fn   = msg && typeof msg.fn === 'string' ? msg.fn : '';
    var args = Array.isArray(msg && msg.args)    ? msg.args : [];

    var logger = getApiLoggerForDbHandler();
    if (!logger || typeof logger[fn] !== 'function') {
      sendResponse({ ok: false, error: 'Unknown apiLogger function: ' + fn });
      return;
    }
    try {
      var result = await logger[fn].apply(logger, args);
      sendResponse({ ok: true, result: result });
    } catch (errForApiLogOp) {
      sendResponse({ ok: false, error: errForApiLogOp && errForApiLogOp.message ? errForApiLogOp.message : String(errForApiLogOp) });
    }
  }

  nsForDbHandler.dbHandler = {
    handleDbOp:    handleDbOpForDbHandler,
    handleApiLogOp: handleApiLogOpForDbHandler
  };

  globalScopeForDbHandler.ABChatBackground = nsForDbHandler;
})();
