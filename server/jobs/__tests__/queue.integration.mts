// Integration test for the job queue. Needs a throwaway Postgres:
//
//   createdb radioflow_qtest
//   psql -d radioflow_qtest -c "CREATE TABLE users (id varchar PRIMARY KEY)"
//   psql -d radioflow_qtest -c "INSERT INTO users (id) VALUES ('11111111-1111-1111-1111-111111111111')"
//   psql -d radioflow_qtest -f migrations/0003_polite_korg.sql
//   npx tsx server/jobs/__tests__/queue.integration.mts
//
// Covers: enqueue validation, success, retry with backoff, attempt exhaustion,
// concurrent claiming (no double-delivery), and reclaiming a dead worker's job.
process.env.DATABASE_URL = "postgres://localhost:5432/radioflow_qtest";

const { pool } = await import("../../db.ts");
const q = await import("../queue.ts");

const USER = "11111111-1111-1111-1111-111111111111";
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(ok ? "  ok  " : "FAIL  ", name, detail);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await pool.query("TRUNCATE jobs");

// --- 1. handler must exist before a job can be queued -----------------------
let rejected = false;
try {
  await q.enqueueJob({ type: "does.not.exist", userId: USER });
} catch { rejected = true; }
check("незарегистрированный тип отклоняется при постановке", rejected);

// --- 2. happy path ----------------------------------------------------------
const seen: string[] = [];
q.registerJobHandler("test.ok", async (payload: any, ctx: any) => {
  await ctx.setProgress("работаю");
  seen.push(payload.tag);
  return { echoed: payload.tag };
});

// --- 3. retries then succeeds ----------------------------------------------
let attempts = 0;
q.registerJobHandler("test.flaky", async () => {
  attempts++;
  if (attempts < 2) throw new Error("временный сбой");
  return { attempts };
});

// --- 4. exhausts attempts ---------------------------------------------------
q.registerJobHandler("test.always-fails", async () => { throw new Error("всегда падает"); });

// --- 5. slow job, to observe concurrent claiming ----------------------------
q.registerJobHandler("test.slow", async () => { await sleep(600); return {}; });

const okJob = await q.enqueueJob({ type: "test.ok", userId: USER, payload: { tag: "первая" } });
const flakyJob = await q.enqueueJob({ type: "test.flaky", userId: USER, maxAttempts: 3 });
const deadJob = await q.enqueueJob({ type: "test.always-fails", userId: USER, maxAttempts: 1 });

q.startJobWorker({ concurrency: 2 });
await sleep(3500);

const okRow = (await pool.query("SELECT * FROM jobs WHERE id=$1", [okJob.id])).rows[0];
check("успешная задача → succeeded", okRow.status === "succeeded", okRow.status);
check("результат сохранён", JSON.stringify(okRow.result) === '{"echoed":"первая"}', JSON.stringify(okRow.result));
check("progress очищен после успеха", okRow.progress === null, String(okRow.progress));
check("блокировка снята", okRow.locked_by === null);

const flakyRow = (await pool.query("SELECT * FROM jobs WHERE id=$1", [flakyJob.id])).rows[0];
check("падавшая задача повторилась и запланирована", flakyRow.attempts >= 1 && flakyRow.last_error !== null, `attempts=${flakyRow.attempts} status=${flakyRow.status}`);
check("бэкофф отодвинул запуск в будущее", flakyRow.status !== "pending" || new Date(flakyRow.run_at) > new Date(), String(flakyRow.run_at));

const deadRow = (await pool.query("SELECT * FROM jobs WHERE id=$1", [deadJob.id])).rows[0];
check("исчерпав попытки → failed", deadRow.status === "failed", `${deadRow.status} attempts=${deadRow.attempts}`);
check("ошибка записана", (deadRow.last_error || "").includes("всегда падает"));

// --- 6. two workers never claim the same job -------------------------------
await pool.query("TRUNCATE jobs");
const ids: string[] = [];
for (let i = 0; i < 6; i++) {
  ids.push((await q.enqueueJob({ type: "test.slow", userId: USER })).id);
}
// Claim concurrently through raw SQL mirroring the worker's statement.
const claimSql = `UPDATE jobs SET status='running', attempts=attempts+1, locked_at=CURRENT_TIMESTAMP, locked_by=$1
  WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at <= CURRENT_TIMESTAMP
              ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
const claims = await Promise.all(
  Array.from({ length: 6 }, (_, i) => pool.query(claimSql, [`w${i}`]).then((r: any) => r.rows[0]?.id)),
);
const claimed = claims.filter(Boolean);
check("параллельный захват выдал 6 задач", claimed.length === 6, `выдано ${claimed.length}`);
check("ни одна задача не выдана дважды", new Set(claimed).size === claimed.length);

// --- 7. stale lock is reclaimed --------------------------------------------
await pool.query("TRUNCATE jobs");
const stale = await q.enqueueJob({ type: "test.ok", userId: USER, payload: { tag: "зависшая" } });
await pool.query(
  `UPDATE jobs SET status='running', locked_at = CURRENT_TIMESTAMP - INTERVAL '30 minutes', locked_by='умерший-воркер' WHERE id=$1`,
  [stale.id],
);
await sleep(3000);
const staleRow = (await pool.query("SELECT * FROM jobs WHERE id=$1", [stale.id])).rows[0];
check("задача мёртвого воркера подобрана заново", staleRow.status === "succeeded", `${staleRow.status} by=${staleRow.locked_by}`);

await q.stopJobWorker(2000);
await pool.end();
console.log(failures === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
