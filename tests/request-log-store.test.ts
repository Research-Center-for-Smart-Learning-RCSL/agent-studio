import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent, setLogSink, setPersistHook } from "../src/lib/request-log";
import { IntervalGate, LogWriter, maxIngestEvents, parseBackendEvents, rowFromEntry, type LogRow, type LogStore } from "../src/lib/request-log-store";

const NOW = new Date("2026-11-28T03:00:00.000Z");

describe("rowFromEntry", () => {
  it("moves the filterable fields to columns and keeps the rest as detail", () => {
    const row = rowFromEntry({ ts: "2026-11-28T02:59:00.000Z", event: "request", route: "runtime.agent", status: 404, ms: 12, agent_id: "pmpt_1", project_id: "prj-1", method: "GET" });
    expect(row).toMatchObject({ source: "studio", event: "request", route: "runtime.agent", status: 404, ms: 12, agentId: "pmpt_1", projectId: "prj-1", detail: { method: "GET" } });
    expect(row.ts.toISOString()).toBe("2026-11-28T02:59:00.000Z");
  });

  it("stores no detail when nothing else was logged, and rejects malformed ids and numbers", () => {
    const row = rowFromEntry({ ts: "garbage", event: "action_failed", status: 99999, agent_id: "bad id", project_id: 7 });
    expect(row.detail).toBeNull();
    expect(row.status).toBeNull();
    expect(row.agentId).toBeNull();
    expect(row.projectId).toBeNull();
    expect(Number.isNaN(row.ts.getTime())).toBe(false);
  });
});

describe("parseBackendEvents", () => {
  const good = { ts: "2026-11-28T02:59:30.000Z", route: "detail", status: 200, ms: 40, project_id: "prj-1", agent_id: "pmpt_abc", count: 3, key_fp: "0a1b2c3d", ip: "203.0.113.9", peer: "172.18.0.2", ua: "Robot/1.0" };

  it("maps a well-formed event to a backend row", () => {
    const { rows, skipped } = parseBackendEvents({ events: [good] }, NOW);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "backend",
      event: "device_request",
      route: "detail",
      status: 200,
      ms: 40,
      projectId: "prj-1",
      agentId: "pmpt_abc",
      detail: { count: 3, key_fp: "0a1b2c3d", ip: "203.0.113.9", peer: "172.18.0.2", ua: "Robot/1.0" },
    });
    expect(rows[0].ts.toISOString()).toBe(good.ts);
    expect(parseBackendEvents({ events: [{ ...good, status: 401, skipped_rejections: 49 }, { ...good, skipped_rejections: -1 }] }, NOW).rows.map((r) => r.detail?.skipped_rejections)).toEqual([49, undefined]);
  });

  it("drops events without a valid route or status, and anything that is not an object", () => {
    const { rows, skipped } = parseBackendEvents({ events: [{ ...good, route: "Bad Route" }, { ...good, status: 20 }, { ...good, status: "200" }, "text", null, [], good] }, NOW);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(6);
  });

  it("keeps only the shapes it expects in each field", () => {
    const { rows } = parseBackendEvents(
      { events: [{ ...good, key_fp: "SECRET-KEY-VALUE", ip: "not an ip", peer: "<script>", agent_id: "a b", project_id: "x".repeat(300), ua: "a\nb".repeat(100), extra: "ignored", count: -4, ms: 1.5 }] },
      NOW,
    );
    const [row] = rows;
    expect(row.agentId).toBeNull();
    expect(row.projectId).toBeNull();
    expect(row.ms).toBeNull();
    expect(row.detail).not.toHaveProperty("key_fp");
    expect(row.detail).not.toHaveProperty("ip");
    expect(row.detail).not.toHaveProperty("peer");
    expect(row.detail).not.toHaveProperty("count");
    expect(row.detail).not.toHaveProperty("extra");
    expect(String(row.detail?.ua)).not.toMatch(/\n/);
    expect(String(row.detail?.ua).length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(rows)).not.toContain("SECRET-KEY-VALUE");
  });

  it("replaces a timestamp that is too old, in the future or unparseable with the receive time", () => {
    for (const ts of ["2026-11-20T00:00:00Z", "2026-11-28T04:00:00Z", "yesterday", 12345, undefined]) {
      const { rows } = parseBackendEvents({ events: [{ ...good, ts }] }, NOW);
      expect(rows[0].ts).toEqual(NOW);
    }
  });

  it("reads at most maxIngestEvents events and counts the rest as skipped", () => {
    const { rows, skipped } = parseBackendEvents({ events: Array.from({ length: maxIngestEvents + 30 }, () => good) }, NOW);
    expect(rows).toHaveLength(maxIngestEvents);
    expect(skipped).toBe(30);
  });

  it("accepts nothing from a body that has no events list", () => {
    for (const body of [null, "x", 5, {}, { events: "no" }]) expect(parseBackendEvents(body, NOW)).toEqual({ rows: [], skipped: 0 });
  });
});

describe("strings PostgreSQL would reject", () => {
  it("strips NUL and unpaired surrogates from stored text, including a cut emoji", () => {
    const cutEmoji = "a".repeat(199) + "\u{1F600}";
    const row = rowFromEntry({ event: "request_error", message: "bad\u0000value", note: { deep: ["x\ud83dy"] }, route: cutEmoji });
    expect(JSON.stringify(row)).not.toMatch(/\\u0000|\\ud83d/i);
    expect(row.detail).toEqual({ message: "badvalue", note: { deep: ["x�y"] } });
    expect(row.route!.isWellFormed()).toBe(true);
    const parsed = parseBackendEvents({ events: [{ route: "list", status: 200, reason: "r\u0000" + "\u{1F600}".repeat(150), ua: "\ud800" }] }, NOW).rows[0];
    expect(JSON.stringify(parsed.detail)).not.toMatch(/\\u0000|\\ud[89ab]/i);
    expect((parsed.detail!.reason as string).isWellFormed()).toBe(true);
  });
});

describe("LogWriter", () => {
  const row = (n: number): LogRow => ({ ts: NOW, source: "studio", event: "request", route: `r${n}`, status: 200, ms: n, projectId: null, agentId: null, detail: null });
  let inserted: LogRow[][];
  let failing = false;
  let hang: Promise<void> | null = null;
  let attempts = 0;
  const store: LogStore = {
    async insert(rows) {
      attempts += 1;
      if (hang) await hang;
      if (failing) throw new Error("connection refused");
      inserted.push(rows);
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    inserted = [];
    failing = false;
    hang = null;
    attempts = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("writes what was added as one batch after the flush delay", async () => {
    const writer = new LogWriter(store, { flushMs: 1000 });
    writer.add(row(1));
    writer.add(row(2));
    expect(inserted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((r) => r.route)).toEqual(["r1", "r2"]);
  });

  it("drops the oldest rows when the buffer is full and says so in the error it reports", async () => {
    const errors: string[] = [];
    const writer = new LogWriter(store, { maxBuffered: 3, onError: (m) => errors.push(m) });
    for (let i = 1; i <= 5; i++) writer.add(row(i));
    failing = true;
    await writer.flush();
    expect(errors[0]).toContain("connection refused");
    expect(errors[0]).toContain("2 dropped");
    failing = false;
    for (let i = 1; i <= 5; i++) writer.add(row(i));
    await writer.flush();
    expect(inserted[0].map((r) => r.route)).toEqual(["r3", "r4", "r5"]);
  });

  it("loses a failed batch instead of retrying it, and keeps working afterwards", async () => {
    const errors: string[] = [];
    const writer = new LogWriter(store, { onError: (m) => errors.push(m) });
    failing = true;
    writer.add(row(1));
    await writer.flush();
    expect(errors).toHaveLength(1);
    failing = false;
    writer.add(row(2));
    await writer.flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((r) => r.route)).toEqual(["r2"]);
  });

  it("has one write in flight at a time, so a hanging database cannot pile up batches", async () => {
    let release!: () => void;
    hang = new Promise<void>((resolve) => (release = resolve));
    const writer = new LogWriter(store, { flushMs: 100 });
    writer.add(row(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(1);
    for (let i = 2; i <= 6; i++) writer.add(row(i));
    await vi.advanceTimersByTimeAsync(5000);
    await writer.flush();
    expect(attempts).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toBe(2);
    expect(inserted.map((batch) => batch.length)).toEqual([1, 5]);
  });
});

describe("IntervalGate", () => {
  it("runs a task at most once per interval", async () => {
    let now = 1000;
    const gate = new IntervalGate(100, () => now);
    let runs = 0;
    const task = async () => void (runs += 1);
    await gate.run(task);
    await gate.run(task);
    now += 99;
    await gate.run(task);
    expect(runs).toBe(1);
    now += 1;
    await gate.run(task);
    expect(runs).toBe(2);
  });

  it("never runs the task twice at once, and lets a failure through to the caller", async () => {
    let now = 0;
    const gate = new IntervalGate(10, () => now);
    let release!: () => void;
    let runs = 0;
    const slow = () =>
      new Promise<void>((resolve) => {
        runs += 1;
        release = resolve;
      });
    const first = gate.run(slow);
    now = 50;
    await gate.run(slow);
    expect(runs).toBe(1);
    release();
    await first;
    now = 100;
    await expect(gate.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    now = 200;
    let again = false;
    await gate.run(async () => void (again = true));
    expect(again).toBe(true);
  });
});

describe("persist hook", () => {
  afterEach(() => {
    setPersistHook(null);
    setLogSink(null);
  });

  it("receives each logged entry without the sink being affected, and a throwing hook breaks nothing", () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    const seen: Record<string, unknown>[] = [];
    setPersistHook((entry) => seen.push(entry));
    logEvent("request", { route: "x", status: 200 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event: "request", route: "x", status: 200 });
    expect(lines).toHaveLength(1);

    setPersistHook(() => {
      throw new Error("db down");
    });
    expect(() => logEvent("request", {})).not.toThrow();
    expect(lines).toHaveLength(2);
  });

  it("still reaches the hook when logEvent comes from a fresh copy of the module", async () => {
    const seen: string[] = [];
    setPersistHook((entry) => seen.push(String(entry.event)));
    vi.resetModules();
    const fresh = await import("../src/lib/request-log");
    fresh.setLogSink(() => {});
    fresh.logEvent("from_other_instance");
    expect(seen).toEqual(["from_other_instance"]);
  });
});
