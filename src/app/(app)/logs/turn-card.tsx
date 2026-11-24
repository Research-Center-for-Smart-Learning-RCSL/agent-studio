"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { agentWhere, durationText, hasMedia, wallClock } from "@/lib/logs-format";
import type { Turn } from "@/lib/logs-types";
import { TurnExtras } from "./curation";
import { MediaList, MessageText, RuntimeTag, StatusTag, Uploads } from "./logs-ui";
import styles from "./logs.module.css";

export const conversationHref = (id: string, turn?: string) =>
  `/logs/conversations/${encodeURIComponent(id)}${turn ? `?turn=${encodeURIComponent(turn)}` : ""}`;

/** One exchange: what the user said, then the reply. */
export function TurnCard({ turn, highlight = false, query = "", showConversation = false }: { turn: Turn; highlight?: boolean; query?: string; showConversation?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[] | null>(null);
  // A robot turn's media are the attachments the tablet sent; any other turn's came with the reply.
  const fromUser = turn.endpoint === "robot";
  const userMedia = fromUser ? turn.media : null;
  const replyMedia = fromUser ? null : turn.media;
  return (
    <article className={`${styles.turn}${highlight ? ` ${styles.highlight}` : ""}`} id={`turn-${turn.id}`}>
      <header className={styles.meta}>
        <time dateTime={turn.started_at}>{wallClock(turn.started_at)}</time>
        {turn.conversation_seq != null && <span>{t("第 {0} / {1} 則", [turn.conversation_seq, turn.conversation_turns])}</span>}
        <StatusTag status={turn.status} />
        {turn.latency_ms != null && <span>{durationText(turn.latency_ms)}</span>}
        <RuntimeTag endpoint={turn.endpoint} robotSerial={turn.robot_serial} robotName={turn.robot_name} />
        {turn.agent && <span title={agentWhere(turn)}>{turn.agent}</span>}
        {(tags ?? turn.tags).map((tag) => <Tag key={tag}>{tag}</Tag>)}
        {showConversation && turn.conversation && (
          <span className={styles.push}><Link className={styles.open} href={conversationHref(turn.conversation, turn.id)}>{t("在對話中查看")}<span aria-hidden="true"> ›</span></Link></span>
        )}
      </header>
      {(turn.input_text != null || turn.attachments.length > 0 || hasMedia(userMedia)) && (
        <div className={`${styles.bubble} ${styles.user}`}>
          <span className={styles.who}>{t("使用者")}</span>
          {turn.input_text != null && <MessageText text={turn.input_text} query={query} />}
          <Uploads attachments={turn.attachments} />
          <MediaList media={userMedia} />
        </div>
      )}
      {(turn.output_text != null || hasMedia(replyMedia) || turn.control_labels.length > 0) && (
        <div className={`${styles.bubble} ${styles.assistant}`}>
          <span className={styles.who}>
            {t("助理")}
            {turn.ended_at && <time className={styles.muted}> {wallClock(turn.ended_at)}</time>}
          </span>
          {turn.output_text != null && <MessageText text={turn.output_text} query={query} />}
          <MediaList media={replyMedia} />
          {turn.control_labels.length > 0 && (
            <div title={t("回覆帶有的控制標籤（例如 TTS OFF），傳送端會把它們從文字中移除")}>
              {turn.control_labels.map((label, i) => <Tag key={i}>[{label}]</Tag>)}
            </div>
          )}
        </div>
      )}
      {turn.error_text && <p className={styles.error}>{turn.error_text}</p>}
      <Button size="small" type="link" onClick={() => setOpen((v) => !v)}>{open ? t("收合標註與錄音") : t("標註與錄音")}</Button>
      {open && <TurnExtras turnId={turn.id} onTags={setTags} />}
    </article>
  );
}
