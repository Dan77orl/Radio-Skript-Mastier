import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema, insertAdSchema, insertAdPresetSchema, insertVoiceSchema } from "@shared/schema";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import multer from "multer";
import mammoth from "mammoth";
import * as cheerio from "cheerio";

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

const geminiAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
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

interface ScriptSegment {
  speaker: string;
  text: string;
}

function parseMultiSpeakerScript(scriptText: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  const lines = scriptText.split("\n");
  let currentSpeaker = "";
  let currentText = "";
  
  for (const line of lines) {
    const speakerMatch = line.match(/^\s*\[([^\]]+)\]:\s*(.*)/);
    if (speakerMatch) {
      if (currentSpeaker && currentText.trim()) {
        segments.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = speakerMatch[1];
      currentText = speakerMatch[2];
    } else if (currentSpeaker) {
      currentText += " " + line;
    }
  }
  
  if (currentSpeaker && currentText.trim()) {
    segments.push({ speaker: currentSpeaker, text: currentText.trim() });
  }
  
  return segments;
}

function resolveAssignedVoices(voicesList: any[], programType: any): any[] {
  if (programType.assignedVoiceIds?.length) {
    return voicesList.filter(v => programType.assignedVoiceIds.includes(v.id));
  }
  return voicesList.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(programType.id));
}

function stripEmotionTags(text: string): string {
  return text.replace(/\[(energetic|fast|slow|surprised|thoughtful|happy|sad|exclaims|announcer|serious|calm|excited|warm|dramatic|whisper|loud|gentle|playful|confident|nervous|angry|romantic|mysterious|urgent|casual|formal|ironic|sarcastic)\]/gi, "").replace(/\s{2,}/g, " ").trim();
}

function isMultiSpeakerScript(scriptText: string): boolean {
  const speakerPattern = /^\[([^\]]+)\]:/m;
  const matches = scriptText.match(new RegExp(speakerPattern.source, "gm"));
  return !!matches && matches.length >= 2;
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

  app.post("/api/test-anthropic", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: "API key is required" });
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey });
      
      await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error testing Anthropic:", error);
      if (error?.status === 401 || error?.message?.includes("authentication")) {
        return res.status(401).json({ error: "Неверный API ключ" });
      }
      res.status(500).json({ error: error?.message || "Ошибка подключения" });
    }
  });

  app.post("/api/test-yandex", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      const response = await fetch("https://cloud-api.yandex.net/v1/disk/", {
        headers: {
          Authorization: `OAuth ${token}`,
        },
      });

      if (!response.ok) {
        return res.status(401).json({ error: "Неверный OAuth токен" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error testing Yandex Disk:", error);
      res.status(500).json({ error: "Ошибка подключения" });
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
            output_format: "mp3_44100_192",
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

  app.post("/api/generate-day-dialogs", async (req, res) => {
    try {
      const { date, totalSlots } = req.body;
      
      if (!date || !totalSlots) {
        return res.status(400).json({ error: "Date and totalSlots are required" });
      }

      const existingDialogs = await storage.getDialogs();
      const existingForDate = existingDialogs.filter(d => d.scheduledDate === date);
      const existingBySlot = new Map<number, string>();
      existingForDate.forEach(d => {
        if (d.slotNumber) {
          existingBySlot.set(d.slotNumber, d.id);
        }
      });

      const settings = await storage.getSettings();
      const ctx = await buildStationContext();
      const newsItems = await storage.getNewsItems(10);
      const unusedNews = newsItems.filter(n => !n.isUsed).slice(0, 5);
      
      const dateObj = new Date(date);
      const weekdays = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
      const weekday = weekdays[dateObj.getDay()];
      const dateFormatted = dateObj.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      
      const holidays: Record<string, string> = {
        "12-25": "Рождество (европейское)",
        "12-31": "Канун Нового года",
        "01-01": "Новый год",
        "01-07": "Рождество (православное)",
        "02-14": "День святого Валентина",
        "03-08": "Международный женский день",
      };
      const monthDay = `${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
      const holiday = holidays[monthDay] || null;
      
      const newsContext = unusedNews.length > 0 
        ? `\n\nАктуальные новости для использования:\n${unusedNews.map((n, i) => `${i + 1}. ${n.title}${n.summary ? `: ${n.summary}` : ""}`).join("\n")}`
        : "";

      const dailyPrompt = settings?.dailyPrompt || "";
      const slotPrompts = settings?.slotPrompts || [];
      const learnings = settings?.accumulatedLearnings || "";

      const generatedDialogs = [];

      for (let slotNumber = 1; slotNumber <= totalSlots; slotNumber++) {
        const startHour = 7;
        const endHour = 22;
        const hoursRange = endHour - startHour;
        const slotDuration = hoursRange / totalSlots;
        const slotHour = startHour + (slotNumber - 1) * slotDuration;
        const hour = Math.floor(slotHour);
        const timeLabel = `${hour.toString().padStart(2, "0")}:00`;
        
        let timeOfDay = "день";
        if (hour < 10) timeOfDay = "утро";
        else if (hour < 14) timeOfDay = "день";
        else if (hour < 18) timeOfDay = "вечер";
        else timeOfDay = "поздний вечер";

        const slotPrompt = slotPrompts[slotNumber - 1] || "";
        
        const systemPrompt = `Ты - сценарист для радио "${ctx.stationName}". 
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Ведущие: ${ctx.malePersona} (мужчина) и ${ctx.femalePersona} (женщина).

КОНТЕКСТ ДНЯ:
- Дата: ${dateFormatted}, ${weekday}
${holiday ? `- Праздник: ${holiday}` : ""}
- Время слота: ${timeLabel} (${timeOfDay})
- Слот номер: ${slotNumber} из ${totalSlots}
${newsContext}

${dailyPrompt ? `ОБЩИЕ ИНСТРУКЦИИ НА ДЕНЬ:\n${dailyPrompt}\n` : ""}
${slotPrompt ? `ИНСТРУКЦИИ ДЛЯ ЭТОГО СЛОТА:\n${slotPrompt}\n` : ""}
${learnings ? `НАКОПЛЕННЫЙ ОПЫТ:\n${learnings}\n` : ""}

Создай короткий диалог (30-50 секунд при чтении).
Учитывай время суток и день недели.
${hour < 10 ? "Утренний слот: бодрое приветствие, энергичный тон." : ""}
${hour >= 18 ? "Вечерний слот: расслабленный тон, итоги дня." : ""}

ВАЖНО: Ответ в формате JSON:
{
  "title": "краткое название темы диалога",
  "maleText": "текст для ${ctx.malePersona}",
  "femaleText": "текст для ${ctx.femalePersona}"
}`;

        const userPrompt = `Создай диалог для слота #${slotNumber} (${timeLabel}, ${timeOfDay}).`;

        try {
          const anthropic = await getAnthropicClient();
          let maleText = "";
          let femaleText = "";
          let title = `Слот #${slotNumber}`;

          if (anthropic) {
            const response = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 1024,
              system: systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
            });

            const textContent = response.content.find(c => c.type === "text");
            if (textContent && textContent.type === "text") {
              const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                maleText = parsed.maleText || "";
                femaleText = parsed.femaleText || "";
                title = parsed.title || title;
              }
            }
          } else {
            const response = await openai.chat.completions.create({
              model: "gpt-4.1",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              response_format: { type: "json_object" },
              max_completion_tokens: 1024,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
              const parsed = JSON.parse(content);
              maleText = parsed.maleText || "";
              femaleText = parsed.femaleText || "";
              title = parsed.title || title;
            }
          }

          const existingDialogId = existingBySlot.get(slotNumber);
          let dialog;
          
          if (existingDialogId) {
            dialog = await storage.updateDialog(existingDialogId, {
              title,
              prompt: userPrompt,
              scriptText: `${maleText}\n\n${femaleText}`,
              maleText,
              femaleText,
              status: "pending",
              moderationStatus: "pending",
              moderationNotes: null,
              moderatedAt: null,
              newsSourceIds: unusedNews.length > 0 ? unusedNews.map(n => n.id) : null,
            });
          } else {
            dialog = await storage.createDialog({
              title,
              prompt: userPrompt,
              scriptText: `${maleText}\n\n${femaleText}`,
              maleText,
              femaleText,
              audioUrl: null,
              duration: null,
              status: "pending",
              scheduledDate: date,
              slotNumber,
              uploadedToYandex: false,
              yandexPath: null,
              moderationStatus: "pending",
              moderationNotes: null,
              moderatedAt: null,
              newsSourceIds: unusedNews.length > 0 ? unusedNews.map(n => n.id) : null,
            });
          }

          if (dialog) generatedDialogs.push(dialog);
        } catch (slotError) {
          console.error(`Error generating slot ${slotNumber}:`, slotError);
        }
      }

      for (const news of unusedNews) {
        await storage.markNewsItemUsed(news.id);
      }

      res.json({ dialogs: generatedDialogs, generatedCount: generatedDialogs.length });
    } catch (error) {
      console.error("Error generating day dialogs:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate dialogs" });
    }
  });

  app.post("/api/dialogs/:id/regenerate", async (req, res) => {
    try {
      const { prompt } = req.body;
      const dialogId = req.params.id;
      
      const dialog = await storage.getDialog(dialogId);
      if (!dialog) {
        return res.status(404).json({ error: "Dialog not found" });
      }

      const ctx = await buildStationContext();
      
      const systemPrompt = `Ты - сценарист для радио "${ctx.stationName}". 
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Ведущие: ${ctx.malePersona} (мужчина) и ${ctx.femalePersona} (женщина).

Текущий диалог:
Мужской текст: ${dialog.maleText || ""}
Женский текст: ${dialog.femaleText || ""}

Перегенерируй диалог с учётом новых инструкций.
Создай короткий диалог (30-50 секунд при чтении).

ВАЖНО: Ответ в формате JSON:
{
  "maleText": "новый текст для ${ctx.malePersona}",
  "femaleText": "новый текст для ${ctx.femalePersona}"
}`;

      const anthropic = await getAnthropicClient();
      let maleText = dialog.maleText || "";
      let femaleText = dialog.femaleText || "";

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (textContent && textContent.type === "text") {
          const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            maleText = parsed.maleText || maleText;
            femaleText = parsed.femaleText || femaleText;
          }
        }
      } else {
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
        if (content) {
          const parsed = JSON.parse(content);
          maleText = parsed.maleText || maleText;
          femaleText = parsed.femaleText || femaleText;
        }
      }

      const updatedDialog = await storage.updateDialog(dialogId, {
        maleText,
        femaleText,
        scriptText: `${maleText}\n\n${femaleText}`,
        prompt: `${dialog.prompt || ""}\n\nОбновление: ${prompt}`,
      });

      res.json(updatedDialog);
    } catch (error) {
      console.error("Error regenerating dialog:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to regenerate dialog" });
    }
  });

  app.post("/api/send-to-automation", async (req, res) => {
    try {
      const { date } = req.body;
      
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      const dialogs = await storage.getDialogs();
      const dialogsForDate = dialogs.filter(d => 
        d.scheduledDate === date && 
        d.maleText && 
        d.femaleText && 
        (d.status === "pending" || d.status === "generating")
      );

      if (dialogsForDate.length === 0) {
        return res.json({ queued: 0, message: "No dialogs to generate" });
      }

      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const voicesList = await storage.getVoices();
      const maleVoice = voicesList.find(v => v.gender === "male" && v.isActive);
      const femaleVoice = voicesList.find(v => v.gender === "female" && v.isActive);
      
      if (!maleVoice || !femaleVoice) {
        return res.status(400).json({ 
          error: "Необходимо добавить активные мужской и женский голоса в разделе 'Голоса'" 
        });
      }

      for (const dialog of dialogsForDate) {
        await storage.updateDialog(dialog.id, { status: "generating" });
      }

      res.json({ queued: dialogsForDate.length });

      const generateVoiceAudio = async (text: string, voiceId: string): Promise<Buffer> => {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": settings.elevenLabsApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_v3",
            output_format: "mp3_44100_192",
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

      (async () => {
        for (const dialog of dialogsForDate) {
          try {
            console.log(`Generating audio for dialog ${dialog.id}...`);
            
            const [maleAudio, femaleAudio] = await Promise.all([
              generateVoiceAudio(dialog.maleText!, maleVoice.elevenLabsVoiceId),
              generateVoiceAudio(dialog.femaleText!, femaleVoice.elevenLabsVoiceId),
            ]);

            const audioDir = path.join(process.cwd(), "public", "audio");
            await fs.mkdir(audioDir, { recursive: true });

            const timestamp = Date.now();
            const combinedFile = path.join(audioDir, `dialog_${dialog.id}_${timestamp}.mp3`);

            const combined = Buffer.concat([maleAudio, femaleAudio]);
            await fs.writeFile(combinedFile, combined);

            await storage.updateDialog(dialog.id, {
              audioUrl: `/audio/dialog_${dialog.id}_${timestamp}.mp3`,
              duration: Math.round((combined.length / 1024) * 0.5),
              status: "ready",
            });

            console.log(`Audio generated for dialog ${dialog.id}`);
          } catch (error) {
            console.error(`Error generating audio for dialog ${dialog.id}:`, error);
            await storage.updateDialog(dialog.id, { status: "error" });
          }
        }
      })();
    } catch (error) {
      console.error("Error sending to automation:", error);
      res.status(500).json({ error: "Failed to send to automation" });
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

  app.get("/api/ad-presets", async (req, res) => {
    try {
      const presets = await storage.getAdPresets();
      res.json(presets);
    } catch (error) {
      console.error("Error getting ad presets:", error);
      res.status(500).json({ error: "Failed to get ad presets" });
    }
  });

  app.get("/api/ad-presets/:id", async (req, res) => {
    try {
      const preset = await storage.getAdPreset(req.params.id);
      if (!preset) {
        return res.status(404).json({ error: "Preset not found" });
      }
      res.json(preset);
    } catch (error) {
      console.error("Error getting ad preset:", error);
      res.status(500).json({ error: "Failed to get ad preset" });
    }
  });

  app.post("/api/ad-presets", async (req, res) => {
    try {
      const parsed = insertAdPresetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const preset = await storage.createAdPreset(parsed.data);
      res.json(preset);
    } catch (error) {
      console.error("Error creating ad preset:", error);
      res.status(500).json({ error: "Failed to create ad preset" });
    }
  });

  app.patch("/api/ad-presets/:id", async (req, res) => {
    try {
      const partialSchema = insertAdPresetSchema.partial();
      const parsed = partialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const updated = await storage.updateAdPreset(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Preset not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating ad preset:", error);
      res.status(500).json({ error: "Failed to update ad preset" });
    }
  });

  app.delete("/api/ad-presets/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAdPreset(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Preset not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting ad preset:", error);
      res.status(500).json({ error: "Failed to delete ad preset" });
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
          scriptText: parsed.scriptText || `${parsed.maleText || ""}\n\n${parsed.femaleText || ""}`,
          status: "draft",
          stage: "prompt",
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
        scriptText: parsed.scriptText || `${parsed.maleText || ""}\n\n${parsed.femaleText || ""}`,
        status: "draft",
        stage: "prompt",
        category: category || "general",
      });

      res.json(ad);
    } catch (error) {
      console.error("Error generating ad:", error);
      res.status(500).json({ error: "Failed to generate ad" });
    }
  });

  app.post("/api/ads/:id/generate-variants", async (req, res) => {
    try {
      const { id } = req.params;
      const ad = await storage.getAd(id);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      const { variantsCount = 5 } = req.body;
      const ctx = await buildStationContext();
      
      const systemPrompt = `Ты - креативный копирайтер для радио "${ctx.stationName}".
Твоя задача - создать ${variantsCount} РАЗНЫХ вариантов рекламного ролика.

Информация о рекламе:
- Описание: ${ad.prompt}
${ad.websiteUrl ? `- Сайт: ${ad.websiteUrl}` : ""}
${ad.instagramUrl ? `- Instagram: ${ad.instagramUrl}` : ""}
${ad.clientName ? `- Клиент: ${ad.clientName}` : ""}
- Целевая длительность: ${ad.targetDurationSeconds || 30} секунд при чтении

Каждый вариант должен быть уникальным по стилю и подаче:
1. Вариант с юмором
2. Эмоциональный вариант
3. Информационный вариант
4. Динамичный вариант
5. Нестандартный/креативный вариант

ВАЖНО: Ответ в формате JSON массива строк:
{
  "variants": [
    "Полный текст варианта 1...",
    "Полный текст варианта 2...",
    "Полный текст варианта 3...",
    "Полный текст варианта 4...",
    "Полный текст варианта 5..."
  ],
  "speakersCount": 1 или 2 (рекомендуемое количество ведущих)
}

Каждый вариант - это готовый текст для озвучки, без разметки на голоса.`;

      const anthropic = await getAnthropicClient();
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: "Создай 5 вариантов рекламного ролика" }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format" });
        }

        const parsed = JSON.parse(jsonMatch[0]);
        
        const updated = await storage.updateAd(id, {
          variants: parsed.variants,
          speakersCount: parsed.speakersCount || 1,
          stage: "variants",
        });

        return res.json(updated);
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Создай 5 вариантов рекламного ролика" }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const parsed = JSON.parse(content);
      
      const updated = await storage.updateAd(id, {
        variants: parsed.variants,
        speakersCount: parsed.speakersCount || 1,
        stage: "variants",
      });

      res.json(updated);
    } catch (error) {
      console.error("Error generating ad variants:", error);
      res.status(500).json({ error: "Failed to generate variants" });
    }
  });

  app.post("/api/ads/:id/select-variant", async (req, res) => {
    try {
      const { id } = req.params;
      const { variantIndex } = req.body;
      
      const ad = await storage.getAd(id);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.variants || variantIndex >= ad.variants.length) {
        return res.status(400).json({ error: "Invalid variant index" });
      }

      const updated = await storage.updateAd(id, {
        selectedVariantIndex: variantIndex,
        selectedVariantText: ad.variants[variantIndex],
        scriptText: ad.variants[variantIndex],
        stage: "voices",
      });

      res.json(updated);
    } catch (error) {
      console.error("Error selecting variant:", error);
      res.status(500).json({ error: "Failed to select variant" });
    }
  });

  app.post("/api/ads/:id/regenerate-variant", async (req, res) => {
    try {
      const { id } = req.params;
      const { baseText, instructions } = req.body;
      
      const ad = await storage.getAd(id);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      const ctx = await buildStationContext();
      
      const systemPrompt = `Ты - креативный копирайтер для радио "${ctx.stationName}".
Тебе дан текст рекламного ролика. Нужно создать новый вариант на его основе.

Исходный текст:
${baseText}

Инструкции по изменению:
${instructions || "Создай альтернативный вариант с другой подачей"}

ВАЖНО: Верни только новый текст рекламы без JSON обертки.`;

      const anthropic = await getAnthropicClient();
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: "Создай новый вариант" }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude" });
        }

        const newVariant = textContent.text.trim();
        const variants = [...(ad.variants || []), newVariant];
        
        const updated = await storage.updateAd(id, { variants });
        return res.json({ variant: newVariant, ad: updated });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Создай новый вариант" }
        ],
        max_completion_tokens: 1024,
      });

      const newVariant = response.choices[0]?.message?.content?.trim();
      if (!newVariant) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const variants = [...(ad.variants || []), newVariant];
      const updated = await storage.updateAd(id, { variants });
      
      res.json({ variant: newVariant, ad: updated });
    } catch (error) {
      console.error("Error regenerating variant:", error);
      res.status(500).json({ error: "Failed to regenerate variant" });
    }
  });

  app.post("/api/ads/:id/synthesize-audio", async (req, res) => {
    try {
      const { id } = req.params;
      const { voiceIds } = req.body;
      
      const ad = await storage.getAd(id);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.selectedVariantText) {
        return res.status(400).json({ error: "No variant selected" });
      }

      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const voiceIdToUse = voiceIds?.[0] || settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9";

      await storage.updateAd(id, { status: "generating", voiceIds });
      res.json({ message: "Audio generation started" });

      (async () => {
        try {
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceIdToUse}`, {
            method: "POST",
            headers: {
              "xi-api-key": settings.elevenLabsApiKey!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: ad.selectedVariantText,
              model_id: "eleven_v3",
              output_format: "mp3_44100_192",
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
          const audioBuffer = Buffer.from(arrayBuffer);

          const audioDir = path.join(process.cwd(), "public", "audio");
          await fs.mkdir(audioDir, { recursive: true });

          const timestamp = Date.now();
          const audioFile = path.join(audioDir, `ad_${id}_${timestamp}.mp3`);
          await fs.writeFile(audioFile, audioBuffer);

          await storage.updateAd(id, {
            audioUrl: `/audio/ad_${id}_${timestamp}.mp3`,
            duration: Math.round(audioBuffer.length / 24000),
            status: "ready",
            stage: "audio",
          });

          console.log(`Audio generated for ad ${id}`);
        } catch (error) {
          console.error(`Error generating audio for ad ${id}:`, error);
          await storage.updateAd(id, { status: "error" });
        }
      })();
    } catch (error) {
      console.error("Error starting audio synthesis:", error);
      res.status(500).json({ error: "Failed to start audio synthesis" });
    }
  });

  app.post("/api/extract-text", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filePath = req.file.path;
      const mimeType = req.file.mimetype;
      const ext = path.extname(req.file.originalname).toLowerCase();
      let extractedText = "";

      if (mimeType === "application/pdf" || ext === ".pdf") {
        const pdfBuffer = await fs.readFile(filePath);
        const base64Pdf = pdfBuffer.toString("base64");

        const settings = await storage.getSettings();
        const anthropicApiKey = settings?.anthropicApiKey;

        if (anthropicApiKey) {
          const anthropic = new Anthropic({ apiKey: anthropicApiKey });
          const response = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 3000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: base64Pdf,
                    },
                  },
                  {
                    type: "text",
                    text: "Извлеки весь текст из этого PDF документа. Если это рекламный материал или листовка, опиши также визуальное содержание (логотипы, продукты, стиль, цвета). Ответ на русском языке. Верни только извлеченный текст и описание.",
                  },
                ],
              },
            ],
          });
          extractedText = response.content[0].type === "text" ? response.content[0].text : "";
        } else {
          return res.status(400).json({ error: "Для обработки PDF требуется API ключ Anthropic. Добавьте его в настройках." });
        }
      } else if (
        mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        ext === ".docx"
      ) {
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = result.value;
      } else if (mimeType === "application/msword" || ext === ".doc") {
        return res.status(400).json({ error: "Формат .doc не поддерживается. Используйте .docx" });
      } else if (mimeType.startsWith("image/")) {
        const imageBuffer = await fs.readFile(filePath);
        const base64Image = imageBuffer.toString("base64");
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        const response = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Извлеки весь текст с этого изображения. Если это рекламный материал, опиши также визуальное содержание (логотипы, продукты, стиль). Ответ на русском языке.",
                },
                {
                  type: "image_url",
                  image_url: { url: dataUrl },
                },
              ],
            },
          ],
          max_tokens: 2000,
        });

        extractedText = response.choices[0]?.message?.content || "";
      } else if (mimeType === "text/plain" || ext === ".txt") {
        extractedText = await fs.readFile(filePath, "utf-8");
      } else {
        return res.status(400).json({ 
          error: `Формат файла не поддерживается: ${mimeType}. Поддерживаются: PDF, DOCX, изображения (JPG, PNG), TXT` 
        });
      }

      await fs.unlink(filePath).catch(() => {});

      res.json({ 
        text: extractedText.trim(),
        filename: req.file.originalname,
        mimeType,
      });
    } catch (error) {
      console.error("Error extracting text:", error);
      res.status(500).json({ error: "Не удалось извлечь текст из файла" });
    }
  });

  app.post("/api/transcribe-audio", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file uploaded" });
      }

      const filePath = req.file.path;
      const mimeType = req.file.mimetype;
      
      const audioBuffer = await fs.readFile(filePath);
      const base64Audio = audioBuffer.toString("base64");

      const response = await geminiAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Audio,
                },
              },
              {
                text: "Транскрибируй это аудио на русском языке. Верни только распознанный текст без дополнительных комментариев.",
              },
            ],
          },
        ],
      });

      const transcript = response.text || "";
      
      await fs.unlink(filePath).catch(() => {});

      res.json({ transcript: transcript.trim() });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Не удалось транскрибировать аудио" });
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
      const allowedFields = ["name", "gender", "isActive", "sortOrder", "description", "personaName", "assignedProgramTypeIds"];
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

  app.post("/api/elevenlabs/voices/add-shared", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const { public_owner_id, voice_id, name } = req.body;
      if (!public_owner_id || !voice_id || !name) {
        return res.status(400).json({ error: "Missing required fields: public_owner_id, voice_id, name" });
      }

      const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: {
          "xi-api-key": settings.elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_user_id: public_owner_id,
          voice_id: voice_id,
          new_name: name,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ElevenLabs add shared voice error:", errorText);
        return res.status(response.status).json({ error: "Failed to add shared voice to account" });
      }

      const data = await response.json();
      res.json({ voice_id: data.voice_id || voice_id });
    } catch (error) {
      console.error("Error adding shared voice:", error);
      res.status(500).json({ error: "Failed to add shared voice" });
    }
  });

  app.get("/api/elevenlabs/voices/search", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const query = (req.query.q as string) || "";
      const gender = req.query.gender as string | undefined;
      const page = parseInt(req.query.page as string) || 0;
      const pageSize = 20;

      const params = new URLSearchParams({
        page_size: String(pageSize),
        page: String(page),
      });
      if (query) params.append("search", query);
      if (gender && gender !== "all") params.append("gender", gender);

      const response = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
        headers: {
          "xi-api-key": settings.elevenLabsApiKey,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("ElevenLabs search error:", error);
        return res.status(response.status).json({ error: "Failed to search voices" });
      }

      const data = await response.json();
      const voicesList = data.voices?.map((v: any) => ({
        voice_id: v.voice_id || v.public_owner_id,
        public_owner_id: v.public_owner_id,
        name: v.name,
        category: v.category || "shared",
        labels: {
          gender: v.gender,
          accent: v.accent,
          age: v.age,
          language: v.language,
          use_case: v.use_case,
        },
        preview_url: v.preview_url,
        description: v.description || v.name,
        rate: v.rate,
        cloned_by_count: v.cloned_by_count,
      })) || [];

      res.json({
        voices: voicesList,
        has_more: data.has_more || false,
        total_count: data.total_count || voicesList.length,
      });
    } catch (error) {
      console.error("Error searching ElevenLabs voices:", error);
      res.status(500).json({ error: "Failed to search voices" });
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

  async function firecrawlSearch(query: string, limit: number = 5): Promise<string[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return [];

    try {
      const response = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit,
          lang: "ru",
          scrapeOptions: { formats: ["markdown"] },
        }),
      });

      if (!response.ok) {
        console.error(`Firecrawl search error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const results: string[] = [];

      for (const item of (data.data || [])) {
        const content = item.markdown || item.description || "";
        if (content.trim()) {
          results.push(content.substring(0, 2000));
        }
      }

      return results;
    } catch (err: any) {
      console.error("Firecrawl search error:", err.message);
      return [];
    }
  }

  async function researchForProgram(topics: string[]): Promise<string> {
    if (!topics || topics.length === 0) return "";

    const allResults: string[] = [];
    for (const topic of topics.slice(0, 3)) {
      const results = await firecrawlSearch(topic, 3);
      allResults.push(...results);
    }

    if (allResults.length === 0) return "";

    return `\n\nАКТУАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА (используй как основу для фактов и новостей в передаче):\n${allResults.map((r, i) => `--- Источник ${i + 1} ---\n${r}`).join("\n\n")}\n\nИспользуй эти реальные данные для создания точного, актуального контента. Не выдумывай статистику — бери из источников выше.`;
  }

  app.post("/api/firecrawl/search", async (req, res) => {
    try {
      const { query, limit } = req.body;
      if (!query) return res.status(400).json({ error: "Query required" });

      const results = await firecrawlSearch(query, limit || 5);
      res.json({ results, count: results.length });
    } catch (error) {
      console.error("Firecrawl search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/firecrawl/research/:typeId", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId);
      if (!programType) return res.status(404).json({ error: "Type not found" });

      const topics = req.body.topics || programType.firecrawlTopics || [];
      if (topics.length === 0) return res.status(400).json({ error: "No topics configured" });

      const research = await researchForProgram(topics);
      res.json({ research, topicsUsed: topics });
    } catch (error) {
      console.error("Firecrawl research error:", error);
      res.status(500).json({ error: "Research failed" });
    }
  });

  app.post("/api/programs/auto-create/:typeId", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const today = new Date();
      const dateStr = today.toISOString().split("T")[0];

      const existingPrograms = await storage.getProgramsByType(programType.id);
      const todayPrograms = existingPrograms.filter(p => p.scheduledDate === dateStr);
      const nextSlot = todayPrograms.length + 1;

      const slotDesc = programType.slotDescriptions?.[nextSlot - 1] || "";
      let prompt = programType.defaultPrompt;

      if (slotDesc) {
        prompt += `\n\nВременной слот: ${slotDesc}`;
      }
      if (programType.sponsorName) {
        prompt += `\n\nСпонсор передачи: ${programType.sponsorName}`;
        if (programType.sponsorText) {
          prompt += `. ${programType.sponsorText}`;
        }
      }

      prompt += `\n\nДата: ${dateStr}, выпуск #${nextSlot} из ${dailyCount}`;

      if (programType.useFirecrawl && programType.firecrawlTopics?.length) {
        try {
          const research = await researchForProgram(programType.firecrawlTopics);
          if (research) {
            prompt += research;
          }
        } catch (err: any) {
          console.error("Firecrawl research in auto-create failed:", err.message);
        }
      }

      const title = `${programType.name} ${dateStr} #${nextSlot}`;

      const voicesList = await storage.getVoices();
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      if (isMultiSpeaker) {
        const speakerList = assignedVoices.map((v: any) => v.personaName || v.name).join(", ");
        prompt += `\n\nФОРМАТ: мульти-спикерный скрипт. Спикеры: ${speakerList}
Каждая реплика начинается с [Имя]: и содержит теги эмоций.
Доступные теги: [energetic] [fast] [slow] [surprised] [thoughtful] [happy] [sad] [exclaims] [announcer] [serious] [calm] [excited] [warm] [dramatic] [whisper] [loud] [gentle] [playful] [confident]
Пример:
[${assignedVoices[0]?.personaName || assignedVoices[0]?.name}]: [energetic] [fast] Текст...
[${assignedVoices[1]?.personaName || assignedVoices[1]?.name}]: [announcer] ЗАГОЛОВОК`;
      }

      const latestRef = existingPrograms
        .filter(p => p.scriptText && p.scriptText.includes("]:"))
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, 1)[0];

      if (latestRef?.scriptText) {
        prompt += `\n\nОБРАЗЕЦ — предыдущий выпуск. Следуй ТОЧНО такому же формату, стилю назначения спикеров и распределению реплик:\n---\n${latestRef.scriptText.substring(0, 5000)}\n---\nСоздай НОВЫЙ выпуск на другую тему, но в таком же формате.`;
      }

      const ctx = await buildStationContext();
      const systemPrompt = `Ты - автор контента для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Активные ведущие: ${ctx.personaList}.
Создавай контент на русском языке в стиле радиостанции.`;

      let scriptText = "";
      const anthropic = await getAnthropicClient();

      try {
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
      } catch (genError) {
        console.error("Script generation failed:", genError);
        return res.status(500).json({ error: "Не удалось сгенерировать скрипт. Слот не занят, попробуйте снова." });
      }

      const program = await storage.createProgram({
        programTypeId: programType.id,
        title,
        prompt,
        scheduledDate: dateStr,
        slotNumber: nextSlot,
        status: "script_ready",
        scriptText,
      });

      res.json(program);
    } catch (error) {
      console.error("Error auto-creating program:", error);
      res.status(500).json({ error: "Failed to auto-create program" });
    }
  });

  app.post("/api/fetch-url-content", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(400).json({ error: "Некорректный URL" });
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: "Разрешены только HTTP/HTTPS ссылки" });
      }

      const hostname = parsedUrl.hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.") || hostname === "::1" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        return res.status(400).json({ error: "Внутренние адреса запрещены" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; RadioBot/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return res.status(400).json({ error: `Не удалось загрузить URL: ${response.status}` });
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        $("script, style, nav, footer, header, noscript, iframe, svg, img, link, meta").remove();

        let text = "";
        const title = $("title").text().trim();

        const mainSelectors = ["main", "article", "[role='main']", ".content", "#content", ".post-content", ".markdown-body", ".conversation-content"];
        let mainContent = "";
        for (const sel of mainSelectors) {
          const el = $(sel);
          if (el.length) {
            mainContent = el.text().replace(/\s+/g, " ").trim();
            if (mainContent.length > 100) break;
          }
        }

        if (mainContent.length > 100) {
          text = mainContent;
        } else {
          text = $("body").text().replace(/\s+/g, " ").trim();
        }

        const maxLength = 50000;
        if (text.length > maxLength) {
          text = text.substring(0, maxLength) + "...";
        }

        res.json({ title, text, url, length: text.length });
      } catch (fetchError: any) {
        clearTimeout(timeout);
        if (fetchError.name === "AbortError") {
          return res.status(408).json({ error: "Таймаут загрузки URL (30 сек)" });
        }
        throw fetchError;
      }
    } catch (error) {
      console.error("Error fetching URL content:", error);
      res.status(500).json({ error: "Не удалось загрузить контент по ссылке" });
    }
  });

  app.post("/api/programs/batch-create/:typeId", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const { count, referenceContent, referenceUrl } = req.body;
      const totalCount = Math.min(Math.max(count || 10, 5), 50);

      const existingPrograms = await storage.getProgramsByType(programType.id);
      const existingTitles = existingPrograms
        .filter(p => p.title)
        .slice(-20)
        .map(p => p.title)
        .join(", ");

      const ctx = await buildStationContext();
      const anthropic = await getAnthropicClient();

      const voicesList = await storage.getVoices();
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      let prompt = `Создай ${totalCount} ГОТОВЫХ сценариев для радиопередачи "${programType.name}" на радио "${ctx.stationName}".

Базовый промпт передачи:
${programType.defaultPrompt}

`;

      if (isMultiSpeaker) {
        const speakerList = assignedVoices.map(v => v.personaName || v.name).join(", ");
        prompt += `\nФОРМАТ: мульти-спикерный скрипт. Спикеры: ${speakerList}
Каждая реплика начинается с [Имя]: и содержит теги эмоций.
Доступные теги: [energetic] [fast] [slow] [surprised] [thoughtful] [happy] [sad] [exclaims] [announcer] [serious] [calm] [excited] [warm] [dramatic] [whisper] [loud] [gentle] [playful] [confident]
Пример:
[${assignedVoices[0]?.personaName || assignedVoices[0]?.name}]: [energetic] [fast] Текст...
[${assignedVoices[1]?.personaName || assignedVoices[1]?.name}]: [announcer] ЗАГОЛОВОК
\n`;
      }

      const latestRef = existingPrograms
        .filter(p => p.scriptText && p.scriptText.includes("]:"))
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, 1)[0];

      if (latestRef?.scriptText) {
        prompt += `\nОБРАЗЕЦ — последний выпуск с назначенными дикторами. Следуй ТОЧНО такому же формату и стилю:\n---\n${latestRef.scriptText.substring(0, 5000)}\n---\n`;
      }

      if (referenceContent) {
        prompt += `\nЭТАЛОНЫЙ КОНТЕНТ — изучи стиль, формат, тон. Создай новые выпуски ТОЧНО В ТАКОМ ЖЕ стиле:\n${referenceContent.substring(0, 30000)}\n`;
      }

      if (existingTitles) {
        prompt += `\nУже есть выпуски (НЕ повторяй): ${existingTitles}\n`;
      }

      if (programType.sponsorName) {
        prompt += `\nСпонсор: ${programType.sponsorName}`;
        if (programType.sponsorText) prompt += `. ${programType.sponsorText}`;
        prompt += "\n";
      }

      const { instructions } = req.body;
      if (instructions) {
        prompt += `\nДополнительные инструкции: ${instructions}\n`;
      }

      prompt += `
Ответь ТОЛЬКО JSON массивом из ${totalCount} объектов. Каждый объект:
- "title": уникальное короткое название выпуска
- "script": ПОЛНЫЙ ГОТОВЫЙ сценарий выпуска (текст для озвучки${isMultiSpeaker ? ", в мульти-спикерном формате [Имя]: [теги] текст" : ", с репликами ведущих"})

Формат: [{"title":"...","script":"..."},...]
Все ${totalCount} выпусков должны быть разными.${referenceContent ? " Стиль и формат — как в эталоне." : ""}
Ответь ТОЛЬКО JSON массивом, без пояснений.`;

      const systemPrompt = `Ты - автор контента для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Активные ведущие: ${ctx.personaList}.
Генерируй контент на русском языке. Отвечай ТОЛЬКО валидным JSON.`;

      let batchScripts: Array<{ title: string; script: string }> = [];

      try {
        let resultText = "";
        if (anthropic) {
          const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 16384,
            system: systemPrompt,
            messages: [{ role: "user", content: prompt }],
          });
          const textContent = message.content.find(c => c.type === "text");
          resultText = textContent?.text || "";
        } else {
          const response = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 16384,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
          });
          resultText = response.choices[0]?.message?.content || "";
        }

        const jsonMatch = resultText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Не удалось распарсить результат" });
        }
        batchScripts = JSON.parse(jsonMatch[0]);
      } catch (genError) {
        console.error("Batch generation failed:", genError);
        return res.status(500).json({ error: "Ошибка генерации сценариев" });
      }

      if (!Array.isArray(batchScripts) || batchScripts.length === 0) {
        return res.status(500).json({ error: "Пустой результат генерации" });
      }

      const startDate = req.body.startDate;
      const baseDate = startDate ? new Date(startDate) : new Date();
      const dailyCount = programType.dailyCount || 1;
      const results: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < batchScripts.length; i++) {
        const item = batchScripts[i];
        const dayOffset = Math.floor(i / dailyCount);
        const slotNumber = (i % dailyCount) + 1;
        const programDate = new Date(baseDate);
        programDate.setDate(programDate.getDate() + dayOffset);
        const dateStr = programDate.toISOString().split("T")[0];

        try {
          const program = await storage.createProgram({
            programTypeId: programType.id,
            title: item.title,
            prompt: prompt.substring(0, 500),
            scheduledDate: dateStr,
            slotNumber,
            status: "script_ready",
            scriptText: item.script,
          });
          results.push(program);
        } catch (saveError) {
          console.error(`Batch save ${i} failed:`, saveError);
          errors.push(`#${i + 1} "${item.title}": ошибка сохранения`);
        }
      }

      res.json({
        created: results.length,
        total: batchScripts.length,
        errors,
        programs: results,
      });
    } catch (error) {
      console.error("Error batch-creating programs:", error);
      res.status(500).json({ error: "Ошибка пакетной генерации" });
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
      const voicesList = await storage.getVoices();
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      let systemPrompt: string;
      if (isMultiSpeaker) {
        const speakerList = assignedVoices.map(v => `${v.personaName || v.name}`).join(", ");
        systemPrompt = `Ты - сценарист для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}

ФОРМАТ СКРИПТА — мульти-спикерный с тегами эмоций:
Спикеры: ${speakerList}

Каждая реплика начинается с [Имя]: и может содержать теги эмоций в квадратных скобках.
Доступные теги: [energetic] [fast] [slow] [surprised] [thoughtful] [happy] [sad] [exclaims] [announcer] [serious] [calm] [excited] [warm] [dramatic] [whisper] [loud] [gentle] [playful] [confident]

Пример формата:
[${assignedVoices[0]?.personaName || assignedVoices[0]?.name}]: [energetic] [fast] Привет! Текст первого спикера...
[${assignedVoices[1]?.personaName || assignedVoices[1]?.name}]: [announcer] ЗАГОЛОВОК РУБРИКИ
[${assignedVoices[0]?.personaName || assignedVoices[0]?.name}]: [surprised] Интересный факт! [thoughtful] Пояснение...

Создавай контент на русском языке. Используй теги для придания выразительности.
Обязательно чередуй спикеров, создавая динамичную передачу.`;
      } else {
        systemPrompt = `Ты - автор контента для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Активные ведущие: ${ctx.personaList}.
Создавай контент на русском языке в стиле радиостанции.`;
      }

      const anthropic = await getAnthropicClient();
      
      if (anthropic) {
        const message = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
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
      const programType = await storage.getProgramType(program.programTypeId);

      const generateVoiceSegment = async (text: string, voiceId: string): Promise<Buffer> => {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": settings.elevenLabsApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_v3",
            output_format: "mp3_44100_192",
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

      const audioDir = path.join(process.cwd(), "public", "audio");
      await fs.mkdir(audioDir, { recursive: true });
      const timestamp = Date.now();

      if (isMultiSpeakerScript(program.scriptText)) {
        const segments = parseMultiSpeakerScript(program.scriptText);
        if (segments.length === 0) {
          return res.status(400).json({ error: "Не удалось распарсить мульти-спикерный скрипт" });
        }

        const assignedVoices = resolveAssignedVoices(voicesList, programType);

        const speakerVoiceMap = new Map<string, string>();
        for (const voice of assignedVoices) {
          const speakerName = voice.personaName || voice.name;
          speakerVoiceMap.set(speakerName.toLowerCase(), voice.elevenLabsVoiceId);
        }

        const audioBuffers: Buffer[] = [];
        let segmentErrors: string[] = [];

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const cleanText = stripEmotionTags(segment.text);
          if (!cleanText) continue;

          let voiceId = speakerVoiceMap.get(segment.speaker.toLowerCase());
          if (!voiceId) {
            for (const [name, vid] of speakerVoiceMap.entries()) {
              if (segment.speaker.toLowerCase().includes(name) || name.includes(segment.speaker.toLowerCase())) {
                voiceId = vid;
                break;
              }
            }
          }
          if (!voiceId) {
            voiceId = assignedVoices[0]?.elevenLabsVoiceId;
          }
          if (!voiceId) {
            segmentErrors.push(`Сегмент ${i + 1}: голос не найден для "${segment.speaker}"`);
            continue;
          }

          try {
            console.log(`Synthesizing segment ${i + 1}/${segments.length}: [${segment.speaker}] (${cleanText.length} chars)`);
            const buffer = await generateVoiceSegment(cleanText, voiceId);
            audioBuffers.push(buffer);
          } catch (err) {
            console.error(`Segment ${i + 1} synthesis error:`, err);
            segmentErrors.push(`Сегмент ${i + 1} (${segment.speaker}): ошибка синтеза`);
          }
        }

        if (audioBuffers.length === 0) {
          return res.status(500).json({ error: "Не удалось озвучить ни один сегмент", details: segmentErrors });
        }

        const combined = Buffer.concat(audioBuffers);
        const filename = `program_${timestamp}.mp3`;
        await fs.writeFile(path.join(audioDir, filename), combined);

        const totalExpected = segments.filter(s => stripEmotionTags(s.text).length > 0).length;
        const hasErrors = segmentErrors.length > 0;
        const status = hasErrors ? (audioBuffers.length < totalExpected ? "error" : "ready") : "ready";

        const updated = await storage.updateProgram(program.id, {
          audioUrl: `/audio/${filename}`,
          status,
        });

        res.json({ ...updated, segmentCount: audioBuffers.length, totalSegments: totalExpected, errors: segmentErrors });
      } else {
        const resolved = resolveAssignedVoices(voicesList, programType);
        const activeVoice = resolved.length > 0 ? resolved[0] : voicesList.find(v => v.isActive);

        if (!activeVoice) {
          return res.status(400).json({ error: "No active voice configured" });
        }

        const buffer = await generateVoiceSegment(program.scriptText, activeVoice.elevenLabsVoiceId);
        const filename = `program_${timestamp}.mp3`;
        await fs.writeFile(path.join(audioDir, filename), buffer);

        const updated = await storage.updateProgram(program.id, {
          audioUrl: `/audio/${filename}`,
          status: "ready",
        });

        res.json(updated);
      }
    } catch (error) {
      console.error("Error generating program audio:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate program audio" });
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

  // Freesound API for royalty-free music
  const FREESOUND_API_BASE = "https://freesound.org/apiv2";
  
  async function getFreesoundApiKey(): Promise<string | null> {
    const settings = await storage.getSettings();
    return settings?.freesoundApiKey || null;
  }
  
  app.get("/api/music/search", async (req, res) => {
    try {
      const { query } = req.query;
      const apiKey = await getFreesoundApiKey();
      
      if (!apiKey) {
        return res.status(400).json({ 
          error: "Freesound API key not configured",
          needsApiKey: true 
        });
      }
      
      const searchQuery = query ? String(query) : "background music";
      const url = `${FREESOUND_API_BASE}/search/text/?query=${encodeURIComponent(searchQuery)}&filter=duration:[30 TO 300] tag:music&fields=id,name,duration,tags,previews,username,license&page_size=20&token=${apiKey}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Freesound API error:", errorText);
        return res.status(response.status).json({ error: "Freesound API error" });
      }
      
      const data = await response.json();
      const tracks = (data.results || []).map((sound: any) => ({
        id: String(sound.id),
        title: sound.name,
        mainArtists: [sound.username],
        bpm: 0,
        length: Math.round(sound.duration),
        moods: sound.tags?.slice(0, 5).map((t: string) => ({ name: t })) || [],
        images: { default: "" },
        audioUrl: sound.previews?.["preview-hq-mp3"] || sound.previews?.["preview-lq-mp3"] || "",
        license: sound.license,
      }));
      
      res.json({ tracks });
    } catch (error) {
      console.error("Error searching music:", error);
      res.status(500).json({ error: "Failed to search music" });
    }
  });

  app.get("/api/music/track/:trackId/stream", async (req, res) => {
    try {
      const { trackId } = req.params;
      const apiKey = await getFreesoundApiKey();
      
      if (!apiKey) {
        return res.status(400).json({ error: "Freesound API key not configured" });
      }
      
      const url = `${FREESOUND_API_BASE}/sounds/${trackId}/?fields=previews&token=${apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return res.status(404).json({ error: "Track not found" });
      }
      
      const data = await response.json();
      const audioUrl = data.previews?.["preview-hq-mp3"] || data.previews?.["preview-lq-mp3"];
      
      res.json({ url: audioUrl });
    } catch (error) {
      console.error("Error getting stream URL:", error);
      res.status(500).json({ error: "Failed to get stream" });
    }
  });

  app.post("/api/music/auto-select", async (req, res) => {
    try {
      const { adText, category, title } = req.body;
      if (!adText) {
        return res.status(400).json({ error: "Ad text is required" });
      }

      const anthropic = await getAnthropicClient();
      if (!anthropic) {
        return res.status(400).json({ error: "Claude API key not configured" });
      }

      const freesoundKey = await getFreesoundApiKey();
      if (!freesoundKey) {
        return res.status(400).json({ 
          error: "Freesound API key not configured",
          needsApiKey: true 
        });
      }

      const categoryLabels: Record<string, string> = {
        general: "общая реклама",
        restaurant: "ресторан/кафе",
        real_estate: "недвижимость",
        services: "услуги",
        shop: "магазин/товары",
        events: "мероприятия/события",
      };

      const analysisPrompt = `Проанализируй рекламный текст и определи подходящий поисковый запрос для фоновой музыки.

РЕКЛАМНЫЙ ТЕКСТ:
${adText}

КАТЕГОРИЯ РЕКЛАМЫ: ${categoryLabels[category] || category}
${title ? `НАЗВАНИЕ: ${title}` : ""}

Твоя задача - сформулировать поисковый запрос на английском для поиска фоновой музыки в библиотеке Freesound.

Учитывай:
- Настроение текста (радостное, спокойное, энергичное, элегантное)
- Целевую аудиторию
- Категорию бизнеса
- Темп подачи информации

Ответь ТОЛЬКО в формате JSON:
{
  "searchQuery": "поисковый запрос на английском (2-4 слова, жанр + настроение)",
  "reasoning": "краткое объяснение выбора на русском (1 предложение)"
}

Примеры хороших запросов: "upbeat corporate background", "calm piano ambient", "happy pop music", "elegant jazz lounge"`;

      const claudeResponse = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: analysisPrompt }],
      });

      const responseText = claudeResponse.content[0].type === "text" 
        ? claudeResponse.content[0].text 
        : "";
      
      let analysis;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found");
        }
      } catch {
        analysis = {
          searchQuery: "upbeat background music",
          reasoning: "Стандартный выбор для рекламы",
        };
      }

      const searchUrl = `${FREESOUND_API_BASE}/search/text/?query=${encodeURIComponent(analysis.searchQuery)}&filter=duration:[30 TO 180] tag:music&fields=id,name,duration,tags,previews,username,license&page_size=10&token=${freesoundKey}`;
      
      const searchResponse = await fetch(searchUrl);
      let tracks: any[] = [];
      
      if (searchResponse.ok) {
        const data = await searchResponse.json();
        tracks = (data.results || []).map((sound: any) => ({
          id: String(sound.id),
          title: sound.name,
          mainArtists: [sound.username],
          bpm: 0,
          length: Math.round(sound.duration),
          moods: sound.tags?.slice(0, 5).map((t: string) => ({ name: t })) || [],
          images: { default: "" },
          audioUrl: sound.previews?.["preview-hq-mp3"] || sound.previews?.["preview-lq-mp3"] || "",
          license: sound.license,
        }));
      }

      res.json({
        tracks,
        analysis: {
          primaryQuery: analysis.searchQuery,
          secondaryQuery: "",
          reasoning: analysis.reasoning,
        },
        recommendedTrack: tracks[0] || null,
      });
    } catch (error) {
      console.error("Error auto-selecting music:", error);
      res.status(500).json({ error: "Failed to auto-select music" });
    }
  });

  app.post("/api/programs/:typeId/auto-pipeline", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const count = req.body.count || 1;
      const results: any[] = [];

      for (let i = 0; i < count; i++) {
        try {
          const createRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/auto-create/${programType.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });

          if (!createRes.ok) {
            const err = await createRes.json();
            results.push({ step: "create", error: err.error || "Failed", index: i });
            continue;
          }

          const program = await createRes.json();

          let audioOk = true;
          let uploadOk = true;

          if (programType.autoVoice !== false) {
            audioOk = false;
            try {
              const audioRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/${program.id}/generate-audio`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              if (audioRes.ok) {
                const audioData = await audioRes.json();
                program.audioUrl = audioData.audioUrl;
                program.status = "ready";
                audioOk = true;
              }
            } catch (audioErr: any) {
              console.error(`Auto-pipeline audio error for ${program.id}:`, audioErr.message);
            }
          }

          if (programType.autoUpload !== false && program.audioUrl) {
            try {
              const settings = await storage.getSettings();
              if (settings?.yandexDiskToken) {
                const normalizedUrl = program.audioUrl.startsWith("/") ? program.audioUrl.slice(1) : program.audioUrl;
                const audioPath = path.join(process.cwd(), "public", normalizedUrl);
                const fileData = await fs.readFile(audioPath);
                const yandexFolder = `/radio/${programType.slug}`;

                await fetch(`https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(yandexFolder)}`, {
                  method: "PUT",
                  headers: { Authorization: `OAuth ${settings.yandexDiskToken}` },
                }).catch(() => {});

                const fileName = program.audioUrl.split("/").pop();
                const uploadUrlRes = await fetch(
                  `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(`${yandexFolder}/${fileName}`)}&overwrite=true`,
                  { headers: { Authorization: `OAuth ${settings.yandexDiskToken}` } }
                );

                if (uploadUrlRes.ok) {
                  const { href } = await uploadUrlRes.json();
                  await fetch(href, { method: "PUT", body: fileData });
                  await storage.updateProgram(program.id, {
                    uploadedToYandex: true,
                    yandexPath: `${yandexFolder}/${fileName}`,
                  });
                  program.uploadedToYandex = true;
                }
              }
            } catch (uploadErr: any) {
              console.error(`Auto-pipeline upload error for ${program.id}:`, uploadErr.message);
            }
          }

          const allStepsOk = audioOk && (programType.autoUpload === false || uploadOk);
          results.push({ success: allStepsOk, program, audioOk, uploadOk });
        } catch (err: any) {
          results.push({ step: "pipeline", error: err.message, index: i });
        }
      }

      res.json({
        total: count,
        succeeded: results.filter(r => r.success).length,
        results,
      });
    } catch (error) {
      console.error("Error in auto-pipeline:", error);
      res.status(500).json({ error: "Auto-pipeline failed" });
    }
  });

  const runAutoScheduler = async () => {
    try {
      const types = await storage.getProgramTypes();
      const autoTypes = types.filter(t => t.isActive && t.autoGenerate);

      for (const pType of autoTypes) {
        const weeklyCount = pType.weeklyCount || 7;
        const dailyCount = pType.dailyCount || 1;
        const today = new Date();
        const dateStr = today.toISOString().split("T")[0];

        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - mondayOffset);
        const weekStartStr = weekStart.toISOString().split("T")[0];

        const existingPrograms = await storage.getProgramsByType(pType.id);
        const thisWeekPrograms = existingPrograms.filter(p => p.scheduledDate && p.scheduledDate >= weekStartStr && p.scheduledDate <= dateStr);
        const todayPrograms = existingPrograms.filter(p => p.scheduledDate === dateStr);

        const weeklyRemaining = weeklyCount - thisWeekPrograms.length;
        if (weeklyRemaining <= 0) continue;

        const neededToday = Math.min(dailyCount, weeklyRemaining) - todayPrograms.length;
        const remaining = Math.max(0, neededToday);

        if (remaining <= 0) continue;

        console.log(`[scheduler] Auto-generating ${remaining} program(s) for "${pType.name}" (${dateStr})`);

        try {
          await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/${pType.id}/auto-pipeline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ count: remaining }),
          });
        } catch (err: any) {
          console.error(`[scheduler] Error for "${pType.name}":`, err.message);
        }
      }
    } catch (err) {
      console.error("[scheduler] Error running auto-scheduler:", err);
    }
  };

  setTimeout(() => {
    runAutoScheduler();
    setInterval(runAutoScheduler, 60 * 60 * 1000);
  }, 30000);

  app.post("/api/run-scheduler", async (_req, res) => {
    runAutoScheduler();
    res.json({ status: "Scheduler triggered" });
  });

  return httpServer;
}
