import { randomUUID } from "crypto";
import { pool } from "../db";
import type { Job } from "@shared/schema";

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobContext {
  job: Job;
  /** Surface a human-readable step so the UI can show what is happening. */
  setProgress: (text: string) => Promise<void>;
  /** True once shutdown has begun — long handlers should check it between steps. */
  isCancelled: () => boolean;
}

export type JobHandler = (payload: any, ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

/**
 * node-postgres returns raw column names, so a row is snake_case while the
 * drizzle `Job` type is camelCase. Reading `row.maxAttempts` off a raw row
 * yields undefined — which silently disabled the retry limit — so every row
 * leaving this module goes through here.
 */
function rowToJob(row: any): Job {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    progress: row.progress,
    result: row.result,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    runAt: row.run_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  } as Job;
}

export function registerJobHandler(type: string, handler: JobHandler) {
  if (handlers.has(type)) {
    throw new Error(`Job handler already registered for type "${type}"`);
  }
  handlers.set(type, handler);
}

/**
 * Run another job type inline, inside the caller's worker slot.
 *
 * An orchestrating job must never enqueue a sub-job and then block waiting for
 * it: the parent holds a slot while it waits, so with N orchestrators running at
 * concurrency N the children can never be claimed and everything deadlocks until
 * the timeouts fire.
 */
export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export async function enqueueJob(opts: {
  type: string;
  userId: string | null;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAt?: Date;
}): Promise<Job> {
  if (!handlers.has(opts.type)) {
    // Fail at enqueue time rather than leaving an unrunnable row in the table.
    throw new Error(`No job handler registered for type "${opts.type}"`);
  }
  const { rows } = await pool.query(
    `INSERT INTO jobs (user_id, type, payload, max_attempts, run_at)
     VALUES ($1, $2, $3::jsonb, $4, COALESCE($5, CURRENT_TIMESTAMP))
     RETURNING *`,
    [
      opts.userId,
      opts.type,
      JSON.stringify(opts.payload ?? {}),
      opts.maxAttempts ?? 3,
      opts.runAt ?? null,
    ],
  );
  return rowToJob(rows[0]);
}

export async function getJob(id: string, userId: string): Promise<Job | undefined> {
  const { rows } = await pool.query(
    `SELECT * FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? rowToJob(rows[0]) : undefined;
}

export async function listJobs(userId: string, opts: { type?: string; limit?: number } = {}): Promise<Job[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const params: any[] = [userId];
  let sql = `SELECT * FROM jobs WHERE user_id = $1`;
  if (opts.type) {
    params.push(opts.type);
    sql += ` AND type = $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows.map(rowToJob);
}

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 2000;
/** A job held longer than this is assumed to belong to a dead process. */
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 30 * 1000;

let running = false;
let stopping = false;
let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<string>();

/**
 * Claim one runnable job. SKIP LOCKED means concurrent workers step over rows
 * another worker is already claiming instead of blocking or double-running.
 */
async function claimJob(): Promise<Job | undefined> {
  const { rows } = await pool.query(
    `UPDATE jobs SET
       status = 'running',
       attempts = attempts + 1,
       locked_at = CURRENT_TIMESTAMP,
       locked_by = $1,
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE id = (
       SELECT id FROM jobs
       WHERE (
         (status = 'pending' AND run_at <= CURRENT_TIMESTAMP)
         OR (status = 'running' AND locked_at < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 millisecond'))
       )
       ORDER BY run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [WORKER_ID, LOCK_TIMEOUT_MS],
  );
  return rows[0] ? rowToJob(rows[0]) : undefined;
}

async function finishJob(id: string, result: unknown) {
  await pool.query(
    `UPDATE jobs SET status = 'succeeded', result = $2::jsonb, progress = NULL,
       finished_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_by = NULL
     WHERE id = $1`,
    [id, JSON.stringify(result ?? null)],
  );
}

async function failJob(job: Job, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await pool.query(
      `UPDATE jobs SET status = 'failed', last_error = $2, finished_at = CURRENT_TIMESTAMP,
         locked_at = NULL, locked_by = NULL
       WHERE id = $1`,
      [job.id, message.slice(0, 2000)],
    );
    console.error(`[jobs] ${job.type} ${job.id} failed permanently after ${job.attempts} attempt(s): ${message}`);
    return;
  }

  // Exponential backoff: 30s, 60s, 120s …
  const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, job.attempts - 1));
  await pool.query(
    `UPDATE jobs SET status = 'pending', last_error = $2,
       run_at = CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 millisecond'),
       locked_at = NULL, locked_by = NULL
     WHERE id = $1`,
    [job.id, message.slice(0, 2000), delayMs],
  );
  console.warn(`[jobs] ${job.type} ${job.id} attempt ${job.attempts}/${job.maxAttempts} failed, retrying in ${Math.round(delayMs / 1000)}s: ${message}`);
}

async function runJob(job: Job) {
  const handler = handlers.get(job.type);
  if (!handler) {
    // Handler disappeared (renamed type, partial deploy) — do not retry forever.
    await pool.query(
      `UPDATE jobs SET status = 'failed', last_error = $2, finished_at = CURRENT_TIMESTAMP,
         locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [job.id, `No handler registered for type "${job.type}"`],
    );
    return;
  }

  const ctx: JobContext = {
    job,
    setProgress: async (text: string) => {
      await pool.query(`UPDATE jobs SET progress = $2, locked_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id, text.slice(0, 500)]);
    },
    isCancelled: () => stopping,
  };

  try {
    const result = await handler(job.payload ?? {}, ctx);
    await finishJob(job.id, result);
  } catch (err) {
    await failJob(job, err);
  }
}

async function tick(concurrency: number) {
  while (!stopping && inFlight.size < concurrency) {
    let job: Job | undefined;
    try {
      job = await claimJob();
    } catch (err: any) {
      console.error("[jobs] claim failed:", err?.message);
      return;
    }
    if (!job) return;

    inFlight.add(job.id);
    void runJob(job)
      .catch((err) => console.error(`[jobs] unexpected failure for ${job!.id}:`, err))
      .finally(() => inFlight.delete(job!.id));
  }
}

export function startJobWorker(opts: { concurrency?: number } = {}) {
  if (running) return;
  running = true;
  stopping = false;
  const concurrency = opts.concurrency ?? 2;

  console.log(`[jobs] worker ${WORKER_ID} started (concurrency ${concurrency}, ${handlers.size} handler(s))`);
  timer = setInterval(() => void tick(concurrency), POLL_INTERVAL_MS);
  timer.unref?.();
}

export async function stopJobWorker(timeoutMs = 10000) {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;

  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // Anything still running is released so another worker can pick it up rather
  // than waiting out the full lock timeout.
  if (inFlight.size > 0) {
    const ids = [...inFlight];
    await pool.query(
      `UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL WHERE id = ANY($1::varchar[])`,
      [ids],
    ).catch((err) => console.error("[jobs] failed to release in-flight jobs:", err?.message));
    console.warn(`[jobs] released ${ids.length} in-flight job(s) on shutdown`);
  }
  running = false;
}
