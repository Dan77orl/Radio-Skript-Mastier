import type { Request, Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const sessionChats = new Map<string, ChatMessage[]>();
const adminReplyTracker = new Map<string, Set<string>>();

// Hard cap so an unauthenticated caller that discards cookies (a new session id
// per request) cannot grow these maps without bound between cleanup passes.
const MAX_TRACKED_SESSIONS = 5000;

function rememberSession(sessionId: string, history: ChatMessage[]) {
  if (sessionChats.size >= MAX_TRACKED_SESSIONS && !sessionChats.has(sessionId)) {
    const oldest = sessionChats.keys().next().value;
    if (oldest !== undefined) {
      sessionChats.delete(oldest);
      adminReplyTracker.delete(oldest);
    }
  }
  sessionChats.set(sessionId, history);
}

const CLEANUP_INTERVAL = 60 * 60 * 1000;
setInterval(() => {
  sessionChats.clear();
  adminReplyTracker.clear();
}, CLEANUP_INTERVAL);

const MAX_MESSAGE_LENGTH = 2000;

function getSystemPrompt(language: string): string {
  const langInstructions: Record<string, string> = {
    ru: "Отвечай на русском языке.",
    en: "Respond in English.",
    tr: "Türkçe yanıt ver.",
  };

  const langDirective = langInstructions[language] || langInstructions.en;

  return `You are RadioFlow AI Support Assistant — a helpful, friendly, and knowledgeable AI that assists users of the RadioFlow AI platform.

${langDirective}

## About RadioFlow AI
RadioFlow AI is a SaaS platform for radio stations that automates content creation using AI. It generates scripts, creates multi-speaker programs, synthesizes professional audio, and schedules broadcasts.

## Platform Features You Must Know About

### Script Generation (Подводки / Podvodki)
- AI generates radio host dialog scripts using Claude AI or OpenAI
- Scripts can be single-speaker or multi-speaker format
- Multi-speaker scripts use format: [SpeakerName]: [emotion_tag] text...
- Emotion tags like [energetic], [happy], [thoughtful] are visual markers stripped before audio synthesis
- Users can customize prompts, regenerate scripts, and edit them manually

### Show/Program Types (Передачи / Shows)
- Users define different program types (news digests, weather, entertainment, etc.)
- Each program type has its own AI prompt template, assigned voices, and schedule
- Programs can be batch-generated from URLs (ChatGPT share links, web pages)
- Settings per type: auto-generate toggle, weekly count, auto-voice, auto-upload

### Text-to-Speech (TTS)
- Uses ElevenLabs API for professional voice synthesis
- Supports multiple voices with different characteristics
- Multi-speaker scripts are parsed, each segment voiced separately, then concatenated
- Voice settings: voice ID, persona name, gender, active status

### Voices Management
- Add/manage AI voices with ElevenLabs voice IDs
- Each voice has a persona name, gender, and can be assigned to program types
- Preview voices with test phrases
- Assign voices to specific program types or schedule templates

### Schedule System
- Flexible per-day schedule templates for different weekdays
- Host rotation: assign different voices to different time slots
- Holiday calendar (Turkey and Russia holidays built-in)
- Slot resolution: system calculates which voices play at which times

### Ad Production (Реклама / Ads)
- Create radio advertisements with AI
- Multiple script variants per ad
- Upload sponsor reference materials (documents, images, audio)
- Background music mixing capabilities

### Automation Pipeline
- Auto-generation: scripts created automatically based on weekly targets
- Auto-voice: generated scripts are automatically voiced
- Auto-upload: voiced content automatically uploaded to cloud storage (Yandex Disk)
- Scheduler runs hourly, checking which program types need new content

### Cloud Storage
- Integration with Yandex Disk for storing generated audio
- Customizable folder structure and file naming templates
- Automatic upload after audio generation

### Settings
- Station profile: name, description, logo, location
- API keys: Anthropic (Claude), ElevenLabs
- Yandex Disk token for cloud storage
- Knowledge base: attach documents/files for AI context
- Firecrawl integration for web research

### News Sources
- RSS feed integration for fetching current news
- News content used as context for AI script generation

## Common Setup Steps

### Initial Setup
1. Go to Settings page
2. Enter station name and description
3. Add Anthropic API key (for Claude AI) — get from console.anthropic.com
4. Add ElevenLabs API key — get from elevenlabs.io
5. Optionally add Yandex Disk token for cloud storage

### Adding Voices
1. Go to Voices page
2. Click "Add Voice"
3. Enter ElevenLabs voice ID, persona name, and gender
4. Use "Preview" to test the voice
5. Mark voice as active to use in generation

### Creating a Program Type
1. Go to Shows page
2. Click "Add Show Type"
3. Set name, description, and AI prompt template
4. Assign voices to the program type
5. Configure auto-generation settings if desired

### Generating Content
1. Go to the Generator or Shows page
2. Select program type and date
3. Click generate — AI creates scripts based on the prompt
4. Review/edit scripts as needed
5. Click voice button to synthesize audio
6. Upload to cloud storage

### Setting Up Automation
1. In Show type settings, enable "Auto-generate"
2. Set weekly count target
3. Enable "Auto-voice" for automatic TTS
4. Enable "Auto-upload" for cloud storage
5. The system will automatically produce content to meet targets

## Troubleshooting Tips
- If script generation fails: check that Anthropic API key is valid in Settings
- If TTS fails: verify ElevenLabs API key and voice IDs are correct
- If upload fails: check Yandex Disk token is valid
- If schedule shows no slots: ensure schedule templates are configured for the correct weekdays
- Multi-speaker format requires 2+ voices assigned to the program type

## Your Behavior
- Be concise but thorough
- Guide users step-by-step when they ask how to do something
- If you don't know something specific about the platform, say so honestly
- Never make up features that don't exist
- Match the user's tone — be professional but friendly
- When referring to UI elements, use the names as they appear in the interface`;
}

export async function handleSupportChat(req: Request, res: Response) {
  try {
    const { message, language } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: "Message too long" });
    }

    const lang = language || "en";
    const sessionId = req.sessionID;

    if (!sessionId) {
      return res.status(400).json({ error: "Session required" });
    }

    // Persist the session so the same id (and therefore the same chat history)
    // is reused on the next request. Without this, `saveUninitialized: false`
    // hands out a fresh session id per request and history never accumulates.
    (req.session as any).supportChat = true;

    if (!sessionChats.has(sessionId)) {
      try {
        const dbMessages = await storage.getSupportMessagesBySession(sessionId);
        const restored: ChatMessage[] = dbMessages
          .filter(m => m.role === "user" || m.role === "assistant" || m.role === "admin")
          .map(m => ({
            role: m.role === "admin" ? "assistant" as const : m.role as "user" | "assistant",
            content: m.content,
          }));
        rememberSession(sessionId, restored);
        const restoredAdminIds = new Set(
          dbMessages.filter(m => m.role === "admin").map(m => m.id)
        );
        adminReplyTracker.set(sessionId, restoredAdminIds);
      } catch (err) {
        console.error("[support-chat] Failed to restore session history:", err);
        rememberSession(sessionId, []);
      }
    }

    const history = sessionChats.get(sessionId)!;

    const pendingAdminReplies = await (async () => {
      try {
        const dbMessages = await storage.getSupportMessagesBySession(sessionId);
        const adminReplies = dbMessages
          .filter(m => m.role === "admin")
          .slice(-5);
        const seenIds = adminReplyTracker.get(sessionId) || new Set<string>();
        const unseen = adminReplies.filter(r => !seenIds.has(r.id));
        for (const r of unseen) {
          seenIds.add(r.id);
        }
        adminReplyTracker.set(sessionId, seenIds);
        return unseen;
      } catch (err) { console.error("[support-chat] Failed to fetch admin replies:", err); return []; }
    })();

    for (const ar of pendingAdminReplies) {
      history.push({ role: "assistant", content: ar.content });
    }

    history.push({ role: "user", content: message.trim() });

    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }

    try {
      await storage.createSupportMessage({
        userId: req.session?.userId || null,
        sessionId,
        role: "user",
        content: message.trim(),
      });
    } catch (e) {
      console.error("[support-chat] Failed to persist user message:", e);
    }

    const systemPrompt = getSystemPrompt(lang);

    let assistantReply = "";

    // Admin-panel key first, same order as getAnthropicClient in routes.ts:
    // the raw DB value decides, the Replit AI integration is the fallback.
    let anthropic: Anthropic | null = null;
    const rawKey = req.session?.userId
      ? (await storage.getRawSettings(req.session.userId))?.anthropicApiKey
      : null;
    if (rawKey) {
      anthropic = new Anthropic({ apiKey: rawKey });
    } else if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
      anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
    }

    if (anthropic) {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 6000,
        system: systemPrompt,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      const textBlock = response.content.find((c) => c.type === "text");
      assistantReply = textBlock && textBlock.type === "text" ? textBlock.text : "";
    } else {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
        max_completion_tokens: 1024,
      });
      assistantReply = response.choices[0]?.message?.content || "";
    }

    history.push({ role: "assistant", content: assistantReply });

    try {
      await storage.createSupportMessage({
        userId: req.session?.userId || null,
        sessionId,
        role: "assistant",
        content: assistantReply,
      });
    } catch (e) {
      console.error("[support-chat] Failed to persist assistant message:", e);
    }

    res.json({ reply: assistantReply });
  } catch (error) {
    console.error("Support chat error:", error);
    res.status(500).json({ error: "Failed to get support response" });
  }
}
