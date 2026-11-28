import { describe, expect, it } from "vitest";
import { summarizeUsage, TtlCache, usageParts, type UsageTurn } from "../src/lib/agent-usage";

const fakeT = (key: string, args: (string | number)[] = []) => key.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));
const parts = (usage: Parameters<typeof usageParts>[0]) => usageParts(usage, fakeT, (iso) => `@${iso}`);
const used = { turns: 5, capped: false, failures: 0, medianLatencyMs: 2500, lastAt: "2026-11-27T08:30:00.000Z" };
const turn = (over: Partial<UsageTurn> = {}): UsageTurn => ({ started_at: "2026-11-27T10:00:00Z", status: "ok", latency_ms: 1000, ...over });

describe("usageParts", () => {
  it("says there was no use for an empty page", () => {
    expect(parts({ ...used, turns: 0, medianLatencyMs: null, lastAt: null })).toEqual(["近 7 天沒有使用紀錄"]);
  });

  it("lists the count, latency and last use, and failures only when there are some", () => {
    expect(parts(used)).toEqual(["近 7 天回合數 5", "延遲中位數 2.5 秒", "最近使用 @2026-11-27T08:30:00.000Z"]);
    expect(parts({ ...used, failures: 2 })[1]).toBe("失敗 2");
  });

  it("says the other figures cover only the newest turns when the page was full", () => {
    expect(parts({ ...used, turns: 200, capped: true })[0]).toBe("近 7 天至少 200 回合，以下數據只涵蓋最近 200 回合");
  });

  it("omits what it does not know", () => {
    expect(parts({ ...used, medianLatencyMs: null, lastAt: null })).toEqual(["近 7 天回合數 5"]);
  });
});

describe("summarizeUsage with odd input", () => {
  it("ignores an unparseable start time when finding the last use", () => {
    expect(summarizeUsage([turn({ started_at: "not a date" }), turn({ started_at: "2026-11-26T01:00:00Z" })]).lastAt).toBe("2026-11-26T01:00:00.000Z");
    expect(summarizeUsage([turn({ started_at: "not a date" })]).lastAt).toBeNull();
  });
});

describe("TtlCache", () => {
  it("keeps an entry until its lifetime ends", () => {
    let now = 1000;
    const cache = new TtlCache<string>(10, () => now);
    cache.set("a", "x", 500);
    expect(cache.get("a")).toEqual({ value: "x" });
    now = 1499;
    expect(cache.get("a")).toEqual({ value: "x" });
    now = 1500;
    expect(cache.get("a")).toBeUndefined();
  });

  it("distinguishes a cached null from a miss", () => {
    const cache = new TtlCache<null>(10);
    cache.set("a", null, 1000);
    expect(cache.get("a")).toEqual({ value: null });
    expect(cache.get("b")).toBeUndefined();
  });

  it("drops its oldest entry when full", () => {
    const cache = new TtlCache<number>(2);
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.set("c", 3, 1000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toEqual({ value: 2 });
    expect(cache.get("c")).toEqual({ value: 3 });
  });
});
