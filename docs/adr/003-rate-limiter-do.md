# ADR 003: Durable Object token bucket over a KV approximation

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** EdgeLink build

## Context

Per-IP throttling needs an atomic read-modify-write. A burst of concurrent requests must not
all read `tokens = 30` and all be allowed. The plan allows cutting the Durable Object for a
KV-based approximate limiter if time is short, but requires documenting the known race.

## Options considered

1. **KV counter** — `get` then `put` with a TTL. Cheap and globally replicated, but KV has no
   compare-and-swap and is eventually consistent. Concurrent requests overshoot; a burst can
   pass many more than the configured token count. Rejected as the primary design.
2. **Durable Object per IP with storage transaction** — single-threaded per object, transaction
   serializes the read-modify-write, state survives restarts. Costs one DO request per redirect
   and creates a hot object for a single abusive IP.
3. **Cloudflare rate-limiting rules / WAF** — excellent at the edge, but outside the
   application, not reproducible locally, and not part of the frozen stack.

## Decision

Option 2. `RateLimiter.check()` runs inside `ctx.storage.transaction`, refilling at
`RATE_LIMIT_PER_MIN / 60000` tokens per ms and capping at `RATE_LIMIT_BURST`. The Worker keys
the object by `HMAC(IP_HASH_SALT, ip)` so the object name does not contain a raw address.

The middleware runs **before** lookup and click counting, returns `429` with `Retry-After`, and
**fails open** if the DO errors: a redirect outage is worse than a temporary loss of throttling.

## Consequences

- Positive: exact burst behavior under concurrency; persisted state; no raw IP in the object
  name.
- Negative: one extra DO round trip on every redirect; a single abusive IP creates a hot object
  whose throughput ceiling is Cloudflare's per-object limit. Documented in
  `docs/failure-modes.md`.
- Negative: fail-open means an attacker who can break the DO binding can bypass throttling.
  Link caps and the target blocklist remain in force.
- Revisit if DO cost or hot-key latency shows up in production before the WAF is enabled.

## Links

`src/durable/rate-limiter.ts`, `src/routes/redirect.ts`, `test/workers/abuse.test.ts`,
`docs/security.md`.
