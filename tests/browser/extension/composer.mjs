// The composer's bottom row at every panel width, with the real extension and a chat whose token
// counter has text. The mic and send buttons always stay in the row. The token counter only takes
// the space the model picker leaves over and is shown whole or not at all, so it gives way before
// the picker shrinks; the picker then shrinks to no less than 100px. Also checks the tasks filter
// row at the same widths, since it shares the squeeze.
//
// Checked against the code before this change, where 5 of the 16 checks fail. Against this change
// with the counter styled inline as before, 5 fail, among them the counter giving way first and
// send staying in the row. Without min-width: 0 on .input-left, 3 fail, the picker holding at 147px
// and pushing the row past its edge. With the picker's floor set to 0, the 200px row and the short
// name fail, at 88px and 67px. Removing the floor rule entirely is not the same test: .model-wrap
// then keeps its automatic minimum, the full name's width, and the picker never shrinks.
//
// It also sends a message after a reply that made two images, one the agent loop showed the model
// and one whose pictures the provider refused, and checks that only the second is attached. With
// the shown check in panel/panelGeneratedFiles.js turned off (every shown image attached, as
// before), that check fails with both images attached.
import { createRequire } from 'node:module';
import { waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

// The texts the agent loop writes into an image's result, taken from the loop's own rules so this
// check does not lean on the panel's copy.
const fileViewRules = createRequire(import.meta.url)('../../../agent/fileViewRules.js');

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  try {
    const worker = await prepareExtension(ext);
    const chatId = await chrome.evaluate(worker, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const chat = await repo.createChat({ title: 'Counter test', type: 'chat' });
      await repo.createMessage(chat.id, { role: 'user', content: 'hi', md: 'hi' }, { touchChat: false });
      await repo.createMessage(chat.id, { role: 'assistant', content: 'hello', md: 'hello', usageTotalTokens: 123456, usagePromptTokens: 120000, usageCompletionTokens: 3456, usageCost: 0.01234 }, { touchChat: true });
      return chat.id;
    })()`);
    // A chat whose user message was sent with Deep research, saved through the repo so the field
    // has to survive its normalizer, then the panel's copy of the message.
    const researchChatId = await chrome.evaluate(worker, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const chat = await repo.createChat({ title: 'Research marker', type: 'chat' });
      await repo.createMessage(chat.id, { role: 'user', content: 'compare heat pumps', md: 'compare heat pumps', research: true }, { touchChat: false });
      await repo.createMessage(chat.id, { role: 'assistant', content: 'answer', md: 'answer', searchSources: [
        { url: 'https://a.example/read-one', title: 'Read one', read: true },
        { url: 'https://b.example/hit', title: 'Search hit', read: false },
        { url: 'https://c.example/read-two', title: 'Read two', read: true }
      ] }, { touchChat: false });
      await repo.createMessage(chat.id, { role: 'user', content: 'a plain question', md: 'a plain question' }, { touchChat: false });
      await repo.createMessage(chat.id, { role: 'assistant', content: 'plain answer', md: 'plain answer', searchSources: [
        { url: 'https://d.example/one', title: 'Plain hit one' },
        { url: 'https://e.example/two', title: 'Plain hit two' }
      ] }, { touchChat: false });
      return chat.id;
    })()`);
    // A reply that made two images. The agent loop showed the model the first; the provider refused
    // the pictures for the second, so the model never saw it.
    const imageChat = await chrome.evaluate(worker, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const seen = await repo.createAttachmentBlob({ name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: png, size: png.length });
      const unseen = await repo.createAttachmentBlob({ name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: png, size: png.length });
      const chat = await repo.createChat({ title: 'Image look', type: 'chat' });
      const add = (m) => repo.createMessage(chat.id, m, { touchChat: false });
      await add({ role: 'user', content: 'draw a lighthouse and a boat', md: 'draw a lighthouse and a boat' });
      await add({ role: 'assistant', content: '', md: '', tool_calls: [
        { id: 'img_seen', type: 'function', function: { name: 'generate_image', arguments: '{}' } },
        { id: 'img_unseen', type: 'function', function: { name: 'generate_image', arguments: '{}' } }
      ] });
      await add({ role: 'tool', tool_call_id: 'img_seen', content: JSON.stringify({ ok: true, prompt: 'a lighthouse', aspect_ratio: '1:1', pictures: ${JSON.stringify(fileViewRules.PICTURE_STATES.shown)} }) });
      await add({ role: 'tool', tool_call_id: 'img_unseen', content: JSON.stringify({ ok: true, prompt: 'a boat', aspect_ratio: '1:1', pictures: ${JSON.stringify(fileViewRules.PICTURE_STATES.refused)} }) });
      await add({ role: 'assistant', content: '', md: '![Generated image](__blob:' + seen.id + '__)', displayOnly: true, tool_call_id: 'img_seen' });
      await add({ role: 'assistant', content: '', md: '![Generated image](__blob:' + unseen.id + '__)', displayOnly: true, tool_call_id: 'img_unseen' });
      await add({ role: 'assistant', content: 'Here are both pictures.', md: 'Here are both pictures.' });
      return { chatId: chat.id, seen: seen.id, unseen: unseen.id };
    })()`);
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, setMode, showTab, clickWhenPresent, mouseClick } = panelHelpers(ext, page);

    // The chat is open once its messages have loaded and the token counter shows their share of
    // the model's context, which needs the model list too.
    const chatShown = () => inPanel(`const c = root.getElementById('abchat-token-counter'); return { counter: c ? c.textContent : '', main: vis('#chat-main') };`);
    const chatLoaded = (x) => x.main === true && x.counter.indexOf('(12%)') !== -1;
    const openChat = async () => {
      await clickWhenPresent(`[data-action="select-chat"][data-chat-id="${chatId}"]`, 'test chat');
      return waitUntil(chatShown, chatLoaded);
    };
    // The counter's text is shown when it sits on the counter's one visible line; hidden text has
    // wrapped below it. Its box being narrower than the text while shown would mean it is cut.
    const row = () => inPanel(`const ib = root.querySelector('.input-bottom'); const ibr = ib.getBoundingClientRect(); const c = root.getElementById('abchat-token-counter'); const pick = root.getElementById('model-picker-btn').getBoundingClientRect(); const send = root.querySelector('.send-btn').getBoundingClientRect(); const mic = root.getElementById('voice-input-btn').getBoundingClientRect(); const label = root.getElementById('model-picker-label'); const main = root.getElementById('chat-main').getBoundingClientRect(); const panel = root.querySelector('.panel').getBoundingClientRect();
      let counter = null;
      if (c) { const cr = c.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(c); const tr = range.getBoundingClientRect(); counter = { text: c.textContent, boxW: Math.round(cr.width), textW: Math.round(tr.width), shown: tr.width > 0 && tr.top >= cr.top - 0.5 && tr.bottom <= cr.bottom + 0.5 }; }
      return { vw: innerWidth, narrow: host.classList.contains('layout-narrow'), panelW: Math.round(panel.width), mainW: Math.round(main.width), rowW: Math.round(ibr.width), pickW: Math.round(pick.width), truncated: label.scrollWidth > label.clientWidth, pickInside: pick.left >= ibr.left - 0.5 && pick.right <= mic.left, sendInside: send.right <= ibr.right + 0.5 && send.left >= pick.right, overflow: ib.scrollWidth > ib.clientWidth + 1, counter };`);
    const counterOk = (r) => !r.counter || !r.counter.shown || r.counter.boxW >= r.counter.textW - 1;
    const tasksRow = async () => {
      await showTab('tasks');
      const out = await inPanel(`const m = root.querySelector('.tasks-main').getBoundingClientRect(); const f = root.querySelector('.tasks-row1 .filter-tabs').getBoundingClientRect(); const n = root.querySelector('.tasks-row1 .sec-btn').getBoundingClientRect(); return { mainR: Math.round(m.right), filterR: Math.round(f.right), wrapped: f.top > n.bottom - 1 };`);
      await showTab('chats');
      return out;
    };

    await setMode('reduced');
    const opened = await openChat();
    check('the test chat opens', chatLoaded(opened), opened);
    let r = await checkSoon('600px panel: the counter is shown whole and the picker is not truncated', row,
      (x) => x.counter && x.counter.shown && x.counter.text.length > 5 && !x.truncated && x.sendInside && !x.overflow);
    const naturalPickW = r.pickW;

    // Layout follows a resize at once, and setViewport returns after the page has handled it.
    const sweep = [];
    for (const width of [520, 470, 440, 420, 400, 380, 360, 336, 320]) {
      await setViewport(width);
      sweep.push(await row());
    }
    check('narrowing the panel to 300px: mic and send stay in the row', sweep.every((x) => x.sendInside && !x.overflow), sweep.filter((x) => !x.sendInside || x.overflow));
    check('narrowing the panel to 300px: the picker never drops below 100px', sweep.every((x) => x.pickW >= 100 && x.pickInside), sweep.map((x) => x.pickW));
    check('narrowing the panel to 300px: the counter is shown whole or hidden, never cut', sweep.every(counterOk), sweep.map((x) => x.counter));
    const hiddenCounter = sweep.find((x) => x.counter && !x.counter.shown);
    const shrunkBesideCounter = sweep.find((x) => x.counter && x.counter.shown && x.pickW < naturalPickW - 1);
    check('the counter gives way before the picker shrinks', !!hiddenCounter && !shrunkBesideCounter, { naturalPickW, hiddenCounter, shrunkBesideCounter });
    const floor = sweep[sweep.length - 1];
    check('300px panel: the picker label truncates instead of pushing send out', floor.panelW === 300 && floor.truncated && floor.sendInside, floor);

    // The 300px panel never squeezes the picker this far, so force a narrow row. Reading a box
    // lays the row out again, so no wait is needed after each change.
    await setViewport(1600, 1000);
    const forced = await inPanel(`const ib = root.querySelector('.input-bottom'); ib.style.width = '200px'; const w = Math.round(root.getElementById('model-picker-btn').getBoundingClientRect().width); ib.style.width = ''; return w;`);
    check('a 200px row: the picker holds at 100px', forced === 100, forced);
    const shortName = await inPanel(`const lab = root.getElementById('model-picker-label'); const before = lab.textContent; lab.textContent = 'GPT-5'; const b = root.getElementById('model-picker-btn').getBoundingClientRect(); const chev = root.querySelector('#model-picker-btn svg').getBoundingClientRect(); const out = { btnW: Math.round(b.width), chevronToEdge: Math.round(b.right - chev.right) }; lab.textContent = before; return out;`);
    check('a short model name: the picker fills its 100px with the arrow at the right edge', shortName.btnW === 100 && shortName.chevronToEdge <= 9, shortName);

    // Deep research. The "+" menu turns it on, a chip above the message box shows it and turns it
    // off, and the bottom row is laid out the same with it on as with it off, at every width.
    const draftKey = 'abchat_input_draft_sync:' + chatId;
    const research = () => inPanel(`const chip = root.getElementById('composer-research-chip'); const item = root.getElementById('ap-research-item'); const ta = root.querySelector('.chat-textarea').getBoundingClientRect(); const c = root.querySelector('.composer-research-chip').getBoundingClientRect();
      const stored = await new Promise((r) => chrome.storage.local.get(${JSON.stringify(draftKey)}, (o) => r(o && o[${JSON.stringify(draftKey)}])));
      return { shown: vis('#composer-research-chip') === true, pressed: item.getAttribute('aria-pressed'), menuOpen: root.getElementById('attach-picker').classList.contains('open'), chipInside: c.left >= ta.left - 0.5 && c.right <= ta.right + 0.5, chipH: Math.round(c.height), stored: stored ? stored.research === true : null };`);
    const offAt600 = await row();
    const startOff = await research();
    check('Deep research starts off: no chip, menu item not pressed', !startOff.shown && startOff.pressed === 'false', startOff);
    await mouseClick('#attach-btn');
    await checkSoon('the "+" menu opens with Deep research in it', () => inPanel(`return { open: root.getElementById('attach-picker').classList.contains('open'), item: vis('#ap-research-item') };`), (x) => x.open && x.item === true);
    await mouseClick('#ap-research-item');
    const on = await checkSoon('choosing Deep research shows the chip, presses the item, closes the menu and saves it in the draft', research,
      (x) => x.shown && x.pressed === 'true' && !x.menuOpen && x.stored === true);
    check('the chip is one chip high and sits inside the composer', on.chipH <= 28 && on.chipInside, on);
    const onAt600 = await row();
    check('600px panel: the bottom row is the same with Deep research on', onAt600.pickW === offAt600.pickW && onAt600.sendInside && !onAt600.overflow, { offAt600, onAt600 });
    const sweepOn = [];
    for (const width of [520, 470, 440, 420, 400, 380, 360, 336, 320]) {
      await setViewport(width);
      sweepOn.push({ row: await row(), chip: await research() });
    }
    check('narrowing to 300px with Deep research on: the picker is as wide as with it off, and mic and send stay in the row',
      sweepOn.every((x, i) => x.row.pickW === sweep[i].pickW && x.row.sendInside && !x.row.overflow), sweepOn.map((x, i) => [sweep[i].pickW, x.row.pickW]));
    check('narrowing to 300px: the Deep research chip stays whole inside the composer', sweepOn.every((x) => x.chip.shown && x.chip.chipInside && x.chip.chipH <= 28), sweepOn.map((x) => x.chip));
    await setViewport(1600, 1000);
    await mouseClick('.composer-research-chip-off');
    await checkSoon('the chip\'s close button turns Deep research off and saves that', research, (x) => !x.shown && x.pressed === 'false' && x.stored === false);

    await clickWhenPresent(`[data-action="select-chat"][data-chat-id="${researchChatId}"]`, 'research chat');
    await checkSoon('a message saved with research: true shows the Deep research marker', () => inPanel(`const m = root.querySelector('.user-msg .m-chip-research'); return m ? m.textContent.trim() : '';`), (x) => x === 'Deep research');
    // The read flag has to survive the worker's normalizer and the panel's copy of the message. Run
    // against the list before it had groups, this failed with no labels on the first reply.
    await checkSoon('a reply that read pages lists them before the search hits, under labels, and a reply that read none keeps one list', () => inPanel(`return Array.from(root.querySelectorAll('.msg-sources')).map((w) => ({
        toggle: w.querySelector('.msg-sources-toggle').textContent.replace(/^\\S+\\s*/, ''),
        items: Array.from(w.querySelectorAll('.msg-sources-group-label, .msg-source-link')).map((e) => (e.classList.contains('msg-sources-group-label') ? '# ' : '') + e.textContent.trim())
      }));`),
      (x) => JSON.stringify(x) === JSON.stringify([
        { toggle: 'Sources (3)', items: ['# Pages read (2)', 'Read one', 'Read two', '# Cited in search summaries (1)', 'Search hit'] },
        { toggle: 'Sources (2)', items: ['Plain hit one', 'Plain hit two'] }
      ]));

    // Deep research with attachments, down to the 300px floor. The draft is written while another
    // chat is open, so opening the chat loads it on mount. The attachments must be laid out exactly
    // as they are with the switch off: same row width, same chip heights. The first version of this
    // change put the chip beside them in one line, which left them 87px at 300px, wrapped each
    // label a word per line and ran the row under the copy button. Run against it, the layout
    // conditions of the first check below failed at 600px and at 300px.
    // The long page chip wraps to two lines at 300px with the switch off too, so "one line high"
    // would test something this change does not touch.
    await inPanel(`const now = Date.now(); await new Promise((r) => chrome.storage.local.set({ ${JSON.stringify(draftKey)}: { text: 'q', research: true, chips: [
      { type: 'page', label: 'Heat pump running costs explained', content: 'x', pageUrl: 'https://www.example.org/heat-pumps', pageTitle: 'Heat pumps' },
      { type: 'paste', label: 'Pasted tariff table', content: 'x' }
    ], chatScope: '${chatId}', sourceId: 'composer-test', revision: 1, version: 'composer-test:1:' + now, updatedAt: now, cleared: false, clearedThroughUpdatedAt: 0 } }, r)); return 1;`);
    await openChat();
    await checkSoon('the staged draft loads with Deep research on and two attachments', () => inPanel(`return { n: root.querySelectorAll('.input-chips-row .ic').length, on: vis('#composer-research-chip') === true };`), (x) => x.n === 2 && x.on);
    const attachRow = () => inPanel(`const bar = root.querySelector('.input-chips-bar'); const row = root.querySelector('.input-chips-row').getBoundingClientRect(); const chip = root.querySelector('.composer-research-chip').getBoundingClientRect(); const copy = root.querySelector('.chips-copy-btn').getBoundingClientRect(); const ta = root.querySelector('.chat-textarea').getBoundingClientRect(); const chips = Array.from(root.querySelectorAll('.input-chips-row .ic')).map((c) => Math.round(c.getBoundingClientRect().height));
      return { barOverflow: bar.scrollWidth > bar.clientWidth + 1, rowW: Math.round(row.width), taW: Math.round(ta.width), chipAboveRow: chip.bottom <= row.top + 0.5, copyBesideRow: copy.left >= row.right - 0.5 && copy.right <= ta.right + 0.5 && Math.abs(copy.top - row.top) < 1, chipHeights: chips };`);
    const attachWidths = [1600, 520, 400, 320];
    const attachOn = [];
    for (const width of attachWidths) {
      await setViewport(width);
      attachOn.push(await attachRow());
    }
    await setViewport(1600, 1000);
    await mouseClick('.composer-research-chip-off');
    await checkSoon('the chip\'s close button turns Deep research off with attachments present', research, (x) => !x.shown);
    const attachOff = [];
    for (const width of attachWidths) {
      await setViewport(width);
      attachOff.push(await attachRow());
    }
    check('Deep research with attachments, 600px down to 300px: the chip has its own line, the copy button stays beside the attachments, and nothing overflows',
      attachOn.every((a) => !a.barOverflow && a.chipAboveRow && a.copyBesideRow), attachOn);
    check('Deep research with attachments, 600px down to 300px: the attachments have the same row width and chip heights as with it off',
      attachOn.every((a, i) => a.rowW === attachOff[i].rowW && JSON.stringify(a.chipHeights) === JSON.stringify(attachOff[i].chipHeights)),
      attachOn.map((a, i) => ({ width: attachWidths[i], on: [a.rowW, a.chipHeights], off: [attachOff[i].rowW, attachOff[i].chipHeights] })));
    await setViewport(1600, 1000);
    // Put the composer back: no stored draft for the chat, so it mounts empty.
    await clickWhenPresent(`[data-action="select-chat"][data-chat-id="${researchChatId}"]`, 'research chat');
    await inPanel(`await new Promise((r) => chrome.storage.local.remove(${JSON.stringify(draftKey)}, r)); return 1;`);
    await openChat();
    await checkSoon('with no stored draft the composer opens empty with Deep research off', () => inPanel(`return { n: root.querySelectorAll('.input-chips-row .ic').length, on: vis('#composer-research-chip') === true, text: root.querySelector('.chat-textarea').value };`), (x) => x.n === 0 && !x.on && x.text === '');

    await setMode('expanded');
    await openChat();
    r = await row();
    let t = await tasksRow();
    check('expanded at 1600px: picker not truncated, tasks filter on one row', !r.truncated && r.sendInside && !t.wrapped && t.filterR <= t.mainR, { r, t });
    for (const width of [900, 720]) {
      await setViewport(width);
      r = await row();
      t = await tasksRow();
      check('expanded at ' + width + 'px: send in, picker not truncated, counter whole or hidden, tasks filter on one row', r.sendInside && !r.overflow && !r.truncated && counterOk(r) && !t.wrapped && t.filterR <= t.mainR, { r, t });
    }
    await setViewport(640);
    r = await row();
    t = await tasksRow();
    check('expanded at 640px, the narrowest side-by-side layout: send in, picker at least 100px, counter whole or hidden', !r.narrow && r.sendInside && !r.overflow && r.pickW >= 100 && counterOk(r), r);
    check('expanded at 640px: the tasks filter stays inside the list', t.filterR <= t.mainR, t);
    await setViewport(500, 844, 2);
    r = await row();
    t = await tasksRow();
    check('expanded at 500px (one pane): the chat fills the panel, picker not truncated, send in', r.narrow && r.mainW >= r.panelW - 2 && !r.truncated && r.sendInside, r);
    check('expanded at 500px (one pane): tasks filter on one row', !t.wrapped && t.filterR <= t.mainR, t);

    // Sending with Deep research on puts research: true on the saved message and turns the switch
    // off. The hand-off to the agent loop is swallowed in this world, so no request leaves the
    // browser; the chat already has messages, so no title is generated either.
    await inPanel(`const sendForTest = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = function (m, cb) { if (m && m.action === 'agentRunStart') { if (typeof cb === 'function') cb({ ok: true }); return undefined; } return sendForTest.apply(null, arguments); };
      return 1;`);
    await mouseClick('#attach-btn');
    await mouseClick('#ap-research-item');
    await checkSoon('Deep research turns on in the one-pane layout too', research, (x) => x.shown && x.stored === true);
    await inPanel(`const ta = root.querySelector('.chat-textarea'); ta.value = 'deep research send check'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
    await mouseClick('.send-btn');
    await checkSoon('after the send the composer is empty and Deep research is off in it and in the draft', async () => {
      const x = await research();
      x.text = await inPanel(`return root.querySelector('.chat-textarea').value;`);
      return x;
    }, (x) => !x.shown && x.text === '' && x.stored !== true);
    await checkSoon('the sent message is saved with research: true', () => chrome.evaluate(worker, `(async () => {
      const chat = await ABChatShared.panelDataRepo.getChat(${chatId});
      const sent = chat.messages.filter((m) => m.role === 'user' && m.content === 'deep research send check');
      return sent.length === 1 && sent[0].research === true;
    })()`), (x) => x === true);

    // The next message in the image chat carries only the image the model has not seen. The hand-off
    // is still swallowed, so the saved user message is what the next request would be built from.
    await setViewport(1600, 1000);
    await clickWhenPresent(`[data-action="select-chat"][data-chat-id="${imageChat.chatId}"]`, 'image chat');
    await waitUntil(() => inPanel(`const c = root.getElementById('chat-messages-content'); return !!c && c.textContent.indexOf('Here are both pictures.') !== -1;`), (x) => x === true);
    await inPanel(`const ta = root.querySelector('.chat-textarea'); ta.value = 'image staging check'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
    await mouseClick('.send-btn');
    await checkSoon('the next message attaches the image the model was not shown, and not the one it was', () => chrome.evaluate(worker, `(async () => {
      const chat = await ABChatShared.panelDataRepo.getChat(${imageChat.chatId});
      const sent = chat.messages.filter((m) => m.role === 'user' && m.content === 'image staging check');
      return sent.length === 1 ? (sent[0].chips || []).map((c) => Number(c.refId)) : null;
    })()`), (x) => Array.isArray(x) && x.length === 1 && x[0] === imageChat.unseen);
    return checks;
  } finally {
    await chrome.close();
  }
}
