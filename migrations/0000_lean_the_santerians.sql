CREATE TABLE "ad_presets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"mini_prompt" text NOT NULL,
	"content_type" text DEFAULT 'single',
	"speakers_count" integer DEFAULT 1,
	"voice_ids" text[],
	"announcer_voice_id" text,
	"default_voice_id" text,
	"default_target_duration_seconds" integer DEFAULT 30,
	"default_category" text DEFAULT 'general',
	"elevenlabs_tags" text,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"title" text NOT NULL,
	"client_name" text,
	"prompt" text NOT NULL,
	"website_url" text,
	"instagram_url" text,
	"attachments" text[],
	"target_duration_seconds" integer DEFAULT 30,
	"variants" text[],
	"selected_variant_index" integer,
	"selected_variant_text" text,
	"voice_ids" text[],
	"speakers_count" integer DEFAULT 1,
	"script_text" text,
	"audio_url" text,
	"audio_with_music_url" text,
	"music_track_url" text,
	"music_track_name" text,
	"duration" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"stage" text DEFAULT 'prompt',
	"category" text DEFAULT 'general',
	"preset_id" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" varchar NOT NULL,
	"user_id" varchar,
	"status" text DEFAULT 'running' NOT NULL,
	"items_created" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"automation_type" text DEFAULT 'dialog' NOT NULL,
	"program_type_id" varchar,
	"voice_ids" text[],
	"prompt" text,
	"items_count" integer DEFAULT 1,
	"schedule_type" text DEFAULT 'manual',
	"schedule_cron" text,
	"is_active" boolean DEFAULT true,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_holidays" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"name_ru" text NOT NULL,
	"country" text DEFAULT 'BOTH' NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"script_text" text,
	"male_text" text,
	"female_text" text,
	"audio_url" text,
	"duration" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_date" text,
	"slot_number" integer,
	"uploaded_to_yandex" boolean DEFAULT false,
	"yandex_path" text,
	"moderation_status" text DEFAULT 'pending',
	"moderation_notes" text,
	"moderated_at" timestamp,
	"host_voice_ids" text[],
	"news_source_ids" text[],
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_shifts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"template_id" varchar NOT NULL,
	"start_hour" integer NOT NULL,
	"end_hour" integer NOT NULL,
	"voice_ids" text[] NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"source_id" varchar NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" text,
	"url" text,
	"published_at" timestamp,
	"category" text,
	"is_used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'rss' NOT NULL,
	"language" text DEFAULT 'ru',
	"is_active" boolean DEFAULT true,
	"description" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"default_prompt" text NOT NULL,
	"default_duration_seconds" integer DEFAULT 60,
	"icon" text DEFAULT 'radio',
	"daily_count" integer DEFAULT 1,
	"slot_descriptions" text[],
	"sponsor_name" text,
	"sponsor_text" text,
	"assigned_voice_ids" text[],
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"auto_generate" boolean DEFAULT false,
	"weekly_count" integer DEFAULT 7,
	"auto_voice" boolean DEFAULT true,
	"auto_isolate" boolean DEFAULT false,
	"auto_upload" boolean DEFAULT true,
	"upload_folder" text,
	"schedule_days" integer[],
	"schedule_time" text,
	"file_name_template" text,
	"script_template" text,
	"use_firecrawl" boolean DEFAULT false,
	"firecrawl_topics" text[],
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "program_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"program_type_id" varchar NOT NULL,
	"title" text NOT NULL,
	"prompt" text,
	"script_text" text,
	"audio_url" text,
	"duration" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_date" text,
	"slot_number" integer,
	"uploaded_to_yandex" boolean DEFAULT false,
	"yandex_path" text,
	"moderation_status" text DEFAULT 'pending',
	"moderation_notes" text,
	"moderated_at" timestamp,
	"audio_duration_seconds" real,
	"script_generated_at" timestamp,
	"audio_generated_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'general',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_hour" integer DEFAULT 7 NOT NULL,
	"end_hour" integer DEFAULT 22 NOT NULL,
	"slots_per_hour" integer DEFAULT 1 NOT NULL,
	"voice_ids" text[],
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"eleven_labs_api_key" text,
	"anthropic_api_key" text,
	"yandex_disk_token" text,
	"male_voice_id" text DEFAULT 'onwK4e9ZLuTAKqWW03F9',
	"female_voice_id" text DEFAULT 'EXAVITQu4vr4xnSDxMaL',
	"daily_dialogs_count" integer DEFAULT 12,
	"ai_provider" text DEFAULT 'anthropic',
	"default_prompt" text DEFAULT 'Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.
Обязательно включи: приветствие слушателей, интересный факт или совет про жизнь в Турции.',
	"daily_prompt" text DEFAULT 'Сегодня создаём диалоги для радио. Учитывай:
- День недели и время суток для каждого слота
- Актуальные события и праздники
- Местные новости и погоду
- Стиль: дружелюбный, с юмором
- Для утренних слотов: бодрящие темы, приветствие дня
- Для дневных слотов: полезные советы, интересные факты
- Для вечерних слотов: расслабляющие темы, итоги дня',
	"slot_prompts" text[],
	"accumulated_learnings" text,
	"station_name" text DEFAULT 'Alanya FM',
	"station_logo" text,
	"station_description" text,
	"station_website" text,
	"station_location" text DEFAULT 'Аланья, Турция',
	"station_attachments" text[],
	"freesound_api_key" text,
	"global_firecrawl_topics" text[],
	"dialog_style" text DEFAULT 'lively',
	"dialog_replicas" integer DEFAULT 4
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"session_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"action" text NOT NULL,
	"details" text,
	"tokens_used" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"language" text,
	"role" text DEFAULT 'user',
	"blocked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"persona_name" text,
	"eleven_labs_voice_id" text NOT NULL,
	"gender" text DEFAULT 'male' NOT NULL,
	"preview_url" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"assigned_program_type_ids" text[],
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_presets" ADD CONSTRAINT "ad_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_holidays" ADD CONSTRAINT "custom_holidays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogs" ADD CONSTRAINT "dialogs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_shifts" ADD CONSTRAINT "host_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_sources" ADD CONSTRAINT "news_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_types" ADD CONSTRAINT "program_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voices" ADD CONSTRAINT "voices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;