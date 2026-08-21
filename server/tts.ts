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

  /** Short, user-facing reason — the raw body is developer-facing noise. */
  get reason(): string {
    if (this.status === 401) return "ключ ElevenLabs отклонён";
    if (this.status === 402) return "закончились кредиты ElevenLabs";
    if (this.status === 422) return "ElevenLabs отклонил параметры запроса";
    if (this.status === 429) return "лимит запросов ElevenLabs";
    return `ElevenLabs ${this.status}`;
  }
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

export async function synthesizeSpeech({
  apiKey,
  voiceId,
  text,
  stability,
  similarityBoost,
  modelId = ELEVENLABS_MODEL_ID,
  outputFormat = ELEVENLABS_OUTPUT_FORMAT,
}: SynthesizeOptions): Promise<Buffer> {
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
      text,
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

/** Best-effort short reason for any synthesis failure, for API `details`. */
export function describeTtsError(err: unknown): string {
  if (err instanceof ElevenLabsError) return err.reason;
  return err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
}
