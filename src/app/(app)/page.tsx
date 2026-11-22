import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import { listAgentsForProjects } from "@/lib/agents";
import { can, requireUser } from "@/lib/authz";
import { AgentList } from "./agent-list";

export default async function HomePage(props: PageProps<"/">) {
  const user = await requireUser();
  const { archived } = await props.searchParams;
  const includeArchived = archived === "1";
  const visible = user.isAdmin ? "all" : [...user.projectRoles.keys()];
  const hasAnyAccess = visible === "all" || visible.length > 0;
  const [rows, visibleProjects] = await Promise.all([
    listAgentsForProjects(visible, includeArchived),
    hasAnyAccess
      ? db
          .select({
            id: projects.id,
            name: projects.name,
            organizationId: organizations.id,
            organizationName: organizations.name,
            active: projects.active,
          })
          .from(projects)
          .innerJoin(organizations, eq(organizations.id, projects.organizationId))
          .where(visible === "all" ? undefined : inArray(projects.id, visible))
          .orderBy(asc(organizations.name), asc(organizations.id), asc(projects.name), asc(projects.id))
      : [],
  ]);
  const editableProjects = visibleProjects.filter((p) => p.active && can(user, p.id, "editor"));

  return (
    <AgentList
      rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), archivedAt: r.archivedAt?.toISOString() ?? null }))}
      projects={visibleProjects}
      editableProjects={editableProjects}
      includeArchived={includeArchived}
      hasAnyAccess={hasAnyAccess}
    />
  );
}
