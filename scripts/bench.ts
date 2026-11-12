/**
 * Cold vs warm redirect benchmark for `wrangler dev` (Miniflare).
 *
 * Start the worker first:
 *   pnpm migrate:local
 *   pnpm dev
 * Then:
 *   pnpm bench
 *
 * Local Miniflare numbers are indicative only. Publish deployed numbers as the
 * headline whenever a real Cloudflare deploy exists.
 */
import autocannon from "autocannon";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const DURATION = Number(process.env.BENCH_SECONDS ?? 8);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 10);
const COLD_SAMPLES = Number(process.env.BENCH_COLD_SAMPLES ?? 300);
const COLD_CONCURRENCY = Number(process.env.BENCH_COLD_CONCURRENCY ?? 20);

interface Sample {
  latencyMs: number;
  status: number;
  cache: string;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function summarize(samples: Sample[]) {
  const latencies = samples.map((sample) => sample.latencyMs);
  const hits = samples.filter((sample) => sample.cache === "HIT").length;
  const statuses: Record<string, number> = {};
  for (const sample of samples) {
    statuses[String(sample.status)] = (statuses[String(sample.status)] ?? 0) + 1;
  }
  return {
    samples: samples.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    cacheHitRate: samples.length === 0 ? 0 : hits / samples.length,
    statuses,
  };
}

async function createLink(slug: string, target: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug, target }),
  });
  if (res.status !== 201) {
    throw new Error(`create ${slug} failed: ${res.status} ${await res.text()}`);
  }
}

async function coldRun(): Promise<Sample[]> {
  const stamp = Date.now().toString(36);
  const slugs = Array.from({ length: COLD_SAMPLES }, (_, i) => `bc-${stamp}-${i}`);
  for (let i = 0; i < slugs.length; i += 20) {
    await Promise.all(
      slugs.slice(i, i + 20).map((slug) => createLink(slug, "https://example.com")),
    );
  }

  const samples: Sample[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const slug = slugs[index];
      if (!slug) return;
      const started = performance.now();
      const res = await fetch(`${BASE}/${slug}`, { redirect: "manual" });
      samples.push({
        latencyMs: performance.now() - started,
        status: res.status,
        cache: res.headers.get("x-cache") ?? "UNKNOWN",
      });
    }
  }
  await Promise.all(Array.from({ length: COLD_CONCURRENCY }, worker));
  return samples;
}

async function warmRun(): Promise<{
  slug: string;
  autocannon: {
    requestsPerSecond: number;
    p50Ms: number;
    p90Ms: number;
    p99Ms: number;
    errors: number;
  };
  probe: ReturnType<typeof summarize>;
}> {
  const slug = `bw-${Date.now().toString(36)}`;
  await createLink(slug, "https://example.com");
  await fetch(`${BASE}/${slug}`, { redirect: "manual" }); // warm

  const result = await autocannon({
    url: `${BASE}/${slug}`,
    connections: CONNECTIONS,
    duration: DURATION,
    // @ts-expect-error autocannon follows redirects by default and types omit this.
    followRedirects: false,
  });

  const probe: Sample[] = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    const res = await fetch(`${BASE}/${slug}`, { redirect: "manual" });
    probe.push({
      latencyMs: performance.now() - started,
      status: res.status,
      cache: res.headers.get("x-cache") ?? "UNKNOWN",
    });
  }

  return {
    slug,
    autocannon: {
      requestsPerSecond: result.requests.average,
      p50Ms: result.latency.p50,
      p90Ms: result.latency.p90,
      p99Ms: result.latency.p99,
      errors: result.errors + result.timeouts,
    },
    probe: summarize(probe),
  };
}

const cold = summarize(await coldRun());
const warm = await warmRun();

const report = {
  generatedAt: new Date().toISOString(),
  runtime: "wrangler dev (Miniflare, local machine)",
  caveat: "Local numbers are indicative; not edge measurements.",
  config: {
    durationSeconds: DURATION,
    connections: CONNECTIONS,
    coldSamples: COLD_SAMPLES,
    coldConcurrency: COLD_CONCURRENCY,
  },
  cold,
  warm,
};

const outPath = resolve(
  process.env.BENCH_OUT ?? `docs/bench/local-${new Date().toISOString().slice(0, 10)}.json`,
);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);
