import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClickEvent } from "../../src/types";
import { isValidClickEvent, handleQueue } from "../../src/consumer";
import { hourFloor, runDailyMaintenance, runHourlyRollup, DAY_SECONDS } from "../../src/cron";
import { buildClickEvent } from "../../src/lib/click";
import { hashIp } from "../../src/lib/ip";
import { createLinkViaApi, fetchWorker, resetDb, testEnv } from "../helpers";

const BASE_TS = 1_900_000_000; // fixed completed hour: 2026-03-15T? UTC
const BUCKET = hourFloor(BASE_TS);

beforeEach(resetDb);

function makeEvent(id: string, linkId: string, overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    id,
    link_id: linkId,
    ts: BASE_TS,
    country: "GB",
    referrer_host: "news.example",
    device: "desktop",
    ip_hash: `hash-${id}`,
    is_bot: 0,
    ...overrides,
  };
}

async function runMessages(events: unknown[]): Promise<void> {
  const batch = createMessageBatch<unknown>(
    "edgelink-clicks",
    events.map((body, index) => ({
      id: `msg-${index}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(BASE_TS * 1000),
      attempts: 1,
      body,
    })),
  );
  await handleQueue(batch, testEnv);
  await getQueueResult(batch, createExecutionContext());
}

async function countEvents(): Promise<number> {
  const row = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM click_events").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

describe("queue consumer", () => {
  it("validates event shape", () => {
    expect(isValidClickEvent(makeEvent("a", "l"))).toBe(true);
    for (const bad of [
      null,
      {},
      { ...makeEvent("a", "l"), id: "" },
      { ...makeEvent("a", "l"), ts: "now" },
      { ...makeEvent("a", "l"), is_bot: 2 },
      { ...makeEvent("a", "l"), ip_hash: null },
    ]) {
      expect(isValidClickEvent(bad)).toBe(false);
    }
  });

  it("inserts 1,000 events across three links and ignores duplicates", async () => {
    const events: ClickEvent[] = [];
    const layout = [
      { link: "link-a", count: 500 },
      { link: "link-b", count: 300 },
      { link: "link-c", count: 200 },
    ];
    let seq = 0;
    for (const { link, count } of layout) {
      for (let i = 0; i < count; i++) {
        seq++;
        events.push(
          makeEvent(`evt-${seq}`, link, {
            ip_hash: `hash-${seq % 40}`,
            is_bot: seq % 10 === 0 ? 1 : 0,
            device: seq % 3 === 0 ? "mobile" : "desktop",
            referrer_host: seq % 2 === 0 ? "news.example" : null,
          }),
        );
      }
    }

    for (let i = 0; i < events.length; i += 100) {
      await runMessages(events.slice(i, i + 100));
    }
    expect(await countEvents()).toBe(1000);

    // Redelivery of a chunk must not inflate counts.
    await runMessages(events.slice(0, 100));
    expect(await countEvents()).toBe(1000);

    // Malformed messages are dropped, not retried forever.
    await runMessages([{ nonsense: true }, makeEvent("evt-extra", "link-a")]);
    expect(await countEvents()).toBe(1001);
  });
});

describe("hourly rollups", () => {
  it("recomputes exact totals and is idempotent", async () => {
    const events: ClickEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push(
        makeEvent(`r-${i}`, i < 60 ? "link-a" : "link-b", {
          ip_hash: `ip-${i % 7}`,
          is_bot: i % 5 === 0 ? 1 : 0,
        }),
      );
    }
    await runMessages(events);

    await runHourlyRollup(testEnv, BUCKET);
    const first = await testEnv.DB.prepare("SELECT * FROM rollups ORDER BY link_id").all();
    expect(first.results).toEqual([
      { link_id: "link-a", bucket_hour: BUCKET, clicks: 60, uniques: 7, bots: 12 },
      { link_id: "link-b", bucket_hour: BUCKET, clicks: 40, uniques: 7, bots: 8 },
    ]);

    await runHourlyRollup(testEnv, BUCKET);
    const second = await testEnv.DB.prepare("SELECT * FROM rollups ORDER BY link_id").all();
    expect(second.results).toEqual(first.results);
  });

  it("backfills a closed bucket after a late event", async () => {
    await runMessages([makeEvent("late-1", "link-a", { ip_hash: "ip-1" })]);
    await runHourlyRollup(testEnv, BUCKET);
    let row = await testEnv.DB.prepare("SELECT clicks, uniques FROM rollups").first<{
      clicks: number;
      uniques: number;
    }>();
    expect(row).toEqual({ clicks: 1, uniques: 1 });

    await runMessages([
      makeEvent("late-2", "link-a", { ip_hash: "ip-2" }),
      makeEvent("late-3", "link-a", { ip_hash: "ip-1" }),
    ]);
    await runHourlyRollup(testEnv, BUCKET);
    row = await testEnv.DB.prepare("SELECT clicks, uniques FROM rollups").first<{
      clicks: number;
      uniques: number;
    }>();
    expect(row).toEqual({ clicks: 3, uniques: 2 });
  });

  it("keeps referrer and device dimensions in rollups", async () => {
    await runMessages([
      makeEvent("d-1", "link-a", { referrer_host: "news.example", device: "mobile" }),
      makeEvent("d-2", "link-a", { referrer_host: "news.example", device: "desktop" }),
      makeEvent("d-3", "link-a", { referrer_host: null, device: "desktop" }),
    ]);
    await runHourlyRollup(testEnv, BUCKET);

    const refs = await testEnv.DB.prepare(
      "SELECT referrer_host AS name, clicks FROM referrer_rollups ORDER BY name",
    ).all();
    expect(refs.results).toEqual([
      { name: "direct", clicks: 1 },
      { name: "news.example", clicks: 2 },
    ]);

    const devices = await testEnv.DB.prepare(
      "SELECT device AS name, clicks FROM device_rollups ORDER BY name",
    ).all();
    expect(devices.results).toEqual([
      { name: "desktop", clicks: 2 },
      { name: "mobile", clicks: 1 },
    ]);
  });
});

describe("retention", () => {
  it("prunes only rows older than the retention windows", async () => {
    const now = BASE_TS;
    const oldEventTs = now - 31 * DAY_SECONDS;
    const freshEventTs = now - DAY_SECONDS;
    const oldBucket = hourFloor(now - 401 * DAY_SECONDS);
    const freshBucket = hourFloor(now - DAY_SECONDS);

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO click_events (id, link_id, ts, country, referrer_host, device, ip_hash, is_bot)
         VALUES ('old', 'link-a', ?1, NULL, NULL, 'desktop', 'h', 0),
                ('fresh', 'link-a', ?2, NULL, NULL, 'desktop', 'h', 0)`,
      ).bind(oldEventTs, freshEventTs),
      testEnv.DB.prepare(
        `INSERT INTO rollups (link_id, bucket_hour, clicks, uniques, bots)
         VALUES ('link-a', ?1, 5, 1, 0), ('link-a', ?2, 2, 1, 0)`,
      ).bind(oldBucket, freshBucket),
      testEnv.DB.prepare(
        `INSERT INTO referrer_rollups (link_id, bucket_hour, referrer_host, clicks)
         VALUES ('link-a', ?1, 'old.example', 5), ('link-a', ?2, 'new.example', 2)`,
      ).bind(oldBucket, freshBucket),
      testEnv.DB.prepare(
        `INSERT INTO device_rollups (link_id, bucket_hour, device, clicks)
         VALUES ('link-a', ?1, 'desktop', 5), ('link-a', ?2, 'mobile', 2)`,
      ).bind(oldBucket, freshBucket),
    ]);

    const result = await runDailyMaintenance(testEnv, now);
    expect(result.prunedEvents).toBe(1);
    expect(result.prunedRollups).toBe(1);
    expect(result.prunedDimensions).toBe(2);

    const events = await testEnv.DB.prepare("SELECT id FROM click_events").all();
    expect(events.results).toEqual([{ id: "fresh" }]);
    const rollups = await testEnv.DB.prepare("SELECT bucket_hour FROM rollups").all();
    expect(rollups.results).toEqual([{ bucket_hour: freshBucket }]);
  });
});

describe("analytics API", () => {
  it("serves totals, series, referrers, and devices from rollups only", async () => {
    await createLinkViaApi({ slug: "analytics-link", target: "https://example.com" });
    const now = Math.floor(Date.now() / 1000);
    const bucket = hourFloor(now);
    const link = await testEnv.DB.prepare(
      "SELECT id FROM links WHERE slug = 'analytics-link'",
    ).first<{ id: string }>();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO rollups (link_id, bucket_hour, clicks, uniques, bots)
         VALUES (?1, ?2, 10, 4, 2)`,
      ).bind(link?.id, bucket),
      testEnv.DB.prepare(
        `INSERT INTO referrer_rollups (link_id, bucket_hour, referrer_host, clicks)
         VALUES (?1, ?2, 'news.example', 7), (?1, ?2, 'direct', 3)`,
      ).bind(link?.id, bucket),
      testEnv.DB.prepare(
        `INSERT INTO device_rollups (link_id, bucket_hour, device, clicks)
         VALUES (?1, ?2, 'mobile', 6), (?1, ?2, 'desktop', 4)`,
      ).bind(link?.id, bucket),
      // Raw events deliberately contradict the rollups; the API must ignore them.
      testEnv.DB.prepare(
        `INSERT INTO click_events (id, link_id, ts, country, referrer_host, device, ip_hash, is_bot)
         VALUES ('raw-1', ?1, ?2, NULL, 'raw.example', 'tablet', 'h', 0)`,
      ).bind(link?.id, now),
    ]);

    const res = await fetchWorker("/v1/links/analytics-link/analytics?days=30", {
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { clicks: number; uniques: number; bots: number; bot_share: number };
      series: Array<{ day: string; clicks: number; uniques: number; bots: number }>;
      top_referrers: Array<{ name: string; clicks: number }>;
      device_split: Array<{ name: string; clicks: number }>;
    };
    expect(body.totals).toEqual({ clicks: 10, uniques: 4, bots: 2, bot_share: 0.2 });
    expect(body.series).toHaveLength(1);
    expect(body.series[0]?.clicks).toBe(10);
    expect(body.top_referrers).toEqual([
      { name: "news.example", clicks: 7 },
      { name: "direct", clicks: 3 },
    ]);
    expect(body.device_split).toEqual([
      { name: "mobile", clicks: 6 },
      { name: "desktop", clicks: 4 },
    ]);
  });

  it("requires auth and returns 404 for unknown links", async () => {
    expect((await fetchWorker("/v1/links/x/analytics")).status).toBe(401);
    const res = await fetchWorker("/v1/links/does-not-exist/analytics", {
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(res.status).toBe(404);
  });
});

describe("redirect click capture", () => {
  it("builds a privacy-safe event from request metadata", async () => {
    const request = {
      headers: new Headers({
        "CF-Connecting-IP": "203.0.113.7",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
        Referer: "https://news.example/story?utm=1",
      }),
      cf: { country: "GB", asn: 64500 },
    } as unknown as Request;

    const event = await buildClickEvent(request, "link-1", testEnv, 1_900_000_000);

    expect(event.link_id).toBe("link-1");
    expect(event.ts).toBe(1_900_000_000);
    expect(event.country).toBe("GB");
    expect(event.referrer_host).toBe("news.example");
    expect(event.device).toBe("mobile");
    expect(event.is_bot).toBe(0);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.ip_hash).not.toBe("203.0.113.7");
    expect(event.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(event.ip_hash).toBe(await hashIp("203.0.113.7", testEnv.IP_HASH_SALT));
    expect(JSON.stringify(event)).not.toContain("203.0.113.7");
  });

  it("classifies common clients without blocking the redirect", async () => {
    const headers = new Headers({ "User-Agent": "curl/8.5.0", "CF-Connecting-IP": "198.51.100.9" });
    const event = await buildClickEvent(
      { headers, cf: undefined } as unknown as Request,
      "link-1",
      testEnv,
    );
    expect(event.is_bot).toBe(1);
    expect(event.country).toBeNull();
    expect(event.referrer_host).toBeNull();

    await createLinkViaApi({ slug: "no-block", target: "https://example.com" });
    const res = await fetchWorker("/no-block");
    expect(res.status).toBe(302);
  });
});
