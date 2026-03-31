import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { registerVoiceAgentRoutes } from "./voice-agent-api";
import { seedDemoIfNeeded } from "./seed-demo";
import { ensureAdminExists } from "./auth";
import { serveStatic } from "./static";
import { createServer } from "http";
import path from "path";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.set("trust proxy", 1);

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  registerVoiceAgentRoutes(app);
  await registerRoutes(httpServer, app);

  try {
    const { pool: dbPool } = await import("./db");
    const orphanCheck = await dbPool.query("SELECT COUNT(*) as cnt FROM programs WHERE user_id IS NULL");
    const orphanCount = parseInt(orphanCheck.rows[0]?.cnt || "0");
    if (orphanCount > 0) {
      console.log(`[migration] Found ${orphanCount} orphan programs, fixing...`);
      const typesResult = await dbPool.query("SELECT id, user_id FROM program_types WHERE user_id IS NOT NULL");
      const typeMap = new Map<string, string>();
      for (const t of typesResult.rows) typeMap.set(t.id, t.user_id);
      const orphans = await dbPool.query("SELECT id, program_type_id FROM programs WHERE user_id IS NULL");
      let fixed = 0;
      for (const p of orphans.rows) {
        const ownerId = typeMap.get(p.program_type_id);
        if (ownerId) {
          await dbPool.query("UPDATE programs SET user_id = $1 WHERE id = $2", [ownerId, p.id]);
          fixed++;
        }
      }
      console.log(`[migration] Fixed ${fixed}/${orphanCount} orphan programs`);
    }
  } catch (e) {
    console.error("[migration] Error fixing orphan programs:", e);
  }

  // Serve static files from public folder (audio files, etc.)
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      setTimeout(() => seedDemoIfNeeded(), 5000);
      setTimeout(() => ensureAdminExists().catch(e => console.error("[admin-bootstrap]", e)), 3000);
      setTimeout(async () => {
        try {
          const { pool: checkPool } = await import("./db");
          const adminEmails = (process.env.ADMIN_EMAILS || "test@test.com").split(",").map(e => e.trim()).filter(Boolean);
          for (const email of adminEmails) {
            const adminResult = await checkPool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
            if (adminResult.rows.length > 0) {
              const adminId = adminResult.rows[0].id;
              const voiceResult = await checkPool.query("SELECT COUNT(*) as cnt FROM voices WHERE user_id = $1", [adminId]);
              const voiceCount = parseInt(voiceResult.rows[0]?.cnt || "0");
              if (voiceCount < 6) {
                console.log(`[voice-check] Admin ${email} has only ${voiceCount} voices. Use POST /api/admin/sync-voices to add missing voices.`);
              }
            }
          }
        } catch (e) {
          console.error("[voice-check] Error checking voices:", e);
        }
      }, 8000);
    },
  );
})();
