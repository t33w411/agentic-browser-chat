// A Q&A list whose status badge changes class with the status, through the real extension: the
// status field lists its values, the question and date lines are not offered as a list of their
// own, and hiding the pending question hides its whole row.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

const ROW_STATES = `Array.from(document.querySelectorAll('.qa-item')).map((el) => el.dataset.status + ':' + getComputedStyle(el).display)`;

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1100' });
  const { chrome } = ext;
  try {
    const created = await chrome.send('Target.createTarget', { url: pageUrl });
    await wait(5000);
    const page = await chrome.attach(created.result.targetId);
    const call = (args) => ext.callTool(pageUrl, 'page_layout', args);
    const scan = await call({ operation: 'scan' });
    check('scan answers on a page opened right after install', scan && scan.ok, scan);
    const listed = (f) => f.values || f.examples || [];
    const qa = scan && scan.ok && scan.collections.find((c) => c.items === 4 && c.fields.some((f) => listed(f).indexOf('Answered') !== -1));
    const status = qa && qa.fields.find((f) => listed(f).indexOf('Pending') !== -1);
    check('status field lists Answered and Pending', status && status.values && status.values.indexOf('Answered') !== -1, qa || (scan && scan.collections));
    check('no collection of question and date lines', scan && scan.ok && !scan.collections.some((c) => c.items === 8 && c.fields.length === 1), scan && scan.collections && scan.collections.map((c) => c.id + ':' + c.items));
    const apply = await call({ operation: 'apply', changes: [{ action: 'filter', collection: qa && qa.id, field: status && status.field, op: 'contains', value: 'Pending', mode: 'hide', label: 'Hide the pending question' }] });
    const shown = await chrome.evaluate(page, ROW_STATES);
    check('the whole pending question row is hidden, answered ones are not', apply && apply.ok && apply.applied[0].hidden === 1 && shown.join(',') === 'answered:block,answered:block,pending:none,answered:block', { apply, shown });
    const undo = await call({ operation: 'undo' });
    const after = await chrome.evaluate(page, ROW_STATES);
    check('undo shows it again', undo && undo.ok && after.every((x) => /:block$/.test(x)), { undo, after });
    return checks;
  } finally {
    await chrome.close();
  }
}
