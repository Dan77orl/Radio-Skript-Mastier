// TTS contract: stability quantization, error surfacing, bitrate fallback.
// fetch is mocked — no database or API key needed.
//   node server/__tests__/tts.test.mts
const { quantizeStability, ElevenLabsError, describeTtsError, synthesizeSpeech, prepareTtsText } = await import("../tts.ts");
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

// Stability goes to the API verbatim — quantizing 0.75 to 0.5 audibly changed
// the voice (months of production ran v3 with 0.75 sent as-is). Only clamping.
for (const v of [0, 0.25, 0.4, 0.5, 0.75, 0.9, 1]) {
  check(`${v} проходит как есть`, quantizeStability(v) === v, String(quantizeStability(v)));
}
check("-1 зажимается в 0", quantizeStability(-1) === 0, String(quantizeStability(-1)));
check("5 зажимается в 1", quantizeStability(5) === 1, String(quantizeStability(5)));
check("не-v3 модель тоже как есть", quantizeStability(0.75, "eleven_multilingual_v2") === 0.75);

// Error reporting: the caller must be able to tell 402 from 401.
check("402 → про кредиты", describeTtsError(new ElevenLabsError(402, "quota")).includes("кредиты"));
check("401 → про ключ", describeTtsError(new ElevenLabsError(401, "bad key")).includes("ключ"));
check("обычная ошибка не теряется", describeTtsError(new Error("ffmpeg упал")) === "ffmpeg упал");

// The API's own message must reach the user, whatever shape the body takes.
const bodyShapes: Array<[string, string]> = [
  ['{"detail":"invalid model"}', "invalid model"],
  ['{"detail":{"status":"invalid_subscription","message":"needs Creator tier"}}', "needs Creator tier"],
  ['{"detail":[{"msg":"field required"}]}', "field required"],
  ["plain text error", "plain text error"],
];
for (const [body, expected] of bodyShapes) {
  const r = new ElevenLabsError(400, body).reason;
  check(`тело "${body.slice(0, 30)}…" → сообщение в reason`, r.includes(expected), r);
}

// Bitrate fallback: a plan that rejects 192 kbps must not kill the broadcast.
const calls: string[] = [];
const mockFetch = (responses: Array<{ status: number; body?: string }>) => {
  let i = 0;
  (globalThis as any).fetch = async (url: string) => {
    calls.push(new URL(url).searchParams.get("output_format") ?? "");
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status === 200,
      status: r.status,
      text: async () => r.body ?? "",
      arrayBuffer: async () => new TextEncoder().encode("MP3DATA").buffer,
    };
  };
};
const opts = { apiKey: "k", voiceId: "v", text: "привет", stability: 0.5, similarityBoost: 0.75 };

calls.length = 0;
mockFetch([
  { status: 400, body: '{"detail":{"status":"invalid_subscription","message":"output_format mp3_44100_192 requires Creator tier"}}' },
  { status: 200 },
]);
const buf = await synthesizeSpeech(opts);
check("отказ по тарифу → повтор на 128", calls.join(",") === "mp3_44100_192,mp3_44100_128", calls.join(","));
check("повтор возвращает аудио", buf.toString() === "MP3DATA");

calls.length = 0;
mockFetch([{ status: 400, body: '{"detail":"invalid voice_id"}' }]);
let threw = "";
try { await synthesizeSpeech(opts); } catch (e: any) { threw = e.reason ?? e.message; }
check("400 не про формат → без повтора", calls.length === 1, String(calls.length));
check("и с настоящей причиной", threw.includes("invalid voice_id"), threw);

calls.length = 0;
mockFetch([{ status: 200 }]);
await synthesizeSpeech(opts);
check("успех с первого раза → один запрос", calls.length === 1, String(calls.length));

// v3 keeps emotion tags (they drive its delivery); older models get clean text.
check("v3 сохраняет теги", prepareTtsText("[excited] Привет!") === "[excited] Привет!", prepareTtsText("[excited] Привет!"));
check("v3 канонизирует whisper", prepareTtsText("[whisper] тише") === "[whispers] тише", prepareTtsText("[whisper] тише"));
check("не-v3 вырезает теги", prepareTtsText("[excited] Привет!", "eleven_multilingual_v2") === "Привет!", prepareTtsText("[excited] Привет!", "eleven_multilingual_v2"));
check("не-v3: несколько тегов", prepareTtsText("[warm] Добрый [slow] вечер", "eleven_flash_v2") === "Добрый вечер");

console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
