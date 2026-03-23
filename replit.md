# Radio Dialog Automation System

## Overview

This is a Radio Dialog Automation System for "Alanya FM" - a Russian-language radio station serving expats in Alanya, Turkey. The application enables radio hosts to generate AI-powered dialog scripts, convert them to audio using text-to-speech, and manage a daily broadcast schedule.

The system automates the creation of short conversational dialogs between male and female radio hosts, covering topics like expat life, local tips, weather, and Turkish culture.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with HMR support

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript compiled with tsx
- **API Style**: RESTful JSON APIs under `/api/*` prefix
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Schema Validation**: Zod with drizzle-zod for type-safe schemas

### Key Design Patterns
- **Monorepo Structure**: Client (`/client`), Server (`/server`), and Shared (`/shared`) directories
- **Path Aliases**: `@/*` for client imports, `@shared/*` for shared code
- **Type Sharing**: Database schemas and types defined in `/shared/schema.ts` are used by both frontend and backend
- **Storage Interface**: Abstract `IStorage` interface allowing for different storage implementations

### Core Entities
1. **Users** - Basic authentication support
2. **Settings** - Application configuration (API keys, voice IDs, default prompts)
3. **Dialogs** - Generated radio scripts with status tracking (pending, generating, ready, error)
4. **Schedule Templates** - Per-weekday broadcast templates (name, weekdays, startHour, endHour, slotsPerHour, voiceIds)
5. **Host Shifts** - Time-based host rotation within templates (templateId, startHour, endHour, voiceIds, label)

### Schedule System
- **Flexible Templates**: Each template covers specific weekdays with configurable broadcast hours and slot density (slots per hour)
- **Host Rotation**: Host shifts define which voices are assigned to which time ranges within a template
- **Holiday Calendar**: Static holiday data for Turkey and Russia (including Islamic holidays for 2025-2026) in `server/holidays.ts`
- **Slot Resolution**: `GET /api/resolve-slots?date=YYYY-MM-DD` resolves the template for a given date, returns slot times with assigned voices and holiday info
- **Generator Integration**: Generator page uses resolved slots to show time labels, host names, and shift labels per slot
- **Schedule View**: Calendar week view shows holiday markers on each day
- **UI**: "Настройка" (Settings) tab in Podvodki page for managing templates, weekday assignments, and host shifts with visual timeline

### AI Integration Pattern
- **Claude (Anthropic)**: Primary AI for ALL text generation
  - Dialog scripts, ad variants, prompt improvement, document extraction (PDF/images)
  - API key stored in database settings, entered via admin UI
  - Uses claude-sonnet-4-20250514 model
  - Note: Claude API does NOT support direct audio input
- **OpenAI** (via Replit AI Integrations): Fallback when Claude API key not configured
  - Configured through environment variables `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`
- **Gemini** (via Replit AI Integrations): Voice transcription ONLY
  - Uses gemini-2.5-flash model for audio-to-text transcription
  - Only service that handles audio input (Claude doesn't support it)
  - Configured through `AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL`
  - Costs are billed to Replit credits (no separate API key needed)
- Includes batch processing utilities with rate limiting and retries
- Image generation capabilities available through gpt-image-1 model
- **Batch Program Generation**: Accepts a URL (ChatGPT share link, web page) + voice/text instructions to auto-generate 5-50 programs in batch. Uses cheerio for HTML content extraction. Programs distributed across days based on dailyCount settings.
- **Multi-Speaker Script Support**: When a program type has 2+ assigned voices, scripts are generated in multi-speaker format:
  - Format: `[SpeakerName]: [emotion_tag] text...` with one speaker per line
  - Emotion tags: `[energetic]`, `[fast]`, `[surprised]`, `[thoughtful]`, `[happy]`, `[announcer]`, etc.
  - Tags are stripped before TTS synthesis; they serve as editorial/visual markers
  - Audio generation: parses script into segments, matches speaker names to voices via `personaName`, synthesizes each segment separately, concatenates into one MP3 file
  - Frontend renders multi-speaker scripts with color-coded speaker names and styled emotion tags
  - Supports fuzzy speaker-to-voice matching (partial name match as fallback)

## External Dependencies

### Database
- **PostgreSQL**: Primary database accessed via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database operations with migration support via `drizzle-kit`

### AI Services
- **Anthropic Claude**: Primary AI for dialog script generation (API key stored in settings)
- **OpenAI API** (via Replit AI Integrations): Fallback for dialog script generation
- **ElevenLabs**: Text-to-speech service for audio generation (API key stored in settings)

### Cloud Storage
- **Yandex Disk**: File storage for generated audio files (token stored in settings)

### Voice Configuration
- Default male voice ID: `onwK4e9ZLuTAKqWW03F9`
- Default female voice ID: `EXAVITQu4vr4xnSDxMaL`

### Automatic Weekly Pipeline
- **Auto-generation Settings**: Per program type: `autoGenerate`, `weeklyCount`, `autoVoice`, `autoUpload` fields
- **Pipeline Endpoint**: `POST /api/programs/:typeId/auto-pipeline` — creates scripts, generates audio, uploads to Yandex Disk in sequence
- **Scheduler**: Runs on startup (30s delay) then hourly. Checks which types have `autoGenerate=true`, calculates daily needs from `weeklyCount`, auto-triggers pipeline for any shortfall
- **Manual Trigger**: `POST /api/run-scheduler` — forces immediate scheduler run
- **UI Controls**: Settings dialog shows auto-generation toggle with weekly count, auto-voice, and auto-upload options. "Пайплайн" button visible when auto-generate is enabled

### Firecrawl Integration
- **API Key**: Stored in `FIRECRAWL_API_KEY` environment variable
- **Search Endpoint**: `POST /api/firecrawl/search` — searches web via Firecrawl API, returns markdown content
- **Research Endpoint**: `POST /api/firecrawl/research/:typeId` — runs topic-based research for a program type
- **Auto-Create Integration**: When `useFirecrawl=true` on a program type, auto-create fetches fresh web content based on `firecrawlTopics` array and injects it into the AI prompt as factual source material
- **Schema Fields**: `useFirecrawl: boolean`, `firecrawlTopics: text[]` on `programTypes` table
- **UI**: Settings dialog has Firecrawl section with topic management (add/remove badges), test search button, and toggle

### Build and Development
- Vite plugins for Replit integration (cartographer, dev-banner, runtime-error-modal)
- esbuild for production server bundling with specific dependency allowlist