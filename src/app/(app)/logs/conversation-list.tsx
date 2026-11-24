"use client";
import { useState } from "react";
import Link from "next/link";
import { Empty, Spin, Table } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, wallClock } from "@/lib/logs-format";
import type { ConversationSummary } from "@/lib/logs-types";
import { ConversationExport } from "./export-control";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, Highlight, LoadMore, OpenLink, RuntimeTag, useRowOpen } from "./logs-ui";
import styles from "./logs.module.css";
import { conversationHref } from "./turn-card";

export function ConversationList() {
  const { t } = useI18n();
  const { filters, params, set, reset, bad } = useUrlFilters();
  const { status: _status, kind: _kind, ...conversationFilters } = params;
  void _status;
  void _kind;
  const list = usePagedLogs<ConversationSummary>("/v1/conversations", { ...conversationFilters, limit: 50 }, !bad);
  const rowOpen = useRowOpen();
  const [selected, setSelected] = useState<string[]>([]);
  const empty = !list.loading && !list.error && list.items.length === 0;
  return (
    <div className={styles.page}>
      <FilterBar filters={filters} set={set} reset={reset} bad={bad} searchPlaceholder={t("搜尋對話內容或標題")} />
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的對話")} />}
      {selected.length > 0 && (
        <div className={styles.selectionBar}>
          <span>{t("已選 {0} 段", [selected.length])}</span>
          <ConversationExport conversations={selected} titleOf={(id) => list.items.find((c) => c.conversation === id)?.title ?? ""} />
          <a onClick={() => setSelected([])}>{t("取消選取")}</a>
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
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String).slice(0, 200)) }}
            dataSource={list.items}
            scroll={{ x: "max-content" }}
            onRow={(row) => rowOpen(row.match_turn_id ? conversationHref(row.conversation, row.match_turn_id) : conversationHref(row.conversation))}
            columns={[
              {
                title: t("最近活動"),
                dataIndex: "last_seen_at",
                render: (value: string, row) => <Link href={conversationHref(row.conversation)}>{wallClock(value)}</Link>,
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
                  const href = row.match_turn_id ? conversationHref(row.conversation, row.match_turn_id) : conversationHref(row.conversation);
                  return (
                    <div>
                      {row.title && <div className={styles.title}><Highlight text={row.title} query={filters.q} /></div>}
                      {text && <Link className={styles.clip} href={href}><Highlight text={text} query={filters.q} /></Link>}
                    </div>
                  );
                },
              },
              {
                title: "",
                fixed: "right" as const,
                render: (_: unknown, row) => <OpenLink href={row.match_turn_id ? conversationHref(row.conversation, row.match_turn_id) : conversationHref(row.conversation)} />,
              },
            ]}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("個對話")} />
        </>
      )}
    </div>
  );
}
