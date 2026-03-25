import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";

const AGENT_USER_ID = "96995f3b-637e-49f4-8eaa-6f43eb9280bf";
const PORT = process.env.PORT || 5000;

function requireAgentKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  const expected = process.env.VOICE_AGENT_API_KEY;
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).agentUserId = AGENT_USER_ID;
  next();
}

async function internalFetch(path: string, method: string = "GET", body?: any) {
  const url = `http://localhost:${PORT}${path}`;
  const opts: any = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": process.env.VOICE_AGENT_API_KEY || "",
      "X-Internal-User-Id": AGENT_USER_ID,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

export function registerVoiceAgentRoutes(app: Express) {
  app.get("/api/voice-agent/program-types", requireAgentKey, async (_req, res) => {
    try {
      const types = await storage.getProgramTypes();
      const active = types.filter(t => t.isActive);
      res.json({
        programTypes: active.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          dailyCount: t.dailyCount,
          durationSeconds: t.defaultDurationSeconds,
        })),
        summary: `Доступные передачи: ${active.map(t => t.name).join(", ")}`,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get program types" });
    }
  });

  app.post("/api/voice-agent/create-program", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName, date, count } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({
          error: `Передача "${programTypeName}" не найдена`,
          available: types.filter(t => t.isActive).map(t => t.name),
        });
      }

      const dateStr = date || new Date().toISOString().split("T")[0];
      const numPrograms = Math.min(count || 1, 20);

      const created: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < numPrograms; i++) {
        try {
          const targetDate = new Date(dateStr);
          targetDate.setDate(targetDate.getDate() + Math.floor(i / (programType.dailyCount || 1)));
          const targetDateStr = targetDate.toISOString().split("T")[0];

          const response = await internalFetch(`/api/programs/auto-create/${programType.id}`, "POST", { date: targetDateStr });

          if (response.ok) {
            const result = await response.json();
            created.push({
              id: result.id,
              title: result.title,
              date: targetDateStr,
              status: result.status,
            });
          } else {
            const err = await response.json().catch(() => ({ error: "Unknown error" }));
            errors.push(`Выпуск ${i + 1}: ${(err as any).error || "ошибка"}`);
          }
        } catch (e: any) {
          errors.push(`Выпуск ${i + 1}: ${e.message}`);
        }
      }

      res.json({
        success: created.length > 0,
        message: created.length === 1
          ? `Создан выпуск "${created[0].title}" со скриптом на ${created[0].date}.`
          : `Создано ${created.length} выпусков передачи "${programType.name}".${errors.length > 0 ? ` Ошибки: ${errors.length}.` : ""}`,
        created,
        errors: errors.length > 0 ? errors : undefined,
        programType: programType.name,
      });
    } catch (error) {
      console.error("Voice agent create-program error:", error);
      res.status(500).json({ error: "Не удалось создать программу" });
    }
  });

  app.post("/api/voice-agent/generate-audio", requireAgentKey, async (req, res) => {
    try {
      const { programId, programTypeName, date } = req.body;

      let programIds: string[] = [];

      if (programId) {
        programIds = [programId];
      } else if (programTypeName) {
        const types = await storage.getProgramTypes();
        const programType = types.find(t =>
          t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
        );
        if (!programType) {
          return res.status(404).json({ error: `Передача "${programTypeName}" не найдена` });
        }
        const programs = await storage.getProgramsByType(programType.id);
        const dateStr = date || new Date().toISOString().split("T")[0];
        const toVoice = programs.filter(p =>
          p.scriptText && !p.audioUrl && p.scheduledDate === dateStr
        );
        programIds = toVoice.map(p => p.id);
        if (programIds.length === 0) {
          return res.json({
            success: true,
            message: `Нет программ для озвучки "${programType.name}" на ${dateStr}. Все уже озвучены или нет скриптов.`,
          });
        }
      } else {
        return res.status(400).json({ error: "Укажите programId или programTypeName" });
      }

      const results: any[] = [];
      const errors: string[] = [];

      for (const pid of programIds) {
        try {
          const audioRes = await internalFetch(`/api/programs/${pid}/generate-audio`, "POST");
          if (audioRes.ok) {
            const data = await audioRes.json();
            results.push({ id: pid, title: (data as any).title || pid, status: "audio_generated" });
          } else {
            const err = await audioRes.json().catch(() => ({ error: "Unknown" }));
            errors.push(`${pid}: ${(err as any).error || "ошибка"}`);
          }
        } catch (e: any) {
          errors.push(`${pid}: ${e.message}`);
        }
      }

      res.json({
        success: results.length > 0,
        message: results.length === 1
          ? `Аудио сгенерировано для "${results[0].title}".`
          : `Озвучено ${results.length} из ${programIds.length} программ.${errors.length > 0 ? ` Ошибки: ${errors.length}.` : ""}`,
        generated: results.length,
        total: programIds.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Voice agent generate-audio error:", error);
      res.status(500).json({ error: "Не удалось сгенерировать аудио" });
    }
  });

  app.post("/api/voice-agent/full-pipeline", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName, count, date } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({ error: `Передача "${programTypeName}" не найдена` });
      }

      const dateStr = date || new Date().toISOString().split("T")[0];
      const numPrograms = Math.min(count || 1, 20);

      const createdPrograms: any[] = [];
      const voicedPrograms: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < numPrograms; i++) {
        try {
          const targetDate = new Date(dateStr);
          targetDate.setDate(targetDate.getDate() + Math.floor(i / (programType.dailyCount || 1)));
          const targetDateStr = targetDate.toISOString().split("T")[0];

          const createRes = await internalFetch(`/api/programs/auto-create/${programType.id}`, "POST", { date: targetDateStr });

          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            errors.push(`Скрипт ${i + 1}: ${(err as any).error || "ошибка"}`);
            continue;
          }

          const program = await createRes.json();
          createdPrograms.push({ id: program.id, title: program.title, date: targetDateStr });

          const audioRes = await internalFetch(`/api/programs/${program.id}/generate-audio`, "POST");
          if (audioRes.ok) {
            voicedPrograms.push({ id: program.id, title: program.title });
          } else {
            const err = await audioRes.json().catch(() => ({}));
            errors.push(`Аудио "${program.title}": ${(err as any).error || "ошибка"}`);
          }
        } catch (e: any) {
          errors.push(`Выпуск ${i + 1}: ${e.message}`);
        }
      }

      res.json({
        success: createdPrograms.length > 0,
        message: `Передача "${programType.name}": создано ${createdPrograms.length} скриптов, озвучено ${voicedPrograms.length}.${errors.length > 0 ? ` Ошибки: ${errors.length}.` : ""}`,
        scriptsCreated: createdPrograms.length,
        audioGenerated: voicedPrograms.length,
        programs: createdPrograms,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Voice agent full-pipeline error:", error);
      res.status(500).json({ error: "Не удалось выполнить пайплайн" });
    }
  });

  app.get("/api/voice-agent/programs-status", requireAgentKey, async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const types = await storage.getProgramTypes();
      const activeTypes = types.filter(t => t.isActive);

      const results: any[] = [];
      for (const type of activeTypes) {
        const programs = await storage.getProgramsByType(type.id);
        const datePrograms = programs.filter(p => p.scheduledDate === date);
        if (datePrograms.length > 0) {
          results.push({
            programType: type.name,
            count: datePrograms.length,
            withScript: datePrograms.filter(p => p.scriptText).length,
            withAudio: datePrograms.filter(p => p.audioUrl).length,
            programs: datePrograms.map(p => ({
              id: p.id,
              title: p.title,
              status: p.status,
              hasAudio: !!p.audioUrl,
            })),
          });
        }
      }

      const total = results.reduce((sum, r) => sum + r.count, 0);
      const withScript = results.reduce((sum, r) => sum + r.withScript, 0);
      const withAudio = results.reduce((sum, r) => sum + r.withAudio, 0);

      res.json({
        date,
        summary: `На ${date}: всего ${total} программ. Со скриптами: ${withScript}. С аудио: ${withAudio}. Передачи: ${results.map(r => `${r.programType} (${r.count})`).join(", ")}.`,
        total,
        withScript,
        withAudio,
        details: results,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get programs status" });
    }
  });

  app.post("/api/voice-agent/search-web", requireAgentKey, async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }

      const fcApiKey = process.env.FIRECRAWL_API_KEY;
      if (!fcApiKey) {
        return res.status(500).json({ error: "Firecrawl not configured" });
      }

      const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${fcApiKey}`,
        },
        body: JSON.stringify({ query, limit: 3 }),
      });

      if (!fcRes.ok) {
        return res.status(500).json({ error: "Search failed" });
      }

      const data = await fcRes.json() as any;
      const results = (data.data || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: (r.markdown || "").substring(0, 500),
      }));

      res.json({
        query,
        results,
        summary: `Найдено ${results.length} результатов по запросу "${query}".`,
      });
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });
}
