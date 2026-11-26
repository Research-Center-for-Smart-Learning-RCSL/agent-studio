import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AgentSettings } from "@/lib/agent-settings";

export type { AgentSettings };

// "manager" is an organization-only role: it can do what an editor can in every project of the organization and
// also manages the organization's members and credentials (docs/design.md, Authorization).
export const roleEnum = pgEnum("role", ["viewer", "editor", "manager"]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), // RCSL organization_id (org-...)
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(), // RCSL project_id (proj_...)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)],
);

export const users = pgTable("users", {
  email: text("email").primaryKey(),
  name: text("name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userEmail: text("user_email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id),
    projectId: text("project_id").references(() => projects.id),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_org_uq").on(t.userEmail, t.organizationId),
    uniqueIndex("memberships_user_project_uq").on(t.userEmail, t.projectId),
    check(
      "memberships_one_scope",
      sql`(${t.organizationId} is null) <> (${t.projectId} is null)`,
    ),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(), // pmpt_... (imported) or agt_... (created here)
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    publishedVersion: integer("published_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("agents_project_idx").on(t.projectId)],
);

/**
 * One Responses API input message. `content` is plain text unless the
 * imported prompt held non-text parts (images, files), which are kept as the
 * raw content-part list so nothing is lost.
 */
export type InstructionMessage = {
  role: "developer" | "system" | "user" | "assistant";
  content: string | Record<string, unknown>[];
};

export const agentVersions = pgTable(
  "agent_versions",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    version: integer("version").notNull(),
    model: text("model").notNull(),
    instructions: jsonb("instructions").$type<InstructionMessage[]>().notNull(),
    tools: jsonb("tools").$type<Record<string, unknown>[]>().notNull(),
    settings: jsonb("settings").$type<AgentSettings>().notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by"), // null for imported versions
    source: text("source").notNull().default("studio"), // "studio" | "openai-import"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.version] })],
);

export type SecretGrant = {
  projectId: string;
  serverUrl: string;
  field: string;
};

export const secrets = pgTable("secrets", {
  name: text("name").primaryKey(),
  description: text("description").notNull().default(""),
  ciphertext: text("ciphertext").notNull(),
  grants: jsonb("grants").$type<SecretGrant[]>().notNull().default([]),
  /** The organization that owns the secret and whose managers may change it; null means only admins may. */
  organizationId: text("organization_id").references(() => organizations.id),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    actor: text("actor"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId)],
);
