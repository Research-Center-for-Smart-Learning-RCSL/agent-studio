import { getAgent } from "@/lib/agents";
import { can, getCurrentUser } from "@/lib/authz";
import { listProjectSkills, ProviderError } from "@/lib/openai-tool-files";
import { canResolveToolFileKey, toolFileKey } from "@/lib/tool-file-credentials";

type SkillRoute = RouteContext<"/api/agents/[id]/skills">;

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Lists the skills the agent's OpenAI project owns, for the Hosted Shell settings. Editors only. */
export async function GET(_request: Request, context: SkillRoute) {
  const user = await getCurrentUser();
  if (!user) return failure("請先登入", 401);
  const { id } = await context.params;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "editor")) return failure("沒有專案編輯權限", 403);
  const projectId = found.agent.projectId;
  if (!canResolveToolFileKey(projectId)) return failure("專案尚未啟用 OpenAI 憑證查詢", 503);
  try {
    const key = await toolFileKey(projectId);
    if (!key) return failure("專案的憑證已失效，請聯絡管理員", 503);
    const skills = await listProjectSkills({ projectId, key });
    return Response.json({ skills }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof ProviderError
      ? { status: error.status, code: error.code }
      : { name: error instanceof Error ? error.name : typeof error };
    console.error(`skills listing failed for ${projectId}`, detail);
    return failure("暫時無法讀取專案的 skills，仍可手動輸入 skill ID", 502);
  }
}
