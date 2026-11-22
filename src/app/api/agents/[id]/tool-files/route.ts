import { getAgent } from "@/lib/agents";
import { can, getCurrentUser } from "@/lib/authz";
import { searchIndexStatus, uploadToolFiles } from "@/lib/openai-tool-files";
import { maxToolUploadBytes, maxToolUploadCount, toolVectorStoreId } from "@/lib/tool-attachments";
import { toolFileKey } from "@/lib/tool-file-credentials";

type FileRoute = RouteContext<"/api/agents/[id]/tool-files">;

function failure(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function projectAccess(context: FileRoute) {
  const user = await getCurrentUser();
  if (!user) return failure("請先登入", 401);
  const { id } = await context.params;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "editor")) {
    return failure("沒有專案編輯權限", 403);
  }
  const projectId = found.agent.projectId;
  try {
    const key = await toolFileKey(projectId);
    return key ? { projectId, key } : failure("專案尚未啟用檔案上傳", 503);
  } catch {
    return failure("暫時無法讀取專案上傳憑證，請稍後重試", 503);
  }
}

export async function POST(request: Request, context: FileRoute) {
  const origin = new URL(process.env.AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return failure("只能從 Agent Studio 上傳檔案", 403);
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

  try {
    const result = await uploadToolFiles(access, files, mode);
    return Response.json(result, { status: result.status === "indexing" ? 202 : 201 });
  } catch {
    return failure("OpenAI 無法處理這批檔案。請確認檔案格式或稍後再試。", 502);
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
  } catch {
    return failure("暫時無法確認檔案索引，請稍後再試", 502);
  }
}
