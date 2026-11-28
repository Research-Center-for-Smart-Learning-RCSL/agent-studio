// Runs only with TEST_DATABASE_URL pointing at a throwaway PostgreSQL that has the migrations applied.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const authorization = vi.hoisted(() => ({ user: null as null | { isAdmin: boolean } }));
vi.mock("@/lib/authz", () => ({ getCurrentUser: async () => authorization.user }));

const url = process.env.TEST_DATABASE_URL;
const TOKEN = "integration-test-token";

describe.skipIf(!url)("request log storage", () => {
  type Db = typeof import("../src/lib/request-log-db");
  type Store = typeof import("../src/lib/request-log-store");
  let dbModule: Db;
  let store: Store;
  let sql: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  let end: () => Promise<void>;
  const hour = 3_600_000;
  const row = (over: Partial<import("../src/lib/request-log-store").LogRow> = {}): import("../src/lib/request-log-store").LogRow => ({
    ts: new Date(),
    source: "studio",
    event: "request",
    route: "runtime.agent",
    status: 200,
    ms: 5,
    projectId: null,
    agentId: null,
    detail: null,
    ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.RUNTIME_TOKEN = TOKEN;
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    sql = (text, params) => pool.query(text, params);
    end = () => pool.end();
    dbModule = await import("../src/lib/request-log-db");
    store = await import("../src/lib/request-log-store");
  });
  beforeEach(async () => {
    await sql("truncate request_logs restart identity");
  });
  afterAll(async () => {
    await dbModule.closeLogPool();
    await end();
  });

  const query = (q: string) => import("../src/lib/request-log-query").then((m) => m.parseLogQuery(new URLSearchParams(q)));

  it("stores rows and reads them back newest first with every column", async () => {
    await dbModule.insertLogRows([
      row({ route: "a", detail: { method: "GET" } }),
      row({ source: "backend", event: "device_request", route: "list", status: 401, projectId: "prj-1", agentId: "pmpt_x", detail: { ip: "203.0.113.9", reason: "bad key" } }),
    ]);
    const { rows, hasMore } = await dbModule.readRequestLogs(await query(""));
    expect(hasMore).toBe(false);
    expect(rows.map((r) => r.route)).toEqual(["list", "a"]);
    expect(rows[0]).toMatchObject({ source: "backend", event: "device_request", status: 401, projectId: "prj-1", agentId: "pmpt_x", detail: { ip: "203.0.113.9", reason: "bad key" } });
    expect(typeof rows[0].id).toBe("number");
  });

  it("filters by source, event, time range and failures", async () => {
    await dbModule.insertLogRows([
      row({ route: "ok" }),
      row({ route: "missing", status: 404 }),
      row({ event: "request_error", status: null, route: "/agents/[id]", detail: { message: "boom" } }),
      row({ source: "backend", event: "device_request", route: "detail", status: 200 }),
      row({ route: "old", status: 500, ts: new Date(Date.now() - 3 * hour) }),
    ]);
    const routes = async (q: string) => (await dbModule.readRequestLogs(await query(q))).rows.map((r) => r.route).sort();
    expect(await routes("source=backend")).toEqual(["detail"]);
    expect(await routes("event=request_error")).toEqual(["/agents/[id]"]);
    expect(await routes("range=1h")).toEqual(["/agents/[id]", "detail", "missing", "ok"]);
    expect(await routes("range=1h&errors=1")).toEqual(["/agents/[id]", "missing"]);
    expect(await routes("range=24h&errors=1")).toEqual(["/agents/[id]", "missing", "old"]);
  });

  it("summarizes the range and source but not the event, error or search filters", async () => {
    await dbModule.insertLogRows([row(), row({ status: 500 }), row({ event: "action_failed", status: null }), row({ source: "backend", event: "device_request" })]);
    const { summary } = await dbModule.readRequestLogs(await query("source=studio&event=action_failed&errors=1&q=zzz"));
    expect(summary).toEqual([
      { source: "studio", event: "action_failed", total: 1, failures: 1 },
      { source: "studio", event: "request", total: 2, failures: 1 },
    ]);
  });

  it("searches route, ids, reason, message, key fingerprint and address, and treats % and _ literally", async () => {
    await dbModule.insertLogRows([
      row({ route: "list", projectId: "prj-alpha" }),
      row({ route: "detail", agentId: "pmpt_beta" }),
      row({ route: "x1", detail: { reason: "discount 50% off" } }),
      row({ route: "x2", detail: { message: "disk_full" } }),
      row({ route: "x3", detail: { key_fp: "0a1b2c3d", ip: "203.0.113.9" } }),
      row({ route: "x4", detail: { reason: "discount 5000 off" } }),
      row({ route: "x5", detail: { message: "diskXfull" } }),
    ]);
    const routes = async (q: string) => (await dbModule.readRequestLogs(await query(`q=${encodeURIComponent(q)}`))).rows.map((r) => r.route).sort();
    expect(await routes("alpha")).toEqual(["list"]);
    expect(await routes("PMPT_BETA")).toEqual(["detail"]);
    expect(await routes("50%")).toEqual(["x1"]);
    expect(await routes("disk_full")).toEqual(["x2"]);
    expect(await routes("0a1b2c3d")).toEqual(["x3"]);
    expect(await routes("203.0.113")).toEqual(["x3"]);
    expect(await routes("'; drop table request_logs; --")).toEqual([]);
    await sql("select 1 from request_logs limit 1");
  });

  it("pages with a keyset cursor and reports whether more remain", async () => {
    await dbModule.insertLogRows(Array.from({ length: 130 }, (_, i) => row({ route: `r${i}` })));
    const first = await dbModule.readRequestLogs(await query(""));
    expect(first.rows).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const second = await dbModule.readRequestLogs(await query(`before=${first.rows[99].id}`));
    expect(second.rows).toHaveLength(30);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(130);
  });

  it("prunes by age and then by row cap", async () => {
    await dbModule.insertLogRows([row({ route: "old", ts: new Date(Date.now() - 40 * 24 * hour) }), ...Array.from({ length: 5 }, (_, i) => row({ route: `n${i}` }))]);
    await dbModule.pruneLogRows(new Date(Date.now() - store.retentionDays * 24 * hour), 3);
    const left = (await sql("select route from request_logs order by id")).rows.map((r) => r.route);
    expect(left).toEqual(["n2", "n3", "n4"]);
  });

  it("stores lines logged through logEvent once the writer is installed", async () => {
    const { logEvent, setLogSink, setPersistHook } = await import("../src/lib/request-log");
    setLogSink(() => {});
    dbModule.resetDatabaseLogWriter();
    dbModule.installDatabaseLogWriter();
    logEvent("request", { route: "runtime.list", status: 200, ms: 3, project_id: "prj-1" });
    logEvent("action_failed", { action: "saveAgent", message: "database query failed (23505)" });
    for (let i = 0; i < 40 && Number((await sql("select count(*)::int as n from request_logs")).rows[0].n) < 2; i++) await new Promise((r) => setTimeout(r, 100));
    setPersistHook(null);
    setLogSink(null);
    const { rows } = await sql("select event, route, status, project_id, detail from request_logs order by id");
    expect(rows).toEqual([
      { event: "request", route: "runtime.list", status: 200, project_id: "prj-1", detail: null },
      { event: "action_failed", route: null, status: null, project_id: null, detail: { action: "saveAgent", message: "database query failed (23505)" } },
    ]);
  });

  it("installing the writer twice stores each line once", async () => {
    const { logEvent, setLogSink, setPersistHook } = await import("../src/lib/request-log");
    setLogSink(() => {});
    dbModule.resetDatabaseLogWriter();
    dbModule.installDatabaseLogWriter();
    dbModule.installDatabaseLogWriter();
    logEvent("request", { route: "once" });
    for (let i = 0; i < 40 && Number((await sql("select count(*)::int as n from request_logs")).rows[0].n) < 1; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 2600));
    setPersistHook(null);
    setLogSink(null);
    expect(Number((await sql("select count(*)::int as n from request_logs")).rows[0].n)).toBe(1);
  }, 15_000);

  it("trims the table when only the ingest path writes", async () => {
    await sql("insert into request_logs (ts, source, event) values (now() - interval '40 days', 'backend', 'device_request')");
    vi.resetModules();
    const { POST } = await import("../src/app/api/runtime/v1/device-log/route");
    const body = JSON.stringify({ events: [{ ts: new Date().toISOString(), route: "list", status: 200 }] });
    const response = await POST(new Request("http://studio.test/x", { method: "POST", body, headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(response.status).toBe(200);
    let left = 2;
    for (let i = 0; i < 40 && left !== 1; i++) {
      await new Promise((r) => setTimeout(r, 100));
      left = Number((await sql("select count(*)::int as n from request_logs")).rows[0].n);
    }
    expect(left).toBe(1);
  });

  describe("ingest endpoint", () => {
    const post = async (body: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) => {
      const { POST } = await import("../src/app/api/runtime/v1/device-log/route");
      return POST(new Request("http://studio.test/api/runtime/v1/device-log", { method: "POST", body, headers }));
    };
    const good = { ts: new Date().toISOString(), route: "list", status: 200, ms: 12, project_id: "prj-1", key_fp: "0a1b2c3d", ip: "203.0.113.9" };

    it("rejects a missing or wrong token without storing anything", async () => {
      expect((await post(JSON.stringify({ events: [good] }), {})).status).toBe(401);
      expect((await post(JSON.stringify({ events: [good] }), { authorization: "Bearer nope" })).status).toBe(401);
      expect(Number((await sql("select count(*)::int as n from request_logs")).rows[0].n)).toBe(0);
    });

    it("stores valid events as backend rows and reports what it skipped", async () => {
      const response = await post(JSON.stringify({ events: [good, { route: "BAD", status: 200 }] }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stored: 1, skipped: 1 });
      const { rows } = await sql("select source, event, route, status, project_id, detail from request_logs");
      expect(rows).toEqual([{ source: "backend", event: "device_request", route: "list", status: 200, project_id: "prj-1", detail: { key_fp: "0a1b2c3d", ip: "203.0.113.9" } }]);
    });

    it("answers 400 for a body that is not JSON and 413 for one that is too large", async () => {
      expect((await post("not json")).status).toBe(400);
      expect((await post("x".repeat(300 * 1024))).status).toBe(413);
    });

    it("cuts off a chunked body that declares no length once it passes the limit", async () => {
      const { POST } = await import("../src/app/api/runtime/v1/device-log/route");
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 64 * 1024;
          controller.enqueue(new Uint8Array(64 * 1024).fill(120));
          if (sent > 10 * 1024 * 1024) controller.close();
        },
      });
      const request = new Request("http://studio.test/x", { method: "POST", body, headers: { authorization: `Bearer ${TOKEN}` }, duplex: "half" } as RequestInit);
      expect(request.headers.get("content-length")).toBeNull();
      expect((await POST(request)).status).toBe(413);
      expect(sent).toBeLessThan(2 * 1024 * 1024);
    });

    it("stores an event whose text holds a NUL or an unpaired surrogate instead of losing the batch", async () => {
      const lone = String.fromCharCode(0xd83d);
      const response = await post(JSON.stringify({ events: [{ ...good, reason: `a b${lone}c`, ua: `x${lone}` }, { ...good, route: "detail" }] }));
      expect(await response.json()).toEqual({ stored: 2, skipped: 0 });
      const { rows } = await sql("select detail->>'reason' as reason from request_logs where route = 'list'");
      expect(rows[0].reason).toBe("ab�c");
    });
  });

  describe("admin endpoint", () => {
    const get = async () => {
      const { GET } = await import("../src/app/api/admin/request-logs/route");
      return GET(new Request("http://studio.test/api/admin/request-logs?range=1h"));
    };

    it("is closed to anonymous users and to everyone who is not a system administrator", async () => {
      await dbModule.insertLogRows([row()]);
      authorization.user = null;
      expect((await get()).status).toBe(401);
      authorization.user = { isAdmin: false };
      const refused = await get();
      expect(refused.status).toBe(403);
      expect(JSON.stringify(await refused.json())).not.toContain("runtime.agent");
    });

    it("returns the log to an administrator", async () => {
      await dbModule.insertLogRows([row({ route: "visible" })]);
      authorization.user = { isAdmin: true };
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).rows[0].route).toBe("visible");
    });
  });
});
