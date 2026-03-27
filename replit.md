# RadioFlow AI — Radio Content Automation Platform

## Overview
RadioFlow AI is a SaaS platform designed for radio stations to automate content creation, including dialog scripts, multi-speaker programs, and advertisements, using artificial intelligence. Initially developed for a single station, it is expanding into a multi-tenant service. The platform focuses on generating short, conversational dialogs between radio hosts, providing AI-powered script generation, text-to-speech audio, and broadcast scheduling capabilities. The long-term vision is to become the leading AI-powered content automation solution for radio broadcasting globally.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS with CSS variables (light/dark mode)
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript
- **API Style**: RESTful JSON APIs (`/api/*`)
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Schema Validation**: Zod

### Design Patterns
- **Monorepo Structure**: Client, Server, and Shared directories.
- **Type Sharing**: Database schemas and types are shared between frontend and backend.
- **Storage Interface**: Abstract `IStorage` interface for flexible storage implementations.

### Multi-Tenancy & Authentication
- **Data Isolation**: All shared tables include a `userId` foreign key; all storage layer methods filter by `userId`.
- **Role-Based Access**: Users have "admin" or "user" roles, controlling access to sensitive settings like API keys.
- **Session-Based Authentication**: `express-session` with `connect-pg-simple`.
- **Password Hashing**: `bcryptjs`.
- **Authentication Endpoints**: Register, login, logout, get current user.
- **Admin Panel**: Accessible only to admin users, offering user management, usage tracking, support inbox, and API key visibility.
- **Internationalization (i18n)**: Supports 52 languages with locale detection and fallback.
- **Support Chat**: AI-powered support chat (Claude/OpenAI fallback) with voice input, accessible without authentication.

### Core Features
- **AI-Powered Script Generation**: Generates dialogs, program scripts, and ads using Claude (primary) or OpenAI (fallback).
- **Multi-Speaker Scripts**: Supports scripts with multiple speakers for both shows AND ads, including emotion tags for enhanced TTS and visual rendering. Ads with `speakersCount > 1` generate multi-speaker variants with `[Speaker Name]:` format and emotion tags. Voice assignment UI maps speakers to individual voices. Audio synthesis segments by speaker, synthesizes each with the assigned voice, and concatenates via ffmpeg.
- **Schedule System**: Flexible templates for broadcast scheduling, host rotation, and integration with holiday calendars (static and custom).
- **Language-Aware Generation**: AI prompts are localized to ensure scripts are generated in the user's preferred language.
- **Automatic Weekly Pipeline**: Automates script generation, audio synthesis, and cloud storage upload for programs based on configurable settings.
- **Services Status**: API endpoint and UI to display connectivity status of integrated external services.
- **Web Research Integration**: Firecrawl (with Startpage fallback) for fetching web content to enrich AI prompts for program generation.

### AI Integration Details
- **Claude (Anthropic)**: Primary for all text generation (scripts, ads, prompt improvement). Uses `claude-sonnet-4-20250514`.
- **OpenAI**: Fallback for text generation when Claude is not configured.
- **Gemini**: Used exclusively for voice transcription (audio-to-text) via Replit AI Integrations.
- **Batch Processing**: Utilities for batch generation with rate limiting and retries.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### AI Services
- **Anthropic Claude**: Main AI for text generation.
- **OpenAI API**: Fallback AI for text generation.
- **ElevenLabs**: Text-to-speech (TTS) service.
- **Gemini**: Audio transcription.

### Cloud Storage
- **Yandex Disk**: Storage for generated audio files.

### Music/Audio
- **Freesound**: Royalty-free music search (requires user API key in settings).
- **Epidemic Sound**: Background music search via `EPIDEMIC_SOUND_TOKEN` env var.
- **Pixabay**: Fallback free music search (via `PIXABAY_API_KEY` env var).
- **Music auto-select fallback chain**: Freesound → Epidemic Sound → Pixabay.

### Web Scraping/Research
- **Firecrawl**: For web content search and research to feed AI prompts.