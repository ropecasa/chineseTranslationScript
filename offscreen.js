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

    const MODEL_NAME = "gemini-2.0-flash";
    const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    webSocket = new WebSocket(WS_URL);

    webSocket.onopen = () => {
      console.log("[Gemini Live] WebSocket conectado con éxito");

      const setupMessage = {
        setup: {
          model: `models/${MODEL_NAME}`,
          generationConfig: {
            responseModalities: ["TEXT"],
          },
          systemInstruction: {
            parts: [
              {
                text:
                  "You are a real-time Chinese subtitle translator. " +
                  "For every spoken sentence, output exactly 3 lines:\n" +
                  "🇨🇳 [Hanzi characters]\n" +
                  "🔤 [Pinyin with tone marks]\n" +
                  "🇬🇧 [English translation]\n" +
                  "Do not add any other text. Output only when the sentence is complete.",
              },
            ],
          },
        },
      };

      webSocket.send(JSON.stringify(setupMessage));
      setupAudioProcessing(source);
    };

    webSocket.onmessage = async (event) => {
      try {
        // Si la respuesta llega como Blob binario, lo convertimos a string
        let rawData = event.data;
        if (rawData instanceof Blob) {
          rawData = await rawData.text();
        }

        const response = JSON.parse(rawData);
        if (response.serverContent) {
          const content = response.serverContent;
          if (!content) return;

          const textChunk = content.modelTurn?.parts?.[0]?.text;
          const isTurnComplete = content.turnComplete;

          if (textChunk) {
            chrome.runtime.sendMessage({
              type: "NEW_SUBTITLE",
              text: textChunk,
            });
          }

          // Añadir una separación clara entre cada frase detectada
          if (isTurnComplete) {
            chrome.runtime.sendMessage({
              type: "NEW_SUBTITLE",
              text: "\n\n---\n\n",
            });
          }
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
