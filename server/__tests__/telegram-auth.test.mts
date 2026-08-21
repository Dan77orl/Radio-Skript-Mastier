// Telegram Login Widget signature verification.
//   npx tsx server/__tests__/telegram-auth.test.mts
import { createHash, createHmac } from "crypto";
import { verifyTelegramAuth } from "../telegram-auth.ts";

const TOKEN = "123456:TEST-BOT-TOKEN-abcdefghijklmno";
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

function sign(fields: Record<string, any>, token = TOKEN) {
  const s = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
  return createHmac("sha256", createHash("sha256").update(token).digest()).update(s).digest("hex");
}
const now = Math.floor(Date.now() / 1000);
const base = { id: 987654321, first_name: "Дмитрий", last_name: "О", username: "dan_orl", auth_date: now };

const good: any = { ...base, hash: sign(base) };
const r1 = verifyTelegramAuth(good, TOKEN);
check("валидная подпись принимается", r1.ok, r1.ok ? "" : (r1 as any).reason);
check("  telegramId извлечён", r1.ok && r1.telegramId === "987654321");
check("  имя собрано из first+last", r1.ok && r1.name === "Дмитрий О", r1.ok ? r1.name : "");

check("подделанный hash отвергается", !verifyTelegramAuth({ ...base, hash: "deadbeef".repeat(8) } as any, TOKEN).ok);
check("подпись чужим токеном отвергается", !verifyTelegramAuth({ ...base, hash: sign(base, "999:OTHER") } as any, TOKEN).ok);

const tampered = { ...base, id: 111 };
check("подмена id после подписи отвергается", !verifyTelegramAuth({ ...tampered, hash: sign(base) } as any, TOKEN).ok);

const old = { ...base, auth_date: now - 3600 };
const rOld = verifyTelegramAuth({ ...old, hash: sign(old) } as any, TOKEN);
check("протухшие данные отвергаются (replay)", !rOld.ok, rOld.ok ? "" : (rOld as any).reason);

const future = { ...base, auth_date: now + 600 };
check("дата из будущего отвергается", !verifyTelegramAuth({ ...future, hash: sign(future) } as any, TOKEN).ok);

check("без hash отвергается", !verifyTelegramAuth({ ...base } as any, TOKEN).ok);
check("без токена бота отвергается", !verifyTelegramAuth(good, "").ok);

const noLast = { id: 5, first_name: "Аня", auth_date: now };
const r2 = verifyTelegramAuth({ ...noLast, hash: sign(noLast) } as any, TOKEN);
check("работает без необязательных полей", r2.ok && r2.name === "Аня", r2.ok ? r2.name : (r2 as any).reason);

console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
