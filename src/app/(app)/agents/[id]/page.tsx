import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getAgent, getVersion, listVersions } from "@/lib/agents";
import { can, requireUser } from "@/lib/authz";
import { AgentEditor, type ToolTemplate } from "./agent-editor";

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

  // Tool templates: the latest definition of every named tool across published agents.
  const templates = await db.execute<{ key: string; tool: Record<string, unknown> }>(sql`
    select distinct on (key) key, tool from (
      select coalesce(t->>'name', t->>'server_label', t->>'type') as key, t as tool, a.updated_at
      from agents a
      join agent_versions v on v.agent_id = a.id and v.version = a.published_version
      cross join lateral jsonb_array_elements(v.tools) t
      where a.archived_at is null
    ) x order by key, updated_at desc`);

  const models = await db.execute<{ model: string }>(sql`
    select model from agent_versions group by model order by count(*) desc limit 30`);

  return (
    <AgentEditor
      key={`${id}@${selected?.version ?? 0}`}
      agent={{
        id: found.agent.id,
        name: found.agent.name,
        description: found.agent.description,
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
      canEdit={can(user, found.agent.projectId, "editor")}
      toolTemplates={templates.rows.map((r) => ({ key: r.key, tool: r.tool })) satisfies ToolTemplate[]}
      modelSuggestions={models.rows.map((r) => r.model)}
    />
  );
}
