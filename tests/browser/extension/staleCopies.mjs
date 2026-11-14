// Reloads the extension without reloading the pages, with one tab in view and one in the
// background, and checks what is left behind: only the tab in view gets a new copy of the content
// scripts, the other gets one when it is activated, and a replaced copy lets go of its globals,
// its page-level listeners and its panel by itself, so a tab's memory does not grow with reloads.
// While a tab is given its copy, its toolbar icon shows it: the tooltip says so (the only part of
// the icon a test can read back) and goes back when the copy is in.
//
// Verified against the code before the change (an export of the previous commit): seven of the
// nine checks fail there, among them "only the tab in view", "lets go by itself", "old panel" and
// "does not grow", the last with 20 MB and 26,000 DOM nodes gained over two reloads. The two
// activation checks were verified against a copy with the activation inject removed, where both
// fail and the other seven pass. The "icon says so" check was verified against a copy whose
// injection never starts the indicator, and one whose indicator is never stopped; it fails on
// both. The two "Chrome took" checks were verified against the earlier versions that
// put the normal icon back from the icon file: Chrome refuses that file as too large, the first
// check counts the refusal, and with the promise form of setIcon (which hides it) the second
// finds "Icon invalid." in the worker's log.
import { wait } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';

// A copy checks for a dead extension context every 30 s.
const SELF_RELEASE_WAIT_MS = 55000;
const HEAP_GROWTH_LIMIT_MB = 6;
const NODE_GROWTH_LIMIT = 1500;

export async function run({ extPath, urls }) {
  const backgroundUrl = urls.feed;
  const inViewUrl = urls.qa;
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1600,1000' });
  const { chrome } = ext;

  const inWorker = async (body) => chrome.evaluate(await ext.serviceWorker(), `(async () => {
    const tabs = await chrome.tabs.query({});
    const tabFor = (url) => tabs.find((t) => (t.url || '').startsWith(url));
    ${body}
  })()`);
  const activate = (url) => inWorker(`const tab = tabFor(${JSON.stringify(url)}); if (!tab) return { error: 'tab not found' }; await chrome.tabs.update(tab.id, { active: true }); return { ok: true };`);
  // Activates the tab and records each change of its toolbar tooltip until it has gone to the
  // loading text and back, or the time runs out.
  const activateWatchingTitle = (url, watchMs) => inWorker(`const tab = tabFor(${JSON.stringify(url)}); if (!tab) return { error: 'tab not found' };
    const titles = [await chrome.action.getTitle({ tabId: tab.id })];
    const baseTitle = titles[0];
    await chrome.tabs.update(tab.id, { active: true });
    const deadline = Date.now() + ${Number(watchMs)};
    while (Date.now() < deadline) {
      const title = await chrome.action.getTitle({ tabId: tab.id });
      if (title !== titles[titles.length - 1]) titles.push(title);
      if (titles.length >= 3 && title === baseTitle) break;
      await new Promise((r) => setTimeout(r, 15));
    }
    return { titles };`);
  const togglePanel = (url) => inWorker(`const tab = tabFor(${JSON.stringify(url)}); if (!tab) return { error: 'tab not found' }; await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return { ok: true };`);

  const open = async (url) => {
    const created = await chrome.send('Target.createTarget', { url });
    const session = await chrome.attach(created.result.targetId);
    await chrome.send('Runtime.enable', {}, session);
    await chrome.send('HeapProfiler.enable', {}, session);
    return session;
  };
  // One entry per copy still in the page: whether its extension context is alive, and whether it
  // still holds what it loaded.
  const copies = async (session) => {
    const out = [];
    for (const contextId of ext.isolatedContextIds(session)) {
      const state = await chrome.evaluate(session, `({
        live: (() => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } })(),
        loaded: typeof ABChatContent === 'object' && !!ABChatContent,
        libs: typeof mermaid !== 'undefined' || typeof MathJax !== 'undefined' || typeof marked !== 'undefined'
      })`, contextId);
      out.push(Object.assign({ contextId }, state));
    }
    return out;
  };
  const liveCount = (list) => list.filter((c) => c.live).length;
  const deadAndHolding = (list) => list.filter((c) => !c.live && (c.loaded || c.libs));
  const hasPanelHost = (session) => chrome.evaluate(session, `!!document.getElementById('abchat-panel-shadow-host')`);
  const usage = async (session) => {
    for (let i = 0; i < 3; i++) { await chrome.send('HeapProfiler.collectGarbage', {}, session); await wait(300); }
    const heap = await chrome.send('Runtime.getHeapUsage', {}, session);
    const dom = await chrome.send('Memory.getDOMCounters', {}, session);
    return { heapMb: Math.round(heap.result.usedSize / 104857.6) / 10, nodes: dom.result.nodes, listeners: dom.result.jsEventListeners };
  };
  const until = async (test, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await test();
      if (value || Date.now() > deadline) return value;
      await wait(2000);
    }
  };

  try {
    await wait(2500);
    await chrome.evaluate(await ext.serviceWorker(), `new Promise((r) => chrome.storage.local.set({ abchat_api_key: 'sk-or-test-not-used' }, () => chrome.storage.sync.set({ abchat_tour_done: true }, r)))`);
    const background = await open(backgroundUrl);
    const inView = await open(inViewUrl);
    await wait(5000);
    await activate(inViewUrl);
    // An open panel is prewarmed in every tab, so the background tab builds one too.
    await togglePanel(inViewUrl);
    await wait(6000);

    const startInView = await copies(inView);
    const startBackground = await copies(background);
    const backgroundHadPanel = await hasPanelHost(background);
    const usageAtStart = await usage(inView);
    check('each tab starts with one live copy and a panel', liveCount(startInView) === 1 && liveCount(startBackground) === 1 && (await hasPanelHost(inView)) && backgroundHadPanel,
      { startInView, startBackground, backgroundHadPanel });

    await chrome.send('Extensions.loadUnpacked', { path: extPath });
    await wait(8000);
    const reloadedInView = await copies(inView);
    const reloadedBackground = await copies(background);
    check('after a reload only the tab in view gets a new copy', liveCount(reloadedInView) === 1 && liveCount(reloadedBackground) === 0,
      { reloadedInView, reloadedBackground });

    // Nothing here asks the old copies to let go: their own timer has to.
    const selfReleased = await until(async () => {
      const left = deadAndHolding(await copies(inView)).concat(deadAndHolding(await copies(background)));
      return left.length === 0;
    }, SELF_RELEASE_WAIT_MS);
    check('a replaced copy lets go of what it loaded by itself', selfReleased,
      { inView: await copies(inView), background: await copies(background) });
    check('the background tab loses its old panel', !(await hasPanelHost(background)), { backgroundHadPanel });
    const liveInView = (await copies(inView)).find((c) => c.live);
    const stillWhole = liveInView && await chrome.evaluate(inView, `({
      released: ABChatContent.staleCopyRelease.check(),
      loaded: typeof ABChatContent.ui === 'object' && typeof mermaid === 'object' && typeof MathJax === 'object'
    })`, liveInView.contextId);
    check('the live copy is left alone and keeps its panel', stillWhole && stillWhole.released === false && stillWhole.loaded && (await hasPanelHost(inView)), stillWhole);

    // A second reload, with the old copy asked directly rather than waited for.
    await chrome.send('Extensions.loadUnpacked', { path: extPath });
    await wait(8000);
    const asked = [];
    for (const copy of deadAndHolding(await copies(inView))) {
      asked.push(await chrome.evaluate(inView, `ABChatContent.staleCopyRelease.check()`, copy.contextId));
    }
    const usageAfterTwo = await usage(inView);
    check('a dead copy lets go when asked', asked.length === 1 && asked[0] === true && deadAndHolding(await copies(inView)).length === 0,
      { asked, inView: await copies(inView) });
    check('the tab in view does not grow with reloads',
      usageAfterTwo.heapMb - usageAtStart.heapMb < HEAP_GROWTH_LIMIT_MB && usageAfterTwo.nodes - usageAtStart.nodes < NODE_GROWTH_LIMIT,
      { usageAtStart, usageAfterTwo });

    // With the panel closed, nothing but the activation itself can give the background tab a copy.
    await togglePanel(inViewUrl);
    await wait(2500);
    const beforeActivation = liveCount(await copies(background));
    const defaultTitle = await chrome.evaluate(await ext.serviceWorker(), `chrome.runtime.getManifest().action.default_title`);
    const indicatorStats = async () => chrome.evaluate(await ext.serviceWorker(), `ABChatBackground.injectionIndicator.getStats()`);
    const logSession = await ext.serviceWorker();
    await chrome.send('Log.enable', {}, logSession);
    const logMark = chrome.events.length;
    const statsBefore = await indicatorStats();
    const watched = await activateWatchingTitle(backgroundUrl, 12000);
    const activated = await until(async () => liveCount(await copies(background)) === 1, 20000);
    check('a background tab gets its copy when it is activated', beforeActivation === 0 && activated,
      { beforeActivation, background: await copies(background) });
    const titles = (watched && watched.titles) || [];
    check('its toolbar icon says so while the copy loads, and goes back after',
      titles.length === 3 && titles[0] === defaultTitle && titles[1] !== defaultTitle && titles[1].indexOf('loading') !== -1 && titles[2] === defaultTitle,
      watched);
    const frames = await chrome.evaluate(await ext.serviceWorker(), `ABChatBackground.injectionIndicator.getFrames().then((frames) => frames && ({
      count: frames.length,
      sizes: frames.map((f) => [f[16] && f[16].width, f[32] && f[32].width].join('/')).filter((v, i, all) => all.indexOf(v) === i),
      distinct: new Set(frames.map((f) => Array.from(f[32].data).join(','))).size
    }))`);
    // The icon cannot be read back. What can be checked is that Chrome took every change made
    // to it: the frames, and above all the normal icon set at the end, since a tab's icon can
    // only be replaced and a refused restore leaves the last frame there for good. Chrome
    // reports a refusal through runtime.lastError, which the indicator counts, and logs one
    // nobody read as an error in the worker.
    await wait(600);
    const statsAfter = await indicatorStats();
    const delta = statsBefore && statsAfter && Object.fromEntries(Object.keys(statsAfter).map((k) => [k, statsAfter[k] - statsBefore[k]]));
    check('Chrome took the animation frames and then the normal icon',
      delta && delta.framesPainted >= 5 && delta.framesRefused === 0 && delta.iconsRestored === 1 && delta.restoresRefused === 0,
      { statsBefore, statsAfter });
    const refusals = chrome.events.slice(logMark)
      .filter((e) => e.sessionId === logSession && e.method === 'Log.entryAdded' && /runtime\.lastError|Icon invalid/.test((e.params.entry && e.params.entry.text) || ''))
      .map((e) => e.params.entry.text);
    check('and reported no refused call in the worker', refusals.length === 0, refusals);
    check('the animation has a frame for each step, at both icon sizes', frames && frames.count >= 8 && frames.distinct === frames.count && frames.sizes.length === 1 && frames.sizes[0] === '16/32', frames);
    await activate(inViewUrl);
    await wait(800);
    const again = await activateWatchingTitle(backgroundUrl, 1500);
    check('a tab that already has its copy shows nothing', again && again.titles && again.titles.length === 1 && again.titles[0] === defaultTitle, again);
    const scan = await ext.callTool(backgroundUrl, 'page_layout', { operation: 'scan' });
    check('and that copy answers', scan && scan.ok, scan);
    return checks;
  } finally {
    await chrome.close();
  }
}
