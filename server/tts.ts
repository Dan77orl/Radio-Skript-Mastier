/**
 * Single entry point for ElevenLabs text-to-speech.
 *
 * The five call sites in routes.ts each had their own copy of this fetch, and
 * each copy carried the same two contract bugs (output_format in the body, an
 * unquantized stability). Keeping one implementation means a fix lands
 * everywhere at once.
 */

export const ELEVENLABS_MODEL_ID = "eleven_v3";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_192";
/** Available on every plan; 192 kbps needs Creator or above. */
export const ELEVENLABS_FALLBACK_FORMAT = "mp3_44100_128";

/** Stability steps eleven_v3 accepts — Creative / Natural / Robust. */
const V3_STABILITY_STEPS = [0, 0.5, 1] as const;

/**
 * eleven_v3 rejects any stability outside {0, 0.5, 1}, but the settings slider
 * is continuous and defaults to 0.75 — which the API refuses, failing every
 * segment of a script. Snap to the nearest legal step; a tie (0.25, 0.75)
 * resolves downward, toward the more expressive setting.
 */
export function quantizeStability(stability: number, modelId: string = ELEVENLABS_MODEL_ID): number {
  if (modelId !== "eleven_v3") return stability;
  const clamped = Math.min(1, Math.max(0, stability));
  return V3_STABILITY_STEPS.reduce((best, step) =>
    Math.abs(step - clamped) < Math.abs(best - clamped) ? step : best
  );
}

/** Carries the upstream status and body so callers can report the real cause. */
export class ElevenLabsError extends Error {
  // Plain fields, not constructor parameter properties: Node's strip-only
  // TypeScript mode rejects those, and the tests run straight through node.
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`ElevenLabs ${status}: ${body.slice(0, 300)}`);
    this.name = "ElevenLabsError";
    this.status = status;
    this.body = body;
  }

  /**
   * The human-readable message ElevenLabs put in the error body, if any.
   * Bodies come as {"detail": "..."}, {"detail": {"status", "message"}} or
   * FastAPI validation arrays [{"msg": "..."}].
   */
  get apiMessage(): string | null {
    try {
      const parsed = JSON.parse(this.body);
      const detail = parsed?.detail ?? parsed;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) return detail.map((d) => d?.msg).filter(Boolean).join("; ") || null;
      if (typeof detail?.message === "string") return detail.message;
      if (typeof detail?.status === "string") return detail.status;
    } catch {
      // Not JSON — fall through to the raw snippet.
    }
    return this.body ? this.body.slice(0, 120) : null;
  }

  /** Short, user-facing reason — status classification plus the API's own words. */
  get reason(): string {
    const label =
      this.status === 401 ? "ключ ElevenLabs отклонён" :
      this.status === 402 ? "закончились кредиты ElevenLabs" :
      this.status === 422 ? "ElevenLabs отклонил параметры запроса" :
      this.status === 429 ? "лимит запросов ElevenLabs" :
      `ElevenLabs ${this.status}`;
    const msg = this.apiMessage;
    return msg ? `${label}: ${msg}` : label;
  }
}

/** The emotion-tag vocabulary the script generator is instructed to use. */
const EMOTION_TAG_RE = /\[(energetic|fast|slow|surprised|thoughtful|happy|sad|exclaims|announcer|serious|calm|excited|warm|dramatic|whisper|whispers|loud|gentle|playful|confident|nervous|angry|romantic|mysterious|urgent|casual|formal|ironic|sarcastic|laughs|sighs|curious)\]/gi;

/**
 * eleven_v3 is steered by bracketed audio tags — [excited], [whispers] — so
 * stripping them (correct for older models, which read tags aloud) flattens
 * v3's delivery until it sounds like the previous generation. Keep tags for
 * v3, canonicalizing the spellings that differ; strip them for anything else.
 */
export function prepareTtsText(text: string, modelId: string = ELEVENLABS_MODEL_ID): string {
  if (modelId === "eleven_v3") {
    return text.replace(/\[whisper\]/gi, "[whispers]").replace(/\s{2,}/g, " ").trim();
  }
  return text.replace(EMOTION_TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}

export interface SynthesizeOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  stability: number;
  similarityBoost: number;
  modelId?: string;
  outputFormat?: string;
}

/** True when the error is the plan refusing the requested output format. */
function isFormatRejection(err: ElevenLabsError): boolean {
  return (
    (err.status === 400 || err.status === 403) &&
    /output_format|bitrate|subscri|tier|sample_rate/i.test(err.body)
  );
}

async function requestSpeech(
  { apiKey, voiceId, text, stability, similarityBoost, modelId = ELEVENLABS_MODEL_ID }: SynthesizeOptions,
  outputFormat: string,
): Promise<Buffer> {
  // output_format is a query parameter; sending it in the body is silently
  // ignored and you quietly get the 128 kbps default instead.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: prepareTtsText(text, modelId),
      model_id: modelId,
      voice_settings: {
        stability: quantizeStability(stability, modelId),
        similarity_boost: similarityBoost,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ElevenLabsError(response.status, body);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeSpeech(options: SynthesizeOptions): Promise<Buffer> {
  const outputFormat = options.outputFormat ?? ELEVENLABS_OUTPUT_FORMAT;
  try {
    return await requestSpeech(options, outputFormat);
  } catch (err) {
    // 192 kbps needs the Creator plan; below it the API answers 400. Dropping
    // to 128 kbps is what the app silently shipped for months anyway (the old
    // code put output_format in the body, where it was ignored), so a lower
    // bitrate beats a dead broadcast.
    if (
      err instanceof ElevenLabsError &&
      isFormatRejection(err) &&
      outputFormat !== ELEVENLABS_FALLBACK_FORMAT
    ) {
      console.warn(`ElevenLabs rejected ${outputFormat} (${err.apiMessage}); retrying at ${ELEVENLABS_FALLBACK_FORMAT}`);
      return await requestSpeech(options, ELEVENLABS_FALLBACK_FORMAT);
    }
    throw err;
  }
}

/** Best-effort short reason for any synthesis failure, for API `details`. */
export function describeTtsError(err: unknown): string {
  if (err instanceof ElevenLabsError) return err.reason;
  return err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
}
