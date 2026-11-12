/**
 * Generates 1,000 redirects across three demo links with mixed IPs and user
 * agents, then reports status counts. Used by scripts/walkthrough.ps1.
 */
export {};

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const slugs = ["demo-alpha", "demo-beta", "demo-gamma"];
const total = Number(process.env.CLICKS ?? 1000);
const concurrency = Number(process.env.CONCURRENCY ?? 25);

const userAgents = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  "curl/8.5.0",
];

for (const slug of slugs) {
  const res = await fetch(`${BASE}/v1/links`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ slug, target: `https://example.com/${slug}` }),
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`seed ${slug} failed: ${res.status} ${await res.text()}`);
  }
}

const counts = new Map<number, number>();
let cursor = 0;

async function worker(): Promise<void> {
  for (;;) {
    const index = cursor++;
    if (index >= total) return;
    const slug = slugs[index % slugs.length];
    const res = await fetch(`${BASE}/${slug}`, {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": `203.0.113.${(index % 250) + 1}`,
        "User-Agent": userAgents[index % userAgents.length] ?? userAgents[0]!,
        Referer: index % 2 === 0 ? "https://news.example/story" : "",
      },
    });
    counts.set(res.status, (counts.get(res.status) ?? 0) + 1);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(
  JSON.stringify(
    { event: "load_clicks", total, statuses: Object.fromEntries([...counts.entries()].sort()) },
    null,
    2,
  ),
);
