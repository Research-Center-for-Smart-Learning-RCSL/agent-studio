import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Bearer token agent.rcsl.online presents to the runtime API. */
  get runtimeToken() {
    return required("RUNTIME_TOKEN");
  },
  /** 32-byte key, base64, for encrypting MCP credentials. */
  get secretsKey() {
    return required("SECRETS_KEY");
  },
  get rcslApi() {
    return required("RCSL_API").replace(/\/+$/, "");
  },
  /** Value of the Authorization header the RCSL data API expects. */
  get rcslAuthorization() {
    return required("RCSL_AUTHORIZATION");
  },
  /** Base URL of the OpenAI Logs Manager API (its web container's /api); Logs is hidden when unset. */
  get logsApi(): string | null {
    const value = process.env.LOGS_API?.trim();
    return value ? value.replace(/\/+$/, "") : null;
  },
  /** Shared with the Logs API (STUDIO_SERVICE_TOKEN there); never sent to a browser. */
  get logsServiceToken(): string | null {
    return process.env.LOGS_SERVICE_TOKEN?.trim() || null;
  },
  /** Comma-separated emails that are always admins. */
  get adminEmails(): Set<string> {
    return new Set(
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
  },
};
