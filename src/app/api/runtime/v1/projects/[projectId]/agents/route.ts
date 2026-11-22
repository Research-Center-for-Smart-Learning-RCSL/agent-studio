import { NextResponse } from "next/server";
import { listAgentsForProjects } from "@/lib/agents";
import { runtimeAuthorized, runtimeError } from "@/lib/runtime-api";

/**
 * Agents of one RCSL project. Rows keep the field names of RCSL's
 * `/openai/prompts/<project_id>` (`id`, `name`, `default_version`) so the
 * runtime's agent selector reads them unchanged.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runtime/v1/projects/[projectId]/agents">) {
  if (!runtimeAuthorized(request)) return runtimeError(401, "unauthorized");
  const { projectId } = await ctx.params;
  const rows = await listAgentsForProjects([projectId]);
  const data = rows
    .filter((r) => r.publishedVersion !== null || r.latestVersion !== null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      default_version: String(r.publishedVersion ?? r.latestVersion),
    }));
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
