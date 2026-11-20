// Decides which automatic file links and generated pictures the chat leaves out.
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
// Generated images are saved the same way, as "![Generated image](__blob:N__)". A picture the model
// made for a document (a deck's photos, a report's cover) used to show above the reply as well,
// full size with a download button, though the user never asked for it on its own. The document
// message lists the blob ids of the pictures it holds (pictureBlobIds), and a generated image from
// the same reply that a document holds is left out. A document left out as an older copy does
// not count, because the user cannot open it from the chat.
//
// All three rules look only within one reply: the messages between two user messages. A file made
// in an earlier reply keeps its link even when a later reply mentions it or reuses its name, and a
// picture made in an earlier reply stays even when a later document uses it.
//
// Hiding is the only thing this decides about the chat, and a missed match leaves a link showing.
// So a reply's link counts only when it renders as a link: text inside code is ignored, and so is
// image syntax.
//
// It also decides which generated images of the latest reply are attached to the user's next
// message (imagesToStage). An attached image is saved on that message and sent again on every
// later request of the chat, so an image the model was already shown is not attached: the agent
// loop shows the model each image it makes for the user once, in the request after it, and marks
// the image's saved result when that request is answered. An image whose result does not say so
// (the look was refused or never sent, the image was marked for a document, or the chat is older
// than the look) is attached as before, so the model still sees it once.
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

  // Exactly the md the agent loop writes for a generated image.
  const PICTURE_MARKER_PATTERN_FOR_GENERATED_FILES = /^!\[[^\]]*\]\(__blob:(\d+)__\)$/;

  // A markdown link to a generated document, optionally wrapped in <> and with a title. The
  // lookbehind drops image syntax, which renders as a broken image rather than a link.
  const REPLY_LINK_PATTERN_FOR_GENERATED_FILES =
    /(?<!!)\[[^\]]*\]\(\s*<?#abchat-docblob-(\d+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

  // The `pictures` text the agent loop writes into a result once the model has been shown its
  // pictures: PICTURE_STATES.shown in agent/fileViewRules.js. A copy, because that file is loaded
  // only in the offscreen document; tests/generatedFileLinks.test.js fails when the two differ. Any
  // other text, including an older wording of this one, means the image is attached as before.
  const SHOWN_PICTURES_TEXT_FOR_GENERATED_FILES = 'Shown to you once, in the message after this result. Later requests leave them out, so you will not see them again. '
    + 'You looked at them then, and the note you wrote right after is your record of what you saw.';

  // The blob marker as the panel has always matched it when attaching images: anywhere in md.
  const STAGED_BLOB_PATTERN_FOR_GENERATED_FILES = /__blob:(\d+)__/;

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
    const picturesForReply = [];
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
            nameKey: markerMatchForReply[1].trim().toLowerCase(),
            pictureBlobIds: Array.isArray(messageForReply.pictureBlobIds) ? messageForReply.pictureBlobIds : []
          });
        }
        const pictureMatchForReply = textForReply.match(PICTURE_MARKER_PATTERN_FOR_GENERATED_FILES);
        if (pictureMatchForReply) {
          picturesForReply.push({ index: indexForReply, blobId: Number(pictureMatchForReply[1]) });
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
    const heldPictureIdsForReply = new Set();
    markersForReply.forEach(function (markerForHide) {
      const isLinkedForHide = linkedIdsForReply.has(markerForHide.blobId);
      const isSupersededForHide = newestIndexByNameForReply.get(markerForHide.nameKey) !== markerForHide.index;
      if (isLinkedForHide || isSupersededForHide) hiddenForReply.add(markerForHide.index);
      if (isSupersededForHide) return;
      markerForHide.pictureBlobIds.forEach(function (pictureIdForHeld) {
        heldPictureIdsForReply.add(Number(pictureIdForHeld));
      });
    });
    picturesForReply.forEach(function (pictureForHide) {
      if (heldPictureIdsForReply.has(pictureForHide.blobId)) hiddenForReply.add(pictureForHide.index);
    });
  }

  // Returns a Set of indexes into messagesForHidden whose automatic file link or picture should not
  // be drawn.
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

  function wasShownToModelForGeneratedFiles(contentForShown) {
    if (typeof contentForShown !== 'string' || contentForShown.indexOf('"pictures"') === -1) return false;
    try {
      const parsedForShown = JSON.parse(contentForShown);
      return !!parsedForShown && typeof parsedForShown === 'object'
        && parsedForShown.pictures === SHOWN_PICTURES_TEXT_FOR_GENERATED_FILES;
    } catch (errForShown) {
      return false;
    }
  }

  // Blob ids of the generated images to attach to the user's next message, in chat order: each
  // image of the latest reply (the messages after the last user message) that the chat shows and
  // the model has not been shown. The image's display message and its tool result share a
  // tool_call_id, and the result is saved before the display message.
  function imagesToStageForGeneratedFiles(messagesForStage) {
    const idsForStage = [];
    if (!Array.isArray(messagesForStage)) return idsForStage;
    let startForStage = 0;
    for (let indexForUser = messagesForStage.length - 1; indexForUser >= 0; indexForUser--) {
      const messageForUser = messagesForStage[indexForUser];
      if (messageForUser && messageForUser.role === 'user') { startForStage = indexForUser + 1; break; }
    }
    const hiddenForStage = hiddenDisplayIndexesForGeneratedFiles(messagesForStage);
    const shownCallIdsForStage = new Set();
    for (let indexForTool = startForStage; indexForTool < messagesForStage.length; indexForTool++) {
      const messageForTool = messagesForStage[indexForTool];
      if (!messageForTool || messageForTool.role !== 'tool' || messageForTool.tool_call_id == null) continue;
      if (wasShownToModelForGeneratedFiles(messageForTool.content)) shownCallIdsForStage.add(String(messageForTool.tool_call_id));
    }
    for (let indexForImage = startForStage; indexForImage < messagesForStage.length; indexForImage++) {
      const messageForImage = messagesForStage[indexForImage];
      if (!messageForImage || messageForImage.role !== 'assistant') continue;
      if (hiddenForStage.has(indexForImage)) continue;
      const matchForImage = STAGED_BLOB_PATTERN_FOR_GENERATED_FILES.exec(String(messageForImage.md || ''));
      if (!matchForImage) continue;
      const blobIdForImage = Number(matchForImage[1]);
      if (!Number.isFinite(blobIdForImage)) continue;
      if (messageForImage.tool_call_id != null && shownCallIdsForStage.has(String(messageForImage.tool_call_id))) continue;
      idsForStage.push(blobIdForImage);
    }
    return idsForStage;
  }

  nsForGeneratedFiles.generatedFileLinks = {
    hiddenDisplayIndexes: hiddenDisplayIndexesForGeneratedFiles,
    imagesToStage: imagesToStageForGeneratedFiles,
    SHOWN_PICTURES_TEXT: SHOWN_PICTURES_TEXT_FOR_GENERATED_FILES
  };
  globalScopeForGeneratedFiles.ABChatContent = nsForGeneratedFiles;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForGeneratedFiles.generatedFileLinks;
  }
})();
