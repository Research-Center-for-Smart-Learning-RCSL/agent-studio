"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, Segmented, Spin, Table } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, wallClock } from "@/lib/logs-format";
import type { ConversationSummary, Turn } from "@/lib/logs-types";
import { usePagedLogs } from "./logs-client";
import { ErrorNote, LoadMore, OpenLink, RuntimeTag, useRowOpen } from "./logs-ui";
import styles from "./logs.module.css";
import { TurnCard, conversationHref } from "./turn-card";

type BookmarkedConversation = ConversationSummary & { bookmarked_at: string };
type BookmarkedTurn = Turn & { bookmarked_at: string };

export function BookmarksView() {
  const { t } = useI18n();
  const [kind, setKind] = useState<"conversations" | "turns">("conversations");
  return (
    <div className={styles.page}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[{ value: "conversations", label: t("對話書籤") }, { value: "turns", label: t("回合書籤") }]}
      />
      {kind === "conversations" ? <ConversationBookmarks /> : <TurnBookmarks />}
    </div>
  );
}

function ConversationBookmarks() {
  const rowOpen = useRowOpen();
  const { t } = useI18n();
  const list = usePagedLogs<BookmarkedConversation>("/v1/bookmarks/conversations", { limit: 50 });
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  if (list.loading) return <Spin />;
  if (list.items.length === 0) return <Empty description={t("還沒有書籤")} />;
  return (
    <>
      <Table<BookmarkedConversation>
        rowKey="conversation"
        size="small"
        pagination={false}
        dataSource={list.items}
        scroll={{ x: "max-content" }}
        onRow={(row) => rowOpen(conversationHref(row.conversation))}
        columns={[
          { title: t("加入書籤"), dataIndex: "bookmarked_at", render: (v: string) => wallClock(v) },
          {
            title: t("對話"),
            render: (_: unknown, row) => (
              <Link href={conversationHref(row.conversation)}>{row.title || row.first_input || row.conversation}</Link>
            ),
          },
          { title: t("執行環境"), render: (_: unknown, row) => <RuntimeTag endpoint={row.endpoint} robotSerial={row.robot_serial} robotName={row.robot_name} /> },
          {
            title: "Agent",
            render: (_: unknown, row) => row.agent ? <span>{row.agent}<span className={styles.sub}>{agentWhere(row)}</span></span> : null,
          },
          { title: t("回合"), dataIndex: "turns" },
          { title: "", fixed: "right" as const, render: (_: unknown, row) => <OpenLink href={conversationHref(row.conversation)} /> },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("個對話")} />
    </>
  );
}

function TurnBookmarks() {
  const { t } = useI18n();
  const list = usePagedLogs<BookmarkedTurn>("/v1/bookmarks/turns", { limit: 50 });
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  if (list.loading) return <Spin />;
  if (list.items.length === 0) return <Empty description={t("還沒有書籤")} />;
  return (
    <>
      {list.items.map((turn) => <TurnCard key={turn.id} turn={turn} showConversation />)}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("則回合")} />
    </>
  );
}
