import { NextResponse } from "next/server";
import { getAgent, getEffectiveVersion, getVersion } from "@/lib/agents";
import { toResponsesConfig } from "@/lib/openai-shape";
import { loggedRoute } from "@/lib/request-log";
import { runtimeAuthorized, runtimeError } from "@/lib/runtime-api";
import { resolveToolSecrets } from "@/lib/secrets";

/**
 * One agent version as inline Responses API fields (`request`), with secret
 * references in tools resolved. `?version=N` selects a version; otherwise
 * the published one is returned.
 */
export const GET = loggedRoute("runtime.agent", async (request: Request, ctx: RouteContext<"/api/runtime/v1/agents/[agentId]">) => {
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

  let config;
  try {
    config = toResponsesConfig(version);
    config.request.tools = await resolveToolSecrets(found.agent.projectId, config.request.tools);
  } catch (error) {
    return runtimeError(422, (error as Error).message);
  }
  return NextResponse.json(
    {
      id: found.agent.id,
      name: found.agent.name,
      project_id: found.agent.projectId,
      project: found.projectName,
      organization: found.organizationName,
      version: version.version,
      published_version: found.agent.publishedVersion,
      archived: found.agent.archivedAt !== null,
      ...config,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
