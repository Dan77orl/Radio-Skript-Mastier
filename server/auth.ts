import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { registerSchema, loginSchema } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
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

    req.session.userId = user.id;

    return res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language || null,
      role: user.role || "user",
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Registration failed" });
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
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.blocked) {
      return res.status(403).json({ error: "Your account has been blocked" });
    }

    req.session.userId = user.id;

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language || null,
      role: user.role || "user",
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
  });
}

export async function updateUserLanguage(req: Request, res: Response) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { language } = req.body;
  if (!language || !["ru", "en", "tr"].includes(language)) {
    return res.status(400).json({ error: "Invalid language" });
  }

  await storage.updateUserLanguage(req.session.userId, language);
  return res.json({ ok: true, language });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const internalKey = req.headers["x-internal-key"] as string;
  if (internalKey && internalKey === process.env.VOICE_AGENT_API_KEY) {
    req.session.userId = req.headers["x-internal-user-id"] as string || "system";
    return next();
  }
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = await storage.getUser(req.session.userId);
  if (user?.blocked) {
    req.session.destroy(() => {});
    return res.status(403).json({ error: "Your account has been blocked" });
  }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
