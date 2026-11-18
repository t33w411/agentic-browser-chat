// grep with max_words counts how often the pattern occurs on each matched line. The count ran a
// global regular expression in a loop that never moved past an empty match, so a pattern that can
// match empty text (x*, \s*, a|) with max_words looped forever. In the extension that froze the
// offscreen document, and every agent run with it.
//
// Each case runs grep in a child process with a time limit: a hang in this process would block the
// test runner itself, so the test would never report. Checked against the code before the fix:
// the note case times out there and fails. The file path had its own guard before both paths
// shared one count; with the step past an empty match taken out of that count, both empty-match
// cases time out.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_FOR_TEST = path.join(__dirname, '..');

// Runs grep in a fresh Node process over a store holding the given notes and attachment blobs,
// and returns its result. Fails if grep has not finished within five seconds.
function grepInChildForTest(argsForGrep, storeForGrep) {
  const scriptForChild = [
    'require(' + JSON.stringify(path.join(ROOT_FOR_TEST, 'agent/tools.js')) + ');',
    'require(' + JSON.stringify(path.join(ROOT_FOR_TEST, 'agent/toolExec.js')) + ');',
    'const store = ' + JSON.stringify(storeForGrep) + ';',
    'globalThis.ABChatShared = { panelDataRepo: {',
    '  getNote: async function (id) { return (store.notes || {})[id] || null; },',
    '  getAttachmentBlob: async function (id) { return (store.blobs || {})[id] || null; }',
    '} };',
    'globalThis.ABChatAgent.executeTool("grep", ' + JSON.stringify(argsForGrep) + ', {})',
    '  .then(function (result) { process.stdout.write(JSON.stringify(result)); process.exit(0); });'
  ].join('\n');
  const runForChild = spawnSync(process.execPath, ['-e', scriptForChild], { timeout: 5000, encoding: 'utf8' });
  assert.ok(!runForChild.error, 'grep did not finish within 5 seconds (' + (runForChild.error && runForChild.error.code) + ')');
  assert.strictEqual(runForChild.status, 0, runForChild.stderr);
  return JSON.parse(runForChild.stdout);
}

const NOTE_STORE_FOR_TEST = { notes: { 1: { id: 1, title: 'Shopping', body: 'banana bread\neggs', noteType: 'user' } } };

test('grep over notes with max_words finishes for a pattern that can match empty text', function () {
  const resultForTest = grepInChildForTest({ type: 'note', id: 1, pattern: 'x*', max_words: 3 }, NOTE_STORE_FOR_TEST);
  assert.strictEqual(resultForTest.ok, true);
  const linesForTest = resultForTest.matches[0].lines;
  assert.deepStrictEqual(linesForTest.map(function (l) { return l.ln; }), [1, 2]);
  // Each empty match is counted once, one per position in the line and one at its end.
  assert.strictEqual(linesForTest[0].match_count, 'banana bread'.length + 1);
});

test('grep over notes with max_words still counts ordinary matches', function () {
  const resultForTest = grepInChildForTest({ type: 'note', id: 1, pattern: 'an', max_words: 3 }, NOTE_STORE_FOR_TEST);
  assert.strictEqual(resultForTest.total_lines, 1);
  assert.strictEqual(resultForTest.matches[0].lines[0].match_count, 2);
});

test('grep over one file with max_words finishes for a pattern that can match empty text', function () {
  const storeForTest = { blobs: { 5: { id: 5, name: 'page.html', mimeType: 'text/html', textContent: '<p>a  b</p>' } } };
  const resultForTest = grepInChildForTest({ type: 'attachment', id: 5, pattern: '\\s*', max_words: 3 }, storeForTest);
  assert.strictEqual(resultForTest.ok, true);
  assert.strictEqual(resultForTest.matches[0].lines[0].match_count, 11);
});
