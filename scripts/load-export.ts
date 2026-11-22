/**
 * Load the JSONL written by export_openai_prompts.py into the Studio database.
 *
 *   DATABASE_URL=... npx tsx scripts/load-export.ts prompt-export.jsonl
 *
 * Idempotent: imported versions are replaced by the newest export record,
 * versions saved in Studio are never touched, and an agent's published
 * version is set from OpenAI's default only while the agent has no
 * Studio-made versions.
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { normalizeInstructions, settingsFromResponse } from "../src/lib/openai-shape";

type ExportRecord = {
  ok: boolean;
  organization_id: string;
  organization_title: string;
  project_id: string;
  project_title: string;
  prompt_id: string;
  name: string;
  version: number | null;
  is_default?: boolean;
  model?: string;
  instructions?: { role: string; content: unknown }[];
  tools?: Record<string, unknown>[];
  reasoning?: Record<string, unknown> | null;
  text?: Record<string, unknown> | null;
  temperature?: number | null;
  top_p?: number | null;
  truncation?: string | null;
  parallel_tool_calls?: boolean | null;
  model_unavailable?: boolean;
  error?: unknown;
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: load-export.ts <export.jsonl>");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  // Later lines win, so a re-export overrides an earlier failure or copy.
  const latest = new Map<string, ExportRecord>();
  const failures: ExportRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as ExportRecord;
    if (!record.ok) {
      failures.push(record);
      continue;
    }
    latest.set(`${record.prompt_id}@${record.version}`, record);
  }
  const okKeys = new Set(latest.keys());
  const unresolvedByKey = new Map<string, ExportRecord>();
  for (const f of failures) {
    const key = `${f.prompt_id}@${f.version}`;
    // A failure is resolved by a later success for the same version, or, for a
    // failed default-version probe (version null), by any success for the agent.
    const resolved =
      okKeys.has(key) || (f.version === null && [...okKeys].some((k) => k.startsWith(`${f.prompt_id}@`)));
    if (!resolved) unresolvedByKey.set(key, f);
  }
  const unresolved = [...unresolvedByKey.values()];

  const records = [...latest.values()].sort(
    (a, b) => a.prompt_id.localeCompare(b.prompt_id) || a.version! - b.version!,
  );
  let versionsWritten = 0;
  const agentsSeen = new Set<string>();

  await db.transaction(async (tx) => {
    for (const r of records) {
      await tx
        .insert(schema.organizations)
        .values({ id: r.organization_id, name: r.organization_title })
        .onConflictDoUpdate({
          target: schema.organizations.id,
          set: { name: r.organization_title, syncedAt: sql`now()` },
        });
      await tx
        .insert(schema.projects)
        .values({ id: r.project_id, organizationId: r.organization_id, name: r.project_title })
        .onConflictDoUpdate({
          target: schema.projects.id,
          set: { name: r.project_title, syncedAt: sql`now()` },
        });
      await tx
        .insert(schema.agents)
        .values({ id: r.prompt_id, projectId: r.project_id, name: r.name })
        .onConflictDoNothing();
      agentsSeen.add(r.prompt_id);

      const existing = await tx
        .select({ source: schema.agentVersions.source })
        .from(schema.agentVersions)
        .where(
          and(
            eq(schema.agentVersions.agentId, r.prompt_id),
            eq(schema.agentVersions.version, r.version!),
          ),
        );
      if (existing[0] && existing[0].source !== "openai-import") {
        throw new Error(
          `${r.prompt_id} v${r.version} already exists as a Studio version; ` +
            "refusing to overwrite it with an import",
        );
      }
      const values = {
        agentId: r.prompt_id,
        version: r.version!,
        model: r.model ?? "",
        instructions: normalizeInstructions(r.instructions ?? []),
        tools: r.tools ?? [],
        settings: settingsFromResponse(r),
        note: r.model_unavailable ? `OpenAI 已不提供模型 ${r.model}，請改選其他模型` : "",
        source: "openai-import",
      };
      await tx
        .insert(schema.agentVersions)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.agentVersions.agentId, schema.agentVersions.version],
          set: values,
        });
      versionsWritten++;

      if (r.is_default) {
        await tx.execute(sql`
          update agents set published_version = ${r.version}, updated_at = now()
          where id = ${r.prompt_id}
            and not exists (
              select 1 from agent_versions
              where agent_id = ${r.prompt_id} and source <> 'openai-import'
            )`);
      }
    }
  });

  console.log(`agents: ${agentsSeen.size}, versions written: ${versionsWritten}`);
  if (unresolved.length) {
    console.log(`unresolved failures: ${unresolved.length}`);
    for (const f of unresolved) {
      console.log(`  ${f.prompt_id} v${f.version ?? "default"} ${f.name}: ${JSON.stringify(f.error)}`);
    }
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
