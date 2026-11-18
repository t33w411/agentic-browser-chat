// Expanded mode in a narrow window, with the real extension. Below 640px the expanded panel shows
// one pane at a time, as reduced mode does: each tab's list, then the open item full width with a
// back button. Resizing across 640px switches layouts and keeps the open item; a sidebar collapsed
// in the wide layout still shows its list; and switching layouts writes no panel state to storage.
//
// Checked against the code before this change, where 9 of the 17 checks fail, and against this
// change with the narrow layout switched off, where 10 fail. The tenth is the model picker at
// 500px. There the expanded panel fits the window but keeps two panes, so the chat column is 185px
// and opening the picker scrolled it sideways. Without the rules that show a collapsed sidebar in
// place, the narrow collapsed-sidebar check fails, because the list is visible but ignores clicks.
import { passes, wait, waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

// How long the chat is given to scroll after the model picker opens, before the check that it did
// not. The scroll it guards against came from the menu opening, within a frame or two.
const PICKER_SCROLL_SETTLE_MS = 300;
// How long a layout switch is given to write panel state before the check that it wrote none.
// Panel state is written 50 ms after a change.
const STORAGE_WRITE_SETTLE_MS = 500;

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  try {
    const worker = await prepareExtension(ext);
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, setMode, showTab, clickWhenPresent, mouseClick } = panelHelpers(ext, page);
    const chatState = () => inPanel(`return { narrow: host.classList.contains('layout-narrow'), list: vis('#chat-sidebar'), main: vis('#chat-main'), back: vis('.chat-back-btn'), inChat: root.getElementById('view-chats').classList.contains('in-chat') };`);

    await setMode('expanded');
    await showTab('chats');
    await checkSoon('expanded at 1600px: list and chat side by side', chatState, (s) => !s.narrow && s.list === true && s.main === true && s.back === false);

    await setViewport(639);
    await checkSoon('expanded at 639px: the chat list alone', chatState, (s) => s.narrow && s.list === true && s.main === false);
    await clickWhenPresent('[data-action="select-chat"]', 'chat in the list');
    await checkSoon('opening a chat shows it full width with a back button', chatState, (s) => s.inChat && s.list === false && s.main === true && s.back === true);

    await setViewport(900);
    await checkSoon('widened to 900px with a chat open: side by side again', chatState, (s) => !s.narrow && !s.inChat && s.list === true && s.main === true);
    await setViewport(500, 844, 2);
    await checkSoon('narrowed to 500px: back on the open chat', chatState, (s) => s.narrow && s.inChat && s.main === true && s.list === false);
    // Beside the sidebar at this width the chat was 185px, too narrow for the picker's 220px menu,
    // and opening it scrolled the chat sideways for good.
    const pickerOpen = () => inPanel(`const d = root.getElementById('model-picker-dropdown'); return !!d && d.classList.contains('open');`);
    await mouseClick('#model-picker-btn');
    const opened = await waitUntil(pickerOpen, (open) => open === true);
    await wait(PICKER_SCROLL_SETTLE_MS);
    const shift = await inPanel(`return root.getElementById('chat-main').scrollLeft;`);
    await mouseClick('#model-picker-btn');
    const closed = await waitUntil(pickerOpen, (open) => open === false);
    const after = await inPanel(`return root.getElementById('chat-main').scrollLeft;`);
    check('at 500px, the model picker opens and closes without scrolling the chat sideways', opened === true && closed === false && shift === 0 && after === 0, { opened, closed, shift, after });
    await inPanel(`root.querySelector('[data-action="back-from-chat"]').click(); return 1;`);
    await checkSoon('the back button returns to the list', chatState, (s) => !s.inChat && s.list === true && s.main === false);

    const drill = async (tab, itemSelector, listSelector, detailSelector, backAction) => {
      const state = () => inPanel(`return { list: vis('${listSelector}'), detail: vis('${detailSelector}'), back: vis('[data-action="${backAction}"]') };`);
      const showsList = (x) => x.list === true && x.detail === false;
      const showsDetail = (x) => x.detail === true && x.list === false && x.back === true;
      await showTab(tab);
      const atList = await waitUntil(state, showsList);
      let clicked = true;
      try {
        await clickWhenPresent(itemSelector, tab + ' item');
      } catch (errNoItem) {
        clicked = false;
      }
      const atDetail = await waitUntil(state, showsDetail);
      await inPanel(`const b = root.querySelector('[data-action="${backAction}"]'); if (b) b.click(); return 1;`);
      const backAtList = await waitUntil(state, showsList);
      const ok = passes(showsList, atList) && clicked && passes(showsDetail, atDetail) && passes(showsList, backAtList);
      return { ok, atList, clicked, atDetail, backAtList };
    };
    let d = await drill('notes', '[data-action="select-note"]', '.notes-sidebar', '.note-editor', 'back-from-note');
    check('notes: list, then the editor with a back button, then the list', d.ok, d);
    d = await drill('tasks', '[data-action="select-task"]', '.tasks-main', '.task-editor-pane', 'back-from-task');
    check('tasks: list, then the editor with a back button, then the list', d.ok, d);
    d = await drill('quiz', '[data-action="open-question-answer"]', '.quiz-main', '.quiz-editor-pane', 'back-from-quiz');
    check('quiz: list, then the question with a back button, then the list', d.ok, d);
    await showTab('chats');

    // A sidebar collapsed in the wide layout.
    await setViewport(1200, 900, 1);
    await inPanel(`root.querySelector('[data-action="collapse-sidebar"]').click(); return 1;`);
    const sidebar = () => inPanel(`const sb = root.getElementById('chat-sidebar'); return { collapsed: sb.classList.contains('collapsed'), list: vis('#chat-sidebar'), main: vis('#chat-main'), width: Math.round(sb.getBoundingClientRect().width), pointerEvents: getComputedStyle(sb).pointerEvents, trigger: vis('.expand-sidebar-trigger'), narrow: host.classList.contains('layout-narrow') };`);
    const collapsedWide = (sb) => sb.collapsed && sb.list === false && sb.main === true;
    await checkSoon('wide: the chat sidebar collapses', sidebar, collapsedWide);
    // Record every storage write from here on, to show that switching layouts writes no panel state.
    await chrome.evaluate(worker, `(() => { self.__abchatChanges = []; if (!self.__abchatChangesBound) { chrome.storage.onChanged.addListener((c, area) => { (self.__abchatChanges || []).push(...Object.keys(c).map((k) => area + ':' + k)); }); self.__abchatChangesBound = true; } return true; })()`);
    await setViewport(560);
    await checkSoon('narrow: the collapsed sidebar still shows the list full width, with no expand trigger', sidebar,
      (sb) => sb.narrow && sb.collapsed && sb.list === true && sb.width > 400 && sb.pointerEvents === 'auto' && sb.trigger === false);
    await setViewport(1200);
    await checkSoon('wide again: the sidebar is still collapsed', sidebar, collapsedWide);
    await wait(STORAGE_WRITE_SETTLE_MS);
    // Only the panel's own state counts. The model lists the picker started loading above are
    // cached whenever they arrive, which can be now, and have nothing to do with the layout.
    const writes = (await chrome.evaluate(worker, `self.__abchatChanges.slice()`)).filter((k) => k.indexOf('abchat_panel_ui_state') !== -1);
    check('switching layouts by resizing wrote no panel state to storage', writes.length === 0, writes);
    await showTab('notes');
    await checkSoon('control: a tab switch is recorded, so the watcher works', () => chrome.evaluate(worker, `self.__abchatChanges.slice()`),
      (keys) => keys.some((k) => /abchat_panel_ui_state_field_tab$/.test(k)));
    await showTab('chats');
    await inPanel(`root.querySelector('[data-action="expand-sidebar"]').click(); return 1;`);

    await setViewport(500);
    const reduced = await setMode('reduced');
    check('reduced mode at 500px never takes the narrow layout class', !/layout-narrow/.test(reduced), reduced);
    const expanded = await setMode('expanded');
    check('expanded again at 500px: the narrow layout is back', /layout-narrow/.test(expanded), expanded);
    return checks;
  } finally {
    await chrome.close();
  }
}
