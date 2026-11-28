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

type Translate = (key: string, args?: (string | number)[]) => string;

/**
 * The pieces of the usage line. Every `t()` takes a literal so the translation coverage test sees it.
 * With a full page the other figures cover only the newest turns, which the first piece says.
 */
export function usageParts(usage: AgentUsage, t: Translate, formatTime: (iso: string) => string): string[] {
  if (usage.turns === 0) return [t("近 7 天沒有使用紀錄")];
  const parts = [
    usage.capped
      ? t("近 7 天至少 {0} 回合，以下數據只涵蓋最近 {1} 回合", [usage.turns, usage.turns])
      : t("近 7 天回合數 {0}", [usage.turns]),
  ];
  if (usage.failures > 0) parts.push(t("失敗 {0}", [usage.failures]));
  if (usage.medianLatencyMs !== null) parts.push(t("延遲中位數 {0} 秒", [(usage.medianLatencyMs / 1000).toFixed(1)]));
  if (usage.lastAt) parts.push(t("最近使用 {0}", [formatTime(usage.lastAt)]));
  return parts;
}

/** A small in-memory cache with a lifetime per entry and a size bound, so a stalled or heavy source is asked rarely. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { until: number; value: V }>();
  constructor(private readonly maxEntries: number, private readonly now: () => number = () => Date.now()) {}

  get(key: string): { value: V } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: entry.value };
  }

  set(key: string, value: V, ttlMs: number) {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { until: this.now() + ttlMs, value });
  }
}
