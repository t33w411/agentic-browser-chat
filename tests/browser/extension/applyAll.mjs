// The chat panel's chat-wide page-change row with the real extension. Two replies change the Q&A
// page. After a reload the first reply's change is applied again, and a third reply undoes it and
// adds its own. After another reload the chat-wide row offers Apply all for the second and third
// replies' changes only, and Apply all and Undo all are clicked with real mouse events.
//
// Verified against the extension from before the chat-wide row and keyed undo records. The undo
// record check and every chat-wide row check fail there (6 of 16), and the setup checks and the
// per-reply rows check still pass. The real click on Apply all also checks that the rows, filled
// in after the chat has scrolled to its newest message, scroll it again. Before that, the button
// sat under the composer and the click landed on the composer.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
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
    const pageState = () => chrome.evaluate(page, `(() => {
      const items = Array.from(document.querySelectorAll('.qa-item'));
      return {
        pendingShown: items.filter((el) => el.dataset.status === 'pending').every((el) => getComputedStyle(el).display !== 'none'),
        fontSize: items.length ? getComputedStyle(items[0]).fontSize : '',
        maxWidth: items.length ? getComputedStyle(items[0].parentElement).maxWidth : ''
      };
    })()`);
    const reload = async () => {
      await chrome.send('Page.reload', {}, page);
      await wait(5000);
    };

    const chat = await chrome.evaluate(worker, `ABChatShared.panelDataRepo.createChat({ title: 'Apply all test', type: 'chat' })`);
    const chatId = chat && chat.id;
    check('test chat created', Number.isFinite(chatId), chat);
    const call = (args, toolCallId) => ext.callTool(pageUrl, 'page_layout', args, { chatId, toolCallId });
    // One reply as the agent loop stores it: the user's message, the assistant's tool calls, a tool
    // message per call with its record kept beside the content, then the reply text.
    const persistTurn = async (userText, calls, replyText) => chrome.evaluate(await ext.serviceWorker(), `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const chatId = ${chatId};
      const calls = ${JSON.stringify(calls)};
      await repo.createMessage(chatId, { role: 'user', content: ${JSON.stringify(userText)}, md: ${JSON.stringify(userText)}, pageContext: { url: ${JSON.stringify(pageUrl)}, title: 'Q & A' } }, { touchChat: false });
      await repo.createMessage(chatId, { role: 'assistant', content: '', md: '', tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: 'page_layout', arguments: JSON.stringify(c.args) } })) }, { touchChat: false });
      for (const c of calls) {
        const content = Object.assign({}, c.result);
        delete content._pageChanges;
        await repo.createMessage(chatId, { role: 'tool', tool_call_id: c.id, content: JSON.stringify(content), md: '', pageChanges: c.result._pageChanges }, { touchChat: false });
      }
      await repo.createMessage(chatId, { role: 'assistant', content: ${JSON.stringify(replyText)}, md: ${JSON.stringify(replyText)} }, { touchChat: true });
      return true;
    })()`);

    const scan = await call({ operation: 'scan' }, 'call_scan_1');
    const qa = scan && scan.ok && scan.collections.find((c) => c.fields.some((f) => (f.values || []).indexOf('Pending') !== -1));
    const status = qa && qa.fields.find((f) => (f.values || []).indexOf('Pending') !== -1);
    const hideArgs = { operation: 'apply', changes: [{ action: 'filter', collection: qa && qa.id, field: status && status.field, op: 'contains', value: 'Pending', mode: 'hide', label: 'Hide the pending question' }] };
    const hide = await call(hideArgs, 'call_hide');
    const biggerArgs = { operation: 'apply', changes: [{ action: 'style', target: qa && qa.id, part: 'items', css: { 'font-size': '20px' }, label: 'Bigger questions' }] };
    const bigger = await call(biggerArgs, 'call_bigger');
    check('the first two replies changed the page', hide && hide.ok && bigger && bigger.ok, { hide, bigger });
    await persistTurn('hide the pending question', [{ id: 'call_hide', args: hideArgs, result: hide }], 'I hid the pending question.');
    await persistTurn('make the questions bigger', [{ id: 'call_bigger', args: biggerArgs, result: bigger }], 'The questions are bigger now.');

    // A later visit. The first reply's change is applied again the way its Apply button does it, and
    // then the model undoes it. Its id in this page load is not the one in the first reply's record.
    await reload();
    const ctx = ext.isolatedContextId(page);
    const replayed = await chrome.evaluate(page, `(() => (globalThis.ABChatContent || {}).pageLayout.replay(${JSON.stringify(hide._pageChanges.items.map((i) => ({ key: i.key, spec: i.spec })))}, { chatId: ${chatId} }))()`, ctx);
    check('the first reply\'s change was applied again after the reload', replayed && replayed.applied === 1 && (await pageState()).pendingShown === false, replayed);
    const undoArgs = { operation: 'undo' };
    const undo = await call(undoArgs, 'call_undo');
    check('the undo record names the re-applied change by its original key', undo && undo.ok && undo._pageChanges && Array.isArray(undo._pageChanges.keys) && undo._pageChanges.keys[0] === 'call_hide:0', undo && undo._pageChanges);
    const rescan = await call({ operation: 'scan' }, 'call_scan_2');
    const qa2 = rescan && rescan.ok && rescan.collections.find((c) => c.fields.some((f) => (f.values || []).indexOf('Pending') !== -1));
    const narrowArgs = { operation: 'apply', changes: [{ action: 'style', target: qa2 && qa2.id, css: { 'max-width': '700px' }, label: 'Narrower list' }] };
    const narrow = await call(narrowArgs, 'call_narrow');
    check('the third reply changed the page', narrow && narrow.ok, narrow);
    await persistTurn('show the pending one again and make the list narrower', [{ id: 'call_undo', args: undoArgs, result: undo }, { id: 'call_narrow', args: narrowArgs, result: narrow }], 'Done.');

    await reload();
    const fresh = await pageState();
    check('the reload cleared every change', fresh.pendingShown && fresh.fontSize !== '20px' && fresh.maxWidth === 'none', fresh);
    const worker2 = await ext.serviceWorker();
    await chrome.evaluate(worker2, `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(pageUrl)})); await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return true; })()`);
    await wait(3500);
    const ctx2 = ext.isolatedContextId(page);
    const inPanel = (body) => chrome.evaluate(page, `(() => { const host = document.getElementById('abchat-panel-shadow-host'); const root = host && host.shadowRoot; if (!root) return { noPanel: true }; ${body} })()`, ctx2);
    const opened = await inPanel(`const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (!item) return { noItem: true }; item.click(); return { clicked: true };`);
    check('the panel opened and the chat was selected', opened && opened.clicked, opened);
    await wait(2500);

    const chatRow = () => inPanel(`const replyRows = Array.from(root.querySelectorAll('.msg-page-changes[data-page-changes-msg-id]')).map((r) => r.hidden ? 'hidden' : (r.querySelector('button') || {}).textContent);
      const row = root.querySelector('.msg-page-changes[data-page-changes-scope="chat"]'); if (!row) return { noRow: true, replyRows };
      const button = (action) => { const b = row.querySelector('[data-action="' + action + '"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { label: b.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      const text = row.querySelector('.mpc-text');
      return { hidden: row.hidden, cls: row.className, text: text ? text.textContent : '', tip: text ? text.title : '', apply: button('page-changes-apply-all'), undo: button('page-changes-undo-all'), replyRows };`);
    const before = await chatRow();
    check('the chat-wide row offers Apply all for the changes the chat left in place', before && !before.hidden && before.apply && before.apply.label === 'Apply all' && !before.undo
      && before.text === '2 page changes from this chat' && /Bigger questions/.test(before.tip) && /Narrower list/.test(before.tip) && !/pending/.test(before.tip), before);
    check('each reply keeps its own row, the first one included', before && before.replyRows && before.replyRows.join(',') === 'Apply,Apply,Apply', before && before.replyRows);

    await inPanel(`root.querySelector('[data-action="page-changes-apply-all"]').click(); return true;`);
    await wait(700);
    const afterScript = await pageState();
    check('a script click on Apply all does nothing', afterScript.fontSize !== '20px' && afterScript.maxWidth === 'none', afterScript);

    if (before && before.apply) await click(page, before.apply.x, before.apply.y);
    await wait(900);
    const afterApply = await pageState();
    check('a real click on Apply all applies both changes and leaves out the undone one', afterApply.fontSize === '20px' && afterApply.maxWidth === '700px' && afterApply.pendingShown, afterApply);
    const keys = await chrome.evaluate(page, `(() => (globalThis.ABChatContent || {}).pageLayout.listChatChanges(${chatId}).map((c) => c.key).join(','))()`, ctx2);
    check('the applied changes carry their replies\' keys', keys === 'call_bigger:0,call_narrow:0', keys);
    const applied = await chatRow();
    check('the chat-wide row then offers Undo all only', applied && applied.undo && applied.undo.label === 'Undo all' && !applied.apply && /is-active/.test(applied.cls), applied);

    if (applied && applied.undo) await click(page, applied.undo.x, applied.undo.y);
    await wait(900);
    const afterUndo = await pageState();
    check('Undo all removes every change the chat has on the page', afterUndo.fontSize !== '20px' && afterUndo.maxWidth === 'none' && afterUndo.pendingShown, afterUndo);
    const undone = await chatRow();
    check('the chat-wide row offers Apply all again', undone && undone.apply && undone.apply.label === 'Apply all' && !undone.undo, undone);

    const teardown = await chrome.evaluate(page, `(() => { try { globalThis.ABChatContent.ui.panelRuntime.teardown(); return 'ok'; } catch (e) { return String(e); } })()`, ctx2);
    check('the panel teardown runs without throwing', teardown === 'ok', teardown);
    return checks;
  } finally {
    await chrome.close();
  }
}
