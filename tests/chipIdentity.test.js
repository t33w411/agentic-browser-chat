// What makes two composer chips the same attachment (panel/panelChipIdentity.js).
//
// addInputChipForPanelRuntime refuses a chip whose key matches one already in the composer, so a
// key that is too loose refuses a real attachment and one that is too strict lets a duplicate in.
// The cases below pin both sides. Verified against a version that keyed uploads by blob id: the
// "same name and size" case fails there, because every upload gets a new blob. Run with:
//
//   node --test tests/

const test = require('node:test');
const assert = require('node:assert');

const chipIdentityForTest = require('../panel/panelChipIdentity.js');

const keyFor = chipIdentityForTest.keyFor;
const same = (a, b) => keyFor(a) !== '' && keyFor(a) === keyFor(b);

test('notes, clips and chats are the same attachment when they name the same record', () => {
  assert.ok(same({ type: 'note', refId: 4, label: 'A' }, { type: 'note', refId: '4', label: 'Renamed' }));
  assert.ok(same({ type: 'note', kind: 'clip', refId: 9 }, { type: 'note', kind: 'clip', refId: 9 }));
  assert.ok(same({ type: 'chat', refId: 2 }, { type: 'chat', refId: 2 }));
  assert.ok(!same({ type: 'note', refId: 2 }, { type: 'chat', refId: 2 }));
  assert.ok(!same({ type: 'note', refId: 2 }, { type: 'note', refId: 3 }));
  assert.strictEqual(keyFor({ type: 'note', refId: '' }), '');
  assert.strictEqual(keyFor({ type: 'note', refId: 0 }), '');
});

test('tabs are the same attachment when they show the same URL', () => {
  assert.ok(same({ type: 'tab', pageUrl: 'https://a.example/x', label: 'One' }, { type: 'tab', pageUrl: 'https://a.example/x', label: 'Two', content: 'later' }));
  assert.ok(!same({ type: 'tab', pageUrl: 'https://a.example/x' }, { type: 'tab', pageUrl: 'https://a.example/y' }));
  // A tab chip saved before tabs carried their URL has no key, so it never blocks anything.
  assert.strictEqual(keyFor({ type: 'tab', pageUrl: '', content: 'page text' }), '');
});

test('an upload is the same attachment as an earlier upload with the same name and size', () => {
  // The loading chip has no blob yet; the finished one has its own blob id.
  assert.ok(same({ type: 'file', label: 'report.pdf', size: 5120, status: 'loading' }, { type: 'file', label: 'report.pdf', size: '5120', refId: 31 }));
  assert.ok(same({ type: 'image', label: 'photo.png', size: 900, refId: 7 }, { type: 'image', label: 'photo.png', size: 900, refId: 8 }));
});

test('uploads that differ in name, size or type are different attachments', () => {
  assert.ok(!same({ type: 'file', label: 'report.pdf', size: 5120 }, { type: 'file', label: 'report.pdf', size: 5121 }));
  assert.ok(!same({ type: 'file', label: 'report.pdf', size: 5120 }, { type: 'file', label: 'report-2.pdf', size: 5120 }));
  assert.ok(!same({ type: 'file', label: 'a.png', size: 10 }, { type: 'image', label: 'a.png', size: 10 }));
  // An image added from the page has no size while it loads, so it cannot be matched yet.
  assert.strictEqual(keyFor({ type: 'image', label: 'photo.png', status: 'loading' }), '');
});

test('a generated image is keyed by its blob', () => {
  assert.ok(same({ type: 'image', kind: 'generated_image', refId: 12, label: 'Generated image' }, { type: 'image', kind: 'generated_image', refId: 12, label: 'Generated image' }));
  assert.ok(!same({ type: 'image', kind: 'generated_image', refId: 12 }, { type: 'image', kind: 'generated_image', refId: 13 }));
});

test('chips that carry their text are the same when the text is identical', () => {
  assert.ok(same({ type: 'paste', label: 'Pasted text', content: 'hello' }, { type: 'paste', label: 'Selected text', content: 'hello' }));
  assert.ok(same({ type: 'page', content: '<p>x</p>', pageUrl: 'https://a.example' }, { type: 'page', content: '<p>x</p>', pageUrl: 'https://a.example' }));
  assert.ok(!same({ type: 'paste', content: 'hello' }, { type: 'paste', content: 'hello ' }));
  assert.ok(!same({ type: 'paste', content: 'hello' }, { type: 'spreadsheet', content: 'hello' }));
  assert.strictEqual(keyFor({ type: 'paste', content: '' }), '');
});

test('screenshots are never duplicates', () => {
  assert.strictEqual(keyFor({ type: 'screenshot', label: 'Screenshot', size: 100, refId: 3 }), '');
  assert.strictEqual(keyFor({ type: 'image', kind: 'screenshot', label: 'Screenshot', size: 100 }), '');
});

test('findDuplicate returns the matching chip, or null', () => {
  const existingForFind = [{ type: 'note', refId: 1 }, { type: 'tab', pageUrl: 'https://a.example' }];
  assert.strictEqual(chipIdentityForTest.findDuplicate(existingForFind, { type: 'tab', pageUrl: 'https://a.example' }), existingForFind[1]);
  assert.strictEqual(chipIdentityForTest.findDuplicate(existingForFind, { type: 'note', refId: 2 }), null);
  assert.strictEqual(chipIdentityForTest.findDuplicate(existingForFind, { type: 'screenshot' }), null);
  assert.strictEqual(chipIdentityForTest.findDuplicate(null, { type: 'note', refId: 1 }), null);
});
