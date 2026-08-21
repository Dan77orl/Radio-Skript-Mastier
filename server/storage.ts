import { users, settings, dialogs, newsSources, newsItems, ads, adPresets, voices, programTypes, programs, automations, automationRuns, scheduleTemplates, hostShifts, customHolidays, usageLogs, supportMessages, type User, type InsertUser, type Settings, type InsertSettings, type Dialog, type InsertDialog, type NewsSource, type InsertNewsSource, type NewsItem, type InsertNewsItem, type Ad, type InsertAd, type AdPreset, type InsertAdPreset, type Voice, type InsertVoice, type ProgramType, type InsertProgramType, type Program, type InsertProgram, type Automation, type InsertAutomation, type AutomationRun, type InsertAutomationRun, type ScheduleTemplate, type InsertScheduleTemplate, type HostShift, type InsertHostShift, type CustomHoliday, type InsertCustomHoliday, type UsageLog, type InsertUsageLog, type SupportMessage, type InsertSupportMessage } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, sql, and, or, isNull } from "drizzle-orm";

const LANG_NAMES: Record<string, string> = {
  ru: "Russian", en: "English", tr: "Turkish", de: "German", es: "Spanish", fr: "French",
  pt: "Portuguese", it: "Italian", uk: "Ukrainian", pl: "Polish", nl: "Dutch", sv: "Swedish",
  da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech", sk: "Slovak", hu: "Hungarian",
  ro: "Romanian", bg: "Bulgarian", el: "Greek", hr: "Croatian", sr: "Serbian", sl: "Slovenian",
  bs: "Bosnian", mk: "Macedonian", sq: "Albanian", lt: "Lithuanian", lv: "Latvian", et: "Estonian",
  kk: "Kazakh", uz: "Uzbek", ky: "Kyrgyz", tg: "Tajik", mn: "Mongolian", az: "Azerbaijani",
  ka: "Georgian", hy: "Armenian", ar: "Arabic", he: "Hebrew", fa: "Persian", zh: "Chinese",
  ja: "Japanese", ko: "Korean", hi: "Hindi", bn: "Bengali", ta: "Tamil", th: "Thai",
  vi: "Vietnamese", id: "Indonesian", ms: "Malay", sw: "Swahili",
};

export function getDefaultPromptForLanguage(lang: string): string {
  const prompts: Record<string, string> = {
    ru: `Создай короткий диалог между ведущими радио "Radio FM" (мужчина и женщина).
Тема: местная жизнь, культура, интересные факты.
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.
Обязательно включи: приветствие слушателей, интересный факт или полезный совет.`,
    tr: `"Radio FM" radyo sunucuları (erkek ve kadın) arasında kısa bir diyalog oluştur.
Konu: yerel yaşam, kültür, ilginç bilgiler.
Tarz: samimi, rahat, espritüel.
Süre: sesli okunduğunda 30-50 saniye.
Mutlaka dahil et: dinleyicilere selamlama, ilginç bir bilgi veya faydalı bir ipucu.`,
    de: `Erstelle einen kurzen Dialog zwischen den Radiomoderatoren (Mann und Frau) von "Radio FM".
Thema: lokales Leben, Kultur, interessante Fakten.
Stil: freundlich, ungezwungen, mit Humor.
Dauer: 30-50 Sekunden beim Vorlesen.
Muss enthalten: Begrüßung der Zuhörer, eine interessante Tatsache oder ein nützlicher Tipp.`,
    es: `Crea un diálogo corto entre los presentadores de radio (hombre y mujer) de "Radio FM".
Tema: vida local, cultura, datos interesantes.
Estilo: amigable, informal, con humor.
Duración: 30-50 segundos al leer en voz alta.
Debe incluir: saludo a los oyentes, un dato interesante o consejo útil.`,
    fr: `Crée un court dialogue entre les animateurs radio (homme et femme) de "Radio FM".
Sujet : vie locale, culture, faits intéressants.
Style : amical, décontracté, avec humour.
Durée : 30-50 secondes à la lecture.
Doit inclure : salutation aux auditeurs, un fait intéressant ou un conseil utile.`,
    pt: `Crie um diálogo curto entre os apresentadores de rádio (homem e mulher) da "Radio FM".
Tema: vida local, cultura, fatos interessantes.
Estilo: amigável, casual, com humor.
Duração: 30-50 segundos ao ler em voz alta.
Deve incluir: saudação aos ouvintes, um fato interessante ou dica útil.`,
    it: `Crea un breve dialogo tra i conduttori radio (uomo e donna) di "Radio FM".
Tema: vita locale, cultura, fatti interessanti.
Stile: amichevole, informale, con umorismo.
Durata: 30-50 secondi a voce alta.
Deve includere: saluto agli ascoltatori, un fatto interessante o un consiglio utile.`,
    uk: `Створи короткий діалог між ведучими радіо "Radio FM" (чоловік і жінка).
Тема: місцеве життя, культура, цікаві факти.
Стиль: дружній, невимушений, з гумором.
Тривалість: 30-50 секунд при читанні.
Обов'язково включи: привітання слухачів, цікавий факт або корисну пораду.`,
    pl: `Stwórz krótki dialog między prowadzącymi radia "Radio FM" (mężczyzna i kobieta).
Temat: lokalne życie, kultura, ciekawe fakty.
Styl: przyjazny, swobodny, z humorem.
Czas trwania: 30-50 sekund przy czytaniu na głos.
Musi zawierać: powitanie słuchaczy, ciekawy fakt lub przydatną wskazówkę.`,
    ar: `أنشئ حوارًا قصيرًا بين مقدمي البرامج الإذاعية (رجل وامرأة) في "Radio FM".
الموضوع: الحياة المحلية، الثقافة، حقائق مثيرة للاهتمام.
الأسلوب: ودي، عفوي، مع روح الدعابة.
المدة: 30-50 ثانية عند القراءة بصوت عالٍ.
يجب أن يتضمن: تحية للمستمعين، حقيقة مثيرة للاهتمام أو نصيحة مفيدة.`,
    zh: `创建"Radio FM"电台主持人（男女）之间的简短对话。
主题：当地生活、文化、有趣的事实。
风格：友好、随意、幽默。
时长：朗读时30-50秒。
必须包含：向听众问好、一个有趣的事实或有用的建议。`,
    ja: `「Radio FM」のラジオホスト（男女）の短い対話を作成してください。
テーマ：地元の生活、文化、興味深い事実。
スタイル：フレンドリー、カジュアル、ユーモアを交えて。
長さ：読み上げ時30〜50秒。
必ず含める：リスナーへの挨拶、興味深い事実または役立つアドバイス。`,
    ko: `"Radio FM" 라디오 호스트(남녀) 사이의 짧은 대화를 만들어 주세요.
주제: 지역 생활, 문화, 흥미로운 사실.
스타일: 친근하고 캐주얼하며 유머러스하게.
길이: 소리내어 읽을 때 30-50초.
반드시 포함: 청취자 인사, 흥미로운 사실 또는 유용한 팁.`,
    hi: `"Radio FM" के रेडियो होस्ट (पुरुष और महिला) के बीच एक छोटा संवाद बनाएं।
विषय: स्थानीय जीवन, संस्कृति, दिलचस्प तथ्य।
शैली: मित्रवत, अनौपचारिक, हास्य के साथ।
अवधि: जोर से पढ़ने पर 30-50 सेकंड।
अवश्य शामिल करें: श्रोताओं को अभिवादन, एक दिलचस्प तथ्य या उपयोगी सुझाव।`,
  };
  if (prompts[lang]) return prompts[lang];
  const langName = LANG_NAMES[lang] || lang;
  return `[Write entirely in ${langName}] Create a short dialog between radio hosts (male and female) of "Radio FM".
Topic: local life, culture, interesting facts.
Style: friendly, casual, with humor.
Duration: 30-50 seconds when read aloud.
Must include: greeting to listeners, an interesting fact or useful tip.`;
}

function getDefaultDailyPromptForLanguage(lang: string): string {
  const prompts: Record<string, string> = {
    ru: `Сегодня создаём диалоги для радио. Учитывай:
- День недели и время суток для каждого слота
- Актуальные события и праздники
- Местные новости и погоду
- Стиль: дружелюбный, с юмором
- Для утренних слотов: бодрящие темы, приветствие дня
- Для дневных слотов: полезные советы, интересные факты
- Для вечерних слотов: расслабляющие темы, итоги дня`,
    tr: `Bugün radyo için diyaloglar oluşturuyoruz. Dikkate al:
- Her slot için haftanın günü ve günün saati
- Güncel olaylar ve tatiller
- Yerel haberler ve hava durumu
- Tarz: samimi, espritüel
- Sabah slotları: enerji veren konular, güne merhaba
- Gündüz slotları: faydalı ipuçları, ilginç bilgiler
- Akşam slotları: rahatlatıcı konular, günün özeti`,
    de: `Heute erstellen wir Dialoge fürs Radio. Berücksichtige:
- Wochentag und Tageszeit für jeden Slot
- Aktuelle Ereignisse und Feiertage
- Lokale Nachrichten und Wetter
- Stil: freundlich, mit Humor
- Für Morgen-Slots: belebende Themen, Begrüßung des Tages
- Für Tages-Slots: nützliche Tipps, interessante Fakten
- Für Abend-Slots: entspannende Themen, Tagesrückblick`,
    es: `Hoy creamos diálogos para la radio. Considera:
- Día de la semana y hora del día para cada slot
- Eventos actuales y festividades
- Noticias locales y clima
- Estilo: amigable, con humor
- Para slots matutinos: temas energizantes, saludo al día
- Para slots diurnos: consejos útiles, datos interesantes
- Para slots nocturnos: temas relajantes, resumen del día`,
    fr: `Aujourd'hui nous créons des dialogues pour la radio. Considère :
- Le jour de la semaine et l'heure pour chaque créneau
- Les événements actuels et les fêtes
- Les nouvelles locales et la météo
- Style : amical, avec humour
- Pour les créneaux du matin : sujets énergisants, salut à la journée
- Pour les créneaux de la journée : conseils utiles, faits intéressants
- Pour les créneaux du soir : sujets relaxants, résumé de la journée`,
  };
  if (prompts[lang]) return prompts[lang];
  const langName = LANG_NAMES[lang] || lang;
  return `[Write entirely in ${langName}] Today we are creating dialogs for the radio. Consider:
- Day of the week and time of day for each slot
- Current events and holidays
- Local news and weather
- Style: friendly, with humor
- For morning slots: energizing topics, greeting the day
- For daytime slots: useful tips, interesting facts
- For evening slots: relaxing topics, day summary`;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserLanguage(id: string, language: string): Promise<void>;
  completeOnboarding(id: string): Promise<void>;
  updateDefaultPromptsForLanguage(userId: string, language: string): Promise<void>;
  
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
  reorderVoices(userId: string, orderedIds: string[]): Promise<void>;
  
  getProgramTypes(userId?: string): Promise<ProgramType[]>;
  getProgramType(id: string, userId?: string): Promise<ProgramType | undefined>;
  createProgramType(programType: InsertProgramType): Promise<ProgramType>;
  updateProgramType(id: string, userId: string, programType: Partial<InsertProgramType>): Promise<ProgramType | undefined>;
  deleteProgramType(id: string, userId: string): Promise<boolean>;
  reorderProgramTypes(userId: string, orderedIds: string[]): Promise<void>;
  
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

  createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage>;
  getSupportMessages(limit?: number): Promise<SupportMessage[]>;
  getSupportMessagesBySession(sessionId: string): Promise<SupportMessage[]>;
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

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user || undefined;
  }

  async linkTelegramAccount(
    userId: string,
    data: { telegramId: string; telegramUsername: string | null; telegramPhotoUrl: string | null },
  ): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, userId)).returning();
    return updated || undefined;
  }

  async unlinkTelegramAccount(userId: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ telegramId: null, telegramUsername: null, telegramPhotoUrl: null, requireTelegramLogin: false })
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async setRequireTelegramLogin(userId: string, required: boolean): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ requireTelegramLogin: required })
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async updateUserLanguage(id: string, language: string): Promise<void> {
    await db.update(users).set({ language }).where(eq(users.id, id));
  }

  async completeOnboarding(id: string): Promise<void> {
    await db.update(users).set({ hasCompletedOnboarding: true }).where(eq(users.id, id));
  }

  async updateDefaultPromptsForLanguage(userId: string, language: string): Promise<void> {
    const [row] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
    if (!row) return;

    const knownDefaultPrompts = new Set<string>();
    const knownDailyPrompts = new Set<string>();
    const allLangs = Object.keys(LANG_NAMES);
    for (const lang of allLangs) {
      knownDefaultPrompts.add(getDefaultPromptForLanguage(lang).trim());
      knownDailyPrompts.add(getDefaultDailyPromptForLanguage(lang).trim());
    }

    const updates: Record<string, string> = {};
    if (row.defaultPrompt && knownDefaultPrompts.has(row.defaultPrompt.trim())) {
      updates.defaultPrompt = getDefaultPromptForLanguage(language);
    }
    if (row.dailyPrompt && knownDailyPrompts.has(row.dailyPrompt.trim())) {
      updates.dailyPrompt = getDefaultDailyPromptForLanguage(language);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(settings).set(updates).where(eq(settings.userId, userId));
    }
  }

  async getSettings(userId?: string): Promise<Settings | undefined> {
    let result: Settings | undefined;
    if (userId) {
      const [row] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
      if (row) {
        result = row;
      } else {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const lang = user?.language || "en";

        const defaultPrompt = getDefaultPromptForLanguage(lang);
        const dailyPrompt = getDefaultDailyPromptForLanguage(lang);

        const [defaultSettings] = await db.insert(settings).values({
          userId,
          elevenLabsApiKey: null,
          yandexDiskToken: null,
          maleVoiceId: "onwK4e9ZLuTAKqWW03F9",
          femaleVoiceId: "EXAVITQu4vr4xnSDxMaL",
          dailyDialogsCount: 12,
          defaultPrompt,
          dailyPrompt,
          stationName: "Radio FM",
          stationWebsite: "http://radiofm.com",
          stationLocation: "",
        }).returning();
        result = defaultSettings;
      }
    } else {
      const [row] = await db.select().from(settings).limit(1);
      result = row || undefined;
    }

    if (result) {
      // Secrets are the source of truth for provider keys; the per-user column
      // is only a fallback for installs that have no secret configured. This
      // way rotating a key in the environment takes effect immediately, even
      // if a user once pasted an old (or wrong) value into their settings.
      return {
        ...result,
        elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || result.elevenLabsApiKey || null,
        anthropicApiKey:
          process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || result.anthropicApiKey || null,
      };
    }
    return result;
  }

  async getRawSettings(userId?: string): Promise<Settings | undefined> {
    if (userId) {
      const [result] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
      return result;
    }
    const [result] = await db.select().from(settings).limit(1);
    return result || undefined;
  }

  async saveSettings(newSettings: InsertSettings, userId?: string): Promise<Settings> {
    // `id` and `userId` are owned by the server, never by the request body:
    // letting a caller set userId would reassign their settings row to another
    // tenant.
    const { id: _ignoredId, userId: _ignoredUserId, ...incoming } = newSettings as Record<string, unknown>;

    const existing = await this.getRawSettings(userId);
    if (existing) {
      const merged: Record<string, unknown> = {};
      for (const key of Object.keys(incoming)) {
        // undefined = "not supplied, keep what is stored"; null = "clear it".
        // Collapsing the two (`??`) made it impossible to erase a value, so
        // disconnecting a cloud account left its refresh token in the database.
        merged[key] = incoming[key] !== undefined
          ? incoming[key]
          : (existing as Record<string, unknown>)[key];
      }
      for (const key of Object.keys(existing) as string[]) {
        if (!(key in merged) && key !== "id") {
          merged[key] = (existing as Record<string, unknown>)[key];
        }
      }
      merged.userId = userId || existing.userId;
      const [updated] = await db.update(settings)
        .set(merged)
        .where(eq(settings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(settings).values({ ...incoming, userId: userId || null } as InsertSettings).returning();
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

  async reorderVoices(userId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(voices)
          .set({ sortOrder: i })
          .where(and(eq(voices.id, orderedIds[i]), eq(voices.userId, userId)));
      }
    });
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

  async reorderProgramTypes(userId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(programTypes)
          .set({ sortOrder: i })
          .where(and(eq(programTypes.id, orderedIds[i]), eq(programTypes.userId, userId)));
      }
    });
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

  async createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage> {
    const [created] = await db.insert(supportMessages).values(msg).returning();
    return created;
  }

  async getSupportMessages(limit?: number): Promise<SupportMessage[]> {
    return db.select().from(supportMessages).orderBy(desc(supportMessages.createdAt)).limit(limit || 200);
  }

  async getSupportMessagesBySession(sessionId: string): Promise<SupportMessage[]> {
    return db.select().from(supportMessages).where(eq(supportMessages.sessionId, sessionId)).orderBy(asc(supportMessages.createdAt));
  }
}

export const storage = new DatabaseStorage();
