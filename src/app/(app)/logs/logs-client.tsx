"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { App } from "antd";
import { logsPath } from "@/lib/logs-format";
import type { Page } from "@/lib/logs-types";

export type LogsScope = { organization?: string; project?: string };
export type Params = Record<string, string | number | boolean | undefined | null>;

const ScopeContext = createContext<{ scope: LogsScope; ready: boolean }>({ scope: {}, ready: false });

/** Follows the header's organization and project filter, which Logs reads as the narrowing of what the user may see. */
export function LogsProvider({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const [state, setState] = useState<{ scope: LogsScope; ready: boolean }>({ scope: {}, ready: false });
  useEffect(() => {
    const key = `agent-studio:scope:${userEmail}`;
    let saved: LogsScope = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as LogsScope | null;
      saved = { organization: parsed?.organization || undefined, project: parsed?.project || undefined };
    } catch { /* Storage can be unavailable or stale. */ }
    // A re-announcement of the same choice keeps the same object, so open windows are not reset.
    const adopt = (next: LogsScope) => setState((now) => now.ready && now.scope.organization === next.organization && now.scope.project === next.project ? now : { scope: next, ready: true });
    queueMicrotask(() => adopt(saved));
    const follow = (event: Event) => {
      const detail = ((event as CustomEvent).detail ?? {}) as LogsScope;
      adopt({ organization: detail.organization || undefined, project: detail.project || undefined });
    };
    window.addEventListener("agent-studio-scope", follow);
    return () => window.removeEventListener("agent-studio-scope", follow);
  }, [userEmail]);
  return <ScopeContext.Provider value={state}><App component={false}>{children}</App></ScopeContext.Provider>;
}

export function useLogsScope() {
  return useContext(ScopeContext);
}

export class LogsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function logsUrl(path: string, params: Params, scope: LogsScope): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== false) search.set(name, String(value));
  }
  if (scope.organization) search.set("studio_org", scope.organization);
  if (scope.project) search.set("studio_project", scope.project);
  const query = search.toString();
  return `${logsPath}${path}${query ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
}

async function failureOf(response: Response): Promise<LogsError> {
  let message = response.statusText || String(response.status);
  try {
    const body = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === "string") message = body.error;
    else if (typeof body.detail === "string") message = body.detail;
  } catch { /* The body was not JSON. */ }
  return new LogsError(response.status, message);
}

export async function logsGet<T>(path: string, params: Params, scope: LogsScope, signal?: AbortSignal): Promise<T> {
  const response = await fetch(logsUrl(path, params, scope), { signal, cache: "no-store" });
  if (!response.ok) throw await failureOf(response);
  return (await response.json()) as T;
}

export async function logsSend<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, scope: LogsScope): Promise<T | null> {
  const response = await fetch(logsUrl(path, {}, scope), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failureOf(response);
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

type Loaded<T> = {
  key: string;
  /** Which load of the list this is, so a page requested before a refresh is not added to the refreshed list. */
  gen: number;
  items: T[];
  next: string | null;
  error: LogsError | null;
  loadingMore: boolean;
  updatedAt: number | null;
};

/** A cursor-paged list that starts over whenever its path, filters or the header scope change. */
export function usePagedLogs<T>(path: string, params: Params, enabled = true) {
  const { scope, ready } = useLogsScope();
  const key = JSON.stringify([path, params, scope]);
  const [state, setState] = useState<Loaded<T> | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!ready || !enabled) return;
    const controller = new AbortController();
    const [pa, p, s] = JSON.parse(key) as [string, Params, LogsScope];
    logsGet<Page<T>>(pa, p, s, controller.signal).then(
      (page) => setState({ key, gen: reloads, items: page.items, next: page.next_cursor, error: null, loadingMore: false, updatedAt: Date.now() }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, gen: reloads, items: [], next: null, error: error instanceof LogsError ? error : new LogsError(0, String(error)), loadingMore: false, updatedAt: null });
      },
    );
    return () => controller.abort();
  }, [key, ready, enabled, reloads]);

  const current = state?.key === key ? state : null;
  const loadMore = useCallback(() => {
    const base = state;
    if (!base || base.key !== key || !base.next || base.loadingMore) return;
    setState({ ...base, loadingMore: true, error: null });
    const [pa, p, s] = JSON.parse(key) as [string, Params, LogsScope];
    logsGet<Page<T>>(pa, { ...p, cursor: base.next }, s).then(
      (page) => setState((now) => now && now.key === key && now.gen === base.gen
        ? { ...now, items: [...now.items, ...page.items], next: page.next_cursor, loadingMore: false, updatedAt: Date.now() }
        : now),
      (error: unknown) => setState((now) => now && now.key === key && now.gen === base.gen
        ? { ...now, loadingMore: false, error: error instanceof LogsError ? error : new LogsError(0, String(error)) }
        : now),
    );
  }, [state, key]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return useMemo(() => ({
    items: current?.items ?? ([] as T[]),
    loading: enabled && (!ready || current === null),
    loadingMore: current?.loadingMore ?? false,
    hasMore: Boolean(current?.next),
    error: current?.error ?? null,
    updatedAt: current?.updatedAt ?? null,
    loadMore,
    reload,
  }), [current, enabled, ready, loadMore, reload]);
}

/** One resource, read again when its path, parameters or the header scope change. */
export function useLogsResource<T>(path: string | null, params: Params = {}) {
  const { scope, ready } = useLogsScope();
  const key = JSON.stringify([path, params, scope]);
  const [state, setState] = useState<{ key: string; data: T | null; error: LogsError | null } | null>(null);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (!ready || path === null) return;
    const controller = new AbortController();
    const [pa, p, s] = JSON.parse(key) as [string, Params, LogsScope];
    logsGet<T>(pa, p, s, controller.signal).then(
      (data) => setState({ key, data, error: null }),
      (error: unknown) => {
        // A failed refresh keeps what was already shown for this resource.
        if (!controller.signal.aborted) setState((now) => ({ key, data: now?.key === key ? now.data : null, error: error instanceof LogsError ? error : new LogsError(0, String(error)) }));
      },
    );
    return () => controller.abort();
  }, [key, ready, path, reloads]);
  const current = state?.key === key ? state : null;
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { data: current?.data ?? null, error: current?.error ?? null, loading: path !== null && current === null, reload };
}
