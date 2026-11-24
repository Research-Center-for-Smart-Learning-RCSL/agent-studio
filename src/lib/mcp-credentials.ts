import type { SecretGrant } from "../db/schema";

const secretReference = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;
const headerField = /^headers\.[!#$%&'*+.^_`|~0-9a-z-]+$/;

function secretNamesIn(value: string): Set<string> {
  return new Set([...value.matchAll(secretReference)].map((match) => match[1]));
}

export function mcpServerUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const url = URL.parse(value);
  if (url?.protocol !== "https:" || url.username || url.password || url.hash) return null;
  return url.href;
}

export function validMcpCredentialField(value: string) {
  return value === "authorization" || headerField.test(value);
}

function headersOf(tool: Record<string, unknown>) {
  const headers = tool.headers;
  return headers && typeof headers === "object" && !Array.isArray(headers)
    ? Object.entries(headers)
    : [];
}

function mcpCredentialFields(tool: Record<string, unknown>) {
  if (tool.type !== "mcp") return [];
  const fields = typeof tool.authorization === "string"
    ? [{ field: "authorization", value: tool.authorization }]
    : [];
  for (const [name, value] of headersOf(tool)) {
    const field = `headers.${name.toLowerCase()}`;
    if (typeof value === "string" && validMcpCredentialField(field)) fields.push({ field, value });
  }
  return fields;
}

export function mcpCredentialReferences(tool: Record<string, unknown>) {
  const serverUrl = tool.connector_id == null ? mcpServerUrl(tool.server_url) : null;
  return mcpCredentialFields(tool).flatMap(({ field, value }) =>
    [...secretNamesIn(value)].map((name) => ({ name, field, serverUrl })));
}

export function credentialGranted(grants: readonly SecretGrant[] | undefined, projectId: string, reference: {
  serverUrl: string | null;
  field: string;
}) {
  return reference.serverUrl !== null && !!grants?.some((grant) =>
    grant.projectId === projectId && grant.serverUrl === reference.serverUrl && grant.field === reference.field);
}

export function resolveMcpCredentialFields(tools: Record<string, unknown>[], values: ReadonlyMap<string, string>) {
  const replace = (value: string) => value.replace(secretReference, (reference, name: string) => values.get(name) ?? reference);
  return tools.map((tool) => {
    if (tool.type !== "mcp") return tool;
    const resolved = { ...tool };
    if (mcpCredentialReferences(tool).length) resolved.server_url = mcpServerUrl(tool.server_url);
    if (typeof tool.authorization === "string") resolved.authorization = replace(tool.authorization);
    const headers = headersOf(tool);
    if (headers.length) {
      resolved.headers = Object.fromEntries(headers.map(([name, value]) => [
        name,
        typeof value === "string" && validMcpCredentialField(`headers.${name.toLowerCase()}`) ? replace(value) : value,
      ]));
    }
    return resolved;
  });
}
