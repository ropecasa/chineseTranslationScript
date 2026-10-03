let webSocket = null;
let audioContext = null;

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'INIT_CAPTURE') {
    startCapture(msg.streamId, msg.apiKey);
  }
});

async function startCapture(streamId, apiKey) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  // Mantener reproducción en altavoces locales para que no se silencie el stream
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);

  // Inicializar WebSocket con Gemini Live API
  const host = "generativelanguage.googleapis.com";
  const endpoint = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  webSocket = new WebSocket(endpoint);

  webSocket.onopen = () => {
    // 1. Handshake de configuración del modelo y formato de salida
    const setupMessage = {
      setup: {
        model: "models/gemini-2.0-flash-exp",
        generationConfig: {
          responseModalities: ["TEXT"]
        },
        systemInstruction: {
          parts: [{
            text: "You are a real-time subtitle generator for Chinese live streams. " +
                  "Listen to the Chinese speech and output chunks strictly formatted as: " +
                  "HANZI: [characters] | PINYIN: [pinyin with tones] | EN: [English translation]. " +
                  "Be concise, synchronized, and output nothing else."
          }]
        }
      }
    };
    webSocket.send(JSON.stringify(setupMessage));

    // 2. Procesamiento y envío de audio PCM continuo
    setupAudioProcessing(source);
  };

  webSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const textChunk = data.serverContent?.modelTurn?.parts?.[0]?.text;
    if (textChunk) {
      // Reenviar texto procesado para dibujarlo en la UI
      chrome.runtime.sendMessage({ type: 'NEW_SUBTITLE', text: textChunk });
    }
  };
}

function setupAudioProcessing(source) {
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (webSocket.readyState !== WebSocket.OPEN) return;

    const inputData = e.inputBuffer.getChannelData(0);
    // Conversión de Float32 a Int16 (Linear PCM Little-Endian)
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
    const base64Audio = btoa(binary);

    // Envío del chunk de audio en formato realtimeInput
    const audioPayload = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: "audio/pcm;rate=16000",
          data: base64Audio
        }]
      }
    };
    webSocket.send(JSON.stringify(audioPayload));
  };
}