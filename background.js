let activeTabId = null;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === "START_TRANSLATION") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;
    activeTabId = tab.id;

    // Inyectar el overlay flotante en la web
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectSubtitleOverlay,
    });

    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (!hasOffscreen) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Capture tab audio for live subtitles",
      });
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      chrome.runtime.sendMessage({
        type: "INIT_CAPTURE",
        streamId: streamId,
        apiKey: message.apiKey,
      });
    });
  }

  // Redirigir subtítulos recibidos desde offscreen hacia la pestaña activa
  if (message.type === "NEW_SUBTITLE" && activeTabId) {
    chrome.tabs
      .sendMessage(activeTabId, {
        type: "RENDER_SUBTITLE",
        text: message.text,
      })
      .catch(() => {});
  }
});

function injectSubtitleOverlay() {
  if (document.getElementById("gemini-live-subtitles")) return;

  const overlay = document.createElement("div");
  overlay.id = "gemini-live-subtitles";
  overlay.style.cssText = `
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    width: 75%;
    max-width: 850px;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 14px 20px;
    border-radius: 10px;
    font-family: sans-serif;
    font-size: 17px;
    line-height: 1.5;
    z-index: 2147483647;
    pointer-events: auto;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.2);
    text-shadow: 1px 1px 2px #000;
    max-height: 160px;
    overflow-y: auto;
  `;
  overlay.innerHTML = "[Gemini Live] Conectando con el stream...";
  document.body.appendChild(overlay);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RENDER_SUBTITLE") {
      const box = document.getElementById("gemini-live-subtitles");
      if (box) {
        box.textContent = msg.text;
      }
    }
  });
}
