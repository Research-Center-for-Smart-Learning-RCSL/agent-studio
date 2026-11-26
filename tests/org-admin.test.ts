import { describe, expect, it } from "vitest";
import { canGrantSecret, canManageOrganization, canManageSecret, managedOrganizations, membershipOrganization, newSecretOwner, roleFitsScope } from "../src/lib/org-admin";

const managed = new Set(["org-a"]);

describe("organization manager rules", () => {
  it("keeps the manager role to whole organizations", () => {
    expect(roleFitsScope("organization", "manager")).toBe(true);
    expect(roleFitsScope("project", "manager")).toBe(false);
    expect(roleFitsScope("project", "editor")).toBe(true);
  });

  it("resolves a membership's organization from its scope", () => {
    expect(membershipOrganization("organization", "org-a", null)).toBe("org-a");
    expect(membershipOrganization("project", "proj-1", "org-b")).toBe("org-b");
    expect(membershipOrganization("project", "proj-gone", null)).toBeNull();
  });

  it("lets a manager act only inside the organizations they manage", () => {
    expect(canManageOrganization(false, managed, "org-a")).toBe(true);
    expect(canManageOrganization(false, managed, "org-b")).toBe(false);
    expect(canManageOrganization(false, managed, null)).toBe(false);
    expect(canManageOrganization(true, new Set(), "org-b")).toBe(true);
  });

  it("keeps global secrets, and other organizations' secrets, from managers", () => {
    expect(canManageSecret(false, managed, "org-a")).toBe(true);
    expect(canManageSecret(false, managed, null)).toBe(false);
    expect(canManageSecret(false, managed, "org-b")).toBe(false);
    expect(canManageSecret(true, new Set(), null)).toBe(true);
  });

  it("makes a manager name a managed organization for a new secret", () => {
    expect(newSecretOwner(false, managed, "org-a")).toEqual({ ok: true, owner: "org-a" });
    expect(newSecretOwner(false, managed, "org-b")).toEqual({ ok: false });
    expect(newSecretOwner(false, managed, undefined)).toEqual({ ok: false });
    expect(newSecretOwner(true, managed, "")).toEqual({ ok: true, owner: null });
  });

  it("grants a manager's secret only to projects of the same organization", () => {
    expect(canGrantSecret(false, managed, "org-a", "org-a")).toBe(true);
    expect(canGrantSecret(false, managed, "org-a", "org-b")).toBe(false);
    expect(canGrantSecret(false, managed, null, "org-a")).toBe(false);
    expect(canGrantSecret(true, managed, null, "org-b")).toBe(true);
  });

  it("collects the organizations a person manages", () => {
    const rows = [
      { organizationId: "org-a", role: "manager" as const },
      { organizationId: "org-b", role: "editor" as const },
      { organizationId: null, role: "manager" as const },
    ];
    expect([...managedOrganizations(rows)]).toEqual(["org-a"]);
  });
});
