// HTML files with pictures, and file links in the chat, with the real extension.
//
// In the offscreen document, where the agent loop runs and a canvas exists, the suite draws a
// 2000 x 1400 photo and a small logo with transparency, saves both as blobs, and makes a page that
// names them with create_document, then changes it with edit. The photo has to come out smaller
// and as JPEG, the logo as it was, and both copies of the file have to hold both pictures while
// their saved source keeps the abchat-blob:N names. The chat is then seeded the way the agent loop
// saves a reply, and the panel's file links are clicked with real mouse events: a file is fetched
// only when its link is clicked, a 5 MB file downloads whole, and a link to a file that is gone
// says so instead of changing the page's address.
//
// Verified against the extension from before this change, where 14 of the 26 checks fail. The
// picture checks fail because the file kept every placeholder. Opening the chat read every file
// and put each one whole into its link's href (the 5 MB file's link held 6,990,540 characters).
// The link to a missing file was left as plain text, and clicking it changed the page's address to
// #abchat-docblob-999999. The two downloads, the 5 MB file arriving whole, and the photo left out
// of the chat pass there too, since the old links downloaded from a data: URL and decks already
// listed their pictures.
//
// Set ABCHAT_TEST_SHOTS to a folder to save screenshots of the chat, the missing-file notice and
// the downloaded page.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome, wait, waitUntil } from '../lib/cdp.mjs';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { openPage, prepareExtension, togglePanel, waitForPanelReady } from '../lib/panelPage.mjs';

const BIG_FILE_BYTES = 5 * 1024 * 1024;
// How long a click that must download nothing is given, before the check that it did not.
const NO_DOWNLOAD_SETTLE_MS = 1500;

export async function run({ extPath, urls }) {
  const pageUrl = urls.qa;
  const shotsDir = process.env.ABCHAT_TEST_SHOTS || '';
  const { checks, check, checkSoon } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1400,1000' });
  const { chrome } = ext;
  const downloadDir = mkdtempSync(join(tmpdir(), 'abchat-downloads-'));
  const shoot = async (session, name) => {
    if (!shotsDir) return;
    const shot = await chrome.send('Page.captureScreenshot', { format: 'png' }, session);
    if (shot.result && shot.result.data) writeFileSync(join(shotsDir, name), Buffer.from(shot.result.data, 'base64'));
  };
  const click = async (session, x, y) => {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, session);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, session);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, session);
  };
  const downloadsNamed = (name) => {
    const begun = chrome.events.filter((e) => e.method === 'Browser.downloadWillBegin' && e.params.suggestedFilename === name).map((e) => e.params.guid);
    return chrome.events.filter((e) => e.method === 'Browser.downloadProgress' && begun.includes(e.params.guid) && e.params.state === 'completed').map((e) => e.params.guid);
  };
  try {
    const worker = await prepareExtension(ext);
    await chrome.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true });

    // ---- The writer and edit, in the offscreen document ----
    const offscreenReady = await chrome.evaluate(worker, 'ensureOffscreenDocumentForServiceWorker()');
    const offscreenTarget = offscreenReady === true
      && (await chrome.send('Target.getTargets')).result.targetInfos.find((t) => t.url.indexOf(ext.extId) !== -1 && t.url.endsWith('/offscreen/offscreen.html'));
    check('the offscreen document is open', !!offscreenTarget, offscreenReady);
    const offscreen = await chrome.attach(offscreenTarget.targetId);
    const made = await chrome.evaluate(offscreen, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      // A photo: gradients and soft shapes with fine noise, so a PNG of it stays large.
      const photoCanvas = document.createElement('canvas');
      photoCanvas.width = 2000;
      photoCanvas.height = 1400;
      const photo = photoCanvas.getContext('2d');
      const sky = photo.createLinearGradient(0, 0, 2000, 1400);
      sky.addColorStop(0, '#f6d365');
      sky.addColorStop(1, '#c0392b');
      photo.fillStyle = sky;
      photo.fillRect(0, 0, 2000, 1400);
      for (let i = 0; i < 40; i++) {
        photo.fillStyle = 'hsla(' + (i * 37 % 360) + ', 60%, 55%, 0.35)';
        photo.beginPath();
        photo.arc((i * 211) % 2000, (i * 137) % 1400, 80 + (i * 13) % 160, 0, Math.PI * 2);
        photo.fill();
      }
      const pixels = photo.getImageData(0, 0, 2000, 1400);
      let seed = 7;
      for (let p = 0; p < pixels.data.length; p += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const n = (seed % 13) - 6;
        pixels.data[p] += n; pixels.data[p + 1] += n; pixels.data[p + 2] += n;
      }
      photo.putImageData(pixels, 0, 0);
      const photoUrl = photoCanvas.toDataURL('image/png');
      // A logo on a transparent background.
      const logoCanvas = document.createElement('canvas');
      logoCanvas.width = 160;
      logoCanvas.height = 160;
      const logo = logoCanvas.getContext('2d');
      logo.fillStyle = '#7b3f00';
      logo.beginPath();
      logo.arc(80, 80, 70, 0, Math.PI * 2);
      logo.fill();
      logo.fillStyle = '#ffffff';
      logo.font = 'bold 64px sans-serif';
      logo.textAlign = 'center';
      logo.fillText('B', 80, 102);
      const logoUrl = logoCanvas.toDataURL('image/png');
      const photoBlob = await repo.createAttachmentBlob({ name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: photoUrl, size: photoUrl.length });
      const logoBlob = await repo.createAttachmentBlob({ name: 'logo.png', kind: 'file', mimeType: 'image/png', dataUrl: logoUrl, size: logoUrl.length });
      const P = photoBlob.id;
      const L = logoBlob.id;
      const page = [
        '<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">', '<title>Corner Bakery</title>',
        '<style>',
        'body { margin: 0; font-family: Georgia, serif; background: #fff8f0; color: #3b2414; }',
        '.hero { position: relative; }',
        '.hero img { display: block; width: 100%; height: 420px; object-fit: cover; }',
        '.brand { position: absolute; left: 32px; bottom: 24px; display: flex; align-items: center; gap: 16px; color: #fff; }',
        '.logo { width: 80px; height: 80px; background-image: url(abchat-blob:' + L + '); background-size: contain; }',
        'main { max-width: 720px; margin: 0 auto; padding: 24px 20px; }',
        '#badge { width: 40px; vertical-align: middle; }',
        '</style>', '</head>', '<body>',
        '<div class="hero"><img id="photo" src="abchat-blob:' + P + '" alt="Loaves on a counter">',
        '<div class="brand"><div class="logo" id="logo"></div><h1>Corner Bakery</h1></div></div>',
        '<main><p><img id="badge" alt="">Fresh bread daily, from six in the morning.</p></main>',
        '<script>var badgeForPage = \\'abchat-blob:' + L + '\\'; document.getElementById(\\'badge\\').src = badgeForPage;</script>',
        '</body>', '</html>'
      ].join('\\n');
      const started = performance.now();
      const created = await ABChatAgent.executeTool('create_document', { format: 'html', filename: 'bakery', html: page }, {});
      const createMs = Math.round(performance.now() - started);
      if (!created.ok) return { error: created.error };
      const fileText = (result) => new TextDecoder().decode(Uint8Array.from(atob(result.dataUrl.split(',')[1]), (c) => c.charCodeAt(0)));
      const pictureIn = async (text, before) => {
        const at = text.indexOf(before);
        if (at === -1) return null;
        const start = at + before.length;
        const url = text.slice(start, text.indexOf(before.endsWith('(') ? ')' : (before.endsWith("'") ? "'" : '"'), start));
        if (url.indexOf('data:') !== 0) return { mime: 'not embedded: ' + url.slice(0, 40), bytes: 0, width: 0, height: 0, url };
        const bytes = atob(url.split(',')[1]).length;
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        return { mime: url.slice(5, url.indexOf(';')), bytes, width: bitmap.width, height: bitmap.height, url };
      };
      const describe = async (result) => {
        const text = fileText(result);
        const photo = await pictureIn(text, '<img id="photo" src="');
        const logoCss = await pictureIn(text, 'background-image: url(');
        const badge = await pictureIn(text, "var badgeForPage = '");
        return {
          size: result.size, sizeMatches: result.size === new TextEncoder().encode(text).length,
          pictureBlobIds: result.pictureBlobIds, warnings: result.warnings || [],
          placeholdersLeft: (text.match(/abchat-blob:/g) || []).length,
          sourceKeepsNames: result.textContent.includes('src="abchat-blob:' + P + '"') && result.textContent.includes('url(abchat-blob:' + L + ')'),
          photo: photo && { mime: photo.mime, bytes: photo.bytes, width: photo.width, height: photo.height },
          logoCssIsOriginal: !!logoCss && logoCss.url === logoUrl,
          badgeIsOriginal: !!badge && badge.url === logoUrl,
          text
        };
      };
      const createdInfo = await describe(created);
      // Saved as the agent loop saves a file, then changed with edit.
      const createdBlob = await repo.createAttachmentBlob({ name: created.filename, kind: 'generated_document', mimeType: created.mimeType, dataUrl: created.dataUrl, size: created.size, textContent: created.textContent });
      const edited = await ABChatAgent.executeTool('edit', { type: 'attachment', id: createdBlob.id, rev: created.rev, old_string: 'Fresh bread daily', new_string: 'Fresh bread every morning' }, {});
      if (!edited.ok) return { error: 'edit: ' + edited.error };
      const editedInfo = await describe(edited);
      const editedHasChange = editedInfo.text.includes('Fresh bread every morning');
      delete editedInfo.text;
      const editedBlob = await repo.createAttachmentBlob({ name: edited.filename, kind: 'generated_document', mimeType: edited.mimeType, dataUrl: edited.dataUrl, size: edited.size, textContent: edited.textContent });
      // A large file with no pictures, to download through a link.
      const bigText = '<!DOCTYPE html><meta charset="utf-8"><title>Big</title><pre>' + 'x'.repeat(${BIG_FILE_BYTES} - 70) + '</pre>';
      const bigBytes = new TextEncoder().encode(bigText);
      let bigBinary = '';
      for (let o = 0; o < bigBytes.length; o += 0x8000) bigBinary += String.fromCharCode.apply(null, bigBytes.subarray(o, o + 0x8000));
      const bigBlob = await repo.createAttachmentBlob({ name: 'big.html', kind: 'generated_document', mimeType: 'text/html;charset=utf-8', dataUrl: 'data:text/html;charset=utf-8;base64,' + btoa(bigBinary), size: bigBytes.length, textContent: bigText });
      delete createdInfo.text;
      return {
        P, L, createMs, originalPhotoBytes: atob(photoUrl.split(',')[1]).length,
        created: createdInfo, edited: editedInfo, editedHasChange,
        createdBlobId: createdBlob.id, editedBlobId: editedBlob.id, bigBlobId: bigBlob.id, bigSize: bigBytes.length
      };
    })()`);
    if (!made || made.error) throw new Error('the offscreen steps failed: ' + JSON.stringify(made).slice(0, 400));
    console.log('info extension/generatedFiles             create ' + made.createMs + ' ms; photo ' + made.originalPhotoBytes + ' bytes as PNG, '
      + (made.created.photo ? made.created.photo.bytes + ' bytes as ' + made.created.photo.mime + ' at ' + made.created.photo.width + 'x' + made.created.photo.height : 'not embedded')
      + '; file ' + made.created.size + ' bytes');

    const c = made.created;
    check('the file holds every picture: no placeholder is left in it', c.placeholdersLeft === 0, c);
    check('the large photo went in as a JPEG of at most 1600 pixels, smaller than the PNG',
      !!c.photo && c.photo.mime === 'image/jpeg' && Math.max(c.photo.width, c.photo.height) === 1600 && c.photo.bytes < made.originalPhotoBytes, c.photo);
    check('the small logo with transparency went in as it was, in the CSS and in the script', c.logoCssIsOriginal && c.badgeIsOriginal, c);
    // In the order the page names them: the logo's CSS comes first.
    check('the result lists the pictures, warns of nothing, and gives the file\'s size',
      JSON.stringify(c.pictureBlobIds) === JSON.stringify([made.L, made.P]) && c.warnings.length === 0 && c.sizeMatches, c);
    check('the saved source keeps the abchat-blob names', c.sourceKeepsNames, c);
    const e = made.edited;
    check('the edited copy holds the change and both pictures', made.editedHasChange && e.placeholdersLeft === 0 && !!e.photo && e.photo.mime === 'image/jpeg' && e.logoCssIsOriginal && e.badgeIsOriginal, e);
    check('the edited copy lists its pictures and keeps the names in its source', JSON.stringify(e.pictureBlobIds) === JSON.stringify([made.L, made.P]) && e.sourceKeepsNames, e);

    // ---- The chat, seeded as the agent loop saves a reply ----
    const chatId = await chrome.evaluate(worker, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const chat = await repo.createChat({ title: 'Bakery page', type: 'chat' });
      const add = (m, touch) => repo.createMessage(chat.id, m, { touchChat: !!touch });
      const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      await add({ role: 'user', content: 'Make a page for my bakery with a photo', md: 'Make a page for my bakery with a photo' });
      await add({ role: 'assistant', content: '', md: '', tool_calls: [call('call_img', 'generate_image', { prompt: 'loaves' })] });
      await add({ role: 'tool', tool_call_id: 'call_img', content: '{"ok":true}', md: '' });
      await add({ role: 'assistant', content: '', md: '![Generated image](__blob:${made.P}__)', displayOnly: true, tool_call_id: 'call_img' });
      await add({ role: 'assistant', content: '', md: '', tool_calls: [call('call_doc', 'create_document', { format: 'html', filename: 'bakery' })] });
      await add({ role: 'tool', tool_call_id: 'call_doc', content: '{"ok":true}', md: '' });
      await add({ role: 'assistant', content: '', md: '[bakery.html](#abchat-docblob-${made.createdBlobId})', displayOnly: true, tool_call_id: 'call_doc', pictureBlobIds: [${made.P}, ${made.L}] });
      await add({ role: 'assistant', content: 'Your page is ready.', md: 'Your page is ready.' });
      await add({ role: 'user', content: 'Say every morning', md: 'Say every morning' });
      await add({ role: 'assistant', content: '', md: '', tool_calls: [call('call_edit', 'edit', { type: 'attachment', id: ${made.createdBlobId} })] });
      await add({ role: 'tool', tool_call_id: 'call_edit', content: '{"ok":true}', md: '' });
      await add({ role: 'assistant', content: '', md: '[bakery.html](#abchat-docblob-${made.editedBlobId})', displayOnly: true, tool_call_id: 'call_edit', pictureBlobIds: [${made.P}, ${made.L}] });
      await add({ role: 'assistant', content: 'Changed.', md: 'Changed.' });
      await add({ role: 'user', content: 'And the big one, and the old one', md: 'And the big one, and the old one' });
      await add({ role: 'assistant', content: 'Here they are: [big.html](#abchat-docblob-${made.bigBlobId}) and [gone.html](#abchat-docblob-999999).', md: 'Here they are: [big.html](#abchat-docblob-${made.bigBlobId}) and [gone.html](#abchat-docblob-999999).' }, true);
      return chat.id;
    })()`);
    check('the test chat was saved', Number.isFinite(chatId), chatId);

    // ---- The panel ----
    const page = await openPage(ext, pageUrl);
    await chrome.send('Page.enable', {}, page);
    await togglePanel(ext, pageUrl);
    await waitForPanelReady(ext, page);
    const ctx = ext.isolatedContextId(page);
    const inPanel = (body) => chrome.evaluate(page, `(async () => { const shadowHost = document.getElementById('abchat-panel-shadow-host'); const root = shadowHost && shadowHost.shadowRoot; if (!root) return { noPanel: true }; ${body} })()`, ctx);
    // Every blob the panel reads from here on, and every notice it shows.
    await chrome.evaluate(page, `(() => {
      const repo = ABChatShared.panelDataRepo;
      const read = repo.getAttachmentBlob;
      window.__abchatBlobReads = [];
      repo.getAttachmentBlob = function (id) { window.__abchatBlobReads.push(Number(id)); return read.apply(this, arguments); };
      const toast = ABChatContent.ui.toast;
      const show = toast.show;
      window.__abchatToasts = [];
      toast.show = function (message) { window.__abchatToasts.push(String(message)); return show.apply(this, arguments); };
      return true;
    })()`, ctx);
    await checkSoon('the chat opened', () => inPanel(`const item = root.querySelector('[data-action="select-chat"][data-chat-id="${chatId}"]'); if (!item) return { noItem: true }; item.click(); return { clicked: true };`), (o) => o && o.clicked);
    const linkState = () => inPanel(`return Array.from(root.querySelectorAll('#chat-messages-content a.generated-document-link')).map((a) => ({ text: a.textContent.trim(), hrefStart: (a.getAttribute('href') || '').slice(0, 30), hrefChars: (a.getAttribute('href') || '').length }));`);
    const links = await checkSoon('the four file links are drawn', linkState, (l) => Array.isArray(l) && l.length === 4);
    check('opening the chat put no file in a link', Array.isArray(links) && links.length > 0 && links.every((l) => l.hrefStart.indexOf('data:') !== 0 && l.hrefChars < 100), links);
    await wait(300);
    const readsOnOpen = await chrome.evaluate(page, 'window.__abchatBlobReads.slice()', ctx);
    const fileIds = [made.createdBlobId, made.editedBlobId, made.bigBlobId, 999999];
    check('opening the chat fetched no file', readsOnOpen.every((id) => fileIds.indexOf(id) === -1), readsOnOpen);
    check('the photo the page holds is not drawn in the chat, or fetched', readsOnOpen.indexOf(made.P) === -1
      && (await inPanel(`return root.querySelectorAll('#chat-messages-content img').length;`)) === 0, readsOnOpen);
    await shoot(page, 'chat-with-file-links.png');

    const hashBefore = await chrome.evaluate(page, 'location.href');
    // Clicks the last link with this text with a real mouse event, once it has held still and nothing
    // covers it. Links are found by their text because the old panel replaced each href.
    const clickLink = async (name) => {
      let last = null;
      const spot = await waitUntil(async () => {
        const at = await inPanel(`const named = Array.from(root.querySelectorAll('#chat-messages-content a')).filter((l) => l.textContent.trim() === ${JSON.stringify(name)}); const a = named[named.length - 1]; if (!a) return null; a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); const x = r.left + Math.min(r.width / 2, 30); const y = r.top + r.height / 2; const hit = root.elementFromPoint(x, y); return { x, y, hit: !!hit && (hit === a || a.contains(hit)) };`);
        const key = at ? at.x + ',' + at.y : null;
        const still = key !== null && key === last;
        last = key;
        return { at, still };
      }, (v) => v.still && v.at.hit);
      if (!spot.at || !spot.at.hit) return false;
      await click(page, spot.at.x, spot.at.y);
      return true;
    };

    check('the newest copy\'s link was clicked', await clickLink('bakery.html'));
    const editedGuids = await checkSoon('clicking the newest copy downloads bakery.html', () => downloadsNamed('bakery.html'), (g) => g.length === 1, { timeout: 15000 });
    if (editedGuids.length === 1) {
      const downloaded = readFileSync(join(downloadDir, editedGuids[0]), 'utf8');
      check('the download is the edited page with its pictures in it', downloaded.includes('Fresh bread every morning') && !downloaded.includes('abchat-blob:') && downloaded.includes('src="data:image/jpeg;base64,'), downloaded.slice(0, 300));
      // Opened from disk as the user would, the photo, the CSS logo and the script's badge all show.
      const opened = join(downloadDir, 'bakery.html');
      copyFileSync(join(downloadDir, editedGuids[0]), opened);
      const tab = await chrome.send('Target.createTarget', { url: pathToFileURL(opened).href });
      const tabSession = await chrome.attach(tab.result.targetId);
      await chrome.send('Page.enable', {}, tabSession);
      const shown = await waitUntil(() => chrome.evaluate(tabSession, `(() => {
        const photo = document.getElementById('photo');
        const badge = document.getElementById('badge');
        const logo = document.getElementById('logo');
        return { photo: !!photo && photo.complete && photo.naturalWidth, badge: !!badge && badge.complete && badge.naturalWidth, logoBackground: logo ? getComputedStyle(logo).backgroundImage.slice(0, 30) : '' };
      })()`), (s) => s && s.photo > 0 && s.badge > 0, { timeout: 10000 });
      check('opened from disk, the page shows the photo, the CSS logo and the script\'s badge', shown && shown.photo === 1600 && shown.badge === 160 && shown.logoBackground.indexOf('url("data:image/png') === 0, shown);
      await chrome.send('Target.closeTarget', { targetId: tab.result.targetId });
    }
    const readsAfterClick = await chrome.evaluate(page, 'window.__abchatBlobReads.slice()', ctx);
    check('the click fetched that one file once', readsAfterClick.filter((id) => id === made.editedBlobId).length === 1
      && readsAfterClick.filter((id) => id === made.createdBlobId).length === 0, readsAfterClick);

    check('the 5 MB file\'s link was clicked', await clickLink('big.html'));
    const bigGuids = await checkSoon('clicking the 5 MB file downloads big.html', () => downloadsNamed('big.html'), (g) => g.length === 1, { timeout: 20000 });
    if (bigGuids.length === 1) {
      const bigOnDisk = await waitUntil(() => { try { return statSync(join(downloadDir, bigGuids[0])).size; } catch (errStat) { return 0; } }, (n) => n === made.bigSize, { timeout: 5000 });
      check('the 5 MB file arrived whole', bigOnDisk === made.bigSize, { bigOnDisk, expected: made.bigSize });
    }

    check('the gone file\'s link was clicked', await clickLink('gone.html'));
    await checkSoon('a link to a file that is gone says so', () => chrome.evaluate(page, 'window.__abchatToasts.slice()', ctx), (t) => Array.isArray(t) && t.some((m) => /no longer available/.test(m)));
    await shoot(page, 'missing-file-notice.png');
    await wait(NO_DOWNLOAD_SETTLE_MS);
    check('it downloads nothing', downloadsNamed('gone.html').length === 0 && chrome.events.filter((e) => e.method === 'Browser.downloadWillBegin').length === 2,
      chrome.events.filter((e) => e.method === 'Browser.downloadWillBegin').map((e) => e.params.suggestedFilename));
    check('no click changed the page\'s address', (await chrome.evaluate(page, 'location.href')) === hashBefore, await chrome.evaluate(page, 'location.href'));

    // The downloaded page on its own, for the screenshot, in a Chrome without the extension: in this
    // one the panel is drawn over every tab while it is open in any.
    if (shotsDir && editedGuids.length === 1) {
      const plain = await launchChrome({ windowSize: '1400,1000' });
      try {
        const tab = await plain.send('Target.createTarget', { url: pathToFileURL(join(downloadDir, 'bakery.html')).href });
        const tabSession = await plain.attach(tab.result.targetId);
        await plain.send('Page.enable', {}, tabSession);
        await waitUntil(() => plain.evaluate(tabSession, `(() => { const photo = document.getElementById('photo'); return !!photo && photo.complete && photo.naturalWidth > 0; })()`), (v) => v === true, { timeout: 10000 });
        const shot = await plain.send('Page.captureScreenshot', { format: 'png' }, tabSession);
        if (shot.result && shot.result.data) writeFileSync(join(shotsDir, 'downloaded-page.png'), Buffer.from(shot.result.data, 'base64'));
      } finally {
        await plain.close();
      }
    }
  } finally {
    await chrome.close();
    rmSync(downloadDir, { recursive: true, force: true });
  }
  return checks;
}
