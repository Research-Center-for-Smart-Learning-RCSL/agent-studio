/**
 * A `shell` tool whose environment is `local` is run by the client. Neither the web chat backend nor
 * the physical apps execute it, so a command the model asks for never runs, and in the web chat an
 * unanswered call used to make every later request of the conversation fail with a 400.
 */
export function hasLocalShell(tools: readonly Record<string, unknown>[]): boolean {
  return tools.some((tool) => {
    if (tool.type !== "shell") return false;
    const environment = tool.environment;
    return typeof environment === "object" && environment !== null && (environment as { type?: unknown }).type === "local";
  });
}
