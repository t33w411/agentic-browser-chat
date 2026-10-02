// Applies page_layout changes, reloads the extension without reloading the page, and checks that
// the orphaned copy reverts its own changes and removes its bar.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

export async function run({ extPath, urls }) {
  const pageUrl = urls.feed;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath);
  const { chrome } = ext;
  try {
    await wait(3000);
    const created = await chrome.send('Target.createTarget', { url: pageUrl });
    await wait(4000);
    const page = await chrome.attach(created.result.targetId);
    const call = (args) => ext.callTool(pageUrl, 'page_layout', args);
    const scan = await call({ operation: 'scan' });
    const cards = scan && scan.ok && scan.collections.find((c) => c.items === 8);
    const views = cards && cards.fields.find((f) => f.kind === 'compact_number');
    const side = scan && scan.ok && scan.regions.find((r) => r.kind === 'sidebar');
    const apply = await call({ operation: 'apply', changes: [
      { action: 'sort', collection: cards && cards.id, field: views && views.field, order: 'desc' },
      { action: 'hide', target: side && side.id }
    ] });
    const state = () => chrome.evaluate(page, `({ side: getComputedStyle(document.querySelector('aside.side')).display, bar: !!document.getElementById('abchat-layout-host'), orders: Array.from(document.querySelectorAll('.card')).map((c) => c.style.order).join(',') })`);
    const before = await state();
    check('changes applied before the reload', apply && apply.ok && before.side === 'none' && before.bar && /-/.test(before.orders), { scan: scan && scan.ok, apply, before });
    await chrome.send('Extensions.loadUnpacked', { path: extPath });
    await wait(5000);
    const after = await state();
    check('old copy reverted its changes after the extension reload', after.side !== 'none' && !after.bar && after.orders.replace(/,/g, '') === '', after);
    const rescan = await call({ operation: 'scan' });
    check('the new copy answers in the same tab', rescan && rescan.ok, rescan);
    return checks;
  } finally {
    await chrome.close();
  }
}
