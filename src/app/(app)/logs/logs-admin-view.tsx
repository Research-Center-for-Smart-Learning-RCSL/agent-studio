"use client";
import { Alert, Spin, Table, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { byteSize, wallClock } from "@/lib/logs-format";
import { useLogsResource } from "./logs-client";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";

type Health = {
  checked_at: string;
  stale_after_seconds: number;
  sources: { name: string; alerts: string[]; exchanges_24h: number; flagged_24h: number; last_exchange_at: string | null; last_ingested_at: string | null; open_connections: number | null; record_errors: number | null }[];
  flagged: { id: string; kind: string; method: string; path: string; source: string; started_at: string; http_status: number | null; flags: string[] }[];
};
type Storage = {
  alerts: string[];
  checked_at: string;
  measured_at: string | null;
  filesystems: { id: string; free_bytes: number | null; total_bytes: number; low: boolean }[];
  locations: { location: string; used_bytes: number | null; fs_id: string | null }[];
};

export function CaptureHealth() {
  const { t } = useI18n();
  const health = useLogsResource<Health>("/v1/admin/capture-health");
  const storage = useLogsResource<Storage>("/v1/admin/storage");
  return (
    <div className={styles.page}>
      <p className={styles.sub}>{t("擷取與儲存狀態涵蓋整個 Logs 系統，只有管理員可以查看。")}</p>
      {health.error && <ErrorNote error={health.error} onRetry={health.reload} />}
      {health.loading && <Spin />}
      {health.data && (
        <>
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            title={() => t("擷取來源（檢查時間 {0}）", [wallClock(health.data!.checked_at)])}
            dataSource={health.data.sources}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("來源"), dataIndex: "name" },
              {
                title: t("狀態"),
                dataIndex: "alerts",
                render: (alerts: string[]) => alerts.length === 0 ? <Tag color="green" variant="filled">{t("正常")}</Tag> : alerts.map((a) => <Tag key={a} color="red" variant="filled">{a}</Tag>),
              },
              { title: t("24 小時請求"), dataIndex: "exchanges_24h" },
              { title: t("24 小時異常"), dataIndex: "flagged_24h" },
              { title: t("最後請求"), dataIndex: "last_exchange_at", render: (v: string | null) => v ? wallClock(v) : "" },
              { title: t("最後匯入"), dataIndex: "last_ingested_at", render: (v: string | null) => v ? wallClock(v) : "" },
              { title: t("連線數"), dataIndex: "open_connections" },
              { title: t("紀錄錯誤"), dataIndex: "record_errors" },
            ]}
          />
          {health.data.flagged.length > 0 && (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              title={() => t("最近被標記的請求")}
              dataSource={health.data.flagged}
              scroll={{ x: "max-content" }}
              columns={[
                { title: t("時間"), dataIndex: "started_at", render: (v: string) => wallClock(v) },
                { title: t("來源"), dataIndex: "source" },
                { title: t("請求"), render: (_: unknown, row) => `${row.method} ${row.path}` },
                { title: "HTTP", dataIndex: "http_status" },
                { title: t("標記"), dataIndex: "flags", render: (flags: string[]) => flags.map((f) => <Tag key={f}>{f}</Tag>) },
              ]}
            />
          )}
        </>
      )}
      {storage.error && <ErrorNote error={storage.error} onRetry={storage.reload} />}
      {storage.data && (
        <>
          {storage.data.alerts.map((a) => <Alert key={a} type="warning" showIcon title={a} />)}
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            title={() => t("儲存空間")}
            dataSource={storage.data.filesystems}
            columns={[
              { title: t("檔案系統"), dataIndex: "id" },
              { title: t("可用"), dataIndex: "free_bytes", render: (v: number | null) => byteSize(v) },
              { title: t("總量"), dataIndex: "total_bytes", render: (v: number) => byteSize(v) },
              { title: t("狀態"), dataIndex: "low", render: (low: boolean) => low ? <Tag color="red" variant="filled">{t("空間偏低")}</Tag> : <Tag color="green" variant="filled">{t("正常")}</Tag> },
            ]}
          />
          <Table
            rowKey="location"
            size="small"
            pagination={false}
            dataSource={storage.data.locations}
            columns={[
              { title: t("位置"), dataIndex: "location" },
              { title: t("已用"), dataIndex: "used_bytes", render: (v: number | null) => byteSize(v) },
            ]}
          />
        </>
      )}
    </div>
  );
}
