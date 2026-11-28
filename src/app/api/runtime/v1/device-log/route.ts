import { NextResponse } from "next/server";
import { insertLogRows } from "@/lib/request-log-db";
import { parseBackendEvents } from "@/lib/request-log-store";
import { runtimeAuthorized, runtimeError } from "@/lib/runtime-api";

const maxBodyBytes = 256 * 1024;

/** The body as text, or null once it passes `max` bytes; a chunked body without a length is cut off as it arrives. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Receives the device endpoint log lines the backend collects, for the admin page. Not wrapped in `loggedRoute`:
 * logging the arrival of every batch would add a line per batch to what it reports on.
 */
export async function POST(request: Request) {
  if (!runtimeAuthorized(request)) return runtimeError(401, "unauthorized");
  const raw = await readCapped(request, maxBodyBytes);
  if (raw === null) return runtimeError(413, "body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return runtimeError(400, "body must be JSON");
  }
  const { rows, skipped } = parseBackendEvents(body);
  await insertLogRows(rows);
  return NextResponse.json({ stored: rows.length, skipped }, { headers: { "Cache-Control": "no-store" } });
}
