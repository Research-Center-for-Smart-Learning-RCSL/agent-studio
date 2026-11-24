"use client";
import { useState, type ReactNode } from "react";
import { Alert, Button, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import {
  SAFE_IMAGE_TYPES, attachmentUrl, bareType, byteSize, entriesOf, hasMedia, highlightParts, imageOf, inlineImageSrc, isHttpUrl,
  searchTerms, textSegments,
} from "@/lib/logs-format";
import type { Attachment } from "@/lib/logs-types";
import { LogsError } from "./logs-client";
import styles from "./logs.module.css";

export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query);
  if (terms.length === 0) return <>{text}</>;
  return <>{highlightParts(text, terms).map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : part.text)}</>;
}

export function ErrorNote({ error, onRetry }: { error: LogsError; onRetry?: () => void }) {
  const { t, error: translate } = useI18n();
  return (
    <Alert
      type="error"
      showIcon
      title={error.status === 400 || error.status === 422 ? t("搜尋條件有誤：{0}", [translate(error.message)]) : t("無法載入：{0}", [translate(error.message)])}
      action={onRetry ? <Button size="small" onClick={onRetry}>{t("重試")}</Button> : undefined}
    />
  );
}

export function LoadMore({ hasMore, loading, onMore, count, unit }: { hasMore: boolean; loading: boolean; onMore: () => void; count: number; unit: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.listFooter}>
      {hasMore
        ? <Button loading={loading} onClick={onMore}>{t("載入更多（已載入 {0} {1}）", [count, unit])}</Button>
        : count > 0 && <span className={styles.muted}>{t("已載入全部 {0} {1}", [count, unit])}</span>}
    </div>
  );
}

export function SearchSyntaxHelp() {
  const { t } = useI18n();
  const rows: [string, string][] = [
    ["紅茶 AND 去冰", t("兩個詞都要出現（詞與詞之間空一格也是 AND）")],
    ["紅茶 OR 奶茶", t("任一個詞出現即可")],
    ["紅茶 NOT 熱", t("有前者、沒有後者；也可寫成「紅茶 -熱」")],
    ["(紅茶 OR 奶茶) AND 去冰", t("用括號決定先算哪一部分")],
    ["\"珍珠奶茶\"", t("用雙引號找完整片語")],
    ["珍*", t("找以「珍」開頭的詞")],
  ];
  return (
    <details className={styles.syntax}>
      <summary>{t("搜尋語法")}</summary>
      <table>
        <tbody>
          {rows.map(([example, meaning]) => <tr key={example}><td><code>{example}</code></td><td>{meaning}</td></tr>)}
        </tbody>
      </table>
      <p className={styles.muted}>{t("AND、OR、NOT 要用大寫；優先順序為 NOT、AND、OR。條件以單則訊息為單位比對；全形括號與引號也可以用。")}</p>
    </details>
  );
}

export function RuntimeTag({ endpoint, robotSerial, robotName }: { endpoint: string | null; robotSerial: string | null; robotName: string | null }) {
  const { t } = useI18n();
  if (!endpoint) return null;
  const robot = endpoint === "robot";
  const who = robotName ?? robotSerial;
  return (
    <span>
      <Tag color={robot ? "blue" : "default"} variant="filled">{robot ? t("機器人") : t("網頁")}</Tag>
      {who && !who.startsWith("temp-") && <span className={styles.muted} title={robotSerial ?? undefined}>{who}</span>}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "ok") return <Tag color="green" variant="filled">{t("成功")}</Tag>;
  if (status === "failed") return <Tag color="red" variant="filled">{t("失敗")}</Tag>;
  return <Tag color="orange" variant="filled">{t("無回應")}</Tag>;
}

/** A recorded image, shown from the archive's copy; a link to its original when no copy exists. */
export function InlineImage({ src, original, alt }: { src: string; original?: string; alt?: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return original
      ? <span><a href={original} target="_blank" rel="noopener noreferrer">{alt || original}</a> <span className={styles.muted}>{t("沒有保存副本，連結指向原始位置")}</span></span>
      : <span className={styles.muted}>{t("圖片無法顯示")}{alt ? `：${alt}` : ""}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- the archive's own copy, served through the proxy
  const img = <img className={styles.image} src={src} alt={alt || t("圖片")} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return src.startsWith("data:") ? img : <a href={src} target="_blank" rel="noopener noreferrer">{img}</a>;
}

/** Message text as written, except Markdown images, which are embedded from the archive's copies. */
export function MessageText({ text, query = "" }: { text: string; query?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const long = text.length > 800 && !open;
  const shown = long ? text.slice(0, 500) : text;
  return (
    <div>
      <p className={styles.text}>
        {textSegments(shown).map((segment, i) => {
          if (typeof segment === "string") return <Highlight key={i} text={segment} query={query} />;
          const source = inlineImageSrc(segment.url);
          if (source) return <InlineImage key={i} {...source} alt={segment.alt} />;
          return isHttpUrl(segment.url)
            ? <a key={i} href={segment.url} target="_blank" rel="noopener noreferrer">{segment.alt || segment.url}</a>
            : <span key={i}>{segment.raw}</span>;
        })}
        {long && "…"}
      </p>
      {long && <Button type="link" size="small" onClick={() => setOpen(true)}>{t("顯示完整訊息（{0} 字）", [text.length])}</Button>}
    </div>
  );
}

const textOf = (value: unknown): string | undefined => typeof value === "string" && value !== "" ? value : undefined;

function MediaItem({ id, item }: { id: string | null; item: unknown }) {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    const url = isHttpUrl(item) ? item : null;
    return <span>{id && <code>{id} </code>}{url ? <a href={url} target="_blank" rel="noopener noreferrer">{url}</a> : <code>{String(item).slice(0, 200)}</code>}</span>;
  }
  const o = item as Record<string, unknown>;
  const name = ["filename", "file_name", "name", "title"].map((k) => textOf(o[k])).find(Boolean) ?? id;
  const type = ["mime_type", "media_type", "content_type", "type"].map((k) => textOf(o[k])).find(Boolean);
  const size = ["bytes", "size"].map((k) => o[k]).find((v): v is number => typeof v === "number" && v >= 0);
  const url = ["url", "image_url", "href"].map((k) => o[k]).find(isHttpUrl);
  const details = [type, size === undefined ? undefined : byteSize(size)].filter(Boolean).join(" · ");
  return (
    <span>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{name ?? url}</a> : name && <code>{name}</code>}
      {details && <span className={styles.muted}> {details}</span>}
    </span>
  );
}

/** Recorded media groups (images, files, videos, audios) of a turn. */
export function MediaList({ media }: { media: Record<string, unknown> | null }) {
  const { t } = useI18n();
  if (!hasMedia(media)) return null;
  const labels: Record<string, string> = { images: t("圖片"), files: t("檔案"), videos: t("影片"), audios: t("音訊") };
  return (
    <div className={styles.media}>
      {Object.entries(media).map(([kind, group]) => {
        const entries = entriesOf(group);
        if (entries.length === 0) return null;
        return (
          <div key={kind}>
            <span className={styles.muted}>{labels[kind] ?? kind}</span>
            {(kind === "videos" || kind === "audios") && <span className={styles.sub}>{t("影片與音訊是外部串流網址，保存期間很短，之後可能無法播放。")}</span>}
            <ul>
              {entries.map(([key, item], i) => {
                const source = kind === "images" ? inlineImageSrc(imageOf(item)) : null;
                return <li key={key ?? i}>{source ? <InlineImage {...source} /> : <MediaItem id={key} item={item} />}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Files uploaded with the request: images inline, anything else as a download. */
export function Uploads({ attachments }: { attachments: Attachment[] }) {
  const { t } = useI18n();
  if (attachments.length === 0) return null;
  return (
    <div className={styles.media}>
      <span className={styles.muted}>{t("上傳的檔案")}</span>
      <ul>
        {attachments.map((a) => {
          const url = attachmentUrl(a.sha256);
          const name = a.filename ?? a.sha256.slice(0, 12);
          return (
            <li key={a.sha256}>
              {SAFE_IMAGE_TYPES.has(bareType(a.media_type)) ? <InlineImage src={url} alt={name} /> : <a href={url} download={name}>{name}</a>}
              <span className={styles.sub}>{a.media_type ?? t("類型不明")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}
