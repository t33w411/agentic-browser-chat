// What makes two composer chips the same attachment.
//
// addInputChipForPanelRuntime refuses a new chip whose key matches a chip already in the composer,
// and the attach picker marks a row Attached when its record or tab has a chip there. Both ask
// keyFor, so the two cannot disagree about what counts as a duplicate.
//
// A chip is keyed by what identifies it at the moment it is added, because uploads and tabs are
// added as loading chips before their content exists:
//
//   - note (clips included) and chat: the record id.
//   - tab: the tab's URL. The same page open in two tabs is one attachment.
//   - file and image uploads: the name and byte size, which the chip has while loading and keeps
//     after. Two uploads of one file make two separate blobs, so the blob id cannot tell them apart.
//     An image added from the page has no size until it has loaded, so it gets no key while loading.
//   - a generated image: its blob id.
//   - a chip that carries its text (pasted text, selected text, a page element, a spreadsheet):
//     the type and the exact text. agent/contextBuilder.js sends byte-identical text once per
//     conversation by the same test.
//   - a screenshot: no key. Each capture is a new picture of whatever is on screen.
//
// An empty key means "never a duplicate". Nothing here touches the DOM or chrome.*, so it loads as
// an ordinary IIFE in the content script and exports through the CommonJS tail under Node.

(function () {
  const globalScopeForChipIdentity = globalThis;
  const nsForChipIdentity = globalScopeForChipIdentity.ABChatContent || {};

  const SEP_FOR_CHIP_IDENTITY = '\u0000';

  function positiveIdForChipIdentity(valueForId) {
    const numberForId = Number(valueForId);
    return Number.isFinite(numberForId) && numberForId > 0 ? numberForId : 0;
  }

  function keyForChipIdentity(chipForKey) {
    if (!chipForKey || typeof chipForKey !== 'object') return '';
    const typeForKey = String(chipForKey.type || '').trim();
    const kindForKey = String(chipForKey.kind || '').trim();
    if (!typeForKey || typeForKey === 'screenshot' || kindForKey === 'screenshot') return '';
    if (typeForKey === 'note' || typeForKey === 'chat') {
      const recordIdForKey = positiveIdForChipIdentity(chipForKey.refId);
      return recordIdForKey ? typeForKey + SEP_FOR_CHIP_IDENTITY + recordIdForKey : '';
    }
    if (typeForKey === 'tab') {
      const urlForKey = String(chipForKey.pageUrl || '').trim();
      return urlForKey ? 'tab' + SEP_FOR_CHIP_IDENTITY + urlForKey : '';
    }
    if (kindForKey === 'generated_image') {
      const blobIdForKey = positiveIdForChipIdentity(chipForKey.refId);
      return blobIdForKey ? 'generated_image' + SEP_FOR_CHIP_IDENTITY + blobIdForKey : '';
    }
    if (typeForKey === 'file' || typeForKey === 'image') {
      const nameForKey = String(chipForKey.label || '').trim();
      const sizeForKey = positiveIdForChipIdentity(chipForKey.size);
      return nameForKey && sizeForKey
        ? typeForKey + SEP_FOR_CHIP_IDENTITY + nameForKey + SEP_FOR_CHIP_IDENTITY + sizeForKey
        : '';
    }
    const contentForKey = String(chipForKey.content || '');
    return contentForKey ? typeForKey + SEP_FOR_CHIP_IDENTITY + contentForKey : '';
  }

  // The first chip in `existingChips` that is the same attachment as `candidate`, or null.
  function findDuplicateForChipIdentity(existingChipsForFind, candidateForFind) {
    const keyForFind = keyForChipIdentity(candidateForFind);
    if (!keyForFind || !Array.isArray(existingChipsForFind)) return null;
    for (let indexForFind = 0; indexForFind < existingChipsForFind.length; indexForFind++) {
      if (keyForChipIdentity(existingChipsForFind[indexForFind]) === keyForFind) return existingChipsForFind[indexForFind];
    }
    return null;
  }

  nsForChipIdentity.chipIdentity = {
    keyFor: keyForChipIdentity,
    findDuplicate: findDuplicateForChipIdentity
  };
  globalScopeForChipIdentity.ABChatContent = nsForChipIdentity;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForChipIdentity.chipIdentity;
  }
})();
