// Which automatic file links the chat leaves out (panel/panelGeneratedFiles.js).
//
// The first test replays the chat that showed the problem: a deck made twice under one name, then
// a reply that links the second copy. Before this change the bubble showed the file name three
// times. Verified against the code without this module (nothing hidden): every test that expects
// a hidden index fails. Also verified against three broken variants of the module, each failing
// the named test: without the code stripping, "a link inside code"; without the per-reply scope,
// "a link in a later reply"; without the "!" lookbehind, "image syntax".
//
// The tests from "pictures a deck holds" on cover generated images that a document holds. They
// replay the chat that showed the problem: two photos made for a deck showed full size above the
// reply. Verified against the module before pictureBlobIds was read: the tests that expect a
// hidden picture fail. Also verified against a variant that counts a superseded document, which
// fails "an older copy". Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const generatedFileLinksForTest = require('../panel/panelGeneratedFiles.js');

function userMessageForTest(text) {
  return { role: 'user', content: text, md: text };
}

function toolCallMessageForTest(callId, name) {
  return {
    role: 'assistant',
    content: '',
    md: '',
    tool_calls: [{ id: callId, type: 'function', function: { name: name, arguments: '{}' } }]
  };
}

function toolResultMessageForTest(callId) {
  return { role: 'tool', tool_call_id: callId, content: '{"ok":true}', md: '' };
}

function fileLinkMessageForTest(callId, filename, blobId) {
  return {
    role: 'assistant',
    content: '',
    md: '[' + filename + '](#abchat-docblob-' + blobId + ')',
    displayOnly: true,
    tool_call_id: callId
  };
}

function pictureMessageForTest(callId, blobId) {
  return { role: 'assistant', content: '', md: '![Generated image](__blob:' + blobId + '__)', displayOnly: true, tool_call_id: callId };
}

function documentMessageForTest(callId, filename, blobId, pictureBlobIds) {
  const messageForDocument = fileLinkMessageForTest(callId, filename, blobId);
  messageForDocument.pictureBlobIds = pictureBlobIds;
  return messageForDocument;
}

function replyMessageForTest(text) {
  return { role: 'assistant', content: text, md: text };
}

function hiddenIndexesForTest(messagesForTest) {
  return Array.from(generatedFileLinksForTest.hiddenDisplayIndexes(messagesForTest)).sort(function (a, b) { return a - b; });
}

test('the remade deck and the linked copy are both left out, so the file shows once', function () {
  const messagesForTest = [
    userMessageForTest('Create a powerpoint slide of why I would be a great fit for this'),
    toolCallMessageForTest('c1', 'create_document'),
    toolResultMessageForTest('c1'),
    fileLinkMessageForTest('c1', 'anthropic-residency-fit.pptx', 256),
    toolCallMessageForTest('c2', 'create_document'),
    toolResultMessageForTest('c2'),
    fileLinkMessageForTest('c2', 'anthropic-residency-fit.pptx', 257),
    replyMessageForTest('I created the slide deck: [anthropic-residency-fit.pptx](#abchat-docblob-257). It has one two-column slide with speaker notes. I also generated an earlier draft (#abchat-docblob-256) before tightening the wording, so you can ignore that one.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [3, 6]);
});

test('a file the reply does not link keeps its link', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    toolCallMessageForTest('c1', 'create_document'),
    toolResultMessageForTest('c1'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    replyMessageForTest('Your report is ready.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('files with different names in one reply all keep their links', function () {
  const messagesForTest = [
    userMessageForTest('make a report and a PDF of it'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    fileLinkMessageForTest('c2', 'report.pdf', 11),
    replyMessageForTest('Both files are ready.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('the same name in a different letter case still counts as a remake', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'Report.docx', 10),
    fileLinkMessageForTest('c2', 'report.docx', 11),
    replyMessageForTest('Done.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [1]);
});

test('an older copy the reply links is left out once, and the newest copy keeps its link', function () {
  const messagesForTest = [
    userMessageForTest('make two versions'),
    fileLinkMessageForTest('c1', 'plan.docx', 10),
    fileLinkMessageForTest('c2', 'plan.docx', 11),
    replyMessageForTest('The first version is [plan.docx](#abchat-docblob-10).')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [1]);
});

test('a link inside code does not count as linking the file', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    replyMessageForTest('The marker looks like `[report.docx](#abchat-docblob-10)`.\n\n```\n[report.docx](#abchat-docblob-10)\n```')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('image syntax does not count as linking the file', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    replyMessageForTest('![report.docx](#abchat-docblob-10)')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('a bare marker in the reply is plain text and does not count', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    replyMessageForTest('I made an earlier draft (#abchat-docblob-10).')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('a link in a later reply, or the same name in a later reply, leaves an earlier file alone', function () {
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    replyMessageForTest('Done.'),
    userMessageForTest('make it again with a new title'),
    fileLinkMessageForTest('c2', 'report.docx', 11),
    replyMessageForTest('Here is the new one, and the old one is [report.docx](#abchat-docblob-10).')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('text on a tool-call message and a system notice are not the reply', function () {
  const toolCallWithTextForTest = toolCallMessageForTest('c2', 'page_read');
  toolCallWithTextForTest.content = 'Made [report.docx](#abchat-docblob-10), now checking the page.';
  toolCallWithTextForTest.md = toolCallWithTextForTest.content;
  const messagesForTest = [
    userMessageForTest('make a report'),
    fileLinkMessageForTest('c1', 'report.docx', 10),
    toolCallWithTextForTest,
    { role: 'assistant', content: 'See [report.docx](#abchat-docblob-10)', md: '', systemNotice: true }
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('a link with angle brackets or a title still counts', function () {
  const messagesForTest = [
    userMessageForTest('make two files'),
    fileLinkMessageForTest('c1', 'a.docx', 10),
    fileLinkMessageForTest('c2', 'b.docx', 11),
    replyMessageForTest('[a](<#abchat-docblob-10>) and [b](#abchat-docblob-11 "the second file")')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [1, 2]);
});

test('generated images and messages before the first user message are handled', function () {
  const messagesForTest = [
    fileLinkMessageForTest('c0', 'intro.docx', 5),
    replyMessageForTest('[intro.docx](#abchat-docblob-5)'),
    userMessageForTest('draw a cat'),
    { role: 'assistant', content: '', md: '![Generated image](__blob:7__)', displayOnly: true, tool_call_id: 'c1' },
    replyMessageForTest('Here is the cat.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [0]);
  assert.deepStrictEqual(hiddenIndexesForTest(null), []);
});

test('pictures a deck holds are left out of the chat, and the deck the reply links shows once', function () {
  const messagesForTest = [
    userMessageForTest('I need something much fancier'),
    toolCallMessageForTest('c1', 'generate_image'),
    toolResultMessageForTest('c1'),
    pictureMessageForTest('c1', 259),
    toolCallMessageForTest('c2', 'generate_image'),
    toolResultMessageForTest('c2'),
    pictureMessageForTest('c2', 260),
    toolCallMessageForTest('c3', 'create_document'),
    toolResultMessageForTest('c3'),
    documentMessageForTest('c3', 'residency-fit-premium.pptx', 261, [259, 260]),
    replyMessageForTest('I have made a more polished version: [residency-fit-premium.pptx](#abchat-docblob-261)')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [3, 6, 9]);
});

test('a picture the document does not hold stays in the chat', function () {
  const messagesForTest = [
    userMessageForTest('make a deck and a separate banner'),
    pictureMessageForTest('c1', 30),
    pictureMessageForTest('c2', 31),
    documentMessageForTest('c3', 'deck.pptx', 32, [30]),
    replyMessageForTest('Done.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [1]);
});

test('a picture from an earlier reply stays when a later document uses it', function () {
  const messagesForTest = [
    userMessageForTest('draw a lighthouse'),
    pictureMessageForTest('c1', 40),
    replyMessageForTest('Here it is.'),
    userMessageForTest('now put it on the cover of a report'),
    documentMessageForTest('c2', 'report.docx', 41, [40]),
    replyMessageForTest('The report is ready.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

test('an older copy that is left out does not hide its pictures; the newest copy does', function () {
  const messagesForTest = [
    userMessageForTest('make a deck'),
    pictureMessageForTest('c1', 50),
    pictureMessageForTest('c2', 51),
    documentMessageForTest('c3', 'deck.pptx', 52, [50, 51]),
    documentMessageForTest('c4', 'deck.pptx', 53, [51]),
    replyMessageForTest('Done.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), [2, 3]);
});

test('a document saved before it listed its pictures hides none', function () {
  const messagesForTest = [
    userMessageForTest('make a deck'),
    pictureMessageForTest('c1', 60),
    fileLinkMessageForTest('c2', 'deck.pptx', 61),
    replyMessageForTest('Done.')
  ];
  assert.deepStrictEqual(hiddenIndexesForTest(messagesForTest), []);
});

// ---------------------------------------------------------------------------
// imagesToStage: which images of the last reply are attached to the user's next message. The
// agent loop shows the model each image it makes for the user once and marks the image's result;
// an attached image is sent again on every later request, so a shown one is not attached.
//
// Checked against this module with the shown check turned off, which is the rule before this
// change (every image the chat shows is attached): "an image the model was shown" and "a shown
// result is matched" fail there, because the image the model was shown is attached.

const fileViewRulesForTest = require('../agent/fileViewRules.js');

function imageResultForTest(callId, pictures) {
  const result = { ok: true, prompt: 'a lighthouse', aspect_ratio: '16:9', width: 1376, height: 768 };
  if (pictures !== undefined) result.pictures = pictures;
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify(result), md: '' };
}

test('the panel\'s copy of the "shown" text is the text the agent loop writes', function () {
  assert.strictEqual(generatedFileLinksForTest.SHOWN_PICTURES_TEXT, fileViewRulesForTest.PICTURE_STATES.shown);
});

test('an image the model was shown is not attached to the next message; one it was not shown is', function () {
  const states = fileViewRulesForTest.PICTURE_STATES;
  const messagesForTest = [
    userMessageForTest('draw a lighthouse, a boat, a gull and a buoy'),
    toolCallMessageForTest('g1', 'generate_image'),
    imageResultForTest('g1', states.shown),
    imageResultForTest('g2', states.refused),
    imageResultForTest('g3', states.unsent),
    imageResultForTest('g4'),
    pictureMessageForTest('g1', 11),
    pictureMessageForTest('g2', 12),
    pictureMessageForTest('g3', 13),
    pictureMessageForTest('g4', 14),
    replyMessageForTest('Here are your four pictures.')
  ];
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage(messagesForTest), [12, 13, 14],
    'refused, never sent, and no look at all (marked for a document, or an older chat) are attached');
});

test('a result still pending, in older wording, or unreadable does not count as shown', function () {
  const messagesForTest = [
    userMessageForTest('draw three'),
    imageResultForTest('a', fileViewRulesForTest.PICTURE_STATES.pending),
    imageResultForTest('b', 'The pictures follow in the next message.'),
    { role: 'tool', tool_call_id: 'c', content: '{"pictures": "Shown', md: '' },
    pictureMessageForTest('a', 21),
    pictureMessageForTest('b', 22),
    pictureMessageForTest('c', 23)
  ];
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage(messagesForTest), [21, 22, 23]);
});

test('only the last reply\'s images are attached, and not ones a document in it holds', function () {
  const messagesForTest = [
    userMessageForTest('draw a gull'),
    imageResultForTest('old'),
    pictureMessageForTest('old', 31),
    userMessageForTest('now a flyer with a photo'),
    imageResultForTest('p'),
    pictureMessageForTest('p', 32),
    toolResultMessageForTest('d'),
    documentMessageForTest('d', 'flyer.pdf', 33, [32]),
    imageResultForTest('q'),
    pictureMessageForTest('q', 34)
  ];
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage(messagesForTest), [34]);
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage([]), []);
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage(null), []);
});

test('a shown result is matched to its own image by tool_call_id, not by position', function () {
  const messagesForTest = [
    userMessageForTest('two images'),
    imageResultForTest('x', undefined),
    imageResultForTest('y', fileViewRulesForTest.PICTURE_STATES.shown),
    pictureMessageForTest('y', 42),
    pictureMessageForTest('x', 41)
  ];
  assert.deepStrictEqual(generatedFileLinksForTest.imagesToStage(messagesForTest), [41]);
});
