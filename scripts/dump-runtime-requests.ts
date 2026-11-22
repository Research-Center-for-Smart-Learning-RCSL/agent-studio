/**
 * Write the inline request the runtime API would serve for every agent's
 * published version, one JSON line each, for verify_inline_requests.py.
 *
 *   DATABASE_URL=... npx tsx scripts/dump-runtime-requests.ts > requests.jsonl
 */
import { Pool } from "pg";
import { toResponsesRequest } from "../src/lib/openai-shape";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(`
    select a.id, a.name, v.version, v.model, v.instructions, v.tools, v.settings, v.note
    from agents a join agent_versions v on v.agent_id = a.id and v.version = a.published_version
    where a.archived_at is null order by a.id`);
  for (const r of rows) {
    let request: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      request = toResponsesRequest(r);
    } catch (e) {
      error = (e as Error).message;
    }
    process.stdout.write(JSON.stringify({ id: r.id, name: r.name, version: r.version, request, error }) + "\n");
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
