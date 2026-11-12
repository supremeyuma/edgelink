/**
 * Creates three demo links. Safe to rerun: an existing slug (409) is reported
 * and skipped so a walkthrough can be repeated without manual cleanup.
 */
export {};

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";

const links = [
  { slug: "demo-alpha", target: "https://example.com/alpha" },
  { slug: "demo-beta", target: "https://example.com/beta" },
  { slug: "demo-gamma", target: "https://example.com/gamma" },
];

for (const link of links) {
  const res = await fetch(`${BASE}/v1/links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(link),
  });
  if (res.status === 201) {
    const body = (await res.json()) as { short_url: string };
    console.log(`created ${body.short_url}`);
  } else if (res.status === 409) {
    console.log(`exists  ${BASE}/${link.slug}`);
  } else {
    console.error(`failed ${link.slug}: ${res.status} ${await res.text()}`);
    process.exitCode = 1;
  }
}
