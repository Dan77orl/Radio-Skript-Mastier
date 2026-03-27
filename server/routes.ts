import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerUser, loginUser, logoutUser, getCurrentUser, completeOnboarding, updateUserLanguage, requireAuth, requireAdmin } from "./auth";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { insertSettingsSchema, insertDialogSchema, insertNewsSourceSchema, insertAdSchema, insertAdPresetSchema, insertVoiceSchema, insertScheduleTemplateSchema, insertHostShiftSchema, insertCustomHolidaySchema } from "@shared/schema";
import { getHolidaysForDate, getHolidaysForYear, getHolidaysForMonth, getHolidayInfo, setCustomHolidays } from "./holidays";
import { getPromptStrings, getGenderLabel, getDefaultHostName, getLanguageDirective, getLanguageName } from "./prompt-locale";
import { handleSupportChat } from "./support-chat";
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

function getEffectiveElevenLabsKey(settings: any): string | null {
  return settings?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || null;
}

function getEffectiveAnthropicKey(settings: any): string | null {
  return process.env.ANTHROPIC_API_KEY || settings?.anthropicApiKey || null;
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

async function concatMp3WithFfmpeg(segmentFiles: string[], outputFile: string, tmpDir: string, timestamp: number): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const listFile = path.join(tmpDir, `_concat_${timestamp}.txt`);
  const listContent = segmentFiles.map(f => `file '${f}'`).join("\n");
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
    console.log(`ffmpeg concat: ${segmentFiles.length} segments -> ${path.basename(outputFile)}`);
  } catch (err: any) {
    console.warn("ffmpeg concat failed, falling back to Buffer.concat:", err.message);
    const buffers: Buffer[] = [];
    for (const f of segmentFiles) {
      buffers.push(await fs.readFile(f));
    }
    await fs.writeFile(outputFile, Buffer.concat(buffers));
  } finally {
    await fs.unlink(listFile).catch(() => {});
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
    temperature_max: number[];
    temperature_min: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
  };
}

const DEFAULT_COORDS = { lat: 36.5444, lon: 31.9997 };

async function fetchWeather(lat?: number, lon?: number): Promise<WeatherData | null> {
  try {
    const useLat = lat ?? DEFAULT_COORDS.lat;
    const useLon = lon ?? DEFAULT_COORDS.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset&timezone=auto`;
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

  app.post("/api/auth/register", registerUser);
  app.post("/api/auth/login", loginUser);
  app.post("/api/auth/logout", logoutUser);
  app.get("/api/auth/me", getCurrentUser);
  app.patch("/api/auth/language", updateUserLanguage);
  app.post("/api/auth/complete-onboarding", completeOnboarding);

  app.post("/api/support-chat", handleSupportChat);

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

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    if (req.path === "/support-chat") return next();
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

      if (settingsData?.anthropicApiKey) {
        const anthropic = new Anthropic({ apiKey: settingsData.anthropicApiKey });
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
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

      await concatMp3WithFfmpeg([maleFile, femaleFile], combinedFile, audioDir, timestamp);

      await fs.unlink(maleFile).catch(() => {});
      await fs.unlink(femaleFile).catch(() => {});

      const dialog = await storage.createDialog({
        userId: req.session.userId,
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
              max_tokens: 1024,
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
          max_tokens: 1024,
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
          max_tokens: 512,
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

  app.post("/api/ads/:id/synthesize-audio", async (req, res) => {
    try {
      const { id } = req.params;
      const { voiceIds, voiceName: requestVoiceName, speakerVoiceMap: reqSpeakerVoiceMap } = req.body;
      
      const ad = await storage.getAd(id, req.session.userId!);
      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.selectedVariantText) {
        return res.status(400).json({ error: "No variant selected" });
      }

      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const defaultVoiceId = voiceIds?.[0] || settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9";
      const scriptText = ad.selectedVariantText;
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
      res.json({ message: "Audio generation started" });

      (async () => {
        try {
          const audioDir = path.join(process.cwd(), "public", "audio");
          await fs.mkdir(audioDir, { recursive: true });
          const timestamp = Date.now();

          let finalAudioFile: string;
          let voiceNameForVersion: string;

          if (isMultiSpeaker) {
            const segments = parseMultiSpeakerScript(scriptText);
            const spkVoiceMap: Record<string, string> = reqSpeakerVoiceMap || {};

            const allVoices = await storage.getVoices(req.session.userId!);
            const voiceNameMap = new Map<string, string>();
            for (const v of allVoices) {
              voiceNameMap.set(v.elevenLabsVoiceId, v.personaName || v.name);
            }

            const segmentFiles: string[] = [];
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

              const segResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${segVoiceId}`, {
                method: "POST",
                headers: {
                  "xi-api-key": settings.elevenLabsApiKey!,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  text: cleanText,
                  model_id: "eleven_v3",
                  output_format: "mp3_44100_192",
                  voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                }),
              });

              if (!segResponse.ok) {
                const errorText = await segResponse.text();
                throw new Error(`ElevenLabs API error for segment ${i}: ${segResponse.status} - ${errorText}`);
              }

              const segBuffer = Buffer.from(await segResponse.arrayBuffer());
              const segFile = path.join(audioDir, `_ad_seg_${timestamp}_${i}.mp3`);
              await fs.writeFile(segFile, segBuffer);
              segmentFiles.push(segFile);

              const vName = voiceNameMap.get(segVoiceId) || segVoiceId;
              if (!usedVoiceNames.includes(vName)) usedVoiceNames.push(vName);
            }

            finalAudioFile = path.join(audioDir, `ad_${id}_${timestamp}.mp3`);
            await concatMp3WithFfmpeg(segmentFiles, finalAudioFile, audioDir, timestamp);

            for (const sf of segmentFiles) {
              await fs.unlink(sf).catch(() => {});
            }

            voiceNameForVersion = usedVoiceNames.join(" + ");
          } else {
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}`, {
              method: "POST",
              headers: {
                "xi-api-key": settings.elevenLabsApiKey!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: scriptText,
                model_id: "eleven_v3",
                output_format: "mp3_44100_192",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
            }

            const audioBuffer = Buffer.from(await response.arrayBuffer());
            finalAudioFile = path.join(audioDir, `ad_${id}_${timestamp}.mp3`);
            await fs.writeFile(finalAudioFile, audioBuffer);

            const allVoices = await storage.getVoices(req.session.userId!);
            const usedVoice = allVoices.find(v => v.elevenLabsVoiceId === defaultVoiceId);
            voiceNameForVersion = usedVoice ? (usedVoice.personaName || usedVoice.name) : (requestVoiceName || defaultVoiceId);
          }

          const newAudioUrl = `/audio/ad_${id}_${timestamp}.mp3`;
          const fileStats = await fs.stat(finalAudioFile);
          const estimatedDuration = Math.round(fileStats.size / 24000);

          const freshAd = await storage.getAd(id, req.session.userId!);
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

          await storage.updateAd(id, req.session.userId!, {
            audioUrl: newAudioUrl,
            audioVersions: JSON.stringify(existingVersions),
            duration: estimatedDuration,
            status: "ready",
            stage: "audio",
          });

          console.log(`Audio generated for ad ${id} (version ${existingVersions.length})${isMultiSpeaker ? " [multi-speaker]" : ""}`);
        } catch (error) {
          console.error(`Error generating audio for ad ${id}:`, error);
          await storage.updateAd(id, req.session.userId!, { status: "error" });
        }
      })();
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
        return res.status(404).json({ error: "Audio file not found on disk" });
      }

      const remuxed = await ensureRemuxed(audioPath);

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

        const settings = await storage.getSettings(req.session.userId);
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
          name: name,
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
      const settings = await storage.getSettings(req.session.userId);
      if (!settings?.elevenLabsApiKey) {
        return res.status(400).json({ error: "ElevenLabs API key not configured" });
      }

      const query = (req.query.q as string) || "";
      const gender = req.query.gender as string | undefined;
      const language = req.query.language as string | undefined;
      const page = parseInt(req.query.page as string) || 0;
      const pageSize = 100;

      const params = new URLSearchParams({
        page_size: String(pageSize),
        page: String(page),
      });
      if (query) params.append("search", query);
      if (gender && gender !== "all") params.append("gender", gender);
      if (language && language !== "all") params.append("language", language);

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

  async function generateSmartSearchQueries(programPrompt: string, stationPrompt: string, topics: string[], userId?: string): Promise<string[]> {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];

    const contextParts: string[] = [];
    if (stationPrompt) contextParts.push(`ПРОМПТ СТАНЦИИ:\n${stationPrompt.substring(0, 500)}`);
    if (programPrompt) contextParts.push(`ПРОМПТ ПЕРЕДАЧИ:\n${programPrompt.substring(0, 1500)}`);
    if (topics.length > 0) contextParts.push(`КЛЮЧЕВЫЕ СЛОВА: ${topics.join(", ")}`);

    const aiPrompt = `Дата: ${dateStr}

${contextParts.join("\n\n")}

На основе промпта передачи и станции сгенерируй 4-6 поисковых запросов для веб-поиска актуальных новостей.

ПРАВИЛА:
1. Запросы должны покрывать ВСЕ направления из промпта (если написано "мировой, турецкий, российский" — нужны запросы по КАЖДОМУ)
2. Запросы на РАЗНЫХ языках: английский для мировых тем, русский для российских, можно турецкий для турецких
3. Запросы должны находить СВЕЖИЕ новости (добавляй "2026", "latest", "news", "today")
4. Каждый запрос — 3-6 слов, конкретный и поисковый
5. НЕ дублируй одну и ту же тему на разных языках

Примеры хороших запросов для шоу-бизнеса:
- "Hollywood celebrity news March 2026"
- "Turkish TV series stars 2026"
- "российские звёзды новости сегодня"
- "Grammy Oscar awards 2026"
- "турецкие сериалы актёры новости"

Ответь JSON: {"queries": ["запрос1", "запрос2", ...]}`;

    try {
      const settingsData = await storage.getSettings(userId);
      let respText = "";

      if (settingsData?.anthropicApiKey) {
        const anthropic = new Anthropic({ apiKey: settingsData.anthropicApiKey });
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 300,
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

  async function researchForProgram(topics: string[], programPrompt?: string, stationPrompt?: string, userId?: string): Promise<string> {
    const hasPromptContext = (programPrompt && programPrompt.length > 20) || (topics && topics.length > 0);
    if (!hasPromptContext) return "";

    let searchQueries: string[];
    if (programPrompt && programPrompt.length > 20) {
      searchQueries = await generateSmartSearchQueries(programPrompt, stationPrompt || "", topics || [], userId);
    } else {
      searchQueries = topics.slice(0, 4);
    }

    if (searchQueries.length === 0) return "";

    const allResults: string[] = [];
    for (const query of searchQueries.slice(0, 5)) {
      const results = await firecrawlSearch(query, 2);
      allResults.push(...results);
    }

    if (allResults.length === 0) return "";

    return `\n\nАКТУАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА — ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ:\n${allResults.map((r, i) => `--- Источник ${i + 1} ---\n${r}`).join("\n\n")}\n\nКАК ИСПОЛЬЗОВАТЬ ДАННЫЕ ИЗ ИНТЕРНЕТА:\n- ВПЛЕТАЙ факты и цифры в повествование ЕСТЕСТВЕННО, как часть истории: "Кстати, тут интересная цифра — ...", "Я нашёл, что..."\n- НЕ перечисляй факты списком — каждый факт должен быть частью связного рассказа\n- Используй КОНКРЕТНЫЕ данные: названия мест, цены, цифры из источников выше\n- НЕ ВЫДУМЫВАЙ факты, которых нет в источниках. Если чего-то нет — расскажи из личного опыта ведущего\n- Привязывай факты к жизни слушателя: "Это значит, что для вас...", "На практике это выглядит так..."`;
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

      if (settingsData?.anthropicApiKey) {
        const anthropic = new Anthropic({ apiKey: settingsData.anthropicApiKey });
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 500,
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
      const research = await researchForProgram(topics, programType.defaultPrompt || "", settingsForResearch?.defaultPrompt || "", req.session?.userId);
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
      const dateStr = today.toISOString().split("T")[0];

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

      const durationSec = programType.defaultDurationSeconds || 60;
      const wordsPerMinute = 150;
      const targetWords = Math.round((durationSec / 60) * wordsPerMinute);
      const minWords = Math.round(targetWords * 0.8);
      const maxWords = Math.round(targetWords * 1.15);
      const durationMin = Math.floor(durationSec / 60);
      const durationRemSec = durationSec % 60;
      const durationStr = durationRemSec > 0 ? `${durationMin}:${String(durationRemSec).padStart(2, "0")}` : `${durationMin}:00`;
      prompt += `\n\n${ps.dateSlot(dateStr, nextSlot, programType.dailyCount || 1)}`;

      const month = today.getMonth();
      const season = month <= 1 || month === 11 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "autumn";
      prompt += `\n${ps.seasonPrefix} ${ps.seasons[season]}`;
      prompt += `\n${ps.seasonNote}`;

      prompt += `\n\n${ps.durationStrict(durationSec, durationStr, minWords, maxWords)}`;

      const hasSearchContext = fcKeywords.length > 0 || (rawPrompt && rawPrompt.length > 50);
      if (hasSearchContext) {
        try {
          const stationSettings = await storage.getSettings(req.session.userId);
          const research = await researchForProgram(fcKeywords, rawPrompt, stationSettings?.defaultPrompt || "", req.session.userId);
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

      {
        const scriptsWithFormat = existingPrograms
          .filter(p => p.scriptText && p.scriptText.includes("]:"))
          .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

        const latestRef = scriptsWithFormat[0];

        if (latestRef?.scriptText) {
          prompt += `\n\n${ps.referenceFormat(latestRef.scriptText.substring(0, 3000))}`;
        }
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
      } catch (genError) {
        console.error("Script generation failed:", genError);
        return res.status(500).json({ error: ps.generationFailed });
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

      const batchRawPrompt = programType.defaultPrompt || "";
      const batchHasSearchContext = fcKeywords.length > 0 || (batchRawPrompt && batchRawPrompt.length > 50);
      if (batchHasSearchContext) {
        try {
          const batchStationSettings = await storage.getSettings(req.session.userId);
          const research = await researchForProgram(fcKeywords, batchRawPrompt, batchStationSettings?.defaultPrompt || "", req.session.userId);
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
      const batchDurationSec = programType.defaultDurationSeconds || 60;
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

      const genDurationSec = programType.defaultDurationSeconds || 60;
      const genTargetWords = Math.round((genDurationSec / 60) * 150);
      const genMinWords = Math.round(genTargetWords * 0.8);
      const genMaxWords = Math.round(genTargetWords * 1.15);
      const genDurStr = `${Math.floor(genDurationSec / 60)}:${String(genDurationSec % 60).padStart(2, "0")}`;
      systemPrompt += `\n\n${psGen.durationStrict(genDurationSec, genDurStr, genMinWords, genMaxWords)}`;

      const settingsForGen = await storage.getSettings(req.session.userId);
      const stationDefaultPromptGen = settingsForGen?.defaultPrompt || "";
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
          const speakerName = getCleanVoiceName(voice);
          speakerVoiceMap.set(speakerName.toLowerCase(), voice.elevenLabsVoiceId);
        }

        const segmentFiles: string[] = [];
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
            const segFile = path.join(audioDir, `_seg_${timestamp}_${i}.mp3`);
            await fs.writeFile(segFile, buffer);
            segmentFiles.push(segFile);
          } catch (err) {
            console.error(`Segment ${i + 1} synthesis error:`, err);
            segmentErrors.push(`Сегмент ${i + 1} (${segment.speaker}): ошибка синтеза`);
          }
        }

        if (segmentFiles.length === 0) {
          return res.status(500).json({ error: "Не удалось озвучить ни один сегмент", details: segmentErrors });
        }

        const filename = resolveFileName(programType?.fileNameTemplate, programType, program, timestamp);
        const outputFile = path.join(audioDir, filename);

        const combined = await concatMp3WithFfmpeg(segmentFiles, outputFile, audioDir, timestamp);

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

        logUsage(req.session.userId!, "audio_generation", "program_multi_speaker");
        res.json({ ...updated, segmentCount: segmentFiles.length, totalSegments: totalExpected, errors: segmentErrors });
      } else {
        const resolved = resolveAssignedVoices(voicesList, programType);
        const activeVoice = resolved.length > 0 ? resolved[0] : voicesList.find(v => v.isActive);

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
        return res.status(404).json({ error: "Audio file not found on disk" });
      }

      const remuxed = await ensureRemuxed(audioPath);

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
            try {
              const settings = await storage.getSettings(req.session.userId);
              if (settings?.yandexDiskToken) {
                const normalizedUrl = program.audioUrl.startsWith("/") ? program.audioUrl.slice(1) : program.audioUrl;
                const audioPath = path.join(process.cwd(), "public", normalizedUrl);
                const fileData = await fs.readFile(audioPath);
                const yandexFolder = programType.uploadFolder || `/radio/${programType.slug}`;

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
                  await storage.updateProgram(program.id, req.session.userId!, {
                    uploadedToYandex: true,
                    yandexPath: `${yandexFolder}/${fileName}`,
                  });
                  program.uploadedToYandex = true;
                  logUsage(req.session.userId!, "file_upload", "yandex_disk");
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

  app.post("/api/remux-audio", async (_req, res) => {
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

  app.post("/api/run-scheduler", async (_req, res) => {
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

  app.post("/api/admin/fix-orphan-programs", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !isAdmin(user.email)) return res.status(403).json({ error: "Forbidden" });

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
