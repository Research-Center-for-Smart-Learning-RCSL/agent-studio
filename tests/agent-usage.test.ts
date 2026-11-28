import { describe, expect, it } from "vitest";
import { parseUsageTurns, summarizeUsage, usagePageSize, type UsageTurn } from "../src/lib/agent-usage";

const turn = (over: Partial<UsageTurn> = {}): UsageTurn => ({ started_at: "2026-11-27T10:00:00Z", status: "ok", latency_ms: 1000, ...over });

describe("summarizeUsage", () => {
  it("reports nothing for an unused agent", () => {
    expect(summarizeUsage([])).toEqual({ turns: 0, capped: false, failures: 0, medianLatencyMs: null, lastAt: null });
  });

  it("counts failures and takes the latest start", () => {
    const usage = summarizeUsage([
      turn({ started_at: "2026-11-25T01:00:00Z" }),
      turn({ started_at: "2026-11-27T09:00:00Z", status: "failed", latency_ms: null }),
      turn({ started_at: "2026-11-26T01:00:00Z", status: "no_response" }),
    ]);
    expect(usage.turns).toBe(3);
    expect(usage.failures).toBe(2);
    expect(usage.lastAt).toBe("2026-11-27T09:00:00.000Z");
  });

  it("takes the median latency of answered turns only", () => {
    expect(summarizeUsage([turn({ latency_ms: 100 }), turn({ latency_ms: 900 }), turn({ latency_ms: 300 })]).medianLatencyMs).toBe(300);
    expect(summarizeUsage([turn({ latency_ms: 100 }), turn({ latency_ms: 300 })]).medianLatencyMs).toBe(200);
    expect(summarizeUsage([turn({ status: "failed", latency_ms: 50_000 }), turn({ latency_ms: 400 })]).medianLatencyMs).toBe(400);
    expect(summarizeUsage([turn({ latency_ms: null })]).medianLatencyMs).toBeNull();
  });

  it("flags a full page as a lower bound", () => {
    expect(summarizeUsage(Array.from({ length: usagePageSize }, () => turn())).capped).toBe(true);
    expect(summarizeUsage(Array.from({ length: usagePageSize - 1 }, () => turn())).capped).toBe(false);
  });
});

describe("parseUsageTurns", () => {
  it("keeps only well-formed rows and the three fields", () => {
    const rows = parseUsageTurns({ items: [{ started_at: "2026-11-27T10:00:00Z", status: "ok", latency_ms: 5, input_text: "private" }, null, { status: "ok" }, { started_at: 1, status: "ok" }] });
    expect(rows).toEqual([{ started_at: "2026-11-27T10:00:00Z", status: "ok", latency_ms: 5 }]);
  });

  it("rejects a body that is not a page", () => {
    expect(parseUsageTurns(null)).toBeNull();
    expect(parseUsageTurns({ items: "x" })).toBeNull();
    expect(parseUsageTurns({ error: "no" })).toBeNull();
  });
});
