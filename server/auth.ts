import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { storage } from "./storage";
import { registerSchema, loginSchema } from "@shared/schema";
import { verifyTelegramAuth } from "./telegram-auth";

/** Issue a fresh session id on privilege change, so a pre-auth session id
 *  planted by an attacker cannot be promoted to an authenticated one. */
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    /** Password accepted, waiting for the Telegram second factor. Not authenticated. */
    pendingTelegramUserId?: string;
    /** CSRF binding for the Google OAuth round-trip. */
    googleOAuthState?: string;
  }
}

/** bcrypt hash of a value nobody can supply; used to equalise login timing. */
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Headers for server-to-server calls the app makes to its own API
 * (scheduler, voice agent). Returns an empty object when the internal key
 * is not configured, so callers fail with 401 instead of running unauthenticated.
 */
export function internalAuthHeaders(userId: string | null | undefined): Record<string, string> {
  const key = internalApiKey();
  if (!key || !userId) return {};
  return { "x-internal-key": key, "x-internal-user-id": userId };
}

/**
 * Shared secret for the app's calls to its own API. The scheduler, the job queue
 * and ad production all depend on it — VOICE_AGENT_API_KEY is only kept because
 * that is what existing deployments set.
 */
export function internalApiKey(): string | undefined {
  return process.env.INTERNAL_API_KEY || process.env.VOICE_AGENT_API_KEY;
}

export async function registerUser(req: Request, res: Response) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { email, password, name } = parsed.data;

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "User with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const username = email.split("@")[0] + "_" + Date.now().toString(36);

    const user = await storage.createUser({
      username,
      email,
      password: hashedPassword,
      name,
    });

    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.includes(email.toLowerCase()) && user.role !== "admin") {
      await storage.updateUserRole(user.id, "admin");
      user.role = "admin";
    }

    await regenerateSession(req);
    req.session.userId = user.id;

    return res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language || null,
      role: user.role || "user",
      hasCompletedOnboarding: user.hasCompletedOnboarding || false,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
}

/**
 * Sign in (or sign up) with a Telegram Login Widget payload. Also serves as the
 * second factor: an account with requireTelegramLogin only completes a password
 * login once this endpoint confirms the linked Telegram account.
 */
export async function telegramAuth(req: Request, res: Response) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(503).json({ error: "Telegram login is not configured on this server" });
    }

    const verified = verifyTelegramAuth(req.body, botToken);
    if (!verified.ok) {
      console.warn("[telegram-auth] rejected:", verified.reason);
      return res.status(401).json({ error: "Telegram authentication failed" });
    }

    let user = await storage.getUserByTelegramId(verified.telegramId);

    // Completing a pending password login (second factor).
    const pendingUserId = req.session.pendingTelegramUserId;
    if (pendingUserId) {
      if (!user || user.id !== pendingUserId) {
        return res.status(401).json({ error: "This Telegram account is not linked to that user" });
      }
      delete req.session.pendingTelegramUserId;
    }

    if (!user) {
      // Linking Telegram to the account already signed in.
      if (req.session.userId) {
        const current = await storage.getUser(req.session.userId);
        if (!current) return res.status(401).json({ error: "Authentication required" });
        user = await storage.linkTelegramAccount(current.id, {
          telegramId: verified.telegramId,
          telegramUsername: verified.username ?? null,
          telegramPhotoUrl: verified.photoUrl ?? null,
        });
      } else {
        // Telegram gives no email, so synthesise a stable placeholder. It is
        // unique per Telegram id and never used for delivery.
        const email = `tg${verified.telegramId}@telegram.local`;
        const existingByEmail = await storage.getUserByEmail(email);
        user = existingByEmail
          ? await storage.linkTelegramAccount(existingByEmail.id, {
              telegramId: verified.telegramId,
              telegramUsername: verified.username ?? null,
              telegramPhotoUrl: verified.photoUrl ?? null,
            })
          : await storage.createUser({
              username: `${verified.username || "tg"}_${verified.telegramId}`,
              email,
              password: null,
              name: verified.name,
              telegramId: verified.telegramId,
              telegramUsername: verified.username ?? null,
              telegramPhotoUrl: verified.photoUrl ?? null,
            } as any);
      }
    }

    if (!user) return res.status(500).json({ error: "Could not resolve Telegram account" });
    if (user.blocked) return res.status(403).json({ error: "Your account has been blocked" });

    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (user.email && adminEmails.includes(user.email.toLowerCase()) && user.role !== "admin") {
      await storage.updateUserRole(user.id, "admin");
      user.role = "admin";
    }

    await regenerateSession(req);
    req.session.userId = user.id;

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language || null,
      role: user.role || "user",
      hasCompletedOnboarding: user.hasCompletedOnboarding || false,
      telegramUsername: user.telegramUsername || null,
    });
  } catch (error) {
    console.error("Telegram auth error:", error);
    return res.status(500).json({ error: "Telegram authentication failed" });
  }
}

export async function loginUser(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { email, password } = parsed.data;

    const user = await storage.getUserByEmail(email);
    // Compare against a dummy hash when the account has no password, so a
    // Telegram-only or unknown account takes the same time as a real one and
    // cannot be identified by response timing.
    const isValid = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH);
    if (!user || !user.password || !isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.blocked) {
      return res.status(403).json({ error: "Your account has been blocked" });
    }

    // Second factor: the password was right, but the session is not authenticated
    // until the linked Telegram account confirms it.
    if (user.requireTelegramLogin && user.telegramId) {
      await regenerateSession(req);
      req.session.pendingTelegramUserId = user.id;
      return res.status(202).json({
        twoFactorRequired: true,
        method: "telegram",
        telegramUsername: user.telegramUsername || null,
      });
    }

    await regenerateSession(req);
    req.session.userId = user.id;

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language || null,
      role: user.role || "user",
      hasCompletedOnboarding: user.hasCompletedOnboarding || false,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
}

export async function logoutUser(req: Request, res: Response) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    return res.json({ ok: true });
  });
}

export async function getCurrentUser(req: Request, res: Response) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = await storage.getUser(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    language: user.language || null,
    role: user.role || "user",
    hasCompletedOnboarding: user.hasCompletedOnboarding || false,
  });
}

export async function completeOnboarding(req: Request, res: Response) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  await storage.completeOnboarding(req.session.userId);
  return res.json({ ok: true });
}

export async function updateUserLanguage(req: Request, res: Response) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { language } = req.body;
  if (!language) {
    return res.status(400).json({ error: "Invalid language" });
  }

  await storage.updateUserLanguage(req.session.userId, language);
  await storage.updateDefaultPromptsForLanguage(req.session.userId, language);
  return res.json({ ok: true, language });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const internalKey = req.headers["x-internal-key"] as string | undefined;
    if (internalKey) {
      const expected = internalApiKey();
      if (!expected || !safeCompare(internalKey, expected)) {
        return res.status(401).json({ error: "Authentication required" });
      }
      // The impersonated user must exist and be active — the internal key
      // authenticates the caller, it does not vouch for an arbitrary user id.
      const internalUserId = req.headers["x-internal-user-id"] as string | undefined;
      if (!internalUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const internalUser = await storage.getUser(internalUserId);
      if (!internalUser) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (internalUser.blocked) {
        return res.status(403).json({ error: "Your account has been blocked" });
      }
      req.session.userId = internalUser.id;
      return next();
    }
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Authentication required" });
    }
    if (user.blocked) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: "Your account has been blocked" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function ensureAdminExists() {
  const adminEmailsEnv = process.env.ADMIN_EMAILS;
  if (!adminEmailsEnv) return;
  const emails = adminEmailsEnv.split(",").map(e => e.trim()).filter(Boolean);
  for (const email of emails) {
    const user = await storage.getUserByEmail(email);
    if (user && user.role !== "admin") {
      await storage.updateUserRole(user.id, "admin");
      console.log(`[admin-bootstrap] Promoted ${email} to admin`);
    }
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
