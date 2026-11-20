// view_file's pictures, drawn by the real extension in the offscreen document, where the agent loop
// runs and a canvas and pdf.js exist. The agent loop's handling of the pictures (sent once, never
// saved) is covered in Node by tests/fileView.test.js; this suite covers the drawing, which Node
// cannot do.
//
// It makes a lettered picture larger than the size limit, a nine-page PDF with the built-in writer,
// a DOCX and a deck, and looks at each through ABChatAgent.executeTool('view_file'). It checks that
// the picture is scaled to the limit, that a whole PDF comes as two contact sheets and two chosen
// pages at full size, that a DOCX and a deck are printed by Chrome without opening the consent
// window, and that with no answer about printing the call is refused at once and opens no window.
// It also makes an HTML page through the real writer and checks that it is loaded in a blank tab and
// drawn at desktop and phone width, that its uncaught error, console error and alert are reported,
// that its localStorage save works, that a page wider than a phone is reported, that a page the user
// attached is not loaded, and that with Print PDFs with Chrome off it is refused at once.
//
// Checked against the extension from before this change. As it was, the suite stops at its first
// look, since the offscreen document has no view_file rules. With agent/fileViewRules.js,
// offscreen/fileViewRender.js and the new offscreen.html added to it, so that only the tool, the
// deck drawing and the printer are old, 13 of the 17 checks fail. The four that pass there are the
// two setup checks and two that only say nothing happened (no window, no print tab left).
//
// The HTML checks fail against the extension before the page check was added, where view_file
// refuses every HTML page. With the page check but no localStorage stand-in, three of them fail:
// the page stops at line 12 with "SecurityError: Failed to read the 'localStorage' property", so
// its error on line 16, its console error and its alert never happen.
//
// Set ABCHAT_TEST_SHOTS to a folder to save every picture the model would see.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkList, startWithExtension } from '../lib/extension.mjs';
import { prepareExtension } from '../lib/panelPage.mjs';

const PRINT_MODE_KEY = 'abchatPdfPrintMode';

export async function run({ extPath }) {
  const shotsDir = process.env.ABCHAT_TEST_SHOTS || '';
  const { checks, check } = checkList();
  const ext = await startWithExtension(extPath, { windowSize: '1400,1000' });
  const { chrome } = ext;
  const save = (name, dataUrl) => {
    if (!shotsDir || typeof dataUrl !== 'string' || dataUrl.indexOf('base64,') === -1) return;
    writeFileSync(join(shotsDir, name), Buffer.from(dataUrl.split('base64,')[1], 'base64'));
  };
  try {
    const worker = await prepareExtension(ext);
    const setPrintMode = (mode) => chrome.evaluate(worker, mode
      ? `new Promise((r) => chrome.storage.local.set({ ${PRINT_MODE_KEY}: ${JSON.stringify(mode)} }, r))`
      : `new Promise((r) => chrome.storage.local.remove(${JSON.stringify(PRINT_MODE_KEY)}, r))`);
    const windowCount = () => chrome.evaluate(worker, 'new Promise((r) => chrome.windows.getAll((w) => r(w.length)))');

    const offscreenReady = await chrome.evaluate(worker, 'ensureOffscreenDocumentForServiceWorker()');
    const offscreenTarget = offscreenReady === true
      && (await chrome.send('Target.getTargets')).result.targetInfos.find((t) => t.url.indexOf(ext.extId) !== -1 && t.url.endsWith('/offscreen/offscreen.html'));
    check('the offscreen document is open', !!offscreenTarget, offscreenReady);
    const offscreen = await chrome.attach(offscreenTarget.targetId);
    check('the offscreen document loads the view_file rules and renderer',
      (await chrome.evaluate(offscreen, 'typeof ABChatAgent.fileViewRules === "object" && typeof ABChatOffscreen.fileViewRender.renderPdf === "function"')) === true);

    // ---- A picture and a PDF, with no printing ----
    await setPrintMode('basic');
    const first = await chrome.evaluate(offscreen, `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const budget = ABChatAgent.fileViewRules.createBudget();
      const decode = async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        return { mime: url.slice(5, url.indexOf(';')), width: bitmap.width, height: bitmap.height };
      };
      // A poster larger than the limit, with lettering a look should be able to read.
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1350;
      const draw = canvas.getContext('2d');
      const sky = draw.createLinearGradient(0, 0, 2400, 1350);
      sky.addColorStop(0, '#0f766e');
      sky.addColorStop(1, '#1e3a8a');
      draw.fillStyle = sky;
      draw.fillRect(0, 0, 2400, 1350);
      draw.fillStyle = '#ffffff';
      draw.font = 'bold 220px sans-serif';
      draw.textAlign = 'center';
      draw.fillText('GRAND OPENING', 1200, 640);
      draw.font = '120px sans-serif';
      draw.fillText('Saturday 10 am', 1200, 860);
      const posterUrl = canvas.toDataURL('image/png');
      const poster = await repo.createAttachmentBlob({ name: 'generated-image', kind: 'generated_image', mimeType: 'image/png', dataUrl: posterUrl, size: posterUrl.length });
      let started = performance.now();
      const image = await ABChatAgent.executeTool('view_file', { blob_id: poster.id }, { iteration: 1, viewBudget: budget });
      const imageMs = Math.round(performance.now() - started);

      // Nine pages from the built-in writer, each opening with its number.
      const blocks = [{ type: 'title', text: 'Nine pages' }];
      for (let page = 1; page <= 9; page++) {
        if (page > 1) blocks.push({ type: 'page_break' });
        blocks.push({ type: 'heading', level: 1, text: 'Section ' + page });
        blocks.push({ type: 'paragraph', text: 'This is page ' + page + '. '.repeat(1) + 'The quick brown fox jumps over the lazy dog. '.repeat(12) });
        if (page === 3) blocks.push({ type: 'table', header: true, rows: [['Item', 'Qty', 'Price'], ['Bread', '2', '4.00'], ['Milk', '1', '1.20']] });
      }
      const pdf = await ABChatAgent.executeTool('create_document', { format: 'pdf', filename: 'nine-pages', blocks: blocks }, {});
      if (!pdf.ok) return { error: 'create pdf: ' + pdf.error };
      const pdfBlob = await repo.createAttachmentBlob({ name: pdf.filename, kind: 'generated_document', mimeType: pdf.mimeType, dataUrl: pdf.dataUrl, size: pdf.size });
      started = performance.now();
      const whole = await ABChatAgent.executeTool('view_file', { blob_id: pdfBlob.id }, { iteration: 2, viewBudget: budget });
      const wholeMs = Math.round(performance.now() - started);
      started = performance.now();
      const close = await ABChatAgent.executeTool('view_file', { blob_id: pdfBlob.id, pages: [1, 9] }, { iteration: 3, viewBudget: budget });
      const closeMs = Math.round(performance.now() - started);
      const describe = async (result) => {
        if (!result || !result.ok) return { error: result && result.error };
        const pictures = [];
        for (const picture of result._viewImages || []) pictures.push(Object.assign({ label: picture.label, url: picture.dataUrl }, await decode(picture.dataUrl)));
        const copy = Object.assign({}, result);
        delete copy._viewImages;
        return { result: copy, pictures };
      };
      return {
        imageMs, wholeMs, closeMs, builtIn: /built-in PDF writer/.test(pdf.note || ''),
        image: await describe(image), whole: await describe(whole), close: await describe(close),
        budgetImages: budget.images, pdfBlobId: pdfBlob.id
      };
    })()`);
    if (!first || first.error) throw new Error('the picture and PDF steps failed: ' + JSON.stringify(first).slice(0, 400));
    console.log('info extension/fileView                   picture ' + first.imageMs + ' ms, whole PDF ' + first.wholeMs + ' ms, two pages ' + first.closeMs + ' ms');

    const image = first.image;
    check('a picture over the limit is scaled to 1536 pixels and keeps its shape',
      !!image.pictures && image.pictures.length === 1 && image.pictures[0].width === 1536 && image.pictures[0].height === 864 && image.pictures[0].mime === 'image/jpeg',
      image.pictures && image.pictures.map((p) => [p.width, p.height, p.mime]));
    check('the picture\'s result gives its own size and its label names the file', image.result && image.result.width === 2400 && image.result.height === 1350
      && image.pictures[0].label === 'generated-image (blob ' + image.result.blob_id + ')', image.result);
    const whole = first.whole;
    check('a nine-page PDF made by the built-in writer', first.builtIn && whole.result && whole.result.pages === 9, whole.result);
    check('the whole PDF comes as two contact sheets, of pages 1-6 and 7-9',
      whole.pictures && whole.pictures.length === 2 && /pages 1-6/.test(whole.pictures[0].label) && /pages 7-9/.test(whole.pictures[1].label)
      && whole.result.shown === 'pages 1-9 on 2 contact sheets of numbered thumbnails', whole.pictures && whole.pictures.map((p) => p.label));
    check('a contact sheet fits within 1500 pixels', whole.pictures && whole.pictures.every((p) => p.width <= 1500 && p.height <= 1500 && p.width > 900),
      whole.pictures && whole.pictures.map((p) => [p.width, p.height]));
    const close = first.close;
    check('two chosen pages come full size at 1400 pixels on the long edge',
      close.pictures && close.pictures.length === 2 && close.pictures.every((p) => Math.max(p.width, p.height) === 1400)
      && close.pictures[1].label === 'nine-pages.pdf (blob ' + first.pdfBlobId + '), page 9 of 9', close.pictures && close.pictures.map((p) => [p.label, p.width, p.height]));
    check('the budget counted 1 + 2 + 2 pictures', first.budgetImages === 5, first.budgetImages);
    save('view-file-picture.jpg', image.pictures && image.pictures[0].url);
    (whole.pictures || []).forEach((p, i) => save('view-file-pdf-sheet-' + (i + 1) + '.jpg', p.url));
    (close.pictures || []).forEach((p, i) => save('view-file-pdf-page-' + (i === 0 ? 1 : 9) + '.jpg', p.url));

    // ---- A DOCX and a deck, printed by Chrome ----
    const makeOffice = `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const docx = await ABChatAgent.executeTool('create_document', { format: 'docx', filename: 'brief', theme: 'modern', blocks: [
        { type: 'title', text: 'Project brief', subtitle: 'Spring launch' },
        { type: 'heading', level: 1, text: 'Goals' },
        { type: 'bullet', items: ['Open the second shop', 'Hire two bakers', 'Launch the website'] },
        { type: 'table', header: true, rows: [['Month', 'Budget', 'Owner', 'Status', 'Notes'], ['March', '4,000', 'Ana', 'Planned', 'Fit-out'], ['April', '2,500', 'Ben', 'Planned', 'Hiring']] },
        { type: 'callout', tone: 'info', title: 'Next step', text: 'Sign the lease by Friday.' }
      ] }, {});
      if (!docx.ok) return { error: 'create docx: ' + docx.error };
      const docxBlob = await repo.createAttachmentBlob({ name: docx.filename, kind: 'generated_document', mimeType: docx.mimeType, dataUrl: docx.dataUrl, size: docx.size });
      const deck = await ABChatAgent.executeTool('create_document', { format: 'pptx', filename: 'launch', theme: 'vibrant', slides: [
        { layout: 'title', title: 'Spring launch', subtitle: 'Corner Bakery' },
        { title: 'Goals', bullets: ['Second shop', 'Two bakers', 'A website'] },
        { layout: 'big_number', title: 'Sales', stats: [{ value: '42%', label: 'Growth' }, { value: '1,200', label: 'Loaves a week' }] }
      ] }, {});
      if (!deck.ok) return { error: 'create pptx: ' + deck.error };
      const deckBlob = await repo.createAttachmentBlob({ name: deck.filename, kind: 'generated_document', mimeType: deck.mimeType, dataUrl: deck.dataUrl, size: deck.size });
      globalThis.__fileViewTest = { docxBlobId: docxBlob.id, deckBlobId: deckBlob.id, drawing: deck._slideDrawing || null };
      return { docxBlobId: docxBlob.id, deckBlobId: deckBlob.id, hasDrawing: !!deck._slideDrawing };
    })()`;
    const office = await chrome.evaluate(offscreen, makeOffice);
    if (!office || office.error) throw new Error('the office steps failed: ' + JSON.stringify(office).slice(0, 400));
    check('the deck result carries its drawing', office.hasDrawing === true, office);

    const viewOffice = `(async () => {
      const t = globalThis.__fileViewTest;
      const budget = ABChatAgent.fileViewRules.createBudget();
      const viewOne = async (args, context) => {
        const started = performance.now();
        const result = await ABChatAgent.executeTool('view_file', args, Object.assign({ iteration: 1, viewBudget: budget }, context || {}));
        const ms = Math.round(performance.now() - started);
        const pictures = [];
        for (const picture of (result && result._viewImages) || []) {
          const bitmap = await createImageBitmap(await (await fetch(picture.dataUrl)).blob());
          pictures.push({ label: picture.label, url: picture.dataUrl, width: bitmap.width, height: bitmap.height });
        }
        const copy = Object.assign({}, result);
        delete copy._viewImages;
        return { ms, result: copy, pictures };
      };
      return {
        docx: await viewOne({ blob_id: t.docxBlobId }),
        deck: await viewOne({ blob_id: t.deckBlobId }, { viewSources: new Map([[t.deckBlobId, t.drawing]]) }),
        deckElsewhere: await viewOne({ blob_id: t.deckBlobId })
      };
    })()`;

    // No answer about printing yet: refused at once, with no window.
    await setPrintMode('');
    const windowsBefore = await windowCount();
    const unanswered = await chrome.evaluate(offscreen, viewOffice);
    const windowsAfter = await windowCount();
    check('with no answer about printing, a DOCX look is refused as unchecked',
      unanswered.docx.result.ok === false && /Print PDFs with Chrome is off or has not been answered/.test(unanswered.docx.result.error), unanswered.docx.result);
    check('and it opens no consent window and does not wait for one', windowsAfter === windowsBefore && unanswered.docx.ms < 5000, { windowsBefore, windowsAfter, ms: unanswered.docx.ms });

    await setPrintMode('chrome');
    const printed = await chrome.evaluate(offscreen, viewOffice);
    console.log('info extension/fileView                   DOCX ' + printed.docx.ms + ' ms, deck ' + printed.deck.ms + ' ms');
    const docx = printed.docx;
    check('a DOCX is laid out, printed by Chrome, and shown full size', docx.result.ok === true && docx.result.kind === 'docx' && docx.pictures.length === docx.result.pages
      && docx.pictures.every((p) => Math.max(p.width, p.height) === 1400), docx.result);
    check('its note says the pages are Chrome\'s drawing', /never tell the user you checked the file in Word/.test(docx.result.note || ''), docx.result.note);
    const deck = printed.deck;
    check('a deck made in this reply is printed from its drawing, one picture per slide',
      deck.result.ok === true && deck.result.pages === 3 && deck.pictures.length === 3 && /slide 3 of 3/.test(deck.pictures[2].label)
      && deck.pictures.every((p) => p.width === 1400 && Math.abs(p.height - 788) <= 1), deck.pictures.map((p) => [p.label, p.width, p.height]));
    check('a deck with no drawing in this reply is refused', printed.deckElsewhere.result.ok === false && /only in the reply that made it/.test(printed.deckElsewhere.result.error), printed.deckElsewhere.result);
    const printTabsLeft = await chrome.evaluate(worker, `new Promise((r) => chrome.tabs.query({ url: chrome.runtime.getURL('print/print.html') + '*' }, (tabs) => r(tabs.length)))`);
    check('no print tab is left open', printTabsLeft === 0, printTabsLeft);
    docx.pictures.forEach((p, i) => save('view-file-docx-page-' + (i + 1) + '.jpg', p.url));
    deck.pictures.forEach((p, i) => save('view-file-deck-slide-' + (i + 1) + '.jpg', p.url));

    // ---- An HTML page made in this chat, loaded in a blank tab ----
    // Line 16 holds the planted bug. The page also saves to localStorage, which an opaque origin
    // does not have, logs a console error, opens an alert, and has a bar wider than a phone.
    const pageLines = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Tip calculator</title>',
      '<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f6f7f9}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px}.wide{width:600px;height:40px;background:#e0a030}</style>',
      '</head>',
      '<body>',
      '<div class="card"><h1>Tip calculator</h1><p id="saved"></p><div class="wide"></div></div>',
      '<script>',
      'localStorage.setItem("tipcalc-last", "15");',
      'document.getElementById("saved").textContent = "Saved tip: " + localStorage.getItem("tipcalc-last") + "%";',
      'console.error("Rates feed unavailable");',
      'alert("Welcome!");',
      'document.getElementById("missing-button").addEventListener("click", function () {});',
      '</script>',
      '</body>',
      '</html>'
    ];
    const viewPage = `(async () => {
      const repo = ABChatShared.panelDataRepo;
      const made = await ABChatAgent.executeTool('create_document', { format: 'html', filename: 'tip-calculator', html: ${JSON.stringify(pageLines.join('\n'))} }, {});
      if (!made.ok) return { error: 'create html: ' + made.error };
      const blob = await repo.createAttachmentBlob({ name: made.filename, kind: 'generated_document', mimeType: made.mimeType, dataUrl: made.dataUrl, size: made.size, textContent: made.textContent });
      const attached = await repo.createAttachmentBlob({ name: 'their-page.html', kind: 'file', mimeType: 'text/html', dataUrl: made.dataUrl, size: made.size });
      const look = async (blobId) => {
        const started = performance.now();
        const result = await ABChatAgent.executeTool('view_file', { blob_id: blobId }, { iteration: 1, viewBudget: ABChatAgent.fileViewRules.createBudget() });
        const ms = Math.round(performance.now() - started);
        const pictures = [];
        for (const picture of (result && result._viewImages) || []) {
          const bitmap = await createImageBitmap(await (await fetch(picture.dataUrl)).blob());
          pictures.push({ label: picture.label, url: picture.dataUrl, width: bitmap.width, height: bitmap.height });
        }
        const copy = Object.assign({}, result);
        delete copy._viewImages;
        return { ms, result: copy, pictures };
      };
      globalThis.__fileViewPage = { look, blobId: blob.id, attachedId: attached.id };
      return { blobId: blob.id, attachedId: attached.id };
    })()`;
    const tabCount = () => chrome.evaluate(worker, 'new Promise((r) => chrome.tabs.query({}, (tabs) => r(tabs.length)))');
    const pageMade = await chrome.evaluate(offscreen, viewPage);
    if (!pageMade || pageMade.error) throw new Error('the page steps failed: ' + JSON.stringify(pageMade).slice(0, 400));

    await setPrintMode('basic');
    const tabsBeforeOff = await tabCount();
    const windowsBeforeOff = await windowCount();
    const pageOff = await chrome.evaluate(offscreen, 'globalThis.__fileViewPage.look(globalThis.__fileViewPage.blobId)');
    check('with Print PDFs with Chrome off, a page look is refused at once, with no tab or window',
      pageOff.result.ok === false && /An HTML page is loaded for a look/.test(pageOff.result.error) && pageOff.ms < 5000
      && (await tabCount()) === tabsBeforeOff && (await windowCount()) === windowsBeforeOff, pageOff);

    await setPrintMode('chrome');
    const tabsBefore = await tabCount();
    const attachedLook = await chrome.evaluate(offscreen, 'globalThis.__fileViewPage.look(globalThis.__fileViewPage.attachedId)');
    check('a page the user attached is not loaded', attachedLook.result.ok === false && /only HTML pages made in this chat/.test(attachedLook.result.error), attachedLook.result);
    const pageLook = await chrome.evaluate(offscreen, 'globalThis.__fileViewPage.look(globalThis.__fileViewPage.blobId)');
    const tabsAfter = await tabCount();
    console.log('info extension/fileView                   HTML page ' + pageLook.ms + ' ms');
    const pageResult = pageLook.result;
    const pageErrors = Array.isArray(pageResult.errors) ? pageResult.errors : [];
    check('a page made in this chat is loaded and drawn at desktop and phone width',
      pageResult.ok === true && pageResult.kind === 'html' && pageLook.pictures.length === 2
      && pageLook.pictures[0].width === 1280 && pageLook.pictures[0].height === 800
      && pageLook.pictures[1].height === 1400 && Math.abs(pageLook.pictures[1].width - 647) <= 1,
      { result: pageResult, pictures: pageLook.pictures.map((p) => [p.label, p.width, p.height]) });
    check('its uncaught error is reported with the line in the file', pageErrors.some((e) => /Cannot read properties of null.*\(line 16 of the page\)/.test(e)), pageErrors);
    check('its console error and its alert are reported, and the alert did not hold the load',
      pageErrors.includes('console.error: Rates feed unavailable') && pageErrors.some((e) => /opened an alert dialog saying "Welcome!"/.test(e)), pageErrors);
    check('its localStorage save works as it does from the user\'s computer', !pageErrors.some((e) => /localStorage|SecurityError/.test(e)), pageErrors);
    check('a page wider than a phone is reported', /wide in a 390 px phone window/.test(pageResult.phone_overflow || ''), pageResult.phone_overflow);
    check('no tab is left open after a page look', tabsAfter === tabsBefore, { tabsBefore, tabsAfter });
    pageLook.pictures.forEach((p, i) => save('view-file-html-' + (i === 0 ? 'desktop' : 'phone') + '.jpg', p.url));
  } finally {
    await chrome.close();
  }
  return checks;
}
