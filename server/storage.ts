import { users, settings, dialogs, newsSources, newsItems, ads, voices, programTypes, programs, automations, automationRuns, type User, type InsertUser, type Settings, type InsertSettings, type Dialog, type InsertDialog, type NewsSource, type InsertNewsSource, type NewsItem, type InsertNewsItem, type Ad, type InsertAd, type Voice, type InsertVoice, type ProgramType, type InsertProgramType, type Program, type InsertProgram, type Automation, type InsertAutomation, type AutomationRun, type InsertAutomationRun } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getSettings(): Promise<Settings | undefined>;
  saveSettings(settings: InsertSettings): Promise<Settings>;
  
  getDialogs(): Promise<Dialog[]>;
  getDialog(id: string): Promise<Dialog | undefined>;
  createDialog(dialog: InsertDialog): Promise<Dialog>;
  updateDialog(id: string, dialog: Partial<InsertDialog>): Promise<Dialog | undefined>;
  deleteDialog(id: string): Promise<boolean>;
  
  getNewsSources(): Promise<NewsSource[]>;
  getNewsSource(id: string): Promise<NewsSource | undefined>;
  createNewsSource(source: InsertNewsSource): Promise<NewsSource>;
  updateNewsSource(id: string, source: Partial<InsertNewsSource>): Promise<NewsSource | undefined>;
  deleteNewsSource(id: string): Promise<boolean>;
  
  getAds(): Promise<Ad[]>;
  getAd(id: string): Promise<Ad | undefined>;
  createAd(ad: InsertAd): Promise<Ad>;
  updateAd(id: string, ad: Partial<InsertAd>): Promise<Ad | undefined>;
  deleteAd(id: string): Promise<boolean>;
  
  getVoices(): Promise<Voice[]>;
  getVoice(id: string): Promise<Voice | undefined>;
  createVoice(voice: InsertVoice): Promise<Voice>;
  updateVoice(id: string, voice: Partial<InsertVoice>): Promise<Voice | undefined>;
  deleteVoice(id: string): Promise<boolean>;
  getVoicesCount(): Promise<number>;
  
  getProgramTypes(): Promise<ProgramType[]>;
  getProgramType(id: string): Promise<ProgramType | undefined>;
  createProgramType(programType: InsertProgramType): Promise<ProgramType>;
  updateProgramType(id: string, programType: Partial<InsertProgramType>): Promise<ProgramType | undefined>;
  deleteProgramType(id: string): Promise<boolean>;
  
  getPrograms(): Promise<Program[]>;
  getProgramsByType(typeId: string): Promise<Program[]>;
  getProgram(id: string): Promise<Program | undefined>;
  createProgram(program: InsertProgram): Promise<Program>;
  updateProgram(id: string, program: Partial<InsertProgram>): Promise<Program | undefined>;
  deleteProgram(id: string): Promise<boolean>;
  
  getAutomations(): Promise<Automation[]>;
  getAutomation(id: string): Promise<Automation | undefined>;
  createAutomation(automation: InsertAutomation): Promise<Automation>;
  updateAutomation(id: string, automation: Partial<InsertAutomation>): Promise<Automation | undefined>;
  deleteAutomation(id: string): Promise<boolean>;
  
  getAutomationRuns(automationId: string): Promise<AutomationRun[]>;
  createAutomationRun(run: InsertAutomationRun): Promise<AutomationRun>;
  updateAutomationRun(id: string, run: Partial<InsertAutomationRun>): Promise<AutomationRun | undefined>;
  
  getNewsItems(limit?: number): Promise<NewsItem[]>;
  getUnusedNewsItems(limit?: number): Promise<NewsItem[]>;
  createNewsItem(item: InsertNewsItem): Promise<NewsItem>;
  markNewsItemUsed(id: string): Promise<void>;
  clearOldNewsItems(daysOld: number): Promise<void>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getSettings(): Promise<Settings | undefined> {
    const [result] = await db.select().from(settings).limit(1);
    if (result) return result;
    
    const [defaultSettings] = await db.insert(settings).values({
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

  async saveSettings(newSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings();
    if (existing) {
      const [updated] = await db.update(settings)
        .set({
          elevenLabsApiKey: newSettings.elevenLabsApiKey ?? existing.elevenLabsApiKey,
          yandexDiskToken: newSettings.yandexDiskToken ?? existing.yandexDiskToken,
          maleVoiceId: newSettings.maleVoiceId ?? existing.maleVoiceId,
          femaleVoiceId: newSettings.femaleVoiceId ?? existing.femaleVoiceId,
          dailyDialogsCount: newSettings.dailyDialogsCount ?? existing.dailyDialogsCount,
          defaultPrompt: newSettings.defaultPrompt ?? existing.defaultPrompt,
        })
        .where(eq(settings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(settings).values(newSettings).returning();
    return created;
  }

  async getDialogs(): Promise<Dialog[]> {
    return db.select().from(dialogs).orderBy(desc(dialogs.createdAt));
  }

  async getDialog(id: string): Promise<Dialog | undefined> {
    const [dialog] = await db.select().from(dialogs).where(eq(dialogs.id, id));
    return dialog || undefined;
  }

  async createDialog(insertDialog: InsertDialog): Promise<Dialog> {
    const [dialog] = await db.insert(dialogs).values(insertDialog).returning();
    return dialog;
  }

  async updateDialog(id: string, updates: Partial<InsertDialog>): Promise<Dialog | undefined> {
    const [updated] = await db.update(dialogs)
      .set(updates)
      .where(eq(dialogs.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteDialog(id: string): Promise<boolean> {
    const result = await db.delete(dialogs).where(eq(dialogs.id, id)).returning();
    return result.length > 0;
  }

  async getNewsSources(): Promise<NewsSource[]> {
    return db.select().from(newsSources).orderBy(desc(newsSources.createdAt));
  }

  async getNewsSource(id: string): Promise<NewsSource | undefined> {
    const [source] = await db.select().from(newsSources).where(eq(newsSources.id, id));
    return source || undefined;
  }

  async createNewsSource(insertSource: InsertNewsSource): Promise<NewsSource> {
    const [source] = await db.insert(newsSources).values(insertSource).returning();
    return source;
  }

  async updateNewsSource(id: string, updates: Partial<InsertNewsSource>): Promise<NewsSource | undefined> {
    const [updated] = await db.update(newsSources)
      .set(updates)
      .where(eq(newsSources.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteNewsSource(id: string): Promise<boolean> {
    const result = await db.delete(newsSources).where(eq(newsSources.id, id)).returning();
    return result.length > 0;
  }

  async getAds(): Promise<Ad[]> {
    return db.select().from(ads).orderBy(desc(ads.createdAt));
  }

  async getAd(id: string): Promise<Ad | undefined> {
    const [ad] = await db.select().from(ads).where(eq(ads.id, id));
    return ad || undefined;
  }

  async createAd(insertAd: InsertAd): Promise<Ad> {
    const [ad] = await db.insert(ads).values(insertAd).returning();
    return ad;
  }

  async updateAd(id: string, updates: Partial<InsertAd>): Promise<Ad | undefined> {
    const [updated] = await db.update(ads)
      .set(updates)
      .where(eq(ads.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAd(id: string): Promise<boolean> {
    const result = await db.delete(ads).where(eq(ads.id, id)).returning();
    return result.length > 0;
  }

  async getVoices(): Promise<Voice[]> {
    return db.select().from(voices).orderBy(asc(voices.sortOrder));
  }

  async getVoice(id: string): Promise<Voice | undefined> {
    const [voice] = await db.select().from(voices).where(eq(voices.id, id));
    return voice || undefined;
  }

  async createVoice(insertVoice: InsertVoice): Promise<Voice> {
    const [voice] = await db.insert(voices).values(insertVoice).returning();
    return voice;
  }

  async updateVoice(id: string, updates: Partial<InsertVoice>): Promise<Voice | undefined> {
    const [updated] = await db.update(voices)
      .set(updates)
      .where(eq(voices.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteVoice(id: string): Promise<boolean> {
    const result = await db.delete(voices).where(eq(voices.id, id)).returning();
    return result.length > 0;
  }

  async getVoicesCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(voices);
    return result[0]?.count || 0;
  }

  async getProgramTypes(): Promise<ProgramType[]> {
    return db.select().from(programTypes).orderBy(asc(programTypes.sortOrder));
  }

  async getProgramType(id: string): Promise<ProgramType | undefined> {
    const [programType] = await db.select().from(programTypes).where(eq(programTypes.id, id));
    return programType || undefined;
  }

  async createProgramType(insertProgramType: InsertProgramType): Promise<ProgramType> {
    const [programType] = await db.insert(programTypes).values(insertProgramType).returning();
    return programType;
  }

  async updateProgramType(id: string, updates: Partial<InsertProgramType>): Promise<ProgramType | undefined> {
    const [updated] = await db.update(programTypes)
      .set(updates)
      .where(eq(programTypes.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProgramType(id: string): Promise<boolean> {
    const result = await db.delete(programTypes).where(eq(programTypes.id, id)).returning();
    return result.length > 0;
  }

  async getPrograms(): Promise<Program[]> {
    return db.select().from(programs).orderBy(desc(programs.createdAt));
  }

  async getProgramsByType(typeId: string): Promise<Program[]> {
    return db.select().from(programs).where(eq(programs.programTypeId, typeId)).orderBy(desc(programs.createdAt));
  }

  async getProgram(id: string): Promise<Program | undefined> {
    const [program] = await db.select().from(programs).where(eq(programs.id, id));
    return program || undefined;
  }

  async createProgram(insertProgram: InsertProgram): Promise<Program> {
    const [program] = await db.insert(programs).values(insertProgram).returning();
    return program;
  }

  async updateProgram(id: string, updates: Partial<InsertProgram>): Promise<Program | undefined> {
    const [updated] = await db.update(programs)
      .set(updates)
      .where(eq(programs.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProgram(id: string): Promise<boolean> {
    const result = await db.delete(programs).where(eq(programs.id, id)).returning();
    return result.length > 0;
  }

  async getAutomations(): Promise<Automation[]> {
    return db.select().from(automations).orderBy(desc(automations.createdAt));
  }

  async getAutomation(id: string): Promise<Automation | undefined> {
    const [automation] = await db.select().from(automations).where(eq(automations.id, id));
    return automation || undefined;
  }

  async createAutomation(insertAutomation: InsertAutomation): Promise<Automation> {
    const [automation] = await db.insert(automations).values(insertAutomation).returning();
    return automation;
  }

  async updateAutomation(id: string, updates: Partial<InsertAutomation>): Promise<Automation | undefined> {
    const [updated] = await db.update(automations)
      .set(updates)
      .where(eq(automations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAutomation(id: string): Promise<boolean> {
    await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
    const result = await db.delete(automations).where(eq(automations.id, id)).returning();
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

  async getNewsItems(limit: number = 50): Promise<NewsItem[]> {
    return db.select().from(newsItems)
      .orderBy(desc(newsItems.publishedAt))
      .limit(limit);
  }

  async getUnusedNewsItems(limit: number = 10): Promise<NewsItem[]> {
    return db.select().from(newsItems)
      .where(eq(newsItems.isUsed, false))
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
}

export const storage = new DatabaseStorage();
