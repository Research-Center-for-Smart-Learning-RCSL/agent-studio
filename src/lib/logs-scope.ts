/** Pure scope rules for the Logs integration; see docs/logs-integration.md. */

export type ScopeProject = { id: string; name: string; organizationId: string; organizationName: string };
export type ScopeFilterInput = { organization?: string; project?: string };

export type LogsCaller =
  | { kind: "admin" }
  | { kind: "scoped"; pairs: [string, string][] };

/** Paths whose answer adds up every project; only a Studio administrator may read them, and the project filter does not narrow them. */
const unrestrictedPrefixes = ["v1/analytics", "v1/admin"];

export function needsAdmin(path: string): boolean {
  return unrestrictedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The projects Logs may show this user. Administrators with no filter selected
 * read everything; otherwise the caller is limited to the readable projects,
 * narrowed by the header filter. A filter naming a project the user cannot read
 * narrows to nothing, never widens.
 */
export function logsCaller(input: {
  isAdmin: boolean;
  projects: ScopeProject[];
  readable: ReadonlySet<string> | null;
  filter: ScopeFilterInput;
  path: string;
}): LogsCaller {
  const { isAdmin, projects, readable, filter, path } = input;
  const filtered = Boolean(filter.organization || filter.project);
  if (isAdmin && (!filtered || needsAdmin(path))) return { kind: "admin" };
  const pairs = new Map<string, [string, string]>();
  for (const project of projects) {
    if (readable && !readable.has(project.id)) continue;
    if (filter.organization && project.organizationId !== filter.organization) continue;
    if (filter.project && project.id !== filter.project) continue;
    pairs.set(`${project.organizationName}\u0000${project.name}`, [project.organizationName, project.name]);
  }
  return { kind: "scoped", pairs: [...pairs.values()] };
}

/** The scope header value: base64url of a JSON list of [organization, project] pairs. */
export function encodeScope(pairs: [string, string][]): string {
  return Buffer.from(JSON.stringify(pairs), "utf8").toString("base64url");
}

/** Headers beyond this size risk being refused by the proxy in front of Logs. */
export const maxScopeHeaderLength = 6000;

/** Whether a client-supplied path may be forwarded to Logs: only its versioned API, never sign-in, health or traversal. */
export function forwardablePath(segments: string[]): string | null {
  if (segments.length === 0 || segments.some((s) => s === "" || s === "." || s === ".." || s.includes("/") || s.includes(String.fromCharCode(92)))) return null;
  const path = segments.join("/");
  if (!path.startsWith("v1/")) return null;
  if (path === "v1/health" || path === "v1/auth" || path.startsWith("v1/auth/")) return null;
  return path;
}
