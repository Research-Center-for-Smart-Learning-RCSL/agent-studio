import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents } from "@/db/schema";

export const uploadAction = "tool_files.upload";
// Every upload can create up to 10 MB in the project's OpenAI account, so a
// stuck client or a script must hit a ceiling well before it fills it.
export const uploadsPerUserPerHour = 30;
export const uploadsPerProjectPerHour = 100;

/** Whether this user or project has used up its upload allowance for the last hour. */
export async function uploadLimited(actor: string, projectId: string) {
  const since = new Date(Date.now() - 3_600_000);
  const [counts] = await db
    .select({
      user: sql<number>`count(*) filter (where ${auditEvents.actor} = ${actor})`.mapWith(Number),
      project: sql<number>`count(*)`.mapWith(Number),
    })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.action, uploadAction),
      gt(auditEvents.createdAt, since),
      sql`${auditEvents.detail}->>'projectId' = ${projectId}`,
    ));
  return counts.user >= uploadsPerUserPerHour || counts.project >= uploadsPerProjectPerHour;
}

/** The record that ties files in OpenAI back to a person, so orphans can be traced and removed. */
export async function recordUpload(actor: string, agentId: string, detail: {
  projectId: string;
  mode: string;
  ids: string[];
  names: string[];
}) {
  await db.insert(auditEvents).values({ actor, action: uploadAction, targetType: "agent", targetId: agentId, detail });
}
