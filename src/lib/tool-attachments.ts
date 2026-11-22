type Tool = Record<string, unknown>;

function isObject(value: unknown): value is Tool {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readToolJson(text: string): Tool {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || typeof parsed.type !== "string") {
    throw new Error("必須是含有 type 欄位的物件");
  }
  return parsed;
}

export function toolAttachments(tool: Tool) {
  if (tool.type === "file_search") {
    const refs = Array.isArray(tool.vector_store_ids) ? tool.vector_store_ids.filter((id): id is string => typeof id === "string") : [];
    return {
      kind: "vectorStore" as const,
      refs,
      apply: (ids: string[]) => ({ ...tool, vector_store_ids: ids }),
    };
  }
  const spec = tool.type === "code_interpreter" ? { key: "container", type: "auto" }
    : tool.type === "shell" ? { key: "environment", type: "container_auto" }
    : null;
  if (!spec) return null;
  const value = tool[spec.key];
  const container = value == null ? { type: spec.type } : value;
  if (!isObject(container) || container.type !== spec.type) return null;
  const refs = Array.isArray(container.file_ids) ? container.file_ids.filter((id): id is string => typeof id === "string") : [];
  return {
    kind: "file" as const,
    refs,
    apply: (ids: string[]) => ({ ...tool, [spec.key]: { ...container, file_ids: ids } }),
  };
}

export const toolFileId = /^file[-_][A-Za-z0-9_-]+$/;
export const toolVectorStoreId = /^vs_[A-Za-z0-9_-]+$/;
export const maxToolFiles = 50;
export const maxToolUploadBytes = 10 * 1024 * 1024;
