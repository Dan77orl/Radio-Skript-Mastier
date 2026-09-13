/**
 * Claude-with-Gemini-fallback.
 *
 * Every script generator in the app talks to an Anthropic client. When that
 * call fails — credits ran out, the key was rotated, Anthropic is overloaded —
 * the show still has to go on air, so the same request is retried against
 * Gemini and returned in Anthropic's response shape. Callers never know the
 * difference; the substitution is logged and the usage log shows "Gemini".
 *
 * The fallback only steps in when Claude actually FAILS. While Claude answers,
 * Gemini is never called.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/** gemini-2.5-flash is already proven against this deploy's AI gateway (the
 * transcription endpoint uses it); override with GEMINI_FALLBACK_MODEL, e.g.
 * gemini-2.5-pro for higher quality at a higher price. */
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";

let gemini: GoogleGenAI | null | undefined;

/** Test seam: replace the Gemini client with a fake. Not for production use. */
export function __setGeminiForTests(client: unknown) {
  gemini = client as GoogleGenAI | null;
}

function getGemini(): GoogleGenAI | null {
  if (gemini !== undefined) return gemini;
  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    gemini = null;
    return gemini;
  }
  gemini = new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
  return gemini;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c?.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function geminiCreate(params: any): Promise<any> {
  const client = getGemini();
  if (!client) throw new Error("Gemini fallback is not configured");

  const systemInstruction = blockText(params.system) || undefined;
  const contents = (params.messages || []).map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: blockText(m.content) }],
  }));

  const res = await client.models.generateContent({
    model: GEMINI_FALLBACK_MODEL,
    contents,
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      maxOutputTokens: Math.min(params.max_tokens ?? 4096, 65536),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    },
  });

  const text =
    (res as any).text ||
    (res as any).candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ||
    "";
  if (!text.trim()) throw new Error("Gemini fallback returned an empty response");

  // The Anthropic Message shape the app actually reads: content[].text.
  return {
    id: `gemini-fallback-${Date.now()}`,
    type: "message",
    role: "assistant",
    model: GEMINI_FALLBACK_MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * Wrap an Anthropic client so messages.create falls back to Gemini on failure.
 * Requests the fallback can't faithfully translate (streaming, tools) are
 * passed through untouched and fail as they would have.
 */
export function withGeminiFallback<T extends Anthropic>(client: T): T {
  return new Proxy(client as any, {
    get(target, prop, receiver) {
      if (prop !== "messages") {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      }
      const messages = target.messages;
      return new Proxy(messages, {
        get(mTarget, mProp) {
          if (mProp !== "create") {
            const v = Reflect.get(mTarget, mProp);
            return typeof v === "function" ? v.bind(mTarget) : v;
          }
          return async (params: any, opts?: any) => {
            try {
              return await mTarget.create(params, opts);
            } catch (err: any) {
              if (params?.stream || params?.tools) throw err;
              const reason = err?.message?.slice(0, 200) || String(err);
              try {
                const fallback = await geminiCreate(params);
                console.warn(`[ai-fallback] Claude failed (${reason}) — answered by ${GEMINI_FALLBACK_MODEL}`);
                return fallback;
              } catch (geminiErr: any) {
                console.error(`[ai-fallback] Gemini fallback also failed: ${geminiErr?.message}`);
                throw err; // the original Claude error is the actionable one
              }
            }
          };
        },
      });
    },
  }) as T;
}
