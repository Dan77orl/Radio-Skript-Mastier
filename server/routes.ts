import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerUser, loginUser, logoutUser, getCurrentUser, completeOnboarding, updateUserLanguage, requireAuth, requireAdmin, internalAuthHeaders, telegramAuth, internalApiKey } from "./auth";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema, insertAdSchema, insertAdClientSchema, insertAdPresetSchema, insertVoiceSchema, insertScheduleTemplateSchema, insertHostShiftSchema, insertCustomHolidaySchema } from "@shared/schema";
import { hasExactScriptDirective, extractDurationSecondsFromPrompt } from "@shared/prompt-length";
import { getHolidaysForDate, getHolidaysForYear, getHolidaysForMonth, getHolidayInfo, setCustomHolidays } from "./holidays";
import { getPromptStrings, getGenderLabel, getDefaultHostName, getLanguageDirective, getLanguageName } from "./prompt-locale";
import { handleSupportChat } from "./support-chat";
import { synthesizeSpeech, describeTtsError } from "./tts";
import { parseImportedScripts } from "./script-import";
import { createRateLimiter } from "./rate-limit";
import { getJob, listJobs, enqueueJob, registerJobHandler } from "./jobs/queue";
import { archiveAudio, restoreAudio } from "./storage-providers";
import { buildAuthUrl, exchangeCodeForTokens, isGoogleDriveConfigured, ensureRootFolder as googleDriveEnsureRootFolder } from "./storage-providers/google-drive";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import mammoth from "mammoth";
import * as cheerio from "cheerio";

const uploadDir = path.join(process.cwd(), "public", "uploads");

// Extension is derived from the mime type, never from the client-supplied
// filename: uploads are served from public/, so an attacker-chosen ".html" or
// ".svg" would execute as same-origin script.
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "text/plain": ".txt",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = ALLOWED_UPLOAD_TYPES[file.mimetype] || ".bin";
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_TYPES[file.mimetype]) {
      const err: any = new Error(`Unsupported file type: ${file.mimetype}`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
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

// claude-sonnet-4-20250514 was scheduled for retirement on 2026-06-15; anything
// still pinned to it will start failing. Override with CLAUDE_MODEL if the
// proxy in front of the API only exposes a specific model.
const CLAUDE_MODEL_DIRECT = "claude-opus-5";
const CLAUDE_MODEL_REPLIT = "claude-opus-5";
function getClaudeModel(): string {
  if (process.env.CLAUDE_MODEL) return process.env.CLAUDE_MODEL;
  return (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL)
    ? CLAUDE_MODEL_REPLIT
    : CLAUDE_MODEL_DIRECT;
}
const CLAUDE_MODEL = getClaudeModel();

/**
 * Current Claude models think by default, and max_tokens caps thinking AND the
 * reply together. The small budgets these call sites were written with (10, 300,
 * 512 …) would now truncate the answer before it starts, so enforce a floor.
 */
const MIN_AI_MAX_TOKENS = 6000;
function aiMaxTokens(requested: number): number {
  return Math.max(requested, MIN_AI_MAX_TOKENS);
}

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

function getEffectiveElevenLabsKey(settings: any): string | null {
  // Env first, like Anthropic below: keys are operated centrally in secrets,
  // and a stale per-user value in the database must not shadow a rotated one.
  return process.env.ELEVENLABS_API_KEY || settings?.elevenLabsApiKey || null;
}

function getEffectiveAnthropicKey(settings: any): string | null {
  return process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || settings?.anthropicApiKey || null;
}

function withEffectiveKeys(settings: any): any {
  if (!settings) return settings;
  return {
    ...settings,
    elevenLabsApiKey: getEffectiveElevenLabsKey(settings),
    anthropicApiKey: getEffectiveAnthropicKey(settings),
  };
}

async function getAnthropicClient(userId?: string): Promise<Anthropic | null> {
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
    return new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  const settings = await storage.getSettings(userId);
  const apiKey = getEffectiveAnthropicKey(settings);
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

function resolveStationCountry(stationLocation: string | null | undefined): string {
  if (!stationLocation) return "";
  const loc = stationLocation.toLowerCase();
  if (loc.includes("турц") || loc.includes("turkey") || loc.includes("alanya") || loc.includes("аланья") || loc.includes("türkiye")) return "TR";
  if (loc.includes("росс") || loc.includes("russia") || loc.includes("москв") || loc.includes("moscow")) return "RU";
  if (loc.includes("usa") || loc.includes("united states") || loc.includes("сша") || loc.includes("america")) return "US";
  if (loc.includes("german") || loc.includes("герман") || loc.includes("deutsch")) return "DE";
  return "";
}

interface StationContext {
  stationName: string;
  stationDescription: string;
  malePersona: string;
  femalePersona: string;
  personaList: string;
  knowledgeBase: string;
}

async function buildStationContext(userId?: string, lang?: string): Promise<StationContext> {
  const settings = await storage.getSettings(userId);
  const voices = userId ? await storage.getVoices(userId) : [];
  const userLang = lang || "en";
  
  const stationName = settings?.stationName || "Radio FM";
  const stationDescription = settings?.stationDescription || "";
  
  const activeVoices = voices.filter(v => v.isActive);
  const maleVoices = activeVoices.filter(v => v.gender === "male");
  const femaleVoices = activeVoices.filter(v => v.gender === "female");
  
  const malePersona = maleVoices.length > 0 
    ? maleVoices.map(v => getCleanVoiceName(v)).join(", ")
    : getDefaultHostName("male", userLang);
  const femalePersona = femaleVoices.length > 0 
    ? femaleVoices.map(v => getCleanVoiceName(v)).join(", ")
    : getDefaultHostName("female", userLang);
  
  const personaList = activeVoices.length > 0 
    ? activeVoices.map(v => `${getCleanVoiceName(v)} (${getGenderLabel(v.gender || "male", userLang)})`).join(", ")
    : `${getDefaultHostName("male", userLang)} (${getGenderLabel("male", userLang)}), ${getDefaultHostName("female", userLang)} (${getGenderLabel("female", userLang)})`;

  let knowledgeBase = "";
  if (settings?.stationAttachments && settings.stationAttachments.length > 0) {
    knowledgeBase = settings.stationAttachments.join("\n\n");
  }
  
  return { stationName, stationDescription, malePersona, femalePersona, personaList, knowledgeBase };
}

function countSpokenWords(scriptText: string): number {
  if (!scriptText) return 0;
  const cleaned = scriptText
    .replace(/^\s*(?:ТЕМА|TOPIC):\s*.+$/gim, "")
    .replace(/^\s*\[[^\]]+\]\s*:/gm, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

async function enforceMaxWords(
  scriptText: string,
  maxWords: number,
  systemPrompt: string,
  userPromptForContext: string,
  anthropic: Anthropic | null,
  lang: string,
): Promise<string> {
  if (!scriptText || maxWords <= 0) return scriptText;
  const current = countSpokenWords(scriptText);
  const overshootRatio = current / maxWords;
  if (overshootRatio <= 1.1) return scriptText;
  const isRu = lang?.toLowerCase().startsWith("ru");
  const compressInstruction = isRu
    ? `Сценарий получился ${current} слов, а абсолютный максимум — ${maxWords} слов. СОКРАТИ его до ${maxWords} слов или меньше. Жёсткие правила:
- сохрани тот же формат строк ([Имя]: [тон] [настроение] текст или [Имя]: текст),
- сохрани последовательность и состав ведущих,
- сохрани финальную брендовую строку слово в слово, если она есть,
- сохрани конкретные числа и факты (температуры, даты и т.п.), не выдумывай новые,
- убери воду, повторы, лишние эпитеты, длинные подводки — оставь суть.
Верни ТОЛЬКО переработанный сценарий, без пояснений до или после.

Текущий сценарий:
${scriptText}`
    : `The script is ${current} words long but the absolute maximum is ${maxWords} words. COMPRESS it to ${maxWords} words or fewer. Hard rules:
- keep the same line format ([Name]: [tone] [mood] text or [Name]: text),
- keep the same hosts and their order,
- keep the final branded line verbatim if present,
- keep concrete numbers and facts (temperatures, dates, etc.); do not invent new ones,
- cut filler, repetition, decorative epithets, long lead-ins — keep the substance.
Return ONLY the rewritten script, with no commentary before or after.

Current script:
${scriptText}`;
  try {
    if (anthropic) {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: aiMaxTokens(2048),
        system: systemPrompt,
        messages: [{ role: "user", content: compressInstruction }],
      });
      const textContent = message.content.find(c => c.type === "text");
      const compressed = (textContent as any)?.text?.trim();
      if (compressed && countSpokenWords(compressed) < current) {
        return compressed;
      }
    } else {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: compressInstruction },
        ],
      });
      const compressed = response.choices[0]?.message?.content?.trim();
      if (compressed && countSpokenWords(compressed) < current) {
        return compressed;
      }
    }
  } catch (err: any) {
    console.error("enforceMaxWords compression failed:", err?.message || err);
  }
  return scriptText;
}

interface ScriptSegment {
  speaker: string;
  text: string;
}

function parseMultiSpeakerScript(scriptText: string): ScriptSegment[] {
  const rawSegments: ScriptSegment[] = [];
  const lines = scriptText.split("\n");
  let currentSpeaker = "";
  let currentText = "";
  
  for (const line of lines) {
    const speakerMatch = line.match(/^\s*\[([^\]]+)\]:\s*(.*)/);
    if (speakerMatch) {
      if (currentSpeaker && currentText.trim()) {
        rawSegments.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = speakerMatch[1];
      currentText = speakerMatch[2];
    } else if (currentSpeaker) {
      currentText += " " + line;
    }
  }
  
  if (currentSpeaker && currentText.trim()) {
    rawSegments.push({ speaker: currentSpeaker, text: currentText.trim() });
  }

  const merged: ScriptSegment[] = [];
  for (const seg of rawSegments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker.toLowerCase() === seg.speaker.toLowerCase()) {
      last.text = last.text + " " + seg.text;
    } else {
      merged.push({ speaker: seg.speaker, text: seg.text });
    }
  }
  
  return merged;
}

function resolveAssignedVoices(voicesList: any[], programType: any): any[] {
  if (programType.assignedVoiceIds?.length) {
    return voicesList.filter(v => programType.assignedVoiceIds.includes(v.id));
  }
  return voicesList.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(programType.id));
}

function isGarbageContent(text: string): boolean {
  const garbagePatterns = [
    /^skip to content/i,
    /^new chat/i,
    /by messaging chatgpt/i,
    /you agree to our terms/i,
    /privacy policy/i,
    /chat history/i,
    /search chats/i,
    /sign up.*log in/i,
    /create.*free account/i,
  ];
  const lowerText = text.toLowerCase().substring(0, 500);
  const matchCount = garbagePatterns.filter(p => p.test(lowerText)).length;
  if (matchCount >= 3) return true;
  return false;
}

function extractSpeakerFromPrompt(promptText: string): string | null {
  const patterns = [
    /[Сс] вами\s+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/,
    /[Вв]едущ(?:ая|ий|ая программы)[:\s]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/,
    /\*\*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?):\*\*/,
    /^([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?):[\s]/m,
  ];
  for (const p of patterns) {
    const m = promptText.match(p);
    if (m && m[1] && m[1].length > 3 && m[1].length < 40) {
      return m[1].trim();
    }
  }
  return null;
}

function getCleanVoiceName(voice: { personaName?: string | null; name: string }): string {
  if (voice.personaName) return voice.personaName;
  const name = voice.name;
  const dashIdx = name.indexOf(" - ");
  if (dashIdx > 0) return name.substring(0, dashIdx).trim();
  return name;
}

function extractFirecrawlKeywords(topics: string[]): string[] {
  return topics.map(t => {
    if (t.startsWith("http")) {
      const qMatch = t.match(/[?&]q=([^&]+)/);
      if (qMatch) {
        try {
          return decodeURIComponent(qMatch[1]).replace(/\+/g, " ").replace(/%s\s*/g, "").trim();
        } catch {
          return qMatch[1].replace(/\+/g, " ").replace(/%s\s*/g, "").trim();
        }
      }
      return "";
    }
    return t;
  }).filter(t => t.length > 0);
}

async function firecrawlScrapeUrl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return "";

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        waitFor: 5000,
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl scrape error: ${response.status}`);
      return "";
    }

    const data = await response.json();
    const markdown = data.data?.markdown || "";
    return markdown.substring(0, 20000);
  } catch (err: any) {
    console.error("Firecrawl scrape error:", err.message);
    return "";
  }
}

async function fetchChatGptShare(url: string): Promise<string> {
  const shareMatch = url.match(/chatgpt\.com\/share\/([a-f0-9-]+)/i) 
    || url.match(/chat\.openai\.com\/share\/([a-f0-9-]+)/i);
  if (!shareMatch) return "";
  const shareId = shareMatch[1];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return "";

    const html = await response.text();

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const messages = nextData?.props?.pageProps?.serverResponse?.data?.mapping 
          || nextData?.props?.pageProps?.data?.mapping;
        if (messages) {
          const texts: string[] = [];
          for (const key of Object.keys(messages)) {
            const msg = messages[key]?.message;
            if (msg?.content?.parts) {
              const role = msg.author?.role;
              if (role === "assistant") {
                texts.push(msg.content.parts.join("\n"));
              }
            }
          }
          if (texts.length > 0) {
            const result = texts.join("\n\n---\n\n");
            console.log(`ChatGPT share ${shareId}: extracted ${result.length} chars from __NEXT_DATA__ (${texts.length} assistant messages)`);
            return result.substring(0, 20000);
          }
        }
      } catch (e) {
        console.log(`ChatGPT share: failed to parse __NEXT_DATA__ JSON`);
      }
    }

    const jsonScriptMatches = html.match(/<script[^>]*>(\{[\s\S]*?"mapping"[\s\S]*?\})<\/script>/g);
    if (jsonScriptMatches) {
      for (const scriptBlock of jsonScriptMatches) {
        const jsonContent = scriptBlock.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
        try {
          const data = JSON.parse(jsonContent);
          if (data.mapping) {
            const texts: string[] = [];
            for (const key of Object.keys(data.mapping)) {
              const msg = data.mapping[key]?.message;
              if (msg?.content?.parts && msg.author?.role === "assistant") {
                texts.push(msg.content.parts.join("\n"));
              }
            }
            if (texts.length > 0) {
              const result = texts.join("\n\n---\n\n");
              console.log(`ChatGPT share ${shareId}: extracted ${result.length} chars from embedded JSON`);
              return result.substring(0, 20000);
            }
          }
        } catch (e) {}
      }
    }

    const $ = cheerio.load(html);
    const conversationParts: string[] = [];
    $("[data-message-author-role='assistant']").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 10) conversationParts.push(text);
    });
    if (conversationParts.length > 0) {
      const result = conversationParts.join("\n\n---\n\n");
      console.log(`ChatGPT share ${shareId}: extracted ${result.length} chars from DOM data-attributes`);
      return result.substring(0, 20000);
    }

    $(".markdown, .whitespace-pre-wrap, [class*='message']").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) conversationParts.push(text);
    });
    if (conversationParts.length > 0) {
      const result = conversationParts.join("\n\n---\n\n");
      console.log(`ChatGPT share ${shareId}: extracted ${result.length} chars from CSS class selectors`);
      return result.substring(0, 20000);
    }

    console.log(`ChatGPT share ${shareId}: could not extract content from HTML (${html.length} chars total)`);
    return "";
  } catch (err: any) {
    console.log(`ChatGPT share fetch error: ${err.message}`);
    return "";
  }
}

async function fetchClaudeShare(url: string): Promise<string> {
  const shareMatch = url.match(/claude\.ai\/share\/([a-f0-9-]+)/i);
  if (!shareMatch) return "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return "";

    const html = await response.text();

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const messages = data?.props?.pageProps?.chatMessages || data?.props?.pageProps?.messages;
        if (messages && Array.isArray(messages)) {
          const texts = messages
            .filter((m: any) => m.sender === "assistant" || m.role === "assistant")
            .map((m: any) => m.text || m.content || (m.content_parts || []).map((p: any) => typeof p === "string" ? p : p.text || "").join("\n"))
            .filter((t: string) => t.length > 10);
          if (texts.length > 0) {
            const result = texts.join("\n\n---\n\n");
            console.log(`Claude share: extracted ${result.length} chars from __NEXT_DATA__`);
            return result.substring(0, 20000);
          }
        }
      } catch (e) {}
    }

    const jsonMatches = html.match(/<script[^>]*>\s*(\{[\s\S]*?"chatMessages"[\s\S]*?\})\s*<\/script>/g)
      || html.match(/<script[^>]*>\s*(\[[\s\S]*?"sender"[\s\S]*?\])\s*<\/script>/g);
    if (jsonMatches) {
      for (const block of jsonMatches) {
        const json = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "").trim();
        try {
          const data = JSON.parse(json);
          const msgs = data.chatMessages || data;
          if (Array.isArray(msgs)) {
            const texts = msgs
              .filter((m: any) => m.sender === "assistant")
              .map((m: any) => m.text || "")
              .filter((t: string) => t.length > 10);
            if (texts.length > 0) {
              return texts.join("\n\n---\n\n").substring(0, 20000);
            }
          }
        } catch (e) {}
      }
    }

    return "";
  } catch (err: any) {
    console.log(`Claude share fetch error: ${err.message}`);
    return "";
  }
}

async function fetchUrlContent(url: string): Promise<{ text: string; method: string }> {
  if (/chatgpt\.com\/share|chat\.openai\.com\/share/i.test(url)) {
    const text = await fetchChatGptShare(url);
    if (text.length > 50) return { text, method: "chatgpt_share" };
    
    const markdown = await firecrawlScrapeUrl(url);
    if (markdown.length > 50) return { text: markdown, method: "firecrawl" };
    
    return { text: "", method: "chatgpt_empty" };
  }

  if (/claude\.ai\/share/i.test(url)) {
    const text = await fetchClaudeShare(url);
    if (text.length > 50) return { text, method: "claude_share" };
    
    const markdown = await firecrawlScrapeUrl(url);
    if (markdown.length > 50) return { text: markdown, method: "firecrawl" };
    
    return { text: "", method: "claude_empty" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { text: "", method: `error_${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, noscript, iframe, svg, img, link, meta").remove();

    let text = "";
    const mainSelectors = ["main", "article", "[role='main']", ".content", "#content", ".post-content", ".markdown-body", ".conversation-content"];
    for (const sel of mainSelectors) {
      const el = $(sel);
      if (el.length) {
        text = el.text().replace(/\s+/g, " ").trim();
        if (text.length > 100) break;
      }
    }
    if (text.length <= 100) {
      text = $("body").text().replace(/\s+/g, " ").trim();
    }

    if (text.length > 20000) text = text.substring(0, 20000);

    if (text.length > 50 && !isGarbageContent(text)) {
      return { text, method: "direct" };
    }

    console.log(`URL ${url}: direct fetch got garbage/empty (${text.length} chars), trying Firecrawl...`);
    const markdown = await firecrawlScrapeUrl(url);
    if (markdown.length > 50) {
      return { text: markdown, method: "firecrawl_fallback" };
    }

    return { text: "", method: "failed" };
  } catch (err: any) {
    console.log(`Failed to fetch URL ${url}: ${err.message}, trying Firecrawl...`);
    const markdown = await firecrawlScrapeUrl(url);
    if (markdown.length > 50) {
      return { text: markdown, method: "firecrawl_fallback" };
    }
    return { text: "", method: "failed" };
  }
}

async function fetchAndExpandUrls(promptText: string): Promise<{ prompt: string; fetchedContent: string }> {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = promptText.match(urlRegex);
  if (!urls || urls.length === 0) {
    return { prompt: promptText, fetchedContent: "" };
  }

  let fetchedContent = "";
  let expandedPrompt = promptText;

  for (const url of urls.slice(0, 3)) {
    const { text, method } = await fetchUrlContent(url);
    if (text.length > 50) {
      fetchedContent += `\n\n--- КОНТЕНТ ИЗ ССЫЛКИ ${url} ---\n${text}\n--- КОНЕЦ КОНТЕНТА ---\n`;
      expandedPrompt = expandedPrompt.replace(url, `[контент загружен из: ${url}]`);
      console.log(`URL ${url}: loaded ${text.length} chars via ${method}`);
    } else {
      console.log(`URL ${url}: no content extracted (method: ${method})`);
      expandedPrompt = expandedPrompt.replace(url, "").trim();
    }
  }

  return { prompt: expandedPrompt, fetchedContent };
}

function resolveFileName(template: string | null | undefined, programType: any, program: any, timestamp: number): string {
  if (!template || !template.trim()) {
    return `program_${timestamp}.mp3`;
  }
  const date = program.scheduledDate || new Date().toISOString().split("T")[0];
  const slot = program.slotNumber || 1;
  const name = template
    .replace(/\{название\}/gi, programType.name || "program")
    .replace(/\{name\}/gi, programType.name || "program")
    .replace(/\{дата\}/gi, date)
    .replace(/\{date\}/gi, date)
    .replace(/\{номер\}/gi, String(slot))
    .replace(/\{number\}/gi, String(slot))
    .replace(/\{id\}/gi, String(timestamp));
  const sanitized = name.replace(/[<>:"|?*\/\\]/g, "_").trim();
  if (!sanitized) return `program_${timestamp}.mp3`;
  return sanitized.endsWith(".mp3") ? sanitized : `${sanitized}.mp3`;
}

function stripEmotionTags(text: string): string {
  return text.replace(/\[(energetic|fast|slow|surprised|thoughtful|happy|sad|exclaims|announcer|serious|calm|excited|warm|dramatic|whisper|loud|gentle|playful|confident|nervous|angry|romantic|mysterious|urgent|casual|formal|ironic|sarcastic)\]/gi, "").replace(/\s{2,}/g, " ").trim();
}

function isMultiSpeakerScript(scriptText: string): boolean {
  const speakerPattern = /^\[([^\]]+)\]:/m;
  const matches = scriptText.match(new RegExp(speakerPattern.source, "gm"));
  return !!matches && matches.length >= 2;
}

async function generateSilence(durationMs: number, outputPath: string): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const durationSec = durationMs / 1000;
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`,
    "-t", String(durationSec),
    "-c:a", "libmp3lame", "-b:a", "192k",
    outputPath,
  ], { timeout: 10000 });
}

async function concatMp3WithFfmpeg(
  segmentFiles: string[],
  outputFile: string,
  tmpDir: string,
  timestamp: number,
  speakerPerSegment?: string[],
): Promise<void> {
  if (segmentFiles.length === 0) return;
  if (segmentFiles.length === 1) {
    await fs.copyFile(segmentFiles[0], outputFile);
    return;
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const silenceFiles: string[] = [];
  const CROSSFADE_SEC = 0.08;

  const allFiles: string[] = [];
  const allSpeakers: string[] = [];

  for (let i = 0; i < segmentFiles.length; i++) {
    allFiles.push(segmentFiles[i]);
    allSpeakers.push(speakerPerSegment?.[i] || "");

    if (i < segmentFiles.length - 1) {
      const sameSpeaker = speakerPerSegment &&
        speakerPerSegment[i] && speakerPerSegment[i + 1] &&
        speakerPerSegment[i].toLowerCase() === speakerPerSegment[i + 1].toLowerCase();
      const gapMs = sameSpeaker ? 200 : 450;
      const silFile = path.join(tmpDir, `_silence_${timestamp}_${i}.mp3`);
      try {
        await generateSilence(gapMs, silFile);
        allFiles.push(silFile);
        allSpeakers.push("__silence__");
        silenceFiles.push(silFile);
      } catch (err: any) {
        console.warn(`Failed to generate silence gap ${i}:`, err.message);
      }
    }
  }

  try {
    const inputArgs: string[] = [];
    for (const f of allFiles) {
      inputArgs.push("-i", f);
    }

    const filterParts: string[] = [];
    let prevLabel = "[0]";
    for (let i = 1; i < allFiles.length; i++) {
      const outLabel = i < allFiles.length - 1 ? `[a${i}]` : "";
      filterParts.push(`${prevLabel}[${i}]acrossfade=d=${CROSSFADE_SEC}:c1=tri:c2=tri${outLabel}`);
      prevLabel = `[a${i}]`;
    }

    const filterComplex = filterParts.join(";");

    await execFileAsync("ffmpeg", [
      "-y",
      ...inputArgs,
      "-filter_complex", filterComplex,
      "-c:a", "libmp3lame",
      "-b:a", "192k",
      "-write_xing", "1",
      outputFile,
    ], { timeout: 120000 });
    console.log(`ffmpeg acrossfade: ${segmentFiles.length} segments -> ${path.basename(outputFile)}`);
  } catch (err: any) {
    console.warn("ffmpeg acrossfade failed, falling back to simple concat:", err.message);
    const listFile = path.join(tmpDir, `_concat_${timestamp}.txt`);
    const listContent = allFiles.map(f => `file '${f}'`).join("\n");
    await fs.writeFile(listFile, listContent);
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-write_xing", "1",
        outputFile,
      ], { timeout: 120000 });
    } catch (err2: any) {
      console.warn("ffmpeg simple concat also failed, Buffer.concat:", err2.message);
      const buffers: Buffer[] = [];
      for (const f of segmentFiles) {
        buffers.push(await fs.readFile(f));
      }
      await fs.writeFile(outputFile, Buffer.concat(buffers));
    } finally {
      await fs.unlink(listFile).catch(() => {});
    }
  } finally {
    for (const sf of silenceFiles) {
      await fs.unlink(sf).catch(() => {});
    }
  }
}

const remuxedCache = new Set<string>();

async function ensureRemuxed(filePath: string): Promise<string> {
  if (remuxedCache.has(filePath)) return filePath;

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ".mp3");
    const tmpFile = path.join(dir, `_remux_${base}_${Date.now()}.mp3`);
    await execFileAsync("ffmpeg", ["-y", "-i", filePath, "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", tmpFile], { timeout: 60000 });
    await fs.rename(tmpFile, filePath);
    remuxedCache.add(filePath);
    console.log(`Remuxed: ${path.basename(filePath)}`);
  } catch (err: any) {
    console.warn(`Remux failed for ${path.basename(filePath)}: ${err.message}`);
  }

  return filePath;
}

interface WeatherData {
  temperature: number;
  windspeed: number;
  winddirection: number;
  weathercode: number;
  time: string;
  daily?: {
    time: string[];
    temperature_max: number[];
    temperature_min: number[];
    precipitation_sum: number[];
    weathercode: number[];
    sunrise: string[];
    sunset: string[];
  };
}

const DEFAULT_COORDS = { lat: 36.5444, lon: 31.9997 };

async function fetchWeather(lat?: number, lon?: number): Promise<WeatherData | null> {
  try {
    const useLat = lat ?? DEFAULT_COORDS.lat;
    const useLon = lon ?? DEFAULT_COORDS.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,sunrise,sunset&timezone=auto&forecast_days=7`;
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
        time: data.daily.time,
        temperature_max: data.daily.temperature_2m_max,
        temperature_min: data.daily.temperature_2m_min,
        precipitation_sum: data.daily.precipitation_sum,
        weathercode: data.daily.weathercode,
        sunrise: data.daily.sunrise,
        sunset: data.daily.sunset,
      } : undefined,
    };
  } catch (error) {
    console.error("Error fetching weather:", error);
    return null;
  }
}

const WEATHER_DESCRIPTIONS_RU: Record<number, string> = {
  0: "ясно", 1: "преимущественно ясно", 2: "переменная облачность", 3: "пасмурно",
  45: "туман", 48: "изморозь",
  51: "легкая морось", 53: "морось", 55: "сильная морось",
  61: "небольшой дождь", 63: "дождь", 65: "сильный дождь",
  71: "небольшой снег", 73: "снег", 75: "сильный снег",
  80: "ливень", 81: "умеренный ливень", 82: "сильный ливень",
  95: "гроза", 96: "гроза с градом", 99: "сильная гроза с градом",
};

const WEATHER_DESCRIPTIONS_EN: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog",
  51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
  61: "slight rain", 63: "moderate rain", 65: "heavy rain",
  71: "slight snow", 73: "moderate snow", 75: "heavy snow",
  80: "rain showers", 81: "moderate rain showers", 82: "violent rain showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

const WEATHER_DESCRIPTIONS_UK: Record<number, string> = {
  0: "ясно", 1: "переважно ясно", 2: "мінлива хмарність", 3: "хмарно",
  45: "туман", 48: "паморозь",
  51: "легка мряка", 53: "мряка", 55: "сильна мряка",
  61: "невеликий дощ", 63: "дощ", 65: "сильний дощ",
  71: "невеликий сніг", 73: "сніг", 75: "сильний сніг",
  80: "злива", 81: "помірна злива", 82: "сильна злива",
  95: "гроза", 96: "гроза з градом", 99: "сильна гроза з градом",
};

const WEATHER_DESCRIPTIONS_ES: Record<number, string> = {
  0: "despejado", 1: "mayormente despejado", 2: "parcialmente nublado", 3: "nublado",
  45: "niebla", 48: "niebla con escarcha",
  51: "llovizna ligera", 53: "llovizna moderada", 55: "llovizna densa",
  61: "lluvia ligera", 63: "lluvia moderada", 65: "lluvia intensa",
  71: "nieve ligera", 73: "nieve moderada", 75: "nieve intensa",
  80: "chubascos", 81: "chubascos moderados", 82: "chubascos intensos",
  95: "tormenta", 96: "tormenta con granizo", 99: "tormenta severa con granizo",
};

const WEATHER_DESCRIPTIONS_DE: Record<number, string> = {
  0: "klarer Himmel", 1: "überwiegend klar", 2: "teilweise bewölkt", 3: "bedeckt",
  45: "Nebel", 48: "Reifnebel",
  51: "leichter Nieselregen", 53: "mäßiger Nieselregen", 55: "starker Nieselregen",
  61: "leichter Regen", 63: "mäßiger Regen", 65: "starker Regen",
  71: "leichter Schneefall", 73: "mäßiger Schneefall", 75: "starker Schneefall",
  80: "Regenschauer", 81: "mäßige Regenschauer", 82: "heftige Regenschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "schweres Gewitter mit Hagel",
};

const WEATHER_DESCRIPTIONS_FR: Record<number, string> = {
  0: "ciel dégagé", 1: "principalement dégagé", 2: "partiellement nuageux", 3: "couvert",
  45: "brouillard", 48: "brouillard givrant",
  51: "bruine légère", 53: "bruine modérée", 55: "bruine dense",
  61: "pluie faible", 63: "pluie modérée", 65: "forte pluie",
  71: "neige faible", 73: "neige modérée", 75: "neige forte",
  80: "averses", 81: "averses modérées", 82: "averses violentes",
  95: "orage", 96: "orage avec grêle", 99: "fort orage avec grêle",
};

const WEATHER_DESCRIPTIONS_PT: Record<number, string> = {
  0: "céu limpo", 1: "predominantemente limpo", 2: "parcialmente nublado", 3: "nublado",
  45: "neblina", 48: "geada",
  51: "garoa leve", 53: "garoa moderada", 55: "garoa intensa",
  61: "chuva leve", 63: "chuva moderada", 65: "chuva forte",
  71: "neve leve", 73: "neve moderada", 75: "neve intensa",
  80: "pancadas de chuva", 81: "pancadas moderadas", 82: "pancadas intensas",
  95: "trovoada", 96: "trovoada com granizo", 99: "trovoada severa com granizo",
};

const WEATHER_DESCRIPTIONS_IT: Record<number, string> = {
  0: "sereno", 1: "prevalentemente sereno", 2: "parzialmente nuvoloso", 3: "coperto",
  45: "nebbia", 48: "nebbia ghiacciata",
  51: "pioviggine leggera", 53: "pioviggine moderata", 55: "pioviggine intensa",
  61: "pioggia debole", 63: "pioggia moderata", 65: "pioggia forte",
  71: "neve leggera", 73: "neve moderata", 75: "neve intensa",
  80: "rovesci", 81: "rovesci moderati", 82: "rovesci violenti",
  95: "temporale", 96: "temporale con grandine", 99: "forte temporale con grandine",
};

const WEATHER_DESCRIPTIONS_TR: Record<number, string> = {
  0: "açık", 1: "çoğunlukla açık", 2: "parçalı bulutlu", 3: "kapalı",
  45: "sis", 48: "kırağı sisi",
  51: "hafif çisenti", 53: "orta çisenti", 55: "yoğun çisenti",
  61: "hafif yağmur", 63: "orta yağmur", 65: "şiddetli yağmur",
  71: "hafif kar", 73: "orta kar", 75: "şiddetli kar",
  80: "sağanak", 81: "orta sağanak", 82: "şiddetli sağanak",
  95: "gök gürültülü fırtına", 96: "dolu ile fırtına", 99: "dolu ile şiddetli fırtına",
};

const WEATHER_DESCRIPTIONS_PL: Record<number, string> = {
  0: "bezchmurnie", 1: "przeważnie bezchmurnie", 2: "częściowe zachmurzenie", 3: "pochmurno",
  45: "mgła", 48: "szadź",
  51: "lekka mżawka", 53: "mżawka", 55: "silna mżawka",
  61: "lekki deszcz", 63: "deszcz", 65: "ulewny deszcz",
  71: "lekki śnieg", 73: "śnieg", 75: "intensywny śnieg",
  80: "przelotne opady", 81: "umiarkowane opady", 82: "gwałtowne opady",
  95: "burza", 96: "burza z gradem", 99: "silna burza z gradem",
};

const WEATHER_DESCRIPTIONS_NL: Record<number, string> = {
  0: "helder", 1: "overwegend helder", 2: "gedeeltelijk bewolkt", 3: "bewolkt",
  45: "mist", 48: "ijzelmist",
  51: "lichte motregen", 53: "matige motregen", 55: "dichte motregen",
  61: "lichte regen", 63: "matige regen", 65: "zware regen",
  71: "lichte sneeuw", 73: "matige sneeuw", 75: "zware sneeuw",
  80: "buien", 81: "matige buien", 82: "zware buien",
  95: "onweer", 96: "onweer met hagel", 99: "zwaar onweer met hagel",
};

const WEATHER_DESCRIPTIONS_AR: Record<number, string> = {
  0: "صافٍ", 1: "صافٍ في الغالب", 2: "غائم جزئيًا", 3: "ملبد بالغيوم",
  45: "ضباب", 48: "ضباب متجمد",
  51: "رذاذ خفيف", 53: "رذاذ معتدل", 55: "رذاذ كثيف",
  61: "مطر خفيف", 63: "مطر معتدل", 65: "مطر غزير",
  71: "ثلج خفيف", 73: "ثلج معتدل", 75: "ثلج كثيف",
  80: "زخات مطر", 81: "زخات معتدلة", 82: "زخات غزيرة",
  95: "عاصفة رعدية", 96: "عاصفة رعدية مع برَد", 99: "عاصفة رعدية شديدة مع برَد",
};

const WEATHER_DESCRIPTIONS_ZH: Record<number, string> = {
  0: "晴", 1: "大部晴", 2: "局部多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪",
  80: "阵雨", 81: "中等阵雨", 82: "强阵雨",
  95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹",
};

const WEATHER_DESCRIPTIONS_JA: Record<number, string> = {
  0: "快晴", 1: "おおむね晴れ", 2: "晴れ時々曇り", 3: "曇り",
  45: "霧", 48: "霧氷",
  51: "弱い霧雨", 53: "霧雨", 55: "強い霧雨",
  61: "弱い雨", 63: "雨", 65: "強い雨",
  71: "弱い雪", 73: "雪", 75: "強い雪",
  80: "にわか雨", 81: "中程度のにわか雨", 82: "激しいにわか雨",
  95: "雷雨", 96: "雷雨と雹", 99: "激しい雷雨と雹",
};

const WEATHER_DESCRIPTIONS_KO: Record<number, string> = {
  0: "맑음", 1: "대체로 맑음", 2: "부분적으로 흐림", 3: "흐림",
  45: "안개", 48: "착빙 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
  61: "약한 비", 63: "비", 65: "강한 비",
  71: "약한 눈", 73: "눈", 75: "강한 눈",
  80: "소나기", 81: "중간 소나기", 82: "강한 소나기",
  95: "뇌우", 96: "우박을 동반한 뇌우", 99: "강한 우박 뇌우",
};

const WEATHER_DESCRIPTIONS_HI: Record<number, string> = {
  0: "साफ़ आसमान", 1: "मुख्यतः साफ़", 2: "आंशिक रूप से बादल", 3: "बादल छाए",
  45: "कोहरा", 48: "तुषार कोहरा",
  51: "हल्की बूँदाबाँदी", 53: "मध्यम बूँदाबाँदी", 55: "घनी बूँदाबाँदी",
  61: "हल्की बारिश", 63: "मध्यम बारिश", 65: "भारी बारिश",
  71: "हल्की बर्फ़बारी", 73: "मध्यम बर्फ़बारी", 75: "भारी बर्फ़बारी",
  80: "वर्षा", 81: "मध्यम वर्षा", 82: "तीव्र वर्षा",
  95: "आँधी-तूफ़ान", 96: "ओले के साथ तूफ़ान", 99: "ओले के साथ भीषण तूफ़ान",
};

const WEATHER_DESCRIPTIONS_ID: Record<number, string> = {
  0: "cerah", 1: "umumnya cerah", 2: "berawan sebagian", 3: "mendung",
  45: "berkabut", 48: "kabut beku",
  51: "gerimis ringan", 53: "gerimis sedang", 55: "gerimis lebat",
  61: "hujan ringan", 63: "hujan sedang", 65: "hujan lebat",
  71: "salju ringan", 73: "salju sedang", 75: "salju lebat",
  80: "hujan deras", 81: "hujan deras sedang", 82: "hujan deras hebat",
  95: "badai petir", 96: "badai petir dengan hujan es", 99: "badai petir hebat dengan hujan es",
};

const WEATHER_DESCRIPTIONS_VI: Record<number, string> = {
  0: "trời quang", 1: "chủ yếu quang đãng", 2: "có mây rải rác", 3: "nhiều mây",
  45: "sương mù", 48: "sương giá",
  51: "mưa phùn nhẹ", 53: "mưa phùn", 55: "mưa phùn nặng hạt",
  61: "mưa nhẹ", 63: "mưa", 65: "mưa to",
  71: "tuyết nhẹ", 73: "tuyết", 75: "tuyết dày",
  80: "mưa rào", 81: "mưa rào vừa", 82: "mưa rào dữ dội",
  95: "giông", 96: "giông kèm mưa đá", 99: "giông mạnh kèm mưa đá",
};

const WEATHER_DESCRIPTIONS_FA: Record<number, string> = {
  0: "آسمان صاف", 1: "بیشتر صاف", 2: "نیمه‌ابری", 3: "ابری",
  45: "مه", 48: "مه یخ‌زده",
  51: "نم‌نم سبک", 53: "نم‌نم متوسط", 55: "نم‌نم شدید",
  61: "باران سبک", 63: "باران متوسط", 65: "باران شدید",
  71: "برف سبک", 73: "برف متوسط", 75: "برف شدید",
  80: "رگبار", 81: "رگبار متوسط", 82: "رگبار شدید",
  95: "رعد و برق", 96: "رعد و برق با تگرگ", 99: "رعد و برق شدید با تگرگ",
};

const WEATHER_DESCRIPTIONS_HE: Record<number, string> = {
  0: "שמיים בהירים", 1: "בהיר בעיקר", 2: "מעונן חלקית", 3: "מעונן",
  45: "ערפל", 48: "כפור",
  51: "טפטוף קל", 53: "טפטוף בינוני", 55: "טפטוף כבד",
  61: "גשם קל", 63: "גשם בינוני", 65: "גשם כבד",
  71: "שלג קל", 73: "שלג בינוני", 75: "שלג כבד",
  80: "ממטרים", 81: "ממטרים בינוניים", 82: "ממטרים עזים",
  95: "סופת רעמים", 96: "סופת רעמים עם ברד", 99: "סופת רעמים חזקה עם ברד",
};

const WEATHER_DESCRIPTIONS_KK: Record<number, string> = {
  0: "ашық", 1: "негізінен ашық", 2: "ауыспалы бұлтты", 3: "бұлтты",
  45: "тұман", 48: "қырау",
  51: "жеңіл сіркіреме", 53: "сіркіреме", 55: "қою сіркіреме",
  61: "болмашы жаңбыр", 63: "жаңбыр", 65: "қатты жаңбыр",
  71: "жеңіл қар", 73: "қар", 75: "қатты қар",
  80: "нөсер", 81: "орташа нөсер", 82: "қатты нөсер",
  95: "найзағай", 96: "бұршақты найзағай", 99: "қатты бұршақты найзағай",
};

const WEATHER_DESCRIPTIONS_AZ: Record<number, string> = {
  0: "aydın", 1: "əsasən aydın", 2: "qismən buludlu", 3: "tutqun",
  45: "duman", 48: "qırov dumanı",
  51: "yüngül çiskin", 53: "orta çiskin", 55: "güclü çiskin",
  61: "yüngül yağış", 63: "orta yağış", 65: "güclü yağış",
  71: "yüngül qar", 73: "orta qar", 75: "güclü qar",
  80: "leysan", 81: "orta leysan", 82: "güclü leysan",
  95: "tufan", 96: "doluyla tufan", 99: "doluyla güclü tufan",
};

const WEATHER_DESCRIPTIONS_BG: Record<number, string> = {
  0: "ясно", 1: "предимно ясно", 2: "променлива облачност", 3: "облачно",
  45: "мъгла", 48: "слана с мъгла",
  51: "лек ръмеж", 53: "умерен ръмеж", 55: "силен ръмеж",
  61: "слаб дъжд", 63: "умерен дъжд", 65: "силен дъжд",
  71: "слаб сняг", 73: "умерен сняг", 75: "силен сняг",
  80: "превалявания", 81: "умерени превалявания", 82: "силни превалявания",
  95: "гръмотевична буря", 96: "буря с градушка", 99: "силна буря с градушка",
};

const WEATHER_DESCRIPTIONS_BN: Record<number, string> = {
  0: "পরিষ্কার আকাশ", 1: "মূলত পরিষ্কার", 2: "আংশিক মেঘলা", 3: "মেঘাচ্ছন্ন",
  45: "কুয়াশা", 48: "তুষার কুয়াশা",
  51: "হালকা গুঁড়ি বৃষ্টি", 53: "মাঝারি গুঁড়ি বৃষ্টি", 55: "ঘন গুঁড়ি বৃষ্টি",
  61: "হালকা বৃষ্টি", 63: "মাঝারি বৃষ্টি", 65: "ভারী বৃষ্টি",
  71: "হালকা তুষারপাত", 73: "মাঝারি তুষারপাত", 75: "ভারী তুষারপাত",
  80: "বর্ষণ", 81: "মাঝারি বর্ষণ", 82: "প্রবল বর্ষণ",
  95: "বজ্রঝড়", 96: "শিলাবৃষ্টিসহ বজ্রঝড়", 99: "শিলাবৃষ্টিসহ প্রবল বজ্রঝড়",
};

const WEATHER_DESCRIPTIONS_BS: Record<number, string> = {
  0: "vedro", 1: "uglavnom vedro", 2: "djelimično oblačno", 3: "oblačno",
  45: "magla", 48: "ledena magla",
  51: "slaba sitna kiša", 53: "umjerena sitna kiša", 55: "jaka sitna kiša",
  61: "slaba kiša", 63: "umjerena kiša", 65: "jaka kiša",
  71: "slab snijeg", 73: "umjeren snijeg", 75: "jak snijeg",
  80: "pljuskovi", 81: "umjereni pljuskovi", 82: "jaki pljuskovi",
  95: "grmljavina", 96: "grmljavina s gradom", 99: "jaka grmljavina s gradom",
};

const WEATHER_DESCRIPTIONS_CS: Record<number, string> = {
  0: "jasno", 1: "převážně jasno", 2: "polojasno", 3: "zataženo",
  45: "mlha", 48: "námrazová mlha",
  51: "slabé mrholení", 53: "mrholení", 55: "silné mrholení",
  61: "slabý déšť", 63: "déšť", 65: "silný déšť",
  71: "slabé sněžení", 73: "sněžení", 75: "silné sněžení",
  80: "přeháňky", 81: "mírné přeháňky", 82: "silné přeháňky",
  95: "bouřka", 96: "bouřka s kroupami", 99: "silná bouřka s kroupami",
};

const WEATHER_DESCRIPTIONS_DA: Record<number, string> = {
  0: "klart vejr", 1: "overvejende klart", 2: "delvist skyet", 3: "overskyet",
  45: "tåge", 48: "rimtåge",
  51: "let støvregn", 53: "støvregn", 55: "kraftig støvregn",
  61: "let regn", 63: "regn", 65: "kraftig regn",
  71: "let sne", 73: "sne", 75: "kraftig sne",
  80: "byger", 81: "moderate byger", 82: "kraftige byger",
  95: "tordenvejr", 96: "tordenvejr med hagl", 99: "kraftigt tordenvejr med hagl",
};

const WEATHER_DESCRIPTIONS_EL: Record<number, string> = {
  0: "αίθριος", 1: "κυρίως αίθριος", 2: "μερικώς συννεφιασμένος", 3: "συννεφιασμένος",
  45: "ομίχλη", 48: "παγωμένη ομίχλη",
  51: "ελαφρύ ψιχάλισμα", 53: "ψιχάλισμα", 55: "πυκνό ψιχάλισμα",
  61: "ασθενής βροχή", 63: "βροχή", 65: "ισχυρή βροχή",
  71: "ασθενής χιονόπτωση", 73: "χιονόπτωση", 75: "ισχυρή χιονόπτωση",
  80: "μπόρες", 81: "μέτριες μπόρες", 82: "ισχυρές μπόρες",
  95: "καταιγίδα", 96: "καταιγίδα με χαλάζι", 99: "ισχυρή καταιγίδα με χαλάζι",
};

const WEATHER_DESCRIPTIONS_ET: Record<number, string> = {
  0: "selge", 1: "valdavalt selge", 2: "vahelduva pilvisusega", 3: "pilves",
  45: "udu", 48: "härmaudu",
  51: "kerge uduvihm", 53: "uduvihm", 55: "tihe uduvihm",
  61: "nõrk vihm", 63: "vihm", 65: "tugev vihm",
  71: "nõrk lumesadu", 73: "lumesadu", 75: "tugev lumesadu",
  80: "hoovihm", 81: "mõõdukas hoovihm", 82: "tugev hoovihm",
  95: "äike", 96: "äike rahega", 99: "tugev äike rahega",
};

const WEATHER_DESCRIPTIONS_FI: Record<number, string> = {
  0: "selkeää", 1: "enimmäkseen selkeää", 2: "puolipilvistä", 3: "pilvistä",
  45: "sumua", 48: "huurresumua",
  51: "kevyttä tihkusadetta", 53: "tihkusadetta", 55: "voimakasta tihkusadetta",
  61: "heikkoa sadetta", 63: "sadetta", 65: "voimakasta sadetta",
  71: "heikkoa lumisadetta", 73: "lumisadetta", 75: "voimakasta lumisadetta",
  80: "sadekuuroja", 81: "kohtalaisia sadekuuroja", 82: "rajuja sadekuuroja",
  95: "ukkosta", 96: "ukkosta ja rakeita", 99: "voimakasta ukkosta ja rakeita",
};

const WEATHER_DESCRIPTIONS_HR: Record<number, string> = {
  0: "vedro", 1: "pretežno vedro", 2: "djelomično oblačno", 3: "oblačno",
  45: "magla", 48: "ledena magla",
  51: "slaba rosulja", 53: "umjerena rosulja", 55: "jaka rosulja",
  61: "slaba kiša", 63: "umjerena kiša", 65: "jaka kiša",
  71: "slab snijeg", 73: "umjeren snijeg", 75: "jak snijeg",
  80: "pljuskovi", 81: "umjereni pljuskovi", 82: "jaki pljuskovi",
  95: "grmljavinsko nevrijeme", 96: "grmljavina s tučom", 99: "jaka grmljavina s tučom",
};

const WEATHER_DESCRIPTIONS_HU: Record<number, string> = {
  0: "derült", 1: "túlnyomóan derült", 2: "részben felhős", 3: "borult",
  45: "köd", 48: "zúzmarás köd",
  51: "gyenge szitálás", 53: "szitálás", 55: "erős szitálás",
  61: "gyenge eső", 63: "eső", 65: "erős eső",
  71: "gyenge havazás", 73: "havazás", 75: "erős havazás",
  80: "záporok", 81: "mérsékelt záporok", 82: "heves záporok",
  95: "zivatar", 96: "zivatar jégesővel", 99: "erős zivatar jégesővel",
};

const WEATHER_DESCRIPTIONS_HY: Record<number, string> = {
  0: "պարզ", 1: "հիմնականում պարզ", 2: "մասամբ ամպամած", 3: "ամպամած",
  45: "մառախուղ", 48: "սառցե մառախուղ",
  51: "թեթև մաղում", 53: "մաղում", 55: "խիտ մաղում",
  61: "թեթև անձրև", 63: "անձրև", 65: "տեղատարափ անձրև",
  71: "թեթև ձյուն", 73: "ձյուն", 75: "տեղատարափ ձյուն",
  80: "տեղատարափ", 81: "չափավոր տեղատարափ", 82: "ուժեղ տեղատարափ",
  95: "ամպրոպ", 96: "ամպրոպ կարկտով", 99: "ուժեղ ամպրոպ կարկտով",
};

const WEATHER_DESCRIPTIONS_KA: Record<number, string> = {
  0: "მზიანი", 1: "უმეტესად მზიანი", 2: "ნაწილობრივ მოღრუბლული", 3: "მოღრუბლული",
  45: "ნისლი", 48: "ყინულოვანი ნისლი",
  51: "მსუბუქი წვიმწვიმა", 53: "წვიმწვიმა", 55: "ძლიერი წვიმწვიმა",
  61: "სუსტი წვიმა", 63: "წვიმა", 65: "ძლიერი წვიმა",
  71: "სუსტი თოვლი", 73: "თოვლი", 75: "ძლიერი თოვლი",
  80: "კოკისპირული წვიმა", 81: "ზომიერი კოკისპირული", 82: "ძლიერი კოკისპირული",
  95: "ჭექა-ქუხილი", 96: "ჭექა-ქუხილი სეტყვით", 99: "ძლიერი ჭექა-ქუხილი სეტყვით",
};

const WEATHER_DESCRIPTIONS_KY: Record<number, string> = {
  0: "ачык", 1: "негизинен ачык", 2: "айрым булуттуу", 3: "булуттуу",
  45: "туман", 48: "кыроолуу туман",
  51: "жеңил себелек", 53: "себелек", 55: "күчтүү себелек",
  61: "анча-мынча жамгыр", 63: "жамгыр", 65: "катуу жамгыр",
  71: "анча-мынча кар", 73: "кар", 75: "катуу кар",
  80: "нөшөр", 81: "орточо нөшөр", 82: "катуу нөшөр",
  95: "чагылган", 96: "мөндүрлүү чагылган", 99: "катуу мөндүрлүү чагылган",
};

const WEATHER_DESCRIPTIONS_LT: Record<number, string> = {
  0: "giedra", 1: "daugiausia giedra", 2: "mažai debesuota", 3: "debesuota",
  45: "rūkas", 48: "šerkšno rūkas",
  51: "silpnas dulksnotas lietus", 53: "dulksnotas lietus", 55: "smarkus dulksnotas lietus",
  61: "silpnas lietus", 63: "lietus", 65: "smarkus lietus",
  71: "silpnas sniegas", 73: "sniegas", 75: "smarkus sniegas",
  80: "liūtys", 81: "vidutinės liūtys", 82: "smarkios liūtys",
  95: "perkūnija", 96: "perkūnija su kruša", 99: "stipri perkūnija su kruša",
};

const WEATHER_DESCRIPTIONS_LV: Record<number, string> = {
  0: "skaidrs", 1: "pārsvarā skaidrs", 2: "daļēji mākoņains", 3: "apmācies",
  45: "migla", 48: "sarmas migla",
  51: "viegls smidzinošs lietus", 53: "smidzinošs lietus", 55: "stiprs smidzinošs lietus",
  61: "viegls lietus", 63: "lietus", 65: "stiprs lietus",
  71: "viegls sniegs", 73: "sniegs", 75: "stiprs sniegs",
  80: "lietusgāzes", 81: "mērenas lietusgāzes", 82: "stipras lietusgāzes",
  95: "pērkona negaiss", 96: "negaiss ar krusu", 99: "stiprs negaiss ar krusu",
};

const WEATHER_DESCRIPTIONS_MK: Record<number, string> = {
  0: "ведро", 1: "претежно ведро", 2: "делумно облачно", 3: "облачно",
  45: "магла", 48: "ледена магла",
  51: "слаб ситен дожд", 53: "ситен дожд", 55: "силен ситен дожд",
  61: "слаб дожд", 63: "дожд", 65: "силен дожд",
  71: "слаб снег", 73: "снег", 75: "силен снег",
  80: "пороен дожд", 81: "умерен пороен дожд", 82: "силен пороен дожд",
  95: "грмежи", 96: "грмежи со град", 99: "силни грмежи со град",
};

const WEATHER_DESCRIPTIONS_MN: Record<number, string> = {
  0: "цэлмэг", 1: "ихэвчлэн цэлмэг", 2: "багавтар үүлшинэ", 3: "бүрхэг",
  45: "манан", 48: "хяруутай манан",
  51: "сул шиврээ", 53: "дунд зэргийн шиврээ", 55: "хүчтэй шиврээ",
  61: "бага зэргийн бороо", 63: "бороо", 65: "их бороо",
  71: "бага зэргийн цас", 73: "цас", 75: "их цас",
  80: "аадар бороо", 81: "дунд зэргийн аадар", 82: "хүчтэй аадар",
  95: "аянга цахилгаан", 96: "мөндөртэй аянга", 99: "хүчтэй мөндөртэй аянга",
};

const WEATHER_DESCRIPTIONS_MS: Record<number, string> = {
  0: "cerah", 1: "kebanyakannya cerah", 2: "berawan sebahagian", 3: "mendung",
  45: "berkabus", 48: "kabus beku",
  51: "hujan renyai-renyai ringan", 53: "hujan renyai-renyai sederhana", 55: "hujan renyai-renyai lebat",
  61: "hujan ringan", 63: "hujan sederhana", 65: "hujan lebat",
  71: "salji ringan", 73: "salji sederhana", 75: "salji lebat",
  80: "hujan renyai", 81: "hujan renyai sederhana", 82: "hujan renyai lebat",
  95: "ribut petir", 96: "ribut petir dengan hujan batu", 99: "ribut petir kuat dengan hujan batu",
};

const WEATHER_DESCRIPTIONS_NO: Record<number, string> = {
  0: "klart vær", 1: "for det meste klart", 2: "delvis skyet", 3: "overskyet",
  45: "tåke", 48: "rimtåke",
  51: "lett yr", 53: "yr", 55: "tett yr",
  61: "lett regn", 63: "regn", 65: "kraftig regn",
  71: "lett snø", 73: "snø", 75: "kraftig snø",
  80: "regnbyger", 81: "moderate regnbyger", 82: "kraftige regnbyger",
  95: "tordenvær", 96: "tordenvær med hagl", 99: "kraftig tordenvær med hagl",
};

const WEATHER_DESCRIPTIONS_RO: Record<number, string> = {
  0: "senin", 1: "predominant senin", 2: "parțial înnorat", 3: "înnorat",
  45: "ceață", 48: "ceață cu chiciură",
  51: "burniță ușoară", 53: "burniță moderată", 55: "burniță densă",
  61: "ploaie ușoară", 63: "ploaie moderată", 65: "ploaie puternică",
  71: "ninsoare ușoară", 73: "ninsoare moderată", 75: "ninsoare puternică",
  80: "averse de ploaie", 81: "averse moderate", 82: "averse puternice",
  95: "furtună", 96: "furtună cu grindină", 99: "furtună puternică cu grindină",
};

const WEATHER_DESCRIPTIONS_SK: Record<number, string> = {
  0: "jasno", 1: "prevažne jasno", 2: "polojasno", 3: "zamračené",
  45: "hmla", 48: "námrazová hmla",
  51: "slabé mrholenie", 53: "mrholenie", 55: "silné mrholenie",
  61: "slabý dážď", 63: "dážď", 65: "silný dážď",
  71: "slabé sneženie", 73: "sneženie", 75: "silné sneženie",
  80: "prehánky", 81: "mierne prehánky", 82: "silné prehánky",
  95: "búrka", 96: "búrka s krupobitím", 99: "silná búrka s krupobitím",
};

const WEATHER_DESCRIPTIONS_SL: Record<number, string> = {
  0: "jasno", 1: "pretežno jasno", 2: "delno oblačno", 3: "oblačno",
  45: "megla", 48: "ivnata megla",
  51: "rahlo pršenje", 53: "pršenje", 55: "močno pršenje",
  61: "šibek dež", 63: "dež", 65: "močan dež",
  71: "šibko sneženje", 73: "sneženje", 75: "močno sneženje",
  80: "plohe", 81: "zmerne plohe", 82: "močne plohe",
  95: "nevihta", 96: "nevihta s točo", 99: "močna nevihta s točo",
};

const WEATHER_DESCRIPTIONS_SQ: Record<number, string> = {
  0: "kthjellët", 1: "kryesisht kthjellët", 2: "pjesërisht me re", 3: "i vranët",
  45: "mjegull", 48: "mjegull me brymë",
  51: "shi i lehtë i imët", 53: "shi i imët", 55: "shi i imët i dendur",
  61: "shi i lehtë", 63: "shi i moderuar", 65: "shi i dendur",
  71: "borë e lehtë", 73: "borë", 75: "borë e dendur",
  80: "rrebeshe shiu", 81: "rrebeshe të moderuara", 82: "rrebeshe të forta",
  95: "stuhi me bubullima", 96: "stuhi me breshër", 99: "stuhi e fortë me breshër",
};

const WEATHER_DESCRIPTIONS_SR: Record<number, string> = {
  0: "ведро", 1: "претежно ведро", 2: "делимично облачно", 3: "облачно",
  45: "магла", 48: "ледена магла",
  51: "слаба ромињава киша", 53: "ромињава киша", 55: "јака ромињава киша",
  61: "слаба киша", 63: "киша", 65: "јака киша",
  71: "слаб снег", 73: "снег", 75: "јак снег",
  80: "пљускови", 81: "умерени пљускови", 82: "јаки пљускови",
  95: "грмљавина", 96: "грмљавина са градом", 99: "јака грмљавина са градом",
};

const WEATHER_DESCRIPTIONS_SV: Record<number, string> = {
  0: "klart väder", 1: "mestadels klart", 2: "delvis molnigt", 3: "mulet",
  45: "dimma", 48: "rimfrostsdimma",
  51: "lätt duggregn", 53: "duggregn", 55: "tätt duggregn",
  61: "lätt regn", 63: "regn", 65: "kraftigt regn",
  71: "lätt snöfall", 73: "snöfall", 75: "kraftigt snöfall",
  80: "regnskurar", 81: "måttliga regnskurar", 82: "kraftiga regnskurar",
  95: "åskväder", 96: "åskväder med hagel", 99: "kraftigt åskväder med hagel",
};

const WEATHER_DESCRIPTIONS_SW: Record<number, string> = {
  0: "anga safi", 1: "kwa kiasi kikubwa angavu", 2: "mawingu kiasi", 3: "mawingu",
  45: "ukungu", 48: "ukungu wa barafu",
  51: "manyunyu hafifu", 53: "manyunyu ya wastani", 55: "manyunyu mazito",
  61: "mvua hafifu", 63: "mvua ya wastani", 65: "mvua kubwa",
  71: "theluji hafifu", 73: "theluji ya wastani", 75: "theluji kubwa",
  80: "mvua za ghafla", 81: "mvua za ghafla za wastani", 82: "mvua za ghafla kali",
  95: "ngurumo za radi", 96: "ngurumo na mvua ya mawe", 99: "ngurumo kali na mvua ya mawe",
};

const WEATHER_DESCRIPTIONS_TA: Record<number, string> = {
  0: "தெளிவான வானம்", 1: "பெரும்பாலும் தெளிவாக", 2: "ஓரளவு மேகமூட்டம்", 3: "மேகமூட்டம்",
  45: "மூடுபனி", 48: "உறைபனி மூடுபனி",
  51: "லேசான தூறல்", 53: "மிதமான தூறல்", 55: "அடர்ந்த தூறல்",
  61: "லேசான மழை", 63: "மிதமான மழை", 65: "கனமழை",
  71: "லேசான பனிப்பொழிவு", 73: "மிதமான பனிப்பொழிவு", 75: "கடுமையான பனிப்பொழிவு",
  80: "மழைப்பொழிவு", 81: "மிதமான மழைப்பொழிவு", 82: "கடுமையான மழைப்பொழிவு",
  95: "இடிமின்னல் புயல்", 96: "ஆலங்கட்டியுடன் இடிமின்னல்", 99: "ஆலங்கட்டியுடன் கடுமையான இடிமின்னல்",
};

const WEATHER_DESCRIPTIONS_TG: Record<number, string> = {
  0: "соф", 1: "асосан соф", 2: "қисман абрнок", 3: "абрнок",
  45: "туман", 48: "тумани яхбаста",
  51: "боридани сабук", 53: "боридани миёна", 55: "боридани сахт",
  61: "борони сабук", 63: "борон", 65: "борони сахт",
  71: "барфи сабук", 73: "барф", 75: "барфи сахт",
  80: "сел", 81: "сели миёна", 82: "сели сахт",
  95: "раъду барқ", 96: "раъду барқ бо жола", 99: "раъду барқи сахт бо жола",
};

const WEATHER_DESCRIPTIONS_TH: Record<number, string> = {
  0: "ท้องฟ้าแจ่มใส", 1: "ส่วนใหญ่แจ่มใส", 2: "มีเมฆบางส่วน", 3: "มีเมฆมาก",
  45: "หมอก", 48: "หมอกน้ำแข็ง",
  51: "ฝนปรอยเล็กน้อย", 53: "ฝนปรอยปานกลาง", 55: "ฝนปรอยหนัก",
  61: "ฝนตกเล็กน้อย", 63: "ฝนตกปานกลาง", 65: "ฝนตกหนัก",
  71: "หิมะตกเล็กน้อย", 73: "หิมะตกปานกลาง", 75: "หิมะตกหนัก",
  80: "ฝนซู่", 81: "ฝนซู่ปานกลาง", 82: "ฝนซู่หนัก",
  95: "พายุฝนฟ้าคะนอง", 96: "พายุฝนฟ้าคะนองกับลูกเห็บ", 99: "พายุฝนฟ้าคะนองรุนแรงกับลูกเห็บ",
};

const WEATHER_DESCRIPTIONS_UZ: Record<number, string> = {
  0: "ochiq", 1: "asosan ochiq", 2: "qisman bulutli", 3: "bulutli",
  45: "tuman", 48: "qirovli tuman",
  51: "yengil shivalama", 53: "shivalama", 55: "kuchli shivalama",
  61: "yengil yomg'ir", 63: "yomg'ir", 65: "kuchli yomg'ir",
  71: "yengil qor", 73: "qor", 75: "kuchli qor",
  80: "jala", 81: "o'rtacha jala", 82: "kuchli jala",
  95: "momaqaldiroq", 96: "do'l bilan momaqaldiroq", 99: "do'l bilan kuchli momaqaldiroq",
};

const WEATHER_DESCRIPTIONS_BY_LANG: Record<string, Record<number, string>> = {
  ru: WEATHER_DESCRIPTIONS_RU,
  en: WEATHER_DESCRIPTIONS_EN,
  uk: WEATHER_DESCRIPTIONS_UK,
  es: WEATHER_DESCRIPTIONS_ES,
  de: WEATHER_DESCRIPTIONS_DE,
  fr: WEATHER_DESCRIPTIONS_FR,
  pt: WEATHER_DESCRIPTIONS_PT,
  it: WEATHER_DESCRIPTIONS_IT,
  tr: WEATHER_DESCRIPTIONS_TR,
  pl: WEATHER_DESCRIPTIONS_PL,
  nl: WEATHER_DESCRIPTIONS_NL,
  ar: WEATHER_DESCRIPTIONS_AR,
  zh: WEATHER_DESCRIPTIONS_ZH,
  ja: WEATHER_DESCRIPTIONS_JA,
  ko: WEATHER_DESCRIPTIONS_KO,
  hi: WEATHER_DESCRIPTIONS_HI,
  id: WEATHER_DESCRIPTIONS_ID,
  vi: WEATHER_DESCRIPTIONS_VI,
  fa: WEATHER_DESCRIPTIONS_FA,
  he: WEATHER_DESCRIPTIONS_HE,
  kk: WEATHER_DESCRIPTIONS_KK,
  az: WEATHER_DESCRIPTIONS_AZ,
  bg: WEATHER_DESCRIPTIONS_BG,
  bn: WEATHER_DESCRIPTIONS_BN,
  bs: WEATHER_DESCRIPTIONS_BS,
  cs: WEATHER_DESCRIPTIONS_CS,
  da: WEATHER_DESCRIPTIONS_DA,
  el: WEATHER_DESCRIPTIONS_EL,
  et: WEATHER_DESCRIPTIONS_ET,
  fi: WEATHER_DESCRIPTIONS_FI,
  hr: WEATHER_DESCRIPTIONS_HR,
  hu: WEATHER_DESCRIPTIONS_HU,
  hy: WEATHER_DESCRIPTIONS_HY,
  ka: WEATHER_DESCRIPTIONS_KA,
  ky: WEATHER_DESCRIPTIONS_KY,
  lt: WEATHER_DESCRIPTIONS_LT,
  lv: WEATHER_DESCRIPTIONS_LV,
  mk: WEATHER_DESCRIPTIONS_MK,
  mn: WEATHER_DESCRIPTIONS_MN,
  ms: WEATHER_DESCRIPTIONS_MS,
  no: WEATHER_DESCRIPTIONS_NO,
  ro: WEATHER_DESCRIPTIONS_RO,
  sk: WEATHER_DESCRIPTIONS_SK,
  sl: WEATHER_DESCRIPTIONS_SL,
  sq: WEATHER_DESCRIPTIONS_SQ,
  sr: WEATHER_DESCRIPTIONS_SR,
  sv: WEATHER_DESCRIPTIONS_SV,
  sw: WEATHER_DESCRIPTIONS_SW,
  ta: WEATHER_DESCRIPTIONS_TA,
  tg: WEATHER_DESCRIPTIONS_TG,
  th: WEATHER_DESCRIPTIONS_TH,
  uz: WEATHER_DESCRIPTIONS_UZ,
};

const WEATHER_UNKNOWN_BY_LANG: Record<string, string> = {
  ru: "неизвестно", en: "unknown", uk: "невідомо", es: "desconocido", de: "unbekannt",
  fr: "inconnu", pt: "desconhecido", it: "sconosciuto", tr: "bilinmiyor", pl: "nieznane",
  nl: "onbekend", ar: "غير معروف", zh: "未知", ja: "不明", ko: "알 수 없음",
  hi: "अज्ञात", id: "tidak diketahui", vi: "không xác định", fa: "نامشخص", he: "לא ידוע",
  kk: "белгісіз",
  az: "naməlum", bg: "неизвестно", bn: "অজানা", bs: "nepoznato", cs: "neznámé",
  da: "ukendt", el: "άγνωστο", et: "teadmata", fi: "tuntematon", hr: "nepoznato",
  hu: "ismeretlen", hy: "անհայտ", ka: "უცნობი", ky: "белгисиз", lt: "nežinoma",
  lv: "nezināms", mk: "непознато", mn: "тодорхойгүй", ms: "tidak diketahui", no: "ukjent",
  ro: "necunoscut", sk: "neznáme", sl: "neznano", sq: "i panjohur", sr: "непознато",
  sv: "okänt", sw: "haijulikani", ta: "தெரியாது", tg: "номаълум", th: "ไม่ทราบ",
  uz: "noma'lum",
};

function getWeatherDescription(code: number, lang: string = "ru"): string {
  const baseLang = (lang || "ru").toLowerCase().split(/[-_]/)[0];
  const dict = WEATHER_DESCRIPTIONS_BY_LANG[baseLang] || WEATHER_DESCRIPTIONS_EN;
  return dict[code] || WEATHER_UNKNOWN_BY_LANG[baseLang] || "unknown";
}

async function logUsage(userId: string, action: string, details?: string, tokensUsed?: number) {
  try {
    await storage.createUsageLog({ userId, action, details: details || null, tokensUsed: tokensUsed || null });
  } catch (e) {
    console.error("Failed to log usage:", e);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many attempts. Please try again in a few minutes.",
  });
  const supportChatLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });

  app.post("/api/auth/register", authLimiter, registerUser);
  app.post("/api/auth/login", authLimiter, loginUser);
  app.post("/api/auth/telegram", authLimiter, telegramAuth);
  app.get("/api/auth/telegram/config", (_req, res) => {
    // The bot username is public (it is embedded in the widget); the token is not.
    res.json({
      enabled: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
    });
  });
  app.post("/api/auth/logout", logoutUser);
  app.get("/api/auth/me", getCurrentUser);
  app.patch("/api/auth/language", updateUserLanguage);
  app.post("/api/auth/complete-onboarding", completeOnboarding);

  app.post("/api/support-chat", supportChatLimiter, handleSupportChat);

  app.get("/api/support-chat/admin-replies", async (req, res) => {
    try {
      const sessionId = req.sessionID;
      if (!sessionId) return res.json({ replies: [] });
      const messages = await storage.getSupportMessagesBySession(sessionId);
      const adminReplies = messages
        .filter(m => m.role === "admin")
        .map(m => ({ content: m.content, createdAt: m.createdAt }));
      return res.json({ replies: adminReplies });
    } catch (err) {
      console.error("[support-chat] Failed to fetch admin replies for user:", err);
      return res.json({ replies: [] });
    }
  });

  /**
   * Everything past this point requires a session.
   *
   * The allowlist is explicit rather than a "/auth/" prefix match: a prefix
   * silently made every future /api/auth/* route public, which is how
   * /api/auth/telegram/status and /require ended up unauthenticated.
   */
  const PUBLIC_API_PATHS = new Set([
    "/auth/register",
    "/auth/login",
    "/auth/logout",
    "/auth/me",
    "/auth/telegram",
    "/auth/telegram/config",
    "/support-chat",
    "/support-chat/admin-replies",
  ]);

  app.use("/api", (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return requireAuth(req, res, next);
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const usersWithStats = await Promise.all(
        allUsers.map(async (u) => {
          const stats = await storage.getUserStats(u.id);
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role || "user",
            blocked: u.blocked || false,
            createdAt: u.createdAt,
            stats,
          };
        })
      );
      return res.json(usersWithStats);
    } catch (error) {
      console.error("Admin get users error:", error);
      return res.status(500).json({ error: "Failed to get users" });
    }
  });

  const adminUpdateUserSchema = z.object({
    role: z.enum(["admin", "user"]).optional(),
    blocked: z.boolean().optional(),
  }).strict();

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = adminUpdateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { role, blocked } = parsed.data;

      if (id === req.session.userId) {
        return res.status(400).json({ error: "Cannot modify your own account" });
      }

      if (role !== undefined) {
        await storage.updateUserRole(id, role);
      }

      if (blocked !== undefined) {
        await storage.updateUserBlocked(id, blocked);
      }

      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ error: "User not found" });

      return res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        blocked: user.blocked,
      });
    } catch (error) {
      console.error("Admin update user error:", error);
      return res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (id === req.session.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      const deleted = await storage.deleteUser(id);
      if (!deleted) return res.status(404).json({ error: "User not found" });
      return res.json({ ok: true });
    } catch (error) {
      console.error("Admin delete user error:", error);
      return res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.get("/api/admin/usage", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getUsageStats();
      const logs = await storage.getUsageLogs(undefined, 200);

      let storageUsed = 0;
      const audioDir = path.join(process.cwd(), "public", "audio");
      try {
        const entries = await fs.readdir(audioDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const stat = await fs.stat(path.join(audioDir, entry.name));
            storageUsed += stat.size;
          }
        }
      } catch (err) {
        console.error("[admin-usage] Failed to calculate storage:", err);
      }

      return res.json({ stats, logs, storageUsedBytes: storageUsed });
    } catch (error) {
      console.error("Admin usage error:", error);
      return res.status(500).json({ error: "Failed to get usage stats" });
    }
  });

  app.get("/api/admin/support-messages", requireAdmin, async (req, res) => {
    try {
      const messages = await storage.getSupportMessages(500);
      const userIds = [...new Set(messages.map(m => m.userId).filter(Boolean))];
      const userMap: Record<string, { email: string; name: string | null }> = {};
      for (const uid of userIds) {
        const u = await storage.getUser(uid!);
        if (u) userMap[uid!] = { email: u.email, name: u.name };
      }

      const sessions: Record<string, { userId: string | null; user: { email: string; name: string | null } | null; messages: typeof messages }> = {};
      for (const msg of messages) {
        const key = msg.sessionId || msg.id;
        if (!sessions[key]) {
          sessions[key] = {
            userId: null,
            user: null,
            messages: [],
          };
        }
        if (msg.role !== "admin" && msg.userId && !sessions[key].userId) {
          sessions[key].userId = msg.userId;
          sessions[key].user = userMap[msg.userId] || null;
        }
        sessions[key].messages.push(msg);
      }

      for (const s of Object.values(sessions)) {
        s.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }

      const sorted = Object.entries(sessions).sort(([, a], [, b]) => {
        const aLast = a.messages[a.messages.length - 1]?.createdAt;
        const bLast = b.messages[b.messages.length - 1]?.createdAt;
        return new Date(bLast).getTime() - new Date(aLast).getTime();
      });

      return res.json(sorted.map(([sessionId, data]) => ({ sessionId, ...data })));
    } catch (error) {
      console.error("Admin support messages error:", error);
      return res.status(500).json({ error: "Failed to get support messages" });
    }
  });

  app.post("/api/admin/support-reply", requireAdmin, async (req, res) => {
    try {
      const replySchema = z.object({
        sessionId: z.string().min(1),
        message: z.string().min(1).max(5000).transform(s => s.trim()),
      });
      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { sessionId, message } = parsed.data;
      await storage.createSupportMessage({
        userId: req.session.userId,
        sessionId,
        role: "admin",
        content: message,
      });
      return res.json({ ok: true });
    } catch (error) {
      console.error("Admin support reply error:", error);
      return res.status(500).json({ error: "Failed to send reply" });
    }
  });

  app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const newThisWeek = allUsers.filter(u => new Date(u.createdAt) >= weekAgo).length;
      const newThisMonth = allUsers.filter(u => new Date(u.createdAt) >= monthAgo).length;

      return res.json({
        totalUsers: allUsers.length,
        newThisWeek,
        newThisMonth,
        activeUsers: allUsers.filter(u => !u.blocked).length,
        blockedUsers: allUsers.filter(u => u.blocked).length,
      });
    } catch (error) {
      console.error("Admin dashboard error:", error);
      return res.status(500).json({ error: "Failed to get dashboard" });
    }
  });

  app.post("/api/admin/sync-voices", requireAdmin, async (req, res) => {
    try {
      const { voices: voicesToSync } = req.body;
      if (!Array.isArray(voicesToSync) || voicesToSync.length === 0) {
        return res.status(400).json({ error: "voices array is required" });
      }

      const userId = req.session.userId!;
      const existingVoices = await storage.getVoices(userId);
      const existingVoiceIds = new Set(existingVoices.map(v => v.elevenLabsVoiceId));

      const created: string[] = [];
      const skipped: string[] = [];
      const invalid: string[] = [];

      for (const v of voicesToSync) {
        if (!v || typeof v.name !== "string" || !v.name.trim() || typeof v.elevenLabsVoiceId !== "string" || !v.elevenLabsVoiceId.trim()) {
          invalid.push(v?.name || "unknown");
          continue;
        }
        if (existingVoiceIds.has(v.elevenLabsVoiceId)) {
          skipped.push(v.name);
          continue;
        }
        existingVoiceIds.add(v.elevenLabsVoiceId);
        await storage.createVoice({
          userId,
          name: v.name.trim(),
          elevenLabsVoiceId: v.elevenLabsVoiceId.trim(),
          gender: v.gender === "female" ? "female" : "male",
          previewUrl: typeof v.previewUrl === "string" ? v.previewUrl : null,
          description: typeof v.description === "string" ? v.description : null,
          assignedProgramTypeIds: Array.isArray(v.assignedProgramTypeIds) ? v.assignedProgramTypeIds : Array.isArray(v.assignedProgramTypes) ? v.assignedProgramTypes : null,
        });
        created.push(v.name);
      }

      res.json({ created, skipped, invalid, message: `Created ${created.length} voices, skipped ${skipped.length}, invalid ${invalid.length}` });
    } catch (error) {
      console.error("Admin sync voices error:", error);
      res.status(500).json({ error: "Failed to sync voices" });
    }
  });

  app.get("/api/admin/export-data", requireAdmin, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const [
        settings,
        voices,
        programTypes,
        programs,
        dialogs,
        ads,
        adPresets,
        newsSources,
        scheduleTemplates,
        automations,
        customHolidays,
      ] = await Promise.all([
        storage.getSettings(userId),
        storage.getVoices(userId),
        storage.getProgramTypes(userId),
        storage.getPrograms(userId),
        storage.getDialogs(userId),
        storage.getAds(userId),
        storage.getAdPresets(userId),
        storage.getNewsSources(userId),
        storage.getScheduleTemplates(userId),
        storage.getAutomations(userId),
        storage.getCustomHolidays(userId),
      ]);

      const hostShifts: any[] = [];
      for (const tpl of scheduleTemplates) {
        const shifts = await storage.getHostShifts(tpl.id);
        hostShifts.push(...shifts);
      }

      const exportData = {
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        sourceUser: { email: user.email, username: user.username },
        settings: settings || null,
        voices,
        programTypes,
        programs,
        dialogs,
        ads,
        adPresets,
        newsSources,
        scheduleTemplates,
        hostShifts,
        automations,
        customHolidays,
      };

      res.setHeader("Content-Disposition", `attachment; filename="radioflow-export-${Date.now()}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error("Export data error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  app.post("/api/admin/import-data", requireAdmin, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const data = req.body;

      if (!data || !data.exportVersion) {
        return res.status(400).json({ error: "Invalid export data format" });
      }

      const results: Record<string, { created: number; skipped: number }> = {};
      const idMapping: Record<string, string> = {};

      if (data.settings) {
        try {
          const { id, userId: oldUserId, ...settingsData } = data.settings;
          await storage.saveSettings({ ...settingsData, userId }, userId);
          results.settings = { created: 1, skipped: 0 };
        } catch (e: any) {
          console.warn("Settings import error:", e.message);
          results.settings = { created: 0, skipped: 1 };
        }
      }

      if (data.voices?.length) {
        const existingVoices = await storage.getVoices(userId);
        const existingByElevenLabsId = new Map(existingVoices.map(v => [v.elevenLabsVoiceId, v]));
        results.voices = { created: 0, skipped: 0 };
        for (const v of data.voices) {
          const oldId = v.id;
          if (v.elevenLabsVoiceId && existingByElevenLabsId.has(v.elevenLabsVoiceId)) {
            idMapping[oldId] = existingByElevenLabsId.get(v.elevenLabsVoiceId)!.id;
            results.voices.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, ...voiceData } = v;
            const created = await storage.createVoice({ ...voiceData, userId });
            idMapping[oldId] = created.id;
            results.voices.created++;
          } catch (e: any) {
            console.warn(`Voice import error (${v.name}):`, e.message);
            results.voices.skipped++;
          }
        }
      }

      if (data.programTypes?.length) {
        const existingTypes = await storage.getProgramTypes(userId);
        const existingBySlug = new Map(existingTypes.map(pt => [pt.slug, pt]));
        results.programTypes = { created: 0, skipped: 0 };
        for (const pt of data.programTypes) {
          const oldId = pt.id;
          if (existingBySlug.has(pt.slug)) {
            idMapping[oldId] = existingBySlug.get(pt.slug)!.id;
            results.programTypes.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, ...ptData } = pt;
            const remappedVoiceIds = ptData.voiceIds?.map((vid: string) => idMapping[vid] || vid) || null;
            const created = await storage.createProgramType({ ...ptData, voiceIds: remappedVoiceIds, userId });
            idMapping[oldId] = created.id;
            results.programTypes.created++;
          } catch (e: any) {
            console.warn(`ProgramType import error (${pt.name}):`, e.message);
            results.programTypes.skipped++;
          }
        }
      }

      if (data.programs?.length) {
        const existingPrograms = await storage.getPrograms(userId);
        const existingByTitle = new Set(existingPrograms.map(p => `${p.programTypeId}:${p.title}`));
        results.programs = { created: 0, skipped: 0 };
        for (const prog of data.programs) {
          const oldId = prog.id;
          const newTypeId = idMapping[prog.programTypeId] || prog.programTypeId;
          const key = `${newTypeId}:${prog.title}`;
          if (existingByTitle.has(key)) {
            results.programs.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, programTypeId, voiceAssignments, ...progData } = prog;
            const remappedVoiceAssignments = voiceAssignments
              ? Object.fromEntries(
                  Object.entries(voiceAssignments).map(([speaker, voiceId]) => [speaker, idMapping[voiceId as string] || voiceId])
                )
              : null;
            const created = await storage.createProgram({
              ...progData,
              programTypeId: newTypeId,
              voiceAssignments: remappedVoiceAssignments,
              userId,
            });
            idMapping[oldId] = created.id;
            results.programs.created++;
          } catch (e: any) {
            console.warn(`Program import error (${prog.title}):`, e.message);
            results.programs.skipped++;
          }
        }
      }

      if (data.dialogs?.length) {
        const existingDialogs = await storage.getDialogs(userId);
        const existingByTitle = new Set(existingDialogs.map(d => d.title));
        results.dialogs = { created: 0, skipped: 0 };
        for (const d of data.dialogs) {
          if (existingByTitle.has(d.title)) {
            results.dialogs.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, ...dialogData } = d;
            await storage.createDialog({ ...dialogData, userId });
            results.dialogs.created++;
          } catch (e: any) {
            console.warn(`Dialog import error (${d.title}):`, e.message);
            results.dialogs.skipped++;
          }
        }
      }

      if (data.ads?.length) {
        const existingAds = await storage.getAds(userId);
        const existingByTitle = new Set(existingAds.map(a => a.title));
        results.ads = { created: 0, skipped: 0 };
        for (const ad of data.ads) {
          if (existingByTitle.has(ad.title)) {
            results.ads.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, voiceId, voiceAssignments, ...adData } = ad;
            const remappedVoiceId = voiceId ? (idMapping[voiceId] || voiceId) : null;
            const remappedVoiceAssignments = voiceAssignments
              ? Object.fromEntries(
                  Object.entries(voiceAssignments).map(([speaker, vid]) => [speaker, idMapping[vid as string] || vid])
                )
              : null;
            await storage.createAd({
              ...adData,
              voiceId: remappedVoiceId,
              voiceAssignments: remappedVoiceAssignments,
              userId,
            });
            results.ads.created++;
          } catch (e: any) {
            console.warn(`Ad import error (${ad.title}):`, e.message);
            results.ads.skipped++;
          }
        }
      }

      if (data.adPresets?.length) {
        const existingPresets = await storage.getAdPresets(userId);
        const existingByName = new Set(existingPresets.map(p => p.name));
        results.adPresets = { created: 0, skipped: 0 };
        for (const preset of data.adPresets) {
          if (existingByName.has(preset.name)) {
            results.adPresets.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, defaultVoiceId, ...presetData } = preset;
            const remappedVoiceId = defaultVoiceId ? (idMapping[defaultVoiceId] || defaultVoiceId) : null;
            await storage.createAdPreset({ ...presetData, defaultVoiceId: remappedVoiceId, userId });
            results.adPresets.created++;
          } catch (e: any) {
            console.warn(`AdPreset import error (${preset.name}):`, e.message);
            results.adPresets.skipped++;
          }
        }
      }

      if (data.newsSources?.length) {
        const existingSources = await storage.getNewsSources(userId);
        const existingByUrl = new Set(existingSources.map(s => s.url));
        results.newsSources = { created: 0, skipped: 0 };
        for (const src of data.newsSources) {
          if (existingByUrl.has(src.url)) {
            results.newsSources.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, ...srcData } = src;
            await storage.createNewsSource({ ...srcData, userId });
            results.newsSources.created++;
          } catch (e: any) {
            console.warn(`NewsSource import error (${src.name}):`, e.message);
            results.newsSources.skipped++;
          }
        }
      }

      if (data.scheduleTemplates?.length) {
        const existingTemplates = await storage.getScheduleTemplates(userId);
        const existingByName = new Map(existingTemplates.map(t => [t.name, t]));
        results.scheduleTemplates = { created: 0, skipped: 0 };
        for (const tpl of data.scheduleTemplates) {
          const oldId = tpl.id;
          if (existingByName.has(tpl.name)) {
            idMapping[oldId] = existingByName.get(tpl.name)!.id;
            results.scheduleTemplates.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, ...tplData } = tpl;
            const created = await storage.createScheduleTemplate({ ...tplData, userId });
            idMapping[oldId] = created.id;
            results.scheduleTemplates.created++;
          } catch (e: any) {
            console.warn(`ScheduleTemplate import error (${tpl.name}):`, e.message);
            results.scheduleTemplates.skipped++;
          }
        }
      }

      if (data.hostShifts?.length) {
        results.hostShifts = { created: 0, skipped: 0 };
        for (const shift of data.hostShifts) {
          try {
            const { id, ...shiftData } = shift;
            const newTemplateId = idMapping[shiftData.templateId] || shiftData.templateId;
            const remappedVoiceIds = shiftData.voiceIds?.map((vid: string) => idMapping[vid] || vid) || [];
            await storage.createHostShift({ ...shiftData, templateId: newTemplateId, voiceIds: remappedVoiceIds });
            results.hostShifts.created++;
          } catch (e: any) {
            console.warn(`HostShift import error:`, e.message);
            results.hostShifts.skipped++;
          }
        }
      }

      if (data.automations?.length) {
        const existingAutomations = await storage.getAutomations(userId);
        const existingByName = new Set(existingAutomations.map(a => a.name));
        results.automations = { created: 0, skipped: 0 };
        for (const auto of data.automations) {
          if (existingByName.has(auto.name)) {
            results.automations.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, createdAt, programTypeId, ...autoData } = auto;
            const newProgramTypeId = programTypeId ? (idMapping[programTypeId] || programTypeId) : null;
            await storage.createAutomation({ ...autoData, programTypeId: newProgramTypeId, userId });
            results.automations.created++;
          } catch (e: any) {
            console.warn(`Automation import error (${auto.name}):`, e.message);
            results.automations.skipped++;
          }
        }
      }

      if (data.customHolidays?.length) {
        const existingHolidays = await storage.getCustomHolidays(userId);
        const existingByDate = new Set(existingHolidays.map(h => h.date));
        results.customHolidays = { created: 0, skipped: 0 };
        for (const holiday of data.customHolidays) {
          if (existingByDate.has(holiday.date)) {
            results.customHolidays.skipped++;
            continue;
          }
          try {
            const { id, userId: oldUserId, ...holidayData } = holiday;
            await storage.createCustomHoliday({ ...holidayData, userId });
            results.customHolidays.created++;
          } catch (e: any) {
            console.warn(`CustomHoliday import error:`, e.message);
            results.customHolidays.skipped++;
          }
        }
      }

      res.json({
        message: "Import completed",
        results,
        idMapping,
      });
    } catch (error) {
      console.error("Import data error:", error);
      res.status(500).json({ error: "Failed to import data" });
    }
  });

  app.get("/api/storage/status", async (req, res) => {
    try {
      const settings = await storage.getSettings(req.session.userId);

      // Make sure a connected account has the app's root folder ("RadioFlow")
      // and remember its id: uploads then land under one folder, and the UI
      // can link straight to it. Lazy so accounts connected before this
      // existed get one too. Failure is non-fatal — the link just stays off.
      let folderId = settings?.googleDriveFolderId || null;
      if (!folderId && settings?.googleDriveRefreshToken && isGoogleDriveConfigured()) {
        try {
          folderId = await googleDriveEnsureRootFolder(settings.googleDriveRefreshToken);
          await storage.saveSettings({ googleDriveFolderId: folderId } as any, req.session.userId);
        } catch (err: any) {
          console.error("Could not ensure Drive root folder:", err?.message);
        }
      }

      res.json({
        provider: settings?.storageProvider || "yandex",
        googleDrive: {
          available: isGoogleDriveConfigured(),
          connected: !!settings?.googleDriveRefreshToken,
          email: settings?.googleDriveEmail || null,
          folderId,
          folderLink: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
        },
        yandex: { connected: !!settings?.yandexDiskToken },
      });
    } catch (error) {
      console.error("Error reading storage status:", error);
      res.status(500).json({ error: "Failed to read storage status" });
    }
  });

  app.post("/api/storage/provider", async (req, res) => {
    try {
      const { provider } = req.body || {};
      if (!["yandex", "google_drive", "none"].includes(provider)) {
        return res.status(400).json({ error: "Unknown storage provider" });
      }
      const settings = await storage.getSettings(req.session.userId);
      if (provider === "google_drive" && !settings?.googleDriveRefreshToken) {
        return res.status(400).json({ error: "Connect Google Drive first" });
      }
      await storage.saveSettings({ storageProvider: provider } as any, req.session.userId);
      res.json({ ok: true, provider });
    } catch (error) {
      console.error("Error setting storage provider:", error);
      res.status(500).json({ error: "Failed to set storage provider" });
    }
  });

  app.get("/api/storage/google/auth-url", async (req, res) => {
    try {
      if (!isGoogleDriveConfigured()) {
        return res.status(503).json({ error: "Google Drive is not configured on this server" });
      }
      // Bind the callback to this session: a code redeemed under a different
      // session must not attach someone else's Drive to this account.
      const state = randomUUID();
      req.session.googleOAuthState = state;
      res.json({ url: buildAuthUrl(state) });
    } catch (error: any) {
      console.error("Error building Google auth URL:", error);
      res.status(500).json({ error: error?.message || "Failed to build authorization URL" });
    }
  });

  app.get("/api/storage/google/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;
      if (oauthError) return res.redirect(`/settings?google=denied`);
      if (!code || !state || state !== req.session.googleOAuthState) {
        return res.redirect(`/settings?google=invalid_state`);
      }
      delete req.session.googleOAuthState;

      const tokens = await exchangeCodeForTokens(code);

      // Create the app's root folder right away so the first upload and the
      // settings link work without an extra round-trip. Non-fatal: the status
      // endpoint retries this lazily if it fails here.
      let rootFolderId: string | null = null;
      try {
        rootFolderId = await googleDriveEnsureRootFolder(tokens.refreshToken);
      } catch (err: any) {
        console.error("Could not create Drive root folder on connect:", err?.message);
      }

      await storage.saveSettings({
        googleDriveRefreshToken: tokens.refreshToken,
        googleDriveEmail: tokens.email,
        googleDriveFolderId: rootFolderId,
        storageProvider: "google_drive",
      } as any, req.session.userId);

      logUsage(req.session.userId!, "storage_connect", "google_drive");
      res.redirect(`/settings?google=connected`);
    } catch (error: any) {
      console.error("Google Drive callback failed:", error);
      res.redirect(`/settings?google=failed`);
    }
  });

  app.post("/api/storage/google/disconnect", async (req, res) => {
    try {
      const settings = await storage.getSettings(req.session.userId);
      await storage.saveSettings({
        googleDriveRefreshToken: null,
        googleDriveEmail: null,
        googleDriveFolderId: null,
        storageProvider: settings?.storageProvider === "google_drive" ? "none" : settings?.storageProvider,
      } as any, req.session.userId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error disconnecting Google Drive:", error);
      res.status(500).json({ error: "Failed to disconnect Google Drive" });
    }
  });

  app.get("/api/auth/telegram/status", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({
        linked: !!user.telegramId,
        telegramUsername: user.telegramUsername || null,
        requireTelegramLogin: !!user.requireTelegramLogin,
        hasPassword: !!user.password,
      });
    } catch (error) {
      console.error("Error reading Telegram status:", error);
      res.status(500).json({ error: "Failed to read Telegram status" });
    }
  });

  app.post("/api/auth/telegram/unlink", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "User not found" });
      // Unlinking a passwordless account would lock the owner out permanently.
      if (!user.password) {
        return res.status(400).json({ error: "Set a password before unlinking Telegram — it is your only way in." });
      }
      await storage.unlinkTelegramAccount(user.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error unlinking Telegram:", error);
      res.status(500).json({ error: "Failed to unlink Telegram" });
    }
  });

  app.post("/api/auth/telegram/require", async (req, res) => {
    try {
      const { required } = req.body || {};
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (required && !user.telegramId) {
        return res.status(400).json({ error: "Link a Telegram account first" });
      }
      await storage.setRequireTelegramLogin(user.id, !!required);
      res.json({ ok: true, requireTelegramLogin: !!required });
    } catch (error) {
      console.error("Error updating Telegram 2FA:", error);
      res.status(500).json({ error: "Failed to update two-factor setting" });
    }
  });

  app.get("/api/jobs", async (req, res) => {
    try {
      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const jobs = await listJobs(req.session.userId!, { type, limit });
      res.json(jobs);
    } catch (error) {
      console.error("Error listing jobs:", error);
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const job = await getJob(req.params.id, req.session.userId!);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (error) {
      console.error("Error getting job:", error);
      res.status(500).json({ error: "Failed to get job" });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings(req.session.userId);
      if (!settings) return res.json({});
      const user = await storage.getUser(req.session.userId!);
      if (user?.role !== "admin") {
        const { elevenLabsApiKey, anthropicApiKey, yandexDiskToken, freesoundApiKey, ...safeSettings } = settings;
        return res.json({
          ...safeSettings,
          elevenLabsApiKey: elevenLabsApiKey ? "••••••••" : "",
          anthropicApiKey: anthropicApiKey ? "••••••••" : "",
          yandexDiskToken: yandexDiskToken ? "••••••••" : "",
          freesoundApiKey: freesoundApiKey ? "••••••••" : "",
        });
      }
      res.json(settings);
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
      const user = await storage.getUser(req.session.userId!);
      const { elevenLabsApiKey, anthropicApiKey, yandexDiskToken, freesoundApiKey, ...safeData } = parsed.data;
      const data = user?.role === "admin"
        ? parsed.data
        : safeData;
      const settings = await storage.saveSettings(data, req.session.userId);
      if (user?.role !== "admin") {
        const { elevenLabsApiKey, anthropicApiKey, yandexDiskToken, freesoundApiKey, ...safe } = settings;
        return res.json({
          ...safe,
          elevenLabsApiKey: elevenLabsApiKey ? "••••••••" : "",
          anthropicApiKey: anthropicApiKey ? "••••••••" : "",
          yandexDiskToken: yandexDiskToken ? "••••••••" : "",
          freesoundApiKey: freesoundApiKey ? "••••••••" : "",
        });
      }
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
      const userSettings = await storage.getSettings(req.session?.userId);
      const stationLocation = userSettings?.stationLocation || "";
      const weather = await fetchWeather();
      if (!weather) {
        return res.status(503).json({ error: "Weather service unavailable" });
      }
      res.json({
        ...weather,
        description: getWeatherDescription(weather.weathercode),
        location: stationLocation || "Local area",
      });
    } catch (error) {
      console.error("Error fetching weather:", error);
      res.status(500).json({ error: "Failed to fetch weather" });
    }
  });

  app.get("/api/dialogs", async (req, res) => {
    try {
      const dialogs = await storage.getDialogs(req.session.userId!);
      res.json(dialogs);
    } catch (error) {
      console.error("Error getting dialogs:", error);
      res.status(500).json({ error: "Failed to get dialogs" });
    }
  });

  app.get("/api/dialogs/:id", async (req, res) => {
    try {
      const dialog = await storage.getDialog(req.params.id, req.session.userId!);
      if (!dialog) {
        return res.status(404).json({ error: "Dialog not found" });
      }
      res.json(dialog);
    } catch (error) {
      console.error("Error getting dialog:", error);
      res.status(500).json({ error: "Failed to get dialog" });
    }
  });

  app.patch("/api/dialogs/:id", async (req, res) => {
    try {
      const dialog = await storage.getDialog(req.params.id, req.session.userId!);
      if (!dialog) return res.status(404).json({ error: "Dialog not found" });
      const updated = await storage.updateDialog(req.params.id, req.session.userId!, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating dialog:", error);
      res.status(500).json({ error: "Failed to update dialog" });
    }
  });

  app.post("/api/dialogs/:id/auto-tags", async (req, res) => {
    try {
      const dialog = await storage.getDialog(req.params.id, req.session.userId!);
      if (!dialog) return res.status(404).json({ error: "Dialog not found" });

      const hasBothTexts = dialog.maleText && dialog.femaleText;
      const text = hasBothTexts
        ? `Мужская реплика:\n${dialog.maleText}\n\nЖенская реплика:\n${dialog.femaleText}`
        : dialog.scriptText || "";

      if (!text) return res.status(400).json({ error: "No text to tag" });

      const responseFormat = hasBothTexts
        ? '{"maleText": "текст с тегами", "femaleText": "текст с тегами"}'
        : '{"scriptText": "текст с тегами"}';

      const systemPrompt = `Ты — разметчик эмоций для радио-диалогов. Добавь метатеги эмоций в начало каждого абзаца текста.

Доступные теги: [energetic], [fast], [slow], [surprised], [thoughtful], [happy], [calm], [warm], [confident], [excited], [gentle], [announcer]

Правила:
- Ставь 1-2 тега в начало каждого абзаца/реплики
- Выбирай тег по настроению и содержанию текста
- НЕ меняй сам текст, только добавляй теги
- Ответ строго в формате JSON без markdown обёртки: ${responseFormat}`;

      const settingsData = await storage.getSettings(req.session?.userId);
      let respText: string;

      const anthropic = await getAnthropicClient(req.session?.userId);
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(4000),
          system: systemPrompt,
          messages: [{ role: "user", content: text }],
        });
        respText = response.content[0].type === "text" ? response.content[0].text : "{}";
      } else {
        const openai = new OpenAI();
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 4000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
        });
        respText = response.choices[0]?.message?.content || "{}";
      }

      const jsonMatch = respText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const cleanJson = jsonMatch ? jsonMatch[1].trim() : respText.trim();
      const result = JSON.parse(cleanJson) as Record<string, string>;

      const updateData: Record<string, string> = {};
      if (hasBothTexts) {
        if (result.maleText) updateData.maleText = result.maleText;
        if (result.femaleText) updateData.femaleText = result.femaleText;
      } else {
        if (result.scriptText) updateData.scriptText = result.scriptText;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "AI did not return tagged text" });
      }

      const updated = await storage.updateDialog(req.params.id, req.session.userId!, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error auto-tagging dialog:", error);
      res.status(500).json({ error: "Failed to auto-tag dialog" });
    }
  });

  app.post("/api/generate-script", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || prompt.length < 10) {
        return res.status(400).json({ error: "Prompt is required and must be at least 10 characters" });
      }

      const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLang = user?.language || "en";
      const ps = getPromptStrings(userLang);

      const ctx = await buildStationContext(req.session.userId, userLang);
      const settings = await storage.getSettings(req.session.userId);
      const dialogStyle = (settings as any)?.dialogStyle || "lively";
      const dialogReplicas = (settings as any)?.dialogReplicas || 4;

      const styleInstructions = dialogStyle === "lively" 
        ? ps.styleLively
        : dialogStyle === "simple"
        ? ps.styleSimple
        : ps.styleModerate;

      const systemPrompt = `${ps.langDirective}
${ps.scriptWriter} "${ctx.stationName}". 
${ctx.stationDescription ? ps.aboutStation(ctx.stationDescription) : ""}
${ps.dialogTask(ctx.malePersona, ctx.femalePersona)}
${ps.dialogLang}
${ps.dialogDuration}
${styleInstructions}

${ps.emotionInstructions}
${ps.emotionTags}

${ps.formatResponse}
{
  "replicas": [
    {"speaker": "${ctx.malePersona}", "text": "[energetic] [warm] line"},
    {"speaker": "${ctx.femalePersona}", "text": "[happy] response"},
    {"speaker": "${ctx.malePersona}", "text": "[thoughtful] line"}
  ]
}
${ps.minReplicas(dialogReplicas)}`;

      function parseReplicasResponse(parsed: any) {
        if (parsed.replicas && Array.isArray(parsed.replicas)) {
          const maleLines: string[] = [];
          const femaleLines: string[] = [];
          const scriptLines: string[] = [];
          const maleNames = ctx.malePersona.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
          const femaleNames = ctx.femalePersona.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
          
          for (let ri = 0; ri < parsed.replicas.length; ri++) {
            const r = parsed.replicas[ri];
            const speaker = (r.speaker || "").trim();
            scriptLines.push(`${speaker}: ${r.text}`);
            const speakerLow = speaker.toLowerCase();
            const matchesMale = maleNames.some(n => speakerLow.includes(n) || n.includes(speakerLow));
            const matchesFemale = femaleNames.some(n => speakerLow.includes(n) || n.includes(speakerLow));
            
            const isMale = matchesMale && !matchesFemale ? true 
              : matchesFemale && !matchesMale ? false 
              : ri % 2 === 0;
            
            if (isMale) maleLines.push(r.text);
            else femaleLines.push(r.text);
          }
          return { maleText: maleLines.join("\n"), femaleText: femaleLines.join("\n"), scriptText: scriptLines.join("\n") };
        }
        return { maleText: parsed.maleText || "", femaleText: parsed.femaleText || "", scriptText: "" };
      }

      const anthropic = await getAnthropicClient(req.session.userId);
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(1024),
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
        logUsage(req.session.userId!, "script_generation", "Claude", response.usage?.input_tokens ? response.usage.input_tokens + (response.usage?.output_tokens || 0) : undefined);
        return res.json(parseReplicasResponse(parsed));
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
      logUsage(req.session.userId!, "script_generation", "OpenAI");
      res.json(parseReplicasResponse(parsed));
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

      const anthropic = await getAnthropicClient(req.session.userId);

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(512),
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
        max_tokens: aiMaxTokens(10),
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

  app.get("/api/services-status", async (req, res) => {
    try {
      const userSettings = await storage.getSettings(req.session?.userId);
      
      const elevenLabsKey = getEffectiveElevenLabsKey(userSettings);
      const anthropicKey = getEffectiveAnthropicKey(userSettings);
      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
      const yandexToken = userSettings?.yandexDiskToken || null;
      const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      
      res.json({
        elevenLabs: !!elevenLabsKey,
        anthropic: !!anthropicKey,
        firecrawl: !!firecrawlKey,
        yandexDisk: !!yandexToken,
        openai: !!openaiKey,
        gemini: !!geminiKey,
      });
    } catch (error) {
      console.error("Error checking services status:", error);
      res.status(500).json({ error: "Failed to check services" });
    }
  });

  app.post("/api/generate-audio", async (req, res) => {
    try {
      const { maleText, femaleText, title, scheduledDate, slotNumber, dialogId } = req.body;
      
      if (!maleText || !femaleText) {
        return res.status(400).json({ error: "Both male and female texts are required" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured. Please add it in Settings." });
      }

      const voicesList = await storage.getVoices(req.session.userId!);

      let maleVoiceId: string | undefined;
      let femaleVoiceId: string | undefined;

      if (dialogId) {
        const dialog = await storage.getDialog(dialogId, req.session.userId!);
        if (dialog?.hostVoiceIds && dialog.hostVoiceIds.length > 0) {
          for (const vid of dialog.hostVoiceIds) {
            const voice = voicesList.find(v => v.id === vid);
            if (voice?.gender === "male" && !maleVoiceId) maleVoiceId = voice.elevenLabsVoiceId;
            if (voice?.gender === "female" && !femaleVoiceId) femaleVoiceId = voice.elevenLabsVoiceId;
          }
        }
      }

      if (!maleVoiceId) {
        const maleVoice = voicesList.find(v => v.gender === "male" && v.isActive);
        maleVoiceId = maleVoice?.elevenLabsVoiceId;
      }
      if (!femaleVoiceId) {
        const femaleVoice = voicesList.find(v => v.gender === "female" && v.isActive);
        femaleVoiceId = femaleVoice?.elevenLabsVoiceId;
      }
      
      if (!maleVoiceId || !femaleVoiceId) {
        return res.status(400).json({ 
          error: "Необходимо добавить активные мужской и женский голоса в разделе 'Голоса'" 
        });
      }

      const ttsStability = settings.ttsStability ?? 0.75;
      const ttsSimilarityBoost = settings.ttsSimilarityBoost ?? 0.75;

      const generateVoice = async (text: string, voiceId: string): Promise<Buffer> => {
        return synthesizeSpeech({
          apiKey: settings.elevenLabsApiKey!,
          voiceId,
          text,
          stability: ttsStability,
          similarityBoost: ttsSimilarityBoost,
        });
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

      await concatMp3WithFfmpeg([maleFile, femaleFile], combinedFile, audioDir, timestamp);

      await fs.unlink(maleFile).catch(() => {});
      await fs.unlink(femaleFile).catch(() => {});

      const combinedStat = await fs.stat(combinedFile);

      const dialog = await storage.createDialog({
        userId: req.session.userId,
        title: title || "Подводка",
        prompt: "",
        scriptText: `${maleText}\n\n${femaleText}`,
        maleText,
        femaleText,
        audioUrl: `/audio/dialog_${timestamp}.mp3`,
        duration: Math.round(combinedStat.size / (192000 / 8)),
        status: "ready",
        scheduledDate: scheduledDate || null,
        slotNumber: slotNumber || null,
        uploadedToYandex: false,
        yandexPath: null,
      });

      void archiveAudio({
        userId: req.session.userId!,
        audioUrl: `/audio/dialog_${timestamp}.mp3`,
        folder: "/radio/dialogs",
      }).then(archived => {
        if (archived.uploaded) {
          storage.updateDialog(dialog.id, req.session.userId!, { uploadedToYandex: true, yandexPath: archived.remotePath }).catch(() => {});
        } else if (archived.error) {
          console.error(`[archive] dialog ${dialog.id}: ${archived.error}`);
        }
      });

      logUsage(req.session.userId!, "audio_generation", "dialog");
      res.json(dialog);
    } catch (error) {
      console.error("Error generating audio:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate audio" });
    }
  });

  app.delete("/api/dialogs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteDialog(req.params.id, req.session.userId!);
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
      const { date, totalSlots: totalSlotsOverride, firecrawlContent } = req.body;
      
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      const existingDialogs = await storage.getDialogs(req.session.userId!);
      const existingForDate = existingDialogs.filter(d => d.scheduledDate === date);
      const existingBySlot = new Map<number, string>();
      existingForDate.forEach(d => {
        if (d.slotNumber) {
          existingBySlot.set(d.slotNumber, d.id);
        }
      });

      const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLang = user?.language || "en";
      const ps = getPromptStrings(userLang);
      const langLocale = userLang === "ru" ? "ru-RU" : userLang === "tr" ? "tr-TR" : "en-US";

      const settings = await storage.getSettings(req.session.userId);
      const ctx = await buildStationContext(req.session.userId, userLang);
      const newsItemsList = await storage.getNewsItems(req.session.userId!, 10);
      const unusedNews = newsItemsList.filter(n => !n.isUsed).slice(0, 5);
      
      const dateObj = new Date(date);
      const jsDay = dateObj.getDay();
      const isoWeekday = jsDay === 0 ? 7 : jsDay;
      const template = await storage.getTemplateForWeekday(isoWeekday, req.session.userId!);
      const shifts = template ? await storage.getHostShifts(template.id) : [];

      const tplStartHour = template?.startHour ?? 7;
      const tplEndHour = template?.endHour ?? 22;
      const tplSlotsPerHour = template?.slotsPerHour ?? 1;
      const totalSlots = totalSlotsOverride || (template ? (tplEndHour - tplStartHour) * tplSlotsPerHour : (settings?.dailyDialogsCount || 12));

      const dateFormatted = dateObj.toLocaleDateString(langLocale, { day: "numeric", month: "long", year: "numeric" });
      const weekday = dateObj.toLocaleDateString(langLocale, { weekday: "long" });
      
      const holiday = getHolidayInfo(date);
      
      const newsContext = unusedNews.length > 0 
        ? `\n\nАктуальные новости для использования:\n${unusedNews.map((n, i) => `${i + 1}. ${n.title}${n.summary ? `: ${n.summary}` : ""}`).join("\n")}`
        : "";

      const dailyPrompt = settings?.dailyPrompt || "";
      const slotPrompts = settings?.slotPrompts || [];
      const learnings = settings?.accumulatedLearnings || "";
      const dialogStyle = (settings as any)?.dialogStyle || "lively";
      const dialogReplicas = (settings as any)?.dialogReplicas || 4;

      const allVoices = await storage.getVoices(req.session.userId!);
      const generatedDialogs = [];

      for (let slotNumber = 1; slotNumber <= totalSlots; slotNumber++) {
        const slotHour = template 
          ? tplStartHour + (slotNumber - 1) / tplSlotsPerHour
          : 7 + (slotNumber - 1) * (15 / totalSlots);
        const hour = Math.floor(slotHour);
        const minutes = Math.round((slotHour - hour) * 60);
        const timeLabel = `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
        
        let timeOfDay = "день";
        if (hour < 10) timeOfDay = "утро";
        else if (hour < 14) timeOfDay = "день";
        else if (hour < 18) timeOfDay = "вечер";
        else timeOfDay = "поздний вечер";

        const slotPrompt = slotPrompts[slotNumber - 1] || "";
        
        const matchingShift = shifts.find(s => {
          const shiftOvn = s.endHour <= s.startHour;
          if (shiftOvn) return hour >= s.startHour || hour < s.endHour;
          return hour >= s.startHour && hour < s.endHour;
        });
        const slotVoiceIds = matchingShift?.voiceIds || template?.voiceIds || null;
        const slotVoiceNames = slotVoiceIds 
          ? allVoices.filter(v => slotVoiceIds.includes(v.id)).map(v => `${getCleanVoiceName(v)} (${v.gender === "male" ? "мужчина" : "женщина"})`).join(", ")
          : null;

        let firecrawlSection = "";
        if (firecrawlContent) {
          const topicBlocks = firecrawlContent.split(/---\s*[^-]+\s*---/).filter(b => b.trim());
          const topicHeaders = firecrawlContent.match(/---\s*([^-]+)\s*---/g)?.map(h => h.replace(/---/g, "").trim()) || [];
          if (topicBlocks.length > 0) {
            const blockIndex = (slotNumber - 1) % topicBlocks.length;
            const topicName = topicHeaders[blockIndex] || `Тема ${blockIndex + 1}`;
            const blockContent = topicBlocks[blockIndex].trim().substring(0, 1500);
            firecrawlSection = `\n⚡ ОБЯЗАТЕЛЬНЫЙ КОНТЕНТ ИЗ ИНТЕРНЕТА — ты ДОЛЖЕН использовать эти факты в диалоге:
Тема для этого слота: "${topicName}"
---
${blockContent}
---
СТРОГОЕ ПРАВИЛО: Включи минимум 2-3 конкретных факта/цифры/названия из текста выше в диалог. Ведущие должны обсуждать именно эту тему, используя реальные данные. НЕ ИГНОРИРУЙ этот контент!\n`;
          } else {
            firecrawlSection = `\nАКТУАЛЬНАЯ ИНФОРМАЦИЯ ИЗ ИНТЕРНЕТА — ОБЯЗАТЕЛЬНО используй конкретные факты из этого текста:\n${firecrawlContent.substring(0, 2000)}\nВключи минимум 2-3 факта из текста выше в диалог!\n`;
          }
        }

        const hostsLine = slotVoiceNames 
          ? (userLang === "ru" ? `Ведущие этого слота: ${slotVoiceNames}.` : `Hosts for this slot: ${slotVoiceNames}.`)
          : ps.dialogTask(ctx.malePersona, ctx.femalePersona);
        
        const styleBlock = dialogStyle === "lively" ? ps.styleLively : dialogStyle === "simple" ? ps.styleSimple : ps.styleModerate;

        const systemPrompt = `${ps.langDirective}
${ps.scriptWriter} "${ctx.stationName}". 
${ctx.stationDescription ? ps.aboutStation(ctx.stationDescription) : ""}
${hostsLine}
${ctx.knowledgeBase ? `\n${ps.knowledgeBase}\n${ctx.knowledgeBase}\n` : ""}

- Date: ${dateFormatted}, ${weekday}
${holiday ? `- Holiday: ${holiday}` : ""}
- Time slot: ${timeLabel} (${timeOfDay})
- Slot: ${slotNumber} of ${totalSlots}
${newsContext}
${dailyPrompt ? `DAILY INSTRUCTIONS:\n${dailyPrompt}\n` : ""}
${slotPrompt ? `SLOT INSTRUCTIONS:\n${slotPrompt}\n` : ""}
${learnings ? `ACCUMULATED EXPERIENCE:\n${learnings}\n` : ""}

${ps.dialogDuration} ${dialogReplicas}-${dialogReplicas + 2} alternating lines.
${firecrawlSection}
${hour < 10 ? (userLang === "ru" ? "Утренний слот: бодрое приветствие, энергичный тон." : "Morning slot: upbeat greeting, energetic tone.") : ""}
${hour >= 18 ? (userLang === "ru" ? "Вечерний слот: расслабленный тон, итоги дня." : "Evening slot: relaxed tone, day summary.") : ""}

${styleBlock}

${ps.emotionInstructions}
${ps.emotionTags}

${ps.formatResponse}
{
  "title": "short dialog topic",
  "replicas": [
    {"speaker": "${ctx.malePersona}", "text": "[energetic] [warm] line with tags"},
    {"speaker": "${ctx.femalePersona}", "text": "[happy] response line"},
    {"speaker": "${ctx.malePersona}", "text": "[thoughtful] next line"},
    {"speaker": "${ctx.femalePersona}", "text": "[excited] and so on..."}
  ]
}
${ps.minReplicas(dialogReplicas)}`;

        const userPrompt = userLang === "ru" 
          ? `Создай диалог для слота #${slotNumber} (${timeLabel}, ${timeOfDay}).`
          : `Create a dialog for slot #${slotNumber} (${timeLabel}, ${timeOfDay}).`;

        try {
          const anthropic = await getAnthropicClient(req.session.userId);
          let maleText = "";
          let femaleText = "";
          let scriptText = "";
          let title = userLang === "ru" ? `Слот #${slotNumber}` : `Slot #${slotNumber}`;

          function parseDialogResponse(parsed: any) {
            if (parsed.replicas && Array.isArray(parsed.replicas)) {
              const maleLines: string[] = [];
              const femaleLines: string[] = [];
              const scriptLines: string[] = [];
              const maleNames = ctx.malePersona.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
              const femaleNames = ctx.femalePersona.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
              let firstSpeakerIsMale: boolean | null = null;
              
              for (let ri = 0; ri < parsed.replicas.length; ri++) {
                const r = parsed.replicas[ri];
                const speaker = (r.speaker || "").trim();
                const text = r.text || "";
                scriptLines.push(`${speaker}: ${text}`);
                const speakerLow = speaker.toLowerCase();
                const matchesMale = maleNames.some(n => speakerLow.includes(n) || n.includes(speakerLow));
                const matchesFemale = femaleNames.some(n => speakerLow.includes(n) || n.includes(speakerLow));
                
                let isMale: boolean;
                if (matchesMale && !matchesFemale) {
                  isMale = true;
                } else if (matchesFemale && !matchesMale) {
                  isMale = false;
                } else {
                  if (firstSpeakerIsMale === null) firstSpeakerIsMale = true;
                  isMale = ri % 2 === 0 ? firstSpeakerIsMale : !firstSpeakerIsMale;
                }
                
                if (firstSpeakerIsMale === null) firstSpeakerIsMale = isMale;
                
                if (isMale) {
                  maleLines.push(text);
                } else {
                  femaleLines.push(text);
                }
              }
              return {
                maleText: maleLines.join("\n"),
                femaleText: femaleLines.join("\n"),
                scriptText: scriptLines.join("\n"),
                title: parsed.title || title,
              };
            }
            return {
              maleText: parsed.maleText || "",
              femaleText: parsed.femaleText || "",
              scriptText: parsed.maleText && parsed.femaleText 
                ? `${ctx.malePersona}: ${parsed.maleText}\n${ctx.femalePersona}: ${parsed.femaleText}` 
                : "",
              title: parsed.title || title,
            };
          }

          if (anthropic) {
            const response = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: aiMaxTokens(1024),
              system: systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
            });

            const textContent = response.content.find(c => c.type === "text");
            if (textContent && textContent.type === "text") {
              const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const result = parseDialogResponse(parsed);
                maleText = result.maleText;
                femaleText = result.femaleText;
                scriptText = result.scriptText;
                title = result.title;
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
              const result = parseDialogResponse(parsed);
              maleText = result.maleText;
              femaleText = result.femaleText;
              scriptText = result.scriptText;
              title = result.title;
            }
          }

          const existingDialogId = existingBySlot.get(slotNumber);
          let dialog;
          
          if (existingDialogId) {
            dialog = await storage.updateDialog(existingDialogId, req.session.userId!, {
              title,
              prompt: userPrompt,
              scriptText: scriptText || `${maleText}\n\n${femaleText}`,
              maleText,
              femaleText,
              status: "pending",
              moderationStatus: "pending",
              moderationNotes: null,
              moderatedAt: null,
              hostVoiceIds: slotVoiceIds,
              newsSourceIds: unusedNews.length > 0 ? unusedNews.map(n => n.id) : null,
            });
          } else {
            dialog = await storage.createDialog({
              userId: req.session.userId,
              title,
              prompt: userPrompt,
              scriptText: scriptText || `${maleText}\n\n${femaleText}`,
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
              hostVoiceIds: slotVoiceIds,
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
      
      const dialog = await storage.getDialog(dialogId, req.session.userId!);
      if (!dialog) {
        return res.status(404).json({ error: "Dialog not found" });
      }

      const userRegen = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLangRegen = userRegen?.language || "en";
      const psRegen = getPromptStrings(userLangRegen);
      const ctx = await buildStationContext(req.session.userId, userLangRegen);

      let maleHost = ctx.malePersona;
      let femaleHost = ctx.femalePersona;
      if (dialog.hostVoiceIds && dialog.hostVoiceIds.length > 0) {
        const voicesList = await storage.getVoices(req.session.userId!);
        for (const vid of dialog.hostVoiceIds) {
          const voice = voicesList.find(v => v.id === vid);
          if (voice?.gender === "male") maleHost = getCleanVoiceName(voice);
          if (voice?.gender === "female") femaleHost = getCleanVoiceName(voice);
        }
      }
      
      const systemPrompt = `${psRegen.langDirective}
${psRegen.scriptWriter} "${ctx.stationName}". 
${ctx.stationDescription ? psRegen.aboutStation(ctx.stationDescription) : ""}
${psRegen.dialogTask(maleHost, femaleHost)}
${ctx.knowledgeBase ? `\n${psRegen.knowledgeBase}\n${ctx.knowledgeBase}\n` : ""}

IMPORTANT: Response in JSON format:
{
  "maleText": "new text for ${maleHost}",
  "femaleText": "new text for ${femaleHost}"
}`;

      const anthropic = await getAnthropicClient(req.session.userId);
      let maleText = dialog.maleText || "";
      let femaleText = dialog.femaleText || "";

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(1024),
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

      const updatedDialog = await storage.updateDialog(dialogId, req.session.userId!, {
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

      const dialogs = await storage.getDialogs(req.session.userId!);
      const dialogsForDate = dialogs.filter(d => 
        d.scheduledDate === date && 
        d.maleText && 
        d.femaleText && 
        (d.status === "pending" || d.status === "generating")
      );

      if (dialogsForDate.length === 0) {
        return res.json({ queued: 0, message: "No dialogs to generate" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const voicesList = await storage.getVoices(req.session.userId!);
      const defaultMaleVoice = voicesList.find(v => v.gender === "male" && v.isActive);
      const defaultFemaleVoice = voicesList.find(v => v.gender === "female" && v.isActive);
      
      if (!defaultMaleVoice || !defaultFemaleVoice) {
        return res.status(400).json({ 
          error: "Необходимо добавить активные мужской и женский голоса в разделе 'Голоса'" 
        });
      }

      for (const dialog of dialogsForDate) {
        await storage.updateDialog(dialog.id, req.session.userId!, { status: "generating" });
      }

      res.json({ queued: dialogsForDate.length });

      const ttsStability2 = settings.ttsStability ?? 0.75;
      const ttsSimilarityBoost2 = settings.ttsSimilarityBoost ?? 0.75;

      const generateVoiceAudio = async (text: string, voiceId: string): Promise<Buffer> => {
        return synthesizeSpeech({
          apiKey: settings.elevenLabsApiKey!,
          voiceId,
          text,
          stability: ttsStability2,
          similarityBoost: ttsSimilarityBoost2,
        });
      };

      const resolveVoicesForDialog = (dialog: typeof dialogsForDate[0]) => {
        let maleVoiceId = defaultMaleVoice.elevenLabsVoiceId;
        let femaleVoiceId = defaultFemaleVoice.elevenLabsVoiceId;

        if (dialog.hostVoiceIds && dialog.hostVoiceIds.length > 0) {
          for (const vid of dialog.hostVoiceIds) {
            const voice = voicesList.find(v => v.id === vid);
            if (voice?.gender === "male") maleVoiceId = voice.elevenLabsVoiceId;
            if (voice?.gender === "female") femaleVoiceId = voice.elevenLabsVoiceId;
          }
        }
        return { maleVoiceId, femaleVoiceId };
      };

      (async () => {
        for (const dialog of dialogsForDate) {
          try {
            console.log(`Generating audio for dialog ${dialog.id}...`);
            const { maleVoiceId, femaleVoiceId } = resolveVoicesForDialog(dialog);
            
            const [maleAudio, femaleAudio] = await Promise.all([
              generateVoiceAudio(dialog.maleText!, maleVoiceId),
              generateVoiceAudio(dialog.femaleText!, femaleVoiceId),
            ]);

            const audioDir = path.join(process.cwd(), "public", "audio");
            await fs.mkdir(audioDir, { recursive: true });

            const timestamp = Date.now();
            const combinedFile = path.join(audioDir, `dialog_${dialog.id}_${timestamp}.mp3`);
            const maleFile = path.join(audioDir, `_male_${dialog.id}_${timestamp}.mp3`);
            const femaleFile2 = path.join(audioDir, `_female_${dialog.id}_${timestamp}.mp3`);

            await fs.writeFile(maleFile, maleAudio);
            await fs.writeFile(femaleFile2, femaleAudio);
            await concatMp3WithFfmpeg([maleFile, femaleFile2], combinedFile, audioDir, timestamp);
            await fs.unlink(maleFile).catch(() => {});
            await fs.unlink(femaleFile2).catch(() => {});

            const stat = await fs.stat(combinedFile);
            await storage.updateDialog(dialog.id, req.session.userId!, {
              audioUrl: `/audio/dialog_${dialog.id}_${timestamp}.mp3`,
              duration: Math.round(stat.size / (192000 / 8)),
              status: "ready",
            });

            console.log(`Audio generated for dialog ${dialog.id}`);
          } catch (error) {
            console.error(`Error generating audio for dialog ${dialog.id}:`, error);
            await storage.updateDialog(dialog.id, req.session.userId!, { status: "error" });
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
      const sources = await storage.getNewsSources(req.session.userId!);
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
      const source = await storage.createNewsSource({ ...parsed.data, userId: req.session.userId });
      res.json(source);
    } catch (error) {
      console.error("Error creating news source:", error);
      res.status(500).json({ error: "Failed to create news source" });
    }
  });

  app.patch("/api/news-sources/:id", async (req, res) => {
    try {
      const updated = await storage.updateNewsSource(req.params.id, req.session.userId!, req.body);
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
      const deleted = await storage.deleteNewsSource(req.params.id, req.session.userId!);
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
      const items = await storage.getNewsItems(req.session.userId!, limit);
      res.json(items);
    } catch (error) {
      console.error("Error getting news items:", error);
      res.status(500).json({ error: "Failed to get news items" });
    }
  });

  app.post("/api/news-sources/:id/fetch", async (req, res) => {
    try {
      const source = await storage.getNewsSource(req.params.id, req.session.userId!);
      if (!source) {
        return res.status(404).json({ error: "News source not found" });
      }
      
      const fetchedItems = await fetchNewsFromSource(source);
      const savedItems = [];
      
      for (const item of fetchedItems) {
        try {
          const saved = await storage.createNewsItem({
            userId: req.session.userId,
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

      const ctx = await buildStationContext(req.session.userId);
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
      const anthropic = await getAnthropicClient(req.session.userId);

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(512),
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
        await storage.updateDialog(dialogId, req.session.userId!, {
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

      const settings = await storage.getSettings(req.session.userId);
      const basePrompt = prompt || settings?.defaultPrompt || "";

      const dateObj = new Date(date);
      const jsDay = dateObj.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;
      const template = await storage.getTemplateForWeekday(weekday, req.session.userId!);

      let dailyCount: number;
      if (count) {
        dailyCount = count;
      } else if (template) {
        const isOvn = template.endHour <= template.startHour;
        const hrs = isOvn ? (24 - template.startHour + template.endHour) : (template.endHour - template.startHour);
        dailyCount = hrs * template.slotsPerHour;
      } else {
        dailyCount = settings?.dailyDialogsCount || 12;
      }

      const userBatch = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLangBatch = userBatch?.language || "en";
      const psBatch = getPromptStrings(userLangBatch);

      const holidayInfoStr = getHolidayInfo(date);
      const holidayContext = holidayInfoStr
        ? (userLangBatch === "ru" ? `\nСегодня праздник: ${holidayInfoStr}. Учти это в диалогах.` : `\nToday's holiday: ${holidayInfoStr}. Incorporate this into the dialogs.`)
        : "";

      const ctx = await buildStationContext(req.session.userId, userLangBatch);
      const systemPrompt = `${psBatch.langDirective}
${psBatch.scriptWriter} "${ctx.stationName}".
${ctx.stationDescription ? psBatch.aboutStation(ctx.stationDescription) : ""}${holidayContext}
${ctx.knowledgeBase ? `\n${psBatch.knowledgeBase}\n${ctx.knowledgeBase}\n` : ""}
${psBatch.dialogTask(ctx.malePersona, ctx.femalePersona)}
${psBatch.dialogLang}
${psBatch.dialogDuration}
Create ${dailyCount} different short dialogs with diverse topics.

IMPORTANT: Response in JSON array format:
{
  "dialogs": [
    {
      "title": "short topic name",
      "maleText": "all lines for ${ctx.malePersona}",
      "femaleText": "all lines for ${ctx.femalePersona}"
    }
  ]
}

Create exactly ${dailyCount} dialogs.`;

      const anthropic = await getAnthropicClient(req.session.userId);
      let dialogsData: { dialogs: Array<{ title: string; maleText: string; femaleText: string }> };

      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(4096),
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
          userId: req.session.userId,
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
        ? [await storage.getNewsSource(sourceId, req.session.userId!)].filter(Boolean)
        : await storage.getNewsSources(req.session.userId!);
      
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

  app.get("/api/ad-clients", async (req, res) => {
    try {
      const clients = await storage.getAdClients(req.session.userId!);
      res.json(clients);
    } catch (error) {
      console.error("Error getting ad clients:", error);
      res.status(500).json({ error: "Failed to get ad clients" });
    }
  });

  app.get("/api/ad-clients/:id", async (req, res) => {
    try {
      const client = await storage.getAdClient(req.params.id, req.session.userId!);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error getting ad client:", error);
      res.status(500).json({ error: "Failed to get ad client" });
    }
  });

  app.post("/api/ad-clients", async (req, res) => {
    try {
      const parsed = insertAdClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const client = await storage.createAdClient({ ...parsed.data, userId: req.session.userId });
      res.json(client);
    } catch (error) {
      console.error("Error creating ad client:", error);
      res.status(500).json({ error: "Failed to create ad client" });
    }
  });

  app.patch("/api/ad-clients/:id", async (req, res) => {
    try {
      const partialSchema = insertAdClientSchema.partial();
      const parsed = partialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const updated = await storage.updateAdClient(req.params.id, req.session.userId!, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating ad client:", error);
      res.status(500).json({ error: "Failed to update ad client" });
    }
  });

  app.delete("/api/ad-clients/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAdClient(req.params.id, req.session.userId!);
      if (!deleted) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting ad client:", error);
      res.status(500).json({ error: "Failed to delete ad client" });
    }
  });

  app.get("/api/ad-presets", async (req, res) => {
    try {
      const presets = await storage.getAdPresets(req.session.userId!);
      res.json(presets);
    } catch (error) {
      console.error("Error getting ad presets:", error);
      res.status(500).json({ error: "Failed to get ad presets" });
    }
  });

  app.get("/api/ad-presets/:id", async (req, res) => {
    try {
      const preset = await storage.getAdPreset(req.params.id, req.session.userId!);
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
      const preset = await storage.createAdPreset({ ...parsed.data, userId: req.session.userId });
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
      const updated = await storage.updateAdPreset(req.params.id, req.session.userId!, parsed.data);
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
      const deleted = await storage.deleteAdPreset(req.params.id, req.session.userId!);
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
      const adsList = await storage.getAds(req.session.userId!);
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
      const ad = await storage.createAd({ ...parsed.data, userId: req.session.userId });
      res.json(ad);
    } catch (error) {
      console.error("Error creating ad:", error);
      res.status(500).json({ error: "Failed to create ad" });
    }
  });

  app.patch("/api/ads/:id", async (req, res) => {
    try {
      const updated = await storage.updateAd(req.params.id, req.session.userId!, req.body);
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
      const deleted = await storage.deleteAd(req.params.id, req.session.userId!);
      if (!deleted) {
        return res.status(404).json({ error: "Ad not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting ad:", error);
      res.status(500).json({ error: "Failed to delete ad" });
    }
  });

  const validAdCategories = new Set(["general", "restaurant", "real_estate", "services", "shop", "events"]);
  function sanitizeParseResult(raw: Record<string, unknown>) {
    const dur = typeof raw.targetDurationSeconds === "number"
      ? raw.targetDurationSeconds
      : parseInt(String(raw.targetDurationSeconds), 10) || 30;
    const cat = typeof raw.category === "string" && validAdCategories.has(raw.category)
      ? raw.category : "general";
    return {
      clientName: typeof raw.clientName === "string" ? raw.clientName.trim() : "",
      websiteUrl: typeof raw.websiteUrl === "string" ? raw.websiteUrl.trim() : "",
      instagramUrl: typeof raw.instagramUrl === "string" ? raw.instagramUrl.trim() : "",
      category: cat,
      targetDurationSeconds: Math.max(10, Math.min(120, dur)),
      description: typeof raw.description === "string" ? raw.description.trim() : "",
    };
  }

  app.post("/api/ads/parse-prompt-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const text = (req.body.text || "").trim();
      const user = await storage.getUser(req.session.userId!);
      const userLang = user?.language || "en";
      const ps = getPromptStrings(userLang);

      const imageBuffer = await fs.readFile(req.file.path);
      const base64Image = imageBuffer.toString("base64");
      const mediaType = req.file.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      const systemPrompt = `${ps.langDirective}
You are an assistant that extracts structured ad brief data from an image (and optional text).
Analyze the image carefully using computer vision. Extract all visible text, logos, brand names, contact info, social media handles, website URLs, phone numbers, and product/service descriptions.

Return a JSON object with these fields (leave empty string "" if not found):
{
  "clientName": "business/client name from logo or text",
  "websiteUrl": "website URL if visible",
  "instagramUrl": "Instagram handle if visible (with @)",
  "category": "one of: general, restaurant, real_estate, services, shop, events",
  "targetDurationSeconds": 30,
  "description": "comprehensive description of what to advertise based on the image content and any provided text"
}

Be thorough: read ALL text on the image, identify the business type from visual cues (food photos = restaurant, property photos = real_estate, etc.).
Return ONLY valid JSON, no extra text.`;

      const anthropic = await getAnthropicClient(req.session.userId);
      if (anthropic) {
        const userContent: Array<{ type: string; source?: any; text?: string }> = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Image,
            },
          },
        ];
        if (text) {
          userContent.push({ type: "text", text: `Additional context from user: ${text}` });
        }

        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(1024),
          system: systemPrompt,
          messages: [{ role: "user", content: userContent as any }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from AI" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format" });
        }

        const parsed = JSON.parse(jsonMatch[0]);
        logUsage(req.session.userId!, "ad_parse_image", "Claude");
        await fs.unlink(req.file.path).catch(() => {});
        return res.json(sanitizeParseResult(parsed));
      }

      const dataUrl = `data:${mediaType};base64,${base64Image}`;
      const messages: any[] = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: text ? `Additional context: ${text}\n\n${systemPrompt}` : systemPrompt },
          ],
        },
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages,
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const parsed = JSON.parse(content);
      logUsage(req.session.userId!, "ad_parse_image", "OpenAI");
      await fs.unlink(req.file.path).catch(() => {});
      res.json(sanitizeParseResult(parsed));
    } catch (error) {
      console.error("Error parsing image:", error);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Failed to parse image" });
    }
  });

  app.post("/api/ads/parse-prompt", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || text.length < 5) {
        return res.status(400).json({ error: "Text is required" });
      }

      const user = await storage.getUser(req.session.userId!);
      const userLang = user?.language || "en";
      const ps = getPromptStrings(userLang);

      const systemPrompt = `${ps.langDirective}
You are an assistant that extracts structured ad brief data from free-form text.
The user describes what they want to advertise. Extract as much information as possible.

Return a JSON object with these fields (leave empty string "" if not found):
{
  "clientName": "business/client name",
  "websiteUrl": "website URL if mentioned",
  "instagramUrl": "Instagram handle if mentioned (with @)",
  "category": "one of: general, restaurant, real_estate, services, shop, events",
  "targetDurationSeconds": number (default 30 if not mentioned),
  "description": "the core ad description/brief, cleaned up and structured"
}

Be smart: if the user mentions a restaurant name, set category to "restaurant". If they mention a shop or store, set category to "shop", etc. Try to find website and Instagram even if not explicitly labeled. If the user mentions duration like "30 seconds" or "15 sec", extract it.

Return ONLY valid JSON, no extra text.`;

      const anthropic = await getAnthropicClient(req.session.userId);
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(512),
          system: systemPrompt,
          messages: [{ role: "user", content: text }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from AI" });
        }

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Invalid response format" });
        }

        const parsed = JSON.parse(jsonMatch[0]);
        logUsage(req.session.userId!, "ad_parse_prompt", "Claude");
        return res.json(sanitizeParseResult(parsed));
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 512,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const parsed = JSON.parse(content);
      logUsage(req.session.userId!, "ad_parse_prompt", "OpenAI");
      res.json(sanitizeParseResult(parsed));
    } catch (error) {
      console.error("Error parsing ad prompt:", error);
      res.status(500).json({ error: "Failed to parse prompt" });
    }
  });

  app.post("/api/generate-ad", async (req, res) => {
    try {
      const { prompt, clientName, category } = req.body;
      if (!prompt || prompt.length < 10) {
        return res.status(400).json({ error: "Prompt is required and must be at least 10 characters" });
      }

      const ctx = await buildStationContext(req.session.userId);
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

      const anthropic = await getAnthropicClient(req.session.userId);
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(1024),
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
          userId: req.session.userId,
          title: parsed.title || "Реклама",
          clientName: clientName || null,
          prompt: prompt,
          scriptText: parsed.scriptText || `${parsed.maleText || ""}\n\n${parsed.femaleText || ""}`,
          status: "draft",
          stage: "prompt",
          category: category || "general",
        });

        logUsage(req.session.userId!, "ad_generation", "Claude");
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
        userId: req.session.userId,
        title: parsed.title || "Реклама",
        clientName: clientName || null,
        prompt: prompt,
        scriptText: parsed.scriptText || `${parsed.maleText || ""}\n\n${parsed.femaleText || ""}`,
        status: "draft",
        stage: "prompt",
        category: category || "general",
      });

      logUsage(req.session.userId!, "ad_generation", "OpenAI");
      res.json(ad);
    } catch (error) {
      console.error("Error generating ad:", error);
      res.status(500).json({ error: "Failed to generate ad" });
    }
  });

  /**
   * One call takes an ad from its materials to a finished, music-bedded spot:
   * script → voice → music → mix. Runs as a durable job, so a restart resumes
   * instead of losing the work; follow it via GET /api/jobs/:id.
   */
  app.post("/api/ads/:id/produce", async (req, res) => {
    try {
      const ad = await storage.getAd(req.params.id, req.session.userId!);
      if (!ad) return res.status(404).json({ error: "Ad not found" });

      const { voiceIds, speakerVoiceMap, skipMusic } = req.body || {};

      const job = await enqueueJob({
        type: "ad.produce",
        userId: req.session.userId!,
        // Producing costs real money at every step; do not silently retry it.
        maxAttempts: 1,
        payload: {
          userId: req.session.userId!,
          adId: ad.id,
          voiceIds: voiceIds || ad.voiceIds || undefined,
          speakerVoiceMap,
          skipMusic: !!skipMusic,
        },
      });

      await storage.updateAd(ad.id, req.session.userId!, { status: "generating", stage: "producing" });

      res.status(202).json({
        jobId: job.id,
        status: "queued",
        message: "Ролик собирается: сценарий, озвучка, музыка, сведение.",
      });
    } catch (error) {
      console.error("Error starting ad production:", error);
      res.status(500).json({ error: "Failed to start ad production" });
    }
  });

  app.post("/api/ads/:id/generate-variants", async (req, res) => {
    try {
      const { id } = req.params;
      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      const { variantsCount = 5 } = req.body;
      const user = await storage.getUser(req.session.userId!);
      const userLang = user?.language || "en";
      const ctx = await buildStationContext(req.session.userId, userLang);
      
      const speakersCount = ad.speakersCount || 1;
      const isMultiSpeaker = speakersCount > 1;

      // A recurring client carries standing info (services, contacts) and past
      // scripts that define the voice of their ads — feed both to the model so
      // this week's spot sounds like last week's.
      let clientInfoBlock = "";
      let styleExamplesBlock = "";
      if (ad.clientId) {
        const adClient = await storage.getAdClient(ad.clientId, req.session.userId!);
        if (adClient) {
          const infoLines = [
            adClient.description || "",
            adClient.phone ? (userLang === "ru" ? `Телефон: ${adClient.phone}` : `Phone: ${adClient.phone}`) : "",
          ].filter(Boolean);
          if (infoLines.length > 0) {
            clientInfoBlock = userLang === "ru"
              ? `\nПостоянная информация о клиенте:\n${infoLines.join("\n")}`
              : `\nStanding client information:\n${infoLines.join("\n")}`;
          }
          const pastScripts = (await storage.getAdsByClient(ad.clientId, req.session.userId!))
            .filter(a => a.id !== ad.id && a.selectedVariantText)
            .slice(0, 3)
            .map(a => (a.selectedVariantText || "").slice(0, 1500));
          if (pastScripts.length > 0) {
            styleExamplesBlock = userLang === "ru"
              ? `\nПрошлые ролики этого клиента — образец стиля. Сохраняй ту же подачу, структуру, форматирование и эмоциональные теги в квадратных скобках:\n${pastScripts.map((s, i) => `--- Пример ${i + 1} ---\n${s}`).join("\n")}`
              : `\nPast ads for this client — style reference. Keep the same delivery, structure, formatting and bracketed emotion tags:\n${pastScripts.map((s, i) => `--- Example ${i + 1} ---\n${s}`).join("\n")}`;
          }
        }
      }

      let multiSpeakerInstructions = "";
      if (isMultiSpeaker) {
        if (userLang === "ru") {
          multiSpeakerInstructions = `
ФОРМАТ МУЛЬТИСПИКЕР: Каждый вариант ОБЯЗАН использовать формат с ${speakersCount} дикторами.
Каждая реплика начинается с тега [Имя Диктора]: (имена должны быть реалистичными).
Добавляй эмоциональные теги в квадратных скобках перед текстом реплики для TTS: [energetic], [excited], [warm], [calm], [dramatic], [playful], [serious], [confident], [surprised], [happy].
Пример формата:
[Алексей]: [energetic] Друзья, у нас невероятные новости!
[Марина]: [excited] Да, это нечто! Впервые в нашем городе...
[Алексей]: [warm] И не забудьте — только до конца недели!`;
        } else {
          multiSpeakerInstructions = `
MULTI-SPEAKER FORMAT: Each variant MUST use ${speakersCount} speakers format.
Each line starts with [Speaker Name]: tag (use realistic names).
Add emotion tags in brackets before the spoken text for TTS: [energetic], [excited], [warm], [calm], [dramatic], [playful], [serious], [confident], [surprised], [happy].
Example format:
[Alex]: [energetic] Hey everyone, we've got incredible news!
[Sarah]: [excited] Yes, this is amazing! For the first time in our city...
[Alex]: [warm] And remember — only until the end of the week!`;
        }
      }
      
      const systemPrompt = userLang === "ru" 
        ? `Ты - креативный копирайтер для радио "${ctx.stationName}".
Твоя задача - создать ${variantsCount} РАЗНЫХ вариантов рекламного ролика.

Информация о рекламе:
- Описание: ${ad.prompt}
${ad.websiteUrl ? `- Сайт: ${ad.websiteUrl}` : ""}
${ad.instagramUrl ? `- Instagram: ${ad.instagramUrl}` : ""}
${ad.clientName ? `- Клиент: ${ad.clientName}` : ""}
- Целевая длительность: ${ad.targetDurationSeconds || 30} секунд при чтении
${clientInfoBlock}
${styleExamplesBlock}
${multiSpeakerInstructions}

Каждый вариант должен быть уникальным по стилю и подаче:
1. Вариант с юмором
2. Эмоциональный вариант
3. Информационный вариант
4. Динамичный вариант
5. Нестандартный/креативный вариант

ВАЖНО: Ответ в формате JSON:
{
  "variants": [
    "Полный текст варианта 1...",
    "Полный текст варианта 2...",
    "Полный текст варианта 3...",
    "Полный текст варианта 4...",
    "Полный текст варианта 5..."
  ],
  "speakersCount": ${speakersCount}
}`
        : `You are a creative copywriter for radio station "${ctx.stationName}".
Your task is to create ${variantsCount} DIFFERENT variants of a radio ad.

Ad information:
- Description: ${ad.prompt}
${ad.websiteUrl ? `- Website: ${ad.websiteUrl}` : ""}
${ad.instagramUrl ? `- Instagram: ${ad.instagramUrl}` : ""}
${ad.clientName ? `- Client: ${ad.clientName}` : ""}
- Target duration: ${ad.targetDurationSeconds || 30} seconds when read aloud
${clientInfoBlock}
${styleExamplesBlock}
${multiSpeakerInstructions}

Each variant should be unique in style and delivery:
1. Humorous variant
2. Emotional variant
3. Informational variant
4. Dynamic variant
5. Creative/unconventional variant

IMPORTANT: Response in JSON format:
{
  "variants": [
    "Full text of variant 1...",
    "Full text of variant 2...",
    "Full text of variant 3...",
    "Full text of variant 4...",
    "Full text of variant 5..."
  ],
  "speakersCount": ${speakersCount}
}`;

      const anthropic = await getAnthropicClient(req.session.userId);
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(4096),
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
        
        const updated = await storage.updateAd(id, req.session.userId!, {
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
      
      const updated = await storage.updateAd(id, req.session.userId!, {
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
      
      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.variants || variantIndex >= ad.variants.length) {
        return res.status(400).json({ error: "Invalid variant index" });
      }

      const updated = await storage.updateAd(id, req.session.userId!, {
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
      
      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      const userRegen = await storage.getUser(req.session.userId!);
      const userLangRegen = userRegen?.language || "en";
      const ctx = await buildStationContext(req.session.userId, userLangRegen);
      
      const isMultiSpeakerBase = isMultiSpeakerScript(baseText);
      const multiSpeakerNote = isMultiSpeakerBase
        ? (userLangRegen === "ru"
          ? "\nВАЖНО: Сохрани формат мультиспикер с тегами [Имя Диктора]: и эмоциональными тегами [energetic], [excited] и т.д."
          : "\nIMPORTANT: Keep the multi-speaker format with [Speaker Name]: tags and emotion tags [energetic], [excited] etc.")
        : "";
      
      const systemPrompt = userLangRegen === "ru"
        ? `Ты - креативный копирайтер для радио "${ctx.stationName}".
Тебе дан текст рекламного ролика. Нужно создать новый вариант на его основе.

Исходный текст:
${baseText}

Инструкции по изменению:
${instructions || "Создай альтернативный вариант с другой подачей"}
${multiSpeakerNote}

ВАЖНО: Верни только новый текст рекламы без JSON обертки.`
        : `You are a creative copywriter for radio station "${ctx.stationName}".
You are given a radio ad text. Create a new variant based on it.

Original text:
${baseText}

Modification instructions:
${instructions || "Create an alternative variant with a different style"}
${multiSpeakerNote}

IMPORTANT: Return only the new ad text without any JSON wrapping.`;

      const anthropic = await getAnthropicClient(req.session.userId);
      
      if (anthropic) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(1024),
          system: systemPrompt,
          messages: [{ role: "user", content: "Создай новый вариант" }],
        });

        const textContent = response.content.find(c => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          return res.status(500).json({ error: "No response from Claude" });
        }

        const newVariant = textContent.text.trim();
        const variants = [...(ad.variants || []), newVariant];
        
        const updated = await storage.updateAd(id, req.session.userId!, { variants });
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
      const updated = await storage.updateAd(id, req.session.userId!, { variants });
      
      res.json({ variant: newVariant, ad: updated });
    } catch (error) {
      console.error("Error regenerating variant:", error);
      res.status(500).json({ error: "Failed to regenerate variant" });
    }
  });

  /**
   * Ad voice synthesis, as a durable job. It used to run as a detached
   * `(async () => {})()`: a restart mid-render lost the work and left the ad
   * stuck on status "generating" with nothing to retry.
   */
  registerJobHandler("ad.synthesize-audio", async (payload: {
    adId: string; userId: string; voiceIds?: string[];
    speakerVoiceMap?: Record<string, string>; scriptText?: string; voiceName?: string;
  }) => {
    const { adId: id, userId, voiceIds, speakerVoiceMap: reqSpeakerVoiceMap, voiceName: requestVoiceName } = payload;

    const ad = await storage.getAd(id, userId);
    if (!ad) throw new Error(`Ad ${id} not found`);

    const settings = await storage.getSettings(userId);
    if (!settings?.elevenLabsApiKey) throw new Error("ElevenLabs API key not configured");

    const scriptText = payload.scriptText || ad.selectedVariantText;
    if (!scriptText) throw new Error("No script to synthesise");
    const defaultVoiceId = voiceIds?.[0] || settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9";
    const isMultiSpeaker = isMultiSpeakerScript(scriptText);

        try {
          const audioDir = path.join(process.cwd(), "public", "audio");
          await fs.mkdir(audioDir, { recursive: true });
          const timestamp = Date.now();

          const adTtsStability = settings.ttsStability ?? 0.75;
          const adTtsSimilarityBoost = settings.ttsSimilarityBoost ?? 0.75;

          let finalAudioFile: string;
          let voiceNameForVersion: string;

          if (isMultiSpeaker) {
            const segments = parseMultiSpeakerScript(scriptText);
            const spkVoiceMap: Record<string, string> = reqSpeakerVoiceMap || {};

            const allVoices = await storage.getVoices(userId);
            const voiceNameMap = new Map<string, string>();
            for (const v of allVoices) {
              voiceNameMap.set(v.elevenLabsVoiceId, v.personaName || v.name);
            }

            const segmentFiles: string[] = [];
            const segmentSpeakers: string[] = [];
            const usedVoiceNames: string[] = [];

            for (let i = 0; i < segments.length; i++) {
              const seg = segments[i];
              const cleanText = stripEmotionTags(seg.text);
              if (!cleanText.trim()) continue;

              let segVoiceId = spkVoiceMap[seg.speaker] || defaultVoiceId;
              
              if (!spkVoiceMap[seg.speaker]) {
                for (const v of allVoices) {
                  const cleanName = getCleanVoiceName(v);
                  if (
                    cleanName.toLowerCase() === seg.speaker.toLowerCase() ||
                    seg.speaker.toLowerCase().includes(cleanName.toLowerCase()) ||
                    cleanName.toLowerCase().includes(seg.speaker.toLowerCase())
                  ) {
                    segVoiceId = v.elevenLabsVoiceId;
                    break;
                  }
                }
              }

              const segBuffer = await synthesizeSpeech({
                apiKey: settings.elevenLabsApiKey!,
                voiceId: segVoiceId,
                text: cleanText,
                stability: adTtsStability,
                similarityBoost: adTtsSimilarityBoost,
              });
              const segFile = path.join(audioDir, `_ad_seg_${timestamp}_${i}.mp3`);
              await fs.writeFile(segFile, segBuffer);
              segmentFiles.push(segFile);
              segmentSpeakers.push(seg.speaker);

              const vName = voiceNameMap.get(segVoiceId) || segVoiceId;
              if (!usedVoiceNames.includes(vName)) usedVoiceNames.push(vName);
            }

            finalAudioFile = path.join(audioDir, `ad_${id}_${timestamp}.mp3`);
            await concatMp3WithFfmpeg(segmentFiles, finalAudioFile, audioDir, timestamp, segmentSpeakers);

            for (const sf of segmentFiles) {
              await fs.unlink(sf).catch(() => {});
            }

            voiceNameForVersion = usedVoiceNames.join(" + ");
          } else {
            const audioBuffer = await synthesizeSpeech({
              apiKey: settings.elevenLabsApiKey!,
              voiceId: defaultVoiceId,
              text: scriptText,
              stability: adTtsStability,
              similarityBoost: adTtsSimilarityBoost,
            });
            finalAudioFile = path.join(audioDir, `ad_${id}_${timestamp}.mp3`);
            await fs.writeFile(finalAudioFile, audioBuffer);

            const allVoices = await storage.getVoices(userId);
            const usedVoice = allVoices.find(v => v.elevenLabsVoiceId === defaultVoiceId);
            voiceNameForVersion = usedVoice ? (usedVoice.personaName || usedVoice.name) : (requestVoiceName || defaultVoiceId);
          }

          const newAudioUrl = `/audio/ad_${id}_${timestamp}.mp3`;
          const fileStats = await fs.stat(finalAudioFile);
          const estimatedDuration = Math.round(fileStats.size / 24000);

          const freshAd = await storage.getAd(id, userId);
          let existingVersions: Array<{ url: string; voiceId: string; voiceName: string; createdAt: string; duration: number }> = [];
          try {
            if (freshAd?.audioVersions) {
              const parsed = JSON.parse(freshAd.audioVersions);
              if (Array.isArray(parsed)) existingVersions = parsed;
            }
          } catch {}

          existingVersions.push({
            url: newAudioUrl,
            voiceId: defaultVoiceId,
            voiceName: voiceNameForVersion,
            createdAt: new Date().toISOString(),
            duration: estimatedDuration,
          });

          await storage.updateAd(id, userId, {
            audioUrl: newAudioUrl,
            audioVersions: JSON.stringify(existingVersions),
            duration: estimatedDuration,
            status: "ready",
            stage: "audio",
          });

          void archiveAudio({ userId, audioUrl: newAudioUrl, folder: "/radio/ads" }).then(archived => {
            if (archived.error) console.error(`[archive] ad ${id}: ${archived.error}`);
          });

          console.log(`Audio generated for ad ${id} (version ${existingVersions.length})${isMultiSpeaker ? " [multi-speaker]" : ""}`);
        } catch (error) {
          console.error(`Error generating audio for ad ${id}:`, error);
          await storage.updateAd(id, userId, { status: "error" });
        }
    return { adId: id };
  });

  app.post("/api/ads/:id/synthesize-audio", async (req, res) => {
    try {
      const { id } = req.params;
      const { voiceIds, voiceName: requestVoiceName, speakerVoiceMap: reqSpeakerVoiceMap, scriptText: editedScriptText } = req.body;
      
      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.selectedVariantText && !editedScriptText) {
        return res.status(400).json({ error: "No variant selected" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      if (editedScriptText && editedScriptText !== ad.selectedVariantText) {
        await storage.updateAd(id, req.session.userId!, { selectedVariantText: editedScriptText });
      }

      const defaultVoiceId = voiceIds?.[0] || settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9";
      const scriptText = editedScriptText || ad.selectedVariantText;
      const isMultiSpeaker = isMultiSpeakerScript(scriptText);

      if (reqSpeakerVoiceMap) {
        await storage.updateAd(id, req.session.userId!, { 
          status: "generating", 
          voiceIds, 
          speakerVoiceMap: JSON.stringify(reqSpeakerVoiceMap) 
        });
      } else {
        await storage.updateAd(id, req.session.userId!, { status: "generating", voiceIds });
      }

      const job = await enqueueJob({
        type: "ad.synthesize-audio",
        userId: req.session.userId!,
        // Synthesis bills per character at ElevenLabs — never retry silently.
        maxAttempts: 1,
        payload: {
          adId: id,
          userId: req.session.userId!,
          voiceIds,
          speakerVoiceMap: reqSpeakerVoiceMap,
          scriptText,
          voiceName: requestVoiceName,
        },
      });
      res.json({ message: "Audio generation started", jobId: job.id });
    } catch (error) {
      console.error("Error starting audio synthesis:", error);
      res.status(500).json({ error: "Failed to start audio synthesis" });
    }
  });

  app.delete("/api/ads/:id/audio-version/:versionIndex", async (req, res) => {
    try {
      const { id, versionIndex } = req.params;
      const idx = parseInt(versionIndex);
      if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: "Invalid version index" });
      }

      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) return res.status(404).json({ error: "Ad not found" });

      let versions: Array<{ url: string; voiceId: string; voiceName: string; createdAt: string; duration: number }> = [];
      try {
        if (ad.audioVersions) {
          const parsed = JSON.parse(ad.audioVersions);
          if (Array.isArray(parsed)) versions = parsed;
        }
      } catch {}

      if (idx >= versions.length) {
        return res.status(400).json({ error: "Invalid version index" });
      }

      const removedVersion = versions[idx];
      versions.splice(idx, 1);

      const updateData: any = { audioVersions: JSON.stringify(versions) };
      if (ad.audioUrl === removedVersion.url && versions.length > 0) {
        const lastVersion = versions[versions.length - 1];
        updateData.audioUrl = lastVersion.url;
        updateData.duration = lastVersion.duration;
      } else if (versions.length === 0) {
        updateData.audioUrl = null;
        updateData.duration = null;
        updateData.stage = "voices";
      }

      const updated = await storage.updateAd(id, req.session.userId!, updateData);

      try {
        const audioDir = path.resolve(process.cwd(), "public", "audio");
        const normalizedUrl = removedVersion.url.startsWith("/") ? removedVersion.url.slice(1) : removedVersion.url;
        const filePath = path.resolve(process.cwd(), "public", normalizedUrl);
        if (filePath.startsWith(audioDir) && filePath.includes("ad_")) {
          await fs.unlink(filePath);
        }
      } catch {}

      res.json(updated);
    } catch (error) {
      console.error("Error deleting audio version:", error);
      res.status(500).json({ error: "Failed to delete audio version" });
    }
  });

  app.get("/api/stream-audio/*", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
      const filePath = (req.params as Record<string, string>)[0];
      if (!filePath) {
        return res.status(400).json({ error: "Invalid path" });
      }
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(filePath);
      } catch {
        return res.status(400).json({ error: "Invalid path" });
      }
      // Containment check must happen on the fully decoded path: Express decodes
      // route params once, so a double-encoded "%252e%252e%252f" survives any
      // substring test done before this point.
      const audioRoot = path.resolve(process.cwd(), "public", "audio");
      const audioPath = path.resolve(audioRoot, decodedPath);
      if (audioPath !== audioRoot && !audioPath.startsWith(audioRoot + path.sep)) {
        return res.status(400).json({ error: "Invalid path" });
      }
      try {
        await fs.access(audioPath);
      } catch {
        // A republish recreates the deploy filesystem, losing generated files —
        // try to pull the file back from the cloud archive before giving up.
        const restored = await restoreAudio({ userId: req.session.userId!, audioUrl: decodedPath });
        if (!restored) {
          console.error(`Audio file not found: ${audioPath}`);
          return res.status(404).json({ error: "Audio file not found", path: decodedPath });
        }
      }
      const fileStat = await fs.stat(audioPath);
      const fileSize = fileStat.size;
      const range = req.headers.range;
      const { createReadStream } = await import("fs");
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "audio/mpeg",
        });
        createReadStream(audioPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "audio/mpeg",
          "Accept-Ranges": "bytes",
        });
        createReadStream(audioPath).pipe(res);
      }
    } catch (error) {
      console.error("Error streaming audio:", error);
      res.status(500).json({ error: "Failed to stream audio" });
    }
  });

  app.get("/api/ads/:id/download-audio", async (req, res) => {
    try {
      const ad = await storage.getAd(req.params.id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }
      if (!ad.audioUrl) {
        return res.status(404).json({ error: "No audio file" });
      }

      const normalizedUrl = ad.audioUrl.startsWith("/") ? ad.audioUrl.slice(1) : ad.audioUrl;
      const audioPath = path.join(process.cwd(), "public", normalizedUrl);

      try {
        await fs.access(audioPath);
      } catch {
        const restored = await restoreAudio({ userId: req.session.userId!, audioUrl: ad.audioUrl });
        if (!restored) {
          return res.status(404).json({ error: "Audio file not found on disk" });
        }
      }

      const remuxed = await ensureRemuxed(audioPath);

      // Mark before streaming: the lists highlight already-downloaded ads.
      storage.updateAd(ad.id, req.session.userId!, { downloadedAt: new Date() })
        .catch(err => console.error("Could not mark ad downloaded:", err?.message));

      const filename = `${ad.title || "ad"}.mp3`;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);

      const { createReadStream } = await import("fs");
      const stream = createReadStream(remuxed);
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading ad audio:", error);
      res.status(500).json({ error: "Failed to download audio" });
    }
  });

  // The audio-stage download buttons are plain <a download> links straight to the
  // stream URL, so the download endpoint above never sees those clicks — the
  // client stamps the mark explicitly through this route.
  app.post("/api/ads/:id/mark-downloaded", async (req, res) => {
    try {
      const updated = await storage.updateAd(req.params.id, req.session.userId!, { downloadedAt: new Date() });
      if (!updated) {
        return res.status(404).json({ error: "Ad not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error marking ad downloaded:", error);
      res.status(500).json({ error: "Failed to mark ad downloaded" });
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

        const anthropic = await getAnthropicClient(req.session.userId);

        if (anthropic) {
          const response = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: aiMaxTokens(3000),
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
      const voicesList = await storage.getVoices(req.session.userId!);
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
      const voice = await storage.createVoice({ ...parsed.data, userId: req.session.userId });
      res.json(voice);
    } catch (error) {
      console.error("Error creating voice:", error);
      res.status(500).json({ error: "Failed to create voice" });
    }
  });

  app.post("/api/voices/reorder", async (req, res) => {
    try {
      const { orderedIds } = req.body as { orderedIds?: unknown };
      if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
        return res.status(400).json({ error: "orderedIds must be an array of strings" });
      }
      await storage.reorderVoices(req.session.userId!, orderedIds as string[]);
      res.json({ success: true });
    } catch (error) {
      console.error("Error reordering voices:", error);
      res.status(500).json({ error: "Failed to reorder voices" });
    }
  });

  app.patch("/api/voices/:id", async (req, res) => {
    try {
      const allowedFields = ["name", "gender", "isActive", "sortOrder", "description", "personaName", "assignedProgramTypeIds", "elevenLabsVoiceId", "previewUrl"];
      const updates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (key in req.body) {
          updates[key] = req.body[key];
        }
      }
      if (updates.gender && !["male", "female"].includes(updates.gender)) {
        return res.status(400).json({ error: "Gender must be 'male' or 'female'" });
      }
      const updated = await storage.updateVoice(req.params.id, req.session.userId!, updates);
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
      const deleted = await storage.deleteVoice(req.params.id, req.session.userId!);
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
      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      // /v1/voices returns a single truncated page, which is why large accounts
      // only ever saw part of their library. /v2/voices is paginated — walk it.
      const mapVoice = (v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
        description: v.description,
      });

      const collected: any[] = [];
      let nextPageToken: string | undefined;
      let usedFallback = false;

      for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({ page_size: "100" });
        if (nextPageToken) params.append("next_page_token", nextPageToken);

        const response = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
          headers: { "xi-api-key": settings.elevenLabsApiKey },
        });

        if (!response.ok) {
          if (page === 0 && (response.status === 404 || response.status === 400)) {
            usedFallback = true;
            break;
          }
          const error = await response.text();
          console.error("ElevenLabs API error:", response.status, error);
          if (page === 0) {
            return res.status(response.status).json({ error: "Failed to fetch voices from ElevenLabs" });
          }
          break; // keep whatever pages already succeeded
        }

        const data = await response.json();
        collected.push(...(data.voices || []).map(mapVoice));

        if (!data.has_more || !data.next_page_token) break;
        nextPageToken = data.next_page_token;
      }

      if (usedFallback) {
        const legacy = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": settings.elevenLabsApiKey },
        });
        if (!legacy.ok) {
          const error = await legacy.text();
          console.error("ElevenLabs API error (v1 fallback):", error);
          return res.status(legacy.status).json({ error: "Failed to fetch voices from ElevenLabs" });
        }
        const legacyData = await legacy.json();
        collected.push(...(legacyData.voices || []).map(mapVoice));
      }

      res.json({ voices: collected, total: collected.length });
    } catch (error) {
      console.error("Error fetching ElevenLabs voices:", error);
      res.status(500).json({ error: "Failed to fetch voices from ElevenLabs" });
    }
  });

  app.post("/api/elevenlabs/voices/add-shared", async (req, res) => {
    try {
      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const { public_owner_id, voice_id, name } = req.body;
      if (!public_owner_id || !voice_id || !name) {
        return res.status(400).json({ error: "Missing required fields: public_owner_id, voice_id, name" });
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/voices/add/${public_owner_id}/${voice_id}`, {
        method: "POST",
        headers: {
          "xi-api-key": settings.elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          new_name: name,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ElevenLabs add shared voice error:", errorText);
        let detail = "Failed to add shared voice to account";
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.detail) {
            if (typeof parsed.detail === "string") {
              detail = parsed.detail;
            } else if (Array.isArray(parsed.detail)) {
              detail = parsed.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
            }
          }
        } catch {}
        return res.status(response.status).json({ error: detail });
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
      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const query = (req.query.q as string) || "";
      const gender = req.query.gender as string | undefined;
      const language = req.query.language as string | undefined;
      const accent = req.query.accent as string | undefined;
      const age = req.query.age as string | undefined;
      const useCase = req.query.use_case as string | undefined;
      const page = parseInt(req.query.page as string) || 0;
      const pageSize = 100;

      const params = new URLSearchParams({
        page_size: String(pageSize),
        page: String(page),
      });
      if (query) params.append("search", query);
      if (gender && gender !== "all") params.append("gender", gender);
      if (language && language !== "all") params.append("language", language);
      if (accent && accent !== "all") params.append("accent", accent);
      if (age && age !== "all") params.append("age", age);
      if (useCase && useCase !== "all") params.append("use_case", useCase);

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
      const types = await storage.getProgramTypes(req.session.userId);
      res.json(types);
    } catch (error) {
      console.error("Error fetching program types:", error);
      res.status(500).json({ error: "Failed to fetch program types" });
    }
  });

  app.post("/api/program-types", async (req, res) => {
    try {
      const programType = await storage.createProgramType({ ...req.body, userId: req.session.userId });
      res.json(programType);
    } catch (error: any) {
      console.error("Error creating program type:", error);
      const msg = error?.message || "";
      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
        res.status(409).json({ error: "A program type with this slug already exists" });
      } else {
        res.status(500).json({ error: "Failed to create program type" });
      }
    }
  });

  app.post("/api/program-types/reorder", async (req, res) => {
    try {
      const { orderedIds } = req.body as { orderedIds?: unknown };
      if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
        return res.status(400).json({ error: "orderedIds must be an array of strings" });
      }
      await storage.reorderProgramTypes(req.session.userId!, orderedIds as string[]);
      res.json({ success: true });
    } catch (error) {
      console.error("Error reordering program types:", error);
      res.status(500).json({ error: "Failed to reorder program types" });
    }
  });

  app.patch("/api/program-types/:id", async (req, res) => {
    try {
      const updated = await storage.updateProgramType(req.params.id, req.session.userId!, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Program type not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating program type:", error);
      const msg = error?.message || "";
      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
        res.status(409).json({ error: "A program type with this slug already exists" });
      } else {
        res.status(500).json({ error: "Failed to update program type" });
      }
    }
  });

  app.delete("/api/program-types/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProgramType(req.params.id, req.session.userId!);
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
        ? await storage.getProgramsByType(typeId, req.session.userId!)
        : await storage.getPrograms(req.session.userId!);
      res.json(programsList);
    } catch (error) {
      console.error("Error fetching programs:", error);
      res.status(500).json({ error: "Failed to fetch programs" });
    }
  });

  app.get("/api/programs/:id", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id, req.session.userId!);
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
      const program = await storage.createProgram({ ...req.body, userId: req.session.userId });
      res.json(program);
    } catch (error) {
      console.error("Error creating program:", error);
      res.status(500).json({ error: "Failed to create program" });
    }
  });

  // Ready-made scripts approved by the client: parse a document into
  // episodes without touching the AI prompt at all. Step 1 of 2 — returns
  // the parsed episodes for review; nothing is created yet.
  app.post("/api/program-types/:typeId/parse-scripts", upload.single("file"), async (req, res) => {
    let uploadedPath: string | null = req.file?.path || null;
    try {
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      let raw = "";
      if (uploadedPath) {
        const ext = path.extname(uploadedPath).toLowerCase();
        if (ext === ".docx") {
          const result = await mammoth.extractRawText({ path: uploadedPath });
          raw = result.value;
        } else if (ext === ".txt") {
          raw = await fs.readFile(uploadedPath, "utf-8");
        } else {
          return res.status(400).json({ error: "Поддерживаются файлы .docx и .txt" });
        }
      } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
        raw = req.body.text;
      } else {
        return res.status(400).json({ error: "Прикрепите файл или вставьте текст" });
      }

      const episodes = parseImportedScripts(raw);
      if (episodes.length === 0) {
        return res.status(400).json({ error: "Не удалось найти ни одного выпуска в тексте" });
      }
      res.json({ episodes });
    } catch (error) {
      console.error("Error parsing imported scripts:", error);
      res.status(500).json({ error: "Failed to parse scripts" });
    } finally {
      // The document is transient input, not content to serve.
      if (uploadedPath) await fs.unlink(uploadedPath).catch(() => {});
    }
  });

  // Step 2 of 2 — create programs from the (possibly trimmed) episode list.
  // Skips generation entirely: the text goes in verbatim as a ready script.
  app.post("/api/program-types/:typeId/import-scripts", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const bodySchema = z.object({
        episodes: z.array(z.object({
          title: z.string().min(1).max(300),
          scriptText: z.string().min(1).max(50000),
        })).min(1).max(100),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid episodes payload" });
      }

      const dateStr = new Date().toISOString().split("T")[0];
      const created = [];
      for (let i = 0; i < parsed.data.episodes.length; i++) {
        const ep = parsed.data.episodes[i];
        const title = ep.title.startsWith(programType.name)
          ? ep.title
          : `${programType.name}: ${ep.title}`;
        const program = await storage.createProgram({
          userId: req.session.userId,
          programTypeId: programType.id,
          title,
          prompt: null,
          scheduledDate: dateStr,
          slotNumber: i + 1,
          status: "script_ready",
          scriptText: ep.scriptText,
          scriptGeneratedAt: new Date(),
        });
        created.push(program);
      }
      res.json({ created: created.length, programs: created });
    } catch (error) {
      console.error("Error importing scripts:", error);
      res.status(500).json({ error: "Failed to import scripts" });
    }
  });

  app.patch("/api/programs/:id", async (req, res) => {
    try {
      const updated = await storage.updateProgram(req.params.id, req.session.userId!, req.body);
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
      const deleted = await storage.deleteProgram(req.params.id, req.session.userId!);
      if (!deleted) {
        return res.status(404).json({ error: "Program not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting program:", error);
      res.status(500).json({ error: "Failed to delete program" });
    }
  });

  async function fallbackWebSearch(query: string, limit: number = 5): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch("https://www.startpage.com/sp/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        body: `query=${encodeURIComponent(query)}&language=english`,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];
      const html = await response.text();
      const $ = cheerio.load(html);
      const results: string[] = [];

      const extractRealUrl = (href: string): string => {
        if (!href) return "";
        try {
          const u = new URL(href);
          const redirected = u.searchParams.get("url") || u.searchParams.get("u") || u.searchParams.get("q");
          if (redirected && redirected.startsWith("http")) return redirected;
        } catch {}
        return href;
      };

      $(".result, [class*='w-gl__result']").each((i, el) => {
        if (results.length >= limit) return false;
        const title = $(el).find("h2, h3").first().text().trim();
        if (!title || title.length < 5) return;
        let link = "";
        $(el).find("a[href]").each((_, a) => {
          if (link) return false;
          const raw = $(a).attr("href") || "";
          const real = extractRealUrl(raw);
          if (real.startsWith("http") && !real.includes("startpage.com")) {
            link = real;
          }
        });
        if (!link) return;
        let snippet = "";
        $(el).find("p").each((_, p) => {
          const t = $(p).text().trim();
          if (t.length > 30 && !snippet) {
            snippet = t.substring(0, 400);
          }
        });
        results.push(`${title}\n${link}\n${snippet}`);
      });

      console.log(`Startpage search for "${query}": ${results.length} results`);
      return results;
    } catch (err: any) {
      console.error("Startpage search error:", err.message);
      return [];
    }
  }

  async function firecrawlSearch(query: string, limit: number = 5): Promise<string[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY;

    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            limit,
            scrapeOptions: { formats: ["markdown"] },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(`Firecrawl search error: ${response.status} ${errorText}`);
        } else {
          const data = await response.json();
          console.log(`Firecrawl search for "${query}": ${(data.data || []).length} results`);
          const results: string[] = [];

          for (const item of (data.data || [])) {
            const content = item.markdown || item.description || "";
            if (content.trim()) {
              results.push(content.substring(0, 2000));
            }
          }

          if (results.length > 0) return results;
        }
      } catch (err: any) {
        console.error("Firecrawl search error:", err.message);
      }
    }

    console.log(`Firecrawl unavailable, falling back to Startpage for "${query}"`);
    return fallbackWebSearch(query, limit);
  }

  const INTL_LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-US", tr: "tr-TR" };

  /**
   * Weather, holidays and fresh news already existed, but each was wired into a
   * different endpoint, so a generic show had no idea what day it was and fell
   * back to timeless small talk ("so, coffee..."). This assembles the three into
   * one block every show can be grounded in.
   *
   * Returns "" when nothing real is known — an empty context block is worse than
   * none, because it invites the model to fill the gap with invention.
   */
  async function buildBroadcastContext(opts: {
    userId?: string;
    dateStr: string;
    lang: string;
    includeWeather: boolean;
  }): Promise<string> {
    const { userId, dateStr, lang, includeWeather } = opts;
    const isRu = lang === "ru";
    const locale = INTL_LOCALES[lang] || "en-US";
    const facts: string[] = [];

    try {
      const dayLabel = new Date(dateStr + "T12:00:00").toLocaleDateString(locale, {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      facts.push(isRu ? `Дата: ${dayLabel}` : `Date: ${dayLabel}`);
    } catch {
      facts.push(isRu ? `Дата: ${dateStr}` : `Date: ${dateStr}`);
    }

    if (includeWeather) {
      try {
        const weather = await fetchWeather();
        const idx = weather?.daily?.time?.findIndex(d => d === dateStr) ?? -1;
        if (weather?.daily && idx >= 0) {
          const tMax = Math.round(weather.daily.temperature_max[idx]);
          const tMin = Math.round(weather.daily.temperature_min[idx]);
          const desc = getWeatherDescription(weather.daily.weathercode?.[idx] ?? 0, lang);
          facts.push(isRu
            ? `Погода: днём до ${tMax}°C, ночью ${tMin}°C, ${desc}`
            : `Weather: high ${tMax}°C, low ${tMin}°C, ${desc}`);
        }
      } catch (e: any) {
        console.warn("[broadcast-context] weather unavailable:", e?.message);
      }
    }

    try {
      const custom = userId ? await getUserCustomHolidays(userId) : [];
      const holidays = getHolidaysForDate(dateStr, custom);
      if (holidays.length) {
        const names = holidays.map(h => (isRu ? h.nameRu || h.name : h.name)).filter(Boolean);
        if (names.length) {
          facts.push(isRu ? `Праздники сегодня: ${names.join(", ")}` : `Holidays today: ${names.join(", ")}`);
        }
      }
    } catch (e: any) {
      console.warn("[broadcast-context] holidays unavailable:", e?.message);
    }

    try {
      if (userId) {
        const news = await storage.getUnusedNewsItems(userId, 4);
        if (news.length) {
          const lines = news.map(n => {
            const summary = (n.summary || "").trim().replace(/\s+/g, " ").slice(0, 160);
            return `- ${n.title}${summary ? ` — ${summary}` : ""}`;
          });
          facts.push((isRu ? "Новости дня:\n" : "Today's news:\n") + lines.join("\n"));
        }
      }
    } catch (e: any) {
      console.warn("[broadcast-context] news unavailable:", e?.message);
    }

    // Just the date is not grounding — require at least one real-world fact.
    if (facts.length < 2) return "";

    return `\n\n${getPromptStrings(lang).broadcastContext(facts.join("\n"))}`;
  }

  type ResearchProfile = "local" | "academic" | "none";

  /**
   * Few-shot examples steer the generated queries hard, so each profile gets its
   * own. The previous single set was written for showbiz news, which is why a
   * psychology show never surfaced research papers.
   */
  function searchProfileInstructions(profile: ResearchProfile, year: number): string {
    if (profile === "academic") {
      return `На основе промпта передачи сгенерируй 4-6 поисковых запросов для поиска НАУЧНЫХ ИССЛЕДОВАНИЙ и публикаций.

ПРАВИЛА:
1. Ищи ИССЛЕДОВАНИЯ, НЕ новости и НЕ популярные статьи: "study", "research", "trial", "meta-analysis", "findings"
2. Запросы преимущественно НА АНГЛИЙСКОМ — основной язык научных публикаций
3. Добавляй свежесть: "${year}", "recent study", "new research"
4. Целься в источники: университеты, journals, PubMed, ScienceDaily, Nature, APA
5. Каждый запрос — конкретный МЕХАНИЗМ или СВЯЗЬ, а не общая тема

Примеры хороших запросов для психологии:
- "sleep quality cognitive performance study ${year}"
- "university research procrastination motivation findings"
- "meta-analysis social media anxiety ${year}"
- "APA new study habit formation"
- "ScienceDaily psychology memory research"

Плохие запросы (НЕ делай так): "психология новости", "интересные факты о психологии", "советы психолога"`;
    }

    return `На основе промпта передачи и станции сгенерируй 4-6 поисковых запросов для веб-поиска актуальных новостей.

ПРАВИЛА:
1. Запросы должны покрывать ВСЕ направления из промпта (если написано "мировой, турецкий, российский" — нужны запросы по КАЖДОМУ)
2. Запросы на РАЗНЫХ языках: английский для мировых тем, русский для российских, можно турецкий для турецких
3. Запросы должны находить СВЕЖИЕ новости (добавляй "${year}", "latest", "news", "today")
4. Каждый запрос — 3-6 слов, конкретный и поисковый
5. НЕ дублируй одну и ту же тему на разных языках

Примеры хороших запросов для шоу-бизнеса:
- "Hollywood celebrity news ${year}"
- "Turkish TV series stars ${year}"
- "российские звёзды новости сегодня"
- "Grammy Oscar awards ${year}"
- "турецкие сериалы актёры новости"`;
  }

  async function generateSmartSearchQueries(programPrompt: string, stationPrompt: string, topics: string[], userId?: string, profile: ResearchProfile = "local"): Promise<string[]> {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];

    const contextParts: string[] = [];
    if (stationPrompt) contextParts.push(`ПРОМПТ СТАНЦИИ:\n${stationPrompt.substring(0, 500)}`);
    if (programPrompt) contextParts.push(`ПРОМПТ ПЕРЕДАЧИ:\n${programPrompt.substring(0, 1500)}`);
    if (topics.length > 0) contextParts.push(`КЛЮЧЕВЫЕ СЛОВА: ${topics.join(", ")}`);

    const aiPrompt = `Дата: ${dateStr}

${contextParts.join("\n\n")}

${searchProfileInstructions(profile, today.getFullYear())}

Ответь JSON: {"queries": ["запрос1", "запрос2", ...]}`;

    try {
      const settingsData = await storage.getSettings(userId);
      let respText = "";

      const anthropicSearch = await getAnthropicClient(userId);
      if (anthropicSearch) {
        const response = await anthropicSearch.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(300),
          system: "Ты генерируешь поисковые запросы для веб-поиска. Отвечай ТОЛЬКО JSON.",
          messages: [{ role: "user", content: aiPrompt }],
        });
        respText = response.content[0].type === "text" ? response.content[0].text : "{}";
      } else {
        const openai = new OpenAI();
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 300,
          messages: [
            { role: "system", content: "Ты генерируешь поисковые запросы для веб-поиска. Отвечай ТОЛЬКО JSON." },
            { role: "user", content: aiPrompt },
          ],
        });
        respText = response.choices[0]?.message?.content || "{}";
      }

      const jsonMatch = respText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const cleanJson = jsonMatch ? jsonMatch[1].trim() : respText.trim();
      const parsed = JSON.parse(cleanJson);
      const queries = Array.isArray(parsed) ? parsed : (parsed.queries || []);
      console.log(`AI generated search queries: ${JSON.stringify(queries)}`);
      return queries.slice(0, 6);
    } catch (err: any) {
      console.error("Failed to generate smart search queries:", err.message);
      return topics.slice(0, 3);
    }
  }

  async function researchForProgram(topics: string[], programPrompt?: string, stationPrompt?: string, userId?: string, profile: ResearchProfile = "local"): Promise<string> {
    if (profile === "none") return "";

    const hasPromptContext = (programPrompt && programPrompt.length > 20) || (topics && topics.length > 0);
    if (!hasPromptContext) return "";

    let searchQueries: string[];
    if (programPrompt && programPrompt.length > 20) {
      searchQueries = await generateSmartSearchQueries(programPrompt, stationPrompt || "", topics || [], userId, profile);
    } else {
      searchQueries = topics.slice(0, 4);
    }

    if (searchQueries.length === 0) return "";

    const allResults: string[] = [];
    for (const query of searchQueries.slice(0, 6)) {
      const results = await firecrawlSearch(query, 3);
      allResults.push(...results);
    }

    if (allResults.length === 0) return "";

    return `\n\nАКТУАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА — ЕДИНСТВЕННЫЙ ИСТОЧНИК КОНКРЕТНЫХ ФАКТОВ:\n${allResults.map((r, i) => `--- Источник ${i + 1} ---\n${r}`).join("\n\n")}\n\nКАК ИСПОЛЬЗОВАТЬ ДАННЫЕ ИЗ ИНТЕРНЕТА:\n- ВПЛЕТАЙ факты и цифры в повествование ЕСТЕСТВЕННО, как часть истории: "Кстати, тут интересная цифра — ...", "Я нашёл, что..."\n- НЕ перечисляй факты списком — каждый факт должен быть частью связного рассказа\n- Используй КОНКРЕТНЫЕ данные (названия мест, географию, стороны света, расстояния, цены, цифры, даты) ТОЛЬКО если они есть в источниках выше\n- НЕ ВЫДУМЫВАЙ факты, которых нет в источниках. Если конкретного факта нет — НЕ придумывай его и НЕ заменяй «личным опытом ведущего»; скажи общими словами или вообще не упоминай\n- ОСОБЕННО про географию: если в источниках нет точного направления/расстояния до объекта относительно Алании — не указывай сторону света и расстояние\n- Привязывай факты к жизни слушателя: "Это значит, что для вас...", "На практике это выглядит так..."`;
  }

  app.post("/api/generate-search-topics", async (req, res) => {
    try {
      const { prompt, existingTopics } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt required" });

      const today = new Date();
      const dayOfWeek = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"][today.getDay()];
      const monthName = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"][today.getMonth()];
      const dateContext = `Сегодня: ${dayOfWeek}, ${today.getDate()} ${monthName} ${today.getFullYear()}`;

      const existingList = existingTopics?.length ? `\nУже есть темы: ${existingTopics.join(", ")}. Не дублируй их, предложи НОВЫЕ.` : "";

      const systemPrompt = `Ты — AI-продюсер контента для радиостанции. ${dateContext}

Проанализируй промпт радиостанции и предложи 4-8 поисковых запросов для Firecrawl.

ВАЖНО — запросы должны быть:
1. ВЕЧНОЗЕЛЁНЫЕ (работают круглый год) — не привязаны к конкретному месяцу/дате
2. Релевантные аудитории и локации станции
3. Разнообразные по категориям:
   - Местные новости и события (город/регион)
   - Погода и природа (без дат!)
   - Культура, еда, лайфстайл
   - Интересные факты для эфира
   - Полезная информация для аудитории
4. На языке, оптимальном для поиска (английский для международных тем, русский для русскоязычных)
5. БЕЗ указания месяцев, годов, конкретных дат — запросы должны работать всегда

Плохие примеры: "события март 2026", "новости январь 2025"
Хорошие примеры: "local events today", "best restaurants nearby", "weather forecast", "interesting facts"
${existingList}

Верни JSON: {"topics": ["запрос1", "запрос2", ...], "reasoning": "краткое объяснение выбора тем на русском"}`;

      const settingsData = await storage.getSettings(req.session?.userId);
      let respText: string;

      const anthropicTopics = await getAnthropicClient(req.session?.userId);
      if (anthropicTopics) {
        const response = await anthropicTopics.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(500),
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });
        respText = response.content[0].type === "text" ? response.content[0].text : "{}";
      } else {
        const openai = new OpenAI();
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 500,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        });
        respText = response.choices[0]?.message?.content || "{}";
      }

      const jsonMatch = respText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const cleanJson = jsonMatch ? jsonMatch[1].trim() : respText.trim();
      const parsed = JSON.parse(cleanJson);

      const topics = Array.isArray(parsed) ? parsed : parsed.topics || [];
      const reasoning = parsed.reasoning || "";

      res.json({ topics, reasoning });
    } catch (error) {
      console.error("Error generating search topics:", error);
      res.status(500).json({ error: "Failed to generate search topics" });
    }
  });

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
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) return res.status(404).json({ error: "Type not found" });

      const topics = req.body.topics || programType.firecrawlTopics || [];
      if (topics.length === 0 && !programType.defaultPrompt) return res.status(400).json({ error: "No topics configured" });

      const settingsForResearch = await storage.getSettings(req.session?.userId);
      const research = await researchForProgram(topics, programType.defaultPrompt || "", settingsForResearch?.defaultPrompt || "", req.session?.userId, (programType.researchProfile as ResearchProfile) || "local");
      res.json({ research, topicsUsed: topics });
    } catch (error) {
      console.error("Firecrawl research error:", error);
      res.status(500).json({ error: "Research failed" });
    }
  });

  app.post("/api/analyze-prompt", async (req, res) => {
    try {
      const { promptText } = req.body;
      if (!promptText || typeof promptText !== "string") {
        return res.status(400).json({ error: "promptText is required" });
      }

      const results: {
        urls: { url: string; status: string; contentLength: number; preview: string }[];
        speaker: string | null;
        hasEpisodeContent: boolean;
        totalContentLength: number;
        expandedPrompt: string;
      } = {
        urls: [],
        speaker: null,
        hasEpisodeContent: false,
        totalContentLength: 0,
        expandedPrompt: promptText,
      };

      results.speaker = extractSpeakerFromPrompt(promptText);
      results.hasEpisodeContent = promptText.length > 300
        && /(?:выпуск|[Сс] вами|[Пп]ривет.*программа|[Пп]рограмма.*[«"])/m.test(promptText)
        && /\n.{50,}\n/m.test(promptText);

      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = promptText.match(urlRegex);

      if (urls && urls.length > 0) {
        for (const url of urls.slice(0, 5)) {
          const { text, method } = await fetchUrlContent(url);

          if (text.length > 50) {
            results.urls.push({
              url,
              status: "ok",
              contentLength: text.length,
              preview: text.substring(0, 500),
            });
            results.totalContentLength += text.length;
            results.expandedPrompt = results.expandedPrompt.replace(url, `[контент загружен: ${text.length} символов из ${url} (${method})]\n\n${text.substring(0, 2000)}${text.length > 2000 ? "\n...(ещё " + (text.length - 2000) + " символов)" : ""}`);
          } else {
            results.urls.push({
              url,
              status: method.includes("error") ? method : method === "firecrawl_empty" ? "empty (JS-страница, Firecrawl не смог прочитать)" : "empty",
              contentLength: 0,
              preview: method === "firecrawl_empty" 
                ? "Страница рендерится JavaScript. Firecrawl не смог извлечь контент." 
                : "Не удалось извлечь контент",
            });
          }
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error("Analyze prompt error:", error);
      res.status(500).json({ error: "Analysis failed" });
    }
  });

  app.post("/api/programs/auto-create/:typeId", async (req, res) => {
    try {
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLang = user?.language || "en";
      const ps = getPromptStrings(userLang);

      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];

      const rawScheduledDate = (req.body?.scheduledDate ?? req.query?.scheduledDate);
      const reqScheduledDate = typeof rawScheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawScheduledDate)
        ? rawScheduledDate
        : null;
      // Regular shows can be produced months ahead (a September grid recorded
      // in August); weather stays capped at the forecast horizon — beyond it
      // there is simply no data to script from.
      let daysAhead = 0;
      if (reqScheduledDate) {
        const reqDateMs = new Date(reqScheduledDate + "T12:00:00Z").getTime();
        const todayMs = new Date(todayStr + "T12:00:00Z").getTime();
        const dayMs = 86400000;
        daysAhead = Math.round((reqDateMs - todayMs) / dayMs);
        const maxAheadDays = programType.isWeatherForecast ? 7 : 366;
        if (Number.isNaN(daysAhead) || daysAhead < 0 || daysAhead > maxAheadDays) {
          return res.status(400).json({
            error: programType.isWeatherForecast
              ? "scheduledDate must be within today..today+7 days"
              : "scheduledDate must be within today..today+366 days",
          });
        }
      }
      const dateStr = reqScheduledDate || todayStr;

      const clampDays = (n: number) => Math.min(7, Math.max(1, Math.round(n)));
      const rawForecastDays = (req.body?.forecastDays ?? req.query?.forecastDays);
      const reqForecastDays = Number.isFinite(Number(rawForecastDays))
        ? clampDays(Number(rawForecastDays))
        : clampDays(programType.defaultForecastDays || 1);
      const forecastDays = programType.isWeatherForecast ? reqForecastDays : 1;

      const existingPrograms = await storage.getProgramsByType(programType.id, req.session.userId!);
      const todayPrograms = existingPrograms.filter(p => p.scheduledDate === dateStr);
      const nextSlot = todayPrograms.length + 1;

      const slotDesc = programType.slotDescriptions?.[nextSlot - 1] || "";
      
      const rawPrompt = programType.defaultPrompt || "";
      const { prompt: expandedPrompt, fetchedContent } = await fetchAndExpandUrls(rawPrompt);
      let prompt = expandedPrompt;
      const hasUrlContent = !!fetchedContent;

      const voicesList = await storage.getVoices(req.session.userId!);
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      const voicePersonaNames = assignedVoices.length > 0
        ? assignedVoices.map((v: any) => getCleanVoiceName(v))
        : [];
      let speakerNames: string[];
      if (voicePersonaNames.length > 0) {
        speakerNames = voicePersonaNames;
      } else {
        let promptSpeaker = extractSpeakerFromPrompt(rawPrompt);
        if (!promptSpeaker && fetchedContent) {
          promptSpeaker = extractSpeakerFromPrompt(fetchedContent);
        }
        speakerNames = promptSpeaker ? [promptSpeaker] : [programType.name];
      }

      const fullText = rawPrompt + (fetchedContent || "");
      const hasEpisodeContent = fullText.length > 300 
        && /(?:выпуск|[Сс] вами|[Пп]ривет.*программа|[Пп]рограмма.*[«"]|episode|[Hh]ello.*show|[Ww]elcome.*program)/m.test(fullText)
        && /\n.{50,}\n/m.test(fullText);

      const fcKeywords = programType.firecrawlTopics?.length
        ? extractFirecrawlKeywords(programType.firecrawlTopics)
        : [];

      if (hasUrlContent) {
        prompt += `\n\n${ps.referenceEpisodes}${fetchedContent}`;
      }

      if (hasEpisodeContent || hasUrlContent) {
        prompt += `\n\n${ps.criticalImportant(programType.name, fcKeywords.length > 0 ? fcKeywords.join(", ") : "", speakerNames, speakerNames.length)}`;
      }

      if (slotDesc) {
        prompt += `\n\n${ps.timeSlot(slotDesc)}`;
      }
      if (programType.sponsorName) {
        prompt += `\n\n${ps.sponsor(programType.sponsorName, programType.sponsorText || undefined)}`;
      }

      // A duration written into the prompt ("длительность 45 секунд") wins over
      // the UI setting — it is the more specific instruction the author gave.
      const durationSec = extractDurationSecondsFromPrompt(rawPrompt) ?? programType.defaultDurationSeconds ?? 60;
      const wordsPerMinute = 150;
      const targetWords = Math.round((durationSec / 60) * wordsPerMinute);
      const minWords = Math.round(targetWords * 0.8);
      const maxWords = Math.round(targetWords * 1.15);
      const durationMin = Math.floor(durationSec / 60);
      const durationRemSec = durationSec % 60;
      const durationStr = durationRemSec > 0 ? `${durationMin}:${String(durationRemSec).padStart(2, "0")}` : `${durationMin}:00`;
      prompt += `\n\n${ps.dateSlot(dateStr, nextSlot, programType.dailyCount || 1)}`;

      if (programType.isWeatherForecast) {
        try {
          const weather = await fetchWeather();
          if (weather?.daily?.time?.length) {
            const dailyTimes = weather.daily.time;
            const startIdx = dailyTimes.findIndex(d => d === dateStr);
            const baseIdx = startIdx >= 0 ? startIdx : 0;
            const lines: string[] = [];
            const isRu = userLang === "ru";
            const weekdayLocale = isRu ? "ru-RU" : "en-US";
            for (let i = 0; i < forecastDays && (baseIdx + i) < dailyTimes.length; i++) {
              const idx = baseIdx + i;
              const dStr = dailyTimes[idx];
              const dObj = new Date(dStr + "T12:00:00");
              const weekday = dObj.toLocaleDateString(weekdayLocale, { weekday: "long", day: "numeric", month: "long" });
              const tMax = Math.round(weather.daily.temperature_max[idx]);
              const tMin = Math.round(weather.daily.temperature_min[idx]);
              const prec = weather.daily.precipitation_sum[idx] || 0;
              const code = weather.daily.weathercode?.[idx] ?? 0;
              const desc = getWeatherDescription(code, userLang);
              if (isRu) {
                lines.push(`- ${weekday} (${dStr}): днём ${tMax}°C, ночью ${tMin}°C, ${desc}${prec > 0 ? `, осадки ${prec} мм` : ""}`);
              } else {
                lines.push(`- ${weekday} (${dStr}): high ${tMax}°C, low ${tMin}°C, ${desc}${prec > 0 ? `, precipitation ${prec} mm` : ""}`);
              }
            }
            if (lines.length) {
              if (isRu) {
                prompt += `\n\nРЕАЛЬНЫЕ ДАННЫЕ ПРОГНОЗА ПОГОДЫ В АЛАНЬЕ (используй ТОЛЬКО эти числа, не выдумывай свои значения):\n${lines.join("\n")}`;
              } else {
                prompt += `\n\nREAL WEATHER FORECAST DATA FOR ALANYA (use ONLY these numbers, do not invent your own values):\n${lines.join("\n")}`;
              }
            }
          }
        } catch (e) {
          console.error("Weather injection failed:", e);
        }
        const weatherMaxLines = Math.max(5, Math.min(10, 3 + forecastDays * 2));
        prompt += `\n\n${ps.weatherFormatGuard(weatherMaxLines)}`;
      }

      // Seasonal framing is opt-in per show. Injecting it unconditionally told
      // every format — including psychology and science — to tie its topics to
      // the time of year, which is where the "everything is about summer" drift
      // came from.
      // Ground the hosts in the actual day. Skipped for exact-script shows (the
      // script is fixed) and for weather shows (they already receive a full,
      // more detailed forecast block above — repeating it invites contradictions).
      const promptIsScriptTemplate = !!programType.promptIsExactScript || hasExactScriptDirective(rawPrompt);

      if (!promptIsScriptTemplate && !programType.isWeatherForecast) {
        prompt += await buildBroadcastContext({
          userId: req.session.userId,
          dateStr,
          lang: userLang,
          // Weather facts only exist within the forecast horizon; for an
          // episode dated weeks ahead they would describe the wrong day.
          includeWeather: daysAhead <= 7,
        });
      }

      if (programType.useSeasonalContext || programType.isWeatherForecast) {
        const seasonRefDate = new Date(dateStr + "T12:00:00");
        const month = seasonRefDate.getMonth();
        const season = month <= 1 || month === 11 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "autumn";
        prompt += `\n${ps.seasonPrefix} ${ps.seasons[season]}`;
        prompt += `\n${ps.seasonNote}`;
      }

      // The word budget is always supplied. A duration expressed in seconds is
      // not something the model can convert into an amount of text on its own,
      // so writing "60 секунд" in the prompt must not suppress the budget — it
      // only changes the number the budget is computed from (see durationSec).
      if (!promptIsScriptTemplate) {
        prompt += `\n\n${ps.durationStrict(durationSec, durationStr, minWords, maxWords)}`;
      }
      if (promptIsScriptTemplate) {
        prompt += `\n\n${ps.scriptTemplateGuard}`;
      } else {
        prompt += `\n\n${ps.factualAccuracy}`;
      }

      const hasSearchContext = !programType.isWeatherForecast
        && !promptIsScriptTemplate
        && (fcKeywords.length > 0 || (rawPrompt && rawPrompt.length > 50));
      if (hasSearchContext) {
        try {
          const stationSettings = await storage.getSettings(req.session.userId);
          const research = await researchForProgram(fcKeywords, rawPrompt, stationSettings?.defaultPrompt || "", req.session.userId, (programType.researchProfile as ResearchProfile) || "local");
          if (research) {
            prompt += research;
          }
        } catch (err: any) {
          console.error("Firecrawl research in auto-create failed:", err.message);
        }
      }

      if (fcKeywords.length > 0) {
        prompt += `\n\n${ps.topicArea(programType.name, fcKeywords.join(", "))}`;
      }

      const title = `${programType.name} ${dateStr} #${nextSlot}`;

      if (isMultiSpeaker) {
        prompt += `\n\n${ps.multiSpeakerFormat(speakerNames.join(", "), speakerNames)}`;
      } else if (speakerNames.length >= 1) {
        prompt += `\n\n${ps.singleSpeakerFormat(speakerNames[0])}`;
      }

      if (programType.scriptTemplate) {
        prompt += `\n\n${ps.templateStructure(programType.scriptTemplate)}`;
      }

      if (!promptIsScriptTemplate) {
        const scriptsWithFormat = existingPrograms
          .filter(p => p.scriptText && p.scriptText.includes("]:"))
          .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

        const latestRef = scriptsWithFormat[0];

        if (latestRef?.scriptText) {
          prompt += `\n\n${ps.referenceFormat(latestRef.scriptText.substring(0, 3000))}`;
        }

        const existingTitles = existingPrograms
          .filter(p => p.title)
          .map(p => p.title)
          .slice(0, 50);

        if (existingTitles.length > 0) {
          prompt += `\n\n${ps.existingEpisodes(existingTitles.join("\n"))}`;
        }

        prompt += `\n\n${ps.narrativeRules(!!(hasEpisodeContent || hasUrlContent), speakerNames, fcKeywords)}

${ps.topicLine(fcKeywords.length > 0 ? fcKeywords[0].split(" ").slice(0, 3).join(" ") : (userLang === "ru" ? "Новый аспект темы" : "New topic angle"))}`;
      }

      const ctx = await buildStationContext(req.session.userId, userLang);
      const settingsForPrompt = await storage.getSettings(req.session.userId);
      const stationDefaultPrompt = settingsForPrompt?.defaultPrompt || "";
      let systemPrompt = `${ps.langDirective}
${ps.contentAuthor} "${ctx.stationName}".
${ctx.stationDescription ? ps.aboutStation(ctx.stationDescription) : ""}
${ps.activeHosts(ctx.personaList)}
${ps.createContentInStyle}
${ps.narrativeStyle}`;
      if (stationDefaultPrompt) {
        systemPrompt += `\n\n${ps.stationInstructions}\n${stationDefaultPrompt}`;
      }
      if (ctx.knowledgeBase) {
        systemPrompt += `\n\n${ps.knowledgeBase}\n${ctx.knowledgeBase}`;
      }

      let scriptText = "";
      const anthropic = await getAnthropicClient(req.session.userId);

      try {
        if (anthropic) {
          const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: aiMaxTokens(2048),
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
        return res.status(500).json({ error: ps.generationFailed });
      }

      if (!promptIsScriptTemplate) {
        scriptText = await enforceMaxWords(scriptText, maxWords, systemPrompt, prompt, anthropic, userLang);
      }

      let extractedTopic = "";
      const topicMatch = scriptText.match(/^(?:ТЕМА|TOPIC):\s*(.+)/m);
      if (topicMatch) {
        extractedTopic = topicMatch[1].trim();
        scriptText = scriptText.replace(/^(?:ТЕМА|TOPIC):\s*.+\n*/m, "").trim();
      }

      const finalTitle = extractedTopic 
        ? `${programType.name}: ${extractedTopic}`
        : title;

      const program = await storage.createProgram({
        userId: req.session.userId,
        programTypeId: programType.id,
        title: finalTitle,
        prompt,
        scheduledDate: dateStr,
        slotNumber: nextSlot,
        status: "script_ready",
        scriptText,
        scriptGeneratedAt: new Date(),
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
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const { count, referenceContent, referenceUrl } = req.body;
      const totalCount = Math.min(Math.max(count || 10, 5), 50);

      const existingPrograms = await storage.getProgramsByType(programType.id, req.session.userId!);
      const existingTitles = existingPrograms
        .filter(p => p.title)
        .slice(-20)
        .map(p => p.title)
        .join(", ");

      const ctx = await buildStationContext(req.session.userId);
      const anthropic = await getAnthropicClient(req.session.userId);

      const voicesList = await storage.getVoices(req.session.userId!);
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      const rawPrompt = programType.defaultPrompt || "";
      const { prompt: expandedDefaultPrompt, fetchedContent: urlContent } = await fetchAndExpandUrls(rawPrompt);
      const hasUrlContent = !!urlContent;

      const voicePersonaNames = assignedVoices.length > 0
        ? assignedVoices.map((v: any) => getCleanVoiceName(v))
        : [];
      let speakerNames: string[];
      if (voicePersonaNames.length > 0) {
        speakerNames = voicePersonaNames;
      } else {
        let promptSpeaker = extractSpeakerFromPrompt(rawPrompt);
        if (!promptSpeaker && urlContent) {
          promptSpeaker = extractSpeakerFromPrompt(urlContent);
        }
        speakerNames = promptSpeaker ? [promptSpeaker] : [programType.name];
      }

      const fullText = rawPrompt + (urlContent || "");
      const hasEpisodeContent = fullText.length > 300
        && /(?:выпуск|[Сс] вами|[Пп]ривет.*программа|[Пп]рограмма.*[«"])/m.test(fullText)
        && /\n.{50,}\n/m.test(fullText);

      const fcKeywords = programType.firecrawlTopics?.length
        ? extractFirecrawlKeywords(programType.firecrawlTopics)
        : [];
      
      let prompt = `Создай ${totalCount} ГОТОВЫХ сценариев для радиопередачи "${programType.name}" на радио "${ctx.stationName}".

Базовый промпт передачи:
${expandedDefaultPrompt}

`;
      
      if (hasUrlContent) {
        prompt += `\nЭТАЛОННЫЕ ВЫПУСКИ ИЗ ССЫЛОК — изучи стиль, тон, тематику:${urlContent}\n`;
      }

      if (hasEpisodeContent || hasUrlContent) {
        prompt += `\nКРИТИЧЕСКИ ВАЖНО:
- Текст выше — ЭТАЛОННЫЕ ВЫПУСКИ. Создай новые ТОЧНО В ТАКОМ ЖЕ стиле и тематической области
- Тематика: оставайся В ТОЙ ЖЕ ПРЕДМЕТНОЙ ОБЛАСТИ (${fcKeywords.length > 0 ? fcKeywords.join(", ") : "как в эталонах"})
- Каждый выпуск — НОВЫЙ аспект/угол внутри этой предметной области
- Ведущий(ая): ${speakerNames.join(", ")}. Используй ТОЧНО ${speakerNames.length === 1 ? "это имя" : "эти имена"} ведущих
- Сохраняй структуру: приветствие, основная часть, заключение — как в эталонах
- Без markdown-разметки, без звёздочек
- ОБЯЗАТЕЛЬНО оформи вывод в формате [Имя]: [тег] текст (см. инструкции формата ниже), даже если в эталонах формат другой
`;
      }

      const hasReferenceContent = !!referenceContent;
      if (isMultiSpeaker) {
        const speakerList = speakerNames.join(", ");
        prompt += `\nОБЯЗАТЕЛЬНЫЙ ФОРМАТ ВЫВОДА: мульти-спикерный скрипт. Спикеры: ${speakerList}
Каждая реплика ОБЯЗАТЕЛЬНО начинается с [Имя]: и содержит теги эмоций.
Доступные теги: [energetic] [fast] [slow] [surprised] [thoughtful] [happy] [sad] [exclaims] [announcer] [serious] [calm] [excited] [warm] [dramatic] [whisper] [loud] [gentle] [playful] [confident]
Пример:
[${speakerNames[0]}]: [energetic] [fast] Текст...
[${speakerNames[1] || speakerNames[0]}]: [announcer] ЗАГОЛОВОК
\n`;
      } else if (speakerNames.length >= 1) {
        prompt += `\nОБЯЗАТЕЛЬНЫЙ ФОРМАТ ВЫВОДА: скрипт с ведущим. Ведущий(ая): ${speakerNames[0]}
КАЖДЫЙ абзац/блок текста ОБЯЗАТЕЛЬНО начинается с [${speakerNames[0]}]: и содержит теги эмоций в квадратных скобках.
Доступные теги: [energetic] [fast] [slow] [surprised] [thoughtful] [happy] [sad] [exclaims] [announcer] [serious] [calm] [excited] [warm] [dramatic] [whisper] [loud] [gentle] [playful] [confident]
Пример:
[${speakerNames[0]}]: [energetic] [warm] Привет! Текст ведущего...
[${speakerNames[0]}]: [thoughtful] Следующий блок текста...
НЕ пиши текст без префикса [${speakerNames[0]}]:! Каждый блок должен начинаться с имени ведущего.
\n`;
      }

      if (programType.scriptTemplate) {
        prompt += `\nСТРУКТУРА СЦЕНАРИЯ — СТРОГО СЛЕДУЙ ЭТОМУ ШАБЛОНУ:
${programType.scriptTemplate}
ВАЖНО: Распределяй текст между спикерами ТОЧНО по этой структуре. Каждый спикер выполняет ТОЛЬКО свою роль, указанную выше.\n`;
      }

      {
        const latestRef = existingPrograms
          .filter(p => p.scriptText && p.scriptText.includes("]:"))
          .sort((a, b) => (b.id > a.id ? 1 : -1))
          .slice(0, 1)[0];

        if (latestRef?.scriptText) {
          prompt += `\nОБРАЗЕЦ — последний выпуск. Следуй ТОЧНО такому же формату и стилю:\n---\n${latestRef.scriptText.substring(0, 5000)}\n---\n`;
        }
      }

      if (referenceContent) {
        prompt += `\nЭТАЛОНЫЙ КОНТЕНТ — изучи стиль, формат, тон. Создай новые выпуски ТОЧНО В ТАКОМ ЖЕ стиле:\n${referenceContent.substring(0, 30000)}\n`;
      }

      prompt += `\n\n${getPromptStrings("ru").factualAccuracy}\n`;

      const batchRawPrompt = programType.defaultPrompt || "";
      const batchHasSearchContext = fcKeywords.length > 0 || (batchRawPrompt && batchRawPrompt.length > 50);
      if (batchHasSearchContext) {
        try {
          const batchStationSettings = await storage.getSettings(req.session.userId);
          const research = await researchForProgram(fcKeywords, batchRawPrompt, batchStationSettings?.defaultPrompt || "", req.session.userId, (programType.researchProfile as ResearchProfile) || "local");
          if (research) {
            prompt += research;
          }
        } catch (err: any) {
          console.error("Firecrawl research in batch-create failed:", err.message);
        }
        if (fcKeywords.length > 0) {
          prompt += `\nТематика передачи: ${fcKeywords.join(", ")}. Все выпуски должны быть в рамках этих тем.\n`;
        }
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

      const hasReference = hasEpisodeContent || hasUrlContent || hasReferenceContent;
      const batchDurationSec = extractDurationSecondsFromPrompt(batchRawPrompt) ?? programType.defaultDurationSeconds ?? 60;
      const batchWordsPerMinute = 150;
      const batchTargetWords = Math.round((batchDurationSec / 60) * batchWordsPerMinute);
      const batchMinWords = Math.round(batchTargetWords * 0.8);
      const batchMaxWords = Math.round(batchTargetWords * 1.15);

      const formatNote = isMultiSpeaker
        ? ", в мульти-спикерном формате [Имя]: [теги] текст"
        : speakerNames.length >= 1
          ? `, от лица ${speakerNames[0]} в формате [${speakerNames[0]}]: [теги] текст`
          : ", с репликами ведущих";

      prompt += `

ХРОНОМЕТРАЖ КАЖДОГО ВЫПУСКА — СТРОГО:
- Целевая длительность: ${batchDurationSec} секунд
- Объём КАЖДОГО сценария: от ${batchMinWords} до ${batchMaxWords} слов (скорость чтения ~150 слов/мин)
- НЕ ПИШИ БОЛЬШЕ ${batchMaxWords} слов на один выпуск! Лучше короче и ёмче

СТИЛЬ ПОВЕСТВОВАНИЯ — ОБЯЗАТЕЛЬНО для каждого выпуска:
- Пиши как РАССКАЗ, а НЕ как список фактов. Каждый выпуск — это история с началом, развитием и концом
- Между блоками используй ПЛАВНЫЕ ПЕРЕХОДЫ: "А ещё...", "Кстати, это связано с...", "И вот тут самое интересное..."
- ЗАПРЕЩЕНО: перечислять факты тезисами. Каждая мысль должна вытекать из предыдущей
- Добавляй ЖИВЫЕ ДЕТАЛИ: личные наблюдения, примеры, мини-истории
- НЕ выдумывай статистику, названия исследований и институтов. Давай практические советы из опыта

Ответь ТОЛЬКО JSON массивом из ${totalCount} объектов. Каждый объект:
- "title": уникальное короткое название выпуска
- "script": ПОЛНЫЙ ГОТОВЫЙ сценарий выпуска (текст для озвучки${formatNote})

ВАЖНО: Ведущий(ая): ${speakerNames.join(", ")}.
Формат: [{"title":"...","script":"..."},...]
Все ${totalCount} выпусков должны быть разными.${referenceContent || hasEpisodeContent || hasUrlContent ? " Стиль и формат — как в эталоне." : ""}
Ответь ТОЛЬКО JSON массивом, без пояснений.`;

      const settingsForBatch = await storage.getSettings(req.session.userId);
      const stationDefaultPromptBatch = settingsForBatch?.defaultPrompt || "";
      let systemPrompt = `Ты - автор контента для радио "${ctx.stationName}".
${ctx.stationDescription ? `О станции: ${ctx.stationDescription}` : ""}
Активные ведущие: ${ctx.personaList}.
Генерируй контент на русском языке. Отвечай ТОЛЬКО валидным JSON.`;
      if (stationDefaultPromptBatch) {
        systemPrompt += `\n\nОБЩИЕ ИНСТРУКЦИИ СТАНЦИИ (ВСЕГДА СОБЛЮДАЙ):\n${stationDefaultPromptBatch}`;
      }
      if (ctx.knowledgeBase) {
        systemPrompt += `\n\nБАЗА ЗНАНИЙ СТАНЦИИ:\n${ctx.knowledgeBase}`;
      }

      let batchScripts: Array<{ title: string; script: string }> = [];

      try {
        let resultText = "";
        if (anthropic) {
          const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: aiMaxTokens(16384),
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
            userId: req.session.userId,
            programTypeId: programType.id,
            title: item.title,
            prompt: prompt.substring(0, 500),
            scheduledDate: dateStr,
            slotNumber,
            status: "script_ready",
            scriptText: item.script,
            scriptGeneratedAt: new Date(),
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
      const program = await storage.getProgram(req.params.id, req.session.userId!);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }

      const programType = await storage.getProgramType(program.programTypeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const prompt = program.prompt || programType.defaultPrompt;
      let scriptText: string;

      const userGen = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const userLangGen = userGen?.language || "en";
      const psGen = getPromptStrings(userLangGen);

      const ctx = await buildStationContext(req.session.userId, userLangGen);
      const voicesList = await storage.getVoices(req.session.userId!);
      const assignedVoices = resolveAssignedVoices(voicesList, programType);
      const isMultiSpeaker = assignedVoices.length >= 2;

      let systemPrompt: string;
      if (isMultiSpeaker) {
        const speakerList = assignedVoices.map(v => getCleanVoiceName(v)).join(", ");
        const speakerNames = assignedVoices.map(v => getCleanVoiceName(v));
        systemPrompt = `${psGen.langDirective}
${psGen.scriptWriter} "${ctx.stationName}".
${ctx.stationDescription ? psGen.aboutStation(ctx.stationDescription) : ""}

${psGen.multiSpeakerFormat(speakerList, speakerNames)}`;
      } else {
        const singleSpeakerName = assignedVoices.length > 0
          ? getCleanVoiceName(assignedVoices[0])
          : (ctx.personaList.split(",")[0]?.trim() || programType.name);
        systemPrompt = `${psGen.langDirective}
${psGen.contentAuthor} "${ctx.stationName}".
${ctx.stationDescription ? psGen.aboutStation(ctx.stationDescription) : ""}

${psGen.singleSpeakerFormat(singleSpeakerName)}`;
      }

      if (programType.scriptTemplate) {
        systemPrompt += `\n\n${psGen.templateStructure(programType.scriptTemplate)}`;
      }

      const genDurationSec = extractDurationSecondsFromPrompt(prompt) ?? programType.defaultDurationSeconds ?? 60;
      const genTargetWords = Math.round((genDurationSec / 60) * 150);
      const genMinWords = Math.round(genTargetWords * 0.8);
      const genMaxWords = Math.round(genTargetWords * 1.15);
      const genDurStr = `${Math.floor(genDurationSec / 60)}:${String(genDurationSec % 60).padStart(2, "0")}`;
      const genPromptIsScriptTemplate = !!programType.promptIsExactScript || hasExactScriptDirective(prompt);

      if (!genPromptIsScriptTemplate && !programType.isWeatherForecast) {
        systemPrompt += await buildBroadcastContext({
          userId: req.session.userId,
          dateStr: program.scheduledDate || new Date().toISOString().split("T")[0],
          lang: userLangGen,
          includeWeather: true,
        });
      }

      if (!genPromptIsScriptTemplate) {
        systemPrompt += `\n\n${psGen.durationStrict(genDurationSec, genDurStr, genMinWords, genMaxWords)}`;
      }
      if (genPromptIsScriptTemplate) {
        systemPrompt += `\n\n${psGen.scriptTemplateGuard}`;
      } else {
        systemPrompt += `\n\n${psGen.factualAccuracy}`;
      }

      const settingsForGen = await storage.getSettings(req.session.userId);
      const stationDefaultPromptGen = settingsForGen?.defaultPrompt || "";

      if (!genPromptIsScriptTemplate && !programType.isWeatherForecast) {
        const genFcKeywords = extractFirecrawlKeywords(programType.firecrawlTopics || []);
        const genHasSearchContext = genFcKeywords.length > 0 || (!!prompt && prompt.length > 50);
        if (genHasSearchContext) {
          try {
            const research = await researchForProgram(genFcKeywords, prompt || "", stationDefaultPromptGen, req.session.userId, (programType.researchProfile as ResearchProfile) || "local");
            if (research) {
              systemPrompt += research;
            }
          } catch (err: any) {
            console.error("Firecrawl research in generate failed:", err.message);
          }
        }
      }
      if (stationDefaultPromptGen) {
        systemPrompt += `\n\n${psGen.stationInstructions}\n${stationDefaultPromptGen}`;
      }
      if (ctx.knowledgeBase) {
        systemPrompt += `\n\n${psGen.knowledgeBase}\n${ctx.knowledgeBase}`;
      }

      const anthropic = await getAnthropicClient(req.session.userId);
      
      if (anthropic) {
        const message = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: aiMaxTokens(2048),
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

      if (!genPromptIsScriptTemplate) {
        scriptText = await enforceMaxWords(scriptText, genMaxWords, systemPrompt, prompt, anthropic, userLangGen);
      }

      const updated = await storage.updateProgram(program.id, req.session.userId!, {
        scriptText,
        status: "script_ready",
        scriptGeneratedAt: new Date(),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error generating program script:", error);
      res.status(500).json({ error: "Failed to generate program script" });
    }
  });

  app.post("/api/programs/:id/generate-audio", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id, req.session.userId!);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }

      if (!program.scriptText) {
        return res.status(400).json({ error: "No script to generate audio from" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const voicesList = await storage.getVoices(req.session.userId!);
      const programType = await storage.getProgramType(program.programTypeId, req.session.userId!);

      const progTtsStability = settings.ttsStability ?? 0.75;
      const progTtsSimilarityBoost = settings.ttsSimilarityBoost ?? 0.75;

      const generateVoiceSegment = async (text: string, voiceId: string): Promise<Buffer> => {
        return synthesizeSpeech({
          apiKey: settings.elevenLabsApiKey!,
          voiceId,
          text,
          stability: progTtsStability,
          similarityBoost: progTtsSimilarityBoost,
        });
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
          const speakerName = getCleanVoiceName(voice);
          speakerVoiceMap.set(speakerName.toLowerCase(), voice.elevenLabsVoiceId);
        }

        const allVoiceMap = new Map<string, string>();
        for (const voice of voicesList) {
          if (voice.elevenLabsVoiceId) {
            const speakerName = getCleanVoiceName(voice);
            allVoiceMap.set(speakerName.toLowerCase(), voice.elevenLabsVoiceId);
          }
        }

        const segmentFiles: string[] = [];
        const segmentSpeakers: string[] = [];
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
            voiceId = allVoiceMap.get(segment.speaker.toLowerCase());
          }
          if (!voiceId) {
            for (const [name, vid] of allVoiceMap.entries()) {
              if (segment.speaker.toLowerCase().includes(name) || name.includes(segment.speaker.toLowerCase())) {
                voiceId = vid;
                break;
              }
            }
          }
          if (!voiceId) {
            voiceId = assignedVoices[0]?.elevenLabsVoiceId || voicesList[0]?.elevenLabsVoiceId;
          }
          if (!voiceId) {
            segmentErrors.push(`Сегмент ${i + 1}: голос не найден для "${segment.speaker}"`);
            continue;
          }

          try {
            console.log(`Synthesizing segment ${i + 1}/${segments.length}: [${segment.speaker}] (${cleanText.length} chars)`);
            const buffer = await generateVoiceSegment(cleanText, voiceId);
            const segFile = path.join(audioDir, `_seg_${timestamp}_${i}.mp3`);
            await fs.writeFile(segFile, buffer);
            segmentFiles.push(segFile);
            segmentSpeakers.push(segment.speaker);
          } catch (err) {
            console.error(`Segment ${i + 1} synthesis error:`, err);
            segmentErrors.push(`Сегмент ${i + 1} (${segment.speaker}): ${describeTtsError(err)}`);
          }
        }

        if (segmentFiles.length === 0) {
          return res.status(500).json({ error: "Не удалось озвучить ни один сегмент", details: segmentErrors });
        }

        const filename = resolveFileName(programType?.fileNameTemplate, programType, program, timestamp);
        const outputFile = path.join(audioDir, filename);

        const combined = await concatMp3WithFfmpeg(segmentFiles, outputFile, audioDir, timestamp, segmentSpeakers);

        for (const f of segmentFiles) {
          await fs.unlink(f).catch(() => {});
        }

        const stat = await fs.stat(outputFile);
        const estimatedDuration = Math.round(stat.size / (192000 / 8));

        const totalExpected = segments.filter(s => stripEmotionTags(s.text).length > 0).length;
        const hasErrors = segmentErrors.length > 0;
        const status = hasErrors ? (segmentFiles.length < totalExpected ? "error" : "ready") : "ready";

        const updated = await storage.updateProgram(program.id, req.session.userId!, {
          audioUrl: `/audio/${filename}`,
          status,
          audioDurationSeconds: estimatedDuration,
          audioGeneratedAt: new Date(),
        });

        // Archive in the background: the deploy filesystem is wiped on every
        // republish, so the cloud copy is the only durable one.
        void archiveAudio({
          userId: req.session.userId!,
          audioUrl: `/audio/${filename}`,
          folder: programType?.uploadFolder || `/radio/${programType?.slug || "programs"}`,
        }).then(archived => {
          if (archived.uploaded) {
            storage.updateProgram(program.id, req.session.userId!, { uploadedToYandex: true, yandexPath: archived.remotePath }).catch(() => {});
          } else if (archived.error) {
            console.error(`[archive] program ${program.id}: ${archived.error}`);
          }
        });

        logUsage(req.session.userId!, "audio_generation", "program_multi_speaker");
        res.json({ ...updated, segmentCount: segmentFiles.length, totalSegments: totalExpected, errors: segmentErrors });
      } else {
        const resolved = resolveAssignedVoices(voicesList, programType);
        let activeVoice = resolved.length > 0 ? resolved[0] : null;
        if (!activeVoice) {
          const speakerFromScript = extractSpeakerFromPrompt(program.scriptText || "");
          if (speakerFromScript) {
            const spkLower = speakerFromScript.toLowerCase();
            activeVoice = voicesList.find(v => {
              const vn = getCleanVoiceName(v).toLowerCase();
              return vn === spkLower || spkLower.includes(vn) || vn.includes(spkLower);
            }) || null;
          }
        }
        if (!activeVoice) {
          activeVoice = voicesList.find(v => v.isActive) || null;
        }

        if (!activeVoice) {
          return res.status(400).json({ error: "No active voice configured" });
        }

        const buffer = await generateVoiceSegment(program.scriptText, activeVoice.elevenLabsVoiceId);
        const filename = resolveFileName(programType?.fileNameTemplate, programType, program, timestamp);
        await fs.writeFile(path.join(audioDir, filename), buffer);

        const estimatedDurationSingle = Math.round(buffer.length / (192000 / 8));

        const updated = await storage.updateProgram(program.id, req.session.userId!, {
          audioUrl: `/audio/${filename}`,
          status: "ready",
          audioDurationSeconds: estimatedDurationSingle,
          audioGeneratedAt: new Date(),
        });

        void archiveAudio({
          userId: req.session.userId!,
          audioUrl: `/audio/${filename}`,
          folder: programType?.uploadFolder || `/radio/${programType?.slug || "programs"}`,
        }).then(archived => {
          if (archived.uploaded) {
            storage.updateProgram(program.id, req.session.userId!, { uploadedToYandex: true, yandexPath: archived.remotePath }).catch(() => {});
          } else if (archived.error) {
            console.error(`[archive] program ${program.id}: ${archived.error}`);
          }
        });

        logUsage(req.session.userId!, "audio_generation", "program_single_speaker");
        res.json(updated);
      }
    } catch (error) {
      console.error("Error generating program audio:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate program audio" });
    }
  });

  app.get("/api/programs/:id/download-audio", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id, req.session.userId!);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }
      if (!program.audioUrl) {
        return res.status(404).json({ error: "No audio file" });
      }

      const normalizedUrl = program.audioUrl.startsWith("/") ? program.audioUrl.slice(1) : program.audioUrl;
      const audioPath = path.join(process.cwd(), "public", normalizedUrl);

      try {
        await fs.access(audioPath);
      } catch {
        const restored = await restoreAudio({ userId: req.session.userId!, audioUrl: program.audioUrl });
        if (!restored) {
          return res.status(404).json({ error: "Audio file not found on disk" });
        }
      }

      const remuxed = await ensureRemuxed(audioPath);

      // Mark before streaming: the list highlights already-downloaded episodes.
      storage.updateProgram(program.id, req.session.userId!, { downloadedAt: new Date() })
        .catch(err => console.error("Could not mark program downloaded:", err?.message));

      const filename = path.basename(audioPath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);

      const { createReadStream } = await import("fs");
      const stream = createReadStream(remuxed);
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading audio:", error);
      res.status(500).json({ error: "Failed to download audio" });
    }
  });

  app.post("/api/programs/:id/voice-isolate", async (req, res) => {
    try {
      const program = await storage.getProgram(req.params.id, req.session.userId!);
      if (!program) {
        return res.status(404).json({ error: "Program not found" });
      }
      if (!program.audioUrl) {
        return res.status(400).json({ error: "No audio file to process" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const normalizedUrl = program.audioUrl.startsWith("/") ? program.audioUrl.slice(1) : program.audioUrl;
      const audioPath = path.join(process.cwd(), "public", normalizedUrl);
      try {
        await fs.access(audioPath);
      } catch {
        await restoreAudio({ userId: req.session.userId!, audioUrl: program.audioUrl });
      }
      const audioData = await fs.readFile(audioPath);

      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      formData.append("audio", audioData, {
        filename: path.basename(audioPath),
        contentType: "audio/mpeg",
      });

      console.log(`Voice isolating audio for program ${program.id}...`);
      const response = await fetch("https://api.elevenlabs.io/v1/audio-isolation", {
        method: "POST",
        headers: {
          "xi-api-key": settings.elevenLabsApiKey!,
          ...formData.getHeaders(),
        },
        body: formData.getBuffer(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs Voice Isolator error: ${response.status} - ${errorText}`);
      }

      const resultBuffer = Buffer.from(await response.arrayBuffer());
      const audioDir = path.join(process.cwd(), "public", "audio");
      await fs.mkdir(audioDir, { recursive: true });

      const originalFilename = path.basename(audioPath, path.extname(audioPath));
      const isolatedFilename = `${originalFilename}_isolated.mp3`;
      const isolatedPath = path.join(audioDir, isolatedFilename);
      await fs.writeFile(isolatedPath, resultBuffer);

      const updated = await storage.updateProgram(program.id, req.session.userId!, {
        audioUrl: `/audio/${isolatedFilename}`,
      });

      const isolateProgramType = await storage.getProgramType(program.programTypeId, req.session.userId!);
      void archiveAudio({
        userId: req.session.userId!,
        audioUrl: `/audio/${isolatedFilename}`,
        folder: isolateProgramType?.uploadFolder || `/radio/${isolateProgramType?.slug || "programs"}`,
      }).then(archived => {
        if (archived.uploaded) {
          storage.updateProgram(program.id, req.session.userId!, { uploadedToYandex: true, yandexPath: archived.remotePath }).catch(() => {});
        } else if (archived.error) {
          console.error(`[archive] program ${program.id}: ${archived.error}`);
        }
      });

      console.log(`Voice isolation complete for program ${program.id}: /audio/${isolatedFilename}`);
      res.json(updated);
    } catch (error) {
      console.error("Error in voice isolation:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Voice isolation failed" });
    }
  });

  app.get("/api/automations", async (req, res) => {
    try {
      const automationsList = await storage.getAutomations(req.session.userId!);
      res.json(automationsList);
    } catch (error) {
      console.error("Error getting automations:", error);
      res.status(500).json({ error: "Failed to get automations" });
    }
  });

  app.get("/api/automations/:id", async (req, res) => {
    try {
      const automation = await storage.getAutomation(req.params.id, req.session.userId!);
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
      const automation = await storage.createAutomation({ ...data, userId: req.session.userId });
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
      
      const updated = await storage.updateAutomation(req.params.id, updates as any, req.session.userId!);
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
      const deleted = await storage.deleteAutomation(req.params.id, req.session.userId!);
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
      const automation = await storage.getAutomation(req.params.id, req.session.userId!);
      if (!automation) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const runs = await storage.getAutomationRuns(req.params.id);
      res.json(runs);
    } catch (error) {
      console.error("Error getting automation runs:", error);
      res.status(500).json({ error: "Failed to get automation runs" });
    }
  });

  app.post("/api/automations/:id/run", async (req, res) => {
    try {
      const automation = await storage.getAutomation(req.params.id, req.session.userId!);
      if (!automation) {
        return res.status(404).json({ error: "Automation not found" });
      }

      const run = await storage.createAutomationRun({
        automationId: automation.id,
        userId: req.session.userId!,
        status: "running",
        itemsCreated: 0,
      });

      const executeAutomation = async () => {
        try {
          let itemsCreated = 0;
          const itemsCount = automation.itemsCount || 1;

          const weather = await fetchWeather();
          const newsItems = await storage.getNewsItems(req.session.userId!);
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
            const voicesList = await storage.getVoices(req.session.userId!);
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

            const ctx = await buildStationContext(req.session.userId);
            const personaContext = `\nВЕДУЩИЕ: ${getCleanVoiceName(maleVoice)} (мужчина) и ${getCleanVoiceName(femaleVoice)} (женщина). Используй их имена в диалоге естественно.\n`;
            const stationContext = `Радиостанция: ${ctx.stationName}. ${ctx.stationDescription ? ctx.stationDescription : ""}\n`;

            for (let i = 0; i < itemsCount; i++) {
              const basePrompt = automation.prompt || `Создай короткий диалог для радио ${ctx.stationName}`;
              const enhancedPrompt = stationContext + basePrompt + contextInfo + personaContext;
              
              const dialog = await storage.createDialog({
                userId: req.session.userId,
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
            const programType = await storage.getProgramType(automation.programTypeId, req.session.userId!);
            if (!programType) {
              await storage.updateAutomationRun(run.id, {
                status: "error",
                errorMessage: "Тип программы не найден",
                completedAt: new Date(),
              });
              return;
            }

            const ctx = await buildStationContext(req.session.userId);
            const stationContext = `Радиостанция: ${ctx.stationName}. ${ctx.stationDescription ? ctx.stationDescription : ""}\n`;
            
            for (let i = 0; i < itemsCount; i++) {
              const basePrompt = automation.prompt || programType.defaultPrompt;
              const enhancedPrompt = stationContext + basePrompt + contextInfo;
              
              await storage.createProgram({
                userId: req.session.userId,
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
          } as any, req.session.userId!);

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
  const PIXABAY_API_BASE = "https://pixabay.com/api";
  
  async function getFreesoundApiKey(userId?: string): Promise<string | null> {
    const settings = await storage.getSettings(userId);
    return settings?.freesoundApiKey || null;
  }

  async function searchMusicPixabay(searchQuery: string): Promise<any[]> {
    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (!pixabayKey) return [];
    try {
      const url = `${PIXABAY_API_BASE}/?key=${pixabayKey}&q=${encodeURIComponent(searchQuery)}&media_type=audio&per_page=20`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.hits || []).map((hit: any) => ({
        id: String(hit.id),
        title: hit.tags || "Untitled",
        mainArtists: [hit.user || "Pixabay"],
        bpm: 0,
        length: Math.round(hit.duration || 0),
        moods: (hit.tags || "").split(", ").slice(0, 5).map((t: string) => ({ name: t })),
        images: { default: hit.userImageURL || "" },
        audioUrl: hit.audio || hit.previewURL || "",
        license: "Pixabay License",
      }));
    } catch { return []; }
  }

  async function searchMusicFreesound(searchQuery: string, apiKey: string): Promise<any[]> {
    try {
      const url = `${FREESOUND_API_BASE}/search/text/?query=${encodeURIComponent(searchQuery)}&filter=duration:[30 TO 300] tag:music&fields=id,name,duration,tags,previews,username,license&page_size=20&token=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.results || []).map((sound: any) => ({
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
    } catch { return []; }
  }

  async function searchMusicEpidemic(searchQuery: string): Promise<any[]> {
    const token = process.env.EPIDEMIC_SOUND_TOKEN;
    if (!token) return [];
    try {
      const url = `https://www.epidemicsound.com/json/search/tracks/?term=${encodeURIComponent(searchQuery)}&limit=20`;
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
        },
      });
      if (!response.ok) return [];
      const data = await response.json();
      const entities = data?.entities || data?.tracks || [];
      return entities.map((track: any) => ({
        id: String(track.id),
        title: track.title || track.name || "Untitled",
        mainArtists: track.mainArtists?.map((a: any) => a.name || a) || [track.createdBy || "Unknown"],
        bpm: track.bpm || 0,
        length: Math.round(track.length || 0),
        moods: track.moods?.slice(0, 5).map((m: any) => ({ name: typeof m === 'string' ? m : m.name || m })) || [],
        images: { default: track.imageUrl || "" },
        audioUrl: track.stems?.full?.lqMp3Url || track.previewUrl || "",
        license: "Epidemic Sound",
      }));
    } catch { return []; }
  }
  
  app.get("/api/music/search", async (req, res) => {
    try {
      const { query } = req.query;
      const searchQuery = query ? String(query) : "background music";

      const freesoundKey = await getFreesoundApiKey(req.session.userId);
      let tracks: any[] = [];

      if (freesoundKey) {
        tracks = await searchMusicFreesound(searchQuery, freesoundKey);
      }
      if (tracks.length === 0) {
        tracks = await searchMusicEpidemic(searchQuery);
      }
      if (tracks.length === 0) {
        tracks = await searchMusicPixabay(searchQuery);
      }

      if (tracks.length === 0) {
        return res.status(400).json({ 
          error: "No music API configured",
          needsApiKey: true 
        });
      }
      
      res.json({ tracks });
    } catch (error) {
      console.error("Error searching music:", error);
      res.status(500).json({ error: "Failed to search music" });
    }
  });

  app.get("/api/music/track/:trackId/stream", async (req, res) => {
    try {
      const { trackId } = req.params;
      const apiKey = await getFreesoundApiKey(req.session.userId);
      
      if (apiKey) {
        const url = `${FREESOUND_API_BASE}/sounds/${trackId}/?fields=previews&token=${apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const audioUrl = data.previews?.["preview-hq-mp3"] || data.previews?.["preview-lq-mp3"];
          return res.json({ url: audioUrl });
        }
      }
      
      return res.status(404).json({ error: "Track not found" });
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

      const anthropic = await getAnthropicClient(req.session.userId);
      if (!anthropic) {
        return res.status(400).json({ error: "Claude API key not configured" });
      }

      const freesoundKey = await getFreesoundApiKey(req.session.userId);

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
        max_tokens: aiMaxTokens(500),
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

      let tracks: any[] = [];

      if (freesoundKey) {
        tracks = await searchMusicFreesound(analysis.searchQuery, freesoundKey);
      }
      if (tracks.length === 0) {
        tracks = await searchMusicEpidemic(analysis.searchQuery);
      }
      if (tracks.length === 0) {
        tracks = await searchMusicPixabay(analysis.searchQuery);
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
      const programType = await storage.getProgramType(req.params.typeId, req.session.userId!);
      if (!programType) {
        return res.status(404).json({ error: "Program type not found" });
      }

      const count = req.body.count || 1;
      const results: any[] = [];

      const rawScheduledDate = req.body?.scheduledDate;
      const pipelineScheduledDate = typeof rawScheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawScheduledDate)
        ? rawScheduledDate
        : null;
      const rawForecastDays = req.body?.forecastDays;
      const explicitForecastDays = Number.isFinite(Number(rawForecastDays))
        ? Math.min(7, Math.max(1, Math.round(Number(rawForecastDays))))
        : null;
      const pipelineForecastDays = programType.isWeatherForecast
        ? (explicitForecastDays ?? Math.min(7, Math.max(1, programType.defaultForecastDays || 1)))
        : null;

      for (let i = 0; i < count; i++) {
        try {
          const createBody: Record<string, any> = {};
          if (pipelineScheduledDate) createBody.scheduledDate = pipelineScheduledDate;
          if (pipelineForecastDays) createBody.forecastDays = pipelineForecastDays;
          const createRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/auto-create/${programType.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: req.headers.cookie || "" },
            body: JSON.stringify(createBody),
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

          if (programType.autoIsolate && audioOk && program.audioUrl) {
            try {
              const isolateRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/${program.id}/voice-isolate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              if (isolateRes.ok) {
                const isolateData = await isolateRes.json();
                program.audioUrl = isolateData.audioUrl;
                console.log(`Auto-pipeline: voice isolation done for ${program.id}`);
              }
            } catch (isolateErr: any) {
              console.error(`Auto-pipeline isolate error for ${program.id}:`, isolateErr.message);
            }
          }

          if (programType.autoUpload !== false && program.audioUrl) {
            const archived = await archiveAudio({
              userId: req.session.userId!,
              audioUrl: program.audioUrl,
              folder: programType.uploadFolder || `/radio/${programType.slug}`,
            });
            if (archived.uploaded) {
              await storage.updateProgram(program.id, req.session.userId!, {
                uploadedToYandex: true,
                yandexPath: archived.remotePath,
              });
              program.uploadedToYandex = true;
              logUsage(req.session.userId!, "file_upload", archived.provider);
            } else if (archived.error) {
              console.error(`Auto-pipeline upload error for ${program.id}: ${archived.error}`);
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
      if (!internalApiKey()) {
        console.error("[scheduler] INTERNAL_API_KEY (or VOICE_AGENT_API_KEY) is not set — the scheduler cannot authenticate against its own API. Auto-generation is disabled.");
        return;
      }
      const types = await storage.getProgramTypes();
      const autoTypes = types.filter(t => t.isActive && t.autoGenerate);

      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();

      for (const pType of autoTypes) {
        if (pType.scheduleDays && pType.scheduleDays.length > 0) {
          if (!pType.scheduleDays.includes(currentDay)) {
            continue;
          }
        }

        if (pType.scheduleTime) {
          const [schedHour] = pType.scheduleTime.split(":").map(Number);
          if (currentHour !== schedHour) {
            continue;
          }
        }

        const weeklyCount = pType.weeklyCount || 7;
        const dailyCount = pType.dailyCount || 1;
        const today = new Date();
        const dateStr = today.toISOString().split("T")[0];

        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - mondayOffset);
        const weekStartStr = weekStart.toISOString().split("T")[0];

        const existingPrograms = await storage.getProgramsByType(pType.id, pType.userId || undefined);
        const thisWeekPrograms = existingPrograms.filter(p => p.scheduledDate && p.scheduledDate >= weekStartStr && p.scheduledDate <= dateStr);
        const todayPrograms = existingPrograms.filter(p => p.scheduledDate === dateStr);

        const weeklyRemaining = weeklyCount - thisWeekPrograms.length;
        if (weeklyRemaining <= 0) continue;

        const neededToday = Math.min(dailyCount, weeklyRemaining) - todayPrograms.length;
        const remaining = Math.max(0, neededToday);

        if (remaining <= 0) continue;

        if (!pType.userId) {
          console.error(`[scheduler] Skipping "${pType.name}": program type has no owner (user_id is null).`);
          continue;
        }

        console.log(`[scheduler] Auto-generating ${remaining} program(s) for "${pType.name}" (${dateStr})`);

        try {
          const pipelineBody: Record<string, any> = { count: remaining, scheduledDate: dateStr };
          if (pType.isWeatherForecast) {
            pipelineBody.forecastDays = Math.min(7, Math.max(1, pType.defaultForecastDays || 1));
          }
          const res = await fetch(`http://localhost:${process.env.PORT || 5000}/api/programs/${pType.id}/auto-pipeline`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...internalAuthHeaders(pType.userId),
            },
            body: JSON.stringify(pipelineBody),
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error(`[scheduler] Pipeline failed for "${pType.name}": ${res.status} ${detail.slice(0, 200)}`);
          }
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

  app.post("/api/remux-audio", requireAdmin, async (_req, res) => {
    try {
      const audioDir = path.join(process.cwd(), "public", "audio");
      const { readdir } = await import("fs/promises");
      const files = await readdir(audioDir);
      const mp3Files = files.filter(f => f.endsWith(".mp3") && !f.startsWith("_"));

      let fixed = 0;
      let errors = 0;
      for (const file of mp3Files) {
        const filePath = path.join(audioDir, file);
        if (remuxedCache.has(filePath)) continue;
        try {
          await ensureRemuxed(filePath);
          fixed++;
        } catch {
          errors++;
        }
      }

      res.json({ total: mp3Files.length, fixed, errors, cached: remuxedCache.size });
    } catch (error) {
      console.error("Error remuxing audio:", error);
      res.status(500).json({ error: "Failed to remux audio files" });
    }
  });

  app.post("/api/run-scheduler", requireAdmin, async (_req, res) => {
    runAutoScheduler();
    res.json({ status: "Scheduler triggered" });
  });

  async function getUserCustomHolidays(userId: string) {
    const raw = await storage.getCustomHolidays(userId);
    return raw.map(h => ({
      date: h.date,
      name: h.name,
      nameRu: h.nameRu,
      country: h.country as "TR" | "RU" | "BOTH",
      isPublic: h.isPublic ?? false,
    }));
  }

  app.get("/api/holidays", async (req, res) => {
    try {
      const { year, month, date, country } = req.query;
      const userHolidays = await getUserCustomHolidays(req.session.userId!);

      let resolvedCountry: string | null = null;
      if (country && typeof country === "string") {
        resolvedCountry = country.toUpperCase();
      } else {
        const stSettings = await storage.getSettings(req.session.userId);
        resolvedCountry = resolveStationCountry(stSettings?.stationLocation);
      }

      const filterByCountry = (holidays: ReturnType<typeof getHolidaysForDate>) => {
        if (!resolvedCountry) return holidays;
        return holidays.filter(h => h.country === resolvedCountry || h.country === "BOTH");
      };

      if (date && typeof date === "string") {
        return res.json(filterByCountry(getHolidaysForDate(date, userHolidays)));
      }
      if (year) {
        const y = parseInt(year as string);
        if (isNaN(y)) return res.status(400).json({ error: "Invalid year" });
        if (month) {
          const m = parseInt(month as string);
          if (isNaN(m) || m < 1 || m > 12) return res.status(400).json({ error: "Invalid month" });
          return res.json(filterByCountry(getHolidaysForMonth(y, m, userHolidays)));
        }
        return res.json(filterByCountry(getHolidaysForYear(y, userHolidays)));
      }
      return res.json(filterByCountry(getHolidaysForYear(new Date().getFullYear(), userHolidays)));
    } catch (error) {
      res.status(500).json({ error: "Failed to get holidays" });
    }
  });

  async function refreshCustomHolidays() {
    try {
      const custom = await storage.getAllCustomHolidays();
      setCustomHolidays(custom);
    } catch (e) {
      console.warn("[holidays] Could not load custom holidays:", (e as any).message);
    }
  }
  refreshCustomHolidays();

  app.get("/api/custom-holidays", async (req, res) => {
    try {
      const holidays = await storage.getCustomHolidays(req.session.userId!);
      res.json(holidays);
    } catch (error) {
      res.status(500).json({ error: "Failed to get custom holidays" });
    }
  });

  const MMDD_REGEX = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  app.post("/api/custom-holidays", async (req, res) => {
    try {
      const data = insertCustomHolidaySchema.parse(req.body);
      if (!MMDD_REGEX.test(data.date)) {
        return res.status(400).json({ error: "Date must be in MM-DD format" });
      }
      const holiday = await storage.createCustomHoliday({ ...data, userId: req.session.userId });
      await refreshCustomHolidays();
      res.json(holiday);
    } catch (error) {
      res.status(400).json({ error: "Failed to create custom holiday" });
    }
  });

  app.patch("/api/custom-holidays/:id", async (req, res) => {
    try {
      if (req.body.date && !MMDD_REGEX.test(req.body.date)) {
        return res.status(400).json({ error: "Date must be in MM-DD format" });
      }
      const holiday = await storage.updateCustomHoliday(req.params.id, req.session.userId!, req.body);
      if (!holiday) return res.status(404).json({ error: "Holiday not found" });
      await refreshCustomHolidays();
      res.json(holiday);
    } catch (error) {
      res.status(400).json({ error: "Failed to update custom holiday" });
    }
  });

  app.delete("/api/custom-holidays/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteCustomHoliday(req.params.id, req.session.userId!);
      if (!deleted) return res.status(404).json({ error: "Holiday not found" });
      await refreshCustomHolidays();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete custom holiday" });
    }
  });

  app.get("/api/schedule-templates", async (req, res) => {
    try {
      const templates = await storage.getScheduleTemplates(req.session.userId!);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to get schedule templates" });
    }
  });

  app.get("/api/schedule-templates/:id", async (req, res) => {
    try {
      const template = await storage.getScheduleTemplate(req.params.id, req.session.userId!);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to get template" });
    }
  });

  app.post("/api/schedule-templates", async (req, res) => {
    try {
      const parsed = insertScheduleTemplateSchema.parse(req.body);
      if (parsed.startHour === parsed.endHour) {
        return res.status(400).json({ error: "startHour and endHour cannot be the same" });
      }
      if (parsed.slotsPerHour < 1 || parsed.slotsPerHour > 4) {
        return res.status(400).json({ error: "slotsPerHour must be between 1 and 4" });
      }
      if (!parsed.weekdays?.length || !parsed.weekdays.every(d => d >= 1 && d <= 7)) {
        return res.status(400).json({ error: "weekdays must contain values 1-7" });
      }
      const template = await storage.createScheduleTemplate({ ...parsed, userId: req.session.userId });
      res.json(template);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid template data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.patch("/api/schedule-templates/:id", async (req, res) => {
    try {
      const parsed = insertScheduleTemplateSchema.partial().parse(req.body);
      if (parsed.startHour !== undefined && parsed.endHour !== undefined && parsed.startHour === parsed.endHour) {
        return res.status(400).json({ error: "startHour and endHour cannot be the same" });
      }
      if (parsed.slotsPerHour !== undefined && (parsed.slotsPerHour < 1 || parsed.slotsPerHour > 4)) {
        return res.status(400).json({ error: "slotsPerHour must be between 1 and 4" });
      }
      if (parsed.weekdays !== undefined && (!parsed.weekdays.length || !parsed.weekdays.every(d => d >= 1 && d <= 7))) {
        return res.status(400).json({ error: "weekdays must contain values 1-7" });
      }
      const template = await storage.updateScheduleTemplate(req.params.id, req.session.userId!, parsed);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid template data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/schedule-templates/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteScheduleTemplate(req.params.id, req.session.userId!);
      if (!deleted) return res.status(404).json({ error: "Template not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  app.get("/api/schedule-templates/:id/shifts", async (req, res) => {
    try {
      const template = await storage.getScheduleTemplate(req.params.id, req.session.userId!);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      const shifts = await storage.getHostShifts(req.params.id);
      res.json(shifts);
    } catch (error) {
      res.status(500).json({ error: "Failed to get host shifts" });
    }
  });

  app.post("/api/host-shifts", async (req, res) => {
    try {
      const parsed = insertHostShiftSchema.parse(req.body);
      if (parsed.startHour === parsed.endHour) {
        return res.status(400).json({ error: "startHour and endHour cannot be the same" });
      }
      if (!parsed.voiceIds?.length) {
        return res.status(400).json({ error: "voiceIds must not be empty" });
      }
      const template = await storage.getScheduleTemplate(parsed.templateId, req.session.userId!);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      const shift = await storage.createHostShift({ ...parsed, userId: req.session.userId });
      res.json(shift);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid shift data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create host shift" });
    }
  });

  app.patch("/api/host-shifts/:id", async (req, res) => {
    try {
      const parsed = insertHostShiftSchema.partial().parse(req.body);
      if (parsed.startHour !== undefined && parsed.endHour !== undefined && parsed.startHour === parsed.endHour) {
        return res.status(400).json({ error: "startHour and endHour cannot be the same" });
      }
      const shift = await storage.updateHostShift(req.params.id, req.session.userId!, parsed);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      res.json(shift);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid shift data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update shift" });
    }
  });

  app.delete("/api/host-shifts/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteHostShift(req.params.id, req.session.userId!);
      if (!deleted) return res.status(404).json({ error: "Shift not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete shift" });
    }
  });

  app.get("/api/resolve-slots", async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== "string") {
        return res.status(400).json({ error: "date query parameter is required" });
      }

      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      const jsDay = dateObj.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      const template = await storage.getTemplateForWeekday(weekday, req.session.userId!);
      const settings = await storage.getSettings(req.session.userId);

      const userHolidays = await getUserCustomHolidays(req.session.userId!);
      const allHolidays = getHolidaysForDate(date, userHolidays);
      const stationCountry = resolveStationCountry(settings?.stationLocation);
      const holidays = stationCountry
        ? allHolidays.filter(h => h.country === stationCountry || h.country === "BOTH")
        : allHolidays;

      if (!template) {
        const totalSlots = settings?.dailyDialogsCount || 12;
        const slots = [];
        for (let i = 1; i <= totalSlots; i++) {
          const startHour = 7;
          const endHour = 22;
          const hoursRange = endHour - startHour;
          const slotDuration = hoursRange / totalSlots;
          const slotHour = startHour + (i - 1) * slotDuration;
          const hour = Math.floor(slotHour);
          const minutes = Math.round((slotHour - hour) * 60);
          slots.push({
            slotNumber: i,
            time: `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
            hour,
            voiceIds: null,
          });
        }
        return res.json({ template: null, slots, holidays });
      }

      const shifts = await storage.getHostShifts(template.id);
      const isOvernight = template.endHour <= template.startHour;
      const hoursSpan = isOvernight ? (24 - template.startHour + template.endHour) : (template.endHour - template.startHour);
      const totalSlots = hoursSpan * template.slotsPerHour;
      const slots = [];

      for (let i = 0; i < totalSlots; i++) {
        const rawHour = template.startHour + i / template.slotsPerHour;
        const slotHour = rawHour % 24;
        const hour = Math.floor(slotHour);
        const minutes = Math.round((slotHour - hour) * 60);

        const matchingShift = shifts.find(s => {
          const shiftOvernight = s.endHour <= s.startHour;
          if (shiftOvernight) {
            return hour >= s.startHour || hour < s.endHour;
          }
          return hour >= s.startHour && hour < s.endHour;
        });
        const voiceIds = matchingShift?.voiceIds || template.voiceIds || null;

        slots.push({
          slotNumber: i + 1,
          time: `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
          hour,
          voiceIds,
          shiftLabel: matchingShift?.label || null,
        });
      }

      return res.json({ template, slots, holidays });
    } catch (error) {
      res.status(500).json({ error: "Failed to resolve slots" });
    }
  });

  app.post("/api/admin/fix-orphan-programs", requireAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const typesResult = await pool.query("SELECT id, user_id FROM program_types WHERE user_id IS NOT NULL");
      const typeOwnerMap = new Map<string, string>();
      for (const t of typesResult.rows) {
        typeOwnerMap.set(t.id, t.user_id);
      }

      const orphansResult = await pool.query("SELECT id, program_type_id FROM programs WHERE user_id IS NULL");
      let fixed = 0;
      for (const p of orphansResult.rows) {
        const ownerId = typeOwnerMap.get(p.program_type_id);
        if (ownerId) {
          await pool.query("UPDATE programs SET user_id = $1 WHERE id = $2", [ownerId, p.id]);
          fixed++;
        }
      }

      res.json({ message: `Fixed ${fixed} orphan programs out of ${orphansResult.rows.length}` });
    } catch (error) {
      console.error("Error fixing orphan programs:", error);
      res.status(500).json({ error: "Failed to fix orphan programs" });
    }
  });

  return httpServer;
}
