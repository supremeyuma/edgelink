import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
  remaining: number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-IP token bucket.
 *
 * One Durable Object instance per hashed IP gives serialized, atomic updates
 * without a distributed lock. State is persisted in DO storage inside a
 * transaction so a restart does not reset an abusive client's bucket. The
 * Worker fails open if the DO is unavailable; see docs/security.md.
 */
export class RateLimiter extends DurableObject<Env> {
  async check(nowMs = Date.now()): Promise<RateLimitResult> {
    const perMinute = Number(this.env.RATE_LIMIT_PER_MIN ?? "60");
    const burst = Number(this.env.RATE_LIMIT_BURST ?? "30");
    const refillPerMs = perMinute / 60_000;

    return this.ctx.storage.transaction(async (txn) => {
      const state = (await txn.get<BucketState>("bucket")) ?? {
        tokens: burst,
        updatedAt: nowMs,
      };
      const elapsed = Math.max(0, nowMs - state.updatedAt);
      const tokens = Math.min(burst, state.tokens + elapsed * refillPerMs);

      if (tokens >= 1) {
        const remaining = tokens - 1;
        await txn.put("bucket", { tokens: remaining, updatedAt: nowMs });
        return { allowed: true, retryAfter: 0, remaining: Math.floor(remaining) };
      }

      await txn.put("bucket", { tokens, updatedAt: nowMs });
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000));
      return { allowed: false, retryAfter: retryAfterSeconds, remaining: 0 };
    });
  }
}
