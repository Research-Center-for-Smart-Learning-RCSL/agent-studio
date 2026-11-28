export const logRanges = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 } as const;
export type LogRange = keyof typeof logRanges;
export const logPageSize = 100;

/** Events whose very existence means something went wrong, whatever their status. */
export const failureEvents = ["request_error", "action_failed", "logs_usage_failed"] as const;

export type LogQuery = {
  source: "all" | "studio" | "backend";
  range: LogRange;
  event: string | null;
  errorsOnly: boolean;
  search: string | null;
  /** Keyset cursor: only rows with a smaller id. */
  before: number | null;
};

/** Reads the filters of the admin page from a URL; anything unknown falls back to the default rather than failing. */
export function parseLogQuery(params: URLSearchParams): LogQuery {
  const source = params.get("source");
  const range = params.get("range");
  const event = params.get("event");
  const search = (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const before = Number(params.get("before"));
  return {
    source: source === "studio" || source === "backend" ? source : "all",
    range: range !== null && Object.hasOwn(logRanges, range) ? (range as LogRange) : "24h",
    event: event !== null && /^[a-z_]{1,40}$/.test(event) ? event : null,
    errorsOnly: params.get("errors") === "1",
    search: search || null,
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
}

export type PageRequest = {
  /** Bumped by every reload and every filter change. */
  generation: number;
  /** The id of the last row shown when a "load more" was sent; null for a first page. */
  cursor: number | null;
};

/**
 * Whether an answer still belongs to what is on screen: the same reload generation, and for "load more" the same last
 * row. Without this, a refresh that lands first, or a filter change, would let an old page join the wrong list.
 */
export function responseStillWanted(sent: PageRequest, now: PageRequest): boolean {
  return sent.generation === now.generation && sent.cursor === now.cursor;
}

/** Escapes the characters a LIKE pattern treats specially, so a search for "50%" finds "50%". */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
