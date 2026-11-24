import { getAgent } from "@/lib/agents";
import { can, getCurrentUser } from "@/lib/authz";
import { ProviderError, searchIndexStatus, uploadToolFiles } from "@/lib/openai-tool-files";
import { maxToolUploadBytes, maxToolUploadCount, toolVectorStoreId } from "@/lib/tool-attachments";
import { canResolveToolFileKey, toolFileKey } from "@/lib/tool-file-credentials";
import { recordUpload, uploadLimited } from "@/lib/tool-file-usage";

type FileRoute = RouteContext<"/api/agents/[id]/tool-files">;

function failure(error: string, status: number) {
  return Response.json({ error }, { status });
}

/** Maps a provider failure to a message the editor can act on, and logs its cause (never the key). */
function providerFailure(error: unknown, projectId: string, what: string) {
  const detail = error instanceof ProviderError
    ? { status: error.status, code: error.code, type: error.type }
    : { name: error instanceof Error ? error.name : typeof error };
  console.error(`tool-files ${what} failed for ${projectId}`, detail);
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403 || error.code === "project_mismatch") {
      return failure("專案的上傳憑證無法使用，請聯絡管理員", 503);
    }
    if (error.status === 429) return failure("OpenAI 目前請求過多，請稍後再試", 429);
    if (error.status === 400 || error.status === 413 || error.status === 415 || error.status === 422) {
      return failure("OpenAI 無法處理這批檔案。請確認檔案格式或稍後再試。", 422);
    }
  } else if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return failure("OpenAI 回應逾時，請稍後再試", 504);
  }
  return failure(what === "status" ? "暫時無法確認檔案索引，請稍後再試" : "OpenAI 無法處理這批檔案。請確認檔案格式或稍後再試。", 502);
}

async function projectAccess(context: FileRoute) {
  const user = await getCurrentUser();
  if (!user) return failure("請先登入", 401);
  const { id } = await context.params;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "editor")) {
    return failure("沒有專案編輯權限", 403);
  }
  if (found.agent.archivedAt || !found.projectActive) {
    return failure("此 Agent 或專案已停用，無法上傳檔案", 409);
  }
  const projectId = found.agent.projectId;
  if (!canResolveToolFileKey(projectId)) return failure("專案尚未啟用檔案上傳", 503);
  try {
    const key = await toolFileKey(projectId);
    return key
      ? { user, agentId: id, projectId, key }
      : failure("專案的上傳憑證已失效，請聯絡管理員", 503);
  } catch (error) {
    console.error(`tool-files credential lookup failed for ${projectId}`, error instanceof Error ? error.name : typeof error);
    return failure("暫時無法讀取專案上傳憑證，請稍後重試", 503);
  }
}

/** The origin browsers send for this deployment: AUTH_URL when set, else the host the proxy forwarded. */
function expectedOrigin(request: Request) {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export async function POST(request: Request, context: FileRoute) {
  const site = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== expectedOrigin(request) || (site && site !== "same-origin")) {
    return failure("只能從 RCSL Agent Studio 上傳檔案", 403);
  }

  const access = await projectAccess(context);
  if (access instanceof Response) return access;

  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxToolUploadBytes + 65536) {
    return failure("每次上傳的檔案總大小上限為 10 MB", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure("無法讀取檔案", 400);
  }
  const files = form.getAll("file");
  const mode = form.get("mode") ?? "file";
  if (mode !== "file" && mode !== "search") return failure("不支援的上傳方式", 400);
  if (files.length === 0 || files.length > maxToolUploadCount ||
      !files.every((file): file is File => file instanceof File && file.size > 0)) {
    return failure(`請選擇 1 至 ${maxToolUploadCount} 個非空白檔案`, 400);
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > maxToolUploadBytes) {
    return failure("每次上傳的檔案總大小上限為 10 MB", 413);
  }
  if (await uploadLimited(access.user.email, access.projectId)) {
    return failure("上傳過於頻繁，請稍後再試", 429);
  }

  try {
    const result = await uploadToolFiles(access, files, mode);
    // The upload already exists in OpenAI, so a failed audit write must not turn it into an error.
    await recordUpload(access.user.email, access.agentId, {
      projectId: access.projectId,
      mode,
      ids: result.attachments.map(({ id }) => id),
      names: result.attachments.flatMap(({ names }) => names),
    }).catch((error: unknown) => console.error("tool-files audit write failed", error instanceof Error ? error.name : typeof error));
    return Response.json(result, { status: result.status === "indexing" ? 202 : 201 });
  } catch (error) {
    return providerFailure(error, access.projectId, "upload");
  }
}

export async function GET(request: Request, context: FileRoute) {
  const access = await projectAccess(context);
  if (access instanceof Response) return access;
  const storeId = new URL(request.url).searchParams.get("store");
  if (!storeId || !toolVectorStoreId.test(storeId)) return failure("向量資料庫 ID 無效", 400);
  try {
    return Response.json(
      { status: await searchIndexStatus(access, storeId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return providerFailure(error, access.projectId, "status");
  }
}
