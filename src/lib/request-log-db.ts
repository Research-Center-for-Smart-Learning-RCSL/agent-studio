import "server-only";
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requestLogs } from "@/db/schema";
import { failureEvents, likePattern, logPageSize, logRanges, type LogQuery } from "./request-log-query";
import { IntervalGate, LogWriter, maxStoredRows, retentionDays, rowFromEntry, type LogRow, type LogStore } from "./request-log-store";
import { setPersistHook } from "./request-log";

const globals = globalThis as Record<symbol, unknown>;
const poolKey = Symbol.for("agent-studio.request-log.pool");
const installedKey = Symbol.for("agent-studio.request-log.installed");

/**
 * Log writes and the admin page use their own small pool, with timeouts. A database that hangs then costs the log a
 * few connections for a few seconds, and never the connections the application's own requests wait for.
 */
function logPool(): Pool {
  let pool = globals[poolKey] as Pool | undefined;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000, statement_timeout: 10_000, query_timeout: 12_000 });
    pool.on("error", () => {});
    globals[poolKey] = pool;
  }
  return pool;
}

const logDb = () => drizzle(logPool());

/** For tests: closes the pool so the process can exit. */
export async function closeLogPool() {
  const pool = globals[poolKey] as Pool | undefined;
  globals[poolKey] = undefined;
  await pool?.end();
}

const toValues = (rows: LogRow[]) =>
  rows.map((r) => ({ ts: r.ts, source: r.source, event: r.event, route: r.route, status: r.status, ms: r.ms, projectId: r.projectId, agentId: r.agentId, detail: r.detail }));

/** Deletes rows older than `cutoff`, then the oldest beyond `cap` rows. */
export async function pruneLogRows(cutoff: Date, cap: number) {
  const db = logDb();
  await db.delete(requestLogs).where(lt(requestLogs.ts, cutoff));
  await db.execute(sql`delete from request_logs where id <= (select id from request_logs order by id desc offset ${cap} limit 1)`);
}

const pruneGate = new IntervalGate(3_600_000);
let lastPruneReport = 0;

/** Every insert may trim the table, so retention holds whichever writer is active. A failed trim is only reported. */
export async function insertLogRows(rows: LogRow[]) {
  if (rows.length === 0) return;
  await logDb().insert(requestLogs).values(toValues(rows));
  void pruneGate.run(() => pruneLogRows(new Date(Date.now() - retentionDays * 86_400_000), maxStoredRows)).catch((error) => reportFailure(`prune: ${String(error)}`));
}

function reportFailure(message: string) {
  // Straight to stdout: going through logEvent would store the failure of storing.
  const now = Date.now();
  if (now - lastPruneReport < 60_000) return;
  lastPruneReport = now;
  console.error(JSON.stringify({ ts: new Date(now).toISOString(), event: "request_log_store_failed", message: message.replace(/\s+/g, " ").slice(0, 200) }));
}

const store: LogStore = { insert: insertLogRows };

/** Starts storing every logged line. Calling it again does nothing; a failure to start leaves logging on stdout alone. */
export function installDatabaseLogWriter() {
  if (globals[installedKey]) return;
  globals[installedKey] = true;
  const writer = new LogWriter(store, { onError: reportFailure });
  setPersistHook((entry) => writer.add(rowFromEntry(entry)));
}

/** For tests. */
export function resetDatabaseLogWriter() {
  globals[installedKey] = undefined;
  setPersistHook(null);
}

const isFailure = sql`(${requestLogs.status} >= 400 or ${requestLogs.event} in (${sql.join(failureEvents.map((e) => sql`${e}`), sql`, `)}))`;

function filters(query: LogQuery, now: number): SQL[] {
  const conditions: SQL[] = [gte(requestLogs.ts, new Date(now - logRanges[query.range]))];
  if (query.source !== "all") conditions.push(eq(requestLogs.source, query.source));
  return conditions;
}

export type LogEntry = {
  id: number;
  ts: Date;
  source: string;
  event: string;
  route: string | null;
  status: number | null;
  ms: number | null;
  projectId: string | null;
  agentId: string | null;
  detail: Record<string, unknown> | null;
};

export async function readRequestLogs(query: LogQuery, now = Date.now()): Promise<{ rows: LogEntry[]; hasMore: boolean; summary: { source: string; event: string; total: number; failures: number }[] }> {
  const base = filters(query, now);
  const conditions = [...base];
  if (query.event) conditions.push(eq(requestLogs.event, query.event));
  if (query.errorsOnly) conditions.push(isFailure);
  if (query.before) conditions.push(lt(requestLogs.id, query.before));
  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(requestLogs.route, pattern),
        ilike(requestLogs.agentId, pattern),
        ilike(requestLogs.projectId, pattern),
        sql`${requestLogs.detail}->>'reason' ilike ${pattern}`,
        sql`${requestLogs.detail}->>'message' ilike ${pattern}`,
        sql`${requestLogs.detail}->>'key_fp' ilike ${pattern}`,
        sql`${requestLogs.detail}->>'ip' ilike ${pattern}`,
      ) as SQL,
    );
  }
  const [page, summary] = await Promise.all([
    logDb().select().from(requestLogs).where(and(...conditions)).orderBy(desc(requestLogs.id)).limit(logPageSize + 1),
    logDb()
      .select({
        source: requestLogs.source,
        event: requestLogs.event,
        total: sql<number>`count(*)::int`,
        failures: sql<number>`(count(*) filter (where ${isFailure}))::int`,
      })
      .from(requestLogs)
      .where(and(...base))
      .groupBy(requestLogs.source, requestLogs.event)
      .orderBy(requestLogs.source, requestLogs.event),
  ]);
  return { rows: page.slice(0, logPageSize), hasMore: page.length > logPageSize, summary };
}
