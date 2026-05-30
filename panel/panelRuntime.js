(function () {
  const globalScopeForPanelRuntime = globalThis;
  const contentNamespaceForPanelRuntime = globalScopeForPanelRuntime.ABChatContent || {};
  const ic = contentNamespaceForPanelRuntime.icons || {};

  var _exposedAddInputChipForPanelRuntime = null;
  var _exposedSetTabForPanelRuntime = null;
  var _exposedRefreshStoreForPanelRuntime = null;
  // Buffer for refreshStore calls that arrive before the runtime is ready
  // (storage.onChanged and visibilitychange in content/main.js fire as soon
  // as the listener is bound, which can be earlier than panelRuntime.initialize).
  // The set is drained at the end of initialize, so no cross-tab signal is lost
  // during the reload/boot window.
  var _pendingRefreshStoresForPanelRuntime = new Set();
  var _exposedAddImageChipFromContextMenuForPanelRuntime = null;
  var _exposedAddTextChipFromContextMenuForPanelRuntime = null;
  // Relays for cross-tab UI mirroring via panelStateSync.
  var _exposedSetSidebarCollapsedForPanelRuntime = null;
  var _exposedSetNotesSidebarCollapsedForPanelRuntime = null;
  var _exposedSetActiveChatForPanelRuntime = null;
  var _exposedSetActiveNoteForPanelRuntime = null;
  var _exposedSetPickerOpenForPanelRuntime = null;
  var _exposedCloseAttachPreviewForPanelRuntime = null;
  var _exposedSetChatScrollTopForPanelRuntime = null;
  var _exposedSetNoteScrollTopForPanelRuntime = null;
  var _exposedSetPanelModeForPanelRuntime = null;
  var _exposedSetOpenPopoutsForPanelRuntime = null;
  var _exposedSetChatSidebarScrollTopForPanelRuntime = null;
  var _exposedSetNotesSidebarScrollTopForPanelRuntime = null;
  var _exposedSetPanelPositionForPanelRuntime = null;
  var _exposedSetPopoutPositionsForPanelRuntime = null;
  var _exposedReclampPanelPositionForPanelRuntime = null;
  var _exposedHandleRemoteStreamEventForPanelRuntime = null;
  var _exposedHandleRemoteCancelDeliverForPanelRuntime = null;
  var _exposedSetReducedPaneForPanelRuntime = null;
  var _exposedSetChatSubTabForPanelRuntime = null;
  var _exposedSetTaskFilterForPanelRuntime = null;
  var _exposedSetQuizFilterForPanelRuntime = null;
  var _exposedSetChatSearchQueryForPanelRuntime = null;
  var _exposedSetNotesSearchQueryForPanelRuntime = null;
  var _exposedSetTaskSearchQueryForPanelRuntime = null;

  function initializePanelRuntimeForPanel() {
    if (globalScopeForPanelRuntime.__abchatPanelRuntimeInitialized) {
      return;
    }
    // All panel DOM lives inside a shadow root (created by panel.js).
    // Use the shadow root for every internal query so nothing leaks to the host page.
    const panelShadowRootForRuntime =
      contentNamespaceForPanelRuntime.ui && contentNamespaceForPanelRuntime.ui.panelShadowRoot
        ? contentNamespaceForPanelRuntime.ui.panelShadowRoot
        : null;
    if (!panelShadowRootForRuntime || !panelShadowRootForRuntime.getElementById('panel-host')) {
      return;
    }
    const root = panelShadowRootForRuntime;
    globalScopeForPanelRuntime.__abchatPanelRuntimeInitialized = true;

    // Read data from the namespace at initialisation time so it is always
    // current regardless of script injection order or extension re-injection.
    const panelDataNamespaceForRuntime = contentNamespaceForPanelRuntime.data || {};
    const CHAT_DATA = Array.isArray(panelDataNamespaceForRuntime.CHAT_DATA) ? panelDataNamespaceForRuntime.CHAT_DATA : [];
    const NOTE_DATA = Array.isArray(panelDataNamespaceForRuntime.NOTE_DATA) ? panelDataNamespaceForRuntime.NOTE_DATA : [];
    const TASK_DATA = Array.isArray(panelDataNamespaceForRuntime.TASK_DATA) ? panelDataNamespaceForRuntime.TASK_DATA : [];
    const QUIZ_DATA = Array.isArray(panelDataNamespaceForRuntime.QUIZ_DATA) ? panelDataNamespaceForRuntime.QUIZ_DATA : [];
    const NOTE_POPOUT_POSITION_KEY_PREFIX_FOR_PANEL_RUNTIME = 'abchat-note-popout-position-session:';

    function cloneNoteRecordForPanelRuntime(noteForPanelRuntime) {
      const safeNoteForPanelRuntime = noteForPanelRuntime || {};
      const createdAtForPanelRuntime = typeof safeNoteForPanelRuntime.createdAt === 'string' ? safeNoteForPanelRuntime.createdAt : '';
      const updatedAtForPanelRuntime = typeof safeNoteForPanelRuntime.updatedAt === 'string'
        ? safeNoteForPanelRuntime.updatedAt
        : createdAtForPanelRuntime;
      return {
        title: typeof safeNoteForPanelRuntime.title === 'string' ? safeNoteForPanelRuntime.title : '',
        body: typeof safeNoteForPanelRuntime.body === 'string' ? safeNoteForPanelRuntime.body : '',
        tags: Array.isArray(safeNoteForPanelRuntime.tags) ? safeNoteForPanelRuntime.tags.slice() : [],
        attachments: Array.isArray(safeNoteForPanelRuntime.attachments)
          ? safeNoteForPanelRuntime.attachments.map(function(aForClone) {
              var refIdForClone = Number(aForClone.refId);
              return { name: aForClone.name || '', refId: Number.isFinite(refIdForClone) ? refIdForClone : null };
            })
          : [],
        noteType: safeNoteForPanelRuntime.noteType === 'agent' ? 'agent' : 'user',
        sourceChatId: safeNoteForPanelRuntime.sourceChatId != null ? safeNoteForPanelRuntime.sourceChatId : null,
        starred: safeNoteForPanelRuntime.starred === true,
        createdAt: createdAtForPanelRuntime,
        updatedAt: updatedAtForPanelRuntime
      };
    }

    function cloneTaskRecordForPanelRuntime(taskForPanelRuntime) {
      const safeTaskForPanelRuntime = taskForPanelRuntime || {};
      return {
        title: typeof safeTaskForPanelRuntime.title === 'string' ? safeTaskForPanelRuntime.title : '',
        body: typeof safeTaskForPanelRuntime.body === 'string' ? safeTaskForPanelRuntime.body : '',
        dueAt: typeof safeTaskForPanelRuntime.dueAt === 'string' ? safeTaskForPanelRuntime.dueAt : '',
        reminderAt: typeof safeTaskForPanelRuntime.reminderAt === 'string' ? safeTaskForPanelRuntime.reminderAt : '',
        isCompleted: Boolean(safeTaskForPanelRuntime.isCompleted),
        createdAt: typeof safeTaskForPanelRuntime.createdAt === 'string' ? safeTaskForPanelRuntime.createdAt : '',
        updatedAt: typeof safeTaskForPanelRuntime.updatedAt === 'string' ? safeTaskForPanelRuntime.updatedAt : ''
      };
    }

    function cloneQuestionRecordForPanelRuntime(questionForPanelRuntime) {
      const safeQuestionForPanelRuntime = questionForPanelRuntime || {};
      return {
        title: typeof safeQuestionForPanelRuntime.title === 'string' ? safeQuestionForPanelRuntime.title : '',
        questionText: typeof safeQuestionForPanelRuntime.questionText === 'string' ? safeQuestionForPanelRuntime.questionText : '',
        type: safeQuestionForPanelRuntime.type === 'fitb' ? 'fitb' : 'mcq',
        options: Array.isArray(safeQuestionForPanelRuntime.options)
          ? safeQuestionForPanelRuntime.options.map(function (optionForPanelRuntime) {
              return {
                text: String(optionForPanelRuntime && optionForPanelRuntime.text ? optionForPanelRuntime.text : ''),
                isCorrect: Boolean(optionForPanelRuntime && optionForPanelRuntime.isCorrect)
              };
            })
          : [],
        correctAnswer: typeof safeQuestionForPanelRuntime.correctAnswer === 'string' ? safeQuestionForPanelRuntime.correctAnswer : '',
        alternativeAnswers: Array.isArray(safeQuestionForPanelRuntime.alternativeAnswers)
          ? safeQuestionForPanelRuntime.alternativeAnswers.map(function (answerForPanelRuntime) { return String(answerForPanelRuntime || ''); }).filter(Boolean)
          : [],
        caseSensitive: Boolean(safeQuestionForPanelRuntime.caseSensitive),
        explanation: typeof safeQuestionForPanelRuntime.explanation === 'string' ? safeQuestionForPanelRuntime.explanation : '',
        sourceChatId: safeQuestionForPanelRuntime.sourceChatId != null ? safeQuestionForPanelRuntime.sourceChatId : null,
        intervalStage: Number(safeQuestionForPanelRuntime.intervalStage) || 0,
        dueAt: typeof safeQuestionForPanelRuntime.dueAt === 'string' ? safeQuestionForPanelRuntime.dueAt : '',
        isPaused: Boolean(safeQuestionForPanelRuntime.isPaused),
        pausedUntil: typeof safeQuestionForPanelRuntime.pausedUntil === 'string' ? safeQuestionForPanelRuntime.pausedUntil : null,
        createdAt: typeof safeQuestionForPanelRuntime.createdAt === 'string' ? safeQuestionForPanelRuntime.createdAt : '',
        updatedAt: typeof safeQuestionForPanelRuntime.updatedAt === 'string' ? safeQuestionForPanelRuntime.updatedAt : ''
      };
    }

    function getPanelDataRepoForPanelRuntime() {
      return (globalThis.ABChatShared || {}).panelDataRepo || null;
    }

    function getSearchForPanelRuntime() {
      return (globalThis.ABChatShared || {}).search || null;
    }

    async function loadAgentMemoryContextForPanelRuntime() {
      var repoForMemCtx = getPanelDataRepoForPanelRuntime();
      if (!repoForMemCtx || typeof repoForMemCtx.listNotes !== 'function') {
        return { agentMemory: null, agentSkills: [] };
      }
      try {
        var agentNotesForMemCtx = await repoForMemCtx.listNotes('agent');
        var memoryNoteForMemCtx = null;
        var skillNotesForMemCtx = [];
        for (var iForMemCtx = 0; iForMemCtx < agentNotesForMemCtx.length; iForMemCtx++) {
          var noteForMemCtx = agentNotesForMemCtx[iForMemCtx];
          var tagsForMemCtx = Array.isArray(noteForMemCtx.tags) ? noteForMemCtx.tags : [];
          if (!memoryNoteForMemCtx && tagsForMemCtx.indexOf('memory') !== -1 && tagsForMemCtx.indexOf('skills') === -1) {
            memoryNoteForMemCtx = noteForMemCtx;
          } else if (tagsForMemCtx.indexOf('skills') !== -1) {
            var slugForMemCtx = '';
            for (var jForMemCtx = 0; jForMemCtx < tagsForMemCtx.length; jForMemCtx++) {
              if (tagsForMemCtx[jForMemCtx] !== 'skills' && tagsForMemCtx[jForMemCtx] !== 'memory') {
                slugForMemCtx = tagsForMemCtx[jForMemCtx];
                break;
              }
            }
            skillNotesForMemCtx.push({ id: noteForMemCtx.id, title: String(noteForMemCtx.title || ''), slug: slugForMemCtx });
          }
        }
        return {
          agentMemory: memoryNoteForMemCtx ? String(memoryNoteForMemCtx.body || '') : null,
          agentMemoryId: memoryNoteForMemCtx ? memoryNoteForMemCtx.id : null,
          agentSkills: skillNotesForMemCtx
        };
      } catch (errForMemCtx) {
        return { agentMemory: null, agentSkills: [] };
      }
    }

    function getSharedActionsForPanelRuntime() {
      return (globalThis.ABChatShared || {}).actions || {};
    }

    const MAX_ATTACHMENT_BYTES_FOR_PANEL_RUNTIME = 50 * 1024 * 1024;
    const MAX_IMAGE_BYTES_FOR_PANEL_RUNTIME = 20 * 1024 * 1024;
    const MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME = 10;
    const MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME = 5;
    const SUPPORTED_UPLOAD_EXTENSIONS_FOR_PANEL_RUNTIME = [
      'txt', 'md', 'markdown', 'json', 'csv', 'pdf', 'docx', 'xlsx', 'xls', 'ods', 'pptx'
    ];

    function toSearchRecordForPanelRuntime(typeForPanelRuntime, idForPanelRuntime, recordForPanelRuntime) {
      if (!recordForPanelRuntime || idForPanelRuntime == null) return null;
      if (typeForPanelRuntime === 'chats') {
        const messagesForPanelRuntime = Array.isArray(recordForPanelRuntime.messages)
          ? recordForPanelRuntime.messages
          : [];
        const contentForPanelRuntime = messagesForPanelRuntime
          .map(function (messageForPanelRuntime) {
            if (!messageForPanelRuntime || typeof messageForPanelRuntime !== 'object') return '';
            if (messageForPanelRuntime.role === 'tool') return '';
            if (messageForPanelRuntime.role === 'assistant' && Array.isArray(messageForPanelRuntime.tool_calls) && messageForPanelRuntime.tool_calls.length > 0) return '';
            if (typeof messageForPanelRuntime.content === 'string' && messageForPanelRuntime.content.trim()) {
              return messageForPanelRuntime.content;
            }
            if (typeof messageForPanelRuntime.md === 'string' && messageForPanelRuntime.md.trim()) {
              return messageForPanelRuntime.md;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        return {
          id: Number(idForPanelRuntime),
          title: recordForPanelRuntime.title || '',
          summary: recordForPanelRuntime.summary || '',
          content: contentForPanelRuntime
        };
      }
      if (typeForPanelRuntime === 'notes') {
        return {
          id: Number(idForPanelRuntime),
          title: recordForPanelRuntime.title || '',
          body: recordForPanelRuntime.body || ''
        };
      }
      if (typeForPanelRuntime === 'tasks') {
        return {
          id: Number(idForPanelRuntime),
          title: recordForPanelRuntime.title || '',
          body: recordForPanelRuntime.body || ''
        };
      }
      if (typeForPanelRuntime === 'questions') {
        return {
          id: Number(idForPanelRuntime),
          questionText: recordForPanelRuntime.questionText || ''
        };
      }
      return null;
    }

    function syncSearchIndexForPanelRuntime(typeForPanelRuntime, opForPanelRuntime, idForPanelRuntime, recordForPanelRuntime) {
      const searchNsForPanelRuntime = getSearchForPanelRuntime();
      if (!searchNsForPanelRuntime) return;
      if (opForPanelRuntime === 'remove' && typeof searchNsForPanelRuntime.removeFromIndex === 'function') {
        searchNsForPanelRuntime.removeFromIndex(typeForPanelRuntime, Number(idForPanelRuntime));
        return;
      }
      const recordForIndex = toSearchRecordForPanelRuntime(typeForPanelRuntime, idForPanelRuntime, recordForPanelRuntime);
      if (!recordForIndex) return;
      if (opForPanelRuntime === 'add' && typeof searchNsForPanelRuntime.addToIndex === 'function') {
        searchNsForPanelRuntime.addToIndex(typeForPanelRuntime, recordForIndex);
        return;
      }
      if (typeof searchNsForPanelRuntime.updateInIndex === 'function') {
        searchNsForPanelRuntime.updateInIndex(typeForPanelRuntime, recordForIndex);
      }
    }

    const NOTE_STORE_FOR_PANEL_RUNTIME = {};
    const NOTE_ORDER_FOR_PANEL_RUNTIME = [];
    NOTE_DATA.forEach(function(itemForNoteInit) {
      NOTE_STORE_FOR_PANEL_RUNTIME[itemForNoteInit.id] = cloneNoteRecordForPanelRuntime(itemForNoteInit);
      if (itemForNoteInit.noteType !== 'agent') {
        NOTE_ORDER_FOR_PANEL_RUNTIME.push(itemForNoteInit.id);
      }
    });

    function getNoteTimestampMsForPanelRuntime(noteForPanelRuntime) {
      if (!noteForPanelRuntime || typeof noteForPanelRuntime !== 'object') return 0;
      const rawTimestampForPanelRuntime = noteForPanelRuntime.updatedAt || noteForPanelRuntime.createdAt || '';
      if (!rawTimestampForPanelRuntime) return 0;
      const parsedTimestampForPanelRuntime = new Date(rawTimestampForPanelRuntime);
      const parsedMsForPanelRuntime = parsedTimestampForPanelRuntime.getTime();
      return Number.isFinite(parsedMsForPanelRuntime) ? parsedMsForPanelRuntime : 0;
    }

    function sortNoteOrderByUpdatedForPanelRuntime() {
      NOTE_ORDER_FOR_PANEL_RUNTIME.sort(function (aForPanelRuntime, bForPanelRuntime) {
        const noteAForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[aForPanelRuntime];
        const noteBForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[bForPanelRuntime];
        const timeDiffForPanelRuntime = getNoteTimestampMsForPanelRuntime(noteBForPanelRuntime) - getNoteTimestampMsForPanelRuntime(noteAForPanelRuntime);
        if (timeDiffForPanelRuntime !== 0) return timeDiffForPanelRuntime;
        return Number(bForPanelRuntime) - Number(aForPanelRuntime);
      });
    }

    function getTaskTimestampMsForPanelRuntime(taskForPanelRuntime) {
      if (!taskForPanelRuntime || typeof taskForPanelRuntime !== 'object') return 0;
      const rawTimestampForPanelRuntime = taskForPanelRuntime.updatedAt || taskForPanelRuntime.createdAt || '';
      if (!rawTimestampForPanelRuntime) return 0;
      const parsedTimestampForPanelRuntime = new Date(rawTimestampForPanelRuntime);
      const parsedMsForPanelRuntime = parsedTimestampForPanelRuntime.getTime();
      return Number.isFinite(parsedMsForPanelRuntime) ? parsedMsForPanelRuntime : 0;
    }

    function sortTaskOrderByUpdatedForPanelRuntime() {
      TASK_ORDER_FOR_PANEL_RUNTIME.sort(function (aForPanelRuntime, bForPanelRuntime) {
        const taskAForPanelRuntime = TASK_STORE_FOR_PANEL_RUNTIME[aForPanelRuntime];
        const taskBForPanelRuntime = TASK_STORE_FOR_PANEL_RUNTIME[bForPanelRuntime];
        const timeDiffForPanelRuntime = getTaskTimestampMsForPanelRuntime(taskBForPanelRuntime) - getTaskTimestampMsForPanelRuntime(taskAForPanelRuntime);
        if (timeDiffForPanelRuntime !== 0) return timeDiffForPanelRuntime;
        return Number(bForPanelRuntime) - Number(aForPanelRuntime);
      });
    }

    function getQuestionTimestampMsForPanelRuntime(questionForPanelRuntime) {
      if (!questionForPanelRuntime || typeof questionForPanelRuntime !== 'object') return 0;
      const rawTimestampForPanelRuntime = questionForPanelRuntime.updatedAt || questionForPanelRuntime.createdAt || '';
      if (!rawTimestampForPanelRuntime) return 0;
      const parsedTimestampForPanelRuntime = new Date(rawTimestampForPanelRuntime);
      const parsedMsForPanelRuntime = parsedTimestampForPanelRuntime.getTime();
      return Number.isFinite(parsedMsForPanelRuntime) ? parsedMsForPanelRuntime : 0;
    }

    function sortQuizOrderByUpdatedForPanelRuntime() {
      QUIZ_ORDER_FOR_PANEL_RUNTIME.sort(function (aForPanelRuntime, bForPanelRuntime) {
        const quizAForPanelRuntime = QUIZ_STORE_FOR_PANEL_RUNTIME[aForPanelRuntime];
        const quizBForPanelRuntime = QUIZ_STORE_FOR_PANEL_RUNTIME[bForPanelRuntime];
        const timeDiffForPanelRuntime = getQuestionTimestampMsForPanelRuntime(quizBForPanelRuntime) - getQuestionTimestampMsForPanelRuntime(quizAForPanelRuntime);
        if (timeDiffForPanelRuntime !== 0) return timeDiffForPanelRuntime;
        return Number(bForPanelRuntime) - Number(aForPanelRuntime);
      });
    }
    sortNoteOrderByUpdatedForPanelRuntime();
    const NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME = {};
    let notePopoutZIndexForPanelRuntime = 60;

    const TASK_STORE_FOR_PANEL_RUNTIME = {};
    const TASK_ORDER_FOR_PANEL_RUNTIME = [];
    TASK_DATA.forEach(function(itemForTaskInit) {
      TASK_STORE_FOR_PANEL_RUNTIME[itemForTaskInit.id] = cloneTaskRecordForPanelRuntime(itemForTaskInit);
      TASK_ORDER_FOR_PANEL_RUNTIME.push(itemForTaskInit.id);
    });
    sortTaskOrderByUpdatedForPanelRuntime();

    const QUIZ_STORE_FOR_PANEL_RUNTIME = {};
    const QUIZ_ORDER_FOR_PANEL_RUNTIME = [];
    QUIZ_DATA.forEach(function(itemForQuizInit) {
      QUIZ_STORE_FOR_PANEL_RUNTIME[itemForQuizInit.id] = cloneQuestionRecordForPanelRuntime(itemForQuizInit);
      QUIZ_ORDER_FOR_PANEL_RUNTIME.push(itemForQuizInit.id);
    });
    sortQuizOrderByUpdatedForPanelRuntime();

    const CHAT_STORE_FOR_PANEL_RUNTIME = {};
    const CHAT_ORDER_FOR_PANEL_RUNTIME = [];
    // LRU cap for generated image blob data URLs. Each entry can be several MB, so keeping
    // all images unbounded in memory caused OOM on long sessions. The eviction order array
    // (FIFO shift) ensures the oldest entry is dropped when the cap is reached.
    // SCALABILITY: raise the cap only if you also raise the memory budget. Never store blobs
    // directly in CHAT_STORE; always go through setImageBlobCacheForPanelRuntime.
    const GENERATED_IMAGE_BLOB_CACHE_MAX_FOR_PANEL_RUNTIME = 50;
    const GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME = {};
    const GENERATED_IMAGE_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME = [];
    const GENERATED_DOCUMENT_BLOB_CACHE_MAX_FOR_PANEL_RUNTIME = 50;
    const GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME = {};
    const GENERATED_DOCUMENT_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME = [];
    function setImageBlobCacheForPanelRuntime(id, dataUrl) {
      if (GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME[id] !== undefined) return;
      if (GENERATED_IMAGE_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.length >= GENERATED_IMAGE_BLOB_CACHE_MAX_FOR_PANEL_RUNTIME) {
        var evictedId = GENERATED_IMAGE_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.shift();
        delete GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME[evictedId];
      }
      GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME[id] = dataUrl;
      GENERATED_IMAGE_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.push(id);
    }
    function setDocumentBlobCacheForPanelRuntime(id, recordForPanelRuntime) {
      if (GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME[id] !== undefined) return;
      if (GENERATED_DOCUMENT_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.length >= GENERATED_DOCUMENT_BLOB_CACHE_MAX_FOR_PANEL_RUNTIME) {
        var evictedDocIdForPanelRuntime = GENERATED_DOCUMENT_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.shift();
        delete GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME[evictedDocIdForPanelRuntime];
      }
      GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME[id] = {
        dataUrl: String((recordForPanelRuntime && recordForPanelRuntime.dataUrl) || ''),
        name: String((recordForPanelRuntime && recordForPanelRuntime.name) || 'generated-document'),
        mimeType: String((recordForPanelRuntime && recordForPanelRuntime.mimeType) || ''),
        size: Number((recordForPanelRuntime && recordForPanelRuntime.size) || 0) || 0
      };
      GENERATED_DOCUMENT_BLOB_CACHE_ORDER_FOR_PANEL_RUNTIME.push(id);
    }
    // SIDEBAR WINDOWING: only the first SIDEBAR_PAGE_SIZE items are rendered into the DOM at
    // startup. Additional pages are appended by IntersectionObserver sentinels as the user
    // scrolls. This keeps initial DOM size O(1) regardless of how many items are in the DB.
    // SCALABILITY: do not render items directly in loops that iterate the full order array
    // without checking renderedXxxCount; always go through syncMainXxxListItem which enforces
    // the window boundary on new insertions.
    const SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME = 50;
    const PICKER_PAGE_SIZE_FOR_PANEL_RUNTIME = 20;

    // SEARCH INDEX CONTENT LIMIT: full message content is indexed only for the first N chats
    // (by recency). Older chats are indexed by title/summary only. When a chat outside this
    // window is opened, ensureChatMessagesLoadedForPanelRuntime fetches its messages and calls
    // syncSearchIndexForPanelRuntime to update the index entry at that point.
    // SCALABILITY: do not index content for all chats at startup; large corpora would exhaust
    // FlexSearch's in-memory footprint.
    const SEARCH_CONTENT_INDEX_LIMIT_FOR_PANEL_RUNTIME = 100;

    // Track how many items are currently in the DOM for each list. Sentinel callbacks and
    // syncMainXxxListItem use these to decide whether to render an item or skip it.
    // REGRESSION RISK: if you add a new list type, add a matching renderedXxxCount var,
    // decrement it in remove helpers, and increment it in prepend paths.
    var renderedChatCountForPanelRuntime = 0;
    var renderedNoteCountForPanelRuntime = 0;
    var renderedTaskCountForPanelRuntime = 0;
    var renderedQuizCountForPanelRuntime = 0;
    // Picker windowing state. Reset each time renderPickerList is called.
    var pickerRenderedCountForPanelRuntime = 0;
    var pickerCurrentItemsForPanelRuntime = [];
    var pickerCurrentTypeForPanelRuntime = null;
    var pickerObserverForPanelRuntime = null;

    // Set of chat IDs whose messages have been fetched from DB (lazy loading).
    // Startup only loads chat metadata; messages are pulled on first selectChat().
    // SCALABILITY: never pre-populate this set at init time unless the messages are
    // actually loaded; the set is the single source of truth for the lazy-load gate.
    const chatMessagesLoadedSetForPanelRuntime = new Set();

    // IDs that were force-rendered outside the current window solely to satisfy an active
    // search query. They are removed from the DOM and these sets when the query is cleared.
    // REGRESSION RISK: always clear these sets and remove the extra DOM nodes when the
    // search query is emptied; failing to do so leaves phantom DOM items in the sidebar.
    var searchForcedChatIdsForPanelRuntime = new Set();
    var searchForcedNoteIdsForPanelRuntime = new Set();
    var searchForcedTaskIdsForPanelRuntime = new Set();
    var searchForcedQuizIdsForPanelRuntime = new Set();
    CHAT_DATA.forEach(function(srcForStore) {
      const createdAtForStore = typeof srcForStore.createdAt === 'string' ? srcForStore.createdAt : '';
      const updatedAtForStore = typeof srcForStore.updatedAt === 'string' ? srcForStore.updatedAt : createdAtForStore;
      CHAT_STORE_FOR_PANEL_RUNTIME[srcForStore.id] = {
        title:     typeof srcForStore.title     === 'string' ? srcForStore.title     : '',
        summary:   typeof srcForStore.summary   === 'string' ? srcForStore.summary   : '',
        type:      typeof srcForStore.type      === 'string' ? srcForStore.type      : 'chat',
        isPinned:  Boolean(srcForStore.isPinned),
        lastModel: typeof srcForStore.lastModel === 'string' ? srcForStore.lastModel : '',
        compactionSummary: typeof srcForStore.compactionSummary === 'string' ? srcForStore.compactionSummary : '',
        compactedThroughMessageId: srcForStore.compactedThroughMessageId != null ? srcForStore.compactedThroughMessageId : null,
        compactionUpdatedAt: typeof srcForStore.compactionUpdatedAt === 'string' ? srcForStore.compactionUpdatedAt : '',
        sessionCost: 0,
        messages:  Array.isArray(srcForStore.messages) ? srcForStore.messages.map(function(mForStore) { return Object.assign({}, mForStore, { _persistedToDb: true }); }) : [],
        createdAt: createdAtForStore,
        updatedAt: updatedAtForStore
      };
      CHAT_ORDER_FOR_PANEL_RUNTIME.push(srcForStore.id);
    });

    CHAT_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForMessagesCheck) {
      var chatForCheck = CHAT_STORE_FOR_PANEL_RUNTIME[idForMessagesCheck];
      if (chatForCheck && Array.isArray(chatForCheck.messages) && chatForCheck.messages.length > 0) {
        chatMessagesLoadedSetForPanelRuntime.add(Number(idForMessagesCheck));
      }
    });

    function cloneMessageRecordForPanelRuntime(messageForPanelRuntime) {
      const safeMessageForPanelRuntime = messageForPanelRuntime || {};
      return {
        id: Number.isFinite(Number(safeMessageForPanelRuntime.id)) ? Number(safeMessageForPanelRuntime.id) : null,
        chatId: Number.isFinite(Number(safeMessageForPanelRuntime.chatId)) ? Number(safeMessageForPanelRuntime.chatId) : null,
        role: typeof safeMessageForPanelRuntime.role === 'string' ? safeMessageForPanelRuntime.role : 'user',
        content: typeof safeMessageForPanelRuntime.content === 'string' ? safeMessageForPanelRuntime.content : '',
        md: typeof safeMessageForPanelRuntime.md === 'string' ? safeMessageForPanelRuntime.md : '',
        chips: Array.isArray(safeMessageForPanelRuntime.chips)
          ? safeMessageForPanelRuntime.chips.map(function (chipForPanelRuntime) {
              const parsedRefIdForPanelRuntime = Number((chipForPanelRuntime && chipForPanelRuntime.refId) || null);
              return {
                type: String((chipForPanelRuntime && chipForPanelRuntime.type) || ''),
                label: String((chipForPanelRuntime && chipForPanelRuntime.label) || ''),
                content: String((chipForPanelRuntime && chipForPanelRuntime.content) || ''),
                mimeType: String((chipForPanelRuntime && chipForPanelRuntime.mimeType) || ''),
                refId: Number.isFinite(parsedRefIdForPanelRuntime) ? parsedRefIdForPanelRuntime : null,
                size: Number.isFinite(Number(chipForPanelRuntime && chipForPanelRuntime.size))
                  ? Number(chipForPanelRuntime.size)
                  : 0,
                kind: String((chipForPanelRuntime && chipForPanelRuntime.kind) || ''),
                pageUrl: String((chipForPanelRuntime && chipForPanelRuntime.pageUrl) || ''),
                pageTitle: String((chipForPanelRuntime && chipForPanelRuntime.pageTitle) || ''),
                elementSelector: String((chipForPanelRuntime && chipForPanelRuntime.elementSelector) || ''),
                htmlFormat: String((chipForPanelRuntime && chipForPanelRuntime.htmlFormat) || '')
              };
            }).filter(function (chipForPanelRuntime) {
              return chipForPanelRuntime.type && chipForPanelRuntime.label;
            })
          : [],
        tool_calls: Array.isArray(safeMessageForPanelRuntime.tool_calls) ? safeMessageForPanelRuntime.tool_calls : undefined,
        tool_call_id: safeMessageForPanelRuntime.tool_call_id != null ? String(safeMessageForPanelRuntime.tool_call_id) : undefined,
        isHidden: Boolean(safeMessageForPanelRuntime.isHidden),
        usagePromptTokens: Number.isFinite(Number(safeMessageForPanelRuntime.usagePromptTokens)) ? Number(safeMessageForPanelRuntime.usagePromptTokens) : 0,
        usageCompletionTokens: Number.isFinite(Number(safeMessageForPanelRuntime.usageCompletionTokens)) ? Number(safeMessageForPanelRuntime.usageCompletionTokens) : 0,
        usageTotalTokens: Number.isFinite(Number(safeMessageForPanelRuntime.usageTotalTokens)) ? Number(safeMessageForPanelRuntime.usageTotalTokens) : 0,
        usageReasoningTokens: Number.isFinite(Number(safeMessageForPanelRuntime.usageReasoningTokens)) ? Number(safeMessageForPanelRuntime.usageReasoningTokens) : 0,
        usageCost: Number.isFinite(Number(safeMessageForPanelRuntime.usageCost)) ? Number(safeMessageForPanelRuntime.usageCost) : 0,
        searchSources: Array.isArray(safeMessageForPanelRuntime.searchSources)
          ? safeMessageForPanelRuntime.searchSources.map(function(s) {
              return { url: String((s && s.url) || ''), title: String((s && s.title) || '') };
            }).filter(function(s) { return Boolean(s.url); })
          : [],
        incomplete: Boolean(safeMessageForPanelRuntime.incomplete),
        createdAt: typeof safeMessageForPanelRuntime.createdAt === 'string' ? safeMessageForPanelRuntime.createdAt : '',
        _persistedToDb: safeMessageForPanelRuntime._persistedToDb === false ? false : true
      };
    }

    function getChatSummaryFromTextForPanelRuntime(textForPanelRuntime) {
      const summaryTextForPanelRuntime = String(textForPanelRuntime || '').trim();
      if (!summaryTextForPanelRuntime) return '';
      return summaryTextForPanelRuntime.length > 140
        ? summaryTextForPanelRuntime.slice(0, 137) + '...'
        : summaryTextForPanelRuntime;
    }

    function getChatSummaryFromMessagesForPanelRuntime(messagesForPanelRuntime) {
      if (!Array.isArray(messagesForPanelRuntime)) return '';
      for (let messageIndexForPanelRuntime = 0; messageIndexForPanelRuntime < messagesForPanelRuntime.length; messageIndexForPanelRuntime++) {
        const messageForPanelRuntime = messagesForPanelRuntime[messageIndexForPanelRuntime];
        if (!messageForPanelRuntime || messageForPanelRuntime.role !== 'user') continue;
        const messageTextForPanelRuntime = (messageForPanelRuntime.content || messageForPanelRuntime.md || '').trim();
        if (!messageTextForPanelRuntime) continue;
        return getChatSummaryFromTextForPanelRuntime(messageTextForPanelRuntime);
      }
      return '';
    }

    function cloneChatRecordForPanelRuntime(chatForPanelRuntime) {
      const safeChatForPanelRuntime = chatForPanelRuntime || {};
      const messagesForPanelRuntime = Array.isArray(safeChatForPanelRuntime.messages)
        ? safeChatForPanelRuntime.messages.map(cloneMessageRecordForPanelRuntime)
        : [];
      const createdAtForPanelRuntime = typeof safeChatForPanelRuntime.createdAt === 'string'
        ? safeChatForPanelRuntime.createdAt
        : new Date().toISOString();
      const updatedAtForPanelRuntime = typeof safeChatForPanelRuntime.updatedAt === 'string'
        ? safeChatForPanelRuntime.updatedAt
        : createdAtForPanelRuntime;
      const summaryForPanelRuntime = typeof safeChatForPanelRuntime.summary === 'string'
        ? safeChatForPanelRuntime.summary
        : getChatSummaryFromMessagesForPanelRuntime(messagesForPanelRuntime);
      return {
        title: typeof safeChatForPanelRuntime.title === 'string' ? safeChatForPanelRuntime.title : '',
        summary: summaryForPanelRuntime,
        type: safeChatForPanelRuntime.type === 'quickq' ? 'quickq' : 'chat',
        isPinned: Boolean(safeChatForPanelRuntime.isPinned),
        hasCustomTitle: Boolean(safeChatForPanelRuntime.hasCustomTitle),
        messages: messagesForPanelRuntime,
        createdAt: createdAtForPanelRuntime,
        updatedAt: updatedAtForPanelRuntime,
        lastModel: typeof safeChatForPanelRuntime.lastModel === 'string' ? safeChatForPanelRuntime.lastModel : '',
        compactionSummary: typeof safeChatForPanelRuntime.compactionSummary === 'string' ? safeChatForPanelRuntime.compactionSummary : '',
        compactedThroughMessageId: safeChatForPanelRuntime.compactedThroughMessageId != null
          ? safeChatForPanelRuntime.compactedThroughMessageId
          : null,
        compactionUpdatedAt: typeof safeChatForPanelRuntime.compactionUpdatedAt === 'string' ? safeChatForPanelRuntime.compactionUpdatedAt : '',
        sessionCost: typeof safeChatForPanelRuntime.sessionCost === 'number' ? safeChatForPanelRuntime.sessionCost : 0
      };
    }

    function applyPersistedChatToRuntimeStoreForPanelRuntime(chatIdForPanelRuntime, chatForPanelRuntime, prependForPanelRuntime) {
      if (!Number.isFinite(Number(chatIdForPanelRuntime)) || !chatForPanelRuntime) return;
      const numericChatIdForPanelRuntime = Number(chatIdForPanelRuntime);
      const existingChatForApply = CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime];
      const pendingMsgsForApply = existingChatForApply && Array.isArray(existingChatForApply.messages)
        ? existingChatForApply.messages.filter(function (mForApply) {
            return mForApply && mForApply._persistedToDb === false;
          })
        : [];
      CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime] = cloneChatRecordForPanelRuntime(chatForPanelRuntime);
      if (pendingMsgsForApply.length > 0) {
        Array.prototype.push.apply(CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime].messages, pendingMsgsForApply);
        CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime].summary = getChatSummaryFromMessagesForPanelRuntime(
          CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime].messages
        );
      }
      const existingIndexForPanelRuntime = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(numericChatIdForPanelRuntime);
      if (existingIndexForPanelRuntime >= 0) {
        CHAT_ORDER_FOR_PANEL_RUNTIME.splice(existingIndexForPanelRuntime, 1);
      }
      if (prependForPanelRuntime) {
        CHAT_ORDER_FOR_PANEL_RUNTIME.unshift(numericChatIdForPanelRuntime);
        return;
      }
      if (existingIndexForPanelRuntime >= 0 && existingIndexForPanelRuntime <= CHAT_ORDER_FOR_PANEL_RUNTIME.length) {
        CHAT_ORDER_FOR_PANEL_RUNTIME.splice(existingIndexForPanelRuntime, 0, numericChatIdForPanelRuntime);
      } else {
        CHAT_ORDER_FOR_PANEL_RUNTIME.push(numericChatIdForPanelRuntime);
      }
      chatMessagesLoadedSetForPanelRuntime.add(numericChatIdForPanelRuntime);
    }

    function removeChatFromRuntimeStoreForPanelRuntime(chatIdForPanelRuntime) {
      if (!Number.isFinite(Number(chatIdForPanelRuntime))) return;
      const numericChatIdForPanelRuntime = Number(chatIdForPanelRuntime);
      delete CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime];
      const existingIndexForPanelRuntime = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(numericChatIdForPanelRuntime);
      if (existingIndexForPanelRuntime >= 0) {
        if (existingIndexForPanelRuntime < renderedChatCountForPanelRuntime && renderedChatCountForPanelRuntime > 0) {
          renderedChatCountForPanelRuntime--;
        }
        CHAT_ORDER_FOR_PANEL_RUNTIME.splice(existingIndexForPanelRuntime, 1);
      }
      chatMessagesLoadedSetForPanelRuntime.delete(numericChatIdForPanelRuntime);
      if (liveTurnBubblesForPanelRuntime.has(numericChatIdForPanelRuntime)) {
        doRemoveLiveBubbleForPanelRuntime(numericChatIdForPanelRuntime);
      }
    }

    function upsertChatUiForPanelRuntime(chatIdForPanelRuntime, prependForPanelRuntime) {
      syncMainChatListItemForPanelRuntime(chatIdForPanelRuntime, prependForPanelRuntime);
      rebuildChatListGroupingForPanelRuntime();
      syncSearchIndexForPanelRuntime('chats', 'update', chatIdForPanelRuntime, CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime]);
    }

    function refreshChatStoreFromPersistedForPanelRuntime(chatForPanelRuntime, optionsForPanelRuntime) {
      if (!chatForPanelRuntime || !Number.isFinite(Number(chatForPanelRuntime.id))) return null;
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      const chatIdForPanelRuntime = Number(chatForPanelRuntime.id);
      applyPersistedChatToRuntimeStoreForPanelRuntime(chatIdForPanelRuntime, chatForPanelRuntime, Boolean(optsForPanelRuntime.prepend));
      upsertChatUiForPanelRuntime(chatIdForPanelRuntime, Boolean(optsForPanelRuntime.prepend));
      return chatIdForPanelRuntime;
    }

    function removeChatUiForPanelRuntime(chatIdForPanelRuntime) {
      const chatItemForPanelRuntime = root.querySelector(`.chat-item[data-chat-id="${chatIdForPanelRuntime}"]`);
      if (chatItemForPanelRuntime && chatItemForPanelRuntime.parentNode) {
        chatItemForPanelRuntime.parentNode.removeChild(chatItemForPanelRuntime);
      }
      rebuildChatListGroupingForPanelRuntime();
      syncSearchIndexForPanelRuntime('chats', 'remove', chatIdForPanelRuntime);
    }

    function isNotePoppedOutForPanelRuntime(noteIdForPanelRuntime) {
      return Boolean(noteIdForPanelRuntime && NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime]);
    }

    function getChatTimestampForPanelRuntime(chatForPanelRuntime) {
      if (!chatForPanelRuntime || typeof chatForPanelRuntime !== 'object') return null;
      const rawTimestampForPanelRuntime = chatForPanelRuntime.updatedAt || chatForPanelRuntime.createdAt || '';
      if (!rawTimestampForPanelRuntime) return null;
      const parsedTimestampForPanelRuntime = new Date(rawTimestampForPanelRuntime);
      if (isNaN(parsedTimestampForPanelRuntime.getTime())) return null;
      return parsedTimestampForPanelRuntime;
    }

    function getStartOfDayForPanelRuntime(dateForPanelRuntime) {
      if (!(dateForPanelRuntime instanceof Date) || isNaN(dateForPanelRuntime.getTime())) return null;
      return new Date(
        dateForPanelRuntime.getFullYear(),
        dateForPanelRuntime.getMonth(),
        dateForPanelRuntime.getDate()
      );
    }

    function formatNoteUpdatedLabelForPanelRuntime(noteForPanelRuntime) {
      const timestampMsForPanelRuntime = getNoteTimestampMsForPanelRuntime(noteForPanelRuntime);
      if (!timestampMsForPanelRuntime) return '';
      const nowMsForPanelRuntime = Date.now();
      const elapsedMsForPanelRuntime = Math.max(0, nowMsForPanelRuntime - timestampMsForPanelRuntime);
      const minuteMsForPanelRuntime = 60 * 1000;
      const hourMsForPanelRuntime = 60 * minuteMsForPanelRuntime;
      const dayMsForPanelRuntime = 24 * hourMsForPanelRuntime;

      if (elapsedMsForPanelRuntime < minuteMsForPanelRuntime) return 'Just now';
      if (elapsedMsForPanelRuntime < hourMsForPanelRuntime) {
        return Math.floor(elapsedMsForPanelRuntime / minuteMsForPanelRuntime) + 'm ago';
      }
      if (elapsedMsForPanelRuntime < dayMsForPanelRuntime) {
        return Math.floor(elapsedMsForPanelRuntime / hourMsForPanelRuntime) + 'h ago';
      }

      const noteDateForPanelRuntime = new Date(timestampMsForPanelRuntime);
      const noteStartForPanelRuntime = getStartOfDayForPanelRuntime(noteDateForPanelRuntime);
      const todayStartForPanelRuntime = getStartOfDayForPanelRuntime(new Date());
      if (noteStartForPanelRuntime && todayStartForPanelRuntime) {
        const dayDiffForPanelRuntime = Math.round((todayStartForPanelRuntime - noteStartForPanelRuntime) / dayMsForPanelRuntime);
        if (dayDiffForPanelRuntime === 1) return 'Yesterday';
      }

      const dateOptionsForPanelRuntime = noteDateForPanelRuntime.getFullYear() === new Date().getFullYear()
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' };
      return noteDateForPanelRuntime.toLocaleDateString('en-US', dateOptionsForPanelRuntime);
    }

    function getChatGroupLabelByDateForPanelRuntime(chatForPanelRuntime) {
      const chatTimestampForPanelRuntime = getChatTimestampForPanelRuntime(chatForPanelRuntime);
      if (!chatTimestampForPanelRuntime) return 'Older';
      const chatDayStartForPanelRuntime = getStartOfDayForPanelRuntime(chatTimestampForPanelRuntime);
      const todayStartForPanelRuntime = getStartOfDayForPanelRuntime(new Date());
      if (!chatDayStartForPanelRuntime || !todayStartForPanelRuntime) return 'Older';
      const diffDaysForPanelRuntime = Math.round(
        (todayStartForPanelRuntime - chatDayStartForPanelRuntime) / (1000 * 60 * 60 * 24)
      );
      if (diffDaysForPanelRuntime <= 0) return 'Today';
      if (diffDaysForPanelRuntime === 1) return 'Yesterday';
      if (diffDaysForPanelRuntime < 7) return 'This week';
      return 'Older';
    }

    /* ============================================================
      STATE
    ============================================================ */
    const S = {
      theme: 'light',
      mode: 'reduced',
      tab: 'chats',
      sidebarCollapsed: false,
      notesSidebarCollapsed: false,
      inChatView: false,
      inNoteView: false,
      chatEditingMsgId: null,
      activeChatId: null,
      activeNoteId: null,
      activeTaskId: null,
      handoffNoteId: null,
      hiddenPairIds: new Set(),
      pickerMode: null, // 'note' | 'chat'
      chatType: 'chats', // 'chats' | 'quickq'
      taskFilter: 'all', // 'all' | 'pending' | 'completed'
      quizFilter: 'all', // 'all' | 'due' | 'paused'
      // Reduced-view pane state per main tab. Tracks user navigation intent
      // (open record / back-to-list) so the right pane is restored when the
      // user re-enters a tab in reduced view or another tab mirrors this one.
      paneChats: 'list',     // 'list' | 'detail'
      paneNotes: 'list',     // 'list' | 'detail'
      paneTasks: 'list',     // 'list' | 'detail'
      paneQuestions: 'list', // 'list' | 'detail'
      inlineMessages: [],
      inlineWaiting: false,
      inlineChatId: null,
      pickerTabs: []
    };
    // -------------------------------------------------------------------
    // Cross-tab live chat streaming broadcast (streaming text + live bubble).
    //
    // The originating tab emits stream events here; the SW relays each event
    // to every other tab, where receivers drive a mirrored live bubble using
    // the same liveTurnBubblesForPanelRuntime machinery as the originator.
    //
    // remoteStreamingChatsForPanelRuntime tracks chats whose live bubble on
    // THIS tab is being driven by remote events (not a local sendChat).
    // Used to dedupe, distinguish from local sends, and tear down on end.
    //
    // textDebounceTimersForStreamBroadcast: per-chat debounce timer. Text
    // deltas in a fast stream can arrive dozens of times per second; we
    // collapse to at most one broadcast per ~120ms with a final flush on
    // stream_end so the last token batch isn't lost.
    // -------------------------------------------------------------------
    const remoteStreamingChatsForPanelRuntime = new Set();
    const textDebounceTimersForStreamBroadcast = new Map();
    const textPendingAccForStreamBroadcast = new Map();
    const STREAM_TEXT_DEBOUNCE_MS_FOR_PANEL_RUNTIME = 120;

    function broadcastStreamEventForPanelRuntime(eventForBroadcast, chatIdForBroadcast, payloadForBroadcast) {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      try {
        chrome.runtime.sendMessage({
          action: "streamOriginatorBroadcast",
          event: eventForBroadcast,
          chatId: Number(chatIdForBroadcast),
          payload: payloadForBroadcast || null
        }, function () {
          // Fire-and-forget; ignore any lastError so no console noise.
          void chrome.runtime.lastError;
        });
      } catch (errorForBroadcast) {}
    }

    function broadcastStreamTextDebouncedForPanelRuntime(chatIdForDebounce, accTextForDebounce) {
      textPendingAccForStreamBroadcast.set(chatIdForDebounce, accTextForDebounce);
      if (textDebounceTimersForStreamBroadcast.has(chatIdForDebounce)) return;
      const timerForDebounce = setTimeout(function flushBroadcastTextForPanelRuntime() {
        textDebounceTimersForStreamBroadcast.delete(chatIdForDebounce);
        const finalAccForDebounce = textPendingAccForStreamBroadcast.get(chatIdForDebounce);
        textPendingAccForStreamBroadcast.delete(chatIdForDebounce);
        if (typeof finalAccForDebounce === "string") {
          broadcastStreamEventForPanelRuntime("stream_text", chatIdForDebounce, { accText: finalAccForDebounce });
        }
      }, STREAM_TEXT_DEBOUNCE_MS_FOR_PANEL_RUNTIME);
      textDebounceTimersForStreamBroadcast.set(chatIdForDebounce, timerForDebounce);
    }

    function flushStreamTextBroadcastForPanelRuntime(chatIdForFlush) {
      const timerForFlush = textDebounceTimersForStreamBroadcast.get(chatIdForFlush);
      if (timerForFlush) {
        clearTimeout(timerForFlush);
        textDebounceTimersForStreamBroadcast.delete(chatIdForFlush);
      }
      const pendingAccForFlush = textPendingAccForStreamBroadcast.get(chatIdForFlush);
      textPendingAccForStreamBroadcast.delete(chatIdForFlush);
      if (typeof pendingAccForFlush === "string") {
        broadcastStreamEventForPanelRuntime("stream_text", chatIdForFlush, { accText: pendingAccForFlush });
      }
    }

    // Ensure the receiver has a live bubble for the given chat. Idempotent.
    // Used by all bubble-mutating events (text, tool_steps, etc.) so they can
    // be applied even if they arrive before / between stream_start handling.
    // Also keeps the send/cancel button in sync when transitioning into the
    // remote-streaming state.
    function ensureRemoteBubbleForPanelRuntime(numericChatIdForEnsure) {
      const wasRemoteStreamingForEnsure = remoteStreamingChatsForPanelRuntime.has(numericChatIdForEnsure);
      remoteStreamingChatsForPanelRuntime.add(numericChatIdForEnsure);
      if (
        S.activeChatId === numericChatIdForEnsure &&
        !liveTurnBubblesForPanelRuntime.has(numericChatIdForEnsure)
      ) {
        createLiveTurnBubbleForPanelRuntime(numericChatIdForEnsure);
      }
      // Flip the send button to a cancel button on first entering the
      // remote-stream state for the active chat.
      if (!wasRemoteStreamingForEnsure && S.activeChatId === numericChatIdForEnsure) {
        setSendingUIStateForPanelRuntime();
      }
    }

    // Catch-up: ask the SW whether the given chat is mid-stream on another
    // tab, and if so apply the snapshot (build the bubble, restore accumulated
    // text, tool chips with their current statuses, and any active retry
    // notice). Idempotent — no-op if a live bubble already exists locally
    // (which is the normal case: either we are the originator, or stream_start
    // already created our receiver bubble).
    function requestAndApplyStreamSnapshotForPanelRuntime(chatIdForSnapshot) {
      const numericChatIdForSnapshot = Number(chatIdForSnapshot);
      if (!Number.isFinite(numericChatIdForSnapshot)) return;
      // Bubble already exists locally — no catch-up needed.
      if (liveTurnBubblesForPanelRuntime.has(numericChatIdForSnapshot)) return;
      // We are the originator — no catch-up needed.
      if (sendingChatsForPanelRuntime.has(numericChatIdForSnapshot)) return;
      try {
        chrome.runtime.sendMessage(
          { action: "streamSnapshotRequest", chatId: numericChatIdForSnapshot },
          function (responseForSnapshot) {
            void chrome.runtime.lastError;
            if (!responseForSnapshot || !responseForSnapshot.ok || !responseForSnapshot.snapshot) return;
            const snapshotForApply = responseForSnapshot.snapshot;
            // Re-check before applying: state may have changed between the
            // request and the response (chat switched away, originator
            // finished, etc.).
            if (S.activeChatId !== numericChatIdForSnapshot) return;
            if (liveTurnBubblesForPanelRuntime.has(numericChatIdForSnapshot)) return;
            if (sendingChatsForPanelRuntime.has(numericChatIdForSnapshot)) return;

            ensureRemoteBubbleForPanelRuntime(numericChatIdForSnapshot);
            // Replay tool steps (if any) before text so the chip row sits
            // above the streaming text just like a live run.
            if (Array.isArray(snapshotForApply.toolCalls) && snapshotForApply.toolCalls.length > 0) {
              addLiveTurnToolStepsForPanelRuntime(numericChatIdForSnapshot, snapshotForApply.toolCalls);
              const statusesForApply = snapshotForApply.toolStatuses || {};
              Object.keys(statusesForApply).forEach(function (tcIdForApply) {
                const statusEntryForApply = statusesForApply[tcIdForApply];
                if (!statusEntryForApply) return;
                updateLiveTurnToolStepStatusForPanelRuntime(
                  numericChatIdForSnapshot,
                  tcIdForApply,
                  statusEntryForApply.status,
                  statusEntryForApply.statusText || ""
                );
              });
            }
            if (typeof snapshotForApply.accText === "string" && snapshotForApply.accText.length > 0) {
              updateLiveTurnTextForPanelRuntime(numericChatIdForSnapshot, snapshotForApply.accText);
            }
            if (snapshotForApply.retryNotice &&
                Number.isFinite(snapshotForApply.retryNotice.attempt) &&
                Number.isFinite(snapshotForApply.retryNotice.maxAttempts)) {
              applyLiveTurnRetryNoticeForPanelRuntime(
                numericChatIdForSnapshot,
                snapshotForApply.retryNotice.attempt,
                snapshotForApply.retryNotice.maxAttempts
              );
            }
          }
        );
      } catch (errorForSnapshotRequest) {}
    }

    function handleRemoteStreamEventForPanelRuntime(eventForRemote, chatIdForRemote, payloadForRemote) {
      const numericChatIdForRemote = Number(chatIdForRemote);
      if (!Number.isFinite(numericChatIdForRemote)) return;
      // If this tab is itself the originator for this chat, ignore — the SW
      // already excludes the sender, but belt-and-suspenders.
      if (sendingChatsForPanelRuntime.has(numericChatIdForRemote)) return;

      if (eventForRemote === "stream_start") {
        // Force an immediate chat-store refresh so the user message the
        // originator just persisted lands on screen BEFORE the live bubble
        // appears below it. We can't rely on the dbDataChanged 250ms debounce
        // — the first text delta may arrive sooner than that.
        //
        // We deliberately do NOT mark the chat as remoteStreaming yet: if we
        // did, the render guard in executeStoreRefresh would skip the render
        // and the user message would never appear until stream_end. The flag
        // is set in the .then() below (and also lazily by ensureRemoteBubble
        // when a content-bearing event races ahead of the refresh).
        Promise.resolve(executeStoreRefreshForPanelRuntime("chats")).catch(function () {
          // Refresh errors are non-fatal; the bubble still appears below.
        }).then(function () {
          ensureRemoteBubbleForPanelRuntime(numericChatIdForRemote);
        });
        return;
      }

      if (eventForRemote === "stream_text") {
        ensureRemoteBubbleForPanelRuntime(numericChatIdForRemote);
        const accTextForRemote = payloadForRemote && typeof payloadForRemote.accText === "string"
          ? payloadForRemote.accText
          : "";
        if (S.activeChatId === numericChatIdForRemote) {
          updateLiveTurnTextForPanelRuntime(numericChatIdForRemote, accTextForRemote);
        }
        return;
      }

      if (eventForRemote === "stream_retry_notice") {
        if (!remoteStreamingChatsForPanelRuntime.has(numericChatIdForRemote)) return;
        if (S.activeChatId !== numericChatIdForRemote) return;
        const attemptForRetryRemote = payloadForRemote && Number(payloadForRemote.attempt);
        const maxAttemptsForRetryRemote = payloadForRemote && Number(payloadForRemote.maxAttempts);
        if (Number.isFinite(attemptForRetryRemote) && Number.isFinite(maxAttemptsForRetryRemote)) {
          applyLiveTurnRetryNoticeForPanelRuntime(
            numericChatIdForRemote,
            attemptForRetryRemote,
            maxAttemptsForRetryRemote
          );
        }
        return;
      }

      if (eventForRemote === "stream_tool_steps") {
        ensureRemoteBubbleForPanelRuntime(numericChatIdForRemote);
        if (S.activeChatId !== numericChatIdForRemote) return;
        const toolCallsForRemote = payloadForRemote && Array.isArray(payloadForRemote.toolCalls)
          ? payloadForRemote.toolCalls
          : null;
        if (toolCallsForRemote && toolCallsForRemote.length > 0) {
          addLiveTurnToolStepsForPanelRuntime(numericChatIdForRemote, toolCallsForRemote);
        }
        return;
      }

      if (eventForRemote === "stream_tool_step_status") {
        if (!remoteStreamingChatsForPanelRuntime.has(numericChatIdForRemote)) return;
        if (S.activeChatId !== numericChatIdForRemote) return;
        const toolCallIdForRemote = payloadForRemote && payloadForRemote.toolCallId;
        const statusForRemote = payloadForRemote && payloadForRemote.status;
        const statusTextForRemote = payloadForRemote && payloadForRemote.statusText;
        if (toolCallIdForRemote && statusForRemote) {
          updateLiveTurnToolStepStatusForPanelRuntime(
            numericChatIdForRemote,
            toolCallIdForRemote,
            statusForRemote,
            statusTextForRemote || ''
          );
        }
        return;
      }

      if (eventForRemote === "stream_message_persisted") {
        // No-op during an active remote stream — the active-chat render is
        // suppressed by the remoteStreaming guard, so triggering a refresh
        // here would only update the sidebar (and pull fresh DB messages
        // into the in-memory store, which is fine but not necessary). The
        // stream_end handler triggers the authoritative final refresh.
        return;
      }

      if (eventForRemote === "stream_end") {
        if (!remoteStreamingChatsForPanelRuntime.has(numericChatIdForRemote)) return;
        remoteStreamingChatsForPanelRuntime.delete(numericChatIdForRemote);
        // Flip the cancel button back to a send button on the active chat.
        if (S.activeChatId === numericChatIdForRemote) {
          setSendingUIStateForPanelRuntime();
        }
        removeLiveTurnBubbleForPanelRuntime(numericChatIdForRemote, true);
        // Refresh from the DB so the persisted final assistant message
        // replaces the transient bubble. The guard is now off, so the active
        // chat will re-render.
        scheduleStoreRefreshForPanelRuntime("chats");
        return;
      }
    }

    // Cross-tab UI state sync. Writes here flow to chrome.storage.local and
    // back to other tabs via panelStateSync's storage.onChanged listener.
    // When that listener applies an incoming change locally, it sets an internal
    // guard so writeState() becomes a no-op for the duration of the apply —
    // no need to add manual guards at each call site.
    function writePanelStateSyncForPanelRuntime(partialForPanelRuntime) {
      const syncNsForPanelRuntime =
        globalThis.ABChatContent &&
        globalThis.ABChatContent.ui &&
        globalThis.ABChatContent.ui.panelStateSync;
      if (syncNsForPanelRuntime && typeof syncNsForPanelRuntime.writeState === 'function') {
        syncNsForPanelRuntime.writeState(partialForPanelRuntime);
      }
    }

    /* ============================================================
      REDUCED-VIEW PANE STATE
      Pane = 'list' | 'detail' per main tab. Updates S.pane<Tab>, syncs the
      field, and (if this tab is the visible main tab and mode is reduced)
      toggles the `in-*` class on the view container so the right pane is
      visible immediately. setMode does NOT call this; mode switches read the
      stored values to decide what to show.
    ============================================================ */
    const PANE_VIEW_CLASS_MAP_FOR_PANEL_RUNTIME = {
      chats: { viewId: 'view-chats', cls: 'in-chat', field: 'paneChats', stateKey: 'paneChats' },
      notes: { viewId: 'view-notes', cls: 'in-editor', field: 'paneNotes', stateKey: 'paneNotes' },
      tasks: { viewId: 'view-tasks', cls: 'in-editor', field: 'paneTasks', stateKey: 'paneTasks' },
      questions: { viewId: 'view-quiz', cls: 'in-editor', field: 'paneQuestions', stateKey: 'paneQuestions' }
    };

    function canShowDetailForTabForPanelRuntime(tabNameForPane) {
      // 1c fallback: 'detail' only renders if the corresponding active record
      // resolves. For chats, an empty new-chat is a valid 'detail' state, so
      // we don't gate on activeChatId.
      if (tabNameForPane === 'chats') return true;
      if (tabNameForPane === 'notes') {
        // A new (unsaved) note has no activeNoteId yet but the editor form is
        // visible — treat that as detail so the reduced-view pane switches.
        const noteFormForCheck = root.getElementById('note-editor-form');
        const noteFormOpenForCheck = noteFormForCheck && !noteFormForCheck.classList.contains('hidden');
        if (noteFormOpenForCheck) return true;
        return S.activeNoteId != null && Boolean(NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId]);
      }
      if (tabNameForPane === 'tasks') {
        // Active task may be null (composing a new task), which is still detail.
        const formForCheck = root.getElementById('task-editor-form');
        const formOpenForCheck = formForCheck && !formForCheck.classList.contains('hidden');
        if (formOpenForCheck) return true;
        return S.activeTaskId != null && Boolean(TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId]);
      }
      if (tabNameForPane === 'questions') {
        const editorOpenForCheck = root.getElementById('quiz-editor-form');
        const answerOpenForCheck = root.getElementById('quiz-answer-view');
        const formVisible =
          (editorOpenForCheck && !editorOpenForCheck.classList.contains('hidden')) ||
          (answerOpenForCheck && !answerOpenForCheck.classList.contains('hidden'));
        if (formVisible) return true;
        return QS && QS.activeQid != null && Boolean(QUIZ_STORE_FOR_PANEL_RUNTIME[QS.activeQid]);
      }
      return false;
    }

    function applyPaneClassForTabForPanelRuntime(tabNameForPane, paneValueForPane) {
      const cfgForPane = PANE_VIEW_CLASS_MAP_FOR_PANEL_RUNTIME[tabNameForPane];
      if (!cfgForPane) return;
      if (S.mode !== 'reduced') return;
      const viewElForPane = root.getElementById(cfgForPane.viewId);
      if (!viewElForPane) return;
      const resolvedPaneForApply =
        paneValueForPane === 'detail' && canShowDetailForTabForPanelRuntime(tabNameForPane)
          ? 'detail'
          : 'list';
      if (resolvedPaneForApply === 'detail') {
        viewElForPane.classList.add(cfgForPane.cls);
      } else {
        viewElForPane.classList.remove(cfgForPane.cls);
      }
    }

    function setReducedPaneForPanelRuntime(tabNameForPane, paneValueForPane, optionsForPane) {
      const cfgForPane = PANE_VIEW_CLASS_MAP_FOR_PANEL_RUNTIME[tabNameForPane];
      if (!cfgForPane) return;
      const normalizedPaneForSet = paneValueForPane === 'detail' ? 'detail' : 'list';
      const optsForSetPane = optionsForPane || {};
      S[cfgForPane.stateKey] = normalizedPaneForSet;
      applyPaneClassForTabForPanelRuntime(tabNameForPane, normalizedPaneForSet);
      if (!optsForSetPane.skipStateSync) {
        const partialForWrite = {};
        partialForWrite[cfgForPane.field] = normalizedPaneForSet;
        writePanelStateSyncForPanelRuntime(partialForWrite);
      }
    }

    function setReducedPaneForMirrorForPanelRuntime(tabNameForMirror, paneValueForMirror) {
      setReducedPaneForPanelRuntime(tabNameForMirror, paneValueForMirror, { skipStateSync: true });
    }
    let isKeyboardIsolationBoundForPanelRuntime = false;
    let isEditableFocusIsolationBoundForPanelRuntime = false;
    // Snapshot of a toggle dropdown's open state, captured on mousedown before the
    // capture-phase close handler runs. Toggle functions read this to know whether
    // to re-open the dropdown after the capture handler has already closed everything.
    let preclickOpenStateForPanelRuntime = null;
    // Map<chatId, AbortController> — one entry per chat that is actively streaming
    const sendingChatsForPanelRuntime = new Map();
    const AGENT_FALLBACK_RESPONSES_FOR_PANEL_RUNTIME = [
      "Sorry, something went wrong. Please let me know if I should try again.",
      "I wasn't able to complete that. Feel free to ask me to try again.",
      "Something didn't go as expected. Let me know if you'd like me to retry.",
      "I ran into an issue and couldn't respond. Please try again if you'd like.",
      "Apologies, I couldn't finish my response. Let me know if you want me to give it another go.",
      "I hit a snag and couldn't send a reply. Let me know if you'd like me to try again."
    ];
    // Map<chatId, { wrap, shownAt, hasText, toolsDoneAt, removeTimer, bufferText, renderedLength, renderRafId }> — per-chat live bubble state
    const liveTurnBubblesForPanelRuntime = new Map();
    let apiLogsPageForPanelRuntime = 0;
    let apiLogsCacheForPanelRuntime = [];
    let activeLogDetailForPanelRuntime = null;
    let activeLogViewRawForPanelRuntime = false;
    let rawChatViewWrapForPanelRuntime = false;

    const host = root.getElementById('panel-host');
    const overlay = root.getElementById('inline-overlay');
    const pickerOverlay = root.getElementById('picker-overlay');
    const libsOverlayForPanelRuntime = root.getElementById('abchat-libs-overlay');
    const apiKeyOnboardingOverlayForPanelRuntime = root.getElementById('api-key-onboarding-overlay');
    const featureTourOverlayForPanelRuntime = root.getElementById('feature-tour-overlay');
    let currentTourSlideForPanelRuntime = 0;

    /* ============================================================
      LIBS READY GATE
    ============================================================ */
    function buildLibsReadyGateForPanelRuntime() {
      const checksForGate = [];

      // Rendering libs (marked / hljs / DOMPurify / mermaid) are local content
      // scripts and are normally available synchronously. After an extension reload
      // Chrome resets the isolated world, so they may not be present until the
      // re-injection that the service worker triggers has fully executed. Poll with
      // a short interval for up to ~3 s before giving up so the panel recovers
      // gracefully without requiring a full page refresh.
      checksForGate.push(new Promise(function (resolveLibsForGate, rejectLibsForGate) {
        var libsPollIntervalMsForGate = 200;
        var libsPollMaxMsForGate = 3000;
        var libsPollStartedAtForGate = Date.now();

        function checkLibsForGate() {
          var libsOkForGate = (
            typeof window.marked !== 'undefined' &&
            typeof window.hljs !== 'undefined' &&
            typeof window.DOMPurify !== 'undefined' &&
            typeof window.mermaid !== 'undefined'
          );
          if (libsOkForGate) {
            resolveLibsForGate();
            return;
          }
          if (Date.now() - libsPollStartedAtForGate >= libsPollMaxMsForGate) {
            rejectLibsForGate(new Error('One or more rendering libraries failed to load (marked / hljs / DOMPurify / mermaid).'));
            return;
          }
          setTimeout(checkLibsForGate, libsPollIntervalMsForGate);
        }

        checkLibsForGate();
      }));

      // MathJax startup promise: MathJax v3 exposes startup.promise that resolves
      // when its async internal initialisation is complete.
      if (
        typeof window.MathJax !== 'undefined' &&
        window.MathJax.startup &&
        window.MathJax.startup.promise &&
        typeof window.MathJax.startup.promise.then === 'function'
      ) {
        checksForGate.push(
          Promise.resolve(window.MathJax.startup.promise).catch(function () {
            // MathJax failed to fully init; non-fatal — math simply won't render.
          })
        );
      }

      // Shadow root stylesheets (panel.css, github-dark.min.css): these are
      // injected as <link> elements and load asynchronously. We must wait for
      // them so syntax highlighting and panel styles are applied before the
      // overlay is removed and the user can see content.
      function waitForLinkForGate(linkElForGate) {
        return new Promise(function (resolve) {
          if (!linkElForGate) { resolve(); return; }
          // sheet is non-null once the stylesheet has been parsed and applied.
          if (linkElForGate.sheet) { resolve(); return; }
          linkElForGate.addEventListener('load', resolve, { once: true });
          // Treat a load error as non-fatal so a missing stylesheet doesn't
          // permanently block the panel.
          linkElForGate.addEventListener('error', resolve, { once: true });
        });
      }
      Array.from(root.querySelectorAll('link[rel="stylesheet"]')).forEach(function (linkElForGate) {
        checksForGate.push(waitForLinkForGate(linkElForGate));
      });

      // Fonts: already used per-render for Mermaid; include in the gate too.
      if (
        typeof document !== 'undefined' &&
        document.fonts &&
        document.fonts.ready &&
        typeof document.fonts.ready.then === 'function'
      ) {
        checksForGate.push(Promise.resolve(document.fonts.ready).catch(function () {}));
      }

      return Promise.all(checksForGate);
    }

    function activateLibsReadyGateForPanelRuntime() {
      if (!libsOverlayForPanelRuntime) return;

      // Disable the main chat input while libraries are initialising.
      const chatTaForGate = root.querySelector('.chat-textarea');
      const sendBtnForGate = root.querySelector('.send-btn');
      if (chatTaForGate) chatTaForGate.disabled = true;
      if (sendBtnForGate) sendBtnForGate.disabled = true;

      // Eagerly initialise mermaid so it is ready before the first render,
      // rather than lazily on the first diagram encountered.
      initializeMermaidForPanelRuntime();

      buildLibsReadyGateForPanelRuntime()
        .then(function () {
          libsOverlayForPanelRuntime.classList.add('libs-ready');
          if (chatTaForGate) chatTaForGate.disabled = false;
          if (sendBtnForGate) sendBtnForGate.disabled = false;
          // Remove the overlay from the DOM after the CSS fade completes.
          setTimeout(function () {
            if (libsOverlayForPanelRuntime && libsOverlayForPanelRuntime.parentNode) {
              libsOverlayForPanelRuntime.parentNode.removeChild(libsOverlayForPanelRuntime);
            }
          }, 250);
          checkFeatureTourForPanelRuntime();
        })
        .catch(function (errForGate) {
          // A required library failed to load: swap spinner for an error message.
          libsOverlayForPanelRuntime.classList.add('libs-error');
          const errMsgForGate =
            errForGate && errForGate.message ? errForGate.message : 'Unknown initialisation error.';
          libsOverlayForPanelRuntime.innerHTML =
            '<div class="libs-loading-error-icon">\u26a0\ufe0f</div>' +
            '<span class="libs-loading-error-msg">Failed to initialise: ' +
            errMsgForGate.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
            '</span>';
        });
    }

    async function checkApiKeyOnboardingForPanelRuntime() {
      if (!apiKeyOnboardingOverlayForPanelRuntime) return;
      const key = await getApiKeyForPanelRuntime();
      if (!key) {
        apiKeyOnboardingOverlayForPanelRuntime.classList.remove('hidden');
        const inputForOnboarding = root.getElementById('api-key-onboarding-input');
        if (inputForOnboarding) inputForOnboarding.focus();
      }
    }

    /* ============================================================
      FEATURE TOUR
    ============================================================ */
    const TOUR_SLIDES_FOR_PANEL_RUNTIME = [
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/welcome.jpg')}" alt="Welcome to Agentic Browser Chat" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Welcome to Agentic Browser Chat',
        desc: 'Your AI-powered workspace, right inside the browser. Chat, take notes, manage tasks, and more — without leaving the page.',
        bullets: []
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/connect-ai-key.jpg')}" alt="Connect your AI model" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Connect your AI model',
        desc: 'Agentic Browser Chat uses OpenRouter to access AI models. You\'ll need a free API key to get started.',
        bullets: [
          'Get your key at openrouter.ai (free to sign up)',
          'Supports GPT-4, Gemini, Claude, Llama, and more',
          'Your key is stored only on your device, never synced'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/what-on-page.jpg')}" alt="Chat about what's on the page" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Chat about what\'s on the page',
        desc: '',
        bullets: [
          'Select text on any page and attach it to your message',
          'Capture a screenshot to share visual context',
          'Highlight text to get an instant inline Quick Question popup',
          'Right-click any element for AI context actions'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/notes.jpg')}" alt="Build your knowledge base" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Build your knowledge base',
        desc: '',
        bullets: [
          'Create notes to save useful information from any page',
          'Attach notes to any chat as context for the AI',
          'The AI can read and reference your saved notes',
          'Supports Markdown, plain text, code, and JSON'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/tasks.jpg')}" alt="Track what matters" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Track what matters',
        desc: '',
        bullets: [
          'Create and manage tasks directly inside the panel',
          'Set due dates and reminders for important work',
          'The AI can reference your task list in conversations',
          'Stay organised without switching apps'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/upload-anything.jpg')}" alt="Upload any file" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Upload any file',
        desc: '',
        bullets: [
          'PDFs, Word docs (.docx), and Excel spreadsheets (.xlsx)',
          'Images: PNG, JPEG, WebP, and GIF',
          'CSV data files and plain text / Markdown',
          'The AI reads and analyses the uploaded content'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/gen-image.jpg')}" alt="Generate images with AI" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Generate images with AI',
        desc: '',
        bullets: [
          'Ask the AI to create any image right inside the chat',
          'Choose from available image generation models in Settings',
          'Generated images are saved within the conversation',
          'Download or copy images directly from the chat'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/quiz.jpg')}" alt="Test and reinforce your knowledge" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'Test and reinforce your knowledge',
        desc: '',
        bullets: [
          'Generate quiz questions from any page or note',
          'Practice with MCQ and fill-in-the-blank questions',
          'Spaced repetition brings back questions when you\'re due',
          'Start a session to work through all due questions at once'
        ]
      },
      {
        illustration: `<img src="${chrome.runtime.getURL('panel/images/settings.jpg')}" alt="You're all set!" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">`,
        title: 'You\'re all set!',
        desc: 'The extension comes loaded with sample chats, notes, tasks, and quizzes so you can explore what\'s possible right away. Connect your API key in Settings to start chatting with the AI.',
        bullets: []
      }
    ];

    async function checkFeatureTourForPanelRuntime() {
      return new Promise(function (resolveForTour) {
        chrome.storage.sync.get(['abchat_tour_done'], function (resultForTour) {
          if (resultForTour && resultForTour.abchat_tour_done) {
            checkApiKeyOnboardingForPanelRuntime();
          } else {
            showFeatureTourForPanelRuntime();
          }
          resolveForTour();
        });
      });
    }

    function showFeatureTourForPanelRuntime() {
      if (!featureTourOverlayForPanelRuntime) {
        checkApiKeyOnboardingForPanelRuntime();
        return;
      }
      currentTourSlideForPanelRuntime = 0;
      featureTourOverlayForPanelRuntime.classList.remove('hidden');
      renderTourSlideForPanelRuntime(0);
    }

    function renderTourSlideForPanelRuntime(slideIndex) {
      if (!featureTourOverlayForPanelRuntime) return;
      const slide = TOUR_SLIDES_FOR_PANEL_RUNTIME[slideIndex];
      if (!slide) return;

      const illEl = featureTourOverlayForPanelRuntime.querySelector('.ft-illustration');
      const contentEl = featureTourOverlayForPanelRuntime.querySelector('.ft-content');
      const titleEl = featureTourOverlayForPanelRuntime.querySelector('.ft-title');
      const descEl = featureTourOverlayForPanelRuntime.querySelector('.ft-desc');
      const bulletsEl = featureTourOverlayForPanelRuntime.querySelector('.ft-bullets');
      const backBtn = featureTourOverlayForPanelRuntime.querySelector('.ft-btn-back');
      const nextBtn = featureTourOverlayForPanelRuntime.querySelector('.ft-btn-next');
      const dotsEl = featureTourOverlayForPanelRuntime.querySelector('.ft-dots');
      const skipBtn = featureTourOverlayForPanelRuntime.querySelector('.ft-btn-skip');

      if (illEl) {
        illEl.innerHTML = slide.illustration;
        illEl.classList.remove('ft-animating');
        void illEl.offsetWidth;
        illEl.classList.add('ft-animating');
      }
      if (contentEl) {
        contentEl.classList.remove('ft-animating');
        void contentEl.offsetWidth;
        contentEl.classList.add('ft-animating');
      }
      if (titleEl) titleEl.textContent = slide.title;
      if (descEl) {
        descEl.textContent = slide.desc || '';
        descEl.style.display = slide.desc ? '' : 'none';
      }
      if (bulletsEl) {
        if (slide.bullets && slide.bullets.length) {
          bulletsEl.innerHTML = slide.bullets.map(function (b) {
            return '<li class="ft-bullet">' + b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</li>';
          }).join('');
          bulletsEl.style.display = '';
        } else {
          bulletsEl.innerHTML = '';
          bulletsEl.style.display = 'none';
        }
      }
      if (dotsEl) {
        dotsEl.innerHTML = TOUR_SLIDES_FOR_PANEL_RUNTIME.map(function (_, i) {
          return '<span class="ft-dot' + (i === slideIndex ? ' ft-dot-active' : '') + '"></span>';
        }).join('');
      }
      if (backBtn) backBtn.style.visibility = slideIndex === 0 ? 'hidden' : 'visible';
      const isLastSlide = slideIndex === TOUR_SLIDES_FOR_PANEL_RUNTIME.length - 1;
      if (nextBtn) {
        nextBtn.innerHTML = isLastSlide ? 'Set up API key' : 'Next &rarr;';
        nextBtn.dataset.action = isLastSlide ? 'tour-finish' : 'tour-next';
      }
      if (skipBtn) {
        skipBtn.textContent = isLastSlide ? 'Maybe later' : 'Skip tour';
      }
    }

    function dismissFeatureTourForPanelRuntime() {
      if (featureTourOverlayForPanelRuntime) {
        featureTourOverlayForPanelRuntime.classList.add('hidden');
      }
      chrome.storage.sync.set({ abchat_tour_done: true });
      checkApiKeyOnboardingForPanelRuntime();
    }

    async function saveApiKeyFromOnboardingForPanelRuntime() {
      const inputForOnboarding = root.getElementById('api-key-onboarding-input');
      if (!inputForOnboarding) return;
      const keyVal = inputForOnboarding.value.trim();
      if (!keyVal) {
        inputForOnboarding.classList.add('api-key-onboarding-input-error');
        setTimeout(function () { inputForOnboarding.classList.remove('api-key-onboarding-input-error'); }, 600);
        return;
      }
      await saveApiKeyForPanelRuntime(keyVal);
      await clearCachedModelsForPanelRuntime();
      initModelSelectsForPanelRuntime();
      if (apiKeyOnboardingOverlayForPanelRuntime) {
        apiKeyOnboardingOverlayForPanelRuntime.classList.add('hidden');
      }
    }

    function getAutoExpandMaxHeightForPanelRuntime(textareaForPanelRuntime) {
      if (!textareaForPanelRuntime || !window || !window.getComputedStyle) return 240;
      const computedStyleForPanelRuntime = window.getComputedStyle(textareaForPanelRuntime);
      const parsedMaxHeightForPanelRuntime = parseFloat(computedStyleForPanelRuntime.maxHeight || '');
      if (Number.isFinite(parsedMaxHeightForPanelRuntime) && parsedMaxHeightForPanelRuntime > 0) {
        return parsedMaxHeightForPanelRuntime;
      }
      return 240;
    }

    function updateAutoExpandForTextareaForPanelRuntime(textareaForPanelRuntime) {
      if (!textareaForPanelRuntime || typeof textareaForPanelRuntime.style === 'undefined') return;
      const maxHeightForPanelRuntime = getAutoExpandMaxHeightForPanelRuntime(textareaForPanelRuntime);
      textareaForPanelRuntime.style.height = 'auto';
      const nextHeightForPanelRuntime = Math.min(textareaForPanelRuntime.scrollHeight || 0, maxHeightForPanelRuntime);
      textareaForPanelRuntime.style.height = nextHeightForPanelRuntime + 'px';
      textareaForPanelRuntime.style.overflowY =
        (textareaForPanelRuntime.scrollHeight || 0) > maxHeightForPanelRuntime ? 'auto' : 'hidden';
    }

    function bindAutoExpandForTextareasForPanelRuntime(rootNodeForPanelRuntime) {
      if (!rootNodeForPanelRuntime || !rootNodeForPanelRuntime.querySelectorAll) return;
      rootNodeForPanelRuntime.querySelectorAll('textarea').forEach(function (textareaForPanelRuntime) {
        if (!textareaForPanelRuntime) return;
        if (textareaForPanelRuntime.dataset.noAutoExpand === '1') return;
        if (textareaForPanelRuntime.dataset.abchatAutoExpandBound !== '1') {
          textareaForPanelRuntime.dataset.abchatAutoExpandBound = '1';
          textareaForPanelRuntime.style.resize = 'none';
          textareaForPanelRuntime.addEventListener('input', function () {
            updateAutoExpandForTextareaForPanelRuntime(textareaForPanelRuntime);
          });
          textareaForPanelRuntime.addEventListener('paste', function () {
            setTimeout(function () {
              updateAutoExpandForTextareaForPanelRuntime(textareaForPanelRuntime);
            }, 0);
          });
        }
        updateAutoExpandForTextareaForPanelRuntime(textareaForPanelRuntime);
      });
    }

    function isEditableKeyboardTargetForPanelRuntime(targetForPanelRuntime) {
      if (!targetForPanelRuntime || targetForPanelRuntime.nodeType !== 1) return false;
      const tagNameForPanelRuntime = String(targetForPanelRuntime.tagName || '').toLowerCase();
      if (tagNameForPanelRuntime === 'input' || tagNameForPanelRuntime === 'textarea' || tagNameForPanelRuntime === 'select') {
        return true;
      }
      if (targetForPanelRuntime.isContentEditable) return true;
      if (typeof targetForPanelRuntime.getAttribute === 'function') {
        const contentEditableAttrForPanelRuntime = targetForPanelRuntime.getAttribute('contenteditable');
        if (contentEditableAttrForPanelRuntime === '' || contentEditableAttrForPanelRuntime === 'true') {
          return true;
        }
      }
      return false;
    }

    function getEditableKeyboardTargetForPanelRuntime(eventForPanelRuntime) {
      if (!eventForPanelRuntime) return null;
      if (typeof eventForPanelRuntime.composedPath === 'function') {
        const eventPathForPanelRuntime = eventForPanelRuntime.composedPath();
        if (Array.isArray(eventPathForPanelRuntime)) {
          for (let pathIndexForPanelRuntime = 0; pathIndexForPanelRuntime < eventPathForPanelRuntime.length; pathIndexForPanelRuntime++) {
            const pathNodeForPanelRuntime = eventPathForPanelRuntime[pathIndexForPanelRuntime];
            if (isEditableKeyboardTargetForPanelRuntime(pathNodeForPanelRuntime)) {
              return pathNodeForPanelRuntime;
            }
          }
        }
      }
      const eventTargetForPanelRuntime = eventForPanelRuntime.target;
      return isEditableKeyboardTargetForPanelRuntime(eventTargetForPanelRuntime) ? eventTargetForPanelRuntime : null;
    }

    function shouldIsolateKeyboardEventForPanelRuntime(eventForPanelRuntime) {
      const editableTargetForPanelRuntime = getEditableKeyboardTargetForPanelRuntime(eventForPanelRuntime);
      if (!editableTargetForPanelRuntime) return false;
      if (host && typeof host.contains === 'function' && host.contains(editableTargetForPanelRuntime)) return true;
      if (pickerOverlay && typeof pickerOverlay.contains === 'function' && pickerOverlay.contains(editableTargetForPanelRuntime)) return true;
      if (featureTourOverlayForPanelRuntime && typeof featureTourOverlayForPanelRuntime.contains === 'function' && featureTourOverlayForPanelRuntime.contains(editableTargetForPanelRuntime)) return true;
      return false;
    }

    function isolateKeyboardEventForPanelRuntime(eventForPanelRuntime) {
      if (!shouldIsolateKeyboardEventForPanelRuntime(eventForPanelRuntime)) return;
      if (typeof eventForPanelRuntime.stopImmediatePropagation === 'function') {
        eventForPanelRuntime.stopImmediatePropagation();
        return;
      }
      if (typeof eventForPanelRuntime.stopPropagation === 'function') {
        eventForPanelRuntime.stopPropagation();
      }
    }

    function bindKeyboardIsolationForPanelRuntime(rootNodeForPanelRuntime) {
      if (!rootNodeForPanelRuntime || !rootNodeForPanelRuntime.addEventListener) return;
      if (isKeyboardIsolationBoundForPanelRuntime) return;
      isKeyboardIsolationBoundForPanelRuntime = true;
      rootNodeForPanelRuntime.addEventListener('keydown', isolateKeyboardEventForPanelRuntime);
      rootNodeForPanelRuntime.addEventListener('keypress', isolateKeyboardEventForPanelRuntime);
      rootNodeForPanelRuntime.addEventListener('keyup', isolateKeyboardEventForPanelRuntime);
    }

    function isolateEditableFocusEventForPanelRuntime(eventForPanelRuntime) {
      if (!shouldIsolateKeyboardEventForPanelRuntime(eventForPanelRuntime)) return;
      if (typeof eventForPanelRuntime.stopImmediatePropagation === 'function') {
        eventForPanelRuntime.stopImmediatePropagation();
        return;
      }
      if (typeof eventForPanelRuntime.stopPropagation === 'function') {
        eventForPanelRuntime.stopPropagation();
      }
    }

    function bindEditableFocusIsolationForPanelRuntime(rootNodeForPanelRuntime) {
      if (!rootNodeForPanelRuntime || !rootNodeForPanelRuntime.addEventListener) return;
      if (isEditableFocusIsolationBoundForPanelRuntime) return;
      isEditableFocusIsolationBoundForPanelRuntime = true;

      rootNodeForPanelRuntime.addEventListener('focusin', isolateEditableFocusEventForPanelRuntime);

      var capturedGenerationForPanelFocusIsolation = window.abchatListenerGeneration || 0;
      function isolateDocumentFocusEventForPanelRuntime(eventForPanelRuntime) {
        if ((window.abchatListenerGeneration || 0) !== capturedGenerationForPanelFocusIsolation) {
          document.removeEventListener('focusin', isolateDocumentFocusEventForPanelRuntime, true);
          return;
        }
        try {
          if (!chrome.runtime || !chrome.runtime.id) {
            document.removeEventListener('focusin', isolateDocumentFocusEventForPanelRuntime, true);
            return;
          }
        } catch (errorForPanelRuntime) {
          document.removeEventListener('focusin', isolateDocumentFocusEventForPanelRuntime, true);
          return;
        }
        isolateEditableFocusEventForPanelRuntime(eventForPanelRuntime);
      }

      document.addEventListener('focusin', isolateDocumentFocusEventForPanelRuntime, true);
    }

    function bindSelectorTabHoverTooltipForPanelRuntime(rootNodeForSelectorTabTooltip) {
      if (!rootNodeForSelectorTabTooltip || !rootNodeForSelectorTabTooltip.getElementById) return;
      var btnForSelectorTabTooltip = rootNodeForSelectorTabTooltip.getElementById('selector-tab');
      if (!btnForSelectorTabTooltip) return;
      if (btnForSelectorTabTooltip.dataset.hoverTooltipBound === '1') return;
      btnForSelectorTabTooltip.dataset.hoverTooltipBound = '1';

      var tooltipClassForSelectorTabTooltip = 'abchat-content-selector-tooltip';
      var tooltipElForSelectorTabTooltip = null;

      function buildSelectorTabTooltipForPanelRuntime() {
        var elForSelectorTabTooltip = document.createElement('div');
        elForSelectorTabTooltip.className = tooltipClassForSelectorTabTooltip;
        var titleLineForSelectorTabTooltip = document.createElement('span');
        titleLineForSelectorTabTooltip.className = 'abchat-content-selector-tooltip-selector';
        titleLineForSelectorTabTooltip.textContent = 'Content Selector';
        var hint1ForSelectorTabTooltip = document.createElement('span');
        hint1ForSelectorTabTooltip.className = 'abchat-content-selector-tooltip-hint';
        hint1ForSelectorTabTooltip.textContent = 'Pick a specific part of the page to add as chat context';
        var hint2ForSelectorTabTooltip = document.createElement('span');
        hint2ForSelectorTabTooltip.className = 'abchat-content-selector-tooltip-hint';
        hint2ForSelectorTabTooltip.textContent = 'Useful for articles, comments, tables, or code blocks';
        elForSelectorTabTooltip.appendChild(titleLineForSelectorTabTooltip);
        elForSelectorTabTooltip.appendChild(hint1ForSelectorTabTooltip);
        elForSelectorTabTooltip.appendChild(hint2ForSelectorTabTooltip);
        return elForSelectorTabTooltip;
      }

      function positionSelectorTabTooltipForPanelRuntime() {
        if (!tooltipElForSelectorTabTooltip) return;
        var rectForSelectorTabTooltip = btnForSelectorTabTooltip.getBoundingClientRect();
        tooltipElForSelectorTabTooltip.style.display = 'block';
        var tooltipWidthForSelectorTabTooltip = tooltipElForSelectorTabTooltip.offsetWidth;
        var tooltipHeightForSelectorTabTooltip = tooltipElForSelectorTabTooltip.offsetHeight;
        var viewportWidthForSelectorTabTooltip = window.innerWidth;
        var viewportHeightForSelectorTabTooltip = window.innerHeight;

        var leftForSelectorTabTooltip = rectForSelectorTabTooltip.left + (rectForSelectorTabTooltip.width / 2) - (tooltipWidthForSelectorTabTooltip / 2);
        var topForSelectorTabTooltip = rectForSelectorTabTooltip.bottom + 6;

        if (topForSelectorTabTooltip + tooltipHeightForSelectorTabTooltip > viewportHeightForSelectorTabTooltip - 4) {
          topForSelectorTabTooltip = rectForSelectorTabTooltip.top - tooltipHeightForSelectorTabTooltip - 6;
        }
        if (leftForSelectorTabTooltip + tooltipWidthForSelectorTabTooltip > viewportWidthForSelectorTabTooltip - 4) {
          leftForSelectorTabTooltip = viewportWidthForSelectorTabTooltip - tooltipWidthForSelectorTabTooltip - 4;
        }
        if (leftForSelectorTabTooltip < 4) leftForSelectorTabTooltip = 4;
        if (topForSelectorTabTooltip < 4) topForSelectorTabTooltip = 4;

        tooltipElForSelectorTabTooltip.style.left = leftForSelectorTabTooltip + 'px';
        tooltipElForSelectorTabTooltip.style.top = topForSelectorTabTooltip + 'px';
      }

      function showSelectorTabTooltipForPanelRuntime() {
        if (tooltipElForSelectorTabTooltip && tooltipElForSelectorTabTooltip.isConnected) return;
        tooltipElForSelectorTabTooltip = buildSelectorTabTooltipForPanelRuntime();
        document.body.appendChild(tooltipElForSelectorTabTooltip);
        positionSelectorTabTooltipForPanelRuntime();
      }

      function hideSelectorTabTooltipForPanelRuntime() {
        if (tooltipElForSelectorTabTooltip && tooltipElForSelectorTabTooltip.parentNode) {
          tooltipElForSelectorTabTooltip.parentNode.removeChild(tooltipElForSelectorTabTooltip);
        }
        tooltipElForSelectorTabTooltip = null;
      }

      btnForSelectorTabTooltip.addEventListener('mouseenter', showSelectorTabTooltipForPanelRuntime);
      btnForSelectorTabTooltip.addEventListener('mouseleave', hideSelectorTabTooltipForPanelRuntime);
      btnForSelectorTabTooltip.addEventListener('click', hideSelectorTabTooltipForPanelRuntime);
      btnForSelectorTabTooltip.addEventListener('blur', hideSelectorTabTooltipForPanelRuntime);
    }

    /* ============================================================
      MARKDOWN RENDERER (marked + highlight.js + DOMPurify + MathJax + Mermaid)
    ============================================================ */
    marked.setOptions({
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
      langPrefix: 'hljs language-',
      gfm: true,
      breaks: false,
    });

    // Protect math delimiters from markdown parsing via custom marked extensions.
    // Each tokenizer consumes the full delimiter+content span as a raw token so
    // that marked never sees the interior (preventing mangling of _, *, \n, etc.).
    marked.use({
      extensions: [
        // Display math: $$...$$ and \[...\]
        {
          name: 'mathDisplay',
          level: 'inline',
          start(src) {
            const a = src.indexOf('$$');
            const b = src.indexOf('\\[');
            if (a < 0 && b < 0) return undefined;
            if (a < 0) return b;
            if (b < 0) return a;
            return Math.min(a, b);
          },
          tokenizer(src) {
            const m = src.match(/^\$\$([\s\S]*?)\$\$/) || src.match(/^\\\[([\s\S]*?)\\\]/);
            if (m) return { type: 'mathDisplay', raw: m[0], text: m[0], inner: m[1] };
          },
          // Strip delimiters when content contains non-LaTeX characters (e.g. currency symbols)
          // that would cause MathJax to show "Math input error" instead of the value.
          renderer(token) {
            if (/[€£¥₹₩₪₫฿₦₨]/.test(token.inner)) return token.inner;
            return token.text;
          },
        },
        // Inline math: \(...\) only — single $...$ intentionally excluded
        // (too easy to trigger accidentally with currency symbols or variable names)
        {
          name: 'mathInline',
          level: 'inline',
          start(src) {
            const idx = src.indexOf('\\(');
            return idx >= 0 ? idx : undefined;
          },
          tokenizer(src) {
            const m = src.match(/^\\\(([\s\S]*?)\\\)/);
            if (m) return { type: 'mathInline', raw: m[0], text: m[0], inner: m[1] };
          },
          // Strip delimiters when content contains non-LaTeX characters (e.g. currency symbols)
          // that would cause MathJax to show "Math input error" instead of the value.
          renderer(token) {
            if (/[€£¥₹₩₪₫฿₦₨]/.test(token.inner)) return token.inner;
            return token.text;
          },
        },
        // Protect \n-prefixed LaTeX commands (\neq, \nabla, \nu, etc.)
        // Without this, marked treats \n as a line break inside math spans.
        {
          name: 'latexNCommand',
          level: 'inline',
          start(src) {
            const idx = src.indexOf('\\n');
            return idx >= 0 ? idx : undefined;
          },
          tokenizer(src) {
            const m = src.match(/^\\n[a-zA-Z]+/);
            if (m) return { type: 'latexNCommand', raw: m[0], text: m[0] };
          },
          renderer(token) { return token.text; },
        },
      ],
    });

    function mapMermaidCodeBlocksToContainersForPanelRuntime(rawHtmlForPanelRuntime) {
      if (!rawHtmlForPanelRuntime || !rawHtmlForPanelRuntime.trim()) return rawHtmlForPanelRuntime;
      const templateForPanelRuntime = document.createElement('template');
      templateForPanelRuntime.innerHTML = rawHtmlForPanelRuntime;
      templateForPanelRuntime.content.querySelectorAll('pre > code').forEach(function (codeNodeForPanelRuntime) {
        if (!codeNodeForPanelRuntime) return;
        const classNameForPanelRuntime = (codeNodeForPanelRuntime.className || '').toLowerCase();
        if (classNameForPanelRuntime.indexOf('language-mermaid') < 0) return;
        const preForPanelRuntime = codeNodeForPanelRuntime.closest('pre');
        if (!preForPanelRuntime || !preForPanelRuntime.parentNode) return;

        const mermaidNodeForPanelRuntime = document.createElement('div');
        mermaidNodeForPanelRuntime.className = 'mermaid';
        mermaidNodeForPanelRuntime.textContent = codeNodeForPanelRuntime.textContent || '';
        preForPanelRuntime.parentNode.replaceChild(mermaidNodeForPanelRuntime, preForPanelRuntime);
      });
      return templateForPanelRuntime.innerHTML;
    }

    // Safety net for models that ignore the system-prompt rule against single $...$ inline math.
    // MathJax is configured with inlineMath: [['\\(', '\\)']] only, so $...$ would render as raw text.
    // We rewrite likely-math $...$ spans to \(...\) before marked sees them. Skip regions (code,
    // existing math delimiters) are preserved verbatim; currency-style prose (e.g. "$5 to $10") fails
    // both tier checks and is left alone.
    function rewriteDollarInlineMathForPanelRuntime(mdText) {
      if (!mdText || mdText.indexOf('$') < 0) return mdText;
      const skipOrCandidateForDollarRewrite = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])|\$([^$\n]+?)\$/g;
      let transformCountForDollarRewrite = 0;
      const tier2PatternForDollarRewrite = /^[A-Za-z(]([A-Za-z0-9\s,+\-*/=<>!|().]*[A-Za-z0-9)])?$/;
      const rewrittenForDollarRewrite = mdText.replace(skipOrCandidateForDollarRewrite, function (full, skipRegionForDollarRewrite, innerForDollarRewrite) {
        if (skipRegionForDollarRewrite != null) return full;
        if (innerForDollarRewrite == null) return full;
        if (/[\\^_{}]/.test(innerForDollarRewrite)) {
          transformCountForDollarRewrite++;
          return '\\(' + innerForDollarRewrite + '\\)';
        }
        if (innerForDollarRewrite.length <= 30
            && !/^\s|\s$/.test(innerForDollarRewrite)
            && !/^\d/.test(innerForDollarRewrite)
            && tier2PatternForDollarRewrite.test(innerForDollarRewrite)) {
          transformCountForDollarRewrite++;
          return '\\(' + innerForDollarRewrite + '\\)';
        }
        return full;
      });
      if (transformCountForDollarRewrite > 0) {
        console.debug('[abchat] rewrote ' + transformCountForDollarRewrite + ' single-dollar inline math span(s) to \\(...\\)');
      }
      return rewrittenForDollarRewrite;
    }

    function renderMarkdown(mdText) {
      if (!mdText || !mdText.trim()) return '';
      const mdTextForRender = rewriteDollarInlineMathForPanelRuntime(mdText);
      const rawHtml = marked.parse(mdTextForRender);
      const htmlWithMermaidContainers = mapMermaidCodeBlocksToContainersForPanelRuntime(rawHtml);
      return DOMPurify.sanitize(htmlWithMermaidContainers);
    }

    // Call MathJax.typesetPromise on a container after its HTML has been set.
    // Guards against MathJax not yet being loaded (it's async from CDN).
    function typesetMathJax(element) {
      if (!element || !window.MathJax || !MathJax.typesetPromise) return;
      MathJax.typesetPromise([element]).catch(err => {
        console.warn('MathJax typeset error:', err);
      });
    }

    function attachCodeCopyButtons(container) {
      if (!container) return;
      container.querySelectorAll('pre > code').forEach(code => {
        if (!code.classList.contains('hljs')) code.classList.add('hljs');
      });
      container.querySelectorAll('pre').forEach(pre => {
        if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const codeElForLang = pre.querySelector('code');
        const langClass = codeElForLang ? Array.from(codeElForLang.classList).find(c => c.startsWith('language-')) : null;
        const detectedLang = langClass ? langClass.replace('language-', '').trim() : '';

        const btn = document.createElement('button');
        btn.className = 'copy-code-btn';
        btn.textContent = 'Copy';
        btn.addEventListener('click', function() {
          const code = pre.querySelector('code');
          if (!code) return;
          const text = code.textContent;
          const finish = () => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          };
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
          } else {
            fallbackCopy(text, finish);
          }
        });

        if (detectedLang) {
          wrapper.classList.add('has-lang-header');
          const header = document.createElement('div');
          header.className = 'code-block-header';
          const langLabel = document.createElement('span');
          langLabel.className = 'code-lang-label';
          langLabel.textContent = detectedLang;
          header.appendChild(langLabel);
          btn.classList.add('copy-code-btn--header');
          header.appendChild(btn);
          wrapper.insertBefore(header, pre);
        } else {
          wrapper.appendChild(btn);
        }
      });
    }

    function fallbackCopy(text, callback) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      if (callback) callback();
    }

    let mermaidAppliedThemeForPanelRuntime = null;
    let mermaidRenderReadyPromiseForPanelRuntime = null;
    function getCurrentMermaidThemeNameForPanelRuntime() {
      const dt = host && host.dataset ? host.dataset.theme : '';
      return dt === 'dark' ? 'dark' : 'light';
    }
    function initializeMermaidForPanelRuntime() {
      if (typeof window === 'undefined' || !window.mermaid || typeof window.mermaid.initialize !== 'function') return false;
      const themeNameForInit = getCurrentMermaidThemeNameForPanelRuntime();
      if (mermaidAppliedThemeForPanelRuntime === themeNameForInit) return true;
      const isDarkForInit = themeNameForInit === 'dark';
      window.mermaid.initialize({
        startOnLoad: false,
        // strict is mermaid's default but pin it explicitly: SVG content originates
        // from LLM output and we don't want a future default change to widen this.
        securityLevel: 'strict',
        theme: isDarkForInit ? 'dark' : 'default',
        // Pin font so the host page's CSS cascade cannot affect text measurement
        // or node sizing in the temporary scratch element Mermaid appends to document.body.
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 14,
        // themeVariables.fontSize controls what Mermaid writes into the SVG's
        // internal <style> block (the #id { font-size } rule). Without this,
        // Mermaid defaults to 16px regardless of the top-level fontSize key.
        themeVariables: {
          fontSize: '14px',
        },
      });
      mermaidAppliedThemeForPanelRuntime = themeNameForInit;
      return true;
    }

    function generateMermaidRenderIdForPanelRuntime() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return 'abchat-mermaid-' + crypto.randomUUID();
      }
      return 'abchat-mermaid-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1e9));
    }

    function getMermaidRenderReadyPromiseForPanelRuntime() {
      if (mermaidRenderReadyPromiseForPanelRuntime) {
        return mermaidRenderReadyPromiseForPanelRuntime;
      }
      if (
        typeof document !== 'undefined' &&
        document.fonts &&
        document.fonts.ready &&
        typeof document.fonts.ready.then === 'function'
      ) {
        mermaidRenderReadyPromiseForPanelRuntime = Promise.resolve(document.fonts.ready).catch(function () {
          return undefined;
        });
        return mermaidRenderReadyPromiseForPanelRuntime;
      }
      mermaidRenderReadyPromiseForPanelRuntime = Promise.resolve();
      return mermaidRenderReadyPromiseForPanelRuntime;
    }

    function renderMermaidForContainerForPanelRuntime(containerForPanelRuntime) {
      if (!containerForPanelRuntime || !containerForPanelRuntime.querySelectorAll) return Promise.resolve();
      if (!initializeMermaidForPanelRuntime()) return Promise.resolve();
      const mermaidNodesForPanelRuntime = Array.from(
        containerForPanelRuntime.querySelectorAll('.mermaid')
      ).filter(function (nodeForPanelRuntime) {
        return (
          nodeForPanelRuntime &&
          nodeForPanelRuntime.dataset &&
          nodeForPanelRuntime.dataset.abchatMermaidRendered !== '1' &&
          nodeForPanelRuntime.dataset.abchatMermaidRendering !== '1' &&
          nodeForPanelRuntime.dataset.abchatMermaidError !== '1'
        );
      });
      if (!mermaidNodesForPanelRuntime.length) return Promise.resolve();
      const renderPromisesForMermaid = [];
      mermaidNodesForPanelRuntime.forEach(function (nodeForPanelRuntime) {
        const sourceForPanelRuntime = (nodeForPanelRuntime.textContent || '').trim();
        if (!sourceForPanelRuntime) return;
        // Preserve the original source so toolbar copy and the error-state Retry
        // button can recover it after textContent has been replaced by the SVG.
        nodeForPanelRuntime.dataset.abchatMermaidSource = sourceForPanelRuntime;
        nodeForPanelRuntime.dataset.abchatMermaidRendering = '1';
        const renderIdForPanelRuntime = generateMermaidRenderIdForPanelRuntime();
        const nodePromiseForMermaid = getMermaidRenderReadyPromiseForPanelRuntime()
          .then(function () {
            // Mermaid appends a hidden scratch element to document.body during render.
            // Injecting an all:initial reset for that element's ID prevents the host
            // page's CSS from cascading into it (which would distort text measurement
            // and layout even though the final SVG lives in our shadow root).
            // Mermaid appends a hidden scratch element (#d{id}) to document.body
            // during render. Only reset typography properties so the host page's
            // fonts/spacing don't distort text measurement; layout properties
            // (display, position, overflow, etc.) must remain at their defaults
            // or Mermaid's edge-routing geometry will break.
            const scratchIdForPanelRuntime = 'd' + renderIdForPanelRuntime;
            const isolationStyleForPanelRuntime = document.createElement('style');
            isolationStyleForPanelRuntime.id = 'abchat-mermaid-iso-' + renderIdForPanelRuntime;
            isolationStyleForPanelRuntime.textContent =
              '#' + scratchIdForPanelRuntime + ',#' + scratchIdForPanelRuntime + ' *{' +
              'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace!important;' +
              'font-size:14px!important;font-weight:normal!important;font-style:normal!important;' +
              'line-height:1.4!important;letter-spacing:normal!important;word-spacing:normal!important;' +
              'text-transform:none!important;text-decoration:none!important;}';
            document.head.appendChild(isolationStyleForPanelRuntime);
            return window.mermaid.render(renderIdForPanelRuntime, sourceForPanelRuntime)
              .finally(function () {
                if (isolationStyleForPanelRuntime.parentNode) {
                  isolationStyleForPanelRuntime.parentNode.removeChild(isolationStyleForPanelRuntime);
                }
              });
          })
          .then(function (renderResultForPanelRuntime) {
            if (!nodeForPanelRuntime || !nodeForPanelRuntime.isConnected) return;
            const svgForPanelRuntime =
              typeof renderResultForPanelRuntime === 'string'
                ? renderResultForPanelRuntime
                : renderResultForPanelRuntime && renderResultForPanelRuntime.svg
                  ? renderResultForPanelRuntime.svg
                  : '';
            if (!svgForPanelRuntime) {
              throw new Error('Mermaid returned an empty SVG payload');
            }
            // Sanitisation note: mermaid.initialize is called with securityLevel:
            // 'strict' (above), which escapes user-supplied label text inside the
            // SVG it returns. A second pass through DOMPurify was tried as
            // defence-in-depth but breaks label rendering: mermaid emits its CSS
            // inside <style> and its node text inside <foreignObject><div>, and at
            // least one of those (CSS rules, foreignObject HTML children, or the
            // id-targeted CSS selectors) does not survive DOMPurify's combined
            // SVG+HTML profile cleanly. Trust mermaid's strict mode here.
            nodeForPanelRuntime.innerHTML = svgForPanelRuntime;
            if (
              renderResultForPanelRuntime &&
              typeof renderResultForPanelRuntime.bindFunctions === 'function'
            ) {
              renderResultForPanelRuntime.bindFunctions(nodeForPanelRuntime);
            }
            nodeForPanelRuntime.dataset.abchatMermaidRendered = '1';
            delete nodeForPanelRuntime.dataset.abchatMermaidRendering;
            captureMermaidBaseDimensionsForPanelRuntime(nodeForPanelRuntime);
            wrapMermaidWithExportToolbarForPanelRuntime(nodeForPanelRuntime);
          })
          .catch(function (errorForPanelRuntime) {
            if (!nodeForPanelRuntime || !nodeForPanelRuntime.isConnected) return;
            const errorTextForPanelRuntime =
              errorForPanelRuntime && errorForPanelRuntime.message
                ? errorForPanelRuntime.message
                : String(errorForPanelRuntime || 'Unknown Mermaid error');
            nodeForPanelRuntime.innerHTML =
              '<pre><code class="language-mermaid">' +
              escHtml(sourceForPanelRuntime) +
              '</code></pre><div class="mermaid-error">Mermaid render failed: ' +
              escHtml(errorTextForPanelRuntime) +
              '</div>' +
              '<div class="mermaid-error-actions">' +
                '<button type="button" class="mermaid-error-btn" data-action="copy-mermaid-source" title="Copy diagram source">' + ic.copy12 + ' Copy source</button>' +
                '<button type="button" class="mermaid-error-btn" data-action="retry-mermaid" title="Retry render">' + ic.refresh12 + ' Retry</button>' +
              '</div>';
            // Highlight the source pre/code so debugging is easier.
            if (typeof window !== 'undefined' && window.hljs && typeof window.hljs.highlightElement === 'function') {
              const codeForHighlight = nodeForPanelRuntime.querySelector('pre > code.language-mermaid');
              if (codeForHighlight) {
                try { window.hljs.highlightElement(codeForHighlight); } catch (_) {}
              }
            }
            nodeForPanelRuntime.dataset.abchatMermaidRendered = '0';
            nodeForPanelRuntime.dataset.abchatMermaidError = '1';
            delete nodeForPanelRuntime.dataset.abchatMermaidRendering;
            console.warn('Mermaid render error:', errorForPanelRuntime);
          });
        renderPromisesForMermaid.push(nodePromiseForMermaid);
        });
      return Promise.allSettled(renderPromisesForMermaid);
    }

    function isElementVisibleForPanelRuntime(elementForPanelRuntime) {
      if (!elementForPanelRuntime || !elementForPanelRuntime.isConnected || !elementForPanelRuntime.getClientRects) {
        return false;
      }
      return elementForPanelRuntime.getClientRects().length > 0;
    }

    function renderMermaidWhenVisibleForContainerForPanelRuntime(containerForPanelRuntime, framesLeftForPanelRuntime) {
      if (!containerForPanelRuntime) return Promise.resolve();
      if (isElementVisibleForPanelRuntime(containerForPanelRuntime)) {
        return renderMermaidForContainerForPanelRuntime(containerForPanelRuntime);
      }
      if (!Number.isFinite(framesLeftForPanelRuntime) || framesLeftForPanelRuntime <= 0) {
        // Frames exhausted and container still not visible (panel is closed).
        // Register a whenVisible callback so mermaid renders when the panel next opens.
        const panelApiForMermaid = (globalScopeForPanelRuntime.ABChatContent || {}).ui &&
          globalScopeForPanelRuntime.ABChatContent.ui.panel;
        if (panelApiForMermaid && typeof panelApiForMermaid.whenVisible === 'function') {
          const capturedGenForMermaidWhenVisible = (typeof window !== 'undefined' && window.abchatListenerGeneration) || 0;
          panelApiForMermaid.whenVisible(function () {
            // Bail if a re-injection has superseded this callback or the extension
            // context is gone (orphaned listener from before re-injection).
            if ((typeof window !== 'undefined' && (window.abchatListenerGeneration || 0)) !== capturedGenForMermaidWhenVisible) {
              return;
            }
            try {
              if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
            } catch (_) {
              return;
            }
            if (containerForPanelRuntime.isConnected) {
              renderMermaidForContainerForPanelRuntime(containerForPanelRuntime);
            }
          });
        }
        return Promise.resolve();
      }
      if (typeof requestAnimationFrame !== 'function') {
        return renderMermaidForContainerForPanelRuntime(containerForPanelRuntime);
      }
      requestAnimationFrame(function () {
        renderMermaidWhenVisibleForContainerForPanelRuntime(
          containerForPanelRuntime,
          framesLeftForPanelRuntime - 1
        );
      });
      return Promise.resolve();
    }

    function addInlineCopyButtonForPanelRuntime(nodeForInlineCopy, rawTextForInlineCopy) {
      if (!nodeForInlineCopy) return;
      if (nodeForInlineCopy.querySelector('img[src^="data:"]')) return;
      const btnForInlineCopy = document.createElement('button');
      btnForInlineCopy.className = 'im-copy-btn';
      btnForInlineCopy.setAttribute('data-action', 'copy-inline-message');
      btnForInlineCopy.dataset.copyText = rawTextForInlineCopy || '';
      btnForInlineCopy.title = 'Copy';
      btnForInlineCopy.innerHTML = ic.copy12;
      nodeForInlineCopy.appendChild(btnForInlineCopy);
    }

    function isTransparentColorForMermaidFlattenForPanelRuntime(colorStrForTransparent) {
      if (!colorStrForTransparent) return true;
      const trimmedForTransparent = colorStrForTransparent.trim().toLowerCase();
      if (trimmedForTransparent === 'transparent') return true;
      const rgbaMatchForTransparent = trimmedForTransparent.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)$/);
      if (rgbaMatchForTransparent && rgbaMatchForTransparent[1] !== undefined && parseFloat(rgbaMatchForTransparent[1]) === 0) return true;
      return false;
    }

    // Replace each <foreignObject> in a cloned SVG with a native <text> element
    // carrying the same label text. Chrome taints any canvas drawn from an SVG
    // that contains foreignObject (it could embed cross-origin content), so the
    // PNG export path must flatten labels first. The live SVG (still attached to
    // the shadow DOM) is read for computed font/color/background so the PNG
    // matches the theme; the clone is what we mutate.
    function flattenForeignObjectsForMermaidPngForPanelRuntime(liveSvgForFlatten, clonedSvgForFlatten) {
      if (!liveSvgForFlatten || !clonedSvgForFlatten) return;
      const SVG_NS_FOR_FLATTEN = 'http://www.w3.org/2000/svg';
      const liveFOsForFlatten = Array.from(liveSvgForFlatten.querySelectorAll('foreignObject'));
      const clonedFOsForFlatten = Array.from(clonedSvgForFlatten.querySelectorAll('foreignObject'));
      liveFOsForFlatten.forEach(function (liveFoForFlatten, idxForFlatten) {
        const clonedFoForFlatten = clonedFOsForFlatten[idxForFlatten];
        if (!clonedFoForFlatten || !clonedFoForFlatten.parentNode) return;

        // Walk live foreignObject descendants to find the element whose computed
        // background actually paints the label chip; the immediate child div is
        // often transparent and the background lives on a nested span.
        const innerForFlatten = liveFoForFlatten.querySelector('span, p, div') || liveFoForFlatten.firstElementChild;
        let textColorForFlatten = '#333333';
        let fontSizeForFlatten = 14;
        let fontFamilyForFlatten = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        let backgroundColorForFlatten = '';
        if (innerForFlatten && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          try {
            const csForFlatten = window.getComputedStyle(innerForFlatten);
            if (csForFlatten.color) textColorForFlatten = csForFlatten.color;
            const parsedSizeForFlatten = parseFloat(csForFlatten.fontSize);
            if (Number.isFinite(parsedSizeForFlatten) && parsedSizeForFlatten > 0) fontSizeForFlatten = parsedSizeForFlatten;
            if (csForFlatten.fontFamily) fontFamilyForFlatten = csForFlatten.fontFamily;
          } catch (_) {}
          try {
            const liveDescendantsForFlatten = liveFoForFlatten.querySelectorAll('*');
            for (let descIdxForFlatten = 0; descIdxForFlatten < liveDescendantsForFlatten.length; descIdxForFlatten++) {
              const descForFlatten = liveDescendantsForFlatten[descIdxForFlatten];
              const descCsForFlatten = window.getComputedStyle(descForFlatten);
              const descBgForFlatten = descCsForFlatten && descCsForFlatten.backgroundColor;
              if (descBgForFlatten && !isTransparentColorForMermaidFlattenForPanelRuntime(descBgForFlatten)) {
                backgroundColorForFlatten = descBgForFlatten;
                break;
              }
            }
          } catch (_) {}
        }

        // innerText preserves line breaks introduced by <br> and block elements;
        // textContent collapses them. Fall back to textContent if innerText is
        // unavailable (e.g. detached node).
        const rawTextForFlatten = (liveFoForFlatten.innerText || liveFoForFlatten.textContent || '').trim();
        if (!rawTextForFlatten) {
          clonedFoForFlatten.parentNode.removeChild(clonedFoForFlatten);
          return;
        }
        const linesForFlatten = rawTextForFlatten.split(/\r?\n+/).map(function (sForFlatten) {
          return sForFlatten.trim();
        }).filter(Boolean);
        if (!linesForFlatten.length) {
          clonedFoForFlatten.parentNode.removeChild(clonedFoForFlatten);
          return;
        }

        const widthForFlatten = parseFloat(clonedFoForFlatten.getAttribute('width') || '0');
        const heightForFlatten = parseFloat(clonedFoForFlatten.getAttribute('height') || '0');
        const xForFlatten = parseFloat(clonedFoForFlatten.getAttribute('x') || '0');
        const yForFlatten = parseFloat(clonedFoForFlatten.getAttribute('y') || '0');
        const centerXForFlatten = xForFlatten + widthForFlatten / 2;
        const centerYForFlatten = yForFlatten + heightForFlatten / 2;
        const lineHeightForFlatten = fontSizeForFlatten * 1.2;

        const textElForFlatten = document.createElementNS(SVG_NS_FOR_FLATTEN, 'text');
        textElForFlatten.setAttribute('text-anchor', 'middle');
        textElForFlatten.setAttribute('dominant-baseline', 'central');
        textElForFlatten.setAttribute('font-family', fontFamilyForFlatten);
        textElForFlatten.setAttribute('font-size', String(fontSizeForFlatten));
        textElForFlatten.setAttribute('fill', textColorForFlatten);

        if (linesForFlatten.length === 1) {
          textElForFlatten.setAttribute('x', String(centerXForFlatten));
          textElForFlatten.setAttribute('y', String(centerYForFlatten));
          textElForFlatten.textContent = linesForFlatten[0];
        } else {
          const totalHeightForFlatten = lineHeightForFlatten * (linesForFlatten.length - 1);
          const startYForFlatten = centerYForFlatten - totalHeightForFlatten / 2;
          textElForFlatten.setAttribute('x', String(centerXForFlatten));
          textElForFlatten.setAttribute('y', String(startYForFlatten));
          linesForFlatten.forEach(function (lineForFlatten, lineIdxForFlatten) {
            const tspanForFlatten = document.createElementNS(SVG_NS_FOR_FLATTEN, 'tspan');
            tspanForFlatten.setAttribute('x', String(centerXForFlatten));
            if (lineIdxForFlatten > 0) tspanForFlatten.setAttribute('dy', String(lineHeightForFlatten));
            tspanForFlatten.textContent = lineForFlatten;
            textElForFlatten.appendChild(tspanForFlatten);
          });
        }

        const parentForReplaceForFlatten = clonedFoForFlatten.parentNode;
        if (backgroundColorForFlatten) {
          // Edge labels and similar chips carry their fill on the inner div's
          // background-color; SVG <text> has no equivalent, so paint a sibling
          // <rect> behind the text to preserve the chip look in the PNG.
          const rectElForFlatten = document.createElementNS(SVG_NS_FOR_FLATTEN, 'rect');
          rectElForFlatten.setAttribute('x', String(xForFlatten));
          rectElForFlatten.setAttribute('y', String(yForFlatten));
          rectElForFlatten.setAttribute('width', String(widthForFlatten));
          rectElForFlatten.setAttribute('height', String(heightForFlatten));
          rectElForFlatten.setAttribute('fill', backgroundColorForFlatten);
          rectElForFlatten.setAttribute('rx', '2');
          rectElForFlatten.setAttribute('ry', '2');
          parentForReplaceForFlatten.insertBefore(rectElForFlatten, clonedFoForFlatten);
        }
        parentForReplaceForFlatten.replaceChild(textElForFlatten, clonedFoForFlatten);
      });
    }

    function captureMermaidBaseDimensionsForPanelRuntime(mermaidNodeForBase) {
      if (!mermaidNodeForBase) return;
      const svgForBase = mermaidNodeForBase.querySelector('svg');
      if (!svgForBase) return;
      let widthForBase = 0;
      let heightForBase = 0;
      // Prefer viewBox (intrinsic units) so zoom math is independent of any
      // width/height attributes mermaid happened to set.
      const viewBoxForBase = svgForBase.viewBox && svgForBase.viewBox.baseVal;
      if (viewBoxForBase && viewBoxForBase.width && viewBoxForBase.height) {
        widthForBase = viewBoxForBase.width;
        heightForBase = viewBoxForBase.height;
      } else {
        const rectForBase = svgForBase.getBoundingClientRect();
        widthForBase = rectForBase.width;
        heightForBase = rectForBase.height;
      }
      if (!widthForBase || !heightForBase) return;
      mermaidNodeForBase.dataset.abchatMermaidBaseWidth = String(widthForBase);
      mermaidNodeForBase.dataset.abchatMermaidBaseHeight = String(heightForBase);
    }

    function applyMermaidZoomForPanelRuntime(wrapForZoom, nextZoomForPanelRuntime) {
      if (!wrapForZoom) return;
      const mermaidNodeForZoom = wrapForZoom.querySelector('.mermaid');
      if (!mermaidNodeForZoom) return;
      const svgForZoom = mermaidNodeForZoom.querySelector('svg');
      if (!svgForZoom) return;
      const baseWidthForZoom = parseFloat(mermaidNodeForZoom.dataset.abchatMermaidBaseWidth || '0');
      const baseHeightForZoom = parseFloat(mermaidNodeForZoom.dataset.abchatMermaidBaseHeight || '0');
      if (!baseWidthForZoom || !baseHeightForZoom) return;
      // Lower bound is 0.1 so the Fit action can settle below 0.5 on wide
      // diagrams in the reduced-view panel without getting snapped back up.
      const clampedZoomForPanelRuntime = Math.max(0.1, Math.min(4, nextZoomForPanelRuntime));
      svgForZoom.style.width = (baseWidthForZoom * clampedZoomForPanelRuntime) + 'px';
      svgForZoom.style.height = (baseHeightForZoom * clampedZoomForPanelRuntime) + 'px';
      wrapForZoom.dataset.abchatMermaidZoom = String(clampedZoomForPanelRuntime);
    }

    function fitMermaidToContainerForPanelRuntime(wrapForFit) {
      if (!wrapForFit) return;
      const mermaidNodeForFit = wrapForFit.querySelector('.mermaid');
      if (!mermaidNodeForFit) return;
      const baseWidthForFit = parseFloat(mermaidNodeForFit.dataset.abchatMermaidBaseWidth || '0');
      if (!baseWidthForFit) return;
      // clientWidth includes padding; subtract it so we fit to the actual
      // content area rather than overflowing under the padding.
      let paddingXForFit = 0;
      try {
        const csForFit = window.getComputedStyle(mermaidNodeForFit);
        paddingXForFit = (parseFloat(csForFit.paddingLeft) || 0) + (parseFloat(csForFit.paddingRight) || 0);
      } catch (_) {}
      const availableWidthForFit = Math.max(0, mermaidNodeForFit.clientWidth - paddingXForFit);
      if (!availableWidthForFit) return;
      applyMermaidZoomForPanelRuntime(wrapForFit, availableWidthForFit / baseWidthForFit);
    }

    function getMermaidZoomForPanelRuntime(wrapForZoomRead) {
      if (!wrapForZoomRead) return 1;
      const rawZoomForPanelRuntime = parseFloat(wrapForZoomRead.dataset.abchatMermaidZoom || '1');
      return Number.isFinite(rawZoomForPanelRuntime) && rawZoomForPanelRuntime > 0
        ? rawZoomForPanelRuntime
        : 1;
    }

    function wrapMermaidWithExportToolbarForPanelRuntime(mermaidNodeForExport) {
      if (!mermaidNodeForExport || mermaidNodeForExport.closest('.mermaid-export-wrap')) return;
      const wrapForExport = document.createElement('div');
      wrapForExport.className = 'mermaid-export-wrap';
      mermaidNodeForExport.parentNode.insertBefore(wrapForExport, mermaidNodeForExport);
      wrapForExport.appendChild(mermaidNodeForExport);
      const toolbarForExport = document.createElement('div');
      toolbarForExport.className = 'mermaid-export-toolbar';

      const btnZoomOutForExport = document.createElement('button');
      btnZoomOutForExport.type = 'button';
      btnZoomOutForExport.className = 'mermaid-export-btn mermaid-export-btn--icon';
      btnZoomOutForExport.setAttribute('data-action', 'zoom-mermaid-out');
      btnZoomOutForExport.title = 'Zoom out';
      btnZoomOutForExport.innerHTML = ic.minus12;

      const btnZoomResetForExport = document.createElement('button');
      btnZoomResetForExport.type = 'button';
      btnZoomResetForExport.className = 'mermaid-export-btn';
      btnZoomResetForExport.setAttribute('data-action', 'zoom-mermaid-reset');
      btnZoomResetForExport.title = 'Fit to width';
      btnZoomResetForExport.textContent = 'Fit';

      const btnZoomInForExport = document.createElement('button');
      btnZoomInForExport.type = 'button';
      btnZoomInForExport.className = 'mermaid-export-btn mermaid-export-btn--icon';
      btnZoomInForExport.setAttribute('data-action', 'zoom-mermaid-in');
      btnZoomInForExport.title = 'Zoom in';
      btnZoomInForExport.innerHTML = ic.plus12;

      const btnCopySourceForExport = document.createElement('button');
      btnCopySourceForExport.type = 'button';
      btnCopySourceForExport.className = 'mermaid-export-btn';
      btnCopySourceForExport.setAttribute('data-action', 'copy-mermaid-source');
      btnCopySourceForExport.title = 'Copy diagram source';
      btnCopySourceForExport.innerHTML = ic.copy12 + ' Copy';

      const btnSvgForExport = document.createElement('button');
      btnSvgForExport.type = 'button';
      btnSvgForExport.className = 'mermaid-export-btn';
      btnSvgForExport.setAttribute('data-action', 'download-mermaid-svg');
      btnSvgForExport.title = 'Download as SVG';
      btnSvgForExport.innerHTML = ic.download13 + ' SVG';

      const btnPngForExport = document.createElement('button');
      btnPngForExport.type = 'button';
      btnPngForExport.className = 'mermaid-export-btn';
      btnPngForExport.setAttribute('data-action', 'download-mermaid-png');
      btnPngForExport.title = 'Download as PNG';
      btnPngForExport.innerHTML = ic.download13 + ' PNG';

      toolbarForExport.appendChild(btnZoomOutForExport);
      toolbarForExport.appendChild(btnZoomResetForExport);
      toolbarForExport.appendChild(btnZoomInForExport);
      toolbarForExport.appendChild(btnCopySourceForExport);
      toolbarForExport.appendChild(btnSvgForExport);
      toolbarForExport.appendChild(btnPngForExport);
      wrapForExport.appendChild(toolbarForExport);
    }

    function hydrateGeneratedImagesForPanelRuntime(containerForPanelRuntime) {
      if (!containerForPanelRuntime) return;
      const msgTextsForImgHydrate = containerForPanelRuntime.querySelectorAll('.msg-bubble.asst .msg-text');
      msgTextsForImgHydrate.forEach(function (msgTextForImgHydrate) {
        const imgsForHydrate = msgTextForImgHydrate.querySelectorAll('img');
        imgsForHydrate.forEach(function (imgForHydrate) {
          if (!imgForHydrate.src || !imgForHydrate.src.startsWith('data:')) return;
          if (imgForHydrate.closest('.gen-img-wrap')) return;
          const wrapForHydrate = document.createElement('div');
          wrapForHydrate.className = 'gen-img-wrap';
          imgForHydrate.parentNode.insertBefore(wrapForHydrate, imgForHydrate);
          wrapForHydrate.appendChild(imgForHydrate);
          const btnForHydrate = document.createElement('button');
          btnForHydrate.className = 'gen-img-download-btn';
          btnForHydrate.setAttribute('data-action', 'download-gen-image');
          btnForHydrate.title = 'Download image';
          btnForHydrate.innerHTML = ic.download13 + ' Download';
          wrapForHydrate.appendChild(btnForHydrate);
        });
      });
    }

    function hydrateGeneratedDocumentsForPanelRuntime(containerForPanelRuntime) {
      if (!containerForPanelRuntime) return;
      const docLinksForHydrate = containerForPanelRuntime.querySelectorAll('a[href^="#abchat-docblob-"]');
      docLinksForHydrate.forEach(function (linkForHydrate) {
        const matchForHydrate = String(linkForHydrate.getAttribute('href') || '').match(/^#abchat-docblob-(\d+)$/);
        if (!matchForHydrate) return;
        const blobIdForHydrate = Number(matchForHydrate[1]);
        const docRecordForHydrate = GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME[blobIdForHydrate];
        if (!docRecordForHydrate || !docRecordForHydrate.dataUrl) return;
        linkForHydrate.href = docRecordForHydrate.dataUrl;
        linkForHydrate.download = docRecordForHydrate.name || 'generated-document';
        linkForHydrate.removeAttribute('target');
        linkForHydrate.rel = 'noopener noreferrer';
        linkForHydrate.classList.add('generated-document-link');
      });
    }

    function hydrateRenderedMarkdownForPanelRuntime(containerForPanelRuntime) {
      if (!containerForPanelRuntime) return Promise.resolve();
      attachCodeCopyButtons(containerForPanelRuntime);
      hydrateGeneratedDocumentsForPanelRuntime(containerForPanelRuntime);
      const mermaidPromiseForHydrate = renderMermaidWhenVisibleForContainerForPanelRuntime(containerForPanelRuntime, 12);
      typesetMathJax(containerForPanelRuntime);
      return mermaidPromiseForHydrate;
    }

    /* ============================================================
      CHAT DATA & RENDERER
    ============================================================ */
    const CHIP_SVGS = {
      page: ic.fileText10,
      'page-snapshot': ic.globe10,
      note: ic.noteEdit10,
      tab: ic.chipTab10,
      chat: ic.message10,
      file: ic.file10,
      image: ic.image10,
      screenshot: ic.screenshot10,
      spreadsheet: ic.spreadsheet10,
      paste: ic.paste10
    };

    function escHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderUserMsgContent(s) {
      const esc = chunk => escHtml(chunk).replace(/\n/g, '<br>');
      if (s.length <= 4000) return esc(s);
      return esc(s.slice(0, 1500)) + '<br>--truncated for brevity--<br>' + esc(s.slice(s.length - 1500));
    }

    function getEditableUserMessageValueForPanelRuntime(messageForPanelRuntime) {
      if (!messageForPanelRuntime || messageForPanelRuntime.role !== 'user') return '';
      if (typeof messageForPanelRuntime.md === 'string') {
        return messageForPanelRuntime.md;
      }
      if (typeof messageForPanelRuntime.content === 'string') {
        return messageForPanelRuntime.content;
      }
      return '';
    }

    function setEditableUserMessageValueForPanelRuntime(messageForPanelRuntime, nextValueForPanelRuntime) {
      if (!messageForPanelRuntime || messageForPanelRuntime.role !== 'user') return;
      if (Object.prototype.hasOwnProperty.call(messageForPanelRuntime, 'md')) {
        messageForPanelRuntime.md = nextValueForPanelRuntime;
        return;
      }
      messageForPanelRuntime.content = nextValueForPanelRuntime;
    }


    function getActiveChatMessagesForPanelRuntime() {
      const activeChatForMsg = S.activeChatId ? CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId] : null;
      return activeChatForMsg ? activeChatForMsg.messages : [];
    }

    // Lazy message loader: fetches messages from DB the first time a chat is opened and
    // merges any in-flight unsaved messages so nothing is lost. After fetching, the chat's
    // search index entry is updated with full content.
    // SCALABILITY: all message access for a chat must go through this gate before rendering.
    // Do not read chatRecord.messages without first awaiting this function.
    async function ensureChatMessagesLoadedForPanelRuntime(chatIdForLazy) {
      var numericIdForLazy = Number(chatIdForLazy);
      if (!Number.isFinite(numericIdForLazy)) return;
      if (chatMessagesLoadedSetForPanelRuntime.has(numericIdForLazy)) return;
      var repoForLazy = getPanelDataRepoForPanelRuntime();
      if (!repoForLazy) return;
      try {
        var freshMsgsForLazy = await repoForLazy.listMessagesByChatId(numericIdForLazy);
        var chatRecordForLazy = CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForLazy];
        if (!chatRecordForLazy) return;
        var pendingMsgsForLazy = Array.isArray(chatRecordForLazy.messages)
          ? chatRecordForLazy.messages.filter(function (mForLazy) { return mForLazy && mForLazy._persistedToDb === false; })
          : [];
        chatRecordForLazy.messages = freshMsgsForLazy.map(function (mForLazy) {
          return Object.assign({}, mForLazy, { _persistedToDb: true });
        });
        if (pendingMsgsForLazy.length > 0) {
          Array.prototype.push.apply(chatRecordForLazy.messages, pendingMsgsForLazy);
        }
        chatMessagesLoadedSetForPanelRuntime.add(numericIdForLazy);
        syncSearchIndexForPanelRuntime('chats', 'update', numericIdForLazy, chatRecordForLazy);
      } catch (eForLazy) {}
    }

    function getMsgById(msgId) {
      return getActiveChatMessagesForPanelRuntime().find(m => m.id === msgId) || null;
    }

    function resolveImageBlobRefsForPanelRuntime(md) {
      return String(md).replace(/__blob:(\d+)__/g, function (match, idStr) {
        const dataUrl = GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME[Number(idStr)];
        return dataUrl || match;
      });
    }

    function loadGeneratedBlobsForMessagesForPanelRuntime(messages) {
      const panelDataRepoForBlobLoad = (globalThis.ABChatShared || {}).panelDataRepo;
      if (!panelDataRepoForBlobLoad || typeof panelDataRepoForBlobLoad.getAttachmentBlob !== 'function') {
        return Promise.resolve();
      }
      const imageBlobRefRegexForLoad = /__blob:(\d+)__/g;
      const docBlobRefRegexForLoad = /#abchat-docblob-(\d+)/g;
      const imageIdsToLoad = [];
      const docIdsToLoad = [];
      for (var bmi = 0; bmi < messages.length; bmi++) {
        const mdForBlobScan = String((messages[bmi] && messages[bmi].md) || '');
        if (!mdForBlobScan) continue;
        imageBlobRefRegexForLoad.lastIndex = 0;
        var matchForBlobScan;
        while ((matchForBlobScan = imageBlobRefRegexForLoad.exec(mdForBlobScan)) !== null) {
          const blobIdForScan = Number(matchForBlobScan[1]);
          if (!GENERATED_IMAGE_BLOB_CACHE_FOR_PANEL_RUNTIME[blobIdForScan]) imageIdsToLoad.push(blobIdForScan);
        }
        docBlobRefRegexForLoad.lastIndex = 0;
        while ((matchForBlobScan = docBlobRefRegexForLoad.exec(mdForBlobScan)) !== null) {
          const docBlobIdForScan = Number(matchForBlobScan[1]);
          if (!GENERATED_DOCUMENT_BLOB_CACHE_FOR_PANEL_RUNTIME[docBlobIdForScan]) docIdsToLoad.push(docBlobIdForScan);
        }
      }
      if (!imageIdsToLoad.length && !docIdsToLoad.length) return Promise.resolve();
      var imageLoadsForPanelRuntime = imageIdsToLoad.map(function (blobIdForLoad) {
        return panelDataRepoForBlobLoad.getAttachmentBlob(blobIdForLoad).then(function (rec) {
          if (rec && typeof rec.dataUrl === 'string' && rec.dataUrl.indexOf('data:image/') === 0) {
            setImageBlobCacheForPanelRuntime(blobIdForLoad, rec.dataUrl);
          }
        }).catch(function () {});
      });
      var docLoadsForPanelRuntime = docIdsToLoad.map(function (blobIdForLoad) {
        return panelDataRepoForBlobLoad.getAttachmentBlob(blobIdForLoad).then(function (rec) {
          if (rec && typeof rec.dataUrl === 'string' && rec.dataUrl.indexOf('data:') === 0) {
            setDocumentBlobCacheForPanelRuntime(blobIdForLoad, rec);
          }
        }).catch(function () {});
      });
      return Promise.all(imageLoadsForPanelRuntime.concat(docLoadsForPanelRuntime)).then(function () {});
    }

    function renderChatMessages() {
      const container = root.getElementById('chat-messages-content');
      if (!container) return;

      const messages = getActiveChatMessagesForPanelRuntime();
      const activeChatRecordForRender = S.activeChatId ? CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId] : null;
      const compactedThroughIdForRender = activeChatRecordForRender ? activeChatRecordForRender.compactedThroughMessageId : null;
      let compactionMarkerInsertedForRender = false;
      let html = '';
      let i = 0;
      let lastUserMsgIndex = null;

      // Tracks memory/skill write tool calls observed since the last user message,
      // so the assistant bubble can show a "Saved to memory" / "Saved as skill" badge
      // when one or more of those tool calls actually fired this turn.
      let memoryActionsSinceLastUserMsgForRender = { memory: false, skill: false };

      // Buffer for merging consecutive assistant text messages into one bubble.
      let asstMergeBuffer = [];
      function flushAsstBuffer() {
        if (!asstMergeBuffer.length) return;
        const mergedMd = asstMergeBuffer.map(function (b) { return resolveImageBlobRefsForPanelRuntime(b.md); }).join('\n\n');
        const last = asstMergeBuffer[asstMergeBuffer.length - 1];
        const hasGenImageForFlush = asstMergeBuffer.some(function (b) { return /__blob:\d+__/.test(b.md); });
        const showSavedMemoryBadgeForFlush = asstMergeBuffer.some(function (b) { return b.savedMemory; });
        const showSavedSkillBadgeForFlush = asstMergeBuffer.some(function (b) { return b.savedSkill; });
        const isIncompleteForFlush = asstMergeBuffer.some(function (b) { return b.incomplete; });
        const incompleteNoteHtmlForFlush = isIncompleteForFlush
          ? '<div class="msg-incomplete-note" title="This response was stopped before it finished">Response stopped before completion</div>'
          : '';
        const memoryBadgeHtmlForFlush =
          (showSavedMemoryBadgeForFlush
            ? '<div class="msg-memory-badge" title="A memory entry was saved this turn"><span class="msg-memory-badge-dot"></span> Saved to memory</div>'
            : '')
          + (showSavedSkillBadgeForFlush
            ? '<div class="msg-memory-badge" title="A skill was saved this turn"><span class="msg-memory-badge-dot"></span> Saved as skill</div>'
            : '');
        const allSourcesForFlush = [];
        asstMergeBuffer.forEach(function(b) {
          if (Array.isArray(b.searchSources)) {
            b.searchSources.forEach(function(s) {
              if (s && s.url && (s.url.indexOf('http://') === 0 || s.url.indexOf('https://') === 0)) {
                allSourcesForFlush.push(s);
              }
            });
          }
        });
        const sourcesHtml = allSourcesForFlush.length > 0
          ? '<div class="msg-sources">' +
              '<button class="msg-sources-toggle" data-action="toggle-msg-sources">&#9658; Sources (' + allSourcesForFlush.length + ')</button>' +
              '<div class="msg-sources-list">' +
              allSourcesForFlush.map(function(s) {
                const label = s.title ? escHtml(s.title) : escHtml(s.url);
                return '<a href="' + escHtml(s.url) + '" target="_blank" rel="noopener noreferrer" class="msg-source-link">' + label + '</a>';
              }).join('') +
              '</div>' +
            '</div>'
          : '';
        const ddHtml =
          '<div class="msg-options-wrap">' +
            '<button class="msg-options-trigger" title="Message options" aria-label="Message options" data-action="toggle-message-dropdown">&#xB7;&#xB7;&#xB7;</button>' +
            '<div class="msg-options-dropdown">' +
              (hasGenImageForFlush ? '' : '<button class="msg-dd-item" data-action="copy-message" data-message-id="' + last.msgId + '">Copy</button>') +
              '<button class="msg-dd-item" data-action="hide-pair" data-pair-msg-id="' + last.pairMsgId + '">Hide</button>' +
              '<button class="msg-dd-item" data-action="fork-chat-from-message" data-message-id="' + last.msgId + '">Fork</button>' +
            '</div>' +
          '</div>';
        html +=
          '<div class="msg-wrap">' +
            '<div class="msg-bubble asst has-options">' +
              ddHtml +
              '<div class="msg-text">' + renderMarkdown(mergedMd) + '</div>' +
              incompleteNoteHtmlForFlush +
              memoryBadgeHtmlForFlush +
              sourcesHtml +
            '</div>' +
          '</div>';
        asstMergeBuffer = [];
      }

      while (i < messages.length) {
        const msg = messages[i];

        // Insert the compaction separator once, right before the first message after the folded range.
        if (!compactionMarkerInsertedForRender && compactedThroughIdForRender != null) {
          const prevMsg = i > 0 ? messages[i - 1] : null;
          if (prevMsg && String(prevMsg.id) === String(compactedThroughIdForRender)) {
            flushAsstBuffer();
            html += '<div class="compaction-marker"><div class="compaction-marker-line"></div><span class="compaction-marker-label">Context condensed above this point</span><div class="compaction-marker-line"></div></div>';
            compactionMarkerInsertedForRender = true;
          }
        }

        // Skip legacy placeholder entries — indicators are now generated dynamically
        if (msg.role === '_hidden_pair_indicator') {
          i++;
          continue;
        }

        // Hide internal tool exchange rows from the visible chat timeline.
        // Assistant text attached to tool calls is pre-tool chatter, not a final reply.
        // These do not interrupt the assistant merge buffer since they are invisible.
        const isToolRoleMessageForPanelRuntime = msg.role === 'tool';
        const hasToolCallAssistantPayloadForPanelRuntime = msg.role === 'assistant'
          && Array.isArray(msg.tool_calls)
          && msg.tool_calls.length > 0;
        if (isToolRoleMessageForPanelRuntime || hasToolCallAssistantPayloadForPanelRuntime) {
          if (hasToolCallAssistantPayloadForPanelRuntime) {
            for (var tcIdxForBadge = 0; tcIdxForBadge < msg.tool_calls.length; tcIdxForBadge++) {
              const classifiedForBadge = classifyToolCallForMemoryGuardForPanelRuntime(msg.tool_calls[tcIdxForBadge]);
              if (classifiedForBadge === 'memory') memoryActionsSinceLastUserMsgForRender.memory = true;
              else if (classifiedForBadge === 'skill') memoryActionsSinceLastUserMsgForRender.skill = true;
            }
          }
          i++;
          continue;
        }

        if (msg.role === '_loading') {
          flushAsstBuffer();
          html += `<div class="msg-loading">
      <div class="ld"></div><div class="ld"></div><div class="ld"></div>
    </div>`;
          i++;
          continue;
        }

        // Collect a run of consecutive hidden pairs and emit one indicator for them
        if (msg.role === 'user' && S.hiddenPairIds.has(msg.id)) {
          flushAsstBuffer();
          memoryActionsSinceLastUserMsgForRender = { memory: false, skill: false };
          const hiddenIds = [];
          while (i < messages.length && messages[i].role === 'user' && S.hiddenPairIds.has(messages[i].id)) {
            hiddenIds.push(messages[i].id);
            i++;
            while (i < messages.length && messages[i].role !== 'user') i++;
          }
          const pairLabel = hiddenIds.length === 1 ? '1 pair' : `${hiddenIds.length} pairs`;
          html += `<div class="hidden-pair-indicator" data-hidden-ids="${hiddenIds.join(',')}">
      <div class="hpi-line"></div>
      <span class="hpi-link" data-action="show-hidden-pair">show hidden messages &nbsp;·&nbsp; ${pairLabel}</span>
      <div class="hpi-line"></div>
    </div>`;
          continue;
        }

        const isUser = msg.role === 'user';
        if (isUser) lastUserMsgIndex = i;
        const pairMsgId = isUser ? msg.id : (lastUserMsgIndex !== null ? messages[lastUserMsgIndex].id : null);

        // Assistant messages with text are buffered and merged into one bubble.
        if (!isUser) {
          const mdText = String(msg.md || msg.content || '').trim();
          if (mdText) {
            asstMergeBuffer.push({
              md: mdText,
              pairMsgId: pairMsgId,
              msgId: msg.id,
              searchSources: Array.isArray(msg.searchSources) ? msg.searchSources : [],
              savedMemory: memoryActionsSinceLastUserMsgForRender.memory,
              savedSkill: memoryActionsSinceLastUserMsgForRender.skill,
              incomplete: Boolean(msg.incomplete)
            });
          }
          i++;
          continue;
        }

        // User message: flush any buffered assistant text first, then render user bubble.
        flushAsstBuffer();
        // Reset the per-turn memory/skill tracker now that we've entered a new turn.
        memoryActionsSinceLastUserMsgForRender = { memory: false, skill: false };

        const isEditingMessageForPanelRuntime = S.chatEditingMsgId === msg.id;

        const chipsHtml = (msg.chips || []).length
          ? `<div class="msg-chips">${(msg.chips).map(function (c, chipIndexForPanelRuntime) {
              const chipTypeForPanelRuntime = String((c && c.type) || 'file').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
              const chipLabelForPanelRuntime = escHtml(truncateChipLabelForPanelRuntime(String((c && c.label) || 'Attachment')));
              const chipHiddenStyleForPanelRuntime = (c && c.kind === 'generated_image') ? ' style="display:none"' : '';
              const chipActionAttrsForPanelRuntime = chipTypeForPanelRuntime === 'page-snapshot'
                ? ''
                : ` data-action="preview-message-chip" data-message-id="${Number(msg.id) || 0}" data-chip-index="${chipIndexForPanelRuntime}"`;
              return `<span class="m-chip m-chip-${chipTypeForPanelRuntime}"${chipHiddenStyleForPanelRuntime}${chipActionAttrsForPanelRuntime}>${CHIP_SVGS[chipTypeForPanelRuntime] || ''} ${chipLabelForPanelRuntime}</span>`;
            }).join('')}</div>`
          : '';

        const editingValueForPanelRuntime = getEditableUserMessageValueForPanelRuntime(msg);
        const contentHtml = isEditingMessageForPanelRuntime
          ? `<textarea class="msg-edit-textarea" data-chat-edit-msg-id="${msg.id}" rows="4">${escHtml(editingValueForPanelRuntime)}</textarea>`
          : `<div class="msg-text">${renderUserMsgContent(msg.content)}</div>`;

        const messageDropdownItemsHtml =
          `<button class="msg-dd-item" data-action="start-chat-edit" data-chat-edit-msg-id="${msg.id}">Edit</button>
    <button class="msg-dd-item" data-action="copy-message" data-message-id="${msg.id}">Copy</button>
    <button class="msg-dd-item" data-action="hide-pair" data-pair-msg-id="${pairMsgId}">Hide</button>`;

        const messageDropdownHtml = !isEditingMessageForPanelRuntime
          ? `<div class="msg-options-wrap">
      <button class="msg-options-trigger" title="Message options" aria-label="Message options" data-action="toggle-message-dropdown">&#xB7;&#xB7;&#xB7;</button>
      <div class="msg-options-dropdown">
        ${messageDropdownItemsHtml}
      </div>
    </div>`
          : '';

        const actionsHtml = isEditingMessageForPanelRuntime
          ? `<div class="msg-actions-bar">
      <button class="ma-btn ma-btn-save" data-action="save-chat-edit" data-chat-edit-msg-id="${msg.id}">Save</button>
      <button class="ma-btn ma-btn-cancel" data-action="cancel-chat-edit">Cancel</button>
    </div>`
          : '';

        html += `<div class="msg-wrap user-msg${isEditingMessageForPanelRuntime ? ' is-editing' : ''}">
      <div class="msg-bubble user${messageDropdownHtml ? ' has-options' : ''}">
        ${messageDropdownHtml}${chipsHtml}${contentHtml}
        ${actionsHtml}
      </div>
    </div>`;
        i++;
      }

      flushAsstBuffer();

      container.innerHTML = html;
      hydrateGeneratedImagesForPanelRuntime(container);
      return hydrateRenderedMarkdownForPanelRuntime(container);
    }

    function startChatEditForPanelRuntime(msgId) {
      if (!Number.isFinite(msgId)) return;
      const editableMessageForPanelRuntime = getMsgById(msgId);
      if (!editableMessageForPanelRuntime || editableMessageForPanelRuntime.role !== 'user') return;
      S.chatEditingMsgId = msgId;
      renderChatMessages();
      const editTextareaForPanelRuntime = root.querySelector(
        `.msg-edit-textarea[data-chat-edit-msg-id="${msgId}"]`
      );
      if (editTextareaForPanelRuntime && typeof editTextareaForPanelRuntime.focus === 'function') {
        editTextareaForPanelRuntime.focus();
        const editTextLengthForPanelRuntime = editTextareaForPanelRuntime.value.length;
        if (typeof editTextareaForPanelRuntime.setSelectionRange === 'function') {
          editTextareaForPanelRuntime.setSelectionRange(editTextLengthForPanelRuntime, editTextLengthForPanelRuntime);
        }
      }
    }

    async function saveChatEditForPanelRuntime(msgId) {
      if (!Number.isFinite(msgId)) return;
      if (!S.activeChatId) return;
      const editableMessageForPanelRuntime = getMsgById(msgId);
      if (!editableMessageForPanelRuntime || editableMessageForPanelRuntime.role !== 'user') return;
      const editTextareaForPanelRuntime = root.querySelector(
        `.msg-edit-textarea[data-chat-edit-msg-id="${msgId}"]`
      );
      if (!editTextareaForPanelRuntime) return;
      const nextMessageValueForPanelRuntime = (editTextareaForPanelRuntime.value || '').trim();
      if (!nextMessageValueForPanelRuntime) return;

      const editedMessageForPanelRuntime = cloneMessageRecordForPanelRuntime(editableMessageForPanelRuntime);
      editedMessageForPanelRuntime.role = 'user';
      editedMessageForPanelRuntime.content = nextMessageValueForPanelRuntime;
      editedMessageForPanelRuntime.md = nextMessageValueForPanelRuntime;

      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.bulkReplaceMessagesFromIndex === 'function') {
        try {
          const nextMessagesForPanelRuntime = await panelDataRepoForPanelRuntime.bulkReplaceMessagesFromIndex(
            S.activeChatId,
            msgId,
            [editedMessageForPanelRuntime]
          );
          if (CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId]) {
            CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId].messages = Array.isArray(nextMessagesForPanelRuntime)
              ? nextMessagesForPanelRuntime.map(cloneMessageRecordForPanelRuntime)
              : [];
            CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId].summary = getChatSummaryFromMessagesForPanelRuntime(
              CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId].messages
            );
            CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId].updatedAt = new Date().toISOString();
          }
          upsertChatUiForPanelRuntime(S.activeChatId, true);
        } catch (errorForPanelRuntime) {
          return;
        }
      } else {
        const activeMessagesForPanelRuntime = getActiveChatMessagesForPanelRuntime();
        const startIndexForPanelRuntime = activeMessagesForPanelRuntime.findIndex(function (messageForPanelRuntime) {
          return Number(messageForPanelRuntime && messageForPanelRuntime.id) === Number(msgId);
        });
        if (startIndexForPanelRuntime < 0) return;
        activeMessagesForPanelRuntime.splice(startIndexForPanelRuntime);
        activeMessagesForPanelRuntime.push(editedMessageForPanelRuntime);
      }

      S.hiddenPairIds = new Set();
      S.chatEditingMsgId = null;
      renderChatMessages();
      await sendChatForPanelRuntime({ skipUserAppend: true, chatId: S.activeChatId });
    }

    function cancelChatEditForPanelRuntime() {
      if (S.chatEditingMsgId === null) return;
      S.chatEditingMsgId = null;
      renderChatMessages();
    }

    /* ============================================================
      MODE
    ============================================================ */
    function setMode(mode, optionsForPanelRuntime) {
      const optsForModeForPanelRuntime = optionsForPanelRuntime || {};
      S.mode = mode;
      if (!optsForModeForPanelRuntime.skipStateSync) {
        writePanelStateSyncForPanelRuntime({ mode: mode });
      }
      host.classList.remove('mode-expanded', 'mode-reduced');
      host.classList.add('mode-' + mode);
      const btn = root.getElementById('btn-mode');
      btn.textContent = mode === 'expanded' ? '⊡ Reduced View' : '⊞ Expanded View';

      if (mode === 'expanded') {
        // In expanded mode both sidebar and content are visible side-by-side,
        // so drill-down classes are not needed. The stored S.pane<Tab> values
        // are intentionally preserved so the prior reduced-view pane is
        // restored when the user switches back to reduced mode.
        root.getElementById('view-chats').classList.remove('in-chat');
        root.getElementById('view-notes').classList.remove('in-editor');
        root.getElementById('view-tasks').classList.remove('in-editor');
        root.getElementById('view-quiz').classList.remove('in-editor');
        S.inChatView = false;
        S.inNoteView = false;
        // Reset panel position (expanded is centered via CSS)
        host.style.left = '';
        host.style.top = '';
        host.style.right = '';
      } else {
        // Switching to reduced: sidebars must be visible (collapse is an expanded-only feature).
        if (S.sidebarCollapsed) expandSidebar();
        if (S.notesSidebarCollapsed) expandNotesSidebar();

        // Restore the last-visible pane per tab from stored intent. 1c
        // fallback (detail → list when active record doesn't resolve) is
        // handled inside applyPaneClassForTabForPanelRuntime.
        applyPaneClassForTabForPanelRuntime('chats', S.paneChats);
        applyPaneClassForTabForPanelRuntime('notes', S.paneNotes);
        applyPaneClassForTabForPanelRuntime('tasks', S.paneTasks);
        applyPaneClassForTabForPanelRuntime('questions', S.paneQuestions);
        S.inChatView = S.paneChats === 'detail';
        S.inNoteView = S.paneNotes === 'detail';

        // Restore the panel's last-known reduced-view position. Prefer a
        // remote-synced anchor stashed while we were in expanded mode; fall
        // back to this tab's own last anchor (set on local drag-end or a
        // prior remote apply). Without this fallback, expanded→reduced
        // resets the panel to the CSS default (top-left) even though the
        // user had dragged it elsewhere in this same tab.
        const anchorToRestoreForPanelRuntime =
          (typeof pendingSyncedPanelAnchorForPanelRuntime !== 'undefined' &&
            pendingSyncedPanelAnchorForPanelRuntime)
            ? pendingSyncedPanelAnchorForPanelRuntime
            : currentPanelAnchorForPanelRuntime;
        if (anchorToRestoreForPanelRuntime) {
          applyPanelAnchorInlineForPanelRuntime(
            anchorToRestoreForPanelRuntime,
            host.offsetWidth, host.offsetHeight
          );
          pendingSyncedPanelAnchorForPanelRuntime = null;
        }
      }
      updateChatBackTitleForPanelRuntime();
    }

    function toggleMode() {
      setMode(S.mode === 'expanded' ? 'reduced' : 'expanded');
    }

    /* ============================================================
      THEME
    ============================================================ */
    function setTheme(theme) {
      const previousThemeForSet = S.theme;
      S.theme = theme;
      host.dataset.theme = theme;
      overlay.dataset.theme = theme;
      pickerOverlay.dataset.theme = theme;
      if (featureTourOverlayForPanelRuntime) featureTourOverlayForPanelRuntime.dataset.theme = theme;
      const btn = root.getElementById('btn-theme');
      btn.innerHTML = theme === 'dark' ? (ic.sun13 + ' Light Mode') : (ic.moon13 + ' Dark Mode');
      if (previousThemeForSet && previousThemeForSet !== theme) {
        refreshMermaidForThemeChangeForPanelRuntime();
      }
    }

    function refreshMermaidForThemeChangeForPanelRuntime() {
      if (typeof window === 'undefined' || !window.mermaid || typeof window.mermaid.initialize !== 'function') return;
      // Force the next initializeMermaidForPanelRuntime call to reapply with the
      // current theme; without this, the early-return on theme match skips the
      // mermaid.initialize call that flips its internal palette.
      mermaidAppliedThemeForPanelRuntime = null;
      if (!initializeMermaidForPanelRuntime()) return;
      const renderedNodesForThemeRefresh = Array.from(
        root.querySelectorAll('.mermaid')
      );
      renderedNodesForThemeRefresh.forEach(function (nodeForThemeRefresh) {
        const sourceForThemeRefresh = nodeForThemeRefresh.dataset && nodeForThemeRefresh.dataset.abchatMermaidSource;
        if (!sourceForThemeRefresh) return;
        nodeForThemeRefresh.textContent = sourceForThemeRefresh;
        delete nodeForThemeRefresh.dataset.abchatMermaidRendered;
        delete nodeForThemeRefresh.dataset.abchatMermaidRendering;
        delete nodeForThemeRefresh.dataset.abchatMermaidError;
        delete nodeForThemeRefresh.dataset.abchatMermaidBaseWidth;
        delete nodeForThemeRefresh.dataset.abchatMermaidBaseHeight;
        const wrapForThemeRefresh = nodeForThemeRefresh.closest('.mermaid-export-wrap');
        if (wrapForThemeRefresh && wrapForThemeRefresh.dataset) {
          delete wrapForThemeRefresh.dataset.abchatMermaidZoom;
        }
      });
      // Render across the whole shadow root so all four top-level elements
      // (#panel-host, #inline-overlay, #picker-overlay, #attach-preview-overlay)
      // are covered, per CLAUDE.md §20.
      renderMermaidWhenVisibleForContainerForPanelRuntime(root, 12);
    }

    function toggleTheme() {
      setTheme(S.theme === 'dark' ? 'light' : 'dark');
    }

    function applyThemeFromSettings(val, skipSave) {
      if (val === 'system') {
        const pref = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        setTheme(pref);
      } else {
        setTheme(val);
      }
      if (!skipSave) {
        chrome.storage.local.set({ [THEME_KEY_FOR_PANEL_RUNTIME]: val });
      }
    }

    function loadThemeIntoSettingsForPanelRuntime() {
      chrome.storage.local.get([THEME_KEY_FOR_PANEL_RUNTIME], function (res) {
        const saved = (res && res[THEME_KEY_FOR_PANEL_RUNTIME]) || 'light';
        applyThemeFromSettings(saved, true);
        const sel = root.querySelector('[data-action="apply-theme-settings"]');
        if (sel) sel.value = saved;
      });
    }

    var themeStorageSyncListenerForPanelRuntime = null;
    function bindThemeStorageSyncForPanelRuntime() {
      try {
        if (themeStorageSyncListenerForPanelRuntime) {
          chrome.storage.onChanged.removeListener(themeStorageSyncListenerForPanelRuntime);
          themeStorageSyncListenerForPanelRuntime = null;
        }
        var capturedGenForThemeSync = window.abchatListenerGeneration || 0;
        themeStorageSyncListenerForPanelRuntime = function themeStorageSyncHandlerForPanelRuntime(changes, area) {
          if ((window.abchatListenerGeneration || 0) !== capturedGenForThemeSync) {
            chrome.storage.onChanged.removeListener(themeStorageSyncListenerForPanelRuntime);
            themeStorageSyncListenerForPanelRuntime = null;
            return;
          }
          if (area !== 'local' || !changes[THEME_KEY_FOR_PANEL_RUNTIME]) return;
          const incomingThemeForPanelRuntime = changes[THEME_KEY_FOR_PANEL_RUNTIME].newValue;
          if (typeof incomingThemeForPanelRuntime !== 'string' || !incomingThemeForPanelRuntime) return;
          const selForThemeSync = root.querySelector('[data-action="apply-theme-settings"]');
          if (selForThemeSync && selForThemeSync.value === incomingThemeForPanelRuntime) {
            // Already matches — likely our own write echo; only resolved theme could differ for 'system'
            return;
          }
          applyThemeFromSettings(incomingThemeForPanelRuntime, true);
          if (selForThemeSync) selForThemeSync.value = incomingThemeForPanelRuntime;
        };
        chrome.storage.onChanged.addListener(themeStorageSyncListenerForPanelRuntime);
      } catch (e) {}
    }

    /* ============================================================
      TABS
    ============================================================ */
    function setTab(tab, optionsForPanelRuntime) {
      const optsForTabForPanelRuntime = optionsForPanelRuntime || {};
      S.tab = tab;
      if (!optsForTabForPanelRuntime.skipStateSync) {
        writePanelStateSyncForPanelRuntime({ tab: tab });
      }
      root.querySelectorAll('.tab-btn[data-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      root.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('hidden', v.id !== 'view-' + tab);
      });
      if (tab === 'chats') {
        var chatTaForTabFocus = root.querySelector('.chat-textarea');
        if (chatTaForTabFocus) setTimeout(function() { chatTaForTabFocus.focus(); }, 0);
      }
      if (tab === 'settings') {
        var agentRulesTaForTab = root.getElementById('settings-agent-rules-input');
        if (agentRulesTaForTab) setTimeout(function() { updateAutoExpandForTextareaForPanelRuntime(agentRulesTaForTab); }, 0);
        loadStorageEstimateForPanelRuntime();
        loadDeleteChatsOlderThanSettingForPanelRuntime();
        refreshAgentManageCountsForPanelRuntime();
      }
      if (tab === 'skills') {
        loadSkillsViewForPanelRuntime();
      }
      if (tab === 'memory') {
        loadMemoryViewForPanelRuntime();
      }
    }

    /* ============================================================
      CONTENT SELECTOR TOGGLE
    ============================================================ */
    function toggleSelector(btn) {
      if (!btn) return;
      var nsForSelector = globalThis.ABChatContent || {};
      var contentSelectorToolForToggle = nsForSelector.tools && nsForSelector.tools.contentSelector
        ? nsForSelector.tools.contentSelector
        : null;
      if (!contentSelectorToolForToggle || typeof contentSelectorToolForToggle.setEnabled !== 'function') {
        btn.classList.toggle('active');
        return;
      }
      var isCurrentlyEnabledForToggle = Boolean(nsForSelector.state && nsForSelector.state.isContentSelectorEnabled);
      contentSelectorToolForToggle.setEnabled(!isCurrentlyEnabledForToggle);
      // Button active state is synced by setEnabled via syncSelectorButtonStateForContentSelector
    }

    /* ============================================================
      CHAT SIDEBAR
    ============================================================ */
    function collapseSidebar() {
      S.sidebarCollapsed = true;
      root.getElementById('chat-sidebar').classList.add('collapsed');
      root.getElementById('chat-main').classList.add('sidebar-is-collapsed');
      writePanelStateSyncForPanelRuntime({ sidebarCollapsed: true });
    }

    function expandSidebar() {
      S.sidebarCollapsed = false;
      root.getElementById('chat-sidebar').classList.remove('collapsed');
      root.getElementById('chat-main').classList.remove('sidebar-is-collapsed');
      writePanelStateSyncForPanelRuntime({ sidebarCollapsed: false });
    }

    /* ============================================================
      NOTES SIDEBAR
    ============================================================ */
    function collapseNotesSidebar() {
      S.notesSidebarCollapsed = true;
      root.querySelector('.notes-sidebar').classList.add('collapsed');
      root.getElementById('note-editor').classList.add('notes-sidebar-is-collapsed');
      writePanelStateSyncForPanelRuntime({ notesSidebarCollapsed: true });
    }

    function expandNotesSidebar() {
      S.notesSidebarCollapsed = false;
      root.querySelector('.notes-sidebar').classList.remove('collapsed');
      root.getElementById('note-editor').classList.remove('notes-sidebar-is-collapsed');
      writePanelStateSyncForPanelRuntime({ notesSidebarCollapsed: false });
    }

    function refreshChatGroupLabelsVisibilityForPanelRuntime() {
      const chatListForPanelRuntime = root.querySelector('.chat-list');
      if (!chatListForPanelRuntime) return;
      const isQuickQViewForPanelRuntime = (S.chatType || 'chats') === 'quickq';
      chatListForPanelRuntime.querySelectorAll('.chat-group-label').forEach(function (labelForPanelRuntime) {
        if (isQuickQViewForPanelRuntime) {
          labelForPanelRuntime.style.display = 'none';
          return;
        }
        let siblingForPanelRuntime = labelForPanelRuntime.nextElementSibling;
        let hasVisibleForPanelRuntime = false;
        while (siblingForPanelRuntime && !siblingForPanelRuntime.classList.contains('chat-group-label')) {
          if (
            siblingForPanelRuntime.classList.contains('chat-item') &&
            siblingForPanelRuntime.dataset.chatType !== 'quickq' &&
            siblingForPanelRuntime.style.display !== 'none'
          ) {
            hasVisibleForPanelRuntime = true;
            break;
          }
          siblingForPanelRuntime = siblingForPanelRuntime.nextElementSibling;
        }
        labelForPanelRuntime.style.display = hasVisibleForPanelRuntime ? '' : 'none';
      });
      const allLabelsForFirst = chatListForPanelRuntime.querySelectorAll('.chat-group-label');
      let foundFirstForFirst = false;
      allLabelsForFirst.forEach(function (labelForFirst) {
        if (!foundFirstForFirst && labelForFirst.style.display !== 'none') {
          labelForFirst.classList.add('is-first-visible');
          foundFirstForFirst = true;
        } else {
          labelForFirst.classList.remove('is-first-visible');
        }
      });
    }

    // Attaches an IntersectionObserver sentinel div immediately after the list container.
    // When the sentinel scrolls into view (including the 300px look-ahead margin) the
    // callback fires and appends the next page of items. This is the core of sidebar
    // windowing; all four list types use this same helper.
    // REGRESSION RISK: the sentinel must be placed AFTER the list container, not inside it,
    // so the observer fires as the user approaches the bottom of the rendered items.
    function renderNextPickerPageForPanelRuntime() {
      const listForPickerPage = root.getElementById('pk-list');
      if (!listForPickerPage) return;
      const startForPickerPage = pickerRenderedCountForPanelRuntime;
      const endForPickerPage = Math.min(startForPickerPage + PICKER_PAGE_SIZE_FOR_PANEL_RUNTIME, pickerCurrentItemsForPanelRuntime.length);
      if (startForPickerPage >= endForPickerPage) return;
      pickerRenderedCountForPanelRuntime = endForPickerPage;
      for (var iForPickerPage = startForPickerPage; iForPickerPage < endForPickerPage; iForPickerPage++) {
        const itemForPickerPage = pickerCurrentItemsForPanelRuntime[iForPickerPage];
        const typeForPickerPage = pickerCurrentTypeForPanelRuntime;
        const divForPickerPage = document.createElement('div');
        divForPickerPage.className = 'pk-item';
        divForPickerPage.innerHTML =
          `<div class="pk-item-icon ${typeForPickerPage === 'chat' ? 'chat-icon' : ''}">${typeForPickerPage === 'note' ? ic.fileText14 : ic.message14}</div>` +
          `<div class="pk-item-body">` +
          `<div class="pk-item-title">${escHtml(itemForPickerPage.title)}</div>` +
          `<div class="pk-item-excerpt">${escHtml(itemForPickerPage.excerpt)}</div>` +
          (itemForPickerPage.tags && itemForPickerPage.tags.length
            ? '<div class="pk-item-tags">' + itemForPickerPage.tags.map(function(tForPickerPage) { return `<span class="pk-tag">${escHtml(tForPickerPage)}</span>`; }).join('') + '</div>'
            : '') +
          `</div>`;
        divForPickerPage.onclick = (function(capturedItemForPicker, capturedTypeForPicker) {
          return function() { selectPickerItem(capturedItemForPicker, capturedTypeForPicker); };
        }(itemForPickerPage, typeForPickerPage));
        listForPickerPage.appendChild(divForPickerPage);
      }
    }

    function setupPickerSentinelForPanelRuntime(listElForPickerSentinel) {
      if (!listElForPickerSentinel || typeof IntersectionObserver !== 'function') return;
      if (pickerObserverForPanelRuntime) {
        pickerObserverForPanelRuntime.disconnect();
        pickerObserverForPanelRuntime = null;
      }
      var sentinelForPicker = document.createElement('div');
      sentinelForPicker.style.cssText = 'height:1px;pointer-events:none;';
      listElForPickerSentinel.appendChild(sentinelForPicker);
      pickerObserverForPanelRuntime = new IntersectionObserver(function(entriesForPickerSentinel) {
        entriesForPickerSentinel.forEach(function(entryForPickerSentinel) {
          if (entryForPickerSentinel.isIntersecting) renderNextPickerPageForPanelRuntime();
        });
      }, { root: listElForPickerSentinel, rootMargin: '150px' });
      pickerObserverForPanelRuntime.observe(sentinelForPicker);
    }

    function setupListSentinelForPanelRuntime(listElForSentinel, onVisibleForSentinel) {
      if (!listElForSentinel || typeof IntersectionObserver !== 'function') return;
      var sentinelForList = document.createElement('div');
      sentinelForList.className = 'abchat-list-sentinel';
      sentinelForList.style.cssText = 'height:1px;pointer-events:none;';
      listElForSentinel.after(sentinelForList);
      new IntersectionObserver(function (entriesForSentinel) {
        entriesForSentinel.forEach(function (entryForSentinel) {
          if (entryForSentinel.isIntersecting) onVisibleForSentinel();
        });
      }, { rootMargin: '300px' }).observe(sentinelForList);
    }

    // Sentinel callbacks: each function renders the next SIDEBAR_PAGE_SIZE items for its
    // list. renderedXxxCount is updated BEFORE the render loop so that syncMainXxxListItem's
    // window guard sees the new boundary and does not skip the items being added.
    // SCALABILITY: if you add a new list type you need a matching renderNextXxxPage function,
    // a renderedXxxCount variable, and a sentinel wired up in the init IIFE below.
    function renderNextChatPageForPanelRuntime() {
      var startForPage = renderedChatCountForPanelRuntime;
      var endForPage = Math.min(startForPage + SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, CHAT_ORDER_FOR_PANEL_RUNTIME.length);
      if (startForPage >= endForPage) return;
      renderedChatCountForPanelRuntime = endForPage;
      for (var iForPage = startForPage; iForPage < endForPage; iForPage++) {
        syncMainChatListItemForPanelRuntime(CHAT_ORDER_FOR_PANEL_RUNTIME[iForPage]);
      }
      rebuildChatListGroupingForPanelRuntime();
    }

    function renderNextNotePageForPanelRuntime() {
      var startForPage = renderedNoteCountForPanelRuntime;
      var endForPage = Math.min(startForPage + SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, NOTE_ORDER_FOR_PANEL_RUNTIME.length);
      if (startForPage >= endForPage) return;
      renderedNoteCountForPanelRuntime = endForPage;
      for (var iForPage = startForPage; iForPage < endForPage; iForPage++) {
        syncMainNoteListItemForPanelRuntime(NOTE_ORDER_FOR_PANEL_RUNTIME[iForPage]);
      }
    }

    function renderNextTaskPageForPanelRuntime() {
      var startForPage = renderedTaskCountForPanelRuntime;
      var endForPage = Math.min(startForPage + SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, TASK_ORDER_FOR_PANEL_RUNTIME.length);
      if (startForPage >= endForPage) return;
      renderedTaskCountForPanelRuntime = endForPage;
      for (var iForPage = startForPage; iForPage < endForPage; iForPage++) {
        syncMainTaskListItemForPanelRuntime(TASK_ORDER_FOR_PANEL_RUNTIME[iForPage]);
      }
    }

    function renderNextQuizPageForPanelRuntime() {
      var startForPage = renderedQuizCountForPanelRuntime;
      var endForPage = Math.min(startForPage + SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, QUIZ_ORDER_FOR_PANEL_RUNTIME.length);
      if (startForPage >= endForPage) return;
      renderedQuizCountForPanelRuntime = endForPage;
      for (var iForPage = startForPage; iForPage < endForPage; iForPage++) {
        syncMainQuizListItemForPanelRuntime(QUIZ_ORDER_FOR_PANEL_RUNTIME[iForPage]);
      }
    }

    function rebuildChatListGroupingForPanelRuntime() {
      const chatListForPanelRuntime = root.querySelector('.chat-list');
      if (!chatListForPanelRuntime) return;
      chatListForPanelRuntime.querySelectorAll('.chat-group-label').forEach(function (labelForPanelRuntime) {
        labelForPanelRuntime.remove();
      });
      let currentGroupForPanelRuntime = null;
      // Iterate the full CHAT_ORDER (not just the renderedChatCount prefix). Items
      // already in the DOM are processed regardless of where they sit relative to
      // the window cursor; items not yet in the DOM are only lazily created when
      // they fall inside the current window. This self-heals any drift between
      // renderedChatCount and the actual rendered DOM so a stale prepend or a
      // cross-tab refresh can never leave an orphaned chat item above its label.
      CHAT_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForPanelRuntime, idxForChatGroup) {
        const chatDataForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[idForPanelRuntime];
        if (!chatDataForPanelRuntime) return;
        let chatItemForPanelRuntime = chatListForPanelRuntime.querySelector(`.chat-item[data-chat-id="${idForPanelRuntime}"]`);
        if (!chatItemForPanelRuntime) {
          if (idxForChatGroup >= renderedChatCountForPanelRuntime) return;
          syncMainChatListItemForPanelRuntime(idForPanelRuntime);
          chatItemForPanelRuntime = chatListForPanelRuntime.querySelector(`.chat-item[data-chat-id="${idForPanelRuntime}"]`);
        }
        if (!chatItemForPanelRuntime) return;
        if (chatDataForPanelRuntime.type !== 'quickq') {
          const nextGroupForPanelRuntime = getChatGroupLabelByDateForPanelRuntime(chatDataForPanelRuntime);
          if (nextGroupForPanelRuntime !== currentGroupForPanelRuntime) {
            currentGroupForPanelRuntime = nextGroupForPanelRuntime;
            const labelForPanelRuntime = document.createElement('div');
            labelForPanelRuntime.className = 'chat-group-label';
            labelForPanelRuntime.dataset.chatGroup = nextGroupForPanelRuntime;
            labelForPanelRuntime.textContent = nextGroupForPanelRuntime;
            chatListForPanelRuntime.appendChild(labelForPanelRuntime);
          }
        }
        chatListForPanelRuntime.appendChild(chatItemForPanelRuntime);
      });
      refreshChatGroupLabelsVisibilityForPanelRuntime();
    }

    function toggleFavs(btn) {
      btn.classList.toggle('active');
      const on = btn.classList.contains('active');
      btn.innerHTML = on ? (ic.starFilled12 + ' Favs') : (ic.starEmpty12 + ' Favs');
      const isQuickQTabForFavs = (S.chatType || 'chats') === 'quickq';
      root.querySelectorAll('.chat-item').forEach(item => {
        const itemIsQQForFavs = item.dataset.chatType === 'quickq';
        // Only touch items that belong to the currently active sub-tab
        if (itemIsQQForFavs !== isQuickQTabForFavs) return;
        const chatIdForPanelRuntime = Number(item.dataset.chatId);
        const chatDataForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime];
        const isPinnedForPanelRuntime = Boolean(chatDataForPanelRuntime && chatDataForPanelRuntime.isPinned);
        if (on) {
          item.style.display = isPinnedForPanelRuntime ? '' : 'none';
        } else {
          item.style.display = '';
        }
      });
      refreshChatGroupLabelsVisibilityForPanelRuntime();
    }

    async function toggleChatStar(btn) {
      const chatItemForPanelRuntime = btn && btn.closest ? btn.closest('.chat-item') : null;
      if (!chatItemForPanelRuntime) return;
      const chatIdForPanelRuntime = Number(chatItemForPanelRuntime.dataset.chatId);
      if (!Number.isFinite(chatIdForPanelRuntime)) return;
      const chatDataForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime];
      if (!chatDataForPanelRuntime) return;
      const nextPinnedForPanelRuntime = !Boolean(chatDataForPanelRuntime.isPinned);
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateChat === 'function') {
        try {
          const persistedChatForPanelRuntime = await panelDataRepoForPanelRuntime.updateChat(chatIdForPanelRuntime, {
            isPinned: nextPinnedForPanelRuntime,
            updatedAt: chatDataForPanelRuntime.updatedAt
          });
          refreshChatStoreFromPersistedForPanelRuntime(persistedChatForPanelRuntime, { prepend: false });
        } catch (errorForPanelRuntime) {
          return;
        }
      } else {
        CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime].isPinned = nextPinnedForPanelRuntime;
        upsertChatUiForPanelRuntime(chatIdForPanelRuntime, false);
      }
      const favsBtnForPanelRuntime = root.getElementById('favs-btn');
      if (favsBtnForPanelRuntime && favsBtnForPanelRuntime.classList.contains('active')) {
        const isQuickQTabForStar = (S.chatType || 'chats') === 'quickq';
        root.querySelectorAll('.chat-item').forEach(function (itemForPanelRuntime) {
          const itemIsQQForStar = itemForPanelRuntime.dataset.chatType === 'quickq';
          if (itemIsQQForStar !== isQuickQTabForStar) return;
          const itemChatIdForPanelRuntime = Number(itemForPanelRuntime.dataset.chatId);
          const itemChatForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[itemChatIdForPanelRuntime];
          itemForPanelRuntime.style.display = itemChatForPanelRuntime && itemChatForPanelRuntime.isPinned ? '' : 'none';
        });
        refreshChatGroupLabelsVisibilityForPanelRuntime();
      }
    }

    function toggleChatDropdown(btn) {
      const wasOpen = preclickOpenStateForPanelRuntime;
      preclickOpenStateForPanelRuntime = null;
      // closeAllDropdownsForPanelRuntime already ran via the root capture handler
      if (!wasOpen) {
        const dropdown = btn.nextElementSibling;
        if (dropdown) {
          dropdown.classList.add('open');
          btn.closest('.chat-item')?.classList.add('ci-dropdown-open');
        }
      }
    }

    function closeMessageDropdownsForPanelRuntime() {
      root.querySelectorAll('.msg-options-wrap.open').forEach(function (wrapForPanelRuntime) {
        wrapForPanelRuntime.classList.remove('open');
        wrapForPanelRuntime.classList.remove('open-upward');
        wrapForPanelRuntime.classList.remove('open-downward');
        const dropdownForPanelRuntime = wrapForPanelRuntime.querySelector('.msg-options-dropdown');
        if (dropdownForPanelRuntime) {
          dropdownForPanelRuntime.classList.remove('open');
          dropdownForPanelRuntime.style.maxHeight = '';
          dropdownForPanelRuntime.style.overflowY = '';
        }
      });
    }

    function closeAllDropdownsForPanelRuntime() {
      root.querySelectorAll('.ci-dropdown.open').forEach(function(d) {
        d.classList.remove('open');
        d.closest('.chat-item')?.classList.remove('ci-dropdown-open');
      });
      closeMessageDropdownsForPanelRuntime();
      closeAttachPicker();
      const modelDropdown = root.getElementById('model-picker-dropdown');
      const modelBtn = root.getElementById('model-picker-btn');
      if (modelDropdown) modelDropdown.classList.remove('open');
      if (modelBtn) modelBtn.classList.remove('open');
      root.querySelectorAll('.ni-dropdown.open').forEach(function(d) {
        d.classList.remove('open');
        d.closest('.note-item')?.classList.remove('ni-dropdown-open');
      });
    }

    function measureMessageDropdownHeightForPanelRuntime(dropdownForPanelRuntime) {
      if (!dropdownForPanelRuntime) return 0;
      const hadInlineDisplayForPanelRuntime = dropdownForPanelRuntime.style.display;
      const hadInlineVisibilityForPanelRuntime = dropdownForPanelRuntime.style.visibility;
      const hadInlinePointerEventsForPanelRuntime = dropdownForPanelRuntime.style.pointerEvents;
      const hadOpenClassForPanelRuntime = dropdownForPanelRuntime.classList.contains('open');
      if (!hadOpenClassForPanelRuntime) {
        dropdownForPanelRuntime.style.display = 'block';
        dropdownForPanelRuntime.style.visibility = 'hidden';
        dropdownForPanelRuntime.style.pointerEvents = 'none';
      }
      const measuredHeightForPanelRuntime = dropdownForPanelRuntime.getBoundingClientRect().height;
      if (!hadOpenClassForPanelRuntime) {
        dropdownForPanelRuntime.style.display = hadInlineDisplayForPanelRuntime;
        dropdownForPanelRuntime.style.visibility = hadInlineVisibilityForPanelRuntime;
        dropdownForPanelRuntime.style.pointerEvents = hadInlinePointerEventsForPanelRuntime;
      }
      return Math.max(0, measuredHeightForPanelRuntime);
    }

    function positionMessageDropdownForPanelRuntime(wrapForPanelRuntime, dropdownForPanelRuntime) {
      if (!wrapForPanelRuntime || !dropdownForPanelRuntime) return;
      wrapForPanelRuntime.classList.remove('open-upward');
      wrapForPanelRuntime.classList.remove('open-downward');
      dropdownForPanelRuntime.style.maxHeight = '';
      dropdownForPanelRuntime.style.overflowY = '';

      const messagesAreaForPanelRuntime = wrapForPanelRuntime.closest('.messages-area');
      const messagesRectForPanelRuntime = messagesAreaForPanelRuntime
        ? messagesAreaForPanelRuntime.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight || 0 };
      const triggerWrapRectForPanelRuntime = wrapForPanelRuntime.getBoundingClientRect();
      const dropdownHeightForPanelRuntime = measureMessageDropdownHeightForPanelRuntime(dropdownForPanelRuntime);
      const edgeGapForPanelRuntime = 8;
      const spaceBelowForPanelRuntime = Math.max(0, messagesRectForPanelRuntime.bottom - triggerWrapRectForPanelRuntime.bottom - edgeGapForPanelRuntime);
      const spaceAboveForPanelRuntime = Math.max(0, triggerWrapRectForPanelRuntime.top - messagesRectForPanelRuntime.top - edgeGapForPanelRuntime);
      const shouldOpenUpwardForPanelRuntime = spaceBelowForPanelRuntime < dropdownHeightForPanelRuntime && spaceAboveForPanelRuntime > spaceBelowForPanelRuntime;
      const chosenSpaceForPanelRuntime = shouldOpenUpwardForPanelRuntime ? spaceAboveForPanelRuntime : spaceBelowForPanelRuntime;

      wrapForPanelRuntime.classList.add(shouldOpenUpwardForPanelRuntime ? 'open-upward' : 'open-downward');

      if (chosenSpaceForPanelRuntime > 0 && chosenSpaceForPanelRuntime < dropdownHeightForPanelRuntime) {
        dropdownForPanelRuntime.style.maxHeight = Math.max(72, Math.floor(chosenSpaceForPanelRuntime)) + 'px';
        dropdownForPanelRuntime.style.overflowY = 'auto';
      }
    }

    function toggleMessageDropdown(btnForPanelRuntime) {
      if (!btnForPanelRuntime) return;
      const wasOpen = preclickOpenStateForPanelRuntime;
      preclickOpenStateForPanelRuntime = null;
      // closeAllDropdownsForPanelRuntime already ran via the root capture handler
      if (!wasOpen) {
        const wrapForPanelRuntime = btnForPanelRuntime.closest('.msg-options-wrap');
        if (!wrapForPanelRuntime) return;
        const dropdownForPanelRuntime = wrapForPanelRuntime.querySelector('.msg-options-dropdown');
        if (!dropdownForPanelRuntime) return;
        positionMessageDropdownForPanelRuntime(wrapForPanelRuntime, dropdownForPanelRuntime);
        wrapForPanelRuntime.classList.add('open');
        dropdownForPanelRuntime.classList.add('open');
      }
    }

    async function renameChatItem(btn) {
      const item = btn.closest('.chat-item');
      if (!item) return;
      const chatIdForPanelRuntime = Number(item.dataset.chatId);
      if (!Number.isFinite(chatIdForPanelRuntime)) return;
      // Close the dropdown
      const dropdown = item.querySelector('.ci-dropdown');
      if (dropdown) { dropdown.classList.remove('open'); }
      item.classList.remove('ci-dropdown-open');
      // Inline rename: make title editable
      const titleEl = item.querySelector('.chat-item-title');
      if (!titleEl) return;
      const original = titleEl.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = original;
      input.className = 'chat-item-rename-input';
      titleEl.textContent = '';
      titleEl.appendChild(input);
      input.focus();
      input.select();
      let finishingForRename = false;
      const shakeInput = () => {
        input.classList.add('ci-rename-error');
        input.style.animation = 'abchat-shake 0.3s ease';
        setTimeout(() => {
          input.classList.remove('ci-rename-error');
          input.style.animation = '';
        }, 350);
      };
      const finish = async () => {
        const val = input.value.trim();
        // Empty or unchanged: cancel silently, always restore title text
        if (!val || val === original.trim()) {
          titleEl.textContent = original;
          return;
        }
        finishingForRename = true;
        const existingUpdatedAtForRename = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime]
          ? CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime].updatedAt
          : undefined;
        const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
        if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateChat === 'function') {
          try {
            const persistedChatForPanelRuntime = await panelDataRepoForPanelRuntime.updateChat(chatIdForPanelRuntime, {
              title: val,
              hasCustomTitle: true,
              updatedAt: existingUpdatedAtForRename
            });
            refreshChatStoreFromPersistedForPanelRuntime(persistedChatForPanelRuntime, { prepend: false });
          } catch (errorForPanelRuntime) {
            titleEl.textContent = original;
            return;
          }
        } else if (CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime]) {
          CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime].title = val;
          CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime].hasCustomTitle = true;
          upsertChatUiForPanelRuntime(chatIdForPanelRuntime, false);
        }
        if (item.classList.contains('active') || S.activeChatId === chatIdForPanelRuntime) {
          updateChatBackTitleForPanelRuntime(val);
        }
      };
      input.addEventListener('blur', () => { if (!finishingForRename) finish(); });
      input.addEventListener('mousedown', e => e.stopPropagation());
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          if (!input.value.trim()) { shakeInput(); e.stopPropagation(); return; }
          input.blur();
        }
        if (e.key === 'Escape') { titleEl.textContent = original; input.blur(); }
        e.stopPropagation();
      });
    }

    async function deleteChatForPanelRuntime(chatIdForPanelRuntime) {
      const numericChatIdForPanelRuntime = Number(chatIdForPanelRuntime);
      if (!Number.isFinite(numericChatIdForPanelRuntime)) return;
      if (!CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForPanelRuntime]) return;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.deleteChat === 'function') {
        try {
          await panelDataRepoForPanelRuntime.deleteChat(numericChatIdForPanelRuntime, getPendingBlobIdsForPanelRuntime());
        } catch (errorForPanelRuntime) {
          return;
        }
      }
      removeChatFromRuntimeStoreForPanelRuntime(numericChatIdForPanelRuntime);
      removeChatUiForPanelRuntime(numericChatIdForPanelRuntime);
      closeRawViewForPanelRuntime();
      if (S.activeChatId === numericChatIdForPanelRuntime) {
        S.activeChatId = null;
        writePanelStateSyncForPanelRuntime({ activeChatId: null });
        S.hiddenPairIds = new Set();
        S.chatEditingMsgId = null;
        backFromChat();
        showChatMessages(false);
        clearSessionTokenCounterForPanelRuntime();
        updateChatBackTitleForPanelRuntime();
      }
    }

    function deleteChatItemFromDropdownForPanelRuntime(btnForPanelRuntime) {
      const chatItemForPanelRuntime = btnForPanelRuntime && btnForPanelRuntime.closest
        ? btnForPanelRuntime.closest('.chat-item')
        : null;
      if (!chatItemForPanelRuntime) return;
      const chatIdForConfirm = Number(chatItemForPanelRuntime.dataset.chatId);
      showConfirmPromptForPanelRuntime(
        root.querySelector('.panel-content'),
        'This chat will be permanently deleted and cannot be recovered.',
        'Delete',
        async function() { await deleteChatForPanelRuntime(chatIdForConfirm); }
      );
    }

    async function openRawChatViewForPanelRuntime(btn) {
      const chatItemForRaw = btn && btn.closest ? btn.closest('.chat-item') : null;
      if (!chatItemForRaw) return;
      const chatIdForRaw = Number(chatItemForRaw.dataset.chatId);
      if (!Number.isFinite(chatIdForRaw)) return;

      await ensureChatMessagesLoadedForPanelRuntime(chatIdForRaw);

      const chatRecordForRaw = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForRaw];
      const messagesForRaw = chatRecordForRaw && Array.isArray(chatRecordForRaw.messages)
        ? chatRecordForRaw.messages
        : [];

      const rawViewForPanelRuntime = root.getElementById('chat-raw-view');
      const rawContentForPanelRuntime = root.getElementById('chat-raw-view-content');
      if (!rawViewForPanelRuntime || !rawContentForPanelRuntime) return;

      rawContentForPanelRuntime.textContent = JSON.stringify(messagesForRaw, null, 2);
      applyRawChatWrapForPanelRuntime();

      root.getElementById('chat-empty-state').classList.add('hidden');
      root.getElementById('chat-messages-content').classList.add('hidden');
      rawViewForPanelRuntime.classList.remove('hidden');

      const chatMainForRaw = root.getElementById('chat-main');
      if (chatMainForRaw) chatMainForRaw.classList.add('raw-view-active');

      S.inChatView = true;
      setReducedPaneForPanelRuntime('chats', 'detail');
    }

    function closeRawViewForPanelRuntime() {
      const rawViewForClose = root.getElementById('chat-raw-view');
      if (rawViewForClose) rawViewForClose.classList.add('hidden');

      const chatMainForClose = root.getElementById('chat-main');
      if (chatMainForClose) chatMainForClose.classList.remove('raw-view-active');

      showChatMessages(S.activeChatId !== null);
    }

    function applyRawChatWrapForPanelRuntime() {
      const rawContentForWrap = root.getElementById('chat-raw-view-content');
      if (rawContentForWrap) {
        rawContentForWrap.classList.toggle('raw-view-wrap', rawChatViewWrapForPanelRuntime);
      }
      const wrapBtnForPanelRuntime = root.querySelector('#chat-raw-view [data-action="toggle-raw-wrap"]');
      if (wrapBtnForPanelRuntime) {
        wrapBtnForPanelRuntime.setAttribute('aria-pressed', rawChatViewWrapForPanelRuntime ? 'true' : 'false');
      }
    }

    function toggleRawChatWrapForPanelRuntime() {
      rawChatViewWrapForPanelRuntime = !rawChatViewWrapForPanelRuntime;
      applyRawChatWrapForPanelRuntime();
    }

    function copyRawChatForPanelRuntime(btn) {
      const rawContentForCopy = root.getElementById('chat-raw-view-content');
      if (!rawContentForCopy) return;
      const textForCopy = rawContentForCopy.textContent || '';
      if (!textForCopy.trim()) return;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(textForCopy).then(function () {
          if (btn) { const orig = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = orig; }, 1200); }
        }).catch(function () {
          if (btn) { const orig = btn.textContent; btn.textContent = 'Failed'; setTimeout(function () { btn.textContent = orig; }, 1200); }
        });
      }
    }

    function setCopyButtonStateForPanelRuntime(buttonForPanelRuntime, nextLabelForPanelRuntime) {
      if (!buttonForPanelRuntime) return;
      const originalLabelForPanelRuntime = buttonForPanelRuntime.dataset.copyOriginalLabel || buttonForPanelRuntime.textContent || 'Copy';
      if (!buttonForPanelRuntime.dataset.copyOriginalLabel) {
        buttonForPanelRuntime.dataset.copyOriginalLabel = originalLabelForPanelRuntime;
      }
      buttonForPanelRuntime.textContent = nextLabelForPanelRuntime;
      if (buttonForPanelRuntime.dataset.copyResetTimer) {
        clearTimeout(Number(buttonForPanelRuntime.dataset.copyResetTimer));
      }
      if (buttonForPanelRuntime.dataset.copyCloseTimer) {
        clearTimeout(Number(buttonForPanelRuntime.dataset.copyCloseTimer));
      }
      const timerIdForPanelRuntime = setTimeout(function () {
        buttonForPanelRuntime.textContent = buttonForPanelRuntime.dataset.copyOriginalLabel || 'Copy';
        buttonForPanelRuntime.dataset.copyResetTimer = '';
      }, 1200);
      buttonForPanelRuntime.dataset.copyResetTimer = String(timerIdForPanelRuntime);

      const dropdownWrapForPanelRuntime = buttonForPanelRuntime.closest
        ? buttonForPanelRuntime.closest('.msg-options-wrap')
        : null;
      if (dropdownWrapForPanelRuntime && nextLabelForPanelRuntime === 'Copied') {
        const closeTimerIdForPanelRuntime = setTimeout(function () {
          dropdownWrapForPanelRuntime.classList.remove('open');
          dropdownWrapForPanelRuntime.classList.remove('open-upward');
          dropdownWrapForPanelRuntime.classList.remove('open-downward');
          const dropdownForPanelRuntime = dropdownWrapForPanelRuntime.querySelector('.msg-options-dropdown');
          if (dropdownForPanelRuntime) {
            dropdownForPanelRuntime.classList.remove('open');
            dropdownForPanelRuntime.style.maxHeight = '';
            dropdownForPanelRuntime.style.overflowY = '';
          }
          buttonForPanelRuntime.dataset.copyCloseTimer = '';
        }, 1000);
        buttonForPanelRuntime.dataset.copyCloseTimer = String(closeTimerIdForPanelRuntime);
      }
    }

    function copyMessageForPanelRuntime(messageIdForPanelRuntime, buttonForPanelRuntime) {
      const numericMessageIdForPanelRuntime = Number(messageIdForPanelRuntime);
      if (!Number.isFinite(numericMessageIdForPanelRuntime)) return;
      const messageForPanelRuntime = getMsgById(numericMessageIdForPanelRuntime);
      if (!messageForPanelRuntime) return;
      const textForPanelRuntime = String(
        messageForPanelRuntime.content ||
        messageForPanelRuntime.md ||
        ''
      );
      if (!textForPanelRuntime.trim()) return;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(textForPanelRuntime)
          .then(function () {
            setCopyButtonStateForPanelRuntime(buttonForPanelRuntime, 'Copied');
          })
          .catch(function () {
            setCopyButtonStateForPanelRuntime(buttonForPanelRuntime, 'Failed');
          });
        return;
      }
      try {
        fallbackCopy(textForPanelRuntime, function () {
          setCopyButtonStateForPanelRuntime(buttonForPanelRuntime, 'Copied');
        });
      } catch (errorForPanelRuntime) {
        setCopyButtonStateForPanelRuntime(buttonForPanelRuntime, 'Failed');
      }
    }

    async function forkChatFromMessageForPanelRuntime(messageIdForPanelRuntime) {
      if (!S.activeChatId) return;
      const numericMessageIdForPanelRuntime = Number(messageIdForPanelRuntime);
      if (!Number.isFinite(numericMessageIdForPanelRuntime)) return;
      const activeChatForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId];
      if (!activeChatForPanelRuntime || !Array.isArray(activeChatForPanelRuntime.messages)) return;
      const sourceIndexForPanelRuntime = activeChatForPanelRuntime.messages.findIndex(function (messageForPanelRuntime) {
        return Number(messageForPanelRuntime && messageForPanelRuntime.id) === numericMessageIdForPanelRuntime;
      });
      if (sourceIndexForPanelRuntime < 0) return;
      const sourceMessageForPanelRuntime = activeChatForPanelRuntime.messages[sourceIndexForPanelRuntime];
      if (!sourceMessageForPanelRuntime || sourceMessageForPanelRuntime.role !== 'assistant') return;

      const forkMessagesForPanelRuntime = activeChatForPanelRuntime.messages
        .slice(0, sourceIndexForPanelRuntime + 1)
        .map(function (messageForPanelRuntime) {
          const clonedMessageForPanelRuntime = cloneMessageRecordForPanelRuntime(messageForPanelRuntime);
          delete clonedMessageForPanelRuntime.id;
          clonedMessageForPanelRuntime.chatId = null;
          return clonedMessageForPanelRuntime;
        });
      const forkTitleForPanelRuntime = ((activeChatForPanelRuntime.title || 'Chat') + ' (Fork)').slice(0, 100);
      const chatModelSelectForFork = root.getElementById('chat-model-select');
      const forkModelForPanelRuntime = activeChatForPanelRuntime.lastModel
        || (chatModelSelectForFork && chatModelSelectForFork.value)
        || loadedGlobalDefaultModelForPanelRuntime
        || DEFAULT_MODEL_FOR_PANEL_RUNTIME;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();

      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createChat === 'function' && typeof panelDataRepoForPanelRuntime.createMessage === 'function') {
        try {
          const createdChatForPanelRuntime = await panelDataRepoForPanelRuntime.createChat({
            title: forkTitleForPanelRuntime,
            summary: getChatSummaryFromMessagesForPanelRuntime(forkMessagesForPanelRuntime),
            type: activeChatForPanelRuntime.type === 'quickq' ? 'quickq' : 'chat',
            isPinned: false,
            lastModel: forkModelForPanelRuntime
          });
          for (let messageIndexForPanelRuntime = 0; messageIndexForPanelRuntime < forkMessagesForPanelRuntime.length; messageIndexForPanelRuntime++) {
            await panelDataRepoForPanelRuntime.createMessage(createdChatForPanelRuntime.id, forkMessagesForPanelRuntime[messageIndexForPanelRuntime], {
              touchChat: false
            });
          }
          const finalizedChatForPanelRuntime = await panelDataRepoForPanelRuntime.getChat(createdChatForPanelRuntime.id);
          refreshChatStoreFromPersistedForPanelRuntime(finalizedChatForPanelRuntime, { prepend: true });
          syncSearchIndexForPanelRuntime('chats', 'add', Number(finalizedChatForPanelRuntime.id), CHAT_STORE_FOR_PANEL_RUNTIME[Number(finalizedChatForPanelRuntime.id)]);
          selectChat(Number(finalizedChatForPanelRuntime.id));
          return;
        } catch (errorForPanelRuntime) {
          return;
        }
      }

      const fallbackChatIdForPanelRuntime = await createNewChatForPanelRuntime(forkTitleForPanelRuntime, {
        lastModel: forkModelForPanelRuntime
      });
      CHAT_STORE_FOR_PANEL_RUNTIME[fallbackChatIdForPanelRuntime].messages = forkMessagesForPanelRuntime;
      CHAT_STORE_FOR_PANEL_RUNTIME[fallbackChatIdForPanelRuntime].summary = getChatSummaryFromMessagesForPanelRuntime(forkMessagesForPanelRuntime);
      upsertChatUiForPanelRuntime(fallbackChatIdForPanelRuntime, true);
      selectChat(fallbackChatIdForPanelRuntime);
    }


    function setChatType(type, optionsForChatType) {
      const optsForChatTypeForPanelRuntime = optionsForChatType || {};
      const normalizedTypeForChatType = (type === 'quickq') ? 'quickq' : 'chats';
      S.chatType = normalizedTypeForChatType;
      // Clear search when switching type tabs
      const chatSearchInputForType = root.getElementById('chat-search-input');
      if (chatSearchInputForType) chatSearchInputForType.value = '';
      root.querySelectorAll('.ctab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.ctype === normalizedTypeForChatType);
      });
      const isQuickQ = normalizedTypeForChatType === 'quickq';
      root.querySelectorAll('.chat-item').forEach(item => {
        const itemIsQQ = item.dataset.chatType === 'quickq';
        item.style.display = (isQuickQ ? itemIsQQ : !itemIsQQ) ? '' : 'none';
      });
      refreshChatGroupLabelsVisibilityForPanelRuntime();
      // Reset favs filter when switching types
      const favsBtn = root.getElementById('favs-btn');
      if (favsBtn) {
        favsBtn.classList.remove('active');
        favsBtn.innerHTML = ic.starEmpty12 + ' Favs';
      }
      if (!optsForChatTypeForPanelRuntime.skipStateSync) {
        writePanelStateSyncForPanelRuntime({ chatSubTab: normalizedTypeForChatType, chatSearchQuery: '' });
      }
    }

    function setChatSubTabForMirrorForPanelRuntime(typeForMirror) {
      setChatType(typeForMirror, { skipStateSync: true });
    }

    /* ============================================================
      CHAT NAVIGATION
    ============================================================ */
    function showChatMessages(show) {
      root.getElementById('chat-empty-state').classList.toggle('hidden', show);
      root.getElementById('chat-messages-content').classList.toggle('hidden', !show);
      if (show) {
        renderMermaidWhenVisibleForContainerForPanelRuntime(
          root.getElementById('chat-messages-content'),
          12
        );
      }
    }

    function getActiveChatTitleForPanelRuntime() {
      const activeChatItemForPanelRuntime = root.querySelector('.chat-item.active');
      if (!activeChatItemForPanelRuntime) return '';
      const activeTitleElementForPanelRuntime = activeChatItemForPanelRuntime.querySelector('.chat-item-title');
      if (!activeTitleElementForPanelRuntime) return '';
      return (activeTitleElementForPanelRuntime.textContent || '').trim();
    }

    function updateChatBackTitleForPanelRuntime(titleOverrideForPanelRuntime) {
      const chatCurrentTitleForPanelRuntime = root.getElementById('chat-current-title');
      if (!chatCurrentTitleForPanelRuntime) return;
      const overrideTitleForPanelRuntime =
        typeof titleOverrideForPanelRuntime === 'string' ? titleOverrideForPanelRuntime.trim() : '';
      const nextTitleForPanelRuntime = overrideTitleForPanelRuntime || getActiveChatTitleForPanelRuntime();
      const isEmptyTitleForPanelRuntime = !nextTitleForPanelRuntime;
      const titleTextForPanelRuntime = isEmptyTitleForPanelRuntime ? 'New chat' : nextTitleForPanelRuntime;
      chatCurrentTitleForPanelRuntime.textContent = titleTextForPanelRuntime;
      chatCurrentTitleForPanelRuntime.classList.toggle('is-empty', isEmptyTitleForPanelRuntime);
      chatCurrentTitleForPanelRuntime.title = titleTextForPanelRuntime;
    }

    function newChat() {
      root.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
      S.activeChatId = null;
      writePanelStateSyncForPanelRuntime({ activeChatId: null });
      clearSessionTokenCounterForPanelRuntime();
      showChatMessages(false);
      updateChatBackTitleForPanelRuntime();
      S.inChatView = true;
      setReducedPaneForPanelRuntime('chats', 'detail');
      const chatModelSelectForNew = root.getElementById('chat-model-select');
      if (chatModelSelectForNew && loadedGlobalDefaultModelForPanelRuntime) {
        chatModelSelectForNew.value = loadedGlobalDefaultModelForPanelRuntime;
        syncModelPickerLabelForPanelRuntime();
      }
    }

    function usePrompt(btn) {
      const ta = root.querySelector('.chat-textarea');
      if (ta) {
        ta.value = btn.textContent;
        updateAutoExpandForTextareaForPanelRuntime(ta);
        ta.focus();
      }
    }

    function selectChat(id) {
      closeRawViewForPanelRuntime();
      S.activeChatId = id;
      writePanelStateSyncForPanelRuntime({ activeChatId: id });
      clearSessionTokenCounterForPanelRuntime();
      setSendingUIStateForPanelRuntime();
      S.hiddenPairIds = new Set();
      S.chatEditingMsgId = null;
      getActiveChatMessagesForPanelRuntime().forEach(msg => {
        if (msg.role === 'user' && msg.isHidden) S.hiddenPairIds.add(msg.id);
      });
      root.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', Number(el.dataset.chatId) === id);
      });
      const chatForSelect = CHAT_STORE_FOR_PANEL_RUNTIME[id];
      const chatModelSelect = root.getElementById('chat-model-select');
      if (chatModelSelect) {
        const lastModelForChat = chatForSelect && chatForSelect.lastModel;
        const fallbackModelForChat = loadedGlobalDefaultModelForPanelRuntime || DEFAULT_MODEL_FOR_PANEL_RUNTIME;
        if (lastModelForChat) {
          chatModelSelect.value = lastModelForChat;
          if (chatModelSelect.value !== lastModelForChat) {
            chatModelSelect.value = fallbackModelForChat;
          }
        } else {
          chatModelSelect.value = fallbackModelForChat;
        }
        syncModelPickerLabelForPanelRuntime();
      }
      updateChatBackTitleForPanelRuntime();
      showChatMessages(true);
      ensureChatMessagesLoadedForPanelRuntime(id).then(function () {
        if (S.activeChatId !== id) return;
        return loadGeneratedBlobsForMessagesForPanelRuntime(getActiveChatMessagesForPanelRuntime());
      }).then(function () {
        if (S.activeChatId !== id) return;
        rebuildTokenCounterFromMessagesForPanelRuntime(id);
        const mermaidDoneForSelectChat = renderChatMessages();
        reattachLiveTurnBubbleForPanelRuntime(id);
        // Catch-up for tabs that joined or switched chats mid-stream. No-op
        // if a bubble already exists locally (originator or already-mirrored).
        requestAndApplyStreamSnapshotForPanelRuntime(id);
        scrollChatToBottomForPanelRuntime();
        if (mermaidDoneForSelectChat && typeof mermaidDoneForSelectChat.then === 'function') {
          mermaidDoneForSelectChat.then(scrollChatToBottomForPanelRuntime);
        }
      });
      S.inChatView = true;
      setReducedPaneForPanelRuntime('chats', 'detail');
      var chatTaForSelectFocus = root.querySelector('.chat-textarea');
      if (chatTaForSelectFocus) setTimeout(function() { chatTaForSelectFocus.focus(); }, 0);
    }

    function backFromChat() {
      S.inChatView = false;
      setReducedPaneForPanelRuntime('chats', 'list');
      updateChatBackTitleForPanelRuntime();
    }

    /* ============================================================
      HIDDEN MESSAGES
    ============================================================ */
    function showHiddenPair(link) {
      const indicator = link.closest('.hidden-pair-indicator');
      if (!indicator || !indicator.dataset.hiddenIds) return;
      const repoForShowHidden = getPanelDataRepoForPanelRuntime();
      indicator.dataset.hiddenIds.split(',').forEach(raw => {
        const msgId = Number(raw);
        S.hiddenPairIds.delete(msgId);
        const msg = getMsgById(msgId);
        if (msg) msg.isHidden = false;
        if (repoForShowHidden && typeof repoForShowHidden.updateMessage === 'function' && Number.isFinite(msgId)) {
          Promise.resolve(repoForShowHidden.updateMessage(msgId, { isHidden: false })).catch(function () {});
        }
      });
      renderChatMessages();
    }

    function hidePair(btn) {
      const pairMsgId = Number(btn.dataset.pairMsgId);
      if (!Number.isFinite(pairMsgId)) return;
      S.chatEditingMsgId = null;
      S.hiddenPairIds.add(pairMsgId);
      const msg = getMsgById(pairMsgId);
      if (msg) msg.isHidden = true;
      const repoForHidePair = getPanelDataRepoForPanelRuntime();
      if (repoForHidePair && typeof repoForHidePair.updateMessage === 'function') {
        Promise.resolve(repoForHidePair.updateMessage(pairMsgId, { isHidden: true })).catch(function () {});
      }
      renderChatMessages();
    }

    /* ============================================================
      ATTACH PICKER
    ============================================================ */
    function toggleAttachPicker() {
      const wasOpen = preclickOpenStateForPanelRuntime;
      preclickOpenStateForPanelRuntime = null;
      // closeAllDropdownsForPanelRuntime already ran via the root capture handler
      if (!wasOpen) {
        const picker = root.getElementById('attach-picker');
        const attachBtn = root.getElementById('attach-btn');
        if (picker) picker.classList.add('open');
        if (attachBtn) attachBtn.classList.add('open');
      }
    }

    /* ============================================================
      MODEL PICKER
    ============================================================ */
    function toggleModelPickerForPanelRuntime() {
      const wasOpen = preclickOpenStateForPanelRuntime;
      preclickOpenStateForPanelRuntime = null;
      // closeAllDropdownsForPanelRuntime already ran via the root capture handler
      if (!wasOpen) {
        const dropdown = root.getElementById('model-picker-dropdown');
        const btn = root.getElementById('model-picker-btn');
        if (!dropdown || !btn) return;
        dropdown.classList.add('open');
        btn.classList.add('open');
      }
    }

    function syncModelPickerLabelForPanelRuntime() {
      const chatSelect = root.getElementById('chat-model-select');
      const label = root.getElementById('model-picker-label');
      if (!chatSelect || !label) return;
      const idx = chatSelect.selectedIndex;
      if (idx >= 0 && chatSelect.options[idx]) {
        label.textContent = chatSelect.options[idx].textContent.replace(/\s*--\s*\[Expensive\].*$/i, '').trim();
      }
      const currentModelId = chatSelect.value;
      const dropdown = root.getElementById('model-picker-dropdown');
      if (dropdown) {
        dropdown.querySelectorAll('.mp-item').forEach(function (item) {
          item.classList.toggle('active', item.dataset.modelId === currentModelId);
        });
      }
    }

    function buildModelPickerDropdownForPanelRuntime(pickedByProvider, providerKeys, effectiveSelected, getProviderLabel, isExpensive, getDisplayName, getProviderKey) {
      const dropdown = root.getElementById('model-picker-dropdown');
      if (!dropdown) return;
      dropdown.innerHTML = '';
      providerKeys.forEach(function (providerKey) {
        const models = pickedByProvider[providerKey];
        if (!models || models.length === 0) return;
        const group = document.createElement('div');
        group.className = 'mp-group';
        const groupLabel = document.createElement('div');
        groupLabel.className = 'mp-group-label';
        groupLabel.textContent = getProviderLabel(providerKey);
        group.appendChild(groupLabel);
        models.forEach(function (m) {
          const btn = document.createElement('button');
          btn.className = 'mp-item';
          if (m.id === effectiveSelected) btn.classList.add('active');
          btn.dataset.action = 'select-model';
          btn.dataset.modelId = m.id;
          const namePart = escHtml(getDisplayName(m, providerKey));
          const tierForBtn = getModelTierForPanelRuntime(m);
          btn.innerHTML = tierForBtn
            ? namePart + ' <span class="' + tierForBtn.cls + '">' + tierForBtn.label + '</span>'
            : namePart;
          group.appendChild(btn);
        });
        dropdown.appendChild(group);
      });
    }

    function selectModelForPanelRuntime(modelId) {
      if (!modelId) return;
      const chatSelect = root.getElementById('chat-model-select');
      if (!chatSelect) return;
      chatSelect.value = modelId;
      syncModelPickerLabelForPanelRuntime();
      const dropdown = root.getElementById('model-picker-dropdown');
      const btn = root.getElementById('model-picker-btn');
      if (dropdown) {
        dropdown.classList.remove('open');
        dropdown.querySelectorAll('.mp-item').forEach(function (item) {
          item.classList.toggle('active', item.dataset.modelId === modelId);
        });
      }
      if (btn) btn.classList.remove('open');
    }

    function getAttachIconSvgForPanelRuntime(typeForPanelRuntime) {
      return CHIP_SVGS[typeForPanelRuntime] || CHIP_SVGS.file || '';
    }

    function truncateChipLabelForPanelRuntime(labelForPanelRuntime) {
      const textForPanelRuntime = String(labelForPanelRuntime || '').trim();
      if (!textForPanelRuntime) return 'Attachment';
      return textForPanelRuntime.length > 40
        ? textForPanelRuntime.slice(0, 37) + '...'
        : textForPanelRuntime;
    }

    function showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, msgForPanelRuntime) {
      setInputChipStatusForPanelRuntime(chipNodeForPanelRuntime, 'error', msgForPanelRuntime);
      const toastForError = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForError && typeof toastForError.show === 'function') {
        toastForError.show(String(msgForPanelRuntime || 'Attachment error'), { durationMs: 4500 });
      }
    }

    function setInputChipStatusForPanelRuntime(chipNodeForPanelRuntime, statusForPanelRuntime, statusTextForPanelRuntime) {
      if (!chipNodeForPanelRuntime) return;
      const resolvedStatusForPanelRuntime = String(statusForPanelRuntime || '').trim().toLowerCase();
      chipNodeForPanelRuntime.classList.remove('ic-status-loading', 'ic-status-success', 'ic-status-error');
      chipNodeForPanelRuntime.dataset.attachStatus = '';
      const statusIndicatorForPanelRuntime = chipNodeForPanelRuntime.querySelector('.ic-status-indicator');
      if (statusIndicatorForPanelRuntime) {
        statusIndicatorForPanelRuntime.textContent = '';
      }

      if (resolvedStatusForPanelRuntime === 'loading') {
        chipNodeForPanelRuntime.classList.add('ic-status-loading');
        chipNodeForPanelRuntime.dataset.attachStatus = 'loading';
      } else if (resolvedStatusForPanelRuntime === 'success') {
        chipNodeForPanelRuntime.classList.add('ic-status-success');
        chipNodeForPanelRuntime.dataset.attachStatus = 'success';
        if (statusIndicatorForPanelRuntime) {
          statusIndicatorForPanelRuntime.textContent = 'OK';
        }
      } else if (resolvedStatusForPanelRuntime === 'error') {
        chipNodeForPanelRuntime.classList.add('ic-status-error');
        chipNodeForPanelRuntime.dataset.attachStatus = 'error';
        if (statusIndicatorForPanelRuntime) {
          statusIndicatorForPanelRuntime.textContent = '!';
        }
      }

      const statusLabelForPanelRuntime = String(statusTextForPanelRuntime || '').trim();
      if (statusLabelForPanelRuntime) {
        chipNodeForPanelRuntime.title = statusLabelForPanelRuntime;
      } else if (chipNodeForPanelRuntime.dataset.attachName) {
        chipNodeForPanelRuntime.title = chipNodeForPanelRuntime.dataset.attachName;
      }
      // Save draft whenever a chip settles out of loading (upload finished or cleared to ready).
      if (resolvedStatusForPanelRuntime !== 'loading') {
        saveDraftForPanelRuntime();
      }
    }

    function extractChipDomainForPanelRuntime(url) {
      if (!url) return '';
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch (e) {
        return '';
      }
    }

    function getPendingBlobIdsForPanelRuntime() {
      var idsForPending = [];
      var chipsRowForPending = root.querySelector('.input-chips-row');
      if (chipsRowForPending) {
        chipsRowForPending.querySelectorAll('[data-attach-ref-id]').forEach(function (chipForPending) {
          var idForPending = Number(chipForPending.dataset.attachRefId);
          if (Number.isFinite(idForPending) && idForPending > 0) idsForPending.push(idForPending);
        });
      }
      root.querySelectorAll('.note-popout-attach-chip[data-attach-ref-id]').forEach(function (chipForPending) {
        var idForPending = Number(chipForPending.dataset.attachRefId);
        if (Number.isFinite(idForPending) && idForPending > 0) idsForPending.push(idForPending);
      });
      return idsForPending;
    }

    function addInputChipForPanelRuntime(chipDataForPanelRuntime) {
      const rowForPanelRuntime = root.querySelector('.input-chips-row');
      if (!rowForPanelRuntime || !chipDataForPanelRuntime || typeof chipDataForPanelRuntime !== 'object') return null;
      const chipTypeForPanelRuntime = String(chipDataForPanelRuntime.type || '').trim();
      const chipLabelForPanelRuntime = String(chipDataForPanelRuntime.label || '').trim();
      if (!chipTypeForPanelRuntime || !chipLabelForPanelRuntime) return null;
      const existingChipCountForCap = rowForPanelRuntime.querySelectorAll('.ic').length;
      if (existingChipCountForCap >= MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME) {
        const toastForChipCap = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
        if (toastForChipCap && typeof toastForChipCap.show === 'function') {
          toastForChipCap.show('Attachment limit reached (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').', { durationMs: 4000 });
        }
        return null;
      }
      const chipForPanelRuntime = document.createElement('span');
      chipForPanelRuntime.className = 'ic m-chip-' + chipTypeForPanelRuntime;
      chipForPanelRuntime.dataset.action = 'preview-input-chip';
      chipForPanelRuntime.dataset.attachType = chipTypeForPanelRuntime;
      chipForPanelRuntime.dataset.attachName = chipLabelForPanelRuntime;
      chipForPanelRuntime.dataset.attachContent = String(chipDataForPanelRuntime.content || '');
      chipForPanelRuntime.dataset.attachMimeType = String(chipDataForPanelRuntime.mimeType || '');
      chipForPanelRuntime.dataset.attachKind = String(chipDataForPanelRuntime.kind || '');
      chipForPanelRuntime.dataset.attachSize = String(Number(chipDataForPanelRuntime.size) || 0);
      chipForPanelRuntime.dataset.attachPreview = String(chipDataForPanelRuntime.preview || '');
      const refIdForPanelRuntime = Number(chipDataForPanelRuntime.refId);
      if (Number.isFinite(refIdForPanelRuntime)) {
        chipForPanelRuntime.dataset.attachRefId = String(refIdForPanelRuntime);
      } else {
        chipForPanelRuntime.dataset.attachRefId = '';
      }
      const pageUrlForChip = String(chipDataForPanelRuntime.pageUrl || '');
      const pageTitleForChip = String(chipDataForPanelRuntime.pageTitle || '');
      chipForPanelRuntime.dataset.attachPageUrl = pageUrlForChip;
      chipForPanelRuntime.dataset.attachPageTitle = pageTitleForChip;
      chipForPanelRuntime.dataset.attachElementSelector = String(chipDataForPanelRuntime.elementSelector || '');
      chipForPanelRuntime.dataset.attachHtmlFormat = String(chipDataForPanelRuntime.htmlFormat || '');
      const domainForChip = pageUrlForChip ? extractChipDomainForPanelRuntime(pageUrlForChip) : '';
      const domainSuffixForChip = domainForChip
        ? ' <span class="ic-domain">' + escHtml(domainForChip) + '</span>'
        : '';
      chipForPanelRuntime.innerHTML =
        getAttachIconSvgForPanelRuntime(chipTypeForPanelRuntime) +
        ' ' + escHtml(truncateChipLabelForPanelRuntime(chipLabelForPanelRuntime)) +
        domainSuffixForChip +
        ' <span class="ic-status-indicator" aria-hidden="true"></span>' +
        ' <span class="ic-remove" data-action="remove-ic">' + ic.x10 + '</span>';
      rowForPanelRuntime.appendChild(chipForPanelRuntime);
      setInputChipStatusForPanelRuntime(
        chipForPanelRuntime,
        chipDataForPanelRuntime.status || '',
        chipDataForPanelRuntime.statusText || ''
      );
      saveDraftForPanelRuntime();
      if (S.mode === 'reduced') {
        if (S.tab !== 'chats') setTab('chats');
        S.inChatView = true;
        setReducedPaneForPanelRuntime('chats', 'detail');
      }
      return chipForPanelRuntime;
    }

    function removeInputChipForPanelRuntime(chipNodeForPanelRuntime) {
      if (!chipNodeForPanelRuntime) return;
      const chipTypeForRemove = String(chipNodeForPanelRuntime.dataset.attachType || '').trim();
      const chipKindForRemove = String(chipNodeForPanelRuntime.dataset.attachKind || '').trim();
      const chipContextForRemove = String(chipNodeForPanelRuntime.dataset.attachContext || '').trim();
      // generated_image blobs are already referenced by a persisted assistant message; removing the
      // input chip must not delete the blob or the displayed image in chat would break.
      // note-context chips reference blobs that may still be cited by saved note versions; let pruning handle cleanup.
      const isBlobChipForRemove = chipTypeForRemove !== 'note' && chipTypeForRemove !== 'chat' && chipKindForRemove !== 'generated_image' && chipContextForRemove !== 'note';
      if (isBlobChipForRemove) {
        const blobIdForPanelRuntime = Number(chipNodeForPanelRuntime.dataset.attachRefId);
        if (Number.isFinite(blobIdForPanelRuntime)) {
          const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
          if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.deleteAttachmentBlob === 'function') {
            panelDataRepoForPanelRuntime.deleteAttachmentBlob(blobIdForPanelRuntime).catch(function () {});
          }
        }
      }
      chipNodeForPanelRuntime.remove();
      saveDraftForPanelRuntime();
    }

    async function createAttachmentBlobForPanelRuntime(blobInputForPanelRuntime) {
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (!panelDataRepoForPanelRuntime || typeof panelDataRepoForPanelRuntime.createAttachmentBlob !== 'function') {
        throw new Error('Attachment storage is not available.');
      }
      const persistedBlobForPanelRuntime = await panelDataRepoForPanelRuntime.createAttachmentBlob(blobInputForPanelRuntime);
      const persistedBlobIdForPanelRuntime = Number(persistedBlobForPanelRuntime && persistedBlobForPanelRuntime.id);
      if (!Number.isFinite(persistedBlobIdForPanelRuntime)) {
        throw new Error('Attachment storage failed.');
      }
      return persistedBlobForPanelRuntime;
    }

    async function getAttachmentBlobForPanelRuntime(blobIdForPanelRuntime) {
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      const numericBlobIdForPanelRuntime = Number(blobIdForPanelRuntime);
      if (!Number.isFinite(numericBlobIdForPanelRuntime)) return null;
      if (!panelDataRepoForPanelRuntime || typeof panelDataRepoForPanelRuntime.getAttachmentBlob !== 'function') {
        return null;
      }
      try {
        return await panelDataRepoForPanelRuntime.getAttachmentBlob(numericBlobIdForPanelRuntime);
      } catch (errorForPanelRuntime) {
        return null;
      }
    }

    function normalizeChipPreviewSourceForPanelRuntime(chipSourceForPanelRuntime) {
      if (!chipSourceForPanelRuntime) return null;
      if (chipSourceForPanelRuntime.dataset) {
        return {
          type: String(chipSourceForPanelRuntime.dataset.attachType || '').trim(),
          name: String(chipSourceForPanelRuntime.dataset.attachName || '').trim(),
          content: String(chipSourceForPanelRuntime.dataset.attachContent || ''),
          refId: Number(chipSourceForPanelRuntime.dataset.attachRefId),
          mimeType: String(chipSourceForPanelRuntime.dataset.attachMimeType || '').trim(),
          kind: String(chipSourceForPanelRuntime.dataset.attachKind || '').trim(),
          preview: String(chipSourceForPanelRuntime.dataset.attachPreview || '')
        };
      }
      if (typeof chipSourceForPanelRuntime === 'object') {
        return {
          type: String(chipSourceForPanelRuntime.type || '').trim(),
          name: String(chipSourceForPanelRuntime.label || chipSourceForPanelRuntime.name || '').trim(),
          content: String(chipSourceForPanelRuntime.content || ''),
          refId: Number(chipSourceForPanelRuntime.refId),
          mimeType: String(chipSourceForPanelRuntime.mimeType || '').trim(),
          kind: String(chipSourceForPanelRuntime.kind || '').trim(),
          preview: String(chipSourceForPanelRuntime.preview || '')
        };
      }
      return null;
    }

    function extractImageDataUrlFromTextForPanelRuntime(textForPanelRuntime) {
      const sourceTextForPanelRuntime = String(textForPanelRuntime || '').trim();
      if (!sourceTextForPanelRuntime) return '';
      if (sourceTextForPanelRuntime.indexOf('data:image/') === 0) {
        return sourceTextForPanelRuntime;
      }
      const markdownImageMatchForPanelRuntime = sourceTextForPanelRuntime.match(/!\[[^\]]*\]\((data:image\/[^)]+)\)/i);
      if (markdownImageMatchForPanelRuntime && markdownImageMatchForPanelRuntime[1]) {
        return String(markdownImageMatchForPanelRuntime[1]).trim();
      }
      return '';
    }

    function arrayBufferToDataUrlForPanelRuntime(arrayBufferForPanelRuntime, mimeTypeForPanelRuntime) {
      const bytesForPanelRuntime = new Uint8Array(arrayBufferForPanelRuntime || new ArrayBuffer(0));
      let binaryForPanelRuntime = '';
      for (let offsetForPanelRuntime = 0; offsetForPanelRuntime < bytesForPanelRuntime.length; offsetForPanelRuntime += 0x8000) {
        const chunkForPanelRuntime = bytesForPanelRuntime.subarray(offsetForPanelRuntime, offsetForPanelRuntime + 0x8000);
        binaryForPanelRuntime += String.fromCharCode.apply(null, chunkForPanelRuntime);
      }
      const base64ForPanelRuntime = btoa(binaryForPanelRuntime);
      return 'data:' + (mimeTypeForPanelRuntime || 'application/octet-stream') + ';base64,' + base64ForPanelRuntime;
    }

    function fileToArrayBufferForPanelRuntime(fileForPanelRuntime) {
      return new Promise(function (resolveForPanelRuntime, rejectForPanelRuntime) {
        if (!fileForPanelRuntime) {
          rejectForPanelRuntime(new Error('No file selected.'));
          return;
        }
        const readerForPanelRuntime = new FileReader();
        readerForPanelRuntime.onload = function () {
          resolveForPanelRuntime(readerForPanelRuntime.result);
        };
        readerForPanelRuntime.onerror = function () {
          rejectForPanelRuntime(new Error('Could not read file.'));
        };
        readerForPanelRuntime.readAsArrayBuffer(fileForPanelRuntime);
      });
    }

    function getFileExtensionForPanelRuntime(fileNameForPanelRuntime) {
      const normalizedNameForPanelRuntime = String(fileNameForPanelRuntime || '').trim().toLowerCase();
      const partsForPanelRuntime = normalizedNameForPanelRuntime.split('.');
      if (partsForPanelRuntime.length < 2) return '';
      return String(partsForPanelRuntime.pop() || '').trim();
    }

    function isSupportedFileUploadForPanelRuntime(fileForPanelRuntime) {
      if (!fileForPanelRuntime) return false;
      const mimeTypeForPanelRuntime = String(fileForPanelRuntime.type || '').toLowerCase();
      if (mimeTypeForPanelRuntime.indexOf('text/') === 0) return true;
      if (mimeTypeForPanelRuntime === 'application/json') return true;
      if (mimeTypeForPanelRuntime === 'application/pdf') return true;
      if (mimeTypeForPanelRuntime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true;
      if (mimeTypeForPanelRuntime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return true;
      if (mimeTypeForPanelRuntime === 'application/vnd.ms-excel') return true;
      if (mimeTypeForPanelRuntime === 'application/vnd.oasis.opendocument.spreadsheet') return true;
      if (mimeTypeForPanelRuntime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return true;
      const extensionForPanelRuntime = getFileExtensionForPanelRuntime(fileForPanelRuntime.name || '');
      return SUPPORTED_UPLOAD_EXTENSIONS_FOR_PANEL_RUNTIME.indexOf(extensionForPanelRuntime) >= 0;
    }

    function sendRuntimeMessageForPanelRuntime(payloadForPanelRuntime) {
      return new Promise(function (resolveForPanelRuntime) {
        try {
          chrome.runtime.sendMessage(payloadForPanelRuntime, function (responseForPanelRuntime) {
            if (chrome.runtime.lastError) {
              resolveForPanelRuntime({ ok: false, error: chrome.runtime.lastError.message || 'Runtime messaging failed.' });
              return;
            }
            resolveForPanelRuntime(responseForPanelRuntime || { ok: false, error: 'No response.' });
          });
        } catch (errorForPanelRuntime) {
          resolveForPanelRuntime({ ok: false, error: errorForPanelRuntime && errorForPanelRuntime.message ? errorForPanelRuntime.message : 'Runtime messaging failed.' });
        }
      });
    }

    async function fetchTabPageContentForPanelRuntime(tabIdForPanelRuntime) {
      const numericTabIdForPanelRuntime = Number(tabIdForPanelRuntime);
      if (!Number.isFinite(numericTabIdForPanelRuntime)) {
        return { ok: false, error: 'Invalid tab id.' };
      }
      const responseForPanelRuntime = await sendRuntimeMessageForPanelRuntime({
        action: 'abchatGetTabPageContent',
        tabId: numericTabIdForPanelRuntime
      });
      if (!responseForPanelRuntime || !responseForPanelRuntime.ok) {
        return {
          ok: false,
          error: responseForPanelRuntime && responseForPanelRuntime.error
            ? responseForPanelRuntime.error
            : 'Could not read tab content.'
        };
      }
      const contentForPanelRuntime = String(responseForPanelRuntime.content || '').trim();
      if (!contentForPanelRuntime) {
        return { ok: false, error: 'No readable content found in selected tab.' };
      }
      return { ok: true, content: contentForPanelRuntime };
    }

    function waitForAnimationFramesForPanelRuntime(frameCountForPanelRuntime) {
      return new Promise(function (resolveForPanelRuntime) {
        if (typeof requestAnimationFrame !== 'function') {
          setTimeout(resolveForPanelRuntime, 34);
          return;
        }
        let framesRemainingForPanelRuntime = Number(frameCountForPanelRuntime) || 1;
        if (!Number.isFinite(framesRemainingForPanelRuntime) || framesRemainingForPanelRuntime < 1) {
          framesRemainingForPanelRuntime = 1;
        }
        function consumeFrameForPanelRuntime() {
          framesRemainingForPanelRuntime -= 1;
          if (framesRemainingForPanelRuntime <= 0) {
            resolveForPanelRuntime();
            return;
          }
          requestAnimationFrame(consumeFrameForPanelRuntime);
        }
        requestAnimationFrame(consumeFrameForPanelRuntime);
      });
    }

    function waitMsForPanelRuntime(msForPanelRuntime) {
      return new Promise(function (resolveForPanelRuntime) {
        setTimeout(resolveForPanelRuntime, Math.max(0, Number(msForPanelRuntime) || 0));
      });
    }

    function isPanelUiHiddenForScreenshotForPanelRuntime(panelShadowHostForPanelRuntime) {
      if (!panelShadowHostForPanelRuntime) return true;
      if (panelShadowHostForPanelRuntime.hidden) return true;
      if (panelShadowHostForPanelRuntime.style && panelShadowHostForPanelRuntime.style.display === 'none') return true;
      if (typeof window.getComputedStyle !== 'function') return false;
      const computedStyleForPanelRuntime = window.getComputedStyle(panelShadowHostForPanelRuntime);
      return (
        computedStyleForPanelRuntime.display === 'none' ||
        computedStyleForPanelRuntime.visibility === 'hidden' ||
        computedStyleForPanelRuntime.opacity === '0'
      );
    }

    async function waitForPanelUiHiddenConfirmationForPanelRuntime(panelShadowHostForPanelRuntime, maxAttemptsForPanelRuntime) {
      let attemptsForPanelRuntime = Number(maxAttemptsForPanelRuntime);
      if (!Number.isFinite(attemptsForPanelRuntime) || attemptsForPanelRuntime < 1) {
        attemptsForPanelRuntime = 1;
      }
      for (let attemptForPanelRuntime = 0; attemptForPanelRuntime < attemptsForPanelRuntime; attemptForPanelRuntime++) {
        if (isPanelUiHiddenForScreenshotForPanelRuntime(panelShadowHostForPanelRuntime)) {
          // Confirmation passed, wait additional frames to reduce compositor race captures.
          await waitForAnimationFramesForPanelRuntime(2);
          await waitMsForPanelRuntime(60);
          return true;
        }
        await waitForAnimationFramesForPanelRuntime(1);
        await waitMsForPanelRuntime(25);
      }
      return isPanelUiHiddenForScreenshotForPanelRuntime(panelShadowHostForPanelRuntime);
    }

    async function captureScreenshotWithoutPanelUiForPanelRuntime() {
      const sharedUiNamespaceForPanelRuntime = (globalThis.ABChatContent || {}).ui || {};
      const panelControllerForPanelRuntime = sharedUiNamespaceForPanelRuntime.panel || null;
      const panelShadowHostForPanelRuntime = document.getElementById('abchat-panel-shadow-host');
      const canTogglePanelForPanelRuntime = panelControllerForPanelRuntime && typeof panelControllerForPanelRuntime.setVisible === 'function';
      const isPanelVisibleForPanelRuntime = canTogglePanelForPanelRuntime && typeof panelControllerForPanelRuntime.isVisible === 'function'
        ? Boolean(panelControllerForPanelRuntime.isVisible())
        : Boolean(panelShadowHostForPanelRuntime && panelShadowHostForPanelRuntime.style.display !== 'none');

      if (isPanelVisibleForPanelRuntime) {
        if (canTogglePanelForPanelRuntime) {
          panelControllerForPanelRuntime.setVisible(false);
        } else if (panelShadowHostForPanelRuntime) {
          panelShadowHostForPanelRuntime.style.display = 'none';
        }
      }

      try {
        if (isPanelVisibleForPanelRuntime) {
          const didHideForPanelRuntime = await waitForPanelUiHiddenConfirmationForPanelRuntime(
            panelShadowHostForPanelRuntime,
            8
          );
          if (!didHideForPanelRuntime) {
            return { ok: false, error: 'Could not hide extension UI before screenshot.' };
          }
        }
        const sharedActionsForPanelRuntime = getSharedActionsForPanelRuntime();
        const actionForPanelRuntime = sharedActionsForPanelRuntime.captureVisibleTabScreenshot || 'captureVisibleTabScreenshot';
        let lastResponseForPanelRuntime = null;
        for (let attemptForPanelRuntime = 0; attemptForPanelRuntime < 2; attemptForPanelRuntime++) {
          if (attemptForPanelRuntime > 0 && isPanelVisibleForPanelRuntime) {
            await waitForAnimationFramesForPanelRuntime(2);
            await waitMsForPanelRuntime(80);
          }
          const responseForPanelRuntime = await sendRuntimeMessageForPanelRuntime({ action: actionForPanelRuntime });
          lastResponseForPanelRuntime = responseForPanelRuntime;
          if (responseForPanelRuntime && responseForPanelRuntime.ok && responseForPanelRuntime.dataUrl) {
            return responseForPanelRuntime;
          }
        }
        return lastResponseForPanelRuntime || { ok: false, error: 'Screenshot capture failed.' };
      } finally {
        if (isPanelVisibleForPanelRuntime) {
          if (canTogglePanelForPanelRuntime) {
            panelControllerForPanelRuntime.setVisible(true);
          } else if (panelShadowHostForPanelRuntime) {
            panelShadowHostForPanelRuntime.style.display = 'block';
          }
        }
      }
    }

    async function resolveChipPreviewPayloadForPanelRuntime(chipSourceForPanelRuntime) {
      const chipMetaForPanelRuntime = normalizeChipPreviewSourceForPanelRuntime(chipSourceForPanelRuntime);
      if (!chipMetaForPanelRuntime) {
        return { previewType: 'markdown', content: '' };
      }
      const inlineContentForPanelRuntime = String(chipMetaForPanelRuntime.content || '');
      const blobIdForPanelRuntime = Number(chipMetaForPanelRuntime.refId);
      const blobRecordForPanelRuntime = Number.isFinite(blobIdForPanelRuntime)
        ? await getAttachmentBlobForPanelRuntime(blobIdForPanelRuntime)
        : null;
      const imageDataUrlForPanelRuntime = blobRecordForPanelRuntime && typeof blobRecordForPanelRuntime.dataUrl === 'string'
        ? String(blobRecordForPanelRuntime.dataUrl || '')
        : '';
      const blobTextContentForPanelRuntime = blobRecordForPanelRuntime && typeof blobRecordForPanelRuntime.textContent === 'string'
        ? String(blobRecordForPanelRuntime.textContent || '').trim()
        : '';
      const chipTypeForPanelRuntime = String(chipMetaForPanelRuntime.type || '').trim().toLowerCase();

      if ((chipTypeForPanelRuntime === 'image' || chipTypeForPanelRuntime === 'screenshot') && imageDataUrlForPanelRuntime.indexOf('data:image/') === 0) {
        return {
          previewType: 'image',
          dataUrl: imageDataUrlForPanelRuntime
        };
      }

      const inlineImageDataUrlForPanelRuntime = extractImageDataUrlFromTextForPanelRuntime(inlineContentForPanelRuntime);
      if (inlineImageDataUrlForPanelRuntime) {
        return {
          previewType: 'image',
          dataUrl: inlineImageDataUrlForPanelRuntime
        };
      }

      const isHtmlMimeTypeForPanelRuntime = chipMetaForPanelRuntime.mimeType === 'text/html';

      if (inlineContentForPanelRuntime.trim()) {
        if (isHtmlMimeTypeForPanelRuntime) {
          return { previewType: 'code', content: inlineContentForPanelRuntime };
        }
        return { previewType: 'markdown', content: inlineContentForPanelRuntime };
      }

      if (chipMetaForPanelRuntime.preview && chipMetaForPanelRuntime.preview.trim()) {
        return { previewType: 'text', content: chipMetaForPanelRuntime.preview.trim() };
      }

      if (chipTypeForPanelRuntime === 'note' && Number.isFinite(Number(chipMetaForPanelRuntime.refId))) {
        var repoForNotePreview = getPanelDataRepoForPanelRuntime();
        if (repoForNotePreview && typeof repoForNotePreview.getNote === 'function') {
          try {
            var noteForPreview = await repoForNotePreview.getNote(Number(chipMetaForPanelRuntime.refId));
            if (noteForPreview) {
              return { previewType: 'markdown', content: noteForPreview.body || '' };
            }
          } catch (eForNotePreview) { /* fall through */ }
        }
      }
      if (chipTypeForPanelRuntime === 'chat' && Number.isFinite(Number(chipMetaForPanelRuntime.refId))) {
        var repoForChatPreview = getPanelDataRepoForPanelRuntime();
        if (repoForChatPreview && typeof repoForChatPreview.listMessagesByChatId === 'function') {
          try {
            var msgsForChatPreview = await repoForChatPreview.listMessagesByChatId(Number(chipMetaForPanelRuntime.refId));
            var linesForChatPreview = [];
            var msgNumForChatPreview = 0;
            (msgsForChatPreview || []).forEach(function (msgForChatPreview) {
              if (!msgForChatPreview || msgForChatPreview.isHidden) return;
              if (msgForChatPreview.role !== 'user' && msgForChatPreview.role !== 'assistant') return;
              if (msgForChatPreview.role === 'assistant' && Array.isArray(msgForChatPreview.tool_calls) && msgForChatPreview.tool_calls.length > 0) return;
              msgNumForChatPreview++;
              linesForChatPreview.push('--- Message ' + msgNumForChatPreview + ' [' + msgForChatPreview.role + '] ---');
              var contentForChatPreview = typeof msgForChatPreview.md === 'string' ? msgForChatPreview.md
                : (typeof msgForChatPreview.content === 'string' ? msgForChatPreview.content : '');
              if (contentForChatPreview) linesForChatPreview.push(contentForChatPreview);
            });
            if (linesForChatPreview.length > 0) {
              return { previewType: 'text', content: linesForChatPreview.join('\n') };
            }
          } catch (eForChatPreview) { /* fall through */ }
        }
      }

      if (blobTextContentForPanelRuntime) {
        if (isHtmlMimeTypeForPanelRuntime) {
          return { previewType: 'code', content: blobTextContentForPanelRuntime };
        }
        return { previewType: 'text', content: blobTextContentForPanelRuntime };
      }

      if (imageDataUrlForPanelRuntime.indexOf('data:image/') === 0) {
        return {
          previewType: 'image',
          dataUrl: imageDataUrlForPanelRuntime
        };
      }

      return {
        previewType: 'markdown',
        content: ''
      };
    }

    /* ============================================================
      NOTE MARKDOWN RENDERER
    ============================================================ */
    function renderNoteMarkdown(text) {
      if (!text || !text.trim()) {
        return '<span class="ne-preview-empty">Nothing here yet.</span>';
      }
      return renderMarkdown(text);
    }

    function normalizeTagsForPanelRuntime(tagsForPanelRuntime) {
      if (!Array.isArray(tagsForPanelRuntime)) return [];
      const seenTagsForPanelRuntime = {};
      const normalizedTagsForPanelRuntime = [];
      tagsForPanelRuntime.forEach(function (tagForPanelRuntime) {
        const tagTextForPanelRuntime = String(tagForPanelRuntime || '').trim();
        if (!tagTextForPanelRuntime) return;
        const keyForPanelRuntime = tagTextForPanelRuntime.toLowerCase();
        if (seenTagsForPanelRuntime[keyForPanelRuntime]) return;
        seenTagsForPanelRuntime[keyForPanelRuntime] = true;
        normalizedTagsForPanelRuntime.push(tagTextForPanelRuntime);
      });
      return normalizedTagsForPanelRuntime;
    }

    function createTagPillElementForPanelRuntime(tagTextForPanelRuntime) {
      const tagPillForPanelRuntime = document.createElement('span');
      tagPillForPanelRuntime.className = 'tag-pill';
      tagPillForPanelRuntime.innerHTML = `${escHtml(tagTextForPanelRuntime)} <span style="cursor:pointer;opacity:0.5;margin-left:3px" data-action="remove-tag-pill">x</span>`;
      return tagPillForPanelRuntime;
    }

    function extractTagsFromWrapForPanelRuntime(tagsWrapForPanelRuntime) {
      if (!tagsWrapForPanelRuntime || !tagsWrapForPanelRuntime.querySelectorAll) return [];
      const tagsForPanelRuntime = [];
      tagsWrapForPanelRuntime.querySelectorAll('.tag-pill').forEach(function (tagPillForPanelRuntime) {
        if (!tagPillForPanelRuntime || !tagPillForPanelRuntime.firstChild) return;
        const tagTextForPanelRuntime = String(tagPillForPanelRuntime.firstChild.textContent || '').trim();
        if (tagTextForPanelRuntime) tagsForPanelRuntime.push(tagTextForPanelRuntime);
      });
      return normalizeTagsForPanelRuntime(tagsForPanelRuntime);
    }

    function addTagsFromInputForPanelRuntime(inputForPanelRuntime, tagsWrapForPanelRuntime) {
      if (!inputForPanelRuntime || !tagsWrapForPanelRuntime) return;
      const rawValueForPanelRuntime = String(inputForPanelRuntime.value || '').trim();
      if (!rawValueForPanelRuntime) return;
      const existingTagMapForPanelRuntime = {};
      extractTagsFromWrapForPanelRuntime(tagsWrapForPanelRuntime).forEach(function (tagForPanelRuntime) {
        existingTagMapForPanelRuntime[tagForPanelRuntime.toLowerCase()] = true;
      });
      rawValueForPanelRuntime.split(',').forEach(function (tagChunkForPanelRuntime) {
        const tagTextForPanelRuntime = tagChunkForPanelRuntime.trim();
        if (!tagTextForPanelRuntime) return;
        const tagKeyForPanelRuntime = tagTextForPanelRuntime.toLowerCase();
        if (existingTagMapForPanelRuntime[tagKeyForPanelRuntime]) return;
        existingTagMapForPanelRuntime[tagKeyForPanelRuntime] = true;
        const newTagPillForPanelRuntime = createTagPillElementForPanelRuntime(tagTextForPanelRuntime);
        tagsWrapForPanelRuntime.insertBefore(newTagPillForPanelRuntime, inputForPanelRuntime);
      });
      inputForPanelRuntime.value = '';
    }

    function bindTagInputForPanelRuntime(inputForPanelRuntime, tagsWrapForPanelRuntime) {
      if (!inputForPanelRuntime || !tagsWrapForPanelRuntime) return;
      if (inputForPanelRuntime.dataset.abchatTagInputBound === '1') return;
      inputForPanelRuntime.dataset.abchatTagInputBound = '1';
      inputForPanelRuntime.addEventListener('keydown', function (evtForPanelRuntime) {
        if (evtForPanelRuntime.key === 'Enter' || evtForPanelRuntime.key === ',') {
          evtForPanelRuntime.preventDefault();
          addTagsFromInputForPanelRuntime(inputForPanelRuntime, tagsWrapForPanelRuntime);
          notifyNoteDraftChangedForElementForPanelRuntime(inputForPanelRuntime);
        }
      });
      inputForPanelRuntime.addEventListener('blur', function () {
        addTagsFromInputForPanelRuntime(inputForPanelRuntime, tagsWrapForPanelRuntime);
        notifyNoteDraftChangedForElementForPanelRuntime(inputForPanelRuntime);
      });
    }

    function getNoteExcerptForPanelRuntime(noteBodyForPanelRuntime) {
      const flattenedForPanelRuntime = String(noteBodyForPanelRuntime || '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!flattenedForPanelRuntime) return 'No content yet...';
      if (flattenedForPanelRuntime.length <= 120) return flattenedForPanelRuntime;
      return flattenedForPanelRuntime.slice(0, 117) + '...';
    }

    const MONTH_ABBR_FOR_PANEL_RUNTIME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAY_ABBR_FOR_PANEL_RUNTIME = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    function formatTime12hForPanelRuntime(dateFor12h) {
      let hoursFor12h = dateFor12h.getHours();
      const minutesFor12h = dateFor12h.getMinutes();
      const ampmFor12h = hoursFor12h >= 12 ? 'PM' : 'AM';
      hoursFor12h = hoursFor12h % 12;
      if (hoursFor12h === 0) hoursFor12h = 12;
      const minStrFor12h = minutesFor12h < 10 ? '0' + minutesFor12h : String(minutesFor12h);
      return hoursFor12h + ':' + minStrFor12h + ' ' + ampmFor12h;
    }

    function formatTaskDueForPanelRuntime(isoStrForDue) {
      if (!isoStrForDue) return { text: '', overdue: false };
      const dueDateForDue = new Date(isoStrForDue);
      if (isNaN(dueDateForDue.getTime())) return { text: '', overdue: false };
      const todayForDue = new Date();
      const todayMidnightForDue = new Date(todayForDue.getFullYear(), todayForDue.getMonth(), todayForDue.getDate());
      const dueMidnightForDue = new Date(dueDateForDue.getFullYear(), dueDateForDue.getMonth(), dueDateForDue.getDate());
      const diffDaysForDue = Math.round((dueMidnightForDue - todayMidnightForDue) / (1000 * 60 * 60 * 24));
      const timeStrForDue = formatTime12hForPanelRuntime(dueDateForDue);
      let textForDue, overdueForDue;
      if (diffDaysForDue < 0) {
        textForDue = MONTH_ABBR_FOR_PANEL_RUNTIME[dueDateForDue.getMonth()] + ' ' + dueDateForDue.getDate() + ', ' + timeStrForDue;
        overdueForDue = true;
      } else if (diffDaysForDue === 0) {
        textForDue = 'Today, ' + timeStrForDue;
        overdueForDue = dueDateForDue.getTime() < Date.now();
      } else if (diffDaysForDue === 1) {
        textForDue = 'Tomorrow, ' + timeStrForDue;
        overdueForDue = false;
      } else if (diffDaysForDue <= 7) {
        textForDue = DAY_ABBR_FOR_PANEL_RUNTIME[dueDateForDue.getDay()] + ', ' + timeStrForDue;
        overdueForDue = false;
      } else {
        textForDue = MONTH_ABBR_FOR_PANEL_RUNTIME[dueDateForDue.getMonth()] + ' ' + dueDateForDue.getDate() + ', ' + timeStrForDue;
        overdueForDue = false;
      }
      return { text: textForDue, overdue: overdueForDue };
    }

    function formatTaskReminderForPanelRuntime(isoStrForReminder, dueIsoStrForReminder) {
      if (!isoStrForReminder) return '';
      const reminderDateForReminder = new Date(isoStrForReminder);
      if (isNaN(reminderDateForReminder.getTime())) return '';
      const timeStrForReminder = formatTime12hForPanelRuntime(reminderDateForReminder);
      if (dueIsoStrForReminder) {
        const dueDateForReminder = new Date(dueIsoStrForReminder);
        if (!isNaN(dueDateForReminder.getTime())) {
          const rDateStr = reminderDateForReminder.getFullYear() + '-' +
            String(reminderDateForReminder.getMonth() + 1).padStart(2, '0') + '-' +
            String(reminderDateForReminder.getDate()).padStart(2, '0');
          const dDateStr = dueDateForReminder.getFullYear() + '-' +
            String(dueDateForReminder.getMonth() + 1).padStart(2, '0') + '-' +
            String(dueDateForReminder.getDate()).padStart(2, '0');
          if (rDateStr === dDateStr) {
            return timeStrForReminder;
          }
        }
      }
      return MONTH_ABBR_FOR_PANEL_RUNTIME[reminderDateForReminder.getMonth()] + ' ' + reminderDateForReminder.getDate() + ', ' + timeStrForReminder;
    }

    function getLocalDateOnlyForPanelRuntime(dateObjForPanelRuntime) {
      if (!(dateObjForPanelRuntime instanceof Date) || isNaN(dateObjForPanelRuntime.getTime())) return '';
      const yearForPanelRuntime = dateObjForPanelRuntime.getFullYear();
      const monthForPanelRuntime = String(dateObjForPanelRuntime.getMonth() + 1).padStart(2, '0');
      const dayForPanelRuntime = String(dateObjForPanelRuntime.getDate()).padStart(2, '0');
      return yearForPanelRuntime + '-' + monthForPanelRuntime + '-' + dayForPanelRuntime;
    }

    function normalizeDateOnlyForPanelRuntime(rawDateForPanelRuntime) {
      if (rawDateForPanelRuntime == null || rawDateForPanelRuntime === '') return '';
      const dateTextForPanelRuntime = String(rawDateForPanelRuntime).trim();
      if (!dateTextForPanelRuntime) return '';
      const directDateMatchForPanelRuntime = dateTextForPanelRuntime.match(/^(\d{4}-\d{2}-\d{2})/);
      if (directDateMatchForPanelRuntime) {
        return directDateMatchForPanelRuntime[1];
      }
      const parsedDateForPanelRuntime = new Date(dateTextForPanelRuntime);
      if (isNaN(parsedDateForPanelRuntime.getTime())) return '';
      return getLocalDateOnlyForPanelRuntime(parsedDateForPanelRuntime);
    }

    function dateOnlyToLocalMidnightForPanelRuntime(dateOnlyForPanelRuntime) {
      if (!dateOnlyForPanelRuntime || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnlyForPanelRuntime)) return null;
      const partsForPanelRuntime = dateOnlyForPanelRuntime.split('-');
      return new Date(Number(partsForPanelRuntime[0]), Number(partsForPanelRuntime[1]) - 1, Number(partsForPanelRuntime[2]));
    }

    function getTodayDateOnlyForPanelRuntime() {
      return getLocalDateOnlyForPanelRuntime(new Date());
    }

    function getQuizStatusForPanelRuntime(q) {
      if (q.isPaused) {
        const pausedUntilForStatus = normalizeDateOnlyForPanelRuntime(q.pausedUntil);
        if (pausedUntilForStatus && pausedUntilForStatus > getTodayDateOnlyForPanelRuntime()) return 'paused';
        // pausedUntil has passed or was never set — treat as active
      }
      const dueDateOnlyForPanelRuntime = normalizeDateOnlyForPanelRuntime(q.dueAt);
      if (!dueDateOnlyForPanelRuntime) return 'upcoming';
      return dueDateOnlyForPanelRuntime <= getTodayDateOnlyForPanelRuntime() ? 'due' : 'upcoming';
    }

    function formatQuizDueLabelForPanelRuntime(dataForQuizDue) {
      const statusForQuizDue = getQuizStatusForPanelRuntime(dataForQuizDue);
      if (statusForQuizDue === 'due') {
        return { label: 'Due today', overdue: true };
      }
      if (statusForQuizDue === 'paused') {
        const pausedDateOnlyForQuiz = normalizeDateOnlyForPanelRuntime(dataForQuizDue.pausedUntil);
        const pausedDateForQuiz = dateOnlyToLocalMidnightForPanelRuntime(pausedDateOnlyForQuiz);
        if (pausedDateForQuiz && !isNaN(pausedDateForQuiz.getTime())) {
          return { label: 'Resumes ' + MONTH_ABBR_FOR_PANEL_RUNTIME[pausedDateForQuiz.getMonth()] + ' ' + pausedDateForQuiz.getDate(), overdue: false };
        }
        return { label: 'Paused', overdue: false };
      }
      if (statusForQuizDue === 'upcoming') {
        const todayForQuizDue = new Date();
        const todayMidnightForQuizDue = new Date(todayForQuizDue.getFullYear(), todayForQuizDue.getMonth(), todayForQuizDue.getDate());
        const dueDateOnlyForQuizDue = normalizeDateOnlyForPanelRuntime(dataForQuizDue.dueAt);
        const dueDateForQuizDue = dateOnlyToLocalMidnightForPanelRuntime(dueDateOnlyForQuizDue);
        if (!dueDateForQuizDue || isNaN(dueDateForQuizDue.getTime())) {
          return { label: '', overdue: false };
        }
        const dueMidnightForQuizDue = new Date(dueDateForQuizDue.getFullYear(), dueDateForQuizDue.getMonth(), dueDateForQuizDue.getDate());
        const diffDaysForQuizDue = Math.round((dueMidnightForQuizDue - todayMidnightForQuizDue) / (1000 * 60 * 60 * 24));
        if (diffDaysForQuizDue === 1) return { label: 'Due tomorrow', overdue: false };
        return { label: 'Due in ' + diffDaysForQuizDue + ' days', overdue: false };
      }
      return { label: '', overdue: false };
    }

    function renderAttachmentChipForPanelRuntime(attachmentsWrapForPanelRuntime, attachmentForPanelRuntime, attachTypeForPanelRuntime) {
      if (!attachmentsWrapForPanelRuntime || !attachmentForPanelRuntime) return;
      const resolvedTypeForChip = String(attachTypeForPanelRuntime || 'file').trim() || 'file';
      const addButtonForPanelRuntime = attachmentsWrapForPanelRuntime.querySelector('.ne-attach-add');
      const chipForPanelRuntime = document.createElement('span');
      chipForPanelRuntime.className = 'ic m-chip-' + resolvedTypeForChip + ' ne-attach-chip';
      chipForPanelRuntime.dataset.attachType = resolvedTypeForChip;
      chipForPanelRuntime.dataset.attachContext = 'note';
      chipForPanelRuntime.dataset.attachName = attachmentForPanelRuntime.name || '';
      var refIdForMainChip = Number(attachmentForPanelRuntime.refId);
      chipForPanelRuntime.dataset.attachRefId = Number.isFinite(refIdForMainChip) ? String(refIdForMainChip) : '';
      chipForPanelRuntime.innerHTML = getAttachIconSvgForPanelRuntime(resolvedTypeForChip) + ' ' + escHtml(truncateChipLabelForPanelRuntime(attachmentForPanelRuntime.name || 'attachment')) + ' <span class="ic-remove" data-action="remove-ic">' + ic.x10 + '</span>';
      chipForPanelRuntime.addEventListener('click', function (evtForPanelRuntime) {
        if (!evtForPanelRuntime.target.classList.contains('ic-remove') && !evtForPanelRuntime.target.closest('.ic-remove')) {
          const formForPanelRuntime = root.getElementById('note-editor-form');
          if (formForPanelRuntime && !formForPanelRuntime.classList.contains('in-edit-mode')) {
            resolveChipPreviewPayloadForPanelRuntime(chipForPanelRuntime).then(function (previewPayloadForPanelRuntime) {
              openAttachmentPreview(chipForPanelRuntime.dataset.attachName, previewPayloadForPanelRuntime);
            });
          }
        }
      });
      if (addButtonForPanelRuntime) {
        attachmentsWrapForPanelRuntime.insertBefore(chipForPanelRuntime, addButtonForPanelRuntime);
      } else {
        attachmentsWrapForPanelRuntime.appendChild(chipForPanelRuntime);
      }
    }

    function renderAttachmentChipForPopoutForPanelRuntime(popoutForPanelRuntime, attachmentsWrapForPanelRuntime, attachmentForPanelRuntime, attachTypeForPanelRuntime) {
      if (!popoutForPanelRuntime || !attachmentsWrapForPanelRuntime || !attachmentForPanelRuntime) return;
      const resolvedTypeForPopoutChip = String(attachTypeForPanelRuntime || 'file').trim() || 'file';
      const addButtonForPanelRuntime = attachmentsWrapForPanelRuntime.querySelector('.note-popout-attach-add');
      const chipForPanelRuntime = document.createElement('span');
      chipForPanelRuntime.className = 'ic m-chip-' + resolvedTypeForPopoutChip + ' note-popout-attach-chip';
      chipForPanelRuntime.dataset.attachType = resolvedTypeForPopoutChip;
      chipForPanelRuntime.dataset.attachContext = 'note';
      chipForPanelRuntime.dataset.attachName = attachmentForPanelRuntime.name || '';
      var refIdForPopoutChip = Number(attachmentForPanelRuntime.refId);
      chipForPanelRuntime.dataset.attachRefId = Number.isFinite(refIdForPopoutChip) ? String(refIdForPopoutChip) : '';
      chipForPanelRuntime.innerHTML = getAttachIconSvgForPanelRuntime(resolvedTypeForPopoutChip) + ' ' + escHtml(truncateChipLabelForPanelRuntime(attachmentForPanelRuntime.name || 'attachment')) + ' <span class="ic-remove" data-action="remove-ic">' + ic.x10 + '</span>';
      chipForPanelRuntime.addEventListener('click', function (evtForPanelRuntime) {
        if (!evtForPanelRuntime.target.classList.contains('ic-remove') && !evtForPanelRuntime.target.closest('.ic-remove')) {
          if (!popoutForPanelRuntime.classList.contains('in-edit-mode')) {
            resolveChipPreviewPayloadForPanelRuntime(chipForPanelRuntime).then(function (previewPayloadForPanelRuntime) {
              openAttachmentPreview(chipForPanelRuntime.dataset.attachName, previewPayloadForPanelRuntime);
            });
          }
        }
      });
      if (addButtonForPanelRuntime) {
        attachmentsWrapForPanelRuntime.insertBefore(chipForPanelRuntime, addButtonForPanelRuntime);
      } else {
        attachmentsWrapForPanelRuntime.appendChild(chipForPanelRuntime);
      }
    }

    function collectMainNoteDraftForPanelRuntime() {
      const titleInputForPanelRuntime = root.getElementById('ne-title');
      const bodyInputForPanelRuntime = root.getElementById('ne-body');
      const tagsWrapForPanelRuntime = root.getElementById('ne-tags-wrap');
      const attachmentsWrapForPanelRuntime = root.getElementById('ne-attachments');
      if (!titleInputForPanelRuntime || !bodyInputForPanelRuntime || !tagsWrapForPanelRuntime || !attachmentsWrapForPanelRuntime) {
        return null;
      }
      const attachmentChipsForPanelRuntime = Array.from(attachmentsWrapForPanelRuntime.querySelectorAll('.ne-attach-chip'));
      const existingNoteForDraft = S.activeNoteId ? NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId] : null;
      return {
        title: titleInputForPanelRuntime.value || '',
        body: bodyInputForPanelRuntime.value || '',
        tags: extractTagsFromWrapForPanelRuntime(tagsWrapForPanelRuntime),
        attachments: attachmentChipsForPanelRuntime
          .filter(function (chipForDraft) { return chipForDraft.dataset.attachName; })
          .map(function (chipForDraft) {
            var refIdForMainDraft = Number(chipForDraft.dataset.attachRefId);
            return { name: chipForDraft.dataset.attachName || '', refId: Number.isFinite(refIdForMainDraft) ? refIdForMainDraft : null };
          }),
        noteType: existingNoteForDraft ? existingNoteForDraft.noteType : 'user',
        sourceChatId: existingNoteForDraft ? existingNoteForDraft.sourceChatId : null,
      };
    }

    function setActiveNoteListItemForPanelRuntime(noteIdForPanelRuntime) {
      root.querySelectorAll('.note-item').forEach(function (noteItemForPanelRuntime) {
        noteItemForPanelRuntime.classList.toggle('active', Number(noteItemForPanelRuntime.dataset.noteId) === noteIdForPanelRuntime);
      });
    }

    function syncNoteListOrderInDomForPanelRuntime() {
      const notesListForPanelRuntime = root.querySelector('.notes-list');
      if (!notesListForPanelRuntime) return;
      NOTE_ORDER_FOR_PANEL_RUNTIME.forEach(function (noteIdForPanelRuntime) {
        const noteItemForPanelRuntime = notesListForPanelRuntime.querySelector(`.note-item[data-note-id="${noteIdForPanelRuntime}"]`);
        if (noteItemForPanelRuntime) {
          notesListForPanelRuntime.appendChild(noteItemForPanelRuntime);
        }
      });
    }

    function refreshNoteOrderForPanelRuntime() {
      sortNoteOrderByUpdatedForPanelRuntime();
      syncNoteListOrderInDomForPanelRuntime();
    }

    function syncTaskListOrderInDomForPanelRuntime() {
      const tasksListForPanelRuntime = root.querySelector('.tasks-list');
      if (!tasksListForPanelRuntime) return;
      TASK_ORDER_FOR_PANEL_RUNTIME.forEach(function (taskIdForPanelRuntime) {
        const taskItemForPanelRuntime = tasksListForPanelRuntime.querySelector(`.task-item[data-task-id="${taskIdForPanelRuntime}"]`);
        if (taskItemForPanelRuntime) {
          tasksListForPanelRuntime.appendChild(taskItemForPanelRuntime);
        }
      });
    }

    function refreshTaskDotForPanelRuntime() {
      var dotForTask = root.getElementById('tasks-tab-dot');
      if (!dotForTask) return;
      var hasOverdue = TASK_ORDER_FOR_PANEL_RUNTIME.some(function (id) {
        var t = TASK_STORE_FOR_PANEL_RUNTIME[id];
        return t && !t.isCompleted && formatTaskDueForPanelRuntime(t.dueAt).overdue;
      });
      dotForTask.style.display = hasOverdue ? '' : 'none';
    }

    function refreshTaskOrderForPanelRuntime() {
      sortTaskOrderByUpdatedForPanelRuntime();
      syncTaskListOrderInDomForPanelRuntime();
      refreshTaskDotForPanelRuntime();
    }

    function syncQuizListOrderInDomForPanelRuntime() {
      const questionsListForPanelRuntime = root.querySelector('.questions-list');
      if (!questionsListForPanelRuntime) return;
      QUIZ_ORDER_FOR_PANEL_RUNTIME.forEach(function (questionIdForPanelRuntime) {
        const questionItemForPanelRuntime = questionsListForPanelRuntime.querySelector(`.question-item[data-qid="${questionIdForPanelRuntime}"]`);
        if (questionItemForPanelRuntime) {
          questionsListForPanelRuntime.appendChild(questionItemForPanelRuntime);
        }
      });
    }

    function refreshDueCountsForPanelRuntime() {
      var count = 0;
      QUIZ_ORDER_FOR_PANEL_RUNTIME.forEach(function (id) {
        var q = QUIZ_STORE_FOR_PANEL_RUNTIME[id];
        if (q && getQuizStatusForPanelRuntime(q) === 'due') count++;
      });

      var sessionBadge = root.getElementById('session-due-count');
      var filterBadge  = root.getElementById('filter-due-count');
      var tabDot       = root.getElementById('quiz-tab-dot');

      if (sessionBadge) {
        sessionBadge.textContent = String(count);
        sessionBadge.style.display = count > 0 ? '' : 'none';
      }
      if (filterBadge) {
        filterBadge.textContent = String(count);
        filterBadge.style.display = count > 0 ? '' : 'none';
      }
      if (tabDot) {
        tabDot.style.display = count > 0 ? '' : 'none';
      }
    }

    function refreshQuizOrderForPanelRuntime() {
      sortQuizOrderByUpdatedForPanelRuntime();
      syncQuizListOrderInDomForPanelRuntime();
      refreshDueCountsForPanelRuntime();
    }

    var _refreshTimersForPanelRuntime = {};
    // Per-store pending data accumulated across the 50 ms scheduler debounce
    // window. Shape: { fullRefresh: boolean, ops: [{op,id}, ...] }
    // When fullRefresh is set or ops is empty, the flush runs the legacy
    // full-list refresh; otherwise it goes through the incremental apply path.
    var _pendingRefreshDataForPanelRuntime = {};

    async function executeStoreRefreshForPanelRuntime(storeNameForRefresh) {
      var repoForRefresh = getPanelDataRepoForPanelRuntime();
      if (!repoForRefresh) return;

      if (storeNameForRefresh === 'chats') {
        var chatsFromDb;
        try { chatsFromDb = await (typeof repoForRefresh.listChatsMeta === 'function' ? repoForRefresh.listChatsMeta() : repoForRefresh.listChats()); } catch (eForChatsRefresh) { return; }
        if (!Array.isArray(chatsFromDb)) return;

        // Capture the active chat's updatedAt BEFORE upserting from the DB
        // payload. The active-chat message refetch and re-render below are
        // gated on whether this value changes, so an unrelated chat mutation
        // (rename, delete, etc.) no longer triggers a wasteful messages
        // refetch + DOM rebuild for the active chat.
        var activeChatIdAtRefreshStart = S.activeChatId;
        var previousActiveChatUpdatedAtForGate = '';
        if (activeChatIdAtRefreshStart) {
          var activeChatBeforeUpsertForGate = CHAT_STORE_FOR_PANEL_RUNTIME[activeChatIdAtRefreshStart];
          if (activeChatBeforeUpsertForGate) {
            previousActiveChatUpdatedAtForGate = activeChatBeforeUpsertForGate.updatedAt || '';
          }
        }

        var dbChatIdSetForRefresh = new Set();
        chatsFromDb.forEach(function (cForRefresh) {
          if (cForRefresh && cForRefresh.id != null) dbChatIdSetForRefresh.add(Number(cForRefresh.id));
        });

        CHAT_ORDER_FOR_PANEL_RUNTIME.slice().forEach(function (idForRefresh) {
          if (!dbChatIdSetForRefresh.has(idForRefresh)) {
            removeChatFromRuntimeStoreForPanelRuntime(idForRefresh);
            removeChatUiForPanelRuntime(idForRefresh);
          }
        });

        chatsFromDb.forEach(function (cForRefresh) {
          if (!cForRefresh || cForRefresh.id == null) return;
          var numericIdForRefresh = Number(cForRefresh.id);
          var existingChatForRefresh = CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForRefresh];
              // Preserve already-loaded messages during a store refresh so that chats the user
          // has opened this session keep their messages in memory without a redundant DB
          // fetch. Only the active chat gets a fresh DB fetch below (to pick up remote
          // changes). Unsaved in-flight messages (_persistedToDb===false) are re-appended
          // so nothing sent mid-refresh is lost.
          // REGRESSION RISK: do not replace CHAT_STORE messages with [] here; that would
          // silently unload messages and force another DB round-trip on next selectChat.
          var persistedMsgsForRefresh = chatMessagesLoadedSetForPanelRuntime.has(numericIdForRefresh) && existingChatForRefresh && Array.isArray(existingChatForRefresh.messages)
            ? existingChatForRefresh.messages.filter(function (mForRefresh) { return mForRefresh && mForRefresh._persistedToDb !== false; })
            : [];
          var pendingMsgsForRefresh = existingChatForRefresh && Array.isArray(existingChatForRefresh.messages)
            ? existingChatForRefresh.messages.filter(function (mForRefresh) {
                return mForRefresh && mForRefresh._persistedToDb === false;
              })
            : [];
          CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForRefresh] = cloneChatRecordForPanelRuntime(cForRefresh);
          var allMsgsForRefresh = persistedMsgsForRefresh.concat(pendingMsgsForRefresh);
          CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForRefresh].messages = allMsgsForRefresh;
          if (allMsgsForRefresh.length > 0) {
            CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForRefresh].summary = getChatSummaryFromMessagesForPanelRuntime(allMsgsForRefresh) || CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForRefresh].summary;
          }
        });

        var oldChatIdSetForRefresh = new Set(CHAT_ORDER_FOR_PANEL_RUNTIME);
        CHAT_ORDER_FOR_PANEL_RUNTIME.length = 0;
        chatsFromDb.forEach(function (cForRefresh) {
          if (cForRefresh && cForRefresh.id != null) CHAT_ORDER_FOR_PANEL_RUNTIME.push(Number(cForRefresh.id));
        });

        // Expand the rendered window to cover newly arrived chats. When cross-tab sync
        // adds chats at the top of CHAT_ORDER, renderedChatCountForPanelRuntime must grow
        // by the same count or the item at the old boundary falls outside the rebuild's
        // scope, leaving it stranded in the DOM without a group label. Capping at the
        // initial page size here would shrink the window below its current value when
        // the user had already scrolled past one page, so cap at the total instead.
        var newChatCountForRefresh = CHAT_ORDER_FOR_PANEL_RUNTIME.filter(function (id) {
          return !oldChatIdSetForRefresh.has(id);
        }).length;
        if (newChatCountForRefresh > 0) {
          renderedChatCountForPanelRuntime = Math.min(
            renderedChatCountForPanelRuntime + newChatCountForRefresh,
            CHAT_ORDER_FOR_PANEL_RUNTIME.length
          );
        }

        var activeChatIdForRefresh = S.activeChatId;
        var activeChatRecordChangedForRefresh = false;
        if (activeChatIdForRefresh && dbChatIdSetForRefresh.has(activeChatIdForRefresh) && !sendingChatsForPanelRuntime.has(activeChatIdForRefresh)) {
          // Did the active chat's row itself change? An unchanged updatedAt
          // means messages and metadata are identical to what we already
          // hold in memory, so listMessagesByChatId would just round-trip
          // the same payload. Skip the refetch and the re-render that
          // follows; model picker reconciliation still runs because that
          // reads from the in-memory store (already upserted above) and
          // costs nothing.
          var activeStoreAfterUpsertForGate = CHAT_STORE_FOR_PANEL_RUNTIME[activeChatIdForRefresh];
          var newActiveChatUpdatedAtForGate = activeStoreAfterUpsertForGate
            ? (activeStoreAfterUpsertForGate.updatedAt || '')
            : '';
          activeChatRecordChangedForRefresh =
            previousActiveChatUpdatedAtForGate !== newActiveChatUpdatedAtForGate ||
            !chatMessagesLoadedSetForPanelRuntime.has(activeChatIdForRefresh);
          if (activeChatRecordChangedForRefresh) {
            try {
              var freshMsgsForActiveRefresh = await repoForRefresh.listMessagesByChatId(activeChatIdForRefresh);
              var activeStoreForRefresh = CHAT_STORE_FOR_PANEL_RUNTIME[activeChatIdForRefresh];
              if (activeStoreForRefresh) {
                var activePendingForRefresh = Array.isArray(activeStoreForRefresh.messages)
                  ? activeStoreForRefresh.messages.filter(function (m) { return m && m._persistedToDb === false; })
                  : [];
                activeStoreForRefresh.messages = freshMsgsForActiveRefresh.map(function (m) { return Object.assign({}, m, { _persistedToDb: true }); });
                if (activePendingForRefresh.length > 0) {
                  Array.prototype.push.apply(activeStoreForRefresh.messages, activePendingForRefresh);
                }
                chatMessagesLoadedSetForPanelRuntime.add(activeChatIdForRefresh);
                // Rebuild hidden-pair set from the freshly-loaded messages so cross-tab
                // hide/show toggles (persisted via updateMessage with { isHidden }) take
                // effect here. Without this, the receiver's local S.hiddenPairIds stays
                // frozen at the value selectChat captured and would drift out of sync.
                S.hiddenPairIds = new Set();
                activeStoreForRefresh.messages.forEach(function (mForHiddenRebuild) {
                  if (mForHiddenRebuild && mForHiddenRebuild.role === 'user' && mForHiddenRebuild.isHidden) {
                    S.hiddenPairIds.add(mForHiddenRebuild.id);
                  }
                });
              }
            } catch (eForActiveRefresh) {}
          }

          // Cross-tab model-picker sync: if another tab sent a message that
          // changed this chat's lastModel, mirror it into our picker so the
          // next send here uses the same model the user last chose remotely.
          // Skipped while a local send is in flight (handled by the outer
          // sendingChatsForPanelRuntime guard).
          var activeStoreForModelSync = CHAT_STORE_FOR_PANEL_RUNTIME[activeChatIdForRefresh];
          var lastModelForModelSync = activeStoreForModelSync && activeStoreForModelSync.lastModel;
          if (lastModelForModelSync) {
            var chatModelSelectForModelSync = root.getElementById('chat-model-select');
            if (chatModelSelectForModelSync && chatModelSelectForModelSync.value !== lastModelForModelSync) {
              chatModelSelectForModelSync.value = lastModelForModelSync;
              if (chatModelSelectForModelSync.value === lastModelForModelSync) {
                syncModelPickerLabelForPanelRuntime();
              }
            }
          }
        }

        CHAT_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForRefresh, idxForRefresh) {
          if (idxForRefresh < renderedChatCountForPanelRuntime) {
            syncMainChatListItemForPanelRuntime(idForRefresh, false);
          }
        });
        rebuildChatListGroupingForPanelRuntime();

        // Sync search index for every chat now in the store. Uses 'update' because
        // FlexSearch v0.8 update() inserts the document when the ID does not yet exist,
        // so this handles both newly-arrived chats (cross-tab sync) and modified existing
        // chats (title/summary changes) in a single pass.
        // Chats in chatMessagesLoadedSetForPanelRuntime have their messages preserved above,
        // so their content field is indexed correctly here. Unloaded chats get content=''
        // until the user opens them (ensureChatMessagesLoadedForPanelRuntime updates the
        // index at that point).
        CHAT_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForSearchRefresh) {
          var chatForSearchRefresh = CHAT_STORE_FOR_PANEL_RUNTIME[idForSearchRefresh];
          if (chatForSearchRefresh) {
            syncSearchIndexForPanelRuntime('chats', 'update', idForSearchRefresh, chatForSearchRefresh);
          }
        });
        reapplyActiveSearchForListTypeForPanelRuntime('chats');

        var refreshedActiveChatIdForRefresh = S.activeChatId;
        // Skip re-rendering the active chat during a remote-mirrored stream.
        // Each dbDataChanged broadcast from the originator otherwise wipes the
        // receiver's live bubble (via renderChatMessages → innerHTML), causing
        // the streaming text and tool chips to flicker invisibly. The bubble
        // stays attached and event-driven; a final refresh runs on stream_end.
        //
        // Also skip when the active chat's record did not actually change
        // since the refresh started (gate computed alongside the messages
        // refetch above). An unrelated chat mutation otherwise re-runs
        // renderChatMessages → innerHTML for no benefit, which is the main
        // cause of visible flicker / scroll glitches on sidebar updates.
        // Re-check the same chat id is still active so we don't carry a flag
        // computed for a different chat if the user navigated mid-refresh.
        if (
          refreshedActiveChatIdForRefresh &&
          refreshedActiveChatIdForRefresh === activeChatIdAtRefreshStart &&
          activeChatRecordChangedForRefresh &&
          dbChatIdSetForRefresh.has(refreshedActiveChatIdForRefresh) &&
          !sendingChatsForPanelRuntime.has(refreshedActiveChatIdForRefresh) &&
          !remoteStreamingChatsForPanelRuntime.has(refreshedActiveChatIdForRefresh)
        ) {
          var convContainerForRefresh = root.querySelector('.messages-area');
          var savedScrollTopForRefresh = convContainerForRefresh ? convContainerForRefresh.scrollTop : 0;
          var wasAtBottomForRefresh = convContainerForRefresh
            ? (convContainerForRefresh.scrollHeight - convContainerForRefresh.scrollTop - convContainerForRefresh.clientHeight) < 60
            : true;
          loadGeneratedBlobsForMessagesForPanelRuntime(getActiveChatMessagesForPanelRuntime()).then(function () {
            if (S.activeChatId !== refreshedActiveChatIdForRefresh) return;
            if (sendingChatsForPanelRuntime.has(refreshedActiveChatIdForRefresh)) return;
            var mermaidDoneForDbRefresh = renderChatMessages();
            // Sync the session token/cost counter from the freshly-loaded
            // messages so remote tabs reflect the latest usage after a
            // cross-tab stream_end (the originating tab updates its counter
            // directly at send completion; receivers only get here).
            rebuildTokenCounterFromMessagesForPanelRuntime(refreshedActiveChatIdForRefresh);
            // Re-attach the live streaming bubble (if any) after the chat
            // container is rebuilt by renderChatMessages. Important for
            // remote-driven streams: without this, an incoming
            // stream_message_persisted refresh would detach the receiver's
            // mirrored bubble.
            reattachLiveTurnBubbleForPanelRuntime(refreshedActiveChatIdForRefresh);
            if (wasAtBottomForRefresh) {
              scrollChatToBottomForPanelRuntime();
            } else {
              var convForRestore = root.querySelector('.messages-area');
              if (convForRestore) convForRestore.scrollTop = savedScrollTopForRefresh;
            }
            if (mermaidDoneForDbRefresh && typeof mermaidDoneForDbRefresh.then === 'function') {
              mermaidDoneForDbRefresh.then(function () {
                if (wasAtBottomForRefresh) {
                  scrollChatToBottomForPanelRuntime();
                } else {
                  var convForMermaidRestore = root.querySelector('.messages-area');
                  if (convForMermaidRestore) convForMermaidRestore.scrollTop = savedScrollTopForRefresh;
                }
              });
            }
          });
        }
        return;
      }

      if (storeNameForRefresh === 'notes') {
        var notesFromDb;
        try { notesFromDb = await repoForRefresh.listNotes(); } catch (eForNotesRefresh) { return; }
        if (!Array.isArray(notesFromDb)) return;

        var dbNoteIdSetForRefresh = new Set();
        notesFromDb.forEach(function (nForRefresh) {
          if (nForRefresh && nForRefresh.id != null) dbNoteIdSetForRefresh.add(Number(nForRefresh.id));
        });

        NOTE_ORDER_FOR_PANEL_RUNTIME.slice().forEach(function (idForRefresh) {
          if (!dbNoteIdSetForRefresh.has(idForRefresh)) {
            delete NOTE_STORE_FOR_PANEL_RUNTIME[idForRefresh];
            var idxForRefresh = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(idForRefresh);
            if (idxForRefresh >= 0) NOTE_ORDER_FOR_PANEL_RUNTIME.splice(idxForRefresh, 1);
            removeMainNoteListItemForPanelRuntime(idForRefresh);
            syncSearchIndexForPanelRuntime('notes', 'remove', idForRefresh);
          }
        });

        var oldNoteIdSetForRefresh = new Set(NOTE_ORDER_FOR_PANEL_RUNTIME);
        notesFromDb.forEach(function (nForRefresh) {
          if (!nForRefresh || nForRefresh.id == null) return;
          var numIdForRefresh = Number(nForRefresh.id);
          NOTE_STORE_FOR_PANEL_RUNTIME[numIdForRefresh] = cloneNoteRecordForPanelRuntime(nForRefresh);
          if (nForRefresh.noteType !== 'agent' && NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(numIdForRefresh) < 0) {
            NOTE_ORDER_FOR_PANEL_RUNTIME.push(numIdForRefresh);
          }
        });

        var newNoteCountForRefresh = NOTE_ORDER_FOR_PANEL_RUNTIME.filter(function (id) {
          return !oldNoteIdSetForRefresh.has(id);
        }).length;
        if (newNoteCountForRefresh > 0) {
          renderedNoteCountForPanelRuntime = Math.min(
            renderedNoteCountForPanelRuntime + newNoteCountForRefresh,
            NOTE_ORDER_FOR_PANEL_RUNTIME.length
          );
        }

        NOTE_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForRefresh) {
          syncMainNoteListItemForPanelRuntime(idForRefresh, false);
        });
        refreshNoteOrderForPanelRuntime();
        NOTE_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForSearchRefresh) {
          var noteForSearchRefresh = NOTE_STORE_FOR_PANEL_RUNTIME[idForSearchRefresh];
          if (noteForSearchRefresh) {
            syncSearchIndexForPanelRuntime('notes', 'update', idForSearchRefresh, noteForSearchRefresh);
          }
        });
        reapplyActiveSearchForListTypeForPanelRuntime('notes');
        var activeNoteIdForRefresh = Number(S.activeNoteId);
        if (Number.isFinite(activeNoteIdForRefresh) && NOTE_STORE_FOR_PANEL_RUNTIME[activeNoteIdForRefresh]) {
          var mainFormForNoteRefresh = root.getElementById('note-editor-form');
          if (mainFormForNoteRefresh && !mainFormForNoteRefresh.classList.contains('hidden')) {
            var mainDraftForNoteRefresh = collectMainNoteDraftForPanelRuntime();
            var activeNoteForRefresh = NOTE_STORE_FOR_PANEL_RUNTIME[activeNoteIdForRefresh];
            var mainHasRemoteDraftForRefresh = mainFormForNoteRefresh.dataset &&
              mainFormForNoteRefresh.dataset.noteRemoteDraft === '1' &&
              String(mainFormForNoteRefresh.dataset.noteBaseUpdatedAt || '') === String(activeNoteForRefresh.updatedAt || '');
            if (mainFormForNoteRefresh.classList.contains('in-edit-mode') && noteDraftHasLocalChangesForPanelRuntime(mainDraftForNoteRefresh, mainFormForNoteRefresh)) {
              showNoteConflictNoticeForPanelRuntime(mainFormForNoteRefresh, 'This note was saved in another tab. Your local draft was kept; save may require resolving the newer version.');
            } else if (!mainHasRemoteDraftForRefresh && !isNotePoppedOutForPanelRuntime(activeNoteIdForRefresh)) {
              applyNoteDataToMainEditorForPanelRuntime(activeNoteIdForRefresh, mainFormForNoteRefresh.classList.contains('in-edit-mode'));
            }
          }
        }
        Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).forEach(function (noteIdKeyForRefresh) {
          var noteIdForPopoutRefresh = Number(noteIdKeyForRefresh);
          var popoutForRefresh = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdKeyForRefresh];
          if (!popoutForRefresh || !NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPopoutRefresh]) return;
          var popoutDraftForRefresh = collectNoteDataFromPopoutForPanelRuntime(popoutForRefresh);
          var noteForPopoutRefresh = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPopoutRefresh];
          var popoutHasRemoteDraftForRefresh = popoutForRefresh.dataset &&
            popoutForRefresh.dataset.noteRemoteDraft === '1' &&
            String(popoutForRefresh.dataset.noteBaseUpdatedAt || '') === String(noteForPopoutRefresh.updatedAt || '');
          if (popoutForRefresh.classList.contains('in-edit-mode') && noteDraftHasLocalChangesForPanelRuntime(popoutDraftForRefresh, popoutForRefresh)) {
            showNoteConflictNoticeForPanelRuntime(popoutForRefresh, 'This note was saved in another tab. Your local draft was kept; save may require resolving the newer version.');
          } else if (!popoutHasRemoteDraftForRefresh) {
            applyNoteDataToPopoutForPanelRuntime(popoutForRefresh, NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPopoutRefresh]);
          }
        });
        return;
      }

      if (storeNameForRefresh === 'tasks') {
        var tasksFromDb;
        try { tasksFromDb = await repoForRefresh.listTasks(); } catch (eForTasksRefresh) { return; }
        if (!Array.isArray(tasksFromDb)) return;

        var dbTaskIdSetForRefresh = new Set();
        tasksFromDb.forEach(function (tForRefresh) {
          if (tForRefresh && tForRefresh.id != null) dbTaskIdSetForRefresh.add(Number(tForRefresh.id));
        });

        TASK_ORDER_FOR_PANEL_RUNTIME.slice().forEach(function (idForRefresh) {
          if (!dbTaskIdSetForRefresh.has(idForRefresh)) {
            delete TASK_STORE_FOR_PANEL_RUNTIME[idForRefresh];
            var idxForRefresh = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(idForRefresh);
            if (idxForRefresh >= 0) TASK_ORDER_FOR_PANEL_RUNTIME.splice(idxForRefresh, 1);
            removeMainTaskListItemForPanelRuntime(idForRefresh);
            syncSearchIndexForPanelRuntime('tasks', 'remove', idForRefresh);
          }
        });

        var oldTaskIdSetForRefresh = new Set(TASK_ORDER_FOR_PANEL_RUNTIME);
        tasksFromDb.forEach(function (tForRefresh) {
          if (!tForRefresh || tForRefresh.id == null) return;
          var numIdForRefresh = Number(tForRefresh.id);
          TASK_STORE_FOR_PANEL_RUNTIME[numIdForRefresh] = cloneTaskRecordForPanelRuntime(tForRefresh);
          if (TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(numIdForRefresh) < 0) {
            TASK_ORDER_FOR_PANEL_RUNTIME.push(numIdForRefresh);
          }
        });

        var newTaskCountForRefresh = TASK_ORDER_FOR_PANEL_RUNTIME.filter(function (id) {
          return !oldTaskIdSetForRefresh.has(id);
        }).length;
        if (newTaskCountForRefresh > 0) {
          renderedTaskCountForPanelRuntime = Math.min(
            renderedTaskCountForPanelRuntime + newTaskCountForRefresh,
            TASK_ORDER_FOR_PANEL_RUNTIME.length
          );
        }

        TASK_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForRefresh) {
          syncMainTaskListItemForPanelRuntime(idForRefresh, false);
        });
        refreshTaskOrderForPanelRuntime();
        TASK_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForSearchRefresh) {
          var taskForSearchRefresh = TASK_STORE_FOR_PANEL_RUNTIME[idForSearchRefresh];
          if (taskForSearchRefresh) {
            syncSearchIndexForPanelRuntime('tasks', 'update', idForSearchRefresh, taskForSearchRefresh);
          }
        });
        reapplyActiveSearchForListTypeForPanelRuntime('tasks');
        return;
      }

      if (storeNameForRefresh === 'questions') {
        var questionsFromDb;
        try { questionsFromDb = await repoForRefresh.listQuestions(); } catch (eForQuestionsRefresh) { return; }
        if (!Array.isArray(questionsFromDb)) return;

        var dbQuizIdSetForRefresh = new Set();
        questionsFromDb.forEach(function (qForRefresh) {
          if (qForRefresh && qForRefresh.id != null) dbQuizIdSetForRefresh.add(Number(qForRefresh.id));
        });

        QUIZ_ORDER_FOR_PANEL_RUNTIME.slice().forEach(function (idForRefresh) {
          if (!dbQuizIdSetForRefresh.has(idForRefresh)) {
            delete QUIZ_STORE_FOR_PANEL_RUNTIME[idForRefresh];
            var idxForRefresh = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(idForRefresh);
            if (idxForRefresh >= 0) QUIZ_ORDER_FOR_PANEL_RUNTIME.splice(idxForRefresh, 1);
            removeMainQuizListItemForPanelRuntime(idForRefresh);
            syncSearchIndexForPanelRuntime('questions', 'remove', idForRefresh);
          }
        });

        var oldQuizIdSetForRefresh = new Set(QUIZ_ORDER_FOR_PANEL_RUNTIME);
        questionsFromDb.forEach(function (qForRefresh) {
          if (!qForRefresh || qForRefresh.id == null) return;
          var numIdForRefresh = Number(qForRefresh.id);
          QUIZ_STORE_FOR_PANEL_RUNTIME[numIdForRefresh] = cloneQuestionRecordForPanelRuntime(qForRefresh);
          if (QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(numIdForRefresh) < 0) {
            QUIZ_ORDER_FOR_PANEL_RUNTIME.push(numIdForRefresh);
          }
        });

        var newQuizCountForRefresh = QUIZ_ORDER_FOR_PANEL_RUNTIME.filter(function (id) {
          return !oldQuizIdSetForRefresh.has(id);
        }).length;
        if (newQuizCountForRefresh > 0) {
          renderedQuizCountForPanelRuntime = Math.min(
            renderedQuizCountForPanelRuntime + newQuizCountForRefresh,
            QUIZ_ORDER_FOR_PANEL_RUNTIME.length
          );
        }

        QUIZ_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForRefresh) {
          syncMainQuizListItemForPanelRuntime(idForRefresh, false);
        });
        refreshQuizOrderForPanelRuntime();
        QUIZ_ORDER_FOR_PANEL_RUNTIME.forEach(function (idForSearchRefresh) {
          var questionForSearchRefresh = QUIZ_STORE_FOR_PANEL_RUNTIME[idForSearchRefresh];
          if (questionForSearchRefresh) {
            syncSearchIndexForPanelRuntime('questions', 'update', idForSearchRefresh, questionForSearchRefresh);
          }
        });
        return;
      }
    }

    // Same per-id collapse rules as the SW's mergeOpsIntoPendingForServiceWorker.
    // Multiple incoming signals during the 50 ms scheduler debounce can carry
    // ops for the same record; collapse to the net effect before applying.
    function mergeOpsForApplyForPanelRuntime(opsArrayForMerge) {
      var resultForMerge = [];
      if (!Array.isArray(opsArrayForMerge)) return resultForMerge;
      for (var iForMerge = 0; iForMerge < opsArrayForMerge.length; iForMerge++) {
        var opForMerge = opsArrayForMerge[iForMerge];
        if (!opForMerge || !opForMerge.op) continue;
        var idForMerge = Number(opForMerge.id);
        if (!Number.isFinite(idForMerge)) continue;
        var existingIdxForMerge = -1;
        for (var jForMerge = 0; jForMerge < resultForMerge.length; jForMerge++) {
          if (resultForMerge[jForMerge].id === idForMerge) { existingIdxForMerge = jForMerge; break; }
        }
        if (existingIdxForMerge === -1) {
          resultForMerge.push({ op: opForMerge.op, id: idForMerge });
        } else {
          var existingForMerge = resultForMerge[existingIdxForMerge];
          if (opForMerge.op === 'delete') {
            if (existingForMerge.op === 'create') {
              resultForMerge.splice(existingIdxForMerge, 1);
            } else {
              resultForMerge[existingIdxForMerge] = { op: 'delete', id: idForMerge };
            }
          } else if (existingForMerge.op === 'create' && opForMerge.op === 'update') {
            // keep create
          } else {
            resultForMerge[existingIdxForMerge] = { op: opForMerge.op, id: idForMerge };
          }
        }
      }
      return resultForMerge;
    }

    // ---- Notes incremental apply -------------------------------------------------

    async function applyNotesOpsIncrementalForPanelRuntime(opsForApply, repoForApply) {
      var rebuildOrderForApply = false;
      for (var iForApply = 0; iForApply < opsForApply.length; iForApply++) {
        var opForApply = opsForApply[iForApply];
        var idForApply = opForApply.id;

        if (opForApply.op === 'delete') {
          if (NOTE_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete NOTE_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var deleteIndexForApply = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (deleteIndexForApply >= 0) {
            if (deleteIndexForApply < renderedNoteCountForPanelRuntime && renderedNoteCountForPanelRuntime > 0) {
              renderedNoteCountForPanelRuntime--;
            }
            NOTE_ORDER_FOR_PANEL_RUNTIME.splice(deleteIndexForApply, 1);
          }
          removeMainNoteListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('notes', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        var fetchedForApply;
        try {
          fetchedForApply = await repoForApply.getNote(idForApply);
        } catch (eForApply) {
          // Record was deleted between signal and our fetch — treat as delete.
          if (NOTE_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete NOTE_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var missingIndexForApply = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (missingIndexForApply >= 0) {
            if (missingIndexForApply < renderedNoteCountForPanelRuntime && renderedNoteCountForPanelRuntime > 0) {
              renderedNoteCountForPanelRuntime--;
            }
            NOTE_ORDER_FOR_PANEL_RUNTIME.splice(missingIndexForApply, 1);
          }
          removeMainNoteListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('notes', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        if (!fetchedForApply) continue;
        var wasInOrderForApply = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply) >= 0;
        NOTE_STORE_FOR_PANEL_RUNTIME[idForApply] = cloneNoteRecordForPanelRuntime(fetchedForApply);
        if (fetchedForApply.noteType !== 'agent' && !wasInOrderForApply) {
          NOTE_ORDER_FOR_PANEL_RUNTIME.push(idForApply);
          renderedNoteCountForPanelRuntime = Math.min(
            renderedNoteCountForPanelRuntime + 1,
            NOTE_ORDER_FOR_PANEL_RUNTIME.length
          );
        }
        if (fetchedForApply.noteType !== 'agent') {
          syncMainNoteListItemForPanelRuntime(idForApply, false);
        }
        syncSearchIndexForPanelRuntime(
          'notes',
          wasInOrderForApply ? 'update' : 'add',
          idForApply,
          NOTE_STORE_FOR_PANEL_RUNTIME[idForApply]
        );
        rebuildOrderForApply = true;

        // Active-note reconciliation, mirroring the full-refresh branch in
        // executeStoreRefreshForPanelRuntime('notes'). Only relevant when the
        // touched note is the active one (or in a popout).
        if (Number(S.activeNoteId) === idForApply) {
          var mainFormForActiveApply = root.getElementById('note-editor-form');
          if (mainFormForActiveApply && !mainFormForActiveApply.classList.contains('hidden')) {
            var mainDraftForActiveApply = collectMainNoteDraftForPanelRuntime();
            var activeNoteForActiveApply = NOTE_STORE_FOR_PANEL_RUNTIME[idForApply];
            var mainHasRemoteDraftForActiveApply = mainFormForActiveApply.dataset &&
              mainFormForActiveApply.dataset.noteRemoteDraft === '1' &&
              String(mainFormForActiveApply.dataset.noteBaseUpdatedAt || '') === String(activeNoteForActiveApply.updatedAt || '');
            if (mainFormForActiveApply.classList.contains('in-edit-mode') &&
                noteDraftHasLocalChangesForPanelRuntime(mainDraftForActiveApply, mainFormForActiveApply)) {
              showNoteConflictNoticeForPanelRuntime(mainFormForActiveApply, 'This note was saved in another tab. Your local draft was kept; save may require resolving the newer version.');
            } else if (!mainHasRemoteDraftForActiveApply && !isNotePoppedOutForPanelRuntime(idForApply)) {
              applyNoteDataToMainEditorForPanelRuntime(idForApply, mainFormForActiveApply.classList.contains('in-edit-mode'));
            }
          }
        }

        var popoutForApply = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[idForApply];
        if (popoutForApply && NOTE_STORE_FOR_PANEL_RUNTIME[idForApply]) {
          var popoutDraftForApply = collectNoteDataFromPopoutForPanelRuntime(popoutForApply);
          var noteForPopoutApply = NOTE_STORE_FOR_PANEL_RUNTIME[idForApply];
          var popoutHasRemoteDraftForApply = popoutForApply.dataset &&
            popoutForApply.dataset.noteRemoteDraft === '1' &&
            String(popoutForApply.dataset.noteBaseUpdatedAt || '') === String(noteForPopoutApply.updatedAt || '');
          if (popoutForApply.classList.contains('in-edit-mode') &&
              noteDraftHasLocalChangesForPanelRuntime(popoutDraftForApply, popoutForApply)) {
            showNoteConflictNoticeForPanelRuntime(popoutForApply, 'This note was saved in another tab. Your local draft was kept; save may require resolving the newer version.');
          } else if (!popoutHasRemoteDraftForApply) {
            applyNoteDataToPopoutForPanelRuntime(popoutForApply, NOTE_STORE_FOR_PANEL_RUNTIME[idForApply]);
          }
        }
      }
      if (rebuildOrderForApply) {
        refreshNoteOrderForPanelRuntime();
        reapplyActiveSearchForListTypeForPanelRuntime('notes');
      }
    }

    // ---- Tasks incremental apply -------------------------------------------------

    async function applyTasksOpsIncrementalForPanelRuntime(opsForApply, repoForApply) {
      var rebuildOrderForApply = false;
      for (var iForApply = 0; iForApply < opsForApply.length; iForApply++) {
        var opForApply = opsForApply[iForApply];
        var idForApply = opForApply.id;

        if (opForApply.op === 'delete') {
          if (TASK_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete TASK_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var deleteIndexForApply = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (deleteIndexForApply >= 0) {
            if (deleteIndexForApply < renderedTaskCountForPanelRuntime && renderedTaskCountForPanelRuntime > 0) {
              renderedTaskCountForPanelRuntime--;
            }
            TASK_ORDER_FOR_PANEL_RUNTIME.splice(deleteIndexForApply, 1);
          }
          removeMainTaskListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('tasks', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        var fetchedForApply;
        try {
          fetchedForApply = await repoForApply.getTask(idForApply);
        } catch (eForApply) {
          if (TASK_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete TASK_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var missingIndexForApply = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (missingIndexForApply >= 0) {
            if (missingIndexForApply < renderedTaskCountForPanelRuntime && renderedTaskCountForPanelRuntime > 0) {
              renderedTaskCountForPanelRuntime--;
            }
            TASK_ORDER_FOR_PANEL_RUNTIME.splice(missingIndexForApply, 1);
          }
          removeMainTaskListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('tasks', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        if (!fetchedForApply) continue;
        var wasInOrderForApply = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply) >= 0;
        TASK_STORE_FOR_PANEL_RUNTIME[idForApply] = cloneTaskRecordForPanelRuntime(fetchedForApply);
        if (!wasInOrderForApply) {
          TASK_ORDER_FOR_PANEL_RUNTIME.push(idForApply);
          renderedTaskCountForPanelRuntime = Math.min(
            renderedTaskCountForPanelRuntime + 1,
            TASK_ORDER_FOR_PANEL_RUNTIME.length
          );
        }
        syncMainTaskListItemForPanelRuntime(idForApply, false);
        syncSearchIndexForPanelRuntime(
          'tasks',
          wasInOrderForApply ? 'update' : 'add',
          idForApply,
          TASK_STORE_FOR_PANEL_RUNTIME[idForApply]
        );
        rebuildOrderForApply = true;
      }
      if (rebuildOrderForApply) {
        refreshTaskOrderForPanelRuntime();
        reapplyActiveSearchForListTypeForPanelRuntime('tasks');
      }
    }

    // ---- Questions incremental apply --------------------------------------------

    async function applyQuestionsOpsIncrementalForPanelRuntime(opsForApply, repoForApply) {
      var rebuildOrderForApply = false;
      for (var iForApply = 0; iForApply < opsForApply.length; iForApply++) {
        var opForApply = opsForApply[iForApply];
        var idForApply = opForApply.id;

        if (opForApply.op === 'delete') {
          if (QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var deleteIndexForApply = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (deleteIndexForApply >= 0) {
            if (deleteIndexForApply < renderedQuizCountForPanelRuntime && renderedQuizCountForPanelRuntime > 0) {
              renderedQuizCountForPanelRuntime--;
            }
            QUIZ_ORDER_FOR_PANEL_RUNTIME.splice(deleteIndexForApply, 1);
          }
          removeMainQuizListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('questions', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        var fetchedForApply;
        try {
          fetchedForApply = await repoForApply.getQuestion(idForApply);
        } catch (eForApply) {
          if (QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply] != null) {
            delete QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply];
          }
          var missingIndexForApply = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);
          if (missingIndexForApply >= 0) {
            if (missingIndexForApply < renderedQuizCountForPanelRuntime && renderedQuizCountForPanelRuntime > 0) {
              renderedQuizCountForPanelRuntime--;
            }
            QUIZ_ORDER_FOR_PANEL_RUNTIME.splice(missingIndexForApply, 1);
          }
          removeMainQuizListItemForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('questions', 'remove', idForApply);
          rebuildOrderForApply = true;
          continue;
        }

        if (!fetchedForApply) continue;
        var wasInOrderForApply = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply) >= 0;
        QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply] = cloneQuestionRecordForPanelRuntime(fetchedForApply);
        if (!wasInOrderForApply) {
          QUIZ_ORDER_FOR_PANEL_RUNTIME.push(idForApply);
          renderedQuizCountForPanelRuntime = Math.min(
            renderedQuizCountForPanelRuntime + 1,
            QUIZ_ORDER_FOR_PANEL_RUNTIME.length
          );
        }
        syncMainQuizListItemForPanelRuntime(idForApply, false);
        syncSearchIndexForPanelRuntime(
          'questions',
          wasInOrderForApply ? 'update' : 'add',
          idForApply,
          QUIZ_STORE_FOR_PANEL_RUNTIME[idForApply]
        );
        rebuildOrderForApply = true;
      }
      if (rebuildOrderForApply) {
        refreshQuizOrderForPanelRuntime();
      }
    }

    // ---- Chats incremental apply ------------------------------------------------

    async function applyChatsOpsIncrementalForPanelRuntime(opsForApply, repoForApply) {
      var orderChangedForApply = false;
      for (var iForApply = 0; iForApply < opsForApply.length; iForApply++) {
        var opForApply = opsForApply[iForApply];
        var idForApply = opForApply.id;

        if (opForApply.op === 'delete') {
          removeChatFromRuntimeStoreForPanelRuntime(idForApply);
          removeChatUiForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('chats', 'remove', idForApply);
          chatMessagesLoadedSetForPanelRuntime.delete(idForApply);
          orderChangedForApply = true;
          continue;
        }

        var fetchedMetaForApply;
        try {
          fetchedMetaForApply = await repoForApply.getChatMeta(idForApply);
        } catch (eForApply) {
          // Treat fetch failure as a delete to keep the in-memory store
          // in sync with what the SW reports.
          removeChatFromRuntimeStoreForPanelRuntime(idForApply);
          removeChatUiForPanelRuntime(idForApply);
          syncSearchIndexForPanelRuntime('chats', 'remove', idForApply);
          chatMessagesLoadedSetForPanelRuntime.delete(idForApply);
          orderChangedForApply = true;
          continue;
        }

        if (!fetchedMetaForApply) continue;
        var existingChatForApply = CHAT_STORE_FOR_PANEL_RUNTIME[idForApply];
        var previousUpdatedAtForApply = existingChatForApply ? (existingChatForApply.updatedAt || '') : '';
        var previousIndexForApply = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply);

        // Preserve already-loaded messages (incl. unsubmitted pending ones)
        // exactly as the full-refresh path does. Active chat re-fetch is
        // handled below for fresh DB state.
        var persistedMsgsForApply = (chatMessagesLoadedSetForPanelRuntime.has(idForApply) && existingChatForApply && Array.isArray(existingChatForApply.messages))
          ? existingChatForApply.messages.filter(function (mForFilter) { return mForFilter && mForFilter._persistedToDb !== false; })
          : [];
        var pendingMsgsForApply = (existingChatForApply && Array.isArray(existingChatForApply.messages))
          ? existingChatForApply.messages.filter(function (mForFilter) { return mForFilter && mForFilter._persistedToDb === false; })
          : [];
        CHAT_STORE_FOR_PANEL_RUNTIME[idForApply] = cloneChatRecordForPanelRuntime(fetchedMetaForApply);
        var allMsgsForApply = persistedMsgsForApply.concat(pendingMsgsForApply);
        CHAT_STORE_FOR_PANEL_RUNTIME[idForApply].messages = allMsgsForApply;
        if (allMsgsForApply.length > 0) {
          CHAT_STORE_FOR_PANEL_RUNTIME[idForApply].summary =
            getChatSummaryFromMessagesForPanelRuntime(allMsgsForApply) ||
            CHAT_STORE_FOR_PANEL_RUNTIME[idForApply].summary;
        }

        var newUpdatedAtForApply = CHAT_STORE_FOR_PANEL_RUNTIME[idForApply].updatedAt || '';

        if (previousIndexForApply < 0) {
          CHAT_ORDER_FOR_PANEL_RUNTIME.unshift(idForApply);
          renderedChatCountForPanelRuntime = Math.min(
            renderedChatCountForPanelRuntime + 1,
            CHAT_ORDER_FOR_PANEL_RUNTIME.length
          );
          orderChangedForApply = true;
        } else if (previousUpdatedAtForApply !== newUpdatedAtForApply) {
          orderChangedForApply = true;
        }

        // Active-chat refetch + re-render. Same gates as the full-refresh path:
        // skip during local send or during a remote-mirrored stream.
        var activeChatChangedForApply = false;
        if (Number(S.activeChatId) === idForApply && !sendingChatsForPanelRuntime.has(idForApply)) {
          activeChatChangedForApply =
            previousUpdatedAtForApply !== newUpdatedAtForApply ||
            !chatMessagesLoadedSetForPanelRuntime.has(idForApply);
          if (activeChatChangedForApply) {
            try {
              var freshMsgsForApply = await repoForApply.listMessagesByChatId(idForApply);
              var activeStoreForApply = CHAT_STORE_FOR_PANEL_RUNTIME[idForApply];
              if (activeStoreForApply) {
                var activePendingForApply = Array.isArray(activeStoreForApply.messages)
                  ? activeStoreForApply.messages.filter(function (m) { return m && m._persistedToDb === false; })
                  : [];
                activeStoreForApply.messages = freshMsgsForApply.map(function (mForApply) {
                  return Object.assign({}, mForApply, { _persistedToDb: true });
                });
                if (activePendingForApply.length > 0) {
                  Array.prototype.push.apply(activeStoreForApply.messages, activePendingForApply);
                }
                chatMessagesLoadedSetForPanelRuntime.add(idForApply);
                S.hiddenPairIds = new Set();
                activeStoreForApply.messages.forEach(function (mForHiddenRebuild) {
                  if (mForHiddenRebuild && mForHiddenRebuild.role === 'user' && mForHiddenRebuild.isHidden) {
                    S.hiddenPairIds.add(mForHiddenRebuild.id);
                  }
                });
              }
            } catch (eForActiveApply) {}
          }
          // Model picker reconciliation (cheap, runs even when messages didn't change)
          var activeStoreForModelApply = CHAT_STORE_FOR_PANEL_RUNTIME[idForApply];
          var lastModelForModelApply = activeStoreForModelApply && activeStoreForModelApply.lastModel;
          if (lastModelForModelApply) {
            var chatModelSelectForModelApply = root.getElementById('chat-model-select');
            if (chatModelSelectForModelApply && chatModelSelectForModelApply.value !== lastModelForModelApply) {
              chatModelSelectForModelApply.value = lastModelForModelApply;
              if (chatModelSelectForModelApply.value === lastModelForModelApply) {
                syncModelPickerLabelForPanelRuntime();
              }
            }
          }
        }

        // Sidebar list item DOM sync — always, even when not active (because
        // title/summary/updatedAt may have changed).
        if (CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply) >= 0 &&
            CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(idForApply) < renderedChatCountForPanelRuntime) {
          syncMainChatListItemForPanelRuntime(idForApply, false);
        }
        syncSearchIndexForPanelRuntime('chats', 'update', idForApply, CHAT_STORE_FOR_PANEL_RUNTIME[idForApply]);

        // Active-chat re-render (gated identically to the full-refresh path).
        if (activeChatChangedForApply &&
            Number(S.activeChatId) === idForApply &&
            !sendingChatsForPanelRuntime.has(idForApply) &&
            !remoteStreamingChatsForPanelRuntime.has(idForApply)) {
          var convContainerForApply = root.querySelector('.messages-area');
          var savedScrollTopForApply = convContainerForApply ? convContainerForApply.scrollTop : 0;
          var wasAtBottomForApply = convContainerForApply
            ? (convContainerForApply.scrollHeight - convContainerForApply.scrollTop - convContainerForApply.clientHeight) < 60
            : true;
          var chatIdForApplyRender = idForApply;
          loadGeneratedBlobsForMessagesForPanelRuntime(getActiveChatMessagesForPanelRuntime()).then(function () {
            if (S.activeChatId !== chatIdForApplyRender) return;
            if (sendingChatsForPanelRuntime.has(chatIdForApplyRender)) return;
            var mermaidDoneForApply = renderChatMessages();
            rebuildTokenCounterFromMessagesForPanelRuntime(chatIdForApplyRender);
            reattachLiveTurnBubbleForPanelRuntime(chatIdForApplyRender);
            if (wasAtBottomForApply) {
              scrollChatToBottomForPanelRuntime();
            } else {
              var convForRestoreApply = root.querySelector('.messages-area');
              if (convForRestoreApply) convForRestoreApply.scrollTop = savedScrollTopForApply;
            }
            if (mermaidDoneForApply && typeof mermaidDoneForApply.then === 'function') {
              mermaidDoneForApply.then(function () {
                if (wasAtBottomForApply) {
                  scrollChatToBottomForPanelRuntime();
                } else {
                  var convForMermaidApply = root.querySelector('.messages-area');
                  if (convForMermaidApply) convForMermaidApply.scrollTop = savedScrollTopForApply;
                }
              });
            }
          });
        }
      }

      if (orderChangedForApply) {
        // The chat order is sorted by updatedAt desc inside listChatsMeta on the
        // full-refresh path. Here we mutated CHAT_ORDER ad-hoc; re-sort it now
        // so the sidebar grouping (Today / Yesterday / etc) renders correctly.
        CHAT_ORDER_FOR_PANEL_RUNTIME.sort(function (aForSort, bForSort) {
          var chatAForSort = CHAT_STORE_FOR_PANEL_RUNTIME[aForSort];
          var chatBForSort = CHAT_STORE_FOR_PANEL_RUNTIME[bForSort];
          var aTimeForSort = chatAForSort ? new Date(chatAForSort.updatedAt || 0).getTime() : 0;
          var bTimeForSort = chatBForSort ? new Date(chatBForSort.updatedAt || 0).getTime() : 0;
          if (!Number.isFinite(aTimeForSort)) aTimeForSort = 0;
          if (!Number.isFinite(bTimeForSort)) bTimeForSort = 0;
          return bTimeForSort - aTimeForSort;
        });
        rebuildChatListGroupingForPanelRuntime();
        reapplyActiveSearchForListTypeForPanelRuntime('chats');
      }
    }

    // Dispatcher. Throws on unknown store so scheduleStoreRefreshForPanelRuntime
    // can catch and fall back to the full-refresh path.
    async function applyIncrementalOpsForPanelRuntime(storeNameForApply, opsRawForApply) {
      var opsForApply = mergeOpsForApplyForPanelRuntime(opsRawForApply);
      if (opsForApply.length === 0) return;
      var repoForApply = getPanelDataRepoForPanelRuntime();
      if (!repoForApply) throw new Error('panelDataRepo unavailable for incremental apply');
      if (storeNameForApply === 'notes') {
        await applyNotesOpsIncrementalForPanelRuntime(opsForApply, repoForApply);
        return;
      }
      if (storeNameForApply === 'tasks') {
        await applyTasksOpsIncrementalForPanelRuntime(opsForApply, repoForApply);
        return;
      }
      if (storeNameForApply === 'questions') {
        await applyQuestionsOpsIncrementalForPanelRuntime(opsForApply, repoForApply);
        return;
      }
      if (storeNameForApply === 'chats') {
        await applyChatsOpsIncrementalForPanelRuntime(opsForApply, repoForApply);
        return;
      }
      throw new Error('unknown store for incremental apply: ' + storeNameForApply);
    }

    function scheduleStoreRefreshForPanelRuntime(storeNameForRefresh, opsForRefresh) {
      if (!storeNameForRefresh) return;
      if (!_pendingRefreshDataForPanelRuntime[storeNameForRefresh]) {
        _pendingRefreshDataForPanelRuntime[storeNameForRefresh] = { fullRefresh: false, ops: [] };
      }
      var pendingForSchedule = _pendingRefreshDataForPanelRuntime[storeNameForRefresh];
      if (!Array.isArray(opsForRefresh) || opsForRefresh.length === 0) {
        // No ops payload = "do a full refresh". Manual sync button + legacy
        // signal records take this path.
        pendingForSchedule.fullRefresh = true;
      } else {
        var hasBulkForSchedule = false;
        for (var iForSchedule = 0; iForSchedule < opsForRefresh.length; iForSchedule++) {
          if (opsForRefresh[iForSchedule] && opsForRefresh[iForSchedule].op === 'bulk') {
            hasBulkForSchedule = true;
            break;
          }
        }
        if (hasBulkForSchedule) {
          pendingForSchedule.fullRefresh = true;
        } else {
          Array.prototype.push.apply(pendingForSchedule.ops, opsForRefresh);
        }
      }
      if (_refreshTimersForPanelRuntime[storeNameForRefresh]) {
        clearTimeout(_refreshTimersForPanelRuntime[storeNameForRefresh]);
      }
      // 50 ms (reduced from 250). Streaming bursts are now coalesced by a
      // 60 ms originator-side debounce in service-worker.js
      // (notifyDbChangeViaStorageForServiceWorker), so this only needs to fold
      // any signals that race the same paint here. Lower latency for discrete
      // writes — cross-tab updates feel near-instant instead of always
      // appearing after a ~quarter-second lag.
      _refreshTimersForPanelRuntime[storeNameForRefresh] = setTimeout(function () {
        _refreshTimersForPanelRuntime[storeNameForRefresh] = null;
        var pendingForFlush = _pendingRefreshDataForPanelRuntime[storeNameForRefresh];
        _pendingRefreshDataForPanelRuntime[storeNameForRefresh] = null;
        if (!pendingForFlush || pendingForFlush.fullRefresh || pendingForFlush.ops.length === 0) {
          executeStoreRefreshForPanelRuntime(storeNameForRefresh).catch(function () {});
          return;
        }
        applyIncrementalOpsForPanelRuntime(storeNameForRefresh, pendingForFlush.ops).catch(function () {
          // Any incremental apply error → fall back to full refresh so the
          // receiver still converges, just more expensively.
          executeStoreRefreshForPanelRuntime(storeNameForRefresh).catch(function () {});
        });
      }, 50);
    }

    async function triggerFullSyncForPanelRuntime(btnForSync) {
      if (btnForSync && btnForSync.classList.contains('syncing')) return;
      if (btnForSync) btnForSync.classList.add('syncing');
      var sourceIdForFullSync = '';
      var repoForFullSync = getPanelDataRepoForPanelRuntime();
      if (repoForFullSync && typeof repoForFullSync.getSourceId === 'function') {
        sourceIdForFullSync = repoForFullSync.getSourceId() || '';
      }
      sendRuntimeMessageForPanelRuntime({ action: 'abchatBroadcastFullSync', sourceId: sourceIdForFullSync });
      try {
        await Promise.allSettled([
          executeStoreRefreshForPanelRuntime('chats'),
          executeStoreRefreshForPanelRuntime('notes'),
          executeStoreRefreshForPanelRuntime('tasks'),
          executeStoreRefreshForPanelRuntime('questions'),
          new Promise(function (resolve) { setTimeout(resolve, 300); })
        ]);
      } finally {
        if (btnForSync) btnForSync.classList.remove('syncing');
      }
    }

    // bypassWindowForNote=true is passed by search when a matching item falls outside the
    // rendered window. The item is rendered temporarily and tracked in searchForcedNoteIds
    // so it can be removed when the query is cleared.
    // REGRESSION RISK: every syncMainXxxListItem must enforce the window guard on new
    // insertions (when the DOM element does not yet exist) or the windowing contract breaks.
    function syncMainNoteListItemForPanelRuntime(noteIdForPanelRuntime, prependForPanelRuntime, bypassWindowForNote) {
      const noteDataForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      const notesListForPanelRuntime = root.querySelector('.notes-list');
      if (!noteDataForPanelRuntime || !notesListForPanelRuntime) return;
      let noteItemForPanelRuntime = notesListForPanelRuntime.querySelector(`.note-item[data-note-id="${noteIdForPanelRuntime}"]`);
      const wasStarredForPanelRuntime = noteDataForPanelRuntime.starred === true;
      if (!noteItemForPanelRuntime) {
        if (!prependForPanelRuntime && !bypassWindowForNote) {
          var posForNoteWindow = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(noteIdForPanelRuntime));
          if (posForNoteWindow >= renderedNoteCountForPanelRuntime) return;
        }
        noteItemForPanelRuntime = document.createElement('div');
        noteItemForPanelRuntime.className = 'note-item';
        noteItemForPanelRuntime.dataset.noteId = noteIdForPanelRuntime;
        noteItemForPanelRuntime.dataset.action = 'select-note';
        if (prependForPanelRuntime) {
          notesListForPanelRuntime.prepend(noteItemForPanelRuntime);
          renderedNoteCountForPanelRuntime++;
        } else {
          notesListForPanelRuntime.appendChild(noteItemForPanelRuntime);
        }
      }
      const tagsForNoteItem = noteDataForPanelRuntime.tags || [];
      const primaryTagForPanelRuntime = tagsForNoteItem[0]
        ? `<span class="ni-tag">${escHtml(tagsForNoteItem[0])}</span>`
        : '';
      const secondaryTagForPanelRuntime = tagsForNoteItem[1]
        ? `<span class="ni-tag">${escHtml(tagsForNoteItem[1])}</span>`
        : '';
      const overflowCountForPanelRuntime = tagsForNoteItem.length > 2
        ? `<span class="ni-tag-overflow">+${tagsForNoteItem.length - 2}</span>`
        : '';
      const starredClassForPanelRuntime = wasStarredForPanelRuntime ? ' starred' : '';
      const starredTextForPanelRuntime = wasStarredForPanelRuntime ? ic.starFilled12 : ic.starEmpty12;
      const starredTitleForPanelRuntime = wasStarredForPanelRuntime ? 'Unfavorite' : 'Favorite';
      const updatedLabelForPanelRuntime = formatNoteUpdatedLabelForPanelRuntime(noteDataForPanelRuntime);
      noteItemForPanelRuntime.innerHTML = `
        <div class="ni-header">
          <div class="ni-title">${escHtml(noteDataForPanelRuntime.title || 'Untitled')}</div>
          <div class="ni-meta">
            <button class="ni-btn${starredClassForPanelRuntime}" title="${starredTitleForPanelRuntime}" data-action="toggle-note-star">${starredTextForPanelRuntime}</button>
            <div class="ni-dropdown-wrap">
              <button class="ni-btn" title="More options" data-action="toggle-note-dropdown">···</button>
              <div class="ni-dropdown">
                <button class="ni-dd-item" data-action="edit-note" data-note-id="${escHtml(noteIdForPanelRuntime)}">
                  ${ic.noteEdit12}
                  Edit
                </button>
                <button class="ni-dd-item danger" data-action="delete-note" data-note-id="${escHtml(noteIdForPanelRuntime)}">
                  ${ic.trash12}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="ni-excerpt">${escHtml(getNoteExcerptForPanelRuntime(noteDataForPanelRuntime.body))}</div>
        <div class="ni-footer">
          <div class="ni-tags">
            ${primaryTagForPanelRuntime}
            ${secondaryTagForPanelRuntime}
            ${overflowCountForPanelRuntime}
          </div>
          <span class="ni-date">${escHtml(updatedLabelForPanelRuntime)}</span>
        </div>
      `;
      noteItemForPanelRuntime.classList.toggle('active', noteIdForPanelRuntime === S.activeNoteId);
    }

    function syncMainChatListItemForPanelRuntime(chatIdForSync, prependForSync, bypassWindowForSync) {
      const chatDataForSync = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForSync];
      const chatListForSync = root.querySelector('.chat-list');
      if (!chatDataForSync || !chatListForSync) return;

      let chatItemForSync = chatListForSync.querySelector(`.chat-item[data-chat-id="${chatIdForSync}"]`);
      const wasStarredForSync = Boolean(chatDataForSync.isPinned);

      if (!chatItemForSync) {
        if (!prependForSync && !bypassWindowForSync) {
          var posForWindowCheckForSync = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(chatIdForSync));
          if (posForWindowCheckForSync >= renderedChatCountForPanelRuntime) return;
        }
        chatItemForSync = document.createElement('div');
        chatItemForSync.className = 'chat-item';
        chatItemForSync.dataset.chatId = chatIdForSync;
        chatItemForSync.dataset.action = 'select-chat';
        if (chatDataForSync.type === 'quickq') {
          chatItemForSync.dataset.chatType = 'quickq';
          chatItemForSync.style.display = 'none';
        }
        if (prependForSync) {
          chatListForSync.prepend(chatItemForSync);
          renderedChatCountForPanelRuntime++;
        } else {
          chatListForSync.appendChild(chatItemForSync);
        }
      }
      if (chatDataForSync.type === 'quickq') {
        chatItemForSync.dataset.chatType = 'quickq';
        chatItemForSync.style.display = (S.chatType || 'chats') === 'quickq' ? '' : 'none';
      } else {
        delete chatItemForSync.dataset.chatType;
        chatItemForSync.style.display = (S.chatType || 'chats') === 'quickq' ? 'none' : '';
      }

      const starClassForSync = wasStarredForSync ? ' starred' : '';
      const starTitleForSync = wasStarredForSync ? 'Unfavorite' : 'Favorite';
      const starGlyphForSync = wasStarredForSync ? '&#9733;' : '&#9734;';
      const isStreamingForSync = sendingChatsForPanelRuntime.has(chatIdForSync);
      const needsChatItemShellForSync = !chatItemForSync.querySelector('.chat-item-body') ||
        !chatItemForSync.querySelector('.chat-item-title') ||
        !chatItemForSync.querySelector('.chat-item-excerpt') ||
        !chatItemForSync.querySelector('.chat-item-meta');
      if (needsChatItemShellForSync) {
        chatItemForSync.innerHTML = `
          <div class="chat-item-body">
            <div class="chat-item-title"></div>
            <div class="chat-item-excerpt"></div>
          </div>
          <div class="chat-item-meta">
            <button class="ci-btn" title="Favorite" data-action="toggle-chat-star">&#9734;</button>
            <div class="ci-dropdown-wrap">
              <button class="ci-btn" title="More" data-action="toggle-chat-dropdown">&#xB7;&#xB7;&#xB7;</button>
              <div class="ci-dropdown">
                <button class="ci-dd-item" data-action="rename-chat">
                  ${ic.noteEdit12}
                  Rename
                </button>
                <button class="ci-dd-item" data-action="view-raw-chat">
                  ${ic.code12}
                  View raw
                </button>
                <button class="ci-dd-item danger" data-action="delete-chat">
                  ${ic.trash12}
                  Delete
                </button>
              </div>
            </div>
          </div>
        `;
      }

      const titleElementForSync = chatItemForSync.querySelector('.chat-item-title');
      const excerptElementForSync = chatItemForSync.querySelector('.chat-item-excerpt');
      const starButtonForSync = chatItemForSync.querySelector('[data-action="toggle-chat-star"]');
      const nextTitleForSync = String(chatDataForSync.title || '');
      const nextSummaryForSync = String(chatDataForSync.summary || '');

      if (titleElementForSync && titleElementForSync.dataset.renderedTitle !== nextTitleForSync) {
        titleElementForSync.textContent = nextTitleForSync;
        titleElementForSync.dataset.renderedTitle = nextTitleForSync;
      }
      if (titleElementForSync) {
        let streamingDotForSync = titleElementForSync.querySelector('.ci-streaming-dot');
        if (isStreamingForSync && !streamingDotForSync) {
          streamingDotForSync = document.createElement('span');
          streamingDotForSync.className = 'ci-streaming-dot';
          streamingDotForSync.setAttribute('aria-hidden', 'true');
          titleElementForSync.appendChild(streamingDotForSync);
        } else if (!isStreamingForSync && streamingDotForSync) {
          streamingDotForSync.remove();
        }
      }
      if (excerptElementForSync && excerptElementForSync.dataset.renderedSummary !== nextSummaryForSync) {
        excerptElementForSync.textContent = nextSummaryForSync;
        excerptElementForSync.dataset.renderedSummary = nextSummaryForSync;
      }
      if (starButtonForSync) {
        starButtonForSync.className = 'ci-btn' + starClassForSync;
        starButtonForSync.title = starTitleForSync;
        starButtonForSync.innerHTML = starGlyphForSync;
      }
    }

    function removeMainNoteListItemForPanelRuntime(noteIdForPanelRuntime) {
      const noteItemForPanelRuntime = root.querySelector(`.note-item[data-note-id="${noteIdForPanelRuntime}"]`);
      if (noteItemForPanelRuntime) {
        noteItemForPanelRuntime.remove();
      }
    }

    function syncMainTaskListItemForPanelRuntime(taskIdForSync, prependForSync, bypassWindowForTask) {
      const taskDataForSync = TASK_STORE_FOR_PANEL_RUNTIME[taskIdForSync];
      const tasksListForSync = root.querySelector('.tasks-list');
      if (!taskDataForSync || !tasksListForSync) return;
      let taskItemForSync = tasksListForSync.querySelector(`.task-item[data-task-id="${taskIdForSync}"]`);
      if (!taskItemForSync) {
        if (!prependForSync && !bypassWindowForTask) {
          var posForTaskWindow = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(taskIdForSync));
          if (posForTaskWindow >= renderedTaskCountForPanelRuntime) return;
        }
        taskItemForSync = document.createElement('div');
        taskItemForSync.className = 'task-item';
        taskItemForSync.dataset.taskId = taskIdForSync;
        taskItemForSync.dataset.action = 'select-task';
        if (prependForSync) {
          tasksListForSync.prepend(taskItemForSync);
          renderedTaskCountForPanelRuntime++;
        } else {
          tasksListForSync.appendChild(taskItemForSync);
        }
      }
      const dueForSync = formatTaskDueForPanelRuntime(taskDataForSync.dueAt);
      const reminderForSync = formatTaskReminderForPanelRuntime(taskDataForSync.reminderAt, taskDataForSync.dueAt);
      const reminderHtmlForSync = reminderForSync ? ic.bell11 + ' ' + escHtml(reminderForSync) : '';
      taskItemForSync.dataset.completed = String(taskDataForSync.isCompleted);
      const cbClassForSync = taskDataForSync.isCompleted ? ' done' : '';
      const cbContentForSync = taskDataForSync.isCompleted ? '&#10003;' : '';
      const dueClassForSync = dueForSync.overdue ? ' overdue' : '';
      taskItemForSync.innerHTML = `
        <div class="task-cb${cbClassForSync}" data-action="toggle-task">${cbContentForSync}</div>
        <div class="task-body">
          <div class="task-title">${escHtml(taskDataForSync.title || '')}</div>
          <div class="task-meta">
            <span class="task-due${dueClassForSync}">Due: ${escHtml(dueForSync.text)}</span>
            <span class="task-reminder">${reminderHtmlForSync}</span>
          </div>
        </div>
      `;
      taskItemForSync.classList.toggle('task-done', taskDataForSync.isCompleted);
    }

    function removeMainTaskListItemForPanelRuntime(taskIdForPanelRuntime) {
      const taskItemForPanelRuntime = root.querySelector(`.task-item[data-task-id="${taskIdForPanelRuntime}"]`);
      if (taskItemForPanelRuntime) {
        taskItemForPanelRuntime.remove();
      }
    }

    function syncMainQuizListItemForPanelRuntime(qidForSync, prependForSync, bypassWindowForQuiz) {
      const quizDataForSync = QUIZ_STORE_FOR_PANEL_RUNTIME[qidForSync];
      const questionsListForSync = root.getElementById('questions-list');
      if (!quizDataForSync || !questionsListForSync) return;
      let questionItemForSync = questionsListForSync.querySelector(`.question-item[data-qid="${qidForSync}"]`);
      if (!questionItemForSync) {
        if (!prependForSync && !bypassWindowForQuiz) {
          var posForQuizWindow = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(qidForSync));
          if (posForQuizWindow >= renderedQuizCountForPanelRuntime) return;
        }
        questionItemForSync = document.createElement('div');
        questionItemForSync.className = 'question-item';
        questionItemForSync.dataset.qid = qidForSync;
        questionItemForSync.dataset.action = 'open-question-answer';
        if (prependForSync) {
          questionsListForSync.prepend(questionItemForSync);
          renderedQuizCountForPanelRuntime++;
        } else {
          questionsListForSync.appendChild(questionItemForSync);
        }
      }
      const statusForSync = getQuizStatusForPanelRuntime(quizDataForSync);
      questionItemForSync.dataset.status = statusForSync;
      const dueLabelForSync = formatQuizDueLabelForPanelRuntime(quizDataForSync);
      const typeBadgeClassForSync = quizDataForSync.type === 'mcq' ? 'qi-badge-mcq' : 'qi-badge-fitb';
      const typeLabelForSync = quizDataForSync.type === 'mcq' ? 'MCQ' : 'FITB';
      let statusBadgeForSync = '';
      if (statusForSync === 'due') {
        statusBadgeForSync = '<span class="qi-badge qi-badge-due">Due</span>';
      } else if (statusForSync === 'paused') {
        statusBadgeForSync = '<span class="qi-badge qi-badge-paused">Paused</span>';
      }
      const stageForSync = quizDataForSync.intervalStage || 0;
      let pipsForSync = '';
      for (let iPipForSync = 0; iPipForSync < 4; iPipForSync++) {
        pipsForSync += '<div class="qi-pip' + (iPipForSync < stageForSync ? ' filled' : '') + '"></div>';
      }
      const previewRawForSync = String(quizDataForSync.questionText || '');
      const previewTextForSync = previewRawForSync.length > 60 ? previewRawForSync.slice(0, 57) + '...' : previewRawForSync;
      const dueLabelClassForSync = dueLabelForSync.overdue ? ' overdue' : '';
      questionItemForSync.innerHTML = `
        <div class="qi-top">
          <div class="qi-title">${escHtml(quizDataForSync.title || '')}</div>
          <div class="qi-badges">
            <span class="qi-badge ${typeBadgeClassForSync}">${typeLabelForSync}</span>
            ${statusBadgeForSync}
          </div>
        </div>
        <div class="qi-preview">${escHtml(previewTextForSync)}</div>
        <div class="qi-footer">
          <div class="qi-stage"><div class="qi-stage-pips">${pipsForSync}</div></div>
          <span class="qi-due-label${dueLabelClassForSync}">${escHtml(dueLabelForSync.label)}</span>
          <div class="qi-actions">
            <button class="qi-btn" title="Edit" data-action="open-question-edit" data-question-id="${escHtml(qidForSync)}">
              ${ic.noteEdit11}
            </button>
            <button class="qi-btn danger" title="Delete" data-action="delete-question" data-question-id="${escHtml(qidForSync)}">
              ${ic.trash11}
            </button>
          </div>
        </div>
      `;
    }

    function removeMainQuizListItemForPanelRuntime(qidForPanelRuntime) {
      const questionItemForPanelRuntime = root.querySelector(`.question-item[data-qid="${qidForPanelRuntime}"]`);
      if (questionItemForPanelRuntime) {
        questionItemForPanelRuntime.remove();
      }
    }

    function createNextNoteIdForPanelRuntime() {
      const keysForNewId = Object.keys(NOTE_STORE_FOR_PANEL_RUNTIME).map(Number);
      return keysForNewId.length ? Math.max.apply(null, keysForNewId) + 1 : 1;
    }

    function hideNotePopoutHandoffForPanelRuntime() {
      const handoffBoxForPanelRuntime = root.getElementById('note-popout-handoff');
      if (handoffBoxForPanelRuntime) {
        handoffBoxForPanelRuntime.classList.add('hidden');
      }
      S.handoffNoteId = null;
    }

    function showNotePopoutHandoffForPanelRuntime(noteIdForPanelRuntime) {
      const handoffBoxForPanelRuntime = root.getElementById('note-popout-handoff');
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      const noteEmptyForPanelRuntime = root.getElementById('note-pane-empty');
      if (!handoffBoxForPanelRuntime || !noteFormForPanelRuntime || !noteEmptyForPanelRuntime) return;
      noteFormForPanelRuntime.classList.add('hidden');
      noteEmptyForPanelRuntime.classList.add('hidden');
      handoffBoxForPanelRuntime.classList.remove('hidden');
      S.handoffNoteId = noteIdForPanelRuntime;
      S.activeNoteId = noteIdForPanelRuntime;
      writePanelStateSyncForPanelRuntime({ activeNoteId: noteIdForPanelRuntime });
      setActiveNoteListItemForPanelRuntime(noteIdForPanelRuntime);
      S.inNoteView = true;
      setReducedPaneForPanelRuntime('notes', 'detail');
    }

    function focusNotePopoutForHandoffForPanelRuntime() {
      if (!S.handoffNoteId) return;
      const popoutForPanelRuntime = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[S.handoffNoteId];
      if (!popoutForPanelRuntime) return;
      bringNotePopoutToFrontForPanelRuntime(popoutForPanelRuntime);
    }

    function closeNotePopoutFromHandoffForPanelRuntime() {
      if (!S.handoffNoteId) return;
      if (!isNotePoppedOutForPanelRuntime(S.handoffNoteId)) {
        hideNotePopoutHandoffForPanelRuntime();
        if (S.activeNoteId && NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId]) {
          applyNoteDataToMainEditorForPanelRuntime(S.activeNoteId, false);
        } else {
          showNoteForm(false);
        }
        return;
      }
      closeNotePopoutForPanelRuntime(S.handoffNoteId);
    }

    // Show/hide Tags and Attachments sections based on edit mode and content.
    // In preview mode the sections are hidden when empty so orphaned labels don't appear.
    function syncNoteSectionsForPanelRuntime(tagsSectionForPanelRuntime, attachSectionForPanelRuntime, hasTags, hasAttachment, isEditMode) {
      if (tagsSectionForPanelRuntime) {
        tagsSectionForPanelRuntime.style.display = (isEditMode || hasTags) ? '' : 'none';
      }
      if (attachSectionForPanelRuntime) {
        attachSectionForPanelRuntime.style.display = (isEditMode || hasAttachment) ? '' : 'none';
      }
    }

    function getNoteDraftSyncSourceIdForPanelRuntime() {
      if (noteDraftSyncSourceIdForPanelRuntime) return noteDraftSyncSourceIdForPanelRuntime;
      try {
        noteDraftSyncSourceIdForPanelRuntime = sessionStorage.getItem('abchat_note_draft_sync_source_id') || '';
      } catch (errorForPanelRuntime) {
        noteDraftSyncSourceIdForPanelRuntime = '';
      }
      if (!noteDraftSyncSourceIdForPanelRuntime) {
        noteDraftSyncSourceIdForPanelRuntime = 'note_src_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        try {
          sessionStorage.setItem('abchat_note_draft_sync_source_id', noteDraftSyncSourceIdForPanelRuntime);
        } catch (errorForPanelRuntime) {}
      }
      return noteDraftSyncSourceIdForPanelRuntime;
    }

    function normalizeNoteDraftForPanelRuntime(noteDraftForPanelRuntime) {
      const draftForPanelRuntime = noteDraftForPanelRuntime || {};
      return {
        title: String(draftForPanelRuntime.title || ''),
        body: String(draftForPanelRuntime.body || ''),
        tags: normalizeTagsForPanelRuntime(draftForPanelRuntime.tags),
        attachments: Array.isArray(draftForPanelRuntime.attachments)
          ? draftForPanelRuntime.attachments.map(function (attachmentForPanelRuntime) {
              var refIdForAttachment = Number(attachmentForPanelRuntime && attachmentForPanelRuntime.refId);
              return {
                name: String((attachmentForPanelRuntime && attachmentForPanelRuntime.name) || ''),
                refId: Number.isFinite(refIdForAttachment) ? refIdForAttachment : null
              };
            }).filter(function (attachmentForPanelRuntime) { return attachmentForPanelRuntime.name; })
          : []
      };
    }

    function serializeNoteDraftForPanelRuntime(noteDraftForPanelRuntime) {
      return JSON.stringify(normalizeNoteDraftForPanelRuntime(noteDraftForPanelRuntime));
    }

    function setNoteBaseSnapshotForPanelRuntime(containerForPanelRuntime, noteDraftForPanelRuntime, baseUpdatedAtForPanelRuntime) {
      if (!containerForPanelRuntime || !containerForPanelRuntime.dataset) return;
      containerForPanelRuntime.dataset.noteBaseSnapshot = serializeNoteDraftForPanelRuntime(noteDraftForPanelRuntime);
      containerForPanelRuntime.dataset.noteBaseUpdatedAt = String(baseUpdatedAtForPanelRuntime || '');
      delete containerForPanelRuntime.dataset.noteConflict;
      delete containerForPanelRuntime.dataset.noteRemoteDraft;
    }

    function noteDraftHasLocalChangesForPanelRuntime(currentDraftForPanelRuntime, containerForPanelRuntime) {
      if (!containerForPanelRuntime || !containerForPanelRuntime.dataset) return false;
      const baseSnapshotForPanelRuntime = containerForPanelRuntime.dataset.noteBaseSnapshot || '';
      if (!baseSnapshotForPanelRuntime) return false;
      return serializeNoteDraftForPanelRuntime(currentDraftForPanelRuntime) !== baseSnapshotForPanelRuntime;
    }

    function clearNoteConflictNoticeForPanelRuntime(containerForPanelRuntime) {
      if (!containerForPanelRuntime) return;
      const existingForPanelRuntime = containerForPanelRuntime.querySelector('.note-sync-conflict-msg');
      if (existingForPanelRuntime) existingForPanelRuntime.remove();
      if (containerForPanelRuntime.dataset) delete containerForPanelRuntime.dataset.noteConflict;
    }

    function showNoteConflictNoticeForPanelRuntime(containerForPanelRuntime, messageForPanelRuntime) {
      if (!containerForPanelRuntime) return;
      if (containerForPanelRuntime.dataset) containerForPanelRuntime.dataset.noteConflict = '1';
      let noticeForPanelRuntime = containerForPanelRuntime.querySelector('.note-sync-conflict-msg');
      if (!noticeForPanelRuntime) {
        noticeForPanelRuntime = document.createElement('div');
        noticeForPanelRuntime.className = 'note-sync-conflict-msg';
        const footerForPanelRuntime = containerForPanelRuntime.querySelector('.ne-footer,.note-popout-footer');
        if (footerForPanelRuntime && footerForPanelRuntime.parentNode) {
          footerForPanelRuntime.parentNode.insertBefore(noticeForPanelRuntime, footerForPanelRuntime);
        } else {
          containerForPanelRuntime.appendChild(noticeForPanelRuntime);
        }
      }
      noticeForPanelRuntime.textContent = messageForPanelRuntime || 'This note changed in another tab. Review the latest version before saving.';
    }

    function isNoteConflictErrorForPanelRuntime(errorForPanelRuntime) {
      return Boolean(errorForPanelRuntime && String(errorForPanelRuntime.message || errorForPanelRuntime).indexOf('NOTE_CONFLICT') !== -1);
    }

    function renderNoteDraftIntoMainEditorForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime, keepEditModeForPanelRuntime, optionsForPanelRuntime) {
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      const noteTitleInputForPanelRuntime = root.getElementById('ne-title');
      const noteBodyInputForPanelRuntime = root.getElementById('ne-body');
      const noteTitleDisplayForPanelRuntime = root.getElementById('ne-title-display');
      const notePreviewForPanelRuntime = root.getElementById('ne-preview');
      const tagsWrapForPanelRuntime = root.getElementById('ne-tags-wrap');
      const tagsInputForPanelRuntime = root.getElementById('ne-tags-input');
      const attachmentsWrapForPanelRuntime = root.getElementById('ne-attachments');
      if (!noteFormForPanelRuntime || !noteTitleInputForPanelRuntime || !noteBodyInputForPanelRuntime || !noteTitleDisplayForPanelRuntime || !notePreviewForPanelRuntime || !tagsWrapForPanelRuntime || !tagsInputForPanelRuntime || !attachmentsWrapForPanelRuntime) {
        return false;
      }
      const normalizedDraftForPanelRuntime = normalizeNoteDraftForPanelRuntime(noteDraftForPanelRuntime);
      noteTitleInputForPanelRuntime.value = normalizedDraftForPanelRuntime.title;
      noteBodyInputForPanelRuntime.value = normalizedDraftForPanelRuntime.body;
      noteTitleDisplayForPanelRuntime.textContent = normalizedDraftForPanelRuntime.title || 'Untitled';
      noteTitleDisplayForPanelRuntime.classList.toggle('untitled', !normalizedDraftForPanelRuntime.title);
      notePreviewForPanelRuntime.innerHTML = renderNoteMarkdown(normalizedDraftForPanelRuntime.body);
      hydrateRenderedMarkdownForPanelRuntime(notePreviewForPanelRuntime);
      tagsWrapForPanelRuntime.querySelectorAll('.tag-pill').forEach(function (tagPillForPanelRuntime) {
        tagPillForPanelRuntime.remove();
      });
      normalizedDraftForPanelRuntime.tags.forEach(function (tagTextForPanelRuntime) {
        tagsWrapForPanelRuntime.insertBefore(createTagPillElementForPanelRuntime(tagTextForPanelRuntime), tagsInputForPanelRuntime);
      });
      attachmentsWrapForPanelRuntime.querySelectorAll('.ic').forEach(function (chipForPanelRuntime) {
        chipForPanelRuntime.remove();
      });
      normalizedDraftForPanelRuntime.attachments.forEach(function (attachForMain) {
        if (attachForMain) renderAttachmentChipForPanelRuntime(attachmentsWrapForPanelRuntime, attachForMain);
      });
      noteFormForPanelRuntime.classList.toggle('in-edit-mode', Boolean(keepEditModeForPanelRuntime));
      syncNoteSectionsForPanelRuntime(
        root.getElementById('ne-tags-section'),
        root.getElementById('ne-attachments-section'),
        normalizedDraftForPanelRuntime.tags.length > 0,
        normalizedDraftForPanelRuntime.attachments.length > 0,
        Boolean(keepEditModeForPanelRuntime)
      );
      if (!optsForPanelRuntime.keepConflictNotice) {
        clearNoteConflictNoticeForPanelRuntime(noteFormForPanelRuntime);
      }
      if (optsForPanelRuntime.updateBase !== false) {
        setNoteBaseSnapshotForPanelRuntime(noteFormForPanelRuntime, normalizedDraftForPanelRuntime, optsForPanelRuntime.baseUpdatedAt);
      }
      if (noteFormForPanelRuntime.dataset) {
        noteFormForPanelRuntime.dataset.noteRemoteDraft = optsForPanelRuntime.remoteDraft ? '1' : '';
      }
      showNoteForm(true);
      S.inNoteView = true;
      setReducedPaneForPanelRuntime('notes', 'detail');
      S.activeNoteId = noteIdForPanelRuntime;
      setActiveNoteListItemForPanelRuntime(noteIdForPanelRuntime);
      return true;
    }

    function applyNoteDataToMainEditorForPanelRuntime(noteIdForPanelRuntime, keepEditModeForPanelRuntime) {
      const noteDataForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (!noteDataForPanelRuntime) return;
      hideNotePopoutHandoffForPanelRuntime();
      const deleteEditBtnForApply = root.getElementById('ne-delete-btn-edit');
      if (deleteEditBtnForApply) deleteEditBtnForApply.style.display = '';
      if (!renderNoteDraftIntoMainEditorForPanelRuntime(noteIdForPanelRuntime, noteDataForPanelRuntime, keepEditModeForPanelRuntime, {
        baseUpdatedAt: noteDataForPanelRuntime.updatedAt
      })) return;
      writePanelStateSyncForPanelRuntime({ activeNoteId: noteIdForPanelRuntime });
    }

    // In-memory mirror of popout positions for the cross-tab sync. Keyed by
    // noteId. sessionStorage holds the same data per-tab for popout open
    // bootstrap; this map exists so each write can emit the FULL object to
    // chrome.storage.local without having to enumerate sessionStorage.
    const popoutPositionsMapForPanelRuntime = {};
    function saveNotePopoutPositionForPanelRuntime(noteIdForPanelRuntime, leftForPanelRuntime, topForPanelRuntime) {
      if (!noteIdForPanelRuntime) return;
      if (typeof sessionStorage !== 'undefined') {
        try {
          sessionStorage.setItem(
            NOTE_POPOUT_POSITION_KEY_PREFIX_FOR_PANEL_RUNTIME + noteIdForPanelRuntime,
            JSON.stringify({ left: leftForPanelRuntime, top: topForPanelRuntime })
          );
        } catch (errorForPanelRuntime) {
          // Ignore storage issues in private browsing or blocked storage contexts.
        }
      }
      popoutPositionsMapForPanelRuntime[noteIdForPanelRuntime] = {
        left: leftForPanelRuntime,
        top: topForPanelRuntime
      };
      writePanelStateSyncForPanelRuntime({
        popoutPositions: Object.assign({}, popoutPositionsMapForPanelRuntime)
      });
    }

    function getSavedNotePopoutPositionForPanelRuntime(noteIdForPanelRuntime) {
      if (!noteIdForPanelRuntime || typeof sessionStorage === 'undefined') return null;
      try {
        const rawValueForPanelRuntime = sessionStorage.getItem(
          NOTE_POPOUT_POSITION_KEY_PREFIX_FOR_PANEL_RUNTIME + noteIdForPanelRuntime
        );
        if (!rawValueForPanelRuntime) return null;
        const parsedValueForPanelRuntime = JSON.parse(rawValueForPanelRuntime);
        if (
          !parsedValueForPanelRuntime ||
          !Number.isFinite(parsedValueForPanelRuntime.left) ||
          !Number.isFinite(parsedValueForPanelRuntime.top)
        ) {
          return null;
        }
        return parsedValueForPanelRuntime;
      } catch (errorForPanelRuntime) {
        return null;
      }
    }

    function clampFloatingPositionForPanelRuntime(leftForPanelRuntime, topForPanelRuntime, widthForPanelRuntime, heightForPanelRuntime) {
      const maxLeftForPanelRuntime = Math.max(8, window.innerWidth - widthForPanelRuntime - 8);
      const maxTopForPanelRuntime = Math.max(8, window.innerHeight - heightForPanelRuntime - 8);
      return {
        left: Math.max(8, Math.min(maxLeftForPanelRuntime, leftForPanelRuntime)),
        top: Math.max(8, Math.min(maxTopForPanelRuntime, topForPanelRuntime))
      };
    }

    function bringNotePopoutToFrontForPanelRuntime(popoutForPanelRuntime) {
      if (!popoutForPanelRuntime || !popoutForPanelRuntime.style) return;
      notePopoutZIndexForPanelRuntime += 1;
      popoutForPanelRuntime.style.zIndex = String(notePopoutZIndexForPanelRuntime);
    }

    function updateNotePopoutPreviewForPanelRuntime(popoutForPanelRuntime) {
      if (!popoutForPanelRuntime) return;
      const bodyInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-body-input');
      const previewForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-preview');
      if (!bodyInputForPanelRuntime || !previewForPanelRuntime) return;
      previewForPanelRuntime.innerHTML = renderNoteMarkdown(bodyInputForPanelRuntime.value || '');
      hydrateRenderedMarkdownForPanelRuntime(previewForPanelRuntime);
    }

    function applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, noteDataForPanelRuntime) {
      if (!popoutForPanelRuntime || !noteDataForPanelRuntime) return;
      const titleInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-title-input');
      const titleDisplayForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-title-display');
      const bodyInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-body-input');
      const tagsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-wrap');
      const tagsInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-input');
      const attachmentsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments');
      const headerTitleForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-header-title');
      if (!titleInputForPanelRuntime || !titleDisplayForPanelRuntime || !bodyInputForPanelRuntime || !tagsWrapForPanelRuntime || !tagsInputForPanelRuntime || !attachmentsWrapForPanelRuntime || !headerTitleForPanelRuntime) {
        return;
      }
      titleInputForPanelRuntime.value = noteDataForPanelRuntime.title || '';
      bodyInputForPanelRuntime.value = noteDataForPanelRuntime.body || '';
      bodyInputForPanelRuntime.style.height = '';
      headerTitleForPanelRuntime.textContent = noteDataForPanelRuntime.title || 'Untitled';
      titleDisplayForPanelRuntime.textContent = noteDataForPanelRuntime.title || 'Untitled';
      titleDisplayForPanelRuntime.classList.toggle('untitled', !noteDataForPanelRuntime.title);
      tagsWrapForPanelRuntime.querySelectorAll('.tag-pill').forEach(function (tagPillForPanelRuntime) {
        tagPillForPanelRuntime.remove();
      });
      normalizeTagsForPanelRuntime(noteDataForPanelRuntime.tags).forEach(function (tagTextForPanelRuntime) {
        tagsWrapForPanelRuntime.insertBefore(createTagPillElementForPanelRuntime(tagTextForPanelRuntime), tagsInputForPanelRuntime);
      });
      attachmentsWrapForPanelRuntime.querySelectorAll('.ic').forEach(function (chipForPanelRuntime) {
        chipForPanelRuntime.remove();
      });
      const attachmentsForPopout = Array.isArray(noteDataForPanelRuntime.attachments) ? noteDataForPanelRuntime.attachments : [];
      attachmentsForPopout.forEach(function (attachForPopout) {
        if (attachForPopout) renderAttachmentChipForPopoutForPanelRuntime(popoutForPanelRuntime, attachmentsWrapForPanelRuntime, attachForPopout);
      });
      updateNotePopoutPreviewForPanelRuntime(popoutForPanelRuntime);
      clearNoteConflictNoticeForPanelRuntime(popoutForPanelRuntime);
      setNoteBaseSnapshotForPanelRuntime(popoutForPanelRuntime, noteDataForPanelRuntime, noteDataForPanelRuntime.updatedAt);
    }

    function collectNoteDataFromPopoutForPanelRuntime(popoutForPanelRuntime) {
      if (!popoutForPanelRuntime) return null;
      const titleInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-title-input');
      const bodyInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-body-input');
      const tagsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-wrap');
      const attachmentsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments');
      if (!titleInputForPanelRuntime || !bodyInputForPanelRuntime || !tagsWrapForPanelRuntime || !attachmentsWrapForPanelRuntime) return null;
      const attachmentChipsForPopout = Array.from(attachmentsWrapForPanelRuntime.querySelectorAll('.note-popout-attach-chip'));
      return {
        title: titleInputForPanelRuntime.value || '',
        body: bodyInputForPanelRuntime.value || '',
        tags: extractTagsFromWrapForPanelRuntime(tagsWrapForPanelRuntime),
        attachments: attachmentChipsForPopout
          .filter(function (chipForPopoutDraft) { return chipForPopoutDraft.dataset.attachName; })
          .map(function (chipForPopoutDraft) {
            var refIdForPopoutDraft = Number(chipForPopoutDraft.dataset.attachRefId);
            return { name: chipForPopoutDraft.dataset.attachName || '', refId: Number.isFinite(refIdForPopoutDraft) ? refIdForPopoutDraft : null };
          })
      };
    }

    function getNoteDraftSyncStorageKeyForPanelRuntime(noteIdForPanelRuntime) {
      return NOTE_DRAFT_SYNC_KEY_PREFIX_FOR_PANEL_RUNTIME + String(Number(noteIdForPanelRuntime));
    }

    function getNoteIdFromDraftSyncStorageKeyForPanelRuntime(keyForPanelRuntime) {
      if (typeof keyForPanelRuntime !== 'string') return null;
      if (keyForPanelRuntime.indexOf(NOTE_DRAFT_SYNC_KEY_PREFIX_FOR_PANEL_RUNTIME) !== 0) return null;
      const noteIdForPanelRuntime = Number(keyForPanelRuntime.slice(NOTE_DRAFT_SYNC_KEY_PREFIX_FOR_PANEL_RUNTIME.length));
      return Number.isFinite(noteIdForPanelRuntime) ? noteIdForPanelRuntime : null;
    }

    function buildNoteDraftSyncPayloadForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime, baseUpdatedAtForPanelRuntime) {
      return Object.assign({}, normalizeNoteDraftForPanelRuntime(noteDraftForPanelRuntime), {
        noteId: Number(noteIdForPanelRuntime),
        baseUpdatedAt: String(baseUpdatedAtForPanelRuntime || ''),
        sourceId: getNoteDraftSyncSourceIdForPanelRuntime(),
        updatedAt: Date.now()
      });
    }

    function writeNoteDraftSyncPayloadForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime, baseUpdatedAtForPanelRuntime) {
      if (!Number.isFinite(Number(noteIdForPanelRuntime))) return;
      if (noteDraftApplyingForPanelRuntime) return;
      try {
        const dataForNoteDraftSync = {};
        dataForNoteDraftSync[getNoteDraftSyncStorageKeyForPanelRuntime(noteIdForPanelRuntime)] = buildNoteDraftSyncPayloadForPanelRuntime(
          noteIdForPanelRuntime,
          noteDraftForPanelRuntime,
          baseUpdatedAtForPanelRuntime
        );
        chrome.storage.local.set(dataForNoteDraftSync);
      } catch (errorForPanelRuntime) {}
    }

    function scheduleNoteDraftSyncForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime, baseUpdatedAtForPanelRuntime, timerKeyForPanelRuntime) {
      if (!Number.isFinite(Number(noteIdForPanelRuntime))) return;
      const resolvedTimerKeyForPanelRuntime = String(timerKeyForPanelRuntime || noteIdForPanelRuntime);
      if (noteDraftSyncTimersForPanelRuntime[resolvedTimerKeyForPanelRuntime]) {
        clearTimeout(noteDraftSyncTimersForPanelRuntime[resolvedTimerKeyForPanelRuntime]);
      }
      noteDraftSyncTimersForPanelRuntime[resolvedTimerKeyForPanelRuntime] = setTimeout(function () {
        delete noteDraftSyncTimersForPanelRuntime[resolvedTimerKeyForPanelRuntime];
        writeNoteDraftSyncPayloadForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime, baseUpdatedAtForPanelRuntime);
      }, 200);
    }

    function scheduleMainNoteDraftSyncForPanelRuntime() {
      const noteIdForPanelRuntime = Number(S.activeNoteId);
      if (!Number.isFinite(noteIdForPanelRuntime)) return;
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      if (!noteFormForPanelRuntime || !noteFormForPanelRuntime.classList.contains('in-edit-mode')) return;
      const noteDraftForPanelRuntime = collectMainNoteDraftForPanelRuntime();
      if (!noteDraftForPanelRuntime) return;
      scheduleNoteDraftSyncForPanelRuntime(
        noteIdForPanelRuntime,
        noteDraftForPanelRuntime,
        noteFormForPanelRuntime.dataset.noteBaseUpdatedAt || '',
        'main:' + noteIdForPanelRuntime
      );
    }

    function schedulePopoutNoteDraftSyncForPanelRuntime(popoutForPanelRuntime) {
      if (!popoutForPanelRuntime || !popoutForPanelRuntime.classList.contains('in-edit-mode')) return;
      const noteIdForPanelRuntime = Number(popoutForPanelRuntime.dataset.noteId);
      if (!Number.isFinite(noteIdForPanelRuntime)) return;
      const noteDraftForPanelRuntime = collectNoteDataFromPopoutForPanelRuntime(popoutForPanelRuntime);
      if (!noteDraftForPanelRuntime) return;
      scheduleNoteDraftSyncForPanelRuntime(
        noteIdForPanelRuntime,
        noteDraftForPanelRuntime,
        popoutForPanelRuntime.dataset.noteBaseUpdatedAt || '',
        'popout:' + noteIdForPanelRuntime
      );
    }

    function notifyNoteDraftChangedForElementForPanelRuntime(elementForPanelRuntime) {
      if (noteDraftApplyingForPanelRuntime) return;
      const popoutForPanelRuntime = elementForPanelRuntime && elementForPanelRuntime.closest
        ? elementForPanelRuntime.closest('.note-popout')
        : null;
      if (popoutForPanelRuntime) {
        schedulePopoutNoteDraftSyncForPanelRuntime(popoutForPanelRuntime);
        return;
      }
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      if (noteFormForPanelRuntime && elementForPanelRuntime && noteFormForPanelRuntime.contains(elementForPanelRuntime)) {
        scheduleMainNoteDraftSyncForPanelRuntime();
      }
    }

    function renderNoteDraftIntoPopoutForPanelRuntime(popoutForPanelRuntime, noteDraftForPanelRuntime, keepEditModeForPanelRuntime, optionsForPanelRuntime) {
      if (!popoutForPanelRuntime || !noteDraftForPanelRuntime) return;
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      noteDraftApplyingForPanelRuntime = true;
      try {
        applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, noteDraftForPanelRuntime);
        popoutForPanelRuntime.classList.toggle('in-edit-mode', Boolean(keepEditModeForPanelRuntime));
        if (optsForPanelRuntime.updateBase !== false) {
          setNoteBaseSnapshotForPanelRuntime(popoutForPanelRuntime, noteDraftForPanelRuntime, optsForPanelRuntime.baseUpdatedAt);
        }
        if (popoutForPanelRuntime.dataset) {
          popoutForPanelRuntime.dataset.noteRemoteDraft = optsForPanelRuntime.remoteDraft ? '1' : '';
        }
      } finally {
        noteDraftApplyingForPanelRuntime = false;
      }
    }

    function handleIncomingNoteDraftSyncForPanelRuntime(payloadForPanelRuntime) {
      if (!payloadForPanelRuntime || payloadForPanelRuntime.sourceId === getNoteDraftSyncSourceIdForPanelRuntime()) return;
      const noteIdForPanelRuntime = Number(payloadForPanelRuntime.noteId);
      if (!Number.isFinite(noteIdForPanelRuntime)) return;
      const incomingDraftForPanelRuntime = normalizeNoteDraftForPanelRuntime(payloadForPanelRuntime);

      const mainFormForPanelRuntime = root.getElementById('note-editor-form');
      if (S.activeNoteId === noteIdForPanelRuntime && mainFormForPanelRuntime && !mainFormForPanelRuntime.classList.contains('hidden')) {
        const mainIsEditingForPanelRuntime = mainFormForPanelRuntime.classList.contains('in-edit-mode');
        const mainDraftForPanelRuntime = collectMainNoteDraftForPanelRuntime();
        if (mainIsEditingForPanelRuntime && noteDraftHasLocalChangesForPanelRuntime(mainDraftForPanelRuntime, mainFormForPanelRuntime)) {
          showNoteConflictNoticeForPanelRuntime(mainFormForPanelRuntime, 'This note is being edited in another tab. Your local draft was kept; save may require resolving the newer version.');
        } else {
          noteDraftApplyingForPanelRuntime = true;
          try {
            renderNoteDraftIntoMainEditorForPanelRuntime(noteIdForPanelRuntime, incomingDraftForPanelRuntime, mainIsEditingForPanelRuntime, {
              baseUpdatedAt: payloadForPanelRuntime.baseUpdatedAt || (NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] || {}).updatedAt || '',
              remoteDraft: true
            });
          } finally {
            noteDraftApplyingForPanelRuntime = false;
          }
        }
      }

      const popoutForPanelRuntime = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (popoutForPanelRuntime) {
        const popoutIsEditingForPanelRuntime = popoutForPanelRuntime.classList.contains('in-edit-mode');
        const popoutDraftForPanelRuntime = collectNoteDataFromPopoutForPanelRuntime(popoutForPanelRuntime);
        if (popoutIsEditingForPanelRuntime && noteDraftHasLocalChangesForPanelRuntime(popoutDraftForPanelRuntime, popoutForPanelRuntime)) {
          showNoteConflictNoticeForPanelRuntime(popoutForPanelRuntime, 'This note is being edited in another tab. Your local draft was kept; save may require resolving the newer version.');
        } else {
          renderNoteDraftIntoPopoutForPanelRuntime(popoutForPanelRuntime, incomingDraftForPanelRuntime, popoutIsEditingForPanelRuntime, {
            baseUpdatedAt: payloadForPanelRuntime.baseUpdatedAt || (NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] || {}).updatedAt || '',
            remoteDraft: true
          });
        }
      }
    }

    function bindNoteDraftStorageSyncForPanelRuntime() {
      try {
        if (noteDraftStorageSyncListenerForPanelRuntime) {
          chrome.storage.onChanged.removeListener(noteDraftStorageSyncListenerForPanelRuntime);
          noteDraftStorageSyncListenerForPanelRuntime = null;
        }
        var capturedGenForNoteDraftSync = window.abchatListenerGeneration || 0;
        noteDraftStorageSyncListenerForPanelRuntime = function noteDraftStorageSyncHandlerForPanelRuntime(changesForPanelRuntime, areaForPanelRuntime) {
          if ((window.abchatListenerGeneration || 0) !== capturedGenForNoteDraftSync) {
            chrome.storage.onChanged.removeListener(noteDraftStorageSyncListenerForPanelRuntime);
            noteDraftStorageSyncListenerForPanelRuntime = null;
            return;
          }
          if (areaForPanelRuntime !== 'local') return;
          Object.keys(changesForPanelRuntime).forEach(function (keyForPanelRuntime) {
            const noteIdForPanelRuntime = getNoteIdFromDraftSyncStorageKeyForPanelRuntime(keyForPanelRuntime);
            if (!Number.isFinite(noteIdForPanelRuntime)) return;
            const incomingForPanelRuntime = changesForPanelRuntime[keyForPanelRuntime].newValue;
            handleIncomingNoteDraftSyncForPanelRuntime(incomingForPanelRuntime);
          });
        };
        chrome.storage.onChanged.addListener(noteDraftStorageSyncListenerForPanelRuntime);
      } catch (errorForPanelRuntime) {}
    }

    function closeNotePopoutForPanelRuntime(noteIdForPanelRuntime) {
      const popoutForPanelRuntime = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (!popoutForPanelRuntime) return;
      delete NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (popoutForPanelRuntime.remove) popoutForPanelRuntime.remove();
      if (S.handoffNoteId === noteIdForPanelRuntime) {
        hideNotePopoutHandoffForPanelRuntime();
        if (S.activeNoteId === noteIdForPanelRuntime && NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime]) {
          applyNoteDataToMainEditorForPanelRuntime(noteIdForPanelRuntime, false);
        } else {
          showNoteForm(false);
        }
      }
      writePanelStateSyncForPanelRuntime({ popoutNoteIds: Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).map(Number) });
    }

    function closeAllNotePopoutsForPanelRuntime() {
      Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).forEach(function (noteIdForPanelRuntime) {
        closeNotePopoutForPanelRuntime(noteIdForPanelRuntime);
      });
    }

    function syncNotePopoutsForNoteForPanelRuntime(noteIdForPanelRuntime, skippedPopoutForPanelRuntime) {
      const popoutForPanelRuntime = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (!popoutForPanelRuntime || popoutForPanelRuntime === skippedPopoutForPanelRuntime) return;
      const noteDataForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (!noteDataForPanelRuntime) {
        closeNotePopoutForPanelRuntime(noteIdForPanelRuntime);
        return;
      }
      applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, noteDataForPanelRuntime);
    }

    async function deleteNoteByIdForPanelRuntime(noteIdForPanelRuntime) {
      if (!noteIdForPanelRuntime || !NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime]) return;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.deleteNote === 'function') {
        try {
          await panelDataRepoForPanelRuntime.deleteNote(noteIdForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      }
      delete NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      const orderIndexForPanelRuntime = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(noteIdForPanelRuntime);
      if (orderIndexForPanelRuntime >= 0) NOTE_ORDER_FOR_PANEL_RUNTIME.splice(orderIndexForPanelRuntime, 1);
      syncSearchIndexForPanelRuntime('notes', 'remove', noteIdForPanelRuntime);
      closeNotePopoutForPanelRuntime(noteIdForPanelRuntime);
      removeMainNoteListItemForPanelRuntime(noteIdForPanelRuntime);
      if (S.handoffNoteId === noteIdForPanelRuntime) {
        hideNotePopoutHandoffForPanelRuntime();
      }
      if (S.activeNoteId === noteIdForPanelRuntime) {
        S.activeNoteId = null;
        writePanelStateSyncForPanelRuntime({ activeNoteId: null });
        showNoteForm(false);
        S.inNoteView = false;
        setReducedPaneForPanelRuntime('notes', 'list');
      }
    }

    async function autoGenerateNoteTitleForPanelRuntime(noteIdForAutoTitle, bodyTextForAutoTitle) {
      const numericNoteIdForAutoTitle = Number(noteIdForAutoTitle);
      if (!Number.isFinite(numericNoteIdForAutoTitle) || !bodyTextForAutoTitle) return;
      const noteForAutoTitle = NOTE_STORE_FOR_PANEL_RUNTIME[numericNoteIdForAutoTitle];
      if (!noteForAutoTitle || noteForAutoTitle.title) return;
      const apiKeyForAutoTitle = await getApiKeyForPanelRuntime();
      if (!apiKeyForAutoTitle) return;
      const agentNsForAutoTitle = globalThis.ABChatAgent || {};
      const clientForAutoTitle = agentNsForAutoTitle.client || {};
      if (typeof clientForAutoTitle.generateTitle !== 'function') return;
      let titleResultForNoteTitle;
      const titleLogStartForNoteTitle = Date.now();
      let titleLogStatusForNoteTitle = 'success';
      try {
        titleResultForNoteTitle = await clientForAutoTitle.generateTitle({
          apiKey: apiKeyForAutoTitle,
          userMessage: bodyTextForAutoTitle,
          fallbackModel: DEFAULT_MODEL_FOR_PANEL_RUNTIME
        });
        if (!titleResultForNoteTitle || !titleResultForNoteTitle.title) titleLogStatusForNoteTitle = 'error';
      } catch (e) {
        titleLogStatusForNoteTitle = 'error';
        titleResultForNoteTitle = { title: null, model: null, error: 'exception', status: null, body: String((e && e.message) || e || '').slice(0, 500) };
      } finally {
        const titleApiLoggerForNote = (globalThis.ABChatContent || {}).apiLogger;
        if (titleApiLoggerForNote && typeof titleApiLoggerForNote.writeLog === 'function') {
          var titleResponseContentForNoteLog;
          if (titleResultForNoteTitle && titleResultForNoteTitle.title) {
            titleResponseContentForNoteLog = titleResultForNoteTitle.title;
          } else if (titleResultForNoteTitle && titleResultForNoteTitle.error) {
            titleResponseContentForNoteLog = '[' + titleResultForNoteTitle.error + ']'
              + (titleResultForNoteTitle.status != null ? ' status=' + titleResultForNoteTitle.status : '')
              + (titleResultForNoteTitle.body ? ' body=' + titleResultForNoteTitle.body : '');
          } else {
            titleResponseContentForNoteLog = null;
          }
          titleApiLoggerForNote.writeLog({
            requestType: 'title',
            timestamp: new Date(titleLogStartForNoteTitle).toISOString(),
            model: (titleResultForNoteTitle && titleResultForNoteTitle.model) || null,
            iterationCount: 1,
            totalLatencyMs: Date.now() - titleLogStartForNoteTitle,
            status: titleLogStatusForNoteTitle,
            responseContent: titleResponseContentForNoteLog
          }).catch(function () {});
        }
      }
      if (!titleResultForNoteTitle || !titleResultForNoteTitle.title) return;
      const generatedTitleForAutoTitle = titleResultForNoteTitle.title;
      const noteAfterFetchForAutoTitle = NOTE_STORE_FOR_PANEL_RUNTIME[numericNoteIdForAutoTitle];
      if (!noteAfterFetchForAutoTitle || noteAfterFetchForAutoTitle.title) return;
      noteAfterFetchForAutoTitle.title = generatedTitleForAutoTitle;
      noteAfterFetchForAutoTitle.updatedAt = new Date().toISOString();
      const panelDataRepoForAutoTitle = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForAutoTitle && typeof panelDataRepoForAutoTitle.updateNote === 'function') {
        try {
          await panelDataRepoForAutoTitle.updateNote(numericNoteIdForAutoTitle, { title: generatedTitleForAutoTitle });
        } catch (e) {}
      }
      syncMainNoteListItemForPanelRuntime(numericNoteIdForAutoTitle);
      if (S.activeNoteId === numericNoteIdForAutoTitle) {
        applyNoteDataToMainEditorForPanelRuntime(numericNoteIdForAutoTitle, false);
      }
    }

    async function saveMainNoteForPanelRuntime(keepEditModeForPanelRuntime) {
      const noteDraftForPanelRuntime = collectMainNoteDraftForPanelRuntime();
      if (!noteDraftForPanelRuntime) return null;
      let noteIdForPanelRuntime = S.activeNoteId;
      let isNewNoteForPanelRuntime = !noteIdForPanelRuntime || !NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      let persistedNoteForPanelRuntime = null;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();

      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createNote === 'function') {
        try {
          if (isNewNoteForPanelRuntime) {
            persistedNoteForPanelRuntime = await panelDataRepoForPanelRuntime.createNote({
              title: noteDraftForPanelRuntime.title,
              body: noteDraftForPanelRuntime.body,
              tags: noteDraftForPanelRuntime.tags,
              attachments: noteDraftForPanelRuntime.attachments,
              noteType: 'user',
              sourceChatId: null
            });
          } else {
            const noteFormForSave = root.getElementById('note-editor-form');
            persistedNoteForPanelRuntime = await panelDataRepoForPanelRuntime.updateNote(noteIdForPanelRuntime, {
              title: noteDraftForPanelRuntime.title,
              body: noteDraftForPanelRuntime.body,
              tags: noteDraftForPanelRuntime.tags,
              attachments: noteDraftForPanelRuntime.attachments
            }, {
              baseUpdatedAt: noteFormForSave && noteFormForSave.dataset ? noteFormForSave.dataset.noteBaseUpdatedAt : ''
            });
          }
          if (persistedNoteForPanelRuntime && persistedNoteForPanelRuntime.id != null) {
            noteIdForPanelRuntime = Number(persistedNoteForPanelRuntime.id);
          }
        } catch (errorForPanelRuntime) {
          if (isNoteConflictErrorForPanelRuntime(errorForPanelRuntime)) {
            const noteFormForConflict = root.getElementById('note-editor-form');
            showNoteConflictNoticeForPanelRuntime(noteFormForConflict, 'Save blocked because this note changed in another tab. Your local draft is still here; reload latest or copy your changes before saving again.');
            const repoForConflict = getPanelDataRepoForPanelRuntime();
            if (repoForConflict && typeof repoForConflict.getNote === 'function') {
              repoForConflict.getNote(noteIdForPanelRuntime).then(function (freshNoteForConflict) {
                if (freshNoteForConflict && freshNoteForConflict.id != null) {
                  NOTE_STORE_FOR_PANEL_RUNTIME[Number(freshNoteForConflict.id)] = cloneNoteRecordForPanelRuntime(freshNoteForConflict);
                  syncMainNoteListItemForPanelRuntime(Number(freshNoteForConflict.id), false);
                }
              }).catch(function () {});
            }
          }
          return null;
        }
      } else if (isNewNoteForPanelRuntime) {
        noteIdForPanelRuntime = createNextNoteIdForPanelRuntime();
      }

      if (!persistedNoteForPanelRuntime) {
        const existingForPanelRuntime = !isNewNoteForPanelRuntime ? NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] : null;
        const nowIsoForPanelRuntime = new Date().toISOString();
        persistedNoteForPanelRuntime = Object.assign({}, noteDraftForPanelRuntime, {
          createdAt: existingForPanelRuntime && existingForPanelRuntime.createdAt
            ? existingForPanelRuntime.createdAt
            : nowIsoForPanelRuntime,
          updatedAt: nowIsoForPanelRuntime
        });
      }

      const savedNoteForPanelRuntime = cloneNoteRecordForPanelRuntime(persistedNoteForPanelRuntime || noteDraftForPanelRuntime);
      NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] = savedNoteForPanelRuntime;
      if (NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(noteIdForPanelRuntime) === -1) {
        NOTE_ORDER_FOR_PANEL_RUNTIME.push(noteIdForPanelRuntime);
      }
      syncSearchIndexForPanelRuntime('notes', isNewNoteForPanelRuntime ? 'add' : 'update', noteIdForPanelRuntime, savedNoteForPanelRuntime);
      S.activeNoteId = noteIdForPanelRuntime;
      writePanelStateSyncForPanelRuntime({ activeNoteId: noteIdForPanelRuntime });
      syncMainNoteListItemForPanelRuntime(noteIdForPanelRuntime);
      refreshNoteOrderForPanelRuntime();
      applyNoteDataToMainEditorForPanelRuntime(noteIdForPanelRuntime, keepEditModeForPanelRuntime);
      syncNotePopoutsForNoteForPanelRuntime(noteIdForPanelRuntime);
      if (isNewNoteForPanelRuntime && !noteDraftForPanelRuntime.title && noteDraftForPanelRuntime.body) {
        autoGenerateNoteTitleForPanelRuntime(noteIdForPanelRuntime, noteDraftForPanelRuntime.body);
      }
      return noteIdForPanelRuntime;
    }


    function openNotePopoutForPanelRuntime(noteIdForPanelRuntime) {
      const noteDataForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (!noteDataForPanelRuntime) return;
      const existingPopoutForPanelRuntime = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime];
      if (existingPopoutForPanelRuntime) {
        bringNotePopoutToFrontForPanelRuntime(existingPopoutForPanelRuntime);
        return;
      }
      const popoutForPanelRuntime = document.createElement('div');
      popoutForPanelRuntime.className = 'note-popout';
      popoutForPanelRuntime.dataset.noteId = noteIdForPanelRuntime;
      popoutForPanelRuntime.innerHTML = `
        <div class="note-popout-header">
          <div class="note-popout-header-title"></div>
          <button class="btn-icon note-popout-edit-btn" type="button" title="Edit note">
            ${ic.noteEdit13}
          </button>
          <button class="ctrl-btn note-popout-close-btn" type="button" title="Close">${ic.x13}</button>
        </div>
        <div class="note-popout-body">
          <div class="note-popout-title-display untitled"></div>
          <input class="note-popout-title-input" type="text" placeholder="Note title...">
          <div class="ne-body-ta-wrap note-popout-body-ta-wrap">
            <textarea class="note-popout-body-input" rows="8" placeholder="Write your note..." data-no-auto-expand="1"></textarea>
          </div>
          <div class="note-popout-tags-section">
            <div class="field-label">Tags</div>
            <div class="tags-wrap note-popout-tags-wrap">
              <input class="tags-input note-popout-tags-input" type="text" placeholder="Add tag...">
            </div>
          </div>
          <div class="note-popout-attachments-section">
            <div class="field-label">Attachments</div>
            <div class="ne-attach-row note-popout-attachments">
              <button class="btn-ghost btn-sm note-popout-attach-add" data-action="add-note-popout-attachment">+ Add</button>
            </div>
            <input type="file" class="note-popout-attach-file-input" data-action="note-popout-attach-file-input-change" style="display:none" accept=".txt,.md,.markdown,.json,.csv,.pdf,.docx,.xlsx,.xls,.ods,.pptx,text/*,image/png,image/jpeg,image/webp,image/gif" multiple>
          </div>
          <div class="note-popout-preview-group">
            <div class="field-label">Preview</div>
            <div class="ne-preview note-popout-preview"></div>
          </div>
        </div>
        <div class="note-popout-footer">
          <div class="note-popout-btnrow note-popout-preview-btns" style="width:100%">
            <button class="btn-danger note-popout-delete-btn" type="button">Delete</button>
          </div>
          <div class="note-popout-btnrow note-popout-edit-btns" style="width:100%">
            <button class="btn-primary note-popout-save-btn" type="button">Save</button>
            <button class="btn-ghost note-popout-cancel-btn" type="button">Cancel</button>
            <button class="btn-danger note-popout-delete-btn-edit" type="button">Delete</button>
          </div>
        </div>
      `;
      host.appendChild(popoutForPanelRuntime);
      NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] = popoutForPanelRuntime;
      writePanelStateSyncForPanelRuntime({ popoutNoteIds: Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).map(Number) });
      bringNotePopoutToFrontForPanelRuntime(popoutForPanelRuntime);
      applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, noteDataForPanelRuntime);
      popoutForPanelRuntime.classList.remove('in-edit-mode');
      // Sync section visibility for initial preview state
      const initTagsSectionForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-section');
      const initAttachSectionForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments-section');
      const initTagsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-wrap');
      const initAttachWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments');
      syncNoteSectionsForPanelRuntime(
        initTagsSectionForPanelRuntime,
        initAttachSectionForPanelRuntime,
        Boolean(initTagsWrapForPanelRuntime && initTagsWrapForPanelRuntime.querySelector('.tag-pill')),
        Boolean(initAttachWrapForPanelRuntime && initAttachWrapForPanelRuntime.querySelector('.ic')),
        false
      );

      const popoutRectForPanelRuntime = popoutForPanelRuntime.getBoundingClientRect();
      const defaultLeftForPanelRuntime = host.getBoundingClientRect().left - popoutRectForPanelRuntime.width - 12 + (Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).length * 20);
      const fallbackLeftForPanelRuntime = host.getBoundingClientRect().right + 12;
      const savedPositionForPanelRuntime = getSavedNotePopoutPositionForPanelRuntime(noteIdForPanelRuntime);
      const startingLeftForPanelRuntime = savedPositionForPanelRuntime
        ? savedPositionForPanelRuntime.left
        : (defaultLeftForPanelRuntime >= 8 ? defaultLeftForPanelRuntime : fallbackLeftForPanelRuntime);
      const startingTopForPanelRuntime = savedPositionForPanelRuntime
        ? savedPositionForPanelRuntime.top
        : (host.getBoundingClientRect().top + (Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).length * 18));
      const clampedStartForPanelRuntime = clampFloatingPositionForPanelRuntime(
        startingLeftForPanelRuntime,
        startingTopForPanelRuntime,
        popoutRectForPanelRuntime.width,
        popoutRectForPanelRuntime.height
      );
      popoutForPanelRuntime.style.left = clampedStartForPanelRuntime.left + 'px';
      popoutForPanelRuntime.style.top = clampedStartForPanelRuntime.top + 'px';
      saveNotePopoutPositionForPanelRuntime(noteIdForPanelRuntime, clampedStartForPanelRuntime.left, clampedStartForPanelRuntime.top);

      const popoutTitleInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-title-input');
      const popoutBodyInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-body-input');
      const popoutHeaderTitleForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-header-title');
      const popoutTagsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-wrap');
      const popoutTagsInputForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-input');
      const popoutAttachmentsWrapForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments');
      const popoutCloseButtonForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-close-btn');
      const popoutEditButtonForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-edit-btn');
      const popoutSaveButtonForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-save-btn');
      const popoutDeleteButtonForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-delete-btn');
      const popoutDeleteButtonEditForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-delete-btn-edit');
      const popoutCancelButtonForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-cancel-btn');
      const popoutTitleDisplayForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-title-display');
      const popoutHeaderForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-header');
      if (
        !popoutTitleInputForPanelRuntime ||
        !popoutBodyInputForPanelRuntime ||
        !popoutHeaderTitleForPanelRuntime ||
        !popoutTagsWrapForPanelRuntime ||
        !popoutTagsInputForPanelRuntime ||
        !popoutAttachmentsWrapForPanelRuntime ||
        !popoutCloseButtonForPanelRuntime ||
        !popoutEditButtonForPanelRuntime ||
        !popoutSaveButtonForPanelRuntime ||
        !popoutDeleteButtonForPanelRuntime ||
        !popoutDeleteButtonEditForPanelRuntime ||
        !popoutCancelButtonForPanelRuntime ||
        !popoutTitleDisplayForPanelRuntime ||
        !popoutHeaderForPanelRuntime
      ) {
        return;
      }

      bindTagInputForPanelRuntime(popoutTagsInputForPanelRuntime, popoutTagsWrapForPanelRuntime);

      popoutForPanelRuntime.addEventListener('mousedown', function () {
        bringNotePopoutToFrontForPanelRuntime(popoutForPanelRuntime);
      });

      function syncPopoutSectionsForPanelRuntime(isEditForPanelRuntime) {
        const tagsSectionForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-tags-section');
        const attachSectionForPanelRuntime = popoutForPanelRuntime.querySelector('.note-popout-attachments-section');
        const hasTags = Boolean(popoutTagsWrapForPanelRuntime && popoutTagsWrapForPanelRuntime.querySelector('.tag-pill'));
        const hasAttachment = Boolean(popoutAttachmentsWrapForPanelRuntime && popoutAttachmentsWrapForPanelRuntime.querySelector('.ic'));
        syncNoteSectionsForPanelRuntime(tagsSectionForPanelRuntime, attachSectionForPanelRuntime, hasTags, hasAttachment, Boolean(isEditForPanelRuntime));
      }

      function setPopoutEditModeForPanelRuntime(isEditForPanelRuntime) {
        popoutForPanelRuntime.classList.toggle('in-edit-mode', Boolean(isEditForPanelRuntime));
        if (!isEditForPanelRuntime) {
          popoutTitleDisplayForPanelRuntime.textContent = popoutTitleInputForPanelRuntime.value || 'Untitled';
          popoutTitleDisplayForPanelRuntime.classList.toggle('untitled', !popoutTitleInputForPanelRuntime.value);
          updateNotePopoutPreviewForPanelRuntime(popoutForPanelRuntime);
          syncPopoutSectionsForPanelRuntime(false);
          return;
        }
        syncPopoutSectionsForPanelRuntime(true);
        popoutTitleInputForPanelRuntime.focus();
      }

      popoutTitleInputForPanelRuntime.addEventListener('input', function () {
        popoutHeaderTitleForPanelRuntime.textContent = popoutTitleInputForPanelRuntime.value || 'Untitled';
        popoutTitleDisplayForPanelRuntime.textContent = popoutTitleInputForPanelRuntime.value || 'Untitled';
        popoutTitleDisplayForPanelRuntime.classList.toggle('untitled', !popoutTitleInputForPanelRuntime.value);
        schedulePopoutNoteDraftSyncForPanelRuntime(popoutForPanelRuntime);
      });
      popoutBodyInputForPanelRuntime.addEventListener('input', function () {
        if (!popoutForPanelRuntime.classList.contains('in-edit-mode')) {
          updateNotePopoutPreviewForPanelRuntime(popoutForPanelRuntime);
        }
        schedulePopoutNoteDraftSyncForPanelRuntime(popoutForPanelRuntime);
      });
      bindNotePasteDetectionForPanelRuntime(popoutBodyInputForPanelRuntime);

      popoutEditButtonForPanelRuntime.addEventListener('click', function () {
        setPopoutEditModeForPanelRuntime(true);
      });

      popoutCloseButtonForPanelRuntime.addEventListener('click', function () {
        closeNotePopoutForPanelRuntime(noteIdForPanelRuntime);
      });

      popoutSaveButtonForPanelRuntime.addEventListener('click', async function () {
        const updatedNoteDataForPanelRuntime = collectNoteDataFromPopoutForPanelRuntime(popoutForPanelRuntime);
        if (!updatedNoteDataForPanelRuntime) return;
        if (!updatedNoteDataForPanelRuntime.title.trim() && !updatedNoteDataForPanelRuntime.body.trim()) return;
        const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
        let persistedNoteForPanelRuntime = null;
        if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateNote === 'function') {
          try {
            persistedNoteForPanelRuntime = await panelDataRepoForPanelRuntime.updateNote(noteIdForPanelRuntime, {
              title: updatedNoteDataForPanelRuntime.title,
              body: updatedNoteDataForPanelRuntime.body,
              tags: updatedNoteDataForPanelRuntime.tags,
              attachments: updatedNoteDataForPanelRuntime.attachments
            }, {
              baseUpdatedAt: popoutForPanelRuntime.dataset ? popoutForPanelRuntime.dataset.noteBaseUpdatedAt : ''
            });
          } catch (errorForPanelRuntime) {
            if (isNoteConflictErrorForPanelRuntime(errorForPanelRuntime)) {
              showNoteConflictNoticeForPanelRuntime(popoutForPanelRuntime, 'Save blocked because this note changed in another tab. Your local draft is still here; reload latest or copy your changes before saving again.');
              const repoForConflict = getPanelDataRepoForPanelRuntime();
              if (repoForConflict && typeof repoForConflict.getNote === 'function') {
                repoForConflict.getNote(noteIdForPanelRuntime).then(function (freshNoteForConflict) {
                  if (freshNoteForConflict && freshNoteForConflict.id != null) {
                    NOTE_STORE_FOR_PANEL_RUNTIME[Number(freshNoteForConflict.id)] = cloneNoteRecordForPanelRuntime(freshNoteForConflict);
                    syncMainNoteListItemForPanelRuntime(Number(freshNoteForConflict.id), false);
                  }
                }).catch(function () {});
              }
            }
            return;
          }
        }
        if (!persistedNoteForPanelRuntime) {
          const existingForPanelRuntime = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] || {};
          const nowIsoForPanelRuntime = new Date().toISOString();
          persistedNoteForPanelRuntime = Object.assign({}, updatedNoteDataForPanelRuntime, {
            createdAt: existingForPanelRuntime.createdAt || nowIsoForPanelRuntime,
            updatedAt: nowIsoForPanelRuntime
          });
        }
        const savedNoteForPanelRuntime = cloneNoteRecordForPanelRuntime(persistedNoteForPanelRuntime || updatedNoteDataForPanelRuntime);
        NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime] = savedNoteForPanelRuntime;
        if (NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(noteIdForPanelRuntime) === -1) {
          NOTE_ORDER_FOR_PANEL_RUNTIME.push(noteIdForPanelRuntime);
        }
        syncSearchIndexForPanelRuntime('notes', 'update', noteIdForPanelRuntime, savedNoteForPanelRuntime);
        syncMainNoteListItemForPanelRuntime(noteIdForPanelRuntime);
        refreshNoteOrderForPanelRuntime();
        if (S.activeNoteId === noteIdForPanelRuntime) {
          const mainFormForPanelRuntime = root.getElementById('note-editor-form');
          applyNoteDataToMainEditorForPanelRuntime(
            noteIdForPanelRuntime,
            mainFormForPanelRuntime ? mainFormForPanelRuntime.classList.contains('in-edit-mode') : false
          );
        }
        syncNotePopoutsForNoteForPanelRuntime(noteIdForPanelRuntime, popoutForPanelRuntime);
        setPopoutEditModeForPanelRuntime(false);
      });

      popoutCancelButtonForPanelRuntime.addEventListener('click', function () {
        if (!popoutHasChangesForPanelRuntime(popoutForPanelRuntime, noteIdForPanelRuntime)) {
          applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime]);
          setPopoutEditModeForPanelRuntime(false);
          return;
        }
        showConfirmPromptForPanelRuntime(
          popoutForPanelRuntime,
          'Your unsaved changes will be permanently lost and cannot be recovered.',
          'Discard',
          function() {
            applyNoteDataToPopoutForPanelRuntime(popoutForPanelRuntime, NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForPanelRuntime]);
            setPopoutEditModeForPanelRuntime(false);
          }
        );
      });

      function confirmPopoutDeleteForPanelRuntime() {
        showConfirmPromptForPanelRuntime(
          popoutForPanelRuntime,
          'This note will be permanently deleted and cannot be recovered.',
          'Delete',
          async function() { await deleteNoteByIdForPanelRuntime(noteIdForPanelRuntime); }
        );
      }
      popoutDeleteButtonForPanelRuntime.addEventListener('click', confirmPopoutDeleteForPanelRuntime);
      popoutDeleteButtonEditForPanelRuntime.addEventListener('click', confirmPopoutDeleteForPanelRuntime);

      popoutHeaderForPanelRuntime.addEventListener('mousedown', function (evtForPanelRuntime) {
        if (evtForPanelRuntime.target.closest('button')) return;
        evtForPanelRuntime.preventDefault();
        const popoutBoundsForPanelRuntime = popoutForPanelRuntime.getBoundingClientRect();
        const dragStartXForPanelRuntime = evtForPanelRuntime.clientX;
        const dragStartYForPanelRuntime = evtForPanelRuntime.clientY;
        const startLeftForPanelRuntime = popoutBoundsForPanelRuntime.left;
        const startTopForPanelRuntime = popoutBoundsForPanelRuntime.top;
        function onMoveForPanelRuntime(moveEvtForPanelRuntime) {
          const dxForPanelRuntime = moveEvtForPanelRuntime.clientX - dragStartXForPanelRuntime;
          const dyForPanelRuntime = moveEvtForPanelRuntime.clientY - dragStartYForPanelRuntime;
          const nextPositionForPanelRuntime = clampFloatingPositionForPanelRuntime(
            startLeftForPanelRuntime + dxForPanelRuntime,
            startTopForPanelRuntime + dyForPanelRuntime,
            popoutForPanelRuntime.offsetWidth,
            popoutForPanelRuntime.offsetHeight
          );
          popoutForPanelRuntime.style.left = nextPositionForPanelRuntime.left + 'px';
          popoutForPanelRuntime.style.top = nextPositionForPanelRuntime.top + 'px';
        }
        function onUpForPanelRuntime() {
          document.removeEventListener('mousemove', onMoveForPanelRuntime);
          document.removeEventListener('mouseup', onUpForPanelRuntime);
          saveNotePopoutPositionForPanelRuntime(
            noteIdForPanelRuntime,
            parseInt(popoutForPanelRuntime.style.left, 10) || 8,
            parseInt(popoutForPanelRuntime.style.top, 10) || 8
          );
        }
        document.addEventListener('mousemove', onMoveForPanelRuntime);
        document.addEventListener('mouseup', onUpForPanelRuntime);
      });
      setPopoutEditModeForPanelRuntime(false);
    }

    function openCurrentNoteInPopoutForPanelRuntime() {
      if (!S.activeNoteId || !NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId]) return;
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      if (noteFormForPanelRuntime && noteFormForPanelRuntime.classList.contains('in-edit-mode')) return;
      openNotePopoutForPanelRuntime(S.activeNoteId);
      showNotePopoutHandoffForPanelRuntime(S.activeNoteId);
    }

    /* ============================================================
      NOTE PASTE CODE DETECTION
    ============================================================ */
    function isLikelyCodeForNotePaste(text) {
      const lines = text.split('\n');
      const nonEmpty = lines.filter(function(l) { return l.trim().length > 0; });
      if (nonEmpty.length < 3) return false;
      const indented = nonEmpty.filter(function(l) { return /^[ \t]/.test(l); }).length;
      return indented / nonEmpty.length >= 0.5;
    }

    function isCursorInsideCodeFenceForNotePaste(ta) {
      const before = ta.value.slice(0, ta.selectionStart);
      const fences = before.match(/```/g);
      return fences ? fences.length % 2 !== 0 : false;
    }

    function insertTextAtCursorForNotePaste(ta, text) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      const newPos = start + text.length;
      ta.selectionStart = newPos;
      ta.selectionEnd = newPos;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function bindDragDropForPanelRuntime(rootNodeForDragDrop) {
      const inputAreaForDragDrop = rootNodeForDragDrop && rootNodeForDragDrop.querySelector('.chat-input-area');
      if (!inputAreaForDragDrop) return;

      const SUPPORTED_IMAGE_TYPES_FOR_DRAG_DROP = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      const SUPPORTED_FILE_TYPES_FOR_DRAG_DROP = [
        'text/', 'application/json', 'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ];

      function isAcceptedImageForDragDrop(file) {
        return SUPPORTED_IMAGE_TYPES_FOR_DRAG_DROP.includes(String(file.type || '').toLowerCase());
      }

      function isAcceptedFileForDragDrop(file) {
        const mt = String(file.type || '').toLowerCase();
        for (var i = 0; i < SUPPORTED_FILE_TYPES_FOR_DRAG_DROP.length; i++) {
          if (mt.indexOf(SUPPORTED_FILE_TYPES_FOR_DRAG_DROP[i]) === 0 || mt === SUPPORTED_FILE_TYPES_FOR_DRAG_DROP[i]) return true;
        }
        return isSupportedFileUploadForPanelRuntime(file);
      }

      function showDragToastForDragDrop(msg) {
        const toastForDragDrop = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
        if (toastForDragDrop && typeof toastForDragDrop.show === 'function') {
          toastForDragDrop.show(String(msg), { durationMs: 4000 });
        }
      }

      var dragDepthForDragDrop = 0;

      inputAreaForDragDrop.addEventListener('dragenter', function (evtForDragEnter) {
        if (!evtForDragEnter.dataTransfer || !evtForDragEnter.dataTransfer.types) return;
        const hasFile = Array.prototype.indexOf.call(evtForDragEnter.dataTransfer.types, 'Files') !== -1;
        if (!hasFile) return;
        evtForDragEnter.preventDefault();
        dragDepthForDragDrop++;
        inputAreaForDragDrop.classList.add('drag-over');
      });

      inputAreaForDragDrop.addEventListener('dragover', function (evtForDragOver) {
        if (!evtForDragOver.dataTransfer || !evtForDragOver.dataTransfer.types) return;
        const hasFile = Array.prototype.indexOf.call(evtForDragOver.dataTransfer.types, 'Files') !== -1;
        if (!hasFile) return;
        evtForDragOver.preventDefault();
        evtForDragOver.dataTransfer.dropEffect = 'copy';
      });

      inputAreaForDragDrop.addEventListener('dragleave', function (evtForDragLeave) {
        dragDepthForDragDrop--;
        if (dragDepthForDragDrop <= 0) {
          dragDepthForDragDrop = 0;
          inputAreaForDragDrop.classList.remove('drag-over');
        }
      });

      inputAreaForDragDrop.addEventListener('drop', function (evtForDrop) {
        evtForDrop.preventDefault();
        evtForDrop.stopPropagation();
        dragDepthForDragDrop = 0;
        inputAreaForDragDrop.classList.remove('drag-over');

        const filesForDrop = evtForDrop.dataTransfer && evtForDrop.dataTransfer.files;
        if (!filesForDrop || filesForDrop.length === 0) return;

        if (filesForDrop.length > MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME) {
          showDragToastForDragDrop('You can drop a maximum of ' + MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME + ' files at once.');
          return;
        }

        processDroppedFilesForPanelRuntime(Array.prototype.slice.call(filesForDrop));
      });

      function processDroppedFilesForPanelRuntime(droppedFilesArr) {
        const rowForCap = rootNodeForDragDrop.querySelector('.input-chips-row');
        const existingCountForCap = rowForCap ? rowForCap.querySelectorAll('.ic').length : 0;
        const remainingSlotsForDrop = MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME - existingCountForCap;
        if (remainingSlotsForDrop <= 0) {
          showDragToastForDragDrop('Attachment limit reached (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
          return;
        }

        const unsupportedNamesForDrop = [];
        const acceptedFilesForDrop = [];
        for (var iForDrop = 0; iForDrop < droppedFilesArr.length; iForDrop++) {
          const fForDrop = droppedFilesArr[iForDrop];
          if (isAcceptedImageForDragDrop(fForDrop) || isAcceptedFileForDragDrop(fForDrop)) {
            acceptedFilesForDrop.push(fForDrop);
          } else {
            unsupportedNamesForDrop.push(String(fForDrop.name || 'file'));
          }
        }

        var skippedForCapCountForDrop = 0;
        if (acceptedFilesForDrop.length > remainingSlotsForDrop) {
          skippedForCapCountForDrop = acceptedFilesForDrop.length - remainingSlotsForDrop;
          acceptedFilesForDrop.length = remainingSlotsForDrop;
        }

        for (var jForDrop = 0; jForDrop < acceptedFilesForDrop.length; jForDrop++) {
          attachDroppedFileForPanelRuntime(acceptedFilesForDrop[jForDrop]);
        }

        if (unsupportedNamesForDrop.length > 0) {
          showDragToastForDragDrop('Skipped unsupported file' + (unsupportedNamesForDrop.length === 1 ? '' : 's') + ': ' + unsupportedNamesForDrop.join(', ') + '. Accepted: images (PNG, JPEG, WebP, GIF) and documents (PDF, TXT, MD, JSON, CSV, DOCX, XLSX, PPTX, ODS).');
        }
        if (skippedForCapCountForDrop > 0) {
          showDragToastForDragDrop('Attachment limit reached: ' + skippedForCapCountForDrop + ' file' + (skippedForCapCountForDrop === 1 ? '' : 's') + ' not added (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
        }
      }

      function attachDroppedFileForPanelRuntime(fileForAttach) {
        if (isAcceptedImageForDragDrop(fileForAttach)) {
          const pendingChipForImg = addInputChipForPanelRuntime({
            type: 'image',
            label: String(fileForAttach.name || 'Image'),
            status: 'loading',
            statusText: 'Processing image...'
          });
          if (!pendingChipForImg) return;
          attachImageFileForPanelRuntime(fileForAttach, 'image', pendingChipForImg).catch(function (errForImg) {
            if (pendingChipForImg) {
              setInputChipStatusForPanelRuntime(pendingChipForImg, 'error',
                errForImg && errForImg.message ? errForImg.message : 'Image upload failed.');
            }
            appendSystemMsgToContainerForPanelRuntime(errForImg && errForImg.message ? errForImg.message : 'Image upload failed.');
          });
          return;
        }
        const pendingChipForFile = addInputChipForPanelRuntime({
          type: 'file',
          label: String(fileForAttach.name || 'File'),
          status: 'loading',
          statusText: 'Parsing file...'
        });
        if (!pendingChipForFile) return;
        attachFileForPanelRuntime(fileForAttach, pendingChipForFile).catch(function (errForFile) {
          if (pendingChipForFile) {
            setInputChipStatusForPanelRuntime(pendingChipForFile, 'error',
              errForFile && errForFile.message ? errForFile.message : 'File upload failed.');
          }
          appendSystemMsgToContainerForPanelRuntime(errForFile && errForFile.message ? errForFile.message : 'File upload failed.');
        });
      }
    }

    function bindPasteInterceptForPanelRuntime(ta) {
      if (!ta) return;
      ta.addEventListener('paste', function (evtForPasteIntercept) {
        evtForPasteIntercept.preventDefault();
        const textForPasteIntercept = evtForPasteIntercept.clipboardData
          ? evtForPasteIntercept.clipboardData.getData('text/plain')
          : '';
        if (!textForPasteIntercept) return;
        if (textForPasteIntercept.length > 1000) {
          addInputChipForPanelRuntime({
            type: 'paste',
            label: 'Pasted text',
            content: textForPasteIntercept,
            mimeType: 'text/plain',
            kind: 'paste'
          });
        } else {
          document.execCommand('insertText', false, textForPasteIntercept);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

    function bindNotePasteDetectionForPanelRuntime(ta) {
      if (!ta || ta.dataset.notePasteBound === '1') return;
      ta.dataset.notePasteBound = '1';
      ta.addEventListener('paste', function(evt) {
        const pasted = evt.clipboardData && evt.clipboardData.getData('text');
        if (!pasted) return;
        if (!isLikelyCodeForNotePaste(pasted)) return;
        if (isCursorInsideCodeFenceForNotePaste(ta)) return;
        evt.preventDefault();

        const wrap = ta.parentNode;
        if (!wrap) return;
        const existing = wrap.querySelector('.note-paste-prompt');
        if (existing) existing.remove();

        const prompt = document.createElement('div');
        prompt.className = 'note-paste-prompt';
        prompt.innerHTML =
          '<p class="note-paste-prompt-text">Wrap pasted content in a code block?</p>' +
          '<div class="note-paste-prompt-btns">' +
            '<button class="note-paste-prompt-yes" type="button">Yes, wrap it</button>' +
            '<button class="note-paste-prompt-no" type="button">No, paste as-is</button>' +
          '</div>';
        wrap.appendChild(prompt);

        var finalized = false;
        function finalize(doWrap) {
          if (finalized) return;
          finalized = true;
          document.removeEventListener('mousedown', onOutsideClick, true);
          prompt.remove();
          insertTextAtCursorForNotePaste(ta, doWrap ? '```\n' + pasted + '\n```' : pasted);
        }

        function onOutsideClick(e) {
          var path = e.composedPath ? e.composedPath() : [e.target];
          if (path.indexOf(prompt) === -1) finalize(false);
        }

        document.addEventListener('mousedown', onOutsideClick, true);
        prompt.querySelector('.note-paste-prompt-yes').addEventListener('click', function() { finalize(true); });
        prompt.querySelector('.note-paste-prompt-no').addEventListener('click', function() { finalize(false); });
      });
    }

    /* ============================================================
      NOTE EDITOR MODE SWITCHING
    ============================================================ */
    function showConfirmPromptForPanelRuntime(container, message, yesLabel, onConfirm, onCancel) {
      const existingForPrompt = container.querySelector('.confirm-prompt');
      if (existingForPrompt) existingForPrompt.remove();
      const promptForPanelRuntime = document.createElement('div');
      promptForPanelRuntime.className = 'confirm-prompt';
      promptForPanelRuntime.innerHTML =
        '<p class="confirm-prompt-text">' + message + '</p>' +
        '<div class="confirm-prompt-btns">' +
          '<button class="confirm-prompt-yes" type="button">' + (yesLabel || 'Yes') + '</button>' +
          '<button class="confirm-prompt-no" type="button">No</button>' +
        '</div>';
      container.appendChild(promptForPanelRuntime);
      var doneForPrompt = false;
      function finishPrompt(confirmed) {
        if (doneForPrompt) return;
        doneForPrompt = true;
        document.removeEventListener('mousedown', onOutsideForPrompt, true);
        promptForPanelRuntime.remove();
        if (confirmed) onConfirm();
        else if (typeof onCancel === 'function') onCancel();
      }
      function onOutsideForPrompt(e) {
        var path = e.composedPath ? e.composedPath() : [e.target];
        if (path.indexOf(promptForPanelRuntime) === -1) finishPrompt(false);
      }
      document.addEventListener('mousedown', onOutsideForPrompt, true);
      promptForPanelRuntime.querySelector('.confirm-prompt-yes').addEventListener('click', function() { finishPrompt(true); });
      promptForPanelRuntime.querySelector('.confirm-prompt-no').addEventListener('click', function() { finishPrompt(false); });
    }

    function showInfoPromptForPanelRuntime(container, message, okLabel) {
      var existingForInfo = container.querySelector('.confirm-prompt');
      if (existingForInfo) existingForInfo.remove();
      var promptEl = document.createElement('div');
      promptEl.className = 'confirm-prompt';
      promptEl.innerHTML =
        '<p class="confirm-prompt-text">' + message + '</p>' +
        '<div class="confirm-prompt-btns">' +
          '<button class="confirm-prompt-yes" type="button">' + escHtml(okLabel || 'Got it') + '</button>' +
        '</div>';
      container.appendChild(promptEl);
      promptEl.querySelector('.confirm-prompt-yes').addEventListener('click', function() {
        promptEl.remove();
      });
    }

    function mainEditorHasChangesForPanelRuntime() {
      const noteForCheck = NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId];
      if (!noteForCheck) return false;
      const noteFormForCheck = root.getElementById('note-editor-form');
      const currentDraftForCheck = collectMainNoteDraftForPanelRuntime();
      if (noteFormForCheck && currentDraftForCheck && noteFormForCheck.dataset.noteBaseSnapshot) {
        return noteDraftHasLocalChangesForPanelRuntime(currentDraftForCheck, noteFormForCheck);
      }
      const titleElForCheck = root.getElementById('ne-title');
      const bodyElForCheck  = root.getElementById('ne-body');
      if ((titleElForCheck ? titleElForCheck.value : '') !== (noteForCheck.title || '')) return true;
      if ((bodyElForCheck  ? bodyElForCheck.value  : '') !== (noteForCheck.body  || '')) return true;
      const tagsWrapForCheck = root.getElementById('ne-tags-wrap');
      const currentTagsForCheck = tagsWrapForCheck ? extractTagsFromWrapForPanelRuntime(tagsWrapForCheck) : [];
      const savedTagsForCheck   = normalizeTagsForPanelRuntime(noteForCheck.tags);
      if (currentTagsForCheck.join('\0') !== savedTagsForCheck.join('\0')) return true;
      const attWrapForCheck  = root.getElementById('ne-attachments');
      const hasCurrentAttach = attWrapForCheck ? Boolean(attWrapForCheck.querySelector('.ic')) : false;
      const hasSavedAttach   = Array.isArray(noteForCheck.attachments) && noteForCheck.attachments.length > 0;
      if (hasCurrentAttach !== hasSavedAttach) return true;
      return false;
    }

    function popoutHasChangesForPanelRuntime(popoutEl, noteIdForCheck) {
      const noteForCheck = NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForCheck];
      if (!noteForCheck) return false;
      const currentDraftForCheck = collectNoteDataFromPopoutForPanelRuntime(popoutEl);
      if (popoutEl && currentDraftForCheck && popoutEl.dataset.noteBaseSnapshot) {
        return noteDraftHasLocalChangesForPanelRuntime(currentDraftForCheck, popoutEl);
      }
      const titleElForCheck = popoutEl.querySelector('.note-popout-title-input');
      const bodyElForCheck  = popoutEl.querySelector('.note-popout-body-input');
      if ((titleElForCheck ? titleElForCheck.value : '') !== (noteForCheck.title || '')) return true;
      if ((bodyElForCheck  ? bodyElForCheck.value  : '') !== (noteForCheck.body  || '')) return true;
      const tagsWrapForCheck = popoutEl.querySelector('.note-popout-tags-wrap');
      const currentTagsForCheck = tagsWrapForCheck ? extractTagsFromWrapForPanelRuntime(tagsWrapForCheck) : [];
      const savedTagsForCheck   = normalizeTagsForPanelRuntime(noteForCheck.tags);
      if (currentTagsForCheck.join('\0') !== savedTagsForCheck.join('\0')) return true;
      const attWrapForCheck  = popoutEl.querySelector('.note-popout-attachments');
      const hasCurrentAttach = attWrapForCheck ? Boolean(attWrapForCheck.querySelector('.ic')) : false;
      const hasSavedAttach   = Array.isArray(noteForCheck.attachments) && noteForCheck.attachments.length > 0;
      if (hasCurrentAttach !== hasSavedAttach) return true;
      return false;
    }

    function enterNoteEditMode() {
      if (S.activeNoteId && isNotePoppedOutForPanelRuntime(S.activeNoteId)) return;
      const form = root.getElementById('note-editor-form');
      if (!form) return;
      form.classList.add('in-edit-mode');
      // Always reveal both sections in edit mode so the user can add tags/attachments.
      const tagsSectionForEnter = root.getElementById('ne-tags-section');
      const attachSectionForEnter = root.getElementById('ne-attachments-section');
      if (tagsSectionForEnter) tagsSectionForEnter.style.display = '';
      if (attachSectionForEnter) attachSectionForEnter.style.display = '';
      const titleInputForPanelRuntime = root.getElementById('ne-title');
      if (titleInputForPanelRuntime) titleInputForPanelRuntime.focus();
    }

    function exitNoteEditMode() {
      const noteFormForCancel = root.getElementById('note-editor-form');
      if (!noteFormForCancel) return;
      if (S.activeNoteId && NOTE_STORE_FOR_PANEL_RUNTIME[S.activeNoteId]) {
        if (!mainEditorHasChangesForPanelRuntime()) {
          applyNoteDataToMainEditorForPanelRuntime(S.activeNoteId, false);
          return;
        }
        showConfirmPromptForPanelRuntime(
          root.querySelector('.panel-content'),
          'Your unsaved changes will be permanently lost and cannot be recovered.',
          'Discard',
          function() { applyNoteDataToMainEditorForPanelRuntime(S.activeNoteId, false); }
        );
      } else {
        const noteTitleInputForCancel = root.getElementById('ne-title');
        const noteBodyInputForCancel  = root.getElementById('ne-body');
        const hasContent = (noteTitleInputForCancel && noteTitleInputForCancel.value.trim()) ||
                          (noteBodyInputForCancel && noteBodyInputForCancel.value.trim()) ||
                          Boolean(root.querySelector('#ne-tags-wrap .tag-pill')) ||
                          Boolean(root.querySelector('#ne-attachments .ic'));
        if (!hasContent) return;
        showConfirmPromptForPanelRuntime(
          root.querySelector('.panel-content'),
          'This draft will be permanently discarded and cannot be recovered.',
          'Discard',
          function() {
            const titleEl = root.getElementById('ne-title');
            const bodyEl  = root.getElementById('ne-body');
            if (titleEl) titleEl.value = '';
            if (bodyEl)  bodyEl.value  = '';
            const tagsWrap = root.getElementById('ne-tags-wrap');
            if (tagsWrap) tagsWrap.querySelectorAll('.tag-pill').forEach(function(p) { p.remove(); });
            const attWrap = root.getElementById('ne-attachments');
            if (attWrap) attWrap.querySelectorAll('.ic').forEach(function(c) { c.remove(); });
          }
        );
      }
    }

    /* ============================================================
      NOTES
    ============================================================ */

    function showNoteForm(show) {
      const noteEmptyPaneForPanelRuntime = root.getElementById('note-pane-empty');
      const noteFormForPanelRuntime = root.getElementById('note-editor-form');
      hideNotePopoutHandoffForPanelRuntime();
      if (noteEmptyPaneForPanelRuntime) noteEmptyPaneForPanelRuntime.classList.toggle('hidden', show);
      if (noteFormForPanelRuntime) noteFormForPanelRuntime.classList.toggle('hidden', !show);
    }

    function newNote() {
      S.activeNoteId = null;
      writePanelStateSyncForPanelRuntime({ activeNoteId: null });
      root.querySelectorAll('.note-item').forEach(el => el.classList.remove('active'));
      const noteTitleInputForPanelRuntime = root.getElementById('ne-title');
      const noteBodyInputForPanelRuntime = root.getElementById('ne-body');
      if (noteTitleInputForPanelRuntime) noteTitleInputForPanelRuntime.value = '';
      if (noteBodyInputForPanelRuntime) noteBodyInputForPanelRuntime.value = '';
      // Clear tags
      const wrap = root.getElementById('ne-tags-wrap');
      if (wrap) wrap.querySelectorAll('.tag-pill').forEach(p => p.remove());
      // Clear attachments
      const att = root.getElementById('ne-attachments');
      if (att) att.querySelectorAll('.ic').forEach(c => c.remove());
      // New note starts in edit mode (nothing to preview yet)
      const form = root.getElementById('note-editor-form');
      if (!form) return;
      form.classList.add('in-edit-mode');
      setNoteBaseSnapshotForPanelRuntime(form, { title: '', body: '', tags: [], attachments: [] }, '');
      const display = root.getElementById('ne-title-display');
      if (display) {
        display.textContent = 'Untitled';
        display.classList.add('untitled');
      }
      const notePreviewForPanelRuntime = root.getElementById('ne-preview');
      if (notePreviewForPanelRuntime) notePreviewForPanelRuntime.innerHTML = '';
      const deleteEditBtnForNewNote = root.getElementById('ne-delete-btn-edit');
      if (deleteEditBtnForNewNote) deleteEditBtnForNewNote.style.display = 'none';
      showNoteForm(true);
      S.inNoteView = true;
      setReducedPaneForPanelRuntime('notes', 'detail');
      if (noteTitleInputForPanelRuntime) noteTitleInputForPanelRuntime.focus();
    }

    function selectNote(id) {
      if (!id || !NOTE_STORE_FOR_PANEL_RUNTIME[id]) return;
      if (isNotePoppedOutForPanelRuntime(id)) {
        showNotePopoutHandoffForPanelRuntime(id);
        return;
      }
      applyNoteDataToMainEditorForPanelRuntime(id, false);
    }

    function openNoteEditor() { newNote(); }

    // Called from sidebar dropdown "Edit" — open note then immediately enter edit mode
    function editNoteFromDropdown(id) {
      selectNote(id);
      if (S.handoffNoteId === id) return;
      enterNoteEditMode();
    }

    async function saveNoteFromMainEditorForPanelRuntime() {
      if (S.activeNoteId && isNotePoppedOutForPanelRuntime(S.activeNoteId)) return;
      const titleElForSave = root.getElementById('ne-title');
      const bodyElForSave  = root.getElementById('ne-body');
      const titleIsEmpty = !titleElForSave || !titleElForSave.value.trim();
      const bodyIsEmpty  = !bodyElForSave  || !bodyElForSave.value.trim();
      if (titleIsEmpty && bodyIsEmpty) return;
      await saveMainNoteForPanelRuntime(false);
    }

    function deleteNoteFromMainEditorForPanelRuntime(noteIdForPanelRuntime) {
      const resolvedNoteIdForPanelRuntime = noteIdForPanelRuntime || S.activeNoteId;
      if (!resolvedNoteIdForPanelRuntime) return;
      showConfirmPromptForPanelRuntime(
        root.querySelector('.panel-content'),
        'This note will be permanently deleted and cannot be recovered.',
        'Delete',
        async function() { await deleteNoteByIdForPanelRuntime(resolvedNoteIdForPanelRuntime); }
      );
    }

    function backFromNote() {
      S.inNoteView = false;
      setReducedPaneForPanelRuntime('notes', 'list');
    }

    const mainTagsWrapForPanelRuntime = root.getElementById('ne-tags-wrap');
    const mainTagsInputForPanelRuntime = root.getElementById('ne-tags-input');
    if (mainTagsWrapForPanelRuntime && mainTagsInputForPanelRuntime) {
      bindTagInputForPanelRuntime(mainTagsInputForPanelRuntime, mainTagsWrapForPanelRuntime);
    }
    const mainNoteTitleInputForDraftSync = root.getElementById('ne-title');
    const mainNoteBodyInputForDraftSync = root.getElementById('ne-body');
    if (mainNoteTitleInputForDraftSync) {
      mainNoteTitleInputForDraftSync.addEventListener('input', scheduleMainNoteDraftSyncForPanelRuntime);
    }
    if (mainNoteBodyInputForDraftSync) {
      mainNoteBodyInputForDraftSync.addEventListener('input', scheduleMainNoteDraftSyncForPanelRuntime);
    }
    const closeMainPanelButtonForRuntime = root.querySelector('#panel-host .ctrl-close');
    if (closeMainPanelButtonForRuntime && closeMainPanelButtonForRuntime.dataset.abchatClosePopoutBound !== '1') {
      closeMainPanelButtonForRuntime.dataset.abchatClosePopoutBound = '1';
      closeMainPanelButtonForRuntime.addEventListener('click', function () {
        closeAllNotePopoutsForPanelRuntime();
      });
    }

    /* ============================================================
      TASKS
    ============================================================ */
    function setFilter(filter, optionsForFilter) {
      const optsForFilterForPanelRuntime = optionsForFilter || {};
      S.taskFilter = filter || 'all';
      root.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.filter === S.taskFilter));
      const taskSearchInputForFilter = root.getElementById('task-search-input');
      filterTasksListForPanelRuntime(taskSearchInputForFilter ? taskSearchInputForFilter.value : '');
      if (!optsForFilterForPanelRuntime.skipStateSync) {
        writePanelStateSyncForPanelRuntime({ taskFilter: S.taskFilter });
      }
    }

    function setTaskFilterForMirrorForPanelRuntime(filterForMirror) {
      setFilter(filterForMirror, { skipStateSync: true });
    }

    function toDateTimeLocalValueForPanelRuntime(rawDateForPanelRuntime) {
      if (!rawDateForPanelRuntime) return '';
      const parsedDateForPanelRuntime = new Date(rawDateForPanelRuntime);
      if (!Number.isFinite(parsedDateForPanelRuntime.getTime())) return String(rawDateForPanelRuntime);
      const offsetMinutesForPanelRuntime = parsedDateForPanelRuntime.getTimezoneOffset();
      const localTimestampForPanelRuntime = parsedDateForPanelRuntime.getTime() - (offsetMinutesForPanelRuntime * 60000);
      return new Date(localTimestampForPanelRuntime).toISOString().slice(0, 16);
    }

    function collectTaskDraftForPanelRuntime() {
      const titleInputForPanelRuntime = root.getElementById('tep-title-input');
      const notesInputForPanelRuntime = root.getElementById('tep-notes');
      const dueInputForPanelRuntime = root.getElementById('tep-due');
      const reminderInputForPanelRuntime = root.getElementById('tep-reminder');
      if (!titleInputForPanelRuntime || !notesInputForPanelRuntime || !dueInputForPanelRuntime || !reminderInputForPanelRuntime) {
        return null;
      }
      const titleForPanelRuntime = titleInputForPanelRuntime.value.trim();
      if (!titleForPanelRuntime) {
        return null;
      }
      return {
        title: titleForPanelRuntime,
        body: notesInputForPanelRuntime.value || '',
        dueAt: dueInputForPanelRuntime.value || '',
        reminderAt: reminderInputForPanelRuntime.value || ''
      };
    }

    function applyTaskDataToEditorForPanelRuntime(taskIdForPanelRuntime) {
      const dataForPanelRuntime = TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime];
      if (!dataForPanelRuntime) return;
      const titleLabelForPanelRuntime = root.getElementById('tep-title');
      const titleInputForPanelRuntime = root.getElementById('tep-title-input');
      const notesInputForPanelRuntime = root.getElementById('tep-notes');
      const dueInputForPanelRuntime = root.getElementById('tep-due');
      const reminderInputForPanelRuntime = root.getElementById('tep-reminder');
      const markDoneButtonForPanelRuntime = root.getElementById('tep-markdone-btn');
      const deleteButtonForPanelRuntime = root.getElementById('tep-delete-btn');
      const formForPanelRuntime = root.getElementById('task-editor-form');
      if (titleLabelForPanelRuntime) titleLabelForPanelRuntime.textContent = 'Edit Task';
      if (titleInputForPanelRuntime) titleInputForPanelRuntime.value = dataForPanelRuntime.title;
      if (notesInputForPanelRuntime) notesInputForPanelRuntime.value = dataForPanelRuntime.body;
      if (dueInputForPanelRuntime) dueInputForPanelRuntime.value = toDateTimeLocalValueForPanelRuntime(dataForPanelRuntime.dueAt);
      if (reminderInputForPanelRuntime) reminderInputForPanelRuntime.value = toDateTimeLocalValueForPanelRuntime(dataForPanelRuntime.reminderAt);
      if (markDoneButtonForPanelRuntime) markDoneButtonForPanelRuntime.style.display = dataForPanelRuntime.isCompleted ? 'none' : '';
      if (deleteButtonForPanelRuntime) deleteButtonForPanelRuntime.style.display = '';
      if (formForPanelRuntime && formForPanelRuntime.dataset) {
        formForPanelRuntime.dataset.taskBaseUpdatedAt = String(dataForPanelRuntime.updatedAt || '');
      }
    }

    function isTaskConflictErrorForPanelRuntime(errorForPanelRuntime) {
      return Boolean(errorForPanelRuntime && String(errorForPanelRuntime.message || errorForPanelRuntime).indexOf('TASK_CONFLICT') !== -1);
    }

    function handleTaskConflictForPanelRuntime(taskIdForPanelRuntime) {
      const toastForTaskConflict = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForTaskConflict && typeof toastForTaskConflict.show === 'function') {
        toastForTaskConflict.show('This task changed in another tab. Your draft was kept; click Save again to overwrite the newer version.', { durationMs: 5500 });
      }
      const repoForTaskConflict = getPanelDataRepoForPanelRuntime();
      if (repoForTaskConflict && typeof repoForTaskConflict.getTask === 'function' && taskIdForPanelRuntime) {
        repoForTaskConflict.getTask(taskIdForPanelRuntime).then(function (freshTaskForConflict) {
          if (freshTaskForConflict && freshTaskForConflict.id != null) {
            const numericIdForConflict = Number(freshTaskForConflict.id);
            TASK_STORE_FOR_PANEL_RUNTIME[numericIdForConflict] = cloneTaskRecordForPanelRuntime(freshTaskForConflict);
            syncSearchIndexForPanelRuntime('tasks', 'update', numericIdForConflict, TASK_STORE_FOR_PANEL_RUNTIME[numericIdForConflict]);
            syncMainTaskListItemForPanelRuntime(numericIdForConflict);
            const formForConflict = root.getElementById('task-editor-form');
            if (formForConflict && formForConflict.dataset && S.activeTaskId === numericIdForConflict) {
              formForConflict.dataset.taskBaseUpdatedAt = String(freshTaskForConflict.updatedAt || '');
            }
          }
        }).catch(function () {});
      }
    }

    function createNextTaskIdForPanelRuntime() {
      const keysForNewTaskIdForPanelRuntime = Object.keys(TASK_STORE_FOR_PANEL_RUNTIME).map(Number);
      return keysForNewTaskIdForPanelRuntime.length ? Math.max.apply(null, keysForNewTaskIdForPanelRuntime) + 1 : 1;
    }

    async function toggleTask(e, cb) {
      e.stopPropagation();
      const item = cb.closest('.task-item');
      if (!item) return;
      const taskIdForPanelRuntime = Number(item.dataset.taskId);
      if (!taskIdForPanelRuntime || !TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime]) return;
      const done = item.dataset.completed === 'true';
      const nextDoneForPanelRuntime = !done;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      let updatedTaskForPanelRuntime = null;

      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.toggleTaskCompleted === 'function') {
        try {
          updatedTaskForPanelRuntime = await panelDataRepoForPanelRuntime.toggleTaskCompleted(taskIdForPanelRuntime, nextDoneForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      }

      TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime] = cloneTaskRecordForPanelRuntime(
        updatedTaskForPanelRuntime || {
          ...TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime],
          isCompleted: nextDoneForPanelRuntime
        }
      );
      syncSearchIndexForPanelRuntime('tasks', 'update', taskIdForPanelRuntime, TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime]);
      syncMainTaskListItemForPanelRuntime(taskIdForPanelRuntime);
      if (S.activeTaskId === taskIdForPanelRuntime) {
        applyTaskDataToEditorForPanelRuntime(taskIdForPanelRuntime);
      }
      // Re-apply filter
      const active = root.querySelector('.ftab.active');
      if (active) setFilter(active.dataset.filter);
    }


    function showTaskForm(show) {
      root.getElementById('task-pane-empty').classList.toggle('hidden', show);
      root.getElementById('task-editor-form').classList.toggle('hidden', !show);
    }

    function newTask() {
      S.activeTaskId = null;
      root.querySelectorAll('.task-item').forEach(el => el.classList.remove('active-task'));
      const newTaskFormForPanelRuntime = root.getElementById('task-editor-form');
      if (newTaskFormForPanelRuntime && newTaskFormForPanelRuntime.dataset) {
        newTaskFormForPanelRuntime.dataset.taskBaseUpdatedAt = '';
      }
      root.getElementById('tep-title').textContent = 'New Task';
      root.getElementById('tep-title-input').value = '';
      root.getElementById('tep-notes').value = '';
      root.getElementById('tep-due').value = '';
      root.getElementById('tep-reminder').value = '';
      root.getElementById('tep-markdone-btn').style.display = 'none';
      root.getElementById('tep-delete-btn').style.display = 'none';
      showTaskForm(true);
      setReducedPaneForPanelRuntime('tasks', 'detail');
      root.getElementById('tep-title-input').focus();
    }

    function selectTask(item) {
      if (!item) return;
      root.querySelectorAll('.task-item').forEach(el => el.classList.remove('active-task'));
      item.classList.add('active-task');
      const id = Number(item.dataset.taskId);
      S.activeTaskId = id;
      const data = TASK_STORE_FOR_PANEL_RUNTIME[id];
      if (data) applyTaskDataToEditorForPanelRuntime(id);
      showTaskForm(true);
      setReducedPaneForPanelRuntime('tasks', 'detail');
    }

    function backFromTask() {
      setReducedPaneForPanelRuntime('tasks', 'list');
    }

    function openTaskEditor() { newTask(); }

    function closeTaskEditor() {
      S.activeTaskId = null;
      root.querySelectorAll('.task-item').forEach(el => el.classList.remove('active-task'));
      showTaskForm(false);
      setReducedPaneForPanelRuntime('tasks', 'list');
    }

    async function saveTaskForPanelRuntime() {
      const taskDraftForPanelRuntime = collectTaskDraftForPanelRuntime();
      if (!taskDraftForPanelRuntime) return;

      const existingTaskIdForPanelRuntime = S.activeTaskId;
      let isNewTaskForPanelRuntime = !existingTaskIdForPanelRuntime || !TASK_STORE_FOR_PANEL_RUNTIME[existingTaskIdForPanelRuntime];
      let taskIdForPanelRuntime = existingTaskIdForPanelRuntime;
      let persistedTaskForPanelRuntime = null;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();

      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createTask === 'function') {
        try {
          if (isNewTaskForPanelRuntime) {
            persistedTaskForPanelRuntime = await panelDataRepoForPanelRuntime.createTask(taskDraftForPanelRuntime);
          } else {
            const taskFormForSaveForPanelRuntime = root.getElementById('task-editor-form');
            const taskBaseUpdatedAtForPanelRuntime = taskFormForSaveForPanelRuntime && taskFormForSaveForPanelRuntime.dataset
              ? taskFormForSaveForPanelRuntime.dataset.taskBaseUpdatedAt
              : '';
            persistedTaskForPanelRuntime = await panelDataRepoForPanelRuntime.updateTask(
              taskIdForPanelRuntime,
              taskDraftForPanelRuntime,
              { baseUpdatedAt: taskBaseUpdatedAtForPanelRuntime }
            );
          }
          if (persistedTaskForPanelRuntime && persistedTaskForPanelRuntime.id != null) {
            taskIdForPanelRuntime = Number(persistedTaskForPanelRuntime.id);
          }
        } catch (errorForPanelRuntime) {
          if (isTaskConflictErrorForPanelRuntime(errorForPanelRuntime)) {
            handleTaskConflictForPanelRuntime(taskIdForPanelRuntime);
          }
          return;
        }
      } else if (isNewTaskForPanelRuntime) {
        taskIdForPanelRuntime = createNextTaskIdForPanelRuntime();
      }

      if (!persistedTaskForPanelRuntime) {
        const existingTaskForPanelRuntime = !isNewTaskForPanelRuntime ? TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime] : null;
        const nowIsoForPanelRuntime = new Date().toISOString();
        persistedTaskForPanelRuntime = Object.assign({}, taskDraftForPanelRuntime, {
          isCompleted: existingTaskForPanelRuntime ? Boolean(existingTaskForPanelRuntime.isCompleted) : false,
          createdAt: existingTaskForPanelRuntime && existingTaskForPanelRuntime.createdAt
            ? existingTaskForPanelRuntime.createdAt
            : nowIsoForPanelRuntime,
          updatedAt: nowIsoForPanelRuntime
        });
      }
      const savedTaskForPanelRuntime = cloneTaskRecordForPanelRuntime(
        persistedTaskForPanelRuntime || { ...taskDraftForPanelRuntime, isCompleted: false }
      );
      TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime] = savedTaskForPanelRuntime;
      if (TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(taskIdForPanelRuntime) === -1) {
        TASK_ORDER_FOR_PANEL_RUNTIME.push(taskIdForPanelRuntime);
      }
      syncSearchIndexForPanelRuntime('tasks', isNewTaskForPanelRuntime ? 'add' : 'update', taskIdForPanelRuntime, savedTaskForPanelRuntime);
      syncMainTaskListItemForPanelRuntime(taskIdForPanelRuntime);
      refreshTaskOrderForPanelRuntime();
      closeTaskEditor();
      const activeFilterForPanelRuntime = root.querySelector('.ftab.active');
      if (activeFilterForPanelRuntime) setFilter(activeFilterForPanelRuntime.dataset.filter);
      const toastForSaveTaskForPanelRuntime = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForSaveTaskForPanelRuntime && typeof toastForSaveTaskForPanelRuntime.show === 'function') {
        toastForSaveTaskForPanelRuntime.show(isNewTaskForPanelRuntime ? 'Task saved.' : 'Task updated.');
      }
    }

    async function markTaskDoneForPanelRuntime() {
      if (!S.activeTaskId || !TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId]) return;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      let updatedTaskForPanelRuntime = null;
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.toggleTaskCompleted === 'function') {
        try {
          updatedTaskForPanelRuntime = await panelDataRepoForPanelRuntime.toggleTaskCompleted(S.activeTaskId, true);
        } catch (errorForPanelRuntime) {
          return;
        }
      }

      TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId] = cloneTaskRecordForPanelRuntime(
        updatedTaskForPanelRuntime || {
          ...TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId],
          isCompleted: true,
          updatedAt: new Date().toISOString()
        }
      );
      syncSearchIndexForPanelRuntime('tasks', 'update', S.activeTaskId, TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId]);
      syncMainTaskListItemForPanelRuntime(S.activeTaskId);
      refreshTaskOrderForPanelRuntime();
      applyTaskDataToEditorForPanelRuntime(S.activeTaskId);
      const activeFilterForPanelRuntime = root.querySelector('.ftab.active');
      if (activeFilterForPanelRuntime) setFilter(activeFilterForPanelRuntime.dataset.filter);
    }

    async function doDeleteTaskForPanelRuntime() {
      if (!S.activeTaskId || !TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId]) return;
      const taskIdForPanelRuntime = S.activeTaskId;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.deleteTask === 'function') {
        try {
          await panelDataRepoForPanelRuntime.deleteTask(taskIdForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      }
      delete TASK_STORE_FOR_PANEL_RUNTIME[taskIdForPanelRuntime];
      const orderIndexForPanelRuntime = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(taskIdForPanelRuntime);
      if (orderIndexForPanelRuntime >= 0) TASK_ORDER_FOR_PANEL_RUNTIME.splice(orderIndexForPanelRuntime, 1);
      syncSearchIndexForPanelRuntime('tasks', 'remove', taskIdForPanelRuntime);
      removeMainTaskListItemForPanelRuntime(taskIdForPanelRuntime);
      refreshTaskDotForPanelRuntime();
      S.activeTaskId = null;
      closeTaskEditor();
    }

    function deleteTaskForPanelRuntime() {
      if (!S.activeTaskId || !TASK_STORE_FOR_PANEL_RUNTIME[S.activeTaskId]) return;
      showConfirmPromptForPanelRuntime(
        root.querySelector('.panel-content'),
        'This task will be permanently deleted and cannot be recovered.',
        'Delete',
        function() { doDeleteTaskForPanelRuntime(); }
      );
    }


    /* ============================================================
      PICKER MODAL (note / chat selection)
    ============================================================ */
    function getPickerNotesForPanelRuntime() {
      return NOTE_ORDER_FOR_PANEL_RUNTIME.filter(function (idForPicker) {
        const nForPicker = NOTE_STORE_FOR_PANEL_RUNTIME[idForPicker];
        return nForPicker && nForPicker.noteType !== 'agent';
      }).map(function (idForPicker) {
        const nForPicker = NOTE_STORE_FOR_PANEL_RUNTIME[idForPicker];
        return {
          id: idForPicker,
          title: nForPicker.title || 'Untitled',
          excerpt: getNoteExcerptForPanelRuntime(nForPicker.body),
          tags: nForPicker.tags ? nForPicker.tags.slice() : [],
        };
      });
    }

    function getPickerChatsForPanelRuntime() {
      return CHAT_ORDER_FOR_PANEL_RUNTIME
        .filter(function (idForPicker) {
          const cForPicker = CHAT_STORE_FOR_PANEL_RUNTIME[idForPicker];
          return cForPicker && cForPicker.type !== 'quickq';
        })
        .map(function (idForPicker) {
          const cForPicker = CHAT_STORE_FOR_PANEL_RUNTIME[idForPicker];
          const msgsForPickerChat = cForPicker.messages || [];
          const firstUserMsgForPicker = msgsForPickerChat.find(function (m) {
            return m && m.role === 'user';
          });
          const excerptForPickerChat = String(
            (firstUserMsgForPicker && (firstUserMsgForPicker.md || firstUserMsgForPicker.content)) ||
            cForPicker.summary ||
            ''
          ).slice(0, 150);
          return {
            id: idForPicker,
            title: cForPicker.title,
            excerpt: excerptForPickerChat,
            tags: []
          };
        });
    }

    function openNotePicker() {
      closeAttachPicker();
      S.pickerMode = 'note';
      root.getElementById('pk-title').textContent = 'Attach Note';
      root.getElementById('pk-search').placeholder = 'Search notes...';
      renderPickerList(getPickerNotesForPanelRuntime(), 'note');
      pickerOverlay.classList.remove('hidden');
      writePanelStateSyncForPanelRuntime({ pickerOpen: true, pickerMode: 'note' });
    }

    function openChatPicker() {
      closeAttachPicker();
      S.pickerMode = 'chat';
      root.getElementById('pk-title').textContent = 'Attach Chat Summary';
      root.getElementById('pk-search').placeholder = 'Search chats...';
      renderPickerList(getPickerChatsForPanelRuntime(), 'chat');
      pickerOverlay.classList.remove('hidden');
      writePanelStateSyncForPanelRuntime({ pickerOpen: true, pickerMode: 'chat' });
    }

    function renderPickerList(items, type) {
      const list = root.getElementById('pk-list');
      if (pickerObserverForPanelRuntime) {
        pickerObserverForPanelRuntime.disconnect();
        pickerObserverForPanelRuntime = null;
      }
      pickerCurrentItemsForPanelRuntime = items;
      pickerCurrentTypeForPanelRuntime = type;
      pickerRenderedCountForPanelRuntime = 0;
      list.innerHTML = '';
      renderNextPickerPageForPanelRuntime();
      if (pickerRenderedCountForPanelRuntime < items.length) {
        setupPickerSentinelForPanelRuntime(list);
      }
    }

    function selectPickerItem(item, type) {
      addInputChipForPanelRuntime({
        type: type,
        label: String(item.title || ''),
        content: '',
        refId: item.id,
        kind: type,
        preview: String(item.excerpt || '')
      });
      closePickerModal();
    }

    /* ============================================================
      ATTACHMENT PREVIEW MODAL
    ============================================================ */
    async function previewInputChipForPanelRuntime(chipNodeForPanelRuntime) {
      if (!chipNodeForPanelRuntime) return;
      const chipNameForPanelRuntime = chipNodeForPanelRuntime.dataset.attachName || 'Attachment';
      const previewPayloadForPanelRuntime = await resolveChipPreviewPayloadForPanelRuntime(chipNodeForPanelRuntime);
      openAttachmentPreview(chipNameForPanelRuntime, previewPayloadForPanelRuntime);
    }

    async function previewMessageChipForPanelRuntime(messageIdForPanelRuntime, chipIndexForPanelRuntime) {
      const numericMessageIdForPanelRuntime = Number(messageIdForPanelRuntime);
      const numericChipIndexForPanelRuntime = Number(chipIndexForPanelRuntime);
      if (!Number.isFinite(numericMessageIdForPanelRuntime) || !Number.isFinite(numericChipIndexForPanelRuntime)) return;
      const messageForPanelRuntime = getMsgById(numericMessageIdForPanelRuntime);
      if (!messageForPanelRuntime || !Array.isArray(messageForPanelRuntime.chips)) return;
      const chipForPanelRuntime = messageForPanelRuntime.chips[numericChipIndexForPanelRuntime];
      if (!chipForPanelRuntime) return;
      const chipNameForPanelRuntime = String(chipForPanelRuntime.label || chipForPanelRuntime.name || 'Attachment');
      const previewPayloadForPanelRuntime = await resolveChipPreviewPayloadForPanelRuntime(chipForPanelRuntime);
      openAttachmentPreview(chipNameForPanelRuntime, previewPayloadForPanelRuntime);
    }

    function openAttachmentPreview(name, payloadForPanelRuntime) {
      const overlay = root.getElementById('attach-preview-overlay');
      const host = root.getElementById('panel-host');
      overlay.dataset.theme = host ? (host.dataset.theme || 'light') : 'light';
      root.getElementById('ap-title').textContent = name;
      const apContentEl = root.getElementById('ap-content');
      const normalizedPayloadForPanelRuntime = payloadForPanelRuntime && typeof payloadForPanelRuntime === 'object' && !Array.isArray(payloadForPanelRuntime)
        ? payloadForPanelRuntime
        : { previewType: 'markdown', content: String(payloadForPanelRuntime || '') };
      apContentEl.innerHTML = '';
      if (normalizedPayloadForPanelRuntime.previewType === 'image' && normalizedPayloadForPanelRuntime.dataUrl) {
        const imageNodeForPanelRuntime = document.createElement('img');
        imageNodeForPanelRuntime.className = 'ap-image-preview';
        imageNodeForPanelRuntime.src = String(normalizedPayloadForPanelRuntime.dataUrl || '');
        imageNodeForPanelRuntime.alt = String(name || 'Attachment image');
        apContentEl.appendChild(imageNodeForPanelRuntime);
      } else if (normalizedPayloadForPanelRuntime.previewType === 'code') {
        const preNodeForPanelRuntime = document.createElement('pre');
        preNodeForPanelRuntime.className = 'ap-code-preview';
        const codeNodeForPanelRuntime = document.createElement('code');
        codeNodeForPanelRuntime.textContent = String(normalizedPayloadForPanelRuntime.content || '');
        preNodeForPanelRuntime.appendChild(codeNodeForPanelRuntime);
        apContentEl.appendChild(preNodeForPanelRuntime);
      } else if (normalizedPayloadForPanelRuntime.previewType === 'text') {
        const textNodeForPanelRuntime = document.createElement('pre');
        textNodeForPanelRuntime.className = 'ap-plain-text';
        textNodeForPanelRuntime.style.whiteSpace = 'pre-wrap';
        textNodeForPanelRuntime.style.wordBreak = 'break-word';
        textNodeForPanelRuntime.textContent = String(normalizedPayloadForPanelRuntime.content || '');
        apContentEl.appendChild(textNodeForPanelRuntime);
      } else {
        apContentEl.innerHTML = renderNoteMarkdown(String(normalizedPayloadForPanelRuntime.content || ''));
        hydrateRenderedMarkdownForPanelRuntime(apContentEl);
      }
      overlay.classList.remove('hidden');
    }

    function closeAttachPreview() {
      root.getElementById('attach-preview-overlay').classList.add('hidden');
      writePanelStateSyncForPanelRuntime({ attachPreviewOpen: false });
    }

    // Close on backdrop click
    root.getElementById('attach-preview-overlay').addEventListener('click', function(e) {
      if (e.target === this) closeAttachPreview();
    });

    function closePickerModal() {
      pickerOverlay.classList.add('hidden');
      S.pickerMode = null;
      if (pickerObserverForPanelRuntime) {
        pickerObserverForPanelRuntime.disconnect();
        pickerObserverForPanelRuntime = null;
      }
      writePanelStateSyncForPanelRuntime({ pickerOpen: false, pickerMode: null });
    }


    pickerOverlay.addEventListener('click', e => {
      if (e.target === pickerOverlay) closePickerModal();
    });

    /* ============================================================
      INLINE CHAT
    ============================================================ */

    function getInlineSnippetTextForPanelRuntime() {
      const snippetNodeForPanelRuntime = root.querySelector('#inline-overlay .im-snippet');
      if (!snippetNodeForPanelRuntime) return '';
      if (snippetNodeForPanelRuntime.dataset && snippetNodeForPanelRuntime.dataset.selectedText) {
        return String(snippetNodeForPanelRuntime.dataset.selectedText || '').trim();
      }
      const textForPanelRuntime = String(snippetNodeForPanelRuntime.textContent || '').trim();
      if (!textForPanelRuntime) return '';
      const normalizedForPanelRuntime = textForPanelRuntime.replace(/^Selected text\s*/i, '').trim();
      return normalizedForPanelRuntime.replace(/^"|"$/g, '').trim();
    }

    function openInlineChat() {
      S.inlineMessages = [];
      S.inlineChatId = null;
      const conv = root.getElementById('im-conversation');
      const ta = root.getElementById('im-ta');
      conv.innerHTML = '';
      conv.classList.add('empty');
      if (!(ta.value || '').trim()) {
        ta.value = 'What should I understand about this?';
      }
      updateAutoExpandForTextareaForPanelRuntime(ta);
      root.getElementById('im-send-btn').textContent = 'Ask';
      root.getElementById('im-send-btn').innerHTML = 'Ask ' + ic.send12;
      overlay.classList.remove('hidden');
    }
    globalScopeForPanelRuntime.openInlineChat = openInlineChat;

    function closeInlineChat() {
      overlay.classList.add('hidden');
      const panelNsForInlineCloseForPanelRuntime =
        globalThis.ABChatContent && globalThis.ABChatContent.ui && globalThis.ABChatContent.ui.panel;
      if (panelNsForInlineCloseForPanelRuntime && typeof panelNsForInlineCloseForPanelRuntime.restoreAfterInlineChatOnly === 'function') {
        panelNsForInlineCloseForPanelRuntime.restoreAfterInlineChatOnly();
      }
    }

    async function sendInlineMessage() {
      if (S.inlineWaiting) return;
      const ta = root.getElementById('im-ta');
      const text = ta.value.trim();
      if (!text) return;

      const conv = root.getElementById('im-conversation');
      conv.classList.remove('empty');

      // Add user message
      const userMsg = document.createElement('div');
      userMsg.className = 'im-msg user';
      userMsg.textContent = text;
      conv.appendChild(userMsg);
      ta.value = '';
      updateAutoExpandForTextareaForPanelRuntime(ta);
      ta.placeholder = 'Follow-up question...';

      // Update send button label after first exchange
      const sendBtn = root.getElementById('im-send-btn');
      sendBtn.innerHTML = 'Send ' + ic.send12;

      // Show loading bubble
      const loader = document.createElement('div');
      loader.className = 'im-msg-loading';
      loader.innerHTML = '<div class="ld"></div><div class="ld"></div><div class="ld"></div>';
      conv.appendChild(loader);
      conv.scrollTop = conv.scrollHeight;

      S.inlineWaiting = true;
      const modelSelectForInline = root.querySelector('.model-select');
      const modelForInline = (modelSelectForInline && modelSelectForInline.value) ? modelSelectForInline.value : DEFAULT_MODEL_FOR_PANEL_RUNTIME;
      const snippetForInline = getInlineSnippetTextForPanelRuntime();
      const apiKeyForInline = await getApiKeyForPanelRuntime();
      if (!apiKeyForInline) {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
        const systemMsgForInline = document.createElement('div');
        systemMsgForInline.className = 'im-msg asst';
        systemMsgForInline.textContent = 'No API key set. Please add your OpenRouter API key in Settings.';
        conv.appendChild(systemMsgForInline);
        conv.scrollTop = conv.scrollHeight;
        S.inlineWaiting = false;
        return;
      }

      const isFirstInlineMessageForPanelRuntime = S.inlineMessages.length === 0;
      if (!S.inlineChatId) {
        const inlineChatDateForPanelRuntime = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        S.inlineChatId = await createNewChatForPanelRuntime('Quick Questions \u00b7 ' + inlineChatDateForPanelRuntime, { chatType: 'quickq', isPinned: false });
      }
      const quickChatIdForInline = S.inlineChatId;

      // Fetch page content before constructing the message so the chip can be
      // included at construction time (appendMessageToChatForPanelRuntime clones
      // the object, so mutations after the call would not be persisted).
      let pageSnapshotFullContentForInline = '';
      let pageSnapshotChipForInline = null;
      if (isFirstInlineMessageForPanelRuntime) {
        const fcNsForInline = (globalThis.ABChatContent || {}).tools;
        const fcToolForInline = fcNsForInline && fcNsForInline.flattenedContent;
        if (fcToolForInline && typeof fcToolForInline.getFullPageContent === 'function') {
          const fcResultForInline = fcToolForInline.getFullPageContent();
          if (fcResultForInline && fcResultForInline.ok && fcResultForInline.result) {
            pageSnapshotFullContentForInline = fcResultForInline.result;
            pageSnapshotChipForInline = {
              type: 'page-snapshot',
              label: 'Page snapshot',
              content: pageSnapshotFullContentForInline.length > 200000
                ? pageSnapshotFullContentForInline.slice(0, 200000)
                : pageSnapshotFullContentForInline,
              pageUrl: String(location.href || ''),
              pageTitle: String(document.title || '')
            };
          }
        }
      }

      const inlineSelectionChipsForPanelRuntime = (isFirstInlineMessageForPanelRuntime && snippetForInline)
        ? [{ type: 'selection', label: 'Selected text', content: snippetForInline }]
        : [];
      const inlineChipsForPanelRuntime = pageSnapshotChipForInline
        ? inlineSelectionChipsForPanelRuntime.concat([pageSnapshotChipForInline])
        : inlineSelectionChipsForPanelRuntime;

      const userInlineMessageForPanelRuntime = {
        role: 'user',
        content: text,
        md: text,
        chips: inlineChipsForPanelRuntime
      };
      await appendMessageToChatForPanelRuntime(quickChatIdForInline, userInlineMessageForPanelRuntime, {
        persistToDb: false
      });

      const agentNsForInline = globalThis.ABChatAgent || {};
      const clientForInline = agentNsForInline.client || {};
      const contextBuilderForInline = agentNsForInline.contextBuilder || {};
      let inlineInputForModel = (isFirstInlineMessageForPanelRuntime && snippetForInline)
        ? (text + '\n\nSelected text (primary focus):\n' + snippetForInline)
        : text;
      if (pageSnapshotFullContentForInline) {
        inlineInputForModel += '\n\nPage content (background context only):\n' + pageSnapshotFullContentForInline;
      }

      const inlineLogStartTimeForPanelRuntime = Date.now();
      let inlineLogStatusForPanelRuntime = 'success';
      let inlineLogErrorForPanelRuntime = '';
      let inlineLogRequestMsgsForPanelRuntime = null;
      let inlineLogResponseForPanelRuntime = '';
      let inlineLogResolvedModelForPanelRuntime = null;

      S.inlineMessages.push({ role: 'user', content: inlineInputForModel });

      const inlineMemCtxForPanelRuntime = await loadAgentMemoryContextForPanelRuntime();
      const inlineMessagesForPanelRuntime = contextBuilderForInline.build
        ? await contextBuilderForInline.build(S.inlineMessages, {
            agentMemory: inlineMemCtxForPanelRuntime.agentMemory,
            agentMemoryId: inlineMemCtxForPanelRuntime.agentMemoryId,
            agentSkills: inlineMemCtxForPanelRuntime.agentSkills
          })
        : S.inlineMessages.slice();
      let accInlineForPanelRuntime = '';

      try {
        inlineLogRequestMsgsForPanelRuntime = inlineMessagesForPanelRuntime;
        const resultForInline = await clientForInline.streamCompletion({
          model: modelForInline,
          apiKey: apiKeyForInline,
          messages: inlineMessagesForPanelRuntime,
          signal: null,
          onDelta: function (deltaForInline) {
            if (!deltaForInline || deltaForInline.type !== 'text' || !deltaForInline.text) return;
            if (loader.parentNode) loader.parentNode.removeChild(loader);
            accInlineForPanelRuntime += deltaForInline.text;
            let activeAssistantNodeForInline = conv.querySelector('.im-msg.asst[data-inline-streaming="1"]');
            if (!activeAssistantNodeForInline) {
              activeAssistantNodeForInline = document.createElement('div');
              activeAssistantNodeForInline.className = 'im-msg asst';
              activeAssistantNodeForInline.dataset.inlineStreaming = '1';
              conv.appendChild(activeAssistantNodeForInline);
            }
            activeAssistantNodeForInline.innerHTML = renderMarkdown(accInlineForPanelRuntime);
            conv.scrollTop = conv.scrollHeight;
          }
        });
        if (loader.parentNode) loader.parentNode.removeChild(loader);
        const finalInlineTextForPanelRuntime = resultForInline && resultForInline.message && typeof resultForInline.message.content === 'string'
          ? resultForInline.message.content
          : accInlineForPanelRuntime;
        inlineLogResponseForPanelRuntime = finalInlineTextForPanelRuntime || '';
        if (resultForInline && typeof resultForInline.resolvedModel === 'string' && resultForInline.resolvedModel) {
          inlineLogResolvedModelForPanelRuntime = resultForInline.resolvedModel;
        }
        const finalAssistantNodeForInline = conv.querySelector('.im-msg.asst[data-inline-streaming="1"]');
        if (finalAssistantNodeForInline) {
          finalAssistantNodeForInline.removeAttribute('data-inline-streaming');
          finalAssistantNodeForInline.innerHTML = renderMarkdown(finalInlineTextForPanelRuntime || '');
          hydrateRenderedMarkdownForPanelRuntime(finalAssistantNodeForInline);
          addInlineCopyButtonForPanelRuntime(finalAssistantNodeForInline, finalInlineTextForPanelRuntime || '');
        } else {
          const asstMsgForInline = document.createElement('div');
          asstMsgForInline.className = 'im-msg asst';
          asstMsgForInline.innerHTML = renderMarkdown(finalInlineTextForPanelRuntime || '');
          conv.appendChild(asstMsgForInline);
          hydrateRenderedMarkdownForPanelRuntime(asstMsgForInline);
          addInlineCopyButtonForPanelRuntime(asstMsgForInline, finalInlineTextForPanelRuntime || '');
        }
        conv.scrollTop = conv.scrollHeight;
        if (finalInlineTextForPanelRuntime) {
          S.inlineMessages.push({ role: 'assistant', content: finalInlineTextForPanelRuntime });
          await persistPendingUserMessagesForChatForPanelRuntime(quickChatIdForInline, {
            touchChat: false
          });
          await appendMessageToChatForPanelRuntime(quickChatIdForInline, {
            role: 'assistant',
            content: finalInlineTextForPanelRuntime,
            md: finalInlineTextForPanelRuntime
          });
          if (CHAT_STORE_FOR_PANEL_RUNTIME[quickChatIdForInline]) {
            CHAT_STORE_FOR_PANEL_RUNTIME[quickChatIdForInline].lastModel = modelForInline;
          }
          const panelDataRepoForInline = getPanelDataRepoForPanelRuntime();
          if (panelDataRepoForInline && typeof panelDataRepoForInline.updateChat === 'function' && CHAT_STORE_FOR_PANEL_RUNTIME[quickChatIdForInline]) {
            panelDataRepoForInline.updateChat(quickChatIdForInline, {
              summary: getChatSummaryFromMessagesForPanelRuntime(CHAT_STORE_FOR_PANEL_RUNTIME[quickChatIdForInline].messages),
              updatedAt: new Date().toISOString(),
              lastModel: modelForInline
            }).then(function (persistedInlineChatForPanelRuntime) {
              refreshChatStoreFromPersistedForPanelRuntime(persistedInlineChatForPanelRuntime, { prepend: true });
            }).catch(function () {});
          }
        }
      } catch (errorForInline) {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
        const errorAssistantNodeForInline = document.createElement('div');
        errorAssistantNodeForInline.className = 'im-msg asst';
        errorAssistantNodeForInline.textContent = 'Error: ' + (errorForInline && errorForInline.message ? errorForInline.message : 'Unable to send quick question.');
        conv.appendChild(errorAssistantNodeForInline);
        conv.scrollTop = conv.scrollHeight;
        inlineLogStatusForPanelRuntime = 'error';
        inlineLogErrorForPanelRuntime = errorForInline ? (errorForInline.message || 'Unknown error') : 'Unknown error';
      } finally {
        if (quickChatIdForInline) {
          const inlineApiLoggerForPanelRuntime = (globalThis.ABChatContent || {}).apiLogger;
          if (inlineApiLoggerForPanelRuntime && typeof inlineApiLoggerForPanelRuntime.writeLog === 'function') {
            inlineApiLoggerForPanelRuntime.writeLog({
              requestType: 'inline-chat',
              timestamp: new Date(inlineLogStartTimeForPanelRuntime).toISOString(),
              chatId: quickChatIdForInline,
              model: inlineLogResolvedModelForPanelRuntime || modelForInline,
              iterationCount: 1,
              totalLatencyMs: Date.now() - inlineLogStartTimeForPanelRuntime,
              status: inlineLogStatusForPanelRuntime,
              errorMessage: inlineLogErrorForPanelRuntime,
              requestMessages: inlineLogRequestMsgsForPanelRuntime,
              apiParams: { stream: true },
              responseContent: inlineLogResponseForPanelRuntime,
              toolCalls: [],
              turns: [{
                turnIndex: 1,
                latencyMs: Date.now() - inlineLogStartTimeForPanelRuntime,
                requestMessages: sanitizeMessagesForLogDisplay(inlineLogRequestMsgsForPanelRuntime || []),
                responseText: inlineLogResponseForPanelRuntime,
                responseToolCalls: [],
                usage: null
              }],
              usage: null
            }).catch(function () {});
          }
        }
        S.inlineWaiting = false;
        const imTaForAutoFocus = root.getElementById('im-ta');
        if (imTaForAutoFocus) imTaForAutoFocus.focus();
      }
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeInlineChat();
        closePickerModal();
      }
    });

    /* ============================================================
      SEARCH / FILTER
    ============================================================ */

    function filterChatListForPanelRuntime(query) {
      const chatListForFilter = root.querySelector('.chat-list');
      if (!chatListForFilter) return;

      const activeTypeForFilter = S.chatType || 'chats';
      const isQuickQForFilter = activeTypeForFilter === 'quickq';
      const trimmedQueryForFilter = (query || '').trim();

      // Remove any chat items that were force-rendered for a previous search query but fall
      // outside the normal render window. Must run before applying the new filter so stale
      // forced items do not remain visible when the query changes.
      searchForcedChatIdsForPanelRuntime.forEach(function (idForClear) {
        var posForClear = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(idForClear));
        if (posForClear >= renderedChatCountForPanelRuntime) {
          var elForClear = chatListForFilter.querySelector('.chat-item[data-chat-id="' + idForClear + '"]');
          if (elForClear) elForClear.remove();
        }
      });
      searchForcedChatIdsForPanelRuntime.clear();

      if (!trimmedQueryForFilter) {
        chatListForFilter.querySelectorAll('.chat-item').forEach(function (itemForFilter) {
          const itemIsQQForFilter = itemForFilter.dataset.chatType === 'quickq';
          if (itemIsQQForFilter !== isQuickQForFilter) return;
          itemForFilter.style.display = '';
        });
        refreshChatGroupLabelsVisibilityForPanelRuntime();
        return;
      }

      const searchNsForFilter = (globalThis.ABChatShared || {}).search;
      const matchedIdsForFilter = new Set();

      if (searchNsForFilter && typeof searchNsForFilter.search === 'function') {
        searchNsForFilter.search('chats', trimmedQueryForFilter, 200).forEach(function (id) {
          matchedIdsForFilter.add(Number(id));
        });
      } else {
        const lowerForFilter = trimmedQueryForFilter.toLowerCase();
        Object.keys(CHAT_STORE_FOR_PANEL_RUNTIME).forEach(function (id) {
          const chatForFallback = CHAT_STORE_FOR_PANEL_RUNTIME[id];
          const chatContentForFallback = Array.isArray(chatForFallback.messages)
            ? chatForFallback.messages
                .map(function (messageForPanelRuntime) {
                  return String((messageForPanelRuntime && (messageForPanelRuntime.content || messageForPanelRuntime.md)) || '');
                })
                .join('\n')
                .toLowerCase()
            : '';
          if (
            (chatForFallback.title || '').toLowerCase().includes(lowerForFilter) ||
            (chatForFallback.summary || '').toLowerCase().includes(lowerForFilter) ||
            chatContentForFallback.includes(lowerForFilter)
          ) {
            matchedIdsForFilter.add(Number(id));
          }
        });
      }

      // Force-render any matching item that sits beyond the current render window so it
      // appears in search results. Track the ID so it can be cleaned up when query clears.
      matchedIdsForFilter.forEach(function (id) {
        var posForSearch = CHAT_ORDER_FOR_PANEL_RUNTIME.indexOf(id);
        if (posForSearch >= renderedChatCountForPanelRuntime) {
          syncMainChatListItemForPanelRuntime(id, false, true);
          searchForcedChatIdsForPanelRuntime.add(id);
        }
      });

      chatListForFilter.querySelectorAll('.chat-item').forEach(function (itemForFilter) {
        const itemIsQQForFilter = itemForFilter.dataset.chatType === 'quickq';
        if (itemIsQQForFilter !== isQuickQForFilter) return;
        const chatIdForFilter = Number(itemForFilter.dataset.chatId);
        itemForFilter.style.display = matchedIdsForFilter.has(chatIdForFilter) ? '' : 'none';
      });

      refreshChatGroupLabelsVisibilityForPanelRuntime();
    }

    function filterTasksListForPanelRuntime(query) {
      const tasksListForFilter = root.querySelector('.tasks-list');
      if (!tasksListForFilter) return;

      const trimmedQueryForFilter = (query || '').trim();
      const activeFilterForTasks = S.taskFilter || 'all';

      searchForcedTaskIdsForPanelRuntime.forEach(function (idForClear) {
        var posForClear = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(idForClear));
        if (posForClear >= renderedTaskCountForPanelRuntime) {
          var elForClear = tasksListForFilter.querySelector('.task-item[data-task-id="' + idForClear + '"]');
          if (elForClear) elForClear.remove();
        }
      });
      searchForcedTaskIdsForPanelRuntime.clear();

      // Build set of ids matching the search query (all ids if no query).
      let matchedIdsForFilter = null; // null means "no search constraint"
      if (trimmedQueryForFilter) {
        matchedIdsForFilter = new Set();
        const searchNsForFilter = (globalThis.ABChatShared || {}).search;
        if (searchNsForFilter && typeof searchNsForFilter.search === 'function') {
          searchNsForFilter.search('tasks', trimmedQueryForFilter, 200).forEach(function (id) {
            matchedIdsForFilter.add(Number(id));
          });
        } else {
          const lowerForFilter = trimmedQueryForFilter.toLowerCase();
          Object.keys(TASK_STORE_FOR_PANEL_RUNTIME).forEach(function (id) {
            const taskForFallback = TASK_STORE_FOR_PANEL_RUNTIME[id];
            if (
              (taskForFallback.title || '').toLowerCase().includes(lowerForFilter) ||
              (taskForFallback.body || '').toLowerCase().includes(lowerForFilter)
            ) {
              matchedIdsForFilter.add(Number(id));
            }
          });
        }

        matchedIdsForFilter.forEach(function (id) {
          var posForTaskSearch = TASK_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(id));
          if (posForTaskSearch >= renderedTaskCountForPanelRuntime) {
            syncMainTaskListItemForPanelRuntime(id, false, true);
            searchForcedTaskIdsForPanelRuntime.add(id);
          }
        });
      }

      tasksListForFilter.querySelectorAll('.task-item').forEach(function (itemForFilter) {
        const doneForFilter = itemForFilter.dataset.completed === 'true';
        const passesFilterForFilter =
          activeFilterForTasks === 'all' ||
          (activeFilterForTasks === 'pending' && !doneForFilter) ||
          (activeFilterForTasks === 'completed' && doneForFilter);
        const passesSearchForFilter =
          matchedIdsForFilter === null ||
          matchedIdsForFilter.has(Number(itemForFilter.dataset.taskId));
        itemForFilter.style.display = (passesFilterForFilter && passesSearchForFilter) ? '' : 'none';
      });
    }

    function filterNotesListForPanelRuntime(query) {
      const notesListForFilter = root.querySelector('.notes-list');
      if (!notesListForFilter) return;

      const trimmedQueryForFilter = (query || '').trim();

      searchForcedNoteIdsForPanelRuntime.forEach(function (idForClear) {
        var posForClear = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(idForClear));
        if (posForClear >= renderedNoteCountForPanelRuntime) {
          var elForClear = notesListForFilter.querySelector('.note-item[data-note-id="' + idForClear + '"]');
          if (elForClear) elForClear.remove();
        }
      });
      searchForcedNoteIdsForPanelRuntime.clear();

      if (!trimmedQueryForFilter) {
        notesListForFilter.querySelectorAll('.note-item').forEach(function (itemForFilter) { itemForFilter.style.display = ''; });
        return;
      }

      const searchNsForFilter = (globalThis.ABChatShared || {}).search;
      const matchedIdsForFilter = new Set();

      if (searchNsForFilter && typeof searchNsForFilter.search === 'function') {
        searchNsForFilter.search('notes', trimmedQueryForFilter, 200).forEach(function (id) {
          matchedIdsForFilter.add(Number(id));
        });
      } else {
        const lowerForFilter = trimmedQueryForFilter.toLowerCase();
        Object.keys(NOTE_STORE_FOR_PANEL_RUNTIME).forEach(function (id) {
          const noteForFallback = NOTE_STORE_FOR_PANEL_RUNTIME[id];
          if (
            (noteForFallback.title || '').toLowerCase().includes(lowerForFilter) ||
            (noteForFallback.body || '').toLowerCase().includes(lowerForFilter)
          ) {
            matchedIdsForFilter.add(Number(id));
          }
        });
      }

      matchedIdsForFilter.forEach(function (id) {
        var posForNoteSearch = NOTE_ORDER_FOR_PANEL_RUNTIME.indexOf(Number(id));
        if (posForNoteSearch >= renderedNoteCountForPanelRuntime) {
          syncMainNoteListItemForPanelRuntime(id, false, true);
          searchForcedNoteIdsForPanelRuntime.add(id);
        }
      });

      notesListForFilter.querySelectorAll('.note-item').forEach(function (itemForFilter) {
        const noteIdForFilter = Number(itemForFilter.dataset.noteId);
        itemForFilter.style.display = matchedIdsForFilter.has(noteIdForFilter) ? '' : 'none';
      });
    }

    function applySearchInputMirrorForPanelRuntime(inputIdForMirror, queryForMirror, filterFnForMirror) {
      const inputForMirror = root.getElementById(inputIdForMirror);
      if (!inputForMirror) return;
      const valueForMirror = typeof queryForMirror === 'string' ? queryForMirror : '';
      if (inputForMirror.value !== valueForMirror) {
        inputForMirror.value = valueForMirror;
        const wrapForMirror = inputForMirror.closest('.sidebar-search,.ns-search,.task-search');
        if (wrapForMirror) wrapForMirror.classList.toggle('has-value', valueForMirror.length > 0);
      }
      if (typeof filterFnForMirror === 'function') filterFnForMirror(valueForMirror);
    }

    // Re-apply whichever search input is active for the given list type. Called at the
    // tail of each store-refresh branch so a re-render (which resets chat-item display
    // via syncMainChatListItem) doesn't strand the user with an unfiltered list when
    // the search input still holds a query.
    function reapplyActiveSearchForListTypeForPanelRuntime(listTypeForReapply) {
      const inputIdForReapply =
        listTypeForReapply === 'chats' ? 'chat-search-input' :
        listTypeForReapply === 'notes' ? 'notes-search-input' :
        listTypeForReapply === 'tasks' ? 'task-search-input' : null;
      if (!inputIdForReapply) return;
      const inputForReapply = root.getElementById(inputIdForReapply);
      if (!inputForReapply) return;
      const queryForReapply = inputForReapply.value || '';
      if (listTypeForReapply === 'chats') filterChatListForPanelRuntime(queryForReapply);
      else if (listTypeForReapply === 'notes') filterNotesListForPanelRuntime(queryForReapply);
      else if (listTypeForReapply === 'tasks') filterTasksListForPanelRuntime(queryForReapply);
    }

    function setChatSearchQueryForMirrorForPanelRuntime(queryForMirror) {
      applySearchInputMirrorForPanelRuntime('chat-search-input', queryForMirror, filterChatListForPanelRuntime);
    }

    function setNotesSearchQueryForMirrorForPanelRuntime(queryForMirror) {
      applySearchInputMirrorForPanelRuntime('notes-search-input', queryForMirror, filterNotesListForPanelRuntime);
    }

    function setTaskSearchQueryForMirrorForPanelRuntime(queryForMirror) {
      applySearchInputMirrorForPanelRuntime('task-search-input', queryForMirror, filterTasksListForPanelRuntime);
    }

    /* ============================================================
      AGENTIC CHAT SEND
    ============================================================ */

    const SELECTED_IMAGE_MODEL_KEY_FOR_PANEL_RUNTIME = 'abchat_selected_image_model';

    const FALLBACK_IMAGE_MODELS_FOR_PANEL_RUNTIME = [
      { id: 'google/gemini-3.1-flash-lite-preview',  name: 'Gemini 3.1 Flash Lite Preview',  created: 0 },
      { id: 'openai/gpt-image-1',                    name: 'GPT Image 1',                    created: 0 },
      { id: 'google/imagen-4.0-generate-001',        name: 'Imagen 4',                       created: 0 },
      { id: 'google/imagen-4.0-ultra-generate-001',  name: 'Imagen 4 Ultra',                 created: 0 },
    ];

    const IMAGE_MODEL_PROVIDER_ORDER_FOR_PANEL_RUNTIME = ['openai', 'google', 'stability', 'fal-ai', 'black-forest-labs'];

    const FALLBACK_MODELS_FOR_PANEL_RUNTIME = {
      google: [
        { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview' },
      ],
      openai: [
        // { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano' },
        { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      ],
      anthropic: [
        { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
      ],
      'meta-llama': [
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
      ],
    };
    const DEFAULT_MODEL_FOR_PANEL_RUNTIME = 'google/gemini-3.1-flash-lite-preview';
    var loadedGlobalDefaultModelForPanelRuntime = '';
    var loadedImageModelsForPanelRuntime = [];
    const MODEL_CACHE_KEY_FOR_PANEL_RUNTIME = 'abchat_model_cache_v8';
    const ROUTER_EXCEPTION_MODEL_IDS_FOR_PANEL_RUNTIME = ['openrouter/auto', 'openrouter/free'];
    const THEME_KEY_FOR_PANEL_RUNTIME = 'abchat_theme';
    const INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME = 'abchat_input_draft';
    const NOTE_DRAFT_SYNC_KEY_PREFIX_FOR_PANEL_RUNTIME = 'abchat_note_draft_sync:';
    var currentAgentRulesForPanelRuntime = '';
    var currentAgentRulesUpdatedAtForPanelRuntime = 0;
    var currentReminderLeadTimeForPanelRuntime = 15;
    var noteDraftSyncSourceIdForPanelRuntime = '';
    var noteDraftApplyingForPanelRuntime = false;
    var noteDraftStorageSyncListenerForPanelRuntime = null;
    var noteDraftSyncTimersForPanelRuntime = {};
    const SELECTED_MODEL_KEY_FOR_PANEL_RUNTIME = 'abchat_selected_model';
    const MODEL_CACHE_TTL_MS_FOR_PANEL_RUNTIME = 6 * 60 * 60 * 1000;
    const COMPLETION_COST_WARNING_THRESHOLD_PER_MILLION_FOR_PANEL_RUNTIME = 3;

    function getDefaultModelForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([SELECTED_MODEL_KEY_FOR_PANEL_RUNTIME], function (res) {
            resolve((res && res[SELECTED_MODEL_KEY_FOR_PANEL_RUNTIME]) ? res[SELECTED_MODEL_KEY_FOR_PANEL_RUNTIME] : DEFAULT_MODEL_FOR_PANEL_RUNTIME);
          });
        } catch (e) {
          resolve(DEFAULT_MODEL_FOR_PANEL_RUNTIME);
        }
      });
    }

    function saveDefaultModelForPanelRuntime(modelId) {
      loadedGlobalDefaultModelForPanelRuntime = modelId;
      return new Promise(function (resolve) {
        try {
          const dataForModel = {};
          dataForModel[SELECTED_MODEL_KEY_FOR_PANEL_RUNTIME] = modelId;
          chrome.storage.local.set(dataForModel, function () { resolve(); });
        } catch (e) {
          resolve();
        }
      });
    }

    function filterChatModelsForPanelRuntime(rawModels) {
      const filtered = rawModels.filter(function (m) {
        const modelId = typeof m.id === 'string' ? m.id : '';
        if (ROUTER_EXCEPTION_MODEL_IDS_FOR_PANEL_RUNTIME.includes(modelId)) return true;
        const hasTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools');
        const arch = m.architecture || {};
        const hasImageInput = Array.isArray(arch.input_modalities) && arch.input_modalities.includes('image');
        const outputModalities = Array.isArray(arch.output_modalities) ? arch.output_modalities.filter(Boolean) : [];
        const hasTextOnlyOutput = outputModalities.length > 0 && outputModalities.every(function (mod) { return mod === 'text'; });
        return hasTools && hasImageInput && hasTextOnlyOutput;
      });
      filtered.sort(function (a, b) { return (a.name || a.id || '').localeCompare(b.name || b.id || ''); });
      return filtered.map(function (m) {
        const pricing = m.pricing || {};
        const costRaw = Number(pricing.completion);
        const costPerMillion = Number.isFinite(costRaw) ? (costRaw * 1000000) : null;
        return { id: m.id, name: m.name || m.id, completionCostPerMillion: costPerMillion, created: m.created || 0 };
      }).filter(function (m) {
        if (ROUTER_EXCEPTION_MODEL_IDS_FOR_PANEL_RUNTIME.includes(m.id)) return true;
        return m.completionCostPerMillion !== null && m.completionCostPerMillion >= 1;
      });
    }

    function filterImageModelsForPanelRuntime(rawModels) {
      return rawModels.filter(function (m) {
        const arch = m.architecture || {};
        const outputModalities = Array.isArray(arch.output_modalities) ? arch.output_modalities.filter(Boolean) : [];
        const inputModalities = Array.isArray(arch.input_modalities) ? arch.input_modalities.filter(Boolean) : [];
        return outputModalities.includes('image') && inputModalities.includes('image');
      }).map(function (m) {
        const pricing = m.pricing || {};
        const imageCostRaw = Number(pricing.image);
        const completionCostRaw = Number(pricing.completion);
        const completionCostPerMillion = Number.isFinite(completionCostRaw) ? (completionCostRaw * 1000000) : null;
        return { id: m.id, name: m.name || m.id, imageCost: Number.isFinite(imageCostRaw) ? imageCostRaw : null, completionCostPerMillion: completionCostPerMillion, created: m.created || 0 };
      });
    }

    function getCachedModelsForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([MODEL_CACHE_KEY_FOR_PANEL_RUNTIME], function (res) {
            const entry = res && res[MODEL_CACHE_KEY_FOR_PANEL_RUNTIME];
            if (!entry || !Array.isArray(entry.chatModels) || !entry.ts) { resolve(null); return; }
            if (Date.now() - entry.ts > MODEL_CACHE_TTL_MS_FOR_PANEL_RUNTIME) { resolve(null); return; }
            resolve({ chatModels: entry.chatModels, imageModels: entry.imageModels || [] });
          });
        } catch (e) {
          resolve(null);
        }
      });
    }

    function clearCachedModelsForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.remove([MODEL_CACHE_KEY_FOR_PANEL_RUNTIME], function () { resolve(); });
        } catch (e) {
          resolve();
        }
      });
    }

    function saveCachedModelsForPanelRuntime(chatModels, imageModels) {
      return new Promise(function (resolve) {
        try {
          const entry = { chatModels: chatModels, imageModels: imageModels || [], ts: Date.now() };
          const dataForCache = {};
          dataForCache[MODEL_CACHE_KEY_FOR_PANEL_RUNTIME] = entry;
          chrome.storage.local.set(dataForCache, function () { resolve(); });
        } catch (e) {
          resolve();
        }
      });
    }

    function getStaleCachedModelsForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([MODEL_CACHE_KEY_FOR_PANEL_RUNTIME], function (res) {
            const entry = res && res[MODEL_CACHE_KEY_FOR_PANEL_RUNTIME];
            if (!entry || !Array.isArray(entry.chatModels) || entry.chatModels.length === 0) { resolve(null); return; }
            resolve({ chatModels: entry.chatModels, imageModels: entry.imageModels || [] });
          });
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function getAllModelsForPanelRuntime(apiKey) {
      const cached = await getCachedModelsForPanelRuntime();
      if (cached) return cached;
      if (apiKey) {
        try {
          const agentNsForModels = globalThis.ABChatAgent || {};
          const clientForModels = agentNsForModels.client || {};
          if (typeof clientForModels.fetchRawModels === 'function') {
            const rawModels = await clientForModels.fetchRawModels(apiKey);
            if (Array.isArray(rawModels) && rawModels.length > 0) {
              const chatModels = filterChatModelsForPanelRuntime(rawModels);
              const imageModels = filterImageModelsForPanelRuntime(rawModels);
              await saveCachedModelsForPanelRuntime(chatModels, imageModels);
              return { chatModels, imageModels };
            }
          }
        } catch (e) {
          const stale = await getStaleCachedModelsForPanelRuntime();
          if (stale) return stale;
        }
      }
      return {
        chatModels: Object.values(FALLBACK_MODELS_FOR_PANEL_RUNTIME).flat(),
        imageModels: FALLBACK_IMAGE_MODELS_FOR_PANEL_RUNTIME
      };
    }

    function getModelProviderKeyForPanelRuntime(model) {
      if (!model || typeof model.id !== 'string') return 'other';
      const modelIdParts = model.id.split('/');
      const providerKey = (modelIdParts[0] || '').trim().toLowerCase();
      return providerKey || 'other';
    }

    function getModelProviderLabelForPanelRuntime(providerKey) {
      const providerLabelsForPanelRuntime = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        google: 'Google',
        meta: 'Meta',
        'meta-llama': 'Meta',
        mistralai: 'Mistral',
        xai: 'xAI',
        'x-ai': 'xAI'
      };
      if (providerLabelsForPanelRuntime[providerKey]) return providerLabelsForPanelRuntime[providerKey];
      const labelWords = String(providerKey || 'other')
        .split(/[-_]+/)
        .filter(Boolean)
        .map(function (wordForLabel) {
          return wordForLabel.charAt(0).toUpperCase() + wordForLabel.slice(1);
        });
      return labelWords.length > 0 ? labelWords.join(' ') : 'Other';
    }

    function isExpensiveModelForPanelRuntime(modelForPricing) {
      const completionCostPerMillionForModel = Number(modelForPricing && modelForPricing.completionCostPerMillion);
      return Number.isFinite(completionCostPerMillionForModel) && completionCostPerMillionForModel > COMPLETION_COST_WARNING_THRESHOLD_PER_MILLION_FOR_PANEL_RUNTIME;
    }

    function getModelTierForPanelRuntime(m) {
      const cost = Number(m && m.completionCostPerMillion);
      if (!Number.isFinite(cost) || cost <= 0) return null;
      if (cost <= 1.5) return { label: 'Cheap', cls: 'mp-tier-cheap' };
      if (cost <= 3) return { label: 'Standard', cls: 'mp-tier-mid' };
      return { label: 'Expensive', cls: 'mp-tier-expensive' };
    }

    function getImageModelTierForPanelRuntime(m) {
      const cost = Number(m && m.completionCostPerMillion);
      if (!Number.isFinite(cost) || cost <= 0) return null;
      if (cost < 5) return { label: 'Cheap', cls: 'mp-tier-cheap' };
      if (cost <= 10) return { label: 'Standard', cls: 'mp-tier-mid' };
      return { label: 'Expensive', cls: 'mp-tier-expensive' };
    }

    function getModelDisplayNameForPanelRuntime(modelForDisplay, providerKeyForDisplay) {
      const rawModelNameForDisplay = String((modelForDisplay && modelForDisplay.name) || (modelForDisplay && modelForDisplay.id) || '');
      const providerLabelForDisplay = getModelProviderLabelForPanelRuntime(providerKeyForDisplay);
      const providerPrefixForDisplay = providerLabelForDisplay + ': ';
      if (rawModelNameForDisplay.indexOf(providerPrefixForDisplay) === 0) {
        const trimmedNameForDisplay = rawModelNameForDisplay.slice(providerPrefixForDisplay.length).trim();
        if (trimmedNameForDisplay) return trimmedNameForDisplay;
      }
      return rawModelNameForDisplay;
    }

    function pickRepresentativeModelsForProvider(modelsForProvider) {
      const alwaysIncluded = modelsForProvider.filter(function (m) {
        return m.id === 'openrouter/auto' || m.id === 'openrouter/free';
      });
      const rest = modelsForProvider.filter(function (m) {
        return m.id !== 'openrouter/auto' && m.id !== 'openrouter/free';
      });
      const cheapModels = rest.filter(function (m) { return !isExpensiveModelForPanelRuntime(m); });
      const expensiveModels = rest.filter(function (m) { return isExpensiveModelForPanelRuntime(m); });

      const picked = [];

      if (cheapModels.length > 0) {
        const cheapByRecency = cheapModels.slice().sort(function (a, b) {
          return Number(b.created) - Number(a.created);
        });
        const recentCheapPool = cheapByRecency.slice(0, 3);
        recentCheapPool.sort(function (a, b) {
          return Number(b.completionCostPerMillion) - Number(a.completionCostPerMillion);
        });
        picked.push(recentCheapPool[0]);
      }

      if (expensiveModels.length > 0) {
        const expensiveByRecency = expensiveModels.slice().sort(function (a, b) {
          return Number(b.created) - Number(a.created);
        });
        const recentExpensivePool = expensiveByRecency.slice(0, 5);
        recentExpensivePool.sort(function (a, b) {
          return Number(a.completionCostPerMillion) - Number(b.completionCostPerMillion);
        });
        const midIndexForExpensive = Math.floor((recentExpensivePool.length - 1) / 2);
        picked.push(recentExpensivePool[midIndexForExpensive]);
      }

      return alwaysIncluded.concat(picked);
    }

    function populateModelSelectsForPanelRuntime(models, selectedId) {
      const chatSelect = root.getElementById('chat-model-select');
      const settingsSelect = root.getElementById('settings-default-model-select');
      const normalizedModels = Array.isArray(models) ? models : [];
      const modelsByProvider = {};
      normalizedModels.forEach(function (modelForGrouping) {
        const providerKeyForModel = getModelProviderKeyForPanelRuntime(modelForGrouping);
        if (!Array.isArray(modelsByProvider[providerKeyForModel])) modelsByProvider[providerKeyForModel] = [];
        modelsByProvider[providerKeyForModel].push(modelForGrouping);
      });
      const allowedProviderOrderForPanelRuntime = ['google', 'openai', 'openrouter', 'meta-llama', 'meta', 'anthropic', 'qwen', 'xai', 'x-ai', 'z-ai'];
      const providerKeys = Object.keys(modelsByProvider)
        .filter(function (k) { return allowedProviderOrderForPanelRuntime.includes(k); })
        .sort(function (a, b) {
          return allowedProviderOrderForPanelRuntime.indexOf(a) - allowedProviderOrderForPanelRuntime.indexOf(b);
        });

      const allPickedIds = new Set();
      const pickedByProvider = {};
      providerKeys.forEach(function (providerKeyForGroup) {
        const picked = pickRepresentativeModelsForProvider(modelsByProvider[providerKeyForGroup]);
        pickedByProvider[providerKeyForGroup] = picked;
        picked.forEach(function (m) { allPickedIds.add(m.id); });
      });

      const priorityIdsByProvider = {};
      providerKeys.forEach(function (providerKeyForGroup) {
        const priorityEntries = FALLBACK_MODELS_FOR_PANEL_RUNTIME[providerKeyForGroup] || [];
        const priorityIds = priorityEntries.map(function (e) { return e.id; });
        priorityIdsByProvider[providerKeyForGroup] = priorityIds;
        const apiModelsForProvider = modelsByProvider[providerKeyForGroup] || [];
        const apiModelById = {};
        apiModelsForProvider.forEach(function (m) { apiModelById[m.id] = m; });
        const toPrepend = [];
        priorityIds.forEach(function (priorityId) {
          if (apiModelById[priorityId] && !allPickedIds.has(priorityId)) {
            toPrepend.push(apiModelById[priorityId]);
            allPickedIds.add(priorityId);
          }
        });
        if (toPrepend.length > 0) {
          pickedByProvider[providerKeyForGroup] = toPrepend.concat(pickedByProvider[providerKeyForGroup]);
        }
      });

      const resolvedSelectedId = allPickedIds.has(selectedId) ? selectedId : DEFAULT_MODEL_FOR_PANEL_RUNTIME;
      const effectiveSelected = resolvedSelectedId || DEFAULT_MODEL_FOR_PANEL_RUNTIME;

      [chatSelect, settingsSelect].forEach(function (sel) {
        if (!sel) return;
        sel.innerHTML = '';
        providerKeys.forEach(function (providerKeyForGroup) {
          const pickedForGroup = pickedByProvider[providerKeyForGroup];
          if (!pickedForGroup || pickedForGroup.length === 0) return;
          const optgroupForModels = document.createElement('optgroup');
          optgroupForModels.label = getModelProviderLabelForPanelRuntime(providerKeyForGroup);
          const priorityIdsForGroup = priorityIdsByProvider[providerKeyForGroup] || [];
          const pinnedModelsForGroup = pickedForGroup.filter(function (m) { return priorityIdsForGroup.includes(m.id); });
          const nonPinnedModelsForGroup = pickedForGroup.filter(function (m) { return !priorityIdsForGroup.includes(m.id); });
          nonPinnedModelsForGroup.sort(function (a, b) {
            return Number(a.completionCostPerMillion) - Number(b.completionCostPerMillion);
          });
          const sortedPickedForGroup = pinnedModelsForGroup.concat(nonPinnedModelsForGroup);
          sortedPickedForGroup.forEach(function (m) {
            const opt = document.createElement('option');
            opt.value = m.id;
            const tierForOption = getModelTierForPanelRuntime(m);
            const tierSuffixForOption = tierForOption ? ' -- [' + tierForOption.label + ']' : '';
            const modelDisplayNameForOption = getModelDisplayNameForPanelRuntime(m, providerKeyForGroup);
            opt.textContent = modelDisplayNameForOption + tierSuffixForOption;
            if (m.id === effectiveSelected) opt.selected = true;
            optgroupForModels.appendChild(opt);
          });
          sel.appendChild(optgroupForModels);
        });
      });

      buildModelPickerDropdownForPanelRuntime(
        pickedByProvider,
        providerKeys,
        effectiveSelected,
        getModelProviderLabelForPanelRuntime,
        isExpensiveModelForPanelRuntime,
        getModelDisplayNameForPanelRuntime,
        getModelProviderKeyForPanelRuntime
      );
      syncModelPickerLabelForPanelRuntime();
    }

    function getImageModelForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get([SELECTED_IMAGE_MODEL_KEY_FOR_PANEL_RUNTIME], function (res) {
            resolve((res && res[SELECTED_IMAGE_MODEL_KEY_FOR_PANEL_RUNTIME]) ? res[SELECTED_IMAGE_MODEL_KEY_FOR_PANEL_RUNTIME] : '');
          });
        } catch (e) {
          resolve('');
        }
      });
    }

    function saveImageModelForPanelRuntime(modelId) {
      return new Promise(function (resolve) {
        try {
          const dataForImageModel = {};
          dataForImageModel[SELECTED_IMAGE_MODEL_KEY_FOR_PANEL_RUNTIME] = modelId;
          chrome.storage.local.set(dataForImageModel, function () { resolve(); });
        } catch (e) {
          resolve();
        }
      });
    }

    function populateImageModelSelectForPanelRuntime(models, selectedId) {
      const sel = root.getElementById('settings-image-model-select');
      if (!sel) return;
      const normalizedForImage = Array.isArray(models) ? models : [];
      const byProviderForImage = {};
      normalizedForImage.forEach(function (m) {
        const key = getModelProviderKeyForPanelRuntime(m);
        if (!Array.isArray(byProviderForImage[key])) byProviderForImage[key] = [];
        byProviderForImage[key].push(m);
      });
      const knownKeys = IMAGE_MODEL_PROVIDER_ORDER_FOR_PANEL_RUNTIME.filter(function (k) { return byProviderForImage[k]; });
      const otherKeys = Object.keys(byProviderForImage).filter(function (k) { return !IMAGE_MODEL_PROVIDER_ORDER_FOR_PANEL_RUNTIME.includes(k); }).sort();
      const orderedKeys = knownKeys.concat(otherKeys);
      const allIds = normalizedForImage.map(function (m) { return m.id; });
      const effectiveSelected = (selectedId && allIds.includes(selectedId)) ? selectedId : '';
      sel.innerHTML = '';
      const placeholderOptForImage = document.createElement('option');
      placeholderOptForImage.value = '';
      placeholderOptForImage.textContent = '-- Choose a model --';
      if (!effectiveSelected) placeholderOptForImage.selected = true;
      sel.appendChild(placeholderOptForImage);
      orderedKeys.forEach(function (providerKey) {
        const group = byProviderForImage[providerKey];
        group.sort(function (a, b) { return Number(b.created || 0) - Number(a.created || 0); });
        const optgroupForImage = document.createElement('optgroup');
        optgroupForImage.label = getModelProviderLabelForPanelRuntime(providerKey);
        group.forEach(function (m) {
          const opt = document.createElement('option');
          opt.value = m.id;
          const tierForImageOption = getImageModelTierForPanelRuntime(m);
          const tierSuffixForImageOption = tierForImageOption ? ' -- [' + tierForImageOption.label + ']' : '';
          opt.textContent = getModelDisplayNameForPanelRuntime(m, providerKey) + tierSuffixForImageOption;
          if (m.id === effectiveSelected) opt.selected = true;
          optgroupForImage.appendChild(opt);
        });
        sel.appendChild(optgroupForImage);
      });
    }

    function getDefaultImageModelIdForPanelRuntime(models) {
      if (!Array.isArray(models) || models.length === 0) return '';
      const cheapGemini = models.filter(function (m) {
        if (!m.id.startsWith('google/') || m.id.indexOf('gemini') === -1) return false;
        const cost = Number(m.completionCostPerMillion);
        return Number.isFinite(cost) && cost > 0 && cost < 5;
      });
      if (cheapGemini.length > 0) {
        cheapGemini.sort(function (a, b) { return Number(b.completionCostPerMillion) - Number(a.completionCostPerMillion); });
        return cheapGemini[0].id;
      }
      const standard = models.filter(function (m) {
        const cost = Number(m.completionCostPerMillion);
        return Number.isFinite(cost) && cost >= 5 && cost <= 10;
      });
      if (standard.length > 0) {
        standard.sort(function (a, b) { return Number(a.completionCostPerMillion) - Number(b.completionCostPerMillion); });
        return standard[0].id;
      }
      const withImageCost = models.filter(function (m) { return Number.isFinite(m.imageCost) && m.imageCost !== null; });
      if (withImageCost.length > 0) {
        withImageCost.sort(function (a, b) { return a.imageCost - b.imageCost; });
        return withImageCost[0].id;
      }
      return models[0].id;
    }

    async function initModelSelectsForPanelRuntime() {
      const apiKey = await getApiKeyForPanelRuntime();
      const { chatModels, imageModels } = await getAllModelsForPanelRuntime(apiKey);
      const selectedModel = await getDefaultModelForPanelRuntime();
      populateModelSelectsForPanelRuntime(chatModels, selectedModel);
      const chatSelectAfterInit = root.getElementById('chat-model-select');
      if (chatSelectAfterInit) loadedGlobalDefaultModelForPanelRuntime = chatSelectAfterInit.value;
      loadedImageModelsForPanelRuntime = imageModels;
      let imageModel = await getImageModelForPanelRuntime();
      if (!imageModel && imageModels.length > 0) {
        imageModel = getDefaultImageModelIdForPanelRuntime(imageModels);
        if (imageModel) await saveImageModelForPanelRuntime(imageModel);
      }
      populateImageModelSelectForPanelRuntime(imageModels, imageModel);
    }

    function getApiKeyForPanelRuntime() {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['abchat_api_key'], function (resultForKey) {
            resolve((resultForKey && resultForKey.abchat_api_key) ? resultForKey.abchat_api_key : "");
          });
        } catch (e) {
          resolve("");
        }
      });
    }

    function saveApiKeyForPanelRuntime(keyForSave) {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.set({ abchat_api_key: keyForSave }, function () { resolve(); });
        } catch (e) {
          resolve();
        }
      });
    }

    /* ============================================================
      INPUT DRAFT PERSISTENCE (cross-tab)
    ============================================================ */
    var draftSaveTimerForPanelRuntime = null;
    var draftApplyingForPanelRuntime = false;
    var selfDraftWriteQueueForPanelRuntime = [];
    var lastSelfDraftWriteTsForPanelRuntime = 0;

    function serializeCurrentDraftForPanelRuntime() {
      const taForDraft = root.querySelector('.chat-textarea');
      const text = taForDraft ? taForDraft.value : '';
      const chips = collectInputChipsForPanelRuntime();
      return JSON.stringify({ text: text, chips: chips });
    }

    function recordSelfDraftWriteForPanelRuntime(serializedForSelfWrite) {
      selfDraftWriteQueueForPanelRuntime.push(String(serializedForSelfWrite));
      if (selfDraftWriteQueueForPanelRuntime.length > 50) {
        selfDraftWriteQueueForPanelRuntime.splice(0, selfDraftWriteQueueForPanelRuntime.length - 50);
      }
      lastSelfDraftWriteTsForPanelRuntime = Date.now();
    }

    function consumeMatchingSelfDraftWriteForPanelRuntime(incomingSerializedForSelfWrite) {
      const idxForSelfWrite = selfDraftWriteQueueForPanelRuntime.indexOf(String(incomingSerializedForSelfWrite));
      if (idxForSelfWrite === -1) return false;
      selfDraftWriteQueueForPanelRuntime.splice(idxForSelfWrite, 1);
      return true;
    }

    function saveDraftForPanelRuntime() {
      if (draftApplyingForPanelRuntime) return;
      const serialized = serializeCurrentDraftForPanelRuntime();
      const parsed = JSON.parse(serialized);
      if (!parsed.text && parsed.chips.length === 0) {
        recordSelfDraftWriteForPanelRuntime(JSON.stringify({ text: '', chips: [] }));
        try { chrome.storage.local.remove(INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME); } catch (e) {}
      } else {
        recordSelfDraftWriteForPanelRuntime(serialized);
        try { chrome.storage.local.set({ [INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME]: parsed }); } catch (e) {}
      }
    }

    function scheduleDraftSaveForPanelRuntime() {
      if (draftSaveTimerForPanelRuntime) clearTimeout(draftSaveTimerForPanelRuntime);
      draftSaveTimerForPanelRuntime = setTimeout(saveDraftForPanelRuntime, 300);
    }

    function clearDraftForPanelRuntime() {
      if (draftSaveTimerForPanelRuntime) clearTimeout(draftSaveTimerForPanelRuntime);
      try { chrome.storage.local.remove(INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME); } catch (e) {}
    }

    function applyDraftToUiForPanelRuntime(draft) {
      if (!draft || typeof draft !== 'object') return;
      draftApplyingForPanelRuntime = true;
      try {
        const taForApply = root.querySelector('.chat-textarea');
        if (taForApply) {
          taForApply.value = String(draft.text || '');
          updateAutoExpandForTextareaForPanelRuntime(taForApply);
        }
        const rowForApply = root.querySelector('.input-chips-row');
        if (rowForApply) rowForApply.innerHTML = '';
        const chipsForApply = Array.isArray(draft.chips) ? draft.chips : [];
        chipsForApply.forEach(function (chipDataForApply) {
          if (chipDataForApply && chipDataForApply.type && chipDataForApply.label) {
            addInputChipForPanelRuntime(chipDataForApply);
          }
        });
      } finally {
        draftApplyingForPanelRuntime = false;
      }
    }

    function restoreDraftForPanelRuntime() {
      try {
        chrome.storage.local.get([INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME], function (res) {
          const draft = res && res[INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME];
          if (!draft) return;
          applyDraftToUiForPanelRuntime(draft);
        });
      } catch (e) {}
    }

    // Named storage listener stored in a module-scoped variable so it can be:
    //   1. Removed before re-adding (prevents duplicate listeners after reload).
    //   2. Removed inside teardown() when the panel is destroyed on extension reload.
    //   3. Self-removed when a generation mismatch detects an orphaned context.
    // REGRESSION RISK: do not replace this with an anonymous function; anonymous listeners
    // cannot be deduped or removed, causing accumulation across extension reloads.
    var draftStorageSyncListenerForPanelRuntime = null;
    function bindDraftStorageSyncForPanelRuntime() {
      try {
        if (draftStorageSyncListenerForPanelRuntime) {
          chrome.storage.onChanged.removeListener(draftStorageSyncListenerForPanelRuntime);
          draftStorageSyncListenerForPanelRuntime = null;
        }
        var capturedGenForDraftSync = window.abchatListenerGeneration || 0;
        draftStorageSyncListenerForPanelRuntime = function draftStorageSyncHandlerForPanelRuntime(changes, area) {
          if ((window.abchatListenerGeneration || 0) !== capturedGenForDraftSync) {
            chrome.storage.onChanged.removeListener(draftStorageSyncListenerForPanelRuntime);
            draftStorageSyncListenerForPanelRuntime = null;
            return;
          }
          if (area !== 'local' || !changes[INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME]) return;
          const incoming = changes[INPUT_DRAFT_KEY_FOR_PANEL_RUNTIME].newValue;
          const incomingSerialized = JSON.stringify(incoming || { text: '', chips: [] });
          if (consumeMatchingSelfDraftWriteForPanelRuntime(incomingSerialized)) return;
          // Defensive layer 1: any chip mid-upload means this event almost certainly
          // carries a stale self-write snapshot (filtered while loading). Don't wipe.
          const rowForLoadingGuard = root.querySelector('.input-chips-row');
          if (rowForLoadingGuard && rowForLoadingGuard.querySelector('.ic-status-loading')) return;
          // Defensive layer 2: if we wrote the draft very recently, treat any unmatched
          // event as a self-write echo Chrome coalesced or reordered. Cross-tab updates
          // catch up on the next user edit.
          if (Date.now() - lastSelfDraftWriteTsForPanelRuntime < 1500) return;
          const currentSerialized = serializeCurrentDraftForPanelRuntime();
          if (currentSerialized === incomingSerialized) return;
          applyDraftToUiForPanelRuntime(incoming || { text: '', chips: [] });
        };
        chrome.storage.onChanged.addListener(draftStorageSyncListenerForPanelRuntime);
      } catch (e) {}
    }

    function getNextChatIdForPanelRuntime() {
      const ids = Object.keys(CHAT_STORE_FOR_PANEL_RUNTIME).map(Number);
      return ids.length > 0 ? Math.max.apply(null, ids) + 1 : 1;
    }

    function getNextMsgIdForPanelRuntime() {
      let maxId = 0;
      Object.values(CHAT_STORE_FOR_PANEL_RUNTIME).forEach(function (chat) {
        if (!chat || !Array.isArray(chat.messages)) return;
        chat.messages.forEach(function (m) { if (m && m.id > maxId) maxId = m.id; });
      });
      return maxId + 1;
    }

    function createNewLocalChatForPanelRuntime(firstText, chatTypeForPanelRuntime, isPinnedForPanelRuntime, lastModelForPanelRuntime) {
      const chatIdForPanelRuntime = getNextChatIdForPanelRuntime();
      const nowForPanelRuntime = new Date().toISOString();
      const titleForPanelRuntime = (firstText || 'New chat').slice(0, 80);
      const summaryForPanelRuntime = getChatSummaryFromTextForPanelRuntime(firstText);
      CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime] = {
        title: titleForPanelRuntime,
        summary: summaryForPanelRuntime,
        type: chatTypeForPanelRuntime === 'quickq' ? 'quickq' : 'chat',
        isPinned: Boolean(isPinnedForPanelRuntime),
        lastModel: typeof lastModelForPanelRuntime === 'string' ? lastModelForPanelRuntime : '',
        messages: [],
        createdAt: nowForPanelRuntime,
        updatedAt: nowForPanelRuntime
      };
      CHAT_ORDER_FOR_PANEL_RUNTIME.unshift(chatIdForPanelRuntime);
      chatMessagesLoadedSetForPanelRuntime.add(chatIdForPanelRuntime);
      upsertChatUiForPanelRuntime(chatIdForPanelRuntime, true);
      syncSearchIndexForPanelRuntime('chats', 'add', chatIdForPanelRuntime, CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime]);
      return chatIdForPanelRuntime;
    }

    async function createNewChatForPanelRuntime(firstText, optionsForPanelRuntime) {
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      const chatTypeForPanelRuntime = optsForPanelRuntime.chatType === 'quickq' ? 'quickq' : 'chat';
      const lastModelForPanelRuntime = typeof optsForPanelRuntime.lastModel === 'string' ? optsForPanelRuntime.lastModel : '';
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createChat === 'function') {
        try {
          const createdChatForPanelRuntime = await panelDataRepoForPanelRuntime.createChat({
            title: (firstText || 'New chat').slice(0, 80),
            summary: getChatSummaryFromTextForPanelRuntime(firstText),
            type: chatTypeForPanelRuntime,
            isPinned: Boolean(optsForPanelRuntime.isPinned),
            lastModel: lastModelForPanelRuntime
          });
          refreshChatStoreFromPersistedForPanelRuntime(createdChatForPanelRuntime, { prepend: true });
          syncSearchIndexForPanelRuntime('chats', 'add', Number(createdChatForPanelRuntime.id), CHAT_STORE_FOR_PANEL_RUNTIME[Number(createdChatForPanelRuntime.id)]);
          return Number(createdChatForPanelRuntime.id);
        } catch (errorForPanelRuntime) {
          return createNewLocalChatForPanelRuntime(firstText, chatTypeForPanelRuntime, Boolean(optsForPanelRuntime.isPinned), lastModelForPanelRuntime);
        }
      }
      return createNewLocalChatForPanelRuntime(firstText, chatTypeForPanelRuntime, Boolean(optsForPanelRuntime.isPinned), lastModelForPanelRuntime);
    }

    function scrollChatToBottomForPanelRuntime() {
      const container = root.querySelector('.messages-area');
      if (container) container.scrollTop = container.scrollHeight;
    }

    function setSendingUIStateForPanelRuntime() {
      // Either a local send OR a remote-mirrored stream for the active chat
      // turns the send button into a cancel button and disables the input.
      const sending = sendingChatsForPanelRuntime.has(S.activeChatId) ||
                      remoteStreamingChatsForPanelRuntime.has(S.activeChatId);
      const sendBtnForUI = root.querySelector('.send-btn');
      const chatTaForUI = root.querySelector('.chat-textarea');
      if (sendBtnForUI) {
        if (sending) {
          sendBtnForUI.dataset.action = "cancel-send";
          sendBtnForUI.title = "Cancel";
          sendBtnForUI.innerHTML = ic.stopSquare14;
        } else {
          sendBtnForUI.dataset.action = "send-chat";
          sendBtnForUI.title = "";
          sendBtnForUI.innerHTML = ic.send14;
        }
      }
      if (chatTaForUI) chatTaForUI.disabled = sending;
    }

    function sumPersistedChatCostForPanelRuntime(chatId) {
      const chatRecordForSum = CHAT_STORE_FOR_PANEL_RUNTIME[chatId];
      if (!chatRecordForSum || !Array.isArray(chatRecordForSum.messages)) return 0;
      let totalCostForSum = 0;
      for (let iForSum = 0; iForSum < chatRecordForSum.messages.length; iForSum++) {
        const msgForSum = chatRecordForSum.messages[iForSum];
        if (msgForSum && msgForSum.role === 'assistant' && msgForSum.usageCost > 0) {
          totalCostForSum += msgForSum.usageCost;
        }
      }
      return totalCostForSum;
    }

    function rebuildTokenCounterFromMessagesForPanelRuntime(chatId) {
      const chatRecordForRebuild = CHAT_STORE_FOR_PANEL_RUNTIME[chatId];
      if (!chatRecordForRebuild || !Array.isArray(chatRecordForRebuild.messages)) {
        clearSessionTokenCounterForPanelRuntime();
        return;
      }
      let totalCostForRebuild = 0;
      let lastTotalTokensForRebuild = 0;
      let lastPromptTokensForRebuild = 0;
      let lastCompletionTokensForRebuild = 0;
      let lastReasoningTokensForRebuild = 0;
      for (let iForRebuild = 0; iForRebuild < chatRecordForRebuild.messages.length; iForRebuild++) {
        const msgForRebuild = chatRecordForRebuild.messages[iForRebuild];
        if (!msgForRebuild || msgForRebuild.role !== 'assistant') continue;
        if (msgForRebuild.usageCost > 0) totalCostForRebuild += msgForRebuild.usageCost;
        if (msgForRebuild.usageTotalTokens > 0) {
          lastTotalTokensForRebuild = msgForRebuild.usageTotalTokens;
          lastPromptTokensForRebuild = msgForRebuild.usagePromptTokens || 0;
          lastCompletionTokensForRebuild = msgForRebuild.usageCompletionTokens || 0;
          lastReasoningTokensForRebuild = msgForRebuild.usageReasoningTokens || 0;
        }
      }
      if (!lastTotalTokensForRebuild && !totalCostForRebuild) {
        clearSessionTokenCounterForPanelRuntime();
        return;
      }
      updateSessionTokenDisplayForPanelRuntime(
        {
          total_tokens: lastTotalTokensForRebuild,
          prompt_tokens: lastPromptTokensForRebuild,
          completion_tokens: lastCompletionTokensForRebuild,
          completion_tokens_details: { reasoning_tokens: lastReasoningTokensForRebuild }
        },
        totalCostForRebuild
      );
    }

    function updateSessionTokenDisplayForPanelRuntime(usageObj, cumulativeCost) {
      const inputBottomForCounter = root.querySelector('.input-bottom');
      if (!inputBottomForCounter) return;
      let counterElForDisplay = root.getElementById('abchat-token-counter');
      if (!counterElForDisplay) {
        counterElForDisplay = document.createElement('div');
        counterElForDisplay.id = 'abchat-token-counter';
        counterElForDisplay.style.cssText = 'font-size:11px;color:var(--text-muted,#888);display:flex;align-items:center;gap:4px;white-space:nowrap;padding:0 4px;';
        const sendBtnForCounter = inputBottomForCounter.querySelector('.send-btn');
        if (sendBtnForCounter) {
          inputBottomForCounter.insertBefore(counterElForDisplay, sendBtnForCounter);
        } else {
          inputBottomForCounter.appendChild(counterElForDisplay);
        }
      }
      const rawTotalTokensForDisplay = (usageObj && usageObj.total_tokens) ? Number(usageObj.total_tokens) : 0;
      const reasoningTokensForDisplay = (usageObj && usageObj.completion_tokens_details && Number(usageObj.completion_tokens_details.reasoning_tokens))
        ? Number(usageObj.completion_tokens_details.reasoning_tokens)
        : 0;
      const totalTokensForDisplay = Math.max(0, rawTotalTokensForDisplay - reasoningTokensForDisplay);
      const numCumulativeCost = Number(cumulativeCost) || 0;
      if (!totalTokensForDisplay && !numCumulativeCost) { counterElForDisplay.textContent = ''; counterElForDisplay.style.color = 'var(--text-muted,#888)'; return; }
      const tokensLabelForDisplay = totalTokensForDisplay >= 1000
        ? (totalTokensForDisplay / 1000).toFixed(1) + 'k'
        : String(totalTokensForDisplay || 0);

      // Context fill: estimate budget from active model and show fill fraction.
      const agentNsForCounter = globalThis.ABChatAgent || {};
      const compactorForCounter = agentNsForCounter.compactor || null;
      const activeChatForCounter = S.activeChatId ? CHAT_STORE_FOR_PANEL_RUNTIME[S.activeChatId] : null;
      const chatSelectElForCounter = root.getElementById('chat-model-select');
      const modelForCounter = (activeChatForCounter && activeChatForCounter.lastModel)
        || (chatSelectElForCounter && chatSelectElForCounter.value)
        || '';
      let contextFillLabelForDisplay = '';
      let contextColorForDisplay = 'var(--text-muted,#888)';
      if (compactorForCounter && typeof compactorForCounter.getTokenBudget === 'function' && modelForCounter) {
        const budgetForCounter = compactorForCounter.getTokenBudget(modelForCounter);
        if (budgetForCounter > 0) {
          const budgetLabelForDisplay = budgetForCounter >= 1000
            ? Math.round(budgetForCounter / 1000) + 'k'
            : String(budgetForCounter);
          contextFillLabelForDisplay = ' / ' + budgetLabelForDisplay;
          const fillFractionForDisplay = totalTokensForDisplay / budgetForCounter;
          if (fillFractionForDisplay >= 0.7) {
            contextColorForDisplay = fillFractionForDisplay >= 0.83 ? 'var(--warning-color,#e67e22)' : 'var(--warning-color-soft,#d4a017)';
          }
        }
      }
      counterElForDisplay.style.color = contextColorForDisplay;

      const tokenPartForDisplay = tokensLabelForDisplay + contextFillLabelForDisplay + ' tok';
      if (numCumulativeCost > 0) {
        const costLabelForDisplay = numCumulativeCost < 0.00001
          ? '<$0.00001'
          : '$' + numCumulativeCost.toFixed(5);
        counterElForDisplay.textContent = tokenPartForDisplay + ' · ~' + costLabelForDisplay;
      } else {
        counterElForDisplay.textContent = tokenPartForDisplay;
      }
    }

    function clearSessionTokenCounterForPanelRuntime() {
      const counterForClear = root.getElementById('abchat-token-counter');
      if (counterForClear) counterForClear.remove();
    }

    function showStreamingBubbleForPanelRuntime(isThinking) {
      const container = root.getElementById('chat-messages-content');
      if (!container) return;
      removeStreamingBubbleForPanelRuntime();
      const bubbleForStream = document.createElement('div');
      bubbleForStream.id = 'abchat-streaming-bubble';
      bubbleForStream.className = 'msg-wrap';
      if (isThinking) {
        bubbleForStream.innerHTML = '<div class="msg-bubble asst"><div class="msg-loading"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div></div>';
      } else {
        bubbleForStream.innerHTML = '<div class="msg-bubble asst"><div class="msg-text" id="abchat-streaming-text"></div></div>';
      }
      container.appendChild(bubbleForStream);
      scrollChatToBottomForPanelRuntime();
    }

    function updateStreamingBubbleForPanelRuntime(text) {
      const textEl = root.getElementById('abchat-streaming-text');
      if (!textEl) return;
      textEl.innerHTML = renderMarkdown(text);
      scrollChatToBottomForPanelRuntime();
    }

    function removeStreamingBubbleForPanelRuntime() {
      const existing = root.getElementById('abchat-streaming-bubble');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function showCompactingBubbleForPanelRuntime() {
      const container = root.getElementById('chat-messages-content');
      if (!container) return;
      removeCompactingBubbleForPanelRuntime();
      const bubbleForCompacting = document.createElement('div');
      bubbleForCompacting.id = 'abchat-compacting-bubble';
      bubbleForCompacting.className = 'msg-wrap';
      bubbleForCompacting.innerHTML =
        '<div class="msg-bubble asst">' +
          '<div class="abchat-compacting-label">' +
            '<div class="msg-loading"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div>' +
            '<span>Condensing context…</span>' +
          '</div>' +
        '</div>';
      container.appendChild(bubbleForCompacting);
      scrollChatToBottomForPanelRuntime();
    }

    function removeCompactingBubbleForPanelRuntime() {
      const existing = root.getElementById('abchat-compacting-bubble');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function createLiveTurnBubbleForPanelRuntime(chatId) {
      removeLiveTurnBubbleForPanelRuntime(chatId, true);
      const wrap = document.createElement('div');
      wrap.className = 'msg-wrap';
      wrap.innerHTML =
        '<div class="msg-bubble asst">' +
          '<div class="abchat-lt-spinner">' +
            '<div class="msg-loading"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div>' +
          '</div>' +
          '<div class="abchat-lt-text" style="display:none"></div>' +
        '</div>';
      liveTurnBubblesForPanelRuntime.set(chatId, { wrap: wrap, shownAt: Date.now(), hasText: false, toolsDoneAt: 0, removeTimer: null, bufferText: '', renderedLength: 0, renderRafId: null });
      if (S.activeChatId === chatId) {
        const container = root.getElementById('chat-messages-content');
        if (container) {
          container.appendChild(wrap);
          scrollChatToBottomForPanelRuntime();
        }
      }
    }

    function reattachLiveTurnBubbleForPanelRuntime(chatId) {
      if (S.activeChatId !== chatId) return;
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state || !state.wrap) return;
      const container = root.getElementById('chat-messages-content');
      if (!container) return;
      if (!container.contains(state.wrap)) {
        container.appendChild(state.wrap);
      }
      scrollChatToBottomForPanelRuntime();
    }

    // Append a blinking block caret ("▌") at the tail of the streamed text so the
    // user can see more content is still expected. Re-added on every paint because
    // paintLiveTurnTextForPanelRuntime rewrites innerHTML each frame. The glyph is
    // supplied via CSS ::after so it never pollutes textContent, selection or copy.
    function appendLiveTurnCaretForPanelRuntime(textEl) {
      if (!textEl) return;
      const caretForLiveTurn = document.createElement('span');
      caretForLiveTurn.className = 'abchat-lt-caret';
      caretForLiveTurn.setAttribute('aria-hidden', 'true');
      // Descend into trailing block containers (lists, blockquotes) to reach the
      // last text-bearing leaf so the caret trails the final character inline.
      let targetForCaret = textEl;
      for (let depthForCaret = 0; depthForCaret < 8; depthForCaret++) {
        const lastElForCaret = targetForCaret.lastElementChild;
        if (!lastElForCaret) break;
        const tagForCaret = lastElForCaret.tagName;
        if (tagForCaret === 'UL' || tagForCaret === 'OL' || tagForCaret === 'BLOCKQUOTE') {
          targetForCaret = lastElForCaret;
          continue;
        }
        break;
      }
      const leafForCaret = targetForCaret.lastElementChild;
      let isAwkwardLeafForCaret = false;
      if (leafForCaret) {
        const leafTagForCaret = leafForCaret.tagName;
        if (leafTagForCaret === 'TABLE' || leafTagForCaret === 'PRE' || leafTagForCaret === 'HR' ||
            leafTagForCaret === 'IMG' || leafTagForCaret === 'FIGURE') {
          isAwkwardLeafForCaret = true;
        }
      }
      if (leafForCaret && !isAwkwardLeafForCaret) {
        leafForCaret.appendChild(caretForLiveTurn);
      } else {
        // Trailing block can't host an inline caret cleanly; drop it on its own line.
        caretForLiveTurn.classList.add('abchat-lt-caret-block');
        textEl.appendChild(caretForLiveTurn);
      }
    }

    function paintLiveTurnTextForPanelRuntime(state, chatId, textToShow) {
      if (!state || !state.wrap) return;
      const textEl = state.wrap.querySelector('.abchat-lt-text');
      if (!textEl) return;
      // Keep the spinner visible until there is genuinely visible content to swap to.
      // Many model responses begin with whitespace or markdown that renders to nothing
      // (e.g. a leading newline before a heading); hiding the spinner before the text
      // is actually on screen creates a visible "dead" gap that feels like the agent
      // has stalled. Only swap the spinner out once the rendered HTML has visible text.
      const renderedHtml = renderMarkdown(textToShow);
      if (!renderedHtml || !renderedHtml.trim()) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = renderedHtml;
      if (!tmp.textContent || !tmp.textContent.trim()) return;
      textEl.innerHTML = renderedHtml;
      appendLiveTurnCaretForPanelRuntime(textEl);
      const spinner = state.wrap.querySelector('.abchat-lt-spinner');
      if (spinner && spinner.style.display !== 'none') {
        spinner.style.display = 'none';
        textEl.style.display  = '';
      }
      if (S.activeChatId === chatId) scrollChatToBottomForPanelRuntime();
    }

    // Reveal one frame's worth of buffered characters and schedule the next tick if more remain.
    // This decouples server packet arrival from on-screen rendering so bursty deltas appear as smooth typing.
    function tickLiveTurnRenderForPanelRuntime(chatId) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state || !state.wrap) return;
      state.renderRafId = null;
      const totalLen = state.bufferText ? state.bufferText.length : 0;
      if (state.renderedLength >= totalLen) return;
      const buffered = totalLen - state.renderedLength;
      // Reveal ~5% of backlog per frame (drains in ~20 frames, ~333ms at 60fps),
      // with a floor of 2 chars/frame so even tiny tails finish quickly.
      const charsThisFrame = Math.max(2, Math.ceil(buffered * 0.05));
      state.renderedLength = Math.min(totalLen, state.renderedLength + charsThisFrame);
      paintLiveTurnTextForPanelRuntime(state, chatId, state.bufferText.slice(0, state.renderedLength));
      if (state.renderedLength < (state.bufferText ? state.bufferText.length : 0)) {
        state.renderRafId = requestAnimationFrame(function () { tickLiveTurnRenderForPanelRuntime(chatId); });
      }
    }

    function updateLiveTurnTextForPanelRuntime(chatId, fullText) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state || !state.wrap) return;
      state.hasText = true;
      if (typeof fullText !== 'string') return;
      if (!fullText.startsWith(state.bufferText || '')) {
        state.renderedLength = 0;
      }
      state.bufferText = fullText;
      if (!state.renderRafId) {
        state.renderRafId = requestAnimationFrame(function () { tickLiveTurnRenderForPanelRuntime(chatId); });
      }
    }

    // Wait for the typing animation to finish revealing any buffered text, then ensure
    // the full text is rendered. This is awaited at iteration boundaries so fast responses
    // still appear to stream visibly instead of being painted in one shot.
    async function finalizeLiveTurnTextRenderForPanelRuntime(chatId, signal) {
      const initialState = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!initialState || !initialState.wrap) return;
      const MAX_WAIT_MS = 2000;
      const startTime = Date.now();
      while (true) {
        if (signal && signal.aborted) break;
        const s = liveTurnBubblesForPanelRuntime.get(chatId);
        if (!s || !s.wrap) return;
        const totalLen = s.bufferText ? s.bufferText.length : 0;
        if (s.renderedLength >= totalLen) break;
        if ((Date.now() - startTime) >= MAX_WAIT_MS) break;
        await new Promise(function (resolve) { requestAnimationFrame(resolve); });
      }
      const finalState = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!finalState || !finalState.wrap) return;
      if (finalState.renderRafId) {
        cancelAnimationFrame(finalState.renderRafId);
        finalState.renderRafId = null;
      }
      const totalLen = finalState.bufferText ? finalState.bufferText.length : 0;
      if (finalState.renderedLength < totalLen) {
        finalState.renderedLength = totalLen;
        paintLiveTurnTextForPanelRuntime(finalState, chatId, finalState.bufferText);
      }
    }

    function getLiveTurnToolLabelForPanelRuntime(name, args) {
      function trunc(s, max) {
        s = String(s || '');
        return s.length > max ? s.slice(0, max) + '…' : s;
      }
      function autoLabel(n) {
        return String(n || 'tool').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      }
      function isAgentNoteForLiveTurnLabel(typeForAgentCheck, idForAgentCheck) {
        if (typeForAgentCheck !== 'note' || !idForAgentCheck) return false;
        var noteRecordForAgentCheck = NOTE_STORE_FOR_PANEL_RUNTIME[idForAgentCheck];
        return !!(noteRecordForAgentCheck && noteRecordForAgentCheck.noteType === 'agent');
      }
      switch (name) {
        case 'read':
          if (isAgentNoteForLiveTurnLabel(args.type, args.id)) return 'Introspecting';
          return 'Reading ' + (args.type || 'item') + (args.id ? ' #' + args.id : '');
        case 'write':
          if (isAgentNoteForLiveTurnLabel(args.type, args.id)) return 'Working';
          if (args.id) return 'Updating ' + (args.type || 'item') + (args.title ? ' “' + trunc(args.title, 20) + '”' : ' #' + args.id);
          return 'Creating ' + (args.type || 'item') + (args.title ? ' “' + trunc(args.title, 20) + '”' : '');
        case 'edit':
          if (isAgentNoteForLiveTurnLabel(args.type, args.id)) return 'Working';
          return 'Editing ' + (args.type || 'item') + (args.id ? ' #' + args.id : '');
        case 'grep': {
          var grepTypePluralByKindForLt = { note: 'notes', chat: 'chats', task: 'tasks', question: 'questions' };
          var grepKindForLt = args.type;
          var grepTypeLabelForLt = grepTypePluralByKindForLt[grepKindForLt] || (grepKindForLt ? String(grepKindForLt) + 's' : 'items');
          var grepPatternRawForLt = args.pattern != null ? String(args.pattern) : '';
          var grepScopeForLt = args.scope === 'title' ? 'Finding ' : 'Searching ';
          if (grepPatternRawForLt.trim()) {
            return grepScopeForLt + grepTypeLabelForLt + ': "' + trunc(grepPatternRawForLt, 24) + '"';
          }
          return grepScopeForLt + grepTypeLabelForLt + '…';
        }
        case 'ls':
          return args.type ? 'Listing ' + args.type + 's' : 'Listing workspace';
        case 'page_query': {
          var selHintForPageQuery = args.selector ? ' (' + trunc(args.selector, 20) + ')' : '';
          var catHintForPageQuery = args.category ? ' (' + args.category + ')' : '';
          var subOpLabelsForPageQuery = {
            get_inner_text:    'Reading visible text' + selHintForPageQuery,
            get_outer_html:    'Reading element markup' + selHintForPageQuery,
            get_attribute:     'Reading attribute' + (args.attribute_name ? ' “' + trunc(args.attribute_name, 16) + '”' : '') + selHintForPageQuery,
            get_computed_style:'Reading computed CSS' + selHintForPageQuery,
            traverse:          'Traversing DOM' + selHintForPageQuery + (args.direction ? ' (' + args.direction + ')' : ''),
            click:             (args.button === 'right' ? 'Right-clicking' : 'Clicking') + ' element' + selHintForPageQuery
          };
          if (args.operation === 'getSelection')    return 'Reading selection';
          if (args.operation === 'getPageContext')  return 'Checking page info';
          if (args.operation === 'getPageContent')  return 'Reading full page';
          if (args.operation === 'getPageOverview') return 'Scanning page structure';
          if (args.operation === 'findText')        return 'Finding text' + (args.pattern ? ' “' + trunc(args.pattern, 24) + '”' : '') + (args.selector ? selHintForPageQuery : '');
          if (args.operation === 'findPageElements') {
            if (args.sub_operation && subOpLabelsForPageQuery[args.sub_operation]) return subOpLabelsForPageQuery[args.sub_operation];
            return 'Listing' + catHintForPageQuery + ' elements';
          }
          return 'Querying page';
        }
        case 'page_fill_form':
          return 'Filling form fields';
        case 'eval':
          return 'Computing';
        case 'web_fetch': {
          try {
            var hostname = new URL(args.url).hostname.replace(/^www\./, '');
            return 'Fetching ' + trunc(hostname, 30);
          } catch (e) {
            return 'Fetching URL';
          }
        }
        case 'web_search':
        case 'openrouter:web_search':
          return args.query ? 'Web search: “' + trunc(args.query, 24) + '”' : 'Searching the web';
        case 'memory':
          if (args.operation === 'delete_entry') return 'Removing memory entry';
          return 'Updating memory';
        case 'skill':
          if (args.operation === 'create') return args.title ? 'Saving skill "' + trunc(args.title, 20) + '"' : 'Saving skill';
          if (args.operation === 'read')   return args.slug ? 'Loading skill /' + trunc(args.slug, 24) : 'Loading skill';
          if (args.operation === 'update') return args.slug ? 'Updating skill /' + trunc(args.slug, 24) : 'Updating skill';
          if (args.operation === 'delete') return args.slug ? 'Deleting skill /' + trunc(args.slug, 24) : 'Deleting skill';
          return 'Managing skill';
        case 'generate_image':
          return 'Generating image' + (args.prompt ? ': ' + trunc(args.prompt, 20) : '');
        case 'generate_questions':
          return args.focus ? 'Generating questions on ' + trunc(args.focus, 20) : 'Generating questions';
        default:
          return autoLabel(name);
      }
    }

    // Render the "Retrying… (n/N)" label inside the spinner row. Used both by
    // the local onDelta retry_notice handler and by the remote-stream relay
    // when a mirrored retry notice arrives from the originator.
    function applyLiveTurnRetryNoticeForPanelRuntime(chatId, attemptForRetry, maxAttemptsForRetry) {
      const stateForRetry = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!stateForRetry || !stateForRetry.wrap) return;
      const spinnerForRetry = stateForRetry.wrap.querySelector('.abchat-lt-spinner');
      if (!spinnerForRetry) return;
      let retryLabelElForApply = spinnerForRetry.querySelector('.abchat-lt-retry-label');
      if (!retryLabelElForApply) {
        retryLabelElForApply = document.createElement('span');
        retryLabelElForApply.className = 'abchat-lt-retry-label';
        spinnerForRetry.appendChild(retryLabelElForApply);
      }
      retryLabelElForApply.textContent = 'Retrying… (' + attemptForRetry + '/' + maxAttemptsForRetry + ')';
    }

    function addLiveTurnToolStepsForPanelRuntime(chatId, toolCalls) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state || !state.wrap || !toolCalls || !toolCalls.length) return;
      const bubble = state.wrap.querySelector('.msg-bubble');
      if (!bubble) return;
      const existing = bubble.querySelector('.abchat-lt-tools');
      if (existing) existing.remove();
      const toolsRow = document.createElement('div');
      toolsRow.className = 'abchat-lt-tools';
      toolCalls.forEach(function (tc) {
        const toolName = (tc.function && tc.function.name) ? tc.function.name : 'tool';
        let toolArgs = {};
        try { toolArgs = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) {}
        const toolLabel = getLiveTurnToolLabelForPanelRuntime(toolName, toolArgs);
        const chip = document.createElement('span');
        chip.className = 'ic abchat-lt-tool-chip';
        chip.dataset.toolCallId = tc.id || '';
        chip.innerHTML =
          '<span class="abchat-lt-tool-label">' + escHtml(toolLabel) + '</span>' +
          ' <span class="ic-status-indicator" aria-hidden="true"></span>';
        setInputChipStatusForPanelRuntime(chip, 'loading', toolLabel + '…');
        toolsRow.appendChild(chip);
      });
      bubble.appendChild(toolsRow);
      if (S.activeChatId === chatId) scrollChatToBottomForPanelRuntime();
    }

    function updateLiveTurnToolStepStatusForPanelRuntime(chatId, toolCallId, status, statusText) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state || !state.wrap) return;
      const chip = state.wrap.querySelector(
        '.abchat-lt-tool-chip[data-tool-call-id="' + escHtml(String(toolCallId || '')) + '"]'
      );
      if (!chip) return;
      setInputChipStatusForPanelRuntime(chip, status, statusText || '');
      if (S.activeChatId === chatId) scrollChatToBottomForPanelRuntime();
    }

    function removeLiveTurnBubbleForPanelRuntime(chatId, immediate) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state) return;
      if (state.removeTimer !== null) {
        clearTimeout(state.removeTimer);
        state.removeTimer = null;
      }
      if (immediate) {
        doRemoveLiveBubbleForPanelRuntime(chatId);
      } else {
        var elapsed = Date.now() - state.shownAt;
        var remaining = 3000 - elapsed;
        if (remaining <= 0) {
          doRemoveLiveBubbleForPanelRuntime(chatId);
        } else {
          state.removeTimer = setTimeout(function () {
            state.removeTimer = null;
            doRemoveLiveBubbleForPanelRuntime(chatId);
          }, remaining);
        }
      }
    }

    function doRemoveLiveBubbleForPanelRuntime(chatId) {
      const state = liveTurnBubblesForPanelRuntime.get(chatId);
      if (!state) return;
      if (state.renderRafId) {
        cancelAnimationFrame(state.renderRafId);
        state.renderRafId = null;
      }
      if (state.wrap && state.wrap.parentNode) {
        state.wrap.parentNode.removeChild(state.wrap);
      }
      liveTurnBubblesForPanelRuntime.delete(chatId);
    }

    function appendSystemMsgToContainerForPanelRuntime(text) {
      const container = root.getElementById('chat-messages-content');
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'msg-wrap';
      el.innerHTML = '<div class="msg-bubble asst"><div class="msg-text"><em>' + escHtml(text) + '</em></div></div>';
      container.appendChild(el);
      scrollChatToBottomForPanelRuntime();
    }

    function collectInputChipsForPanelRuntime() {
      const chipsRowForPanelRuntime = root.querySelector('.input-chips-row');
      if (!chipsRowForPanelRuntime) return [];
      return Array.from(chipsRowForPanelRuntime.querySelectorAll('.ic')).map(function (chipForPanelRuntime) {
        const attachStatusForPanelRuntime = String(chipForPanelRuntime.dataset.attachStatus || '').trim().toLowerCase();
        if (attachStatusForPanelRuntime === 'loading' || attachStatusForPanelRuntime === 'error') {
          return null;
        }
        const attachTypeForPanelRuntime = String(chipForPanelRuntime.dataset.attachType || '').trim();
        const attachLabelForPanelRuntime = String(chipForPanelRuntime.dataset.attachName || chipForPanelRuntime.textContent || '').trim();
        if (!attachTypeForPanelRuntime || !attachLabelForPanelRuntime) return null;
        const parsedRefIdForPanelRuntime = Number(chipForPanelRuntime.dataset.attachRefId);
        const parsedSizeForPanelRuntime = Number(chipForPanelRuntime.dataset.attachSize);
        return {
          type: attachTypeForPanelRuntime,
          label: attachLabelForPanelRuntime,
          content: String(chipForPanelRuntime.dataset.attachContent || ''),
          mimeType: String(chipForPanelRuntime.dataset.attachMimeType || ''),
          refId: Number.isFinite(parsedRefIdForPanelRuntime) ? parsedRefIdForPanelRuntime : null,
          size: Number.isFinite(parsedSizeForPanelRuntime) ? parsedSizeForPanelRuntime : 0,
          kind: String(chipForPanelRuntime.dataset.attachKind || ''),
          pageUrl: String(chipForPanelRuntime.dataset.attachPageUrl || ''),
          pageTitle: String(chipForPanelRuntime.dataset.attachPageTitle || ''),
          elementSelector: String(chipForPanelRuntime.dataset.attachElementSelector || ''),
          htmlFormat: String(chipForPanelRuntime.dataset.attachHtmlFormat || '')
        };
      }).filter(Boolean);
    }

    function clearInputChipsForPanelRuntime(removeBlobRefsForPanelRuntime) {
      const chipsRowForPanelRuntime = root.querySelector('.input-chips-row');
      if (!chipsRowForPanelRuntime) return;
      if (removeBlobRefsForPanelRuntime) {
        Array.from(chipsRowForPanelRuntime.querySelectorAll('.ic')).forEach(function (chipForPanelRuntime) {
          removeInputChipForPanelRuntime(chipForPanelRuntime);
        });
        return;
      }
      chipsRowForPanelRuntime.innerHTML = '';
    }

    async function appendMessageToChatForPanelRuntime(chatIdForPanelRuntime, msgObjForPanelRuntime, optionsForPanelRuntime) {
      const chatForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime];
      if (!chatForPanelRuntime) return null;
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      const nowForPanelRuntime = new Date().toISOString();
      const shouldPersistToDbForPanelRuntime = optsForPanelRuntime.persistToDb !== false;

      if (shouldPersistToDbForPanelRuntime && panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createMessage === 'function') {
        try {
          const persistedMessageForPanelRuntime = await panelDataRepoForPanelRuntime.createMessage(
            chatIdForPanelRuntime,
            msgObjForPanelRuntime,
            {
              touchChat: true,
              chatUpdatedAt: nowForPanelRuntime
            }
          );
          const localMessageForPanelRuntime = cloneMessageRecordForPanelRuntime(persistedMessageForPanelRuntime || msgObjForPanelRuntime);
          localMessageForPanelRuntime._persistedToDb = true;
          chatForPanelRuntime.messages.push(localMessageForPanelRuntime);
          chatForPanelRuntime.summary = getChatSummaryFromMessagesForPanelRuntime(chatForPanelRuntime.messages);
          chatForPanelRuntime.updatedAt = nowForPanelRuntime;
          if (!chatForPanelRuntime.createdAt) chatForPanelRuntime.createdAt = nowForPanelRuntime;
          if (!optsForPanelRuntime.skipChatUpdate) {
            try {
              const persistedChatForPanelRuntime = await panelDataRepoForPanelRuntime.updateChat(chatIdForPanelRuntime, {
                summary: chatForPanelRuntime.summary,
                updatedAt: nowForPanelRuntime
              });
              refreshChatStoreFromPersistedForPanelRuntime(persistedChatForPanelRuntime, { prepend: true });
            } catch (chatUpdateErrorForPanelRuntime) {
              upsertChatUiForPanelRuntime(chatIdForPanelRuntime, true);
            }
          } else {
            upsertChatUiForPanelRuntime(chatIdForPanelRuntime, true);
          }
          return localMessageForPanelRuntime;
        } catch (errorForPanelRuntime) {
          // Fall through to in-memory fallback when persistence fails.
        }
      }

      const localMsgForPanelRuntime = cloneMessageRecordForPanelRuntime(msgObjForPanelRuntime);
      if (localMsgForPanelRuntime.id == null || !Number.isFinite(localMsgForPanelRuntime.id)) {
        localMsgForPanelRuntime.id = getNextMsgIdForPanelRuntime();
      }
      localMsgForPanelRuntime.chatId = Number(chatIdForPanelRuntime);
      localMsgForPanelRuntime.createdAt = localMsgForPanelRuntime.createdAt || nowForPanelRuntime;
      localMsgForPanelRuntime._persistedToDb = false;
      chatForPanelRuntime.messages.push(localMsgForPanelRuntime);
      chatForPanelRuntime.summary = getChatSummaryFromMessagesForPanelRuntime(chatForPanelRuntime.messages);
      chatForPanelRuntime.updatedAt = nowForPanelRuntime;
      if (!chatForPanelRuntime.createdAt) chatForPanelRuntime.createdAt = nowForPanelRuntime;
      upsertChatUiForPanelRuntime(chatIdForPanelRuntime, true);
      return localMsgForPanelRuntime;
    }

    async function persistLocalMessageToDbForPanelRuntime(chatIdForPanelRuntime, localMessageForPanelRuntime, optionsForPanelRuntime) {
      const chatForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime];
      if (!chatForPanelRuntime || !localMessageForPanelRuntime) return localMessageForPanelRuntime;
      if (localMessageForPanelRuntime._persistedToDb === true) return localMessageForPanelRuntime;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (!panelDataRepoForPanelRuntime || typeof panelDataRepoForPanelRuntime.createMessage !== 'function') {
        return localMessageForPanelRuntime;
      }
      const optsForPanelRuntime = optionsForPanelRuntime || {};
      try {
        const persistedMessageForPanelRuntime = await panelDataRepoForPanelRuntime.createMessage(
          chatIdForPanelRuntime,
          localMessageForPanelRuntime,
          {
            touchChat: optsForPanelRuntime.touchChat !== false,
            chatUpdatedAt: optsForPanelRuntime.chatUpdatedAt
          }
        );
        const normalizedPersistedMessageForPanelRuntime = cloneMessageRecordForPanelRuntime(
          persistedMessageForPanelRuntime || localMessageForPanelRuntime
        );
        normalizedPersistedMessageForPanelRuntime._persistedToDb = true;
        const localMessageIndexForPanelRuntime = chatForPanelRuntime.messages.indexOf(localMessageForPanelRuntime);
        if (localMessageIndexForPanelRuntime >= 0) {
          chatForPanelRuntime.messages[localMessageIndexForPanelRuntime] = normalizedPersistedMessageForPanelRuntime;
        }
        return normalizedPersistedMessageForPanelRuntime;
      } catch (errorForPanelRuntime) {
        return localMessageForPanelRuntime;
      }
    }

    async function persistPendingUserMessagesForChatForPanelRuntime(chatIdForPanelRuntime, optionsForPanelRuntime) {
      const chatForPanelRuntime = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForPanelRuntime];
      if (!chatForPanelRuntime || !Array.isArray(chatForPanelRuntime.messages)) return;
      const pendingUserMessagesForPanelRuntime = chatForPanelRuntime.messages.filter(function (messageForPanelRuntime) {
        return messageForPanelRuntime
          && messageForPanelRuntime.role === 'user'
          && messageForPanelRuntime._persistedToDb !== true;
      });
      for (let pendingMessageIndexForPanelRuntime = 0; pendingMessageIndexForPanelRuntime < pendingUserMessagesForPanelRuntime.length; pendingMessageIndexForPanelRuntime++) {
        await persistLocalMessageToDbForPanelRuntime(
          chatIdForPanelRuntime,
          pendingUserMessagesForPanelRuntime[pendingMessageIndexForPanelRuntime],
          optionsForPanelRuntime
        );
      }
    }

    /* ============================================================
      API LOGS VIEW
    ============================================================ */
    const API_LOGS_PAGE_SIZE_FOR_PANEL_RUNTIME = 25;

    function escapeHtmlForPanelRuntime(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatLogTimestampForPanelRuntime(isoStr) {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
          d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) { return isoStr; }
    }

    function renderLogRowForPanelRuntime(log) {
      const statusClass = log.status === 'success' ? 'log-status-success' :
        log.status === 'error' ? 'log-status-error' : 'log-status-cancelled';
      const ts = formatLogTimestampForPanelRuntime(log.timestamp);
      const modelShort = escapeHtmlForPanelRuntime((log.model || '').split('/').pop());
      const latency = log.totalLatencyMs ? (log.totalLatencyMs / 1000).toFixed(2) + 's' : '';
      const preview = log.status === 'error' ? (log.errorMessage || 'Error') :
        log.status === 'cancelled' ? 'Cancelled' : (log.responseContent || '');
      const reqType = log.requestType || log.type || '';
      const reqTypeLabels = { chat: 'Chat', 'inline-chat': 'Inline', title: 'Title', compaction: 'Compact', web_search: 'Search', generate_image: 'Image' };
      const reqTypeLabel = reqTypeLabels[reqType] || escapeHtmlForPanelRuntime(reqType);
      const reqTypeBadge = reqType ? `<span class="log-request-type-badge">${reqTypeLabel}</span>` : '';
      return `<div class="log-row" data-action="view-log-detail" data-log-id="${log.id}">` +
        `<div class="log-row-header">` +
        `<span class="log-status-dot ${statusClass}"></span>` +
        `<span class="log-ts">${escapeHtmlForPanelRuntime(ts)}</span>` +
        reqTypeBadge +
        `<span class="log-model">${modelShort}</span>` +
        `<span class="log-latency">${escapeHtmlForPanelRuntime(latency)}</span>` +
        `</div>` +
        `<div class="log-preview">${escapeHtmlForPanelRuntime(preview.slice(0, 90))}</div>` +
        `</div>`;
    }

    function sanitizeMessagesForLogDisplay(messages) {
      if (!Array.isArray(messages)) return messages;
      return messages.map(function (msg) {
        if (!msg || !Array.isArray(msg.content)) return msg;
        var sanitized = Object.assign({}, msg);
        sanitized.content = msg.content.map(function (block) {
          if (block && block.type === 'image_url' && block.image_url && typeof block.image_url.url === 'string' && block.image_url.url.indexOf('data:') === 0) {
            return { type: 'image_url', image_url: { url: '[base64 image data - ' + block.image_url.url.length + ' chars]' } };
          }
          return block;
        });
        return sanitized;
      });
    }

    function renderLogDetailForPanelRuntime(log) {
      const ts = formatLogTimestampForPanelRuntime(log.timestamp);
      const latency = log.totalLatencyMs ? (log.totalLatencyMs / 1000).toFixed(2) + 's' : 'N/A';
      const statusLabel = { success: 'Success', error: 'Error', cancelled: 'Cancelled' }[log.status] || (log.status || '');
      const statusClass = log.status === 'success' ? 'log-status-success' :
        log.status === 'error' ? 'log-status-error' : 'log-status-cancelled';

      const reqTypeRaw = log.requestType || log.type || '';
      const reqTypeDisplayMap = { chat: 'Chat', 'inline-chat': 'Inline Chat', title: 'Title Generation', compaction: 'Compaction', web_search: 'Web Search', generate_image: 'Image Generation' };
      const reqTypeDisplay = reqTypeDisplayMap[reqTypeRaw] || reqTypeRaw;
      let html = `<div class="log-detail-meta">` +
        `<div class="log-detail-row"><span class="log-detail-label">Status</span><span class="log-status-badge ${statusClass}">${escapeHtmlForPanelRuntime(statusLabel)}</span></div>` +
        `<div class="log-detail-row"><span class="log-detail-label">Time</span><span>${escapeHtmlForPanelRuntime(ts)}</span></div>` +
        (reqTypeDisplay ? `<div class="log-detail-row"><span class="log-detail-label">Type</span><span>${escapeHtmlForPanelRuntime(reqTypeDisplay)}</span></div>` : '') +
        `<div class="log-detail-row"><span class="log-detail-label">Model</span><span class="log-mono">${escapeHtmlForPanelRuntime(log.model || '')}</span></div>` +
        `<div class="log-detail-row"><span class="log-detail-label">Latency</span><span>${escapeHtmlForPanelRuntime(latency)}</span></div>` +
        `<div class="log-detail-row"><span class="log-detail-label">Iterations</span><span>${Number(log.iterationCount) || 0}</span></div>` +
        `</div>`;

      if (reqTypeRaw === 'generate_image') {
        html += `<div class="log-detail-section-title">Request</div>` +
          `<div class="log-detail-meta">` +
          (log.prompt ? `<div class="log-detail-row"><span class="log-detail-label">Prompt</span><span>${escapeHtmlForPanelRuntime(log.prompt)}</span></div>` : '') +
          (log.aspectRatio ? `<div class="log-detail-row"><span class="log-detail-label">Aspect Ratio</span><span>${escapeHtmlForPanelRuntime(log.aspectRatio)}</span></div>` : '') +
          `</div>`;
      }

      if (log.usage && (log.usage.total_tokens || log.usage.prompt_tokens)) {
        const webSearchCountForLog = log.usage.server_tool_use && log.usage.server_tool_use.web_search_requests
          ? log.usage.server_tool_use.web_search_requests
          : 0;
        html += `<div class="log-detail-section-title">Token Usage</div>` +
          `<div class="log-detail-meta">` +
          `<div class="log-detail-row"><span class="log-detail-label">Prompt</span><span>${log.usage.prompt_tokens || 0}</span></div>` +
          `<div class="log-detail-row"><span class="log-detail-label">Completion</span><span>${log.usage.completion_tokens || 0}</span></div>` +
          `<div class="log-detail-row"><span class="log-detail-label">Total</span><span>${log.usage.total_tokens || 0}</span></div>` +
          (webSearchCountForLog ? `<div class="log-detail-row"><span class="log-detail-label">Web Searches</span><span>${webSearchCountForLog}</span></div>` : '') +
          (log.toolCalls && log.toolCalls.filter(function(tc) { return tc.name === 'generate_image'; }).length > 0 ? `<div class="log-detail-row"><span class="log-detail-label">Image Gens</span><span>${log.toolCalls.filter(function(tc) { return tc.name === 'generate_image'; }).length}</span></div>` : '') +
          `</div>`;
      }

      if (log.toolCalls && log.toolCalls.length > 0) {
        html += `<div class="log-detail-section-title">Tool Calls (${log.toolCalls.length})</div>` +
          `<div class="log-detail-tools">`;
        for (var tci = 0; tci < log.toolCalls.length; tci++) {
          const tc = log.toolCalls[tci];
          html += `<div class="log-tool-item"><span class="log-tool-name">${escapeHtmlForPanelRuntime(tc.name || '')}</span>`;
          if (tc.args && Object.keys(tc.args).length > 0) {
            html += `<pre class="log-code">${escapeHtmlForPanelRuntime(JSON.stringify(tc.args, null, 2).slice(0, 500))}</pre>`;
          }
          if (tc.result != null) {
            html += `<div class="log-tool-result-label">Result</div>` +
              `<pre class="log-code log-tool-result">${escapeHtmlForPanelRuntime(tc.result)}</pre>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }

      if (log.status === 'error' && log.errorMessage) {
        html += `<div class="log-detail-section-title">Error</div>` +
          `<pre class="log-code log-error-text">${escapeHtmlForPanelRuntime(log.errorMessage)}</pre>`;
      }

      if (log.responseContent) {
        html += `<div class="log-detail-section-title">Response</div>` +
          `<pre class="log-code">${escapeHtmlForPanelRuntime(log.responseContent.slice(0, 3000))}</pre>`;
      }

      if (log.apiParams) {
        html += `<div class="log-detail-section-title">API Parameters</div>` +
          `<pre class="log-code">${escapeHtmlForPanelRuntime(JSON.stringify(log.apiParams, null, 2))}</pre>`;
      }

      if (log.requestMessages && log.requestMessages.length > 0) {
        html += `<div class="log-detail-section-title">Request (${log.requestMessages.length} messages)</div>` +
          `<pre class="log-code">${escapeHtmlForPanelRuntime(JSON.stringify(sanitizeMessagesForLogDisplay(log.requestMessages), null, 2))}</pre>`;
      }

      if (log.turns && log.turns.length > 0) {
        const totalTurns = log.turns.length;
        html += '<div class="log-detail-section-title">Turns (' + totalTurns + ')</div>' +
          '<div class="log-turns-list">';
        for (var tti = 0; tti < log.turns.length; tti++) {
          const turn = log.turns[tti];
          const turnLatency = typeof turn.latencyMs === 'number' ? (turn.latencyMs / 1000).toFixed(2) + 's' : 'N/A';
          html += '<div class="log-turn-item">' +
            '<div class="log-turn-header">' +
              '<span class="log-turn-label">Turn ' + turn.turnIndex + ' of ' + totalTurns + '</span>' +
              '<span class="log-turn-latency">' + escapeHtmlForPanelRuntime(turnLatency) + '</span>' +
            '</div>';
          if (turn.usage && (turn.usage.prompt_tokens || turn.usage.total_tokens)) {
            html += '<div class="log-turn-token-row">' +
              '<span class="log-detail-label">Tokens</span>' +
              '<span>' + (turn.usage.prompt_tokens || 0) + ' prompt / ' + (turn.usage.completion_tokens || 0) + ' completion</span>' +
              '</div>';
          }
          if (turn.requestMessages && turn.requestMessages.length > 0) {
            html += '<div class="log-turn-sub-label">Request (' + turn.requestMessages.length + ' messages)</div>' +
              '<pre class="log-code">' + escapeHtmlForPanelRuntime(JSON.stringify(turn.requestMessages, null, 2)) + '</pre>';
          }
          if (turn.responseText) {
            html += '<div class="log-turn-sub-label">Response</div>' +
              '<pre class="log-code">' + escapeHtmlForPanelRuntime(turn.responseText.slice(0, 2000)) + '</pre>';
          }
          if (turn.responseToolCalls && turn.responseToolCalls.length > 0) {
            html += '<div class="log-turn-sub-label">Tool Calls Requested (' + turn.responseToolCalls.length + ')</div>' +
              '<pre class="log-code">' + escapeHtmlForPanelRuntime(JSON.stringify(turn.responseToolCalls, null, 2)) + '</pre>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      return html;
    }

    async function loadApiLogsViewForPanelRuntime() {
      const apiLogger = (globalThis.ABChatContent || {}).apiLogger;
      const listEl = root.getElementById('logs-list-container');
      const paginationEl = root.getElementById('logs-pagination-bar');
      if (!listEl) return;

      if (!apiLogger) {
        listEl.innerHTML = '<div class="logs-empty">Logger not available.</div>';
        return;
      }

      const total = await apiLogger.getLogCount();
      const logs = await apiLogger.getLogs(API_LOGS_PAGE_SIZE_FOR_PANEL_RUNTIME, apiLogsPageForPanelRuntime * API_LOGS_PAGE_SIZE_FOR_PANEL_RUNTIME);
      apiLogsCacheForPanelRuntime = logs;

      if (logs.length === 0) {
        listEl.innerHTML = '<div class="logs-empty">No API logs recorded yet.</div>';
      } else {
        listEl.innerHTML = logs.map(renderLogRowForPanelRuntime).join('');
      }

      if (paginationEl) {
        const totalPages = Math.ceil(total / API_LOGS_PAGE_SIZE_FOR_PANEL_RUNTIME);
        if (totalPages <= 1) {
          paginationEl.innerHTML = '';
        } else {
          paginationEl.innerHTML =
            `<button class="btn-ghost btn-sm" data-action="logs-prev-page"${apiLogsPageForPanelRuntime === 0 ? ' disabled' : ''}>\u2190 Prev</button>` +
            `<span class="logs-page-info">${apiLogsPageForPanelRuntime + 1} / ${totalPages}</span>` +
            `<button class="btn-ghost btn-sm" data-action="logs-next-page"${apiLogsPageForPanelRuntime >= totalPages - 1 ? ' disabled' : ''}>Next \u2192</button>`;
        }
      }
    }

    function showLogDetailForPanelRuntime(logId) {
      const numId = Number(logId);
      const log = apiLogsCacheForPanelRuntime.find(function (l) { return l.id === numId; });
      if (!log) return;
      const overlay = root.getElementById('logs-detail-overlay');
      const body = root.getElementById('logs-detail-body');
      if (!overlay || !body) return;
      activeLogDetailForPanelRuntime = log;
      body.innerHTML = renderLogDetailForPanelRuntime(log);
      overlay.classList.remove('hidden');
    }

    function closeLogDetailForPanelRuntime() {
      const overlay = root.getElementById('logs-detail-overlay');
      if (overlay) overlay.classList.add('hidden');
      activeLogDetailForPanelRuntime = null;
      activeLogViewRawForPanelRuntime = false;
      const btnForClose = root.getElementById('log-view-toggle-btn');
      if (btnForClose) { btnForClose.textContent = 'JSON'; btnForClose.classList.remove('log-view-raw'); }
    }

    function copyLogDetailForPanelRuntime(btn) {
      if (!activeLogDetailForPanelRuntime) return;
      const text = JSON.stringify(activeLogDetailForPanelRuntime, null, 2);
      navigator.clipboard.writeText(text).then(function () {
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = prev; }, 1500);
        }
      }).catch(function () {});
    }

    function toggleLogViewForPanelRuntime() {
      if (!activeLogDetailForPanelRuntime) return;
      activeLogViewRawForPanelRuntime = !activeLogViewRawForPanelRuntime;
      const body = root.getElementById('logs-detail-body');
      const btn = root.getElementById('log-view-toggle-btn');
      if (!body || !btn) return;
      if (activeLogViewRawForPanelRuntime) {
        const sanitized = Object.assign({}, activeLogDetailForPanelRuntime);
        if (sanitized.requestMessages) {
          sanitized.requestMessages = sanitizeMessagesForLogDisplay(sanitized.requestMessages);
        }
        if (sanitized.turns) {
          sanitized.turns = sanitized.turns.map(function (t) {
            const tc = Object.assign({}, t);
            if (tc.requestMessages) { tc.requestMessages = sanitizeMessagesForLogDisplay(tc.requestMessages); }
            return tc;
          });
        }
        body.innerHTML = '<pre class="log-code">' + escapeHtmlForPanelRuntime(JSON.stringify(sanitized, null, 2)) + '</pre>';
        btn.textContent = 'Formatted';
        btn.classList.add('log-view-raw');
      } else {
        body.innerHTML = renderLogDetailForPanelRuntime(activeLogDetailForPanelRuntime);
        btn.textContent = 'JSON';
        btn.classList.remove('log-view-raw');
      }
    }

    async function clearApiLogsForPanelRuntime() {
      const apiLogger = (globalThis.ABChatContent || {}).apiLogger;
      if (!apiLogger) return;
      await apiLogger.clearLogs();
      apiLogsPageForPanelRuntime = 0;
      apiLogsCacheForPanelRuntime = [];
      await loadApiLogsViewForPanelRuntime();
    }

    /* ============================================================
      AGENT SKILLS & MEMORY MANAGEMENT (settings sub-views)
    ============================================================ */
    var skillEditorEditingIdForPanelRuntime = null;
    var memoryEditorEditingIndexForPanelRuntime = -1;
    var memoryEditorOriginalTextForPanelRuntime = '';
    var skillSlugMaxLenForPanelRuntime = 100;
    var skillTitleMaxLenForPanelRuntime = 100;
    var memoryEntryMaxLenForPanelRuntime = 280;

    function getAgentNotesForManageForPanelRuntime() {
      var repoForManage = getPanelDataRepoForPanelRuntime();
      if (!repoForManage || typeof repoForManage.listNotes !== 'function') return Promise.resolve([]);
      return repoForManage.listNotes('agent').catch(function () { return []; });
    }

    function isSkillNoteForPanelRuntime(noteForManage) {
      var tagsForManage = noteForManage && Array.isArray(noteForManage.tags) ? noteForManage.tags : [];
      return tagsForManage.indexOf('skills') !== -1;
    }

    function getSkillSlugFromNoteForPanelRuntime(noteForManage) {
      var tagsForManage = noteForManage && Array.isArray(noteForManage.tags) ? noteForManage.tags : [];
      for (var iForSlug = 0; iForSlug < tagsForManage.length; iForSlug++) {
        if (tagsForManage[iForSlug] !== 'skills' && tagsForManage[iForSlug] !== 'memory') return tagsForManage[iForSlug];
      }
      return '';
    }

    function findMemoryNoteForPanelRuntime(agentNotesForManage) {
      for (var iForMem = 0; iForMem < agentNotesForManage.length; iForMem++) {
        var tagsForMem = Array.isArray(agentNotesForManage[iForMem].tags) ? agentNotesForManage[iForMem].tags : [];
        if (tagsForMem.indexOf('memory') !== -1 && tagsForMem.indexOf('skills') === -1) return agentNotesForManage[iForMem];
      }
      return null;
    }

    function getMemoryEntriesFromNoteForPanelRuntime(memoryNoteForManage) {
      if (!memoryNoteForManage) return [];
      return String(memoryNoteForManage.body || '')
        .split('\n')
        .map(function (lForMem) { return lForMem.trim(); })
        .filter(function (lForMem) { return lForMem.length > 0; });
    }

    async function refreshAgentManageCountsForPanelRuntime() {
      var skillsCountElForManage = root.getElementById('settings-skills-count');
      var memoryCountElForManage = root.getElementById('settings-memory-count');
      if (!skillsCountElForManage && !memoryCountElForManage) return;
      var agentNotesForCounts = await getAgentNotesForManageForPanelRuntime();
      var skillCountForManage = agentNotesForCounts.filter(isSkillNoteForPanelRuntime).length;
      var memoryCountForManage = getMemoryEntriesFromNoteForPanelRuntime(findMemoryNoteForPanelRuntime(agentNotesForCounts)).length;
      if (skillsCountElForManage) skillsCountElForManage.textContent = '(' + skillCountForManage + ')';
      if (memoryCountElForManage) memoryCountElForManage.textContent = '(' + memoryCountForManage + ')';
    }

    /* ---- Skills ---- */

    function renderSkillRowForPanelRuntime(noteForRow) {
      var slugForRow = getSkillSlugFromNoteForPanelRuntime(noteForRow);
      var titleForRow = String(noteForRow.title || '');
      var previewForRow = String(noteForRow.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return '' +
        '<div class="agent-item">' +
          '<div class="agent-item-main" data-action="skill-edit" data-skill-id="' + noteForRow.id + '">' +
            '<div class="agent-item-head">' +
              '<span class="agent-item-slug">/' + escapeHtmlForPanelRuntime(slugForRow) + '</span>' +
              (titleForRow ? '<span class="agent-item-title">' + escapeHtmlForPanelRuntime(titleForRow) + '</span>' : '') +
            '</div>' +
            (previewForRow ? '<div class="agent-item-preview">' + escapeHtmlForPanelRuntime(previewForRow) + '</div>' : '') +
          '</div>' +
          '<div class="agent-item-actions">' +
            '<button class="btn-icon agent-item-del" data-action="skill-delete" data-skill-id="' + noteForRow.id + '" title="Delete skill">' + ic.trash11 + '</button>' +
          '</div>' +
        '</div>';
    }

    async function loadSkillsViewForPanelRuntime() {
      var listElForSkills = root.getElementById('skills-list-container');
      if (!listElForSkills) return;
      closeSkillEditorForPanelRuntime();
      var agentNotesForSkills = await getAgentNotesForManageForPanelRuntime();
      var skillsForView = agentNotesForSkills.filter(isSkillNoteForPanelRuntime);
      skillsForView.sort(function (aForSkills, bForSkills) {
        return getSkillSlugFromNoteForPanelRuntime(aForSkills).localeCompare(getSkillSlugFromNoteForPanelRuntime(bForSkills));
      });
      if (skillsForView.length === 0) {
        listElForSkills.innerHTML = '<div class="logs-empty">No skills yet. Skills are reusable instructions the agent applies on demand.</div>';
      } else {
        listElForSkills.innerHTML = skillsForView.map(renderSkillRowForPanelRuntime).join('');
      }
      refreshAgentManageCountsForPanelRuntime();
    }

    async function openSkillEditorForPanelRuntime(skillIdForEditor) {
      var overlayForEditor = root.getElementById('skill-editor-overlay');
      var slugElForEditor = root.getElementById('skill-editor-slug');
      var titleElForEditor = root.getElementById('skill-editor-title-input');
      var bodyElForEditor = root.getElementById('skill-editor-body');
      var headingElForEditor = root.getElementById('skill-editor-heading');
      var errElForEditor = root.getElementById('skill-editor-error');
      if (!overlayForEditor || !slugElForEditor || !titleElForEditor || !bodyElForEditor) return;
      if (errElForEditor) errElForEditor.textContent = '';
      if (skillIdForEditor == null) {
        skillEditorEditingIdForPanelRuntime = null;
        slugElForEditor.value = '';
        titleElForEditor.value = '';
        bodyElForEditor.value = '';
        slugElForEditor.removeAttribute('disabled');
        if (headingElForEditor) headingElForEditor.textContent = 'New skill';
      } else {
        var agentNotesForEdit = await getAgentNotesForManageForPanelRuntime();
        var noteForEdit = null;
        for (var iForEdit = 0; iForEdit < agentNotesForEdit.length; iForEdit++) {
          if (Number(agentNotesForEdit[iForEdit].id) === Number(skillIdForEditor) && isSkillNoteForPanelRuntime(agentNotesForEdit[iForEdit])) {
            noteForEdit = agentNotesForEdit[iForEdit];
            break;
          }
        }
        if (!noteForEdit) { await loadSkillsViewForPanelRuntime(); return; }
        skillEditorEditingIdForPanelRuntime = Number(noteForEdit.id);
        slugElForEditor.value = getSkillSlugFromNoteForPanelRuntime(noteForEdit);
        titleElForEditor.value = String(noteForEdit.title || '');
        bodyElForEditor.value = String(noteForEdit.body || '');
        slugElForEditor.removeAttribute('disabled');
        if (headingElForEditor) headingElForEditor.textContent = 'Edit skill';
      }
      overlayForEditor.classList.remove('hidden');
      updateAutoExpandForTextareaForPanelRuntime(bodyElForEditor);
      setTimeout(function () { slugElForEditor.focus(); }, 0);
    }

    function closeSkillEditorForPanelRuntime() {
      var overlayForEditor = root.getElementById('skill-editor-overlay');
      if (overlayForEditor) overlayForEditor.classList.add('hidden');
      skillEditorEditingIdForPanelRuntime = null;
    }

    async function saveSkillFromEditorForPanelRuntime() {
      var repoForSave = getPanelDataRepoForPanelRuntime();
      if (!repoForSave) return;
      var slugElForSave = root.getElementById('skill-editor-slug');
      var titleElForSave = root.getElementById('skill-editor-title-input');
      var bodyElForSave = root.getElementById('skill-editor-body');
      var errElForSave = root.getElementById('skill-editor-error');
      if (!slugElForSave || !titleElForSave || !bodyElForSave) return;
      function showSkillErr(msgForErr) { if (errElForSave) errElForSave.textContent = msgForErr; }
      showSkillErr('');
      var slugForSave = String(slugElForSave.value || '').trim().toLowerCase();
      var titleForSave = String(titleElForSave.value || '').trim();
      var bodyForSave = String(bodyElForSave.value || '');
      if (!slugForSave) { showSkillErr('Command is required.'); return; }
      if (!/^[a-z0-9-]+$/.test(slugForSave)) { showSkillErr('Command may contain only lowercase letters, numbers and hyphens.'); return; }
      if (slugForSave.length > skillSlugMaxLenForPanelRuntime) { showSkillErr('Command must be ' + skillSlugMaxLenForPanelRuntime + ' characters or fewer.'); return; }
      if (!titleForSave) { showSkillErr('Title is required.'); return; }
      if (titleForSave.length > skillTitleMaxLenForPanelRuntime) { showSkillErr('Title must be ' + skillTitleMaxLenForPanelRuntime + ' characters or fewer.'); return; }
      if (!bodyForSave.trim()) { showSkillErr('Instructions are required.'); return; }

      var agentNotesForSave = await getAgentNotesForManageForPanelRuntime();
      var editingIdForSave = skillEditorEditingIdForPanelRuntime;
      for (var iForSave = 0; iForSave < agentNotesForSave.length; iForSave++) {
        if (!isSkillNoteForPanelRuntime(agentNotesForSave[iForSave])) continue;
        if (editingIdForSave != null && Number(agentNotesForSave[iForSave].id) === Number(editingIdForSave)) continue;
        if (getSkillSlugFromNoteForPanelRuntime(agentNotesForSave[iForSave]) === slugForSave) {
          showSkillErr('A skill with the command /' + slugForSave + ' already exists.');
          return;
        }
      }

      var nowForSave = new Date().toISOString();
      try {
        if (editingIdForSave == null) {
          await repoForSave.createNote({
            title: titleForSave, body: bodyForSave, attachments: [],
            tags: ['skills', slugForSave], noteType: 'agent', sourceChatId: null,
            createdAt: nowForSave, updatedAt: nowForSave
          });
        } else {
          await repoForSave.updateNote(editingIdForSave, {
            title: titleForSave, body: bodyForSave, tags: ['skills', slugForSave], updatedAt: nowForSave
          });
        }
      } catch (errForSave) {
        showSkillErr('Could not save skill. Please try again.');
        return;
      }
      closeSkillEditorForPanelRuntime();
      await loadSkillsViewForPanelRuntime();
    }

    function confirmDeleteSkillForPanelRuntime(skillIdForDelete) {
      var listElForDelete = root.getElementById('skills-list-container');
      if (!listElForDelete) return;
      showConfirmPromptForPanelRuntime(listElForDelete, 'Delete this skill?', 'Delete', function () {
        deleteSkillForPanelRuntime(skillIdForDelete);
      });
    }

    async function deleteSkillForPanelRuntime(skillIdForDelete) {
      var repoForDelete = getPanelDataRepoForPanelRuntime();
      if (!repoForDelete) return;
      try { await repoForDelete.deleteNote(Number(skillIdForDelete)); } catch (errForDelete) {}
      await loadSkillsViewForPanelRuntime();
    }

    /* ---- Memory ---- */

    function renderMemoryRowForPanelRuntime(entryForRow, indexForRow) {
      var safeForRow = escapeHtmlForPanelRuntime(entryForRow);
      return '' +
        '<div class="agent-item">' +
          '<div class="agent-item-main" data-action="memory-edit" data-memory-index="' + indexForRow + '" data-memory-text="' + safeForRow + '">' +
            '<div class="agent-item-text">' + safeForRow + '</div>' +
          '</div>' +
          '<div class="agent-item-actions">' +
            '<button class="btn-icon agent-item-del" data-action="memory-delete" data-memory-text="' + safeForRow + '" title="Delete entry">' + ic.trash11 + '</button>' +
          '</div>' +
        '</div>';
    }

    async function loadMemoryViewForPanelRuntime() {
      var listElForMemory = root.getElementById('memory-list-container');
      if (!listElForMemory) return;
      closeMemoryEditorForPanelRuntime();
      var agentNotesForMemView = await getAgentNotesForManageForPanelRuntime();
      var entriesForView = getMemoryEntriesFromNoteForPanelRuntime(findMemoryNoteForPanelRuntime(agentNotesForMemView));
      if (entriesForView.length === 0) {
        listElForMemory.innerHTML = '<div class="logs-empty">Nothing remembered yet. Memory entries are facts the agent keeps across chats.</div>';
      } else {
        listElForMemory.innerHTML = entriesForView.map(renderMemoryRowForPanelRuntime).join('');
      }
      refreshAgentManageCountsForPanelRuntime();
    }

    function openMemoryEditorForPanelRuntime(indexForEditor, textForEditor) {
      var overlayForMemEditor = root.getElementById('memory-editor-overlay');
      var inputElForMemEditor = root.getElementById('memory-editor-input');
      var headingElForMemEditor = root.getElementById('memory-editor-heading');
      var errElForMemEditor = root.getElementById('memory-editor-error');
      if (!overlayForMemEditor || !inputElForMemEditor) return;
      if (errElForMemEditor) errElForMemEditor.textContent = '';
      if (indexForEditor == null || indexForEditor < 0) {
        memoryEditorEditingIndexForPanelRuntime = -1;
        memoryEditorOriginalTextForPanelRuntime = '';
        inputElForMemEditor.value = '';
        if (headingElForMemEditor) headingElForMemEditor.textContent = 'New entry';
      } else {
        memoryEditorEditingIndexForPanelRuntime = indexForEditor;
        memoryEditorOriginalTextForPanelRuntime = String(textForEditor || '');
        inputElForMemEditor.value = memoryEditorOriginalTextForPanelRuntime;
        if (headingElForMemEditor) headingElForMemEditor.textContent = 'Edit entry';
      }
      overlayForMemEditor.classList.remove('hidden');
      updateAutoExpandForTextareaForPanelRuntime(inputElForMemEditor);
      setTimeout(function () { inputElForMemEditor.focus(); }, 0);
    }

    function closeMemoryEditorForPanelRuntime() {
      var overlayForMemEditor = root.getElementById('memory-editor-overlay');
      if (overlayForMemEditor) overlayForMemEditor.classList.add('hidden');
      memoryEditorEditingIndexForPanelRuntime = -1;
      memoryEditorOriginalTextForPanelRuntime = '';
    }

    async function saveMemoryFromEditorForPanelRuntime() {
      var repoForMemSave = getPanelDataRepoForPanelRuntime();
      if (!repoForMemSave) return;
      var inputElForMemSave = root.getElementById('memory-editor-input');
      var errElForMemSave = root.getElementById('memory-editor-error');
      if (!inputElForMemSave) return;
      function showMemErr(msgForMemErr) { if (errElForMemSave) errElForMemSave.textContent = msgForMemErr; }
      showMemErr('');
      var entryForMemSave = String(inputElForMemSave.value || '').replace(/\s*\n\s*/g, ' ').trim();
      if (!entryForMemSave) { showMemErr('Entry cannot be empty.'); return; }
      if (entryForMemSave.length > memoryEntryMaxLenForPanelRuntime) { showMemErr('Entry must be ' + memoryEntryMaxLenForPanelRuntime + ' characters or fewer.'); return; }

      var agentNotesForMemSave = await getAgentNotesForManageForPanelRuntime();
      var memoryNoteForMemSave = findMemoryNoteForPanelRuntime(agentNotesForMemSave);
      var entriesForMemSave = getMemoryEntriesFromNoteForPanelRuntime(memoryNoteForMemSave);
      if (memoryEditorEditingIndexForPanelRuntime >= 0) {
        var origIdxForMemSave = entriesForMemSave.indexOf(memoryEditorOriginalTextForPanelRuntime);
        if (origIdxForMemSave !== -1) entriesForMemSave[origIdxForMemSave] = entryForMemSave;
        else entriesForMemSave.push(entryForMemSave);
      } else {
        entriesForMemSave.push(entryForMemSave);
      }

      var nowForMemSave = new Date().toISOString();
      try {
        if (!memoryNoteForMemSave) {
          await repoForMemSave.createNote({
            title: 'Agent Memory', body: entriesForMemSave.join('\n'), attachments: [],
            tags: ['memory'], noteType: 'agent', sourceChatId: null,
            createdAt: nowForMemSave, updatedAt: nowForMemSave
          });
        } else {
          await repoForMemSave.updateNote(memoryNoteForMemSave.id, { body: entriesForMemSave.join('\n'), updatedAt: nowForMemSave });
        }
      } catch (errForMemSave) {
        showMemErr('Could not save entry. Please try again.');
        return;
      }
      closeMemoryEditorForPanelRuntime();
      await loadMemoryViewForPanelRuntime();
    }

    function confirmDeleteMemoryEntryForPanelRuntime(entryTextForDelete) {
      var listElForMemDelete = root.getElementById('memory-list-container');
      if (!listElForMemDelete) return;
      showConfirmPromptForPanelRuntime(listElForMemDelete, 'Delete this entry?', 'Delete', function () {
        deleteMemoryEntryForPanelRuntime(entryTextForDelete);
      });
    }

    async function deleteMemoryEntryForPanelRuntime(entryTextForDelete) {
      var repoForMemDelete = getPanelDataRepoForPanelRuntime();
      if (!repoForMemDelete) return;
      var agentNotesForMemDelete = await getAgentNotesForManageForPanelRuntime();
      var memoryNoteForMemDelete = findMemoryNoteForPanelRuntime(agentNotesForMemDelete);
      if (!memoryNoteForMemDelete) { await loadMemoryViewForPanelRuntime(); return; }
      var entriesForMemDelete = getMemoryEntriesFromNoteForPanelRuntime(memoryNoteForMemDelete);
      var idxForMemDelete = entriesForMemDelete.indexOf(String(entryTextForDelete || ''));
      if (idxForMemDelete === -1) { await loadMemoryViewForPanelRuntime(); return; }
      entriesForMemDelete.splice(idxForMemDelete, 1);
      var nowForMemDelete = new Date().toISOString();
      try {
        await repoForMemDelete.updateNote(memoryNoteForMemDelete.id, { body: entriesForMemDelete.join('\n'), updatedAt: nowForMemDelete });
      } catch (errForMemDelete) {}
      await loadMemoryViewForPanelRuntime();
    }

    async function autoGenerateChatTitleForPanelRuntime(chatIdForAutoTitle, userMessageForAutoTitle, apiKeyForAutoTitle, fallbackModelForAutoTitle) {
      const numericChatIdForAutoTitle = Number(chatIdForAutoTitle);
      if (!Number.isFinite(numericChatIdForAutoTitle)) return;
      const chatForAutoTitle = CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForAutoTitle];
      if (!chatForAutoTitle || chatForAutoTitle.hasCustomTitle) return;
      const agentNsForAutoTitle = globalThis.ABChatAgent || {};
      const clientForAutoTitle = agentNsForAutoTitle.client || {};
      if (typeof clientForAutoTitle.generateTitle !== 'function') return;
      let titleResultForChatTitle;
      const titleLogStartForChatTitle = Date.now();
      let titleLogStatusForChatTitle = 'success';
      try {
        titleResultForChatTitle = await clientForAutoTitle.generateTitle({
          apiKey: apiKeyForAutoTitle,
          userMessage: userMessageForAutoTitle,
          fallbackModel: fallbackModelForAutoTitle
        });
        if (!titleResultForChatTitle || !titleResultForChatTitle.title) titleLogStatusForChatTitle = 'error';
      } catch (e) {
        titleLogStatusForChatTitle = 'error';
        titleResultForChatTitle = { title: null, model: null, error: 'exception', status: null, body: String((e && e.message) || e || '').slice(0, 500) };
      } finally {
        const titleApiLoggerForChat = (globalThis.ABChatContent || {}).apiLogger;
        if (titleApiLoggerForChat && typeof titleApiLoggerForChat.writeLog === 'function') {
          var titleResponseContentForLog;
          if (titleResultForChatTitle && titleResultForChatTitle.title) {
            titleResponseContentForLog = titleResultForChatTitle.title;
          } else if (titleResultForChatTitle && titleResultForChatTitle.error) {
            titleResponseContentForLog = '[' + titleResultForChatTitle.error + ']'
              + (titleResultForChatTitle.status != null ? ' status=' + titleResultForChatTitle.status : '')
              + (titleResultForChatTitle.body ? ' body=' + titleResultForChatTitle.body : '');
          } else {
            titleResponseContentForLog = null;
          }
          titleApiLoggerForChat.writeLog({
            requestType: 'title',
            timestamp: new Date(titleLogStartForChatTitle).toISOString(),
            chatId: numericChatIdForAutoTitle,
            model: (titleResultForChatTitle && titleResultForChatTitle.model) || null,
            iterationCount: 1,
            totalLatencyMs: Date.now() - titleLogStartForChatTitle,
            status: titleLogStatusForChatTitle,
            responseContent: titleResponseContentForLog
          }).catch(function () {});
        }
      }
      if (!titleResultForChatTitle || !titleResultForChatTitle.title) return;
      const generatedTitleForAutoTitle = titleResultForChatTitle.title;
      const chatAfterFetchForAutoTitle = CHAT_STORE_FOR_PANEL_RUNTIME[numericChatIdForAutoTitle];
      if (!chatAfterFetchForAutoTitle || chatAfterFetchForAutoTitle.hasCustomTitle) return;
      chatAfterFetchForAutoTitle.title = generatedTitleForAutoTitle;
      chatAfterFetchForAutoTitle.updatedAt = new Date().toISOString();
      const panelDataRepoForAutoTitle = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForAutoTitle && typeof panelDataRepoForAutoTitle.updateChat === 'function') {
        try {
          await panelDataRepoForAutoTitle.updateChat(numericChatIdForAutoTitle, { title: generatedTitleForAutoTitle });
        } catch (e) {}
      }
      upsertChatUiForPanelRuntime(numericChatIdForAutoTitle, false);
      if (S.activeChatId === numericChatIdForAutoTitle) {
        updateChatBackTitleForPanelRuntime(generatedTitleForAutoTitle);
      }
    }

    // Classifies a tool call as a memory or skill write. Used by the renderer to
    // attach the "Saved to memory" / "Saved as skill" badge to the assistant bubble.
    // Kept in sync with classifyMemoryToolCallForMemoryClaimGuard in
    // agent/hooks/builtin/memoryClaimGuard.js.
    function classifyToolCallForMemoryGuardForPanelRuntime(toolCallForGuard) {
      if (!toolCallForGuard || !toolCallForGuard.function) return null;
      const nameForGuard = toolCallForGuard.function.name;
      if (nameForGuard !== 'memory' && nameForGuard !== 'skill') return null;
      let argsForGuard = {};
      try { argsForGuard = JSON.parse(toolCallForGuard.function.arguments || '{}'); } catch (e) { argsForGuard = {}; }
      const opForGuard = argsForGuard && typeof argsForGuard.operation === 'string' ? argsForGuard.operation : '';
      if (nameForGuard === 'memory') {
        if (opForGuard === 'upsert' || opForGuard === 'delete_entry') return 'memory';
        return null;
      }
      if (nameForGuard === 'skill') {
        if (opForGuard === 'create' || opForGuard === 'update' || opForGuard === 'delete') return 'skill';
        return null;
      }
      return null;
    }

    function getOriginatingUserTextForMemoryGuardForPanelRuntime(chatIdForGuard, fallbackTextForGuard) {
      if (fallbackTextForGuard && String(fallbackTextForGuard).trim()) return String(fallbackTextForGuard);
      const chatRecordForGuard = CHAT_STORE_FOR_PANEL_RUNTIME[chatIdForGuard];
      const messagesForGuard = (chatRecordForGuard && chatRecordForGuard.messages) || [];
      for (var idxForGuard = messagesForGuard.length - 1; idxForGuard >= 0; idxForGuard--) {
        const candidateForGuard = messagesForGuard[idxForGuard];
        if (candidateForGuard && candidateForGuard.role === 'user') {
          return String(candidateForGuard.content || candidateForGuard.md || '');
        }
      }
      return '';
    }

    async function sendChatForPanelRuntime(optionsForPanelRuntime) {
      const optsForPanelRuntime = optionsForPanelRuntime || {};

      const chatTaForSend = root.querySelector('.chat-textarea');
      const modelSelectForSend = root.querySelector('.model-select');
      if (!chatTaForSend) return;

      const isResendForPanelRuntime = Boolean(optsForPanelRuntime.skipUserAppend);
      const text = isResendForPanelRuntime
        ? ''
        : chatTaForSend.value.trim();
      if (!isResendForPanelRuntime && !text) return;

      // Capture model before any selectChat call can reset it
      const userSelectedModelForSend = (modelSelectForSend && modelSelectForSend.value) ? modelSelectForSend.value : DEFAULT_MODEL_FOR_PANEL_RUNTIME;

      const apiKey = await getApiKeyForPanelRuntime();
      if (!apiKey) {
        appendSystemMsgToContainerForPanelRuntime("No API key set. Please add your OpenRouter API key in Settings.");
        return;
      }

      if (!navigator.onLine) {
        appendSystemMsgToContainerForPanelRuntime("No internet connection. Please check your network and try again.");
        return;
      }

      // Create chat if none is active
      if (!S.activeChatId && !isResendForPanelRuntime) {
        const newChatId = await createNewChatForPanelRuntime(text);
        selectChat(newChatId);
        // Restore user's model choice after selectChat resets the select for a new chat
        if (modelSelectForSend) {
          modelSelectForSend.value = userSelectedModelForSend;
          syncModelPickerLabelForPanelRuntime();
        }
      }

      const chatId = Number(optsForPanelRuntime.chatId || S.activeChatId);
      if (!Number.isFinite(chatId)) return;
      if (sendingChatsForPanelRuntime.has(chatId)) return;
      // Another tab is already streaming this chat — refuse to start a second
      // local stream that would conflict with the mirrored one.
      if (remoteStreamingChatsForPanelRuntime.has(chatId)) {
        appendSystemMsgToContainerForPanelRuntime('This chat is currently streaming on another tab. Wait for it to finish or cancel it before sending again.');
        return;
      }
      if (sendingChatsForPanelRuntime.size >= 3) {
        appendSystemMsgToContainerForPanelRuntime('Too many active agent sessions (max 3). Wait for another chat to finish before starting this one.');
        return;
      }
      if (!isResendForPanelRuntime) {
        const msgsForConsecutiveCheck = (CHAT_STORE_FOR_PANEL_RUNTIME[chatId] || {}).messages || [];
        const lastRealMsgForCheck = msgsForConsecutiveCheck.slice().reverse().find(function (mForCheck) {
          return mForCheck && mForCheck.role !== '_loading' && mForCheck.role !== '_hidden_pair_indicator';
        });
        if (lastRealMsgForCheck && lastRealMsgForCheck.role === 'user') {
          appendSystemMsgToContainerForPanelRuntime('Please wait for the current response before sending another message.');
          return;
        }
      }
      // Guard must be set before the first await so the UI and shared state immediately know this chat is active.
      const controllerForSend = new AbortController();
      const TURN_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
      const ITER_STREAM_TIMEOUT_MS = 90 * 1000;
      const ITER_TOOL_STD_TIMEOUT_MS = 90 * 1000;
      const ITER_TOOL_IMAGE_TIMEOUT_MS = 3 * 60 * 1000;
      let timeoutReasonForSend = null;
      const turnTotalTimeoutIdForSend = setTimeout(function () {
        if (!timeoutReasonForSend) timeoutReasonForSend = 'total';
        controllerForSend.abort();
      }, TURN_TOTAL_TIMEOUT_MS);
      sendingChatsForPanelRuntime.set(chatId, controllerForSend);
      if (contentNamespaceForPanelRuntime.state) {
        contentNamespaceForPanelRuntime.state.agentIsWorking = true;
      }
      setSendingUIStateForPanelRuntime();
      syncMainChatListItemForPanelRuntime(chatId);

      const MAX_TOOL_ITERS = 20;
      let iterCount = 0;
      let consecutiveEmptyItersForSend = 0;
      let sideCallCostForSend = 0;
      let turnMainCostAccumForSend = 0;
      let accumulatedSearchSourcesForSend = [];
      const seenSearchUrlsForSend = new Set();
      // Hook system state. turnContextForSend is shared across all hook dispatches
      // for this send. pendingSystemNotesForSend buffers strings from hooks that
      // returned continueWithSystemNote; they are injected as a single system
      // message at the start of the next iteration.
      const hooksForSend = ((globalThis.ABChatAgent || {}).hooks) || null;
      const turnContextForSend = (hooksForSend && typeof hooksForSend.createTurnContext === 'function')
        ? hooksForSend.createTurnContext({
            chatId: chatId,
            userText: getOriginatingUserTextForMemoryGuardForPanelRuntime(chatId, text)
          })
        : null;
      let pendingSystemNotesForSend = [];
      const turnHookFiringsByIterForSend = [];
      async function dispatchHookForSend(eventNameForDispatch, payloadForDispatch) {
        if (!hooksForSend || typeof hooksForSend.dispatch !== 'function' || !turnContextForSend) {
          return { block: null, continueWithSystemNote: null, annotate: null, firings: [] };
        }
        const resultForDispatch = await hooksForSend.dispatch(eventNameForDispatch, payloadForDispatch, turnContextForSend);
        if (resultForDispatch && Array.isArray(resultForDispatch.firings) && resultForDispatch.firings.length > 0) {
          turnHookFiringsByIterForSend.push({ iter: turnContextForSend.iterIndex, event: eventNameForDispatch, firings: resultForDispatch.firings });
        }
        if (resultForDispatch && typeof resultForDispatch.continueWithSystemNote === 'string' && resultForDispatch.continueWithSystemNote) {
          pendingSystemNotesForSend.push(resultForDispatch.continueWithSystemNote);
        }
        return resultForDispatch;
      }

      const logStartTimeForSend = Date.now();
      let logFirstMessagesForSend = null;
      let logApiParamsForSend = null;
      const logAllToolCallsForSend = [];
      const logTurnsForSend = [];
      let logFinalResponseForSend = '';
      let logUsageForSend = null;
      let logResolvedModelForSend = null;
      let logStatusForSend = 'success';
      let logErrorMsgForSend = '';
      let logCancelledForSend = false;
      let hasPersistedNonUserMessagesForSend = false;
      // Set to true once any renderable assistant message (text, generated image, generated
      // document, etc.) has been persisted this turn. The finally block uses it to decide
      // whether to append the apologetic fallback: if the user can already see something from
      // the assistant, the fallback is suppressed regardless of what failed afterwards.
      let hasAppendedRenderableAssistantMessageForSend = false;
      // Baseline cost from messages persisted before this send; used in live counter updates to avoid
      // double-counting costs that accumulate in turnMainCostAccumForSend during the current send.
      const preSendCostForSend = sumPersistedChatCostForPanelRuntime(chatId);
      // Tracks the cumulative main-LLM cost at the end of the previous iteration so we can compute
      // the incremental cost for each turn and store it per-message.
      let prevTurnMainCostForSend = 0;

      // model and the logging/flag variables below are declared here rather than inside the try block
      // because JS let/const are scoped to their block, so catch and finally cannot see them if they
      // are declared inside try.
      const model = (modelSelectForSend && modelSelectForSend.value) ? modelSelectForSend.value : DEFAULT_MODEL_FOR_PANEL_RUNTIME;
      try {
      const imageModelForSend = await getImageModelForPanelRuntime();
      const cachedForCostForSend = await getCachedModelsForPanelRuntime();
      const cachedModelsForCostForSend = (cachedForCostForSend && cachedForCostForSend.chatModels) || [];
      const modelObjForCostForSend = cachedModelsForCostForSend.find(function (m) { return m.id === model; }) || null;
      const completionCostPerMillionForSend = modelObjForCostForSend ? (Number(modelObjForCostForSend.completionCostPerMillion) || 0) : 0;
      const imageModelObjForCostForSend = loadedImageModelsForPanelRuntime.find(function (m) { return m.id === imageModelForSend; }) || null;
      const imageGenCostForSend = imageModelObjForCostForSend ? (Number(imageModelObjForCostForSend.imageCost) || 0) : 0;
      if (CHAT_STORE_FOR_PANEL_RUNTIME[chatId]) {
        CHAT_STORE_FOR_PANEL_RUNTIME[chatId].lastModel = model;
      }

      if (!isResendForPanelRuntime) {
        // Auto-attach generated image chips for every image produced since the last user message.
        // Scans md (not content, which is always '' for generated image messages) for __blob:N__ refs.
        // The context builder then loads the base64 for each chip and includes it in the API request,
        // giving the agent visual context without the user needing to do anything manually.
        const msgsForAutoChipScan = (CHAT_STORE_FOR_PANEL_RUNTIME[chatId] || {}).messages || [];
        const blobIdPatternForAutoChip = /__blob:(\d+)__/;
        let lastUserIndexForAutoChip = -1;
        for (var aci = msgsForAutoChipScan.length - 1; aci >= 0; aci--) {
          const msgForAutoChip = msgsForAutoChipScan[aci];
          if (msgForAutoChip && msgForAutoChip.role === 'user') {
            lastUserIndexForAutoChip = aci;
            break;
          }
        }
        for (var acj = lastUserIndexForAutoChip + 1; acj < msgsForAutoChipScan.length; acj++) {
          const msgForAutoChipAssistant = msgsForAutoChipScan[acj];
          if (!msgForAutoChipAssistant || msgForAutoChipAssistant.role !== 'assistant') continue;
          const mdForAutoChip = String(msgForAutoChipAssistant.md || '');
          const autoChipMatchForSend = blobIdPatternForAutoChip.exec(mdForAutoChip);
          if (!autoChipMatchForSend) continue;
          const autoChipBlobIdForSend = Number(autoChipMatchForSend[1]);
          if (!Number.isFinite(autoChipBlobIdForSend)) continue;
          addInputChipForPanelRuntime({
            type: 'image',
            label: 'Generated image',
            mimeType: 'image/png',
            refId: autoChipBlobIdForSend,
            size: 0,
            kind: 'generated_image'
          });
        }
        const chipsForSend = collectInputChipsForPanelRuntime();
        await appendMessageToChatForPanelRuntime(chatId, {
          role: "user",
          content: text,
          md: text,
          chips: chipsForSend,
          _addedByThisTab: true
        }, {
          persistToDb: false
        });
        chatTaForSend.value = "";
        clearInputChipsForPanelRuntime();
        clearDraftForPanelRuntime();
        updateAutoExpandForTextareaForPanelRuntime(chatTaForSend);
        renderChatMessages();
        scrollChatToBottomForPanelRuntime();
        const chatForFirstMsgCheck = CHAT_STORE_FOR_PANEL_RUNTIME[chatId];
        if (chatForFirstMsgCheck && chatForFirstMsgCheck.messages.length === 1) {
          const firstMessageSummaryForSend = getChatSummaryFromMessagesForPanelRuntime(chatForFirstMsgCheck.messages);
          if (firstMessageSummaryForSend && chatForFirstMsgCheck.summary !== firstMessageSummaryForSend) {
            chatForFirstMsgCheck.summary = firstMessageSummaryForSend;
            upsertChatUiForPanelRuntime(chatId, true);
          }
          const panelDataRepoForFirstSummaryForSend = getPanelDataRepoForPanelRuntime();
          if (firstMessageSummaryForSend && panelDataRepoForFirstSummaryForSend && typeof panelDataRepoForFirstSummaryForSend.updateChat === 'function') {
            try {
              await panelDataRepoForFirstSummaryForSend.updateChat(chatId, {
                summary: firstMessageSummaryForSend,
                updatedAt: chatForFirstMsgCheck.updatedAt || new Date().toISOString()
              });
            } catch (e) {}
          }
        }
        if (chatForFirstMsgCheck && chatForFirstMsgCheck.messages.length === 1 && !chatForFirstMsgCheck.hasCustomTitle) {
          let titleContextForSend = text;
          if (chipsForSend.length > 0) {
            const chipContextPartsForSend = chipsForSend.map(function(chipForTitleContext) {
              const snippetForTitle = chipForTitleContext.content ? chipForTitleContext.content.slice(0, 200) : '';
              return chipForTitleContext.label + (snippetForTitle ? ': ' + snippetForTitle : '');
            });
            titleContextForSend = (text ? text + '\n' : '') + chipContextPartsForSend.join('\n');
          }
          autoGenerateChatTitleForPanelRuntime(chatId, titleContextForSend, apiKey, model);
        }
      }

      const agentNs = globalThis.ABChatAgent || {};
      const clientForSend = agentNs.client || {};
      const contextBuilderForSend = agentNs.contextBuilder || {};
      const compactorForSend = agentNs.compactor || null;
      const toolDefsForSend = agentNs.toolDefs || [];
      const executeToolForSend = agentNs.executeTool;

      const chatRecordForCompactionForSend = CHAT_STORE_FOR_PANEL_RUNTIME[chatId] || null;
      let compactionSummaryForSend = chatRecordForCompactionForSend && typeof chatRecordForCompactionForSend.compactionSummary === 'string'
        ? chatRecordForCompactionForSend.compactionSummary
        : '';
      let compactedThroughMessageIdForSend = chatRecordForCompactionForSend && chatRecordForCompactionForSend.compactedThroughMessageId != null
        ? chatRecordForCompactionForSend.compactedThroughMessageId
        : null;

      if (compactorForSend && typeof compactorForSend.maybeCompact === 'function' && chatRecordForCompactionForSend) {
        try {
          showCompactingBubbleForPanelRuntime();
          const compactionLogStartForSend = Date.now();
          const compactionResultForSend = await compactorForSend.maybeCompact({
            apiKey: apiKey,
            model: model,
            messages: chatRecordForCompactionForSend.messages,
            existingSummary: compactionSummaryForSend,
            compactedThroughMessageId: compactedThroughMessageIdForSend,
            systemOverheadTokens: 10000,
            signal: controllerForSend.signal
          });
          compactionSummaryForSend = compactionResultForSend && typeof compactionResultForSend.summaryText === 'string'
            ? compactionResultForSend.summaryText
            : compactionSummaryForSend;
          compactedThroughMessageIdForSend = compactionResultForSend && compactionResultForSend.compactedThroughMessageId != null
            ? compactionResultForSend.compactedThroughMessageId
            : compactedThroughMessageIdForSend;
          if (compactionResultForSend && compactionResultForSend.didCompact) {
            const compactionUpdatedAtForSend = new Date().toISOString();
            chatRecordForCompactionForSend.compactionSummary = compactionSummaryForSend;
            chatRecordForCompactionForSend.compactedThroughMessageId = compactedThroughMessageIdForSend;
            chatRecordForCompactionForSend.compactionUpdatedAt = compactionUpdatedAtForSend;
            if (compactionResultForSend.summarizerUsage) {
              const actualCompactionCostForSend = Number(compactionResultForSend.summarizerUsage.cost);
              if (Number.isFinite(actualCompactionCostForSend) && actualCompactionCostForSend > 0) {
                sideCallCostForSend += actualCompactionCostForSend;
              } else {
                const compactionTotalTokensForCost = Number(compactionResultForSend.summarizerUsage.total_tokens) || 0;
                const compactorModelObjForCost = cachedModelsForCostForSend.find(function (m) { return m.id === 'openai/gpt-4.1-nano'; }) || null;
                const compactorCostPerMillionForSend = compactorModelObjForCost ? (Number(compactorModelObjForCost.completionCostPerMillion) || 0) : 0;
                if (compactionTotalTokensForCost > 0 && compactorCostPerMillionForSend > 0) {
                  sideCallCostForSend += (compactionTotalTokensForCost * compactorCostPerMillionForSend) / 1000000;
                }
              }
            }
            const panelDataRepoForCompactionForSend = getPanelDataRepoForPanelRuntime();
            if (panelDataRepoForCompactionForSend && typeof panelDataRepoForCompactionForSend.updateChat === 'function') {
              try {
                await panelDataRepoForCompactionForSend.updateChat(chatId, {
                  compactionSummary: compactionSummaryForSend,
                  compactedThroughMessageId: compactedThroughMessageIdForSend,
                  compactionUpdatedAt: compactionUpdatedAtForSend
                });
              } catch (compactionPersistErrorForSend) {
                // Persistence is best effort; in-memory state still benefits this turn.
              }
            }
            const compactionApiLoggerForSend = (globalThis.ABChatContent || {}).apiLogger;
            if (compactionApiLoggerForSend && typeof compactionApiLoggerForSend.writeLog === 'function') {
              compactionApiLoggerForSend.writeLog({
                requestType: 'compaction',
                timestamp: new Date(compactionLogStartForSend).toISOString(),
                chatId: chatId,
                model: compactionResultForSend.summarizerModel || null,
                iterationCount: 1,
                totalLatencyMs: Date.now() - compactionLogStartForSend,
                status: 'success',
                responseContent: compactionSummaryForSend || null,
                usage: compactionResultForSend.summarizerUsage || null
              }).catch(function () {});
            }
          }
        } catch (compactionErrorForSend) {
          // Compaction is best effort; fall back to existing summary state on failure.
        } finally {
          removeCompactingBubbleForPanelRuntime();
        }
      }

      // Persist the user message(s) to the DB BEFORE creating the live bubble.
      // The DB write fires dbDataChanged to other tabs, which schedule a chat
      // store refresh on their side. By doing this before the stream_start
      // broadcast, receivers see the user message arrive first and the live
      // bubble appears below it (correct visual order). Without this hoist,
      // the user message was only persisted right before the first asstRecord
      // append, so receivers showed the loading bubble with no user message
      // above it.
      try {
        if (!hasPersistedNonUserMessagesForSend) {
          await persistPendingUserMessagesForChatForPanelRuntime(chatId, { touchChat: false });
        }
      } catch (earlyPersistErrForSend) {
        // Best-effort; the iteration loop will retry persistence below.
      }

      // UserPromptSubmit fires once per send, before the iteration loop. A hook
      // returning block: { reason } skips the model call and surfaces a system
      // message to the user (the user message is left persisted as a record).
      let userPromptBlockedForSend = false;
      if (hooksForSend && turnContextForSend) {
        const userPromptResultForSend = await dispatchHookForSend('UserPromptSubmit', {
          userText: turnContextForSend.userText,
          chatId: chatId
        });
        if (userPromptResultForSend && userPromptResultForSend.block) {
          userPromptBlockedForSend = true;
          if (S.activeChatId === chatId) {
            appendSystemMsgToContainerForPanelRuntime(userPromptResultForSend.block.reason);
          }
        }
      }

      createLiveTurnBubbleForPanelRuntime(chatId);
      broadcastStreamEventForPanelRuntime("stream_start", chatId, null);
        while (!userPromptBlockedForSend && iterCount < MAX_TOOL_ITERS) {
          iterCount++;
          const turnStartTimeForSend = Date.now();

          const chatMsgs = (CHAT_STORE_FOR_PANEL_RUNTIME[chatId] || {}).messages || [];
          const agentRulesForBuild = currentAgentRulesForPanelRuntime || '';
          const memCtxForBuild = await loadAgentMemoryContextForPanelRuntime();
          const apiMessages = contextBuilderForSend.build
            ? await contextBuilderForSend.build(chatMsgs, {
                agentRules: agentRulesForBuild,
                agentMemory: memCtxForBuild.agentMemory,
                agentMemoryId: memCtxForBuild.agentMemoryId,
                agentSkills: memCtxForBuild.agentSkills,
                compactionSummary: compactionSummaryForSend,
                compactedThroughMessageId: compactedThroughMessageIdForSend
              })
            : (function () {
                const msgsForFallback = chatMsgs.map(function (messageForPanelRuntime) {
                  if (!messageForPanelRuntime || messageForPanelRuntime.role === '_loading' || messageForPanelRuntime.role === '_hidden_pair_indicator') {
                    return null;
                  }
                  if (messageForPanelRuntime.role === 'tool') {
                    return {
                      role: 'tool',
                      tool_call_id: messageForPanelRuntime.tool_call_id,
                      content: messageForPanelRuntime.content || ''
                    };
                  }
                  return {
                    role: messageForPanelRuntime.role === 'user' ? 'user' : 'assistant',
                    content: messageForPanelRuntime.content || messageForPanelRuntime.md || ''
                  };
                }).filter(Boolean);
                if (agentRulesForBuild) {
                  msgsForFallback.unshift({ role: 'system', content: agentRulesForBuild });
                }
                return msgsForFallback;
              }());

          if (pendingSystemNotesForSend.length > 0) {
            apiMessages.push({ role: 'system', content: pendingSystemNotesForSend.join('\n\n') });
            pendingSystemNotesForSend = [];
          }

          if (turnContextForSend) {
            turnContextForSend.iterIndex = iterCount - 1;
          }

          if (iterCount === 1) {
            logFirstMessagesForSend = apiMessages;
            logApiParamsForSend = {
              stream: true,
              tool_choice: toolDefsForSend.length > 0 ? "auto" : undefined,
              parallel_tool_calls: toolDefsForSend.length > 0 ? true : undefined,
              provider: { sort: "throughput" },
              tools: toolDefsForSend.map(function (t) { return t && t.function ? t.function.name : (t.type || t.name || ''); })
            };
          }

          let accTextForLoop = "";
          const lbsForWait = liveTurnBubblesForPanelRuntime.get(chatId);
          if (lbsForWait && lbsForWait.toolsDoneAt > 0) {
            const toolsElapsed = Date.now() - lbsForWait.toolsDoneAt;
            const toolsRemaining = 3000 - toolsElapsed;
            if (toolsRemaining > 0) {
              await new Promise(function (resolve) {
                const minDisplayTimer = setTimeout(resolve, toolsRemaining);
                controllerForSend.signal.addEventListener('abort', function () {
                  clearTimeout(minDisplayTimer);
                  resolve();
                }, { once: true });
              });
            }
          }
          // Idle timeout, not an absolute cap: re-armed on every stream delta so a
          // slow-but-progressing response is never killed. Only a genuine stall
          // (no data for ITER_STREAM_TIMEOUT_MS) aborts the stream.
          let iterStreamTimeoutIdForSend = null;
          const armStreamIdleTimeoutForSend = function () {
            if (iterStreamTimeoutIdForSend) clearTimeout(iterStreamTimeoutIdForSend);
            iterStreamTimeoutIdForSend = setTimeout(function () {
              if (!timeoutReasonForSend) timeoutReasonForSend = 'stream';
              controllerForSend.abort();
            }, ITER_STREAM_TIMEOUT_MS);
          };
          armStreamIdleTimeoutForSend();
          let streamRetryCountForLoop = 0;
          const MAX_STREAM_RETRIES_FOR_LOOP = 3;
          let resultForLoop;

          do {
            accTextForLoop = "";
            const lbsForReset = liveTurnBubblesForPanelRuntime.get(chatId);
            if (lbsForReset && lbsForReset.wrap) {
              const ltSpinner = lbsForReset.wrap.querySelector('.abchat-lt-spinner');
              const ltText    = lbsForReset.wrap.querySelector('.abchat-lt-text');
              const ltTools   = lbsForReset.wrap.querySelector('.abchat-lt-tools');
              if (ltSpinner) ltSpinner.style.display = '';
              if (ltText)    ltText.style.display    = 'none';
              if (ltTools)   ltTools.remove();
              // Reset typing-animation state so each attempt starts from scratch
              if (lbsForReset.renderRafId) {
                cancelAnimationFrame(lbsForReset.renderRafId);
                lbsForReset.renderRafId = null;
              }
              lbsForReset.bufferText = '';
              lbsForReset.renderedLength = 0;
            }

            resultForLoop = await clientForSend.streamCompletion({
              model: model,
              apiKey: apiKey,
              messages: apiMessages,
              tools: toolDefsForSend.length > 0 ? toolDefsForSend : undefined,
              signal: controllerForSend.signal,
              onDelta: function (deltaForLoop) {
                // Any activity (text, partial tool calls, retry notice) resets the idle timer.
                armStreamIdleTimeoutForSend();
                if (deltaForLoop.type === "text" && deltaForLoop.text) {
                  accTextForLoop += deltaForLoop.text;
                  updateLiveTurnTextForPanelRuntime(chatId, accTextForLoop);
                  broadcastStreamTextDebouncedForPanelRuntime(chatId, accTextForLoop);
                } else if (deltaForLoop.type === "retry_notice") {
                  applyLiveTurnRetryNoticeForPanelRuntime(chatId, deltaForLoop.attempt, deltaForLoop.maxAttempts);
                  broadcastStreamEventForPanelRuntime("stream_retry_notice", chatId, {
                    attempt: deltaForLoop.attempt,
                    maxAttempts: deltaForLoop.maxAttempts
                  });
                }
              }
            });
            if (resultForLoop && typeof resultForLoop.resolvedModel === 'string' && resultForLoop.resolvedModel) {
              logResolvedModelForSend = resultForLoop.resolvedModel;
            }
            // Wait for the typing animation to drain naturally so the user sees streaming
            // even when the entire response arrived in one packet. Cancelled requests skip the wait.
            await finalizeLiveTurnTextRenderForPanelRuntime(chatId, controllerForSend.signal);

            if (resultForLoop && !resultForLoop.cancelled && resultForLoop.incompleteStream && streamRetryCountForLoop < MAX_STREAM_RETRIES_FOR_LOOP) {
              streamRetryCountForLoop++;
            } else {
              break;
            }
          } while (true);
          clearTimeout(iterStreamTimeoutIdForSend);

          logTurnsForSend.push({
            turnIndex: iterCount,
            latencyMs: Date.now() - turnStartTimeForSend,
            requestMessages: sanitizeMessagesForLogDisplay(apiMessages),
            responseText: resultForLoop && resultForLoop.message ? (resultForLoop.message.content || '') : '',
            responseToolCalls: resultForLoop && resultForLoop.message ? (resultForLoop.message.tool_calls || []) : [],
            usage: resultForLoop ? (resultForLoop.usage || null) : null
          });

          if (!resultForLoop || resultForLoop.cancelled) {
            logCancelledForSend = true;
            // Salvage whatever text streamed in before the cancel/timeout so a
            // stopped response stays visible and persisted instead of vanishing.
            // Prefer the client's accumulated content, falling back to the local
            // delta accumulator. Persisting it also flips hasPersistedNonUserMessages,
            // which suppresses the user-message rollback in the finally block.
            const salvagedPartialTextForSend = (resultForLoop && resultForLoop.message && typeof resultForLoop.message.content === 'string' && resultForLoop.message.content.trim())
              ? resultForLoop.message.content
              : ((accTextForLoop && accTextForLoop.trim()) ? accTextForLoop : '');
            if (salvagedPartialTextForSend && salvagedPartialTextForSend.trim().length > 0) {
              if (!hasPersistedNonUserMessagesForSend) {
                await persistPendingUserMessagesForChatForPanelRuntime(chatId, { touchChat: false });
              }
              await appendMessageToChatForPanelRuntime(chatId, {
                role: 'assistant',
                content: salvagedPartialTextForSend,
                md: salvagedPartialTextForSend,
                incomplete: true
              }, { skipChatUpdate: true });
              hasPersistedNonUserMessagesForSend = true;
              hasAppendedRenderableAssistantMessageForSend = true;
              if (S.activeChatId === chatId) {
                renderChatMessages();
                scrollChatToBottomForPanelRuntime();
              }
            }
            if (timeoutReasonForSend && S.activeChatId === chatId) {
              const timeoutMsgForSend = timeoutReasonForSend === 'total'
                ? 'Agent stopped: turn exceeded the 10-minute time limit.'
                : timeoutReasonForSend === 'stream'
                ? 'Agent stopped: the model stopped responding (no data for 90s).'
                : 'Agent stopped: tool execution took too long (3-minute limit).';
              appendSystemMsgToContainerForPanelRuntime(timeoutMsgForSend);
            }
            break;
          }

          if (resultForLoop.usage) {
            logUsageForSend = resultForLoop.usage;
            const actualMainCostForSend = Number(logUsageForSend.cost);
            turnMainCostAccumForSend += Number.isFinite(actualMainCostForSend) && actualMainCostForSend > 0
              ? actualMainCostForSend
              : (Number(logUsageForSend.total_tokens) || 0) * completionCostPerMillionForSend / 1000000;
            if (S.activeChatId === chatId) updateSessionTokenDisplayForPanelRuntime(logUsageForSend, preSendCostForSend + turnMainCostAccumForSend + sideCallCostForSend);
          }

          const assistantMsg = resultForLoop.message;
          if (!assistantMsg) break;

          const toolCallsForLoop = assistantMsg.tool_calls;
          const hasContent = assistantMsg.content && assistantMsg.content.trim().length > 0;
          const hasToolCalls = toolCallsForLoop && toolCallsForLoop.length > 0;

          if (!hasContent && !hasToolCalls) {
            appendSystemMsgToContainerForPanelRuntime('The model returned an empty response.');
            break;
          }

          const thisLLMCostForRecord = turnMainCostAccumForSend - prevTurnMainCostForSend;
          const asstRecord = {
            role: "assistant",
            content: assistantMsg.content || "",
            md: assistantMsg.content || "",
            tool_calls: assistantMsg.tool_calls,
            usagePromptTokens: logUsageForSend ? (Number(logUsageForSend.prompt_tokens) || 0) : 0,
            usageCompletionTokens: logUsageForSend ? (Number(logUsageForSend.completion_tokens) || 0) : 0,
            usageTotalTokens: logUsageForSend ? (Number(logUsageForSend.total_tokens) || 0) : 0,
            usageReasoningTokens: logUsageForSend && logUsageForSend.completion_tokens_details
              ? (Number(logUsageForSend.completion_tokens_details.reasoning_tokens) || 0)
              : 0,
            usageCost: !hasToolCalls
              ? (thisLLMCostForRecord + sideCallCostForSend)
              : thisLLMCostForRecord,
            searchSources: (!hasToolCalls && accumulatedSearchSourcesForSend.length > 0)
              ? accumulatedSearchSourcesForSend.slice()
              : []
          };
          if (!hasPersistedNonUserMessagesForSend) {
            await persistPendingUserMessagesForChatForPanelRuntime(chatId, {
              touchChat: false
            });
          }
          await appendMessageToChatForPanelRuntime(chatId, asstRecord, { skipChatUpdate: true });
          prevTurnMainCostForSend = turnMainCostAccumForSend;
          hasPersistedNonUserMessagesForSend = true;
          if (hasContent) hasAppendedRenderableAssistantMessageForSend = true;
          if (S.activeChatId === chatId) {
            renderChatMessages();
            reattachLiveTurnBubbleForPanelRuntime(chatId);
            scrollChatToBottomForPanelRuntime();
          }
          // Tell receivers to refresh: their chat store will pull the new
          // assistant message from the DB and render it in place of the
          // streaming bubble's text (which clears on the next iteration).
          broadcastStreamEventForPanelRuntime("stream_message_persisted", chatId, null);

          // Make this iter's tool calls visible to Stop/PostModelResponse hooks
          // (the memory-claim guard reads turnContext.toolCallsThisTurn to decide
          // whether a memory/skill write happened anywhere in the send).
          if (turnContextForSend && hasToolCalls) {
            for (var tcPushIdxForCtx = 0; tcPushIdxForCtx < toolCallsForLoop.length; tcPushIdxForCtx++) {
              turnContextForSend.toolCallsThisTurn.push(toolCallsForLoop[tcPushIdxForCtx]);
            }
          }

          // PostModelResponse fires after every model response, whether it emitted
          // tool calls or final text. Handlers can block (abort the turn) or, on
          // final-reply iterations, return continueWithSystemNote to re-loop.
          const postModelResponseResultForSend = await dispatchHookForSend('PostModelResponse', {
            assistantMessage: assistantMsg,
            toolCalls: toolCallsForLoop || [],
            isFinalReply: !hasToolCalls,
            chatId: chatId
          });
          if (postModelResponseResultForSend && postModelResponseResultForSend.block) {
            if (S.activeChatId === chatId) {
              appendSystemMsgToContainerForPanelRuntime(postModelResponseResultForSend.block.reason);
            }
            break;
          }
          if (postModelResponseResultForSend && postModelResponseResultForSend.continueWithSystemNote) {
            // Note was pushed into pendingSystemNotesForSend by dispatchHookForSend.
            // Re-enter the loop so the model sees the corrective note.
            continue;
          }

          if (!hasToolCalls) {
            // Stop fires only on the terminal turn (final text reply, no tool calls).
            // A handler returning continueWithSystemNote re-enters the loop instead
            // of breaking; a handler returning block aborts the turn.
            const stopResultForSend = await dispatchHookForSend('Stop', {
              assistantMessage: assistantMsg,
              toolCalls: [],
              isFinalReply: true,
              chatId: chatId
            });
            if (stopResultForSend && stopResultForSend.block) {
              if (S.activeChatId === chatId) {
                appendSystemMsgToContainerForPanelRuntime(stopResultForSend.block.reason);
              }
              break;
            }
            if (stopResultForSend && stopResultForSend.continueWithSystemNote) {
              continue;
            }
            if (assistantMsg.content) { logFinalResponseForSend = assistantMsg.content; }
            break;
          }

          addLiveTurnToolStepsForPanelRuntime(chatId, toolCallsForLoop);
          // Mirror the tool-step chips to receivers. toolCallsForLoop is the
          // OpenAI tool_calls array ({id, type, function:{name, arguments}}).
          broadcastStreamEventForPanelRuntime("stream_tool_steps", chatId, {
            toolCalls: toolCallsForLoop
          });

          // Lifetime tool-call cap enforced by agent/hooks/builtin/toolCallCap.js
          // (PostModelResponse handler), and per-send image-generation cap enforced
          // by agent/hooks/builtin/imageGenerationCap.js (PreToolUse handler).

          // Execute all tool calls in parallel, then append results in order
          const toolLogEntriesForLoop = [];
          const wrapToolPromiseWithAbortForSend = function (toolPromiseForSend) {
            return new Promise(function (resolveForToolAbort) {
              if (controllerForSend.signal.aborted) {
                resolveForToolAbort({ ok: false, cancelled: true, error: 'Cancelled' });
                return;
              }
              let settledForToolAbort = false;
              const onAbortForToolAbort = function () {
                if (settledForToolAbort) return;
                settledForToolAbort = true;
                resolveForToolAbort({ ok: false, cancelled: true, error: 'Cancelled' });
              };
              controllerForSend.signal.addEventListener('abort', onAbortForToolAbort, { once: true });
              Promise.resolve(toolPromiseForSend).then(function (resultForToolAbort) {
                if (settledForToolAbort) return;
                settledForToolAbort = true;
                controllerForSend.signal.removeEventListener('abort', onAbortForToolAbort);
                resolveForToolAbort(resultForToolAbort);
              }).catch(function (errorForToolAbort) {
                if (settledForToolAbort) return;
                settledForToolAbort = true;
                controllerForSend.signal.removeEventListener('abort', onAbortForToolAbort);
                resolveForToolAbort({ error: errorForToolAbort && errorForToolAbort.message ? errorForToolAbort.message : "Tool execution failed." });
              });
            });
          };
          const toolExecPromisesForLoop = toolCallsForLoop.map(async function (tc) {
            let toolArgs = {};
            try { toolArgs = JSON.parse(tc.function.arguments || "{}"); } catch (e) {}
            const tcNameForExec = tc.function ? tc.function.name : '';
            const logEntry = { name: tcNameForExec, args: toolArgs };
            logAllToolCallsForSend.push(logEntry);
            toolLogEntriesForLoop.push(logEntry);
            // PreToolUse: a hook returning block: { reason } skips execution and
            // surfaces a synthetic error result to the model for this tool call.
            const preToolUseResultForLoop = await dispatchHookForSend('PreToolUse', {
              toolName: tcNameForExec,
              args: toolArgs,
              callId: tc.id,
              chatId: chatId,
              iterIndex: turnContextForSend ? turnContextForSend.iterIndex : 0
            });
            if (preToolUseResultForLoop && preToolUseResultForLoop.block) {
              return { ok: false, error: preToolUseResultForLoop.block.reason };
            }
            if (typeof executeToolForSend === "function") {
              return wrapToolPromiseWithAbortForSend(
                executeToolForSend(tcNameForExec, toolArgs, {
                  apiKey: apiKey,
                  imageModel: imageModelForSend,
                  messages: apiMessages,
                  model: model,
                  chatId: chatId,
                  signal: controllerForSend.signal
                })
              );
            }
            return { error: "Tool executor not available." };
          });

          const hasImageGenInBatchForTimeout = toolCallsForLoop.some(function (tcForTimeout) {
            return tcForTimeout.function && tcForTimeout.function.name === 'generate_image';
          });
          const toolExecTimeoutMsForSend = hasImageGenInBatchForTimeout ? ITER_TOOL_IMAGE_TIMEOUT_MS : ITER_TOOL_STD_TIMEOUT_MS;
          const iterToolTimeoutIdForSend = setTimeout(function () {
            if (!timeoutReasonForSend) timeoutReasonForSend = 'tool';
            controllerForSend.abort();
          }, toolExecTimeoutMsForSend);
          const toolResultsForLoop = await Promise.all(toolExecPromisesForLoop);
          clearTimeout(iterToolTimeoutIdForSend);
          if (controllerForSend.signal.aborted) {
            logCancelledForSend = true;
            if (timeoutReasonForSend && S.activeChatId === chatId) {
              const timeoutMsgForToolSend = timeoutReasonForSend === 'total'
                ? 'Agent stopped: turn exceeded the 10-minute time limit.'
                : timeoutReasonForSend === 'stream'
                ? 'Agent stopped: the model stopped responding (no data for 90s).'
                : 'Agent stopped: tool execution took too long (3-minute limit).';
              appendSystemMsgToContainerForPanelRuntime(timeoutMsgForToolSend);
            }
            break;
          }

          const TOOL_RESULT_LOG_MAX_CHARS = 500;

          // Persist all tool results. Strip dataUrl from generators so base64 never reaches the model.
          for (var ti = 0; ti < toolCallsForLoop.length; ti++) {
            if (controllerForSend.signal.aborted) {
              logCancelledForSend = true;
              break;
            }
            const tc = toolCallsForLoop[ti];
            const tcNameForResult = tc.function && tc.function.name;
            const toolResult = toolResultsForLoop[ti];
            let toolResultForModel = toolResult;
            if (tcNameForResult === 'generate_image' && toolResult && toolResult.ok && typeof toolResult.dataUrl === 'string') {
              toolResultForModel = { ok: true, prompt: toolResult.prompt || '' };
            } else if (tcNameForResult === 'create_document' && toolResult && toolResult.ok && typeof toolResult.dataUrl === 'string') {
              toolResultForModel = {
                ok: true,
                format: toolResult.format || '',
                filename: toolResult.filename || '',
                mimeType: toolResult.mimeType || '',
                size: Number(toolResult.size) || 0,
                note: 'The generated document has been saved and displayed to the user.'
              };
            }
            // Strip internal tracking fields before the model sees the result
            if (toolResultForModel && typeof toolResultForModel === 'object' && '_usage' in toolResultForModel) {
              toolResultForModel = Object.assign({}, toolResultForModel);
              delete toolResultForModel._usage;
            }
            // Accumulate web search side cost using usage data returned from the search API call
            if (tcNameForResult === 'web_search' && toolResult && toolResult._usage) {
              const actualSearchCostForSend = Number(toolResult._usage.cost);
              if (Number.isFinite(actualSearchCostForSend) && actualSearchCostForSend > 0) {
                sideCallCostForSend += actualSearchCostForSend;
              } else {
                const searchTotalTokensForCost = Number(toolResult._usage.total_tokens) || 0;
                if (searchTotalTokensForCost > 0 && completionCostPerMillionForSend > 0) {
                  sideCallCostForSend += (searchTotalTokensForCost * completionCostPerMillionForSend) / 1000000;
                }
              }
            }
            // Accumulate web search sources for display
            if (tcNameForResult === 'web_search' && toolResult && Array.isArray(toolResult.results)) {
              toolResult.results.forEach(function(r) {
                if (r && r.url && !seenSearchUrlsForSend.has(String(r.url))) {
                  seenSearchUrlsForSend.add(String(r.url));
                  accumulatedSearchSourcesForSend.push({ url: String(r.url), title: String(r.title || '') });
                }
              });
            }
            // Accumulate image gen side cost
            if (tcNameForResult === 'generate_image' && toolResult && toolResult._usage) {
              const actualImageCostForSend = Number(toolResult._usage.cost);
              if (Number.isFinite(actualImageCostForSend) && actualImageCostForSend > 0) {
                sideCallCostForSend += actualImageCostForSend;
              } else {
                const imageGenTotalTokensForCost = Number(toolResult._usage.total_tokens) || 0;
                if (imageGenTotalTokensForCost > 0 && completionCostPerMillionForSend > 0) {
                  sideCallCostForSend += (imageGenTotalTokensForCost * completionCostPerMillionForSend) / 1000000;
                }
              }
            }
            // Accumulate web_fetch summarizer side cost
            if (tcNameForResult === 'web_fetch' && toolResult && toolResult._usage) {
              const actualFetchCostForSend = Number(toolResult._usage.cost);
              if (Number.isFinite(actualFetchCostForSend) && actualFetchCostForSend > 0) {
                sideCallCostForSend += actualFetchCostForSend;
              } else {
                const fetchSummaryTotalTokensForCost = Number(toolResult._usage.total_tokens) || 0;
                if (fetchSummaryTotalTokensForCost > 0 && completionCostPerMillionForSend > 0) {
                  sideCallCostForSend += (fetchSummaryTotalTokensForCost * completionCostPerMillionForSend) / 1000000;
                }
              }
            }
            const toolResultStr = typeof toolResultForModel === 'string' ? toolResultForModel : JSON.stringify(toolResultForModel);
            const toolResultStrForLog = typeof toolResultForModel === 'string' ? toolResultForModel : JSON.stringify(toolResultForModel);
            toolLogEntriesForLoop[ti].result = toolResultStrForLog.length > TOOL_RESULT_LOG_MAX_CHARS
              ? toolResultStrForLog.slice(0, TOOL_RESULT_LOG_MAX_CHARS) + '\u2026'
              : toolResultStrForLog;
            const isToolErrorForLoop = toolResult && typeof toolResult === 'object' && toolResult.error;
            const toolStepStatusForLoop = isToolErrorForLoop ? 'error' : 'success';
            const toolStepStatusTextForLoop = isToolErrorForLoop ? String(toolResult.error) : 'Done';
            updateLiveTurnToolStepStatusForPanelRuntime(
              chatId,
              tc.id,
              toolStepStatusForLoop,
              toolStepStatusTextForLoop
            );
            broadcastStreamEventForPanelRuntime("stream_tool_step_status", chatId, {
              toolCallId: tc.id,
              status: toolStepStatusForLoop,
              statusText: toolStepStatusTextForLoop
            });
            // Safety cap for all tool results sent to the model. The eval worker enforces its
            // own tighter 200 KB cap; this 500 KB backstop catches any other tool that returns
            // an unexpectedly large payload. We replace oversized content with an error message
            // rather than truncating mid-stream, because a cut-off JSON string is unparseable
            // and more confusing to the model than a clear "too large" signal.
            const TOOL_RESULT_API_MAX_CHARS = 512000; // 500 KB
            const toolResultStrForApi = toolResultStr.length > TOOL_RESULT_API_MAX_CHARS
              ? JSON.stringify({ ok: false, error: 'Tool result too large to send (' + toolResultStr.length + ' bytes; max 500 KB). The tool produced too much output; try a more targeted request.' })
              : toolResultStr;
            await appendMessageToChatForPanelRuntime(chatId, {
              role: 'tool',
              tool_call_id: tc.id,
              content: toolResultStrForApi,
              md: ''
            }, { skipChatUpdate: true });
            // PostToolUse: handlers may only annotate here (no block, no
            // continueWithSystemNote). The tool already ran and its result is
            // persisted; this event is for observers (logging, metrics, etc.).
            let parsedToolArgsForPostHook = {};
            try { parsedToolArgsForPostHook = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            await dispatchHookForSend('PostToolUse', {
              toolName: tcNameForResult,
              args: parsedToolArgsForPostHook,
              result: toolResultForModel,
              callId: tc.id,
              chatId: chatId,
              iterIndex: turnContextForSend ? turnContextForSend.iterIndex : 0,
              ok: !(toolResult && typeof toolResult === 'object' && toolResult.error)
            });
          }
          if (controllerForSend.signal.aborted) {
            logCancelledForSend = true;
            break;
          }

          // If an OpenAI aspect ratio error was returned and it was the sole tool call in the turn,
          // inject a canned assistant message and stop the loop immediately so the agent never gets
          // a chance to paraphrase or retry.
          const openaiAspectRatioErrorForLoop = toolCallsForLoop.length === 1 ? toolResultsForLoop.find(function(r) {
            return r && r.errorCode === 'OPENAI_ASPECT_RATIO_UNSUPPORTED';
          }) : null;
          if (openaiAspectRatioErrorForLoop) {
            const cannedRatioForLoop = openaiAspectRatioErrorForLoop.aspectRatio || 'non-square';
            const cannedMsgForLoop = 'Your current image model (OpenAI) doesn\'t support ' + cannedRatioForLoop + ' images — it can only generate square (1:1) images. To generate a ' + cannedRatioForLoop + ' image, go to **Settings** and switch your image model to a Gemini model, then try again.';
            await appendMessageToChatForPanelRuntime(chatId, {
              role: 'assistant',
              content: cannedMsgForLoop,
              md: cannedMsgForLoop
            }, { skipChatUpdate: true });
            // Prevents the finally block from appending a fallback "something went wrong" message.
            hasAppendedRenderableAssistantMessageForSend = true;
            if (S.activeChatId === chatId) {
              renderChatMessages();
              reattachLiveTurnBubbleForPanelRuntime(chatId);
              scrollChatToBottomForPanelRuntime();
            }
            break;
          }

          // After all tool results, store generated blobs and inject display messages.
          const panelDataRepoForImageInject = (globalThis.ABChatShared || {}).panelDataRepo;
          for (var gi = 0; gi < toolCallsForLoop.length; gi++) {
            if (controllerForSend.signal.aborted) {
              logCancelledForSend = true;
              break;
            }
            const tcNameForImage = toolCallsForLoop[gi].function && toolCallsForLoop[gi].function.name;
            const toolResultForImage = toolResultsForLoop[gi];
            if (tcNameForImage !== 'generate_image' || !toolResultForImage || !toolResultForImage.ok) continue;
            if (typeof toolResultForImage.dataUrl !== 'string' || toolResultForImage.dataUrl.indexOf('data:image/') !== 0) continue;
            if (!panelDataRepoForImageInject || typeof panelDataRepoForImageInject.createAttachmentBlob !== 'function') continue;
            try {
              const blobRecordForImage = await panelDataRepoForImageInject.createAttachmentBlob({
                name: 'generated-image',
                kind: 'generated_image',
                mimeType: 'image/png',
                dataUrl: toolResultForImage.dataUrl,
                size: toolResultForImage.dataUrl.length
              });
              if (controllerForSend.signal.aborted) {
                logCancelledForSend = true;
                if (blobRecordForImage && blobRecordForImage.id != null && typeof panelDataRepoForImageInject.deleteAttachmentBlob === 'function') {
                  try { await panelDataRepoForImageInject.deleteAttachmentBlob(Number(blobRecordForImage.id)); } catch (e) {}
                }
                break;
              }
              if (blobRecordForImage && blobRecordForImage.id != null) {
                const blobIdForImage = Number(blobRecordForImage.id);
                setImageBlobCacheForPanelRuntime(blobIdForImage, toolResultForImage.dataUrl);
                sideCallCostForSend += imageGenCostForSend;
                // content must stay '' so the chat renderer shows only the image (via md) and the
                // context builder falls through to md, giving the agent the __blob:N__ ref it needs
                // for source_blob_id without producing a visible extra text bubble.
                await appendMessageToChatForPanelRuntime(chatId, {
                  role: 'assistant',
                  content: '',
                  md: '![Generated image](__blob:' + blobIdForImage + '__)'
                }, { skipChatUpdate: true });
                hasAppendedRenderableAssistantMessageForSend = true;
              }
            } catch (e) {}
          }
          if (controllerForSend.signal.aborted) {
            logCancelledForSend = true;
            break;
          }
          for (var gdi = 0; gdi < toolCallsForLoop.length; gdi++) {
            if (controllerForSend.signal.aborted) {
              logCancelledForSend = true;
              break;
            }
            const tcNameForDocument = toolCallsForLoop[gdi].function && toolCallsForLoop[gdi].function.name;
            const toolResultForDocument = toolResultsForLoop[gdi];
            if (tcNameForDocument !== 'create_document' || !toolResultForDocument || !toolResultForDocument.ok) continue;
            if (typeof toolResultForDocument.dataUrl !== 'string' || toolResultForDocument.dataUrl.indexOf('data:') !== 0) continue;
            if (!panelDataRepoForImageInject || typeof panelDataRepoForImageInject.createAttachmentBlob !== 'function') continue;
            try {
              const filenameForDocument = String(toolResultForDocument.filename || 'generated-document');
              const blobRecordForDocument = await panelDataRepoForImageInject.createAttachmentBlob({
                name: filenameForDocument,
                kind: 'generated_document',
                mimeType: String(toolResultForDocument.mimeType || ''),
                dataUrl: toolResultForDocument.dataUrl,
                size: Number(toolResultForDocument.size) || toolResultForDocument.dataUrl.length,
                textContent: ''
              });
              if (controllerForSend.signal.aborted) {
                logCancelledForSend = true;
                if (blobRecordForDocument && blobRecordForDocument.id != null && typeof panelDataRepoForImageInject.deleteAttachmentBlob === 'function') {
                  try { await panelDataRepoForImageInject.deleteAttachmentBlob(Number(blobRecordForDocument.id)); } catch (e) {}
                }
                break;
              }
              if (blobRecordForDocument && blobRecordForDocument.id != null) {
                const blobIdForDocument = Number(blobRecordForDocument.id);
                setDocumentBlobCacheForPanelRuntime(blobIdForDocument, blobRecordForDocument);
                await appendMessageToChatForPanelRuntime(chatId, {
                  role: 'assistant',
                  content: '',
                  md: '[' + filenameForDocument.replace(/[\[\]]/g, '') + '](#abchat-docblob-' + blobIdForDocument + ')'
                }, { skipChatUpdate: true });
                hasAppendedRenderableAssistantMessageForSend = true;
              }
            } catch (e) {}
          }
          if (controllerForSend.signal.aborted) {
            logCancelledForSend = true;
            break;
          }
          if (S.activeChatId === chatId) {
            renderChatMessages();
            reattachLiveTurnBubbleForPanelRuntime(chatId);
            scrollChatToBottomForPanelRuntime();
            updateSessionTokenDisplayForPanelRuntime(logUsageForSend, preSendCostForSend + turnMainCostAccumForSend + sideCallCostForSend);
          }

          // Consecutive all-error guard: stop the loop if every tool in four back-to-back rounds failed
          const allToolsFailedForIter = toolResultsForLoop.every(function (r) {
            return !r || r.ok === false || (typeof r === 'object' && typeof r.error === 'string');
          });
          if (allToolsFailedForIter) {
            consecutiveEmptyItersForSend++;
          } else {
            consecutiveEmptyItersForSend = 0;
          }
          if (consecutiveEmptyItersForSend >= 4) {
            if (S.activeChatId === chatId) {
              appendSystemMsgToContainerForPanelRuntime('Agent stopped: four consecutive rounds of tool calls all returned errors. Review the results above and try a different approach.');
            }
            break;
          }

          // Sync any notes/tasks/questions mutated by agent tool calls into the in-memory store and DOM
          const mutatedNoteIdsForLoop = new Set();
          const mutatedTaskIdsForLoop = new Set();
          const mutatedQuestionIdsForLoop = new Set();
          for (var mi = 0; mi < toolCallsForLoop.length; mi++) {
            const tcNameForSync = toolCallsForLoop[mi].function && toolCallsForLoop[mi].function.name;
            const tcResultForSync = toolResultsForLoop[mi];
            if (tcResultForSync && tcResultForSync.ok && tcResultForSync.id != null &&
                (tcNameForSync === 'write' || tcNameForSync === 'edit')) {
              if (tcResultForSync.type === 'note') mutatedNoteIdsForLoop.add(Number(tcResultForSync.id));
              else if (tcResultForSync.type === 'task') mutatedTaskIdsForLoop.add(Number(tcResultForSync.id));
              else if (tcResultForSync.type === 'question') mutatedQuestionIdsForLoop.add(Number(tcResultForSync.id));
            }
          }
          if (mutatedNoteIdsForLoop.size > 0) scheduleStoreRefreshForPanelRuntime('notes');
          if (mutatedTaskIdsForLoop.size > 0) scheduleStoreRefreshForPanelRuntime('tasks');
          if (mutatedQuestionIdsForLoop.size > 0) scheduleStoreRefreshForPanelRuntime('questions');

          if (S.activeChatId === chatId) scrollChatToBottomForPanelRuntime();
          const lbsForToolsDone = liveTurnBubblesForPanelRuntime.get(chatId);
          if (lbsForToolsDone) lbsForToolsDone.toolsDoneAt = Date.now();
        }
        const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
        if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateChat === 'function' && CHAT_STORE_FOR_PANEL_RUNTIME[chatId]) {
          try {
            const persistedChatForPanelRuntime = await panelDataRepoForPanelRuntime.updateChat(chatId, {
              summary: getChatSummaryFromMessagesForPanelRuntime(CHAT_STORE_FOR_PANEL_RUNTIME[chatId].messages),
              updatedAt: new Date().toISOString(),
              lastModel: model
            });
            refreshChatStoreFromPersistedForPanelRuntime(persistedChatForPanelRuntime, { prepend: true });
          } catch (chatSyncErrorForPanelRuntime) {
            upsertChatUiForPanelRuntime(chatId, true);
          }
        }
      } catch (sendErrForPanelRuntime) {
        removeLiveTurnBubbleForPanelRuntime(chatId, true);
        if (sendErrForPanelRuntime && sendErrForPanelRuntime.name === "AbortError") {
          logCancelledForSend = true;
        } else {
          logStatusForSend = 'error';
          logErrorMsgForSend = sendErrForPanelRuntime ? (sendErrForPanelRuntime.message || 'Unknown error') : 'Unknown error';
          const rawErrMsgForSend = sendErrForPanelRuntime.message || "An error occurred.";
          let friendlyErrMsgForSend;
          if (sendErrForPanelRuntime.isCreditsError) {
            friendlyErrMsgForSend = rawErrMsgForSend;
          } else {
            const rawErrLower = rawErrMsgForSend.toLowerCase();
            const isNetworkErrForSend = rawErrLower.indexOf('failed to fetch') !== -1 ||
              rawErrLower.indexOf('networkerror') !== -1 ||
              rawErrLower.indexOf('network error') !== -1 ||
              rawErrLower.indexOf('load failed') !== -1;
            friendlyErrMsgForSend = isNetworkErrForSend
              ? (navigator.onLine ? "Request failed. The server may be temporarily unreachable." : "No internet connection.")
              : rawErrMsgForSend;
          }
          if (S.activeChatId === chatId) appendSystemMsgToContainerForPanelRuntime("Error: " + friendlyErrMsgForSend);
        }
      } finally {
        if (logCancelledForSend && logStatusForSend !== 'error') { logStatusForSend = 'cancelled'; }
        const apiLoggerForSend = (globalThis.ABChatContent || {}).apiLogger;
        if (apiLoggerForSend && typeof apiLoggerForSend.writeLog === 'function') {
          apiLoggerForSend.writeLog({
            requestType: 'chat',
            timestamp: new Date(logStartTimeForSend).toISOString(),
            chatId: chatId,
            model: logResolvedModelForSend || model,
            iterationCount: iterCount,
            totalLatencyMs: Date.now() - logStartTimeForSend,
            status: logStatusForSend,
            errorMessage: logErrorMsgForSend,
            requestMessages: logFirstMessagesForSend,
            apiParams: logApiParamsForSend,
            responseContent: logFinalResponseForSend,
            toolCalls: logAllToolCallsForSend,
            turns: logTurnsForSend,
            hookFirings: turnHookFiringsByIterForSend,
            usage: logUsageForSend
          }).catch(function () {});
        }
        if (logCancelledForSend && !hasPersistedNonUserMessagesForSend) {
          // Roll back any unpersisted user messages so the chat is clean for the next send.
          const chatForRollback = CHAT_STORE_FOR_PANEL_RUNTIME[chatId];
          if (chatForRollback && Array.isArray(chatForRollback.messages)) {
            chatForRollback.messages = chatForRollback.messages.filter(function (mForRollback) {
              return mForRollback && mForRollback._persistedToDb !== false;
            });
            if (S.activeChatId === chatId) {
              renderChatMessages();
              scrollChatToBottomForPanelRuntime();
            }
          }
        } else if (!hasAppendedRenderableAssistantMessageForSend && !logCancelledForSend) {
          // Turn ended (error or loop cap) without persisting any renderable assistant message
          // (text, generated image, generated document, etc.) and without user cancellation.
          // If anything renderable was already shown, the user has visible output and the
          // apologetic fallback would only confuse them, so we suppress it in that case.
          const fallbackTextForSend = AGENT_FALLBACK_RESPONSES_FOR_PANEL_RUNTIME[Math.floor(Math.random() * AGENT_FALLBACK_RESPONSES_FOR_PANEL_RUNTIME.length)];
          try {
            await persistPendingUserMessagesForChatForPanelRuntime(chatId, { touchChat: false });
            await appendMessageToChatForPanelRuntime(chatId, {
              role: 'assistant',
              content: fallbackTextForSend,
              md: fallbackTextForSend
            });
            if (S.activeChatId === chatId) {
              renderChatMessages();
              scrollChatToBottomForPanelRuntime();
            }
          } catch (fallbackErrForSend) {}
        }
        const lbsForFinally = liveTurnBubblesForPanelRuntime.get(chatId);
        // Flush any pending debounced text so receivers see the final tokens
        // before the end event, then signal end so they tear down the bubble
        // and refresh from the DB to pick up the persisted final message.
        flushStreamTextBroadcastForPanelRuntime(chatId);
        broadcastStreamEventForPanelRuntime("stream_end", chatId, null);
        removeLiveTurnBubbleForPanelRuntime(chatId, lbsForFinally ? lbsForFinally.hasText : true);
        clearTimeout(turnTotalTimeoutIdForSend);
        sendingChatsForPanelRuntime.delete(chatId);
        if (contentNamespaceForPanelRuntime.state) {
          contentNamespaceForPanelRuntime.state.agentIsWorking = sendingChatsForPanelRuntime.size > 0;
        }
        const chatRecordForSessionCost = CHAT_STORE_FOR_PANEL_RUNTIME[chatId];
        if (chatRecordForSessionCost && (turnMainCostAccumForSend > 0 || sideCallCostForSend > 0)) {
          chatRecordForSessionCost.sessionCost = (chatRecordForSessionCost.sessionCost || 0) + turnMainCostAccumForSend + sideCallCostForSend;
        }
        if (S.activeChatId === chatId) rebuildTokenCounterFromMessagesForPanelRuntime(chatId);
        setSendingUIStateForPanelRuntime();
        syncMainChatListItemForPanelRuntime(chatId);
        if (S.activeChatId === chatId) {
          const chatTaForAutoFocus = root.querySelector('.chat-textarea');
          if (chatTaForAutoFocus) chatTaForAutoFocus.focus();
        }
      }
    }

    function cancelSendForPanelRuntime() {
      // Local stream: abort the AbortController directly.
      const ctrl = sendingChatsForPanelRuntime.get(S.activeChatId);
      if (ctrl) { ctrl.abort(); return; }
      // Remote stream: ask the originator (whichever tab it is) to abort.
      // The SW fans the request out to every tab; only the originator with
      // a matching AbortController actually aborts.
      if (remoteStreamingChatsForPanelRuntime.has(S.activeChatId)) {
        try {
          chrome.runtime.sendMessage({
            action: "streamCancelRequest",
            chatId: Number(S.activeChatId)
          }, function () { void chrome.runtime.lastError; });
        } catch (errorForRemoteCancel) {}
      }
    }

    // SW-delivered cancel-from-receiver. Abort the local controller if this
    // tab is the originator for the requested chat; otherwise ignore.
    function handleRemoteCancelDeliverForPanelRuntime(chatIdForCancel) {
      const numericChatIdForCancel = Number(chatIdForCancel);
      if (!Number.isFinite(numericChatIdForCancel)) return;
      const ctrlForCancel = sendingChatsForPanelRuntime.get(numericChatIdForCancel);
      if (ctrlForCancel) ctrlForCancel.abort();
    }

    async function saveApiKeyFromSettingsForPanelRuntime() {
      const inputForKey = root.getElementById('settings-api-key-input');
      if (!inputForKey) return;
      const keyVal = inputForKey.value.trim();
      await saveApiKeyForPanelRuntime(keyVal);
      await clearCachedModelsForPanelRuntime();
      initModelSelectsForPanelRuntime();
    }

    async function loadApiKeyIntoSettingsForPanelRuntime() {
      const inputForKey = root.getElementById('settings-api-key-input');
      if (!inputForKey) return;
      const key = await getApiKeyForPanelRuntime();
      inputForKey.value = key;
    }

    async function loadAgentRulesIntoSettingsForPanelRuntime() {
      const storageManagerForRuntime = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForRuntime) return;
      const settings = await storageManagerForRuntime.getSettings();
      currentAgentRulesForPanelRuntime = settings.agentRules || '';
      currentAgentRulesUpdatedAtForPanelRuntime =
        typeof settings.agentRulesUpdatedAt === 'number' ? settings.agentRulesUpdatedAt : 0;
      const el = root.getElementById('settings-agent-rules-input');
      if (el) {
        el.value = currentAgentRulesForPanelRuntime;
        el.dataset.agentRulesBaseUpdatedAt = String(currentAgentRulesUpdatedAtForPanelRuntime);
        updateAutoExpandForTextareaForPanelRuntime(el);
      }
    }

    function showAgentRulesNoticeForPanelRuntime(textForNotice, isConflictForNotice) {
      const msgElForNotice = root.getElementById('agent-rules-saved-msg');
      if (!msgElForNotice) return;
      msgElForNotice.textContent = textForNotice;
      if (isConflictForNotice) {
        msgElForNotice.classList.add('stg-agent-rules-conflict-msg');
      } else {
        msgElForNotice.classList.remove('stg-agent-rules-conflict-msg');
      }
      if (!isConflictForNotice) {
        setTimeout(function () {
          if (msgElForNotice.textContent === textForNotice) msgElForNotice.textContent = '';
        }, 2000);
      }
    }

    async function loadBehaviourSettingsForPanelRuntime() {
      const storageManagerForBehaviour = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForBehaviour) return;
      const settingsForBehaviour = await storageManagerForBehaviour.getSettings();
      currentReminderLeadTimeForPanelRuntime = typeof settingsForBehaviour.reminderLeadTime === 'number' ? settingsForBehaviour.reminderLeadTime : 15;
      const alertToggleForBehaviour = root.getElementById('settings-alert-sound-toggle');
      if (alertToggleForBehaviour) alertToggleForBehaviour.checked = settingsForBehaviour.alertSound !== false;
      const leadTimeInputForBehaviour = root.getElementById('settings-reminder-lead-time');
      if (leadTimeInputForBehaviour) leadTimeInputForBehaviour.value = currentReminderLeadTimeForPanelRuntime;
    }

    async function saveAlertSoundForPanelRuntime(checked) {
      const storageManagerForAlert = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForAlert) return;
      await storageManagerForAlert.saveSettings({ alertSound: Boolean(checked) });
    }

    async function saveReminderLeadTimeForPanelRuntime(value) {
      const storageManagerForLead = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForLead) return;
      const parsedForLead = parseInt(value, 10);
      if (isNaN(parsedForLead) || parsedForLead < 0) return;
      currentReminderLeadTimeForPanelRuntime = parsedForLead;
      await storageManagerForLead.saveSettings({ reminderLeadTime: parsedForLead });
    }

    async function saveAgentRulesFromSettingsForPanelRuntime() {
      const storageManagerForRuntime = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForRuntime) return;
      const el = root.getElementById('settings-agent-rules-input');
      if (!el) return;
      const draftValueForSave = el.value.trim();
      const baselineTsForSave = Number(el.dataset.agentRulesBaseUpdatedAt || '0') || 0;
      const freshSettingsForSave = await storageManagerForRuntime.getSettings();
      const storedTsForSave =
        typeof freshSettingsForSave.agentRulesUpdatedAt === 'number' ? freshSettingsForSave.agentRulesUpdatedAt : 0;
      if (storedTsForSave !== baselineTsForSave) {
        currentAgentRulesForPanelRuntime = freshSettingsForSave.agentRules || '';
        currentAgentRulesUpdatedAtForPanelRuntime = storedTsForSave;
        el.dataset.agentRulesBaseUpdatedAt = String(storedTsForSave);
        showAgentRulesNoticeForPanelRuntime(
          'Rules changed in another tab. Click Save again to overwrite.',
          true
        );
        return;
      }
      const mergedForSave = await storageManagerForRuntime.saveSettings({ agentRules: draftValueForSave });
      currentAgentRulesForPanelRuntime = mergedForSave.agentRules || '';
      currentAgentRulesUpdatedAtForPanelRuntime =
        typeof mergedForSave.agentRulesUpdatedAt === 'number' ? mergedForSave.agentRulesUpdatedAt : 0;
      el.dataset.agentRulesBaseUpdatedAt = String(currentAgentRulesUpdatedAtForPanelRuntime);
      showAgentRulesNoticeForPanelRuntime('Saved', false);
    }

    var agentRulesStorageSyncListenerForPanelRuntime = null;
    function bindAgentRulesStorageSyncForPanelRuntime() {
      try {
        if (agentRulesStorageSyncListenerForPanelRuntime) {
          chrome.storage.onChanged.removeListener(agentRulesStorageSyncListenerForPanelRuntime);
          agentRulesStorageSyncListenerForPanelRuntime = null;
        }
        var capturedGenForAgentRulesSync = window.abchatListenerGeneration || 0;
        agentRulesStorageSyncListenerForPanelRuntime = function agentRulesStorageSyncHandlerForPanelRuntime(changes, area) {
          if ((window.abchatListenerGeneration || 0) !== capturedGenForAgentRulesSync) {
            chrome.storage.onChanged.removeListener(agentRulesStorageSyncListenerForPanelRuntime);
            agentRulesStorageSyncListenerForPanelRuntime = null;
            return;
          }
          if (area !== 'sync' || !changes.abchatSettings) return;
          const newSettingsForSync = changes.abchatSettings.newValue;
          if (!newSettingsForSync || typeof newSettingsForSync !== 'object') return;
          const newRulesForSync = typeof newSettingsForSync.agentRules === 'string' ? newSettingsForSync.agentRules : '';
          const newRulesTsForSync =
            typeof newSettingsForSync.agentRulesUpdatedAt === 'number' ? newSettingsForSync.agentRulesUpdatedAt : 0;
          if (newRulesTsForSync === currentAgentRulesUpdatedAtForPanelRuntime &&
              newRulesForSync === currentAgentRulesForPanelRuntime) {
            return;
          }
          const elForSync = root.getElementById('settings-agent-rules-input');
          if (!elForSync) {
            currentAgentRulesForPanelRuntime = newRulesForSync;
            currentAgentRulesUpdatedAtForPanelRuntime = newRulesTsForSync;
            return;
          }
          const hasLocalEditsForSync = elForSync.value !== currentAgentRulesForPanelRuntime;
          if (hasLocalEditsForSync) {
            currentAgentRulesForPanelRuntime = newRulesForSync;
            currentAgentRulesUpdatedAtForPanelRuntime = newRulesTsForSync;
            elForSync.dataset.agentRulesBaseUpdatedAt = String(newRulesTsForSync);
            showAgentRulesNoticeForPanelRuntime(
              'Rules updated in another tab. Save to overwrite, or discard your edits.',
              true
            );
          } else {
            currentAgentRulesForPanelRuntime = newRulesForSync;
            currentAgentRulesUpdatedAtForPanelRuntime = newRulesTsForSync;
            elForSync.value = newRulesForSync;
            elForSync.dataset.agentRulesBaseUpdatedAt = String(newRulesTsForSync);
            updateAutoExpandForTextareaForPanelRuntime(elForSync);
          }
        };
        chrome.storage.onChanged.addListener(agentRulesStorageSyncListenerForPanelRuntime);
      } catch (e) {}
    }

    function formatBytesForPanelRuntime(bytesForPanelRuntime) {
      var numBytesForPanelRuntime = Number(bytesForPanelRuntime) || 0;
      if (numBytesForPanelRuntime >= 1024 * 1024) {
        return (numBytesForPanelRuntime / (1024 * 1024)).toFixed(1) + ' MB';
      }
      if (numBytesForPanelRuntime >= 1024) {
        return (numBytesForPanelRuntime / 1024).toFixed(1) + ' KB';
      }
      return numBytesForPanelRuntime + ' B';
    }

    async function loadStorageEstimateForPanelRuntime() {
      var labelForPanelRuntime = root.getElementById('settings-storage-estimate');
      if (!labelForPanelRuntime) return;
      var responseForPanelRuntime = await sendRuntimeMessageForPanelRuntime({ type: 'getStorageEstimate' });
      if (!responseForPanelRuntime || !responseForPanelRuntime.ok) {
        labelForPanelRuntime.textContent = 'Unavailable';
        return;
      }
      labelForPanelRuntime.textContent =
        formatBytesForPanelRuntime(responseForPanelRuntime.usage) +
        ' of ' +
        formatBytesForPanelRuntime(responseForPanelRuntime.quota);
    }

    async function loadDeleteChatsOlderThanSettingForPanelRuntime() {
      var storageManagerForPanelRuntime = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForPanelRuntime) return;
      var settingsForPanelRuntime = await storageManagerForPanelRuntime.getSettings();
      var selectForPanelRuntime = root.getElementById('settings-delete-chats-older-than');
      if (!selectForPanelRuntime) return;
      var daysForPanelRuntime = settingsForPanelRuntime.deleteChatsOlderThanDays;
      selectForPanelRuntime.value = (daysForPanelRuntime != null && Number.isFinite(Number(daysForPanelRuntime)))
        ? String(daysForPanelRuntime)
        : '';
    }

    async function saveDeleteChatsOlderThanForPanelRuntime(valueForPanelRuntime) {
      var storageManagerForPanelRuntime = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForPanelRuntime) return;
      var parsedDaysForPanelRuntime = valueForPanelRuntime === '' ? null : parseInt(valueForPanelRuntime, 10);
      await storageManagerForPanelRuntime.saveSettings({ deleteChatsOlderThanDays: parsedDaysForPanelRuntime });
    }

    async function autoDeleteOldChatsForPanelRuntime() {
      var storageManagerForPanelRuntime = (globalThis.ABChatShared || {}).storageManager;
      if (!storageManagerForPanelRuntime) return;
      var settingsForPanelRuntime = await storageManagerForPanelRuntime.getSettings();
      var daysForPanelRuntime = settingsForPanelRuntime.deleteChatsOlderThanDays;
      if (daysForPanelRuntime == null || !Number.isFinite(Number(daysForPanelRuntime)) || Number(daysForPanelRuntime) <= 0) return;
      var repoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (!repoForPanelRuntime || typeof repoForPanelRuntime.deleteChatsOlderThan !== 'function') return;
      repoForPanelRuntime.deleteChatsOlderThan(Number(daysForPanelRuntime), getPendingBlobIdsForPanelRuntime()).catch(function () {});
    }

    async function pruneOrphanedBlobsFromSettingsForPanelRuntime() {
      var resultElForPanelRuntime = root.getElementById('settings-prune-blobs-result');
      if (resultElForPanelRuntime) resultElForPanelRuntime.textContent = 'Scanning...';
      var repoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (!repoForPanelRuntime || typeof repoForPanelRuntime.pruneOrphanedBlobs !== 'function') {
        if (resultElForPanelRuntime) resultElForPanelRuntime.textContent = 'Unavailable';
        return;
      }
      try {
        var resultForPanelRuntime = await repoForPanelRuntime.pruneOrphanedBlobs(getPendingBlobIdsForPanelRuntime());
        var deletedCountForPanelRuntime = (resultForPanelRuntime && resultForPanelRuntime.deleted) || 0;
        if (resultElForPanelRuntime) {
          resultElForPanelRuntime.textContent = deletedCountForPanelRuntime + ' blob(s) removed';
          setTimeout(function () { resultElForPanelRuntime.textContent = ''; }, 3000);
        }
        loadStorageEstimateForPanelRuntime();
      } catch (errForPanelRuntime) {
        if (resultElForPanelRuntime) resultElForPanelRuntime.textContent = 'Failed';
      }
    }

    /* ============================================================
      DRAGGABLE REDUCED PANEL
    ============================================================ */
    function reclampPanelPositionForPanelRuntime(optionsForReclamp) {
      if (S.mode !== 'reduced') return false;
      // Edge-anchored model: on viewport changes, re-resolve from the last
      // known anchor against the new viewport. The anchor itself does not
      // change, so no cross-tab write is needed (other tabs resolve the
      // same anchor against their own viewports).
      const rectForReclamp = host.getBoundingClientRect();
      const widthForReclamp = host.offsetWidth || rectForReclamp.width || 0;
      const heightForReclamp = host.offsetHeight || rectForReclamp.height || 0;
      if (currentPanelAnchorForPanelRuntime) {
        applyPanelAnchorInlineForPanelRuntime(currentPanelAnchorForPanelRuntime, widthForReclamp, heightForReclamp);
        return true;
      }
      // No anchor recorded yet (panel never dragged this session): just
      // clamp the current pixel position back into the viewport.
      const styleLeftForReclamp = parseInt(host.style.left, 10);
      const styleTopForReclamp = parseInt(host.style.top, 10);
      const currentLeftForReclamp = Number.isFinite(styleLeftForReclamp) ? styleLeftForReclamp : rectForReclamp.left;
      const currentTopForReclamp = Number.isFinite(styleTopForReclamp) ? styleTopForReclamp : rectForReclamp.top;
      if (!Number.isFinite(currentLeftForReclamp) || !Number.isFinite(currentTopForReclamp)) return false;
      const clampedForReclamp = clampToViewportForMirrorForPanelRuntime(
        currentLeftForReclamp, currentTopForReclamp, widthForReclamp, heightForReclamp
      );
      if (clampedForReclamp.left === currentLeftForReclamp && clampedForReclamp.top === currentTopForReclamp) {
        return false;
      }
      host.style.left = clampedForReclamp.left + 'px';
      host.style.top = clampedForReclamp.top + 'px';
      host.style.right = 'auto';
      return true;
    }

    (function() {
      let isDragging = false;
      let dragStartX, dragStartY, panelStartX, panelStartY;

      const header = root.querySelector('.panel-header');

      header.addEventListener('mousedown', e => {
        if (S.mode !== 'reduced') return;
        if (e.target.closest('button')) return;
        isDragging = true;
        const rect = host.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panelStartX = rect.left;
        panelStartY = rect.top;
        e.preventDefault();
      });

      document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const newX = panelStartX + dx;
        const newY = panelStartY + dy;
        const pw = host.offsetWidth;
        const ph = host.offsetHeight;
        const clampedX = Math.max(0, Math.min(window.innerWidth - pw, newX));
        const clampedY = Math.max(0, Math.min(window.innerHeight - ph, newY));
        host.style.left = clampedX + 'px';
        host.style.top = clampedY + 'px';
        host.style.right = 'auto';
      });

      document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        // Position is only meaningful in reduced mode; expanded clears it.
        if (S.mode === 'reduced') {
          const finalLeftForDragEnd = parseInt(host.style.left, 10);
          const finalTopForDragEnd = parseInt(host.style.top, 10);
          if (Number.isFinite(finalLeftForDragEnd) && Number.isFinite(finalTopForDragEnd)) {
            const anchorForDragEnd = computePanelAnchorForPanelRuntime(
              finalLeftForDragEnd, finalTopForDragEnd,
              host.offsetWidth, host.offsetHeight
            );
            currentPanelAnchorForPanelRuntime = anchorForDragEnd;
            writePanelStateSyncForPanelRuntime({ panelAnchor: anchorForDragEnd });
          }
        }
      });

      // Re-clamp the panel into view when the viewport shrinks (window resize,
      // device rotation, extended-display attach/detach). Without this, a panel
      // previously positioned for a larger viewport stays at its old inline
      // coords and ends up partially or fully off-screen.
      var capturedGenForPanelReclamp = window.abchatListenerGeneration || 0;
      function onViewportChangedForPanelReclamp() {
        if ((window.abchatListenerGeneration || 0) !== capturedGenForPanelReclamp) {
          window.removeEventListener('resize', onViewportChangedForPanelReclamp);
          window.removeEventListener('orientationchange', onViewportChangedForPanelReclamp);
          return;
        }
        try {
          if (!chrome.runtime || !chrome.runtime.id) {
            window.removeEventListener('resize', onViewportChangedForPanelReclamp);
            window.removeEventListener('orientationchange', onViewportChangedForPanelReclamp);
            return;
          }
        } catch (e) {
          return;
        }
        reclampPanelPositionForPanelRuntime();
      }
      window.addEventListener('resize', onViewportChangedForPanelReclamp);
      window.addEventListener('orientationchange', onViewportChangedForPanelReclamp);
    })();

    /* ============================================================
      INIT
    ============================================================ */
    // Seed mode and theme from the current shadow DOM, not hardcoded
    // defaults. panel.js pre-applies the user's stored mode/theme to the
    // markup before unhiding the shadow host, so the host class and
    // data-theme already reflect the saved state by the time we get here.
    // Reading them back instead of hardcoding 'reduced' / 'light' keeps
    // S.mode and S.theme in sync with the visible DOM, avoiding a transient
    // mismatch window before panelStateSync.init (deferred via setTimeout
    // at the end of this function) re-applies stored state.
    const initialModeForPanelRuntime = host.classList.contains('mode-expanded') ? 'expanded' : 'reduced';
    const initialThemeForPanelRuntime = host.dataset.theme === 'dark' ? 'dark' : 'light';
    setMode(initialModeForPanelRuntime, { skipStateSync: true });
    setTheme(initialThemeForPanelRuntime); // overwritten async below if stored theme differs
    setTab('chats', { skipStateSync: true });

    // Start from the "new" state for each module
    showChatMessages(false);   // chat: empty state visible, no conversation loaded
    updateChatBackTitleForPanelRuntime();
    showNoteForm(false);       // notes: pane placeholder, no form open
    showTaskForm(false);       // tasks: pane placeholder, no form open
    bindAutoExpandForTextareasForPanelRuntime(root.getElementById('abchat-panel-mount') || document);

    function closeAttachPicker() {
      const picker = root.getElementById('attach-picker');
      const attachBtn = root.getElementById('attach-btn');
      if (picker) picker.classList.remove('open');
      if (attachBtn) attachBtn.classList.remove('open');
    }

    /* ============================================================
      SPREADSHEET FROM CLIPBOARD
    ============================================================ */
    function parseTsvForSpreadsheet(text) {
      var lines = text.split(/\r?\n/);
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      if (lines.length < 2) return null;
      var rows = lines.map(function(line) {
        return line.replace(/\t$/, '').split('\t');
      });
      var colCount = rows[0].length;
      if (colCount < 2) return null;
      if (!rows.every(function(row) { return row.length >= 2; })) return null;
      return rows.map(function(row) {
        while (row.length < colCount) row.push('');
        return row.slice(0, colCount);
      });
    }

    function parseCsvForSpreadsheet(text) {
      var lines = text.split(/\r?\n/);
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      if (lines.length < 2) return null;
      var rows = lines.map(function(line) {
        var fields = [];
        var inQuote = false;
        var field = '';
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (ch === '"' && !inQuote) {
            inQuote = true;
          } else if (ch === '"' && inQuote && line[i + 1] === '"') {
            field += '"'; i++;
          } else if (ch === '"' && inQuote) {
            inQuote = false;
          } else if (ch === ',' && !inQuote) {
            fields.push(field); field = '';
          } else {
            field += ch;
          }
        }
        fields.push(field);
        return fields;
      });
      var colCount = rows[0].length;
      if (colCount < 2) return null;
      if (!rows.every(function(row) { return row.length === colCount; })) return null;
      return rows;
    }

    function parseTsvOrCsvForSpreadsheet(text) {
      if (!text || typeof text !== 'string') return null;
      if (text.indexOf('\t') !== -1) return parseTsvForSpreadsheet(text);
      return parseCsvForSpreadsheet(text);
    }

    function detectHeadersForSpreadsheet(rows) {
      if (!rows || rows.length < 2) return null;
      var firstRow = rows[0];
      var secondRow = rows[1];
      var firstHasNumber = firstRow.some(function(cell) {
        var t = cell.trim();
        return t !== '' && isFinite(Number(t));
      });
      if (firstHasNumber) return false;
      var firstAllNonEmpty = firstRow.every(function(cell) { return cell.trim() !== ''; });
      if (!firstAllNonEmpty) return null;
      var secondHasNumber = secondRow.some(function(cell) {
        var t = cell.trim();
        return t !== '' && isFinite(Number(t));
      });
      if (secondHasNumber) return true;
      return null;
    }

    function rowsToJsonForSpreadsheet(rows, hasHeaders) {
      if (hasHeaders) {
        var headers = rows[0].map(function(h, i) { return h.trim() || ('col' + (i + 1)); });
        return rows.slice(1).map(function(row) {
          var obj = {};
          headers.forEach(function(h, i) { obj[h] = row[i] !== undefined ? row[i].trim() : ''; });
          return obj;
        });
      }
      return rows.map(function(row) { return row.map(function(cell) { return cell.trim(); }); });
    }

    var MAX_SPREADSHEET_ROWS_FOR_PANEL_RUNTIME = 200;

    function finalizeSpreadsheetAttachmentForPanelRuntime(rows, hasHeaders) {
      var dataRows = hasHeaders ? rows.slice(1) : rows;
      var totalDataRows = dataRows.length;
      var truncated = totalDataRows > MAX_SPREADSHEET_ROWS_FOR_PANEL_RUNTIME;
      if (truncated) dataRows = dataRows.slice(0, MAX_SPREADSHEET_ROWS_FOR_PANEL_RUNTIME);
      var colCount = rows[0] ? rows[0].length : 0;
      var rowsForJson = hasHeaders ? [rows[0]].concat(dataRows) : dataRows;
      var jsonData = rowsToJsonForSpreadsheet(rowsForJson, hasHeaders);
      var chipLabel = truncated
        ? 'Spreadsheet (' + MAX_SPREADSHEET_ROWS_FOR_PANEL_RUNTIME + ' of ' + totalDataRows + ' rows × ' + colCount + ' cols, truncated)'
        : 'Spreadsheet (' + totalDataRows + ' rows × ' + colCount + ' cols)';
      addInputChipForPanelRuntime({
        type: 'spreadsheet',
        label: chipLabel,
        content: JSON.stringify(jsonData, null, 2),
        kind: 'spreadsheet',
        mimeType: 'application/json'
      });
      navigator.clipboard.writeText('').catch(function() {});
    }

    async function handleSpreadsheetFromClipboardForPanelRuntime() {
      closeAttachPicker();
      var chatMain = root.getElementById('chat-main');
      var text;
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        showInfoPromptForPanelRuntime(
          root.querySelector('.panel-content'),
          'Clipboard access was denied. <br><br>Please allow clipboard access and try again.',
          'Got it'
        );
        return;
      }
      var rows = parseTsvOrCsvForSpreadsheet(text);
      if (!rows) {
        showInfoPromptForPanelRuntime(
          root.querySelector('.panel-content'),
          'No spreadsheet data found in the clipboard.<br><br> In your spreadsheet, select the cells you want, copy them with Ctrl/Cmd+C, then click “Spreadsheet in page” again.',
          'Got it'
        );
        return;
      }
      var headerDetection = detectHeadersForSpreadsheet(rows);
      if (headerDetection === null) {
        showConfirmPromptForPanelRuntime(
          root.querySelector('.panel-content'),
          'Does your spreadsheet data have a header row (column names in the first row)?',
          'Yes, use as headers',
          function() { finalizeSpreadsheetAttachmentForPanelRuntime(rows, true); },
          function() { finalizeSpreadsheetAttachmentForPanelRuntime(rows, false); }
        );
        return;
      }
      finalizeSpreadsheetAttachmentForPanelRuntime(rows, headerDetection);
    }

    /* ============================================================
      NOTE ITEM — STAR TOGGLE + DROPDOWN
    ============================================================ */
    function toggleNoteStar(btn) {
      const isStarred = btn.classList.contains('starred');
      const newStarred = !isStarred;
      const noteItemForStar = btn.closest('.note-item');
      const noteIdForStar = noteItemForStar ? Number(noteItemForStar.dataset.noteId) : null;
      if (!noteIdForStar || !NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForStar]) return;

      NOTE_STORE_FOR_PANEL_RUNTIME[noteIdForStar].starred = newStarred;
      btn.classList.toggle('starred', newStarred);
      btn.innerHTML = newStarred ? ic.starFilled12 : ic.starEmpty12;
      btn.title = newStarred ? 'Unfavorite' : 'Favorite';

      const repoForStar = getPanelDataRepoForPanelRuntime();
      if (repoForStar && typeof repoForStar.updateNote === 'function') {
        repoForStar.updateNote(noteIdForStar, { starred: newStarred }, { saveVersion: false }).catch(function () {});
      }

      const favsBtn = root.getElementById('note-favs-btn');
      if (favsBtn && favsBtn.classList.contains('active')) {
        applyNoteFavsFilter(true);
      }
    }

    function toggleNoteFavs(btn) {
      btn.classList.toggle('active');
      const on = btn.classList.contains('active');
      btn.innerHTML = on ? (ic.starFilled12 + ' Favs') : (ic.starEmpty12 + ' Favs');
      applyNoteFavsFilter(on);
    }

    function applyNoteFavsFilter(on) {
      root.querySelectorAll('.note-item').forEach(item => {
        if (on) {
          item.style.display = item.querySelector('.ni-btn.starred') ? '' : 'none';
        } else {
          item.style.display = '';
        }
      });
    }

    function toggleNoteDropdown(btn) {
      const wasOpen = preclickOpenStateForPanelRuntime;
      preclickOpenStateForPanelRuntime = null;
      // closeAllDropdownsForPanelRuntime already ran via the root capture handler
      if (!wasOpen) {
        const dropdown = btn.nextElementSibling;
        if (dropdown) {
          dropdown.classList.add('open');
          btn.closest('.note-item')?.classList.add('ni-dropdown-open');
        }
      }
    }

    /* ============================================================
      TAB PICKER
    ============================================================ */
    function getPickerTabsForPanelRuntime() {
      return Array.isArray(S.pickerTabs) ? S.pickerTabs.slice() : [];
    }

    function isTabUrlAccessibleForPanelRuntime(urlForPanelRuntime) {
      if (!urlForPanelRuntime) return false;
      const restrictedPrefixes = [
        'chrome://', 'chrome-extension://', 'chrome-devtools://',
        'about:', 'edge://', 'brave://', 'opera://', 'vivaldi://',
        'https://chrome.google.com/webstore/', 'https://chromewebstore.google.com/'
      ];
      const lowerUrl = urlForPanelRuntime.toLowerCase();
      return !restrictedPrefixes.some(prefix => lowerUrl.startsWith(prefix));
    }

    function fetchOpenTabsForPanelRuntime() {
      return new Promise(function (resolveForPanelRuntime) {
        try {
          chrome.runtime.sendMessage({ action: 'abchatGetOpenTabs' }, function (responseForPanelRuntime) {
            if (chrome.runtime.lastError || !responseForPanelRuntime || !responseForPanelRuntime.ok || !Array.isArray(responseForPanelRuntime.tabs)) {
              resolveForPanelRuntime([]);
              return;
            }
            // Group tabs by windowId. Current window first, then others in order of first appearance.
            var windowOrderForTabs = [];
            var windowMapForTabs = {};
            responseForPanelRuntime.tabs.forEach(function (tabForPanelRuntime) {
              var wid = Number(tabForPanelRuntime.windowId);
              if (!windowMapForTabs[wid]) {
                windowMapForTabs[wid] = { isCurrentWindow: Boolean(tabForPanelRuntime.isCurrentWindow), tabs: [] };
                windowOrderForTabs.push(wid);
              }
              var urlForTab = String(tabForPanelRuntime.url || '');
              windowMapForTabs[wid].tabs.push({
                id: Number(tabForPanelRuntime.id),
                windowId: wid,
                isCurrentWindow: Boolean(tabForPanelRuntime.isCurrentWindow),
                title: String(tabForPanelRuntime.title || tabForPanelRuntime.url || 'Untitled tab'),
                excerpt: urlForTab,
                url: urlForTab,
                favicon: tabForPanelRuntime.favIconUrl ? ic.globe14 : ic.layers14,
                active: Boolean(tabForPanelRuntime.active),
                discarded: Boolean(tabForPanelRuntime.discarded),
                accessible: isTabUrlAccessibleForPanelRuntime(urlForTab)
              });
            });
            // Sort so current window comes first
            windowOrderForTabs.sort(function (a, b) {
              var aIsCurrent = windowMapForTabs[a].isCurrentWindow ? 0 : 1;
              var bIsCurrent = windowMapForTabs[b].isCurrentWindow ? 0 : 1;
              return aIsCurrent - bIsCurrent;
            });
            // Flatten into annotated tab list with windowLabel injected
            var otherWindowCounterForTabs = 1;
            var flatTabsForPanelRuntime = [];
            windowOrderForTabs.forEach(function (wid) {
              var group = windowMapForTabs[wid];
              var label = group.isCurrentWindow
                ? 'This Window'
                : 'Window ' + (++otherWindowCounterForTabs);
              group.tabs.forEach(function (tabForFlat, idxForFlat) {
                tabForFlat.windowLabel = idxForFlat === 0 ? label : null;
              });
              flatTabsForPanelRuntime = flatTabsForPanelRuntime.concat(group.tabs);
            });
            resolveForPanelRuntime(flatTabsForPanelRuntime);
          });
        } catch (errorForPanelRuntime) {
          resolveForPanelRuntime([]);
        }
      });
    }

    async function openTabPicker() {
      closeAttachPicker();
      S.pickerMode = 'tab';
      root.getElementById('pk-title').textContent = 'Attach Browser Tab Content';
      root.getElementById('pk-search').placeholder = 'Search open tabs...';
      S.pickerTabs = await fetchOpenTabsForPanelRuntime();
      renderTabPickerList(getPickerTabsForPanelRuntime());
      pickerOverlay.classList.remove('hidden');
    }

    function renderTabPickerList(tabs) {
      const list = root.getElementById('pk-list');
      list.innerHTML = '';
      tabs.forEach((tab) => {
        if (tab.windowLabel) {
          const header = document.createElement('div');
          header.className = 'pk-window-group-header';
          header.textContent = tab.windowLabel;
          list.appendChild(header);
        }
        const div = document.createElement('div');
        const isActive = Boolean(tab && tab.active);
        const isAccessible = tab && tab.accessible !== false;
        const isDiscarded = Boolean(tab && tab.discarded);
        div.className = 'pk-item' + (isAccessible ? '' : ' pk-item--inaccessible');
        div.innerHTML = `
          <div class="pk-item-icon tab-icon">${tab.favicon}</div>
          <div class="pk-item-body">
            <div class="pk-item-title" style="display:flex;align-items:center;gap:6px;overflow:hidden">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${escHtml(tab.title)}</span>
              ${isActive && tab.isCurrentWindow ? '<span class="pk-tab-badge pk-tab-badge--current">Current</span>' : ''}
              ${isDiscarded && isAccessible ? '<span class="pk-tab-badge pk-tab-badge--sleeping" title="Chrome suspended this tab to save memory. Selecting it will reload the page.">Sleeping</span>' : ''}
              ${!isAccessible ? '<span class="pk-tab-badge pk-tab-badge--blocked" title="This page cannot be read by extensions">Not accessible</span>' : ''}
            </div>
            <div class="pk-item-excerpt">${escHtml(tab.excerpt)}</div>
          </div>`;
        div.onclick = () => selectTabItem(tab);
        list.appendChild(div);
      });
    }

    async function selectTabItem(tab) {
      if (tab && tab.accessible === false) {
        closePickerModal();
        appendSystemMsgToContainerForPanelRuntime(
          'This tab cannot be read. Browser system pages (like Settings, the New Tab page, and the Chrome Web Store) block extension access.'
        );
        return;
      }
      closePickerModal();
      const pendingChipForPanelRuntime = addInputChipForPanelRuntime({
        type: 'tab',
        label: String((tab && tab.title) || (tab && tab.url) || 'Browser Tab'),
        status: 'loading',
        statusText: tab && tab.discarded ? 'Waking tab...' : 'Reading tab content...'
      });
      try {
        const tabContentResultForPanelRuntime = await fetchTabPageContentForPanelRuntime(tab && tab.id);
        if (!tabContentResultForPanelRuntime.ok) {
          if (pendingChipForPanelRuntime) {
            setInputChipStatusForPanelRuntime(
              pendingChipForPanelRuntime,
              'error',
              tabContentResultForPanelRuntime.error || 'Could not read tab content.'
            );
          }
          appendSystemMsgToContainerForPanelRuntime(
            tabContentResultForPanelRuntime.error || 'Could not read tab content.'
          );
          return;
        }
        if (!pendingChipForPanelRuntime) return;
        pendingChipForPanelRuntime.dataset.attachType = 'tab';
        pendingChipForPanelRuntime.dataset.attachName = String((tab && tab.title) || (tab && tab.url) || 'Browser Tab');
        pendingChipForPanelRuntime.dataset.attachContent = String(tabContentResultForPanelRuntime.content || '');
        pendingChipForPanelRuntime.dataset.attachMimeType = 'text/html';
        pendingChipForPanelRuntime.dataset.attachKind = 'tab';
        pendingChipForPanelRuntime.dataset.attachSize = String(
          Number((tabContentResultForPanelRuntime.content || '').length) || 0
        );
        pendingChipForPanelRuntime.dataset.attachRefId = '';
        setInputChipStatusForPanelRuntime(pendingChipForPanelRuntime, '', '');
      } catch (errorForPanelRuntime) {
        if (pendingChipForPanelRuntime) {
          setInputChipStatusForPanelRuntime(
            pendingChipForPanelRuntime,
            'error',
            errorForPanelRuntime && errorForPanelRuntime.message
              ? errorForPanelRuntime.message
              : 'Could not read tab content.'
          );
        }
        appendSystemMsgToContainerForPanelRuntime(
          errorForPanelRuntime && errorForPanelRuntime.message
            ? errorForPanelRuntime.message
            : 'Could not read tab content.'
        );
      }
    }

    function openImageUploadForPanelRuntime() {
      closeAttachPicker();
      const imageInputForPanelRuntime = root.getElementById('chat-image-input');
      if (!imageInputForPanelRuntime) return;
      imageInputForPanelRuntime.value = '';
      imageInputForPanelRuntime.click();
    }

    function openFileUploadForPanelRuntime() {
      closeAttachPicker();
      const fileInputForPanelRuntime = root.getElementById('chat-file-input');
      if (!fileInputForPanelRuntime) return;
      fileInputForPanelRuntime.value = '';
      fileInputForPanelRuntime.click();
    }

    async function attachImageFileForPanelRuntime(fileForPanelRuntime, chipTypeForPanelRuntime, chipNodeForPanelRuntime) {
      if (!fileForPanelRuntime) return;
      const SUPPORTED_IMAGE_TYPES_FOR_PANEL_RUNTIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      if (!SUPPORTED_IMAGE_TYPES_FOR_PANEL_RUNTIME.includes(String(fileForPanelRuntime.type || '').toLowerCase())) {
        if (chipNodeForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, 'Unsupported image type. Allowed: PNG, JPEG, WebP, GIF.');
        }
        appendSystemMsgToContainerForPanelRuntime('Unsupported image type. Allowed types: PNG, JPEG, WebP, GIF.');
        return;
      }
      if (Number(fileForPanelRuntime.size || 0) > MAX_IMAGE_BYTES_FOR_PANEL_RUNTIME) {
        if (chipNodeForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, 'Image is too large. Max size is 20MB.');
        }
        appendSystemMsgToContainerForPanelRuntime('Image is too large. Max size is 20MB.');
        return;
      }
      const arrayBufferForPanelRuntime = await fileToArrayBufferForPanelRuntime(fileForPanelRuntime);
      const mimeTypeForPanelRuntime = String(fileForPanelRuntime.type || 'image/png');
      const dataUrlForPanelRuntime = arrayBufferToDataUrlForPanelRuntime(arrayBufferForPanelRuntime, mimeTypeForPanelRuntime);
      const persistedBlobForPanelRuntime = await createAttachmentBlobForPanelRuntime({
        name: String(fileForPanelRuntime.name || 'image'),
        kind: chipTypeForPanelRuntime === 'screenshot' ? 'screenshot' : 'image',
        mimeType: mimeTypeForPanelRuntime,
        size: Number(fileForPanelRuntime.size || 0),
        dataUrl: dataUrlForPanelRuntime
      });
      const targetChipForPanelRuntime = chipNodeForPanelRuntime || addInputChipForPanelRuntime({
        type: chipTypeForPanelRuntime,
        label: String(fileForPanelRuntime.name || 'Image')
      });
      if (!targetChipForPanelRuntime) return;
      targetChipForPanelRuntime.dataset.attachType = String(chipTypeForPanelRuntime || 'image');
      targetChipForPanelRuntime.dataset.attachName = String(fileForPanelRuntime.name || 'Image');
      targetChipForPanelRuntime.dataset.attachRefId = String(Number(persistedBlobForPanelRuntime.id) || '');
      targetChipForPanelRuntime.dataset.attachMimeType = mimeTypeForPanelRuntime;
      targetChipForPanelRuntime.dataset.attachSize = String(Number(fileForPanelRuntime.size || 0));
      targetChipForPanelRuntime.dataset.attachKind = chipTypeForPanelRuntime === 'screenshot' ? 'screenshot' : 'image';
      targetChipForPanelRuntime.dataset.attachContent = '';
      setInputChipStatusForPanelRuntime(targetChipForPanelRuntime, '', '');
    }

    async function captureScreenshotForPanelRuntime() {
      closeAttachPicker();
      const pendingChipForPanelRuntime = addInputChipForPanelRuntime({
        type: 'screenshot',
        label: 'Screenshot',
        status: 'loading',
        statusText: 'Capturing screenshot...',
        pageUrl: window.location.href,
        pageTitle: document.title
      });
      try {
        const responseForPanelRuntime = await captureScreenshotWithoutPanelUiForPanelRuntime();
        if (!responseForPanelRuntime || !responseForPanelRuntime.ok || !responseForPanelRuntime.dataUrl) {
          const screenshotErrMsgForPanelRuntime = responseForPanelRuntime && responseForPanelRuntime.error
            ? responseForPanelRuntime.error
            : 'Screenshot capture failed.';
          if (pendingChipForPanelRuntime) {
            showChipAttachErrorForPanelRuntime(pendingChipForPanelRuntime, screenshotErrMsgForPanelRuntime);
          }
          appendSystemMsgToContainerForPanelRuntime(screenshotErrMsgForPanelRuntime);
          return;
        }
        const dataUrlForPanelRuntime = String(responseForPanelRuntime.dataUrl || '');
        const mimeTypeForPanelRuntime = dataUrlForPanelRuntime.indexOf('data:image/jpeg') === 0 ? 'image/jpeg' : 'image/png';
        const persistedBlobForPanelRuntime = await createAttachmentBlobForPanelRuntime({
          name: 'Screenshot ' + new Date().toISOString().replace(/[:.]/g, '-'),
          kind: 'screenshot',
          mimeType: mimeTypeForPanelRuntime,
          size: Number(responseForPanelRuntime.size || 0),
          dataUrl: dataUrlForPanelRuntime
        });
        if (!pendingChipForPanelRuntime) return;
        pendingChipForPanelRuntime.dataset.attachType = 'screenshot';
        pendingChipForPanelRuntime.dataset.attachName = 'Screenshot';
        pendingChipForPanelRuntime.dataset.attachRefId = String(Number(persistedBlobForPanelRuntime.id) || '');
        pendingChipForPanelRuntime.dataset.attachMimeType = mimeTypeForPanelRuntime;
        pendingChipForPanelRuntime.dataset.attachSize = String(Number(responseForPanelRuntime.size || 0));
        pendingChipForPanelRuntime.dataset.attachKind = 'screenshot';
        pendingChipForPanelRuntime.dataset.attachContent = '';
        setInputChipStatusForPanelRuntime(pendingChipForPanelRuntime, '', '');
      } catch (errorForPanelRuntime) {
        const screenshotCatchErrMsgForPanelRuntime = errorForPanelRuntime && errorForPanelRuntime.message
          ? errorForPanelRuntime.message
          : 'Screenshot capture failed.';
        if (pendingChipForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(
            pendingChipForPanelRuntime,
            screenshotCatchErrMsgForPanelRuntime
          );
        }
        appendSystemMsgToContainerForPanelRuntime(screenshotCatchErrMsgForPanelRuntime);
      }
    }

    async function attachFileForPanelRuntime(fileForPanelRuntime, chipNodeForPanelRuntime) {
      if (!fileForPanelRuntime) return;
      if (Number(fileForPanelRuntime.size || 0) > MAX_ATTACHMENT_BYTES_FOR_PANEL_RUNTIME) {
        if (chipNodeForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, 'File is too large. Max size is 50MB.');
        }
        appendSystemMsgToContainerForPanelRuntime('File is too large. Max size is 50MB.');
        return;
      }
      if (!isSupportedFileUploadForPanelRuntime(fileForPanelRuntime)) {
        if (chipNodeForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, 'Unsupported file type.');
        }
        appendSystemMsgToContainerForPanelRuntime('Unsupported file type. Supported: text, CSV, PDF, DOCX, XLSX/XLS/ODS, PPTX, JSON, Markdown.');
        return;
      }
      const arrayBufferForPanelRuntime = await fileToArrayBufferForPanelRuntime(fileForPanelRuntime);
      const sharedActionsForPanelRuntime = getSharedActionsForPanelRuntime();
      const actionForPanelRuntime = sharedActionsForPanelRuntime.parseUploadedFile || 'parseUploadedFile';
      const parseResponseForPanelRuntime = await sendRuntimeMessageForPanelRuntime({
        action: actionForPanelRuntime,
        fileName: String(fileForPanelRuntime.name || ''),
        mimeType: String(fileForPanelRuntime.type || ''),
        size: Number(fileForPanelRuntime.size || 0),
        buffer: Array.from(new Uint8Array(arrayBufferForPanelRuntime))
      });
      if (!parseResponseForPanelRuntime || !parseResponseForPanelRuntime.ok) {
        const parseErrMsgForPanelRuntime = parseResponseForPanelRuntime && parseResponseForPanelRuntime.error
          ? parseResponseForPanelRuntime.error
          : 'Could not parse file.';
        if (chipNodeForPanelRuntime) {
          showChipAttachErrorForPanelRuntime(chipNodeForPanelRuntime, parseErrMsgForPanelRuntime);
        }
        appendSystemMsgToContainerForPanelRuntime(parseErrMsgForPanelRuntime);
        return;
      }
      const extractedTextForPanelRuntime = String(parseResponseForPanelRuntime.text || '');
      const resolvedMimeTypeForPanelRuntime = String(parseResponseForPanelRuntime.mimeType || fileForPanelRuntime.type || 'application/octet-stream');
      const persistedBlobForPanelRuntime = await createAttachmentBlobForPanelRuntime({
        name: String(fileForPanelRuntime.name || 'File'),
        kind: 'file',
        mimeType: resolvedMimeTypeForPanelRuntime,
        size: Number(fileForPanelRuntime.size || 0),
        textContent: extractedTextForPanelRuntime
      });
      const targetChipForPanelRuntime = chipNodeForPanelRuntime || addInputChipForPanelRuntime({
        type: 'file',
        label: String(fileForPanelRuntime.name || 'File')
      });
      if (!targetChipForPanelRuntime) return;
      targetChipForPanelRuntime.dataset.attachType = 'file';
      targetChipForPanelRuntime.dataset.attachName = String(fileForPanelRuntime.name || 'File');
      targetChipForPanelRuntime.dataset.attachRefId = String(Number(persistedBlobForPanelRuntime.id) || '');
      targetChipForPanelRuntime.dataset.attachMimeType = resolvedMimeTypeForPanelRuntime;
      targetChipForPanelRuntime.dataset.attachSize = String(Number(fileForPanelRuntime.size || 0));
      targetChipForPanelRuntime.dataset.attachKind = 'file';
      targetChipForPanelRuntime.dataset.attachContent = '';
      setInputChipStatusForPanelRuntime(targetChipForPanelRuntime, '', '');
    }

    function showNoteAttachErrorForPanelRuntime(attachmentsWrapForPanelRuntime, msgForPanelRuntime, isPopoutForPanelRuntime) {
      if (!attachmentsWrapForPanelRuntime) return;
      const addBtnSelectorForError = isPopoutForPanelRuntime ? '.note-popout-attach-add' : '.ne-attach-add';
      const addBtnForError = attachmentsWrapForPanelRuntime.querySelector(addBtnSelectorForError);
      const errorChipForPanelRuntime = document.createElement('span');
      errorChipForPanelRuntime.className = 'ic m-chip-file';
      errorChipForPanelRuntime.style.cssText = 'background:rgba(185,28,28,0.07);color:#b91c1c;border-color:rgba(185,28,28,0.28);cursor:default;';
      errorChipForPanelRuntime.textContent = String(msgForPanelRuntime || 'File error');
      if (addBtnForError) {
        attachmentsWrapForPanelRuntime.insertBefore(errorChipForPanelRuntime, addBtnForError);
      } else {
        attachmentsWrapForPanelRuntime.appendChild(errorChipForPanelRuntime);
      }
      setTimeout(function () { if (errorChipForPanelRuntime.parentNode) errorChipForPanelRuntime.remove(); }, 3000);
      const toastForNoteAttachError = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForNoteAttachError && typeof toastForNoteAttachError.show === 'function') {
        toastForNoteAttachError.show(String(msgForPanelRuntime || 'File error'), { durationMs: 4500 });
      }
    }

    async function handleNoteAttachFileForPanelRuntime(fileForPanelRuntime, attachmentsWrapForPanelRuntime, isPopoutForPanelRuntime, popoutForPanelRuntime) {
      if (!fileForPanelRuntime || !attachmentsWrapForPanelRuntime) return;
      const mimeTypeForNoteAttach = String(fileForPanelRuntime.type || '').toLowerCase();
      const SUPPORTED_IMAGE_TYPES_FOR_NOTE_ATTACH = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      const isImageForNoteAttach = SUPPORTED_IMAGE_TYPES_FOR_NOTE_ATTACH.includes(mimeTypeForNoteAttach);
      const maxBytesForNoteAttach = isImageForNoteAttach ? MAX_IMAGE_BYTES_FOR_PANEL_RUNTIME : MAX_ATTACHMENT_BYTES_FOR_PANEL_RUNTIME;

      if (Number(fileForPanelRuntime.size || 0) > maxBytesForNoteAttach) {
        showNoteAttachErrorForPanelRuntime(attachmentsWrapForPanelRuntime, 'File is too large.', isPopoutForPanelRuntime);
        return;
      }
      if (!isImageForNoteAttach && !isSupportedFileUploadForPanelRuntime(fileForPanelRuntime)) {
        showNoteAttachErrorForPanelRuntime(attachmentsWrapForPanelRuntime, 'Unsupported file type.', isPopoutForPanelRuntime);
        return;
      }

      const addBtnSelectorForPending = isPopoutForPanelRuntime ? '.note-popout-attach-add' : '.ne-attach-add';
      const addBtnForPending = attachmentsWrapForPanelRuntime.querySelector(addBtnSelectorForPending);
      const pendingChipForNoteAttach = document.createElement('span');
      pendingChipForNoteAttach.className = 'ic m-chip-' + (isImageForNoteAttach ? 'image' : 'file');
      pendingChipForNoteAttach.style.opacity = '0.5';
      pendingChipForNoteAttach.innerHTML = getAttachIconSvgForPanelRuntime(isImageForNoteAttach ? 'image' : 'file') + ' ' + escHtml(truncateChipLabelForPanelRuntime(fileForPanelRuntime.name || 'file'));
      if (addBtnForPending) {
        attachmentsWrapForPanelRuntime.insertBefore(pendingChipForNoteAttach, addBtnForPending);
      } else {
        attachmentsWrapForPanelRuntime.appendChild(pendingChipForNoteAttach);
      }

      try {
        const arrayBufferForNoteAttach = await fileToArrayBufferForPanelRuntime(fileForPanelRuntime);
        if (isImageForNoteAttach) {
          const dataUrlForNoteAttach = arrayBufferToDataUrlForPanelRuntime(arrayBufferForNoteAttach, mimeTypeForNoteAttach);
          const persistedBlobForNoteImage = await createAttachmentBlobForPanelRuntime({
            name: String(fileForPanelRuntime.name || 'image'),
            kind: 'image',
            mimeType: mimeTypeForNoteAttach,
            size: Number(fileForPanelRuntime.size || 0),
            dataUrl: dataUrlForNoteAttach
          });
          pendingChipForNoteAttach.remove();
          if (isPopoutForPanelRuntime && popoutForPanelRuntime) {
            renderAttachmentChipForPopoutForPanelRuntime(popoutForPanelRuntime, attachmentsWrapForPanelRuntime, { name: String(fileForPanelRuntime.name || 'image'), refId: Number(persistedBlobForNoteImage.id) }, 'image');
          } else {
            renderAttachmentChipForPanelRuntime(attachmentsWrapForPanelRuntime, { name: String(fileForPanelRuntime.name || 'image'), refId: Number(persistedBlobForNoteImage.id) }, 'image');
          }
        } else {
          const sharedActionsForNoteAttach = getSharedActionsForPanelRuntime();
          const parseActionForNoteAttach = sharedActionsForNoteAttach.parseUploadedFile || 'parseUploadedFile';
          const parseResponseForNoteAttach = await sendRuntimeMessageForPanelRuntime({
            action: parseActionForNoteAttach,
            fileName: String(fileForPanelRuntime.name || ''),
            mimeType: String(fileForPanelRuntime.type || ''),
            size: Number(fileForPanelRuntime.size || 0),
            buffer: Array.from(new Uint8Array(arrayBufferForNoteAttach))
          });
          if (!parseResponseForNoteAttach || !parseResponseForNoteAttach.ok) {
            pendingChipForNoteAttach.remove();
            showNoteAttachErrorForPanelRuntime(
              attachmentsWrapForPanelRuntime,
              parseResponseForNoteAttach && parseResponseForNoteAttach.error ? String(parseResponseForNoteAttach.error) : 'Could not read file.',
              isPopoutForPanelRuntime
            );
            return;
          }
          const extractedTextForNoteAttach = String(parseResponseForNoteAttach.text || '');
          const persistedBlobForNoteFile = await createAttachmentBlobForPanelRuntime({
            name: String(fileForPanelRuntime.name || 'file'),
            kind: 'file',
            mimeType: String(fileForPanelRuntime.type || ''),
            size: Number(fileForPanelRuntime.size || 0),
            textContent: extractedTextForNoteAttach
          });
          pendingChipForNoteAttach.remove();
          if (isPopoutForPanelRuntime && popoutForPanelRuntime) {
            renderAttachmentChipForPopoutForPanelRuntime(popoutForPanelRuntime, attachmentsWrapForPanelRuntime, { name: String(fileForPanelRuntime.name || 'file'), refId: Number(persistedBlobForNoteFile.id) }, 'file');
          } else {
            renderAttachmentChipForPanelRuntime(attachmentsWrapForPanelRuntime, { name: String(fileForPanelRuntime.name || 'file'), refId: Number(persistedBlobForNoteFile.id) }, 'file');
          }
        }
      } catch (errorForNoteAttach) {
        if (pendingChipForNoteAttach.parentNode) pendingChipForNoteAttach.remove();
        showNoteAttachErrorForPanelRuntime(attachmentsWrapForPanelRuntime, 'Could not read file.', isPopoutForPanelRuntime);
      }
    }

    function showFilePickerToastForPanelRuntime(msgForToast) {
      const toastForFilePicker = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForFilePicker && typeof toastForFilePicker.show === 'function') {
        toastForFilePicker.show(String(msgForToast), { durationMs: 4000 });
      }
    }

    function planMultiFilePickerSelectionForPanelRuntime(filesArrForPicker) {
      const resultForPicker = { files: [], cappedCount: 0, tooManyAtOnce: false };
      if (filesArrForPicker.length > MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME) {
        resultForPicker.tooManyAtOnce = true;
        return resultForPicker;
      }
      const rowForCap = root.querySelector('.input-chips-row');
      const existingCountForCap = rowForCap ? rowForCap.querySelectorAll('.ic').length : 0;
      const remainingSlotsForPicker = MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME - existingCountForCap;
      if (remainingSlotsForPicker <= 0) {
        resultForPicker.cappedCount = filesArrForPicker.length;
        return resultForPicker;
      }
      if (filesArrForPicker.length > remainingSlotsForPicker) {
        resultForPicker.cappedCount = filesArrForPicker.length - remainingSlotsForPicker;
        resultForPicker.files = filesArrForPicker.slice(0, remainingSlotsForPicker);
      } else {
        resultForPicker.files = filesArrForPicker.slice();
      }
      return resultForPicker;
    }

    function planMultiFilePickerSelectionForNoteAttachForPanelRuntime(filesArrForNotePicker, attachmentsWrapForNotePicker, isPopoutForNotePicker) {
      const resultForNotePicker = { files: [], cappedCount: 0, tooManyAtOnce: false };
      if (filesArrForNotePicker.length > MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME) {
        resultForNotePicker.tooManyAtOnce = true;
        return resultForNotePicker;
      }
      const chipSelectorForNotePicker = isPopoutForNotePicker ? '.note-popout-attach-chip' : '.ne-attach-chip';
      const existingCountForNotePicker = attachmentsWrapForNotePicker
        ? attachmentsWrapForNotePicker.querySelectorAll(chipSelectorForNotePicker).length
        : 0;
      const remainingSlotsForNotePicker = MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME - existingCountForNotePicker;
      if (remainingSlotsForNotePicker <= 0) {
        resultForNotePicker.cappedCount = filesArrForNotePicker.length;
        return resultForNotePicker;
      }
      if (filesArrForNotePicker.length > remainingSlotsForNotePicker) {
        resultForNotePicker.cappedCount = filesArrForNotePicker.length - remainingSlotsForNotePicker;
        resultForNotePicker.files = filesArrForNotePicker.slice(0, remainingSlotsForNotePicker);
      } else {
        resultForNotePicker.files = filesArrForNotePicker.slice();
      }
      return resultForNotePicker;
    }

    async function handleImageInputChangeForPanelRuntime(inputNodeForPanelRuntime) {
      const filesForPanelRuntime = inputNodeForPanelRuntime && inputNodeForPanelRuntime.files
        ? Array.prototype.slice.call(inputNodeForPanelRuntime.files)
        : [];
      if (filesForPanelRuntime.length === 0) return;
      const planForPicker = planMultiFilePickerSelectionForPanelRuntime(filesForPanelRuntime);
      if (planForPicker.tooManyAtOnce) {
        showFilePickerToastForPanelRuntime('You can select a maximum of ' + MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME + ' files at once.');
        return;
      }
      for (var iForImgPicker = 0; iForImgPicker < planForPicker.files.length; iForImgPicker++) {
        const fileForPanelRuntime = planForPicker.files[iForImgPicker];
        const pendingChipForPanelRuntime = addInputChipForPanelRuntime({
          type: 'image',
          label: String(fileForPanelRuntime.name || 'Image'),
          status: 'loading',
          statusText: 'Processing image...'
        });
        if (!pendingChipForPanelRuntime) continue;
        try {
          await attachImageFileForPanelRuntime(fileForPanelRuntime, 'image', pendingChipForPanelRuntime);
        } catch (errorForPanelRuntime) {
          if (pendingChipForPanelRuntime) {
            setInputChipStatusForPanelRuntime(
              pendingChipForPanelRuntime,
              'error',
              errorForPanelRuntime && errorForPanelRuntime.message
                ? errorForPanelRuntime.message
                : 'Image upload failed.'
            );
          }
          appendSystemMsgToContainerForPanelRuntime(errorForPanelRuntime && errorForPanelRuntime.message
            ? errorForPanelRuntime.message
            : 'Image upload failed.');
        }
      }
      if (planForPicker.cappedCount > 0) {
        showFilePickerToastForPanelRuntime('Attachment limit reached: ' + planForPicker.cappedCount + ' file' + (planForPicker.cappedCount === 1 ? '' : 's') + ' not added (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
      }
    }

    async function handleFileInputChangeForPanelRuntime(inputNodeForPanelRuntime) {
      const filesForPanelRuntime = inputNodeForPanelRuntime && inputNodeForPanelRuntime.files
        ? Array.prototype.slice.call(inputNodeForPanelRuntime.files)
        : [];
      if (filesForPanelRuntime.length === 0) return;
      const planForPicker = planMultiFilePickerSelectionForPanelRuntime(filesForPanelRuntime);
      if (planForPicker.tooManyAtOnce) {
        showFilePickerToastForPanelRuntime('You can select a maximum of ' + MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME + ' files at once.');
        return;
      }
      for (var iForFilePicker = 0; iForFilePicker < planForPicker.files.length; iForFilePicker++) {
        const fileForPanelRuntime = planForPicker.files[iForFilePicker];
        const pendingChipForPanelRuntime = addInputChipForPanelRuntime({
          type: 'file',
          label: String(fileForPanelRuntime.name || 'File'),
          status: 'loading',
          statusText: 'Parsing file...'
        });
        if (!pendingChipForPanelRuntime) continue;
        try {
          await attachFileForPanelRuntime(fileForPanelRuntime, pendingChipForPanelRuntime);
        } catch (errorForPanelRuntime) {
          if (pendingChipForPanelRuntime) {
            setInputChipStatusForPanelRuntime(
              pendingChipForPanelRuntime,
              'error',
              errorForPanelRuntime && errorForPanelRuntime.message
                ? errorForPanelRuntime.message
                : 'File upload failed.'
            );
          }
          appendSystemMsgToContainerForPanelRuntime(errorForPanelRuntime && errorForPanelRuntime.message
            ? errorForPanelRuntime.message
            : 'File upload failed.');
        }
      }
      if (planForPicker.cappedCount > 0) {
        showFilePickerToastForPanelRuntime('Attachment limit reached: ' + planForPicker.cappedCount + ' file' + (planForPicker.cappedCount === 1 ? '' : 's') + ' not added (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
      }
    }

    /* ============================================================
      QUIZ DATA
    ============================================================ */

    /* ============================================================
      QUIZ STATE
    ============================================================ */
    const QS = {
      activeQid: null,
      mode: null,        // 'single' | 'session'
      sessionQueue: [],
      sessionIndex: 0,
      selectedOption: null,
      answered: false,
    };

    /* ============================================================
      QUIZ FILTER
    ============================================================ */
    function setQuizFilter(filter, optionsForQuizFilter) {
      const optsForQuizFilterForPanelRuntime = optionsForQuizFilter || {};
      const normalizedFilterForQuizFilter =
        filter === 'due' || filter === 'paused' ? filter : 'all';
      S.quizFilter = normalizedFilterForQuizFilter;
      root.querySelectorAll('.qftab').forEach(t => {
        t.classList.toggle('active', t.dataset.qfilter === normalizedFilterForQuizFilter);
      });
      root.querySelectorAll('.question-item').forEach(item => {
        const status = item.dataset.status;
        let show = true;
        if (normalizedFilterForQuizFilter === 'due')    show = status === 'due';
        if (normalizedFilterForQuizFilter === 'paused') show = status === 'paused';
        item.style.display = show ? '' : 'none';
      });
      if (!optsForQuizFilterForPanelRuntime.skipStateSync) {
        writePanelStateSyncForPanelRuntime({ quizFilter: normalizedFilterForQuizFilter });
      }
    }

    function setQuizFilterForMirrorForPanelRuntime(filterForMirror) {
      setQuizFilter(filterForMirror, { skipStateSync: true });
    }

    /* ============================================================
      QUIZ PANE VISIBILITY
    ============================================================ */
    function showQuizPane(pane) {
      // pane: 'empty' | 'editor' | 'answer'
      // Use classList so we don't fight the .hidden { display:none !important } rule
      const emptyEl  = root.getElementById('quiz-pane-empty');
      const editorEl = root.getElementById('quiz-editor-form');
      const answerEl = root.getElementById('quiz-answer-view');
      if (emptyEl)  emptyEl.classList.toggle('hidden',  pane !== 'empty');
      if (editorEl) editorEl.classList.toggle('hidden', pane !== 'editor');
      if (answerEl) answerEl.classList.toggle('hidden', pane !== 'answer');
    }

    /* ============================================================
      QUIZ EDITOR
    ============================================================ */
    function isQuestionConflictErrorForPanelRuntime(errorForPanelRuntime) {
      return Boolean(errorForPanelRuntime && String(errorForPanelRuntime.message || errorForPanelRuntime).indexOf('QUESTION_CONFLICT') !== -1);
    }

    function handleQuestionConflictForPanelRuntime(questionIdForPanelRuntime) {
      showQepErrorForPanelRuntime('This question changed in another tab. Your draft was kept; click Save again to overwrite the newer version.');
      const repoForQuestionConflict = getPanelDataRepoForPanelRuntime();
      if (repoForQuestionConflict && typeof repoForQuestionConflict.getQuestion === 'function' && questionIdForPanelRuntime) {
        repoForQuestionConflict.getQuestion(questionIdForPanelRuntime).then(function (freshQuestionForConflict) {
          if (freshQuestionForConflict && freshQuestionForConflict.id != null) {
            const numericIdForConflict = Number(freshQuestionForConflict.id);
            QUIZ_STORE_FOR_PANEL_RUNTIME[numericIdForConflict] = cloneQuestionRecordForPanelRuntime(freshQuestionForConflict);
            syncSearchIndexForPanelRuntime('questions', 'update', numericIdForConflict, QUIZ_STORE_FOR_PANEL_RUNTIME[numericIdForConflict]);
            syncMainQuizListItemForPanelRuntime(numericIdForConflict);
            const formForConflict = root.getElementById('quiz-editor-form');
            if (formForConflict && formForConflict.dataset && QS.activeQid === numericIdForConflict) {
              formForConflict.dataset.questionBaseUpdatedAt = String(freshQuestionForConflict.updatedAt || '');
            }
          }
        }).catch(function () {});
      }
    }

    function openQuizEditor() {
      QS.activeQid = null;
      showQepErrorForPanelRuntime(null);
      const newQuestionFormForPanelRuntime = root.getElementById('quiz-editor-form');
      if (newQuestionFormForPanelRuntime && newQuestionFormForPanelRuntime.dataset) {
        newQuestionFormForPanelRuntime.dataset.questionBaseUpdatedAt = '';
      }
      root.querySelectorAll('.question-item').forEach(el => el.classList.remove('active-q'));
      const titleInput = root.getElementById('qep-title-input');
      const qText      = root.getElementById('qep-question-text');
      const expl       = root.getElementById('qep-explanation');
      const fitbAnswerForPanelRuntime = root.getElementById('fitb-answer');
      const fitbCaseSensitiveForPanelRuntime = root.getElementById('fitb-case-sensitive');
      const altWrapForPanelRuntime = root.getElementById('alt-answers-wrap');
      if (titleInput) titleInput.value = '';
      if (qText)      qText.value = '';
      if (expl)       expl.value = '';
      if (fitbAnswerForPanelRuntime) fitbAnswerForPanelRuntime.value = '';
      if (fitbCaseSensitiveForPanelRuntime) fitbCaseSensitiveForPanelRuntime.checked = false;
      if (altWrapForPanelRuntime) {
        altWrapForPanelRuntime.querySelectorAll('.alt-pill').forEach(function (pillForPanelRuntime) {
          pillForPanelRuntime.remove();
        });
      }
      root.querySelectorAll('.mcq-option-input').forEach(function (inputForPanelRuntime) {
        inputForPanelRuntime.value = '';
      });
      const firstCorrectRadioForPanelRuntime = root.querySelector('.mcq-correct-radio');
      root.querySelectorAll('.mcq-correct-radio').forEach(function (radioForPanelRuntime) {
        radioForPanelRuntime.checked = radioForPanelRuntime === firstCorrectRadioForPanelRuntime;
      });
      if (firstCorrectRadioForPanelRuntime) {
        updateCorrectOption(firstCorrectRadioForPanelRuntime);
      }
      root.getElementById('qep-form-title').textContent = 'New Question';
      root.getElementById('qep-delete-btn').style.display = 'none';
      setQuestionType('mcq');
      showQuizPane('editor');
      setReducedPaneForPanelRuntime('questions', 'detail');
      if (titleInput) titleInput.focus();
    }

    function openQuestionEditById(qid) {
      const data = QUIZ_STORE_FOR_PANEL_RUNTIME[qid];
      if (!data) return;
      QS.activeQid = qid;
      showQepErrorForPanelRuntime(null);
      const questionFormForOpenForPanelRuntime = root.getElementById('quiz-editor-form');
      if (questionFormForOpenForPanelRuntime && questionFormForOpenForPanelRuntime.dataset) {
        questionFormForOpenForPanelRuntime.dataset.questionBaseUpdatedAt = String(data.updatedAt || '');
      }
      root.querySelectorAll('.question-item').forEach(el => {
        el.classList.toggle('active-q', Number(el.dataset.qid) === qid);
      });
      root.getElementById('qep-form-title').textContent = 'Edit Question';
      root.getElementById('qep-delete-btn').style.display = '';
      const titleInput = root.getElementById('qep-title-input');
      const qText      = root.getElementById('qep-question-text');
      const expl       = root.getElementById('qep-explanation');
      const fitbAnswerForPanelRuntime = root.getElementById('fitb-answer');
      const fitbCaseSensitiveForPanelRuntime = root.getElementById('fitb-case-sensitive');
      const altWrapForPanelRuntime = root.getElementById('alt-answers-wrap');
      const altInputForPanelRuntime = root.getElementById('alt-input');
      const mcqRowsForPanelRuntime = Array.from(root.querySelectorAll('.mcq-option-row'));
      if (titleInput) titleInput.value = data.title;
      if (qText)      qText.value = data.questionText;
      if (expl)       expl.value = data.explanation || '';
      setQuestionType(data.type);
      if (mcqRowsForPanelRuntime.length) {
        mcqRowsForPanelRuntime.forEach(function (rowForPanelRuntime, indexForPanelRuntime) {
          const optionInputForPanelRuntime = rowForPanelRuntime.querySelector('.mcq-option-input');
          const correctRadioForPanelRuntime = rowForPanelRuntime.querySelector('.mcq-correct-radio');
          const optionForPanelRuntime = Array.isArray(data.options) ? data.options[indexForPanelRuntime] : null;
          if (optionInputForPanelRuntime) {
            optionInputForPanelRuntime.value = optionForPanelRuntime ? (optionForPanelRuntime.text || '') : '';
          }
          if (correctRadioForPanelRuntime) {
            correctRadioForPanelRuntime.checked = Boolean(optionForPanelRuntime && optionForPanelRuntime.isCorrect);
          }
        });
        const checkedRadioForPanelRuntime = root.querySelector('.mcq-correct-radio:checked') || root.querySelector('.mcq-correct-radio');
        if (checkedRadioForPanelRuntime) updateCorrectOption(checkedRadioForPanelRuntime);
      }
      if (data.type === 'fitb') {
        if (fitbAnswerForPanelRuntime) fitbAnswerForPanelRuntime.value = data.correctAnswer || '';
      }
      if (fitbCaseSensitiveForPanelRuntime) fitbCaseSensitiveForPanelRuntime.checked = Boolean(data.caseSensitive);
      if (altWrapForPanelRuntime) {
        altWrapForPanelRuntime.querySelectorAll('.alt-pill').forEach(function (pillForPanelRuntime) {
          pillForPanelRuntime.remove();
        });
        (data.alternativeAnswers || []).forEach(function (alternativeAnswerForPanelRuntime) {
          const pillForPanelRuntime = document.createElement('span');
          pillForPanelRuntime.className = 'alt-pill';
          pillForPanelRuntime.innerHTML = escHtml(alternativeAnswerForPanelRuntime) + '<span class="ic-remove" data-action="remove-alt-pill">' + ic.x10 + '</span>';
          if (altInputForPanelRuntime) {
            altWrapForPanelRuntime.insertBefore(pillForPanelRuntime, altInputForPanelRuntime);
          }
        });
      }
      showQuizPane('editor');
      setReducedPaneForPanelRuntime('questions', 'detail');
    }

    function setQuestionType(type) {
      root.getElementById('type-mcq-btn').classList.toggle('active', type === 'mcq');
      root.getElementById('type-fitb-btn').classList.toggle('active', type === 'fitb');
      root.getElementById('mcq-fields').classList.toggle('hidden', type !== 'mcq');
      root.getElementById('fitb-fields').classList.toggle('hidden', type !== 'fitb');
    }

    function updateCorrectOption(radio) {
      root.querySelectorAll('.mcq-option-row').forEach(row => {
        row.classList.toggle('is-correct', row.querySelector('.mcq-correct-radio') === radio && radio.checked);
      });
    }

    function createNextQuestionIdForPanelRuntime() {
      const keysForNewQuestionIdForPanelRuntime = Object.keys(QUIZ_STORE_FOR_PANEL_RUNTIME).map(Number);
      return keysForNewQuestionIdForPanelRuntime.length ? Math.max.apply(null, keysForNewQuestionIdForPanelRuntime) + 1 : 1;
    }

    function collectQuestionDraftForPanelRuntime() {
      const titleInputForPanelRuntime = root.getElementById('qep-title-input');
      const questionInputForPanelRuntime = root.getElementById('qep-question-text');
      const explanationInputForPanelRuntime = root.getElementById('qep-explanation');
      const fitbAnswerForPanelRuntime = root.getElementById('fitb-answer');
      const fitbCaseSensitiveForPanelRuntime = root.getElementById('fitb-case-sensitive');
      const altWrapForPanelRuntime = root.getElementById('alt-answers-wrap');
      const altInputForPanelRuntime = root.getElementById('alt-input');
      if (!titleInputForPanelRuntime || !questionInputForPanelRuntime || !explanationInputForPanelRuntime) return { draft: null, error: null };
      const titleForPanelRuntime = titleInputForPanelRuntime.value.trim();
      const questionTextForPanelRuntime = questionInputForPanelRuntime.value.trim();
      if (!titleForPanelRuntime) return { draft: null, error: 'Title is required.' };
      if (!questionTextForPanelRuntime) return { draft: null, error: 'Question text is required.' };
      const questionTypeForPanelRuntime = root.getElementById('type-fitb-btn').classList.contains('active') ? 'fitb' : 'mcq';
      const existingQuestionForPanelRuntime = QS.activeQid ? QUIZ_STORE_FOR_PANEL_RUNTIME[QS.activeQid] : null;
      const draftForPanelRuntime = {
        title: titleForPanelRuntime,
        questionText: questionTextForPanelRuntime,
        explanation: explanationInputForPanelRuntime.value || '',
        type: questionTypeForPanelRuntime,
        options: [],
        correctAnswer: '',
        alternativeAnswers: [],
        caseSensitive: false,
        intervalStage: existingQuestionForPanelRuntime ? (existingQuestionForPanelRuntime.intervalStage || 0) : 0,
        dueAt: existingQuestionForPanelRuntime ? (existingQuestionForPanelRuntime.dueAt || '') : '',
        isPaused: existingQuestionForPanelRuntime ? Boolean(existingQuestionForPanelRuntime.isPaused) : false,
        pausedUntil: existingQuestionForPanelRuntime && existingQuestionForPanelRuntime.pausedUntil
          ? existingQuestionForPanelRuntime.pausedUntil
          : null,
        sourceChatId: existingQuestionForPanelRuntime && existingQuestionForPanelRuntime.sourceChatId != null
          ? existingQuestionForPanelRuntime.sourceChatId
          : null
      };

      if (questionTypeForPanelRuntime === 'mcq') {
        const optionRowsForPanelRuntime = Array.from(root.querySelectorAll('.mcq-option-row'));
        optionRowsForPanelRuntime.forEach(function (rowForPanelRuntime) {
          const optionInputForPanelRuntime = rowForPanelRuntime.querySelector('.mcq-option-input');
          const correctRadioForPanelRuntime = rowForPanelRuntime.querySelector('.mcq-correct-radio');
          const optionTextForPanelRuntime = optionInputForPanelRuntime ? optionInputForPanelRuntime.value.trim() : '';
          if (!optionTextForPanelRuntime) return;
          draftForPanelRuntime.options.push({
            text: optionTextForPanelRuntime,
            isCorrect: Boolean(correctRadioForPanelRuntime && correctRadioForPanelRuntime.checked)
          });
        });
        if (draftForPanelRuntime.options.length < 2) return { draft: null, error: 'MCQ requires at least 2 options.' };
        if (!draftForPanelRuntime.options.some(function (o) { return o.isCorrect; })) {
          return { draft: null, error: 'Please select the correct answer.' };
        }
      } else {
        draftForPanelRuntime.correctAnswer = fitbAnswerForPanelRuntime ? fitbAnswerForPanelRuntime.value.trim() : '';
        if (!draftForPanelRuntime.correctAnswer) return { draft: null, error: 'Correct answer is required for fill-in-the-blank.' };
        if (!/_{3,}/.test(questionTextForPanelRuntime)) {
          return { draft: null, error: 'Fill-in-the-blank question must contain "___" to mark the blank.' };
        }
        if (altWrapForPanelRuntime) {
          draftForPanelRuntime.alternativeAnswers = Array.from(altWrapForPanelRuntime.querySelectorAll('.alt-pill'))
            .map(function (pillForPanelRuntime) {
              return pillForPanelRuntime.textContent.trim();
            })
            .filter(Boolean);
          if (altInputForPanelRuntime && altInputForPanelRuntime.value.trim()) {
            draftForPanelRuntime.alternativeAnswers.push(altInputForPanelRuntime.value.trim());
          }
        }
        draftForPanelRuntime.caseSensitive = Boolean(fitbCaseSensitiveForPanelRuntime && fitbCaseSensitiveForPanelRuntime.checked);
      }
      return { draft: draftForPanelRuntime, error: null };
    }

    function showQepErrorForPanelRuntime(msg) {
      const el = root.getElementById('qep-error-msg');
      if (!el) return;
      if (msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    }

    async function saveQuestion() {
      const { draft: questionDraftForPanelRuntime, error: draftErrorForPanelRuntime } = collectQuestionDraftForPanelRuntime();
      if (draftErrorForPanelRuntime) { showQepErrorForPanelRuntime(draftErrorForPanelRuntime); return; }
      if (!questionDraftForPanelRuntime) return;
      showQepErrorForPanelRuntime(null);

      const existingQuestionIdForPanelRuntime = QS.activeQid;
      let isNewQuestionForPanelRuntime = !existingQuestionIdForPanelRuntime || !QUIZ_STORE_FOR_PANEL_RUNTIME[existingQuestionIdForPanelRuntime];
      let questionIdForPanelRuntime = existingQuestionIdForPanelRuntime;
      let persistedQuestionForPanelRuntime = null;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();

      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.createQuestion === 'function') {
        try {
          if (isNewQuestionForPanelRuntime) {
            persistedQuestionForPanelRuntime = await panelDataRepoForPanelRuntime.createQuestion(questionDraftForPanelRuntime);
          } else {
            const questionFormForSaveForPanelRuntime = root.getElementById('quiz-editor-form');
            const questionBaseUpdatedAtForPanelRuntime = questionFormForSaveForPanelRuntime && questionFormForSaveForPanelRuntime.dataset
              ? questionFormForSaveForPanelRuntime.dataset.questionBaseUpdatedAt
              : '';
            persistedQuestionForPanelRuntime = await panelDataRepoForPanelRuntime.updateQuestion(
              questionIdForPanelRuntime,
              questionDraftForPanelRuntime,
              { baseUpdatedAt: questionBaseUpdatedAtForPanelRuntime }
            );
          }
          if (persistedQuestionForPanelRuntime && persistedQuestionForPanelRuntime.id != null) {
            questionIdForPanelRuntime = Number(persistedQuestionForPanelRuntime.id);
          }
        } catch (errorForPanelRuntime) {
          if (isQuestionConflictErrorForPanelRuntime(errorForPanelRuntime)) {
            handleQuestionConflictForPanelRuntime(questionIdForPanelRuntime);
          }
          return;
        }
      } else if (isNewQuestionForPanelRuntime) {
        questionIdForPanelRuntime = createNextQuestionIdForPanelRuntime();
      }

      if (!persistedQuestionForPanelRuntime) {
        const existingQuestionForPanelRuntime = !isNewQuestionForPanelRuntime ? QUIZ_STORE_FOR_PANEL_RUNTIME[questionIdForPanelRuntime] : null;
        const nowIsoForPanelRuntime = new Date().toISOString();
        persistedQuestionForPanelRuntime = Object.assign({}, questionDraftForPanelRuntime, {
          createdAt: existingQuestionForPanelRuntime && existingQuestionForPanelRuntime.createdAt
            ? existingQuestionForPanelRuntime.createdAt
            : nowIsoForPanelRuntime,
          updatedAt: nowIsoForPanelRuntime
        });
      }
      const savedQuestionForPanelRuntime = cloneQuestionRecordForPanelRuntime(persistedQuestionForPanelRuntime || questionDraftForPanelRuntime);
      QUIZ_STORE_FOR_PANEL_RUNTIME[questionIdForPanelRuntime] = savedQuestionForPanelRuntime;
      if (QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(questionIdForPanelRuntime) === -1) {
        QUIZ_ORDER_FOR_PANEL_RUNTIME.push(questionIdForPanelRuntime);
      }
      syncSearchIndexForPanelRuntime('questions', isNewQuestionForPanelRuntime ? 'add' : 'update', questionIdForPanelRuntime, savedQuestionForPanelRuntime);
      syncMainQuizListItemForPanelRuntime(questionIdForPanelRuntime);
      refreshQuizOrderForPanelRuntime();
      QS.activeQid = null;
      showQuizPane('empty');
      root.querySelectorAll('.question-item').forEach(el => el.classList.remove('active-q'));
      const activeQuizFilterForPanelRuntime = root.querySelector('.qftab.active');
      if (activeQuizFilterForPanelRuntime) {
        setQuizFilter(activeQuizFilterForPanelRuntime.dataset.qfilter || 'all');
      }
      setReducedPaneForPanelRuntime('questions', 'list');
      const toastForSaveQuestionForPanelRuntime = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
      if (toastForSaveQuestionForPanelRuntime && typeof toastForSaveQuestionForPanelRuntime.show === 'function') {
        toastForSaveQuestionForPanelRuntime.show(isNewQuestionForPanelRuntime ? 'Question saved.' : 'Question updated.');
      }
    }

    async function doDeleteQuestionForPanelRuntime(resolvedQuestionIdForPanelRuntime) {
      if (!resolvedQuestionIdForPanelRuntime || !QUIZ_STORE_FOR_PANEL_RUNTIME[resolvedQuestionIdForPanelRuntime]) return;
      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.deleteQuestion === 'function') {
        try {
          await panelDataRepoForPanelRuntime.deleteQuestion(resolvedQuestionIdForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      }
      delete QUIZ_STORE_FOR_PANEL_RUNTIME[resolvedQuestionIdForPanelRuntime];
      const orderIndexForPanelRuntime = QUIZ_ORDER_FOR_PANEL_RUNTIME.indexOf(resolvedQuestionIdForPanelRuntime);
      if (orderIndexForPanelRuntime >= 0) QUIZ_ORDER_FOR_PANEL_RUNTIME.splice(orderIndexForPanelRuntime, 1);
      syncSearchIndexForPanelRuntime('questions', 'remove', resolvedQuestionIdForPanelRuntime);
      removeMainQuizListItemForPanelRuntime(resolvedQuestionIdForPanelRuntime);
      if (QS.activeQid === resolvedQuestionIdForPanelRuntime) {
        closeAnswerView();
      } else {
        showQuizPane('empty');
      }
      const activeQuizFilterForPanelRuntime = root.querySelector('.qftab.active');
      if (activeQuizFilterForPanelRuntime) {
        setQuizFilter(activeQuizFilterForPanelRuntime.dataset.qfilter || 'all');
      }
    }

    function deleteQuestionForPanelRuntime(questionIdForPanelRuntime) {
      const resolvedQuestionIdForPanelRuntime = questionIdForPanelRuntime || QS.activeQid;
      if (!resolvedQuestionIdForPanelRuntime || !QUIZ_STORE_FOR_PANEL_RUNTIME[resolvedQuestionIdForPanelRuntime]) return;
      showConfirmPromptForPanelRuntime(
        root.querySelector('.panel-content'),
        'This question will be permanently deleted and cannot be recovered.',
        'Delete',
        function() { doDeleteQuestionForPanelRuntime(resolvedQuestionIdForPanelRuntime); }
      );
    }

    function cancelQuizEditor() {
      showQuizPane(QS.activeQid ? 'answer' : 'empty');
      if (!QS.activeQid) {
        setReducedPaneForPanelRuntime('questions', 'list');
      }
    }

    /* ============================================================
      ALT ANSWER PILL INPUT (FITB editor)
    ============================================================ */
    (function() {
      root.addEventListener('keydown', function(e) {
        const altInput = root.getElementById('alt-input');
        if (e.target !== altInput) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = altInput.value.trim();
          if (!val) return;
          const wrap = root.getElementById('alt-answers-wrap');
          const pill = document.createElement('span');
          pill.className = 'alt-pill';
          pill.innerHTML = escHtml(val) + '<span class="ic-remove" data-action="remove-alt-pill">' + ic.x10 + '</span>';
          wrap.insertBefore(pill, altInput);
          altInput.value = '';
        }
      });
    })();

    /* ============================================================
      QUIZ ANSWER VIEW
    ============================================================ */
    function openQuestionAnswer(qid) {
      const data = QUIZ_STORE_FOR_PANEL_RUNTIME[qid];
      if (!data) return;
      QS.activeQid = qid;
      QS.mode = 'single';
      QS.answered = false;
      QS.selectedOption = null;

      root.querySelectorAll('.question-item').forEach(el => {
        el.classList.toggle('active-q', Number(el.dataset.qid) === qid);
      });

      renderAnswerView(data, false);
      showQuizPane('answer');
      setReducedPaneForPanelRuntime('questions', 'detail');
    }

    function renderAnswerView(data, isSession) {
      // Headers
      root.getElementById('qav-header-single').classList.toggle('hidden', isSession);
      root.getElementById('qav-header-session').classList.toggle('hidden', !isSession);
      if (!isSession) {
        root.getElementById('qav-single-title').textContent = data.title;
      }

      // Type chip
      const chip = root.getElementById('qav-type-chip');
      chip.textContent = data.type === 'mcq' ? 'MCQ' : 'Fill in the blank';
      chip.className = 'qav-type-chip qi-badge ' + (data.type === 'mcq' ? 'qi-badge-mcq' : 'qi-badge-fitb');

      root.getElementById('qav-qtitle').textContent   = data.title;
      const qavQuestionTextElForPanelRuntime = root.getElementById('qav-qtext');
      if (qavQuestionTextElForPanelRuntime) {
        qavQuestionTextElForPanelRuntime.innerHTML = renderMarkdown(data.questionText || '');
      }

      // MCQ vs FITB
      const mcqEl  = root.getElementById('qav-mcq-options');
      const fitbEl = root.getElementById('qav-fitb-row');
      mcqEl.classList.toggle('hidden', data.type !== 'mcq');
      fitbEl.classList.toggle('hidden', data.type !== 'fitb');

      if (data.type === 'mcq' && data.options) {
        const btns = mcqEl.querySelectorAll('.qav-option');
        const letters = ['A','B','C','D'];
        btns.forEach((btn, i) => {
          const opt = data.options[i];
          btn.className = 'qav-option';
          btn.disabled = false;
          btn.querySelector('.qav-letter').textContent = letters[i];
          btn.childNodes[btn.childNodes.length - 1].textContent = ' ' + (opt ? opt.text : '');
          btn.dataset.correct = opt ? String(opt.isCorrect) : 'false';
        });
      }

      if (data.type === 'fitb') {
        const fi = root.getElementById('qav-fitb-input');
        fi.value = '';
        fi.className = 'qav-fitb-input';
        fi.disabled = false;
      }

      // Feedback
      const fb = root.getElementById('qav-feedback');
      fb.className = 'qav-feedback';
      fb.innerHTML = '';

      // Footer buttons
      const submitBtn = root.getElementById('qav-submit-btn');
      const nextBtn   = root.getElementById('qav-next-btn');
      const skipBtn   = root.getElementById('qav-skip-btn');
      // MCQ uses the submit button (disabled until option selected); FITB has its own inline Check button
      submitBtn.classList.toggle('hidden', data.type !== 'mcq');
      submitBtn.disabled = true; // re-enabled when an option is selected
      nextBtn.classList.add('hidden');
      skipBtn.classList.toggle('hidden', !isSession);

      // Pause/Resume button: show in single mode only, label depends on status
      const pauseBtn   = root.getElementById('qav-pause-btn');
      const pauseLabel = root.getElementById('qav-pause-label');
      if (pauseBtn) {
        pauseBtn.classList.toggle('hidden', isSession);
        if (pauseLabel) {
          pauseLabel.textContent = getQuizStatusForPanelRuntime(data) === 'paused' ? 'Resume' : 'Pause';
        }
        pauseBtn.onclick = getQuizStatusForPanelRuntime(data) === 'paused'
          ? function() { resumeQuestion(QS.activeQid); }
          : function() { openPauseDialog(); };
      }

      QS.answered = false;
      QS.selectedOption = null;
      hydrateRenderedMarkdownForPanelRuntime(root.getElementById('qav-body'));
    }

    function selectOption(btn) {
      if (QS.answered) return;
      root.querySelectorAll('.qav-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      QS.selectedOption = btn;
      const submitBtn = root.getElementById('qav-submit-btn');
      if (submitBtn) submitBtn.disabled = false;
    }

    function submitMcq() {
      if (!QS.selectedOption || QS.answered) return;
      QS.answered = true;
      const isCorrect = QS.selectedOption.dataset.correct === 'true';
      const data = QUIZ_STORE_FOR_PANEL_RUNTIME[QS.activeQid];

      // Disable all options
      root.querySelectorAll('.qav-option').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.correct === 'true') btn.classList.add('opt-reveal');
      });

      if (isCorrect) {
        QS.selectedOption.classList.remove('selected');
        QS.selectedOption.classList.add('opt-correct');
        showFeedback(true, null, data).then(toggleFooterAfterAnswer);
      } else {
        QS.selectedOption.classList.remove('selected');
        QS.selectedOption.classList.add('opt-wrong');
        showFeedback(false, null, data).then(toggleFooterAfterAnswer);
      }
    }

    function submitFitb() {
      if (QS.answered) return;
      const input = root.getElementById('qav-fitb-input');
      const data  = QUIZ_STORE_FOR_PANEL_RUNTIME[QS.activeQid];
      if (!data || !input) return;
      const raw = input.value.trim();
      const userAns = data.caseSensitive ? raw : raw.toLowerCase();
      const correct  = data.caseSensitive ? data.correctAnswer : (data.correctAnswer || '').toLowerCase();
      const alts     = (data.alternativeAnswers || []).map(a => data.caseSensitive ? a : a.toLowerCase());
      const isCorrect = userAns === correct || alts.includes(userAns);

      QS.answered = true;
      input.disabled = true;
      input.classList.add(isCorrect ? 'fi-correct' : 'fi-wrong');
      showFeedback(isCorrect, data.correctAnswer, data).then(toggleFooterAfterAnswer);
    }

    async function showFeedback(isCorrect, correctAnswer, data) {
      const fb = root.getElementById('qav-feedback');
      const intervalDaysMap = [7, 14, 30, 30];
      const qid = QS.activeQid;

      let nextInfo = '';
      if (qid && QUIZ_STORE_FOR_PANEL_RUNTIME[qid]) {
        const currentStage = QUIZ_STORE_FOR_PANEL_RUNTIME[qid].intervalStage || 0;
        const newStage = isCorrect ? Math.min(currentStage + 1, intervalDaysMap.length - 1) : 0;
        const daysUntilNext = isCorrect ? intervalDaysMap[newStage - 1] || intervalDaysMap[0] : 2;
        const nextDue = new Date();
        nextDue.setDate(nextDue.getDate() + daysUntilNext);
        const newDueAt = getLocalDateOnlyForPanelRuntime(nextDue);

        nextInfo = isCorrect
          ? 'Next review: ' + daysUntilNext + ' days'
          : 'Interval reset — review again in 2 days';

        const updatedFields = { intervalStage: newStage, dueAt: newDueAt };
        const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
        if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateQuestion === 'function') {
          try {
            const persistedForFeedback = await panelDataRepoForPanelRuntime.updateQuestion(qid, updatedFields);
            QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime(persistedForFeedback);
          } catch (e) {
            QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime(
              Object.assign({}, QUIZ_STORE_FOR_PANEL_RUNTIME[qid], updatedFields)
            );
          }
        } else {
          QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime(
            Object.assign({}, QUIZ_STORE_FOR_PANEL_RUNTIME[qid], updatedFields)
          );
        }
        syncSearchIndexForPanelRuntime('questions', 'update', qid, QUIZ_STORE_FOR_PANEL_RUNTIME[qid]);
        syncMainQuizListItemForPanelRuntime(qid);
        refreshQuizOrderForPanelRuntime();
      }

      let html = '<div class="fb-heading">' + (isCorrect ? ic.check14 + ' Correct' : ic.x13 + ' Incorrect') + '</div>';
      if (!isCorrect && correctAnswer) {
        html += `<div class="fb-answer">Correct answer: <code>${escHtml(correctAnswer)}</code></div>`;
      }
      if (!isCorrect && data && data.explanation) {
        html += `<div class="fb-explanation">${renderMarkdown(data.explanation)}</div>`;
      }
      if (nextInfo) html += `<div class="fb-next-info">${nextInfo}</div>`;

      fb.innerHTML = html;
      fb.className = 'qav-feedback fb-visible ' + (isCorrect ? 'fb-correct' : 'fb-wrong');
      hydrateRenderedMarkdownForPanelRuntime(fb);
    }

    function toggleFooterAfterAnswer() {
      const submitBtn = root.getElementById('qav-submit-btn');
      const nextBtn   = root.getElementById('qav-next-btn');
      const skipBtn   = root.getElementById('qav-skip-btn');
      if (submitBtn) submitBtn.classList.add('hidden');
      if (nextBtn)   nextBtn.classList.remove('hidden');
      if (skipBtn && QS.mode === 'session') {
        skipBtn.classList.add('hidden');
      }
    }

    /* ============================================================
      SESSION MODE
    ============================================================ */
    function startSession() {
      const due = Object.entries(QUIZ_STORE_FOR_PANEL_RUNTIME).filter(([, d]) => getQuizStatusForPanelRuntime(d) === 'due');
      if (!due.length) return;
      QS.mode = 'session';
      QS.sessionQueue = due.map(([id]) => Number(id));
      QS.sessionIndex = 0;
      loadSessionQuestion();
      showQuizPane('answer');
      setReducedPaneForPanelRuntime('questions', 'detail');
    }

    function loadSessionQuestion() {
      const qid = QS.sessionQueue[QS.sessionIndex];
      if (!qid) { endSession(); return; }
      QS.activeQid = qid;
      const data = QUIZ_STORE_FOR_PANEL_RUNTIME[qid];
      root.querySelectorAll('.question-item').forEach(el => {
        el.classList.toggle('active-q', Number(el.dataset.qid) === qid);
      });
      renderAnswerView(data, true);
      const prog = root.getElementById('qav-session-progress');
      if (prog) prog.textContent = `Question ${QS.sessionIndex + 1} of ${QS.sessionQueue.length}`;
    }

    function nextQuestion() {
      if (QS.mode === 'session') {
        QS.sessionIndex++;
        if (QS.sessionIndex < QS.sessionQueue.length) {
          loadSessionQuestion();
        } else {
          endSession();
        }
      } else {
        // Single mode: advance to next question in the visible list
        const items = Array.from(root.querySelectorAll('.question-item:not([style*="none"])'));
        const currentIdx = items.findIndex(el => Number(el.dataset.qid) === QS.activeQid);
        const next = items[currentIdx + 1];
        if (next) {
          openQuestionAnswer(Number(next.dataset.qid));
        } else {
          closeAnswerView();
        }
      }
    }

    function skipQuestion() {
      if (QS.mode !== 'session') return;
      // Move current question to end of queue
      const skipped = QS.sessionQueue.splice(QS.sessionIndex, 1)[0];
      QS.sessionQueue.push(skipped);
      if (QS.sessionIndex >= QS.sessionQueue.length - 1) {
        QS.sessionIndex = 0;
      }
      loadSessionQuestion();
    }

    function endSession() {
      showQuizPane('empty');
      root.querySelectorAll('.question-item').forEach(el => el.classList.remove('active-q'));
      setReducedPaneForPanelRuntime('questions', 'list');
    }

    function closeAnswerView() {
      showQuizPane('empty');
      root.querySelectorAll('.question-item').forEach(el => el.classList.remove('active-q'));
      QS.mode = null;
      QS.activeQid = null;
      setReducedPaneForPanelRuntime('questions', 'list');
    }

    function backFromQuiz() {
      setReducedPaneForPanelRuntime('questions', 'list');
    }

    /* ============================================================
      PAUSE / RESUME
    ============================================================ */
    function openPauseDialog() {
      const dialog = root.getElementById('pause-dialog');
      if (!dialog) return;
      // Default the date input to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateInput = root.getElementById('pause-date-input');
      if (dateInput) {
        dateInput.min = tomorrow.toISOString().slice(0, 10);
        dateInput.value = tomorrow.toISOString().slice(0, 10);
      }
      dialog.classList.remove('hidden');
    }

    function closePauseDialog() {
      const dialog = root.getElementById('pause-dialog');
      if (dialog) dialog.classList.add('hidden');
    }

    async function confirmPause() {
      const dateInput = root.getElementById('pause-date-input');
      if (!dateInput || !dateInput.value) return;
      const qid = QS.activeQid;
      if (!qid) return;
      const activeQuestionForPanelRuntime = QUIZ_STORE_FOR_PANEL_RUNTIME[qid];
      if (!activeQuestionForPanelRuntime) return;

      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateQuestion === 'function') {
        try {
          const persistedQuestionForPanelRuntime = await panelDataRepoForPanelRuntime.updateQuestion(qid, {
            isPaused: true,
            pausedUntil: dateInput.value
          });
          QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime(persistedQuestionForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      } else {
        QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime({
          ...activeQuestionForPanelRuntime,
          isPaused: true,
          pausedUntil: dateInput.value
        });
      }
      syncSearchIndexForPanelRuntime('questions', 'update', qid, QUIZ_STORE_FOR_PANEL_RUNTIME[qid]);
      syncMainQuizListItemForPanelRuntime(qid);
      refreshQuizOrderForPanelRuntime();
      const activeFilter = root.querySelector('.qftab.active');
      if (activeFilter) {
        setQuizFilter(activeFilter.dataset.qfilter || 'all');
      }

      closePauseDialog();

      // Update pause button label in answer view
      const pauseLabel = root.getElementById('qav-pause-label');
      const pauseBtn   = root.getElementById('qav-pause-btn');
      if (pauseLabel) pauseLabel.textContent = 'Resume';
      if (pauseBtn) pauseBtn.onclick = function() { resumeQuestion(qid); };
    }

    async function resumeQuestion(qid) {
      if (!qid) return;
      const data = QUIZ_STORE_FOR_PANEL_RUNTIME[qid];
      if (!data) return;

      const panelDataRepoForPanelRuntime = getPanelDataRepoForPanelRuntime();
      if (panelDataRepoForPanelRuntime && typeof panelDataRepoForPanelRuntime.updateQuestion === 'function') {
        try {
          const persistedQuestionForPanelRuntime = await panelDataRepoForPanelRuntime.updateQuestion(qid, {
            isPaused: false,
            pausedUntil: null
          });
          QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime(persistedQuestionForPanelRuntime);
        } catch (errorForPanelRuntime) {
          return;
        }
      } else {
        QUIZ_STORE_FOR_PANEL_RUNTIME[qid] = cloneQuestionRecordForPanelRuntime({
          ...data,
          isPaused: false,
          pausedUntil: null
        });
      }
      syncSearchIndexForPanelRuntime('questions', 'update', qid, QUIZ_STORE_FOR_PANEL_RUNTIME[qid]);
      syncMainQuizListItemForPanelRuntime(qid);
      refreshQuizOrderForPanelRuntime();
      const activeFilter = root.querySelector('.qftab.active');
      if (activeFilter) {
        setQuizFilter(activeFilter.dataset.qfilter || 'all');
      }

      // Update pause button label in answer view
      const pauseLabelEl = root.getElementById('qav-pause-label');
      const pauseBtn     = root.getElementById('qav-pause-btn');
      if (pauseLabelEl) pauseLabelEl.textContent = 'Pause';
      if (pauseBtn) pauseBtn.onclick = function() { openPauseDialog(); };
    }

    /* ============================================================
      QUIZ INIT
    ============================================================ */
    showQuizPane('empty');

    root.getElementById('pk-search').addEventListener('input', function() {
      const qRawForPicker = this.value;
      const wrapForPkSearch = this.closest('.pk-search-wrap');
      if (wrapForPkSearch) wrapForPkSearch.classList.toggle('has-value', qRawForPicker.length > 0);
      const qTrimmedForPicker = qRawForPicker.trim();

      if (S.pickerMode === 'tab') {
        const tabsForSearch = getPickerTabsForPanelRuntime();
        const qLowerForPicker = qTrimmedForPicker.toLowerCase();
        var filteredForTabSearch = qTrimmedForPicker
          ? tabsForSearch.filter(t => t.title.toLowerCase().includes(qLowerForPicker) || t.excerpt.toLowerCase().includes(qLowerForPicker))
          : tabsForSearch;
        // Re-inject windowLabel on the first tab of each window group so headers still show after filtering
        if (qTrimmedForPicker && filteredForTabSearch.length > 0) {
          var seenWindowsForSearch = {};
          filteredForTabSearch = filteredForTabSearch.map(function (tabForSearch) {
            var wid = tabForSearch.windowId;
            if (!seenWindowsForSearch[wid]) {
              seenWindowsForSearch[wid] = true;
              return Object.assign({}, tabForSearch, { windowLabel: tabsForSearch.find(t => t.windowId === wid && t.windowLabel) ? tabsForSearch.find(t => t.windowId === wid && t.windowLabel).windowLabel : null });
            }
            return Object.assign({}, tabForSearch, { windowLabel: null });
          });
        }
        renderTabPickerList(filteredForTabSearch);
        return;
      }

      const allItemsForPicker = S.pickerMode === 'note' ? getPickerNotesForPanelRuntime() : getPickerChatsForPanelRuntime();

      if (!qTrimmedForPicker) {
        renderPickerList(allItemsForPicker, S.pickerMode);
        return;
      }

      const flexIndexTypeForPicker = S.pickerMode === 'note' ? 'notes' : 'chats';
      const searchNsForPicker = (globalThis.ABChatShared || {}).search;
      let matchedIdsForPicker = null;

      if (searchNsForPicker && typeof searchNsForPicker.search === 'function') {
        matchedIdsForPicker = new Set();
        searchNsForPicker.search(flexIndexTypeForPicker, qTrimmedForPicker, 200).forEach(function(id) {
          matchedIdsForPicker.add(Number(id));
        });
      } else {
        const qLowerForPicker = qTrimmedForPicker.toLowerCase();
        matchedIdsForPicker = new Set();
        allItemsForPicker.forEach(function(itemForFallback) {
          if (
            (itemForFallback.title || '').toLowerCase().includes(qLowerForPicker) ||
            (itemForFallback.excerpt || '').toLowerCase().includes(qLowerForPicker)
          ) {
            matchedIdsForPicker.add(Number(itemForFallback.id));
          }
        });
      }

      renderPickerList(allItemsForPicker.filter(function(itemForPicker) {
        return matchedIdsForPicker.has(Number(itemForPicker.id));
      }), S.pickerMode);
    });

      function bindDelegatedActionsForPanelRuntime(rootNodeForActions) {
        if (!rootNodeForActions || !rootNodeForActions.addEventListener) return;

        rootNodeForActions.addEventListener('click', function handleActionClickForRuntime(evtForRuntime) {
          const tgtForRuntime = evtForRuntime.target.closest('[data-action]');
          if (!tgtForRuntime) return;
          const action = tgtForRuntime.dataset.action;
          switch (action) {
            case 'set-tab':              setTab(tgtForRuntime.dataset.tab); if (tgtForRuntime.dataset.tab === 'logs') { apiLogsPageForPanelRuntime = 0; loadApiLogsViewForPanelRuntime(); } break;
            case 'save-api-key-onboarding': saveApiKeyFromOnboardingForPanelRuntime(); break;
            case 'tour-next': {
              currentTourSlideForPanelRuntime = Math.min(currentTourSlideForPanelRuntime + 1, TOUR_SLIDES_FOR_PANEL_RUNTIME.length - 1);
              renderTourSlideForPanelRuntime(currentTourSlideForPanelRuntime);
              break;
            }
            case 'tour-back': {
              currentTourSlideForPanelRuntime = Math.max(currentTourSlideForPanelRuntime - 1, 0);
              renderTourSlideForPanelRuntime(currentTourSlideForPanelRuntime);
              break;
            }
            case 'tour-skip':
            case 'tour-finish': dismissFeatureTourForPanelRuntime(); break;
            case 'save-agent-rules-btn': saveAgentRulesFromSettingsForPanelRuntime(); break;
            case 'sync-all':             triggerFullSyncForPanelRuntime(tgtForRuntime.closest('.ctrl-btn')); break;
            case 'set-mode':             setMode(tgtForRuntime.dataset.mode); break;
            case 'toggle-selector':      toggleSelector(tgtForRuntime); break;
            case 'new-chat':             newChat(); break;
            case 'toggle-favs':          toggleFavs(tgtForRuntime); break;
            case 'collapse-sidebar':       collapseSidebar(); break;
            case 'expand-sidebar':         expandSidebar(); break;
            case 'collapse-notes-sidebar': collapseNotesSidebar(); break;
            case 'expand-notes-sidebar':   expandNotesSidebar(); break;
            case 'set-chat-type':        setChatType(tgtForRuntime.dataset.chatType); break;
            case 'select-chat':          selectChat(Number(tgtForRuntime.dataset.chatId)); break;
            case 'toggle-message-dropdown': toggleMessageDropdown(tgtForRuntime); evtForRuntime.stopPropagation(); break;
            case 'toggle-msg-sources': {
              const sourcesWrapForToggle = tgtForRuntime.closest('.msg-sources');
              if (!sourcesWrapForToggle) break;
              const sourcesListForToggle = sourcesWrapForToggle.querySelector('.msg-sources-list');
              if (!sourcesListForToggle) break;
              const isOpenForToggle = sourcesListForToggle.style.display === 'flex';
              sourcesListForToggle.style.display = isOpenForToggle ? 'none' : 'flex';
              const countForToggle = sourcesWrapForToggle.querySelectorAll('.msg-source-link').length;
              tgtForRuntime.innerHTML = (isOpenForToggle ? '&#9658;' : '&#9660;') + ' Sources (' + countForToggle + ')';
              break;
            }
            case 'start-chat-edit':      startChatEditForPanelRuntime(Number(tgtForRuntime.dataset.chatEditMsgId)); break;
            case 'save-chat-edit':       saveChatEditForPanelRuntime(Number(tgtForRuntime.dataset.chatEditMsgId)); break;
            case 'cancel-chat-edit':     cancelChatEditForPanelRuntime(); break;
            case 'copy-message':         {
              const isFromMessageDropdownForPanelRuntime = Boolean(tgtForRuntime.closest('.msg-options-dropdown'));
              if (isFromMessageDropdownForPanelRuntime && evtForRuntime && typeof evtForRuntime.stopPropagation === 'function') {
                evtForRuntime.stopPropagation();
              }
              copyMessageForPanelRuntime(Number(tgtForRuntime.dataset.messageId), tgtForRuntime);
              break;
            }
            case 'copy-inline-message': {
              const textForInlineCopy = tgtForRuntime.dataset.copyText || '';
              if (!textForInlineCopy) break;
              if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(textForInlineCopy).then(function () {
                  const origInlineCopyHtml = tgtForRuntime.innerHTML;
                  tgtForRuntime.classList.add('copied');
                  tgtForRuntime.innerHTML = ic.check12;
                  setTimeout(function () { tgtForRuntime.classList.remove('copied'); tgtForRuntime.innerHTML = origInlineCopyHtml; }, 1800);
                }).catch(function () {});
              }
              break;
            }
            case 'download-gen-image': {
              const wrapForDownload = tgtForRuntime.closest('.gen-img-wrap');
              const imgForDownload = wrapForDownload ? wrapForDownload.querySelector('img') : null;
              if (!imgForDownload || !imgForDownload.src) break;
              const aForDownload = document.createElement('a');
              aForDownload.href = imgForDownload.src;
              aForDownload.download = 'abchat-generated-image.png';
              aForDownload.click();
              break;
            }
            case 'download-mermaid-svg': {
              const wrapForMermaidSvg = tgtForRuntime.closest('.mermaid-export-wrap');
              const svgElForDownload = wrapForMermaidSvg ? wrapForMermaidSvg.querySelector('.mermaid svg') : null;
              if (!svgElForDownload) break;
              const svgStringForDownload = new XMLSerializer().serializeToString(svgElForDownload);
              const blobForSvg = new Blob([svgStringForDownload], { type: 'image/svg+xml' });
              const urlForSvg = URL.createObjectURL(blobForSvg);
              const aForSvg = document.createElement('a');
              aForSvg.href = urlForSvg;
              aForSvg.download = 'abchat-diagram.svg';
              document.body.appendChild(aForSvg);
              aForSvg.click();
              document.body.removeChild(aForSvg);
              setTimeout(function () { URL.revokeObjectURL(urlForSvg); }, 10000);
              break;
            }
            case 'download-mermaid-png': {
              const wrapForMermaidPng = tgtForRuntime.closest('.mermaid-export-wrap');
              const svgElForPng = wrapForMermaidPng ? wrapForMermaidPng.querySelector('.mermaid svg') : null;
              if (!svgElForPng) break;
              const clonedSvgForPng = svgElForPng.cloneNode(true);
              if (!clonedSvgForPng.getAttribute('xmlns')) {
                clonedSvgForPng.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
              }
              // Chrome taints any canvas drawn from an SVG that contains
              // <foreignObject>, regardless of the foreignObject's content.
              // Flatten mermaid's HTML labels to native <text> before drawing so
              // toDataURL() can succeed.
              flattenForeignObjectsForMermaidPngForPanelRuntime(svgElForPng, clonedSvgForPng);
              const bboxForPng = svgElForPng.getBoundingClientRect();
              const widthForPng = Math.max(bboxForPng.width || 800, 1);
              const heightForPng = Math.max(bboxForPng.height || 600, 1);
              if (!clonedSvgForPng.getAttribute('width')) clonedSvgForPng.setAttribute('width', String(widthForPng));
              if (!clonedSvgForPng.getAttribute('height')) clonedSvgForPng.setAttribute('height', String(heightForPng));
              const svgStringForPng = new XMLSerializer().serializeToString(clonedSvgForPng);
              // Use a Blob URL for the <img> source: btoa(unescape(...)) is
              // deprecated and fails on diagrams large enough to exceed btoa's
              // input limits.
              const svgBlobForPng = new Blob([svgStringForPng], { type: 'image/svg+xml;charset=utf-8' });
              const svgBlobUrlForPng = URL.createObjectURL(svgBlobForPng);
              // Match the panel background so PNGs read correctly when pasted
              // into dark slide decks or notes.
              const pngBackgroundForPng = (host && host.dataset && host.dataset.theme === 'dark') ? '#1e293b' : '#ffffff';
              const imgForPng = new Image();
              imgForPng.onload = function () {
                try {
                  const canvasForPng = document.createElement('canvas');
                  const scaleForPng = Math.max(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
                  canvasForPng.width = widthForPng * scaleForPng;
                  canvasForPng.height = heightForPng * scaleForPng;
                  const ctxForPng = canvasForPng.getContext('2d');
                  ctxForPng.fillStyle = pngBackgroundForPng;
                  ctxForPng.fillRect(0, 0, canvasForPng.width, canvasForPng.height);
                  ctxForPng.scale(scaleForPng, scaleForPng);
                  ctxForPng.drawImage(imgForPng, 0, 0);
                  const aForPng = document.createElement('a');
                  aForPng.href = canvasForPng.toDataURL('image/png');
                  aForPng.download = 'abchat-diagram.png';
                  document.body.appendChild(aForPng);
                  aForPng.click();
                  document.body.removeChild(aForPng);
                } catch (errForPng) {
                  console.warn('Mermaid PNG export failed:', errForPng);
                  const toastForPngError = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
                  if (toastForPngError && typeof toastForPngError.show === 'function') {
                    toastForPngError.show('PNG export failed: ' + (errForPng && errForPng.message ? errForPng.message : 'unknown error'), { durationMs: 4500 });
                  }
                } finally {
                  URL.revokeObjectURL(svgBlobUrlForPng);
                }
              };
              imgForPng.onerror = function (errForPngLoad) {
                URL.revokeObjectURL(svgBlobUrlForPng);
                console.warn('Mermaid PNG export: image failed to decode SVG.', errForPngLoad);
                const toastForPngDecode = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
                if (toastForPngDecode && typeof toastForPngDecode.show === 'function') {
                  toastForPngDecode.show('PNG export failed: SVG could not be decoded.', { durationMs: 4500 });
                }
              };
              imgForPng.src = svgBlobUrlForPng;
              break;
            }
            case 'copy-mermaid-source': {
              // The button can live either inside the toolbar (success path)
              // or inside the in-node error block; both paths sit inside a
              // .mermaid element with the original source on dataset.
              const wrapForCopySource = tgtForRuntime.closest('.mermaid-export-wrap');
              const mermaidNodeForCopySource = wrapForCopySource
                ? wrapForCopySource.querySelector('.mermaid')
                : tgtForRuntime.closest('.mermaid');
              const sourceForCopy = mermaidNodeForCopySource && mermaidNodeForCopySource.dataset
                ? (mermaidNodeForCopySource.dataset.abchatMermaidSource || '')
                : '';
              if (!sourceForCopy) break;
              const toastForCopySource = ABChatContent && ABChatContent.ui && ABChatContent.ui.toast;
              const showCopyToastForPanelRuntime = function (msgForCopyToast, opts) {
                if (toastForCopySource && typeof toastForCopySource.show === 'function') {
                  toastForCopySource.show(msgForCopyToast, opts || { durationMs: 2000 });
                }
              };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(sourceForCopy)
                  .then(function () { showCopyToastForPanelRuntime('Mermaid source copied'); })
                  .catch(function () { fallbackCopy(sourceForCopy, function () { showCopyToastForPanelRuntime('Mermaid source copied'); }); });
              } else {
                fallbackCopy(sourceForCopy, function () { showCopyToastForPanelRuntime('Mermaid source copied'); });
              }
              break;
            }
            case 'retry-mermaid': {
              const mermaidNodeForRetry = tgtForRuntime.closest('.mermaid');
              if (!mermaidNodeForRetry || !mermaidNodeForRetry.dataset) break;
              const sourceForRetry = mermaidNodeForRetry.dataset.abchatMermaidSource || '';
              if (!sourceForRetry) break;
              mermaidNodeForRetry.textContent = sourceForRetry;
              delete mermaidNodeForRetry.dataset.abchatMermaidRendered;
              delete mermaidNodeForRetry.dataset.abchatMermaidRendering;
              delete mermaidNodeForRetry.dataset.abchatMermaidError;
              const retryContainerForMermaid = mermaidNodeForRetry.parentElement || mermaidNodeForRetry;
              renderMermaidForContainerForPanelRuntime(retryContainerForMermaid);
              break;
            }
            case 'zoom-mermaid-in': {
              const wrapForZoomIn = tgtForRuntime.closest('.mermaid-export-wrap');
              if (!wrapForZoomIn) break;
              applyMermaidZoomForPanelRuntime(wrapForZoomIn, getMermaidZoomForPanelRuntime(wrapForZoomIn) + 0.25);
              break;
            }
            case 'zoom-mermaid-out': {
              const wrapForZoomOut = tgtForRuntime.closest('.mermaid-export-wrap');
              if (!wrapForZoomOut) break;
              applyMermaidZoomForPanelRuntime(wrapForZoomOut, getMermaidZoomForPanelRuntime(wrapForZoomOut) - 0.25);
              break;
            }
            case 'zoom-mermaid-reset': {
              const wrapForZoomReset = tgtForRuntime.closest('.mermaid-export-wrap');
              if (!wrapForZoomReset) break;
              fitMermaidToContainerForPanelRuntime(wrapForZoomReset);
              break;
            }
            case 'fork-chat-from-message': forkChatFromMessageForPanelRuntime(Number(tgtForRuntime.dataset.messageId)); break;
            case 'toggle-chat-star':     toggleChatStar(tgtForRuntime); break;
            case 'toggle-chat-dropdown': toggleChatDropdown(tgtForRuntime); evtForRuntime.stopPropagation(); break;
            case 'rename-chat':          renameChatItem(tgtForRuntime); break;
            case 'delete-chat':          deleteChatItemFromDropdownForPanelRuntime(tgtForRuntime); break;
            case 'view-raw-chat':        openRawChatViewForPanelRuntime(tgtForRuntime); break;
            case 'close-raw-view':       closeRawViewForPanelRuntime(); break;
            case 'toggle-raw-wrap':      toggleRawChatWrapForPanelRuntime(); break;
            case 'copy-raw-chat':        copyRawChatForPanelRuntime(tgtForRuntime); break;
            case 'back-from-chat':       backFromChat(); break;
            case 'use-prompt':           usePrompt(tgtForRuntime); break;
            case 'remove-ic':            {
              const icForRuntime = tgtForRuntime.closest('.ic');
              const noteDraftParentForRuntime = icForRuntime && icForRuntime.dataset && icForRuntime.dataset.attachContext === 'note'
                ? icForRuntime.parentElement
                : null;
              if (icForRuntime) removeInputChipForPanelRuntime(icForRuntime);
              if (noteDraftParentForRuntime) notifyNoteDraftChangedForElementForPanelRuntime(noteDraftParentForRuntime);
              break;
            }
            case 'preview-input-chip':   previewInputChipForPanelRuntime(tgtForRuntime); break;
            case 'preview-message-chip': previewMessageChipForPanelRuntime(tgtForRuntime.dataset.messageId, tgtForRuntime.dataset.chipIndex); break;
            case 'toggle-attach-picker': toggleAttachPicker(); evtForRuntime.stopPropagation(); break;
            case 'toggle-model-picker':  toggleModelPickerForPanelRuntime(); evtForRuntime.stopPropagation(); break;
            case 'select-model':         selectModelForPanelRuntime(tgtForRuntime.dataset.modelId); break;
            case 'open-image-upload':    openImageUploadForPanelRuntime(); break;
            case 'capture-screenshot':   captureScreenshotForPanelRuntime(); break;
            case 'open-file-upload':     openFileUploadForPanelRuntime(); break;
            case 'open-tab-picker':      openTabPicker(); break;
            case 'open-note-picker':     openNotePicker(); break;
            case 'open-chat-picker':     openChatPicker(); break;
            case 'spreadsheet-from-clipboard': handleSpreadsheetFromClipboardForPanelRuntime(); break;
            case 'open-note-editor':     openNoteEditor(); break;
            case 'toggle-note-favs':     toggleNoteFavs(tgtForRuntime); break;
            case 'select-note':          selectNote(Number(tgtForRuntime.dataset.noteId)); break;
            case 'toggle-note-star':     toggleNoteStar(tgtForRuntime); break;
            case 'toggle-note-dropdown': toggleNoteDropdown(tgtForRuntime); evtForRuntime.stopPropagation(); break;
            case 'open-note-popout':     openCurrentNoteInPopoutForPanelRuntime(); break;
            case 'focus-note-popout':    focusNotePopoutForHandoffForPanelRuntime(); break;
            case 'close-note-popout-handoff': closeNotePopoutFromHandoffForPanelRuntime(); break;
            case 'add-note-attachment': {
              const neFileInputForClick = root.getElementById('ne-attach-file-input');
              if (neFileInputForClick) { neFileInputForClick.value = ''; neFileInputForClick.click(); }
              break;
            }
            case 'add-note-popout-attachment': {
              const popoutForAddAttach = tgtForRuntime.closest('.note-popout');
              const popoutFileInputForClick = popoutForAddAttach ? popoutForAddAttach.querySelector('.note-popout-attach-file-input') : null;
              if (popoutFileInputForClick) { popoutFileInputForClick.value = ''; popoutFileInputForClick.click(); }
              break;
            }
            case 'save-note':            saveNoteFromMainEditorForPanelRuntime(); break;
            case 'delete-note':          deleteNoteFromMainEditorForPanelRuntime(Number(tgtForRuntime.dataset.noteId)); break;
            case 'edit-note':            editNoteFromDropdown(Number(tgtForRuntime.dataset.noteId)); break;
            case 'back-from-note':       backFromNote(); break;
            case 'enter-note-edit-mode': enterNoteEditMode(); break;
            case 'exit-note-edit-mode':  exitNoteEditMode(); break;
            case 'set-task-filter':      setFilter(tgtForRuntime.dataset.filter); break;
            case 'new-task':             newTask(); break;
            case 'select-task':          selectTask(tgtForRuntime); break;
            case 'toggle-task':          toggleTask(evtForRuntime, tgtForRuntime); break;
            case 'save-task':            saveTaskForPanelRuntime(); break;
            case 'mark-task-done':       markTaskDoneForPanelRuntime(); break;
            case 'delete-task':          deleteTaskForPanelRuntime(); break;
            case 'back-from-task':       backFromTask(); break;
            case 'close-task-editor':    closeTaskEditor(); break;
            case 'open-quiz-editor':     openQuizEditor(); break;
            case 'start-session':        startSession(); break;
            case 'set-quiz-filter':      setQuizFilter(tgtForRuntime.dataset.filter); break;
            case 'open-question-answer': openQuestionAnswer(Number(tgtForRuntime.dataset.qid)); break;
            case 'open-question-edit':   openQuestionEditById(Number(tgtForRuntime.dataset.questionId)); break;
            case 'delete-question':      {
              const questionIdForPanelRuntime = Number(tgtForRuntime.dataset.questionId);
              deleteQuestionForPanelRuntime(Number.isFinite(questionIdForPanelRuntime) ? questionIdForPanelRuntime : null);
              break;
            }
            case 'back-from-quiz':       backFromQuiz(); break;
            case 'set-question-type':    setQuestionType(tgtForRuntime.dataset.questionType); break;
            case 'remove-alt-pill':      { const pillForRuntime = tgtForRuntime.closest('.alt-pill'); if (pillForRuntime) pillForRuntime.remove(); break; }
            case 'save-question':        saveQuestion(); break;
            case 'cancel-quiz-editor':   cancelQuizEditor(); break;
            case 'close-answer-view':    closeAnswerView(); break;
            case 'select-option':        selectOption(tgtForRuntime); break;
            case 'submit-fitb':          submitFitb(); break;
            case 'submit-mcq':           submitMcq(); break;
            case 'next-question':        nextQuestion(); break;
            case 'skip-question':        skipQuestion(); break;
            case 'open-pause-dialog':    openPauseDialog(); break;
            case 'confirm-pause':        confirmPause(); break;
            case 'close-pause-dialog':   closePauseDialog(); break;
            case 'send-chat':            sendChatForPanelRuntime(); break;
            case 'cancel-send':          cancelSendForPanelRuntime(); break;
            case 'close-inline-chat':    closeInlineChat(); break;
            case 'send-inline-message':  sendInlineMessage(); break;
            case 'close-picker-modal':   closePickerModal(); break;
            case 'close-attach-preview': closeAttachPreview(); break;
            case 'show-hidden-pair':     showHiddenPair(tgtForRuntime); break;
            case 'hide-pair':            hidePair(tgtForRuntime); break;
            case 'remove-tag-pill':      {
              const tagPillForRuntime = tgtForRuntime.closest('.tag-pill');
              const tagParentForRuntime = tagPillForRuntime ? tagPillForRuntime.parentElement : null;
              if (tagPillForRuntime) tagPillForRuntime.remove();
              if (tagParentForRuntime) notifyNoteDraftChangedForElementForPanelRuntime(tagParentForRuntime);
              break;
            }
            case 'view-log-detail':      showLogDetailForPanelRuntime(tgtForRuntime.dataset.logId); break;
            case 'close-log-detail':     closeLogDetailForPanelRuntime(); break;
            case 'toggle-log-view':      toggleLogViewForPanelRuntime(); break;
            case 'copy-log-detail':      copyLogDetailForPanelRuntime(tgtForRuntime); break;
            case 'clear-api-logs':       clearApiLogsForPanelRuntime(); break;
            case 'logs-prev-page':       if (apiLogsPageForPanelRuntime > 0) { apiLogsPageForPanelRuntime--; loadApiLogsViewForPanelRuntime(); } break;
            case 'logs-next-page':       apiLogsPageForPanelRuntime++; loadApiLogsViewForPanelRuntime(); break;
            case 'skill-new':            openSkillEditorForPanelRuntime(null); break;
            case 'skill-edit':           openSkillEditorForPanelRuntime(Number(tgtForRuntime.dataset.skillId)); break;
            case 'skill-delete':         confirmDeleteSkillForPanelRuntime(Number(tgtForRuntime.dataset.skillId)); break;
            case 'skill-editor-save':    saveSkillFromEditorForPanelRuntime(); break;
            case 'skill-editor-cancel':  closeSkillEditorForPanelRuntime(); break;
            case 'memory-new':           openMemoryEditorForPanelRuntime(null); break;
            case 'memory-edit':          openMemoryEditorForPanelRuntime(Number(tgtForRuntime.dataset.memoryIndex), tgtForRuntime.dataset.memoryText || ''); break;
            case 'memory-delete':        confirmDeleteMemoryEntryForPanelRuntime(tgtForRuntime.dataset.memoryText || ''); break;
            case 'memory-editor-save':   saveMemoryFromEditorForPanelRuntime(); break;
            case 'memory-editor-cancel': closeMemoryEditorForPanelRuntime(); break;
            case 'clear-search': {
              const searchIdForClear = tgtForRuntime.dataset.searchId;
              const inputForClear = searchIdForClear ? root.getElementById(searchIdForClear) : null;
              if (!inputForClear) break;
              inputForClear.value = '';
              const wrapForClear = tgtForRuntime.closest('.sidebar-search,.ns-search,.task-search,.pk-search-wrap');
              if (wrapForClear) wrapForClear.classList.remove('has-value');
              if (searchIdForClear === 'chat-search-input') { filterChatListForPanelRuntime(''); writePanelStateSyncForPanelRuntime({ chatSearchQuery: '' }); }
              else if (searchIdForClear === 'notes-search-input') { filterNotesListForPanelRuntime(''); writePanelStateSyncForPanelRuntime({ notesSearchQuery: '' }); }
              else if (searchIdForClear === 'task-search-input') { filterTasksListForPanelRuntime(''); writePanelStateSyncForPanelRuntime({ taskSearchQuery: '' }); }
              else inputForClear.dispatchEvent(new Event('input'));
              inputForClear.focus();
              break;
            }
          }
        });

        rootNodeForActions.addEventListener('change', function handleActionChangeForRuntime(evtForRuntime) {
          const tgtForRuntime = evtForRuntime.target.closest('[data-action]');
          if (!tgtForRuntime) return;
          const action = tgtForRuntime.dataset.action;
          switch (action) {
            case 'apply-theme-settings':           applyThemeFromSettings(tgtForRuntime.value); break;
            case 'update-correct-option':          updateCorrectOption(tgtForRuntime); break;
            case 'save-api-key':                   saveApiKeyFromSettingsForPanelRuntime(); break;
            case 'save-default-model':             saveDefaultModelForPanelRuntime(tgtForRuntime.value); break;
            case 'save-image-model':               saveImageModelForPanelRuntime(tgtForRuntime.value); break;
            case 'save-delete-chats-older-than':   saveDeleteChatsOlderThanForPanelRuntime(tgtForRuntime.value); break;
            case 'prune-orphaned-blobs':           pruneOrphanedBlobsFromSettingsForPanelRuntime(); break;
            case 'save-alert-sound':               saveAlertSoundForPanelRuntime(tgtForRuntime.checked); break;
            case 'save-reminder-lead-time':        saveReminderLeadTimeForPanelRuntime(tgtForRuntime.value); break;
            case 'tep-due-change': {
              if (!tgtForRuntime.value) break;
              var dueTimestampForAutoReminder = new Date(tgtForRuntime.value).getTime();
              if (isNaN(dueTimestampForAutoReminder)) break;
              var reminderInputForAutoReminder = root.getElementById('tep-reminder');
              if (!reminderInputForAutoReminder) break;
              var reminderTsForAutoReminder = dueTimestampForAutoReminder - currentReminderLeadTimeForPanelRuntime * 60000;
              reminderInputForAutoReminder.value = toDateTimeLocalValueForPanelRuntime(new Date(reminderTsForAutoReminder).toISOString());
              break;
            }
            case 'chat-image-input-change': handleImageInputChangeForPanelRuntime(tgtForRuntime); break;
            case 'chat-file-input-change':  handleFileInputChangeForPanelRuntime(tgtForRuntime); break;
            case 'ne-attach-file-input-change': {
              const neAttachFilesForChange = tgtForRuntime.files ? Array.prototype.slice.call(tgtForRuntime.files) : [];
              tgtForRuntime.value = '';
              if (neAttachFilesForChange.length === 0) break;
              const neAttachWrapForChange = root.getElementById('ne-attachments');
              if (!neAttachWrapForChange) break;
              const planForNeAttach = planMultiFilePickerSelectionForNoteAttachForPanelRuntime(neAttachFilesForChange, neAttachWrapForChange, false);
              if (planForNeAttach.tooManyAtOnce) {
                showFilePickerToastForPanelRuntime('You can select a maximum of ' + MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME + ' files at once.');
                break;
              }
              (async function processNoteAttachFilesForPanelRuntime() {
                for (var iForNeAttach = 0; iForNeAttach < planForNeAttach.files.length; iForNeAttach++) {
                  await handleNoteAttachFileForPanelRuntime(planForNeAttach.files[iForNeAttach], neAttachWrapForChange, false, null);
                }
                notifyNoteDraftChangedForElementForPanelRuntime(neAttachWrapForChange);
                if (planForNeAttach.cappedCount > 0) {
                  showFilePickerToastForPanelRuntime('Attachment limit reached: ' + planForNeAttach.cappedCount + ' file' + (planForNeAttach.cappedCount === 1 ? '' : 's') + ' not added (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
                }
              })();
              break;
            }
            case 'note-popout-attach-file-input-change': {
              const popoutAttachFilesForChange = tgtForRuntime.files ? Array.prototype.slice.call(tgtForRuntime.files) : [];
              tgtForRuntime.value = '';
              if (popoutAttachFilesForChange.length === 0) break;
              const popoutForFileChange = tgtForRuntime.closest('.note-popout');
              const popoutAttachWrapForChange = popoutForFileChange ? popoutForFileChange.querySelector('.note-popout-attachments') : null;
              if (!popoutForFileChange || !popoutAttachWrapForChange) break;
              const planForPopoutAttach = planMultiFilePickerSelectionForNoteAttachForPanelRuntime(popoutAttachFilesForChange, popoutAttachWrapForChange, true);
              if (planForPopoutAttach.tooManyAtOnce) {
                showFilePickerToastForPanelRuntime('You can select a maximum of ' + MAX_FILES_PER_DROP_FOR_PANEL_RUNTIME + ' files at once.');
                break;
              }
              (async function processNotePopoutAttachFilesForPanelRuntime() {
                for (var iForPopoutAttach = 0; iForPopoutAttach < planForPopoutAttach.files.length; iForPopoutAttach++) {
                  await handleNoteAttachFileForPanelRuntime(planForPopoutAttach.files[iForPopoutAttach], popoutAttachWrapForChange, true, popoutForFileChange);
                }
                notifyNoteDraftChangedForElementForPanelRuntime(popoutAttachWrapForChange);
                if (planForPopoutAttach.cappedCount > 0) {
                  showFilePickerToastForPanelRuntime('Attachment limit reached: ' + planForPopoutAttach.cappedCount + ' file' + (planForPopoutAttach.cappedCount === 1 ? '' : 's') + ' not added (max ' + MAX_INPUT_CHIPS_FOR_PANEL_RUNTIME + ').');
                }
              })();
              break;
            }
          }
        });

        rootNodeForActions.addEventListener('input', function handleActionInputForRuntime(evtForRuntime) {
          const tgtForRuntime = evtForRuntime.target.closest('[data-action]');
          if (!tgtForRuntime) return;
          const action = tgtForRuntime.dataset.action;
          switch (action) {
            case 'search-chats':    filterChatListForPanelRuntime(tgtForRuntime.value); tgtForRuntime.closest('.sidebar-search,.ns-search,.task-search').classList.toggle('has-value', tgtForRuntime.value.length > 0); writePanelStateSyncForPanelRuntime({ chatSearchQuery: tgtForRuntime.value }); break;
            case 'search-notes':    filterNotesListForPanelRuntime(tgtForRuntime.value); tgtForRuntime.closest('.sidebar-search,.ns-search,.task-search').classList.toggle('has-value', tgtForRuntime.value.length > 0); writePanelStateSyncForPanelRuntime({ notesSearchQuery: tgtForRuntime.value }); break;
            case 'search-tasks':    filterTasksListForPanelRuntime(tgtForRuntime.value); tgtForRuntime.closest('.sidebar-search,.ns-search,.task-search').classList.toggle('has-value', tgtForRuntime.value.length > 0); writePanelStateSyncForPanelRuntime({ taskSearchQuery: tgtForRuntime.value }); break;
          }
        });
      }

      const mountNodeForPanelRuntime = root.getElementById('abchat-panel-mount') || document.body;
      bindDelegatedActionsForPanelRuntime(mountNodeForPanelRuntime);
      bindKeyboardIsolationForPanelRuntime(root);
      bindEditableFocusIsolationForPanelRuntime(root);
      bindDragDropForPanelRuntime(root);
      bindSelectorTabHoverTooltipForPanelRuntime(root);

      // Snapshot the dropdown's open state on mousedown, before the capture-phase
      // click handler closes everything. Toggle functions read this to decide
      // whether to re-open their dropdown.
      mountNodeForPanelRuntime.addEventListener('mousedown', function(evtForMousedown) {
        const tgtForMousedown = evtForMousedown.target.closest('[data-action]');
        if (!tgtForMousedown) { preclickOpenStateForPanelRuntime = null; return; }
        switch (tgtForMousedown.dataset.action) {
          case 'toggle-chat-dropdown': {
            const ddForChat = tgtForMousedown.nextElementSibling;
            preclickOpenStateForPanelRuntime = ddForChat ? ddForChat.classList.contains('open') : false;
            break;
          }
          case 'toggle-message-dropdown': {
            const wrapForMsg = tgtForMousedown.closest('.msg-options-wrap');
            const ddForMsg = wrapForMsg ? wrapForMsg.querySelector('.msg-options-dropdown') : null;
            preclickOpenStateForPanelRuntime = ddForMsg ? ddForMsg.classList.contains('open') : false;
            break;
          }
          case 'toggle-attach-picker': {
            const pickerForSnap = root.getElementById('attach-picker');
            preclickOpenStateForPanelRuntime = pickerForSnap ? pickerForSnap.classList.contains('open') : false;
            break;
          }
          case 'toggle-model-picker': {
            const ddForModel = root.getElementById('model-picker-dropdown');
            preclickOpenStateForPanelRuntime = ddForModel ? ddForModel.classList.contains('open') : false;
            break;
          }
          case 'toggle-note-dropdown': {
            const ddForNote = tgtForMousedown.nextElementSibling;
            preclickOpenStateForPanelRuntime = ddForNote ? ddForNote.classList.contains('open') : false;
            break;
          }
          default:
            preclickOpenStateForPanelRuntime = null;
            break;
        }
      });

      // Capture-phase listener on the shadow root: fires before any element handler,
      // so it closes all dropdowns reliably regardless of stopPropagation() calls
      // deeper in the tree.
      root.addEventListener('click', closeAllDropdownsForPanelRuntime, true);

      // Fallback for clicks that originate outside the shadow DOM (on the web page).
      document.addEventListener('click', closeAllDropdownsForPanelRuntime);

      // Enter key on chat textarea submits (Shift+Enter inserts newline)
      const chatTaForEnter = root.querySelector('.chat-textarea');
      if (chatTaForEnter) {
        chatTaForEnter.addEventListener('keydown', function (evtForEnter) {
          if (evtForEnter.key === 'Enter' && !evtForEnter.shiftKey) {
            evtForEnter.preventDefault();
            sendChatForPanelRuntime();
          }
        });
        chatTaForEnter.addEventListener('input', scheduleDraftSaveForPanelRuntime);
        bindPasteInterceptForPanelRuntime(chatTaForEnter);
      }

      // Enter key on inline chat textarea submits (Shift+Enter inserts newline)
      const inlineTaForEnter = root.getElementById('im-ta');
      if (inlineTaForEnter) {
        inlineTaForEnter.addEventListener('keydown', function (evtForInlineEnter) {
          if (evtForInlineEnter.key === 'Enter' && !evtForInlineEnter.shiftKey) {
            evtForInlineEnter.preventDefault();
            sendInlineMessage();
          }
        });
      }

      // Bind code-paste detection for the main note textarea
      bindNotePasteDetectionForPanelRuntime(root.getElementById('ne-body'));

      // Offline detection: show banner when the page has no internet access.
      // Uses the generation guard to self-remove after extension reload.
      var capturedGenForOfflineBanner = window.abchatListenerGeneration || 0;
      function updateOfflineBannerForPanelRuntime() {
        if ((window.abchatListenerGeneration || 0) !== capturedGenForOfflineBanner) {
          window.removeEventListener('online', updateOfflineBannerForPanelRuntime);
          window.removeEventListener('offline', updateOfflineBannerForPanelRuntime);
          return;
        }
        const offlineBannerEl = root.getElementById('offline-banner');
        if (!offlineBannerEl) return;
        if (navigator.onLine) {
          offlineBannerEl.classList.add('hidden');
        } else {
          offlineBannerEl.classList.remove('hidden');
        }
      }
      window.addEventListener('online', updateOfflineBannerForPanelRuntime);
      window.addEventListener('offline', updateOfflineBannerForPanelRuntime);
      updateOfflineBannerForPanelRuntime();

      // Load saved API key into settings input when settings tab is visible
      loadApiKeyIntoSettingsForPanelRuntime();
      loadAgentRulesIntoSettingsForPanelRuntime();
      loadBehaviourSettingsForPanelRuntime();
      loadThemeIntoSettingsForPanelRuntime();
      bindThemeStorageSyncForPanelRuntime();
      bindAgentRulesStorageSyncForPanelRuntime();
      initModelSelectsForPanelRuntime();
      autoDeleteOldChatsForPanelRuntime();
      restoreDraftForPanelRuntime();
      bindDraftStorageSyncForPanelRuntime();
      bindNoteDraftStorageSyncForPanelRuntime();

      if (typeof MutationObserver === 'function' && mountNodeForPanelRuntime) {
        const observerForPanelRuntime = new MutationObserver(function (mutationListForPanelRuntime) {
          mutationListForPanelRuntime.forEach(function (mutationForPanelRuntime) {
            if (!mutationForPanelRuntime || !mutationForPanelRuntime.addedNodes) return;
            mutationForPanelRuntime.addedNodes.forEach(function (addedNodeForPanelRuntime) {
              if (!addedNodeForPanelRuntime || addedNodeForPanelRuntime.nodeType !== 1) return;
              if (addedNodeForPanelRuntime.querySelectorAll) {
                bindAutoExpandForTextareasForPanelRuntime(addedNodeForPanelRuntime);
              }
            });
          });
        });
        observerForPanelRuntime.observe(mountNodeForPanelRuntime, { childList: true, subtree: true });
      }

    // Windowed initial render: only SIDEBAR_PAGE_SIZE items are painted per list. The
    // sentinel placed after each list fires renderNextXxxPage as the user scrolls down.
    // SCALABILITY: do not change these IIFEs to iterate the full order array; doing so
    // defeats the windowing and causes slow startup on large datasets.
    // REGRESSION RISK: renderedXxxCount must be set BEFORE the loop, not after, so the
    // window guard inside syncMainXxxListItem agrees with the sentinel's starting cursor.
    (function initChatListForPanelRuntime() {
      const chatListElForInit = root.querySelector('.chat-list');
      if (!chatListElForInit) return;
      renderedChatCountForPanelRuntime = Math.min(SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, CHAT_ORDER_FOR_PANEL_RUNTIME.length);
      for (var iForChatInit = 0; iForChatInit < renderedChatCountForPanelRuntime; iForChatInit++) {
        syncMainChatListItemForPanelRuntime(CHAT_ORDER_FOR_PANEL_RUNTIME[iForChatInit]);
      }
      rebuildChatListGroupingForPanelRuntime();
      setupListSentinelForPanelRuntime(chatListElForInit, renderNextChatPageForPanelRuntime);
    })();
    (function initNoteListForPanelRuntime() {
      const notesListElForInit = root.querySelector('.notes-list');
      renderedNoteCountForPanelRuntime = Math.min(SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, NOTE_ORDER_FOR_PANEL_RUNTIME.length);
      for (var iForNoteInit = 0; iForNoteInit < renderedNoteCountForPanelRuntime; iForNoteInit++) {
        syncMainNoteListItemForPanelRuntime(NOTE_ORDER_FOR_PANEL_RUNTIME[iForNoteInit]);
      }
      if (notesListElForInit) setupListSentinelForPanelRuntime(notesListElForInit, renderNextNotePageForPanelRuntime);
    })();
    (function initTaskListForPanelRuntime() {
      const tasksListElForInit = root.querySelector('.tasks-list');
      renderedTaskCountForPanelRuntime = Math.min(SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, TASK_ORDER_FOR_PANEL_RUNTIME.length);
      for (var iForTaskInit = 0; iForTaskInit < renderedTaskCountForPanelRuntime; iForTaskInit++) {
        syncMainTaskListItemForPanelRuntime(TASK_ORDER_FOR_PANEL_RUNTIME[iForTaskInit]);
      }
      if (tasksListElForInit) setupListSentinelForPanelRuntime(tasksListElForInit, renderNextTaskPageForPanelRuntime);
    })();
    refreshTaskDotForPanelRuntime();
    (function initQuizListForPanelRuntime() {
      const questionsListElForInit = root.getElementById('questions-list');
      renderedQuizCountForPanelRuntime = Math.min(SIDEBAR_PAGE_SIZE_FOR_PANEL_RUNTIME, QUIZ_ORDER_FOR_PANEL_RUNTIME.length);
      for (var iForQuizInit = 0; iForQuizInit < renderedQuizCountForPanelRuntime; iForQuizInit++) {
        syncMainQuizListItemForPanelRuntime(QUIZ_ORDER_FOR_PANEL_RUNTIME[iForQuizInit]);
      }
      if (questionsListElForInit) setupListSentinelForPanelRuntime(questionsListElForInit, renderNextQuizPageForPanelRuntime);
    })();
    refreshQuizOrderForPanelRuntime();

    // Seed FlexSearch indices. Because startup uses listChatsMeta() (no messages loaded),
    // all chats are initially indexed by title and summary only. A follow-up async IIFE
    // (preSeedChatContentForPanelRuntime) fetches messages for the first
    // SEARCH_CONTENT_INDEX_LIMIT_FOR_PANEL_RUNTIME chats in parallel and backfills their
    // content into the index so they are fully searchable without requiring the user to
    // open each chat first. Chats beyond that limit are backfilled lazily by
    // ensureChatMessagesLoadedForPanelRuntime when the user opens them.
    // SCALABILITY: do not remove the SEARCH_CONTENT_INDEX_LIMIT guard in the pre-seed;
    // fetching messages for all chats at startup would be too expensive for large histories.
    (function seedSearchIndicesForPanelRuntime() {
      const searchNsForSeed = (globalThis.ABChatShared || {}).search;
      if (!searchNsForSeed || typeof searchNsForSeed.buildIndex !== 'function') return;

      const chatRecordsForSeed = CHAT_ORDER_FOR_PANEL_RUNTIME.map(function (id) {
        const c = CHAT_STORE_FOR_PANEL_RUNTIME[id];
        if (!c) return null;
        return { id: Number(id), title: c.title || '', summary: c.summary || '', content: '' };
      }).filter(Boolean);
      searchNsForSeed.buildIndex('chats', chatRecordsForSeed);

      const noteRecordsForSeed = Object.keys(NOTE_STORE_FOR_PANEL_RUNTIME).map(function (id) {
        const n = NOTE_STORE_FOR_PANEL_RUNTIME[id];
        return { id: Number(id), title: n.title || '', body: n.body || '' };
      });
      searchNsForSeed.buildIndex('notes', noteRecordsForSeed);

      const taskRecordsForSeed = Object.keys(TASK_STORE_FOR_PANEL_RUNTIME).map(function (id) {
        const t = TASK_STORE_FOR_PANEL_RUNTIME[id];
        return { id: Number(id), title: t.title || '', body: t.body || '' };
      });
      searchNsForSeed.buildIndex('tasks', taskRecordsForSeed);

      const questionRecordsForSeed = Object.keys(QUIZ_STORE_FOR_PANEL_RUNTIME).map(function (id) {
        const q = QUIZ_STORE_FOR_PANEL_RUNTIME[id];
        return { id: Number(id), questionText: q.questionText || '' };
      });
      searchNsForSeed.buildIndex('questions', questionRecordsForSeed);
    })();

    // Pre-fetch message content for the first SEARCH_CONTENT_INDEX_LIMIT chats so they
    // are fully searchable without the user having to open each one first. Runs async
    // after the sync seed so it does not block panel initialization. Chats already in
    // chatMessagesLoadedSetForPanelRuntime are skipped (they already have content).
    // SCALABILITY: bounded to SEARCH_CONTENT_INDEX_LIMIT_FOR_PANEL_RUNTIME fetches;
    // do not remove the slice() cap or change it to the full order array length.
    (async function preSeedChatContentForPanelRuntime() {
      var repoForPreSeed = getPanelDataRepoForPanelRuntime();
      if (!repoForPreSeed || typeof repoForPreSeed.listMessagesByChatId !== 'function') return;
      var idsForPreSeed = CHAT_ORDER_FOR_PANEL_RUNTIME
        .slice(0, SEARCH_CONTENT_INDEX_LIMIT_FOR_PANEL_RUNTIME)
        .filter(function (idForPreSeed) {
          return !chatMessagesLoadedSetForPanelRuntime.has(Number(idForPreSeed));
        });
      await Promise.all(idsForPreSeed.map(async function (idForPreSeed) {
        var numericIdForPreSeed = Number(idForPreSeed);
        try {
          var msgsForPreSeed = await repoForPreSeed.listMessagesByChatId(numericIdForPreSeed);
          var chatRecordForPreSeed = CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForPreSeed];
          if (!chatRecordForPreSeed) return;
          chatRecordForPreSeed.messages = msgsForPreSeed.map(function (mForPreSeed) {
            return Object.assign({}, mForPreSeed, { _persistedToDb: true });
          });
          chatMessagesLoadedSetForPanelRuntime.add(numericIdForPreSeed);
          syncSearchIndexForPanelRuntime('chats', 'update', numericIdForPreSeed, chatRecordForPreSeed);
        } catch (eForPreSeed) {}
      }));
    })();

    async function addImageChipFromContextMenuForPanelRuntime(srcUrlForCtxMenu) {
      if (!srcUrlForCtxMenu || typeof srcUrlForCtxMenu !== 'string') return;

      var pageUrlForCtxMenu = String(window.location.href || '');
      var pageTitleForCtxMenu = String(document.title || '');

      var pendingChipForCtxMenu = addInputChipForPanelRuntime({
        type: 'image',
        label: 'Image from page',
        status: 'loading',
        statusText: 'Loading image...',
        pageUrl: pageUrlForCtxMenu,
        pageTitle: pageTitleForCtxMenu
      });

      var dataUrlForCtxMenu = null;
      var mimeTypeForCtxMenu = 'image/png';

      // Try canvas approach: find the already-loaded img element and draw to canvas.
      // Works for same-origin and CORS-enabled cross-origin images.
      try {
        var allImgsForCtxMenu = document.querySelectorAll('img');
        var imgElForCtxMenu = null;
        for (var iImgForCtxMenu = 0; iImgForCtxMenu < allImgsForCtxMenu.length; iImgForCtxMenu++) {
          if (allImgsForCtxMenu[iImgForCtxMenu].src === srcUrlForCtxMenu) {
            imgElForCtxMenu = allImgsForCtxMenu[iImgForCtxMenu];
            break;
          }
        }
        if (imgElForCtxMenu && imgElForCtxMenu.naturalWidth > 0 && imgElForCtxMenu.naturalHeight > 0) {
          var canvasForCtxMenu = document.createElement('canvas');
          canvasForCtxMenu.width = imgElForCtxMenu.naturalWidth;
          canvasForCtxMenu.height = imgElForCtxMenu.naturalHeight;
          var ctx2dForCtxMenu = canvasForCtxMenu.getContext('2d');
          ctx2dForCtxMenu.drawImage(imgElForCtxMenu, 0, 0);
          dataUrlForCtxMenu = canvasForCtxMenu.toDataURL('image/png');
          mimeTypeForCtxMenu = 'image/png';
        }
      } catch (eCanvasForCtxMenu) {
        dataUrlForCtxMenu = null;
      }

      // Fallback: fetch via the background service worker which has <all_urls> host
      // permissions and can bypass CORS restrictions.
      if (!dataUrlForCtxMenu) {
        try {
          var fetchResultForCtxMenu = await new Promise(function (resolveForCtxMenu) {
            try {
              chrome.runtime.sendMessage(
                { action: 'agentWebFetch', url: srcUrlForCtxMenu },
                function (rForCtxMenu) { resolveForCtxMenu(rForCtxMenu || { ok: false }); }
              );
            } catch (eSendForCtxMenu) {
              resolveForCtxMenu({ ok: false });
            }
          });
          if (
            fetchResultForCtxMenu &&
            fetchResultForCtxMenu.ok &&
            typeof fetchResultForCtxMenu.dataUrl === 'string' &&
            fetchResultForCtxMenu.dataUrl.indexOf('data:image/') === 0
          ) {
            dataUrlForCtxMenu = fetchResultForCtxMenu.dataUrl;
            mimeTypeForCtxMenu = fetchResultForCtxMenu.mimeType || 'image/png';
          }
        } catch (eFetchForCtxMenu) {
          dataUrlForCtxMenu = null;
        }
      }

      if (!dataUrlForCtxMenu) {
        if (pendingChipForCtxMenu) {
          setInputChipStatusForPanelRuntime(pendingChipForCtxMenu, 'error', 'Could not load image.');
        }
        return;
      }

      try {
        var approxSizeForCtxMenu = Math.floor(dataUrlForCtxMenu.length * 0.75);
        var persistedBlobForCtxMenu = await createAttachmentBlobForPanelRuntime({
          name: 'Image from page',
          kind: 'image',
          mimeType: mimeTypeForCtxMenu,
          size: approxSizeForCtxMenu,
          dataUrl: dataUrlForCtxMenu
        });
        if (!pendingChipForCtxMenu) return;
        pendingChipForCtxMenu.dataset.attachType = 'image';
        pendingChipForCtxMenu.dataset.attachName = 'Image from page';
        pendingChipForCtxMenu.dataset.attachRefId = String(Number(persistedBlobForCtxMenu && persistedBlobForCtxMenu.id) || '');
        pendingChipForCtxMenu.dataset.attachMimeType = mimeTypeForCtxMenu;
        pendingChipForCtxMenu.dataset.attachSize = String(approxSizeForCtxMenu);
        pendingChipForCtxMenu.dataset.attachKind = 'image';
        pendingChipForCtxMenu.dataset.attachContent = '';
        pendingChipForCtxMenu.dataset.attachPageUrl = pageUrlForCtxMenu;
        pendingChipForCtxMenu.dataset.attachPageTitle = pageTitleForCtxMenu;
        setInputChipStatusForPanelRuntime(pendingChipForCtxMenu, '', '');
      } catch (eBlobForCtxMenu) {
        if (pendingChipForCtxMenu) {
          setInputChipStatusForPanelRuntime(pendingChipForCtxMenu, 'error', 'Could not save image.');
        }
      }
    }

    function addTextChipFromContextMenuForPanelRuntime(textForCtxMenu) {
      if (!textForCtxMenu || typeof textForCtxMenu !== 'string' || !textForCtxMenu.trim()) return;
      addInputChipForPanelRuntime({
        type: 'paste',
        label: 'Selected text',
        content: textForCtxMenu,
        mimeType: 'text/plain',
        kind: 'paste',
        pageUrl: String(window.location.href || ''),
        pageTitle: String(document.title || '')
      });
    }

    // -----------------------------------------------------------------
    // Cross-tab UI mirror relays (driven by panelStateSync.applyState).
    // Each relay applies an incoming state field without writing it back —
    // panelStateSync's applyingFromRemote guard makes writeState a no-op
    // for the duration of the apply.
    // -----------------------------------------------------------------
    function setSidebarCollapsedForMirrorForPanelRuntime(collapsedForMirror) {
      if (Boolean(collapsedForMirror) === Boolean(S.sidebarCollapsed)) return;
      if (collapsedForMirror) collapseSidebar(); else expandSidebar();
    }
    function setNotesSidebarCollapsedForMirrorForPanelRuntime(collapsedForMirror) {
      if (Boolean(collapsedForMirror) === Boolean(S.notesSidebarCollapsed)) return;
      if (collapsedForMirror) collapseNotesSidebar(); else expandNotesSidebar();
    }
    function setActiveChatForMirrorForPanelRuntime(chatIdForMirror) {
      const numericIdForMirror = chatIdForMirror == null ? null : Number(chatIdForMirror);
      if (numericIdForMirror == null) {
        if (S.activeChatId == null) return;
        newChat();
        return;
      }
      if (S.activeChatId === numericIdForMirror) return;
      if (!CHAT_STORE_FOR_PANEL_RUNTIME[numericIdForMirror]) return;
      selectChat(numericIdForMirror);
    }
    function setActiveNoteForMirrorForPanelRuntime(noteIdForMirror) {
      const numericIdForMirror = noteIdForMirror == null ? null : Number(noteIdForMirror);
      if (numericIdForMirror == null) {
        if (S.activeNoteId == null) return;
        S.activeNoteId = null;
        showNoteForm(false);
        S.inNoteView = false;
        // applyingFromRemote guard in writeState makes the sync write a no-op
        // here, but mirror-form for clarity (state will be re-broadcast by the
        // paneNotes field itself when the originator writes 'list').
        setReducedPaneForPanelRuntime('notes', 'list', { skipStateSync: true });
        root.querySelectorAll('.note-item').forEach(function (el) { el.classList.remove('active'); });
        return;
      }
      if (S.activeNoteId === numericIdForMirror) return;
      if (!NOTE_STORE_FOR_PANEL_RUNTIME[numericIdForMirror]) return;
      selectNote(numericIdForMirror);
    }
    function setPickerOpenForMirrorForPanelRuntime(isOpenForMirror, modeForMirror) {
      const isCurrentlyOpenForMirror = !pickerOverlay.classList.contains('hidden');
      if (!isOpenForMirror) {
        if (isCurrentlyOpenForMirror) closePickerModal();
        return;
      }
      if (isCurrentlyOpenForMirror && S.pickerMode === modeForMirror) return;
      if (modeForMirror === 'note') openNotePicker();
      else if (modeForMirror === 'chat') openChatPicker();
    }
    function closeAttachPreviewForMirrorForPanelRuntime() {
      const overlayForMirror = root.getElementById('attach-preview-overlay');
      if (!overlayForMirror || overlayForMirror.classList.contains('hidden')) return;
      closeAttachPreview();
    }
    function setChatScrollTopForMirrorForPanelRuntime(scrollTopForMirror) {
      // Best-effort: apply on next frame so freshly-rendered content has
      // settled. If the chat is mid-load, the rendered scrollHeight may not
      // yet match; we accept that as the documented best-effort.
      requestAnimationFrame(function () {
        const containerForMirror = root.querySelector('.messages-area');
        if (containerForMirror) containerForMirror.scrollTop = Number(scrollTopForMirror) || 0;
      });
    }
    function setNoteScrollTopForMirrorForPanelRuntime(scrollTopForMirror) {
      requestAnimationFrame(function () {
        const containerForMirror = root.querySelector('#note-editor-form .ne-body');
        if (containerForMirror) containerForMirror.scrollTop = Number(scrollTopForMirror) || 0;
      });
    }
    function setPanelModeForMirrorForPanelRuntime(modeForMirror) {
      if (modeForMirror !== 'expanded' && modeForMirror !== 'reduced') return;
      if (S.mode === modeForMirror) return;
      setMode(modeForMirror);
    }
    function setOpenPopoutsForMirrorForPanelRuntime(targetIdsForMirror) {
      if (!Array.isArray(targetIdsForMirror)) return;
      const targetSetForMirror = new Set(targetIdsForMirror.map(Number).filter(Number.isFinite));
      const currentIdsForMirror = Object.keys(NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME).map(Number);
      currentIdsForMirror.forEach(function (idForMirror) {
        if (!targetSetForMirror.has(idForMirror)) {
          closeNotePopoutForPanelRuntime(idForMirror);
        }
      });
      targetSetForMirror.forEach(function (idForMirror) {
        if (!NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[idForMirror] && NOTE_STORE_FOR_PANEL_RUNTIME[idForMirror]) {
          openNotePopoutForPanelRuntime(idForMirror);
        }
      });
      // Reconcile the main-pane handoff so the editor doesn't render alongside
      // its own pop-out: if the active note is now popped out, swap to the
      // handoff placeholder; if it just stopped being popped out, restore the
      // main editor.
      const activeIdForMirror = S.activeNoteId;
      if (activeIdForMirror && NOTE_STORE_FOR_PANEL_RUNTIME[activeIdForMirror]) {
        const isActivePoppedOutForMirror = targetSetForMirror.has(Number(activeIdForMirror));
        const isHandoffShownForMirror = S.handoffNoteId === activeIdForMirror;
        if (isActivePoppedOutForMirror && !isHandoffShownForMirror) {
          showNotePopoutHandoffForPanelRuntime(activeIdForMirror);
        } else if (!isActivePoppedOutForMirror && isHandoffShownForMirror) {
          applyNoteDataToMainEditorForPanelRuntime(activeIdForMirror, false);
        }
      }
    }
    function setChatSidebarScrollTopForMirrorForPanelRuntime(scrollTopForMirror) {
      requestAnimationFrame(function () {
        const containerForMirror = root.querySelector('#chat-sidebar .chat-list');
        if (containerForMirror) containerForMirror.scrollTop = Number(scrollTopForMirror) || 0;
      });
    }
    function setNotesSidebarScrollTopForMirrorForPanelRuntime(scrollTopForMirror) {
      requestAnimationFrame(function () {
        const containerForMirror = root.querySelector('.notes-sidebar .notes-list');
        if (containerForMirror) containerForMirror.scrollTop = Number(scrollTopForMirror) || 0;
      });
    }
    function clampToViewportForMirrorForPanelRuntime(leftForClamp, topForClamp, widthForClamp, heightForClamp) {
      const maxLeftForClamp = Math.max(0, window.innerWidth - widthForClamp);
      const maxTopForClamp = Math.max(0, window.innerHeight - heightForClamp);
      return {
        left: Math.max(0, Math.min(maxLeftForClamp, leftForClamp)),
        top: Math.max(0, Math.min(maxTopForClamp, topForClamp))
      };
    }
    // Pending synced anchor waiting for the panel to enter reduced mode.
    // In expanded mode CSS controls width/centering and inline left/top would
    // break the layout (panel renders half-width offset). We stash the anchor
    // here and apply it when setMode transitions to 'reduced'.
    var pendingSyncedPanelAnchorForPanelRuntime = null;
    // Last-known anchor in this tab. Updated on drag-end and on remote apply.
    // Used by reclamp to re-resolve pixel coords against a changed viewport
    // without needing an async storage read.
    var currentPanelAnchorForPanelRuntime = null;
    function isValidAnchorForPanelRuntime(anchorForCheck) {
      return Boolean(
        anchorForCheck && typeof anchorForCheck === 'object' &&
        (anchorForCheck.ax === 'left' || anchorForCheck.ax === 'right') &&
        (anchorForCheck.ay === 'top' || anchorForCheck.ay === 'bottom') &&
        Number.isFinite(anchorForCheck.ox) && Number.isFinite(anchorForCheck.oy)
      );
    }
    function computePanelAnchorForPanelRuntime(leftForCompute, topForCompute, widthForCompute, heightForCompute) {
      const vwForCompute = window.innerWidth;
      const vhForCompute = window.innerHeight;
      const centerXForCompute = leftForCompute + widthForCompute / 2;
      const centerYForCompute = topForCompute + heightForCompute / 2;
      const axForCompute = centerXForCompute < vwForCompute / 2 ? 'left' : 'right';
      const ayForCompute = centerYForCompute < vhForCompute / 2 ? 'top' : 'bottom';
      const oxForCompute = axForCompute === 'left'
        ? Math.max(0, Math.round(leftForCompute))
        : Math.max(0, Math.round(vwForCompute - leftForCompute - widthForCompute));
      const oyForCompute = ayForCompute === 'top'
        ? Math.max(0, Math.round(topForCompute))
        : Math.max(0, Math.round(vhForCompute - topForCompute - heightForCompute));
      return { ax: axForCompute, ay: ayForCompute, ox: oxForCompute, oy: oyForCompute };
    }
    function resolveAnchorToPixelsForPanelRuntime(anchorForResolve, widthForResolve, heightForResolve) {
      const vwForResolve = window.innerWidth;
      const vhForResolve = window.innerHeight;
      const rawLeftForResolve = anchorForResolve.ax === 'left'
        ? anchorForResolve.ox
        : vwForResolve - widthForResolve - anchorForResolve.ox;
      const rawTopForResolve = anchorForResolve.ay === 'top'
        ? anchorForResolve.oy
        : vhForResolve - heightForResolve - anchorForResolve.oy;
      return clampToViewportForMirrorForPanelRuntime(rawLeftForResolve, rawTopForResolve, widthForResolve, heightForResolve);
    }
    function applyPanelAnchorInlineForPanelRuntime(anchorForApply, widthForApply, heightForApply) {
      const pxForApply = resolveAnchorToPixelsForPanelRuntime(anchorForApply, widthForApply, heightForApply);
      host.style.left = pxForApply.left + 'px';
      host.style.top = pxForApply.top + 'px';
      host.style.right = 'auto';
    }
    function setPanelPositionForMirrorForPanelRuntime(anchorForMirror) {
      if (!isValidAnchorForPanelRuntime(anchorForMirror)) return;
      currentPanelAnchorForPanelRuntime = {
        ax: anchorForMirror.ax, ay: anchorForMirror.ay,
        ox: anchorForMirror.ox, oy: anchorForMirror.oy
      };
      if (S.mode !== 'reduced') {
        // Defer: applying inline left/top in expanded mode breaks the CSS
        // centering and width. Stash for the next transition to reduced.
        pendingSyncedPanelAnchorForPanelRuntime = currentPanelAnchorForPanelRuntime;
        return;
      }
      applyPanelAnchorInlineForPanelRuntime(
        currentPanelAnchorForPanelRuntime, host.offsetWidth, host.offsetHeight
      );
    }
    function setPopoutPositionsForMirrorForPanelRuntime(positionsForMirror) {
      if (!positionsForMirror || typeof positionsForMirror !== 'object') return;
      Object.keys(positionsForMirror).forEach(function (noteIdKeyForMirror) {
        const entryForMirror = positionsForMirror[noteIdKeyForMirror];
        if (!entryForMirror || !Number.isFinite(entryForMirror.left) || !Number.isFinite(entryForMirror.top)) return;
        // Keep the in-memory map in sync so subsequent local writes don't
        // overwrite entries we just received.
        popoutPositionsMapForPanelRuntime[noteIdKeyForMirror] = {
          left: entryForMirror.left,
          top: entryForMirror.top
        };
        // Backfill sessionStorage so future popout opens on this tab use the
        // synced position by default.
        if (typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.setItem(
              NOTE_POPOUT_POSITION_KEY_PREFIX_FOR_PANEL_RUNTIME + noteIdKeyForMirror,
              JSON.stringify({ left: entryForMirror.left, top: entryForMirror.top })
            );
          } catch (errorForMirror) {}
        }
        // If the popout is currently open on this tab, apply with clamping.
        const popoutEltForMirror = NOTE_POPOUT_MAP_FOR_PANEL_RUNTIME[noteIdKeyForMirror];
        if (popoutEltForMirror) {
          const clampedForMirror = clampToViewportForMirrorForPanelRuntime(
            entryForMirror.left,
            entryForMirror.top,
            popoutEltForMirror.offsetWidth,
            popoutEltForMirror.offsetHeight
          );
          popoutEltForMirror.style.left = clampedForMirror.left + 'px';
          popoutEltForMirror.style.top = clampedForMirror.top + 'px';
        }
      });
    }

    // Scroll write hooks: capture scrollTop into storage, debounced.
    var chatScrollWriteTimerForPanelRuntime = null;
    function bindChatScrollWriteForPanelRuntime() {
      const containerForScroll = root.querySelector('.messages-area');
      if (!containerForScroll || containerForScroll.dataset.abchatScrollSyncBound === '1') return;
      containerForScroll.dataset.abchatScrollSyncBound = '1';
      containerForScroll.addEventListener('scroll', function () {
        if (chatScrollWriteTimerForPanelRuntime) clearTimeout(chatScrollWriteTimerForPanelRuntime);
        chatScrollWriteTimerForPanelRuntime = setTimeout(function () {
          writePanelStateSyncForPanelRuntime({ chatScrollTop: containerForScroll.scrollTop });
        }, 150);
      }, { passive: true });
    }
    var noteScrollWriteTimerForPanelRuntime = null;
    function bindNoteScrollWriteForPanelRuntime() {
      const containerForScroll = root.querySelector('#note-editor-form .ne-body');
      if (!containerForScroll || containerForScroll.dataset.abchatScrollSyncBound === '1') return;
      containerForScroll.dataset.abchatScrollSyncBound = '1';
      containerForScroll.addEventListener('scroll', function () {
        if (noteScrollWriteTimerForPanelRuntime) clearTimeout(noteScrollWriteTimerForPanelRuntime);
        noteScrollWriteTimerForPanelRuntime = setTimeout(function () {
          writePanelStateSyncForPanelRuntime({ noteScrollTop: containerForScroll.scrollTop });
        }, 150);
      }, { passive: true });
    }
    var chatSidebarScrollWriteTimerForPanelRuntime = null;
    function bindChatSidebarScrollWriteForPanelRuntime() {
      const containerForScroll = root.querySelector('#chat-sidebar .chat-list');
      if (!containerForScroll || containerForScroll.dataset.abchatScrollSyncBound === '1') return;
      containerForScroll.dataset.abchatScrollSyncBound = '1';
      containerForScroll.addEventListener('scroll', function () {
        if (chatSidebarScrollWriteTimerForPanelRuntime) clearTimeout(chatSidebarScrollWriteTimerForPanelRuntime);
        chatSidebarScrollWriteTimerForPanelRuntime = setTimeout(function () {
          writePanelStateSyncForPanelRuntime({ chatSidebarScrollTop: containerForScroll.scrollTop });
        }, 150);
      }, { passive: true });
    }
    var notesSidebarScrollWriteTimerForPanelRuntime = null;
    function bindNotesSidebarScrollWriteForPanelRuntime() {
      const containerForScroll = root.querySelector('.notes-sidebar .notes-list');
      if (!containerForScroll || containerForScroll.dataset.abchatScrollSyncBound === '1') return;
      containerForScroll.dataset.abchatScrollSyncBound = '1';
      containerForScroll.addEventListener('scroll', function () {
        if (notesSidebarScrollWriteTimerForPanelRuntime) clearTimeout(notesSidebarScrollWriteTimerForPanelRuntime);
        notesSidebarScrollWriteTimerForPanelRuntime = setTimeout(function () {
          writePanelStateSyncForPanelRuntime({ notesSidebarScrollTop: containerForScroll.scrollTop });
        }, 150);
      }, { passive: true });
    }
    bindChatScrollWriteForPanelRuntime();
    bindNoteScrollWriteForPanelRuntime();
    bindChatSidebarScrollWriteForPanelRuntime();
    bindNotesSidebarScrollWriteForPanelRuntime();

    // Initialize cross-tab UI state sync. Reads the stored state and applies it,
    // then binds storage.onChanged. Deferred to the next tick so all relay
    // assignments below are in place when applyState runs.
    setTimeout(function initPanelStateSyncForPanelRuntime() {
      const syncNsForInit =
        globalThis.ABChatContent &&
        globalThis.ABChatContent.ui &&
        globalThis.ABChatContent.ui.panelStateSync;
      if (syncNsForInit && typeof syncNsForInit.init === 'function') {
        syncNsForInit.init();
      }
    }, 0);

    // Expose inner functions for cross-script access via ui.panelRuntime relays.
    _exposedAddInputChipForPanelRuntime = addInputChipForPanelRuntime;
    _exposedSetTabForPanelRuntime = setTab;
    _exposedRefreshStoreForPanelRuntime = scheduleStoreRefreshForPanelRuntime;
    // Drain any refresh signals that arrived before the runtime was ready
    // (e.g. storage.onChanged firing during extension reload re-injection,
    // before panelRuntime.initialize finished).
    if (_pendingRefreshStoresForPanelRuntime.size > 0) {
      _pendingRefreshStoresForPanelRuntime.forEach(function (storeForFlush) {
        scheduleStoreRefreshForPanelRuntime(storeForFlush);
      });
      _pendingRefreshStoresForPanelRuntime.clear();
    }
    _exposedAddImageChipFromContextMenuForPanelRuntime = addImageChipFromContextMenuForPanelRuntime;
    _exposedAddTextChipFromContextMenuForPanelRuntime = addTextChipFromContextMenuForPanelRuntime;
    _exposedSetSidebarCollapsedForPanelRuntime = setSidebarCollapsedForMirrorForPanelRuntime;
    _exposedSetNotesSidebarCollapsedForPanelRuntime = setNotesSidebarCollapsedForMirrorForPanelRuntime;
    _exposedSetActiveChatForPanelRuntime = setActiveChatForMirrorForPanelRuntime;
    _exposedSetActiveNoteForPanelRuntime = setActiveNoteForMirrorForPanelRuntime;
    _exposedSetPickerOpenForPanelRuntime = setPickerOpenForMirrorForPanelRuntime;
    _exposedCloseAttachPreviewForPanelRuntime = closeAttachPreviewForMirrorForPanelRuntime;
    _exposedSetChatScrollTopForPanelRuntime = setChatScrollTopForMirrorForPanelRuntime;
    _exposedSetNoteScrollTopForPanelRuntime = setNoteScrollTopForMirrorForPanelRuntime;
    _exposedSetPanelModeForPanelRuntime = setPanelModeForMirrorForPanelRuntime;
    _exposedSetOpenPopoutsForPanelRuntime = setOpenPopoutsForMirrorForPanelRuntime;
    _exposedSetChatSidebarScrollTopForPanelRuntime = setChatSidebarScrollTopForMirrorForPanelRuntime;
    _exposedSetNotesSidebarScrollTopForPanelRuntime = setNotesSidebarScrollTopForMirrorForPanelRuntime;
    _exposedSetPanelPositionForPanelRuntime = setPanelPositionForMirrorForPanelRuntime;
    _exposedSetPopoutPositionsForPanelRuntime = setPopoutPositionsForMirrorForPanelRuntime;
    _exposedReclampPanelPositionForPanelRuntime = reclampPanelPositionForPanelRuntime;
    _exposedHandleRemoteStreamEventForPanelRuntime = handleRemoteStreamEventForPanelRuntime;
    _exposedHandleRemoteCancelDeliverForPanelRuntime = handleRemoteCancelDeliverForPanelRuntime;
    _exposedSetReducedPaneForPanelRuntime = setReducedPaneForMirrorForPanelRuntime;
    _exposedSetChatSubTabForPanelRuntime = setChatSubTabForMirrorForPanelRuntime;
    _exposedSetTaskFilterForPanelRuntime = setTaskFilterForMirrorForPanelRuntime;
    _exposedSetQuizFilterForPanelRuntime = setQuizFilterForMirrorForPanelRuntime;
    _exposedSetChatSearchQueryForPanelRuntime = setChatSearchQueryForMirrorForPanelRuntime;
    _exposedSetNotesSearchQueryForPanelRuntime = setNotesSearchQueryForMirrorForPanelRuntime;
    _exposedSetTaskSearchQueryForPanelRuntime = setTaskSearchQueryForMirrorForPanelRuntime;

    // Kick off the libs ready gate as the final step of initialisation so all
    // other setup (event bindings, MutationObserver, etc.) is complete before
    // we hand control back to the user.
    activateLibsReadyGateForPanelRuntime();
  }

  contentNamespaceForPanelRuntime.ui = contentNamespaceForPanelRuntime.ui || {};
  contentNamespaceForPanelRuntime.ui.panelRuntime = {
    initialize: initializePanelRuntimeForPanel,
    addInputChip: function addInputChipRelayForPanelRuntime(chipDataForRelay) {
      return _exposedAddInputChipForPanelRuntime ? _exposedAddInputChipForPanelRuntime(chipDataForRelay) : null;
    },
    setTab: function setTabRelayForPanelRuntime(tabForRelay) {
      if (_exposedSetTabForPanelRuntime) _exposedSetTabForPanelRuntime(tabForRelay);
    },
    refreshStore: function refreshStoreRelayForPanelRuntime(storeForRelay, opsForRelay) {
      if (_exposedRefreshStoreForPanelRuntime) {
        _exposedRefreshStoreForPanelRuntime(storeForRelay, opsForRelay);
        return;
      }
      // Runtime not ready yet — queue the store name. Ops are dropped on
      // purpose: during boot we want the upcoming flush to do a complete
      // refresh rather than try to apply ad-hoc deltas, since we don't yet
      // know which records the in-memory store has.
      if (typeof storeForRelay === 'string' && storeForRelay) {
        _pendingRefreshStoresForPanelRuntime.add(storeForRelay);
      }
    },
    addImageChipFromContextMenu: function addImageChipFromContextMenuRelayForPanelRuntime(srcUrlForRelay) {
      if (_exposedAddImageChipFromContextMenuForPanelRuntime) _exposedAddImageChipFromContextMenuForPanelRuntime(srcUrlForRelay);
    },
    addTextChipFromContextMenu: function addTextChipFromContextMenuRelayForPanelRuntime(textForRelay) {
      if (_exposedAddTextChipFromContextMenuForPanelRuntime) _exposedAddTextChipFromContextMenuForPanelRuntime(textForRelay);
    },
    setSidebarCollapsed: function setSidebarCollapsedRelayForPanelRuntime(collapsedForRelay) {
      if (_exposedSetSidebarCollapsedForPanelRuntime) _exposedSetSidebarCollapsedForPanelRuntime(collapsedForRelay);
    },
    setNotesSidebarCollapsed: function setNotesSidebarCollapsedRelayForPanelRuntime(collapsedForRelay) {
      if (_exposedSetNotesSidebarCollapsedForPanelRuntime) _exposedSetNotesSidebarCollapsedForPanelRuntime(collapsedForRelay);
    },
    setActiveChat: function setActiveChatRelayForPanelRuntime(chatIdForRelay) {
      if (_exposedSetActiveChatForPanelRuntime) _exposedSetActiveChatForPanelRuntime(chatIdForRelay);
    },
    setActiveNote: function setActiveNoteRelayForPanelRuntime(noteIdForRelay) {
      if (_exposedSetActiveNoteForPanelRuntime) _exposedSetActiveNoteForPanelRuntime(noteIdForRelay);
    },
    setPickerOpen: function setPickerOpenRelayForPanelRuntime(isOpenForRelay, modeForRelay) {
      if (_exposedSetPickerOpenForPanelRuntime) _exposedSetPickerOpenForPanelRuntime(isOpenForRelay, modeForRelay);
    },
    closeAttachPreview: function closeAttachPreviewRelayForPanelRuntime() {
      if (_exposedCloseAttachPreviewForPanelRuntime) _exposedCloseAttachPreviewForPanelRuntime();
    },
    setChatScrollTop: function setChatScrollTopRelayForPanelRuntime(scrollTopForRelay) {
      if (_exposedSetChatScrollTopForPanelRuntime) _exposedSetChatScrollTopForPanelRuntime(scrollTopForRelay);
    },
    setNoteScrollTop: function setNoteScrollTopRelayForPanelRuntime(scrollTopForRelay) {
      if (_exposedSetNoteScrollTopForPanelRuntime) _exposedSetNoteScrollTopForPanelRuntime(scrollTopForRelay);
    },
    setPanelMode: function setPanelModeRelayForPanelRuntime(modeForRelay) {
      if (_exposedSetPanelModeForPanelRuntime) _exposedSetPanelModeForPanelRuntime(modeForRelay);
    },
    setOpenPopouts: function setOpenPopoutsRelayForPanelRuntime(idsForRelay) {
      if (_exposedSetOpenPopoutsForPanelRuntime) _exposedSetOpenPopoutsForPanelRuntime(idsForRelay);
    },
    setChatSidebarScrollTop: function setChatSidebarScrollTopRelayForPanelRuntime(scrollTopForRelay) {
      if (_exposedSetChatSidebarScrollTopForPanelRuntime) _exposedSetChatSidebarScrollTopForPanelRuntime(scrollTopForRelay);
    },
    setNotesSidebarScrollTop: function setNotesSidebarScrollTopRelayForPanelRuntime(scrollTopForRelay) {
      if (_exposedSetNotesSidebarScrollTopForPanelRuntime) _exposedSetNotesSidebarScrollTopForPanelRuntime(scrollTopForRelay);
    },
    setPanelPosition: function setPanelPositionRelayForPanelRuntime(anchorForRelay) {
      if (_exposedSetPanelPositionForPanelRuntime) _exposedSetPanelPositionForPanelRuntime(anchorForRelay);
    },
    setPopoutPositions: function setPopoutPositionsRelayForPanelRuntime(positionsForRelay) {
      if (_exposedSetPopoutPositionsForPanelRuntime) _exposedSetPopoutPositionsForPanelRuntime(positionsForRelay);
    },
    reclampPanelPosition: function reclampPanelPositionRelayForPanelRuntime(optionsForRelay) {
      if (_exposedReclampPanelPositionForPanelRuntime) {
        return _exposedReclampPanelPositionForPanelRuntime(optionsForRelay);
      }
      return false;
    },
    handleRemoteStreamEvent: function handleRemoteStreamEventRelayForPanelRuntime(eventForRelay, chatIdForRelay, payloadForRelay) {
      if (_exposedHandleRemoteStreamEventForPanelRuntime) {
        _exposedHandleRemoteStreamEventForPanelRuntime(eventForRelay, chatIdForRelay, payloadForRelay);
      }
    },
    handleRemoteCancelDeliver: function handleRemoteCancelDeliverRelayForPanelRuntime(chatIdForRelay) {
      if (_exposedHandleRemoteCancelDeliverForPanelRuntime) {
        _exposedHandleRemoteCancelDeliverForPanelRuntime(chatIdForRelay);
      }
    },
    setReducedPane: function setReducedPaneRelayForPanelRuntime(tabForRelay, paneForRelay) {
      if (_exposedSetReducedPaneForPanelRuntime) _exposedSetReducedPaneForPanelRuntime(tabForRelay, paneForRelay);
    },
    setChatSubTab: function setChatSubTabRelayForPanelRuntime(typeForRelay) {
      if (_exposedSetChatSubTabForPanelRuntime) _exposedSetChatSubTabForPanelRuntime(typeForRelay);
    },
    setTaskFilter: function setTaskFilterRelayForPanelRuntime(filterForRelay) {
      if (_exposedSetTaskFilterForPanelRuntime) _exposedSetTaskFilterForPanelRuntime(filterForRelay);
    },
    setQuizFilter: function setQuizFilterRelayForPanelRuntime(filterForRelay) {
      if (_exposedSetQuizFilterForPanelRuntime) _exposedSetQuizFilterForPanelRuntime(filterForRelay);
    },
    setChatSearchQuery: function setChatSearchQueryRelayForPanelRuntime(queryForRelay) {
      if (_exposedSetChatSearchQueryForPanelRuntime) _exposedSetChatSearchQueryForPanelRuntime(queryForRelay);
    },
    setNotesSearchQuery: function setNotesSearchQueryRelayForPanelRuntime(queryForRelay) {
      if (_exposedSetNotesSearchQueryForPanelRuntime) _exposedSetNotesSearchQueryForPanelRuntime(queryForRelay);
    },
    setTaskSearchQuery: function setTaskSearchQueryRelayForPanelRuntime(queryForRelay) {
      if (_exposedSetTaskSearchQueryForPanelRuntime) _exposedSetTaskSearchQueryForPanelRuntime(queryForRelay);
    },
    // Called by content/main.js before the shadow host is removed on extension reload.
    // Cancels pending timers and removes the storage listener so they do not fire
    // against a stale DOM after re-injection.
    // REGRESSION RISK: any new persistent resource (timer, listener, observer) allocated
    // inside initializePanelRuntimeForPanel must be cancelled here, or it will leak
    // across extension reloads and may interact with the new panel instance.
    teardown: function teardownRelayForPanelRuntime() {
      if (draftSaveTimerForPanelRuntime) {
        clearTimeout(draftSaveTimerForPanelRuntime);
        draftSaveTimerForPanelRuntime = null;
      }
      if (draftStorageSyncListenerForPanelRuntime) {
        try { chrome.storage.onChanged.removeListener(draftStorageSyncListenerForPanelRuntime); } catch (e) {}
        draftStorageSyncListenerForPanelRuntime = null;
      }
      if (noteDraftStorageSyncListenerForPanelRuntime) {
        try { chrome.storage.onChanged.removeListener(noteDraftStorageSyncListenerForPanelRuntime); } catch (e) {}
        noteDraftStorageSyncListenerForPanelRuntime = null;
      }
      if (themeStorageSyncListenerForPanelRuntime) {
        try { chrome.storage.onChanged.removeListener(themeStorageSyncListenerForPanelRuntime); } catch (e) {}
        themeStorageSyncListenerForPanelRuntime = null;
      }
      if (agentRulesStorageSyncListenerForPanelRuntime) {
        try { chrome.storage.onChanged.removeListener(agentRulesStorageSyncListenerForPanelRuntime); } catch (e) {}
        agentRulesStorageSyncListenerForPanelRuntime = null;
      }
      Object.keys(noteDraftSyncTimersForPanelRuntime).forEach(function (timerKeyForNoteDraft) {
        clearTimeout(noteDraftSyncTimersForPanelRuntime[timerKeyForNoteDraft]);
      });
      noteDraftSyncTimersForPanelRuntime = {};
      const syncNsForTeardown =
        globalThis.ABChatContent &&
        globalThis.ABChatContent.ui &&
        globalThis.ABChatContent.ui.panelStateSync;
      if (syncNsForTeardown && typeof syncNsForTeardown.teardown === 'function') {
        syncNsForTeardown.teardown();
      }
    }
  };

  globalScopeForPanelRuntime.ABChatContent = contentNamespaceForPanelRuntime;
})();
