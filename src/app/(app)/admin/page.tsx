import { notFound } from "next/navigation";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, memberships, organizations, projects, secrets, users } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { secretNamesIn } from "@/lib/secrets";
import { AdminPanel } from "./admin-panel";

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();

  const [userRows, membershipRows, orgRows, projectRows, secretRows, auditRows, toolRows] = await Promise.all([
    db.select().from(users).orderBy(asc(users.email)),
    db.select().from(memberships),
    db.select().from(organizations).orderBy(asc(organizations.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select({ name: secrets.name, description: secrets.description, updatedBy: secrets.updatedBy, updatedAt: secrets.updatedAt }).from(secrets).orderBy(asc(secrets.name)),
    db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(200),
    db.execute<{ id: string; name: string; tools: unknown }>(sql`
      select a.id, a.name, v.tools from agents a
      join agent_versions v on v.agent_id = a.id and v.version = a.published_version
      where a.archived_at is null and v.tools::text like '%"mcp"%'`),
  ]);

  // Published agents whose MCP tools have no credential reference yet.
  const mcpWithoutSecret = toolRows.rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      servers: (r.tools as Record<string, unknown>[])
        .filter((t) => t.type === "mcp" && secretNamesIn(t).size === 0)
        .map((t) => String(t.server_label ?? t.server_url ?? "mcp")),
    }))
    .filter((r) => r.servers.length);
  const definedSecrets = new Set(secretRows.map((s) => s.name));
  const missingSecrets = [
    ...new Set(toolRows.rows.flatMap((r) => [...secretNamesIn(r.tools)]).filter((n) => !definedSecrets.has(n))),
  ];

  return (
    <AdminPanel
      me={user.email}
      users={userRows.map((u) => ({ email: u.email, name: u.name, isAdmin: u.isAdmin, lastSeenAt: u.lastSeenAt?.toISOString() ?? null }))}
      memberships={membershipRows.map((m) => ({ id: m.id, userEmail: m.userEmail, organizationId: m.organizationId, projectId: m.projectId, role: m.role }))}
      organizations={orgRows.map((o) => ({ id: o.id, name: o.name, active: o.active }))}
      projects={projectRows.map((p) => ({ id: p.id, name: p.name, organizationId: p.organizationId, active: p.active }))}
      secrets={secretRows.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }))}
      audit={auditRows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
      mcpWithoutSecret={mcpWithoutSecret}
      missingSecrets={missingSecrets}
    />
  );
}
