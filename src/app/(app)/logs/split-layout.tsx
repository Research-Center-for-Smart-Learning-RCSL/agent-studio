"use client";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n-client";
import styles from "./logs.module.css";

const SHARE_KEY = "agent-studio:logs-split-share";
/** The list's default share of the width beside an open record. */
const DEFAULT_SHARE = 0.34;
const STEP = 0.05;
// Narrower than these a side is not worth showing: a drag takes it to nothing and the other side has the whole width.
const MIN_LIST_PX = 288;
const MIN_DETAIL_PX = 384;
/** Wide enough for a list and an open record side by side. */
const WIDE_QUERY = "(min-width: 1200px)";

function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

function loadShare(): number {
  try {
    const saved = Number(localStorage.getItem(SHARE_KEY));
    return saved > 0 && saved < 1 ? saved : DEFAULT_SHARE;
  } catch {
    return DEFAULT_SHARE;
  }
}

function saveShare(share: number) {
  try { localStorage.setItem(SHARE_KEY, String(share)); } catch { /* The width then lasts for this visit only. */ }
}

/** The grid columns for a list share: 0 gives the record the whole width, 1 the list. */
const columns = (share: number) =>
  share === 0 ? "0px auto minmax(0, 1fr)" : share === 1 ? "minmax(0, 1fr) auto 0px" : `${share * 100}% auto minmax(0, 1fr)`;

function snapShare(share: number, width: number): number {
  const px = share * width;
  if (px < MIN_LIST_PX) return 0;
  if (width - px < MIN_DETAIL_PX) return 1;
  return share;
}

/** The list's own query: its filters, without the turn a record opened on. */
export function listSearchOf(search: URLSearchParams): string {
  const params = new URLSearchParams(search.toString());
  params.delete("turn");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * A list with its open record beside it on a wide screen. On a narrow one the
 * record takes the page and the list returns with Back. The list lives in the
 * layout, so it keeps its pages and scroll while records are opened.
 */
export function SplitLayout({ listPath, detailBase, list, children }: {
  listPath: string;
  detailBase: string;
  list: (pane: boolean, selected: string | null) => ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const wide = useWide();
  const ref = useRef<HTMLDivElement>(null);
  const rest = pathname.startsWith(`${detailBase}/`) ? pathname.slice(detailBase.length + 1).split("/")[0] : "";
  const selected = rest ? decodeURIComponent(rest) : null;
  const split = selected !== null && wide;

  const [width, setWidth] = useState(DEFAULT_SHARE);
  useEffect(() => { queueMicrotask(() => setWidth(loadShare())); }, []);
  // One side on the whole screen holds only for the record it was chosen on.
  const [edge, setEdge] = useState<{ share: 0 | 1; at: string } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const share = preview ?? (edge?.at === selected ? edge.share : width);
  const resize = (next: number) => {
    if (next === 0 || next === 1) {
      setEdge({ share: next, at: selected ?? "" });
      return;
    }
    setEdge(null);
    setWidth(next);
    saveShare(next);
  };

  useLayoutEffect(() => {
    // Both panes scroll on their own, filling the screen below the page header.
    const el = ref.current;
    if (!split || !el) return;
    window.scrollTo(0, 0);
    const fit = () => el.style.setProperty("--split-top", `${el.getBoundingClientRect().top + window.scrollY}px`);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [split]);

  const close = () => router.push(`${listPath}${listSearchOf(search)}`);
  const classes = [styles.splitView, split ? styles.splitOn : "", split && preview !== null ? styles.splitDragging : ""].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} style={split ? { gridTemplateColumns: columns(share) } : undefined}>
      {(selected === null || split) && <div className={styles.splitList} inert={split && share === 0}>{list(split, selected)}</div>}
      {split && <SplitDivider share={share} onPreview={setPreview} onChange={resize} onClose={close} />}
      {selected !== null && (
        <div className={styles.splitDetail} key={selected} inert={split && share === 1}>
          {split && <button type="button" className={styles.splitClose} onClick={close}>{t("關閉")}</button>}
          {children}
        </div>
      )}
    </div>
  );
}

function SplitDivider({ share, onPreview, onChange, onClose }: {
  share: number;
  onPreview: (share: number | null) => void;
  onChange: (share: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const drag = useRef<{ last?: number } | null>(null);
  const boxOf = (el: HTMLElement) => el.parentElement?.getBoundingClientRect() ?? null;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxOf(event.currentTarget);
    if (!drag.current || !box || box.width === 0) return;
    drag.current.last = snapShare(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), box.width);
    onPreview(drag.current.last);
  };
  const end = (commit: boolean) => {
    const last = drag.current?.last;
    drag.current = null;
    onPreview(null);
    if (commit && last !== undefined) onChange(last);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const width = boxOf(event.currentTarget)?.width ?? 0;
    const from = share === 0 ? MIN_LIST_PX / (width || 1) - STEP : share === 1 ? 1 - MIN_DETAIL_PX / (width || 1) + STEP : share;
    const next = { ArrowLeft: from - STEP, ArrowRight: from + STEP, Home: 0, End: 1, Enter: DEFAULT_SHARE }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next <= 0 || next >= 1 ? Math.min(1, Math.max(0, next)) : snapShare(next, width));
  };
  return (
    <div
      className={styles.splitDivider}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("調整列表與內容的寬度")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        drag.current = {};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onDoubleClick={() => onChange(DEFAULT_SHARE)}
      onKeyDown={key}
    >
      <button type="button" className={styles.splitDividerClose} aria-label={t("關閉")} title={t("關閉")} onClick={onClose}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
