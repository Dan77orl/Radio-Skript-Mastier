import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, access } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
  "pdf-parse",
  "mammoth",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

async function seedDatabase() {
  try {
    await access("seed-prod.dump");
    console.log("pushing database schema...");
    try {
      execSync("npx drizzle-kit push", { stdio: "inherit" });
    } catch (e: any) {
      console.warn("db:push warning (non-fatal):", e.message);
    }
    console.log("seeding production database...");
    try {
      execSync(`pg_restore --data-only --no-owner --no-privileges --disable-triggers -d "$DATABASE_URL" seed-prod.dump 2>&1 || true`, { stdio: "inherit" });
    } catch (e: any) {
      console.warn("seed had some errors (non-fatal):", e.message);
    }
    console.log("database seed step complete");
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.log("no seed dump found, skipping seed");
    } else {
      console.warn("seed warning:", e.message);
    }
  }
}

buildAll()
  .then(() => seedDatabase())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
