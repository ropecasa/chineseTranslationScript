document.getElementById('startBtn').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  if (!key) return;

  chrome.runtime.sendMessage({ type: 'START_TRANSLATION', apiKey: key });
  document.getElementById('subtitles').textContent = 'Conectado. Escuchando stream...\n';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NEW_SUBTITLE') {
    const box = document.getElementById('subtitles');
    box.textContent += msg.text;
    box.scrollTop = box.scrollHeight;
  }
});