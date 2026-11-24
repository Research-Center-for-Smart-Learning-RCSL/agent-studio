import { LanguageSelect } from "@/lib/i18n-client";
import { getTranslator } from "@/lib/i18n-server";
import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
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
  return (
    <>
      <header className="studio-header">
        <div className="studio-header-inner">
          <Link href="/" className="studio-brand">
            <span className="studio-mark" aria-hidden="true" />
            RCSL Agent Studio
          </Link>
          {scopeProjects.length > 0 && <ScopeFilter projects={scopeProjects} userEmail={user.email} />}
          <nav className="studio-nav" aria-label={t("主導覽")}>
            <Link href="/">Agents</Link>
            {user.isAdmin && <Link href="/admin">{t("管理")}</Link>}
          </nav>
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
    </>
  );
}
