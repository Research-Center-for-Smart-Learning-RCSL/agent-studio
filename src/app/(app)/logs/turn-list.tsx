"use client";
import { useState } from "react";
import { Button, Empty, Spin } from "antd";
import { useI18n } from "@/lib/i18n-client";
import type { Turn } from "@/lib/logs-types";
import { ExportDialog } from "./export-dialog";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, LoadMore } from "./logs-ui";
import styles from "./logs.module.css";
import { TurnCard } from "./turn-card";

export function TurnList() {
  const { t } = useI18n();
  const { filters, params, set, reset, bad } = useUrlFilters();
  const { kind: _kind, ...turnFilters } = params;
  void _kind;
  const [exporting, setExporting] = useState(false);
  const list = usePagedLogs<Turn>("/v1/turns", { ...turnFilters, limit: 50 }, !bad);
  const empty = !list.loading && !list.error && list.items.length === 0;
  return (
    <div className={styles.page}>
      <FilterBar filters={filters} set={set} reset={reset} bad={bad} showStatus searchPlaceholder={t("搜尋訊息內容")} />
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的回合")} />}
      {list.items.length > 0 && <div><Button onClick={() => setExporting(true)}>{t("匯出目前篩選結果")}</Button></div>}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} filter={turnFilters} />
      {list.items.map((turn) => <TurnCard key={turn.id} turn={turn} query={filters.q} showConversation />)}
      {list.items.length > 0 && (
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("則回合")} />
      )}
    </div>
  );
}
