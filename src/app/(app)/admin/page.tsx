import { notFound } from "next/navigation";
import { asc, desc, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, memberships, organizations, projects, secrets, users } from "@/db/schema";
import { canOpenAdmin, requireUser } from "@/lib/authz";
import { credentialGranted, mcpCredentialReferences } from "@/lib/mcp-credentials";
import { AdminPanel } from "./admin-panel";

export default async function AdminPage() {
  const user = await requireUser();
  if (!canOpenAdmin(user)) notFound();

  // An organization manager sees only the organizations they manage; admins see everything.
  const scoped = !user.isAdmin;
  const orgIds = [...user.managedOrgIds];
  const orgList = sql.join(orgIds.map((id) => sql`${id}`), sql`, `);
  const scopedProjects = scoped ? (await db.select({ id: projects.id }).from(projects).where(inArray(projects.organizationId, orgIds))).map((p) => p.id) : [];
  const projectList = scopedProjects.length ? sql.join(scopedProjects.map((id) => sql`${id}`), sql`, `) : sql`''`;

  const [membershipRows, orgRows, projectRows, secretRows, auditRaw, toolRowsAll] = await Promise.all([
    scoped
      ? db.select().from(memberships).where(or(inArray(memberships.organizationId, orgIds), scopedProjects.length ? inArray(memberships.projectId, scopedProjects) : undefined))
      : db.select().from(memberships),
    db.select().from(organizations).where(scoped ? inArray(organizations.id, orgIds) : undefined).orderBy(asc(organizations.name)),
    db.select().from(projects).where(scoped ? inArray(projects.organizationId, orgIds) : undefined).orderBy(asc(projects.name)),
    db.select({
      name: secrets.name, description: secrets.description, grants: secrets.grants, organizationId: secrets.organizationId,
      updatedBy: secrets.updatedBy, updatedAt: secrets.updatedAt,
    }).from(secrets).where(scoped ? inArray(secrets.organizationId, orgIds) : undefined).orderBy(asc(secrets.name)),
    scoped
      ? db.execute<{ id: number; actor: string | null; action: string; targetType: string; targetId: string; detail: unknown; createdAt: Date }>(sql`
          select e.id, e.actor, e.action, e.target_type as "targetType", e.target_id as "targetId", e.detail, e.created_at as "createdAt"
          from audit_events e
          left join agents ag on e.target_type = 'agent' and ag.id = e.target_id
          left join projects ap on ap.id = ag.project_id
          left join projects dp on dp.id = e.detail->>'projectId'
          left join projects sp on sp.id = e.detail->>'scopeId'
          where ap.organization_id in (${orgList}) or dp.organization_id in (${orgList}) or sp.organization_id in (${orgList})
             or e.detail->>'organizationId' in (${orgList}) or e.detail->>'scopeId' in (${orgList})
          order by e.id desc limit 200`).then((r) => r.rows)
      : db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(200),
    db.execute<{ id: string; name: string; projectId: string; tools: Record<string, unknown>[] }>(sql`
      select a.id, a.name, a.project_id as "projectId", v.tools from agents a
      join agent_versions v on v.agent_id = a.id and v.version = a.published_version
      where a.archived_at is null and v.tools::text like '%"mcp"%'
      ${scoped ? sql`and a.project_id in (${projectList})` : sql``}`),
  ]);
  const toolRows = { rows: toolRowsAll.rows };
  // Users: everyone for admins; for a manager, the people holding a membership in their organizations, and themselves.
  const memberEmails = new Set([user.email, ...membershipRows.map((m) => m.userEmail)]);
  const userRows = (await db.select().from(users).orderBy(asc(users.email))).filter((u) => !scoped || memberEmails.has(u.email));
  const auditRows = auditRaw as { id: number; actor: string | null; action: string; targetType: string; targetId: string; detail: unknown; createdAt: Date }[];

  // Published agents whose MCP tools have no credential reference yet.
  const mcpWithoutSecret = toolRows.rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      servers: r.tools
        .filter((t) => t.type === "mcp" && mcpCredentialReferences(t).length === 0)
        .map((t) => String(t.server_label ?? t.server_url ?? "mcp")),
    }))
    .filter((r) => r.servers.length);
  // Whether a credential is granted does not depend on who owns it, so every secret's grants are read here and never sent on.
  const allGrants = scoped ? await db.select({ name: secrets.name, grants: secrets.grants }).from(secrets) : secretRows;
  const grantsByName = new Map(allGrants.map((secret) => [secret.name, secret.grants]));
  const unapprovedReferences = toolRows.rows.flatMap(({ id, name, projectId, tools }) => tools
    .flatMap(mcpCredentialReferences)
    .filter((reference) => !credentialGranted(grantsByName.get(reference.name), projectId, reference))
    .map(({ serverUrl, field, name: secret }) => ({ id, name, projectId, serverUrl, field, secret })));

  return (
    <AdminPanel
      me={user.email}
      isAdmin={user.isAdmin}
      managedOrgIds={orgIds}
      users={userRows.map((u) => ({ email: u.email, name: u.name, isAdmin: u.isAdmin, lastSeenAt: u.lastSeenAt?.toISOString() ?? null }))}
      memberships={membershipRows.map((m) => ({ id: m.id, userEmail: m.userEmail, organizationId: m.organizationId, projectId: m.projectId, role: m.role }))}
      organizations={orgRows.map((o) => ({ id: o.id, name: o.name, active: o.active }))}
      projects={projectRows.map((p) => ({ id: p.id, name: p.name, organizationId: p.organizationId, active: p.active }))}
      secrets={secretRows.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }))}
      audit={auditRows.map((a) => ({ ...a, createdAt: new Date(a.createdAt).toISOString() }))}
      mcpWithoutSecret={mcpWithoutSecret}
      unapprovedReferences={unapprovedReferences}
    />
  );
}
