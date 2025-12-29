import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema, insertAdSchema, insertVoiceSchema } from "@shared/schema";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

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
      const { name, description, miniPrompt, defaultVoiceId, defaultTargetDurationSeconds, defaultCategory } = req.body;
      if (!name || !miniPrompt) {
        return res.status(400).json({ error: "Name and miniPrompt are required" });
      }
      const preset = await storage.createAdPreset({
        name,
        description,
        miniPrompt,
        defaultVoiceId,
        defaultTargetDurationSeconds: defaultTargetDurationSeconds || 30,
        defaultCategory: defaultCategory || "general",
        isActive: true,
        sortOrder: 0,
      });
      res.json(preset);
    } catch (error) {
      console.error("Error creating ad preset:", error);
      res.status(500).json({ error: "Failed to create ad preset" });
    }
  });

  app.patch("/api/ad-presets/:id", async (req, res) => {
    try {
      const updated = await storage.updateAdPreset(req.params.id, req.body);
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
            duration: Math.round((audioBuffer.length / 1024) * 0.5),
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
          model_id: "eleven_v3",
          output_format: "mp3_44100_192",
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
