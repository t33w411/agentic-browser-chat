// Starts a throwaway headless Chrome and drives it over --remote-debugging-pipe, so the browser
// suite needs nothing beyond Node and an installed Chrome. Also serves a directory over HTTP for
// the suites that load the unpacked extension, since content scripts do not run on file:// pages.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return 'google-chrome';
}

// extensionDebugging adds the flag that lets Extensions.loadUnpacked work over the pipe.
export async function launchChrome({ windowSize = '1280,900', extensionDebugging = false } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), 'abchat-browser-test-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--user-data-dir=' + profileDir, '--remote-debugging-pipe',
    '--window-size=' + windowSize
  ];
  if (extensionDebugging) args.push('--enable-unsafe-extension-debugging');
  args.push('about:blank');

  const proc = spawn(chromePath(), args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  await new Promise((resolve, reject) => {
    proc.once('spawn', resolve);
    proc.once('error', (err) => reject(new Error('Could not start Chrome at "' + chromePath() + '" (' + err.message + '). Set CHROME_PATH to its executable.')));
  });

  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  const pending = new Map();
  const events = [];
  let nextId = 1;
  let buffer = '';
  fromChrome.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!msg.id) { events.push(msg); continue; }
      const resolve = pending.get(msg.id);
      if (resolve) { pending.delete(msg.id); resolve(msg); }
    }
  });

  function send(method, params, sessionId, timeoutMs) {
    const id = nextId++;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    toChrome.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve) => {
      pending.set(id, resolve);
      if (timeoutMs) {
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); resolve({ error: { message: 'timed out: ' + method } }); }
        }, timeoutMs);
      }
    });
  }

  // Returns the value, or { error } when the expression threw or the call failed.
  async function evaluate(sessionId, expression, contextId) {
    const params = { expression, awaitPromise: true, returnByValue: true };
    if (contextId) params.contextId = contextId;
    const res = await send('Runtime.evaluate', params, sessionId, 120000);
    if (res.error) return { error: res.error.message };
    if (res.result.exceptionDetails) {
      const details = res.result.exceptionDetails;
      return { error: ((details.exception && details.exception.description) || details.text || 'exception').slice(0, 600) };
    }
    return res.result.result.value;
  }

  async function attach(targetId) {
    return (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  }

  // Chrome's helper processes can still be writing into the profile for a moment after the main
  // process exits, so removal retries, and a profile left behind never fails a run.
  async function close() {
    proc.kill('SIGKILL');
    await exited;
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (errRemove) {
      console.warn('Could not remove the temporary Chrome profile ' + profileDir + ': ' + errRemove.message);
    }
  }

  return { send, evaluate, attach, events, close };
}

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

// Serves rootDir on 127.0.0.1. The same server answers as http://localhost:port too, which the
// panel suite uses as a second origin.
export function serveDirectory(rootDir) {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = normalize(join(rootDir, pathname === '/' ? 'index.html' : pathname));
    if (!filePath.startsWith(normalize(rootDir + sep))) { res.writeHead(403).end(); return; }
    try {
      if (!statSync(filePath).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } catch (errNotFound) {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}
