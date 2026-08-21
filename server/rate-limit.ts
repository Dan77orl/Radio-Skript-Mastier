import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window in-memory rate limiter.
 *
 * Per-process, so it does not hold across a multi-instance deployment — it is a
 * brute-force and cost-abuse brake, not a quota system. Replace with a shared
 * store (Redis / Postgres) if the app is scaled horizontally.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const { windowMs, max, message = "Too many requests. Please try again later." } = options;
  const keyFn = options.keyFn ?? clientIp;
  const buckets = new Map<string, Bucket>();

  // Drop expired buckets so an attacker rotating keys cannot grow the map without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }

    bucket.count++;
    next();
  };
}

export function clientIp(req: Request): string {
  // `trust proxy` is set in index.ts, so req.ip already reflects X-Forwarded-For.
  return req.ip || req.socket.remoteAddress || "unknown";
}
