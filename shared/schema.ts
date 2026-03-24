import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name"),
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
  userId: varchar("user_id"),
  elevenLabsApiKey: text("eleven_labs_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  yandexDiskToken: text("yandex_disk_token"),
  maleVoiceId: text("male_voice_id").default("onwK4e9ZLuTAKqWW03F9"),
  femaleVoiceId: text("female_voice_id").default("EXAVITQu4vr4xnSDxMaL"),
  dailyDialogsCount: integer("daily_dialogs_count").default(12),
  aiProvider: text("ai_provider").default("anthropic"),
  defaultPrompt: text("default_prompt").default(`Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.
Обязательно включи: приветствие слушателей, интересный факт или совет про жизнь в Турции.`),
  dailyPrompt: text("daily_prompt").default(`Сегодня создаём диалоги для радио. Учитывай:
- День недели и время суток для каждого слота
- Актуальные события и праздники
- Местные новости и погоду
- Стиль: дружелюбный, с юмором
- Для утренних слотов: бодрящие темы, приветствие дня
- Для дневных слотов: полезные советы, интересные факты
- Для вечерних слотов: расслабляющие темы, итоги дня`),
  slotPrompts: text("slot_prompts").array(),
  accumulatedLearnings: text("accumulated_learnings"),
  stationName: text("station_name").default("Alanya FM"),
  stationLogo: text("station_logo"),
  stationDescription: text("station_description"),
  stationWebsite: text("station_website"),
  stationLocation: text("station_location").default("Аланья, Турция"),
  stationAttachments: text("station_attachments").array(),
  freesoundApiKey: text("freesound_api_key"),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
});

export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

export const dialogs = pgTable("dialogs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
});

export const newsSources = pgTable("news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull().default("rss"),
  language: text("language").default("ru"),
  isActive: boolean("is_active").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

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
  name: text("name").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;

export const ads = pgTable("ads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  clientName: text("client_name"),
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
  audioUrl: text("audio_url"),
  audioWithMusicUrl: text("audio_with_music_url"),
  musicTrackUrl: text("music_track_url"),
  musicTrackName: text("music_track_name"),
  duration: integer("duration"),
  status: text("status").notNull().default("draft"),
  stage: text("stage").default("prompt"),
  category: text("category").default("general"),
  presetId: text("preset_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAdSchema = createInsertSchema(ads).omit({
  id: true,
  createdAt: true,
});

export type InsertAd = z.infer<typeof insertAdSchema>;
export type Ad = typeof ads.$inferSelect;

export const adPresets = pgTable("ad_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
});

export const insertAdPresetSchema = createInsertSchema(adPresets).omit({
  id: true,
  createdAt: true,
});

export type InsertAdPreset = z.infer<typeof insertAdPresetSchema>;
export type AdPreset = typeof adPresets.$inferSelect;

export const voices = pgTable("voices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
});

export const insertVoiceSchema = createInsertSchema(voices).omit({
  id: true,
  createdAt: true,
});

export type InsertVoice = z.infer<typeof insertVoiceSchema>;
export type Voice = typeof voices.$inferSelect;

export const programTypes = pgTable("program_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
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
  useFirecrawl: boolean("use_firecrawl").default(false),
  firecrawlTopics: text("firecrawl_topics").array(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProgramTypeSchema = createInsertSchema(programTypes).omit({
  id: true,
  createdAt: true,
});

export type InsertProgramType = z.infer<typeof insertProgramTypeSchema>;
export type ProgramType = typeof programTypes.$inferSelect;

export const programs = pgTable("programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

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
});

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
  status: text("status").notNull().default("running"),
  itemsCreated: integer("items_created").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertAutomationRunSchema = createInsertSchema(automationRuns).omit({
  id: true,
  startedAt: true,
});

export type InsertAutomationRun = z.infer<typeof insertAutomationRunSchema>;
export type AutomationRun = typeof automationRuns.$inferSelect;

export const scheduleTemplates = pgTable("schedule_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  weekdays: integer("weekdays").array().notNull(),
  startHour: integer("start_hour").notNull().default(7),
  endHour: integer("end_hour").notNull().default(22),
  slotsPerHour: integer("slots_per_hour").notNull().default(1),
  voiceIds: text("voice_ids").array(),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertScheduleTemplateSchema = createInsertSchema(scheduleTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertScheduleTemplate = z.infer<typeof insertScheduleTemplateSchema>;
export type ScheduleTemplate = typeof scheduleTemplates.$inferSelect;

export const hostShifts = pgTable("host_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull(),
  startHour: integer("start_hour").notNull(),
  endHour: integer("end_hour").notNull(),
  voiceIds: text("voice_ids").array().notNull(),
  label: text("label"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertHostShiftSchema = createInsertSchema(hostShifts).omit({
  id: true,
  createdAt: true,
});

export type InsertHostShift = z.infer<typeof insertHostShiftSchema>;
export type HostShift = typeof hostShifts.$inferSelect;

export const newsItems = pgTable("news_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content"),
  url: text("url"),
  publishedAt: timestamp("published_at"),
  category: text("category"),
  isUsed: boolean("is_used").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertNewsItemSchema = createInsertSchema(newsItems).omit({
  id: true,
  createdAt: true,
});

export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItems.$inferSelect;
