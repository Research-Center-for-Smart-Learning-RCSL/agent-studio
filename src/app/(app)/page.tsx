import { asc, eq } from "drizzle-orm";
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
  const rows = await listAgentsForProjects(visible, includeArchived);

  const allProjects = await db
    .select({ id: projects.id, name: projects.name, organizationName: organizations.name })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(projects.active, true))
    .orderBy(asc(organizations.name), asc(projects.name));
  const editableProjects = allProjects.filter((p) => can(user, p.id, "editor"));

  return (
    <AgentList
      rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), archivedAt: r.archivedAt?.toISOString() ?? null }))}
      editableProjects={editableProjects}
      includeArchived={includeArchived}
      hasAnyAccess={user.isAdmin || user.projectRoles.size > 0}
    />
  );
}
