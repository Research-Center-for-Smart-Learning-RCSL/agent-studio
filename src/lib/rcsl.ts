import "server-only";
import { notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, projects } from "@/db/schema";
import { env } from "./env";

type SummaryRow = {
  organization_id: string;
  organization_title: string;
  projects: { project_id: string; project_title: string }[];
};

async function fetchSummary(): Promise<SummaryRow[]> {
  const response = await fetch(`${env.rcslApi}/openai/summary`, {
    headers: { Authorization: env.rcslAuthorization },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`RCSL summary returned ${response.status}`);
  const payload = (await response.json()) as { data?: SummaryRow[] };
  return payload.data ?? [];
}

/**
 * Mirror RCSL organizations and projects. Rows missing from RCSL are marked
 * inactive, not deleted, so agents that belong to them stay readable.
 */
export async function syncFromRcsl() {
  const rows = await fetchSummary();
  if (!rows.length) throw new Error("RCSL summary is empty; refusing to deactivate everything");
  const orgIds = rows.map((r) => r.organization_id);
  const projectIds = rows.flatMap((r) => r.projects.map((p) => p.project_id));
  await db.transaction(async (tx) => {
    for (const org of rows) {
      await tx
        .insert(organizations)
        .values({ id: org.organization_id, name: org.organization_title })
        .onConflictDoUpdate({ target: organizations.id, set: { name: org.organization_title, active: true, syncedAt: sql`now()` } });
      for (const p of org.projects) {
        await tx
          .insert(projects)
          .values({ id: p.project_id, organizationId: org.organization_id, name: p.project_title })
          .onConflictDoUpdate({
            target: projects.id,
            set: { name: p.project_title, organizationId: org.organization_id, active: true, syncedAt: sql`now()` },
          });
      }
    }
    await tx.update(organizations).set({ active: false }).where(notInArray(organizations.id, orgIds));
    await tx.update(projects).set({ active: false }).where(notInArray(projects.id, projectIds));
  });
  return { organizations: orgIds.length, projects: projectIds.length };
}
