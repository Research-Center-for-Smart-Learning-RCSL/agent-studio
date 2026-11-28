import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import type { CurrentUser } from "@/lib/authz";
import { parseUsageTurns, summarizeUsage, TtlCache, usagePageSize, usageWindowDays, type AgentUsage } from "@/lib/agent-usage";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/request-log";
import { encodeScope, logsCaller, maxScopeHeaderLength, type ScopeFilterInput } from "@/lib/logs-scope";

export function logsConfigured(): boolean {
  return Boolean(env.logsApi && env.logsServiceToken);
}

export class LogsScopeTooLarge extends Error {}

/** The headers that tell Logs who is asking and which projects they may read. */
export async function logsHeaders(user: CurrentUser, filter: ScopeFilterInput, path: string): Promise<Headers> {
  const token = env.logsServiceToken;
  if (!token) throw new Error("LOGS_SERVICE_TOKEN is not set");
  const rows = await db
    .select({ id: projects.id, name: projects.name, organizationId: organizations.id, organizationName: organizations.name })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .orderBy(asc(organizations.name), asc(projects.name));
  const caller = logsCaller({
    isAdmin: user.isAdmin,
    projects: rows,
    readable: user.isAdmin ? null : new Set(user.projectRoles.keys()),
    filter,
    path,
  });
  const headers = new Headers({ "x-studio-token": token, "x-studio-user": user.email });
  if (caller.kind === "admin") {
    headers.set("x-studio-admin", "1");
  } else {
    const scope = encodeScope(caller.pairs);
    if (scope.length > maxScopeHeaderLength) throw new LogsScopeTooLarge();
    headers.set("x-studio-scope", scope);
  }
  return headers;
}

const usageTimeoutMs = 3000;
const usageCache = new TtlCache<AgentUsage | null>(500);
const usageHitMs = 30_000;
// A failure is remembered briefly so that a stalled Logs is not asked, and waited for, on every render.
const usageMissMs = 10_000;

/**
 * Turns of one agent over the last week, summarized, or null when Logs is not configured, slow
 * or answers badly: the editor must open whether or not Logs does. The caller's own project
 * scope applies. A non-administrator is narrowed to the agent's project, which keeps the scope
 * header small; an administrator is not, since turns whose agent no captured list names carry no
 * project and show only without a filter.
 */
export async function fetchAgentUsage(user: CurrentUser, agent: { id: string; projectId: string }): Promise<AgentUsage | null> {
  if (!logsConfigured()) return null;
  const cacheKey = `${user.isAdmin ? "admin" : user.email}::${agent.id}`;
  const cached = usageCache.get(cacheKey);
  if (cached) return cached.value;
  const result = await requestAgentUsage(user, agent);
  usageCache.set(cacheKey, result, result ? usageHitMs : usageMissMs);
  return result;
}

async function requestAgentUsage(user: CurrentUser, agent: { id: string; projectId: string }): Promise<AgentUsage | null> {
  try {
    const headers = await logsHeaders(user, user.isAdmin ? {} : { project: agent.projectId }, "v1/turns");
    headers.set("accept-encoding", "identity");
    const since = new Date(Date.now() - usageWindowDays * 24 * 3600 * 1000).toISOString();
    const query = new URLSearchParams({ prompt: agent.id, since, limit: String(usagePageSize), preview: "1" });
    const response = await fetch(`${env.logsApi}/v1/turns?${query}`, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(usageTimeoutMs),
    });
    if (!response.ok) {
      logEvent("logs_usage_failed", { reason: "http", status: response.status });
      return null;
    }
    const turns = parseUsageTurns(await response.json());
    if (!turns) {
      logEvent("logs_usage_failed", { reason: "unexpected_body" });
      return null;
    }
    return summarizeUsage(turns);
  } catch (error) {
    logEvent("logs_usage_failed", {
      reason: error instanceof LogsScopeTooLarge ? "scope_too_large" : error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}
