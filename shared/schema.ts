import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  // Nullable: accounts created through Telegram never have a password.
  password: text("password"),
  name: text("name"),
  language: text("language"),
  role: text("role").default("user"),
  blocked: boolean("blocked").default(false),
  hasCompletedOnboarding: boolean("has_completed_onboarding").default(false),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  telegramPhotoUrl: text("telegram_photo_url"),
  // When set, a password alone is not enough — the login must also be confirmed
  // through Telegram. This is what makes it two factors rather than one.
  requireTelegramLogin: boolean("require_telegram_login").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  elevenLabsApiKey: text("eleven_labs_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  yandexDiskToken: text("yandex_disk_token"),
  maleVoiceId: text("male_voice_id").default("onwK4e9ZLuTAKqWW03F9"),
  femaleVoiceId: text("female_voice_id").default("EXAVITQu4vr4xnSDxMaL"),
  dailyDialogsCount: integer("daily_dialogs_count").default(12),
  aiProvider: text("ai_provider").default("anthropic"),
  defaultPrompt: text("default_prompt").default(`Create a short dialog between radio hosts (male and female) of "Radio FM".
Topic: local life, culture, interesting facts.
Style: friendly, casual, with humor.
Duration: 30-50 seconds when read aloud.
Must include: greeting to listeners, an interesting fact or useful tip.`),
  dailyPrompt: text("daily_prompt").default(`Today we are creating dialogs for the radio. Consider:
- Day of the week and time of day for each slot
- Current events and holidays
- Local news and weather
- Style: friendly, with humor
- For morning slots: energizing topics, greeting the day
- For daytime slots: useful tips, interesting facts
- For evening slots: relaxing topics, day summary`),
  slotPrompts: text("slot_prompts").array(),
  accumulatedLearnings: text("accumulated_learnings"),
  stationName: text("station_name").default("Radio FM"),
  stationLogo: text("station_logo"),
  stationDescription: text("station_description"),
  stationWebsite: text("station_website").default("http://radiofm.com"),
  stationLocation: text("station_location").default(""),
  stationAttachments: text("station_attachments").array(),
  freesoundApiKey: text("freesound_api_key"),
  globalFirecrawlTopics: text("global_firecrawl_topics").array(),
  dialogStyle: text("dialog_style").default("lively"),
  dialogReplicas: integer("dialog_replicas").default(4),
  showHints: boolean("show_hints").default(true),
  ttsStability: real("tts_stability").default(0.75),
  ttsSimilarityBoost: real("tts_similarity_boost").default(0.75),
  // Where generated audio is archived: "yandex", "google_drive" or "none".
  storageProvider: text("storage_provider").default("yandex"),
  // Long-lived Google grant. Access tokens are short-lived and derived from it,
  // so only this is persisted.
  googleDriveRefreshToken: text("google_drive_refresh_token"),
  googleDriveFolderId: text("google_drive_folder_id"),
  googleDriveEmail: text("google_drive_email"),
}, (table) => [
  index("settings_user_idx").on(table.userId),
]);

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
});

export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

export const dialogs = pgTable("dialogs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  scriptText: text("script_text"),
  maleText: text("male_text"),
  femaleText: text("female_text"),
  audioUrl: text("audio_url"),
  duration: integer("duration"),
  status: text("status").notNull().default("pending"),
  scheduledDate: text("scheduled_date"),
  slotNumber: integer("slot_number"),
  uploadedToYandex: boolean("uploaded_to_yandex").default(false),
  yandexPath: text("yandex_path"),
  moderationStatus: text("moderation_status").default("pending"),
  moderationNotes: text("moderation_notes"),
  moderatedAt: timestamp("moderated_at"),
  hostVoiceIds: text("host_voice_ids").array(),
  newsSourceIds: text("news_source_ids").array(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("dialogs_user_idx").on(table.userId),
  index("dialogs_user_scheduled_idx").on(table.userId, table.scheduledDate),
]);

export const newsSources = pgTable("news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull().default("rss"),
  language: text("language").default("ru"),
  isActive: boolean("is_active").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("news_sources_user_idx").on(table.userId),
]);

export const insertNewsSourceSchema = createInsertSchema(newsSources).omit({
  id: true,
  createdAt: true,
});

export type InsertNewsSource = z.infer<typeof insertNewsSourceSchema>;
export type NewsSource = typeof newsSources.$inferSelect;

export const insertDialogSchema = createInsertSchema(dialogs).omit({
  id: true,
  createdAt: true,
});

export type InsertDialog = z.infer<typeof insertDialogSchema>;
export type Dialog = typeof dialogs.$inferSelect;

export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("prompt_templates_user_idx").on(table.userId),
]);

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;

export const adClients = pgTable("ad_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
  phone: text("phone"),
  description: text("description"),
  defaultCategory: text("default_category").default("general"),
  defaultTargetDurationSeconds: integer("default_target_duration_seconds").default(30),
  defaultVoiceId: text("default_voice_id"),
  defaultVoiceName: text("default_voice_name"),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("ad_clients_user_idx").on(table.userId),
]);

export const insertAdClientSchema = createInsertSchema(adClients).omit({
  id: true,
  createdAt: true,
});

export type InsertAdClient = z.infer<typeof insertAdClientSchema>;
export type AdClient = typeof adClients.$inferSelect;

export const ads = pgTable("ads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  clientName: text("client_name"),
  clientId: varchar("client_id").references(() => adClients.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
  attachments: text("attachments").array(),
  targetDurationSeconds: integer("target_duration_seconds").default(30),
  variants: text("variants").array(),
  selectedVariantIndex: integer("selected_variant_index"),
  selectedVariantText: text("selected_variant_text"),
  voiceIds: text("voice_ids").array(),
  speakersCount: integer("speakers_count").default(1),
  scriptText: text("script_text"),
  speakerVoiceMap: text("speaker_voice_map"),
  audioUrl: text("audio_url"),
  audioVersions: text("audio_versions"),
  audioWithMusicUrl: text("audio_with_music_url"),
  musicTrackUrl: text("music_track_url"),
  musicTrackName: text("music_track_name"),
  duration: integer("duration"),
  downloadedAt: timestamp("downloaded_at"),
  status: text("status").notNull().default("draft"),
  stage: text("stage").default("prompt"),
  category: text("category").default("general"),
  presetId: text("preset_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("ads_user_idx").on(table.userId),
]);

export const insertAdSchema = createInsertSchema(ads).omit({
  id: true,
  createdAt: true,
});

export type InsertAd = z.infer<typeof insertAdSchema>;
export type Ad = typeof ads.$inferSelect;

export const adPresets = pgTable("ad_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  miniPrompt: text("mini_prompt").notNull(),
  contentType: text("content_type").default("single"),
  speakersCount: integer("speakers_count").default(1),
  voiceIds: text("voice_ids").array(),
  announcerVoiceId: text("announcer_voice_id"),
  defaultVoiceId: text("default_voice_id"),
  defaultTargetDurationSeconds: integer("default_target_duration_seconds").default(30),
  defaultCategory: text("default_category").default("general"),
  elevenLabsTags: text("elevenlabs_tags"),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("ad_presets_user_idx").on(table.userId),
]);

export const insertAdPresetSchema = createInsertSchema(adPresets).omit({
  id: true,
  createdAt: true,
});

export type InsertAdPreset = z.infer<typeof insertAdPresetSchema>;
export type AdPreset = typeof adPresets.$inferSelect;

export const voices = pgTable("voices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  personaName: text("persona_name"),
  elevenLabsVoiceId: text("eleven_labs_voice_id").notNull(),
  gender: text("gender").notNull().default("male"),
  previewUrl: text("preview_url"),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  assignedProgramTypeIds: text("assigned_program_type_ids").array(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("voices_user_idx").on(table.userId),
]);

export const insertVoiceSchema = createInsertSchema(voices).omit({
  id: true,
  createdAt: true,
});

export type InsertVoice = z.infer<typeof insertVoiceSchema>;
export type Voice = typeof voices.$inferSelect;

export const programTypes = pgTable("program_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  defaultPrompt: text("default_prompt").notNull(),
  defaultDurationSeconds: integer("default_duration_seconds").default(60),
  icon: text("icon").default("radio"),
  dailyCount: integer("daily_count").default(1),
  slotDescriptions: text("slot_descriptions").array(),
  sponsorName: text("sponsor_name"),
  sponsorText: text("sponsor_text"),
  assignedVoiceIds: text("assigned_voice_ids").array(),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  autoGenerate: boolean("auto_generate").default(false),
  weeklyCount: integer("weekly_count").default(7),
  autoVoice: boolean("auto_voice").default(true),
  autoIsolate: boolean("auto_isolate").default(false),
  autoUpload: boolean("auto_upload").default(true),
  uploadFolder: text("upload_folder"),
  scheduleDays: integer("schedule_days").array(),
  scheduleTime: text("schedule_time"),
  fileNameTemplate: text("file_name_template"),
  scriptTemplate: text("script_template"),
  useFirecrawl: boolean("use_firecrawl").default(false),
  firecrawlTopics: text("firecrawl_topics").array(),
  isWeatherForecast: boolean("is_weather_forecast").default(false),
  defaultForecastDays: integer("default_forecast_days").default(1),
  promptIsExactScript: boolean("prompt_is_exact_script").default(false),
  // Off by default: injecting "сейчас лето" into every show made non-seasonal
  // formats (psychology, science) drift onto seasonal topics. Turn on for
  // weather, lifestyle and events.
  useSeasonalContext: boolean("use_seasonal_context").default(false),
  // Which kind of sources to research before writing: "local" (news, events,
  // lifestyle near the station), "academic" (studies, journals, university
  // publications), "none".
  researchProfile: text("research_profile").default("local"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("program_types_user_slug_idx").on(table.userId, table.slug),
]);

export const insertProgramTypeSchema = createInsertSchema(programTypes).omit({
  id: true,
  createdAt: true,
});

export type InsertProgramType = z.infer<typeof insertProgramTypeSchema>;
export type ProgramType = typeof programTypes.$inferSelect;

export const programs = pgTable("programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  programTypeId: varchar("program_type_id").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt"),
  scriptText: text("script_text"),
  audioUrl: text("audio_url"),
  duration: integer("duration"),
  status: text("status").notNull().default("pending"),
  scheduledDate: text("scheduled_date"),
  slotNumber: integer("slot_number"),
  uploadedToYandex: boolean("uploaded_to_yandex").default(false),
  yandexPath: text("yandex_path"),
  moderationStatus: text("moderation_status").default("pending"),
  moderationNotes: text("moderation_notes"),
  moderatedAt: timestamp("moderated_at"),
  audioDurationSeconds: real("audio_duration_seconds"),
  scriptGeneratedAt: timestamp("script_generated_at"),
  audioGeneratedAt: timestamp("audio_generated_at"),
  // Set when the operator downloads the audio — the list highlights these so
  // it's obvious which episodes have already been taken to the broadcast desk.
  downloadedAt: timestamp("downloaded_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("programs_user_idx").on(table.userId),
  index("programs_type_idx").on(table.programTypeId),
  index("programs_user_scheduled_idx").on(table.userId, table.scheduledDate),
]);

export const insertProgramSchema = createInsertSchema(programs).omit({
  id: true,
  createdAt: true,
});

export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programs.$inferSelect;

export const topicSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(["expat_life", "weather", "culture", "food", "travel", "tips"]),
});

export type TopicSuggestion = z.infer<typeof topicSuggestionSchema>;

export const dialogGenerationRequestSchema = z.object({
  prompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
  topic: z.string().optional(),
  scheduledDate: z.string().optional(),
  slotNumber: z.number().optional(),
});

export type DialogGenerationRequest = z.infer<typeof dialogGenerationRequestSchema>;

export const automations = pgTable("automations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  automationType: text("automation_type").notNull().default("dialog"),
  programTypeId: varchar("program_type_id"),
  voiceIds: text("voice_ids").array(),
  prompt: text("prompt"),
  itemsCount: integer("items_count").default(1),
  scheduleType: text("schedule_type").default("manual"),
  scheduleCron: text("schedule_cron"),
  isActive: boolean("is_active").default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("automations_user_idx").on(table.userId),
]);

export const insertAutomationSchema = createInsertSchema(automations).omit({
  id: true,
  createdAt: true,
  lastRunAt: true,
});

export type InsertAutomation = z.infer<typeof insertAutomationSchema>;
export type Automation = typeof automations.$inferSelect;

export const automationRuns = pgTable("automation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  automationId: varchar("automation_id").notNull(),
  userId: varchar("user_id").references(() => users.id),
  status: text("status").notNull().default("running"),
  itemsCreated: integer("items_created").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("automation_runs_automation_idx").on(table.automationId),
]);

export const insertAutomationRunSchema = createInsertSchema(automationRuns).omit({
  id: true,
  startedAt: true,
});

export type InsertAutomationRun = z.infer<typeof insertAutomationRunSchema>;
export type AutomationRun = typeof automationRuns.$inferSelect;

export const scheduleTemplates = pgTable("schedule_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weekdays: integer("weekdays").array().notNull(),
  startHour: integer("start_hour").notNull().default(7),
  endHour: integer("end_hour").notNull().default(22),
  slotsPerHour: integer("slots_per_hour").notNull().default(1),
  voiceIds: text("voice_ids").array(),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("schedule_templates_user_idx").on(table.userId),
]);

export const insertScheduleTemplateSchema = createInsertSchema(scheduleTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertScheduleTemplate = z.infer<typeof insertScheduleTemplateSchema>;
export type ScheduleTemplate = typeof scheduleTemplates.$inferSelect;

export const hostShifts = pgTable("host_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").notNull(),
  startHour: integer("start_hour").notNull(),
  endHour: integer("end_hour").notNull(),
  voiceIds: text("voice_ids").array().notNull(),
  label: text("label"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("host_shifts_user_idx").on(table.userId),
  index("host_shifts_template_idx").on(table.templateId),
]);

export const insertHostShiftSchema = createInsertSchema(hostShifts).omit({
  id: true,
  createdAt: true,
});

export type InsertHostShift = z.infer<typeof insertHostShiftSchema>;
export type HostShift = typeof hostShifts.$inferSelect;

export const customHolidays = pgTable("custom_holidays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  name: text("name").notNull(),
  nameRu: text("name_ru").notNull(),
  country: text("country").notNull().default("BOTH"),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("custom_holidays_user_idx").on(table.userId),
]);

export const insertCustomHolidaySchema = createInsertSchema(customHolidays).omit({
  id: true,
  createdAt: true,
});

export type InsertCustomHoliday = z.infer<typeof insertCustomHolidaySchema>;
export type CustomHoliday = typeof customHolidays.$inferSelect;

export const newsItems = pgTable("news_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content"),
  url: text("url"),
  publishedAt: timestamp("published_at"),
  category: text("category"),
  isUsed: boolean("is_used").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("news_items_user_idx").on(table.userId),
  index("news_items_source_idx").on(table.sourceId),
]);

export const insertNewsItemSchema = createInsertSchema(newsItems).omit({
  id: true,
  createdAt: true,
});

export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItems.$inferSelect;

export const usageLogs = pgTable("usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  details: text("details"),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("usage_logs_user_idx").on(table.userId),
]);

export const insertUsageLogSchema = createInsertSchema(usageLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;
export type UsageLog = typeof usageLogs.$inferSelect;

/**
 * Durable background work. Replaces fire-and-forget `(async () => {})()`, where
 * a restart lost the work silently and left rows stuck mid-status forever.
 *
 * Claimed with SELECT ... FOR UPDATE SKIP LOCKED so several instances can run
 * workers against the same table without handing the same job out twice.
 */
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("pending"),
  progress: text("progress"),
  result: jsonb("result"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  // When the job becomes eligible to run. Also carries retry backoff.
  runAt: timestamp("run_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // Set while a worker holds the job; used to reclaim jobs from a dead process.
  lockedAt: timestamp("locked_at"),
  lockedBy: text("locked_by"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("jobs_claim_idx").on(table.status, table.runAt),
  index("jobs_user_idx").on(table.userId),
  index("jobs_type_idx").on(table.type),
]);

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

export const supportMessages = pgTable("support_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("support_messages_user_idx").on(table.userId),
  index("support_messages_session_idx").on(table.sessionId),
]);

export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
export type SupportMessage = typeof supportMessages.$inferSelect;
