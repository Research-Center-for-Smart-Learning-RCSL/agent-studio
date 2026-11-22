"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { createAgentAction } from "../actions";

type Row = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  organizationName: string;
  publishedVersion: number | null;
  latestVersion: number | null;
  updatedAt: string;
  archivedAt: string | null;
};

type ProjectOption = { id: string; name: string; organizationName: string };

export function AgentList(props: {
  rows: Row[];
  editableProjects: ProjectOption[];
  includeArchived: boolean;
  hasAnyAccess: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of props.rows) seen.set(r.projectId, `${r.organizationName} / ${r.projectName}`);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [props.rows]);

  const filtered = props.rows.filter(
    (r) =>
      (!project || r.projectId === project) &&
      (!query || `${r.name} ${r.id} ${r.projectName} ${r.organizationName}`.toLowerCase().includes(query.toLowerCase())),
  );

  if (!props.hasAnyAccess) {
    return (
      <Empty
        style={{ marginTop: 80 }}
        description="你的帳號還沒有任何專案的權限，請聯絡管理員開通。"
      />
    );
  }

  return (
    <App>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <Space wrap>
          <Input.Search placeholder="搜尋名稱或 ID" allowClear onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }} />
          <Select
            placeholder="所有專案"
            allowClear
            showSearch={{ optionFilterProp: "label" }}
            options={projectOptions}
            onChange={setProject}
            style={{ width: 360 }}
          />
          <Space>
            <Switch
              checked={props.includeArchived}
              onChange={(on) => router.push(on ? "/?archived=1" : "/")}
            />
            <span>顯示已封存</span>
          </Space>
        </Space>
        {props.editableProjects.length > 0 && (
          <Button type="primary" onClick={() => setCreating(true)}>
            新增 agent
          </Button>
        )}
      </Space>
      <Table<Row>
        rowKey="id"
        dataSource={filtered}
        size="middle"
        pagination={{ pageSize: 50, showSizeChanger: false }}
        columns={[
          {
            title: "名稱",
            dataIndex: "name",
            render: (name: string, r) => (
              <Space orientation="vertical" size={0}>
                <Link href={`/agents/${r.id}`}>{name}</Link>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.id}
                </Typography.Text>
              </Space>
            ),
          },
          { title: "組織", dataIndex: "organizationName", width: 220 },
          { title: "專案", dataIndex: "projectName", width: 240 },
          {
            title: "版本",
            width: 140,
            render: (_, r) => (
              <Space size={4}>
                <Tag color="blue">v{r.publishedVersion ?? "-"} 發布中</Tag>
                {r.latestVersion !== null && r.latestVersion !== r.publishedVersion && <Tag>最新 v{r.latestVersion}</Tag>}
              </Space>
            ),
          },
          {
            title: "更新時間",
            dataIndex: "updatedAt",
            width: 170,
            render: (t: string, r) => (
              <Space size={4}>
                {new Date(t).toLocaleString("zh-TW", { hour12: false })}
                {r.archivedAt && <Tag color="default">已封存</Tag>}
              </Space>
            ),
          },
        ]}
      />
      <CreateAgentModal open={creating} onClose={() => setCreating(false)} projects={props.editableProjects} />
    </App>
  );
}

function CreateAgentModal(props: { open: boolean; onClose: () => void; projects: ProjectOption[] }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ projectId: string; name: string }>();
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="新增 agent"
      open={props.open}
      onCancel={props.onClose}
      okText="建立"
      confirmLoading={busy}
      onOk={async () => {
        const values = await form.validateFields();
        setBusy(true);
        const result = await createAgentAction(values.projectId, values.name);
        setBusy(false);
        if (!result.ok) {
          message.error(result.error);
          return;
        }
        props.onClose();
        router.push(`/agents/${result.data}`);
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="projectId" label="專案" rules={[{ required: true }]}>
          <Select
            showSearch={{ optionFilterProp: "label" }}
            options={props.projects.map((p) => ({ value: p.id, label: `${p.organizationName} / ${p.name}` }))}
          />
        </Form.Item>
        <Form.Item name="name" label="名稱" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
