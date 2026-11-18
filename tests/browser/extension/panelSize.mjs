// The panel's size and position with the real extension. The reduced panel's card is exactly as
// wide as the element that is dragged and clamped, so a real mouse drag stops it at the left and
// right edges of the window; in a narrow window it keeps 18px from each edge. The expanded panel
// keeps 20px from each edge below an 840px window. Both stop shrinking at 300px.
//
// Checked against the code before this change, where 13 of the 16 checks fail. The reduced card
// was 600px wide inside a host the drag clamp measured as narrower, so a drag carried it past the
// right edge, and the expanded panel's 800px minimum beat its maximum below an 840px window. The
// three that pass are the expanded sizes at 1600, 1200 and 839px, which the change moved by under
// a pixel.
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, panelHelpers, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const { checks, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  try {
    await prepareExtension(ext);
    const page = await openPage(ext, pageUrl);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const { inPanel, setViewport, setMode, mouseDrag } = panelHelpers(ext, page);

    const measure = () => inPanel(`const p = host.querySelector('.panel'); const hr = host.getBoundingClientRect(); const pr = p.getBoundingClientRect(); const hd = root.querySelector('.panel-header').getBoundingClientRect();
      return { vw: innerWidth, vh: innerHeight, hostW: hr.width, panelL: pr.left, panelR: pr.right, panelW: pr.width, panelT: pr.top, panelB: pr.bottom, hdL: hd.left, hdR: hd.right, hdT: hd.top };`);
    const inside = (m) => m.panelL >= 0 && m.panelR <= m.vw + 0.5 && m.panelT >= 0 && m.panelB <= m.vh + 0.5;
    const atRight = (m) => inside(m) && Math.abs(m.panelR - m.vw) < 1;
    const atLeft = (m) => inside(m) && Math.abs(m.panelL) < 1;
    // Drags by a point in the header's top padding, which is never a button.
    const dragRight = (m) => mouseDrag(m.hdL + 6, m.hdT + 4, m.vw - 2, m.hdT + 4);
    const dragLeft = (m) => mouseDrag(m.hdR - 6, m.hdT + 4, 2, m.hdT + 4);

    await setMode('reduced');
    let m = await checkSoon('the reduced card is as wide as the element that is dragged', measure, (x) => Math.abs(x.panelW - x.hostW) < 0.5);
    m = await checkSoon('the reduced panel starts inside the window', measure, inside);
    await dragRight(m);
    m = await checkSoon('dragged right, the card stops at the right edge', measure, atRight);
    await dragLeft(m);
    m = await checkSoon('dragged left, the card stops at the left edge', measure, atLeft);

    // Back to the right edge, so the saved anchor is the right edge, then narrow the window.
    await dragRight(m);
    await setViewport(500);
    m = await checkSoon('at 500px the card shrinks to keep 18px from each edge', measure, (x) => Math.abs(x.panelW - (x.vw - 36)) < 1);
    m = await checkSoon('at 500px the card stays inside after the resize reclamp', measure, inside);
    await dragRight(m);
    m = await checkSoon('at 500px, dragged right, the card stops at the right edge', measure, atRight);
    await dragLeft(m);
    await checkSoon('at 500px, dragged left, the card stops at the left edge', measure, atLeft);
    await setViewport(320);
    await checkSoon('in a 320px window the reduced panel stops at 300px', measure, (x) => Math.abs(x.panelW - 300) < 1);

    await setViewport(1600, 1000);
    await setMode('expanded');
    await checkSoon('expanded at 1600px: 60% of the window (960px)', measure, (x) => Math.abs(x.panelW - 960) < 1);
    await setViewport(1200);
    await checkSoon('expanded at 1200px: the 800px minimum still applies', measure, (x) => Math.abs(x.panelW - 800) < 1);
    for (const width of [839, 720, 500, 390]) {
      await setViewport(width);
      await checkSoon('expanded at ' + width + 'px: 20px from each edge', measure, (x) => Math.abs(x.panelL - 20) < 1 && Math.abs(x.panelR - (width - 20)) < 1);
    }
    await setViewport(320);
    await checkSoon('in a 320px window the expanded panel stops at 300px', measure, (x) => Math.abs(x.panelW - 300) < 1);
    return checks;
  } finally {
    await ext.chrome.close();
  }
}
