import { registerJobHandler } from "./queue";
import { internalAuthHeaders } from "../auth";
import { storage } from "../storage";
import { registerAdProducer } from "./ad-producer";

/**
 * Call the app's own API as the given user. The scheduler and the voice agent
 * both drive existing endpoints rather than duplicating their logic.
 */
async function internalFetch(userId: string, path: string, method = "GET", body?: unknown) {
  const port = process.env.PORT || 5000;
  const headers = internalAuthHeaders(userId);
  if (!headers["x-internal-key"]) {
    throw new Error("INTERNAL_API_KEY (or VOICE_AGENT_API_KEY) is not set — internal API calls cannot authenticate");
  }
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export interface GenerateAudioPayload {
  userId: string;
  programIds: string[];
}

export interface FullPipelinePayload {
  userId: string;
  programTypeId: string;
  count: number;
  date: string;
}

export function registerJobHandlers() {
  registerAdProducer();

  registerJobHandler("program.generate-audio", async (payload: GenerateAudioPayload, ctx) => {
    const { userId, programIds } = payload;
    const done: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const [i, programId] of programIds.entries()) {
      if (ctx.isCancelled()) break;
      await ctx.setProgress(`Озвучка ${i + 1} из ${programIds.length}`);
      try {
        await internalFetch(userId, `/api/programs/${programId}/generate-audio`, "POST");
        done.push(programId);
      } catch (err: any) {
        // One bad program must not sink the batch — record and keep going.
        failed.push({ id: programId, error: err?.message || "unknown" });
        console.error(`[jobs] audio failed for program ${programId}:`, err?.message);
      }
    }

    return { total: programIds.length, done: done.length, failed };
  });

  registerJobHandler("program.full-pipeline", async (payload: FullPipelinePayload, ctx) => {
    const { userId, programTypeId, count, date } = payload;
    const programType = await storage.getProgramType(programTypeId, userId);
    if (!programType) throw new Error(`Program type ${programTypeId} not found for this user`);

    const created: Array<{ id: string; title: string; date: string }> = [];
    const failed: Array<{ index: number; error: string }> = [];
    const dailyCount = programType.dailyCount || 1;

    for (let i = 0; i < count; i++) {
      if (ctx.isCancelled()) break;
      await ctx.setProgress(`Выпуск ${i + 1} из ${count}: сценарий`);

      // Advance the date every `dailyCount` episodes. Built from date parts so a
      // timezone offset cannot shift the day (new Date("YYYY-MM-DD") is UTC
      // midnight, and local-time arithmetic on it drifts).
      const [y, m, d] = date.split("-").map(Number);
      const target = new Date(Date.UTC(y, m - 1, d));
      target.setUTCDate(target.getUTCDate() + Math.floor(i / dailyCount));
      const targetDate = target.toISOString().split("T")[0];

      try {
        const program: any = await internalFetch(
          userId,
          `/api/programs/auto-create/${programTypeId}`,
          "POST",
          { date: targetDate },
        );
        created.push({ id: program.id, title: program.title, date: targetDate });

        await ctx.setProgress(`Выпуск ${i + 1} из ${count}: озвучка`);
        await internalFetch(userId, `/api/programs/${program.id}/generate-audio`, "POST");
      } catch (err: any) {
        failed.push({ index: i + 1, error: err?.message || "unknown" });
        console.error(`[jobs] pipeline step ${i + 1}/${count} failed:`, err?.message);
      }
    }

    return { requested: count, created, failed };
  });
}
