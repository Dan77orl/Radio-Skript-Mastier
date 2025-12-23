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

### AI Integration Pattern
- **Claude (Anthropic)**: Primary AI for text generation (better quality Russian texts)
  - API key stored in database settings, entered via admin UI
  - Uses claude-sonnet-4-20250514 model
- **OpenAI** (via Replit AI Integrations): Fallback when Claude API key not configured
  - Configured through environment variables `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`
- Includes batch processing utilities with rate limiting and retries
- Image generation capabilities available through gpt-image-1 model

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

### Build and Development
- Vite plugins for Replit integration (cartographer, dev-banner, runtime-error-modal)
- esbuild for production server bundling with specific dependency allowlist