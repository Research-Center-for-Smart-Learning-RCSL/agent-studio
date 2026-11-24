"use client";
import { useState } from "react";
import { App, Badge, Button, Drawer, Empty, Form, Input, Modal, Select, Spin, Table, Tag } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { wallClock } from "@/lib/logs-format";
import type { Page } from "@/lib/logs-types";
import { LogsError, logsSend, useLogsResource, useLogsScope, usePagedLogs } from "./logs-client";
import { ErrorNote, LoadMore } from "./logs-ui";
import styles from "./logs.module.css";

type Report = {
  id: string; category: string; title: string; status: string; alias: string; replies: number; created_at: string;
  last_message_at: string; archived_at: string | null; version?: number; pending?: boolean; creator?: { name: string | null; is_guest: boolean };
};
type Message = { id: number; alias: string; by_admin: boolean; body: string; created_at: string; author?: { name: string | null; is_guest: boolean } };

const categories = ["bug", "question", "suggestion", "other"] as const;

export function FeedbackView({ isAdmin }: { isAdmin: boolean }) {
  const { t, error: translate } = useI18n();
  const { message } = App.useApp();
  const { scope } = useLogsScope();
  const base = isAdmin ? "/v1/admin/feedback" : "/v1/feedback";
  const [status, setStatus] = useState<string>("open");
  const [category, setCategory] = useState<string>("");
  const [q, setQ] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Report | null>(null);
  const [form] = Form.useForm<{ category: string; title: string; body: string; alias: string }>();
  const categoryName: Record<string, string> = { bug: t("問題"), question: t("疑問"), suggestion: t("建議"), other: t("其他") };
  const list = usePagedLogs<Report>(base, { status, category, q: q.trim(), pending: isAdmin && pendingOnly ? true : undefined, limit: 50 });

  const create = async () => {
    const values = await form.validateFields();
    try {
      await logsSend("POST", "/v1/feedback", { ...values, request_id: crypto.randomUUID() }, scope);
      setCreating(false);
      form.resetFields();
      list.reload();
    } catch (e) {
      void message.error(e instanceof LogsError ? translate(e.message) : String(e));
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.filters}>
        <Button type="primary" onClick={() => setCreating(true)}>{t("新增意見")}</Button>
        <Select style={{ width: 120 }} value={status} onChange={setStatus} options={[{ value: "open", label: t("進行中") }, { value: "archived", label: t("已封存") }]} />
        <Select style={{ width: 120 }} allowClear placeholder={t("類別")} value={category || undefined} onChange={(v) => setCategory(v ?? "")} options={categories.map((c) => ({ value: c, label: categoryName[c] }))} />
        <Input.Search className={styles.search} allowClear placeholder={t("搜尋標題或內容")} onSearch={setQ} />
        {isAdmin && <Button type={pendingOnly ? "primary" : "default"} onClick={() => setPendingOnly((v) => !v)}>{t("只看待回覆")}</Button>}
      </div>
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {list.loading && <Spin />}
      {!list.loading && !list.error && list.items.length === 0 && <Empty description={t("沒有意見")} />}
      {list.items.length > 0 && (
        <>
          <Table<Report>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={list.items}
            scroll={{ x: "max-content" }}
            onRow={(row) => ({ onClick: () => setOpen(row), style: { cursor: "pointer" } })}
            columns={[
              {
                title: t("標題"),
                render: (_: unknown, row) => <span>{row.pending && <Badge status="warning" />} {row.title}<span className={styles.sub}>{row.alias}{row.creator?.name ? ` (${row.creator.name})` : ""}</span></span>,
              },
              { title: t("類別"), dataIndex: "category", render: (v: string) => <Tag>{categoryName[v] ?? v}</Tag> },
              { title: t("回覆"), dataIndex: "replies" },
              { title: t("最後更新"), dataIndex: "last_message_at", render: (v: string) => wallClock(v) },
            ]}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} count={list.items.length} unit={t("則意見")} />
        </>
      )}
      <Modal open={creating} title={t("新增意見")} okText={t("送出")} cancelText={t("取消")} onOk={() => void create()} onCancel={() => setCreating(false)}>
        <Form form={form} layout="vertical" initialValues={{ category: "suggestion" }}>
          <Form.Item name="category" label={t("類別")} rules={[{ required: true }]}>
            <Select options={categories.map((c) => ({ value: c, label: categoryName[c] }))} />
          </Form.Item>
          <Form.Item name="alias" label={t("顯示名稱")} extra={t("意見板上會顯示這個名稱，不會顯示你的信箱。")} rules={[{ required: true, max: 40 }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="title" label={t("標題")} rules={[{ required: true, max: 160 }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="body" label={t("內容")} rules={[{ required: true, max: 10000 }]}>
            <Input.TextArea rows={5} maxLength={10000} />
          </Form.Item>
        </Form>
      </Modal>
      <Thread report={open} base={base} isAdmin={isAdmin} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); list.reload(); }} />
    </div>
  );
}

function Thread({ report, base, isAdmin, onClose, onChanged }: { report: Report | null; base: string; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, error: translate } = useI18n();
  const { message } = App.useApp();
  const { scope } = useLogsScope();
  const messages = useLogsResource<Page<Message>>(report ? `${base}/${report.id}/messages` : null, { limit: 200 });
  const [body, setBody] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => void message.error(e instanceof LogsError ? translate(e.message) : String(e));

  const reply = async () => {
    if (!report || !body.trim() || !alias.trim()) return;
    setBusy(true);
    try {
      await logsSend("POST", `${base}/${report.id}/messages`, { body: body.trim(), alias: alias.trim(), request_id: crypto.randomUUID() }, scope);
      setBody("");
      messages.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!report) return;
    try {
      await logsSend("PATCH", `${base}/${report.id}`, { status: report.status === "open" ? "archived" : "open", version: report.version }, scope);
      onChanged();
    } catch (e) {
      fail(e);
    }
  };
  const remove = () => {
    if (!report) return;
    Modal.confirm({
      title: t("刪除這則意見？"),
      content: t("對話內容會一併刪除，無法復原。"),
      okText: t("刪除"),
      cancelText: t("取消"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await logsSend("DELETE", `${base}/${report.id}?expected_version=${report.version}`, undefined, scope);
          onChanged();
        } catch (e) {
          fail(e);
        }
      },
    });
  };
  return (
    <Drawer open={report !== null} onClose={onClose} size="large" title={report?.title}>
      {report && (
        <div className={styles.page}>
          {isAdmin && (
            <div className={styles.filters}>
              <Button onClick={() => void archive()}>{report.status === "open" ? t("封存") : t("重新開啟")}</Button>
              <Button danger onClick={remove}>{t("刪除")}</Button>
            </div>
          )}
          {messages.error && <ErrorNote error={messages.error} onRetry={messages.reload} />}
          {messages.loading && <Spin />}
          {messages.data?.items.map((m) => (
            <div key={m.id} className={`${styles.bubble} ${m.by_admin ? styles.assistant : styles.user}`}>
              <span className={styles.who}>{m.alias}{m.by_admin && ` · ${t("管理員")}`}{m.author?.name ? ` (${m.author.name})` : ""} <span className={styles.muted}>{wallClock(m.created_at)}</span></span>
              <p className={styles.text}>{m.body}</p>
            </div>
          ))}
          {report.status === "open" && (
            <div className={styles.noteForm}>
              <Input style={{ width: 180 }} maxLength={40} value={alias} placeholder={t("顯示名稱")} onChange={(e) => setAlias(e.target.value)} />
              <Input.TextArea rows={3} maxLength={10000} value={body} placeholder={t("回覆")} onChange={(e) => setBody(e.target.value)} />
              <Button type="primary" loading={busy} disabled={!body.trim() || !alias.trim()} onClick={() => void reply()}>{t("送出")}</Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
