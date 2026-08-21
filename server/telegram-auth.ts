import { createHash, createHmac, timingSafeEqual } from "crypto";

export interface TelegramAuthData {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string | number;
  hash: string;
  [key: string]: unknown;
}

/** Reject a login payload older than this — it stops a captured widget response being replayed. */
const MAX_AUTH_AGE_SECONDS = 5 * 60;

export type TelegramVerifyResult =
  | { ok: true; telegramId: string; username?: string; name: string; photoUrl?: string }
  | { ok: false; reason: string };

/**
 * Verify a Telegram Login Widget payload.
 *
 * Telegram signs the data with HMAC-SHA256 keyed by SHA256(bot_token). Anyone
 * can POST arbitrary JSON to our endpoint, so this signature is the only thing
 * that makes the claimed Telegram identity trustworthy — never skip it.
 *
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string): TelegramVerifyResult {
  if (!botToken) return { ok: false, reason: "Telegram bot token is not configured" };
  if (!data || typeof data.hash !== "string" || !data.hash) return { ok: false, reason: "Missing hash" };
  if (data.id === undefined || data.id === null || data.auth_date === undefined) {
    return { ok: false, reason: "Malformed payload" };
  }

  const { hash, ...fields } = data;

  const dataCheckString = Object.keys(fields)
    .filter((key) => fields[key] !== undefined && fields[key] !== null)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Signature does not match" };
  }

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, reason: "Invalid auth_date" };
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) return { ok: false, reason: "Login data has expired" };
  // A timestamp meaningfully in the future means a forged or skewed payload.
  if (ageSeconds < -60) return { ok: false, reason: "Invalid auth_date" };

  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim()
    || data.username
    || `Telegram ${data.id}`;

  return {
    ok: true,
    telegramId: String(data.id),
    username: data.username,
    name,
    photoUrl: data.photo_url,
  };
}
