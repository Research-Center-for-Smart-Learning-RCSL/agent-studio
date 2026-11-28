/**
 * Structured request logging: one JSON object per line on stdout, so `docker logs` can be
 * filtered with grep or jq. Lines never carry a token, a key, a cookie or a query string.
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

/** A message short enough for one log line, without line breaks that could forge another line. */
export function shortMessage(value: unknown, max = 200): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/\s+/g, " ").slice(0, max);
}

/** The path of a URL without its query string. */
export function pathOnly(url: string): string {
  const index = url.search(/[?#]/);
  return index === -1 ? url : url.slice(0, index);
}

type ParamsContext = { params?: Promise<Record<string, string | string[] | undefined>> };

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
      });
    }
  };
}
