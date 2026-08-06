(function () {
  const globalScopeForAgentRunStop = globalThis;
  const nsForAgentRunStop = globalScopeForAgentRunStop.ABChatShared || {};

  function buildNoticeForAgentRunStop(stopReasonForNotice, toolTimeoutMsForNotice, stopLimitForNotice) {
    if (stopReasonForNotice === 'user') {
      return 'Agent stopped: you cancelled the run.';
    }
    if (stopReasonForNotice === 'total') {
      return 'Agent stopped: turn exceeded the 10-minute time limit.';
    }
    if (stopReasonForNotice === 'stream') {
      return 'Agent stopped: the model stopped responding (no data for 90s).';
    }
    if (stopReasonForNotice === 'tool') {
      var toolSecsForNotice = Math.round((toolTimeoutMsForNotice || (90 * 1000)) / 1000);
      var toolLabelForNotice = toolSecsForNotice % 60 === 0
        ? (toolSecsForNotice / 60) + '-minute limit'
        : toolSecsForNotice + '-second limit';
      return 'Agent stopped: tool execution took too long (' + toolLabelForNotice + ').';
    }
    if (stopReasonForNotice === 'cancelled') {
      return 'Agent stopped before completion.';
    }
    if (stopReasonForNotice === 'iteration-limit') {
      var iterationLimitForNotice = Number(stopLimitForNotice) || 60;
      return 'Agent stopped: reached the ' + iterationLimitForNotice + '-step safety limit before completing the request. Completed actions remain saved; send "continue" to resume the remaining work.';
    }
    if (stopReasonForNotice === 'no-progress') {
      var checkpointLimitForNotice = Number(stopLimitForNotice) || 20;
      return 'Agent stopped at the ' + checkpointLimitForNotice + '-step checkpoint because recent tool activity was not making enough progress. Completed actions remain saved; review the latest results before continuing.';
    }
    if (stopReasonForNotice === 'tool-call-limit') {
      var toolCallLimitForNotice = Number(stopLimitForNotice) || 60;
      return 'Agent stopped: reached the ' + toolCallLimitForNotice + '-tool safety limit before completing the request. Completed actions remain saved; send "continue" to resume the remaining work.';
    }
    if (stopReasonForNotice === 'repeated-tools') {
      var repeatedToolRoundsForNotice = Number(stopLimitForNotice) || 4;
      return 'Agent stopped: the same tool calls were repeated ' + repeatedToolRoundsForNotice + ' rounds in a row without a different step. Completed actions remain saved; review the latest result before continuing.';
    }
    return '';
  }

  function resolveStopReasonForAgentRunStop(optsForResolve) {
    var optsForStop = optsForResolve || {};
    if (optsForStop.timeoutReason === 'stream' || optsForStop.timeoutReason === 'tool' || optsForStop.timeoutReason === 'total') {
      return optsForStop.timeoutReason;
    }
    if (optsForStop.userStopRequested) return 'user';
    if (optsForStop.wasAborted) return 'cancelled';
    return null;
  }

  function logStatusFromStopReasonForAgentRunStop(stopReasonForStatus, existingStatusForStatus) {
    if (existingStatusForStatus === 'error') return 'error';
    if (stopReasonForStatus === 'user') return 'cancelled-user';
    if (stopReasonForStatus === 'stream') return 'timeout-stream';
    if (stopReasonForStatus === 'tool') return 'timeout-tool';
    if (stopReasonForStatus === 'total') return 'timeout-total';
    if (stopReasonForStatus === 'cancelled') return 'cancelled';
    if (stopReasonForStatus === 'iteration-limit') return 'limit-iterations';
    if (stopReasonForStatus === 'no-progress') return 'limit-no-progress';
    if (stopReasonForStatus === 'tool-call-limit') return 'limit-tools';
    if (stopReasonForStatus === 'repeated-tools') return 'limit-repetition';
    return existingStatusForStatus || 'success';
  }

  function getStatusLabelForAgentRunStop(statusForLabel) {
    var labelsForAgentRunStop = {
      success: 'Success',
      success_raw: 'Success',
      error: 'Error',
      cancelled: 'Cancelled',
      'cancelled-user': 'Stopped by user',
      'timeout-stream': 'Stream timeout',
      'timeout-tool': 'Tool timeout',
      'timeout-total': 'Turn timeout',
      'limit-iterations': 'Step limit',
      'limit-no-progress': 'No progress',
      'limit-tools': 'Tool limit',
      'limit-repetition': 'Repeated tools'
    };
    return labelsForAgentRunStop[statusForLabel] || (statusForLabel || '');
  }

  function getStatusCssClassForAgentRunStop(statusForClass) {
    if (statusForClass === 'success' || statusForClass === 'success_raw') return 'log-status-success';
    if (statusForClass === 'error') return 'log-status-error';
    if (statusForClass === 'cancelled-user') return 'log-status-cancelled-user';
    if (statusForClass && String(statusForClass).indexOf('timeout-') === 0) return 'log-status-timeout';
    if (statusForClass && String(statusForClass).indexOf('limit-') === 0) return 'log-status-timeout';
    return 'log-status-cancelled';
  }

  function getLogPreviewTextForAgentRunStop(logForPreview) {
    if (!logForPreview) return '';
    if (logForPreview.status === 'error') return logForPreview.errorMessage || 'Error';
    var stopReasonForPreview = logForPreview.stopReason;
    if (stopReasonForPreview) {
      return buildNoticeForAgentRunStop(stopReasonForPreview, logForPreview.toolTimeoutMs, logForPreview.stopLimit);
    }
    if (logForPreview.status && logForPreview.status !== 'success' && logForPreview.status !== 'success_raw') {
      return getStatusLabelForAgentRunStop(logForPreview.status);
    }
    // web_search logs use legacy rawResponse instead of responseContent.
    return logForPreview.responseContent || logForPreview.rawResponse || '';
  }

  nsForAgentRunStop.agentRunStop = {
    buildNotice: buildNoticeForAgentRunStop,
    resolveStopReason: resolveStopReasonForAgentRunStop,
    logStatusFromStopReason: logStatusFromStopReasonForAgentRunStop,
    getStatusLabel: getStatusLabelForAgentRunStop,
    getStatusCssClass: getStatusCssClassForAgentRunStop,
    getLogPreviewText: getLogPreviewTextForAgentRunStop
  };

  globalScopeForAgentRunStop.ABChatShared = nsForAgentRunStop;
})();
