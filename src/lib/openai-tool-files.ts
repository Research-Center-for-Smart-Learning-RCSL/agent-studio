import "server-only";
import { toolFileId, toolVectorStoreId, type ToolUploadMode } from "./tool-attachments";

export type ToolFileAccess = { projectId: string; key: string };

/** A rejected provider call. Only the status and OpenAI's error code and type are kept: never the key or message. */
export class ProviderError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly type?: string) {
    super("OpenAI rejected the project file request");
  }
}

async function send(access: ToolFileAccess, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${access.key}`);
  headers.set("OpenAI-Project", access.projectId);
  return fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
}

async function rejected(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  return new ProviderError(response.status, text(body?.error?.code), text(body?.error?.type));
}

function inProject(access: ToolFileAccess, response: Response) {
  return response.headers.get("openai-project") === access.projectId;
}

async function provider(access: ToolFileAccess, path: string, init?: RequestInit) {
  const response = await send(access, path, init);
  if (!response.ok) throw await rejected(response);
  if (!inProject(access, response)) {
    await response.body?.cancel();
    throw new ProviderError(response.status, "project_mismatch");
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

/** Best effort: removes a store and the files it holds. Versions never reference a store that failed. */
async function discardSearchIndex(access: ToolFileAccess, id: string) {
  const remove = (path: string) => provider(access, path, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
  const listed = await provider(access, `vector_stores/${encodeURIComponent(id)}/files?limit=100`, { signal: AbortSignal.timeout(5_000) })
    .then((response) => response.json() as Promise<{ data?: { id?: unknown }[] }>)
    .catch(() => ({ data: [] }));
  const fileIds = (listed.data ?? []).flatMap((file) => typeof file.id === "string" && toolFileId.test(file.id) ? [file.id] : []);
  await Promise.allSettled([remove(`vector_stores/${encodeURIComponent(id)}`), ...fileIds.map((file) => remove(`files/${file}`))]);
}

/** A store whose indexing failed is unusable, so reporting that also deletes it rather than leaving it in the project. */
export async function searchIndexStatus(access: ToolFileAccess, id: string) {
  const response = await provider(access, `vector_stores/${encodeURIComponent(id)}`);
  const status = indexStatus(await response.json());
  if (status === "failed") await discardSearchIndex(access, id);
  return status;
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
      const response = await send(access, "files", { method: "POST", body, signal });
      if (!response.ok) throw await rejected(response);
      const result = await response.json() as { id?: unknown };
      if (typeof result.id !== "string" || !toolFileId.test(result.id)) throw new Error("OpenAI returned an invalid file ID");
      // Recorded before the project check so a file created anywhere is still cleaned up.
      created.push({ id: result.id, name: file.name });
      if (!inProject(access, response)) throw new ProviderError(response.status, "project_mismatch");
    }
    if (mode === "file") {
      return { id: created[0].id, attachments: created.map(({ id, name }) => ({ id, names: [name] })), status: "ready" as const };
    }

    const response = await provider(access, "vector_stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "RCSL Agent Studio attachments", file_ids: created.map((file) => file.id) }),
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
