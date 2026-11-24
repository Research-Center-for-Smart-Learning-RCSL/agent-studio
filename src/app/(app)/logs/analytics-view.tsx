"use client";
import { useState } from "react";
import { Button, Input, Spin, Table } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { taipeiDayEnd } from "@/lib/logs-format";
import { useLogsResource } from "./logs-client";
import { ErrorNote } from "./logs-ui";
import styles from "./logs.module.css";

type Figures = {
  failure_rate: number | null; failures: number; latency_p50_ms: number | null; latency_p95_ms: number | null; no_response: number;
  speech_cancelled: number; speech_events: number; speech_failures: number; tts_calls: number; tts_repeat_rate: number | null;
  tts_repeats: number; turns: number;
};
type KeyFigures = Figures & { key: string | null };
type DayFigures = Figures & { day: string };
type RuntimeFigures = {
  runtime: string; turns: number; conversations: number; robots: number; failures: number; failure_rate: number | null;
  latency_p50_ms: number | null; latency_p95_ms: number | null; no_input: number; tts_calls: number; tts_p50_ms: number | null;
  tts_p95_ms: number | null; tts_ms_per_char: number | null;
};
type Summary = {
  since: string; until: string; computed_at: string | null; totals: Figures; days: DayFigures[];
  by_prompt: KeyFigures[]; by_robot: KeyFigures[]; by_runtime: RuntimeFigures[];
};
type Latency = {
  tts: { calls: number; duration_p50_ms: number | null; duration_p90_ms: number | null; first_byte_p50_ms: number | null; first_byte_p90_ms: number | null };
  web_by_endpoint: { key: string | null; turns: number; total_p50_ms: number | null; total_p90_ms: number | null; upstream_p50_ms: number | null; upstream_p90_ms: number | null }[];
};

const TAIPEI_MS = 8 * 3600_000;
const number = new Intl.NumberFormat();
const num = (value: number | null) => value === null ? "-" : number.format(value);
const ms = (value: number | null) => value === null ? "-" : value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${number.format(value)} ms`;
const pct = (value: number | null) => value === null ? "-" : `${(value * 100).toFixed(1)}%`;

function lastDays(n: number) {
  const today = new Date(Date.now() + TAIPEI_MS);
  const first = new Date(today.getTime() - (n - 1) * 86400_000);
  return { since: first.toISOString().slice(0, 10), until: today.toISOString().slice(0, 10) };
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.muted}>{label}</span>
      <strong>{value}</strong>
      {note && <span className={styles.sub}>{note}</span>}
    </div>
  );
}

/** Turns per day, with the failed share on top. */
function DayBars({ days }: { days: DayFigures[] }) {
  const { t } = useI18n();
  const top = Math.max(1, ...days.map((d) => d.turns));
  const width = Math.max(days.length * 14, 120);
  return (
    <svg role="img" aria-label={t("每日回合數")} viewBox={`0 0 ${width} 90`} className={styles.bars} preserveAspectRatio="none">
      {days.map((d, i) => {
        const height = (d.turns / top) * 80;
        const failed = (d.failures / top) * 80;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.turns} / ${d.failures}`}</title>
            <rect x={i * 14 + 2} y={85 - height} width={10} height={Math.max(height - failed, 0)} className={styles.barOk} />
            <rect x={i * 14 + 2} y={85 - failed} width={10} height={failed} className={styles.barFailed} />
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsView() {
  const { t } = useI18n();
  const [range, setRange] = useState(() => lastDays(30));
  const params = { since: range.since, until: range.until && range.since <= range.until ? taipeiDayEnd(range.until).slice(0, 10) : undefined };
  const bad = range.since !== "" && range.until !== "" && range.since > range.until;
  const summary = useLogsResource<Summary>(bad ? null : "/v1/analytics/summary", params);
  const latency = useLogsResource<Latency>(bad ? null : "/v1/analytics/latency", params);
  const totals = summary.data?.totals;

  const keyColumns = (title: string) => [
    { title, dataIndex: "key", render: (v: string | null) => v ?? <span className={styles.muted}>{t("未知")}</span> },
    { title: t("回合"), dataIndex: "turns", render: num },
    { title: t("失敗率"), dataIndex: "failure_rate", render: pct },
    { title: "p50", dataIndex: "latency_p50_ms", render: ms },
    { title: "p95", dataIndex: "latency_p95_ms", render: ms },
  ];
  return (
    <div className={styles.page}>
      <div className={styles.filters}>
        <Input style={{ width: 150 }} type="date" value={range.since} aria-label={t("起日")} onChange={(e) => setRange({ ...range, since: e.target.value })} />
        <Input style={{ width: 150 }} type="date" value={range.until} aria-label={t("迄日")} onChange={(e) => setRange({ ...range, until: e.target.value })} />
        {[7, 30, 90].map((n) => <Button key={n} type="link" onClick={() => setRange(lastDays(n))}>{t("最近 {0} 天", [n])}</Button>)}
      </div>
      <p className={styles.sub}>{t("分析涵蓋所有專案，只有管理員可以查看，不受上方專案篩選影響。")}</p>
      {summary.error && <ErrorNote error={summary.error} onRetry={summary.reload} />}
      {summary.loading && !bad && <Spin />}
      {totals && summary.data && (
        <>
          <div className={styles.tiles}>
            <Tile label={t("回合")} value={num(totals.turns)} />
            <Tile label={t("失敗率")} value={pct(totals.failure_rate)} note={t("{0} 次失敗，{1} 次無回應", [num(totals.failures), num(totals.no_response)])} />
            <Tile label={t("回覆時間 p50")} value={ms(totals.latency_p50_ms)} />
            <Tile label={t("回覆時間 p95")} value={ms(totals.latency_p95_ms)} />
            <Tile label={t("語音合成呼叫")} value={num(totals.tts_calls)} note={t("重複率 {0}", [pct(totals.tts_repeat_rate)])} />
            <Tile label={t("語音事件")} value={num(totals.speech_events)} note={t("{0} 次失敗", [num(totals.speech_failures)])} />
          </div>
          <div className={styles.panel}>
            <DayBars days={summary.data.days} />
            <span className={styles.sub}>{t("深色為成功，紅色為失敗")}</span>
          </div>
          <Table<RuntimeFigures>
            rowKey="runtime"
            size="small"
            pagination={false}
            title={() => t("依執行環境")}
            dataSource={summary.data.by_runtime}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("執行環境"), dataIndex: "runtime", render: (v: string) => v === "robot" ? t("機器人") : t("網頁") },
              { title: t("回合"), dataIndex: "turns", render: num },
              { title: t("對話"), dataIndex: "conversations", render: num },
              { title: t("機器人"), dataIndex: "robots", render: num },
              { title: t("失敗率"), dataIndex: "failure_rate", render: pct },
              { title: "p50", dataIndex: "latency_p50_ms", render: ms },
              { title: "p95", dataIndex: "latency_p95_ms", render: ms },
              { title: t("語音合成 p50"), dataIndex: "tts_p50_ms", render: ms },
            ]}
          />
          <Table<KeyFigures> rowKey={(r) => r.key ?? ""} size="small" pagination={false} title={() => t("依 Agent（prompt id）")} dataSource={summary.data.by_prompt} scroll={{ x: "max-content" }} columns={keyColumns("Prompt")} />
          <Table<KeyFigures> rowKey={(r) => r.key ?? ""} size="small" pagination={false} title={() => t("依機器人")} dataSource={summary.data.by_robot} scroll={{ x: "max-content" }} columns={keyColumns(t("機器人序號"))} />
        </>
      )}
      {latency.error && <ErrorNote error={latency.error} onRetry={latency.reload} />}
      {latency.data && (
        <>
          <div className={styles.tiles}>
            <Tile label={t("語音合成首位元組 p50")} value={ms(latency.data.tts.first_byte_p50_ms)} note={`p90 ${ms(latency.data.tts.first_byte_p90_ms)}`} />
            <Tile label={t("語音合成總時間 p50")} value={ms(latency.data.tts.duration_p50_ms)} note={`p90 ${ms(latency.data.tts.duration_p90_ms)}`} />
          </div>
          <Table<Latency["web_by_endpoint"][number]>
            rowKey={(r) => r.key ?? ""}
            size="small"
            pagination={false}
            title={() => t("網頁回合的時間分布")}
            dataSource={latency.data.web_by_endpoint}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("端點"), dataIndex: "key", render: (v: string | null) => v ?? "-" },
              { title: t("回合"), dataIndex: "turns", render: num },
              { title: t("總時間 p50"), dataIndex: "total_p50_ms", render: ms },
              { title: t("總時間 p90"), dataIndex: "total_p90_ms", render: ms },
              { title: t("上游 p50"), dataIndex: "upstream_p50_ms", render: ms },
              { title: t("上游 p90"), dataIndex: "upstream_p90_ms", render: ms },
            ]}
          />
        </>
      )}
    </div>
  );
}
