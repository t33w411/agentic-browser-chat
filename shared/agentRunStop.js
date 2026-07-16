(function () {
  const globalScopeForAgentRunStop = globalThis;
  const nsForAgentRunStop = globalScopeForAgentRunStop.ABChatShared || {};

  function buildNoticeForAgentRunStop(stopReasonForNotice, toolTimeoutMsForNotice) {
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
      'timeout-total': 'Turn timeout'
    };
    return labelsForAgentRunStop[statusForLabel] || (statusForLabel || '');
  }

  function getStatusCssClassForAgentRunStop(statusForClass) {
    if (statusForClass === 'success' || statusForClass === 'success_raw') return 'log-status-success';
    if (statusForClass === 'error') return 'log-status-error';
    if (statusForClass === 'cancelled-user') return 'log-status-cancelled-user';
    if (statusForClass && String(statusForClass).indexOf('timeout-') === 0) return 'log-status-timeout';
    return 'log-status-cancelled';
  }

  function getLogPreviewTextForAgentRunStop(logForPreview) {
    if (!logForPreview) return '';
    if (logForPreview.status === 'error') return logForPreview.errorMessage || 'Error';
    var stopReasonForPreview = logForPreview.stopReason;
    if (stopReasonForPreview) {
      return buildNoticeForAgentRunStop(stopReasonForPreview, logForPreview.toolTimeoutMs);
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
