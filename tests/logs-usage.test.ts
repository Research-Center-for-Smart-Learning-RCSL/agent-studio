import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = [
  { id: "p1", name: "Proj 1", organizationId: "o1", organizationName: "Org" },
  { id: "p2", name: "Proj 2", organizationId: "o1", organizationName: "Org" },
];

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ orderBy: async () => rows }) }) }) },
}));
vi.mock("@/lib/env", () => ({ env: { logsApi: "http://logs.test", logsServiceToken: "service-token" } }));

import { setLogSink } from "../src/lib/request-log";
import { fetchAgentUsage } from "../src/lib/logs";
import type { CurrentUser } from "../src/lib/authz";

const lines: string[] = [];
setLogSink((line) => lines.push(line));
const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

let counter = 0;
const agent = () => ({ id: `agt_${++counter}`, projectId: "p1" });
const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  email: `user${++counter}@example.test`,
  name: null,
  isAdmin: false,
  managedOrgIds: new Set(),
  projectRoles: new Map([["p1", "viewer"], ["p2", "viewer"]]),
  ...over,
});
const page = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });

const calls: { url: URL; headers: Headers }[] = [];
let respond: () => Response | Promise<Response> = () => page([]);

beforeEach(() => {
  lines.length = 0;
  calls.length = 0;
  respond = () => page([]);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), headers: new Headers(init.headers) });
    return respond();
  });
});

const decodeScope = (headers: Headers) => JSON.parse(Buffer.from(headers.get("x-studio-scope") ?? "", "base64url").toString("utf8")) as string[][];

describe("fetchAgentUsage", () => {
  it("asks Logs for the agent's turns of the last week and summarizes them", async () => {
    respond = () => page([{ started_at: "2026-11-27T10:00:00Z", status: "ok", latency_ms: 2000, input_text: "private" }]);
    const a = agent();
    const usage = await fetchAgentUsage(user(), a);
    expect(usage).toMatchObject({ turns: 1, failures: 0, medianLatencyMs: 2000 });
    const { url, headers } = calls[0];
    expect(url.origin + url.pathname).toBe("http://logs.test/v1/turns");
    expect(url.searchParams.get("prompt")).toBe(a.id);
    expect(url.searchParams.get("limit")).toBe("200");
    const days = (Date.now() - Date.parse(url.searchParams.get("since")!)) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(headers.get("x-studio-token")).toBe("service-token");
  });

  it("narrows a non-administrator to the agent's own project", async () => {
    await fetchAgentUsage(user(), agent());
    const { headers } = calls[0];
    expect(headers.get("x-studio-admin")).toBeNull();
    expect(decodeScope(headers)).toEqual([["Org", "Proj 1"]]);
  });

  it("leaves an administrator unfiltered, so turns of unlisted agents are counted", async () => {
    await fetchAgentUsage(user({ isAdmin: true }), agent());
    const { headers } = calls[0];
    expect(headers.get("x-studio-admin")).toBe("1");
    expect(headers.get("x-studio-scope")).toBeNull();
  });

  it("answers a repeat from the cache, per user and agent", async () => {
    const a = agent();
    const u = user();
    await fetchAgentUsage(u, a);
    await fetchAgentUsage(u, a);
    expect(calls).toHaveLength(1);
    await fetchAgentUsage(user(), a);
    await fetchAgentUsage(u, agent());
    expect(calls).toHaveLength(3);
  });

  it("logs why it gave up and returns null for a failing Logs", async () => {
    respond = () => new Response("nope", { status: 401 });
    expect(await fetchAgentUsage(user(), agent())).toBeNull();
    respond = () => new Response("{not json", { status: 200 });
    expect(await fetchAgentUsage(user(), agent())).toBeNull();
    respond = () => new Response(JSON.stringify({ error: "x" }), { status: 200 });
    expect(await fetchAgentUsage(user(), agent())).toBeNull();
    respond = () => { throw new Error("socket hang up"); };
    expect(await fetchAgentUsage(user(), agent())).toBeNull();
    expect(events().map((e) => [e.event, e.reason, e.status])).toEqual([
      ["logs_usage_failed", "http", 401],
      ["logs_usage_failed", "SyntaxError", undefined],
      ["logs_usage_failed", "unexpected_body", undefined],
      ["logs_usage_failed", "Error", undefined],
    ]);
  });

  it("remembers a failure briefly so a stalled Logs is not asked on every render", async () => {
    respond = () => new Response("down", { status: 503 });
    const a = agent();
    const u = user();
    await fetchAgentUsage(u, a);
    await fetchAgentUsage(u, a);
    expect(calls).toHaveLength(1);
  });

  it("asks again after a failure within seconds but keeps a success for half a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-28T00:00:00Z"));
      const u = user();
      const failing = agent();
      respond = () => new Response("down", { status: 503 });
      await fetchAgentUsage(u, failing);
      vi.setSystemTime(Date.now() + 11_000);
      await fetchAgentUsage(u, failing);
      expect(calls).toHaveLength(2);
      calls.length = 0;
      const working = agent();
      respond = () => page([]);
      await fetchAgentUsage(u, working);
      vi.setSystemTime(Date.now() + 29_000);
      await fetchAgentUsage(u, working);
      expect(calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 2_000);
      await fetchAgentUsage(u, working);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the scope header small for a user who can read very many projects", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, name: `Project number ${i} with a long name`, organizationId: "o1", organizationName: "Organization with a long name" }));
    rows.splice(0, rows.length, ...many);
    try {
      const big = user({ projectRoles: new Map(many.map((r) => [r.id, "viewer" as const])) });
      expect(await fetchAgentUsage(big, { id: "agt_wide", projectId: "p3" })).not.toBeNull();
      expect(decodeScope(calls[0].headers)).toEqual([["Organization with a long name", "Project number 3 with a long name"]]);
    } finally {
      rows.splice(0, rows.length, { id: "p1", name: "Proj 1", organizationId: "o1", organizationName: "Org" }, { id: "p2", name: "Proj 2", organizationId: "o1", organizationName: "Org" });
    }
  });
});
