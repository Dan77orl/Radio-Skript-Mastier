import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { db } from "./db";
import { users, settings, voices, programTypes, programs } from "@shared/schema";
import { eq, isNull, notInArray, sql } from "drizzle-orm";

async function fixOrphanedProgramTypes() {
  try {
    const mainUser = await storage.getUserByEmail("test@test.com");
    if (!mainUser) return;

    const orphaned = await db.select().from(programTypes).where(isNull(programTypes.userId));
    if (orphaned.length > 0) {
      await db.update(programTypes)
        .set({ userId: mainUser.id })
        .where(isNull(programTypes.userId));
      console.log(`[seed] Assigned ${orphaned.length} orphaned program types to ${mainUser.email}`);
    }
  } catch (e) {
    console.error("[seed] fixOrphanedProgramTypes error:", e);
  }
}

async function ensureRuShowsExist() {
  try {
    const mainUser = await storage.getUserByEmail("test@test.com");
    if (!mainUser) return;

    const existingTypes = await storage.getProgramTypes(mainUser.id);
    const existingNames = existingTypes.map(t => t.name.toLowerCase());

    const ruShows = [
      {
        name: "Психофф",
        slug: "psyhoff-" + mainUser.id.substring(0, 8),
        description: "Это программа о психологии",
        defaultPrompt: "Создай выпуск программы 'Психофф' о психологии. Полезные факты, упражнения для расслабления. Информация из университетов (MIT, Oxford, Harvard). Без политики, без лекарств.",
        defaultDurationSeconds: 120,
        icon: "radio",
        dailyCount: 1,
        assignedVoiceIds: ["9225d02d-2e6c-4a18-aaad-65839a9e2786", "cf880d56-2e1b-4606-bbb1-720aa5d7bab0"],
        useFirecrawl: true,
        firecrawlTopics: ["психология исследования новости 2025 2026", "ментальное здоровье лайфхаки советы наука", "нейробиология открытия мозг стресс тревожность"],
        scriptTemplate: "Передача Алины Кочер. Алина ведет весь выпуск, Сергей говорит короткие фразы-перебивки.",
        sortOrder: 200,
      },
      {
        name: "ШоуБиZ на РуВэйв",
        slug: "showbiz-" + mainUser.id.substring(0, 8),
        description: "Новости шоу-бизнеса",
        defaultPrompt: "Создай выпуск о новостях шоу-бизнеса. Мировой, российский и турецкий шоу-бизнес. Только позитив: премьеры, награды, концерты. Без скандалов и политики.",
        defaultDurationSeconds: 120,
        icon: "sparkles",
        dailyCount: 1,
        assignedVoiceIds: ["9319f0cd-7902-4bc7-b963-e6ec68d58c1c"],
        useFirecrawl: true,
        firecrawlTopics: ["шоубизнес России", "шоубизнес мировой", "шоубизнес Турции"],
        scriptTemplate: "",
        sortOrder: 201,
      },
      {
        name: "Ваши метры",
        slug: "vashi-metry-" + mainUser.id.substring(0, 8),
        description: "Короткие выпуски о недвижимости на радио RuWave",
        defaultPrompt: "Создай выпуск программы 'Ваши метры' о недвижимости. Ведущая Лена Суворова. 180-230 слов, простой язык, практические советы.",
        defaultDurationSeconds: 120,
        icon: "home",
        dailyCount: 1,
        assignedVoiceIds: ["9319f0cd-7902-4bc7-b963-e6ec68d58c1c"],
        useFirecrawl: true,
        firecrawlTopics: ["недвижимость Аланья Турция 2026", "рынок квартир Турция покупка"],
        scriptTemplate: "",
        sortOrder: 202,
      },
    ];

    let created = 0;
    for (const show of ruShows) {
      if (!existingNames.includes(show.name.toLowerCase())) {
        await db.insert(programTypes).values({
          userId: mainUser.id,
          name: show.name,
          slug: show.slug,
          description: show.description,
          defaultPrompt: show.defaultPrompt,
          defaultDurationSeconds: show.defaultDurationSeconds,
          icon: show.icon,
          dailyCount: show.dailyCount,
          assignedVoiceIds: show.assignedVoiceIds,
          isActive: true,
          sortOrder: show.sortOrder,
          useFirecrawl: show.useFirecrawl,
          firecrawlTopics: show.firecrawlTopics,
          scriptTemplate: show.scriptTemplate,
        });
        created++;
      }
    }

    if (created > 0) {
      console.log(`[seed] Created ${created} missing RU shows for test@test.com`);
    }

    await reassignOrphanedPrograms();
  } catch (e: any) {
    console.warn("[seed] ensureRuShowsExist error:", e.message);
  }
}

async function reassignOrphanedPrograms() {
  try {
    const allTypeIds = await db.select({ id: programTypes.id }).from(programTypes);
    const validIds = allTypeIds.map(t => t.id);
    if (validIds.length === 0) return;

    const orphans = await db.select({
      id: programs.id,
      title: programs.title,
      programTypeId: programs.programTypeId,
    }).from(programs).where(notInArray(programs.programTypeId, validIds));

    if (orphans.length === 0) return;

    const allTypes = await db.select().from(programTypes);

    let reassigned = 0;
    for (const orphan of orphans) {
      const title = orphan.title.toLowerCase();
      let matchedType = null;

      for (const t of allTypes) {
        const typeName = t.name.toLowerCase();
        if (title.includes(typeName) || title.startsWith(typeName.split(" ")[0])) {
          matchedType = t;
          break;
        }
      }

      if (!matchedType) {
        if (title.includes("психо") || title.includes("гормон") || title.includes("эмоцион") || title.includes("тревож") || title.includes("привязан") || title.includes("мотивац") || title.includes("самозван") || title.includes("интуиц") || title.includes("нейро") || title.includes("стресс") || title.includes("выгоран") || title.includes("травм") || title.includes("привыч") || title.includes("сон")) {
          matchedType = allTypes.find(t => t.name === "Психофф");
        } else if (title.includes("метр") || title.includes("квартир") || title.includes("недвижим") || title.includes("дорог")) {
          matchedType = allTypes.find(t => t.name === "Ваши метры");
        } else if (title.includes("шоубиz") || title.includes("шоубиз") || title.includes("звёзд")) {
          matchedType = allTypes.find(t => t.name === "ШоуБиZ на РуВэйв");
        }
      }

      if (matchedType) {
        await db.update(programs)
          .set({ programTypeId: matchedType.id })
          .where(eq(programs.id, orphan.id));
        reassigned++;
      }
    }

    if (reassigned > 0) {
      console.log(`[seed] Reassigned ${reassigned}/${orphans.length} orphaned programs`);
    }
    if (orphans.length - reassigned > 0) {
      console.log(`[seed] ${orphans.length - reassigned} programs remain orphaned (no matching type)`);
    }
  } catch (e: any) {
    console.warn("[seed] reassignOrphanedPrograms error:", e.message);
  }
}

async function ensureDemoShowsExist(userId: string) {
  try {
    const existingTypes = await storage.getProgramTypes(userId);
    const existingNames = existingTypes.map(t => t.name.toLowerCase());

    const allVoices = await db.select().from(voices);
    let mikeId = allVoices.find(v => v.personaName === "Mike")?.id;
    let sarahId = allVoices.find(v => v.personaName === "Sarah")?.id;

    if (!mikeId) {
      const [v] = await db.insert(voices).values({
        name: "Mike", elevenLabsVoiceId: "N2lVS1w4EtoT3dr4eOWO",
        personaName: "Mike", description: "Male host - energetic American radio voice", sortOrder: 10,
      }).returning();
      mikeId = v.id;
    }
    if (!sarahId) {
      const [v] = await db.insert(voices).values({
        name: "Sarah", elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL",
        personaName: "Sarah", description: "Female host - warm and professional", sortOrder: 11,
      }).returning();
      sarahId = v.id;
    }

    const showsToCreate = [
      { name: "Dallas News", slug: "dallas-news-" + userId.substring(0, 8), description: "Daily news from Dallas and Texas - local events, community updates, and breaking stories", prompt: "Create a short 2-minute radio news segment for Dallas Wave FM. Cover local Dallas news, Texas events. Write in English.", duration: 120, icon: "newspaper", daily: 3, voiceIds: [mikeId, sarahId], topics: ["Dallas Texas news today", "Dallas local events 2026", "Texas community news"], template: "Mike and Sarah host together. Mike is energetic, Sarah is analytical. Multi-speaker format with [Mike]: and [Sarah]: prefixes and emotion tags." },
      { name: "Pop Buzz", slug: "pop-buzz-" + userId.substring(0, 8), description: "Celebrity news, music charts, entertainment", prompt: "Create a fun 90-second pop culture segment for Dallas Wave FM. Write in English.", duration: 90, icon: "star", daily: 2, voiceIds: [sarahId], topics: ["celebrity news today", "pop music charts 2026"], template: "Sarah's solo segment. Fun, gossipy style. Format: [Sarah]: with emotion tags." },
      { name: "Dallas Weather", slug: "dallas-weather-" + userId.substring(0, 8), description: "Weather forecast for Dallas-Fort Worth", prompt: "Create a 30-second weather forecast for Dallas-Fort Worth. Write in English.", duration: 30, icon: "cloud-sun", daily: 4, voiceIds: [mikeId], topics: ["Dallas Texas weather forecast today"], template: "Mike delivers quick weather. Format: [Mike]: with emotion tags." },
      { name: "Tech Minute", slug: "tech-minute-" + userId.substring(0, 8), description: "Quick tech news - gadgets, AI, digital trends", prompt: "Create a 60-second tech news segment for Dallas Wave FM. Write in English.", duration: 60, icon: "cpu", daily: 2, voiceIds: [mikeId, sarahId], topics: ["tech news today AI", "new gadgets 2026"], template: "Mike and Sarah discuss tech. Multi-speaker with emotion tags." },
    ];

    let created = 0;
    for (const show of showsToCreate) {
      if (!existingNames.includes(show.name.toLowerCase())) {
        await db.insert(programTypes).values({
          userId,
          name: show.name,
          slug: show.slug,
          description: show.description,
          defaultPrompt: show.prompt,
          defaultDurationSeconds: show.duration,
          icon: show.icon,
          dailyCount: show.daily,
          assignedVoiceIds: show.voiceIds,
          isActive: true,
          sortOrder: 100 + created,
          useFirecrawl: true,
          firecrawlTopics: show.topics,
          scriptTemplate: show.template,
        });
        created++;
      }
    }
    if (created > 0) {
      console.log(`[seed] Created ${created} missing demo shows`);
    }
  } catch (e: any) {
    console.warn("[seed] ensureDemoShowsExist error:", e.message);
  }
}

export async function seedDemoIfNeeded() {
  try {
    await fixOrphanedProgramTypes();
    await ensureRuShowsExist();

    const existing = await storage.getUserByEmail("demo@dallaswave.com");
    if (existing) {
      const hashedPw = await bcrypt.hash("demo123", 10);
      await db.update(users).set({ password: hashedPw }).where(eq(users.id, existing.id));
      console.log("[seed] Demo user exists, password reset to demo123");
      await ensureDemoShowsExist(existing.id);
      return;
    }

    console.log("[seed] Creating demo Dallas Wave FM user...");

    const hashedPw = await bcrypt.hash("demo123", 10);
    const [user] = await db.insert(users).values({
      username: "dallas_radio",
      email: "demo@dallaswave.com",
      password: hashedPw,
      name: "Dallas Wave FM",
      language: "en",
    }).returning();

    const existingSettings = await storage.getSettings();
    if (existingSettings) {
      await db.insert(settings).values({
        userId: user.id,
        elevenLabsApiKey: existingSettings.elevenLabsApiKey,
        anthropicApiKey: existingSettings.anthropicApiKey,
        yandexDiskToken: existingSettings.yandexDiskToken,
        aiProvider: "anthropic",
        stationName: "Dallas Wave FM",
        stationLocation: "Dallas, Texas",
        defaultPrompt: "Create a radio segment for Dallas Wave FM, a pop music station in Dallas, Texas. Write in English.",
      });
    }

    const [voiceMike] = await db.insert(voices).values({
      name: "Mike",
      elevenLabsVoiceId: "N2lVS1w4EtoT3dr4eOWO",
      personaName: "Mike",
      description: "Male host - energetic American radio voice",
      sortOrder: 10,
    }).returning();

    const [voiceSarah] = await db.insert(voices).values({
      name: "Sarah",
      elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL",
      personaName: "Sarah",
      description: "Female host - warm and professional",
      sortOrder: 11,
    }).returning();

    const [newsType] = await db.insert(programTypes).values({
      userId: user.id,
      name: "Dallas News",
      slug: "dallas-news-" + user.id.substring(0, 8),
      description: "Daily news from Dallas and Texas",
      defaultPrompt: "Create a short 2-minute radio news segment for Dallas Wave FM. Cover local Dallas news, Texas events. Write in English.",
      defaultDurationSeconds: 120,
      icon: "newspaper",
      dailyCount: 3,
      assignedVoiceIds: [voiceMike.id, voiceSarah.id],
      isActive: true,
      sortOrder: 100,
      useFirecrawl: true,
      firecrawlTopics: ["Dallas Texas news today", "Dallas local events 2026"],
      scriptTemplate: `Mike and Sarah host together. Mike is energetic, Sarah is analytical. Multi-speaker format with [Mike]: and [Sarah]: prefixes and emotion tags.`,
    }).returning();

    const [popType] = await db.insert(programTypes).values({
      userId: user.id,
      name: "Pop Buzz",
      slug: "pop-buzz-" + user.id.substring(0, 8),
      description: "Celebrity news, music charts, entertainment",
      defaultPrompt: "Create a fun 90-second pop culture segment for Dallas Wave FM. Write in English.",
      defaultDurationSeconds: 90,
      icon: "star",
      dailyCount: 2,
      assignedVoiceIds: [voiceSarah.id],
      isActive: true,
      sortOrder: 101,
      useFirecrawl: true,
      firecrawlTopics: ["celebrity news today", "pop music charts 2026"],
      scriptTemplate: `Sarah's solo segment. Fun, gossipy style. Format: [Sarah]: with emotion tags.`,
    }).returning();

    const [weatherType] = await db.insert(programTypes).values({
      userId: user.id,
      name: "Dallas Weather",
      slug: "dallas-weather-" + user.id.substring(0, 8),
      description: "Weather forecast for Dallas-Fort Worth",
      defaultPrompt: "Create a 30-second weather forecast for Dallas-Fort Worth. Write in English.",
      defaultDurationSeconds: 30,
      icon: "cloud-sun",
      dailyCount: 4,
      assignedVoiceIds: [voiceMike.id],
      isActive: true,
      sortOrder: 102,
      useFirecrawl: true,
      firecrawlTopics: ["Dallas Texas weather forecast today"],
      scriptTemplate: `Mike delivers quick weather. Format: [Mike]: with emotion tags.`,
    }).returning();

    const [techType] = await db.insert(programTypes).values({
      userId: user.id,
      name: "Tech Minute",
      slug: "tech-minute-" + user.id.substring(0, 8),
      description: "Quick tech news - gadgets, AI, digital trends",
      defaultPrompt: "Create a 60-second tech news segment for Dallas Wave FM. Write in English.",
      defaultDurationSeconds: 60,
      icon: "cpu",
      dailyCount: 2,
      assignedVoiceIds: [voiceMike.id, voiceSarah.id],
      isActive: true,
      sortOrder: 103,
      useFirecrawl: true,
      firecrawlTopics: ["tech news today AI", "new gadgets 2026"],
      scriptTemplate: `Mike and Sarah discuss tech. Multi-speaker with emotion tags.`,
    }).returning();

    const today = new Date().toISOString().split("T")[0];

    await db.insert(programs).values({
      programTypeId: newsType.id,
      title: "Dallas Morning Update",
      scriptText: `[Mike]: [energetic] Good morning, Dallas! You are tuned in to Dallas Wave FM! I am Mike!\n[Sarah]: [warm] And I am Sarah! We have got a packed show for you today.\n[Mike]: [surprised] The Dallas Arts District just announced a massive expansion project!\n[Sarah]: [thoughtful] The city council approved a two hundred million dollar investment. Really exciting news.\n[Mike]: [excited] And the Mavericks had an incredible game last night!\n[Sarah]: [announcer] Quick heads up — construction on I-35 near Oak Lawn, give yourself extra time.\n[Mike]: [warm] Stay safe out there, Dallas! More updates on Dallas Wave FM!`,
      status: "script_ready",
      scheduledDate: today,
      slotNumber: 1,
      scriptGeneratedAt: new Date(),
    });

    await db.insert(programs).values({
      programTypeId: popType.id,
      title: "Pop Buzz: Celebrity Updates",
      scriptText: `[Sarah]: [energetic] It is Pop Buzz time on Dallas Wave FM!\n[Sarah]: [surprised] Taylor Swift just dropped a surprise collaboration, and it already has fifty million streams!\n[Sarah]: [playful] Grammy nominations are out — Sabrina Carpenter scored six nominations!\n[Sarah]: [excited] Ryan Reynolds and Hugh Jackman spotted in Dallas scouting movie locations!\n[Sarah]: [warm] That is your Pop Buzz! Follow us on socials at Dallas Wave FM!`,
      status: "script_ready",
      scheduledDate: today,
      slotNumber: 1,
      scriptGeneratedAt: new Date(),
    });

    await db.insert(programs).values({
      programTypeId: weatherType.id,
      title: "Dallas Weather Update",
      scriptText: `[Mike]: [warm] [announcer] Dallas Wave FM weather! Partly cloudy today with a high of seventy-eight degrees. Tonight cooling to sixty-two. Tomorrow slight chance of afternoon showers. Rest of the week — sunshine all the way! Perfect patio weather, Dallas!`,
      status: "script_ready",
      scheduledDate: today,
      slotNumber: 1,
      scriptGeneratedAt: new Date(),
    });

    await db.insert(programs).values({
      programTypeId: techType.id,
      title: "Tech Minute: AI and Gadgets",
      scriptText: `[Mike]: [energetic] Tech Minute on Dallas Wave FM!\n[Sarah]: [warm] What is new in tech, Mike?\n[Mike]: [excited] Apple announced the iPhone eighteen with an offline AI chip!\n[Sarah]: [surprised] It works without WiFi? Amazing!\n[Mike]: [thoughtful] And it translates forty languages in real time during calls.\n[Sarah]: [playful] Can it translate my mom's texts?\n[Mike]: [playful] Ha! Technology cannot solve everything, Sarah.\n[Sarah]: [warm] That is your Tech Minute, Dallas!`,
      status: "script_ready",
      scheduledDate: today,
      slotNumber: 1,
      scriptGeneratedAt: new Date(),
    });

    console.log("[seed] Demo Dallas Wave FM created successfully");
  } catch (e: any) {
    console.warn("[seed] Demo seed error (non-fatal):", e.message);
  }
}
