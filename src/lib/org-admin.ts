/**
 * Who may change what in the admin area (docs/design.md, Authorization). Admins may change anything. An
 * organization manager may change the members, credentials and credential grants of the organizations they
 * manage and nothing outside them. Pure, so the rules can be tested without a database.
 */

export type MembershipRole = "viewer" | "editor" | "manager";
export type MembershipScope = "organization" | "project";

/** "manager" is a role over a whole organization; on one project it would mean nothing. */
export function roleFitsScope(scope: MembershipScope, role: MembershipRole): boolean {
  return role !== "manager" || scope === "organization";
}

/** The organization a membership belongs to: the organization itself, or the one that holds the project. */
export function membershipOrganization(scope: MembershipScope, scopeId: string, projectOrganization: string | null): string | null {
  return scope === "organization" ? scopeId : projectOrganization;
}

export function canManageOrganization(isAdmin: boolean, managed: ReadonlySet<string>, organizationId: string | null): boolean {
  return isAdmin || (organizationId !== null && managed.has(organizationId));
}

/** A secret nobody owns is a global one, kept to admins. */
export function canManageSecret(isAdmin: boolean, managed: ReadonlySet<string>, owner: string | null): boolean {
  return canManageOrganization(isAdmin, managed, owner);
}

/** Who owns a secret that is being created: an admin may leave it global; a manager must name an organization they manage. */
export function newSecretOwner(isAdmin: boolean, managed: ReadonlySet<string>, requested: string | null | undefined): { ok: true; owner: string | null } | { ok: false } {
  const owner = requested || null;
  if (isAdmin) return { ok: true, owner };
  return owner !== null && managed.has(owner) ? { ok: true, owner } : { ok: false };
}

/** A manager may grant their organization's secret only to a project of that same organization. */
export function canGrantSecret(isAdmin: boolean, managed: ReadonlySet<string>, owner: string | null, projectOrganization: string | null): boolean {
  if (isAdmin) return true;
  return owner !== null && managed.has(owner) && owner === projectOrganization;
}

/** The ids of the organizations a person manages, from their memberships. */
export function managedOrganizations(rows: readonly { organizationId: string | null; role: MembershipRole }[]): Set<string> {
  return new Set(rows.flatMap((row) => (row.organizationId !== null && row.role === "manager" ? [row.organizationId] : [])));
}
