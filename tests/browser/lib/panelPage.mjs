// What the panel layout suites share: preparing the extension so the panel opens without the API
// key prompt or the feature tour and with a model list, opening a page and the panel in it, and helpers bound to that
// page for running code inside the panel's shadow root, resizing the viewport and switching mode.
// Each step waits for the state it causes rather than for a fixed time, and throws when that state
// never comes, so a setup failure is reported as one rather than as a run of failed checks.
import { passes, waitUntil } from './cdp.mjs';

const SETUP_TIMEOUT_MS = 20000;

// The model list is seeded so the suites need no network and every run measures the same label:
// the default model under the name OpenRouter gives it, with its 1M token context, which the
// token counter shows as "/ 1M tok". A fresh cache entry keeps the panel from fetching the list.
const MODEL_CACHE_KEY = 'abchat_model_cache_v16';
export const DEFAULT_MODEL = { id: 'google/gemini-3.1-flash-lite', name: 'Google: Gemini 3.1 Flash Lite', promptCostPerMillion: 0.1, completionCostPerMillion: 0.4, contextLength: 1048576, supportsVision: true };
const STEP_TIMEOUT_MS = 5000;

async function settle(read, test, failure, timeout) {
  const value = await waitUntil(read, test, { timeout });
  if (!passes(test, value)) throw new Error(failure + ' within ' + timeout / 1000 + ' s: ' + JSON.stringify(value).slice(0, 300));
  return value;
}

// The worker's target appears before its scripts have run, so wait for what the suites call.
export async function waitForWorker(ext) {
  await settle(async () => {
    const workerForReady = await ext.serviceWorker();
    return workerForReady && ext.chrome.evaluate(workerForReady, `typeof toggleFloatingPanelFromActionButtonForServiceWorker === 'function' && !!(self.ABChatShared && ABChatShared.panelDataRepo)`);
  }, (v) => v === true, 'The service worker did not load', SETUP_TIMEOUT_MS);
  return ext.serviceWorker();
}

export async function prepareExtension(ext) {
  const worker = await waitForWorker(ext);
  await ext.chrome.evaluate(worker, `new Promise((r) => chrome.storage.local.set({
    abchat_api_key: 'sk-or-test-not-used',
    abchat_selected_model: ${JSON.stringify(DEFAULT_MODEL.id)},
    ${JSON.stringify(MODEL_CACHE_KEY)}: { chatModels: [${JSON.stringify(DEFAULT_MODEL)}], imageModels: [], ts: Date.now() }
  }, () => chrome.storage.sync.set({ abchat_tour_done: true }, r)))`);
  return worker;
}

// content/main.js is the last content script, and sets this marker in the extension's world.
// `previousContextId` is the world a reload or navigation replaces, which must not count.
function waitForContentScripts(ext, page, url, previousContextId) {
  return settle(async () => {
    const contextId = ext.isolatedContextId(page);
    if (!contextId || contextId === previousContextId) return 'no new extension world yet';
    return ext.chrome.evaluate(page, `typeof window.abchatMainInitNonce === 'string'`, contextId);
  }, (v) => v === true, 'The content scripts did not load in ' + url, SETUP_TIMEOUT_MS);
}

// The worker probes a tab as it becomes active, and can still load a copy of the content scripts
// into a page the suite already sees as loaded: when the page predates this extension instance, or
// when the manifest's copy takes longer than the worker waits for it. A copy that replaces another
// drops what it held, such as a page_layout scan. The extension's own paths that message a tab
// settle that through ensureContentInjected first, so the suites do too.
async function waitForWorkerInjection(ext, page) {
  const href = await ext.chrome.evaluate(page, 'location.href');
  const worker = await ext.serviceWorker();
  const done = await ext.chrome.evaluate(worker, `(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === ${JSON.stringify(href)});
    if (!tab) return 'no tab at ' + ${JSON.stringify(href)};
    return tabMessagingForServiceWorker.ensureContentInjected(tab.id);
  })()`);
  if (done !== true) throw new Error('The worker could not settle the content scripts in ' + href + ': ' + JSON.stringify(done));
}

export async function openPage(ext, url) {
  const created = await ext.chrome.send('Target.createTarget', { url });
  const page = await ext.chrome.attach(created.result.targetId);
  await ext.chrome.send('Runtime.enable', {}, page);
  await waitForContentScripts(ext, page, url, null);
  await waitForWorkerInjection(ext, page);
  return page;
}

// Reloads the page, or loads `url` in it, and waits for the new page's content scripts.
export async function reloadPage(ext, page, url) {
  const previousContextId = ext.isolatedContextId(page);
  if (url) await ext.chrome.send('Page.navigate', { url }, page);
  else await ext.chrome.send('Page.reload', {}, page);
  await waitForContentScripts(ext, page, url || 'the reloaded page', previousContextId);
  await waitForWorkerInjection(ext, page);
}

// Brings the tab to the front, as a real click on the toolbar button would.
export async function activateTab(ext, url) {
  const worker = await ext.serviceWorker();
  return ext.chrome.evaluate(worker, `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(url)})); if (!tab) return false; await chrome.tabs.update(tab.id, { active: true }); return true; })()`);
}

export async function togglePanel(ext, url) {
  await activateTab(ext, url);
  const worker = await ext.serviceWorker();
  await ext.chrome.evaluate(worker, `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(url)})); await toggleFloatingPanelFromActionButtonForServiceWorker(tab); return true; })()`);
}

// The panel is ready when its libraries have loaded and the composer gate has opened. Another
// tab builds its panel when idle, so this also waits for that.
export async function waitForPanelReady(ext, page) {
  await settle(() => ext.chrome.evaluate(page, `(() => {
    const shadowHost = document.getElementById('abchat-panel-shadow-host');
    const root = shadowHost && shadowHost.shadowRoot;
    if (!root) return 'no panel';
    const overlay = root.getElementById('abchat-libs-overlay');
    if (overlay && overlay.classList.contains('libs-error')) return 'the libraries failed to load';
    const composer = root.querySelector('.chat-textarea');
    return !!(composer && !composer.disabled && (!overlay || overlay.classList.contains('libs-ready')));
  })()`, ext.isolatedContextId(page)), (v) => v === true, 'The panel did not become ready', SETUP_TIMEOUT_MS);
}

// inPanel runs `body` as an async function in the extension's world of the page, with `root` (the
// panel's shadow root), `host` (#panel-host), `sleep(ms)` and `vis(selector)` in scope. vis is true
// when the element has a box at least 2px wide and is not fully transparent.
export function panelHelpers(ext, page) {
  const { chrome } = ext;
  const inPanel = (body) => chrome.evaluate(page, `(async () => {
    const shadowHost = document.getElementById('abchat-panel-shadow-host');
    const root = shadowHost && shadowHost.shadowRoot;
    if (!root) return { noPanel: true };
    const host = root.getElementById('panel-host');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const vis = (sel) => { const el = root.querySelector(sel); if (!el) return 'missing'; const r = el.getBoundingClientRect(); return el.getClientRects().length > 0 && r.width > 1 && getComputedStyle(el).opacity !== '0'; };
    ${body}
  })()`, ext.isolatedContextId(page));
  const inPage = (expression) => chrome.evaluate(page, expression, ext.isolatedContextId(page));

  // Waits for the page's own resize event, which comes after the panel's resize handler, since
  // that handler was added first. A tab in the background gets no resize event until it is shown,
  // so for one pass { hidden: true } and check the result after showing it.
  const setViewport = async (width, height = 900, scale = 1, { hidden = false } = {}) => {
    const size = await inPage(`({ width: innerWidth, height: innerHeight })`);
    const resizes = size && (size.width !== width || size.height !== height);
    if (resizes && !hidden) {
      await inPage(`(() => { window.__abchatSawResize = false; window.addEventListener('resize', () => { window.__abchatSawResize = true; }, { once: true }); return 1; })()`);
    }
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, page);
    if (!resizes || hidden) return;
    await settle(() => inPage(`({ width: innerWidth, height: innerHeight, sawResize: window.__abchatSawResize === true })`),
      (v) => v.width === width && v.height === height && v.sawResize, 'The page did not resize to ' + width + 'x' + height, STEP_TIMEOUT_MS);
  };
  const setMode = async (mode) => {
    await inPanel(`if (!host.classList.contains('mode-${mode}')) root.querySelector('[data-action="set-mode"][data-mode="${mode}"]').click(); return 1;`);
    return settle(() => inPanel(`return host.className;`), (v) => typeof v === 'string' && v.split(' ').includes('mode-' + mode), 'The panel did not switch to ' + mode + ' mode', STEP_TIMEOUT_MS);
  };
  const showTab = async (tab) => {
    await inPanel(`root.querySelector('.panel-tabs [data-tab="${tab}"]').click(); return 1;`);
    return settle(() => inPanel(`const view = root.getElementById('view-${tab}'); return !!view && !view.classList.contains('hidden') && view.getBoundingClientRect().width > 0;`),
      (v) => v === true, 'The ' + tab + ' tab did not open', STEP_TIMEOUT_MS);
  };
  // Clicks the first element matching `selector` once it exists, for lists the panel fills from
  // the database after it opens.
  const clickWhenPresent = (selector, what) => settle(() => inPanel(`const el = root.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true;`),
    (v) => v === true, 'No ' + what + ' to click', STEP_TIMEOUT_MS);
  // A real mouse click on the middle of the element, for controls that read the mousedown before
  // the click, as the model picker button does to know whether its menu was open. element.click()
  // fires no mousedown, so it can open that menu but never close it.
  const mouseClick = async (selector) => {
    const box = await inPanel(`const r = root.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, page);
  };
  // Each dispatch resolves once the page has handled the event, so the drag is over on return.
  const mouseDrag = async (fromX, fromY, toX, toY) => {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y: fromY }, page);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 }, page);
    for (let i = 1; i <= 10; i++) {
      await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + (toX - fromX) * i / 10, y: fromY + (toY - fromY) * i / 10, button: 'left', buttons: 1 }, page);
    }
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1 }, page);
  };
  return { inPanel, setViewport, setMode, showTab, clickWhenPresent, mouseClick, mouseDrag };
}
