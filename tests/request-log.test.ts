import { afterEach, describe, expect, it } from "vitest";
import { logEvent, loggedRoute, pathOnly, setLogSink, shortMessage } from "../src/lib/request-log";

const lines: string[] = [];
setLogSink((line) => lines.push(line));
afterEach(() => { lines.length = 0; });

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
    expect(shortMessage("a\nforged line\r\n{\"event\":\"x\"}")).not.toMatch(/[\r\n]/);
    expect(shortMessage("x".repeat(500))).toHaveLength(200);
    expect(shortMessage(new Error("boom"))).toBe("boom");
  });

  it("removes the query string from a path", () => {
    expect(pathOnly("/logs?prompt=agt_1&token=secret")).toBe("/logs");
    expect(pathOnly("/agents/agt_1#top")).toBe("/agents/agt_1");
    expect(pathOnly("/plain")).toBe("/plain");
  });
});

describe("loggedRoute", () => {
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

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
    const handler = loggedRoute("runtime.list", async () => { throw new Error("database is down"); });
    await expect(handler(new Request("http://studio.test/x"), ctx({ projectId: "proj_1" }))).rejects.toThrow("database is down");
    expect(parsed()[0]).toMatchObject({ status: 500, reason: "database is down", project_id: "proj_1" });
  });

  it("never copies a malformed id into the log", async () => {
    const handler = loggedRoute("runtime.agent", async () => new Response(null, { status: 404 }));
    await handler(new Request("http://studio.test/x"), ctx({ agentId: 'bad"id\nforged' }));
    expect(parsed()[0].agent_id).toBe("invalid");
    expect(lines).toHaveLength(1);
  });
});
