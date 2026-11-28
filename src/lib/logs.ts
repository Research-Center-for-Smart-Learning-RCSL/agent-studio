import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import type { CurrentUser } from "@/lib/authz";
import { parseUsageTurns, summarizeUsage, usagePageSize, usageWindowDays, type AgentUsage } from "@/lib/agent-usage";
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

/**
 * Turns of one agent over the last week, summarized, or null when Logs is not configured, slow
 * or answers badly: the editor must open whether or not Logs does. The caller's own project
 * scope applies, so a user sees only the turns of projects they may read.
 */
export async function fetchAgentUsage(user: CurrentUser, agentId: string): Promise<AgentUsage | null> {
  if (!logsConfigured()) return null;
  try {
    const headers = await logsHeaders(user, {}, "v1/turns");
    headers.set("accept-encoding", "identity");
    const since = new Date(Date.now() - usageWindowDays * 24 * 3600 * 1000).toISOString();
    const query = new URLSearchParams({ prompt: agentId, since, limit: String(usagePageSize), preview: "1" });
    const response = await fetch(`${env.logsApi}/v1/turns?${query}`, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(usageTimeoutMs),
    });
    if (!response.ok) return null;
    const turns = parseUsageTurns(await response.json());
    return turns ? summarizeUsage(turns) : null;
  } catch (error) {
    logEvent("logs_usage_failed", { name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}
