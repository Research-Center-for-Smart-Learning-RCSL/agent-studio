import "server-only";
import { toolFileId, toolVectorStoreId, type ToolUploadMode } from "./tool-attachments";

export type ToolFileAccess = { projectId: string; key: string };

async function provider(access: ToolFileAccess, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${access.key}`);
  headers.set("OpenAI-Project", access.projectId);
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
  if (!response.ok || response.headers.get("openai-project") !== access.projectId) {
    await response.body?.cancel();
    throw new Error("OpenAI rejected the project file request");
  }
  return response;
}

function indexStatus(store: {
  status?: unknown;
  file_counts?: { failed?: number; cancelled?: number; completed?: number };
}): "ready" | "indexing" | "failed" {
  if (store.status === "in_progress") return "indexing";
  if (store.status === "completed" && !store.file_counts?.failed && !store.file_counts?.cancelled &&
      (store.file_counts?.completed ?? 0) > 0) return "ready";
  return "failed";
}

export async function searchIndexStatus(access: ToolFileAccess, id: string) {
  const response = await provider(access, `vector_stores/${encodeURIComponent(id)}`);
  return indexStatus(await response.json());
}

export async function uploadToolFiles(access: ToolFileAccess, files: File[], mode: ToolUploadMode) {
  const created: { id: string; name: string }[] = [];
  let storeId: string | undefined;
  const signal = AbortSignal.timeout(35_000);
  try {
    for (const file of files) {
      const body = new FormData();
      body.set("file", file);
      body.set("purpose", mode === "search" ? "assistants" : "user_data");
      const response = await provider(access, "files", { method: "POST", body, signal });
      const result = await response.json() as { id?: unknown };
      if (typeof result.id !== "string" || !toolFileId.test(result.id)) throw new Error("OpenAI returned an invalid file ID");
      created.push({ id: result.id, name: file.name });
    }
    if (mode === "file") {
      return { id: created[0].id, attachments: created.map(({ id, name }) => ({ id, names: [name] })), status: "ready" as const };
    }

    const response = await provider(access, "vector_stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent Studio attachments", file_ids: created.map((file) => file.id) }),
      signal,
    });
    const store = await response.json();
    if (typeof store.id !== "string" || !toolVectorStoreId.test(store.id)) throw new Error("OpenAI returned an invalid vector store ID");
    storeId = store.id as string;
    const status = indexStatus(store);
    if (status === "failed") throw new Error("OpenAI could not index the files");
    return { attachments: [{ id: storeId, names: created.map((file) => file.name) }], status };
  } catch (error) {
    const remove = (path: string) => provider(access, path, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
    if (storeId) await Promise.allSettled([remove(`vector_stores/${storeId}`)]);
    await Promise.allSettled(created.map(({ id }) => remove(`files/${id}`)));
    throw error;
  }
}
