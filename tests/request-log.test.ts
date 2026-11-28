import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "../src/instrumentation";
import { describeError, logEvent, loggedRoute, pathOnly, rejectionIntervalMs, resetRejectionSampling, setLogSink, shortMessage } from "../src/lib/request-log";

const lines: string[] = [];
setLogSink((line) => lines.push(line));
beforeEach(() => resetRejectionSampling());
afterEach(() => {
  lines.length = 0;
  vi.useRealTimers();
});

const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("request log", () => {
  it("writes one JSON object per line and drops empty fields", () => {
    logEvent("demo", { a: 1, b: undefined, c: null, d: "x" });
    expect(lines).toHaveLength(1);
    const [entry] = parsed();
    expect(entry).toMatchObject({ event: "demo", a: 1, d: "x" });
    expect("b" in entry).toBe(false);
    expect("c" in entry).toBe(false);
    expect(typeof entry.ts).toBe("string");
  });

  it("keeps messages on one short line", () => {
    expect(shortMessage('a\nforged line\r\n{"event":"x"}')).not.toMatch(/[\r\n]/);
    expect(shortMessage("x".repeat(500))).toHaveLength(200);
    expect(shortMessage(new Error("boom"))).toBe("boom");
  });

  it("removes the query string from a path", () => {
    expect(pathOnly("/logs?prompt=agt_1&token=secret")).toBe("/logs");
    expect(pathOnly("/agents/agt_1#top")).toBe("/agents/agt_1");
    expect(pathOnly("/plain")).toBe("/plain");
  });
});

describe("describeError", () => {
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code, severity: "ERROR" });

  it("never reveals the SQL or the parameter values of a failed Drizzle query", () => {
    const error = new DrizzleQueryError('insert into "users" ("email") values ($1)', ["alice@example.com"], pgError("23505", 'duplicate key value violates unique constraint "users_email_key"'));
    expect(error.message).toContain("alice@example.com");
    const text = describeError(error);
    expect(text).toBe("database query failed (23505)");
    expect(shortMessage(error)).toBe(text);
  });

  it("gives no code when the cause has none", () => {
    expect(describeError(new DrizzleQueryError("select 1", ["secret"], new Error("connection terminated")))).toBe("database query failed");
  });

  it("treats a bare PostgreSQL error, which quotes the offending value, the same way", () => {
    expect(describeError(pgError("22003", 'value "99999999999" is out of range for type integer'))).toBe("database query failed (22003)");
  });

  it("recognizes a wrapped database error by its message when the class is lost", () => {
    expect(describeError(new Error("Failed query: select * from secrets\nparams: sk-live"))).toBe("database query failed");
  });

  it("keeps the message of any other error, on one line", () => {
    expect(describeError(new Error("fetch failed\nretry"))).toBe("fetch failed retry");
    expect(describeError("plain text")).toBe("plain text");
  });
});

describe("onRequestError", () => {
  it("logs the route and kind with the path alone, and a database error without its values", async () => {
    const error = Object.assign(new DrizzleQueryError("select $1", ["alice@example.com"], new Error("x")), { digest: "d1" });
    await onRequestError(
      error,
      { path: "/agents/agt_1?token=secret", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/agents/[id]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined },
    );
    expect(parsed()[0]).toMatchObject({ event: "request_error", route: "/agents/[id]", kind: "render", method: "GET", path: "/agents/agt_1", message: "database query failed", digest: "d1" });
    expect(lines.join("\n")).not.toMatch(/alice|secret|token/);
  });
});

describe("loggedRoute", () => {
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
  const reject = loggedRoute("runtime.agent", async () => new Response(null, { status: 401 }));

  it("logs route, status, duration and path ids, but not the credentials or query", async () => {
    const handler = loggedRoute("runtime.agent", async () => new Response("{}", { status: 404 }));
    const request = new Request("http://studio.test/api/runtime/v1/agents/agt_1?version=3&secret=zzz", {
      headers: { authorization: "Bearer SUPERSECRET", cookie: "session=abc" },
    });
    const response = await handler(request, ctx({ agentId: "agt_1" }));
    expect(response.status).toBe(404);
    const [entry] = parsed();
    expect(entry).toMatchObject({ event: "request", route: "runtime.agent", method: "GET", status: 404, agent_id: "agt_1" });
    expect(typeof entry.ms).toBe("number");
    expect(lines.join("\n")).not.toMatch(/SUPERSECRET|session=abc|zzz|version=3/);
  });

  it("logs a throwing handler as a 500 and rethrows", async () => {
    const handler = loggedRoute("runtime.list", async () => {
      throw new Error("database is down");
    });
    await expect(handler(new Request("http://studio.test/x"), ctx({ projectId: "proj_1" }))).rejects.toThrow("database is down");
    expect(parsed()[0]).toMatchObject({ status: 500, reason: "database is down", project_id: "proj_1" });
  });

  it("logs a database failure in a handler without its values", async () => {
    const handler = loggedRoute("runtime.list", async () => {
      throw new DrizzleQueryError("select $1", ["alice@example.com"], new Error("x"));
    });
    await expect(handler(new Request("http://studio.test/x"), ctx({}))).rejects.toThrow();
    expect(parsed()[0].reason).toBe("database query failed");
    expect(lines.join("\n")).not.toContain("alice");
  });

  it("never copies a malformed id into the log", async () => {
    const handler = loggedRoute("runtime.agent", async () => new Response(null, { status: 404 }));
    await handler(new Request("http://studio.test/x"), ctx({ agentId: 'bad"id\nforged' }));
    expect(parsed()[0].agent_id).toBe("invalid");
    expect(lines).toHaveLength(1);
  });

  it("writes one rejection line per interval and counts the ones it skipped", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T00:00:00Z"));
    for (let i = 0; i < 50; i++) await reject(new Request("http://studio.test/x"), ctx({}));
    expect(lines).toHaveLength(1);
    vi.setSystemTime(Date.now() + rejectionIntervalMs + 1);
    await reject(new Request("http://studio.test/x"), ctx({}));
    expect(parsed()).toHaveLength(2);
    expect(parsed()[1].skipped_rejections).toBe(49);
  });

  it("does not sample anything but rejections", async () => {
    const ok = loggedRoute("runtime.agent", async () => new Response("{}", { status: 200 }));
    for (let i = 0; i < 5; i++) await ok(new Request("http://studio.test/x"), ctx({}));
    expect(lines).toHaveLength(5);
  });
});
