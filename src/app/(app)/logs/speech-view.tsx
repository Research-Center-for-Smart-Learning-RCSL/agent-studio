"use client";
import { Empty, Spin, Table, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, byteSize, durationText, recordingUrl, wallClock } from "@/lib/logs-format";
import type { SpeechEvent } from "@/lib/logs-types";
import { usePagedLogs } from "./logs-client";
import { FilterBar, useUrlFilters } from "./logs-filters";
import { ErrorNote, LoadMore, RuntimeTag, StatusTag } from "./logs-ui";
import styles from "./logs.module.css";

export function SpeechList() {
  const { t } = useI18n();
  const { filters, params, set, reset, bad } = useUrlFilters();
  const list = usePagedLogs<SpeechEvent>("/v1/speech", { ...params, limit: 50 }, !bad);
  const empty = !list.loading && !list.error && list.items.length === 0;
  return (
    <div className={styles.page}>
      <FilterBar filters={filters} set={set} reset={reset} bad={bad} showStatus showKind searchPlaceholder={t("搜尋語音文字")} />
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && !bad && <Spin />}
      {empty && !bad && <Empty description={t("沒有符合的語音事件")} />}
      {list.items.length > 0 && (
        <>
          <Table<SpeechEvent>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={list.items}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("時間"), dataIndex: "created_at", render: (v: string) => wallClock(v) },
              { title: t("種類"), dataIndex: "kind", render: (v: string) => <Tag>{v === "stt" ? t("語音轉文字") : t("文字轉語音")}</Tag> },
              { title: t("狀態"), dataIndex: "status", render: (v: string) => <StatusTag status={v} /> },
              { title: t("延遲"), dataIndex: "latency_ms", render: (v: number | null) => durationText(v) },
              { title: t("執行環境"), render: (_: unknown, row) => <RuntimeTag endpoint={row.endpoint} robotSerial={row.robot_serial} robotName={row.robot_name} /> },
              {
                title: "Agent",
                render: (_: unknown, row) => row.agent ? <span>{row.agent}<span className={styles.sub}>{agentWhere(row)}</span></span> : null,
              },
              {
                title: t("內容"),
                width: 380,
                render: (_: unknown, row) => (
                  <div>
                    <span className={styles.clip}>{row.kind === "stt" ? row.transcript_final : row.text_in}</span>
                    {row.error_text && <span className={styles.error}>{row.error_text}</span>}
                    {row.kind === "tts" && row.audio_out_bytes != null && <span className={styles.sub}>{byteSize(row.audio_out_bytes)}</span>}
                    {row.audio_sha256 && <audio className={styles.audio} controls preload="none" src={recordingUrl(row.audio_sha256)} />}
                  </div>
                ),
              },
            ]}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("筆語音事件")} />
        </>
      )}
    </div>
  );
}
