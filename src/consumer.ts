import type { ClickEvent, Env } from "./types";

const INSERT = `INSERT OR IGNORE INTO click_events
  (id, link_id, ts, country, referrer_host, device, ip_hash, is_bot)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`;

const CHUNK_SIZE = 50;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isValidClickEvent(value: unknown): value is ClickEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.link_id === "string" &&
    event.link_id.length > 0 &&
    Number.isInteger(event.ts) &&
    isNullableString(event.country) &&
    isNullableString(event.referrer_host) &&
    typeof event.device === "string" &&
    typeof event.ip_hash === "string" &&
    (event.is_bot === 0 || event.is_bot === 1)
  );
}

function statementFor(db: D1Database, event: ClickEvent): D1PreparedStatement {
  return db
    .prepare(INSERT)
    .bind(
      event.id,
      event.link_id,
      event.ts,
      event.country,
      event.referrer_host,
      event.device,
      event.ip_hash,
      event.is_bot,
    );
}

/**
 * Idempotent queue consumer. `INSERT OR IGNORE` on the event UUID makes queue
 * redelivery harmless. Valid messages are acknowledged per chunk; a transient
 * D1 failure retries only the affected chunk. Malformed messages are dropped
 * and acknowledged so they cannot poison the queue forever.
 */
export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  let inserted = 0;
  let dropped = 0;
  const valid: Array<{ message: Message<unknown>; event: ClickEvent }> = [];

  for (const message of batch.messages) {
    if (!isValidClickEvent(message.body)) {
      dropped++;
      message.ack();
      continue;
    }
    valid.push({ message, event: message.body });
  }

  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE);
    try {
      const results = await env.DB.batch(chunk.map(({ event }) => statementFor(env.DB, event)));
      inserted += results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
      for (const { message } of chunk) message.ack();
    } catch (error) {
      console.error("click batch insert failed; retrying chunk", error);
      for (const { message } of chunk) message.retry();
    }
  }

  console.log(
    JSON.stringify({
      event: "queue.consumer",
      messages: batch.messages.length,
      accepted: valid.length,
      inserted,
      duplicates: valid.length - inserted,
      dropped,
    }),
  );
}
