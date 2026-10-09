let webSocket = null;
let audioContext = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "INIT_CAPTURE") {
    startCapture(msg.streamId, msg.apiKey);
  }
});

async function startCapture(streamId, apiKey) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);

    //cambiamos a v1beta debido a que gemini 2.0 no tiene version en v1beta
    const host = "generativelanguage.googleapis.com";
    const endpoint = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    webSocket = new WebSocket(endpoint);

    webSocket.onopen = () => {
      console.log("[Gemini Live] Conectado");

      // Handshake inicial: respuesta en texto, sin voz de agente y con formato estricto
      const setupMessage = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["TEXT"],
            temperature: 0.1,
          },
          systemInstruction: {
            parts: [
              {
                text:
                  "You are an automated real-time subtitle generator. " +
                  "Continuously process the Chinese audio stream. Do NOT chat or answer. " +
                  "For every spoken utterance, output strictly in this single-line format:\n" +
                  "[ZH] <Chinese> | [PY] <Pinyin with tone marks> | [EN] <English Translation>\n" +
                  "Output nothing else.",
              },
            ],
          },
        },
      };

      webSocket.send(JSON.stringify(setupMessage));
      setupAudioProcessing(source);
    };

    webSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const text = data.serverContent?.modelTurn?.parts?.[0]?.text;
        if (text) {
          chrome.runtime.sendMessage({ type: "NEW_SUBTITLE", text: text });
        }
      } catch (err) {
        console.error("Error parseando respuesta:", err);
      }
    };

    webSocket.onerror = (err) => console.error("[Gemini WS] Error:", err);
    webSocket.onclose = (e) =>
      console.warn("[Gemini WS] Cerrado:", e.code, e.reason);
  } catch (err) {
    console.error("[Capture Error]:", err);
  }
}

function setupAudioProcessing(source) {
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const uint8Bytes = new Uint8Array(pcm16.buffer);
    let binary = "";
    for (let i = 0; i < uint8Bytes.byteLength; i++) {
      binary += String.fromCharCode(uint8Bytes[i]);
    }

    webSocket.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "audio/pcm;rate=16000",
              data: btoa(binary),
            },
          ],
        },
      }),
    );
  };
}
