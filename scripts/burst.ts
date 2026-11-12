/** Sends a 500-request burst from one IP and checks isolation for a second IP. */
export {};

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const BURST_IP = "198.51.100.250";
const OTHER_IP = "198.51.100.251";
const count = Number(process.env.BURST ?? 500);
const concurrency = Number(process.env.CONCURRENCY ?? 50);

const created = await fetch(`${BASE}/v1/links`, {
  method: "POST",
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ slug: "burst-demo", target: "https://example.com/burst" }),
});
if (created.status !== 201 && created.status !== 409) {
  throw new Error(`burst link failed: ${created.status} ${await created.text()}`);
}

const statuses = new Map<number, number>();
let retryAfterSeen = false;
let cursor = 0;

async function worker(): Promise<void> {
  for (;;) {
    const index = cursor++;
    if (index >= count) return;
    const res = await fetch(`${BASE}/burst-demo`, {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": BURST_IP,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36",
      },
    });
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    if (res.status === 429 && Number(res.headers.get("retry-after")) > 0) {
      retryAfterSeen = true;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

const other = await fetch(`${BASE}/burst-demo`, {
  redirect: "manual",
  headers: {
    "CF-Connecting-IP": OTHER_IP,
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36",
  },
});

const result = {
  event: "burst",
  requested: count,
  statuses: Object.fromEntries([...statuses.entries()].sort()),
  retryAfterSeen,
  otherIpStatus: other.status,
};
console.log(JSON.stringify(result, null, 2));

if (!retryAfterSeen) throw new Error("no 429 carried Retry-After");
if (other.status !== 302) throw new Error(`other IP was affected: ${other.status}`);
