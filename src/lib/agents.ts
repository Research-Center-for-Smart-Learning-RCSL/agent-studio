import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentCopyName } from "@/lib/agent-copy-name";
import {
  agents,
  agentVersions,
  auditEvents,
  projects,
  organizations,
  type AgentSettings,
  type InstructionMessage,
} from "@/db/schema";

export type VersionInput = {
  model: string;
  instructions: InstructionMessage[];
  tools: Record<string, unknown>[];
  settings: AgentSettings;
  note?: string;
};

export async function listAgentsForProjects(projectIds: string[] | "all", includeArchived = false) {
  const conditions = [];
  if (projectIds !== "all") {
    if (!projectIds.length) return [];
    conditions.push(inArray(agents.projectId, projectIds));
  }
  if (!includeArchived) conditions.push(isNull(agents.archivedAt));
  return db
    .select({
      id: agents.id,
      name: agents.name,
      projectId: agents.projectId,
      projectName: projects.name,
      organizationId: projects.organizationId,
      organizationName: organizations.name,
      publishedVersion: agents.publishedVersion,
      updatedAt: agents.updatedAt,
      archivedAt: agents.archivedAt,
      latestVersion: sql<number | null>`(select max(version) from agent_versions v where v.agent_id = ${agents.id})`,
    })
    .from(agents)
    .innerJoin(projects, eq(projects.id, agents.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(and(...conditions))
    .orderBy(asc(organizations.name), asc(projects.name), asc(agents.name));
}

export async function getAgent(id: string) {
  const [row] = await db
    .select({
      agent: agents,
      projectName: projects.name,
      projectActive: projects.active,
      organizationId: projects.organizationId,
      organizationName: organizations.name,
    })
    .from(agents)
    .innerJoin(projects, eq(projects.id, agents.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(agents.id, id));
  return row ?? null;
}

export async function listVersions(agentId: string) {
  return db
    .select({
      version: agentVersions.version,
      model: agentVersions.model,
      note: agentVersions.note,
      createdBy: agentVersions.createdBy,
      source: agentVersions.source,
      createdAt: agentVersions.createdAt,
    })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.version));
}

export async function getVersion(agentId: string, version: number) {
  const [row] = await db
    .select()
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.version, version)));
  return row ?? null;
}

/** The version the runtime runs by default: the published one, else the newest. */
export async function getEffectiveVersion(agentId: string) {
  const found = await getAgent(agentId);
  if (!found) return null;
  const version =
    found.agent.publishedVersion ??
    (await db
      .select({ v: sql<number>`max(version)` })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .then((r) => r[0]?.v ?? null));
  if (version === null) return null;
  return getVersion(agentId, version);
}

export async function createAgent(
  projectId: string,
  sourceName: string,
  actor: string,
  initial: VersionInput,
  copyOf?: { id: string; version: number; description: string },
) {
  const id = `agt_${randomBytes(16).toString("hex")}`;
  await db.transaction(async (tx) => {
    // Serialize name allocation for copies into the same project.
    const [project] = await tx.select({ active: projects.active }).from(projects)
      .where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("專案不存在");
    if (!project.active) throw new Error("專案已停用");

    let name = sourceName;
    if (copyOf) {
      const existing = await tx.select({ name: agents.name }).from(agents).where(eq(agents.projectId, projectId));
      name = agentCopyName(sourceName, existing.map((agent) => agent.name));
    }
    await tx.insert(agents).values({ id, projectId, name, description: copyOf?.description, publishedVersion: 1 });
    await tx.insert(agentVersions).values({ agentId: id, version: 1, ...initial, note: initial.note ?? "", createdBy: actor });
    await tx.insert(auditEvents).values({
      actor,
      action: copyOf ? "agent.copy" : "agent.create",
      targetType: "agent",
      targetId: id,
      detail: { projectId, name, ...(copyOf && { sourceAgentId: copyOf.id, sourceVersion: copyOf.version }) },
    });
  });
  return id;
}

/**
 * Append a new immutable version. The agent row is locked so concurrent saves
 * get consecutive numbers instead of colliding.
 */
export async function saveVersion(agentId: string, input: VersionInput, actor: string, publish: boolean) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from agents where id = ${agentId} for update`);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(version), 0) + 1` })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId));
    await tx.insert(agentVersions).values({
      agentId,
      version: next,
      model: input.model,
      instructions: input.instructions,
      tools: input.tools,
      settings: input.settings,
      note: input.note ?? "",
      createdBy: actor,
    });
    await tx
      .update(agents)
      .set({ updatedAt: new Date(), ...(publish ? { publishedVersion: next } : {}) })
      .where(eq(agents.id, agentId));
    await tx.insert(auditEvents).values({
      actor,
      action: publish ? "version.save_and_publish" : "version.save",
      targetType: "agent",
      targetId: agentId,
      detail: { version: next },
    });
    return next;
  });
}

export async function publishVersion(agentId: string, version: number, actor: string) {
  const exists = await getVersion(agentId, version);
  if (!exists) throw new Error(`version ${version} does not exist`);
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ publishedVersion: version, updatedAt: new Date() }).where(eq(agents.id, agentId));
    await tx.insert(auditEvents).values({ actor, action: "version.publish", targetType: "agent", targetId: agentId, detail: { version } });
  });
}

export async function updateAgentMeta(agentId: string, meta: { name?: string; description?: string }, actor: string) {
  await db.transaction(async (tx) => {
    if (meta.name !== undefined) {
      // Name changes and copies into this project must observe each other in order.
      await tx.execute(sql`
        select p.id from projects p
        join agents a on a.project_id = p.id
        where a.id = ${agentId}
        for update of p
      `);
    }
    await tx.update(agents).set({ ...meta, updatedAt: new Date() }).where(eq(agents.id, agentId));
    await tx.insert(auditEvents).values({ actor, action: "agent.update", targetType: "agent", targetId: agentId, detail: meta });
  });
}

export async function setArchived(agentId: string, archived: boolean, actor: string) {
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(agents.id, agentId));
    await tx.insert(auditEvents).values({ actor, action: archived ? "agent.archive" : "agent.unarchive", targetType: "agent", targetId: agentId });
  });
}
