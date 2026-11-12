import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

/**
 * Per-key token bucket used to throttle abusive clients at the edge.
 *
 * Phase G4 implements the bucket. The class exists from G0 because Wrangler
 * validates that every declared Durable Object binding maps to an exported
 * class at bundle time.
 */
export class RateLimiter extends DurableObject<Env> {
  async check(): Promise<{ allowed: boolean; retryAfter: number }> {
    return { allowed: true, retryAfter: 0 };
  }
}
