// Real panelDataRepo implementation for the service worker. Reads and writes ABChatDB via Dexie.
// Loaded only in background/service-worker.js via importScripts — never in content scripts.
// When adding a new function here, also add a matching proxy entry in shared/panelDataRepo.js,
// and add a handler case in background/dbHandler.js if the function needs special routing (e.g. seedIfEmpty).
(function () {
  var globalScopeForPanelDataRepo = globalThis;
  var nsForPanelDataRepo = globalScopeForPanelDataRepo.ABChatShared || {};

  function getDbForPanelDataRepo() {
    return (globalScopeForPanelDataRepo.ABChatShared || {}).db || null;
  }

  function requireDbForPanelDataRepo() {
    var dbForPanelDataRepo = getDbForPanelDataRepo();
    if (!dbForPanelDataRepo) {
      throw new Error('Database not ready');
    }
    return dbForPanelDataRepo;
  }

  function getIsoNowForPanelDataRepo() {
    return new Date().toISOString();
  }

  function getLocalDateStringForPanelDataRepo(dateObjForLocal) {
    var yForLocal = dateObjForLocal.getFullYear();
    var mForLocal = String(dateObjForLocal.getMonth() + 1).padStart(2, '0');
    var dForLocal = String(dateObjForLocal.getDate()).padStart(2, '0');
    return yForLocal + '-' + mForLocal + '-' + dForLocal;
  }

  function normalizeTimestampForPanelDataRepo(rawTimestampForPanelDataRepo, fallbackTimestampForPanelDataRepo) {
    var fallbackForPanelDataRepo = String(fallbackTimestampForPanelDataRepo || getIsoNowForPanelDataRepo());
    if (rawTimestampForPanelDataRepo == null || rawTimestampForPanelDataRepo === '') {
      return fallbackForPanelDataRepo;
    }
    var parsedTimestampForPanelDataRepo = new Date(rawTimestampForPanelDataRepo);
    if (!Number.isFinite(parsedTimestampForPanelDataRepo.getTime())) {
      return fallbackForPanelDataRepo;
    }
    return parsedTimestampForPanelDataRepo.toISOString();
  }

  function normalizeTaskDateTimeForPanelDataRepo(rawDateTimeForPanelDataRepo, fallbackDateTimeForPanelDataRepo) {
    var fallbackForPanelDataRepo = String(fallbackDateTimeForPanelDataRepo || getIsoNowForPanelDataRepo());
    if (rawDateTimeForPanelDataRepo == null || rawDateTimeForPanelDataRepo === '') {
      return fallbackForPanelDataRepo;
    }
    var dateTimeTextForPanelDataRepo = String(rawDateTimeForPanelDataRepo).trim();
    if (!dateTimeTextForPanelDataRepo) {
      return fallbackForPanelDataRepo;
    }

    var parsedDateTimeForPanelDataRepo;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeTextForPanelDataRepo)) {
      parsedDateTimeForPanelDataRepo = new Date(dateTimeTextForPanelDataRepo);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeTextForPanelDataRepo)) {
      parsedDateTimeForPanelDataRepo = new Date(dateTimeTextForPanelDataRepo + 'T00:00');
    } else {
      parsedDateTimeForPanelDataRepo = new Date(dateTimeTextForPanelDataRepo);
    }

    if (!Number.isFinite(parsedDateTimeForPanelDataRepo.getTime())) {
      return fallbackForPanelDataRepo;
    }
    return parsedDateTimeForPanelDataRepo.toISOString();
  }

  function normalizeDateOnlyForPanelDataRepo(rawDateForPanelDataRepo, fallbackDateForPanelDataRepo) {
    var fallbackForPanelDataRepo = String(fallbackDateForPanelDataRepo || getQuestionDueDateForPanelDataRepo());
    if (rawDateForPanelDataRepo == null || rawDateForPanelDataRepo === '') {
      return fallbackForPanelDataRepo;
    }
    var dateTextForPanelDataRepo = String(rawDateForPanelDataRepo).trim();
    if (!dateTextForPanelDataRepo) {
      return fallbackForPanelDataRepo;
    }

    var directMatchForPanelDataRepo = dateTextForPanelDataRepo.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatchForPanelDataRepo) {
      return directMatchForPanelDataRepo[1];
    }

    var parsedDateForPanelDataRepo = new Date(dateTextForPanelDataRepo);
    if (!Number.isFinite(parsedDateForPanelDataRepo.getTime())) {
      return fallbackForPanelDataRepo;
    }
    return getLocalDateStringForPanelDataRepo(parsedDateForPanelDataRepo);
  }

  function normalizeTagsForPanelDataRepo(tagsForPanelDataRepo) {
    if (!Array.isArray(tagsForPanelDataRepo)) return [];
    return tagsForPanelDataRepo
      .map(function (tagForPanelDataRepo) {
        return String(tagForPanelDataRepo || '').trim();
      })
      .filter(Boolean);
  }

  function normalizeAttachmentsForPanelDataRepo(attachmentsForPanelDataRepo) {
    if (!Array.isArray(attachmentsForPanelDataRepo)) return [];
    return attachmentsForPanelDataRepo
      .map(function (attachmentForPanelDataRepo) {
        if (!attachmentForPanelDataRepo || typeof attachmentForPanelDataRepo !== 'object') {
          return null;
        }
        var parsedRefIdForAttach = Number(attachmentForPanelDataRepo.refId);
        return {
          name: String(attachmentForPanelDataRepo.name || ''),
          refId: Number.isFinite(parsedRefIdForAttach) ? parsedRefIdForAttach : null
        };
      })
      .filter(Boolean);
  }

  function normalizeMcqOptionsForPanelDataRepo(optionsForPanelDataRepo) {
    if (!Array.isArray(optionsForPanelDataRepo)) return [];
    return optionsForPanelDataRepo
      .map(function (optionForPanelDataRepo) {
        if (!optionForPanelDataRepo || typeof optionForPanelDataRepo !== 'object') {
          return null;
        }
        return {
          text: String(optionForPanelDataRepo.text || ''),
          isCorrect: Boolean(optionForPanelDataRepo.isCorrect)
        };
      })
      .filter(Boolean);
  }

  function normalizeAlternativeAnswersForPanelDataRepo(alternativesForPanelDataRepo) {
    if (!Array.isArray(alternativesForPanelDataRepo)) return [];
    return alternativesForPanelDataRepo
      .map(function (answerForPanelDataRepo) {
        return String(answerForPanelDataRepo || '').trim();
      })
      .filter(Boolean);
  }

  function getTomorrowIsoForPanelDataRepo() {
    return new Date(Date.now() + 86400000).toISOString();
  }

  function getTomorrowMinusHourIsoForPanelDataRepo() {
    return new Date(Date.now() + 82800000).toISOString();
  }

  function getQuestionDueDateForPanelDataRepo() {
    return getLocalDateStringForPanelDataRepo(new Date(Date.now() + 2 * 86400000));
  }

  function normalizeChatTypeForPanelDataRepo(rawTypeForPanelDataRepo) {
    return rawTypeForPanelDataRepo === 'quickq' ? 'quickq' : 'chat';
  }

  function normalizeChatTimestampForPanelDataRepo(rawTimestampForPanelDataRepo, fallbackTimestampForPanelDataRepo) {
    return normalizeTimestampForPanelDataRepo(rawTimestampForPanelDataRepo, fallbackTimestampForPanelDataRepo);
  }

  function normalizeMessageRoleForPanelDataRepo(rawRoleForPanelDataRepo) {
    var roleForPanelDataRepo = String(rawRoleForPanelDataRepo || '').trim();
    if (!roleForPanelDataRepo) return 'user';
    return roleForPanelDataRepo;
  }

  function normalizeMessageChipsForPanelDataRepo(chipsForPanelDataRepo) {
    if (!Array.isArray(chipsForPanelDataRepo)) return [];
    return chipsForPanelDataRepo
      .map(function (chipForPanelDataRepo) {
        if (!chipForPanelDataRepo || typeof chipForPanelDataRepo !== 'object') return null;
        var typeForPanelDataRepo = String(chipForPanelDataRepo.type || '').trim();
        var labelForPanelDataRepo = String(chipForPanelDataRepo.label || '').trim();
        if (!typeForPanelDataRepo || !labelForPanelDataRepo) return null;
        var parsedRefIdForPanelDataRepo = Number(chipForPanelDataRepo.refId);
        return {
          type: typeForPanelDataRepo,
          label: labelForPanelDataRepo,
          content: String(chipForPanelDataRepo.content || ''),
          mimeType: String(chipForPanelDataRepo.mimeType || ''),
          refId: Number.isFinite(parsedRefIdForPanelDataRepo) ? parsedRefIdForPanelDataRepo : null,
          size: Number.isFinite(Number(chipForPanelDataRepo.size)) ? Number(chipForPanelDataRepo.size) : 0,
          kind: String(chipForPanelDataRepo.kind || ''),
          pageUrl: String(chipForPanelDataRepo.pageUrl || ''),
          pageTitle: String(chipForPanelDataRepo.pageTitle || ''),
          elementSelector: String(chipForPanelDataRepo.elementSelector || ''),
          htmlFormat: String(chipForPanelDataRepo.htmlFormat || ''),
          sourceHash: String(chipForPanelDataRepo.sourceHash || '')
        };
      })
      .filter(Boolean);
  }

  // Whether a message carries a file-type chip or an embedded generated image/document.
  // Defined once in shared/db.js (loaded before this file in the service worker) so the
  // upgrade backfill, seeding, and runtime writes all share one predicate.
  function messageHasAttachmentForPanelDataRepo(messageForPanelDataRepo) {
    var sharedNsForPanelDataRepo = globalThis.ABChatShared || {};
    return typeof sharedNsForPanelDataRepo.messageHasAttachment === 'function'
      ? sharedNsForPanelDataRepo.messageHasAttachment(messageForPanelDataRepo)
      : false;
  }

  function normalizeAttachmentBlobRecordForPanelDataRepo(blobInputForPanelDataRepo) {
    var inputForPanelDataRepo = blobInputForPanelDataRepo || {};
    return {
      name: String(inputForPanelDataRepo.name || ''),
      kind: String(inputForPanelDataRepo.kind || ''),
      mimeType: String(inputForPanelDataRepo.mimeType || ''),
      size: Number.isFinite(Number(inputForPanelDataRepo.size)) ? Number(inputForPanelDataRepo.size) : 0,
      dataUrl: String(inputForPanelDataRepo.dataUrl || ''),
      textContent: String(inputForPanelDataRepo.textContent || ''),
      createdAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, getIsoNowForPanelDataRepo())
    };
  }

  function normalizePageContextForPanelDataRepo(pageContextInputForPanelDataRepo) {
    if (!pageContextInputForPanelDataRepo || typeof pageContextInputForPanelDataRepo !== 'object') return null;
    var urlForPageContext = String(pageContextInputForPanelDataRepo.url || '').trim().slice(0, 2048);
    if (!urlForPageContext) return null;
    var titleForPageContext = String(pageContextInputForPanelDataRepo.title || '').trim().slice(0, 512);
    return { url: urlForPageContext, title: titleForPageContext };
  }

  function normalizeMessageRecordForPanelDataRepo(chatIdForPanelDataRepo, messageInputForPanelDataRepo, fallbackTimestampForPanelDataRepo) {
    var inputForPanelDataRepo = messageInputForPanelDataRepo || {};
    var normalizedRoleForPanelDataRepo = normalizeMessageRoleForPanelDataRepo(inputForPanelDataRepo.role);
    var normalizedContentForPanelDataRepo = String(inputForPanelDataRepo.content || '');
    var hasMdForPanelDataRepo = inputForPanelDataRepo.md != null;
    var normalizedMdForPanelDataRepo = hasMdForPanelDataRepo
      ? String(inputForPanelDataRepo.md)
      : (normalizedRoleForPanelDataRepo === 'user' ? normalizedContentForPanelDataRepo : '');
    return {
      chatId: Number(chatIdForPanelDataRepo),
      role: normalizedRoleForPanelDataRepo,
      content: normalizedContentForPanelDataRepo,
      md: normalizedMdForPanelDataRepo,
      chips: normalizeMessageChipsForPanelDataRepo(inputForPanelDataRepo.chips),
      pageContext: normalizePageContextForPanelDataRepo(inputForPanelDataRepo.pageContext),
      tool_calls: Array.isArray(inputForPanelDataRepo.tool_calls) ? inputForPanelDataRepo.tool_calls : undefined,
      tool_call_id: inputForPanelDataRepo.tool_call_id != null ? String(inputForPanelDataRepo.tool_call_id) : undefined,
      isHidden: Boolean(inputForPanelDataRepo.isHidden),
      usagePromptTokens: Number.isFinite(Number(inputForPanelDataRepo.usagePromptTokens)) ? Number(inputForPanelDataRepo.usagePromptTokens) : 0,
      usageCompletionTokens: Number.isFinite(Number(inputForPanelDataRepo.usageCompletionTokens)) ? Number(inputForPanelDataRepo.usageCompletionTokens) : 0,
      usageTotalTokens: Number.isFinite(Number(inputForPanelDataRepo.usageTotalTokens)) ? Number(inputForPanelDataRepo.usageTotalTokens) : 0,
      usageReasoningTokens: Number.isFinite(Number(inputForPanelDataRepo.usageReasoningTokens)) ? Number(inputForPanelDataRepo.usageReasoningTokens) : 0,
      usageCost: Number.isFinite(Number(inputForPanelDataRepo.usageCost)) ? Number(inputForPanelDataRepo.usageCost) : 0,
      searchSources: Array.isArray(inputForPanelDataRepo.searchSources)
        ? inputForPanelDataRepo.searchSources.map(function(s) {
            return { url: String((s && s.url) || ''), title: String((s && s.title) || '') };
          }).filter(function(s) { return Boolean(s.url); })
        : [],
      incomplete: Boolean(inputForPanelDataRepo.incomplete),
      systemNotice: Boolean(inputForPanelDataRepo.systemNotice),
      createdAt: normalizeChatTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, fallbackTimestampForPanelDataRepo || getIsoNowForPanelDataRepo())
    };
  }

  function sortMessagesForPanelDataRepo(messagesForPanelDataRepo) {
    messagesForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      var aTimeForPanelDataRepo = new Date(aForPanelDataRepo.createdAt || 0).getTime();
      var bTimeForPanelDataRepo = new Date(bForPanelDataRepo.createdAt || 0).getTime();
      if (!Number.isFinite(aTimeForPanelDataRepo)) aTimeForPanelDataRepo = 0;
      if (!Number.isFinite(bTimeForPanelDataRepo)) bTimeForPanelDataRepo = 0;
      if (aTimeForPanelDataRepo !== bTimeForPanelDataRepo) return aTimeForPanelDataRepo - bTimeForPanelDataRepo;
      return Number(aForPanelDataRepo.id || 0) - Number(bForPanelDataRepo.id || 0);
    });
    return messagesForPanelDataRepo;
  }

  async function listMessagesByChatIdForPanelDataRepo(chatIdForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericChatIdForPanelDataRepo = Number(chatIdForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    var messagesForPanelDataRepo = await dbForPanelDataRepo.messages
      .where('chatId')
      .equals(numericChatIdForPanelDataRepo)
      .toArray();
    return sortMessagesForPanelDataRepo(messagesForPanelDataRepo);
  }

  async function listChatsForPanelDataRepo() {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var chatsForPanelDataRepo = await dbForPanelDataRepo.chats.toArray();
    chatsForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      return new Date(bForPanelDataRepo.updatedAt || 0) - new Date(aForPanelDataRepo.updatedAt || 0);
    });
    for (var iForPanelDataRepo = 0; iForPanelDataRepo < chatsForPanelDataRepo.length; iForPanelDataRepo++) {
      var chatForPanelDataRepo = chatsForPanelDataRepo[iForPanelDataRepo];
      chatForPanelDataRepo.messages = await listMessagesByChatIdForPanelDataRepo(chatForPanelDataRepo.id);
    }
    return chatsForPanelDataRepo;
  }

  // Returns all chats sorted by updatedAt descending, without fetching their messages
  // from the messages table. Used at startup so the panel loads metadata only and
  // defers message fetching to the first time each chat is opened.
  // SCALABILITY: do not replace calls to this with listChats() at startup; listChats()
  // joins the messages table and would load all message data into memory at once.
  async function listChatsMetaForPanelDataRepo() {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var chatsForPanelDataRepo = await dbForPanelDataRepo.chats.toArray();
    chatsForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      return new Date(bForPanelDataRepo.updatedAt || 0) - new Date(aForPanelDataRepo.updatedAt || 0);
    });
    return chatsForPanelDataRepo;
  }

  async function getChatForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericChatIdForPanelDataRepo = Number(idForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    var chatForPanelDataRepo = await dbForPanelDataRepo.chats.get(numericChatIdForPanelDataRepo);
    if (!chatForPanelDataRepo) {
      throw new Error('Item not found: chat ' + numericChatIdForPanelDataRepo);
    }
    chatForPanelDataRepo.messages = await listMessagesByChatIdForPanelDataRepo(numericChatIdForPanelDataRepo);
    return chatForPanelDataRepo;
  }

  // Per-id chat metadata fetcher, no messages join. Used by the cross-tab
  // incremental-ops apply path on receiver tabs that aren't viewing the chat
  // being updated — they only need the row to update the sidebar entry, not
  // the message stream. Saves a wasted listMessagesByChatId round-trip per
  // cross-tab chat-row mutation when the receiver has a different active chat.
  async function getChatMetaForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericChatIdForPanelDataRepo = Number(idForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    var chatForPanelDataRepo = await dbForPanelDataRepo.chats.get(numericChatIdForPanelDataRepo);
    if (!chatForPanelDataRepo) {
      throw new Error('Item not found: chat ' + numericChatIdForPanelDataRepo);
    }
    return chatForPanelDataRepo;
  }

  function normalizeCompactedThroughMessageIdForPanelDataRepo(rawIdForPanelDataRepo) {
    if (rawIdForPanelDataRepo == null) return null;
    var numericIdForPanelDataRepo = Number(rawIdForPanelDataRepo);
    if (Number.isFinite(numericIdForPanelDataRepo)) return numericIdForPanelDataRepo;
    var stringIdForPanelDataRepo = String(rawIdForPanelDataRepo).trim();
    return stringIdForPanelDataRepo ? stringIdForPanelDataRepo : null;
  }

  async function createChatForPanelDataRepo(chatInputForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var inputForPanelDataRepo = chatInputForPanelDataRepo || {};
    var nowForPanelDataRepo = getIsoNowForPanelDataRepo();
    var recordForPanelDataRepo = {
      title: String(inputForPanelDataRepo.title || ''),
      summary: String(inputForPanelDataRepo.summary || ''),
      type: normalizeChatTypeForPanelDataRepo(inputForPanelDataRepo.type),
      isPinned: Boolean(inputForPanelDataRepo.isPinned),
      hasAttachments: Boolean(inputForPanelDataRepo.hasAttachments),
      hasCustomTitle: Boolean(inputForPanelDataRepo.hasCustomTitle),
      lastModel: inputForPanelDataRepo.lastModel ? String(inputForPanelDataRepo.lastModel) : '',
      compactionSummary: String(inputForPanelDataRepo.compactionSummary || ''),
      compactedThroughMessageId: normalizeCompactedThroughMessageIdForPanelDataRepo(inputForPanelDataRepo.compactedThroughMessageId),
      compactionUpdatedAt: inputForPanelDataRepo.compactionUpdatedAt
        ? normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.compactionUpdatedAt, nowForPanelDataRepo)
        : '',
      createdAt: normalizeChatTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, nowForPanelDataRepo),
      updatedAt: normalizeChatTimestampForPanelDataRepo(inputForPanelDataRepo.updatedAt, nowForPanelDataRepo)
    };
    var chatIdForPanelDataRepo = await dbForPanelDataRepo.chats.add(recordForPanelDataRepo);
    return getChatForPanelDataRepo(chatIdForPanelDataRepo);
  }

  async function updateChatForPanelDataRepo(idForPanelDataRepo, patchForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericChatIdForPanelDataRepo = Number(idForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    var existingForPanelDataRepo = await dbForPanelDataRepo.chats.get(numericChatIdForPanelDataRepo);
    if (!existingForPanelDataRepo) {
      throw new Error('Item not found: chat ' + numericChatIdForPanelDataRepo);
    }
    var patchForUpdate = patchForPanelDataRepo || {};
    var updateForPanelDataRepo = {
      updatedAt: normalizeChatTimestampForPanelDataRepo(patchForUpdate.updatedAt, getIsoNowForPanelDataRepo())
    };
    if (patchForUpdate.title != null) {
      updateForPanelDataRepo.title = String(patchForUpdate.title);
    }
    if (patchForUpdate.summary != null) {
      updateForPanelDataRepo.summary = String(patchForUpdate.summary);
    }
    if (patchForUpdate.type != null) {
      updateForPanelDataRepo.type = normalizeChatTypeForPanelDataRepo(patchForUpdate.type);
    }
    if (patchForUpdate.isPinned != null) {
      updateForPanelDataRepo.isPinned = Boolean(patchForUpdate.isPinned);
    }
    if (patchForUpdate.hasAttachments != null) {
      updateForPanelDataRepo.hasAttachments = Boolean(patchForUpdate.hasAttachments);
    }
    if (patchForUpdate.hasCustomTitle != null) {
      updateForPanelDataRepo.hasCustomTitle = Boolean(patchForUpdate.hasCustomTitle);
    }
    if (patchForUpdate.lastModel != null) {
      updateForPanelDataRepo.lastModel = String(patchForUpdate.lastModel);
    }
    if (patchForUpdate.compactionSummary != null) {
      updateForPanelDataRepo.compactionSummary = String(patchForUpdate.compactionSummary);
    }
    if (Object.prototype.hasOwnProperty.call(patchForUpdate, 'compactedThroughMessageId')) {
      updateForPanelDataRepo.compactedThroughMessageId = normalizeCompactedThroughMessageIdForPanelDataRepo(patchForUpdate.compactedThroughMessageId);
    }
    if (patchForUpdate.compactionUpdatedAt != null) {
      updateForPanelDataRepo.compactionUpdatedAt = normalizeTimestampForPanelDataRepo(patchForUpdate.compactionUpdatedAt, getIsoNowForPanelDataRepo());
    }
    if (existingForPanelDataRepo.createdAt == null || existingForPanelDataRepo.createdAt === '') {
      updateForPanelDataRepo.createdAt = normalizeChatTimestampForPanelDataRepo(existingForPanelDataRepo.createdAt, getIsoNowForPanelDataRepo());
    }
    await dbForPanelDataRepo.chats.update(numericChatIdForPanelDataRepo, updateForPanelDataRepo);
    return getChatForPanelDataRepo(numericChatIdForPanelDataRepo);
  }

  async function deleteChatForPanelDataRepo(idForPanelDataRepo, protectedBlobIdsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericChatIdForPanelDataRepo = Number(idForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    await dbForPanelDataRepo.transaction('rw', dbForPanelDataRepo.chats, dbForPanelDataRepo.messages, async function () {
      await dbForPanelDataRepo.messages.where('chatId').equals(numericChatIdForPanelDataRepo).delete();
      await dbForPanelDataRepo.chats.delete(numericChatIdForPanelDataRepo);
    });
    pruneOrphanedBlobsForPanelDataRepo(protectedBlobIdsForPanelDataRepo).catch(function () {});
    return true;
  }

  async function pruneOrphanedBlobsForPanelDataRepo(protectedBlobIdsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var referencedBlobIdsForPrune = new Set();
    var imageBlobRefRegexForPrune = /__blob:(\d+)__/g;
    var docBlobRefRegexForPrune = /#abchat-docblob-(\d+)/g;

    var allMessagesForPrune = await dbForPanelDataRepo.messages.toArray();
    for (var msgIndexForPrune = 0; msgIndexForPrune < allMessagesForPrune.length; msgIndexForPrune++) {
      var msgForPrune = allMessagesForPrune[msgIndexForPrune];
      if (msgForPrune && msgForPrune.md) {
        var matchForPrune;
        imageBlobRefRegexForPrune.lastIndex = 0;
        while ((matchForPrune = imageBlobRefRegexForPrune.exec(msgForPrune.md)) !== null) {
          referencedBlobIdsForPrune.add(Number(matchForPrune[1]));
        }
        docBlobRefRegexForPrune.lastIndex = 0;
        while ((matchForPrune = docBlobRefRegexForPrune.exec(msgForPrune.md)) !== null) {
          referencedBlobIdsForPrune.add(Number(matchForPrune[1]));
        }
      }
      if (msgForPrune && Array.isArray(msgForPrune.chips)) {
        for (var chipIndexForPrune = 0; chipIndexForPrune < msgForPrune.chips.length; chipIndexForPrune++) {
          var chipForPrune = msgForPrune.chips[chipIndexForPrune];
          if (chipForPrune && Number.isFinite(chipForPrune.refId)) {
            referencedBlobIdsForPrune.add(chipForPrune.refId);
          }
        }
      }
    }

    var allNotesForPrune = await dbForPanelDataRepo.notes.toArray();
    for (var noteIndexForPrune = 0; noteIndexForPrune < allNotesForPrune.length; noteIndexForPrune++) {
      var noteForPrune = allNotesForPrune[noteIndexForPrune];
      if (noteForPrune && Array.isArray(noteForPrune.attachments)) {
        for (var noteAttachIndexForPrune = 0; noteAttachIndexForPrune < noteForPrune.attachments.length; noteAttachIndexForPrune++) {
          var noteAttachForPrune = noteForPrune.attachments[noteAttachIndexForPrune];
          if (noteAttachForPrune && Number.isFinite(noteAttachForPrune.refId)) {
            referencedBlobIdsForPrune.add(noteAttachForPrune.refId);
          }
        }
      }
    }

    var allNoteVersionsForPrune = await dbForPanelDataRepo.noteVersions.toArray();
    for (var nvIndexForPrune = 0; nvIndexForPrune < allNoteVersionsForPrune.length; nvIndexForPrune++) {
      var nvForPrune = allNoteVersionsForPrune[nvIndexForPrune];
      if (nvForPrune && Array.isArray(nvForPrune.attachments)) {
        for (var nvAttachIndexForPrune = 0; nvAttachIndexForPrune < nvForPrune.attachments.length; nvAttachIndexForPrune++) {
          var nvAttachForPrune = nvForPrune.attachments[nvAttachIndexForPrune];
          if (nvAttachForPrune && Number.isFinite(nvAttachForPrune.refId)) {
            referencedBlobIdsForPrune.add(nvAttachForPrune.refId);
          }
        }
      }
    }

    var protectedSetForPrune = new Set(
      Array.isArray(protectedBlobIdsForPanelDataRepo)
        ? protectedBlobIdsForPanelDataRepo.map(Number).filter(function (n) { return Number.isFinite(n) && n > 0; })
        : []
    );

    var allBlobIdsForPrune = await dbForPanelDataRepo.attachmentBlobs.toCollection().primaryKeys();
    var orphanIdsForPrune = allBlobIdsForPrune.filter(function (blobIdForPrune) {
      return !referencedBlobIdsForPrune.has(blobIdForPrune) && !protectedSetForPrune.has(blobIdForPrune);
    });

    if (orphanIdsForPrune.length > 0) {
      await dbForPanelDataRepo.attachmentBlobs.bulkDelete(orphanIdsForPrune);
    }

    return { deleted: orphanIdsForPrune.length };
  }

  async function deleteChatsOlderThanForPanelDataRepo(daysForPanelDataRepo, protectedBlobIdsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numDaysForPanelDataRepo = Number(daysForPanelDataRepo);
    if (!Number.isFinite(numDaysForPanelDataRepo) || numDaysForPanelDataRepo <= 0) {
      throw new Error('Invalid days value');
    }

    var cutoffForPanelDataRepo = new Date(Date.now() - numDaysForPanelDataRepo * 86400000).toISOString();
    var oldChatsForPanelDataRepo = await dbForPanelDataRepo.chats
      .where('createdAt')
      .below(cutoffForPanelDataRepo)
      .filter(function (chatForPanelDataRepo) { return !chatForPanelDataRepo.isPinned; })
      .toArray();

    var oldChatIdsForPanelDataRepo = oldChatsForPanelDataRepo.map(function (c) { return c.id; });

    if (oldChatIdsForPanelDataRepo.length > 0) {
      await dbForPanelDataRepo.transaction('rw', dbForPanelDataRepo.chats, dbForPanelDataRepo.messages, async function () {
        for (var i = 0; i < oldChatIdsForPanelDataRepo.length; i++) {
          await dbForPanelDataRepo.messages.where('chatId').equals(oldChatIdsForPanelDataRepo[i]).delete();
        }
        await dbForPanelDataRepo.chats.bulkDelete(oldChatIdsForPanelDataRepo);
      });
    }

    var pruneResultForPanelDataRepo = await pruneOrphanedBlobsForPanelDataRepo(protectedBlobIdsForPanelDataRepo);
    return { deleted: oldChatIdsForPanelDataRepo.length, blobsDeleted: pruneResultForPanelDataRepo.deleted };
  }

  async function createMessageForPanelDataRepo(chatIdForPanelDataRepo, messageInputForPanelDataRepo, optionsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var optsForPanelDataRepo = optionsForPanelDataRepo || {};
    var numericChatIdForPanelDataRepo = Number(chatIdForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo)) {
      throw new Error('Invalid chat id');
    }
    var existingChatForPanelDataRepo = await dbForPanelDataRepo.chats.get(numericChatIdForPanelDataRepo);
    if (!existingChatForPanelDataRepo) {
      throw new Error('Item not found: chat ' + numericChatIdForPanelDataRepo);
    }
    var nowForPanelDataRepo = getIsoNowForPanelDataRepo();
    var messageRecordForPanelDataRepo = normalizeMessageRecordForPanelDataRepo(
      numericChatIdForPanelDataRepo,
      messageInputForPanelDataRepo,
      nowForPanelDataRepo
    );
    var messageIdForPanelDataRepo = await dbForPanelDataRepo.messages.add(messageRecordForPanelDataRepo);
    var chatPatchForPanelDataRepo = {};
    if (optsForPanelDataRepo.touchChat !== false) {
      chatPatchForPanelDataRepo.updatedAt = normalizeChatTimestampForPanelDataRepo(optsForPanelDataRepo.chatUpdatedAt, nowForPanelDataRepo);
    }
    if (!existingChatForPanelDataRepo.hasAttachments && messageHasAttachmentForPanelDataRepo(messageRecordForPanelDataRepo)) {
      chatPatchForPanelDataRepo.hasAttachments = true;
    }
    if (Object.keys(chatPatchForPanelDataRepo).length > 0) {
      await dbForPanelDataRepo.chats.update(numericChatIdForPanelDataRepo, chatPatchForPanelDataRepo);
    }
    return dbForPanelDataRepo.messages.get(messageIdForPanelDataRepo);
  }

  async function createAttachmentBlobForPanelDataRepo(blobInputForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var recordForPanelDataRepo = normalizeAttachmentBlobRecordForPanelDataRepo(blobInputForPanelDataRepo);
    var blobIdForPanelDataRepo = await dbForPanelDataRepo.attachmentBlobs.add(recordForPanelDataRepo);
    return dbForPanelDataRepo.attachmentBlobs.get(blobIdForPanelDataRepo);
  }

  async function getAttachmentBlobForPanelDataRepo(blobIdForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericBlobIdForPanelDataRepo = Number(blobIdForPanelDataRepo);
    if (!Number.isFinite(numericBlobIdForPanelDataRepo)) {
      throw new Error('Invalid attachment blob id');
    }
    return dbForPanelDataRepo.attachmentBlobs.get(numericBlobIdForPanelDataRepo);
  }

  async function deleteAttachmentBlobForPanelDataRepo(blobIdForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericBlobIdForPanelDataRepo = Number(blobIdForPanelDataRepo);
    if (!Number.isFinite(numericBlobIdForPanelDataRepo)) {
      throw new Error('Invalid attachment blob id');
    }
    await dbForPanelDataRepo.attachmentBlobs.delete(numericBlobIdForPanelDataRepo);
    return true;
  }

  async function bulkReplaceMessagesFromIndexForPanelDataRepo(chatIdForPanelDataRepo, fromMessageIdForPanelDataRepo, replacementMessagesForPanelDataRepo, optionsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var optsForPanelDataRepo = optionsForPanelDataRepo || {};
    var numericChatIdForPanelDataRepo = Number(chatIdForPanelDataRepo);
    var numericFromMessageIdForPanelDataRepo = Number(fromMessageIdForPanelDataRepo);
    if (!Number.isFinite(numericChatIdForPanelDataRepo) || !Number.isFinite(numericFromMessageIdForPanelDataRepo)) {
      throw new Error('Invalid chat or message id');
    }
    if (!Array.isArray(replacementMessagesForPanelDataRepo)) {
      throw new Error('replacementMessages must be an array');
    }
    await dbForPanelDataRepo.transaction('rw', dbForPanelDataRepo.chats, dbForPanelDataRepo.messages, async function () {
      var existingChatForPanelDataRepo = await dbForPanelDataRepo.chats.get(numericChatIdForPanelDataRepo);
      if (!existingChatForPanelDataRepo) {
        throw new Error('Item not found: chat ' + numericChatIdForPanelDataRepo);
      }
      var allMessagesForPanelDataRepo = await listMessagesByChatIdForPanelDataRepo(numericChatIdForPanelDataRepo);
      var startIndexForPanelDataRepo = -1;
      for (var iForPanelDataRepo = 0; iForPanelDataRepo < allMessagesForPanelDataRepo.length; iForPanelDataRepo++) {
        if (Number(allMessagesForPanelDataRepo[iForPanelDataRepo].id) === numericFromMessageIdForPanelDataRepo) {
          startIndexForPanelDataRepo = iForPanelDataRepo;
          break;
        }
      }
      if (startIndexForPanelDataRepo < 0) {
        throw new Error('Message not found in chat: ' + numericFromMessageIdForPanelDataRepo);
      }
      var messageIdsToDeleteForPanelDataRepo = allMessagesForPanelDataRepo
        .slice(startIndexForPanelDataRepo)
        .map(function (messageForPanelDataRepo) { return Number(messageForPanelDataRepo.id); })
        .filter(function (messageIdForPanelDataRepo) { return Number.isFinite(messageIdForPanelDataRepo); });
      if (messageIdsToDeleteForPanelDataRepo.length > 0) {
        await dbForPanelDataRepo.messages.bulkDelete(messageIdsToDeleteForPanelDataRepo);
      }
      // Replacing from an index can both add and remove attachment-bearing messages,
      // so recompute the flag over the kept prefix plus the replacements.
      var hasAttachmentsAfterReplaceForPanelDataRepo = allMessagesForPanelDataRepo
        .slice(0, startIndexForPanelDataRepo)
        .some(messageHasAttachmentForPanelDataRepo);
      for (var insertIndexForPanelDataRepo = 0; insertIndexForPanelDataRepo < replacementMessagesForPanelDataRepo.length; insertIndexForPanelDataRepo++) {
        var replacementForPanelDataRepo = replacementMessagesForPanelDataRepo[insertIndexForPanelDataRepo] || {};
        var replacementCreatedAtForPanelDataRepo = replacementForPanelDataRepo.createdAt;
        var normalizedReplacementForPanelDataRepo = normalizeMessageRecordForPanelDataRepo(
          numericChatIdForPanelDataRepo,
          replacementForPanelDataRepo,
          replacementCreatedAtForPanelDataRepo || getIsoNowForPanelDataRepo()
        );
        if (!hasAttachmentsAfterReplaceForPanelDataRepo && messageHasAttachmentForPanelDataRepo(normalizedReplacementForPanelDataRepo)) {
          hasAttachmentsAfterReplaceForPanelDataRepo = true;
        }
        await dbForPanelDataRepo.messages.add(normalizedReplacementForPanelDataRepo);
      }
      await dbForPanelDataRepo.chats.update(numericChatIdForPanelDataRepo, {
        updatedAt: normalizeChatTimestampForPanelDataRepo(optsForPanelDataRepo.chatUpdatedAt, getIsoNowForPanelDataRepo()),
        hasAttachments: hasAttachmentsAfterReplaceForPanelDataRepo
      });
    });
    return listMessagesByChatIdForPanelDataRepo(numericChatIdForPanelDataRepo);
  }

  var MAX_NOTE_VERSIONS_FOR_PANEL_DATA_REPO = 20;

  async function trimNoteVersionsForPanelDataRepo(dbForTrim, noteIdForTrim) {
    var versionsForTrim = await dbForTrim.noteVersions.where('noteId').equals(noteIdForTrim).sortBy('id');
    var excessCountForTrim = versionsForTrim.length - MAX_NOTE_VERSIONS_FOR_PANEL_DATA_REPO;
    if (excessCountForTrim > 0) {
      var idsToDeleteForTrim = versionsForTrim.slice(0, excessCountForTrim).map(function (vForTrim) { return vForTrim.id; });
      await dbForTrim.noteVersions.bulkDelete(idsToDeleteForTrim);
    }
  }

  async function listNotesForPanelDataRepo(noteTypeForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var notesForPanelDataRepo = await dbForPanelDataRepo.notes.toArray();
    if (noteTypeForPanelDataRepo) {
      notesForPanelDataRepo = notesForPanelDataRepo.filter(function (noteForPanelDataRepo) {
        return noteForPanelDataRepo.noteType === noteTypeForPanelDataRepo;
      });
    }
    notesForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      return new Date(bForPanelDataRepo.updatedAt || 0) - new Date(aForPanelDataRepo.updatedAt || 0);
    });
    return notesForPanelDataRepo;
  }

  async function createNoteForPanelDataRepo(noteInputForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var inputForPanelDataRepo = noteInputForPanelDataRepo || {};
    var nowForPanelDataRepo = getIsoNowForPanelDataRepo();
    var recordForPanelDataRepo = {
      title: String(inputForPanelDataRepo.title || ''),
      body: String(inputForPanelDataRepo.body || ''),
      tags: normalizeTagsForPanelDataRepo(inputForPanelDataRepo.tags),
      attachments: normalizeAttachmentsForPanelDataRepo(inputForPanelDataRepo.attachments),
      noteType: inputForPanelDataRepo.noteType === 'agent' ? 'agent' : 'user',
      sourceChatId: inputForPanelDataRepo.sourceChatId != null ? inputForPanelDataRepo.sourceChatId : null,
      starred: inputForPanelDataRepo.starred === true,
      createdAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, nowForPanelDataRepo),
      updatedAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.updatedAt, nowForPanelDataRepo)
    };
    var noteIdForPanelDataRepo = await dbForPanelDataRepo.notes.add(recordForPanelDataRepo);
    await dbForPanelDataRepo.noteVersions.add({
      noteId: noteIdForPanelDataRepo,
      title: recordForPanelDataRepo.title,
      body: recordForPanelDataRepo.body,
      attachments: recordForPanelDataRepo.attachments,
      savedAt: recordForPanelDataRepo.updatedAt
    });
    await trimNoteVersionsForPanelDataRepo(dbForPanelDataRepo, noteIdForPanelDataRepo);
    return dbForPanelDataRepo.notes.get(noteIdForPanelDataRepo);
  }

  async function updateNoteForPanelDataRepo(idForPanelDataRepo, patchForPanelDataRepo, optionsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var existingForPanelDataRepo = await dbForPanelDataRepo.notes.get(idForPanelDataRepo);
    if (!existingForPanelDataRepo) {
      throw new Error('Item not found: note ' + idForPanelDataRepo);
    }

    var patchForUpdate = patchForPanelDataRepo || {};
    var optsForPanelDataRepo = optionsForPanelDataRepo || {};
    if (optsForPanelDataRepo.baseUpdatedAt != null) {
      var baseUpdatedAtForPanelDataRepo = String(optsForPanelDataRepo.baseUpdatedAt || '');
      var existingUpdatedAtForPanelDataRepo = String(existingForPanelDataRepo.updatedAt || '');
      if (baseUpdatedAtForPanelDataRepo && existingUpdatedAtForPanelDataRepo && baseUpdatedAtForPanelDataRepo !== existingUpdatedAtForPanelDataRepo) {
        throw new Error('NOTE_CONFLICT: Note changed in another tab. Reload latest before saving.');
      }
    }
    var mergedForPanelDataRepo = {
      title: patchForUpdate.title != null ? String(patchForUpdate.title) : String(existingForPanelDataRepo.title || ''),
      body: patchForUpdate.body != null ? String(patchForUpdate.body) : String(existingForPanelDataRepo.body || ''),
      tags: patchForUpdate.tags != null
        ? normalizeTagsForPanelDataRepo(patchForUpdate.tags)
        : normalizeTagsForPanelDataRepo(existingForPanelDataRepo.tags),
      attachments: patchForUpdate.attachments != null
        ? normalizeAttachmentsForPanelDataRepo(patchForUpdate.attachments)
        : normalizeAttachmentsForPanelDataRepo(existingForPanelDataRepo.attachments),
      noteType: patchForUpdate.noteType != null
        ? (patchForUpdate.noteType === 'agent' ? 'agent' : 'user')
        : (existingForPanelDataRepo.noteType === 'agent' ? 'agent' : 'user'),
      sourceChatId: patchForUpdate.sourceChatId !== undefined
        ? (patchForUpdate.sourceChatId != null ? patchForUpdate.sourceChatId : null)
        : (existingForPanelDataRepo.sourceChatId != null ? existingForPanelDataRepo.sourceChatId : null),
      starred: patchForUpdate.starred !== undefined ? patchForUpdate.starred === true : (existingForPanelDataRepo.starred === true),
      createdAt: normalizeTimestampForPanelDataRepo(existingForPanelDataRepo.createdAt, getIsoNowForPanelDataRepo()),
      updatedAt: normalizeTimestampForPanelDataRepo(patchForUpdate.updatedAt, getIsoNowForPanelDataRepo())
    };

    await dbForPanelDataRepo.notes.update(idForPanelDataRepo, mergedForPanelDataRepo);

    if (optsForPanelDataRepo.saveVersion !== false) {
      await dbForPanelDataRepo.noteVersions.add({
        noteId: idForPanelDataRepo,
        title: mergedForPanelDataRepo.title,
        body: mergedForPanelDataRepo.body,
        attachments: mergedForPanelDataRepo.attachments,
        savedAt: mergedForPanelDataRepo.updatedAt
      });
      await trimNoteVersionsForPanelDataRepo(dbForPanelDataRepo, idForPanelDataRepo);
    }

    return dbForPanelDataRepo.notes.get(idForPanelDataRepo);
  }

  async function deleteNoteForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    await dbForPanelDataRepo.transaction('rw', dbForPanelDataRepo.notes, dbForPanelDataRepo.noteVersions, async function () {
      await dbForPanelDataRepo.noteVersions.where('noteId').equals(idForPanelDataRepo).delete();
      await dbForPanelDataRepo.notes.delete(idForPanelDataRepo);
    });
    pruneOrphanedBlobsForPanelDataRepo().catch(function () {});
    return true;
  }

  async function listNoteVersionsForPanelDataRepo(noteIdForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericNoteIdForPanelDataRepo = Number(noteIdForPanelDataRepo);
    if (!Number.isFinite(numericNoteIdForPanelDataRepo)) return [];
    var versionsForPanelDataRepo = await dbForPanelDataRepo.noteVersions
      .where('noteId').equals(numericNoteIdForPanelDataRepo).sortBy('id');
    // Newest first (id is a monotonic autoincrement, so it mirrors save order).
    versionsForPanelDataRepo.reverse();
    return versionsForPanelDataRepo;
  }

  async function listTasksForPanelDataRepo() {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var tasksForPanelDataRepo = await dbForPanelDataRepo.tasks.toArray();
    tasksForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      return new Date(bForPanelDataRepo.updatedAt || 0) - new Date(aForPanelDataRepo.updatedAt || 0);
    });
    return tasksForPanelDataRepo;
  }

  async function createTaskForPanelDataRepo(taskInputForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var inputForPanelDataRepo = taskInputForPanelDataRepo || {};
    var nowForPanelDataRepo = getIsoNowForPanelDataRepo();
    var recordForPanelDataRepo = {
      title: String(inputForPanelDataRepo.title || ''),
      body: String(inputForPanelDataRepo.body || ''),
      dueAt: normalizeTaskDateTimeForPanelDataRepo(inputForPanelDataRepo.dueAt, getTomorrowIsoForPanelDataRepo()),
      reminderAt: normalizeTaskDateTimeForPanelDataRepo(inputForPanelDataRepo.reminderAt, getTomorrowMinusHourIsoForPanelDataRepo()),
      isCompleted: Boolean(inputForPanelDataRepo.isCompleted),
      createdAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, nowForPanelDataRepo),
      updatedAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.updatedAt, nowForPanelDataRepo)
    };
    var taskIdForPanelDataRepo = await dbForPanelDataRepo.tasks.add(recordForPanelDataRepo);
    return dbForPanelDataRepo.tasks.get(taskIdForPanelDataRepo);
  }

  async function updateTaskForPanelDataRepo(idForPanelDataRepo, patchForPanelDataRepo, optionsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var existingForPanelDataRepo = await dbForPanelDataRepo.tasks.get(idForPanelDataRepo);
    if (!existingForPanelDataRepo) {
      throw new Error('Item not found: task ' + idForPanelDataRepo);
    }

    var optsForPanelDataRepo = optionsForPanelDataRepo || {};
    if (optsForPanelDataRepo.baseUpdatedAt != null) {
      var baseUpdatedAtForPanelDataRepo = String(optsForPanelDataRepo.baseUpdatedAt || '');
      var existingUpdatedAtForPanelDataRepo = String(existingForPanelDataRepo.updatedAt || '');
      if (baseUpdatedAtForPanelDataRepo && existingUpdatedAtForPanelDataRepo && baseUpdatedAtForPanelDataRepo !== existingUpdatedAtForPanelDataRepo) {
        throw new Error('TASK_CONFLICT: Task changed in another tab. Reload latest before saving.');
      }
    }

    var patchForUpdate = patchForPanelDataRepo || {};
    var mergedForPanelDataRepo = {
      title: patchForUpdate.title != null ? String(patchForUpdate.title) : String(existingForPanelDataRepo.title || ''),
      body: patchForUpdate.body != null ? String(patchForUpdate.body) : String(existingForPanelDataRepo.body || ''),
      dueAt: normalizeTaskDateTimeForPanelDataRepo(
        patchForUpdate.dueAt != null ? patchForUpdate.dueAt : existingForPanelDataRepo.dueAt,
        getTomorrowIsoForPanelDataRepo()
      ),
      reminderAt: normalizeTaskDateTimeForPanelDataRepo(
        patchForUpdate.reminderAt != null ? patchForUpdate.reminderAt : existingForPanelDataRepo.reminderAt,
        getTomorrowMinusHourIsoForPanelDataRepo()
      ),
      isCompleted: patchForUpdate.isCompleted != null ? Boolean(patchForUpdate.isCompleted) : Boolean(existingForPanelDataRepo.isCompleted),
      createdAt: normalizeTimestampForPanelDataRepo(existingForPanelDataRepo.createdAt, getIsoNowForPanelDataRepo()),
      updatedAt: normalizeTimestampForPanelDataRepo(patchForUpdate.updatedAt, getIsoNowForPanelDataRepo())
    };

    await dbForPanelDataRepo.tasks.update(idForPanelDataRepo, mergedForPanelDataRepo);
    return dbForPanelDataRepo.tasks.get(idForPanelDataRepo);
  }

  async function toggleTaskCompletedForPanelDataRepo(idForPanelDataRepo, nextCompletedForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var existingForPanelDataRepo = await dbForPanelDataRepo.tasks.get(idForPanelDataRepo);
    if (!existingForPanelDataRepo) {
      throw new Error('Item not found: task ' + idForPanelDataRepo);
    }
    var resolvedCompletedForPanelDataRepo = typeof nextCompletedForPanelDataRepo === 'boolean'
      ? nextCompletedForPanelDataRepo
      : !Boolean(existingForPanelDataRepo.isCompleted);
    await dbForPanelDataRepo.tasks.update(idForPanelDataRepo, {
      isCompleted: resolvedCompletedForPanelDataRepo,
      updatedAt: getIsoNowForPanelDataRepo()
    });
    return dbForPanelDataRepo.tasks.get(idForPanelDataRepo);
  }

  async function deleteTaskForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    await dbForPanelDataRepo.tasks.delete(idForPanelDataRepo);
    return true;
  }

  async function listQuestionsForPanelDataRepo() {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var questionsForPanelDataRepo = await dbForPanelDataRepo.questions.toArray();
    questionsForPanelDataRepo.sort(function (aForPanelDataRepo, bForPanelDataRepo) {
      return new Date(bForPanelDataRepo.updatedAt || 0) - new Date(aForPanelDataRepo.updatedAt || 0);
    });
    return questionsForPanelDataRepo;
  }

  async function createQuestionForPanelDataRepo(questionInputForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var inputForPanelDataRepo = questionInputForPanelDataRepo || {};
    var nowForPanelDataRepo = getIsoNowForPanelDataRepo();
    var recordForPanelDataRepo = {
      title: String(inputForPanelDataRepo.title || ''),
      questionText: String(inputForPanelDataRepo.questionText || ''),
      type: inputForPanelDataRepo.type === 'fitb' ? 'fitb' : 'mcq',
      options: normalizeMcqOptionsForPanelDataRepo(inputForPanelDataRepo.options),
      correctAnswer: String(inputForPanelDataRepo.correctAnswer || ''),
      alternativeAnswers: normalizeAlternativeAnswersForPanelDataRepo(inputForPanelDataRepo.alternativeAnswers),
      caseSensitive: Boolean(inputForPanelDataRepo.caseSensitive),
      explanation: String(inputForPanelDataRepo.explanation || ''),
      sourceChatId: inputForPanelDataRepo.sourceChatId != null ? inputForPanelDataRepo.sourceChatId : null,
      intervalStage: Number.isFinite(inputForPanelDataRepo.intervalStage) ? Number(inputForPanelDataRepo.intervalStage) : 0,
      dueAt: normalizeDateOnlyForPanelDataRepo(inputForPanelDataRepo.dueAt, getQuestionDueDateForPanelDataRepo()),
      isPaused: Boolean(inputForPanelDataRepo.isPaused),
      pausedUntil: inputForPanelDataRepo.pausedUntil != null
        ? normalizeDateOnlyForPanelDataRepo(inputForPanelDataRepo.pausedUntil, getQuestionDueDateForPanelDataRepo())
        : null,
      createdAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.createdAt, nowForPanelDataRepo),
      updatedAt: normalizeTimestampForPanelDataRepo(inputForPanelDataRepo.updatedAt, nowForPanelDataRepo)
    };
    var questionIdForPanelDataRepo = await dbForPanelDataRepo.questions.add(recordForPanelDataRepo);
    return dbForPanelDataRepo.questions.get(questionIdForPanelDataRepo);
  }

  async function updateQuestionForPanelDataRepo(idForPanelDataRepo, patchForPanelDataRepo, optionsForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var existingForPanelDataRepo = await dbForPanelDataRepo.questions.get(idForPanelDataRepo);
    if (!existingForPanelDataRepo) {
      throw new Error('Item not found: question ' + idForPanelDataRepo);
    }

    var optsForPanelDataRepo = optionsForPanelDataRepo || {};
    if (optsForPanelDataRepo.baseUpdatedAt != null) {
      var baseUpdatedAtForPanelDataRepo = String(optsForPanelDataRepo.baseUpdatedAt || '');
      var existingUpdatedAtForPanelDataRepo = String(existingForPanelDataRepo.updatedAt || '');
      if (baseUpdatedAtForPanelDataRepo && existingUpdatedAtForPanelDataRepo && baseUpdatedAtForPanelDataRepo !== existingUpdatedAtForPanelDataRepo) {
        throw new Error('QUESTION_CONFLICT: Question changed in another tab. Reload latest before saving.');
      }
    }

    var patchForUpdate = patchForPanelDataRepo || {};
    var mergedForPanelDataRepo = {
      title: patchForUpdate.title != null ? String(patchForUpdate.title) : String(existingForPanelDataRepo.title || ''),
      questionText: patchForUpdate.questionText != null ? String(patchForUpdate.questionText) : String(existingForPanelDataRepo.questionText || ''),
      type: patchForUpdate.type != null
        ? (patchForUpdate.type === 'fitb' ? 'fitb' : 'mcq')
        : (existingForPanelDataRepo.type === 'fitb' ? 'fitb' : 'mcq'),
      options: patchForUpdate.options != null
        ? normalizeMcqOptionsForPanelDataRepo(patchForUpdate.options)
        : normalizeMcqOptionsForPanelDataRepo(existingForPanelDataRepo.options),
      correctAnswer: patchForUpdate.correctAnswer != null
        ? String(patchForUpdate.correctAnswer)
        : String(existingForPanelDataRepo.correctAnswer || ''),
      alternativeAnswers: patchForUpdate.alternativeAnswers != null
        ? normalizeAlternativeAnswersForPanelDataRepo(patchForUpdate.alternativeAnswers)
        : normalizeAlternativeAnswersForPanelDataRepo(existingForPanelDataRepo.alternativeAnswers),
      caseSensitive: patchForUpdate.caseSensitive != null
        ? Boolean(patchForUpdate.caseSensitive)
        : Boolean(existingForPanelDataRepo.caseSensitive),
      explanation: patchForUpdate.explanation != null
        ? String(patchForUpdate.explanation)
        : String(existingForPanelDataRepo.explanation || ''),
      sourceChatId: patchForUpdate.sourceChatId !== undefined
        ? (patchForUpdate.sourceChatId != null ? patchForUpdate.sourceChatId : null)
        : (existingForPanelDataRepo.sourceChatId != null ? existingForPanelDataRepo.sourceChatId : null),
      intervalStage: patchForUpdate.intervalStage != null
        ? Number(patchForUpdate.intervalStage) || 0
        : (Number(existingForPanelDataRepo.intervalStage) || 0),
      dueAt: normalizeDateOnlyForPanelDataRepo(
        patchForUpdate.dueAt != null ? patchForUpdate.dueAt : existingForPanelDataRepo.dueAt,
        getQuestionDueDateForPanelDataRepo()
      ),
      isPaused: patchForUpdate.isPaused != null ? Boolean(patchForUpdate.isPaused) : Boolean(existingForPanelDataRepo.isPaused),
      pausedUntil: patchForUpdate.pausedUntil !== undefined
        ? (patchForUpdate.pausedUntil != null
          ? normalizeDateOnlyForPanelDataRepo(patchForUpdate.pausedUntil, getQuestionDueDateForPanelDataRepo())
          : null)
        : (existingForPanelDataRepo.pausedUntil != null
          ? normalizeDateOnlyForPanelDataRepo(existingForPanelDataRepo.pausedUntil, getQuestionDueDateForPanelDataRepo())
          : null),
      createdAt: normalizeTimestampForPanelDataRepo(existingForPanelDataRepo.createdAt, getIsoNowForPanelDataRepo()),
      updatedAt: normalizeTimestampForPanelDataRepo(patchForUpdate.updatedAt, getIsoNowForPanelDataRepo())
    };

    await dbForPanelDataRepo.questions.update(idForPanelDataRepo, mergedForPanelDataRepo);
    return dbForPanelDataRepo.questions.get(idForPanelDataRepo);
  }

  async function deleteQuestionForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    await dbForPanelDataRepo.questions.delete(idForPanelDataRepo);
    return true;
  }

  async function getNoteForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    return dbForPanelDataRepo.notes.get(Number(idForPanelDataRepo));
  }

  async function getTaskForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    return dbForPanelDataRepo.tasks.get(Number(idForPanelDataRepo));
  }

  async function getQuestionForPanelDataRepo(idForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    return dbForPanelDataRepo.questions.get(Number(idForPanelDataRepo));
  }

  async function getMessageForPanelDataRepo(messageIdForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericIdForPanelDataRepo = Number(messageIdForPanelDataRepo);
    if (!Number.isFinite(numericIdForPanelDataRepo)) throw new Error('Invalid message id');
    return dbForPanelDataRepo.messages.get(numericIdForPanelDataRepo);
  }

  async function updateMessageForPanelDataRepo(messageIdForPanelDataRepo, updatesForPanelDataRepo) {
    var dbForPanelDataRepo = requireDbForPanelDataRepo();
    var numericIdForPanelDataRepo = Number(messageIdForPanelDataRepo);
    if (!Number.isFinite(numericIdForPanelDataRepo)) throw new Error('Invalid message id');
    var safeUpdatesForPanelDataRepo = {};
    if (updatesForPanelDataRepo.content != null) safeUpdatesForPanelDataRepo.content = String(updatesForPanelDataRepo.content);
    if (updatesForPanelDataRepo.usagePromptTokens != null) safeUpdatesForPanelDataRepo.usagePromptTokens = Number(updatesForPanelDataRepo.usagePromptTokens) || 0;
    if (updatesForPanelDataRepo.usageCompletionTokens != null) safeUpdatesForPanelDataRepo.usageCompletionTokens = Number(updatesForPanelDataRepo.usageCompletionTokens) || 0;
    if (updatesForPanelDataRepo.usageTotalTokens != null) safeUpdatesForPanelDataRepo.usageTotalTokens = Number(updatesForPanelDataRepo.usageTotalTokens) || 0;
    if (updatesForPanelDataRepo.usageReasoningTokens != null) safeUpdatesForPanelDataRepo.usageReasoningTokens = Number(updatesForPanelDataRepo.usageReasoningTokens) || 0;
    if (updatesForPanelDataRepo.usageCost != null) safeUpdatesForPanelDataRepo.usageCost = Number(updatesForPanelDataRepo.usageCost) || 0;
    if (updatesForPanelDataRepo.isHidden != null) safeUpdatesForPanelDataRepo.isHidden = Boolean(updatesForPanelDataRepo.isHidden);
    await dbForPanelDataRepo.messages.update(numericIdForPanelDataRepo, safeUpdatesForPanelDataRepo);
    return dbForPanelDataRepo.messages.get(numericIdForPanelDataRepo);
  }

  nsForPanelDataRepo.panelDataRepo = {
    listChats:                    listChatsForPanelDataRepo,
    listChatsMeta:                listChatsMetaForPanelDataRepo,
    getChat:                      getChatForPanelDataRepo,
    getChatMeta:                  getChatMetaForPanelDataRepo,
    createChat:                   createChatForPanelDataRepo,
    updateChat:                   updateChatForPanelDataRepo,
    deleteChat:                   deleteChatForPanelDataRepo,
    listMessagesByChatId:         listMessagesByChatIdForPanelDataRepo,
    getMessage:                   getMessageForPanelDataRepo,
    createMessage:                createMessageForPanelDataRepo,
    updateMessage:                updateMessageForPanelDataRepo,
    bulkReplaceMessagesFromIndex: bulkReplaceMessagesFromIndexForPanelDataRepo,
    listNotes:                    listNotesForPanelDataRepo,
    createNote:                   createNoteForPanelDataRepo,
    updateNote:                   updateNoteForPanelDataRepo,
    deleteNote:                   deleteNoteForPanelDataRepo,
    listNoteVersions:             listNoteVersionsForPanelDataRepo,
    listTasks:                    listTasksForPanelDataRepo,
    createTask:                   createTaskForPanelDataRepo,
    updateTask:                   updateTaskForPanelDataRepo,
    toggleTaskCompleted:          toggleTaskCompletedForPanelDataRepo,
    deleteTask:                   deleteTaskForPanelDataRepo,
    listQuestions:                listQuestionsForPanelDataRepo,
    createQuestion:               createQuestionForPanelDataRepo,
    updateQuestion:               updateQuestionForPanelDataRepo,
    deleteQuestion:               deleteQuestionForPanelDataRepo,
    createAttachmentBlob:         createAttachmentBlobForPanelDataRepo,
    getAttachmentBlob:            getAttachmentBlobForPanelDataRepo,
    deleteAttachmentBlob:         deleteAttachmentBlobForPanelDataRepo,
    getNote:                      getNoteForPanelDataRepo,
    getTask:                      getTaskForPanelDataRepo,
    getQuestion:                  getQuestionForPanelDataRepo,
    pruneOrphanedBlobs:           pruneOrphanedBlobsForPanelDataRepo,
    deleteChatsOlderThan:         deleteChatsOlderThanForPanelDataRepo
  };

  globalScopeForPanelDataRepo.ABChatShared = nsForPanelDataRepo;
})();
