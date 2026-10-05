document.getElementById('startBtn').addEventListener('click', () => {
  const keyInput = document.getElementById('apiKey');
  const key = keyInput.value.trim();

  if (!key) {
    keyInput.style.borderColor = '#ff4d4d';
    return;
  }

  // Se envía a background en memoria para inicializar el socket y se cierra la ventana
  chrome.runtime.sendMessage({ type: 'START_TRANSLATION', apiKey: key });
  window.close();
});