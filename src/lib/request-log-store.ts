import { isIP } from "node:net";
import { cleanText, shortMessage } from "./request-log";

export const retentionDays = 30;
export const maxStoredRows = 500_000;
export const maxIngestEvents = 200;

export type LogSource = "studio" | "backend";

export type LogRow = {
  ts: Date;
  source: LogSource;
  event: string;
  route: string | null;
  status: number | null;
  ms: number | null;
  projectId: string | null;
  agentId: string | null;
  detail: Record<string, unknown> | null;
};

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value !== "" ? shortMessage(value, max) : null);
const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

function cleanValue(value: unknown): unknown {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(cleanValue);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [cleanText(k), cleanValue(v)]));
  return value;
}

function compact(detail: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of Object.keys(detail)) if (detail[key] === null || detail[key] === undefined) delete detail[key];
  return Object.keys(detail).length ? (cleanValue(detail) as Record<string, unknown>) : null;
}

/** A line Studio logged itself: the fields the page filters on become columns, the rest stays in `detail`. */
export function rowFromEntry(entry: Record<string, unknown>): LogRow {
  const { ts, event, route, status, ms, project_id, agent_id, ...rest } = entry;
  const when = typeof ts === "string" ? new Date(ts) : new Date();
  return {
    ts: Number.isNaN(when.getTime()) ? new Date() : when,
    source: "studio",
    event: text(event, 40) ?? "unknown",
    route: text(route, 200),
    status: whole(status, 100, 599),
    ms: whole(ms, 0, 86_400_000),
    projectId: typeof project_id === "string" && ID.test(project_id) ? project_id : null,
    agentId: typeof agent_id === "string" && ID.test(agent_id) ? agent_id : null,
    detail: compact(rest),
  };
}

const ROUTE = /^[a-z][a-z0-9_.-]{0,39}$/;
const FINGERPRINT = /^[0-9a-f]{8}$/;
const ageLimitMs = 24 * 60 * 60 * 1000;
const clockSkewMs = 5 * 60 * 1000;

function address(value: unknown): string | null {
  return typeof value === "string" && value.length <= 45 && isIP(value) !== 0 ? value : null;
}

/**
 * The events a backend sends. Every field is checked against its own shape and anything else is dropped, so a
 * holder of the runtime token cannot put free text or large values into the table. A timestamp outside
 * the last day (or in the future) is replaced by the receive time.
 */
export function parseBackendEvents(body: unknown, now: Date = new Date()): { rows: LogRow[]; skipped: number } {
  const list = typeof body === "object" && body !== null ? (body as { events?: unknown }).events : undefined;
  if (!Array.isArray(list)) return { rows: [], skipped: 0 };
  const rows: LogRow[] = [];
  let skipped = Math.max(0, list.length - maxIngestEvents);
  for (const item of list.slice(0, maxIngestEvents)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      skipped += 1;
      continue;
    }
    const e = item as Record<string, unknown>;
    const route = typeof e.route === "string" && ROUTE.test(e.route) ? e.route : null;
    const status = whole(e.status, 100, 599);
    if (!route || status === null) {
      skipped += 1;
      continue;
    }
    const sent = typeof e.ts === "string" ? new Date(e.ts) : null;
    const usable = sent !== null && !Number.isNaN(sent.getTime()) && sent.getTime() > now.getTime() - ageLimitMs && sent.getTime() < now.getTime() + clockSkewMs;
    rows.push({
      ts: usable ? sent : now,
      source: "backend",
      event: "device_request",
      route,
      status,
      ms: whole(e.ms, 0, 3_600_000),
      projectId: typeof e.project_id === "string" && ID.test(e.project_id) ? e.project_id : null,
      agentId: typeof e.agent_id === "string" && ID.test(e.agent_id) ? e.agent_id : null,
      detail: compact({
        reason: text(e.reason, 200),
        count: whole(e.count, 0, 1_000_000),
        skipped_rejections: whole(e.skipped_rejections, 1, 1_000_000_000),
        key_fp: typeof e.key_fp === "string" && FINGERPRINT.test(e.key_fp) ? e.key_fp : null,
        ip: address(e.ip),
        peer: address(e.peer),
        ua: text(e.ua, 120),
      }),
    });
  }
  return { rows, skipped };
}

export type LogStore = {
  insert(rows: LogRow[]): Promise<void>;
};

/**
 * Runs `task` at most once per interval, and never twice at the same time. Pruning is triggered from every insert,
 * whichever path it came from, so the table is trimmed even when only the backend is writing.
 */
export class IntervalGate {
  private last: number | null = null;
  private running = false;

  constructor(private readonly everyMs: number, private readonly now: () => number = () => Date.now()) {}

  async run(task: () => Promise<void>): Promise<void> {
    const now = this.now();
    if (this.running || (this.last !== null && now - this.last < this.everyMs)) return;
    this.running = true;
    this.last = now;
    try {
      await task();
    } finally {
      this.running = false;
    }
  }
}

type WriterOptions = {
  flushMs?: number;
  maxBuffered?: number;
  /** Called with a short message when a write fails; must not log through the persisted path. */
  onError?: (message: string) => void;
};

/**
 * Collects rows and writes them in batches, so a request never waits for the database. A failed write loses
 * its batch rather than retrying: the same lines are still on stdout, and a database that is down must not
 * make the buffer grow without bound.
 */
export class LogWriter {
  private buffer: LogRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private dropped = 0;
  private readonly flushMs: number;
  private readonly maxBuffered: number;
  private readonly onError: (message: string) => void;

  constructor(private readonly store: LogStore, options: WriterOptions = {}) {
    this.flushMs = options.flushMs ?? 2000;
    this.maxBuffered = options.maxBuffered ?? 1000;
    this.onError = options.onError ?? (() => {});
  }

  add(row: LogRow) {
    if (this.buffer.length >= this.maxBuffered) {
      this.buffer.shift();
      this.dropped += 1;
    }
    this.buffer.push(row);
    this.schedule();
  }

  private schedule() {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => void this.flush(), this.flushMs);
    this.timer.unref?.();
  }

  /** One write at a time: a database that hangs must not collect a new in-flight batch every interval. */
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushing) return;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return;
    this.flushing = true;
    try {
      await this.store.insert(batch);
    } catch (error) {
      this.onError(`${shortMessage(error)}${this.dropped ? ` (${this.dropped} dropped while the buffer was full)` : ""}`);
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) this.schedule();
    }
  }
}
