"use client";
import { useEffect, useState } from "react";
import { DeleteOutlined, EditOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Spin, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { recordingUrl, wallClock } from "@/lib/logs-format";
import type { Curation, Note, TitleConflict, TitleOut, TurnDetail } from "@/lib/logs-types";
import { LogsError, logsGet, logsSend, useLogsResource, useLogsScope } from "./logs-client";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";

const asError = (error: unknown) => (error instanceof LogsError ? error : new LogsError(0, String(error)));

function NoteList({ notes, onAdd, onDelete }: { notes: Note[]; onAdd: (text: string) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onAdd(text.trim());
      setText("");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div className={styles.who}>{t("筆記")}</div>
      {notes.length === 0 && <span className={styles.muted}>{t("還沒有筆記")}</span>}
      {notes.map((note) => (
        <div key={note.id} className={styles.note}>
          <span className={styles.text}>{note.text}</span>
          <span className={styles.sub}>{wallClock(note.created_at)}</span>
          <Button size="small" type="text" danger aria-label={t("刪除筆記")} icon={<DeleteOutlined />} onClick={() => void onDelete(note.id)} />
        </div>
      ))}
      <div className={styles.noteForm}>
        <Input.TextArea rows={2} maxLength={5000} value={text} placeholder={t("新增筆記")} onChange={(e) => setText(e.target.value)} />
        <Button loading={saving} disabled={!text.trim()} onClick={() => void add()}>{t("新增")}</Button>
      </div>
    </div>
  );
}

/** What a reader can add to one turn, and the recordings and ids behind it; read only once opened. */
export function TurnExtras({ turnId, onTags }: { turnId: string; onTags: (tags: string[]) => void }) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const { scope } = useLogsScope();
  const base = `/v1/turns/${encodeURIComponent(turnId)}`;
  const detailQuery = useLogsResource<TurnDetail>(base);
  const curationQuery = useLogsResource<Curation>(`${base}/curation`);
  const [tag, setTag] = useState("");
  const error = detailQuery.error ?? curationQuery.error;
  const state = detailQuery.data && curationQuery.data ? { detail: detailQuery.data, curation: curationQuery.data } : null;
  const load = async () => { detailQuery.reload(); curationQuery.reload(); };

  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await load();
    } catch (e) {
      void message.error(asError(e).message);
    }
  };
  const curation = state?.curation;
  useEffect(() => {
    if (curation) onTags(curation.tags.map((x) => x.name));
  }, [curation, onTags]);

  if (error) return <ErrorNote error={error} onRetry={() => void load()} />;
  if (!state) return <Spin size="small" />;
  const { detail } = state;
  return (
    <div className={styles.extras}>
      <div>
        <Button
          size="small"
          icon={curation!.bookmarked ? <StarFilled /> : <StarOutlined />}
          onClick={() => void act(() => logsSend(curation!.bookmarked ? "DELETE" : "PUT", `${base}/bookmark`, undefined, scope))}
        >
          {curation!.bookmarked ? t("已加書籤") : t("加書籤")}
        </Button>
      </div>
      <div>
        <div className={styles.who}>{t("標籤")}</div>
        {curation!.tags.map((x) => (
          <Tag key={x.id} closable onClose={(e) => { e.preventDefault(); void act(() => logsSend("DELETE", `${base}/tags/${x.id}`, undefined, scope)); }}>{x.name}</Tag>
        ))}
        <Input
          size="small"
          style={{ width: 160 }}
          maxLength={100}
          value={tag}
          placeholder={t("新增標籤後按 Enter")}
          onChange={(e) => setTag(e.target.value)}
          onPressEnter={() => {
            const name = tag.trim();
            if (!name) return;
            setTag("");
            void act(() => logsSend("POST", `${base}/tags`, { name }, scope));
          }}
        />
      </div>
      <NoteList
        notes={curation!.notes}
        onAdd={(text) => act(() => logsSend("POST", `${base}/notes`, { text }, scope))}
        onDelete={(id) => act(() => logsSend("DELETE", `/v1/notes/${id}`, undefined, scope))}
      />
      {detail.recordings.length > 0 && (
        <div>
          <div className={styles.who}>{t("錄音")}</div>
          {detail.recordings.map((r) => (
            <div key={r.id}>
              <span className={styles.sub}>{wallClock(r.created_at)}</span>
              {r.audio_sha256
                ? <audio className={styles.audio} controls preload="none" src={recordingUrl(r.audio_sha256)} />
                : <span className={styles.muted}>{t("沒有保存音檔")}</span>}
              {r.transcript_final && <span className={styles.text}>{r.transcript_final}</span>}
            </div>
          ))}
        </div>
      )}
      <div className={styles.sub}>
        {t("回合編號")}：<code>{detail.id}</code>
        {detail.request_id && <> · {t("請求編號")}：<code>{detail.request_id}</code></>}
      </div>
    </div>
  );
}

/** The conversation's shared title: anyone may rename it, and a rename made on a stale title is refused, not overwritten. */
export function ConversationTitle({ id, fallback }: { id: string; fallback: string }) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const { scope, ready } = useLogsScope();
  const [title, setTitle] = useState<{ id: string; value: TitleOut } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const path = `/v1/conversations/${encodeURIComponent(id)}/title`;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    logsGet<TitleOut>(path, {}, scope, controller.signal).then((value) => setTitle({ id, value }), () => undefined);
    return () => controller.abort();
  }, [id, path, ready, scope]);

  const current = title?.id === id ? title.value : null;
  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/logs${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft.trim(), version: current.version }),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as TitleConflict;
        setTitle({ id, value: conflict.current });
        setDraft(conflict.current.title);
        void message.warning(t("標題剛被別人改過，已顯示最新的標題"));
        return;
      }
      if (!response.ok) throw new LogsError(response.status, response.statusText);
      setTitle({ id, value: (await response.json()) as TitleOut });
      setEditing(false);
    } catch (e) {
      void message.error(asError(e).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <h1>{current?.title || fallback}</h1>
      {current && (
        <Button size="small" icon={<EditOutlined />} aria-label={t("修改標題")} onClick={() => { setDraft(current.title); setEditing(true); }} />
      )}
      <Modal open={editing} title={t("修改對話標題")} okText={t("儲存")} cancelText={t("取消")} confirmLoading={saving} onOk={() => void save()} onCancel={() => setEditing(false)}>
        <Input value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} onPressEnter={() => void save()} />
        {current?.last_edit && (
          <p className={styles.sub}>{t("上次修改：{0}，{1}", [current.last_edit.editor ?? t("匿名"), wallClock(current.last_edit.edited_at)])}</p>
        )}
      </Modal>
    </>
  );
}

/** Notes on the whole conversation. */
export function ConversationNotes({ id }: { id: string }) {
  const { scope } = useLogsScope();
  const path = `/v1/conversations/${encodeURIComponent(id)}/notes`;
  const notes = useLogsResource<Note[]>(path);
  if (!notes.data) return null;
  return (
    <div className={styles.panel}>
      <NoteList
        notes={notes.data}
        onAdd={async (text) => { await logsSend("POST", path, { text }, scope); notes.reload(); }}
        onDelete={async (noteId) => { await logsSend("DELETE", `/v1/notes/${noteId}`, undefined, scope); notes.reload(); }}
      />
    </div>
  );
}
