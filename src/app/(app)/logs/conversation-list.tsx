"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, Spin, Table, type TableColumnsType } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, wallClock } from "@/lib/logs-format";
import type { ConversationSummary } from "@/lib/logs-types";
import { ConversationExport } from "./export-control";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, Highlight, LoadMore, OpenLink, RuntimeTag, useRowOpen } from "./logs-ui";
import styles from "./logs.module.css";
import { listSearchOf } from "./split-layout";
import { conversationHref } from "./turn-card";

/** The list of conversations. `pane` is true when a conversation is open beside it; `selected` is that conversation. */
export function ConversationList({ pane = false, selected = null }: { pane?: boolean; selected?: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const search = listSearchOf(useSearchParams());
  // Switching between records replaces the entry, so Back does not step through every conversation looked at.
  const replace = selected !== null;
  const hrefOf = (row: ConversationSummary) => conversationHref(row.conversation, row.match_turn_id ?? undefined, { search });
  const { filters, params, set, reset, bad } = useUrlFilters();
  const { status: _status, kind: _kind, ...conversationFilters } = params;
  void _status;
  void _kind;
  const list = usePagedLogs<ConversationSummary>("/v1/conversations", { ...conversationFilters, limit: 50 }, !bad);
  const rowOpen = useRowOpen(replace);
  const [checked, setChecked] = useState<string[]>([]);
  const empty = !list.loading && !list.error && list.items.length === 0;
  const keys = (event: React.KeyboardEvent<HTMLElement>) => {
    // Up and Down move through the rows while a conversation is open beside the list.
    if (!pane || selected === null || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    if ((event.target as HTMLElement).closest("input, select, textarea, [role=combobox]")) return;
    const ids = list.items.map((row) => row.conversation);
    const at = ids.indexOf(selected);
    const next = at < 0 ? (event.key === "ArrowDown" ? 0 : -1) : at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0 || next >= ids.length) return;
    event.preventDefault();
    router.replace(hrefOf(list.items[next]), { scroll: false });
  };
  const columns: TableColumnsType<ConversationSummary> = pane
    ? [{
      title: t("對話"),
      render: (_: unknown, row) => {
        const text = row.match_snippet ?? row.first_input ?? "";
        return (
          <div className={styles.paneRow}>
            <div className={styles.paneHead}>
              <Link href={hrefOf(row)} replace={replace} scroll={!replace}>{wallClock(row.last_seen_at)}</Link>
              <RuntimeTag endpoint={row.endpoint} robotSerial={row.robot_serial} robotName={row.robot_name} />
              <span>{row.turns}{row.failures > 0 && <span className={styles.failed}> {t("{0} 次失敗", [row.failures])}</span>}</span>
            </div>
            {row.agent && <div className={styles.paneAgent}>{row.agent}{agentWhere(row) && <span className={styles.sub}>{agentWhere(row)}</span>}</div>}
            {row.title && <div className={styles.title}><Highlight text={row.title} query={filters.q} /></div>}
            {text && <div className={styles.clip}><Highlight text={text} query={filters.q} /></div>}
          </div>
        );
      },
    }]
    : [
      {
        title: t("最近活動"),
        dataIndex: "last_seen_at",
        render: (value: string, row) => <Link href={hrefOf(row)}>{wallClock(value)}</Link>,
      },
      { title: t("開始"), dataIndex: "first_seen_at", render: (value: string) => <span className={styles.muted}>{wallClock(value)}</span> },
      { title: t("執行環境"), render: (_: unknown, row) => <RuntimeTag endpoint={row.endpoint} robotSerial={row.robot_serial} robotName={row.robot_name} /> },
      {
        title: "Agent",
        render: (_: unknown, row) => row.agent ? (
          <span>{row.agent}{agentWhere(row) && <span className={styles.sub}>{agentWhere(row)}</span>}</span>
        ) : null,
      },
      {
        title: t("回合"),
        render: (_: unknown, row) => (
          <span>{row.turns}{row.failures > 0 && <span className={styles.failed}> {t("{0} 次失敗", [row.failures])}</span>}</span>
        ),
      },
      {
        title: t("內容"),
        width: 420,
        render: (_: unknown, row) => {
          const text = row.match_snippet ?? row.first_input ?? "";
          return (
            <div>
              {row.title && <div className={styles.title}><Highlight text={row.title} query={filters.q} /></div>}
              {text && <Link className={styles.clip} href={hrefOf(row)}><Highlight text={text} query={filters.q} /></Link>}
            </div>
          );
        },
      },
      {
        title: "",
        fixed: "right" as const,
        render: (_: unknown, row) => <OpenLink href={hrefOf(row)} />,
      },
    ];
  return (
    <div className={`${styles.page}${pane ? ` ${styles.panePage}` : ""}`} tabIndex={-1} onKeyDown={keys}>
      <div className={pane ? styles.paneFilters : undefined}>
        <FilterBar filters={filters} set={set} reset={reset} bad={bad} searchPlaceholder={t("搜尋對話內容或標題")} />
      </div>
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的對話")} />}
      {checked.length > 0 && (
        <div className={styles.selectionBar}>
          <span>{t("已選 {0} 段", [checked.length])}</span>
          <ConversationExport conversations={checked} titleOf={(id) => list.items.find((c) => c.conversation === id)?.title ?? ""} />
          <a onClick={() => setChecked([])}>{t("取消選取")}</a>
          <span className={styles.muted}>{t("匯出的是所選對話的完整內容（每段由舊到新），不只是搜尋命中的回合。")}</span>
          <span className={styles.muted}>{t("一次最多匯出 {0} 段對話。", [200])}</span>
        </div>
      )}
      {list.items.length > 0 && (
        <>
          <div className={styles.status}>
            <span>{t("依最近活動排序")}</span>
            <a onClick={list.reload}>{t("重新整理")}</a>
          </div>
          <Table<ConversationSummary>
            rowKey="conversation"
            size="small"
            pagination={false}
            showHeader={!pane}
            rowSelection={{ selectedRowKeys: checked, onChange: (keys) => setChecked(keys.map(String).slice(0, 200)) }}
            dataSource={list.items}
            scroll={pane ? undefined : { x: "max-content" }}
            rowClassName={(row) => row.conversation === selected ? styles.selectedRow : ""}
            onRow={(row) => rowOpen(hrefOf(row))}
            columns={columns}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("個對話")} />
        </>
      )}
    </div>
  );
}
