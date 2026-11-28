/**
 * Structured request logging: one JSON object per line on stdout, so `docker logs` can be
 * filtered with grep or jq. Lines never carry a token, a key, a cookie, a query string or
 * the values of a failed database query. See docs/logging.md.
 */

export type LogSink = (line: string) => void;

let sink: LogSink = (line) => console.log(line);

/** Tests swap the output; production keeps stdout. */
export function setLogSink(next: LogSink | null) {
  sink = next ?? ((line) => console.log(line));
}

export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), event, ...fields };
  for (const key of Object.keys(entry)) if (entry[key] === undefined || entry[key] === null) delete entry[key];
  sink(JSON.stringify(entry));
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").slice(0, max);
}

/** The five-character SQLSTATE of a database error, on the error itself (pg) or on its cause (Drizzle). */
function sqlState(error: Error): string | undefined {
  const cause = (error as { cause?: unknown }).cause;
  const inner = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  for (const code of [inner, (error as { code?: unknown }).code]) {
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/**
 * Whether an error comes from the database layer. Drizzle puts the SQL and the parameter values in the
 * message ("Failed query: ...\nparams: ..."), and PostgreSQL messages quote offending values, so neither
 * may be logged.
 */
function isDatabaseError(error: Error): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    "query" in error ||
    "params" in error ||
    error.message.startsWith("Failed query:") ||
    ("severity" in error && typeof code === "string")
  );
}

/** An error as a log-safe single line: the message, except for database errors, which give only the SQLSTATE code. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return oneLine(String(error), 200);
  if (isDatabaseError(error)) {
    const code = sqlState(error);
    return code ? `database query failed (${code})` : "database query failed";
  }
  return oneLine(error.message, 200);
}

/** A message short enough for one log line, without line breaks that could forge another line. */
export function shortMessage(value: unknown, max = 200): string {
  return value instanceof Error ? describeError(value).slice(0, max) : oneLine(String(value), max);
}

/** The path of a URL without its query string. */
export function pathOnly(url: string): string {
  const index = url.search(/[?#]/);
  return index === -1 ? url : url.slice(0, index);
}

type ParamsContext = { params?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Rejected calls are the only ones anyone can send in volume without credentials, and a flood of them would push
 * real history out of the capped log. At most one rejection line is written per interval, counting those skipped.
 */
export const rejectionIntervalMs = 10_000;
const rejections = { last: 0, skipped: 0 };

export function resetRejectionSampling() {
  rejections.last = 0;
  rejections.skipped = 0;
}

function rejectionLine(): { log: boolean; skipped: number } {
  const now = Date.now();
  if (rejections.last !== 0 && now - rejections.last < rejectionIntervalMs) {
    rejections.skipped += 1;
    return { log: false, skipped: 0 };
  }
  const skipped = rejections.skipped;
  rejections.last = now;
  rejections.skipped = 0;
  return { log: true, skipped };
}

/**
 * Wraps a route handler so each call logs its route, status, duration and the ids in its path.
 * A handler that throws is logged as a 500 and the error is rethrown for Next to handle.
 */
export function loggedRoute<C extends ParamsContext>(route: string, handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const started = performance.now();
    let status = 500;
    let reason: string | undefined;
    try {
      const response = await handler(request, ctx);
      status = response.status;
      return response;
    } catch (error) {
      reason = shortMessage(error);
      throw error;
    } finally {
      const sampled = status === 401 ? rejectionLine() : { log: true, skipped: 0 };
      if (sampled.log) {
        const params = (await ctx.params?.catch(() => undefined)) ?? {};
        const id = (name: string) => {
          const value = params[name];
          return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : value === undefined ? undefined : "invalid";
        };
        logEvent("request", {
          route,
          method: request.method,
          status,
          ms: Math.round(performance.now() - started),
          project_id: id("projectId"),
          agent_id: id("agentId"),
          reason,
          skipped_rejections: sampled.skipped || undefined,
        });
      }
    }
  };
}
