// Multi-select in the attach picker, with the real extension. A row click still attaches one item
// and closes the picker; ticking a row's checkbox starts a selection that the footer's Attach
// button adds at once. The picker never offers more than fits: ticking stops at 10 chips in the
// composer and at 3 tabs on one message, each counting the ones already there. A note already in
// the composer is marked Attached and cannot be ticked, a tick survives a search, a full composer
// disables every row, the footer stays inside the modal on a 360px screen, 3 ticked tabs become 3
// chips at once and are then read through the worker, the tabs on the message are marked Attached
// and only the rest of the 3 can be ticked, and a second copy of a chip already in the composer is
// refused whichever path adds it.
//
// `shot`, when the caller passes one, is called at the screens worth looking at. The runner passes
// none; it exists so the same run can save screenshots.
import { wait, waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { activateTab, openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

const NOTE_COUNT = 25;
const EXTRA_TABS = 4;

export async function run({ extPath, urls, shot }) {
  const pageUrl = urls.qa;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1280,900' });
  const { chrome } = ext;
  try {
    const worker = await prepareExtension(ext);
    await chrome.evaluate(worker, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      for (let i = 1; i <= ${NOTE_COUNT}; i++) {
        const n = String(i).padStart(2, '0');
        await repo.createNote({ title: i === 13 ? 'Quarterly budget' : 'Meeting notes ' + n, body: 'Body of note ' + n + '. Agenda, owners and follow-ups.' });
      }
      return true;
    })()`);
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, mouseClick } = panelHelpers(ext, page);
    const snap = (name) => (shot ? shot(name, { chrome, page }) : null);

    const state = () => inPanel(`
      const list = root.getElementById('pk-list');
      const footer = root.getElementById('pk-footer');
      const attach = root.getElementById('pk-footer-attach');
      return {
        open: !root.getElementById('picker-overlay').classList.contains('hidden'),
        chips: root.querySelectorAll('.input-chips-row .ic').length,
        loading: root.querySelectorAll('.input-chips-row .ic[data-attach-status="loading"]').length,
        rows: list.querySelectorAll('.pk-item').length,
        ticked: list.querySelectorAll('.pk-item.is-selected').length,
        checked: list.querySelectorAll('.pk-select-cb:checked').length,
        attachedRows: list.querySelectorAll('.pk-item--attached').length,
        selecting: list.classList.contains('is-selecting'),
        full: list.classList.contains('is-full'),
        footer: footer.classList.contains('hidden') ? null : root.getElementById('pk-footer-text').textContent,
        attachShown: !attach.classList.contains('hidden'),
        attachLabel: attach.textContent
      };`);
    const action = (name) => inPanel(`root.querySelector('[data-action="${name}"]').click(); return 1;`);
    const clickIn = (selector) => inPanel(`const el = root.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 1;`);
    const row = (i) => `.pk-item[data-picker-index="${i}"]`;
    const openNotes = async () => {
      await action('open-note-picker');
      return waitUntil(state, (s) => s.open && s.rows > 0);
    };
    const search = (q) => inPanel(`const s = root.getElementById('pk-search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
    const removeAllChips = async () => {
      await inPanel(`root.querySelectorAll('.input-chips-row .ic-remove').forEach((x) => x.click()); return 1;`);
      return waitUntil(state, (s) => s.chips === 0, { timeout: 8000 });
    };

    // Opening: one page of rows, no footer, nothing marked.
    let s = await openNotes();
    check('the note picker opens with its first page of rows and no footer', s.rows === 20 && s.footer === null && s.attachedRows === 0 && !s.selecting, s);

    // Hovering a row shows its checkbox in place of the icon, and only on that row.
    const box = await inPanel(`const r = root.querySelector('${row(2)}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, page);
    const hover = await inPanel(`const cb = (i) => getComputedStyle(root.querySelector('.pk-item[data-picker-index="' + i + '"] .pk-select-cb')).opacity; const icon = (i) => getComputedStyle(root.querySelector('.pk-item[data-picker-index="' + i + '"] .pk-item-icon')).visibility; return { hoveredBox: cb(2), hoveredIcon: icon(2), otherBox: cb(3), otherIcon: icon(3) };`);
    check('hovering a row shows its checkbox instead of its icon', hover.hoveredBox === '1' && hover.hoveredIcon === 'hidden' && hover.otherBox === '0' && hover.otherIcon === 'visible', hover);
    await snap('01-hover-checkbox');

    // With nothing ticked, a click on the row attaches that one note and closes the picker.
    await mouseClick(row(0) + ' .pk-item-title');
    s = await checkSoon('a row click with nothing ticked attaches one note and closes the picker', state, (x) => !x.open && x.chips === 1);

    // That note is now marked Attached, has no checkbox, and a click on it does nothing.
    s = await openNotes();
    const attachedRow = await inPanel(`const r = root.querySelector('.pk-item--attached'); return r ? { index: r.dataset.pickerIndex, hasBox: !!r.querySelector('.pk-select-cb'), badge: (r.querySelector('.pk-tab-badge--attached') || {}).textContent || '' } : null;`);
    check('the attached note is marked Attached and has no checkbox', s.attachedRows === 1 && attachedRow && !attachedRow.hasBox && attachedRow.badge === 'Attached', { s, attachedRow });
    await clickIn(row(attachedRow ? attachedRow.index : 0));
    s = await state();
    check('a click on the attached note neither attaches it again nor closes the picker', s.open && s.chips === 1, s);

    // Ticking two rows with real clicks on the icon slot starts a selection.
    await mouseClick(row(1) + ' .pk-item-lead');
    await mouseClick(row(2) + ' .pk-item-lead');
    s = await checkSoon('ticking two rows keeps the picker open and shows the footer', state,
      (x) => x.open && x.ticked === 2 && x.checked === 2 && x.selecting && x.footer === '2 selected · room for 7 more' && x.attachShown && x.attachLabel === 'Attach 2');
    await snap('02-two-ticked');

    // Once a selection has started, a click on a row's body toggles it instead of attaching.
    await clickIn(row(3) + ' .pk-item-title');
    s = await state();
    check('during a selection a row click ticks the row', s.open && s.ticked === 3 && s.chips === 1, s);
    await clickIn(row(3) + ' .pk-item-title');
    s = await state();
    check('a second row click unticks it', s.open && s.ticked === 2, s);

    // A tick survives a search: tick the note found by a search, clear it, and all three remain.
    await search('budget');
    s = await waitUntil(state, (x) => x.rows === 1);
    check('the search narrows the list to the budget note', s.rows === 1, s);
    await clickIn(row(0) + ' .pk-item-lead');
    await search('');
    s = await waitUntil(state, (x) => x.rows === 20);
    check('ticks made before and during a search are kept when it is cleared', s.footer === '3 selected · room for 6 more' && s.ticked >= 2, s);

    // Ticking stops at the room left in the composer: 1 chip is there, so 9 may be ticked.
    // Tick unticked rows one at a time (a ticked one would be unticked) until six more are ticked.
    await inPanel(`const free = Array.from(root.querySelectorAll('#pk-list .pk-item')).filter((r) => r.querySelector('.pk-select-cb') && !r.classList.contains('is-selected')); free.slice(0, 6).forEach((r) => r.querySelector('.pk-item-lead').click()); return 1;`);
    s = await state();
    check('ticking stops at 9 with one chip already in the composer', s.footer === '9 selected · attachment limit reached (max 10)' && s.full, s);
    const refused = await inPanel(`const free = Array.from(root.querySelectorAll('#pk-list .pk-item')).filter((r) => r.querySelector('.pk-select-cb') && !r.classList.contains('is-selected')); const r = free[0]; r.querySelector('.pk-item-lead').click(); const afterLead = { ticked: r.classList.contains('is-selected'), checked: r.querySelector('.pk-select-cb').checked, opacity: getComputedStyle(r).opacity }; r.querySelector('.pk-select-cb').click(); return Object.assign(afterLead, { checkedAfterBox: r.querySelector('.pk-select-cb').checked, index: r.dataset.pickerIndex });`);
    check('a tenth tick is refused, on the slot or on the box itself, and the box is left unticked', !refused.ticked && !refused.checked && !refused.checkedAfterBox && refused.opacity === '0.5', refused);
    await clickIn(row(refused.index) + ' .pk-item-title');
    s = await state();
    check('a row click at the limit does nothing', s.open && s.footer.indexOf('9 selected') === 0 && s.chips === 1, s);
    await snap('03-limit-reached');

    // Attach adds all nine, reaching exactly 10.
    await mouseClick('#pk-footer-attach');
    s = await checkSoon('Attach adds the nine ticked notes and closes the picker', state, (x) => !x.open && x.chips === 10);

    // With a full composer every row is disabled and the footer says why.
    s = await openNotes();
    check('with 10 chips the picker opens with every row disabled and the reason shown', s.full && !s.attachShown && s.footer === 'Attachment limit reached (max 10). Remove one to add more.', s);
    const freeRow = await inPanel(`const r = root.querySelector('.pk-item:not(.pk-item--attached)'); return r ? r.dataset.pickerIndex : null;`);
    await clickIn(row(freeRow) + ' .pk-item-title');
    await clickIn(row(freeRow) + ' .pk-item-lead');
    s = await state();
    check('neither a row click nor a tick adds an eleventh chip', s.open && s.chips === 10 && s.ticked === 0, s);
    // The ten attached notes fill the top of the list, so bring the disabled rows into view.
    const dimmed = await inPanel(`const r = root.querySelector('.pk-item:not(.pk-item--attached)'); r.scrollIntoView({ block: 'center' }); return getComputedStyle(r).opacity;`);
    check('a row that is not attached is dimmed while the composer is full', dimmed === '0.5', dimmed);
    await snap('04-composer-full');
    await action('close-picker-modal');
    s = await openNotes();
    const reopenedScroll = await inPanel(`return root.getElementById('pk-list').scrollTop;`);
    check('a picker closed while scrolled opens at the top next time', reopenedScroll === 0, reopenedScroll);
    await action('close-picker-modal');
    s = await removeAllChips();
    check('the chips are removed for the next cases', s.chips === 0, s);

    // Duplicates. Whatever adds a chip, a second copy of one already in the composer is refused.
    // The page element picker in tools/contentSelector.js reaches the composer through this relay.
    const relayAdd = (chip) => inPanel(`return !!ABChatContent.ui.panelRuntime.addInputChip(${JSON.stringify(chip)});`);
    s = await openNotes();
    const noteIdForDup = Number(await inPanel(`return root.querySelector('${row(0)}').dataset.pickerKey;`));
    await action('close-picker-modal');
    const noteAdds = [
      await relayAdd({ type: 'note', kind: 'note', refId: noteIdForDup, label: 'Meeting notes 25' }),
      await relayAdd({ type: 'note', kind: 'note', refId: noteIdForDup, label: 'Same note, other label' })
    ];
    s = await state();
    check('the same note is attached once', noteAdds[0] === true && noteAdds[1] === false && s.chips === 1, { noteAdds, chips: s.chips });
    const textAdds = [
      await relayAdd({ type: 'paste', kind: 'paste', label: 'Pasted text', content: 'The same pasted text.' }),
      await relayAdd({ type: 'paste', kind: 'paste', label: 'Selected text', content: 'The same pasted text.' }),
      await relayAdd({ type: 'paste', kind: 'paste', label: 'Pasted text', content: 'Different pasted text.' })
    ];
    check('identical text is attached once, and different text is a new chip', textAdds[0] === true && textAdds[1] === false && textAdds[2] === true, textAdds);
    const pageAdds = [
      await relayAdd({ type: 'page', kind: 'page', label: 'div.card', content: '<div>Card one</div>', mimeType: 'text/html', pageUrl: pageUrl }),
      await relayAdd({ type: 'page', kind: 'page', label: 'div.card', content: '<div>Card one</div>', mimeType: 'text/html', pageUrl: pageUrl })
    ];
    s = await state();
    check('the same page element is attached once', pageAdds[0] === true && pageAdds[1] === false && s.chips === 4, { pageAdds, chips: s.chips });
    await snap('11-duplicate-refused');

    // A file uploaded twice through the real file input becomes one chip. The control, a file with
    // the same name but different text, shows the second upload would have been seen.
    const upload = (name, text) => inPanel(`const input = root.getElementById('chat-file-input'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'text/plain' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    const fileChips = () => inPanel(`const chips = Array.from(root.querySelectorAll('.input-chips-row .ic[data-attach-type="file"]')); return { count: chips.length, loading: chips.filter((c) => c.dataset.attachStatus === 'loading').length, errors: chips.filter((c) => c.dataset.attachStatus === 'error').length };`);
    await upload('brief.txt', 'Quarterly brief, first draft.');
    await checkSoon('an uploaded file becomes one chip', fileChips, (x) => x.count === 1 && x.loading === 0 && x.errors === 0, { timeout: 15000 });
    await upload('brief.txt', 'Quarterly brief, first draft.');
    await wait(500);
    const afterSecondUpload = await fileChips();
    check('uploading the same file again adds no chip', afterSecondUpload.count === 1, afterSecondUpload);
    await upload('brief.txt', 'Quarterly brief, second draft, which is longer.');
    await checkSoon('a file with the same name and a different size is a new chip', fileChips, (x) => x.count === 2 && x.loading === 0 && x.errors === 0, { timeout: 15000 });
    s = await removeAllChips();
    check('the chips are removed again', s.chips === 0, s);

    // A phone-width screen: the footer wraps its text and keeps both buttons inside the modal.
    await setViewport(360, 740);
    s = await openNotes();
    for (let i = 0; i <= 9; i++) await clickIn(row(i) + ' .pk-item-lead');
    const narrow = await inPanel(`const m = root.querySelector('.picker-modal').getBoundingClientRect(); const f = root.getElementById('pk-footer'); const fr = f.getBoundingClientRect(); const a = root.getElementById('pk-footer-attach').getBoundingClientRect(); const c = root.getElementById('pk-footer-clear').getBoundingClientRect(); const t = root.getElementById('pk-footer-text').getBoundingClientRect();
      return { vw: innerWidth, modalL: Math.round(m.left), modalR: Math.round(m.right), attachR: Math.round(a.right), clearL: Math.round(c.left), textR: Math.round(t.right), footerOverflow: f.scrollWidth > f.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth, textLines: Math.round(t.height / 16) };`);
    check('at 360px the footer keeps both buttons inside the modal and wraps its text', narrow.vw === 360 && narrow.attachR <= narrow.modalR && narrow.textR <= narrow.clearL && !narrow.footerOverflow && !narrow.pageOverflow, narrow);
    await snap('05-narrow-360');
    await mouseClick('#pk-footer-clear');
    s = await checkSoon('Clear unticks every row and hides the footer', state, (x) => x.open && x.ticked === 0 && x.footer === null && !x.selecting);
    await action('close-picker-modal');
    await setViewport(1280, 900);

    // The dark theme.
    await action('toggle-header-theme');
    await waitUntil(() => inPanel(`return root.getElementById('picker-overlay').dataset.theme;`), (v) => v === 'dark');
    s = await openNotes();
    await clickIn(row(1) + ' .pk-item-lead');
    await clickIn(row(2) + ' .pk-item-lead');
    // The row's background has a 0.1s transition, so wait for the colour it ends on.
    await checkSoon('the dark theme gives ticked rows and the footer dark colours',
      () => inPanel(`const r = root.querySelector('${row(1)}'); return { theme: root.getElementById('picker-overlay').dataset.theme, rowBg: getComputedStyle(r).backgroundColor, footerBorder: getComputedStyle(root.getElementById('pk-footer')).borderTopColor };`),
      (dark) => dark.theme === 'dark' && dark.rowBg === 'rgb(26, 61, 110)' && dark.footerBorder === 'rgb(45, 63, 86)');
    await snap('06-dark');
    await action('close-picker-modal');
    await action('toggle-header-theme');

    // Tabs: at most 3 on a message, and all 3 chips appear at once before the tabs are read.
    for (let i = 1; i <= EXTRA_TABS; i++) {
      await chrome.send('Target.createTarget', { url: pageUrl + '?tab=' + i, background: true });
    }
    await activateTab(ext, pageUrl);
    await waitUntil(async () => {
      const w = await ext.serviceWorker();
      return chrome.evaluate(w, `(async () => (await chrome.tabs.query({})).filter((t) => (t.url || '').indexOf('?tab=') !== -1 && t.status === 'complete').length)()`);
    }, (n) => n === EXTRA_TABS, { timeout: 15000 });
    await action('open-tab-picker');
    s = await waitUntil(state, (x) => x.open && x.rows >= EXTRA_TABS + 1, { timeout: 8000 });
    const tabRows = await inPanel(`const rows = Array.from(root.querySelectorAll('#pk-list .pk-item')); return { blockedWithBox: rows.filter((r) => r.classList.contains('pk-item--inaccessible') && r.querySelector('.pk-select-cb')).length, tickable: rows.filter((r) => r.querySelector('.pk-select-cb')).map((r) => r.dataset.tabIndex) };`);
    check('tab rows a page cannot be read from have no checkbox', tabRows.blockedWithBox === 0 && tabRows.tickable.length === EXTRA_TABS + 1, tabRows);
    for (const index of tabRows.tickable.slice(0, 4)) await clickIn(`.pk-item[data-tab-index="${index}"] .pk-item-lead`);
    s = await state();
    check('ticking stops at 3 tabs', s.ticked === 3 && s.full && s.footer === '3 selected · tab limit reached (max 3)', s);
    await checkSoon('every ticked tab row has the ticked background', () => inPanel(`return Array.from(root.querySelectorAll('#pk-list .pk-item.is-selected')).map((r) => getComputedStyle(r).backgroundColor);`),
      (bgs) => bgs.length === 3 && bgs.every((bg) => bg === 'rgb(219, 234, 254)'));
    await snap('07-tabs-limit');
    await mouseClick('#pk-footer-attach');
    s = await checkSoon('Attach adds all 3 tab chips at once, before any tab is read', state, (x) => !x.open && x.chips === 3 && x.loading >= 2);
    const tabChips = () => inPanel(`const chips = Array.from(root.querySelectorAll('.input-chips-row .ic[data-attach-type="tab"]')); return { chips: chips.length, loading: chips.filter((c) => c.dataset.attachStatus === 'loading').length, errors: chips.filter((c) => c.dataset.attachStatus === 'error').length, empty: chips.filter((c) => !(Number(c.dataset.attachSize) > 0)).length, urls: chips.map((c) => c.dataset.attachPageUrl), domains: chips.filter((c) => c.querySelector('.ic-domain')).length };`);
    await checkSoon('the 3 tabs are read into their chips, each with its URL', tabChips,
      (x) => x.chips === 3 && x.loading === 0 && x.errors === 0 && x.empty === 0 && new Set(x.urls).size === 3 && x.urls.every((u) => u.indexOf('/qa.html') !== -1) && x.domains === 3, { timeout: 45000 });
    await snap('08-tabs-attached');

    // The tabs on the message are marked Attached, and the limit leaves none of the others to tick.
    await action('open-tab-picker');
    s = await waitUntil(state, (x) => x.open && x.rows >= EXTRA_TABS + 1, { timeout: 8000 });
    const markedTabs = await inPanel(`const rows = Array.from(root.querySelectorAll('#pk-list .pk-item--attached')); return { count: rows.length, withBox: rows.filter((r) => r.querySelector('.pk-select-cb')).length, badges: rows.filter((r) => (r.querySelector('.pk-tab-badge--attached') || {}).textContent === 'Attached').length };`);
    check('the 3 tabs on the message are marked Attached and have no checkbox', markedTabs.count === 3 && markedTabs.withBox === 0 && markedTabs.badges === 3, markedTabs);
    check('every other tab row is disabled and the footer says why', s.full && !s.attachShown && s.footer === 'Tab limit reached (max 3). Remove a tab to add another.', s);
    const freeTab = await inPanel(`const r = root.querySelector('#pk-list .pk-item .pk-select-cb'); return r ? r.closest('.pk-item').dataset.tabIndex : null;`);
    await clickIn(`.pk-item[data-tab-index="${freeTab}"] .pk-item-title`);
    await clickIn(`.pk-item[data-tab-index="${freeTab}"] .pk-item-lead`);
    s = await state();
    check('neither a row click nor a tick adds a fourth tab', s.open && s.chips === 3 && s.ticked === 0, s);
    await snap('09-tab-limit-full');
    await action('close-picker-modal');

    // A second chip for a page already attached is refused, whatever adds it.
    const attachedUrl = await inPanel(`return root.querySelector('.input-chips-row .ic[data-attach-type="tab"]').dataset.attachPageUrl;`);
    const dupTab = await relayAdd({ type: 'tab', label: 'Same page again', pageUrl: attachedUrl });
    s = await state();
    check('a second chip for a tab already attached is refused', dupTab === false && s.chips === 3, { dupTab, chips: s.chips });

    // Removing a tab frees one place, and its row is no longer marked Attached.
    await inPanel(`root.querySelector('.input-chips-row .ic[data-attach-type="tab"] .ic-remove').click(); return 1;`);
    s = await checkSoon('one tab chip is removed', state, (x) => x.chips === 2, { timeout: 8000 });
    await action('open-tab-picker');
    s = await waitUntil(state, (x) => x.open && x.rows >= EXTRA_TABS + 1, { timeout: 8000 });
    const tickableAgain = await inPanel(`return Array.from(root.querySelectorAll('#pk-list .pk-item')).filter((r) => r.querySelector('.pk-select-cb')).map((r) => r.dataset.tabIndex);`);
    check('with 2 tabs on the message, 2 rows are marked Attached and the other 3 can be ticked', s.attachedRows === 2 && tickableAgain.length === 3, { attachedRows: s.attachedRows, tickable: tickableAgain.length });
    for (const index of tickableAgain.slice(0, 2)) await clickIn(`.pk-item[data-tab-index="${index}"] .pk-item-lead`);
    s = await state();
    check('with 2 tabs on the message ticking stops at 1', s.ticked === 1 && s.full && s.footer === '1 selected · tab limit reached (max 3)', s);
    await snap('10-one-more-tab');
    await mouseClick('#pk-footer-attach');
    await checkSoon('Attach brings the message back to 3 different tabs and no more', tabChips,
      (x) => x.chips === 3 && x.loading === 0 && x.errors === 0 && new Set(x.urls).size === 3, { timeout: 45000 });
  } finally {
    await chrome.close();
  }
  return checks;
}
