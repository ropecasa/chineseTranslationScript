chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'START_TRANSLATION') {
    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (!hasOffscreen) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio for real-time speech translation'
      });
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      chrome.runtime.sendMessage({
        type: 'INIT_CAPTURE',
        streamId: streamId,
        apiKey: message.apiKey
      });
    });
  }
});