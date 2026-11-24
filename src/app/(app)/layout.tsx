import { LanguageSelect } from "@/lib/i18n-client";
import { getTranslator } from "@/lib/i18n-server";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";
import { logsConfigured } from "@/lib/logs";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import { AppSidebar, type SidebarKey } from "./app-sidebar";
import { ScopeFilter } from "./scope-filter";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslator();
  const user = await requireUser();
  const visibleProjectIds = user.isAdmin ? undefined : [...user.projectRoles.keys()];
  const scopeProjects = visibleProjectIds && visibleProjectIds.length === 0 ? [] : await db
    .select({ id: projects.id, name: projects.name, organizationId: organizations.id, organizationName: organizations.name })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(visibleProjectIds ? inArray(projects.id, visibleProjectIds) : undefined)
    .orderBy(asc(organizations.name), asc(organizations.id), asc(projects.name), asc(projects.id));
  const items: { key: SidebarKey; label: string }[] = [
    { key: "agents", label: "Agents" },
    ...(logsConfigured() ? [{ key: "logs" as const, label: "Logs" }] : []),
    ...(user.isAdmin ? [{ key: "admin" as const, label: t("管理") }] : []),
  ];
  return (
    <div className="studio-shell">
      <AppSidebar items={items} />
      <div className="studio-body">
        <header className="studio-header">
          <div className="studio-header-inner">
            {scopeProjects.length > 0 && <ScopeFilter projects={scopeProjects} userEmail={user.email} />}
            <div className="studio-account">
              <LanguageSelect />
              <span className="studio-email" title={user.email}>{user.email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="studio-button" type="submit">{t("登出")}</button>
              </form>
            </div>
          </div>
        </header>
        <main className="studio-main">{children}</main>
      </div>
    </div>
  );
}
