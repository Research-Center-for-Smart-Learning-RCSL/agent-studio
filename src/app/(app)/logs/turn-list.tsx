"use client";
import { Empty, Spin } from "antd";
import { useI18n } from "@/lib/i18n-client";
import type { Turn } from "@/lib/logs-types";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, LoadMore } from "./logs-ui";
import styles from "./logs.module.css";
import { TurnCard } from "./turn-card";

export function TurnList() {
  const { t } = useI18n();
  const { filters, params, set, reset, bad } = useUrlFilters();
  const list = usePagedLogs<Turn>("/v1/turns", { ...params, limit: 50 }, !bad);
  const empty = !list.loading && !list.error && list.items.length === 0;
  return (
    <div className={styles.page}>
      <FilterBar filters={filters} set={set} reset={reset} bad={bad} showStatus searchPlaceholder={t("搜尋訊息內容")} />
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的回合")} />}
      {list.items.map((turn) => <TurnCard key={turn.id} turn={turn} query={filters.q} showConversation />)}
      {list.items.length > 0 && (
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("則回合")} />
      )}
    </div>
  );
}
