import { getCurrentUser } from "@/lib/authz";
import { parseLogQuery } from "@/lib/request-log-query";
import { readRequestLogs } from "@/lib/request-log-db";

/** Administrators only: the lines carry caller addresses and key fingerprints. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return Response.json({ error: "forbidden" }, { status: 403 });
  const result = await readRequestLogs(parseLogQuery(new URL(request.url).searchParams));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
