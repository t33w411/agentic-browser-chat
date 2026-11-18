// Blob pruning when the stored drafts cannot be read. A blob attached to a message not sent yet, or
// to a note edit not saved yet, is referenced only by a draft in chrome.storage.local. The draft
// read used to resolve {} when it failed, which is also what an empty store returns, so the sweep
// and the targeted delete took every such blob for an orphan and deleted it.
//
// Checked against the code before the fix: the failed-read tests fail there, because the sweep
// deleted blobs 2, 3 and 4 and the targeted delete removed blob 2. The first test passes there too,
// as it should: it pins which blobs count as referenced when the read works.

const test = require('node:test');
const assert = require('node:assert');

require('../background/panelDataRepoImpl.js');
const repoForTest = globalThis.ABChatShared.panelDataRepo;

// Blob 1 is on a sent message's chip, blob 2 on a chip in the unsent new-chat draft, blob 3 on an
// unsaved note edit's attachment, and blob 4 is referenced by nothing.
function installStoreForTest(optionsForStore) {
  const blobIdsForStore = new Set([1, 2, 3, 4]);
  globalThis.ABChatShared.db = {
    messages: { toArray: async function () { return [{ id: 10, chatId: 7, md: 'Here it is', chips: [{ refId: 1 }] }]; } },
    notes: { toArray: async function () { return []; } },
    noteVersions: { toArray: async function () { return []; } },
    chats: { bulkGet: async function (ids) { return ids.map(function (id) { return id === 7 ? { id: 7 } : undefined; }); } },
    attachmentBlobs: {
      toCollection: function () { return { primaryKeys: async function () { return Array.from(blobIdsForStore); } }; },
      bulkDelete: async function (ids) { ids.forEach(function (id) { blobIdsForStore.delete(id); }); },
      delete: async function (id) { blobIdsForStore.delete(id); }
    }
  };
  const storedForStore = {
    'abchat_input_draft_sync:new': { text: 'see attached', chips: [{ refId: 2 }] },
    'abchat_input_draft_sync:7': { text: '', chips: [] },
    'abchat_note_draft_sync:9': { body: 'draft', attachments: [{ refId: 3 }] }
  };
  if (optionsForStore.noStorageApi) {
    delete globalThis.chrome;
  } else {
    globalThis.chrome = {
      runtime: { lastError: undefined },
      storage: {
        local: {
          get: function (keysForGet, callbackForGet) {
            if (optionsForStore.readFails) {
              // Chrome sets lastError only for the duration of the callback, and passes no items.
              globalThis.chrome.runtime.lastError = { message: 'IO error: storage is busy' };
              callbackForGet(undefined);
              globalThis.chrome.runtime.lastError = undefined;
              return;
            }
            callbackForGet(JSON.parse(JSON.stringify(storedForStore)));
          },
          remove: function (keysForRemove, callbackForRemove) { if (callbackForRemove) callbackForRemove(); }
        }
      }
    };
  }
  return blobIdsForStore;
}

test('a prune frees only the blobs nothing references, drafts included', async function () {
  const blobIdsForTest = installStoreForTest({});
  const resultForTest = await repoForTest.pruneOrphanedBlobs([]);
  assert.deepStrictEqual(resultForTest, { deleted: 1, draftsReclaimed: 0 });
  assert.deepStrictEqual(Array.from(blobIdsForTest).sort(), [1, 2, 3]);
});

test('a prune whose draft read fails deletes nothing and says why', async function () {
  const blobIdsForTest = installStoreForTest({ readFails: true });
  const resultForTest = await repoForTest.pruneOrphanedBlobs([]);
  assert.strictEqual(resultForTest.deleted, 0);
  assert.strictEqual(resultForTest.skipped, true);
  assert.match(resultForTest.error, /IO error: storage is busy/);
  assert.deepStrictEqual(Array.from(blobIdsForTest).sort(), [1, 2, 3, 4]);
});

test('a prune with no storage API to read deletes nothing', async function () {
  const blobIdsForTest = installStoreForTest({ noStorageApi: true });
  const resultForTest = await repoForTest.pruneOrphanedBlobs([]);
  assert.strictEqual(resultForTest.skipped, true);
  assert.deepStrictEqual(Array.from(blobIdsForTest).sort(), [1, 2, 3, 4]);
});

test('a targeted delete keeps the blob when the draft read fails', async function () {
  let blobIdsForTest = installStoreForTest({ readFails: true });
  assert.deepStrictEqual(await repoForTest.deleteAttachmentBlobIfUnreferenced(2, []), { deleted: false, reason: 'unreadable' });
  assert.ok(blobIdsForTest.has(2));

  blobIdsForTest = installStoreForTest({});
  assert.deepStrictEqual(await repoForTest.deleteAttachmentBlobIfUnreferenced(2, []), { deleted: false, reason: 'referenced' });
  assert.deepStrictEqual(await repoForTest.deleteAttachmentBlobIfUnreferenced(4, []), { deleted: true, reason: '' });
  assert.deepStrictEqual(Array.from(blobIdsForTest).sort(), [1, 2, 3]);
});
