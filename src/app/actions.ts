"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, memberships, modelPresets, projects, secrets, users, type SecretGrant } from "@/db/schema";
import { agentSettingsSchema } from "@/lib/agent-settings";
import {
  createAgent,
  getAgent,
  getVersion,
  publishVersion,
  saveVersion,
  setArchived,
  updateAgentMeta,
} from "@/lib/agents";
import { can, ForbiddenError, requireAdmin, requireManager, requireProjectRole, requireUser, type CurrentUser } from "@/lib/authz";
import { canGrantSecret, canManageOrganization, canManageSecret, membershipOrganization, newSecretOwner, roleFitsScope } from "@/lib/org-admin";
import { mcpServerUrl, validMcpCredentialField } from "@/lib/mcp-credentials";
import { initialModel, parseModelPresets } from "@/lib/models";
import { logEvent, shortMessage } from "@/lib/request-log";
import { sanitizeTools, toRuntimeMessages } from "@/lib/openai-shape";
import { syncFromRcsl } from "@/lib/rcsl";
import { encryptSecret, validateToolSecrets } from "@/lib/secrets";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(action: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      logEvent("action_failed", { action, kind: "forbidden" });
      return { ok: false, error: "沒有權限" };
    }
    if (error instanceof z.ZodError) {
      logEvent("action_failed", { action, kind: "validation", message: shortMessage(error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) });
      return { ok: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    // redirect() and notFound() must propagate.
    if (error && typeof error === "object" && "digest" in error) throw error;
    logEvent("action_failed", { action, kind: "error", message: shortMessage(error) });
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
  settings: agentSettingsSchema,
  note: z.string().max(500).optional(),
});

async function validateVersion(projectId: string, input: unknown) {
  const parsed = versionSchema.parse(input);
  // Reject what the runtime could not send, at save time rather than in class.
  toRuntimeMessages(parsed.instructions);
  await validateToolSecrets(projectId, sanitizeTools(parsed.tools));
  return parsed;
}

/** New agents start on the first preset model, or on the most used one when no presets are configured. */
async function defaultModel(): Promise<string> {
  const presets = await db.select({ model: modelPresets.model, costly: modelPresets.costly }).from(modelPresets).orderBy(asc(modelPresets.position)).limit(1);
  return initialModel(presets, await mostUsedModel());
}

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
  return run("saveVersionAction", async () => {
    const projectId = await projectOf(agentId);
    const user = await requireProjectRole(projectId, "editor");
    const version = await saveVersion(agentId, await validateVersion(projectId, input), user.email, publish);
    revalidatePath(`/agents/${agentId}`);
    return version;
  });
}

export async function publishVersionAction(agentId: string, version: number) {
  return run("publishVersionAction", async () => {
    const projectId = await projectOf(agentId);
    const user = await requireProjectRole(projectId, "editor");
    const stored = await getVersion(agentId, version);
    if (!stored) throw new Error(`version ${version} does not exist`);
    await validateVersion(projectId, stored);
    await publishVersion(agentId, version, user.email);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentMetaAction(agentId: string, meta: { name: string; description: string }) {
  return run("updateAgentMetaAction", async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    const parsed = z.object({ name: z.string().trim().min(1), description: z.string().max(2000) }).parse(meta);
    await updateAgentMeta(agentId, parsed, user.email);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function setArchivedAction(agentId: string, archived: boolean) {
  return run("setArchivedAction", async () => {
    const user = await requireProjectRole(await projectOf(agentId), "editor");
    await setArchived(agentId, archived, user.email);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/");
  });
}

export async function createAgentAction(projectId: string, name: string) {
  return run("createAgentAction", async () => {
    const user = await requireProjectRole(projectId, "editor");
    const initial = await validateVersion(projectId, {
      model: await defaultModel(),
      instructions: [{ role: "developer", content: "" }],
      tools: [],
      settings: {},
    });
    const id = await createAgent(projectId, z.string().trim().min(1).parse(name), user.email, initial);
    revalidatePath("/");
    return id;
  });
}

export async function copyAgentAction(agentId: string, version: number, targetProjectId?: string) {
  return run("copyAgentAction", async () => {
    const user = await requireUser();
    const source = await getAgent(z.string().min(1).parse(agentId));
    if (!source || !can(user, source.agent.projectId, "viewer")) throw new ForbiddenError();
    const projectId = z.string().min(1).optional().parse(targetProjectId) ?? source.agent.projectId;
    if (!can(user, projectId, "editor")) throw new ForbiddenError();

    const selected = await getVersion(agentId, z.number().int().min(1).max(2_147_483_647).parse(version));
    if (!selected) throw new Error("來源版本不存在");
    const initial = await validateVersion(projectId, {
      ...selected,
      note: `複製自 ${agentId}`,
    });
    const id = await createAgent(projectId, source.agent.name, user.email, initial, {
      id: agentId,
      version: selected.version,
      description: source.agent.description,
    });
    revalidatePath("/");
    return id;
  });
}

// Admin

export async function syncRcslAction() {
  return run("syncRcslAction", async () => {
    const admin = await requireAdmin();
    const result = await syncFromRcsl();
    await db.insert(auditEvents).values({ actor: admin.email, action: "rcsl.sync", targetType: "system", targetId: "rcsl", detail: result });
    revalidatePath("/admin");
    return result;
  });
}

/** The organization a project belongs to, or null when there is no such project. */
async function organizationOfProject(projectId: string): Promise<string | null> {
  const [project] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId));
  return project?.organizationId ?? null;
}

/** An organization manager's own access is changed by an admin, so a manager cannot lock themselves out or raise themselves. */
function checkNotSelf(actor: CurrentUser, targetEmail: string) {
  if (!actor.isAdmin && targetEmail === actor.email) throw new Error("不能修改自己的權限");
}

export async function addMembershipAction(input: { email: string; scope: "organization" | "project"; scopeId: string; role: "viewer" | "editor" | "manager" }) {
  return run("addMembershipAction", async () => {
    const admin = await requireManager();
    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        scope: z.enum(["organization", "project"]),
        scopeId: z.string().min(1),
        role: z.enum(["viewer", "editor", "manager"]),
      })
      .parse(input);
    if (!roleFitsScope(parsed.scope, parsed.role)) throw new Error("組織管理者只能授予整個組織");
    const organizationId = membershipOrganization(parsed.scope, parsed.scopeId, parsed.scope === "project" ? await organizationOfProject(parsed.scopeId) : null);
    if (!canManageOrganization(admin.isAdmin, admin.managedOrgIds, organizationId)) throw new ForbiddenError();
    checkNotSelf(admin, parsed.email);
    await db.insert(users).values({ email: parsed.email }).onConflictDoNothing();
    const scopeColumns =
      parsed.scope === "organization" ? { organizationId: parsed.scopeId } : { projectId: parsed.scopeId };
    const target = parsed.scope === "organization" ? [memberships.userEmail, memberships.organizationId] : [memberships.userEmail, memberships.projectId];
    await db
      .insert(memberships)
      .values({ userEmail: parsed.email, role: parsed.role, ...scopeColumns })
      .onConflictDoUpdate({ target, set: { role: parsed.role } });
    await db.insert(auditEvents).values({ actor: admin.email, action: "membership.set", targetType: "user", targetId: parsed.email, detail: { ...parsed, organizationId } });
    revalidatePath("/admin");
  });
}

export async function removeMembershipAction(id: number) {
  return run("removeMembershipAction", async () => {
    const admin = await requireManager();
    id = z.number().int().min(1).max(2_147_483_647).parse(id);
    const removed = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(memberships).where(eq(memberships.id, id));
      if (!current) return null;
      const organizationId = current.organizationId ?? (current.projectId ? await organizationOfProject(current.projectId) : null);
      if (!canManageOrganization(admin.isAdmin, admin.managedOrgIds, organizationId)) throw new ForbiddenError();
      checkNotSelf(admin, current.userEmail);
      await tx.delete(memberships).where(eq(memberships.id, id));
      return { ...current, organizationId };
    });
    if (removed) {
      await db.insert(auditEvents).values({ actor: admin.email, action: "membership.remove", targetType: "user", targetId: removed.userEmail, detail: { ...removed } });
    }
    revalidatePath("/admin");
  });
}

export async function deleteUserAction(email: string) {
  return run("deleteUserAction", async () => {
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
  return run("setAdminAction", async () => {
    const admin = await requireAdmin();
    const target = z.string().trim().toLowerCase().email().parse(email);
    if (target === admin.email && !isAdmin) throw new Error("不能移除自己的管理員身分");
    await db.update(users).set({ isAdmin }).where(eq(users.email, target));
    await db.insert(auditEvents).values({ actor: admin.email, action: isAdmin ? "admin.grant" : "admin.revoke", targetType: "user", targetId: target });
    revalidatePath("/admin");
  });
}

export async function setSecretAction(input: { name: string; value: string; description: string; organizationId?: string | null }) {
  return run("setSecretAction", async () => {
    const admin = await requireManager();
    const parsed = z
      .object({
        name: z.string().regex(/^[A-Za-z0-9_.-]+$/, "只能用英數字、底線、點、減號"),
        value: z.string().min(1),
        description: z.string().max(500),
        organizationId: z.string().nullish(),
      })
      .parse(input);
    const values = { ciphertext: encryptSecret(parsed.value), description: parsed.description, updatedBy: admin.email, updatedAt: new Date() };
    const owner = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ organizationId: secrets.organizationId }).from(secrets).where(eq(secrets.name, parsed.name)).for("update");
      if (existing) {
        // An existing secret keeps its owner; only someone who may manage it may change its value.
        if (!canManageSecret(admin.isAdmin, admin.managedOrgIds, existing.organizationId)) throw new Error("這個憑證名稱已被使用");
        // The form's organization would otherwise be silently ignored for a secret that already has an owner.
        if (parsed.organizationId && parsed.organizationId !== existing.organizationId) throw new Error("這個憑證已屬於其他組織，不能更改所屬組織");
        await tx.update(secrets).set(values).where(eq(secrets.name, parsed.name));
        return existing.organizationId;
      }
      const created = newSecretOwner(admin.isAdmin, admin.managedOrgIds, parsed.organizationId);
      if (!created.ok) throw new Error("請選擇你管理的組織");
      await tx.insert(secrets).values({ name: parsed.name, organizationId: created.owner, ...values });
      return created.owner;
    });
    await db.insert(auditEvents).values({ actor: admin.email, action: "secret.set", targetType: "secret", targetId: parsed.name, detail: { organizationId: owner } });
    revalidatePath("/admin");
  });
}

export async function deleteSecretAction(name: string) {
  return run("deleteSecretAction", async () => {
    const admin = await requireManager();
    name = z.string().min(1).max(200).parse(name);
    const owner = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ organizationId: secrets.organizationId }).from(secrets).where(eq(secrets.name, name)).for("update");
      if (!existing) return null;
      if (!canManageSecret(admin.isAdmin, admin.managedOrgIds, existing.organizationId)) throw new ForbiddenError();
      await tx.delete(secrets).where(and(eq(secrets.name, name)));
      return existing.organizationId;
    });
    await db.insert(auditEvents).values({ actor: admin.email, action: "secret.delete", targetType: "secret", targetId: name, detail: { organizationId: owner } });
    revalidatePath("/admin");
  });
}

export async function setSecretGrantAction(name: string, input: SecretGrant, enabled: boolean) {
  return run("setSecretGrantAction", async () => {
    const admin = await requireManager();
    name = z.string().min(1).max(200).parse(name);
    const grant = z.strictObject({
      projectId: z.string().min(1),
      serverUrl: z.string().trim().transform((value) => mcpServerUrl(value))
        .refine((value) => value !== null, "請輸入完整的 HTTPS MCP 伺服器網址"),
      field: z.string().trim().toLowerCase().refine(validMcpCredentialField, "請輸入 authorization 或 headers.名稱"),
    }).parse(input);
    const matches = (current: SecretGrant) => current.projectId === grant.projectId &&
      current.serverUrl === grant.serverUrl && current.field === grant.field;
    await db.transaction(async (tx) => {
      const [secret] = await tx.select({ grants: secrets.grants, organizationId: secrets.organizationId }).from(secrets).where(eq(secrets.name, name)).for("update");
      if (!secret) throw new Error("找不到憑證");
      if (!canManageSecret(admin.isAdmin, admin.managedOrgIds, secret.organizationId)) throw new ForbiddenError();
      if (enabled && !canGrantSecret(admin.isAdmin, admin.managedOrgIds, secret.organizationId, await organizationOfProject(grant.projectId))) throw new ForbiddenError();
      if (enabled) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, grant.projectId));
        if (!project) throw new Error("專案不存在");
      }
      const retained = secret.grants.filter((current) => !matches(current));
      const grants = enabled ? [...retained, grant] : retained;
      await tx.update(secrets).set({ grants, updatedBy: admin.email, updatedAt: new Date() }).where(eq(secrets.name, name));
      await tx.insert(auditEvents).values({
        actor: admin.email,
        action: enabled ? "secret.grant" : "secret.revoke",
        targetType: "secret",
        targetId: name,
        detail: { ...grant, organizationId: secret.organizationId },
      });
    });
    revalidatePath("/admin");
  });
}

/** Replaces the editor's model dropdown with the submitted list, in the submitted order. */
export async function saveModelPresetsAction(input: unknown) {
  return run("saveModelPresetsAction", async () => {
    const admin = await requireAdmin();
    const list = parseModelPresets(input);
    await db.transaction(async (tx) => {
      // Without this, two saves racing under READ COMMITTED each delete only the rows they can see and insert on top of each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('model_presets'))`);
      await tx.delete(modelPresets);
      if (list.length) {
        await tx.insert(modelPresets).values(list.map((p, position) => ({ ...p, position, updatedBy: admin.email })));
      }
      await tx.insert(auditEvents).values({ actor: admin.email, action: "model_presets.set", targetType: "model_presets", targetId: "-", detail: { presets: list } });
    });
    revalidatePath("/admin");
  });
}
