"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8787";
const TOKEN_KEY = "edgelink.adminToken";

interface LinkDto {
  id: string;
  slug: string;
  target: string;
  clicks: number;
  max_clicks: number | null;
  expires_at: number | null;
  has_password: boolean;
  active: boolean;
  version: number;
  created_at: number;
}

interface SeriesPoint {
  day: string;
  clicks: number;
  uniques: number;
  bots: number;
}

interface NamedCount {
  name: string;
  clicks: number;
}

interface Analytics {
  slug: string;
  days: number;
  totals: { clicks: number; uniques: number; bots: number; bot_share: number };
  series: SeriesPoint[];
  top_referrers: NamedCount[];
  device_split: NamedCount[];
}

function shortUrl(slug: string): string {
  return `${API_BASE}/${slug}`;
}

function Chart({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) return <p className="empty">No clicks recorded in this window.</p>;
  const max = Math.max(1, ...series.map((point) => point.clicks));
  const width = 720;
  const height = 190;
  const padding = { left: 8, right: 8, top: 14, bottom: 26 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slot = plotWidth / series.length;
  const barWidth = Math.max(2, Math.min(38, slot * 0.62));

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Clicks per day"
    >
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line
          key={fraction}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight * (1 - fraction)}
          y2={padding.top + plotHeight * (1 - fraction)}
          stroke="#26303b"
          strokeDasharray="3 5"
        />
      ))}
      <text x={padding.left} y={10}>
        {max}
      </text>
      {series.map((point, index) => {
        const barHeight = (point.clicks / max) * plotHeight;
        const x = padding.left + index * slot + (slot - barWidth) / 2;
        const y = padding.top + plotHeight - barHeight;
        return (
          <g key={point.day}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(1, barHeight)}
              rx={3}
              fill="#7cf5c8"
              opacity={0.85}
            />
            {index % Math.ceil(series.length / 8) === 0 ? (
              <text x={x + barWidth / 2} y={height - 8} textAnchor="middle">
                {point.day.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function Page() {
  const [token, setToken] = useState("");
  const [links, setLinks] = useState<LinkDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ target: "https://example.com", slug: "", maxClicks: "" });

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text.slice(0, 160)}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
    [token],
  );

  const loadLinks = useCallback(async () => {
    setError(null);
    try {
      const body = await request<{ links: LinkDto[] }>("/v1/links");
      setLinks(body.links);
      setSelected((current) => current ?? body.links[0]?.slug ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [request]);

  useEffect(() => {
    if (token) void loadLinks();
  }, [token, loadLinks]);

  useEffect(() => {
    if (!token || !selected) {
      setAnalytics(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const body = await request<Analytics>(
          `/v1/links/${encodeURIComponent(selected)}/analytics?days=${days}`,
        );
        if (!cancelled) setAnalytics(body);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selected, days, request]);

  function saveToken() {
    sessionStorage.setItem(TOKEN_KEY, token);
    setError(null);
    void loadLinks();
  }

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { target: form.target };
      if (form.slug.trim()) body.slug = form.slug.trim();
      if (form.maxClicks.trim()) body.max_clicks = Number(form.maxClicks);
      await request("/v1/links", { method: "POST", body: JSON.stringify(body) });
      setForm((current) => ({ ...current, slug: "", maxClicks: "" }));
      await loadLinks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const selectedLink = links.find((link) => link.slug === selected) ?? null;

  return (
    <main>
      <header>
        <p className="mono sub" style={{ marginBottom: 10 }}>
          EDGELINK · EDGE ANALYTICS
        </p>
        <h1>Clicks that survive bots, caps, and bursts.</h1>
        <p className="sub">
          Reads aggregated rollups only. API: <span className="mono">{API_BASE}</span>
        </p>
      </header>

      <section className="panel" style={{ marginTop: 24 }}>
        <h2>Admin token</h2>
        <div className="row">
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ADMIN_TOKEN (kept in sessionStorage)"
            aria-label="Admin token"
          />
          <button type="button" onClick={saveToken} disabled={!token}>
            Connect
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
      </section>

      <div className="grid split" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Links</h2>
          {links.length === 0 ? (
            <p className="empty">No links yet. Create one below.</p>
          ) : (
            <ul className="links">
              {links.map((link) => (
                <li key={link.id}>
                  <button
                    type="button"
                    aria-pressed={link.slug === selected}
                    onClick={() => setSelected(link.slug)}
                  >
                    <span className="mono">/{link.slug}</span>
                    <small>
                      {link.clicks} clicks · {link.target}
                      {link.max_clicks ? ` · cap ${link.max_clicks}` : ""}
                      {link.active ? "" : " · deleted"}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Create link</h2>
          <form onSubmit={createLink} className="grid" style={{ gap: 10 }}>
            <input
              value={form.target}
              onChange={(event) => setForm({ ...form, target: event.target.value })}
              placeholder="https://example.com/page"
              aria-label="Target URL"
              required
            />
            <div className="row">
              <input
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
                placeholder="custom-slug (optional)"
                aria-label="Custom slug"
                pattern="[a-zA-Z0-9_-]{3,32}"
              />
              <input
                value={form.maxClicks}
                onChange={(event) => setForm({ ...form, maxClicks: event.target.value })}
                placeholder="max clicks"
                aria-label="Max clicks"
                inputMode="numeric"
              />
            </div>
            <button type="submit" disabled={busy || !token}>
              {busy ? "Creating…" : "Create link"}
            </button>
          </form>
        </section>
      </div>

      {selectedLink ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>30-day analytics · /{selectedLink.slug}</h2>
          <div className="row" style={{ marginBottom: 14 }}>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Window"
              style={{
                background: "var(--panel-2)",
                color: "var(--text)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
            <a
              className="mono sub"
              href={shortUrl(selectedLink.slug)}
              target="_blank"
              rel="noreferrer"
            >
              {shortUrl(selectedLink.slug)}
            </a>
          </div>

          {analytics ? (
            <>
              <div className="stats">
                <div className="stat">
                  <span>Clicks</span>
                  <strong>{analytics.totals.clicks}</strong>
                </div>
                <div className="stat">
                  <span>Uniques</span>
                  <strong>{analytics.totals.uniques}</strong>
                </div>
                <div className="stat">
                  <span>Bots</span>
                  <strong>{analytics.totals.bots}</strong>
                </div>
                <div className="stat">
                  <span>Bot share</span>
                  <strong>{(analytics.totals.bot_share * 100).toFixed(1)}%</strong>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <Chart series={analytics.series} />
              </div>

              <div className="grid split" style={{ marginTop: 18 }}>
                <div>
                  <h3 className="mono sub">Top referrers</h3>
                  {analytics.top_referrers.length === 0 ? (
                    <p className="empty">No referrers yet.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Host</th>
                          <th className="num">Clicks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.top_referrers.map((row) => (
                          <tr key={row.name}>
                            <td>{row.name}</td>
                            <td className="num">{row.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div>
                  <h3 className="mono sub">Devices</h3>
                  {analytics.device_split.length === 0 ? (
                    <p className="empty">No device data yet.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th className="num">Clicks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.device_split.map((row) => (
                          <tr key={row.name}>
                            <td>{row.name}</td>
                            <td className="num">{row.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="empty">Loading analytics…</p>
          )}
        </section>
      ) : null}

      <p className="foot">
        Rollups are recomputed hourly from raw events, so the current hour may be empty until the
        cron runs or a backfill is triggered. Local Miniflare numbers are not edge numbers.
      </p>
    </main>
  );
}
