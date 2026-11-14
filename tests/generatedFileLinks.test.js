// Which automatic file links the chat leaves out (panel/panelGeneratedFiles.js).
//
// The first test replays the chat that showed the problem: a deck made twice under one name, then
// a reply that links the second copy. Before this change the bubble showed the file name three
// times. Verified against the code without this module (nothing hidden): every test that expects
// a hidden index fails. Also verified against three broken variants of the module, each failing
// the named test: without the code stripping, "a link inside code"; without the per-reply scope,
// "a link in a later reply"; without the "!" lookbehind, "image syntax". Run with:
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
