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

  // A message "has an attachment" if it carries a real file/image chip (an uploaded
  // file, attached image, screenshot, or spreadsheet) or its markdown embeds a
  // generated image (__blob:N__) or generated document (#abchat-docblob-N). Text/context
  // chips (page, page-snapshot, selection, paste, note, chat, tab) do not count.
  const ATTACHMENT_FILE_CHIP_TYPES_FOR_DB = { file: true, image: true, screenshot: true, spreadsheet: true };
  function messageHasAttachmentForDb(messageForDb) {
    if (!messageForDb || typeof messageForDb !== 'object') return false;
    if (Array.isArray(messageForDb.chips)) {
      for (let chipIndexForDb = 0; chipIndexForDb < messageForDb.chips.length; chipIndexForDb++) {
        const chipForDb = messageForDb.chips[chipIndexForDb];
        if (!chipForDb || typeof chipForDb !== 'object') continue;
        const chipTypeForDb = String(chipForDb.type || '').trim();
        if (chipTypeForDb && ATTACHMENT_FILE_CHIP_TYPES_FOR_DB[chipTypeForDb]) return true;
      }
    }
    const mdForDb = typeof messageForDb.md === 'string' ? messageForDb.md : '';
    if (mdForDb && (/__blob:\d+__/.test(mdForDb) || /#abchat-docblob-\d+/.test(mdForDb))) return true;
    return false;
  }

  // Recomputes chats.hasAttachments for every chat by scanning the messages table once.
  // Shared by the schema upgrades so the stored flag tracks whatever messageHasAttachmentForDb
  // currently considers an attachment.
  async function backfillChatAttachmentFlagsForDb(txForDbMigration) {
    const chatIdsWithAttachmentsForDbMigration = new Set();
    await txForDbMigration.table('messages').toCollection().each(function (messageForDbMigration) {
      if (messageHasAttachmentForDb(messageForDbMigration)) {
        chatIdsWithAttachmentsForDbMigration.add(Number(messageForDbMigration.chatId));
      }
    });
    await txForDbMigration.table('chats').toCollection().modify(function (chatForDbMigration) {
      chatForDbMigration.hasAttachments = chatIdsWithAttachmentsForDbMigration.has(Number(chatForDbMigration.id));
    });
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

  // hasAttachments is read from the in-memory chat row when rendering the sidebar,
  // never queried, so it does not need an index; the schema strings stay unchanged.
  // The upgrade backfills the flag for existing chats by scanning their messages once.
  db.version(4).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt',
    webFetchCache:   'url'
  }).upgrade(backfillChatAttachmentFlagsForDb);

  // Recomputes hasAttachments after narrowing the attachment definition to real
  // files/images: clears the flag on chats that only ever had text/context chips
  // (page, selection, paste, note, chat, tab), which the version(4) backfill set true.
  db.version(5).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt',
    webFetchCache:   'url'
  }).upgrade(backfillChatAttachmentFlagsForDb);

  // Indexes contentHash so an already-parsed file can be found without scanning the table.
  // attachmentBlobs rows carry whole documents, so a scan would deserialize megabytes per row
  // and cost more than the duplicate parse it is trying to avoid.
  //
  // Add-index-only, with no upgrade function: existing rows keep an undefined contentHash and
  // are simply never reused. They cannot be backfilled, because everything except DOCX keeps
  // only the extracted text and the source bytes are already gone.
  db.version(6).stores({
    chats:           '++id, title, createdAt, updatedAt, isPinned',
    messages:        '++id, chatId, role, createdAt, [chatId+createdAt]',
    notes:           '++id, title, noteType, sourceChatId, createdAt, updatedAt',
    noteVersions:    '++id, noteId, savedAt',
    tasks:           '++id, title, dueAt, isCompleted, createdAt, updatedAt',
    questions:       '++id, title, intervalStage, dueAt, isPaused, createdAt, updatedAt',
    attachmentBlobs: '++id, createdAt, contentHash',
    webFetchCache:   'url'
  });

  ns.db = db;
  ns.messageHasAttachment = messageHasAttachmentForDb;
  globalScopeForDb.ABChatShared = ns;
})();
