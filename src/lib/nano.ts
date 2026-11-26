import type { GenerativeModel } from "firebase/ai";

export type NanoStatus = "available" | "downloadable" | "downloading" | "unavailable";

/** Whether Gemini Nano can run in this browser right now. */
export async function nanoStatus(): Promise<NanoStatus> {
  if (typeof LanguageModel === "undefined") return "unavailable";
  try {
    return (await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    })) as NanoStatus;
  } catch {
    return "unavailable";
  }
}

/** Starts the on-device model download. Must be called from a click (user activation). */
export function downloadNano(model: GenerativeModel, onProgress: (fraction: number) => void): Promise<void> {
  return model.initializeDeviceModel(onProgress);
}
