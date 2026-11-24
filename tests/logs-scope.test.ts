import { describe, expect, it } from "vitest";
import { encodeScope, forwardablePath, logsCaller, needsAdmin, type ScopeProject } from "../src/lib/logs-scope";

const projects: ScopeProject[] = [
  { id: "p1", name: "餐廳", organizationId: "o1", organizationName: "RCSL" },
  { id: "p2", name: "櫃台", organizationId: "o1", organizationName: "RCSL" },
  { id: "p3", name: "Lab", organizationId: "o2", organizationName: "Other" },
];

const base = { projects, path: "v1/turns" };

describe("logsCaller", () => {
  it("lets an administrator with no filter read everything", () => {
    expect(logsCaller({ ...base, isAdmin: true, readable: null, filter: {} })).toEqual({ kind: "admin" });
  });

  it("narrows an administrator to the selected project", () => {
    expect(logsCaller({ ...base, isAdmin: true, readable: null, filter: { organization: "o1", project: "p2" } }))
      .toEqual({ kind: "scoped", pairs: [["RCSL", "櫃台"]] });
    expect(logsCaller({ ...base, isAdmin: true, readable: null, filter: { organization: "o2" } }))
      .toEqual({ kind: "scoped", pairs: [["Other", "Lab"]] });
  });

  it("keeps an administrator unrestricted on views that add up every project", () => {
    for (const path of ["v1/analytics/summary", "v1/admin/users"]) {
      expect(logsCaller({ ...base, path, isAdmin: true, readable: null, filter: { organization: "o1" } }))
        .toEqual({ kind: "admin" });
    }
  });

  it("limits a member to the projects they can read", () => {
    expect(logsCaller({ ...base, isAdmin: false, readable: new Set(["p1", "p3"]), filter: {} }))
      .toEqual({ kind: "scoped", pairs: [["RCSL", "餐廳"], ["Other", "Lab"]] });
  });

  it("never widens a member through the filter", () => {
    expect(logsCaller({ ...base, isAdmin: false, readable: new Set(["p1"]), filter: { project: "p2" } }))
      .toEqual({ kind: "scoped", pairs: [] });
    expect(logsCaller({ ...base, isAdmin: false, readable: new Set(["p1"]), filter: { organization: "o2" } }))
      .toEqual({ kind: "scoped", pairs: [] });
  });

  it("gives a member who may read nothing an empty scope, and never admin", () => {
    expect(logsCaller({ ...base, isAdmin: false, readable: new Set(), filter: {} })).toEqual({ kind: "scoped", pairs: [] });
    expect(logsCaller({ ...base, path: "v1/analytics/summary", isAdmin: false, readable: new Set(["p1"]), filter: {} }).kind)
      .toBe("scoped");
  });

  it("lists a project name shared by two ids once", () => {
    const dup = [...projects, { id: "p4", name: "餐廳", organizationId: "o1", organizationName: "RCSL" }];
    const caller = logsCaller({ projects: dup, path: "v1/turns", isAdmin: false, readable: new Set(["p1", "p4"]), filter: {} });
    expect(caller).toEqual({ kind: "scoped", pairs: [["RCSL", "餐廳"]] });
  });
});

describe("scope header", () => {
  it("round-trips non-ASCII names as base64url JSON", () => {
    const pairs: [string, string][] = [["Nian-Shing Chen's Research Group", "AI_Based 研究"]];
    const header = encodeScope(pairs);
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual(pairs);
  });
});

describe("forwardablePath", () => {
  it("forwards the versioned API only", () => {
    expect(forwardablePath(["v1", "turns"])).toBe("v1/turns");
    expect(forwardablePath(["v1", "conversations", "conv_1", "turns"])).toBe("v1/conversations/conv_1/turns");
  });

  it("encodes each segment again so a dot segment cannot be smuggled in", () => {
    const sent = forwardablePath(["v1", "%2e%2e", "auth", "login"]);
    expect(sent).toBe("v1/%252e%252e/auth/login");
    expect(new URL(`http://logs.test/api/${sent}`).pathname).toBe("/api/v1/%252e%252e/auth/login");
    expect(forwardablePath(["v1", "auth?x"])).toBe("v1/auth%3Fx");
    expect(forwardablePath(["v1", "analytics?"])).toBe("v1/analytics%3F");
    expect(forwardablePath(["v1", "conversations", "對話 1", "turns"])).toBe("v1/conversations/%E5%B0%8D%E8%A9%B1%201/turns");
    expect(forwardablePath(["v1", "a" + String.fromCharCode(0) + "b"])).toBeNull();
  });

  it("refuses sign-in, health, traversal and unversioned paths", () => {
    for (const segments of [[], ["v1", "auth", "login"], ["v1", "auth"], ["v1", "health"], ["v1", "..", "x"], ["v1", "a/b"],
      ["v1", ""], ["docs"], ["openapi.json"], ["v1", "a" + String.fromCharCode(92) + "b"]]) {
      expect(forwardablePath(segments)).toBeNull();
    }
  });
});

describe("needsAdmin", () => {
  it("matches whole path segments", () => {
    expect(needsAdmin("v1/analytics")).toBe(true);
    expect(needsAdmin("v1/analytics/latency")).toBe(true);
    expect(needsAdmin("v1/administrators")).toBe(false);
    expect(needsAdmin("v1/turns")).toBe(false);
  });
});
