/**
 * A prompt that IS the finished script — the model must reproduce it, not
 * rewrite it to hit a word budget. This is the only case where the duration
 * budget must be withheld.
 */
export const EXACT_SCRIPT_REGEX = new RegExp(
  "готовый\\s+сценарий|готовый\\s+шаблон|готовый\\s+текст" +
    "|используй\\s+(?:этот|данный)\\s+(?:сценарий|текст|шаблон)" +
    "|ready[-\\s]made\\s+script|use\\s+this\\s+script\\s+verbatim",
  "iu",
);

/**
 * An explicit length the author wrote in their own prompt ("60 секунд",
 * "120 words"). Used to pick up their number — NOT to suppress the word budget.
 */
export const LENGTH_CONSTRAINT_REGEX = new RegExp(
  "(?:\\d+\\s*[-–—]?\\s*\\d*\\s*(?:слов|строк|предложен|фраз|секунд|минут|words?|lines?|sentences?|phrases?|seconds?|minutes?))" +
    "|(?:не\\s+более|не\\s+менее|ровно|максимум|минимум|exactly|no\\s+more\\s+than|at\\s+most|at\\s+least)\\s+\\d+",
  "iu",
);

export function hasExactScriptDirective(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return EXACT_SCRIPT_REGEX.test(prompt);
}

export function hasLengthConstraintInPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return LENGTH_CONSTRAINT_REGEX.test(prompt) || EXACT_SCRIPT_REGEX.test(prompt);
}

// Second group captures the upper bound of a range ("30-40 секунд") — that is
// the number the author is budgeting against.
const DURATION_PATTERNS: Array<{ re: RegExp; unit: "sec" | "min" }> = [
  { re: /(\d+)\s*(?:[-–—]\s*(\d+)\s*)?(?:секунд\w*|сек\.?(?:\s|$|,|\.)|sec(?:ond)?s?\.?\b)/iu, unit: "sec" },
  { re: /(\d+)\s*(?:[-–—]\s*(\d+)\s*)?(?:минут\w*|мин\.?(?:\s|$|,|\.)|min(?:ute)?s?\.?\b)/iu, unit: "min" },
];

/**
 * Pull a spoken duration out of a free-form prompt so "длительность 45 секунд"
 * drives the same word budget the UI setting does. Returns null when the prompt
 * says nothing about duration.
 *
 * Clamped to 5..600s: anything outside that is a misparse, not an instruction.
 */
export function extractDurationSecondsFromPrompt(prompt: string | null | undefined): number | null {
  if (!prompt) return null;
  for (const { re, unit } of DURATION_PATTERNS) {
    const match = prompt.match(re);
    if (!match) continue;
    const value = parseInt(match[2] || match[1], 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    const seconds = unit === "min" ? value * 60 : value;
    if (seconds < 5 || seconds > 600) continue;
    return seconds;
  }
  return null;
}
