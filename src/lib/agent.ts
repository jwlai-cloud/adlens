import {
  getLiveGenerativeModel,
  ResponseModality,
  startAudioConversation,
  type AI,
  type AudioConversationController,
  type FunctionCall,
  type FunctionResponse,
  type LiveSession,
} from "firebase/ai";
import type { Firestore } from "firebase/firestore";
import { domainKey, lookup, report } from "./blocklist";
import { runDeepCheck } from "./deepCheck";
import { ensureSignedIn } from "./firebase";
import type { FirebaseApp } from "firebase/app";
import type { ScanResult } from "./scan";
import type { PageSignals, Verdict } from "./types";

export const SYSTEM = `You are AdLens, a calm, kind scam-safety helper for older adults and their families.
Speak simply, in short sentences, like a patient grandchild. Keep answers under 4 sentences unless asked.
If the user mentions or shows a web link, call check_link. To see if others reported a website or phone number, call lookup_reports.
If the user just scanned something, call get_last_scan to see the result before answering.
If something is confirmed as a scam, offer to report it so others are warned, and only call report_scam after the user agrees.
If the camera is on, describe briefly what you see only when it matters for safety.
Never ask for or repeat passwords, card numbers, PINs or one-time codes.
If money or bank details were already given, tell them to call their bank now using the number on the back of their card, then report it to the police or the national scam reporting service.`;

export const TOOLS = [
  {
    functionDeclarations: [
      { name: "get_last_scan", description: "Get the result of the last thing the user scanned with AdLens (photo, screenshot or pasted text)." },
      {
        name: "check_link",
        description: "Deep check a web address for scams. Gemini in the cloud opens the page and judges it.",
        parameters: { type: "object", properties: { url: { type: "string", description: "The web address" } }, required: ["url"] },
      },
      {
        name: "lookup_reports",
        description: "Look up whether other AdLens users reported a website or phone number as a scam.",
        parameters: { type: "object", properties: { target: { type: "string", description: "Website address or phone number" } }, required: ["target"] },
      },
      {
        name: "report_scam",
        description: "Report a website or phone number as a scam to the shared AdLens blocklist. Only after the user agrees.",
        parameters: {
          type: "object",
          properties: {
            target: { type: "string", description: "Website address or phone number" },
            verdict: { type: "string", enum: ["suspicious", "scam"] },
            reason: { type: "string", description: "One short reason" },
          },
          required: ["target", "verdict", "reason"],
        },
      },
    ],
  },
];

/** Blocklist key for a website or a phone number. */
export function targetKey(target: string): string {
  const t = target.trim();
  const digits = t.replace(/[^\d+]/g, "");
  if (!/[a-z]/i.test(t) && digits.replace("+", "").length >= 6) return `tel:${digits}`;
  return domainKey(/^https?:\/\//i.test(t) ? t : `https://${t}`);
}

export interface AgentEvent {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface AgentDeps {
  ai: AI;
  app: FirebaseApp;
  db: Firestore;
  liveModel: string;
  deep: { model: string; fallbackModel?: string; templateId: string; search: boolean };
  lastScan: () => ScanResult | null;
  onEvent: (e: AgentEvent) => void;
}

export async function runTool(call: FunctionCall, d: AgentDeps): Promise<unknown> {
  const a = (call.args ?? {}) as Record<string, string>;
  switch (call.name) {
    case "get_last_scan": {
      const s = d.lastScan();
      return s ? { verdict: s.verdict, kind: s.kind, summary: s.summary, reasons: s.reasons, link: s.link, phone: s.phone } : { none: true };
    }
    case "check_link": {
      const url = /^https?:\/\//i.test(a.url) ? a.url : `https://${a.url}`;
      const host = new URL(url).hostname;
      const signals: PageSignals = {
        url, hostname: host, protocol: "https:", title: "", text: "",
        maxDiscount: 0, urgency: [], riskyPayments: [], hasReturnsPolicy: true, hasPrivacyPolicy: true,
        hasContactPage: true, emailDomains: [], metaRefresh: false, cardFieldOnHttp: false, externalCheckoutHosts: [],
      };
      const community = await lookup(d.db, targetKey(url)).catch(() => null);
      const r = await runDeepCheck(d.ai, d.deep, signals, { score: 0, reasons: [] });
      return { verdict: r.verdict, reasons: r.reasons, reportedBy: community?.reports ?? 0 };
    }
    case "lookup_reports": {
      const c = await lookup(d.db, targetKey(a.target));
      return c ? { reported: true, verdict: c.verdict, reasons: c.reasons, reports: c.reports } : { reported: false };
    }
    case "report_scam": {
      await ensureSignedIn(d.app);
      await report(d.db, targetKey(a.target), (a.verdict === "suspicious" ? "suspicious" : "scam") as Verdict, [a.reason ?? ""].filter(Boolean));
      return { reported: true };
    }
    default:
      return { error: `Unknown tool ${call.name}` };
  }
}

export interface Conversation {
  session: LiveSession;
  stop: () => Promise<void>;
  sendFrame: (jpegB64: string) => Promise<void>;
}

/** Starts a live voice conversation (mic in, speech out) with tool calling. Cloud only: Gemini Live API. */
export async function startConversation(d: AgentDeps): Promise<Conversation> {
  const live = getLiveGenerativeModel(d.ai, {
    model: d.liveModel,
    systemInstruction: SYSTEM,
    tools: TOOLS as never,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  });
  const session = await live.connect();
  const controller: AudioConversationController = await startAudioConversation(session, {
    functionCallingHandler: async (calls): Promise<FunctionResponse> => {
      const call = calls[0];
      const ev: AgentEvent = { tool: call.name, args: (call.args ?? {}) as Record<string, unknown> };
      d.onEvent(ev);
      try {
        ev.result = await runTool(call, d);
      } catch (e) {
        ev.error = String((e as Error).message ?? e);
        ev.result = { error: ev.error };
      }
      d.onEvent(ev);
      return { id: call.id, name: call.name, response: ev.result as object };
    },
  });
  return {
    session,
    sendFrame: (data) => session.sendVideoRealtime({ mimeType: "image/jpeg", data }),
    stop: async () => {
      await controller.stop().catch(() => {});
      await session.close().catch(() => {});
    },
  };
}
