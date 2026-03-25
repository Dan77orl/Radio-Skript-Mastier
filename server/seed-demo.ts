import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { db } from "./db";
import { users, settings, voices, programTypes, programs } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDemoIfNeeded() {
  try {
    const existing = await storage.getUserByEmail("demo@dallaswave.com");
    if (existing) {
      console.log("[seed] Demo user already exists, skipping");
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
