import { getCurrentUser } from "@/lib/authz";
import { env } from "@/lib/env";
import { LogsScopeTooLarge, logsConfigured, logsHeaders } from "@/lib/logs";
import { forwardablePath, needsAdmin } from "@/lib/logs-scope";

type LogsRoute = RouteContext<"/api/logs/[...path]">;

const forwardedRequestHeaders = ["accept", "content-type", "range", "if-none-match"];
const forwardedResponseHeaders = [
  "content-type", "content-disposition", "content-length", "content-range", "accept-ranges", "etag", "retry-after",
];
const studioParams = ["studio_org", "studio_project"];
const timeoutMs = 60_000;

function failure(error: string, status: number) {
  return Response.json({ error }, { status });
}

/** A state-changing request must come from this site: the session cookie alone would let another site act as the user. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

async function forward(request: Request, context: LogsRoute) {
  if (!logsConfigured()) return failure("Logs 尚未設定", 503);
  const user = await getCurrentUser();
  if (!user) return failure("請先登入", 401);
  if (request.method !== "GET" && !sameOrigin(request)) return failure("來源不符", 403);
  const path = forwardablePath((await context.params).path);
  if (!path) return failure("找不到", 404);
  // Views that add up every project are the administrators' alone, whatever Logs would answer a scoped caller.
  if (!user.isAdmin && needsAdmin(path)) return failure("沒有權限", 403);

  const incoming = new URL(request.url);
  const filter = {
    organization: incoming.searchParams.get("studio_org") || undefined,
    project: incoming.searchParams.get("studio_project") || undefined,
  };
  for (const name of studioParams) incoming.searchParams.delete(name);

  let headers: Headers;
  try {
    headers = await logsHeaders(user, filter, path);
  } catch (error) {
    if (error instanceof LogsScopeTooLarge) return failure("可讀取的專案過多，請縮小專案篩選", 413);
    throw error;
  }
  // The body is passed on as received, so it must not arrive compressed with a length that no longer fits.
  headers.set("accept-encoding", "identity");
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const query = incoming.searchParams.toString();
  const target = `${env.logsApi}/${path}${query ? `?${query}` : ""}`;
  const hasBody = request.method !== "GET" && request.method !== "DELETE";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error("logs request failed", { path, name: error instanceof Error ? error.name : typeof error });
    return failure("無法連線到 Logs", 502);
  }

  // What Logs serves can include files users supplied; they must never run as pages of this site.
  const out = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" });
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
