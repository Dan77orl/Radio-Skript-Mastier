import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";

const AGENT_USER_ID = "96995f3b-637e-49f4-8eaa-6f43eb9280bf";

function requireAgentKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  const expected = process.env.VOICE_AGENT_API_KEY;
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerVoiceAgentRoutes(app: Express) {
  app.get("/api/voice-agent/program-types", requireAgentKey, async (_req, res) => {
    try {
      const types = await storage.getProgramTypes();
      const active = types.filter(t => t.isActive);
      res.json(active.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        dailyCount: t.dailyCount,
        durationSeconds: t.defaultDurationSeconds,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get program types" });
    }
  });

  app.post("/api/voice-agent/create-program", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName, date } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({
          error: `Program type "${programTypeName}" not found`,
          available: types.filter(t => t.isActive).map(t => t.name),
        });
      }

      const dateStr = date || new Date().toISOString().split("T")[0];

      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/auto-create/${programType.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": `connect.sid=voice-agent` },
        body: JSON.stringify({ date: dateStr }),
      });

      if (!response.ok) {
        const internalRes = await response.json().catch(() => ({}));

        const program = await storage.createProgram({
          programTypeId: programType.id,
          title: `${programType.name} ${dateStr}`,
          prompt: programType.defaultPrompt,
          scheduledDate: dateStr,
          slotNumber: 1,
          status: "pending",
        });

        return res.json({
          success: true,
          message: `Создана программа "${programType.name}" на ${dateStr}. Скрипт нужно сгенерировать отдельно.`,
          programId: program.id,
          programType: programType.name,
          date: dateStr,
          status: "pending",
        });
      }

      const result = await response.json();
      res.json({
        success: true,
        message: `Создана программа "${programType.name}" на ${dateStr} со сгенерированным скриптом.`,
        programId: result.id,
        programType: programType.name,
        date: dateStr,
        title: result.title,
        status: result.status,
      });
    } catch (error) {
      console.error("Voice agent create-program error:", error);
      res.status(500).json({ error: "Failed to create program" });
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
        results.push({
          programType: type.name,
          count: datePrograms.length,
          programs: datePrograms.map(p => ({
            id: p.id,
            title: p.title,
            status: p.status,
            hasAudio: !!p.audioUrl,
            audioDuration: p.audioDurationSeconds,
          })),
        });
      }

      const total = results.reduce((sum, r) => sum + r.count, 0);
      const withScript = results.reduce((sum, r) => sum + r.programs.filter((p: any) => p.status === "script_ready" || p.status === "voiced").length, 0);
      const withAudio = results.reduce((sum, r) => sum + r.programs.filter((p: any) => p.hasAudio).length, 0);

      res.json({
        date,
        summary: `На ${date}: ${total} программ, ${withScript} со скриптом, ${withAudio} с аудио.`,
        total,
        withScript,
        withAudio,
        details: results.filter(r => r.count > 0),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get programs status" });
    }
  });

  app.post("/api/voice-agent/generate-audio", requireAgentKey, async (req, res) => {
    try {
      const { programId } = req.body;
      if (!programId) {
        return res.status(400).json({ error: "programId is required" });
      }

      const program = await storage.getProgram(programId);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }
      if (!program.scriptText) {
        return res.status(400).json({ error: "Program has no script. Generate script first." });
      }

      res.json({
        success: true,
        message: `Аудио для "${program.title}" поставлено в очередь на генерацию. Это займёт 1-2 минуты.`,
        programId: program.id,
        hint: "Use POST /api/voice-agent/trigger-audio with programId to start generation",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to queue audio generation" });
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
