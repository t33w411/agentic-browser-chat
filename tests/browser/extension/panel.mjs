// The chat panel's per-reply page-change row with the real extension: a chat whose tool message
// holds a real page_layout record, a page reload, then Apply and Undo clicked in the panel with
// real mouse events, and the same chat opened on another origin.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

const ALL_SHOWN = 'answered:block,answered:block,pending:block,answered:block';
const PENDING_HIDDEN = 'answered:block,answered:block,pending:none,answered:block';

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const otherUrl = urls.feedOtherOrigin;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  const openPanelIn = async (url) => {
    const worker = await ext.serviceWorker();
    await chrome.evaluate(worker, `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(url)})); await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return true; })()`);
  };
  const click = async (page, x, y) => {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, page);
  };
  try {
    await wait(2500);
    const worker = await ext.serviceWorker();
    await chrome.evaluate(worker, `new Promise((r) => chrome.storage.local.set({ abchat_api_key: 'sk-or-test-not-used' }, () => chrome.storage.sync.set({ abchat_tour_done: true }, r)))`);
    const created = await chrome.send('Target.createTarget', { url: pageUrl });
    await wait(5000);
    const page = await chrome.attach(created.result.targetId);
    await chrome.send('Runtime.enable', {}, page);
    await chrome.send('Page.enable', {}, page);
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

    await chrome.send('Page.reload', {}, page);
    await wait(5000);
    check('the reload cleared the change', (await rowStates()) === ALL_SHOWN, await rowStates());

    await openPanelIn(pageUrl);
    await wait(3500);
    const ctx = ext.isolatedContextId(page);
    const inPanel = (body) => chrome.evaluate(page, `(() => { const host = document.getElementById('abchat-panel-shadow-host'); const root = host && host.shadowRoot; if (!root) return { noPanel: true }; ${body} })()`, ctx);
    const opened = await inPanel(`const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (!item) return { noItem: true }; item.click(); return { clicked: true };`);
    check('the panel opened and the chat was selected', opened && opened.clicked, opened);
    await wait(2000);
    const rowState = () => inPanel(`const row = root.querySelector('.msg-page-changes'); if (!row) return { noRow: true }; const btn = row.querySelector('button'); const r = btn ? btn.getBoundingClientRect() : null; return { hidden: row.hidden, cls: row.className, text: row.textContent.trim(), button: btn ? btn.textContent : '', x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };`);
    const before = await rowState();
    check('the reply shows Apply for its change on the same site', before && !before.hidden && before.button === 'Apply' && /pending question/.test(before.text), before);

    await inPanel(`root.querySelector('.msg-page-changes button').click(); return true;`);
    await wait(700);
    check('a script click on Apply does nothing', (await rowStates()) === ALL_SHOWN, await rowStates());

    await click(page, before.x, before.y);
    await wait(900);
    check('a real click on Apply hides the pending row again', (await rowStates()) === PENDING_HIDDEN, await rowStates());
    const afterApply = await rowState();
    check('the reply now offers Undo', afterApply.button === 'Undo' && /is-active/.test(afterApply.cls), afterApply);

    const keys = await chrome.evaluate(page, `(() => (globalThis.ABChatContent || {}).pageLayout.listChatChanges(${chatId}).map((c) => c.key).join(','))()`, ctx);
    check('the replayed change is tagged with the chat and the original key', keys === 'call_apply_1:0', keys);

    await inPanel(`root.querySelector('.msg-page-changes button').click(); return true;`);
    await wait(700);
    check('Undo in the chat shows the pending row again', (await rowStates()) === ALL_SHOWN, await rowStates());
    const afterUndo = await rowState();
    check('the reply offers Apply again after Undo', afterUndo.button === 'Apply', afterUndo);

    // An undo made on the page itself (the tool's reset, standing in for the bar) updates the row.
    await click(page, afterUndo.x, afterUndo.y);
    await wait(600);
    await chrome.evaluate(page, `(globalThis.ABChatContent || {}).pageLayout.run({ operation: 'reset' })`, ctx);
    await wait(500);
    const afterReset = await rowState();
    check('an undo made outside the chat flips the row back to Apply', afterReset.button === 'Apply', afterReset);

    const teardown = await chrome.evaluate(page, `(() => { try { globalThis.ABChatContent.ui.panelRuntime.teardown(); return 'ok'; } catch (e) { return String(e); } })()`, ctx);
    check('the panel teardown runs without throwing', teardown === 'ok', teardown);

    await chrome.send('Page.navigate', { url: otherUrl }, page);
    await wait(5000);
    await openPanelIn(otherUrl);
    await wait(3500);
    const other = await chrome.evaluate(page, `(() => { const root = document.getElementById('abchat-panel-shadow-host').shadowRoot; const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (item) item.click(); return new Promise((r) => setTimeout(() => { const row = root.querySelector('.msg-page-changes'); r({ hasRow: !!row, hidden: row ? row.hidden : null, bubble: !!root.querySelector('.msg-bubble.asst') }); }, 2000)); })()`, ext.isolatedContextId(page));
    check('on another origin the reply shows no page-change row', other && other.bubble && (!other.hasRow || other.hidden === true), other);
    return checks;
  } finally {
    await chrome.close();
  }
}
