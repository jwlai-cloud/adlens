import { getGenerativeModel, ResponseModality, type AI } from "firebase/ai";
import { withRetry } from "./retry";

let ctx: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;

/** Reads text aloud with a Gemini TTS model (24 kHz 16-bit PCM). */
export async function speak(ai: AI, model: string, text: string): Promise<void> {
  stopSpeaking();
  const tts = getGenerativeModel(ai, {
    model,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  });
  const res = await withRetry(() => tts.generateContent(`Say calmly and clearly, like a kind friend: ${text}`));
  const part = res.response.inlineDataParts()?.[0]?.inlineData;
  if (!part) throw new Error("No audio returned");
  const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0));
  const rate = Number(/rate=(\d+)/.exec(part.mimeType)?.[1] ?? 24000);
  const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  ctx ??= new AudioContext();
  const buf = ctx.createBuffer(1, samples.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  current = ctx.createBufferSource();
  current.buffer = buf;
  current.connect(ctx.destination);
  await new Promise<void>((resolve) => {
    current!.onended = () => resolve();
    current!.start();
  });
}

export function stopSpeaking() {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = undefined;
}
