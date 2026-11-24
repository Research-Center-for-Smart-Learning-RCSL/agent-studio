"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Empty, Spin } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { describeFilter } from "@/lib/logs-export";
import { byteSize, wallClock } from "@/lib/logs-format";
import type { ExportJob } from "@/lib/logs-types";
import { LogsError, logsSend, useLogsResource, useLogsScope } from "./logs-client";
import { useRobotLabel } from "./export-control";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";

const FORMATS: Record<string, string> = { pdf: "PDF", xlsx: "Excel (.xlsx)", jsonl: "JSONL (含原始紀錄)", parquet: "Parquet (供資料分析)" };

/** The name the download is saved under, which its owner can change freely; only the extension stays. */
function FileName({ job, onRenamed }: { job: ExportJob; onRenamed: () => void }) {
  const { t } = useI18n();
  const { scope } = useLogsScope();
  const [draft, setDraft] = useState<string | null>(null);
  const [adjusted, setAdjusted] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "empty" | "failed">("idle");
  // file_name is the name followed by the extension, which the owner cannot change.
  const fixed = job.file_name.slice(job.name.length);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || draft.trim() === job.name) return setDraft(null);
    setState("saving");
    try {
      const renamed = await logsSend<ExportJob>("PATCH", `/v1/exports/${encodeURIComponent(job.id)}`, { name: draft.trim() }, scope);
      setAdjusted(renamed !== null && renamed.name !== draft.trim());
      setDraft(null);
      setState("idle");
      onRenamed();
    } catch (error) {
      setState(error instanceof LogsError && (error.status === 400 || error.status === 422) ? "empty" : "failed");
    }
  };

  if (draft === null) {
    return (
      <div className={styles.fileName}>
        <span>{job.file_name}</span>
        <a onClick={() => { setState("idle"); setAdjusted(false); setDraft(job.name); }}>{t("重新命名")}</a>
        {adjusted && <span role="status" className={styles.sub}>{t("檔名已調整為可用的名稱：可能替換了不能使用的字元或句點、移除了重複的副檔名，或截短了過長的部分。")}</span>}
      </div>
    );
  }
  return (
    <form className={styles.fileName} onSubmit={(e) => void save(e)}>
      <input aria-label={t("檔名")} value={draft} maxLength={150} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }} />
      <span className={styles.muted}>{fixed}</span>
      <button type="submit" disabled={state === "saving" || draft.trim() === ""}>{t("儲存檔名")}</button>
      <a onClick={() => setDraft(null)}>{t("取消")}</a>
      {(state === "empty" || state === "failed") && (
        <span role="alert" className={`${styles.failed} ${styles.sub}`}>
          {state === "empty" ? t("移除不能用於檔名的字元後，檔名是空的，請換一個名稱。") : t("暫時無法取得資料，請稍後再試。")}
        </span>
      )}
    </form>
  );
}

function Row({ job, robotName, onChanged }: { job: ExportJob; robotName: (serial: string) => string; onChanged: () => void }) {
  const { t } = useI18n();
  const { scope } = useLogsScope();
  const [retry, setRetry] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const filter = describeFilter(job.filter, t, robotName);
  const statuses: Record<string, string> = { queued: t("排隊中"), running: t("產生中"), done: t("完成"), failed: t("失敗") };

  const requestAgain = async () => {
    setRetry("busy");
    try {
      await logsSend("POST", "/v1/exports", {
        format: job.format, filter: job.filter, include_notes: job.include_notes, language: job.language, name_from_title: job.name_from_title,
      }, scope);
      setRetry("done");
      onChanged();
    } catch {
      setRetry("failed");
    }
  };

  return (
    <tr id={`export-${job.id}`}>
      <td>{wallClock(job.created_at)}</td>
      <td>{FORMATS[job.format] ? t(FORMATS[job.format]!) : job.format}</td>
      <td className={styles.exportFilter}>
        {filter || t("全部紀錄")}
        {/* The choice, not the contents: a file with no notes of the requester's is not marked as holding them. */}
        {job.include_notes && (
          <span className={styles.sub} title={t("檔名只在檔案裡真的有你的筆記時才標上「含筆記」；但除了 PDF，勾選此項的檔案一律會在筆記欄位寫上你的帳號名稱，轉寄前請留意。")}>
            {t("已勾選附上筆記")}
          </span>
        )}
      </td>
      <td>
        {statuses[job.status] ?? job.status}
        {job.status === "failed" && job.error && <span className={styles.muted}> ({job.error})</span>}
      </td>
      <td>
        {job.rows.toLocaleString("en-US")}
        {job.truncated && <strong className={styles.failed}> {t("(已達上限，後面的未匯出)")}</strong>}
      </td>
      <td>{byteSize(job.byte_size)}</td>
      <td>
        {job.status === "done" && job.file_available && (
          <>
            <FileName job={job} onRenamed={onChanged} />
            <a href={`/api/logs/v1/exports/${encodeURIComponent(job.id)}/file`} download>{t("下載")}</a>
          </>
        )}
        {job.status === "done" && job.expires_at && <span className={styles.sub}>{t("可下載至 {0}（台北時間）", [wallClock(job.expires_at)])}</span>}
        {job.status === "done" && !job.file_available && <span className={styles.failed}>{t("檔案已失效或無法取得。")}</span>}
        {(job.status === "failed" || (job.status === "done" && !job.file_available)) && (
          <button type="button" disabled={retry === "busy"} onClick={() => void requestAgain()}>{t("以相同條件重新匯出")}</button>
        )}
        {retry === "done" && <span role="status" className={styles.sub}>{t("已加入匯出佇列。")}</span>}
        {retry === "failed" && <span role="alert" className={`${styles.failed} ${styles.sub}`}>{t("暫時無法取得資料，請稍後再試。")}</span>}
      </td>
    </tr>
  );
}

export function ExportsView() {
  const { t } = useI18n();
  const jobs = useLogsResource<ExportJob[]>("/v1/exports");
  const robotName = useRobotLabel();
  const target = useSearchParams().get("task");
  const pending = jobs.data?.some((job) => job.status === "queued" || job.status === "running") ?? false;
  const reload = jobs.reload;

  // A queued or running export is checked again every few seconds until it finishes.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [pending, reload]);

  useEffect(() => {
    if (target && jobs.data?.some((job) => job.id === target)) document.getElementById(`export-${target}`)?.scrollIntoView?.({ block: "center" });
  }, [target, jobs.data]);

  if (jobs.error && !jobs.data) return <ErrorNote error={jobs.error} onRetry={reload} />;
  if (jobs.loading || !jobs.data) return <Spin />;
  return (
    <div className={styles.page}>
      <p className={styles.muted}>{t("匯出在背景產生，完成後可在這裡下載。檔案保留 24 小時；一次最多 10 萬筆，PDF 最多 2,000 筆。勾選「附上我的筆記」的檔案只含你自己寫的筆記，不含任何其他人的，轉寄檔案前請留意。")}</p>
      {jobs.data.length === 0 ? (
        <Empty description={t("還沒有任何匯出。可在逐輪紀錄或對話頁建立匯出。")}>
          <Link href="/logs/turns">{t("前往逐輪紀錄")}</Link> <Link href="/logs">{t("前往對話列表")}</Link>
        </Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.plain}>
            <thead>
              <tr>
                <th>{t("建立時間")}</th><th>{t("格式")}</th><th>{t("條件")}</th><th>{t("狀態")}</th><th>{t("筆數")}</th><th>{t("大小")}</th><th />
              </tr>
            </thead>
            <tbody>{jobs.data.map((job) => <Row key={job.id} job={job} robotName={robotName} onChanged={reload} />)}</tbody>
          </table>
        </div>
      )}
      {target && !jobs.data.some((job) => job.id === target) && <p role="status">{t("找不到指定的匯出，可能已超過保留期限。")}</p>}
    </div>
  );
}
