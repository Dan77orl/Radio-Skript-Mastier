export interface Holiday {
  date: string;
  name: string;
  nameRu: string;
  country: "TR" | "RU" | "BOTH";
  isPublic: boolean;
}

const staticHolidays: Holiday[] = [
  { date: "01-01", name: "New Year", nameRu: "Новый год", country: "BOTH", isPublic: true },
  { date: "01-07", name: "Orthodox Christmas", nameRu: "Рождество (православное)", country: "RU", isPublic: true },
  { date: "01-14", name: "Old New Year", nameRu: "Старый Новый год", country: "RU", isPublic: false },
  { date: "02-14", name: "Valentine's Day", nameRu: "День святого Валентина", country: "BOTH", isPublic: false },
  { date: "02-23", name: "Defender of the Fatherland Day", nameRu: "День защитника Отечества", country: "RU", isPublic: true },
  { date: "03-08", name: "International Women's Day", nameRu: "Международный женский день", country: "BOTH", isPublic: true },
  { date: "04-23", name: "National Sovereignty Day", nameRu: "День национального суверенитета и День детей", country: "TR", isPublic: true },
  { date: "05-01", name: "Labour Day", nameRu: "Праздник труда и солидарности", country: "BOTH", isPublic: true },
  { date: "05-09", name: "Victory Day (Russia)", nameRu: "День Победы", country: "RU", isPublic: true },
  { date: "05-19", name: "Youth and Sports Day", nameRu: "День молодёжи и спорта", country: "TR", isPublic: true },
  { date: "06-01", name: "Children's Day", nameRu: "Международный день защиты детей", country: "RU", isPublic: false },
  { date: "06-12", name: "Russia Day", nameRu: "День России", country: "RU", isPublic: true },
  { date: "07-15", name: "Democracy and National Unity Day", nameRu: "День демократии и национального единства", country: "TR", isPublic: true },
  { date: "08-30", name: "Victory Day (Turkey)", nameRu: "День Победы (Турция)", country: "TR", isPublic: true },
  { date: "10-29", name: "Republic Day", nameRu: "День Республики Турции", country: "TR", isPublic: true },
  { date: "11-04", name: "National Unity Day", nameRu: "День народного единства", country: "RU", isPublic: true },
  { date: "11-10", name: "Atatürk Remembrance Day", nameRu: "День памяти Ататюрка", country: "TR", isPublic: false },
  { date: "12-25", name: "Christmas (European)", nameRu: "Рождество (европейское)", country: "BOTH", isPublic: false },
  { date: "12-31", name: "New Year's Eve", nameRu: "Канун Нового года", country: "BOTH", isPublic: false },
];

const islamicHolidays2025: Holiday[] = [
  { date: "03-30", name: "Ramadan Start", nameRu: "Начало Рамадана", country: "TR", isPublic: false },
  { date: "04-29", name: "Eid al-Fitr", nameRu: "Рамадан-байрам (Шекер-байрам)", country: "TR", isPublic: true },
  { date: "04-30", name: "Eid al-Fitr Day 2", nameRu: "Рамадан-байрам (2-й день)", country: "TR", isPublic: true },
  { date: "05-01", name: "Eid al-Fitr Day 3", nameRu: "Рамадан-байрам (3-й день)", country: "TR", isPublic: true },
  { date: "07-06", name: "Eid al-Adha", nameRu: "Курбан-байрам", country: "TR", isPublic: true },
  { date: "07-07", name: "Eid al-Adha Day 2", nameRu: "Курбан-байрам (2-й день)", country: "TR", isPublic: true },
  { date: "07-08", name: "Eid al-Adha Day 3", nameRu: "Курбан-байрам (3-й день)", country: "TR", isPublic: true },
  { date: "07-09", name: "Eid al-Adha Day 4", nameRu: "Курбан-байрам (4-й день)", country: "TR", isPublic: true },
];

const islamicHolidays2026: Holiday[] = [
  { date: "03-20", name: "Ramadan Start", nameRu: "Начало Рамадана", country: "TR", isPublic: false },
  { date: "04-18", name: "Eid al-Fitr", nameRu: "Рамадан-байрам (Шекер-байрам)", country: "TR", isPublic: true },
  { date: "04-19", name: "Eid al-Fitr Day 2", nameRu: "Рамадан-байрам (2-й день)", country: "TR", isPublic: true },
  { date: "04-20", name: "Eid al-Fitr Day 3", nameRu: "Рамадан-байрам (3-й день)", country: "TR", isPublic: true },
  { date: "06-26", name: "Eid al-Adha", nameRu: "Курбан-байрам", country: "TR", isPublic: true },
  { date: "06-27", name: "Eid al-Adha Day 2", nameRu: "Курбан-байрам (2-й день)", country: "TR", isPublic: true },
  { date: "06-28", name: "Eid al-Adha Day 3", nameRu: "Курбан-байрам (3-й день)", country: "TR", isPublic: true },
  { date: "06-29", name: "Eid al-Adha Day 4", nameRu: "Курбан-байрам (4-й день)", country: "TR", isPublic: true },
];

const islamicHolidaysByYear: Record<number, Holiday[]> = {
  2025: islamicHolidays2025,
  2026: islamicHolidays2026,
};

export function getHolidaysForDate(dateString: string): Holiday[] {
  const date = new Date(dateString);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const key = `${month}-${day}`;
  const year = date.getFullYear();

  const results: Holiday[] = [];

  for (const h of staticHolidays) {
    if (h.date === key) {
      results.push(h);
    }
  }

  const islamicForYear = islamicHolidaysByYear[year];
  if (islamicForYear) {
    for (const h of islamicForYear) {
      if (h.date === key) {
        results.push(h);
      }
    }
  }

  return results;
}

export function getHolidaysForMonth(year: number, month: number): Holiday[] {
  const monthStr = month.toString().padStart(2, "0");
  const results: Holiday[] = [];

  for (const h of staticHolidays) {
    if (h.date.startsWith(monthStr + "-")) {
      results.push({ ...h, date: `${year}-${h.date}` });
    }
  }

  const islamicForYear = islamicHolidaysByYear[year];
  if (islamicForYear) {
    for (const h of islamicForYear) {
      if (h.date.startsWith(monthStr + "-")) {
        results.push({ ...h, date: `${year}-${h.date}` });
      }
    }
  }

  return results;
}

export function getHolidaysForYear(year: number): Holiday[] {
  const results: Holiday[] = [];

  for (const h of staticHolidays) {
    results.push({ ...h, date: `${year}-${h.date}` });
  }

  const islamicForYear = islamicHolidaysByYear[year];
  if (islamicForYear) {
    for (const h of islamicForYear) {
      results.push({ ...h, date: `${year}-${h.date}` });
    }
  }

  return results;
}

export function getHolidayInfo(dateString: string): string | null {
  const holidays = getHolidaysForDate(dateString);
  if (holidays.length === 0) return null;
  return holidays.map(h => h.nameRu).join(", ");
}
