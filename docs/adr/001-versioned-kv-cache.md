# ADR 001: Versioned KV cache in front of D1 for redirects

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** EdgeLink build

## Context

Redirects must stay fast during bursts while link updates, expiry, and click caps must remain
correct. Cloudflare KV is eventually consistent (up to ~60 s across locations) and has no
compare-and-swap; D1 is strongly consistent but every read is a billed row read and adds
latency. The plan requires "a PATCH is visible on the next request" and "no stale success after
cap/expiry".

## Options considered

1. **D1 only** — always read the link row from D1. Correct and simple, but pays a row read on
   every redirect and cannot absorb hot-link bursts as cheaply.
2. **KV with a mutable value** — one `link:{slug}` key overwritten on update. Simple, but a
   late-arriving stale write could clobber a newer value and there is no version to tell.
3. **Versioned KV keys plus a pointer** — `link:ptr:{slug}` stores the current version;
   `link:v{n}:{slug}` stores the payload with a 300 s TTL. Admin mutations bump
   `links.version` in D1 and write through the new pointer synchronously. Old keys expire.

## Decision

Option 3, with one important constraint: **the cache never authorizes a redirect by itself**.
Every successful cache path still executes the atomic `UPDATE links ... RETURNING target`
statement, which re-checks active/expiry/cap and increments clicks. The cache removes the D1
**read**; D1 remains the authority for the write and the counter.

Negative lookups are cached as `miss:{slug}` for 60 s (KV's minimum TTL) and cleared on create.

## Consequences

- Positive: warm redirects skip a D1 read; PATCH/delete are visible on the next request because
  the pointer changes; old versions expire without key enumeration.
- Negative: the atomic write still dominates warm latency. Our local benchmark shows p95
  ~9.9 ms warm vs ~475 ms cold under 20-way concurrency, but both include a D1 write. This is
  documented instead of claiming the cache makes redirects "free".
- Negative: a reader in another location can see the old pointer until KV propagates. The
  atomic D1 check still prevents stale success (caps/expiry), but an updated **target** may be
  briefly stale in remote locations. Accepted for a short-link service.
- Revisit if D1 write latency becomes the bottleneck or if KV read replication makes pointer
  staleness visible in product behavior.

## Links

`src/lib/cache.ts`, `src/routes/redirect.ts`, `docs/bench/README.md`, `test/workers/cache.test.ts`.
