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

    req.session.userId = user.id;

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
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
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}
