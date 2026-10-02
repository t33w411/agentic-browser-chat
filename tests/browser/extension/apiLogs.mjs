// The API log store and its viewer with the real extension: a version 1 database upgraded in
// place, its old records sized and cut down to the size cap by the upgrade, long strings cut, the
// store kept under its size cap, list rows built from summaries, and a chat record whose later turn
// is stored as only the messages it added, opened in the panel.
//
// The upgrade checks were verified against the version 2 logger, which adds the size index and
// leaves old records as they are. Six checks fail there: the three upgrade checks, the two row
// counts that depend on old records being removed, and the 50 MB check, since the unsized old
// records stay uncounted and the store ends at 124 million characters. The other seven pass.
//
// Verified against a copy of the extension with each part undone: strings stored uncut, no size
// trim, summaries returning whole records, and the viewer not expanding turns. Each fails its own
// checks (the opened chat record then shows "Not sent to model" for its tool result, and the store
// reaches 62.7 million characters), and the upgrade, write and list checks still pass.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

const WIRE_MARKER = 'WIRE RESULT 7d1e';

export async function run({ extPath, urls }) {
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  const inWorker = async (body) => chrome.evaluate(await ext.serviceWorker(), `(async () => { const logger = ABChatContent.apiLogger; ${body} })()`);
  try {
    await wait(2500);

    // An install from before the size cap has a version 1 store with no size index and no sizes on
    // its records. Oldest first, it holds twelve agent runs of about 6 million characters each (no
    // string over the cap, so only the size cap can bound them), a record with a 300,000-character
    // string, and a title. The logger has not opened the database yet, so its first call upgrades
    // this one.
    const planted = await inWorker(`
      await new Promise((resolve, reject) => { const del = indexedDB.deleteDatabase('ABChatApiLogs'); del.onsuccess = resolve; del.onerror = reject; });
      return await new Promise((resolve) => {
        const req = indexedDB.open('ABChatApiLogs', 1);
        req.onupgradeneeded = (e) => { e.target.result.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }); };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('logs', 'readwrite');
          const store = tx.objectStore('logs');
          const turnText = 'o'.repeat(199000);
          for (let i = 0; i < 12; i++) {
            store.add({ requestType: 'chat', timestamp: new Date().toISOString(), model: 'old-big/' + i, status: 'success', requestMessages: Array.from({ length: 30 }, () => ({ role: 'user', content: turnText })) });
          }
          store.add({ requestType: 'compaction', timestamp: new Date().toISOString(), model: 'old-long/model', status: 'success', requestMessages: [{ role: 'user', content: 'y'.repeat(300000) }] });
          store.add({ requestType: 'title', timestamp: new Date().toISOString(), model: 'old/model', status: 'success', responseContent: 'Old title' });
          tx.oncomplete = () => { db.close(); resolve('planted'); };
        };
        req.onerror = (e) => resolve('could not plant: ' + (e.target.error && e.target.error.name));
      });`);
    check('a version 1 store was planted before the logger opened it', planted === 'planted', planted);

    const upgraded = await inWorker(`
      const count = await logger.getLogCount();
      const all = await logger.getLogs(500, 0);
      const long = all.find((r) => r.model === 'old-long/model');
      const content = long && long.requestMessages && long.requestMessages[0].content;
      return { count, models: all.map((r) => r.model).reverse().join(','), sized: all.every((r) => typeof r.bytes === 'number' && r.bytes > 0),
        total: all.reduce((n, r) => n + JSON.stringify(r).length, 0), longLength: content ? content.length : -1, longTail: content ? content.slice(-60) : '' };`);
    const keptOldBig = Array.from({ length: 8 }, (_, i) => 'old-big/' + (i + 4)).join(',');
    check('the upgrade sized every old record', upgraded && upgraded.sized, upgraded && { count: upgraded.count, sized: upgraded.sized });
    check('the upgrade kept the newest old records that fit in 50 MB and removed the older ones', upgraded && upgraded.models === keptOldBig + ',old-long/model,old/model' && upgraded.total <= 50 * 1024 * 1024,
      upgraded && { models: upgraded.models, total: upgraded.total });
    check('the upgrade cut an old string over 200,000 characters', upgraded && upgraded.longLength < 200100 && /\[\.\.\. 100,000 more characters not kept in the log\]$/.test(upgraded.longTail),
      upgraded && { length: upgraded.longLength, tail: upgraded.longTail });

    const longWrite = await inWorker(`
      await logger.writeLog({ requestType: 'web-fetch-summary', timestamp: new Date().toISOString(), model: 'test/model', status: 'success', requestMessages: [{ role: 'user', content: 'x'.repeat(300000) }], responseContent: 'r'.repeat(1000) });
      const rows = await logger.getLogSummaries(25, 0);
      const row = rows.find((r) => r.requestType === 'web-fetch-summary');
      const full = row ? await logger.getLog(row.id) : null;
      const content = full && full.requestMessages && full.requestMessages[0].content;
      return { rows: rows.length, oldKept: rows.some((r) => r.model === 'old/model'), rowKeys: row ? Object.keys(row).sort().join(',') : '', rowResponse: row ? row.responseContent.length : -1,
        length: content ? content.length : -1, tail: content ? content.slice(-60) : '', bytes: full ? full.bytes : -1 };`);
    check('the old store was upgraded in place and kept its newest records', longWrite && longWrite.oldKept && longWrite.rows === 11, longWrite);
    check('a list row carries no request or turns, and a short preview', longWrite && !/requestMessages|turns/.test(longWrite.rowKeys) && longWrite.rowResponse === 300, longWrite);
    check('a 300,000-character string is stored as its first 200,000 and a note of the rest', longWrite && longWrite.length < 200100 && /\[\.\.\. 100,000 more characters not kept in the log\]$/.test(longWrite.tail), longWrite);
    check('the record carries its size', longWrite && longWrite.bytes > 200000 && longWrite.bytes < 210000, longWrite);

    const call = { id: 'call_wire_1', type: 'function', function: { name: 'page_read', arguments: '{}' } };
    const opening = [{ role: 'system', content: 'System prompt.' }, { role: 'user', content: 'Read the page.' }];
    const chatRecord = {
      requestType: 'chat', timestamp: new Date().toISOString(), model: 'test/chat-model', status: 'success', iterationCount: 2,
      requestMessages: opening, responseContent: 'Done.',
      turns: [
        { turnIndex: 1, latencyMs: 10, requestMessages: opening, responseText: '', responseToolCalls: [call] },
        { turnIndex: 2, latencyMs: 10, unchangedPrefixCount: 2, requestMessagesDelta: [{ role: 'assistant', content: '', tool_calls: [call] }, { role: 'tool', tool_call_id: 'call_wire_1', content: WIRE_MARKER }], responseText: 'Done.', responseToolCalls: [] }
      ]
    };
    const chatId = await inWorker(`await logger.writeLog(${JSON.stringify(chatRecord)}); const rows = await logger.getLogSummaries(25, 0); const row = rows.find((r) => r.requestType === 'chat'); return row ? row.id : null;`);
    check('the chat record was written', Number.isFinite(chatId), chatId);

    await chrome.evaluate(await ext.serviceWorker(), `new Promise((r) => chrome.storage.local.set({ abchat_api_key: 'sk-or-test-not-used' }, () => chrome.storage.sync.set({ abchat_tour_done: true }, r)))`);
    const created = await chrome.send('Target.createTarget', { url: urls.qa });
    await wait(5000);
    const page = await chrome.attach(created.result.targetId);
    await chrome.evaluate(await ext.serviceWorker(), `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(urls.qa)})); await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return true; })()`);
    await wait(3500);
    const inPanel = (body) => chrome.evaluate(page, `(() => { const host = document.getElementById('abchat-panel-shadow-host'); const root = host && host.shadowRoot; if (!root) return { noPanel: true }; ${body} })()`, ext.isolatedContextId(page));
    const listed = await inPanel(`const tab = root.querySelector('[data-action="set-tab"][data-tab="logs"]'); if (!tab) return { noTab: true }; tab.click(); return new Promise((r) => setTimeout(() => r({ rows: root.querySelectorAll('#logs-list-container .log-row').length }), 1500));`);
    check('the log list shows the two new records and the ten old ones the upgrade kept', listed && listed.rows === 12, listed);
    const detail = await inPanel(`const row = root.querySelector('#logs-list-container .log-row[data-log-id="${chatId}"]'); if (!row) return { noRow: true }; row.click(); return new Promise((r) => setTimeout(() => { const body = root.getElementById('logs-detail-body'); r({ text: body ? body.textContent : '' }); }, 1500));`);
    check('opening the chat record shows the tool result its later turn added', detail && detail.text && detail.text.indexOf(WIRE_MARKER) !== -1, detail && { text: (detail.text || '').slice(0, 300), noRow: detail.noRow, noPanel: detail.noPanel });

    // About 5.2 million characters each, so twelve of them pass the 50 MB cap.
    const capped = await inWorker(`
      const big = 'b'.repeat(200000);
      const firstRows = await logger.getLogSummaries(1, 0);
      for (let i = 0; i < 12; i++) {
        await logger.writeLog({ requestType: 'compaction', timestamp: new Date().toISOString(), model: 'big/' + i, status: 'success', requestMessages: Array.from({ length: 26 }, () => ({ role: 'user', content: big })) });
      }
      const all = await logger.getLogs(500, 0);
      const total = all.reduce((n, r) => n + JSON.stringify(r).length, 0);
      const models = all.map((r) => r.model);
      return { count: all.length, total, newestKept: models.indexOf('big/11') !== -1, firstBigKept: models.indexOf('big/0') !== -1, chatKept: models.indexOf('test/chat-model') !== -1 };`);
    check('the store stays under its 50 MB cap', capped && capped.total <= 50 * 1024 * 1024, capped);
    check('the oldest records go first and the newest is kept', capped && capped.newestKept && !capped.firstBigKept && !capped.chatKept, capped);
  } finally {
    await chrome.close();
  }
  return checks;
}
