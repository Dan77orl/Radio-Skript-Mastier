import { users, settings, dialogs, type User, type InsertUser, type Settings, type InsertSettings, type Dialog, type InsertDialog } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
