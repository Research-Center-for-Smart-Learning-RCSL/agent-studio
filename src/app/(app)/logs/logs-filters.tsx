"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Checkbox, Input, Select } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { badRange, emptyFilters, filterParams, type ListFilters } from "@/lib/logs-format";
import { useLogsResource } from "./logs-client";
import { SearchSyntaxHelp } from "./logs-ui";
import styles from "./logs.module.css";

const keys = Object.keys(emptyFilters) as (keyof ListFilters)[];

/** The list's filters live in the address, so Back from a conversation returns to the same search. */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = useMemo(() => {
    const next = { ...emptyFilters };
    for (const key of keys) next[key] = search.get(key) ?? "";
    return next;
  }, [search]);
  const set = useCallback((patch: Partial<ListFilters>) => {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, search]);
  const params = useMemo(() => filterParams(filters), [filters]);
  // Clearing the filters keeps the record open beside the list (the turn it was opened on).
  const reset = () => {
    const turn = search.get("turn");
    router.replace(turn ? `${pathname}?turn=${encodeURIComponent(turn)}` : pathname, { scroll: false });
  };
  return { filters, params, set, reset, bad: badRange(filters) };
}

/** Text that is applied on Enter or when it loses focus, not on every keystroke. */
type RobotOption = { serial: string; name: string | null };

/** Robots are picked by name; a serial that has no name, or is not among the recent ones, is still matched by its serial. */
function RobotSelect({ value, onChange }: { value: string; onChange: (robot: string) => void }) {
  const { t } = useI18n();
  const robots = useLogsResource<{ items: RobotOption[] }>("/v1/robots");
  const options = (robots.data?.items ?? [])
    .filter((robot) => !robot.serial.startsWith("temp-"))
    .map((robot) => ({ value: robot.serial, label: robot.name ?? robot.serial, serial: robot.serial }));
  const known = options.find((option) => option.value === value);
  return (
    <Select
      showSearch
      allowClear
      style={{ width: 190 }}
      placeholder={t("機器人名稱")}
      aria-label={t("機器人名稱")}
      loading={robots.loading}
      value={value || undefined}
      onChange={(robot) => onChange(robot ?? "")}
      options={value && !known ? [{ value, label: value, serial: value }, ...options] : options}
      optionRender={(option) => (
        <span>{option.label}{option.data.serial !== option.label && <span className={styles.sub}>{option.data.serial}</span>}</span>
      )}
      filterOption={(input, option) => `${option?.label ?? ""} ${option?.serial ?? ""}`.toLowerCase().includes(input.trim().toLowerCase())}
    />
  );
}

function CommitInput({ value, onCommit, ...props }: { value: string; onCommit: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState<{ from: string; text: string }>({ from: value, text: value });
  // A change from outside (Clear, Back) replaces what was being typed.
  const text = draft.from === value ? draft.text : value;
  const commit = () => { if (text.trim() !== value) onCommit(text.trim()); };
  return <Input {...props} value={text} onChange={(e) => setDraft({ from: value, text: e.target.value })} onPressEnter={commit} onBlur={commit} />;
}

export function FilterBar({ filters, set, reset, bad, showStatus = false, showKind = false, searchPlaceholder }: {
  filters: ListFilters; set: (patch: Partial<ListFilters>) => void; reset: () => void; bad: boolean; showStatus?: boolean; showKind?: boolean; searchPlaceholder: string;
}) {
  const { t } = useI18n();
  const active = keys.some((key) => filters[key] !== "");
  return (
    <div>
      <div className={styles.filters} role="search">
        <CommitInput className={styles.search} allowClear value={filters.q} placeholder={searchPlaceholder} aria-label={t("搜尋")} onCommit={(q) => set({ q })} />
        <Select
          style={{ width: 130 }}
          allowClear
          placeholder={t("執行環境")}
          value={filters.runtime || undefined}
          onChange={(runtime) => set({ runtime: runtime ?? "" })}
          options={[{ value: "robot", label: t("機器人") }, { value: "web", label: t("網頁") }]}
        />
        {showKind && (
          <Select
            style={{ width: 150 }}
            allowClear
            placeholder={t("語音種類")}
            value={filters.kind || undefined}
            onChange={(kind) => set({ kind: kind ?? "" })}
            options={[{ value: "stt", label: t("語音轉文字") }, { value: "tts", label: t("文字轉語音") }]}
          />
        )}
        {showStatus && (
          <Select
            style={{ width: 130 }}
            allowClear
            placeholder={t("狀態")}
            value={filters.status || undefined}
            onChange={(status) => set({ status: status ?? "" })}
            options={[{ value: "ok", label: t("成功") }, { value: "failed", label: t("失敗") }, { value: "no_response", label: t("無回應") }]}
          />
        )}
        <RobotSelect value={filters.robot} onChange={(robot) => set({ robot })} />
        <Input style={{ width: 150 }} type="date" value={filters.since} aria-label={t("起日")} onChange={(e) => set({ since: e.target.value })} />
        <Input style={{ width: 150 }} type="date" value={filters.until} aria-label={t("迄日")} onChange={(e) => set({ until: e.target.value })} />
        <Checkbox checked={filters.bookmarked === "1"} onChange={(e) => set({ bookmarked: e.target.checked ? "1" : "" })}>{t("只看書籤")}</Checkbox>
        {active && <Button type="link" onClick={reset}>{t("清除條件")}</Button>}
      </div>
      {bad && <Alert style={{ marginBlockStart: 8 }} type="warning" showIcon title={t("起日晚於迄日，不會有任何結果")} />}
      <SearchSyntaxHelp />
    </div>
  );
}
