// Real pageActionLogger implementation for the service worker. Reads and writes ABChatPageActionLogs
// via raw IndexedDB. Loaded only in background/service-worker.js via importScripts — never in content
// scripts (they use the agent/pageActionLogger.js proxy). When adding a new function here, also add a
// matching proxy entry in agent/pageActionLogger.js.
//
// This is a separate database from ABChatApiLogs on purpose: that store trims by record count (500),
// which would evict the LLM logs within a couple of runs once bulky DOM records share it. This store
// trims by total bytes and age instead, so a light user does not silently retain months of capture.
(function () {
  const globalScopeForPageActionLogger = globalThis;
  const nsForPageActionLogger = globalScopeForPageActionLogger.ABChatContent || {};

  const DB_NAME_FOR_PAGE_ACTION_LOGGER = 'ABChatPageActionLogs';
  const DB_VERSION_FOR_PAGE_ACTION_LOGGER = 1;
  const STORE_NAME_FOR_PAGE_ACTION_LOGGER = 'logs';
  const MAX_BYTES_FOR_PAGE_ACTION_LOGGER = 50 * 1024 * 1024; // 50 MB total
  const MAX_AGE_MS_FOR_PAGE_ACTION_LOGGER = 7 * 24 * 60 * 60 * 1000; // 7 days

  let dbPromiseForPageActionLogger = null;

  function openDbForPageActionLogger() {
    if (dbPromiseForPageActionLogger) return dbPromiseForPageActionLogger;
    dbPromiseForPageActionLogger = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME_FOR_PAGE_ACTION_LOGGER, DB_VERSION_FOR_PAGE_ACTION_LOGGER);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME_FOR_PAGE_ACTION_LOGGER)) {
          const store = db.createObjectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER, { keyPath: 'id', autoIncrement: true });
          // timestamp: ordered reads and the age-trim range scan (ISO 8601 UTC sorts chronologically).
          // runId: per-run export and the join back to the ABChatApiLogs 'chat' record.
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('runId', 'runId', { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) {
        dbPromiseForPageActionLogger = null;
        reject(e.target.error);
      };
    });
    return dbPromiseForPageActionLogger;
  }

  // Approximate serialized byte size, stored on the record so the byte-cap trim can sum a cheap
  // numeric field instead of re-serializing every record on each write. Char length is a close
  // enough proxy for a storage cap; exact UTF-8 byte counting is not worth the cost here.
  function approxRecordBytesForPageActionLogger(record) {
    try { return JSON.stringify(record).length; } catch (e) { return 0; }
  }

  async function writeLogForPageActionLogger(record) {
    try {
      const db = await openDbForPageActionLogger();
      const stampedRecord = record || {};
      if (!stampedRecord.timestamp) stampedRecord.timestamp = new Date().toISOString();
      stampedRecord.bytes = approxRecordBytesForPageActionLogger(stampedRecord);
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
        store.add(stampedRecord);
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
      await trimForPageActionLogger(db);
    } catch (e) { /* silent: telemetry must never throw into the caller */ }
  }

  // Two independent caps, both applied on every write: age first (privacy — never retain past the
  // window), then bytes (storage — evict oldest until under the size cap).
  async function trimForPageActionLogger(db) {
    await trimByAgeForPageActionLogger(db);
    await trimByBytesForPageActionLogger(db);
  }

  function trimByAgeForPageActionLogger(db) {
    const cutoffForAge = new Date(Date.now() - MAX_AGE_MS_FOR_PAGE_ACTION_LOGGER).toISOString();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readwrite');
      const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
      const idx = store.index('timestamp');
      const req = idx.openCursor(IDBKeyRange.upperBound(cutoffForAge));
      req.onsuccess = function (e) {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  async function trimByBytesForPageActionLogger(db) {
    const totalBytes = await sumBytesForPageActionLogger(db);
    if (totalBytes <= MAX_BYTES_FOR_PAGE_ACTION_LOGGER) return;
    let toReclaim = totalBytes - MAX_BYTES_FOR_PAGE_ACTION_LOGGER;
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readwrite');
      const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
      // Oldest first: primary key is autoIncrement, so the default ascending cursor is insertion order.
      const req = store.openCursor();
      req.onsuccess = function (e) {
        const cursor = e.target.result;
        if (!cursor || toReclaim <= 0) { resolve(); return; }
        const recBytes = (cursor.value && typeof cursor.value.bytes === 'number') ? cursor.value.bytes : 0;
        cursor.delete();
        toReclaim -= recBytes;
        cursor.continue();
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function sumBytesForPageActionLogger(db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readonly');
      const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
      const req = store.openCursor();
      let total = 0;
      req.onsuccess = function (e) {
        const cursor = e.target.result;
        if (!cursor) { resolve(total); return; }
        total += (cursor.value && typeof cursor.value.bytes === 'number') ? cursor.value.bytes : 0;
        cursor.continue();
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function countLogsInDbForPageActionLogger(db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readonly');
      const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
      const req = store.count();
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Newest first, paged. Mirrors getLogs on the API logger so the viewer can share list logic.
  async function getLogsForPageActionLogger(limit, offset) {
    const limitForGet = Number(limit) || 50;
    const offsetForGet = Number(offset) || 0;
    try {
      const db = await openDbForPageActionLogger();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readonly');
        const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
        const results = [];
        const req = store.openCursor(null, 'prev');
        let skipped = 0;
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor) { resolve(results); return; }
          if (skipped < offsetForGet) { skipped++; cursor.continue(); return; }
          if (results.length >= limitForGet) { resolve(results); return; }
          results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { return []; }
  }

  // Every record for one run, oldest first (chronological action order for review/export).
  async function getLogsByRunForPageActionLogger(runId) {
    try {
      const db = await openDbForPageActionLogger();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readonly');
        const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
        const idx = store.index('runId');
        const req = idx.getAll(IDBKeyRange.only(runId));
        req.onsuccess = function (e) {
          const rows = e.target.result || [];
          rows.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
          resolve(rows);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { return []; }
  }

  async function getLogCountForPageActionLogger() {
    try {
      const db = await openDbForPageActionLogger();
      return countLogsInDbForPageActionLogger(db);
    } catch (e) { return 0; }
  }

  async function deleteLogsForPageActionLogger(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      const db = await openDbForPageActionLogger();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
        for (var i = 0; i < ids.length; i++) {
          try { store.delete(Number(ids[i])); } catch (eDel) { /* skip bad id */ }
        }
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { /* silent */ }
  }

  async function clearLogsForPageActionLogger() {
    try {
      const db = await openDbForPageActionLogger();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_PAGE_ACTION_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_PAGE_ACTION_LOGGER);
        store.clear();
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { /* silent */ }
  }

  nsForPageActionLogger.pageActionLogger = {
    writeLog:      writeLogForPageActionLogger,
    getLogs:       getLogsForPageActionLogger,
    getLogsByRun:  getLogsByRunForPageActionLogger,
    getLogCount:   getLogCountForPageActionLogger,
    deleteLogs:    deleteLogsForPageActionLogger,
    clearLogs:     clearLogsForPageActionLogger
  };

  globalScopeForPageActionLogger.ABChatContent = nsForPageActionLogger;
})();
