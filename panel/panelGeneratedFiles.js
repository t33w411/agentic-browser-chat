// Decides which automatic file links the chat leaves out.
//
// The agent loop saves every document it makes (create_document, edit_document, eval returning
// __document__) as a display-only assistant message whose md is "[name](#abchat-docblob-N)". The
// panel merges those with the reply text that follows into one bubble, so the link shows above the
// reply. Two cases made that bubble repeat itself:
//
//   - The reply links the same file. The model often writes "I created [name](#abchat-docblob-N)",
//     and the file then appeared once above the reply and again inside it. The link in the reply is
//     kept, because it sits in the sentence that explains the file.
//   - The model made the file again while answering the same message, under the same name, to
//     reword it. Both links showed with the same label and nothing to tell them apart. Only the
//     newest is kept. The older file is not deleted; its message still references the blob.
//
// Both rules look only within one reply: the messages between two user messages. A file made in
// an earlier reply keeps its link even when a later reply mentions it or reuses its name.
//
// Hiding is the only thing this decides, and a missed match leaves a link showing. So a reply's
// link counts only when it renders as a link: text inside code is ignored, and so is image syntax.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the content script
// and exports through the CommonJS tail under Node (`module` is undefined in the browser, so that
// branch is inert there).

(function () {
  const globalScopeForGeneratedFiles = globalThis;
  const nsForGeneratedFiles = globalScopeForGeneratedFiles.ABChatContent || {};

  // Exactly the md the agent loop writes for a generated document. A generated image's marker
  // starts with "!" and never matches.
  const DISPLAY_MARKER_PATTERN_FOR_GENERATED_FILES = /^\[([^\]]*)\]\(#abchat-docblob-(\d+)\)$/;

  // A markdown link to a generated document, optionally wrapped in <> and with a title. The
  // lookbehind drops image syntax, which renders as a broken image rather than a link.
  const REPLY_LINK_PATTERN_FOR_GENERATED_FILES =
    /(?<!!)\[[^\]]*\]\(\s*<?#abchat-docblob-(\d+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

  const FENCED_CODE_PATTERN_FOR_GENERATED_FILES = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)/g;
  const INLINE_CODE_PATTERN_FOR_GENERATED_FILES = /`[^`\n]*`/g;

  function messageTextForGeneratedFiles(messageForText) {
    return String(messageForText.md || messageForText.content || '').trim();
  }

  // Only messages the chat draws count. Text attached to tool calls, and system notices, are not
  // part of the visible reply.
  function isVisibleAssistantMessageForGeneratedFiles(messageForCheck) {
    if (!messageForCheck || messageForCheck.role !== 'assistant') return false;
    if (messageForCheck.systemNotice) return false;
    if (Array.isArray(messageForCheck.tool_calls) && messageForCheck.tool_calls.length > 0) return false;
    return true;
  }

  function collectLinkedBlobIdsForGeneratedFiles(textForLinks, linkedIdsForCollect) {
    const proseForLinks = textForLinks
      .replace(FENCED_CODE_PATTERN_FOR_GENERATED_FILES, ' ')
      .replace(INLINE_CODE_PATTERN_FOR_GENERATED_FILES, ' ');
    REPLY_LINK_PATTERN_FOR_GENERATED_FILES.lastIndex = 0;
    let matchForLinks;
    while ((matchForLinks = REPLY_LINK_PATTERN_FOR_GENERATED_FILES.exec(proseForLinks)) !== null) {
      linkedIdsForCollect.add(Number(matchForLinks[1]));
    }
  }

  function addHiddenForReplyForGeneratedFiles(messagesForReply, startForReply, endForReply, hiddenForReply) {
    const markersForReply = [];
    const linkedIdsForReply = new Set();
    for (let indexForReply = startForReply; indexForReply < endForReply; indexForReply++) {
      const messageForReply = messagesForReply[indexForReply];
      if (!isVisibleAssistantMessageForGeneratedFiles(messageForReply)) continue;
      const textForReply = messageTextForGeneratedFiles(messageForReply);
      if (!textForReply) continue;
      if (messageForReply.displayOnly) {
        const markerMatchForReply = textForReply.match(DISPLAY_MARKER_PATTERN_FOR_GENERATED_FILES);
        if (markerMatchForReply) {
          markersForReply.push({
            index: indexForReply,
            blobId: Number(markerMatchForReply[2]),
            nameKey: markerMatchForReply[1].trim().toLowerCase()
          });
        }
        continue;
      }
      collectLinkedBlobIdsForGeneratedFiles(textForReply, linkedIdsForReply);
    }
    if (!markersForReply.length) return;
    const newestIndexByNameForReply = new Map();
    markersForReply.forEach(function (markerForNewest) {
      newestIndexByNameForReply.set(markerForNewest.nameKey, markerForNewest.index);
    });
    markersForReply.forEach(function (markerForHide) {
      const isLinkedForHide = linkedIdsForReply.has(markerForHide.blobId);
      const isSupersededForHide = newestIndexByNameForReply.get(markerForHide.nameKey) !== markerForHide.index;
      if (isLinkedForHide || isSupersededForHide) hiddenForReply.add(markerForHide.index);
    });
  }

  // Returns a Set of indexes into messagesForHidden whose automatic file link should not be drawn.
  function hiddenDisplayIndexesForGeneratedFiles(messagesForHidden) {
    const hiddenForMessages = new Set();
    if (!Array.isArray(messagesForHidden)) return hiddenForMessages;
    let replyStartForHidden = 0;
    for (let indexForHidden = 0; indexForHidden < messagesForHidden.length; indexForHidden++) {
      const messageForHidden = messagesForHidden[indexForHidden];
      if (messageForHidden && messageForHidden.role === 'user') {
        addHiddenForReplyForGeneratedFiles(messagesForHidden, replyStartForHidden, indexForHidden, hiddenForMessages);
        replyStartForHidden = indexForHidden + 1;
      }
    }
    addHiddenForReplyForGeneratedFiles(messagesForHidden, replyStartForHidden, messagesForHidden.length, hiddenForMessages);
    return hiddenForMessages;
  }

  nsForGeneratedFiles.generatedFileLinks = {
    hiddenDisplayIndexes: hiddenDisplayIndexesForGeneratedFiles
  };
  globalScopeForGeneratedFiles.ABChatContent = nsForGeneratedFiles;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForGeneratedFiles.generatedFileLinks;
  }
})();
