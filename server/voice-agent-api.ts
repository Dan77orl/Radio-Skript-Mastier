import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";

const AGENT_USER_ID = "96995f3b-637e-49f4-8eaa-6f43eb9280bf";

function requireAgentKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  const expected = process.env.VOICE_AGENT_API_KEY;
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).agentUserId = AGENT_USER_ID;
  next();
}

async function internalFetch(path: string, method: string = "GET", body?: any) {
  const port = process.env.PORT || 5000;
  const url = `http://localhost:${port}${path}`;
  const opts: any = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": process.env.VOICE_AGENT_API_KEY || "",
      "X-Internal-User-Id": AGENT_USER_ID,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    return res;
  } catch (e: any) {
    console.error(`[voice-agent] internalFetch failed: ${method} ${url} - ${e.message}`);
    throw e;
  }
}

export function registerVoiceAgentRoutes(app: Express) {
  app.get("/api/voice-agent/program-types", requireAgentKey, async (_req, res) => {
    try {
      const types = await storage.getProgramTypes();
      const active = types.filter(t => t.isActive);
      res.json({
        programTypes: active.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          dailyCount: t.dailyCount,
          durationSeconds: t.defaultDurationSeconds,
        })),
        summary: `Доступные передачи: ${active.map(t => t.name).join(", ")}`,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get program types" });
    }
  });

  app.post("/api/voice-agent/create-program", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName, date, count } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({
          error: `Передача "${programTypeName}" не найдена`,
          available: types.filter(t => t.isActive).map(t => t.name),
        });
      }

      const dateStr = date || new Date().toISOString().split("T")[0];
      const numPrograms = Math.min(count || 1, 20);

      const created: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < numPrograms; i++) {
        try {
          const targetDate = new Date(dateStr);
          targetDate.setDate(targetDate.getDate() + Math.floor(i / (programType.dailyCount || 1)));
          const targetDateStr = targetDate.toISOString().split("T")[0];

          const response = await internalFetch(`/api/programs/auto-create/${programType.id}`, "POST", { date: targetDateStr });

          if (response.ok) {
            const result = await response.json();
            created.push({
              id: result.id,
              title: result.title,
              date: targetDateStr,
              status: result.status,
            });
          } else {
            const err = await response.json().catch(() => ({ error: "Unknown error" }));
            errors.push(`Выпуск ${i + 1}: ${(err as any).error || "ошибка"}`);
          }
        } catch (e: any) {
          errors.push(`Выпуск ${i + 1}: ${e.message}`);
        }
      }

      res.json({
        success: created.length > 0,
        message: created.length === 1
          ? `Создан выпуск "${created[0].title}" со скриптом на ${created[0].date}.`
          : `Создано ${created.length} выпусков передачи "${programType.name}".${errors.length > 0 ? ` Ошибки: ${errors.length}.` : ""}`,
        created,
        errors: errors.length > 0 ? errors : undefined,
        programType: programType.name,
      });
    } catch (error) {
      console.error("Voice agent create-program error:", error);
      res.status(500).json({ error: "Не удалось создать программу" });
    }
  });

  app.post("/api/voice-agent/generate-audio", requireAgentKey, async (req, res) => {
    try {
      const { programId, programTypeName, date } = req.body;

      let programIds: string[] = [];
      let typeName = programTypeName || "";

      if (programId) {
        programIds = [programId];
      } else if (programTypeName) {
        const types = await storage.getProgramTypes();
        const programType = types.find(t =>
          t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
        );
        if (!programType) {
          return res.status(404).json({ error: `Передача "${programTypeName}" не найдена` });
        }
        typeName = programType.name;
        const programs = await storage.getProgramsByType(programType.id);
        const dateStr = date || new Date().toISOString().split("T")[0];
        const toVoice = programs.filter(p =>
          p.scriptText && !p.audioUrl && p.scheduledDate === dateStr
        );
        programIds = toVoice.map(p => p.id);
        if (programIds.length === 0) {
          return res.json({
            success: true,
            message: `Нет программ для озвучки "${programType.name}" на ${dateStr}. Все уже озвучены или нет скриптов.`,
          });
        }
      } else {
        return res.status(400).json({ error: "Укажите programId или programTypeName" });
      }

      const totalCount = programIds.length;

      res.json({
        success: true,
        message: `Запущена озвучка ${totalCount} программ${typeName ? ` "${typeName}"` : ""}. Аудио генерируется в фоне, это займёт 1-2 минуты. Проверь статус через get_programs_status.`,
        total: totalCount,
        status: "processing",
      });

      (async () => {
        for (const pid of programIds) {
          try {
            console.log(`[voice-agent] Generating audio for program ${pid}...`);
            const audioRes = await internalFetch(`/api/programs/${pid}/generate-audio`, "POST");
            if (audioRes.ok) {
              console.log(`[voice-agent] Audio done for program ${pid}`);
            } else {
              const err = await audioRes.json().catch(() => ({}));
              console.error(`[voice-agent] Audio error for ${pid}: ${(err as any).error}`);
            }
          } catch (e: any) {
            console.error(`[voice-agent] Audio error for ${pid}:`, e.message);
          }
        }
        console.log(`[voice-agent] Audio generation complete for ${totalCount} programs`);
      })();
    } catch (error) {
      console.error("Voice agent generate-audio error:", error);
      res.status(500).json({ error: "Не удалось сгенерировать аудио" });
    }
  });

  app.post("/api/voice-agent/full-pipeline", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName, count, date } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({ error: `Передача "${programTypeName}" не найдена` });
      }

      const dateStr = date || new Date().toISOString().split("T")[0];
      const numPrograms = Math.min(count || 1, 20);

      res.json({
        success: true,
        message: `Запущено создание ${numPrograms} выпуск(ов) "${programType.name}" на ${dateStr}. Скрипты и аудио генерируются в фоне. Через пару минут всё будет готово. Проверь статус через get_programs_status.`,
        programType: programType.name,
        count: numPrograms,
        date: dateStr,
        status: "processing",
      });

      (async () => {
        for (let i = 0; i < numPrograms; i++) {
          try {
            const targetDate = new Date(dateStr);
            targetDate.setDate(targetDate.getDate() + Math.floor(i / (programType.dailyCount || 1)));
            const targetDateStr = targetDate.toISOString().split("T")[0];

            console.log(`[voice-agent] Creating program ${i + 1}/${numPrograms} for "${programType.name}" on ${targetDateStr}`);
            const createRes = await internalFetch(`/api/programs/auto-create/${programType.id}`, "POST", { date: targetDateStr });

            if (!createRes.ok) {
              const err = await createRes.json().catch(() => ({}));
              console.error(`[voice-agent] Script error: ${(err as any).error}`);
              continue;
            }

            const program = await createRes.json();
            console.log(`[voice-agent] Script created: "${program.title}"`);

            console.log(`[voice-agent] Generating audio for "${program.title}"...`);
            const audioRes = await internalFetch(`/api/programs/${program.id}/generate-audio`, "POST");
            if (audioRes.ok) {
              console.log(`[voice-agent] Audio done for "${program.title}"`);
            } else {
              const err = await audioRes.json().catch(() => ({}));
              console.error(`[voice-agent] Audio error: ${(err as any).error}`);
            }
          } catch (e: any) {
            console.error(`[voice-agent] Pipeline error ${i + 1}:`, e.message);
          }
        }
        console.log(`[voice-agent] Pipeline complete for "${programType.name}": ${numPrograms} programs`);
      })();
    } catch (error) {
      console.error("Voice agent full-pipeline error:", error);
      res.status(500).json({ error: "Не удалось выполнить пайплайн" });
    }
  });

  app.get("/api/voice-agent/programs-status", requireAgentKey, async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const types = await storage.getProgramTypes();
      const activeTypes = types.filter(t => t.isActive);

      const results: any[] = [];
      for (const type of activeTypes) {
        const programs = await storage.getProgramsByType(type.id);
        const datePrograms = programs.filter(p => p.scheduledDate === date);
        if (datePrograms.length > 0) {
          results.push({
            programType: type.name,
            count: datePrograms.length,
            withScript: datePrograms.filter(p => p.scriptText).length,
            withAudio: datePrograms.filter(p => p.audioUrl).length,
            programs: datePrograms.map(p => ({
              id: p.id,
              title: p.title,
              status: p.status,
              hasAudio: !!p.audioUrl,
            })),
          });
        }
      }

      const total = results.reduce((sum, r) => sum + r.count, 0);
      const withScript = results.reduce((sum, r) => sum + r.withScript, 0);
      const withAudio = results.reduce((sum, r) => sum + r.withAudio, 0);

      res.json({
        date,
        summary: `На ${date}: всего ${total} программ. Со скриптами: ${withScript}. С аудио: ${withAudio}. Передачи: ${results.map(r => `${r.programType} (${r.count})`).join(", ")}.`,
        total,
        withScript,
        withAudio,
        details: results,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get programs status" });
    }
  });

  app.post("/api/voice-agent/search-web", requireAgentKey, async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }

      const fcApiKey = process.env.FIRECRAWL_API_KEY;
      if (!fcApiKey) {
        return res.status(500).json({ error: "Firecrawl not configured" });
      }

      const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${fcApiKey}`,
        },
        body: JSON.stringify({ query, limit: 3 }),
      });

      if (!fcRes.ok) {
        return res.status(500).json({ error: "Search failed" });
      }

      const data = await fcRes.json() as any;
      const results = (data.data || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: (r.markdown || "").substring(0, 500),
      }));

      res.json({
        query,
        results,
        summary: `Found ${results.length} results for "${query}".`,
      });
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/voice-agent/research-topics", requireAgentKey, async (req, res) => {
    try {
      const { programTypeName } = req.body;
      if (!programTypeName) {
        return res.status(400).json({ error: "programTypeName is required" });
      }

      const types = await storage.getProgramTypes();
      const programType = types.find(t =>
        t.isActive && t.name.toLowerCase().includes(programTypeName.toLowerCase())
      );
      if (!programType) {
        return res.status(404).json({ error: `Show "${programTypeName}" not found` });
      }

      const fcApiKey = process.env.FIRECRAWL_API_KEY;
      if (!fcApiKey) {
        return res.json({
          programType: programType.name,
          topics: programType.firecrawlTopics || [],
          results: [],
          summary: `Firecrawl is not configured. The show "${programType.name}" has these configured topics: ${(programType.firecrawlTopics || []).join(", ")}`,
        });
      }

      const baseTopics = programType.firecrawlTopics && programType.firecrawlTopics.length > 0
        ? programType.firecrawlTopics
        : [programType.description || programType.name];

      const today = new Date().toISOString().split("T")[0];
      const searchTopics = baseTopics.map(t => `${t} latest news ${today}`);

      const allResults: any[] = [];

      for (const topic of searchTopics.slice(0, 3)) {
        try {
          const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${fcApiKey}`,
            },
            body: JSON.stringify({
              query: topic,
              limit: 5,
            }),
          });

          if (fcRes.ok) {
            const data = await fcRes.json() as any;
            const results = (data.data || [])
              .filter((r: any) => {
                const url = (r.url || "").toLowerCase();
                return !url.match(/\.(com|org|net|gov)\/?$/) && !url.endsWith("/news") && !url.endsWith("/events");
              })
              .map((r: any) => {
                const markdown = r.markdown || "";
                const firstParagraphs = markdown
                  .split("\n")
                  .filter((line: string) => line.trim().length > 30 && !line.startsWith("#") && !line.startsWith("["))
                  .slice(0, 3)
                  .join(" ")
                  .substring(0, 400);

                return {
                  title: r.title || "",
                  url: r.url || "",
                  snippet: firstParagraphs || markdown.substring(0, 400),
                  searchTopic: topic,
                };
              });
            allResults.push(...results);
          }
        } catch {}
      }

      const existingPrograms = await storage.getProgramsByType(programType.id);
      const existingTitles = existingPrograms
        .filter(p => p.scriptText)
        .slice(-10)
        .map(p => p.title);

      const topicSummaries = allResults.map((r, i) => {
        const shortSnippet = r.snippet.substring(0, 100);
        return `${i + 1}. ${r.title}${shortSnippet ? ` — ${shortSnippet}...` : ""}`;
      }).join("\n");

      res.json({
        programType: programType.name,
        description: programType.description,
        configuredTopics: programType.firecrawlTopics || [],
        freshTopics: allResults.map(r => ({ title: r.title, snippet: r.snippet, source: r.url })),
        recentEpisodes: existingTitles,
        summary: `Fresh topics for "${programType.name}":\n\n${topicSummaries}\n\nRecent episodes: ${existingTitles.length > 0 ? existingTitles.join(", ") : "none yet"}.\n\nPick a topic or say "create automatically" to generate an episode!`,
      });
    } catch (error) {
      console.error("Voice agent research-topics error:", error);
      res.status(500).json({ error: "Failed to research topics" });
    }
  });

  app.post("/api/voice-agent/get-knowledge", requireAgentKey, async (req, res) => {
    try {
      const { topic } = req.body;

      const knowledgeBase: Record<string, string> = {
        setup: `## Начальная настройка RadioFlow AI

1. Перейди в Настройки (иконка шестерёнки в боковом меню)
2. Заполни название станции и описание
3. Введи API-ключ Anthropic (Claude AI) — получить на console.anthropic.com
4. Введи API-ключ ElevenLabs — получить на elevenlabs.io/app/settings
5. Опционально: добавь токен Яндекс Диска для облачного хранения аудио
6. Нажми "Сохранить"

После этого можно добавлять голоса и создавать передачи.`,

        voices: `## Управление голосами

1. Перейди в раздел "Голоса" в боковом меню
2. Нажми "Добавить голос"
3. Введи:
   - Voice ID от ElevenLabs (найти в Library или My Voices на elevenlabs.io)
   - Имя персоны (как ведущего будут звать в скриптах, например "Максим" или "Sarah")
   - Пол голоса
4. Нажми "Превью" чтобы проверить голос
5. Отметь голос как активный

Голоса назначаются на передачи. Если у передачи 2+ голоса — скрипты генерируются в формате диалога между ведущими.`,

        shows: `## Создание и управление передачами (Shows)

1. Перейди в раздел "Передачи" в боковом меню
2. Нажми "Добавить тип программы"
3. Заполни:
   - Название (например "Новости ИИ", "Dallas News")
   - Описание программы
   - Шаблон промпта для AI (что генерировать)
   - Назначь голоса (какие ведущие)
4. Настройки автоматизации:
   - Авто-генерация: включить/выключить
   - Количество в неделю
   - Авто-озвучка: автоматически озвучивать после генерации скрипта
   - Авто-загрузка: автоматически загружать на Яндекс Диск

Firecrawl-интеграция: добавь темы для поиска актуальных новостей из интернета.`,

        generation: `## Генерация контента

### Ручная генерация
1. Перейди в раздел "Генератор" или на страницу передачи
2. Выбери тип программы и дату
3. Нажми "Генерировать" — AI создаст скрипт по промпту
4. Просмотри и отредактируй скрипт при необходимости
5. Нажми кнопку озвучки (иконка динамика) для синтеза аудио
6. Нажми загрузку для отправки на Яндекс Диск

### Автоматическая генерация
- Система проверяет каждый час, каким передачам не хватает выпусков
- Автоматически создаёт скрипты, озвучивает и загружает
- Настраивается в параметрах каждой передачи

### Пакетная генерация
- Можно создать 5-50 выпусков за раз из ссылки (ChatGPT, веб-страница)
- Система парсит контент и распределяет по дням`,

        schedule: `## Система расписания

1. Перейди в "Расписание" в боковом меню
2. Создай шаблон расписания:
   - Название (например "Будни", "Выходные")
   - Дни недели
   - Часы вещания (начало и конец)
   - Слотов в час (плотность)
3. Настрой смены ведущих:
   - Назначь разные голоса на разные временные блоки
4. Праздники: встроен календарь праздников Турции и России
   - Можно добавлять свои праздники

Система рассчитывает какие голоса играют в какое время.`,

        ads: `## Реклама (Ads)

1. Перейди в раздел "Реклама" в боковом меню
2. Нажми "Создать рекламу"
3. Заполни:
   - Название рекламодателя
   - Описание продукта/услуги
   - Загрузи материалы (документы, изображения, аудио)
4. AI создаст несколько вариантов рекламного скрипта
5. Выбери лучший вариант и озвучь
6. Можно добавить фоновую музыку`,

        troubleshooting: `## Решение проблем

### Скрипты не генерируются
- Проверь API-ключ Anthropic в Настройках — он должен быть действительным
- Если Claude не работает — система автоматически переключится на OpenAI

### Озвучка не работает
- Проверь API-ключ ElevenLabs в Настройках
- Проверь что Voice ID голосов правильные (скопировать из elevenlabs.io)
- Проверь что у передачи назначены активные голоса

### Загрузка на Яндекс Диск не работает
- Проверь токен Яндекс Диска в Настройках
- Токен может истечь — нужно обновить

### Расписание пустое
- Проверь что шаблоны расписания настроены для нужных дней недели

### Многоголосый формат не работает
- У передачи должно быть назначено 2 или больше голосов
- Каждый голос должен иметь заполненное имя персоны`,

        voiceagent: `## Голосовой ассистент (Voice Agent)

Виджет в правом нижнем углу экрана — нажми на иконку микрофона.

Что умеет:
- Показать список передач: "Какие передачи есть?"
- Узнать статус: "Сколько выпусков готово?"
- Создать выпуски: "Создай 3 выпуска Новостей ИИ"
- Исследовать темы: "Что нового для Психофф?"
- Озвучить скрипты: "Озвучь готовые скрипты Дайджеста"
- Поиск в интернете: "Найди новости про Tesla"

Работает голосом — просто говори что нужно сделать!`,
      };

      if (topic && knowledgeBase[topic.toLowerCase()]) {
        return res.json({
          topic,
          content: knowledgeBase[topic.toLowerCase()],
          availableTopics: Object.keys(knowledgeBase),
        });
      }

      const allContent = Object.entries(knowledgeBase)
        .map(([key, val]) => val)
        .join("\n\n---\n\n");

      res.json({
        topic: topic || "all",
        content: topic
          ? `Topic "${topic}" not found. Available topics: ${Object.keys(knowledgeBase).join(", ")}. Ask about any of these or say "all" for complete guide.`
          : allContent,
        availableTopics: Object.keys(knowledgeBase),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get knowledge" });
    }
  });
}
