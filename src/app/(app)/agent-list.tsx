"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Empty, Form, Input, Modal, Select, Switch, Table } from "antd";
import { createAgentAction } from "../actions";

type Row = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
  publishedVersion: number | null;
  latestVersion: number | null;
  updatedAt: string;
  archivedAt: string | null;
};

type Project = { id: string; name: string; organizationId: string; organizationName: string };

const dateFormat = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Taipei",
  hour12: false,
});

export function AgentList({
  rows,
  projects,
  editableProjects,
  includeArchived,
  hasAnyAccess,
}: {
  rows: Row[];
  projects: Project[];
  editableProjects: Project[];
  includeArchived: boolean;
  hasAnyAccess: boolean;
}) {
  const router = useRouter();
  const [archivePending, startArchiveTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState<string>();
  const [project, setProject] = useState<string>();
  const [creating, setCreating] = useState(false);

  const organizations = new Map(projects.map((p) => [p.organizationId, p.organizationName]));
  const organizationOptions = [...organizations].map(([value, label]) => ({ value, label }));
  const projectOptions = projects
    .filter((p) => !organization || p.organizationId === organization)
    .map((p) => ({ value: p.id, label: organization ? p.name : `${p.organizationName} / ${p.name}` }));

  const search = query.trim().toLowerCase();
  const hasFilters = Boolean(search || organization || project);
  const filtered = rows.filter(
    (row) =>
      (!organization || row.organizationId === organization) &&
      (!project || row.projectId === project) &&
      (!search || `${row.name} ${row.id} ${row.projectName} ${row.organizationName}`.toLowerCase().includes(search)),
  );

  function clearFilters() {
    setQuery("");
    setOrganization(undefined);
    setProject(undefined);
  }

  return (
    <App className="agent-directory">
      <section className="directory-hero" aria-labelledby="directory-title">
        <div>
          <h1 id="directory-title">Agent 管理</h1>
          <p>瀏覽各專案的 agent、發布版本與更新記錄。</p>
        </div>
        {editableProjects.length > 0 && (
          <Button className="directory-create" size="large" onClick={() => setCreating(true)}>
            <span aria-hidden="true">+</span> 新增 agent
          </Button>
        )}
      </section>

      <section className="studio-panel directory-panel" aria-label="Agent 清單">
        {hasAnyAccess ? (
          <>
            <div className="directory-filters">
              <div className="filter-field">
                <label htmlFor="agent-search">搜尋</label>
                <Input
                  id="agent-search"
                  prefix={<span className="search-icon" aria-hidden="true" />}
                  placeholder="搜尋名稱或 ID"
                  allowClear
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="filter-field">
                <label htmlFor="agent-organization">組織</label>
                <Select
                  id="agent-organization"
                  aria-label="組織"
                  placeholder="所有組織"
                  allowClear
                  showSearch={{ optionFilterProp: "label" }}
                  options={organizationOptions}
                  value={organization}
                  onChange={(value) => {
                    setOrganization(value);
                    setProject(undefined);
                  }}
                />
              </div>
              <div className="filter-field">
                <label htmlFor="agent-project">專案</label>
                <Select
                  id="agent-project"
                  aria-label="專案"
                  placeholder="所有專案"
                  allowClear
                  showSearch={{ optionFilterProp: "label" }}
                  options={projectOptions}
                  value={project}
                  onChange={setProject}
                />
              </div>
            </div>

            <div className="directory-summary">
              <div className="directory-results">
                <span role="status">{filtered.length} 個 agent</span>
                {hasFilters && (
                  <Button type="link" size="small" onClick={clearFilters}>清除篩選</Button>
                )}
              </div>
              <label className="archive-toggle">
                <Switch
                  size="small"
                  aria-label="包含已封存"
                  checked={includeArchived}
                  loading={archivePending}
                  onChange={(checked) => startArchiveTransition(() => router.push(checked ? "/?archived=1" : "/"))}
                />
                包含已封存
              </label>
            </div>

            <Table<Row>
              rowKey="id"
              dataSource={filtered}
              pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={hasFilters ? "找不到符合篩選條件的 agent" : "目前沒有可顯示的 agent"}
                  />
                ),
              }}
              columns={[
                {
                  title: "Agent",
                  dataIndex: "name",
                  render: (name: string, row) => (
                    <div className="agent-identity">
                      <span className="agent-icon" aria-hidden="true">✧</span>
                      <div className="agent-identity-text">
                        <Link className="agent-name" href={`/agents/${row.id}`}>{name}</Link>
                        <code className="agent-id" title={row.id}>{row.id}</code>
                        <span className="agent-scope-compact">{row.projectName} · {row.organizationName}</span>
                        <time className="agent-updated-compact" dateTime={row.updatedAt}>
                          {dateFormat.format(new Date(row.updatedAt))}
                        </time>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "專案 / 組織",
                  key: "scope",
                  className: "agent-scope-column",
                  render: (_, row) => (
                    <div className="agent-scope">
                      <span>{row.projectName}</span>
                      <span>{row.organizationName}</span>
                    </div>
                  ),
                },
                {
                  title: "版本與狀態",
                  key: "versions",
                  className: "agent-version-column",
                  render: (_, row) => (
                    <div className="agent-versions">
                      <span className={row.publishedVersion === null ? "version-chip" : "version-chip version-published"}>
                        {row.publishedVersion === null ? "尚未發布" : `v${row.publishedVersion} 發布中`}
                      </span>
                      {row.latestVersion !== null && row.latestVersion !== row.publishedVersion && (
                        <span className="version-chip">最新 v{row.latestVersion}</span>
                      )}
                      {row.archivedAt && <span className="version-chip version-archived">已封存</span>}
                    </div>
                  ),
                },
                {
                  title: "更新時間",
                  dataIndex: "updatedAt",
                  className: "agent-updated-column",
                  render: (value: string) => <time dateTime={value}>{dateFormat.format(new Date(value))}</time>,
                },
              ]}
            />
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="你的帳號還沒有任何專案的權限，請聯絡管理員開通。"
          />
        )}
      </section>

      {creating && (
        <CreateAgentModal onClose={() => setCreating(false)} projects={editableProjects} selectedProject={project} />
      )}
    </App>
  );
}

function CreateAgentModal(props: { onClose: () => void; projects: Project[]; selectedProject?: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ projectId: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const initialProject = props.projects.find((p) => p.id === props.selectedProject);

  return (
    <Modal
      title="新增 agent"
      open
      onCancel={props.onClose}
      okText="建立"
      cancelText="取消"
      confirmLoading={busy}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ projectId: initialProject?.id }}
        onFinish={async (values) => {
          setBusy(true);
          try {
            const result = await createAgentAction(values.projectId, values.name);
            if (!result.ok) {
              message.error(result.error);
              return;
            }
            props.onClose();
            router.push(`/agents/${result.data}`);
          } catch {
            message.error("無法建立 agent，請稍後再試。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="projectId" label="專案" rules={[{ required: true, message: "請選擇專案" }]}>
          <Select
            showSearch={{ optionFilterProp: "label" }}
            options={props.projects.map((p) => ({ value: p.id, label: `${p.organizationName} / ${p.name}` }))}
          />
        </Form.Item>
        <Form.Item name="name" label="名稱" rules={[{ required: true, whitespace: true, message: "請輸入名稱" }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
