"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, Spin } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { wallClock } from "@/lib/logs-format";
import type { Turn } from "@/lib/logs-types";
import { ListExport, useRobotLabel } from "./export-control";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, Highlight, LoadMore, RuntimeTag, StatusTag, useRowOpen } from "./logs-ui";
import styles from "./logs.module.css";
import { listSearchOf } from "./split-layout";
import { TurnCard, conversationHref } from "./turn-card";

/** The list of turns. `pane` is true when a turn's conversation is open beside it; `selected` is that conversation. */
export function TurnList({ pane = false, selected = null }: { pane?: boolean; selected?: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const params_ = useSearchParams();
  const search = listSearchOf(params_);
  const openTurn = params_.get("turn");
  const { filters, params, set, reset, bad } = useUrlFilters();
  const { kind: _kind, ...turnFilters } = params;
  void _kind;
  const robotName = useRobotLabel();
  const list = usePagedLogs<Turn>("/v1/turns", { ...turnFilters, limit: 50 }, !bad);
  const empty = !list.loading && !list.error && list.items.length === 0;
  // Switching between records replaces the entry, so Back does not step through every turn looked at.
  const replace = selected !== null;
  const rowOpen = useRowOpen(replace);
  const hrefOf = (turn: Turn) => turn.conversation ? conversationHref(turn.conversation, turn.id, { search, base: "/logs/turns" }) : undefined;
  const keys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!pane || selected === null || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    if ((event.target as HTMLElement).closest("input, select, textarea, [role=combobox]")) return;
    const openable = list.items.filter((turn) => turn.conversation);
    const at = openable.findIndex((turn) => turn.id === openTurn);
    const next = at < 0 ? (event.key === "ArrowDown" ? 0 : -1) : at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0 || next >= openable.length) return;
    event.preventDefault();
    router.replace(hrefOf(openable[next])!, { scroll: false });
  };
  return (
    <div className={`${styles.page}${pane ? ` ${styles.panePage}` : ""}`} tabIndex={-1} onKeyDown={keys}>
      <div className={pane ? styles.paneFilters : undefined}>
        <FilterBar filters={filters} set={set} reset={reset} bad={bad} showStatus searchPlaceholder={t("搜尋訊息內容")} />
      </div>
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的回合")} />}
      {list.items.length > 0 && <ListExport filter={turnFilters} robotName={robotName} />}
      {list.items.map((turn) => {
        const href = hrefOf(turn);
        if (!pane) return <TurnCard key={turn.id} turn={turn} query={filters.q} showConversation openHref={href} />;
        const text = turn.input_text ?? turn.output_text ?? "";
        return (
          <div key={turn.id} onClick={rowOpen(href ?? null).onClick} className={`${styles.paneRow} ${styles.turnRow}${turn.id === openTurn && turn.conversation === selected ? ` ${styles.selectedRow}` : ""}`}>
            <div className={styles.paneHead}>
              {href ? <Link href={href} replace={replace} scroll={false}>{wallClock(turn.started_at)}</Link> : <time dateTime={turn.started_at}>{wallClock(turn.started_at)}</time>}
              <StatusTag status={turn.status} />
              <RuntimeTag endpoint={turn.endpoint} robotSerial={turn.robot_serial} robotName={turn.robot_name} />
            </div>
            {turn.agent && <div className={styles.paneAgent}>{turn.agent}</div>}
            {text && <div className={styles.clip}><Highlight text={text} query={filters.q} /></div>}
          </div>
        );
      })}
      {list.items.length > 0 && (
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("則回合")} />
      )}
    </div>
  );
}
