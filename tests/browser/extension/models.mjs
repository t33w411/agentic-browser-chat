// The model selects with the real extension. There is no hard-coded model list to fall back on and
// no image model is picked for the user: with no API key, or no list loaded, each select says why
// and keeps the saved model; a saved image model that is not in the list is still shown.
//
// Checked against the code before this change, where 9 of the 12 model list checks fail. With no key the
// selects held the hard-coded lists and google/gemini-3.1-flash-lite was saved as the image model.
// A saved image model missing from the list showed "-- Choose a model --". With the list
// unavailable, the composer select held the built-in default instead of the saved chat model, so
// a send would have used the wrong model. The three checks on a loaded list pass against both.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

const NO_KEY_TEXT = 'Add your OpenRouter API key to load models';
const LOAD_FAILED_TEXT = 'Could not load the model list. Open Settings to try again.';
const CACHE_KEY = 'abchat_model_cache_v16';

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  const inWorker = async (expr) => chrome.evaluate(await ext.serviceWorker(), expr);
  try {
    await wait(2500);
    await inWorker(`new Promise((r) => chrome.storage.sync.set({ abchat_tour_done: true }, r))`);
    const created = await chrome.send('Target.createTarget', { url: pageUrl });
    await wait(5000);
    const page = await chrome.attach(created.result.targetId);
    await chrome.send('Runtime.enable', {}, page);
    await inWorker(`(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(pageUrl)})); await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return true; })()`);
    await wait(3500);
    const ctx = ext.isolatedContextId(page);
    const selects = () => chrome.evaluate(page, `(() => {
      const root = document.getElementById('abchat-panel-shadow-host').shadowRoot;
      const read = (id) => {
        const sel = root.getElementById(id);
        if (!sel) return null;
        const options = Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled }));
        const picked = sel.options[sel.selectedIndex];
        return { value: sel.value, selectedText: picked ? picked.textContent : '', options };
      };
      const empty = root.getElementById('model-picker-empty');
      return { chat: read('chat-model-select'), settings: read('settings-default-model-select'), image: read('settings-image-model-select'), pickerEmpty: empty ? empty.textContent : null };
    })()`, ctx);
    const savedImageModel = () => inWorker(`new Promise((r) => chrome.storage.local.get('abchat_selected_image_model', (v) => r(v.abchat_selected_image_model || '')))`);

    // No API key and no cached list.
    const noKey = await selects();
    check('with no key, the chat select says to add a key and keeps the default chat model',
      noKey.chat && noKey.chat.options.length === 2 && noKey.chat.options[0].disabled && noKey.chat.options[0].text === NO_KEY_TEXT
        && noKey.chat.value === 'google/gemini-3.1-flash-lite', noKey.chat);
    check('with no key, the settings default select matches', noKey.settings && noKey.settings.options[0].text === NO_KEY_TEXT && noKey.settings.value === 'google/gemini-3.1-flash-lite', noKey.settings);
    check('with no key, the image select only says to add a key', noKey.image && noKey.image.options.length === 1 && noKey.image.options[0].disabled && noKey.image.options[0].text === NO_KEY_TEXT, noKey.image);
    check('with no key, the model picker says to add a key', noKey.pickerEmpty === NO_KEY_TEXT, noKey.pickerEmpty);
    check('with no key, no image model is saved', (await savedImageModel()) === '', await savedImageModel());

    // A loaded list, and no image model saved.
    const list = {
      chatModels: [
        { id: 'testvendor/chat-a', name: 'Chat A', promptCostPerMillion: 0.1, completionCostPerMillion: 0.4, supportsVision: true },
        { id: 'testvendor/chat-b', name: 'Chat B', promptCostPerMillion: 1, completionCostPerMillion: 4, supportsVision: true }
      ],
      imageModels: [
        { id: 'google/gemini-test-image', name: 'Gemini Test Image', imageCost: null, completionCostPerMillion: 2, created: 2 },
        { id: 'testvendor/image-b', name: 'Image B', imageCost: 0.04, completionCostPerMillion: null, created: 1 }
      ]
    };
    await inWorker(`new Promise((r) => chrome.storage.local.set({ ${JSON.stringify(CACHE_KEY)}: Object.assign(${JSON.stringify(list)}, { ts: Date.now() }) }, () => chrome.storage.local.set({ abchat_api_key: 'sk-or-test-not-used' }, r)))`);
    await wait(1500);
    const loaded = await selects();
    check('with a list loaded, the chat select lists it with no notice', loaded.chat && loaded.chat.options.every((o) => !o.disabled) && loaded.chat.options.some((o) => o.value === 'testvendor/chat-a'), loaded.chat);
    check('with a list loaded, the image select asks for a choice', loaded.image && loaded.image.value === '' && loaded.image.selectedText === '-- Choose a model --', loaded.image);
    check('with a list loaded, no image model is picked for the user', (await savedImageModel()) === '', await savedImageModel());
    check('with a list loaded, the picker notice is back to its search text', loaded.pickerEmpty === 'No matching models', loaded.pickerEmpty);

    // A saved image model the list does not include.
    await inWorker(`new Promise((r) => chrome.storage.local.set({ abchat_selected_image_model: 'retiredvendor/old-image' }, r))`);
    await wait(1500);
    const unlisted = await selects();
    check('a saved image model missing from the list is still shown as selected', unlisted.image && unlisted.image.value === 'retiredvendor/old-image' && /not in the current list/.test(unlisted.image.selectedText), unlisted.image);

    // The composer's model picker with a list too long to fit, and the current model near its end.
    // Checked against two earlier versions. Before the picker scrolled, it opened at the top with
    // the current model out of view, and the open and clear checks fail. Once it scrolled but
    // before it took keys, no row was ever highlighted, and the ten checks that need a highlighted
    // row fail. The search check passes against both. It guards against a search starting where
    // the centred list was left.
    const longChatList = [];
    for (let i = 1; i <= 60; i++) {
      longChatList.push({ id: 'testvendor/chat-' + String(i).padStart(2, '0'), name: 'Chat ' + i, promptCostPerMillion: i / 10, completionCostPerMillion: i, supportsVision: true });
    }
    const currentModel = 'testvendor/chat-55';
    await inWorker(`new Promise((r) => chrome.storage.local.set({ ${JSON.stringify(CACHE_KEY)}: { chatModels: ${JSON.stringify(longChatList)}, imageModels: ${JSON.stringify(list.imageModels)}, ts: Date.now() } }, () => chrome.storage.local.set({ abchat_selected_model: ${JSON.stringify(currentModel)} }, r)))`);
    await wait(1500);
    const picker = (action) => chrome.evaluate(page, `(() => {
      const root = document.getElementById('abchat-panel-shadow-host').shadowRoot;
      ${action}
      const listEl = root.getElementById('model-picker-list');
      const item = root.querySelector('.mp-item[data-model-id=${JSON.stringify(currentModel)}]');
      if (!listEl || !item) return { missing: true };
      const lr = listEl.getBoundingClientRect();
      const ir = item.getBoundingClientRect();
      const hl = listEl.querySelector('.mp-item.highlighted');
      const hr = hl ? hl.getBoundingClientRect() : null;
      const search = root.getElementById('model-picker-search');
      const focused = root.activeElement;
      return {
        open: root.getElementById('model-picker-dropdown').classList.contains('open'),
        scrollTop: listEl.scrollTop,
        listHeight: listEl.clientHeight,
        // A pixel of slack for fractional layout. A row scrolled fully to the end of the list can
        // still overhang it by a fraction of a pixel.
        inView: ir.top >= lr.top - 1 && ir.bottom <= lr.bottom + 1,
        offCentre: Math.round(Math.abs((ir.top + ir.bottom) / 2 - (lr.top + lr.bottom) / 2)),
        rowHeight: Math.round(ir.height),
        highlighted: hl ? hl.dataset.modelId : null,
        highlightCount: listEl.querySelectorAll('.mp-item.highlighted').length,
        activeDescendantMatches: !!hl && search.getAttribute('aria-activedescendant') === hl.id,
        highlightInView: !!hr && hr.top >= lr.top - 1 && hr.bottom <= lr.bottom + 1,
        chatModel: root.getElementById('chat-model-select').value,
        focus: focused ? (focused.id || focused.className) : null
      };
    })()`, ctx);
    const press = (key) => `root.getElementById('model-picker-search').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, composed: true, cancelable: true }));`;
    const highlightedAt = (state, id) => state.open && state.highlighted === id && state.highlightCount === 1 && state.activeDescendantMatches && state.highlightInView;
    const opened = await picker(`root.getElementById('model-picker-btn').click();`);
    check('the model picker opens with the current model centred in view and highlighted',
      opened.open && opened.scrollTop > 0 && opened.inView && opened.offCentre <= opened.rowHeight && highlightedAt(opened, currentModel), opened);
    const searched = await picker(`const s = root.getElementById('model-picker-search'); s.value = 'chat'; s.dispatchEvent(new Event('input', { bubbles: true }));`);
    check('a search in the model picker starts at the top of the results', searched.open && searched.scrollTop === 0, searched);
    const cleared = await picker(`root.querySelector('.mp-search-clear').click();`);
    check('clearing the search goes back to the current model', cleared.open && cleared.inView && cleared.offCentre <= cleared.rowHeight && highlightedAt(cleared, currentModel), cleared);

    // Keys, pressed in the search box, which keeps focus while the picker is open.
    const down = await picker(press('ArrowDown'));
    check('Down moves the highlight to the next model', highlightedAt(down, 'testvendor/chat-56'), down);
    const up = await picker(press('ArrowUp') + press('ArrowUp'));
    check('Up moves the highlight to the previous model', highlightedAt(up, 'testvendor/chat-54'), up);
    const pagedTwice = await picker(press('PageDown') + press('PageDown'));
    check('Page Down moves a listful and stops at the last model', highlightedAt(pagedTwice, 'testvendor/chat-60'), pagedTwice);
    const wrapped = await picker(press('ArrowDown'));
    check('Down on the last model wraps to the first, scrolled into view', highlightedAt(wrapped, 'testvendor/chat-01'), wrapped);
    const hovered = await picker(`root.querySelector('.mp-item[data-model-id="testvendor/chat-03"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 7, clientY: 7 }));`);
    check('moving the pointer over a row moves the same highlight', highlightedAt(hovered, 'testvendor/chat-03'), hovered);
    const narrowed = await picker(`const s = root.getElementById('model-picker-search'); s.value = 'chat 1'; s.dispatchEvent(new Event('input', { bubbles: true }));`);
    check('a search highlights its first result', highlightedAt(narrowed, 'testvendor/chat-01'), narrowed);
    const chosen = await picker(press('ArrowUp') + press('Enter'));
    check('Enter picks the highlighted model, closes the picker and returns to the message box',
      !chosen.open && chosen.chatModel === 'testvendor/chat-19' && chosen.focus === 'chat-textarea', chosen);
    const escaped = await picker(`root.getElementById('model-picker-btn').click();` + press('Escape'));
    check('Esc closes the picker without changing the model and returns focus to its button',
      !escaped.open && escaped.chatModel === 'testvendor/chat-19' && escaped.focus === 'model-picker-btn', escaped);

    // The list cannot load: no cache, and the fetch fails.
    await chrome.evaluate(page, `(() => { globalThis.ABChatAgent.client.fetchRawModels = async () => { throw new Error('offline'); }; return true; })()`, ctx);
    await inWorker(`new Promise((r) => chrome.storage.local.remove(${JSON.stringify(CACHE_KEY)}, () => chrome.storage.local.set({ abchat_selected_model: 'testvendor/saved-chat' }, r)))`);
    await wait(1500);
    const failed = await selects();
    check('when the list cannot load, the chat select says so and keeps the saved chat model',
      failed.chat && failed.chat.options[0].disabled && failed.chat.options[0].text === LOAD_FAILED_TEXT && failed.chat.value === 'testvendor/saved-chat', failed.chat);
    check('when the list cannot load, the image select keeps the saved image model', failed.image && failed.image.options[0].text === LOAD_FAILED_TEXT && failed.image.value === 'retiredvendor/old-image', failed.image);
    return checks;
  } finally {
    await chrome.close();
  }
}
