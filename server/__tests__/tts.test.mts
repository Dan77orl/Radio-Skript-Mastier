// Stability quantization for eleven_v3 — no database or API key needed.
//   node server/__tests__/tts.test.mts
const { quantizeStability, ElevenLabsError, describeTtsError } = await import("../tts.ts");
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

// The settings default was 0.75, which eleven_v3 rejects outright — this is the
// value that failed every segment in production.
check("0.75 → 0.5", quantizeStability(0.75) === 0.5, String(quantizeStability(0.75)));
check("0.9 → 1", quantizeStability(0.9) === 1, String(quantizeStability(0.9)));
check("0.1 → 0", quantizeStability(0.1) === 0, String(quantizeStability(0.1)));
check("0.4 → 0.5", quantizeStability(0.4) === 0.5, String(quantizeStability(0.4)));
check("0.25 при ничьей → 0", quantizeStability(0.25) === 0, String(quantizeStability(0.25)));

// Legal values must survive untouched.
for (const v of [0, 0.5, 1]) {
  check(`${v} не меняется`, quantizeStability(v) === v, String(quantizeStability(v)));
}

// Out-of-range input must not escape the allowed set.
check("-1 зажимается в 0", quantizeStability(-1) === 0, String(quantizeStability(-1)));
check("5 зажимается в 1", quantizeStability(5) === 1, String(quantizeStability(5)));

// Other models take the slider verbatim.
check("не-v3 модель не квантуется", quantizeStability(0.75, "eleven_multilingual_v2") === 0.75);

// Error reporting: the caller must be able to tell 402 from 401.
check("402 → про кредиты", describeTtsError(new ElevenLabsError(402, "quota")).includes("кредиты"));
check("401 → про ключ", describeTtsError(new ElevenLabsError(401, "bad key")).includes("ключ"));
check("обычная ошибка не теряется", describeTtsError(new Error("ffmpeg упал")) === "ffmpeg упал");

console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
