(function () {
  const globalScopeForDb = globalThis;
  const ns = globalScopeForDb.ABChatShared || {};

  const db = new Dexie('ABChatDB');

  function normalizeTimestampForDb(rawTimestampForDb) {
    if (rawTimestampForDb == null || rawTimestampForDb === '') return '';
    const parsedTimestampForDb = new Date(rawTimestampForDb);
    if (!Number.isFinite(parsedTimestampForDb.getTime())) return '';
    return parsedTimestampForDb.toISOString();
  }

  function normalizeTaskDateTimeForDb(rawDateTimeForDb) {
    if (rawDateTimeForDb == null || rawDateTimeForDb === '') return '';
    const dateTimeTextForDb = String(rawDateTimeForDb).trim();
    if (!dateTimeTextForDb) return '';

    let parsedDateTimeForDb;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeTextForDb)) {
      parsedDateTimeForDb = new Date(dateTimeTextForDb);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeTextForDb)) {
      parsedDateTimeForDb = new Date(dateTimeTextForDb + 'T00:00');
    } else {
      parsedDateTimeForDb = new Date(dateTimeTextForDb);
    }

    if (!Number.isFinite(parsedDateTimeForDb.getTime())) return '';
    return parsedDateTimeForDb.toISOString();
  }

  function normalizeDateOnlyForDb(rawDateForDb) {
    if (rawDateForDb == null || rawDateForDb === '') return '';
    const dateTextForDb = String(rawDateForDb).trim();
    if (!dateTextForDb) return '';
    const directDateMatchForDb = dateTextForDb.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directDateMatchForDb) {
      return directDateMatchForDb[1];
    }
    const parsedDateForDb = new Date(dateTextForDb);
    if (!Number.isFinite(parsedDateForDb.getTime())) return '';
    return parsedDateForDb.toISOString().slice(0, 10);
  }

  db.version(1).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt'
  });

  db.version(2).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt'
  }).upgrade(async function (txForDbMigration) {
    await txForDbMigration.table('tasks').toCollection().modify(function (taskForDbMigration) {
      const normalizedDueAtForDbMigration = normalizeTaskDateTimeForDb(taskForDbMigration.dueAt);
      if (normalizedDueAtForDbMigration && normalizedDueAtForDbMigration !== taskForDbMigration.dueAt) {
        taskForDbMigration.dueAt = normalizedDueAtForDbMigration;
      }

      const normalizedReminderAtForDbMigration = normalizeTaskDateTimeForDb(taskForDbMigration.reminderAt);
      if (normalizedReminderAtForDbMigration && normalizedReminderAtForDbMigration !== taskForDbMigration.reminderAt) {
        taskForDbMigration.reminderAt = normalizedReminderAtForDbMigration;
      }

      const normalizedCreatedAtForDbMigration = normalizeTimestampForDb(taskForDbMigration.createdAt);
      if (normalizedCreatedAtForDbMigration && normalizedCreatedAtForDbMigration !== taskForDbMigration.createdAt) {
        taskForDbMigration.createdAt = normalizedCreatedAtForDbMigration;
      }

      const normalizedUpdatedAtForDbMigration = normalizeTimestampForDb(taskForDbMigration.updatedAt);
      if (normalizedUpdatedAtForDbMigration && normalizedUpdatedAtForDbMigration !== taskForDbMigration.updatedAt) {
        taskForDbMigration.updatedAt = normalizedUpdatedAtForDbMigration;
      }
    });

    await txForDbMigration.table('questions').toCollection().modify(function (questionForDbMigration) {
      const normalizedDueAtForDbMigration = normalizeDateOnlyForDb(questionForDbMigration.dueAt);
      if (normalizedDueAtForDbMigration && normalizedDueAtForDbMigration !== questionForDbMigration.dueAt) {
        questionForDbMigration.dueAt = normalizedDueAtForDbMigration;
      }

      if (questionForDbMigration.pausedUntil != null) {
        const normalizedPausedUntilForDbMigration = normalizeDateOnlyForDb(questionForDbMigration.pausedUntil);
        if (normalizedPausedUntilForDbMigration && normalizedPausedUntilForDbMigration !== questionForDbMigration.pausedUntil) {
          questionForDbMigration.pausedUntil = normalizedPausedUntilForDbMigration;
        }
      }

      const normalizedCreatedAtForDbMigration = normalizeTimestampForDb(questionForDbMigration.createdAt);
      if (normalizedCreatedAtForDbMigration && normalizedCreatedAtForDbMigration !== questionForDbMigration.createdAt) {
        questionForDbMigration.createdAt = normalizedCreatedAtForDbMigration;
      }

      const normalizedUpdatedAtForDbMigration = normalizeTimestampForDb(questionForDbMigration.updatedAt);
      if (normalizedUpdatedAtForDbMigration && normalizedUpdatedAtForDbMigration !== questionForDbMigration.updatedAt) {
        questionForDbMigration.updatedAt = normalizedUpdatedAtForDbMigration;
      }
    });
  });

  db.version(3).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt',
    webFetchCache:   'url'
  });

  ns.db = db;
  globalScopeForDb.ABChatShared = ns;
})();
