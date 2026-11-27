"use client";
import { formatTaipei } from "@/lib/format-time";
import { useI18n } from "@/lib/i18n-client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Empty, Form, Input, Modal, Select, Switch, Table } from "antd";
import { createAgentAction } from "../actions";
import { DirectoryRobot } from "./directory-robot";
import { rememberDirectoryView, restoreDirectoryScroll, takeDirectoryView, type DirectoryContext, type DirectoryView } from "./directory-view";

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
const agentsPerBatch = 50;

function distinguishOptions(options: { value: string; label: string }[]) {
  const counts = new Map<string, number>();
  for (const { label } of options) counts.set(label, (counts.get(label) ?? 0) + 1);
  return options.map((option) => counts.get(option.label) === 1
    ? option
    : { ...option, label: `${option.label} (${option.value})` });
}

export function AgentList({
  rows,
  projects,
  editableProjects,
  includeArchived,
  hasAnyAccess,
  userEmail,
  logsEnabled,
}: {
  rows: Row[];
  projects: Project[];
  editableProjects: Project[];
  includeArchived: boolean;
  hasAnyAccess: boolean;
  userEmail: string;
  logsEnabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [archivePending, startArchiveTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState<string>();
  const [project, setProject] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [restoredView, setRestoredView] = useState<DirectoryView | null>(null);
  const storageKey = `agent-studio:scope:${userEmail}`;

  useEffect(() => {
    let organizationId: string | undefined;
    let projectId: string | undefined;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      organizationId = projects.some((p) => p.organizationId === saved?.organization) ? saved.organization : undefined;
      projectId = organizationId && projects.some((p) => p.organizationId === organizationId && p.id === saved?.project) ? saved.project : undefined;
    } catch { /* Storage can be unavailable or contain stale data. */ }

    const savedView = takeDirectoryView(userEmail, includeArchived);
    queueMicrotask(() => {
      setOrganization(organizationId);
      setProject(projectId);
      if (savedView?.organization === (organizationId ?? null) && savedView.project === (projectId ?? null)) {
        setQuery(savedView.query);
        setRestoredView(savedView);
      }
    });
  }, [storageKey, projects, userEmail, includeArchived]);

  useEffect(() => {
    const syncScope = (event: Event) => {
      const scope = (event as CustomEvent<{ organization?: string; project?: string; userInitiated?: boolean }>).detail;
      const org = projects.some((p) => p.organizationId === scope.organization) ? scope.organization : undefined;
      const proj = org && projects.some((p) => p.organizationId === org && p.id === scope.project) ? scope.project : undefined;
      setOrganization(org);
      setProject(proj);
      if (scope.userInitiated) {
        setRestoredView(null);
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    window.addEventListener("agent-studio-scope", syncScope);
    return () => window.removeEventListener("agent-studio-scope", syncScope);
  }, [projects]);

  function persistScope(org?: string, proj?: string) {
    try { localStorage.setItem(storageKey, JSON.stringify({ organization: org, project: proj })); } catch { /* Storage is optional. */ }
  }

  const search = query.trim().toLowerCase();
  const hasFilters = Boolean(search || organization || project);
  const filterKey = JSON.stringify([search, organization, project, includeArchived, restoredView !== null]);
  const filtered = rows.filter(
    (row) =>
      (!organization || row.organizationId === organization) &&
      (!project || row.projectId === project) &&
      (!search || `${row.name} ${row.id} ${row.projectName} ${row.organizationName}`.toLowerCase().includes(search)),
  );

  function clearFilters() {
    setQuery("");
    setRestoredView(null);
    setOrganization(undefined);
    setProject(undefined);
    persistScope();
    window.dispatchEvent(new CustomEvent("agent-studio-scope", { detail: {} }));
  }

  return (
    <App className="agent-directory">
      <section className="directory-hero" aria-labelledby="directory-title">
        <div className="directory-heading">
          <div className="directory-heading-copy">
            <h1 id="directory-title">{t("Agent 管理")}</h1>
            <p>{t("瀏覽各專案的 agent、發布版本與更新記錄。")}</p>
          </div>
          <DirectoryRobot />
        </div>
        {editableProjects.length > 0 && (
          <Button className="directory-create" onClick={() => setCreating(true)}>
            <span aria-hidden="true">+</span> {t("新增 agent")}</Button>
        )}
      </section>

      <section className="studio-panel directory-panel" aria-label={t("Agent 清單")}>
        {hasAnyAccess ? (
          <>
            <div className="directory-toolbar">
              <div className="directory-search" role="search">
                <label htmlFor="agent-search">{t("搜尋")}</label>
                <Input
                  id="agent-search"
                  prefix={<span className="search-icon" aria-hidden="true" />}
                  placeholder={t("搜尋名稱或 ID")}
                  allowClear
                  value={query}
                  onChange={(event) => {
                    setRestoredView(null);
                    setQuery(event.target.value);
                  }}
                />
              </div>
              <div className="directory-summary">
                <div className="directory-results">
                  <span role="status">{t("{0} 個 agent", [filtered.length])}</span>
                  {hasFilters && (
                    <Button type="link" size="small" onClick={clearFilters}>{t("清除篩選")}</Button>
                  )}
                </div>
                <label className="archive-toggle">
                  <Switch
                    size="small"
                    aria-label={t("包含已封存")}
                    checked={includeArchived}
                    loading={archivePending}
                    onChange={(checked) => {
                      setRestoredView(null);
                      startArchiveTransition(() => router.push(checked ? "/?archived=1" : "/"));
                    }}
                  />
                  {t("包含已封存")}
                </label>
              </div>
            </div>

            <AgentResults
              key={filterKey}
              logsEnabled={logsEnabled}
              rows={filtered}
              hasFilters={hasFilters}
              restoredView={restoredView}
              context={{ userEmail, includeArchived, query, organization: organization ?? null, project: project ?? null }}
            />
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("你的帳號還沒有任何專案的權限，請聯絡管理員開通。")}
          />
        )}
      </section>

      <CreateAgentModal open={creating} onClose={() => setCreating(false)} projects={editableProjects} selectedProject={project} />
    </App>
  );
}

function AgentResults({ rows, hasFilters, restoredView, context, logsEnabled }: {
  rows: Row[];
  logsEnabled: boolean;
  hasFilters: boolean;
  restoredView: DirectoryView | null;
  context: DirectoryContext;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const dateFormat = { format: (date: Date) => formatTaipei(date, locale, false) };
  const [visibleCount, setVisibleCount] = useState(() => {
    const anchorIndex = restoredView?.anchor ? rows.findIndex((row) => row.id === restoredView.anchor?.id) : -1;
    return Math.max(agentsPerBatch, restoredView?.visibleCount ?? 0, anchorIndex + 1);
  });
  const results = useRef<HTMLDivElement>(null);
  const loadMarker = useRef<HTMLDivElement>(null);
  const hasMore = visibleCount < rows.length;
  const loadMore = useCallback(() => {
    setVisibleCount((count) => count === visibleCount ? Math.min(count + agentsPerBatch, rows.length) : count);
  }, [rows.length, visibleCount]);

  useLayoutEffect(() => {
    if (!restoredView) return;
    const frame = requestAnimationFrame(() => restoreDirectoryScroll(restoredView, results.current));
    return () => cancelAnimationFrame(frame);
  }, [restoredView]);

  useEffect(() => {
    const marker = loadMarker.current;
    if (!hasMore || !marker || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadMore();
      }
    }, { rootMargin: "0px 0px 360px 0px" });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div ref={results}>
      <Table<Row>
        rowKey="id"
        dataSource={rows.slice(0, visibleCount)}
        pagination={false}
        onRow={(row) => ({
          className: "agent-row",
          onClick: (event) => {
            if ((event.target as HTMLElement).closest("a, button, input, label") || window.getSelection()?.toString()) return;
            const href = `/agents/${row.id}`;
            if (event.ctrlKey || event.metaKey) { window.open(href, "_blank", "noopener"); return; }
            rememberDirectoryView(context, row.id, Math.min(visibleCount, rows.length), results.current);
            router.push(href);
          },
        })}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={hasFilters ? t("找不到符合篩選條件的 agent") : t("目前沒有可顯示的 agent")}
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
                  <Link
                    className="agent-name"
                    href={`/agents/${row.id}`}
                    onNavigate={() => rememberDirectoryView(context, row.id, Math.min(visibleCount, rows.length), results.current)}
                  >
                    {name}
                  </Link>
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
            title: t("專案 / 組織"),
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
            title: t("版本與狀態"),
            key: "versions",
            className: "agent-version-column",
            render: (_, row) => (
              <div className="agent-versions">
                <span className={row.publishedVersion === null ? "version-chip" : "version-chip version-published"}>
                  {row.publishedVersion === null ? t("尚未發布") : t("v{0} 發布中", [row.publishedVersion])}
                </span>
                {row.latestVersion !== null && row.latestVersion !== row.publishedVersion && (
                  <span className="version-chip">{t("最新 v")}{row.latestVersion}</span>
                )}
                {row.archivedAt && <span className="version-chip version-archived">{t("已封存")}</span>}
              </div>
            ),
          },
          {
            title: t("更新時間"),
            dataIndex: "updatedAt",
            className: "agent-updated-column",
            render: (value: string) => <time dateTime={value}>{dateFormat.format(new Date(value))}</time>,
          },
          {
            title: "",
            key: "open",
            className: "agent-open-column",
            render: (_, row) => (
              <div className="agent-open-links">
                <Link
                  className="agent-open"
                  href={`/agents/${row.id}`}
                  aria-label={t("查看 {0}", [row.name])}
                  onNavigate={() => rememberDirectoryView(context, row.id, Math.min(visibleCount, rows.length), results.current)}
                >
                  {t("查看")}<span aria-hidden="true"> ›</span>
                </Link>
                {logsEnabled && (
                  <Link className="agent-open agent-open-logs" href={`/logs?prompt=${encodeURIComponent(row.id)}`} aria-label={t("查看 {0} 的 Logs", [row.name])}>
                    Logs<span aria-hidden="true"> ›</span>
                  </Link>
                )}
              </div>
            ),
          },
        ]}
      />
      {rows.length > agentsPerBatch && (
        <div className="directory-list-footer" ref={loadMarker}>
          <span role="status">{t("已顯示 {0} / {1} 個 agent", [Math.min(visibleCount, rows.length), rows.length])}</span>
          {hasMore && <Button size="small" onClick={loadMore}>{t("載入更多")}</Button>}
        </div>
      )}
    </div>
  );
}

function CreateAgentModal(props: { open: boolean; onClose: () => void; projects: Project[]; selectedProject?: string }) {
  const { t, error } = useI18n();
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ projectId: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const initialProjectId = props.projects.find((p) => p.id === props.selectedProject)?.id;

  useEffect(() => {
    if (props.open) {
      form.resetFields();
      form.setFieldValue("projectId", initialProjectId);
    }
  }, [form, initialProjectId, props.open]);

  function resetSubmission() {
    submitting.current = false;
    setBusy(false);
  }

  return (
    <Modal
      title={t("新增 agent")}
      open={props.open}
      afterClose={resetSubmission}
      onCancel={() => {
        if (!submitting.current) props.onClose();
      }}
      okText={t("建立")}
      cancelText={t("取消")}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      confirmLoading={busy}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        disabled={busy}
        onFinish={async (values) => {
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          try {
            const result = await createAgentAction(values.projectId, values.name);
            if (!result.ok) {
              message.error(error(result.error));
              resetSubmission();
              return;
            }
            props.onClose();
            router.push(`/agents/${result.data}`);
          } catch {
            message.error(t("無法建立 agent，請稍後再試。"));
            resetSubmission();
          }
        }}
      >
        <Form.Item name="projectId" label={t("專案")} rules={[{ required: true, message: t("請選擇專案") }]}>
          <Select
            showSearch={{ optionFilterProp: "label" }}
            options={distinguishOptions(props.projects.map((p) => ({ value: p.id, label: `${p.organizationName} / ${p.name}` })))}
          />
        </Form.Item>
        <Form.Item name="name" label={t("名稱")} rules={[{ required: true, whitespace: true, message: t("請輸入名稱") }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
