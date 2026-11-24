"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, memberships, projects, secrets, users } from "@/db/schema";
import {
  createAgent,
  getAgent,
  publishVersion,
  saveVersion,
  setArchived,
  updateAgentMeta,
} from "@/lib/agents";
import { ForbiddenError, requireAdmin, requireProjectRole } from "@/lib/authz";
import { instructionsToString, sanitizeTools } from "@/lib/openai-shape";
import { syncFromRcsl } from "@/lib/rcsl";
import { encryptSecret } from "@/lib/secrets";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "沒有權限" };
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    // redirect() and notFound() must propagate.
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { ok: false, error: (error as Error).message };
  }
}

const messageSchema = z.object({
  role: z.enum(["developer", "system", "user", "assistant"]),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});

const versionSchema = z.object({
  model: z.string().trim().min(1, "必填"),
  instructions: z.array(messageSchema),
  tools: z.array(z.record(z.string(), z.unknown()).refine((t) => typeof t.type === "string", "每個工具都要有 type")),
  settings: z.object({
    reasoning: z.record(z.string(), z.unknown()).nullable().optional(),
    text: z.record(z.string(), z.unknown()).nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    top_p: z.number().min(0).max(1).nullable().optional(),
    max_output_tokens: z.number().int().positive().nullable().optional(),
    truncation: z.string().nullable().optional(),
    parallel_tool_calls: z.boolean().nullable().optional(),
  }),
  note: z.string().max(500).optional(),
});

export type VersionPayload = z.infer<typeof versionSchema>;

function validateVersion(input: unknown) {
  const parsed = versionSchema.parse(input);
  // Reject what the runtime could not send, at save time rather than in class.
  instructionsToString(parsed.instructions);
  sanitizeTools(parsed.tools);
  return parsed;
}

/** New agents start on whatever model most published agents already use. */
async function mostUsedModel(): Promise<string> {
  const rows = await db.execute<{ model: string }>(sql`
    select v.model from agents a
    join agent_versions v on v.agent_id = a.id and v.version = a.published_version
    where a.archived_at is null
    group by v.model order by count(*) desc limit 1`);
  return rows.rows[0]?.model ?? "gpt-5.2";
}

async function projectOf(agentId: string) {
  const found = await getAgent(agentId);
  if (!found) throw new Error("agent 不存在");
  return found.agent.projectId;
}

export async function saveVersionAction(agentId: string, input: unknown, publish: boolean) {
  return run(async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    const version = await saveVersion(agentId, validateVersion(input), user.email, publish);
    revalidatePath(`/agents/${agentId}`);
    return version;
  });
}

export async function publishVersionAction(agentId: string, version: number) {
  return run(async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    await publishVersion(agentId, version, user.email);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentMetaAction(agentId: string, meta: { name: string; description: string }) {
  return run(async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    const parsed = z.object({ name: z.string().trim().min(1), description: z.string().max(2000) }).parse(meta);
    await updateAgentMeta(agentId, parsed, user.email);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function setArchivedAction(agentId: string, archived: boolean) {
  return run(async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    await setArchived(agentId, archived, user.email);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/");
  });
}

export async function createAgentAction(projectId: string, name: string, copyFrom?: { agentId: string; version: VersionPayload }) {
  return run(async () => {
    const user = await requireProjectRole(projectId, "editor");
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) throw new Error("專案不存在");
    if (!project.active) throw new Error("專案已停用");
    const initial = copyFrom
      ? validateVersion(copyFrom.version)
      : validateVersion({
          model: await mostUsedModel(),
          instructions: [{ role: "developer", content: "" }],
          tools: [],
          settings: {},
        });
    const id = await createAgent(projectId, z.string().trim().min(1).parse(name), user.email, {
      ...initial,
      note: copyFrom ? `複製自 ${copyFrom.agentId}` : "",
    });
    revalidatePath("/");
    return id;
  });
}

// Admin

export async function syncRcslAction() {
  return run(async () => {
    const admin = await requireAdmin();
    const result = await syncFromRcsl();
    await db.insert(auditEvents).values({ actor: admin.email, action: "rcsl.sync", targetType: "system", targetId: "rcsl", detail: result });
    revalidatePath("/admin");
    return result;
  });
}

export async function addMembershipAction(input: { email: string; scope: "organization" | "project"; scopeId: string; role: "viewer" | "editor" }) {
  return run(async () => {
    const admin = await requireAdmin();
    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        scope: z.enum(["organization", "project"]),
        scopeId: z.string().min(1),
        role: z.enum(["viewer", "editor"]),
      })
      .parse(input);
    await db.insert(users).values({ email: parsed.email }).onConflictDoNothing();
    const scopeColumns =
      parsed.scope === "organization" ? { organizationId: parsed.scopeId } : { projectId: parsed.scopeId };
    const target = parsed.scope === "organization" ? [memberships.userEmail, memberships.organizationId] : [memberships.userEmail, memberships.projectId];
    await db
      .insert(memberships)
      .values({ userEmail: parsed.email, role: parsed.role, ...scopeColumns })
      .onConflictDoUpdate({ target, set: { role: parsed.role } });
    await db.insert(auditEvents).values({ actor: admin.email, action: "membership.set", targetType: "user", targetId: parsed.email, detail: parsed });
    revalidatePath("/admin");
  });
}

export async function removeMembershipAction(id: number) {
  return run(async () => {
    const admin = await requireAdmin();
    const [removed] = await db.delete(memberships).where(eq(memberships.id, id)).returning();
    if (removed) {
      await db.insert(auditEvents).values({ actor: admin.email, action: "membership.remove", targetType: "user", targetId: removed.userEmail, detail: { ...removed } });
    }
    revalidatePath("/admin");
  });
}

export async function deleteUserAction(email: string) {
  return run(async () => {
    const admin = await requireAdmin();
    const target = z.string().trim().toLowerCase().email().parse(email);
    if (target === admin.email) throw new Error("不能刪除自己的帳號");
    await db.transaction(async (tx) => {
      const [removed] = await tx.delete(users).where(eq(users.email, target)).returning();
      if (!removed) throw new Error("帳號不存在");
      await tx.insert(auditEvents).values({ actor: admin.email, action: "user.delete", targetType: "user", targetId: target });
    });
    revalidatePath("/admin");
  });
}

export async function setAdminAction(email: string, isAdmin: boolean) {
  return run(async () => {
    const admin = await requireAdmin();
    const target = z.string().trim().toLowerCase().email().parse(email);
    if (target === admin.email && !isAdmin) throw new Error("不能移除自己的管理員身分");
    await db.update(users).set({ isAdmin }).where(eq(users.email, target));
    await db.insert(auditEvents).values({ actor: admin.email, action: isAdmin ? "admin.grant" : "admin.revoke", targetType: "user", targetId: target });
    revalidatePath("/admin");
  });
}

export async function setSecretAction(input: { name: string; value: string; description: string }) {
  return run(async () => {
    const admin = await requireAdmin();
    const parsed = z
      .object({
        name: z.string().regex(/^[A-Za-z0-9_.-]+$/, "只能用英數字、底線、點、減號"),
        value: z.string().min(1),
        description: z.string().max(500),
      })
      .parse(input);
    const values = { ciphertext: encryptSecret(parsed.value), description: parsed.description, updatedBy: admin.email, updatedAt: new Date() };
    await db.insert(secrets).values({ name: parsed.name, ...values }).onConflictDoUpdate({ target: secrets.name, set: values });
    await db.insert(auditEvents).values({ actor: admin.email, action: "secret.set", targetType: "secret", targetId: parsed.name });
    revalidatePath("/admin");
  });
}

export async function deleteSecretAction(name: string) {
  return run(async () => {
    const admin = await requireAdmin();
    await db.delete(secrets).where(and(eq(secrets.name, name)));
    await db.insert(auditEvents).values({ actor: admin.email, action: "secret.delete", targetType: "secret", targetId: name });
    revalidatePath("/admin");
  });
}
