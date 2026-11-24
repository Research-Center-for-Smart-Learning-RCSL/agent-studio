const storageKey = "agent-studio:directory-view";

export type DirectoryContext = {
  userEmail: string;
  includeArchived: boolean;
  query: string;
  organization: string | null;
  project: string | null;
};

export type DirectoryView = DirectoryContext & {
  agentId: string;
  visibleCount: number;
  scrollTop: number;
  anchor: { id: string; offset: number } | null;
};

export function readDirectoryView(): DirectoryView | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Partial<DirectoryView> | null;
    if (
      !saved ||
      typeof saved.userEmail !== "string" ||
      typeof saved.agentId !== "string" ||
      typeof saved.includeArchived !== "boolean" ||
      typeof saved.query !== "string" ||
      (saved.organization !== null && typeof saved.organization !== "string") ||
      (saved.project !== null && typeof saved.project !== "string") ||
      typeof saved.visibleCount !== "number" || !Number.isSafeInteger(saved.visibleCount) || saved.visibleCount < 0 ||
      typeof saved.scrollTop !== "number" || !Number.isFinite(saved.scrollTop) || saved.scrollTop < 0 ||
      (saved.anchor !== null && (typeof saved.anchor?.id !== "string" || !Number.isFinite(saved.anchor.offset)))
    ) return null;
    return saved as DirectoryView;
  } catch {
    return null;
  }
}

export function takeDirectoryView(userEmail: string, includeArchived: boolean) {
  const saved = readDirectoryView();
  if (!saved || saved.userEmail !== userEmail || saved.includeArchived !== includeArchived) return null;
  try {
    sessionStorage.removeItem(storageKey);
  } catch { /* Storage can be unavailable. */ }
  return saved;
}

function headerBottom() {
  return document.querySelector(".studio-header")?.getBoundingClientRect().bottom ?? 0;
}

export function rememberDirectoryView(context: DirectoryContext, agentId: string, visibleCount: number, container: HTMLElement | null) {
  const header = headerBottom();
  let anchor: DirectoryView["anchor"] = null;
  for (const row of container?.querySelectorAll<HTMLElement>("tr[data-row-key]") ?? []) {
    const bounds = row.getBoundingClientRect();
    const id = row.dataset.rowKey;
    if (id && bounds.bottom > header) {
      anchor = { id, offset: bounds.top - header };
      break;
    }
  }
  const view: DirectoryView = { ...context, agentId, visibleCount, scrollTop: Math.max(window.scrollY, 0), anchor };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(view));
  } catch { /* Storage can be unavailable. */ }
}

export function restoreDirectoryScroll(view: DirectoryView, container: HTMLElement | null) {
  const row = view.anchor && container?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(view.anchor.id)}"]`);
  const top = row && view.anchor
    ? window.scrollY + row.getBoundingClientRect().top - headerBottom() - view.anchor.offset
    : view.scrollTop;
  window.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
}
