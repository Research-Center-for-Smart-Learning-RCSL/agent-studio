"use client";
import { runtimeFunctionNames, runtimeFunctions } from "@/lib/runtime-functions";
import { useI18n } from "@/lib/i18n-client";
import { readDirectoryView } from "../../directory-view";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Editor from "@monaco-editor/react";
import { CloudUploadOutlined, DiffOutlined, FileTextOutlined, FullscreenOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
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
  userEmail: string;
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
  const { t, error } = useI18n();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const settingsCardRef = useRef<HTMLDivElement>(null);
  const versionPanelRef = useRef<HTMLDivElement>(null);
  const [instructionsHeight, setInstructionsHeight] = useState<number | null>(null);
  const base: Draft = useMemo(() => {
    const b = props.selected ?? EMPTY;
    // Imported prompts can have no instructions; give the editor one empty message.
    return b.instructions.length ? b : { ...b, instructions: [{ role: "developer", content: "" }] };
  }, [props.selected]);
  const [draft, setDraft] = useState<Draft>(() => structuredClone(base));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [instructionsFullscreen, setInstructionsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState("instructions");
  const editorPageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateHeight = () => {
      if (window.innerWidth < 992) return;
      const versionCard = versionPanelRef.current?.querySelector<HTMLElement>(".version-history-card");
      const monaco = settingsCardRef.current?.querySelector<HTMLElement>(".instructions-monaco");
      if (!versionCard || !monaco) return;
      const height = Math.floor(versionCard.getBoundingClientRect().bottom - monaco.getBoundingClientRect().top - 1);
      if (height > 240) {
        const minimumHeight = 520;
        const nextHeight = Math.max(minimumHeight, height);
        setInstructionsHeight((current) => current === nextHeight ? current : nextHeight);
      }
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    if (versionPanelRef.current) observer.observe(versionPanelRef.current);
    if (settingsCardRef.current) observer.observe(settingsCardRef.current);
    const mutations = new MutationObserver(updateHeight);
    if (settingsCardRef.current) mutations.observe(settingsCardRef.current, { childList: true, subtree: true });
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [props.versions.length]);
  const saveBarRef = useRef<HTMLDivElement>(null);
  const portalReady = useSyncExternalStore(() => () => {}, () => true, () => false);
  const readOnly = !props.canEdit;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);

  useEffect(() => {
    document.body.classList.toggle("instructions-fullscreen-open", instructionsFullscreen);
    return () => document.body.classList.remove("instructions-fullscreen-open");
  }, [instructionsFullscreen]);

  useEffect(() => {
    const page = editorPageRef.current;
    const saveBar = saveBarRef.current;
    if (!page || !saveBar || readOnly) return;

    const updateReservedSpace = () => {
      const bottomOffset = window.matchMedia("(max-width: 640px)").matches ? 8 : 12;
      page.style.setProperty(
        "--editor-savebar-reserved-space",
        `${Math.ceil(saveBar.getBoundingClientRect().height + bottomOffset + 12)}px`,
      );
    };
    updateReservedSpace();
    const observer = new ResizeObserver(updateReservedSpace);
    observer.observe(saveBar);
    window.addEventListener("resize", updateReservedSpace);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateReservedSpace);
      page.style.removeProperty("--editor-savebar-reserved-space");
    };
  }, [dirty, instructionsFullscreen, portalReady, readOnly]);

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
      message.error(error(result.error));
      return;
    }
    message.success(publish ? t("已儲存並發布 v{0}", [result.data]) : t("已儲存 v{0}", [result.data]));
    setNote("");
    router.push(`/agents/${props.agent.id}?v=${result.data}`);
    router.refresh();
  }

  const saveBar = !readOnly && dirty && !instructionsFullscreen && portalReady ? createPortal(
    <Card ref={saveBarRef} className={`editor-save-bar${dirty ? " is-dirty" : ""}`} size="small">
      <div className="editor-save-status"><Typography.Text strong type="warning" role="status">● {t("有未儲存的修改")}</Typography.Text></div>
      <div className="editor-save-controls">
        <Input aria-label={t("版本備註（選填）")} placeholder={t("版本備註（選填）")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <Button size="small" loading={busy} onClick={() => save(false)}>{t("儲存為新版本")}</Button>
        <Button size="small" type="primary" loading={busy} onClick={() => save(true)}>{t("儲存並發布")}</Button>
        <Button size="small" type="link" onClick={() => setDraft(structuredClone(base))}>{t("還原")}</Button>
      </div>
    </Card>,
    document.body,
  ) : null;

  function openVersion(version: number) {
    const go = () => router.push(`/agents/${props.agent.id}?v=${version}`);
    if (!dirty) return go();
    modal.confirm({ title: t("放棄未儲存的修改？"), okText: t("放棄並切換"), cancelText: t("取消"), onOk: go });
  }

  return (
    <Row ref={editorPageRef} gutter={24} className={`agent-editor-page${readOnly ? " is-readonly" : ""}${!dirty ? " is-clean" : ""}`}>
      <Col xs={24} lg={17} className={`agent-editor-settings-col${activeTab === "instructions" ? " is-instructions-active" : ""}`}>
        <Header agent={props.agent} canEdit={props.canEdit} userEmail={props.userEmail} />
        {readOnly && <Alert style={{ marginBottom: 16 }} type="info" title={t("你對這個專案只有檢視權限。")} />}
        {viewingOld && (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            title={t("正在檢視 v{0}，不是最新版本。儲存後會成為新的 v{1}。", [props.selected!.version, latest! + 1])}
          />
        )}
        <Card ref={settingsCardRef} className="agent-editor-settings-card">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabBarExtraContent={activeTab === "instructions" ? <InstructionsToolbar value={draft.instructions} readOnly={readOnly} onChange={(instructions) => setDraft({ ...draft, instructions })} onFullscreenChange={setInstructionsFullscreen} /> : null}
            items={[
              {
                key: "instructions",
                label: "Instructions",
                children: (
                  <InstructionsEditor
                    value={draft.instructions}
                    readOnly={readOnly}
                    onChange={(instructions) => setDraft({ ...draft, instructions })}
                    fullscreen={instructionsFullscreen}
                    onFullscreenChange={setInstructionsFullscreen}
                    fillAvailableHeight={activeTab === "instructions"}
                    availableHeight={instructionsHeight ?? (activeTab === "instructions" ? 520 : null)}
                  />
                ),
              },
              {
                key: "model",
                label: t("模型與參數"),
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
                label: t("工具 ({0})", [draft.tools.length]),
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
      </Col>
      {saveBar}
      <Col xs={24} lg={7} className="agent-editor-version-col">
        <div ref={versionPanelRef}>
        <VersionList
          agentId={props.agent.id}
          versions={props.versions}
          published={props.agent.publishedVersion}
          selected={props.selected?.version ?? null}
          canEdit={props.canEdit}
          onOpen={openVersion}
        />
        </div>
      </Col>
    </Row>
  );
}

function Header(props: { agent: Parameters<typeof AgentEditor>[0]["agent"]; canEdit: boolean; userEmail: string }) {
  const { t, error } = useI18n();
  const router = useRouter();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ name: string; description: string }>();

  return (
    <div className="agent-editor-heading">
      <Space wrap className="agent-breadcrumb">
        <Link
          className="agent-back-link"
          href="/"
          aria-label={t("返回 Agents")}
          title={t("返回 Agents")}
          onNavigate={(event) => {
            const view = readDirectoryView();
            if (view?.agentId !== props.agent.id || view.userEmail !== props.userEmail) return;
            event.preventDefault();
            router.push(view.includeArchived ? "/?archived=1" : "/", { scroll: false });
          }}
        >
          <span aria-hidden="true">←</span> {t("返回")}
        </Link>
        <Typography.Text type="secondary">{props.agent.organizationName} / {props.agent.projectName}</Typography.Text>
      </Space>
      <Space align="center" style={{ display: "flex", justifyContent: "space-between" }}>
        <Space align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {props.agent.name}
          </Typography.Title>
          {props.canEdit && <Button type="text" aria-label={t("編輯名稱與說明")} title={t("編輯名稱與說明")} onClick={() => { form.setFieldsValue({ name: props.agent.name, description: props.agent.description }); setEditing(true); }}>✎</Button>}
          {props.agent.archived && <Tag>{t("已封存")}</Tag>}
        </Space>
        {props.canEdit && (
          <Dropdown
            menu={{
              items: [
                { key: "meta", label: t("修改名稱與說明") },
                { key: "archive", label: props.agent.archived ? t("取消封存") : t("封存（學生端不再列出）"), danger: !props.agent.archived },
              ],
              onClick: async ({ key }) => {
                if (key === "meta") {
                  form.setFieldsValue({ name: props.agent.name, description: props.agent.description });
                  setEditing(true);
                } else {
                  const r = await setArchivedAction(props.agent.id, !props.agent.archived);
                  if (!r.ok) message.error(error(r.error));
                  router.refresh();
                }
              },
            }}
          >
            <Button>{t("更多")}</Button>
          </Dropdown>
        )}
      </Space>
      <Typography.Text copyable type="secondary" style={{ fontSize: 12 }}>
        {props.agent.id}
      </Typography.Text>
      {props.agent.description && <Typography.Paragraph style={{ marginTop: 8 }}>{props.agent.description}</Typography.Paragraph>}
      <Modal
        title={t("名稱與說明")}
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={async () => {
          const values = await form.validateFields();
          const r = await updateAgentMetaAction(props.agent.id, values);
          if (!r.ok) return message.error(error(r.error));
          setEditing(false);
          router.refresh();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t("名稱")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t("說明")}>
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
  fullscreen: boolean;
  onFullscreenChange: (open: boolean) => void;
  fillAvailableHeight: boolean;
  availableHeight: number | null;
}) {
  const { t } = useI18n();
  const multi = props.value.length > 1;
  const update = (i: number, patch: Partial<InstructionMessage>) =>
    props.onChange(props.value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const editor = (message: InstructionMessage, onChange: (content: string) => void, height: string) => typeof message.content === "string" ? <div className="instructions-monaco" style={{ height, flex: "none" }}><Editor height={height} defaultLanguage="markdown" value={message.content} onChange={(content) => onChange(content ?? "")} options={{ readOnly: props.readOnly, wordWrap: "on", minimap: { enabled: false }, lineNumbers: "on", fontSize: 14, scrollBeyondLastLine: false, unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false } }} /></div> : <Alert type="warning" title={t("這段訊息含有圖片或檔案，無法以文字編輯，也無法直接送出。請改寫成純文字內容。")} description={<pre style={{ maxHeight: 200, overflow: "auto" }}>{JSON.stringify(message.content, null, 2)}</pre>} />;

  return <div className={`instructions-editor-body${multi ? " is-multi" : ""}`}>
    {multi && <Alert type="info" title={t("這個 agent 有多段訊息。送給模型時會依序合併成一段 instructions。")} />}
    {props.value.map((message, index) => <div key={index} className="instructions-editor-message">
      {multi && <Space wrap style={{ marginBottom: 4 }}><Select size="small" value={message.role} disabled={props.readOnly} onChange={(role) => update(index, { role })} options={["developer", "system", "user", "assistant"].map((role) => ({ value: role, label: role }))} />{!props.readOnly && <Button size="small" danger type="link" onClick={() => props.onChange(props.value.filter((_, i) => i !== index))}>{t("刪除這段")}</Button>}</Space>}
      {editor(message, (content) => update(index, { content }), multi ? "40vh" : props.fillAvailableHeight ? props.availableHeight ? `${props.availableHeight}px` : "100%" : "65vh")}
    </div>)}
    {!props.readOnly && multi && <Button size="small" onClick={() => props.onChange([...props.value, { role: "developer", content: "" }])}>{t("新增一段")}</Button>}
    <Modal title={t("全螢幕編輯 Instructions")} open={props.fullscreen} width="96vw" zIndex={3000} style={{ maxWidth: "none", top: 12 }} styles={{ body: { height: "calc(100dvh - 140px)", padding: 0 } }} onCancel={() => props.onFullscreenChange(false)} footer={<Space wrap><Button onClick={() => downloadInstructions(props.value, "md")}>{t("匯出 Markdown")}</Button><Button onClick={() => downloadInstructions(props.value, "txt")}>{t("匯出 TXT")}</Button><Button type="primary" onClick={() => props.onFullscreenChange(false)}>{t("完成")}</Button></Space>}>
      <div className="instructions-fullscreen">{props.value.map((message, index) => <section key={index}>{multi && <Select value={message.role} disabled={props.readOnly} onChange={(role) => update(index, { role })} options={["developer", "system", "user", "assistant"].map((role) => ({ value: role, label: role }))} />}{editor(message, (content) => update(index, { content }), multi ? "32vh" : "calc(100dvh - 170px)")}</section>)}</div>
    </Modal>
  </div>;
}

function downloadInstructions(value: InstructionMessage[], format: "md" | "txt") {
  const multi = value.length > 1;
  const text = value.map((message) => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
    return format === "md" && multi ? `## ${message.role}\n\n${content}` : content;
  }).join(format === "md" && multi ? "\n\n---\n\n" : "\n\n");
  const blob = new Blob([text], { type: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `instructions.${format}`; link.click(); URL.revokeObjectURL(url);
}

function InstructionsToolbar(props: {
  value: InstructionMessage[];
  readOnly: boolean;
  onChange: (value: InstructionMessage[]) => void;
  onFullscreenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [pendingImport, setPendingImport] = useState<InstructionMessage[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  async function importFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    // Only treat a horizontal rule as an exported message boundary when the next
    // non-empty line is one of our explicit role headings. Preserve ordinary HRs.
    const sections = text.split(/^---\s*\r?\n(?=##\s+(?:developer|system|user|assistant)\s*$)/gim).map((part) => part.trim()).filter(Boolean);
    const messages: InstructionMessage[] = [];
    for (const section of sections) {
      const match = section.match(/^##\s+(developer|system|user|assistant)\s*\r?\n([\s\S]*)$/i);
      messages.push({ role: (match?.[1]?.toLowerCase() as InstructionMessage["role"]) ?? "developer", content: match ? match[2].trim() : section });
    }
    setPendingImport(messages.length ? messages : [{ role: "developer", content: "" }]);
  }
  return <div className="instructions-tab-actions">
    <Button type="text" shape="circle" icon={<FullscreenOutlined />} aria-label={props.readOnly ? t("全螢幕檢視") : t("全螢幕編輯")} title={props.readOnly ? t("全螢幕檢視") : t("全螢幕編輯")} onClick={() => props.onFullscreenChange(true)} />
    <Dropdown menu={{ items: [
      { key: "export-md", label: t("匯出 Markdown"), onClick: () => downloadInstructions(props.value, "md") },
      { key: "export-txt", label: t("匯出 TXT"), onClick: () => downloadInstructions(props.value, "txt") },
      ...(!props.readOnly ? [{ key: "import", label: t("匯入 MD／TXT"), onClick: () => fileInputRef.current?.click() }] : []),
    ] }}><Button type="text" shape="circle" icon={<FileTextOutlined />} aria-label={t("匯入／匯出")} title={t("匯入／匯出")} /></Dropdown>
    {!props.readOnly && <input ref={fileInputRef} hidden type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />}
    <Modal title={t("匯入 Instructions？")} open={pendingImport !== null} okText={t("取代內容")} cancelText={t("取消")} onCancel={() => setPendingImport(null)} onOk={() => { if (pendingImport) props.onChange(pendingImport); setPendingImport(null); }}><Typography.Paragraph>{t("匯入會取代目前所有 Instructions。Markdown 的 ## developer／system／user／assistant 標題會還原成訊息段落，其餘文字會匯入為 developer。")}</Typography.Paragraph></Modal>
  </div>;
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
  const { t } = useI18n();
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
      <Form.Item label={t("模型")} htmlFor="agent-model" required>
        <Select
          id="agent-model"
          aria-label={t("模型")}
          placeholder={t("選擇模型或輸入模型 ID")}
          value={props.model || undefined}
          options={models.map((model) => ({
            value: model,
            label: model === modelSearch.trim() && model !== props.model && !props.suggestions.includes(model)
              ? t("使用 {0}", [model])
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
          <Form.Item label={t("推理強度 (reasoning.effort)")} extra={t("只有推理模型適用")}>
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
          <Form.Item label={t("回覆詳細程度 (text.verbosity)")}>
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
          <Form.Item label={t("最大輸出 tokens")}>
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
            label: t("進階：以 JSON 編輯全部參數"),
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
                        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("必須是物件"));
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

// A proxy can answer with an HTML error page, so a body that is not JSON is not an error to show.
async function readJson<T>(response: Response): Promise<Partial<T>> {
  return response.json().catch(() => ({})) as Promise<Partial<T>>;
}

// Statuses that retrying cannot fix: waiting out the deadline would only hide them.
const permanentStatuses = new Set([401, 403, 404, 409, 503]);

async function waitForSearchIndex(endpoint: string, id: string) {
  const query = new URLSearchParams({ store: id });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`${endpoint}?${query}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!response) continue;
    const result = await readJson<{ status: string; error: string }>(response);
    if (response.ok && (result.status === "ready" || result.status === "failed")) return result.status;
    if (permanentStatuses.has(response.status)) throw new Error(result.error || "暫時無法確認檔案索引，請稍後再試");
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
  const { t, rich, error: translateUploadError } = useI18n();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [text, setText] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"uploading" | "indexing" | null>(null);
  const [pendingIndex, setPendingIndex] = useState<ToolUploadAttachment>();
  const uploading = uploadStatus !== null;
  const { message } = App.useApp();
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
    message.success(t("已加入 {0} 個檔案", [uploads.reduce((count, item) => count + item.names.length, 0)]));
  }

  async function checkIndex(attachment: ToolUploadAttachment) {
    setPendingIndex(attachment);
    setUploadStatus("indexing");
    try {
      const status = await waitForSearchIndex(endpoint, attachment.id);
      if (status === "indexing") {
        message.info(t("檔案仍在建立索引，可以重新檢查進度。"));
        return;
      }
      setPendingIndex(undefined);
      if (status === "ready") addUploads([attachment]);
      else message.error(t("檔案無法建立索引，請確認格式後再上傳。"));
    } catch (issue) {
      // The index cannot be checked, so keeping the pending state would only offer a check that fails again.
      setPendingIndex(undefined);
      message.error(issue instanceof Error ? translateUploadError(issue.message) : t("暫時無法確認檔案索引，請稍後再試"));
    } finally {
      setUploadStatus(null);
    }
  }

  async function upload(files: File[]) {
    if (!attachments || uploading || pendingIndex || !files.length) return;
    if (files.length > maxToolUploadCount || files.some((file) => !file.size) ||
        files.reduce((total, file) => total + file.size, 0) > maxToolUploadBytes) {
      message.error(t("每次可上傳 1 至 {0} 個非空白檔案，總大小上限為 10 MB", [maxToolUploadCount]));
      return;
    }
    if (isFile && attachments.refs.length + files.length > maxToolFiles) {
      message.error(t("最多可加入 {0} 個檔案，請減少這次選取的檔案", [maxToolFiles]));
      return;
    }
    setUploadStatus("uploading");
    const body = new FormData();
    body.set("mode", isFile ? "file" : "search");
    for (const file of files) body.append("file", file);
    try {
      const response = await fetch(endpoint, { method: "POST", body });
      const result = await readJson<{
        attachments: ToolUploadAttachment[];
        error: string;
        status: "ready" | "indexing";
      }>(response);
      if (!response.ok || !result.attachments?.length) {
        throw new Error(result.error || (response.status === 413 ? "每次上傳的檔案總大小上限為 10 MB" : "無法上傳檔案"));
      }
      if (result.status === "indexing") {
        await checkIndex(result.attachments[0]);
      } else {
        addUploads(result.attachments);
      }
    } catch (error) {
      message.error(error instanceof Error ? translateUploadError(error.message) : t("無法上傳檔案"));
    } finally {
      setUploadStatus(null);
    }
  }

  const availableGroups: {
    key: string;
    title: string;
    items: { key: string; name: string; tool: Record<string, unknown>; configuredIndex?: number; createOnly?: boolean; description?: string; unsupported?: boolean }[];
  }[] = [
    { key: "built-in", title: t("內建工具"), items: [
      { key: "code_interpreter", name: t("程式碼直譯器"), tool: { type: "code_interpreter", container: { type: "auto" } } },
      { key: "shell", name: "Hosted Shell", tool: { type: "shell", environment: { type: "container_auto" } } },
    ] },
    { key: "files", title: t("檔案與搜尋"), items: [
      { key: "file_search", name: t("檔案搜尋"), tool: { type: "file_search", vector_store_ids: [] } },
    ] },
    { key: "custom", title: t("自訂函式"), items: [
      ...runtimeFunctions.map((runtime) => ({ key: `runtime-${runtime.name}`, name: runtime.name, tool: runtime.tool, description: t(runtime.description) })),
      ...props.tools.flatMap((configured, index) => configured.type === "function" && !runtimeFunctionNames.has(String(configured.name)) ? [{
        key: `function-${index}`,
        name: String(configured.name || t("自訂函式")),
        tool: configured,
        configuredIndex: index,
        description: t("執行環境沒有此函式的處理程式，模型呼叫時只會得到「Unknown tool」。"),
        unsupported: true,
      }] : []),
      { key: "custom_function", name: t("新增自訂函式"), tool: { type: "function", name: "", description: "", parameters: { type: "object", properties: {} } }, createOnly: true },
    ] },
    { key: "integrations", title: t("外部整合"), items: props.templates.filter((template) => template.tool.type === "mcp").map((template) => ({ key: template.key, name: toolLabel(template.tool), tool: template.tool })) },
    { key: "other", title: t("其他工具"), items: props.templates.filter((template) => !["mcp", "function", "code_interpreter", "shell", "file_search"].includes(String(template.tool.type))).map((template) => ({ key: template.key, name: toolLabel(template.tool), tool: template.tool })) },
  ];
  function configuredIndex(item: (typeof availableGroups)[number]["items"][number]) {
    if (item.createOnly) return -1;
    if (item.configuredIndex !== undefined) return item.configuredIndex;
    return props.tools.findIndex((configured) => toolLabel(configured) === toolLabel(item.tool));
  }

  return (
    <>
      <section className="available-tools-section">
        <Typography.Title level={5}>{t("可用工具")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("展開分類，使用開關管理工具。")}</Typography.Paragraph>
        <Collapse items={availableGroups.filter((group) => group.items.length > 0).map((group) => ({
          key: group.key,
          label: <Space><span>{group.title}</span>{group.items.some((item) => !item.createOnly) && <Tag>{group.items.filter((item) => configuredIndex(item) >= 0).length}/{group.items.filter((item) => !item.createOnly).length}</Tag>}</Space>,
          children: <div className="available-tools-list">{group.items.map((item) => {
            const activeIndex = configuredIndex(item);
            const enabled = activeIndex >= 0;
            return <article className={`available-tool-row${enabled ? " is-enabled" : ""}`} key={item.key}>
              <div className="enabled-tool-info"><strong>{item.name}</strong><Typography.Text type="secondary">{String(item.tool.type)}</Typography.Text>{enabled && <Tag color="blue">{t("已啟用")}</Tag>}{item.unsupported && <Tag color="warning">{t("執行環境不會執行")}</Tag>}{item.description && <Typography.Text type="secondary" className="available-tool-description">{item.description}</Typography.Text>}</div>
              <Space wrap>
                {enabled && <Button type="link" size="small" onClick={() => open(activeIndex, props.tools[activeIndex])}>{props.readOnly ? t("檢視") : t("設定")}</Button>}
                {item.createOnly ? <Button disabled={props.readOnly} onClick={() => open("new", item.tool)}>{t("建立並設定")}</Button> : <Switch
                  checked={enabled}
                  disabled={props.readOnly}
                  aria-label={`${item.name} ${enabled ? t("已啟用") : t("未啟用")}`}
                  onChange={(checked) => {
                    if (!checked && activeIndex >= 0) props.onChange(props.tools.filter((_, index) => index !== activeIndex));
                    else if (checked && activeIndex < 0) {
                      if (item.tool.type === "file_search" || item.tool.type === "code_interpreter" || item.tool.type === "shell") open("new", item.tool);
                      else props.onChange([...props.tools, structuredClone(item.tool)]);
                    }
                  }}
                />}
              </Space>
            </article>;
          })}</div>,
        }))} />
      </section>
      <Modal
        width={760}
        title={editing === "new" ? t("新增工具") : t("工具設定")}
        open={editing !== null}
        onCancel={() => { if (!uploading) setEditing(null); }}
        closable={!uploading}
        keyboard={!uploading}
        mask={{ closable: !uploading }}
        cancelButtonProps={{ disabled: uploading }}
        okText={t("套用")}
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
              label={isFile ? t("已附加的檔案") : t("搜尋資料來源")}
              htmlFor="tool-attachment-ids"
              extra={props.canUpload ? undefined : t("如已有同專案的識別碼，可以直接輸入並按 Enter 加入。")}
            >
              <Select
                id="tool-attachment-ids"
                aria-label={isFile ? t("附件檔案 ID") : t("向量資料庫 ID")}
                mode="tags"
                value={attachments.refs}
                options={attachments.refs.map((id) => ({ value: id, label: names[id]?.join("、") || id }))}
                maxTagTextLength={60}
                disabled={props.readOnly || uploading}
                onChange={(ids: string[]) => {
                  const pattern = isFile ? toolFileId : toolVectorStoreId;
                  if (ids.some((id) => !pattern.test(id) && !attachments.refs.includes(id))) {
                    message.error(isFile ? t("請輸入有效的檔案 ID") : t("請輸入有效的向量資料庫 ID"));
                    return;
                  }
                  if (isFile && ids.length > maxToolFiles && ids.length > attachments.refs.length) {
                    message.error(t("最多可加入 {0} 個檔案", [maxToolFiles]));
                    return;
                  }
                  setText(JSON.stringify(withAttachmentNames(attachments.apply(ids), ids, names), null, 2));
                }}
              />
            </Form.Item>
            {!props.readOnly && (
              props.canUpload ? (
                <Form.Item
                  label={t("上傳本機檔案")}
                  htmlFor="tool-upload-file"
                  extra={isFile ? t("每次最多 10 個檔案，總大小 10 MB。") : t("每次最多 10 個檔案，總大小 10 MB。同一批檔案會一起加入搜尋。")}
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
                  {uploading && <span role="status">{" "}{uploadStatus === "indexing" ? t("正在建立搜尋索引…") : t("上傳中…")}</span>}
                  {pendingIndex && !uploading && (
                    <Space wrap>
                      <Button type="link" onClick={() => void checkIndex(pendingIndex)}>{t("重新檢查索引")}</Button>
                      <Button type="link" onClick={() => setPendingIndex(undefined)}>{t("略過這批檔案")}</Button>
                    </Space>
                  )}
                </Form.Item>
              ) : (
                <Typography.Paragraph type="secondary">{t("此專案尚未啟用本機上傳。")}</Typography.Paragraph>
              )
            )}
          </Form>
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {rich("MCP 等需要憑證的欄位請填 {0}，由管理員在「管理 / 憑證」設定實際值，不要直接貼上金鑰。", [<code key="secret">{"{{secret:name}}"}</code>])}</Typography.Paragraph>
        <div style={{ border: "1px solid #e5e7eb" }}>
          <Editor
            height="50vh"
            defaultLanguage="json"
            value={text}
            onChange={(v) => setText(v ?? "")}
            options={{ readOnly: props.readOnly || uploading || !!pendingIndex, minimap: { enabled: false }, fontSize: 13 }}
          />
        </div>
        {error && <Typography.Text type="danger">{translateUploadError(error)}</Typography.Text>}
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
  const { t, error, locale } = useI18n();
  const router = useRouter();
  const { message } = App.useApp();
  return (
    <Card className="version-history-card" title={<Space size={8}><span>{t("版本")}</span><Tag className="version-history-count">{props.versions.length}</Tag></Space>} size="small">
      <div className="version-history-list">
        {props.versions.map((v) => (
          <div key={v.version} className={`version-history-item${v.version === props.selected ? " is-selected" : ""}`}>
            <button type="button" className="version-history-main" onClick={() => props.onOpen(v.version)} aria-current={v.version === props.selected ? "true" : undefined}>
              <div className="version-history-item-heading">
                <Space size={6} wrap>
                  <strong>v{v.version}</strong>
                  {v.version === props.published && <Tag color="blue">{t("發布中")}</Tag>}
                  {v.source === "openai-import" && <Tag className="version-source-tag">{t("OpenAI 匯入")}</Tag>}
                </Space>
              </div>
              <div className="version-history-meta">
                <span>{new Date(v.createdAt).toLocaleString(locale === "zh-Hant" ? "zh-TW" : locale, { hour12: false, timeZone: "Asia/Taipei" })}</span>
                <span>{v.createdBy ?? "OpenAI"}</span>
                <span>{v.model}</span>
              </div>
              {v.note && <div className="version-history-note">{v.note}</div>}
            </button>
            <div className="version-history-actions">
              {props.versions.length > 1 && (
                <Link
                  className="version-history-icon-action"
                  href={`/agents/${props.agentId}/compare?a=${v.version === props.published || props.published === null ? Math.max(1, v.version - 1) : props.published}&b=${v.version}`}
                  aria-label={`${t("比對")} v${v.version}`}
                  title={`${t("比對")} v${v.version}`}
                >
                  <DiffOutlined aria-hidden="true" />
                </Link>
              )}
              {props.canEdit && v.version !== props.published && (
                <Popconfirm
                  title={t("把 v{0} 設為發布中？", [v.version])}
                  description={t("學生端下一次對話就會使用這個版本。")}
                  onConfirm={async () => {
                    const r = await publishVersionAction(props.agentId, v.version);
                    if (!r.ok) message.error(error(r.error));
                    else message.success(t("已發布 v{0}", [v.version]));
                    router.refresh();
                  }}
                >
                  <Button type="text" size="small" icon={<CloudUploadOutlined />} aria-label={`${t("發布")} v${v.version}`} title={`${t("發布")} v${v.version}`} />
                </Popconfirm>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
