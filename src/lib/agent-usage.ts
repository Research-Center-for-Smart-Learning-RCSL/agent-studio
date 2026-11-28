/** Recent use of one agent, read from the turns that Logs captured for it. */

export type UsageTurn = { started_at: string; status: string; latency_ms: number | null };

export type AgentUsage = {
  turns: number;
  /** True when Logs returned a full page, so there may be more turns than counted. */
  capped: boolean;
  failures: number;
  medianLatencyMs: number | null;
  lastAt: string | null;
};

/** Logs serves at most this many turns per page. */
export const usagePageSize = 200;
export const usageWindowDays = 7;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Counts one page of turns. A turn that is not "ok" (failed or without a response) counts as a failure. */
export function summarizeUsage(items: readonly UsageTurn[]): AgentUsage {
  const times = items.map((t) => Date.parse(t.started_at)).filter((n) => Number.isFinite(n));
  const latencies = items.filter((t) => t.status === "ok" && typeof t.latency_ms === "number").map((t) => t.latency_ms as number);
  return {
    turns: items.length,
    capped: items.length >= usagePageSize,
    failures: items.filter((t) => t.status !== "ok").length,
    medianLatencyMs: median(latencies),
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** Narrows an untrusted Logs response to the fields used; anything else is dropped. */
export function parseUsageTurns(body: unknown): UsageTurn[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((row): UsageTurn[] => {
    if (!row || typeof row !== "object") return [];
    const { started_at, status, latency_ms } = row as Record<string, unknown>;
    if (typeof started_at !== "string" || typeof status !== "string") return [];
    return [{ started_at, status, latency_ms: typeof latency_ms === "number" ? latency_ms : null }];
  });
}
