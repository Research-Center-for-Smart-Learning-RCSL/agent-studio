import type { Instrumentation } from "next";
import { logEvent, pathOnly, shortMessage } from "@/lib/request-log";

/** Starts storing log lines for the admin page; if that fails, the lines still go to stdout. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "request_log_store_failed", message: shortMessage(error) }));
  }
}

/** Every error Next catches (render, route handler, server action) becomes one log line. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  logEvent("request_error", {
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
    path: pathOnly(request.path),
    message: shortMessage(error),
    digest,
  });
};
