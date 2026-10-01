/**
 * Fixed-window rate limiting.
 *
 * IMPORTANT: this counter lives in the process, so on Vercel each serverless
 * instance keeps its own tally and the effective limit is higher than the
 * number configured here. It raises the cost of credential stuffing and form
 * spam; it is not a hard guarantee.
 *
 * The interface is deliberately the shape a Redis/Upstash implementation would
 * have, so swapping the backing store later touches this file alone.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Drop expired buckets so the map cannot grow without bound. */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Clear a bucket — called after a successful login so one typo isn't punished. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test-only: wipe all counters between cases. */
export function __resetAllRateLimits(): void {
  buckets.clear();
}

export const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
/**
 * Per account, whatever the address. The IP in a request is only as honest as
 * the proxy in front, so this cap is what actually bounds guesses against one
 * account. Higher than the per-IP limit so a family sharing a school's Wi-Fi
 * is not locked out by one mistyping child.
 */
export const LOGIN_ACCOUNT_RATE_LIMIT = { limit: 30, windowMs: 15 * 60 * 1000 };
export const PUBLIC_FORM_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };
