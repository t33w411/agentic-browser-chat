// Real apiLogger implementation for the service worker. Reads and writes ABChatApiLogs via raw IndexedDB.
// Loaded only in background/service-worker.js via importScripts — never in content scripts.
// When adding a new function here, also add a matching proxy entry in agent/apiLogger.js.
(function () {
  const globalScopeForApiLogger = globalThis;
  const nsForApiLogger = globalScopeForApiLogger.ABChatContent || {};

  const DB_NAME_FOR_API_LOGGER = 'ABChatApiLogs';
  // Version 2 added the size index. Version 3 sizes the records written before it (see
  // backfillSizesForApiLogger), including on installs that had already reached version 2.
  const DB_VERSION_FOR_API_LOGGER = 3;
  const STORE_NAME_FOR_API_LOGGER = 'logs';
  const MAX_RECORDS_FOR_API_LOGGER = 500;
  // The store is also capped by size, oldest records going first. A count alone let 500 records
  // grow without limit, since one record can hold a whole conversation or a fetched page. Sizes
  // are JSON lengths in characters, the same proxy the page action log uses.
  const MAX_BYTES_FOR_API_LOGGER = 50 * 1024 * 1024;
  // No single string in a record is kept past this. It is the most any one tool result sends the
  // model, so a chat log still shows each message as sent, and anything longer, such as a
  // compaction request, keeps its start and says how much was left out.
  const MAX_STRING_CHARS_FOR_API_LOGGER = 200000;
  // A list row only needs these, so the viewer can page through records without loading each
  // whole conversation. Text fields are cut to what a row preview can show.
  const SUMMARY_FIELDS_FOR_API_LOGGER = ['id', 'requestType', 'type', 'timestamp', 'model', 'status', 'stopReason', 'stopLimit', 'toolTimeoutMs', 'totalLatencyMs', 'latencyMs', 'iterationCount', 'chatId', 'runId'];
  const SUMMARY_TEXT_FIELDS_FOR_API_LOGGER = ['errorMessage', 'responseContent', 'rawResponse'];
  const SUMMARY_TEXT_CHARS_FOR_API_LOGGER = 300;

  let dbPromiseForApiLogger = null;

  function openDbForApiLogger() {
    if (dbPromiseForApiLogger) return dbPromiseForApiLogger;
    dbPromiseForApiLogger = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME_FOR_API_LOGGER, DB_VERSION_FOR_API_LOGGER);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        const hadStoreForUpgrade = db.objectStoreNames.contains(STORE_NAME_FOR_API_LOGGER);
        const store = hadStoreForUpgrade
          ? e.target.transaction.objectStore(STORE_NAME_FOR_API_LOGGER)
          : db.createObjectStore(STORE_NAME_FOR_API_LOGGER, { keyPath: 'id', autoIncrement: true });
        // Summing sizes through this index reads only the numbers, never the records. A record
        // with no size is left out of it, so the records already here are sized below.
        if (!store.indexNames.contains('bytes')) {
          store.createIndex('bytes', 'bytes', { unique: false });
        }
        if (hadStoreForUpgrade) backfillSizesForApiLogger(store);
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) {
        dbPromiseForApiLogger = null;
        reject(e.target.error);
      };
    });
    return dbPromiseForApiLogger;
  }

  // A copy of the value with every string over the cap cut down. Records arrive as JSON from
  // other contexts, so they hold no cycles; the depth check only stops a malformed one.
  function boundStringsForApiLogger(valueForBound, depthForBound) {
    if (typeof valueForBound === 'string') {
      if (valueForBound.length <= MAX_STRING_CHARS_FOR_API_LOGGER) return valueForBound;
      return valueForBound.slice(0, MAX_STRING_CHARS_FOR_API_LOGGER)
        + '\n[... ' + (valueForBound.length - MAX_STRING_CHARS_FOR_API_LOGGER).toLocaleString('en-US') + ' more characters not kept in the log]';
    }
    if (!valueForBound || typeof valueForBound !== 'object' || depthForBound > 40) return valueForBound;
    if (Array.isArray(valueForBound)) {
      return valueForBound.map(function (itemForBound) { return boundStringsForApiLogger(itemForBound, depthForBound + 1); });
    }
    const copyForBound = {};
    for (const keyForBound in valueForBound) {
      if (Object.prototype.hasOwnProperty.call(valueForBound, keyForBound)) {
        copyForBound[keyForBound] = boundStringsForApiLogger(valueForBound[keyForBound], depthForBound + 1);
      }
    }
    return copyForBound;
  }

  // Records written before sizes were kept have none, so the size cap could not see them. Many are
  // large, because an agent run used to store its whole history once per turn and nothing cut long
  // strings. Walking newest first, each record without a size gets its strings cut and its size
  // stored, until the records kept fill the size cap. That record and everything older are deleted
  // as one key range, without being read. The newest record is kept whatever its size, as when a
  // record is written. It runs inside the upgrade, so nothing can read or write the store before
  // it has finished. A failure skips the record, or stops the walk, and never aborts the upgrade,
  // since that would leave the log unable to open.
  function backfillSizesForApiLogger(storeForBackfill) {
    let totalForBackfill = 0;
    let keptForBackfill = 0;
    function keepUpgradeAliveForBackfill(eventForError) {
      if (eventForError && typeof eventForError.preventDefault === 'function') eventForError.preventDefault();
    }
    let cursorReqForBackfill;
    try {
      cursorReqForBackfill = storeForBackfill.openCursor(null, 'prev');
    } catch (eOpenForBackfill) {
      return;
    }
    cursorReqForBackfill.onerror = keepUpgradeAliveForBackfill;
    cursorReqForBackfill.onsuccess = function (e) {
      const cursorForBackfill = e.target.result;
      if (!cursorForBackfill) return;
      try {
        const valueForBackfill = cursorForBackfill.value;
        let recordForBackfill = null;
        let bytesForBackfill = valueForBackfill && typeof valueForBackfill === 'object' ? Number(valueForBackfill.bytes) : NaN;
        if (!Number.isFinite(bytesForBackfill) && valueForBackfill && typeof valueForBackfill === 'object') {
          recordForBackfill = boundStringsForApiLogger(valueForBackfill, 0);
          recordForBackfill.bytes = 0;
          try { recordForBackfill.bytes = JSON.stringify(recordForBackfill).length; } catch (eForBytes) {}
          bytesForBackfill = recordForBackfill.bytes;
        }
        if (!Number.isFinite(bytesForBackfill)) bytesForBackfill = 0;
        if (keptForBackfill > 0 && totalForBackfill + bytesForBackfill > MAX_BYTES_FOR_API_LOGGER) {
          storeForBackfill.delete(IDBKeyRange.upperBound(cursorForBackfill.primaryKey)).onerror = keepUpgradeAliveForBackfill;
          return;
        }
        totalForBackfill += bytesForBackfill;
        keptForBackfill++;
        if (recordForBackfill) cursorForBackfill.update(recordForBackfill).onerror = keepUpgradeAliveForBackfill;
      } catch (eRecordForBackfill) {
        // An unreadable record is left as it was. The count cap still removes it in time.
      }
      // An exception thrown here would abort the upgrade, so a failed step ends the walk instead.
      try { cursorForBackfill.continue(); } catch (eContinueForBackfill) {}
    };
  }

  async function writeLogForApiLogger(record) {
    try {
      const db = await openDbForApiLogger();
      const boundedRecord = boundStringsForApiLogger(record || {}, 0);
      boundedRecord.bytes = 0;
      try { boundedRecord.bytes = JSON.stringify(boundedRecord).length; } catch (eForBytes) {}
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readwrite');
        const store = tx.objectStore(STORE_NAME_FOR_API_LOGGER);
        store.add(boundedRecord);
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
      await trimToMaxForApiLogger(db);
      await trimByBytesForApiLogger(db);
    } catch (e) { /* silent */ }
  }

  // Oldest first until the sizes add up to the cap. Reads [id, size] pairs from the index, so the
  // cost does not grow with how large the records are.
  async function trimByBytesForApiLogger(db) {
    const sizesForTrim = await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readonly');
      const req = tx.objectStore(STORE_NAME_FOR_API_LOGGER).index('bytes').openKeyCursor();
      const pairsForTrim = [];
      req.onsuccess = function (e) {
        const cursor = e.target.result;
        if (!cursor) { resolve(pairsForTrim); return; }
        pairsForTrim.push([cursor.primaryKey, Number(cursor.key) || 0]);
        cursor.continue();
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
    let totalForTrim = 0;
    for (let iForSum = 0; iForSum < sizesForTrim.length; iForSum++) totalForTrim += sizesForTrim[iForSum][1];
    if (totalForTrim <= MAX_BYTES_FOR_API_LOGGER) return;
    sizesForTrim.sort(function (aForSort, bForSort) { return aForSort[0] - bForSort[0]; });
    const idsToDeleteForTrim = [];
    // The newest record is never deleted here, so a single record over the cap is still kept.
    for (let iForTrim = 0; iForTrim < sizesForTrim.length - 1 && totalForTrim > MAX_BYTES_FOR_API_LOGGER; iForTrim++) {
      idsToDeleteForTrim.push(sizesForTrim[iForTrim][0]);
      totalForTrim -= sizesForTrim[iForTrim][1];
    }
    await deleteLogsForApiLogger(idsToDeleteForTrim);
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
        let skipped = false;
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor) { resolve(results); return; }
          // One jump past the earlier pages, rather than reading each skipped record.
          if (!skipped && offset > 0) { skipped = true; cursor.advance(offset); return; }
          skipped = true;
          if (results.length >= limit) { resolve(results); return; }
          results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { return []; }
  }

  // Newest first, paged, with only the fields a list row shows.
  async function getLogSummariesForApiLogger(limit, offset) {
    const logsForSummary = await getLogsForApiLogger(limit, offset);
    return logsForSummary.map(function (logForSummary) {
      const summaryForLog = {};
      SUMMARY_FIELDS_FOR_API_LOGGER.forEach(function (fieldForSummary) {
        if (logForSummary[fieldForSummary] !== undefined) summaryForLog[fieldForSummary] = logForSummary[fieldForSummary];
      });
      SUMMARY_TEXT_FIELDS_FOR_API_LOGGER.forEach(function (fieldForSummary) {
        const textForSummary = logForSummary[fieldForSummary];
        if (typeof textForSummary === 'string' && textForSummary) summaryForLog[fieldForSummary] = textForSummary.slice(0, SUMMARY_TEXT_CHARS_FOR_API_LOGGER);
      });
      return summaryForLog;
    });
  }

  async function getLogForApiLogger(id) {
    try {
      const db = await openDbForApiLogger();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME_FOR_API_LOGGER, 'readonly');
        const req = tx.objectStore(STORE_NAME_FOR_API_LOGGER).get(Number(id));
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    } catch (e) { return null; }
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
    writeLog:        writeLogForApiLogger,
    getLogs:         getLogsForApiLogger,
    getLogSummaries: getLogSummariesForApiLogger,
    getLog:          getLogForApiLogger,
    getLogCount:     getLogCountForApiLogger,
    deleteLogs:      deleteLogsForApiLogger,
    clearLogs:       clearLogsForApiLogger
  };

  globalScopeForApiLogger.ABChatContent = nsForApiLogger;
})();
