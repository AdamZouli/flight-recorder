import type { DatabaseSync } from "node:sqlite";
import { newId } from "./id.ts";
import type {
  EventKind,
  FlightEvent,
  QueryEvents,
  Severity,
} from "./types.ts";

type EventRow = {
  id: string;
  ts: number;
  kind: EventKind;
  title: string;
  detail: string | null;
  pid: number | null;
  severity: Severity;
};

export type NewEvent = {
  ts?: number;
  kind: EventKind;
  title: string;
  detail?: Record<string, unknown> | null;
  pid?: number | null;
  severity?: Severity;
};

export class EventStore {
  db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insert(input: NewEvent): FlightEvent {
    const event: FlightEvent = {
      id: newId(),
      ts: input.ts ?? Date.now(),
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? null,
      pid: input.pid ?? null,
      severity: input.severity ?? "info",
    };
    this.db
      .prepare(
        "INSERT INTO events (id, ts, kind, title, detail, pid, severity) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.ts,
        event.kind,
        event.title,
        event.detail ? JSON.stringify(event.detail) : null,
        event.pid,
        event.severity,
      );
    return event;
  }

  get(id: string): FlightEvent | null {
    const row = this.db
      .prepare(
        "SELECT id, ts, kind, title, detail, pid, severity FROM events WHERE id = ?",
      )
      .get(id) as EventRow | undefined;
    return row ? fromRow(row) : null;
  }

  nearby(id: string, windowMs = 2 * 60 * 1000): FlightEvent[] {
    const event = this.get(id);
    if (!event) return [];
    const from = event.ts - windowMs;
    const to = event.ts + windowMs;
    const rows = this.db
      .prepare(
        "SELECT id, ts, kind, title, detail, pid, severity FROM events WHERE ts >= ? AND ts <= ? ORDER BY ts DESC, id DESC",
      )
      .all(from, to) as EventRow[];
    return rows.map(fromRow);
  }

  query(opts: QueryEvents = {}): FlightEvent[] {
    const limit = clamp(opts.limit ?? 100, 1, 500);
    const params: unknown[] = [];
    const where: string[] = [];

    if (opts.from != null) {
      where.push("ts >= ?");
      params.push(opts.from);
    }
    if (opts.to != null) {
      where.push("ts <= ?");
      params.push(opts.to);
    }
    if (opts.beforeTs != null && opts.beforeId) {
      where.push("(ts < ? OR (ts = ? AND id < ?))");
      params.push(opts.beforeTs, opts.beforeTs, opts.beforeId);
    }
    if (opts.kinds && opts.kinds.length > 0) {
      where.push(`kind IN (${opts.kinds.map(() => "?").join(", ")})`);
      params.push(...opts.kinds);
    }
    if (opts.q && opts.q.trim()) {
      const like = `%${escapeLike(opts.q.trim())}%`;
      where.push(
        "(title LIKE ? ESCAPE '\\' OR IFNULL(detail, '') LIKE ? ESCAPE '\\')",
      );
      params.push(like, like);
    }

    const sql = `SELECT id, ts, kind, title, detail, pid, severity FROM events${
      where.length ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY ts DESC, id DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map(fromRow);
  }

  exportSince(fromTs: number): FlightEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, ts, kind, title, detail, pid, severity FROM events WHERE ts >= ? ORDER BY ts DESC, id DESC",
      )
      .all(fromTs) as EventRow[];
    return rows.map(fromRow);
  }

  prune(olderThanTs: number): number {
    const result = this.db
      .prepare("DELETE FROM events WHERE ts < ?")
      .run(olderThanTs);
    return Number(result.changes ?? 0);
  }

  wipe(): void {
    this.db.exec("DELETE FROM events");
    this.db.exec("VACUUM");
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as {
      n: number;
    };
    return Number(row.n);
  }
}

function fromRow(row: EventRow): FlightEvent {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail) as Record<string, unknown>;
    } catch {
      detail = { raw: row.detail };
    }
  }
  return {
    id: row.id,
    ts: Number(row.ts),
    kind: row.kind,
    title: row.title,
    detail,
    pid: row.pid == null ? null : Number(row.pid),
    severity: row.severity,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
