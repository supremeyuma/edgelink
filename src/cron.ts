import type { Env } from "./types";

export const HOUR_SECONDS = 3600;
export const DAY_SECONDS = 86_400;
export const RAW_RETENTION_DAYS = 30;
export const ROLLUP_RETENTION_DAYS = 400;

export function hourFloor(timestamp: number): number {
  return Math.floor(timestamp / HOUR_SECONDS) * HOUR_SECONDS;
}

/**
 * Recomputes one completed hour from raw events. Delete-then-insert inside a
 * D1 batch (a transaction) makes the operation idempotent: a cron rerun or a
 * backfill after late-arriving events produces identical totals.
 */
export async function runHourlyRollup(env: Env, bucketHour: number): Promise<void> {
  const bucket = hourFloor(bucketHour);
  const end = bucket + HOUR_SECONDS;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM rollups WHERE bucket_hour = ?1").bind(bucket),
    env.DB.prepare(
      `INSERT INTO rollups (link_id, bucket_hour, clicks, uniques, bots)
       SELECT link_id, ?1, COUNT(*),
              COUNT(DISTINCT CASE WHEN is_bot = 0 THEN ip_hash END),
              COALESCE(SUM(is_bot), 0)
       FROM click_events
       WHERE ts >= ?2 AND ts < ?3
       GROUP BY link_id`,
    ).bind(bucket, bucket, end),
    env.DB.prepare("DELETE FROM referrer_rollups WHERE bucket_hour = ?1").bind(bucket),
    env.DB.prepare(
      `INSERT INTO referrer_rollups (link_id, bucket_hour, referrer_host, clicks)
       SELECT link_id, ?1, COALESCE(NULLIF(referrer_host, ''), 'direct'), COUNT(*)
       FROM click_events
       WHERE ts >= ?2 AND ts < ?3
       GROUP BY link_id, COALESCE(NULLIF(referrer_host, ''), 'direct')`,
    ).bind(bucket, bucket, end),
    env.DB.prepare("DELETE FROM device_rollups WHERE bucket_hour = ?1").bind(bucket),
    env.DB.prepare(
      `INSERT INTO device_rollups (link_id, bucket_hour, device, clicks)
       SELECT link_id, ?1, device, COUNT(*)
       FROM click_events
       WHERE ts >= ?2 AND ts < ?3
       GROUP BY link_id, device`,
    ).bind(bucket, bucket, end),
  ]);
}

/** Backfills the N completed hours before `nowSeconds`, optionally the current partial hour. */
export async function runBackfill(
  env: Env,
  hours: number,
  nowSeconds: number,
  includeCurrent = false,
): Promise<number[]> {
  const currentHour = hourFloor(nowSeconds);
  const buckets: number[] = [];
  for (let i = hours; i >= 1; i--) {
    const bucket = currentHour - i * HOUR_SECONDS;
    await runHourlyRollup(env, bucket);
    buckets.push(bucket);
  }
  if (includeCurrent) {
    await runHourlyRollup(env, currentHour);
    buckets.push(currentHour);
  }
  return buckets;
}

export interface MaintenanceResult {
  prunedEvents: number;
  prunedRollups: number;
  prunedDimensions: number;
  reconcileMismatches: number;
}

/**
 * Daily retention. Raw events are useful for 30 days; hourly rollups for 400.
 * `links.clicks` is the cap authority and is never rewritten here — mismatches
 * are logged for an operator because pruning legitimately makes raw counts a
 * lower bound over time.
 */
export async function runDailyMaintenance(
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MaintenanceResult> {
  const rawCutoff = nowSeconds - RAW_RETENTION_DAYS * DAY_SECONDS;
  const rollupCutoff = hourFloor(nowSeconds - ROLLUP_RETENTION_DAYS * DAY_SECONDS);

  const pruneRollups = await env.DB.prepare("DELETE FROM rollups WHERE bucket_hour < ?1")
    .bind(rollupCutoff)
    .run();
  const pruneReferrers = await env.DB.prepare("DELETE FROM referrer_rollups WHERE bucket_hour < ?1")
    .bind(rollupCutoff)
    .run();
  const pruneDevices = await env.DB.prepare("DELETE FROM device_rollups WHERE bucket_hour < ?1")
    .bind(rollupCutoff)
    .run();
  const pruneEvents = await env.DB.prepare("DELETE FROM click_events WHERE ts < ?1")
    .bind(rawCutoff)
    .run();

  const mismatches = await env.DB.prepare(
    `SELECT l.id, l.slug, l.clicks,
            COALESCE((SELECT COUNT(*) FROM click_events e WHERE e.link_id = l.id), 0) AS events
     FROM links l
     WHERE l.clicks != COALESCE((SELECT COUNT(*) FROM click_events e WHERE e.link_id = l.id), 0)`,
  ).all<{ id: string; slug: string; clicks: number; events: number }>();

  if (mismatches.results.length > 0) {
    console.warn(
      JSON.stringify({
        event: "cron.reconcile_mismatch",
        count: mismatches.results.length,
        sample: mismatches.results.slice(0, 5),
        note: "raw events are pruned after 30 days; links.clicks remains the cap authority",
      }),
    );
  }

  return {
    prunedEvents: pruneEvents.meta.changes ?? 0,
    prunedRollups: pruneRollups.meta.changes ?? 0,
    prunedDimensions: (pruneReferrers.meta.changes ?? 0) + (pruneDevices.meta.changes ?? 0),
    reconcileMismatches: mismatches.results.length,
  };
}

export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const now = Math.floor(controller.scheduledTime / 1000);
  if (controller.cron === "0 * * * *") {
    const previousHour = hourFloor(now) - HOUR_SECONDS;
    await runHourlyRollup(env, previousHour);
    console.log(JSON.stringify({ event: "cron.rollup", bucket: previousHour }));
    return;
  }
  if (controller.cron === "15 3 * * *") {
    const result = await runDailyMaintenance(env, now);
    console.log(JSON.stringify({ event: "cron.maintenance", ...result }));
    return;
  }
  console.warn(JSON.stringify({ event: "cron.unknown", cron: controller.cron }));
}
