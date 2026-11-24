"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Empty, InputNumber, Spin } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere } from "@/lib/logs-format";
import type { ConversationTurnPage, Turn } from "@/lib/logs-types";
import { LogsError, logsGet, logsSend, useLogsScope, type Params } from "./logs-client";
import { ConversationNotes, ConversationTitle } from "./curation";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";
import { TurnCard } from "./turn-card";

const PAGE = 100;

type Loaded = { key: string; items: Turn[]; next: string | null; prev: string | null; error: LogsError | null };

const asError = (error: unknown) => (error instanceof LogsError ? error : new LogsError(0, String(error)));

export function ConversationView({ id }: { id: string }) {
  const { t } = useI18n();
  const { scope, ready } = useLogsScope();
  const focus = useSearchParams().get("turn");
  const [start, setStart] = useState<Params>({});
  const startKey = JSON.stringify(start);
  const key = JSON.stringify([id, focus, start, scope]);
  const [state, setState] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<"next" | "prev" | null>(null);
  const [jump, setJump] = useState<number | null>(null);
  const [reloads, setReloads] = useState(0);
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const first: Params = startKey !== "{}" ? JSON.parse(startKey) as Params : focus ? { around: focus } : {};
    const path = `/v1/conversations/${encodeURIComponent(id)}/turns`;
    const read = (params: Params) => logsGet<ConversationTurnPage>(path, { ...params, limit: PAGE }, scope, controller.signal);
    read(first).catch((error: unknown) => {
      // A link to a turn this conversation does not hold still opens the conversation, from its start.
      if ("around" in first && error instanceof LogsError && (error.status === 404 || error.status === 422)) return read({});
      throw error;
    }).then(
      (page) => setState({ key, items: page.items, next: page.next_cursor, prev: page.prev_cursor, error: null }),
      (error: unknown) => { if (!controller.signal.aborted) setState({ key, items: [], next: null, prev: null, error: asError(error) }); },
    );
    return () => controller.abort();
  }, [key, ready, id, focus, startKey, scope, reloads]);

  const current = state?.key === key ? state : null;
  const items = useMemo(() => current?.items ?? [], [current]);

  const extend = useCallback(async (direction: "next" | "prev") => {
    if (!current) return;
    const cursor = direction === "next" ? current.next : current.prev;
    if (!cursor) return;
    setBusy(direction);
    try {
      const page = await logsGet<ConversationTurnPage>(
        `/v1/conversations/${encodeURIComponent(id)}/turns`,
        direction === "next" ? { cursor, limit: PAGE } : { before: cursor, limit: PAGE },
        scope,
      );
      setState((now) => now && now.key === key
        ? direction === "next"
          ? { ...now, items: [...now.items, ...page.items], next: page.next_cursor, error: null }
          : { ...now, items: [...page.items, ...now.items], prev: page.prev_cursor, error: null }
        : now);
    } catch (error) {
      setState((now) => now && now.key === key ? { ...now, error: asError(error) } : now);
    } finally {
      setBusy(null);
    }
  }, [current, id, key, scope]);

  useEffect(() => {
    // Opened from a turn: bring it into view once, not again as the window grows.
    if (!focus || scrolled.current === `${id}:${focus}` || !items.some((turn) => turn.id === focus)) return;
    document.getElementById(`turn-${focus}`)?.scrollIntoView?.({ block: "center" });
    scrolled.current = `${id}:${focus}`;
  }, [focus, id, items]);

  const total = items[0]?.conversation_turns ?? items.length;
  const head = items[0];
  const missing = focus != null && startKey === "{}" && current !== null && !current.error && !items.some((turn) => turn.id === focus);
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/logs">{t("← 回到對話列表")}</Link>
        <ConversationTitle id={id} fallback={head?.conversation_title || id} />
        <Bookmark id={id} />
      </div>
      {head && (
        <div className={styles.status}>
          {head.agent && <span>{head.agent}</span>}
          {agentWhere(head) && <span>{agentWhere(head)}</span>}
          <span>{t("共 {0} 則", [total])}</span>
          <a onClick={() => { setStart({}); setReloads((n) => n + 1); }}>{t("第一則")}</a>
          <a onClick={() => setStart({ latest: true })}>{t("最新")}</a>
          <span>
            {t("跳到第")}{" "}
            <InputNumber size="small" min={1} max={total} value={jump} onChange={(value) => setJump(value)} onPressEnter={() => jump && setStart({ seq: jump })} />
            {" "}<Button size="small" onClick={() => jump && setStart({ seq: jump })}>{t("前往")}</Button>
          </span>
        </div>
      )}
      <ConversationNotes id={id} />
      {missing && <p role="status">{t("這個對話裡沒有指定的回合，已從開頭顯示。")}</p>}
      {state === null || (current === null && !state.error) ? <Spin /> : null}
      {current?.error && <ErrorNote error={current.error} onRetry={() => setReloads((n) => n + 1)} />}
      {current && !current.error && items.length === 0 && <Empty description={t("這個對話沒有回合")} />}
      {current?.prev && <Button loading={busy === "prev"} onClick={() => void extend("prev")}>{t("載入較早的回合")}</Button>}
      {items.map((turn) => <TurnCard key={turn.id} turn={turn} highlight={turn.id === focus} />)}
      {current?.next && <Button loading={busy === "next"} onClick={() => void extend("next")}>{t("載入較晚的回合")}</Button>}
    </div>
  );
}

function Bookmark({ id }: { id: string }) {
  const { t } = useI18n();
  const { scope, ready } = useLogsScope();
  const [marked, setMarked] = useState<{ id: string; value: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    logsGet<{ bookmarked: boolean }>(`/v1/conversations/${encodeURIComponent(id)}/bookmark`, {}, scope, controller.signal)
      .then((b) => setMarked({ id, value: b.bookmarked }), () => undefined);
    return () => controller.abort();
  }, [id, ready, scope]);
  const value = marked?.id === id ? marked.value : null;
  if (value === null) return null;
  const toggle = async () => {
    setSaving(true);
    try {
      await logsSend(value ? "DELETE" : "PUT", `/v1/conversations/${encodeURIComponent(id)}/bookmark`, undefined, scope);
      setMarked({ id, value: !value });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Button size="small" loading={saving} icon={value ? <StarFilled /> : <StarOutlined />} onClick={() => void toggle()}>
      {value ? t("已加書籤") : t("加書籤")}
    </Button>
  );
}
