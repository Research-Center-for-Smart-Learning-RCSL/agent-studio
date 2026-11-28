"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Segmented, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { formatTaipei } from "@/lib/format-time";
import { logPageSize, responseStillWanted, type PageRequest } from "@/lib/request-log-query";

type Entry = {
  id: number;
  ts: string;
  source: string;
  event: string;
  route: string | null;
  status: number | null;
  ms: number | null;
  projectId: string | null;
  agentId: string | null;
  detail: Record<string, unknown> | null;
};
type Summary = { source: string; event: string; total: number; failures: number };
type Result = { rows: Entry[]; hasMore: boolean; summary: Summary[] };

const events = ["request", "request_error", "action_failed", "logs_usage_failed", "device_request"];

function statusColor(status: number | null) {
  if (status === null) return undefined;
  return status >= 500 ? "red" : status >= 400 ? "orange" : "green";
}

export function RequestLogsTab() {
  const { t, locale } = useI18n();
  const [source, setSource] = useState("all");
  const [range, setRange] = useState("24h");
  const [event, setEvent] = useState<string | undefined>();
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [auto, setAuto] = useState(false);
  const [rows, setRows] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const busy = useRef(false);
  const lastId = useRef<number | null>(null);
  const loadedRows = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    loadedRows.current = rows.length;
    lastId.current = rows.length ? rows[rows.length - 1].id : null;
  }, [rows]);

  const query = useCallback(
    (before?: number) => {
      const params = new URLSearchParams({ source, range });
      if (event) params.set("event", event);
      if (errorsOnly) params.set("errors", "1");
      if (applied) params.set("q", applied);
      if (before) params.set("before", String(before));
      return params.toString();
    },
    [source, range, event, errorsOnly, applied],
  );

  const fetchPage = useCallback(
    async (before?: number) => {
      const response = await fetch(`/api/admin/request-logs?${query(before)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as Result;
    },
    [query],
  );

  /** Loads the first page. A newer reload, or a filter change, makes this answer stale. */
  const loadFirst = useCallback(async () => {
    const sent: PageRequest = { generation: ++generation.current, cursor: null };
    busy.current = true;
    setLoading(true);
    try {
      const result = await fetchPage();
      if (!responseStillWanted(sent, { generation: generation.current, cursor: null })) return;
      setRows(result.rows);
      setSummary(result.summary);
      setHasMore(result.hasMore);
      setError(undefined);
    } catch (failure) {
      if (responseStillWanted(sent, { generation: generation.current, cursor: null })) setError((failure as Error).message);
    } finally {
      if (sent.generation === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [fetchPage]);

  /** Appends the page after the last row shown; it never cancels or replaces a reload. */
  const loadMore = useCallback(async () => {
    const cursor = lastId.current;
    if (cursor === null || busy.current) return;
    const sent: PageRequest = { generation: generation.current, cursor };
    busy.current = true;
    setLoading(true);
    try {
      const result = await fetchPage(cursor);
      if (!responseStillWanted(sent, { generation: generation.current, cursor: lastId.current })) return;
      setRows((previous) => [...previous, ...result.rows]);
      setHasMore(result.hasMore);
      setError(undefined);
    } catch (failure) {
      if (responseStillWanted(sent, { generation: generation.current, cursor: lastId.current })) setError((failure as Error).message);
    } finally {
      if (sent.generation === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [fetchPage]);

  /** A filter change drops what is shown at once, so "load more" can never continue the old list under the new filters. */
  const changeFilter = (apply: () => void) => {
    generation.current += 1;
    busy.current = false;
    setRows([]);
    setHasMore(false);
    apply();
  };

  // Reload whenever a filter changes.
  useEffect(() => {
    const timer = setTimeout(() => void loadFirst(), 0);
    return () => clearTimeout(timer);
  }, [loadFirst]);

  useEffect(() => {
    if (!auto) return;
    // A refresh reloads the first page, so it waits while another request runs, skips a list the person paged
    // further into, and does nothing while this tab is not on screen (a hidden pane or another browser tab).
    const timer = setInterval(() => {
      const visible = !document.hidden && container.current !== null && container.current.offsetParent !== null;
      if (visible && !busy.current && loadedRows.current <= logPageSize) void loadFirst();
    }, 10_000);
    return () => clearInterval(timer);
  }, [auto, loadFirst]);

  const total = summary.reduce((sum, s) => sum + s.total, 0);
  const failures = summary.reduce((sum, s) => sum + s.failures, 0);

  return (
    <div ref={container}>
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("Studio 與後端裝置端點的請求與錯誤紀錄，保留 30 天。內容含呼叫端位址與金鑰指紋，僅系統管理員可見。")}
      </Typography.Paragraph>
      <Space wrap>
        <Segmented
          aria-label={t("來源")}
          value={source}
          onChange={(value) => changeFilter(() => setSource(String(value)))}
          options={[
            { value: "all", label: t("全部") },
            { value: "studio", label: "Studio" },
            { value: "backend", label: t("後端") },
          ]}
        />
        <Select
          aria-label={t("時間範圍")}
          value={range}
          onChange={(value) => changeFilter(() => setRange(value))}
          style={{ width: 120 }}
          options={[
            { value: "1h", label: t("近 1 小時") },
            { value: "24h", label: t("近 24 小時") },
            { value: "7d", label: t("近 7 天") },
            { value: "30d", label: t("近 30 天") },
          ]}
        />
        <Select
          allowClear
          aria-label={t("事件")}
          placeholder={t("事件")}
          value={event}
          onChange={(value) => changeFilter(() => setEvent(value))}
          style={{ width: 180 }}
          options={events.map((value) => ({ value, label: value }))}
        />
        <Checkbox checked={errorsOnly} onChange={(e) => changeFilter(() => setErrorsOnly(e.target.checked))}>
          {t("只看錯誤")}
        </Checkbox>
        <Input.Search
          allowClear
          aria-label={t("搜尋")}
          placeholder={t("路徑、Agent、專案、原因、IP")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value === "" && applied !== "") changeFilter(() => setApplied(""));
          }}
          onSearch={(value) => {
            const next = value.trim();
            if (next === applied) void loadFirst();
            else changeFilter(() => setApplied(next));
          }}
          style={{ width: 280 }}
        />
        <Button onClick={() => void loadFirst()} loading={loading}>
          {t("重新整理")}
        </Button>
        <Space size={4}>
          <Switch size="small" checked={auto} onChange={setAuto} aria-label={t("每 10 秒自動更新")} />
          <span>{t("每 10 秒自動更新")}</span>
        </Space>
      </Space>
      <Space wrap size={[8, 4]}>
        <Tag>{t("此範圍共 {0} 筆", [total])}</Tag>
        <Tag color={failures ? "red" : "green"}>{t("此範圍錯誤 {0}", [failures])}</Tag>
        {summary.map((s) => (
          <Tag key={`${s.source}/${s.event}`}>
            {s.source}/{s.event} {s.total}
            {s.failures ? ` (${s.failures})` : ""}
          </Tag>
        ))}
      </Space>
      {error && <Alert type="error" showIcon title={t("讀取紀錄失敗（{0}）", [error])} />}
      <Table<Entry>
        size="small"
        rowKey="id"
        loading={loading && rows.length === 0}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        expandable={{ rowExpandable: (r) => r.detail !== null, expandedRowRender: (r) => <code style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(r.detail)}</code> }}
        columns={[
          { title: t("時間"), width: 170, render: (_, r) => formatTaipei(r.ts, locale) },
          { title: t("來源"), width: 90, render: (_, r) => <Tag>{r.source}</Tag> },
          { title: t("事件"), dataIndex: "event", width: 150 },
          { title: t("路徑"), dataIndex: "route" },
          { title: t("狀態"), width: 80, render: (_, r) => (r.status === null ? null : <Tag color={statusColor(r.status)}>{r.status}</Tag>) },
          { title: t("耗時 (ms)"), dataIndex: "ms", width: 100 },
          { title: t("專案"), dataIndex: "projectId", width: 160 },
          { title: "Agent", dataIndex: "agentId", width: 220 },
          { title: t("原因"), render: (_, r) => String(r.detail?.reason ?? r.detail?.message ?? "") },
        ]}
      />
      {hasMore && (
        <Button onClick={() => void loadMore()} loading={loading}>
          {t("載入更多")}
        </Button>
      )}
    </Space>
    </div>
  );
}
