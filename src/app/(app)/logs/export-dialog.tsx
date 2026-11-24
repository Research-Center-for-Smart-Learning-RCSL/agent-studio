"use client";
import { useState } from "react";
import Link from "next/link";
import { App, Checkbox, Modal, Radio } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { LogsError, logsSend, useLogsScope } from "./logs-client";
import styles from "./logs.module.css";

type Format = "xlsx" | "jsonl" | "parquet" | "pdf";

/**
 * Asks for an export of the turns a filter matches, or of chosen conversations
 * (the only input a PDF takes). The file is made in the background and is
 * found on the exports page.
 */
export function ExportDialog({ open, onClose, filter, conversations }: {
  open: boolean;
  onClose: () => void;
  filter?: Record<string, unknown>;
  conversations?: string[];
}) {
  const { t, locale } = useI18n();
  const { message } = App.useApp();
  const { scope } = useLogsScope();
  const [format, setFormat] = useState<Format>("xlsx");
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = conversations !== undefined;
  const formats: Format[] = chosen ? ["xlsx", "jsonl", "parquet", "pdf"] : ["xlsx", "jsonl", "parquet"];

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        format: formats.includes(format) ? format : "xlsx",
        filter: chosen ? { conversations } : Object.fromEntries(Object.entries(filter ?? {}).filter(([, v]) => v !== undefined)),
        include_notes: notes,
        language: locale === "zh-Hant" ? "zh-TW" : "en",
        // One conversation is named after its title.
        name_from_title: chosen && conversations.length === 1,
      };
      await logsSend("POST", "/v1/exports", body, scope);
      void message.success(
        <span>{t("已排入匯出。")} <Link href="/logs/exports">{t("到匯出頁下載")}</Link></span>,
      );
      onClose();
    } catch (error) {
      const failure = error instanceof LogsError ? error : new LogsError(0, String(error));
      void message.error(failure.status === 429 ? t("同時進行的匯出太多，請稍後再試") : failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={t("匯出")} okText={t("開始匯出")} cancelText={t("取消")} confirmLoading={busy} onOk={() => void submit()} onCancel={onClose}>
      <p className={styles.muted}>
        {chosen ? t("匯出所選的 {0} 個對話，每個對話完整、由舊到新。", [conversations.length]) : t("匯出目前篩選條件下的回合（最新的優先，數量有上限）。")}
      </p>
      <Radio.Group value={format} onChange={(e) => setFormat(e.target.value as Format)}>
        {formats.map((f) => <Radio.Button key={f} value={f}>{f === "xlsx" ? "Excel" : f === "jsonl" ? "JSONL" : f === "parquet" ? "Parquet" : "PDF"}</Radio.Button>)}
      </Radio.Group>
      <div style={{ marginBlockStart: 12 }}>
        <Checkbox checked={notes} onChange={(e) => setNotes(e.target.checked)}>{t("包含我自己的筆記")}</Checkbox>
      </div>
    </Modal>
  );
}
