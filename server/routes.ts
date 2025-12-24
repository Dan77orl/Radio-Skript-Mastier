import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema, insertAdSchema, insertVoiceSchema } from "@shared/schema";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import multer from "multer";

const uploadDir = path.join(process.cwd(), "public", "uploads");

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

interface ParsedNewsItem {
  title: string;
  summary?: string;
  content?: string;
  url?: string;
  publishedAt?: string;
  category?: string;
}

async function fetchNewsFromSource(source: { url: string; type: string }): Promise<ParsedNewsItem[]> {
  try {
    const response = await fetch(source.url);
    const text = await response.text();
    
    if (source.type === "rss") {
      const items: ParsedNewsItem[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      
      while ((match = itemRegex.exec(text)) !== null) {
        const itemContent = match[1];
        const getTag = (tag: string) => {
          const tagMatch = itemContent.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
          return tagMatch ? (tagMatch[1] || tagMatch[2] || "").trim() : "";
        };
        
        const title = getTag("title");
        const description = getTag("description");
        const link = getTag("link");
        const pubDate = getTag("pubDate");
        const category = getTag("category");
        
        if (title) {
          items.push({
            title,
            summary: description.substring(0, 500),
            url: link,
            publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
            category: category || undefined,
          });
        }
      }
      
      return items.slice(0, 20);
    }
    
    return [];
  } catch (error) {
    console.error("Error fetching news from source:", error);
    return [];
  }
}

async function getAnthropicClient(): Promise<Anthropic | null> {
  const settings = await storage.getSettings();
  if (!settings?.anthropicApiKey) {
    return null;
  }
  return new Anthropic({ apiKey: settings.anthropicApiKey });
}

interface StationContext {
  stationName: string;
  stationDescription: string;
  malePersona: string;
  femalePersona: string;
  personaList: string;
}

async function buildStationContext(): Promise<StationContext> {
  const settings = await storage.getSettings();
  const voices = await storage.getVoices();
  
  const stationName = settings?.stationName || "Alanya FM";
  const stationDescription = settings?.stationDescription || "русскоязычная радиостанция для экспатов в Аланье, Турция";
  
  const activeVoices = voices.filter(v => v.isActive);
  const maleVoices = activeVoices.filter(v => v.gender === "male");
  const femaleVoices = activeVoices.filter(v => v.gender === "female");
  
  const malePersona = maleVoices.length > 0 
    ? maleVoices.map(v => v.personaName || v.name).join(", ")
    : "ведущий";
  const femalePersona = femaleVoices.length > 0 
    ? femaleVoices.map(v => v.personaName || v.name).join(", ")
    : "ведущая";
  
  const personaList = activeVoices.length > 0 
    ? activeVoices.map(v => `${v.personaName || v.name} (${v.gender === "male" ? "мужчина" : "женщина"})`).join(", ")
    : "ведущий (мужчина), ведущая (женщина)";
  
  return { stationName, stationDescription, malePersona, femalePersona, personaList };
}

interface WeatherData {
  temperature: number;
  windspeed: number;
  winddirection: number;
  weathercode: number;
  time: string;
  daily?: {
    temperature_max: number[];
    temperature_min: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
  };
}

const ALANYA_COORDS = { lat: 36.5444, lon: 31.9997 };

async function fetchAlanayWeather(): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${ALANYA_COORDS.lat}&longitude=${ALANYA_COORDS.lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset&timezone=Europe/Istanbul`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      temperature: data.current_weather?.temperature,
      windspeed: data.current_weather?.windspeed,
      winddirection: data.current_weather?.winddirection,
      weathercode: data.current_weather?.weathercode,
      time: data.current_weather?.time,
      daily: data.daily ? {
        temperature_max: data.daily.temperature_2m_max,
        temperature_min: data.daily.temperature_2m_min,
        precipitation_sum: data.daily.precipitation_sum,
        sunrise: data.daily.sunrise,
        sunset: data.daily.sunset,
      } : undefined,
    };
  } catch (error) {
    console.error("Error fetching weather:", error);
    return null;
  }
}

function getWeatherDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: "ясно",
    1: "преимущественно ясно",
    2: "переменная облачность",
    3: "пасмурно",
    45: "туман",
    48: "изморозь",
    51: "легкая морось",
    53: "морось",
    55: "сильная морось",
    61: "небольшой дождь",
    63: "дождь",
    65: "сильный дождь",
    71: "небольшой снег",
    73: "снег",
    75: "сильный снег",
    80: "ливень",
    81: "умеренный ливень",
    82: "сильный ливень",
    95: "гроза",
    96: "гроза с градом",
    99: "сильная гроза с градом",
  };
  return descriptions[code] || "неизвестно";
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

  app.post("/api/upload/logo", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const url = `/uploads/${req.file.filename}`;
      res.json({ url });
    } catch (error) {
      console.error("Error uploading logo:", error);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  });

  app.post("/api/upload/attachment", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const url = `/uploads/${req.file.filename}`;
      res.json({ url });
    } catch (error) {
      console.error("Error uploading attachment:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  });

  app.get("/api/weather", async (req, res) => {
    try {
      const weather = await fetchAlanayWeather();
      if (!weather) {
        return res.status(503).json({ error: "Weather service unavailable" });
      }
      res.json({
        ...weather,
        description: getWeatherDescription(weather.weathercode),
        location: "Alanya, Turkey",
      });
    } catch (error) {
      console.error("Error fetching weather:", error);
      res.status(500).json({ error: "Failed to fetch weather" });
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

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - сценарист для радио "${ctx.stationName}". 
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Твоя задача - написать короткий диалог между ведущими: ${ctx.malePersona} (мужчина) и ${ctx.femalePersona} (женщина).
Диалог должен быть на русском языке, дружелюбным и естественным.
Длительность при чтении - 30-50 секунд.

ВАЖНО: Ответ должен быть в формате JSON:
{
  "maleText": "текст для ${ctx.malePersona} (все его реплики через пробел)",
  "femaleText": "текст для ${ctx.femalePersona} (все её реплики через пробел)"
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

      const voicesList = await storage.getVoices();
      const maleVoice = voicesList.find(v => v.gender === "male" && v.isActive);
      const femaleVoice = voicesList.find(v => v.gender === "female" && v.isActive);
      
      if (!maleVoice || !femaleVoice) {
        return res.status(400).json({ 
          error: "Необходимо добавить активные мужской и женский голоса в разделе 'Голоса'" 
        });
      }
      
      const maleVoiceId = maleVoice.elevenLabsVoiceId;
      const femaleVoiceId = femaleVoice.elevenLabsVoiceId;

      const generateVoice = async (text: string, voiceId: string): Promise<Buffer> => {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": settings.elevenLabsApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_v3",
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

  app.get("/api/news-items", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const items = await storage.getNewsItems(limit);
      res.json(items);
    } catch (error) {
      console.error("Error getting news items:", error);
      res.status(500).json({ error: "Failed to get news items" });
    }
  });

  app.post("/api/news-sources/:id/fetch", async (req, res) => {
    try {
      const source = await storage.getNewsSource(req.params.id);
      if (!source) {
        return res.status(404).json({ error: "News source not found" });
      }
      
      const fetchedItems = await fetchNewsFromSource(source);
      const savedItems = [];
      
      for (const item of fetchedItems) {
        try {
          const saved = await storage.createNewsItem({
            sourceId: source.id,
            title: item.title,
            summary: item.summary || null,
            content: item.content || null,
            url: item.url || null,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            category: item.category || null,
            isUsed: false,
          });
          savedItems.push(saved);
        } catch (e) {
          console.error("Error saving news item:", e);
        }
      }
      
      res.json({ fetched: fetchedItems.length, saved: savedItems.length });
    } catch (error) {
      console.error("Error fetching news:", error);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  app.post("/api/moderate-script", async (req, res) => {
    try {
      const { maleText, femaleText, dialogId } = req.body;
      
      if (!maleText && !femaleText) {
        return res.status(400).json({ error: "Script text is required" });
      }

      const fullScript = `Мужской голос: ${maleText || ""}\n\nЖенский голос: ${femaleText || ""}`;

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - модератор контента для радиостанции "${ctx.stationName}". 
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

  app.post("/api/auto-generate-day", async (req, res) => {
    try {
      const { date, prompt, count } = req.body;
      
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      const settings = await storage.getSettings();
      const dailyCount = count || settings?.dailyDialogsCount || 12;
      const basePrompt = prompt || settings?.defaultPrompt || "";

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - сценарист для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Создай ${dailyCount} разных коротких диалогов между ведущими: ${ctx.malePersona} (мужчина) и ${ctx.femalePersona} (женщина).
Каждый диалог должен быть на русском языке, дружелюбным и естественным.
Длительность каждого диалога при чтении - 30-50 секунд.
Темы должны быть разнообразными: погода, местные события, советы экспатам, интересные факты о Турции, еда, культура, и т.д.

ВАЖНО: Ответь в формате JSON массив:
{
  "dialogs": [
    {
      "title": "краткое название темы",
      "maleText": "все реплики ${ctx.malePersona} через пробел",
      "femaleText": "все реплики ${ctx.femalePersona} через пробел"
    }
  ]
}

Создай ровно ${dailyCount} диалогов.`;

      const anthropic = await getAnthropicClient();
      let dialogsData: { dialogs: Array<{ title: string; maleText: string; femaleText: string }> };

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: basePrompt || "Создай подводки на день" }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format from Claude" });
        }

        dialogsData = JSON.parse(jsonMatch[0]);
      } else {
        const response = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: basePrompt || "Создай подводки на день" }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 4096,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          return res.status(500).json({ error: "No response from AI" });
        }

        dialogsData = JSON.parse(content);
      }

      if (!dialogsData.dialogs || !Array.isArray(dialogsData.dialogs)) {
        return res.status(500).json({ error: "Invalid response format" });
      }

      const createdDialogs = [];
      for (let i = 0; i < dialogsData.dialogs.length; i++) {
        const dialog = dialogsData.dialogs[i];
        const created = await storage.createDialog({
          title: dialog.title || `Подводка ${i + 1}`,
          prompt: basePrompt,
          maleText: dialog.maleText,
          femaleText: dialog.femaleText,
          scriptText: `${dialog.maleText}\n\n${dialog.femaleText}`,
          status: "pending",
          scheduledDate: date,
          slotNumber: i + 1,
        });
        createdDialogs.push(created);
      }

      res.json({ 
        success: true, 
        count: createdDialogs.length,
        dialogs: createdDialogs 
      });
    } catch (error) {
      console.error("Error auto-generating day:", error);
      res.status(500).json({ error: "Failed to auto-generate dialogs" });
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

  app.get("/api/ads", async (req, res) => {
    try {
      const adsList = await storage.getAds();
      res.json(adsList);
    } catch (error) {
      console.error("Error getting ads:", error);
      res.status(500).json({ error: "Failed to get ads" });
    }
  });

  app.post("/api/ads", async (req, res) => {
    try {
      const parsed = insertAdSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const ad = await storage.createAd(parsed.data);
      res.json(ad);
    } catch (error) {
      console.error("Error creating ad:", error);
      res.status(500).json({ error: "Failed to create ad" });
    }
  });

  app.patch("/api/ads/:id", async (req, res) => {
    try {
      const updated = await storage.updateAd(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Ad not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating ad:", error);
      res.status(500).json({ error: "Failed to update ad" });
    }
  });

  app.delete("/api/ads/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAd(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Ad not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting ad:", error);
      res.status(500).json({ error: "Failed to delete ad" });
    }
  });

  app.post("/api/generate-ad", async (req, res) => {
    try {
      const { prompt, clientName, category } = req.body;
      if (!prompt || prompt.length < 10) {
        return res.status(400).json({ error: "Prompt is required and must be at least 10 characters" });
      }

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - копирайтер рекламного агентства для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Твоя задача - написать короткий рекламный ролик в формате диалога между ведущими: ${ctx.malePersona} (мужчина) и ${ctx.femalePersona} (женщина).
Реклама должна быть на русском языке, живой, запоминающейся и эффективной.
Длительность при чтении - 20-40 секунд.

ВАЖНО: Ответ должен быть в формате JSON:
{
  "title": "краткое название рекламы",
  "maleText": "все реплики ${ctx.malePersona} через пробел",
  "femaleText": "все реплики ${ctx.femalePersona} через пробел"
}

Реклама должна быть ненавязчивой, но убедительной.`;

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
        
        const ad = await storage.createAd({
          title: parsed.title || "Реклама",
          clientName: clientName || null,
          prompt: prompt,
          maleText: parsed.maleText,
          femaleText: parsed.femaleText,
          scriptText: `${parsed.maleText}\n\n${parsed.femaleText}`,
          status: "pending",
          category: category || "general",
        });

        return res.json(ad);
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
      
      const ad = await storage.createAd({
        title: parsed.title || "Реклама",
        clientName: clientName || null,
        prompt: prompt,
        maleText: parsed.maleText,
        femaleText: parsed.femaleText,
        scriptText: `${parsed.maleText}\n\n${parsed.femaleText}`,
        status: "pending",
        category: category || "general",
      });

      res.json(ad);
    } catch (error) {
      console.error("Error generating ad:", error);
      res.status(500).json({ error: "Failed to generate ad" });
    }
  });

  app.get("/api/voices", async (req, res) => {
    try {
      const voicesList = await storage.getVoices();
      res.json(voicesList);
    } catch (error) {
      console.error("Error getting voices:", error);
      res.status(500).json({ error: "Failed to get voices" });
    }
  });

  app.post("/api/voices", async (req, res) => {
    try {
      const count = await storage.getVoicesCount();
      if (count >= 4) {
        return res.status(400).json({ error: "Maximum 4 voices allowed" });
      }
      const parsed = insertVoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const voice = await storage.createVoice(parsed.data);
      res.json(voice);
    } catch (error) {
      console.error("Error creating voice:", error);
      res.status(500).json({ error: "Failed to create voice" });
    }
  });

  app.patch("/api/voices/:id", async (req, res) => {
    try {
      const allowedFields = ["name", "gender", "isActive", "sortOrder", "description"];
      const updates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (key in req.body) {
          updates[key] = req.body[key];
        }
      }
      if (updates.gender && !["male", "female"].includes(updates.gender)) {
        return res.status(400).json({ error: "Gender must be 'male' or 'female'" });
      }
      const updated = await storage.updateVoice(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: "Voice not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating voice:", error);
      res.status(500).json({ error: "Failed to update voice" });
    }
  });

  app.delete("/api/voices/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteVoice(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Voice not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting voice:", error);
      res.status(500).json({ error: "Failed to delete voice" });
    }
  });

  app.get("/api/elevenlabs/voices", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": settings.elevenLabsApiKey,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("ElevenLabs API error:", error);
        return res.status(response.status).json({ error: "Failed to fetch voices from ElevenLabs" });
      }

      const data = await response.json();
      const voicesList = data.voices?.map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
        description: v.description,
      })) || [];

      res.json({ voices: voicesList });
    } catch (error) {
      console.error("Error fetching ElevenLabs voices:", error);
      res.status(500).json({ error: "Failed to fetch voices from ElevenLabs" });
    }
  });

  // Program Types routes
  app.get("/api/program-types", async (req, res) => {
    try {
      const types = await storage.getProgramTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching program types:", error);
      res.status(500).json({ error: "Failed to fetch program types" });
    }
  });

  app.post("/api/program-types", async (req, res) => {
    try {
      const programType = await storage.createProgramType(req.body);
      res.json(programType);
    } catch (error) {
      console.error("Error creating program type:", error);
      res.status(500).json({ error: "Failed to create program type" });
    }
  });

  app.patch("/api/program-types/:id", async (req, res) => {
    try {
      const updated = await storage.updateProgramType(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Program type not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating program type:", error);
      res.status(500).json({ error: "Failed to update program type" });
    }
  });

  app.delete("/api/program-types/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProgramType(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Program type not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting program type:", error);
      res.status(500).json({ error: "Failed to delete program type" });
    }
  });

  // Programs routes
  app.get("/api/programs", async (req, res) => {
    try {
      const typeId = req.query.typeId as string | undefined;
      const programsList = typeId 
        ? await storage.getProgramsByType(typeId)
        : await storage.getPrograms();
      res.json(programsList);
    } catch (error) {
      console.error("Error fetching programs:", error);
      res.status(500).json({ error: "Failed to fetch programs" });
    }
  });

  app.get("/api/programs/:id", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }
      res.json(program);
    } catch (error) {
      console.error("Error fetching program:", error);
      res.status(500).json({ error: "Failed to fetch program" });
    }
  });

  app.post("/api/programs", async (req, res) => {
    try {
      const program = await storage.createProgram(req.body);
      res.json(program);
    } catch (error) {
      console.error("Error creating program:", error);
      res.status(500).json({ error: "Failed to create program" });
    }
  });

  app.patch("/api/programs/:id", async (req, res) => {
    try {
      const updated = await storage.updateProgram(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Program not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating program:", error);
      res.status(500).json({ error: "Failed to update program" });
    }
  });

  app.delete("/api/programs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProgram(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Program not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting program:", error);
      res.status(500).json({ error: "Failed to delete program" });
    }
  });

  app.post("/api/programs/:id/generate", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }

      const programType = await storage.getProgramType(program.programTypeId);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const prompt = program.prompt || programType.defaultPrompt;
      let scriptText: string;

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - автор контента для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Активные ведущие: ${ctx.personaList}.
Создавай контент на русском языке в стиле радиостанции.`;

      const anthropic = await getAnthropicClient();
      
      if (anthropic) {
        const message = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });
        
        const textContent = message.content.find(c => c.type === "text");
        scriptText = textContent?.text || "";
      } else {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
        });
        
        scriptText = response.choices[0]?.message?.content || "";
      }

      const updated = await storage.updateProgram(program.id, {
        scriptText,
        status: "script_ready",
      });

      res.json(updated);
    } catch (error) {
      console.error("Error generating program script:", error);
      res.status(500).json({ error: "Failed to generate program script" });
    }
  });

  app.post("/api/programs/:id/generate-audio", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }

      if (!program.scriptText) {
        return res.status(400).json({ error: "No script to generate audio from" });
      }

      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const voicesList = await storage.getVoices();
      const activeVoice = voicesList.find(v => v.isActive);
      
      if (!activeVoice) {
        return res.status(400).json({ error: "No active voice configured" });
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoice.elevenLabsVoiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": settings.elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: program.scriptText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("ElevenLabs error:", error);
        return res.status(500).json({ error: "Failed to generate audio" });
      }

      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString("base64");
      const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;

      const updated = await storage.updateProgram(program.id, {
        audioUrl,
        status: "ready",
      });

      res.json(updated);
    } catch (error) {
      console.error("Error generating program audio:", error);
      res.status(500).json({ error: "Failed to generate program audio" });
    }
  });

  app.get("/api/automations", async (req, res) => {
    try {
      const automationsList = await storage.getAutomations();
      res.json(automationsList);
    } catch (error) {
      console.error("Error getting automations:", error);
      res.status(500).json({ error: "Failed to get automations" });
    }
  });

  app.get("/api/automations/:id", async (req, res) => {
    try {
      const automation = await storage.getAutomation(req.params.id);
      if (!automation) {
        return res.status(404).json({ error: "Automation not found" });
      }
      res.json(automation);
    } catch (error) {
      console.error("Error getting automation:", error);
      res.status(500).json({ error: "Failed to get automation" });
    }
  });

  app.post("/api/automations", async (req, res) => {
    try {
      const data = {
        name: req.body.name,
        automationType: req.body.automationType || "dialog",
        programTypeId: req.body.programTypeId || null,
        voiceIds: Array.isArray(req.body.voiceIds) ? req.body.voiceIds : [],
        prompt: req.body.prompt || null,
        itemsCount: typeof req.body.itemsCount === "number" ? req.body.itemsCount : 1,
        isActive: req.body.isActive !== false,
      };
      const automation = await storage.createAutomation(data);
      res.json(automation);
    } catch (error) {
      console.error("Error creating automation:", error);
      res.status(500).json({ error: "Failed to create automation" });
    }
  });

  app.patch("/api/automations/:id", async (req, res) => {
    try {
      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.automationType !== undefined) updates.automationType = req.body.automationType;
      if (req.body.programTypeId !== undefined) updates.programTypeId = req.body.programTypeId || null;
      if (req.body.voiceIds !== undefined) updates.voiceIds = Array.isArray(req.body.voiceIds) ? req.body.voiceIds : [];
      if (req.body.prompt !== undefined) updates.prompt = req.body.prompt || null;
      if (req.body.itemsCount !== undefined) updates.itemsCount = typeof req.body.itemsCount === "number" ? req.body.itemsCount : 1;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      
      const updated = await storage.updateAutomation(req.params.id, updates as any);
      if (!updated) {
        return res.status(404).json({ error: "Automation not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating automation:", error);
      res.status(500).json({ error: "Failed to update automation" });
    }
  });

  app.delete("/api/automations/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAutomation(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Automation not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting automation:", error);
      res.status(500).json({ error: "Failed to delete automation" });
    }
  });

  app.get("/api/automations/:id/runs", async (req, res) => {
    try {
      const runs = await storage.getAutomationRuns(req.params.id);
      res.json(runs);
    } catch (error) {
      console.error("Error getting automation runs:", error);
      res.status(500).json({ error: "Failed to get automation runs" });
    }
  });

  app.post("/api/automations/:id/run", async (req, res) => {
    try {
      const automation = await storage.getAutomation(req.params.id);
      if (!automation) {
        return res.status(404).json({ error: "Automation not found" });
      }

      const run = await storage.createAutomationRun({
        automationId: automation.id,
        status: "running",
        itemsCreated: 0,
      });

      const executeAutomation = async () => {
        try {
          let itemsCreated = 0;
          const itemsCount = automation.itemsCount || 1;

          const weather = await fetchAlanayWeather();
          const newsItems = await storage.getNewsItems();
          const unusedNews = newsItems.filter(n => !n.isUsed).slice(0, 10);

          const tomorrowDate = new Date();
          tomorrowDate.setDate(tomorrowDate.getDate() + 1);
          const tomorrowStr = tomorrowDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

          let contextInfo = `\n\nКОНТЕКСТ ДЛЯ ПОДВОДКИ (на завтра - ${tomorrowStr}):\n`;
          
          if (weather) {
            const hasTomorrowData = weather.daily && 
              weather.daily.temperature_max.length > 1 && 
              weather.daily.temperature_min.length > 1 &&
              typeof weather.daily.temperature_max[1] === 'number' &&
              typeof weather.daily.temperature_min[1] === 'number';
            
            if (hasTomorrowData) {
              const maxTemp = Math.round(weather.daily!.temperature_max[1]);
              const minTemp = Math.round(weather.daily!.temperature_min[1]);
              const precipitation = weather.daily!.precipitation_sum[1] || 0;
              
              contextInfo += `\nПОГОДА В АЛАНЬЕ ЗАВТРА: ${maxTemp}°C днём, ${minTemp}°C ночью`;
              if (precipitation > 0) {
                contextInfo += `, ожидается осадки (${precipitation} мм)`;
              }
              contextInfo += `.\n`;
            } else if (typeof weather.temperature === 'number') {
              contextInfo += `\nПОГОДА СЕЙЧАС: ${Math.round(weather.temperature)}°C, ${getWeatherDescription(weather.weathercode)}.\n`;
            }
          }

          const newsToUse = unusedNews.slice(0, 5);
          if (newsToUse.length > 0) {
            contextInfo += `\nАКТУАЛЬНЫЕ НОВОСТИ:\n`;
            newsToUse.forEach((news, i) => {
              contextInfo += `${i + 1}. ${news.title}${news.summary ? ` - ${news.summary.substring(0, 100)}...` : ""}\n`;
            });
          }

          if (automation.automationType === "dialog") {
            const voicesList = await storage.getVoices();
            const selectedVoices = automation.voiceIds?.length 
              ? voicesList.filter(v => automation.voiceIds?.includes(v.id))
              : voicesList.filter(v => v.isActive);
            
            const maleVoice = selectedVoices.find(v => v.gender === "male");
            const femaleVoice = selectedVoices.find(v => v.gender === "female");

            if (!maleVoice || !femaleVoice) {
              await storage.updateAutomationRun(run.id, {
                status: "error",
                errorMessage: "Требуются активные голоса для мужчины и женщины",
                completedAt: new Date(),
              });
              return;
            }

            const ctx = await buildStationContext();
            const personaContext = `\nВЕДУЩИЕ: ${maleVoice.personaName || maleVoice.name} (мужчина) и ${femaleVoice.personaName || femaleVoice.name} (женщина). Используй их имена в диалоге естественно.\n`;
            const stationContext = `Радиостанция: ${ctx.stationName}. ${ctx.stationDescription ? ctx.stationDescription : ""}\n`;

            for (let i = 0; i < itemsCount; i++) {
              const basePrompt = automation.prompt || `Создай короткий диалог для радио ${ctx.stationName}`;
              const enhancedPrompt = stationContext + basePrompt + contextInfo + personaContext;
              
              const dialog = await storage.createDialog({
                title: `Подводка ${tomorrowStr} #${i + 1}`,
                prompt: enhancedPrompt,
                status: "pending",
              });
              
              itemsCreated++;
            }
            
            for (const newsItem of newsToUse) {
              await storage.markNewsItemUsed(newsItem.id);
            }
          } else if (automation.automationType === "program" && automation.programTypeId) {
            const programType = await storage.getProgramType(automation.programTypeId);
            if (!programType) {
              await storage.updateAutomationRun(run.id, {
                status: "error",
                errorMessage: "Тип программы не найден",
                completedAt: new Date(),
              });
              return;
            }

            const ctx = await buildStationContext();
            const stationContext = `Радиостанция: ${ctx.stationName}. ${ctx.stationDescription ? ctx.stationDescription : ""}\n`;
            
            for (let i = 0; i < itemsCount; i++) {
              const basePrompt = automation.prompt || programType.defaultPrompt;
              const enhancedPrompt = stationContext + basePrompt + contextInfo;
              
              await storage.createProgram({
                programTypeId: programType.id,
                title: `${programType.name} ${tomorrowStr} #${i + 1}`,
                prompt: enhancedPrompt,
                status: "pending",
              });
              itemsCreated++;
            }
            
            for (const newsItem of newsToUse) {
              await storage.markNewsItemUsed(newsItem.id);
            }
          }

          await storage.updateAutomationRun(run.id, {
            status: "completed",
            itemsCreated,
            completedAt: new Date(),
          });

          await storage.updateAutomation(automation.id, {
            lastRunAt: new Date(),
          } as any);

        } catch (error) {
          console.error("Automation execution error:", error);
          await storage.updateAutomationRun(run.id, {
            status: "error",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          });
        }
      };

      executeAutomation();

      res.json({ run, message: "Automation started" });
    } catch (error) {
      console.error("Error running automation:", error);
      res.status(500).json({ error: "Failed to run automation" });
    }
  });

  return httpServer;
}
