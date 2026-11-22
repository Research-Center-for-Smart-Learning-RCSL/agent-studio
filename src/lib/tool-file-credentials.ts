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
    const payload = await response.json() as { data: { organization: { project: { api_key?: unknown }[] }[] } };
    const matches = new Map<string, string>();
    for (const org of payload.data.organization) {
      for (const { api_key: stored } of org.project) {
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

/** Registry credentials are matched only against fingerprints verified for this project by OpenAI. */
export async function toolFileKey(projectId: string): Promise<string | undefined> {
  const override = explicitKey(projectId);
  if (override) return override;
  const matches = fingerprints(projectId);
  if (!matches.length) return undefined;
  const keys = await registryKeys();
  return matches.map((fingerprint) => keys.get(fingerprint)).find(Boolean);
}
