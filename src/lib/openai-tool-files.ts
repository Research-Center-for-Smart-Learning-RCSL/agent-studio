import "server-only";
import { toolFileId, toolVectorStoreId, type ToolUploadMode } from "./tool-attachments";
import { toolSkillId } from "./tool-skills";

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
    // Only this request's verified creations are eligible for rollback.
    const remove = (path: string) => provider(access, path, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
    if (storeId) await Promise.allSettled([remove(`vector_stores/${storeId}`)]);
    await Promise.allSettled(created.map(({ id }) => remove(`files/${id}`)));
    throw error;
  }
}

export type ProjectSkill = { id: string; name: string; description: string; version: string };

/** Skills the project owns. Capped so a runaway listing cannot stall the editor. */
export async function listProjectSkills(access: ToolFileAccess): Promise<ProjectSkill[]> {
  const skills: ProjectSkill[] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ limit: "100", ...(after ? { after } : {}) });
    const response = await provider(access, `skills?${query}`);
    const body = await response.json() as { data?: unknown; has_more?: unknown; last_id?: unknown };
    for (const item of Array.isArray(body.data) ? body.data : []) {
      const skill = item as { id?: unknown; name?: unknown; description?: unknown; default_version?: unknown };
      if (typeof skill.id !== "string" || !toolSkillId.test(skill.id)) continue;
      skills.push({
        id: skill.id,
        name: typeof skill.name === "string" ? skill.name : skill.id,
        description: typeof skill.description === "string" ? skill.description : "",
        version: typeof skill.default_version === "string" ? skill.default_version : "",
      });
    }
    if (body.has_more !== true || typeof body.last_id !== "string") break;
    after = body.last_id;
  }
  return skills;
}
