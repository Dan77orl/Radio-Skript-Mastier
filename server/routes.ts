import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema } from "@shared/schema";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

async function getAnthropicClient(): Promise<Anthropic | null> {
  const settings = await storage.getSettings();
  if (!settings?.anthropicApiKey) {
    return null;
  }
  return new Anthropic({ apiKey: settings.anthropicApiKey });
}

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

      const anthropic = await getAnthropicClient();
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format from Claude" });
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return res.json({
          maleText: parsed.maleText || "",
          femaleText: parsed.femaleText || "",
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
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

      const systemPrompt = `Ты помогаешь улучшать промпты для генерации радио-диалогов.
Улучши данный промпт, сделав его более конкретным и детализированным.
Добавь детали о тоне, стиле, возможных шутках или интересных фактах.
Сохрани суть оригинального промпта.
Верни ТОЛЬКО улучшенный промпт, без объяснений.`;

      const anthropic = await getAnthropicClient();

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });

        const textContent = response.content.find(c => c.type === "text");
        const improvedPrompt = textContent && textContent.type === "text" ? textContent.text : prompt;
        return res.json({ improvedPrompt });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
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

  app.get("/api/news-sources", async (req, res) => {
    try {
      const sources = await storage.getNewsSources();
      res.json(sources);
    } catch (error) {
      console.error("Error getting news sources:", error);
      res.status(500).json({ error: "Failed to get news sources" });
    }
  });

  app.post("/api/news-sources", async (req, res) => {
    try {
      const parsed = insertNewsSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const source = await storage.createNewsSource(parsed.data);
      res.json(source);
    } catch (error) {
      console.error("Error creating news source:", error);
      res.status(500).json({ error: "Failed to create news source" });
    }
  });

  app.patch("/api/news-sources/:id", async (req, res) => {
    try {
      const updated = await storage.updateNewsSource(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "News source not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating news source:", error);
      res.status(500).json({ error: "Failed to update news source" });
    }
  });

  app.delete("/api/news-sources/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteNewsSource(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "News source not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting news source:", error);
      res.status(500).json({ error: "Failed to delete news source" });
    }
  });

  app.post("/api/moderate-script", async (req, res) => {
    try {
      const { maleText, femaleText, dialogId } = req.body;
      
      if (!maleText && !femaleText) {
        return res.status(400).json({ error: "Script text is required" });
      }

      const fullScript = `Мужской голос: ${maleText || ""}\n\nЖенский голос: ${femaleText || ""}`;

      const systemPrompt = `Ты - модератор контента для радиостанции "Алания FM". 
Твоя задача - проверить радио-скрипт на соответствие следующим правилам:
1. Нет оскорбительного или неуместного контента
2. Нет политических или религиозных высказываний
3. Нет рекламы конкурентов
4. Язык подходит для семейной аудитории
5. Контент соответствует формату радио

Ответь в формате JSON:
{
  "approved": true/false,
  "notes": "краткое описание проблем или 'Контент одобрен'",
  "suggestions": ["список предложений по улучшению, если есть"]
}`;

      let result;
      const anthropic = await getAnthropicClient();

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: fullScript }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude moderator" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format from Claude" });
        }

        result = JSON.parse(jsonMatch[0]);
      } else {
        const response = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: fullScript }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 512,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          return res.status(500).json({ error: "No response from AI moderator" });
        }

        result = JSON.parse(content);
      }

      if (dialogId) {
        await storage.updateDialog(dialogId, {
          moderationStatus: result.approved ? "approved" : "flagged",
          moderationNotes: result.notes,
        });
      }

      res.json({
        approved: result.approved,
        notes: result.notes,
        suggestions: result.suggestions || [],
      });
    } catch (error) {
      console.error("Error moderating script:", error);
      res.status(500).json({ error: "Failed to moderate script" });
    }
  });

  app.post("/api/fetch-news", async (req, res) => {
    try {
      const { sourceId } = req.body;
      const sources = sourceId 
        ? [await storage.getNewsSource(sourceId)].filter(Boolean)
        : await storage.getNewsSources();
      
      const activeSources = sources.filter(s => s?.isActive);
      
      if (activeSources.length === 0) {
        return res.status(400).json({ error: "No active news sources found" });
      }

      const newsPrompt = `На основе источников новостей для экспатов в Аланье, Турция, 
сгенерируй 3-5 актуальных тем для радио-подводок.
Источники: ${activeSources.map(s => s?.name).join(", ")}

Ответь в формате JSON:
{
  "topics": [
    {"title": "заголовок темы", "description": "краткое описание", "category": "категория"}
  ]
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: "Ты помогаешь находить интересные темы для радио-подводок из новостей." },
          { role: "user", content: newsPrompt }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const result = JSON.parse(content);
      res.json(result);
    } catch (error) {
      console.error("Error fetching news:", error);
      res.status(500).json({ error: "Failed to fetch news topics" });
    }
  });

  return httpServer;
}
