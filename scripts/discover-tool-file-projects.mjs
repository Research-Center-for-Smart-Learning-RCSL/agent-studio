import { createHash } from "node:crypto";

const base = process.env.RCSL_API?.replace(/\/+$/, "");
const authorization = process.env.RCSL_AUTHORIZATION;
if (!base || !authorization) throw new Error("RCSL_API and RCSL_AUTHORIZATION are required");

async function registry(path) {
  const response = await fetch(`${base}/openai${path}`, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RCSL registry returned ${response.status}`);
  return (await response.json()).data;
}

const [summary, legacy] = await Promise.all([registry("/summary"), registry("")]);
const knownProjects = new Set(summary.flatMap((org) => org.projects.map((project) => project.project_id)));
const candidates = [...new Set(legacy.organization.flatMap((org) => org.project
  .map((project) => project.api_key)
  .filter((key) => typeof key === "string" && key.startsWith("sk-") && key.length > 8)
  .map((key) => key.slice(0, -6) + key.slice(-5))))];
const matches = new Map();

async function probe(key, path, projectId) {
  const response = await fetch(`https://api.openai.com/v1/${path}?limit=1`, {
    headers: {
      Authorization: `Bearer ${key}`,
      ...(projectId ? { "OpenAI-Project": projectId } : {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  const scope = response.headers.get("openai-project");
  await response.body?.cancel();
  return response.ok ? scope : null;
}

await Promise.all(Array.from({ length: 5 }, async () => {
  for (let key = candidates.shift(); key; key = candidates.shift()) {
    try {
      const projectId = await probe(key, "files");
      if (!knownProjects.has(projectId) || await probe(key, "vector_stores", projectId) !== projectId) continue;
      const fingerprint = createHash("sha256").update(key).digest("hex");
      const keys = matches.get(projectId) ?? [];
      matches.set(projectId, [...keys, fingerprint]);
    } catch {
      // Leave unavailable candidates out. A later run can retry them.
    }
  }
}));

if (!matches.size) throw new Error("No OpenAI projects could be verified");
console.error(`Verified ${matches.size} of ${knownProjects.size} projects for files and vector stores.`);
console.log(JSON.stringify(Object.fromEntries([...matches].sort(([a], [b]) => a.localeCompare(b)))));
