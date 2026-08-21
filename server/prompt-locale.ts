const LANG_NAMES: Record<string, string> = {
  ru: "Russian",
  en: "English",
  tr: "Turkish",
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  it: "Italian",
  uk: "Ukrainian",
  pl: "Polish",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  cs: "Czech",
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  el: "Greek",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  ka: "Georgian",
  hy: "Armenian",
  az: "Azerbaijani",
  kk: "Kazakh",
  uz: "Uzbek",
};

export function getLanguageName(lang: string): string {
  return LANG_NAMES[lang] || LANG_NAMES["en"] || "English";
}

export function getLanguageDirective(lang: string): string {
  const langName = getLanguageName(lang);
  if (lang === "ru") {
    return `ЯЗЫК: Весь контент ОБЯЗАТЕЛЬНО на русском языке.`;
  }
  return `LANGUAGE: ALL content MUST be written in ${langName}. Every word of the script, title, transitions, greetings — everything in ${langName}. Do NOT use any other language.`;
}

interface PromptStrings {
  langDirective: string;
  scriptWriter: string;
  aboutStation: (desc: string) => string;
  dialogTask: (male: string, female: string) => string;
  dialogLang: string;
  dialogDuration: string;
  emotionTags: string;
  emotionInstructions: string;
  formatResponse: string;
  minReplicas: (n: number) => string;
  styleLively: string;
  styleSimple: string;
  styleModerate: string;
  male: string;
  female: string;
  host: string;
  hostFemale: string;
  contentAuthor: string;
  activeHosts: (list: string) => string;
  createContentInStyle: string;
  narrativeStyle: string;
  referenceEpisodes: string;
  criticalImportant: (name: string, keywords: string, speakerNames: string[], count: number) => string;
  timeSlot: (desc: string) => string;
  sponsor: (name: string, text?: string) => string;
  dateSlot: (date: string, slot: number, total: number) => string;
  seasonPrefix: string;
  seasonNote: string;
  broadcastContext: (facts: string) => string;
  seasons: Record<string, string>;
  durationStrict: (sec: number, dur: string, min: number, max: number) => string;
  weatherFormatGuard: (maxLines: number) => string;
  scriptTemplateGuard: string;
  factualAccuracy: string;
  topicArea: (name: string, keywords: string) => string;
  multiSpeakerFormat: (speakers: string, names: string[]) => string;
  singleSpeakerFormat: (name: string) => string;
  templateStructure: (template: string) => string;
  referenceFormat: (text: string) => string;
  existingEpisodes: (titles: string) => string;
  narrativeRules: (hasContent: boolean, speakerNames: string[], keywords: string[]) => string;
  topicLine: (example: string) => string;
  stationInstructions: string;
  knowledgeBase: string;
  generationFailed: string;
}

function getRuStrings(): PromptStrings {
  return {
    langDirective: "ЯЗЫК: Весь контент ОБЯЗАТЕЛЬНО на русском языке.",
    scriptWriter: "Ты - сценарист для радио",
    aboutStation: (desc) => `О станции: ${desc}`,
    dialogTask: (male, female) => `Твоя задача - написать короткий диалог между ведущими: ${male} (мужчина) и ${female} (женщина).`,
    dialogLang: "Диалог должен быть дружелюбным и естественным.",
    dialogDuration: "Длительность при чтении - 30-50 секунд.",
    emotionTags: "Доступные теги: [energetic], [fast], [slow], [surprised], [thoughtful], [happy], [sad], [exclaims], [announcer], [serious], [calm], [excited], [warm], [dramatic], [whisper], [loud], [gentle], [playful], [confident]",
    emotionInstructions: `МЕТАТЕГИ ЭМОЦИЙ — расставь в тексте:\nСтавь тег только при заметном изменении настроения или интонации. НЕ чаще чем раз в 2-3 предложения. Не ставь теги подряд.`,
    formatResponse: "ФОРМАТ ОТВЕТА — JSON с чередующимися репликами:",
    minReplicas: (n) => `Минимум ${n} реплик.`,
    styleLively: `СТИЛЬ — ЖИВАЯ СТУДИЯ: Ведущие перебивают, реагируют ("Да ладно!", "Серьёзно?!"), подхватывают мысли, шутят. Каждая реплика 1-3 предложения.`,
    styleSimple: `СТИЛЬ — ПРОСТОЙ: Один говорит, другой отвечает. Каждая реплика 2-4 предложения.`,
    styleModerate: `СТИЛЬ — УМЕРЕННЫЙ: Лёгкая дискуссия, иногда реагируют друг на друга. Каждая реплика 1-3 предложения.`,
    male: "мужчина",
    female: "женщина",
    host: "ведущий",
    hostFemale: "ведущая",
    contentAuthor: "Ты - автор контента для радио",
    activeHosts: (list) => `Активные ведущие: ${list}.`,
    createContentInStyle: "Создавай контент в стиле радиостанции.",
    narrativeStyle: "Твой стиль — живое повествование, как рассказ друга: плавные переходы между мыслями, логические связки, путеводная нить через весь выпуск. Никогда не перечисляй факты тезисами.",
    referenceEpisodes: "ЭТАЛОННЫЕ ВЫПУСКИ ИЗ ССЫЛКИ — изучи стиль, тон, тематику:",
    criticalImportant: (name, keywords, speakerNames, count) =>
      `КРИТИЧЕСКИ ВАЖНО:
- Текст выше — это ЭТАЛОННЫЕ ВЫПУСКИ передачи "${name}". Создай НОВЫЙ выпуск ТОЧНО В ТАКОМ ЖЕ стиле и тематической области
- Тематика: оставайся В ТОЙ ЖЕ ПРЕДМЕТНОЙ ОБЛАСТИ (${keywords || "как в эталонах выше"})
- Выбери НОВЫЙ конкретный аспект/угол внутри этой предметной области
- Ведущий(ая): ${speakerNames.join(", ")}. Используй ТОЧНО ${count === 1 ? "это имя" : "эти имена"} ведущих
- Сохраняй структуру: приветствие, основная часть, заключение — как в эталонах
- Без markdown-разметки, без звёздочек
- ОБЯЗАТЕЛЬНО оформи вывод в формате [Имя]: [тег] текст (см. инструкции формата ниже), даже если в эталонах формат другой`,
    timeSlot: (desc) => `Временной слот: ${desc}`,
    sponsor: (name, text) => `Спонсор передачи: ${name}${text ? `. ${text}` : ""}`,
    dateSlot: (date, slot, total) => `Дата: ${date}, выпуск #${slot} из ${total}`,
    seasonPrefix: "Сезон:",
    seasonNote: "Учитывай текущий сезон при создании контента — темы, настроение и советы должны соответствовать времени года.",
    broadcastContext: (facts) =>
      `ЭФИРНЫЙ КОНТЕКСТ ДНЯ — РЕАЛЬНЫЕ ДАННЫЕ НА МОМЕНТ ВЫХОДА:
${facts}

КАК ЭТИМ ПОЛЬЗОВАТЬСЯ:
- Ведущие находятся ВНУТРИ этого дня, а не в вакууме. Они видят погоду за окном, знают, какой сегодня день и что происходит вокруг.
- Вплетай это в живую речь как повод и как реакцию: «на улице пекло, сорок в тени», «сегодня как раз День знаний», «слышал новость про...». Никаких зачитанных списков.
- Достаточно ОДНОЙ-ДВУХ привязок к реальности за выпуск. Это фон и повод для разговора, а не содержание передачи — тема выпуска остаётся главной.
- Если факт не ложится в тему передачи — молча пропусти его. Натянутая привязка хуже её отсутствия.
- Числа (температуру, даты, названия) бери ТОЛЬКО отсюда. Своих не выдумывай.
- Не начинай каждый выпуск с погоды — это признак шаблонного эфира.`,
    seasons: {
      winter: "Зима (декабрь-февраль). Мягкая зима, короткие дни. Период праздников и уютной атмосферы.",
      spring: "Весна (март-май). Потепление, цветение, начало активного сезона. Период обновления и новых начинаний.",
      summer: "Лето (июнь-август). Тёплая погода, пик активности, фестивали и отпуска. Летнее настроение.",
      autumn: "Осень (сентябрь-ноябрь). Прохлада, золотые листья, уютный сезон. Время подводить итоги.",
    },
    durationStrict: (sec, dur, min, max) =>
      `ХРОНОМЕТРАЖ — ЖЁСТКИЙ ВЕРХНИЙ ПРЕДЕЛ:
- Целевая длительность чтения вслух: ${sec} секунд (~${dur} мин), скорость ~150 слов/мин.
- АБСОЛЮТНЫЙ МАКСИМУМ: ${max} слов во всём сценарии (считаются только слова текста, без тегов [имя]: и [тон]).
- Можно короче — это нормально и поощряется. Длиннее ${max} слов — НЕЛЬЗЯ ни при каких условиях.
- Не растягивай текст, чтобы «заполнить» длительность. Лучше меньше слов, чем вода.
- Если ${sec} секунд — это коротко, выбери ОДНУ тему/мысль и не пытайся охватить всё.`,
    weatherFormatGuard: (maxLines) =>
      `РАМКИ ФОРМАТА «ПРОГНОЗ ПОГОДЫ» — ОБЯЗАТЕЛЬНО:
- Это короткий дата-дайджест, а НЕ повествовательный сценарий.
- ЗАПРЕЩЕНО любое вступление-приветствие: «Доброе утро», «Привет, Аланья», «С вами …», «Сегодня поговорим…» и т.п. Сразу к фактам.
- Используй ТОЛЬКО числа из подставленного блока «РЕАЛЬНЫЕ ДАННЫЕ ПРОГНОЗА ПОГОДЫ» выше. Не выдумывай свои значения.
- ЗАПРЕЩЕНО ссылаться на сторонние источники погоды: AccuWeather, Gismeteo, Яндекс.Погода, Weather.com, "по данным синоптиков" и т.п. Подаём данные как собственный прогноз.
- Каждый факт — отдельной короткой строкой (1 короткое предложение). Не объединяй несколько фактов в один абзац, не разводи воду и не добавляй «жизненных наблюдений».
- Не больше ${maxLines} строк всего, если пользователь явно не попросил другое количество.
- Сохраняй формат [Имя]: [тон] [настроение] текст на каждой строке.
- Финальную брендовую строку (если она есть в инструкциях пользователя) воспроизведи дословно.`,
    scriptTemplateGuard:
      `ПРОМПТ ПОЛЬЗОВАТЕЛЯ — ЭТО ГОТОВЫЙ СЦЕНАРИЙ:
- В промпте уже есть строки в формате [Имя]: ... Это и есть финальный сценарий, а не «пример» или «вдохновение».
- Твоя задача — ВОСПРОИЗВЕСТИ ТУ ЖЕ структуру: те же ведущие, тот же порядок реплик, то же количество строк, тот же тон.
- Подставь актуальные конкретные данные (температуру, ветер, осадки, температуру воды, UV-индекс, дату, день недели и т.п.) из блоков фактов выше, если они есть. Если данных нет — оставь формулировку пользователя как есть.
- ЗАПРЕЩЕНО: добавлять свои реплики, новых ведущих, вступления, прощания, «подводки», «жизненные наблюдения», эпитеты сверх тех, что уже есть в шаблоне.
- ЗАПРЕЩЕНО: менять длину сценария, удлинять или сокращать его «для красоты».
- Финальную брендовую строку из шаблона воспроизведи слово в слово.
- Если в шаблоне есть теги [тон] [настроение] — сохрани их или подбери эквивалентные к содержанию.
- Верни ТОЛЬКО готовый сценарий, без пояснений до или после.`,
    factualAccuracy:
      `ФАКТИЧЕСКАЯ ТОЧНОСТЬ — СТРОГО ОБЯЗАТЕЛЬНО:
- НЕ ВЫДУМЫВАЙ проверяемые факты: географию (где находится место, в какой оно стороне — север/юг/восток/запад, расстояния, маршрут, как добраться), названия достопримечательностей, пляжей, рек, гор, водопадов, отелей, улиц, исторические даты и события, имена людей, цены и статистику.
- Утверждай конкретный факт ТОЛЬКО если он есть в блоках «ДАННЫЕ ИЗ ИНТЕРНЕТА» или в базе знаний станции выше. Нет в источниках — не называй его.
- ОСОБЕННО про географию и направления: НИКОГДА не указывай сторону света, расстояние или направление «по памяти» или «на глаз». Если точно не знаешь, где объект находится относительно Алании — вообще не называй сторону и расстояние.
- Если конкретных данных нет — говори общими словами и эмоциями («очень красивое место», «стоит съездить», «там приятно прогуляться»), но БЕЗ выдуманных конкретных названий, цифр и фактов.
- Лучше сказать меньше, но точно, чем добавить красивую, но недостоверную деталь.
- Не выдавай догадку за факт.`,
    topicArea: (name, keywords) => `Тематика передачи "${name}": ${keywords}. Создавай контент СТРОГО в рамках этой тематики.`,
    multiSpeakerFormat: (speakers, names) =>
      `ОБЯЗАТЕЛЬНЫЙ ФОРМАТ ВЫВОДА: мульти-спикерный скрипт. Спикеры: ${speakers}
Каждая реплика ОБЯЗАТЕЛЬНО начинается с [Имя]: и содержит теги эмоций.
${getRuStrings().emotionTags}
Пример:
[${names[0]}]: [energetic] [fast] Текст...
[${names[1] || names[0]}]: [announcer] ЗАГОЛОВОК`,
    singleSpeakerFormat: (name) =>
      `ОБЯЗАТЕЛЬНЫЙ ФОРМАТ ВЫВОДА: скрипт с ведущим. Ведущий(ая): ${name}
КАЖДЫЙ абзац/блок текста ОБЯЗАТЕЛЬНО начинается с [${name}]: и содержит теги эмоций в квадратных скобках.
${getRuStrings().emotionTags}
Пример:
[${name}]: [energetic] [warm] Привет! Текст ведущего...
[${name}]: [thoughtful] Следующий блок текста...
НЕ пиши текст без префикса [${name}]:! Каждый блок должен начинаться с имени ведущего.`,
    templateStructure: (template) => `СТРУКТУРА СЦЕНАРИЯ — СТРОГО СЛЕДУЙ ЭТОМУ ШАБЛОНУ:\n${template}\nВАЖНО: Распределяй текст между спикерами ТОЧНО по этой структуре. Каждый спикер выполняет ТОЛЬКО свою роль, указанную выше.`,
    referenceFormat: (text) => `ОБРАЗЕЦ ФОРМАТА (копируй формат и стиль, но выбери новый аспект в рамках тематики передачи):\n---\n${text}\n---`,
    existingEpisodes: (titles) => `УЖЕ СОЗДАННЫЕ ВЫПУСКИ (НЕ повторяй эти конкретные темы!):\n${titles}`,
    narrativeRules: (hasContent, speakerNames, keywords) =>
      `СТИЛЬ ПОВЕСТВОВАНИЯ — ОБЯЗАТЕЛЬНО:
- Пиши как РАССКАЗ, а НЕ как список фактов. Каждый выпуск — это история с началом, развитием и концом
- Между блоками/темами используй ПЛАВНЫЕ ПЕРЕХОДЫ
- Веди слушателя ПУТЕВОДНОЙ НИТЬЮ — от одной мысли к другой логично, как в разговоре с другом
- ЗАПРЕЩЕНО: перечислять факты тезисами один за другим без связи. Каждый факт должен вытекать из предыдущего
- Добавляй ЖИВЫЕ ДЕТАЛИ: личные наблюдения ведущего, примеры из жизни, мини-истории
- Завершай выпуск так, чтобы слушатель унёс одну главную мысль

СТРОГИЕ ПРАВИЛА:
- Выбери НОВЫЙ аспект/угол${hasContent ? " в рамках той же предметной области" : ""}, которого НЕТ в списке выше
- НЕ выдумывай названия институтов, университетов и исследований
- Если есть данные из интернета — ВПЛЕТАЙ конкретные факты и цифры в повествование естественно, как часть истории
- Если нет данных из интернета — говори общими словами и из личных впечатлений ведущего, но НЕ выдумывай конкретные факты: названия, географию, стороны света, расстояния, даты, цифры, исследования и статистику
- НЕ повторяй темы, которые уже были в списке выше
- Ведущий(ая): ${speakerNames.join(", ")}`,
    topicLine: (example) => `В САМОЙ ПЕРВОЙ СТРОКЕ ответа напиши ТЕМА: и краткое название темы выпуска (2-5 слов). Например:\nТЕМА: ${example}\nПосле этого начинай сценарий.`,
    stationInstructions: "ОБЩИЕ ИНСТРУКЦИИ СТАНЦИИ (ВСЕГДА СОБЛЮДАЙ):",
    knowledgeBase: "БАЗА ЗНАНИЙ СТАНЦИИ:",
    generationFailed: "Не удалось сгенерировать скрипт. Слот не занят, попробуйте снова.",
  };
}

function getEnStrings(): PromptStrings {
  return {
    langDirective: "LANGUAGE: ALL content MUST be written in English.",
    scriptWriter: "You are a scriptwriter for the radio station",
    aboutStation: (desc) => `About the station: ${desc}`,
    dialogTask: (male, female) => `Your task is to write a short dialog between hosts: ${male} (male) and ${female} (female).`,
    dialogLang: "The dialog should be friendly and natural.",
    dialogDuration: "Duration when read aloud: 30-50 seconds.",
    emotionTags: "Available tags: [energetic], [fast], [slow], [surprised], [thoughtful], [happy], [sad], [exclaims], [announcer], [serious], [calm], [excited], [warm], [dramatic], [whisper], [loud], [gentle], [playful], [confident]",
    emotionInstructions: `EMOTION META-TAGS — place in the text:\nAdd a tag only when there is a noticeable change in mood or intonation. NO more than once every 2-3 sentences. Do not place tags consecutively.`,
    formatResponse: "RESPONSE FORMAT — JSON with alternating lines:",
    minReplicas: (n) => `Minimum ${n} lines.`,
    styleLively: `STYLE — LIVELY STUDIO: Hosts interrupt, react ("No way!", "Seriously?!"), build on ideas, joke. Each line is 1-3 sentences.`,
    styleSimple: `STYLE — SIMPLE: One speaks, the other responds. Each line is 2-4 sentences.`,
    styleModerate: `STYLE — MODERATE: Light discussion, occasional reactions to each other. Each line is 1-3 sentences.`,
    male: "male",
    female: "female",
    host: "host",
    hostFemale: "host",
    contentAuthor: "You are a content creator for the radio station",
    activeHosts: (list) => `Active hosts: ${list}.`,
    createContentInStyle: "Create content in the radio station's style.",
    narrativeStyle: "Your style is vivid storytelling, like chatting with a friend: smooth transitions between ideas, logical connections, a guiding thread throughout the episode. Never list facts as bullet points.",
    referenceEpisodes: "REFERENCE EPISODES FROM THE LINK — study the style, tone, theme:",
    criticalImportant: (name, keywords, speakerNames, count) =>
      `CRITICALLY IMPORTANT:
- The text above contains REFERENCE EPISODES of the show "${name}". Create a NEW episode in EXACTLY THE SAME style and topic area
- Topic: stay WITHIN THE SAME SUBJECT AREA (${keywords || "as in the references above"})
- Choose a NEW specific angle within this subject area
- Host(s): ${speakerNames.join(", ")}. Use EXACTLY ${count === 1 ? "this name" : "these names"} for the hosts
- Keep the structure: greeting, main part, conclusion — as in the references
- No markdown formatting, no asterisks
- MUST format output as [Name]: [tag] text (see format instructions below), even if references use a different format`,
    timeSlot: (desc) => `Time slot: ${desc}`,
    sponsor: (name, text) => `Show sponsor: ${name}${text ? `. ${text}` : ""}`,
    dateSlot: (date, slot, total) => `Date: ${date}, episode #${slot} of ${total}`,
    seasonPrefix: "Season:",
    seasonNote: "Consider the current season when creating content — topics, mood, and advice should match the time of year.",
    broadcastContext: (facts) =>
      `ON-AIR CONTEXT FOR TODAY — REAL DATA AS OF BROADCAST:
${facts}

HOW TO USE THIS:
- The hosts are INSIDE this day, not in a vacuum. They can see the weather outside, they know what day it is and what is going on around them.
- Weave it into natural speech as a prompt and a reaction: "it's baking out there, forty in the shade", "today happens to be...", "I saw the news about...". Never read it out as a list.
- ONE OR TWO touchpoints with reality per episode is enough. This is background and conversational fuel, not the subject — the episode's own topic stays in charge.
- If a fact does not fit the show's topic, silently skip it. A forced connection is worse than none.
- Take numbers (temperatures, dates, names) ONLY from here. Do not invent your own.
- Do not open every episode with the weather — that is the mark of a formulaic station.`,
    seasons: {
      winter: "Winter (December-February). Short days, cozy atmosphere. Holiday season and winter activities.",
      spring: "Spring (March-May). Warming up, blossoming, fresh starts. A season of renewal and new beginnings.",
      summer: "Summer (June-August). Warm weather, peak activity, festivals and vacations. Summer vibes.",
      autumn: "Autumn (September-November). Cooling down, golden leaves, cozy season. Time to reflect and wrap up.",
    },
    durationStrict: (sec, dur, min, max) =>
      `DURATION — HARD UPPER LIMIT:
- Target reading duration: ${sec} seconds (~${dur} min) at ~150 words/min.
- ABSOLUTE MAXIMUM: ${max} words in the entire script (count only spoken words, not [name]: or [tag] markers).
- Shorter is fine and encouraged. Longer than ${max} words is NOT allowed under any circumstances.
- Do NOT pad the text to "fill" the duration. Fewer words is better than filler.
- If ${sec} seconds is short, pick ONE topic/idea and don't try to cover everything.`,
    weatherFormatGuard: (maxLines) =>
      `WEATHER FORECAST FORMAT RULES — MANDATORY:
- This is a short data digest, NOT a narrative script.
- NO greeting/intro lines: "Good morning", "Hello Alanya", "With you is...", "Today we will talk about..." etc. Start straight with the facts.
- Use ONLY the numbers from the "REAL WEATHER FORECAST DATA" block above. Do not invent your own values.
- DO NOT cite third-party weather sources: AccuWeather, Gismeteo, Yandex.Weather, Weather.com, "according to forecasters" etc. Present the data as our own forecast.
- One fact per short line (a single short sentence). Do not merge facts into paragraphs, do not add "life observations" or filler.
- No more than ${maxLines} lines total, unless the user explicitly asked for a different count.
- Keep the format [Name]: [tone] [mood] text on every line.
- Reproduce the final branded line verbatim if the user's instructions contain one.`,
    scriptTemplateGuard:
      `USER PROMPT IS THE FINAL SCRIPT TEMPLATE:
- The prompt already contains [Name]: lines. That IS the final script, not an "example" or "inspiration".
- Your job: REPRODUCE THE SAME structure — same hosts, same order of lines, same number of lines, same tone.
- Substitute concrete current data (temperature, wind, precipitation, water temperature, UV index, date, day of week, etc.) from the fact blocks above, where the template has placeholders. If no data is available, keep the user's wording as-is.
- DO NOT: add your own lines, new hosts, intros, outros, lead-ins, "life observations", or epithets beyond what is already in the template.
- DO NOT: change the script length, expand or shorten it "for style".
- Reproduce any final branded line from the template verbatim.
- If the template uses [tone] [mood] tags, keep them or pick equivalents matching the content.
- Return ONLY the finished script, with no commentary before or after.`,
    factualAccuracy:
      `FACTUAL ACCURACY — STRICTLY REQUIRED:
- DO NOT invent verifiable facts: geography (where a place is, which direction — north/south/east/west, distances, routes, how to get there), names of attractions, beaches, rivers, mountains, waterfalls, hotels, streets, historical dates and events, people's names, prices, and statistics.
- State a concrete fact ONLY if it appears in the "DATA FROM THE INTERNET" blocks or the station knowledge base above. If it is not in the sources, do not state it.
- ESPECIALLY for geography and directions: NEVER state a compass direction, distance, or route "from memory" or by guessing. If you do not know exactly where an object is relative to Alanya, do not state a direction or distance at all.
- If there is no concrete data, speak in general terms and emotions ("a beautiful place", "worth a visit", "lovely for a walk"), but WITHOUT invented specific names, numbers, or facts.
- Better to say less but accurately than to add a nice but false detail.
- Do not present a guess as a fact.`,
    topicArea: (name, keywords) => `Show topic area "${name}": ${keywords}. Create content STRICTLY within this topic area.`,
    multiSpeakerFormat: (speakers, names) =>
      `REQUIRED OUTPUT FORMAT: multi-speaker script. Speakers: ${speakers}
Each line MUST start with [Name]: and contain emotion tags.
${getEnStrings().emotionTags}
Example:
[${names[0]}]: [energetic] [fast] Text...
[${names[1] || names[0]}]: [announcer] HEADLINE`,
    singleSpeakerFormat: (name) =>
      `REQUIRED OUTPUT FORMAT: script with host. Host: ${name}
EVERY paragraph/block MUST start with [${name}]: and contain emotion tags in square brackets.
${getEnStrings().emotionTags}
Example:
[${name}]: [energetic] [warm] Hello! Host text...
[${name}]: [thoughtful] Next text block...
DO NOT write text without the [${name}]: prefix! Every block must start with the host name.`,
    templateStructure: (template) => `SCRIPT STRUCTURE — STRICTLY FOLLOW THIS TEMPLATE:\n${template}\nIMPORTANT: Distribute text between speakers EXACTLY according to this structure. Each speaker performs ONLY their role as specified above.`,
    referenceFormat: (text) => `FORMAT REFERENCE (copy the format and style, but choose a new angle within the show's topic area):\n---\n${text}\n---`,
    existingEpisodes: (titles) => `ALREADY CREATED EPISODES (DO NOT repeat these specific topics!):\n${titles}`,
    narrativeRules: (hasContent, speakerNames, keywords) =>
      `NARRATIVE STYLE — REQUIRED:
- Write as a STORY, NOT a list of facts. Each episode is a story with beginning, middle, and end
- Use SMOOTH TRANSITIONS between blocks/topics
- Guide the listener with a NARRATIVE THREAD — from one idea to the next logically, like chatting with a friend
- FORBIDDEN: listing facts as bullet points without connections. Each fact should flow from the previous one
- Add VIVID DETAILS: host's personal observations, real-life examples, mini-stories
- End the episode so the listener takes away one key message

STRICT RULES:
- Choose a NEW angle${hasContent ? " within the same subject area" : ""} that is NOT in the list above
- DO NOT invent names of institutes, universities, or research studies
- If there's web data — WEAVE specific facts and figures into the narrative naturally, as part of the story
- If there's no web data — speak in general terms and the host's personal impressions, but DO NOT invent concrete facts: names, geography, compass directions, distances, dates, figures, research, or statistics
- DO NOT repeat topics that were already in the list above
- Host(s): ${speakerNames.join(", ")}`,
    topicLine: (example) => `In the VERY FIRST LINE of your response, write TOPIC: followed by a short episode topic name (2-5 words). For example:\nTOPIC: ${example}\nThen start the script.`,
    stationInstructions: "STATION-WIDE INSTRUCTIONS (ALWAYS FOLLOW):",
    knowledgeBase: "STATION KNOWLEDGE BASE:",
    generationFailed: "Failed to generate script. Slot not taken, please try again.",
  };
}

function getTrStrings(): PromptStrings {
  return {
    ...getEnStrings(),
    langDirective: "DİL: Tüm içerik MUTLAKA Türkçe olmalıdır.",
    scriptWriter: "Radyo istasyonu için senaryo yazarısınız",
    aboutStation: (desc) => `İstasyon hakkında: ${desc}`,
    dialogTask: (male, female) => `Göreviniz sunucular arasında kısa bir diyalog yazmak: ${male} (erkek) ve ${female} (kadın).`,
    dialogLang: "Diyalog samimi ve doğal olmalıdır.",
    dialogDuration: "Sesli okunduğunda süre: 30-50 saniye.",
    male: "erkek",
    female: "kadın",
    host: "sunucu",
    hostFemale: "sunucu",
    contentAuthor: "Radyo istasyonu için içerik üreticisisiniz",
    generationFailed: "Senaryo oluşturulamadı. Slot boş, tekrar deneyin.",
  };
}

export function getPromptStrings(lang: string): PromptStrings {
  switch (lang) {
    case "ru": return getRuStrings();
    case "tr": return getTrStrings();
    default: return getEnStrings();
  }
}

export function getGenderLabel(gender: string, lang: string): string {
  const s = getPromptStrings(lang);
  return gender === "male" ? s.male : s.female;
}

export function getDefaultHostName(gender: string, lang: string): string {
  const s = getPromptStrings(lang);
  return gender === "male" ? s.host : s.hostFemale;
}
