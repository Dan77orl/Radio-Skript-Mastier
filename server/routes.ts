import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import { insertSettingsSchema, insertDialogSchema } from "@shared/schema";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings || {});
    } catch (error) {
      console.error("Error getting settings:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const parsed = insertSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const settings = await storage.saveSettings(parsed.data);
      res.json(settings);
    } catch (error) {
      console.error("Error saving settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.get("/api/dialogs", async (req, res) => {
    try {
      const dialogs = await storage.getDialogs();
      res.json(dialogs);
    } catch (error) {
      console.error("Error getting dialogs:", error);
      res.status(500).json({ error: "Failed to get dialogs" });
    }
  });

  app.get("/api/dialogs/:id", async (req, res) => {
    try {
      const dialog = await storage.getDialog(req.params.id);
      if (!dialog) {
        return res.status(404).json({ error: "Dialog not found" });
      }
      res.json(dialog);
    } catch (error) {
      console.error("Error getting dialog:", error);
      res.status(500).json({ error: "Failed to get dialog" });
    }
  });

  app.post("/api/generate-script", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || prompt.length < 10) {
        return res.status(400).json({ error: "Prompt is required and must be at least 10 characters" });
      }

      const systemPrompt = `Ты - сценарист для радио "Алания FM" в Аланье, Турция. 
Твоя задача - написать короткий диалог между двумя ведущими: мужчиной и женщиной.
Диалог должен быть на русском языке, дружелюбным и естественным.
Длительность при чтении - 30-50 секунд.

ВАЖНО: Ответ должен быть в формате JSON:
{
  "maleText": "текст для мужчины (все его реплики через пробел)",
  "femaleText": "текст для женщины (все её реплики через пробел)"
}

Реплики должны чередоваться логично, как естественный диалог.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const parsed = JSON.parse(content);
      res.json({
        maleText: parsed.maleText || "",
        femaleText: parsed.femaleText || "",
      });
    } catch (error) {
      console.error("Error generating script:", error);
      res.status(500).json({ error: "Failed to generate script" });
    }
  });

  app.post("/api/improve-prompt", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { 
            role: "system", 
            content: `Ты помогаешь улучшать промпты для генерации радио-диалогов.
Улучши данный промпт, сделав его более конкретным и детализированным.
Добавь детали о тоне, стиле, возможных шутках или интересных фактах.
Сохрани суть оригинального промпта.
Верни ТОЛЬКО улучшенный промпт, без объяснений.`
          },
          { role: "user", content: prompt }
        ],
        max_completion_tokens: 512,
      });

      const improvedPrompt = response.choices[0]?.message?.content || prompt;
      res.json({ improvedPrompt });
    } catch (error) {
      console.error("Error improving prompt:", error);
      res.status(500).json({ error: "Failed to improve prompt" });
    }
  });

  app.post("/api/test-elevenlabs", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: "API key is required" });
      }

      const response = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: {
          "xi-api-key": apiKey,
        },
      });

      if (!response.ok) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error testing ElevenLabs:", error);
      res.status(500).json({ error: "Failed to test connection" });
    }
  });

  app.post("/api/generate-audio", async (req, res) => {
    try {
      const { maleText, femaleText, title, scheduledDate, slotNumber } = req.body;
      
      if (!maleText || !femaleText) {
        return res.status(400).json({ error: "Both male and female texts are required" });
      }

      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured. Please add it in Settings." });
      }

      const maleVoiceId = settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9";
      const femaleVoiceId = settings.femaleVoiceId || "EXAVITQu4vr4xnSDxMaL";

      const generateVoice = async (text: string, voiceId: string): Promise<Buffer> => {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": settings.elevenLabsApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      };

      const [maleAudio, femaleAudio] = await Promise.all([
        generateVoice(maleText, maleVoiceId),
        generateVoice(femaleText, femaleVoiceId),
      ]);

      const audioDir = path.join(process.cwd(), "public", "audio");
      await fs.mkdir(audioDir, { recursive: true });

      const timestamp = Date.now();
      const maleFile = path.join(audioDir, `male_${timestamp}.mp3`);
      const femaleFile = path.join(audioDir, `female_${timestamp}.mp3`);
      const combinedFile = path.join(audioDir, `dialog_${timestamp}.mp3`);

      await fs.writeFile(maleFile, maleAudio);
      await fs.writeFile(femaleFile, femaleAudio);

      const combined = Buffer.concat([maleAudio, femaleAudio]);
      await fs.writeFile(combinedFile, combined);

      await fs.unlink(maleFile).catch(() => {});
      await fs.unlink(femaleFile).catch(() => {});

      const dialog = await storage.createDialog({
        title: title || "Подводка",
        prompt: "",
        scriptText: `${maleText}\n\n${femaleText}`,
        maleText,
        femaleText,
        audioUrl: `/audio/dialog_${timestamp}.mp3`,
        duration: Math.round((combined.length / 1024) * 0.5),
        status: "ready",
        scheduledDate: scheduledDate || null,
        slotNumber: slotNumber || null,
        uploadedToYandex: false,
        yandexPath: null,
      });

      res.json(dialog);
    } catch (error) {
      console.error("Error generating audio:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate audio" });
    }
  });

  app.delete("/api/dialogs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteDialog(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Dialog not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting dialog:", error);
      res.status(500).json({ error: "Failed to delete dialog" });
    }
  });

  return httpServer;
}
