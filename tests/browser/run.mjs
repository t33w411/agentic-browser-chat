// Browser suite for page_layout. Opens each fixture page in tests/browser/pages in headless
// Chrome, where the page loads tools/pageLayout.js, runs its scenarios and writes
// { checks: [{ name, ok, detail }] } into #out. A page that takes ?case= lists its cases when
// opened without one. With --extension it also loads the unpacked extension and runs the suites
// in tests/browser/extension against tests/browser/site, served over HTTP.
//
//   node tests/browser/run.mjs [--extension] [--only=name,name] [--verbose]
//
// Needs an installed Chrome. Set CHROME_PATH when it is not in the default place.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, serveDirectory, wait } from './lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const withExtension = argv.includes('--extension');
const verbose = argv.includes('--verbose');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : null;

const PAGE_SUITES = ['scan-basics', 'field-variants', 'replay', 'dashboard', 'hidden-content', 'large-pages', 'flattener', 'perf'];
const EXTENSION_SUITES = ['feed', 'reload', 'qa', 'panel', 'applyAll', 'apiLogs'];
const wanted = (name) => !only || only.includes(name);

const results = [];

function record(name, checks, extra) {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  results.push({ name, passed, total: checks.length, failed });
  const line = (failed.length ? 'FAIL ' : 'ok   ') + name.padEnd(34) + (passed + '/' + checks.length).padStart(7) + (extra ? '  ' + extra : '');
  console.log(line);
  failed.forEach((c) => console.log('       x ' + c.name + (c.detail !== undefined && c.detail !== '' ? '  ' + JSON.stringify(c.detail).slice(0, 400) : '')));
}

function recordError(name, message) {
  results.push({ name, passed: 0, total: 1, failed: [{ name: 'suite ran', detail: message }] });
  console.log('FAIL ' + name.padEnd(34) + '  error: ' + String(message).slice(0, 400));
}

async function readOut(chrome, session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await chrome.evaluate(session, `(document.getElementById('out') || {}).textContent || ''`);
    if (typeof text === 'string' && text) return JSON.parse(text);
    await wait(200);
  }
  throw new Error('the page wrote no result within ' + Math.round(timeoutMs / 1000) + ' s');
}

async function openPage(chrome, name, query) {
  const url = pathToFileURL(join(HERE, 'pages', name + '.html')).href + (query || '');
  const created = await chrome.send('Target.createTarget', { url });
  const targetId = created.result.targetId;
  try {
    const session = await chrome.attach(targetId);
    return await readOut(chrome, session, 120000);
  } finally {
    await chrome.send('Target.closeTarget', { targetId });
  }
}

async function runPageSuites() {
  const suites = PAGE_SUITES.filter(wanted);
  if (!suites.length) return;
  const chrome = await launchChrome();
  try {
    for (const suite of suites) {
      const started = Date.now();
      try {
        const first = await openPage(chrome, suite);
        // Timings are machine-dependent, so they are reported and never fail the run.
        if (first.timings) {
          const timingsForReport = Object.entries(first.timings).map(([k, v]) => k + '=' + (Array.isArray(v) ? v[0] : v)).join(' ');
          console.log('info ' + suite.padEnd(34) + '         ' + timingsForReport);
          continue;
        }
        if (!first.cases) {
          if (first.error) throw new Error(first.error);
          record(suite, first.checks || [], (Date.now() - started) + ' ms');
          continue;
        }
        for (const caseName of first.cases) {
          const caseStarted = Date.now();
          const out = await openPage(chrome, suite, '?case=' + encodeURIComponent(caseName));
          if (out.error) { recordError(suite + '/' + caseName, out.error); continue; }
          const extra = (Date.now() - caseStarted) + ' ms' + (verbose && out.collections !== undefined ? '  lists: ' + out.collections + (out.note ? '  note: ' + out.note : '') : '');
          record(suite + '/' + caseName, out.checks || [], extra);
        }
      } catch (err) {
        recordError(suite, err.message);
      }
    }
  } finally {
    await chrome.close();
  }
}

async function runExtensionSuites() {
  const suites = EXTENSION_SUITES.filter(wanted);
  if (!withExtension || !suites.length) return;
  const server = await serveDirectory(join(HERE, 'site'));
  const urls = {
    feed: 'http://127.0.0.1:' + server.port + '/feed.html',
    qa: 'http://127.0.0.1:' + server.port + '/qa.html',
    feedOtherOrigin: 'http://localhost:' + server.port + '/feed.html'
  };
  try {
    for (const suite of suites) {
      const started = Date.now();
      try {
        const mod = await import('./extension/' + suite + '.mjs');
        const checks = await mod.run({ extPath: PROJECT_ROOT, urls });
        record('extension/' + suite, checks, Math.round((Date.now() - started) / 1000) + ' s');
      } catch (err) {
        recordError('extension/' + suite, err.stack || err.message);
      }
    }
  } finally {
    await server.close();
  }
}

(async () => {
  await runPageSuites();
  await runExtensionSuites();
  const failedSuites = results.filter((r) => r.failed.length);
  const totalChecks = results.reduce((n, r) => n + r.total, 0);
  const passedChecks = results.reduce((n, r) => n + r.passed, 0);
  console.log('\n' + passedChecks + '/' + totalChecks + ' checks passed in ' + results.length + ' suites' + (withExtension ? '' : ' (add --extension to run the extension suites)'));
  process.exit(failedSuites.length ? 1 : 0);
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
