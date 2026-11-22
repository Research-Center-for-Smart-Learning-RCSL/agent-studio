import "server-only";

/** Upload credentials are separate from secrets that tools can resolve at runtime. */
export function toolFileKey(projectId: string): string | undefined {
  const setting = process.env.STUDIO_FILE_UPLOAD_KEYS;
  if (!setting) return undefined;
  try {
    const keys: unknown = JSON.parse(setting);
    if (!keys || typeof keys !== "object" || !Object.hasOwn(keys, projectId)) return undefined;
    const key = (keys as Record<string, unknown>)[projectId];
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}
