/** Recomputes the last N completed hours through the admin backfill route. */
export {};

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const hours = Number(process.argv[2] ?? process.env.BACKFILL_HOURS ?? 24);

const res = await fetch(`${BASE}/v1/admin/backfill?hours=${hours}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});

if (!res.ok) {
  console.error(`backfill failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(JSON.stringify(await res.json(), null, 2));
