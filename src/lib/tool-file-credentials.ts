import "server-only";
import { createHash } from "node:crypto";
import { env } from "./env";

function projectSetting(setting: string | undefined, projectId: string): unknown {
  if (!setting) return undefined;
  try {
    const keys: unknown = JSON.parse(setting);
    if (!keys || typeof keys !== "object" || !Object.hasOwn(keys, projectId)) return undefined;
    return (keys as Record<string, unknown>)[projectId];
  } catch {
    return undefined;
  }
}

function explicitKey(projectId: string) {
  const key = projectSetting(process.env.STUDIO_FILE_UPLOAD_KEYS, projectId);
  return typeof key === "string" ? key.trim() || undefined : undefined;
}

function fingerprints(projectId: string): string[] {
  const value = projectSetting(process.env.STUDIO_FILE_KEY_FINGERPRINTS, projectId);
  return Array.isArray(value) ? value.filter((hash): hash is string => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) : [];
}

export function canResolveToolFileKey(projectId: string) {
  return !!explicitKey(projectId) || fingerprints(projectId).length > 0;
}

let cachedRegistry: { expires: number; keys: Promise<Map<string, string>> } | undefined;

function registryKeys() {
  if (cachedRegistry && Date.now() < cachedRegistry.expires) return cachedRegistry.keys;
  const keys = (async () => {
    const response = await fetch(`${env.rcslApi}/openai`, {
      headers: { Authorization: env.rcslAuthorization },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("RCSL credential lookup failed");
    const payload = await response.json() as { data?: { organization?: unknown } };
    const matches = new Map<string, string>();
    // One malformed organization must not take every project's uploads down.
    const organizations = Array.isArray(payload?.data?.organization) ? payload.data.organization : [];
    for (const org of organizations as { project?: unknown }[]) {
      for (const project of Array.isArray(org?.project) ? org.project as { api_key?: unknown }[] : []) {
        const stored = project?.api_key;
        if (typeof stored !== "string" || !stored.startsWith("sk-") || stored.length <= 8) continue;
        const key = stored.slice(0, -6) + stored.slice(-5);
        matches.set(createHash("sha256").update(key).digest("hex"), key);
      }
    }
    return matches;
  })().catch((error: unknown) => {
    cachedRegistry = undefined;
    throw error;
  });
  cachedRegistry = { expires: Date.now() + 60_000, keys };
  return keys;
}

/**
 * Whether uploads can work for the project right now: configured, and the key
 * still resolves. The editor uses this so it never offers a control that fails.
 */
export async function toolFileAvailable(projectId: string): Promise<boolean> {
  if (!canResolveToolFileKey(projectId)) return false;
  try {
    return !!(await toolFileKey(projectId));
  } catch {
    return false;
  }
}

/** Registry credentials are matched only against fingerprints verified for this project by OpenAI. */
export async function toolFileKey(projectId: string): Promise<string | undefined> {
  const override = explicitKey(projectId);
  if (override) return override;
  const matches = fingerprints(projectId);
  if (!matches.length) return undefined;
  const keys = await registryKeys();
  return matches.map((fingerprint) => keys.get(fingerprint)).find(Boolean);
}
