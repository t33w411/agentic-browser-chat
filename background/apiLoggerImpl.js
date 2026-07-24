// Real apiLogger implementation for the service worker. Reads and writes ABChatApiLogs via raw IndexedDB.
// Loaded only in background/service-worker.js via importScripts — never in content scripts.
// When adding a new function here, also add a matching proxy entry in agent/apiLogger.js.
(function () {
  const globalScopeForApiLogger = globalThis;
  const nsForApiLogger = globalScopeForApiLogger.ABChatContent || {};

  const DB_NAME_FOR_API_LOGGER = 'ABChatApiLogs';
  const DB_VERSION_FOR_API_LOGGER = 1;
  const STORE_NAME_FOR_API_LOGGER = 'logs';
  const MAX_RECORDS_FOR_API_LOGGER = 500;

  let dbPromiseForApiLogger = null;

  function openDbForApiLogger() {
    if (dbPromiseForApiLogger) return dbPromiseForApiLogger;
    dbPromiseForApiLogger = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME_FOR_API_LOGGER, DB_VERSION_FOR_API_LOGGER);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME_FOR_API_LOGGER)) {
          db.createObjectStore(STORE_NAME_FOR_API_LOGGER, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) {
        dbPromiseForApiLogger = null;
        reject(e.target.error);
      };
    });
    return dbPromiseForApiLogger;
  }

  async function writeLogForApiLogger(record) {
    try {
      const db = await openDbForApiLogger();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
        store.add(record);
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
      await trimToMaxForApiLogger(db);
    } catch (e) { /* silent */ }
  }

  async function trimToMaxForApiLogger(db) {
    const total = await countLogsInDbForApiLogger(db);
    if (total <= MAX_RECORDS_FOR_API_LOGGER) return;
    const excess = total - MAX_RECORDS_FOR_API_LOGGER;
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readwrite');
      const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
      const req = store.openCursor();
      let deleted = 0;
      req.onsuccess = function (e) {
        const cursor = e.target.result;
        if (!cursor || deleted >= excess) { resolve(); return; }
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function countLogsInDbForApiLogger(db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readonly');
      const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
      const req = store.count();
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function getLogsForApiLogger(limit, offset) {
    try {
      const db = await openDbForApiLogger();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readonly');
        const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
        const results = [];
        const req = store.openCursor(null, 'prev');
        let skipped = 0;
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor) { resolve(results); return; }
          if (skipped < offset) { skipped++; cursor.continue(); return; }
          if (results.length >= limit) { resolve(results); return; }
          results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { return []; }
  }

  async function getLogCountForApiLogger() {
    try {
      const db = await openDbForApiLogger();
      return countLogsInDbForApiLogger(db);
    } catch (e) { return 0; }
  }

  async function deleteLogsForApiLogger(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      const db = await openDbForApiLogger();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
        for (var i = 0; i < ids.length; i++) {
          try { store.delete(Number(ids[i])); } catch (eDel) { /* skip bad id */ }
        }
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { /* silent */ }
  }

  async function clearLogsForApiLogger() {
    try {
      const db = await openDbForApiLogger();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
        store.clear();
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { /* silent */ }
  }

  nsForApiLogger.apiLogger = {
    writeLog:    writeLogForApiLogger,
    getLogs:     getLogsForApiLogger,
    getLogCount: getLogCountForApiLogger,
    deleteLogs:  deleteLogsForApiLogger,
    clearLogs:   clearLogsForApiLogger
  };

  globalScopeForApiLogger.ABChatContent = nsForApiLogger;
})();
