// Markdown assembly for the composer copy button (panel/panelComposerCopy.js).
//
// The fence tests are the point of this file. Attached notes and page captures routinely contain
// code fences of their own, and a fixed three-backtick wrapper is closed by the first one, which
// silently spills the rest of that attachment (and every section after it) into the document as
// prose. Verified against a fixed-fence implementation before being kept: it fails there and
// passes here. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const composerCopyForTest = require('../panel/panelComposerCopy.js');

function attachmentForTest(overridesForAttachment) {
  return Object.assign({
    label: 'Attachment',
    type: 'file',
    kind: 'file',
    mimeType: '',
    pageUrl: '',
    pageTitle: '',
    content: 'body text',
    isImage: false,
    missing: false,
    missingType: ''
  }, overridesForAttachment || {});
}

test('attachments are emitted before the typed message', function () {
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: 'what do you make of this?',
    attachments: [attachmentForTest({ label: 'data.csv' })]
  });

  assert.ok(outputForTest.indexOf('## Attachments (1)') < outputForTest.indexOf('## Message'));
  assert.ok(outputForTest.indexOf('### 1. data.csv') < outputForTest.indexOf('what do you make of this?'));
});

test('a message with no attachments is copied bare, with no headings', function () {
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: 'just a question',
    attachments: []
  });

  assert.strictEqual(outputForTest, 'just a question');
});

test('nothing to copy yields an empty string rather than an empty document', function () {
  assert.strictEqual(composerCopyForTest.buildComposerMarkdown({ text: '   ', attachments: [] }), '');
  assert.strictEqual(composerCopyForTest.buildComposerMarkdown(null), '');
});

test('content holding a code fence is wrapped in a longer fence', function () {
  const noteBodyForTest = 'Run this:\n\n```js\nconst x = 1;\n```\n\nThen restart.';
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: 'summarise',
    attachments: [attachmentForTest({ label: 'Setup note', type: 'note', kind: '', content: noteBodyForTest })]
  });

  assert.ok(outputForTest.indexOf('````\n' + noteBodyForTest + '\n````') !== -1);
  // The whole note, including the text after its inner fence, must sit inside the wrapper.
  const bodyStartForTest = outputForTest.indexOf('````');
  const bodyEndForTest = outputForTest.lastIndexOf('````');
  assert.ok(outputForTest.slice(bodyStartForTest, bodyEndForTest).indexOf('Then restart.') !== -1);
});

test('the fence outgrows the longest run of backticks in the content', function () {
  assert.strictEqual(composerCopyForTest.fenceForContent('no backticks here'), '```');
  assert.strictEqual(composerCopyForTest.fenceForContent('an `inline` span'), '```');
  assert.strictEqual(composerCopyForTest.fenceForContent('```\nfenced\n```'), '````');
  assert.strictEqual(composerCopyForTest.fenceForContent('`````\ndeep\n`````'), '``````');
});

test('the message survives an attachment that contains a fence', function () {
  const contentForTest = 'prose\n```\ncode\n```\nmore prose';
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: 'MY QUESTION',
    attachments: [attachmentForTest({ content: contentForTest })]
  });

  // Walk the block the way a Markdown parser would: the first fence line opens it, the next
  // identical line closes it. A wrapper no longer than the content's own fence closes on the
  // content's first inner fence, so everything after it escapes the block.
  const linesForTest = outputForTest.split('\n');
  const openIndexForTest = linesForTest.findIndex(function (lineForTest) {
    return /^`{3,}$/.test(lineForTest);
  });
  assert.notStrictEqual(openIndexForTest, -1);
  const closeIndexForTest = linesForTest.indexOf(linesForTest[openIndexForTest], openIndexForTest + 1);
  assert.notStrictEqual(closeIndexForTest, -1);

  assert.strictEqual(linesForTest.slice(openIndexForTest + 1, closeIndexForTest).join('\n'), contentForTest);
  assert.ok(linesForTest.slice(closeIndexForTest).join('\n').indexOf('## Message') !== -1);
});

test('image attachments are named rather than dropped', function () {
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ label: 'shot.png', type: 'screenshot', kind: 'screenshot', content: '', isImage: true })]
  });

  assert.ok(outputForTest.indexOf('### 1. shot.png') !== -1);
  assert.ok(outputForTest.indexOf('- Type: screenshot') !== -1);
  assert.ok(outputForTest.indexOf('This screenshot is not included') !== -1);
});

test('an omitted image tells the reader to ask for it', function () {
  // Stating the absence is not enough: whoever receives the paste, usually another assistant, has
  // to be told the follow-up, or it answers around the missing image instead of requesting it.
  const typesForTest = [
    { type: 'image', kind: 'image', expectedForTest: 'This image is not included' },
    { type: 'screenshot', kind: 'screenshot', expectedForTest: 'This screenshot is not included' },
    { type: 'image', kind: 'generated_image', expectedForTest: 'This generated image is not included' }
  ];

  typesForTest.forEach(function (caseForTest) {
    const outputForTest = composerCopyForTest.buildComposerMarkdown({
      text: '',
      attachments: [attachmentForTest({
        label: 'pic',
        type: caseForTest.type,
        kind: caseForTest.kind,
        content: '',
        isImage: true
      })]
    });

    assert.ok(outputForTest.indexOf(caseForTest.expectedForTest) !== -1, caseForTest.kind + ': type label');
    assert.ok(outputForTest.indexOf('ask for it') !== -1, caseForTest.kind + ': names the follow-up');
    assert.ok(
      outputForTest.indexOf('has not been provided to you separately') !== -1,
      caseForTest.kind + ': conditions the ask on not already having it'
    );
  });
});

test('a deleted source is reported instead of copied as empty', function () {
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ label: 'Old note', type: 'note', kind: '', content: '', missing: true, missingType: 'note' })]
  });

  assert.ok(outputForTest.indexOf('Content unavailable: this note was deleted after it was attached.') !== -1);
  assert.strictEqual(outputForTest.indexOf('```'), -1);
});

test('source title and url are emitted together when both are known', function () {
  const withBothForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ type: 'page', pageTitle: 'Acme Pricing', pageUrl: 'https://acme.test/pricing' })]
  });
  assert.ok(withBothForTest.indexOf('- Source: Acme Pricing (https://acme.test/pricing)') !== -1);

  const withUrlOnlyForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ type: 'page', pageUrl: 'https://acme.test/pricing' })]
  });
  assert.ok(withUrlOnlyForTest.indexOf('- Source: https://acme.test/pricing') !== -1);

  const withNeitherForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ type: 'paste' })]
  });
  assert.strictEqual(withNeitherForTest.indexOf('- Source:'), -1);
});

test('chip type labels read as English, and kind wins over type where it must', function () {
  assert.strictEqual(composerCopyForTest.describeChipType('page-snapshot', ''), 'page snapshot');
  assert.strictEqual(composerCopyForTest.describeChipType('tab', ''), 'browser tab');
  assert.strictEqual(composerCopyForTest.describeChipType('paste', 'paste'), 'pasted text');
  // A clip rides the note chip type, so only kind distinguishes it.
  assert.strictEqual(composerCopyForTest.describeChipType('note', 'clip'), 'saved clip');
  assert.strictEqual(composerCopyForTest.describeChipType('image', 'generated_image'), 'generated image');
  assert.strictEqual(composerCopyForTest.describeChipType('something-new', ''), 'something-new');
  assert.strictEqual(composerCopyForTest.describeChipType('', ''), 'attachment');
});

test('a known mime type becomes the fence info string', function () {
  const htmlOutputForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ mimeType: 'text/html', content: '<p>hi</p>' })]
  });
  assert.ok(htmlOutputForTest.indexOf('```html\n<p>hi</p>\n```') !== -1);

  const plainOutputForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [attachmentForTest({ mimeType: 'text/plain', content: 'hi' })]
  });
  assert.ok(plainOutputForTest.indexOf('```\nhi\n```') !== -1);
});

test('attachments are numbered in row order', function () {
  const outputForTest = composerCopyForTest.buildComposerMarkdown({
    text: '',
    attachments: [
      attachmentForTest({ label: 'first' }),
      attachmentForTest({ label: 'second' }),
      attachmentForTest({ label: 'third' })
    ]
  });

  assert.ok(outputForTest.indexOf('## Attachments (3)') !== -1);
  assert.ok(outputForTest.indexOf('### 1. first') < outputForTest.indexOf('### 2. second'));
  assert.ok(outputForTest.indexOf('### 2. second') < outputForTest.indexOf('### 3. third'));
});
