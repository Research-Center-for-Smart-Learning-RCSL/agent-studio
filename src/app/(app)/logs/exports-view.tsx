"use client";
import { useEffect, useState } from "react";
import { App, Button, Empty, Input, Modal, Spin, Table, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { byteSize, wallClock } from "@/lib/logs-format";
import type { ExportJob } from "@/lib/logs-types";
import { LogsError, logsSend, useLogsResource, useLogsScope } from "./logs-client";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";

export function ExportsView() {
  const { t, error: translate } = useI18n();
  const { message } = App.useApp();
  const { scope } = useLogsScope();
  const jobs = useLogsResource<ExportJob[]>("/v1/exports");
  const [renaming, setRenaming] = useState<ExportJob | null>(null);
  const [name, setName] = useState("");
  const pending = jobs.data?.some((job) => job.status === "queued" || job.status === "running") ?? false;
  const reload = jobs.reload;

  // A queued or running export is checked again every few seconds until it finishes.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [pending, reload]);

  const rename = async () => {
    if (!renaming) return;
    try {
      await logsSend("PATCH", `/v1/exports/${renaming.id}`, { name: name.trim() }, scope);
      setRenaming(null);
      reload();
    } catch (e) {
      void message.error(e instanceof LogsError ? translate(e.message) : String(e));
    }
  };

  if (jobs.error) return <ErrorNote error={jobs.error} onRetry={reload} />;
  if (jobs.loading) return <Spin />;
  if (!jobs.data || jobs.data.length === 0) return <Empty description={t("還沒有匯出。到對話或回合頁篩選後，按「匯出」。")} />;
  const statusTag = (job: ExportJob) => {
    if (job.status === "done") return <Tag color="green" variant="filled">{t("完成")}</Tag>;
    if (job.status === "failed") return <Tag color="red" variant="filled">{t("失敗")}</Tag>;
    return <Tag color="blue" variant="filled">{job.status === "running" ? t("處理中") : t("排隊中")}</Tag>;
  };
  return (
    <div className={styles.page}>
      <p className={styles.muted}>{t("匯出檔案保存一段時間後會自動刪除，只有建立者看得到。")}</p>
      <Table<ExportJob>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={jobs.data}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("建立時間"), dataIndex: "created_at", render: (v: string) => wallClock(v) },
          { title: t("名稱"), dataIndex: "name" },
          { title: t("格式"), dataIndex: "format" },
          { title: t("狀態"), render: (_: unknown, job) => <span>{statusTag(job)}{job.error && <span className={styles.error}>{job.error}</span>}</span> },
          {
            title: t("筆數"),
            render: (_: unknown, job) => <span>{job.rows}{job.truncated && <span className={styles.sub}>{t("已達上限，只含前面的資料")}</span>}</span>,
          },
          { title: t("大小"), dataIndex: "byte_size", render: (v: number | null) => byteSize(v) },
          { title: t("到期"), dataIndex: "expires_at", render: (v: string | null) => v ? wallClock(v) : "" },
          {
            title: "",
            render: (_: unknown, job) => (
              <span>
                {job.file_available && <a href={`/api/logs/v1/exports/${job.id}/file`} download={job.file_name}>{t("下載")}</a>}
                {job.status === "done" && (
                  <Button size="small" type="link" onClick={() => { setRenaming(job); setName(job.name); }}>{t("重新命名")}</Button>
                )}
              </span>
            ),
          },
        ]}
      />
      <Modal open={renaming !== null} title={t("重新命名匯出檔")} okText={t("儲存")} cancelText={t("取消")} onOk={() => void rename()} onCancel={() => setRenaming(null)}>
        <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onPressEnter={() => void rename()} />
        <p className={styles.sub}>{t("副檔名會自動加上。")}</p>
      </Modal>
    </div>
  );
}
