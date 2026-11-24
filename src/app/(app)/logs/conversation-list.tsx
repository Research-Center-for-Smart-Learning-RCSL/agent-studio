"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Empty, Spin, Table } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, wallClock } from "@/lib/logs-format";
import type { ConversationSummary } from "@/lib/logs-types";
import { ExportDialog } from "./export-dialog";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, Highlight, LoadMore, RuntimeTag } from "./logs-ui";
import styles from "./logs.module.css";
import { conversationHref } from "./turn-card";

export function ConversationList() {
  const { t } = useI18n();
  const { filters, params, set, reset, bad } = useUrlFilters();
  const { status: _status, kind: _kind, ...conversationFilters } = params;
  void _status;
  void _kind;
  const list = usePagedLogs<ConversationSummary>("/v1/conversations", { ...conversationFilters, limit: 50 }, !bad);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const empty = !list.loading && !list.error && list.items.length === 0;
  return (
    <div className={styles.page}>
      <FilterBar filters={filters} set={set} reset={reset} bad={bad} searchPlaceholder={t("搜尋對話內容或標題")} />
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的對話")} />}
      {list.items.length > 0 && (
        <>
          <div className={styles.status}>
            <span>{t("依最近活動排序")}</span>
            {selected.length > 0 && <Button size="small" onClick={() => setExporting(true)}>{t("匯出所選（{0}）", [selected.length])}</Button>}
            {selected.length > 0 && <a onClick={() => setSelected([])}>{t("取消選取")}</a>}
            <a onClick={list.reload}>{t("重新整理")}</a>
          </div>
          <Table<ConversationSummary>
            rowKey="conversation"
            size="small"
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String).slice(0, 200)) }}
            dataSource={list.items}
            scroll={{ x: "max-content" }}
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
            ]}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("個對話")} />
        </>
      )}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} conversations={selected} />
    </div>
  );
}
