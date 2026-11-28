import type { Instrumentation } from "next";
import { logEvent, pathOnly, shortMessage } from "@/lib/request-log";

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
