let webSocket = null;
let audioContext = null;

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'INIT_CAPTURE') {
    startCapture(msg.streamId, msg.apiKey);
  }
});

async function startCapture(streamId, apiKey) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);

    // Mantener salida a altavoces del usuario
    source.connect(audioContext.destination);

    const host = "generativelanguage.googleapis.com";
    const endpoint = `wss://\({host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=\){apiKey}`;
    webSocket = new WebSocket(endpoint);

    webSocket.onopen = () => {
      console.log("[Gemini WS] Conexión abierta con éxito");
      const setupMessage = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["TEXT"]
          },
          systemInstruction: {
            parts: [{
              text: "You are a real-time subtitle translator for Chinese live speech. " +
                    "Continuously process incoming audio chunks. For every sentence or phrase spoken, " +
                    "immediately return:\n" +
                    "汉字: \n" +
                    "Pinyin: \n" +
                    "EN: \n" +
                    "Do not add conversational commentary or preamble."
            }]
          }
        }
      };
      webSocket.send(JSON.stringify(setupMessage));
      setupAudioProcessing(source);
    };

    webSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const text = data.serverContent?.modelTurn?.parts?.[0]?.text;
        if (text) {
          chrome.runtime.sendMessage({ type: 'NEW_SUBTITLE', text: text });
        }
      } catch (err) {
        console.error("[Gemini WS] Error parseando datos:", err);
      }
    };

    webSocket.onerror = (err) => console.error("[Gemini WS] Error:", err);
    webSocket.onclose = (e) => console.warn("[Gemini WS] Cerrado con código:", e.code, e.reason);

  } catch (err) {
    console.error("[Capture Error]:", err);
  }
}

function setupAudioProcessing(source) {
  // Buffer de 4096 muestras a 16kHz (~256ms de audio por paquete)
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const uint8Bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < uint8Bytes.byteLength; i++) {
      binary += String.fromCharCode(uint8Bytes[i]);
    }

    const audioPayload = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: "audio/pcm;rate=16000",
          data: btoa(binary)
        }]
      }
    };
    webSocket.send(JSON.stringify(audioPayload));
  };
}