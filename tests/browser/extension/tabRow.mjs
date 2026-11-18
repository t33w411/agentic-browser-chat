// The header tab row with the real extension. When the tabs do not fit, a fade marks each edge
// that has tabs hidden past it, driven by the row's scroll position, and a mouse wheel scrolls the
// row sideways. The fades must not cover the "+ New" dropdown or block clicks, and must clear when
// the row fits again, including after it was scrolled to the end.
//
// Checked against the code before this change, where 13 of the 17 checks fail. The four that pass
// are the "+ New" dropdown and the wheel cases the handler must leave to the browser, which hold
// with no fades and no handler. With the fades' ranges ending exactly at the end of the scroll
// instead of 1px past it, the three checks that widen the window after scrolling to the end fail.
// Chrome keeps a finished scroll-driven animation's last frame once its timeline goes inactive,
// so the left fade stayed on over a row that fits.
import { wait, waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

// How long a wheel the extension leaves alone is given to do anything, before the check that it
// did nothing. The handler acts synchronously, so this only has to cover the browser's own scroll.
const UNHANDLED_WHEEL_SETTLE_MS = 300;

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;
  try {
    await prepareExtension(ext);
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, setMode } = panelHelpers(ext, page);

    // The fades follow the scroll on the next frame, so each check polls for the state it expects.
    const scrollTabs = (to) => inPanel(`const t = root.querySelector('.panel-tabs'); t.scrollLeft = ${to === 'end' ? 't.scrollWidth' : to === 'mid' ? '(t.scrollWidth - t.clientWidth) / 2' : 0}; return 1;`);
    const fades = () => inPanel(`const t = root.querySelector('.panel-tabs'); const w = root.querySelector('.panel-tabs-wrap');
      return { overflow: t.scrollWidth - t.clientWidth, scrollLeft: t.scrollLeft, start: Number(getComputedStyle(w, '::before').opacity), end: Number(getComputedStyle(w, '::after').opacity) };`);
    const bothOff = (f) => f.overflow <= 0 && f.start === 0 && f.end === 0;

    await setMode('reduced');
    await scrollTabs('start');
    await checkSoon('tabs that fit: both fades off', fades, bothOff);
    await inPanel(`root.getElementById('new-menu-btn').click(); return 1;`);
    await checkSoon('the "+ New" dropdown opens with its items on top', () => inPanel(`const d = root.getElementById('new-menu-dropdown'); const item = d.querySelector('.new-menu-item'); const r = item.getBoundingClientRect(); const hit = root.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { open: d.classList.contains('open'), hitIsItem: hit === item };`),
      (d) => d.open && d.hitIsItem);
    await inPanel(`root.getElementById('new-menu-btn').click(); return 1;`);

    await setViewport(390, 844, 2);
    await scrollTabs('start');
    await checkSoon('row scrolled to the start: right fade on, left off', fades, (f) => f.overflow > 0 && f.start === 0 && f.end === 1);
    await scrollTabs('mid');
    await checkSoon('row scrolled halfway: both fades on', fades, (f) => f.start === 1 && f.end === 1);
    await scrollTabs('end');
    await checkSoon('row scrolled to the end: left fade on, right off', fades, (f) => f.start === 1 && f.end === 0);
    const hit = await inPanel(`const w = root.querySelector('.panel-tabs-wrap').getBoundingClientRect(); const el = root.elementFromPoint(w.right - 6, w.top + 15); return el && el.closest('button') ? 'button' : (el ? el.className : null);`);
    check('a click under a fade reaches the tab beneath it', hit === 'button', hit);

    // Scrolled to the end, then widened without touching the scroll.
    await setViewport(1600, 1000, 1);
    await checkSoon('scrolled to the end, then widened until the tabs fit: both fades off', fades, bothOff);
    await setViewport(390, 844, 2);
    await checkSoon('narrowed again: the fades follow the scroll position', fades,
      (f) => f.overflow > 0 && ((f.scrollLeft === 0 && f.start === 0 && f.end === 1) || (f.scrollLeft > 0 && f.start === 1)));

    // A few pixels of overflow: the right fade is partial at the start and gone at the end.
    await setViewport(530, 844, 1);
    await scrollTabs('start');
    await checkSoon('a small overflow at the start: left off, right partly on', fades, (f) => f.overflow > 0 && f.overflow < 24 && f.start === 0 && f.end > 0 && f.end < 1);
    await scrollTabs('end');
    await checkSoon('a small overflow at the end: left on, right off', fades, (f) => f.start === 1 && f.end === 0);
    await setViewport(1600, 1000, 1);
    await checkSoon('a small overflow scrolled to the end, then widened: both fades off', fades, (f) => f.start === 0 && f.end === 0);

    // Scrolled in reduced mode, widened, then switched to expanded.
    await setViewport(390, 844, 2);
    await scrollTabs('end');
    await waitUntil(fades, (f) => f.start === 1 && f.end === 0);
    await scrollTabs('start');
    await setViewport(1600, 1000, 1);
    await setMode('expanded');
    await checkSoon('expanded in a wide window after that: both fades off', fades, bothOff);

    // Mouse wheel over the row. A window wheel listener records whether each event was cancelled.
    await setMode('reduced');
    await setViewport(390, 844, 1);
    const point = await inPanel(`const t = root.querySelector('.panel-tabs'); t.scrollLeft = 0; const r = t.getBoundingClientRect(); window.__abchatWheelLog = []; if (!window.__abchatWheelBound) { window.addEventListener('wheel', (e) => window.__abchatWheelLog.push(e.defaultPrevented), { passive: true }); window.__abchatWheelBound = true; } return { x: r.left + r.width / 2, y: r.top + r.height / 2 - 4, overflow: t.scrollWidth - t.clientWidth };`);
    const wheel = async (deltaX, deltaY, modifiers = 0) => {
      await inPanel(`window.__abchatWheelLog = []; return 1;`);
      await chrome.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY, modifiers }, page);
    };
    const wheelResult = () => inPanel(`const t = root.querySelector('.panel-tabs'); return { overflow: t.scrollWidth - t.clientWidth, scrollLeft: t.scrollLeft, prevented: window.__abchatWheelLog.slice(), pageY: window.scrollY };`);
    const leftAlone = async (name, test) => {
      await wait(UNHANDLED_WHEEL_SETTLE_MS);
      const w = await wheelResult();
      check(name, w.prevented.length === 1 && w.prevented[0] === false && test(w), w);
    };
    await wheel(0, 60);
    await checkSoon('a wheel down over a row that overflows scrolls it sideways, not the page', wheelResult, (w) => w.overflow > 0 && w.scrollLeft >= 59 && w.prevented[0] === true && w.pageY === 0);
    await wheel(0, -60);
    await checkSoon('a wheel up scrolls it back', wheelResult, (w) => w.scrollLeft === 0 && w.prevented[0] === true);
    await wheel(0, 60, 2);
    await leftAlone('Ctrl + wheel is left to the browser (zoom)', (w) => w.scrollLeft === 0);
    await wheel(40, 5);
    await leftAlone('a mostly sideways wheel is left to the browser', () => true);
    await setViewport(1600, 1000, 1);
    const widePoint = await inPanel(`const t = root.querySelector('.panel-tabs'); const r = t.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 - 4 };`);
    point.x = widePoint.x;
    point.y = widePoint.y;
    await wheel(0, 60);
    await leftAlone('a wheel over a row that fits is left alone', (w) => w.overflow <= 0 && w.scrollLeft === 0);
    return checks;
  } finally {
    await chrome.close();
  }
}
