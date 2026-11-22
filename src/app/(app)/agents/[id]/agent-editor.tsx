"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Editor from "@monaco-editor/react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { AgentSettings, InstructionMessage } from "@/db/schema";
import { attachmentNames, maxToolFiles, maxToolUploadBytes, maxToolUploadCount, readToolJson, toolAttachments, toolFileId, toolVectorStoreId, withAttachmentNames, type ToolUploadAttachment } from "@/lib/tool-attachments";
import { publishVersionAction, saveVersionAction, setArchivedAction, updateAgentMetaAction } from "../../../actions";

export type ToolTemplate = { key: string; tool: Record<string, unknown> };

type VersionMeta = {
  version: number;
  model: string;
  note: string;
  createdBy: string | null;
  source: string;
  createdAt: string;
};

type Draft = {
  model: string;
  instructions: InstructionMessage[];
  tools: Record<string, unknown>[];
  settings: AgentSettings;
};

const EMPTY: Draft = { model: "", instructions: [{ role: "developer", content: "" }], tools: [], settings: {} };

function toolLabel(tool: Record<string, unknown>): string {
  const type = String(tool.type);
  const name = (tool.name ?? tool.server_label) as string | undefined;
  return name ? `${name} (${type})` : type;
}

export function AgentEditor(props: {
  agent: {
    id: string;
    name: string;
    description: string;
    projectName: string;
    organizationName: string;
    publishedVersion: number | null;
    archived: boolean;
  };
  versions: VersionMeta[];
  selected: (Draft & { version: number }) | null;
  canEdit: boolean;
  toolTemplates: ToolTemplate[];
  modelSuggestions: string[];
  canUploadToolFiles: boolean;
}) {
  return (
    <App>
      <EditorInner {...props} />
    </App>
  );
}

function EditorInner(props: Parameters<typeof AgentEditor>[0]) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const base: Draft = useMemo(() => {
    const b = props.selected ?? EMPTY;
    // Imported prompts can have no instructions; give the editor one empty message.
    return b.instructions.length ? b : { ...b, instructions: [{ role: "developer", content: "" }] };
  }, [props.selected]);
  const [draft, setDraft] = useState<Draft>(() => structuredClone(base));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const readOnly = !props.canEdit;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const latest = props.versions[0]?.version;
  const viewingOld = !readOnly && props.selected && latest !== undefined && props.selected.version !== latest;

  async function save(publish: boolean) {
    setBusy(true);
    const result = await saveVersionAction(props.agent.id, { ...draft, note }, publish);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(publish ? `已儲存並發布 v${result.data}` : `已儲存 v${result.data}`);
    setNote("");
    router.push(`/agents/${props.agent.id}?v=${result.data}`);
    router.refresh();
  }

  function openVersion(version: number) {
    const go = () => router.push(`/agents/${props.agent.id}?v=${version}`);
    if (!dirty) return go();
    modal.confirm({ title: "放棄未儲存的修改？", okText: "放棄並切換", cancelText: "取消", onOk: go });
  }

  return (
    <Row gutter={24}>
      <Col xs={24} lg={17}>
        <Header agent={props.agent} canEdit={props.canEdit} />
        {readOnly && <Alert style={{ marginBottom: 16 }} type="info" title="你對這個專案只有檢視權限。" />}
        {viewingOld && (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            title={`正在檢視 v${props.selected!.version}，不是最新版本。儲存後會成為新的 v${latest! + 1}。`}
          />
        )}
        <Card>
          <Tabs
            items={[
              {
                key: "instructions",
                label: "Instructions",
                children: (
                  <InstructionsEditor
                    value={draft.instructions}
                    readOnly={readOnly}
                    onChange={(instructions) => setDraft({ ...draft, instructions })}
                  />
                ),
              },
              {
                key: "model",
                label: "模型與參數",
                children: (
                  <ModelSettings
                    model={draft.model}
                    settings={draft.settings}
                    readOnly={readOnly}
                    suggestions={props.modelSuggestions}
                    onChange={(model, settings) => setDraft({ ...draft, model, settings })}
                  />
                ),
              },
              {
                key: "tools",
                label: `工具 (${draft.tools.length})`,
                children: (
                  <ToolsEditor
                    agentId={props.agent.id}
                    canUpload={props.canUploadToolFiles}
                    tools={draft.tools}
                    readOnly={readOnly}
                    templates={props.toolTemplates}
                    onChange={(tools) => setDraft({ ...draft, tools })}
                  />
                ),
              },
            ]}
          />
        </Card>
        {!readOnly && (
          <Card style={{ marginTop: 16 }}>
            <Space.Compact style={{ width: "100%" }}>
              <Input placeholder="這次修改了什麼（選填）" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <Button disabled={!dirty} loading={busy} onClick={() => save(false)}>
                儲存為新版本
              </Button>
              <Button type="primary" disabled={!dirty} loading={busy} onClick={() => save(true)}>
                儲存並發布
              </Button>
            </Space.Compact>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              學生端執行的是「發布中」的版本。只儲存不發布，可以先在版本列表檢查、比對後再發布。
            </Typography.Text>
            {dirty && (
              <div style={{ marginTop: 8 }}>
                <Button size="small" type="link" onClick={() => setDraft(structuredClone(base))}>
                  還原未儲存的修改
                </Button>
              </div>
            )}
          </Card>
        )}
      </Col>
      <Col xs={24} lg={7}>
        <VersionList
          agentId={props.agent.id}
          versions={props.versions}
          published={props.agent.publishedVersion}
          selected={props.selected?.version ?? null}
          canEdit={props.canEdit}
          onOpen={openVersion}
        />
      </Col>
    </Row>
  );
}

function Header(props: { agent: Parameters<typeof AgentEditor>[0]["agent"]; canEdit: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ name: string; description: string }>();

  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text type="secondary">
        <Link href="/">Agents</Link> / {props.agent.organizationName} / {props.agent.projectName}
      </Typography.Text>
      <Space align="center" style={{ display: "flex", justifyContent: "space-between" }}>
        <Space align="center">
          <Typography.Title level={3} style={{ margin: "4px 0" }}>
            {props.agent.name}
          </Typography.Title>
          {props.agent.archived && <Tag>已封存</Tag>}
        </Space>
        {props.canEdit && (
          <Dropdown
            menu={{
              items: [
                { key: "meta", label: "修改名稱與說明" },
                { key: "archive", label: props.agent.archived ? "取消封存" : "封存（學生端不再列出）", danger: !props.agent.archived },
              ],
              onClick: async ({ key }) => {
                if (key === "meta") {
                  form.setFieldsValue({ name: props.agent.name, description: props.agent.description });
                  setEditing(true);
                } else {
                  const r = await setArchivedAction(props.agent.id, !props.agent.archived);
                  if (!r.ok) message.error(r.error);
                  router.refresh();
                }
              },
            }}
          >
            <Button>更多</Button>
          </Dropdown>
        )}
      </Space>
      <Typography.Text copyable type="secondary" style={{ fontSize: 12 }}>
        {props.agent.id}
      </Typography.Text>
      {props.agent.description && <Typography.Paragraph style={{ marginTop: 8 }}>{props.agent.description}</Typography.Paragraph>}
      <Modal
        title="名稱與說明"
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={async () => {
          const values = await form.validateFields();
          const r = await updateAgentMetaAction(props.agent.id, values);
          if (!r.ok) return message.error(r.error);
          setEditing(false);
          router.refresh();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名稱" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="說明">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function InstructionsEditor(props: {
  value: InstructionMessage[];
  readOnly: boolean;
  onChange: (v: InstructionMessage[]) => void;
}) {
  const multi = props.value.length > 1;
  const update = (i: number, patch: Partial<InstructionMessage>) =>
    props.onChange(props.value.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {multi && (
        <Alert
          type="info"
          title="這個 agent 有多段訊息。送給模型時會依序合併成一段 instructions。"
        />
      )}
      {props.value.map((m, i) => (
        <div key={i}>
          {multi && (
            <Space style={{ marginBottom: 4 }}>
              <Select
                size="small"
                value={m.role}
                disabled={props.readOnly}
                onChange={(role) => update(i, { role })}
                options={["developer", "system", "user", "assistant"].map((r) => ({ value: r, label: r }))}
              />
              {!props.readOnly && (
                <Button size="small" danger type="link" onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}>
                  刪除這段
                </Button>
              )}
            </Space>
          )}
          {typeof m.content === "string" ? (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
              <Editor
                height={multi ? "40vh" : "65vh"}
                defaultLanguage="markdown"
                value={m.content}
                onChange={(content) => update(i, { content: content ?? "" })}
                options={{ readOnly: props.readOnly, wordWrap: "on", minimap: { enabled: false }, lineNumbers: "on", fontSize: 14, scrollBeyondLastLine: false, unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false } }}
              />
            </div>
          ) : (
            <Alert
              type="warning"
              title="這段訊息含有圖片或檔案，無法以文字編輯，也無法直接送出。請改寫成純文字內容。"
              description={<pre style={{ maxHeight: 200, overflow: "auto" }}>{JSON.stringify(m.content, null, 2)}</pre>}
            />
          )}
        </div>
      ))}
      {!props.readOnly && multi && (
        <Button size="small" onClick={() => props.onChange([...props.value, { role: "developer", content: "" }])}>
          新增一段
        </Button>
      )}
    </Space>
  );
}

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];
const VERBOSITY = ["low", "medium", "high"];

function ModelSettings(props: {
  model: string;
  settings: AgentSettings;
  readOnly: boolean;
  suggestions: string[];
  onChange: (model: string, settings: AgentSettings) => void;
}) {
  const s = props.settings;
  const reasoning = (s.reasoning ?? {}) as Record<string, unknown>;
  const text = (s.text ?? {}) as Record<string, unknown>;
  const set = (patch: Partial<AgentSettings>) => props.onChange(props.model, { ...s, ...patch });
  const [rawOpen, setRawOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const models = [...new Set([...props.suggestions, props.model, modelSearch.trim()].filter(Boolean))];

  return (
    <Form layout="vertical" disabled={props.readOnly} style={{ maxWidth: 560 }}>
      <Form.Item label="模型" htmlFor="agent-model" required>
        <Select
          id="agent-model"
          aria-label="模型"
          placeholder="選擇模型或輸入模型 ID"
          value={props.model || undefined}
          options={models.map((model) => ({
            value: model,
            label: model === modelSearch.trim() && model !== props.model && !props.suggestions.includes(model)
              ? `使用 ${model}`
              : model,
          }))}
          onChange={(model) => props.onChange(model, s)}
          showSearch={{ searchValue: modelSearch, onSearch: setModelSearch, optionFilterProp: "value" }}
          onOpenChange={(open) => {
            if (!open) setModelSearch("");
          }}
        />
      </Form.Item>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="推理強度 (reasoning.effort)" extra="只有推理模型適用">
            <Select
              allowClear
              value={reasoning.effort as string | undefined}
              options={EFFORTS.map((e) => ({ value: e, label: e }))}
              onChange={(effort) => {
                const next = { ...reasoning };
                if (effort) next.effort = effort;
                else delete next.effort;
                set({ reasoning: Object.keys(next).length ? next : null });
              }}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="回覆詳細程度 (text.verbosity)">
            <Select
              allowClear
              value={text.verbosity as string | undefined}
              options={VERBOSITY.map((e) => ({ value: e, label: e }))}
              onChange={(verbosity) => {
                const next = { ...text };
                if (verbosity) next.verbosity = verbosity;
                else delete next.verbosity;
                set({ text: Object.keys(next).length ? next : null });
              }}
            />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="temperature">
            <InputNumber min={0} max={2} step={0.1} value={s.temperature ?? null} onChange={(v) => set({ temperature: v })} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="top_p">
            <InputNumber min={0} max={1} step={0.01} value={s.top_p ?? null} onChange={(v) => set({ top_p: v })} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="最大輸出 tokens">
            <InputNumber min={1} step={256} value={s.max_output_tokens ?? null} onChange={(v) => set({ max_output_tokens: v })} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
      </Row>
      <Collapse
        size="small"
        activeKey={rawOpen ? ["raw"] : []}
        onChange={(keys) => {
          const open = keys.includes("raw");
          setRawOpen(open);
          if (open) {
            setRaw(JSON.stringify(s, null, 2));
            setRawError(null);
          }
        }}
        items={[
          {
            key: "raw",
            label: "進階：以 JSON 編輯全部參數",
            children: (
              <>
                <div style={{ border: "1px solid #e5e7eb" }}>
                  <Editor
                    height="260px"
                    defaultLanguage="json"
                    value={raw}
                    onChange={(v) => {
                      setRaw(v ?? "");
                      try {
                        const parsed = JSON.parse(v ?? "");
                        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必須是物件");
                        setRawError(null);
                        props.onChange(props.model, parsed);
                      } catch (e) {
                        setRawError((e as Error).message);
                      }
                    }}
                    options={{ readOnly: props.readOnly, minimap: { enabled: false }, fontSize: 13 }}
                  />
                </div>
                {rawError && <Typography.Text type="danger">{rawError}</Typography.Text>}
              </>
            ),
          },
        ]}
      />
    </Form>
  );
}

async function waitForSearchIndex(endpoint: string, id: string) {
  const query = new URLSearchParams({ store: id });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await fetch(`${endpoint}?${query}`, { signal: AbortSignal.timeout(6000) })
      .then(async (response) => response.ok ? (await response.json()).status : null)
      .catch(() => null);
    if (status === "ready" || status === "failed") return status;
  }
  return "indexing";
}

function ToolsEditor(props: {
  agentId: string;
  canUpload: boolean;
  tools: Record<string, unknown>[];
  readOnly: boolean;
  templates: ToolTemplate[];
  onChange: (tools: Record<string, unknown>[]) => void;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [text, setText] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"uploading" | "indexing" | null>(null);
  const [pendingIndex, setPendingIndex] = useState<ToolUploadAttachment>();
  const uploading = uploadStatus !== null;
  const { message } = App.useApp();
  const present = new Set(props.tools.map(toolLabel));
  const { tool, error } = useMemo(() => {
    if (editing === null) return {};
    try {
      return { tool: readToolJson(text) };
    } catch (issue) {
      return { error: (issue as Error).message };
    }
  }, [editing, text]);
  const attachments = tool ? toolAttachments(tool) : null;
  const isFile = attachments?.kind === "file";
  const needsVectorStore = attachments?.kind === "vectorStore" && attachments.refs.length === 0;
  const names = tool ? attachmentNames(tool) : {};
  const endpoint = `/api/agents/${encodeURIComponent(props.agentId)}/tool-files`;

  function open(index: number | "new", tool: Record<string, unknown>) {
    setEditing(index);
    setText(JSON.stringify(tool, null, 2));
    setPendingIndex(undefined);
  }

  function addUploads(uploads: ToolUploadAttachment[]) {
    if (!attachments) return;
    const refs = [...new Set([...attachments.refs, ...uploads.map(({ id }) => id)])];
    const uploadedNames = Object.fromEntries(uploads.map(({ id, names }) => [id, names]));
    setText(JSON.stringify(withAttachmentNames(attachments.apply(refs), refs, { ...names, ...uploadedNames }), null, 2));
    message.success(`已加入 ${uploads.reduce((count, item) => count + item.names.length, 0)} 個檔案`);
  }

  async function checkIndex(attachment: ToolUploadAttachment) {
    setPendingIndex(attachment);
    setUploadStatus("indexing");
    try {
      const status = await waitForSearchIndex(endpoint, attachment.id);
      if (status === "indexing") {
        message.info("檔案仍在建立索引，可以重新檢查進度。");
        return;
      }
      setPendingIndex(undefined);
      if (status === "ready") addUploads([attachment]);
      else message.error("檔案無法建立索引，請確認格式後再上傳。");
    } finally {
      setUploadStatus(null);
    }
  }

  async function upload(files: File[]) {
    if (!attachments || uploading || pendingIndex || !files.length) return;
    if (files.length > maxToolUploadCount || files.some((file) => !file.size) ||
        files.reduce((total, file) => total + file.size, 0) > maxToolUploadBytes) {
      message.error(`每次可上傳 1 至 ${maxToolUploadCount} 個非空白檔案，總大小上限為 10 MB`);
      return;
    }
    if (isFile && attachments.refs.length + files.length > maxToolFiles) {
      message.error(`最多可加入 ${maxToolFiles} 個檔案，請減少這次選取的檔案`);
      return;
    }
    setUploadStatus("uploading");
    const body = new FormData();
    body.set("mode", isFile ? "file" : "search");
    for (const file of files) body.append("file", file);
    try {
      const response = await fetch(endpoint, { method: "POST", body });
      const result = await response.json() as {
        attachments?: ToolUploadAttachment[];
        error?: string;
        status?: "ready" | "indexing";
      };
      if (!response.ok || !result.attachments?.length) throw new Error(result.error || "無法上傳檔案");
      if (result.status === "indexing") {
        await checkIndex(result.attachments[0]);
      } else {
        addUploads(result.attachments);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "無法上傳檔案");
    } finally {
      setUploadStatus(null);
    }
  }

  return (
    <>
      {!props.readOnly && (
        <Space wrap style={{ marginBottom: 12, width: "100%" }}>
          <Select
            placeholder="從其他 agent 使用中的工具加入"
            style={{ width: "min(360px, 70vw)" }}
            showSearch={{ optionFilterProp: "label" }}
            value={null}
            options={props.templates
              .filter((t) => !present.has(toolLabel(t.tool)))
              .map((t) => ({ value: t.key, label: toolLabel(t.tool) }))}
            onChange={(key) => {
              const t = props.templates.find((x) => x.key === key);
              if (t) props.onChange([...props.tools, structuredClone(t.tool)]);
            }}
          />
          <Dropdown menu={{ items: [
            { key: "code", label: "程式碼直譯器", onClick: () => open("new", { type: "code_interpreter", container: { type: "auto" } }) },
            { key: "shell", label: "Hosted Shell", onClick: () => open("new", { type: "shell", environment: { type: "container_auto" } }) },
            { key: "search", label: "檔案搜尋", onClick: () => open("new", { type: "file_search", vector_store_ids: [] }) },
            { key: "custom", label: "自訂工具", onClick: () => open("new", { type: "function", name: "", description: "", parameters: { type: "object", properties: {} } }) },
          ] }} trigger={["click"]}>
            <Button>新增工具</Button>
          </Dropdown>
        </Space>
      )}
      {props.tools.length === 0 ? (
        <Empty description="沒有工具" />
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8 }}>
          {props.tools.map((tool, index) => (
            <div
              key={index}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: index ? "1px solid #f0f0f0" : undefined }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Space>
                  <Tag>{String(tool.type)}</Tag>
                  <strong>{String(tool.name ?? tool.server_label ?? "")}</strong>
                </Space>
                {typeof tool.description === "string" && (
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: "4px 0 0", fontSize: 13 }}>
                    {tool.description}
                  </Typography.Paragraph>
                )}
              </div>
              <Button type="link" size="small" onClick={() => open(index, tool)}>
                {props.readOnly ? "檢視" : "編輯"}
              </Button>
              {!props.readOnly && (
                <Popconfirm title="移除這個工具？" onConfirm={() => props.onChange(props.tools.filter((_, j) => j !== index))}>
                  <Button type="link" size="small" danger>
                    移除
                  </Button>
                </Popconfirm>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        width={760}
        title={editing === "new" ? "新增工具" : "工具設定"}
        open={editing !== null}
        onCancel={() => { if (!uploading) setEditing(null); }}
        closable={!uploading}
        keyboard={!uploading}
        mask={{ closable: !uploading }}
        cancelButtonProps={{ disabled: uploading }}
        okText="套用"
        okButtonProps={{ disabled: props.readOnly || !tool || needsVectorStore || uploading || !!pendingIndex }}
        onOk={() => {
          if (!tool || needsVectorStore || uploading || pendingIndex) return;
          if (editing === "new") props.onChange([...props.tools, tool]);
          else if (typeof editing === "number") props.onChange(props.tools.map((t, j) => (j === editing ? tool : t)));
          setEditing(null);
        }}
      >
        {attachments && (
          <Form layout="vertical">
            <Form.Item
              label={isFile ? "已附加的檔案" : "搜尋資料來源"}
              htmlFor="tool-attachment-ids"
              extra={props.canUpload ? undefined : "如已有同專案的識別碼，可以直接輸入並按 Enter 加入。"}
            >
              <Select
                id="tool-attachment-ids"
                aria-label={isFile ? "附件檔案 ID" : "向量資料庫 ID"}
                mode="tags"
                value={attachments.refs}
                options={attachments.refs.map((id) => ({ value: id, label: names[id]?.join("、") || id }))}
                maxTagTextLength={60}
                disabled={props.readOnly || uploading}
                onChange={(ids: string[]) => {
                  const pattern = isFile ? toolFileId : toolVectorStoreId;
                  if (ids.some((id) => !pattern.test(id) && !attachments.refs.includes(id))) {
                    message.error(isFile ? "請輸入有效的檔案 ID" : "請輸入有效的向量資料庫 ID");
                    return;
                  }
                  if (isFile && ids.length > maxToolFiles && ids.length > attachments.refs.length) {
                    message.error(`最多可加入 ${maxToolFiles} 個檔案`);
                    return;
                  }
                  setText(JSON.stringify(withAttachmentNames(attachments.apply(ids), ids, names), null, 2));
                }}
              />
            </Form.Item>
            {!props.readOnly && (
              props.canUpload ? (
                <Form.Item
                  label="上傳本機檔案"
                  htmlFor="tool-upload-file"
                  extra={isFile ? "每次最多 10 個檔案，總大小 10 MB。" : "每次最多 10 個檔案，總大小 10 MB。同一批檔案會一起加入搜尋。"}
                >
                  <input
                    id="tool-upload-file"
                    type="file"
                    multiple
                    style={{ maxWidth: "100%" }}
                    disabled={uploading || !!pendingIndex || (isFile && attachments.refs.length >= maxToolFiles)}
                    onChange={(event) => {
                      void upload(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                  {uploading && <span role="status">{uploadStatus === "indexing" ? " 正在建立搜尋索引…" : " 上傳中…"}</span>}
                  {pendingIndex && !uploading && (
                    <Space wrap>
                      <Button type="link" onClick={() => void checkIndex(pendingIndex)}>重新檢查索引</Button>
                      <Button type="link" onClick={() => setPendingIndex(undefined)}>略過這批檔案</Button>
                    </Space>
                  )}
                </Form.Item>
              ) : (
                <Typography.Paragraph type="secondary">此專案尚未啟用本機上傳。</Typography.Paragraph>
              )
            )}
          </Form>
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          MCP 等需要憑證的欄位請填 <code>{"{{secret:名稱}}"}</code>，由管理員在「管理 / 憑證」設定實際值，不要直接貼上金鑰。
        </Typography.Paragraph>
        <div style={{ border: "1px solid #e5e7eb" }}>
          <Editor
            height="50vh"
            defaultLanguage="json"
            value={text}
            onChange={(v) => setText(v ?? "")}
            options={{ readOnly: props.readOnly || uploading || !!pendingIndex, minimap: { enabled: false }, fontSize: 13 }}
          />
        </div>
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </Modal>
    </>
  );
}

function VersionList(props: {
  agentId: string;
  versions: VersionMeta[];
  published: number | null;
  selected: number | null;
  canEdit: boolean;
  onOpen: (v: number) => void;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  return (
    <Card title="版本" size="small" style={{ position: "sticky", top: 16 }}>
      <div style={{ maxHeight: "75vh", overflow: "auto", margin: -12 }}>
        {props.versions.map((v) => (
          <div
            key={v.version}
            style={{
              background: v.version === props.selected ? "#e6f4ff" : undefined,
              cursor: "pointer",
              padding: "8px 12px",
              borderBottom: "1px solid #f0f0f0",
            }}
            onClick={() => props.onOpen(v.version)}
          >
            <Space style={{ display: "flex", justifyContent: "space-between" }}>
              <Space size={4}>
                <strong>v{v.version}</strong>
                {v.version === props.published && <Tag color="blue">發布中</Tag>}
                {v.source === "openai-import" && <Tag>OpenAI 匯入</Tag>}
              </Space>
              <Space size={0} onClick={(e) => e.stopPropagation()}>
                {props.versions.length > 1 && (
                  <Link
                    href={`/agents/${props.agentId}/compare?a=${v.version === props.published || props.published === null ? Math.max(1, v.version - 1) : props.published}&b=${v.version}`}
                  >
                    <Button type="link" size="small">
                      比對
                    </Button>
                  </Link>
                )}
                {props.canEdit && v.version !== props.published && (
                  <Popconfirm
                    title={`把 v${v.version} 設為發布中？`}
                    description="學生端下一次對話就會使用這個版本。"
                    onConfirm={async () => {
                      const r = await publishVersionAction(props.agentId, v.version);
                      if (!r.ok) message.error(r.error);
                      else message.success(`已發布 v${v.version}`);
                      router.refresh();
                    }}
                  >
                    <Button type="link" size="small">
                      發布
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>
              {new Date(v.createdAt).toLocaleString("zh-TW", { hour12: false })} · {v.createdBy ?? "OpenAI"} · {v.model}
            </Typography.Text>
            {v.note && <Typography.Text style={{ fontSize: 12 }}>{v.note}</Typography.Text>}
          </div>
        ))}
      </div>
    </Card>
  );
}
