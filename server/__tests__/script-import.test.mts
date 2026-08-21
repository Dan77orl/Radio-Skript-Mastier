// Parsing of client-approved ready scripts — no database needed.
//   node server/__tests__/script-import.test.mts [путь к извлечённому тексту]
const { parseImportedScripts } = await import("../script-import.ts");
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

// Shape mirrors the real client document ("Ваши метры", 30 выпусков).
const doc = `RuWave 94.0 FM
Программа «Ваши метры» от компании «Купол»
Тексты 30 выпусков · сетка сентября

Выпуск 1 · 1 сентября
«Сколько реально приносит квадратный метр»
[Джингл]: короткая отбивка программы
Ведущая: В эфире «Ваши метры». Здравствуйте!
Ведущая: Правильная формула: доход минус расходы.
Ведущая: Роль первая: заселение. Это не имя спикера.
[Ролик]: рекламный ролик «Купол», до 30 секунд

Выпуск 2 · 2 сентября · пятница
«Владелец в Москве»
[Джингл]: короткая отбивка программы
Ведущая: Типичная история.
Ведущая: Первое, что нужно понять.
[Ролик]: рекламный ролик
`;

const eps = parseImportedScripts(doc);
check("найдено 2 выпуска", eps.length === 2, String(eps.length));
check("преамбула документа отброшена", !eps[0]?.scriptText.includes("RuWave"), "");
check("номера из заголовков", eps[0]?.number === 1 && eps[1]?.number === 2);
check("заголовок без кавычек", eps[0]?.title === "Сколько реально приносит квадратный метр", eps[0]?.title);
check("джингл вырезан", !eps[0]?.scriptText.includes("Джингл"));
check("ролик вырезан", !eps[0]?.scriptText.includes("Ролик"));
check("Ведущая → [Ведущая]:", eps[0]?.scriptText.startsWith("[Ведущая]: В эфире"), eps[0]?.scriptText.slice(0, 40));
check("реплики сохранены", (eps[0]?.scriptText.match(/^\[Ведущая\]:/gm) || []).length === 3);
check("«Роль первая:» не стала спикером", eps[0]?.scriptText.includes("Роль первая: заселение"), "");
check("слова посчитаны", (eps[0]?.words ?? 0) > 10, String(eps[0]?.words));

// A single dialogue without headers is one episode.
const single = parseImportedScripts("Ведущая: Привет!\nВедущая: Это один текст.");
check("текст без заголовков — один выпуск", single.length === 1, String(single.length));
check("формат нормализован", single[0]?.scriptText.includes("[Ведущая]:"));

// Multi-speaker input that's already in app format stays intact.
const multi = parseImportedScripts("Выпуск 1\nТема\n[Алина]: Привет!\n[Сергей]: И тебе привет!\nВыпуск 2\nДругая тема\n[Алина]: Второй выпуск.\n[Сергей]: Да.");
check("готовый формат [Имя]: не искажается", multi[0]?.scriptText.includes("[Алина]: Привет!"), multi[0]?.scriptText);

// Optional: run against a real extracted file passed as argv.
const file = process.argv[2];
if (file) {
  const { readFileSync } = await import("fs");
  const real = parseImportedScripts(readFileSync(file, "utf-8"));
  console.log(`\nРеальный файл: ${real.length} выпусков`);
  for (const e of real.slice(0, 31)) {
    console.log(`  #${e.number} «${e.title}» — ${e.words} слов`);
  }
  check("в реальном файле 30 выпусков", real.length === 30, String(real.length));
  // #11/#18/#25 — заготовки «Вопросы слушателей», они короткие по замыслу.
  check("все выпуски непустые", real.every(e => e.words > 10));
  check("полновесных выпусков 27", real.filter(e => e.words > 100).length === 27, String(real.filter(e => e.words > 100).length));
  check("нигде не остался джингл/ролик", real.every(e => !/\[(Джингл|Ролик)\]/i.test(e.scriptText)));
}

console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
