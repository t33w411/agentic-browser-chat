// Tests for the generate_questions tool's executor (agent/toolExec.js): the default and maximum
// question count, the report of questions that were requested but not saved, and the shuffle of
// multiple-choice options before they are saved. The service worker's generation call is stubbed
// with canned questions.
//
// Checked against the code before this change: the default test fails because one question was
// requested, the cap test fails because a count of 11 was sent to the generator, the shortfall
// tests fail because the result carried no requested count and no reason for the missing
// questions, and the shuffle test fails because every correct option was saved second, where the
// generator put it. The "of the above" test passes against that code too, since nothing was
// shuffled. It guards the exception to the shuffle.

const test = require('node:test');
const assert = require('node:assert');

require('../agent/tools.js');
require('../agent/toolExec.js');

const agentNsForTest = globalThis.ABChatAgent;
const CONTEXT_FOR_TEST = { apiKey: 'test-key', model: 'test-model', chatId: 7 };

function mcqForTest(n) {
  return {
    title: 'Question ' + n,
    type: 'mcq',
    questionText: 'In topic ' + n + ', which option is right?',
    options: [
      { text: 'Wrong A' + n, isCorrect: false },
      { text: 'Right ' + n, isCorrect: true },
      { text: 'Wrong C' + n, isCorrect: false },
      { text: 'Wrong D' + n, isCorrect: false }
    ],
    correctAnswer: '',
    alternativeAnswers: [],
    caseSensitive: false,
    explanation: 'Because.'
  };
}

// Stubs the service worker and the question store. respondForTest receives the message sent to
// the service worker and returns its response.
function installStubsForTest(respondForTest) {
  const stateForTest = { sent: [], saved: [] };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: function (messageForStub, callbackForStub) {
        stateForTest.sent.push(messageForStub);
        const responseForStub = respondForTest(messageForStub);
        if (typeof callbackForStub === 'function') setTimeout(function () { callbackForStub(responseForStub); }, 0);
      }
    }
  };
  globalThis.ABChatShared = {
    panelDataRepo: {
      createQuestion: async function (questionForStub) {
        stateForTest.saved.push(questionForStub);
        return Object.assign({ id: stateForTest.saved.length }, questionForStub);
      }
    }
  };
  return stateForTest;
}

function generatorReturningForTest(howManyForTest, extraForTest) {
  return function (messageForStub) {
    const questionsForStub = [];
    for (let i = 1; i <= howManyForTest(messageForStub); i++) questionsForStub.push(mcqForTest(i));
    return Object.assign({ ok: true, questions: questionsForStub }, extraForTest || {});
  };
}

test('a call without a count asks for five questions', async function () {
  const stateForTest = installStubsForTest(generatorReturningForTest(function (m) { return m.count; }));
  const resultForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.' }, CONTEXT_FOR_TEST);
  assert.strictEqual(stateForTest.sent[0].count, 5);
  assert.strictEqual(resultForTest.ok, true);
  assert.strictEqual(resultForTest.requested, 5);
  assert.strictEqual(resultForTest.saved, 5);
});

test('a count above ten is refused before the generator runs', async function () {
  const stateForTest = installStubsForTest(generatorReturningForTest(function (m) { return m.count; }));
  const resultForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 11 }, CONTEXT_FOR_TEST);
  assert.strictEqual(resultForTest.ok, false);
  assert.match(resultForTest.error, /at most 10/);
  assert.strictEqual(stateForTest.sent.length, 0);

  const atCapForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 10 }, CONTEXT_FOR_TEST);
  assert.strictEqual(atCapForTest.saved, 10);
});

test('questions dropped by validation are reported with their reason', async function () {
  installStubsForTest(generatorReturningForTest(function () { return 3; }, {
    validationWarnings: ['Question 4: still invalid after fix attempt (MCQ must have exactly 4 options (got 3))']
  }));
  const resultForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 4 }, CONTEXT_FOR_TEST);
  assert.strictEqual(resultForTest.ok, true);
  assert.strictEqual(resultForTest.requested, 4);
  assert.strictEqual(resultForTest.saved, 3);
  assert.ok(Array.isArray(resultForTest.errors));
  assert.ok(resultForTest.errors.some(function (e) { return /Question 4: still invalid/.test(e); }));

  // A dropped question does not explain anything when enough questions are left.
  installStubsForTest(generatorReturningForTest(function () { return 4; }, {
    validationWarnings: ['Question 5: fix attempt returned no result (original issues: missing questionText)']
  }));
  const fullForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 4 }, CONTEXT_FOR_TEST);
  assert.strictEqual(fullForTest.saved, 4);
  assert.strictEqual(fullForTest.errors, undefined);
});

test('a generator that returns too few or too many questions is reported or trimmed', async function () {
  installStubsForTest(generatorReturningForTest(function () { return 2; }));
  const shortForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 4 }, CONTEXT_FOR_TEST);
  assert.strictEqual(shortForTest.saved, 2);
  assert.ok(shortForTest.errors.some(function (e) { return /returned 2 questions instead of 4/.test(e); }));

  const stateForTest = installStubsForTest(generatorReturningForTest(function () { return 6; }));
  const longForTest = await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 4 }, CONTEXT_FOR_TEST);
  assert.strictEqual(longForTest.saved, 4);
  assert.strictEqual(stateForTest.saved.length, 4);
  assert.strictEqual(longForTest.errors, undefined);
});

test('multiple-choice options are shuffled before they are saved', async function () {
  const stateForTest = installStubsForTest(generatorReturningForTest(function (m) { return m.count; }));
  for (let i = 0; i < 4; i++) {
    await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 10, question_type: 'mcq' }, CONTEXT_FOR_TEST);
  }
  const positionsForTest = new Set();
  stateForTest.saved.forEach(function (questionForTest, indexForTest) {
    const original = mcqForTest((indexForTest % 10) + 1);
    const textsSaved = questionForTest.options.map(function (o) { return o.text; }).sort();
    const textsOriginal = original.options.map(function (o) { return o.text; }).sort();
    assert.deepStrictEqual(textsSaved, textsOriginal);
    const correctForTest = questionForTest.options.filter(function (o) { return o.isCorrect === true; });
    assert.strictEqual(correctForTest.length, 1);
    assert.strictEqual(correctForTest[0].text, 'Right ' + ((indexForTest % 10) + 1));
    positionsForTest.add(questionForTest.options.indexOf(correctForTest[0]));
  });
  // 40 questions all landing in the generator's position has odds of 1 in 4^40 after a shuffle.
  assert.ok(positionsForTest.size > 1, 'correct option stayed in one position');
});

test('options that refer to the other options keep their order', async function () {
  const stateForTest = installStubsForTest(function () {
    const questionForStub = mcqForTest(1);
    questionForStub.options[3] = { text: 'All of the above', isCorrect: false };
    return { ok: true, questions: [questionForStub] };
  });
  for (let i = 0; i < 12; i++) {
    await agentNsForTest.executeTool('generate_questions', { content: 'Source text.', count: 1 }, CONTEXT_FOR_TEST);
  }
  stateForTest.saved.forEach(function (questionForTest) {
    assert.strictEqual(questionForTest.options[3].text, 'All of the above');
    assert.strictEqual(questionForTest.options[1].isCorrect, true);
  });
});
