(function () {
  const globalScopeForPageMutatorBatchGate = globalThis;
  const nsForPageMutatorBatchGate = globalScopeForPageMutatorBatchGate.ABChatAgent || {};

  // Page tools that mutate the live document / spreadsheet. At most one of these may
  // execute per assistant tool batch; later ones get a synthetic skip result so the
  // model must replan after seeing the first result (and its fresh snapshot).
  const PAGE_MUTATOR_TOOL_NAMES_FOR_BATCH_GATE = {
    page_act: true,
    page_spreadsheet: true
  };

  const PAGE_MUTATOR_SKIP_ERROR_FOR_BATCH_GATE =
    'Skipped: only one page-mutating tool (page_act or page_spreadsheet) may run per model turn. ' +
    'An earlier page-mutating call in this same turn already ran (or is running). ' +
    'Wait for that result (it includes a fresh page snapshot when applicable), then re-issue any further page actions in a later turn.';

  function isPageMutatorToolNameForBatchGate(nameForBatchGate) {
    return !!PAGE_MUTATOR_TOOL_NAMES_FOR_BATCH_GATE[nameForBatchGate];
  }

  // Returns a Set of indices into toolCalls that must not execute. The first
  // page_act / page_spreadsheet in array order is kept; every later page mutator
  // is skipped. Non-page tools (reads and other mutators) are never skipped here.
  function getSkippedPageMutatorIndicesForBatchGate(toolCallsForBatchGate) {
    const skippedIndicesForBatchGate = new Set();
    if (!Array.isArray(toolCallsForBatchGate) || toolCallsForBatchGate.length === 0) {
      return skippedIndicesForBatchGate;
    }
    let seenPageMutatorForBatchGate = false;
    for (var iForBatchGate = 0; iForBatchGate < toolCallsForBatchGate.length; iForBatchGate++) {
      var tcForBatchGate = toolCallsForBatchGate[iForBatchGate];
      var nameForBatchGate = tcForBatchGate && tcForBatchGate.function
        ? tcForBatchGate.function.name
        : '';
      if (!isPageMutatorToolNameForBatchGate(nameForBatchGate)) continue;
      if (seenPageMutatorForBatchGate) {
        skippedIndicesForBatchGate.add(iForBatchGate);
      } else {
        seenPageMutatorForBatchGate = true;
      }
    }
    return skippedIndicesForBatchGate;
  }

  function buildPageMutatorSkipResultForBatchGate() {
    return { ok: false, error: PAGE_MUTATOR_SKIP_ERROR_FOR_BATCH_GATE, skipped: true };
  }

  nsForPageMutatorBatchGate.pageMutatorBatchGate = {
    isPageMutatorToolName: isPageMutatorToolNameForBatchGate,
    getSkippedIndices: getSkippedPageMutatorIndicesForBatchGate,
    buildSkipResult: buildPageMutatorSkipResultForBatchGate,
    SKIP_ERROR: PAGE_MUTATOR_SKIP_ERROR_FOR_BATCH_GATE
  };

  globalScopeForPageMutatorBatchGate.ABChatAgent = nsForPageMutatorBatchGate;
})();
