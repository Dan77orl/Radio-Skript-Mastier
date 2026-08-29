import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { registerVoiceAgentRoutes } from "./voice-agent-api";
import { seedDemoIfNeeded } from "./seed-demo";
import { ensureAdminExists, requireAuth } from "./auth";
import { registerJobHandlers } from "./jobs/handlers";
import { startJobWorker, stopJobWorker } from "./jobs/queue";
import { serveStatic } from "./static";
import { registerLegalPages } from "./legal-pages";
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

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Response bodies are deliberately not logged: /api/settings returns
      // provider API keys in plaintext for admins, and most endpoints carry
      // tenant content.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // The build script does NOT push the drizzle schema (its syncSchema() is
  // never invoked), so a new column in shared/schema.ts silently breaks every
  // SELECT on that table in production — drizzle lists columns explicitly.
  // Guarantee additive columns idempotently here until a real migration step
  // exists in the deploy pipeline.
  try {
    const { pool } = await import("./db");
    await pool.query(`ALTER TABLE programs ADD COLUMN IF NOT EXISTS downloaded_at timestamp`);
  } catch (err: any) {
    console.error("Schema guard failed (queries on programs may fail):", err?.message);
  }

  registerLegalPages(app);
  registerJobHandlers();
  registerVoiceAgentRoutes(app);
  await registerRoutes(httpServer, app);

  // Orphan-program repair used to run here on every boot. It is a data fix, not
  // startup work: it races across instances and hides the schema gap that causes
  // it. Run migrations/manual/001_tenant_integrity.sql once instead, or call
  // POST /api/admin/fix-orphan-programs.

  // public/ holds per-tenant generated audio and user uploads — never serve it
  // anonymously. Filenames are predictable, so unauthenticated access would let
  // anyone enumerate other tenants' content.
  // Mounted per-directory on purpose. A bare app.use(requireAuth, ...) applies
  // the guard to EVERY request, including "/", so the SPA itself answers 401.
  const publicDir = path.join(process.cwd(), "public");
  app.use("/audio", requireAuth, express.static(path.join(publicDir, "audio")));
  app.use("/uploads", requireAuth, express.static(path.join(publicDir, "uploads")));

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || (err.name === "MulterError" ? 400 : 500);

    console.error(`[error] ${req.method} ${req.path}`, err);

    if (res.headersSent) return;
    // Internal messages can carry upstream provider errors — only surface them
    // for client errors, never for 5xx. Re-throwing here would crash the process.
    const message = status < 500 ? err.message || "Bad Request" : "Internal Server Error";
    res.status(status).json({ message, error: message });
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
      startJobWorker({ concurrency: 2 });
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

  // Give in-flight jobs a chance to finish, and release the ones that cannot,
  // so a redeploy does not leave rows locked until the stale-lock timeout.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log(`received ${signal}, draining jobs…`);
      stopJobWorker()
        .catch((e) => console.error("[jobs] shutdown error:", e))
        .finally(() => {
          httpServer.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 5000).unref();
        });
    });
  }
})();
