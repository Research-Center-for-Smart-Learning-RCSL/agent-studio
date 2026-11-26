"use client";
import { useI18n } from "@/lib/i18n-client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, Input, Popconfirm, Radio, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { SecretGrant } from "@/db/schema";
import styles from "./admin-panel.module.css";
import { DirectoryRobot } from "../directory-robot";
import {
  addMembershipAction,
  deleteSecretAction,
  deleteUserAction,
  removeMembershipAction,
  setAdminAction,
  setSecretAction,
  setSecretGrantAction,
  syncRcslAction,
  type ActionResult,
} from "../../actions";

type Props = {
  me: string;
  /** Admins see and change everything; an organization manager only their organizations'. */
  isAdmin: boolean;
  managedOrgIds: string[];
  users: { email: string; name: string | null; isAdmin: boolean; lastSeenAt: string | null }[];
  memberships: { id: number; userEmail: string; organizationId: string | null; projectId: string | null; role: "viewer" | "editor" | "manager" }[];
  organizations: { id: string; name: string; active: boolean }[];
  projects: { id: string; name: string; organizationId: string; active: boolean }[];
  secrets: { name: string; description: string; organizationId: string | null; grants: SecretGrant[]; updatedBy: string | null; updatedAt: string }[];
  audit: { id: number; actor: string | null; action: string; targetType: string; targetId: string; detail: unknown; createdAt: string }[];
  mcpWithoutSecret: { id: string; name: string; servers: string[] }[];
  unapprovedReferences: { id: string; name: string; projectId: string; serverUrl: string | null; field: string; secret: string }[];
};

const time = (value: string | null, locale: string) => (value ? new Date(value).toLocaleString(locale === "zh-Hant" ? "zh-TW" : locale, { hour12: false, timeZone: "Asia/Taipei" }) : "-");

export function AdminPanel(props: Props) {
  const { t } = useI18n();
  return (
    <App className={styles.page}>
      <div className={styles.masthead}>
        <h1 className={styles.title}>{t("管理")}</h1>
        <DirectoryRobot variant="admin" />
      </div>
      <Tabs
        size="small"
        tabBarGutter={16}
        items={[
          { key: "members", label: t("成員與權限"), children: <Members {...props} /> },
          { key: "secrets", label: t("憑證"), children: <Secrets {...props} /> },
          ...(props.isAdmin ? [{ key: "sync", label: t("RCSL 同步"), children: <Sync {...props} /> }] : []),
          { key: "audit", label: t("操作紀錄"), children: <Audit {...props} /> },
        ]}
      />
    </App>
  );
}

function useAction() {
  const { error } = useI18n();
  const router = useRouter();
  const { message } = App.useApp();
  return async <T,>(p: Promise<ActionResult<T>>, ok?: string) => {
    const r = await p;
    if (!r.ok) message.error(error(r.error));
    else {
      if (ok) message.success(ok);
      router.refresh();
    }
    return r;
  };
}

function Members(props: Props) {
  const { t, locale } = useI18n();
  const act = useAction();
  const [form] = Form.useForm<{ email: string; scope: "organization" | "project"; scopeId: string; role: "viewer" | "editor" | "manager" }>();
  const scope = Form.useWatch("scope", form) ?? "organization";
  const orgName = new Map(props.organizations.map((o) => [o.id, o.name]));
  const projectName = new Map(props.projects.map((p) => [p.id, `${orgName.get(p.organizationId)} / ${p.name}`]));

  return (
    <div className={styles.stack}>
      <Card size="small" title={t("授權")} className={styles.card}>
        <Form
          className={styles.form}
          form={form}
          layout="inline"
          size="small"
          initialValues={{ scope: "organization", role: "editor" }}
          onFinish={async (values) => {
            const r = await act(addMembershipAction(values), t("已授權"));
            if (r.ok) form.resetFields(["email", "scopeId"]);
          }}
        >
          <Form.Item name="email" className={styles.field} rules={[{ required: true, type: "email" }]}>
            <Input aria-label={t("Google 帳號 email")} placeholder={t("Google 帳號 email")} />
          </Form.Item>
          <Form.Item name="scope">
            <Radio.Group
              options={[
                { value: "organization", label: t("整個組織") },
                { value: "project", label: t("單一專案") },
              ]}
              onChange={() => { form.setFieldValue("scopeId", undefined); form.setFieldValue("role", "editor"); }}
            />
          </Form.Item>
          <Form.Item name="scopeId" className={styles.scope} rules={[{ required: true }]}>
            <Select
              aria-label={scope === "organization" ? t("選擇組織") : t("選擇專案")}
              popupMatchSelectWidth={480}
              classNames={{ popup: { root: "admin-scope-dropdown" } }}
              showSearch={{ optionFilterProp: "label" }}
              placeholder={scope === "organization" ? t("選擇組織") : t("選擇專案")}
              options={
                scope === "organization"
                  ? props.organizations.map((o) => ({ value: o.id, label: o.name }))
                  : props.projects.map((p) => ({ value: p.id, label: projectName.get(p.id) }))
              }
            />
          </Form.Item>
          <Form.Item name="role">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: "editor", label: t("可編輯") },
                { value: "viewer", label: t("只能檢視") },
                // Managing is over a whole organization, so it is offered only with that scope.
                ...(scope === "organization" ? [{ value: "manager", label: t("組織管理者") }] : []),
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("授權")}</Button>
        </Form>
      </Card>
      <Table
        scroll={{ x: 720 }}
        rowKey="email"
        size="small"
        dataSource={props.users}
        pagination={false}
        columns={[
          { title: t("帳號"), dataIndex: "email", render: (e: string, u) => <Space orientation="vertical" size={0}>{e}<Typography.Text type="secondary" style={{ fontSize: 12 }}>{u.name}</Typography.Text></Space> },
          {
            title: t("權限"),
            // Memberships wrap onto new lines: a person with many would otherwise stretch the table far to the right.
            render: (_, u) => (
              <Space wrap size={[4, 6]} className={styles.memberships}>
                {props.memberships
                  .filter((m) => m.userEmail === u.email)
                  .map((m) => (
                    <Tag
                      key={m.id}
                      color={m.role === "manager" ? "gold" : m.role === "editor" ? "green" : "default"}
                      closable={props.isAdmin || m.userEmail !== props.me}
                      onClose={(e) => {
                        e.preventDefault();
                        act(removeMembershipAction(m.id), t("已移除"));
                      }}
                    >
                      {m.organizationId ? t("組織：{0}", [orgName.get(m.organizationId)]) : t("專案：{0}", [projectName.get(m.projectId!)])}（{m.role === "manager" ? t("組織管理者") : m.role === "editor" ? t("編輯") : t("檢視")}）
                    </Tag>
                  ))}
              </Space>
            ),
          },
          ...(props.isAdmin ? [{
            title: t("管理員"),
            width: 90,
            render: (_: unknown, u: Props["users"][number]) => (
              <Switch size="small" checked={u.isAdmin} disabled={u.email === props.me} onChange={(on) => act(setAdminAction(u.email, on))} />
            ),
          }] : []),
          { title: t("最近登入"), width: 170, render: (_, u) => time(u.lastSeenAt, locale) },
          ...(props.isAdmin ? [{ title: t("操作"), width: 80, render: (_: unknown, u: Props["users"][number]) => u.email === props.me ? null : (
            <Popconfirm title={t("刪除 {0}？", [u.email])} description={t("此帳號的所有組織及專案權限也會移除；再次登入會重新建立帳號；環境設定中的管理員仍會自動取得管理員權限。")} okText={t("刪除")} cancelText={t("取消")} onConfirm={() => act(deleteUserAction(u.email), t("帳號已刪除"))}>
              <Button size="small" type="link" danger>{t("刪除")}</Button>
            </Popconfirm>
          ) }] : []),
        ]}
      />
    </div>
  );
}

function Secrets(props: Props) {
  const { t, locale } = useI18n();
  const act = useAction();
  const [form] = Form.useForm<{ name: string; value: string; description: string; organizationId?: string }>();
  const orgName = new Map(props.organizations.map((o) => [o.id, o.name]));
  const [grantForm] = Form.useForm<SecretGrant & { name: string }>();
  const projectLabel = (id: string) => {
    const project = props.projects.find((item) => item.id === id);
    const organization = props.organizations.find((item) => item.id === project?.organizationId);
    return project ? [organization?.name, project.name].filter(Boolean).join(" / ") : id;
  };
  return (
    <div className={styles.stack}>
      {props.unapprovedReferences.length > 0 && (
        <Alert
          type="error"
          title={t("以下發布版本需要 MCP 憑證授權")}
          description={
            <ul style={{ margin: 0 }}>
              {props.unapprovedReferences.map((reference, index) => (
                <li key={`${reference.id}-${index}`}>
                  <Link href={`/agents/${reference.id}`}>{reference.name}</Link>
                  {" · "}{projectLabel(reference.projectId)}{" · "}
                  <code>{reference.secret}</code>{" · "}
                  <code>{reference.serverUrl ?? t("需要 HTTPS MCP 伺服器網址")}</code>{" · "}
                  <code>{reference.field}</code>
                  {reference.serverUrl && props.secrets.some((secret) => secret.name === reference.secret) && (
                    <Button type="link" size="small" onClick={() => grantForm.setFieldsValue({
                      name: reference.secret, projectId: reference.projectId, serverUrl: reference.serverUrl!, field: reference.field,
                    })}>{t("填入授權資料")}</Button>
                  )}
                </li>
              ))}
            </ul>
          }
        />
      )}
      {props.mcpWithoutSecret.length > 0 && (
        <Alert
          type="warning"
          title={t("以下發布中的 agent 有 MCP 工具但沒有設定憑證。從 OpenAI 匯入時拿不到 MCP 的授權資訊，如果該伺服器需要授權，請在工具設定中加上憑證參照。")}
          description={
            <ul style={{ margin: 0 }}>
              {props.mcpWithoutSecret.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`}>{a.name}</Link>：{a.servers.join(", ")}
                </li>
              ))}
            </ul>
          }
        />
      )}
      <Card size="small" title={t("新增或更新憑證")} className={styles.card}>
        <Typography.Paragraph type="secondary" className={styles.formHint}>
          {t("將憑證授權給指定的專案、HTTPS MCP 伺服器和欄位後，工具就能使用")}{" "}<code>{"{{secret:name}}"}</code>{"。"}
        </Typography.Paragraph>
        <Form
          className={styles.form}
          form={form}
          layout="inline"
          size="small"
          initialValues={{ organizationId: props.isAdmin ? undefined : props.organizations[0]?.id }}
          onFinish={async (values) => {
            const r = await act(setSecretAction({ ...values, description: values.description ?? "" }), t("已儲存"));
            if (r.ok) form.resetFields(["name", "value", "description"]);
          }}
        >
          {/* A credential belongs to one organization, whose managers may change it; an admin may leave it global. */}
          <Form.Item name="organizationId" className={styles.field} rules={[{ required: !props.isAdmin }]}>
            <Select
              aria-label={t("所屬組織")}
              placeholder={props.isAdmin ? t("全域（僅管理員）") : t("所屬組織")}
              allowClear={props.isAdmin}
              showSearch={{ optionFilterProp: "label" }}
              options={props.organizations.map((o) => ({ value: o.id, label: o.name }))}
            />
          </Form.Item>
          <Form.Item name="name" className={styles.field} rules={[{ required: true }]}>
            <Input aria-label={t("名稱")} placeholder={t("名稱")} />
          </Form.Item>
          <Form.Item name="value" className={styles.field} rules={[{ required: true }]}>
            <Input.Password aria-label={t("值")} placeholder={t("值")} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="description" className={styles.field}>
            <Input aria-label={t("說明（選填）")} placeholder={t("說明（選填）")} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("儲存")}</Button>
        </Form>
      </Card>
      <Card size="small" title={t("授權 MCP 憑證")} className={styles.card}>
        <Form
          className={styles.form}
          form={grantForm}
          layout="inline"
          size="small"
          initialValues={{ field: "authorization" }}
          onFinish={async ({ name, ...grant }) => {
            const result = await act(setSecretGrantAction(name, grant, true), t("已儲存"));
            if (result.ok) grantForm.resetFields();
          }}
        >
          <Form.Item name="name" className={styles.field} rules={[{ required: true }]}>
            <Select aria-label={t("憑證")} placeholder={t("憑證")} options={props.secrets.map(({ name }) => ({ value: name, label: name }))} />
          </Form.Item>
          <Form.Item name="projectId" className={styles.field} rules={[{ required: true }]}>
            <Select aria-label={t("專案")} placeholder={t("專案")} options={props.projects.map(({ id }) => ({ value: id, label: projectLabel(id) }))} />
          </Form.Item>
          <Form.Item name="serverUrl" className={styles.field} rules={[{ required: true }]}>
            <Input aria-label={t("HTTPS MCP 伺服器網址")} placeholder={t("HTTPS MCP 伺服器網址")} />
          </Form.Item>
          <Form.Item name="field" className={styles.field} rules={[{ required: true }]}>
            <Input aria-label={t("MCP 憑證欄位")} placeholder="authorization / headers.x-api-key" />
          </Form.Item>
          <Button type="primary" htmlType="submit">{t("儲存")}</Button>
        </Form>
      </Card>
      <Table
        scroll={{ x: "max-content" }}
        rowKey="name"
        size="small"
        pagination={false}
        dataSource={props.secrets}
        columns={[
          { title: t("名稱"), dataIndex: "name", render: (n: string) => <code>{n}</code> },
          { title: t("說明"), dataIndex: "description" },
          { title: t("所屬組織"), width: 200, render: (_, s) => s.organizationId ? (orgName.get(s.organizationId) ?? s.organizationId) : <Typography.Text type="secondary">{t("全域（僅管理員）")}</Typography.Text> },
          {
            title: t("MCP 憑證授權"),
            render: (_, secret) => (
              <Space orientation="vertical" size={0}>
                {secret.grants.map((grant) => (
                  <span key={`${grant.projectId}/${grant.serverUrl}/${grant.field}`}>
                    {projectLabel(grant.projectId)}{" · "}<code>{grant.serverUrl}</code>{" · "}<code>{grant.field}</code>
                    <Popconfirm title={t("撤銷此 MCP 憑證授權？")} onConfirm={() => act(setSecretGrantAction(secret.name, grant, false), t("已刪除"))}>
                      <Button size="small" type="link" danger>{t("撤銷")}</Button>
                    </Popconfirm>
                  </span>
                ))}
              </Space>
            ),
          },
          { title: t("更新者"), dataIndex: "updatedBy", width: 220 },
          { title: t("更新時間"), width: 170, render: (_, s) => time(s.updatedAt, locale) },
          {
            title: "",
            width: 80,
            render: (_, s) => (
              <Popconfirm title={t("刪除 {0}？", [s.name])} description={t("參照它的 agent 會無法被學生端取得。")} onConfirm={() => act(deleteSecretAction(s.name), t("已刪除"))}>
                <Button size="small" type="link" danger>
                  {t("刪除")}</Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}

function Sync(props: Props) {
  const { t } = useI18n();
  const act = useAction();
  const [busy, setBusy] = useState(false);
  const inactive = props.projects.filter((p) => !p.active).length;
  return (
    <div className={styles.sync}>
      <p>
        {t("組織與專案以 RCSL 為準。目前有 {0} 個組織、{1} 個專案。", [props.organizations.length, props.projects.length])} {inactive > 0 && t("（其中 {0} 個已不在 RCSL，標記為停用）", [inactive])}
      </p>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await act(syncRcslAction(), t("同步完成"));
          setBusy(false);
        }}
      >
        {t("立即從 RCSL 同步")}</Button>
    </div>
  );
}

function Audit(props: Props) {
  const { t, locale } = useI18n();
  return (
    <Table
      scroll={{ x: "max-content" }}
      rowKey="id"
      size="small"
      dataSource={props.audit}
      pagination={{ pageSize: 50 }}
      columns={[
        { title: t("時間"), width: 170, render: (_, a) => time(a.createdAt, locale) },
        { title: t("操作者"), dataIndex: "actor", width: 220 },
        { title: t("動作"), dataIndex: "action", width: 180 },
        {
          title: t("對象"),
          render: (_, a) => (a.targetType === "agent" ? <Link href={`/agents/${a.targetId}`}>{a.targetId}</Link> : `${a.targetType}: ${a.targetId}`),
        },
        { title: t("內容"), render: (_, a) => (a.detail ? <code style={{ fontSize: 12 }}>{JSON.stringify(a.detail)}</code> : null) },
      ]}
    />
  );
}
