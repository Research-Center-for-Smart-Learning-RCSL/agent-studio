import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { memberships, projects, users } from "@/db/schema";
import { managedOrganizations } from "@/lib/org-admin";

export type Role = "viewer" | "editor" | "manager";

export type CurrentUser = {
  email: string;
  name: string | null;
  isAdmin: boolean;
  /** Organizations this user manages: their members and credentials, and an editor's rights in every project. */
  managedOrgIds: Set<string>;
  /** Effective role per project id; admins are not listed and may do anything. */
  projectRoles: Map<string, Role>;
};

const rank: Record<Role, number> = { viewer: 1, editor: 2, manager: 3 };

function higher(a: Role | undefined, b: Role): Role {
  return a && rank[a] >= rank[b] ? a : b;
}

/** The signed-in user with resolved permissions, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return null;

  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      projectId: memberships.projectId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userEmail, email));

  const projectRoles = new Map<string, Role>();
  const orgRoles = rows.filter((r) => r.organizationId);
  if (orgRoles.length) {
    const all = await db.select({ id: projects.id, organizationId: projects.organizationId }).from(projects);
    for (const membership of orgRoles) {
      for (const p of all.filter((p) => p.organizationId === membership.organizationId)) {
        projectRoles.set(p.id, higher(projectRoles.get(p.id), membership.role));
      }
    }
  }
  for (const membership of rows.filter((r) => r.projectId)) {
    projectRoles.set(membership.projectId!, higher(projectRoles.get(membership.projectId!), membership.role));
  }
  return { email, name: user.name, isAdmin: user.isAdmin, managedOrgIds: managedOrganizations(rows), projectRoles };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function can(user: CurrentUser, projectId: string, role: Role): boolean {
  if (user.isAdmin) return true;
  const granted = user.projectRoles.get(projectId);
  return !!granted && rank[granted] >= rank[role];
}

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
  }
}

export async function requireProjectRole(projectId: string, role: Role): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, projectId, role)) throw new ForbiddenError();
  return user;
}

/** Whether the admin area is open to this user: admins, and managers of at least one organization. */
export const canOpenAdmin = (user: CurrentUser) => user.isAdmin || user.managedOrgIds.size > 0;

export async function requireManager(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canOpenAdmin(user)) throw new ForbiddenError();
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ForbiddenError();
  return user;
}
