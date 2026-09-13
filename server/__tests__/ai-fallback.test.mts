// Claude→Gemini fallback: shape conversion and when it fires. No network —
// both clients are fakes.
//   node server/__tests__/ai-fallback.test.mts
const { withGeminiFallback, __setGeminiForTests } = await import("../ai-fallback.ts");
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

// Capture what reaches Gemini and script its answer.
let geminiCalls: any[] = [];
let geminiAnswer: any = { text: "Привет из Gemini" };
__setGeminiForTests({
  models: { generateContent: async (req: any) => { geminiCalls.push(req); if (geminiAnswer instanceof Error) throw geminiAnswer; return geminiAnswer; } },
});

const failingClaude = {
  messages: {
    create: async () => { throw new Error("Your credit balance is too low"); },
  },
} as any;

const okClaude = {
  messages: {
    create: async () => ({ content: [{ type: "text", text: "Привет из Claude" }] }),
  },
} as any;

// 1. Claude works → Gemini untouched.
const viaClaude = await withGeminiFallback(okClaude).messages.create({ model: "claude-opus-5", max_tokens: 100, messages: [{ role: "user", content: "Привет" }] });
check("Claude работает — ответ от Claude", viaClaude.content[0].text === "Привет из Claude");
check("Gemini не вызывался", geminiCalls.length === 0, String(geminiCalls.length));

// 2. Claude fails → Gemini answers in Anthropic shape.
const viaGemini = await withGeminiFallback(failingClaude).messages.create({
  model: "claude-opus-5",
  max_tokens: 500,
  system: "Ты сценарист радио",
  temperature: 0.8,
  messages: [
    { role: "user", content: "Напиши выпуск" },
    { role: "assistant", content: [{ type: "text", text: "Черновик" }] },
    { role: "user", content: "Доработай" },
  ],
});
check("фолбэк ответил", viaGemini.content?.[0]?.text === "Привет из Gemini", JSON.stringify(viaGemini.content));
check("форма как у Anthropic", viaGemini.content[0].type === "text" && viaGemini.role === "assistant");
const req = geminiCalls[0];
check("system → systemInstruction", req.config.systemInstruction === "Ты сценарист радио", req.config.systemInstruction);
check("assistant → model", req.contents[1].role === "model", req.contents[1].role);
check("контент-блоки склеены в текст", req.contents[1].parts[0].text === "Черновик");
check("max_tokens проброшен", req.config.maxOutputTokens === 500);
check("temperature проброшена", req.config.temperature === 0.8);

// 3. Both fail → original Claude error surfaces (it's the actionable one).
geminiAnswer = new Error("gemini down");
let thrown = "";
try { await withGeminiFallback(failingClaude).messages.create({ model: "m", max_tokens: 10, messages: [] }); } catch (e: any) { thrown = e.message; }
check("оба упали — наружу ошибка Claude", thrown.includes("credit balance"), thrown);

// 4. Empty Gemini answer counts as failure.
geminiAnswer = { text: "" };
thrown = "";
try { await withGeminiFallback(failingClaude).messages.create({ model: "m", max_tokens: 10, messages: [] }); } catch (e: any) { thrown = e.message; }
check("пустой ответ Gemini не подменяет ошибку", thrown.includes("credit balance"), thrown);

console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
