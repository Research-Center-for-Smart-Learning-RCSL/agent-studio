import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { modelPresets, organizations, projects } from "@/db/schema";
import { getAgent, getVersion, listVersions } from "@/lib/agents";
import { can, requireUser } from "@/lib/authz";
import { logsConfigured } from "@/lib/logs";
import { toolFileAvailable } from "@/lib/tool-file-credentials";
import { AgentEditor, type ToolTemplate } from "./agent-editor";
import { AgentUsageLine } from "./agent-usage-line";

export default async function AgentPage(props: PageProps<"/agents/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const { v } = await props.searchParams;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "viewer")) notFound();

  const versions = await listVersions(id);
  const selected =
    (typeof v === "string" && Number.isInteger(Number(v)) && (await getVersion(id, Number(v)))) ||
    (found.agent.publishedVersion !== null ? await getVersion(id, found.agent.publishedVersion) : null) ||
    (versions[0] ? await getVersion(id, versions[0].version) : null);

  // File and vector-store references are scoped to the agent's OpenAI project.
  const templates = await db.execute<{ key: string; tool: Record<string, unknown> }>(sql`
    select distinct on (key) key, tool from (
      select coalesce(t->>'name', t->>'server_label', t->>'type') as key, t as tool, a.updated_at
      from agents a
      join agent_versions v on v.agent_id = a.id and v.version = a.published_version
      cross join lateral jsonb_array_elements(v.tools) t
      where a.archived_at is null
        and (a.project_id = ${found.agent.projectId}
          or t->>'type' not in ('code_interpreter', 'shell', 'file_search'))
    ) x order by key, updated_at desc`);

  const presetRows = await db.select({ model: modelPresets.model, costly: modelPresets.costly }).from(modelPresets).orderBy(asc(modelPresets.position));

  const canEdit = can(user, found.agent.projectId, "editor");
  const editableProjectIds = [...user.projectRoles.keys()].filter((projectId) => can(user, projectId, "editor"));
  const copyProjects = selected && (user.isAdmin || editableProjectIds.length > 0)
    ? await db.select({ id: projects.id, name: projects.name, organizationName: organizations.name })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(and(eq(projects.active, true), user.isAdmin ? undefined : inArray(projects.id, editableProjectIds)))
      .orderBy(asc(organizations.name), asc(projects.name), asc(projects.id))
    : [];

  return (
    <AgentEditor
      key={`${id}@${selected?.version ?? 0}`}
      userEmail={user.email}
      logsEnabled={logsConfigured()}
      usageSlot={
        logsConfigured() ? (
          <Suspense fallback={null}>
            <AgentUsageLine user={user} agent={{ id: found.agent.id, projectId: found.agent.projectId }} />
          </Suspense>
        ) : null
      }
      agent={{
        id: found.agent.id,
        name: found.agent.name,
        description: found.agent.description,
        projectId: found.agent.projectId,
        projectName: found.projectName,
        organizationName: found.organizationName,
        publishedVersion: found.agent.publishedVersion,
        archived: found.agent.archivedAt !== null,
      }}
      versions={versions.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() }))}
      selected={
        selected
          ? {
              version: selected.version,
              model: selected.model,
              instructions: selected.instructions,
              tools: selected.tools,
              settings: selected.settings,
            }
          : null
      }
      canEdit={canEdit}
      copyProjects={copyProjects}
      canUploadToolFiles={canEdit && !found.agent.archivedAt && found.projectActive && (await toolFileAvailable(found.agent.projectId))}
      toolTemplates={templates.rows.map((r) => ({ key: r.key, tool: r.tool })) satisfies ToolTemplate[]}
      modelPresets={presetRows}
    />
  );
}
