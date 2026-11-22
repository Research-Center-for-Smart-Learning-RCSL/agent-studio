import { NextResponse } from "next/server";
import { getAgent, getEffectiveVersion, getVersion } from "@/lib/agents";
import { toResponsesRequest } from "@/lib/openai-shape";
import { runtimeAuthorized, runtimeError } from "@/lib/runtime-api";
import { resolveSecrets } from "@/lib/secrets";

/**
 * One agent version as inline Responses API fields (`request`), with secret
 * references in tools resolved. `?version=N` selects a version; otherwise
 * the published one is returned.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runtime/v1/agents/[agentId]">) {
  if (!runtimeAuthorized(request)) return runtimeError(401, "unauthorized");
  const { agentId } = await ctx.params;
  const found = await getAgent(agentId);
  if (!found) return runtimeError(404, "agent not found");

  const requested = new URL(request.url).searchParams.get("version");
  let version;
  if (requested !== null) {
    const n = Number(requested);
    if (!Number.isInteger(n) || n < 1) return runtimeError(400, "version must be a positive integer");
    version = await getVersion(agentId, n);
  } else {
    version = await getEffectiveVersion(agentId);
  }
  if (!version) return runtimeError(404, "version not found");

  let body;
  try {
    body = await resolveSecrets(toResponsesRequest(version));
  } catch (error) {
    return runtimeError(422, (error as Error).message);
  }
  return NextResponse.json(
    {
      id: found.agent.id,
      name: found.agent.name,
      project_id: found.agent.projectId,
      version: version.version,
      published_version: found.agent.publishedVersion,
      archived: found.agent.archivedAt !== null,
      request: body,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
