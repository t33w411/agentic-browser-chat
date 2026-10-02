// Loads the unpacked extension into a fresh headless Chrome and reaches the page tools the way the
// agent does: the service worker sends runDelegatedPageTool to the tab's content scripts.
import { launchChrome, wait } from './cdp.mjs';

export async function startWithExtension(extPath, { windowSize } = {}) {
  const chrome = await launchChrome({ windowSize, extensionDebugging: true });
  const loaded = await chrome.send('Extensions.loadUnpacked', { path: extPath });
  const extId = loaded.result && loaded.result.id;

  // The worker can restart, so look it up for every call rather than holding one session.
  async function serviceWorker() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const targets = (await chrome.send('Target.getTargets')).result.targetInfos;
      const worker = targets.find((t) => t.type === 'service_worker' && t.url.indexOf(extId) !== -1);
      if (worker) return chrome.attach(worker.targetId);
      await wait(250);
    }
    return null;
  }

  async function callTool(pageUrlPrefix, tool, args, { chatId = 1, toolCallId = 'tc1' } = {}) {
    const worker = await serviceWorker();
    if (!worker) return { error: 'no service worker' };
    return chrome.evaluate(worker, `(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(pageUrlPrefix)}));
      if (!tab) return { error: 'tab not found' };
      return await new Promise((resolve) => chrome.tabs.sendMessage(tab.id, {
        action: 'runDelegatedPageTool', tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)},
        chatId: ${JSON.stringify(chatId)}, runId: 'browser-test', toolCallId: ${JSON.stringify(toolCallId)}, iteration: 1
      }, (resp) => resolve(resp || { error: 'no response: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message) })));
    })()`);
  }

  // The content-script world of this extension in the page, for reading ABChatContent directly.
  function isolatedContextId(pageSession) {
    const destroyed = new Set(chrome.events
      .filter((e) => e.sessionId === pageSession && e.method === 'Runtime.executionContextDestroyed')
      .map((e) => e.params.executionContextId));
    const contexts = chrome.events
      .filter((e) => e.sessionId === pageSession && e.method === 'Runtime.executionContextCreated')
      .map((e) => e.params.context)
      .filter((c) => c.origin && c.origin.indexOf(extId) !== -1 && !destroyed.has(c.id));
    return contexts.length ? contexts[contexts.length - 1].id : null;
  }

  return { chrome, extId, serviceWorker, callTool, isolatedContextId };
}

export function checkList() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  return { checks, check };
}
