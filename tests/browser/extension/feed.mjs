// page_layout on a video feed through the real extension: scan, sort and hide, the page's view of
// the result, the closed undo bar, reset, and a refused style value.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

export async function run({ extPath, urls }) {
  const pageUrl = urls.feed;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath);
  const { chrome } = ext;
  try {
    check('extension loads unpacked (manifest valid)', !!ext.extId);
    if (!ext.extId) return checks;
    const created = await chrome.send('Target.createTarget', { url: pageUrl });
    await wait(4000);
    const worker = await ext.serviceWorker();
    check('extension service worker is running', !!worker);
    const page = await chrome.attach(created.result.targetId);
    await chrome.send('Page.enable', {}, page);
    await chrome.send('Page.reload', {}, page);
    await wait(4000);
    const call = (args) => ext.callTool(pageUrl, 'page_layout', args);

    const scan = await call({ operation: 'scan' });
    check('scan through the real content script', scan && scan.ok, scan);
    const cards = scan && scan.collections && scan.collections.find((c) => c.fields.some((f) => (f.examples || f.values || []).some((e) => /views/.test(e))));
    check('card collection found in the content-script world', cards && cards.items === 8, scan && scan.collections);
    const views = cards && cards.fields.find((f) => f.kind === 'compact_number');
    const sidebar = scan && scan.regions && scan.regions.find((r) => r.kind === 'sidebar');

    const apply = await call({ operation: 'apply', changes: [
      { action: 'sort', collection: cards && cards.id, field: views && views.field, order: 'desc', label: 'Videos sorted by views' },
      { action: 'hide', target: sidebar && sidebar.id, label: 'Sidebar hidden' }
    ] });
    check('apply through the real content script', apply && apply.ok && apply.applied && apply.applied.length === 2, apply);

    const visual = await chrome.evaluate(page, `(() => {
      const order = Array.from(document.querySelectorAll('.card'))
        .map((c) => ({ n: c.dataset.name, r: c.getBoundingClientRect() }))
        .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left)).map((x) => x.n);
      return { order, sidebar: getComputedStyle(document.querySelector('aside.side')).display, bar: !!document.getElementById('abchat-layout-host') };
    })()`);
    check('page shows cards sorted by views', visual && visual.order && visual.order[0] === 'The whole documentary' && visual.order[1] === 'Travel diary: Lisbon' && visual.order[7] === 'Quiet rain sounds', visual);
    check('sidebar hidden on the page', visual && visual.sidebar === 'none', visual);
    check('undo bar present on the page', visual && visual.bar, visual);

    const pageReach = await chrome.evaluate(page, `(() => { const h = document.getElementById('abchat-layout-host'); return h ? String(h.shadowRoot) : 'no host'; })()`);
    check('page script cannot read the undo bar (closed shadow root)', pageReach === 'null', pageReach);

    const reset = await call({ operation: 'reset' });
    const afterReset = await chrome.evaluate(page, `(() => ({ sidebar: getComputedStyle(document.querySelector('aside.side')).display, bar: !!document.getElementById('abchat-layout-host') }))()`);
    check('reset restores the page', reset && reset.ok && afterReset.sidebar !== 'none' && !afterReset.bar, { reset, afterReset });

    const refused = await call({ operation: 'apply', changes: [{ action: 'style', target: sidebar && sidebar.id, css: { background: 'url(https://example.com/x.png)' } }] });
    check('url() style refused end to end', refused && refused.ok === false && /url/.test(refused.error || ''), refused);
    return checks;
  } finally {
    await chrome.close();
  }
}
