export const LENGTH_CONSTRAINT_REGEX = new RegExp(
  "(?:\\d+\\s*[-\u2013\u2014]?\\s*\\d*\\s*(?:слов|строк|предложен|фраз|секунд|минут|words?|lines?|sentences?|phrases?|seconds?|minutes?))" +
    "|(?:не\\s+более|не\\s+менее|ровно|максимум|минимум|exactly|no\\s+more\\s+than|at\\s+most|at\\s+least)\\s+\\d+" +
    "|готовый\\s+сценарий|готовый\\s+шаблон|готовый\\s+текст" +
    "|используй\\s+(?:этот|данный)\\s+(?:сценарий|текст|шаблон)" +
    "|ready[-\\s]made\\s+script|use\\s+this\\s+script\\s+verbatim",
  "iu",
);

export function hasLengthConstraintInPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return LENGTH_CONSTRAINT_REGEX.test(prompt);
}
