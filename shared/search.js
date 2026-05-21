(function () {
  var globalScopeForSearch = globalThis;
  var nsForSearch = globalScopeForSearch.ABChatShared || {};

  // One FlexSearch.Document index per content type, keyed by type string.
  var indicesForSearch = {};

  // Field names indexed per type. Keys match record properties.
  var indexConfigsForSearch = {
    chats:     { id: 'id', fields: ['title', 'summary', 'content'] },
    notes:     { id: 'id', fields: ['title', 'body'] },
    tasks:     { id: 'id', fields: ['title', 'body'] },
    questions: { id: 'id', fields: ['questionText'] }
  };

  function makeDocumentIndexForSearch(type) {
    var cfg = indexConfigsForSearch[type];
    if (!cfg) return null;
    var FlexSearch = globalScopeForSearch.FlexSearch;
    if (!FlexSearch || typeof FlexSearch.Document !== 'function') return null;
    try {
      // Matching is prefix-oriented (`tokenize: 'forward'`). `tolerance: 1` lets FlexSearch
      // score matches when indexed text and query differ by roughly one similarity step,
      // so missing or duplicated letters often still hit; swapped or wrong letters often do not.
      return new FlexSearch.Document({
        tokenize: 'forward',
        tolerance: 1,
        document: {
          id: cfg.id,
          index: cfg.fields
        }
      });
    } catch (e) {
      return null;
    }
  }

  function getOrCreateIndexForSearch(type) {
    if (indicesForSearch[type]) return indicesForSearch[type];
    var idx = makeDocumentIndexForSearch(type);
    if (idx) indicesForSearch[type] = idx;
    return idx || null;
  }

  function buildIndexForSearch(type, records) {
    if (!Array.isArray(records) || records.length === 0) return;
    indicesForSearch[type] = null; // reset before rebuild
    var idx = getOrCreateIndexForSearch(type);
    if (!idx) return;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec && rec.id != null) {
        try { idx.add(rec); } catch (e) {}
      }
    }
  }

  function addToIndexForSearch(type, record) {
    if (!record || record.id == null) return;
    var idx = getOrCreateIndexForSearch(type);
    if (!idx) return;
    try { idx.add(record); } catch (e) {}
  }

  function updateInIndexForSearch(type, record) {
    if (!record || record.id == null) return;
    var idx = indicesForSearch[type];
    if (!idx) return;
    try { idx.update(record); } catch (e) {}
  }

  function removeFromIndexForSearch(type, id) {
    var idx = indicesForSearch[type];
    if (!idx) return;
    try { idx.remove(id); } catch (e) {}
  }

  // Returns a deduplicated array of record ids matching the query.
  function searchIndexForSearch(type, query, limit) {
    if (!query || typeof query !== 'string' || !query.trim()) return [];
    var idx = indicesForSearch[type];
    if (!idx) return [];
    var maxResults = (typeof limit === 'number' && limit > 0) ? limit : 100;
    var raw;
    try {
      raw = idx.search(query, { limit: maxResults });
    } catch (e) {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    var seenForSearch = new Set();
    var idsForSearch = [];
    for (var i = 0; i < raw.length; i++) {
      var fieldResult = raw[i];
      if (!fieldResult || !Array.isArray(fieldResult.result)) continue;
      for (var j = 0; j < fieldResult.result.length; j++) {
        var id = fieldResult.result[j];
        if (!seenForSearch.has(id)) {
          seenForSearch.add(id);
          idsForSearch.push(id);
        }
      }
    }
    return idsForSearch;
  }

  nsForSearch.search = {
    buildIndex: buildIndexForSearch,
    addToIndex: addToIndexForSearch,
    updateInIndex: updateInIndexForSearch,
    removeFromIndex: removeFromIndexForSearch,
    search: searchIndexForSearch
  };

  globalScopeForSearch.ABChatShared = nsForSearch;
})();
