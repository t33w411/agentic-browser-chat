chrome.runtime.onMessage.addListener(function (msgForOffscreen) {
  if (!msgForOffscreen || msgForOffscreen.action !== 'playReminderBeep') return;
  var audioForOffscreen = document.getElementById('reminder-audio');
  if (!audioForOffscreen) return;
  audioForOffscreen.currentTime = 0;
  audioForOffscreen.play().catch(function () { /* audio unavailable */ });
});
