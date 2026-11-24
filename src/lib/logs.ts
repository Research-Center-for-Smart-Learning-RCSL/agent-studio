import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import type { CurrentUser } from "@/lib/authz";
import { env } from "@/lib/env";
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
