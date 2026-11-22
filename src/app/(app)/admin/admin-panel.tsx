"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, Input, Popconfirm, Radio, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import {
  addMembershipAction,
  deleteSecretAction,
  removeMembershipAction,
  setAdminAction,
  setSecretAction,
  syncRcslAction,
  type ActionResult,
} from "../../actions";

type Props = {
  me: string;
  users: { email: string; name: string | null; isAdmin: boolean; lastSeenAt: string | null }[];
  memberships: { id: number; userEmail: string; organizationId: string | null; projectId: string | null; role: "viewer" | "editor" }[];
  organizations: { id: string; name: string; active: boolean }[];
  projects: { id: string; name: string; organizationId: string; active: boolean }[];
  secrets: { name: string; description: string; updatedBy: string | null; updatedAt: string }[];
  audit: { id: number; actor: string | null; action: string; targetType: string; targetId: string; detail: unknown; createdAt: string }[];
  mcpWithoutSecret: { id: string; name: string; servers: string[] }[];
  missingSecrets: string[];
};

const time = (t: string | null) => (t ? new Date(t).toLocaleString("zh-TW", { hour12: false }) : "-");

export function AdminPanel(props: Props) {
  return (
    <App>
      <Typography.Title level={3}>管理</Typography.Title>
      <Tabs
        items={[
          { key: "members", label: "成員與權限", children: <Members {...props} /> },
          { key: "secrets", label: "憑證", children: <Secrets {...props} /> },
          { key: "sync", label: "RCSL 同步", children: <Sync {...props} /> },
          { key: "audit", label: "操作紀錄", children: <Audit {...props} /> },
        ]}
      />
    </App>
  );
}

function useAction() {
  const router = useRouter();
  const { message } = App.useApp();
  return async <T,>(p: Promise<ActionResult<T>>, ok?: string) => {
    const r = await p;
    if (!r.ok) message.error(r.error);
    else {
      if (ok) message.success(ok);
      router.refresh();
    }
    return r;
  };
}

function Members(props: Props) {
  const act = useAction();
  const [form] = Form.useForm<{ email: string; scope: "organization" | "project"; scopeId: string; role: "viewer" | "editor" }>();
  const scope = Form.useWatch("scope", form) ?? "organization";
  const orgName = new Map(props.organizations.map((o) => [o.id, o.name]));
  const projectName = new Map(props.projects.map((p) => [p.id, `${orgName.get(p.organizationId)} / ${p.name}`]));

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="large">
      <Card size="small" title="授權">
        <Form
          form={form}
          layout="inline"
          initialValues={{ scope: "organization", role: "editor" }}
          onFinish={async (values) => {
            const r = await act(addMembershipAction(values), "已授權");
            if (r.ok) form.resetFields(["email", "scopeId"]);
          }}
        >
          <Form.Item name="email" rules={[{ required: true, type: "email" }]}>
            <Input placeholder="Google 帳號 email" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="scope">
            <Radio.Group
              options={[
                { value: "organization", label: "整個組織" },
                { value: "project", label: "單一專案" },
              ]}
              onChange={() => form.setFieldValue("scopeId", undefined)}
            />
          </Form.Item>
          <Form.Item name="scopeId" rules={[{ required: true }]}>
            <Select
              style={{ width: 360 }}
              showSearch={{ optionFilterProp: "label" }}
              placeholder={scope === "organization" ? "選擇組織" : "選擇專案"}
              options={
                scope === "organization"
                  ? props.organizations.map((o) => ({ value: o.id, label: o.name }))
                  : props.projects.map((p) => ({ value: p.id, label: projectName.get(p.id) }))
              }
            />
          </Form.Item>
          <Form.Item name="role">
            <Select
              style={{ width: 110 }}
              options={[
                { value: "editor", label: "可編輯" },
                { value: "viewer", label: "只能檢視" },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            授權
          </Button>
        </Form>
      </Card>
      <Table
        rowKey="email"
        size="small"
        dataSource={props.users}
        pagination={false}
        columns={[
          { title: "帳號", dataIndex: "email", render: (e: string, u) => <Space orientation="vertical" size={0}>{e}<Typography.Text type="secondary" style={{ fontSize: 12 }}>{u.name}</Typography.Text></Space> },
          {
            title: "權限",
            render: (_, u) => (
              <Space wrap size={4}>
                {props.memberships
                  .filter((m) => m.userEmail === u.email)
                  .map((m) => (
                    <Tag
                      key={m.id}
                      color={m.role === "editor" ? "green" : "default"}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        act(removeMembershipAction(m.id), "已移除");
                      }}
                    >
                      {m.organizationId ? `組織：${orgName.get(m.organizationId)}` : `專案：${projectName.get(m.projectId!)}`}（{m.role === "editor" ? "編輯" : "檢視"}）
                    </Tag>
                  ))}
              </Space>
            ),
          },
          {
            title: "管理員",
            width: 90,
            render: (_, u) => (
              <Switch size="small" checked={u.isAdmin} disabled={u.email === props.me} onChange={(on) => act(setAdminAction(u.email, on))} />
            ),
          },
          { title: "最近登入", width: 170, render: (_, u) => time(u.lastSeenAt) },
        ]}
      />
    </Space>
  );
}

function Secrets(props: Props) {
  const act = useAction();
  const [form] = Form.useForm<{ name: string; value: string; description: string }>();
  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="large">
      {props.missingSecrets.length > 0 && (
        <Alert type="error" title={`發布中的 agent 參照了尚未設定的憑證：${props.missingSecrets.join(", ")}。學生端會無法取得這些 agent。`} />
      )}
      {props.mcpWithoutSecret.length > 0 && (
        <Alert
          type="warning"
          title="以下發布中的 agent 有 MCP 工具但沒有設定憑證。從 OpenAI 匯入時拿不到 MCP 的授權資訊，如果該伺服器需要授權，請在工具設定中加上憑證參照。"
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
      <Card size="small" title="新增或更新憑證">
        <Typography.Paragraph type="secondary">
          在工具設定的任何字串欄位寫 <code>{"{{secret:名稱}}"}</code>，例如 MCP 的 <code>{'"authorization": "{{secret:rcsl_mcp_token}}"'}</code>。實際值加密儲存，只在學生端讀取設定時代入，編輯器和版本紀錄都看不到。
        </Typography.Paragraph>
        <Form
          form={form}
          layout="inline"
          onFinish={async (values) => {
            const r = await act(setSecretAction({ ...values, description: values.description ?? "" }), "已儲存");
            if (r.ok) form.resetFields();
          }}
        >
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="名稱" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="value" rules={[{ required: true }]}>
            <Input.Password placeholder="值" style={{ width: 280 }} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="description">
            <Input placeholder="說明（選填）" style={{ width: 240 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            儲存
          </Button>
        </Form>
      </Card>
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        dataSource={props.secrets}
        columns={[
          { title: "名稱", dataIndex: "name", render: (n: string) => <code>{n}</code> },
          { title: "說明", dataIndex: "description" },
          { title: "更新者", dataIndex: "updatedBy", width: 220 },
          { title: "更新時間", width: 170, render: (_, s) => time(s.updatedAt) },
          {
            title: "",
            width: 80,
            render: (_, s) => (
              <Popconfirm title={`刪除 ${s.name}？`} description="參照它的 agent 會無法被學生端取得。" onConfirm={() => act(deleteSecretAction(s.name), "已刪除")}>
                <Button size="small" type="link" danger>
                  刪除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Space>
  );
}

function Sync(props: Props) {
  const act = useAction();
  const [busy, setBusy] = useState(false);
  const inactive = props.projects.filter((p) => !p.active).length;
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Typography.Paragraph>
        組織與專案以 RCSL 為準。目前有 {props.organizations.length} 個組織、{props.projects.length} 個專案
        {inactive > 0 && `（其中 ${inactive} 個已不在 RCSL，標記為停用）`}。
      </Typography.Paragraph>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await act(syncRcslAction(), "同步完成");
          setBusy(false);
        }}
      >
        立即從 RCSL 同步
      </Button>
    </Space>
  );
}

function Audit(props: Props) {
  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={props.audit}
      pagination={{ pageSize: 50 }}
      columns={[
        { title: "時間", width: 170, render: (_, a) => time(a.createdAt) },
        { title: "操作者", dataIndex: "actor", width: 220 },
        { title: "動作", dataIndex: "action", width: 180 },
        {
          title: "對象",
          render: (_, a) => (a.targetType === "agent" ? <Link href={`/agents/${a.targetId}`}>{a.targetId}</Link> : `${a.targetType}: ${a.targetId}`),
        },
        { title: "內容", render: (_, a) => (a.detail ? <code style={{ fontSize: 12 }}>{JSON.stringify(a.detail)}</code> : null) },
      ]}
    />
  );
}
