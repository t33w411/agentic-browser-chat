// Markdown serializer for "copy the composer", the chips row's copy button.
//
// The panel resolves each chip to its actual text (a job only panelRuntime.js can do: it needs the
// shadow root, the blob store and the repo) and hands the results here as plain descriptors. This
// file turns them into one Markdown document, attachments first, and does nothing else.
//
// Two details are load-bearing rather than cosmetic:
//
//   - Attachment bodies are fenced with a run of backticks longer than any run inside the content.
//     Attached notes routinely contain ``` fences of their own, and a fixed three-backtick fence
//     would be closed by the first one, spilling the rest of the note into the surrounding document
//     as prose and swallowing every later section.
//   - Images carry no text at all, so they get a placeholder rather than being dropped, and that
//     placeholder states the obligation to ask for the image. A dropped attachment reads as "the
//     copy worked" while the paste is short one input; a placeholder that only reports an absence
//     leaves whoever received it (usually another assistant) free to answer around the gap. Naming
//     the follow-up is what turns the gap into a question instead of a guess.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the content script
// and exports through the CommonJS tail under Node (`module` is undefined in the browser, so that
// branch is inert there).

(function () {
  const globalScopeForComposerCopy = globalThis;
  const nsForComposerCopy = globalScopeForComposerCopy.ABChatContent || {};

  const CHIP_TYPE_LABELS_FOR_COMPOSER_COPY = {
    image: 'image',
    screenshot: 'screenshot',
    page: 'page element',
    'page-snapshot': 'page snapshot',
    tab: 'browser tab',
    file: 'file',
    note: 'note',
    chat: 'chat',
    paste: 'pasted text',
    spreadsheet: 'spreadsheet'
  };

  // Only formats a paste target can actually do something with. Everything else (a note's Markdown,
  // a flattened page, a chat transcript) is left bare so it renders as itself.
  const MIME_INFO_STRINGS_FOR_COMPOSER_COPY = {
    'text/html': 'html',
    'application/json': 'json',
    'text/csv': 'csv'
  };

  function describeChipTypeForComposerCopy(typeForDescribe, kindForDescribe) {
    const normalizedKindForDescribe = String(kindForDescribe || '').trim().toLowerCase();
    if (normalizedKindForDescribe === 'clip') return 'saved clip';
    if (normalizedKindForDescribe === 'generated_image') return 'generated image';
    const normalizedTypeForDescribe = String(typeForDescribe || '').trim().toLowerCase();
    return CHIP_TYPE_LABELS_FOR_COMPOSER_COPY[normalizedTypeForDescribe]
      || normalizedTypeForDescribe
      || 'attachment';
  }

  // A fence at least one backtick longer than the longest run in the content, and never under the
  // three the syntax requires.
  function fenceForContentForComposerCopy(contentForFence) {
    const runsForFence = String(contentForFence || '').match(/`+/g) || [];
    let longestForFence = 2;
    for (let runIndexForFence = 0; runIndexForFence < runsForFence.length; runIndexForFence++) {
      if (runsForFence[runIndexForFence].length > longestForFence) {
        longestForFence = runsForFence[runIndexForFence].length;
      }
    }
    return new Array(longestForFence + 2).join('`');
  }

  function buildSourceLineForComposerCopy(attachmentForSource) {
    const titleForSource = String(attachmentForSource.pageTitle || '').trim();
    const urlForSource = String(attachmentForSource.pageUrl || '').trim();
    if (titleForSource && urlForSource) return '- Source: ' + titleForSource + ' (' + urlForSource + ')';
    if (urlForSource) return '- Source: ' + urlForSource;
    if (titleForSource) return '- Source: ' + titleForSource;
    return '';
  }

  function buildAttachmentBodyForComposerCopy(attachmentForBody) {
    if (attachmentForBody.missing) {
      const missingLabelForBody = String(attachmentForBody.missingType || '').trim() || 'source';
      return 'Content unavailable: this ' + missingLabelForBody
        + ' was deleted after it was attached.';
    }
    if (attachmentForBody.isImage) {
      return 'This ' + describeChipTypeForComposerCopy(attachmentForBody.type, attachmentForBody.kind)
        + ' is not included: image data cannot be carried in a text copy.'
        + ' If it has not been provided to you separately, ask for it before answering anything'
        + ' that depends on what it shows.';
    }
    const contentForBody = String(attachmentForBody.content || '');
    if (!contentForBody.trim()) {
      return 'No text content available for this attachment.';
    }
    const fenceForBody = fenceForContentForComposerCopy(contentForBody);
    const infoStringForBody = MIME_INFO_STRINGS_FOR_COMPOSER_COPY[
      String(attachmentForBody.mimeType || '').trim().toLowerCase()
    ] || '';
    // The trailing newline is stripped first so content that already ends in one does not open a
    // blank line between it and the closing fence.
    return fenceForBody + infoStringForBody + '\n'
      + contentForBody.replace(/\n+$/, '') + '\n'
      + fenceForBody;
  }

  function renderAttachmentSectionForComposerCopy(attachmentForRender, positionForRender) {
    const safeAttachmentForRender = attachmentForRender && typeof attachmentForRender === 'object'
      ? attachmentForRender
      : {};
    const labelForRender = String(safeAttachmentForRender.label || '').trim() || 'Attachment';
    const metaLinesForRender = [
      '- Type: ' + describeChipTypeForComposerCopy(safeAttachmentForRender.type, safeAttachmentForRender.kind)
    ];
    const sourceLineForRender = buildSourceLineForComposerCopy(safeAttachmentForRender);
    if (sourceLineForRender) metaLinesForRender.push(sourceLineForRender);

    return '### ' + positionForRender + '. ' + labelForRender + '\n\n'
      + metaLinesForRender.join('\n') + '\n\n'
      + buildAttachmentBodyForComposerCopy(safeAttachmentForRender);
  }

  // { text, attachments: [{ label, type, kind, mimeType, pageUrl, pageTitle, content, isImage,
  // missing, missingType }] } -> one Markdown document. Returns '' when there is nothing to copy,
  // which is the caller's cue to say so rather than to write an empty clipboard.
  function buildComposerMarkdownForComposerCopy(inputForBuild) {
    const safeInputForBuild = inputForBuild && typeof inputForBuild === 'object' ? inputForBuild : {};
    const messageTextForBuild = String(safeInputForBuild.text || '').trim();
    const attachmentsForBuild = Array.isArray(safeInputForBuild.attachments)
      ? safeInputForBuild.attachments
      : [];

    // With nothing attached there is nothing for a heading to separate, so the typed message is
    // copied bare. Wrapping it would make the plainest case the noisiest one to paste.
    if (attachmentsForBuild.length === 0) return messageTextForBuild;

    const sectionsForBuild = ['## Attachments (' + attachmentsForBuild.length + ')'];
    for (let attachmentIndexForBuild = 0; attachmentIndexForBuild < attachmentsForBuild.length; attachmentIndexForBuild++) {
      sectionsForBuild.push(renderAttachmentSectionForComposerCopy(
        attachmentsForBuild[attachmentIndexForBuild],
        attachmentIndexForBuild + 1
      ));
    }
    if (messageTextForBuild) {
      sectionsForBuild.push('## Message');
      sectionsForBuild.push(messageTextForBuild);
    }
    return sectionsForBuild.join('\n\n');
  }

  nsForComposerCopy.composerCopy = {
    describeChipType: describeChipTypeForComposerCopy,
    fenceForContent: fenceForContentForComposerCopy,
    buildComposerMarkdown: buildComposerMarkdownForComposerCopy
  };
  globalScopeForComposerCopy.ABChatContent = nsForComposerCopy;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForComposerCopy.composerCopy;
  }
})();
