"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n-client";
import {
  CONVERSATION_FORMATS, LIST_FORMATS, MAX_CONVERSATIONS, describeFilter, titleAsName, type ExportFormat,
} from "@/lib/logs-export";
import type { ExportJob, TitleOut } from "@/lib/logs-types";
import { LogsError, logsSend, useLogsResource, useLogsScope } from "./logs-client";
import { DockPanel } from "./action-dock";
import styles from "./logs.module.css";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: "PDF", xlsx: "Excel (.xlsx)", jsonl: "JSONL (含原始紀錄)", parquet: "Parquet (供資料分析)",
};

type Filter = Record<string, unknown>;

/** A format choice and a button that queues an export, then points to the exports page. */
function ExportControl({ label, formats, filter, disabled = false, badRequest, title = "", titlePending = false }: {
  label: string;
  formats: readonly ExportFormat[];
  /** The filter at the moment of the click. */
  filter: () => Filter;
  disabled?: boolean;
  /** What a refused (400) request means for this control's filter. */
  badRequest: string;
  /** The one exported conversation's title; when set, the file may be named by it. */
  title?: string;
  /** The title is still being read; the export waits, so the choice is never skipped unseen. */
  titlePending?: boolean;
}) {
  const { t, locale } = useI18n();
  const { scope } = useLogsScope();
  const [format, setFormat] = useState<ExportFormat>(formats[0] ?? "xlsx");
  const [includeNotes, setIncludeNotes] = useState(true);
  // Someone chose the title, so it is the likelier name; the usual one is a click away.
  const [byTitle, setByTitle] = useState(true);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; id: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const group = useId();
  // As the server will name the file; a title with nothing a file name can hold is not offered.
  const titleName = titleAsName(title, format);
  const nameFromTitle = titleName !== "" && byTitle;

  const submit = async () => {
    setState({ kind: "busy" });
    try {
      const job = await logsSend<ExportJob>("POST", "/v1/exports", {
        format,
        filter: filter(),
        include_notes: includeNotes,
        language: locale === "zh-Hant" ? "zh-TW" : "en",
        name_from_title: nameFromTitle,
      }, scope);
      setState({ kind: "done", id: job?.id ?? "" });
    } catch (error) {
      const failure = error instanceof LogsError ? error : new LogsError(0, String(error));
      setState({
        kind: "error",
        message: failure.status === 429 ? t("已有 2 個匯出正在進行，請等它們完成再試。")
          : failure.status === 400 || failure.status === 422 ? badRequest
          : t("暫時無法取得資料，請稍後再試。"),
      });
    }
  };

  return (
    <div className={styles.exportBar}>
      <select aria-label={t("格式")} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
        {formats.map((f) => <option key={f} value={f}>{t(FORMAT_LABELS[f])}</option>)}
      </select>
      {/* Notes are private, and a file is easy to forward, so the choice says whose notes go in. */}
      <label title={t("只包含你自己在逐輪紀錄與對話上寫的筆記；筆記是私人的，其他人的筆記不會出現在檔案裡。")}>
        <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
        {t("附上我的筆記（只含我自己寫的）")}
      </label>
      {titleName !== "" && (
        <fieldset className={styles.nameBy}>
          <legend>{t("檔名")}</legend>
          <label>
            <input type="radio" name={group} checked={byTitle} onChange={() => setByTitle(true)} />
            {t("對話標題「{0}」", [titleName])}
          </label>
          <label>
            <input type="radio" name={group} checked={!byTitle} onChange={() => setByTitle(false)} />
            {t("系統預設")}
          </label>
        </fieldset>
      )}
      <button type="button" className={styles.exportButton} disabled={disabled || titlePending || state.kind === "busy"} onClick={() => void submit()}>
        {label}
      </button>
      {state.kind === "done" && (
        <span role="status" className={styles.muted}>
          {t("已加入匯出佇列。")} <Link href={`/logs/exports${state.id ? `?task=${encodeURIComponent(state.id)}` : ""}`}>{t("查看匯出")}</Link>
        </span>
      )}
      {state.kind === "error" && <span role="alert" className={styles.failed}>{state.message}</span>}
    </div>
  );
}

/** The turn list as currently filtered, with what the click exports said in words. */
export function ListExport({ filter, robotName }: { filter: Filter; robotName: (serial: string) => string }) {
  const { t } = useI18n();
  const exported = { ...filter, bookmarked: filter.bookmarked ?? false };
  const scope = describeFilter(exported, t, robotName);
  return (
    <div className={styles.exportScope}>
      <ExportControl label={t("匯出目前的搜尋結果")} formats={LIST_FORMATS} filter={() => exported} badRequest={t("搜尋條件有誤，請檢查後再試。")} />
      {/* What the click exports: the applied search, every match, not just the loaded rows. */}
      <span className={styles.muted}>{t("匯出範圍：{0}。會匯出所有符合的紀錄，不只畫面上已載入的；最多 10 萬筆。", [scope || t("全部紀錄")])}</span>
    </div>
  );
}

/**
 * Queues an export of these conversations, each whole and oldest first. `titleOf` gives a title the
 * caller already holds; one it does not hold is read here.
 */
export function ConversationExport({ conversations, titleOf }: { conversations: string[]; titleOf?: (id: string) => string | undefined }) {
  const { t } = useI18n();
  const tooMany = conversations.length > MAX_CONVERSATIONS;
  // Only one conversation has a single title to name the file by.
  const only = conversations.length === 1 ? conversations[0] ?? null : null;
  const held = only === null ? undefined : titleOf?.(only);
  const read = useLogsResource<TitleOut>(only !== null && held === undefined ? `/v1/conversations/${encodeURIComponent(only)}/title` : null);
  const title = held ?? read.data?.title ?? "";
  return (
    <>
      <ExportControl
        label={conversations.length === 1 ? t("匯出這段對話") : t("匯出 {0} 段對話", [conversations.length])}
        formats={CONVERSATION_FORMATS}
        filter={() => ({ conversations, bookmarked: false })}
        disabled={conversations.length === 0 || tooMany}
        badRequest={t("這個匯出的條件有誤，請重新選擇對話。")}
        title={title}
        titlePending={only !== null && held === undefined && read.loading}
      />
      {tooMany && <p role="alert" className={styles.failed}>{t("一次最多匯出 {0} 段對話。", [MAX_CONVERSATIONS])}</p>}
    </>
  );
}

/** A record dock's export action for one conversation. */
export function ConversationExportPanel({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  return (
    <DockPanel label={t("匯出")} title={t("匯出這段對話")}>
      <ConversationExport conversations={[conversationId]} />
    </DockPanel>
  );
}

/** The name a robot goes by, for words that say what a filter holds; a serial with no name stands for itself. */
export function useRobotLabel(): (serial: string) => string {
  const robots = useLogsResource<{ items: { serial: string; name: string | null }[] }>("/v1/robots");
  const names = new Map((robots.data?.items ?? []).map((r) => [r.serial, r.name ?? r.serial]));
  return (serial) => names.get(serial) ?? serial;
}
