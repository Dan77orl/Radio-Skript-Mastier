import path from "path";
import { promises as fs } from "fs";
import { registerJobHandler, getJobHandler } from "./queue";
import { internalAuthHeaders } from "../auth";
import { storage } from "../storage";
import { mixVoiceWithMusic, downloadToFile, probeDurationSeconds } from "../audio/mix";

export interface ProduceAdPayload {
  userId: string;
  adId: string;
  voiceIds?: string[];
  speakerVoiceMap?: Record<string, string>;
  /** Skip the music pass and ship the dry voice track. */
  skipMusic?: boolean;
}

async function api(userId: string, pathname: string, method = "GET", body?: unknown): Promise<any> {
  const port = process.env.PORT || 5000;
  const headers = internalAuthHeaders(userId);
  if (!headers["x-internal-key"]) {
    throw new Error("INTERNAL_API_KEY (or VOICE_AGENT_API_KEY) is not set — the ad producer cannot call the internal API");
  }
  const res = await fetch(`http://localhost:${port}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${pathname} → ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export function pickVariantIndex(variants: string[], targetSeconds: number): number {
  // Closest to the target read length wins; ~150 words per minute.
  const targetWords = Math.max(10, Math.round((targetSeconds / 60) * 150));
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  variants.forEach((variant, i) => {
    const words = variant.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).filter(Boolean).length;
    const distance = Math.abs(words - targetWords);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

export function registerAdProducer() {
  registerJobHandler("ad.produce", async (payload: ProduceAdPayload, ctx) => {
    const { userId, adId, voiceIds, speakerVoiceMap, skipMusic } = payload;

    const ad = await storage.getAd(adId, userId);
    if (!ad) throw new Error(`Ad ${adId} not found for this user`);

    const steps: string[] = [];

    // 1 — script. Reuses the existing variant generator, which already folds in
    // attachments, the website and the Instagram profile.
    let selectedText = ad.selectedVariantText;
    if (!selectedText) {
      await ctx.setProgress("Пишу сценарий");
      const generated = await api(userId, `/api/ads/${adId}/generate-variants`, "POST", {});
      const variants: string[] = generated?.variants || [];
      if (!variants.length) throw new Error("Script generation returned no variants");

      const index = pickVariantIndex(variants, ad.targetDurationSeconds || 30);
      await api(userId, `/api/ads/${adId}/select-variant`, "POST", { variantIndex: index });
      selectedText = variants[index];
      steps.push(`сценарий: вариант ${index + 1} из ${variants.length}`);
    } else {
      steps.push("сценарий: уже был выбран");
    }

    // 2 — voice. Run inline rather than enqueuing: this job already holds a
    // worker slot, and waiting here for a queued child would deadlock the pool.
    await ctx.setProgress("Озвучиваю");
    const synthesize = getJobHandler("ad.synthesize-audio");
    if (!synthesize) throw new Error("Audio synthesis handler is not registered");
    await synthesize(
      {
        adId,
        userId,
        voiceIds: voiceIds || ad.voiceIds || undefined,
        speakerVoiceMap,
        scriptText: selectedText,
      },
      ctx,
    );

    const voiced = await storage.getAd(adId, userId);
    if (!voiced?.audioUrl) throw new Error("Synthesis finished but produced no audio");
    const voiceUrl = voiced.audioUrl;
    steps.push("озвучка готова");

    if (skipMusic) {
      return { adId, steps, audioUrl: voiceUrl, audioWithMusicUrl: null };
    }

    // 3 — music. A spot without a bed is the thing that made output feel unfinished.
    await ctx.setProgress("Подбираю музыку");
    let trackUrl: string | null = null;
    let trackName: string | null = null;
    try {
      const music = await api(userId, "/api/music/auto-select", "POST", {
        adText: selectedText,
        category: ad.category || "general",
        title: ad.title,
      });
      const track = music?.recommendedTrack;
      if (track?.audioUrl) {
        trackUrl = track.audioUrl;
        trackName = track.title || null;
      }
    } catch (err: any) {
      console.warn(`[ad-producer] music lookup failed for ${adId}:`, err?.message);
    }

    if (!trackUrl) {
      // No bed available is a degraded result, not a failed job — the voice spot
      // is still usable and the operator can add music by hand.
      steps.push("музыка не найдена, ролик остался без подложки");
      await storage.updateAd(adId, userId, { status: "ready" });
      return { adId, steps, audioUrl: voiceUrl, audioWithMusicUrl: null };
    }

    // 4 — mix.
    await ctx.setProgress("Свожу голос с музыкой");
    const audioDir = path.join(process.cwd(), "public", "audio");
    await fs.mkdir(audioDir, { recursive: true });

    const voicePath = path.join(process.cwd(), "public", voiceUrl.replace(/^\//, ""));
    const musicPath = path.join(audioDir, `_music_${adId}_${Date.now()}.mp3`);
    const mixedName = `ad_${adId}_mixed_${Date.now()}.mp3`;
    const mixedPath = path.join(audioDir, mixedName);

    try {
      await downloadToFile(trackUrl, musicPath);
      const { durationSeconds } = await mixVoiceWithMusic(voicePath, musicPath, mixedPath);

      await storage.updateAd(adId, userId, {
        musicTrackUrl: trackUrl,
        musicTrackName: trackName,
        audioWithMusicUrl: `/audio/${mixedName}`,
        duration: Math.round(durationSeconds),
        status: "ready",
      });
      steps.push(`сведено с музыкой${trackName ? ` «${trackName}»` : ""}`);

      return {
        adId,
        steps,
        audioUrl: voiceUrl,
        audioWithMusicUrl: `/audio/${mixedName}`,
        durationSeconds: Math.round(durationSeconds),
      };
    } finally {
      await fs.unlink(musicPath).catch(() => {});
    }
  });
}
