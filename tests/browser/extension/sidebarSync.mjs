// Collapsed sidebars across tabs, with the real extension and two tabs. Collapsing or expanding the
// chat or notes sidebar in one tab does the same in the other. Neither single-column layout has a
// collapse button, so a collapsed state that reaches a tab in the narrow expanded layout, or in
// reduced mode, must leave its list visible and usable rather than an empty pane.
//
// Checked against the code before this change, where 7 of the 10 checks fail. The three that pass
// hold with no sync at all: the starting state, entering reduced mode, and opening a chat from a
// list that was never collapsed. Without the rules that show a collapsed
// sidebar in place, the narrow and reduced checks fail. The narrow list is visible but ignores
// clicks, and the reduced list is not shown, so no chat can be opened from it.
import { waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { activateTab, openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

export async function run({ extPath, urls }) {
  const urlA = urls.qa;
  const urlB = urls.feed;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  try {
    const worker = await prepareExtension(ext);
    const pageB = await openPage(ext, urlB);
    const pageA = await openPage(ext, urlA);
    await togglePanel(ext, urlA);
    await waitForPanelReady(ext, pageA);
    // Tab B builds its panel when idle, once the panel is open in tab A.
    await waitForPanelReady(ext, pageB);
    const tabA = panelHelpers(ext, pageA);
    const tabB = panelHelpers(ext, pageB);
    const state = (tab) => tab.inPanel(`return { mode: host.className.match(/mode-\\w+/)[0], narrow: host.classList.contains('layout-narrow'), chatCollapsed: root.getElementById('chat-sidebar').classList.contains('collapsed'), notesCollapsed: root.querySelector('.notes-sidebar').classList.contains('collapsed'), chatList: vis('#chat-sidebar'), chatListClickable: getComputedStyle(root.getElementById('chat-sidebar')).pointerEvents !== 'none', chatTrigger: vis('.expand-sidebar-trigger') };`);
    const click = (tab, action) => tab.inPanel(`root.querySelector('[data-action="${action}"]').click(); return 1;`);
    const stored = (name) => chrome.evaluate(worker, `new Promise((r) => chrome.storage.local.get('abchat_panel_ui_state_field_${name}', (o) => { const rec = o['abchat_panel_ui_state_field_${name}']; r(rec ? rec.value : undefined); }))`);
    const tabBWithStored = (name) => async () => Object.assign(await state(tabB), { stored: await stored(name) });
    // As if another tab, still in expanded mode, collapsed the chat sidebar.
    const collapseFromOtherTab = () => chrome.evaluate(worker, `new Promise((r) => chrome.storage.local.set({ abchat_panel_ui_state_field_sidebarCollapsed: { value: true, updatedAt: Date.now(), sourceId: 'test-other-tab' } }, r))`);

    await checkSoon('both tabs have the panel, expanded, with both sidebars open', async () => ({ a: await state(tabA), b: await state(tabB) }),
      ({ a, b }) => !a.noPanel && !b.noPanel && a.mode === 'mode-expanded' && b.mode === 'mode-expanded' && !a.chatCollapsed && !b.chatCollapsed && !b.notesCollapsed);

    await click(tabA, 'collapse-sidebar');
    await checkSoon('collapsing the chat sidebar in one tab collapses it in the other', tabBWithStored('sidebarCollapsed'), (b) => b.chatCollapsed && b.stored === true);
    await click(tabA, 'expand-sidebar');
    await checkSoon('expanding it in one tab expands it in the other', tabBWithStored('sidebarCollapsed'), (b) => !b.chatCollapsed && b.stored === false);
    await click(tabA, 'collapse-notes-sidebar');
    await checkSoon('collapsing the notes sidebar in one tab collapses it in the other', tabBWithStored('notesSidebarCollapsed'), (b) => b.notesCollapsed && b.stored === true);
    await click(tabA, 'expand-notes-sidebar');
    await checkSoon('expanding the notes sidebar in one tab expands it in the other', tabBWithStored('notesSidebarCollapsed'), (b) => !b.notesCollapsed && b.stored === false);

    // Tab B in a narrow window. A tab in the background gets no resize event until it is shown,
    // so the resize is not waited for, and the layout is checked once the tab is in front.
    await tabB.setViewport(560, 900, 1, { hidden: true });
    await activateTab(ext, urlB);
    await checkSoon('tab B, shown in a 560px window, takes the narrow layout', () => state(tabB), (b) => b.narrow === true);
    // The collapse is written as another tab would write it, not clicked in tab A. Tab A is in the
    // background now, and a tab ignores its own writes while it applies another tab's; the guard
    // is released on a timer that Chrome slows in background tabs, so a click there can be
    // dropped. No user clicks in a background tab, and this made the check fail one run in three.
    await collapseFromOtherTab();
    await checkSoon('a collapse reaching the narrow tab leaves its chat list showing and clickable, with no expand trigger', () => state(tabB),
      (b) => b.narrow && b.chatCollapsed && b.chatList === true && b.chatListClickable && b.chatTrigger === false);
    await chrome.send('Emulation.clearDeviceMetricsOverride', {}, pageB);
    await activateTab(ext, urlA);

    await tabA.inPanel(`root.querySelector('[data-action="set-mode"][data-mode="reduced"]').click(); return 1;`);
    await checkSoon('switching to reduced mode expands the sidebar in both tabs', async () => ({ a: await state(tabA), b: await state(tabB) }),
      ({ a, b }) => a.mode === 'mode-reduced' && b.mode === 'mode-reduced' && !a.chatCollapsed && !b.chatCollapsed);
    await collapseFromOtherTab();
    await checkSoon('reduced: a collapse arriving leaves the chat list showing and clickable, with no expand trigger', () => state(tabA),
      (a) => a.chatCollapsed && a.chatList === true && a.chatListClickable && a.chatTrigger === false);
    await tabA.clickWhenPresent('[data-action="select-chat"]', 'chat in the list');
    const inChat = await waitUntil(() => tabA.inPanel(`return { main: vis('#chat-main'), trigger: vis('.expand-sidebar-trigger') };`), (x) => x.main === true && x.trigger === false);
    await click(tabA, 'back-from-chat');
    const backAtList = await waitUntil(() => tabA.inPanel(`return vis('#chat-sidebar');`), (v) => v === true);
    check('reduced with the sidebar collapsed: open a chat and come back to the list', inChat.main === true && inChat.trigger === false && backAtList === true, { inChat, backAtList });
    return checks;
  } finally {
    await chrome.close();
  }
}
