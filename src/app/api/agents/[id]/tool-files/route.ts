import { getAgent } from "@/lib/agents";
import { can, getCurrentUser } from "@/lib/authz";
import { maxToolUploadBytes, toolFileId } from "@/lib/tool-attachments";
import { toolFileKey } from "@/lib/tool-file-credentials";

export async function POST(request: Request, context: RouteContext<"/api/agents/[id]/tool-files">) {
  const origin = new URL(process.env.AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return Response.json({ error: "只能從 Agent Studio 上傳檔案" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "請先登入" }, { status: 401 });
  const { id } = await context.params;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "editor")) {
    return Response.json({ error: "沒有專案編輯權限" }, { status: 403 });
  }
  const key = toolFileKey(found.agent.projectId);
  if (!key) return Response.json({ error: "專案尚未設定上傳憑證" }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxToolUploadBytes + 16384) {
    return Response.json({ error: "檔案大小上限為 10 MB" }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return Response.json({ error: "無法讀取檔案" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "請選擇非空白檔案" }, { status: 400 });
  }
  if (file.size > maxToolUploadBytes) {
    return Response.json({ error: "檔案大小上限為 10 MB" }, { status: 413 });
  }

  const body = new FormData();
  body.set("file", file);
  body.set("purpose", "user_data");
  try {
    const response = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "OpenAI-Project": found.agent.projectId },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      const result: { id?: unknown } = await response.json();
      if (typeof result.id === "string" && toolFileId.test(result.id)) {
        return Response.json({ id: result.id }, { status: 201 });
      }
    }
  } catch {
    return Response.json({ error: "上傳暫時無法完成，請稍後再試" }, { status: 502 });
  }
  return Response.json({ error: "OpenAI 未接受上傳，請確認檔案格式與專案上傳權限" }, { status: 502 });
}
