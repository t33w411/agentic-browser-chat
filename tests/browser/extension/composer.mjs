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
import { waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

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
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, setMode, showTab, clickWhenPresent } = panelHelpers(ext, page);

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
    return checks;
  } finally {
    await chrome.close();
  }
}
