// The chat panel's per-reply page-change row with the real extension: a chat whose tool message
// holds a real page_layout record, a page reload, then Apply and Undo clicked in the panel with
// real mouse events, and the same chat opened on another origin.
import { wait, waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, prepareExtension, reloadPage, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

const ALL_SHOWN = 'answered:block,answered:block,pending:block,answered:block';
const PENDING_HIDDEN = 'answered:block,answered:block,pending:none,answered:block';
// How long a click the panel must ignore is given to act, before the check that it did nothing.
// A real click on Apply hides the row within 70 ms.
const IGNORED_CLICK_SETTLE_MS = 700;
// How long the chat on another site is given to show a page-change row, before the check that it
// shows none. On the same site the row is there about 60 ms after the chat opens.
const OTHER_ORIGIN_ROW_SETTLE_MS = 1000;

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const otherUrl = urls.feedOtherOrigin;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  const click = async (page, x, y) => {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, page);
  };
  try {
    const worker = await prepareExtension(ext);
    const page = await openPage(ext, pageUrl);
    await chrome.send('Page.enable', {}, page);
    // openPage returns once the worker has settled the tab, so a second copy would have landed.
    // The worker used to load one into every tab it caught loading, which here dropped the scan
    // made before it; checked against that worker, where this reads 2.
    const generation = await chrome.evaluate(page, 'window.abchatListenerGeneration', ext.isolatedContextId(page));
    check('a page opened in the foreground runs the content scripts once', generation === 1, generation);
    const rowStates = () => chrome.evaluate(page, `Array.from(document.querySelectorAll('.qa-item')).map((el) => el.dataset.status + ':' + getComputedStyle(el).display).join(',')`);

    const chat = await chrome.evaluate(worker, `ABChatShared.panelDataRepo.createChat({ title: 'Replay test', type: 'chat' })`);
    const chatId = chat && chat.id;
    check('test chat created', Number.isFinite(chatId), chat);
    const call = (args, toolCallId) => ext.callTool(pageUrl, 'page_layout', args, { chatId, toolCallId });
    const scan = await call({ operation: 'scan' }, 'call_scan_1');
    const qa = scan && scan.ok && scan.collections.find((c) => c.fields.some((f) => (f.values || []).indexOf('Pending') !== -1));
    const status = qa && qa.fields.find((f) => (f.values || []).indexOf('Pending') !== -1);
    const applyArgs = { operation: 'apply', changes: [{ action: 'filter', collection: qa && qa.id, field: status && status.field, op: 'contains', value: 'Pending', mode: 'hide', label: 'Hide the pending question' }] };
    const apply = await call(applyArgs, 'call_apply_1');
    check('the tool result carries a page-change record', apply && apply.ok && apply._pageChanges && apply._pageChanges.items.length === 1, apply);
    const modelResult = Object.assign({}, apply);
    delete modelResult._pageChanges;
    const persisted = await chrome.evaluate(await ext.serviceWorker(), `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const chatId = ${chatId};
      await repo.createMessage(chatId, { role: 'user', content: 'hide the pending question', md: 'hide the pending question', pageContext: { url: ${JSON.stringify(pageUrl)}, title: 'Q & A' } }, { touchChat: false });
      await repo.createMessage(chatId, { role: 'assistant', content: '', md: '', tool_calls: [{ id: 'call_apply_1', type: 'function', function: { name: 'page_layout', arguments: ${JSON.stringify(JSON.stringify(applyArgs))} } }] }, { touchChat: false });
      await repo.createMessage(chatId, { role: 'tool', tool_call_id: 'call_apply_1', content: ${JSON.stringify(JSON.stringify(modelResult))}, md: '', pageChanges: ${JSON.stringify(apply && apply._pageChanges)} }, { touchChat: false });
      await repo.createMessage(chatId, { role: 'assistant', content: 'I hid the pending question.', md: 'I hid the pending question.' }, { touchChat: true });
      const msgs = await repo.listMessagesByChatId(chatId);
      const tool = msgs.find((m) => m.role === 'tool');
      return { toolHasRecord: !!(tool && tool.pageChanges && tool.pageChanges.items && tool.pageChanges.items.length === 1), toolContentHasRecord: !!tool && tool.content.indexOf('_pageChanges') !== -1 };
    })()`);
    check('the record is stored on the tool message and kept out of its content', persisted && persisted.toolHasRecord && !persisted.toolContentHasRecord, persisted);

    await reloadPage(ext, page);
    await checkSoon('the reload cleared the change', rowStates, (r) => r === ALL_SHOWN);

    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const ctx = ext.isolatedContextId(page);
    const inPanel = (body) => chrome.evaluate(page, `(() => { const host = document.getElementById('abchat-panel-shadow-host'); const root = host && host.shadowRoot; if (!root) return { noPanel: true }; ${body} })()`, ctx);
    const selectChat = () => inPanel(`const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (!item) return { noItem: true }; item.click(); return { clicked: true };`);
    await checkSoon('the panel opened and the chat was selected', selectChat, (o) => o && o.clicked);
    const rowState = () => inPanel(`const row = root.querySelector('.msg-page-changes'); if (!row) return { noRow: true }; const btn = row.querySelector('button'); const r = btn ? btn.getBoundingClientRect() : null; return { hidden: row.hidden, cls: row.className, text: row.textContent.trim(), button: btn ? btn.textContent : '', x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };`);
    const before = await checkSoon('the reply shows Apply for its change on the same site', rowState, (r) => r && !r.hidden && r.button === 'Apply' && /pending question/.test(r.text));

    await inPanel(`root.querySelector('.msg-page-changes button').click(); return true;`);
    await wait(IGNORED_CLICK_SETTLE_MS);
    check('a script click on Apply does nothing', (await rowStates()) === ALL_SHOWN, await rowStates());

    await click(page, before.x, before.y);
    await checkSoon('a real click on Apply hides the pending row again', rowStates, (r) => r === PENDING_HIDDEN);
    await checkSoon('the reply now offers Undo', rowState, (r) => r.button === 'Undo' && /is-active/.test(r.cls));

    await checkSoon('the replayed change is tagged with the chat and the original key',
      () => chrome.evaluate(page, `(() => (globalThis.ABChatContent || {}).pageLayout.listChatChanges(${chatId}).map((c) => c.key).join(','))()`, ctx), (keys) => keys === 'call_apply_1:0');

    await inPanel(`root.querySelector('.msg-page-changes button').click(); return true;`);
    await checkSoon('Undo in the chat shows the pending row again', rowStates, (r) => r === ALL_SHOWN);
    const afterUndo = await checkSoon('the reply offers Apply again after Undo', rowState, (r) => r.button === 'Apply');

    // An undo made on the page itself (the tool's reset, standing in for the bar) updates the row.
    // Wait for the apply to show as Undo first, or the check below would pass on the row as it was.
    await click(page, afterUndo.x, afterUndo.y);
    await waitUntil(rowState, (r) => r.button === 'Undo');
    await chrome.evaluate(page, `(globalThis.ABChatContent || {}).pageLayout.run({ operation: 'reset' })`, ctx);
    await checkSoon('an undo made outside the chat flips the row back to Apply', rowState, (r) => r.button === 'Apply');

    const teardown = await chrome.evaluate(page, `(() => { try { globalThis.ABChatContent.ui.panelRuntime.teardown(); return 'ok'; } catch (e) { return String(e); } })()`, ctx);
    check('the panel teardown runs without throwing', teardown === 'ok', teardown);

    await reloadPage(ext, page, otherUrl);
    await togglePanel(ext, otherUrl);
    await waitForPanelReady(ext, page);
    const otherCtx = ext.isolatedContextId(page);
    const otherState = () => chrome.evaluate(page, `(() => { const root = document.getElementById('abchat-panel-shadow-host').shadowRoot; const row = root.querySelector('.msg-page-changes'); return { hasRow: !!row, hidden: row ? row.hidden : null, bubble: !!root.querySelector('.msg-bubble.asst') }; })()`, otherCtx);
    await waitUntil(() => chrome.evaluate(page, `(() => { const root = document.getElementById('abchat-panel-shadow-host').shadowRoot; const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (!item) return false; item.click(); return true; })()`, otherCtx), (v) => v === true);
    await waitUntil(otherState, (o) => o.bubble);
    await wait(OTHER_ORIGIN_ROW_SETTLE_MS);
    const other = await otherState();
    check('on another origin the reply shows no page-change row', other && other.bubble && (!other.hasRow || other.hidden === true), other);
    return checks;
  } finally {
    await chrome.close();
  }
}
