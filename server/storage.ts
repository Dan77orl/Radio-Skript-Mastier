import { users, settings, dialogs, newsSources, newsItems, ads, adPresets, voices, programTypes, programs, automations, automationRuns, scheduleTemplates, hostShifts, customHolidays, usageLogs, type User, type InsertUser, type Settings, type InsertSettings, type Dialog, type InsertDialog, type NewsSource, type InsertNewsSource, type NewsItem, type InsertNewsItem, type Ad, type InsertAd, type AdPreset, type InsertAdPreset, type Voice, type InsertVoice, type ProgramType, type InsertProgramType, type Program, type InsertProgram, type Automation, type InsertAutomation, type AutomationRun, type InsertAutomationRun, type ScheduleTemplate, type InsertScheduleTemplate, type HostShift, type InsertHostShift, type CustomHoliday, type InsertCustomHoliday, type UsageLog, type InsertUsageLog } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, sql, and, or, isNull } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserLanguage(id: string, language: string): Promise<void>;
  
  getSettings(userId?: string): Promise<Settings | undefined>;
  saveSettings(settings: InsertSettings, userId?: string): Promise<Settings>;
  
  getDialogs(userId: string): Promise<Dialog[]>;
  getDialog(id: string, userId: string): Promise<Dialog | undefined>;
  createDialog(dialog: InsertDialog): Promise<Dialog>;
  updateDialog(id: string, userId: string, dialog: Partial<InsertDialog>): Promise<Dialog | undefined>;
  deleteDialog(id: string, userId: string): Promise<boolean>;
  
  getNewsSources(userId: string): Promise<NewsSource[]>;
  getNewsSource(id: string, userId?: string): Promise<NewsSource | undefined>;
  createNewsSource(source: InsertNewsSource): Promise<NewsSource>;
  updateNewsSource(id: string, userId: string, source: Partial<InsertNewsSource>): Promise<NewsSource | undefined>;
  deleteNewsSource(id: string, userId: string): Promise<boolean>;
  
  getAds(userId: string): Promise<Ad[]>;
  getAd(id: string, userId?: string): Promise<Ad | undefined>;
  createAd(ad: InsertAd): Promise<Ad>;
  updateAd(id: string, userId: string, ad: Partial<InsertAd>): Promise<Ad | undefined>;
  deleteAd(id: string, userId: string): Promise<boolean>;
  
  getAdPresets(userId: string): Promise<AdPreset[]>;
  getAdPreset(id: string, userId?: string): Promise<AdPreset | undefined>;
  createAdPreset(preset: InsertAdPreset): Promise<AdPreset>;
  updateAdPreset(id: string, userId: string, preset: Partial<InsertAdPreset>): Promise<AdPreset | undefined>;
  deleteAdPreset(id: string, userId: string): Promise<boolean>;
  
  getVoices(userId: string): Promise<Voice[]>;
  getVoice(id: string, userId?: string): Promise<Voice | undefined>;
  createVoice(voice: InsertVoice): Promise<Voice>;
  updateVoice(id: string, userId: string, voice: Partial<InsertVoice>): Promise<Voice | undefined>;
  deleteVoice(id: string, userId: string): Promise<boolean>;
  getVoicesCount(userId: string): Promise<number>;
  
  getProgramTypes(userId?: string): Promise<ProgramType[]>;
  getProgramType(id: string, userId?: string): Promise<ProgramType | undefined>;
  createProgramType(programType: InsertProgramType): Promise<ProgramType>;
  updateProgramType(id: string, userId: string, programType: Partial<InsertProgramType>): Promise<ProgramType | undefined>;
  deleteProgramType(id: string, userId: string): Promise<boolean>;
  
  getPrograms(userId: string): Promise<Program[]>;
  getProgramsByType(typeId: string, userId?: string): Promise<Program[]>;
  getProgram(id: string, userId?: string): Promise<Program | undefined>;
  createProgram(program: InsertProgram): Promise<Program>;
  updateProgram(id: string, userId: string, program: Partial<InsertProgram>): Promise<Program | undefined>;
  deleteProgram(id: string, userId: string): Promise<boolean>;
  
  getAutomations(userId: string): Promise<Automation[]>;
  getAutomation(id: string, userId?: string): Promise<Automation | undefined>;
  createAutomation(automation: InsertAutomation): Promise<Automation>;
  updateAutomation(id: string, automation: Partial<InsertAutomation>, userId?: string): Promise<Automation | undefined>;
  deleteAutomation(id: string, userId: string): Promise<boolean>;
  
  getAutomationRuns(automationId: string): Promise<AutomationRun[]>;
  createAutomationRun(run: InsertAutomationRun): Promise<AutomationRun>;
  updateAutomationRun(id: string, run: Partial<InsertAutomationRun>): Promise<AutomationRun | undefined>;
  
  getNewsItems(userId: string, limit?: number): Promise<NewsItem[]>;
  getUnusedNewsItems(userId: string, limit?: number): Promise<NewsItem[]>;
  createNewsItem(item: InsertNewsItem): Promise<NewsItem>;
  markNewsItemUsed(id: string): Promise<void>;
  clearOldNewsItems(daysOld: number): Promise<void>;

  getScheduleTemplates(userId: string): Promise<ScheduleTemplate[]>;
  getScheduleTemplate(id: string, userId?: string): Promise<ScheduleTemplate | undefined>;
  createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate>;
  updateScheduleTemplate(id: string, userId: string, template: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate | undefined>;
  deleteScheduleTemplate(id: string, userId: string): Promise<boolean>;
  getTemplateForWeekday(weekday: number, userId: string): Promise<ScheduleTemplate | undefined>;

  getHostShifts(templateId: string): Promise<HostShift[]>;
  getHostShift(id: string): Promise<HostShift | undefined>;
  createHostShift(shift: InsertHostShift): Promise<HostShift>;
  updateHostShift(id: string, userId: string, shift: Partial<InsertHostShift>): Promise<HostShift | undefined>;
  deleteHostShift(id: string, userId: string): Promise<boolean>;
  deleteHostShiftsByTemplate(templateId: string): Promise<void>;

  getCustomHolidays(userId: string): Promise<CustomHoliday[]>;
  getAllCustomHolidays(): Promise<CustomHoliday[]>;
  createCustomHoliday(holiday: InsertCustomHoliday): Promise<CustomHoliday>;
  updateCustomHoliday(id: string, userId: string, holiday: Partial<InsertCustomHoliday>): Promise<CustomHoliday | undefined>;
  deleteCustomHoliday(id: string, userId: string): Promise<boolean>;

  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserBlocked(id: string, blocked: boolean): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getUserStats(userId: string): Promise<{ dialogs: number; programs: number; voices: number; programTypes: number }>;

  createUsageLog(log: InsertUsageLog): Promise<UsageLog>;
  getUsageLogs(userId?: string, limit?: number): Promise<UsageLog[]>;
  getUsageStats(): Promise<{ userId: string; action: string; count: number }[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserLanguage(id: string, language: string): Promise<void> {
    await db.update(users).set({ language }).where(eq(users.id, id));
  }

  async getSettings(userId?: string): Promise<Settings | undefined> {
    if (userId) {
      const [result] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
      if (result) return result;
      const [defaultSettings] = await db.insert(settings).values({
        userId,
        elevenLabsApiKey: null,
        yandexDiskToken: null,
        maleVoiceId: "onwK4e9ZLuTAKqWW03F9",
        femaleVoiceId: "EXAVITQu4vr4xnSDxMaL",
        dailyDialogsCount: 12,
        defaultPrompt: `Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.
Обязательно включи: приветствие слушателей, интересный факт или совет про жизнь в Турции.`,
      }).returning();
      return defaultSettings;
    }
    const [result] = await db.select().from(settings).limit(1);
    return result || undefined;
  }

  async saveSettings(newSettings: InsertSettings, userId?: string): Promise<Settings> {
    const existing = await this.getSettings(userId);
    if (existing) {
      const merged: Record<string, unknown> = { userId: userId || existing.userId };
      for (const key of Object.keys(newSettings) as (keyof InsertSettings)[]) {
        if (key === "id") continue;
        merged[key] = newSettings[key] ?? (existing as Record<string, unknown>)[key];
      }
      for (const key of Object.keys(existing) as string[]) {
        if (!(key in merged) && key !== "id") {
          merged[key] = (existing as Record<string, unknown>)[key];
        }
      }
      const [updated] = await db.update(settings)
        .set(merged)
        .where(eq(settings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(settings).values({ ...newSettings, userId: userId || null }).returning();
    return created;
  }

  async getDialogs(userId: string): Promise<Dialog[]> {
    return db.select().from(dialogs)
      .where(eq(dialogs.userId, userId))
      .orderBy(desc(dialogs.createdAt));
  }

  async getDialog(id: string, userId: string): Promise<Dialog | undefined> {
    const [dialog] = await db.select().from(dialogs).where(and(eq(dialogs.id, id), eq(dialogs.userId, userId)));
    return dialog || undefined;
  }

  async createDialog(insertDialog: InsertDialog): Promise<Dialog> {
    const [dialog] = await db.insert(dialogs).values(insertDialog).returning();
    return dialog;
  }

  async updateDialog(id: string, userId: string, updates: Partial<InsertDialog>): Promise<Dialog | undefined> {
    const [updated] = await db.update(dialogs)
      .set(updates)
      .where(and(eq(dialogs.id, id), eq(dialogs.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteDialog(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(dialogs).where(and(eq(dialogs.id, id), eq(dialogs.userId, userId))).returning();
    return result.length > 0;
  }

  async getNewsSources(userId: string): Promise<NewsSource[]> {
    return db.select().from(newsSources)
      .where(eq(newsSources.userId, userId))
      .orderBy(desc(newsSources.createdAt));
  }

  async getNewsSource(id: string, userId?: string): Promise<NewsSource | undefined> {
    const conditions = userId ? and(eq(newsSources.id, id), eq(newsSources.userId, userId)) : eq(newsSources.id, id);
    const [source] = await db.select().from(newsSources).where(conditions);
    return source || undefined;
  }

  async createNewsSource(insertSource: InsertNewsSource): Promise<NewsSource> {
    const [source] = await db.insert(newsSources).values(insertSource).returning();
    return source;
  }

  async updateNewsSource(id: string, userId: string, updates: Partial<InsertNewsSource>): Promise<NewsSource | undefined> {
    const [updated] = await db.update(newsSources)
      .set(updates)
      .where(and(eq(newsSources.id, id), eq(newsSources.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteNewsSource(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(newsSources).where(and(eq(newsSources.id, id), eq(newsSources.userId, userId))).returning();
    return result.length > 0;
  }

  async getAds(userId: string): Promise<Ad[]> {
    return db.select().from(ads)
      .where(eq(ads.userId, userId))
      .orderBy(desc(ads.createdAt));
  }

  async getAd(id: string, userId?: string): Promise<Ad | undefined> {
    const conditions = userId ? and(eq(ads.id, id), eq(ads.userId, userId)) : eq(ads.id, id);
    const [ad] = await db.select().from(ads).where(conditions);
    return ad || undefined;
  }

  async createAd(insertAd: InsertAd): Promise<Ad> {
    const [ad] = await db.insert(ads).values(insertAd).returning();
    return ad;
  }

  async updateAd(id: string, userId: string, updates: Partial<InsertAd>): Promise<Ad | undefined> {
    const [updated] = await db.update(ads)
      .set(updates)
      .where(and(eq(ads.id, id), eq(ads.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteAd(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(ads).where(and(eq(ads.id, id), eq(ads.userId, userId))).returning();
    return result.length > 0;
  }

  async getAdPresets(userId: string): Promise<AdPreset[]> {
    return db.select().from(adPresets)
      .where(eq(adPresets.userId, userId))
      .orderBy(asc(adPresets.sortOrder));
  }

  async getAdPreset(id: string, userId?: string): Promise<AdPreset | undefined> {
    const conditions = userId ? and(eq(adPresets.id, id), eq(adPresets.userId, userId)) : eq(adPresets.id, id);
    const [preset] = await db.select().from(adPresets).where(conditions);
    return preset || undefined;
  }

  async createAdPreset(insertPreset: InsertAdPreset): Promise<AdPreset> {
    const [preset] = await db.insert(adPresets).values(insertPreset).returning();
    return preset;
  }

  async updateAdPreset(id: string, userId: string, updates: Partial<InsertAdPreset>): Promise<AdPreset | undefined> {
    const [updated] = await db.update(adPresets)
      .set(updates)
      .where(and(eq(adPresets.id, id), eq(adPresets.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteAdPreset(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(adPresets).where(and(eq(adPresets.id, id), eq(adPresets.userId, userId))).returning();
    return result.length > 0;
  }

  async getVoices(userId: string): Promise<Voice[]> {
    return db.select().from(voices)
      .where(eq(voices.userId, userId))
      .orderBy(asc(voices.sortOrder));
  }

  async getVoice(id: string, userId?: string): Promise<Voice | undefined> {
    const conditions = userId ? and(eq(voices.id, id), eq(voices.userId, userId)) : eq(voices.id, id);
    const [voice] = await db.select().from(voices).where(conditions);
    return voice || undefined;
  }

  async createVoice(insertVoice: InsertVoice): Promise<Voice> {
    const [voice] = await db.insert(voices).values(insertVoice).returning();
    return voice;
  }

  async updateVoice(id: string, userId: string, updates: Partial<InsertVoice>): Promise<Voice | undefined> {
    const [updated] = await db.update(voices)
      .set(updates)
      .where(and(eq(voices.id, id), eq(voices.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteVoice(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(voices).where(and(eq(voices.id, id), eq(voices.userId, userId))).returning();
    return result.length > 0;
  }

  async getVoicesCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(voices)
      .where(eq(voices.userId, userId));
    return result[0]?.count || 0;
  }

  async getProgramTypes(userId?: string): Promise<ProgramType[]> {
    if (userId) {
      return db.select().from(programTypes)
        .where(eq(programTypes.userId, userId))
        .orderBy(asc(programTypes.sortOrder));
    }
    return db.select().from(programTypes).orderBy(asc(programTypes.sortOrder));
  }

  async getProgramType(id: string, userId?: string): Promise<ProgramType | undefined> {
    const conditions = userId ? and(eq(programTypes.id, id), eq(programTypes.userId, userId)) : eq(programTypes.id, id);
    const [programType] = await db.select().from(programTypes).where(conditions);
    return programType || undefined;
  }

  async createProgramType(insertProgramType: InsertProgramType): Promise<ProgramType> {
    const [programType] = await db.insert(programTypes).values(insertProgramType).returning();
    return programType;
  }

  async updateProgramType(id: string, userId: string, updates: Partial<InsertProgramType>): Promise<ProgramType | undefined> {
    const [updated] = await db.update(programTypes)
      .set(updates)
      .where(and(eq(programTypes.id, id), eq(programTypes.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteProgramType(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(programTypes).where(and(eq(programTypes.id, id), eq(programTypes.userId, userId))).returning();
    return result.length > 0;
  }

  async getPrograms(userId: string): Promise<Program[]> {
    return db.select().from(programs)
      .where(eq(programs.userId, userId))
      .orderBy(desc(programs.createdAt));
  }

  async getProgramsByType(typeId: string, userId?: string): Promise<Program[]> {
    const conditions = userId ? and(eq(programs.programTypeId, typeId), eq(programs.userId, userId)) : eq(programs.programTypeId, typeId);
    return db.select().from(programs).where(conditions).orderBy(desc(programs.createdAt));
  }

  async getProgram(id: string, userId?: string): Promise<Program | undefined> {
    const conditions = userId ? and(eq(programs.id, id), eq(programs.userId, userId)) : eq(programs.id, id);
    const [program] = await db.select().from(programs).where(conditions);
    return program || undefined;
  }

  async createProgram(insertProgram: InsertProgram): Promise<Program> {
    const [program] = await db.insert(programs).values(insertProgram).returning();
    return program;
  }

  async updateProgram(id: string, userId: string, updates: Partial<InsertProgram>): Promise<Program | undefined> {
    const [updated] = await db.update(programs)
      .set(updates)
      .where(and(eq(programs.id, id), eq(programs.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteProgram(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(programs).where(and(eq(programs.id, id), eq(programs.userId, userId))).returning();
    return result.length > 0;
  }

  async getAutomations(userId: string): Promise<Automation[]> {
    return db.select().from(automations)
      .where(eq(automations.userId, userId))
      .orderBy(desc(automations.createdAt));
  }

  async getAutomation(id: string, userId?: string): Promise<Automation | undefined> {
    const conditions = userId ? and(eq(automations.id, id), eq(automations.userId, userId)) : eq(automations.id, id);
    const [automation] = await db.select().from(automations).where(conditions);
    return automation || undefined;
  }

  async createAutomation(insertAutomation: InsertAutomation): Promise<Automation> {
    const [automation] = await db.insert(automations).values(insertAutomation).returning();
    return automation;
  }

  async updateAutomation(id: string, updates: Partial<InsertAutomation>, userId?: string): Promise<Automation | undefined> {
    const conditions = userId ? and(eq(automations.id, id), eq(automations.userId, userId)) : eq(automations.id, id);
    const [updated] = await db.update(automations)
      .set(updates)
      .where(conditions)
      .returning();
    return updated || undefined;
  }

  async deleteAutomation(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(automations).where(and(eq(automations.id, id), eq(automations.userId, userId))).returning();
    if (result.length > 0) {
      await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
    }
    return result.length > 0;
  }

  async getAutomationRuns(automationId: string): Promise<AutomationRun[]> {
    return db.select().from(automationRuns)
      .where(eq(automationRuns.automationId, automationId))
      .orderBy(desc(automationRuns.startedAt));
  }

  async createAutomationRun(insertRun: InsertAutomationRun): Promise<AutomationRun> {
    const [run] = await db.insert(automationRuns).values(insertRun).returning();
    return run;
  }

  async updateAutomationRun(id: string, updates: Partial<InsertAutomationRun>): Promise<AutomationRun | undefined> {
    const [updated] = await db.update(automationRuns)
      .set(updates)
      .where(eq(automationRuns.id, id))
      .returning();
    return updated || undefined;
  }

  async getNewsItems(userId: string, limit: number = 50): Promise<NewsItem[]> {
    return db.select().from(newsItems)
      .where(eq(newsItems.userId, userId))
      .orderBy(desc(newsItems.publishedAt))
      .limit(limit);
  }

  async getUnusedNewsItems(userId: string, limit: number = 10): Promise<NewsItem[]> {
    return db.select().from(newsItems)
      .where(and(eq(newsItems.userId, userId), eq(newsItems.isUsed, false)))
      .orderBy(desc(newsItems.publishedAt))
      .limit(limit);
  }

  async createNewsItem(insertItem: InsertNewsItem): Promise<NewsItem> {
    const [item] = await db.insert(newsItems).values(insertItem).returning();
    return item;
  }

  async markNewsItemUsed(id: string): Promise<void> {
    await db.update(newsItems)
      .set({ isUsed: true })
      .where(eq(newsItems.id, id));
  }

  async clearOldNewsItems(daysOld: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    await db.delete(newsItems)
      .where(sql`${newsItems.createdAt} < ${cutoffDate}`);
  }

  async getScheduleTemplates(userId: string): Promise<ScheduleTemplate[]> {
    return db.select().from(scheduleTemplates)
      .where(eq(scheduleTemplates.userId, userId))
      .orderBy(asc(scheduleTemplates.sortOrder));
  }

  async getScheduleTemplate(id: string, userId?: string): Promise<ScheduleTemplate | undefined> {
    const conditions = userId ? and(eq(scheduleTemplates.id, id), eq(scheduleTemplates.userId, userId)) : eq(scheduleTemplates.id, id);
    const [template] = await db.select().from(scheduleTemplates).where(conditions);
    return template || undefined;
  }

  async createScheduleTemplate(insertTemplate: InsertScheduleTemplate): Promise<ScheduleTemplate> {
    const [template] = await db.insert(scheduleTemplates).values(insertTemplate).returning();
    return template;
  }

  async updateScheduleTemplate(id: string, userId: string, updates: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate | undefined> {
    const [updated] = await db.update(scheduleTemplates)
      .set(updates)
      .where(and(eq(scheduleTemplates.id, id), eq(scheduleTemplates.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteScheduleTemplate(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(scheduleTemplates).where(and(eq(scheduleTemplates.id, id), eq(scheduleTemplates.userId, userId))).returning();
    if (result.length > 0) {
      await db.delete(hostShifts).where(eq(hostShifts.templateId, id));
    }
    return result.length > 0;
  }

  async getTemplateForWeekday(weekday: number, userId: string): Promise<ScheduleTemplate | undefined> {
    const all = await db.select().from(scheduleTemplates)
      .where(and(eq(scheduleTemplates.isActive, true), eq(scheduleTemplates.userId, userId)))
      .orderBy(asc(scheduleTemplates.sortOrder));
    return all.find(t => t.weekdays?.includes(weekday));
  }

  async getHostShifts(templateId: string): Promise<HostShift[]> {
    return db.select().from(hostShifts)
      .where(eq(hostShifts.templateId, templateId))
      .orderBy(asc(hostShifts.sortOrder));
  }

  async getHostShift(id: string): Promise<HostShift | undefined> {
    const [shift] = await db.select().from(hostShifts).where(eq(hostShifts.id, id));
    return shift || undefined;
  }

  async createHostShift(insertShift: InsertHostShift): Promise<HostShift> {
    const [shift] = await db.insert(hostShifts).values(insertShift).returning();
    return shift;
  }

  async updateHostShift(id: string, userId: string, updates: Partial<InsertHostShift>): Promise<HostShift | undefined> {
    const [updated] = await db.update(hostShifts)
      .set(updates)
      .where(and(eq(hostShifts.id, id), eq(hostShifts.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteHostShift(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(hostShifts).where(and(eq(hostShifts.id, id), eq(hostShifts.userId, userId))).returning();
    return result.length > 0;
  }

  async deleteHostShiftsByTemplate(templateId: string): Promise<void> {
    await db.delete(hostShifts).where(eq(hostShifts.templateId, templateId));
  }

  async getCustomHolidays(userId: string): Promise<CustomHoliday[]> {
    return db.select().from(customHolidays)
      .where(eq(customHolidays.userId, userId))
      .orderBy(asc(customHolidays.date));
  }

  async getAllCustomHolidays(): Promise<CustomHoliday[]> {
    return db.select().from(customHolidays)
      .orderBy(asc(customHolidays.date));
  }

  async createCustomHoliday(holiday: InsertCustomHoliday): Promise<CustomHoliday> {
    const [created] = await db.insert(customHolidays).values(holiday).returning();
    return created;
  }

  async updateCustomHoliday(id: string, userId: string, holiday: Partial<InsertCustomHoliday>): Promise<CustomHoliday | undefined> {
    const [updated] = await db.update(customHolidays).set(holiday).where(and(eq(customHolidays.id, id), eq(customHolidays.userId, userId))).returning();
    return updated;
  }

  async deleteCustomHoliday(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(customHolidays).where(and(eq(customHolidays.id, id), eq(customHolidays.userId, userId))).returning();
    return result.length > 0;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUserBlocked(id: string, blocked: boolean): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ blocked }).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async getUserStats(userId: string): Promise<{ dialogs: number; programs: number; voices: number; programTypes: number }> {
    const [dCount] = await db.select({ count: sql<number>`count(*)` }).from(dialogs).where(eq(dialogs.userId, userId));
    const [pCount] = await db.select({ count: sql<number>`count(*)` }).from(programs).where(eq(programs.userId, userId));
    const [vCount] = await db.select({ count: sql<number>`count(*)` }).from(voices).where(eq(voices.userId, userId));
    const [ptCount] = await db.select({ count: sql<number>`count(*)` }).from(programTypes).where(eq(programTypes.userId, userId));
    return {
      dialogs: Number(dCount?.count ?? 0),
      programs: Number(pCount?.count ?? 0),
      voices: Number(vCount?.count ?? 0),
      programTypes: Number(ptCount?.count ?? 0),
    };
  }

  async createUsageLog(log: InsertUsageLog): Promise<UsageLog> {
    const [created] = await db.insert(usageLogs).values(log).returning();
    return created;
  }

  async getUsageLogs(userId?: string, limit?: number): Promise<UsageLog[]> {
    const conditions = userId ? eq(usageLogs.userId, userId) : undefined;
    const q = db.select().from(usageLogs);
    const withWhere = conditions ? q.where(conditions) : q;
    return withWhere.orderBy(desc(usageLogs.createdAt)).limit(limit || 500);
  }

  async getUsageStats(): Promise<{ userId: string; action: string; count: number }[]> {
    const result = await db.select({
      userId: usageLogs.userId,
      action: usageLogs.action,
      count: sql<number>`count(*)`,
    }).from(usageLogs).groupBy(usageLogs.userId, usageLogs.action);
    return result.map(r => ({ userId: r.userId || "", action: r.action, count: Number(r.count) }));
  }
}

export const storage = new DatabaseStorage();
