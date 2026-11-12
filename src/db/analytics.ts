import { DAY_SECONDS } from "../cron";

export interface SeriesPoint {
  day: string;
  clicks: number;
  uniques: number;
  bots: number;
}

export interface NamedCount {
  name: string;
  clicks: number;
}

export interface AnalyticsTotals {
  clicks: number;
  uniques: number;
  bots: number;
  bot_share: number;
}

export interface AnalyticsResult {
  totals: AnalyticsTotals;
  series: SeriesPoint[];
  top_referrers: NamedCount[];
  device_split: NamedCount[];
}

interface BucketRow {
  bucket_hour: number;
  clicks: number;
  uniques: number;
  bots: number;
}

/**
 * Reads rollups only. No raw-event scans on the dashboard path, so queries stay
 * bounded by the number of hours in the window rather than clicks.
 *
 * `uniques` is the sum of per-hour distinct hashes; a visitor active across
 * hours can be counted once per hour. That is documented and intentional.
 */
export async function getAnalytics(
  db: D1Database,
  linkId: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<AnalyticsResult> {
  const [buckets, referrers, devices] = await Promise.all([
    db
      .prepare(
        `SELECT bucket_hour, clicks, uniques, bots
         FROM rollups
         WHERE link_id = ?1 AND bucket_hour >= ?2 AND bucket_hour < ?3
         ORDER BY bucket_hour ASC`,
      )
      .bind(linkId, fromSeconds, toSeconds)
      .all<BucketRow>(),
    db
      .prepare(
        `SELECT referrer_host AS name, SUM(clicks) AS clicks
         FROM referrer_rollups
         WHERE link_id = ?1 AND bucket_hour >= ?2 AND bucket_hour < ?3
         GROUP BY referrer_host
         ORDER BY clicks DESC, name ASC
         LIMIT 10`,
      )
      .bind(linkId, fromSeconds, toSeconds)
      .all<NamedCount>(),
    db
      .prepare(
        `SELECT device AS name, SUM(clicks) AS clicks
         FROM device_rollups
         WHERE link_id = ?1 AND bucket_hour >= ?2 AND bucket_hour < ?3
         GROUP BY device
         ORDER BY clicks DESC, name ASC`,
      )
      .bind(linkId, fromSeconds, toSeconds)
      .all<NamedCount>(),
  ]);

  const byDay = new Map<number, SeriesPoint>();
  let clicks = 0;
  let uniques = 0;
  let bots = 0;
  for (const row of buckets.results) {
    clicks += row.clicks;
    uniques += row.uniques;
    bots += row.bots;
    const dayStart = Math.floor(row.bucket_hour / DAY_SECONDS) * DAY_SECONDS;
    const point = byDay.get(dayStart) ?? {
      day: new Date(dayStart * 1000).toISOString().slice(0, 10),
      clicks: 0,
      uniques: 0,
      bots: 0,
    };
    point.clicks += row.clicks;
    point.uniques += row.uniques;
    point.bots += row.bots;
    byDay.set(dayStart, point);
  }

  return {
    totals: {
      clicks,
      uniques,
      bots,
      bot_share: clicks === 0 ? 0 : bots / clicks,
    },
    series: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    top_referrers: referrers.results,
    device_split: devices.results,
  };
}
