-- Adds tenant/hot-path indexes and catches migrations/ up with schema.ts,
-- which had drifted because earlier changes were applied via `drizzle-kit push`.
-- Written idempotently so it is safe against a database already carrying those columns.
ALTER TABLE "program_types" DROP CONSTRAINT IF EXISTS "program_types_slug_unique";--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "default_prompt" SET DEFAULT 'Create a short dialog between radio hosts (male and female) of "Radio FM".
Topic: local life, culture, interesting facts.
Style: friendly, casual, with humor.
Duration: 30-50 seconds when read aloud.
Must include: greeting to listeners, an interesting fact or useful tip.';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "daily_prompt" SET DEFAULT 'Today we are creating dialogs for the radio. Consider:
- Day of the week and time of day for each slot
- Current events and holidays
- Local news and weather
- Style: friendly, with humor
- For morning slots: energizing topics, greeting the day
- For daytime slots: useful tips, interesting facts
- For evening slots: relaxing topics, day summary';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "station_name" SET DEFAULT 'Radio FM';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "station_website" SET DEFAULT 'http://radiofm.com';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "station_location" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "speaker_voice_map" text;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "audio_versions" text;--> statement-breakpoint
ALTER TABLE "program_types" ADD COLUMN IF NOT EXISTS "is_weather_forecast" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "program_types" ADD COLUMN IF NOT EXISTS "default_forecast_days" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "program_types" ADD COLUMN IF NOT EXISTS "prompt_is_exact_script" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "show_hints" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "tts_stability" real DEFAULT 0.75;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "tts_similarity_boost" real DEFAULT 0.75;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_presets_user_idx" ON "ad_presets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ads_user_idx" ON "ads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_user_idx" ON "automations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_holidays_user_idx" ON "custom_holidays" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dialogs_user_idx" ON "dialogs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dialogs_user_scheduled_idx" ON "dialogs" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "host_shifts_user_idx" ON "host_shifts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "host_shifts_template_idx" ON "host_shifts" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_items_user_idx" ON "news_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_items_source_idx" ON "news_items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_sources_user_idx" ON "news_sources" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_types_user_slug_idx" ON "program_types" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_user_idx" ON "programs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_type_idx" ON "programs" USING btree ("program_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_user_scheduled_idx" ON "programs" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_templates_user_idx" ON "prompt_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_templates_user_idx" ON "schedule_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_user_idx" ON "settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_user_idx" ON "support_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_session_idx" ON "support_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_logs_user_idx" ON "usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voices_user_idx" ON "voices" USING btree ("user_id");